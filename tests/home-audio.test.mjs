// Microphone timing tools, checked on made-up recordings whose answers are known by how
// they were built (tone bursts, a held tone, phrases with pauses, counting), not on the
// code's own output. Everything is at 16 kHz with low-level background noise unless a
// test says otherwise.
// Run: node --test "tests/home-audio.test.mjs"
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  frameRms, toDb, noiseFloorDb, detectVoice, longestSegment, countBursts, burstRate,
  pauseStats, analyzeTask, AUDIO_TASKS, QUALITY_TIPS, micSupport, recordAudio, explainMicError,
} from '../app/js/home/audio.js';

const SR = 16000;
const close = (a, b, tol, what = '') =>
  assert.ok(Math.abs(a - b) <= tol, `${what} ${a} vs ${b} (allowed difference ${tol})`);

// ---------- made-up recordings ----------
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// parts: ['quiet', seconds] or ['tone', seconds, amplitude, hz]. Background noise
// (uniform, peak `noise`) runs under everything, like a real room.
function build(parts, { sr = SR, noise = 0.001, seed = 7 } = {}) {
  const total = parts.reduce((s, p) => s + Math.round(p[1] * sr), 0);
  const x = new Float64Array(total);
  const rnd = mulberry32(seed);
  let i = 0;
  for (const [kind, sec, amp = 0.3, hz = 220] of parts) {
    const n = Math.round(sec * sr);
    for (let k = 0; k < n; k++, i++) {
      x[i] = noise * (2 * rnd() - 1) + (kind === 'tone' ? amp * Math.sin((2 * Math.PI * hz * k) / sr) : 0);
    }
  }
  return x;
}
const asF32 = (x, scale = 1) => Float32Array.from(x, (v) => v * scale);

// 12 tone bursts of 60 ms with 120 ms gaps: one every 180 ms, so 1 / 0.18 = 5.56 per second.
function burstTrain({ count = 12, onS = 0.06, offS = 0.12, amp = 0.3 } = {}) {
  const parts = [['quiet', 0.5]];
  for (let k = 0; k < count; k++) parts.push(['tone', onS, amp], ['quiet', offS]);
  parts.push(['quiet', 0.5]);
  return parts;
}
const HELD = [['quiet', 0.5], ['tone', 7.5, 0.3], ['quiet', 0.5]];

// Three phrases of five syllables (150 ms sound, 50 ms gap inside a word or phrase),
// separated by two 600 ms pauses. Speech runs from 0.5 s to 4.55 s: 3 x 0.95 + 2 x 0.6 = 4.05 s,
// of which 1.2 s is pausing: 1.2 / 4.05 = 29.63%.
const SYLL_AMPS = [0.3, 0.12, 0.25, 0.08, 0.2];
function phrase() {
  const parts = [];
  SYLL_AMPS.forEach((a, k) => {
    parts.push(['tone', 0.15, a, 180 + 20 * k]);
    if (k < SYLL_AMPS.length - 1) parts.push(['quiet', 0.05]);
  });
  return parts;
}
const READING = [['quiet', 0.5], ...phrase(), ['quiet', 0.6], ...phrase(), ['quiet', 0.6], ...phrase(), ['quiet', 0.5]];
const READING_PCT = (1.2 / 4.05) * 100;

// Counting at the usual 2 numbers per second: 15 numbers on the first breath (every third one
// has two syllables, like "se-ven"), a 1.24 s breath, then 4 more numbers.
function counting() {
  const parts = [['quiet', 0.5]];
  const number = (k) => (k % 3 === 2
    ? [['tone', 0.11, 0.3, 200], ['quiet', 0.04], ['tone', 0.11, 0.25, 230], ['quiet', 0.24]]
    : [['tone', 0.25, 0.3, 210], ['quiet', 0.25]]);
  for (let k = 0; k < 15; k++) parts.push(...number(k));
  parts.push(['quiet', 1.0]);
  for (let k = 0; k < 4; k++) parts.push(...number(k));
  parts.push(['quiet', 0.5]);
  return parts;
}

// ---------- frame levels ----------
test('frameRms: one RMS value per 10 ms frame, and a partial last frame is dropped', () => {
  const x = new Float32Array(330).fill(0.5); // 2 full frames of 160 samples + 10 spare
  const r = frameRms(x, SR);
  assert.equal(r.length, 2);
  close(r[0], 0.5, 1e-7);
  const alt = Float32Array.from({ length: 160 }, (_, i) => (i % 2 ? 1 : -1));
  close(frameRms(alt, SR)[0], 1, 1e-12);
  assert.equal(frameRms(new Float32Array(640), SR, 20).length, 2, '20 ms frames are 320 samples');
  assert.equal(frameRms(new Float32Array(441 * 3), 44100).length, 3, '44.1 kHz frames are 441 samples');
});

test('frameRms: bad samples count as silence; bad inputs give an empty result, not an error', () => {
  const x = new Float32Array(160).fill(0.5);
  x[0] = NaN;
  x[1] = Infinity;
  close(frameRms(x, SR)[0], Math.sqrt((158 * 0.25) / 160), 1e-7);
  assert.equal(frameRms(new Float32Array(0), SR).length, 0);
  assert.equal(frameRms(new Float32Array(100), SR).length, 0, 'shorter than one frame');
  assert.equal(frameRms(null, SR).length, 0);
  assert.equal(frameRms('abc', SR).length, 0);
  assert.equal(frameRms(new Float32Array(320), 0).length, 0);
  assert.equal(frameRms(new Float32Array(320), NaN).length, 0);
  assert.equal(frameRms(new Float32Array(320), SR, -10).length, 0);
  assert.deepEqual(Array.from(frameRms([0.5, 0.5, 0.5, 0.5], 1000, 2)), [0.5, 0.5], 'plain arrays work');
});

test('toDb: 20 log10, with digital silence at a finite floor', () => {
  const d = toDb([1, 0.1, 0.01, 0, NaN, -1, null]);
  close(d[0], 0, 1e-12);
  close(d[1], -20, 1e-9);
  close(d[2], -40, 1e-9);
  assert.equal(d[3], -120, 'digital silence sits at -120 dB, not -Infinity');
  assert.ok(Number.isNaN(d[4]) && Number.isNaN(d[5]) && Number.isNaN(d[6]), 'NaN, negative and missing stay unknown');
  assert.equal(toDb([]).length, 0);
  assert.equal(toDb(undefined).length, 0);
});

