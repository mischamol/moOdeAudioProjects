# Apple Music for moOde Audio

This project adds **Apple Music** to moOde's Library view menu, next to Radio,
Folder, Tag, Album and Playlist. Choosing it opens Apple Music Web full screen
on the Raspberry Pi's local display. A small **‹ moOde** button in Apple Music
returns to the moOde interface while the music keeps playing; moOde then shows
Apple Music on its renderer screen, like AirPlay or Spotify Connect, with
cover, title and play/pause/next/previous buttons.

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
- Widevine (`libwidevinecdm0` from the Raspberry Pi repository) and `xdotool`;
  the installer installs them when missing

## Install

```sh
cd ~/moOdeAudioProjects/AppleMusic
sudo sh ./install.sh
```

The installer:

1. installs `libwidevinecdm0` and `xdotool` if they are not installed yet (and
   remembers that);
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
  on the local display (or shows it again at once when it is already
  running). Selecting it from a phone or computer browser opens Apple Music on
  the Pi's screen as well.
- **‹ moOde** (top right in Apple Music): back to moOde. Apple Music keeps
  running and playing in the background. The button is hidden while the
  full-screen player is open, where Apple Music has its own buttons.
- **Swipe down** on the full-screen player closes it, as in the phone app
  (Apple Music Web only offers this gesture on phones).
- Command line: `sudo moode-applemusic open | hide | show | close | toggle | status`.

### Apple Music in moOde

While Apple Music runs, every moOde client (the Pi's screen, phones,
computers) shows it on moOde's renderer screen, the same screen moOde uses for
AirPlay and Spotify Connect: cover, artist, title, album, *AAC 256 kbps* and
the output format. Its buttons:

| Button | Action |
|---|---|
| ⏮ ⏯ ⏭ | previous (restarts the song after 3 s) / play-pause / next |
| ↗ | show Apple Music on the Pi's screen |
| ✕ | close Apple Music |

The Apple Music extension reports what plays once a second to
`applemusic.php` (state in `/dev/shm`, not on the SD card). That request
waits up to 0.9 s for a button press, so presses in moOde or on a remote
reach Apple Music within ~50 ms.

MPD and Apple Music share the output device; whichever starts last wins:

- Apple Music starts playing: MPD is stopped.
- Play is pressed in moOde (MPD) while Apple Music plays: Apple Music pauses
  and MPD starts. After a pause Chromium keeps the audio device open for
  ~15 s; to free it at once, the launcher restarts Chromium's audio process
  (`moode-applemusic release-audio`, done within a second). Apple Music then
  shows an error message, which the extension closes; the next play in Apple
  Music works normally.

### moOde theme

Apple Music follows the theme chosen in moOde (**Preferences → Appearance**):

- light or dark Apple Music, like the theme's text colour (Dark Glass, Default
  and other dark themes give a dark Apple Music);
- the theme's background colour for pages, navigation, mini player and
  full-screen player;
- moOde's accent colour for Apple Music's buttons and highlights;
- with moOde's *Cover backdrop* on, the full-screen player shows the cover
  blurred behind it, with moOde's blur and scale settings (static, no extra
  CPU load).

Colour changes are picked up within 30 seconds; a change between a light and
a dark theme applies the next time Apple Music opens.
`APPLEMUSIC_COLOR_SCHEME` (`auto`, `dark`, `light`) overrides light/dark.

### Siri Remote

With the [SiriRemote](../SiriRemote/readme.md) project installed:

- **Play/Pause, Previous/Next** (touchpad click left/right) control Apple
  Music while it is the source: it is playing, or it has a song paused and MPD
  is not playing. Volume keeps controlling moOde's volume (CamillaDSP), which
  also moves Apple Music's slider.
- **Menu/Back** switches between Apple Music and moOde's renderer screen.
- The remote's on-screen feedback (volume, play/pause, next, battery,
  shutdown countdown) is shown on top of Apple Music too, centred on the
  cover of the full-screen player.

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
| `APPLEMUSIC_COLOR_SCHEME` | `auto` | `auto` = light/dark like the moOde theme, or `dark` / `light` |

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
selectors), and then to ~0.3 s: while the player covers the screen, the page
underneath gets `content-visibility: hidden`, so the browser no longer
restyles it.

Time-synced lyrics blur every line that is not being sung. With lyrics open
that took ~110 % CPU in the page plus ~70 % in Chromium's GPU process, and the
lyrics stuttered (43 fps, frames up to 100 ms). The extension turns that blur
off inside the lyrics' shadow DOM: other lines are dimmed but sharp, the
word-by-word highlight stays, and the lyrics run at 60 fps with ~35 % CPU.

Apple Music Web also keeps pages you left in memory. After some browsing the
page held ~182 000 DOM nodes while showing ~900, and the Pi got steadily
slower; a reload brings it back to ~12 000. The extension therefore reloads
Apple Music when it has been idle for 10 minutes (no touch input) and nothing
plays. A paused song is kept for 30 minutes; after that the reload clears the
queue.

Tested without gain: the `performance` CPU governor (same timings as
`ondemand`), `--disable-gpu-rasterization`, `--enable-low-end-device-mode`, and
pausing moOde's own browser.

The launcher copies the extension into the Apple Music profile because
Chromium needs a writable extension folder for its network rules. The copy's
folder name contains a hash of the extension files: for an unchanged path
Chromium keeps running a cached version of the extension's service worker.

## Limitations

- Music videos and animated covers do not play (blocked for performance).

- Apple Music Web streams AAC 256 kbps; lossless is not available in the web
  player.
- Apple Music uses an extra ~350–600 MB RAM while running, also in the
  background. Close it with ✕ on moOde's renderer screen when you no longer
  need it.
- Search and browsing happen in Apple Music itself, on the Pi's screen; moOde
  only shows and controls what plays.

## Uninstall

```sh
cd ~/moOdeAudioProjects/AppleMusic
sudo sh ./uninstall.sh          # keeps settings and Apple Music sign-in
sudo sh ./uninstall.sh --purge  # also removes settings and sign-in
```

The uninstaller closes Apple Music, removes the header block (safety backup in
`/var/backups/moode-applemusic/`), removes all installed files, and removes
`libwidevinecdm0` and `xdotool` only when this project installed them.
