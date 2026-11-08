// The Home plan view (app/js/app/views/homeplan.js): the pure helpers its mount() uses.
// Node has no DOM, so these check the logic and the markup strings; mount() itself is
// checked in the browser. Fixes from the final review are named by their number.
// Run: node --test "tests/home-plan-view.test.mjs"
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateAt } from '../app/js/engine.js';
import { getCase } from '../app/js/cases.js';
import * as catalog from '../app/js/home/catalog.js';
import { planFor, QUESTIONS } from '../app/js/home/protocol.js';
import { summarize } from '../app/js/home/summary.js';
import { addResult, addSamples, clearHomeData } from '../app/js/home/store.js';
import { csvToSamples, parseCsv } from '../app/js/home/import/csv.js';
import {
  LOCAL, actNowHtml, alertHtml, alexNoteHtml, answersOf, btKindHtml, btStatusHtml, clearNoFalls, clearProfiles,
  countBefore, cutDateOf, entryChipsHtml, exportCsv, importSince, lastHtml, loadProfile, mdcText,
  prepareCsv, profileKey, recentFall, redFlagsFor, regionsFor, rowHtml, saveProfile, scoreAnswers, situationAt, triggerHtml,
  verdictsHtml, windowWeeks,
} from '../app/js/app/views/homeplan.js';

const alex = getCase('alex').caseFile;
const alexVisits = alex.encounters.map((e) => e.date);
const WALKING = ['timed_walk_speed', 'tug_time', 'sts30', 'sts5_time'];
const planIds = (plan) => [...plan.weekly, ...plan.every2weeks, ...plan.monthly].map((i) => i.id);

// A minimal localStorage: strings in a Map, with key(i) and length like the real one.
function fakeStorage() {
  const data = new Map();
  return {
    data,
    get length() { return data.size; },
    key(i) { return [...data.keys()][i] ?? null; },
    getItem(k) { return data.has(k) ? data.get(k) : null; },
    setItem(k, v) { data.set(k, String(v)); },
    removeItem(k) { data.delete(k); },
  };
}
const useStorage = (s) => Object.defineProperty(globalThis, 'localStorage', { value: s, configurable: true, writable: true });
const noStorage = () => { delete globalThis.localStorage; };
// Storage that refuses everything, as in a private window with storage blocked.
const blockedStorage = () => ({
  get length() { throw new Error('blocked'); },
  key() { throw new Error('blocked'); },
  getItem() { throw new Error('blocked'); },
  setItem() { throw new Error('blocked'); },
  removeItem() { throw new Error('blocked'); },
});

// ---------- (7) the situation is judged at the data date ----------
test('(7) at the latest visit the situation runs to today: Alex counts as diagnosed (14 Jul 2026)', () => {
  const ev = evaluateAt(alex, '2026-06-11'); // his last visit, tier high
  const cut = cutDateOf(alexVisits, '2026-06-11', '2026-11-08');
  assert.equal(cut, '2026-11-08');
  const s = situationAt({ caseFile: alex, ev, cut, answers: {} });
  assert.equal(s.stage, 'diagnosed');
  assert.equal(s.diagnosed, true);
  // An earlier visit keeps its own date: no diagnosis yet.
  const early = cutDateOf(alexVisits, '2025-04-21', '2026-11-08');
  assert.equal(early, '2025-04-21');
  assert.notEqual(situationAt({ caseFile: alex, ev: evaluateAt(alex, early), cut: early, answers: {} }).stage, 'diagnosed');
});

test('(7) between visits the 8-week window moves on, and the view reads the protocol\'s week first', () => {
  const entry = getCase('demo-cts_severe');
  const last = entry.caseFile.encounters.map((e) => e.date).sort().pop();
  const ev = evaluateAt(entry.caseFile, last);
  assert.equal(ev.tier, 'unclear');
  const atVisit = situationAt({ caseFile: entry.caseFile, ev, cut: last, answers: {} });
  const later = situationAt({ caseFile: entry.caseFile, ev, cut: '2025-03-12', answers: {} }); // 8 weeks on
  assert.equal(atVisit.weekInWindow, 0);
  assert.equal(later.weekInWindow, 8);
  assert.equal(windowWeeks(ev, later), 8);
  // The engine's count at the visit is only the fallback.
  assert.equal(windowWeeks({ weeksUnclear: 0 }, { weekInWindow: 5 }), 5);
  assert.equal(windowWeeks({ weeksUnclear: 3 }, { weekInWindow: null }), 3);
  assert.equal(windowWeeks(null, {}), null);
});

