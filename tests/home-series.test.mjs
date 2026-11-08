// Weekly values and the decline rule (app/js/home/series.js), checked against values
// worked out by hand and against detectDecline in app/js/engine.js (read-only).
// Run: node --test "tests/home-series.test.mjs"
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calendarDate, weekStart, toDaily, toWeekly, baseline, assessDecline, slopePerMonth, percentChange,
} from '../app/js/home/series.js';
import { detectDecline } from '../app/js/engine.js';

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) < tol, `${a} vs ${b}`);

// Mondays from 5 January 2026 (a Monday), one week apart, counted by hand.
const W = ['2026-01-05', '2026-01-12', '2026-01-19', '2026-01-26', '2026-02-02', '2026-02-09', '2026-02-16', '2026-02-23'];
const weeks = (values) => values.map((value, i) => ({ week: W[i], value, n: 1 }));
const MDC = 2; // an example size for these tests, not a clinical number

// ---------- dates ----------
test('weekStart gives the Monday of the week, weeks running Monday to Sunday', () => {
  assert.equal(weekStart('2026-11-08'), '2026-11-02'); // a Sunday belongs to the week before
  assert.equal(weekStart('2026-11-02'), '2026-11-02'); // a Monday starts its own week
  assert.equal(weekStart('2026-11-04'), '2026-11-02');
  assert.equal(weekStart('2026-11-09'), '2026-11-09');
  assert.equal(weekStart('2027-01-01'), '2026-12-28'); // a Friday, across the new year
  assert.equal(weekStart('2028-02-29'), '2028-02-28'); // a leap day (Tuesday)
  assert.equal(weekStart('2028-03-05'), '2028-02-28'); // a Sunday, back across 29 February
});

test('weekStart reads the date written in an ISO time, with no time-zone shift', () => {
  assert.equal(weekStart('2026-11-08T23:30:00-05:00'), '2026-11-02'); // Sunday evening in Toronto
  assert.equal(weekStart('2026-11-09T04:30:00Z'), '2026-11-09'); // the same moment, written in UTC
  assert.equal(weekStart('2026-11-08T23:59'), '2026-11-02');
  assert.equal(weekStart('2026-11-08T10:00:00.123Z'), '2026-11-02');
});

test('weekStart takes a Date in local time', () => {
  // Just after midnight and just before it: in any zone but UTC one of them is on
  // another date in UTC, so reading the Date in UTC would show up here.
  assert.equal(weekStart(new Date(2026, 10, 8, 0, 30)), '2026-11-02');
  assert.equal(weekStart(new Date(2026, 10, 8, 23, 30)), '2026-11-02');
  assert.equal(weekStart(new Date(2026, 10, 9, 0, 0)), '2026-11-09');
});

test('weekStart gives null for anything that is not a real date', () => {
  const bad = ['2026-02-29', '2026-02-30', '2026-13-01', '2026-00-10', '2026-11-8', '11/08/2026', '2026-11-08 10:00',
    '2026-11-08T25:00', '2026-11-08T10:61', '', 'soon', null, undefined, 20261108, NaN, {}, new Date('nope'),
    '0026-01-05']; // a year below 1000 is a typo here (Date.UTC would read it as 1926)
  for (const x of bad) assert.equal(weekStart(x), null, String(x));
});

test('calendarDate is the date as written, or a Date in local time', () => {
  assert.equal(calendarDate('2026-11-08'), '2026-11-08');
  assert.equal(calendarDate('2026-11-08T23:30:00-05:00'), '2026-11-08');
  assert.equal(calendarDate('2026-11-08T00:30:00+14:00'), '2026-11-08');
  assert.equal(calendarDate(new Date(2026, 10, 8, 0, 30)), '2026-11-08');
  assert.equal(calendarDate(new Date(2026, 10, 8, 23, 59)), '2026-11-08');
  assert.equal(calendarDate('2026-11-31'), null);
});

// ---------- daily and weekly values ----------
// 2 November: 4 at 08:00, 10 at 12:00, 1 at 20:00. 3 November: 8 at 07:00, 2 at 09:00.
// Given out of order. 20:00 in Toronto is already 3 November in UTC; it stays on the 2nd.
const RAW = [
  { start: '2026-11-03T07:00:00-05:00', value: 8 },
  { start: '2026-11-02T20:00:00-05:00', value: 1 },
  { start: '2026-11-02T08:00:00-05:00', value: 4 },
  { start: '2026-11-03T09:00:00-05:00', value: 2 },
  { start: '2026-11-02T12:00:00-05:00', value: 10 },
];

