// Red-flag indicator: the doctor's dashboard and the centrepiece of the demo.
// Every number on screen is computed at run time by engine.js from the open case's notes
// (plain arithmetic on published odds ratios, never AI). Nothing here types a number.
// Follows the case chosen in the top bar (ctx.caseFile / ctx.caseEntry): Alex, a
// constructed look-alike or a case built in Cases, with any number of visits.
// Reads ctx.state.asOf (visit), line, includeHome and exclude; writes only via ctx.setState.
import { esc, fmtDate, TIER, tierChip, simChip, assumeChip, sourceLink, ensureCss, plural, monthsBetween, pctAt } from '../ui.js';
import { timeline, stateAt, monthsSaved, formatPct, RULES, ACTIONS, FINDINGS, PRIOR, UNCLEAR_DEADLINE_WEEKS } from '../../engine.js';
import { REFERRAL_LINES } from '../../weights.js';
import { createEffect, palette, rng } from '../../fx/core.js';

const PLAY_MS = 1200;
const REGION = {
  arm: 'Arm and hand', leg: 'Leg', bulbar: 'Speech and swallowing', breathing: 'Breathing',
  general: 'Whole body', cognitive: 'Thinking and mood', other: 'Other',
};
// L is the referral line's label, e.g. "5%": "the whole range is above the 5% line"
const BY_NUMBER = {
  high: (L) => `the whole range is above the ${L} line`,
  unclear: (L) => `the range crosses the ${L} line`,
  low: (L) => `the whole range is below the ${L} line`,
};
const MND_TITLE = 'MND, motor neurone disease: the UK term in Mei et al. 2022; ALS is its most common form.';
const DEMO_LABEL = 'Constructed look-alike, not a real patient';
const SEC_NOTE = {
  'case-file': 'Each red flag is quoted word for word from its note. For this demo the findings were picked out by hand (AI-assisted) and a test checks every quote; automatic extraction is future work. Untick one to see the tier without it (what-if); it changes every view.',
  demo: 'Constructed look-alike: each red flag and its wording were written for this demo, not taken from a real note. Untick one to see the tier without it (what-if); it changes every view.',
  user: 'Each red flag shows the words entered for it in Cases, checked against the visit note when there is one. Untick one to see the tier without it (what-if); it changes every view.',
};
// Log axis for the range bar: 0.01% to 100%.
const AX_LO = Math.log10(1e-4);
const AX_HI = Math.log10(1);
const TICKS = [[1e-4, '0.01%'], [1e-3, '0.1%'], [1e-2, '1%'], [1e-1, '10%'], [1, '100%']];
const xNum = (p) => ((Math.log10(Math.min(1, Math.max(1e-4, p))) - AX_LO) / (AX_HI - AX_LO)) * 100;
const xAt = (p) => `${xNum(p).toFixed(2)}%`;

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (d) => typeof d === 'string' && ISO.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`));
// ui.js's simChip names Alex in its tooltip; other cases get a neutral one.
const simChipAny = () => '<span class="chip sim" title="Made up for the demo, not measured">Simulated</span>';
// For "is this quote really in the note": case, spacing and curly quotes ignored.
const norm = (t) => String(t || '').toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();

const at = (list, d) => {
  let last = null;
  for (const e of list) if (e.asOf <= d) last = e;
  return last;
};

function fmtOr(x) {
  if (!(x > 0)) return '×1';
  if (x < 10) return `×${x.toFixed(2)}`;
  if (x < 1000) return `×${x.toFixed(1)}`;
  if (x < 1e6) return `×${Math.round(x).toLocaleString('en-US')}`;
  if (x < 1e9) return `×${(x / 1e6).toFixed(x < 1e7 ? 1 : 0)} million`;
  return `×${(x / 1e9).toFixed(1)} billion`;
}
const fmtW = (x) => (x >= 10 ? x.toFixed(1) : x.toFixed(2));
const weightText = (f) => `aOR ${fmtW(f.or)} (${fmtW(f.lo)}–${fmtW(f.hi)})`;

// "5.2–20%" with a small unit; "99% to >99%" at the extremes. Always both ends, even
// when they print the same (">99% to >99%" at Alex's last visit): never one figure.
function rangeHtml(r, line) {
  const a = pctAt(r.lo, line);
  const b = pctAt(r.hi, line);
  const plain = (s) => /^[\d.]+%$/.test(s);
  if (plain(a) && plain(b)) return `${esc(a.slice(0, -1))}–${esc(b.slice(0, -1))}<span class="stat-unit">%</span>`;
  return `${esc(a)} <span class="ind-to">to</span> ${esc(b)}`;
}
const rangeText = (r, line) => `${pctAt(r.lo, line)} to ${pctAt(r.hi, line)}`;
const lineLabel = (v) => (REFERRAL_LINES.find((l) => l.value === v) || {}).label || formatPct(v);
const priorText = () => `${+(PRIOR.lo * 1e4).toFixed(2)}–${+(PRIOR.hi * 1e4).toFixed(2)} in 10,000`;

// ---------- the open case, cleaned for this view ----------
// Visits without a valid date are set aside (the engine needs dates); the rest in date order.
function caseInfo(c) {
  const entry = c.caseEntry || {};
  const raw = c.caseFile || entry.caseFile || {};
  const all = Array.isArray(raw.encounters) ? raw.encounters : [];
  const visits = all.filter((e) => e && validDate(e.date)).sort((a, b) => a.date.localeCompare(b.date));
  const homeTests = Array.isArray(raw.homeTests) ? raw.homeTests : [];
  const kind = entry.kind || 'user';
  const patient = raw.patient || {};
  return {
    entry, kind, visits,
    cf: visits.length === all.length ? raw : { ...raw, encounters: visits },
    skipped: all.length - visits.length,
    name: String(patient.name || entry.name || 'This patient'),
    summary: String(patient.summary || ''),
    actual: raw.actual || {},
    hasHome: homeTests.length > 0,
    simHome: homeTests.some((h) => h && h.simulated),
    allSimHome: homeTests.length > 0 && homeTests.every((h) => h && h.simulated),
    simChip: kind === 'case-file' ? simChip : simChipAny,
    prov: kind === 'demo' ? DEMO_LABEL : kind === 'user' ? (entry.subtitle || 'Built in this browser') : '',
  };
}
const visitDatesOf = (k) => [...new Set(k.visits.map((e) => e.date))];

// ---------- the model: everything the view shows, computed from ctx ----------
function buildModel(c) {
  const s = c.state;
  const k = caseInfo(c);
  if (!k.visits.length) return { empty: true, k, s };
  const opts = c.opts;
  const cf = k.cf;
  const visits = k.visits;
  const dates = visitDatesOf(k);
  let idx = 0;
  visits.forEach((e, i) => { if (e.date <= s.asOf) idx = i; });
  const enc = visits[idx];
  const asOf = enc.date;
  const exSet = opts.exclude instanceof Set ? opts.exclude : new Set(s.exclude || []);

  const tl = timeline(cf, opts);
  const cur = at(tl, asOf);
  const notesOpts = { ...opts, includeHomeTests: false };
  const tlNotes = s.includeHome ? timeline(cf, notesOpts) : tl;
  // "Without simulated data": simulated home tests out, any real ones stay in.
  let tlNoSim = tl;
  if (s.includeHome && k.allSimHome) tlNoSim = tlNotes;
  else if (s.includeHome && k.simHome) tlNoSim = timeline({ ...cf, homeTests: cf.homeTests.filter((h) => !h.simulated) }, opts);
  const curNoSim = at(tlNoSim, asOf);

  // Every instance on file by this visit, ticked or not, so the doctor can re-tick.
  const fullOpts = { ...opts, exclude: new Set() };
  const all = stateAt(cf, asOf, fullOpts);
  const isOut = (i) => exSet.has(i.key) || exSet.has(i.id);
  const outHere = all.instances.filter(isOut);
  const outElsewhere = (s.exclude || []).filter((x) => !all.instances.some((i) => i.key === x || i.id === x)).length;
  const curFull = outHere.length ? at(timeline(cf, fullOpts), asOf) : null;

  const steps = visits.map((e) => {
    const ev = tl.find((x) => x.asOf === e.date) || at(tl, e.date);
    const evNoSim = tlNoSim.find((x) => x.asOf === e.date) || at(tlNoSim, e.date);
    // a visit's tier "depends on simulated data" when switching it off changes the tier
    return { enc: e, ev, simDep: !!(s.includeHome && k.simHome && ev && evNoSim && ev.tier !== evNoSim.tier) };
  });
  const ms = monthsSaved(cf, notesOpts);
  const msSim = s.includeHome && k.hasHome ? monthsSaved(cf, opts) : null;
  const firstHighEv = ms.firstHigh ? tlNotes.find((e) => e.asOf === ms.firstHigh) : null;
  const firstRuleEv = tlNotes.find((e) => e.rulesFired.length > 0) || null;
  const simHere = cur.state.instances.filter((i) => i.simulated);

  return { k, s, opts, visits, dates, idx, enc, asOf, exSet, tl, cur, curNoSim, all, isOut, outHere, outElsewhere, curFull, steps, ms, msSim, firstHighEv, firstRuleEv, simHere };
}

// ---------- sections ----------
function eyebrowHtml(k, label) {
  return `<div class="ind-eyebrow"><span class="micro dot">${esc(label)}</span>${k.prov ? `<span class="chip">${esc(k.prov)}</span>` : ''}</div>`;
}

function headHtml(m) {
  const { k, enc, idx, visits } = m;
  // a demo's single visit carries the case title; show its story instead of repeating it
  const lead = enc.title && enc.title !== k.name ? enc.title : (k.kind === 'demo' ? (enc.note || k.summary) : '');
  let expect = '';
  if (k.kind === 'demo') {
    const t = m.cur.tier;
    expect = k.entry.expect === 'not-high'
      ? `<p class="note ind-happened"><span class="ind-k">Set before scoring</span> A common presentation that should not reach High on its own. At these settings it is <b>${esc(TIER[t].label)}</b>, ${t === 'high' ? 'not as expected' : 'as expected'}.</p>`
      : '<p class="note ind-happened"><span class="ind-k">Set before scoring</span> No expectation set: shown for honesty.</p>';
  }
  return `
    ${eyebrowHtml(k, `Doctor view · Visit ${idx + 1} of ${visits.length}`)}
    <h1 class="title two-tone">Red-flag indicator <span class="soft">· ${esc(k.name)}, ${esc(fmtDate(enc.date))}</span></h1>
    <p class="ind-visit"><b>${esc(enc.setting)}</b>${enc.clinician ? `<span class="sep">·</span>${esc(enc.clinician)}` : ''}</p>
    ${lead ? `<p class="ind-visit-title">${esc(lead)}</p>` : ''}
    ${enc.whatHappened ? `<p class="note ind-happened"><span class="ind-k">${k.kind === 'demo' ? 'About this case' : 'What actually happened'}</span> ${esc(enc.whatHappened)}</p>` : ''}
    ${expect}
    ${enc.reconstructed ? `<p class="note">${esc(enc.reconstructed)}</p>` : ''}
    ${k.skipped ? `<p class="note ind-skipped">${esc(plural(k.skipped, 'visit'))} without a valid date (YYYY-MM-DD) ${k.skipped === 1 ? 'is' : 'are'} left out. Fix the date in <a href="#cases">Cases</a>.</p>` : ''}`;
}

// No visit with a date yet: a calm empty state that points to Cases.
function emptyHeadHtml(m) {
  const { k } = m;
  return `
    ${eyebrowHtml(k, 'Doctor view · No visits yet')}
    <h1 class="title two-tone">Red-flag indicator <span class="soft">· ${esc(k.name)}</span></h1>
    ${k.summary ? `<p class="ind-visit-title">${esc(k.summary)}</p>` : ''}`;
}
function emptyHtml(m) {
  const { k } = m;
  if (k.skipped) {
    return `
    <div class="micro">Nothing to score yet</div>
    <h2>Fix the visit date to see the red-flag tier</h2>
    <p>${esc(plural(k.skipped, 'visit'))} on file ${k.skipped === 1 ? 'has' : 'have'} no valid date (YYYY-MM-DD). The indicator scores each visit on its date and replays the visits in order, so every visit needs one.</p>
    <div class="row"><a class="btn primary" href="#cases">Fix the date in Cases</a></div>`;
  }
  return `
    <div class="micro">Nothing to score yet</div>
    <h2>Add a visit to see the red-flag tier</h2>
    <p>This case has no visits yet, so there is nothing to score. The indicator scores the red flags quoted from each visit’s note. Add a visit in Cases, with the words from the note for each red flag, and the tier, the 95% range and the visit replay appear here.</p>
    <div class="row"><a class="btn primary" href="#cases">Add a visit in Cases</a></div>`;
}

function rangeBarSvg(m) {
  const r = m.cur.range;
  const line = m.s.line;
  const lineX = xAt(line);
  const lineAnchor = line >= 0.5 ? 'end' : 'middle';
  const ticks = TICKS.map(([v, l], i) => {
    const anchor = i === 0 ? 'start' : i === TICKS.length - 1 ? 'end' : 'middle';
    return `<line class="rb-tick" x1="${xAt(v)}" x2="${xAt(v)}" y1="55" y2="60"/><text class="rb-tick-l" x="${xAt(v)}" y="74" text-anchor="${anchor}">${l}</text>`;
  }).join('');
  const label = `Likelihood range on a log scale from 0.01% to 100%: middle 95% ${rangeText(r, line)}, median ${formatPct(r.median)}. Referral line ${lineLabel(line)}. Starting rate ${formatPct(PRIOR.lo)} to ${formatPct(PRIOR.hi)}.`;
  return `
    <svg class="rangebar t-${esc(m.cur.tier)}" width="100%" height="80" role="img" aria-label="${esc(label)}" overflow="visible">
      <rect class="rb-track" x="0" y="34" width="100%" height="6" rx="3"/>
      ${ticks}
      <g class="rb-prior"><title>Starting rate: ${esc(PRIOR.label)}</title>
        <line x1="${xAt(PRIOR.lo)}" x2="${xAt(PRIOR.hi)}" y1="37" y2="37"/>
        <text class="rb-lbl" x="0" y="12" text-anchor="start">STARTING RATE</text>
      </g>
      <g class="rb-range"><title>Middle 95% of ${r.nSims.toLocaleString('en-US')} simulations: ${esc(rangeText(r, line))}, median ${esc(formatPct(r.median))}</title>
        <rect class="rb-band" x="${Math.min(xNum(r.lo), 99.4).toFixed(2)}%" width="${Math.max(0.6, xNum(r.hi) - xNum(r.lo)).toFixed(2)}%" y="29" height="16" rx="3"/>
        <line class="rb-median" x1="${xAt(r.median)}" x2="${xAt(r.median)}" y1="25" y2="49"/>
      </g>
      <g class="rb-line"><title>Referral line: ${esc(lineLabel(line))}</title>
        <line x1="${lineX}" x2="${lineX}" y1="18" y2="55"/>
        <text class="rb-lbl rb-line-l" x="${lineX}" y="12" text-anchor="${lineAnchor}">REFERRAL LINE ${esc(lineLabel(line))}</text>
      </g>
    </svg>`;
}

function panelHtml(m) {
  const { cur, s, k } = m;
  const tier = cur.tier;
  const t = TIER[tier];
  const r = cur.range;
  const lineMeta = REFERRAL_LINES.find((l) => l.value === s.line);
  const seg = REFERRAL_LINES.map((l) => `<button type="button" class="mono" data-line="${l.value}" data-fk="line-${l.value}" aria-pressed="${l.value === s.line}" title="${esc(l.note)}">${esc(l.label)}</button>`).join('');

  let reason;
  if (cur.steppedDown) reason = esc(cur.reason);
  else if (cur.rulesFired.length) reason = `${esc(plural(cur.rulesFired.length, 'pattern rule'))} fired: ${cur.rulesFired.map((x) => esc(x.label)).join('; ')}.`;
  else reason = `${esc(cur.reason)} of ${esc(lineLabel(cur.line))}.`;
  // With a rule fired the tier is High; say what the number alone gives, without repeating
  // the tier word when the two agree (the big word above already says it).
  const byLine = cur.rulesFired.length ? BY_NUMBER[cur.byNumber](esc(lineLabel(cur.line))) : '';
  const byNum = !cur.rulesFired.length ? ''
    : cur.byNumber === tier
      ? `<p class="ind-bynum">The number alone agrees: ${byLine}.</p>`
      : `<p class="ind-bynum">The number alone says <b>${esc(TIER[cur.byNumber].label)}</b>: ${byLine}. Pattern rules go straight to High.</p>`;
  const tracking = tier === 'unclear' && cur.unclearSince
    ? `<p class="ind-bynum">Tracking since ${esc(fmtDate(cur.unclearSince))}: week ${Math.floor(cur.weeksUnclear) + 1} of ${UNCLEAR_DEADLINE_WEEKS}.</p>` : '';

  const weighted = [...cur.state.ids].filter((id) => FINDINGS[id] && FINDINGS[id].or != null);
  const declines = cur.state.homeDeclines.length;
  const simVal = s.includeHome ? (declines ? `On · ${plural(declines, 'decline')}` : 'On · no decline yet') : 'Off';
  // the Simulated chip only when what is counted is simulated (Alex: all of it)
  const simCounted = k.allSimHome || cur.state.homeDeclines.some((d) => d.simulated);
  const homeRow = k.hasHome
    ? `<div class="kv"><span class="ind-kl">${k.allSimHome ? 'Simulated data' : 'Home tests'}${s.includeHome && simCounted ? ` ${k.simChip()}` : ''}</span><span class="v">${esc(simVal)}</span></div>`
    : '<div class="kv"><span class="ind-kl">Home tests</span><span class="v">None on file</span></div>';

  const notes = [];
  if (m.simHere.length) {
    const without = m.curNoSim;
    const same = without.tier === tier;
    notes.push(`<div class="ind-pnote">${k.simChip()}<p>This visit counts ${esc(plural(m.simHere.length, 'simulated home-test decline'))}. ${same
      ? `Without simulated data the tier is also <b>${esc(TIER[without.tier].label)}</b> (${esc(rangeText(without.range, without.line))}).`
      : `Without simulated data the tier would be <b>${esc(TIER[without.tier].label)}</b> (${esc(rangeText(without.range, without.line))}): this tier depends on made-up data.`}
      <a href="#monitoring">Monitoring</a></p></div>`);
  }
  if (m.outHere.length || m.outElsewhere) {
    const full = m.curFull;
    const n = m.outHere.length;
    const body = n
      ? `<b>What-if: ${esc(plural(n, 'finding'))} left out.</b> With every finding counted: <b>${esc(TIER[full.tier].label)}</b> (${esc(rangeText(full.range, full.line))}).${m.outElsewhere ? ` ${esc(plural(m.outElsewhere, 'more'))} left out at later visits.` : ''}`
      : `<b>What-if:</b> ${esc(plural(m.outElsewhere, 'finding'))} left out at later visits; none affect this visit.`;
    notes.push(`<div class="ind-pnote"><span class="chip">What-if</span><p>${body}</p><button type="button" class="btn sm" data-restore data-fk="restore">Restore all</button></div>`);
  }

  return `
    <div class="ind-grid">
      <div class="ind-left">
        <h2 class="micro dot">Red-flag tier at this visit</h2>
        <div class="ind-tier t-${esc(tier)}">${esc(t.label)}</div>
        <div class="ind-action"><span>${esc(t.action)}</span></div>
        <p class="ind-reason">${reason}</p>
        ${byNum}${tracking}
        <hr>
        <div class="micro" title="${esc(MND_TITLE)}">Likelihood of an MND (ALS) diagnosis within 5 years</div>
        <div class="ind-range-row">
          <div class="stat-l ind-range">${rangeHtml(r, m.s.line)}</div>
          <div class="ind-range-cap">95% range · median ${esc(formatPct(r.median))}${m.simHere.length ? ` ${k.simChip()}` : ''}<br><span class="faint">${r.nSims.toLocaleString('en-US')} simulations, never a lone percentage</span></div>
        </div>
        <div class="ind-trace" aria-hidden="true"></div>
        ${rangeBarSvg(m)}
        <div class="ind-line">
          <span class="micro" id="ind-line-lbl">Referral line</span>
          <div class="seg" role="group" aria-labelledby="ind-line-lbl">${seg}</div>
          <span class="note">${esc(lineMeta ? lineMeta.note : '')}</span>
        </div>
      </div>
      <div class="ind-right">
        <div class="micro">How the number is built</div>
        <div class="ind-kvs">
          <div class="kv"><span class="ind-kl">Starting rate ${assumeChip()}</span><span class="v">${esc(priorText())}</span></div>
          <div class="kv"><span class="ind-kl">Combined odds ratio</span><span class="v">${esc(fmtOr(r.orProduct))}</span></div>
          <div class="kv"><span class="ind-kl">Red flags counted <span class="faint">each sign once</span></span><span class="v">${weighted.length}</span></div>
          <div class="kv"><span class="ind-kl">Pattern rules fired</span><span class="v">${cur.rulesFired.length} of ${RULES.length}</span></div>
          ${homeRow}
        </div>
        <p class="note ind-how">Arithmetic, not AI: starting rate × published adjusted odds ratios (${sourceLink('mei2022')}, 6,437 cases vs 62,003 controls), drawn ${r.nSims.toLocaleString('en-US')} times.</p>
        <div class="panel-inset ind-next">
          <div class="micro">Next step for the doctor</div>
          <p>${esc(ACTIONS[tier].doctor)}</p>
          <p class="faint">The output is “needs EMG / neuromuscular workup”, never a diagnosis.</p>
        </div>
        ${notes.join('')}
      </div>
    </div>`;
}

function replayHtml(m, playing) {
  const { k, steps, idx, ms, msSim, firstHighEv, firstRuleEv } = m;
  const single = m.dates.length < 2;
  const real = k.actual.referral || null;
  const cells = steps.map(({ enc, ev, simDep }, i) => `
    <button type="button" class="ind-step${i < idx && enc.date !== m.asOf ? ' past' : ''}" data-visit="${esc(enc.date)}" data-fk="step-${esc(enc.id)}"${enc.date === m.asOf ? ' aria-current="step"' : ''}>
      <span class="ind-step-n mono">${String(i + 1).padStart(2, '0')}</span>
      <span class="ind-step-d mono">${esc(fmtDate(enc.date))}</span>
      <span class="ind-step-s">${esc(enc.setting)}</span>
      <span class="ind-step-chips">${ev ? tierChip(ev.tier) : ''}${simDep ? k.simChip() : ''}</span>
    </button>`).join('');

  const factRow = (date, label, simulated) => {
    const chip = simulated ? k.simChip() : '';
    if (!date) {
      return real
        ? `<p class="ind-sum-none">${chip} No EMG prompt before the real referral (${esc(fmtDate(real))}) with these settings.</p>`
        : `<p class="ind-sum-none">${chip} No EMG prompt at any visit with these settings.</p>`;
    }
    if (!real) {
      return `
      <div class="ind-facts">
        <div class="ind-fact"><span class="micro">${esc(label)}</span><span class="stat-s">${esc(fmtDate(date))}</span></div>
        ${simulated ? `<div class="ind-fact ind-fact-chip">${chip}</div>` : ''}
      </div>`;
    }
    const mo = monthsBetween(date, real);
    const earlier = mo > 0;
    return `
      <div class="ind-facts">
        <div class="ind-fact"><span class="micro">${esc(label)}</span><span class="stat-s">${esc(fmtDate(date))}</span></div>
        <div class="ind-fact"><span class="micro">Real referral</span><span class="stat-s">${esc(fmtDate(real))}</span></div>
        <div class="ind-fact"><span class="micro">${earlier ? 'Earlier, referral to referral' : 'Earlier'}</span><span class="stat-s">${earlier ? `${mo}<span class="stat-unit">${mo === 1 ? 'month' : 'months'}</span>` : 'not earlier'}</span></div>
        ${simulated ? `<div class="ind-fact ind-fact-chip">${chip}</div>` : ''}
      </div>`;
  };
  const ruleDate = firstRuleEv ? firstRuleEv.asOf : null;
  const line = m.s.line;
  let primary;
  let caveat = '';
  if (k.kind === 'case-file') {
    // Alex's headline is the pattern-rule prompt: it does not depend on the referral line.
    primary = ruleDate
      ? factRow(ruleDate, ms.firstHigh === ruleDate ? 'Tool’s EMG prompt · pattern rule' : 'EMG prompt · pattern rule, any line', false)
      : factRow(ms.firstHigh, 'Tool’s EMG prompt', false);
    if (ruleDate && ms.firstHigh && ms.firstHigh < ruleDate && firstHighEv) {
      const lo = firstHighEv.range.lo;
      const close = lo < line * 1.5;
      const before = ms.monthsVsReferral > 0 ? ` (${ms.monthsVsReferral} months before the real referral)` : '';
      caveat = `<p class="note">At the ${esc(lineLabel(line))} line the number alone prompts earlier, on ${esc(fmtDate(ms.firstHigh))}${before}${close ? ', but only just' : ''}: lowest end ${esc(pctAt(lo, line))} against the ${esc(lineLabel(line))} line. We claim the pattern-rule date instead.</p>`;
    }
  } else {
    // Any other case: the tool's own first EMG prompt at this line, and what drove it.
    const byRule = !!(firstHighEv && firstHighEv.rulesFired.length);
    primary = factRow(ms.firstHigh, byRule ? 'Tool’s EMG prompt · pattern rule' : `Tool’s EMG prompt · number alone, ${lineLabel(line)} line`, false);
    if (ms.firstHigh && !byRule && firstHighEv) {
      const lo = firstHighEv.range.lo;
      caveat = `<p class="note">From the number alone, so it moves with the referral line: lowest end ${esc(pctAt(lo, line))} against the ${esc(lineLabel(line))} line${lo < line * 1.5 ? ', only just above it' : ''}. ${ruleDate ? `A pattern rule, which does not depend on the line, fires on ${esc(fmtDate(ruleDate))}.` : 'No pattern rule fires at any visit.'}</p>`;
    }
  }
  const simEv = msSim && msSim.firstHigh ? m.tl.find((e) => e.asOf === msSim.firstHigh) : null;
  // The home-data variant gets a stat row only when home data moves the prompt earlier;
  // otherwise its date is the notes-only one and a big number would read as a new claim.
  // A case with no home tests gets no row at all.
  let simRow = '';
  if (msSim) {
    const simEarlier = msSim.firstHigh && (!ms.firstHigh || msSim.firstHigh < ms.firstHigh);
    simRow = simEarlier
      ? factRow(msSim.firstHigh, `${k.allSimHome ? 'With simulated data' : 'With home data'} · ${simEv && simEv.rulesFired.length ? 'pattern rule' : 'number alone'}`, k.simHome)
      : `<p class="ind-sum-none">${k.simHome ? k.simChip() : ''} ${k.allSimHome ? 'Simulated home data' : 'Home data'} does not move the prompt earlier at the ${esc(lineLabel(m.s.line))} line.</p>`;
  }
  let compare;
  if (real) {
    const spec = k.actual.firstNeurology || k.actual.firstNeuromuscular || null;
    const waitWeeks = spec ? Math.round((Date.parse(spec) - Date.parse(real)) / (7 * 864e5)) : 0;
    compare = waitWeeks > 0
      ? `<p class="note">Referral to referral is the fair comparison: the ${waitWeeks}-week ${k.actual.firstNeurology ? 'neurology' : 'specialist'} wait after a referral (${esc(fmtDate(real))} to ${esc(fmtDate(spec))}) applies either way, so it is never counted.</p>`
      : '<p class="note">Referral to referral is the fair comparison: the wait for a specialist after a referral applies either way, so it is never counted.</p>';
  } else if (k.kind === 'demo') {
    compare = `<p class="note">${esc(DEMO_LABEL)}, so there is no real referral to compare with.</p>`;
  } else {
    compare = '<div class="ind-noref"><p>Add the real referral date in Cases to compare with what really happened.</p><a class="btn sm" href="#cases">Open Cases</a></div>';
  }
  const nEx = (m.s.exclude || []).length;

  const head = single
    ? `
    <div class="card-head">
      <h3>When the tool prompts an EMG</h3>
      <span class="note ind-replay-hint">${k.kind === 'demo' ? 'One visit, constructed for the demo' : 'One visit on file: add later visits in Cases to replay the tier visit by visit'}</span>
    </div>`
    : `
    <div class="card-head">
      <h3>Replay the visits</h3>
      <span class="note ind-replay-hint">Tier at each visit, as the tool would have shown it then</span>
      <div class="aside row">
        <button type="button" class="btn sm" data-step="-1" data-fk="prev"${m.asOf === m.dates[0] ? ' disabled' : ''}>Prev</button>
        <button type="button" class="btn sm primary ind-play" data-play data-fk="play" aria-pressed="${playing}">${playing ? 'Pause' : 'Play'}</button>
        <button type="button" class="btn sm" data-step="1" data-fk="next"${m.asOf === m.dates[m.dates.length - 1] ? ' disabled' : ''}>Next</button>
      </div>
    </div>
    <div class="ind-strip" role="group" aria-label="Visits" style="--n: ${steps.length}">${cells}</div>`;

  return `${head}
    <div class="ind-sum">
      <div class="micro">From the notes only${nEx ? ` · what-if, ${esc(plural(nEx, 'finding'))} left out` : ''}</div>
      ${primary}
      ${caveat}
      ${simRow ? `<hr>${simRow}` : ''}
      ${compare}
    </div>`;
}

// Redraw the replay card but keep its Prev/Play/Next buttons, updated in place: the
// focused one keeps its node, so Play does not re-focus and re-announce it at every step.
function paintReplay(el, html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  const head = el.querySelector('.card-head');
  const fresh = tpl.content.querySelector('.card-head');
  const keys = (h) => [...h.querySelectorAll('[data-fk]')].map((x) => x.dataset.fk).join();
  if (!head || !fresh || !keys(head) || keys(head) !== keys(fresh)) { el.innerHTML = html; return; }
  for (const nb of fresh.querySelectorAll('[data-fk]')) {
    const ob = head.querySelector(`[data-fk="${nb.dataset.fk}"]`);
    ob.disabled = nb.disabled;
    if (ob.textContent !== nb.textContent) ob.textContent = nb.textContent;
    if (nb.hasAttribute('aria-pressed')) ob.setAttribute('aria-pressed', nb.getAttribute('aria-pressed'));
  }
  fresh.remove();
  while (head.nextSibling) head.nextSibling.remove();
  el.append(tpl.content);
}

function rulesHtml(m) {
  const fired = m.cur.rulesFired;
  const firedIds = new Set(fired.map((r) => r.id));
  const notFired = RULES.filter((r) => !firedIds.has(r.id)).map((r) => esc(r.label));
  const cards = fired.length
    ? `<div class="grid cols-2 ind-rules">${fired.map((r) => `
        <article class="card card-pad ind-rule">
          <div class="row"><span class="micro dot ind-rule-k">Rule fired</span>${r.source === 'assumption' ? assumeChip() : ''}</div>
          <h3>${esc(r.label)}</h3>
          <p>${esc(r.why)}</p>
          <p class="note">Source: ${sourceLink(r.source)}</p>
        </article>`).join('')}</div>`
    : `<div class="card card-pad ind-empty"><b>No pattern rule fires at this visit.</b> <span class="muted">The tier comes from the number alone.</span></div>`;
  return `
    <div class="section-head"><h2>Pattern rules fired</h2><span class="aside">${fired.length} of ${RULES.length} · any one goes straight to High</span></div>
    ${cards}
    ${notFired.length ? `<p class="note ind-notfired">Also checked, not fired: ${notFired.join(' · ')}.</p>` : ''}`;
}

function flagsHtml(m, openState) {
  const { k, all, isOut } = m;
  const visitOf = (id) => m.visits.find((x) => x.id === id) || null;
  // first counted instance of each weighted sign: later mentions add no weight
  const firstCounted = {};
  for (const i of [...all.instances].sort((a, b) => a.date.localeCompare(b.date))) {
    if (!isOut(i) && !(i.id in firstCounted)) firstCounted[i.id] = i;
  }
  const groups = new Map();
  for (const i of all.instances) {
    const gid = i.kind === 'home' ? `home:${i.test}` : i.encounterId;
    if (!groups.has(gid)) groups.set(gid, { gid, date: i.date, kind: i.kind, items: [] });
    groups.get(gid).items.push(i);
  }
  const list = [...groups.values()].sort((a, b) => b.date.localeCompare(a.date) || (a.kind === 'home') - (b.kind === 'home'));
  const counted = all.instances.filter((i) => !isOut(i)).length;

  const row = (i) => {
    const f = FINDINGS[i.id] || { label: i.id };
    const out = isOut(i);
    const first = firstCounted[i.id];
    const repeat = !out && f.or != null && first && first.key !== i.key;
    const chips = `${i.simulated ? k.simChip() : ''}${f.source === 'assumption' ? assumeChip() : ''}`;
    const weight = f.or != null
      ? `<span class="mono">${esc(weightText(f))}</span><span class="note">${sourceLink(f.source)}</span>${repeat ? `<span class="note faint">Same sign as ${esc(fmtDate(first.date))}: counted once</span>` : ''}`
      : f.contextOnly
        ? `<span>Context flag: shown, not scored</span><span class="note">${sourceLink(f.source)}</span>`
        : `<span>Pattern sign: goes straight to a rule</span><span class="note">${sourceLink(f.source)}</span>`;
    // cases built in the app: Cases fills an empty quote with the sign's name, and the
    // words are not checked on entry, so say so rather than show them as a quote
    const v = k.kind === 'user' && i.kind !== 'home' ? visitOf(i.encounterId) : null;
    const noWords = !!(v && i.quote === f.label && !(v.note && norm(v.note).includes(norm(i.quote))));
    const unmatched = !!(v && !noWords && v.note && !norm(v.note).includes(norm(i.quote)));
    const quote = i.kind === 'home'
      ? `<p class="ind-computed mono">${esc(String(i.quote || '').replace(/\s*\[SIMULATED DATA\]\s*$/, ''))}</p>`
      : noWords ? '<p class="note ind-unmatched">No words from the note were entered for this red flag.</p>'
      : `<blockquote class="quote">“${esc(i.quote)}”</blockquote>`;
    return `
      <div class="ind-flag${out ? ' is-out' : ''}">
        <div class="ind-flag-main">
          <div class="ind-flag-t"><b>${esc(f.label)}</b>${chips}</div>
          <div class="ind-flag-meta">${esc(REGION[i.region] || 'Body region not stated')}<span class="sep">·</span>${esc(fmtDate(i.date))}<span class="sep">·</span>${esc(i.kind === 'home' ? 'Home test' : i.setting)}</div>
          ${quote}
          ${unmatched ? '<p class="note ind-unmatched">Not found word for word in this visit’s note.</p>' : ''}
        </div>
        <div class="ind-flag-w">${weight}</div>
        <label class="switch ind-flag-sw"><input type="checkbox" data-exclude="${esc(i.key)}" data-id="${esc(i.id)}" data-fk="ex-${esc(i.key)}"${out ? '' : ' checked'} aria-label="Count ${esc(f.label)}, ${esc(fmtDate(i.date))}"><span class="track"></span><span class="ind-sw-t">${out ? 'Left out' : 'Counted'}</span></label>
      </div>`;
  };

  const groupHtml = (g, n) => {
    const e = g.kind === 'home' ? null : visitOf(g.gid);
    const open = openState.has(g.gid) ? openState.get(g.gid) : (n === 0 || list.length <= 3);
    const nOut = g.items.filter(isOut).length;
    const isThis = !!(e && e.date === m.asOf);
    const title = e
      ? `<span class="mono ind-g-d">${esc(fmtDate(e.date))}</span><b>${esc(e.setting)}</b>${e.clinician ? `<span class="ind-g-c">${esc(e.clinician)}</span>` : ''}`
      : `<span class="mono ind-g-d">${esc(fmtDate(g.date))}</span><b>Home tests</b><span class="ind-g-c">Weekly check-in, decline confirmed on this date</span>${g.items.some((i) => i.simulated) ? k.simChip() : ''}`;
    return `
      <details class="ind-group${isThis ? ' is-this' : ''}" data-gid="${esc(g.gid)}" data-def="${open ? 1 : 0}"${open ? ' open' : ''}>
        <summary>${title}<span class="ind-g-n mono">${esc(plural(g.items.length, 'finding'))}${nOut ? ` · ${nOut} left out` : ''}</span>${isThis ? '<span class="micro dot ind-g-this">This visit</span>' : ''}</summary>
        <div class="ind-g-body">${g.items.map(row).join('')}</div>
      </details>`;
  };

  // Recorded but not weighted: the negatives written in each note so far.
  const negs = m.visits.filter((e) => e.date <= m.asOf && (e.negatives || []).length).reverse();
  const negQuote = (e, n) => {
    const q = `<blockquote class="quote">“${esc(n.quote)}”</blockquote>`;
    return k.kind === 'user' && e.note && !norm(e.note).includes(norm(n.quote))
      ? `<div>${q}<p class="note ind-unmatched">Not found word for word in this visit’s note.</p></div>` : q;
  };
  const negHtml = negs.length
    ? `<div class="card ind-negs">${negs.map((e) => e.negatives.map((n) => `
        <div class="ind-neg">
          <div><b>${esc(n.label)}</b><div class="ind-flag-meta">${esc(fmtDate(e.date))}<span class="sep">·</span>${esc(e.setting)}</div></div>
          ${negQuote(e, n)}
        </div>`).join('')).join('')}</div>`
    : `<div class="card card-pad muted">${k.kind === 'demo' ? 'No negatives written for this constructed case.' : 'No negatives recorded in the notes so far.'}</div>`;

  const flags = list.length
    ? `<div class="card ind-groups">${list.map(groupHtml).join('')}</div>`
    : `<div class="card card-pad ind-empty"><b>No red flags on file by this visit.</b>${k.kind === 'user' ? ' <span class="muted">Add them to a visit in <a href="#cases">Cases</a>, each with the words from the note.</span>' : ''}</div>`;

  return `
    <div class="section-head"><h2>Red flags at this visit</h2><span class="aside">On file by ${esc(fmtDate(m.asOf))}: ${esc(plural(all.instances.length, 'finding'))} from ${esc(plural(list.length, 'source'))}, ${all.instances.length - counted ? `${all.instances.length - counted} left out` : 'none left out'}</span></div>
    <p class="note ind-sec-note">${esc(SEC_NOTE[k.kind] || SEC_NOTE.user)}</p>
    ${flags}
    <div class="section-head ind-negs-head"><h2>Recorded but not weighted</h2><span class="aside">Written in the notes, shown for context, never weighted</span></div>
    ${negHtml}`;
}

// ---------- the panel's signal trace (decorative, aria-hidden) ----------
// A faint, slowly drifting nerve-signal trace on scanlines, in its own strip (.ind-trace)
// under the big range number, so it never crosses the figures or their caption. It is
// quiet under the number and full strength after it, and brightens a little on High.
// Drawn on a precomputed loop of samples, so a frame is one short path; it stops off
// screen (fx/core.js) and is a still frame with reduced motion.
const TAPE_N = 2048;
const TAPE_DX = 2; // px between samples
let TAPE = null;
let TAPE_PEAK = 1; // largest |sample|, so the trace fits its strip
function signalTape() {
  if (TAPE) return TAPE;
  const r = rng(1937); // seeded: the same trace on every load
  const tape = new Float32Array(TAPE_N);
  let v = 0;
  for (let i = 0; i < TAPE_N; i += 1) { v = v * 0.86 + (r() - 0.5) * 0.09; tape[i] = v; }
  // single potentials at irregular gaps: a quick triphasic wave each, wrapped so the loop is seamless
  for (let i = 30; i < TAPE_N - 30;) {
    const amp = 0.3 + r() * 0.7;
    const w = 2.4 + r() * 3.2;
    const sign = r() < 0.5 ? -1 : 1;
    for (let k = -14; k <= 22; k += 1) {
      const x = k / w;
      tape[(i + k + TAPE_N) % TAPE_N] += sign * amp * (-2.3 * x * Math.exp(-x * x) + 0.28 * Math.exp(-2 * (x - 1.9) ** 2));
    }
    i += 22 + Math.floor(r() * 80) + (r() < 0.3 ? 140 : 0);
  }
  TAPE_PEAK = Math.max(0.1, ...Array.from(tape, Math.abs));
  TAPE = tape;
  return tape;
}

function traceEffect(canvas, panel) {
  const tape = signalTape();
  const sample = (pos) => {
    const p = ((pos % TAPE_N) + TAPE_N) % TAPE_N;
    const i = Math.floor(p);
    const f = p - i;
    return tape[i] * (1 - f) + tape[(i + 1) % TAPE_N] * f;
  };
  return createEffect(canvas, {
    pointerTarget: panel,
    setup(ctx, st) {
      const p = palette();
      st.data.col = { high: p.highDark || p.panelFlag, unclear: p.watchDark, low: p.lowDark, none: p.panelInk3 };
      st.data.ink = p.panelInk || '#F6EEE5';
      // scanlines, drawn once per size: strongest through the middle, fading up and down
      const off = document.createElement('canvas');
      off.width = Math.max(1, Math.round(st.w * st.dpr));
      off.height = Math.max(1, Math.round(st.h * st.dpr));
      const o = off.getContext('2d');
      o.scale(st.dpr, st.dpr);
      o.fillStyle = st.data.ink;
      for (let y = 1; y < st.h; y += 4) {
        const d = (y - st.h / 2) / (st.h / 2);
        o.globalAlpha = 0.05 * Math.exp(-2.2 * d * d);
        o.fillRect(0, y, st.w, 1);
      }
      st.data.scan = off;
      st.data.fadeW = 0; // rebuild the edge mask
    },
    draw(ctx, st) {
      const { w, h } = st;
      const d = st.data;
      const tier = d.tier || 'none';
      const hi = tier === 'high';
      const col = d.col[tier] || d.col.none;
      ctx.clearRect(0, 0, w, h);
      if (d.scan) { ctx.globalAlpha = hi ? 1 : 0.7; ctx.drawImage(d.scan, 0, 0, w, h); }
      // the canvas is the strip itself: the trace fills it, 3 px clear of the top and bottom
      const mid = h * 0.5;
      const amp = Math.max(2, (h * 0.5 - 3) / TAPE_PEAK);
      const base = (st.t * 24) / TAPE_DX; // drifts right to left, about 24 px a second
      ctx.lineJoin = 'round';
      ctx.strokeStyle = col;
      ctx.beginPath();
      for (let x = 0; x <= w; x += 3) {
        const y = mid - sample(base + x / TAPE_DX) * amp;
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.globalAlpha = hi ? 0.1 : 0.05; // glow
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.globalAlpha = hi ? 0.36 : 0.2; // core
      ctx.lineWidth = 1.25;
      ctx.stroke();
      // a scope cursor where the pointer is
      const m = st.mouse;
      if (m.inside && m.px > 0 && m.px < w && !st.reduced) {
        const cy = mid - sample(base + m.px / TAPE_DX) * amp;
        ctx.globalAlpha = 0.16;
        ctx.fillStyle = d.ink;
        ctx.fillRect(Math.round(m.px), 0, 1, h);
        ctx.globalAlpha = hi ? 0.7 : 0.5;
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(m.px, cy, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      // edge mask: quiet under the number, fading in after its right edge (numRight), full
      // strength beyond it and dissolving at the far edge. Stops kept in order at any width.
      const numR = d.numRight > 40 ? Math.min(w, d.numRight) : w * 0.45;
      if (d.fadeW !== w || d.fadeN !== numR) {
        const at = (x) => Math.min(1, Math.max(0, x / w));
        const s1 = at(24);
        const s2 = Math.max(s1, at(numR - 16));
        const s3 = Math.max(s2, at(numR + 56));
        const s4 = Math.max(s3, at(w - 80));
        const g = ctx.createLinearGradient(0, 0, w, 0);
        g.addColorStop(0, 'rgba(0,0,0,0)');
        g.addColorStop(s1, 'rgba(0,0,0,0.22)');
        g.addColorStop(s2, 'rgba(0,0,0,0.22)');
        g.addColorStop(s3, 'rgba(0,0,0,1)');
        g.addColorStop(s4, 'rgba(0,0,0,1)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        d.fade = g; d.fadeW = w; d.fadeN = numR;
      }
      if (d.fade) {
        ctx.globalCompositeOperation = 'destination-in';
        ctx.fillStyle = d.fade;
        ctx.fillRect(0, 0, w, h);
        ctx.globalCompositeOperation = 'source-over';
      }
    },
  });
}

// ---------- mount ----------
const PARTS = ['head', 'empty', 'error', 'panel', 'replay', 'rules', 'flags'];

export function mount(root, ctx) {
  ensureCss('css/views/indicator.css');
  let c = ctx;
  let timer = null;
  const openState = new Map(); // group id -> open, once the doctor toggles it

  root.innerHTML = `
    <div class="ind">
      <header class="view-head ind-head reveal" data-part="head"></header>
      <section class="card ind-nocase reveal d1" data-part="empty" aria-label="No visits yet" hidden></section>
      <div data-part="error" hidden></div>
      <section class="panel grid-bg ind-panel reveal d1" data-part="panel" aria-label="Red-flag tier and likelihood"><canvas class="ind-fx" aria-hidden="true"></canvas><div class="ind-panel-body"></div></section>
      <p class="ind-sr" role="status" aria-atomic="true"></p>
      <section class="card ind-replay reveal d2" data-part="replay" aria-label="Replay the visits"></section>
      <section class="section reveal d3" data-part="rules"></section>
      <section class="section ind-flags-sec" data-part="flags"></section>
    </div>`;
  const part = (k) => root.querySelector(`[data-part="${k}"]`);
  const showOnly = (...keep) => PARTS.forEach((k) => { part(k).hidden = !keep.includes(k); });
  const panelEl = part('panel');
  const panelBody = panelEl.querySelector('.ind-panel-body');
  const fxCanvas = panelEl.querySelector('.ind-fx');
  const srEl = root.querySelector('.ind-sr'); // status line for screen readers, never rebuilt
  let said = null;
  let fx = null;
  let numRight = 0; // right edge of the big number, in canvas pixels
  // The trace has its own strip (.ind-trace) under the range number and its caption, across
  // the whole left column; it never overlaps the figures or the range bar's labels.
  function placeFx() {
    const band = panelEl.querySelector('.ind-trace');
    const num = panelEl.querySelector('.ind-range');
    const left = panelEl.querySelector('.ind-left');
    if (!band || !num || !left || panelEl.hidden) return;
    const pr = panelEl.getBoundingClientRect();
    const br = band.getBoundingClientRect();
    const nr = num.getBoundingClientRect();
    const lr = left.getBoundingClientRect();
    if (!pr.width || !br.height) return;
    numRight = nr.right - lr.left;
    if (fx) fx.state.data.numRight = numRight;
    const st = fxCanvas.style;
    st.left = `${Math.round(lr.left - pr.left)}px`;
    st.width = `${Math.round(lr.width)}px`;
    st.top = `${Math.round(br.top - pr.top)}px`;
    st.height = `${Math.round(br.height)}px`;
  }
  const panelRo = typeof ResizeObserver === 'function' ? new ResizeObserver(() => placeFx()) : null;
  if (panelRo) panelRo.observe(panelEl);
  // the web fonts can change the row's width once loaded: place the strip again then
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (root.contains(panelEl)) placeFx(); });
  // Hold the view hidden until its own stylesheet has loaded (no flash of unstyled layout).
  const wrap = root.querySelector('.ind');
  const css = document.querySelector('link[data-view-css="css/views/indicator.css"]');
  if (css && !css.sheet) {
    wrap.style.visibility = 'hidden';
    const show = () => { wrap.style.visibility = ''; };
    css.addEventListener('load', show, { once: true });
    css.addEventListener('error', show, { once: true });
    setTimeout(show, 2500);
  }

  function render() {
    const fk = root.contains(document.activeElement) ? document.activeElement.getAttribute('data-fk') : null;
    let m;
    try {
      m = buildModel(c);
    } catch (e) {
      console.error(e);
      stop();
      showOnly('error');
      part('error').innerHTML = `<div class="error-card"><b>The indicator could not be computed for this case.</b> ${esc(e.message || e)} <a href="#cases">Check the case in Cases</a>.</div>`;
      return;
    }
    if (m.empty) {
      stop();
      showOnly('head', 'empty');
      part('head').innerHTML = emptyHeadHtml(m);
      part('empty').innerHTML = emptyHtml(m);
      return;
    }
    showOnly('head', 'panel', 'replay', 'rules', 'flags');
    part('head').innerHTML = headHtml(m);
    panelBody.innerHTML = panelHtml(m);
    panelEl.dataset.tier = m.cur.tier;
    placeFx();
    if (!fx) fx = traceEffect(fxCanvas, panelEl);
    fx.state.data.tier = m.cur.tier;
    fx.state.data.numRight = numRight;
    fx.renderOnce(); // the new tier shows at once, also as the still frame with reduced motion
    paintReplay(part('replay'), replayHtml(m, !!timer));
    part('replay').setAttribute('aria-label', m.dates.length < 2 ? 'When the tool prompts an EMG' : 'Replay the visits');
    part('rules').innerHTML = rulesHtml(m);
    part('flags').innerHTML = flagsHtml(m, openState);
    // keep the current visit in view when the strip scrolls sideways (phones, long cases)
    const strip = root.querySelector('.ind-strip');
    const curStep = strip && strip.querySelector('[aria-current="step"]');
    if (curStep && strip.scrollWidth > strip.clientWidth) strip.scrollLeft = Math.max(0, curStep.offsetLeft - (strip.clientWidth - curStep.offsetWidth) / 2);
    if (fk) {
      let t = root.querySelector(`[data-fk="${CSS.escape(fk)}"]`);
      // Next on the last visit (Prev on the first) is now disabled: keep focus in the
      // replay controls, on the other step button, else on the current visit
      if (t && t.disabled) t = root.querySelector('[data-step]:not(:disabled)') || root.querySelector('.ind-step[aria-current="step"]');
      if (t && !t.disabled) t.focus({ preventScroll: true });
    }
    // One status line per change (not on first load). While Play runs, date and tier only,
    // so the 1.2 s steps do not pile up; the full line follows when it stops.
    const tw = TIER[m.cur.tier];
    const msg = timer
      ? `${fmtDate(m.asOf)}: ${tw.label}`
      : `${fmtDate(m.asOf)}, visit ${m.idx + 1} of ${m.visits.length}: ${tw.label}, ${tw.action}. Likelihood range ${rangeText(m.cur.range, m.s.line)} against the ${lineLabel(m.s.line)} line.${m.outHere.length ? ` What-if: ${plural(m.outHere.length, 'finding')} left out.` : ''}`;
    if (said !== null && msg !== said) srEl.textContent = msg;
    said = msg;
  }

  // Distinct visit dates of the open case (two visits on one day are one step).
  const visitDates = () => visitDatesOf(caseInfo(c));
  // Same rule as buildModel: the last visit on or before asOf (asOf can be a date that
  // is not a visit, e.g. a visit Cases saved without a valid date), else the first.
  const curIdx = () => {
    let j = 0;
    visitDates().forEach((d, i) => { if (d <= c.state.asOf) j = i; });
    return j;
  };
  function go(i) {
    const d = visitDates();
    if (!d.length) return;
    const j = Math.min(d.length - 1, Math.max(0, i));
    if (d[j] !== c.state.asOf) c.setState({ asOf: d[j] });
  }
  function stop() {
    if (timer) { clearInterval(timer); timer = null; }
  }
  function play() {
    const n = visitDates().length;
    if (n < 2) return;
    if (curIdx() >= n - 1) go(0);
    // Discrete steps only: the view swaps state, nothing slides or animates.
    timer = setInterval(() => {
      if (curIdx() >= n - 1) { stop(); render(); return; }
      go(curIdx() + 1);
      if (curIdx() >= n - 1) { stop(); render(); }
    }, PLAY_MS);
    render();
  }

  function onClick(e) {
    const b = e.target.closest('button, [data-visit]');
    if (!b || !root.contains(b) || b.disabled) return;
    if (b.dataset.line) { c.setState({ line: Number(b.dataset.line) }); return; }
    if (b.dataset.visit) { stop(); c.setState({ asOf: b.dataset.visit }); return; }
    if (b.dataset.step) { stop(); go(curIdx() + Number(b.dataset.step)); render(); return; }
    if ('play' in b.dataset) { if (timer) { stop(); render(); } else play(); return; }
    if ('restore' in b.dataset) { c.setState({ exclude: [] }); }
  }
  function onChange(e) {
    const inp = e.target;
    if (!inp.matches || !inp.matches('input[data-exclude]')) return;
    const key = inp.dataset.exclude;
    const id = inp.dataset.id;
    const ex = new Set(c.state.exclude || []);
    if (inp.checked) { ex.delete(key); ex.delete(id); } else ex.add(key);
    c.setState({ exclude: [...ex] });
  }
  function onToggle(e) {
    const d = e.target;
    if (!d || !d.matches || !d.matches('details[data-gid]')) return;
    const gid = d.dataset.gid;
    // ignore the event the browser fires for the open state we rendered ourselves
    if (!openState.has(gid) && d.open === (d.dataset.def === '1')) return;
    openState.set(gid, d.open);
  }
  root.addEventListener('click', onClick);
  root.addEventListener('change', onChange);
  root.addEventListener('toggle', onToggle, true);

  render();
  return {
    update(next) { c = next; render(); },
    unmount() {
      stop();
      if (fx) { fx.destroy(); fx = null; }
      if (panelRo) panelRo.disconnect();
      root.removeEventListener('click', onClick);
      root.removeEventListener('change', onChange);
      root.removeEventListener('toggle', onToggle, true);
    },
  };
}
