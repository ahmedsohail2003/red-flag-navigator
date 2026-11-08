// Tests for motion/web/flag.js (contract sections 6 and 7), using the real engine's
// detectDecline. Run: node --test "motion/tests/*.test.mjs" from the project folder.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GAIT_TEST_ID, GAIT_TEST, GAIT_MDC, ensureGaitTest, makeRow, gaitSeries, gaitFlag, flagText, saveBlocker, localDate,
} from '../web/flag.js';
import { HOME_TESTS, detectDecline } from '../../app/js/engine.js';
import { synthWalk } from '../web/synth.js';
import { Worker } from 'node:worker_threads';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TODAY = '2026-11-08';
const walk = (over = {}, resultOver = {}) => ({
  v: 1, kind: 'rfn-walk', id: 'w-20261108T071203-a1b2', createdAt: '2026-11-08T12:12:03.120Z',
  distance_m: 10, placement: 'waist',
  result: {
    version: 'gait-1', ok: true, speed_mps: 1.24, duration_s: 8.06, timing: 'motion', steps: 14,
    cadence_spm: 104.2, stepLength_m: 0.71, distance_m: 10, quality: 'good', issues: [], ...resultOver,
  },
  ...over,
});
const row = (date, value, extra = {}) => ({ date, time: '09:00', test: GAIT_TEST_ID, value, trial: 1, person: '', calibration: false, source: 'phone-motion', ...extra });
const weeks = (values, start = '2026-10-04') => values.map((value, i) => {
  const d = new Date(Date.parse(`${start}T00:00:00Z`) + i * 7 * 86400000).toISOString().slice(0, 10);
  return { date: d, value, n: 1, demo: false };
});

test('constants match the contract', () => {
  assert.equal(GAIT_TEST_ID, 'gait_speed');
  assert.deepEqual(GAIT_TEST, { label: 'Walking speed, 10 m walk (phone motion sensors)', unit: 'm/s', region: 'leg', higherIsBetter: true, placeholderMdc: 0.28 });
  assert.equal(GAIT_MDC.prediagnosis, 0.28);
  assert.equal(GAIT_MDC.diagnosed, 0.18);
  assert.match(GAIT_MDC.source, /WatchALS/);
  // G6: the on-screen source keeps the two caveats (belt placement, approximate values).
  assert.match(GAIT_MDC.source, /phone on a lower-back belt/);
  assert.match(GAIT_MDC.source, /approximate/);
});

test('ensureGaitTest adds the test once', () => {
  const tests = { walk: { label: 'old walk' } };
  assert.equal(ensureGaitTest(tests), true);
  assert.deepEqual(tests.gait_speed, GAIT_TEST);
  assert.notEqual(tests.gait_speed, GAIT_TEST, 'adds a copy, so later edits cannot change GAIT_TEST');
  const first = tests.gait_speed;
  assert.equal(ensureGaitTest(tests), false);
  assert.equal(tests.gait_speed, first);
  assert.deepEqual(tests.walk, { label: 'old walk' }, 'other tests untouched');
});

test('ensureGaitTest never overwrites an existing entry', () => {
  const mine = { label: 'App walking speed', unit: 'm/s', region: 'leg', higherIsBetter: true, placeholderMdc: 0.2 };
  const tests = { gait_speed: mine };
  assert.equal(ensureGaitTest(tests), false);
  assert.equal(tests.gait_speed, mine);
  assert.equal(tests.gait_speed.placeholderMdc, 0.2);
  assert.equal(ensureGaitTest(null), false);
  assert.equal(ensureGaitTest(undefined), false);
  assert.equal(ensureGaitTest(Object.freeze({})), false, 'a frozen list is left alone without throwing');
});

test('ensureGaitTest on the real engine HOME_TESTS (true before the merge, false after)', () => {
  const walkBefore = HOME_TESTS.walk;
  const had = Object.prototype.hasOwnProperty.call(HOME_TESTS, GAIT_TEST_ID);
  assert.equal(ensureGaitTest(HOME_TESTS), !had);
  assert.equal(HOME_TESTS.gait_speed.region, 'leg');
  assert.equal(HOME_TESTS.gait_speed.higherIsBetter, true);
  assert.equal(ensureGaitTest(HOME_TESTS), false);
  assert.equal(HOME_TESTS.walk, walkBefore);
});

