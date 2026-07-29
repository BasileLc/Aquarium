// Client GitHub minimal : lecture/écriture de fichiers du repo via l'API
// Contents. Sans token, la lecture passe par raw.githubusercontent.com
// (cache CDN ~5 min, pas de quota) ; avec token, par l'API (données fraîches).
import { CONFIG } from './config.js';

const API = 'https://api.github.com';
const TOKEN_KEY = 'aquarium_gh_token';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || '';
}

export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token.trim());
  else localStorage.removeItem(TOKEN_KEY);
}

function encodePath(path) {
  return path.split('/').map(encodeURIComponent).join('/');
}

function contentsUrl(path) {
  return `${API}/repos/${CONFIG.owner}/${CONFIG.repo}/contents/${encodePath(path)}`;
}

function apiHeaders(extra = {}) {
  const headers = { 'X-GitHub-Api-Version': '2022-11-28', ...extra };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

// Lit un fichier texte du repo. Retourne null si le fichier n'existe pas.
export async function readFile(path) {
  let res;
  if (getToken()) {
    res = await fetch(`${contentsUrl(path)}?ref=${CONFIG.branch}`, {
      headers: apiHeaders({ Accept: 'application/vnd.github.raw+json' }),
      cache: 'no-store',
    });
  } else {
    res = await fetch(
      `https://raw.githubusercontent.com/${CONFIG.owner}/${CONFIG.repo}/${CONFIG.branch}/${encodePath(path)}`,
      { cache: 'no-store' }
    );
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub a répondu ${res.status} pour ${path}`);
  return res.text();
}

export async function readJson(path, fallback = null) {
  const text = await readFile(path);
  if (text === null) return fallback;
  return JSON.parse(text);
}

async function getSha(path) {
  const res = await fetch(`${contentsUrl(path)}?ref=${CONFIG.branch}`, {
    headers: apiHeaders({ Accept: 'application/vnd.github+json' }),
    cache: 'no-store',
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub a répondu ${res.status} pour ${path}`);
  const json = await res.json();
  return json.sha;
}

function b64encodeUtf8(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

// Écrit (crée ou remplace) un fichier JSON dans le repo, avec reprise en cas
// de conflit de sha (écriture concurrente du poller ou d'un autre appareil).
export async function writeJson(path, data, message) {
  if (!getToken()) {
    throw new Error('Token GitHub manquant : configurez-le dans Réglages.');
  }
  const content = b64encodeUtf8(JSON.stringify(data, null, 1) + '\n');
  let lastError = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    const sha = await getSha(path);
    const body = { message, content, branch: CONFIG.branch };
    if (sha) body.sha = sha;
    const res = await fetch(contentsUrl(path), {
      method: 'PUT',
      headers: apiHeaders({ Accept: 'application/vnd.github+json' }),
      body: JSON.stringify(body),
    });
    if (res.ok) return;
    lastError = `${res.status} ${(await res.json().catch(() => ({}))).message || ''}`;
    // 409/422 : sha périmé (quelqu'un a écrit entre-temps) → on réessaie.
    if (res.status !== 409 && res.status !== 422) break;
  }
  throw new Error(`Écriture GitHub impossible sur ${path} : ${lastError}`);
}

// Vérifie le token : accès au repo + droit d'écriture. Retourne un descriptif.
export async function checkAccess() {
  const res = await fetch(`${API}/repos/${CONFIG.owner}/${CONFIG.repo}`, {
    headers: apiHeaders({ Accept: 'application/vnd.github+json' }),
    cache: 'no-store',
  });
  if (res.status === 401) throw new Error('Token invalide ou expiré.');
  if (res.status === 404) throw new Error('Repo introuvable avec ce token (vérifiez son périmètre).');
  if (!res.ok) throw new Error(`GitHub a répondu ${res.status}.`);
  const repo = await res.json();
  return {
    fullName: repo.full_name,
    canWrite: Boolean(repo.permissions && repo.permissions.push),
  };
}
