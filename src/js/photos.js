/*
 * Native 4K photo slideshow via HTML5 <video> (LG Starfish media pipeline).
 *
 * On LG webOS the video element is hardware-decoded; 4K HEVC MP4 plays at
 * full resolution on the G4 and similar UHD OLEDs.
 *
 * playlist.json format (both old string[] and new object[] are accepted):
 *   { "videos": [ {"file": "painting-01.mp4", "wide": true}, ... ] }
 *   { "videos": [ "slideshow-01.mp4", ... ] }   ← legacy
 *
 * Public API: start(statusFn, opts), stop(), suspend(), restore(), next(), prev()
 *   opts: { wideOnly: bool }
 */
(function () {
  'use strict';

  var VIDEO_EXT = /\.(mp4|mkv|mov|ts|m4v)$/i;
  var allItems  = [];   // all resolved {url, wide} after loading
  var items     = [];   // filtered view (respects wideOnly)
  var idx       = 0;
  var active    = false;
  var loaded    = false;
  var wideOnly  = false;
  var onStatus  = function () {};
  var remoteSourcesUrl = null;
  var REFRESH_MS = 30 * 60 * 1000;

  // Generation counter — incremented on every stop/new-play to cancel stale callbacks
  var playGen = 0;

  var videoEl = document.getElementById('av');

  // Prefetch cache: url → XHR (in-flight or complete)
  // Warms the CDN connection + OS HTTP cache before the video element loads the URL.
  var prefetchXhrs = {};
  function prefetchUrl(url) {
    if (prefetchXhrs[url]) return;
    var x = new XMLHttpRequest();
    x.open('GET', url);
    x.timeout = 20000;
    prefetchXhrs[url] = x;
    x.send();
    log('prefetch start', url);
  }
  function cleanupPrefetch(keepUrls) {
    var keep = {};
    keepUrls.forEach(function (u) { keep[u] = true; });
    Object.keys(prefetchXhrs).forEach(function (u) {
      if (!keep[u]) {
        try { prefetchXhrs[u].abort(); } catch (e) {}
        delete prefetchXhrs[u];
        log('prefetch evict', u);
      }
    });
  }

  function log() { try { console.log.apply(console, ['[photos]'].concat([].slice.call(arguments))); } catch (e) {} }

  function getJSON(url, ok, fail) {
    var x = new XMLHttpRequest();
    x.open('GET', url + (url.indexOf('?') < 0 ? '?' : '&') + '_=' + Date.now());
    x.timeout = 5000;
    x.onload = function () {
      if (x.status >= 200 && x.status < 300 || x.status === 0) {
        try { ok(JSON.parse(x.responseText)); } catch (e) { fail(e); }
      } else fail(new Error('HTTP ' + x.status));
    };
    x.onerror = x.ontimeout = function () { fail(new Error('network')); };
    x.send();
  }

  function resolveRel(base, name) {
    if (/^[a-z]+:\/\//i.test(name)) return name;
    return base.replace(/[^\/]*$/, '') + encodeURIComponent(name).replace(/%2F/g, '/');
  }

  function normaliseEntry(base, v) {
    if (typeof v === 'string') return { url: resolveRel(base, v), wide: null };
    return { url: resolveRel(base, v.file), wide: !!v.wide };
  }

  function loadPlaylists(urls, done) {
    var pending = urls.length;
    if (!pending) return done();
    urls.forEach(function (u) {
      getJSON(u, function (pl) {
        (pl.videos || []).forEach(function (v) { allItems.push(normaliseEntry(u, v)); });
        log('playlist ok', u, (pl.videos || []).length);
        if (--pending === 0) done();
      }, function (e) {
        log('playlist failed', u, e && e.message);
        if (--pending === 0) done();
      });
    });
  }

  function load(done) {
    if (loaded) return done();
    getJSON('sources.json', function (cfg) {
      remoteSourcesUrl = cfg.remoteUrl || null;
      loadPlaylists(cfg.playlists || [], function () { loaded = true; log('allItems', allItems.length); done(); });
    }, function () { loaded = true; done(); });
  }

  // Re-fetch playlists from remote sources.json and update allItems without interrupting playback
  function refreshRemote() {
    if (!remoteSourcesUrl) return;
    getJSON(remoteSourcesUrl, function (cfg) {
      var urls = cfg.playlists || [];
      if (!urls.length) return;
      var fresh = []; var pending = urls.length;
      urls.forEach(function (u) {
        getJSON(u, function (pl) {
          (pl.videos || []).forEach(function (v) { fresh.push(normaliseEntry(u, v)); });
          if (--pending === 0 && fresh.length) {
            log('refresh: updated to', fresh.length, 'items');
            allItems = fresh;
            applyFilter();
          }
        }, function () { if (--pending === 0 && fresh.length) { allItems = fresh; applyFilter(); } });
      });
    }, function (e) { log('refresh failed', e && e.message); });
  }

  function applyFilter() {
    items = wideOnly
      ? allItems.filter(function (x) { return x.wide === true; })
      : allItems;
    if (!items.length && wideOnly) items = allItems;
    cleanupPrefetch(items.map(function (x) { return x.url; }));
  }

  function stopPlayer() {
    playGen++;
    try { videoEl.pause(); } catch (e) {}
    videoEl.removeAttribute('src');
    videoEl.load();
  }

  // nextIdx: pre-picked index for the next skip (avoids delay at skip time)
  var nextIdx = -1;
  function pickNext() {
    if (items.length <= 1) { nextIdx = 0; return; }
    var n = idx;
    while (n === idx) n = Math.floor(Math.random() * items.length);
    nextIdx = n;
  }

  function playCurrent(attempt, onReady) {
    if (!active || !items.length) return;
    attempt = attempt || 0;
    if (attempt >= items.length) { onStatus('Can\'t play any slideshow file'); return; }
    var url = items[idx % items.length].url;
    var myGen = ++playGen;
    function isStale() { return !active || playGen !== myGen; }

    try { videoEl.pause(); } catch (e) {}

    function onPlaying() {
      videoEl.removeEventListener('playing', onPlaying);
      videoEl.removeEventListener('error',   onVidError);
      if (isStale()) return;
      if (onReady) onReady();
      pickNext();
      if (nextIdx >= 0 && nextIdx < items.length) prefetchUrl(items[nextIdx].url);
    }
    function onVidError() {
      videoEl.removeEventListener('playing', onPlaying);
      videoEl.removeEventListener('error',   onVidError);
      if (isStale()) return;
      log('error loading', url, videoEl.error && videoEl.error.code);
      skipErr(attempt, onReady);
    }

    videoEl.addEventListener('playing', onPlaying);
    videoEl.addEventListener('error',   onVidError);
    videoEl.src = url;
    var playPromise = videoEl.play();
    if (playPromise && typeof playPromise.then === 'function') {
      playPromise.catch(function (e) {
        if (isStale()) return;
        log('play() rejected', url, e && e.message);
        skipErr(attempt, onReady);
      });
    }
  }

  function skipErr(attempt, onReady) {
    idx = (idx + 1) % items.length;
    setTimeout(function () { playCurrent(attempt + 1, onReady); }, 300);
  }

  // Auto-advance when a video finishes
  videoEl.addEventListener('ended', function () {
    if (!active) return;
    idx = (idx + 1) % items.length;
    playCurrent(0);
  });

  window.PHOTOS = {
    name: 'Photos (4K)',
    start: function (statusFn, opts) {
      onStatus = statusFn || onStatus;
      active   = true;
      wideOnly = !!(opts && opts.wideOnly);
      load(function () {
        if (!active) return;
        applyFilter();
        if (!items.length) { onStatus('No slideshow files found — see sources.json'); return; }
        idx = Math.floor(Math.random() * items.length);
        nextIdx = -1;
        playCurrent(0);
        if (remoteSourcesUrl) setInterval(refreshRemote, REFRESH_MS);
      });
    },
    setWideOnly: function (val) {
      if (wideOnly === val) return;
      wideOnly = val;
      applyFilter();
      idx = Math.floor(Math.random() * Math.max(1, items.length));
      if (active) playCurrent(0);
    },
    stop:    function () { active = false; stopPlayer(); },
    suspend: function () { if (active) try { videoEl.pause(); } catch (e) {} },
    restore: function () {
      if (!active) return;
      var p = videoEl.play();
      if (p && typeof p.catch === 'function') p.catch(function () { playCurrent(0); });
    },
    refresh: refreshRemote,
    next: function (onReady) {
      if (!active || !items.length) return;
      idx = (nextIdx >= 0 && nextIdx < items.length && nextIdx !== idx)
        ? nextIdx
        : (function () {
            var n = idx;
            if (items.length > 1) while (n === idx) n = Math.floor(Math.random() * items.length);
            return n;
          }());
      nextIdx = -1;
      playCurrent(0, onReady);
    },
    prev: function (onReady) {
      if (!active || !items.length) return;
      var n = idx;
      if (items.length > 1) while (n === idx) n = Math.floor(Math.random() * items.length);
      idx = n;
      nextIdx = -1;
      playCurrent(0, onReady);
    }
  };
})();