// ---------- (2) imports and Your data start 12 weeks before the first visit ----------
test('(2) importSince: 12 weeks before the first visit, or before today with no visit, from that Monday', () => {
  assert.equal(importSince(alexVisits, '2026-11-08'), '2024-07-22'); // first visit Mon 2024-10-14
  assert.equal(importSince(['2026-02-10', '2025-03-03'], '2026-11-08'), '2024-12-09'); // unsorted
  assert.equal(importSince(['2026-03-04'], '2026-11-08'), '2025-12-08'); // Wed 2025-12-10 -> its Monday
  assert.equal(importSince([], '2026-11-08'), '2026-08-10'); // Sun 2026-08-16 -> its Monday
  assert.equal(importSince(['not a date'], '2026-11-08'), '2026-08-10');
  assert.equal(importSince([], 'not a date'), null);
});

test('(2) an imported history no longer sets a baseline years before the visit', () => {
  // Two years of daily weighings from a smart scale, then the first visit on 2026-03-02.
  const samples = [];
  for (let t = Date.UTC(2024, 0, 1); t <= Date.UTC(2026, 4, 31); t += 86400000) {
    const day = new Date(t).toISOString().slice(0, 10);
    samples.push({ signal: 'weight', start: `${day}T07:00:00`, value: day < '2025-06-01' ? 95 : 80, unit: 'kg', source: 'apple-health', person: 'p1' });
  }
  const since = importSince(['2026-03-02'], '2026-06-01');
  assert.equal(since, '2025-12-08');
  const snap = { results: [], samples, legacy: [], demo: null };
  const rows = regionsFor({ snap, cut: '2026-06-01', since, person: 'p1' }).flatMap((g) => g.rows);
  const w = rows.find((r) => r.id === 'weight');
  assert.ok(w && w.baseline, 'a weight baseline is set');
  assert.ok(w.weekly[0].week >= '2025-12-08', `the first weekly value is in the window (${w.weekly[0].week})`);
  assert.equal(w.baseline.value, 80); // not the 95 kg from two years before
  // Without the start date the baseline is the old history: the case this guards against.
  const old = summarize({ samples, catalog, asOf: '2026-06-01', person: 'p1' }).flatMap((g) => g.rows).find((r) => r.id === 'weight');
  assert.equal(old.baseline.value, 95);
});

test('(2, 11) prepareCsv: old readings are left out and every reading is saved for the open case', () => {
  const r = csvToSamples('date,signal,value,unit,person\n2023-01-02,weight,90,kg,someone else\n2026-10-01,weight,82,kg,someone else\n2026-10-08,weight,81.5,kg,\n', { person: 'case-7' });
  assert.equal(r.samples.length, 3);
  const c = prepareCsv(r.samples, { person: 'case-7', since: '2026-08-16' });
  assert.equal(c.old, 1);
  assert.equal(c.samples.length, 2);
  assert.ok(c.samples.every((s) => s.person === 'case-7'), 'all saved for the open case');
  assert.deepEqual(c.others, ['someone else']);
  // Without a since date nothing is dropped, and the person is still set.
  const all = prepareCsv(r.samples, { person: 'case-7' });
  assert.equal(all.old, 0);
  assert.ok(all.samples.every((s) => s.person === 'case-7'));
});

test('(2) countBefore counts only this case\'s shown items before since', () => {
  const snap = {
    results: [{ person: 'a', date: '2024-01-01' }, { person: 'a', date: '2026-01-01' }, { person: 'b', date: '2024-01-01' }, { person: 'a', date: '2024-01-01', simulated: true }],
    samples: [{ person: 'a', start: '2023-05-05T08:00' }],
    legacy: [{ person: 'Pat', date: '2024-02-02' }, { person: '', date: '2024-02-02' }, { person: 'Pat', date: '2024-02-02', calibration: true }],
    demo: { results: [{ date: '2024-01-01' }], samples: [] },
  };
  assert.equal(countBefore(snap, '2025-01-01', { person: 'a', legacyPerson: 'Pat', includeDemo: false }), 3);
  assert.equal(countBefore(snap, '2025-01-01', { person: 'a', legacyPerson: 'Pat', includeDemo: true }), 5);
  assert.equal(countBefore(snap, null, { person: 'a' }), 0);
});