test('noiseFloorDb: a low percentile, so loud frames do not raise it', () => {
  const db = [...Array(90).fill(-60), ...Array(10).fill(-20)];
  close(noiseFloorDb(db), -60, 1e-9);
  // even with speech in 80% of frames the floor stays at the quiet frames
  close(noiseFloorDb([...Array(20).fill(-62), ...Array(80).fill(-15)]), -62, 1e-9);
  // exact zeros between sounds (a synthetic stream, or a phone that gates silence) are the
  // background, even when most frames are voice
  close(noiseFloorDb([...Array(30).fill(-120), ...Array(70).fill(-15)]), -120, 1e-9);
  close(noiseFloorDb([...Array(10).fill(-Infinity), ...Array(90).fill(-15)]), -120, 1e-9);
  assert.ok(Number.isNaN(noiseFloorDb([])));
  assert.ok(Number.isNaN(noiseFloorDb([NaN, NaN])));
  close(noiseFloorDb([NaN, -50, NaN]), -50, 1e-9);
  assert.ok(noiseFloorDb([-120, -120]) <= -100, 'all digital silence: the floor itself');
});

// ---------- voice segments ----------
const dbRun = (...pieces) => pieces.flatMap(([db, frames]) => Array(frames).fill(db));

test('detectVoice: segments in seconds, from 10 ms frames', () => {
  const db = dbRun([-60, 10], [-20, 20], [-60, 10]);
  assert.deepEqual(detectVoice(db, { frameMs: 10 }), [{ start: 0.1, end: 0.3 }]);
  assert.deepEqual(detectVoice(dbRun([-60, 10], [-20, 20]), { frameMs: 10 }), [{ start: 0.1, end: 0.3 }], 'voice up to the end');
  assert.deepEqual(detectVoice([], {}), []);
  assert.deepEqual(detectVoice(null), []);
});

test('detectVoice: hysteresis keeps a dip between the two thresholds inside the segment', () => {
  // on at -30, off below -40: a dip to -35 does not end the segment, a drop to -50 does
  const db = dbRun([-60, 10], [-20, 10], [-35, 5], [-20, 10], [-50, 10], [-20, 10], [-60, 10]);
  const segs = detectVoice(db, { frameMs: 10, onDb: -30, offDb: -40, minGapMs: 0, minOnMs: 0 });
  assert.deepEqual(segs, [{ start: 0.1, end: 0.35 }, { start: 0.45, end: 0.55 }]);
  // a quiet stretch between off and on never starts a segment
  assert.deepEqual(detectVoice(dbRun([-60, 10], [-35, 30], [-60, 10]), { onDb: -30, offDb: -40 }), []);
});

test('detectVoice: short gaps are joined and short blips dropped', () => {
  const db = dbRun([-60, 10], [-20, 10], [-60, 5], [-20, 10], [-60, 20], [-20, 2], [-60, 20]);
  // 50 ms gap joined (minGap 100 ms); the 20 ms blip is dropped (minOn 50 ms)
  assert.deepEqual(detectVoice(db, { frameMs: 10, minGapMs: 100, minOnMs: 50 }), [{ start: 0.1, end: 0.35 }]);
  // with no joining, the gap splits it in two
  assert.equal(detectVoice(db, { frameMs: 10, minGapMs: 0, minOnMs: 50 }).length, 2);
});

test('detectVoice: default thresholds follow the background, so a louder copy gives the same segments', () => {
  const db = dbRun([-70, 15], [-40, 30], [-70, 15], [-45, 20], [-70, 15]);
  const louder = db.map((v) => v + 40);
  const a = detectVoice(db, { frameMs: 10 });
  assert.equal(a.length, 2);
  assert.deepEqual(detectVoice(louder, { frameMs: 10 }), a);
  // NaN frames count as silence
  const holed = db.slice();
  holed[30] = NaN;
  assert.equal(detectVoice(holed, { frameMs: 10, minGapMs: 0, minOnMs: 0 }).length, 3);
});

test('longestSegment: the longest, with its duration; none gives null', () => {
  assert.equal(longestSegment([]), null);
  assert.equal(longestSegment(null), null);
  const s = longestSegment([{ start: 0, end: 1 }, { start: 2, end: 4.5 }, { start: 5, end: 6 }]);
  assert.deepEqual(s, { start: 2, end: 4.5, duration: 2.5 });
  assert.deepEqual(longestSegment([{ start: 0, end: 1 }, { start: 3, end: 4 }]).start, 0, 'ties: the first');
  assert.equal(longestSegment([{ start: 'x', end: 2 }]), null, 'malformed rows are skipped');
});

// ---------- bursts ----------
test('countBursts: peaks with a dip of at least 2 dB on both sides; ripples are not syllables', () => {
  // three 60 ms humps 200 ms apart over a -60 dB background
  const db = dbRun([-60, 20], [-20, 6], [-60, 14], [-20, 6], [-60, 14], [-20, 6], [-60, 20]);
  const peaks = countBursts(db, { frameMs: 10 });
  assert.equal(peaks.length, 3);
  close(peaks[1].t - peaks[0].t, 0.2, 0.011);
  // two humps with only a 1 dB dip between them are one syllable (distance rule off, so
  // only the dip decides)
  const only = { frameMs: 10, smoothMs: 10, minPeakDistMs: 0 };
  const ripple = dbRun([-60, 20], [-20, 6], [-21, 3], [-20, 6], [-60, 20]);
  assert.equal(countBursts(ripple, only).length, 1);
  // with a 6 dB dip they are two
  const dipped = dbRun([-60, 20], [-20, 6], [-26, 3], [-20, 6], [-60, 20]);
  assert.equal(countBursts(dipped, only).length, 2);
  // a ripple on the shoulder of a big syllable, with only a 0.5 dB dip between them, does
  // not hide the syllable (a peak's dip is measured down to the nearest higher peak)
  const shoulder = dbRun([-60, 20], [-20, 6], [-20.5, 2], [-20.2, 2], [-60, 20]);
  assert.equal(countBursts(shoulder, only).length, 1);
  // with no dip needed at all, a shoulder is timed at its own top (frames 2-3), not across
  // the higher peak beside it (frame 4), which would put both at the same moment
  const bumps = countBursts([-60, -60, -20.5, -20.6, -20, -60, -60, -60], { frameMs: 10, smoothMs: 0, minPeakDistMs: 0, prominenceDb: 0 });
  assert.deepEqual(bumps.map((p) => p.db), [-20.5, -20]);
  close(bumps[0].t, 0.03, 1e-9);
  assert.ok(bumps[1].t > bumps[0].t);
});

