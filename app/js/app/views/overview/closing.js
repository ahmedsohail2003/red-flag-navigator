// Overview closing band: the last call to action over a calm "signal trace" canvas.
// Four faint traces, one per body region (hand, foot, voice, breathing), carry small
// pulses from the left. Toward the right they merge into one line, where the pulses
// add up: the red flags read together. The traces bend toward the mouse.
// Decorative only (aria-hidden): the headline says the same thing in words.
import { esc, ensureCss, TIER } from '../../ui.js';
import { ALEX } from '../../../alex.js';
import { createEffect, palette, rgba, clamp, smooth, rng } from '../../../fx/core.js';

const TRACES = ['HAND', 'FOOT', 'VOICE', 'BREATHING'];
// 'Refer for EMG' -> 'refer for EMG' (only the first letter, so acronyms stay intact)
const lower1 = (s) => String(s).charAt(0).toLowerCase() + String(s).slice(1);
const STEP = 5; // px between samples

function traceEffect(canvas, pointerTarget) {
  const rand = rng(23);
  // two pulses per trace; position = (t * speed + phase) mod period
  const PULSES = TRACES.map(() => [0, 1].map(() => ({ speed: 64 + rand() * 34, phase: rand() * 1600, amp: 6 + rand() * 3 })));
  let Y = []; // per trace sample y
  let OWN = []; // per trace pulse offsets
  let M = 0;
  let grad = [];
  let pal = null;
  let inkLine = '';
  let flagLine = '';
  let labelInk = '';
  let glow = null;
  let bendE = 0;
  const lay = { y0: [], yM: 0, xa: 0, xb: 0, wd: 9, period: 1 };

  function setup(ctx, state) {
    pal = palette();
    const ink = pal.panelInk || '#F6EEE5';
    const flag = pal.panelFlag || '#F2876E';
    const { w, h } = state;
    M = Math.ceil(w / STEP) + 2;
    Y = TRACES.map(() => new Float32Array(M));
    OWN = TRACES.map(() => new Float32Array(M));
    const spread = clamp(h * 0.062, 18, 36);
    lay.yM = h * (w < 720 ? 0.84 : 0.8);
    lay.y0 = TRACES.map((_, i) => lay.yM + (i - 1.5) * spread);
    lay.xa = w * 0.14;
    lay.xb = w * (w < 720 ? 0.8 : 0.64);
    lay.period = w + 420;
    grad = TRACES.map(() => {
      const g = ctx.createLinearGradient(0, 0, w, 0);
      g.addColorStop(0, rgba(ink, 0.04));
      g.addColorStop(0.16, rgba(ink, 0.2));
      g.addColorStop(Math.min(0.95, lay.xb / w), rgba(ink, 0.34));
      g.addColorStop(1, rgba(ink, 0.12));
      return g;
    });
    inkLine = rgba(ink, 0.5);
    flagLine = rgba(flag, 0.95);
    labelInk = rgba(pal.panelInk3 || '#A08E80', 0.9);
    if (!glow) {
      glow = document.createElement('canvas');
      glow.width = 48; glow.height = 48;
      const g = glow.getContext('2d');
      const r = g.createRadialGradient(24, 24, 0, 24, 24, 24);
      r.addColorStop(0, rgba(flag, 0.9)); r.addColorStop(0.3, rgba(flag, 0.35)); r.addColorStop(1, rgba(flag, 0));
      g.fillStyle = r; g.fillRect(0, 0, 48, 48);
    }
  }

  function draw(ctx, state) {
    const { w, h, reduced } = state;
    const t = reduced ? 6.5 : state.t;
    ctx.clearRect(0, 0, w, h);
    if (!M) return;
    bendE += ((state.mouse.inside ? 1 : 0) - bendE) * (reduced ? 1 : 1 - Math.exp(-state.dt * 4));
    const mxp = state.mouse.px; const myp = state.mouse.py;
    const wd = lay.wd;
    const nT = TRACES.length;
    // pulse offsets for every trace at every sample
    for (let i = 0; i < nT; i += 1) {
      const O = OWN[i];
      O.fill(0);
      for (const p of PULSES[i]) {
        const px = ((t * p.speed + p.phase) % lay.period) - 210;
        const k0 = Math.max(0, Math.floor((px - 4 * wd) / STEP));
        const k1 = Math.min(M - 1, Math.ceil((px + 4 * wd) / STEP));
        for (let k = k0; k <= k1; k += 1) {
          const u = (k * STEP - px) / wd;
          O[k] += -p.amp * 2.3 * u * Math.exp(-u * u);
        }
      }
    }
    // trace shapes: separate on the left, one line (with the pulses summed) on the right
    for (let k = 0; k < M; k += 1) {
      const x = k * STEP;
      const m = smooth(clamp((x - lay.xa) / (lay.xb - lay.xa), 0, 1));
      let sum = 0;
      for (let i = 0; i < nT; i += 1) sum += OWN[i][k];
      for (let i = 0; i < nT; i += 1) {
        const wave = Math.sin(x * 0.011 + t * 0.7 + i * 1.7) * 2.2 * (1 - m);
        let y = lay.y0[i] + (lay.yM - lay.y0[i]) * m + wave + OWN[i][k] + (sum - OWN[i][k]) * m;
        if (bendE > 0.01) {
          const dx = (x - mxp) / 150;
          y += (myp - y) * 0.32 * bendE * Math.exp(-dx * dx);
        }
        Y[i][k] = y;
      }
    }
    ctx.lineWidth = 1.2;
    ctx.lineJoin = 'round';
    for (let i = 0; i < nT; i += 1) {
      const Yi = Y[i];
      ctx.strokeStyle = grad[i];
      ctx.beginPath();
      ctx.moveTo(0, Yi[0]);
      for (let k = 1; k < M; k += 1) ctx.lineTo(k * STEP, Yi[k]);
      ctx.stroke();
    }
    // pulses in red, with a soft glow at the peak
    ctx.strokeStyle = flagLine;
    ctx.lineWidth = 1.4;
    for (let i = 0; i < nT; i += 1) {
      const Yi = Y[i];
      for (const p of PULSES[i]) {
        const px = ((t * p.speed + p.phase) % lay.period) - 210;
        if (px < -40 || px > w + 40) continue;
        const k0 = Math.max(0, Math.floor((px - 3 * wd) / STEP));
        const k1 = Math.min(M - 1, Math.ceil((px + 3 * wd) / STEP));
        // red fades in after the region labels (x < ~110 px), so it never strikes through them
        const fade = clamp((px - 100) / (w * 0.1), 0, 1) * clamp((w - px) / 60, 0, 1);
        if (fade <= 0.01) continue;
        ctx.globalAlpha = fade * 0.85;
        ctx.beginPath();
        ctx.moveTo(k0 * STEP, Yi[k0]);
        for (let k = k0 + 1; k <= k1; k += 1) ctx.lineTo(k * STEP, Yi[k]);
        ctx.stroke();
        const kc = clamp(Math.round(px / STEP), 0, M - 1);
        ctx.globalAlpha = fade * 0.5;
        ctx.drawImage(glow, px - 12, Yi[kc] - 12, 24, 24);
      }
    }
    ctx.globalAlpha = 1;
    // region labels where the traces start
    if (w >= 560) {
      ctx.font = '500 10px "Geist Mono", ui-monospace, "Cascadia Mono", Consolas, monospace';
      if ('letterSpacing' in ctx) ctx.letterSpacing = '0.08em';
      ctx.fillStyle = labelInk;
      ctx.textBaseline = 'bottom';
      for (let i = 0; i < nT; i += 1) ctx.fillText(TRACES[i], 24, lay.y0[i] - 11); // fixed rows, clear of the moving pulses
      if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    }
    // where they meet: one quiet marker on the merged line
    const kx = Math.round(lay.xb / STEP);
    if (kx < M) {
      ctx.strokeStyle = inkLine;
      ctx.lineWidth = 1;
      const yy = Y[0][kx];
      ctx.beginPath();
      ctx.moveTo(lay.xb, yy - 10); ctx.lineTo(lay.xb, yy - 5);
      ctx.moveTo(lay.xb, yy + 5); ctx.lineTo(lay.xb, yy + 10);
      ctx.stroke();
    }
  }

  return createEffect(canvas, { setup, draw, interactive: true, maxDpr: 2, pointerTarget });
}

