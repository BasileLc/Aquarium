// Page Graphiques : tous les graphes sur une seule page, en défilement
// vertical avec accrochage et transitions pilotées par le scroll (profondeur,
// échelle et opacité suivent la position de chaque section).
import { PARAMS, COMBINED, MANUAL_FORMS, RANGES } from '../config.js';
import {
  loadMeasurements,
  loadLatest,
  addManualMeasurements,
  deleteManualMeasurements,
  loadMarkers,
  addMarker,
} from '../store.js';
import {
  escapeHtml,
  toast,
  openModal,
  fmtValue,
  fmtWhen,
  isoWithOffset,
  datetimeLocalValue,
} from '../ui.js';
import { icon } from '../icons.js';

const SLIDES = [
  ...Object.keys(PARAMS).map((id) => ({
    id,
    label: PARAMS[id].label,
    sub: PARAMS[id].source === 'apex' ? 'sonde Apex' : 'test manuel',
    color: PARAMS[id].color,
    panels: [[id]],
  })),
  ...COMBINED.map((c) => ({ ...c, color: PARAMS[c.panels[0][0]].color })),
];

const CHROME = {
  text: '#c3d8ec',
  muted: '#8aa4bf',
  grid: 'rgba(125, 211, 252, 0.09)',
  axis: 'rgba(125, 211, 252, 0.2)',
  tooltipBg: '#1d3550',
};

const state = {
  rangeHours: 24,
  charts: new Map(), // index de slide → [Chart, …]
  series: {},
  markers: [],
  sections: [],
  observer: null,
  onResize: null,
};

const pad = (n) => String(n).padStart(2, '0');

