// Text scramble: cycles an element through words, decoding each one letter by letter
// (the reference's "more robots. / more runway." effect). Returns { stop() }.
// - Reduced motion: the first word stays; nothing is scheduled.
// - It runs only while the element is on screen (IntersectionObserver), pauses while the
//   pointer or keyboard focus is inside opts.pauseWithin (one element or a list), and stops
//   on the first word after opts.passes passes through the list, so the headline settles
//   (WCAG 2.2.2).
import { prefersReducedMotion } from './core.js';

const GLYPHS = 'abcdefghijklmnopqrstuvwxyz';

export function scrambleCycle(el, words, { hold = 2600, step = 32, passes = 2, pauseWithin = null } = {}) {
  if (!el || !words || !words.length) return { stop() {} };
  el.setAttribute('aria-live', 'off');
  el.textContent = words[0];
  if (words.length < 2 || prefersReducedMotion()) return { stop() {} };

  let i = 0;
  let swaps = 0;
  const maxSwaps = Math.max(1, passes) * words.length; // ends back on words[0]
  let timer = 0;
  let raf = 0;
  let stopped = false;
  let visible = false;
  let held = false; // pointer or focus inside pauseWithin
  let busy = false; // a decode is running

  const canRun = () => !stopped && visible && !held && swaps < maxSwaps;
  const schedule = () => {
    clearTimeout(timer);
    timer = 0;
    if (canRun() && !busy) timer = setTimeout(next, hold);
  };

  const decode = (target) => {
    busy = true;
    const from = el.textContent;
    const len = Math.max(from.length, target.length);
    const start = performance.now();
    const frame = (now) => {
      if (stopped) return;
      const done = Math.floor((now - start) / step);
      let out = '';
      for (let k = 0; k < len; k += 1) {
        if (k < done) out += target[k] || '';
        else if (k < target.length) out += target[k] === ' ' || target[k] === '.' ? target[k] : GLYPHS[(Math.random() * GLYPHS.length) | 0];
      }
      el.textContent = out;
      if (done < len && visible) { raf = requestAnimationFrame(frame); return; }
      // finished, or scrolled away mid-decode: land on the word at once
      el.textContent = target;
      busy = false;
      raf = 0;
      schedule();
    };
    raf = requestAnimationFrame(frame);
  };
  const next = () => {
    timer = 0;
    if (!canRun()) return;
    i = (i + 1) % words.length;
    swaps += 1;
    decode(words[i]);
  };

  const io = typeof IntersectionObserver === 'function'
    ? new IntersectionObserver((entries) => { visible = entries.some((e) => e.isIntersecting); schedule(); })
    : null;
  if (io) io.observe(el); else { visible = true; schedule(); }

  // pause while the pointer is over, or focus is inside, any of the pauseWithin elements
  const boxes = (Array.isArray(pauseWithin) ? pauseWithin : [pauseWithin]).filter(Boolean);
  const inside = () => boxes.some((b) => b.matches(':hover') || b.contains(document.activeElement));
  const onEnter = () => { held = true; clearTimeout(timer); timer = 0; };
  const onLeave = () => { requestAnimationFrame(() => { if (stopped) return; held = inside(); schedule(); }); };
  for (const b of boxes) {
    b.addEventListener('pointerenter', onEnter);
    b.addEventListener('pointerleave', onLeave);
    b.addEventListener('focusin', onEnter);
    b.addEventListener('focusout', onLeave);
  }

  return {
    stop() {
      stopped = true;
      clearTimeout(timer);
      cancelAnimationFrame(raf);
      if (io) io.disconnect();
      for (const b of boxes) {
        b.removeEventListener('pointerenter', onEnter);
        b.removeEventListener('pointerleave', onLeave);
        b.removeEventListener('focusin', onEnter);
        b.removeEventListener('focusout', onLeave);
      }
    },
  };
}
