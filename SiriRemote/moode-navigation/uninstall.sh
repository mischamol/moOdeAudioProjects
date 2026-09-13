#!/bin/sh
set -eu

[ "$(id -u)" -eq 0 ] || { echo "Run as root: sudo sh ./uninstall.sh" >&2; exit 1; }
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
header=/var/www/header.php
javascript=/var/www/js/siri-remote-navigation.js
[ -f "$header" ] || { echo "Required moOde file not found: $header" >&2; exit 1; }

temporary=$(mktemp /tmp/siri-remote-header-remove.XXXXXX)
trap 'rm -f -- "$temporary"' EXIT HUP INT TERM
python3 "$script_dir/patch_header.py" uninstall "$header" "$temporary"
if ! cmp -s "$temporary" "$header"; then
    run_id=$(date +%Y%m%d-%H%M%S)-$$
    backup=/var/backups/siri-remote-moode-navigation/uninstall-$run_id/header.php
    mkdir -p "$(dirname -- "$backup")"
    cp -a -- "$header" "$backup"
    cp -- "$temporary" "$header"
    echo "Removed navigation include; safety backup: $backup"
fi
rm -f -- "$javascript"
systemctl try-restart localdisplay.service >/dev/null 2>&1 || true
echo "Removed Siri Remote library navigation and reloaded the local UI."