test('countBursts: peaks closer than minPeakDistMs count once', () => {
  const db = dbRun([-60, 20], [-20, 4], [-60, 4], [-22, 4], [-60, 20]); // peaks 80 ms apart
  assert.equal(countBursts(db, { frameMs: 10, smoothMs: 10, minPeakDistMs: 50 }).length, 2);
  assert.equal(countBursts(db, { frameMs: 10, smoothMs: 10, minPeakDistMs: 100 }).length, 1);
  assert.deepEqual(countBursts([], {}), []);
  assert.deepEqual(countBursts([-20, -20], {}), []);
  assert.deepEqual(countBursts(dbRun([-60, 50]), {}), [], 'a steady background has no bursts');
});

test('countBursts: of two peaks too close together the louder one is kept, wherever it is', () => {
  const only = { frameMs: 10, smoothMs: 10, minPeakDistMs: 100 };
  // humps at frames 20-23 and 28-31, centred at 0.22 s and 0.30 s: 80 ms apart
  const laterLouder = countBursts(dbRun([-60, 20], [-22, 4], [-60, 4], [-20, 4], [-60, 20]), only);
  assert.equal(laterLouder.length, 1);
  close(laterLouder[0].t, 0.3, 1e-9);
  const earlierLouder = countBursts(dbRun([-60, 20], [-20, 4], [-60, 4], [-22, 4], [-60, 20]), only);
  assert.equal(earlierLouder.length, 1);
  close(earlierLouder[0].t, 0.22, 1e-9);
  // quiet, loud, quiet, 60 ms apart: the loud middle one wins, so both quiet ones go, even
  // though the two quiet ones are 120 ms from each other (a first-come rule would keep them)
  const chain = countBursts(dbRun([-60, 20], [-24, 2], [-60, 4], [-20, 2], [-60, 4], [-24, 2], [-60, 20]), only);
  assert.deepEqual(chain.map((p) => p.db), [-20]);
  close(chain[0].t, 0.27, 1e-9);
});

test('countBursts: three hours of syllables are counted in seconds, not half a minute', () => {
  // 3 hours of 10 ms frames, a syllable every 120 ms at varying loudness: 90,000 peaks.
  // Comparing each peak with every peak already kept took 37 s on the build laptop; filing
  // them by time took 0.8 s. The 10 s bound is loose, so a slow or busy machine still passes.
  const rnd = mulberry32(11);
  const db = new Float64Array(3 * 360000);
  let lv = -20;
  for (let f = 0; f < db.length; f++) {
    if (f % 12 === 0) lv = -18 - 6 * rnd();
    db[f] = f % 12 < 6 ? lv : -60;
  }
  const t0 = performance.now();
  const peaks = countBursts(db, { frameMs: 10 });
  const ms = performance.now() - t0;
  assert.equal(peaks.length, 89999, 'every syllable but the first, which has no rise before it');
  assert.ok(ms < 10000, `took ${Math.round(ms)} ms`);
});

test('burstRate: rate from the gaps between bursts, plus their regularity', () => {
  const even = burstRate([0, 0.2, 0.4, 0.6].map((t) => ({ t })));
  assert.equal(even.count, 4);
  close(even.durationS, 0.6, 1e-12);
  close(even.perSecond, 5, 1e-9); // 3 gaps in 0.6 s
  close(even.cvIntervalPct, 0, 1e-9);
  // gaps 0.1 and 0.2: mean 0.15, sample SD 0.0707, CV 47.14%
  close(burstRate([{ t: 0 }, { t: 0.1 }, { t: 0.3 }]).cvIntervalPct, (Math.SQRT1_2 * 0.1 / 0.15) * 100, 1e-9);
  // only bursts inside the window count
  const w = burstRate([0, 1, 1.2, 1.4, 3].map((t) => ({ t })), { startS: 0.5, endS: 2 });
  assert.equal(w.count, 3);
  close(w.perSecond, 5, 1e-9);
  const one = burstRate([{ t: 1 }]);
  assert.equal(one.count, 1);
  assert.ok(Number.isNaN(one.perSecond) && Number.isNaN(one.cvIntervalPct), 'one burst has no rate');
  assert.equal(burstRate([]).count, 0);
  assert.equal(burstRate(null).count, 0);
  assert.equal(burstRate([{ t: NaN }, { t: 'x' }, null, { t: 2 }]).count, 1, 'malformed peaks are skipped');
  assert.ok(Number.isNaN(burstRate([{ t: 0 }, { t: 0.5 }]).cvIntervalPct), 'one gap has no spread');
});

// ---------- pauses ----------
test('pauseStats: pauses are gaps of 300 ms or more between speech; % of the reading time', () => {
  const segs = [{ start: 0, end: 1 }, { start: 1.6, end: 2.6 }, { start: 3.2, end: 4 }];
  const p = pauseStats(segs, 5);
  assert.equal(p.pauses.length, 2);
  close(p.pauseS, 1.2, 1e-9);
  close(p.speechS, 2.8, 1e-9);
  close(p.pausePct, 30, 1e-9);
  assert.deepEqual(p.pauses[0], { start: 1, end: 1.6 });
  // a 200 ms gap is part of speech, not a pause
  const q = pauseStats([{ start: 0, end: 1 }, { start: 1.2, end: 2 }], 3);
  assert.equal(q.pauses.length, 0);
  close(q.speechS, 2, 1e-9);
  close(q.pausePct, 0, 1e-9);
  // silence before the first word and after the last is not reading time
  close(pauseStats([{ start: 4, end: 6 }], 20).pausePct, 0, 1e-9);
  // the threshold can be changed
  assert.equal(pauseStats([{ start: 0, end: 1 }, { start: 1.2, end: 2 }], 3, { minPauseMs: 150 }).pauses.length, 1);
});

