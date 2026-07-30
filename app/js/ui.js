// Petits utilitaires d'interface : toasts, modales, formatage.
import { icon } from './icons.js';

export function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function toast(message, type = 'info') {
  const host = document.getElementById('toast');
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = message;
  host.appendChild(el);
  setTimeout(() => el.classList.add('show'), 10);
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, 3500);
}

// Ouvre une modale contenant `bodyHtml` ; retourne l'élément racine.
// La modale se ferme via le bouton ✕, la touche Échap ou un clic sur le fond.
export function openModal(title, bodyHtml) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
      <div class="modal-head">
        <h3>${escapeHtml(title)}</h3>
        <button type="button" class="icon-btn modal-close" aria-label="Fermer">${icon('x', 18)}</button>
      </div>
      <div class="modal-body">${bodyHtml}</div>
    </div>`;
  const close = () => {
    document.removeEventListener('keydown', onKey);
    overlay.remove();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
  };
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  overlay.querySelector('.modal-close').addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);
  overlay.close = close;
  return overlay;
}

const pad = (n) => String(n).padStart(2, '0');

// ISO 8601 local avec décalage horaire, ex. 2026-07-29T14:05:00+02:00
// (même format que le poller, pour des fichiers homogènes).
export function isoWithOffset(date) {
  const offsetMin = -date.getTimezoneOffset();
  const sign = offsetMin >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMin);
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

// Valeur pour l'attribut value d'un <input type="date">.
export function dateInputValue(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Valeur pour l'attribut value d'un <input type="datetime-local">.
export function datetimeLocalValue(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function fmtValue(value, param) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return Number(value).toLocaleString('fr-FR', {
    minimumFractionDigits: param.decimals,
    maximumFractionDigits: param.decimals,
  });
}

export function fmtClock(ts) {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// « à 14:05 », « hier à 14:05 », « 12/07 à 14:05 » selon l'ancienneté.
// `dayOnly` : sans l'heure — pour les tests manuels, qui ne sont datés qu'au
// jour (« aujourd'hui », « hier », « 12/07 »).
export function fmtWhen(ts, dayOnly = false) {
  const d = new Date(ts);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((today - day) / 86400000);
  const date = `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
  if (dayOnly) {
    if (diffDays === 0) return "aujourd'hui";
    if (diffDays === 1) return 'hier';
    return date;
  }
  const clock = fmtClock(d);
  if (diffDays === 0) return `à ${clock}`;
  if (diffDays === 1) return `hier à ${clock}`;
  return `${date} à ${clock}`;
}

const DAY_NAMES = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
const MONTH_NAMES = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

// « sam. 2 août » (+ année si différente de l'année en cours).
export function fmtDateHuman(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  const base = `${DAY_NAMES[d.getDay()]} ${d.getDate()} ${MONTH_NAMES[d.getMonth()]}`;
  return d.getFullYear() === new Date().getFullYear() ? base : `${base} ${d.getFullYear()}`;
}

// « aujourd'hui », « demain », « dans 5 j », « il y a 3 j ».
export function fmtCountdown(dateStr) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(`${dateStr}T00:00:00`);
  const diff = Math.round((target - today) / 86400000);
  if (diff === 0) return "aujourd'hui";
  if (diff === 1) return 'demain';
  if (diff > 1) return `dans ${diff} j`;
  if (diff === -1) return 'hier';
  return `il y a ${-diff} j`;
}