test('makeRow gives the section 6 row', () => {
  const r = makeRow(walk(), { date: TODAY, time: '07:12', person: '', results: [], today: TODAY });
  assert.deepEqual(r, {
    date: TODAY, time: '07:12', test: 'gait_speed', value: 1.24, trial: 1, person: '',
    calibration: false, source: 'phone-motion', walkId: 'w-20261108T071203-a1b2', timing: 'motion',
    steps: 14, cadence: 104.2, distance_m: 10, quality: 'good',
  });
  assert.equal('demoDate' in r, false, 'no demoDate on today');
  assert.equal('simulated' in r, false);
});

test('makeRow: demoDate only when the date is not today', () => {
  const r = makeRow(walk(), { date: '2026-11-15', time: '07:12', results: [], today: TODAY });
  assert.equal(r.demoDate, true);
  assert.equal(r.date, '2026-11-15');
  const t = makeRow(walk(), { date: TODAY, results: [], today: TODAY });
  assert.equal('demoDate' in t, false);
  const real = localDate();
  const d = makeRow(walk(), { results: [] }); // no date and no today: both default to the local date now
  assert.equal(d.date, real);
  assert.equal('demoDate' in d, false);
  assert.match(d.time, /^\d{2}:\d{2}$/);
});

test('makeRow: trial numbering per person and date', () => {
  const results = [
    row(TODAY, 1.2, { person: 'Alex' }),
    row(TODAY, 1.3, { person: 'Alex', trial: 2 }),
    row(TODAY, 1.1, { person: 'Sam' }),               // other person
    row('2026-11-01', 1.2, { person: 'Alex' }),      // other date
    row(TODAY, 40, { person: 'Alex', test: 'tap_right' }), // other test
    row(TODAY, 1.25, { person: 'Alex', calibration: true }), // calibration rows are not weekly runs
  ];
  assert.equal(makeRow(walk(), { date: TODAY, person: 'Alex', results, today: TODAY }).trial, 3);
  assert.equal(makeRow(walk(), { date: TODAY, person: '  Alex ', results, today: TODAY }).person, 'Alex', 'person is trimmed');
  assert.equal(makeRow(walk(), { date: TODAY, person: 'Sam', results, today: TODAY }).trial, 2);
  assert.equal(makeRow(walk(), { date: TODAY, person: '', results, today: TODAY }).trial, 1);
  assert.equal(makeRow(walk(), { date: '2026-11-01', person: 'Alex', results, today: TODAY }).trial, 2);
  const noName = [row(TODAY, 1.2, { person: undefined })];
  assert.equal(makeRow(walk(), { date: TODAY, person: '', results: noName, today: TODAY }).trial, 2, 'a missing person counts as ""');
});

test('makeRow: source, simulated and a bare WalkResult', () => {
  assert.equal(makeRow(walk({ source: 'file' }), { date: TODAY, today: TODAY }).source, 'file');
  assert.equal(makeRow(walk({ simulated: true }), { date: TODAY, today: TODAY }).simulated, true);
  assert.equal(makeRow(walk({ recording: { simulated: true } }), { date: TODAY, today: TODAY }).simulated, true);
  const bare = makeRow(walk().result, { date: TODAY, today: TODAY });
  assert.equal(bare.value, 1.24);
  assert.equal(bare.walkId, null);
  assert.equal(makeRow(walk({}, { speed_mps: 1.23456 }), { date: TODAY, today: TODAY }).value, 1.23, 'value rounded to 2 decimals');
});

test('makeRow refuses ok false or poor walks by returning null', () => {
  const opts = { date: TODAY, time: '07:12', results: [], today: TODAY };
  assert.equal(makeRow(walk({}, { ok: false, speed_mps: null, quality: 'poor' }), opts), null);
  assert.equal(makeRow(walk({}, { ok: false, speed_mps: 1.2, quality: 'fair' }), opts), null);
  assert.equal(makeRow(walk({}, { quality: 'poor' }), opts), null);
  assert.equal(makeRow(walk({}, { speed_mps: null }), opts), null);
  assert.equal(makeRow(null, opts), null);
  assert.equal(makeRow({}, opts), null);
  assert.ok(makeRow(walk({}, { quality: 'fair' }), opts), 'fair walks can be saved');
  assert.match(saveBlocker(walk({}, { ok: false })), /no speed/);
  assert.match(saveBlocker(walk({}, { quality: 'poor' })), /poor/);
  assert.equal(saveBlocker(walk()), null);
});

