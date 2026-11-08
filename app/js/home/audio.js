// Microphone timing tools for four home tasks: syllable repetition rate ("pa-ta-ka"),
// maximum phonation time (one long "aah"), single-breath count (counting aloud on one
// breath) and pause time while reading aloud. The analysis is pure functions on
// Float32Array samples, so any recording can be measured and the maths is tested with
// made-up signals (tests/home-audio.test.mjs). Timing tools, not validated: no clinical
// numbers (MDCs, cut-offs) live here; those are in catalog.js.
//
// API (times in seconds, levels in dB relative to full scale). In the analysis functions an
// option that is left out, null or not a number takes its default; null is never read as 0.
// The options argument itself may be left out or null.
//   frameRms(samples, sampleRate, frameMs = 10) -> Float64Array, RMS of each whole frame
//   toDb(rmsArray) -> Float64Array; digital silence is -120, bad values are NaN
//   noiseFloorDb(dbArray, pct = 2) -> background level: a low percentile of frame levels
//     (digital silence counts, at -120). About 2% of a recording or more must be quiet.
//   detectVoice(dbArray, { frameMs = 10, onDb, offDb, minOnMs = 50, minGapMs = 100 })
//     -> [{ start, end }]; thresholds default to 10 dB (on) and 6 dB (off) above the floor
//   longestSegment(segments) -> { start, end, duration } | null
//   countBursts(dbArray, { frameMs = 10, minPeakDistMs = 100, prominenceDb = 2, minDb, smoothMs = 64 })
//     -> [{ t, db }]; minDb defaults to 10 dB above the floor; smoothMs is capped at 1000
//   burstRate(peaks, { startS, endS }) -> { count, durationS, perSecond, cvIntervalPct }
//     perSecond = (count - 1) / durationS, durationS = first to last burst in the window
//   pauseStats(segments, totalS, { minPauseMs = 300 }) -> { speechS, pauseS, pausePct, pauses, spanS }
//     pauses = [{ start, end }]; pausePct = pauseS / spanS * 100, spanS = first word to last
//   analyzeTask(kind, samples, sampleRate), kind 'ddk' | 'mpt' | 'sbc' | 'reading'
//     -> { ok, kind, test, value, unit, flags, tips, reason, detail }
//     test and unit follow the shared Result vocabulary (AUDIO_TASKS); flags are plain
//     words: 'too quiet', 'clipped', 'noisy background', 'too short'; tips[i] says what to
//     do about flags[i]; ok is false when there is no number, and reason says why.
//   AUDIO_TASKS, QUALITY_TIPS: constants
//   micSupport(env = globalThis) -> { ok, reason }
//   recordAudio({ seconds = 10, stream, onStart, onLevel, abortSignal, env = globalThis, graceMs = 3000 })
//     -> Promise of { ok: true, samples, sampleRate, seconds } or { ok: false, reason, ... }
//     When it opens the microphone itself it asks for raw sound (no echo cancelling, noise
//     suppression or auto gain). It keeps the first channel, at the device's sample rate.
//     onStart() fires once, when the first sound arrives. In a Chromium browser on Windows
//     that took about half a second after the call, so say "Go" from onStart, not on calling.
//     onLevel({ level 0..1, db, peak, elapsedS }) feeds a meter. The tracks of the stream
//     used are always stopped afterwards, also one passed in, and also on error or cancel.
//     A cancel works at any point, also while the browser is still asking for permission
//     (a microphone granted after that is released at once). Once sound flows it returns
//     { ok: false, aborted: true, reason, samples, sampleRate } with what was recorded so
//     far. The time limit runs from the first sound, so a slow microphone gets the full
//     length. seconds, env and graceMs left out or null take their defaults; a seconds
//     value that is not a number gives { ok: false, reason }. env and graceMs (extra wait
//     before giving up on a silent microphone) exist for tests.
//   explainMicError(err) -> plain words for a getUserMedia error
//
// Method and sources:
// - Syllables are found with the core idea of de Jong & Wempe (2009), "Praat script to
//   detect syllable nuclei and measure speech rate automatically", Behav Res Methods
//   41:385-390, doi:10.3758/BRM.41.2.385: a syllable nucleus is a peak in intensity (dB)
//   with a dip before and after it. Their later script, syllablenuclei_v3 (de Jong, Wempe &
//   Pacilly 2019, https://sites.google.com/view/uhm-o-meter/scripts/syllablenuclei_v3),
//   gives the defaults used here: sound more than 25 dB below the 99th-percentile level is
//   silence, a peak needs a 2 dB dip, and a silence of 0.3 s or more is a pause. The code
//   is new, not their GPL script. Simplified here:
//     - 10 ms RMS frames smoothed with a 64 ms Hann window in place of Praat's intensity
//       contour (their paper smooths over 64 ms);
//     - the dip test is topographic prominence: a peak's dip is measured on each side down
//       to the nearest higher peak, so a small ripple next to a big syllable does not hide it;
//     - a burst is timed at the middle of its top (within 1 dB of the peak), not at the
//       single loudest frame, so a flat-topped vowel is timed at its centre;
//     - no pitch check for voicing: energy only. A hoarse or breathy voice is not dropped,
//       but a loud non-voice sound (a cough, a knock) can count as a syllable.
// - Rong (2020), JSLHR 63:59-73, doi:10.1044/2019_JSLHR-19-00178, took a syllable rate and
//   the cycle-to-cycle timing variability from the amplitude envelope of a DDK task in ALS.
//   cvIntervalPct here is the plain coefficient of variation of the gaps between bursts,
//   not that paper's measure. The paper names voicing that carries on between syllables as
//   a barrier for acoustic DDK analysis; it fills the dips this method relies on, so
//   syllables can be missed.
// - Novotny et al. (2020), JSLHR 63:3453-3460, doi:10.1044/2020_JSLHR-20-00109, compared
//   automatic DDK methods in ALS: simple envelope methods were less robust than deep
//   learning or multi-step methods. That is why these are labelled "not validated".
// - Pauses follow the SPA settings in Yunusova et al. (2016), PLoS One 11:e0147573,
//   doi:10.1371/journal.pone.0147573: speech events of at least 25 ms, pauses of at least
//   300 ms, and % pause = the share of total reading time spent pausing. Connaghan et al.
//   (2025), Muscle Nerve 72:321-326, doi:10.1002/mus.28435, used the same percent pause time
//   from smartphone readings in ALS.
// - Single-breath count: most studies counted at 2 numbers per second in a normal voice
//   (Bhandari et al. 2024 review, doi:10.1097/MS9.0000000000001853). The count here assumes
//   that pace: numbers are told apart as word-length bursts at least 300 ms apart, so a
//   number with three or more syllables ("twenty-one") can still be counted twice. It is an
//   estimate for the person to check against the number they reached.

