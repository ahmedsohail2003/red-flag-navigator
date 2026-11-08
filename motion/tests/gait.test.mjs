// Tests for motion/web/gait.js. Run: node --test "motion/tests/*.test.mjs" (from the project folder).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeWalk, summarizeWalk, GAIT_VERSION } from '../web/gait.js';
import { synthWalk } from '../web/synth.js';

const codes = (res) => res.issues.map((i) => i.code);
const issue = (res, code) => res.issues.find((i) => i.code === code);

// The accuracy every clean synthetic walk must reach.
function assertAccurate(rec, res, { durTol = 0.3, speedTol = 0.05, stepTol = 1 } = {}) {
  const tr = rec.truth;
  const ctx = JSON.stringify({ steps: res.steps, dur: res.duration_s, speed: res.speed_mps, truth: tr, issues: codes(res) });
  assert.equal(res.ok, true, ctx);
  assert.ok(Math.abs(res.steps - tr.steps) <= stepTol, `steps ${ctx}`);
  assert.ok(Math.abs(res.duration_s - tr.duration_s) <= durTol, `duration ${ctx}`);
  assert.ok(Math.abs(res.speed_mps - tr.speed_mps) / tr.speed_mps <= speedTol, `speed ${ctx}`);
}

test('result has the contract shape and version', () => {
  const res = analyzeWalk(synthWalk());
  assert.equal(GAIT_VERSION, 'gait-1');
  assert.equal(res.version, 'gait-1');
  for (const k of ['ok', 'speed_mps', 'duration_s', 'timing', 'motionDuration_s', 'manualDuration_s', 'onsetT', 'endT',
    'steps', 'cadence_spm', 'stepLength_m', 'distance_m', 'sampleRate_hz', 'nSamples', 'maxGap_ms', 'quality', 'issues', 'exploratory']) {
    assert.ok(k in res, `missing ${k}`);
  }
  for (const k of ['stepTimeCv_pct', 'asymmetry_pct', 'autocorrCadence_spm', 'gyroCadence_spm', 'headingChange_deg']) {
    assert.ok(k in res.exploratory, `missing exploratory.${k}`);
  }
  assert.equal(res.speed_mps, Math.round(res.speed_mps * 100) / 100);
  assert.equal(res.duration_s, Math.round(res.duration_s * 100) / 100);
});

test('default walk: steps, duration, speed, good quality, motion timing', () => {
  const rec = synthWalk();
  const res = analyzeWalk(rec);
  assertAccurate(rec, res);
  assert.equal(res.quality, 'good');
  assert.equal(res.timing, 'motion');
  assert.equal(res.distance_m, 10);
  assert.ok(Math.abs(res.onsetT - rec.truth.onsetT) <= 150, `onset ${res.onsetT} vs ${rec.truth.onsetT}`);
  assert.ok(Math.abs(res.endT - rec.truth.endT) <= 150, `end ${res.endT} vs ${rec.truth.endT}`);
  assert.equal(res.issues.filter((i) => i.level !== 'info').length, 0, JSON.stringify(res.issues));
  assert.ok(Math.abs(res.cadence_spm - 110) / 110 < 0.05, `cadence ${res.cadence_spm}`);
  assert.ok(Math.abs(res.stepLength_m - 10 / 14) < 0.06);
  assert.ok(Math.abs(res.sampleRate_hz - 60) < 2);
  // Manual timing is reported (Go to Stop includes reaction time and the tap delay).
  assert.ok(Math.abs(res.manualDuration_s - (rec.stopT - rec.goT) / 1000) < 0.011);
  // Exploratory cross-checks agree with the step count.
  const ex = res.exploratory;
  assert.ok(Math.abs(ex.autocorrCadence_spm - res.cadence_spm) / res.cadence_spm < 0.08, `acf ${ex.autocorrCadence_spm}`);
  assert.ok(Math.abs(ex.gyroCadence_spm - res.cadence_spm) / res.cadence_spm < 0.08, `gyro ${ex.gyroCadence_spm}`);
  assert.ok(ex.stepTimeCv_pct >= 0 && ex.stepTimeCv_pct < 6);
  assert.ok(ex.asymmetry_pct >= 0 && ex.asymmetry_pct < 6);
  assert.ok(ex.headingChange_deg >= 0 && ex.headingChange_deg < 20, `heading ${ex.headingChange_deg}`);
});