test('pauseStats: empty, unsorted, overlapping and malformed input', () => {
  const e = pauseStats([], 10);
  assert.equal(e.pauses.length, 0);
  assert.ok(Number.isNaN(e.pausePct));
  assert.ok(Number.isNaN(pauseStats(null, 10).pausePct));
  const p = pauseStats([{ start: 2, end: 3 }, null, { start: 'a', end: 1 }, { start: 0, end: 1 }, { start: 0.5, end: 1.2 }], 3);
  assert.equal(p.pauses.length, 1);
  close(p.pauseS, 0.8, 1e-9);
  close(p.pausePct, (0.8 / 3) * 100, 1e-9);
  // segments past the end of the recording are cut at its end
  close(pauseStats([{ start: 0, end: 1 }, { start: 2, end: 9 }], 3).speechS, 2, 1e-9);
});

test('options left out, null or not numbers take their defaults; null is never read as 0', () => {
  const peaks = [0, 0.2, 0.4, 0.6].map((t) => ({ t }));
  assert.equal(burstRate(peaks, { startS: null, endS: null }).count, 4, 'a null window edge is open, not 0 s');
  assert.equal(burstRate(peaks, null).count, 4);
  const db = dbRun([-70, 15], [-40, 30], [-70, 15], [-45, 20], [-70, 15]);
  const base = detectVoice(db, { frameMs: 10 });
  assert.equal(base.length, 2);
  assert.deepEqual(detectVoice(db, null), base);
  assert.deepEqual(detectVoice(db, { frameMs: null, onDb: null, offDb: null, minOnMs: null, minGapMs: null }), base,
    'null thresholds follow the background instead of meaning 0 dB');
  const humps = dbRun([-60, 20], [-20, 6], [-60, 14], [-20, 6], [-60, 14], [-20, 6], [-60, 20]);
  assert.equal(countBursts(humps, null).length, 3);
  assert.equal(countBursts(humps, { frameMs: null, minDb: null, prominenceDb: null, smoothMs: null, minPeakDistMs: null }).length, 3,
    'a null loudness floor is not 0 dB');
  const gap200 = [{ start: 0, end: 1 }, { start: 1.2, end: 2 }];
  assert.equal(pauseStats(gap200, 3, { minPauseMs: null }).pauses.length, 0, 'a null pause length is the 300 ms default');
  assert.equal(pauseStats(gap200, 3, null).pauses.length, 0);
  assert.ok(Number.isNaN(toDb([''])[0]), 'an empty value is unknown, not digital silence');
  close(noiseFloorDb([-60, -50, -40], null), noiseFloorDb([-60, -50, -40]), 1e-12);
  assert.equal(frameRms(new Float32Array(320), SR, null).length, 2, 'a null frame length is 10 ms');
});

test('rows with a missing time are skipped, not read as 0 s', () => {
  assert.equal(longestSegment([null]), null);
  assert.equal(longestSegment([{ start: null, end: 5 }]), null);
  assert.deepEqual(longestSegment([{ start: null, end: 5 }, { start: 1, end: 2 }]), { start: 1, end: 2, duration: 1 });
  const p = pauseStats([{ start: null, end: 1 }, { start: 2, end: 3 }], 4);
  assert.equal(p.spanS, 1);
  assert.equal(p.pauses.length, 0);
  assert.equal(burstRate([{ t: null }, { t: 1 }, { t: 1.2 }]).count, 2);
});

// ---------- the four tasks ----------
test('task vocabulary: each kind maps to the shared test id and unit', () => {
  assert.deepEqual(
    Object.fromEntries(Object.entries(AUDIO_TASKS).map(([k, v]) => [k, [v.test, v.unit]])),
    { ddk: ['ddk_rate', 'syllables/s'], mpt: ['mpt', 's'], sbc: ['single_breath_count', 'count'], reading: ['pause_pct', '%'] },
  );
});

test('pa-ta-ka: 12 tone bursts of 60 ms with 120 ms gaps give 12 bursts and about 5.6 per second', () => {
  const r = analyzeTask('ddk', asF32(build(burstTrain())), SR);
  assert.equal(r.ok, true);
  assert.equal(r.test, 'ddk_rate');
  assert.equal(r.unit, 'syllables/s');
  assert.equal(r.detail.count, 12);
  // a 10 ms frame of error at each end moves 11 / 1.98 s by under 0.06 per second
  close(r.value, 1 / 0.18, 0.1, 'rate');
  assert.ok(r.detail.cvIntervalPct < 10, `evenly spaced bursts are regular: ${r.detail.cvIntervalPct}`);
  assert.deepEqual(r.flags, []);
  // the same signal through the building blocks
  const db = toDb(frameRms(asF32(build(burstTrain())), SR));
  const peaks = countBursts(db, { frameMs: 10 });
  assert.equal(peaks.length, 12);
  close(burstRate(peaks).perSecond, 1 / 0.18, 0.1);
});

test('pa-ta-ka: a slower, louder or quieter train still counts every burst', () => {
  const slow = analyzeTask('ddk', asF32(build(burstTrain({ count: 8, onS: 0.15, offS: 0.25 }))), SR);
  assert.equal(slow.detail.count, 8);
  close(slow.value, 1 / 0.4, 0.05);
  // long, flat-topped syllables are timed at their middle (to one 10 ms frame), not wherever
  // the noise put the loudest frame, so an even train does not look irregular
  slow.detail.bursts.forEach((b, k) => close(b.t, 0.5 + 0.4 * k + 0.075, 0.011, `syllable ${k + 1} time`));
  const few = analyzeTask('ddk', asF32(build(burstTrain({ count: 3 }))), SR);
  assert.ok(few.flags.includes('too short'), 'three syllables are too few to trust');
  const none = analyzeTask('ddk', asF32(build(burstTrain({ count: 2 }))), SR);
  assert.ok(Number.isNaN(none.value) && none.ok === false && none.reason.length > 0);
});

test('pa-ta-ka: a word said before starting is left out', () => {
  // "okay" (one 250 ms burst), 0.7 s of quiet, then the 12-burst train
  const parts = [['quiet', 0.5], ['tone', 0.25, 0.3], ['quiet', 0.7], ...burstTrain().slice(1)];
  const r = analyzeTask('ddk', asF32(build(parts)), SR);
  assert.equal(r.detail.count, 12);
  close(r.value, 1 / 0.18, 0.1, 'rate');
});

