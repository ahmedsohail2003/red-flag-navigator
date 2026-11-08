// Tests for app/js/home/protocol.js: situation from the engine, plan by situation, sourced rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateAt } from '../app/js/engine.js';
import { getCase, listCases, newCaseTemplate } from '../app/js/cases.js';
import { DEVICES, QUESTIONS, RULES, situationFrom, planFor } from '../app/js/home/protocol.js';

// Ids from plans/home-monitoring-contracts.md (the catalog is being rewritten at the same time).
const CONTRACT_TESTS = ['ddk_rate', 'mpt', 'single_breath_count', 'pause_pct', 'typing_speed', 'grip', 'timed_walk_speed', 'sts30', 'sts5_time', 'tug_time', 'eat10', 'breathing_symptoms', 'falls_week'];
const CONTRACT_SIGNALS = ['steps', 'walking_speed', 'step_length', 'double_support', 'walking_asymmetry', 'walking_steadiness', 'six_minute_walk', 'stair_ascent_speed', 'stair_descent_speed', 'falls',
  'weight', 'body_fat', 'lean_mass', 'grip', 'temperature', 'wrist_temp', 'heart_rate', 'resting_hr', 'hrv_sdnn', 'hrv_rmssd', 'bp', 'vo2max',
  'spo2', 'respiratory_rate', 'sleep_minutes', 'breathing_disturbances', 'fvc', 'peak_cough_flow'];
