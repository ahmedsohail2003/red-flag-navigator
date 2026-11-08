// Home tests page (app/hometests.html).
// Working: finger tapping (each hand), reading rate (speech), weight entry,
// team calibration of the minimal detectable change (MDC), history with CSV export.
// Mockup: the walking test with the phone's motion sensor.
// The pure maths at the top touches no DOM, so Node can import this file
// (tests/hometests.test.mjs). Results stay in this browser (localStorage) only.
import { HOME_TESTS, FINDINGS, SOURCES, UNCLEAR_DEADLINE_WEEKS, detectDecline } from './engine.js';
import { EVIDENCE } from './evidence.js';

// ================= pure maths (unit-tested) =================
export function mean(xs) {
  if (!xs.length) return NaN;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}
// Sample variance (divide by n - 1): spread of repeated trials around their own mean.
export function variance(xs) {
  if (xs.length < 2) return NaN;
  const m = mean(xs);
  let s = 0;
  for (const x of xs) s += (x - m) ** 2;
  return s / (xs.length - 1);
}
export function sd(xs) { return Math.sqrt(variance(xs)); }
// Coefficient of variation in percent: SD as a share of the mean.
export function cv(xs) {
  const m = mean(xs);
  return m ? (sd(xs) / m) * 100 : NaN;
}
// Pooled within-person SD = square root of the mean of each person's variance.
// Each person counts equally; people with fewer than 2 trials have no variance and are left out.
export function pooledSd(groups) {
  const vars = groups.filter((g) => g.length >= 2).map(variance);
  return vars.length ? Math.sqrt(mean(vars)) : NaN;
}
export const Z95 = 1.96;
// MDC95: a change between two results smaller than this is normal test-to-test variation
// (95% of the time). Times sqrt(2) because a change compares two results, each with its own noise.
export function mdc95(pooled) { return Z95 * Math.SQRT2 * pooled; }
export function intervals(times) {
  const out = [];
  for (let i = 1; i < times.length; i++) out.push(times[i] - times[i - 1]);
  return out;
}
// times: tap timestamps in ms. Mean interval and rhythm variability (CV of the intervals).
export function tapStats(times) {
  const iv = intervals(times);
  return { taps: times.length, meanIntervalMs: mean(iv), cvPct: cv(iv) };
}
export function countWords(text) { return String(text).trim().split(/\s+/).filter(Boolean).length; }
export function wordsPerMinute(words, ms) { return ms > 0 ? words / (ms / 60000) : NaN; }
const pad2 = (n) => String(n).padStart(2, '0');
// Local calendar date (not UTC: at 8 pm in Hamilton, UTC is already tomorrow).
export function localDate(d = new Date()) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
export function localTime(d = new Date()) { return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; }

// Calibration: per person mean and SD of their trials for one test, pooled SD and MDC95.
export function calibrationSummary(results, test) {
  const byPerson = new Map();
  for (const r of results) {
    if (!r || !r.calibration || r.test !== test || !Number.isFinite(r.value)) continue;
    const p = r.person || '(no name)';
    if (!byPerson.has(p)) byPerson.set(p, []);
    byPerson.get(p).push(r.value);
  }
  const groups = [...byPerson.values()];
  const people = [...byPerson].map(([person, values]) => ({ person, n: values.length, mean: mean(values), sd: sd(values) }));
  const pooled = pooledSd(groups);
  return {
    test,
    people,
    nTrials: groups.reduce((a, g) => a + g.length, 0),
    nUsable: groups.filter((g) => g.length >= 2).length,
    pooledSd: pooled,
    mdc: Number.isFinite(pooled) ? mdc95(pooled) : NaN,
  };
}

// One value per date for a person's weekly (non-calibration) results: several runs on
// the same day are averaged, so the series really is one point per week.
export function weeklySeries(results, test, person = '') {
  const byDate = new Map();
  for (const r of results) {
    if (!r || r.calibration || r.test !== test || (r.person || '') !== person || !Number.isFinite(r.value)) continue;
    if (!byDate.has(r.date)) byDate.set(r.date, []);
    byDate.get(r.date).push(r.value);
  }
  return [...byDate].sort((a, b) => a[0].localeCompare(b[0])).map(([date, vs]) => ({ date, value: mean(vs), n: vs.length }));
}

export function toCsv(rows, columns) {
  const cell = (v) => {
    if (v == null || (typeof v === 'number' && !Number.isFinite(v))) return '';
    let s = String(v);
    if (typeof v === 'string' && /^[=+\-@]/.test(s)) s = `'${s}`; // keep spreadsheets from running typed names as formulas
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.join(','), ...rows.map((r) => columns.map((c) => cell(r[c])).join(','))].join('\r\n') + '\r\n';
}

// The fixed reading passage: the same words every week.
export const PASSAGE = 'Every Sunday the kitchen fills with the smell of onions and warm bread. '
  + 'The radio plays quietly while a pot of soup heats on the stove. First the carrots are washed '
  + 'and cut into small pieces, then the rice is rinsed in cold water. Outside, the street is calm, '
  + 'and a dog barks once at a passing bike. When the table is set, the family sits down and the '
  + 'plates are passed from hand to hand. Someone tells a story about the week, and everyone laughs. '
  + 'Later the dishes are stacked by the sink, and the kitchen lights go off.';