// ---------- (8, 37) the answers are kept per case ----------
test('(8) the profile is keyed by case: one case\'s answers never change another case\'s plan', () => {
  const s = fakeStorage();
  useStorage(s);
  clearProfiles();
  saveProfile('case-a', { devices: ['smart_scale'], walk: 'no', answers: { fallsRecently: true } });
  assert.ok(s.data.has(profileKey('case-a')));
  assert.equal(profileKey('case-a'), 'rfn.home.profile:case-a');
  assert.equal(loadProfile('case-a').walk, 'no');
  assert.deepEqual(loadProfile('case-a').devices, ['smart_scale']);
  const b = loadProfile('case-b');
  assert.equal(b.walk, null);
  assert.deepEqual(b.devices, []);
  assert.deepEqual(b.answers, {});
  // The old key all cases shared is not read for any case, and Delete all removes it too.
  s.setItem('rfn.home.profile', JSON.stringify({ walk: 'yes', devices: ['oximeter'] }));
  assert.equal(loadProfile('case-c').walk, null, 'the old shared key is not read');
  assert.deepEqual(loadProfile('case-c').devices, []);
  saveProfile('case-a', { walk: 'yes' });
  clearProfiles();
  assert.equal([...s.data.keys()].filter((k) => k.startsWith('rfn.home.profile')).length, 0);
  assert.equal(loadProfile('case-a').walk, null);
  noStorage();
});

test('(37) with storage blocked the answers are kept in memory across visits to the page', () => {
  useStorage(blockedStorage());
  clearProfiles();
  saveProfile('case-x', { walk: 'unsure', devices: [], answers: {} });
  // A new mount() reads the same module-level memory.
  assert.equal(loadProfile('case-x').walk, 'unsure');
  assert.equal(loadProfile('case-y').walk, null);
  clearProfiles();
  assert.equal(loadProfile('case-x').walk, null);
  noStorage();
});

test('every optional protocol question is kept by its id, read generically', () => {
  noStorage();
  clearProfiles();
  const answers = {};
  for (const q of QUESTIONS.filter((x) => x.id !== 'canWalkSafely')) answers[q.id] = q.options[0].value;
  saveProfile('case-q', { answers: { ...answers, notAQuestion: 1 } });
  assert.deepEqual(loadProfile('case-q').answers, answers);
  clearProfiles();
});

// ---------- (17, 34, 35) falls ----------
test('(17, 35) scoreAnswers keeps the chosen option, and a near-fall is saved as a near-fall', () => {
  const entry = {
    questions: [{ id: 'falls', options: [{ label: 'No falls and no near-falls', score: 0 }, { label: 'No falls, but at least one near-fall', score: 0, nearFall: true }, { label: '1 fall', score: 1 }] }],
  };
  const none = scoreAnswers(entry, [{ qid: 'falls', opt: 0 }]);
  const near = scoreAnswers(entry, [{ qid: 'falls', opt: 1 }]);
  assert.equal(none.score, 0);
  assert.equal(near.score, 0);
  assert.notDeepEqual(near.detail, none.detail, 'the two answers are no longer saved the same way');
  assert.equal(near.detail.nearFall, true);
  assert.equal(none.detail.nearFall, undefined);
  assert.equal(near.detail.chosen.falls, 'No falls, but at least one near-fall');
  assert.deepEqual(near.detail.answers, { falls: 0 });
  const fall = scoreAnswers(entry, [{ qid: 'falls', opt: 2 }]);
  assert.equal(fall.score, 1);
  assert.equal(fall.answered, 1);
  assert.equal(fall.total, 1);
  // An unknown question or option is ignored.
  assert.equal(scoreAnswers(entry, [{ qid: 'other', opt: 0 }, { qid: 'falls', opt: 9 }]).answered, 0);
});

