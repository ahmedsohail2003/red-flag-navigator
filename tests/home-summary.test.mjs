// "Your data by body region" (app/js/home/summary.js), checked against the Home plan
// requirements with a small made-up catalogue, so the tests do not depend on the
// sourced catalogue that replaces the stub. The MDCs below are example sizes for these
// tests, not clinical numbers.
// Run: node --test "tests/home-summary.test.mjs"
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  summarize, statusOf, checkThresholds, lastResult, lastSample, dueState, countAfter, REGION_ORDER, CHIP_WORDS,
} from '../app/js/home/summary.js';
import { HOME_TESTS } from '../app/js/engine.js';

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) < tol, `${a} vs ${b}`);

const CATALOG = {
  TESTS: {
    ddk_rate: { id: 'ddk_rate', label: 'Syllable repetition', region: 'bulbar', unit: 'syllables/s', higherIsBetter: true, decimals: 1, practiceWeeks: 0, mdc: { value: 0.5, unit: 'syllables/s' }, feeds: 'engine-candidate', implementation: 'experimental' },
    typing_speed: { id: 'typing_speed', label: 'Copy-typing', region: 'arm', unit: 'characters/min', higherIsBetter: true, decimals: 0, practiceWeeks: 2, mdc: { value: 10, unit: 'characters/min' }, feeds: 'engine-candidate', implementation: 'working' },
    tug_time: { id: 'tug_time', label: 'Timed up and go', region: 'leg', unit: 's', higherIsBetter: false, decimals: 1, practiceWeeks: 0, mdc: null, feeds: 'clinician-prompt', implementation: 'working' },
    grip: { id: 'grip', label: 'Grip strength', region: 'arm', unit: 'kg', higherIsBetter: true, decimals: 1, practiceWeeks: 0, mdc: { value: 10, unit: '%' }, feeds: 'engine-candidate', implementation: 'manual' },
  },
  SIGNALS: {
    steps: { id: 'steps', label: 'Daily steps', region: 'general', unit: 'steps', higherIsBetter: true, decimals: 0, weekly: { reduce: 'median', minPerWeek: 1 }, mdc: null, feeds: 'context' },
    falls: { id: 'falls', label: 'Falls', region: 'leg', unit: 'count', higherIsBetter: false, decimals: 0, weekly: { reduce: 'sum', minPerWeek: 1 }, mdc: null, feeds: 'clinician-prompt' },
    spo2: { id: 'spo2', label: 'Blood oxygen', region: 'breathing', unit: '%', higherIsBetter: true, decimals: 0, weekly: { reduce: 'median', minPerWeek: 1 }, mdc: null, feeds: 'clinician-prompt' },
    weight: { id: 'weight', label: 'Body weight', region: 'general', unit: 'kg', higherIsBetter: true, decimals: 1, weekly: { reduce: 'median', minPerWeek: 1 }, mdc: null, feeds: 'engine-candidate' },
    bp: { id: 'bp', label: 'Blood pressure', region: 'general', unit: 'mmHg', higherIsBetter: false, decimals: 0, weekly: { reduce: 'median', minPerWeek: 1 }, mdc: null, feeds: 'context' },
  },
};

// Mondays from 5 January 2026, one week apart.
const W = ['2026-01-05', '2026-01-12', '2026-01-19', '2026-01-26', '2026-02-02', '2026-02-09', '2026-02-16', '2026-02-23'];
const result = (test, date, value, extra = {}) => ({ id: `${test}-${date}-${value}`, test, date, value, unit: CATALOG.TESTS[test]?.unit || 'x', ...extra });
const sample = (signal, start, value, extra = {}) => ({ signal, start, value, unit: CATALOG.SIGNALS[signal]?.unit || 'x', source: 'apple-health', ...extra });
const rowsOf = (regions) => regions.flatMap((g) => g.rows);
const find = (regions, kind, id, sim = false) => rowsOf(regions).find((r) => r.kind === kind && r.id === id && r.simulated === sim);

test('regions come in the order arm, leg, bulbar, breathing, general, cognitive, and empty ones are left out', () => {
  assert.deepEqual(REGION_ORDER, ['arm', 'leg', 'bulbar', 'breathing', 'general', 'cognitive']);
  const regions = summarize({
    catalog: CATALOG,
    asOf: '2026-12-31',
    results: [result('ddk_rate', W[0], 5), result('typing_speed', W[0], 200), result('tug_time', W[0], 9)],
    samples: [sample('steps', W[0], 4000), sample('spo2', W[0], 97)],
  });
  assert.deepEqual(regions.map((g) => g.region), ['arm', 'leg', 'bulbar', 'breathing', 'general']);
});

