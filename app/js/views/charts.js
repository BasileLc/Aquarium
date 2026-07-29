// Page Graphiques : un graphe par paramètre + graphes combinés (panneaux
// empilés sur le même axe temps), navigation par swipe/flèches, plage de
// temps réglable (24 h par défaut) et saisie de mesures manuelles.
import { PARAMS, COMBINED, MANUAL_FORMS, RANGES } from '../config.js';
import { loadMeasurements, addManualMeasurements } from '../store.js';
import {
  escapeHtml,
  toast,
  openModal,
  fmtValue,
  isoWithOffset,
  datetimeLocalValue,
} from '../ui.js';

const SLIDES = [
  ...Object.keys(PARAMS).map((id) => ({ type: 'param', id, label: PARAMS[id].label, panels: [[id]] })),
  ...COMBINED.map((c) => ({ type: 'combined', ...c })),
];

const CHROME = {
  text: '#b6c4cf',
  muted: '#8b98a5',
  grid: '#24313f',
  axis: '#33455a',
  tooltipBg: '#1d2c3c',
};

const state = {
  index: 0,
  rangeHours: 24,
  charts: [],
};

const pad = (n) => String(n).padStart(2, '0');

function fmtTick(ms, rangeHours) {
  const d = new Date(ms);
  if (rangeHours <= 24) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
}

