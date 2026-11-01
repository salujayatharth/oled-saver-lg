#!/usr/bin/env bash
# setup-lg.sh — one-time developer mode setup for LG TV
#
# Usage: bash setup-lg.sh <tv-ip> <passphrase>
#   tv-ip      — LG TV's IP address (Settings → Network → Wi-Fi Connection → Advanced)
#   passphrase — 6-char code shown in the Developer Mode app on the TV
#
# On the TV first:
#   1. Apps → search "Developer Mode" → install LG's Developer Mode app
#   2. Open app → sign in with LG developer account → toggle Dev Mode ON → reboot
#   3. Reopen app → toggle "Key Server" ON → note the passphrase shown
set -euo pipefail

TV_IP="${1:?Usage: bash setup-lg.sh <tv-ip> <passphrase>}"
PASSPHRASE="${2:?}"
DEVICE=oledsaver-tv

command -v ares-setup-device >/dev/null || { npm install -g @webos-tools/cli; }

echo "Registering device '$DEVICE' at $TV_IP..."
ares-setup-device --add "$DEVICE" \
  --info "host=$TV_IP" \
  --info "port=9922" \
  --info "username=prisoner"

echo "Fetching SSH key (enter passphrase '$PASSPHRASE' when prompted)..."
ares-novacom --device "$DEVICE" --getkey

echo ""
echo "Device '$DEVICE' registered. Run: bash deploy.sh"