test('saveBlocker refuses speeds outside 0.15 to 2.5 m/s, as gait.js does (review F2)', () => {
  // A hand-made POST can claim any speed; the laptop now applies the same range as gait.js.
  assert.match(saveBlocker(walk({}, { speed_mps: 9.99 })), /outside normal walking/);
  assert.match(saveBlocker(walk({}, { speed_mps: 0.10 })), /outside normal walking/);
  assert.match(saveBlocker(walk({}, { speed_mps: 2.51 })), /outside normal walking/);
  assert.equal(saveBlocker(walk({}, { speed_mps: 0.15 })), null, 'the range ends are allowed, as in gait.js');
  assert.equal(saveBlocker(walk({}, { speed_mps: 2.5 })), null);
  assert.equal(saveBlocker(walk({}, { speed_mps: 1.24 })), null);
  const opts = { date: TODAY, time: '07:12', results: [], today: TODAY };
  assert.equal(makeRow(walk({}, { speed_mps: 9.99 }), opts), null, 'makeRow refuses it too');
});

test('gaitSeries: same-day mean, person filter, calibration and other tests left out', () => {
  const results = [
    row('2026-10-11', 1.4),
    row('2026-10-04', 1.2),
    row('2026-10-04', 1.4, { trial: 2 }),
    row('2026-10-04', 0.5, { calibration: true }),
    row('2026-10-04', 0.9, { person: 'Sam' }),
    { date: '2026-10-04', test: 'tap_right', value: 55, person: '' },
    { date: '2026-10-04', test: 'walk', value: 3.1, person: '' },
    row('2026-10-18', 1.1, { demoDate: true }),
    row('2026-10-18', 1.3, { trial: 2 }),
    row('2026-10-25', 'fast'),
    null,
  ];
  const s = gaitSeries(results, '');
  assert.deepEqual(s.map((p) => p.date), ['2026-10-04', '2026-10-11', '2026-10-18']);
  assert.ok(Math.abs(s[0].value - 1.3) < 1e-9);
  assert.equal(s[0].n, 2);
  assert.equal(s[0].demo, false);
  assert.equal(s[1].value, 1.4);
  assert.equal(s[2].demo, true, 'a day with a demo-date row is marked');
  assert.ok(Math.abs(s[2].value - 1.2) < 1e-9);
  const sam = gaitSeries(results, 'Sam');
  // sim added by review F5: each weekly point now also says whether a simulated walk is in it.
  assert.deepEqual(sam, [{ date: '2026-10-04', value: 0.9, n: 1, demo: false, sim: false }]);
  assert.deepEqual(gaitSeries(results, 'Nobody'), []);
  assert.deepEqual(gaitSeries(null, ''), []);
  assert.equal(gaitSeries([row('2026-10-04', 1.2, { person: undefined })]).length, 1, 'no person matches ""');
});

test('gaitSeries marks a day with a simulated row (review F5)', () => {
  const s = gaitSeries([
    row('2026-10-04', 1.3),
    row('2026-10-11', 1.2, { simulated: true }),
    row('2026-10-11', 1.4, { trial: 2 }),
    row('2026-10-18', 1.1, { simulated: 'yes' }), // only a real true counts
  ], '');
  assert.deepEqual(s.map((p) => p.sim), [false, true, false]);
  assert.deepEqual(s.map((p) => p.demo), [false, false, false]);
  const fromRow = makeRow(walk({ simulated: true }), { date: TODAY, today: TODAY });
  assert.equal(gaitSeries([fromRow], '')[0].sim, true, 'a row saved from a simulated walk is marked');
});