test('(34) recentFall: a fall or near-fall in the last 91 days, from the falls question or a watch', () => {
  const cut = '2026-11-08';
  const res = (date, value, detail = {}, more = {}) => ({ test: 'falls_week', date, value, detail, person: 'p', ...more });
  assert.equal(recentFall({ results: [res('2026-10-01', 1)], person: 'p', cut }), '2026-10-01');
  assert.equal(recentFall({ results: [res('2026-10-01', 0, { nearFall: true })], person: 'p', cut }), '2026-10-01');
  assert.equal(recentFall({ results: [res('2026-10-01', 0, { nearFalls: 2 })], person: 'p', cut }), '2026-10-01');
  assert.equal(recentFall({ results: [res('2026-10-01', 0)], person: 'p', cut }), null);
  assert.equal(recentFall({ results: [res('2026-08-09', 2)], person: 'p', cut }), '2026-08-09'); // 91 days before
  assert.equal(recentFall({ results: [res('2026-08-08', 2)], person: 'p', cut }), null); // 92 days before
  assert.equal(recentFall({ results: [res('2026-11-09', 2)], person: 'p', cut }), null); // after the cut
  assert.equal(recentFall({ results: [res('2026-10-01', 1, {}, { person: 'q' })], person: 'p', cut }), null);
  assert.equal(recentFall({ results: [res('2026-10-01', 1, {}, { simulated: true })], person: 'p', cut }), null);
  assert.equal(recentFall({ results: [res('2026-10-01', 1, {}, { simulated: true })], person: 'p', cut, includeDemo: true }), '2026-10-01');
  assert.equal(recentFall({ samples: [{ signal: 'falls', start: '2026-09-30T14:00:00-04:00', value: 1, person: 'p' }], person: 'p', cut }), '2026-09-30');
  assert.equal(recentFall({ samples: [{ signal: 'falls', start: '2026-09-30', value: 0, person: 'p' }], person: 'p', cut }), null);
  // The latest one wins.
  assert.equal(recentFall({ results: [res('2026-09-01', 1), res('2026-10-20', 0, { nearFall: true })], person: 'p', cut }), '2026-10-20');
});

test('(34) a recent fall with no answer to the falls question switches the walking tests off', () => {
  const p = { walk: null, devices: [], answers: {} };
  assert.equal(answersOf(p, null).fallsRecently, undefined);
  const a = answersOf(p, '2026-10-01');
  assert.equal(a.fallsRecently, true);
  // The person's own answer wins.
  assert.equal(answersOf({ ...p, answers: { fallsRecently: false } }, '2026-10-01').fallsRecently, false);
  assert.equal(answersOf({ ...p, walk: 'yes' }, null).canWalkSafely, true);
  // Through the protocol: an unclear leg case loses its walking and chair tests.
  const sit = { stage: 'unclear', tier: 'unclear', diagnosed: false, affectedRegions: ['leg'], otherRegions: ['arm', 'bulbar', 'breathing'], weekInWindow: 1, canWalkSafely: null, reasons: [], signs: {} };
  const before = planIds(planFor(sit, { answers: answersOf(p, null) }));
  const after = planIds(planFor(sit, { answers: a }));
  assert.ok(before.includes('timed_walk_speed'));
  for (const id of WALKING) assert.ok(!after.includes(id), id);
});

test('(34) a fall reported in the app clears an earlier "No" to the falls question', () => {
  const p = { walk: null, devices: [], answers: { fallsRecently: false, walkingAid: 'cane' } };
  const fell = clearNoFalls(p, { value: 1 });
  assert.equal(fell.answers.fallsRecently, undefined);
  assert.equal(fell.answers.walkingAid, 'cane');
  assert.equal(clearNoFalls(p, { value: 0, nearFall: true }).answers.fallsRecently, undefined);
  assert.equal(clearNoFalls(p, { value: 0 }), p, 'no fall: unchanged');
  const yes = { ...p, answers: { fallsRecently: true } };
  assert.equal(clearNoFalls(yes, { value: 2 }), yes, 'a "Yes" stays');
});

