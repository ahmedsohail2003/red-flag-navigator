// simulate() keeps a memo for the default prior and table. These tests pin what the memo must never change:
// the numbers (same as an uncached run), the effect of the ids' order, and callers' copies.
import test from 'node:test';
import assert from 'node:assert/strict';
import { simulate, FINDINGS } from '../app/js/engine.js';

// The same values in a different table object: simulate() then skips the memo and computes afresh.
const uncached = (ids, opts = {}) => simulate(ids, { ...opts, table: { ...FINDINGS } });
const weighted = Object.keys(FINDINGS).filter((id) => FINDINGS[id].or != null);

test('memo: cached results equal fresh ones for many finding sets, orders and seeds', () => {
  let s = 7;
  const rand = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  for (let i = 0; i < 60; i++) {
    const n = 1 + Math.floor(rand() * 5);
    const ids = Array.from({ length: n }, () => weighted[Math.floor(rand() * weighted.length)]);
    const opts = i % 3 === 0 ? { seed: 42 + i, nSims: 800 } : {};
    const first = simulate(ids, opts);
    const again = simulate(ids, opts); // from the memo
    const fresh = uncached(ids, opts);
    assert.deepEqual(again, first);
    assert.deepEqual(first, fresh);
  }
});

test('memo: the order of the ids still decides the draws, as it did before the memo', () => {
  const ab = ['wasting', 'focal_weakness', 'cramp'];
  const ba = ['cramp', 'focal_weakness', 'wasting'];
  simulate(ba); // fill the memo with the other order first
  assert.deepEqual(simulate(ab), uncached(ab));
  assert.deepEqual(simulate(ba), uncached(ba));
});

test('memo: a caller changing its result cannot change what the next caller gets', () => {
  const ids = ['wasting', 'focal_weakness'];
  const a = simulate(ids);
  const keep = { ...a, ids: [...a.ids] };
  a.lo = 999;
  a.ids.push('fasciculations');
  assert.deepEqual(simulate(ids), keep);
});

test('memo: another prior is never served from the memo', () => {
  const ids = ['wasting'];
  const base = simulate(ids);
  const other = simulate(ids, { prior: { lo: 1e-3, hi: 3e-3 } });
  assert.ok(other.lo > base.lo, 'a ten times higher prior gives a higher range');
});