test('sample rates 30, 60 and 100 Hz', () => {
  for (const rateHz of [30, 60, 100]) {
    const rec = synthWalk({ rateHz });
    const res = analyzeWalk(rec);
    assertAccurate(rec, res);
    assert.ok(Math.abs(res.sampleRate_hz - rateHz) / rateHz < 0.05, `rate ${res.sampleRate_hz}`);
    if (rateHz < 40) {
      assert.equal(issue(res, 'low_rate')?.level, 'warn');
      assert.equal(res.quality, 'fair');
    } else {
      assert.equal(res.quality, 'good', `${rateHz} Hz ${JSON.stringify(res.issues)}`);
    }
  }
});

test('timestamp jitter of 5 ms', () => {
  const rec = synthWalk({ jitterMs: 5 });
  const res = analyzeWalk(rec);
  assertAccurate(rec, res);
  assert.equal(res.quality, 'good');
});

test('any phone orientation: 8 random seeds plus upright and flat', () => {
  const runs = [1, 2, 3, 4, 5, 6, 7, 8].map((seed) => ({ seed })).concat([{ orientation: 'upright' }, { orientation: 'flat' }]);
  for (const o of runs) {
    const rec = synthWalk(o);
    const res = analyzeWalk(rec);
    assertAccurate(rec, res);
    assert.equal(res.quality, 'good', JSON.stringify(o));
  }
});

test('iPhone-style sign (gravitySign -1) gives the same answer', () => {
  for (const seed of [1, 2, 3]) {
    const rec = synthWalk({ gravitySign: -1, seed });
    const res = analyzeWalk(rec);
    assertAccurate(rec, res);
    assert.equal(res.quality, 'good');
    const plus = analyzeWalk(synthWalk({ seed }));
    assert.equal(res.steps, plus.steps);
    assert.ok(Math.abs(res.duration_s - plus.duration_s) <= 0.1);
  }
});

test('slow gait: cadence 70, 22 steps, smaller amplitude', () => {
  for (const seed of [1, 2]) {
    const rec = synthWalk({ cadence_spm: 70, steps: 22, amplitude: 1.2, seed });
    const res = analyzeWalk(rec);
    assertAccurate(rec, res);
    assert.ok(Math.abs(res.cadence_spm - 70) / 70 < 0.05, `cadence ${res.cadence_spm}`);
  }
});

test('fast gait: cadence 125, 12 steps', () => {
  for (const seed of [1, 2]) {
    const rec = synthWalk({ cadence_spm: 125, steps: 12, seed });
    const res = analyzeWalk(rec);
    assertAccurate(rec, res);
    assert.ok(Math.abs(res.cadence_spm - 125) / 125 < 0.05, `cadence ${res.cadence_spm}`);
  }
});

test('a 400 ms gap mid-walk: gaps issue, still ok', () => {
  const rec = synthWalk({ gapAt_s: 6 });
  const res = analyzeWalk(rec);
  assertAccurate(rec, res);
  assert.equal(issue(res, 'gaps')?.level, 'warn');
  assert.ok(res.maxGap_ms >= 380, `maxGap ${res.maxGap_ms}`);
  assert.equal(res.quality, 'fair');
  assert.equal(res.timing, 'motion');
});

test('a 90 degree turn is flagged; a straight walk is not', () => {
  const rec = synthWalk({ turn_deg: 90 });
  const res = analyzeWalk(rec);
  assertAccurate(rec, res);
  assert.equal(issue(res, 'turned')?.level, 'warn');
  assert.ok(Math.abs(res.exploratory.headingChange_deg - 90) <= 15, `heading ${res.exploratory.headingChange_deg}`);
  assert.equal(res.quality, 'fair');
  for (const seed of [1, 2, 3, 4, 5]) {
    const straight = analyzeWalk(synthWalk({ seed }));
    assert.ok(!codes(straight).includes('turned'), `seed ${seed}`);
  }
  // Turning the other way, with the iPhone sign, is still a turn.
  const left = analyzeWalk(synthWalk({ turn_deg: -90, gravitySign: -1, seed: 3 }));
  assert.ok(codes(left).includes('turned'));
});

