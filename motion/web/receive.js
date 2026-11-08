// Doctor's laptop page for the phone walking test (motion/CONTRACT.md).
// Served by motion/server.py at http://localhost:8090/motion/receive.html, the same
// origin as the app, so rows saved to localStorage rfn.homeResults reach the app's views.
// It measures walking speed, not ALS.
import { HOME_TESTS, detectDecline, RULES, FINDINGS } from '/js/engine.js';
import {
  GAIT_TEST_ID, GAIT_TEST, GAIT_MDC, ensureGaitTest, makeRow, gaitSeries, gaitFlag, flagText, saveBlocker, localDate, localTime,
} from './flag.js';

// gait.js (analyzeWalk, summarizeWalk) and recording.js (parseRecording) are loaded on
// demand: if one of them fails, only file import and the summary line switch off, and
// walks from the phone (already analysed there) still show and save.
let gait = null;
let rec = null;
let gaitErr = '';
let recErr = '';

// ---------- storage: localStorage with an in-memory fallback (as app/js/hometests.js) ----------
const KEYS = { results: 'rfn.homeResults', person: 'rfn.hometests.person' };
const mem = new Map();
let storageOk = (() => {
  try { const k = '__rfn_probe'; localStorage.setItem(k, '1'); localStorage.removeItem(k); return true; } catch { return false; }
})();
function lsGet(k) {
  if (storageOk) { try { return localStorage.getItem(k); } catch { storageOk = false; } }
  return mem.has(k) ? mem.get(k) : null;
}
function lsSet(k, v) {
  if (storageOk) { try { localStorage.setItem(k, v); return; } catch { storageOk = false; } }
  mem.set(k, v);
}
// The saved rows, or null when something is stored but is not a readable list (then the
// page refuses to save rather than overwrite it).
function readResults() {
  const raw = lsGet(KEYS.results);
  if (raw == null || raw === '') return [];
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v : null; } catch { return null; }
}
const results = () => readResults() || [];
const writeResults = (rows) => lsSet(KEYS.results, JSON.stringify(rows));

// ---------- small helpers ----------
const $ = (id) => document.getElementById(id);
const str = (s) => { try { return String(s ?? ''); } catch { return ''; } };
const esc = (s) => str(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : '–');
const f1 = (x) => (Number.isFinite(x) ? x.toFixed(1) : '–');
const int = (x) => (Number.isFinite(x) ? String(Math.round(x)) : '–');
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const today = () => localDate(new Date());
const ID_RE = /^[A-Za-z0-9_-]{6,64}$/;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const shortDate = (ymd) => { const [y, m, d] = ymd.split('-').map(Number); return `${d} ${MONTHS[m - 1] || '?'}${y !== new Date().getFullYear() ? ` ${y}` : ''}`; };
function whenText(iso) {
  const d = new Date(typeof iso === 'string' ? iso : NaN);
  if (!iso || Number.isNaN(d.getTime())) return 'Time not known';
  return `${localTime(d)}, ${shortDate(localDate(d))}`;
}
const meta = () => HOME_TESTS[GAIT_TEST_ID] || GAIT_TEST;
const pick = (map, k) => (typeof k === 'string' && Object.prototype.hasOwnProperty.call(map, k) ? map[k] : undefined);

const QUALITY = { good: 'Quality: good', fair: 'Quality: fair', poor: 'Quality: poor' };
const LEVEL = { info: 'Note', warn: 'Check', fail: 'Problem' };
const TIMING = { motion: 'Motion sensors (first step to standing still)', manual: 'Go cue to Stop tap (includes reaction time)' };
const PLACEMENT = { waist: 'held flat at the waist', pocket: 'in a front trouser pocket', hand: 'in the hand' };
const FORMAT = { 'rfn-json': 'phone page recording (JSON)', 'gyro-starter-csv': 'gyro starter CSV', 'sensor-logger-csv': 'Sensor Logger CSV', 'phyphox-csv': 'phyphox CSV' };

// ---------- page state ----------
const S = {
  walks: new Map(),      // server walks by id
  fresh: new Set(),      // ids that arrived live during this visit
  imported: [],          // walks analysed from files, newest first
  files: null,           // last chosen files as [{ name, text }]
  newFiles: false,       // true until the newly chosen files have been analysed once
  importMsg: null,       // { kind: 'error' | 'info', text }
  flash: new Map(),      // walk id -> message after a save attempt
  walksError: '',
  conn: 'connecting',
  hadError: false,
  removeArmed: null,
  removeMsg: '',
};

