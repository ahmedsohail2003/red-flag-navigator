// Benign look-alike presentations must not trigger an EMG referral on their own
// (expectations written before running the scorer; see app/js/lookalikes.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { LOOKALIKES } from '../app/js/lookalikes.js';
import { evaluateAt, formatPct } from '../app/js/engine.js';

for (const v of LOOKALIKES.filter((x) => x.expect === 'not-high')) {
  test(`look-alike "${v.title}" is not escalated at the default line`, () => {
    const ev = evaluateAt(v.caseFile, '2025-01-15');
    assert.notEqual(ev.tier, 'high', `${v.id}: ${formatPct(ev.range.lo)} to ${formatPct(ev.range.hi)}, rules: ${ev.rulesFired.map((r) => r.id)}`);
  });
}
