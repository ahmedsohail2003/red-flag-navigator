'use strict';
// Laptop side: receive motion batches over Server-Sent Events and turn turning speed into a Wii-style pointer.
// Pointer = integrated gyroscope (an "air mouse"), the same idea Dolphin's IMU pointing uses: no camera, so it
// drifts slowly; Recenter (or R) puts it back in the middle.
(() => {
  const $ = (id) => document.getElementById(id);
  const DEFAULTS = { mode: 'auto', gain: 20, dead: 1, swing: 300, invx: false, invy: false };
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('gyroStarter.cfg') || '{}') || {}; } catch (_) { saved = {}; }
  const cfg = Object.assign({}, DEFAULTS, saved);
  const save = () => localStorage.setItem('gyroStarter.cfg', JSON.stringify(cfg));

  const canvas = $('canvas');
  const ctx = canvas.getContext('2d');
  const plot = $('plot');
  const pctx = plot.getContext('2d');
  const HISTORY = 300; // samples in the plot (5 s at 60 Hz)

  const st = {
    sources: new Map(), // device name -> per-device state
    active: '',         // first device that sent samples
    chosen: '',         // device picked in the "Drives the pointer" menu ('' = first to connect)
    x: 0, y: 0, w: 0, h: 0, placed: false,
    score: 0, swings: 0, swingFlash: null, bursts: [], misses: [],
    targets: [], history: [],
    connected: false, recording: false,
  };
  window.__gyro = { st, cfg }; // for debugging from the console

  const fin = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const activeName = () => st.chosen || st.active;
  const escapeHtml = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- controls
  function bindRange(id, key, unit) {
    const el = $(id);
    const out = $(id + 'v');
    el.value = cfg[key];
    const show = () => { out.textContent = cfg[key] + unit; };
    el.addEventListener('input', () => { cfg[key] = Number(el.value); show(); save(); });
    show();
  }
  bindRange('gain', 'gain', ' px/°');
  bindRange('dead', 'dead', ' °/s');
  bindRange('swing', 'swing', ' °/s');
  for (const key of ['invx', 'invy']) {
    const el = $(key);
    el.checked = !!cfg[key];
    el.addEventListener('change', () => { cfg[key] = el.checked; save(); });
  }
  $('mode').value = cfg.mode;
  $('mode').addEventListener('change', () => { cfg.mode = $('mode').value; save(); });
  $('active').addEventListener('change', () => { st.chosen = $('active').value; });

  $('rec').addEventListener('click', () => {
    fetch('record', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ on: !st.recording }),
    }).then((r) => r.json()).then((res) => {
      applyRecord(res.recording ? { on: true, path: res.path } : Object.assign({ on: false }, res.result || {}));
    }).catch((err) => { $('recinfo').textContent = 'Recording request failed: ' + err.message; });
  });

  function applyRecord(m) {
    st.recording = !!m.on;
    $('rec').textContent = st.recording ? 'Stop recording' : 'Start recording';
    $('recinfo').textContent = st.recording
      ? 'Recording to ' + m.path
      : (m.path ? `Saved ${m.rows} rows (${m.seconds} s) to ${m.path}`
        : 'Saves every sample and button press to a CSV in gyro-starter/recordings/.');
  }

  // ---------- layout and targets
  function newTarget() {
    const m = 70;
    let t;
    for (let tries = 0; tries < 25; tries++) { // keep targets apart so they never overlap
      t = { x: m + Math.random() * Math.max(1, st.w - 2 * m), y: m + Math.random() * Math.max(1, st.h - 2 * m), r: 40 };
      if (st.targets.every((o) => Math.hypot(o.x - t.x, o.y - t.y) > o.r + t.r + 30)) break;
    }
    return t;
  }
  function recenter() { st.x = st.w / 2; st.y = st.h / 2; }

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const r = canvas.getBoundingClientRect();
    st.w = r.width;
    st.h = r.height;
    canvas.width = Math.max(1, Math.round(r.width * dpr));
    canvas.height = Math.max(1, Math.round(r.height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const pr = plot.getBoundingClientRect();
    plot.width = Math.max(1, Math.round(pr.width * dpr));
    plot.height = Math.max(1, Math.round(pr.height * dpr));
    pctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!st.placed && st.w > 0 && st.h > 0) { // first real size (a tab opened in the background starts at 0 x 0)
      recenter();
      st.targets = [];
      st.placed = true;
    }
    st.x = clamp(st.x, 0, st.w);
    st.y = clamp(st.y, 0, st.h);
    st.targets = st.targets.map((t) => (t.x < st.w - 40 && t.y < st.h - 40 ? t : newTarget()));
    while (st.targets.length < 3) st.targets.push(newTarget());
  }
  window.addEventListener('resize', resize);

  // ---------- devices
  function sourceFor(name) {
    let s = st.sources.get(name);
    if (!s) {
      s = { name, lastT: null, total: 0, hz: 0, winStart: performance.now(), winCount: 0, lastSeen: 0,
        grip: 'flat', last: null, lastSwingT: -Infinity, buttons: {} };
      st.sources.set(name, s);
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      $('active').appendChild(opt);
    }
    return s;
  }

  // Which way is the phone held? Gravity mostly along the screen's z axis = flat; along y = upright.
  function gripOf(src, s) {
    if (cfg.mode !== 'auto') return cfg.mode;
    const ay = Math.abs(fin(s.ay));
    const az = Math.abs(fin(s.az));
    if (az > 1.3 * ay) src.grip = 'flat';
    else if (ay > 1.3 * az) src.grip = 'upright';
    return src.grip; // in between: keep the last decision
  }

  function onSample(src, s) {
    const now = performance.now();
    src.total++;
    src.winCount++;
    src.lastSeen = now;
    src.last = s;
    if (!st.active) st.active = src.name;

    // time step from the device's own clock, so network bunching does not change the pointer speed
    let dt = 0;
    if (typeof s.t === 'number') {
      if (typeof src.lastT === 'number') {
        dt = (s.t - src.lastT) / 1000;
        if (!(dt > 0 && dt < 0.25)) dt = 0; // first sample, reordering or a gap: do not integrate
      }
      src.lastT = s.t;
    }

    const gx = fin(s.gx), gy = fin(s.gy), gz = fin(s.gz);
    const mine = src.name === activeName();

    // swing = total turning speed above the threshold, at most one per 350 ms of device time
    const speed = Math.hypot(gx, gy, gz);
    const tDev = typeof s.t === 'number' ? s.t : now;
    if (speed > cfg.swing && tDev - src.lastSwingT > 350) {
      src.lastSwingT = tDev;
      if (mine) {
        st.swings++;
        st.swingFlash = { text: 'SWING  ' + Math.round(speed) + ' °/s', until: now + 700 };
      }
    }
    if (!mine) return;

    st.history.push([gx, gy, gz]);
    if (st.history.length > HISTORY) st.history.splice(0, st.history.length - HISTORY);
    if (src.buttons.B) return; // clutch: while B is held the pointer stays put
    if (speed > cfg.swing) return; // a swing should not fling the pointer across the screen

    // Device axes (web and CoreMotion): x = right edge, y = top edge, z = out of the screen.
    // Flat grip (screen up, top toward the laptop): turning left = +z rotation, tilting the top up = +x.
    // Upright grip (screen toward you, camera toward the laptop): turning left = +y, tilting up = +x.
    const yaw = gripOf(src, s) === 'flat' ? gz : gy;
    const pitch = gx;
    const dz = (v) => (Math.abs(v) < cfg.dead ? 0 : v);
    st.x = clamp(st.x - (cfg.invx ? -1 : 1) * dz(yaw) * dt * cfg.gain, 0, st.w);
    st.y = clamp(st.y - (cfg.invy ? -1 : 1) * dz(pitch) * dt * cfg.gain, 0, st.h);
  }

  function pressA() {
    const now = performance.now();
    const i = st.targets.findIndex((t) => Math.hypot(st.x - t.x, st.y - t.y) <= t.r);
    if (i >= 0) {
      const t = st.targets[i];
      st.bursts.push({ x: t.x, y: t.y, until: now + 500 });
      st.targets[i] = newTarget();
      st.score++;
      $('score').textContent = st.score;
    } else {
      st.misses.push({ x: st.x, y: st.y, until: now + 300 });
    }
  }

  function onEvent(src, e) {
    if (e.type === 'button' && typeof e.id === 'string') {
      src.buttons[e.id] = !!e.down;
      if (src.name === activeName() && e.id === 'A' && e.down) pressA();
    } else if (e.type === 'recenter' && src.name === activeName()) {
      recenter();
    }
  }

  window.addEventListener('keydown', (e) => {
    if (e.target && /^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(e.target.tagName)) return;
    if (e.key === 'r' || e.key === 'R') recenter();
    else if (e.key === ' ') { e.preventDefault(); pressA(); }
  });

  // ---------- stream from the server
  function connect() {
    const es = new EventSource('events');
    es.onopen = () => { st.connected = true; };
    es.onerror = () => { st.connected = false; }; // EventSource reconnects by itself
    es.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (_) { return; }
      if (msg.type === 'batch') {
        const src = sourceFor(String(msg.source || 'unknown'));
        for (const s of msg.samples || []) onSample(src, s);
        for (const e of msg.events || []) onEvent(src, e);
      } else if (msg.type === 'record') {
        applyRecord(msg);
      }
    };
  }

  // ---------- side panel
  function refreshPanel() {
    const now = performance.now();
    $('conn').textContent = st.connected ? 'live' : 'reconnecting';
    $('conn').className = 'pill ' + (st.connected ? 'ok' : 'bad');
    const rows = [];
    for (const s of st.sources.values()) {
      const span = now - s.winStart;
      if (span >= 1000) { s.hz = s.winCount * 1000 / span; s.winCount = 0; s.winStart = now; }
      const ago = (now - s.lastSeen) / 1000;
      const state = ago < 2 ? s.hz.toFixed(0) + ' Hz' : 'idle ' + ago.toFixed(0) + ' s';
      rows.push(`<div><span>${escapeHtml(s.name)}${s.name === activeName() ? ' (pointer)' : ''}</span><span>${state}</span></div>`);
    }
    if (rows.length) $('sources').innerHTML = rows.join('');
    $('swings').textContent = st.swings + (st.swings === 1 ? ' swing' : ' swings');
    const src = st.sources.get(activeName());
    const s = src && src.last;
    if (s) {
      const f = (v) => (v == null ? '–' : Number(v).toFixed(1)).padStart(7);
      const grip = cfg.mode === 'auto' ? src.grip + ' (auto)' : cfg.mode;
      $('now').textContent = `gyro  x${f(s.gx)} y${f(s.gy)} z${f(s.gz)}\naccel x${f(s.ax)} y${f(s.ay)} z${f(s.az)}\ngrip  ${grip}`;
    }
  }

  // ---------- drawing
  function drawPlot() {
    const w = plot.clientWidth;
    const h = plot.clientHeight;
    pctx.clearRect(0, 0, w, h);
    let peak = 100;
    for (const p of st.history) peak = Math.max(peak, Math.abs(p[0]), Math.abs(p[1]), Math.abs(p[2]));
    const lim = Math.ceil(peak / 100) * 100;
    const yOf = (v) => h / 2 - (v / lim) * (h / 2 - 6);
    const step = w / (HISTORY - 1);
    const x0 = w - (st.history.length - 1) * step;
    pctx.strokeStyle = '#2a2f3a';
    pctx.lineWidth = 1;
    pctx.beginPath();
    pctx.moveTo(0, h / 2);
    pctx.lineTo(w, h / 2);
    pctx.stroke();
    ['#ff6b6b', '#3ecf8e', '#4fb3ff'].forEach((color, axis) => {
      pctx.beginPath();
      pctx.strokeStyle = color;
      pctx.lineWidth = 1.5;
      st.history.forEach((p, i) => {
        const X = x0 + i * step;
        const Y = yOf(p[axis]);
        if (i) pctx.lineTo(X, Y); else pctx.moveTo(X, Y);
      });
      pctx.stroke();
    });
    pctx.fillStyle = '#9aa3b2';
    pctx.font = '11px system-ui, sans-serif';
    pctx.textAlign = 'left';
    pctx.fillText('±' + lim + ' °/s', 6, 13);
  }

  function draw() {
    const now = performance.now();
    ctx.clearRect(0, 0, st.w, st.h);
    ctx.strokeStyle = '#161a22';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0.5; x < st.w; x += 60) { ctx.moveTo(x, 0); ctx.lineTo(x, st.h); }
    for (let y = 0.5; y < st.h; y += 60) { ctx.moveTo(0, y); ctx.lineTo(st.w, y); }
    ctx.stroke();

    for (const t of st.targets) {
      const over = Math.hypot(st.x - t.x, st.y - t.y) <= t.r;
      ctx.beginPath();
      ctx.arc(t.x, t.y, t.r, 0, Math.PI * 2);
      ctx.fillStyle = over ? 'rgba(79,179,255,0.28)' : 'rgba(255,255,255,0.05)';
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = over ? '#4fb3ff' : '#3a4252';
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(t.x, t.y, t.r * 0.45, 0, Math.PI * 2);
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    st.bursts = st.bursts.filter((b) => b.until > now);
    for (const b of st.bursts) {
      const k = (b.until - now) / 500;
      ctx.beginPath();
      ctx.arc(b.x, b.y, 40 + (1 - k) * 60, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(62,207,142,${k.toFixed(3)})`;
      ctx.lineWidth = 4;
      ctx.stroke();
    }
    st.misses = st.misses.filter((m) => m.until > now);
    for (const m of st.misses) {
      const k = (m.until - now) / 300;
      ctx.beginPath();
      ctx.arc(m.x, m.y, 18 + (1 - k) * 12, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255,93,93,${k.toFixed(3)})`;
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    const src = st.sources.get(activeName());
    const aDown = !!(src && src.buttons.A);
    const frozen = !!(src && src.buttons.B);
    ctx.beginPath();
    ctx.arc(st.x, st.y, aDown ? 9 : 12, 0, Math.PI * 2);
    ctx.fillStyle = frozen ? '#9aa3b2' : aDown ? '#3ecf8e' : '#ffffff';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#0f1115';
    ctx.stroke();

    if (st.swingFlash && st.swingFlash.until > now) {
      ctx.globalAlpha = (st.swingFlash.until - now) / 700;
      ctx.font = '800 56px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffb020';
      ctx.fillText(st.swingFlash.text, st.w / 2, 80);
      ctx.globalAlpha = 1;
    }
    if (!st.sources.size) {
      ctx.font = '600 18px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#9aa3b2';
      ctx.fillText('Waiting for a device: open phone.html on your phone', st.w / 2, st.h / 2 - 50);
    }
    drawPlot();
    requestAnimationFrame(draw);
  }

  resize();
  connect();
  setInterval(refreshPanel, 500);
  requestAnimationFrame(draw);
})();
