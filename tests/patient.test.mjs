// Patient view and overview: the patient words must carry the same facts as the doctor view.
// Run: node --test "tests/*.test.mjs"
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { evaluateAt, monthsSaved, formatPct, ACTIONS, HOME_TESTS } from '../app/js/engine.js';
import { buildModel, renderPhone, readSettings, sideOf } from '../app/js/patient.js';
import { buildOverview } from '../app/js/index.js';

const fixture = {
  patient: { name: 'Test Person' },
  encounters: [
    { id: 'a', date: '2025-01-10', setting: 'Family doctor', findings: [{ id: 'focal_weakness', region: 'arm', quote: 'Grip weaker on the right.' }], negatives: [] },
    { id: 'b', date: '2025-03-01', setting: 'Hand surgeon', findings: [{ id: 'split_hand', region: 'arm', quote: 'Wasting of the right thenar and first dorsal interosseous.' }], negatives: [{ label: 'No numbness', quote: 'No numbness.' }] },
  ],
  actual: { firstNeuromuscular: '2026-01-15', diagnosis: '2026-02-20', firstSymptom: '2024-11' },
  homeTests: [],
};
const settings = { referralLine: 0.05, includeHomeTests: true, mdc: {} };

test('patient view and doctor view come from the same evaluation', () => {
  for (const d of ['2025-01-10', '2025-03-01']) {
    const m = buildModel(fixture, d, settings);
    const ev = evaluateAt(fixture, d, settings);
    assert.equal(m.tier, ev.tier);
    assert.equal(m.headline, ACTIONS[ev.tier].patient.headline);
    assert.equal(m.judge.doctor.startsWith(`${formatPct(ev.range.lo)} to ${formatPct(ev.range.hi)}`), true);
    // every finding the doctor sees is in the patient's details, with its quote and date
    assert.equal(m.details.findings.length, ev.state.instances.length);
    for (const inst of ev.state.instances) assert.ok(m.details.findings.some((f) => f.quote === inst.quote && f.date === inst.date));
  }
});

test('the main patient screen shows no percentage; the details show the full range, never one number alone', () => {
  const m = buildModel(fixture, '2025-03-01', settings);
  const parts = renderPhone(m, fixture);
  assert.ok(!/%/.test(parts.main), 'no percentages before "See everything your doctor sees"');
  assert.ok(parts.details.includes(`${formatPct(m.details.range.lo)} to ${formatPct(m.details.range.hi)}`));
  assert.ok(!/ALS/.test(parts.main) && /ALS/.test(parts.details), 'ALS is named in the details, not in the headline');
});

test('settings are read from storage with safe defaults', () => {
  // simulated home tests are off by default; only the exact string 'true' switches them on
  assert.deepEqual(readSettings(null), { referralLine: 0.05, includeHomeTests: false, mdc: {} });
  assert.equal(readSettings({ getItem: (k) => (k === 'rfn.includeHomeTests' ? 'true' : null) }).includeHomeTests, true);
  assert.equal(readSettings({ getItem: (k) => (k === 'rfn.includeHomeTests' ? '1' : null) }).includeHomeTests, false);
  const store = { 'rfn.referralLine': '0.1', 'rfn.includeHomeTests': 'false', 'rfn.mdc': '{"tap_right":4.2,"walk":"x"}' };
  const s = readSettings({ getItem: (k) => store[k] ?? null });
  assert.deepEqual(s, { referralLine: 0.1, includeHomeTests: false, mdc: { tap_right: 4.2 } });
});

test('body side comes from the quoted sentences', () => {
  assert.equal(sideOf(['weak on the right', 'right thenar flatter than the left', 'right forearm']), 'right');
  assert.equal(sideOf(['twitching in both forearms', 'right hand']), null);
});

test('overview headline equals monthsSaved on notes only', () => {
  const m = buildOverview(fixture, null);
  const ms = monthsSaved(fixture, { includeHomeTests: false });
  // the headline gain counts to the real referral when the case file has one, else to the specialist visit
  assert.equal(m.saved.rounded, Math.round(ms.monthsVsReferral ?? ms.months));
  assert.equal(m.saved.firstHigh, ms.firstHigh);
  const off = buildOverview(null, null);
  assert.equal(off.saved, null, 'no case file: result pending, never invented');
});

test('on Alex (if the case file is present) both pages agree with the engine', { skip: !existsSync(new URL('../app/js/alex.js', import.meta.url)) }, async () => {
  const { ALEX } = await import('../app/js/alex.js');
  const m = buildOverview(ALEX, null);
  const ms = monthsSaved(ALEX, { includeHomeTests: false });
  assert.ok(Number.isFinite(ms.monthsVsReferral), 'Alex has a real referral date, so the gain is referral vs referral');
  assert.equal(m.saved.rounded, Math.round(ms.monthsVsReferral ?? ms.months));
  for (const e of ALEX.encounters) {
    const pm = buildModel(ALEX, e.date, settings);
    assert.equal(pm.tier, evaluateAt(ALEX, e.date, settings).tier);
  }
});

test('a range that uses SIMULATED check-in data is tagged as such in the details and the judge note', () => {
  const m = HOME_TESTS.tap_right.placeholderMdc; // a drop beyond the engine's own MDC, whatever it is
  const sim = { ...fixture, homeTests: [60, 61, 58 - m, 57 - m].map((value, i) => ({ date: `2025-01-${String(10 + 7 * i).padStart(2, '0')}`, test: 'tap_right', value, simulated: true })) };
  const on = buildModel(sim, '2025-03-01', settings);
  assert.equal(on.details.simulatedInRange, true);
  assert.match(renderPhone(on, sim).details, /sim-tag[^]*includes a simulated weekly check-in/);
  const off = buildModel(sim, '2025-03-01', { ...settings, includeHomeTests: false });
  assert.equal(off.details.simulatedInRange, false);
});

test('settings parsing matches the doctor dashboard (fraction line, {mdc} objects, known tests only)', () => {
  const store = { 'rfn.referralLine': '10', 'rfn.mdc': '{"tap_right":{"mdc":3},"nope":2}' };
  assert.deepEqual(readSettings({ getItem: (k) => store[k] ?? null }), { referralLine: 0.05, includeHomeTests: false, mdc: { tap_right: 3 } });
});
