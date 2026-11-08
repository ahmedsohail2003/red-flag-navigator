// Point-cloud figure for the overview hero. A calm, standing person drawn as about
// fifteen thousand fine, dim points on horizontal slices (like scan slices), in plain
// Canvas 2D. Points on the far side of the body fade out and the outline is brighter,
// so the silhouette reads without the figure competing with the copy.
// - The mouse turns the figure toward it (yaw about ±25°, pitch about ±8°) and shifts
//   a faint perspective floor grid (parallax), over a faint background grid with a
//   few flickering squares.
// - Soft nerve-signal pulses run from the head down the spine to the hands and feet.
// - Red-flag beacons light up at the body region of each flag the calculator ticks:
//   right hand (arm), right foot (leg), throat (speech and swallowing), chest (breathing).
// Decorative only (the canvas is aria-hidden): everything it shows is also in the text.
// Budget: geometry is built once; the frame loop allocates nothing.
import { createEffect, palette, rgba, clamp, rng } from './core.js';

export const FIGURE_REGIONS = ['arm', 'leg', 'bulbar', 'breathing'];
const REGION_INDEX = { arm: 1, leg: 2, bulbar: 3, breathing: 4 };

// ---------- the body model ----------
// Metres, y up, the figure faces the viewer: front = -z, the person's right side = -x.
// Each loft is a list of rings [y, cx, cz, rx, rz], bottom to top.
const H_M = 1.75;
const MID = H_M / 2;
// The waist (1.03 to 1.18) is narrower than the hips and the chest, so the torso is not a box.
const TORSO = [
  [0.86, 0, 0.000, 0.150, 0.095], [0.90, 0, 0.000, 0.165, 0.104], [0.96, 0, -0.005, 0.160, 0.100],
  [1.03, 0, -0.010, 0.138, 0.090], [1.10, 0, -0.012, 0.126, 0.087], [1.18, 0, -0.015, 0.138, 0.096],
  [1.27, 0, -0.018, 0.156, 0.106], [1.35, 0, -0.012, 0.164, 0.104], [1.42, 0, -0.004, 0.150, 0.090],
  [1.445, 0, 0.000, 0.118, 0.078], [1.468, 0, 0.005, 0.072, 0.058],
];
const NECK = [[1.45, 0, 0.008, 0.052, 0.056], [1.53, 0, 0.000, 0.048, 0.054]];
const HEAD = [
  [1.50, 0, -0.015, 0.045, 0.058], [1.53, 0, -0.012, 0.060, 0.078], [1.57, 0, -0.004, 0.071, 0.090],
  [1.62, 0, 0.000, 0.077, 0.097], [1.67, 0, 0.004, 0.076, 0.094], [1.705, 0, 0.008, 0.066, 0.083],
  [1.73, 0, 0.010, 0.048, 0.062], [1.748, 0, 0.010, 0.016, 0.022],
];
// The arm hangs a little away from the body (hand at x -0.265), so light shows between them.
const ARM_R = [
  [0.70, -0.265, -0.020, 0.008, 0.014], [0.72, -0.265, -0.020, 0.016, 0.030], [0.76, -0.263, -0.018, 0.020, 0.044],
  [0.82, -0.260, -0.014, 0.022, 0.046], [0.86, -0.257, -0.010, 0.024, 0.030], [0.92, -0.250, -0.004, 0.031, 0.035],
  [1.02, -0.240, 0.002, 0.038, 0.041], [1.10, -0.232, 0.006, 0.035, 0.037], [1.18, -0.221, 0.006, 0.039, 0.041],
  [1.30, -0.207, 0.004, 0.046, 0.049], [1.40, -0.195, 0.000, 0.051, 0.054], [1.43, -0.188, 0.000, 0.046, 0.048],
  [1.452, -0.178, 0.000, 0.028, 0.032], [1.462, -0.170, 0.000, 0.010, 0.012],
];
const LEG_R = [
  [0.075, -0.100, 0.005, 0.030, 0.034], [0.12, -0.100, 0.006, 0.028, 0.031], [0.20, -0.099, 0.008, 0.034, 0.037],
  [0.32, -0.098, 0.010, 0.047, 0.052], [0.40, -0.097, 0.008, 0.052, 0.058], [0.47, -0.096, 0.002, 0.048, 0.050],
  [0.52, -0.096, -0.004, 0.050, 0.052], [0.62, -0.095, -0.004, 0.060, 0.064], [0.75, -0.093, 0.000, 0.074, 0.080],
  [0.85, -0.090, 0.002, 0.084, 0.090], [0.89, -0.088, 0.002, 0.080, 0.086],
];
const FOOT_R = [
  [0.004, -0.106, -0.050, 0.038, 0.105], [0.025, -0.106, -0.045, 0.044, 0.118],
  [0.050, -0.104, -0.025, 0.040, 0.085], [0.072, -0.101, -0.004, 0.032, 0.048],
];
const mirror = (loft) => loft.map(([y, cx, cz, rx, rz]) => [y, -cx, cz, rx, rz]);