test('weekly values: the mean of the results for a test, the signal\'s own reduce for samples', () => {
  const regions = summarize({
    catalog: CATALOG,
    asOf: '2026-12-31',
    results: [result('ddk_rate', '2026-01-05', 4), result('ddk_rate', '2026-01-07', 5), result('ddk_rate', '2026-01-11', 9)],
    samples: [
      sample('falls', '2026-01-05', 1), sample('falls', '2026-01-08', 2), // sum: 3
      sample('steps', '2026-01-05', 1000), sample('steps', '2026-01-06', 9000), sample('steps', '2026-01-07', 3000), // median: 3000
    ],
  });
  close(find(regions, 'test', 'ddk_rate').weekly[0].value, 6); // (4 + 5 + 9) / 3, all in the week of 5 January
  assert.equal(find(regions, 'test', 'ddk_rate').weekly[0].n, 3);
  assert.equal(find(regions, 'signal', 'falls').weekly[0].value, 3);
  assert.equal(find(regions, 'signal', 'steps').weekly[0].value, 3000);
});

test('tests the catalogue scores by the best try keep the week\'s best (maximum phonation time)', () => {
  const catalog = { ...CATALOG, TESTS: { ...CATALOG.TESTS, mpt: { id: 'mpt', label: 'Hold aah', region: 'breathing', unit: 's', higherIsBetter: true, practiceWeeks: 0, mdc: null } } };
  const regions = summarize({ catalog, asOf: '2026-12-31', results: [result('mpt', W[0], 12, { unit: 's' }), result('mpt', W[0], 15, { unit: 's' }), result('mpt', W[0], 9, { unit: 's' })] });
  assert.equal(find(regions, 'test', 'mpt').weekly[0].value, 15);
});

test('practice results are left out of the weekly values and counted apart', () => {
  const regions = summarize({
    catalog: CATALOG,
    asOf: '2026-12-31',
    results: [result('ddk_rate', W[0], 2, { practice: true }), result('ddk_rate', W[0], 6), result('ddk_rate', W[1], 6)],
  });
  const row = find(regions, 'test', 'ddk_rate');
  assert.deepEqual(row.weekly.map((w) => w.value), [6, 6]);
  assert.equal(row.practice, 1);
  // only practice so far: a row that says so, with no weekly value
  const only = find(summarize({ catalog: CATALOG, asOf: '2026-12-31', results: [result('ddk_rate', W[0], 2, { practice: true })] }), 'test', 'ddk_rate');
  assert.equal(only.weekly.length, 0);
  assert.equal(only.status.word, 'Practice only so far');
});

test('demo data appears only with includeDemo, labelled Simulated, never mixed with the person\'s own', () => {
  const demo = { results: [result('ddk_rate', W[0], 5)], samples: [sample('steps', W[0], 5000, { source: 'demo' })] };
  const stored = [result('ddk_rate', W[0], 7, { simulated: true })]; // demo data the person loaded into storage
  const off = summarize({ catalog: CATALOG, asOf: '2026-12-31', results: stored, demo, includeDemo: false });
  assert.equal(rowsOf(off).length, 0);
  const on = summarize({ catalog: CATALOG, asOf: '2026-12-31', results: [...stored, result('ddk_rate', W[0], 4)], demo, includeDemo: true });
  const sim = find(on, 'test', 'ddk_rate', true);
  const own = find(on, 'test', 'ddk_rate', false);
  assert.ok(sim.chips.includes('simulated'));
  assert.ok(!sim.chips.includes('real'));
  close(sim.weekly[0].value, 6); // 5 from demo.js and 7 from storage, never the person's 4
  assert.deepEqual(own.weekly.map((w) => w.value), [4]);
  assert.ok(own.chips.includes('real'));
  assert.ok(find(on, 'signal', 'steps', true).chips.includes('simulated'));
});

test('a signal that needs several readings a week says so instead of "no data"', () => {
  const catalog = { ...CATALOG, SIGNALS: { ...CATALOG.SIGNALS, weight: { ...CATALOG.SIGNALS.weight, weekly: { reduce: 'median', minPerWeek: 3 } } } };
  const regions = summarize({ catalog, asOf: '2026-12-31', samples: [sample('weight', '2026-01-05', 70), sample('weight', '2026-01-12', 70)] });
  const row = find(regions, 'signal', 'weight');
  assert.equal(row.weekly.length, 0);
  assert.equal(row.readings, 2);
  assert.equal(row.status.word, 'Too few readings per week yet');
  assert.match(row.status.detail, /3 readings/);
});

test('the same demo reading in storage and in demo.js counts once', () => {
  const s = sample('steps', W[0], 5000, { source: 'demo', simulated: true });
  const regions = summarize({ catalog: CATALOG, asOf: '2026-12-31', samples: [s], demo: { samples: [{ ...s }], results: [] }, includeDemo: true });
  assert.equal(find(regions, 'signal', 'steps', true).weekly[0].n, 1);
});

