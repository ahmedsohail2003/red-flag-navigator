// Shared runtime for the canvas effects. No libraries: plain Canvas 2D, so it works
// offline and inside the hosted sandbox. It gives each effect:
// - DPR-aware sizing that follows the element (ResizeObserver),
// - a render loop that runs only while the canvas is on screen (IntersectionObserver),
// - an eased pointer (state.mouse.nx / ny in -1..1) plus click events,
// - one still frame instead of animation for people who prefer reduced motion.
// Colours come from the CSS tokens, so the effects follow the design system.

export const prefersReducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function cssVar(name, el = document.documentElement) {
  return getComputedStyle(el).getPropertyValue(name).trim();
}

// Read the palette tokens once per call (cheap); effects call it in setup().
export function palette() {
  const v = (n) => cssVar(n);
  return {
    canvas: v('--canvas'), surface: v('--surface'), ink: v('--ink'), ink2: v('--ink-2'), ink3: v('--ink-3'),
    accent: v('--accent'), flag: v('--flag'),
    panel: v('--panel'), panel2: v('--panel-2'), panel3: v('--panel-3'),
    panelInk: v('--panel-ink'), panelInk2: v('--panel-ink-2'), panelInk3: v('--panel-ink-3'),
    panelAccent: v('--panel-accent'), panelFlag: v('--panel-flag'),
    high: v('--high'), watch: v('--watch'), low: v('--low'),
    highDark: v('--high-dark'), watchDark: v('--watch-dark'), lowDark: v('--low-dark'),
  };
}

// '#RRGGBB' (or '#RGB') -> 'rgba(r,g,b,a)'
export function rgba(hex, a = 1) {
  let h = String(hex || '#000').trim().replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16);
  if (Number.isNaN(n)) return `rgba(0,0,0,${a})`;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// --- tiny 3D helpers ---
export const rotY = (p, a) => { const c = Math.cos(a), s = Math.sin(a); return { x: p.x * c + p.z * s, y: p.y, z: -p.x * s + p.z * c }; };
export const rotX = (p, a) => { const c = Math.cos(a), s = Math.sin(a); return { x: p.x, y: p.y * c - p.z * s, z: p.y * s + p.z * c }; };
export const rotZ = (p, a) => { const c = Math.cos(a), s = Math.sin(a); return { x: p.x * c - p.y * s, y: p.x * s + p.y * c, z: p.z }; };
// Perspective projection: camera at z = -dist looking toward +z. Returns screen x, y and scale.
export function project(p, { cx, cy, f, dist }) {
  const z = p.z + dist;
  const s = f / Math.max(0.001, z);
  return { x: cx + p.x * s, y: cy + p.y * s, s, z };
}
export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (t) => t * t * (3 - 2 * t);

