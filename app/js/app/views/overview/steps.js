// Overview section "How it works": four dark cards on a horizontal track that vertical
// scroll moves from right to left (the reference's scroll-driven card track). Each card
// has a small step label, a title, one or two sentences, a scanline 3D object
// (../../../fx/scanline.js) and a small working widget on Alex's real data:
//   01 Read every visit      a quote from the visit where the pattern rules first fire
//   02 Weight each red flag  three published adjusted odds ratios with their 95% CI
//   03 Range against the line the likelihood range on a log axis vs the referral line
//   04 One action            the action and the pattern rules that fired, never a diagnosis
// Every number is computed here from the engine and alex.js; the visit is found by the
// engine (the first visit where a notes-based pattern rule fires), not typed in. Like the
// rest of the overview this tells Alex's story, so it imports ALEX directly.
// Desktop (wide and tall enough, motion allowed): sticky stage + translated track.
// Phones and reduced motion: the cards simply stack, with no scroll-jacking. The cards are
// an ordered list in reading order, so keyboard and screen-reader users get a plain list;
// focusing anything inside a card scrolls that card into view.
import { esc, fmtDate, pct, pctAt, TIER, tierChip, assumeChip, sourceLink, ensureCss } from '../../ui.js';
import { timeline, evaluateAt, FINDINGS, ACTIONS, DEFAULT_REFERRAL_LINE } from '../../../engine.js';
import { REFERRAL_LINES } from '../../../weights.js';
import { ALEX } from '../../../alex.js';
import { scanlineObject } from '../../../fx/scanline.js';

const NOTES_ONLY = { includeHomeTests: false };
const pad = (n) => String(n).padStart(2, '0');
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

