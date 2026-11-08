// Case registry tests, written from the case builder's requirements: cases are cleaned
// before the engine sees them, user cases survive save / export / import / delete,
// and the built-in demo cases keep the tiers expected before the scorer was run.
import test from 'node:test';
import assert from 'node:assert/strict';

// Minimal localStorage, so the registry runs in Node the way it does in a browser.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
  clear: () => store.clear(),
};
const {
  normalizeCase, saveUserCase, getCase, listCases, deleteUserCase, exportCase, importCase,
  BUILTIN, defaultVisit, newCaseTemplate,
} = await import('../app/js/cases.js');
const { evaluateAt, timeline, FINDINGS } = await import('../app/js/engine.js');
const { ALEX } = await import('../app/js/alex.js');
const { suggestFindings } = await import('../app/js/suggest.js');

const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const sample = () => ({
  patient: { name: '  Test patient  ', ageAtFirstVisit: '52', sex: 'female', summary: 'Left foot drop' },
  encounters: [
    { id: 'b', date: '2025-06-01', setting: 'Neurology', note: 'Brisk reflexes in the legs.', findings: [{ id: 'umn_signs', region: 'leg', quote: 'Brisk reflexes in the legs.' }] },
    { id: 'a', date: '2025-01-10', setting: 'Family doctor', note: 'Left foot drop. Twitching in the left calf.', findings: [
      { id: 'foot_drop', region: 'leg', quote: 'Left foot drop.' },
      { id: 'fasciculations', region: 'leg', quote: 'Twitching in the left calf.' },
      { id: 'not_a_red_flag', region: 'leg', quote: 'made up' },
    ] },
  ],
  actual: { referral: '2025-09-01', diagnosis: 'soon' },
  homeTests: [
    { date: '2025-01-17', test: 'walk', value: '3.1' },
    { date: 'last week', test: 'walk', value: 3.4 },
    { date: '2025-01-24', test: 'no_such_test', value: 1 },
  ],
});

test('normalizeCase drops unknown red flags and bad dates with messages, and sorts visits', () => {
  const { caseFile, errors } = normalizeCase(sample());
  assert.deepEqual(caseFile.encounters.map((e) => e.date), ['2025-01-10', '2025-06-01'], 'visits in date order');
  assert.ok(errors.some((m) => /unknown red flag "not_a_red_flag"/.test(m)), 'message for the unknown red flag');
  assert.deepEqual(caseFile.encounters[0].findings.map((f) => f.id), ['foot_drop', 'fasciculations']);
  assert.equal(caseFile.patient.name, 'Test patient');
  assert.equal(caseFile.patient.ageAtFirstVisit, 52);
  assert.deepEqual(caseFile.homeTests, [{ date: '2025-01-17', test: 'walk', value: 3.1, simulated: false }], 'bad date and unknown test dropped');
  assert.deepEqual(caseFile.actual, { referral: '2025-09-01' }, 'a non-date is dropped');

  const bad = normalizeCase({ encounters: [{ date: '2025-02-30x' }, { date: '2025-13-01' }] });
  assert.ok(bad.errors.some((m) => /Visit 1: the date must be YYYY-MM-DD/.test(m)));
  assert.equal(normalizeCase({}).errors.includes('Add at least one visit.'), true);
});

test('user cases round-trip: save, list, get, export, import, delete', async () => {
  const saved = saveUserCase(sample());
  assert.match(saved.id, /^user-/);
  assert.ok(store.has('rfn.cases'), 'written to localStorage');
  const got = getCase(saved.id);
  assert.equal(got.kind, 'user');
  assert.deepEqual(got.caseFile, saved.caseFile);
  assert.ok(listCases().some((c) => c.id === saved.id && c.name === 'Test patient'));

  // editing keeps the id
  await pause(3);
  const edited = saveUserCase({ ...saved.caseFile, patient: { ...saved.caseFile.patient, name: 'Renamed' } }, saved.id);
  assert.equal(edited.id, saved.id);
  assert.equal(getCase(saved.id).name, 'Renamed');

  const json = exportCase(saved.id);
  const parsed = JSON.parse(json);
  assert.equal(parsed.format, 'red-flag-navigator-case');
  await pause(3);
  const imp = importCase(json);
  assert.ok(imp.id && imp.id !== saved.id, 'import makes a new case');
  assert.deepEqual(imp.errors, []);
  assert.deepEqual(getCase(imp.id).caseFile, getCase(saved.id).caseFile, 'same case after export and import');

  assert.deepEqual(importCase('{not json').errors, ['That is not valid JSON.']);

  deleteUserCase(saved.id);
  assert.ok(!listCases().some((c) => c.id === saved.id));
  assert.equal(getCase(saved.id).id, 'alex', 'a missing case falls back to Alex');
  deleteUserCase(imp.id);
  assert.equal(listCases().filter((c) => c.kind === 'user').length, 0);
});

test('a saved copy of Alex gets exactly the same tiers as Alex (any patient, same rules)', () => {
  const saved = saveUserCase(ALEX);
  const opts = { includeHomeTests: false };
  const a = timeline(ALEX, opts).map((e) => [e.asOf, e.tier]);
  const b = timeline(getCase(saved.id).caseFile, opts).map((e) => [e.asOf, e.tier]);
  assert.deepEqual(b, a);
  deleteUserCase(saved.id);
});

test('the look-alike demo cases keep their expected tiers (benign ones are not High)', () => {
  const demos = BUILTIN.filter((c) => c.kind === 'demo');
  assert.ok(demos.length >= 5);
  for (const c of demos) {
    const ev = evaluateAt(c.caseFile, defaultVisit(c.caseFile));
    if (c.expect === 'not-high') assert.notEqual(ev.tier, 'high', `${c.id}: ${ev.tier}`);
  }
  const alex = getCase('alex');
  assert.equal(evaluateAt(alex.caseFile, defaultVisit(alex.caseFile), { includeHomeTests: false }).tier, 'high');
});

test('red flags accepted from the note helper make a valid case whose quotes are in the notes', () => {
  const draft = newCaseTemplate();
  draft.patient.name = 'From the helper';
  draft.encounters = ALEX.encounters.map((e) => ({ id: e.id, date: e.date, setting: e.setting, note: e.note, findings: suggestFindings(e.note).map(({ id, region, quote }) => ({ id, region, quote })) }));
  const { caseFile, errors } = normalizeCase(draft);
  assert.deepEqual(errors, []);
  for (const e of caseFile.encounters) for (const f of e.findings) {
    assert.ok(FINDINGS[f.id]);
    assert.ok(e.note.includes(f.quote), `${e.id}: ${f.quote}`);
  }
  // the helper's red flags alone reach High no later than the hand-labelled ones
  const opts = { includeHomeTests: false };
  const firstHigh = (cf) => (timeline(cf, opts).find((x) => x.tier === 'high') || {}).asOf;
  assert.ok(firstHigh(caseFile) <= firstHigh(ALEX));
});
