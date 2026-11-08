// Patient's phone page for the walking speed test.
// Contract: motion/CONTRACT.md section 1 (motion sample), 2 (recording) and the walk part of 5 (POST /api/walks).
// Works on iPhone Safari (iOS 16 and later) and Android Chrome.
//
// iOS rules this file follows:
//  - DeviceMotionEvent.requestPermission() (and DeviceOrientationEvent.requestPermission() if present) run
//    synchronously inside the Start tap, before anything is awaited. So do the AudioContext create/resume and the
//    Screen Wake Lock request: iOS only allows them during a tap.
//  - No top-level await. Every optional API (wakeLock, vibrate, AudioContext, requestPermission, AbortController,
//    crypto, Blob/URL.createObjectURL) is feature-checked and wrapped, so a missing one cannot stop the page.
//  - event.interval is never used (iPhone reports seconds, Chrome milliseconds).
import { analyzeWalk, summarizeWalk } from './gait.js';

const $ = (id) => document.getElementById(id);

// ---------- constants
const KEYS = { settings: 'rfn.motion.settings', queue: 'rfn.motion.queue' };
const DIST_MIN = 3, DIST_MAX = 30, DIST_DEFAULT = 10;
const PLACEMENTS = ['waist', 'pocket', 'hand'];
const COUNTDOWN_MS = 3000;
// Reviewer fix (F7-pocket-always-fair): with the phone in a pocket, the person taps Start with the phone in
// hand and pockets it during the countdown. 3 s left no stillness before GO, so every pocket walk was rated
// fair (not_still_at_start). 6 s gives time to pocket it and then stand still for the last 2 s.
const POCKET_COUNTDOWN_MS = 6000;
const TIMEOUT_MS = 60000;          // measured from GO
const SD_WINDOW_MS = 500;          // moving SD of the acceleration magnitude
const STILL_FROM_MS = 2000;        // still SD uses the last 2 s of the countdown (the first second is often the phone being put in place)
const WALK_NEEDED_MS = 1500;       // walking seen before auto-stop is armed
const STILL_NEEDED_MS = 1500;      // stillness that triggers the auto-stop
const SD_FLOOR = 0.3;              // m/s²; threshold = 4 x still SD, kept between 0.3 and 0.6
// Reviewer fix: the cap. Moving the phone in the last 2 s of the countdown (putting it in a pocket, shifting
// feet) gave a still SD near 0.5, so the threshold rose to about 1.9, above walking (about 0.9 to 1.2 in synth
// walks). Auto-stop then never armed, and a pocket walker waited for the 60 s timeout. Standing after the walk
// is about 0.05 to 0.3, so 0.6 still tells the two apart. A lower threshold also makes stillness harder to
// reach, so the cap cannot stop a walk earlier.
const SD_CAP = 0.6;
const LOW_RATE_HZ = 30;
const MAX_POST_SAMPLES = 20000;    // contract 5: the recording rides along only up to this many samples
const MAX_SAMPLES = 40000;         // memory guard; 60 s at 200 Hz is 12,600
const SEND_TRIES = 4;              // the first try plus 3 retries
const BACKOFF_MS = [1000, 2000, 4000];
const FETCH_TIMEOUT_MS = 15000;
const API_WALKS = '/api/walks';

// ---------- plain-words help
const HELP = {
  insecure: [
    'This page cannot read the motion sensors from this address.',
    'Open this page from the https:// address the laptop shows.',
    'Phone and laptop must be on the same Wi-Fi.',
    'If the Wi-Fi blocks the phone, join the laptop to this phone\'s hotspot. Then restart the server on the laptop, reload the laptop page, and open the new address it shows.',
  ],
  unsupported: [
    'This browser cannot read the motion sensors.',
    'Use Safari on iPhone or Chrome on Android.',
  ],
  denied: [
    'Motion access is off, so the phone cannot time your walk.',
    'On iPhone: close Safari fully (swipe it away), reopen this page, tap Start, then tap Allow.',
    'On Android: Chrome usually allows it without asking. If not, tap the icon next to the address, open Permissions, and allow Motion sensors.',
  ],
  noData: [
    'No motion readings reached this page, so the walk was stopped.',
    'Use a phone. Laptops have no motion sensors.',
    'On iPhone: close Safari fully (swipe it away), reopen this page, tap Start, then tap Allow.',
    'On Android: tap the icon next to the address, open Permissions, and allow Motion sensors.',
  ],
  hidden: [
    'The walk was stopped because the screen turned off or you left this page.',
    'Keep the screen on and this page open during the walk. Then tap Start again.',
  ],
  noAnalysis: [
    'The phone could not work out a result from this walk.',
    'Tap Download recording to keep it, then try another walk.',
  ],
  // Reviewer fix (F6, honesty F3): the laptop joins the phone's hotspot, not the other way round, and the
  // server only shows the new address after a restart. Walks waiting to be sent stay with the old address.
  network: 'Phone and laptop must be on the same Wi-Fi. If the Wi-Fi blocks the phone, join the laptop to this phone\'s hotspot. Then restart the server on the laptop, reload the laptop page, and open the new address it shows. A walk not sent yet stays at the old address, so walk again.',
};

