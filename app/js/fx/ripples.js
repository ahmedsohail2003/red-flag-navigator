// Ice water for the Ice Bucket Challenge band on the overview. Plain Canvas 2D, no libraries.
// The surface is a low-resolution height field (the 2D wave equation) drawn the way the
// reference draws its 3D: horizontal scanlines receding to a horizon. Rows are spaced in
// perspective, so a ripple near you is big and quick and one far away is small and slow.
// Slopes that face you catch ice-blue light. The pointer leaves gentle ripples; a click on
// the water drops a large 3D ice cube (translucent faces, a brighter top with a cream edge,
// a soft shadow where it meets the water) that splashes, floats and bobs. At most 3 cubes:
// the oldest melts away. Idle: an occasional drip.
// Cost: the canvas renders at DPR 1 (the water is a soft texture); the 64 water rows are
// stroked as a handful of paths in solid alpha buckets, the left-side fade is one
// destination-in fill per frame, and the simulation sleeps once the surface has settled.
// Reduced motion: one still frame with the floating cubes and frozen rings, no loop.
// Decorative: the canvas is aria-hidden and the band's text carries the information.
import { createEffect, palette, rgba, clamp, rng } from './core.js';

const NOT_WATER = 'a,button,input,select,textarea,label,summary,[data-no-drop]';
const MAX_DROPLETS = 96;
const NB = 6; // alpha buckets for the water rows
const DEG = Math.PI / 180;
// cube corners (bit 0: x, bit 1: y, bit 2: z) and faces with their outward normal axis
const FACES = [
  [1, 3, 7, 5, 0, 1], [0, 4, 6, 2, 0, -1], // +x, -x  (last two: axis, sign)
  [2, 6, 7, 3, 1, 1], [0, 1, 5, 4, 1, -1], // +y (top), -y
  [4, 5, 7, 6, 2, 1], [0, 2, 3, 1, 2, -1], // +z, -z
];
const byDepth = (a, b) => b.Z - a.Z;
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