// ================= page =================
// initHomeTests(root, { skin, onChange }) wires the tests to markup already in `root`
// (same element ids as hometests.html). skin 'page' = the old hometests.html markup;
// 'app' = the app design system (app/css/app.css). Only the old page self-starts.
const KEYS = { results: 'rfn.homeResults', mdc: 'rfn.mdc', person: 'rfn.hometests.person' };
export const TAP_SECONDS = 10;
const COUNTDOWN_FROM = 3;
export const CALIB_TRIALS = 10;
const MIN_READ_MS = 10000; // the whole passage in under 10 s would be about 600 words a minute: a mis-press
const CALIB_TESTS = ['tap_right', 'tap_left', 'reading'];
export const SHORT = { tap_right: 'Tapping, right hand', tap_left: 'Tapping, left hand', reading: 'Reading rate', walk: 'Walking', weight: 'Body weight', gait_speed: 'Walking speed' };
export const UNIT = { tap_right: 'taps', tap_left: 'taps', reading: 'words a minute', walk: 'percentage points', weight: 'kg', gait_speed: 'm/s' };
const REGION_ROWS = [
  { region: 'Hand and arm', tests: ['tap_right', 'tap_left'], name: 'Finger tapping, each hand on its own', status: 'working', alex: 'First symptom, June 2024: handwriting fading on the whiteboard.' },
  { region: 'Speech', tests: ['reading'], name: 'Reading a fixed passage aloud', status: 'working', alex: 'Now: 165 words a minute at 9 am, 118 at 4 pm.' },
  { region: 'Legs', tests: ['gait_speed'], name: 'Walking speed, 10 m walk (phone motion sensors)', status: 'working', alex: 'April 2025: right foot catching on stairs; foot drop kept getting worse in physio.' },
  { region: 'Whole body', tests: ['weight'], name: 'Body weight', status: 'working', alex: '' },
];

