// Engine tests, written from the design's requirements (not from the code's output).
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  simulate, tierFromRange, detectDecline, stateAt, evaluateState, timeline, monthsSaved,
  FINDINGS, PRIOR, HOME_TESTS,
} from '../app/js/engine.js';

// A tapping decline sized from the engine's own MDC, so these tests check the rules, not the constant.
const TAP_MDC = HOME_TESTS.tap_right.placeholderMdc;
const fallingTaps = () => [50, 51, 49, 47, 48 - TAP_MDC, 47 - TAP_MDC, 46 - TAP_MDC];

const pFrom = (p0, or) => { const o = (p0 / (1 - p0)) * or; return o / (1 + o); };

test('exact arithmetic: fixed prior and a fixed odds ratio give Bayes rule exactly', () => {
  const table = { x: { or: 30, lo: 30, hi: 30 } };
  const r = simulate(['x'], { prior: { lo: 0.02, hi: 0.02 }, table, nSims: 200 });
  assert.ok(Math.abs(r.median - pFrom(0.02, 30)) < 1e-12);
  assert.ok(Math.abs(r.lo - r.hi) < 1e-12, 'no uncertainty in, no width out');
});

test('the 95% range reproduces the published 95% CI when the prior is fixed', () => {
  const f = FINDINGS.dysarthria;
  const p0 = 2e-4;
  const r = simulate(['dysarthria'], { prior: { lo: p0, hi: p0 }, nSims: 20000 });
  const expLo = pFrom(p0, f.lo);
  const expHi = pFrom(p0, f.hi);
  assert.ok(Math.abs(r.lo / expLo - 1) < 0.03, `lo ${r.lo} vs ${expLo}`);
  assert.ok(Math.abs(r.hi / expHi - 1) < 0.03, `hi ${r.hi} vs ${expHi}`);
});

test('no findings: the range is the prior range and the tier is low', () => {
  const r = simulate([]);
  assert.ok(r.lo >= PRIOR.lo * 0.999 && r.hi <= PRIOR.hi * 1.001);
  assert.equal(tierFromRange(r, 0.05), 'low');
});

test('same input and seed give the same range (reproducible)', () => {
  const a = simulate(['wasting', 'focal_weakness']);
  const b = simulate(['wasting', 'focal_weakness']);
  assert.deepEqual([a.lo, a.median, a.hi], [b.lo, b.median, b.hi]);
});

test('a finding with OR > 1 raises the estimate; the point estimate sits inside the range', () => {
  const a = simulate(['focal_weakness']);
  const b = simulate(['focal_weakness', 'wasting']);
  assert.ok(b.median > a.median);
  assert.ok(b.point >= b.lo && b.point <= b.hi);
});

test('pattern findings (no odds ratio) never change the number', () => {
  const a = simulate(['focal_weakness']);
  const b = simulate(['focal_weakness', 'split_hand']);
  assert.deepEqual([a.lo, a.median, a.hi], [b.lo, b.median, b.hi]);
});

test('tiers: whole range above the line = high, below = low, crossing = unclear', () => {
  assert.equal(tierFromRange({ lo: 0.2, hi: 0.4 }, 0.1), 'high');
  assert.equal(tierFromRange({ lo: 0.01, hi: 0.05 }, 0.1), 'low');
  assert.equal(tierFromRange({ lo: 0.05, hi: 0.2 }, 0.1), 'unclear');
});

const caseWith = (findings, extra = {}) => ({
  encounters: [{ id: 'e1', date: '2025-01-10', setting: 'GP', findings }],
  ...extra,
});

test('split-hand rule sends the patient straight to high even when the number is low', () => {
  const st = stateAt(caseWith([{ id: 'split_hand', quote: 'q' }]), '2025-01-10');
  const ev = evaluateState(st);
  assert.equal(ev.byNumber, 'low');
  assert.equal(ev.tier, 'high');
  assert.ok(ev.rulesFired.some((r) => r.id === 'split_hand'));
});