const CONTRACT_DEVICES = ['iphone', 'android', 'apple_watch', 'other_watch', 'smart_scale', 'bp_cuff', 'oximeter', 'dynamometer', 'none'];
const QUESTIONNAIRES = ['eat10', 'breathing_symptoms', 'falls_week'];
const WALKING = ['timed_walk_speed', 'tug_time', 'sts30', 'sts5_time'];
const MOTOR = ['arm', 'leg', 'bulbar', 'breathing'];
const URL = /^https:\/\/\S+$/;
// Text a person reads must never show a broken template.
const JUNK = /undefined|NaN|\[object|\bOn {2}|\bnull\b/;

const alex = getCase('alex').caseFile;
const sitAt = (caseFile, asOf, answers) => situationFrom({ caseFile, asOf, evaluation: evaluateAt(caseFile, asOf), answers });
const items = (plan) => [...plan.weekly, ...plan.every2weeks, ...plan.monthly];
const ids = (plan) => items(plan).map((i) => i.id);
const sit = (over = {}) => ({
  stage: 'unclear', tier: 'unclear', diagnosed: false, affectedRegions: [], otherRegions: [...MOTOR],
  weekInWindow: 0, canWalkSafely: null, reasons: [], signs: {}, ...over,
});

test('DEVICES has exactly the contract ids, each with a label', () => {
  assert.deepEqual(DEVICES.map((d) => d.id).sort(), [...CONTRACT_DEVICES].sort());
  for (const d of DEVICES) {
    assert.ok(typeof d.label === 'string' && d.label.length > 0, d.id);
    for (const s of d.signals) assert.ok(CONTRACT_SIGNALS.includes(s), `${d.id} provides unknown signal ${s}`);
  }
  for (const q of QUESTIONS) assert.ok(q.id && q.text && q.options.length >= 2, q.id);
});

test("Alex: the stage at each encounter is the engine's tier, and 'diagnosed' from 14 Jul 2026", () => {
  for (const enc of alex.encounters) {
    const ev = evaluateAt(alex, enc.date);
    const s = situationFrom({ caseFile: alex, asOf: enc.date, evaluation: ev });
    assert.ok(enc.date < '2026-07-14');
    assert.equal(s.stage, ev.tier, enc.date);
    assert.equal(s.diagnosed, false);
    assert.equal(s.tier, ev.tier);
  }
  assert.notEqual(sitAt(alex, '2026-07-13').stage, 'diagnosed');
  for (const d of ['2026-07-14', '2026-07-15', '2026-09-22', '2027-01-01']) {
    const s = sitAt(alex, d);
    assert.equal(s.stage, 'diagnosed', d);
    assert.equal(s.diagnosed, true);
  }
});

test('Alex: regions grow with his notes; falls and foot drop switch walking off until he answers', () => {
  const first = sitAt(alex, '2024-10-14');
  assert.deepEqual(first.affectedRegions, ['arm']);
  assert.deepEqual(first.otherRegions, ['leg', 'bulbar', 'breathing']);
  assert.equal(first.canWalkSafely, null);
  assert.deepEqual(sitAt(alex, '2025-04-21').affectedRegions, ['arm', 'leg']);
  assert.deepEqual(sitAt(alex, '2026-06-11').affectedRegions, ['arm', 'leg', 'bulbar']);
  assert.equal(sitAt(alex, '2025-04-21').canWalkSafely, false); // foot drop
  assert.equal(sitAt(alex, '2025-04-21', { canWalkSafely: true }).canWalkSafely, true);
  for (const d of ['2024-10-14', '2026-07-14']) {
    const s = sitAt(alex, d);
    assert.ok(s.reasons.length >= 2 && s.reasons.every((r) => typeof r === 'string' && r.length > 0));
  }
  assert.equal(sitAt(alex, '2026-07-14').signs.breathing, true); // "sleeping on two pillows"
});

test('situationFrom works for every built-in case on every visit date, and for a case with no visits', () => {
  const cases = listCases();
  assert.ok(cases.length >= 8, 'Alex and the seven look-alikes');
  const check = (s, where) => {
    assert.ok(['low', 'unclear', 'high', 'diagnosed'].includes(s.stage), where);
    assert.deepEqual([...s.affectedRegions, ...s.otherRegions].sort(), [...MOTOR].sort(), where);
    assert.ok([true, false, null].includes(s.canWalkSafely), where);
    assert.ok(s.weekInWindow === null || (Number.isInteger(s.weekInWindow) && s.weekInWindow >= 0), where);
    assert.ok(s.reasons.length >= 2, where);
    for (const r of s.reasons) {
      assert.ok(typeof r === 'string' && r.length > 10, where);
      assert.doesNotMatch(r, JUNK, `${where}: ${r}`);
    }
    assert.doesNotThrow(() => JSON.stringify(s));
    assert.equal(planFor(s).stage, s.stage, where);
  };
  for (const c of cases) {
    const cf = c.caseFile;
    for (const d of [...new Set([...(cf.encounters || []).map((e) => e.date), '2026-11-08'])]) {
      const ev = evaluateAt(cf, d);
      const s = situationFrom({ caseFile: cf, asOf: d, evaluation: ev });
      check(s, `${c.id} ${d}`);
      const dx = cf.actual?.diagnosis;
      assert.equal(s.stage, dx && dx <= d ? 'diagnosed' : ev.tier, `${c.id} ${d}`);
      assert.equal(s.weekInWindow === null, s.stage !== 'unclear', `${c.id} ${d}`);
    }
  }
  // A case with no visits, with and without a date; and no case at all.
  const blank = newCaseTemplate();
  for (const asOf of [null, '2026-11-08']) {
    const s = situationFrom({ caseFile: blank, asOf, evaluation: asOf ? evaluateAt(blank, asOf) : undefined });
    check(s, `no visits, asOf ${asOf}`);
    assert.equal(s.stage, 'low');
    assert.ok(s.reasons.some((r) => /no visits are recorded/i.test(r)));
    assert.deepEqual(items(planFor(s)), []);
  }
  check(situationFrom({}), 'empty object');
  check(situationFrom(), 'no argument');
  assert.ok(situationFrom().reasons.some((r) => /no evaluation yet/i.test(r)));
});

test('situationFrom computes the evaluation when it is not given, and tolerates missing parts', () => {
  const a = situationFrom({ caseFile: alex, asOf: '2025-04-21' });
  const b = sitAt(alex, '2025-04-21');
  assert.deepEqual(a, b);
  const empty = situationFrom({});
  assert.equal(empty.stage, 'low');
  assert.deepEqual(empty.affectedRegions, []);
  assert.equal(empty.weekInWindow, null);
  // A Set of motor regions passed as a plain array still works.
  const arr = situationFrom({ caseFile: { encounters: [] }, asOf: '2025-01-01', evaluation: { tier: 'unclear', state: { motorRegions: ['leg'] } } });
  assert.deepEqual(arr.affectedRegions, ['leg']);
});

test('an unclear arm case: weekly arm tests, the other regions screened every 2 weeks', () => {
  const cf = getCase('demo-cts_severe').caseFile; // focal weakness and wasting in the arm
  const s = sitAt(cf, '2025-01-15');
  assert.equal(s.stage, 'unclear');
  assert.deepEqual(s.affectedRegions, ['arm']);
  assert.equal(s.weekInWindow, 0);
  assert.equal(sitAt(cf, '2025-02-12').weekInWindow, 4); // counted to asOf, not to the last data point
  const plan = planFor(s, { devices: ['dynamometer'] });
  assert.equal(plan.stage, 'unclear');
  const weekly = plan.weekly.map((i) => i.id);
  assert.ok(weekly.includes('typing_speed') && weekly.includes('grip'));
  for (const i of plan.weekly.filter((x) => ['typing_speed', 'grip'].includes(x.id))) assert.equal(i.practice, true);
  assert.ok(weekly.includes('weight') && weekly.includes('falls_week'));
  assert.equal(plan.weekly.find((i) => i.id === 'weight').kind, 'signal');
  assert.equal(plan.weekly.find((i) => i.id === 'falls_week').kind, 'question');
  // Leg and bulbar screened every 2 weeks; breathing by the weekly breathing check.
  const every2 = plan.every2weeks.map((i) => i.id);
  assert.ok(every2.includes('timed_walk_speed'), 'leg screen');
  assert.ok(every2.includes('ddk_rate'), 'bulbar screen');
  assert.ok(weekly.includes('breathing_symptoms'), 'breathing check');
  assert.ok(!weekly.includes('timed_walk_speed') && !weekly.includes('ddk_rate'));
  // Without a dynamometer there is no grip test.
  assert.ok(!ids(planFor(s, { devices: [] })).includes('grip'));
  // The 8-week decision, stored history and the existing tests are in the notes; its rules are triggers.
  const notes = plan.notes.join(' ');
  assert.match(notes, /week-8 decision/i);
  assert.match(notes, /stored history/i);
  assert.match(notes, /finger-tapping/i);
  const rules = plan.triggers.map((t) => t.rule);
  for (const r of ['unclear-decline', 'unclear-second-region', 'unclear-week-8', 'unclear-breathless']) assert.ok(rules.includes(r), r);
});

test('an unclear bulbar case adds the swallowing questionnaire; a leg case tests walking weekly', () => {
  const bulbar = planFor(sitAt(getCase('demo-bulbar_early').caseFile, '2025-01-15'));
  assert.ok(bulbar.weekly.some((i) => i.id === 'ddk_rate'));
  assert.ok(bulbar.every2weeks.some((i) => i.id === 'eat10' && i.kind === 'question'));
  assert.ok(bulbar.every2weeks.some((i) => i.id === 'typing_speed'));
  const leg = planFor(sit({ affectedRegions: ['leg'], otherRegions: ['arm', 'bulbar', 'breathing'] }));
  assert.equal(leg.weekly[0].id, 'timed_walk_speed'); // the top-ranked leg test comes first
});

test('canWalkSafely false removes every walking and chair-stand item', () => {
  const base = { stage: 'diagnosed', diagnosed: true, affectedRegions: ['leg'], otherRegions: ['arm', 'bulbar', 'breathing'] };
  const ok = planFor(sit({ ...base, canWalkSafely: true }));
  for (const id of ['timed_walk_speed', 'sts30', 'tug_time']) assert.ok(ids(ok).includes(id), id);
  const notSafe = planFor(sit({ ...base, canWalkSafely: false }));
  for (const id of WALKING) assert.ok(!ids(notSafe).includes(id), id);
  assert.ok(notSafe.safety.some((t) => /walking and chair tests are off/i.test(t)));
  // The same in an unclear leg case, and through the answers.
  const unclear = sit({ affectedRegions: ['leg'], otherRegions: ['arm', 'bulbar', 'breathing'] });
  for (const id of WALKING) assert.ok(!ids(planFor(unclear, { answers: { canWalkSafely: false } })).includes(id));
  assert.ok(ids(planFor(unclear)).includes('timed_walk_speed'));
  // A wheelchair, or needing arms to stand, removes the right items.
  for (const id of WALKING) assert.ok(!ids(planFor(sit({ ...base }), { answers: { walkingAid: 'wheelchair' } })).includes(id));
  const arms = ids(planFor(sit({ ...base, canWalkSafely: true }), { answers: { needsArmsToStand: true } }));
  assert.ok(!arms.includes('sts30') && arms.includes('timed_walk_speed'));
});

test('never alone after falls: walking items carry a someone-beside-you rule', () => {
  const s = sit({ stage: 'diagnosed', diagnosed: true, affectedRegions: ['leg'], otherRegions: ['arm', 'bulbar', 'breathing'], canWalkSafely: true, signs: { falls: true } });
  const plan = planFor(s);
  const walking = items(plan).filter((i) => WALKING.includes(i.id));
  assert.ok(walking.length >= 2);
  for (const i of walking) assert.match(i.safety[0], /never alone|someone beside you/i, i.id);
  // Alex after diagnosis: falls and foot drop recorded, he says he can walk safely.
  const alexPlan = planFor(sitAt(alex, '2026-09-22'), { answers: { canWalkSafely: true } });
  const walk = items(alexPlan).find((i) => i.id === 'timed_walk_speed');
  assert.ok(walk && /never alone/.test(walk.safety[0]));
});

test('a recent fall with no walking answer keeps walking off, the same way in both functions', () => {
  const unclearLeg = sit({ affectedRegions: ['leg'], otherRegions: ['arm', 'bulbar', 'breathing'] });
  const plan = planFor(unclearLeg, { answers: { fallsRecently: true } });
  for (const id of WALKING) assert.ok(!ids(plan).includes(id), id);
  assert.ok(plan.notes.some((n) => /legs have no home test/.test(n)), 'says the legs are uncovered');
  // situationFrom with the same answer agrees, and says why in plain words.
  const s = sitAt(getCase('demo-cts_severe').caseFile, '2025-01-15', { fallsRecently: true });
  assert.equal(s.canWalkSafely, false);
  assert.ok(s.reasons.some((r) => /fallen or nearly fallen/.test(r)));
  for (const id of WALKING) assert.ok(!ids(planFor(s)).includes(id), id);
  // Saying "yes, I can walk safely" turns them back on, never alone.
  const back = planFor(unclearLeg, { answers: { fallsRecently: true, canWalkSafely: true } });
  const walk = back.weekly.find((i) => i.id === 'timed_walk_speed');
  assert.ok(walk && /never alone/.test(walk.safety[0]));
  // Foot drop with walking allowed still asks for someone beside you.
  const fd = planFor(sit({ stage: 'diagnosed', diagnosed: true, affectedRegions: ['leg'], otherRegions: ['arm', 'bulbar', 'breathing'], canWalkSafely: true, signs: { footDrop: true } }));
  const fdWalking = items(fd).filter((x) => WALKING.includes(x.id));
  assert.ok(fdWalking.length >= 2);
  for (const i of fdWalking) assert.match(i.safety[0], /someone beside you/, i.id);
  // The safety line gives the real reason: never blame falls when the person said no.
  const said = planFor(unclearLeg, { answers: { canWalkSafely: false } });
  assert.ok(said.safety.some((t) => /because you said you cannot walk safely/.test(t)));
  assert.ok(!said.safety.some((t) => /falls or foot drop/.test(t)));
});

test('blood pressure, heart rate and oximeter items are context only, never tests', () => {
  const CONTEXT = ['bp', 'heart_rate', 'resting_hr', 'hrv_sdnn', 'hrv_rmssd', 'spo2'];
  const everything = DEVICES.map((d) => d.id);
  for (const stage of ['unclear', 'high', 'diagnosed']) {
    for (const regions of [[], ['arm'], ['bulbar'], [...MOTOR]]) {
      const plan = planFor(sit({ stage, affectedRegions: regions, otherRegions: MOTOR.filter((r) => !regions.includes(r)) }), { devices: everything, answers: { breathingSymptoms: true } });
      for (const i of items(plan)) assert.ok(!CONTEXT.includes(i.id), `${stage}: ${i.id} is never a test`);
      const vitals = plan.passive.filter((p) => CONTEXT.includes(p.signal));
      for (const want of [['bp', 'bp_cuff'], ['resting_hr', 'apple_watch'], ['spo2', 'oximeter'], ['spo2', 'apple_watch']]) {
        assert.ok(vitals.some((p) => p.signal === want[0] && p.device === want[1]), `${stage} ${want}`);
      }
      for (const p of vitals) {
        assert.equal(p.contextOnly, true, `${stage} ${p.signal} ${p.device}`);
        assert.match(p.why, /context only/i, `${stage} ${p.signal} ${p.device}`);
      }
      // Only weight and recorded falls reach the score, and only through the clinician's note.
      for (const p of plan.passive) assert.equal(p.contextOnly, !['weight', 'falls'].includes(p.signal), p.signal);
    }
  }
  // The blood-pressure trigger: after diagnosis, only with a cuff, and it says it never scores.
  const dx = sit({ stage: 'diagnosed', diagnosed: true, affectedRegions: ['arm'], otherRegions: ['leg', 'bulbar', 'breathing'] });
  assert.ok(!planFor(dx).triggers.some((t) => t.rule === 'dx-orthostatic'));
  const bp = planFor(dx, { devices: ['bp_cuff'] }).triggers.find((t) => t.rule === 'dx-orthostatic');
  assert.ok(bp && /never counts toward the ALS score/.test(bp.then) && /Repeat the reading/.test(bp.then));
  for (const stage of ['low', 'unclear', 'high']) {
    assert.ok(!planFor(sit({ stage }), { devices: ['bp_cuff'] }).triggers.some((t) => t.rule === 'dx-orthostatic'), stage);
  }
  // The grip trigger needs a dynamometer.
  assert.ok(!planFor(dx).triggers.some((t) => t.rule === 'dx-grip-drop'));
  assert.ok(planFor(dx, { devices: ['dynamometer'] }).triggers.some((t) => t.rule === 'dx-grip-drop'));
});

test('a diagnosed case with breathing involvement has the breathing items and their triggers', () => {
  const s = sitAt(alex, '2026-09-22'); // bulbar involvement and breathless lying flat
  const plan = planFor(s, { devices: ['apple_watch', 'oximeter'] });
  const all = ids(plan);
  for (const id of ['breathing_symptoms', 'mpt', 'single_breath_count', 'eat10', 'weight', 'falls_week']) assert.ok(all.includes(id), id);
  // After diagnosis the weekly breathing check sends new symptoms to the team (the same-day
  // rule is the pre-diagnosis referral rule).
  const breath = plan.weekly.find((i) => i.id === 'breathing_symptoms');
  assert.ok(breath && /tell your team/i.test(breath.why) && !/same-day/.test(breath.why));
  const rules = plan.triggers.map((t) => t.rule);
  for (const r of ['dx-spo2', 'dx-fvc', 'dx-cough', 'dx-mpt-10', 'dx-mpt-8-sbc', 'dx-breathing-symptoms', 'dx-weight', 'dx-eat10-3', 'dx-speech', 'dx-foot-drop-falls', 'dx-hand', 'dx-cognition']) assert.ok(rules.includes(r), r);
  for (const t of plan.triggers) assert.match(t.source, URL, t.rule);
  assert.ok(plan.passive.some((p) => p.signal === 'spo2' && p.device === 'oximeter'));
  assert.ok(plan.passive.some((p) => p.signal === 'spo2' && p.device === 'apple_watch'));
  // Exercise advice from the evidence, with its warning signs and sources.
  assert.ok(plan.exercise.advice.some((a) => /physiotherapist/i.test(a)));
  assert.ok(plan.exercise.warningSigns.some((w) => /30 minutes/.test(w)));
  assert.ok(plan.exercise.sources.every((u) => URL.test(u)));
  assert.ok(plan.notes.some((n) => /physiotherapist/i.test(n)));
  assert.ok(plan.safety.some((n) => /30 minutes/.test(n)));
  // An arm-only diagnosed case with no breathing signs: no voice breathing tests, no lung triggers.
  const armOnly = planFor(sit({ stage: 'diagnosed', diagnosed: true, affectedRegions: ['arm'], otherRegions: ['leg', 'bulbar', 'breathing'] }));
  assert.ok(!ids(armOnly).includes('mpt') && !ids(armOnly).includes('single_breath_count'));
  assert.ok(!armOnly.triggers.some((t) => ['dx-fvc', 'dx-spo2', 'dx-cough'].includes(t.rule)));
  assert.ok(armOnly.monthly.some((i) => i.id === 'breathing_symptoms'), 'monthly breathing screen');
  // The breathing answer turns the breathing items on.
  assert.ok(ids(planFor(sit({ stage: 'diagnosed', diagnosed: true, affectedRegions: ['arm'] }), { answers: { breathingSymptoms: true } })).includes('mpt'));
});

test('low gives no tests, only the safety net', () => {
  const s = sitAt(getCase('demo-cts_typical').caseFile, '2025-01-15');
  assert.equal(s.stage, 'low');
  const plan = planFor(s, { devices: ['iphone', 'apple_watch', 'smart_scale', 'bp_cuff', 'oximeter', 'dynamometer'] });
  assert.deepEqual(plan.weekly, []);
  assert.deepEqual(plan.every2weeks, []);
  assert.deepEqual(plan.monthly, []);
  assert.deepEqual(plan.passive, []);
  assert.ok(plan.safety.length >= 4);
  assert.ok(plan.triggers.length >= 4 && plan.triggers.every((t) => URL.test(t.source)));
  assert.ok(plan.triggers.some((t) => t.rule === 'low-breathless'));
});

test('every built-in low case gets no tests and no device items, whatever it owns or answers', () => {
  const everything = DEVICES.map((d) => d.id);
  const lows = new Set();
  for (const c of listCases()) {
    for (const enc of c.caseFile.encounters || []) {
      const s = sitAt(c.caseFile, enc.date);
      if (s.stage !== 'low') continue;
      lows.add(c.id);
      for (const answers of [{}, { canWalkSafely: true }, { breathingSymptoms: true, walkingAid: 'cane' }]) {
        const plan = planFor(s, { devices: everything, answers });
        assert.deepEqual(items(plan), [], `${c.id} ${enc.date}`);
        assert.deepEqual(plan.passive, [], `${c.id} ${enc.date}`);
        assert.ok(plan.safety.length >= 4 && plan.triggers.length >= 4);
        assert.ok(plan.triggers.every((t) => t.rule.startsWith('low-')));
      }
    }
  }
  // The five look-alikes that score low on their one visit.
  for (const id of ['demo-cts_typical', 'demo-bfs', 'demo-peroneal', 'demo-radiculopathy', 'demo-older_nonspecific']) assert.ok(lows.has(id), id);
});

test('a step-down at week 8 says no decline does not rule out ALS', () => {
  const cf = structuredClone(getCase('demo-cts_severe').caseFile);
  const weeks = ['2025-01-15', '2025-01-22', '2025-01-29', '2025-02-05', '2025-02-12', '2025-02-19', '2025-02-26', '2025-03-05', '2025-03-12'];
  cf.homeTests = weeks.flatMap((date) => [{ date, test: 'tap_right', value: 55 }, { date, test: 'tap_left', value: 60 }]);
  const s = sitAt(cf, '2025-03-12');
  assert.equal(s.stage, 'low');
  assert.equal(s.steppedDown, true);
  assert.ok(s.reasons.some((r) => /does not rule out ALS/.test(r)));
  const plan = planFor(s);
  assert.deepEqual(items(plan), []);
  assert.ok(plan.notes.some((n) => /does not rule out ALS/.test(n)));
});

test('a referred (high) case keeps the weekly tests going and has the waiting rules', () => {
  const s = sitAt(alex, '2024-10-14');
  assert.equal(s.stage, 'high');
  const plan = planFor(s);
  assert.ok(plan.weekly.some((i) => i.id === 'typing_speed'));
  assert.ok(plan.every2weeks.some((i) => i.id === 'timed_walk_speed') && plan.every2weeks.some((i) => i.id === 'ddk_rate'));
  const rules = plan.triggers.map((t) => t.rule);
  for (const r of ['high-not-seen', 'high-worsening', 'high-swallowing', 'high-breathless']) assert.ok(rules.includes(r), r);
  assert.ok(plan.notes.some((n) => /move the referral up/.test(n)));
});

test('every rule and every trigger has a source URL', () => {
  const seen = new Set();
  for (const r of RULES) {
    assert.ok(!seen.has(r.id), `duplicate rule ${r.id}`);
    seen.add(r.id);
    assert.match(r.source, URL, r.id);
    assert.ok(r.sourceLabel && r.if && r.then, r.id);
    assert.ok(r.sources.length >= 1 && r.sources.every((u) => URL.test(u)), r.id);
    assert.ok(['guideline', 'study', 'our rule'].includes(r.basis), r.id);
    assert.ok(r.stages.length && r.stages.every((st) => ['low', 'unclear', 'high', 'diagnosed'].includes(st)), r.id);
  }
  for (const stage of ['low', 'unclear', 'high', 'diagnosed']) {
    const plan = planFor(sit({ stage, affectedRegions: ['bulbar'] }), { devices: ['bp_cuff'] });
    assert.ok(plan.triggers.length > 0, stage);
    for (const t of plan.triggers) {
      assert.match(t.source, URL, `${stage} ${t.rule}`);
      assert.ok(t.if && t.then);
    }
  }
  // The domains the guidelines monitor after diagnosis each have at least one rule.
  const dxDomains = new Set(RULES.filter((r) => r.stages.includes('diagnosed')).map((r) => r.domain));
  for (const d of ['nutrition', 'breathing', 'swallowing', 'speech', 'mobility', 'hand', 'cognition']) assert.ok(dxDomains.has(d), d);
  // Honest basis: a rule that calls itself our addition, pick, suggestion or mapping is "our rule".
  for (const r of RULES) {
    if (/\bour (addition|pick|suggestion|mapping)\b/i.test(`${r.if} ${r.then}`)) assert.equal(r.basis, 'our rule', r.id);
  }
  // Only the region's main test escalates an unclear case; the kit tests are context.
  assert.match(RULES.find((r) => r.id === 'unclear-decline').if, /main test/);
});

const NG127 = 'https://www.nice.org.uk/guidance/ng127/chapter/Recommendations-for-adults';

test('before diagnosis, a red flag already known goes in plan.actNow: breathing today, swallowing now', () => {
  // Alex on 11 Jun 2026, referred and waiting: "sleeping on two pillows" and coughing when drinking.
  const alexHigh = planFor(sitAt(alex, '2026-06-11'));
  assert.equal(alexHigh.stage, 'high');
  assert.deepEqual(alexHigh.actNow.map((a) => a.urgency), ['today', 'now']);
  const [breath, swallow] = alexHigh.actNow;
  assert.match(breath.text, /^Breathlessness is recorded in the notes\. If you are breathless at rest or when lying flat, contact your doctor today\./);
  assert.match(swallow.text, /^Trouble swallowing is recorded in the notes: contact your doctor now\./);
  for (const a of alexHigh.actNow) {
    assert.equal(a.source, NG127);
    assert.match(a.sourceLabel, /NG127, 1\.7\.5/);
  }
  // An unclear bulbar case that coughs on thin liquids: swallowing only.
  assert.deepEqual(planFor(sitAt(getCase('demo-bulbar_early').caseFile, '2025-01-15')).actNow.map((a) => a.urgency), ['now']);
  // The person's own answers count in every stage before diagnosis, low included.
  for (const stage of ['low', 'unclear', 'high']) {
    const flat = planFor(sit({ stage }), { answers: { breathlessLyingFlat: true } }).actNow;
    assert.equal(flat.length, 1, stage);
    assert.equal(flat[0].urgency, 'today');
    assert.match(flat[0].text, /^You said you are breathless when lying flat\. Contact your doctor today\./);
    assert.equal(flat[0].source, NG127);
    const night = planFor(sit({ stage }), { answers: { breathingSymptoms: true } }).actNow;
    assert.equal(night.length, 1, stage);
    assert.equal(night[0].urgency, 'today');
    assert.match(night[0].text, /headaches.*sleepy.*Contact your doctor today\./);
    assert.match(night[0].source, URL);
    assert.ok(night[0].sourceLabel);
  }
  const low = planFor(sitAt(getCase('demo-cts_typical').caseFile, '2025-01-15'), { answers: { breathlessLyingFlat: true } });
  assert.equal(low.stage, 'low');
  assert.deepEqual(low.actNow.map((a) => a.urgency), ['today']);
  // Nothing known: an empty list. After diagnosis the team's triggers take over, so it is always empty.
  assert.deepEqual(planFor(sitAt(getCase('demo-cts_severe').caseFile, '2025-01-15')).actNow, []);
  assert.deepEqual(planFor(sit(), { answers: { breathlessLyingFlat: false, breathingSymptoms: false } }).actNow, []);
  assert.deepEqual(planFor(undefined).actNow, []);
  const dx = planFor(sitAt(alex, '2026-09-22'), { answers: { breathlessLyingFlat: true, breathingSymptoms: true } });
  assert.equal(dx.stage, 'diagnosed');
  assert.deepEqual(dx.actNow, []);
  // Every built-in case on every visit: one item per sign in its notes, never after diagnosis.
  for (const c of listCases()) {
    for (const d of [...new Set([...(c.caseFile.encounters || []).map((e) => e.date), '2026-11-08'])]) {
      const s = sitAt(c.caseFile, d);
      const want = s.stage === 'diagnosed' ? [] : [s.signs.breathing && 'today', s.signs.swallowing && 'now'].filter(Boolean);
      const act = planFor(s).actNow;
      assert.deepEqual(act.map((a) => a.urgency), want, `${c.id} ${d}`);
      for (const a of act) {
        assert.match(a.source, URL);
        assert.doesNotMatch(a.text, JUNK);
      }
    }
  }
});

test("every trigger carries its rule's basis, so the view can mark our own rules", () => {
  for (const stage of ['low', 'unclear', 'high', 'diagnosed']) {
    const plan = planFor(sit({ stage, affectedRegions: ['bulbar'] }), { devices: ['bp_cuff', 'dynamometer'], answers: { breathingSymptoms: true } });
    assert.ok(plan.triggers.length > 0, stage);
    for (const t of plan.triggers) assert.equal(t.basis, RULES.find((r) => r.id === t.rule).basis, `${stage} ${t.rule}`);
  }
  const unclear = planFor(sit()).triggers;
  for (const id of ['unclear-decline', 'unclear-second-region']) assert.equal(unclear.find((t) => t.rule === id).basis, 'our rule', id);
  assert.equal(unclear.find((t) => t.rule === 'unclear-breathless').basis, 'guideline');
});

test('breathless lying flat is its own question; the other keeps headaches and sleepiness', () => {
  const flat = QUESTIONS.find((q) => q.id === 'breathlessLyingFlat');
  assert.ok(flat, 'breathlessLyingFlat question');
  assert.equal(flat.text, 'Are you breathless when lying flat?');
  assert.deepEqual(flat.options.map((o) => o.value), [true, false]);
  const other = QUESTIONS.find((q) => q.id === 'breathingSymptoms');
  assert.match(other.text, /headaches/);
  assert.match(other.text, /sleepy/);
  assert.doesNotMatch(other.text, /lying flat|breathless/i);
  // Either answer turns the breathing items and triggers on after diagnosis.
  const armDx = sit({ stage: 'diagnosed', diagnosed: true, affectedRegions: ['arm'], otherRegions: ['leg', 'bulbar', 'breathing'] });
  assert.ok(!ids(planFor(armDx)).includes('mpt'));
  for (const answers of [{ breathlessLyingFlat: true }, { breathingSymptoms: true }]) {
    const plan = planFor(armDx, { answers });
    assert.ok(ids(plan).includes('mpt'), JSON.stringify(answers));
    assert.ok(plan.weekly.some((i) => i.id === 'breathing_symptoms'), JSON.stringify(answers));
    assert.ok(plan.triggers.some((t) => t.rule === 'dx-fvc'), JSON.stringify(answers));
  }
});

test('before diagnosis the breathing and swallowing rules say whom to contact and when', () => {
  const then = (id) => RULES.find((r) => r.id === id).then;
  for (const id of ['unclear-breathless', 'high-breathless']) assert.match(then(id), /^Contact your doctor today: /, id);
  for (const id of ['unclear-swallowing', 'high-swallowing']) assert.match(then(id), /^Contact your doctor now: /, id);
  // The safety list before diagnosis has a swallowing line, not only a breathing one.
  for (const stage of ['unclear', 'high']) {
    const safety = planFor(sit({ stage })).safety;
    assert.ok(safety.some((t) => /swallowing/.test(t) && /contact your doctor now/.test(t)), stage);
    assert.ok(safety.some((t) => /lying flat/.test(t) && /same day/.test(t)), stage);
  }
  // Low keeps its own safety-net line; after diagnosis the team is told instead.
  assert.ok(planFor(sit({ stage: 'low' })).safety.some((t) => /swallowing/.test(t)));
  const dx = planFor(sit({ stage: 'diagnosed', diagnosed: true, affectedRegions: ['arm'] })).safety;
  assert.ok(!dx.some((t) => /referral urgent/.test(t)));
  assert.ok(dx.some((t) => /tell your team straight away/.test(t)));
});

test('only the main tests escalate an unclear case: the week-8 note and rule B2 name them', () => {
  const MAIN = [/finger tapping/, /reading/, /timed walk/, /Monitoring page/];
  const week8 = planFor(sit()).notes.find((n) => /week-8 decision:/.test(n));
  assert.ok(week8, 'week-8 note');
  for (const m of [/main test/, ...MAIN]) assert.match(week8, m);
  assert.match(week8, /other kit tests are context and never trigger this on their own/);
  assert.doesNotMatch(week8, /if a test drops/);
  const b2 = RULES.find((r) => r.id === 'unclear-second-region');
  for (const m of [/main test/, ...MAIN]) assert.match(b2.if, m);
  assert.match(b2.then, /do not trigger this on their own/);
  // B1 names the same three tests.
  for (const m of MAIN) assert.match(RULES.find((r) => r.id === 'unclear-decline').if, m);
});

test('syllable repetition before diagnosis is context only and not validated, wherever the plan has it', () => {
  const bulbar = { affectedRegions: ['bulbar'], otherRegions: ['arm', 'leg', 'breathing'] };
  const arm = { affectedRegions: ['arm'], otherRegions: ['leg', 'bulbar', 'breathing'] };
  const plans = [
    [sit(bulbar), 'weekly'], [sit({ stage: 'high', ...bulbar }), 'weekly'],
    [sit(arm), 'every2weeks'], [sit({ stage: 'high', ...arm }), 'every2weeks'],
  ];
  for (const [s, cadence] of plans) {
    const ddk = planFor(s)[cadence].find((i) => i.id === 'ddk_rate');
    assert.ok(ddk, `${s.stage} ${cadence}`);
    assert.match(ddk.why, /Context only/);
    assert.match(ddk.why, /not validated/);
    assert.match(ddk.why, /never triggers a referral on its own/);
  }
  // The WatchALS figure is named as WatchALS's, for its own 15-second iPhone task.
  const weekly = planFor(sit(bulbar)).weekly.find((i) => i.id === 'ddk_rate').why;
  assert.match(weekly, /WatchALS's 15-second iPhone version/);
  assert.match(weekly, /10-second browser version is not validated/);
  assert.doesNotMatch(weekly, /On iPhones its normal week-to-week variation/);
  // After diagnosis it monitors again (rule E11b), with no referral words.
  const dx = planFor(sit({ stage: 'diagnosed', diagnosed: true, ...arm }));
  assert.ok(dx.monthly.some((i) => i.id === 'ddk_rate' && !/referral/.test(i.why)));
});

test('the notes name the Monitoring page, the leg test when the legs are affected, and how imports are cut', () => {
  const notesOf = (plan) => plan.notes.join(' ');
  for (const stage of ['unclear', 'high', 'diagnosed']) {
    const n = notesOf(planFor(sit({ stage, diagnosed: stage === 'diagnosed' })));
    assert.match(n, /finger-tapping test \(both hands\) and the reading test on the Monitoring page each week: with Home data on/, stage);
    assert.doesNotMatch(n, /Home tests page|For the legs/, stage);
  }
  // Legs affected and walking allowed: the timed walk is named as their main test.
  const legs = { affectedRegions: ['leg'], otherRegions: ['arm', 'bulbar', 'breathing'] };
  for (const stage of ['unclear', 'high', 'diagnosed']) {
    const plan = planFor(sit({ stage, diagnosed: stage === 'diagnosed', ...legs }));
    assert.ok(ids(plan).includes('timed_walk_speed'), stage);
    // Since 05:15 on 8 Nov the engine's leg test is the phone walking test (HOME_TESTS.gait_speed);
    // the stopwatch walk is its backup and never counts a second time.
    assert.match(notesOf(plan), /For the legs, the main test is the walking test: the phone walking test on the Monitoring page, or the timed walk in this plan/, stage);
    assert.match(notesOf(plan), /the score counts only the phone test/, stage);
    // Walking off for safety: no timed walk in the plan, so the note names none.
    const off = planFor(sit({ stage, diagnosed: stage === 'diagnosed', ...legs }), { answers: { canWalkSafely: false } });
    assert.doesNotMatch(notesOf(off), /timed walk in this plan/, stage);
    assert.match(notesOf(off), /legs have no home test/, stage);
  }
  // History: what the view keeps from an import, not "the weeks just before the visit".
  const history = planFor(sit()).notes.find((x) => /stored history/.test(x));
  assert.match(history, /readings from 12 weeks before the first visit onward/);
  assert.match(history, /12 weeks before today when there is no visit yet/);
  assert.match(history, /cannot set the baseline/);
  assert.doesNotMatch(history, /can serve as a baseline|Health Connect/);
});

test('every id the plans use exists in the contract, with valid fields', () => {
  const devs = [[], ['none'], ['iphone'], ['android', 'other_watch'], ['iphone', 'apple_watch', 'smart_scale', 'bp_cuff', 'oximeter', 'dynamometer']];
  const answerSets = [{}, { canWalkSafely: true }, { canWalkSafely: false }, { walkingAid: 'wheelchair' }, { needsArmsToStand: true, fallsRecently: true }, { breathingSymptoms: true }, { breathlessLyingFlat: true }];
  const regionSets = [[], ['arm'], ['leg'], ['bulbar'], ['breathing'], ['arm', 'leg', 'bulbar', 'breathing']];
  const deviceIds = DEVICES.map((d) => d.id);
  let count = 0;
  for (const stage of ['low', 'unclear', 'high', 'diagnosed']) {
    for (const regions of regionSets) {
      for (const devices of devs) {
        for (const answers of answerSets) {
          const plan = planFor(sit({ stage, affectedRegions: regions, otherRegions: MOTOR.filter((r) => !regions.includes(r)) }), { devices, answers });
          assert.equal(plan.stage, stage);
          assert.ok(typeof plan.headline === 'string' && plan.headline.length > 0);
          const seen = new Set();
          for (const bucket of ['weekly', 'every2weeks', 'monthly']) {
            for (const i of plan[bucket]) {
              count++;
              assert.ok(['test', 'signal', 'question'].includes(i.kind), i.id);
              if (i.kind === 'signal') assert.ok(CONTRACT_SIGNALS.includes(i.id), i.id);
              else assert.ok(CONTRACT_TESTS.includes(i.id), i.id);
              assert.equal(i.kind === 'question', QUESTIONNAIRES.includes(i.id), i.id);
              assert.equal(i.cadence, bucket);
              assert.ok(typeof i.why === 'string' && i.why.length > 20, i.id);
              assert.equal(typeof i.practice, 'boolean');
              assert.ok(Array.isArray(i.safety));
              assert.ok(!seen.has(i.id), `${i.id} listed twice`);
              seen.add(i.id);
            }
          }
          for (const p of plan.passive) {
            assert.ok(CONTRACT_SIGNALS.includes(p.signal), p.signal);
            assert.ok(deviceIds.includes(p.device) && p.device !== 'none', p.device);
            assert.ok(devices.includes(p.device), `${p.signal} from a device the person does not have`);
            assert.ok(typeof p.why === 'string' && p.why.length > 10);
          }
          for (const key of ['safety', 'notes']) assert.ok(plan[key].every((x) => typeof x === 'string' && x.length > 0));
          assert.ok(Array.isArray(plan.actNow));
          if (stage === 'diagnosed') assert.deepEqual(plan.actNow, []);
          for (const a of plan.actNow) {
            assert.ok(['today', 'now'].includes(a.urgency), a.urgency);
            assert.match(a.source, URL);
            assert.ok(typeof a.text === 'string' && a.text.length > 20 && a.sourceLabel);
          }
          for (const t of plan.triggers) assert.ok(['guideline', 'study', 'our rule'].includes(t.basis), t.rule);
          const text = [plan.headline, ...items(plan).map((i) => i.why), ...items(plan).flatMap((i) => i.safety), ...plan.passive.map((p) => p.why),
            ...plan.triggers.flatMap((t) => [t.if, t.then]), ...plan.safety, ...plan.notes, ...plan.actNow.map((a) => a.text)];
          for (const t of text) assert.doesNotMatch(t, JUNK, t);
        }
      }
    }
  }
  assert.ok(count > 500);
});

test('planFor is pure: same input, same output, inputs untouched', () => {
  const s = sitAt(alex, '2026-09-22');
  const before = JSON.stringify(s);
  const opts = { devices: ['iphone', 'smart_scale'], answers: { canWalkSafely: true } };
  const a = planFor(s, opts);
  const b = planFor(s, opts);
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(s), before);
  assert.deepEqual(opts, { devices: ['iphone', 'smart_scale'], answers: { canWalkSafely: true } });
  assert.deepEqual(planFor(undefined).weekly, []); // no situation: the safety net only
});
