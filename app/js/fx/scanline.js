// Scanline objects for the "How it works" cards: a small 3D object drawn as horizontal
// lines whose brightness follows the shading (the reference's look), on plain Canvas 2D.
//
// How it works: each object is a cloud of surface samples (position, normal, material,
// one scalar parameter) built once per canvas size. Every frame the cloud is rotated
// (slow sway + eased mouse tilt + a scroll parallax), projected into a coarse grid
// (rows of rowPx by columns of colPx) with a depth buffer, shaded (diffuse, a soft
// highlight and a rim), and every grid row is drawn as runs of thin rectangles: one
// fill per brightness level and colour. A point-sample rasteriser instead of a ray
// march: the same picture at a fraction of the cost (about 10-25k samples a frame), so a
// card stays well inside the 4 ms frame budget. No allocations in the per-frame loops.
// The look is the reference's fine holographic scan: every line has the same weight (one
// device-snapped CSS pixel at an even ~3 px pitch) and only its alpha carries the shading.
// Brightness is smoothed along each row before it is cut into a few levels, so a row
// stays one long line instead of breaking into short bars.
//
// Colours: --panel-ink lines; --panel-flag for the highlighted parts (red flags, the
// pulse); --panel-accent for the one interactive element (the referral line).
// Decorative only: callers put aria-hidden="true" on the canvas and say it in text.
import { createEffect, palette, rgba, rng } from './core.js';

const STRIDE = 8; // x y z nx ny nz mat param
const LEVELS = 6;
const TINTS = 3; // 0 ink, 1 flag, 2 accent
const EMPTY = 1e9;

// ---------- build-time vector helpers (allocation is fine here) ----------
const v3 = (x, y, z) => ({ x, y, z });
const vadd = (a, b) => v3(a.x + b.x, a.y + b.y, a.z + b.z);
const vsub = (a, b) => v3(a.x - b.x, a.y - b.y, a.z - b.z);
const vscl = (a, s) => v3(a.x * s, a.y * s, a.z * s);
const vlen = (a) => Math.hypot(a.x, a.y, a.z);
const vnorm = (a) => { const l = vlen(a) || 1; return v3(a.x / l, a.y / l, a.z / l); };
const vcross = (a, b) => v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);

class Cloud {
  constructor() { this.d = new Float32Array(12000 * STRIDE); this.n = 0; }
  reset() { this.n = 0; }
  add(x, y, z, nx, ny, nz, mat, prm) {
    if ((this.n + 1) * STRIDE > this.d.length) { const nd = new Float32Array(this.d.length * 2); nd.set(this.d); this.d = nd; }
    const o = this.n * STRIDE;
    const d = this.d;
    d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = nx; d[o + 4] = ny; d[o + 5] = nz; d[o + 6] = mat; d[o + 7] = prm;
    this.n += 1;
  }
}

// A flat rectangle with rounded corners: centre c, in-plane unit axes u (across) and
// v (up), normal n, size w x h, corner radius r. matAt(a, b) gives the material for the
// local coordinates (or -1 to leave a hole); prmAt(a, b) the parameter.
function sheet(C, hs, c, u, v, n, w, h, r, matAt, prmAt) {
  const nu = Math.max(2, Math.ceil(w / hs));
  const nv = Math.max(2, Math.ceil(h / hs));
  for (let i = 0; i < nu; i += 1) {
    const a = -w / 2 + ((i + 0.5) * w) / nu;
    for (let j = 0; j < nv; j += 1) {
      const b = -h / 2 + ((j + 0.5) * h) / nv;
      if (r > 0) {
        const qa = Math.abs(a) - (w / 2 - r);
        const qb = Math.abs(b) - (h / 2 - r);
        if (qa > 0 && qb > 0 && qa * qa + qb * qb > r * r) continue;
      }
      const m = matAt ? matAt(a, b) : 0;
      if (m < 0) continue;
      C.add(c.x + u.x * a + v.x * b, c.y + u.y * a + v.y * b, c.z + u.z * a + v.z * b, n.x, n.y, n.z, m, prmAt ? prmAt(a, b) : 0);
    }
  }
}

