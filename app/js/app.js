// Point d'entrée : routeur par hash, transitions de vues et service worker.
import { renderHome } from './views/home.js';
import { renderCharts } from './views/charts.js';
import { renderEvents } from './views/events.js';
import { renderSettings } from './views/settings.js';
import { clearCache } from './store.js';
import { escapeHtml } from './ui.js';

const routes = {
  home: renderHome,
  charts: renderCharts,
  events: renderEvents,
  settings: renderSettings,
};

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, qs] = raw.split('?');
  return { name: routes[path] ? path : 'home', query: new URLSearchParams(qs || '') };
}

const SKELETON = `
  <div class="loading" aria-label="Chargement">
    <div class="sk-bar"></div>
    <div class="sk-row">
      <div class="sk-card"></div><div class="sk-card"></div>
      <div class="sk-card"></div><div class="sk-card"></div>
    </div>
  </div>`;

let renderSeq = 0;

async function route() {
  const { name, query } = parseHash();
  const seq = ++renderSeq;

  for (const link of document.querySelectorAll('.tabbar a')) {
    link.classList.toggle('active', link.dataset.route === name);
  }

  const view = document.getElementById('view');
  view.classList.remove('view-enter');
  view.innerHTML = SKELETON;
  try {
    await routes[name](view, query);
    if (seq !== renderSeq) return;
  } catch (err) {
    if (seq !== renderSeq) return; // une navigation plus récente a pris la main
    view.innerHTML = `
      <div class="card error-box">
        <h2>Impossible de charger les données</h2>
        <p>${escapeHtml(err.message)}</p>
        <p class="hint">Vérifiez la connexion Internet, puis réessayez avec le bouton ⟳.</p>
      </div>`;
  }
  // Rejoue l'animation d'entrée de vue (le reflow force le redémarrage).
  void view.offsetWidth;
  view.classList.add('view-enter');
}

window.addEventListener('hashchange', route);

const refreshBtn = document.getElementById('refresh-btn');
refreshBtn.addEventListener('click', async () => {
  refreshBtn.classList.add('spinning');
  clearCache();
  try {
    await route();
  } finally {
    refreshBtn.classList.remove('spinning');
  }
});

route();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {
    /* hors ligne ou contexte non sécurisé : l'app fonctionne sans. */
  });
}
