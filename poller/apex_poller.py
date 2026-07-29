#!/usr/bin/env python3
"""Poller Apex → GitHub.

Interroge l'API locale du Neptune Apex (http://<ip>/cgi-bin/status.json) à
intervalle régulier, convertit la température °F → °C, et committe les mesures
dans le clone local du repo avant de le pousser vers GitHub.

Conçu pour tourner en service systemd sur un PC du même réseau que l'Apex :
  - si l'Apex est injoignable, on réessaie au cycle suivant ;
  - si GitHub est injoignable, les commits s'accumulent localement et sont
    poussés à la reconnexion (aucune perte de données) ;
  - aucun fichier n'est écrit à la fois par le poller et par l'app (les
    mesures manuelles vivent dans data/manual/), donc jamais de conflit git.

Python 3.9+ et git sont les seules dépendances (stdlib uniquement).
"""
import argparse
import base64
import configparser
import json
import logging
import signal
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

PARAM_UNITS = {'temp': '°C', 'ph': 'pH', 'orp': 'mV', 'no3': 'ppm', 'po4': 'ppm'}
PARAM_DECIMALS = {'temp': 2, 'ph': 2, 'orp': 0, 'no3': 2, 'po4': 3}
DEFAULT_PROBES = {'temp': 'Temp', 'ph': 'pH', 'orp': 'ORP', 'no3': 'NO3', 'po4': 'PO4'}

log = logging.getLogger('aquarium-poller')


