#!/bin/sh
set -eu

airplay_volume=${1:?AirPlay volume argument is required}

# Shairport Sync uses -144 for mute and normally reports volume from -30..0.
if awk -v value="$airplay_volume" 'BEGIN { exit !(value <= -143.0) }'; then
    level=0
else
    level=$(awk -v value="$airplay_volume" 'BEGIN {
        percentage = ((value + 30.0) / 30.0) * 100.0
        if (percentage < 0) percentage = 0
        if (percentage > 100) percentage = 100
        printf "%d", percentage + 0.5
    }')
fi

cdsp_volume_update=/var/www/util/cdsp_volume_update.py

if ! "$cdsp_volume_update" -l "$level" >/dev/null 2>&1; then
    logger -t moode-airplay-volume "Could not set CamillaDSP volume to $level%"
    exit 1
fi
