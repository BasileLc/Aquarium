// Page Accueil : valeur actuelle de chaque paramètre (cliquable → graphe),
// mini-courbe 24 h et tendance par carte, aperçu des prochains événements.
import { PARAMS, STALE_MS } from '../config.js';
import { loadLatest, loadEvents, loadMeasurements } from '../store.js';
import { escapeHtml, fmtValue, fmtWhen, fmtDateHuman, fmtCountdown } from '../ui.js';
import { icon } from '../icons.js';

function paramCard(id, measurement, index) {
  const p = PARAMS[id];
  const hasValue = measurement && measurement.value !== undefined;
  const stale =
    hasValue && p.source === 'apex' && Date.now() - Date.parse(measurement.timestamp) > STALE_MS;
  return `
    <a class="card param-card" href="#/charts?p=${id}" style="--i:${index};--pc:${p.color}">
      <div class="param-top">
        <span class="param-name">${escapeHtml(p.label)}</span>
        <span class="param-trend" data-trend="${id}"></span>
      </div>
      <div class="param-value">
        ${hasValue ? fmtValue(measurement.value, p) : '—'}
        ${p.unit ? `<span class="unit">${escapeHtml(p.unit)}</span>` : ''}
      </div>
      <div class="spark-wrap" data-spark="${id}"></div>
      <div class="param-time ${stale ? 'stale' : ''}">
        ${icon('clock', 12)}
        ${hasValue ? escapeHtml(fmtWhen(measurement.timestamp)) : 'aucune donnée'}
        ${stale ? `${icon('alert', 12)} ancien relevé` : ''}
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

// Mini-courbe SVG des dernières 24 h, dans la couleur du paramètre.
function sparkSvg(points, color) {
  const MAX = 48;
  const step = Math.max(1, Math.floor(points.length / MAX));
  const sampled = points.filter((_, i) => i % step === 0 || i === points.length - 1);
  const xs = sampled.map((pt) => pt.x);
  const ys = sampled.map((pt) => pt.y);
  const xMin = Math.min(...xs);
  const xSpan = Math.max(...xs) - xMin || 1;
  const yMin = Math.min(...ys);
  const ySpan = Math.max(...ys) - yMin || 1;
  const d = sampled
    .map((pt, i) => {
      const x = ((pt.x - xMin) / xSpan) * 100;
      const y = 26 - ((pt.y - yMin) / ySpan) * 22;
      return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join('');
  return `<svg class="spark" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true">
    <path d="${d}" fill="none" stroke="${color}" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

// Flèche de tendance sur 24 h (neutre : rien). Seuil = un demi-pas de la
// précision d'affichage, pour ignorer le bruit de mesure.
function trendSvg(points, param) {
  const delta = points[points.length - 1].y - points[0].y;
  const epsilon = 0.5 * 10 ** -param.decimals;
  if (delta > epsilon) return icon('trend-up', 14);
  if (delta < -epsilon) return icon('trend-down', 14);
  return '';
}

// Remplit mini-courbes et tendances après le premier affichage (les données
// 24 h sont partagées avec la page Graphiques via le cache du store).
async function fillSparklines(el) {
  const { series } = await loadMeasurements(24);
  for (const id of Object.keys(PARAMS)) {
    const sparkHost = el.querySelector(`[data-spark="${id}"]`);
    const points = series[id] || [];
    if (!sparkHost || points.length < 2) continue;
    sparkHost.innerHTML = sparkSvg(points, PARAMS[id].color);
    const trendHost = el.querySelector(`[data-trend="${id}"]`);
    if (trendHost) trendHost.innerHTML = trendSvg(points, PARAMS[id]);
  }
}

export async function renderHome(el) {
  const [latest, events] = await Promise.all([loadLatest(), loadEvents()]);

  const today = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const todayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  const upcoming = events
    .filter((e) => e.status !== 'done' && e.date >= todayStr)
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .slice(0, 3);

  const apexIds = Object.keys(PARAMS).filter((id) => PARAMS[id].source === 'apex');
  const manualIds = Object.keys(PARAMS).filter((id) => PARAMS[id].source === 'manuel');

  el.innerHTML = `
    <section>
      <h2>Sondes Apex</h2>
      <div class="cards">${apexIds.map((id, i) => paramCard(id, latest[id], i)).join('')}</div>
    </section>
    <section>
      <h2>Tests manuels</h2>
      <div class="cards">${manualIds.map((id, i) => paramCard(id, latest[id], i + 1)).join('')}</div>
    </section>
    <section>
      <h2>Événements à venir</h2>
      <a class="card events-preview" href="#/events">
        ${upcoming.length ? upcoming.map(eventRow).join('') : '<div class="empty-hint">Aucun événement planifié</div>'}
        <div class="events-preview-more">Voir le calendrier ${icon('chevron-right', 15)}</div>
      </a>
    </section>`;

  fillSparklines(el).catch(() => {
    /* les mini-courbes sont un bonus : jamais bloquantes */
  });
}