// ---------- settings (signal processing only, no clinical numbers) ----------
const FRAME_MS = 10;
const DB_FLOOR = -120; // level given to digital silence, so log10(0) never gives -Infinity
const MIN_RMS = 1e-6; // 20 * log10(1e-6) = -120 dB
// Background = 2nd percentile of frame levels. Low, because a long "aah" can fill almost the
// whole recording: this needs only 2% of it to be quiet (0.6 s in 30 s).
const FLOOR_PCT = 2;
const TOP_PCT = 99; // loudest level, ignoring the odd click (as the v3 script does)
const ON_ABOVE_FLOOR_DB = 10; // default: voice starts 10 dB above the background...
const OFF_ABOVE_FLOOR_DB = 6; // ...and ends below 6 dB above it, so it does not flicker
const BELOW_TOP_DB = 25; // v3 script: sound 25 dB under the loudest part is silence
const HYSTERESIS_DB = 4; // gap between the start and stop thresholds in analyzeTask
const PROMINENCE_DB = 2; // v3 script: minimum dip near a peak
const TOP_BAND_DB = 1; // a burst's top: frames within 1 dB of its peak
const MIN_PAUSE_MS = 300; // SPA and the v3 script
const MIN_SPEECH_MS = 25; // SPA
const CLIP_LEVEL = 0.99; // samples this close to full scale count as clipped
const CLIP_SHARE = 0.001; // flag when 0.1% of samples or more are clipped
const QUIET_DBFS = -50; // loudest part quieter than this: too quiet
const MIN_CONTRAST_DB = 20; // voice less than 20 dB above the background: noisy
const MIN_FRAMES = 10; // under 100 ms there is nothing to measure
const MAX_SMOOTH_MS = 1000; // longer smoothing would merge syllables, and its cost grows with it

// Per task. Gaps shorter than minGapMs are joined into one stretch of voice.
const TASK_SETTINGS = {
  // Repetitions: stop closures between syllables are short; a silence of 400 ms or more
  // splits the run (a breath, or a word before starting), and the run with most bursts is
  // measured. Peaks closer than 100 ms count once, which caps the count at 10 per second.
  ddk: { minOnMs: 30, minGapMs: 400, smoothMs: 64, minPeakDistMs: 100, fewBursts: 5, minBursts: 3 },
  // A held vowel: gaps under 150 ms are voice breaks and are joined; longer gaps end the hold.
  mpt: { minOnMs: 100, minGapMs: 150 },
  // Counting: at 2 numbers per second the gaps between numbers are short; a silence of
  // 500 ms or more is taken as a breath. Word-length bursts: 200 ms smoothing, 300 ms apart.
  sbc: { minOnMs: 50, minGapMs: 500, smoothMs: 200, minPeakDistMs: 300 },
  // Reading: under 3 s of speech is not the passage; the percentage would rest on a gap or two.
  reading: { minOnMs: MIN_SPEECH_MS, minGapMs: 0, minSpanS: 3 },
};

// The four tasks, in the shared Result vocabulary (labels as in catalog.js).
export const AUDIO_TASKS = Object.freeze({
  ddk: Object.freeze({ test: 'ddk_rate', unit: 'syllables/s', label: 'Syllable repetition (pa-ta-ka)' }),
  mpt: Object.freeze({ test: 'mpt', unit: 's', label: 'Hold "aah" as long as you can' }),
  sbc: Object.freeze({ test: 'single_breath_count', unit: 'count', label: 'Count aloud on one breath' }),
  reading: Object.freeze({ test: 'pause_pct', unit: '%', label: 'Pauses while reading aloud' }),
});