const STEPS = [
  { scene: 'notes', label: 'Read', title: 'Read every visit' },
  { scene: 'bars', label: 'Weight', title: 'Weight each red flag' },
  { scene: 'hill', label: 'Range', title: 'Range against the line' },
  { scene: 'neuron', label: 'Act', title: 'One action' },
];
// The three red flags the weighting card shows (published adjusted odds ratios).
const OR_IDS = ['wasting', 'focal_weakness', 'fasciculations'];
const SHORT = {
  two_territory_wasting: 'Two nerve territories', mimic_test_normal: 'Look-alike test normal',
  fasciculations: 'Fasciculations', umn_signs: 'Brisk reflexes', split_hand: 'Split-hand pattern',
};
const short = (id) => SHORT[id] || String(FINDINGS[id]?.label || id).split(/\s\(|:/)[0];

// ---------- data (computed once from the engine and the case file) ----------
let BASE = null;
function base() {
  if (BASE) return BASE;
  const encs = [...ALEX.encounters].sort((a, b) => a.date.localeCompare(b.date));
  const tl = timeline(ALEX, NOTES_ONLY);
  // The pattern rules from the notes do not depend on the referral line.
  const firstRule = tl.find((e) => e.encounter && e.rulesFired.some((r) => r.id !== 'unclear_with_decline'));
  const asOf = firstRule ? firstRule.asOf : encs[0].date;
  const enc = encs.find((e) => e.date === asOf) || encs[0];
  const first = {};
  for (const e of encs) for (const f of e.findings || []) if (!first[f.id]) first[f.id] = { date: e.date, setting: e.setting };
  const note = enc.note || '';
  const spans = (enc.findings || []).map((f, i) => {
    const idx = f.quote ? note.indexOf(f.quote) : -1;
    return { i, id: f.id, quote: f.quote || '', idx, from: idx >= 0 ? idx / note.length : 0, to: idx >= 0 ? (idx + f.quote.length) / note.length : 0 };
  });
  const ors = OR_IDS.filter((id) => FINDINGS[id]?.or != null).map((id) => ({ id, label: short(id), or: FINDINGS[id].or, lo: FINDINGS[id].lo, hi: FINDINGS[id].hi }));
  BASE = { encs, asOf, enc, visitNo: encs.indexOf(enc) + 1, first, spans, ors };
  return BASE;
}

const evalAt = (line) => evaluateAt(ALEX, base().asOf, { ...NOTES_ONLY, referralLine: line });

// Log axis for the likelihood range, wide enough for the range and every referral line.
const NICE = [0.0001, 0.0002, 0.0005, 0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1];
function rangeAxis(range) {
  const lines = REFERRAL_LINES.map((l) => l.value);
  const lo0 = Math.min(range.lo, ...lines) / 1.6;
  const hi0 = Math.max(range.hi, ...lines) * 1.6;
  const a0 = [...NICE].reverse().find((v) => v <= lo0) || NICE[0];
  const a1 = NICE.find((v) => v >= hi0) || 1;
  const L0 = Math.log(a0); const L1 = Math.log(a1);
  const u = (p) => clamp((Math.log(Math.max(1e-9, p)) - L0) / (L1 - L0), 0, 1);
  const tick = (p) => `${+(p * 100).toPrecision(2)}%`;
  return { a0, a1, u, ticks: NICE.filter((v) => v >= a0 && v <= a1).map((v) => ({ u: u(v), label: tick(v) })) };
}
const lineLabel = (v) => REFERRAL_LINES.find((l) => l.value === v)?.label || pct(v);

// ---------- card copy ----------
function copyText(i, ev) {
  const n = ev?.range?.nSims;
  return [
    'Notes from the family doctor, the hand surgeon and the physiotherapist are read together. Every red flag keeps the sentence it came from, word for word.',
    'Each red flag carries a published adjusted odds ratio from a large primary-care study. The arithmetic is plain and checkable, not an AI model.',
    `${n ? `${n.toLocaleString('en-US')} simulated draws turn` : 'Simulated draws turn'} the weights into a 95% likelihood range, which is compared with the referral line you choose.`,
    'Some patterns refer on their own, whatever the number. The output is one action for the doctor, never a diagnosis.',
  ][i];
}

// ---------- widgets ----------
function quoteHtml(note, s) {
  if (!s || s.idx < 0) return `<span class="st-q-mark is-on">${esc(s?.quote || '')}</span>`;
  let a = note.lastIndexOf('. ', s.idx - 1);
  a = a < 0 ? 0 : a + 2;
  let b = note.indexOf('.', s.idx + s.quote.length - 1);
  b = b < 0 ? note.length : b + 1;
  // the whole sentence around the quote; an ellipsis only where a long sentence is cut
  const cutA = s.idx - a > 80; const cutB = b - (s.idx + s.quote.length) > 80;
  if (cutA) a = s.idx;
  if (cutB) b = s.idx + s.quote.length;
  const pre = note.slice(a, s.idx);
  const post = note.slice(s.idx + s.quote.length, b);
  return `“${cutA ? '…' : ''}${esc(pre)}<mark class="st-q-mark">${esc(s.quote)}</mark>${esc(post)}${cutB ? '…' : ''}”`;
}

function readWidget(B, sel) {
  const s = B.spans[sel];
  const rows = B.spans.map((x) => `
      <button type="button" class="st-f" data-f="${x.i}" aria-pressed="${x.i === sel}">
        <span class="st-f-dot" aria-hidden="true"></span><span class="st-f-l">${esc(short(x.id))}</span>
        <span class="st-f-k mono">${FINDINGS[x.id]?.or != null ? 'Red flag' : 'Pattern'}</span>
      </button>`).join('');
  return `
    <div class="st-w">
      <div class="st-w-top"><span class="micro dot">${esc(B.enc.setting)}</span><span class="st-meta mono">${fmtDate(B.enc.date)}</span></div>
      <blockquote class="st-q" data-q>${quoteHtml(B.enc.note || '', s)}</blockquote>
      <div class="st-f-list" role="group" aria-label="Red flags quoted from this note">${rows}</div>
      <div class="st-w-foot">Visit ${B.visitNo} of ${B.encs.length} · quoted word for word</div>
    </div>`;
}

const orPos = (v) => clamp((Math.log(v) / Math.log(100)) * 100, 0, 100);
function orDetail(B, i) {
  const r = B.ors[i];
  if (!r) return '';
  const f = B.first[r.id];
  const when = !f ? 'Not in Alex’s notes.'
    : f.date <= B.asOf ? `In Alex’s notes from ${fmtDate(f.date)} (${esc(f.setting.toLowerCase())}).`
      : `Not in Alex’s notes yet on ${fmtDate(B.asOf)}; first noted ${fmtDate(f.date)}.`;
  return `<span class="mono">aOR ${r.or.toFixed(2)} · 95% CI ${r.lo.toFixed(2)} to ${r.hi.toFixed(2)}</span><span>${when}</span>`;
}
function weightWidget(B, sel) {
  const rows = B.ors.map((r, i) => `
      <button type="button" class="st-or-row" data-o="${i}" aria-pressed="${i === sel}">
        <span class="st-or-l">${esc(r.label)}</span><span class="st-or-v mono">${r.or.toFixed(2)}</span>
        <span class="st-or-bar" aria-hidden="true"><i class="st-or-ci" style="left:${orPos(r.lo).toFixed(2)}%;width:${(orPos(r.hi) - orPos(r.lo)).toFixed(2)}%"></i><i class="st-or-pt" style="left:${orPos(r.or).toFixed(2)}%"></i></span>
        <span class="st-vh">, 95% confidence interval ${r.lo.toFixed(2)} to ${r.hi.toFixed(2)}</span>
      </button>`).join('');
  return `
    <div class="st-w">
      <div class="st-w-top"><span class="micro dot">Adjusted odds ratio</span><span class="st-meta mono">95% CI · log scale</span></div>
      <div class="st-or" role="group" aria-label="Published weights">${rows}
        <div class="st-or-axis mono" aria-hidden="true"><span style="left:0%">1</span><span style="left:50%">10</span><span style="left:100%">100</span></div>
      </div>
      <p class="st-or-d" data-od>${orDetail(B, sel)}</p>
      <div class="st-w-foot">Source: ${sourceLink('mei2022')}</div>
    </div>`;
}

function verdictHtml(ev, line) {
  const by = ev.byNumber;
  const L = esc(lineLabel(line));
  const txt = by === 'high' ? `the whole range is above the ${L} line.`
    : by === 'low' ? `the whole range is below the ${L} line.`
      : `the range crosses the ${L} line, so the number alone says track weekly.`;
  // Say it when the low end only just clears the line, as every other view does.
  const close = by === 'high' && ev.range.lo / line < 1.5
    ? ' Only just: the low end is close to the line; here the pattern rules decide.' : '';
  return `${tierChip(by)}<span>By the number: ${txt}${close}</span>`;
}
function rangeWidget(B, ev, line, ax) {
  const r = ev.range;
  const seg = REFERRAL_LINES.map((l) => `<button type="button" class="mono" data-st-line="${l.value}" aria-pressed="${l.value === line}" title="${esc(l.note)}">${esc(l.label)}</button>`).join('');
  const lo = ax.u(r.lo) * 100; const hi = ax.u(r.hi) * 100;
  return `
    <div class="st-w">
      <div class="st-w-top"><span class="micro dot">95% range · ${fmtDate(B.asOf)}</span><span class="st-meta mono">Notes only</span></div>
      <div class="st-big mono" data-rng>${esc(pctAt(r.lo, line))}<span class="st-big-to"> to </span>${esc(pctAt(r.hi, line))}</div>
      <div class="st-ax" aria-hidden="true">
        <div class="st-ax-tr">
          <i class="st-ax-rg" style="left:${lo.toFixed(2)}%;width:${(hi - lo).toFixed(2)}%"></i>
          <i class="st-ax-md" style="left:${(ax.u(r.median) * 100).toFixed(2)}%"></i>
          <i class="st-ax-ln" data-ln style="left:${(ax.u(line) * 100).toFixed(2)}%"><b class="mono" data-lnl>${esc(lineLabel(line))} line</b></i>
        </div>
        <div class="st-ax-tk mono">${ax.ticks.map((t) => `<span style="left:${(t.u * 100).toFixed(2)}%">${esc(t.label)}</span>`).join('')}</div>
      </div>
      <div class="st-line"><span class="micro" id="st-line-l">Referral line</span><div class="seg" role="group" aria-labelledby="st-line-l">${seg}</div></div>
      <p class="st-verdict" data-verdict>${verdictHtml(ev, line)}</p>
    </div>`;
}

// The doctor's first sentence for the tier, without repeating the action words: when it
// starts with the action ("Refer for EMG and neuromuscular assessment now"), the rest is
// shown as a lowercase continuation of the heading ("…and neuromuscular assessment now.").
function actSub(tier) {
  const first = String(ACTIONS[tier]?.doctor || '').split('. ')[0].replace(/\.$/, '');
  const act = TIER[tier]?.action || '';
  if (act && first.toLowerCase().startsWith(act.toLowerCase())) {
    const rest = first.slice(act.length).trim();
    return rest ? `…${rest.charAt(0).toLowerCase()}${rest.slice(1)}.` : '';
  }
  return first ? `${first.charAt(0).toUpperCase()}${first.slice(1)}.` : '';
}

function actWidget(B, ev) {
  const tier = ev.tier;
  const rules = ev.rulesFired.map((r) => `<li><span class="st-rule-l">${esc(r.label)}</span><span class="st-rule-s">${r.source === 'assumption' ? assumeChip() : sourceLink(r.source)}</span></li>`).join('');
  return `
    <div class="st-w st-w-act">
      <div class="st-w-top"><span class="micro dot">The action · ${fmtDate(B.asOf)}</span>${tierChip(tier)}</div>
      <div class="st-act">${esc(TIER[tier]?.action || '')}</div>
      <p class="st-act-sub">${esc(actSub(tier))}</p>
      ${ev.rulesFired.length ? `<div class="micro st-rules-h">Pattern rules that fired</div><ul class="st-rules">${rules}</ul>` : '<div class="micro st-rules-h">No pattern rule fired; the number decides</div>'}
      <p class="st-never"><b>Never a diagnosis.</b> The output is “needs EMG / neuromuscular workup”.</p>
    </div>`;
}

// ---------- the section ----------
export function mount(el, ctx) {
  ensureCss('css/views/overview-steps.css');
  const B = base();
  let line = ctx?.state?.line ?? DEFAULT_REFERRAL_LINE;
  let ev = evalAt(line);
  const ax = rangeAxis(ev.range);
  let fSel = Math.max(0, B.spans.findIndex((s) => s.id === 'wasting' && s.idx >= 0));
  let oSel = 0;

  const widgets = [
    () => readWidget(B, fSel),
    () => weightWidget(B, oSel),
    () => rangeWidget(B, ev, line, ax),
    () => actWidget(B, ev),
  ];
  const cardHtml = (s, i) => `
    <li class="st-card panel" data-i="${i}" aria-labelledby="st-t${i}">
      <div class="st-obj" aria-hidden="true"><canvas aria-hidden="true"></canvas></div>
      <span class="st-crop" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
      <div class="st-in">
        <div class="st-copy">
          <div class="st-num mono" aria-hidden="true">${pad(i + 1)}</div>
          <div class="st-txt">
            <h3 class="st-h" id="st-t${i}"><span class="st-vh">Step ${i + 1}: </span>${esc(s.title)}</h3>
            <p class="st-p" data-copy>${esc(copyText(i, ev))}</p>
          </div>
        </div>
        <div class="st-wrap" data-w="${i}">${widgets[i]()}</div>
      </div>
    </li>`;

  el.classList.add('st');
  el.innerHTML = `
    <div class="st-pin">
      <div class="st-stage">
        <div class="st-head">
          <div class="micro dot">How it works</div>
          <h2 class="st-title two-tone">From a family doctor’s note <span class="soft">to an EMG referral, in four steps.</span></h2>
          <p class="st-lede">Shown on Alex’s visit of ${fmtDate(B.asOf)}, the first visit where a pattern rule in the notes calls for an EMG, at every referral line.</p>
        </div>
        <div class="st-view">
          <ol class="st-track" aria-label="How it works, in four steps">${STEPS.map(cardHtml).join('')}</ol>
        </div>
        <div class="st-prog">
          <div class="st-prog-n mono" aria-hidden="true"><b data-pn>01</b><span> / ${pad(STEPS.length)}</span></div>
          <div class="st-prog-steps" role="group" aria-label="Go to a step">
            ${STEPS.map((s, i) => `<button type="button" class="st-prog-b" data-go="${i}" aria-current="${i === 0 ? 'step' : 'false'}"><span class="st-prog-bar"><i></i></span><span class="st-prog-l"><span class="mono">${pad(i + 1)}</span> ${esc(s.label)}</span></button>`).join('')}
          </div>
        </div>
      </div>
    </div>`;

  const q = (s) => el.querySelector(s);
  const pinEl = q('.st-pin');
  const stage = q('.st-stage');
  const head = q('.st-head');
  const track = q('.st-track');
  const prog = q('.st-prog');
  const cards = [...el.querySelectorAll('.st-card')];
  const fills = [...el.querySelectorAll('.st-prog-bar > i')];
  const progBtns = [...el.querySelectorAll('.st-prog-b')];
  const pn = q('[data-pn]');
  const wrap = (i) => el.querySelector(`[data-w="${i}"]`);

  // ---------- scanline objects ----------
  const marks = (sel = fSel) => B.spans.filter((s) => s.idx >= 0).map((s) => ({ from: s.from, to: s.to, on: s.i === sel }));
  const hillParams = () => {
    const r = ev.range;
    return { mu: ax.u(r.median), sd: (ax.u(r.hi) - ax.u(r.lo)) / (2 * 1.96), line: ax.u(line) };
  };
  const initial = [
    { marks: marks() },
    { bars: B.ors.map((r) => ({ v: Math.log(r.or), lo: Math.log(r.lo), hi: Math.log(r.hi) })), active: oSel },
    hillParams(),
    {},
  ];
  // Wide cards: the object is a large, quiet backdrop over the left column, its lower
  // part behind the step label and title (the copy sits at the bottom of the card).
  const FIT_WIDE = [
    { ax: 0.5, ay: 0.4, fw: 0.8, fh: 0.72 },
    { ax: 0.5, ay: 0.4, fw: 0.8, fh: 0.7 },
    { ax: 0.5, ay: 0.4, fw: 0.92, fh: 0.64 },
    { ax: 0.5, ay: 0.42, fw: 0.96, fh: 0.58 },
  ];
  const FIT_STACK = [0.52, 0.54, 0.6, 0.52].map((ay, i) => ({ ax: 0.5, ay, fw: 0.92, fh: i === 2 ? 0.78 : 0.9 }));
  const fx = cards.map((card, i) => scanlineObject(card.querySelector('canvas'), STEPS[i].scene, {
    pointerTarget: card, params: initial[i], fit: card.clientWidth >= 700 ? FIT_WIDE[i] : FIT_STACK[i],
  }));
  const wide = cards.map((c) => c.clientWidth >= 700);
  const refit = () => cards.forEach((c, i) => {
    const w = c.clientWidth >= 700;
    if (w !== wide[i]) { wide[i] = w; fx[i].set({ fit: w ? FIT_WIDE[i] : FIT_STACK[i] }); }
  });

  // ---------- widget interactions ----------
  // A row is selected on click and on keyboard focus only. Hover only previews the row in
  // the 3D object (no text or layout changes), so the rows never move under a still
  // pointer and a hover can never feed back into another selection.
  let fView = fSel;
  let oView = oSel;
  const showF = (i) => { if (i !== fView) { fView = i; fx[0].set({ marks: marks(i) }); } };
  const showO = (i) => { if (i !== oView) { oView = i; fx[1].set({ active: i }); } };
  const pickFinding = (i) => {
    if (i === fSel || !B.spans[i]) return;
    fSel = i;
    const w = wrap(0);
    w.querySelector('[data-q]').innerHTML = quoteHtml(B.enc.note || '', B.spans[i]);
    w.querySelectorAll('[data-f]').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.f) === i)));
    showF(i);
  };
  const pickOr = (i) => {
    if (i === oSel || !B.ors[i]) return;
    oSel = i;
    const w = wrap(1);
    w.querySelector('[data-od]').innerHTML = orDetail(B, i);
    w.querySelectorAll('[data-o]').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.o) === i)));
    showO(i);
  };
  // mouseover: the row under the pointer; mouseout: where the pointer went (null = gone).
  const onHover = (e) => {
    const n = e.type === 'mouseout' ? e.relatedTarget : e.target;
    const t = n instanceof Element && el.contains(n) ? n : null;
    const f = t?.closest('[data-f]');
    const o = t?.closest('[data-o]');
    showF(f ? Number(f.dataset.f) : fSel);
    showO(o ? Number(o.dataset.o) : oSel);
  };
  // Reserve the quote's height: the tallest of the quotes, at the current width, so
  // choosing another red flag never moves the rows below it.
  const fitQuote = () => {
    const qEl = wrap(0)?.querySelector('[data-q]');
    if (!qEl || !qEl.clientWidth) return;
    const keep = qEl.innerHTML;
    qEl.style.minHeight = '';
    let tall = 0;
    for (const s of B.spans) { qEl.innerHTML = quoteHtml(B.enc.note || '', s); tall = Math.max(tall, qEl.offsetHeight); }
    qEl.innerHTML = keep;
    qEl.style.minHeight = `${Math.ceil(tall)}px`;
  };
  const onPick = (e) => {
    const t = e.target instanceof Element ? e.target : null;
    if (!t) return;
    const f = t.closest('[data-f]');
    if (f && el.contains(f)) { pickFinding(Number(f.dataset.f)); return; }
    const o = t.closest('[data-o]');
    if (o && el.contains(o)) { pickOr(Number(o.dataset.o)); return; }
    if (e.type !== 'click') return;
    const l = t.closest('[data-st-line]');
    if (l && el.contains(l) && ctx?.setState) { ctx.setState({ line: Number(l.dataset.stLine) }); return; }
    const g = t.closest('[data-go]');
    if (g && el.contains(g)) goTo(Number(g.dataset.go));
  };
  el.addEventListener('click', onPick);
  el.addEventListener('focusin', onPick);
  el.addEventListener('mouseover', onHover);
  el.addEventListener('mouseout', onHover);

  const renderLine = () => {
    const w = wrap(2);
    const r = ev.range;
    w.querySelector('[data-rng]').innerHTML = `${esc(pctAt(r.lo, line))}<span class="st-big-to"> to </span>${esc(pctAt(r.hi, line))}`;
    w.querySelector('[data-ln]').style.left = `${(ax.u(line) * 100).toFixed(2)}%`;
    w.querySelector('[data-lnl]').textContent = `${lineLabel(line)} line`;
    w.querySelectorAll('[data-st-line]').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.stLine) === line)));
    w.querySelector('[data-verdict]').innerHTML = verdictHtml(ev, line);
    wrap(3).innerHTML = actWidget(B, ev);
    fx[2].set(hillParams());
  };

  // ---------- the pinned, scroll-driven track ----------
  const mqWide = matchMedia('(min-width: 900px) and (min-height: 600px)');
  const mqReduce = matchMedia('(prefers-reduced-motion: reduce)');
  const G = { top: 0, stageH: 0, stageW: 0, padX: 0, cardW: 0, step: 0, travel: 0, hold: 0 };
  let pinned = false;
  let active = -1;
  let raf = 0;
  let lay = 0;

  const topOffset = () => {
    const tb = document.querySelector('.topbar');
    if (!tb) return 0;
    const pos = getComputedStyle(tb).position;
    return pos === 'sticky' || pos === 'fixed' ? Math.round(tb.getBoundingClientRect().height) : 0;
  };
  // The heading rides in the sticky stage when there is room for it and a full card; on
  // shorter screens (a laptop with a two-row top bar) it scrolls away above the pinned
  // stage instead, so the cards never cover it or the progress row.
  const placeHead = (inside) => {
    if (inside) { if (head.parentNode !== stage) stage.prepend(head); }
    else if (head.parentNode !== el) pinEl.before(head);
    el.classList.toggle('st-head-out', !inside);
  };
  const setActive = (i) => {
    active = i;
    cards.forEach((c, k) => c.classList.toggle('is-active', k === i));
    progBtns.forEach((b, k) => b.setAttribute('aria-current', k === i ? 'step' : 'false'));
    if (pn) pn.textContent = pad(Math.max(0, i) + 1);
  };

  const apply = () => {
    raf = 0;
    if (!pinned) return;
    const r = pinEl.getBoundingClientRect();
    const x = clamp(G.top - r.top - G.hold, 0, G.travel);
    track.style.transform = `translate3d(${(-x).toFixed(1)}px,0,0)`;
    const n = cards.length;
    const u = G.travel > 0 ? x / G.travel : 0;
    const a = Math.round(u * (n - 1));
    if (a !== active) setActive(a);
    fills.forEach((f, i) => { f.style.transform = `scaleX(${clamp(u * (n - 1) + 1 - i, 0, 1).toFixed(3)})`; });
    const mid = G.stageW / 2;
    cards.forEach((c, i) => {
      const off = (G.padX + i * G.step + G.cardW / 2 - x - mid) / (G.stageW || 1);
      fx[i].set({ spin: clamp(off, -1, 1) * -0.6 });
    });
  };
  const onScroll = () => { if (pinned && !raf) raf = requestAnimationFrame(apply); };

  const layout = () => {
    lay = 0;
    const cs = getComputedStyle(el);
    const padX = parseFloat(cs.paddingLeft) || 0;
    const contentW = el.clientWidth - padX - (parseFloat(cs.paddingRight) || 0);
    const top = topOffset();
    const stageH = window.innerHeight - top;
    const want = mqWide.matches && !mqReduce.matches && contentW >= 760 && stageH >= 540;
    pinned = want;
    el.classList.toggle('is-pinned', want);
    if (!want) {
      placeHead(true);
      track.style.transform = '';
      pinEl.style.height = '';
      for (const p of ['--st-card-w', '--st-card-h', '--st-top']) el.style.removeProperty(p);
      cards.forEach((c) => c.classList.remove('is-active'));
      active = -1;
      fx.forEach((f) => f.set({ spin: 0 }));
      fitQuote();
      refit();
      return;
    }
    G.top = top;
    G.stageH = stageH;
    G.padX = padX;
    el.style.setProperty('--st-top', `${top}px`);
    G.stageW = stage.clientWidth;
    const cardW = Math.min(Math.round(clamp(contentW * 0.74, 700, 880)), Math.round(contentW - 60));
    // Room for a card: the stage minus its padding, the progress row (+ its margin) and the
    // track padding with a little air for the crop marks; minus the heading if it stays in.
    const sc = getComputedStyle(stage);
    const padY = (parseFloat(sc.paddingTop) || 0) + (parseFloat(sc.paddingBottom) || 0);
    const room = stageH - padY - prog.offsetHeight - 4 - 32 - 12;
    const headRoom = head.offsetHeight + 18; // .st-view margin-top while the heading is in
    const inside = room - headRoom >= 440;
    placeHead(inside);
    const cardH = Math.round(clamp(inside ? room - headRoom : room, 400, 540));
    el.style.setProperty('--st-card-w', `${cardW}px`);
    el.style.setProperty('--st-card-h', `${cardH}px`);
    const gap = parseFloat(getComputedStyle(track).columnGap) || 24;
    G.cardW = cardW;
    G.step = cardW + gap;
    G.travel = Math.max(0, cards.length * cardW + (cards.length - 1) * gap - contentW);
    G.hold = Math.round(stageH * 0.12);
    pinEl.style.height = `${Math.round(stageH + G.travel + 2 * G.hold)}px`;
    fitQuote();
    refit();
    active = -1;
    apply();
  };
  const schedule = () => { if (!lay) lay = requestAnimationFrame(layout); };

  // Scroll so that card i is the active one (progress buttons, keyboard focus).
  function goTo(i, instant = false) {
    const card = cards[i];
    if (!card) return;
    const smooth = !instant && !mqReduce.matches;
    if (!pinned) { card.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'nearest' }); return; }
    const pinTop = pinEl.getBoundingClientRect().top + window.scrollY;
    const x = cards.length > 1 ? (i / (cards.length - 1)) * G.travel : 0;
    window.scrollTo({ top: Math.round(pinTop - G.top + G.hold + x), behavior: smooth ? 'smooth' : 'auto' });
  }
  const onFocus = (e) => {
    if (!pinned) return;
    const card = e.target instanceof Element ? e.target.closest('.st-card') : null;
    const i = card ? cards.indexOf(card) : -1;
    if (i >= 0 && i !== active) goTo(i, true);
  };
  el.addEventListener('focusin', onFocus);

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', schedule);
  mqWide.addEventListener?.('change', schedule);
  mqReduce.addEventListener?.('change', schedule);
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
  if (ro) ro.observe(el);
  layout();
  document.fonts?.ready?.then(() => { if (cards[0]?.isConnected) schedule(); });

  return {
    update(c) {
      const nl = c?.state?.line;
      if (nl == null || nl === line) return;
      line = nl;
      ev = evalAt(line);
      renderLine();
    },
    unmount() {
      cancelAnimationFrame(raf);
      cancelAnimationFrame(lay);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', schedule);
      mqWide.removeEventListener?.('change', schedule);
      mqReduce.removeEventListener?.('change', schedule);
      if (ro) ro.disconnect();
      el.removeEventListener('click', onPick);
      el.removeEventListener('focusin', onPick);
      el.removeEventListener('mouseover', onHover);
      el.removeEventListener('mouseout', onHover);
      el.removeEventListener('focusin', onFocus);
      fx.forEach((f) => f.destroy());
      el.classList.remove('st', 'is-pinned', 'st-head-out');
      for (const p of ['--st-card-w', '--st-card-h', '--st-top']) el.style.removeProperty(p);
      el.innerHTML = '';
    },
  };
}