test('gaitFlag flags two consecutive weeks each beyond MDC 0.28', () => {
  const f = gaitFlag(weeks([1.30, 1.30, 0.98, 0.97]), { mdc: GAIT_MDC.prediagnosis, detectDecline });
  assert.equal(f.flagged, true);
  assert.ok(f.decline);
  assert.equal(f.decline.date, '2026-10-25');
  assert.ok(Math.abs(f.baseline - 1.30) < 1e-9);
  assert.equal(f.latest, 0.97);
  assert.equal(f.mdc, 0.28);
  assert.equal(f.pointsNeeded, 0);
});

test('gaitFlag does not flag a single low week', () => {
  for (const vals of [[1.30, 1.30, 0.90, 1.28], [1.30, 1.30, 1.28, 0.90], [1.30, 1.30, 0.90, 1.25, 0.90]]) {
    const f = gaitFlag(weeks(vals), { mdc: 0.28, detectDecline });
    assert.equal(f.flagged, false, vals.join(','));
    assert.equal(f.decline, null);
  }
});

test('gaitFlag does not flag drops within the MDC, but the diagnosed MDC 0.18 does', () => {
  const vals = weeks([1.30, 1.30, 1.06, 1.05]); // drops 0.24 and 0.25
  assert.equal(gaitFlag(vals, { mdc: GAIT_MDC.prediagnosis, detectDecline }).flagged, false);
  assert.equal(gaitFlag(vals, { mdc: GAIT_MDC.diagnosed, detectDecline }).flagged, true);
  assert.equal(gaitFlag(vals, { detectDecline }).mdc, 0.28, 'default MDC is the pre-diagnosis one');
});

test('gaitFlag: pointsNeeded when there are fewer than 4 weeks', () => {
  assert.equal(gaitFlag([], { detectDecline }).pointsNeeded, 4);
  const f = gaitFlag(weeks([1.3, 1.3, 0.5]), { mdc: 0.28, detectDecline });
  assert.equal(f.pointsNeeded, 1);
  assert.equal(f.flagged, false);
  assert.ok(Math.abs(f.baseline - 1.3) < 1e-9);
  assert.equal(f.latest, 0.5);
  assert.equal(gaitFlag(weeks([1.3]), { detectDecline }).baseline, null);
  assert.throws(() => gaitFlag(weeks([1.3]), { mdc: 0.28 }), TypeError);
});

test('flagText for each state', () => {
  assert.equal(flagText(gaitFlag([], { detectDecline })), 'Not enough weeks yet (need 4 more)');
  assert.equal(flagText(gaitFlag(weeks([1.3, 1.3]), { detectDecline })), 'Not enough weeks yet (need 2 more)');
  assert.equal(flagText(gaitFlag(weeks([1.3, 1.28, 1.31, 1.29]), { detectDecline })), 'No drop beyond normal variation');
  assert.equal(
    flagText(gaitFlag(weeks([1.30, 1.30, 0.98, 0.97]), { mdc: 0.28, detectDecline })),
    'FLAG: walking speed fell more than normal variation two weeks in a row (baseline 1.30 m/s, latest 0.97 m/s, normal variation ±0.28 m/s)',
  );
  assert.equal(flagText(null), 'No walking results yet.');
});

test('saved rows flow through gaitSeries into a flag', () => {
  const results = [];
  const dates = ['2026-10-11', '2026-10-18', '2026-10-25', '2026-11-01'];
  const speeds = [[1.31, 1.29], [1.30], [0.95, 0.97], [0.92]];
  dates.forEach((date, i) => speeds[i].forEach((s, k) => {
    const r = makeRow(walk({ id: `w-test-${i}-${k}` }, { speed_mps: s }), { date, time: '08:00', person: 'Alex', results, today: TODAY });
    results.push(r);
  }));
  assert.equal(results[1].trial, 2);
  assert.ok(results.every((r) => r.demoDate === true));
  const s = gaitSeries(results, 'Alex');
  assert.equal(s.length, 4);
  assert.ok(s.every((p) => p.demo));
  const f = gaitFlag(s, { mdc: 0.28, detectDecline });
  assert.equal(f.flagged, true);
  assert.match(flagText(f), /^FLAG: /);
});

