// Jauges de tableau de bord en SVG pur, sans aiguille : un arc de 240° dont
// le remplissage dégradé va du minimum (à gauche) jusqu'à la valeur courante,
// repérée par un point lumineux. La valeur occupe le centre du cadran.
import { fmtValue } from './ui.js';

const CX = 60;
const CY = 54;
const R = 41;
const SPAN = 240; // degrés balayés
const START = 210; // angle du minimum (repère maths : 0° = est, sens antihoraire)

function polar(angleDeg, radius = R) {
  const rad = (angleDeg * Math.PI) / 180;
  return [CX + radius * Math.cos(rad), CY - radius * Math.sin(rad)];
}

function arcPath(radius = R) {
  const [x1, y1] = polar(START, radius);
  const [x2, y2] = polar(START - SPAN, radius);
  return `M${x1.toFixed(2)},${y1.toFixed(2)} A${radius},${radius} 0 1 1 ${x2.toFixed(2)},${y2.toFixed(2)}`;
}

/**
 * Construit une jauge.
 * `stats` : { value, min, max } sur la fenêtre de référence, ou null si aucune
 * donnée. Le remplissage est animé après insertion dans le DOM (animateGauges).
 */
export function gaugeSvg(param, stats) {
  const hasData = stats && Number.isFinite(stats.value);
  // Sans amplitude (valeur constante sur la fenêtre), le repère se place au
  // centre de l'arc : ni « au plus bas », ni « au plus haut ».
  const span = hasData ? stats.max - stats.min : 0;
  const t = hasData && span > 0 ? (stats.value - stats.min) / span : 0.5;
  const clamped = Math.min(1, Math.max(0, t));
  const [dotX, dotY] = polar(START - SPAN * clamped);
  const uid = `g${Math.random().toString(36).slice(2, 8)}`;
  const [from, to] = param.grad || [param.color, param.color];

  return `
  <svg class="gauge${hasData && span === 0 ? ' is-flat' : ''}" viewBox="0 0 120 92" role="img"
       aria-label="${param.label} : ${hasData ? fmtValue(stats.value, param) : 'aucune donnée'} ${param.unit}">
    <defs>
      <linearGradient id="${uid}" x1="0" y1="1" x2="1" y2="0">
        <stop offset="0" stop-color="${from}"/>
        <stop offset="1" stop-color="${to}"/>
      </linearGradient>
    </defs>
    <path class="gauge-track" d="${arcPath()}" fill="none" stroke-width="8" stroke-linecap="round"/>
    <!-- Le remplissage est piloté par stroke-dasharray (« rempli, reste ») et
         non par dashoffset : avec un linecap arrondi, le tiret suivant du
         motif déborderait sinon à l'autre extrémité de l'arc. -->
    <path class="gauge-fill" d="${arcPath()}" fill="none" pathLength="1"
          stroke="url(#${uid})" stroke-width="8"
          stroke-linecap="${clamped > 0.02 ? 'round' : 'butt'}"
          stroke-dasharray="0 2"
          data-target="${hasData ? clamped.toFixed(4) : 0}"/>
    ${
      hasData
        ? `<circle class="gauge-dot" cx="${dotX.toFixed(2)}" cy="${dotY.toFixed(2)}" r="4.2"
                   fill="#ffffff" stroke="#0b1a2b" stroke-width="1.2"/>`
        : ''
    }
    <text class="gauge-extreme" x="8" y="88">${hasData ? fmtValue(stats.min, param) : '—'}</text>
    <text class="gauge-extreme gauge-extreme-max" x="112" y="88">${hasData ? fmtValue(stats.max, param) : '—'}</text>
  </svg>`;
}

/**
 * Lance le remplissage progressif des arcs. Appelé après insertion dans le DOM.
 */
export function animateGauges(root) {
  requestAnimationFrame(() => {
    for (const fill of root.querySelectorAll('.gauge-fill')) {
      fill.style.strokeDasharray = `${fill.dataset.target} 2`;
    }
  });
}

// Min / max / dernière valeur d'une série sur la fenêtre chargée.
export function seriesStats(points, latest) {
  if (!points || points.length === 0) {
    return latest && latest.value !== undefined
      ? { value: latest.value, min: latest.value, max: latest.value }
      : null;
  }
  let min = Infinity;
  let max = -Infinity;
  for (const p of points) {
    if (p.y < min) min = p.y;
    if (p.y > max) max = p.y;
  }
  // La dernière valeur connue (latest.json) peut être plus récente que la
  // fenêtre chargée : on l'inclut dans l'échelle pour que le repère tienne.
  const value = latest && latest.value !== undefined ? latest.value : points[points.length - 1].y;
  return { value, min: Math.min(min, value), max: Math.max(max, value) };
}
