// gait.js: walking-speed analysis for the phone 10 m walk test (contract section 3).
// Pure ES module, no imports. Runs in browsers and Node 22. Never throws.
//
// It measures walking speed (metres per second) and counts steps from the phone's motion
// sensors. It does not measure or diagnose ALS. Only speed_mps is meant for the app; the
// exploratory values are cross-checks and are never fed to the engine.
//
// Method:
//  1. Keep finite samples, sort by t, drop duplicate t. Rate = 1000 / median dt.
//  2. Resample to a 50 Hz grid by linear interpolation. Gaps over 250 ms are reported and only
//     bridged by a straight line (no motion is invented), and they never count as stillness.
//  3. Signal: |acceleration including gravity| (orientation and platform sign do not matter),
//     low-passed at 3 Hz with a zero-phase (forward-backward) 2nd-order Butterworth, minus a
//     baseline (median during the opening stillness). Without gravity, |lx, ly, lz| is used.
//  4. Activity envelope: centred moving SD over 0.5 s. Stillness threshold
//     max(0.3 m/s^2, 4 x the SD during the opening stillness), or 0.4 m/s^2 if the opening
//     is not still.
//  5. Bout: the first sustained movement (0.4 s) after goT - 0.3 s, to the start of the final
//     stillness (0.8 s, or the end of data). A stillness followed by 1.5 s or more of movement
//     is a pause, not the end. Both edges are then refined on the signal itself, because the
//     0.5 s envelope blurs them by about a quarter of a second: from the first and last step
//     peaks outwards, as long as |signal| keeps passing a low level (max(0.2, 4 x rest RMS)).
//  6. Steps: local maxima of the signal inside the bout, at least 0.3 s apart (highest first),
//     above max(0.2 m/s^2, 0.35 x the 90th percentile of candidate heights).
//  7. Timing: motion when a bout with at least 4 steps exists; otherwise the Go/Stop taps
//     (includes reaction time) if the recording shows some movement.
//  8. Review fixes (8 Nov, 04:00): a walk fails when the Stop tap came while the phone was still
//     moving (the recording ends at the tap, so the bout would end at the data end and the speed
//     would be too fast), when step rhythm runs on after the bout or comes before it (part of the
//     walk was not timed), and when the heading turned over 120 degrees (a turn back inside the
//     bout). Cadence uses half the stride time, so a limp does not pick one side's step time.

export const GAIT_VERSION = 'gait-1';

const FS = 50;                 // analysis grid, Hz
const DT = 1000 / FS;          // grid step, ms
const BIG_GAP_MS = 250;
const MAX_SPAN_MS = 15 * 60 * 1000; // longest recording analysed (grid of 45,000 points)
const LOWPASS_HZ = 3;
const ENV_HALF = 12;           // moving-SD window 25 points = 0.5 s
const SUSTAIN_N = 20;          // 0.4 s of movement starts the bout
const FINAL_STILL_N = 40;      // 0.8 s of stillness ends it
const PAUSE_N = 50;            // a stillness of 1 s inside the bout is a pause
const RESUME_N = 75;           // 1.5 s of movement after a stillness means walking resumed
const MIN_STEP_GAP_MS = 300;
const MIN_THR = 0.3;           // m/s^2
const FIXED_THR = 0.4;         // m/s^2, when the opening is not still
const EDGE_MIN = 0.2;          // m/s^2, lowest level for the bout edges and step peaks
const TURN_DEG = 45;
// Review fix G4: a heading change this large inside the bout means the person turned back
// before the phone stopped, so the walk back was timed too.
const TURN_BACK_DEG = 120;
// Review fix F4: Go to Stop includes the reaction to Go and the wait at the line (the auto-stop
// needs about 1.6 s of stillness), so a normal tap differs from the bout by up to about 3 s.
const MISMATCH_MIN_S = 3;
// Review fix F1/G2: walk.js stops recording at the Stop click. A bout that ends this close to
// the last sample means the phone was still moving at the tap. From synthetic walks only:
// mid-walk taps ended up to 183 ms before the last sample, taps after standing 350 ms or more.
const TAP_MOVING_MS = 250;
// Human walking spans roughly 0.15 to 2.5 m/s (fast young adults peak near 2.5). A speed
// outside it means cut-short timing or a run, and must never become a baseline.
const MIN_WALK_SPEED = 0.15;
const MAX_WALK_SPEED = 2.5;

