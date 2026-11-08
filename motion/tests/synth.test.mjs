// Tests for motion/web/synth.js. Run: node --test "motion/tests/*.test.mjs" (from the project folder).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { synthWalk } from '../web/synth.js';

const G = 9.80665;
const mag = (s) => Math.hypot(s.ax, s.ay, s.az);
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;

test('recording has the contract section 2 shape', () => {
  const rec = synthWalk();
  assert.equal(rec.v, 1);
  assert.equal(rec.kind, 'rfn-walk-recording');
  assert.match(rec.id, /^[A-Za-z0-9_-]{6,64}$/);
  assert.ok(!Number.isNaN(Date.parse(rec.createdAt)));
  assert.equal(typeof rec.device.ua, 'string');
  assert.equal(rec.distance_m, 10);
  assert.ok(['waist', 'pocket', 'hand'].includes(rec.placement));
  assert.equal(rec.stopBy, 'tap');
  assert.equal(rec.simulated, true);
  for (const k of ['onsetT', 'endT', 'steps', 'duration_s', 'speed_mps']) assert.ok(Number.isFinite(rec.truth[k]), k);
  for (const s of rec.samples) {
    for (const k of ['t', 'ax', 'ay', 'az', 'gx', 'gy', 'gz', 'lx', 'ly', 'lz']) assert.ok(Number.isFinite(s[k]), k);
  }
  assert.match(synthWalk({ seed: -3 }).id, /^[A-Za-z0-9_-]{6,64}$/);
});

test('timeline: countdown, reaction, walk, stop tap', () => {
  const rec = synthWalk();
  const { truth } = rec;
  const t0 = rec.samples[0].t;
  assert.ok(Math.abs(rec.goT - t0 - 3000) < 1e-6, 'standBefore_s 3');
  assert.ok(Math.abs(truth.onsetT - rec.goT - 600) < 1e-6, 'reaction_s 0.6');
  assert.ok(Math.abs(rec.stopT - truth.endT - 400) < 1e-3, 'tapDelay_s 0.4');
  assert.equal(truth.steps, 14);
  assert.ok(Math.abs(truth.duration_s - (truth.endT - truth.onsetT) / 1000) < 1e-3);
  assert.ok(Math.abs(truth.duration_s - 14 * 60 / 110) / (14 * 60 / 110) < 0.05, 'about steps x 60 / cadence');
  assert.ok(Math.abs(truth.speed_mps - 10 / truth.duration_s) < 1e-9);
  const last = rec.samples[rec.samples.length - 1].t;
  assert.ok(last - truth.endT >= 1900, 'standAfter_s 2');
});

test('sample clock: increasing, about rateHz, with jitter', () => {
  for (const rateHz of [30, 60, 100]) {
    const rec = synthWalk({ rateHz, jitterMs: 5 });
    const dts = [];
    for (let i = 1; i < rec.samples.length; i++) {
      const dt = rec.samples[i].t - rec.samples[i - 1].t;
      assert.ok(dt > 0, 'strictly increasing');
      dts.push(dt);
    }
    dts.sort((a, b) => a - b);
    const med = dts[Math.floor(dts.length / 2)];
    assert.ok(Math.abs(1000 / med - rateHz) / rateHz < 0.1, `${rateHz} Hz, median dt ${med}`);
    assert.ok(dts[dts.length - 1] - dts[0] > 2, 'jitter present');
  }
});

test('deterministic for the same options; seed changes the samples', () => {
  assert.deepEqual(synthWalk({ seed: 5, turn_deg: 20, gapAt_s: 5 }), synthWalk({ seed: 5, turn_deg: 20, gapAt_s: 5 }));
  const a = synthWalk({ seed: 1 }), b = synthWalk({ seed: 2 });
  assert.notDeepEqual(a.samples.slice(0, 5), b.samples.slice(0, 5));
});

