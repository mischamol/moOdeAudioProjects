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
runtime=/etc/shairport-sync.conf
template=/etc/shairport-sync.sed.conf
state_dir=/var/lib/moode-airplay-volume
original_runtime=$state_dir/original-shairport-sync.conf
original_template=$state_dir/original-shairport-sync.sed.conf

for required in "$patcher" "$runtime"; do
    [ -f "$required" ] || { echo "Required file not found: $required" >&2; exit 1; }
done

temporary=$(mktemp -d /tmp/moode-airplay-volume-remove.XXXXXX)
trap 'rm -rf -- "$temporary"' EXIT HUP INT TERM
managed_line="run_this_when_volume_is_set = \"$hook\";"

if grep -Fq "$managed_line" "$runtime"; then
    [ -f "$original_runtime" ] || { echo "Original runtime configuration is missing; nothing was changed." >&2; exit 1; }
    python3 "$patcher" restore "$runtime" "$original_runtime" "$temporary/runtime.conf" "$hook"
else
    cp -- "$runtime" "$temporary/runtime.conf"
fi
if [ -f "$template" ]; then
    if grep -Fq "$managed_line" "$template"; then
        [ -f "$original_template" ] || { echo "Original template is missing; nothing was changed." >&2; exit 1; }
        python3 "$patcher" restore "$template" "$original_template" "$temporary/template.conf" "$hook"
    else
        cp -- "$template" "$temporary/template.conf"
    fi
fi

changed=no
cmp -s "$temporary/runtime.conf" "$runtime" || changed=yes
if [ -f "$temporary/template.conf" ] && ! cmp -s "$temporary/template.conf" "$template"; then
    changed=yes
fi

if [ "$changed" = yes ]; then
    run_id=$(date +%Y%m%d-%H%M%S)-$$
    safety=/var/backups/moode-airplay-volume/uninstall-$run_id
    mkdir -p "$safety"
    cp -a -- "$runtime" "$safety/shairport-sync.conf"
    [ ! -f "$template" ] || cp -a -- "$template" "$safety/shairport-sync.sed.conf"
    cp -- "$temporary/runtime.conf" "$runtime"
    [ ! -f "$temporary/template.conf" ] || cp -- "$temporary/template.conf" "$template"
    echo "Removed the managed Shairport volume configuration."
    echo "Pre-uninstall backup: $safety"
else
    echo "No managed Shairport configuration changes needed removal."
fi

rm -f -- "$hook"
systemctl try-restart shairport-sync.service 2>/dev/null || true
echo "Removed the AirPlay volume hook."
