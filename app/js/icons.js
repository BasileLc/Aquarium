// Icônes SVG inline (style trait 2px, currentColor) — pas d'emoji, pas de
// fonte d'icônes : léger, net à toutes les tailles et colorable en CSS.
const PATHS = {
  home: '<path d="M3 10.8 12 3l9 7.8"/><path d="M5.5 9.6V21h13V9.6"/>',
  chart: '<path d="M3 3v18h18"/><path d="m7.5 14.5 3.5-4.5 3 3 4.5-6"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="16" rx="2.5"/><path d="M8 3v4M16 3v4M3.5 11h17"/>',
  sliders: '<path d="M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-9-9c2.5 0 4.8 1 6.6 2.6L21 8"/><path d="M21 3v5h-5"/>',
  plus: '<path d="M5 12h14M12 5v14"/>',
  'chevron-left': '<path d="m15 18-6-6 6-6"/>',
  'chevron-right': '<path d="m9 18 6-6-6-6"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  droplet: '<path d="M12 2.7c3.6 4 6.5 7.2 6.5 10.5a6.5 6.5 0 1 1-13 0C5.5 9.9 8.4 6.7 12 2.7z"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h16.9a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  'trend-up': '<path d="m4 17 6-6 4 4 6-7"/><path d="M15 8h5v5"/>',
  'trend-down': '<path d="m4 7 6 6 4-4 6 7"/><path d="M15 16h5v-5"/>',
  waves: '<path d="M2 8c2.5-2.6 5.5-2.6 8 0s5.5 2.6 8 0 3-1.6 4-.8"/><path d="M2 14c2.5-2.6 5.5-2.6 8 0s5.5 2.6 8 0 3-1.6 4-.8"/><path d="M2 20c2.5-2.6 5.5-2.6 8 0s5.5 2.6 8 0 3-1.6 4-.8"/>',
};

export function icon(name, size = 20, cls = '') {
  return `<svg class="icon ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
    stroke-linejoin="round" aria-hidden="true">${PATHS[name] || ''}</svg>`;
}
