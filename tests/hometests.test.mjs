// Home-test maths, checked against values worked out by hand (not from the code's output).
// Run: node --test "tests/*.test.mjs"
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mean, variance, sd, cv, pooledSd, mdc95, intervals, tapStats, countWords, wordsPerMinute,
  localDate, calibrationSummary, weeklySeries, toCsv, PASSAGE,
} from '../app/js/hometests.js';

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) < tol, `${a} vs ${b}`);

test('mean, sample variance and SD', () => {
  // 2,4,4,4,5,5,7,9: mean 5, sum of squares 32, sample variance 32/7
  const xs = [2, 4, 4, 4, 5, 5, 7, 9];
  close(mean(xs), 5);
  close(variance(xs), 32 / 7);
  close(sd(xs), Math.sqrt(32 / 7));
  assert.ok(Number.isNaN(sd([3])), 'one trial has no spread');
  assert.ok(Number.isNaN(mean([])));
});

test('CV is SD as a percentage of the mean', () => {
  close(cv([90, 100, 110]), 10); // SD 10, mean 100
  close(cv([200, 200, 200]), 0);
});

test('pooled within-person SD is the square root of the mean of the variances', () => {
  // [1,2,3] variance 1; [2,4,6] variance 4; mean 2.5
  close(pooledSd([[1, 2, 3], [2, 4, 6]]), Math.sqrt(2.5));
  // a person with one trial is left out, not counted as zero spread
  close(pooledSd([[1, 2, 3], [50]]), 1);
  assert.ok(Number.isNaN(pooledSd([[7]])));
});

test('MDC95 = 1.96 x sqrt(2) x pooled SD', () => {
  close(mdc95(1), 1.96 * Math.SQRT2);
  close(mdc95(2.5), 2.5 * 2.7718585822512662, 1e-12);
});

test('tap stats: intervals, mean gap and rhythm CV', () => {
  assert.deepEqual(intervals([0, 100, 250]), [100, 150]);
  const even = tapStats([0, 200, 400, 600, 800]);
  assert.equal(even.taps, 5);
  close(even.meanIntervalMs, 200);
  close(even.cvPct, 0);
  const uneven = tapStats([0, 90, 200, 310]); // gaps 90, 110, 110: mean 103.33
  const m = 310 / 3;
  const s = Math.sqrt(((90 - m) ** 2 + 2 * (110 - m) ** 2) / 2);
  close(uneven.cvPct, (s / m) * 100);
  assert.ok(Number.isNaN(tapStats([5]).meanIntervalMs), 'one tap has no gap');
});

test('reading rate: words per minute', () => {
  close(wordsPerMinute(100, 30000), 200);
  close(wordsPerMinute(110, 60000), 110);
  assert.ok(Number.isNaN(wordsPerMinute(100, 0)));
  assert.equal(countWords('  one two\nthree  '), 3);
  const n = countWords(PASSAGE);
  assert.ok(n >= 95 && n <= 110, `passage should be about 100 words, is ${n}`);
});

test('local date is the calendar date where the test is done, not UTC', () => {
  assert.equal(localDate(new Date(2026, 10, 7, 23, 30)), '2026-11-07');
  assert.equal(localDate(new Date(2026, 0, 5, 0, 5)), '2026-01-05');
});

test('calibration summary: per person, pooled, MDC; ignores weekly results and other tests', () => {
  const R = (person, value, extra = {}) => ({ date: '2026-11-07', test: 'tap_right', value, person, calibration: true, ...extra });
  const results = [
    R('A', 50), R('A', 52), R('A', 54), // variance 4
    R('B', 40), R('B', 41), R('B', 42), // variance 1
    R('C', 60), // one trial: left out of the pooled SD
    R('A', 10, { calibration: false }), // weekly result: ignored
    R('B', 99, { test: 'tap_left' }), // another test: ignored
  ];
  const s = calibrationSummary(results, 'tap_right');
  assert.equal(s.people.length, 3);
  assert.equal(s.nTrials, 7);
  assert.equal(s.nUsable, 2);
  const a = s.people.find((p) => p.person === 'A');
  close(a.mean, 52);
  close(a.sd, 2);
  close(s.pooledSd, Math.sqrt(2.5));
  close(s.mdc, 1.96 * Math.SQRT2 * Math.sqrt(2.5));
  const empty = calibrationSummary([], 'reading');
  assert.equal(empty.nTrials, 0);
  assert.ok(Number.isNaN(empty.mdc), 'no trials: no MDC, never a made-up one');
});

test('weekly series: one value per date, this person only, calibration left out', () => {
  const W = (date, value, extra = {}) => ({ date, test: 'reading', value, person: 'Sam', calibration: false, ...extra });
  const series = weeklySeries([
    W('2026-11-14', 150), W('2026-11-07', 160), W('2026-11-07', 170),
    W('2026-11-07', 999, { calibration: true }), W('2026-11-07', 5, { person: 'Kim' }),
  ], 'reading', 'Sam');
  assert.deepEqual(series, [{ date: '2026-11-07', value: 165, n: 2 }, { date: '2026-11-14', value: 150, n: 1 }]);
});

test('CSV: header, quoting and formula-safe names', () => {
  const csv = toCsv([{ a: 'x,y', b: 'say "hi"', c: 3.5 }, { a: '=SUM(A1)', b: null, c: NaN }], ['a', 'b', 'c']);
  assert.equal(csv, 'a,b,c\r\n"x,y","say ""hi""",3.5\r\n\'=SUM(A1),,\r\n');
});