// region tagger per loft: (y, z, side) -> 0 none | 1 arm | 2 leg | 3 bulbar | 4 breathing
const LOFTS = [
  { keys: TORSO, region: (y, z) => (y > 1.12 && y < 1.40 && z < -0.03 ? 4 : 0), breath: true },
  { keys: NECK, region: (y, z) => (z < 0.02 ? 3 : 0) },
  { keys: HEAD, region: (y, z) => (y < 1.565 && z < -0.01 ? 3 : 0) },
  { keys: ARM_R, region: (y) => (y < 1.06 ? 1 : 0) },
  { keys: mirror(ARM_R), region: () => 0 },
  { keys: LEG_R, region: (y) => (y < 0.48 ? 2 : 0) },
  { keys: mirror(LEG_R), region: () => 0 },
  { keys: FOOT_R, region: () => 2 },
  { keys: mirror(FOOT_R), region: () => 0 },
];

const RING = [0, 0, 0, 0];
function ringAt(keys, y) {
  let k = 0;
  while (k < keys.length - 2 && y > keys[k + 1][0]) k += 1;
  const a = keys[k];
  const b = keys[k + 1];
  const t = clamp((y - a[0]) / ((b[0] - a[0]) || 1), 0, 1);
  for (let j = 1; j < 5; j += 1) RING[j - 1] = a[j] + (b[j] - a[j]) * t;
  return RING;
}

let BODY = null; // built once per page
function buildBody() {
  if (BODY) return BODY;
  // About 1.1 cm between slices and between points on a slice: a fine, quiet scan.
  const DY = 0.011;
  const DS = 0.0105;
  const rand = rng(7);
  const xs = []; const ys = []; const zs = []; const cxs = []; const czs = []; const nxs = []; const nzs = []; const bw = []; const reg = [];
  for (let y = 0.006; y <= H_M; y += DY) {
    for (const loft of LOFTS) {
      const keys = loft.keys;
      if (y < keys[0][0] || y > keys[keys.length - 1][0]) continue;
      const [cx, cz, rx, rz] = ringAt(keys, y);
      if (rx <= 0.002) continue;
      const per = 2 * Math.PI * Math.sqrt((rx * rx + rz * rz) / 2);
      const n = Math.max(5, Math.round(per / DS));
      const phase = rand() * Math.PI * 2;
      const breath = loft.breath ? clamp(1 - Math.abs(y - 1.26) / 0.18, 0, 1) : 0;
      for (let k = 0; k < n; k += 1) {
        const a = phase + (k / n) * Math.PI * 2 + (rand() - 0.5) * 0.12;
        const wob = 1 + (rand() - 0.5) * 0.03;
        const ca = Math.cos(a); const sa = Math.sin(a);
        const x = cx + ca * rx * wob;
        const z = cz + sa * rz * wob;
        // outward normal of the ring (an ellipse): (rz cos a, rx sin a), unit length
        const nl = Math.hypot(rz * ca, rx * sa) || 1;
        xs.push(x); ys.push(y + (rand() - 0.5) * DY * 0.25); zs.push(z);
        cxs.push(cx); czs.push(cz); nxs.push((rz * ca) / nl); nzs.push((rx * sa) / nl); bw.push(breath); reg.push(loft.region(y, z));
      }
    }
  }
  BODY = {
    n: xs.length,
    x: Float32Array.from(xs), y: Float32Array.from(ys), z: Float32Array.from(zs),
    cx: Float32Array.from(cxs), cz: Float32Array.from(czs), nx: Float32Array.from(nxs), nz: Float32Array.from(nzs),
    bw: Float32Array.from(bw), reg: Uint8Array.from(reg),
  };
  return BODY;
}