// Axis-aligned box from its six faces.
function box(C, hs, c, hx, hy, hz, mat, prm = 0, skipBottom = true) {
  const m = () => mat;
  const p = () => prm;
  sheet(C, hs, v3(c.x + hx, c.y, c.z), v3(0, 0, 1), v3(0, 1, 0), v3(1, 0, 0), 2 * hz, 2 * hy, 0, m, p);
  sheet(C, hs, v3(c.x - hx, c.y, c.z), v3(0, 0, 1), v3(0, 1, 0), v3(-1, 0, 0), 2 * hz, 2 * hy, 0, m, p);
  sheet(C, hs, v3(c.x, c.y + hy, c.z), v3(1, 0, 0), v3(0, 0, 1), v3(0, 1, 0), 2 * hx, 2 * hz, 0, m, p);
  if (!skipBottom) sheet(C, hs, v3(c.x, c.y - hy, c.z), v3(1, 0, 0), v3(0, 0, 1), v3(0, -1, 0), 2 * hx, 2 * hz, 0, m, p);
  sheet(C, hs, v3(c.x, c.y, c.z + hz), v3(1, 0, 0), v3(0, 1, 0), v3(0, 0, 1), 2 * hx, 2 * hy, 0, m, p);
  sheet(C, hs, v3(c.x, c.y, c.z - hz), v3(1, 0, 0), v3(0, 1, 0), v3(0, 0, -1), 2 * hx, 2 * hy, 0, m, p);
}

// Ellipsoid (a sphere when the radii match) from an even Fibonacci lattice.
function ellipsoid(C, hs, c, rx, ry, rz, mat, prmAt, matAt) {
  const pp = 1.6;
  const area = 4 * Math.PI * Math.pow((Math.pow(rx * ry, pp) + Math.pow(rx * rz, pp) + Math.pow(ry * rz, pp)) / 3, 1 / pp);
  const N = Math.max(16, Math.ceil(area / (hs * hs)));
  const ga = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < N; i += 1) {
    const y = 1 - ((i + 0.5) * 2) / N;
    const rr = Math.sqrt(Math.max(0, 1 - y * y));
    const th = ga * i;
    const x = Math.cos(th) * rr;
    const z = Math.sin(th) * rr;
    const px = x * rx; const py = y * ry; const pz = z * rz;
    let nx = x / rx; let ny = y / ry; let nz = z / rz;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    const m = matAt ? matAt(px, py, pz) : mat;
    C.add(c.x + px, c.y + py, c.z + pz, nx, ny, nz, m, prmAt ? prmAt(px, py, pz) : 0);
  }
}

// A tube along a polyline, radius r0 -> r1 and parameter p0 -> p1 along its length,
// with round caps.
function tube(C, hs, pts, r0, r1, mat, p0 = 0, p1 = 0, caps = true) {
  const L = [0];
  for (let i = 1; i < pts.length; i += 1) L.push(L[i - 1] + vlen(vsub(pts[i], pts[i - 1])));
  const total = L[L.length - 1] || 1e-6;
  const rings = Math.max(2, Math.ceil(total / (hs * 0.9)));
  for (let k = 0; k <= rings; k += 1) {
    const s = (k / rings) * total;
    let i = 1;
    while (i < pts.length - 1 && L[i] < s) i += 1;
    const a = pts[i - 1]; const b = pts[i];
    const f = (s - L[i - 1]) / ((L[i] - L[i - 1]) || 1e-6);
    const p = vadd(a, vscl(vsub(b, a), f));
    const T = vnorm(vsub(b, a));
    const ref = Math.abs(T.y) < 0.9 ? v3(0, 1, 0) : v3(1, 0, 0);
    const N = vnorm(vcross(T, ref));
    const B = vcross(T, N);
    const r = r0 + (r1 - r0) * (s / total);
    const M = Math.max(6, Math.ceil((2 * Math.PI * r) / (hs * 0.9)));
    const prm = p0 + (p1 - p0) * (s / total);
    for (let m = 0; m < M; m += 1) {
      const ang = (m / M) * Math.PI * 2 + (k % 2) * (Math.PI / M);
      const ca = Math.cos(ang); const sa = Math.sin(ang);
      const nx = N.x * ca + B.x * sa; const ny = N.y * ca + B.y * sa; const nz = N.z * ca + B.z * sa;
      C.add(p.x + nx * r, p.y + ny * r, p.z + nz * r, nx, ny, nz, mat, prm);
    }
  }
  if (caps) {
    ellipsoid(C, hs, pts[0], r0, r0, r0, mat, () => p0);
    ellipsoid(C, hs, pts[pts.length - 1], r1, r1, r1, mat, () => p1);
  }
}

