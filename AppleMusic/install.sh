#!/bin/sh
set -eu

[ "$(id -u)" -eq 0 ] || { echo "Run as root: sudo sh ./install.sh" >&2; exit 1; }

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
header=/var/www/header.php
state_dir=/var/local/www/moode-applemusic
launcher=/usr/local/bin/moode-applemusic
extension_dir=/opt/moode-applemusic/extension
config=/etc/default/moode-applemusic

for required in "$header" "$script_dir/moode-applemusic" "$script_dir/patch_header.py" \
    "$script_dir/web/applemusic.php" "$script_dir/web/applemusic.js" \
    "$script_dir/extension/manifest.json"; do
    [ -f "$required" ] || { echo "Required file not found: $required" >&2; exit 1; }
done
command -v python3 >/dev/null 2>&1 || { echo "python3 is required" >&2; exit 1; }
command -v chromium-browser >/dev/null 2>&1 || { echo "chromium-browser is required (moOde local display)" >&2; exit 1; }

mkdir -p "$state_dir"

# 1. Widevine (DRM module Apple Music needs). Remember whether we installed it.
if ! dpkg-query -W -f='${Status}' libwidevinecdm0 2>/dev/null | grep -q "install ok installed"; then
    echo "Installing Widevine (libwidevinecdm0)..."
    apt-get update -qq
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq libwidevinecdm0
    touch "$state_dir/installed-widevine"
fi
# xdotool hides/shows the Apple Music window (there is no window manager).
if ! command -v xdotool >/dev/null 2>&1; then
    echo "Installing xdotool..."
    apt-get update -qq
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq xdotool
    touch "$state_dir/installed-xdotool"
fi

# 2. Launcher, Chromium extension and configuration.
install -o root -g root -m 0755 "$script_dir/moode-applemusic" "$launcher"
mkdir -p "$extension_dir"
for f in manifest.json rules.json background.js content.js content.css nowebgl.js volume.js nowplaying.js idle.js theme.js siri-overlay.js siri-overlay.css applenav.js; do
    install -o root -g root -m 0644 "$script_dir/extension/$f" "$extension_dir/$f"
done
if [ ! -f "$config" ]; then
    cat > "$config" <<'CONF'
# Settings for moode-applemusic (Apple Music on the moOde local display)
APPLEMUSIC_URL=https://music.apple.com/nl/home
# ALSA device; _audioout follows moOde's output chain (CamillaDSP when enabled)
APPLEMUSIC_ALSA_DEVICE=_audioout
# Empty = same scaling as the moOde display; e.g. 1.5 shows more on screen
APPLEMUSIC_SCALE=
# Stop moOde (MPD) playback when Apple Music opens
APPLEMUSIC_STOP_MPD=yes
# Pause moOde's own browser while Apple Music is open (experimental)
APPLEMUSIC_FREEZE_MOODE=no
# Extra Chromium flags, e.g. --enable-low-end-device-mode
APPLEMUSIC_EXTRA_FLAGS=
# auto = light/dark like the moOde theme; or dark / light
APPLEMUSIC_COLOR_SCHEME=auto
# Interface language, e.g. en-GB; empty = the store's own language
APPLEMUSIC_LANGUAGE=
# Service on/off (moOde Configure > Renderers)
APPLEMUSIC_ENABLED=yes
CONF
fi
grep -q '^APPLEMUSIC_ENABLED=' "$config" || printf '%s\n' \
    '# Service on/off (moOde Configure > Renderers)' 'APPLEMUSIC_ENABLED=yes' >> "$config"
# Settings added in later versions, for existing configuration files.
grep -q '^APPLEMUSIC_COLOR_SCHEME=' "$config" || printf '%s\n' \
    '# auto = light/dark like the moOde theme; or dark / light' 'APPLEMUSIC_COLOR_SCHEME=auto' >> "$config"
grep -q '^APPLEMUSIC_LANGUAGE=' "$config" || printf '%s\n' \
    '# Interface language, e.g. en-GB; empty = the store'"'"'s own language' 'APPLEMUSIC_LANGUAGE=' >> "$config"

# 3. moOde web UI: endpoint, menu script and header include.
install -o root -g root -m 0644 "$script_dir/web/applemusic.php" /var/www/applemusic.php
install -o root -g root -m 0644 "$script_dir/web/applemusic.js" /var/www/js/applemusic.js

temporary=$(mktemp /tmp/applemusic-header.XXXXXX)
trap 'rm -f -- "$temporary"' EXIT HUP INT TERM
python3 "$script_dir/patch_header.py" install "$header" "$temporary"
if ! cmp -s "$temporary" "$header"; then
    backup_dir=/var/backups/moode-applemusic/$(date +%Y%m%d-%H%M%S)-$$
    mkdir -p "$backup_dir"
    cp -a -- "$header" "$backup_dir/header.php"
    cat "$temporary" > "$header"
    echo "Patched moOde header; backup: $backup_dir/header.php"
    # Reload moOde's display so the menu entry appears.
    systemctl try-restart localdisplay.service >/dev/null 2>&1 || true
else
    echo "moOde header already contains the Apple Music include."
fi

echo "Installed. In moOde choose Library menu > Apple Music."
echo "First time only: sign in to Apple Music (see readme.md)."
