#!/usr/bin/env bash
# Installe le poller comme service systemd sur le PC Ubuntu.
# À lancer depuis le clone du repo : bash poller/install.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"
CONF="$SCRIPT_DIR/config.ini"
UNIT=/etc/systemd/system/aquarium-poller.service

if [ ! -f "$CONF" ]; then
  sed "s|^path = .*|path = $REPO_DIR|" "$SCRIPT_DIR/config.example.ini" > "$CONF"
  echo "→ $CONF créé."
  echo "  Éditez-le (IP de l'Apex, noms des sondes), puis relancez : bash poller/install.sh"
  exit 0
fi

echo "→ Test d'un cycle complet (Apex + git)…"
if ! python3 "$SCRIPT_DIR/apex_poller.py" --config "$CONF" --once; then
  echo "✕ Le cycle de test a échoué (Apex injoignable ?). Corrigez $CONF puis relancez."
  exit 1
fi

echo "→ Installation du service systemd (sudo requis)…"
sed -e "s|%USER%|$USER|g" -e "s|%REPO%|$REPO_DIR|g" \
  "$SCRIPT_DIR/aquarium-poller.service" | sudo tee "$UNIT" >/dev/null
sudo systemctl daemon-reload
sudo systemctl enable --now aquarium-poller.service

echo "✓ Service installé et démarré."
echo "  Suivi des logs : journalctl -u aquarium-poller -f"