export function createRipples(canvas, opts = {}) {
  const host = opts.pointerTarget || canvas.parentElement || canvas;
  const noDrop = opts.noDrop || NOT_WATER;
  const rand = rng(20140729); // seeded: the same calm scene on every load
  const g = {};
  let H = null, V = null, K = null, SX = null, SY = null, LV = null, RAMP = null, DF = null;
  let ROWS = null, rowStyle = null, rowWidth = null, FADE = null, SHADOW = null;
  let pal = null, hiStyle = null, iceFill = '', iceEdge = '', topEdge = '', ringStyle = '', dropStyle = '';
  let calm = false, settleN = 0; // the simulation sleeps while the surface is flat
  const cubes = [];
  const rings = [];
  const P = new Float32Array(MAX_DROPLETS * 7); // x, y, z, vx, vy, vz, alive (world units)
  const CW = new Float32Array(24); // cube corners, world
  const CS = new Float32Array(16); // cube corners, screen
  const squares = [];
  const queue = [];
  let lastPx = -1, lastPy = -1, idleSince = 0, nextDrip = 1.2, nextIdleCube = 8, simAcc = 0;
  let fx = null;

  // ---------- geometry ----------
  function layout(w, h) {
    const phone = w < 640;
    g.phone = phone;
    g.maxCubes = 3;
    g.col = phone ? 10 : 8;
    g.NX = Math.ceil(w / g.col) + 3;
    g.x0 = (w - (g.NX - 1) * g.col) / 2;
    g.cx = w / 2;
    g.NZ = phone ? 40 : 64;
    g.hy = opts.horizon ? opts.horizon(w, h) : (phone ? Math.max(h * 0.52, h - 290) : h * 0.34);
    g.o0 = h - g.hy + 14;                       // nearest row: just below the bottom edge
    g.oEnd = Math.max(16, g.o0 * 0.075);        // farthest row, just under the horizon
    g.r = Math.pow(g.o0 / g.oEnd, 1 / (g.NZ - 1));
    g.lr = Math.log(g.r);
    g.f = g.o0 / Math.tan(34 * DEG);            // the bottom edge is 34 degrees below the horizon
    g.camH = g.o0 / g.f;                        // nearest row at depth 1
    const aspect = (g.r - 1) * g.f / g.col;     // world depth of a row / world width of a column
    g.wz = 1 / (aspect * aspect);
    g.k0 = Math.min(0.34, 0.85 / (1 + g.wz));
    g.cube = (phone ? 84 : 110) / g.f;          // a near cube is about 110 px (84 on a phone)
    const N = g.NX * g.NZ;
    H = new Float32Array(N); V = new Float32Array(N);
    SX = new Float32Array(N); SY = new Float32Array(N); LV = new Uint8Array(N);
    K = new Float32Array(g.NZ); DF = new Float32Array(g.NZ); RAMP = new Float32Array(g.NX);
    for (let j = 0; j < g.NZ; j++) {
      const Z = Math.pow(g.r, j);
      K[j] = g.k0 / (Z * Z);                    // perspective: far water moves slower on screen
      const u = j / (g.NZ - 1);
      DF[j] = Math.pow(1 - u, 1.25);
    }
    // quieter under the text: from the copy's right edge (opts.textEdge, canvas px) or 0.5 w
    let edge = w * 0.5;
    try { const e = opts.textEdge ? Number(opts.textEdge()) : NaN; if (Number.isFinite(e) && e > 0) edge = clamp(e, w * 0.25, w * 0.75); } catch { /* keep the default */ }
    g.fadeA = clamp(edge - 160, 0, w); g.fadeB = clamp(edge + 110, g.fadeA + 1, w);
    for (let i = 0; i < g.NX; i++) {
      const x = g.x0 + i * g.col;
      RAMP[i] = phone ? 1 : 0.2 + 0.8 * smoothstep(g.fadeA, g.fadeB, x);
    }
  }

  function styles(ctx, w) {
    pal = palette();
    const base = pal.panelInk2 || '#CDBDB0';
    // Each row's alpha (far rows fainter), quantised into NB buckets of neighbouring rows:
    // one path per bucket, in a solid colour, instead of one gradient stroke per row.
    const aOf = (j) => 0.02 + 0.5 * Math.pow(1 - j / (g.NZ - 1), 1.3);
    const a0 = aOf(g.NZ - 1), a1 = aOf(0);
    ROWS = Array.from({ length: NB }, () => []);
    const sumA = new Float32Array(NB), sumW = new Float32Array(NB);
    for (let j = g.NZ - 1; j >= 0; j--) {
      const b = Math.min(NB - 1, Math.floor(((aOf(j) - a0) / (a1 - a0)) * NB));
      ROWS[b].push(j); sumA[b] += aOf(j); sumW[b] += 0.8 + 0.6 * DF[j];
    }
    rowStyle = ROWS.map((r, b) => rgba(base, r.length ? sumA[b] / r.length : 0));
    rowWidth = ROWS.map((r, b) => (r.length ? sumW[b] / r.length : 1));
    // the water is quieter under the text: one destination-in fill per frame (not on a phone)
    FADE = null;
    if (!g.phone) {
      FADE = ctx.createLinearGradient(0, 0, w, 0);
      FADE.addColorStop(0, 'rgba(0,0,0,0.22)');
      FADE.addColorStop(g.fadeA / w, 'rgba(0,0,0,0.22)');
      FADE.addColorStop(g.fadeB / w, 'rgba(0,0,0,1)');
      FADE.addColorStop(1, 'rgba(0,0,0,1)');
    }
    const ice = pal.panelAccent || '#8EC6E8';
    hiStyle = [null, rgba(ice, 0.26), rgba(ice, 0.55), rgba(ice, 0.92)];
    ringStyle = ice;
    dropStyle = rgba(pal.panelInk || '#F6EEE5', 0.8);
    // translucent ice: faces filled in ice blue at low alpha, a brighter top, a cream top edge
    iceFill = ice;
    iceEdge = rgba(ice, 0.3);
    topEdge = pal.panelInk || '#F6EEE5';
    // a soft dark shadow where the ice meets the water (unit radius; scaled per cube)
    SHADOW = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    SHADOW.addColorStop(0, 'rgba(6,4,3,0.62)');
    SHADOW.addColorStop(0.55, 'rgba(6,4,3,0.34)');
    SHADOW.addColorStop(1, 'rgba(6,4,3,0)');
  }

  // ---------- water ----------
  const idx = (i, j) => j * g.NX + i;
  // grid position (fractional) under a canvas point; null above the water
  function toGrid(x, y, clampFar = false) {
    let o = y - g.hy;
    if (o < g.oEnd) { if (!clampFar) return null; o = g.oEnd; }
    let gj = Math.log(g.o0 / o) / g.lr;
    gj = clamp(gj, 0, g.NZ - 1);
    const Z = Math.pow(g.r, gj);
    const gi = (x - g.x0 - g.parX / Z) / g.col;
    if (gi < 1 || gi > g.NX - 2) return null;
    return { gi, gj };
  }
  function bump(gi, gj, amp, rad) {
    calm = false; settleN = 0;
    const rz = Math.max(1, rad * Math.sqrt(g.wz) * 1.6);
    const i0 = Math.max(1, Math.floor(gi - rad)), i1 = Math.min(g.NX - 2, Math.ceil(gi + rad));
    const j0 = Math.max(1, Math.floor(gj - rz)), j1 = Math.min(g.NZ - 2, Math.ceil(gj + rz));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const dx = (i - gi) / rad, dz = (j - gj) / rz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= 1) continue;
        const fall = (1 - d2) * (1 - d2);
        H[idx(i, j)] += amp * fall;
      }
    }
  }
  function step() {
    const NX = g.NX, NZ = g.NZ, wz = g.wz;
    for (let j = 1; j < NZ - 1; j++) {
      const kj = K[j];
      const edge = j < 4 ? 0.9 : 0.988; // a soft sponge along the near edge: no echo
      let p = j * NX + 1;
      for (let i = 1; i < NX - 1; i++, p++) {
        const c = H[p];
        const lap = (H[p - 1] + H[p + 1] - 2 * c) + wz * (H[p - NX] + H[p + NX] - 2 * c);
        V[p] = (V[p] + kj * lap) * (i < 3 || i > NX - 4 ? 0.9 : edge);
      }
    }
    for (let p = 0; p < H.length; p++) H[p] = (H[p] + V[p]) * 0.9995;
  }
  // flat enough to stop simulating: every point within 0.3 px of rest at the nearest row
  function settled() {
    const hMax = 0.3 / g.f, vMax = 0.01 / g.f;
    for (let p = 0; p < H.length; p++) if (H[p] > hMax || H[p] < -hMax || V[p] > vMax || V[p] < -vMax) return false;
    return true;
  }
  function heightAt(gi, gj) {
    const i = clamp(Math.floor(gi), 0, g.NX - 2), j = clamp(Math.floor(gj), 0, g.NZ - 2);
    const fx1 = clamp(gi - i, 0, 1), fz = clamp(gj - j, 0, 1);
    const a = H[idx(i, j)], b = H[idx(i + 1, j)], c = H[idx(i, j + 1)], d = H[idx(i + 1, j + 1)];
    return (a * (1 - fx1) + b * fx1) * (1 - fz) + (c * (1 - fx1) + d * fx1) * fz;
  }

  // ---------- ice ----------
  function addCube(u, v, falling) {
    const live = cubes.filter((c) => c.state !== 'melt');
    if (live.length >= g.maxCubes) live[0].state = 'melt';
    const gi = u * (g.NX - 1), gj = v * (g.NZ - 1);
    const Z = Math.pow(g.r, gj);
    const size = g.cube * Math.pow(Z, 0.5);
    cubes.push({
      u, v, size, Z,
      y: falling ? g.camH * 0.95 + rand() * 0.1 : heightAt(gi, gj) + size * 0.16,
      vy: 0, yaw: rand() * Math.PI, spin: falling ? 1.6 + rand() * 1.2 : 0.18,
      pitch: falling ? (rand() - 0.5) * 0.8 : 0, roll: falling ? (rand() - 0.5) * 0.8 : 0,
      du: (rand() - 0.5) * 0.006, dv: (rand() - 0.5) * 0.004,
      state: falling ? 'fall' : 'float', age: rand() * 6, life: 1,
    });
  }
  function splash(c, strength) {
    const gi = c.u * (g.NX - 1), gj = c.v * (g.NZ - 1);
    bump(gi, gj, -0.024 * strength, 3.5);
    rings.push({ u: c.u, v: c.v, t: 0 }, { u: c.u, v: c.v, t: -0.14 });
    if (rings.length > 24) rings.splice(0, rings.length - 24);
    const X = (g.x0 + gi * g.col - g.cx) * c.Z / g.f;
    let n = 0;
    for (let k = 0; k < MAX_DROPLETS && n < 12; k++) {
      const o = k * 7;
      if (P[o + 6] > 0) continue;
      const a = rand() * Math.PI * 2, sp = (0.15 + rand() * 0.25) * c.size * 5;
      P[o] = X; P[o + 1] = heightAt(gi, gj); P[o + 2] = c.Z;
      P[o + 3] = Math.cos(a) * sp; P[o + 4] = (0.7 + rand() * 0.8) * c.size * 4.6 * strength; P[o + 5] = Math.sin(a) * sp * c.Z * 0.6;
      P[o + 6] = 1; n += 1;
    }
  }
  function updateCubes(dt) {
    for (let k = cubes.length - 1; k >= 0; k--) {
      const c = cubes[k];
      c.age += dt;
      c.u = clamp(c.u + c.du * dt, 0.05, 0.95);
      c.v = clamp(c.v + c.dv * dt, 0.03, 0.6);
      if (c.u <= 0.05 || c.u >= 0.95) c.du = -c.du;
      if (c.v <= 0.03 || c.v >= 0.6) c.dv = -c.dv;
      const gi = c.u * (g.NX - 1), gj = c.v * (g.NZ - 1);
      c.Z = Math.pow(g.r, gj);
      const surf = heightAt(gi, gj);
      c.yaw += c.spin * dt;
      if (c.state === 'fall') {
        c.vy -= 2.6 * dt;
        c.y += c.vy * dt;
        if (c.y - c.size * 0.3 <= surf) {
          splash(c, clamp(-c.vy / 1.6, 0.5, 1.3));
          c.state = 'float';
          c.vy *= 0.12;
        }
      } else {
        const sx = (heightAt(gi + 1, gj) - heightAt(gi - 1, gj)) * g.f / (2 * g.col * c.Z);
        const sz = (heightAt(gi, gj + 1) - heightAt(gi, gj - 1)) / (2 * c.Z * (g.r - 1));
        const target = surf + c.size * (0.16 + 0.05 * Math.sin(c.age * 1.6 + k));
        c.vy += ((target - c.y) * 30 - c.vy * 6) * dt;
        c.y += c.vy * dt;
        c.pitch += (clamp(sz * 0.8, -0.35, 0.35) + 0.06 * Math.sin(c.age * 1.3) - c.pitch) * Math.min(1, dt * 3);
        c.roll += (clamp(-sx * 0.8, -0.35, 0.35) + 0.05 * Math.sin(c.age * 1.1 + 1) - c.roll) * Math.min(1, dt * 3);
        c.spin += (0.14 - c.spin) * Math.min(1, dt * 0.8);
        if (c.state === 'melt') {
          c.life -= dt / 1.4;
          if (c.life <= 0) cubes.splice(k, 1);
        }
      }
    }
  }

  // ---------- scene ----------
  function initScene(st) {
    cubes.length = 0; rings.length = 0; P.fill(0);
    // two or three cubes in the nearest third of the water, right of the text on a desktop
    const seeds = g.phone ? [[0.3, 0.07], [0.74, 0.17]] : [[0.74, 0.05], [0.9, 0.17], [0.67, 0.19]];
    for (const [u, v] of seeds) {
      addCube(u, v, false);
      bump(u * (g.NX - 1), v * (g.NZ - 1), -0.012, 2.6);
    }
    for (let s = 0; s < 70; s++) step();
    for (const c of cubes) { c.y = heightAt(c.u * (g.NX - 1), c.v * (g.NZ - 1)) + c.size * 0.16; c.vy = 0; }
    idleSince = st.t; nextDrip = st.t + 1.2; nextIdleCube = st.t + 9;
    squares.length = 0;
    for (let k = 0; k < 5; k++) squares.push({ i: 0, j: 0, ph: rand() * 6, sp: 0.25 + rand() * 0.35, born: -1 });
  }

  function project(X, Y, Z, out, o) {
    const s = g.f / Z;
    out[o] = g.cx + X * s + g.parX / Z;
    out[o + 1] = g.hy + (g.camH - Y) * s + g.parY / Z;
  }

  function drawCube(ctx, c) {
    const gi = c.u * (g.NX - 1);
    const Z = c.Z;
    const X = (g.x0 + gi * g.col - g.cx) * Z / g.f;
    const half = c.size * 0.5 * (c.state === 'melt' ? Math.max(0.05, c.life) : 1);
    const cy = Math.cos(c.yaw), sy = Math.sin(c.yaw);
    const cp = Math.cos(c.pitch), sp = Math.sin(c.pitch);
    const cr = Math.cos(c.roll), sr = Math.sin(c.roll);
    for (let k = 0; k < 8; k++) {
      let x = (k & 1 ? 1 : -1) * half, y = (k & 2 ? 1 : -1) * half, z = (k & 4 ? 1 : -1) * half;
      // roll (z), pitch (x), yaw (y)
      let x1 = x * cr - y * sr, y1 = x * sr + y * cr; x = x1; y = y1;
      y1 = y * cp - z * sp; let z1 = y * sp + z * cp; y = y1; z = z1;
      x1 = x * cy + z * sy; z1 = -x * sy + z * cy; x = x1; z = z1;
      CW[k * 3] = X + x; CW[k * 3 + 1] = c.y + y; CW[k * 3 + 2] = Z + z;
      project(CW[k * 3], CW[k * 3 + 1], CW[k * 3 + 2], CS, k * 2);
    }
    // waterline: everything below the surface at the cube is hidden
    const sxW = g.cx + X * g.f / Z + g.parX / Z;
    const wy = g.hy + (g.camH - heightAt(gi, c.v * (g.NZ - 1))) * g.f / Z + g.parY / Z;
    const alpha = c.state === 'melt' ? Math.max(0, c.life) : 1;
    // a soft dark shadow where the ice meets the water; the ripples show the waterline
    if (c.state !== 'fall') {
      const rx = half * 1.75 * g.f / Z;
      const ry = Math.max(2, rx * (g.camH / Z) * 0.9);
      ctx.save();
      ctx.translate(sxW, wy);
      ctx.scale(rx, ry);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = SHADOW;
      ctx.beginPath();
      ctx.arc(0, 0, 1, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(-100000, -100000, 200000, wy + 100000);
    ctx.clip();
    let top = -1;
    for (let fi = 0; fi < 6; fi++) {
      const F = FACES[fi];
      // face normal = (corner centroid - cube centre); visible if it faces the camera
      let nx = 0, ny = 0, nz = 0;
      for (let q = 0; q < 4; q++) { nx += CW[F[q] * 3]; ny += CW[F[q] * 3 + 1]; nz += CW[F[q] * 3 + 2]; }
      nx = nx / 4 - X; ny = ny / 4 - c.y; nz = nz / 4 - Z;
      const vx = X + nx, vy = c.y + ny - g.camH, vz = Z + nz; // camera at (0, camH, 0)
      if (nx * vx + ny * vy + nz * vz >= 0) continue;
      const len = Math.hypot(nx, ny, nz) || 1;
      const lit = clamp((nx * -0.35 + ny * 0.85 + nz * -0.4) / len, 0, 1);
      const isTop = ny / len > 0.6;
      if (isTop) top = fi;
      facePath(ctx, F);
      // translucent ice: the sides at 0.08 to 0.16 alpha by the light, the top brighter
      ctx.globalAlpha = alpha * (isTop ? 0.24 : 0.08 + 0.08 * lit);
      ctx.fillStyle = iceFill;
      ctx.fill();
      if (!isTop) {
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = iceEdge;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
    // a cream highlight along the top edges
    if (top >= 0) {
      facePath(ctx, FACES[top]);
      ctx.globalAlpha = alpha * 0.8;
      ctx.strokeStyle = topEdge;
      ctx.lineWidth = 1.25;
      ctx.lineJoin = 'round';
      ctx.stroke();
    }
    ctx.restore();
  }
  function facePath(ctx, F) {
    ctx.beginPath();
    ctx.moveTo(CS[F[0] * 2], CS[F[0] * 2 + 1]);
    for (let q = 1; q < 4; q++) ctx.lineTo(CS[F[q] * 2], CS[F[q] * 2 + 1]);
    ctx.closePath();
  }

  function draw(ctx, st) {
    const { w, h } = st;
    const dt = Math.min(0.05, st.dt || 0.016);
    g.parX = st.reduced ? 0 : st.mouse.nx * 16;
    g.parY = st.reduced ? 0 : st.mouse.ny * 5;

    // --- input: drops and pointer wake ---
    while (queue.length) {
      const q = queue.shift();
      const p = toGrid(q.x, q.y, true);
      if (!p) continue;
      const u = clamp(p.gi / (g.NX - 1), 0.05, 0.95);
      const v = clamp(p.gj / (g.NZ - 1), 0.03, 0.58);
      addCube(u, v, !st.reduced);
      if (st.reduced) {
        const c = cubes[cubes.length - 1];
        bump(u * (g.NX - 1), v * (g.NZ - 1), -0.012, 2.6);
        for (let s = 0; s < 40; s++) step();
        c.y = heightAt(u * (g.NX - 1), v * (g.NZ - 1)) + c.size * 0.16;
        for (let k = cubes.length - 1; k >= 0; k--) if (cubes[k].state === 'melt') cubes.splice(k, 1);
      }
      idleSince = st.t;
    }
    if (!st.reduced) {
      const m = st.mouse;
      if (m.inside) {
        if (lastPx >= 0) {
          const dx = m.px - lastPx, dy = m.py - lastPy;
          const d = Math.hypot(dx, dy);
          if (d > 2) {
            const n = Math.min(6, Math.ceil(d / 14));
            const amp = -Math.min(0.0045, d * 0.00012) / n * 2;
            for (let k = 1; k <= n; k++) {
              const p = toGrid(lastPx + (dx * k) / n, lastPy + (dy * k) / n);
              if (p) bump(p.gi, p.gj, amp, 2.2);
            }
            idleSince = st.t;
          }
        }
        lastPx = m.px; lastPy = m.py;
      } else { lastPx = -1; }
      // idle: a drip now and then, and a fresh cube once in a while
      if (st.t > nextDrip) {
        const u = g.phone ? 0.1 + rand() * 0.8 : 0.45 + rand() * 0.5, v = 0.05 + rand() * 0.45;
        bump(u * (g.NX - 1), v * (g.NZ - 1), -0.011, 1.8);
        rings.push({ u, v, t: 0.15 });
        nextDrip = st.t + 2.4 + rand() * 2.2;
      }
      if (st.t - idleSince > 10 && st.t > nextIdleCube) {
        if (cubes.filter((c) => c.state !== 'melt').length < g.maxCubes) addCube(g.phone ? 0.2 + rand() * 0.6 : 0.5 + rand() * 0.42, 0.08 + rand() * 0.4, true);
        nextIdleCube = st.t + 9 + rand() * 5;
      }
      // fixed 60 Hz simulation; it sleeps once the surface has settled between drips
      simAcc = Math.min(simAcc + dt, 0.05);
      if (calm) simAcc = 0;
      while (simAcc >= 1 / 60) { step(); simAcc -= 1 / 60; }
      if (!calm && ++settleN % 20 === 0) calm = settled();
      updateCubes(dt);
    }

    ctx.clearRect(0, 0, w, h);

    // --- the water: project every vertex, find the lit slopes ---
    const NX = g.NX, NZ = g.NZ, t = st.reduced ? 2.0 : st.t;
    const invC = g.f / (2 * g.col), invR = 1 / (2 * (g.r - 1));
    for (let j = 0; j < NZ; j++) {
      const Z = Math.pow(g.r, j);
      const sc = g.f / Z;
      const yb = g.hy + g.camH * sc + g.parY / Z;
      const xs = g.parX / Z;
      const df = DF[j];
      let p = j * NX;
      for (let i = 0; i < NX; i++, p++) {
        const xi = g.x0 + i * g.col;
        const X = (xi - g.cx) / sc;
        const swell = 0.0032 * Math.sin(X * 7 + Z * 4.2 + t * 0.7) + 0.0022 * Math.sin(X * -4.1 + Z * 7.5 + t * 0.52);
        SX[p] = xi + xs;
        SY[p] = yb - (H[p] + swell) * sc;
        let lv = 0;
        if (i > 0 && i < NX - 1 && j > 0 && j < NZ - 1) {
          const sx = (H[p + 1] - H[p - 1]) * invC / Z;
          const sz = (H[p + NX] - H[p - NX]) * invR / Z;
          const I = (sz * 1.0 - sx * 0.45) * 32 * RAMP[i] * (0.4 + 0.6 * df);
          lv = I > 0.8 ? 3 : I > 0.42 ? 2 : I > 0.16 ? 1 : 0;
        }
        LV[p] = lv;
      }
    }
    // the rows: one path per alpha bucket
    for (let b = 0; b < NB; b++) {
      const rows = ROWS[b];
      if (!rows.length) continue;
      ctx.lineWidth = rowWidth[b];
      ctx.strokeStyle = rowStyle[b];
      ctx.beginPath();
      for (let q = 0; q < rows.length; q++) {
        let p = rows[q] * NX;
        ctx.moveTo(SX[p], SY[p]);
        for (let i = 1; i < NX; i++) { p++; ctx.lineTo(SX[p], SY[p]); }
      }
      ctx.stroke();
    }
    // quieter under the text: fade the rows drawn so far, once
    if (FADE) {
      ctx.globalCompositeOperation = 'destination-in';
      ctx.fillStyle = FADE;
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'source-over';
    }
    // --- the reference's flickering grid squares, in the sky ---
    if (!st.reduced && pal) {
      ctx.fillStyle = pal.panelInk || '#F6EEE5';
      for (let k = 0; k < squares.length; k++) {
        const s = squares[k];
        const a = Math.sin(st.t * s.sp + s.ph);
        if (a <= 0) { s.born = -1; continue; }
        if (s.born < 0) {
          s.born = 1;
          s.i = Math.floor((g.phone ? rand() : 0.5 + rand() * 0.5) * (w / 28));
          s.j = Math.floor(rand() * Math.max(1, (g.hy - 28) / 28));
        }
        ctx.globalAlpha = a * 0.045;
        ctx.fillRect(s.i * 28, s.j * 28, 27, 27);
      }
      ctx.globalAlpha = 1;
    }
    for (let L = 1; L <= 3; L++) {
      ctx.strokeStyle = hiStyle[L];
      ctx.lineWidth = L === 3 ? 1.5 : 1.1;
      ctx.beginPath();
      let any = false;
      for (let j = 1; j < NZ - 1; j++) {
        let p = j * NX;
        for (let i = 0; i < NX - 1; i++, p++) {
          if (LV[p] !== L) continue;
          ctx.moveTo(SX[p], SY[p]);
          ctx.lineTo(SX[p + 1], SY[p + 1]);
          any = true;
        }
      }
      if (any) ctx.stroke();
    }

    // --- splash rings ---
    for (let k = rings.length - 1; k >= 0; k--) {
      const r = rings[k];
      if (!st.reduced) r.t += dt;
      if (r.t < 0) continue;
      const life = 1.5;
      if (r.t > life) { rings.splice(k, 1); continue; }
      const gi = r.u * (g.NX - 1), gj = r.v * (g.NZ - 1);
      const Z = Math.pow(g.r, gj);
      const X = (g.x0 + gi * g.col - g.cx) * Z / g.f;
      const sx = g.cx + X * g.f / Z + g.parX / Z;
      const sy = g.hy + (g.camH - heightAt(gi, gj)) * g.f / Z + g.parY / Z;
      const rx = (0.012 + r.t * 0.13) * g.f / Z * Math.pow(Z, 0.5);
      const ry = rx * (g.camH / Z) * 0.9;
      ctx.globalAlpha = Math.pow(1 - r.t / life, 1.4) * 0.9;
      ctx.strokeStyle = ringStyle;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.ellipse(sx, sy, rx, Math.max(1, ry), 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // --- ice cubes, far to near ---
    cubes.sort(byDepth);
    st.data.cubes = cubes.length; // for tests
    for (let k = 0; k < cubes.length; k++) drawCube(ctx, cubes[k]);

    // --- droplets ---
    ctx.fillStyle = dropStyle;
    for (let k = 0; k < MAX_DROPLETS; k++) {
      const o = k * 7;
      if (P[o + 6] <= 0) continue;
      if (!st.reduced) {
        P[o + 4] -= 2.4 * dt;
        P[o] += P[o + 3] * dt; P[o + 1] += P[o + 4] * dt; P[o + 2] += P[o + 5] * dt;
        if (P[o + 1] < -0.002 || P[o + 2] < 0.9) { P[o + 6] = 0; continue; }
      }
      const s = g.f / P[o + 2];
      const x = g.cx + P[o] * s + g.parX / P[o + 2];
      const y = g.hy + (g.camH - P[o + 1]) * s + g.parY / P[o + 2];
      const d = Math.max(1, 2.2 / Math.sqrt(P[o + 2]));
      ctx.fillRect(x - d / 2, y - d / 2, d, d);
    }
  }

  // A click (a tap, not the start of a scroll or a text selection) drops a cube.
  const onTap = (e) => {
    if (e.button !== 0 || !fx) return;
    if (e.target instanceof Element && e.target.closest(noDrop)) return;
    if (typeof opts.canDrop === 'function' && !opts.canDrop(e)) return; // e.g. not on the text
    const r = canvas.getBoundingClientRect();
    queue.push({ x: e.clientX - r.left, y: e.clientY - r.top });
    if (queue.length > 4) queue.shift();
    if (fx.state.reduced) fx.renderOnce();
  };
  host.addEventListener('click', onTap);

  fx = createEffect(canvas, {
    interactive: true,
    pointerTarget: host,
    maxDpr: opts.maxDpr || 1, // a soft texture: DPR 1 keeps the software-raster cost down
    setup(ctx, st) {
      const keep = cubes.map((c) => ({ u: c.u, v: c.v }));
      layout(st.w, st.h);
      g.parX = 0; g.parY = 0;
      styles(ctx, st.w);
      initScene(st);
      // a resize keeps the cubes the visitor dropped
      if (keep.length > (g.phone ? 2 : 3)) {
        cubes.length = 0;
        for (const k of keep.slice(-g.maxCubes)) addCube(k.u, k.v, false);
      }
    },
    draw,
  });

  return {
    state: fx.state,
    renderOnce: fx.renderOnce, // one frame now (tests and still frames)
    // drop a cube at a canvas point (used by tests and keyboard demos)
    drop(x, y) { queue.push({ x, y }); if (fx.state.reduced) fx.renderOnce(); },
    destroy() {
      host.removeEventListener('click', onTap);
      fx.destroy();
      cubes.length = 0; rings.length = 0; queue.length = 0;
    },
  };
}
