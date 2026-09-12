#!/bin/sh
set -eu

if [ "$(id -u)" -ne 0 ]; then
    echo "Run as root: sudo sh ./install.sh" >&2
    exit 1
fi

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
patcher=$script_dir/patch_airplay.py
source_hook=$script_dir/aplvol2moode.sh
install_dir=/usr/local/libexec/moode-personalizations
hook=$install_dir/aplvol2moode.sh
spspre=/var/local/www/commandw/spspre.sh
runtime=/etc/shairport-sync.conf
template=/etc/shairport-sync.sed.conf

for command in python3 install cmp cp mkdir mktemp awk; do
    command -v "$command" >/dev/null 2>&1 || { echo "Required command missing: $command" >&2; exit 1; }
done
for required in "$patcher" "$source_hook" "$spspre" "$runtime"; do
    [ -f "$required" ] || { echo "Required file not found: $required" >&2; exit 1; }
done

temporary=$(mktemp -d /tmp/moode-airplay-volume.XXXXXX)
trap 'rm -rf -- "$temporary"' EXIT HUP INT TERM
python3 "$patcher" spspre-install "$spspre" "$temporary/spspre.sh"
python3 "$patcher" shairport-install "$runtime" "$temporary/runtime.conf" "$hook"
if [ -f "$template" ]; then
    python3 "$patcher" shairport-install "$template" "$temporary/template.conf" "$hook"
fi

changed=no
for pair in \
    "$temporary/spspre.sh|$spspre" \
    "$temporary/runtime.conf|$runtime" \
    "$temporary/template.conf|$template"
do
    candidate=${pair%%|*}
    target=${pair#*|}
    [ -f "$candidate" ] || continue
    cmp -s "$candidate" "$target" || changed=yes
done

if [ "$changed" = yes ]; then
    run_id=$(date +%Y%m%d-%H%M%S)-$$
    backup=/var/backups/moode-airplay-volume/$run_id
    mkdir -p "$backup" /var/lib/moode-airplay-volume
    cp -a -- "$spspre" "$backup/spspre.sh"
    cp -a -- "$runtime" "$backup/shairport-sync.conf"
    [ ! -f "$template" ] || cp -a -- "$template" "$backup/shairport-sync.sed.conf"
    printf '%s\n' "$backup" > /var/lib/moode-airplay-volume/last-install-backup

    cp -- "$temporary/spspre.sh" "$spspre"
    cp -- "$temporary/runtime.conf" "$runtime"
    [ ! -f "$temporary/template.conf" ] || cp -- "$temporary/template.conf" "$template"
    echo "Updated moOde and Shairport volume handling."
    echo "Backup: $backup"
else
    echo "AirPlay-to-moOde volume configuration is already installed."
fi

mkdir -p "$install_dir"
install -o root -g root -m 0755 "$source_hook" "$hook"
systemctl try-restart shairport-sync.service 2>/dev/null || true
echo "Installed AirPlay volume hook: $hook"