export const QUALITY_TIPS = Object.freeze({
  'too quiet': 'We could barely hear you. Hold the phone closer to your mouth and speak at your usual loudness.',
  clipped: 'The sound was so loud that it got cut off. Hold the phone a little further from your mouth.',
  'noisy background': 'Your voice did not stand out from the background. Try a quieter room, away from fans, TV or traffic, and stay quiet for a second before you start.',
  'too short': 'The recording was too short to measure. Please try again and keep going until the task is done.',
});
const SHORT_TIPS = {
  cutOff: 'The recording ended while you were still going, so this number is too low. Please record again with more time.',
  cutOffStart: 'You had already started before the recording began, so this number is too low. Please record again and start only when the screen says go.',
  ddk: 'We heard only a few syllables. Say "pa-ta-ka" over and over, as fast and as clearly as you can, until the time is up.',
  reading: 'The reading was too short to measure. Please read the whole passage aloud.',
};
const NOT_FOUND = 'We could not find the task in this recording. Please try again.';

// ---------- small helpers ----------
const isList = (a) => a != null && typeof a !== 'string' && typeof a !== 'function' && Number.isInteger(a.length) && a.length >= 0;
const round = (x, d) => (Number.isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : NaN);

// A number, or NaN. Number(null) and Number('') are 0, which would turn a missing start time
// into 0 s or a missing threshold into 0 dB; here they are NaN, as are true and false.
function num(x) {
  if (typeof x === 'number') return x;
  if (typeof x === 'string' && x.trim() !== '') return Number(x);
  return NaN;
}
// An option: left out, null or not a number takes the default.
const opt = (x, fallback) => { const v = num(x); return Number.isNaN(v) ? fallback : v; };
// An options argument: null or anything else that is not an object counts as none given.
const optsOf = (o) => (o && typeof o === 'object' ? o : {});

// A frame level as a number: -Infinity is digital silence, anything that is not a number is NaN.
function level(x) {
  const v = num(x);
  if (v === -Infinity) return DB_FLOOR;
  return Number.isFinite(v) ? Math.max(v, DB_FLOOR) : NaN;
}

function percentile(values, p) {
  const v = Float64Array.from(values).sort();
  if (!v.length) return NaN;
  const idx = (p / 100) * (v.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return v[lo] + (v[hi] - v[lo]) * (idx - lo);
}

function knownLevels(dbArray) {
  const out = [];
  if (isList(dbArray)) for (let i = 0; i < dbArray.length; i++) { const v = level(dbArray[i]); if (!Number.isNaN(v)) out.push(v); }
  return out;
}

// Sample SD (n - 1), as in hometests.js.
function meanSd(xs) {
  const m = xs.reduce((s, x) => s + x, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
  return { m, sd };
}

// ---------- frame levels ----------
// RMS of each whole frame of n samples, after taking away a constant offset (dc).
// Samples that are not finite numbers count as silence.
function rmsFrames(samples, n, dc) {
  const frames = Math.floor(samples.length / n);
  const out = new Float64Array(frames);
  for (let f = 0; f < frames; f++) {
    let ss = 0;
    for (let i = f * n, end = i + n; i < end; i++) {
      const x = samples[i];
      if (typeof x === 'number' && Number.isFinite(x)) ss += (x - dc) * (x - dc);
    }
    out[f] = Math.sqrt(ss / n);
  }
  return out;
}

export function frameRms(samples, sampleRate, frameMs = FRAME_MS) {
  const sr = num(sampleRate);
  const fm = opt(frameMs, FRAME_MS);
  if (!isList(samples) || !(sr > 0 && sr < Infinity) || !(fm > 0 && fm < Infinity)) return new Float64Array(0);
  const n = Math.round((sr * fm) / 1000);
  return n >= 1 ? rmsFrames(samples, n, 0) : new Float64Array(0);
}

export function toDb(rmsArray) {
  if (!isList(rmsArray)) return new Float64Array(0);
  const out = new Float64Array(rmsArray.length);
  for (let i = 0; i < out.length; i++) {
    const x = num(rmsArray[i]);
    out[i] = x >= 0 && x < Infinity ? 20 * Math.log10(Math.max(x, MIN_RMS)) : NaN;
  }
  return out;
}

// Digital silence (exact zeros, at -120 dB) counts as background: a synthetic demo stream
// or a phone that gates silence has nothing else between sounds. The cost: over 2% of exact
// zeros at the start of a recording made in a noisy room would hide the noise. analyzeTask
// is safe from a floor that is too low, because voice must also be within 25 dB of the
// loudest part.
export function noiseFloorDb(dbArray, pct = FLOOR_PCT) {
  const known = knownLevels(dbArray);
  if (!known.length) return NaN;
  const p = opt(pct, FLOOR_PCT);
  return percentile(known, Number.isFinite(p) ? Math.min(100, Math.max(0, p)) : FLOOR_PCT);
}

// ---------- voice segments ----------
export function detectVoice(dbArray, options) {
  const o = optsOf(options);
  const frameMs = opt(o.frameMs, FRAME_MS);
  if (!isList(dbArray) || !dbArray.length || !(frameMs > 0 && frameMs < Infinity)) return [];
  let on = num(o.onDb);
  let off = num(o.offDb);
  if (!Number.isFinite(on) || !Number.isFinite(off)) {
    const floor = noiseFloorDb(dbArray);
    if (!Number.isFinite(floor)) return [];
    if (!Number.isFinite(on)) on = floor + ON_ABOVE_FLOOR_DB;
    if (!Number.isFinite(off)) off = floor + OFF_ABOVE_FLOOR_DB;
  }
  off = Math.min(off, on);
  // Hysteresis: start at `on`, stop only below `off`. Unknown frames count as silence.
  const raw = [];
  let start = -1;
  for (let i = 0; i < dbArray.length; i++) {
    const v = level(dbArray[i]);
    if (start < 0) {
      if (v >= on) start = i;
    } else if (!(v >= off)) {
      raw.push([start, i]);
      start = -1;
    }
  }
  if (start >= 0) raw.push([start, dbArray.length]);
  const sec = (i) => (i * frameMs) / 1000;
  const gap = Math.max(0, opt(o.minGapMs, 100)) / 1000;
  const minOn = Math.max(0, opt(o.minOnMs, 50)) / 1000;
  const joined = [];
  for (const [a, b] of raw) {
    const last = joined[joined.length - 1];
    if (last && sec(a) - last.end < gap - 1e-9) last.end = sec(b);
    else joined.push({ start: sec(a), end: sec(b) });
  }
  return joined.filter((s) => s.end - s.start >= minOn - 1e-9);
}

export function longestSegment(segments) {
  let best = null;
  if (isList(segments)) {
    for (const s of Array.from(segments)) {
      const a = num(s && s.start);
      const b = num(s && s.end);
      if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) continue;
      if (!best || b - a > best.duration) best = { start: a, end: b, duration: b - a };
    }
  }
  return best;
}

// ---------- bursts (syllables) ----------
// Smooth the energy (not the dB values) with a Hann window of about `frames` frames.
function smoothEnvelope(dbArray, frames) {
  const n = dbArray.length;
  const lv = Float64Array.from({ length: n }, (_, i) => level(dbArray[i]));
  const len = frames % 2 ? frames : frames + 1; // odd, so the window is centred
  if (len <= 1) return lv.map((v) => (Number.isNaN(v) ? DB_FLOOR : v));
  const half = (len - 1) / 2;
  const w = Float64Array.from({ length: len }, (_, k) => 0.5 - 0.5 * Math.cos((2 * Math.PI * (k + 1)) / (len + 1)));
  const power = lv.map((v) => (Number.isNaN(v) ? 0 : 10 ** (v / 10)));
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    let ws = 0;
    for (let k = 0; k < len; k++) {
      const j = i + k - half;
      if (j >= 0 && j < n) { s += w[k] * power[j]; ws += w[k]; }
    }
    out[i] = 10 * Math.log10(Math.max(s / ws, MIN_RMS * MIN_RMS));
  }
  return out;
}

