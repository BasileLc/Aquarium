// Page Réglages : token GitHub (nécessaire pour écrire les mesures manuelles
// et les événements ; en lecture, l'app fonctionne sans token via le CDN raw).
import { CONFIG } from '../config.js';
import { getToken, setToken, checkAccess } from '../github.js';
import { clearCache } from '../store.js';
import { escapeHtml, toast } from '../ui.js';

export async function renderSettings(el) {
  const repoUrl = `https://github.com/${CONFIG.owner}/${CONFIG.repo}`;
  el.innerHTML = `
    <div class="settings-page">
      <section class="card">
        <h2>Token GitHub</h2>
        <p class="hint">
          Requis pour ajouter des mesures manuelles et des événements
          (écriture dans <a href="${repoUrl}" target="_blank" rel="noopener">${escapeHtml(`${CONFIG.owner}/${CONFIG.repo}`)}</a>).
          Sans token, l'app reste consultable en lecture (données rafraîchies
          avec ~5 min de délai).
        </p>
        <label>Fine-grained personal access token
          <input type="password" id="token-input" autocomplete="off"
                 placeholder="github_pat_…" value="${escapeHtml(getToken())}">
        </label>
        <div class="btn-row">
          <button type="button" class="btn primary" id="save-token">Enregistrer</button>
          <button type="button" class="btn" id="test-token">Tester</button>
          <button type="button" class="btn danger" id="clear-token">Effacer</button>
        </div>
        <div id="token-status" class="hint"></div>
        <details>
          <summary>Comment créer le token ?</summary>
          <ol class="hint">
            <li>GitHub → Settings → Developer settings → <em>Fine-grained tokens</em> → Generate new token.</li>
            <li><em>Repository access</em> : « Only select repositories » → <strong>${escapeHtml(`${CONFIG.owner}/${CONFIG.repo}`)}</strong>.</li>
            <li><em>Permissions → Repository permissions → Contents</em> : <strong>Read and write</strong>. Rien d'autre.</li>
            <li>Choisissez la durée maximale, générez, puis collez le token ci-dessus.</li>
          </ol>
          <p class="hint">Le token n'est stocké que dans ce navigateur (localStorage), jamais dans le repo.</p>
        </details>
      </section>
      <section class="card">
        <h2>Données</h2>
        <p class="hint">
          Source : branche <code>${escapeHtml(CONFIG.branch)}</code> de
          <code>${escapeHtml(`${CONFIG.owner}/${CONFIG.repo}`)}</code>, dossier <code>data/</code>.
          Les relevés Apex sont poussés par le poller installé sur le PC Ubuntu
          (voir le README du repo).
        </p>
        <button type="button" class="btn" id="clear-cache">Vider le cache local et recharger</button>
      </section>
    </div>`;

  const input = el.querySelector('#token-input');
  const status = el.querySelector('#token-status');

  el.querySelector('#save-token').addEventListener('click', () => {
    setToken(input.value);
    clearCache();
    toast(input.value.trim() ? 'Token enregistré ✓' : 'Token effacé', 'success');
  });

  el.querySelector('#clear-token').addEventListener('click', () => {
    input.value = '';
    setToken('');
    clearCache();
    toast('Token effacé', 'info');
  });

  el.querySelector('#test-token').addEventListener('click', async () => {
    setToken(input.value);
    status.textContent = 'Test en cours…';
    try {
      const access = await checkAccess();
      status.textContent = access.canWrite
        ? `✓ Accès en écriture à ${access.fullName} : tout est bon.`
        : `⚠️ Accès à ${access.fullName} en lecture seule — la permission « Contents: Read and write » manque.`;
    } catch (err) {
      status.textContent = `✕ ${err.message}`;
    }
  });

  el.querySelector('#clear-cache').addEventListener('click', () => {
    clearCache();
    location.reload();
  });
}