const TEXT = {
  no_samples: 'No motion data arrived, so keep this page open and on screen while you walk.',
  too_short: 'The recording is too short, so stand still for the countdown and then walk the whole distance.',
  low_rate: 'The phone sent motion data too slowly, so close other apps and try again.',
  gaps: 'Some motion data went missing, so keep the screen on and this page open while you walk.',
  no_walk_detected: 'No walking was found, so hold the phone against your body, wait for Go, then walk.',
  too_few_steps: 'Only a few steps were found, so walk the whole distance with the phone held firmly against your body.',
  cadence_out_of_range: 'The step rate looks unusual, so walk at your usual pace with the phone held still against your body.',
  step_length_out_of_range: 'The step length looks unusual, so check the distance and walk all of it.',
  manual_mismatch: 'Your Stop tap does not match when the walking stopped, so tap Stop as soon as you stop.',
  used_manual_timing: 'The time comes from your Go and Stop taps and includes your reaction time, so hold the phone against your body next time.',
  paused: 'You seem to have stopped part way, so walk the whole distance without stopping.',
  turned: 'You seem to have turned, so walk in a straight line.',
  not_still_at_start: 'You were moving before Go, so stand still during the countdown.',
  distance_invalid: 'The distance is missing or wrong, so enter a distance from 1 to 100 metres.',
  no_gyro: 'This phone sent no turning data, so turns are not checked, but walking speed is still measured.',
  no_gravity_signal: 'This phone sent motion without gravity, so the step count may be less exact.',
  speed_out_of_range: 'That speed is outside normal walking (0.15 to 2.5 m/s), so walk, do not run, and walk the whole distance before you stop.',
  stopped_while_walking: 'You tapped Stop while you were still moving, so stand still at the line and let the phone stop by itself.',
};
const LEVEL = {
  no_samples: 'fail', too_short: 'fail', low_rate: 'warn', gaps: 'warn', no_walk_detected: 'fail',
  too_few_steps: 'warn', cadence_out_of_range: 'warn', step_length_out_of_range: 'warn',
  manual_mismatch: 'warn', used_manual_timing: 'warn', paused: 'warn', turned: 'warn',
  not_still_at_start: 'warn', distance_invalid: 'fail', no_gyro: 'info', no_gravity_signal: 'info',
  speed_out_of_range: 'fail', stopped_while_walking: 'fail',
};

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const round = (v, dp) => { const f = 10 ** dp; return Math.round(v * f) / f; };
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function emptyResult() {
  return {
    version: GAIT_VERSION, ok: false, speed_mps: null, duration_s: null, timing: null,
    motionDuration_s: null, manualDuration_s: null, onsetT: null, endT: null,
    steps: null, cadence_spm: null, stepLength_m: null, distance_m: null,
    sampleRate_hz: null, nSamples: 0, maxGap_ms: null, quality: 'poor', issues: [],
    exploratory: {
      stepTimeCv_pct: null, asymmetry_pct: null, autocorrCadence_spm: null,
      gyroCadence_spm: null, headingChange_deg: null,
    },
  };
}

/**
 * Analyse one walk recording (contract section 2). Returns a WalkResult (section 3).
 * options.distance_m, if a number, overrides recording.distance_m (for imported files).
 */
export function analyzeWalk(recording, options = {}) {
  try {
    return analyze(recording, options && typeof options === 'object' ? options : {});
  } catch (err) {
    const res = emptyResult();
    res.issues.push({ code: 'no_samples', level: 'fail', message: 'The recording could not be read, so record the walk again.' });
    return res;
  }
}