// A height field y = fy(x, z) over a rectangle; normals from central differences.
function field(C, hs, x0, x1, z0, z1, fy, matAt, prmAt) {
  const nx = Math.ceil((x1 - x0) / hs);
  const nz = Math.ceil((z1 - z0) / hs);
  const e = hs * 0.5;
  for (let i = 0; i <= nx; i += 1) {
    const x = x0 + ((x1 - x0) * i) / nx;
    for (let j = 0; j <= nz; j += 1) {
      const z = z0 + ((z1 - z0) * j) / nz;
      const y = fy(x, z);
      const dx = (fy(x + e, z) - fy(x - e, z)) / (2 * e);
      const dz = (fy(x, z + e) - fy(x, z - e)) / (2 * e);
      const l = Math.hypot(dx, 1, dz);
      C.add(x, y, z, -dx / l, 1 / l, -dz / l, matAt(x, z, y), prmAt ? prmAt(x, z, y) : x);
    }
  }
}

// ---------- the four scenes ----------
// A scene: { extent: [w, h] in object units, pivot: [x, y, z], view, mats, rebuild: [param
// keys that change the geometry], build(C, hs, P), frame?(R, t, P, still) }.
// view: base yaw / pitch (pitch < 0 looks down), sway amplitudes, sway speed, and how far
// the mouse tilts it.

// 01 Read every visit: one note sheet with a heading and six lines of text; the quoted
// sentences are marked, the selected red flag in --panel-flag, and a reading sweep runs
// down the page. One sheet, so its outline reads at card size.
function notesScene() {
  const PAPER = 0; const TEXT = 1; const MARK = 2; const MARK_ON = 3; const EDGE = 4;
  const W = 1.5; const H = 1.94; const R = 0.1; const RIM = 0.035;
  const LINES = 6; const TOP = 0.4; const STEP = 0.2; const BAND = 0.075; const MX = 0.2;
  return {
    extent: [1.8, 2.12],
    pivot: [0, 0, 0],
    view: { yaw: -0.64, pitch: -0.2, swayYaw: 0.15, swayPitch: 0.05, speed: 0.45, tiltYaw: 0.36, tiltPitch: 0.22 },
    mats: [
      { gain: 0.7, tint: 0, two: 1 },
      { gain: 0.16, tint: 0, two: 1 },
      { gain: 1.3, tint: 0, two: 1 },
      { gain: 1.3, tint: 1, two: 1 },
      { gain: 1.2, tint: 0, two: 1 },
    ],
    rebuild: ['marks'],
    build(C, hs, P) {
      const rnd = rng(11);
      const lens = [];
      for (let i = 0; i < LINES; i += 1) lens.push(i === LINES - 1 ? 0.42 + 0.2 * rnd() : 0.8 + 0.2 * rnd());
      const mark = new Int8Array(LINES).fill(-1);
      for (const m of P.marks || []) {
        const a = Math.max(0, Math.min(LINES - 1, Math.floor(m.from * LINES)));
        const b = Math.max(a, Math.min(LINES - 1, Math.floor(m.to * LINES)));
        for (let i = a; i <= b; i += 1) mark[i] = Math.max(mark[i], m.on ? 1 : 0);
      }
      const tw = W - 2 * MX;
      const rz = -0.03;
      const c = Math.cos(rz); const sn = Math.sin(rz);
      sheet(C, hs, v3(0, 0, 0), v3(c, sn, 0), v3(-sn, c, 0), v3(0, 0, -1), W, H, R, (a, b) => {
        const tx = a + W / 2 - MX;
        if (Math.abs(a) > W / 2 - RIM || Math.abs(b) > H / 2 - RIM) return EDGE;
        if (b > 0.64 && b < 0.64 + 0.1 && tx > 0 && tx < tw * 0.42) return TEXT;
        const li = Math.round((TOP - b) / STEP);
        if (li >= 0 && li < LINES && Math.abs(TOP - li * STEP - b) < BAND / 2 && tx > 0 && tx < tw * lens[li]) {
          return mark[li] === 1 ? MARK_ON : mark[li] === 0 ? MARK : TEXT;
        }
        return PAPER;
      }, (a, b) => (H / 2 - b) / H);
    },
    frame(R2, t, P, still) {
      if (still) return;
      const s = ((t * 0.2) % 1.5) - 0.2;
      R2.win(PAPER, s - 0.03, s + 0.03, -1, 1.55);
      R2.win(TEXT, s - 0.03, s + 0.03, -1, 2.6);
    },
  };
}

