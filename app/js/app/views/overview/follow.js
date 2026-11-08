// Overview section 4, "Follow one patient": Alex's visits on a real time axis, the tool's
// tier at each one, when the tool says refer and when the real referral came. Extracted
// from the earlier single-file overview with the same content and numbers. Every number
// is computed here at run time from the engine and the case file; none is typed in.
// The story is Alex's on purpose (a case study): it imports ALEX and never follows the
// case picked in the top bar (when another case is open it shows Alex at the visit every
// referral line agrees on, with nothing left out, and says so).
import { esc, fmtDate, TIER, tierChip, simChip, ensureCss, plural, monthsBetween, pct } from '../../ui.js';
import { timeline, monthsSaved } from '../../../engine.js';
import { REFERRAL_LINES } from '../../../weights.js';
import { ALEX } from '../../../alex.js';

const DAY = 86400000;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// '2024-06' (month only) sits mid-month on the axis.
const toT = (d) => Date.parse(`${d.length === 7 ? `${d}-15` : d}T00:00:00Z`);
const lineLabel = (v) => REFERRAL_LINES.find((l) => l.value === v)?.label || pct(v);
const A = ALEX.actual;
const ENCS = [...ALEX.encounters].sort((a, b) => a.date.localeCompare(b.date));
const WAIT_WEEKS = Math.floor((toT(A.firstNeurology) - toT(A.referral)) / (7 * DAY));
const usesSim = (ev) => !!ev?.state?.instances?.some((i) => i.simulated);
const ALEX_ID = 'alex';
// Card summaries written to fit two lines of a timeline card; the full visit title stays
// in the card's tooltip and accessible name.
const SHORT = {
  e1: 'Suspected carpal tunnel',
  e2: 'Wrist tests normal; two-nerve wasting',
  e3: 'No better after surgery; twitching',
  e4: 'Right foot catches and slaps',
  e5: 'Brisk reflexes; urges neurology',
  e6: 'Urgent referral to neurology',
  e7: 'Signs in three body regions',
};
const alexOpen = (ctx) => (ctx.caseEntry?.id ?? ALEX_ID) === ALEX_ID;

// The visit every referral line agrees on (notes only): the strictest line fires last.
let PROMPT;
function everyLinePrompt() {
  if (PROMPT !== undefined) return PROMPT;
  const per = REFERRAL_LINES.map((l) => monthsSaved(ALEX, { referralLine: l.value, includeHomeTests: false }));
  const fired = per.filter((ms) => ms.firstHigh && Number.isFinite(ms.monthsVsReferral) && ms.monthsVsReferral > 0);
  PROMPT = per.length > 0 && fired.length === per.length ? fired.map((ms) => ms.firstHigh).sort().at(-1) : null;
  return PROMPT;
}

function derive(ctx) {
  // The visit and what-if in the shared state belong to the open case. When that is not
  // Alex, show Alex at the visit every referral line agrees on, with nothing left out.
  const open = alexOpen(ctx);
  const s = open ? ctx.state : { ...ctx.state, asOf: everyLinePrompt() || ENCS.at(-1).date, exclude: [] };
  const baseOpts = open ? ctx.opts : { ...ctx.opts, exclude: new Set() };
  const notesOpts = { ...baseOpts, includeHomeTests: false };
  const tlNotes = timeline(ALEX, notesOpts);
  const cur = monthsSaved(ALEX, notesOpts);
  const tl = s.includeHome ? timeline(ALEX, baseOpts) : tlNotes;
  const sim = s.includeHome ? monthsSaved(ALEX, baseOpts) : null;
  const first = tl.find((e) => e.tier === 'high') || null;
  const gap = s.includeHome ? sim : cur;
  // first visit where a notes-based pattern rule fires: those rules do not depend on the line
  const firstRule = tl.find((e) => e.encounter && e.rulesFired.some((r) => r.id !== 'unclear_with_decline')) || null;
  // A first prompt from the number alone (3% and 5%: 14 Oct 2024, only just) is never the
  // headline, so the timeline's main marker and gap use the first pattern-rule visit.
  const numberOnly = !!(first && !first.rulesFired.length && firstRule && firstRule.asOf > first.asOf);
  const main = numberOnly ? firstRule : first;
  const everyLine = !!(main && firstRule && main.asOf === firstRule.asOf);
  const mainMonths = !main ? null : main === first ? gap?.monthsVsReferral : monthsBetween(main.asOf, A.referral);
  return { s, tl, first, firstRule, numberOnly, main, everyLine, mainMonths, alexOpen: open, entry: ctx.caseEntry || null };
}