function analyze(rec, options) {
  const res = emptyResult();
  const add = (code, level, message) => {
    if (res.issues.some((i) => i.code === code)) return;
    res.issues.push({ code, level: level || LEVEL[code], message: message || TEXT[code] });
  };
  const r = rec && typeof rec === 'object' && !Array.isArray(rec) ? rec : {};

  const dist = isNum(options.distance_m) ? options.distance_m : r.distance_m;
  const distOk = isNum(dist) && dist >= 1 && dist <= 100;
  res.distance_m = isNum(dist) ? dist : null;

  const goT = isNum(r.goT) ? r.goT : null;
  const stopT = isNum(r.stopT) ? r.stopT : null;
  const manual = r.stopBy === 'tap' && goT !== null && stopT !== null && stopT > goT ? (stopT - goT) / 1000 : null;
  res.manualDuration_s = manual === null ? null : round(manual, 2);

  const finish = () => {
    if (!distOk) add('distance_invalid');
    return finalize(res);
  };

  // 1. Samples.
  const { pts, mode, hasGyro } = readSamples(r.samples);
  res.nSamples = pts.length;
  if (pts.length === 0) { add('no_samples'); return finish(); }
  const n = pts.length;
  const t0 = pts[0].t, tLast = pts[n - 1].t;
  if (n >= 2) {
    const dts = new Float64Array(n - 1);
    let maxGap = 0;
    for (let i = 1; i < n; i++) { dts[i - 1] = pts[i].t - pts[i - 1].t; if (dts[i - 1] > maxGap) maxGap = dts[i - 1]; }
    const medDt = median(dts);
    res.sampleRate_hz = medDt > 0 ? round(1000 / medDt, 1) : null;
    res.maxGap_ms = Math.round(maxGap);
  }
  if (n < 2 || tLast - t0 < 2000) { add('too_short'); return finish(); }
  // Review fix: the 50 Hz grid covers the whole span, so one far-off time (a broken row, or two
  // files with different time bases) could need gigabytes. The contract has no "too long" code;
  // gaps (fail) is the closest, since the usual cause is times that jump.
  if (tLast - t0 > MAX_SPAN_MS) {
    add('gaps', 'fail', 'The recording is over 15 minutes long or its times jump, so record only the walk, from the countdown to Stop.');
    return finish();
  }
  const rate = res.sampleRate_hz || 0;
  if (rate < 10) add('low_rate', 'fail');
  else if (rate < 40) add('low_rate');
  if (res.maxGap_ms > BIG_GAP_MS) add('gaps');
  if (mode === 'lin') add('no_gravity_signal');
  if (!hasGyro) add('no_gyro');

  // 2. Resample to the 50 Hz grid.
  const M = Math.floor((tLast - t0) / DT) + 1;
  const grid = resample(pts, ['x', 'y', 'z'], t0, M);
  const [ax, ay, az] = grid.ch;
  const mask = grid.mask;
  let gyro = null;
  if (hasGyro) {
    const gp = pts.filter((p) => isNum(p.gx));
    gyro = resample(gp, ['gx', 'gy', 'gz'], t0, M).ch;
  }
  const gt = (j) => t0 + j * DT;
  const idx = (t) => clamp(Math.round((t - t0) / DT), 0, M - 1);

  // 3. Signal and envelope.
  const mag = new Float64Array(M);
  for (let j = 0; j < M; j++) mag[j] = Math.hypot(ax[j], ay[j], az[j]);
  const rough = median(mag);
  for (let j = 0; j < M; j++) mag[j] -= rough;           // centred near zero for precision
  const lp = lowpassZeroPhase(mag, LOWPASS_HZ, FS);
  const env = movingSd(lp, ENV_HALF);
  for (let j = 1; j < M; j++) if (mask[j]) env[j] = env[j - 1]; // a gap holds the state before it

  // 4. Opening stillness, baseline and thresholds.
  const goValid = goT !== null && goT > t0 && goT < tLast;
  let open = null;                                       // [i0, i1) grid range
  let searchStart = 0;
  if (goValid) {
    // Review fix: only the last 1.5 s of the 3 s countdown (to 0.25 s before Go). Recording starts
    // when Start is tapped, so the first second or so is often the phone being put in place, and
    // the 0.5 s envelope spreads that by another 0.25 s.
    const i0 = Math.max(0, idx(goT - 1750)), i1 = idx(goT - 250);
    if (i1 - i0 >= 25) open = [i0, i1];
    searchStart = idx(goT - 300);
  } else {
    // Review fix: no Go cue (imported file). A file often starts with the phone being handled, so
    // the opening stillness is found (the first 1 s or more under MIN_THR that has sustained
    // movement after it) and the bout is searched from there. Without one, use the first 1.5 s.
    const run = openingStill(env, mask, MIN_THR, 50);
    if (run) { open = run; searchStart = run[0]; }
    else {
      const i1 = Math.min(75, Math.floor(M / 4));
      if (i1 >= 25) open = [0, i1];
    }
  }
  let still = false, restSd = 0;
  if (open) {
    const e = env.slice(open[0], open[1]);
    restSd = median(e);
    still = quantile(Array.from(e).sort((a, b) => a - b), 0.8) <= MIN_THR;
    if (!still) add('not_still_at_start');
  }
  const thr = still ? Math.max(MIN_THR, 4 * restSd) : FIXED_THR;
  const base = still ? median(lp.slice(open[0], open[1])) : median(lp);
  const s = new Float64Array(M);
  for (let j = 0; j < M; j++) s[j] = lp[j] - base;
  // Edge level from the signal's own spread at rest (the windowed SD reads low for filtered
  // noise). Review fix: robust (1.4826 x median |s|, equal to the RMS for plain noise), so a
  // moment of handling inside the window cannot raise it and cut off the weak first step.
  let restRms = 0;
  if (still) {
    const absS = new Float64Array(open[1] - open[0]);
    for (let j = open[0]; j < open[1]; j++) absS[j - open[0]] = Math.abs(s[j]);
    restRms = 1.4826 * median(absS);
  }
  const edge = still ? Math.max(EDGE_MIN, 4 * restRms) : 0.3;

  // 5. Bout.
  const above = new Uint8Array(M);
  for (let j = 0; j < M; j++) above[j] = env[j] > thr ? 1 : 0;
  let moving = 0;
  for (let j = searchStart; j < M; j++) moving += above[j];
  const someMovement = moving >= 10;                     // at least 0.2 s above the threshold

  let onsetIdx = -1;
  for (let j = searchStart, run = 0; j < M; j++) {
    if (above[j]) { if (++run >= SUSTAIN_N) { onsetIdx = j - SUSTAIN_N + 1; break; } } else run = 0;
  }

  let bout = null, pauses = 0;
  if (onsetIdx >= 0) {
    const stillRun = (j) => { let k = j; while (k < M && !above[k]) k++; return k - j; };
    const movementExtent = (j) => {
      let k = j, last = j;
      while (k < M) {
        if (above[k]) { last = k; k++; continue; }
        const L = stillRun(k);
        if (L >= FINAL_STILL_N || k + L >= M) break;
        k += L;
      }
      return last - j + 1;
    };
    let endIdx = M - 1;
    for (let j = onsetIdx; j < M;) {
      if (above[j]) { j++; continue; }
      const L = stillRun(j);
      if (j + L >= M) { endIdx = j; break; }             // stillness to the end of the data
      if (L >= FINAL_STILL_N) {
        if (movementExtent(j + L) >= RESUME_N) {         // walking resumed: a pause, not the end
          if (L >= PAUSE_N) pauses++;
          j += L;
          continue;
        }
        endIdx = j;
        break;
      }
      j += L;
    }

    // Refine the edges on the signal itself, anchored on the first and last step peaks: walk
    // outwards from them while |signal| keeps passing the edge level, and stop at a quiet
    // stretch of 0.4 of a step (8 to 25 points). An isolated noise blip cannot attach itself.
    // Review fix G3: look up to 2 s before the coarse onset (never before searchStart), so weak
    // first steps of a slow or aided walker are not left out of the timing. Onset side only.
    const coarse = findPeaks(s, Math.max(searchStart, onsetIdx - 100), endIdx + 17, gt);
    let aOn = onsetIdx, aEnd = endIdx, Q = 12;
    if (coarse.length) {
      aOn = idx(coarse[0]);
      aEnd = idx(coarse[coarse.length - 1]);
      if (coarse.length >= 2) {
        const iv = [];
        for (let i = 1; i < coarse.length; i++) iv.push(coarse[i] - coarse[i - 1]);
        Q = clamp(Math.round((0.4 * median(iv)) / DT), 8, 25);
      }
    }
    let first = -1;
    for (let k = aOn, quiet = 0; k >= searchStart; k--) {
      if (Math.abs(s[k]) > edge) { first = k; quiet = 0; } else if (++quiet >= Q) break;
    }
    if (first < 0) {
      for (let k = aOn; k < Math.min(M, aOn + 30); k++) if (Math.abs(s[k]) > edge) { first = k; break; }
    }
    let onsetT = gt(onsetIdx);
    if (first > 0) {
      const a = Math.abs(s[first - 1]), b = Math.abs(s[first]);
      onsetT = gt(first - 1) + clamp(b > a ? (edge - a) / (b - a) : 1, 0, 1) * DT;
    } else if (first === 0) onsetT = gt(0);

    let lastA = -1;
    for (let k = aEnd, quiet = 0; k < M; k++) {
      if (Math.abs(s[k]) > edge) { lastA = k; quiet = 0; } else if (++quiet >= Q) break;
    }
    if (lastA < 0) {
      for (let k = aEnd; k >= Math.max(onsetIdx, aEnd - 30); k--) if (Math.abs(s[k]) > edge) { lastA = k; break; }
    }
    let endT = gt(endIdx);
    if (lastA >= 0 && lastA < M - 1) {
      const a = Math.abs(s[lastA]), b = Math.abs(s[lastA + 1]);
      endT = gt(lastA) + clamp(a > b ? (a - edge) / (a - b) : 0, 0, 1) * DT;
    } else if (lastA === M - 1) endT = gt(M - 1);
    if (endT > onsetT) bout = { onsetT, endT };
  }

  // 6. Steps.
  let peaks = [];
  if (bout) {
    peaks = findPeaks(s, idx(bout.onsetT) - 5, idx(bout.endT) + 5, gt);
    res.onsetT = round(bout.onsetT, 1);
    res.endT = round(bout.endT, 1);
    res.motionDuration_s = round((bout.endT - bout.onsetT) / 1000, 2);
    // Review fix G3 (skeptic's g3c diff): with weak trunk motion the bout can cover only part of
    // the walk, which gives a speed that is too fast. Step rhythm (gaps of 0.6 to 1.6 times the
    // bout's median step gap) after the bout end, or before its start, means part of the walk was
    // not timed. These fail-level 'paused' issues come before the warn-level one, which then
    // does not replace them.
    const biv = [];
    for (let i = 1; i < peaks.length; i++) biv.push(peaks[i] - peaks[i - 1]);
    const bmi = biv.length ? median(biv) : 0;
    if (bmi > 0) {
      const later = findPeaks(s, idx(bout.endT) + 1, M - 1, gt);
      if (rhythmicGaps(later, bmi) >= 3) {
        add('paused', 'fail', 'Walking went on after the timed part ended, so walk the whole distance at a steady pace, then stand still at the line.');
      }
      const earlier = findPeaks(s, searchStart, idx(bout.onsetT) - 1, gt);
      if (earlier.length && peaks.length) earlier.push(peaks[0]);
      if (rhythmicGaps(earlier, bmi) >= 2) {
        add('paused', 'fail', 'The first steps were not found, so start walking at Go with the phone held firmly against your body.');
      }
    }
    if (pauses > 0) add('paused');
  }
  const steps = peaks.length;
  res.steps = steps;
  const intervals = [];
  for (let i = 1; i < peaks.length; i++) intervals.push((peaks[i] - peaks[i - 1]) / 1000);
  // Review fix G5: half the stride time (two steps), so alternating long and short steps (a limp
  // or foot drop) give the mean step rate instead of one side's step time.
  const strides = [];
  for (let i = 2; i < peaks.length; i++) strides.push((peaks[i] - peaks[i - 2]) / 2000);
  if (intervals.length) {
    const mi = median(strides.length >= 3 ? strides : intervals);
    if (mi > 0) res.cadence_spm = round(60 / mi, 1);
  }
  if (distOk && steps > 0) res.stepLength_m = round(dist / steps, 2);

  // 7. Timing.
  let duration = null;
  if (bout && steps >= 4) {
    duration = (bout.endT - bout.onsetT) / 1000;
    res.timing = 'motion';
  } else if (manual !== null && someMovement) {
    duration = manual;
    res.timing = 'manual';
    add('used_manual_timing');
  } else if (!someMovement || !bout) {
    add('no_walk_detected');
  } else {
    add('too_few_steps', 'fail');
  }
  if (duration !== null && steps < 8) add('too_few_steps');
  if (steps >= 4) {
    if (res.cadence_spm !== null && (res.cadence_spm < 50 || res.cadence_spm > 150)) add('cadence_out_of_range');
    if (res.stepLength_m !== null && (res.stepLength_m < 0.3 || res.stepLength_m > 1.1)) add('step_length_out_of_range');
  }
  if (res.motionDuration_s !== null && manual !== null) {
    const motionS = (bout.endT - bout.onsetT) / 1000;
    if (Math.abs(manual - motionS) > Math.max(MISMATCH_MIN_S, 0.2 * motionS)) add('manual_mismatch');
  }
  // Review fix F1/G2: the recording ends at the Stop click, so a bout that runs to the last
  // sample means Stop was tapped while still walking (or moving the phone). Fail, so a
  // cut-short time can never become a baseline.
  if (res.timing === 'motion' && r.stopBy === 'tap' && tLast - bout.endT < TAP_MOVING_MS) add('stopped_while_walking');
  if (duration !== null) {
    res.duration_s = round(duration, 2);
    if (distOk && duration > 0) res.speed_mps = round(dist / duration, 2);
    if (res.speed_mps !== null && (res.speed_mps < MIN_WALK_SPEED || res.speed_mps > MAX_WALK_SPEED)) add('speed_out_of_range');
  }

  // 8. Exploratory values (never used for speed, never fed to the engine).
  const ex = res.exploratory;
  if (intervals.length >= 9) {
    const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const sd = Math.sqrt(intervals.reduce((a, b) => a + (b - mean) ** 2, 0) / (intervals.length - 1));
    ex.stepTimeCv_pct = round((100 * sd) / mean, 1);
    const odd = intervals.filter((_, i) => i % 2 === 0), even = intervals.filter((_, i) => i % 2 === 1);
    const mo = odd.reduce((a, b) => a + b, 0) / odd.length, me = even.reduce((a, b) => a + b, 0) / even.length;
    ex.asymmetry_pct = round((100 * Math.abs(mo - me)) / mean, 1);
  }
  if (bout) {
    const i0 = idx(bout.onsetT), i1 = idx(bout.endT) + 1;
    const lagA = firstAcfPeak(s, i0, i1, 15, 65, 0.2, 0.5);   // step period 0.3 to 1.3 s
    if (lagA !== null) ex.autocorrCadence_spm = round(60 / (lagA * DT / 1000), 1);
    if (gyro) {
      const gm = new Float64Array(M);
      for (let j = 0; j < M; j++) gm[j] = Math.hypot(gyro[0][j], gyro[1][j], gyro[2][j]);
      // The gyro magnitude repeats once per step for an even gait and once per stride (two
      // steps) when left and right differ. The period comes from the gyro alone; whether it is
      // one step or two is settled by the nearer of the accelerometer cadences.
      const lagG = firstAcfPeak(gm, i0, i1, 13, 125, 0.2, 0.6);
      if (lagG !== null) {
        const per = (lagG * DT) / 1000;
        const one = 60 / per, two = 120 / per;
        const ref = res.cadence_spm ?? ex.autocorrCadence_spm;
        let pick;
        if (ref) pick = Math.abs(Math.log(one / ref)) <= Math.abs(Math.log(two / ref)) ? one : two;
        else pick = one >= 50 && one <= 150 ? one : two;
        ex.gyroCadence_spm = round(pick, 1);
      }
      if (mode === 'acc') {
        // Heading change: rotation rate projected on the gravity direction (1 s moving average
        // of the acceleration), integrated over the bout. Platform sign does not matter (abs).
        const gxm = movingMean(ax, 25), gym = movingMean(ay, 25), gzm = movingMean(az, 25);
        let sum = 0;
        const j0 = idx(bout.onsetT), j1 = idx(bout.endT);
        for (let j = j0; j < j1; j++) {
          const norm = Math.hypot(gxm[j], gym[j], gzm[j]);
          if (norm < 1e-6) continue;
          sum += ((gyro[0][j] * gxm[j] + gyro[1][j] * gym[j] + gyro[2][j] * gzm[j]) / norm) * (DT / 1000);
        }
        ex.headingChange_deg = Math.round(Math.abs(sum));
        if (ex.headingChange_deg > TURN_BACK_DEG) {
          add('turned', 'fail', 'You turned around before the phone stopped, so stand still at the line until it stops, then walk back.');
        } else if (ex.headingChange_deg > TURN_DEG) add('turned');
      }
    }
  }
  return finish();
}