export function countBursts(dbArray, options) {
  const o = optsOf(options);
  const frameMs = opt(o.frameMs, FRAME_MS);
  if (!isList(dbArray) || dbArray.length < 3 || !(frameMs > 0 && frameMs < Infinity)) return [];
  const n = dbArray.length;
  const smoothMs = Math.min(MAX_SMOOTH_MS, Math.max(0, opt(o.smoothMs, 64)));
  const env = smoothEnvelope(dbArray, Math.max(1, Math.round(smoothMs / frameMs)));
  let threshold = num(o.minDb);
  if (!Number.isFinite(threshold)) {
    const floor = noiseFloorDb(dbArray);
    if (!Number.isFinite(floor)) return [];
    threshold = floor + ON_ABOVE_FLOOR_DB;
  }
  const promIn = num(o.prominenceDb);
  const prom = promIn >= 0 ? promIn : PROMINENCE_DB;
  // Local maxima; a flat top (i..j) counts once.
  const cands = [];
  for (let i = 1; i < n - 1;) {
    if (env[i] > env[i - 1]) {
      let j = i;
      while (j + 1 < n && env[j + 1] === env[i]) j++;
      if (j + 1 < n && env[j + 1] < env[i]) cands.push({ i, j });
      i = j + 1;
    } else i++;
  }
  // Keep peaks that are loud enough and stand at least `prom` dB above the dip on each
  // side. Each side's dip is the lowest point before a higher peak. On the right an equal
  // peak also stops the search, so of two equal twins only the later one can pass.
  const kept = [];
  for (const { i, j } of cands) {
    const h = env[i];
    if (h < threshold) continue;
    let leftMin = h;
    for (let k = i - 1; k >= 0 && env[k] <= h; k--) if (env[k] < leftMin) leftMin = env[k];
    let rightMin = h;
    for (let k = j + 1; k < n && env[k] < h; k++) if (env[k] < rightMin) rightMin = env[k];
    if (h - Math.max(leftMin, rightMin) < prom) continue;
    // Time it at the middle of its top: the frames within 1 dB of the peak, but never
    // across a higher neighbour (possible when prominenceDb is under 1 dB).
    let a = i;
    let b = j;
    while (a > 0 && env[a - 1] <= h && h - env[a - 1] <= TOP_BAND_DB) a--;
    while (b < n - 1 && env[b + 1] <= h && h - env[b + 1] <= TOP_BAND_DB) b++;
    kept.push({ at: (a + b) / 2, h });
  }
  // Peaks closer than minPeakDistMs: keep the louder one (the earlier one on a tie). Louder
  // peaks claim their place first. Chosen peaks are filed in cells one minimum distance wide,
  // so a peak is compared only with those in its own and the two next cells. Comparing it
  // with every chosen peak gave the same peaks but took 37 s for three hours of syllables,
  // against 0.8 s this way.
  const minDist = Math.max(0, opt(o.minPeakDistMs, 100)) / frameMs;
  const chosen = [];
  const cells = new Map();
  for (const p of kept.slice().sort((x, y) => y.h - x.h || x.at - y.at)) {
    if (minDist > 1e-9) {
      const cell = Math.floor(p.at / minDist);
      let tooClose = false;
      for (let c = cell - 1; c <= cell + 1 && !tooClose; c++) {
        for (const q of cells.get(c) || []) if (Math.abs(q.at - p.at) < minDist - 1e-9) tooClose = true;
      }
      if (tooClose) continue;
      if (!cells.has(cell)) cells.set(cell, []);
      cells.get(cell).push(p);
    }
    chosen.push(p);
  }
  chosen.sort((x, y) => x.at - y.at);
  return chosen.map((p) => ({ t: ((p.at + 0.5) * frameMs) / 1000, db: p.h }));
}