let ROOT = null; // document (old page) or the app view's root element
let SKIN = 'page';
let onChangeCb = null;
const $ = (id) => (ROOT || document).querySelector(`#${id}`);
const $$ = (sel) => (ROOT || document).querySelectorAll(sel);
const setText = (id, t) => { const e = $(id); if (e) e.textContent = t; };
const setHtml = (id, h) => { const e = $(id); if (e) e.innerHTML = h; };
const esc =(s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (x, d = 0) => (Number.isFinite(x) ? x.toFixed(d) : '–');
const num = (x) => (Number.isFinite(x) ? (Number.isInteger(x) ? String(x) : x.toFixed(1)) : '–');
const round1 = (x) => Math.round(x * 10) / 10;
const reduceMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

// Storage can be missing or throw (private modes, sandboxed hosting). Fall back to
// memory for this visit so the tests still work; results then last until reload.
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
function lsRemove(k) {
  if (storageOk) { try { localStorage.removeItem(k); } catch { storageOk = false; } }
  mem.delete(k);
}
function loadJson(key, fallback) {
  try { const v = JSON.parse(lsGet(key)); return v ?? fallback; } catch { return fallback; }
}
export function getResults() { const r = loadJson(KEYS.results, []); return Array.isArray(r) ? r : []; }
function setResults(r) { lsSet(KEYS.results, JSON.stringify(r)); }
export function getMdc() { const m = loadJson(KEYS.mdc, {}); return m && typeof m === 'object' && !Array.isArray(m) ? m : {}; }
function setMdc(m) { lsSet(KEYS.mdc, JSON.stringify(m)); }
export function mdcInUse(test) {
  const m = Number(getMdc()[test]);
  if (Number.isFinite(m) && m > 0) return { value: m, measured: true };
  return { value: HOME_TESTS[test]?.placeholderMdc, measured: false };
}
const SINGULAR = { taps: 'tap', 'percentage points': 'percentage point' };
export const unitFor = (test, v) => (Number(v) === 1 && SINGULAR[UNIT[test]]) || UNIT[test];

// Markup that differs between the old page and the app. Everything else is shared.
const SKINS = {
  page: {
    tag: (measured) => (measured ? '<span class="measured-tag">MEASURED</span>' : '<span class="assume-tag">ASSUMPTION</span>'),
    msg: (html) => `<p class="msg">${html}</p>`,
    note: (html) => `<p class="muted small">${html}</p>`,
    result: (stats, note) => `
    <div class="result-grid${stats.length === 2 ? ' two' : ''}">
      ${stats.map((s) => `<div class="stat"><span class="num">${s.v}${s.u ? `<small> ${s.u}</small>` : ''}</span><span class="lbl">${s.l}</span></div>`).join('\n      ')}
    </div>
    <p class="muted small">${note}</p>`,
    runComplete: ' Run complete: <a href="#calib-card">see the team result</a>.',
    banner: (html) => `<span>${html}</span>
        <button type="button" class="calib-stop">Stop calibration</button>`,
    calib: (c) => {
      const inUseLine = `<p class="in-use">In use now for ${esc(c.shortLower)}: <strong>${c.mdcText}</strong>${c.measured ? ' <button type="button" id="mdc-reset" class="link-btn">Go back to the placeholder</button>' : ' (a placeholder until the team measures its own)'}</p>`;
      const s = c.s;
      if (!s.nTrials) {
        return `
      <div class="empty">
        <p><strong>No calibration trials yet for ${esc(c.shortLower)}.</strong> The team collects these tonight: each teammate types their name in "Who is testing", presses Start ${CALIB_TRIALS} trials, and does the test ${CALIB_TRIALS} times in a row. No numbers are filled in until then.</p>
      </div>${inUseLine}`;
      }
      const rows = s.people.map((p) => `<tr><td>${esc(p.person)}</td><td>${p.n} of ${CALIB_TRIALS}${p.n < 2 ? ' <span class="muted">(needs 2+)</span>' : ''}</td><td>${fmt(p.mean, 1)}</td><td>${fmt(p.sd, 2)}</td></tr>`).join('');
      return `
      <div class="table-wrap"><table class="calib-table">
        <thead><tr><th>Teammate</th><th>Trials</th><th>Their average (${esc(c.unit)})</th><th>Their spread (SD)</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
      <div class="mdc-result ${c.ready ? '' : 'pending'}">
        ${c.ready ? `
          <div class="mdc-big">±${fmt(s.mdc, 1)} <span>${esc(c.unit)}</span></div>
          <div class="mdc-explain">
            <p><strong>A drop smaller than this is normal variation.</strong> From ${s.nUsable} ${s.nUsable === 1 ? 'person' : 'people'} and ${s.nTrials} trials.</p>
            <p class="calc">Pooled spread = ${fmt(s.pooledSd, 2)} ${esc(c.unit)}. MDC = 1.96 × √2 × ${fmt(s.pooledSd, 2)} = <strong>${fmt(s.mdc, 2)}</strong></p>
            <button type="button" class="primary" id="mdc-save"${c.alreadyInUse ? ' disabled' : ''}>${c.alreadyInUse ? `In use for this test: ±${fmt(s.mdc, 1)} ${esc(c.unit)}` : `Use ±${fmt(s.mdc, 1)} ${esc(c.unit)} for this test`}</button>
          </div>` : '<p>Each person needs at least 2 trials before their spread can be measured.</p>'}
      </div>
      ${s.people.some((p) => p.n < CALIB_TRIALS) ? `<p class="muted small">The plan is ${CALIB_TRIALS} trials per teammate; fewer trials give a rougher estimate.</p>` : ''}
      ${inUseLine}`;
    },
  },
  app: {
    tag: (measured) => (measured
      ? '<span class="chip real" title="Measured by the team (10 repeats each)">Measured</span>'
      : '<span class="chip assume" title="A team assumption until it is measured">Assumption</span>'),
    msg: (html) => `<p class="ht-msg">${html}</p>`,
    note: (html) => `<p class="note">${html}</p>`,
    result: (stats, note) => `
      <div class="ht-kvs">${stats.map((s) => `<div class="kv"><span>${s.l[0].toUpperCase()}${s.l.slice(1)}</span><span class="v">${s.v}${s.u ? ` ${s.u}` : ''}</span></div>`).join('')}</div>
      <p class="note">${note}</p>`,
    runComplete: ' Run complete: the team result is in Team calibration below.',
    banner: (html) => `<span>${html}</span><button type="button" class="btn sm calib-stop">Stop calibration</button>`,
    calib: (c) => {
      const s = c.s;
      const inUse = `<div class="ht-inuse"><span class="micro">In use now</span><span class="mono">±${num(c.inUseValue)} ${esc(unitFor(c.test, c.inUseValue))}</span>${SKINS.app.tag(c.measured)}${c.measured ? '<button type="button" id="mdc-reset" class="btn quiet sm">Go back to the placeholder</button>' : '<span class="note">a placeholder until the team measures its own</span>'}</div>`;
      if (!s.nTrials) {
        return `<div class="inset ht-empty"><p><b>No calibration trials yet for ${esc(c.shortLower)}.</b> Each teammate types their name in Who is testing, presses Start ${CALIB_TRIALS} trials and does the test ${CALIB_TRIALS} times in a row. No numbers are filled in until then.</p></div>${inUse}`;
      }
      const rows = s.people.map((p) => `<tr><td>${esc(p.person)}</td><td class="num">${p.n} of ${CALIB_TRIALS}${p.n < 2 ? ' <span class="faint">(needs 2+)</span>' : ''}</td><td class="num">${fmt(p.mean, 1)}</td><td class="num">${fmt(p.sd, 2)}</td></tr>`).join('');
      return `
      <div class="table-wrap"><table class="tbl">
        <thead><tr><th>Teammate</th><th class="num">Trials</th><th class="num">Average (${esc(c.unit)})</th><th class="num">Spread (SD)</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
      ${c.ready ? `
      <div class="ht-mdc">
        <div><div class="micro">Minimal detectable change</div><div class="stat">±${fmt(s.mdc, 1)}<span class="stat-unit">${esc(c.unit)}</span></div></div>
        <div class="stack">
          <p><b>A drop smaller than this is normal variation.</b> From ${s.nUsable} ${s.nUsable === 1 ? 'person' : 'people'} and ${s.nTrials} trials.</p>
          <p class="mono ht-calc">pooled SD ${fmt(s.pooledSd, 2)} · MDC = 1.96 × √2 × ${fmt(s.pooledSd, 2)} = ${fmt(s.mdc, 2)}</p>
          <div><button type="button" class="btn primary sm" id="mdc-save"${c.alreadyInUse ? ' disabled' : ''}>${c.alreadyInUse ? `In use: ±${fmt(s.mdc, 1)} ${esc(c.unit)}` : `Use ±${fmt(s.mdc, 1)} ${esc(c.unit)} for this test`}</button></div>
        </div>
      </div>` : '<p class="note">Each person needs at least 2 trials before their spread can be measured.</p>'}
      ${s.people.some((p) => p.n < CALIB_TRIALS) ? `<p class="note">The plan is ${CALIB_TRIALS} trials per teammate; fewer trials give a rougher estimate.</p>` : ''}
      ${inUse}`;
    },
  },
};
const skin = () => SKINS[SKIN] || SKINS.page;

// Every MDC shown says whether the team measured it or it is still the engine's placeholder.
function mdcTag(test) {
  return skin().tag(mdcInUse(test).measured);
}
function mdcText(test) {
  const u = mdcInUse(test);
  return `±${num(u.value)} ${unitFor(test, u.value)} ${mdcTag(test)}`;
}
const personName = () => ($('person')?.value || '').trim();
// The name results are saved under: the field when it is on screen, else the last one typed.
export function currentPerson() { const p = $('person'); return ((p ? p.value : lsGet(KEYS.person)) || '').trim(); }

// calibration run in progress: { test, person, done }
let calib = null;

function makeRecord(test, value, extra = {}) {
  const results = getResults();
  const now = new Date();
  const date = localDate(now);
  const isCal = !!(calib && calib.test === test);
  const person = isCal ? calib.person : personName();
  const same = (r) => r.test === test && (r.person || '') === person;
  const trial = isCal
    ? results.filter((r) => r.calibration && same(r)).length + 1
    : results.filter((r) => !r.calibration && same(r) && r.date === date).length + 1;
  return { date, time: localTime(now), test, value, trial, person, calibration: isCal, ...extra };
}
function addResult(rec) {
  const results = getResults();
  results.push(rec);
  setResults(results);
}
// After a saved result: advance the calibration run if one is going. Returns a line for the result panel.
function afterSave(rec) {
  let line;
  if (rec.calibration) {
    calib.done += 1;
    line = `Saved as calibration trial ${calib.done} of ${CALIB_TRIALS} for ${esc(rec.person)}.`;
    if (calib.done >= CALIB_TRIALS) {
      line += skin().runComplete;
      endCalibration();
    }
  } else {
    const who = rec.person ? ` for ${esc(rec.person)}` : '';
    line = `Saved: ${esc(SHORT[rec.test])}, weekly result${who} (run ${rec.trial} today).`;
  }
  renderAll();
  return line;
}

// ---------- finger tapping ----------
const tap = { state: 'idle', test: 'tap_right', times: [], t0: 0, timers: [], raf: 0, active: new Set() };

function setHand(test) {
  tap.test = test;
  // radio buttons (old page) use aria-checked; the app's segmented control uses aria-pressed
  $$('#hand-seg button').forEach((b) => b.setAttribute(b.hasAttribute('aria-pressed') ? 'aria-pressed' : 'aria-checked', String(b.dataset.test === test)));
  if (ROOT && ROOT !== document) ROOT.querySelectorAll('[data-hand-label]').forEach((e) => { e.textContent = test === 'tap_left' ? 'Left hand' : 'Right hand'; });
}
function tapUi(state) {
  tap.state = state;
  const busy = state === 'countdown' || state === 'running';
  $('tap-start').hidden = busy;
  $('tap-cancel').hidden = !busy;
  $('tap-pad').classList.toggle('armed', state === 'countdown');
  $('tap-pad').classList.toggle('running', state === 'running');
  $$('#hand-seg button').forEach((b) => { b.disabled = busy || !!(calib && calib.test.startsWith('tap_')); });
}
function clearTapTimers() {
  tap.timers.forEach(clearTimeout);
  tap.timers = [];
  cancelAnimationFrame(tap.raf);
}
function tapStart() {
  if (tap.state === 'countdown' || tap.state === 'running') return;
  tap.times = [];
  tap.active.clear();
  $('tap-result').innerHTML = '';
  $('tap-bar').style.width = '0%';
  tapUi('countdown');
  $('tap-pad').focus({ preventScroll: true });
  let n = COUNTDOWN_FROM;
  $('tap-big').textContent = n;
  $('tap-small').textContent = 'Get ready: one index finger on the pad';
  const step = () => {
    n -= 1;
    if (n > 0) { $('tap-big').textContent = n; tap.timers.push(setTimeout(step, 1000)); } else tapGo();
  };
  tap.timers.push(setTimeout(step, 1000));
}
function tapGo() {
  tapUi('running');
  tap.t0 = performance.now();
  $('tap-big').textContent = '0';
  $('tap-small').textContent = `Tap! ${TAP_SECONDS} s left`;
  tap.timers.push(setTimeout(tapFinish, TAP_SECONDS * 1000));
  const frame = () => {
    const el = performance.now() - tap.t0;
    $('tap-bar').style.width = `${Math.min(100, (el / (TAP_SECONDS * 1000)) * 100)}%`;
    $('tap-small').textContent = `Tap! ${Math.max(0, Math.ceil(TAP_SECONDS - el / 1000))} s left`;
    if (tap.state === 'running') tap.raf = requestAnimationFrame(frame);
  };
  tap.raf = requestAnimationFrame(frame);
}
function recordTap() {
  if (tap.state !== 'running') return;
  const now = performance.now();
  if (now - tap.t0 > TAP_SECONDS * 1000) return;
  tap.times.push(now);
  $('tap-big').textContent = tap.times.length;
  if (!reduceMotion() && $('tap-pad').animate) {
    $('tap-pad').animate([{ transform: 'scale(0.985)' }, { transform: 'scale(1)' }], { duration: 90 });
  }
}
function tapCancel() {
  clearTapTimers();
  tapUi('idle');
  $('tap-big').textContent = 'Ready';
  $('tap-small').textContent = 'Stopped. Nothing was saved.';
  $('tap-bar').style.width = '0%';
}
function tapFinish() {
  clearTapTimers();
  tapUi('done');
  $('tap-bar').style.width = '100%';
  const st = tapStats(tap.times);
  $('tap-big').textContent = st.taps;
  $('tap-small').textContent = 'Done. Press Start to go again.';
  if (st.taps === 0) {
    $('tap-result').innerHTML = skin().msg('No taps were recorded, so nothing was saved. Press Start to try again.');
    return;
  }
  const rec = makeRecord(tap.test, st.taps, {
    cv: Number.isFinite(st.cvPct) ? round1(st.cvPct) : null,
    meanIntervalMs: Number.isFinite(st.meanIntervalMs) ? Math.round(st.meanIntervalMs) : null,
  });
  addResult(rec);
  const line = afterSave(rec);
  $('tap-result').innerHTML = skin().result([
    { v: st.taps, u: '', l: `taps in ${TAP_SECONDS} s` },
    { v: fmt(st.meanIntervalMs), u: 'ms', l: 'average gap between taps' },
    { v: fmt(st.cvPct, 1), u: '%', l: 'rhythm variability (CV)' },
  ], `${line} Rhythm variability is how uneven the gaps between taps are: their standard deviation as a percentage of the average gap. Lower is steadier.${st.taps < 3 ? ' It needs at least 3 taps.' : ''}`);
}

// ---------- reading rate ----------
const WORDS = countWords(PASSAGE);
const rd = { state: 'idle', t0: 0, raf: 0 };
function readStart() {
  if (rd.state === 'running') return;
  rd.state = 'running';
  rd.t0 = performance.now();
  $('read-start').disabled = true;
  $('read-stop').disabled = false;
  $('read-stop').focus({ preventScroll: true });
  $('passage').classList.add('active');
  $('read-result').innerHTML = '';
  const frame = () => {
    if (rd.state !== 'running') return;
    $('read-timer').textContent = `${((performance.now() - rd.t0) / 1000).toFixed(1)} s`;
    rd.raf = requestAnimationFrame(frame);
  };
  rd.raf = requestAnimationFrame(frame);
}
function readStop() {
  if (rd.state !== 'running') return;
  const ms = performance.now() - rd.t0;
  rd.state = 'idle';
  cancelAnimationFrame(rd.raf);
  $('read-start').disabled = false;
  $('read-stop').disabled = true;
  $('passage').classList.remove('active');
  $('read-timer').textContent = `${(ms / 1000).toFixed(1)} s`;
  if (ms < MIN_READ_MS) {
    $('read-result').innerHTML = skin().msg('That was too quick to be a full reading (under 10 seconds), so it was not saved. Press Start as you say the first word and Stop after the last.');
    return;
  }
  const wpm = wordsPerMinute(WORDS, ms);
  const rec = makeRecord('reading', round1(wpm), { seconds: round1(ms / 1000), words: WORDS });
  addResult(rec);
  const line = afterSave(rec);
  $('read-result').innerHTML = skin().result([
    { v: fmt(wpm), u: '', l: 'words a minute' },
    { v: fmt(ms / 1000, 1), u: 's', l: `for ${WORDS} words` },
  ], `${line} Words a minute = ${WORDS} words ÷ ${fmt(ms / 60000, 2)} minutes.`);
}

// ---------- weight ----------
function weightSave() {
  const v = parseFloat($('weight-input').value);
  if (!(v >= 20 && v <= 400)) {
    $('weight-result').innerHTML = skin().msg('Please enter your weight in kilograms.');
    return;
  }
  const rec = makeRecord('weight', round1(v));
  addResult(rec);
  const line = afterSave(rec);
  $('weight-input').value = '';
  $('weight-result').innerHTML = skin().note(line);
}

// ---------- calibration ----------
function calibStart() {
  const test = $('calib-test').value;
  const person = personName();
  if (!person) {
    $('calib-hint').textContent = 'Type the teammate\'s name in "Who is testing" first.';
    $('person').focus();
    return;
  }
  if (tap.state === 'countdown' || tap.state === 'running' || rd.state === 'running') {
    $('calib-hint').textContent = 'Finish the test that is running first.';
    return;
  }
  $('calib-hint').textContent = '';
  calib = { test, person, done: 0 };
  if (test.startsWith('tap_')) setHand(test);
  renderCalibBanners();
  tapUi(tap.state);
  $('person').disabled = true;
  const card = test.startsWith('tap_') ? $('tap-card') : $('read-card');
  card.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'start' });
}
function endCalibration() {
  calib = null;
  $('person').disabled = false;
  renderCalibBanners();
  tapUi(tap.state === 'running' || tap.state === 'countdown' ? tap.state : 'idle');
}
function renderCalibBanners() {
  for (const [id, isMine] of [['tap-calib', (t) => t.startsWith('tap_')], ['read-calib', (t) => t === 'reading']]) {
    const el = $(id);
    if (!el) continue;
    if (calib && isMine(calib.test)) {
      el.hidden = false;
      el.innerHTML = skin().banner(`<strong>Calibration run: ${esc(calib.person)}</strong>, ${esc(SHORT[calib.test])}. Trial ${Math.min(calib.done + 1, CALIB_TRIALS)} of ${CALIB_TRIALS} next. These trials measure normal variation; they are not weekly results.`);
      el.querySelector('.calib-stop').addEventListener('click', () => { endCalibration(); renderCalibration(); });
    } else {
      el.hidden = true;
      el.innerHTML = '';
    }
  }
}
function renderCalibration() {
  if (!$('calib-test') || !$('calib-summary')) return;
  const test = $('calib-test').value;
  const s = calibrationSummary(getResults(), test);
  const inUse = mdcInUse(test);
  const ready = Number.isFinite(s.mdc);
  const rounded = ready ? Math.round(s.mdc * 100) / 100 : NaN;
  $('calib-summary').innerHTML = skin().calib({
    test, s, ready,
    unit: UNIT[test],
    shortLower: SHORT[test].toLowerCase(),
    measured: inUse.measured,
    inUseValue: inUse.value,
    mdcText: mdcText(test),
    alreadyInUse: ready && Number(getMdc()[test]) === rounded,
  });
  if (ready && s.nTrials && $('mdc-save')) {
    $('mdc-save').addEventListener('click', () => {
      const m = getMdc();
      m[test] = rounded;
      setMdc(m);
      renderAll();
    });
  }
  const reset = $('mdc-reset');
  if (reset) reset.addEventListener('click', () => { const m = getMdc(); delete m[test]; setMdc(m); renderAll(); });
  $('calib-start').disabled = !!calib;
  $('calib-start').textContent = calib ? `Run in progress (${calib.done} of ${CALIB_TRIALS})` : `Start ${CALIB_TRIALS} trials`;
}