// ---------- the laptop page itself (motion/web/receive.js), run in a worker with a fake DOM ----------
// Added by the review. Each run is a fresh worker with its own globals; a hang (as the chart
// loop did with a stored 1e9 m/s) comes back as { timeout: true } instead of stalling the suite.
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PAGE_WORKER = `
import { parentPort, workerData } from 'node:worker_threads';
const { src, scenario } = workerData;
const errors = [];
console.error = () => {};
process.on('unhandledRejection', (e) => errors.push(String((e && e.stack) || e)));
// A settable clock (scenario.now, then step.now, both epoch ms), so a test can cross midnight.
const RealDate = Date;
let fakeNow = Number.isFinite(scenario.now) ? scenario.now : null;
if (fakeNow != null) {
  globalThis.Date = class extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(fakeNow); }
    static now() { return fakeNow; }
  };
}
const startValues = scenario.values || {};
const els = new Map();
function el(id) {
  if (!els.has(id)) {
    const L = {};
    els.set(id, { id, hidden: false, textContent: '', innerHTML: '', value: id in startValues ? startValues[id] : '', checked: false, disabled: false, dataset: {}, files: [],
      addEventListener(t, f) { (L[t] = L[t] || []).push(f); },
      fire(t) { for (const f of L[t] || []) f({ target: this }); } });
  }
  return els.get(id);
}
const docL = {};
globalThis.document = { getElementById: el, addEventListener(t, f) { (docL[t] = docL[t] || []).push(f); }, activeElement: null };
globalThis.window = { addEventListener() {} };
const store = new Map(Object.entries(scenario.storage || {}));
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)); }, removeItem: (k) => { store.delete(k); } };
globalThis.fetch = async (url) => {
  const body = url.startsWith('/api/info') ? { phoneUrls: ['https://192.168.1.5:8453/motion/walk.html'], laptopUrl: 'http://localhost:8090/motion/receive.html', httpPort: 8090, httpsPort: 8453 }
    : url.startsWith('/api/walks') ? { walks: scenario.walks || [] } : null;
  return { ok: !!body, status: body ? 200 : 404, json: async () => body };
};
const sources = [];
globalThis.EventSource = class { constructor(u) { this.url = u; this.readyState = 1; this.L = {}; sources.push(this); }
  addEventListener(t, f) { (this.L[t] = this.L[t] || []).push(f); } close() { this.readyState = 2; }
  emit(t, data) { for (const f of this.L[t] || []) f({ data: JSON.stringify(data) }); } };
const tick = () => new Promise((r) => setTimeout(r, 20));
const guard = (f) => { try { f(); } catch (e) { errors.push(String((e && e.stack) || e)); } };
await import('data:text/javascript,' + encodeURIComponent(src));
await tick();
for (const s of scenario.steps || []) {
  if ('now' in s) fakeNow = s.now;
  if (s.sse) guard(() => sources[0].emit('walk', s.sse));
  if (s.save) guard(() => { for (const f of docL.click || []) f({ target: { closest: () => ({ disabled: false, dataset: { save: s.save, src: s.src || 'phone' } }) } }); });
  if ('person' in s) guard(() => { el('person').value = s.person; el('person').fire('input'); });
  if (s.set) guard(() => { for (const [k, v] of Object.entries(s.set)) { el(k).value = v; el(k).fire('change'); } });
  if (s.files) guard(() => { el('files').files = s.files.map((f) => ({ name: f.name, text: async () => f.text })); el('files').fire('change'); });
  if (s.remove) guard(() => el('remove-btn').fire('click'));
  await tick();
  if (s.wait) await new Promise((r) => setTimeout(r, s.wait));
}
const snap = {};
for (const [k, v] of els) snap[k] = { hidden: v.hidden, textContent: v.textContent, innerHTML: v.innerHTML, disabled: v.disabled, value: v.value };
parentPort.postMessage({ errors, els: snap, store: Object.fromEntries(store) });
`;
// modules: also load the real gait.js and recording.js, so file import works (off by default,
// as before, so the other page tests do not depend on the analysis code).
function pageSource(modules = false) {
  const file = (p) => pathToFileURL(ROOT + p).href;
  let s = readFileSync(ROOT + 'motion/web/receive.js', 'utf8')
    .replace("from '/js/engine.js'", `from '${file('app/js/engine.js')}'`)
    .replace("from './flag.js'", `from '${file('motion/web/flag.js')}'`);
  if (modules) {
    s = s.replace("import('./gait.js')", `import('${file('motion/web/gait.js')}')`)
      .replace("import('./recording.js')", `import('${file('motion/web/recording.js')}')`);
  }
  return s;
}
function runPage(scenario, ms = 5000) {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('data:text/javascript,' + encodeURIComponent(PAGE_WORKER)), { workerData: { src: pageSource(!!scenario.modules), scenario } });
    const t = setTimeout(() => { w.terminate(); resolve({ timeout: true }); }, ms);
    w.once('message', (m) => { clearTimeout(t); w.terminate(); resolve(m); });
    w.once('error', (e) => { clearTimeout(t); reject(e); });
  });
}
const serverWalk = (id, over = {}, resultOver = {}) => walk({ id, receivedAt: '2026-11-08T12:12:04.000Z', hasRecording: false, ...over }, resultOver);
const savedRows = (r) => JSON.parse(r.store['rfn.homeResults'] || '[]');

