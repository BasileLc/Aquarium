// Point d'entrée : routeur par hash + enregistrement du service worker.
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

let renderSeq = 0;

async function route() {
  const { name, query } = parseHash();
  const seq = ++renderSeq;

  for (const link of document.querySelectorAll('.tabbar a')) {
    link.classList.toggle('active', link.dataset.route === name);
  }

  const view = document.getElementById('view');
  view.innerHTML = '<div class="loading">Chargement…</div>';
  try {
    await routes[name](view, query);
  } catch (err) {
    if (seq !== renderSeq) return; // une navigation plus récente a pris la main
    view.innerHTML = `
      <div class="card error-box">
        <h2>Impossible de charger les données</h2>
        <p>${escapeHtml(err.message)}</p>
        <p class="hint">Vérifiez la connexion Internet, puis réessayez avec le bouton ⟳.</p>
      </div>`;
  }
}

window.addEventListener('hashchange', route);

document.getElementById('refresh-btn').addEventListener('click', () => {
  clearCache();
  route();
});

route();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {
    /* hors ligne ou contexte non sécurisé : l'app fonctionne sans. */
  });
}