function finalize(res) {
  const hasFail = res.issues.some((i) => i.level === 'fail');
  const hasWarn = res.issues.some((i) => i.level === 'warn');
  res.ok = res.speed_mps !== null && !hasFail;
  if (!res.ok) res.speed_mps = hasFail ? null : res.speed_mps;
  if (hasFail) res.quality = 'poor';
  else if (
    res.sampleRate_hz >= 40 && res.steps >= 8 && res.maxGap_ms !== null && res.maxGap_ms <= BIG_GAP_MS &&
    res.cadence_spm !== null && res.cadence_spm >= 50 && res.cadence_spm <= 150 &&
    res.stepLength_m !== null && res.stepLength_m >= 0.3 && res.stepLength_m <= 1.1 &&
    res.timing === 'motion' && !hasWarn
  ) res.quality = 'good';
  else res.quality = 'fair';
  return res;
}

function readSamples(list) {
  const arr = Array.isArray(list) ? list : [];
  const ok = (s) => s && typeof s === 'object' && isNum(s.t);
  const hasAcc = (s) => isNum(s.ax) && isNum(s.ay) && isNum(s.az);
  const hasLin = (s) => isNum(s.lx) && isNum(s.ly) && isNum(s.lz);
  let nT = 0, nAcc = 0, nLin = 0;
  for (const s of arr) {
    if (!ok(s)) continue;
    nT++;
    if (hasAcc(s)) nAcc++;
    if (hasLin(s)) nLin++;
  }
  let mode = null;
  if (nAcc > 0 && nAcc >= 0.5 * nT) mode = 'acc';
  else if (nLin > 0 && nLin >= 0.5 * nT) mode = 'lin';
  else if (nAcc > 0 || nLin > 0) mode = nAcc >= nLin ? 'acc' : 'lin';
  const pts = [];
  for (const s of arr) {
    if (!ok(s) || mode === null) continue;
    let x, y, z;
    if (mode === 'acc') { if (!hasAcc(s)) continue; x = s.ax; y = s.ay; z = s.az; }
    else { if (!hasLin(s)) continue; x = s.lx; y = s.ly; z = s.lz; }
    const g = isNum(s.gx) && isNum(s.gy) && isNum(s.gz);
    pts.push({ t: s.t, x, y, z, gx: g ? s.gx : NaN, gy: g ? s.gy : NaN, gz: g ? s.gz : NaN });
  }
  pts.sort((a, b) => a.t - b.t);                          // stable: the first of equal t is kept
  const out = [];
  for (const p of pts) if (!out.length || p.t > out[out.length - 1].t) out.push(p);
  let nG = 0;
  for (const p of out) if (isNum(p.gx)) nG++;
  return { pts: out, mode, hasGyro: nG >= 2 && nG >= 0.5 * out.length };
}