// 02 Weight each red flag: one bar per red flag, height = ln(adjusted odds ratio), with
// a whisker up to the top of its 95% interval. The selected one is in --panel-flag.
function barsScene() {
  const BASE = 0;
  return {
    extent: [2.3, 2.25],
    pivot: [0, 0.82, 0],
    view: { yaw: 0.6, pitch: -0.34, swayYaw: 0.3, swayPitch: 0.06, speed: 0.4, tiltYaw: 0.5, tiltPitch: 0.22 },
    mats: [
      { gain: 0.42, tint: 0, two: 0 },
      { gain: 1.0, tint: 0, two: 0 }, { gain: 1.0, tint: 0, two: 0 }, { gain: 1.0, tint: 0, two: 0 },
      { gain: 1.2, tint: 0, two: 0 }, { gain: 1.2, tint: 0, two: 0 }, { gain: 1.2, tint: 0, two: 0 },
    ],
    rebuild: ['bars'],
    build(C, hs, P) {
      const bars = (P.bars || []).slice(0, 3);
      if (!bars.length) return;
      const top = Math.max(...bars.map((b) => b.hi), 0.1);
      const k = 1.72 / top;
      const gap = 0.64;
      const n = bars.length;
      box(C, hs * 1.1, v3(0, -0.045, 0), (n * gap) / 2 + 0.1, 0.045, 0.42, BASE, 0, true);
      bars.forEach((b, i) => {
        const x = (i - (n - 1) / 2) * gap;
        const h = Math.max(0.08, b.v * k);
        box(C, hs, v3(x, h / 2, 0), 0.19, h / 2, 0.19, 1 + i, 0, true);
        const hi = b.hi * k;
        if (hi > h + 0.04) {
          tube(C, hs * 0.8, [v3(x, h, 0), v3(x, hi, 0)], 0.017, 0.017, 4 + i, 0, 0, false);
          tube(C, hs * 0.8, [v3(x - 0.09, hi, 0), v3(x + 0.09, hi, 0)], 0.017, 0.017, 4 + i, 0, 0, true);
        }
      });
    },
    frame(R2, t, P) {
      for (let i = 0; i < 3; i += 1) {
        const on = P.active === i ? 1 : 0;
        R2.tint[1 + i] = on; R2.tint[4 + i] = on;
      }
    },
  };
}

// 03 Range against the line: the likelihood range as a hill along a log axis (centre =
// median, width from the 95% range) and the referral line as a thin upright frame in
// --panel-accent. The part of the hill above the line is in --panel-flag.
function hillScene() {
  const HILL = 0; const GRID = 1; const WALL = 2;
  const X = (u) => -1.55 + 3.1 * u;
  return {
    extent: [3.3, 1.95],
    pivot: [0, 0.42, 0],
    view: { yaw: -0.42, pitch: -0.5, swayYaw: 0.22, swayPitch: 0.06, speed: 0.38, tiltYaw: 0.45, tiltPitch: 0.2 },
    mats: [
      { gain: 1.0, tint: 0, two: 1 },
      { gain: 0.5, tint: 0, two: 1 },
      { gain: 1.25, tint: 2, two: 1 },
    ],
    rebuild: ['mu', 'sd', 'line'],
    build(C, hs, P) {
      const mx = X(P.mu ?? 0.5);
      const sx = Math.max(0.07, (P.sd ?? 0.1) * 3.1);
      const sz = 0.42;
      const A = 1.08;
      const fy = (x, z) => A * Math.exp(-((x - mx) * (x - mx)) / (2 * sx * sx) - (z * z) / (2 * sz * sz));
      const fr = (q) => q - Math.floor(q);
      field(C, hs * 0.72, -1.62, 1.62, -0.92, 0.92, fy,
        (x, z) => (fr((x + 1.62) / 0.27) < 0.13 || fr((z + 0.92) / 0.23) < 0.15 ? GRID : HILL),
        (x, z, y) => (y > 0.03 ? x : -9));
      const wx = X(P.line ?? 0.5);
      const top = 1.32;
      tube(C, hs * 0.8, [v3(wx, 0, -0.92), v3(wx, top, -0.92), v3(wx, top, 0.92), v3(wx, 0, 0.92), v3(wx, 0, -0.92)], 0.013, 0.013, WALL, 0, 0, false);
      for (const yy of [top / 3, (2 * top) / 3]) tube(C, hs * 0.8, [v3(wx, yy, -0.92), v3(wx, yy, 0.92)], 0.007, 0.007, WALL, 0, 0, false);
    },
    frame(R2, t, P) {
      const wx = X(P.line ?? 0.5);
      R2.win(HILL, wx, 99, 1, 1.08);
      R2.win(GRID, wx, 99, 1, 1.3);
    },
  };
}