test('no gyroscope: no_gyro (info), gyro values null, still good', () => {
  const rec = synthWalk({ withGyro: false });
  assert.ok(rec.samples.every((s) => s.gx === null && s.gy === null && s.gz === null));
  const res = analyzeWalk(rec);
  assertAccurate(rec, res);
  assert.equal(issue(res, 'no_gyro')?.level, 'info');
  assert.equal(res.exploratory.headingChange_deg, null);
  assert.equal(res.exploratory.gyroCadence_spm, null);
  assert.equal(res.quality, 'good');
});

test('only lx, ly, lz (no gravity): works, no_gravity_signal (info)', () => {
  const rec = synthWalk();
  const lin = { ...rec, samples: rec.samples.map((s) => ({ ...s, ax: null, ay: null, az: null })) };
  const res = analyzeWalk(lin);
  assertAccurate(rec, res);
  assert.equal(issue(res, 'no_gravity_signal')?.level, 'info');
  assert.equal(res.timing, 'motion');
});

test('an entirely still recording: ok false, no_walk_detected, even with manual timing', () => {
  const rec = synthWalk({ amplitude: 0 });
  const res = analyzeWalk(rec);
  assert.equal(res.ok, false);
  assert.equal(issue(res, 'no_walk_detected')?.level, 'fail');
  assert.ok(res.manualDuration_s > 0, 'manual timing exists');
  assert.equal(res.speed_mps, null);
  assert.equal(res.timing, null);
  assert.equal(res.quality, 'poor');
});

test('garbage input never throws and gives ok false', () => {
  const nanSamples = Array.from({ length: 300 }, (_, i) => ({ t: i * 16, ax: NaN, ay: NaN, az: NaN, gx: NaN, gy: NaN, gz: NaN, lx: NaN, ly: NaN, lz: NaN }));
  const sameT = Array.from({ length: 300 }, () => ({ t: 5, ax: 0, ay: 9.8, az: 0 }));
  const shortUnsorted = [5, 1, 4, 2, 3, 3, 1].map((k) => ({ t: k * 100, ax: Math.random(), ay: 9.8, az: 0 }));
  const inputs = [
    null, undefined, {}, [], 'walk', 42, true,
    { samples: null }, { samples: [] }, { samples: 'x' }, { samples: [null, 1, 'a', {}] },
    { distance_m: 10, samples: nanSamples },
    { distance_m: 10, samples: sameT },
    { distance_m: 10, goT: 'soon', stopT: {}, stopBy: 'tap', samples: shortUnsorted },
    { distance_m: 10, goT: 0, samples: [{ t: Infinity, ax: 1, ay: 1, az: 1 }, { t: -Infinity, ax: 1, ay: 1, az: 1 }] },
  ];
  for (const input of inputs) {
    let res;
    assert.doesNotThrow(() => { res = analyzeWalk(input); }, `input ${JSON.stringify(input)?.slice(0, 80)}`);
    assert.equal(res.ok, false);
    assert.equal(res.version, 'gait-1');
    assert.equal(res.quality, 'poor');
    assert.ok(res.issues.length > 0);
    assert.ok(res.issues.every((i) => typeof i.message === 'string' && i.message.length > 0 && ['info', 'warn', 'fail'].includes(i.level)));
    assert.equal(typeof summarizeWalk(res), 'string');
  }
  assert.ok(codes(analyzeWalk(null)).includes('no_samples'));
  assert.ok(codes(analyzeWalk({ samples: [] })).includes('no_samples'));
  assert.ok(codes(analyzeWalk({ distance_m: 10, samples: shortUnsorted })).includes('too_short'));
  assert.doesNotThrow(() => analyzeWalk(synthWalk(), null));
  assert.doesNotThrow(() => analyzeWalk(synthWalk(), 'x'));
});