// Linear interpolation of the given keys onto the grid t0 + j*DT, j < M. mask[j] = 1 when the
// grid point sits inside a gap longer than BIG_GAP_MS.
function resample(pts, keys, t0, M) {
  const ch = keys.map(() => new Float64Array(M));
  const mask = new Uint8Array(M);
  const n = pts.length;
  if (n === 0) return { ch, mask };
  let k = 0;
  for (let j = 0; j < M; j++) {
    const t = t0 + j * DT;
    while (k < n - 2 && pts[k + 1].t < t) k++;
    const a = pts[k], b = pts[Math.min(k + 1, n - 1)];
    const span = b.t - a.t;
    const w = span > 0 ? clamp((t - a.t) / span, 0, 1) : 0;
    for (let c = 0; c < keys.length; c++) ch[c][j] = a[keys[c]] + w * (b[keys[c]] - a[keys[c]]);
    if (span > BIG_GAP_MS && t > a.t && t < b.t) mask[j] = 1;
  }
  return { ch, mask };
}

// Zero-phase 2nd-order Butterworth low-pass (forward then backward), edges padded with the
// edge values for 1 s so the filter starts from rest.
function lowpassZeroPhase(x, fc, fs) {
  const n = x.length;
  const K = Math.tan((Math.PI * fc) / fs);
  const norm = 1 / (1 + Math.SQRT2 * K + K * K);
  const b0 = K * K * norm, b1 = 2 * b0, b2 = b0;
  const a1 = 2 * (K * K - 1) * norm, a2 = (1 - Math.SQRT2 * K + K * K) * norm;
  const P = Math.round(fs);
  const y = new Float64Array(n + 2 * P);
  for (let i = 0; i < y.length; i++) y[i] = x[clamp(i - P, 0, n - 1)];
  const pass = () => {
    let x1 = y[0], x2 = y[0], y1 = y[0], y2 = y[0];
    for (let i = 0; i < y.length; i++) {
      const xi = y[i];
      const yi = b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = xi; y2 = y1; y1 = yi;
      y[i] = yi;
    }
  };
  pass(); y.reverse(); pass(); y.reverse();
  return y.slice(P, P + n);
}

