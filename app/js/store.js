// Couche de données : sait où vivent les fichiers JSON dans le repo,
// les charge avec un petit cache mémoire, et applique les écritures
// (mesures manuelles, événements).
//
// Partage des fichiers (aucun fichier n'est écrit par deux acteurs, ce qui
// évite tout conflit git entre le poller et l'app) :
//   data/apex/AAAA/MM-JJ.json  → écrit par le poller uniquement
//   data/latest.json           → écrit par le poller uniquement
//   data/manual/AAAA-MM.json   → écrit par l'app uniquement
//   data/manual/latest.json    → écrit par l'app uniquement
//   data/events.json           → écrit par l'app uniquement
import { readJson, writeJson } from './github.js';
import { PARAMS } from './config.js';

const cache = new Map(); // chemin → { data, ts, immutable }

export function clearCache() {
  cache.clear();
}

async function readJsonCached(path, { immutable = false, ttl = 60000 } = {}) {
  const hit = cache.get(path);
  if (hit && (hit.immutable || Date.now() - hit.ts < ttl)) return hit.data;
  const data = await readJson(path, null);
  // Un fichier absent d'un jour passé ne réapparaîtra pas : on peut le figer aussi.
  cache.set(path, { data, ts: Date.now(), immutable });
  return data;
}

const pad = (n) => String(n).padStart(2, '0');

export function apexDayPath(date) {
  return `data/apex/${date.getFullYear()}/${pad(date.getMonth() + 1)}-${pad(date.getDate())}.json`;
}

export function manualMonthPath(date) {
  return `data/manual/${date.getFullYear()}-${pad(date.getMonth() + 1)}.json`;
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function isSameMonth(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

// Liste des jours calendaires couvrant [maintenant - hours, maintenant].
function daysInRange(hours) {
  const now = new Date();
  const start = new Date(now.getTime() - hours * 3600 * 1000);
  const days = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  while (cursor <= now) {
    days.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

// Dernière valeur connue de chaque paramètre (Apex + manuel).
export async function loadLatest() {
  const [apex, manual] = await Promise.all([
    readJsonCached('data/latest.json', { ttl: 60000 }),
    readJsonCached('data/manual/latest.json', { ttl: 60000 }),
  ]);
  return { ...(apex || {}), ...(manual || {}) };
}

// Séries temporelles de TOUS les paramètres sur les `hours` dernières heures.
// Retourne { erreurs: n, series: { paramId: [{x: ms, y: valeur}, ...] } }.
export async function loadMeasurements(hours) {
  const now = new Date();
  const days = daysInRange(hours);
  const targets = [];
  for (const day of days) {
    targets.push({ path: apexDayPath(day), immutable: !isSameDay(day, now) });
  }
  const months = new Set();
  for (const day of days) {
    const path = manualMonthPath(day);
    if (!months.has(path)) {
      months.add(path);
      // Une mesure manuelle peut être antidatée : on ne fige jamais très longtemps.
      targets.push({ path, immutable: false, ttl: isSameMonth(day, now) ? 60000 : 300000 });
    }
  }

  let errors = 0;
  const files = await Promise.all(
    targets.map((t) =>
      readJsonCached(t.path, { immutable: t.immutable, ttl: t.ttl }).catch(() => {
        errors += 1;
        return null;
      })
    )
  );

  const since = now.getTime() - hours * 3600 * 1000;
  const horizon = now.getTime() + 60000;
  const series = {};
  for (const id of Object.keys(PARAMS)) series[id] = [];
  for (const file of files) {
    if (!Array.isArray(file)) continue;
    for (const m of file) {
      const t = Date.parse(m.timestamp);
      if (Number.isFinite(t) && t >= since && t <= horizon && series[m.parameter]) {
        series[m.parameter].push({ x: t, y: m.value });
      }
    }
  }
  for (const id of Object.keys(series)) series[id].sort((a, b) => a.x - b.x);
  return { series, errors };
}

// Enregistre une ou plusieurs mesures manuelles (même horodatage pour
// salinité + densité), puis met à jour data/manual/latest.json.
export async function addManualMeasurements(measurements) {
  const byPath = new Map();
  for (const m of measurements) {
    const path = manualMonthPath(new Date(Date.parse(m.timestamp)));
    if (!byPath.has(path)) byPath.set(path, []);
    byPath.get(path).push(m);
  }

  for (const [path, entries] of byPath) {
    const existing = (await readJson(path, [])) || [];
    existing.push(...entries);
    existing.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
    await writeJson(path, existing, `manuel: ${entries.map((e) => e.parameter).join(', ')} (${entries[0].timestamp})`);
    cache.delete(path);
  }

  const latest = (await readJson('data/manual/latest.json', {})) || {};
  let latestChanged = false;
  for (const m of measurements) {
    const current = latest[m.parameter];
    if (!current || Date.parse(m.timestamp) >= Date.parse(current.timestamp)) {
      latest[m.parameter] = m;
      latestChanged = true;
    }
  }
  if (latestChanged) {
    await writeJson('data/manual/latest.json', latest, 'manuel: mise à jour des dernières valeurs');
    cache.delete('data/manual/latest.json');
  }
}

// --- Événements -----------------------------------------------------------

export async function loadEvents() {
  return (await readJsonCached('data/events.json', { ttl: 30000 })) || [];
}

async function saveEvents(events, message) {
  events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  await writeJson('data/events.json', events, message);
  cache.delete('data/events.json');
}

export async function addEvent({ name, date, note }) {
  const events = (await readJson('data/events.json', [])) || [];
  events.push({
    id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name,
    date,
    note: note || '',
    status: 'pending',
  });
  await saveEvents(events, `événement: ${name} (${date})`);
}

export async function setEventStatus(id, status) {
  const events = (await readJson('data/events.json', [])) || [];
  const evt = events.find((e) => e.id === id);
  if (!evt) throw new Error('Événement introuvable (déjà modifié ailleurs ?).');
  evt.status = status;
  await saveEvents(events, `événement: ${evt.name} → ${status}`);
}

export async function deleteEvent(id) {
  const events = (await readJson('data/events.json', [])) || [];
  const index = events.findIndex((e) => e.id === id);
  if (index === -1) throw new Error('Événement introuvable (déjà supprimé ailleurs ?).');
  const [removed] = events.splice(index, 1);
  await saveEvents(events, `événement: suppression de ${removed.name}`);
}