// ---------- storage with a memory fallback (same idea as app/js/hometests.js).
// A value in memory means the last write to localStorage failed (private mode, storage full), so memory wins.
const mem = new Map();
function lsGet(k) {
  if (mem.has(k)) return mem.get(k);
  try { return window.localStorage.getItem(k); } catch (_) { return null; }
}
function lsSet(k, v) {
  try { window.localStorage.setItem(k, v); mem.delete(k); return true; } catch (_) { mem.set(k, v); return false; }
}
function lsRemove(k) {
  mem.delete(k);
  try { window.localStorage.removeItem(k); } catch (_) { /* nothing stored */ }
}
function loadJson(k, fallback) {
  try { const v = JSON.parse(lsGet(k)); return v == null ? fallback : v; } catch (_) { return fallback; }
}

// ---------- small helpers
const round = (v, d) => { const f = 10 ** d; return Math.round(v * f) / f; };
const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? round(v, d) : null);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const pad2 = (n) => String(n).padStart(2, '0');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmtDist = (d) => (Number.isInteger(d) ? String(d) : d.toFixed(1));

function localDate(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function randomHex(n) {
  let s = '';
  try {
    if (window.crypto && typeof window.crypto.getRandomValues === 'function') {
      const b = new Uint8Array(Math.ceil(n / 2));
      window.crypto.getRandomValues(b);
      s = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    }
  } catch (_) { s = ''; }
  while (s.length < n) s += Math.floor(Math.random() * 16).toString(16);
  return s.slice(0, n);
}

// Recording id: "w-" + local YYYYMMDDTHHMMSS + "-" + 4 random hex characters (contract 2: ^[A-Za-z0-9_-]{6,64}$).
function makeId(d) {
  const stamp = `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}T${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
  return `w-${stamp}-${randomHex(4)}`;
}

function median(a) {
  if (!a.length) return null;
  const s = a.slice().sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Acceleration magnitude: gravity-included when complete, else the gravity-free one (its SD is what matters).
function magnitude(s) {
  if (s.ax !== null && s.ay !== null && s.az !== null) return Math.hypot(s.ax, s.ay, s.az);
  if (s.lx !== null && s.ly !== null && s.lz !== null) return Math.hypot(s.lx, s.ly, s.lz);
  return NaN;
}

// ---------- state
const st = {
  phase: 'setup',          // setup | asking | countdown | walking | done
  rec: null,               // the recording being made (contract 2)
  mags: [],                // acceleration magnitude per sample, for the auto-stop
  win: 0,                  // first sample index inside the 0.5 s window
  lastT: -Infinity,
  countStartT: 0,
  lastCount: null,
  stillSd: null, thr: SD_FLOOR, walkMs: 0, armed: false, stillSince: null,
  countMs: COUNTDOWN_MS,   // countdown length for this walk (longer for the pocket)
  emptyEvents: 0,
  ticker: null,
  listening: false,
  stopDownT: null,         // pointerdown time on Stop; the click (which acts) comes a little later
  result: null,
  downloadUrl: null,
  audio: null,
  wakeLock: null, wantWake: false,
  resending: false,
  blocked: false,          // true when the page cannot read motion at all (not secure, no API)
  settings: null,
};
window.__walk = st; // for debugging from the console

// ---------- settings (localStorage rfn.motion.settings, memory fallback)
function loadSettings() {
  const s = loadJson(KEYS.settings, {});
  const o = s && typeof s === 'object' ? s : {};
  const d = Number(o.distance_m);
  const today = localDate();
  return {
    distance_m: isNum(d) && d >= DIST_MIN && d <= DIST_MAX ? d : DIST_DEFAULT,
    placement: PLACEMENTS.includes(o.placement) ? o.placement : 'waist',
    day: today,
    walksToday: o.day === today && Number.isInteger(o.walksToday) && o.walksToday > 0 ? o.walksToday : 0,
  };
}
function saveSettings() { lsSet(KEYS.settings, JSON.stringify(st.settings)); }

function fillSettingsForm() {
  $('distance').value = String(st.settings.distance_m);
  for (const r of document.querySelectorAll('input[name="placement"]')) r.checked = (r.value === st.settings.placement);
}

// Returns { distance_m, placement } or null (and shows the error) when the distance is not 3 to 30 m.
function readSettingsForm() {
  const raw = String($('distance').value || '').trim().replace(',', '.');
  const d = Number(raw);
  const okDist = raw !== '' && isNum(d) && d >= DIST_MIN && d <= DIST_MAX;
  $('distanceErr').hidden = okDist;
  $('distance').setAttribute('aria-invalid', okDist ? 'false' : 'true');
  if (!okDist) { $('distance').focus(); announce('Enter a distance from 3 to 30 metres.'); return null; }
  const checked = document.querySelector('input[name="placement"]:checked');
  const placement = checked && PLACEMENTS.includes(checked.value) ? checked.value : 'waist';
  const distance_m = round(d, 2);
  if (st.settings.day !== localDate()) { st.settings.day = localDate(); st.settings.walksToday = 0; }
  st.settings.distance_m = distance_m;
  st.settings.placement = placement;
  saveSettings();
  return { distance_m, placement };
}

// ---------- views and messages
const VIEWS = ['viewSetup', 'viewCount', 'viewWalk', 'viewResult'];
function showView(id, moveFocus = true) {
  for (const v of VIEWS) $(v).hidden = (v !== id);
  document.body.dataset.view = id;
  document.documentElement.dataset.view = id;
  renderQueue();
  if (moveFocus) {
    const focusId = { viewSetup: 'setupTitle', viewCount: 'countTitle', viewWalk: 'goCue', viewResult: 'resultTitle' }[id];
    const el = focusId && $(focusId);
    if (el) { try { el.focus({ preventScroll: true }); } catch (_) { /* fine */ } }
  }
  try { window.scrollTo(0, 0); } catch (_) { /* old browsers */ }
}

function announce(text) {
  const el = $('live');
  el.textContent = '';
  // A fresh text node after a tick makes screen readers read repeated messages too.
  setTimeout(() => { el.textContent = text; }, 30);
}

function showHelp(lines, link) {
  const box = $('help');
  box.textContent = '';
  for (const line of lines) {
    const p = document.createElement('p');
    p.textContent = line;
    box.appendChild(p);
  }
  if (link) {
    const p = document.createElement('p');
    const a = document.createElement('a');
    a.href = link.href;
    a.textContent = link.text;
    a.className = 'btn secondary';
    p.appendChild(a);
    box.appendChild(p);
  }
  box.hidden = false;
}
function hideHelp() { $('help').hidden = true; $('help').textContent = ''; }

function setStartBusy(busy, note) {
  $('startBtn').disabled = !!busy || st.blocked === true;
  $('startNote').textContent = note || '';
}

function renderToday() {
  const n = st.settings.walksToday;
  const dots = $('todayDots').children;
  for (let i = 0; i < dots.length; i++) dots[i].classList.toggle('done', i < n);
  $('todayText').textContent = n === 0
    ? 'Do 2 or 3 walks, one after another. The laptop averages them, which gives a steadier number.'
    : n === 1
      ? '1 walk done today. One or two more give a steadier number.'
      : n === 2
        ? '2 walks done today. One more is good, but 2 is enough.'
        : `${n} walks done today. That is enough for today. Thank you.`;
}

// ---------- start: permission, audio and wake lock all inside the tap
function onStartTap() {
  if (st.phase !== 'setup' || st.blocked) return;
  hideHelp();
  const settings = readSettingsForm();
  if (!settings) return;

  // 1. Motion permission, synchronously in the tap (iOS shows its prompt only during a tap).
  let ask;
  try {
    ask = (typeof window.DeviceMotionEvent !== 'undefined' && typeof window.DeviceMotionEvent.requestPermission === 'function')
      ? window.DeviceMotionEvent.requestPermission()
      : 'granted'; // Android Chrome and older iOS give motion data to secure pages without asking
  } catch (err) {
    ask = Promise.reject(err);
  }
  // Orientation shares the iPhone prompt; we do not need it, so its answer is ignored.
  try {
    if (typeof window.DeviceOrientationEvent !== 'undefined' && typeof window.DeviceOrientationEvent.requestPermission === 'function') {
      const p = window.DeviceOrientationEvent.requestPermission();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    }
  } catch (_) { /* motion decides */ }

  // 2. Audio for the GO beep, and the screen wake lock: both need the tap on iOS.
  unlockAudio();
  st.wantWake = true;
  requestWakeLock();

  st.phase = 'asking';
  setStartBusy(true, 'Asking for motion access. On iPhone, tap Allow.');
  Promise.resolve(ask).then((answer) => {
    if (answer !== 'granted') return permissionFailed();
    setStartBusy(false, '');
    beginCountdown(settings);
  }, (err) => permissionFailed(err));
}

function permissionFailed(err) {
  st.phase = 'setup';
  setStartBusy(false, '');
  const extra = [];
  if (err && err.name && err.name !== 'NotAllowedError') extra.push(`The browser said: ${err.message || err.name}.`);
  showHelp(HELP.denied.concat(extra));
  announce(HELP.denied[0]);
}

// ---------- audio (optional beep at GO)
function unlockAudio() {
  try {
    // Reviewer fix (F5): iPhone plays Web Audio as "ambient" sound, which the Silent switch mutes.
    // "playback" plays the beeps in Silent mode too (iOS 17 and later). It is set here, inside the Start
    // tap and before the AudioContext is made. Guarded: if a browser refuses it, the normal beep still works.
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (_) { /* keep the default */ }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!st.audio) st.audio = new AC();
    const ctx = st.audio;
    if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
      const p = ctx.resume();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    }
    // A silent blip inside the tap fully unlocks Web Audio on iOS.
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    g.gain.value = 0;
    o.connect(g); g.connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + 0.02);
  } catch (_) { st.audio = null; }
}

function beep() {
  try {
    const ctx = st.audio;
    if (!ctx) return;
    if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
      const p = ctx.resume();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    }
    const t0 = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.5, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.4);
    o.connect(g); g.connect(ctx.destination);
    o.start(t0); o.stop(t0 + 0.45);
  } catch (_) { /* no sound; the visual cue is the one that counts */ }
}

function buzz(pattern) {
  try { if (typeof navigator.vibrate === 'function') navigator.vibrate(pattern); } catch (_) { /* iPhone has no vibrate */ }
}

// ---------- screen wake lock (re-acquired on visibilitychange)
function requestWakeLock() {
  try {
    const wl = navigator.wakeLock;
    if (!wl || typeof wl.request !== 'function') return;
    if (document.visibilityState !== 'visible') return;
    if (st.wakeLock && !st.wakeLock.released) return;
    const p = wl.request('screen');
    if (!p || typeof p.then !== 'function') return;
    p.then((lock) => {
      st.wakeLock = lock;
      try { lock.addEventListener('release', () => { if (st.wakeLock === lock) st.wakeLock = null; }); } catch (_) { /* fine */ }
    }, () => { /* refused or unsupported: the screen may dim */ });
  } catch (_) { /* unsupported */ }
}

// ---------- recording
function onMotion(e) {
  if (st.phase !== 'countdown' && st.phase !== 'walking') return;
  const rec = st.rec;
  if (!rec || rec.samples.length >= MAX_SAMPLES) return;
  const g = e.accelerationIncludingGravity || {};
  const a = e.acceleration || {};
  const r = e.rotationRate || {};
  // Contract 1 mapping. gx/gy/gz = rotationRate alpha/beta/gamma (rates about device x, y, z: W3C 6.3.2, as
  // Chrome, Safari and Firefox do it; MDN is out of date), deg/s. Reviewer fix (F2): was beta/gamma/alpha.
  const s = {
    t: 0,
    ax: num(g.x, 3), ay: num(g.y, 3), az: num(g.z, 3),
    gx: num(r.alpha, 2), gy: num(r.beta, 2), gz: num(r.gamma, 2),
    lx: num(a.x, 3), ly: num(a.y, 3), lz: num(a.z, 3),
  };
  const m = magnitude(s);
  if (!Number.isFinite(m)) { st.emptyEvents++; return; } // an event with no acceleration (laptops send these)

  // Sample clock: event.timeStamp when it is a sane page-clock time, else performance.now(); they share the
  // time origin with goT and stopT. Not increasing also falls back to performance.now() (contract 1).
  // Extra guard (not in the contract): an event is handled within milliseconds of being made, so a timeStamp
  // more than 1 s away from performance.now() is not on the page clock; use performance.now() then too.
  const nowMs = performance.now();
  let t = e.timeStamp;
  if (!(typeof t === 'number' && t > 0 && t < 1e11 && Math.abs(t - nowMs) < 1000)) t = nowMs;
  t = round(t, 2);
  if (!(t > st.lastT)) {
    t = round(performance.now(), 2);
    if (!(t > st.lastT)) return; // cannot place it in time; dropping one sample is harmless
  }
  st.lastT = t;
  s.t = t;
  rec.samples.push(s);
  st.mags.push(m);
  if (st.phase === 'walking' && t >= rec.goT) autoStopCheck(rec.samples.length - 1);
}

// SD of the magnitude for samples i0..i1 (inclusive); null when too few.
function sdRange(i0, i1) {
  let n = 0, sum = 0;
  for (let i = i0; i <= i1; i++) { const m = st.mags[i]; if (Number.isFinite(m)) { n++; sum += m; } }
  if (n < 3) return null;
  const mean = sum / n;
  let sq = 0;
  for (let i = i0; i <= i1; i++) { const m = st.mags[i]; if (Number.isFinite(m)) sq += (m - mean) * (m - mean); }
  return Math.sqrt(sq / n);
}

// Moving SD over the 0.5 s ending at sample i (window start index only moves forward).
function windowSd(i) {
  const S = st.rec.samples;
  const tEnd = S[i].t;
  while (st.win < i && S[st.win].t < tEnd - SD_WINDOW_MS) st.win++;
  return sdRange(st.win, i);
}

// Countdown stillness: median of the 0.5 s moving SD over the last 2 s before GO.
function stillSdBefore(goT) {
  const S = st.rec.samples;
  const sds = [];
  let j = 0;
  for (let i = 0; i < S.length && S[i].t <= goT; i++) {
    while (j < i && S[j].t < S[i].t - SD_WINDOW_MS) j++;
    if (S[i].t < goT - STILL_FROM_MS) continue;
    const sd = sdRange(j, i);
    if (sd !== null) sds.push(sd);
  }
  return median(sds);
}

// Auto-stop: walking is a moving SD above 4 x still SD, kept between 0.3 and 0.6. After 1.5 s of walking,
// 1.5 s of stillness stops.
function autoStopCheck(i) {
  const S = st.rec.samples;
  const sd = windowSd(i);
  if (sd === null) return;
  const t = S[i].t;
  const dt = i > 0 ? Math.min(100, Math.max(0, t - S[i - 1].t)) : 0; // a dropout does not count as walking
  if (sd > st.thr) {
    st.walkMs += dt;
    st.stillSince = null;
    if (st.walkMs >= WALK_NEEDED_MS) st.armed = true;
  } else if (st.armed) {
    if (st.stillSince === null) st.stillSince = t;
    else if (t - st.stillSince >= STILL_NEEDED_MS) stopWalk('auto', t);
  }
}

function startTicker(ms) {
  clearTicker();
  st.ticker = setInterval(tick, ms);
}
function clearTicker() {
  if (st.ticker) clearInterval(st.ticker);
  st.ticker = null;
}

function beginCountdown(settings) {
  if (!st.listening) {
    window.addEventListener('devicemotion', onMotion);
    st.listening = true;
  }
  const now = new Date();
  st.rec = {
    v: 1, kind: 'rfn-walk-recording',
    id: makeId(now),
    createdAt: now.toISOString(),
    device: { ua: String(navigator.userAgent || '') },
    distance_m: settings.distance_m,
    placement: settings.placement,
    goT: null, stopT: null, stopBy: null,
    samples: [],
  };
  st.mags = []; st.win = 0; st.lastT = -Infinity; st.lastCount = null;
  st.stillSd = null; st.thr = SD_FLOOR; st.walkMs = 0; st.armed = false; st.stillSince = null;
  st.emptyEvents = 0; st.stopDownT = null; st.result = null;
  // Reviewer fix (F7-pocket-always-fair): a longer countdown, and its own title, for the pocket.
  const pocket = settings.placement === 'pocket';
  st.countMs = pocket ? POCKET_COUNTDOWN_MS : COUNTDOWN_MS;
  const first = Math.ceil(st.countMs / 1000);
  const title = pocket ? 'Put the phone in your pocket, then stand still' : 'Stand still at the start line';
  $('countTitle').textContent = title;
  $('goText').textContent = `Walk to the ${fmtDist(settings.distance_m)} m line at your usual pace. Stop at the line and stand still until it beeps.`;
  $('countNum').textContent = String(first);
  $('rateWarn').hidden = true;
  $('elapsed').textContent = '0.0 s';
  $('rate').textContent = '–';
  st.countStartT = performance.now(); // samples are recorded from here
  st.phase = 'countdown';
  showView('viewCount');
  announce(`${title}. ${first}.`);
  st.lastCount = first;
  startTicker(50);
}

function tick() {
  const now = performance.now();
  if (st.phase === 'countdown') {
    const left = st.countMs - (now - st.countStartT);
    if (left <= 0) { go(now); return; }
    const n = Math.ceil(left / 1000);
    if (n !== st.lastCount) {
      st.lastCount = n;
      $('countNum').textContent = String(n);
      announce(String(n));
    }
  } else if (st.phase === 'walking') {
    const rec = st.rec;
    const elapsed = (now - rec.goT) / 1000;
    $('elapsed').textContent = `${Math.max(0, elapsed).toFixed(1)} s`;
    renderRate(now);
    if (now - rec.goT >= TIMEOUT_MS) stopWalk('timeout', round(now, 2));
  }
}

// Readings per second over the last 2 s.
function renderRate(now) {
  const S = st.rec.samples;
  if (!S.length) { $('rate').textContent = '0 a second'; return; }
  const from = now - 2000;
  let n = 0;
  for (let i = S.length - 1; i >= 0 && S[i].t >= from; i--) n++;
  const span = Math.min(2000, now - st.countStartT);
  const hz = span > 0 ? n * 1000 / span : 0;
  $('rate').textContent = `${Math.round(hz)} a second`;
  const low = (now - st.countStartT) > 1500 && hz < LOW_RATE_HZ;
  $('rateWarn').hidden = !low;
  if (low) $('rateWarn').textContent = `The phone is sending few readings (${Math.round(hz)} a second; 30 or more is better). The result may be less exact. Close other apps next time.`;
}

function go(now) {
  const rec = st.rec;
  if (!rec.samples.length) {
    abortWalk(HELP.noData);
    return;
  }
  rec.goT = round(now, 2);
  st.stillSd = stillSdBefore(rec.goT);
  st.thr = Math.min(SD_CAP, Math.max(SD_FLOOR, 4 * (st.stillSd || 0)));
  st.win = 0;
  st.phase = 'walking';
  showView('viewWalk');
  beep();
  buzz([250, 100, 250]);
  announce('Go. Walk now.');
  startTicker(100);
}

function stopWalk(by, stopT) {
  if (st.phase !== 'walking') return;
  st.phase = 'done';
  clearTicker();
  const rec = st.rec;
  rec.stopBy = by;
  rec.stopT = stopT;
  buzz(80);
  // Reviewer fix (F5, G1): a beep when the phone stops by itself or at the 60 s limit. iPhone cannot buzz,
  // so without it a person with the phone in a pocket or on the belly cannot tell the walk has ended.
  if (by !== 'tap') beep();
  analyseAndShow(rec);
}

function abortWalk(lines) {
  clearTicker();
  st.phase = 'setup';
  st.rec = null;
  setStartBusy(false, '');
  showView('viewSetup');
  showHelp(lines);
  announce(lines[0]);
}

function cancelWalk() {
  if (st.phase !== 'countdown') return;
  clearTicker();
  st.phase = 'setup';
  st.rec = null;
  setStartBusy(false, '');
  showView('viewSetup');
  announce('Cancelled. Tap Start when you are ready.');
}

// ---------- analysis and result
function analyseAndShow(rec) {
  let result = null;
  try {
    result = analyzeWalk(rec);
  } catch (err) {
    console.error('analyzeWalk failed', err);
    result = null;
  }
  st.result = result && typeof result === 'object' ? result : null;
  // Only walks the laptop can save count toward "Walk 1, 2, 3" (contract 6: not ok:false, not poor).
  if (st.result && st.result.ok && st.result.quality !== 'poor') {
    if (st.settings.day !== localDate()) { st.settings.day = localDate(); st.settings.walksToday = 0; }
    st.settings.walksToday += 1;
    saveSettings();
  }
  renderResult(rec, st.result);
  showView('viewResult');
  setDownload(rec);
  if (st.result) {
    announce(st.result.ok && isNum(st.result.speed_mps)
      ? `Your walking speed was ${st.result.speed_mps.toFixed(2)} metres a second.`
      : 'No walking speed this time. See the notes on this walk.');
    sendWalk(buildBody(rec, st.result));
  } else {
    $('sendStatus').textContent = 'Not sent: there is no result to send. You can still download the recording.';
    announce(HELP.noAnalysis[0]);
  }
}

const fmt = (v, d, unit) => (isNum(v) ? `${v.toFixed(d)}${unit ? ' ' + unit : ''}` : '–');

const TIMING_TEXT = {
  motion: 'From your first step to when you stopped, found by the motion sensors.',
  manual: 'From GO to your Stop tap. This includes your reaction time.',
};
const QUALITY_TEXT = {
  good: 'Good recording',
  fair: 'Fair recording',
  poor: 'Poor recording. Please walk again.',
};
const ISSUE_FALLBACK = 'Something in this walk was unusual.';

function renderResult(rec, res) {
  const ok = !!(res && res.ok && isNum(res.speed_mps));
  $('speed').textContent = ok ? res.speed_mps.toFixed(2) : '–';
  $('speedUnit').hidden = !ok;

  const q = res && QUALITY_TEXT[res.quality] ? res.quality : null;
  const badge = $('quality');
  badge.className = 'badge' + (q ? ` q-${q}` : '');
  badge.textContent = q ? QUALITY_TEXT[q] : (res ? 'No quality rating' : 'No result');

  let summary = '';
  if (res) {
    try { summary = String(summarizeWalk(res) || ''); } catch (_) { summary = ''; }
  } else {
    summary = HELP.noAnalysis.join(' ');
  }
  $('summary').textContent = summary;

  $('rTime').textContent = res ? fmt(res.duration_s, 2, 's') : '–';
  $('rSteps').textContent = res && isNum(res.steps) ? String(res.steps) : '–';
  $('rCadence').textContent = res ? fmt(res.cadence_spm, 0, '') : '–';
  $('rStepLen').textContent = res ? fmt(res.stepLength_m, 2, 'm') : '–';
  $('rDistance').textContent = `${fmtDist(rec.distance_m)} m`;
  $('rTiming').textContent = res && TIMING_TEXT[res.timing] ? TIMING_TEXT[res.timing] : 'Not available.';

  // Every issue message as a plain sentence.
  const list = $('issues');
  list.textContent = '';
  const issues = res && Array.isArray(res.issues) ? res.issues : [];
  for (const it of issues) {
    if (!it || typeof it !== 'object') continue;
    const li = document.createElement('li');
    const level = ['info', 'warn', 'fail'].includes(it.level) ? it.level : 'info';
    li.className = `issue ${level}`;
    li.textContent = (typeof it.message === 'string' && it.message.trim()) ? it.message.trim() : ISSUE_FALLBACK;
    list.appendChild(li);
  }
  $('issuesCard').hidden = list.children.length === 0;

  // Exploratory values, folded away; none changes the result. Reviewer fix (honesty F7): the step-time
  // variation and left-right numbers are not checked for accuracy, so the patient no longer sees them.
  // The doctor's page still shows them, marked exploratory.
  const ex = res && res.exploratory && typeof res.exploratory === 'object' ? res.exploratory : {};
  fillDl($('exploratory'), [
    ['Steps per minute, from the rhythm', fmt(ex.autocorrCadence_spm, 0, '')],
    ['Steps per minute, from the turning sensor', fmt(ex.gyroCadence_spm, 0, '')],
    ['Turning during the walk', fmt(ex.headingChange_deg, 0, 'degrees')],
  ]);
  fillDl($('recDetails'), [
    ['Readings a second', res ? fmt(res.sampleRate_hz, 0, '') : '–'],
    ['Readings', String(rec.samples.length)],
    ['Longest gap', res ? fmt(res.maxGap_ms, 0, 'ms') : '–'],
    ['Time from the motion sensors', res ? fmt(res.motionDuration_s, 2, 's') : '–'],
    ['Time from GO to Stop tap', res ? fmt(res.manualDuration_s, 2, 's') : '–'],
    ['How it stopped', { tap: 'You tapped Stop', auto: 'You stood still', timeout: 'After 60 seconds' }[rec.stopBy] || '–'],
    ['Phone place', { waist: 'Waist', pocket: 'Pocket', hand: 'Hand' }[rec.placement] || '–'],
    ['Recording name', rec.id],
  ]);

  // Walk 1, 2, 3 guidance.
  const n = st.settings.walksToday;
  let next;
  if (!ok || (res && res.quality === 'poor')) next = 'This walk will not count. Walk back to the start line and tap Walk again.';
  else if (n < 2) next = `Walk ${n} done today. Rest a moment, walk back to the start line, then tap Walk again.`;
  else if (n === 2) next = 'Walk 2 done today. One more is good, but 2 is enough.';
  else next = `Walk ${n} done today. That is enough for today. Thank you.`;
  $('nextText').textContent = next;
}

function fillDl(dl, rows) {
  dl.textContent = '';
  for (const [k, v] of rows) {
    const div = document.createElement('div');
    const dt = document.createElement('dt');
    const dd = document.createElement('dd');
    dt.textContent = k;
    dd.textContent = v;
    div.appendChild(dt); div.appendChild(dd);
    dl.appendChild(div);
  }
}

// Download the recording (contract 2 shape) as <id>.json.
function setDownload(rec) {
  const a = $('downloadLink');
  try {
    if (st.downloadUrl && window.URL && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(st.downloadUrl);
  } catch (_) { /* fine */ }
  st.downloadUrl = null;
  try {
    if (typeof Blob !== 'function' || !window.URL || typeof URL.createObjectURL !== 'function') throw new Error('no blob');
    const blob = new Blob([JSON.stringify(rec)], { type: 'application/json' });
    st.downloadUrl = URL.createObjectURL(blob);
    a.href = st.downloadUrl;
    a.setAttribute('download', `${rec.id}.json`);
    a.hidden = false;
  } catch (_) {
    a.hidden = true;
  }
}

// ---------- sending (POST /api/walks, contract 5)
function buildBody(rec, result) {
  const body = {
    v: 1, kind: 'rfn-walk',
    id: rec.id,
    createdAt: rec.createdAt,
    distance_m: rec.distance_m,
    placement: rec.placement,
    device: { ua: rec.device.ua },
    result,
  };
  if (rec.samples.length <= MAX_POST_SAMPLES) body.recording = rec;
  return body;
}

function withoutRecording(body) {
  const b = Object.assign({}, body);
  delete b.recording;
  return b;
}

// One POST. Returns { ok, duplicate } or { ok: false, retry, tooLarge, rejected, error }.
async function postOnce(body) {
  let ctrl = null, timer = null;
  try {
    if (typeof AbortController === 'function') {
      ctrl = new AbortController();
      timer = setTimeout(() => { try { ctrl.abort(); } catch (_) { /* fine */ } }, FETCH_TIMEOUT_MS);
    }
  } catch (_) { ctrl = null; }
  try {
    const opts = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store' };
    if (ctrl) opts.signal = ctrl.signal;
    const res = await fetch(API_WALKS, opts);
    let data = null;
    try { data = await res.json(); } catch (_) { data = null; }
    if (res.ok) {
      if (data && data.ok === false) return { ok: false, retry: false, rejected: true, error: plainError(data.error, res.status) };
      return { ok: true, duplicate: !!(data && data.duplicate) };
    }
    if (res.status === 413) return { ok: false, retry: false, tooLarge: true, error: 'The walk was too large to send.' };
    if (res.status === 400 || res.status === 422) return { ok: false, retry: false, rejected: true, error: plainError(data && data.error, res.status) };
    return { ok: false, retry: true, error: `The laptop is not ready (it answered ${res.status}).` };
  } catch (err) {
    const slow = err && err.name === 'AbortError';
    return { ok: false, retry: true, error: slow ? 'The laptop took too long to answer.' : 'Could not reach the laptop.' };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function plainError(msg, status) {
  return (typeof msg === 'string' && msg.trim()) ? msg.trim() : `The laptop did not accept this walk (${status}).`;
}

// Up to SEND_TRIES attempts with backoff. A 413 drops the raw recording and tries again once.
async function sendWithRetry(body, onStatus, tries = SEND_TRIES) {
  let b = body;
  let r = null;
  for (let attempt = 1; attempt <= tries; attempt++) {
    onStatus({ state: 'sending', attempt, tries });
    r = await postOnce(b);
    if (r.ok) return r;
    if (r.tooLarge && b.recording) {
      b = withoutRecording(b);
      r = await postOnce(b);
      if (r.ok) return Object.assign(r, { slim: true });
    }
    if (!r.retry) return r;
    if (attempt < tries) {
      const wait = BACKOFF_MS[Math.min(attempt - 1, BACKOFF_MS.length - 1)];
      onStatus({ state: 'waiting', attempt, tries, wait, error: r.error });
      await sleep(wait);
    }
  }
  return r;
}

async function sendWalk(body) {
  const mine = () => st.rec && st.rec.id === body.id; // the result screen may have moved on to a newer walk
  const status = (text) => { if (mine()) $('sendStatus').textContent = text; };
  let r = null;
  try {
    r = await sendWithRetry(body, (s) => {
      if (s.state === 'sending') status(s.attempt === 1 ? 'Sending to the laptop…' : `Sending again (try ${s.attempt} of ${s.tries})…`);
      else status(`${s.error} Trying again in ${Math.round(s.wait / 1000)} s.`);
    });
  } catch (err) {
    console.error('sending failed', err);
    r = { ok: false, retry: true, error: 'Something went wrong while sending.' };
  }
  if (r && r.ok) {
    removeFromQueue(body.id);
    status(r.duplicate ? 'Sent. The laptop already had this walk.' : 'Sent to the laptop.');
    if (mine()) announce('Sent to the laptop.');
  } else if (r && r.rejected) {
    status(`Not sent. ${r.error} You can still download the recording.`);
  } else {
    const where = enqueue(body);
    status(`Not sent yet. ${r ? r.error : ''} ${where} Tap Send again when the laptop is ready. ${HELP.network}`.replace(/\s+/g, ' ').trim());
  }
  renderQueue();
}

// ---------- queue of unsent walks (localStorage rfn.motion.queue, memory fallback)
function getQueue() {
  const q = loadJson(KEYS.queue, []);
  return Array.isArray(q) ? q.filter((x) => x && typeof x === 'object' && typeof x.id === 'string') : [];
}
// Returns a plain sentence saying where it was kept.
function setQueue(q) {
  if (!q.length) { lsRemove(KEYS.queue); return ''; }
  const full = JSON.stringify(q);
  if (lsSet(KEYS.queue, full)) return 'It is saved on this phone.';
  // Storage full: keep the results on the phone without the raw readings, and the full walks in memory.
  if (lsSet(KEYS.queue, JSON.stringify(q.map(withoutRecording)))) { mem.set(KEYS.queue, full); return 'It is saved on this phone.'; }
  mem.set(KEYS.queue, full);
  return 'It is kept until you close this page.';
}
function enqueue(body) {
  const q = getQueue().filter((x) => x.id !== body.id);
  q.push(body);
  return setQueue(q);
}
function removeFromQueue(id) {
  const q = getQueue();
  const left = q.filter((x) => x.id !== id);
  if (left.length !== q.length) setQueue(left);
}

function renderQueue() {
  const n = getQueue().length;
  const view = document.body.dataset.view;
  $('queueBox').hidden = !(n > 0 && (view === 'viewSetup' || view === 'viewResult'));
  $('queueText').textContent = n === 1
    ? '1 walk is saved on this phone and not sent yet.'
    : `${n} walks are saved on this phone and not sent yet.`;
  $('resendBtn').disabled = st.resending;
}

// Resend every queued walk once each. Stops early when the laptop cannot be reached.
async function resendQueue() {
  if (st.resending) return;
  const q = getQueue();
  if (!q.length) { renderQueue(); return; }
  st.resending = true;
  renderQueue();
  $('queueStatus').textContent = 'Sending…';
  let sent = 0, refused = 0, failed = 0, lastError = '';
  try {
    for (const body of q) {
      const r = await sendWithRetry(body, () => {}, 1);
      if (r && r.ok) {
        sent++;
        removeFromQueue(body.id);
        if (st.rec && st.rec.id === body.id) $('sendStatus').textContent = 'Sent to the laptop.';
      } else if (r && r.rejected) {
        refused++;
        removeFromQueue(body.id); // the laptop will never take it; keeping it would block the queue
        lastError = r.error;
      } else {
        failed++;
        lastError = r ? r.error : '';
        break; // the laptop is not reachable; keep the rest for later
      }
    }
  } finally {
    st.resending = false;
  }
  const parts = [];
  if (sent) parts.push(sent === 1 ? '1 walk sent.' : `${sent} walks sent.`);
  if (refused) parts.push(`${refused} refused by the laptop: ${lastError}`);
  if (failed) parts.push(`${lastError} ${HELP.network}`);
  $('queueStatus').textContent = parts.join(' ').trim();
  renderQueue();
}

// ---------- wiring
// GET /api/info gives the server's HTTPS port and phone addresses (contract section 5).
// Prefer the listed address on this same host; else this host on the HTTPS port; else none.
async function secureAddress() {
  try {
    const r = await fetch('/api/info', { cache: 'no-store' });
    if (!r.ok) return null;
    const info = await r.json();
    const urls = Array.isArray(info.phoneUrls) ? info.phoneUrls.filter((u) => typeof u === 'string') : [];
    for (const u of urls) {
      try {
        const x = new URL(u);
        if (x.protocol === 'https:' && x.hostname === location.hostname) return `${x.origin}${location.pathname}${location.search}`;
      } catch { /* skip a bad address */ }
    }
    const port = Number(info.httpsPort);
    if (Number.isInteger(port) && port > 0 && port < 65536) return `https://${location.hostname}:${port}${location.pathname}${location.search}`;
  } catch { /* no server info: the help text still explains what to do */ }
  return null;
}