function movingSd(x, half) {
  const n = x.length;
  const c1 = new Float64Array(n + 1), c2 = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) { c1[i + 1] = c1[i] + x[i]; c2[i + 1] = c2[i] + x[i] * x[i]; }
  const out = new Float64Array(n);
  for (let j = 0; j < n; j++) {
    const lo = Math.max(0, j - half), hi = Math.min(n, j + half + 1), k = hi - lo;
    const m = (c1[hi] - c1[lo]) / k;
    out[j] = Math.sqrt(Math.max(0, (c2[hi] - c2[lo]) / k - m * m));
  }
  return out;
}

// Review fix: the opening stillness of a recording with no Go cue. The first stretch of at least
// minLen grid points with env at or under `level` (outside gaps) that has sustained movement
// (SUSTAIN_N points over `level`) somewhere after it. Returns [i0, i1) or null.
function openingStill(env, mask, level, minLen) {
  const M = env.length;
  let start = -1;
  for (let j = 0; j <= M; j++) {
    if (j < M && env[j] <= level && !mask[j]) { if (start < 0) start = j; continue; }
    if (start >= 0 && j - start >= minLen) {
      for (let k = j, run = 0; k < M; k++) {
        if (env[k] > level) { if (++run >= SUSTAIN_N) return [start, j]; } else run = 0;
      }
      return null;                                       // nothing walking-like after it
    }
    start = -1;
  }
  return null;
}

