#!/bin/sh
set -eu

if [ "$(id -u)" -ne 0 ]; then
    echo "Run as root: sudo sh ./install.sh [scale-factor]" >&2
    exit 1
fi

factor=${1:-2}
case "$factor" in
    ''|*[!0-9]*|0) echo "Scale factor must be a positive integer" >&2; exit 2 ;;
esac

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
patcher=$script_dir/patch_scaling.py
command -v python3 >/dev/null 2>&1 || { echo "python3 is required" >&2; exit 1; }
[ -f "$patcher" ] || { echo "Missing $patcher" >&2; exit 1; }

user_home=$(getent passwd 1000 | cut -d: -f6)
[ -n "$user_home" ] || user_home=/home/pi
target=$user_home/.xinitrc
[ -f "$target" ] || { echo "Required file not found: $target" >&2; exit 1; }

temporary=$(mktemp /tmp/moode-display-scaling.XXXXXX)
trap 'rm -f -- "$temporary"' EXIT HUP INT TERM
python3 "$patcher" install "$target" "$temporary" "$factor"

if cmp -s "$temporary" "$target"; then
    echo "Display scaling is already installed with factor $factor."
    exit 0
fi

run_id=$(date +%Y%m%d-%H%M%S)-$$
backup=/var/backups/moode-display-scaling/$run_id/xinitrc
mkdir -p "$(dirname -- "$backup")" /var/lib/moode-display-scaling
cp -a -- "$target" "$backup"
cp -- "$temporary" "$target"
printf '%s\n' "$backup" > /var/lib/moode-display-scaling/last-install-backup

echo "Installed Chromium display scaling (factor $factor) in $target."
echo "Backup: $backup"
echo "Reboot once to activate the change: sudo reboot"
