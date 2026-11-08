// The kit's catalogue (app/js/home/catalog.js), checked against the contract in
// plans/home-monitoring-contracts.md: the ids, the fields, the enum values, and the
// sourcing rules (every MDC, trigger and verdict carries a source URL). A few tests run
// the catalogue through the Home plan's summary, to show its rules fire on the data the
// plan asks for (one weighing a week, a Monitoring-page result, a typed-in reading).
// Run: node --test "tests/home-catalog.test.mjs"
import test from 'node:test';
import assert from 'node:assert/strict';

// Imported in Node with no DOM: a pure module must not need one at import time.
assert.equal(typeof globalThis.document, 'undefined');
const { TESTS, SIGNALS, THRESHOLDS, VERDICTS, mdcFor, PCT_OF_BASELINE } = await import('../app/js/home/catalog.js');
const { assessDecline, toWeekly } = await import('../app/js/home/series.js');
// The Home plan's summary, to check that the catalogue's rules fire on the data the plan
// asks for. HOME_TESTS: the older Monitoring-page tests, which arrive as test rows.
const { summarize, checkThresholds } = await import('../app/js/home/summary.js');
const { HOME_TESTS } = await import('../app/js/engine.js');
const CATALOG = { TESTS, SIGNALS };
const MONDAYS = ['2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02']; // 4 weeks in a row
const AS_OF = '2026-11-08'; // the Sunday of the last week
const rowsOf = (regions) => regions.flatMap((g) => g.rows);

// ---------- the contract, written out by hand ----------
const TEST_UNITS = {
  ddk_rate: 'syllables/s', mpt: 's', single_breath_count: 'count', pause_pct: '%',
  typing_speed: 'characters/min', grip: 'kg',
  timed_walk_speed: 'm/s', sts30: 'repetitions', sts5_time: 's', tug_time: 's',
  eat10: 'score', breathing_symptoms: 'count', falls_week: 'count',
};
// steps and sleep_minutes: the contract gives "count per day" and "minutes"; the Apple
// Health importer and the demo write 'steps' and 'min', which the catalogue matches.
// (import/csv.js writes 'count' for steps, so CSV steps get no MDC band; reported.)
const SIGNAL_UNITS = {
  steps: 'steps', walking_speed: 'm/s', step_length: 'm', double_support: '%', walking_asymmetry: '%',
  walking_steadiness: '%', six_minute_walk: 'm', stair_ascent_speed: 'm/s', stair_descent_speed: 'm/s', falls: 'count',
  weight: 'kg', body_fat: '%', lean_mass: 'kg', grip: 'kg', temperature: 'degC', wrist_temp: 'degC',
  heart_rate: 'bpm', resting_hr: 'bpm', hrv_sdnn: 'ms', hrv_rmssd: 'ms', bp: 'mmHg', vo2max: 'mL/kg/min',
  spo2: '%', respiratory_rate: 'breaths/min', sleep_minutes: 'min', breathing_disturbances: 'as reported',
  fvc: '% predicted', peak_cough_flow: 'L/min',
};
const HOMETESTS_IDS = ['tap_right', 'tap_left', 'reading', 'weight', 'walk']; // app/js/hometests.js, read only
const REGIONS = ['arm', 'leg', 'bulbar', 'breathing', 'general', 'cognitive'];
const KINDS = ['mic', 'typing', 'stopwatch', 'count', 'questionnaire', 'manual'];
const FEEDS = ['engine-candidate', 'context', 'clinician-prompt'];
const VERDICT_WORDS = ['detects', 'monitors', 'context', 'no use'];
// 'contradicted' is the catalogue's one addition, used where the notes say the evidence
// goes against the signal changing (blood pressure as an early sign).
const GRADES = ['strong', 'moderate', 'weak', 'not studied', 'contradicted'];
const IMPLEMENTATIONS = ['working', 'experimental', 'manual'];
const CADENCES = ['weekly', 'every2weeks', 'monthly'];
const DOMAINS = ['nutrition', 'breathing', 'swallowing', 'speech', 'mobility', 'hand', 'cognition'];
const RULES = ['pctDropFromBaseline', 'below', 'above', 'atLeast'];
const REDUCERS = ['median', 'mean', 'sum', 'min', 'max', 'last']; // series.toWeekly
const URGENCIES = ['today', 'now']; // a red flag: contact the doctor the same day, or now
const NG127 = 'https://www.nice.org.uk/guidance/ng127/chapter/Recommendations-for-adults';
const QUESTIONNAIRES = ['eat10', 'breathing_symptoms', 'falls_week'];
const MUST_BE_CONTEXT = ['bp', 'heart_rate', 'resting_hr', 'hrv_sdnn', 'hrv_rmssd', 'sleep_minutes', 'temperature', 'wrist_temp'];