test('unsorted samples and duplicate t are cleaned up, not fatal', () => {
  const rec = synthWalk();
  const clean = analyzeWalk(rec);
  // Reverse the order and repeat every tenth sample.
  const messy = [];
  rec.samples.forEach((s, i) => { messy.push(s); if (i % 10 === 0) messy.push({ ...s }); });
  messy.reverse();
  const res = analyzeWalk({ ...rec, samples: messy });
  assert.equal(res.ok, true);
  assert.equal(res.nSamples, rec.samples.length);
  assert.equal(res.steps, clean.steps);
  assert.equal(res.duration_s, clean.duration_s);
  assert.equal(res.speed_mps, clean.speed_mps);
});

test('distance 0, 500 or missing gives distance_invalid and ok false', () => {
  for (const distance_m of [0, 500, null, undefined, '10', NaN]) {
    const rec = synthWalk({ distance_m });
    if (distance_m === undefined) delete rec.distance_m;
    const res = analyzeWalk(rec);
    assert.equal(res.ok, false, String(distance_m));
    assert.equal(issue(res, 'distance_invalid')?.level, 'fail');
    assert.equal(res.speed_mps, null);
    assert.equal(res.quality, 'poor');
    assert.ok(res.duration_s > 0, 'the walk itself is still timed');
  }
  // options.distance_m can supply the distance for an imported file.
  const rec = synthWalk({ distance_m: null });
  const res = analyzeWalk(rec, { distance_m: 10 });
  assert.equal(res.ok, true);
  assert.equal(res.distance_m, 10);
});

test('Stop tapped 3 s late: manual_mismatch, still timed by motion', () => {
  const rec = synthWalk({ tapDelay_s: 3 });
  const res = analyzeWalk(rec);
  assertAccurate(rec, res);
  assert.equal(issue(res, 'manual_mismatch')?.level, 'warn');
  assert.equal(res.timing, 'motion');
  assert.equal(res.quality, 'fair');
  // The default 0.4 s tap delay is within max(3 s, 20%).
  assert.ok(!codes(analyzeWalk(synthWalk())).includes('manual_mismatch'));
});

// walk.js stops recording at the Stop click, so the samples end at the click: here 100 ms after
// the finger goes down (stopT), as in walk.js. synth.js keeps 2 s of samples after a tap.
const tapAt = (rec, stopT, clickMs = 100) => ({ ...rec, stopBy: 'tap', stopT, samples: rec.samples.filter((s) => s.t <= stopT + clickMs) });

// Review fix F1/G2: a tap while still walking (a pocket touch on the big Stop button, or a tap
// before the line) used to give a "good" speed 10 to 40% too fast, which could become a baseline.
test('Stop tapped before the line cannot be saved; a tap after standing still can', () => {
  const b = synthWalk({ seed: 5, orientation: 'upright' });
  const cut = b.truth.onsetT + 0.8 * (b.truth.endT - b.truth.onsetT);
  const early = analyzeWalk(tapAt(b, cut));
  assert.equal(early.ok, false); assert.equal(early.quality, 'poor');
  assert.equal(early.speed_mps, null);
  const w = issue(early, 'stopped_while_walking');
  assert.equal(w?.level, 'fail', codes(early).join());
  assert.equal(w.message, 'You tapped Stop while you were still moving, so stand still at the line and let the phone stop by itself.');
  const t = b.truth.endT + 500;
  const proper = analyzeWalk(tapAt(b, t));
  assert.equal(proper.ok, true); assert.equal(proper.quality, 'good');
  // More walks: taps at 70% and 90% of the walk fail; taps after standing 0.3 s or more stay good.
  for (const seed of [3, 9]) {
    const rec = synthWalk({ seed });
    for (const f of [0.7, 0.9]) {
      const res = analyzeWalk(tapAt(rec, rec.truth.onsetT + f * (rec.truth.endT - rec.truth.onsetT)));
      assert.equal(res.ok, false, `seed ${seed} at ${f}: ${res.speed_mps} ${codes(res)}`);
      assert.ok(codes(res).includes('stopped_while_walking'), `seed ${seed} at ${f}: ${codes(res)}`);
    }
    for (const wait of [0.3, 0.8]) {
      const res = analyzeWalk(tapAt(rec, rec.truth.endT + wait * 1000));
      assertAccurate(rec, res);
      assert.equal(res.quality, 'good', `seed ${seed}, wait ${wait}: ${codes(res)}`);
    }
  }
  // The auto-stop is not affected.
  assert.equal(analyzeWalk(synthWalk({ stopBy: 'auto' })).quality, 'good');
});