// Rate from the gaps between bursts: 1 / the mean gap. Silence before the first burst or
// after the last does not change it.
export function burstRate(peaks, options) {
  const o = optsOf(options);
  const lo = opt(o.startS, -Infinity); // a window edge that is left out or null is open
  const hi = opt(o.endS, Infinity);
  const times = [];
  if (isList(peaks)) {
    for (const p of Array.from(peaks)) {
      const t = typeof p === 'number' ? p : p && typeof p === 'object' ? num(p.t) : NaN;
      if (Number.isFinite(t) && t >= lo && t <= hi) times.push(t);
    }
  }
  times.sort((a, b) => a - b);
  const count = times.length;
  const durationS = count >= 2 ? times[count - 1] - times[0] : 0;
  const perSecond = count >= 2 && durationS > 0 ? (count - 1) / durationS : NaN;
  let cvIntervalPct = NaN;
  if (count >= 3) {
    const gaps = times.slice(1).map((t, k) => t - times[k]);
    const { m, sd } = meanSd(gaps);
    cvIntervalPct = m > 0 ? (sd / m) * 100 : NaN;
  }
  return { count, durationS, perSecond, cvIntervalPct };
}

// ---------- pauses ----------
// Reading time runs from the first word to the last, so waiting before starting or after
// finishing is not pausing. Gaps shorter than minPauseMs (stop consonants, the joins
// between words) count as speech, as in SPA.
export function pauseStats(segments, totalS, options) {
  const total = num(totalS);
  const limit = total > 0 ? total : Infinity;
  const segs = [];
  if (isList(segments)) {
    for (const s of Array.from(segments)) {
      const a = Math.max(0, num(s && s.start)); // a missing start is skipped, not read as 0 s
      const b = Math.min(limit, num(s && s.end));
      if (Number.isFinite(a) && Number.isFinite(b) && b > a) segs.push({ start: a, end: b });
    }
  }
  segs.sort((x, y) => x.start - y.start);
  const joined = [];
  for (const s of segs) {
    const last = joined[joined.length - 1];
    if (last && s.start <= last.end) last.end = Math.max(last.end, s.end);
    else joined.push({ ...s });
  }
  if (!joined.length) return { speechS: 0, pauseS: 0, pausePct: NaN, pauses: [], spanS: 0 };
  const minPauseMs = num(optsOf(options).minPauseMs);
  const minPause = (minPauseMs >= 0 ? minPauseMs : MIN_PAUSE_MS) / 1000;
  const pauses = [];
  for (let k = 1; k < joined.length; k++) {
    if (joined[k].start - joined[k - 1].end >= minPause - 1e-9) pauses.push({ start: joined[k - 1].end, end: joined[k].start });
  }
  const spanS = joined[joined.length - 1].end - joined[0].start;
  const pauseS = pauses.reduce((s, p) => s + (p.end - p.start), 0);
  return { speechS: spanS - pauseS, pauseS, pausePct: spanS > 0 ? (pauseS / spanS) * 100 : NaN, pauses, spanS };
}

// ---------- the four tasks ----------
// The stretch of voice holding the most bursts (ties: the longer one).
function busiestRun(runs, bursts) {
  let best = null;
  for (const r of runs) {
    const inside = bursts.filter((b) => b.t >= r.start && b.t <= r.end);
    if (!inside.length) continue;
    if (!best || inside.length > best.inside.length || (inside.length === best.inside.length && r.end - r.start > best.run.end - best.run.start)) {
      best = { run: r, inside };
    }
  }
  return best;
}