function movingMean(x, half) {
  const n = x.length;
  const c = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) c[i + 1] = c[i] + x[i];
  const out = new Float64Array(n);
  for (let j = 0; j < n; j++) {
    const lo = Math.max(0, j - half), hi = Math.min(n, j + half + 1);
    out[j] = (c[hi] - c[lo]) / (hi - lo);
  }
  return out;
}

// Step peaks in s[i0..i1]: local maxima at least MIN_STEP_GAP_MS apart (highest kept first),
// above an adaptive height. Returns the peak times (parabolic interpolation), in order.
function findPeaks(s, i0, i1, gt) {
  const lo = Math.max(1, i0), hi = Math.min(s.length - 1, i1);
  const cand = [];
  for (let j = lo; j < hi; j++) if (s[j] > EDGE_MIN && s[j] > s[j - 1] && s[j] >= s[j + 1]) cand.push(j);
  if (!cand.length) return [];
  const heights = cand.map((j) => s[j]).sort((a, b) => a - b);
  const hmin = Math.max(EDGE_MIN, 0.35 * quantile(heights, 0.9));
  const keep = cand.filter((j) => s[j] >= hmin).sort((a, b) => s[b] - s[a] || a - b);
  const chosen = [];
  for (const j of keep) {
    const den = s[j - 1] - 2 * s[j] + s[j + 1];
    const off = den < 0 ? clamp((0.5 * (s[j - 1] - s[j + 1])) / den, -0.5, 0.5) : 0;
    const t = gt(j) + off * DT;
    if (chosen.every((c) => Math.abs(c - t) >= MIN_STEP_GAP_MS)) chosen.push(t);
  }
  return chosen.sort((a, b) => a - b);
}