test('chips: context-only signals, imported and typed-in device data, not-validated tools', () => {
  const regions = summarize({
    catalog: CATALOG,
    asOf: '2026-12-31',
    results: [result('ddk_rate', W[0], 5)],
    samples: [sample('steps', W[0], 4000), sample('spo2', W[0], 97, { source: 'manual' }), sample('weight', W[0], 70, { source: 'csv:withings' })],
  });
  assert.ok(find(regions, 'signal', 'steps').chips.includes('context'));
  assert.ok(find(regions, 'signal', 'steps').chips.includes('imported'));
  assert.ok(!find(regions, 'signal', 'spo2').chips.includes('context'));
  assert.ok(find(regions, 'signal', 'spo2').chips.includes('entered'));
  assert.ok(find(regions, 'signal', 'weight').chips.includes('imported'));
  assert.ok(find(regions, 'test', 'ddk_rate').chips.includes('experimental'));
  assert.equal(CHIP_WORDS.context, 'Context only');
  assert.equal(CHIP_WORDS.experimental, 'Not validated');
  assert.equal(CHIP_WORDS.simulated, 'Simulated');
});

test('a declining series gives "decline", with the date in words', () => {
  // baseline 6 from the first two weeks; MDC 0.5; the last two weeks are 1 below it
  const values = [6, 6, 5.9, 6.1, 5, 5];
  const regions = summarize({ catalog: CATALOG, asOf: '2026-12-31', results: values.map((v, i) => result('ddk_rate', W[i], v)) });
  const row = find(regions, 'test', 'ddk_rate');
  assert.equal(row.assessment.status, 'decline');
  assert.equal(row.assessment.firstDecline.week, W[5]);
  assert.equal(row.status.word, 'Decline confirmed in the week of 9 Feb 2026');
  assert.equal(row.baseline.value, 6);
  assert.equal(row.latest.value, 5);
  assert.ok(row.slope < 0);
});

test('lower-is-better tests decline upwards, and the other statuses read in words', () => {
  CATALOG.TESTS.tug_time.mdc = { value: 1, unit: 's' };
  try {
    const up = summarize({ catalog: CATALOG, asOf: '2026-12-31', results: [9, 9, 9, 11].map((v, i) => result('tug_time', W[i], v)) });
    assert.equal(find(up, 'test', 'tug_time').assessment.status, 'once');
    assert.equal(find(up, 'test', 'tug_time').status.word, 'Beyond normal variation once');
    const flat = summarize({ catalog: CATALOG, asOf: '2026-12-31', results: [9, 9, 9, 9].map((v, i) => result('tug_time', W[i], v)) });
    assert.equal(find(flat, 'test', 'tug_time').status.word, 'Within normal variation');
    const early = summarize({ catalog: CATALOG, asOf: '2026-12-31', results: [result('tug_time', W[0], 9)] });
    assert.equal(find(early, 'test', 'tug_time').status.word, 'Baseline not set yet');
  } finally {
    CATALOG.TESTS.tug_time.mdc = null;
  }
  const noMdc = summarize({ catalog: CATALOG, asOf: '2026-12-31', results: [9, 9, 9, 12].map((v, i) => result('tug_time', W[i], v)) });
  assert.equal(find(noMdc, 'test', 'tug_time').assessment.status, 'no-mdc');
  assert.equal(find(noMdc, 'test', 'tug_time').status.word, 'Not judged');
});

test('practice weeks from the catalogue are skipped before the baseline', () => {
  // typing_speed has practiceWeeks 2: the baseline is weeks 3 and 4
  const regions = summarize({ catalog: CATALOG, asOf: '2026-12-31', results: [150, 170, 200, 210].map((v, i) => result('typing_speed', W[i], v)) });
  const row = find(regions, 'test', 'typing_speed');
  assert.equal(row.baseline.value, 205);
  assert.deepEqual(row.baseline.weeks, [W[2], W[3]]);
  assert.equal(row.status.word, 'Baseline set, too early to judge');
});

test('an MDC given as a percentage is turned into the measure\'s unit from the baseline', () => {
  // grip: 10% of a 40 kg baseline is 4 kg; 35 is 5 kg below, twice in a row
  const regions = summarize({ catalog: CATALOG, asOf: '2026-12-31', results: [40, 40, 39, 35, 35].map((v, i) => result('grip', W[i], v, { unit: 'kg', detail: { hand: 'right' } })) });
  const row = find(regions, 'test', 'grip');
  close(row.mdc, 4);
  assert.equal(row.assessment.status, 'decline');
  assert.equal(row.variant, 'right');
  assert.match(row.label, /right hand/);
});

test('the two hands are kept apart', () => {
  const regions = summarize({
    catalog: CATALOG,
    asOf: '2026-12-31',
    results: [result('grip', W[0], 40, { detail: { hand: 'right' } }), result('grip', W[0], 30, { detail: { hand: 'left' } })],
  });
  const grips = rowsOf(regions).filter((r) => r.id === 'grip');
  assert.equal(grips.length, 2);
  assert.deepEqual(grips.map((r) => r.weekly[0].value).sort(), [30, 40]);
});