// ---------- (29) red flags in a saved result ----------
const RF_TODAY = { urgency: 'today', text: 'Short of breath at rest or when lying flat: contact your doctor today, the same day.', source: 'https://www.nice.org.uk/guidance/ng127/chapter/Recommendations-for-adults', sourceLabel: 'NICE NG127, 1.7.5' };
test('(29) redFlagsFor: a yes to a red-flag question, or a total at the red-flag line', () => {
  const NO_YES = [{ label: 'No', score: 0 }, { label: 'Yes', score: 1 }];
  const breathing = { questions: [
    { id: 'breathless_rest', options: NO_YES, redFlag: RF_TODAY },
    { id: 'breathless_effort', options: NO_YES },
    { id: 'lying_flat', options: NO_YES, redFlag: RF_TODAY },
  ] };
  assert.deepEqual(redFlagsFor(breathing, { value: 1, answers: { breathless_rest: 0, breathless_effort: 1, lying_flat: 0 } }), []);
  assert.deepEqual(redFlagsFor(breathing, { value: 1, answers: { breathless_rest: 0, breathless_effort: 0, lying_flat: 1 } }), [RF_TODAY]);
  // The same text once, even with both answered yes.
  assert.equal(redFlagsFor(breathing, { value: 2, answers: { breathless_rest: 1, lying_flat: 1 } }).length, 1);
  const eat10 = { questions: [], redFlag: { atLeast: 3, urgency: 'now', text: 'A score of 3 or more counts as trouble swallowing: contact your doctor now.' } };
  assert.equal(redFlagsFor(eat10, { value: 2 }).length, 0);
  assert.equal(redFlagsFor(eat10, { value: 3 }).length, 1);
  assert.equal(redFlagsFor(eat10, { value: 9 })[0].urgency, 'now');
  assert.deepEqual(redFlagsFor(null, { value: 9 }), []);
});