test('toDaily reduces each calendar day, sorted by date', () => {
  const by = (reduce) => toDaily(RAW, { reduce }).map((d) => [d.date, d.value, d.n]);
  assert.deepEqual(by('median'), [['2026-11-02', 4, 3], ['2026-11-03', 5, 2]]);
  assert.deepEqual(by('mean'), [['2026-11-02', 5, 3], ['2026-11-03', 5, 2]]);
  assert.deepEqual(by('sum'), [['2026-11-02', 15, 3], ['2026-11-03', 10, 2]]);
  assert.deepEqual(by('min'), [['2026-11-02', 1, 3], ['2026-11-03', 2, 2]]);
  assert.deepEqual(by('max'), [['2026-11-02', 10, 3], ['2026-11-03', 8, 2]]);
  assert.deepEqual(by('last'), [['2026-11-02', 1, 3], ['2026-11-03', 2, 2]]); // latest time of day
  assert.deepEqual(toDaily(RAW, { reduce: 'sum' }), [{ date: '2026-11-02', value: 15, n: 3 }, { date: '2026-11-03', value: 10, n: 2 }]);
});

test('toDaily skips values that are not finite numbers and rows without a real date', () => {
  const pts = [
    { date: '2026-11-02', value: 3 },
    { date: '2026-11-02', value: NaN }, { date: '2026-11-02', value: Infinity }, { date: '2026-11-02', value: -Infinity },
    { date: '2026-11-02', value: '7' }, { date: '2026-11-02', value: null }, { date: '2026-11-02' },
    { value: 5 }, { date: 'yesterday', value: 5 }, { date: '2026-02-30', value: 5 }, { date: 20261102, value: 5 },
    null, undefined, 42, 'x',
    { start: '2026-11-02T09:00:00Z', value: 5 },
    { date: null, start: '2026-11-02', value: 1 },
  ];
  assert.deepEqual(toDaily(pts, { reduce: 'sum' }), [{ date: '2026-11-02', value: 9, n: 3 }]);
});

test('no usable points gives an empty list; one point is its own day', () => {
  assert.deepEqual(toDaily([], { reduce: 'mean' }), []);
  assert.deepEqual(toDaily([{ date: '2026-11-02', value: NaN }], { reduce: 'mean' }), []);
  for (const notList of [null, undefined, 'abc', {}, 5]) assert.deepEqual(toDaily(notList, { reduce: 'mean' }), []);
  assert.deepEqual(toWeekly([]), []);
  assert.deepEqual(toDaily([{ date: '2026-11-02', value: 7 }], { reduce: 'median' }), [{ date: '2026-11-02', value: 7, n: 1 }]);
});

test('reduce defaults to median; an unknown reduce is an error, not a silent guess', () => {
  assert.deepEqual(toDaily(RAW), toDaily(RAW, { reduce: 'median' }));
  assert.throws(() => toDaily(RAW, { reduce: 'average' }), RangeError);
  assert.throws(() => toWeekly(RAW, { reduce: 'avg' }), RangeError);
});

test('min and max work on very long lists (too many values for Math.min(...values))', () => {
  // 7919 shares no factor with 1000, so i * 7919 mod 1000 runs through 0 to 999
  const big = Array.from({ length: 300000 }, (_, i) => ({ date: '2026-11-02', value: (i * 7919) % 1000 }));
  assert.equal(toDaily(big, { reduce: 'min' })[0].value, 0);
  assert.equal(toDaily(big, { reduce: 'max' })[0].value, 999);
});

test("'last' keeps the order given when two points share a time", () => {
  const pts = [{ date: '2026-11-02', value: 1 }, { date: '2026-11-02', value: 2 }];
  assert.equal(toDaily(pts, { reduce: 'last' })[0].value, 2);
});

test('toWeekly groups Monday to Sunday, defaults to the median, and drops thin weeks', () => {
  const pts = [
    { date: '2026-11-08', value: 8 }, // Sunday: still the week of 2 November
    { date: '2026-11-01', value: 10 }, // Sunday: the week of 26 October
    { date: '2026-11-02', value: 1 }, // Monday
    { date: '2026-11-09', value: 6 }, // the next Monday
    { date: '2026-11-04', value: 3 },
  ];
  assert.deepEqual(toWeekly(pts), [
    { week: '2026-10-26', value: 10, n: 1 },
    { week: '2026-11-02', value: 3, n: 3 },
    { week: '2026-11-09', value: 6, n: 1 },
  ]);
  assert.equal(toWeekly(pts, { reduce: 'mean' })[1].value, 4);
  assert.deepEqual(toWeekly(pts, { minPerWeek: 2 }), [{ week: '2026-11-02', value: 3, n: 3 }]);
  assert.deepEqual(toWeekly(pts, { minPerWeek: 4 }), []);
  assert.throws(() => toWeekly(pts, { minPerWeek: '2' }), RangeError);
  assert.throws(() => toWeekly(pts, { minPerWeek: NaN }), RangeError);
});