// ---------- region table, trend, history ----------
function renderRegions() {
  if (!$('region-table')) return; // the app view draws its own coverage matrix
  const rows = REGION_ROWS.map((r) => `
    <tr>
      <td class="region-cell"><strong>${esc(r.region)}</strong></td>
      <td>${esc(r.name)} ${r.status === 'working' ? '<span class="status-tag working">Working</span>' : '<span class="status-tag mock">Mockup</span>'}${r.alex ? `<div class="alex-line">Alex: ${esc(r.alex)}</div>` : ''}</td>
      <td class="mdc-cell">${r.tests.map((t) => `<div>${r.tests.length > 1 ? `${t === 'tap_right' ? 'Right' : 'Left'}: ` : ''}${mdcText(t)}</div>`).join('')}</td>
    </tr>`).join('');
  $('region-table').innerHTML = `<thead><tr><th>Region</th><th>Test</th><th>Normal variation (MDC)</th></tr></thead><tbody>${rows}</tbody>`;
}

function renderTrend() {
  if (!$('trend')) return; // the app view draws its own trend charts
  const results = getResults();
  const person = personName();
  const lines = [];
  for (const test of Object.keys(HOME_TESTS)) {
    const series = weeklySeries(results, test, person);
    if (!series.length) continue;
    const meta = HOME_TESTS[test];
    const { value: mdc } = mdcInUse(test);
    const unit = UNIT[test];
    let cls = '';
    let text;
    if (series.length < 4) {
      text = `${series.length} ${series.length === 1 ? 'week' : 'weeks'} so far. The first 2 weeks set the baseline; after that, 2 results in a row are compared with it.`;
    } else {
      const d = detectDecline(series, { mdc, higherIsBetter: meta.higherIsBetter });
      const baseline = (series[0].value + series[1].value) / 2;
      const latest = series[series.length - 1].value;
      const worse = meta.higherIsBetter ? baseline - latest : latest - baseline;
      const tag = mdcTag(test);
      if (d) {
        cls = 'high';
        text = `<strong>Real change on ${esc(d.date)}:</strong> two results in a row worse than the baseline (${num(round1(baseline))} ${unit}) by more than ±${num(mdc)} ${unitFor(test, mdc)} ${tag}. Worth showing the doctor: it is a reason to look sooner, not a diagnosis.`;
      } else if (worse > mdc) {
        cls = 'unclear';
        text = `Baseline ${num(round1(baseline))}, latest ${num(round1(latest))} ${unit}: worse by more than ±${num(mdc)} ${tag}, but only once. One more like it would count as a real change.`;
      } else {
        text = `Baseline ${num(round1(baseline))}, latest ${num(round1(latest))} ${unit}: within normal variation (±${num(mdc)} ${tag}).`;
      }
    }
    lines.push(`<div class="trend-line ${cls}"><span class="trend-test">${esc(SHORT[test])}</span><span>${text}</span></div>`);
  }
  const who = person ? esc(person) : 'results with no name';
  $('trend').innerHTML = lines.length
    ? `<h3>Weekly trend against the baseline <span class="muted">(${who})</span></h3>${lines.join('')}<p class="muted small">One value per day: several runs on the same day are averaged. Calibration trials are left out.</p>`
    : '';
}