// 04 One action: a motor neuron (cell body, dendrites, a myelinated axon, branching
// terminals on a small muscle). A signal travels down the axon in --panel-flag and the
// muscle answers when it arrives.
function neuronScene() {
  const SOMA = 0; const DEND = 1; const AXON = 2; const MYEL = 3; const TERM = 4; const MUSC = 5; const MUSC2 = 6;
  return {
    extent: [4.45, 1.95],
    pivot: [-0.3, 0.06, 0],
    view: { yaw: -0.34, pitch: -0.14, swayYaw: 0.3, swayPitch: 0.07, speed: 0.36, tiltYaw: 0.45, tiltPitch: 0.24 },
    mats: [
      { gain: 1.05, tint: 0, two: 0 },
      { gain: 0.85, tint: 0, two: 0 },
      { gain: 1.0, tint: 0, two: 0 },
      { gain: 1.05, tint: 0, two: 0 },
      { gain: 1.05, tint: 0, two: 0 },
      { gain: 0.8, tint: 0, two: 0 },
      { gain: 0.5, tint: 0, two: 0 },
    ],
    rebuild: [],
    build(C, hs) {
      const S = v3(-1.28, 0.2, 0);
      ellipsoid(C, hs, S, 0.3, 0.27, 0.28, SOMA);
      const rnd = rng(5);
      for (const deg of [96, 132, 166, 198, 232, 268, 62]) {
        const a = (deg * Math.PI) / 180;
        const dir = v3(Math.cos(a), Math.sin(a), (rnd() - 0.5) * 0.7);
        const L = 0.42 + rnd() * 0.3;
        const perp = v3(-dir.y, dir.x, 0);
        const p0 = vadd(S, vscl(dir, 0.22));
        const p1 = vadd(vadd(S, vscl(dir, 0.22 + L * 0.5)), vscl(perp, (rnd() - 0.5) * 0.14));
        const p2 = vadd(S, vscl(dir, 0.22 + L));
        tube(C, hs, [p0, p1, p2], 0.06, 0.022, DEND);
        for (const turn of [-0.55, 0.5]) {
          const c = Math.cos(a + turn); const s = Math.sin(a + turn);
          tube(C, hs, [p2, vadd(p2, v3(c * 0.2, s * 0.2, (rnd() - 0.5) * 0.12))], 0.02, 0.012, DEND);
        }
      }
      const H0 = v3(-0.96, 0.15, 0);
      const E = v3(1.02, -0.12, 0);
      const curve = (u) => v3(H0.x + (E.x - H0.x) * u, H0.y + (E.y - H0.y) * u + 0.09 * Math.sin(2 * Math.PI * u), 0.07 * Math.sin(Math.PI * u));
      const path = (u0, u1, n) => { const out = []; for (let i = 0; i <= n; i += 1) out.push(curve(u0 + ((u1 - u0) * i) / n)); return out; };
      tube(C, hs, [vadd(S, v3(0.22, -0.02, 0)), H0], 0.13, 0.046, AXON, 0, 0, false);
      tube(C, hs, path(0, 1, 24), 0.044, 0.04, AXON, 0, 1);
      for (let j = 0; j < 5; j += 1) {
        const u0 = 0.06 + j * 0.188;
        const u1 = u0 + 0.148;
        tube(C, hs, path(u0, u1, 6), 0.088, 0.088, MYEL, u0, u1);
      }
      for (let i = 0; i < 5; i += 1) {
        const B = v3(1.38, -0.12 + (i - 2) * 0.15, (i % 2 ? 0.08 : -0.08));
        const mid = v3(1.18, E.y + (B.y - E.y) * 0.55, B.z * 0.5);
        tube(C, hs, [E, mid, B], 0.03, 0.022, TERM, 1, 1.08, false);
        ellipsoid(C, hs, B, 0.058, 0.058, 0.058, TERM, () => 1.1);
      }
      ellipsoid(C, hs, v3(1.7, -0.12, 0), 0.3, 0.56, 0.32, MUSC, null, (px, py, pz) => {
        const ang = Math.atan2(pz, px) + Math.PI;
        return Math.floor(ang / (Math.PI / 9)) % 2 ? MUSC2 : MUSC;
      });
    },
    frame(R2, t, P, still) {
      const p = still ? 0.55 : (t * 0.36) % 1.5;
      R2.win(AXON, p - 0.09, p + 0.012, 1, 1.5);
      R2.win(MYEL, p - 0.09, p + 0.012, 1, 1.3);
      if (p > 0.97 && p < 1.2) R2.tint[TERM] = 1;
      const f = p > 1.02 && p < 1.4 ? 1 + 0.75 * (1 - (p - 1.02) / 0.38) : 1;
      R2.gain[MUSC] = f; R2.gain[MUSC2] = f;
    },
  };
}

