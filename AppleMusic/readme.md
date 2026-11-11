# Apple Music for moOde Audio

This project adds **Apple Music** to moOde's Library view menu, next to Radio,
Folder, Tag, Album and Playlist. Choosing it opens Apple Music Web full screen
on the Raspberry Pi's local display. A small **‹ moOde** button in Apple Music
closes it again and returns to the moOde interface.

Audio from Apple Music is sent to moOde's `_audioout` ALSA device, so it follows
the same output chain as MPD: with CamillaDSP enabled the sound passes through
your CamillaDSP configuration before reaching the DAC/HAT (tested with the
Audiophonics DigiPi+ / HiFiBerry Digi driver).

Apple Music runs in a separate Chromium profile
(`~/.config/moode-applemusic`). moOde clears its own browser profile every time
the local display starts; the separate profile keeps you signed in.

## Requirements

- moOde with the local display enabled (tested on moOde 10.3.7, Pi 4 2 GB,
  Touch Display 2 at 720 × 1280)
- an Apple Music subscription
- Widevine (`libwidevinecdm0` from the Raspberry Pi repository); the installer
  installs it when missing

## Install

```sh
cd ~/moOdeAudioProjects/AppleMusic
sudo sh ./install.sh
```

The installer:

1. installs `libwidevinecdm0` if it is not installed yet (and remembers that);
2. installs `/usr/local/bin/moode-applemusic` (launcher), the Chromium
   extension in `/opt/moode-applemusic/extension` and the settings file
   `/etc/default/moode-applemusic`;
3. installs `/var/www/applemusic.php` and `/var/www/js/applemusic.js`;
4. adds one marked include block to `/var/www/header.php`
   (backup in `/var/backups/moode-applemusic/`);
5. restarts the local display.

Run the installer again after a moOde update that replaces `header.php`.

## Sign in (once)

The local display has no keyboard. Either plug in a USB keyboard once, or sign
in from your computer through Chromium's remote inspector:

1. Open Apple Music on the Pi with remote debugging, and tunnel the port:

   ```sh
   ssh -L 9222:localhost:9222 mischa@moode.local "sudo moode-applemusic close; sudo moode-applemusic open --debug; sleep 1800"
   ```

2. On the computer open `edge://inspect` or `chrome://inspect`, click
   **Configure…**, add `localhost:9222`, then click **inspect** below
   *Apple Music*. The screencast in DevTools accepts mouse and keyboard
   input: click **Log in** and sign in with your Apple Account.
3. Close Apple Music with **‹ moOde** and stop the ssh command. Later starts
   from the moOde menu run without remote debugging.

## Use

- moOde Library menu → **Apple Music**: stops MPD playback and opens Apple Music
  on the local display. Selecting it from a phone or computer browser opens
  Apple Music on the Pi's screen as well.
- **‹ moOde** (top right in Apple Music): close Apple Music. It is hidden
  while the full-screen player is open, where Apple Music has its own buttons.
- **Swipe down** on the full-screen player closes it, as in the phone app
  (Apple Music Web only offers this gesture on phones).
- Command line: `sudo moode-applemusic open | close | toggle | status`.

## Volume

When CamillaDSP is active in moOde, Apple Music's volume slider controls the
**CamillaDSP main volume directly**, like the PassAirplayVolume project:

- Chromium itself always plays at full level (bit-exact into CamillaDSP); the
  slider position is sent to moOde's `/var/www/util/cdsp_volume_update.py`,
  using the same curve and dynamic range as moOde (`/etc/mpd2cdspvolume.config`).
- The slider follows CamillaDSP: turning moOde's volume knob (or a remote)
  while Apple Music is open moves the slider. The current volume is read live
  from CamillaDSP's websocket (port 1234); CamillaDSP's state file is not kept
  up to date while audio is playing, so it is only a fallback.
- moOde's own volume knob level is not changed by the slider. When Apple Music
  closes, the launcher restores it (`vol.sh -restore` and a restart of
  `mpd2cdspvolume`), as moOde does after AirPlay.
- Only volume changes made by touching the slider are sent. Apple Music
  restores its own saved volume on start-up; that value never reaches
  CamillaDSP. On start-up the slider is set to the current CamillaDSP level.

Without CamillaDSP the slider works as a normal browser volume.

## Settings

`/etc/default/moode-applemusic`:

| Setting | Default | Meaning |
|---|---|---|
| `APPLEMUSIC_URL` | `https://music.apple.com/nl/home` | start page |
| `APPLEMUSIC_ALSA_DEVICE` | `_audioout` | ALSA output; `_audioout` follows moOde (CamillaDSP) |
| `APPLEMUSIC_SCALE` | empty | empty = same scale as moOde's display; `1.5` shows more content |
| `APPLEMUSIC_STOP_MPD` | `yes` | stop MPD when Apple Music opens |
| `APPLEMUSIC_FREEZE_MOODE` | `no` | pause moOde's own browser while Apple Music is open (no measurable gain in tests) |
| `APPLEMUSIC_EXTRA_FLAGS` | empty | extra Chromium flags |

## Performance on the Pi

Apple Music Web plays animated ("motion") artwork everywhere. On a Pi 4 that
video decoding used nearly all CPU, starving CamillaDSP, which caused stutter,
display glitches and playback stopping. The bundled extension therefore:

- blocks motion artwork (`mvod.itunes.apple.com`) and hides its video
  elements, so static covers are shown;
- turns off live blur (`backdrop-filter`) and requests reduced motion;
- refuses WebGL on music.apple.com. The full-screen player otherwise draws an
  animated backdrop at ~40 fps; it now gets a static dark background, and long
  titles no longer scroll.

With this the idle CPU load of Apple Music dropped from ~80–90 % to below 1 %.
Opening the full-screen player went from ~2.5–3 s to ~1–1.5 s after replacing
CSS rules that forced the browser to restyle the whole page (`*` and `:has()`
selectors). The remaining ~1 s is style recalculation of Apple Music's own,
very large page (~16 000 DOM nodes) on the Pi's CPU.

The launcher copies the extension into the Apple Music profile because
Chromium needs a writable extension folder for its network rules. The copy's
folder name contains a hash of the extension files: for an unchanged path
Chromium keeps running a cached version of the extension's service worker.

## Limitations

- Music videos and animated covers do not play (blocked for performance).

- Apple Music Web streams AAC 256 kbps; lossless is not available in the web
  player.
- MPD and Apple Music share the output device. Pause one before playing the
  other; MPD reports *device busy* while Apple Music is playing.
- Apple Music uses an extra ~400–600 MB RAM while open.

## Uninstall

```sh
cd ~/moOdeAudioProjects/AppleMusic
sudo sh ./uninstall.sh          # keeps settings and Apple Music sign-in
sudo sh ./uninstall.sh --purge  # also removes settings and sign-in
```

The uninstaller closes Apple Music, removes the header block (safety backup in
`/var/backups/moode-applemusic/`), removes all installed files, and removes
`libwidevinecdm0` only when this project installed it.