test('page: saving a phone walk writes one section 6 row and marks the walk saved', async () => {
  const r = await runPage({ walks: [serverWalk('w-good-0001')], steps: [{ save: 'w-good-0001' }, { save: 'w-good-0001' }] });
  assert.equal(r.timeout, undefined);
  assert.deepEqual(r.errors, []);
  const rows = savedRows(r);
  assert.equal(rows.length, 1, 'a second click does not save the same walk twice');
  assert.equal(rows[0].test, 'gait_speed');
  assert.equal(rows[0].walkId, 'w-good-0001');
  assert.equal(rows[0].value, 1.24);
  assert.match(r.els['walk-list'].innerHTML, /<strong>Saved<\/strong>/);
  assert.match(r.els.chart.innerHTML, /<svg/);
  assert.match(r.els['flag-box'].innerHTML, /Not enough weeks yet \(need 3 more\)/);
});

test('page: a damaged walk from the server never blanks the walk list (review fix)', async () => {
  // Any LAN client can POST these: the server checks only id, kind, distance_m and that result is an object.
  const r = await runPage({
    walks: [serverWalk('w-good-0001'), serverWalk('w-bad-0004', { placement: { toString: 1 }, createdAt: { toString: 1 } })],
    steps: [
      { sse: serverWalk('w-bad-0002', {}, { issues: [null, 7, { level: 'warn', message: { toString: 1 } }] }) },
      { sse: serverWalk('w-good-0003') },
      { save: 'w-good-0003' },
    ],
  });
  assert.deepEqual(r.errors, []);
  assert.match(r.els['walk-list'].innerHTML, /w-good-0001/);
  assert.match(r.els['walk-list'].innerHTML, /<strong>Saved<\/strong>/, 'a walk that arrived after the damaged one still shows and saves');
  assert.equal(savedRows(r).length, 1);
  assert.match(r.els.chart.innerHTML, /<svg/, 'renderAll still reaches the chart');
});

test('page: inherited keys such as "constructor" never reach the screen (review fix)', async () => {
  const r = await runPage({ walks: [serverWalk('w-good-0001', { placement: 'constructor' }, { quality: 'constructor', timing: 'toString', issues: [{ level: '__proto__', message: 'x' }] })] });
  assert.deepEqual(r.errors, []);
  assert.doesNotMatch(r.els['walk-list'].innerHTML, /native code|\[object Object\]/);
  assert.match(r.els['walk-list'].innerHTML, /Quality: not known/);
});

test('page: an absurd stored speed cannot hang the chart (review fix)', async () => {
  const rows = [row('2026-10-11', 1.3), row('2026-10-18', 1.3), row('2026-10-25', 1e9), row('2026-11-01', 124)];
  const r = await runPage({ storage: { 'rfn.homeResults': JSON.stringify(rows) } });
  assert.equal(r.timeout, undefined, 'the page finished drawing');
  assert.deepEqual(r.errors, []);
  const grid = (r.els.chart.innerHTML.match(/class="c-grid"/g) || []).length;
  assert.ok(grid >= 2 && grid <= 51, `gridlines: ${grid}`);
  const normal = await runPage({ storage: { 'rfn.homeResults': JSON.stringify([row('2026-10-11', 1.3), row('2026-10-18', 1.28)]) } });
  assert.ok((normal.els.chart.innerHTML.match(/class="c-grid"/g) || []).length >= 4, 'real speeds keep the fine 0.1 m/s grid');
});

