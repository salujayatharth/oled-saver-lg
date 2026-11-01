/*
 * Screensaver modes. Each mode:
 *   { name, init(w, h), frame(ctx, w, h, t, dt) }
 * t and dt are in seconds.
 *
 * OLED rules every mode follows:
 *   - Full clear to pure black each frame. No alpha-fade trails: 8-bit rounding
 *     leaves a permanent dim-grey residue, which on OLED is both visible and
 *     wears pixels. Trails are drawn from explicit position history instead.
 *   - Nothing static. Anything with a fixed shape (the clock) drifts.
 *   - Mostly-black frames; low average picture level.
 */
(function () {
  'use strict';

  var TAU = Math.PI * 2;
  function rand(a, b) { return a + Math.random() * (b - a); }
  function hsl(h, s, l, a) {
    return 'hsla(' + (h % 360) + ',' + s + '%,' + l + '%,' + (a === undefined ? 1 : a) + ')';
  }
  // Cheap smooth 2D flow: sum of sines. Good enough, no noise lib needed.
  function flow(x, y, t) {
    return Math.sin(x * 0.0021 + t * 0.13) * 1.3 +
           Math.sin(y * 0.0017 - t * 0.11) * 1.1 +
           Math.sin((x + y) * 0.0009 + t * 0.07) * 0.9;
  }

  // ---------------------------------------------------------------- Starfield
  var starfield = (function () {
    var stars = [], N = 500;
    function spawn(s, w, h, anywhere) {
      s.x = rand(-w, w);
      s.y = rand(-h, h);
      s.z = anywhere ? rand(0.05, 1) : 1;
      s.pz = s.z;
      s.hue = rand(190, 250);
    }
    return {
      name: 'Starfield',
      init: function (w, h) {
        stars = [];
        for (var i = 0; i < N; i++) { var s = {}; spawn(s, w, h, true); stars.push(s); }
      },
      frame: function (ctx, w, h, t, dt) {
        var cx = w / 2 + Math.sin(t * 0.05) * w * 0.08;
        var cy = h / 2 + Math.cos(t * 0.04) * h * 0.08;
        var speed = 0.12 * dt;
        ctx.lineCap = 'round';
        for (var i = 0; i < stars.length; i++) {
          var s = stars[i];
          s.pz = s.z;
          s.z -= speed;
          if (s.z <= 0.02) { spawn(s, w, h, false); continue; }
          var x = cx + s.x / s.z * 0.5, y = cy + s.y / s.z * 0.5;
          var px = cx + s.x / s.pz * 0.5, py = cy + s.y / s.pz * 0.5;
          if (x < 0 || x > w || y < 0 || y > h) { spawn(s, w, h, false); continue; }
          var b = 1 - s.z;
          ctx.strokeStyle = hsl(s.hue, 40, 55 + b * 35, b);
          ctx.lineWidth = 0.5 + b * 2.5;
          ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(x, y); ctx.stroke();
        }
      }
    };
  })();

  // ------------------------------------------------------------------- Aurora
  var aurora = (function () {
    var bands = [];
    return {
      name: 'Aurora',
      init: function (w, h) {
        bands = [];
        for (var i = 0; i < 5; i++) {
          bands.push({
            hue: [150, 170, 190, 280, 310][i],
            y: h * rand(0.25, 0.6),
            amp: h * rand(0.05, 0.12),
            f: rand(0.0015, 0.003),
            sp: rand(0.15, 0.35) * (i % 2 ? 1 : -1),
            ph: rand(0, TAU),
            th: h * rand(0.12, 0.25)
          });
        }
      },
      frame: function (ctx, w, h, t) {
        ctx.globalCompositeOperation = 'lighter';
        var step = 32;
        for (var b = 0; b < bands.length; b++) {
          var B = bands[b];
          for (var x = 0; x <= w; x += step) {
            var yy = B.y + Math.sin(x * B.f + t * B.sp + B.ph) * B.amp +
                     Math.sin(x * B.f * 2.3 - t * B.sp * 0.7) * B.amp * 0.4;
            var pulse = 0.5 + 0.5 * Math.sin(x * 0.004 + t * 0.4 + b);
            var g = ctx.createLinearGradient(0, yy - B.th, 0, yy + B.th * 0.3);
            g.addColorStop(0, hsl(B.hue, 80, 50, 0));
            g.addColorStop(0.75, hsl(B.hue + 20, 85, 55, 0.10 * pulse));
            g.addColorStop(1, hsl(B.hue, 80, 50, 0));
            ctx.fillStyle = g;
            ctx.fillRect(x, yy - B.th, step, B.th * 1.3);
          }
        }
        ctx.globalCompositeOperation = 'source-over';
      }
    };
  })();

  // -------------------------------------------------------------- Drift Clock
  var driftClock = (function () {
    var x, y, vx, vy, hue;
    function pad(n) { return n < 10 ? '0' + n : '' + n; }
    return {
      name: 'Drift Clock',
      init: function (w, h) {
        x = w / 2; y = h / 2; vx = 22; vy = 15; hue = rand(0, 360);
      },
      frame: function (ctx, w, h, t, dt) {
        var d = new Date();
        var time = pad(d.getHours()) + ':' + pad(d.getMinutes());
        var days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        var date = days[d.getDay()] + ' ' + d.getDate() + ' ' + months[d.getMonth()];

        ctx.font = '200 220px "SamsungOne", "Helvetica Neue", Arial, sans-serif';
        var tw = ctx.measureText(time).width;
        var bw = tw / 2 + 20, bh = 150;

        x += vx * dt; y += vy * dt;
        if (x < bw) { x = bw; vx = Math.abs(vx); }
        if (x > w - bw) { x = w - bw; vx = -Math.abs(vx); }
        if (y < bh) { y = bh; vy = Math.abs(vy); }
        if (y > h - bh) { y = h - bh; vy = -Math.abs(vy); }
        hue += dt * 3;

        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = hsl(hue, 30, 62);
        ctx.fillText(time, x, y);
        ctx.font = '300 48px "SamsungOne", "Helvetica Neue", Arial, sans-serif';
        ctx.fillStyle = hsl(hue, 20, 42);
        ctx.fillText(date, x, y + 140);
      }
    };
  })();

  // ---------------------------------------------------------------- Fireflies
  var fireflies = (function () {
    var flies = [], N = 90, HIST = 14;
    return {
      name: 'Fireflies',
      init: function (w, h) {
        flies = [];
        for (var i = 0; i < N; i++) {
          flies.push({
            x: rand(0, w), y: rand(0, h), hist: [],
            sp: rand(25, 60), ph: rand(0, TAU), rate: rand(0.3, 0.9),
            hue: rand(45, 80), r: rand(2, 4.5)
          });
        }
      },
      frame: function (ctx, w, h, t, dt) {
        ctx.globalCompositeOperation = 'lighter';
        for (var i = 0; i < flies.length; i++) {
          var f = flies[i];
          var a = flow(f.x, f.y, t) * Math.PI;
          f.x += Math.cos(a) * f.sp * dt;
          f.y += Math.sin(a) * f.sp * dt;
          if (f.x < -20) f.x = w + 20; else if (f.x > w + 20) f.x = -20;
          if (f.y < -20) f.y = h + 20; else if (f.y > h + 20) f.y = -20;
          f.hist.push(f.x, f.y);
          if (f.hist.length > HIST * 2) f.hist.splice(0, 2);

          var glow = Math.max(0, Math.sin(t * f.rate * TAU * 0.25 + f.ph));
          glow = glow * glow;
          if (glow < 0.02) continue;

          for (var k = 0; k < f.hist.length; k += 2) {
            var age = k / f.hist.length;
            ctx.fillStyle = hsl(f.hue, 90, 60, 0.06 * age * glow);
            ctx.beginPath(); ctx.arc(f.hist[k], f.hist[k + 1], f.r * 0.8, 0, TAU); ctx.fill();
          }
          var g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.r * 7);
          g.addColorStop(0, hsl(f.hue, 100, 75, 0.9 * glow));
          g.addColorStop(0.2, hsl(f.hue, 100, 55, 0.35 * glow));
          g.addColorStop(1, hsl(f.hue, 100, 40, 0));
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.arc(f.x, f.y, f.r * 7, 0, TAU); ctx.fill();
        }
        ctx.globalCompositeOperation = 'source-over';
      }
    };
  })();

  // ---------------------------------------------------------------- Lissajous
  var lissajous = (function () {
    var curves = [], HIST = 260;
    return {
      name: 'Lissajous',
      init: function () {
        curves = [];
        for (var i = 0; i < 3; i++) {
          curves.push({
            a: rand(1, 5), b: rand(1, 5), d: rand(0, TAU),
            drift: rand(-0.02, 0.02), sp: rand(0.6, 1.1),
            hue: rand(0, 360), pts: [], s: 0
          });
        }
      },
      frame: function (ctx, w, h, t, dt) {
        var cx = w / 2, cy = h / 2, rx = w * 0.36, ry = h * 0.38;
        ctx.globalCompositeOperation = 'lighter';
        ctx.lineCap = 'round';
        for (var i = 0; i < curves.length; i++) {
          var c = curves[i];
          c.d += c.drift * dt;
          c.hue += dt * 4;
          // sub-step so the path stays smooth at low frame rates
          var steps = 4;
          for (var s = 0; s < steps; s++) {
            c.s += c.sp * dt / steps;
            c.pts.push(cx + Math.sin(c.a * c.s + c.d) * rx, cy + Math.sin(c.b * c.s) * ry);
          }
          while (c.pts.length > HIST * 2) c.pts.splice(0, 2);
          for (var k = 2; k < c.pts.length; k += 2) {
            var age = k / c.pts.length;
            ctx.strokeStyle = hsl(c.hue + age * 60, 80, 60, age * 0.8);
            ctx.lineWidth = 1 + age * 2.5;
            ctx.beginPath();
            ctx.moveTo(c.pts[k - 2], c.pts[k - 1]);
            ctx.lineTo(c.pts[k], c.pts[k + 1]);
            ctx.stroke();
          }
          // occasionally re-roll the ratios so the figure keeps evolving
          if (Math.random() < dt * 0.01) { c.a = rand(1, 5); c.b = rand(1, 5); }
        }
        ctx.globalCompositeOperation = 'source-over';
      }
    };
  })();

  // ------------------------------------------------------------------ Ripples
  var ripples = (function () {
    var rings = [], acc = 0;
    return {
      name: 'Ripples',
      init: function () { rings = []; acc = 0; },
      frame: function (ctx, w, h, t, dt) {
        acc += dt;
        if (acc > 0.9) {
          acc = 0;
          rings.push({ x: rand(0, w), y: rand(0, h), r: 0, max: rand(180, 520), hue: rand(180, 260) });
        }
        for (var i = rings.length - 1; i >= 0; i--) {
          var R = rings[i];
          R.r += dt * 70;
          var life = 1 - R.r / R.max;
          if (life <= 0) { rings.splice(i, 1); continue; }
          for (var k = 0; k < 3; k++) {
            var rr = R.r - k * 26;
            if (rr <= 0) continue;
            ctx.strokeStyle = hsl(R.hue, 60, 60, life * (0.5 - k * 0.14));
            ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(R.x, R.y, rr, 0, TAU); ctx.stroke();
          }
        }
      }
    };
  })();

  window.SAVER_MODES = [starfield, aurora, driftClock, fireflies, lissajous, ripples];
})();