function blockStart(lines, link) {
  st.blocked = true;
  $('startBtn').disabled = true;
  showHelp(lines, link);
}

function init() {
  st.settings = loadSettings();
  fillSettingsForm();
  renderToday();

  $('bootMsg').hidden = true;
  $('app').hidden = false;
  showView('viewSetup', false);

  // Secure page and motion API checks.
  const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  if (!window.isSecureContext) {
    blockStart(HELP.insecure, null);
    if (location.protocol === 'http:' && !isLocal) {
      // The secure address comes from the server, so this works under motion/server.py
      // (HTTPS 8453) and the unified run.py server (HTTPS 8443) alike.
      secureAddress().then((href) => {
        if (href && st.blocked) showHelp(HELP.insecure, { href, text: 'Open the secure address' });
      });
    }
  } else if (typeof window.DeviceMotionEvent === 'undefined') {
    blockStart(HELP.unsupported);
  }

  $('startBtn').addEventListener('click', onStartTap);
  $('cancelBtn').addEventListener('click', cancelWalk);
  $('stopBtn').addEventListener('pointerdown', () => { st.stopDownT = performance.now(); });
  $('stopBtn').addEventListener('click', () => {
    // Act on click (no ghost tap on the next screen), but time the stop from the finger going down.
    const now = performance.now();
    const down = st.stopDownT;
    st.stopDownT = null;
    const goT = st.rec && isNum(st.rec.goT) ? st.rec.goT : 0;
    const t = (isNum(down) && now - down < 1000 && down >= goT) ? down : now;
    stopWalk('tap', round(t, 2));
  });
  $('againBtn').addEventListener('click', () => {
    hideHelp();
    st.phase = 'setup';
    renderToday();
    setStartBusy(false, '');
    showView('viewSetup', false);
    // Settings are kept, so bring Start into view for walk 2 and 3 (it sits below the fold on a phone).
    try { $('startBtn').scrollIntoView({ block: 'center' }); } catch (_) { /* old browsers */ }
    try { $('startBtn').focus({ preventScroll: true }); } catch (_) { /* fine */ }
  });
  $('resendBtn').addEventListener('click', () => { resendQueue(); });
  $('settingsForm').addEventListener('submit', (e) => e.preventDefault());
  $('distance').addEventListener('input', () => { $('distanceErr').hidden = true; $('distance').setAttribute('aria-invalid', 'false'); });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      if (st.phase === 'countdown' || st.phase === 'walking') abortWalk(HELP.hidden);
    } else if (st.wantWake) {
      requestWakeLock();
    }
  });
  window.addEventListener('pagehide', () => {
    if (st.phase === 'countdown' || st.phase === 'walking') abortWalk(HELP.hidden);
  });

  // Resend anything left over from an earlier visit.
  if (getQueue().length) resendQueue();
}

init();
