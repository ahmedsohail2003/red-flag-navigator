// Overview (#overview): a scrolling story, composed from one module per section.
// Order: hero, steps, pattern, follow, ice, anycase, closing (./overview/<name>.js).
// Each module exports mount(sectionEl, ctx) -> { update(ctx)?, unmount()? }. Modules are
// loaded with dynamic import() inside try/catch, so a section that is missing or fails is
// skipped (console.warn) and never breaks the page. The composer owns only the frame:
// full-bleed dark bands (ov-bleed), the light/dark rhythm, and a one-time reveal as each
// section scrolls into view (none with reduced motion). Every number on the page comes
// from the section modules, which compute them from the engine and the case files.
// For sections: add classes with classList (never overwrite the section's className).
// CSS variables on .ov: --ov-x (side padding that centres content, in px), --ov-max, --ov-y,
// --ov-topbar (the top bar's real height) and --ov-sticky-top (that height while the top
// bar is sticky, 0 when it scrolls away on phones) for sticky, scroll-driven scenes.
import { ensureCss } from '../ui.js';
import { prefersReducedMotion } from '../../fx/core.js';

// tone: 'dark' sections are full-bleed espresso bands; 'light' ones sit on the cream canvas.
// The section elements carry no accessible name of their own: each module names its part
// (aria-labelledby on its heading), so no region is announced twice.
const SECTIONS = [
  { name: 'hero', tone: 'dark', label: 'Headline' },
  { name: 'steps', tone: 'light', label: 'How it works' },
  { name: 'pattern', tone: 'light', label: 'The pattern' },
  { name: 'follow', tone: 'light', label: 'Follow one patient' },
  { name: 'ice', tone: 'dark', label: 'The Ice Bucket Challenge' },
  { name: 'anycase', tone: 'light', label: 'Any patient' },
  { name: 'closing', tone: 'dark', label: 'Open the indicator' },
];
// Static import paths (one per module) so tools and hosts can see every file.
const LOADERS = {
  hero: () => import('./overview/hero.js'),
  steps: () => import('./overview/steps.js'),
  pattern: () => import('./overview/pattern.js'),
  follow: () => import('./overview/follow.js'),
  ice: () => import('./overview/ice.js'),
  anycase: () => import('./overview/anycase.js'),
  closing: () => import('./overview/closing.js'),
};
const REVEAL_MS = 1000; // a little longer than the CSS fade (.7s light, .8s dark)