test('page: changing the name disarms a pending remove (review fix)', async () => {
  const rows = [row('2026-10-11', 1.3), row('2026-10-11', 1.2, { person: 'Sam' }), row('2026-10-11', 40, { test: 'tap_right' })];
  const r = await runPage({ storage: { 'rfn.homeResults': JSON.stringify(rows) }, steps: [{ remove: true }, { person: 'Sam' }, { remove: true }] });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(savedRows(r).map((x) => `${x.test}:${x.person}`), ['gait_speed:', 'gait_speed:Sam', 'tap_right:'], 'one click after the name change removes nothing');
  const done = await runPage({ storage: { 'rfn.homeResults': JSON.stringify(rows) }, steps: [{ person: 'Sam' }, { remove: true }, { remove: true }] });
  assert.deepEqual(savedRows(done).map((x) => `${x.test}:${x.person}`), ['gait_speed:', 'tap_right:'], 'two clicks remove only the walking rows for Sam');
});

// ---------- final-review fixes on the laptop page ----------
const localMs = (d, h, m) => new Date(2026, 10, d, h, m).getTime(); // 2026-11-<d> at h:m, local time
const speedOn = (html) => { const m = /<span class="speed-num">([\d.]+)<\/span>/.exec(html); return m ? Number(m[1]) : NaN; };

test('page: the phone address says to type it in full, starting with https:// (review F3)', async () => {
  const r = await runPage({});
  assert.deepEqual(r.errors, []);
  const html = r.els['phone-urls'].innerHTML;
  assert.match(html, /type the whole address[^<]*Start with https:\/\//);
  assert.match(html, /<p class="url">https:\/\/192\.168\.1\.5:8453\/motion\/walk\.html<\/p>/, 'the address itself still shows');
});

test('page: importing a phone .json uses the distance stored in the file (review INT-3)', async () => {
  const rec = synthWalk({ distance_m: 8, seed: 3 });
  const truth = rec.truth.speed_mps;
  const file = { name: 'walk-8m.json', text: JSON.stringify(rec) };
  const r = await runPage({ modules: true, values: { distance: '10' }, steps: [{ files: [file], wait: 600 }] });
  assert.equal(r.timeout, undefined);
  assert.deepEqual(r.errors, []);
  assert.equal(r.els.distance.value, '8', 'the box is filled from the file');
  assert.match(r.els['import-msg'].textContent, /, 8 m walked \(from the file\)\.$/);
  const v = speedOn(r.els['import-list'].innerHTML);
  assert.ok(Math.abs(v - truth) < 0.1, `speed ${v} vs truth ${truth.toFixed(2)} (10 m would give ${(truth * 10 / 8).toFixed(2)})`);
  // The doctor can still change the box afterwards: 9 m is then used, and the file's 8 m is not forced back.
  const r2 = await runPage({ modules: true, values: { distance: '10' }, steps: [{ files: [file], wait: 600 }, { set: { distance: '9' } }] });
  assert.deepEqual(r2.errors, []);
  assert.equal(r2.els.distance.value, '9');
  assert.match(r2.els['import-msg'].textContent, /, 9 m walked\.$/);
  assert.ok(Math.abs(speedOn(r2.els['import-list'].innerHTML) - truth * 9 / 8) < 0.12);
  // A file with no distance keeps the box value (as a CSV does).
  const r3 = await runPage({ modules: true, values: { distance: '10' }, steps: [{ files: [{ name: 'nodist.json', text: JSON.stringify({ ...rec, distance_m: null }) }], wait: 600 }] });
  assert.equal(r3.els.distance.value, '10');
  assert.match(r3.els['import-msg'].textContent, /, 10 m walked\.$/);
});

test('page: a page left open across midnight saves under the new day (review INT-6)', async () => {
  const w = serverWalk('w-night-0001', { createdAt: new Date(2026, 10, 9, 0, 19).toISOString(), receivedAt: new Date(2026, 10, 9, 0, 19, 30).toISOString() });
  const r = await runPage({ now: localMs(8, 23, 50), steps: [{ now: localMs(9, 0, 20), sse: w }, { save: 'w-night-0001' }] });
  assert.deepEqual(r.errors, []);
  const rows = savedRows(r);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].date, '2026-11-09', 'saved under the new day');
  assert.equal('demoDate' in rows[0], false, 'not labelled a demo date');
  assert.equal(r.els['save-date'].value, '2026-11-09');
  assert.equal(r.els['demo-label'].hidden, true);
  // A demo date picked on purpose stays put across midnight.
  const kept = await runPage({ now: localMs(8, 23, 50), steps: [{ set: { 'save-date': '2026-11-01' } }, { now: localMs(9, 0, 20), sse: w }, { save: 'w-night-0001' }] });
  assert.deepEqual(kept.errors, []);
  assert.equal(savedRows(kept)[0].date, '2026-11-01');
  assert.equal(savedRows(kept)[0].demoDate, true);
  // Yesterday picked on purpose after midnight is a demo date, not the old day to roll forward.
  const yday = await runPage({ now: localMs(8, 23, 50), steps: [{ now: localMs(9, 0, 20), set: { 'save-date': '2026-11-08' } }, { sse: w }, { save: 'w-night-0001' }] });
  assert.deepEqual(yday.errors, []);
  assert.equal(savedRows(yday)[0].date, '2026-11-08');
  assert.equal(savedRows(yday)[0].demoDate, true);
});