class Poller:
    def __init__(self, config):
        self.host = config.get('apex', 'host')
        self.username = config.get('apex', 'username', fallback='').strip()
        self.password = config.get('apex', 'password', fallback='').strip()
        self.temp_unit = config.get('apex', 'temp_unit', fallback='F').strip().upper()
        self.interval = config.getint('poller', 'interval_seconds', fallback=600)
        self.tz = ZoneInfo(config.get('poller', 'timezone', fallback='Europe/Paris'))
        self.repo = Path(config.get('repo', 'path')).expanduser()
        self.branch = config.get('repo', 'branch', fallback='main')
        self.remote = config.get('repo', 'remote', fallback='origin')
        self.probes = {}
        for param, default in DEFAULT_PROBES.items():
            name = config.get('probes', param, fallback=default).strip()
            if name:
                self.probes[param] = name
        if not (self.repo / '.git').is_dir():
            raise SystemExit(f'{self.repo} n\'est pas un clone git — vérifiez [repo] path.')

    # --- Apex ---------------------------------------------------------------

    def fetch_status(self):
        url = f'http://{self.host}/cgi-bin/status.json'
        request = urllib.request.Request(url)
        if self.username or self.password:
            credentials = base64.b64encode(f'{self.username}:{self.password}'.encode()).decode()
            request.add_header('Authorization', f'Basic {credentials}')
        with urllib.request.urlopen(request, timeout=15) as response:
            return json.load(response)

    def extract_measurements(self, status, now):
        inputs = status.get('istat', status).get('inputs', [])
        by_name = {str(item.get('name', '')).strip().lower(): item for item in inputs}
        timestamp = now.isoformat()
        measurements = []
        for param, probe_name in self.probes.items():
            item = by_name.get(probe_name.lower())
            if item is None:
                log.debug('sonde « %s » absente de status.json', probe_name)
                continue
            try:
                value = float(item.get('value'))
            except (TypeError, ValueError):
                log.warning('valeur illisible pour %s : %r', probe_name, item.get('value'))
                continue
            if param == 'temp' and self.temp_unit == 'F':
                value = (value - 32) * 5 / 9
            decimals = PARAM_DECIMALS[param]
            value = int(round(value)) if decimals == 0 else round(value, decimals)
            measurements.append({
                'parameter': param,
                'value': value,
                'unit': PARAM_UNITS[param],
                'timestamp': timestamp,
                'source': 'apex',
            })
        return measurements

    # --- Fichiers de données --------------------------------------------------

    def day_file(self, now):
        return self.repo / 'data' / 'apex' / f'{now.year:04d}' / f'{now.month:02d}-{now.day:02d}.json'

    def read_json(self, path, fallback):
        try:
            return json.loads(path.read_text(encoding='utf-8'))
        except (FileNotFoundError, json.JSONDecodeError):
            return fallback

    def write_json(self, path, data):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')

    def recently_logged(self, now):
        latest = self.read_json(self.repo / 'data' / 'latest.json', {})
        newest = 0.0
        for measurement in latest.values():
            try:
                newest = max(newest, datetime.fromisoformat(measurement['timestamp']).timestamp())
            except (KeyError, TypeError, ValueError):
                continue
        return (now.timestamp() - newest) < self.interval * 0.5

    def append_measurements(self, measurements, now):
        day_path = self.day_file(now)
        day_data = self.read_json(day_path, [])
        day_data.extend(measurements)
        self.write_json(day_path, day_data)

        latest_path = self.repo / 'data' / 'latest.json'
        latest = self.read_json(latest_path, {})
        for measurement in measurements:
            latest[measurement['parameter']] = measurement
        self.write_json(latest_path, latest)

    # --- Git -----------------------------------------------------------------

    def git(self, *args, timeout=180):
        return subprocess.run(
            ['git', '-C', str(self.repo), *args],
            check=True, capture_output=True, text=True, timeout=timeout,
        )

    def git_pull(self):
        try:
            self.git('pull', '--rebase', '--autostash', self.remote, self.branch)
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as error:
            stderr = getattr(error, 'stderr', '') or ''
            log.warning('git pull impossible (on continue) : %s', stderr.strip() or error)
            try:
                self.git('rebase', '--abort')
            except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
                pass

    def git_commit(self, message):
        self.git('add', 'data')
        staged = subprocess.run(
            ['git', '-C', str(self.repo), 'diff', '--cached', '--quiet'],
            capture_output=True,
        )
        if staged.returncode == 0:
            return False
        self.git('commit', '-m', message)
        return True

    def git_push(self):
        try:
            self.git('push', self.remote, self.branch)
            return True
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as error:
            stderr = getattr(error, 'stderr', '') or ''
            log.warning('git push impossible, nouvel essai au prochain cycle : %s',
                        stderr.strip() or error)
            return False

    # --- Cycle ----------------------------------------------------------------

    def cycle(self):
        self.git_pull()
        now = datetime.now(self.tz).replace(microsecond=0)
        try:
            status = self.fetch_status()
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError) as error:
            log.error('Apex injoignable (%s) — nouvel essai au prochain cycle.', error)
            self.git_push()  # pousse d'éventuels commits en attente
            return False

        measurements = self.extract_measurements(status, now)
        if not measurements:
            log.warning('status.json lu mais aucune sonde reconnue — vérifiez [probes].')
            self.git_push()
            return False

        if self.recently_logged(now):
            log.info('relevé ignoré : le précédent date de moins de %d s.', self.interval // 2)
            self.git_push()
            return True

        self.append_measurements(measurements, now)
        summary = ', '.join(f"{m['parameter']}={m['value']}" for m in measurements)
        if self.git_commit(f"apex: {now.strftime('%Y-%m-%d %H:%M')} ({summary})"):
            log.info('relevé enregistré : %s', summary)
        self.git_push()
        return True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', required=True, help='chemin du fichier config.ini')
    parser.add_argument('--once', action='store_true', help='un seul cycle puis sortie (test)')
    parser.add_argument('--verbose', action='store_true')
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format='%(asctime)s %(levelname)s %(message)s',
        stream=sys.stdout,
    )

    config = configparser.ConfigParser()
    if not config.read(args.config, encoding='utf-8'):
        raise SystemExit(f'Config introuvable : {args.config}')
    poller = Poller(config)

    if args.once:
        sys.exit(0 if poller.cycle() else 1)

    stop = threading.Event()
    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, lambda *_: stop.set())

    log.info('démarrage : Apex %s, intervalle %d s, repo %s', poller.host, poller.interval, poller.repo)
    while not stop.is_set():
        started = time.monotonic()
        try:
            poller.cycle()
        except Exception:  # le service ne doit jamais mourir sur un imprévu
            log.exception('erreur inattendue pendant le cycle')
        elapsed = time.monotonic() - started
        stop.wait(max(5.0, poller.interval - elapsed))
    log.info('arrêt demandé, au revoir.')


if __name__ == '__main__':
    main()
