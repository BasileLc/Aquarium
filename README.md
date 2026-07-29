# 🐠 Aquarium — suivi des paramètres (Neptune Apex)

Application personnelle de suivi d'un aquarium récifal contrôlé par un
Neptune Apex : relevés automatiques des sondes (température, pH, ORP,
NO₃, PO₄), saisie manuelle des tests (NH₃, NO₂, KH, salinité/densité) et
calendrier de maintenance.

**Ce repo est à la fois le code et la base de données** : les mesures sont
des fichiers JSON versionnés dans `data/`, l'app est une PWA hébergée sur
GitHub Pages, et un poller Python tourne sur un PC Ubuntu du réseau local
de l'aquarium.

## Architecture

```
Apex (réseau local) ──status.json──▶ Poller Python (PC Ubuntu, systemd)
                                          │  °F → °C, horodatage, source
                                          ▼
                               commit + push ──▶ Ce repo GitHub (data/)
                                                     ▲            │
                        écriture API GitHub (token)  │            │ lecture API GitHub
                        mesures manuelles/événements │            ▼
                                                  PWA « Aquarium » (GitHub Pages)
                                                  installable mobile + desktop
```

- **Aucun fichier n'est écrit par deux acteurs** : le poller écrit
  `data/apex/` et `data/latest.json` ; l'app écrit `data/manual/` et
  `data/events.json`. Résultat : jamais de conflit git.
- **Coupure réseau** : les commits du poller s'accumulent localement et
  partent à la reconnexion ; si l'Apex est injoignable, nouvel essai au
  cycle suivant. Aucune perte bloquante.
- **L'app n'a jamais besoin du réseau local de l'aquarium** : elle lit et
  écrit uniquement GitHub.

## Contenu du repo

| Dossier | Rôle |
|---|---|
| `app/` | La PWA (HTML/CSS/JS pur, aucun build ; Chart.js embarqué dans `app/vendor/`) |
| `poller/` | Le poller Python + service systemd pour le PC Ubuntu |
| `data/` | La « base de données » : mesures et événements en JSON |
| `tools/` | Générateur des icônes PNG de la PWA |
| `.github/workflows/` | Déploiement GitHub Pages (uniquement quand `app/` change) |

### Format des données

```jsonc
// Une mesure (data/apex/2026/07-29.json ou data/manual/2026-07.json)
{ "parameter": "temp", "value": 25.4, "unit": "°C",
  "timestamp": "2026-07-29T14:05:00+02:00", "source": "apex" }   // ou "manuel"

// Un événement (data/events.json)
{ "id": "evt_…", "name": "Changement d'eau", "date": "2026-08-02",
  "note": "20 L, sel Red Sea", "status": "pending" }             // ou "done"
```