// Seeded random, so scenes look the same on every load.
export function rng(seed = 1) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// createEffect(canvas, { setup?(ctx, state), draw(ctx, state), interactive = true, maxDpr = 2, pointerTarget?, rootMargin? })
// state: { w, h, dpr, t, dt, frame, reduced, visible, quality, mouse: { x, y, px, py, nx, ny, inside, down }, clicks: [{x, y}], data: {} }
// quality: 'full' | 'low-dpr' | 'half-rate' | 'still' (the slow-renderer guard steps down; see tick()).
export function createEffect(canvas, opts) {
  const { draw, setup, interactive = true, rootMargin = '0px' } = opts;
  let maxDpr = opts.maxDpr || 2;
  const ctx = canvas.getContext('2d');
  const state = {
    w: 0, h: 0, dpr: 1, t: 0, dt: 0.016, frame: 0, reduced: prefersReducedMotion(), visible: false, quality: 'full',
    mouse: { x: 0.5, y: 0.5, px: 0, py: 0, nx: 0, ny: 0, tx: 0, ty: 0, inside: false, down: false },
    clicks: [], data: {},
  };
  let raf = 0;
  let running = false;
  let last = 0;
  // slow-renderer guard: moving average of real frame intervals
  let avgMs = 16.7;
  let slowSince = 0;

  const renderOnce = () => { if (state.w > 1 && state.h > 1) { try { draw(ctx, state); } catch (e) { console.error(e); } } };
  // Reduced motion: one coalesced still redraw (for clicks), then forget the clicks.
  let stillRaf = 0;
  const requestStill = () => {
    if (stillRaf) return;
    stillRaf = requestAnimationFrame(() => { stillRaf = 0; renderOnce(); state.clicks.length = 0; });
  };

  const resize = () => {
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(maxDpr, window.devicePixelRatio || 1);
    state.w = Math.max(1, r.width);
    state.h = Math.max(1, r.height);
    state.dpr = dpr;
    canvas.width = Math.round(state.w * dpr);
    canvas.height = Math.round(state.h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (setup) { try { setup(ctx, state); } catch (e) { console.error(e); } }
    if (!running) renderOnce();
  };

  // Step down when frames stay slow (no GPU canvas, thin clients): sharpness 1x,
  // then every other frame, then a still frame, as for reduced motion.
  const stepDown = () => {
    slowSince = 0;
    avgMs = 16.7;
    if (state.quality === 'full' && maxDpr > 1 && (window.devicePixelRatio || 1) > 1) { state.quality = 'low-dpr'; maxDpr = 1; resize(); return; }
    if (state.quality === 'full' || state.quality === 'low-dpr') { state.quality = 'half-rate'; return; }
    state.quality = 'still';
    stop();
    renderOnce();
  };

  const tick = (now) => {
    if (!running) return;
    const t = now / 1000;
    const rawMs = last ? (t - last) * 1000 : 16.7;
    state.dt = last ? Math.min(0.05, t - last) : 0.016;
    last = t;
    if (rawMs < 200) { // ignore gaps from background tabs
      avgMs += (rawMs - avgMs) * 0.1;
      if (avgMs > 22) { slowSince = slowSince || now; if (now - slowSince > 1000) stepDown(); } else slowSince = 0;
      if (!running) return;
    }
    state.t += state.dt;
    state.frame += 1;
    const k = 1 - Math.pow(0.002, state.dt); // eased pointer
    state.mouse.nx += (state.mouse.tx - state.mouse.nx) * k;
    state.mouse.ny += (state.mouse.ty - state.mouse.ny) * k;
    if (state.quality !== 'half-rate' || state.frame % 2 === 0) {
      renderOnce();
      state.clicks.length = 0;
    }
    raf = requestAnimationFrame(tick);
  };
  const start = () => { if (running || state.reduced || state.quality === 'still') return; running = true; last = 0; raf = requestAnimationFrame(tick); };
  const stop = () => { running = false; cancelAnimationFrame(raf); };

  const target = opts.pointerTarget || canvas.parentElement || canvas;
  const onMove = (e) => {
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    state.mouse.px = e.clientX - r.left;
    state.mouse.py = e.clientY - r.top;
    state.mouse.x = state.mouse.px / r.width;
    state.mouse.y = state.mouse.py / r.height;
    state.mouse.tx = Math.max(-1, Math.min(1, state.mouse.x * 2 - 1));
    state.mouse.ty = Math.max(-1, Math.min(1, state.mouse.y * 2 - 1));
    // Reduced motion: still frames ignore the pointer, so nothing follows the cursor
    // and moving the mouse costs no redraws.
    state.mouse.inside = !state.reduced;
  };
  const onLeave = () => { state.mouse.inside = false; state.mouse.tx = 0; state.mouse.ty = 0; };
  const onDown = (e) => {
    onMove(e);
    state.mouse.down = true;
    state.clicks.push({ x: state.mouse.px, y: state.mouse.py });
    if (state.reduced || state.quality === 'still') requestStill();
  };
  const onUp = () => { state.mouse.down = false; };
  if (interactive) {
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerleave', onLeave);
    target.addEventListener('pointerdown', onDown);
    window.addEventListener('pointerup', onUp);
  }

  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
  if (ro) ro.observe(canvas); else window.addEventListener('resize', resize);
  const io = typeof IntersectionObserver === 'function'
    ? new IntersectionObserver((es) => { state.visible = es.some((e) => e.isIntersecting); if (state.visible) start(); else stop(); }, { rootMargin })
    : null;
  if (io) io.observe(canvas); else { state.visible = true; start(); }

  const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  const onMq = () => { state.reduced = !!(mq && mq.matches); if (state.reduced) { stop(); renderOnce(); } else if (state.visible) start(); };
  if (mq && mq.addEventListener) mq.addEventListener('change', onMq);

  resize();

  return {
    state,
    renderOnce,
    destroy() {
      stop();
      if (stillRaf) cancelAnimationFrame(stillRaf);
      if (ro) ro.disconnect(); else window.removeEventListener('resize', resize);
      if (io) io.disconnect();
      if (interactive) {
        target.removeEventListener('pointermove', onMove);
        target.removeEventListener('pointerleave', onLeave);
        target.removeEventListener('pointerdown', onDown);
        window.removeEventListener('pointerup', onUp);
      }
      if (mq && mq.removeEventListener) mq.removeEventListener('change', onMq);
    },
  };
}

// Scroll progress of an element through the viewport: 0 when its top reaches the
// bottom of the screen, 1 when its bottom leaves the top. Used for scroll-driven scenes.
export function scrollProgress(el) {
  const r = el.getBoundingClientRect();
  const vh = window.innerHeight || 1;
  return clamp((vh - r.top) / (vh + r.height), 0, 1);
}