export function mount(root, ctx) {
  ensureCss('css/views/overview.css');
  let cur = ctx;
  let dead = false;
  const reduced = prefersReducedMotion();
  const handles = new Map(); // name -> handle
  const timers = new Set();

  root.innerHTML = `<div class="ov">${SECTIONS.map((s) =>
    `<section class="ov-sec ov-${s.tone}${s.tone === 'dark' ? ' ov-bleed' : ''}${reduced || s.name === 'hero' ? '' : ' ov-rv'}" data-sec="${s.name}"></section>`).join('')}</div>`;
  const wrap = root.querySelector('.ov');
  const secEl = (name) => wrap.querySelector(`[data-sec="${name}"]`);

  // The top bar's real height (it wraps to two rows on narrower screens), for sticky scenes.
  const topbar = document.querySelector('.topbar');
  const setTop = () => {
    if (!topbar || dead) return;
    const h = Math.round(topbar.getBoundingClientRect().height);
    const sticky = getComputedStyle(topbar).position === 'sticky';
    wrap.style.setProperty('--ov-topbar', `${h}px`);
    wrap.style.setProperty('--ov-sticky-top', `${sticky ? h : 0}px`);
  };
  // --ov-x in px: CSS can only give it as a percentage, which would resolve against a
  // different box inside a section; px means the same everywhere (e.g. for
  // margin-inline: calc(-1 * var(--ov-x)) on a band-wide child, see .ov-fill).
  const setX = () => {
    if (dead) return;
    const cs = getComputedStyle(wrap);
    const g = parseFloat(cs.getPropertyValue('--ov-gutter')) || 32;
    const max = parseFloat(cs.getPropertyValue('--ov-max')) || 1176;
    wrap.style.setProperty('--ov-x', `${Math.max(g, (wrap.clientWidth - max) / 2)}px`);
  };
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { setTop(); setX(); }) : null;
  if (ro) { if (topbar) ro.observe(topbar); ro.observe(wrap); }
  const onResize = () => { setTop(); setX(); };
  window.addEventListener('resize', onResize);
  onResize();

  // Reveal each section once as it enters (fade + 12px rise; the hero is on screen from
  // the start, so it is shown at once). A section counts as entered when its top passes
  // 88% of the viewport, so tall scroll-driven sections reveal too. Once the fade is over
  // the classes go, so nothing inside (sticky tracks, fixed layers) ever sits under a
  // transformed ancestor.
  const io = !reduced && typeof IntersectionObserver === 'function'
    ? new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const el = e.target;
        el.classList.add('is-in');
        io.unobserve(el);
        const t = setTimeout(() => { timers.delete(t); el.classList.remove('ov-rv', 'is-in'); }, REVEAL_MS);
        timers.add(t);
      }
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0 })
    : null;
  if (!io) wrap.querySelectorAll('.ov-rv').forEach((el) => el.classList.remove('ov-rv'));

  // Keyboard focus never sits in a half-faded section: tabbing into one that has not been
  // revealed yet shows it at once (removing ov-rv drops its transition too).
  const onFocusIn = (e) => {
    const sec = e.target.closest?.('.ov-sec.ov-rv');
    if (!sec || !wrap.contains(sec)) return;
    sec.classList.remove('ov-rv', 'is-in');
    if (io) io.unobserve(sec);
  };
  wrap.addEventListener('focusin', onFocusIn);

  // State changes reach the sections within about one screen of the viewport at once; the
  // others are marked dirty and catch up as they come near.
  const near = new Set();
  const dirty = new Set();
  const runUpdate = (name) => {
    const h = handles.get(name);
    if (typeof h?.update !== 'function') return;
    try { h.update(cur); } catch (e) { console.warn(`[overview] section "${name}" update failed:`, e?.message || e); }
  };
  const nearIo = typeof IntersectionObserver === 'function'
    ? new IntersectionObserver((entries) => {
      for (const e of entries) {
        const name = e.target.dataset.sec;
        if (!e.isIntersecting) { near.delete(name); continue; }
        near.add(name);
        if (dirty.delete(name)) runUpdate(name);
      }
    }, { rootMargin: '100% 0px 100% 0px', threshold: 0 })
    : null;

  const skip = (s, el, e) => {
    console.warn(`[overview] section "${s.name}" skipped:`, e?.message || e);
    el.hidden = true;
    el.innerHTML = '';
  };
  const mountOne = (s, r) => {
    const el = secEl(s.name);
    if (!r.ok) { skip(s, el, r.e); return; }
    try {
      if (typeof r.m?.mount !== 'function') throw new Error('no mount() export');
      handles.set(s.name, r.m.mount(el, cur) || {});
      el.classList.add('is-mounted');
    } catch (e) { skip(s, el, e); return; }
    if (nearIo) nearIo.observe(el);
    // Every section above this one is already built, so its place on the page is final.
    if (io && el.classList.contains('ov-rv')) io.observe(el);
  };
  // the next task, after the browser has had a chance to paint
  const afterPaint = () => new Promise((res) => {
    let done = false;
    const go = () => { if (!done) { done = true; setTimeout(res, 0); } };
    requestAnimationFrame(go);
    setTimeout(go, 100);
  });
  // Load and mount the hero first and let it paint; then load the other modules in
  // parallel and mount them one per task in page order (unbuilt ones keep a one-screen
  // placeholder, :where(.ov-sec:not(.is-mounted)) in overview.css, so nothing below the
  // hero counts as seen before it is built).
  const loads = [];
  const load = (i) => (loads[i] ??= LOADERS[SECTIONS[i].name]().then((m) => ({ ok: true, m }), (e) => ({ ok: false, e })));
  (async () => {
    for (let i = 0; i < SECTIONS.length; i += 1) {
      if (i === 1) for (let j = 1; j < SECTIONS.length; j += 1) load(j);
      const r = await load(i);
      if (dead) return;
      mountOne(SECTIONS[i], r);
      if (i === 0) setTop();
      await afterPaint();
      if (dead) return;
    }
    setTop();
  })();

  return {
    update(c) {
      cur = c;
      for (const name of handles.keys()) {
        if (nearIo && !near.has(name)) dirty.add(name);
        else runUpdate(name);
      }
    },
    unmount() {
      dead = true;
      if (io) io.disconnect();
      if (nearIo) nearIo.disconnect();
      if (ro) ro.disconnect();
      wrap.removeEventListener('focusin', onFocusIn);
      window.removeEventListener('resize', onResize);
      for (const t of timers) clearTimeout(t);
      timers.clear();
      for (const [name, h] of handles) {
        try { h.unmount?.(); } catch (e) { console.warn(`[overview] section "${name}" unmount failed:`, e?.message || e); }
      }
      handles.clear();
      near.clear();
      dirty.clear();
    },
  };
}