// Review fix F4: Go to Stop includes the reaction to Go and the wait at the line. The auto-stop
// needs about 1.6 s of stillness, so a tap up to then is normal and must not warn.
test('a Stop tap after standing up to 1.8 s at the line is good, not a mismatch', () => {
  for (const seed of [1, 3, 5]) {
    for (const wait of [1.0, 1.4, 1.8]) {
      const rec = synthWalk({ seed, tapDelay_s: wait });
      const res = analyzeWalk(tapAt(rec, rec.stopT));
      assertAccurate(rec, res);
      assert.ok(!codes(res).includes('manual_mismatch'), `seed ${seed}, wait ${wait}`);
      assert.equal(res.quality, 'good', `seed ${seed}, wait ${wait}: ${codes(res)}`);
    }
  }
});

// Review fix G3: with weak trunk motion (slow or aided walkers) the bout used to cover only part
// of the walk, giving a "good" speed up to 114% too fast. Now the weak first steps are found, or
// the walk fails when step rhythm comes before or after the timed part.
test('weak trunk motion never gives a speed more than 10% off', () => {
  for (const [cadence_spm, steps] of [[60, 25], [70, 22], [90, 16]]) {
    for (const amplitude of [0.8, 0.9]) {
      for (let seed = 1; seed <= 12; seed++) {
        const rec = synthWalk({ cadence_spm, steps, amplitude, seed, stopBy: 'auto' });
        const res = analyzeWalk(rec);
        if (res.speed_mps === null) continue;                // no speed is safe: walk again
        const e = (res.speed_mps - rec.truth.speed_mps) / rec.truth.speed_mps;
        assert.ok(Math.abs(e) <= 0.1, `cadence ${cadence_spm}, amplitude ${amplitude}, seed ${seed}: ${(100 * e).toFixed(0)}%, ${res.quality}, ${res.steps}/${steps} steps`);
      }
    }
  }
});

// Review fix G4: turning back before the auto-stop puts the walk back inside the bout (about half
// the true speed). A heading change over 120 degrees fails; 45 to 120 degrees stays a warning.
test('a turn over 120 degrees fails and cannot be saved; 45 to 120 degrees is a warning', () => {
  for (const [turn_deg, gravitySign] of [[180, 1], [-180, -1], [150, 1]]) {
    const res = analyzeWalk(synthWalk({ turn_deg, gravitySign, seed: 3 }));
    const w = issue(res, 'turned');
    assert.equal(w?.level, 'fail', `${turn_deg}: heading ${res.exploratory.headingChange_deg}`);
    assert.equal(w.message, 'You turned around before the phone stopped, so stand still at the line until it stops, then walk back.');
    assert.equal(res.ok, false);
    assert.equal(res.quality, 'poor');
    assert.equal(res.speed_mps, null);
  }
  const warn = analyzeWalk(synthWalk({ turn_deg: 100, seed: 3 }));
  assert.equal(issue(warn, 'turned')?.level, 'warn', `heading ${warn.exploratory.headingChange_deg}`);
  assert.equal(warn.ok, true);
  assert.equal(warn.quality, 'fair');
});

// Review fix G5: with alternating long and short steps (a limp or foot drop) the median step gap
// is one side's step time, so the cadence was 10 to 37% off. Half the stride time is not.
test('alternating long and short steps give the mean cadence', () => {
  for (const [cadence_spm, stepAsym] of [[100, 0.25], [70, 0.2]]) {
    for (const seed of [1, 2]) {
      const rec = synthWalk({ cadence_spm, stepAsym, steps: 16, seed });
      const res = analyzeWalk(rec);
      assertAccurate(rec, res);
      const trueCad = (60 * rec.truth.steps) / rec.truth.duration_s;
      assert.ok(Math.abs(res.cadence_spm - trueCad) / trueCad < 0.03, `cadence ${res.cadence_spm} vs ${trueCad.toFixed(1)}`);
    }
  }
  // stepAsym 0 (the default) leaves the recording unchanged.
  assert.deepEqual(synthWalk({ seed: 4, stepAsym: 0 }), synthWalk({ seed: 4 }));
});