test('(29, 30) alertHtml: a role="alert" box with the urgency in words and the source', () => {
  const html = alertHtml([RF_TODAY], 'Act on this');
  assert.match(html, /role="alert"/);
  assert.match(html, /Today, the same day:/);
  assert.match(html, /contact your doctor today, the same day/);
  assert.match(html, /href="https:\/\/www\.nice\.org\.uk\/guidance\/ng127/);
  assert.match(html, /NICE NG127, 1\.7\.5/);
  assert.match(alertHtml([{ ...RF_TODAY, urgency: 'now' }]), /<b>Now:<\/b>/);
  assert.equal(alertHtml([]), '');
  assert.equal(alertHtml([{ urgency: 'now' }]), '', 'no text, no box');
  assert.doesNotMatch(alertHtml([{ text: '<script>x</script>' }]), /<script>/);
});

test('(30) actNowHtml puts the plan\'s act-now items in an alert box, and nothing when there are none', () => {
  const html = actNowHtml([{ text: 'Trouble swallowing is recorded: contact your doctor now.', urgency: 'now', source: 'https://www.nice.org.uk/guidance/ng127/chapter/Recommendations-for-adults', sourceLabel: 'NICE NG127, 1.7.5' }]);
  assert.match(html, /role="alert"/);
  assert.match(html, /Act on this first/);
  assert.match(html, /<b>Now:<\/b> Trouble swallowing is recorded/);
  assert.equal(actNowHtml([]), '');
  assert.equal(actNowHtml(undefined), '');
});

// ---------- (14) the verdict table ----------
test('(14) the verdict table says nothing at home detects undiagnosed ALS, and "detects" reads "Could flag (via a clinician)"', () => {
  const html = verdictsHtml([
    { item: 'Timed walk (stopwatch)', region: 'leg', verdict: 'detects', grade: 'moderate', why: 'x', sources: [] },
    { item: 'Daily steps', region: 'general', verdict: 'monitors', grade: 'strong', why: 'y', sources: [] },
  ]);
  assert.match(html, /Nothing measured at home has been shown to detect undiagnosed ALS; every study enrolled people already diagnosed\./);
  assert.match(html, /<b>Could flag<\/b> means it can help a clinician document a red flag or progression before diagnosis\./);
  assert.match(html, />Could flag \(via a clinician\)</);
  assert.doesNotMatch(html, />Detects</);
  assert.match(html, />Monitors</);
  // The sentence sits under the heading, before the table.
  assert.ok(html.indexOf('Nothing measured at home') < html.indexOf('<table'));
  assert.match(verdictsHtml(catalog.VERDICTS), /Could flag \(via a clinician\)/);
});

// ---------- (18) simulated values in the card headers ----------
test('(18) lastHtml marks a simulated last value with the Simulated chip', () => {
  const sim = lastHtml({ date: '2026-08-31', value: 0.7, unit: 'm/s', simulated: true }, 2);
  assert.match(sim, /Last 31 Aug 2026: 0\.70 m\/s/);
  assert.match(sim, /chip sim/);
  assert.doesNotMatch(lastHtml({ date: '2026-08-31', value: 0.7, unit: 'm/s', simulated: false }, 2), /chip sim/);
  assert.equal(lastHtml(null), 'Not done yet');
});

// ---------- (20, 16) the noise figure and who it was measured in ----------
function row(over = {}) {
  return {
    kind: 'test', id: 'tug_time', key: 'test:tug_time', label: 'Timed up and go', unit: 's', decimals: 1, higherIsBetter: false,
    weekly: [{ week: '2026-10-05', value: 9, n: 1 }, { week: '2026-10-12', value: 9.4, n: 1 }],
    latest: { week: '2026-10-12', value: 9.4, n: 1 }, baseline: { value: 9.2 }, slope: null, mdc: 3,
    mdcInfo: { value: 3, unit: 's', population: '30 community-dwelling older adults at high fall risk, retested 1 week apart' },
    mdcNote: '', practiceWeeks: 0, practice: 0, chips: ['real'], simulated: false, legacy: false,
    status: { word: 'Baseline set, too early to judge', detail: 'A change can count from week 4; 2 so far.', cls: '' },
    ...over,
  };
}
test('(20) each data row prints who its normal variation was measured in, in the text and the chart label', () => {
  const html = rowHtml(row(), 0);
  assert.match(html, /Normal variation <b class="mono">±3 s<\/b> <span class="hp-pop">\(measured in: 30 community-dwelling older adults at high fall risk, retested 1 week apart\)<\/span>/);
  const label = /aria-label="([^"]*)"/.exec(html)[1];
  assert.match(label, /normal variation ±3 \(measured in: 30 community-dwelling older adults/);
  // No MDC: nothing about a population.
  assert.doesNotMatch(rowHtml(row({ mdc: null, mdcInfo: null, mdcNote: 'none' }), 1), /measured in/);
  assert.match(mdcText(row({ mdc: null, mdcNote: 'pending', mdcInfo: { value: 23.4, population: '38 people with immune neuropathies' } })).size, /23\.4% of baseline, once the baseline is set/);
  // The open state comes in from the view.
  assert.match(rowHtml(row(), 2, true), /aria-expanded="true"/);
  assert.match(rowHtml(row(), 2, false), /id="hp-v-2" hidden/);
});

test('(16) a placeholder MDC row shows the published figure it falls short of; a text note is printed', () => {
  const reading = row({ id: 'reading', key: 'test:reading', label: 'Reading rate', unit: 'words per minute', mdc: 15, mdcInfo: null, mdcNote: 'placeholder', legacy: true });
  assert.match(mdcText(reading).size, /^±15 words per minute \(placeholder; published: 22 to 31 words a minute \(WatchALS: 22\.1 in ALS, 31\.3 in controls\)\)$/);
  const tap = row({ id: 'tap_left', unit: 'taps in 10 s', mdc: 6, mdcInfo: null, mdcNote: 'placeholder', legacy: true });
  assert.match(mdcText(tap).size, /placeholder; published: about 18 taps per 10 s, provisional/);
  assert.equal(mdcText(row({ id: 'walk', mdc: 1, mdcInfo: null, mdcNote: 'placeholder' })).size, '±1 s (placeholder)');
  assert.match(mdcText(row({ mdcNote: 'measured' })).size, /\(measured by the team\)/);
  assert.match(mdcText(row({ mdcNote: 'From a 60-s walk, not this 10-m walk' })).size, /\(From a 60-s walk, not this 10-m walk\)$/);
  assert.equal(mdcText(row({ mdcNote: 'relative', mdc: 7.02, mdcInfo: { value: 23.4 } })).size, '±7.0 s (23.4% of baseline)');
});

