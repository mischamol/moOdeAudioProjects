#!/bin/sh
set -eu

[ "$(id -u)" -eq 0 ] || { echo "Run as root: sudo sh ./uninstall.sh [--purge]" >&2; exit 1; }

purge=no
case "${1:-}" in
    "") ;;
    --purge) purge=yes ;;
    *) echo "Usage: sudo sh ./uninstall.sh [--purge]" >&2; exit 2 ;;
esac

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
header=/var/www/header.php
state_dir=/var/local/www/moode-applemusic

# Close Apple Music if it is open.
if [ -x /usr/local/bin/moode-applemusic ]; then
    /usr/local/bin/moode-applemusic close >/dev/null 2>&1 || true
fi

if [ -f "$header" ]; then
    temporary=$(mktemp /tmp/applemusic-header-remove.XXXXXX)
    trap 'rm -f -- "$temporary"' EXIT HUP INT TERM
    python3 "$script_dir/patch_header.py" uninstall "$header" "$temporary"
    if ! cmp -s "$temporary" "$header"; then
        backup_dir=/var/backups/moode-applemusic/uninstall-$(date +%Y%m%d-%H%M%S)-$$
        mkdir -p "$backup_dir"
        cp -a -- "$header" "$backup_dir/header.php"
        cat "$temporary" > "$header"
        echo "Removed Apple Music include; safety backup: $backup_dir/header.php"
    fi
fi

rm -f /var/www/applemusic.php /var/www/js/applemusic.js /usr/local/bin/moode-applemusic
rm -rf /opt/moode-applemusic

if [ -f "$state_dir/installed-widevine" ]; then
    echo "Removing Widevine (installed by this project)..."
    DEBIAN_FRONTEND=noninteractive apt-get purge -y -qq libwidevinecdm0 || true
fi
if [ -f "$state_dir/installed-xdotool" ]; then
    echo "Removing xdotool (installed by this project)..."
    DEBIAN_FRONTEND=noninteractive apt-get purge -y -qq xdotool || true
fi
rm -rf /dev/shm/moode-applemusic /dev/shm/moode-applemusic-auth.json

display_user=$(systemctl show -p User --value localdisplay.service 2>/dev/null || true)
profile=""
[ -n "$display_user" ] && profile="$(getent passwd "$display_user" | cut -d: -f6)/.config/moode-applemusic"

if [ "$purge" = yes ]; then
    rm -f /etc/default/moode-applemusic
    [ -n "$profile" ] && rm -rf "$profile"
    echo "Removed settings and the Apple Music browser profile (sign-in)."
else
    echo "Kept /etc/default/moode-applemusic and the Apple Music sign-in ($profile)."
    echo "Use --purge to remove those too."
fi
rm -rf "$state_dir"

systemctl try-restart localdisplay.service >/dev/null 2>&1 || true
echo "Apple Music integration removed."
