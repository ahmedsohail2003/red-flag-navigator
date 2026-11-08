// Context flags (e.g. surgery for a look-alike that did not help) are shown, never scored:
// they must not change the range, the tier, the rules or the spread-to-a-region count.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ALEX } from '../app/js/alex.js';
import { FINDINGS, RULES, timeline, simulate } from '../app/js/engine.js';

const CONTEXT = Object.keys(FINDINGS).filter((id) => FINDINGS[id].contextOnly);

test('context flags exist, carry a source and a reason, and have no weight', () => {
  assert.ok(CONTEXT.includes('lookalike_surgery'));
  for (const id of CONTEXT) {
    const f = FINDINGS[id];
    assert.equal(f.or, null);
    assert.equal(f.motor, false);
    assert.ok(f.source && f.why);
  }
});

test('the number ignores context flags', () => {
  const base = simulate(['focal_weakness', 'wasting']);
  const withFlag = simulate(['focal_weakness', 'wasting', ...CONTEXT]);
  assert.deepEqual([withFlag.lo, withFlag.median, withFlag.hi], [base.lo, base.median, base.hi]);
});

test("Alex's replay is identical with and without the context flag, at every line", () => {
  for (const line of [0.03, 0.05, 0.10, 0.20]) {
    for (const includeHomeTests of [false, true]) {
      const a = timeline(ALEX, { referralLine: line, includeHomeTests });
      const b = timeline(ALEX, { referralLine: line, includeHomeTests, exclude: new Set(CONTEXT) });
      assert.deepEqual(a.map((e) => [e.asOf, e.tier, e.rulesFired.map((r) => r.id).join()]), b.map((e) => [e.asOf, e.tier, e.rulesFired.map((r) => r.id).join()]), `line ${line}`);
    }
  }
});

test('no rule fires on a context flag alone', () => {
  const st = { ids: new Set(CONTEXT), motorRegions: new Set(), homeDeclines: [] };
  for (const r of RULES) assert.equal(r.test(st, { byNumber: 'low' }), false, r.id);
});

test('the flag appears in Alex\'s replay from the April 2025 follow-up', () => {
  const tl = timeline(ALEX, { referralLine: 0.05, includeHomeTests: false });
  const apr = tl.find((e) => e.asOf === '2025-04-21');
  assert.ok(apr.state.instances.some((i) => i.id === 'lookalike_surgery'));
  const dec = tl.find((e) => e.asOf === '2024-12-09');
  assert.ok(!dec.state.instances.some((i) => i.id === 'lookalike_surgery'));
});