test('still before the walk and after it; gravity magnitude near g', () => {
  const rec = synthWalk({ noise: 0 });
  const { onsetT, endT } = rec.truth;
  const before = rec.samples.filter((s) => s.t < onsetT);
  const after = rec.samples.filter((s) => s.t >= endT);
  for (const s of [...before, ...after]) {
    assert.ok(Math.abs(mag(s) - G) < 1e-3);
    assert.ok(Math.hypot(s.lx, s.ly, s.lz) < 1e-3);
    assert.ok(Math.hypot(s.gx, s.gy, s.gz) < 1e-3);
  }
  const during = rec.samples.filter((s) => s.t > onsetT + 100 && s.t < endT - 100);
  const peak = Math.max(...during.map((s) => mag(s) - G));
  assert.ok(peak > 1.5 && peak < 3.5, `heel-strike peak ${peak}`);
  assert.ok(Math.abs(mean(during.map((s) => mag(s))) - G) < 0.3, 'walking motion averages out');
});

test('orientation and the iPhone-style sign', () => {
  const restOf = (rec) => rec.samples.filter((s) => s.t < rec.goT);
  const up = restOf(synthWalk({ orientation: 'upright' }));
  assert.ok(Math.abs(mean(up.map((s) => s.ay)) - G) < 0.05, 'upright: +g on y');
  const flat = restOf(synthWalk({ orientation: 'flat' }));
  assert.ok(Math.abs(mean(flat.map((s) => s.az)) - G) < 0.05, 'flat: +g on z');
  const neg = restOf(synthWalk({ orientation: 'upright', gravitySign: -1 }));
  assert.ok(Math.abs(mean(neg.map((s) => s.ay)) + G) < 0.05, 'gravitySign -1: -g on y');
  const custom = restOf(synthWalk({ orientation: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] }));
  assert.ok(Math.abs(mean(custom.map((s) => s.az)) - G) < 0.05, 'identity matrix: +g on z');
  // Random orientations differ by seed but keep |a| near g at rest.
  const r1 = restOf(synthWalk({ seed: 1 })), r2 = restOf(synthWalk({ seed: 2 }));
  assert.ok(Math.abs(mean(r1.map((s) => s.ax)) - mean(r2.map((s) => s.ax))) > 0.1);
  assert.ok(Math.abs(mean(r1.map(mag)) - G) < 0.05);
});

test('withGyro false gives null gyroscope values', () => {
  const rec = synthWalk({ withGyro: false });
  assert.ok(rec.samples.every((s) => s.gx === null && s.gy === null && s.gz === null));
  assert.ok(rec.samples.every((s) => Number.isFinite(s.ax) && Number.isFinite(s.lx)));
});

test('a dropout leaves no samples for gap_ms', () => {
  const rec = synthWalk({ gapAt_s: 6 });
  const g0 = rec.samples[0].t + 6000;
  assert.equal(rec.samples.filter((s) => s.t >= g0 && s.t < g0 + 400).length, 0);
  let maxDt = 0;
  for (let i = 1; i < rec.samples.length; i++) maxDt = Math.max(maxDt, rec.samples[i].t - rec.samples[i - 1].t);
  assert.ok(maxDt >= 390 && maxDt < 450, `max dt ${maxDt}`);
});

test('turn_deg integrates to the requested turn about the vertical axis', () => {
  const rec = synthWalk({ orientation: 'upright', turn_deg: 90, noise: 0 });
  // Upright: phone y is the body's vertical axis, so heading change = integral of gy.
  let sum = 0;
  for (let i = 1; i < rec.samples.length; i++) {
    const a = rec.samples[i - 1], b = rec.samples[i];
    sum += 0.5 * (a.gy + b.gy) * (b.t - a.t) / 1000;
  }
  assert.ok(Math.abs(sum - 90) < 8, `turn ${sum}`);
});

test('stop options and bad options do not throw', () => {
  assert.equal(synthWalk({ stopBy: null }).stopT, null);
  const auto = synthWalk({ stopBy: 'auto' });
  assert.ok(auto.stopT > auto.truth.endT);
  const late = synthWalk({ tapDelay_s: 3 });
  assert.ok(Math.abs(late.stopT - late.truth.endT - 3000) < 1e-3);
  assert.ok(late.samples[late.samples.length - 1].t >= late.stopT);
  assert.doesNotThrow(() => synthWalk(null));
  assert.doesNotThrow(() => synthWalk({ rateHz: 'fast', steps: -4, orientation: 'sideways', noise: NaN }));
  assert.equal(synthWalk({ distance_m: null }).truth.speed_mps, null);
});
