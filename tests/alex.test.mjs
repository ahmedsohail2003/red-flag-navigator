// Guards against "hallucinated" findings: every quote must appear word for word in
// its note, every finding id must exist in the weights table, and dates must be in order.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ALEX } from '../app/js/alex.js';
import { FINDINGS, HOME_TESTS } from '../app/js/engine.js';

test('every finding and negative quotes its note word for word', () => {
  for (const e of ALEX.encounters) {
    assert.ok(e.note && e.note.length > 50, `${e.id} has a note`);
    for (const f of [...e.findings, ...(e.negatives || [])]) {
      assert.ok(e.note.includes(f.quote), `${e.id}: quote not found in note: "${f.quote}"`);
    }
  }
});

test('every finding id exists in the weights table, with a body region', () => {
  for (const e of ALEX.encounters) {
    for (const f of e.findings) {
      assert.ok(FINDINGS[f.id], `${e.id}: unknown finding id ${f.id}`);
      assert.ok(f.region, `${e.id}: ${f.id} has no region`);
    }
  }
});

test('encounters are in date order with unique ids; home tests are labelled simulated', () => {
  const dates = ALEX.encounters.map((e) => e.date);
  assert.deepEqual(dates, [...dates].sort());
  assert.equal(new Set(ALEX.encounters.map((e) => e.id)).size, ALEX.encounters.length);
  for (const h of ALEX.homeTests) {
    assert.equal(h.simulated, true);
    assert.ok(HOME_TESTS[h.test], `unknown home test ${h.test}`);
  }
});