test('motor signs in two body regions trigger the spread rule', () => {
  const one = evaluateState(stateAt(caseWith([{ id: 'focal_weakness', region: 'arm', quote: 'q' }]), '2025-01-10'));
  assert.ok(!one.rulesFired.some((r) => r.id === 'multi_region'));
  const two = evaluateState(stateAt(caseWith([
    { id: 'focal_weakness', region: 'arm', quote: 'q' },
    { id: 'foot_drop', region: 'leg', quote: 'q' },
  ]), '2025-01-10'));
  assert.ok(two.rulesFired.some((r) => r.id === 'multi_region'));
  assert.equal(two.tier, 'high');
});

test('non-motor signs in other regions do not count as spread', () => {
  const ev = evaluateState(stateAt(caseWith([
    { id: 'focal_weakness', region: 'arm', quote: 'q' },
    { id: 'falls', region: 'leg', quote: 'q' },
  ]), '2025-01-10'));
  assert.ok(!ev.rulesFired.some((r) => r.id === 'multi_region'));
});

test('findings older than the 5-year window are dropped, future ones are not seen', () => {
  const cf = { encounters: [
    { id: 'old', date: '2018-01-01', findings: [{ id: 'wasting', region: 'arm', quote: 'q' }] },
    { id: 'now', date: '2025-01-10', findings: [{ id: 'cramp', region: 'leg', quote: 'q' }] },
    { id: 'later', date: '2026-01-10', findings: [{ id: 'dysarthria', quote: 'q' }] },
  ] };
  const st = stateAt(cf, '2025-01-10');
  assert.deepEqual([...st.ids].sort(), ['cramp']);
});

const series = (vals, start = '2025-01-01') => vals.map((v, i) => {
  const d = new Date(Date.parse(start + 'T00:00:00Z') + i * 7 * 86400000).toISOString().slice(0, 10);
  return { date: d, value: v };
});

test('home-test decline needs two results in a row worse than baseline by more than the MDC', () => {
  assert.equal(detectDecline(series([50, 50, 49, 41, 50, 49]), { mdc: 6 }), null, 'one dip is noise');
  assert.equal(detectDecline(series([50, 50, 46, 45, 46]), { mdc: 6 }), null, 'within normal variation');
  const d = detectDecline(series([50, 50, 48, 43, 42]), { mdc: 6 });
  assert.ok(d && d.date === series([50, 50, 48, 43, 42])[4].date);
  const w = detectDecline(series([3, 3, 3.5, 4.5, 4.6]), { mdc: 1, higherIsBetter: false });
  assert.ok(w, 'rising variability counts as worse when lower is better');
});

test('unclear tier steps down after 8 weeks of stable home tests, and escalates on decline', () => {
  const base = [{ id: 'focal_weakness', region: 'arm', quote: 'q' }, { id: 'wasting', region: 'arm', quote: 'q' }];
  const first = evaluateState(stateAt(caseWith(base), '2025-01-10'));
  assert.equal(first.tier, 'unclear', 'precondition: weakness + wasting alone is unclear at 5%');
  const stable = series([50, 51, 50, 49, 50, 51, 50, 50, 49, 50], '2025-01-10').map((p) => ({ ...p, test: 'tap_right' }));
  const tl = timeline(caseWith(base, { homeTests: stable }));
  const last = tl[tl.length - 1];
  assert.equal(last.tier, 'low');
  assert.ok(last.steppedDown);
  const falling = series(fallingTaps(), '2025-01-10').map((p) => ({ ...p, test: 'tap_right' }));
  const tl2 = timeline(caseWith(base, { homeTests: falling }));
  assert.equal(tl2[tl2.length - 1].tier, 'high', 'decline + mimic-free weakness... escalates through the number or rules');
});