test('daily totals, then the weekly median of those totals', () => {
  // Steps come in parts of a day: the day is a sum, the week a median of days.
  const raw = [
    { start: '2026-11-02T09:00:00-05:00', value: 3000 }, { start: '2026-11-02T18:00:00-05:00', value: 2000 }, // Mon 5000
    { start: '2026-11-03T12:00:00-05:00', value: 7000 }, // Tue 7000
    { start: '2026-11-05T10:00:00-05:00', value: 1000 }, { start: '2026-11-05T11:00:00-05:00', value: 2000 }, // Thu 3000
  ];
  const daily = toDaily(raw, { reduce: 'sum' });
  assert.deepEqual(daily.map((d) => d.value), [5000, 7000, 3000]);
  assert.deepEqual(toWeekly(daily, { reduce: 'median', minPerWeek: 3 }), [{ week: '2026-11-02', value: 5000, n: 3 }]);
});

// ---------- baseline ----------
test('baseline is the mean of the first weeks after the practice weeks', () => {
  const w = weeks([10, 12, 20, 30]);
  assert.deepEqual(baseline(w), { value: 11, weeks: [W[0], W[1]] });
  assert.deepEqual(baseline(w, { practiceWeeks: 1 }), { value: 16, weeks: [W[1], W[2]] });
  assert.deepEqual(baseline(w, { practiceWeeks: 1, baselineWeeks: 3 }), { value: 62 / 3, weeks: [W[1], W[2], W[3]] });
  assert.deepEqual(baseline(w, { baselineWeeks: 1 }), { value: 10, weeks: [W[0]] });
});

test('baseline is null until there are enough weeks', () => {
  assert.equal(baseline([]), null);
  assert.equal(baseline(null), null);
  assert.equal(baseline(weeks([10])), null);
  assert.equal(baseline(weeks([10, 12, 20]), { practiceWeeks: 2 }), null);
});

test('baseline sorts by week and skips malformed weeks', () => {
  const w = [{ week: W[2], value: 20 }, { week: 'bad', value: 1 }, { week: W[1], value: NaN }, null, { week: W[0], value: 10 }, { week: W[1], value: 12 }];
  assert.deepEqual(baseline(w), { value: 11, weeks: [W[0], W[1]] });
});

test('baseline options must be whole numbers', () => {
  assert.throws(() => baseline(weeks([1, 2, 3]), { baselineWeeks: 0 }), RangeError);
  assert.throws(() => baseline(weeks([1, 2, 3]), { practiceWeeks: -1 }), RangeError);
  assert.throws(() => baseline(weeks([1, 2, 3]), { practiceWeeks: 1.5 }), RangeError);
});

// ---------- decline ----------
test('no usable weeks: no-data', () => {
  assert.deepEqual(assessDecline([], { mdc: MDC }), {
    status: 'no-data', baseline: null, latest: null, change: null, worse: null, mdc: MDC, firstDecline: null, current: false,
  });
  assert.equal(assessDecline([{ week: W[0], value: NaN }], { mdc: MDC }).status, 'no-data');
  assert.equal(assessDecline(undefined, { mdc: MDC }).status, 'no-data');
});

test('fewer than practice + baseline + consecutive weeks: still building the baseline', () => {
  const one = assessDecline(weeks([10]), { mdc: MDC });
  assert.equal(one.status, 'baseline');
  assert.equal(one.latest, 10);
  assert.equal(one.baseline, null);
  const three = assessDecline(weeks([10, 10, 5]), { mdc: MDC }); // needs 2 + 2 = 4 weeks
  assert.equal(three.status, 'baseline');
  assert.equal(three.baseline, 10);
  assert.equal(three.latest, 5);
  assert.equal(three.change, -5);
  assert.equal(three.worse, 5);
  assert.equal(three.firstDecline, null);
  assert.equal(three.current, false);
  // the latest week is still a baseline week: no change to report yet
  assert.equal(assessDecline(weeks([10, 12]), { mdc: MDC }).change, null);
  assert.equal(assessDecline(weeks([20, 20, 10, 10, 5]), { mdc: MDC, practiceWeeks: 2 }).status, 'baseline'); // needs 6
});

