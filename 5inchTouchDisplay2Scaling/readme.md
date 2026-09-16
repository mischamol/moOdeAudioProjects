# 5-inch Touch Display 2 scaling for moOde

This folder contains a standalone, repeatable installer for increasing the
Chromium UI scale on a portrait 5-inch Raspberry Pi Touch Display 2. It changes
only the UID-1000 user's `~/.xinitrc`; it does not rotate the display or modify
`/boot/firmware/cmdline.txt`.

## Install

Copy this complete folder to the Raspberry Pi and run:

```sh
cd 5inchTouchDisplay2Scaling
sudo sh ./install.sh
sudo reboot
```

The default scale factor is `2`. Supply another positive integer if required:

```sh
sudo sh ./install.sh 3
sudo reboot
```

The installer validates the structure of `.xinitrc` before changing it. It is
idempotent, so it can be rerun after every moOde update without adding duplicate
lines. Before each actual change it stores a backup below:

```text
/var/backups/moode-display-scaling/
```

Internally, the managed block calculates a smaller logical Chromium window and
sets the matching device scale factor:

```sh
SCALE_FACTOR=2
WIDTH=$(( ${SCREEN_RES%,*} / SCALE_FACTOR ))
HEIGHT=$(( ${SCREEN_RES#*,} / SCALE_FACTOR ))
```

The Chromium arguments become:

```sh
--window-size="${WIDTH},${HEIGHT}" \
--force-device-scale-factor="$SCALE_FACTOR" \
```

## Uninstall

Run:

```sh
sudo sh ./uninstall.sh
sudo reboot
```

The uninstaller removes only its marked scale block and restores Chromium's
`--window-size="$SCREEN_RES"` argument. It takes a safety backup before doing so.
If the relevant moOde block has changed into an unknown layout, both scripts
stop instead of guessing.

## Landscape note

This installer intentionally targets portrait mode. For landscape mode,
`/boot/firmware/cmdline.txt` also needs an appropriate DSI rotation setting,
which is outside the scope of these scripts.

<img width="720" height="1280" alt="image" src="https://github.com/mischamol/moOdeAudioProjects/blob/main/SiriRemote/assets/moode-volume-overlay.png?raw=true" />

