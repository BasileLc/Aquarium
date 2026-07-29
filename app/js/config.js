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
// Les couleurs viennent d'une palette validée (contraste et daltonisme) pour la
// surface sombre de l'app — les paramètres affichés sur un même graphe combiné
// utilisent des slots mutuellement compatibles.
export const PARAMS = {
  temp:     { label: 'Température',      short: 'Temp', unit: '°C',  source: 'apex',   color: '#e66767', decimals: 1, placeholder: '25.0' },
  ph:       { label: 'pH',               short: 'pH',   unit: '',    source: 'apex',   color: '#008300', decimals: 2, placeholder: '8.20' },
  orp:      { label: 'ORP',              short: 'ORP',  unit: 'mV',  source: 'apex',   color: '#9085e9', decimals: 0, placeholder: '350' },
  no3:      { label: 'Nitrates (NO₃)',   short: 'NO₃',  unit: 'ppm', source: 'apex',   color: '#199e70', decimals: 1, placeholder: '5.0' },
  po4:      { label: 'Phosphates (PO₄)', short: 'PO₄',  unit: 'ppm', source: 'apex',   color: '#c98500', decimals: 2, placeholder: '0.03' },
  nh3:      { label: 'Ammoniaque (NH₃)', short: 'NH₃',  unit: 'ppm', source: 'manuel', color: '#3987e5', decimals: 2, placeholder: '0.00' },
  no2:      { label: 'Nitrites (NO₂)',   short: 'NO₂',  unit: 'ppm', source: 'manuel', color: '#d95926', decimals: 2, placeholder: '0.00' },
  alk:      { label: 'Alcalinité',       short: 'KH',   unit: 'dKH', source: 'manuel', color: '#d55181', decimals: 1, placeholder: '8.5' },
  salinity: { label: 'Salinité',         short: 'Sal.', unit: 'ppt', source: 'manuel', color: '#3987e5', decimals: 1, placeholder: '35.0' },
  sg:       { label: 'Densité (SG)',     short: 'SG',   unit: '',    source: 'manuel', color: '#9085e9', decimals: 3, placeholder: '1.026' },
};

// Graphes combinés : des panneaux à axe Y unique, empilés et alignés sur le
// même axe temps (jamais de double axe Y sur un même panneau).
export const COMBINED = [
  { id: 'nitrogen',  label: 'Azote (NH₃ · NO₂ · NO₃)', panels: [['nh3', 'no2'], ['no3']] },
  { id: 'nutrients', label: 'Nutriments (NO₃ · PO₄)',  panels: [['no3'], ['po4']] },
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
  { hours: 24 * 7,  label: '7 j' },
  { hours: 24 * 30, label: '30 j' },
];

// Au-delà de ce délai sans relevé Apex, la valeur est signalée comme périmée.
export const STALE_MS = 35 * 60 * 1000;
