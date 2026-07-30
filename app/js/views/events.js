// Page Événements : calendrier de maintenance — événements à venir en
// premier, ajout via formulaire, marquage « fait » et suppression.
import { loadEvents, addEvent, setEventStatus, deleteEvent } from '../store.js';
import { escapeHtml, toast, openModal, fmtCountdown } from '../ui.js';
import { icon } from '../icons.js';

const MONTHS = ['jan', 'fév', 'mar', 'avr', 'mai', 'juin', 'juil', 'août', 'sep', 'oct', 'nov', 'déc'];

function eventCard(evt, { past, index }) {
  const d = new Date(`${evt.date}T00:00:00`);
  return `
    <div class="card event-card ${past ? 'event-past' : ''}" data-id="${escapeHtml(evt.id)}" style="--i:${index}">
      <div class="date-badge">
        <span class="db-day">${d.getDate()}</span>
        <span class="db-month">${MONTHS[d.getMonth()]}</span>
      </div>
      <div class="event-main">
        <div class="event-name">${escapeHtml(evt.name)}${evt.status === 'done' ? ' ✓' : ''}</div>
        <div class="event-date">${escapeHtml(fmtCountdown(evt.date))}${d.getFullYear() !== new Date().getFullYear() ? ` · ${d.getFullYear()}` : ''}</div>
        ${evt.note ? `<div class="event-note">${escapeHtml(evt.note)}</div>` : ''}
      </div>
      <div class="event-actions">
        ${evt.status !== 'done' ? `<button type="button" class="icon-btn act-done" title="Marquer comme fait">${icon('check', 18)}</button>` : ''}
        <button type="button" class="icon-btn act-delete" title="Supprimer">${icon('trash', 17)}</button>
      </div>
    </div>`;
}

function openEventModal(onSaved) {
  const today = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const todayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  const modal = openModal(
    'Ajouter un événement',
    `<form id="event-form">
      <label>Nom
        <input type="text" name="name" required maxlength="80" placeholder="Changement d'eau">
      </label>
      <label>Date
        <input type="date" name="date" required value="${todayStr}">
      </label>
      <label>Note (optionnelle)
        <textarea name="note" rows="3" maxlength="500" placeholder="20 L, sel Red Sea…"></textarea>
      </label>
      <button type="submit" class="btn primary">Ajouter</button>
    </form>`
  );
  const form = modal.querySelector('#event-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submit = form.querySelector('button[type=submit]');
    submit.disabled = true;
    submit.textContent = 'Ajout…';
    try {
      await addEvent({
        name: form.elements.name.value.trim(),
        date: form.elements.date.value,
        note: form.elements.note.value.trim(),
      });
      modal.close();
      toast('Événement ajouté ✓', 'success');
      onSaved();
    } catch (err) {
      toast(err.message, 'error');
      submit.disabled = false;
      submit.textContent = 'Ajouter';
    }
  });
}

export async function renderEvents(el) {
  const events = await loadEvents();
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

  const upcoming = events
    .filter((e) => e.status !== 'done' && e.date >= todayStr)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  const past = events
    .filter((e) => e.status === 'done' || e.date < todayStr)
    .sort((a, b) => (a.date > b.date ? -1 : 1));

  el.innerHTML = `
    <div class="events-page">
      <button type="button" class="btn primary" id="add-event">${icon('plus', 18)} Ajouter un événement</button>
      <section>
        <h2>À venir</h2>
        ${upcoming.length ? upcoming.map((e, i) => eventCard(e, { past: false, index: i })).join('') : '<div class="empty-hint card">Aucun événement planifié</div>'}
      </section>
      ${
        past.length
          ? `<section>
              <details>
                <summary>Passés / terminés (${past.length})</summary>
                ${past.map((e, i) => eventCard(e, { past: true, index: i })).join('')}
              </details>
            </section>`
          : ''
      }
    </div>`;

  const rerender = () => renderEvents(el).catch((e) => toast(e.message, 'error'));

  el.querySelector('#add-event').addEventListener('click', () => openEventModal(rerender));

  el.addEventListener('click', async (e) => {
    const card = e.target.closest('.event-card');
    if (!card) return;
    const id = card.dataset.id;
    try {
      if (e.target.closest('.act-done')) {
        await setEventStatus(id, 'done');
        toast('Événement terminé ✓', 'success');
        rerender();
      } else if (e.target.closest('.act-delete')) {
        const name = card.querySelector('.event-name').textContent.trim();
        if (confirm(`Supprimer « ${name} » ?`)) {
          await deleteEvent(id);
          toast('Événement supprimé', 'info');
          rerender();
        }
      }
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}