- `data/apex/AAAA/MM-JJ.json` : un fichier par jour, écrit par le poller.
- `data/manual/AAAA-MM.json` : un fichier par mois, écrit par l'app.
- `data/latest.json` + `data/manual/latest.json` : dernière valeur de
  chaque paramètre (pour l'Accueil).

## Mise en route

### 1. Activer GitHub Pages

Sur GitHub : **Settings → Pages → Build and deployment → Source :
« GitHub Actions »**. Au prochain push touchant `app/`, le workflow
publie l'app sur `https://<votre-compte>.github.io/Aquarium/`.

### 2. Créer le token d'écriture (pour les saisies manuelles)

1. GitHub → **Settings → Developer settings → Fine-grained tokens →
   Generate new token**.
2. *Repository access* : « Only select repositories » → ce repo.
3. *Permissions → Repository permissions → Contents* : **Read and write**
   (rien d'autre).
4. Ouvrez l'app → **Réglages** → collez le token → **Tester** puis
   **Enregistrer**. Le token reste dans le navigateur (localStorage),
   il n'est jamais commité. À refaire à l'expiration du token.

Sans token, l'app reste consultable (lecture via le CDN GitHub,
rafraîchie avec ~5 min de délai) mais ne peut rien enregistrer.

### 3. Installer l'app sur téléphone / ordinateur

- **Android (Chrome)** : ouvrir l'URL GitHub Pages → menu ⋮ →
  « Ajouter à l'écran d'accueil » / « Installer l'application ».
- **iPhone (Safari)** : Partager → « Sur l'écran d'accueil ».
- **Desktop (Chrome/Edge)** : icône d'installation dans la barre d'adresse.

### 4. Installer le poller sur le PC Ubuntu

Prérequis : `git` et Python ≥ 3.9 (inclus dans Ubuntu), et un accès git
**en écriture** au repo pour l'utilisateur qui fera tourner le service —
au choix :

- clé SSH : cloner en `git@github.com:…` et ajouter la clé au compte GitHub ;
- ou HTTPS : `git config --global credential.helper store` puis un
  `git push` manuel une première fois avec un token en guise de mot de passe.

Ensuite :

```bash
git clone git@github.com:BasileLc/Aquarium.git ~/Aquarium
cd ~/Aquarium
bash poller/install.sh          # 1er lancement : crée poller/config.ini
nano poller/config.ini          # IP de l'Apex, noms des sondes, fuseau…
bash poller/install.sh          # teste un cycle réel puis installe le service
```

Le script vérifie un cycle complet (lecture Apex + commit + push) avant
d'installer le service systemd (démarrage au boot, redémarrage
automatique en cas d'échec). Suivi :

```bash
journalctl -u aquarium-poller -f      # logs en direct
systemctl status aquarium-poller      # état du service
```

Notes :

- Pas de Trident (NO₃/PO₄ automatiques) ? Laissez `no3` et `po4` vides
  dans `[probes]` — ces paramètres resteront saisis à la main si besoin.
- Les noms de sondes (`Temp`, `pH`…) doivent correspondre aux noms
  configurés dans Apex Fusion (insensible à la casse).
- Température : l'Apex renvoie des °F par défaut ; le poller convertit et
  stocke en °C (`temp_unit = C` si votre sonde est déjà en Celsius).

## L'application

- **Accueil** : valeur actuelle de chaque paramètre avec l'heure du
  relevé (⚠️ si le dernier relevé Apex date de plus de 35 min). Chaque
  carte ouvre le graphe du paramètre. En bas, les 3 prochains événements.
- **Graphiques** : un graphe par paramètre (24 h par défaut, 7 j / 30 j
  disponibles), navigation par swipe ou flèches, plus deux vues
  combinées — « Azote » (NH₃ + NO₂ + NO₃) et « Nutriments » (NO₃ + PO₄) —
  en panneaux empilés sur le même axe de temps (jamais de double axe Y,
  chaque grandeur garde une échelle honnête). Bouton
  « ＋ Ajouter une mesure manuelle » (la salinité et la densité SG se
  saisissent ensemble, comme une seule mesure).
- **Événements** : liste chronologique des événements à venir, ajout,
  marquage « fait », suppression ; les passés restent consultables.
- **Réglages** : token GitHub + test d'accès, vidage du cache.

## Développement local

```bash
python3 -m http.server 8000 --directory app
# puis http://localhost:8000 (les données sont lues depuis GitHub)
python3 tools/make_icons.py   # régénérer les icônes PNG après retouche du design
```

## Dépannage

| Symptôme | Piste |
|---|---|
| L'Accueil affiche « aucune donnée » | Le poller a-t-il déjà poussé ? `journalctl -u aquarium-poller -n 50` |
| ⚠️ « ancien relevé » sur les cartes Apex | PC éteint, Apex injoignable ou push en échec — voir les logs du poller |
| Écriture impossible depuis l'app | Token expiré ou sans permission « Contents: Read and write » → Réglages → Tester |
| Le site Pages ne se met pas à jour | Le workflow ne part que si `app/` change (Actions → Deploy PWA) |
| `git push` du poller refusé | Identifiants git absents pour l'utilisateur du service (voir étape 4) |