test('data after asOf is ignored, and countAfter says how much', () => {
  const results = [result('ddk_rate', '2026-01-05', 5), result('ddk_rate', '2026-01-20', 1)];
  const samples = [sample('steps', '2026-01-06T10:00:00-05:00', 4000), sample('steps', '2026-01-21', 100)];
  const regions = summarize({ catalog: CATALOG, asOf: '2026-01-19', results, samples });
  assert.deepEqual(find(regions, 'test', 'ddk_rate').weekly.map((w) => w.value), [5]);
  assert.deepEqual(find(regions, 'signal', 'steps').weekly.map((w) => w.value), [4000]);
  assert.equal(countAfter({ results, samples, asOf: '2026-01-19' }), 2);
  // the cut is a calendar date: a reading late on the 19th, written with its offset, still counts
  const late = summarize({ catalog: CATALOG, asOf: '2026-01-19', samples: [sample('steps', '2026-01-19T23:30:00-05:00', 10)] });
  assert.equal(find(late, 'signal', 'steps').weekly[0].value, 10);
});

test('the older tests map to their regions; calibration trials are left out', () => {
  const legacyResults = [
    { date: W[0], test: 'tap_right', value: 60, person: 'Sam', calibration: false },
    { date: W[0], test: 'tap_left', value: 55, person: 'Sam', calibration: false },
    { date: W[0], test: 'reading', value: 160, person: 'Sam', calibration: false },
    { date: W[0], test: 'weight', value: 70, person: 'Sam', calibration: false },
    { date: W[0], test: 'walk', value: 3, person: 'Sam', calibration: false },
    { date: W[0], test: 'tap_right', value: 10, person: 'Sam', calibration: true },
    { date: W[0], test: 'tap_right', value: 99, person: 'Kim', calibration: false },
  ];
  const regions = summarize({ catalog: CATALOG, asOf: '2026-12-31', legacyResults, legacyPerson: 'Sam' });
  for (const id of ['tap_right', 'tap_left', 'reading', 'weight', 'walk']) {
    const row = find(regions, 'test', id);
    assert.ok(row, id);
    assert.equal(row.region, HOME_TESTS[id].region, id);
    assert.ok(row.legacy);
    assert.ok(row.chips.includes('real'));
  }
  assert.equal(find(regions, 'test', 'tap_right').region, 'arm');
  assert.equal(find(regions, 'test', 'walk').region, 'leg');
  assert.equal(find(regions, 'test', 'reading').region, 'bulbar');
  assert.equal(find(regions, 'test', 'weight').region, 'general');
  assert.deepEqual(find(regions, 'test', 'tap_right').weekly.map((w) => w.value), [60]); // not the calibration trial, not Kim
  // the engine's placeholder MDC is used and labelled, unless the team measured one
  assert.equal(find(regions, 'test', 'tap_right').mdc, HOME_TESTS.tap_right.placeholderMdc);
  assert.ok(find(regions, 'test', 'tap_right').chips.includes('assumption'));
  const measured = summarize({ catalog: CATALOG, asOf: '2026-12-31', legacyResults, legacyPerson: 'Sam', measuredMdc: { tap_right: 4.2 } });
  assert.equal(find(measured, 'test', 'tap_right').mdc, 4.2);
  assert.ok(!find(measured, 'test', 'tap_right').chips.includes('assumption'));
});

test('person keeps only the data saved for that case', () => {
  const regions = summarize({
    catalog: CATALOG,
    asOf: '2026-12-31',
    person: 'alex',
    results: [result('ddk_rate', W[0], 5, { person: 'alex' }), result('ddk_rate', W[0], 1, { person: 'user-1' }), result('ddk_rate', W[0], 2)],
  });
  assert.deepEqual(find(regions, 'test', 'ddk_rate').weekly.map((w) => w.value), [5]);
});

test('blood pressure: the top number is the weekly value, the bottom number rides along', () => {
  const regions = summarize({ catalog: CATALOG, asOf: '2026-12-31', samples: [sample('bp', W[0], 130, { value2: 85 }), sample('bp', '2026-01-06', 120, { value2: 75 })] });
  const row = find(regions, 'signal', 'bp');
  assert.equal(row.weekly[0].value, 125);
  assert.equal(row.weekly2[0].value, 80);
});

test('junk input gives an empty summary, never an error', () => {
  assert.deepEqual(summarize(), []);
  assert.deepEqual(summarize({ results: 'x', samples: [null, 4, { signal: 'steps' }], catalog: null }), []);
  const odd = summarize({ catalog: CATALOG, asOf: '2026-12-31', samples: [sample('mystery', W[0], 3)] });
  assert.equal(find(odd, 'signal', 'mystery').region, 'general');
});