test('pa-ta-ka: exact digital silence between bursts (a synthetic stream) still counts every burst', () => {
  // whole cycles of 250 Hz, so the bursts have no offset and the gaps stay exact zeros
  const x = new Float32Array(Math.round(3.16 * SR));
  for (let k = 0; k < 12; k++) {
    const s = Math.round((0.5 + 0.18 * k) * SR);
    for (let i = 0; i < 0.06 * SR; i++) x[s + i] = 0.3 * Math.sin((2 * Math.PI * 250 * i) / SR);
  }
  const r = analyzeTask('ddk', x, SR);
  assert.equal(r.detail.count, 12);
  close(r.value, 1 / 0.18, 0.1, 'rate');
  assert.deepEqual(r.flags, []);
  // a held tone between exact zeros, as a demo stream would give
  const held = new Float32Array(Math.round(8.5 * SR));
  for (let i = 0; i < 7.5 * SR; i++) held[Math.round(0.5 * SR) + i] = 0.3 * Math.sin((2 * Math.PI * 250 * i) / SR);
  close(analyzeTask('mpt', held, SR).value, 7.5, 0.1, 'MPT');
});

test('a constant offset from the microphone does not hide the voice', () => {
  const x = Float32Array.from(build(HELD), (v) => v + 0.2);
  const r = analyzeTask('mpt', x, SR);
  close(r.value, 7.5, 0.1, 'MPT with a 0.2 offset');
  assert.deepEqual(r.flags, []);
});

test('maximum phonation time: a 7.5 s held tone measures within 0.1 s of 7.5', () => {
  const x = asF32(build(HELD));
  const r = analyzeTask('mpt', x, SR);
  assert.equal(r.ok, true);
  assert.equal(r.test, 'mpt');
  assert.equal(r.unit, 's');
  close(r.value, 7.5, 0.1, 'MPT');
  assert.deepEqual(r.flags, []);
  const longest = longestSegment(detectVoice(toDb(frameRms(x, SR)), { frameMs: 10 }));
  close(longest.duration, 7.5, 0.1, 'longest segment');
});

test('maximum phonation time: other sample rates keep time', () => {
  for (const sr of [8000, 44100, 48000]) {
    close(analyzeTask('mpt', asF32(build(HELD, { sr })), sr).value, 7.5, 0.1, `${sr} Hz`);
  }
  // 11,025 Hz does not give a whole number of samples per 10 ms; a long hold shows any drift
  // (0.23% of 40 s is 0.09 s, more than the two 10 ms frame edges allow)
  const long = [['quiet', 1.5], ['tone', 40, 0.3], ['quiet', 1.5]];
  close(analyzeTask('mpt', asF32(build(long, { sr: 11025 })), 11025).value, 40, 0.05, '11025 Hz');
});

test('maximum phonation time: a long hold that fills almost the whole recording still measures', () => {
  // 25 s of voice and only 0.5 s of quiet at each end: under 4% of the recording is quiet
  const r = analyzeTask('mpt', asF32(build([['quiet', 0.5], ['tone', 25, 0.3], ['quiet', 0.5]])), SR);
  close(r.value, 25, 0.1, 'MPT');
  assert.deepEqual(r.flags, []);
});

test('maximum phonation time: a voice break under 150 ms is joined; a longer gap ends the hold', () => {
  const broken = analyzeTask('mpt', asF32(build([['quiet', 0.5], ['tone', 4, 0.3], ['quiet', 0.1], ['tone', 3.4, 0.3], ['quiet', 0.5]])), SR);
  close(broken.value, 7.5, 0.1, 'joined across a 100 ms break');
  const breath = analyzeTask('mpt', asF32(build([['quiet', 0.5], ['tone', 4, 0.3], ['quiet', 0.4], ['tone', 3, 0.3], ['quiet', 0.5]])), SR);
  close(breath.value, 4, 0.1, 'a 400 ms gap ends the hold');
});

test('reading: under 3 s of speech is flagged "too short"', () => {
  const parts = [['quiet', 0.5], ...phrase(), ['quiet', 0.6], ...phrase(), ['quiet', 0.5]]; // 2.5 s of reading
  const r = analyzeTask('reading', asF32(build(parts)), SR);
  assert.ok(r.flags.includes('too short'), `${r.flags}`);
  assert.equal(r.detail.pauses.length, 1);
});

test('maximum phonation time: a voice still going when the recording ends is flagged', () => {
  const r = analyzeTask('mpt', asF32(build([['quiet', 0.5], ['tone', 6, 0.3]])), SR);
  assert.ok(r.flags.includes('too short'), 'the recording stopped before the voice did');
  assert.equal(r.detail.cutOff, true);
  const ok = analyzeTask('mpt', asF32(build(HELD)), SR);
  assert.equal(ok.detail.cutOff, false);
  assert.match(r.tips[r.flags.indexOf('too short')], /ended while you were still going/i);
});

test('maximum phonation time: a voice already going when the recording starts gets its own tip', () => {
  const r = analyzeTask('mpt', asF32(build([['tone', 6, 0.3], ['quiet', 0.5]])), SR);
  assert.equal(r.detail.cutOff, true);
  const k = r.flags.indexOf('too short');
  assert.ok(k >= 0, `${r.flags}`);
  assert.match(r.tips[k], /already started/i, 'not "the recording ended while you were still going"');
  // counting that had already begun is flagged the same way
  const sbc = analyzeTask('sbc', asF32(build([...counting().slice(1, 31), ['quiet', 0.5]])), SR);
  assert.equal(sbc.detail.cutOff, true);
  assert.match(sbc.tips[sbc.flags.indexOf('too short')], /already started/i);
});

test('reading: two 600 ms pauses between phrases give two pauses and the right percentage', () => {
  const r = analyzeTask('reading', asF32(build(READING)), SR);
  assert.equal(r.ok, true);
  assert.equal(r.test, 'pause_pct');
  assert.equal(r.unit, '%');
  assert.equal(r.detail.pauses.length, 2, '50 ms gaps inside phrases are not pauses');
  for (const p of r.detail.pauses) close(p.end - p.start, 0.6, 0.021, 'pause length');
  // each of 4 pause edges may be off by one 10 ms frame: under 1 percentage point
  close(r.value, READING_PCT, 1, 'pause %');
  assert.deepEqual(r.flags, []);
});

