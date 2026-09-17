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
runtime=/etc/shairport-sync.conf
template=/etc/shairport-sync.sed.conf
cdsp_volume_update=/var/www/util/cdsp_volume_update.py
state_dir=/var/lib/moode-airplay-volume
original_runtime=$state_dir/original-shairport-sync.conf
original_template=$state_dir/original-shairport-sync.sed.conf

for command in python3 install cmp cp mkdir mktemp grep; do
    command -v "$command" >/dev/null 2>&1 || { echo "Required command missing: $command" >&2; exit 1; }
done
for required in "$patcher" "$source_hook" "$runtime" "$cdsp_volume_update"; do
    [ -f "$required" ] || { echo "Required file not found: $required" >&2; exit 1; }
done
[ -x "$cdsp_volume_update" ] || { echo "Required utility is not executable: $cdsp_volume_update" >&2; exit 1; }

temporary=$(mktemp -d /tmp/moode-airplay-volume.XXXXXX)
trap 'rm -rf -- "$temporary"' EXIT HUP INT TERM
python3 "$patcher" install "$runtime" "$temporary/runtime.conf" "$hook"
if [ -f "$template" ]; then
    python3 "$patcher" install "$template" "$temporary/template.conf" "$hook"
fi

mkdir -p "$state_dir"
managed_line="run_this_when_volume_is_set = \"$hook\";"
if grep -Fq "$managed_line" "$runtime"; then
    [ -f "$original_runtime" ] || {
        echo "The managed hook is active, but its original runtime configuration is missing." >&2
        exit 1
    }
else
    cp -a -- "$runtime" "$original_runtime"
fi
if [ -f "$template" ]; then
    if grep -Fq "$managed_line" "$template"; then
        [ -f "$original_template" ] || {
            echo "The managed hook is active, but its original template is missing." >&2
            exit 1
        }
    else
        cp -a -- "$template" "$original_template"
    fi
fi

changed=no
cmp -s "$temporary/runtime.conf" "$runtime" || changed=yes
if [ -f "$temporary/template.conf" ] && ! cmp -s "$temporary/template.conf" "$template"; then
    changed=yes
fi

if [ "$changed" = yes ]; then
    run_id=$(date +%Y%m%d-%H%M%S)-$$
    backup=/var/backups/moode-airplay-volume/$run_id
    mkdir -p "$backup"
    cp -a -- "$runtime" "$backup/shairport-sync.conf"
    [ ! -f "$template" ] || cp -a -- "$template" "$backup/shairport-sync.sed.conf"
    cp -- "$temporary/runtime.conf" "$runtime"
    [ ! -f "$temporary/template.conf" ] || cp -- "$temporary/template.conf" "$template"
    echo "Updated the Shairport volume hook."
    echo "Safety backup: $backup"
else
    echo "The direct AirPlay-to-CamillaDSP volume hook is already configured."
fi

mkdir -p "$install_dir"
install -o root -g root -m 0755 "$source_hook" "$hook"
systemctl try-restart shairport-sync.service 2>/dev/null || true
echo "Installed AirPlay volume hook: $hook"