test('thresholds after diagnosis: a drop from baseline fires; a unit mismatch is not judged', () => {
  const regions = summarize({ catalog: CATALOG, asOf: '2026-12-31', samples: [70, 70, 66].map((v, i) => sample('weight', W[i], v)).concat([sample('spo2', W[0], 90)]) });
  const thresholds = [
    { id: 'wt', domain: 'nutrition', when: { kind: 'signal', id: 'weight', rule: 'pctDropFromBaseline', value: 5, unit: '%' }, action: 'Refer to a dietitian', source: 'https://example.org/a' },
    { id: 'ox', domain: 'breathing', when: { kind: 'signal', id: 'spo2', rule: 'below', value: 92, unit: '%' }, action: 'Check breathing', source: 'https://example.org/b' },
    { id: 'ox2', domain: 'breathing', when: { kind: 'signal', id: 'spo2', rule: 'below', value: 92, unit: 'fraction' }, action: 'x', source: 'https://example.org/c' },
    { id: 'none', domain: 'mobility', when: { kind: 'test', id: 'tug_time', rule: 'above', value: 1, unit: 's' }, action: 'y', source: 'https://example.org/d' },
  ];
  const out = checkThresholds(regions, thresholds);
  const by = (id) => out.find((o) => o.threshold.id === id);
  assert.equal(by('wt').met, true);
  close(by('wt').value, (4 / 70) * 100); // 66 is 5.7% below the 70 baseline
  assert.equal(by('ox').met, true);
  assert.equal(by('ox2').met, null);
  assert.match(by('ox2').reason, /fraction/);
  assert.equal(by('none').met, null);
  assert.equal(checkThresholds(regions, [{ ...thresholds[1], when: { ...thresholds[1].when, value: 85 } }])[0].met, false);
});

test('thresholds: the same unit spelled two ways still matches (words a minute, words per minute)', () => {
  // The reading test's unit comes from the engine ("words per minute"); a rule may say "words a minute".
  const legacyResults = [{ date: W[0], test: 'reading', value: 110, person: '' }];
  const regions = summarize({ catalog: CATALOG, asOf: '2026-12-31', legacyResults, legacyPerson: '' });
  assert.equal(find(regions, 'test', 'reading').unit, HOME_TESTS.reading.unit);
  const rule = { id: 'rate', domain: 'speech', when: { kind: 'test', id: 'reading', rule: 'below', value: 120, unit: 'words a minute' }, action: 'AAC review', source: 'https://example.org/e' };
  const [out] = checkThresholds(regions, [rule]);
  assert.equal(out.met, true);
  assert.equal(out.value, 110);
  // a real mismatch is still refused
  const [other] = checkThresholds(regions, [{ ...rule, when: { ...rule.when, unit: 'syllables a second' } }]);
  assert.equal(other.met, null);
});

test('last done and due or done, by cadence', () => {
  const results = [result('ddk_rate', '2026-11-03', 5, { time: '09:00' }), result('ddk_rate', '2026-11-03', 6, { time: '10:00', practice: true }), result('ddk_rate', '2026-11-20', 7)];
  const last = lastResult(results, 'ddk_rate', { asOf: '2026-11-08' });
  assert.equal(last.value, 6); // the latest on or before asOf, a practice run included
  assert.equal(lastSample([sample('steps', '2026-11-01', 1), sample('steps', '2026-11-05', 2)], 'steps', { asOf: '2026-11-08' }).value, 2);
  assert.equal(dueState('2026-11-03', 'weekly', '2026-11-08').word, 'Done this week'); // Tuesday and Sunday of one week
  assert.equal(dueState('2026-11-01', 'weekly', '2026-11-08').due, true); // the Sunday before
  assert.equal(dueState('2026-10-27', 'every2weeks', '2026-11-08').due, false);
  assert.equal(dueState('2026-10-24', 'every2weeks', '2026-11-08').due, true);
  assert.equal(dueState('2026-11-01', 'monthly', '2026-11-30').word, 'Done this month');
  assert.equal(dueState('2026-10-31', 'monthly', '2026-11-01').due, true);
  assert.equal(dueState(null, 'weekly', '2026-11-08').word, 'Due');
});

test('statusOf gives words for every status', () => {
  for (const status of ['no-data', 'baseline', 'no-mdc', 'stable', 'once', 'decline', 'odd']) {
    const s = statusOf({ status, baseline: null, firstDecline: status === 'decline' ? { week: '2026-11-02', value: 1 } : null }, { weekly: [], practiceWeeks: 0, practice: 0 });
    assert.ok(typeof s.word === 'string' && s.word.length > 0, status);
  }
});