test('single-breath count: counts the numbers said on the first breath', () => {
  const r = analyzeTask('sbc', asF32(build(counting())), SR);
  assert.equal(r.ok, true);
  assert.equal(r.test, 'single_breath_count');
  assert.equal(r.unit, 'count');
  assert.equal(r.value, 15, 'two-syllable numbers count once; the 4 after the breath do not count');
  close(r.detail.breathS, 7.26, 0.05, 'from the first number to the end of the 15th');
  assert.deepEqual(r.flags, []);
});

// ---------- quality flags ----------
test('silence: every task says "too quiet" and gives no number', () => {
  const quiet = asF32(build([['quiet', 3]]));
  const zeros = new Float32Array(3 * SR);
  for (const kind of Object.keys(AUDIO_TASKS)) {
    for (const [name, x] of [['background only', quiet], ['digital silence', zeros]]) {
      const r = analyzeTask(kind, x, SR);
      assert.ok(r.flags.includes('too quiet'), `${kind}, ${name}: ${r.flags}`);
      assert.ok(!r.flags.includes('noisy background'), `${kind}, ${name}: silence is not noise`);
      assert.equal(r.ok, false);
      assert.ok(Number.isNaN(r.value));
      assert.equal(r.reason, QUALITY_TIPS['too quiet']);
    }
  }
});

test('full-scale clipping is flagged "clipped" and the timing still works', () => {
  const x = Float32Array.from(build(burstTrain({ amp: 3 })), (v) => Math.max(-1, Math.min(1, v)));
  const r = analyzeTask('ddk', x, SR);
  assert.ok(r.flags.includes('clipped'), `${r.flags}`);
  assert.equal(r.detail.count, 12);
  assert.ok(!analyzeTask('ddk', asF32(build(burstTrain())), SR).flags.includes('clipped'));
});

test('a voice barely above loud background noise is flagged "noisy background"', () => {
  const r = analyzeTask('mpt', asF32(build(HELD, { noise: 0.15 })), SR);
  assert.ok(r.flags.includes('noisy background'), `${r.flags}`);
  assert.ok(!r.flags.includes('too quiet'));
  const loudRoom = analyzeTask('ddk', asF32(build([['quiet', 3]], { noise: 0.2 })), SR);
  assert.deepEqual(loudRoom.flags, ['noisy background'], 'noise and no voice: the noise is the problem');
});

test('loudness does not change the results: the same recording at 0.1x and 0.9x', () => {
  const recordings = { ddk: burstTrain(), mpt: HELD, sbc: counting(), reading: READING };
  for (const [kind, parts] of Object.entries(recordings)) {
    const base = build(parts);
    const soft = analyzeTask(kind, asF32(base, 0.1), SR);
    const loud = analyzeTask(kind, asF32(base, 0.9), SR);
    assert.equal(soft.ok, true, kind);
    assert.equal(soft.value, loud.value, `${kind} value`);
    assert.deepEqual(soft.flags, loud.flags, `${kind} flags`);
    if (kind === 'ddk') assert.deepEqual(soft.detail.bursts.map((b) => b.t), loud.detail.bursts.map((b) => b.t));
    if (kind === 'reading') assert.deepEqual(soft.detail.pauses, loud.detail.pauses);
  }
});

test('analyzeTask: bad input gives ok:false with a reason, never an error', () => {
  const x = asF32(build(HELD));
  for (const [kind, samples, sr] of [
    ['hum', x, SR], ['toString', x, SR], [undefined, x, SR],
    ['mpt', null, SR], ['mpt', new Float32Array(0), SR], ['mpt', 'abc', SR],
    ['mpt', x, 0], ['mpt', x, NaN], ['mpt', x, -16000],
  ]) {
    const r = analyzeTask(kind, samples, sr);
    assert.equal(r.ok, false, `${kind} ${sr}`);
    assert.ok(typeof r.reason === 'string' && r.reason.length > 0);
    assert.ok(Array.isArray(r.flags));
  }
  const tiny = analyzeTask('mpt', new Float32Array(50), SR);
  assert.equal(tiny.ok, false);
  assert.ok(tiny.flags.includes('too short'));
  // plain arrays and NaN samples are fine
  const arr = Array.from(build(HELD));
  arr[1000] = NaN;
  close(analyzeTask('mpt', arr, SR).value, 7.5, 0.1);
  // every flag has a plain-words tip
  for (const f of ['too quiet', 'clipped', 'noisy background', 'too short']) assert.ok(QUALITY_TIPS[f].length > 20, f);
});

// ---------- browser capture, with a fake browser ----------
function fakeStream() {
  const track = { stopped: false, kind: 'audio', stop() { this.stopped = true; }, addEventListener() {}, removeEventListener() {} };
  return { track, getTracks: () => [track], getAudioTracks: () => [track] };
}