export function analyzeTask(kind, samples, sampleRate) {
  const task = typeof kind === 'string' && Object.hasOwn(AUDIO_TASKS, kind) ? AUDIO_TASKS[kind] : null;
  const out = { ok: false, kind, test: task ? task.test : null, value: NaN, unit: task ? task.unit : null, flags: [], tips: [], reason: '', detail: {} };
  if (!task) return { ...out, reason: `Unknown task. Use one of: ${Object.keys(AUDIO_TASKS).join(', ')}.` };
  if (!isList(samples) || !samples.length) return { ...out, reason: 'There is no recording to measure. Please record the task again.' };
  const sr = num(sampleRate);
  if (!(sr >= 1000 && sr < Infinity)) return { ...out, reason: 'The recording has no usable sample rate. Please record it again.' };

  // Clipping is judged on the raw samples; levels after taking away any constant offset.
  const n = samples.length;
  let sum = 0;
  let finite = 0;
  let clipped = 0;
  for (let i = 0; i < n; i++) {
    const x = samples[i];
    if (typeof x !== 'number' || !Number.isFinite(x)) continue;
    sum += x;
    finite++;
    if (Math.abs(x) >= CLIP_LEVEL) clipped++;
  }
  const perFrame = Math.round((sr * FRAME_MS) / 1000);
  const frameMs = (perFrame * 1000) / sr; // the true frame length, so odd sample rates keep time
  const db = toDb(rmsFrames(samples, perFrame, finite ? sum / finite : 0));
  const recordingS = n / sr;
  const endS = (db.length * frameMs) / 1000;
  const detail = { recordingS, sampleRate: sr, frameMs, clippedPct: (clipped / n) * 100 };
  if (db.length < MIN_FRAMES) {
    return { ...out, flags: ['too short'], tips: [QUALITY_TIPS['too short']], reason: QUALITY_TIPS['too short'], detail };
  }

  // Voice starts above the background and within 25 dB of the loudest part (v3 script),
  // whichever is higher; both move with the recording's own loudness.
  const floorDb = noiseFloorDb(db);
  const topDb = percentile(knownLevels(db), TOP_PCT);
  const onDb = Math.max(floorDb + ON_ABOVE_FLOOR_DB, topDb - BELOW_TOP_DB);
  const offDb = Math.max(floorDb + OFF_ABOVE_FLOOR_DB, onDb - HYSTERESIS_DB);
  Object.assign(detail, { floorDb, topDb, onDb, offDb });
  const s = TASK_SETTINGS[kind];
  const segments = detectVoice(db, { frameMs, onDb, offDb, minOnMs: s.minOnMs, minGapMs: s.minGapMs });
  // Voice that runs into the end of the recording, or was already going at its start, was
  // cut off, so the number is too low. The tip says which end.
  const cutAt = (seg) => (seg.end >= endS - 1e-9 ? 'cutOff' : seg.start <= 1e-9 ? 'cutOffStart' : null);
  let value = NaN;
  let short = null; // why the recording is too short, if it is

  if (kind === 'ddk' || kind === 'sbc') {
    const bursts = countBursts(db, { frameMs, minPeakDistMs: s.minPeakDistMs, prominenceDb: PROMINENCE_DB, minDb: onDb, smoothMs: s.smoothMs });
    const best = busiestRun(segments, bursts);
    const run = best ? best.run : null;
    if (kind === 'ddk') {
      const rate = run ? burstRate(bursts, { startS: run.start, endS: run.end }) : burstRate([]);
      if (rate.count >= s.minBursts) value = round(rate.perSecond, 2);
      if (run && rate.count < s.fewBursts) short = 'ddk';
      Object.assign(detail, { count: rate.count, spanS: rate.durationS, cvIntervalPct: rate.cvIntervalPct, bursts: best ? best.inside : [], run });
    } else {
      const cut = run ? cutAt(run) : null;
      if (run) value = best.inside.length;
      if (cut) short = cut;
      Object.assign(detail, { breathS: run ? run.end - run.start : NaN, counts: best ? best.inside : [], run, cutOff: !!cut });
    }
  } else if (kind === 'mpt') {
    const longest = longestSegment(segments);
    if (longest) value = round(longest.duration, 2);
    const cut = longest ? cutAt(longest) : null;
    if (cut) short = cut;
    Object.assign(detail, { longest, cutOff: !!cut, segments });
  } else {
    const p = pauseStats(segments, recordingS, { minPauseMs: MIN_PAUSE_MS });
    value = round(p.pausePct, 1);
    if (segments.length && p.spanS < s.minSpanS) short = 'reading';
    Object.assign(detail, { speechS: p.speechS, pauseS: p.pauseS, spanS: p.spanS, pauses: p.pauses, pauseCount: p.pauses.length, segments });
  }

  // Quality flags in plain words, each with what to do about it.
  const flags = [];
  const tips = [];
  const flag = (f, tip = QUALITY_TIPS[f]) => { flags.push(f); tips.push(tip); };
  if (!(topDb >= QUIET_DBFS)) flag('too quiet');
  if (clipped > 0 && clipped >= Math.max(3, CLIP_SHARE * n)) flag('clipped');
  if (!flags.includes('too quiet') && !(topDb - floorDb >= MIN_CONTRAST_DB)) flag('noisy background');
  if (short) flag('too short', SHORT_TIPS[short]);
  const ok = Number.isFinite(value);
  return { ok, kind, test: task.test, value, unit: task.unit, flags, tips, reason: ok ? '' : tips[0] || NOT_FOUND, detail };
}

// ---------- browser capture ----------
const RAW_AUDIO = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
const MAX_RECORD_S = 300;
const MODULE_WAIT_MS = 5000; // the capture module is a few lines from memory; more is a hang
const CANCELLED = 'The recording was cancelled.';
const BROWSER_HINT = 'Try a recent Chrome, Edge, Firefox or Safari.';
const STOP = Symbol('recording ended'); // what a wait gives back when the recording ended first

