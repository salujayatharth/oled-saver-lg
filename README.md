# OLED Saver — LG webOS TV

Screensaver app for LG OLED TVs (built for the G4, webOS 24). Ported from the
[Samsung Tizen version](https://github.com/salujayatharth/oled-saver).

Two kinds of modes:

- **Photos (4K)**: your images at full resolution, slow pan + crossfades.
- **Generative**: Starfield, Aurora, Drift Clock, Fireflies, Lissajous, Ripples.

## How it differs from the Samsung version

| Aspect | Samsung (Tizen) | LG (webOS) |
|--------|-----------------|------------|
| Video API | `webapis.avplay` (hardware plane) | HTML5 `<video>` (Starfish pipeline) |
| Web layer | 1080p, separate from 4K video | 1080p, video in same web layer |
| Exit | `tizen.application.getCurrentApplication().exit()` | `window.close()` |
| Back key | `10009` | `461` |
| Packaging | `.wgt` (Tizen CLI) | `.ipk` (`ares-package`) |
| Screensaver | `webapis.appcommon.setScreenSaver(OFF)` | Luna API + fullscreen video |

## 1. Make the slideshow

Same as the Samsung version — needs `ffmpeg` with libx265:

```sh
python3 tools/make_slideshow.py ~/Pictures/screensaver ./slideshow \
    --seconds 12 --fade 1.5 --shuffle
```

This writes `slideshow-01.mp4`, … and `playlist.json`.

## 2. Serve the files

Point `src/sources.json` at a URL serving `playlist.json`:

```json
{ "playlists": ["http://192.168.1.20:8000/playlist.json"], "usbFolder": "Screensaver" }
```

Or use Cloudflare R2 (see the Samsung repo's `deploy-r2.sh`).

## 3. Install

### One-time setup

1. Install CLI tools: `npm install -g @webos-tools/cli`

2. On the TV: Apps → search "Developer Mode" → install the LG Electronics app.
   Open it → sign in with LG developer account → toggle **Dev Mode ON** → reboot.
   Reopen → toggle **Key Server ON** → note the 6-char passphrase.

3. Register the TV on your Mac:
   ```sh
   bash setup-lg.sh <tv-ip> <passphrase>
   ```

### Deploy

```sh
bash deploy.sh
```

This packages `src/` into an `.ipk`, installs it, and launches the app.

## Remote

| Key | Action |
|---|---|
| ◀ / ▶ (or CH −/+) | previous / next mode |
| ▲ / ▼ | brightness (20–100%) |
| OK (short press) | toggle Photos ↔ Generative |
| OK (hold 0.7 s) | open Settings |
| BACK | exit |

In Photos mode, ◀ / ▶ skip to the previous / next painting with a fade.

## Develop

Open `src/index.html` in a browser at 1920×1080. Arrow keys and Esc work.
Photos mode needs the TV (HTML5 autoplay policy blocks it in desktop browsers).

For live iteration without reinstalling:

```sh
ares-launch -H ./src -d oledsaver-tv
```

To add a generative mode, append a `{name, init(w,h), frame(ctx,w,h,t,dt)}` object
to `SAVER_MODES` in `src/js/modes.js`. Fill to pure black each frame; use
position-history trails instead of alpha fades (avoids grey pixel residue on OLED).

## Notes

- The `screenSaverProperties: { preferredType: 2 }` in `appinfo.json` extends
  the TV's own screensaver timeout to 30 minutes while the app is running.
- Full-screen video playback also suppresses the system screensaver entirely.
- For generative modes the app vetoes the system screensaver via an undocumented
  Luna API (`com.webos.service.tvpower`). This works on webOS 6+ but may not on
  all firmware versions.
