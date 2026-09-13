#!/bin/sh
set -eu

[ "$(id -u)" -eq 0 ] || { echo "Run as root: sudo sh ./install.sh" >&2; exit 1; }
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
header=/var/www/header.php
javascript=/var/www/js/siri-remote-navigation.js
patcher=$script_dir/patch_header.py
[ -f "$header" ] || { echo "Required moOde file not found: $header" >&2; exit 1; }
[ -f "$script_dir/siri-remote-navigation.js" ] || { echo "Navigation JavaScript is missing" >&2; exit 1; }

temporary=$(mktemp /tmp/siri-remote-header.XXXXXX)
trap 'rm -f -- "$temporary"' EXIT HUP INT TERM
python3 "$patcher" install "$header" "$temporary"

if ! cmp -s "$temporary" "$header"; then
    run_id=$(date +%Y%m%d-%H%M%S)-$$
    backup=/var/backups/siri-remote-moode-navigation/$run_id/header.php
    mkdir -p "$(dirname -- "$backup")"
    cp -a -- "$header" "$backup"
    cp -- "$temporary" "$header"
    echo "Patched moOde header; backup: $backup"
else
    echo "moOde header already contains the navigation include."
fi
install -o root -g root -m 0644 "$script_dir/siri-remote-navigation.js" "$javascript"
systemctl try-restart localdisplay.service >/dev/null 2>&1 || true
echo "Installed Siri Remote library navigation and reloaded the local UI."
