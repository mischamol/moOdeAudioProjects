#!/bin/sh
set -eu

[ "$(id -u)" -eq 0 ] || { echo "Run as root: sudo sh ./uninstall.sh" >&2; exit 1; }

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
header=/var/www/header.php
database=/var/local/www/db/moode-sqlite3.db
stylesheet=/var/www/css/liquid-glass-theme.css
javascript=/var/www/js/liquid-glass-theme.js
state=/var/local/www/liquid-glass-theme.previous-theme

[ -f "$header" ] || { echo "Required moOde file not found: $header" >&2; exit 1; }
[ -f "$database" ] || { echo "Required moOde database not found: $database" >&2; exit 1; }

temporary=$(mktemp /tmp/liquid-glass-header-remove.XXXXXX)
trap 'rm -f -- "$temporary"' EXIT HUP INT TERM
python3 "$script_dir/patch_header.py" uninstall "$header" "$temporary"

run_id=$(date +%Y%m%d-%H%M%S)-$$
backup_dir=/var/backups/moode-liquid-glass-theme/uninstall-$run_id
mkdir -p "$backup_dir"
sqlite3 "$database" ".backup '$backup_dir/moode-sqlite3.db'"

if ! cmp -s "$temporary" "$header"; then
    cp -a -- "$header" "$backup_dir/header.php"
    cp -- "$temporary" "$header"
    echo "Removed Liquid Glass includes; safety backup: $backup_dir/header.php"
fi

current_theme=$(sqlite3 "$database" "SELECT value FROM cfg_system WHERE param='themename';")
restore_theme=Default
if [ -f "$state" ]; then
    restore_theme=$(sed -n '1p' "$state")
fi
case "$restore_theme" in
    ""|*"'"*) restore_theme=Default ;;
esac
if [ "$(sqlite3 "$database" "SELECT count(*) FROM cfg_theme WHERE theme_name='$restore_theme';")" -ne 1 ]; then
    restore_theme=Default
fi

if [ "$current_theme" = "Liquid Glass" ]; then
    sqlite3 "$database" "UPDATE cfg_system SET value='$restore_theme' WHERE param='themename';"
fi
sqlite3 "$database" "DELETE FROM cfg_theme WHERE theme_name='Liquid Glass';"

rm -f -- "$stylesheet" "$javascript" "$state"
systemctl try-restart localdisplay.service >/dev/null 2>&1 || true

if [ "$current_theme" = "Liquid Glass" ]; then
    echo "Removed Liquid Glass and restored theme: $restore_theme"
else
    echo "Removed Liquid Glass; the active moOde theme was left unchanged."
fi