// Review fix G3: how many gaps between consecutive peak times (ms) look like steps, that is
// 0.6 to 1.6 times the bout's median step gap `bmi` (ms).
function rhythmicGaps(times, bmi) {
  let n = 0;
  for (let i = 1; i < times.length; i++) {
    const d = times[i] - times[i - 1];
    if (d >= 0.6 * bmi && d <= 1.6 * bmi) n++;
  }
  return n;
}

// Lag (in grid points, fractional) of the first autocorrelation peak in [minLag, maxLag] that
// reaches max(minR, rel x the highest value in the range). Null when there is none.
function firstAcfPeak(x, i0, i1, minLag, maxLag, minR, rel) {
  const a = Math.max(0, i0), b = Math.min(x.length, i1), n = b - a;
  const top = Math.min(maxLag, n - 2);
  if (top <= minLag + 1) return null;
  let mean = 0;
  for (let i = a; i < b; i++) mean += x[i];
  mean /= n;
  const d = new Float64Array(n);
  let r0 = 0;
  for (let i = 0; i < n; i++) { d[i] = x[a + i] - mean; r0 += d[i] * d[i]; }
  if (r0 <= 1e-12) return null;
  const r = new Float64Array(top + 2);
  for (let L = minLag - 1; L <= top + 1; L++) {
    let acc = 0;
    for (let i = 0; i + L < n; i++) acc += d[i] * d[i + L];
    r[L] = acc / r0;
  }
  let best = -Infinity;
  for (let L = minLag; L <= top; L++) if (r[L] > best) best = r[L];
  const need = Math.max(minR, rel * best);
  for (let L = minLag; L <= top; L++) {
    if (r[L] >= need && r[L] > r[L - 1] && r[L] >= r[L + 1]) {
      const den = r[L - 1] - 2 * r[L] + r[L + 1];
      const off = den < 0 ? clamp((0.5 * (r[L - 1] - r[L + 1])) / den, -0.5, 0.5) : 0;
      return L + off;
    }
  }
  return null;
}

function median(arr) {
  const a = Array.from(arr).sort((x, y) => x - y);
  return quantile(a, 0.5);
}

// Quantile of an ascending array, linear interpolation.
function quantile(sorted, q) {
  const n = sorted.length;
  if (!n) return 0;
  const pos = (n - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** One plain-words line for a WalkResult. */
export function summarizeWalk(result) {
  if (!result || typeof result !== 'object') return 'No walk result to show.';
  const issues = Array.isArray(result.issues) ? result.issues.filter((i) => i && typeof i === 'object') : [];
  if (result.ok && isNum(result.speed_mps)) {
    const bits = [];
    if (isNum(result.distance_m) && isNum(result.duration_s)) {
      const d = Number.isInteger(result.distance_m) ? String(result.distance_m) : result.distance_m.toFixed(1);
      bits.push(`${d} m in ${result.duration_s.toFixed(1)} s`);
    }
    if (isNum(result.steps) && result.steps > 0) {
      bits.push(`${result.steps} steps` + (isNum(result.cadence_spm) ? ` (${Math.round(result.cadence_spm)} a minute)` : ''));
    }
    let line = `${result.speed_mps.toFixed(2)} m/s` + (bits.length ? `: ${bits.join(', ')}.` : '.');
    line += result.timing === 'manual'
      ? ' Timed by your Go and Stop taps, so it includes reaction time.'
      : ' Timed by motion.';
    const q = typeof result.quality === 'string' && result.quality ? result.quality : 'fair';
    return `${line} ${q[0].toUpperCase()}${q.slice(1)} quality.`;
  }
  const worst = issues.find((i) => i.level === 'fail') || issues.find((i) => i.level === 'warn') || issues[0];
  const why = worst && typeof worst.message === 'string' && worst.message
    ? worst.message[0].toLowerCase() + worst.message.slice(1)
    : 'the walk could not be measured.';
  return `No walking speed: ${why}`;
}