// A promise that gives up after `ms`, so a step that never answers cannot hang the recording.
function within(promise, ms) {
  let timer = null;
  const late = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Timed out')), ms); });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

// Copies the microphone's raw samples to the page in blocks of 2048.
const WORKLET_SOURCE = `
class RfnCapture extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(2048); this.n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        this.buf[this.n++] = ch[i];
        if (this.n === this.buf.length) {
          this.port.postMessage(this.buf, [this.buf.buffer]);
          this.buf = new Float32Array(2048);
          this.n = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('rfn-capture', RfnCapture);
`;

export function micSupport(env = globalThis) {
  const nav = env && env.navigator;
  if (!nav) return { ok: false, reason: 'Microphone tests need a web browser.' };
  if (env.isSecureContext === false) {
    return { ok: false, reason: 'The microphone only works on a secure page. Open the app from an https:// address or from localhost.' };
  }
  if (!nav.mediaDevices || typeof nav.mediaDevices.getUserMedia !== 'function') {
    return { ok: false, reason: `This browser cannot use the microphone. ${BROWSER_HINT}` };
  }
  // A page shown inside another site needs that site's permission to use the microphone.
  const policy = env.document && (env.document.permissionsPolicy || env.document.featurePolicy);
  if (policy && typeof policy.allowsFeature === 'function') {
    let allowed = true;
    try { allowed = policy.allowsFeature('microphone') !== false; } catch { allowed = true; }
    if (!allowed) {
      return { ok: false, reason: 'This page is not allowed to use the microphone, probably because it is shown inside another site. Open the app in its own tab.' };
    }
  }
  if (typeof (env.AudioContext || env.webkitAudioContext) !== 'function') {
    return { ok: false, reason: `This browser cannot process sound. ${BROWSER_HINT}` };
  }
  return { ok: true, reason: '' };
}

export function explainMicError(err) {
  const name = err && err.name;
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
    return 'Microphone access was blocked. Allow the microphone for this site in your browser settings (or open the app in its own tab), then try again.';
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError') {
    return 'No microphone was found. Connect one, or use a phone, then try again.';
  }
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') {
    return 'The microphone is busy or not working. Close other apps or tabs that use it, then try again.';
  }
  return 'The microphone could not start. Please try again.';
}

const tracksOf = (stream) => (stream && typeof stream.getTracks === 'function' ? stream.getTracks() : []);
function stopTracks(stream) {
  for (const t of tracksOf(stream)) { try { t.stop(); } catch { /* already stopped */ } }
}
const errName = (err) => (err && err.name) || 'Error';

function reportLevel(onLevel, chunk, elapsedS) {
  if (typeof onLevel !== 'function' || !chunk.length) return;
  let ss = 0;
  let peak = 0;
  for (let i = 0; i < chunk.length; i++) {
    const x = chunk[i];
    ss += x * x;
    if (Math.abs(x) > peak) peak = Math.abs(x);
  }
  const db = 20 * Math.log10(Math.max(Math.sqrt(ss / chunk.length), MIN_RMS));
  try {
    onLevel({ level: Math.min(1, Math.max(0, (db + 60) / 60)), db, peak, elapsedS });
  } catch { /* a broken meter must not stop the recording */ }
}