// ---------- settings ----------
const person = () => ($('person').value || '').trim();
// The day the page filled in by itself, or null once the doctor picked another date. A page
// left open across midnight then moves on to the new day instead of saving real walks under
// yesterday as "demo date" (review INT-6). A date picked on purpose is never changed.
let autoDay = null;
const saveDate = () => {
  const el = $('save-date');
  if (autoDay !== null && el.value === autoDay && autoDay !== today()) el.value = autoDay = today();
  return /^\d{4}-\d{2}-\d{2}$/.test(el.value) ? el.value : today();
};
const isDemoDate = () => saveDate() !== today();
const diagnosed = () => $('diagnosed').checked;
const mdcNow = () => (diagnosed() ? GAIT_MDC.diagnosed : GAIT_MDC.prediagnosis);
const whoText = (p) => (p ? `"${esc(p)}"` : 'no name');

function renderSettings() {
  const demo = isDemoDate();
  const lab = $('demo-label');
  lab.hidden = !demo;
  if (demo) lab.textContent = `Demo date: results save under ${saveDate()}, not today (${today()}). They are marked "demo date".`;
  // The app's Monitoring view drops the demo-date mark (review INT-2, F1), so say so here.
  const note = $('demo-note'); // absent from an old cached receive.html: skip, never throw
  if (note) note.hidden = !demo;
  if (note && demo) note.textContent = 'Until the app patch in motion/MERGE.md is applied, the app\'s Monitoring view shows these walks as real. After it, they show as "Demo dates". Either way, save staged demo walks under the name "Demo (dates moved)".';
  $('mdc-now').textContent = diagnosed()
    ? `Normal variation in use: ±${f2(GAIT_MDC.diagnosed)} m/s (people already diagnosed with ALS).`
    : `Normal variation in use: ±${f2(GAIT_MDC.prediagnosis)} m/s (people not diagnosed).`;
}

// ---------- connect the phone ----------
const CONN = {
  connecting: 'Connecting to the server…',
  connected: 'Connected. New walks appear below as soon as the phone sends them.',
  reconnecting: 'Reconnecting to the server… Walks sent meanwhile are kept on the server and appear when it is back.',
  closed: 'Not connected. Trying again in 5 seconds. Is motion/server.py still running?',
  unsupported: 'This browser cannot get live updates. Reload the page to see new walks.',
};
function setConn(state) {
  S.conn = state;
  const el = $('conn-status');
  el.textContent = CONN[state] || state;
  el.dataset.state = state;
}
function connect() {
  if (typeof EventSource !== 'function') { setConn('unsupported'); return; }
  const es = new EventSource('/api/events');
  es.addEventListener('open', () => {
    setConn('connected');
    if (S.hadError) { S.hadError = false; loadWalks(); } // catch up on walks missed while away
  });
  es.addEventListener('hello', () => setConn('connected'));
  es.addEventListener('walk', (e) => {
    try { const w = JSON.parse(e.data); if (addWalk(w)) S.fresh.add(w.id); } catch (err) { console.error(err); }
    renderSettings(); // keeps the date and the demo label current, for example after midnight
    renderWalks();
  });
  es.addEventListener('error', () => {
    S.hadError = true;
    if (es.readyState === 2) { // CLOSED: the browser gave up (server gone or wrong reply)
      setConn('closed');
      es.close();
      setTimeout(connect, 5000);
    } else {
      setConn('reconnecting');
    }
  });
}

