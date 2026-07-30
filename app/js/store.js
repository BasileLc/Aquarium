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
import { isoWithOffset } from './ui.js';

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

// Les tests manuels sont horodatés à midi de leur journée : deux tests du même
// paramètre le même jour tomberaient donc exactement au même instant, et la
// suppression — qui cible (paramètre, horodatage) — les emporterait tous les
// deux. Le second est décalé d'une minute, puis de deux, etc. Aucun affichage
// ne montre l'heure d'un test manuel : le décalage reste invisible.
// `entries` est le lot enregistré ensemble (salinité + densité, par exemple) :
// il doit garder un horodatage commun, donc on cherche un instant libre pour
// tous ses paramètres à la fois.
function freeTimestamp(entries, existing) {
  const wanted = new Set(entries.map((e) => e.parameter));
  const taken = new Set(
    existing.filter((m) => wanted.has(m.parameter)).map((m) => Date.parse(m.timestamp))
  );
  const when = new Date(Date.parse(entries[0].timestamp));
  if (!taken.has(when.getTime())) return null;
  while (taken.has(when.getTime())) when.setMinutes(when.getMinutes() + 1);
  return isoWithOffset(when);
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
    const shifted = freeTimestamp(entries, existing);
    if (shifted) {
      for (const e of entries) e.timestamp = shifted;
    }
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

// Dernière mesure restante d'un paramètre : on remonte les fichiers mensuels
// depuis `from`, du plus récent au plus ancien (24 mois au maximum).
async function findLastManual(parameter, from) {
  const cursor = new Date(from.getFullYear(), from.getMonth(), 1);
  for (let i = 0; i < 24; i += 1) {
    const entries = (await readJson(manualMonthPath(cursor), [])) || [];
    const matches = entries
      .filter((m) => m.parameter === parameter)
      .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
    if (matches.length) return matches[0];
    cursor.setMonth(cursor.getMonth() - 1);
  }
  return null;
}

/**
 * Supprime des mesures manuelles, identifiées par (paramètre, horodatage),
 * et remet à jour data/manual/latest.json — en repêchant la mesure précédente
 * quand celle supprimée était la dernière connue.
 * Retourne le nombre de mesures effectivement retirées.
 */
export async function deleteManualMeasurements(targets) {
  // Le fichier est nommé d'après le mois local ; on inspecte aussi les mois
  // voisins pour ne pas échouer sur une mesure enregistrée à la frontière
  // d'un mois (ou depuis un autre fuseau horaire).
  const byPath = new Map();
  for (const t of targets) {
    const when = new Date(Date.parse(t.timestamp));
    const candidates = [-1, 0, 1].map((offset) => {
      const d = new Date(when.getFullYear(), when.getMonth() + offset, 1);
      return manualMonthPath(d);
    });
    let found = candidates[1];
    for (const path of candidates) {
      const entries = (await readJson(path, [])) || [];
      if (
        entries.some(
          (m) => m.parameter === t.parameter && Date.parse(m.timestamp) === Date.parse(t.timestamp)
        )
      ) {
        found = path;
        break;
      }
    }
    if (!byPath.has(found)) byPath.set(found, []);
    byPath.get(found).push(t);
  }

  let removed = 0;
  for (const [path, wanted] of byPath) {
    const entries = (await readJson(path, [])) || [];
    const keep = entries.filter(
      (m) =>
        !wanted.some(
          (w) => w.parameter === m.parameter && Date.parse(w.timestamp) === Date.parse(m.timestamp)
        )
    );
    if (keep.length === entries.length) continue;
    removed += entries.length - keep.length;
    const labels = wanted.map((w) => w.parameter).join(', ');
    await writeJson(path, keep, `manuel: suppression de ${labels} (${wanted[0].timestamp})`);
    cache.delete(path);
  }

  if (removed === 0) {
    throw new Error('Mesure introuvable (déjà supprimée ailleurs ?).');
  }

  const latest = (await readJson('data/manual/latest.json', {})) || {};
  let latestChanged = false;
  for (const t of targets) {
    const current = latest[t.parameter];
    if (!current || Date.parse(current.timestamp) !== Date.parse(t.timestamp)) continue;
    const previous = await findLastManual(t.parameter, new Date(Date.parse(t.timestamp)));
    if (previous) latest[t.parameter] = previous;
    else delete latest[t.parameter];
    latestChanged = true;
  }
  if (latestChanged) {
    await writeJson('data/manual/latest.json', latest, 'manuel: mise à jour des dernières valeurs');
    cache.delete('data/manual/latest.json');
  }
  return removed;
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

// --- Marqueurs (repères verticaux sur les graphiques) --------------------
// Écrits par l'app uniquement, comme les événements.

export async function loadMarkers() {
  return (await readJsonCached('data/markers.json', { ttl: 30000 })) || [];
}

async function saveMarkers(markers, message) {
  markers.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  await writeJson('data/markers.json', markers, message);
  cache.delete('data/markers.json');
}

export async function addMarker({ label, timestamp, note }) {
  const markers = (await readJson('data/markers.json', [])) || [];
  markers.push({
    id: `mrk_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    label,
    timestamp,
    note: note || '',
  });
  await saveMarkers(markers, `marqueur: ${label} (${timestamp})`);
}

export async function deleteMarker(id) {
  const markers = (await readJson('data/markers.json', [])) || [];
  const index = markers.findIndex((m) => m.id === id);
  if (index === -1) throw new Error('Marqueur introuvable (déjà supprimé ailleurs ?).');
  const [removed] = markers.splice(index, 1);
  await saveMarkers(markers, `marqueur: suppression de ${removed.label}`);
}