// ---------- final review fixes ----------
test('weeks of practice runs use up the catalogue\'s practice weeks instead of adding to them', () => {
  // typing_speed has 2 practice weeks. Weeks 1 and 2 hold only runs marked practice, so the
  // baseline is weeks 3 and 4, not weeks 5 and 6.
  const practised = [result('typing_speed', W[0], 120, { practice: true }), result('typing_speed', W[1], 140, { practice: true })];
  const row = find(summarize({ catalog: CATALOG, asOf: '2026-12-31', results: [...practised, ...[200, 210, 205, 208].map((v, i) => result('typing_speed', W[i + 2], v))] }), 'test', 'typing_speed');
  assert.equal(row.practiceWeeks, 0);
  assert.equal(row.practice, 2);
  assert.deepEqual(row.baseline.weeks, [W[2], W[3]]);
  assert.equal(row.baseline.value, 205);
  assert.equal(row.status.word, 'Within normal variation');
  // one week of practice runs uses up one practice week
  const one = find(summarize({ catalog: CATALOG, asOf: '2026-12-31', results: [practised[0], ...[200, 210, 205].map((v, i) => result('typing_speed', W[i + 1], v))] }), 'test', 'typing_speed');
  assert.equal(one.practiceWeeks, 1);
  assert.deepEqual(one.baseline.weeks, [W[2], W[3]]);
  // a practice run beside a counted run in the same week, or one after the practice weeks,
  // moves nothing: the practice weeks are still the first 2 weeks the test was done
  const plain = [200, 210, 205, 208, 207].map((v, i) => result('typing_speed', W[i], v));
  for (const extra of [result('typing_speed', W[0], 150, { practice: true }), result('typing_speed', W[6], 150, { practice: true })]) {
    const r = find(summarize({ catalog: CATALOG, asOf: '2026-12-31', results: [...plain, extra] }), 'test', 'typing_speed');
    assert.equal(r.practiceWeeks, 2, extra.date);
    assert.deepEqual(r.baseline.weeks, [W[2], W[3]], extra.date);
  }
});

test('older results from a simulated walk or saved under a demo date get their own Simulated row, shown only with demo data on', () => {
  // As the gyro fork saves them (motion/web/flag.js): simulated: true for a simulated walk,
  // demoDate: true for a result saved under a date that was not that day.
  const legacyResults = [
    { date: W[0], test: 'gait_speed', value: 1.3, person: '' },
    { date: W[1], test: 'gait_speed', value: 1.28, person: '' },
    { date: W[2], test: 'gait_speed', value: 0.9, person: '', simulated: true },
    { date: W[3], test: 'gait_speed', value: 0.8, person: '', demoDate: true },
  ];
  const off = rowsOf(summarize({ catalog: CATALOG, asOf: '2026-12-31', legacyResults, legacyPerson: '' })).filter((r) => r.id === 'gait_speed');
  assert.equal(off.length, 1);
  assert.equal(off[0].simulated, false);
  assert.ok(off[0].chips.includes('real'));
  assert.deepEqual(off[0].weekly.map((w) => w.value), [1.3, 1.28]);
  const on = summarize({ catalog: CATALOG, asOf: '2026-12-31', legacyResults, legacyPerson: '', includeDemo: true });
  const real = find(on, 'test', 'gait_speed', false);
  const sim = find(on, 'test', 'gait_speed', true);
  assert.deepEqual(real.weekly.map((w) => w.value), [1.3, 1.28]);
  assert.deepEqual(sim.weekly.map((w) => w.value), [0.9, 0.8]);
  assert.ok(sim.chips.includes('simulated'));
  assert.ok(!sim.chips.includes('real'));
  assert.ok(sim.legacy);
  assert.notEqual(sim.key, real.key);
});

test('a threshold with when.consecutive needs that many weekly values in a row', () => {
  // "Your reading speed has stayed under about 120 words a minute": one week is not enough.
  const rule = { id: 'rate', domain: 'speech', when: { kind: 'test', id: 'reading', rule: 'below', value: 120, unit: 'words a minute', consecutive: 2 }, action: 'AAC review', source: 'https://example.org/e' };
  const reading = (values) => summarize({ catalog: CATALOG, asOf: '2026-12-31', legacyPerson: '', legacyResults: values.map((v, i) => ({ date: W[i], test: 'reading', value: v, person: '' })) });
  const check = (values, r = rule) => checkThresholds(reading(values), [r])[0];
  const once = check([130, 110]);
  assert.equal(once.met, false);
  assert.match(once.reason, /Met in the latest week; the rule needs 2 weeks in a row/);
  assert.equal(check([110]).met, null, 'one week so far: not judged yet');
  const two = check([130, 110, 115]);
  assert.equal(two.met, true);
  assert.deepEqual(two.values, [110, 115]);
  assert.equal(two.value, 115);
  assert.equal(check([110, 115, 125]).met, false, 'back above 120 in the latest week');
  // without consecutive, one week is enough, as before
  const { consecutive, ...oneWeek } = rule.when;
  assert.equal(consecutive, 2);
  assert.equal(check([130, 110], { ...rule, when: oneWeek }).met, true);
});

test('a drop from baseline with when.consecutive: two weeks in a row, judged only after the baseline weeks', () => {
  const grip = (values) => summarize({ catalog: CATALOG, asOf: '2026-12-31', results: values.map((v, i) => result('grip', W[i], v, { detail: { hand: 'right' } })) });
  const rule = { id: 'g', domain: 'hand', when: { kind: 'test', id: 'grip', rule: 'pctDropFromBaseline', value: 23.4, unit: '%', consecutive: 2 }, action: 'OT', source: 'https://example.org/f' };
  const check = (values, r = rule) => checkThresholds(grip(values), [r])[0];
  const one = check([40, 40, 41, 30]); // 25% down in the latest week only
  assert.equal(one.met, false);
  close(one.value, 25);
  const two = check([40, 40, 30, 30]);
  assert.equal(two.met, true);
  assert.equal(two.values.length, 2);
  for (const v of two.values) close(v, 25);
  // a baseline week is never compared with the baseline it is part of
  const base = check([40, 28], { ...rule, when: { ...rule.when, value: 10, consecutive: 1 } });
  assert.equal(base.met, null);
  assert.match(base.reason, /after the baseline/);
});

