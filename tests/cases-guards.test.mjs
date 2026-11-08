// Guards on saving cases: a broken case is refused, ids never collide, quotes are never invented.
import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
const { saveUserCase, listCases, normalizeCase, importCase } = await import('../app/js/cases.js');

const visit = (date, findings = [{ id: 'focal_weakness', region: 'arm', quote: 'weak grip' }]) => ({ date, setting: 'Family doctor', note: 'weak grip', findings });

test('a case with no visits is refused and nothing is saved', () => {
  const before = listCases().length;
  const r = saveUserCase({ patient: { name: 'Empty' }, encounters: [] });
  assert.equal(r.id, null);
  assert.ok(r.errors.some((e) => /at least one visit/i.test(e)));
  assert.equal(listCases().length, before);
});

test('a visit with an impossible date is refused, not stored as "bad-date"', () => {
  const r = saveUserCase({ patient: { name: 'Bad date' }, encounters: [visit('2025-13-40')] });
  assert.equal(r.id, null);
  assert.ok(r.errors.some((e) => /date must be/i.test(e)));
  const imp = importCase(JSON.stringify({ patient: { name: 'Bad import' }, encounters: [visit('not-a-date')] }));
  assert.equal(imp.id, null);
});

test('two quick saves get different ids (no overwrite)', () => {
  const a = saveUserCase({ patient: { name: 'A' }, encounters: [visit('2025-01-01')] });
  const b = saveUserCase({ patient: { name: 'B' }, encounters: [visit('2025-01-01')] });
  assert.ok(a.id && b.id && a.id !== b.id);
  const names = listCases().filter((c) => c.kind === 'user').map((c) => c.name);
  assert.ok(names.includes('A') && names.includes('B'));
});

test('an empty quote stays empty instead of being replaced by the red-flag label', () => {
  const { caseFile } = normalizeCase({ patient: { name: 'Q' }, encounters: [visit('2025-02-02', [{ id: 'cramp', region: 'leg', quote: '' }])] });
  assert.equal(caseFile.encounters[0].findings[0].quote, '');
});