test('a status word that already ends a sentence gets no second full stop', () => {
  const html = rowHtml(row({ status: { word: 'Changed beyond normal variation two weeks running.', detail: 'Context only: not a sign of ALS on its own; mention it to your doctor.', cls: 'decline' } }), 0);
  assert.match(html, /<b>Changed beyond normal variation two weeks running\.<\/b> Context only/);
  assert.doesNotMatch(html, /running\.\./);
});

// ---------- (21, 33) the triggers ----------
test('(21) an app rule says "Our rule, built on:" before its source; a guideline says "Source:"', () => {
  const ours = triggerHtml({ if: 'A decline in a second body region', then: 'Refer urgently for an EMG.', source: 'https://doi.org/10.1016/j.clinph.2020.04.005', sourceLabel: 'Gold Coast criterion 2', basis: 'our rule' });
  assert.match(ours, /Our rule, built on: <a href="https:\/\/doi\.org\/10\.1016\/j\.clinph\.2020\.04\.005"/);
  assert.doesNotMatch(ours, /Source:/);
  const guide = triggerHtml({ if: 'Breathless at rest or when lying flat', then: 'Contact your doctor today: refer immediately, the same day.', source: 'https://www.nice.org.uk/guidance/ng127/chapter/Recommendations-for-adults', sourceLabel: 'NICE NG127', basis: 'guideline' });
  assert.match(guide, /Source: <a /);
  assert.doesNotMatch(guide, /Our rule/);
  // (33) The "then" text reads as an instruction to the person.
  assert.match(guide, /<b>then<\/b> contact your doctor today: refer immediately, the same day\./);
  // A leading "A" is lower-cased inside the sentence; an acronym is not.
  assert.match(ours, /<b>If<\/b> a decline in a second body region, <b>then<\/b> refer urgently/);
  assert.match(triggerHtml({ if: 'ALS is suspected', then: 'EAT-10 every month' }), /<b>If<\/b> ALS is suspected, <b>then<\/b> EAT-10 every month\./);
});

// ---------- (24) chips in the plan list ----------
test('(24) plan items carry the Not validated and Context only chips of their catalogue entry', () => {
  const t = catalog.TESTS;
  const ddk = entryChipsHtml(t.ddk_rate); // experimental, context
  assert.match(ddk, /Not validated/);
  assert.match(ddk, /Context only/);
  const mpt = entryChipsHtml(t.mpt); // experimental, clinician-prompt
  assert.match(mpt, /Not validated/);
  assert.doesNotMatch(mpt, /Context only/);
  // Since the engine's leg test became the phone walking test (HOME_TESTS.gait_speed, 8 Nov), the
  // stopwatch walk is context only: one leg decline must never count twice. It is still a
  // standard stopwatch test, so it carries no "Not validated" chip.
  const walk = entryChipsHtml(t.timed_walk_speed);
  assert.match(walk, /Context only/);
  assert.doesNotMatch(walk, /Not validated/);
  assert.equal(entryChipsHtml(undefined), '');
});

// ---------- (13) the Alex note ----------
test('(13) "Alex never did home tests" only while he has no results of his own', () => {
  assert.match(alexNoteHtml(false, false), /Alex never did home tests/);
  assert.doesNotMatch(alexNoteHtml(false, true), /never did home tests/);
  assert.match(alexNoteHtml(false, true), /data-act="home-on"/);
  assert.match(alexNoteHtml(true, true), /simulated weekly data is on/);
});