// ---------- the time axis ----------
const DOM0 = toT(A.firstSymptom) - 45 * DAY;
const DOM1 = toT(A.diagnosis) + 50 * DAY;
const xPct = (d) => ((toT(d) - DOM0) / (DOM1 - DOM0)) * 100;
const NOMINAL_W = 960; // px; the plot never gets narrower (it scrolls instead)

function ticks() {
  const out = [];
  const d0 = new Date(DOM0);
  let y = d0.getUTCFullYear();
  let m = d0.getUTCMonth() + 1;
  for (let k = 0; k < 60; k++) {
    if (m > 11) { m = 0; y += 1; }
    const t = Date.UTC(y, m, 1);
    if (t > DOM1) break;
    if (m % 3 === 0) out.push({ x: ((t - DOM0) / (DOM1 - DOM0)) * 100, label: m === 0 || !out.length ? `${MON[m]} ${y}` : MON[m] });
    m += 1;
  }
  return out;
}

// Stagger milestone flags so no two labels, and no label and stem, collide.
function placeFlags(flags) {
  const placed = [];
  for (const f of [...flags].sort((a, b) => a.x - b.x)) {
    const chars = Math.max(f.label.length * 7.4, fmtDate(f.date).length * 7.6) + 16;
    const w = (chars / NOMINAL_W) * 100;
    f.align = f.x < 9 ? 'start' : f.x > 90 ? 'end' : 'center';
    f.l = f.align === 'start' ? f.x : f.align === 'end' ? f.x - w : f.x - w / 2;
    f.r = f.l + w;
    for (let L = 0; L < 4; L++) {
      const clash = placed.some((p) => (p.level === L && f.l < p.r + 0.6 && p.l < f.r + 0.6)
        || (p.level < L && f.x > p.l - 0.4 && f.x < p.r + 0.4)
        || (p.level > L && p.x > f.l - 0.4 && p.x < f.r + 0.4));
      if (!clash) { f.level = L; break; }
    }
    if (f.level == null) f.level = 0;
    placed.push(f);
  }
  return placed;
}