// A fake Web Audio: the capture node feeds a 440 Hz tone at 0.1 in blocks every `everyMs`.
// Slow steps can be made slower: the permission answer (gumDelayMs), loading the capture
// module (moduleDelayMs), a paused sound engine waking up (suspended, resumeDelayMs) and the
// first sound after connecting (startDelayMs).
function fakeBrowser({
  worklet = false, workletFails = false, gum, silent = false, everyMs = 2, sampleRate = 8000,
  gumDelayMs = 0, moduleDelayMs = 0, suspended = false, resumeDelayMs = 0, startDelayMs = 0,
} = {}) {
  const log = { contexts: [], streams: [], urls: [], revoked: [], scriptNodes: 0, workletNodes: 0, gumCalls: 0 };
  const block = (n, offset) => Float32Array.from({ length: n }, (_, i) => 0.1 * Math.sin((2 * Math.PI * 440 * (offset + i)) / sampleRate));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const feeder = (deliver, size) => {
    let sent = 0;
    let delay = null;
    let timer = null;
    return {
      start() {
        if (silent) return;
        delay = setTimeout(() => { timer = setInterval(() => { deliver(block(size, sent)); sent += size; }, everyMs); }, startDelayMs);
      },
      stop() { clearTimeout(delay); clearInterval(timer); },
    };
  };
  const plain = () => ({ connect() {}, disconnect() {} });
  class FakeContext {
    constructor() {
      this.sampleRate = sampleRate;
      this.state = suspended ? 'suspended' : 'running';
      this.closed = false;
      this.destination = {};
      if (worklet) {
        this.audioWorklet = {
          addModule: async (url) => { await wait(moduleDelayMs); if (workletFails) throw new Error('blocked by policy'); this.module = url; },
        };
      }
      log.contexts.push(this);
    }
    createMediaStreamSource(stream) { this.stream = stream; return plain(); }
    createGain() { return { gain: { value: 1 }, ...plain() }; }
    createScriptProcessor(size) {
      log.scriptNodes++;
      const node = { onaudioprocess: null };
      const f = feeder((d) => node.onaudioprocess && node.onaudioprocess({ inputBuffer: { getChannelData: () => d } }), size);
      node.connect = () => f.start();
      node.disconnect = () => f.stop();
      return node;
    }
    async resume() { await wait(resumeDelayMs); if (!this.closed) this.state = 'running'; }
    close() { this.closed = true; this.state = 'closed'; return Promise.resolve(); }
  }
  class FakeWorkletNode {
    constructor(ctx, name) {
      log.workletNodes++;
      this.name = name;
      this.port = { onmessage: null };
      const f = feeder((d) => this.port.onmessage && this.port.onmessage({ data: d }), 2048);
      this.connect = () => f.start();
      this.disconnect = () => f.stop();
    }
  }
  const env = {
    isSecureContext: true,
    navigator: {
      mediaDevices: {
        getUserMedia: gum || (async (constraints) => {
          log.gumCalls++;
          log.constraints = constraints;
          await wait(gumDelayMs);
          const s = fakeStream();
          log.streams.push(s);
          return s;
        }),
      },
    },
    AudioContext: FakeContext,
    AudioWorkletNode: worklet ? FakeWorkletNode : undefined,
    Blob,
    URL: { createObjectURL: (b) => { log.urls.push(b); return `blob:fake-${log.urls.length}`; }, revokeObjectURL: (u) => log.revoked.push(u) },
  };
  return { env, log };
}

test('micSupport: says why the microphone cannot be used', () => {
  const ok = fakeBrowser().env;
  assert.deepEqual(micSupport(ok), { ok: true, reason: '' });
  const cases = [
    [{}, /browser/i],
    [{ ...ok, isSecureContext: false }, /secure|https/i],
    [{ ...ok, navigator: {} }, /cannot use the microphone/i],
    [{ ...ok, navigator: { mediaDevices: {} } }, /cannot use the microphone/i],
    [{ ...ok, document: { permissionsPolicy: { allowsFeature: (f) => f !== 'microphone' } } }, /not allowed|own tab/i],
    [{ ...ok, document: { featurePolicy: { allowsFeature: () => false } } }, /not allowed|own tab/i],
    [{ ...ok, AudioContext: undefined }, /sound/i],
  ];
  for (const [env, why] of cases) {
    const r = micSupport(env);
    assert.equal(r.ok, false);
    assert.match(r.reason, why);
  }
  assert.equal(micSupport().ok, false, 'Node has no microphone');
  assert.equal(micSupport({ ...ok, AudioContext: undefined, webkitAudioContext: ok.AudioContext }).ok, true, 'older Safari');
});

test('recordAudio: records the asked length with raw-audio settings, reports the level, and stops the microphone', async () => {
  const { env, log } = fakeBrowser();
  const levels = [];
  const events = [];
  const r = await recordAudio({
    seconds: 1, env, onStart: () => events.push('start'), onLevel: (l) => { levels.push(l); events.push('level'); },
  });
  assert.equal(r.ok, true, r.reason);
  assert.equal(events.filter((e) => e === 'start').length, 1, 'onStart fires once');
  assert.equal(events[0], 'start', 'onStart fires when the first sound arrives, before any level');
  assert.equal(r.sampleRate, 8000);
  assert.equal(r.samples.length, 8000);
  assert.ok(r.samples instanceof Float32Array);
  assert.deepEqual(log.constraints, { audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  assert.equal(log.streams[0].track.stopped, true, 'microphone released');
  assert.equal(log.contexts[0].closed, true);
  assert.ok(levels.length > 0);
  for (const l of levels) assert.ok(l.level >= 0 && l.level <= 1 && Number.isFinite(l.db) && l.elapsedS > 0);
  close(levels[0].peak, 0.1, 0.01, 'peak of the fake tone');
});

test('recordAudio: uses an AudioWorklet from a Blob URL when it can, and falls back when it cannot', async () => {
  const w = fakeBrowser({ worklet: true });
  const r = await recordAudio({ seconds: 0.5, env: w.env });
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.samples.length, 4000);
  assert.equal(w.log.workletNodes, 1);
  assert.equal(w.log.scriptNodes, 0);
  assert.match(w.log.contexts[0].module, /^blob:/);
  assert.deepEqual(w.log.revoked, [w.log.contexts[0].module], 'the Blob URL is released');
  assert.match(await w.log.urls[0].text(), /registerProcessor/);

  const f = fakeBrowser({ worklet: true, workletFails: true });
  const r2 = await recordAudio({ seconds: 0.5, env: f.env });
  assert.equal(r2.ok, true, r2.reason);
  assert.equal(f.log.scriptNodes, 1, 'fell back to ScriptProcessorNode');
  assert.equal(f.log.revoked.length, 1);
});

test('recordAudio: a refused permission gives a plain reason and leaves nothing running', async () => {
  const refuse = async () => { const e = new Error('Permission denied'); e.name = 'NotAllowedError'; throw e; };
  const { env, log } = fakeBrowser({ gum: refuse });
  const r = await recordAudio({ seconds: 1, env });
  assert.equal(r.ok, false);
  assert.match(r.reason, /allow/i);
  assert.equal(r.error, 'NotAllowedError');
  for (const c of log.contexts) assert.equal(c.closed, true);
  const none = await recordAudio({ seconds: 1, env: { ...env, navigator: {} } });
  assert.equal(none.ok, false);
  assert.match(none.reason, /microphone/i);
});

test('recordAudio: cancelling stops the microphone and returns what was recorded', async () => {
  const { env, log } = fakeBrowser({ everyMs: 20 });
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 60);
  const t0 = Date.now();
  const r = await recordAudio({ seconds: 5, env, abortSignal: ac.signal });
  assert.equal(r.ok, false);
  assert.equal(r.aborted, true);
  assert.match(r.reason, /cancel|stopped/i);
  assert.ok(Date.now() - t0 < 2000, 'did not wait for the full 5 s');
  assert.equal(log.streams[0].track.stopped, true);
  assert.equal(log.contexts[0].closed, true);
  assert.ok(r.samples.length > 0 && r.samples.length < 5 * 8000);

  const pre = new AbortController();
  pre.abort();
  const fresh = fakeBrowser();
  const r2 = await recordAudio({ seconds: 1, env: fresh.env, abortSignal: pre.signal });
  assert.equal(r2.ok, false);
  assert.equal(fresh.log.gumCalls, 0, 'never asked for the microphone');
});