export const SCENES = { notes: notesScene, bars: barsScene, hill: hillScene, neuron: neuronScene };

// scanlineObject(canvas, sceneName, { params, pointerTarget, fit, rowPx, colPx })
// fit: where the object sits in the canvas: { ax, ay } centre (0..1) and { fw, fh } the
// share of the width and height it may fill.
// Returns { set(patch), renderOnce(), destroy(), state }.
// params.spin (radians) adds a yaw offset, used for the scroll parallax.
export function scanlineObject(canvas, sceneName, opts = {}) {
  const scene = (SCENES[sceneName] || notesScene)();
  const P = { spin: 0, ...(opts.params || {}) };
  // Row pitch in CSS px, snapped in setup() to a whole number of device pixels so the
  // lines sit evenly on the pixel grid (3 at DPR 1 and 2, 3.2 at 1.25, 3.33 at 1.5).
  const rowPx0 = opts.rowPx || 3;
  let rowPx = rowPx0;
  let lineW = 1;
  const colPx = opts.colPx || 2;
  const nm = scene.mats.length;
  const baseGain = new Float32Array(scene.mats.map((m) => m.gain));
  const baseTint = new Uint8Array(scene.mats.map((m) => m.tint));
  const two = new Uint8Array(scene.mats.map((m) => m.two));
  // per-frame material state, reset every frame, changed by scene.frame()
  const RT = {
    tint: new Uint8Array(nm), gain: new Float32Array(nm),
    wLo: new Float32Array(nm), wHi: new Float32Array(nm), wTint: new Int8Array(nm), wGain: new Float32Array(nm),
    win(m, lo, hi, tint, gain) { this.wLo[m] = lo; this.wHi[m] = hi; this.wTint[m] = tint; this.wGain[m] = gain; },
  };

  const C = new Cloud();
  let G = null; // grid buffers
  let fit = { ax: 0.5, ay: 0.5, fw: 0.86, fh: 0.8, ...(opts.fit || {}) };
  let dirty = true;
  let geo = { scale: 100, F: 700, D: 7, cx: 0, cy: 0, hs: 0.03 };
  let styles = null;

  const alloc = (w, h, dpr) => {
    const d = dpr || 1;
    rowPx = Math.max(2, Math.round(rowPx0 * d)) / d;
    lineW = Math.max(1, Math.round(d)) / d; // one device-snapped CSS pixel, every line
    const cols = Math.max(8, Math.ceil(w / colPx));
    const rows = Math.max(8, Math.ceil(h / rowPx));
    const n = cols * rows;
    if (!G || G.n < n || G.rk.length < cols) {
      G = { n, z: new Float32Array(n), l: new Float32Array(n), t: new Uint8Array(n), seg: new Float32Array(n * 3 + 3), sk: new Int16Array(n + 1), rk: new Int16Array(cols) };
    }
    G.cols = cols; G.rows = rows;
  };

  // One line weight for every level; the shading is carried by alpha alone: ink from 0.05
  // to 0.6 (a mid-grey on the espresso panel), the highlight tints a little stronger so
  // the one marked part still reads at a 1 px weight.
  const makeStyles = () => {
    const pal = palette();
    const cols = [pal.panelInk || '#F6EEE5', pal.panelFlag || '#F2876E', pal.panelAccent || '#8EC6E8'];
    const fill = [];
    for (let t = 0; t < TINTS; t += 1) {
      for (let l = 0; l < LEVELS; l += 1) {
        const q = l / (LEVELS - 1);
        const a = t === 0 ? 0.05 + 0.55 * Math.pow(q, 1.1) : 0.24 + 0.66 * Math.pow(q, 0.8);
        fill.push(rgba(cols[t], Math.min(1, a).toFixed(3)));
      }
    }
    styles = { fill };
  };

  const rebuild = (st) => {
    const ext = scene.extent;
    const scale = Math.max(10, Math.min((st.w * fit.fw) / ext[0], (st.h * fit.fh) / ext[1]));
    const D = 7;
    geo = { scale, D, F: scale * D, cx: st.w * fit.ax, cy: st.h * fit.ay, hs: (1.15 * colPx) / scale };
    C.reset();
    scene.build(C, geo.hs, P);
    dirty = false;
  };

  const lt = scene.view.light || [0.38, 0.55, -0.75];
  const L = vnorm(v3(lt[0], lt[1], lt[2]));
  const Hh = vnorm(v3(L.x, L.y, L.z - 1));

  const draw = (ctx, st) => {
    const { w, h } = st;
    if (!G || !styles) return;
    if (dirty) rebuild(st);
    const { cols, rows } = G;
    const zb = G.z; const lb = G.l; const tb = G.t;
    const n = cols * rows;
    zb.fill(EMPTY, 0, n);

    const still = st.reduced;
    const t = st.t;
    const v = scene.view;
    const sway = still ? 0 : 1;
    const yaw = v.yaw + sway * v.swayYaw * Math.sin(t * v.speed) + st.mouse.nx * v.tiltYaw + (P.spin || 0);
    const pitch = v.pitch + sway * v.swayPitch * Math.sin(t * v.speed * 0.77 + 1.3) + st.mouse.ny * v.tiltPitch;
    const cy = Math.cos(yaw); const sy = Math.sin(yaw);
    const cp = Math.cos(pitch); const sp = Math.sin(pitch);

    for (let m = 0; m < nm; m += 1) { RT.tint[m] = baseTint[m]; RT.gain[m] = 1; RT.wLo[m] = 1e9; RT.wHi[m] = -1e9; RT.wTint[m] = -1; RT.wGain[m] = 1; }
    if (scene.frame) scene.frame(RT, t, P, still);

    const { F, D, cx } = geo;
    const cyS = geo.cy;
    const px0 = scene.pivot[0]; const py0 = scene.pivot[1]; const pz0 = scene.pivot[2];
    const Lx = L.x; const Ly = L.y; const Lz = L.z; const Hx = Hh.x; const Hy = Hh.y; const Hz = Hh.z;
    const R = Math.max(scene.extent[0], scene.extent[1]) * 0.6;
    const zNear = D - R; const zSpan = 2 * R;
    const d = C.d; const cnt = C.n;
    const icol = 1 / colPx; const irow = 1 / rowPx;
    for (let i = 0, o = 0; i < cnt; i += 1, o += STRIDE) {
      const x = d[o] - px0; const y = d[o + 1] - py0; const z = d[o + 2] - pz0;
      const x1 = x * cy + z * sy; const z1 = -x * sy + z * cy;
      const y2 = y * cp - z1 * sp; const z2 = y * sp + z1 * cp;
      const nx = d[o + 3]; const ny = d[o + 4]; const nz = d[o + 5];
      let nx2 = nx * cy + nz * sy; const nz1 = -nx * sy + nz * cy;
      let ny2 = ny * cp - nz1 * sp; let nz2 = ny * sp + nz1 * cp;
      const m = d[o + 6] | 0;
      if (nz2 > 0.02) {
        if (!two[m]) continue;
        nx2 = -nx2; ny2 = -ny2; nz2 = -nz2;
      }
      const zz = z2 + D;
      if (zz < 0.5) continue;
      const s = F / zz;
      const sx = cx + x1 * s; const syy = cyS - y2 * s;
      if (sx < 0 || syy < 0) continue;
      const c = (sx * icol) | 0; const r = (syy * irow) | 0;
      if (c >= cols || r >= rows) continue;
      const k = r * cols + c;
      if (zz >= zb[k]) continue;
      const diff = nx2 * Lx + ny2 * Ly + nz2 * Lz;
      let lum = 0.1 + 0.82 * (diff > 0 ? diff : 0);
      let hv = nx2 * Hx + ny2 * Hy + nz2 * Hz;
      if (hv > 0) { hv *= hv; hv *= hv; hv *= hv; lum += 0.3 * hv * hv; }
      const rim = 1 + nz2; // 0 facing the camera, 1 at the silhouette
      lum += 0.3 * rim * rim * rim;
      let g = baseGain[m] * RT.gain[m];
      let tint = RT.tint[m];
      const prm = d[o + 7];
      if (prm >= RT.wLo[m] && prm <= RT.wHi[m]) { g *= RT.wGain[m]; if (RT.wTint[m] >= 0) tint = RT.wTint[m]; }
      lum *= g * (1 - 0.28 * ((zz - zNear) / zSpan));
      zb[k] = zz; lb[k] = lum; tb[k] = tint;
    }

    // close one-row and one- or two-column holes left between samples
    for (let r = 1; r < rows - 1; r += 1) {
      for (let c = 0, k = r * cols; c < cols; c += 1, k += 1) {
        if (zb[k] < EMPTY) continue;
        const a = k - cols; const b = k + cols;
        if (zb[a] < EMPTY && zb[b] < EMPTY && Math.abs(zb[a] - zb[b]) < 0.3) { zb[k] = (zb[a] + zb[b]) * 0.5; lb[k] = (lb[a] + lb[b]) * 0.5; tb[k] = tb[a]; }
      }
    }
    for (let r = 0; r < rows; r += 1) {
      const base = r * cols;
      for (let c = 1; c < cols - 1; c += 1) {
        const k = base + c;
        if (zb[k] < EMPTY || zb[k - 1] >= EMPTY) continue;
        if (zb[k + 1] < EMPTY) {
          if (Math.abs(zb[k - 1] - zb[k + 1]) < 0.3) { zb[k] = zb[k - 1]; lb[k] = (lb[k - 1] + lb[k + 1]) * 0.5; tb[k] = tb[k - 1]; }
        } else if (c < cols - 2 && zb[k + 2] < EMPTY && Math.abs(zb[k - 1] - zb[k + 2]) < 0.3) {
          zb[k] = zb[k - 1]; lb[k] = lb[k - 1] * 0.67 + lb[k + 2] * 0.33; tb[k] = tb[k - 1];
          zb[k + 1] = zb[k + 2]; lb[k + 1] = lb[k - 1] * 0.33 + lb[k + 2] * 0.67; tb[k + 1] = tb[k + 2];
        }
      }
    }

    // reveal top to bottom the first time the object is drawn (a print-in)
    const revealRows = still ? rows : Math.min(rows, Math.floor((t * 950) / rowPx));

    // Per row: smooth the brightness along the row (3 taps, 0.25 / 0.5 / 0.25, only between
    // filled cells of the same colour), cut it into LEVELS, key = colour * LEVELS + level;
    // then runs of equal keys. Smoothing first keeps the runs long (no short bars).
    const seg = G.seg; const sk = G.sk; const rk = G.rk;
    let ns = 0;
    for (let r = 0; r < revealRows; r += 1) {
      const base = r * cols;
      for (let c = 0, k = base; c < cols; c += 1, k += 1) {
        if (zb[k] >= EMPTY) { rk[c] = -1; continue; }
        const tk = tb[k];
        let s = lb[k] * 0.5; let wsum = 0.5;
        if (c > 0 && zb[k - 1] < EMPTY && tb[k - 1] === tk) { s += lb[k - 1] * 0.25; wsum += 0.25; }
        if (c < cols - 1 && zb[k + 1] < EMPTY && tb[k + 1] === tk) { s += lb[k + 1] * 0.25; wsum += 0.25; }
        const lum = s / wsum;
        rk[c] = lum > 0.035 ? tk * LEVELS + Math.min(LEVELS - 1, (lum * LEVELS) | 0) : -1;
      }
      let c = 0;
      while (c < cols) {
        const key = rk[c];
        if (key < 0) { c += 1; continue; }
        let c1 = c + 1;
        while (c1 < cols && rk[c1] === key) c1 += 1;
        seg[ns * 3] = c; seg[ns * 3 + 1] = c1; seg[ns * 3 + 2] = r; sk[ns] = key; ns += 1;
        c = c1;
      }
    }

    ctx.clearRect(0, 0, w, h);
    const { fill } = styles;
    const NK = TINTS * LEVELS;
    const dpr = st.dpr || 1;
    const th = lineW;
    for (let key = 0; key < NK; key += 1) {
      let any = false;
      for (let s2 = 0; s2 < ns; s2 += 1) {
        if (sk[s2] !== key) continue;
        if (!any) { ctx.beginPath(); any = true; }
        const c0 = seg[s2 * 3]; const c1 = seg[s2 * 3 + 1]; const r = seg[s2 * 3 + 2];
        // top edge on a whole device pixel, so every line is one crisp, even hairline
        const y = Math.round(((r + 0.5) * rowPx - th * 0.5) * dpr) / dpr;
        ctx.rect(c0 * colPx, y, (c1 - c0) * colPx, th);
      }
      if (any) { ctx.fillStyle = fill[key]; ctx.fill(); }
    }
  };

  const fx = createEffect(canvas, {
    interactive: true,
    pointerTarget: opts.pointerTarget,
    maxDpr: 2,
    setup(ctx, st) { alloc(st.w, st.h, st.dpr); makeStyles(); dirty = true; },
    draw,
  });

  return {
    state: fx.state,
    renderOnce: fx.renderOnce,
    set(patch) {
      let geom = false;
      for (const k of Object.keys(patch || {})) {
        if (P[k] === patch[k]) continue;
        P[k] = patch[k];
        if (scene.rebuild.includes(k)) geom = true;
      }
      if (patch && patch.fit) { fit = { ...fit, ...patch.fit }; geom = true; }
      if (geom) dirty = true;
      if (fx.state.reduced) fx.renderOnce();
    },
    destroy() { fx.destroy(); },
  };
}
