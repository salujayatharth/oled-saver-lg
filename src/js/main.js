(function () {
  'use strict';

  var PHOTOS = window.PHOTOS;
  var MODES = [PHOTOS].concat(window.SAVER_MODES);
  function isVideo(i) { return MODES[i] === PHOTOS; }

  var OSD_SECONDS = 3;

  // LG Magic Remote key codes
  var KEY = {
    LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, ENTER: 13,
    BACK: 461, ESC: 27, BACKSPACE: 8,
    CH_UP: 427, CH_DOWN: 428,
    PLAY: 415, PAUSE: 19
  };

  var canvas  = document.getElementById('c');
  var ctx     = canvas.getContext('2d', { alpha: false });
  var dimEl   = document.getElementById('dim');
  var osd     = document.getElementById('osd');
  var osdName = document.getElementById('osd-name');
  var settingsEl = document.getElementById('settings');

  var state = load({
    mode: 0,
    brightness: 0.9,
    cycle: false,
    crossfade: 2.0,
    skipDip: 0.82,
    wideOnly: false,
    lastGenerated: 1,
    photoMat: 'off'
  });

  var W = 0, H = 0;
  var current    = clampMode(state.mode);
  var pending    = -1;
  var fade       = 1;
  var sinceCycle = 0;
  var osdTimer   = null;
  var last = 0, t = 0, lastDim = -1;

  // Photo skip fade (separate from mode-switch fade)
  var photoSkip        = 0;
  var photoSkipFn      = null;
  var photoSkipReady   = false;
  var photoSkipTimeout = 0;

  // Settings panel
  var settingsOpen   = false;
  var settingsCursor = 0;
  var okTimer        = null;

  var SETTING_DEFS = [
    {
      label: 'Photos',
      get: function () { return state.wideOnly; },
      values: [false, true], display: ['All', 'Widescreen only'],
      set: function (v) {
        state.wideOnly = v;
        if (isVideo(current)) PHOTOS.setWideOnly(v);
      }
    },
    {
      label: 'Crossfade',
      get: function () { return state.crossfade; },
      values: [0.5, 1.0, 2.0, 3.5], display: ['0.5s', '1s', '2s', '3.5s'],
      set: function (v) { state.crossfade = v; }
    },
    {
      label: 'Skip Fade',
      get: function () { return state.skipDip; },
      values: [0.5, 0.82, 1.0], display: ['Soft', 'Dissolve', 'Black'],
      set: function (v) { state.skipDip = v; }
    },
    {
      label: 'Auto-cycle Modes',
      get: function () { return state.cycle; },
      values: [false, true], display: ['Off', 'On'],
      set: function (v) { state.cycle = v; sinceCycle = 0; }
    },
    {
      label: 'Photo Mat',
      get: function () { return state.photoMat; },
      values: ['off', 'thin', 'classic'], display: ['Off', 'Thin', 'Classic'],
      set: function (v) { state.photoMat = v; applyMat(); }
    },
    {
      label: 'Refresh Playlist',
      get: function () { return 'now'; },
      values: ['now'], display: ['Press OK'],
      action: function () { PHOTOS.refresh(); showOsd('Refreshing playlist…', true); closeSettings(); }
    }
  ];

  // --- persistence
  function load(def) {
    try {
      var s = JSON.parse(localStorage.getItem('oledsaver') || 'null');
      if (s) for (var k in def) if (!(k in s)) s[k] = def[k];
      return s || def;
    } catch (e) { return def; }
  }
  function save() {
    try { localStorage.setItem('oledsaver', JSON.stringify(state)); } catch (e) {}
  }
  function clampMode(i) { return ((i % MODES.length) + MODES.length) % MODES.length; }

  // --- TV integration
  function tvSetup() {
    // Prevent system screensaver during generative modes via undocumented Luna API.
    // During video playback the system screensaver is automatically suppressed.
    try {
      if (typeof WebOSServiceBridge !== 'undefined') {
        var bridge = new WebOSServiceBridge();
        bridge.call(
          'luna://com.webos.service.tvpower/power/registerScreenSaverRequest',
          JSON.stringify({ subscribe: true, clientName: 'OledSaver' })
        );
        bridge.onservicecallback = function (msg) {
          try {
            var m = JSON.parse(msg);
            if (m.timestamp !== undefined) {
              var r = new WebOSServiceBridge();
              r.call(
                'luna://com.webos.service.tvpower/power/responseScreenSaverRequest',
                JSON.stringify({ clientName: 'OledSaver', ack: false, timestamp: m.timestamp })
              );
            }
          } catch (e) {}
        };
      }
    } catch (e) {}
  }

  function exitApp() {
    PHOTOS.stop();
    window.close();
  }

  function resize() {
    W = canvas.width  = window.innerWidth  || 1920;
    H = canvas.height = window.innerHeight || 1080;
    if (!isVideo(current)) MODES[current].init(W, H);
  }

  function applyMat() {
    document.body.classList.remove('frame-thin');
    document.body.classList.remove('frame-classic');
    if (state.photoMat !== 'off') document.body.classList.add('frame-' + state.photoMat);
  }

  // --- mode lifecycle
  function enter(i) {
    if (isVideo(i)) {
      document.body.className = 'video';
      applyMat();
      PHOTOS.start(function (msg) { showOsd(msg, true); }, { wideOnly: state.wideOnly });
    } else {
      document.body.className = '';
      MODES[i].init(W, H);
    }
  }
  function leave(i) {
    if (isVideo(i)) PHOTOS.stop();
    else state.lastGenerated = i;
  }

  function switchTo(i) {
    pending    = clampMode(i);
    photoSkip  = 0;
    sinceCycle = 0;
    showOsd(MODES[pending].name);
  }
  function showOsd(text, sticky) {
    osdName.textContent = text;
    osd.className = '';
    clearTimeout(osdTimer);
    osdTimer = setTimeout(function () { osd.className = 'hidden'; }, (sticky ? 8 : OSD_SECONDS) * 1000);
  }

  // --- photo skip with fade-through-black
  function doPhotoSkip(forward) {
    if (photoSkip !== 0 || pending >= 0) return;
    photoSkipReady = false;
    var cb = function () { photoSkipReady = true; };
    photoSkipFn = forward
      ? function () { PHOTOS.next(cb); }
      : function () { PHOTOS.prev(cb); };
    photoSkip = 1;
  }

  // --- settings panel
  function openSettings() {
    settingsOpen   = true;
    settingsCursor = 0;
    renderSettings();
    settingsEl.classList.remove('hidden');
  }
  function closeSettings() {
    settingsOpen = false;
    settingsEl.classList.add('hidden');
    save();
  }
  function renderSettings() {
    var list = document.getElementById('settings-list');
    list.innerHTML = '';
    SETTING_DEFS.forEach(function (def, i) {
      var val   = def.get();
      var vi    = def.values.indexOf(val);
      var label = def.display[vi >= 0 ? vi : 0];
      var item  = document.createElement('div');
      item.className = 'settings-item' + (i === settingsCursor ? ' active' : '');
      item.innerHTML =
        '<span class="s-label">' + def.label + '</span>' +
        '<span class="s-val">◀  ' + label + '  ▶</span>';
      list.appendChild(item);
    });
  }
  function settingsStep(dir) {
    var def = SETTING_DEFS[settingsCursor];
    if (def.action) { def.action(); return; }
    var vi  = def.values.indexOf(def.get());
    if (vi < 0) vi = 0;
    def.set(def.values[(vi + dir + def.values.length) % def.values.length]);
    renderSettings();
  }
  function handleSettingsKey(e) {
    switch (e.keyCode) {
      case KEY.UP:    settingsCursor = (settingsCursor - 1 + SETTING_DEFS.length) % SETTING_DEFS.length; renderSettings(); break;
      case KEY.DOWN:  settingsCursor = (settingsCursor + 1) % SETTING_DEFS.length; renderSettings(); break;
      case KEY.LEFT:  settingsStep(-1); break;
      case KEY.RIGHT: settingsStep(1);  break;
      case KEY.ENTER: settingsStep(1);  break;
      case KEY.BACK: case KEY.ESC: closeSettings(); break;
    }
    e.preventDefault();
  }

  // --- input: keydown
  document.addEventListener('keydown', function (e) {
    if (settingsOpen) { handleSettingsKey(e); return; }

    var base     = pending >= 0 ? pending : current;
    var inPhotos = isVideo(base);

    switch (e.keyCode) {
      case KEY.ENTER:
        okTimer = setTimeout(function () { okTimer = null; openSettings(); }, 700);
        e.preventDefault();
        return;

      case KEY.PLAY:
      case KEY.PAUSE:
        if (inPhotos) switchTo(clampMode(state.lastGenerated || 1));
        else { state.lastGenerated = current; switchTo(0); }
        break;

      case KEY.RIGHT:
        if (inPhotos) { doPhotoSkip(true); showOsd('Next'); }
        else switchTo(base + 1);
        break;

      case KEY.LEFT:
        if (inPhotos) { doPhotoSkip(false); showOsd('Prev'); }
        else switchTo(base - 1);
        break;

      case KEY.CH_UP:   switchTo(base + 1); break;
      case KEY.CH_DOWN: switchTo(base - 1); break;

      case KEY.UP:
        state.brightness = Math.min(1, +(state.brightness + 0.1).toFixed(2));
        showOsd('Brightness ' + Math.round(state.brightness * 100) + '%'); save(); break;

      case KEY.DOWN:
        state.brightness = Math.max(0.2, +(state.brightness - 0.1).toFixed(2));
        showOsd('Brightness ' + Math.round(state.brightness * 100) + '%'); save(); break;

      case KEY.BACK: case KEY.ESC: case KEY.BACKSPACE:
        exitApp(); break;

      default: return;
    }
    e.preventDefault();
  });

  // --- input: keyup (short-press OK detection)
  document.addEventListener('keyup', function (e) {
    if (e.keyCode !== KEY.ENTER) return;
    if (okTimer === null) return;
    clearTimeout(okTimer);
    okTimer = null;
    if (settingsOpen) return;
    var base     = pending >= 0 ? pending : current;
    var inPhotos = isVideo(base);
    if (inPhotos) switchTo(clampMode(state.lastGenerated || 1));
    else { state.lastGenerated = current; switchTo(0); }
    e.preventDefault();
  });

  // --- main loop
  function frame(now) {
    requestAnimationFrame(frame);
    var dt = last ? Math.min((now - last) / 1000, 0.1) : 1 / 60;
    last = now;
    t   += dt;

    if (state.cycle && pending < 0 && photoSkip === 0 && !isVideo(current)) {
      sinceCycle += dt;
      if (sinceCycle >= 5 * 60) {
        var nxt = current + 1;
        if (isVideo(clampMode(nxt))) nxt++;
        switchTo(nxt);
      }
    }

    var cf = state.crossfade || 2.0;

    if (pending >= 0) {
      fade += dt / (cf / 2);
      if (fade >= 1) {
        fade = 1;
        leave(current);
        current = pending; pending = -1;
        state.mode = current; save();
        enter(current);
      }
    } else if (photoSkip === 1) {
      var dip = state.skipDip || 0.82;
      fade = Math.min(dip, fade + dt / cf);
      if (fade >= dip) {
        photoSkipFn();
        photoSkipTimeout = 4;
        photoSkip = 3;
      }
    } else if (photoSkip === 3) {
      photoSkipTimeout -= dt;
      if (photoSkipReady || photoSkipTimeout <= 0) photoSkip = 2;
    } else if (photoSkip === 2) {
      fade = Math.max(0, fade - dt / cf);
      if (fade <= 0) photoSkip = 0;
    } else if (fade > 0) {
      fade = Math.max(0, fade - dt / (cf / 2));
    }

    if (!isVideo(current)) {
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);
      ctx.save();
      MODES[current].frame(ctx, W, H, t, dt);
      ctx.restore();
    }

    var dim = 1 - state.brightness * (1 - fade);
    dim = Math.round(dim * 1000) / 1000;
    if (dim !== lastDim) { dimEl.style.opacity = dim; lastDim = dim; }
  }

  document.addEventListener('visibilitychange', function () {
    last = 0;
    if (!isVideo(current)) return;
    if (document.hidden) PHOTOS.suspend(); else PHOTOS.restore();
  });

  tvSetup();
  window.addEventListener('resize', resize);
  resize();
  enter(current);
  showOsd(MODES[current].name);
  requestAnimationFrame(frame);
})();
