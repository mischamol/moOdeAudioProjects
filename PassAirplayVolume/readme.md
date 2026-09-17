# Pass AirPlay volume directly to CamillaDSP

This patch sends AirPlay volume directly to CamillaDSP. The stored moOde/MPD
volume remains unchanged while AirPlay is active. When AirPlay stops, moOde's
existing `spspost.sh` restores the local volume and restarts
`mpd2cdspvolume`.

The patch does not modify moOde's `spspre.sh`, `spspost.sh`, web interface, or
database. It only changes the live Shairport configuration and its moOde
template, plus installing one standalone volume-conversion script. No extra
packages are installed.

## Install

Copy the complete folder to the Raspberry Pi and run:

```sh
cd PassAirplayVolume
sudo sh ./install.sh
```

The installer:

1. sets `ignore_volume_control = "yes"` in `/etc/shairport-sync.conf` and
   `/etc/shairport-sync.sed.conf`;
2. points `run_this_when_volume_is_set` in those files to the standalone hook;
3. installs the hook as
   `/usr/local/libexec/moode-personalizations/aplvol2moode.sh`;
4. restarts Shairport Sync if it is already running.

The installer validates candidate files before changing them and can safely be
rerun after a moOde update. Original Shairport settings used by the uninstaller
are kept under `/var/lib/moode-airplay-volume/`. Per-run safety backups are
stored below `/var/backups/moode-airplay-volume/`.

Shairport Sync reports volume in the range `-30..0`. The hook maps `-30` to
`0`, `-15` to approximately `50`, and `0` to `100`; AirPlay mute (`-144`)
becomes `0`. It passes that percentage to moOde's official
`/var/www/util/cdsp_volume_update.py`, which updates CamillaDSP directly.

## Uninstall

Run:

```sh
sudo sh ./uninstall.sh
```

The uninstaller restores only the two managed Shairport options, removes the
standalone hook, and restarts Shairport Sync if it is running. Other changes in
those files are preserved. It stops without changing anything if the required
original settings are unavailable or the managed configuration is incomplete.

## Test

First note the current local volume:

```sh
/var/www/util/vol.sh
```

Start AirPlay and change the volume on the sending device. Query the local
moOde volume again:

```sh
/var/www/util/vol.sh
```

The value should be unchanged because AirPlay now controls only CamillaDSP's
live volume.