async function loadInfo() {
  const box = $('phone-urls');
  const err = $('info-error');
  try {
    const r = await fetch('/api/info', { cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const info = await r.json();
    const urls = (Array.isArray(info.phoneUrls) ? info.phoneUrls : []).filter((u) => typeof u === 'string' && u);
    let html = urls.length
      // Phone browsers do not add https:// to an IP address, and the phone port speaks only
      // HTTPS, so a short typed address fails with no reason given (review F3).
      ? `<p class="url-label">On the phone, type the whole address below. Start with https://. The phone will not add it for you. Without it, the phone only says the page "didn't send any data" or the server "dropped the connection".</p>${urls.map((u) => `<p class="url">${esc(u)}</p>`).join('')}`
      : '<p class="warn-text">No phone address found. Check that the laptop is on Wi-Fi, then restart the server.</p>';
    if (urls.length > 1) html += '<p class="note">More than one address: try the one that matches your Wi-Fi network first.</p>';
    if (info.httpsPort == null) html += '<p class="warn-text">HTTPS is off, so the phone will not give motion data. Restart the server with HTTPS on.</p>';
    box.innerHTML = html;
    err.hidden = true;
  } catch (e) {
    console.error(e);
    box.innerHTML = '';
    err.hidden = false;
  }
}

// ---------- walks received ----------
function addWalk(w) {
  if (!w || typeof w !== 'object' || typeof w.id !== 'string' || !w.id) return false;
  const isNew = !S.walks.has(w.id);
  S.walks.set(w.id, w);
  return isNew;
}
async function loadWalks() {
  try {
    const r = await fetch('/api/walks', { cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    for (const w of Array.isArray(j.walks) ? j.walks : []) addWalk(w);
    S.walksError = '';
  } catch (e) {
    console.error(e);
    S.walksError = 'Could not load walks from the server. This page must be opened from motion/server.py.';
  }
  renderWalks();
}
const walkTime = (w) => Date.parse(typeof w.receivedAt === 'string' ? w.receivedAt : typeof w.createdAt === 'string' ? w.createdAt : '') || 0;
const savedRowFor = (id, rows) => rows.find((r) => r && r.test === GAIT_TEST_ID && r.walkId === id) || null;
const isSim = (w) => w.simulated === true || w.result?.simulated === true || w.recording?.simulated === true;

function cardHtml(w, src, rows) {
  const res = w.result && typeof w.result === 'object' ? w.result : {};
  const blocker = saveBlocker(w);
  const saved = savedRowFor(w.id, rows);
  const q = res.quality;
  const issues = Array.isArray(res.issues) ? res.issues.filter((i) => i && typeof i === 'object') : [];
  const dist = Number.isFinite(res.distance_m) ? res.distance_m : w.distance_m;
  const badges = [
    `<span class="badge q-${esc(pick(QUALITY, q) ? q : 'unknown')}">${esc(pick(QUALITY, q) || 'Quality: not known')}</span>`,
    isSim(w) ? '<span class="badge badge-sim">Simulated walk</span>' : '',
    S.fresh.has(w.id) ? '<span class="badge badge-new">Just received</span>' : '',
  ].join('');
  const where = src === 'file'
    ? `From a file: ${esc((w.files || []).join(', ') || 'recording')}${w.format ? ` (${esc(pick(FORMAT, w.format) || w.format)})` : ''}`
    : `From the phone${pick(PLACEMENT, w.placement) ? `, ${pick(PLACEMENT, w.placement)}` : ''}`;
  const speed = res.ok === true && Number.isFinite(res.speed_mps)
    ? `<p class="speed"><span class="speed-num">${f2(res.speed_mps)}</span> m/s walking speed</p>`
    : '<p class="speed speed-none">No speed: this walk could not be timed.</p>';
  let summary = '';
  if (gait && typeof gait.summarizeWalk === 'function') {
    try { const line = gait.summarizeWalk(res); if (line) summary = `<p class="summary">${esc(line)}</p>`; } catch (e) { console.error(e); }
  }
  const facts = [
    [`Time over ${Number.isFinite(dist) ? `${dist} m` : 'the distance'}`, Number.isFinite(res.duration_s) ? `${f2(res.duration_s)} s` : '–'],
    ['Steps', int(res.steps)],
    ['Cadence', Number.isFinite(res.cadence_spm) ? `${int(res.cadence_spm)} steps a minute` : '–'],
    ['Timing', pick(TIMING, res.timing) || 'No timing'],
  ];
  if (Number.isFinite(res.manualDuration_s) && res.timing === 'motion') facts.push(['Stop-tap time', `${f2(res.manualDuration_s)} s (includes reaction time)`]);
  const issueHtml = issues.length
    ? `<ul class="issues">${issues.map((i) => `<li class="lvl-${esc(i.level)}"><strong>${esc(pick(LEVEL, i.level) || 'Note')}:</strong> ${esc(i.message || i.code)}</li>`).join('')}</ul>`
    : '';
  const ex = res.exploratory && typeof res.exploratory === 'object' ? res.exploratory : null;
  const exHtml = ex
    ? `<details class="explore"><summary>Exploratory numbers (never used for the flag)</summary><p>Step-time variability ${f1(ex.stepTimeCv_pct)}%, left-right difference ${f1(ex.asymmetry_pct)}%, gyroscope cadence ${int(ex.gyroCadence_spm)} steps a minute, turning ${int(ex.headingChange_deg)} degrees.</p></details>`
    : '';
  const warnings = src === 'file' && Array.isArray(w.warnings) && w.warnings.length
    ? `<ul class="issues">${w.warnings.map((m) => `<li class="lvl-info"><strong>File note:</strong> ${esc(m)}</li>`).join('')}</ul>`
    : '';
  let save;
  if (saved) {
    save = `<p class="saved"><strong>Saved</strong> as a weekly walking result: ${f2(saved.value)} m/s for ${whoText(saved.person)} on ${esc(saved.date)}${saved.demoDate ? ' (demo date)' : ''}${saved.simulated === true ? ' (simulated)' : ''}, run ${esc(saved.trial)} that day.</p>`;
  } else if (blocker) {
    save = `<button type="button" class="btn" disabled>Save as this week's walking result</button><p class="save-why">${esc(blocker)}</p>`;
  } else {
    save = `<button type="button" class="btn btn-primary" data-save="${esc(w.id)}" data-src="${src}">Save as this week's walking result</button>
      <p class="save-why">Saves for ${whoText(person())} on ${esc(saveDate())}${isDemoDate() ? ' (demo date)' : ' (today)'}. Change this under Save settings.</p>`;
  }
  const flash = S.flash.get(w.id);
  return `<article class="walk${saved ? ' is-saved' : ''}">
    <header class="walk-head"><div><p class="when">${esc(whenText(w.createdAt || w.receivedAt))}</p><p class="where">${where}</p></div><div class="badges">${badges}</div></header>
    ${speed}${summary}
    <dl class="facts">${facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
    ${issueHtml}${warnings}${exHtml}
    <div class="save">${save}${flash ? `<p class="flash" role="status">${esc(flash)}</p>` : ''}</div>
  </article>`;
}

// A walk whose data is damaged (any LAN client can POST one, and the server keeps it)
// gets a plain card instead of throwing, so it cannot blank the list or stop renderAll.
function safeCard(w, src, rows) {
  try { return cardHtml(w, src, rows); } catch (e) {
    console.error(e);
    return `<article class="walk"><p class="when">A walk that cannot be shown</p><p class="save-why">Its data is damaged, so it cannot be saved. Walk again.</p></article>`;
  }
}
function renderWalks() {
  const rows = results();
  const list = [...S.walks.values()].sort((a, b) => walkTime(b) - walkTime(a));
  $('walks-error').hidden = !S.walksError;
  $('walks-error').textContent = S.walksError;
  $('walks-empty').hidden = list.length > 0 || !!S.walksError;
  $('walk-list').innerHTML = list.map((w) => safeCard(w, 'phone', rows)).join('');
}

// ---------- import a recording ----------
function hash(str) { // FNV-1a, so the same file always gets the same walk id
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}
async function onFiles() {
  const list = [...($('files').files || [])];
  if (!list.length) return;
  try {
    S.files = await Promise.all(list.map(async (f) => ({ name: f.name, text: await f.text() })));
  } catch (e) {
    console.error(e);
    S.importMsg = { kind: 'error', text: 'Could not open the file. Pick it again.' };
    renderImport();
    return;
  }
  S.newFiles = true; // fill the distance box from these files once (review INT-3)
  analyseImport();
}
function analyseImport() {
  if (!S.files) return;
  if (!rec || !gait) {
    S.importMsg = { kind: 'error', text: `File import is not available: ${!rec ? `recording.js did not load (${recErr || 'still loading'})` : `gait.js did not load (${gaitErr || 'still loading'})`}.` };
    renderImport();
    return;
  }
  let parsed;
  try { parsed = rec.parseRecording(S.files); } catch (e) { parsed = { ok: false, error: e && e.message ? e.message : String(e) }; }
  const names = S.files.map((f) => f.name);
  if (!parsed || !parsed.ok || !parsed.recording) {
    S.newFiles = false;
    S.importMsg = { kind: 'error', text: `Could not read ${names.join(', ')}: ${parsed && parsed.error ? String(parsed.error).replace(/[.\s]+$/, '') : 'the format was not recognised'}. Use a .json saved from the phone page, or a .csv from Sensor Logger, phyphox or the gyro starter.` };
    renderImport();
    return;
  }
  // A .json from the phone page carries the distance set on the phone. Put it in the box once
  // per new file, so the speed uses it; the doctor can still change the box afterwards.
  const fileDist = parsed.recording.distance_m == null ? NaN : Number(parsed.recording.distance_m);
  if (S.newFiles && fileDist >= 1 && fileDist <= 100) $('distance').value = String(fileDist);
  S.newFiles = false;
  const dist = Number($('distance').value);
  if (!(dist >= 1 && dist <= 100)) {
    S.importMsg = { kind: 'error', text: 'Enter the distance walked, from 1 to 100 metres.' };
    renderImport();
    return;
  }
  // The box wins: it holds the file's distance (filled in above) or the doctor's correction.
  // CSV files carry no distance, so for them the doctor types it.
  const recording = { ...parsed.recording, distance_m: dist };
  let result;
  try { result = gait.analyzeWalk(recording); } catch (e) {
    console.error(e);
    S.importMsg = { kind: 'error', text: 'The analysis stopped on this file. Try another recording.' };
    renderImport();
    return;
  }
  const id = typeof recording.id === 'string' && ID_RE.test(recording.id)
    ? recording.id
    : `f-${hash(S.files.map((f) => `${f.name}\n${f.text}`).join('\n'))}`;
  const walk = {
    v: 1, kind: 'rfn-walk', id, source: 'file',
    createdAt: typeof recording.createdAt === 'string' ? recording.createdAt : new Date().toISOString(),
    distance_m: dist, placement: recording.placement ?? null, device: recording.device ?? null,
    simulated: recording.simulated === true, files: names, format: parsed.format, warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
    result,
  };
  S.imported = [walk, ...S.imported.filter((w) => w.id !== id)];
  S.importMsg = { kind: 'info', text: `Read ${names.join(', ')} as ${pick(FORMAT, parsed.format) || parsed.format || 'a recording'}, ${dist} m walked${dist === fileDist ? ' (from the file)' : ''}.` };
  renderImport();
}
function renderImport() {
  const m = $('import-msg');
  m.hidden = !S.importMsg;
  if (S.importMsg) { m.textContent = S.importMsg.text; m.dataset.kind = S.importMsg.kind; }
  const rows = results();
  $('import-list').innerHTML = S.imported.map((w) => safeCard(w, 'file', rows)).join('');
}

// ---------- saving ----------
function walkById(id, src) {
  return src === 'file' ? S.imported.find((w) => w.id === id) : S.walks.get(id);
}
function saveWalk(id, src) {
  const w = walkById(id, src);
  if (!w) return;
  const rows = readResults();
  if (rows === null) {
    S.flash.set(id, 'Nothing was saved: the results already in this browser could not be read, and saving would overwrite them.');
  } else if (savedRowFor(id, rows)) {
    S.flash.set(id, 'This walk was already saved.');
  } else {
    const d = new Date(w.createdAt || '');
    const row = makeRow(w, { date: saveDate(), time: Number.isNaN(d.getTime()) ? localTime(new Date()) : localTime(d), person: person(), results: rows, today: today() });
    if (!row) {
      S.flash.set(id, saveBlocker(w) || 'This walk cannot be saved.');
    } else {
      rows.push(row); // append only: other rows are written back unchanged
      writeResults(rows);
      S.flash.set(id, storageOk ? 'Saved. The app\'s Monitoring view reads it from this browser.' : 'Saved for this visit only: this browser is not keeping data, so it is lost on reload.');
    }
  }
  renderAll();
}

// ---------- weekly chart and flag ----------
function chartSvg(series, mdc) {
  const anySim = series.some((p) => p.sim);
  const W = 720, H = 300, L = 54, R = 168, T = 22, B = anySim ? 60 : 46; // room for a "simulated" line
  const pw = W - L - R, ph = H - T - B;
  const base = series.length >= 2 ? (series[0].value + series[1].value) / 2 : null;
  const thr = base != null ? base - mdc : null;
  const vals = series.map((p) => p.value);
  let lo = Math.min(...vals, thr ?? Infinity);
  let hi = Math.max(...vals, base ?? -Infinity);
  lo = Math.max(0, Math.floor((lo - 0.05) * 10) / 10);
  hi = Math.ceil((hi + 0.05) * 10) / 10;
  if (hi - lo < 0.4) hi = lo + 0.4;
  // 0.1 or 0.2 m/s for real walking speeds. A mistyped or hostile value (124 or 1e9 m/s)
  // gets a coarser step and a capped count, so the loop below can never hang the page.
  let step = hi - lo > 1.2 ? 0.2 : 0.1;
  while ((hi - lo) / step > 12 && step < 1e12) step *= 10;
  const times = series.map((p) => Date.parse(`${p.date}T00:00:00Z`));
  const t0 = Math.min(...times), t1 = Math.max(...times);
  const PAD = 24; // keep end points and their value labels off the axis and the line labels
  const x = (t) => (t1 === t0 ? L + pw / 2 : L + PAD + ((t - t0) / (t1 - t0)) * (pw - 2 * PAD));
  const y = (v) => T + (1 - (v - lo) / (hi - lo)) * ph;
  const parts = [];
  const nTicks = Number.isFinite(hi - lo) ? Math.min(50, Math.round((hi - lo) / step)) : 0;
  for (let i = 0; i <= nTicks; i++) {
    const v = lo + i * step;
    parts.push(`<line class="c-grid" x1="${L}" x2="${L + pw}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/>`);
    parts.push(`<text class="c-tick" x="${L - 8}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${v.toFixed(1)}</text>`);
  }
  parts.push(`<text class="c-axis" x="${L - 44}" y="${T - 8}">m/s</text>`);
  if (base != null) {
    parts.push(`<line class="c-base" x1="${L}" x2="${L + pw}" y1="${y(base).toFixed(1)}" y2="${y(base).toFixed(1)}"/>`);
    parts.push(`<text class="c-label" x="${L + pw + 8}" y="${(y(base) + 4).toFixed(1)}">baseline ${f2(base)} m/s</text>`);
    parts.push(`<line class="c-mdc" x1="${L}" x2="${L + pw}" y1="${y(thr).toFixed(1)}" y2="${y(thr).toFixed(1)}"/>`);
    parts.push(`<text class="c-label" x="${L + pw + 8}" y="${(y(thr) - 2).toFixed(1)}">normal variation</text>`);
    parts.push(`<text class="c-label c-sub" x="${L + pw + 8}" y="${(y(thr) + 13).toFixed(1)}">ends: baseline −${f2(mdc)}</text>`);
  }
  if (series.length > 1) parts.push(`<polyline class="c-path" points="${series.map((p, i) => `${x(times[i]).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ')}"/>`);
  const every = Math.max(1, Math.ceil(series.length / 8));
  series.forEach((p, i) => {
    const cx = x(times[i]).toFixed(1), cy = y(p.value).toFixed(1);
    parts.push(`<circle class="${p.demo ? 'c-pt c-demo' : 'c-pt'}" cx="${cx}" cy="${cy}" r="5.5"><title>${esc(p.date)}: ${f2(p.value)} m/s${p.n > 1 ? ` (mean of ${p.n} walks)` : ''}${p.demo ? ', demo date' : ''}${p.sim ? ', simulated' : ''}</title></circle>`);
    parts.push(`<text class="c-val" x="${cx}" y="${(y(p.value) - 10).toFixed(1)}" text-anchor="middle">${f2(p.value)}</text>`);
    if (i % every === 0 || i === series.length - 1) {
      parts.push(`<text class="c-tick" x="${cx}" y="${T + ph + 18}" text-anchor="middle">${esc(shortDate(p.date))}</text>`);
      if (p.demo) parts.push(`<text class="c-demo-t" x="${cx}" y="${T + ph + 33}" text-anchor="middle">demo</text>`);
      if (p.sim) parts.push(`<text class="c-demo-t" x="${cx}" y="${T + ph + (p.demo ? 47 : 33)}" text-anchor="middle">simulated</text>`);
    }
  });
  const label = `Weekly walking speed: ${plural(series.length, 'week')}, latest ${f2(vals[vals.length - 1])} m/s${base != null ? `, baseline ${f2(base)} m/s` : ''}.`;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">${parts.join('')}</svg>`;
}

function tableHtml(series, mdc) {
  const base = series.length >= 2 ? (series[0].value + series[1].value) / 2 : null;
  const row = (p, i) => {
    let change = 'baseline week';
    if (i >= 2 && base != null) {
      const d = p.value - base;
      change = `${d >= 0 ? '+' : '−'}${f2(Math.abs(d))} m/s${-d > mdc ? ', beyond normal variation' : ''}`;
    }
    const note = [p.demo ? 'demo date' : '', p.sim ? 'simulated' : ''].filter(Boolean).join(', ');
    return `<tr><td>${esc(p.date)}</td><td>${f2(p.value)} m/s</td><td>${p.n}</td><td>${change}</td><td>${note}</td></tr>`;
  };
  return `<table class="data"><caption>The numbers in the chart</caption><thead><tr><th>Date</th><th>Walking speed</th><th>Walks that day</th><th>Change from baseline</th><th>Note</th></tr></thead><tbody>${series.map(row).join('')}</tbody></table>`;
}

function renderWeekly() {
  const p = person();
  const mdc = mdcNow();
  const series = gaitSeries(results(), p);
  $('weekly-who').textContent = p ? `for "${p}"` : 'for results saved with no name';
  const chart = $('chart');
  if (!series.length) {
    chart.innerHTML = `<p class="empty">No walking results saved for ${whoText(p)} yet. Save a walk above and it appears here.</p>`;
  } else {
    chart.innerHTML = `${chartSvg(series, mdc)}
      <p class="legend">Filled dot: one week (several walks on one day count as their mean). Open dot: demo date. Solid line: baseline, the mean of the first two weeks. Dashed line: the baseline minus normal variation (±${f2(mdc)} m/s).${series.some((q) => q.sim) ? ' "simulated" under a date: that week includes a simulated walk, not a real one.' : ''}</p>
      ${tableHtml(series, mdc)}`;
  }
  const flag = gaitFlag(series, { mdc, detectDecline });
  const box = $('flag-box');
  box.dataset.state = flag.flagged ? 'flag' : flag.pointsNeeded > 0 ? 'wait' : 'clear';
  let more;
  if (flag.flagged) {
    const last = series[series.length - 1];
    more = `The drop was confirmed in the week of ${esc(flag.decline.date)}. This is a reason for a doctor to review the case. It does not mean ALS.`;
    if (last.date !== flag.decline.date) more += ` The most recent week (${esc(last.date)}) is ${f2(last.value)} m/s; the engine keeps the flag once two weeks in a row have dropped.`;
  }
  else if (flag.pointsNeeded > 0) more = 'The flag needs 4 weekly results: the first 2 set the baseline, then 2 weeks in a row are compared with it.';
  else more = `Baseline ${f2(flag.baseline)} m/s, the mean of the first two weeks. A flag needs two weeks in a row more than ${f2(mdc)} m/s below it.`;
  if (series.some((q) => q.sim)) more += ' Some weeks here come from simulated walks, not real ones.';
  box.innerHTML = `<p class="flag-text">${esc(flagText(flag))}</p><p class="flag-more">${more}</p>
    <p class="note">Normal variation (MDC): ±${f2(GAIT_MDC.prediagnosis)} m/s before diagnosis, ±${f2(GAIT_MDC.diagnosed)} m/s after; now using ±${f2(mdc)} m/s. Source: ${esc(GAIT_MDC.source)}.</p>`;
}

function renderRules() {
  const rule = (id) => RULES.find((r) => r.id === id);
  const unclear = rule('unclear_with_decline');
  const multi = rule('multi_region');
  const hd = FINDINGS.home_decline;
  const items = [
    `<li><strong>In an unclear case, it escalates now</strong> instead of waiting for the 8-week review${unclear ? ` (engine rule "${esc(unclear.label)}")` : ''}.</li>`,
    `<li><strong>If another body region already has motor findings</strong>, a walking decline counts as spread to a second region, the legs${multi ? ` (engine rule "${esc(multi.label)}")` : ''}: refer for EMG.</li>`,
    `<li><strong>The decline also enters the number</strong> as a home-monitoring finding with an assumed weight${hd && hd.or ? ` (odds ratio ${esc(hd.or)}, range ${esc(hd.lo)} to ${esc(hd.hi)}; an assumption, not from a study)` : ''}.</li>`,
    '<li><strong>It never diagnoses.</strong> A flag sends the case to a doctor, who decides on tests such as an EMG.</li>',
  ];
  $('rules').innerHTML = items.join('');
}

// ---------- remove walking results saved from this page ----------
const removable = (r, p) => r && r.test === GAIT_TEST_ID && (r.source === 'phone-motion' || r.source === 'file') && (r.person || '') === p;
function renderRemove() {
  const p = person();
  const n = results().filter((r) => removable(r, p)).length;
  const btn = $('remove-btn');
  if (!S.removeArmed) btn.textContent = 'Remove walking results saved from this page';
  btn.disabled = n === 0 && !S.removeArmed;
  $('remove-count').textContent = n
    ? `${plural(n, 'walking result')} saved from this page for ${p ? `"${p}"` : 'no name'}. Other tests are not touched.`
    : `No walking results saved from this page for ${p ? `"${p}"` : 'no name'}.`;
  $('remove-msg').textContent = S.removeMsg;
}
function onRemove() {
  const p = person();
  const rows = readResults();
  if (rows === null) { S.removeMsg = 'The saved results could not be read, so nothing was removed.'; renderRemove(); return; }
  const n = rows.filter((r) => removable(r, p)).length;
  const btn = $('remove-btn');
  if (!n) { S.removeMsg = 'Nothing to remove.'; renderRemove(); return; }
  if (!S.removeArmed) { // first click arms (no window.confirm: sandboxed hosts block it)
    btn.textContent = `Click again to remove ${plural(n, 'walking result')} (cannot be undone)`;
    S.removeArmed = setTimeout(() => { S.removeArmed = null; renderRemove(); }, 5000);
    return;
  }
  clearTimeout(S.removeArmed);
  S.removeArmed = null;
  writeResults(rows.filter((r) => !removable(r, p)));
  S.flash.clear();
  S.removeMsg = `Removed ${plural(n, 'walking result')}.`;
  renderAll();
}

function renderAll() {
  renderSettings();
  renderWalks();
  renderImport();
  renderWeekly();
  renderRemove();
}

// ---------- start ----------
function start() {
  $('boot').hidden = true;
  if (ensureGaitTest(HOME_TESTS)) $('gait-note').hidden = false;
  if (!storageOk) $('storage-note').hidden = false;

  const personEl = $('person');
  personEl.value = lsGet(KEYS.person) || '';
  personEl.addEventListener('input', () => {
    lsSet(KEYS.person, personEl.value);
    S.removeMsg = '';
    if (S.removeArmed) { clearTimeout(S.removeArmed); S.removeArmed = null; } // the armed count was for the old name
    renderAll();
  });
  const dateEl = $('save-date');
  dateEl.value = autoDay = today();
  dateEl.addEventListener('change', () => {
    autoDay = dateEl.value === today() ? dateEl.value : null; // today keeps following the clock; any other day is kept
    renderAll();
  });
  $('diagnosed').addEventListener('change', renderAll);
  $('files').addEventListener('change', onFiles);
  $('distance').addEventListener('change', analyseImport);
  $('remove-btn').addEventListener('click', onRemove);
  document.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-save]');
    if (b && !b.disabled) saveWalk(b.dataset.save, b.dataset.src);
  });
  // The app open in another tab changed the results or the name: follow it.
  window.addEventListener('storage', (e) => {
    if (e.key === KEYS.person && document.activeElement !== personEl) personEl.value = e.newValue || '';
    if (e.key == null || e.key === KEYS.results || e.key === KEYS.person) renderAll();
  });

  renderRules();
  renderAll();
  loadInfo();
  loadWalks();
  connect();

  import('./gait.js').then((m) => { gait = m; renderAll(); if (S.files) analyseImport(); })
    .catch((e) => { console.error(e); gaitErr = e && e.message ? e.message : 'unknown error'; });
  import('./recording.js').then((m) => { rec = m; if (S.files) analyseImport(); })
    .catch((e) => { console.error(e); recErr = e && e.message ? e.message : 'unknown error'; });
}

start();