function timelineHtml(d) {
  const { s, tl, first, firstRule, numberOnly, main, everyLine, mainMonths } = d;
  const n = ENCS.length;
  const evFor = (enc) => tl.find((e) => e.encounter && e.encounter.id === enc.id) || null;
  const L = lineLabel(s.line);
  const mainSim = !everyLine && usesSim(main);
  const close = numberOnly && first.range.lo / s.line < 1.5;

  const flags = placeFlags([
    { key: 'symptom', label: 'First symptom', date: A.firstSymptom, x: xPct(A.firstSymptom) },
    main && { key: 'tool', label: everyLine ? 'Tool says refer · every line' : 'Tool says refer', date: main.asOf, x: xPct(main.asOf), sim: mainSim },
    { key: 'referral', label: 'Real referral', date: A.referral, x: xPct(A.referral) },
    { key: 'dx', label: 'Diagnosis', date: A.diagnosis, x: xPct(A.diagnosis) },
  ].filter(Boolean));
  const levels = Math.max(1, ...flags.map((f) => f.level + 1));

  // vertical layout (px)
  const RULER = 18;
  const BR_Y = 38;
  const FLAG_H = 34;
  const FLAG_STEP = 42;
  const flagsTop = 58;
  const stripY = flagsTop + levels * FLAG_STEP + 10;
  const connTop = stripY + 8;
  const CONN_H = 40;
  const plotH = connTop + CONN_H;
  const flagTop = (lv) => flagsTop + (levels - 1 - lv) * FLAG_STEP;

  const grid = ticks().map((t) => `<span class="ov-grid" style="left:${t.x.toFixed(2)}%;top:${RULER}px;height:${stripY - RULER}px"></span><span class="ov-tick" style="left:${t.x.toFixed(2)}%">${esc(t.label)}</span>`).join('');

  const brackets = [];
  if (main && mainMonths > 0) {
    const x1 = xPct(main.asOf);
    const x2 = xPct(A.referral);
    brackets.push(`<div class="ov-br" style="left:${x1.toFixed(2)}%;width:${(x2 - x1).toFixed(2)}%;top:${BR_Y}px"><span class="ov-br-l">${esc(mainMonths)} months earlier <span class="ov-br-sub">${everyLine ? 'at every line' : `at the ${esc(L)} line`}</span>${mainSim ? ' ' + simChip() : ''}</span></div>`);
  }
  if (A.firstNeurology > A.referral) {
    const x1 = xPct(A.referral);
    const x2 = xPct(A.firstNeurology);
    brackets.push(`<div class="ov-br is-wait" style="left:${x1.toFixed(2)}%;width:${(x2 - x1).toFixed(2)}%;top:${BR_Y}px"><span class="ov-br-l">${WAIT_WEEKS}-wk wait</span></div>`);
  }

  const flagEls = flags.map((f) => {
    const top = flagTop(f.level);
    const stem = `<span class="ov-stem${f.key === 'tool' ? ' is-tool' : ''}" style="left:${f.x.toFixed(2)}%;top:${top + FLAG_H}px;height:${Math.max(4, stripY - 3 - (top + FLAG_H))}px"></span>`;
    return `${stem}<div class="ov-flag al-${f.align}${f.key === 'tool' ? ' is-tool' : ''}" style="left:${f.x.toFixed(2)}%;top:${top}px"><span class="micro">${esc(f.label)}</span><span class="ov-flag-d">${fmtDate(f.date)}${f.sim ? ' ' + simChip() : ''}</span></div>`;
  }).join('');

  // tier strip: the tool's tier over time (grey before the first visit)
  const pts = [{ date: A.firstSymptom, tier: 'none' }, ...tl.map((e) => ({ date: e.asOf, tier: e.tier }))];
  const segs = [];
  for (const p of pts) { if (segs.length && segs.at(-1).tier === p.tier) continue; segs.push({ start: p.date, tier: p.tier }); }
  segs.forEach((g, i) => { g.end = segs[i + 1]?.start || A.diagnosis; });
  const tierWord = (t) => (t === 'none' ? 'No visit yet' : TIER[t]?.label || t);
  const stripLabel = segs.map((g) => `${tierWord(g.tier)} from ${fmtDate(g.start)}`).join('; ');
  const strip = segs.map((g) => {
    const x1 = xPct(g.start);
    const w = Math.max(0.3, xPct(g.end) - x1);
    return `<span class="ov-seg is-${g.tier}" style="left:${x1.toFixed(2)}%;width:calc(${w.toFixed(2)}% - 2px)" title="${esc(`${tierWord(g.tier)} from ${fmtDate(g.start)}`)}"></span>`;
  }).join('');
  // Visits closer than one marker at the narrowest plot (V5 and V6 are 6 days apart) share
  // a double marker: one ringed pill with a dot at each visit's true date.
  const PLOT_MIN = 944; // .ov-tl min-width less its side padding
  const MARK = 14;
  const xs = ENCS.map((e) => xPct(e.date));
  const groups = [];
  xs.forEach((x, i) => {
    const g = groups.at(-1);
    if (g && ((x - xs[g.at(-1)]) / 100) * PLOT_MIN < MARK) g.push(i); else groups.push([i]);
  });
  const dots = groups.map((g) => {
    if (g.length === 1) return `<span class="ov-dot" data-i="${g[0]}" style="left:${xs[g[0]].toFixed(2)}%;top:${stripY}px"></span>`;
    const x1 = xs[g[0]];
    const x2 = xs[g.at(-1)];
    return `<span class="ov-dots" style="left:${x1.toFixed(2)}%;width:calc(${(x2 - x1).toFixed(2)}% + ${MARK}px);top:${stripY}px"></span>`
      + g.map((i) => `<span class="ov-dot is-pair" data-i="${i}" style="left:${xs[i].toFixed(2)}%;top:${stripY}px"></span>`).join('');
  }).join('');
  const conns = ENCS.map((e, i) => {
    const x1 = xPct(e.date) * 10;
    const x2 = ((i + 0.5) / n) * 1000;
    return `<path class="ov-conn" data-i="${i}" vector-effect="non-scaling-stroke" d="M${x1.toFixed(1)} 0 V${(CONN_H / 2).toFixed(0)} H${x2.toFixed(1)} V${CONN_H}"/>`;
  }).join('');

  // Each card names its visit's role in one short line (the full words are its tooltip and
  // part of its accessible name). The tier chip shows only where the tier changes and on
  // the selected visit: the strip and the legend already carry the tier between those.
  let prevTier = 'none';
  const cards = ENCS.map((enc, i) => {
    const ev = evFor(enc);
    const tier = ev?.tier;
    const marks = [];
    const mark = (cls, short, full) => marks.push({ html: `<span class="ov-enc-mark${cls ? ` ${cls}` : ''}" title="${esc(full)}">${esc(short)}</span>`, full });
    if (numberOnly && first.asOf === enc.date) mark('', `Over ${L}${close ? ' · just' : ''}`, `Number over the ${L} line${close ? ', only just' : ''}`);
    if (main && main.asOf === enc.date) {
      const byNumber = !everyLine && !main.rulesFired.length;
      mark('is-tool', byNumber ? 'Refer · number' : 'Tool: refer', `Tool says refer${everyLine ? ' at every line' : byNumber ? ' (from the number)' : ''}`);
    } else if (firstRule && firstRule.asOf === enc.date) mark('is-rule', 'Pattern rule', 'Pattern rule fires at every line');
    if (enc.date === A.referral) mark('', 'Real referral', 'Real referral');
    if (enc.date === A.firstNeurology) mark('', `${WAIT_WEEKS}-week wait`, `Specialist seen after a ${WAIT_WEEKS}-week wait`);
    const cur = enc.date === s.asOf;
    const showTier = !!tier && (tier !== prevTier || cur);
    if (tier) prevTier = tier;
    const aria = `Visit ${i + 1}, ${fmtDate(enc.date)}, ${enc.setting}: ${enc.title}.${marks.map((m) => ` ${m.full}.`).join('')} Tool's tier: ${tier ? TIER[tier]?.label : 'none'}. Open in the red-flag indicator.`;
    return `<li><button type="button" class="ov-enc${cur ? ' is-current' : ''}" data-ov-visit="${esc(enc.date)}" data-i="${i}" aria-label="${esc(aria)}"${cur ? ' aria-current="true"' : ''}>
      <span class="ov-enc-top"><span class="ov-enc-n">V${i + 1}</span><span class="ov-enc-date">${fmtDate(enc.date)}</span></span>
      ${marks.map((m) => m.html).join('')}
      <span class="ov-enc-set">${esc(enc.setting)}</span>
      <span class="ov-enc-title" title="${esc(enc.title)}">${esc(SHORT[enc.id] || enc.title)}</span>
      <span class="ov-enc-foot">${showTier ? tierChip(tier) : ''}${usesSim(ev) ? simChip() : ''}</span>
    </button></li>`;
  }).join('');

  const tierKeys = ['high', 'unclear', 'low'].filter((t) => segs.some((g) => g.tier === t));
  const legend = [
    ...tierKeys.map((t) => `<span class="ov-key"><i class="ov-sw is-${t}"></i>${esc(TIER[t].label)} · ${esc(TIER[t].action)}</span>`),
    '<span class="ov-key"><i class="ov-sw is-none"></i>Before the first visit</span>',
    '<span class="ov-key"><i class="ov-sw is-dot"></i>A visit (click a card to open it)</span>',
  ].join('');

  // Phones get a stacked list instead of the axis; this line carries the axis's brackets.
  const sum = main && mainMonths > 0
    ? `<p class="ov-tl-sum">Tool says refer <b>${fmtDate(main.asOf)}</b>, real referral <b>${fmtDate(A.referral)}</b>: <b>${esc(mainMonths)} months earlier</b> ${everyLine ? 'at every line' : `at the ${esc(L)} line`}${mainSim ? ' ' + simChip() : ''}.${A.firstNeurology > A.referral ? ` Then a ${WAIT_WEEKS}-week wait for the specialist.` : ''}</p>`
    : '';
  return `${sum}
    <div class="ov-tl-scroll" tabindex="0" aria-label="Alex's visits on a time axis. Scrolls sideways on small screens.">
      <div class="ov-tl">
        <div class="ov-plot" style="height:${plotH}px">
          ${grid}
          ${brackets.join('')}
          ${flagEls}
          <div class="ov-strip" role="img" aria-label="${esc(`Tool's tier over time: ${stripLabel}`)}" style="top:${stripY - 3}px">${strip}</div>
          ${dots}
          <svg class="ov-conn-svg" style="top:${connTop}px;height:${CONN_H}px" viewBox="0 0 1000 ${CONN_H}" preserveAspectRatio="none" aria-hidden="true">${conns}</svg>
        </div>
        <ol class="ov-cards" style="grid-template-columns:repeat(${n}, minmax(0, 1fr))">${cards}</ol>
      </div>
    </div>
    <div class="ov-tl-foot">
      <div class="ov-legend">${legend}</div>
      <span class="ov-hint micro" aria-hidden="true">Scroll sideways →</span>
    </div>`;
}

function headHtml(d) {
  const { s, main, everyLine } = d;
  const vTool = main ? ENCS.findIndex((e) => e.date === main.asOf) : -1;
  const vRef = ENCS.findIndex((e) => e.date === A.referral);
  const clinicians = new Set(ENCS.map((e) => e.clinician)).size;
  // The pattern section above already counts the visits and clinicians, so this title
  // leads with the contrast; the counts stay as the fallback when the tool never says refer.
  // "By": at the 3% and 5% lines the number alone already crosses the line one visit
  // earlier (only just; marked on that card), so "at visit 2, at every line" would overstate.
  let lead = `${plural(ENCS.length, 'visit')}, ${plural(clinicians, 'clinician')}.`;
  const at = vTool >= 0 ? `visit ${vTool + 1}` : main ? fmtDate(main.asOf) : '';
  if (main && everyLine) lead = `At every referral line, the tool says refer by ${at}.`;
  else if (main) lead = `The tool says refer ${vTool >= 0 ? 'at' : 'on'} ${at}.`;
  const soft = vRef >= 0 ? `The real referral came at visit ${vRef + 1}.` : '';
  const seg = REFERRAL_LINES.map((l) => `<button type="button" class="mono" data-fl-line="${l.value}" aria-pressed="${l.value === s.line}" title="${esc(l.note)}">${esc(l.label)}</button>`).join('');
  const other = !d.alexOpen && d.entry
    ? `<p class="ov-case-note">The patient pages are showing <b>${esc(d.entry.name)}</b>. This timeline always follows Alex.</p>`
    : '';
  return `
    <div class="ov-sec-text">
      <div class="micro dot">Follow one patient · Alex Chen, 45, teacher (fictional)</div>
      <h2 class="ov-h2 two-tone" id="ov-follow-title">${esc(lead)}${soft ? ` <span class="soft">${esc(soft)}</span>` : ''}</h2>
      ${other}
    </div>
    <div class="ov-sec-aside fl-aside">
      <span class="micro" id="fl-line-lbl">Tiers at the referral line</span>
      <div class="fl-aside-row">
        <div class="seg" role="group" aria-labelledby="fl-line-lbl">${seg}</div>
        ${s.includeHome ? simChip() : '<span class="chip real">Notes only</span>'}
      </div>
    </div>`;
}

export function mount(root, ctx) {
  ensureCss('css/views/overview.css');
  let cur = ctx;
  let leaving = false;
  let leaveTimer = 0;
  root.setAttribute('aria-labelledby', 'ov-follow-title');
  root.removeAttribute('aria-label');

  const d0 = derive(ctx);
  root.innerHTML = `
    <div class="ov-in">
      <header class="ov-sec-head" data-part="follow-head">${headHtml(d0)}</header>
      <div class="card ov-tl-card" data-part="tl">${timelineHtml(d0)}</div>
    </div>`;

  const part = (k) => root.querySelector(`[data-part="${k}"]`);
  const scroller = () => root.querySelector('.ov-tl-scroll');

  function checkScroll() {
    const sc = scroller();
    const card = part('tl');
    if (sc && card) card.classList.toggle('can-scroll', sc.scrollWidth > sc.clientWidth + 2);
  }

  function render(c) {
    const d = derive(c);
    const sc = scroller();
    const left = sc ? sc.scrollLeft : 0;
    const focusedLine = document.activeElement?.closest?.('[data-fl-line]')?.dataset.flLine;
    part('follow-head').innerHTML = headHtml(d);
    part('tl').innerHTML = timelineHtml(d);
    const sc2 = scroller();
    if (sc2) sc2.scrollLeft = left;
    // keep keyboard focus on the line button that was pressed
    if (focusedLine) root.querySelector(`[data-fl-line="${focusedLine}"]`)?.focus();
    checkScroll();
  }

  function highlight(i, on) {
    root.querySelectorAll(`.ov-conn[data-i="${i}"], .ov-dot[data-i="${i}"], .ov-enc[data-i="${i}"]`).forEach((n) => n.classList.toggle('is-hl', on));
  }

  // Make Alex the open case (no-op when he already is, so his visit and what-if stay).
  function openAlex() {
    if ((cur.caseEntry?.id ?? ALEX_ID) === ALEX_ID) return;
    if (typeof cur.openCase === 'function') cur.openCase(ALEX_ID);
    else cur.setState({ caseId: ALEX_ID, exclude: [] });
  }
  function leave() {
    leaving = true;
    clearTimeout(leaveTimer);
    leaveTimer = setTimeout(() => { leaving = false; }, 1500);
  }

  function onClick(e) {
    const t = e.target.closest('[data-fl-line],[data-ov-visit]');
    if (!t || !root.contains(t)) return;
    if (t.dataset.flLine) cur.setState({ line: Number(t.dataset.flLine) });
    else if (t.dataset.ovVisit) {
      leave();
      openAlex();
      cur.setState({ asOf: t.dataset.ovVisit });
      cur.navigate('indicator');
    }
  }
  const onOver = (e) => { const t = e.target.closest?.('.ov-enc'); if (t) highlight(t.dataset.i, true); };
  const onOut = (e) => { const t = e.target.closest?.('.ov-enc'); if (t) highlight(t.dataset.i, false); };

  root.addEventListener('click', onClick);
  root.addEventListener('pointerover', onOver);
  root.addEventListener('pointerout', onOut);
  root.addEventListener('focusin', onOver);
  root.addEventListener('focusout', onOut);
  window.addEventListener('resize', checkScroll);
  requestAnimationFrame(checkScroll);

  return {
    update(c) {
      cur = c;
      if (leaving) return;
      render(c);
    },
    unmount() {
      clearTimeout(leaveTimer);
      root.removeEventListener('click', onClick);
      root.removeEventListener('pointerover', onOver);
      root.removeEventListener('pointerout', onOut);
      root.removeEventListener('focusin', onOver);
      root.removeEventListener('focusout', onOut);
      window.removeEventListener('resize', checkScroll);
    },
  };
}