export async function recordAudio(options) {
  const o = optsOf(options);
  const env = o.env == null ? globalThis : o.env;
  const stream = o.stream || null;
  const { onStart, onLevel, abortSignal } = o;
  const secs = o.seconds == null ? 10 : num(o.seconds);
  const grace = o.graceMs == null ? 3000 : Math.max(0, num(o.graceMs) || 0);
  // A stream passed in is stopped on every way out, also when it was never used.
  if (!(secs > 0 && secs <= MAX_RECORD_S)) {
    stopTracks(stream);
    return { ok: false, reason: `The recording length must be more than 0 and at most ${MAX_RECORD_S} seconds.` };
  }
  if (abortSignal && abortSignal.aborted) {
    stopTracks(stream);
    return { ok: false, reason: CANCELLED, aborted: true };
  }
  const passedIn = !!stream;
  if (!passedIn) {
    const support = micSupport(env);
    if (!support.ok) return { ok: false, reason: support.reason };
  }
  const Ctx = env && (env.AudioContext || env.webkitAudioContext);
  if (typeof Ctx !== 'function') {
    stopTracks(stream);
    return { ok: false, reason: `This browser cannot process sound. ${BROWSER_HINT}` };
  }

  let ctx = null;
  let used = stream;
  let blobUrl = null;
  let timer = null;
  const nodes = [];
  const listeners = [];
  const chunks = [];
  let total = 0;
  // The recording ends once, at the first of: enough sound, a cancel, a lost microphone or
  // the time limit. Every wait below also gives way to that end, so Cancel works at once,
  // even during the permission question or while the sound engine starts.
  let finished = false;
  let settle;
  const done = new Promise((r) => { settle = r; });
  const end = (result) => { if (!finished) { finished = true; settle(result); } };
  const orEnd = (promise) => Promise.race([promise, done.then(() => STOP)]);
  const onAbort = () => end({ ok: false, reason: CANCELLED, aborted: true });
  const lost = () => end({ ok: false, reason: 'The microphone stopped during the recording. Check that it is connected, then try again.' });
  let outcome;
  try {
    if (abortSignal && typeof abortSignal.addEventListener === 'function') abortSignal.addEventListener('abort', onAbort, { once: true });
    // Made before asking for the microphone, while the tap on Start still counts as the
    // user's gesture; some browsers otherwise keep the sound engine paused.
    ctx = new Ctx();
    if (ctx.state === 'suspended' && typeof ctx.resume === 'function') Promise.resolve(ctx.resume()).catch(() => {});
    if (!passedIn) {
      let asking = null;
      let got;
      try {
        asking = Promise.resolve(env.navigator.mediaDevices.getUserMedia({ audio: RAW_AUDIO }));
        got = await orEnd(asking);
      } catch (err) {
        return { ok: false, reason: explainMicError(err), error: errName(err) };
      }
      if (got === STOP) {
        asking.then(stopTracks, () => {}); // a microphone granted after the cancel is released too
        return await done;
      }
      used = got;
    }
    if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
      const woke = await orEnd(within(Promise.resolve(ctx.resume()), 2000).catch(() => {}));
      if (woke === STOP) return await done;
      if (ctx.state === 'suspended') return { ok: false, reason: 'The browser kept sound paused. Tap Start again.' };
    }

    const target = Math.max(1, Math.round(secs * ctx.sampleRate));
    const giveUp = () => end(total
      ? { ok: false, reason: 'The recording stopped early. Please try again.' }
      : { ok: false, reason: 'The microphone did not send any sound. Check that it is not muted, then try again.' });
    const push = (data) => {
      if (finished || !data || !data.length) return;
      if (total === 0) {
        // Time the recording from its first sound, so a microphone that is slow to start
        // still gets the full length.
        clearTimeout(timer);
        timer = setTimeout(giveUp, secs * 1000 + grace);
        if (typeof onStart === 'function') {
          try { onStart(); } catch { /* the page's problem, not the recording's */ }
        }
      }
      const take = Math.min(data.length, target - total);
      const piece = take === data.length ? data : data.subarray(0, take);
      chunks.push(piece);
      total += take;
      reportLevel(onLevel, piece, total / ctx.sampleRate);
      if (total >= target) end({ ok: true });
    };

    const source = ctx.createMediaStreamSource(used);
    nodes.push(source);
    const sink = ctx.createGain(); // silent output: the graph must reach the speakers to run
    sink.gain.value = 0;
    nodes.push(sink);
    sink.connect(ctx.destination);

    // Raw samples from an AudioWorklet loaded from a Blob URL; a strict page policy can
    // block that, and old browsers lack it, so fall back to ScriptProcessorNode.
    let capture = null;
    if (ctx.audioWorklet && typeof ctx.audioWorklet.addModule === 'function' && typeof env.AudioWorkletNode === 'function'
      && typeof env.Blob === 'function' && env.URL && typeof env.URL.createObjectURL === 'function') {
      try {
        blobUrl = env.URL.createObjectURL(new env.Blob([WORKLET_SOURCE], { type: 'text/javascript' }));
        if (await orEnd(within(ctx.audioWorklet.addModule(blobUrl), MODULE_WAIT_MS)) === STOP) return await done;
        capture = new env.AudioWorkletNode(ctx, 'rfn-capture', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
        capture.port.onmessage = (e) => push(e.data);
      } catch {
        capture = null;
      }
    }
    if (!capture && typeof ctx.createScriptProcessor === 'function') {
      capture = ctx.createScriptProcessor(4096, 1, 1);
      capture.onaudioprocess = (e) => push(e.inputBuffer.getChannelData(0).slice());
    }
    if (!capture) return { ok: false, reason: `This browser cannot record raw sound. ${BROWSER_HINT}` };
    nodes.push(capture);

    // Stop if the microphone goes away (also before we got here), or if no sound arrives.
    for (const t of tracksOf(used)) {
      if (t && t.readyState === 'ended') lost();
      if (!t || typeof t.addEventListener !== 'function') continue;
      t.addEventListener('ended', lost);
      listeners.push(t);
    }
    timer = setTimeout(giveUp, secs * 1000 + grace);

    if (!finished) {
      source.connect(capture);
      capture.connect(sink);
    }
    outcome = await done;
  } catch (err) {
    outcome = { ok: false, reason: 'The recording could not run in this browser. Please try again.', error: errName(err) };
  } finally {
    finished = true; // nothing that arrives from now on is kept
    clearTimeout(timer);
    if (abortSignal && typeof abortSignal.removeEventListener === 'function') {
      try { abortSignal.removeEventListener('abort', onAbort); } catch { /* ignore */ }
    }
    for (const t of listeners) { try { t.removeEventListener('ended', lost); } catch { /* ignore */ } }
    for (const node of nodes) {
      try { node.disconnect(); } catch { /* not connected */ }
      if (node.port) node.port.onmessage = null;
      if ('onaudioprocess' in node) node.onaudioprocess = null;
    }
    stopTracks(used);
    if (ctx && typeof ctx.close === 'function') { try { Promise.resolve(ctx.close()).catch(() => {}); } catch { /* closed */ } }
    if (blobUrl) { try { env.URL.revokeObjectURL(blobUrl); } catch { /* ignore */ } }
  }

  const samples = new Float32Array(total);
  let offset = 0;
  for (const c of chunks) { samples.set(c, offset); offset += c.length; }
  const sampleRate = ctx ? ctx.sampleRate : NaN;
  if (outcome.ok) return { ok: true, samples, sampleRate, seconds: total / sampleRate };
  return { ...outcome, samples, sampleRate, seconds: total / sampleRate };
}
