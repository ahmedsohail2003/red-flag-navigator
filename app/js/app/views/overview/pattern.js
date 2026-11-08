// Overview section: "Each saw one part". The reference's live fleet grid, adapted:
// rows are Alex's visits, columns are body regions, and a filled cell means a red flag for
// that region was written down at that visit (counted from alex.js, pattern signs included).
// Hover, focus or click a cell: the detail row shows the red flags, the exact words from the
// note, who wrote them, and what the indicator would have said at that visit (notes only, at
// the current referral line). "One clinician at a time" dims every visit but one and steps
// through them; "All visits together" shows the whole pattern. When the section first comes
// into view the visits replay in date order (not with reduced motion).
// Every count, date and tier is computed here from the case file and the engine.
import { esc, fmtDate, TIER, tierChip, ensureCss, plural, monthsBetween, rangeAt, pct, pctAt } from '../../ui.js';
import { timeline, FINDINGS } from '../../../engine.js';
import { REFERRAL_LINES } from '../../../weights.js';
import { ALEX } from '../../../alex.js';
import { REGION_LABEL } from '../../../cases.js';
import { prefersReducedMotion } from '../../../fx/core.js';

const REGIONS = ['arm', 'leg', 'bulbar', 'breathing', 'general'];
const SHORT = { arm: 'Hand', leg: 'Leg', bulbar: 'Speech', breathing: 'Breath', general: 'Body' };
const ENCS = [...ALEX.encounters].sort((a, b) => a.date.localeCompare(b.date));
const regionOf = (f) => f.region || FINDINGS[f.id]?.region || 'other';
// CELLS[k][c]: the findings recorded at visit k for region c
const CELLS = ENCS.map((e) => REGIONS.map((r) => (e.findings || []).filter((f) => regionOf(f) === r)));
const OUTSIDE = ENCS.map((e) => (e.findings || []).filter((f) => !REGIONS.includes(regionOf(f))));
const CLINICIANS = new Set(ENCS.map((e) => e.clinician || e.setting)).size;
const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const word = (n) => WORDS[n] || String(n);
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const shortLabel = (id) => (FINDINGS[id]?.label || id).split(/[:(]/)[0].trim();
// findings with no odds ratio of their own (pattern signs, context flags) are tagged by kind
const kindOf = (id) => (FINDINGS[id] && FINDINGS[id].or == null && FINDINGS[id].group ? FINDINGS[id].group : '');
const level = (n) => (n >= 4 ? 4 : n);
const firstSeen = REGIONS.map((r, c) => { const k = CELLS.findIndex((row) => row[c].length > 0); return k < 0 ? null : ENCS[k].date; });
const totals = REGIONS.map((r, c) => CELLS.reduce((s, row) => s + row[c].length, 0));
const KINDS = [...new Set(CELLS.flat(2).map((f) => kindOf(f.id)).filter(Boolean))];
const lineLabel = (v) => REFERRAL_LINES.find((l) => l.value === v)?.label || pct(v);
// Mentions the case file keeps but does not weight (labelled "(not weighted)" in the note's
// negatives, e.g. a possible early speech change), placed in a region by the words of their label.
const REGION_WORDS = {
  arm: /\b(hand|arm|grip|finger|wrist)/i, leg: /\b(leg|foot|feet|walk|gait|trip)/i,
  bulbar: /\b(speech|speak|voice|swallow|chok|tongue)/i, breathing: /\b(breath|cough)/i, general: /\b(weight|tired|fatigue)/i,
};
const notWeighted = (e, r) => (e.negatives || []).filter((x) => x.quote && /not weighted/i.test(x.label || '')
  && (x.region ? x.region === r : REGION_WORDS[r]?.test(x.label || '')));

const STEP_MS = 1600;   // one clinician at a time
const REPLAY_MS = 560;  // replay, one visit per step

// the indicator's evaluation at each visit, notes only, at a referral line (cached per line)
const tlCache = new Map();
function visitTiers(line) {
  if (!tlCache.has(line)) {
    const tl = timeline(ALEX, { referralLine: line, includeHomeTests: false });
    tlCache.set(line, ENCS.map((e) => tl.find((ev) => ev.encounter && ev.encounter.id === e.id) || null));
  }
  return tlCache.get(line);
}

function lede() {
  const parts = [];
  const at = (c) => (firstSeen[c] ? fmtDate(firstSeen[c]) : null);
  if (at(0)) parts.push(`the hand and arm from ${at(0)}`);
  if (at(1)) parts.push(`the leg from ${at(1)}`);
  const late = [2, 3].filter((c) => at(c));
  if (late.length) {
    const what = late.length === 2 ? 'speech, swallowing and breathing' : late[0] === 2 ? 'speech and swallowing' : 'breathing';
    const by = late.map((c) => firstSeen[c]).sort().at(-1);
    parts.push(`${what} by ${fmtDate(by)}`);
  }
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')}, then ${parts.at(-1)}` : parts.join('');
  return `Each clinician wrote down the red flags in front of them. Side by side, the notes show ${list}.`;
}

function tableHtml() {
  const head = REGIONS.map((r) => `<th scope="col" class="ovp-ch"><span class="ovp-full">${esc(REGION_LABEL[r])}</span><span class="ovp-short" aria-hidden="true">${esc(SHORT[r])}</span></th>`).join('');
  const rows = ENCS.map((e, k) => {
    const cells = REGIONS.map((r, c) => {
      const n = CELLS[k][c].length;
      const label = `${fmtDate(e.date)}, ${e.setting}, ${REGION_LABEL[r]}: ${n ? plural(n, 'red flag') : 'no red flag counted'}`;
      return `<td role="gridcell" class="ovp-cell l${level(n)}" data-k="${k}" data-c="${c}" tabindex="-1" aria-label="${esc(label)}"><span class="ovp-n">${n ? String(n).padStart(2, '0') : ''}</span><span class="ovp-pip" aria-hidden="true"></span></td>`;
    }).join('');
    return `<tr data-row="${k}"><th scope="row" class="ovp-visit"><span class="ovp-date">${esc(fmtDate(e.date))}</span><span class="ovp-set">${esc(e.setting)}</span></th>${cells}<td class="ovp-tool" data-tool="${k}"></td></tr>`;
  }).join('');
  return `<table class="ovp-grid" role="grid" aria-label="Red flags recorded at each of Alex's visits, by body region. Use the arrow keys to move between cells.">
    <thead><tr><th scope="col" class="ovp-vh"><span class="ovp-full">Visit</span><span class="ovp-short" aria-hidden="true">Visit</span></th>${head}<th scope="col" class="ovp-th-tool">Indicator</th></tr></thead>
    <tbody>${rows}</tbody></table>`;
}

function html() {
  return `
  <section class="ovp" aria-labelledby="ovp-title">
    <header class="ovp-head">
      <div class="micro dot ovp-eyebrow">The pattern</div>
      <h2 class="ovp-title two-tone" id="ovp-title">${cap(word(ENCS.length))} visits, ${word(CLINICIANS)} clinicians. <span class="soft">Each treated one part; the signs elsewhere were written down, but nobody acted on them together for about 16 months.</span></h2>
      <p class="ovp-lede">${esc(lede())}</p>
    </header>
    <div class="ovp-frame">
      <span class="ovp-crop tl" aria-hidden="true"></span><span class="ovp-crop tr" aria-hidden="true"></span><span class="ovp-crop bl" aria-hidden="true"></span><span class="ovp-crop br" aria-hidden="true"></span>
      <div class="ovp-panel">
        <div class="ovp-bar">
          <span class="micro">${esc(ALEX.patient.name)} · ${ENCS.length} visits × ${REGIONS.length} body regions</span>
          <span class="micro dot ovp-live" data-live>All ${ENCS.length} visits</span>
        </div>
        <div class="ovp-tools">
          <div class="seg" role="group" aria-label="How to read the visits">
            <button type="button" data-mode="one" aria-pressed="false">One clinician at a time</button>
            <button type="button" data-mode="all" aria-pressed="true">All visits together</button>
          </div>
          <div class="ovp-step" data-stepper hidden>
            <button type="button" class="btn sm" data-step="-1" aria-label="Previous visit">&larr;</button>
            <button type="button" class="btn sm" data-step="1" aria-label="Next visit">&rarr;</button>
          </div>
          <span class="spacer"></span>
          <button type="button" class="btn sm quiet" data-replay>Replay the visits</button>
        </div>
        <div class="ovp-scroll">${tableHtml()}</div>
        <div class="ovp-detail" data-detail><div class="ovp-dc"></div><div class="ovp-dc ovp-dmain" aria-live="off"></div><div class="ovp-dc"></div></div>
      </div>
    </div>
    <p class="note ovp-foot">Counts are the red flags extracted from each note, each with the sentence it came from${KINDS.length ? `; ${esc(KINDS.map((k) => `${k.toLowerCase()}s`).join(' and '))} count too` : ''}.${OUTSIDE.some((o) => o.length) ? ` ${esc(plural(OUTSIDE.reduce((s, o) => s + o.length, 0), 'finding'))} outside these five regions (thinking and mood) ${OUTSIDE.reduce((s, o) => s + o.length, 0) === 1 ? 'is' : 'are'} not shown.` : ''} The indicator column reads the notes only, at the referral line chosen in the top bar.</p>
  </section>`;
}

// ---------- detail row ----------
function toolBlock(ev, line) {
  if (!ev) return '<div class="ovp-dv">No evaluation for this visit.</div>';
  const rules = ev.rulesFired.length ? `<ul class="ovp-rules">${ev.rulesFired.map((r) => `<li>${esc(r.label)}</li>`).join('')}</ul>` : `<p class="ovp-why">${esc(ev.reason)}.</p>`;
  return `<div class="ovp-tierline">${chipFor(ev, line)}<span class="ovp-act">${esc(TIER[ev.tier]?.action || '')}</span></div>
    <p class="ovp-range">Likelihood range <span class="mono">${esc(rangeAt(ev.range, line))}</span> against the <span class="mono">${esc(lineLabel(line))}</span> line</p>
    ${rules}`;
}

function cellDetail(k, c, line) {
  const e = ENCS[k];
  const flags = CELLS[k][c];
  const ev = visitTiers(line)[k];
  const list = flags.length
    ? `<ul class="ovp-flags">${flags.map((f) => `<li><span class="ovp-fl">${esc(shortLabel(f.id))}${kindOf(f.id) ? `<span class="ovp-tag">${esc(kindOf(f.id))}</span>` : ''}</span><q class="ovp-q">${esc(f.quote)}</q></li>`).join('')}</ul>`
    : `<p class="ovp-none">No red flag for ${esc(REGION_LABEL[REGIONS[c]].toLowerCase())} was counted at this visit.</p>${notWeighted(e, REGIONS[c]).map((x) => `<p class="ovp-none ovp-also">Also in the note, not weighted: <q class="ovp-q">${esc(x.quote)}</q></p>`).join('')}`;
  return `
    <div class="ovp-dc"><div class="micro">Visit ${k + 1} of ${ENCS.length}</div><div class="ovp-dv"><b>${esc(fmtDate(e.date))}</b></div><div class="ovp-ds">${esc(e.setting)}</div><div class="ovp-dn">${esc(e.clinician || '')}</div></div>
    <div class="ovp-dc ovp-dmain"><div class="micro">${esc(REGION_LABEL[REGIONS[c]])} · ${esc(plural(flags.length, 'red flag'))}</div>${list}</div>
    <div class="ovp-dc"><div class="micro">Indicator at this visit · notes only</div>${toolBlock(ev, line)}</div>`;
}

function visitDetail(k, line) {
  const e = ENCS[k];
  const ev = visitTiers(line)[k];
  const lines = REGIONS.map((r, c) => {
    const f = CELLS[k][c];
    if (!f.length) return '';
    return `<li><span class="ovp-fl">${esc(REGION_LABEL[r])} <span class="mono ovp-cnt">${f.length}</span></span><span class="ovp-names">${esc([...new Set(f.map((x) => shortLabel(x.id).toLowerCase()))].join(', '))}</span></li>`;
  }).join('');
  const n = CELLS[k].reduce((s, f) => s + f.length, 0);
  return `
    <div class="ovp-dc"><div class="micro">Visit ${k + 1} of ${ENCS.length}</div><div class="ovp-dv"><b>${esc(fmtDate(e.date))}</b></div><div class="ovp-ds">${esc(e.setting)}</div><div class="ovp-dn">${esc(e.clinician || '')}</div></div>
    <div class="ovp-dc ovp-dmain"><div class="micro">What this clinician recorded · ${esc(plural(n, 'red flag'))}</div><ul class="ovp-flags ovp-sum">${lines}</ul>${e.whatHappened ? `<p class="ovp-what"><span class="micro">What happened</span> ${esc(e.whatHappened)}</p>` : ''}</div>
    <div class="ovp-dc"><div class="micro">Indicator at this visit · notes only</div>${toolBlock(ev, line)}</div>`;
}

// The first visit where a notes pattern rule fires. Those rules do not depend on the referral
// line, so this is the date the page claims (as the indicator, follow and evidence views do).
// A High from the number alone can come one visit earlier at the low lines, only just; it is
// shown, never claimed.
const ruleVisit = (tiers) => tiers.findIndex((ev) => ev && ev.rulesFired.some((r) => r.id !== 'unclear_with_decline'));
const numberOnlyHigh = (ev) => !!ev && ev.tier === 'high' && !ev.rulesFired.length;
const onlyJust = (ev, line) => !!ev?.range && ev.range.lo / line < 1.5;
// the tier chip, with "only just" on a number-only High whose low end sits close to the line
const chipFor = (ev, line) => (numberOnlyHigh(ev) && onlyJust(ev, line)
  ? `<span class="chip high">${esc(TIER.high.label)} · only just</span>`
  : tierChip(ev.tier));

function patternDetail(line) {
  const tiers = visitTiers(line);
  const kHigh = tiers.findIndex((ev) => ev && ev.tier === 'high');
  const kRule = ruleVisit(tiers);
  const k = kRule >= 0 ? kRule : kHigh;
  const ev = k >= 0 ? tiers[k] : null;
  const ref = ALEX.actual?.referral;
  const lines = REGIONS.map((r, c) => (totals[c] ? `<li><span class="ovp-fl">${esc(REGION_LABEL[r])} <span class="mono ovp-cnt">${totals[c]}</span></span><span class="ovp-names">first recorded ${esc(fmtDate(firstSeen[c]))}</span></li>` : '')).join('');
  const sum = totals.reduce((s, x) => s + x, 0);
  let tool = '<p class="ovp-why">The indicator does not reach High on the notes alone at this line.</p>';
  if (ev) {
    const m = ref ? monthsBetween(ENCS[k].date, ref) : null;
    const everyLine = k === kRule && REFERRAL_LINES.every((l) => ruleVisit(visitTiers(l.value)) === kRule);
    const how = k === kRule
      ? `by a pattern rule, ${everyLine ? 'at every referral line' : `at the <span class="mono">${esc(lineLabel(line))}</span> line`}`
      : `by the likelihood range at the <span class="mono">${esc(lineLabel(line))}</span> line${onlyJust(ev, line) ? ' (only just: its low end is close to the line)' : ''}`;
    const early = kHigh >= 0 && kHigh < k ? tiers[kHigh] : null;
    const gap = k - kHigh;
    tool = `<div class="ovp-tierline">${tierChip(ev.tier)}<span class="ovp-act">${esc(TIER[ev.tier]?.action || '')} from <b>${esc(fmtDate(ENCS[k].date))}</b></span></div>
      <p class="ovp-range">Visit ${k + 1} of ${ENCS.length} (${esc(ENCS[k].setting.toLowerCase())}), ${how}.</p>
      ${ref && m > 0 ? `<p class="ovp-range">The real urgent referral came on ${esc(fmtDate(ref))}, <span class="mono">${m}</span> months later.</p>` : ''}
      ${early ? `<p class="ovp-aside">At this line the number alone crosses ${word(gap)} visit${gap === 1 ? '' : 's'} earlier (${esc(fmtDate(ENCS[kHigh].date))}, low end <span class="mono">${esc(pctAt(early.range.lo, line))}</span>)${onlyJust(early, line) ? ', only just' : ''}; not claimed.</p>` : ''}`;
  }
  return `
    <div class="ovp-dc"><div class="micro">All ${ENCS.length} visits</div><div class="ovp-dv"><b>${esc(fmtDate(ENCS[0].date))}</b> to <b>${esc(fmtDate(ENCS.at(-1).date))}</b></div><div class="ovp-ds">${esc(plural(CLINICIANS, 'clinician'))}</div><div class="ovp-dn">Hover or tab to a cell for the exact words.</div></div>
    <div class="ovp-dc ovp-dmain"><div class="micro">Red flags by body region · ${sum} in all</div><ul class="ovp-flags ovp-sum">${lines}</ul></div>
    <div class="ovp-dc"><div class="micro">Indicator reading every visit · notes only</div>${tool}</div>`;
}

// ---------- mount ----------
export function mount(el, ctx) {
  ensureCss('css/views/overview-pattern.css');
  el.innerHTML = html();
  const root = el.querySelector('.ovp');
  const panel = el.querySelector('.ovp-panel');
  const grid = el.querySelector('.ovp-grid');
  const detail = el.querySelector('[data-detail]');
  const live = el.querySelector('[data-live]');
  const stepper = el.querySelector('[data-stepper]');
  const cells = [...el.querySelectorAll('.ovp-cell')];
  const rowsEl = [...el.querySelectorAll('tbody tr')];
  const N = ENCS.length;
  const reduced = prefersReducedMotion();

  const S = {
    line: ctx?.state?.line ?? REFERRAL_LINES[1]?.value ?? 0.05,
    mode: 'all',
    shown: N,         // visits revealed (replay)
    active: 0,        // the visit in "one clinician at a time"
    sel: null,        // { k, c } cell, or null
    view: 'pattern',  // what the detail shows: 'pattern' | 'visit' | 'cell'
    hover: false, focus: false, inView: false, replayed: false, replaying: false,
  };
  let timer = 0;
  let lastDetail = '';
  let focusCell = cells.find((td) => Number(td.dataset.k) === 1 && Number(td.dataset.c) === 0) || cells[0];
  focusCell.tabIndex = 0;

  const cellAt = (k, c) => cells[k * REGIONS.length + c];

  function renderTools() {
    const tiers = visitTiers(S.line);
    el.querySelectorAll('[data-tool]').forEach((td) => {
      const ev = tiers[Number(td.dataset.tool)];
      td.innerHTML = ev ? chipFor(ev, S.line) : '';
    });
  }

  // The three detail columns stay in place and only their contents change. Only the middle
  // one (the red flags and their words) is a live region, so moving between cells reads the
  // flags, not the whole row.
  const cols = [...detail.children];
  const tpl = document.createElement('template');
  function renderDetail(announce) {
    let h;
    if (S.view === 'cell' && S.sel) h = cellDetail(S.sel.k, S.sel.c, S.line);
    else if (S.view === 'visit') h = visitDetail(S.mode === 'one' ? S.active : Math.max(0, S.shown - 1), S.line);
    else h = patternDetail(S.line);
    cols[1].setAttribute('aria-live', announce ? 'polite' : 'off');
    if (h === lastDetail) return;
    lastDetail = h;
    tpl.innerHTML = h;
    [...tpl.content.children].forEach((p, i) => { if (cols[i] && cols[i].innerHTML !== p.innerHTML) cols[i].innerHTML = p.innerHTML; });
  }

  function renderGrid() {
    for (const td of cells) {
      const k = Number(td.dataset.k), c = Number(td.dataset.c);
      td.classList.toggle('off', k >= S.shown);
      td.classList.toggle('sel', !!S.sel && S.view === 'cell' && S.sel.k === k && S.sel.c === c);
    }
    rowsEl.forEach((tr, k) => {
      tr.classList.toggle('dim', S.mode === 'one' && k !== S.active);
      tr.classList.toggle('act', (S.mode === 'one' && k === S.active) || (S.replaying && k === S.shown - 1));
      tr.classList.toggle('off', k >= S.shown);
    });
    el.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === S.mode)));
    stepper.hidden = S.mode !== 'one';
    let txt;
    if (S.replaying) txt = `Replaying · visit ${S.shown} of ${N}`;
    else if (S.mode === 'one') txt = `Visit ${S.active + 1} of ${N}${S.hover || S.focus || reduced ? '' : ' · cycling'}`;
    else txt = `All ${N} visits`;
    live.textContent = txt;
    live.classList.toggle('on', S.replaying || (S.mode === 'one' && !S.hover && !S.focus && !reduced));
  }

  function render(announce = false) { renderGrid(); renderDetail(announce); }

  // ---------- timers: replay and cycling run only while the section is on screen ----------
  function clear() { clearTimeout(timer); timer = 0; }
  function schedule() {
    clear();
    if (!S.inView) return;
    if (S.replaying) {
      timer = setTimeout(() => {
        if (S.shown < N) { S.shown += 1; S.view = 'visit'; render(false); schedule(); }
        else { S.replaying = false; S.view = 'pattern'; render(false); }
      }, REPLAY_MS);
    } else if (S.mode === 'one' && !S.hover && !S.focus && !reduced) {
      timer = setTimeout(() => { S.active = (S.active + 1) % N; S.view = 'visit'; render(false); schedule(); }, STEP_MS);
    }
  }
  function startReplay() {
    S.mode = 'all'; S.replaying = true; S.replayed = true; S.shown = 1; S.view = 'visit'; S.sel = null;
    render(false); schedule();
  }

  // ---------- interaction ----------
  function select(td, announce) {
    const k = Number(td.dataset.k), c = Number(td.dataset.c);
    if (S.replaying) { S.replaying = false; S.shown = N; clear(); }
    S.sel = { k, c }; S.view = 'cell';
    if (S.mode === 'one') S.active = k;
    render(announce);
  }
  const onOver = (e) => {
    const td = e.target instanceof Element ? e.target.closest('.ovp-cell') : null;
    if (td && !td.classList.contains('off')) select(td, false);
  };
  const onClick = (e) => {
    const td = e.target instanceof Element ? e.target.closest('.ovp-cell') : null;
    if (!td) return;
    if (td.classList.contains('off')) { S.replaying = false; S.shown = N; clear(); }
    moveFocus(td, false);
    select(td, true);
  };
  function moveFocus(td, focus = true) {
    focusCell.tabIndex = -1;
    focusCell = td;
    td.tabIndex = 0;
    if (focus) td.focus();
  }
  const onKey = (e) => {
    const td = e.target instanceof Element ? e.target.closest('.ovp-cell') : null;
    if (!td) return;
    let k = Number(td.dataset.k), c = Number(td.dataset.c);
    const C = REGIONS.length;
    switch (e.key) {
      case 'ArrowRight': c = Math.min(C - 1, c + 1); break;
      case 'ArrowLeft': c = Math.max(0, c - 1); break;
      case 'ArrowDown': k = Math.min(N - 1, k + 1); break;
      case 'ArrowUp': k = Math.max(0, k - 1); break;
      case 'Home': c = 0; if (e.ctrlKey) k = 0; break;
      case 'End': c = C - 1; if (e.ctrlKey) k = N - 1; break;
      case 'Enter': case ' ': e.preventDefault(); select(td, true); return;
      default: return;
    }
    e.preventDefault();
    const next = cellAt(k, c);
    if (S.replaying) { S.replaying = false; S.shown = N; clear(); }
    moveFocus(next);
  };
  // Keyboard focus on a cell pauses the cycling (the detail is being read); focus on the
  // mode buttons does not, so "One clinician at a time" starts cycling after a click.
  const onFocusIn = (e) => {
    const td = e.target instanceof Element ? e.target.closest('.ovp-cell') : null;
    if (!td) return;
    S.focus = true;
    moveFocus(td, false); select(td, true);
    clear(); renderGrid();
  };
  const onFocusOut = (e) => {
    const next = e.relatedTarget instanceof Element ? e.relatedTarget.closest('.ovp-cell') : null;
    if (next && grid.contains(next)) return;
    if (!S.focus) return;
    S.focus = false; renderGrid(); schedule();
  };
  const onEnter = () => { S.hover = true; if (!S.replaying) clear(); renderGrid(); };
  const onLeave = () => { S.hover = false; renderGrid(); schedule(); };
  const onTools = (e) => {
    const b = e.target instanceof Element ? e.target.closest('button') : null;
    if (!b) return;
    if (b.dataset.mode) {
      S.replaying = false; S.shown = N;
      S.mode = b.dataset.mode;
      if (S.mode === 'one') { S.active = S.sel ? S.sel.k : 0; S.view = 'visit'; } else { S.view = 'pattern'; S.sel = null; }
      render(true); schedule();
    } else if (b.dataset.step) {
      S.active = (S.active + Number(b.dataset.step) + N) % N; S.view = 'visit'; S.sel = null;
      render(true); schedule();
    } else if (b.hasAttribute('data-replay')) {
      startReplay();
    }
  };

  grid.addEventListener('pointerover', onOver);
  grid.addEventListener('click', onClick);
  grid.addEventListener('keydown', onKey);
  panel.addEventListener('focusin', onFocusIn);
  panel.addEventListener('focusout', onFocusOut);
  panel.addEventListener('pointerenter', onEnter);
  panel.addEventListener('pointerleave', onLeave);
  const tools = el.querySelector('.ovp-tools');
  tools.addEventListener('click', onTools);

  // replay once when the panel first comes into view
  const io = typeof IntersectionObserver === 'function' ? new IntersectionObserver((es) => {
    const vis = es.some((x) => x.isIntersecting);
    S.inView = vis;
    if (vis && !S.replayed && !reduced && S.mode === 'all' && !S.sel) { startReplay(); return; }
    if (vis) schedule(); else clear();
  }, { threshold: 0.4 }) : null;
  if (io) io.observe(el.querySelector('.ovp-scroll')); else S.inView = true;

  renderTools();
  render(false);

  return {
    update(next) {
      const line = next?.state?.line;
      if (line != null && line !== S.line) { S.line = line; renderTools(); renderDetail(false); }
    },
    unmount() {
      clear();
      if (io) io.disconnect();
      grid.removeEventListener('pointerover', onOver);
      grid.removeEventListener('click', onClick);
      grid.removeEventListener('keydown', onKey);
      panel.removeEventListener('focusin', onFocusIn);
      panel.removeEventListener('focusout', onFocusOut);
      panel.removeEventListener('pointerenter', onEnter);
      panel.removeEventListener('pointerleave', onLeave);
      tools.removeEventListener('click', onTools);
    },
  };
}