test('a threshold without when.kind checks test rows and signal rows alike', () => {
  // weight from a scale is a signal row; weight saved on the Monitoring page is a test row
  const regions = summarize({
    catalog: CATALOG, asOf: '2026-12-31', legacyPerson: '',
    samples: [70, 70, 66].map((v, i) => sample('weight', W[i], v)),
    legacyResults: [80, 80, 75].map((v, i) => ({ date: W[i], test: 'weight', value: v, person: '' })),
  });
  const out = checkThresholds(regions, [{ id: 'wt', domain: 'nutrition', when: { id: 'weight', rule: 'pctDropFromBaseline', value: 5, unit: '%' }, action: 'Dietitian review', source: 'https://example.org/a' }]);
  assert.deepEqual(out.map((o) => o.row.kind).sort(), ['signal', 'test']);
  assert.ok(out.every((o) => o.met === true));
});

test('the tapping, reading and weight defaults name their source; other MDCs keep their note', () => {
  const legacyResults = ['tap_right', 'tap_left', 'reading', 'walk', 'weight'].map((test) => ({ date: W[0], test, value: 50, person: '' }));
  const regions = summarize({ catalog: CATALOG, asOf: '2026-12-31', legacyResults, legacyPerson: '' });
  assert.equal(find(regions, 'test', 'weight').mdcNote, 'default; about 2.4 kg, computed by us from Bhutani 2017');
  const tap = find(regions, 'test', 'tap_right');
  assert.equal(tap.mdcNote, 'default; provisional: about 18 taps per 10 s, scaled by us from WatchALS');
  assert.equal(find(regions, 'test', 'tap_left').mdcNote, tap.mdcNote);
  const reading = find(regions, 'test', 'reading');
  assert.equal(reading.mdcNote, 'default; WatchALS: 31 wpm in controls (22 in ALS)');
  // the placeholder is still the MDC in use, and still labelled an assumption
  assert.equal(reading.mdc, HOME_TESTS.reading.placeholderMdc);
  assert.ok(reading.chips.includes('assumption'));
  assert.equal(find(regions, 'test', 'walk').mdcNote, 'placeholder');
  const measured = summarize({ catalog: CATALOG, asOf: '2026-12-31', legacyResults, legacyPerson: '', measuredMdc: { reading: 25 } });
  assert.equal(find(measured, 'test', 'reading').mdcNote, 'measured');
});

test('a context-only measure never says "decline": neutral words, and the row says what it feeds', () => {
  const catalog = { ...CATALOG, SIGNALS: { ...CATALOG.SIGNALS, bp: { ...CATALOG.SIGNALS.bp, mdc: { value: 10, unit: 'mmHg', population: '133 untreated adults' } } } };
  const bp = (values) => find(summarize({ catalog, asOf: '2026-12-31', samples: values.map((v, i) => sample('bp', W[i], v)) }), 'signal', 'bp');
  // the top number up 15 mmHg two weeks running (for blood pressure, worse is up)
  const row = bp([120, 120, 135, 135]);
  assert.equal(row.feeds, 'context');
  assert.equal(row.assessment.status, 'decline');
  assert.equal(`${row.status.word}. ${row.status.detail}`, 'Changed beyond normal variation two weeks running. Context only: not a sign of ALS on its own; mention it to your doctor.');
  assert.notEqual(row.status.cls, 'decline');
  // the MDC's population stays on the row, for the view to print
  assert.equal(row.mdcInfo.population, '133 untreated adults');
  // once, and back within normal variation: no "decline" either
  const once = bp([120, 120, 120, 135]);
  assert.equal(once.assessment.status, 'once');
  assert.doesNotMatch(`${once.status.word} ${once.status.detail}`, /declin/i);
  const back = bp([120, 120, 135, 135, 120]);
  assert.equal(back.assessment.status, 'stable');
  assert.doesNotMatch(`${back.status.word} ${back.status.detail}`, /declin/i);
  // a measure that is not context only keeps the decline words
  const ddk = find(summarize({ catalog: CATALOG, asOf: '2026-12-31', results: [6, 6, 5.9, 6.1, 5, 5].map((v, i) => result('ddk_rate', W[i], v)) }), 'test', 'ddk_rate');
  assert.equal(ddk.feeds, 'engine-candidate');
  assert.match(ddk.status.word, /^Decline confirmed/);
  assert.equal(statusOf({ status: 'decline', baseline: 1, firstDecline: { week: W[3], value: 1 } }, { feeds: 'context' }).word, 'Changed beyond normal variation two weeks running');
  // the older tests have no catalogue entry, so nothing to feed
  assert.equal(find(summarize({ catalog: CATALOG, asOf: '2026-12-31', legacyPerson: '', legacyResults: [{ date: W[0], test: 'reading', value: 150, person: '' }] }), 'test', 'reading').feeds, null);
});