test('an unclear case with a confirmed home-test decline escalates (the unclear action promises this)', () => {
  // focal weakness alone (arm) is low; add wasting so the number is unclear, then a decline.
  const base = [{ id: 'focal_weakness', region: 'arm', quote: 'q' }, { id: 'wasting', region: 'arm', quote: 'q' }];
  const falling = series(fallingTaps(), '2025-01-10').map((p) => ({ ...p, test: 'tap_right' }));
  const tl = timeline(caseWith(base, { homeTests: falling }), { referralLine: 0.2 });
  const firstDecline = tl.find((e) => e.state.homeDeclines.length > 0);
  assert.ok(firstDecline, 'precondition: a decline is detected');
  assert.equal(firstDecline.byNumber, 'unclear', 'precondition: still unclear by the number at a 20% line');
  assert.equal(firstDecline.tier, 'high');
  assert.ok(firstDecline.rulesFired.some((r) => r.id === 'unclear_with_decline'));
});

test('with home tests switched off, the 8-week rule never steps down on "no decline"', async () => {
  // Reproduction from the indicator review: 10% line, simulated off, pattern findings unticked.
  const { ALEX } = await import('../app/js/alex.js');
  const exclude = new Set(['two_territory_wasting', 'mimic_test_normal']);
  const tl = timeline(ALEX, { referralLine: 0.10, includeHomeTests: false, exclude });
  const dec = tl.find((e) => e.asOf === '2024-12-09');
  assert.equal(dec.tier, 'unclear');
  assert.ok(!dec.steppedDown);
  // With the (simulated) home tests on, the same case can use them. Alex's simulated drop (54 to 46 taps) is
  // inside the default MDC of 18, so this uses a team-measured MDC of 6 (as Team calibration would set it).
  const tlOn = timeline(ALEX, { referralLine: 0.10, includeHomeTests: true, exclude, mdc: { tap_right: 6 } });
  assert.ok(tlOn.some((e) => e.state.homeDeclines.length > 0), 'precondition: simulated decline exists');
  const tlDefault = timeline(ALEX, { referralLine: 0.10, includeHomeTests: true, exclude });
  assert.ok(!tlDefault.some((e) => e.state.homeDeclines.length > 0), 'with the default MDC, the simulated drop is normal variation');
});

test('percentages are never printed as 100% or 0%', async () => {
  const { formatPct } = await import('../app/js/engine.js');
  assert.equal(formatPct(0.9999), '>99%');
  assert.equal(formatPct(0.000001), '<0.001%');
  assert.equal(formatPct(0.052), '5.2%');
});

test('the fair gain compares the tool referral with the real referral, not the later specialist visit', async () => {
  const { ALEX } = await import('../app/js/alex.js');
  for (const line of [0.10, 0.20]) {
    const m = monthsSaved(ALEX, { referralLine: line, includeHomeTests: false });
    assert.equal(m.firstHigh, '2024-12-09', `line ${line}`);
    assert.equal(m.referral, '2026-02-16');
    assert.ok(m.monthsVsReferral > 14 && m.monthsVsReferral < m.months, `vs referral ${m.monthsVsReferral} must be smaller than vs specialist ${m.months}`);
  }
});

test('on 9 Dec 2024 the trigger is wasting across two nerve territories, not the full split-hand sign', async () => {
  const { ALEX } = await import('../app/js/alex.js');
  const ev = timeline(ALEX, { referralLine: 0.2, includeHomeTests: false }).find((e) => e.asOf === '2024-12-09');
  const ids = ev.rulesFired.map((r) => r.id);
  assert.ok(ids.includes('two_territory'));
  assert.ok(!ids.includes('split_hand'), 'little-finger sparing is not recorded until June 2026');
});

test('months saved compares the first high tier with the real first specialist visit', () => {
  const cf = caseWith([{ id: 'split_hand', quote: 'q' }], { actual: { firstNeuromuscular: '2026-06-11' } });
  const m = monthsSaved(cf);
  assert.equal(m.firstHigh, '2025-01-10');
  assert.ok(m.months > 16 && m.months < 18);
});
