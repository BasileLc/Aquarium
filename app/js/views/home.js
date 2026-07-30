// Page Accueil : tableau de bord de jauges (min / valeur / max sur 12 h),
// présenté comme un cockpit continu plutôt qu'une pile de cartes.
import { PARAMS, STALE_MS, GAUGE_HOURS } from '../config.js';
import { loadLatest, loadEvents, loadMeasurements } from '../store.js';
import { escapeHtml, fmtValue, fmtWhen, fmtClock, fmtDateHuman, fmtCountdown } from '../ui.js';
import { icon } from '../icons.js';
import { gaugeSvg, animateGauges, seriesStats } from '../gauge.js';

function gaugeCell(id, stats, measurement, index) {
  const p = PARAMS[id];
  const hasValue = measurement && measurement.value !== undefined;
  const stale =
    hasValue && p.source === 'apex' && Date.now() - Date.parse(measurement.timestamp) > STALE_MS;
  return `
    <a class="gauge-cell" href="#/charts?p=${id}" style="--i:${index};--pc:${p.color}">
      <span class="cell-label">${escapeHtml(p.label)}</span>
      <span class="gauge-wrap">
        ${gaugeSvg(p, stats)}
        <span class="gauge-center">
          <span class="gv">${hasValue ? fmtValue(measurement.value, p) : '—'}</span>
          ${p.unit ? `<span class="gu">${escapeHtml(p.unit)}</span>` : ''}
        </span>
      </span>
      <span class="cell-foot ${stale ? 'stale' : ''}">
        ${hasValue ? escapeHtml(fmtWhen(measurement.timestamp)) : 'aucune donnée'}${stale ? ' · ancien' : ''}
      </span>
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
  const [latest, events, measurements] = await Promise.all([
    loadLatest(),
    loadEvents(),
    loadMeasurements(GAUGE_HOURS).catch(() => ({ series: {}, errors: 1 })),
  ]);
  const series = measurements.series || {};

  const today = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const todayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  const upcoming = events
    .filter((e) => e.status !== 'done' && e.date >= todayStr)
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .slice(0, 3);

  // Fraîcheur globale : le relevé Apex le plus récent.
  let newest = 0;
  for (const id of Object.keys(PARAMS)) {
    if (PARAMS[id].source !== 'apex') continue;
    const t = latest[id] ? Date.parse(latest[id].timestamp) : 0;
    if (t > newest) newest = t;
  }
  const live = newest > 0 && Date.now() - newest <= STALE_MS;

  const cells = (ids, offset) =>
    ids
      .map((id, i) => gaugeCell(id, seriesStats(series[id], latest[id]), latest[id], i + offset))
      .join('');

  const apexIds = Object.keys(PARAMS).filter((id) => PARAMS[id].source === 'apex');
  const manualIds = Object.keys(PARAMS).filter((id) => PARAMS[id].source === 'manuel');

  el.innerHTML = `
    <div class="status-strip ${live ? 'is-live' : 'is-stale'}">
      <span class="pulse"></span>
      <span class="strip-main">${
        newest
          ? live
            ? `En direct · ${escapeHtml(fmtClock(newest))}`
            : `Silence depuis ${escapeHtml(fmtClock(newest))}`
          : 'En attente du 1ᵉʳ relevé'
      }</span>
      <span class="strip-span">min · max ${GAUGE_HOURS} h</span>
    </div>

    <section class="deck">
      <div class="deck-head"><h2>Sondes Apex</h2></div>
      <div class="gauge-grid">${cells(apexIds, 0)}</div>
    </section>

    <section class="deck">
      <div class="deck-head"><h2>Tests manuels</h2></div>
      <div class="gauge-grid">${cells(manualIds, 2)}</div>
    </section>

    <section class="deck deck-flat">
      <div class="deck-head"><h2>Événements à venir</h2></div>
      <a class="events-preview" href="#/events">
        ${upcoming.length ? upcoming.map(eventRow).join('') : '<div class="empty-hint">Aucun événement planifié</div>'}
        <span class="events-preview-more">Voir le calendrier ${icon('chevron-right', 15)}</span>
      </a>
    </section>`;

  animateGauges(el);
}