// ---------- nerve routes: head -> spine -> hands, feet, throat, diaphragm ----------
const SPINE = [[0, 1.63, 0.0], [0, 1.555, 0.02], [0, 1.47, 0.055], [0, 1.40, 0.07]];
const ARM_PATH_R = [[-0.10, 1.41, 0.04], [-0.192, 1.41, 0.005], [-0.229, 1.12, 0.004], [-0.256, 0.86, -0.01], [-0.264, 0.74, -0.02]];
const LOWER = [[0, 1.15, 0.078], [0, 0.98, 0.07], [0, 0.92, 0.055]];
const LEG_PATH_R = [[-0.06, 0.88, 0.02], [-0.092, 0.80, 0.0], [-0.096, 0.50, -0.006], [-0.100, 0.10, 0.004], [-0.105, 0.02, -0.11]];
const mx = (pts) => pts.map(([x, y, z]) => [-x, y, z]);
const ROUTE_DEFS = [
  [...SPINE, ...ARM_PATH_R],                 // 0 right arm (region arm)
  [...SPINE, ...mx(ARM_PATH_R)],             // 1 left arm
  [...SPINE, ...LOWER, ...LEG_PATH_R],       // 2 right leg (region leg)
  [...SPINE, ...LOWER, ...mx(LEG_PATH_R)],   // 3 left leg
  [[0, 1.63, 0.0], [0, 1.555, 0.02], [0, 1.535, -0.045], [0, 1.50, -0.05]],               // 4 throat (bulbar)
  [[0, 1.63, 0.0], [0, 1.555, 0.02], [0, 1.47, 0.055], [0, 1.40, 0.02], [0, 1.30, -0.03], [0, 1.16, -0.07]], // 5 diaphragm
];
const ROUTE_OF = { arm: 0, leg: 2, bulbar: 4, breathing: 5 };
const ROUTE_WEIGHT = [0.22, 0.22, 0.2, 0.2, 0.08, 0.08];
const ROUTES = ROUTE_DEFS.map((pts) => {
  const p = Float32Array.from(pts.flat());
  const cum = new Float32Array(pts.length);
  for (let i = 1; i < pts.length; i += 1) {
    const dx = pts[i][0] - pts[i - 1][0]; const dy = pts[i][1] - pts[i - 1][1]; const dz = pts[i][2] - pts[i - 1][2];
    cum[i] = cum[i - 1] + Math.hypot(dx, dy, dz);
  }
  return { p, cum, len: cum[pts.length - 1], n: pts.length };
});

// Beacon anchors, one per region (index 1..4 matches REGION_INDEX).
const ANCHOR = [null, [-0.260, 0.80, -0.02], [-0.10, 0.10, -0.035], [0, 1.51, -0.06], [0, 1.27, -0.115]];
const LABEL_SIDE = [0, -1, -1, 1, 1]; // preferred side: -1 left, +1 right (away from the body)
// The throat and chest sit on the midline, so their labels may use either side. A hand or
// foot label on the other side would cross the body; it goes below the marker instead.
const LABEL_FLIP = [false, false, false, true, true];

// ---------- floor grid (static segments, pre-sorted by fade level) ----------
function buildFloor() {
  const step = 0.35;
  const segs = [[], [], [], []];
  const addSeg = (x0, z0, x1, z1) => {
    const r = Math.hypot((x0 + x1) / 2, (z0 + z1) / 2 - 0.35);
    const lv = r < 0.75 ? 3 : r < 1.25 ? 2 : r < 1.75 ? 1 : r < 2.25 ? 0 : -1;
    if (lv >= 0) segs[lv].push(x0, z0, x1, z1);
  };
  for (let gx = -2.1; gx <= 2.1 + 1e-6; gx += step) for (let gz = -1.05; gz < 2.45 - 1e-6; gz += step) addSeg(gx, gz, gx, gz + step);
  for (let gz = -1.05; gz <= 2.45 + 1e-6; gz += step) for (let gx = -2.1; gx < 2.1 - 1e-6; gx += step) addSeg(gx, gz, gx + step, gz);
  return segs.map((a) => Float32Array.from(a));
}

function sprite(hex) {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, rgba(hex, 1));
  grd.addColorStop(0.22, rgba(hex, 0.55));
  grd.addColorStop(1, rgba(hex, 0));
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return c;
}

const NB = 20; // 10 cream brightness levels + 10 red levels
const DASH = [3, 5];
const NO_DASH = [];

