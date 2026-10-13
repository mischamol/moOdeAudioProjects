#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
UNIT_NAME=moode-startup-shutdown-screen.service
UNIT_PATH=/etc/systemd/system/$UNIT_NAME
STARTUP_UNIT_NAME=moode-startup-screen.service
STARTUP_UNIT_PATH=/etc/systemd/system/$STARTUP_UNIT_NAME

if [ ! -f "$SCRIPT_DIR/moode-logotype.png" ]; then
    echo "Missing $SCRIPT_DIR/moode-logotype.png" >&2
    exit 1
fi

if ! command -v ffmpeg >/dev/null 2>&1; then
    echo "ffmpeg is required but was not found; no files were installed" >&2
    exit 1
fi

if [ ! -r /sys/class/graphics/fb0/bits_per_pixel ] || \
   [ "$(cat /sys/class/graphics/fb0/bits_per_pixel)" != "16" ]; then
    echo "/dev/fb0 must be an available 16-bit RGB565 framebuffer" >&2
    exit 1
fi

if [ ! -r /usr/share/fonts/truetype/lato/Lato-Regular.ttf ] && \
   [ ! -r /usr/share/fonts/truetype/dejavu/DejaVuSans.ttf ] && \
   [ ! -r /var/www/fonts/Lato-Regular.ttf ]; then
    echo "No supported Lato or DejaVu Sans font was found" >&2
    exit 1
fi

install -D -m 0755 \
    "$SCRIPT_DIR/moode_startup_shutdown_screen.py" \
    /usr/local/bin/moode-startup-shutdown-screen
install -D -m 0644 \
    "$SCRIPT_DIR/moode-logotype.png" \
    /usr/local/share/moode-startup-shutdown/moode-logotype.png

install -m 0644 \
    "$SCRIPT_DIR/moode-startup-shutdown-screen.service" \
    "$UNIT_PATH"
install -m 0644 \
    "$SCRIPT_DIR/moode-startup-screen.service" \
    "$STARTUP_UNIT_PATH"

systemctl daemon-reload
systemctl stop "$UNIT_NAME" 2>/dev/null || true
systemctl stop "$STARTUP_UNIT_NAME" 2>/dev/null || true
# Remove the target link used by the initial, later-starting implementation.
rm -f "/etc/systemd/system/multi-user.target.wants/$STARTUP_UNIT_NAME"
systemctl enable "$UNIT_NAME" "$STARTUP_UNIT_NAME"

echo "Installed $UNIT_NAME."
echo "The framebuffer screen will appear on the next boot and shutdown."