test('too few steps for motion timing falls back to the taps, with a warning', () => {
  // 2 steps over 3 m (about 1.4 m/s by the taps). The original fixture walked 10 m in
  // 2 steps (about 5 m/s), which the speed_out_of_range rule now rightly rejects.
  const rec = synthWalk({ steps: 2, distance_m: 3 });
  const res = analyzeWalk(rec);
  assert.equal(res.ok, true, JSON.stringify(res.issues));
  assert.equal(res.timing, 'manual');
  const w = issue(res, 'used_manual_timing');
  assert.equal(w?.level, 'warn');
  assert.match(w.message, /reaction time/);
  assert.equal(res.duration_s, Math.round(((rec.stopT - rec.goT) / 1000) * 100) / 100);
  assert.equal(res.quality, 'fair');
  // Without a Stop tap there is no fallback.
  const noTap = analyzeWalk({ ...rec, stopBy: 'auto' });
  assert.equal(noTap.ok, false);
  assert.equal(noTap.timing, null);
});

test('no Go cue (imported file): the bout starts after the opening stillness', () => {
  const rec = synthWalk();
  const res = analyzeWalk({ ...rec, goT: null, stopT: null, stopBy: null });
  assertAccurate(rec, res);
  assert.equal(res.manualDuration_s, null);
  assert.equal(res.timing, 'motion');
});

// Moving the phone into place: a deterministic burst of large accelerations and rotation added to
// the samples in [t1, t2) (sample clock, ms).
function withHandling(rec, t1, t2) {
  const samples = rec.samples.map((s) => {
    if (s.t < t1 || s.t >= t2) return s;
    const u = (s.t - t1) / 1000;
    return {
      ...s,
      ax: s.ax + 3 * Math.sin(2 * Math.PI * 2.3 * u), ay: s.ay + 2.5 * Math.sin(2 * Math.PI * 3.1 * u + 1),
      az: s.az + 2 * Math.sin(2 * Math.PI * 1.7 * u + 2),
      gx: s.gx + 60 * Math.sin(2 * Math.PI * 1.9 * u), gy: s.gy + 50 * Math.sin(2 * Math.PI * 2.7 * u + 1),
      gz: s.gz + 40 * Math.sin(2 * Math.PI * 1.3 * u + 2),
    };
  });
  return { ...rec, samples };
}

// Review fix: the recording starts when Start is tapped, so the first part of the 3 s countdown is
// often the phone being put in place. That must not cut off the first step or warn about moving.
test('handling the phone early in the countdown does not change the speed', () => {
  for (const seed of [1, 2, 3]) {
    for (const ms of [600, 1000]) {
      const rec = synthWalk({ seed });
      const t0 = rec.samples[0].t;
      const res = analyzeWalk(withHandling(rec, t0, t0 + ms));
      assertAccurate(rec, res, { durTol: 0.25, speedTol: 0.04, stepTol: 0 });
      assert.ok(!codes(res).includes('not_still_at_start'), `seed ${seed}, ${ms} ms: ${codes(res)}`);
      assert.equal(res.quality, 'good', `seed ${seed}, ${ms} ms: ${codes(res)}`);
    }
  }
});

// Review fix: an imported file has no Go cue and often starts with the phone being handled, so
// the opening stillness has to be found, not assumed to be the first 1.5 s.
test('imported file that starts with handling, then stillness, then the walk', () => {
  for (const seed of [1, 2, 3]) {
    const rec = synthWalk({ seed, standBefore_s: 5 });
    const t0 = rec.samples[0].t;
    const imp = { ...withHandling(rec, t0, t0 + 1500), goT: null, stopT: null, stopBy: null };
    const res = analyzeWalk(imp);
    assertAccurate(rec, res, { durTol: 0.25, speedTol: 0.04, stepTol: 0 });
    assert.equal(res.timing, 'motion');
    assert.ok(!codes(res).includes('not_still_at_start'), `seed ${seed}: ${codes(res)}`);
  }
  // A file that starts mid-walk, with no opening stillness, is still measured.
  const rec = synthWalk({ standBefore_s: 0, reaction_s: 0 });
  const res = analyzeWalk({ ...rec, goT: null, stopT: null, stopBy: null });
  assert.equal(res.ok, true, codes(res).join());
  assert.ok(Math.abs(res.steps - rec.truth.steps) <= 1, `steps ${res.steps}`);
});

