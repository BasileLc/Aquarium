// Configuration de l'application.
// Le repo GitHub sert de base de données : l'app lit et écrit les fichiers
// JSON du dossier data/ via l'API GitHub.
export const CONFIG = {
  owner: 'BasileLc',
  repo: 'Aquarium',
  branch: 'main',
};

// Registre des paramètres suivis.
// `source` : 'apex' = relevé automatiquement par le poller ; 'manuel' = saisi dans l'app.
//
// Palette « océan & corail » : une seule gamme, des froids marins (turquoise,
// cyan, azur, bleu, indigo) aux coraux (orange, rose, magenta, violet).
// `grad` est le dégradé de l'arc de jauge, `color` la teinte de la courbe.
// Validée sur --surface #142639 : contraste ≥ 3:1 pour les dix teintes, et
// chaque paire réellement affichée ensemble au-delà des seuils daltonisme
// (NH₃/NO₂ dans la même légende : ΔE 25,8 en protanopie).
export const PARAMS = {
  temp:     { label: 'Température', short: 'Temp', unit: '°C',  source: 'apex',   color: '#fb7185', grad: ['#fb923c', '#fb7185'], decimals: 1, placeholder: '25.0' },
  ph:       { label: 'pH',          short: 'pH',   unit: '',    source: 'apex',   color: '#2dd4bf', grad: ['#5eead4', '#2dd4bf'], decimals: 2, placeholder: '8.20' },
  orp:      { label: 'ORP',         short: 'ORP',  unit: 'mV',  source: 'apex',   color: '#a78bfa', grad: ['#818cf8', '#a78bfa'], decimals: 0, placeholder: '350' },
  no3:      { label: 'Nitrates',    short: 'NO₃',  unit: 'ppm', source: 'apex',   color: '#22d3ee', grad: ['#38bdf8', '#22d3ee'], decimals: 1, placeholder: '5.0' },
  po4:      { label: 'Phosphates',  short: 'PO₄',  unit: 'ppm', source: 'apex',   color: '#c084fc', grad: ['#e879f9', '#c084fc'], decimals: 2, placeholder: '0.03' },
  nh3:      { label: 'Ammoniaque',  short: 'NH₃',  unit: 'ppm', source: 'manuel', color: '#60a5fa', grad: ['#38bdf8', '#60a5fa'], decimals: 2, placeholder: '0.00' },
  no2:      { label: 'Nitrites',    short: 'NO₂',  unit: 'ppb', source: 'manuel', color: '#fb923c', grad: ['#fbbf24', '#fb923c'], decimals: 0, placeholder: '20' },
  alk:      { label: 'Alcalinité',  short: 'KH',   unit: 'dKH', source: 'manuel', color: '#e879f9', grad: ['#f0abfc', '#e879f9'], decimals: 1, placeholder: '8.5' },
  salinity: { label: 'Salinité',    short: 'Sal.', unit: 'ppt', source: 'manuel', color: '#818cf8', grad: ['#60a5fa', '#818cf8'], decimals: 1, placeholder: '35.0' },
  sg:       { label: 'Densité',     short: 'SG',   unit: '',    source: 'manuel', color: '#5eead4', grad: ['#7dd3fc', '#5eead4'], decimals: 3, placeholder: '1.026' },
};

// Graphes combinés : des panneaux à axe Y unique, empilés et alignés sur le
// même axe temps (jamais de double axe Y sur un même panneau).
export const COMBINED = [
  { id: 'nitrogen',  label: 'Azote', sub: 'NH₃ · NO₂ · NO₃', panels: [['nh3'], ['no2'], ['no3']] },
  { id: 'nutrients', label: 'Nutriments', sub: 'NO₃ · PO₄',  panels: [['no3'], ['po4']] },
];

// Choix proposés par le formulaire « Ajouter une mesure manuelle ».
// La salinité et la densité SG sont saisies ensemble (même mesure).
export const MANUAL_FORMS = [
  { id: 'nh3',         label: 'Ammoniaque (NH₃)',    params: ['nh3'] },
  { id: 'no2',         label: 'Nitrites (NO₂)',      params: ['no2'] },
  { id: 'alk',         label: 'Alcalinité (dKH)',    params: ['alk'] },
  { id: 'salinity_sg', label: 'Salinité + Densité',  params: ['salinity', 'sg'] },
];

// Plages de temps proposées sur la page Graphiques (24 h par défaut).
export const RANGES = [
  { hours: 24,      label: '24 h' },
  { hours: 48,      label: '48 h' },
  { hours: 24 * 7,  label: '7 j' },
  { hours: 24 * 30, label: '30 j' },
];

// Fenêtre de référence des jauges du tableau de bord (min/max affichés).
export const GAUGE_HOURS = 12;

// Au-delà de ce délai sans relevé Apex, la valeur est signalée comme périmée.
// (45 min = ~4 intervalles de 10 min, avec de la marge.)
export const STALE_MS = 45 * 60 * 1000;