// ---------- (38) export ----------
test('(38) the export holds only this case\'s readings and results', () => {
  noStorage();
  clearHomeData();
  addSamples([
    { signal: 'weight', start: '2026-10-01T07:00', value: 80, unit: 'kg', source: 'manual', person: 'case-a' },
    { signal: 'weight', start: '2026-10-01T07:00', value: 70, unit: 'kg', source: 'manual', person: 'case-b' },
  ]);
  addResult({ test: 'eat10', date: '2026-10-02', time: '09:00', value: 4, unit: 'score', person: 'case-a' });
  addResult({ test: 'eat10', date: '2026-10-02', time: '09:00', value: 1, unit: 'score', person: 'case-b' });
  const { headers, rows } = parseCsv(exportCsv('case-a'));
  const col = (name) => headers.indexOf(name);
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r[col('person')] === 'case-a'), 'no other case in the file');
  assert.deepEqual(rows.map((r) => r[col('signal')]).sort(), ['eat10', 'weight']);
  assert.deepEqual(rows.map((r) => Number(r[col('value')])).sort((x, y) => x - y), [4, 80]);
  clearHomeData();
});

// ---------- (39) Bluetooth ----------
test('(39) the Disconnect button is drawn once, outside the live box each reading rewrites', () => {
  const html = btKindHtml('heart_rate', 'heart rate strap');
  const live = /<div class="hp-bt-live note" data-bt="heart_rate" aria-live="polite"><\/div>/;
  assert.match(html, live, 'the live box starts empty');
  assert.match(html, /data-act="bt-off" data-kind="heart_rate" hidden>Disconnect<\/button>/);
  assert.ok(html.indexOf('data-act="bt-off"') < html.indexOf('data-bt="heart_rate"'), 'the button is not inside the live box');
  const status = btStatusHtml({ status: 'Connected to Polar H10.', last: '72 bpm', saved: 3, conn: {} });
  assert.match(status, /Connected to Polar H10\.<br>Latest: <b class="mono">72 bpm<\/b><br>3 readings saved\./);
  assert.doesNotMatch(status, /button/);
});

// ---------- (40) the hosted-copy message ----------
test('(40) the hosted-copy message is one a patient can act on', () => {
  assert.equal(LOCAL, 'The microphone, Bluetooth and downloads work only when the app is opened on its own, not inside another page. You can still type readings in or import files.');
  assert.doesNotMatch(LOCAL, /python|serve\.py|locally/i);
});

// ---------- with the shared catalogue and protocol (the other fixers' halves) ----------
test('shared spec: the falls question\'s near-fall option is saved with nearFall', () => {
  const t = catalog.TESTS.falls_week;
  const opt = t.questions[0].options.findIndex((o) => o.nearFall === true);
  assert.ok(opt >= 0, 'the catalogue marks the near-fall option');
  const s = scoreAnswers(t, [{ qid: t.questions[0].id, opt }]);
  assert.equal(s.score, 0);
  assert.equal(s.detail.nearFall, true);
});

test('shared spec: the breathing check and EAT-10 raise their red flags', () => {
  const b = catalog.TESTS.breathing_symptoms;
  const yes = (ids) => Object.fromEntries(b.questions.map((q) => [q.id, ids.includes(q.id) ? 1 : 0]));
  assert.equal(redFlagsFor(b, { value: 1, answers: yes(['lying_flat']) })[0].urgency, 'today');
  assert.equal(redFlagsFor(b, { value: 1, answers: yes(['breathless_rest']) }).length, 1);
  assert.equal(redFlagsFor(b, { value: 1, answers: yes(['breathless_effort']) }).length, 0);
  const e = catalog.TESTS.eat10;
  assert.equal(redFlagsFor(e, { value: e.redFlag.atLeast - 1 }).length, 0);
  assert.match(alertHtml(redFlagsFor(e, { value: e.redFlag.atLeast })), /role="alert"[\s\S]*<b>Now:<\/b>/);
});

test('shared spec: a swallowing sign before diagnosis puts an act-now box first in the plan', () => {
  const sit = { stage: 'unclear', tier: 'unclear', diagnosed: false, affectedRegions: ['bulbar'], otherRegions: ['arm', 'leg', 'breathing'], weekInWindow: 0, canWalkSafely: null, reasons: [], signs: { swallowing: true } };
  const plan = planFor(sit, {});
  assert.ok(Array.isArray(plan.actNow) && plan.actNow.some((a) => a.urgency === 'now'));
  assert.match(actNowHtml(plan.actNow), /role="alert"[\s\S]*<b>Now:<\/b>/);
  const quiet = planFor({ ...sit, signs: {} }, {});
  assert.deepEqual(quiet.actNow, []);
});