// Review fix: one sample with a far-off time (a broken file row, or two files with different time
// bases) used to build a grid over the whole span: 1e8 ms took seconds and hundreds of MB and was
// still ok. A span over 15 minutes is now refused quickly with a fail-level gaps issue.
test('a far-off timestamp is refused quickly instead of using huge memory', () => {
  const rec = synthWalk();
  for (const span of [1e8, 1e12]) {
    const bad = { ...rec, samples: [...rec.samples, { ...rec.samples[10], t: rec.samples[0].t + span }] };
    const t1 = performance.now();
    const res = analyzeWalk(bad);
    const ms = performance.now() - t1;
    assert.ok(ms < 300, `${span}: ${ms.toFixed(0)} ms`);
    assert.equal(res.ok, false);
    assert.equal(issue(res, 'gaps')?.level, 'fail');
    assert.equal(res.speed_mps, null);
    assert.equal(res.quality, 'poor');
  }
  // A long but sane recording (10 minutes at 60 Hz, mostly standing) is still analysed.
  const long = synthWalk({ standAfter_s: 590 });
  const res = analyzeWalk(long);
  assert.equal(res.ok, true, codes(res).join());
  assert.ok(Math.abs(res.steps - long.truth.steps) <= 1);
});

test('same input gives the same result', () => {
  const a = analyzeWalk(synthWalk({ seed: 7, turn_deg: 30 }));
  const b = analyzeWalk(synthWalk({ seed: 7, turn_deg: 30 }));
  assert.deepEqual(a, b);
});

test('summarizeWalk gives one plain line', () => {
  const good = summarizeWalk(analyzeWalk(synthWalk()));
  assert.ok(good.length > 20);
  assert.match(good, /m\/s/);
  assert.match(good, /Timed by motion/);
  assert.match(good, /Good quality/);
  assert.ok(!good.includes('\n'));
  const still = summarizeWalk(analyzeWalk(synthWalk({ amplitude: 0 })));
  assert.match(still, /^No walking speed: /);
  assert.ok(still.length > 20);
  const manual = summarizeWalk(analyzeWalk(synthWalk({ steps: 2, distance_m: 3 })));
  assert.match(manual, /reaction time/);
  assert.equal(typeof summarizeWalk(null), 'string');
  assert.ok(summarizeWalk(null).length > 0);
  assert.ok(summarizeWalk({}).length > 0);
});

test('speed: 60 s at 100 Hz is analysed in under 300 ms', () => {
  const rec = synthWalk({ rateHz: 100, steps: 100, distance_m: 70 });
  assert.ok(rec.samples.length >= 5900);
  const t1 = performance.now();
  const res = analyzeWalk(rec);
  const ms = performance.now() - t1;
  assert.ok(ms < 300, `${ms.toFixed(1)} ms`);
  assertAccurate(rec, res);
});

// Lead, 02:55: a walk timed only by the taps can give a speed no person walks at
// (here 3 steps over 10 m, 3.79 m/s). Saved as a baseline, it would make every later
// normal walk look like a decline, so such a "speed" must fail and never be saveable.
test('a speed outside human walking (0.15 to 2.5 m/s) fails and gives no speed', () => {
  const fast = analyzeWalk(synthWalk({ steps: 3 }));
  assert.equal(fast.ok, false, `ok should be false, got speed ${fast.speed_mps}`);
  assert.equal(fast.quality, 'poor');
  assert.ok(fast.issues.some((i) => i.code === 'speed_out_of_range' && i.level === 'fail'), JSON.stringify(fast.issues.map((i) => i.code)));
  assert.equal(fast.speed_mps, null);
  const slow = analyzeWalk(synthWalk({ distance_m: 1 }));
  assert.equal(slow.ok, false, `1 m in about 7.6 s should fail, got ${slow.speed_mps}`);
  assert.ok(slow.issues.some((i) => i.code === 'speed_out_of_range'));
  const normal = analyzeWalk(synthWalk({}));
  assert.equal(normal.ok, true);
  assert.ok(!normal.issues.some((i) => i.code === 'speed_out_of_range'));
});
