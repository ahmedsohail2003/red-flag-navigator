// Note helper tests, written from its requirements: suggestions quote the note word
// for word, negated mentions are skipped, and on Alex's notes it finds the pattern
// signs a clinician picked by hand. Recall and precision are printed, not asserted
// as a claim: the rules were written while reading these notes (best case).
import test from 'node:test';
import assert from 'node:assert/strict';
import { suggestFindings, measureOnAlex, measureOnDemos, HELPER_RULES } from '../app/js/suggest.js';
import { ALEX } from '../app/js/alex.js';
import { LOOKALIKES } from '../app/js/lookalikes.js';
import { FINDINGS } from '../app/js/engine.js';
import { REGIONS } from '../app/js/cases.js';

const notes = [
  ...ALEX.encounters.map((e) => e.note),
  ...LOOKALIKES.map((v) => v.story),
  'Weak left grip 4/5.\nTwitching in the right calf; no wasting.\nWife says his speech is slurred and he coughs when drinking.',
];

test('every suggestion quotes its note word for word and uses a known id and region', () => {
  for (const n of notes) {
    for (const s of suggestFindings(n)) {
      assert.ok(n.includes(s.quote), `quote not in note: "${s.quote}"`);
      assert.ok(s.quote.length > 0 && s.sentence.includes(s.quote), 'quote sits inside its sentence');
      assert.ok(FINDINGS[s.id], `unknown id ${s.id}`);
      assert.ok(REGIONS.includes(s.region), `unknown region ${s.region}`);
    }
  }
});

test('each red flag appears at most once per body region, in note order', () => {
  for (const n of notes) {
    const out = suggestFindings(n);
    const keys = out.map((s) => `${s.id}|${s.region}`);
    assert.equal(new Set(keys).size, keys.length);
    const pos = out.map((s) => n.indexOf(s.sentence));
    assert.deepEqual(pos, [...pos].sort((a, b) => a - b));
  }
});

test('negated mentions are not suggested', () => {
  const negated = [
    'No numbness or tingling.',
    'There is no pain, no numbness, no change in bladder or bowel function and no visual symptoms.',
    'No weakness, wasting or fasciculations.',
    'He denies cramps or twitching.',
    'Negative for weight loss.',
    'Reflexes are not brisk.',
    'Babinski negative.',
    'No family history of ALS.',
    'Speech normal, no slurred speech, no choking when drinking.',
    'Without any falls this year.',
  ];
  for (const n of negated) assert.deepEqual(suggestFindings(n).map((s) => s.id), [], n);
  // the same words, not negated, are found
  assert.ok(suggestFindings('Weakness and wasting of the left hand.').some((s) => s.id === 'wasting' && s.region === 'arm'));
  assert.ok(suggestFindings('No pain, but twitching in the left calf.').some((s) => s.id === 'fasciculations' && s.region === 'leg'));
  assert.ok(suggestFindings('Normal sensation, brisk reflexes in the legs.').some((s) => s.id === 'umn_signs' && s.region === 'leg'));
});

test('body region comes from the words in the sentence', () => {
  const r = (t, id) => suggestFindings(t).find((s) => s.id === id)?.region;
  assert.equal(r('Cramping in the right forearm at night.', 'cramp'), 'arm');
  assert.equal(r('Cramps in both calves.', 'cramp'), 'leg');
  assert.equal(r('Twitching of the tongue.', 'tongue_fasciculations'), 'bulbar');
  assert.equal(r('Slurred speech for 4 months.', 'dysarthria'), 'bulbar');
  assert.equal(r('He sleeps on two pillows because he is short of breath lying flat.', 'short_breath'), 'breathing');
  // structured exam notes: the heading sets the region for lines without a body part
  assert.equal(r('Lower limbs. Tone increased bilaterally.', 'umn_signs'), 'leg');
});

test('on Alex\'s notes it finds the hand-labelled pattern signs and the speech signs', () => {
  const ids = (id) => new Set(suggestFindings(ALEX.encounters.find((e) => e.id === id).note).map((s) => s.id));
  const e2 = ids('e2');
  assert.ok(e2.has('two_territory_wasting'), 'e2 two_territory_wasting');
  assert.ok(e2.has('mimic_test_normal'), 'e2 mimic_test_normal');
  assert.ok(ids('e5').has('umn_signs'), 'e5 umn_signs');
  const e7 = ids('e7');
  assert.ok(e7.has('dysarthria') && e7.has('dysphagia'), 'e7 dysarthria + dysphagia');
  assert.ok(e7.has('split_hand') && !e7.has('two_territory_wasting'), 'e7: split hand, not also two territories');
  // the attribution "put down to tiredness" and "denies hopelessness" are not symptoms
  assert.ok(!e7.has('tiredness'));
});

test('recall and precision against every hand-labelled red flag (reported)', () => {
  const m = measureOnAlex();
  assert.equal(m.visits, 7);
  // Context flags (shown, not scored) are not red flags the helper looks for.
  assert.equal(m.labelled, ALEX.encounters.reduce((n, e) => n + new Set(e.findings.filter((f) => !FINDINGS[f.id]?.contextOnly).map((f) => `${f.id}|${f.region}`)).size, 0));
  assert.ok(m.recall > 0 && m.recall <= 1 && m.precision > 0 && m.precision <= 1);
  const d = measureOnDemos();
  console.log(`Alex, 7 notes: found ${m.found} of ${m.labelled} hand-labelled red flags (recall ${(100 * m.recall).toFixed(0)}%); ${m.found} of ${m.suggested} suggestions match a hand label (precision ${(100 * m.precision).toFixed(0)}%).`);
  for (const v of m.perVisit) if (v.missed.length || v.extra.length) console.log(`  ${v.id}: missed [${v.missed.join(', ')}] extra [${v.extra.join(', ')}]`);
  console.log(`Look-alike stories, 7: recall ${(100 * d.recall).toFixed(0)}%, precision ${(100 * d.precision).toFixed(0)}%.`);
});

test('every helper rule points at a red flag the engine knows', () => {
  for (const r of HELPER_RULES) assert.ok(FINDINGS[r.id], r.id);
});