const CSV_COLUMNS = ['date', 'time', 'test', 'value', 'unit', 'person', 'trial', 'calibration', 'cv', 'meanIntervalMs', 'seconds', 'words'];
function renderHistory() {
  if (!$('history-table')) return;
  const results = getResults();
  for (const id of ['csv-btn', 'csv-copy-btn', 'delete-btn']) { const b = $(id); if (b) b.disabled = !results.length; }
  setText('history-count', results.length ? `${results.length} saved` : '');
  if (!results.length) {
    $('history-table').innerHTML = '';
    $('history-empty').hidden = false;
    return;
  }
  $('history-empty').hidden = true;
  const rows = results.map((r, i) => ({ r, i }))
    .sort((a, b) => (b.r.date + (b.r.time || '')).localeCompare(a.r.date + (a.r.time || '')) || b.i - a.i)
    .map(({ r }) => `
      <tr>
        <td class="nowrap">${esc(r.date)}${r.time ? ` <span class="muted">${esc(r.time)}</span>` : ''}</td>
        <td>${esc(SHORT[r.test] || r.test)}</td>
        <td class="nowrap"><strong>${esc(num(r.value))}</strong> ${esc(UNIT[r.test] || '')}</td>
        <td>${r.cv != null ? `${esc(num(r.cv))} %` : '<span class="muted">–</span>'}</td>
        <td>${r.person ? esc(r.person) : '<span class="muted">–</span>'}</td>
        <td>${esc(r.trial ?? '')}</td>
        <td>${r.calibration ? '<span class="kind cal">Calibration</span>' : '<span class="kind wk">Weekly</span>'}</td>
      </tr>`).join('');
  $('history-table').innerHTML = `<thead><tr><th>Date</th><th>Test</th><th>Result</th><th>Rhythm CV</th><th>Person</th><th>Trial</th><th>Kind</th></tr></thead><tbody>${rows}</tbody>`;
}
function downloadCsv() {
  const results = getResults().map((r) => ({ ...r, unit: HOME_TESTS[r.test]?.unit || '' }));
  if (!results.length) return;
  const blob = new Blob([toCsv(results, CSV_COLUMNS)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `home-test-results-${localDate()}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
// Copy works where downloads are blocked (for example the hosted copy).
async function copyCsv() {
  const results = getResults().map((r) => ({ ...r, unit: HOME_TESTS[r.test]?.unit || '' }));
  if (!results.length) return;
  const btn = $('csv-copy-btn');
  try {
    await navigator.clipboard.writeText(toCsv(results, CSV_COLUMNS));
    btn.textContent = 'Copied';
  } catch {
    btn.textContent = 'Copy blocked here';
  }
  setTimeout(() => { btn.textContent = 'Copy CSV'; }, 2500);
}
// Two clicks instead of confirm(), which some browsers and hosted frames block.
let deleteArmed = null;
function deleteAll() {
  const n = getResults().length;
  if (!n) return;
  const btn = $('delete-btn');
  if (!deleteArmed) {
    btn.textContent = `Click again to delete ${n} result${n === 1 ? '' : 's'} (cannot be undone)`;
    deleteArmed = setTimeout(() => { deleteArmed = null; btn.textContent = 'Delete all results'; }, 5000);
    return;
  }
  clearTimeout(deleteArmed);
  deleteArmed = null;
  btn.textContent = 'Delete all results';
  lsRemove(KEYS.results);
  if (calib) endCalibration();
  renderAll();
}

function notify() {
  if (onChangeCb) { try { onChangeCb(); } catch (e) { console.error(e); } }
}

function renderAll() {
  renderRegions();
  renderCalibration();
  renderTrend();
  renderHistory();
  renderCalibBanners();
  notify();
}

function renderStatic() {
  setText('passage', PASSAGE);
  setText('passage-count', `${WORDS} words, the same passage every week.`);
  setText('deadline-weeks', UNCLEAR_DEADLINE_WEEKS);
  setHtml('calib-test', CALIB_TESTS.map((t) => `<option value="${t}">${esc(HOME_TESTS[t].label)}</option>`).join(''));
  const w = FINDINGS.weight_loss;
  setHtml('weight-why', `Weight loss is one of the signs in the primary-care study the scorer uses: adjusted odds ratio ${w.or.toFixed(2)} (95% CI ${w.lo.toFixed(2)} to ${w.hi.toFixed(2)}), <a href="${esc(SOURCES[w.source].url)}" target="_blank" rel="noopener">${esc(SOURCES[w.source].short)}</a>.`);
  if ($('walk-evidence')) setHtml('walk-evidence', walkEvidenceHtml());
}

// Real-data check from the team's analysis (evidence.js). Falls back to "pending" or a link
// when the numbers are missing, so a change in that file never breaks this page.
function walkEvidenceHtml() {
  const g = EVIDENCE && EVIDENCE.gait;
  const f = g && Array.isArray(g.features) && g.features.find((x) => x.key === 'cv_pct');
  if (EVIDENCE == null) return 'Does stride-time variability differ in ALS? The team\'s check on a public gait dataset: <span class="pending">pending</span>.';
  const vc = f && f.alsVsControl;
  if (!f || !f.medians || !vc || !Array.isArray(vc.ci)) return 'Does stride-time variability differ in ALS? See the team\'s check on a public gait dataset on the <a href="method.html">Method &amp; validation</a> page.';
  const pk = f.alsVsParkinsons;
  return `<strong>Real-data check</strong> (${esc(g.source)}): median stride-time variability ${esc(f.medians.als)}% in ${esc(vc.nAls)} people with ALS vs ${esc(f.medians.control)}% in ${esc(vc.nOther)} controls. AUC ${vc.auc.toFixed(2)} (95% CI ${vc.ci[0].toFixed(2)} to ${vc.ci[1].toFixed(2)}): pick one person from each group at random, and the person with ALS has the higher value about ${Math.round(vc.auc * 100)}% of the time (somewhere between ${Math.round(vc.ci[0] * 100)}% and ${Math.round(vc.ci[1] * 100)}%).`
    + (pk && Number.isFinite(pk.auc) ? ` Against Parkinson's it was ${pk.auc.toFixed(2)}${Array.isArray(pk.ci) ? ` (95% CI ${pk.ci[0].toFixed(2)} to ${pk.ci[1].toFixed(2)})` : ''}, close to a coin toss, so this test tracks change in one person; it does not diagnose.` : '')
    + (Number.isFinite(f.mdc95) ? ` Normal variation in the same data: ±${f.mdc95.toFixed(2)} percentage points (two halves of one walk, so it understates week-to-week noise).` : '')
    + ' Limits are on the <a href="method.html">Method &amp; validation</a> page.';
}

let teardown = null;

// Wire the home tests to markup already inside `root`. Returns { destroy, refresh }.
// Calling it again (for example when the app view mounts a second time) first tears
// down the previous run: timers, animation frames and window/document listeners.
export function initHomeTests(root = document, { skin: skinName = 'page', onChange = null } = {}) {
  if (teardown) teardown();
  ROOT = root;
  SKIN = SKINS[skinName] ? skinName : 'page';
  onChangeCb = onChange;
  calib = null;
  deleteArmed = null;
  Object.assign(tap, { state: 'idle', test: 'tap_right', times: [], t0: 0, timers: [], raf: 0 });
  tap.active.clear();
  Object.assign(rd, { state: 'idle', t0: 0, raf: 0 });
  const ac = new AbortController();
  const on = (target, type, fn) => { if (target) target.addEventListener(type, fn, { signal: ac.signal }); };

  renderStatic();
  const p = $('person');
  p.value = lsGet(KEYS.person) || '';
  on(p, 'input', () => { lsSet(KEYS.person, p.value); renderTrend(); notify(); });

  $$('#hand-seg button').forEach((b) => on(b, 'click', () => setHand(b.dataset.test)));
  on($('tap-start'), 'click', tapStart);
  on($('tap-cancel'), 'click', tapCancel);
  const pad = $('tap-pad');
  on(pad, 'pointerdown', (e) => {
    if (tap.state === 'countdown' || tap.state === 'running') e.preventDefault();
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    tap.active.add(e.pointerId);
    if (tap.active.size > 1) return; // one finger at a time: a second finger down does not count
    recordTap();
  });
  for (const type of ['pointerup', 'pointercancel']) on(window, type, (e) => tap.active.delete(e.pointerId));
  on(pad, 'contextmenu', (e) => { if (tap.state !== 'idle' && tap.state !== 'done') e.preventDefault(); });
  on(document, 'keydown', (e) => {
    if (e.code !== 'Space' && e.key !== ' ') return;
    if (tap.state !== 'countdown' && tap.state !== 'running') return;
    e.preventDefault();
    if (!e.repeat) recordTap();
  });

  on($('read-start'), 'click', readStart);
  on($('read-stop'), 'click', readStop);
  on($('weight-save'), 'click', weightSave);
  on($('weight-input'), 'keydown', (e) => { if (e.key === 'Enter') weightSave(); });
  on($('calib-start'), 'click', calibStart);
  on($('calib-test'), 'change', renderCalibration);
  on($('csv-btn'), 'click', downloadCsv);
  on($('csv-copy-btn'), 'click', copyCsv);
  on($('delete-btn'), 'click', deleteAll);
  // another tab (for example the doctor dashboard) changed shared state
  on(window, 'storage', (e) => { if (e.key === KEYS.results || e.key === KEYS.mdc) renderAll(); });

  setHand('tap_right');
  tapUi('idle');
  renderAll();

  const destroy = () => {
    if (teardown !== destroy) return;
    clearTapTimers();
    cancelAnimationFrame(rd.raf);
    if (deleteArmed) clearTimeout(deleteArmed);
    deleteArmed = null;
    calib = null;
    tap.state = 'idle';
    rd.state = 'idle';
    ac.abort();
    onChangeCb = null;
    ROOT = null;
    SKIN = 'page';
    teardown = null;
  };
  teardown = destroy;
  return { destroy, refresh: renderAll };
}

// Self-start only on the old stand-alone page (app/hometests.html); the app view calls initHomeTests.
if (typeof document !== 'undefined' && document.querySelector('[data-hometests-page]') && document.getElementById('tap-pad')) initHomeTests(document);