test('a questionnaire week is its worst answer, and an answer marked practice still counts', () => {
  const falls = { id: 'falls_week', label: 'Falls this week', region: 'leg', kind: 'questionnaire', unit: 'count', higherIsBetter: false, decimals: 0, practiceWeeks: 0, mdc: null, feeds: 'clinician-prompt' };
  const catalog = { ...CATALOG, TESTS: { ...CATALOG.TESTS, falls_week: falls } };
  // "No falls" on Monday, then a fall reported on Thursday: the week counts 1 fall, not 0.5
  const week = [result('falls_week', '2026-01-05', 0), result('falls_week', '2026-01-08', 1)];
  const regions = summarize({ catalog, asOf: '2026-12-31', results: week });
  assert.equal(find(regions, 'test', 'falls_week').weekly[0].value, 1);
  const rule = { id: 'falls', domain: 'mobility', when: { kind: 'test', id: 'falls_week', rule: 'atLeast', value: 1, unit: 'count' }, action: 'Falls review', source: 'https://example.org/g' };
  assert.equal(checkThresholds(regions, [rule])[0].met, true);
  // a fall ticked as a practice run is still a fall
  const ticked = find(summarize({ catalog, asOf: '2026-12-31', results: [result('falls_week', W[0], 2, { practice: true })] }), 'test', 'falls_week');
  assert.deepEqual(ticked.weekly.map((w) => w.value), [2]);
  assert.equal(ticked.practice, 0);
  // the catalogue's own weekly rule wins, minPerWeek included
  const own = { ...catalog, TESTS: { ...catalog.TESTS, falls_week: { ...falls, weekly: { reduce: 'mean', minPerWeek: 2 } } } };
  close(find(summarize({ catalog: own, asOf: '2026-12-31', results: week }), 'test', 'falls_week').weekly[0].value, 0.5);
  const single = find(summarize({ catalog: own, asOf: '2026-12-31', results: [result('falls_week', W[1], 1)] }), 'test', 'falls_week');
  assert.equal(single.weekly.length, 0);
  assert.equal(single.status.word, 'Too few readings per week yet');
});

test('since drops the weeks before it, so an old imported history cannot set the baseline', () => {
  // since is Wednesday 7 January 2026: its week, from Monday 5 January, stays whole;
  // Sunday 4 January is in the week before and is dropped, like the 2024 weeks.
  const samples = [
    sample('steps', '2024-03-04', 9000), sample('steps', '2024-03-11', 9000), sample('steps', '2026-01-04', 9000),
    sample('steps', '2026-01-05', 5000), sample('steps', '2026-01-12', 5200), sample('steps', '2026-01-19', 5100),
  ];
  const row = find(summarize({ catalog: CATALOG, asOf: '2026-12-31', since: '2026-01-07', samples }), 'signal', 'steps');
  assert.deepEqual(row.weekly.map((w) => w.week), [W[0], W[1], W[2]]);
  assert.deepEqual(row.baseline.weeks, [W[0], W[1]]);
  const all = find(summarize({ catalog: CATALOG, asOf: '2026-12-31', samples }), 'signal', 'steps');
  assert.deepEqual(all.baseline.weeks, ['2024-03-04', '2024-03-11'], 'without since, the 2024 weeks are the baseline');
  // a kit test done since 2025 finished its practice weeks long before since
  const typing = [...['2025-01-06', '2025-01-13', '2025-01-20'].map((d) => result('typing_speed', d, 150)), ...[200, 210].map((v, i) => result('typing_speed', W[i], v))];
  const t = find(summarize({ catalog: CATALOG, asOf: '2026-12-31', since: '2026-01-05', results: typing }), 'test', 'typing_speed');
  assert.deepEqual(t.weekly.map((w) => w.value), [200, 210]);
  assert.equal(t.practiceWeeks, 0);
  assert.deepEqual(t.baseline.weeks, [W[0], W[1]]);
  // the older tests too
  const legacy = summarize({ catalog: CATALOG, asOf: '2026-12-31', since: '2026-01-05', legacyPerson: '', legacyResults: [{ date: '2024-05-06', test: 'reading', value: 180, person: '' }, { date: W[0], test: 'reading', value: 150, person: '' }] });
  assert.deepEqual(find(legacy, 'test', 'reading').weekly.map((w) => w.value), [150]);
  // nothing from since on: no row; a since that is not a date is ignored
  assert.equal(find(summarize({ catalog: CATALOG, asOf: '2026-12-31', since: '2027-01-04', results: typing }), 'test', 'typing_speed'), undefined);
  assert.equal(find(summarize({ catalog: CATALOG, asOf: '2026-12-31', since: 'soon', samples }), 'signal', 'steps').weekly.length, 6);
});