const TEST_FIELDS = ['id', 'label', 'short', 'region', 'kind', 'unit', 'higherIsBetter', 'decimals', 'cadence', 'minutes',
  'instructions', 'safety', 'practiceWeeks', 'mdc', 'feeds', 'verdict', 'evidence', 'implementation'];
const SIGNAL_FIELDS = ['id', 'label', 'region', 'unit', 'higherIsBetter', 'decimals', 'weekly', 'mdc', 'feeds', 'verdict', 'evidence', 'devices'];

const isUrl = (u) => {
  if (typeof u !== 'string') return false;
  try { return new URL(u).protocol === 'https:'; } catch { return false; }
};
const text = (s) => typeof s === 'string' && s.trim().length > 0;
const wholeAtLeast = (n, min) => Number.isInteger(n) && n >= min;
const sameSet = (a, b) => assert.deepEqual([...a].sort(), [...b].sort());

function checkEvidence(where, e) {
  assert.ok(e && typeof e === 'object', `${where}: evidence`);
  assert.ok(GRADES.includes(e.grade), `${where}: grade "${e.grade}"`);
  assert.ok(text(e.text), `${where}: evidence text`);
  assert.ok(Array.isArray(e.sources) && e.sources.length > 0, `${where}: at least one source`);
  for (const u of e.sources) assert.ok(isUrl(u), `${where}: source "${u}" is not an https URL`);
}

function checkMdc(where, m, entryUnit) {
  if (m === null) return;
  assert.ok(m && typeof m === 'object', `${where}: mdc is an object or null`);
  assert.ok((Number.isFinite(m.value) && m.value > 0) || text(m.text), `${where}: mdc has a value or text`);
  if (m.value !== undefined && m.value !== null) assert.ok(Number.isFinite(m.value) && m.value > 0, `${where}: mdc value above 0`);
  assert.ok(text(m.population), `${where}: mdc population`);
  assert.ok(isUrl(m.source), `${where}: mdc source URL`);
  assert.equal(typeof m.computedByUs, 'boolean', `${where}: mdc computedByUs`);
  assert.ok(m.unit === entryUnit || m.unit === PCT_OF_BASELINE, `${where}: mdc unit "${m.unit}" is the entry's own or a share of baseline`);
}

// ---------- ids ----------
test('the TESTS and SIGNALS ids are exactly the contract ids, each keyed by its own id', () => {
  sameSet(Object.keys(TESTS), Object.keys(TEST_UNITS));
  sameSet(Object.keys(SIGNALS), Object.keys(SIGNAL_UNITS));
  for (const [k, t] of Object.entries(TESTS)) assert.equal(t.id, k);
  for (const [k, s] of Object.entries(SIGNALS)) assert.equal(s.id, k);
});

test('units match the contract', () => {
  for (const [k, u] of Object.entries(TEST_UNITS)) assert.equal(TESTS[k].unit, u, k);
  for (const [k, u] of Object.entries(SIGNAL_UNITS)) assert.equal(SIGNALS[k].unit, u, k);
});

// ---------- TESTS ----------
test('every test has the contract fields with valid values', () => {
  for (const [id, t] of Object.entries(TESTS)) {
    for (const f of TEST_FIELDS) assert.ok(f in t, `${id}: missing ${f}`);
    assert.ok(text(t.label) && text(t.short), `${id}: label and short`);
    assert.ok(REGIONS.includes(t.region), `${id}: region "${t.region}"`);
    assert.ok(KINDS.includes(t.kind), `${id}: kind "${t.kind}"`);
    assert.equal(typeof t.higherIsBetter, 'boolean', `${id}: higherIsBetter`);
    assert.ok(wholeAtLeast(t.decimals, 0), `${id}: decimals`);
    assert.ok(CADENCES.includes(t.cadence), `${id}: cadence "${t.cadence}"`);
    assert.ok(Number.isFinite(t.minutes) && t.minutes > 0, `${id}: minutes`);
    assert.ok(Array.isArray(t.instructions) && t.instructions.length > 0 && t.instructions.every(text), `${id}: instructions`);
    assert.ok(Array.isArray(t.safety) && t.safety.every(text), `${id}: safety is a list of sentences ([] when none)`);
    assert.ok(wholeAtLeast(t.practiceWeeks, 0), `${id}: practiceWeeks`);
    assert.ok(FEEDS.includes(t.feeds), `${id}: feeds "${t.feeds}"`);
    assert.ok(VERDICT_WORDS.includes(t.verdict), `${id}: verdict "${t.verdict}"`);
    assert.ok(IMPLEMENTATIONS.includes(t.implementation), `${id}: implementation "${t.implementation}"`);
    checkEvidence(id, t.evidence);
    checkMdc(id, t.mdc, t.unit);
  }
});

