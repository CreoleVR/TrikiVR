#!/usr/bin/env bash
# Undo scripts/setup-linux-ble.sh.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ELECTRON_BIN="$ROOT/node_modules/electron/dist/electron"
CONF="/etc/ld.so.conf.d/trikivr-electron.conf"

[[ -e "$ELECTRON_BIN" ]] && sudo setcap -r "$ELECTRON_BIN" 2>/dev/null || true
sudo rm -f "$CONF"
sudo ldconfig
echo "Removed BLE capabilities and loader config."
