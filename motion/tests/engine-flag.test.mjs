// The walking-speed decline against the real engine (app/js/engine.js, not mocked):
// a saved gait_speed series becomes a leg home_decline and fires the engine's rules.
// Run: node --test "motion/tests/*.test.mjs" from the project folder.
import test from 'node:test';
import assert from 'node:assert/strict';
import { HOME_TESTS, RULES, stateAt, evaluateState } from '../../app/js/engine.js';
import { GAIT_TEST_ID, GAIT_MDC, ensureGaitTest, makeRow, gaitSeries } from '../web/flag.js';

ensureGaitTest(HOME_TESTS); // what receive.js does at load (a no-op after the merge)

const AS_OF = '2026-11-08';
// Saved rows (via makeRow) -> weekly series (gaitSeries) -> the engine's homeTests shape.
function homeTestsFrom(values, start = '2026-10-04') {
  const results = [];
  values.forEach((v, i) => {
    const date = new Date(Date.parse(`${start}T00:00:00Z`) + i * 7 * 86400000).toISOString().slice(0, 10);
    const r = makeRow({ id: `w-eng-${i}`, result: { ok: true, speed_mps: v, quality: 'good', timing: 'motion', steps: 14, cadence_spm: 105, distance_m: 10 } },
      { date, time: '09:00', person: '', results, today: AS_OF });
    assert.ok(r, 'row saved');
    results.push(r);
  });
  return gaitSeries(results, '').map((p) => ({ date: p.date, test: GAIT_TEST_ID, value: p.value }));
}
const visit = (findings, date = '2026-09-15') => ({ id: 'gp1', date, setting: 'Family doctor', findings });
const fired = (ev) => ev.rulesFired.map((r) => r.id);
const DECLINING = [1.32, 1.30, 0.88, 0.85]; // drops of about 0.43 and 0.46: beyond 0.28 and 0.18
const FLAT = [1.30, 1.28, 1.31, 1.29, 1.30];

test('the rules this page explains exist in the engine', () => {
  const ids = RULES.map((r) => r.id);
  assert.ok(ids.includes('unclear_with_decline'));
  assert.ok(ids.includes('multi_region'));
  assert.ok(HOME_TESTS[GAIT_TEST_ID], 'gait_speed is in the engine test list');
});

test('arm wasting plus a walking-speed decline: leg home_decline and multi_region', () => {
  const caseFile = { encounters: [visit([{ id: 'wasting', region: 'arm', quote: 'wasting of the right thumb muscles' }])], homeTests: homeTestsFrom(DECLINING) };
  const st = stateAt(caseFile, AS_OF);
  assert.equal(st.homeDeclines.length, 1);
  const d = st.homeDeclines[0];
  assert.equal(d.id, 'home_decline');
  assert.equal(d.test, GAIT_TEST_ID);
  assert.equal(d.region, 'leg');
  assert.equal(d.date, '2026-10-25');
  assert.ok(st.ids.has('home_decline'));
  assert.deepEqual([...st.motorRegions].sort(), ['arm', 'leg']);
  const ev = evaluateState(st);
  assert.ok(fired(ev).includes('multi_region'), `fired: ${fired(ev).join(', ')}`);
  assert.equal(ev.tier, 'high');

  // One week earlier there is only one low week: no decline yet, so no second region.
  const before = evaluateState(stateAt(caseFile, '2026-10-18'));
  assert.equal(before.state.homeDeclines.length, 0);
  assert.equal(fired(before).includes('multi_region'), false);
});

test('a flat walking series gives no home_decline', () => {
  const caseFile = { encounters: [visit([{ id: 'wasting', region: 'arm', quote: 'wasting of the right thumb muscles' }])], homeTests: homeTestsFrom(FLAT) };
  const st = stateAt(caseFile, AS_OF);
  assert.equal(st.homeDeclines.length, 0);
  assert.equal(st.ids.has('home_decline'), false);
  assert.deepEqual([...st.motorRegions], ['arm']);
  const ev = evaluateState(st);
  assert.equal(fired(ev).includes('multi_region'), false);
  assert.equal(fired(ev).includes('unclear_with_decline'), false);
});

test('an unclear-by-number leg case plus a walking decline fires unclear_with_decline', () => {
  // Found by trying combinations against the engine: foot drop with leg weakness has a
  // likelihood range that crosses the 5% line, with or without the home decline.
  const findings = [
    { id: 'foot_drop', region: 'leg', quote: 'right foot catching on stairs' },
    { id: 'focal_weakness', region: 'leg', quote: 'weak right ankle lift' },
  ];
  const noTests = evaluateState(stateAt({ encounters: [visit(findings)], homeTests: [] }, AS_OF));
  assert.equal(noTests.byNumber, 'unclear', 'the case is unclear by number before the walks');
  assert.equal(noTests.rulesFired.length, 0);

  const caseFile = { encounters: [visit(findings)], homeTests: homeTestsFrom(DECLINING) };
  const st = stateAt(caseFile, AS_OF);
  assert.equal(st.homeDeclines.length, 1);
  assert.equal(st.homeDeclines[0].region, 'leg');
  const ev = evaluateState(st);
  assert.equal(ev.byNumber, 'unclear', 'still unclear by number with the decline counted');
  assert.ok(fired(ev).includes('unclear_with_decline'), `fired: ${fired(ev).join(', ')}`);
  assert.equal(fired(ev).includes('multi_region'), false, 'all motor signs are in the leg');
  assert.equal(ev.tier, 'high');

  const flat = evaluateState(stateAt({ encounters: [visit(findings)], homeTests: homeTestsFrom(FLAT) }, AS_OF));
  assert.equal(flat.tier, 'unclear');
  assert.equal(flat.rulesFired.length, 0);
});

test('the diagnosed MDC (0.18) passed as opts.mdc catches a smaller drop than the 0.28 placeholder', () => {
  const findings = [{ id: 'wasting', region: 'arm', quote: 'wasting of the right thumb muscles' }];
  const caseFile = { encounters: [visit(findings)], homeTests: homeTestsFrom([1.30, 1.30, 1.07, 1.06]) }; // drops 0.23, 0.24
  assert.equal(stateAt(caseFile, AS_OF, { mdc: { [GAIT_TEST_ID]: GAIT_MDC.prediagnosis } }).homeDeclines.length, 0);
  const st = stateAt(caseFile, AS_OF, { mdc: { [GAIT_TEST_ID]: GAIT_MDC.diagnosed } });
  assert.equal(st.homeDeclines.length, 1);
  // 0.2 before the merge; 0.18 after it, because the merge patch makes the engine keep 2
  // decimals below 10 (review INT-4). Both are the same diagnosed MDC.
  assert.match(st.homeDeclines[0].quote, /normal variation ±0\.(?:18|2), measured/);
});