test('recordAudio: a passed-in stream is used instead of asking, and its tracks are stopped', async () => {
  const { env, log } = fakeBrowser();
  const stream = fakeStream();
  const r = await recordAudio({ seconds: 0.25, env, stream });
  assert.equal(r.ok, true, r.reason);
  assert.equal(log.gumCalls, 0);
  assert.equal(log.contexts[0].stream, stream);
  assert.equal(stream.track.stopped, true);
});

test('recordAudio: bad lengths, a broken level meter and a silent microphone', async () => {
  for (const seconds of [0, -1, NaN, 'ten', 100000]) {
    const r = await recordAudio({ seconds, env: fakeBrowser().env });
    assert.equal(r.ok, false, String(seconds));
    assert.ok(r.reason.length > 0);
  }
  const meter = fakeBrowser();
  const r = await recordAudio({ seconds: 0.5, env: meter.env, onLevel: () => { throw new Error('meter broke'); } });
  assert.equal(r.ok, true, 'a broken meter does not stop the recording');
  const mute = fakeBrowser({ silent: true });
  const r2 = await recordAudio({ seconds: 0.1, env: mute.env, graceMs: 100 });
  assert.equal(r2.ok, false);
  assert.match(r2.reason, /did not send any sound/i);
  assert.equal(mute.log.streams[0].track.stopped, true);
  assert.equal(mute.log.contexts[0].closed, true);
});

test('recordAudio: Cancel works during the permission question and while the sound engine starts', async () => {
  // Cancel at 30 ms while the browser still asks for permission; the answer comes at 300 ms
  const asking = fakeBrowser({ gumDelayMs: 300 });
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 30);
  const t0 = Date.now();
  const r = await recordAudio({ seconds: 2, env: asking.env, abortSignal: ac.signal });
  assert.equal(r.ok, false);
  assert.equal(r.aborted, true);
  assert.ok(Date.now() - t0 < 250, 'did not wait for the permission answer');
  await new Promise((res) => setTimeout(res, 400));
  assert.equal(asking.log.streams[0].track.stopped, true, 'a microphone granted after the cancel is released');
  assert.equal(asking.log.contexts[0].closed, true);
  // Cancel at 30 ms while the capture module loads, or while a paused sound engine wakes
  // up (300 ms each): the cancel came before recording began, and must not be lost
  for (const slow of [{ worklet: true, moduleDelayMs: 300 }, { suspended: true, resumeDelayMs: 300 }]) {
    const { env, log } = fakeBrowser(slow);
    const stop = new AbortController();
    setTimeout(() => stop.abort(), 30);
    const t1 = Date.now();
    const res = await recordAudio({ seconds: 2, env, abortSignal: stop.signal });
    const name = Object.keys(slow).join(' ');
    assert.equal(res.ok, false, name);
    assert.equal(res.aborted, true, name);
    assert.ok(Date.now() - t1 < 250, `${name}: answered at once, without waiting for that step`);
    assert.equal(log.streams[0].track.stopped, true, name);
    assert.equal(log.contexts[0].closed, true, name);
  }
});

test('recordAudio: a passed-in stream is stopped even when the recording never starts', async () => {
  const { env } = fakeBrowser();
  for (const [why, extra] of [['bad length', { seconds: 0 }], ['already cancelled', { seconds: 1, abortSignal: AbortSignal.abort() }]]) {
    const stream = fakeStream();
    const r = await recordAudio({ ...extra, env, stream });
    assert.equal(r.ok, false, why);
    assert.equal(stream.track.stopped, true, why);
  }
});

test('recordAudio: a microphone that is slow to start still records the full length', async () => {
  // Blocks of 2048 samples at 8 kHz every 256 ms, as in real time, the first at about 650 ms.
  // A limit of 0.5 s + 0.3 s counted from the call would cut this off at 800 ms with one block.
  const { env } = fakeBrowser({ worklet: true, everyMs: 256, startDelayMs: 400 });
  const r = await recordAudio({ seconds: 0.5, env, graceMs: 300 });
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.samples.length, 4000);
});

test('recordAudio: called with null or nothing, it answers in plain words instead of throwing', async () => {
  for (const arg of [null, undefined, 'x']) {
    const r = await recordAudio(arg); // Node has no microphone
    assert.equal(r.ok, false);
    assert.match(r.reason, /microphone|browser/i);
  }
  const { env } = fakeBrowser();
  const r = await recordAudio({ seconds: 0.25, env, graceMs: null, onStart: null, onLevel: null, abortSignal: null, stream: null });
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.samples.length, 2000);
});

test('explainMicError: browser error names become plain words', () => {
  const named = (name) => Object.assign(new Error('x'), { name });
  assert.match(explainMicError(named('NotAllowedError')), /allow/i);
  assert.match(explainMicError(named('SecurityError')), /allow/i);
  assert.match(explainMicError(named('NotFoundError')), /no microphone/i);
  assert.match(explainMicError(named('OverconstrainedError')), /no microphone/i);
  assert.match(explainMicError(named('NotReadableError')), /busy/i);
  assert.match(explainMicError(named('Whatever')), /could not start/i);
  assert.match(explainMicError(undefined), /could not start/i);
});