test('no test that may feed the engine lacks an MDC', () => {
  const candidates = Object.values(TESTS).filter((t) => t.feeds === 'engine-candidate');
  // The engine's leg test is the phone walking test (HOME_TESTS.gait_speed, merged 8 Nov), so the
  // stopwatch walk must not be a second engine test: one leg decline would count twice.
  assert.equal(TESTS.timed_walk_speed.feeds, 'context');
  for (const t of candidates) assert.ok(t.mdc && Number.isFinite(t.mdc.value) && t.mdc.value > 0, t.id);
});

test('our microphone and typing timing tools are marked experimental', () => {
  for (const t of Object.values(TESTS)) {
    if (t.kind === 'mic' || t.kind === 'typing') assert.equal(t.implementation, 'experimental', t.id);
  }
  assert.equal(TESTS.grip.implementation, 'manual'); // a reading from a dynamometer
});

test('questions appear only where a licence is set, and only on questionnaires', () => {
  for (const [id, t] of Object.entries(TESTS)) {
    if (t.kind !== 'questionnaire') {
      assert.ok(!('questions' in t) && !('licence' in t), `${id}: questions and licence are for questionnaires only`);
      continue;
    }
    assert.ok(Array.isArray(t.questions), `${id}: questions is a list`);
    assert.ok(text(t.licence), `${id}: a questionnaire says its licence (or how to obtain the form)`);
    const qids = new Set();
    for (const q of t.questions) {
      assert.ok(text(q.id) && text(q.text), `${id}: question id and text`);
      assert.ok(!qids.has(q.id), `${id}: question id ${q.id} repeats`);
      qids.add(q.id);
      assert.ok(Array.isArray(q.options) && q.options.length >= 2, `${id}.${q.id}: options`);
      for (const o of q.options) assert.ok(text(o.label) && Number.isFinite(o.score), `${id}.${q.id}: option label and score`);
    }
  }
});

