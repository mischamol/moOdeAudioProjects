#!/bin/sh
set -eu

[ "$(id -u)" -eq 0 ] || { echo "Run as root: sudo sh ./install.sh" >&2; exit 1; }

activate=yes
case "${1:-}" in
    "") ;;
    --no-activate) activate=no ;;
    -h|--help)
        echo "Usage: sudo sh ./install.sh [--no-activate]"
        exit 0
        ;;
    *)
        echo "Usage: sudo sh ./install.sh [--no-activate]" >&2
        exit 2
        ;;
esac

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
header=/var/www/header.php
database=/var/local/www/db/moode-sqlite3.db
stylesheet=/var/www/css/liquid-glass-theme.css
javascript=/var/www/js/liquid-glass-theme.js
state=/var/local/www/liquid-glass-theme.previous-theme
patcher=$script_dir/patch_header.py

for required in "$header" "$database" "$script_dir/liquid-glass-theme.css" \
    "$script_dir/liquid-glass-theme.js" "$patcher"; do
    [ -f "$required" ] || { echo "Required file not found: $required" >&2; exit 1; }
done
command -v python3 >/dev/null 2>&1 || { echo "python3 is required" >&2; exit 1; }
command -v sqlite3 >/dev/null 2>&1 || { echo "sqlite3 is required" >&2; exit 1; }

temporary=$(mktemp /tmp/liquid-glass-header.XXXXXX)
trap 'rm -f -- "$temporary"' EXIT HUP INT TERM
python3 "$patcher" install "$header" "$temporary"

run_id=$(date +%Y%m%d-%H%M%S)-$$
backup_dir=/var/backups/moode-liquid-glass-theme/$run_id
mkdir -p "$backup_dir"

if ! cmp -s "$temporary" "$header"; then
    cp -a -- "$header" "$backup_dir/header.php"
    cp -- "$temporary" "$header"
    echo "Patched moOde header; backup: $backup_dir/header.php"
else
    echo "moOde header already contains the Liquid Glass includes."
fi

# sqlite3's online backup is safe even if moOde currently has the database open.
sqlite3 "$database" ".backup '$backup_dir/moode-sqlite3.db'"
current_theme=$(sqlite3 "$database" "SELECT value FROM cfg_system WHERE param='themename';")
if [ ! -e "$state" ] && [ "$current_theme" != "Liquid Glass" ]; then
    printf '%s\n' "${current_theme:-Default}" > "$state"
    chown root:root "$state"
    chmod 0644 "$state"
fi

sql="BEGIN;
DELETE FROM cfg_theme WHERE theme_name='Liquid Glass';
INSERT INTO cfg_theme (theme_name, tx_color, bg_color, mbg_color)
VALUES ('Liquid Glass', 'ddd', '32,32,32', '50, 50, 50, 0.75');"
if [ "$activate" = yes ]; then
    sql="$sql
UPDATE cfg_system SET value='Liquid Glass' WHERE param='themename';"
fi
sql="$sql
COMMIT;"
sqlite3 "$database" "$sql"

install -o root -g root -m 0644 "$script_dir/liquid-glass-theme.css" "$stylesheet"
install -o root -g root -m 0644 "$script_dir/liquid-glass-theme.js" "$javascript"
systemctl try-restart localdisplay.service >/dev/null 2>&1 || true

if [ "$activate" = yes ]; then
    echo "Installed and selected theme: Liquid Glass"
else
    echo "Installed theme: Liquid Glass (not selected)"
fi
echo "Select it later in moOde: Preferences > Appearance > Theme."