export function mount(el, ctx) {
  ensureCss('css/views/overview-hero.css');
  let cur = ctx;
  const first = esc(String(ALEX.patient.name || 'Alex').split(' ')[0]);
  el.classList.add('ovc');
  el.setAttribute('aria-labelledby', 'ovc-title-h');
  el.innerHTML = `
    <canvas class="ovc-canvas" aria-hidden="true"></canvas>
    <div class="ovc-inner">
      <p class="ovc-kicker"><span class="ovh-dot" aria-hidden="true"></span>Decision support · it never diagnoses</p>
      <h2 class="ovc-title" id="ovc-title-h"><span>The red flags are already in the notes.</span> <span class="soft">Read them together.</span></h2>
      <p class="ovc-lede">One action per visit: ${esc(lower1(TIER.high.action))}, ${esc(lower1(TIER.unclear.action))}, or ${esc(lower1(TIER.low.action))}. Every red flag it counts is quoted from the note it came from.</p>
      <div class="ovh-actions">
        <a class="ovh-btn light" href="#indicator" data-go="indicator" data-alex="always">Open ${first}'s case <span aria-hidden="true">→</span></a>
        <a class="ovh-btn ghost" href="#cases" data-go="cases">Build a case</a>
      </div>
    </div>`;
  const fx = traceEffect(el.querySelector('.ovc-canvas'), el);

  const onClick = (e) => {
    const go = e.target.closest('[data-go]');
    if (!go || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    if (go.dataset.alex) cur.openCase('alex');
    cur.navigate(go.dataset.go);
  };
  el.addEventListener('click', onClick);

  return {
    update(next) { cur = next; },
    unmount() { fx.destroy(); el.removeEventListener('click', onClick); },
  };
}
