// Page Accueil : valeur actuelle de chaque paramètre (cliquable → graphe)
// et aperçu des prochains événements.
import { PARAMS, STALE_MS } from '../config.js';
import { loadLatest, loadEvents } from '../store.js';
import { escapeHtml, fmtValue, fmtWhen, fmtDateHuman, fmtCountdown } from '../ui.js';

function paramCard(id, measurement) {
  const p = PARAMS[id];
  const hasValue = measurement && measurement.value !== undefined;
  const stale =
    hasValue && p.source === 'apex' && Date.now() - Date.parse(measurement.timestamp) > STALE_MS;
  return `
    <a class="card param-card" href="#/charts?p=${id}">
      <div class="param-name">${escapeHtml(p.label)}</div>
      <div class="param-value">
        ${hasValue ? fmtValue(measurement.value, p) : '—'}
        ${p.unit ? `<span class="unit">${escapeHtml(p.unit)}</span>` : ''}
      </div>
      <div class="param-time ${stale ? 'stale' : ''}">
        ${hasValue ? escapeHtml(fmtWhen(measurement.timestamp)) : 'aucune donnée'}
        ${stale ? ' ⚠️ ancien relevé' : ''}
      </div>
    </a>`;
}

function eventRow(evt) {
  return `
    <div class="event-row-compact">
      <span class="event-name">${escapeHtml(evt.name)}</span>
      <span class="event-date">${escapeHtml(fmtDateHuman(evt.date))} · ${escapeHtml(fmtCountdown(evt.date))}</span>
    </div>`;
}

export async function renderHome(el) {
  const [latest, events] = await Promise.all([loadLatest(), loadEvents()]);

  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const upcoming = events
    .filter((e) => e.status !== 'done' && e.date >= todayStr)
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .slice(0, 3);

  const apexIds = Object.keys(PARAMS).filter((id) => PARAMS[id].source === 'apex');
  const manualIds = Object.keys(PARAMS).filter((id) => PARAMS[id].source === 'manuel');

  el.innerHTML = `
    <section>
      <h2>Sondes Apex</h2>
      <div class="cards">${apexIds.map((id) => paramCard(id, latest[id])).join('')}</div>
    </section>
    <section>
      <h2>Tests manuels</h2>
      <div class="cards">${manualIds.map((id) => paramCard(id, latest[id])).join('')}</div>
    </section>
    <section>
      <h2>Événements à venir</h2>
      <a class="card events-preview" href="#/events">
        ${upcoming.length ? upcoming.map(eventRow).join('') : '<div class="empty-hint">Aucun événement planifié</div>'}
        <div class="events-preview-more">Voir le calendrier ›</div>
      </a>
    </section>`;
}
