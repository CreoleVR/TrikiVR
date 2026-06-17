#!/usr/bin/env bash
#
# Grant the locally-installed Electron binary permission to use raw BLE sockets
# so TrikiVR can scan/connect without running as root.
#
# Linux requires CAP_NET_RAW + CAP_NET_ADMIN to open an HCI socket. Setting file
# capabilities puts the loader into "secure-execution" mode, which makes it
# ignore Electron's $ORIGIN-relative RUNPATH — so we also register Electron's
# bundled library directory with the system loader cache.
#
# Re-run this after every `npm install` (it replaces node_modules/electron).
# Requires sudo. Undo with: scripts/teardown-linux-ble.sh
set -euo pipefail

if [[ "$(uname -s)" != "Linux" ]]; then
    echo "This script is only needed on Linux." >&2
    exit 0
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ELECTRON_BIN="$ROOT/node_modules/electron/dist/electron"
LIB_DIR="$ROOT/node_modules/electron/dist"
CONF="/etc/ld.so.conf.d/trikivr-electron.conf"

if [[ ! -x "$ELECTRON_BIN" ]]; then
    echo "Electron binary not found at $ELECTRON_BIN — run 'npm install' first." >&2
    exit 1
fi

echo "Registering Electron lib dir with the loader cache ($CONF)…"
echo "$LIB_DIR" | sudo tee "$CONF" >/dev/null
sudo ldconfig

echo "Granting cap_net_raw,cap_net_admin to $ELECTRON_BIN…"
sudo setcap cap_net_raw,cap_net_admin+eip "$ELECTRON_BIN"

echo "Done. Verify with: getcap '$ELECTRON_BIN'"