// createFigure(canvas, { pointerTarget }) -> { setStage, setFlags, setPreview, setSpot, pulse, renderOnce, destroy }
export function createFigure(canvas, opts = {}) {
  const B = buildBody();
  const N = B.n;
  const PX = new Float32Array(N);
  const PY = new Float32Array(N);
  const IDX = new Uint32Array(2 * N);
  const BK = new Uint8Array(2 * N);
  const ORDER = new Uint32Array(2 * N);
  const COUNT = new Uint32Array(NB);
  const START = new Uint32Array(NB);
  const CUR = new Uint32Array(NB);
  const FLOOR = buildFloor();
  const RV = ROUTES.map((r) => new Float32Array(r.n * 2)); // projected route vertices
  const AP = new Float32Array(5 * 3); // projected anchors: x, y, scale
  const P3 = new Float32Array(3); // scratch: one projected point
  const Q3 = new Float32Array(3); // scratch: one model point

  // targets set by the page, and their eased values
  const lit = new Float32Array(5); const litE = new Float32Array(5);
  const spot = new Float32Array(5); const spotE = new Float32Array(5);
  const prev = new Float32Array(5); const prevE = new Float32Array(5);
  const litAt = new Float32Array(5);
  const labels = [null, null, null, null, null]; // { a, b, wa, wb }
  let connect = []; // region indices joined by the multi-region rule
  let connectE = 0;
  let labelsDirty = true;

  // nerve pulses: fixed pool, no allocation per frame
  const PULSES = Array.from({ length: 10 }, () => ({ alive: false, route: 0, d: 0, speed: 0.75, red: false }));
  let spawnIn = 0.2;
  const rand = rng(11);

  // background grid flicker squares
  const SQ = Array.from({ length: 7 }, () => ({ u: 0, r: 0, t0: -100, dur: 2.6 }));

  // camera and layout (from the stage rect, in canvas CSS px)
  const cam = { cx: 0, cy: 0, f: 1, dist: 5, s0: 1, figH: 1 };
  let stage = null;
  let pal = null;
  let STYLE = []; // lines, marks and label text (10 cream levels, then 10 red)
  let PSTYLE = []; // points: finer and dimmer than the marks, so the figure stays quiet
  let PSIZE = [];
  let floorStyle = [];
  let vignette = null;
  let glowInk = null;
  let glowFlag = null;
  const fontMono = '500 10px "Geist Mono", ui-monospace, "Cascadia Mono", Consolas, monospace';

  function layout(state) {
    const s = stage && stage.w > 40 && stage.h > 40 ? stage : { x: state.w * 0.3, y: 0, w: state.w * 0.4, h: state.h };
    const figH = clamp(Math.min(s.h * 0.86, s.w * 3.1), 220, 760);
    cam.figH = figH;
    cam.s0 = figH / H_M;
    cam.dist = 5.2;
    cam.f = cam.s0 * cam.dist;
    cam.cx = s.x + s.w / 2;
    cam.cy = s.y + s.h / 2 + s.h * 0.015;
  }

  function setup(ctx, state) {
    pal = palette();
    const ink = pal.panelInk || '#F6EEE5';
    const flag = pal.panelFlag || '#F2876E';
    STYLE = []; PSTYLE = []; PSIZE = [];
    for (let l = 0; l < 10; l += 1) { STYLE.push(rgba(ink, 0.05 + l * 0.088)); PSTYLE.push(rgba(ink, 0.04 + l * 0.073)); PSIZE.push(0.7 + l * 0.044); }
    for (let l = 0; l < 10; l += 1) { STYLE.push(rgba(flag, 0.12 + l * 0.088)); PSTYLE.push(rgba(flag, 0.16 + l * 0.08)); PSIZE.push(0.9 + l * 0.05); }
    floorStyle = [rgba(ink, 0.035), rgba(ink, 0.06), rgba(ink, 0.09), rgba(ink, 0.12)];
    if (!glowInk) { glowInk = sprite(ink); glowFlag = sprite(flag); }
    const R = Math.max(state.w, state.h);
    vignette = ctx.createRadialGradient(state.w * 0.5, state.h * 0.45, R * 0.18, state.w * 0.5, state.h * 0.45, R * 0.75);
    vignette.addColorStop(0, rgba(pal.panel || '#1C1512', 0));
    vignette.addColorStop(1, rgba(pal.panel || '#1C1512', 0.78));
    layout(state);
    labelsDirty = true;
  }

  // project a model point already rotated by the frame's transform (written into P3)
  let cyw = 1; let syw = 0; let cpt = 1; let spt = 0;
  function proj(x, y, z) {
    const yy = y - MID;
    const x1 = x * cyw + z * syw;
    const z1 = -x * syw + z * cyw;
    const y2 = yy * cpt + z1 * spt;
    const z2 = -yy * spt + z1 * cpt;
    const s = cam.f / (z2 + cam.dist);
    P3[0] = cam.cx + x1 * s; P3[1] = cam.cy - y2 * s; P3[2] = z2;
  }
  function routePoint(route, d) {
    const R = ROUTES[route];
    const dd = clamp(d, 0, R.len);
    let k = 1;
    while (k < R.n - 1 && R.cum[k] < dd) k += 1;
    const t = (dd - R.cum[k - 1]) / ((R.cum[k] - R.cum[k - 1]) || 1);
    const a = (k - 1) * 3; const b = k * 3;
    Q3[0] = R.p[a] + (R.p[b] - R.p[a]) * t;
    Q3[1] = R.p[a + 1] + (R.p[b + 1] - R.p[a + 1]) * t;
    Q3[2] = R.p[a + 2] + (R.p[b + 2] - R.p[a + 2]) * t;
  }
  function spawn(route, red) {
    for (const p of PULSES) {
      if (p.alive) continue;
      p.alive = true; p.route = route; p.d = 0; p.red = !!red; p.speed = 0.62 + rand() * 0.22;
      return;
    }
  }
  function pickRoute() {
    let u = rand();
    for (let i = 0; i < ROUTE_WEIGHT.length; i += 1) { u -= ROUTE_WEIGHT[i]; if (u <= 0) return i; }
    return 0;
  }

  function measureLabels(ctx) {
    ctx.font = fontMono;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0.06em';
    for (let r = 1; r <= 4; r += 1) {
      const L = labels[r];
      if (!L) continue;
      L.wa = ctx.measureText(L.a).width;
      L.wb = ctx.measureText(L.b).width;
    }
    labelsDirty = false;
  }

  function draw(ctx, state) {
    const { w, h, t, reduced } = state;
    const dt = reduced ? 1 : state.dt;
    const nx = state.mouse.nx; const ny = state.mouse.ny;
    ctx.clearRect(0, 0, w, h);
    if (labelsDirty) measureLabels(ctx);

    // eased targets
    const kE = 1 - Math.exp(-dt * 5);
    for (let r = 1; r <= 4; r += 1) {
      litE[r] += (lit[r] - litE[r]) * kE;
      spotE[r] += (spot[r] - spotE[r]) * (1 - Math.exp(-dt * 3));
      prevE[r] += (prev[r] - prevE[r]) * (1 - Math.exp(-dt * 9));
    }
    connectE += ((connect.length > 1 ? 1 : 0) - connectE) * kE;

    // ---- background grid with parallax and a few flickering squares ----
    const cell = 56;
    const ox = ((-nx * 10) % cell + cell) % cell;
    const oy = ((-ny * 6) % cell + cell) % cell;
    ctx.lineWidth = 1;
    ctx.strokeStyle = STYLE[0];
    ctx.beginPath();
    for (let x = ox; x < w; x += cell) { ctx.moveTo(Math.round(x) + 0.5, 0); ctx.lineTo(Math.round(x) + 0.5, h); }
    for (let y = oy; y < h; y += cell) { ctx.moveTo(0, Math.round(y) + 0.5); ctx.lineTo(w, Math.round(y) + 0.5); }
    ctx.stroke();
    // squares only in the figure's columns (computed every frame, so they follow the layout)
    const rows = Math.ceil(h / cell);
    const c0 = Math.max(1, Math.floor((cam.cx - cam.figH * 0.4 - ox) / cell) + 1);
    const c1 = Math.max(c0 + 1, Math.ceil((cam.cx + cam.figH * 0.4 - ox) / cell) + 1);
    ctx.fillStyle = STYLE[1];
    for (const q of SQ) {
      let ph = (t - q.t0) / q.dur;
      if (ph >= 1 || q.t0 < -10) {
        q.t0 = t + 0.4 + rand() * 1.6; q.dur = 2.2 + rand() * 1.8;
        q.u = rand(); q.r = 1 + Math.floor(rand() * Math.max(1, rows - 1));
        ph = -1;
      }
      if (ph <= 0) continue;
      const c = c0 + Math.floor(q.u * (c1 - c0));
      ctx.globalAlpha = Math.sin(Math.PI * ph) * 0.3;
      ctx.fillRect(ox + (c - 1) * cell + 1, oy + (q.r - 1) * cell + 1, cell - 1, cell - 1);
    }
    ctx.globalAlpha = 1;
    if (vignette) { ctx.fillStyle = vignette; ctx.fillRect(0, 0, w, h); }

    // ---- camera for this frame ----
    const sway = reduced ? 0 : Math.sin(t * 0.31) * 0.05;
    const yaw = -0.2 + sway - nx * 0.44;
    const pitch = 0.085 + ny * 0.14;

    // ---- floor: pitch and a parallax shift, a little of the yaw ----
    cyw = Math.cos(-nx * 0.1); syw = Math.sin(-nx * 0.1); cpt = Math.cos(pitch); spt = Math.sin(pitch);
    const shift = -nx * 0.22;
    ctx.lineWidth = 1;
    for (let lv = 0; lv < 4; lv += 1) {
      const S = FLOOR[lv];
      ctx.strokeStyle = floorStyle[lv];
      ctx.beginPath();
      for (let k = 0; k < S.length; k += 4) {
        proj(S[k] + shift, 0, S[k + 1]); const ax = P3[0]; const ay = P3[1];
        proj(S[k + 2] + shift, 0, S[k + 3]);
        ctx.moveTo(ax, ay); ctx.lineTo(P3[0], P3[1]);
      }
      ctx.stroke();
    }
    // soft pool of light under the feet
    proj(0, 0, 0);
    const pw = cam.s0 * 1.25;
    ctx.globalAlpha = 0.07;
    ctx.drawImage(glowInk, P3[0] - pw / 2, P3[1] - pw * 0.13, pw, pw * 0.26);
    ctx.globalAlpha = 1;

    // ---- figure transform ----
    cyw = Math.cos(yaw); syw = Math.sin(yaw); cpt = Math.cos(pitch); spt = Math.sin(pitch);
    const breath = reduced ? 0 : Math.sin(t * 1.55) * 0.016;
    const scanY = reduced ? -1 : 0.05 + (H_M - 0.1) * (0.5 - 0.5 * Math.cos(t * 0.38));
    const tint1 = litE[1]; const tint2 = litE[2]; const tint3 = litE[3]; const tint4 = litE[4];
    const sp1 = spotE[1]; const sp2 = spotE[2]; const sp3 = spotE[3]; const sp4 = spotE[4];
    COUNT.fill(0);
    let m = 0;
    const f = cam.f; const dist = cam.dist; const cx0 = cam.cx; const cy0 = cam.cy;
    for (let i = 0; i < N; i += 1) {
      let x = B.x[i]; let z = B.z[i];
      const y = B.y[i];
      const bw = B.bw[i];
      if (bw > 0) { const k = 1 + bw * breath; x = B.cx[i] + (x - B.cx[i]) * k; z = B.cz[i] + (z - B.cz[i]) * k; }
      const yy = y - MID;
      const x1 = x * cyw + z * syw;
      const z1 = -x * syw + z * cyw;
      const y2 = yy * cpt + z1 * spt;
      const z2 = -yy * spt + z1 * cpt;
      const s = f / (z2 + dist);
      PX[i] = cx0 + x1 * s;
      PY[i] = cy0 - y2 * s;
      // brightness: nearer is brighter
      let d01 = (z2 + 0.3) / 0.6;
      d01 = d01 < 0 ? 0 : d01 > 1 ? 1 : d01;
      let b = 0.17 + 0.5 * (1 - d01) * (1 - d01 * 0.25);
      const reg = B.reg[i];
      let tint = 0;
      if (reg) {
        tint = reg === 1 ? tint1 : reg === 2 ? tint2 : reg === 3 ? tint3 : tint4;
        b += 0.5 * (reg === 1 ? sp1 : reg === 2 ? sp2 : reg === 3 ? sp3 : sp4);
      }
      if (scanY > 0) { const dy = Math.abs(y - scanY); if (dy < 0.03) b += 0.2 * (1 - dy / 0.03); }
      // facing: the ring normal turned like the point, against the ray from the camera.
      // Points on the far side of a ring fade to 15%, so front and back rows never mix;
      // points on the outline (normal across the ray) get brighter, so the silhouette reads.
      const nxm = B.nx[i]; const nzm = B.nz[i];
      const nx1 = nxm * cyw + nzm * syw;
      const nz1 = -nxm * syw + nzm * cyw;
      const c = -(nx1 * x1 + nz1 * spt * y2) / (z2 + dist) - nz1 * cpt;
      const vis = c >= 0.06 ? 1 : c <= -0.2 ? 0.15 : 0.15 + 0.85 * ((c + 0.2) / 0.26);
      const ac = c < 0 ? -c : c;
      const rim = ac < 0.3 ? 1 - ac / 0.3 : 0;
      b = b * vis + 0.34 * rim * rim;
      const base = b * (1 - tint * 0.85);
      let lv = (base * 9.99) | 0; if (lv > 9) lv = 9;
      if (lv > 0) { IDX[m] = i; BK[m] = lv; COUNT[lv] += 1; m += 1; }
      if (tint > 0.02) {
        let lr = ((b + 0.2 * vis) * tint * 9.99) | 0; if (lr > 9) lr = 9;
        if (lr > 0) { IDX[m] = i; BK[m] = 10 + lr; COUNT[10 + lr] += 1; m += 1; }
      }
    }
    START[0] = 0;
    for (let k = 1; k < NB; k += 1) START[k] = START[k - 1] + COUNT[k - 1];
    CUR.set(START);
    for (let k = 0; k < m; k += 1) { const bk = BK[k]; ORDER[CUR[bk]] = IDX[k]; CUR[bk] += 1; }

    // faint nerve routes inside the body
    ctx.strokeStyle = STYLE[1];
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let r = 0; r < ROUTES.length; r += 1) {
      const R = ROUTES[r]; const V = RV[r];
      for (let k = 0; k < R.n; k += 1) {
        proj(R.p[k * 3], R.p[k * 3 + 1], R.p[k * 3 + 2]);
        V[k * 2] = P3[0]; V[k * 2 + 1] = P3[1];
        if (k === 0) ctx.moveTo(P3[0], P3[1]); else ctx.lineTo(P3[0], P3[1]);
      }
    }
    ctx.stroke();

    // points, one path per brightness bucket
    for (let bk = 1; bk < NB; bk += 1) {
      const c = COUNT[bk];
      if (!c || bk === 10) continue;
      const sz = PSIZE[bk]; const hs = sz / 2;
      ctx.fillStyle = PSTYLE[bk];
      ctx.beginPath();
      const end = START[bk] + c;
      for (let k = START[bk]; k < end; k += 1) { const i = ORDER[k]; ctx.rect(PX[i] - hs, PY[i] - hs, sz, sz); }
      ctx.fill();
    }

    // ---- nerve pulses ----
    if (!reduced) {
      spawnIn -= dt;
      if (spawnIn <= 0) { spawn(pickRoute(), false); spawnIn = 0.55 + rand() * 0.5; }
    }
    for (const p of PULSES) {
      if (reduced && !p.alive) continue;
      if (!p.alive) continue;
      if (!reduced) p.d += p.speed * dt;
      const R = ROUTES[p.route];
      if (p.d > R.len + 0.12) { p.alive = false; continue; }
      const sprt = p.red ? glowFlag : glowInk;
      for (let k = 4; k >= 0; k -= 1) {
        const dd = p.d - k * 0.03;
        if (dd < 0 || dd > R.len) continue;
        routePoint(p.route, dd);
        proj(Q3[0], Q3[1], Q3[2]);
        const fade = (1 - k / 5) * (p.d > R.len ? 1 - (p.d - R.len) / 0.12 : 1);
        const sz = (k === 0 ? 16 : 9) * (cam.s0 / 360);
        ctx.globalAlpha = fade * (k === 0 ? 0.95 : 0.5);
        ctx.drawImage(sprt, P3[0] - sz / 2, P3[1] - sz / 2, sz, sz);
      }
    }
    ctx.globalAlpha = 1;

    // ---- beacons ----
    for (let r = 1; r <= 4; r += 1) {
      const A = ANCHOR[r];
      proj(A[0], A[1], A[2]);
      AP[r * 3] = P3[0]; AP[r * 3 + 1] = P3[1]; AP[r * 3 + 2] = P3[2];
    }
    // the multi-region pattern: a dashed line through the lit regions
    if (connectE > 0.02 && connect.length > 1) {
      ctx.setLineDash(DASH);
      ctx.lineDashOffset = reduced ? 0 : -t * 14;
      ctx.strokeStyle = STYLE[15];
      ctx.globalAlpha = connectE * 0.9;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let k = 0; k < connect.length; k += 1) {
        const r = connect[k];
        if (k === 0) ctx.moveTo(AP[r * 3], AP[r * 3 + 1]); else ctx.lineTo(AP[r * 3], AP[r * 3 + 1]);
      }
      ctx.stroke();
      ctx.setLineDash(NO_DASH);
      ctx.globalAlpha = 1;
    }
    const sc = clamp(cam.s0 / 360, 0.75, 1.25);
    for (let r = 1; r <= 4; r += 1) {
      const ax = AP[r * 3]; const ay = AP[r * 3 + 1];
      const L = litE[r]; const P = prevE[r];
      const box = 13 * sc;
      // crop marks around the region: faint when idle, ink on preview, red when flagged
      const idleA = 0.22 + 0.5 * P + 0.25 * spotE[r];
      ctx.lineWidth = 1;
      ctx.strokeStyle = STYLE[9];
      ctx.globalAlpha = idleA * (1 - L);
      cropMarks(ctx, ax, ay, box, 5 * sc);
      ctx.strokeStyle = STYLE[19];
      ctx.globalAlpha = L;
      cropMarks(ctx, ax, ay, box + 3 * L * sc, 5 * sc);
      ctx.globalAlpha = 1;
      if (L < 0.02) continue;
      // soft pulsing rings and a core
      const since = t - litAt[r];
      for (let j = 0; j < 2; j += 1) {
        const ph = reduced ? 0.45 + j * 0.3 : ((since * 0.62 + j * 0.5) % 1);
        ctx.strokeStyle = STYLE[17];
        ctx.globalAlpha = L * (1 - ph) * 0.7;
        ctx.beginPath();
        ctx.arc(ax, ay, (4 + ph * 22) * sc, 0, Math.PI * 2);
        ctx.stroke();
      }
      const g = 26 * sc;
      ctx.globalAlpha = L * 0.55;
      ctx.drawImage(glowFlag, ax - g / 2, ay - g / 2, g, g);
      ctx.globalAlpha = L;
      ctx.fillStyle = STYLE[19];
      ctx.beginPath();
      ctx.arc(ax, ay, 2.6 * sc, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // ---- labels: a mono plate with a leader line, like the reference's robot tags ----
    ctx.font = fontMono;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0.06em';
    ctx.textBaseline = 'middle';
    for (let r = 1; r <= 4; r += 1) {
      const L = litE[r];
      const lab = labels[r];
      if (L < 0.05 || !lab) continue;
      const ax = AP[r * 3]; const ay = AP[r * 3 + 1];
      const box = (13 + 3) * sc;
      const pw = Math.max(lab.wa, lab.wb) + 16;
      const ph = 36;
      // the plate stays within the stage (plus a little of the column gap) and the canvas
      const lo = Math.max(6, stage ? stage.x - 16 : 6);
      const hi = Math.min(w - 6, stage ? stage.x + stage.w + 16 : w - 6);
      // side: the preferred one (away from the body) when plate and leader fit there; the
      // other one only for the midline regions; otherwise below the marker.
      const want = LABEL_SIDE[r];
      const roomL = ax - box - lo; const roomR = hi - (ax + box);
      const need = pw + 10;
      let side = 0;
      if ((want < 0 ? roomL : roomR) >= need) side = want;
      else if (LABEL_FLIP[r] && (want < 0 ? roomR : roomL) >= need) side = -want;
      let px; let py;
      ctx.globalAlpha = L;
      ctx.strokeStyle = STYLE[16];
      ctx.lineWidth = 1;
      ctx.beginPath();
      if (side !== 0) {
        const lead = clamp((side < 0 ? roomL : roomR) - pw, 10, 18);
        px = side < 0 ? ax - box - lead - pw : ax + box + lead;
        px = clamp(px, lo, Math.max(lo, hi - pw));
        py = clamp(ay - ph / 2, 6, h - ph - 6);
        ctx.moveTo(side < 0 ? ax - box : ax + box, ay); ctx.lineTo(side < 0 ? px + pw : px, py + ph / 2);
      } else {
        // below the marker on a vertical leader (above it if there is no room below),
        // the plate shifted outward, away from the body
        const minX = Math.max(lo, ax - pw + 8);
        const maxX = Math.max(minX, Math.min(hi - pw, ax - 8));
        px = clamp(want < 0 ? ax - pw * 0.78 : ax - pw * 0.22, minX, maxX);
        const below = ay + box + 12 + ph <= h - 6;
        py = below ? ay + box + 12 : Math.max(6, ay - box - 12 - ph);
        ctx.moveTo(ax, below ? ay + box : ay - box); ctx.lineTo(ax, below ? py : py + ph);
      }
      ctx.stroke();
      ctx.fillStyle = pal.panel || '#1C1512';
      ctx.globalAlpha = L * 0.97; // near-opaque: on a narrow stage the plate can sit over the body's points
      ctx.fillRect(px, py, pw, ph);
      ctx.globalAlpha = L;
      ctx.strokeStyle = STYLE[2];
      ctx.strokeRect(px + 0.5, py + 0.5, pw - 1, ph - 1);
      ctx.fillStyle = STYLE[9];
      ctx.fillText(lab.a, px + 8, py + 11);
      ctx.fillStyle = STYLE[19];
      ctx.fillText(lab.b, px + 8, py + 25);
      ctx.globalAlpha = 1;
    }
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  }

  function cropMarks(ctx, x, y, s, a) {
    ctx.beginPath();
    ctx.moveTo(x - s, y - s + a); ctx.lineTo(x - s, y - s); ctx.lineTo(x - s + a, y - s);
    ctx.moveTo(x + s - a, y - s); ctx.lineTo(x + s, y - s); ctx.lineTo(x + s, y - s + a);
    ctx.moveTo(x + s, y + s - a); ctx.lineTo(x + s, y + s); ctx.lineTo(x + s - a, y + s);
    ctx.moveTo(x - s + a, y + s); ctx.lineTo(x - s, y + s); ctx.lineTo(x - s, y + s - a);
    ctx.stroke();
  }

  const fx = createEffect(canvas, { setup, draw, interactive: true, maxDpr: 2, pointerTarget: opts.pointerTarget });
  // A few pulses already on their way, so the first (or the only, reduced-motion) frame shows them.
  [[0, 0.62], [3, 0.95], [5, 0.3], [1, 1.1]].forEach(([route, d], k) => { const p = PULSES[k]; p.alive = true; p.route = route; p.d = d; p.speed = 0.7; });
  if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => { labelsDirty = true; fx.renderOnce(); }).catch(() => {});
  }

  return {
    state: fx.state,
    renderOnce: fx.renderOnce,
    // rect of the free area for the figure, in px relative to the canvas
    setStage(rect) { stage = rect; layout(fx.state); fx.renderOnce(); },
    // flags: { arm: ['WASTING', ...], leg: [...], bulbar: [...], breathing: [...] }
    // names: { arm: 'HAND', ... }; joined: regions the multi-region rule joins (or [])
    setFlags(flags, names, joined = []) {
      for (const key of FIGURE_REGIONS) {
        const r = REGION_INDEX[key];
        const list = (flags && flags[key]) || [];
        const on = list.length > 0 ? 1 : 0;
        if (on && !lit[r]) { litAt[r] = fx.state.t; if (!fx.state.reduced) spawn(ROUTE_OF[key], true); }
        lit[r] = on;
        labels[r] = on ? { a: (names && names[key]) || key.toUpperCase(), b: list.length > 1 ? `${list[0]} +${list.length - 1}` : list[0], wa: 0, wb: 0 } : null;
      }
      connect = (joined || []).map((k) => REGION_INDEX[k]).filter(Boolean);
      labelsDirty = true;
      fx.renderOnce();
    },
    setPreview(region) { for (let r = 1; r <= 4; r += 1) prev[r] = 0; if (REGION_INDEX[region]) prev[REGION_INDEX[region]] = 1; if (fx.state.reduced) fx.renderOnce(); },
    setSpot(region) { for (let r = 1; r <= 4; r += 1) spot[r] = 0; if (REGION_INDEX[region]) spot[REGION_INDEX[region]] = 1; if (fx.state.reduced) fx.renderOnce(); },
    pulse(region) { if (ROUTE_OF[region] != null && !fx.state.reduced) spawn(ROUTE_OF[region], true); },
    destroy() { fx.destroy(); },
  };
}

export const FIGURE_POINTS = () => buildBody().n;
