#!/bin/sh
set -eu

if [ "$(id -u)" -ne 0 ]; then
    echo "Run as root: sudo sh ./uninstall.sh" >&2
    exit 1
fi

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
patcher=$script_dir/patch_airplay.py
install_dir=/usr/local/libexec/moode-personalizations
hook=$install_dir/aplvol2moode.sh
spspre=/var/local/www/commandw/spspre.sh
runtime=/etc/shairport-sync.conf
template=/etc/shairport-sync.sed.conf
pointer=/var/lib/moode-airplay-volume/last-install-backup

for required in "$patcher" "$spspre" "$runtime"; do
    [ -f "$required" ] || { echo "Required file not found: $required" >&2; exit 1; }
done

temporary=$(mktemp -d /tmp/moode-airplay-volume-remove.XXXXXX)
trap 'rm -rf -- "$temporary"' EXIT HUP INT TERM
python3 "$patcher" spspre-uninstall "$spspre" "$temporary/spspre.sh"

backup=
if [ -f "$pointer" ]; then
    backup=$(sed -n '1p' "$pointer")
fi

needs_backup=no
grep -Fq "run_this_when_volume_is_set = \"$hook\";" "$runtime" && needs_backup=yes || true
if [ -f "$template" ] && grep -Fq "run_this_when_volume_is_set = \"$hook\";" "$template"; then
    needs_backup=yes
fi
if [ "$needs_backup" = yes ]; then
    [ -n "$backup" ] && [ -d "$backup" ] || {
        echo "The managed Shairport hook is active, but its installation backup is unavailable." >&2
        echo "No files were changed. Reinstall after a moOde update or restore these options manually." >&2
        exit 1
    }
fi

if [ -n "$backup" ] && [ -f "$backup/shairport-sync.conf" ]; then
    python3 "$patcher" shairport-restore "$runtime" "$backup/shairport-sync.conf" "$temporary/runtime.conf" "$hook"
else
    cp -- "$runtime" "$temporary/runtime.conf"
fi
if [ -f "$template" ]; then
    if [ -n "$backup" ] && [ -f "$backup/shairport-sync.sed.conf" ]; then
        python3 "$patcher" shairport-restore "$template" "$backup/shairport-sync.sed.conf" "$temporary/template.conf" "$hook"
    else
        cp -- "$template" "$temporary/template.conf"
    fi
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
    safety=/var/backups/moode-airplay-volume/uninstall-$run_id
    mkdir -p "$safety"
    cp -a -- "$spspre" "$safety/spspre.sh"
    cp -a -- "$runtime" "$safety/shairport-sync.conf"
    [ ! -f "$template" ] || cp -a -- "$template" "$safety/shairport-sync.sed.conf"
    cp -- "$temporary/spspre.sh" "$spspre"
    cp -- "$temporary/runtime.conf" "$runtime"
    [ ! -f "$temporary/template.conf" ] || cp -- "$temporary/template.conf" "$template"
    echo "Removed the managed AirPlay volume configuration."
    echo "Pre-uninstall backup: $safety"
else
    echo "No managed AirPlay configuration changes needed removal."
fi

rm -f -- "$hook"
systemctl try-restart shairport-sync.service 2>/dev/null || true
echo "Removed the AirPlay volume hook."