test('a drop exactly at the MDC is not a decline; only a drop by more than the MDC counts', () => {
  // baseline 10, MDC 2: 8 is exactly 2 worse (not enough), 7.5 is 2.5 worse (beyond)
  const at = assessDecline(weeks([10, 10, 8, 8]), { mdc: MDC });
  assert.equal(at.status, 'stable');
  assert.equal(at.firstDecline, null);
  assert.equal(at.current, false);
  assert.deepEqual(assessDecline(weeks([10, 10, 7.5, 7.5]), { mdc: MDC }), {
    status: 'decline', baseline: 10, latest: 7.5, change: -2.5, worse: 2.5, mdc: MDC, firstDecline: { week: W[3], value: 7.5 }, current: true,
  });
});

test('one week beyond the MDC is "once"; two in a row is a decline', () => {
  const once = assessDecline(weeks([10, 10, 9, 7]), { mdc: MDC });
  assert.equal(once.status, 'once');
  assert.equal(once.current, false);
  assert.equal(once.firstDecline, null);
  // single bad weeks that never follow each other never confirm a decline
  assert.equal(assessDecline(weeks([10, 10, 7, 9, 7, 9]), { mdc: MDC }).firstDecline, null);
});

test('firstDecline is kept after a recovery; status follows the latest weeks', () => {
  const recovered = assessDecline(weeks([10, 10, 7, 7, 10, 10]), { mdc: MDC });
  assert.equal(recovered.status, 'stable');
  assert.equal(recovered.current, false);
  assert.deepEqual(recovered.firstDecline, { week: W[3], value: 7 });
  const again = assessDecline(weeks([10, 10, 7, 7, 10, 7]), { mdc: MDC });
  assert.equal(again.status, 'once');
  assert.deepEqual(again.firstDecline, { week: W[3], value: 7 });
  const later = assessDecline(weeks([10, 10, 7, 7, 10, 7, 6]), { mdc: MDC });
  assert.equal(later.status, 'decline');
  assert.equal(later.current, true);
  assert.deepEqual(later.firstDecline, { week: W[3], value: 7 }); // the first run, not the latest
});

test('when lower is better, a rise is the decline, and an improvement never is', () => {
  // seconds for five chair stands: baseline 5, MDC 2
  assert.equal(assessDecline(weeks([5, 5, 7, 7]), { mdc: MDC, higherIsBetter: false }).status, 'stable'); // exactly +2
  const slower = assessDecline(weeks([5, 5, 7.5, 7.5]), { mdc: MDC, higherIsBetter: false });
  assert.equal(slower.status, 'decline');
  assert.equal(slower.change, 2.5);
  assert.equal(slower.worse, 2.5);
  assert.equal(assessDecline(weeks([10, 10, 13, 13]), { mdc: MDC }).status, 'stable');
  assert.equal(assessDecline(weeks([5, 5, 2, 2]), { mdc: MDC, higherIsBetter: false }).status, 'stable');
});

test('practice weeks are left out of the baseline', () => {
  // Learning the test: weeks 1-2 are low (6, 8), the usual level is 10, then it drops to 7.5.
  const values = [6, 8, 10, 10, 7.5, 7.5];
  const withPractice = assessDecline(weeks(values), { mdc: MDC, practiceWeeks: 2 });
  assert.equal(withPractice.baseline, 10);
  assert.equal(withPractice.status, 'decline');
  assert.deepEqual(withPractice.firstDecline, { week: W[5], value: 7.5 });
  // counting the learning weeks puts the baseline at 7 and hides the drop
  const without = assessDecline(weeks(values), { mdc: MDC });
  assert.equal(without.baseline, 7);
  assert.equal(without.status, 'stable');
  assert.equal(without.firstDecline, null);
});

test('consecutive sets how many weeks in a row confirm a decline', () => {
  assert.equal(assessDecline(weeks([10, 10, 7, 7]), { mdc: MDC, consecutive: 3 }).status, 'baseline'); // needs 5 weeks
  const three = assessDecline(weeks([10, 10, 7, 7, 7]), { mdc: MDC, consecutive: 3 });
  assert.equal(three.status, 'decline');
  assert.deepEqual(three.firstDecline, { week: W[4], value: 7 });
  // two weeks beyond is not yet three: the latest week is beyond, the run is short
  const short = assessDecline(weeks([10, 10, 10, 7, 7]), { mdc: MDC, consecutive: 3 });
  assert.equal(short.current, false);
  assert.equal(short.firstDecline, null);
  assert.equal(short.status, 'once');
  assert.equal(assessDecline(weeks([10, 10, 7]), { mdc: MDC, consecutive: 1 }).status, 'decline');
});

