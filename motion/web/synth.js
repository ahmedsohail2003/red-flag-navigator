// synth.js: deterministic synthetic 10 m walks for tests and demos (contract section 4).
// Pure ES module, no imports. Runs in browsers and Node 22.
//
// Every recording it makes is labelled simulated: true. It is a model of trunk motion during
// walking, not data from a person, and it must never be shown as a real walk.
//
// Model, in the body frame (x forward, y left, z up):
// - The walk is `steps` steps. Step k lasts T_k seconds, with T = 60 / cadence_spm and a small
//   step-to-step variation (stepCv, default 2%). Step k runs from s_k to s_{k+1}.
// - Vertical acceleration per step is a smoothed impulse at heel strike (a Gaussian a quarter
//   of the way into the step) minus a raised-cosine trough, so each step averages to zero and is
//   exactly zero at the step boundaries. The impulse shape carries the step-frequency harmonics.
//   The first step is weaker (60%), and there is a small left/right difference.
// - Forward sway at the step frequency, lateral sway at the stride frequency (half the step
//   frequency). Both are zero at step boundaries.
// - Gyroscope: yaw and roll at the stride frequency, pitch at the step frequency (about 8 to 18
//   deg/s at amplitude 2.5), plus an optional constant turn about the vertical axis that
//   integrates to turn_deg over the walk.
// - Before s_0 and after s_n the body is perfectly still (only sensor noise).
// Then: rotate into the phone frame (orientation), add gravity, apply the platform sign
// (gravitySign), add noise, and sample at rateHz with timestamp jitter and an optional dropout.
// `noise` is the accelerometer SD (m/s^2); the gyroscope noise scales with it (0.5 deg/s at the
// default 0.15), so noise: 0 gives a noise-free recording.
//
// truth.onsetT and truth.endT use the same definition analyzeWalk measures: the walking bout runs
// from the first movement (s_0, the instant the simulated trunk starts to move) to the start of
// the final stillness (s_n, the instant it stops; after this only noise remains).
// truth.duration_s = (endT - onsetT) / 1000 and truth.speed_mps = distance_m / duration_s.

const G = 9.80665;          // m/s^2
const T0_MS = 1000;         // sample-clock time of the first sample (a page clock never starts at 0)
const CREATED_AT = '2026-11-08T12:00:00.000Z'; // fixed so the same options give the same recording