function fmtTick(ms) {
  const d = new Date(ms);
  if (state.rangeHours <= 24) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  // Sur 48 h les graduations tombent toutes les 12 h : la date marque minuit,
  // l'heure marque midi (sinon deux graduations porteraient le même jour).
  if (state.rangeHours <= 48) {
    return d.getHours() === 0
      ? `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`
      : `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
}

function fmtTooltipTitle(ms) {
  const d = new Date(ms);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Graduations de l'axe temps à heures/jours ronds : toutes les 6 h sur 24 h,
// toutes les 12 h sur 48 h, chaque jour sur 7 j, tous les 5 jours sur 30 j.
function buildTimeTicks(min, max) {
  const ticks = [];
  const cursor = new Date(min);
  cursor.setMinutes(0, 0, 0);
  if (state.rangeHours <= 48) {
    const stepHours = state.rangeHours <= 24 ? 6 : 12;
    cursor.setHours(cursor.getHours() - (cursor.getHours() % stepHours));
    let t = cursor.getTime();
    while (t <= max) {
      if (t >= min) ticks.push(t);
      t += stepHours * 3600 * 1000;
    }
  } else {
    cursor.setHours(0, 0, 0, 0);
    const stepDays = state.rangeHours <= 24 * 7 ? 1 : 5;
    while (cursor.getTime() <= max) {
      if (cursor.getTime() >= min) ticks.push(cursor.getTime());
      cursor.setDate(cursor.getDate() + stepDays);
    }
  }
  return ticks;
}

const LABEL_H = 16; // hauteur d'une étiquette de marqueur
const LABEL_LANES = 4; // niveaux d'empilement disponibles
const LABEL_GAP = 5; // marge horizontale minimale entre deux étiquettes

/**
 * Place les étiquettes de marqueurs sans chevauchement : chaque étiquette
 * descend d'un niveau tant que le précédent est encore occupé à cet endroit.
 * Fonction pure (testable) — `measure` renvoie la largeur d'un texte.
 * `items` : [{ x, label }] triés par x croissant.
 */
export function layoutMarkerLabels(items, area, measure) {
  const maxWidth = Math.max(60, area.width * 0.45);
  const laneEnds = new Array(LABEL_LANES).fill(-Infinity);
  return items.map(({ x, label }) => {
    // Tronque les étiquettes trop longues plutôt que de laisser déborder.
    let text = label || '';
    if (measure(text) + 10 > maxWidth) {
      while (text.length > 1 && measure(`${text}…`) + 10 > maxWidth) {
        text = text.slice(0, -1);
      }
      text = `${text}…`;
    }
    const width = measure(text) + 10;
    // Près du bord droit, l'étiquette se rabat à gauche de sa ligne.
    const flip = x + width + 4 > area.right;
    const bx = flip ? x - width - 3 : x + 3;

    const lane = laneEnds.findIndex((end) => bx >= end + LABEL_GAP);
    if (lane === -1) {
      // Tous les niveaux sont pris à cet endroit : mieux vaut masquer
      // l'étiquette qu'en superposer deux. La ligne du repère reste tracée, et
      // l'étiquette réapparaît sur une plage plus courte, où les repères
      // s'écartent (le marqueur reste listé dans « Événements »).
      return { text, width, bx, by: 0, lane: -1, hidden: true };
    }
    laneEnds[lane] = bx + width;
    return { text, width, bx, by: area.top + 3 + lane * LABEL_H, lane, hidden: false };
  });
}

// Repères verticaux (marqueurs) tracés par-dessus les courbes : une ligne
// pointillée et une étiquette, pour situer une intervention dans le temps.
const markerPlugin = {
  id: 'aquariumMarkers',
  afterDatasetsDraw(chart) {
    if (!state.markers.length) return;
    const { ctx, chartArea, scales } = chart;
    const xScale = scales.x;
    if (!xScale) return;

    ctx.save();
    ctx.font = '600 10px system-ui, sans-serif';

    const visible = [];
    for (const marker of state.markers) {
      const ts = Date.parse(marker.timestamp);
      if (!Number.isFinite(ts) || ts < xScale.min || ts > xScale.max) continue;
      visible.push({ x: xScale.getPixelForValue(ts), label: marker.label || '' });
    }
    if (!visible.length) {
      ctx.restore();
      return;
    }

    // Lignes d'abord, étiquettes ensuite : elles restent lisibles par-dessus.
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(232, 121, 249, 0.75)';
    for (const { x } of visible) {
      ctx.beginPath();
      ctx.moveTo(x, chartArea.top);
      ctx.lineTo(x, chartArea.bottom);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    const placed = layoutMarkerLabels(visible, chartArea, (t) => ctx.measureText(t).width);
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    for (const { text, width, bx, by, hidden } of placed) {
      if (hidden) continue;
      ctx.fillStyle = 'rgba(232, 121, 249, 0.92)';
      ctx.beginPath();
      ctx.roundRect(bx, by, width, 14, 4);
      ctx.fill();
      ctx.fillStyle = '#16101f';
      ctx.fillText(text, bx + 5, by + 7.5);
    }
    ctx.restore();
  },
};

// Recharge les séries et redessine les graphes déjà montés (après une
// suppression, sans reconstruire toute la page ni bouger le défilement).
async function refreshSeries() {
  const { series } = await loadMeasurements(state.rangeHours);
  state.series = series;
  for (const [index, charts] of state.charts) {
    const slide = SLIDES[index];
    charts.forEach((chart, panel) => {
      const ids = slide.panels[panel] || [];
      ids.forEach((id, i) => {
        if (chart.data.datasets[i]) chart.data.datasets[i].data = state.series[id] || [];
      });
      chart.update();
      const section = document.querySelector(`.chart-section[data-index="${index}"]`);
      const empty = section && section.querySelector(`.chart-empty[data-empty="${panel}"]`);
      if (empty) empty.hidden = ids.some((id) => (state.series[id] || []).length > 0);
    });
  }
}

/**
 * Clic sur un point : propose de supprimer la mesure — uniquement pour les
 * tests manuels. Les relevés Apex viennent du poller et se régénéreraient.
 */
function openDeleteMeasureModal(paramId, timestamp, value) {
  const p = PARAMS[paramId];
  // La salinité et la densité sont saisies ensemble : proposer de retirer les
  // deux, sinon la « même mesure » resterait à moitié présente.
  const sibling = MANUAL_FORMS.find(
    (f) => f.params.length > 1 && f.params.includes(paramId)
  );
  const otherId = sibling ? sibling.params.find((id) => id !== paramId) : null;

  const modal = openModal(
    'Supprimer cette mesure ?',
    `<div class="del-summary">
      <span class="del-dot" style="background:${p.color}"></span>
      <span>
        <b>${escapeHtml(p.label)}</b> ·
        ${fmtValue(value, p)}${p.unit ? ` ${escapeHtml(p.unit)}` : ''}
        <span class="del-when">${escapeHtml(fmtWhen(timestamp))}</span>
      </span>
    </div>
    ${
      otherId
        ? `<label class="del-check">
             <input type="checkbox" id="del-sibling" checked>
             <span>Supprimer aussi ${escapeHtml(PARAMS[otherId].label)} du même relevé</span>
           </label>`
        : ''
    }
    <p class="hint">Cette suppression est définitive.</p>
    <button type="button" class="btn danger" id="del-confirm">${icon('trash', 17)} Supprimer</button>`
  );

  modal.querySelector('#del-confirm').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = 'Suppression…';
    const targets = [{ parameter: paramId, timestamp }];
    const also = modal.querySelector('#del-sibling');
    if (otherId && also && also.checked) targets.push({ parameter: otherId, timestamp });
    try {
      const removed = await deleteManualMeasurements(targets);
      modal.close();
      toast(removed > 1 ? `${removed} mesures supprimées` : 'Mesure supprimée', 'success');
      await refreshSeries();
    } catch (err) {
      toast(err.message, 'error');
      btn.disabled = false;
      btn.innerHTML = `${icon('trash', 17)} Supprimer`;
    }
  });
}

// Clic sur le graphe : ne réagit que si l'on touche réellement un point
// (intersect: true), pour ne jamais viser une mesure éloignée par erreur.
function handleChartClick(event, chart, paramIds) {
  const hits = chart.getElementsAtEventForMode(event, 'nearest', { intersect: true }, false);
  if (!hits.length) return;
  const hit = hits[0];
  const paramId = paramIds[hit.datasetIndex];
  const p = PARAMS[paramId];
  if (!p) return;
  if (p.source !== 'manuel') {
    toast('Les relevés Apex ne se suppriment pas ici : ils viennent du poller.', 'info');
    return;
  }
  const point = chart.data.datasets[hit.datasetIndex].data[hit.index];
  if (!point) return;
  openDeleteMeasureModal(paramId, new Date(point.x).toISOString(), point.y);
}

function buildPanel(canvas, paramIds, showLegend = false) {
  const now = Date.now();
  const min = now - state.rangeHours * 3600 * 1000;
  const multi = paramIds.length > 1;
  const ctx = canvas.getContext('2d');

  const datasets = paramIds.map((id) => {
    const p = PARAMS[id];
    const dense = p.source === 'apex';
    // Dégradé vertical sous la courbe : donne du corps sans masquer la grille.
    const fill = ctx.createLinearGradient(0, 0, 0, canvas.clientHeight || 240);
    fill.addColorStop(0, `${p.color}59`);
    fill.addColorStop(1, `${p.color}00`);

    if (!dense) {
      // Tests manuels : une mesure par jour au mieux. Les points sont marqués
      // et seulement suggérés par un trait pointillé — un trait plein (ou une
      // aire remplie) laisserait croire à des valeurs mesurées entre deux
      // relevés, ce qui donnait cet aspect de paliers continus.
      return {
        label: p.short,
        data: state.series[id] || [],
        borderColor: `${p.color}88`,
        backgroundColor: p.color,
        borderDash: [5, 5],
        borderWidth: 1.6,
        fill: false,
        tension: 0,
        pointRadius: 4.5,
        pointHoverRadius: 7,
        pointHitRadius: 14,
        pointBackgroundColor: p.color,
        pointBorderColor: 'rgba(9, 22, 36, 0.9)',
        pointBorderWidth: 1.5,
        spanGaps: true,
      };
    }

    return {
      label: p.short,
      data: state.series[id] || [],
      borderColor: p.color,
      backgroundColor: fill,
      fill: multi ? false : 'origin',
      borderWidth: 2.4,
      pointRadius: 0,
      pointHoverRadius: 6,
      pointHitRadius: 12,
      pointBackgroundColor: p.color,
      tension: 0.3,
      // Coupe la ligne si le poller a été absent plus de 45 min.
      spanGaps: 45 * 60 * 1000,
    };
  });

  const unit = PARAMS[paramIds[0]].unit;

  // Bornes Y : marge de 12 % autour des données, sans jamais descendre sous
  // zéro pour des grandeurs positives (ppm, dKH…).
  let dataMin = Infinity;
  let dataMax = -Infinity;
  for (const id of paramIds) {
    for (const point of state.series[id] || []) {
      if (point.y < dataMin) dataMin = point.y;
      if (point.y > dataMax) dataMax = point.y;
    }
  }
  let suggestedMin;
  let suggestedMax;
  if (dataMin <= dataMax) {
    let padding = (dataMax - dataMin) * 0.12;
    if (padding === 0) padding = Math.max(Math.abs(dataMax) * 0.02, 0.01);
    suggestedMin = dataMin - padding;
    if (dataMin >= 0) suggestedMin = Math.max(0, suggestedMin);
    suggestedMax = dataMax + padding;
  }

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  return new Chart(ctx, {
    type: 'line',
    data: { datasets },
    plugins: [markerPlugin],
    options: {
      animation: reduced ? false : { duration: 700, easing: 'easeOutQuart' },
      responsive: true,
      maintainAspectRatio: false,
      parsing: false,
      normalized: true,
      interaction: { mode: 'nearest', axis: 'x', intersect: false },
      onClick: (event, _elements, chart) => handleChartClick(event, chart, paramIds),
      onHover: (event, _elements, chart) => {
        const hits = chart.getElementsAtEventForMode(event, 'nearest', { intersect: true }, false);
        const overManual = hits.length && PARAMS[paramIds[hits[0].datasetIndex]]?.source === 'manuel';
        event.native.target.style.cursor = overManual ? 'pointer' : 'default';
      },
      layout: { padding: { top: 6, right: 4 } },
      scales: {
        x: {
          type: 'linear',
          min,
          max: now,
          border: { color: CHROME.axis },
          grid: { color: CHROME.grid, drawTicks: false },
          afterBuildTicks: (axis) => {
            axis.ticks = buildTimeTicks(axis.min, axis.max).map((value) => ({ value }));
          },
          ticks: { color: CHROME.muted, maxRotation: 0, font: { size: 11 }, callback: (v) => fmtTick(v) },
        },
        y: {
          border: { display: false },
          grid: { color: CHROME.grid, drawTicks: false },
          suggestedMin,
          suggestedMax,
          title: { display: Boolean(unit), text: unit, color: CHROME.muted, font: { size: 11 } },
          ticks: { color: CHROME.muted, maxTicksLimit: 5, font: { size: 11 } },
        },
      },
      plugins: {
        legend: {
          display: multi || showLegend,
          labels: { color: CHROME.text, usePointStyle: true, pointStyle: 'line', boxHeight: 8, font: { size: 12 } },
        },
        tooltip: {
          backgroundColor: CHROME.tooltipBg,
          titleColor: '#eff8ff',
          bodyColor: CHROME.text,
          borderColor: 'rgba(125, 211, 252, 0.25)',
          borderWidth: 1,
          cornerRadius: 12,
          padding: 11,
          displayColors: multi,
          callbacks: {
            title: (items) => (items.length ? fmtTooltipTitle(items[0].parsed.x) : ''),
            label: (item) => {
              const p = PARAMS[paramIds[item.datasetIndex]];
              return ` ${p.short} : ${fmtValue(item.parsed.y, p)}${p.unit ? ` ${p.unit}` : ''}`;
            },
          },
        },
      },
    },
  });
}

function destroyCharts() {
  for (const charts of state.charts.values()) {
    for (const c of charts) c.destroy();
  }
  state.charts.clear();
}

// Remet la page à zéro avant un nouveau rendu. Indispensable : `state` vit au
// niveau du module, donc sans cela `mountSection` croirait les graphes déjà
// montés (ils pointent vers des canvas retirés du DOM) et les panneaux
// resteraient vides à la deuxième visite.
function teardown() {
  destroyCharts();
  if (state.observer) {
    state.observer.disconnect();
    state.observer = null;
  }
  if (state.onResize) {
    window.removeEventListener('resize', state.onResize);
    state.onResize = null;
  }
  state.sections = [];
}

// Instancie les graphes d'une section (une seule fois, à l'approche).
function mountSection(section) {
  const index = Number(section.dataset.index);
  if (state.charts.has(index)) return;
  const slide = SLIDES[index];
  const charts = [];
  slide.panels.forEach((ids, i) => {
    const canvas = section.querySelector(`canvas[data-panel="${i}"]`);
    if (canvas) charts.push(buildPanel(canvas, ids, slide.panels.length > 1));
    const empty = section.querySelector(`.chart-empty[data-empty="${i}"]`);
    if (empty) empty.hidden = ids.some((id) => (state.series[id] || []).length > 0);
  });
  state.charts.set(index, charts);
}

// Publie la position relative de chaque section ; le CSS en tire l'échelle,
// la profondeur et l'opacité (transitions fluides pendant le défilement).
function updateParallax(scroller, rail) {
  const viewH = scroller.clientHeight || 1;
  const center = scroller.scrollTop + viewH / 2;
  let bestIndex = 0;
  let bestDist = Infinity;
  for (const s of state.sections) {
    const d = (s.top + s.height / 2 - center) / viewH;
    const a = Math.min(1, Math.abs(d));
    s.el.style.setProperty('--d', d.toFixed(3));
    s.el.style.setProperty('--a', a.toFixed(3));
    if (a < bestDist) {
      bestDist = a;
      bestIndex = s.index;
    }
  }
  for (const dot of rail.children) {
    dot.classList.toggle('active', Number(dot.dataset.index) === bestIndex);
  }
}

function measureSections(scroller) {
  state.sections = [...scroller.querySelectorAll('.chart-section')].map((el) => ({
    el,
    index: Number(el.dataset.index),
    top: el.offsetTop,
    height: el.offsetHeight,
  }));
}

// Formulaire « Ajouter une mesure manuelle ». `onSaved` reçoit l'id du
// premier paramètre saisi.
export function openMeasureModal(onSaved) {
  const options = MANUAL_FORMS.map(
    (f) => `<option value="${f.id}">${escapeHtml(f.label)}</option>`
  ).join('');
  const modal = openModal(
    'Ajouter une mesure manuelle',
    `<form id="measure-form">
      <label>Paramètre
        <select name="form" required>${options}</select>
      </label>
      <div id="value-fields"></div>
      <label>Date et heure
        <input type="datetime-local" name="datetime" required value="${datetimeLocalValue(new Date())}">
      </label>
      <button type="submit" class="btn primary">Enregistrer</button>
    </form>`
  );

  const form = modal.querySelector('#measure-form');
  const valueFields = modal.querySelector('#value-fields');

  function renderValueFields() {
    const choice = MANUAL_FORMS.find((f) => f.id === form.elements.form.value);
    valueFields.innerHTML = choice.params
      .map((id) => {
        const p = PARAMS[id];
        return `<label>${escapeHtml(p.label)}${p.unit ? ` (${escapeHtml(p.unit)})` : ''}
          <input type="number" step="any" inputmode="decimal" name="value_${id}"
                 placeholder="${escapeHtml(p.placeholder)}" required>
        </label>`;
      })
      .join('');
  }
  renderValueFields();
  form.elements.form.addEventListener('change', renderValueFields);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const choice = MANUAL_FORMS.find((f) => f.id === form.elements.form.value);
    const when = new Date(form.elements.datetime.value);
    if (Number.isNaN(when.getTime())) {
      toast('Date invalide.', 'error');
      return;
    }
    const timestamp = isoWithOffset(when);
    const measurements = choice.params.map((id) => ({
      parameter: id,
      value: Number(form.elements[`value_${id}`].value),
      unit: PARAMS[id].unit || (id === 'ph' ? 'pH' : id === 'sg' ? 'sg' : ''),
      timestamp,
      source: 'manuel',
    }));
    if (measurements.some((m) => !Number.isFinite(m.value))) {
      toast('Valeur invalide.', 'error');
      return;
    }
    const submit = form.querySelector('button[type=submit]');
    submit.disabled = true;
    submit.textContent = 'Enregistrement…';
    try {
      await addManualMeasurements(measurements);
      modal.close();
      toast('Mesure enregistrée', 'success');
      if (onSaved) onSaved(choice.params[0]);
    } catch (err) {
      toast(err.message, 'error');
      submit.disabled = false;
      submit.textContent = 'Enregistrer';
    }
  });
}

function sectionHtml(slide, index, latest) {
  const value = latest[slide.id];
  const p = PARAMS[slide.id];
  const head =
    p && value && value.value !== undefined
      ? `<span class="sec-now">${fmtValue(value.value, p)}<i>${escapeHtml(p.unit)}</i></span>`
      : '';
  return `
    <section class="chart-section" data-index="${index}" data-slide="${slide.id}" style="--pc:${slide.color}">
      <div class="sec-head">
        <div>
          <div class="sec-title">${escapeHtml(slide.label)}</div>
          <div class="sec-sub">${escapeHtml(slide.sub || '')}</div>
        </div>
        ${head}
      </div>
      <div class="sec-body">
        ${slide.panels
          .map(
            (ids, i) => `<div class="sec-panel">
              <canvas data-panel="${i}"></canvas>
              <div class="chart-empty" data-empty="${i}" hidden>
                ${icon('waves', 26)}<span>Aucune donnée sur cette période</span>
              </div>
            </div>`
          )
          .join('')}
      </div>
    </section>`;
}

async function loadRange(el) {
  const { series, errors } = await loadMeasurements(state.rangeHours);
  state.series = series;
  if (errors > 0) toast('Certaines données n’ont pas pu être chargées.', 'warn');
  destroyCharts();
  // Réinstancie ce qui est à l'écran ; le reste suivra à l'approche.
  for (const s of state.sections) {
    const rect = s.el.getBoundingClientRect();
    if (rect.top < window.innerHeight * 1.5 && rect.bottom > -window.innerHeight * 0.5) {
      mountSection(s.el);
    }
  }
}

// Formulaire « Poser un marqueur » : une ligne verticale étiquetée sur tous
// les graphiques, pour repérer une intervention (changement d'eau, dosage…).
export function openMarkerModal(onSaved) {
  const modal = openModal(
    'Poser un marqueur',
    `<form id="marker-form">
      <label>Étiquette
        <input type="text" name="label" required maxlength="28" placeholder="Changement d'eau">
      </label>
      <label>Date et heure
        <input type="datetime-local" name="datetime" required value="${datetimeLocalValue(new Date())}">
      </label>
      <p class="hint">Le repère apparaît sur tous les graphiques. Retrouvez-le
      dans « Événements » pour le supprimer.</p>
      <button type="submit" class="btn primary">Poser le marqueur</button>
    </form>`
  );
  const form = modal.querySelector('#marker-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const when = new Date(form.elements.datetime.value);
    if (Number.isNaN(when.getTime())) {
      toast('Date invalide.', 'error');
      return;
    }
    const submit = form.querySelector('button[type=submit]');
    submit.disabled = true;
    submit.textContent = 'Enregistrement…';
    try {
      await addMarker({
        label: form.elements.label.value.trim(),
        timestamp: isoWithOffset(when),
      });
      modal.close();
      toast('Marqueur posé', 'success');
      if (onSaved) onSaved();
    } catch (err) {
      toast(err.message, 'error');
      submit.disabled = false;
      submit.textContent = 'Poser le marqueur';
    }
  });
}

export async function renderCharts(el, query) {
  teardown();
  const latest = await loadLatest().catch(() => ({}));

  el.classList.add('view-charts');
  el.innerHTML = `
    <div class="range-bar">
      ${RANGES.map(
        (r) => `<button type="button" class="range-btn" data-hours="${r.hours}">${r.label}</button>`
      ).join('')}
    </div>
    <div class="chart-scroller" id="scroller">
      ${SLIDES.map((s, i) => sectionHtml(s, i, latest)).join('')}
    </div>
    <div class="rail" id="rail">
      ${SLIDES.map(
        (s, i) =>
          `<button type="button" class="rail-dot" data-index="${i}" aria-label="${escapeHtml(s.label)}"></button>`
      ).join('')}
    </div>
    <button type="button" class="fab fab-pin" id="add-marker" aria-label="Poser un marqueur">
      ${icon('pin', 20)}
    </button>
    <button type="button" class="fab" id="add-measure" aria-label="Ajouter une mesure manuelle">
      ${icon('plus', 24)}
    </button>
    <div class="scroll-hint" id="scroll-hint">${icon('chevron-right', 16)} défilez</div>`;

  const scroller = el.querySelector('#scroller');
  const rail = el.querySelector('#rail');

  for (const btn of el.querySelectorAll('.range-btn')) {
    btn.classList.toggle('active', Number(btn.dataset.hours) === state.rangeHours);
    btn.addEventListener('click', async () => {
      if (Number(btn.dataset.hours) === state.rangeHours) return;
      state.rangeHours = Number(btn.dataset.hours);
      for (const b of el.querySelectorAll('.range-btn')) {
        b.classList.toggle('active', Number(b.dataset.hours) === state.rangeHours);
      }
      await loadRange(el).catch((err) => toast(err.message, 'error'));
    });
  }

  el.querySelector('#add-measure').addEventListener('click', () =>
    openMeasureModal((paramId) => {
      location.hash = `#/charts?p=${paramId}`;
      renderCharts(el, new URLSearchParams(`p=${paramId}`)).catch((e) => toast(e.message, 'error'));
    })
  );

  el.querySelector('#add-marker').addEventListener('click', () =>
    openMarkerModal(async () => {
      state.markers = await loadMarkers().catch(() => state.markers);
      for (const charts of state.charts.values()) {
        for (const c of charts) c.update('none');
      }
    })
  );

  rail.addEventListener('click', (e) => {
    const dot = e.target.closest('.rail-dot');
    if (!dot) return;
    const target = scroller.querySelector(`.chart-section[data-index="${dot.dataset.index}"]`);
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  // Charge séries et marqueurs, mesure la géométrie, puis arme les animations.
  const [{ series, errors }, markers] = await Promise.all([
    loadMeasurements(state.rangeHours),
    loadMarkers().catch(() => []),
  ]);
  state.series = series;
  state.markers = markers;
  if (errors > 0) toast('Certaines données n’ont pas pu être chargées.', 'warn');

  measureSections(scroller);

  state.observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) mountSection(entry.target);
      }
    },
    { root: scroller, rootMargin: '60% 0px' }
  );
  for (const s of state.sections) state.observer.observe(s.el);

  const hint = el.querySelector('#scroll-hint');
  let ticking = false;
  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      updateParallax(scroller, rail);
      ticking = false;
    });
    if (hint && scroller.scrollTop > 40) hint.classList.add('gone');
  };
  scroller.addEventListener('scroll', onScroll, { passive: true });
  state.onResize = () => {
    measureSections(scroller);
    updateParallax(scroller, rail);
  };
  window.addEventListener('resize', state.onResize);

  // Position initiale : la section demandée par l'Accueil, sinon la première.
  const wanted = SLIDES.findIndex((s) => s.id === query.get('p'));
  if (wanted > 0) {
    const target = state.sections.find((s) => s.index === wanted);
    if (target) scroller.scrollTop = target.top + target.height / 2 - scroller.clientHeight / 2;
  }
  updateParallax(scroller, rail);
  mountSection(state.sections[Math.max(0, wanted)].el);
}