test('input order does not matter, and weeks with no data are skipped', () => {
  const w = weeks([10, 10, 9, 7, 7]);
  assert.deepEqual(assessDecline([w[3], w[0], w[4], w[2], w[1]], { mdc: MDC }), assessDecline(w, { mdc: MDC }));
  // back-to-back weeks with data count as in a row, as in detectDecline
  const gappy = [{ week: '2026-01-05', value: 10 }, { week: '2026-01-12', value: 10 }, { week: '2026-02-02', value: 7 }, { week: '2026-03-02', value: 7 }];
  assert.deepEqual(assessDecline(gappy, { mdc: MDC }).firstDecline, { week: '2026-03-02', value: 7 });
});

test('malformed weeks are skipped, and { date, value } points work too', () => {
  const messy = [{ week: W[0], value: 10 }, { week: 'bad', value: 0 }, { week: W[1], value: NaN }, null, 7,
    { week: W[1], value: 10 }, { week: W[2], value: '7' }, { week: W[2], value: 7 }, { week: W[3], value: 7 }];
  const a = assessDecline(messy, { mdc: MDC });
  assert.equal(a.status, 'decline');
  assert.deepEqual(a.firstDecline, { week: W[3], value: 7 });
  const pts = [10, 10, 7, 7].map((value, i) => ({ date: W[i], value }));
  assert.deepEqual(assessDecline(pts, { mdc: MDC }).firstDecline, { week: W[3], value: 7 });
  const starts = [10, 12, 20].map((value, i) => ({ start: W[i], value }));
  assert.deepEqual(baseline(starts), { value: 11, weeks: [W[0], W[1]] });
  close(slopePerMonth(starts), ((20 - 10) / 14) * 30.4375); // 10, 12, 20 on days 0, 7, 14
});

test('with no MDC known, nothing is judged', () => {
  const a = assessDecline(weeks([10, 10, 7, 7]), { mdc: null });
  assert.equal(a.status, 'no-mdc');
  assert.equal(a.firstDecline, null);
  assert.equal(a.current, false);
  assert.equal(a.baseline, 10);
  assert.equal(a.change, -3);
  assert.equal(a.mdc, null);
  assert.equal(assessDecline(weeks([10, 10, 7, 7])).status, 'no-mdc');
  assert.equal(assessDecline([], { mdc: null }).status, 'no-data');
});

test('a broken MDC or option is an error, not a silent answer', () => {
  for (const mdc of [0, -1, NaN, Infinity, '2', { value: 2 }]) {
    assert.throws(() => assessDecline(weeks([10, 10, 7, 7]), { mdc }), RangeError, String(mdc));
  }
  assert.throws(() => assessDecline([], { mdc: 2, higherIsBetter: 'false' }), TypeError);
  assert.throws(() => assessDecline([], { mdc: 2, consecutive: 0 }), RangeError);
  assert.throws(() => assessDecline([], { mdc: 2, practiceWeeks: -1 }), RangeError);
});

