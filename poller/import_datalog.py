#!/usr/bin/env python3
"""Import unique de l'historique du datalog Apex vers data/apex/.

L'Apex conserve en interne un historique des sondes, interrogeable en local :
    http://<ip>/cgi-bin/datalog.xml?sdate=AAMMJJ&days=1

Ce script le parcourt jour par jour (du plus ancien au plus récent), convertit
les relevés au format de la base (°F → °C, fuseau, fichiers journaliers) et
committe le tout en un seul commit. Il DÉDUPLIQUE sur (paramètre, horodatage) :
le relancer n'ajoute jamais de doublon et les relevés déjà présents (poussés
par le service) sont préservés.

À lancer depuis la racine du repo, service arrêté pour éviter qu'il committe
en même temps :
    sudo systemctl stop aquarium-poller
    python3 poller/import_datalog.py --config poller/config.ini --days 365
    sudo systemctl start aquarium-poller

Les jours sans données (avant l'installation de l'Apex, historique purgé…)
sont ignorés silencieusement. --dry-run montre ce qui serait importé sans
rien écrire ni pousser.
"""
import argparse
import base64
import configparser
import sys
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from apex_poller import PARAM_DECIMALS, PARAM_UNITS, Poller  # noqa: E402

DATE_FORMATS = ('%m/%d/%Y %H:%M:%S', '%m/%d/%Y %H:%M', '%Y-%m-%d %H:%M:%S')


def fetch_datalog(poller, day):
    base = poller.host if poller.host.startswith(('http://', 'https://')) else f'http://{poller.host}'
    url = f"{base.rstrip('/')}/cgi-bin/datalog.xml?sdate={day.strftime('%y%m%d')}&days=1"
    request = urllib.request.Request(url)
    if poller.username or poller.password:
        credentials = base64.b64encode(f'{poller.username}:{poller.password}'.encode()).decode()
        request.add_header('Authorization', f'Basic {credentials}')
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read()


def parse_date(text):
    for fmt in DATE_FORMATS:
        try:
            return datetime.strptime(text, fmt)
        except ValueError:
            continue
    return None


def parse_records(xml_bytes, poller):
    """Extrait du XML les mesures des sondes suivies ([probes] de la config)."""
    param_by_probe = {name.lower(): param for param, name in poller.probes.items()}
    measurements = []
    root = ET.fromstring(xml_bytes)
    for record in root.iter('record'):
        naive = parse_date((record.findtext('date') or '').strip())
        if naive is None:
            continue
        timestamp = naive.replace(tzinfo=poller.tz).isoformat()
        for probe in record.iter('probe'):
            param = param_by_probe.get((probe.findtext('name') or '').strip().lower())
            if param is None:
                continue
            try:
                value = float((probe.findtext('value') or '').strip())
            except ValueError:
                continue
            if param == 'temp' and poller.temp_unit == 'F':
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


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', required=True, help='chemin du fichier config.ini')
    parser.add_argument('--days', type=int, default=365,
                        help="nombre de jours d'historique à demander (défaut : 365)")
    parser.add_argument('--dry-run', action='store_true',
                        help="montre ce qui serait importé sans écrire ni pousser")
    args = parser.parse_args()

    config = configparser.ConfigParser()
    if not config.read(args.config, encoding='utf-8'):
        raise SystemExit(f'Config introuvable : {args.config}')
    poller = Poller(config)

    if not args.dry_run:
        poller.git_pull()

    today = datetime.now(poller.tz).date()
    collected = []
    failures = 0
    days_with_data = set()
    print(f"Parcours du datalog de l'Apex ({poller.host}) sur {args.days} jours…")
    for offset in range(args.days, -1, -1):
        day = today - timedelta(days=offset)
        xml_bytes = None
        for attempt in (1, 2):
            try:
                xml_bytes = fetch_datalog(poller, day)
                break
            except (urllib.error.URLError, TimeoutError, OSError):
                if attempt == 1:
                    time.sleep(2)
        if xml_bytes is None:
            failures += 1
            print(f'  ! {day} : Apex injoignable, jour sauté')
            continue
        try:
            measurements = parse_records(xml_bytes, poller)
        except ET.ParseError:
            failures += 1
            print(f'  ! {day} : réponse illisible, jour sauté')
            continue
        for m in measurements:
            days_with_data.add(m['timestamp'][:10])
        collected.extend(measurements)
        if offset % 30 == 0 and offset:
            print(f'  … reste {offset} jours à parcourir ({len(collected)} mesures trouvées)')
        time.sleep(0.15)

    if not collected:
        print('Aucune donnée trouvée dans le datalog sur cette période.')
        return

    # Groupement par fichier journalier + déduplication sur (paramètre, horodatage).
    by_file = {}
    for m in collected:
        day = datetime.fromisoformat(m['timestamp'])
        by_file.setdefault(poller.day_file(day), []).append(m)

    added = 0
    for path, entries in sorted(by_file.items()):
        existing = poller.read_json(path, [])
        seen = {(m.get('parameter'), m.get('timestamp')) for m in existing}
        fresh = []
        for m in entries:
            key = (m['parameter'], m['timestamp'])
            if key not in seen:
                seen.add(key)
                fresh.append(m)
        if not fresh:
            continue
        added += len(fresh)
        if not args.dry_run:
            merged = existing + fresh
            merged.sort(key=lambda m: m['timestamp'])
            poller.write_json(path, merged)

    print(f'{len(collected)} mesures lues, {len(days_with_data)} jours couverts, '
          f'{added} nouvelles à importer'
          + (f', {failures} jours en échec' if failures else '') + '.')

    if args.dry_run:
        print('--dry-run : rien écrit, rien poussé.')
        return
    if added == 0:
        print('Tout était déjà importé, rien à faire.')
        return

    first_day = min(days_with_data)
    if poller.git_commit(f'import: historique datalog Apex depuis {first_day} ({added} mesures)'):
        if poller.git_push():
            print('✓ Historique importé et poussé — les graphiques 7 j / 30 j sont maintenant remplis.')
        else:
            print('Commit créé mais push impossible — il partira au prochain cycle du service.')


if __name__ == '__main__':
    main()