test('page: simulated walks and rows are labelled on the card, chart, table and flag (review F5)', async () => {
  const rows = [row('2026-10-11', 1.3), row('2026-10-18', 1.3, { simulated: true }), row('2026-10-25', 1.2, { simulated: true, demoDate: true })];
  // The server summary carries a top-level simulated: true (server fix for F5).
  const r = await runPage({ storage: { 'rfn.homeResults': JSON.stringify(rows) }, walks: [serverWalk('w-simwalk-01', { simulated: true })], steps: [{ save: 'w-simwalk-01' }] });
  assert.deepEqual(r.errors, []);
  const saved = savedRows(r);
  assert.equal(saved.length, 4);
  assert.equal(saved[3].simulated, true, 'the summary\'s simulated flag reaches the saved row');
  const list = r.els['walk-list'].innerHTML;
  assert.match(list, /Simulated walk/);
  assert.match(list, /<strong>Saved<\/strong>[^<]*\(simulated\)/);
  const chart = r.els.chart.innerHTML;
  assert.match(chart, /<td>simulated<\/td>/);
  assert.match(chart, /<td>demo date, simulated<\/td>/);
  assert.match(chart, /, simulated<\/title>/);
  assert.match(chart, /class="c-demo-t"[^>]*>simulated</);
  assert.match(r.els['flag-box'].innerHTML, /simulated walks, not real ones/);
  // With no simulated rows, none of these words appear.
  const real = await runPage({ storage: { 'rfn.homeResults': JSON.stringify([row('2026-10-11', 1.3), row('2026-10-18', 1.3)]) } });
  assert.doesNotMatch(real.els.chart.innerHTML + real.els['flag-box'].innerHTML, /simulated/i);
});

test('page: a demo date says how the app shows demo dates before and after the patch (review INT-2, F1)', async () => {
  const r = await runPage({ now: localMs(8, 9, 0), steps: [{ set: { 'save-date': '2026-10-18' } }] });
  assert.deepEqual(r.errors, []);
  assert.equal(r.els['demo-label'].hidden, false);
  assert.equal(r.els['demo-note'].hidden, false);
  // Changed 04:05 with the note: the merge patch now marks demo dates in the app, so the old
  // "does not mark" sentence would be false once the patch is applied.
  assert.match(r.els['demo-note'].textContent, /Until the app patch .* is applied, the app's Monitoring view shows these walks as real\. After it, they show as "Demo dates"/);
  assert.match(r.els['demo-note'].textContent, /"Demo \(dates moved\)"/);
  const plain = await runPage({ now: localMs(8, 9, 0) });
  assert.equal(plain.els['demo-label'].hidden, true);
  assert.equal(plain.els['demo-note'].hidden, true, 'no note on today');
});