// Seeded PRNG (mulberry32): uniform numbers in [0, 1).
function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Standard normal from two uniforms (Box-Muller).
function gauss(rand) {
  const u = Math.max(rand(), 1e-12);
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const num = (v, d) => (isNum(v) ? v : d);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round = (v, dp) => { const f = 10 ** dp; return Math.round(v * f) / f; };

// Rotation matrices: rows are the phone's x, y, z axes written in body coordinates, so
// v_phone = R * v_body.
const UPRIGHT = [[0, 1, 0], [0, 0, 1], [1, 0, 0]];  // phone y up, screen facing forward (waist, pocket)
const FLAT = [[0, -1, 0], [1, 0, 0], [0, 0, 1]];    // phone flat, screen up, top pointing forward

function randomRotation(u1, u2, u3) {
  // Uniform random rotation from three uniforms (Shoemake's quaternion method).
  const a = Math.sqrt(1 - u1), b = Math.sqrt(u1);
  const x = a * Math.sin(2 * Math.PI * u2), y = a * Math.cos(2 * Math.PI * u2);
  const z = b * Math.sin(2 * Math.PI * u3), w = b * Math.cos(2 * Math.PI * u3);
  return [
    [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
    [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
    [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
  ];
}

function isMatrix3(m) {
  return Array.isArray(m) && m.length === 3 &&
    m.every((row) => Array.isArray(row) && row.length === 3 && row.every(isNum));
}

function mul(R, v) {
  return [
    R[0][0] * v[0] + R[0][1] * v[1] + R[0][2] * v[2],
    R[1][0] * v[0] + R[1][1] * v[1] + R[1][2] * v[2],
    R[2][0] * v[0] + R[2][1] * v[1] + R[2][2] * v[2],
  ];
}

// Vertical acceleration shape for one step, u = phase in [0, 1). Zero mean, zero at both ends,
// normalised so its heel-strike peak is 1.
const IMPULSE_AT = 0.25, IMPULSE_SD = 0.08;
const gaussShape = (u) => Math.exp(-0.5 * ((u - IMPULSE_AT) / IMPULSE_SD) ** 2);
const SHAPE = (() => {
  const N = 4000;
  let mean = 0;
  for (let i = 0; i < N; i++) mean += gaussShape((i + 0.5) / N);
  mean /= N;
  let peak = 0;
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    peak = Math.max(peak, gaussShape(u) - mean * (1 - Math.cos(2 * Math.PI * u)));
  }
  return { mean, peak };
})();
function verticalShape(u) {
  return (gaussShape(u) - SHAPE.mean * (1 - Math.cos(2 * Math.PI * u))) / SHAPE.peak;
}

/**
 * Make a synthetic walk recording (contract section 2) with truth and simulated: true.
 * Options (contract section 4) and extras:
 *   gapAt_s: seconds from the first sample to the start of a dropout of gap_ms (not from goT).
 *   stepCv: step-to-step time variation as a fraction (extra, default 0.02).
 *   stepAsym: alternating long and short steps, as with a limp or foot drop (extra, default 0,
 *     at most 0.5). Steps 0, 2, 4... last T x (1 - stepAsym), steps 1, 3, 5... T x (1 + stepAsym),
 *     so the mean step time stays T. It draws no random numbers, so 0 changes nothing.
 *   placement: recording placement label (extra, default "waist").
 *   gravitySign: -1 flips the sign of every reported acceleration axis (iPhone-style platform
 *     sign), so gravity and the walking motion flip together, as they do on a real phone.
 */
export function synthWalk(opts = {}) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const rateHz = clamp(num(o.rateHz, 60), 5, 1000);
  const jitterMs = Math.max(0, num(o.jitterMs, 2));
  const distance_m = 'distance_m' in o ? o.distance_m : 10;
  const nSteps = Math.round(clamp(num(o.steps, 14), 1, 5000));
  const cadence = clamp(num(o.cadence_spm, 110), 20, 300);
  const standBefore = Math.max(0, num(o.standBefore_s, 3));
  const reaction = Math.max(0, num(o.reaction_s, 0.6));
  const standAfter = Math.max(0, num(o.standAfter_s, 2));
  const noise = Math.max(0, num(o.noise, 0.15));
  const amplitude = Math.max(0, num(o.amplitude, 2.5));
  const gapAt = isNum(o.gapAt_s) ? o.gapAt_s : null;
  const gapMs = Math.max(0, num(o.gap_ms, 400));
  const withGyro = o.withGyro !== false;
  const turnDeg = num(o.turn_deg, 0);
  const stopBy = ['tap', 'auto', 'timeout', null].includes(o.stopBy) ? o.stopBy : 'tap';
  const tapDelay = Math.max(0, num(o.tapDelay_s, 0.4));
  const seed = Math.floor(num(o.seed, 1));
  const gs = o.gravitySign === -1 ? -1 : 1;
  const stepCv = clamp(num(o.stepCv, 0.02), 0, 0.3);
  const stepAsym = clamp(num(o.stepAsym, 0), 0, 0.5);
  const placement = typeof o.placement === 'string' ? o.placement : 'waist';

  const rand = mulberry32((seed ^ 0x9E3779B9) >>> 0);

  // Orientation: always draw three uniforms so the noise stays the same whatever is chosen.
  const ru = [rand(), rand(), rand()];
  let R;
  if (isMatrix3(o.orientation)) R = o.orientation.map((row) => row.slice());
  else if (o.orientation === 'upright') R = UPRIGHT;
  else if (o.orientation === 'flat') R = FLAT;
  else R = randomRotation(ru[0], ru[1], ru[2]);

  // Step boundaries s_0..s_n (ms) and per-step strength.
  const T = 60 / cadence;
  const goT = T0_MS + standBefore * 1000;
  const bounds = [goT + reaction * 1000];
  const strength = [];
  for (let k = 0; k < nSteps; k++) {
    let d = T * clamp(1 + stepCv * gauss(rand), 0.7, 1.3);
    if (stepAsym > 0) d *= k % 2 === 0 ? 1 - stepAsym : 1 + stepAsym;
    bounds.push(bounds[k] + d * 1000);
    const side = k % 2 === 0 ? 0.97 : 1.03;                  // small left/right difference
    const vary = clamp(1 + 0.05 * gauss(rand), 0.85, 1.15);  // step-to-step variation
    strength.push((k === 0 ? 0.6 : 1) * side * vary);        // the first step is weaker
  }
  const onsetT = bounds[0];
  const endT = bounds[nSteps];
  const walkS = (endT - onsetT) / 1000;
  const turnRate = walkS > 0 ? turnDeg / walkS : 0;        // deg/s about the vertical axis
  const gyroScale = amplitude / 2.5;
  const gyroNoise = (0.5 * noise) / 0.15;                  // deg/s; 0.5 at the default noise, 0 when noise is 0

  let stopT = null;
  if (stopBy === 'tap') stopT = endT + tapDelay * 1000;
  else if (stopBy === 'auto') stopT = endT + 1500;          // auto-stop after 1.5 s of stillness
  let tEnd = endT + standAfter * 1000;
  if (stopT !== null && stopT + 20 > tEnd) tEnd = stopT + 20;
  if (stopBy === 'timeout') stopT = tEnd;

  const dtMs = 1000 / rateHz;
  const nSamples = Math.floor((tEnd - T0_MS) / dtMs) + 1;
  const gap0 = gapAt === null ? null : T0_MS + gapAt * 1000;
  const samples = [];
  let k = 0;
  for (let i = 0; i < nSamples; i++) {
    // Draw every random number for every sample, so a gap or withGyro never shifts the noise.
    const jit = gauss(rand) * jitterMs;
    const na = [gauss(rand), gauss(rand), gauss(rand)];
    const nl = [gauss(rand), gauss(rand), gauss(rand)];
    const ng = [gauss(rand), gauss(rand), gauss(rand)];
    const t = T0_MS + i * dtMs + (i > 0 ? clamp(jit, -0.45 * dtMs, 0.45 * dtMs) : 0);
    if (gap0 !== null && t >= gap0 && t < gap0 + gapMs) continue;

    let aFwd = 0, aLeft = 0, aUp = 0, wRoll = 0, wPitch = 0, wYaw = 0;
    if (t >= onsetT && t < endT) {
      while (k < nSteps - 1 && t >= bounds[k + 1]) k++;
      const u = (t - bounds[k]) / (bounds[k + 1] - bounds[k]);
      const phi = k + u;                                      // steps since the start
      const a = amplitude * strength[k];
      aUp = a * verticalShape(u);
      aFwd = 0.35 * a * Math.sin(2 * Math.PI * phi);          // step frequency
      aLeft = 0.25 * a * Math.sin(Math.PI * phi);             // stride frequency
      const g = gyroScale * strength[k];
      wYaw = 18 * g * Math.sin(Math.PI * phi) + turnRate;
      wRoll = 8 * g * Math.sin(Math.PI * phi);
      wPitch = 10 * g * Math.sin(2 * Math.PI * phi);
    }
    const acc = mul(R, [aFwd, aLeft, aUp + G]);               // with gravity (reads +g on the up axis)
    const lin = mul(R, [aFwd, aLeft, aUp]);
    const gyr = mul(R, [wRoll, wPitch, wYaw]);
    samples.push({
      t: round(t, 3),
      ax: round(gs * acc[0] + noise * na[0], 4),
      ay: round(gs * acc[1] + noise * na[1], 4),
      az: round(gs * acc[2] + noise * na[2], 4),
      gx: withGyro ? round(gyr[0] + gyroNoise * ng[0], 3) : null,
      gy: withGyro ? round(gyr[1] + gyroNoise * ng[1], 3) : null,
      gz: withGyro ? round(gyr[2] + gyroNoise * ng[2], 3) : null,
      lx: round(gs * lin[0] + noise * nl[0], 4),
      ly: round(gs * lin[1] + noise * nl[1], 4),
      lz: round(gs * lin[2] + noise * nl[2], 4),
    });
  }

  const duration_s = walkS;
  const speed_mps = isNum(distance_m) && duration_s > 0 ? distance_m / duration_s : null;
  const idSeed = String(seed).replace(/[^0-9A-Za-z]/g, 'm');
  return {
    v: 1,
    kind: 'rfn-walk-recording',
    id: `w-sim-${idSeed}-${Math.round(cadence)}-${nSteps}-${Math.round(rateHz)}`,
    createdAt: typeof o.createdAt === 'string' ? o.createdAt : CREATED_AT,
    device: { ua: 'synthetic walk (synth.js), not a real phone' },
    distance_m,
    placement,
    goT: round(goT, 3),
    stopT: stopT === null ? null : round(stopT, 3),
    stopBy,
    samples,
    truth: {
      onsetT: round(onsetT, 3),
      endT: round(endT, 3),
      steps: nSteps,
      duration_s,
      speed_mps,
    },
    simulated: true,
  };
}
