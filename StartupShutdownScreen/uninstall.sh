#!/bin/sh
set -eu

UNIT_NAME=moode-startup-shutdown-screen.service
STARTUP_UNIT_NAME=moode-startup-screen.service

systemctl disable --now "$UNIT_NAME" 2>/dev/null || true
systemctl disable --now "$STARTUP_UNIT_NAME" 2>/dev/null || true
rm -f "/etc/systemd/system/multi-user.target.wants/$STARTUP_UNIT_NAME"
rm -f \
    "/etc/systemd/system/$UNIT_NAME" \
    "/etc/systemd/system/$STARTUP_UNIT_NAME" \
    /usr/local/bin/moode-startup-shutdown-screen \
    /usr/local/share/moode-startup-shutdown/moode-logotype.png
rmdir /usr/local/share/moode-startup-shutdown 2>/dev/null || true
systemctl daemon-reload
systemctl reset-failed "$UNIT_NAME" 2>/dev/null || true
systemctl reset-failed "$STARTUP_UNIT_NAME" 2>/dev/null || true

echo "Removed $UNIT_NAME."
