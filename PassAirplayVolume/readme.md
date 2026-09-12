# Pass Airplay volume to moOde audioplayer
Because my CamillaDSP setup uses volume-based loudness, I do not want external renderers such as AirPlay to control the local output volume. To prevent this, run the following patch. It comments out the part of `spspre.sh` that sets the local volume to 0 dB when an AirPlay session starts.

The standalone scripts in this folder perform the complete, validated patch
that was previously part of the combined personalization package. No extra
packages are installed.

## Install

Copy the complete folder to the Raspberry Pi and run:

```sh
cd PassAirplayVolume
sudo sh ./install.sh
```

The installer:

1. disables only the local-volume-reset block in
   `/var/local/www/commandw/spspre.sh`;
2. sets `ignore_volume_control = "yes"` in both the live Shairport
   configuration and moOde's template;
3. configures `run_this_when_volume_is_set` in both files;
4. installs the converter as
   `/usr/local/libexec/moode-personalizations/aplvol2moode.sh`;
5. restarts Shairport Sync.

It validates every candidate before changing a file and can safely be rerun
after a moOde update. Files changed by an installation are backed up below:

```text
/var/backups/moode-airplay-volume/
```

Shairport Sync uses a volume range of `-30..0`, while moOde uses `0..100`.
The hook maps `-30` to `0`, `-15` to approximately `50`, and `0` to `100`.
AirPlay mute (`-144`) becomes moOde volume `0`. The converter calls
`/var/www/util/vol.sh`, retaining moOde's normal volume path and CamillaDSP
volume-based loudness behavior.

## Uninstall

Run:

```sh
sudo sh ./uninstall.sh
```

The uninstaller removes the marked `spspre.sh` change, restores only the two
Shairport options from the latest installation backup, removes the converter,
and restarts Shairport Sync. Other changes made to those configuration files
after installation are preserved. A separate pre-uninstall safety backup is
created before files are changed.

If the required backup is missing or moOde has changed the relevant structure,
the script stops before changing files instead of guessing.

To test it manually, run the following. This should set the moOde volume to around 50.

```bash
sudo /usr/local/libexec/moode-personalizations/aplvol2moode.sh -15.0
/var/www/util/vol.sh
```

For live testing, start playback from your AirPlay device. Then open:

```text
http://moode.local/command/?cmd=get_volume
```

Change the volume on your AirPlay device, then open the same URL again:

```text
http://moode.local/command/?cmd=get_volume
```