function fmtTooltipTitle(ms) {
  const d = new Date(ms);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Graduations de l'axe temps à heures/jours ronds : toutes les 6 h en vue
// 24 h, chaque jour en vue 7 j, tous les 5 jours en vue 30 j.
function buildTimeTicks(min, max, rangeHours) {
  const ticks = [];
  const cursor = new Date(min);
  cursor.setMinutes(0, 0, 0);
  if (rangeHours <= 24) {
    cursor.setHours(cursor.getHours() - (cursor.getHours() % 6));
    let t = cursor.getTime();
    while (t <= max) {
      if (t >= min) ticks.push(t);
      t += 6 * 3600 * 1000;
    }
  } else {
    cursor.setHours(0, 0, 0, 0);
    const stepDays = rangeHours <= 24 * 7 ? 1 : 5;
    while (cursor.getTime() <= max) {
      if (cursor.getTime() >= min) ticks.push(cursor.getTime());
      cursor.setDate(cursor.getDate() + stepDays);
    }
  }
  return ticks;
}

function destroyCharts() {
  for (const c of state.charts) c.destroy();
  state.charts = [];
}

function buildPanel(canvas, paramIds, series, rangeHours) {
  const now = Date.now();
  const min = now - rangeHours * 3600 * 1000;
  const multi = paramIds.length > 1;
  const datasets = paramIds.map((id) => {
    const p = PARAMS[id];
    const dense = p.source === 'apex';
    return {
      label: p.short,
      data: series[id] || [],
      borderColor: p.color,
      backgroundColor: p.color,
      borderWidth: 2,
      pointRadius: dense ? 0 : 3.5,
      pointHoverRadius: 5,
      pointHitRadius: 10,
      tension: 0.25,
      // Coupe la ligne Apex si le poller a été absent > 45 min ;
      // relie toujours les points manuels (mesures espacées).
      spanGaps: dense ? 45 * 60 * 1000 : true,
    };
  });

  const unit = PARAMS[paramIds[0]].unit;

  // Bornes Y : marge de 12 % autour des données, sans jamais descendre sous
  // zéro pour des grandeurs positives (ppm, dKH…). Les données négatives
  // réelles (ex. ORP) restent affichées telles quelles.
  let dataMin = Infinity;
  let dataMax = -Infinity;
  for (const id of paramIds) {
    for (const point of series[id] || []) {
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
  const chart = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: { datasets },
    options: {
      animation: false,
      responsive: true,
      maintainAspectRatio: false,
      parsing: false,
      normalized: true,
      interaction: { mode: 'nearest', axis: 'x', intersect: false },
      scales: {
        x: {
          type: 'linear',
          min,
          max: now,
          border: { color: CHROME.axis },
          grid: { color: CHROME.grid, drawTicks: false },
          afterBuildTicks: (axis) => {
            axis.ticks = buildTimeTicks(axis.min, axis.max, rangeHours).map((value) => ({ value }));
          },
          ticks: {
            color: CHROME.muted,
            maxRotation: 0,
            callback: (v) => fmtTick(v, rangeHours),
          },
        },
        y: {
          border: { color: CHROME.axis },
          grid: { color: CHROME.grid, drawTicks: false },
          suggestedMin,
          suggestedMax,
          title: {
            display: Boolean(unit),
            text: unit,
            color: CHROME.muted,
            font: { size: 11 },
          },
          ticks: { color: CHROME.muted, maxTicksLimit: 6 },
        },
      },
      plugins: {
        legend: {
          display: multi,
          labels: { color: CHROME.text, usePointStyle: true, pointStyle: 'line', boxHeight: 8 },
        },
        tooltip: {
          backgroundColor: CHROME.tooltipBg,
          titleColor: '#eef4f8',
          bodyColor: CHROME.text,
          borderColor: 'rgba(255,255,255,0.12)',
          borderWidth: 1,
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
  state.charts.push(chart);
}

async function drawSlide(root) {
  const slide = SLIDES[state.index];
  root.querySelector('#chart-title').textContent = slide.label;
  root.querySelector('#slide-pos').textContent = `${state.index + 1} / ${SLIDES.length}`;
  history.replaceState(null, '', `#/charts?p=${slide.id}`);

  for (const dot of root.querySelectorAll('.dot')) {
    dot.classList.toggle('active', Number(dot.dataset.index) === state.index);
  }
  for (const btn of root.querySelectorAll('.range-btn')) {
    btn.classList.toggle('active', Number(btn.dataset.hours) === state.rangeHours);
  }

  destroyCharts();
  const host = root.querySelector('#panels');
  host.innerHTML = '<div class="chart-loading">Chargement des données…</div>';

  const { series, errors } = await loadMeasurements(state.rangeHours);
  // L'utilisateur a pu changer de slide pendant le chargement.
  if (SLIDES[state.index] !== slide) return;
  if (errors > 0) toast('Certaines données n’ont pas pu être chargées.', 'warn');

  const hasData = slide.panels.some((ids) => ids.some((id) => (series[id] || []).length > 0));
  host.innerHTML = slide.panels
    .map(
      (ids, i) => `
      <div class="panel ${slide.panels.length > 1 ? 'panel-half' : 'panel-full'}">
        <canvas id="panel-canvas-${i}"></canvas>
      </div>`
    )
    .join('');
  if (!hasData) {
    host.insertAdjacentHTML(
      'beforeend',
      '<div class="chart-empty">Aucune donnée sur cette période</div>'
    );
  }
  slide.panels.forEach((ids, i) => {
    buildPanel(host.querySelector(`#panel-canvas-${i}`), ids, series, state.rangeHours);
  });
}

function goTo(root, index) {
  state.index = (index + SLIDES.length) % SLIDES.length;
  drawSlide(root).catch((e) => toast(e.message, 'error'));
}

// Formulaire « Ajouter une mesure manuelle ». `onSaved` est appelé après
// enregistrement avec l'id du premier paramètre saisi.
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
      toast('Mesure enregistrée ✓', 'success');
      if (onSaved) onSaved(choice.params[0]);
    } catch (err) {
      toast(err.message, 'error');
      submit.disabled = false;
      submit.textContent = 'Enregistrer';
    }
  });
}

export async function renderCharts(el, query) {
  const wanted = query.get('p');
  const found = SLIDES.findIndex((s) => s.id === wanted);
  if (found >= 0) state.index = found;
  if (state.index >= SLIDES.length) state.index = 0;

  el.innerHTML = `
    <div class="charts-page">
      <div class="chart-nav">
        <button type="button" class="icon-btn" id="prev-slide" aria-label="Graphe précédent">‹</button>
        <div class="chart-heading">
          <div id="chart-title" class="chart-title"></div>
          <div id="slide-pos" class="slide-pos"></div>
        </div>
        <button type="button" class="icon-btn" id="next-slide" aria-label="Graphe suivant">›</button>
      </div>
      <div class="dots" id="dots">
        ${SLIDES.map(
          (s, i) =>
            `<button type="button" class="dot" data-index="${i}" aria-label="${escapeHtml(s.label)}"></button>`
        ).join('')}
      </div>
      <div class="range-picker">
        ${RANGES.map(
          (r) =>
            `<button type="button" class="range-btn" data-hours="${r.hours}">${r.label}</button>`
        ).join('')}
      </div>
      <div id="panels" class="panels"></div>
      <button type="button" class="btn primary" id="add-measure">＋ Ajouter une mesure manuelle</button>
    </div>`;

  el.querySelector('#prev-slide').addEventListener('click', () => goTo(el, state.index - 1));
  el.querySelector('#next-slide').addEventListener('click', () => goTo(el, state.index + 1));
  el.querySelector('#dots').addEventListener('click', (e) => {
    const dot = e.target.closest('.dot');
    if (dot) goTo(el, Number(dot.dataset.index));
  });
  for (const btn of el.querySelectorAll('.range-btn')) {
    btn.addEventListener('click', () => {
      state.rangeHours = Number(btn.dataset.hours);
      drawSlide(el).catch((err) => toast(err.message, 'error'));
    });
  }
  el.querySelector('#add-measure').addEventListener('click', () =>
    openMeasureModal((paramId) => {
      const i = SLIDES.findIndex((s) => s.id === paramId);
      goTo(el, i >= 0 ? i : state.index);
    })
  );

  // Navigation par swipe (mobile) et flèches (clavier).
  const panels = el.querySelector('#panels');
  let touchX = 0;
  let touchY = 0;
  panels.addEventListener(
    'touchstart',
    (e) => {
      touchX = e.touches[0].clientX;
      touchY = e.touches[0].clientY;
    },
    { passive: true }
  );
  panels.addEventListener(
    'touchend',
    (e) => {
      const dx = e.changedTouches[0].clientX - touchX;
      const dy = e.changedTouches[0].clientY - touchY;
      if (Math.abs(dx) > 60 && Math.abs(dx) > 2 * Math.abs(dy)) {
        goTo(el, state.index + (dx < 0 ? 1 : -1));
      }
    },
    { passive: true }
  );
  const onKey = (e) => {
    if (!document.body.contains(el)) {
      document.removeEventListener('keydown', onKey);
      return;
    }
    if (e.key === 'ArrowLeft') goTo(el, state.index - 1);
    if (e.key === 'ArrowRight') goTo(el, state.index + 1);
  };
  document.addEventListener('keydown', onKey);

  await drawSlide(el);
}
