// Tests for app/js/home/demo.js: simulated home data for Alex Chen only.
// Run: node --test tests/home-demo.test.mjs
// Declines are judged the way summary.js judges them: series.assessDecline with the
// catalogue's MDC, direction and practice weeks, a 2-week baseline and 2 weeks in a row;
// tests use the weekly mean of their results, signals their catalogue weekly rule, and
// grip one row per hand with its MDC as a share of the baseline. The last test runs the
// demo through summary.js itself, as the Home plan view does.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { demoSamples, demoResults, DEMO_NOISE } from '../app/js/home/demo.js';
import * as catalog from '../app/js/home/catalog.js';
import { TESTS, SIGNALS } from '../app/js/home/catalog.js';
import { toWeekly, baseline, assessDecline, slopePerMonth } from '../app/js/home/series.js';
import { summarize } from '../app/js/home/summary.js';
import { addSamples, addResult, getResults, clearHomeData } from '../app/js/home/store.js';
import { ALEX } from '../app/js/alex.js';
import { BUILTIN } from '../app/js/cases.js';

const S = demoSamples('alex');
const R = demoResults('alex');
const K = 1.96 * Math.SQRT2;

// The ids written in the contract (plans/home-monitoring-contracts.md), read from the file
// so the test cannot drift from it.
const contract = readFileSync(new URL('../plans/home-monitoring-contracts.md', import.meta.url), 'utf8');
function idsBetween(from, to) {
  const a = contract.indexOf(from);
  const b = contract.indexOf(to, a);
  assert.ok(a >= 0 && b > a, `contract section "${from}" not found`);
  return [...contract.slice(a, b).matchAll(/`([a-z0-9_]+)` \(/g)].map((m) => m[1]);
}
const SIGNAL_IDS = idsBetween('Signal ids and units', '`start` and `end`');
const TEST_IDS = idsBetween('Test ids:', 'The existing tests');

// ---------- helpers ----------
const byTest = (id) => R.filter((r) => r.test === id);
const bySignal = (id) => S.filter((s) => s.signal === id);
const mean = (vs) => vs.reduce((a, b) => a + b, 0) / vs.length;
const median = (vs) => {
  const s = [...vs].sort((a, b) => a - b);
  const h = s.length >> 1;
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
};
const before = (asOf) => (x) => (x.date ?? x.start) <= asOf;

function weeklyTest(id, asOf = '9999-12-31') {
  const points = byTest(id).filter(before(asOf)).filter((r) => r.practice !== true).map((r) => ({ date: r.date, value: r.value }));
  return toWeekly(points, { reduce: 'mean', minPerWeek: 1 });
}
function assessTest(id, asOf) {
  return assessDecline(weeklyTest(id, asOf), { mdc: DEMO_NOISE[id].mdc, higherIsBetter: TESTS[id].higherIsBetter, practiceWeeks: TESTS[id].practiceWeeks });
}
function weeklySignal(id, field = 'value', asOf = '9999-12-31') {
  const points = bySignal(id).filter(before(asOf)).map((s) => ({ start: s.start, value: s[field] }));
  return toWeekly(points, SIGNALS[id].weekly);
}
function assessSignal(id, field = 'value', asOf) {
  const mdc = field === 'value2' ? DEMO_NOISE[id].mdc2 : DEMO_NOISE[id].mdc;
  return assessDecline(weeklySignal(id, field, asOf), { mdc, higherIsBetter: SIGNALS[id].higherIsBetter });
}
// Grip: one row per hand (detail.hand), and the MDC is a share of the baseline, as in
// summary.js. from restarts the baseline there (no practice week the second time).
function weeklyGrip(hand, { asOf = '9999-12-31', from = '0000-01-01' } = {}) {
  const points = byTest('grip').filter((r) => r.detail.hand === hand && r.date >= from && r.date <= asOf).map((r) => ({ date: r.date, value: r.value }));
  return toWeekly(points, { reduce: 'mean', minPerWeek: 1 });
}
function assessGrip(hand, opts = {}) {
  const practiceWeeks = opts.from ? 0 : TESTS.grip.practiceWeeks;
  const weekly = weeklyGrip(hand, opts);
  const base = baseline(weekly, { practiceWeeks });
  const mdc = (Math.abs(base.value) * DEMO_NOISE.grip.mdc) / 100;
  return assessDecline(weekly, { mdc, higherIsBetter: TESTS.grip.higherIsBetter, practiceWeeks });
}
const LEG_TESTS = ['timed_walk_speed', 'sts30', 'tug_time'];
const LEG_SIGNALS = ['walking_speed', 'step_length', 'double_support'];

// ---------- who gets data ----------
test('only Alex gets demo data: every other case, and no case, gets an empty list', () => {
  assert.ok(S.length > 1000 && R.length > 500, 'Alex has a full demo');
  const others = [...BUILTIN.map((c) => c.id).filter((id) => id !== 'alex'), undefined, null, '', 'ALEX', 'Alex Chen', 'alex ', 0, {}];
  assert.ok(others.length > 6, 'the built-in look-alike cases are included');
  for (const id of others) {
    assert.deepEqual(demoSamples(id), [], `samples for ${JSON.stringify(id)}`);
    assert.deepEqual(demoResults(id), [], `results for ${JSON.stringify(id)}`);
  }
});

test('everything is labelled simulated, from the demo, for Alex', () => {
  for (const s of S) {
    assert.equal(s.simulated, true);
    assert.equal(s.source, 'demo');
    assert.equal(s.person, 'alex');
  }
  for (const r of R) {
    assert.equal(r.simulated, true);
    assert.equal(r.detail.source, 'demo', 'the source is noted in detail');
    assert.equal(r.person, 'alex');
    assert.equal(r.practice, undefined, 'practice weeks come from the catalogue, not from flags');
  }
});

// ---------- the contract ----------
test('every signal and test id exists in the contract, with the catalogue unit', () => {
  assert.ok(SIGNAL_IDS.length >= 25 && SIGNAL_IDS.includes('walking_speed') && SIGNAL_IDS.includes('bp'), 'contract signal ids read');
  assert.ok(TEST_IDS.length >= 13 && TEST_IDS.includes('ddk_rate') && TEST_IDS.includes('falls_week'), 'contract test ids read');
  for (const s of S) {
    assert.ok(SIGNAL_IDS.includes(s.signal), `signal ${s.signal}`);
    assert.equal(s.unit, SIGNALS[s.signal].unit, `unit of ${s.signal}`);
  }
  for (const r of R) {
    assert.ok(TEST_IDS.includes(r.test), `test ${r.test}`);
    assert.equal(r.unit, TESTS[r.test].unit, `unit of ${r.test}`);
  }
  // the tests the task asked for, plus the breathing check his notes support
  assert.deepEqual([...new Set(R.map((r) => r.test))].sort(), ['breathing_symptoms', 'ddk_rate', 'eat10', 'falls_week', 'grip', 'mpt', 'pause_pct',
    'single_breath_count', 'sts30', 'timed_walk_speed', 'tug_time', 'typing_speed']);
  assert.deepEqual([...new Set(S.map((s) => s.signal))].sort(), ['bp', 'double_support', 'respiratory_rate', 'resting_hr', 'spo2', 'step_length',
    'steps', 'walking_asymmetry', 'walking_speed', 'weight']);
});

test('the store accepts every sample and every result as they are', () => {
  clearHomeData();
  try {
    const added = addSamples(S);
    assert.deepEqual(added, { added: S.length, skipped: 0, duplicates: 0, invalid: 0 });
    for (const r of R) {
      const stored = addResult(r);
      assert.notEqual(stored.ok, false, `${r.test} on ${r.date}: ${stored.reason}`);
    }
    assert.equal(getResults().length, R.length);
  } finally {
    clearHomeData();
  }
});

test('results have unique ids, a time of day, and come sorted by date', () => {
  assert.equal(new Set(R.map((r) => r.id)).size, R.length);
  // summary.js and "Load demo data" take simulated results with the same test, date, time
  // and value for copies, so no two demo results may share all four
  assert.equal(new Set(R.map((r) => JSON.stringify([r.test, r.date, r.time, r.value]))).size, R.length);
  for (const r of R) assert.match(r.time, /^([01]\d|2[0-3]):[0-5]\d$/);
  for (let i = 1; i < R.length; i++) assert.ok(R[i - 1].date <= R[i].date);
  for (let i = 1; i < S.length; i++) assert.ok(S[i - 1].start <= S[i].start);
  for (const x of [...S, ...R]) assert.ok(Number.isFinite(x.value) && x.value >= 0, 'values are real, non-negative numbers');
  for (const s of S) if (s.unit === '%') assert.ok(s.value <= 100, `${s.signal} ${s.value}%`);
});

// ---------- dates ----------
test("the dates are within Alex's timeline", () => {
  const firstSymptom = `${ALEX.actual.firstSymptom}-01`; // '2024-06' -> 2024-06-01
  const lastClinic = ALEX.measurements.map((m) => m.date).sort().at(-1); // 2026-09-22
  for (const s of S) assert.ok(s.start >= firstSymptom && s.start <= lastClinic, `${s.signal} on ${s.start}`);
  const kitStart = ALEX.encounters[0].date; // the first family-doctor visit
  for (const r of R) assert.ok(r.date >= kitStart && r.date <= '2026-08-31', `${r.test} on ${r.date}`);
  const dates = [...new Set(R.map((r) => r.date))].sort();
  assert.equal(dates[0].slice(0, 7), '2024-10', 'results start in October 2024');
  assert.equal(dates.at(-1).slice(0, 7), '2026-08', 'and run to August 2026');
  assert.ok(!dates.includes('2025-01-20'), 'no tests on the day of the carpal tunnel release');
  for (const d of dates) assert.equal(new Date(`${d}T00:00:00Z`).getUTCDay(), 1, `${d} is a Monday`);
  assert.ok(dates.length >= 90, 'about weekly, with a few missed weeks');
});

test('timed tests are weekly, EAT-10 monthly (its catalogue cadence)', () => {
  const weeks = new Set(R.map((r) => r.date)).size;
  for (const id of ['typing_speed', 'timed_walk_speed', 'sts30', 'tug_time', 'ddk_rate', 'pause_pct', 'mpt', 'single_breath_count', 'falls_week', 'breathing_symptoms']) {
    assert.ok(byTest(id).length >= weeks - 2, `${id} is weekly`);
  }
  const months = byTest('eat10').map((r) => r.date.slice(0, 7));
  assert.equal(new Set(months).size, months.length, 'one EAT-10 a month');
  assert.ok(months.length >= 22);
  // no typing for the 2 weeks after the hand surgery on 2025-01-20
  assert.deepEqual(byTest('typing_speed').filter((r) => r.date > '2025-01-20' && r.date <= '2025-02-03'), []);
});

// ---------- determinism ----------
test('the output is the same on every call, and callers get fresh objects', () => {
  assert.deepEqual(demoSamples('alex'), S);
  assert.deepEqual(demoResults('alex'), R);
  const a = demoResults('alex');
  a[0].value = -1;
  a[0].detail.source = 'changed';
  const b = demoSamples('alex');
  b[0].value = -1;
  assert.deepEqual(demoResults('alex'), R);
  assert.deepEqual(demoSamples('alex'), S);
});

// ---------- noise ----------
test('noise SD is MDC / (1.96 x sqrt 2) wherever an MDC exists, each with a source link', () => {
  const series = new Set([...R.map((r) => r.test), ...S.map((s) => s.signal)]);
  for (const id of series) {
    if (id === 'falls_week' || id === 'breathing_symptoms') continue; // events from his notes, not noise
    assert.ok(DEMO_NOISE[id], `noise entry for ${id}`);
  }
  for (const [id, n] of Object.entries(DEMO_NOISE)) {
    assert.match(n.source, /^https:\/\/\S+$/, `${id} source`);
    assert.ok(n.population.length > 20, `${id} population`);
    assert.ok(n.sd > 0, `${id} sd`);
    if (n.ourChoice) assert.equal(n.mdc, null, `${id}: our choice means no MDC`);
    else assert.ok(Math.abs(n.sd - n.mdc / K) < 1e-12, `${id}: sd = mdc / (1.96 x sqrt 2)`);
  }
  assert.ok(Math.abs(DEMO_NOISE.bp.sd2 - DEMO_NOISE.bp.mdc2 / K) < 1e-12);
});

test("the MDCs behind the noise are the catalogue's MDCs", () => {
  for (const [id, n] of Object.entries(DEMO_NOISE)) {
    const entry = TESTS[id] || SIGNALS[id];
    assert.ok(entry, `${id} is in the catalogue`);
    if (entry.mdc === null) {
      assert.equal(n.ourChoice, true, `${id}: no catalogue MDC, so the SD is our choice`);
    } else {
      assert.equal(n.mdc, entry.mdc.value, `${id}: same MDC as the catalogue`);
      assert.equal(n.unit, entry.mdc.unit, `${id}: same unit`);
      assert.equal(n.source, entry.mdc.source, `${id}: same source`);
    }
  }
});

// ---------- the body-region timeline ----------
test('typing slows from late 2024 (the hand)', () => {
  const rs = byTest('typing_speed');
  const early = mean(rs.slice(0, 4).map((r) => r.value));
  const late = mean(rs.filter((r) => r.date >= '2026-06-01').map((r) => r.value));
  assert.ok(late < early * 0.8, `typing ${early} -> ${late}`);
  assert.ok(slopePerMonth(weeklyTest('typing_speed', '2025-04-30')) < 0, 'already slowing before spring 2025');
  assert.ok(rs.find((r) => r.date > '2025-02-03').detail.note.includes('carpal tunnel'), 'the first test after surgery says so');
});

test('grip: the right hand confirms a decline in 2025, before the legs; the left not before 2026', () => {
  const rs = byTest('grip');
  const right = rs.filter((r) => r.detail.hand === 'right');
  const left = rs.filter((r) => r.detail.hand === 'left');
  assert.equal(right.length + left.length, rs.length, 'every grip result names its hand');
  assert.ok(left.length >= 90 && right.length >= 85, 'both hands about weekly');
  // no right-hand squeezes for 6 weeks after the carpal tunnel release on 2025-01-20
  assert.deepEqual(right.filter((r) => r.date > '2025-01-20' && r.date <= '2025-03-03'), []);
  assert.ok(right.find((r) => r.date > '2025-01-20').detail.note.includes('carpal tunnel'), 'the first one after surgery says so');
  // e1: "Grip is slightly weaker on the right"
  const start = (xs) => mean(xs.slice(0, 6).map((r) => r.value));
  assert.ok(start(right) < start(left) && start(right) > start(left) * 0.8, `right ${start(right)}, left ${start(left)} at the start`);
  // the clinic on 2026-09-22: 14 kg right, 32 kg left
  const end = (xs) => mean(xs.slice(-6).map((r) => r.value));
  assert.ok(Math.abs(end(right) - 14) < 3 && Math.abs(end(left) - 32) < 4, `right ${end(right)}, left ${end(left)} at the end`);

  const a = assessGrip('right');
  assert.equal(assessGrip('right', { asOf: '2025-01-19' }).firstDecline, null, 'no flag before the surgery');
  assert.ok(a.firstDecline && a.firstDecline.week > '2025-01-20' && a.firstDecline.week < '2026-01-01', `right confirmed in 2025: ${a.firstDecline?.week}`);
  assert.ok(a.current, 'and still at the end');
  const legs = [...LEG_TESTS.map((id) => assessTest(id)), ...LEG_SIGNALS.map((id) => assessSignal(id))].map((x) => x.firstDecline.week);
  for (const w of legs) assert.ok(a.firstDecline.week < w, `the arm (${a.firstDecline.week}) before the legs (${w})`);
  // the grip notes say to restart the baseline after hand surgery: it still confirms in 2025
  const again = assessGrip('right', { from: '2025-01-21' });
  assert.ok(again.firstDecline && again.firstDecline.week < '2026-01-01', `restarted baseline: ${again.firstDecline?.week}`);
  // the left: nothing before twitching shows in both forearms (e6, 2026-02-16)
  assert.equal(assessGrip('left', { asOf: '2026-02-15' }).firstDecline, null);
  const l = assessGrip('left').firstDecline;
  assert.ok(l === null || l.week >= '2026-02-16', `left ${l?.week}`);
});

test('walk, chair stands and TUG worsen from mid-2025 (the legs), not before', () => {
  for (const id of ['timed_walk_speed', 'sts30', 'tug_time']) {
    assert.equal(assessTest(id, '2025-04-20').firstDecline, null, `${id}: no flag before the foot catches (e3)`);
    const a = assessTest(id);
    assert.ok(a.firstDecline && a.firstDecline.week >= '2025-04-21', `${id}: flagged after e3`);
    assert.ok(a.current, `${id}: still declining at the end`);
  }
  assert.ok(assessTest('timed_walk_speed').firstDecline.week < '2026-01-01', 'the walk flags in 2025');
  assert.ok(assessTest('sts30').firstDecline.week < '2026-01-01', 'chair stands flag in 2025');
  // leg tests are done with someone present after the foot drop, and with the cane from Feb 2026
  for (const r of byTest('tug_time')) {
    assert.equal(r.detail.withSomeone === true, r.date >= '2025-08-12');
    assert.equal(r.detail.aid === 'cane', r.date >= '2026-02-16');
  }
  // the clinic walk on 2026-09-22 was 14.2 s for 10 m with a cane (0.70 m/s)
  const last = mean(byTest('timed_walk_speed').slice(-6).map((r) => r.value));
  assert.ok(Math.abs(last - 10 / 14.2) < 0.15, `walk speed at the end ${last}`);
});

test('syllable rate and reading pauses change only from spring 2026 (speech)', () => {
  for (const id of ['ddk_rate', 'pause_pct']) {
    assert.equal(assessTest(id, '2026-02-15').firstDecline, null, `${id}: nothing before 2026`);
    const first = assessTest(id).firstDecline;
    assert.ok(first === null || first.week >= '2026-03-01', `${id}: any flag is from spring 2026`);
  }
  assert.ok(assessTest('ddk_rate').firstDecline, 'the syllable rate decline is caught by the end');
});

test('MPT and the single-breath count stay near baseline (no flags)', () => {
  for (const id of ['mpt', 'single_breath_count']) {
    const a = assessTest(id);
    assert.equal(a.firstDecline, null, `${id}: never flagged`);
    const rs = byTest(id);
    const drift = Math.abs(mean(rs.slice(-8).map((r) => r.value)) - mean(rs.slice(2, 10).map((r) => r.value)));
    assert.ok(drift < DEMO_NOISE[id].mdc, `${id}: drift ${drift} is inside the MDC`);
  }
});

test('EAT-10 stays at 0 to 2; breathing symptoms appear with the two pillows (June 2026)', () => {
  for (const r of byTest('eat10')) assert.ok([0, 1, 2].includes(r.value), `EAT-10 ${r.value} on ${r.date}`);
  for (const r of byTest('breathing_symptoms')) assert.equal(r.value, r.date >= '2026-06-01' ? 1 : 0, r.date);
});

test('falls: the two his notes report, in early 2026; near-falls only once the foot catches', () => {
  const falls = byTest('falls_week').filter((r) => r.value > 0);
  assert.equal(falls.reduce((n, r) => n + r.value, 0), 2, 'e5: "He reports two falls"');
  for (const r of falls) assert.ok(r.date >= '2026-01-01' && r.date <= '2026-02-10', `fall reported ${r.date}`);
  for (const r of byTest('falls_week')) {
    assert.ok(Number.isInteger(r.detail.nearFalls) && r.detail.nearFalls >= 0);
    if (r.date < '2025-04-21') assert.equal(r.detail.nearFalls, 0, `no near-falls before e3 (${r.date})`);
  }
});

// ---------- device samples ----------
test('iPhone walking metrics worsen with the right foot drop; asymmetry rises', () => {
  for (const id of ['walking_speed', 'step_length', 'double_support']) {
    assert.equal(assessSignal(id, 'value', '2025-04-20').firstDecline, null, `${id}: no flag before e3`);
    const a = assessSignal(id);
    assert.ok(a.firstDecline && a.firstDecline.week >= '2025-04-21', `${id}: flagged after e3`);
    assert.ok(a.current, `${id}: still worse at the end`);
  }
  const asym = weeklySignal('walking_asymmetry');
  const start = median(asym.filter((w) => w.week < '2024-09-01').map((w) => w.value));
  const end = median(asym.filter((w) => w.week >= '2026-06-01').map((w) => w.value));
  assert.ok(start < 5 && end > start + 15, `asymmetry ${start} -> ${end}`);
});

test('steps fall slowly, from when the foot catches', () => {
  assert.equal(assessSignal('steps', 'value', '2025-04-20').firstDecline, null, 'no flag before e3');
  const w = weeklySignal('steps');
  const first = median(w.slice(0, 13).map((x) => x.value));
  const last = median(w.slice(-13).map((x) => x.value));
  assert.ok(last < first - 3000, `steps ${first} -> ${last}`);
  const slope = slopePerMonth(w);
  assert.ok(slope < 0 && slope > -600, `slow fall: ${slope} steps a day per month`);
});

test('weight falls about 6 kg "since the summer" (e6), and 86 to 78 kg over two years (e7)', () => {
  const kg = (from, to) => mean(bySignal('weight').filter((s) => s.start >= from && s.start <= to).map((s) => s.value));
  // "about 6 kg": 4.5 to 7.5 kg between summer 2025 and the 16 Feb 2026 visit
  const summer = kg('2025-06-01', '2025-07-31');
  const feb = kg('2026-02-02', '2026-02-15'); // the two weeks before the visit
  assert.ok(Math.abs(summer - feb - 6) <= 1.5, `since the summer: ${summer} -> ${feb}`);
  assert.ok(Math.abs(kg('2024-06-03', '2024-06-30') - 86) < 1, 'about 86 kg in June 2024');
  assert.ok(Math.abs(kg('2026-05-28', '2026-06-11') - 78) < 1, 'about 78 kg at the 11 June 2026 visit');
  assert.equal(assessSignal('weight', 'value', '2025-06-30').firstDecline, null, 'no flag before the summer');
  assert.ok(assessSignal('weight').current, 'the loss is confirmed at the end');
});

test('resting heart rate, blood pressure, SpO2 and breathing rate stay normal (context)', () => {
  const span = 26; // months of data, about
  for (const [id, field] of [['resting_hr', 'value'], ['bp', 'value'], ['bp', 'value2'], ['spo2', 'value'], ['respiratory_rate', 'value']]) {
    assert.notEqual(SIGNALS[id].feeds, 'engine-candidate', `${id} never feeds the score`);
    const a = assessSignal(id, field);
    assert.equal(a.firstDecline, null, `${id} ${field}: never flagged`);
    const mdc = field === 'value2' ? DEMO_NOISE[id].mdc2 : DEMO_NOISE[id].mdc;
    const trend = Math.abs(slopePerMonth(weeklySignal(id, field))) * span;
    assert.ok(trend < mdc / 2, `${id} ${field}: no trend (${trend} over the whole span)`);
  }
  for (const s of bySignal('bp')) assert.ok(Number.isFinite(s.value2) && s.value2 < s.value, 'diastolic below systolic');
});

// ---------- as the Home plan view shows it ----------
test('in the Home plan summary: the arm confirms in 2025, the legs later, speech only in 2026, context stays stable', () => {
  const view = (asOf) => new Map(summarize({ catalog, asOf, includeDemo: true, demo: { samples: S, results: R } })
    .flatMap((g) => g.rows).map((row) => [`${row.id}${row.variant ? `:${row.variant}` : ''}`, row]));
  const rows = view('2026-11-08');
  for (const row of rows.values()) assert.ok(row.simulated && row.chips.includes('simulated'), `${row.id} is labelled simulated`);
  const first = (id) => rows.get(id).assessment.firstDecline?.week ?? null;
  const arm = first('grip:right');
  assert.equal(rows.get('grip:right').region, 'arm');
  assert.ok(arm && arm >= '2025-01-01' && arm < '2026-01-01', `arm ${arm}`);
  assert.equal(rows.get('grip:right').assessment.status, 'decline');
  assert.equal(rows.get('typing_speed').assessment.status, 'no-mdc', 'typing has no published MDC, so it is not judged');
  for (const id of [...LEG_TESTS, ...LEG_SIGNALS]) {
    assert.equal(rows.get(id).region, 'leg');
    assert.ok(first(id) > arm, `${id} (${first(id)}) after the arm (${arm})`);
  }
  for (const id of ['ddk_rate', 'pause_pct']) assert.ok(first(id) === null || first(id) >= '2026-01-01', `${id} ${first(id)}`);
  assert.ok(first('ddk_rate'), 'the syllable rate decline shows by the end');
  for (const id of ['resting_hr', 'bp', 'spo2', 'respiratory_rate', 'mpt', 'single_breath_count']) {
    assert.equal(first(id), null, `${id} never flagged`);
    assert.equal(rows.get(id).assessment.status, 'stable', `${id} stable`);
  }
  for (const id of ['resting_hr', 'bp', 'respiratory_rate']) assert.ok(rows.get(id).chips.includes('context'), `${id} says context only`);
  // at the urgent referral (e6), the hand and the legs were already flagged; speech was not
  const e6 = view('2026-02-16');
  assert.ok(e6.get('grip:right').assessment.firstDecline, 'the hand, by the referral');
  assert.ok(e6.get('sts30').assessment.firstDecline, 'the legs, by the referral');
  assert.equal(e6.get('ddk_rate').assessment.firstDecline, null, 'not speech, by the referral');
});
