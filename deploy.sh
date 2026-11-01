#!/usr/bin/env bash
# deploy.sh — package and install OLED Saver on LG TV
#
# Prerequisites (one-time):
#   npm install -g @webos-tools/cli
#   bash setup-lg.sh <tv-ip> <passphrase>
#
# Usage: bash deploy.sh
set -euo pipefail

APP_ID=com.oledscreensaver.app
DEVICE=oledsaver-tv
ROOT="$(cd "$(dirname "$0")" && pwd)"

step() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
die()  { echo "ERROR: $*" >&2; exit 1; }

command -v ares-package >/dev/null || die "ares CLI not found. Run: npm install -g @webos-tools/cli"

step "Packaging app"
rm -rf "$ROOT/build_lg"
mkdir -p "$ROOT/build_lg"
ares-package "$ROOT/src" -o "$ROOT/build_lg"
PKG=$(ls "$ROOT/build_lg"/*.ipk 2>/dev/null | head -1)
[ -n "$PKG" ] || die "No .ipk produced"
echo "Package: $(basename "$PKG")"

step "Installing on TV ($DEVICE)"
ares-install --device "$DEVICE" "$PKG"

step "Launching OLED Saver"
ares-launch --device "$DEVICE" "$APP_ID"
echo
echo "Done. OLED Saver running on LG TV."