// Seeded random numbers (mulberry32), so every run checks the same series.
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('firstDecline matches detectDecline in engine.js on 400 seeded series, ties at the MDC included', () => {
  const rand = seeded(20261108);
  const int = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
  const monday = (k) => new Date(Date.UTC(2026, 0, 5 + 7 * k)).toISOString().slice(0, 10);
  let ties = 0;
  let found = 0;
  let notFound = 0;
  for (let s = 0; s < 400; s++) {
    const n = int(0, 12);
    const higherIsBetter = rand() < 0.5;
    // Half the series use halves and quarters, which add exactly in binary, so a week
    // can sit exactly on baseline - MDC; the other half use any real numbers.
    const onGrid = s % 2 === 0;
    const mdc = onGrid ? int(1, 6) / 2 : 0.05 + rand() * 3;
    const series = [];
    let k = 0;
    for (let i = 0; i < n; i++) {
      series.push({ week: monday(k), value: onGrid ? 20 + int(-12, 12) / 2 : 20 + (rand() - 0.5) * 12, n: 1 });
      k += int(1, 3); // sometimes weeks with no data in between
    }
    const worse = (v, base) => (higherIsBetter ? base - v : v - base);
    if (onGrid && n >= 4) {
      const base = (series[0].value + series[1].value) / 2;
      for (let i = 2; i < n; i++) if (rand() < 0.35) series[i].value = higherIsBetter ? base - mdc : base + mdc;
    }
    const vals = series.map((w) => w.value); // in week order
    if (n >= 4) {
      const base = (vals[0] + vals[1]) / 2;
      if (vals.slice(2).some((v) => worse(v, base) === mdc)) ties += 1;
    }
    const shuffled = [...series];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    const expected = detectDecline(shuffled.map((w) => ({ date: w.week, value: w.value })), { mdc, higherIsBetter });
    const got = assessDecline(shuffled, { mdc, higherIsBetter });
    if (expected) {
      found += 1;
      assert.deepEqual(got.firstDecline, { week: expected.date, value: expected.latest }, `series ${s}`);
      assert.equal(got.baseline, expected.baseline, `series ${s}`);
    } else {
      if (n >= 4) notFound += 1;
      assert.equal(got.firstDecline, null, `series ${s}`);
    }

    // status and current from the rule as written (default options: the latest two weeks)
    let status = n === 0 ? 'no-data' : 'baseline';
    if (n >= 4) {
      const base = (vals[0] + vals[1]) / 2;
      const beyond = (v) => worse(v, base) > mdc;
      status = beyond(vals[n - 1]) && beyond(vals[n - 2]) ? 'decline' : beyond(vals[n - 1]) ? 'once' : 'stable';
    }
    assert.equal(got.status, status, `series ${s}`);
    assert.equal(got.current, status === 'decline', `series ${s}`);
  }
  // the comparison is only worth something if it covered each case often
  assert.ok(ties >= 40, `only ${ties} series had a week exactly at the MDC`);
  assert.ok(found >= 40, `only ${found} series had a decline`);
  assert.ok(notFound >= 40, `only ${notFound} series of 4 or more weeks had no decline`);
});

// ---------- trend ----------
test('slopePerMonth is the least-squares slope per 30.4375 days', () => {
  close(slopePerMonth(weeks([0, 7, 14, 21])), 30.4375); // +7 a week is +1 a day
  close(slopePerMonth(weeks([1.0, 0.9, 0.8, 0.7, 0.6])), (-0.1 / 7) * 30.4375);
  // 1, 3, 2 on days 0, 7, 14: means 7 and 2, slope (7 + 0 + 0) / (49 + 0 + 49) = 1/14 a day
  close(slopePerMonth(weeks([1, 3, 2])), 30.4375 / 14);
  const w = weeks([1, 3, 2]);
  close(slopePerMonth([w[2], w[0], w[1]]), 30.4375 / 14);
  // a missed week stretches the time axis: days 0, 7 and 28, +1 a day
  close(slopePerMonth([{ week: W[0], value: 0 }, { week: W[1], value: 7 }, { week: W[4], value: 28 }]), 30.4375);
});

test('slopePerMonth needs 3 usable points on at least two dates', () => {
  assert.equal(slopePerMonth([]), null);
  assert.equal(slopePerMonth(null), null);
  assert.equal(slopePerMonth(weeks([5])), null);
  assert.equal(slopePerMonth(weeks([5, 6])), null);
  assert.equal(slopePerMonth([...weeks([5, 6]), { week: W[2], value: NaN }]), null);
  assert.equal(slopePerMonth([{ week: W[0], value: 1 }, { week: W[0], value: 2 }, { week: W[0], value: 3 }]), null);
});

test('percentChange is percent of the starting value; null when that cannot be worked out', () => {
  close(percentChange(10, 12), 20);
  close(percentChange(10, 8), -20);
  assert.equal(percentChange(50, 50), 0);
  close(percentChange(-10, -5), 50); // a rise is positive even from a negative start
  for (const [a, b] of [[0, 5], [NaN, 5], [Infinity, 5], [5, NaN], [5, -Infinity], ['10', 12], [10, '12'], [null, 1], [undefined, 1]]) {
    assert.equal(percentChange(a, b), null, `${a} -> ${b}`);
  }
  // a start so near 0 (or a gap so wide) that the percent overflows has no percent either
  for (const [a, b] of [[5e-324, 1], [1e-300, 1e300], [-Number.MAX_VALUE, Number.MAX_VALUE]]) {
    assert.equal(percentChange(a, b), null, `${a} -> ${b}`);
  }
});
