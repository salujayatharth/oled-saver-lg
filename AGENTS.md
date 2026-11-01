# OLED Saver LG — Agent Guide

LG webOS app (G4, webOS 24). Same screensaver as the Samsung Tizen version but
ported to LG's HTML5 video API and `ares-*` toolchain.

## Architecture

```
src/               webOS app source
  appinfo.json     App manifest (id: com.oledscreensaver.app)
  index.html
  css/style.css
  js/
    modes.js       Generative canvas modes (identical to Samsung version)
    photos.js      4K slideshow via HTML5 <video> (Starfish pipeline)
    main.js        Input handling, mode switching, settings panel, fade engine
  sources.json     { "playlists": ["http://HOST:8000/playlist.json"] }

tools/             (symlink or copy from Samsung repo)
  make_slideshow.py

build_lg/          Generated — ares-package output (.ipk), do not commit
```

## Key Facts

- TV: LG G4 OLED, IP YOUR_TV_IP
- Mac (dev): YOUR_MAC_IP
- webOS CLI device name: `oledsaver-tv`
- App ID: `com.oledscreensaver.app`
- CLI: `@webos-tools/cli` (`npm install -g @webos-tools/cli`)

## Key Differences vs Samsung

| Feature | Samsung | LG |
|---------|---------|-----|
| Video API | `webapis.avplay` | HTML5 `<video>` |
| "Playing" signal | `prepareAsync` callback | `playing` event |
| "Stream ended" | `onstreamcompleted` listener | `ended` event |
| Exit | `tizen.application.…exit()` | `window.close()` |
| Back key | `10009` | `461` |
| Play/Pause | `10252` | `415` / `19` (separate) |
| Key registration | `tizen.tvinputdevice.registerKey()` | not needed |
| Screensaver | `webapis.appcommon.setScreenSaver(OFF)` | Luna API (undocumented) |
| Packaging | `.wgt` | `.ipk` |
| Deploy | `tizen package` + `tizen install` | `ares-package` + `ares-install` |

## Playlist Format

Same as Samsung:
```json
{
  "videos": [
    { "file": "painting-01.mp4", "wide": true },
    { "file": "painting-02.mp4", "wide": false }
  ]
}
```

## Build & Deploy

```bash
bash deploy.sh           # package + install + run
ares-launch -H ./src -d oledsaver-tv   # live-serve without reinstall
```

## Developer Mode Lifecycle

- Developer mode expires periodically; tap "Extend" in the app before it expires
- Key Server must also be ON for SSH key fetch
- Installed apps survive Developer Mode session expiry

## Screensaver Prevention

- `appinfo.json`: `screenSaverProperties.preferredType: 2` → extends timeout to 30 min
- Video playback: system screensaver fully suppressed during fullscreen video
- Generative modes: undocumented Luna API veto in `tvSetup()` in main.js

## Common Issues

| Problem | Fix |
|---------|-----|
| `ares-novacom: passphrase wrong` | Re-open Developer Mode app on TV; toggle Key Server OFF/ON to reset passphrase |
| `ares-install: device not found` | Run `ares-setup-device --list`; re-run `setup-lg.sh` if missing |
| Video won't autoplay | Must be `muted`; check the `<video muted>` attribute |
| Screensaver still appears in generative modes | Luna API may not work on this firmware; upgrade to webOS 6+ |