test('EAT-10 shows no questions (its licence does not allow it) and says how to get the form', () => {
  assert.deepEqual(TESTS.eat10.questions, []);
  assert.match(TESTS.eat10.licence, /licen[cs]e/i);
  assert.match(TESTS.eat10.licence, /https:\/\/eprovide\.mapi-trust\.org\//);
});

test('the breathing check is our own NICE-based checklist, labelled as not validated', () => {
  const b = TESTS.breathing_symptoms;
  assert.ok(b.questions.length > 0);
  assert.match(b.evidence.text, /not a validated questionnaire/i);
  assert.match(b.evidence.text, /NICE NG42/);
  assert.ok(b.evidence.sources.includes('https://www.nice.org.uk/guidance/ng42/chapter/Recommendations'));
  for (const q of b.questions) assert.deepEqual(q.options.map((o) => o.score), [0, 1], q.id);
});

test('the falls check is one question about falls and near-falls this week', () => {
  const f = TESTS.falls_week;
  assert.equal(f.questions.length, 1);
  assert.match(f.questions[0].text, /fall/i);
  assert.match(f.questions[0].text, /near-fall/i);
  assert.match(f.questions[0].text, /this week/i);
  assert.ok(f.questions[0].options.every((o) => wholeAtLeast(o.score, 0)), 'the score is a count of falls');
});

test('a near-fall is marked on its own option: it scores 0 but can be saved as a near-fall', () => {
  const f = TESTS.falls_week;
  const marked = f.questions[0].options.filter((o) => 'nearFall' in o);
  assert.equal(marked.length, 1, 'one option means a near-fall');
  assert.equal(marked[0].nearFall, true);
  assert.match(marked[0].label, /no falls, but at least one near-fall/i);
  assert.equal(marked[0].score, 0, 'the score counts falls only');
  assert.match(f.evidence.text, /saved as a near-fall/, 'the evidence text says what is saved');
});

test('the breathing check asks about breathlessness at rest apart from on effort', () => {
  const qs = Object.fromEntries(TESTS.breathing_symptoms.questions.map((q) => [q.id, q]));
  assert.match(qs.breathless_rest.text, /at rest/i);
  assert.match(qs.breathless_effort.text, /when doing things/i);
  assert.match(qs.lying_flat.text, /lying flat/i);
  assert.ok(!('breathless' in qs), 'the old question that joined rest and effort is gone');
  for (const q of Object.values(qs)) assert.doesNotMatch(q.text, /at rest or when doing things/i, q.id);
});

test('breathless at rest or lying flat is a same-day red flag (NICE NG127 1.7.5); breathless on effort is not', () => {
  const qs = TESTS.breathing_symptoms.questions;
  assert.deepEqual(qs.filter((q) => q.redFlag).map((q) => q.id).sort(), ['breathless_rest', 'lying_flat']);
  for (const q of qs.filter((x) => x.redFlag)) {
    assert.equal(q.redFlag.urgency, 'today', q.id);
    assert.equal(q.redFlag.text, 'Short of breath at rest or when lying flat: contact your doctor today, the same day.', q.id);
    assert.equal(q.redFlag.source, NG127, q.id);
    assert.equal(q.redFlag.sourceLabel, 'NICE NG127, 1.7.5', q.id);
  }
});

test('an EAT-10 total of 3 or more is a red flag: contact the doctor now (NICE NG127 1.7.5)', () => {
  const f = TESTS.eat10.redFlag;
  assert.ok(f, 'EAT-10 has a red flag');
  assert.equal(f.atLeast, 3);
  assert.equal(f.urgency, 'now');
  assert.equal(f.text, 'A score of 3 or more counts as trouble swallowing: contact your doctor now. If MND is suspected, the referral should be urgent.');
  assert.equal(f.source, NG127);
  assert.equal(f.sourceLabel, 'NICE NG127, 1.7.5');
  // the same cut-off as the swallowing rule after diagnosis
  assert.equal(f.atLeast, THRESHOLDS.find((t) => t.id === 'swallowing_eat10_3').when.value);
});

test('every red flag says how soon, in words, with a source; a question\'s flag is for its Yes', () => {
  let n = 0;
  for (const [id, t] of Object.entries(TESTS)) {
    const flags = [[id, t.redFlag, true], ...(t.questions || []).map((q) => [`${id}.${q.id}`, q.redFlag, false, q])];
    for (const [where, f, onTest, q] of flags) {
      if (f === undefined) continue;
      n++;
      assert.ok(URGENCIES.includes(f.urgency), `${where}: urgency "${f.urgency}"`);
      assert.ok(text(f.text) && isUrl(f.source) && text(f.sourceLabel), `${where}: text, source URL and sourceLabel`);
      if (onTest) assert.ok(Number.isFinite(f.atLeast), `${where}: a test's flag needs atLeast`);
      else assert.deepEqual(q.options.map((o) => [o.label, o.score]), [['No', 0], ['Yes', 1]], `${where}: a flagged question is No or Yes`);
    }
  }
  assert.equal(n, 3, 'EAT-10, breathless at rest, breathless lying flat');
});

test('a questionnaire\'s week is its highest answer, so a second answer never averages a red flag away', () => {
  for (const id of QUESTIONNAIRES) assert.deepEqual(TESTS[id].weekly, { reduce: 'max', minPerWeek: 1 }, id);
  for (const [id, t] of Object.entries(TESTS)) {
    if (!('weekly' in t)) continue;
    assert.ok(REDUCERS.includes(t.weekly?.reduce), `${id}: weekly.reduce "${t.weekly?.reduce}"`);
    assert.ok(wholeAtLeast(t.weekly?.minPerWeek, 1), `${id}: weekly.minPerWeek`);
  }
  // Monday and Wednesday of one week: "No falls" then "1 fall"; EAT-10 2 then 3; breathing 0 then 1.
  // With the catalogue's own weekly rule, the week still meets each rule's number.
  for (const [id, values, ruleId] of [['falls_week', [0, 1], 'mobility_falls'], ['eat10', [2, 3], 'swallowing_eat10_3'], ['breathing_symptoms', [0, 1], 'breathing_symptoms']]) {
    const weeks = toWeekly(values.map((value, i) => ({ date: ['2026-11-02', '2026-11-04'][i], value })), TESTS[id].weekly);
    const rule = THRESHOLDS.find((t) => t.id === ruleId).when;
    assert.equal(rule.rule, 'atLeast', ruleId);
    assert.deepEqual(weeks.map((w) => w.value), [Math.max(...values)], id);
    assert.ok(weeks[0].value >= rule.value, `${ruleId}: ${weeks[0].value} meets "at least ${rule.value}"`);
  }
});

test('standing tests carry a supervision rule and a stop rule', () => {
  for (const id of ['timed_walk_speed', 'sts30', 'sts5_time', 'tug_time']) {
    const s = TESTS[id].safety.join(' ');
    assert.match(s, /someone in the room/i, id);
    assert.match(s, /stop if/i, id);
  }
});

// ---------- SIGNALS ----------
test('every signal has the contract fields with valid values', () => {
  for (const [id, s] of Object.entries(SIGNALS)) {
    for (const f of SIGNAL_FIELDS) assert.ok(f in s, `${id}: missing ${f}`);
    assert.ok(text(s.label), `${id}: label`);
    assert.ok(REGIONS.includes(s.region), `${id}: region "${s.region}"`);
    assert.equal(typeof s.higherIsBetter, 'boolean', `${id}: higherIsBetter`);
    assert.ok(wholeAtLeast(s.decimals, 0), `${id}: decimals`);
    assert.ok(REDUCERS.includes(s.weekly?.reduce), `${id}: weekly.reduce "${s.weekly?.reduce}"`);
    assert.ok(wholeAtLeast(s.weekly?.minPerWeek, 1), `${id}: weekly.minPerWeek`);
    assert.ok(FEEDS.includes(s.feeds), `${id}: feeds "${s.feeds}"`);
    assert.ok(VERDICT_WORDS.includes(s.verdict), `${id}: verdict "${s.verdict}"`);
    assert.ok(Array.isArray(s.devices) && s.devices.length > 0 && s.devices.every(text), `${id}: devices`);
    checkEvidence(id, s.evidence);
    checkMdc(id, s.mdc, s.unit);
  }
});

test('blood pressure, heart rate, HRV, sleep and temperature never count toward the score', () => {
  for (const id of MUST_BE_CONTEXT) assert.equal(SIGNALS[id].feeds, 'context', id);
  for (const s of Object.values(SIGNALS)) assert.notEqual(s.feeds, 'engine-candidate', `${s.id}: no passive signal feeds the engine yet`);
});

test('one weighing and one oximeter spot check a week each make a weekly value, as the plan asks', () => {
  // The weight MDC (2.35 kg) comes from single weighings; the plan asks for one a week.
  assert.equal(SIGNALS.weight.weekly.minPerWeek, 1);
  assert.equal(SIGNALS.spo2.weekly.minPerWeek, 1);
  // One reading a week, typed in with "Add a reading": weight down 6.25%, SpO2 down to 93%.
  const weekly = (signal, values, unit) => values.map((value, i) => ({ signal, start: MONDAYS[i], value, unit, source: 'manual', person: 'p' }));
  const samples = [...weekly('weight', [80, 80, 75, 75], 'kg'), ...weekly('spo2', [97, 97, 93, 93], '%')];
  const regions = summarize({ samples, catalog: CATALOG, asOf: AS_OF });
  for (const id of ['weight', 'spo2']) assert.equal(rowsOf(regions).find((r) => r.id === id).weekly.length, 4, id);
  const checked = checkThresholds(regions, THRESHOLDS);
  for (const id of ['nutrition_weight_loss', 'breathing_spo2']) {
    assert.ok(checked.some((c) => c.threshold.id === id && c.met === true), `${id}: ${JSON.stringify(checked.filter((c) => c.threshold.id === id).map((c) => [c.met, c.value, c.reason]))}`);
  }
});

// ---------- MDC helper ----------
test('mdcFor gives the MDC in the entry\'s own units, turning a share of baseline into units', () => {
  assert.equal(mdcFor(TESTS.timed_walk_speed, 1.2), TESTS.timed_walk_speed.mdc.value); // absolute: baseline ignored
  assert.ok(Math.abs(mdcFor(TESTS.grip, 30) - 30 * TESTS.grip.mdc.value / 100) < 1e-12); // 23.4% of 30 kg
  assert.equal(mdcFor(TESTS.grip, null), null); // a share needs a baseline
  assert.equal(mdcFor(TESTS.grip, 0), null);
  assert.equal(mdcFor(TESTS.typing_speed, 200), null); // no MDC published
  assert.equal(mdcFor(undefined, 1), null);
});

test('an MDC is marked computedByUs exactly when its text says it was computed', () => {
  for (const e of [...Object.values(TESTS), ...Object.values(SIGNALS)]) {
    if (!e.mdc) continue;
    assert.equal(/computed/i.test(e.mdc.text), e.mdc.computedByUs, `${e.id}: computedByUs ${e.mdc.computedByUs}, text "${e.mdc.text}"`);
  }
});

test('every catalogue MDC is accepted by series.assessDecline', () => {
  const weekly = [10, 10, 10, 10].map((value, i) => ({ week: `2026-01-${String(5 + 7 * i).padStart(2, '0')}`, value }));
  for (const e of [...Object.values(TESTS), ...Object.values(SIGNALS)]) {
    const m = mdcFor(e, 10);
    if (m === null) continue;
    assert.doesNotThrow(() => assessDecline(weekly, { mdc: m, higherIsBetter: e.higherIsBetter }), e.id);
  }
});

// ---------- THRESHOLDS ----------
test('every threshold has the contract fields, valid values and a source URL', () => {
  const ids = new Set();
  assert.ok(THRESHOLDS.length > 0);
  for (const t of THRESHOLDS) {
    assert.ok(text(t.id) && !ids.has(t.id), `threshold id "${t.id}" is set and unique`);
    ids.add(t.id);
    assert.ok(DOMAINS.includes(t.domain), `${t.id}: domain "${t.domain}"`);
    // kind is left out only where the measure arrives as both kinds (checked below).
    assert.ok(t.when && (!('kind' in t.when) || ['test', 'signal'].includes(t.when.kind)), `${t.id}: when.kind`);
    assert.ok(RULES.includes(t.when.rule), `${t.id}: when.rule "${t.when.rule}"`);
    assert.ok(Number.isFinite(t.when.value), `${t.id}: when.value`);
    assert.ok(text(t.when.unit), `${t.id}: when.unit`);
    if ('consecutive' in t.when) assert.ok(wholeAtLeast(t.when.consecutive, 1), `${t.id}: when.consecutive`);
    assert.ok(text(t.action) && text(t.patient), `${t.id}: action and patient wording`);
    assert.ok(isUrl(t.source), `${t.id}: source URL`);
    assert.ok(text(t.sourceLabel), `${t.id}: sourceLabel`);
  }
});

test('each threshold points at a real test or signal, in that entry\'s units', () => {
  for (const t of THRESHOLDS) {
    const { kind, id } = t.when;
    // A rule with no kind checks rows of both kinds, so it is held to every entry it can see.
    const entries = [kind !== 'signal' && TESTS[id], kind !== 'test' && SIGNALS[id]].filter(Boolean);
    // The only outside id allowed is an existing home test from app/js/hometests.js.
    const outside = kind !== 'signal' && HOMETESTS_IDS.includes(id);
    assert.ok(entries.length || outside, `${t.id}: unknown ${kind || 'test or signal'} "${id}"`);
    if (t.when.rule === 'pctDropFromBaseline') {
      assert.equal(t.when.unit, '%', t.id);
      assert.ok(t.when.value > 0 && t.when.value < 100, t.id);
    } else {
      for (const entry of entries) assert.equal(t.when.unit, entry.unit, t.id);
    }
  }
});

// Where a measure can arrive: a kit test or an older Monitoring-page test (the engine's
// HOME_TESTS, saved by app/js/hometests.js) is a test row; a scale, a watch, or a reading
// typed in or imported is a signal row.
const arrivesAs = (id) => [(TESTS[id] || HOME_TESTS[id]) && 'test', SIGNALS[id] && 'signal'].filter(Boolean);

test('a threshold checks every kind of row its measure arrives as', () => {
  assert.deepEqual(arrivesAs('weight'), ['test', 'signal'], 'a Monitoring-page weighing, or a scale');
  assert.deepEqual(arrivesAs('grip'), ['test', 'signal'], 'the kit grip test, or a reading typed in or imported');
  for (const t of THRESHOLDS) {
    const kinds = arrivesAs(t.when.id);
    if (kinds.length > 1) assert.ok(!('kind' in t.when), `${t.id}: "${t.when.id}" arrives as a test and as a signal, so the rule must not name one kind`);
    else assert.deepEqual([t.when.kind], kinds, `${t.id}: names the kind "${t.when.id}" arrives as`);
  }
});

test('in the summary, the weight and grip rules fire on a Monitoring-page weighing and a typed-in grip', () => {
  const legacyResults = MONDAYS.map((date, i) => ({ test: 'weight', date, value: [80, 80, 75, 75][i] })); // Monitoring page, 6.25% down
  const samples = MONDAYS.map((start, i) => ({ signal: 'grip', start, value: [30, 30, 20, 20][i], unit: 'kg', source: 'manual', person: 'p' })); // 33% down, 2 weeks
  const checked = checkThresholds(summarize({ legacyResults, samples, catalog: CATALOG, asOf: AS_OF }), THRESHOLDS);
  const metOn = (id) => checked.filter((c) => c.threshold.id === id && c.met === true).map((c) => c.row.kind);
  assert.deepEqual(metOn('nutrition_weight_loss'), ['test']);
  assert.deepEqual(metOn('hand_grip_drop'), ['signal']);
});

test('a rule whose words ask for a sustained change checks the latest weeks, not one', () => {
  const byId = Object.fromEntries(THRESHOLDS.map((t) => [t.id, t]));
  assert.equal(byId.speech_rate_120.when.consecutive, 2, 'reading speed: "act on a sustained trend, not one reading"');
  assert.equal(byId.hand_grip_drop.when.consecutive, 2, 'grip: two weekly means in a row below baseline');
  for (const t of THRESHOLDS) {
    // The words never claim more weeks than the rule checks.
    const words = `${t.patient} ${t.action}`;
    if (/stayed|sustained|in a row/i.test(words)) assert.ok(t.when.consecutive >= 2, `${t.id}: "${words.match(/[^.]*(stayed|sustained|in a row)[^.]*/i)[0].trim()}"`);
  }
  assert.match(byId.speech_rate_120.patient, /two weeks in a row/);
  assert.match(byId.hand_grip_drop.patient, /two weeks in a row/);
});

test('in the summary, the reading-speed and grip rules wait for a second week', () => {
  // Reading on the Monitoring page (an older test) and grip typed in: one week past the rule, then two.
  const met = (weeks, id) => {
    const legacyResults = weeks.reading.map((value, i) => ({ test: 'reading', date: MONDAYS[i], value }));
    const samples = weeks.grip.map((value, i) => ({ signal: 'grip', start: MONDAYS[i], value, unit: 'kg', source: 'manual', person: 'p' }));
    const checked = checkThresholds(summarize({ legacyResults, samples, catalog: CATALOG, asOf: AS_OF }), THRESHOLDS);
    return checked.filter((c) => c.threshold.id === id).map((c) => c.met);
  };
  const oneWeek = { reading: [150, 150, 110], grip: [30, 30, 20] };
  const twoWeeks = { reading: [150, 150, 110, 110], grip: [30, 30, 20, 20] };
  for (const id of ['speech_rate_120', 'hand_grip_drop']) {
    assert.ok(!met(oneWeek, id).includes(true), `${id}: not on one week`);
    assert.deepEqual(met(twoWeeks, id), [true], `${id}: two weeks in a row`);
  }
});

test('thresholds cover the guideline domains that have a home measure', () => {
  const domains = new Set(THRESHOLDS.map((t) => t.domain));
  for (const d of ['nutrition', 'breathing', 'swallowing', 'speech', 'mobility', 'hand']) assert.ok(domains.has(d), d);
});

// ---------- VERDICTS ----------
test('every verdict row has the contract fields, valid values and a source URL', () => {
  assert.ok(VERDICTS.length > 0);
  const items = new Set();
  for (const v of VERDICTS) {
    assert.ok(text(v.item) && !items.has(v.item), `verdict item "${v.item}" is set and unique`);
    items.add(v.item);
    assert.ok(REGIONS.includes(v.region), `${v.item}: region "${v.region}"`);
    assert.ok(VERDICT_WORDS.includes(v.verdict), `${v.item}: verdict "${v.verdict}"`);
    assert.ok(GRADES.includes(v.grade), `${v.item}: grade "${v.grade}"`);
    assert.ok(text(v.why), `${v.item}: why`);
    assert.ok(Array.isArray(v.sources) && v.sources.length > 0, `${v.item}: sources`);
    for (const u of v.sources) assert.ok(isUrl(u), `${v.item}: source "${u}"`);
  }
});

// A verdict row and the catalogue entries it describes must say the same thing: one item,
// one verdict and one evidence grade. gradeToo: false where a row joins entries graded
// differently (the chair tests: five timed stands weak, the 30-second count not studied).
const SAME_ITEM = [
  ['Body weight (scale)', [['signal', 'weight']]],
  ['Daily steps', [['signal', 'steps']]],
  ['Blood oxygen (SpO2) at night', [['signal', 'spo2']]],
  ['Breathing rate at night', [['signal', 'respiratory_rate']]],
  ['Breathing disturbances and sleep apnea alerts', [['signal', 'breathing_disturbances']]],
  ['Home spirometry (FVC)', [['signal', 'fvc']]],
  ['Sleep tracking', [['signal', 'sleep_minutes']]],
  ['VO2 max estimate', [['signal', 'vo2max']]],
  ['Watch fall detection', [['signal', 'falls']]],
  ['Blood pressure (home cuff)', [['signal', 'bp']]],
  ['Temperature (wrist or body)', [['signal', 'temperature'], ['signal', 'wrist_temp']]],
  ['Heart rate and heart rate variability', [['signal', 'heart_rate'], ['signal', 'resting_hr'], ['signal', 'hrv_sdnn'], ['signal', 'hrv_rmssd']]],
  ['Body composition (scale or watch bioimpedance)', [['signal', 'body_fat'], ['signal', 'lean_mass']]],
  ['iPhone walking speed and gait metrics', [['signal', 'walking_speed'], ['signal', 'step_length'], ['signal', 'double_support'], ['signal', 'walking_asymmetry'], ['signal', 'walking_steadiness']]],
  ['Grip dynamometer', [['test', 'grip'], ['signal', 'grip']]],
  ['Pauses while reading (microphone)', [['test', 'pause_pct']]],
  ['Syllable repetition, pa-ta-ka (microphone)', [['test', 'ddk_rate']]],
  ['Maximum phonation time (microphone)', [['test', 'mpt']]],
  ['Single-breath count (microphone)', [['test', 'single_breath_count']]],
  ['Typing (touchscreen copy task)', [['test', 'typing_speed']]],
  ['Timed walk (stopwatch)', [['test', 'timed_walk_speed']]],
  ['Timed up and go (stopwatch)', [['test', 'tug_time']]],
  ['Chair-stand tests (30-second count, five timed stands)', [['test', 'sts30'], ['test', 'sts5_time']], { gradeToo: false }],
  ['Swallowing questionnaire (EAT-10)', [['test', 'eat10']]],
];

test('a verdict row and the catalogue entries it describes agree on verdict and grade', () => {
  for (const [item, entries, { gradeToo = true } = {}] of SAME_ITEM) {
    const row = VERDICTS.find((v) => v.item === item);
    assert.ok(row, `no verdict row "${item}"`);
    for (const [kind, id] of entries) {
      const e = kind === 'test' ? TESTS[id] : SIGNALS[id];
      assert.equal(e.verdict, row.verdict, `${kind} ${id} says "${e.verdict}", the row "${item}" says "${row.verdict}"`);
      if (gradeToo) assert.equal(e.evidence.grade, row.grade, `${kind} ${id} grade "${e.evidence.grade}", the row "${item}" grade "${row.grade}"`);
    }
  }
});

test('body weight monitors, as in docs/HOME_MONITORING.md ("monitors; prompts a weight-loss note")', () => {
  const row = VERDICTS.find((v) => v.item === 'Body weight (scale)');
  assert.equal(row.verdict, 'monitors');
  assert.equal(SIGNALS.weight.verdict, 'monitors');
  assert.match(row.why, /after diagnosis/i);
});

test('the thinking-screen row says remote screens are only partly validated, with the numbers', () => {
  const row = VERDICTS.find((v) => v.item === 'Thinking and behaviour screens (ECAS by video, ALS-CBS by phone)');
  assert.doesNotMatch(row.why, /remote screens are validated/);
  assert.match(row.why, /partly validated/);
  assert.match(row.why, /27 people without ALS/); // Gray 2024
  assert.match(row.why, /6\.2 points higher/); // Didcote 2024, independent samples
  assert.match(row.why, /ICC 0\.50/); // Christodoulou 2016
  assert.match(row.why, /same mode each time/);
  for (const u of ['https://doi.org/10.1080/21678421.2023.2278512', 'https://doi.org/10.1007/s10072-024-07661-y', 'https://doi.org/10.3109/21678421.2016.1173703']) {
    assert.ok(row.sources.includes(u), `source ${u}`);
  }
});

test('the verdict table covers every data type the task names', () => {
  const rows = VERDICTS.map((v) => v.item.toLowerCase());
  const needs = {
    'blood pressure': /blood pressure/, 'heart rate': /heart rate/, ECG: /ecg/, SpO2: /spo2/,
    temperature: /temperature/, 'EMG and fasciculations': /emg|fasciculation/, EIM: /\beim\b/,
    camera: /camera|video/, microphone: /microphone/, touchscreen: /touchscreen/,
  };
  for (const [name, re] of Object.entries(needs)) assert.ok(rows.some((r) => re.test(r)), `no row for ${name}`);
  assert.ok(rows.some((r) => /fasciculation/.test(r)) && rows.some((r) => /\bemg\b/.test(r)), 'both EMG and fasciculation rows');
});
