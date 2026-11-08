// Doctor dashboard: Alex Chen's notes replayed in date order.
// Every number on this page is computed at run time by engine.js from weights.js
// (published odds ratios) and alex.js (Alex's notes). Nothing numeric is typed in here.
// The builders below are pure (data in, HTML string out) so tests/doctor.test.mjs can
// run them in Node; boot() at the bottom wires them to the page.
import {
  timeline, stateAt, monthsSaved, detectDecline, formatPct,
  ACTIONS, HOME_TESTS, FINDINGS, PRIOR, SOURCES, DEFAULT_REFERRAL_LINE, UNCLEAR_DEADLINE_WEEKS,
} from './engine.js';
import { REFERRAL_LINES } from './weights.js';

export const DEFAULT_DATE = '2024-12-09';
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY = 86400000;
const toTime = (d) => Date.parse(fullDate(d) + 'T00:00:00Z');
const fullDate = (d) => (/^\d{4}-\d{2}$/.test(d) ? `${d}-01` : d);

// ---------- small formatters ----------
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function fmtDate(d) {
  if (!d) return '–';
  const [y, m, dd] = String(d).split('-').map(Number);
  if (!y || !m) return String(d);
  return dd ? `${dd} ${MON[m - 1]} ${y}` : `${MON[m - 1]} ${y}`;
}

// Odds ratios: one decimal from 10 up ("31.0"), three significant figures below ("4.57", "1.5").
export function fmtOr(x) {
  if (x == null || !Number.isFinite(x)) return '–';
  return x >= 10 ? x.toFixed(1) : String(parseFloat(x.toPrecision(3)));
}
export function weightText(f) {
  if (!f || f.or == null) return null;
  // A team assumption is not an adjusted odds ratio from a study, so it is not called one.
  return `${f.source === 'assumption' ? 'Assumed OR' : 'aOR'} ${fmtOr(f.or)} (${fmtOr(f.lo)} to ${fmtOr(f.hi)})`;
}
// Simulated home-test instances that an evaluation counted (they must carry the SIMULATED tag).
export const simCounted = (ev) => ((ev && ev.state && ev.state.instances) || []).filter((i) => i.simulated);
const SIM_TAG = '<span class="sim-tag" title="Includes Alex\'s simulated home-test results">SIMULATED</span>';
export function fmtProduct(x) {
  if (x == null || !Number.isFinite(x)) return '–';
  if (x >= 1e6) return `about ${Math.round(x / 1e6).toLocaleString('en-CA')} million`;
  if (x >= 100) return Math.round(x).toLocaleString('en-CA');
  if (x >= 10) return x.toFixed(1);
  return String(parseFloat(x.toPrecision(3)));
}
// formatPct rounds 99.5% and above to "100%"; a probability is never certain, so say ">99%".
export const pct = (p) => (p != null && p >= 0.995 ? '>99%' : formatPct(p));
export const rangeText = (r) => (r.lo >= 0.995 ? 'above 99%' : `${pct(r.lo)} to ${pct(r.hi)}`);
export const lineLabel = (v) => (REFERRAL_LINES.find((l) => Math.abs(l.value - v) < 1e-9) || {}).label || formatPct(v);
const fmtVal = (x) => (Number.isFinite(x) ? String(Math.round(x * 10) / 10) : '–');
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

export const TIER_NAME = { high: 'High', unclear: 'Unclear', low: 'Low' };
export const TIER_HEADLINE = {
  high: 'Needs EMG and neuromuscular workup',
  unclear: `Track weekly and decide within ${UNCLEAR_DEADLINE_WEEKS} weeks`,
  low: 'No neuromuscular workup now',
};

function sourceLink(key) {
  const s = SOURCES[key];
  if (!s) return '';
  if (key === 'assumption') return `<span class="assume-tag">ASSUMPTION</span> <span class="muted">${esc(s.short)}</span>`;
  return s.url
    ? `<a href="${esc(s.url)}" target="_blank" rel="noopener" title="${esc(s.cite)}">${esc(s.short)}</a>`
    : esc(s.short);
}
const tierBadge = (t) => `<span class="tier ${t}">${TIER_NAME[t] || esc(t)}</span>`;

// ---------- state ----------
// Reads the shared browser state (rfn.*). Works with any object that has getItem.
export function readStore(ls) {
  const get = (k) => { try { return ls ? ls.getItem(k) : null; } catch { return null; } };
  const lineRaw = parseFloat(get('rfn.referralLine'));
  const line = Number.isFinite(lineRaw) && lineRaw > 0 && lineRaw < 1 ? lineRaw : DEFAULT_REFERRAL_LINE;
  const inc = get('rfn.includeHomeTests');
  // Simulated home tests are off unless switched on: the first numbers a viewer sees rest on real notes.
  const includeHome = inc === 'true';
  let mdc = null;
  try {
    const m = JSON.parse(get('rfn.mdc') || 'null');
    if (m && typeof m === 'object') {
      const clean = {};
      for (const [k, v] of Object.entries(m)) {
        const n = Number(v && typeof v === 'object' ? v.mdc : v);
        if (HOME_TESTS[k] && Number.isFinite(n) && n > 0) clean[k] = n;
      }
      if (Object.keys(clean).length) mdc = clean;
    }
  } catch { /* ignore a malformed value */ }
  let homeResults = [];
  try {
    const a = JSON.parse(get('rfn.homeResults') || '[]');
    if (Array.isArray(a)) {
      // Team calibration trials (calibration: true) measure test noise; they are never a patient series.
      homeResults = a.filter((r) => r && !r.calibration && HOME_TESTS[r.test] && typeof r.date === 'string' && Number.isFinite(Number(r.value)))
        .map((r) => ({ ...r, value: Number(r.value) }));
    }
  } catch { /* ignore */ }
  return { line, includeHome, mdc, homeResults };
}

export function engineOpts(S) {
  const o = { referralLine: S.line, includeHomeTests: S.includeHome, exclude: S.exclude || new Set() };
  if (S.mdc) o.mdc = S.mdc;
  return o;
}

export function dateOptions(tl) {
  return tl.map((ev) => ({
    date: ev.asOf,
    kind: ev.encounter ? 'encounter' : 'home',
    label: `${fmtDate(ev.asOf)} · ${ev.encounter ? ev.encounter.setting : 'home test'}`,
    tier: ev.tier,
  }));
}

// The wanted date if it is on the list, else the latest listed date before it, else the first.
export function pickDate(dates, wanted) {
  if (!dates.length) return null;
  if (wanted && dates.includes(wanted)) return wanted;
  if (wanted) {
    const before = dates.filter((d) => d <= wanted);
    if (before.length) return before[before.length - 1];
  }
  return dates[0];
}

// The timeline and months saved depend on the settings, not on the selected date, so
// they are cached per setting: stepping through dates then costs almost nothing.
const cache = new Map();
export function computeView(cf, S) {
  const opts = engineOpts(S);
  const key = JSON.stringify([opts.referralLine, opts.includeHomeTests, opts.mdc || null, [...opts.exclude].sort(), (cf.encounters || []).length, (cf.homeTests || []).length]);
  let hit = cache.get(key);
  if (!hit || hit.cf !== cf) {
    const tl = timeline(cf, opts);
    hit = {
      cf, tl, dates: tl.map((e) => e.asOf),
      ms: monthsSaved(cf, { ...opts, includeHomeTests: false }),
      msHome: S.includeHome ? monthsSaved(cf, opts) : null,
      // The claim that holds at every referral line (notes only): the smallest gain.
      msByLine: REFERRAL_LINES.map((l) => ({ label: l.label, ...monthsSaved(cf, { ...opts, includeHomeTests: false, referralLine: l.value }) })),
    };
    if (cache.size > 40) cache.clear();
    cache.set(key, hit);
  }
  const { tl, dates, ms, msHome, msByLine } = hit;
  const asOf = pickDate(dates, S.asOf);
  const ev = tl.find((e) => e.asOf === asOf) || null;
  const full = asOf ? stateAt(cf, asOf, { ...opts, exclude: new Set() }) : null;
  return { cf, S, opts, tl, dates, asOf, ev, full, ms, msHome, msByLine };
}

// ---------- log-scale axis: 0.01% to 100% ----------
const LOG_MIN = -4;
const LOG_MAX = 0;
export function xLog(p, x0, x1) {
  const l = Math.log10(Math.min(1, Math.max(1e-4, p)));
  return x0 + ((l - LOG_MIN) / (LOG_MAX - LOG_MIN)) * (x1 - x0);
}

// ---------- 0. header line ----------
export function renderLede(ctx) {
  const { ms, cf } = ctx;
  const name = cf.patient?.name || 'the patient';
  const nEx = ctx.S && ctx.S.exclude ? ctx.S.exclude.size : 0;
  const wi = nEx ? `<span class="assume-tag">WHAT-IF</span> ${plural(nEx, 'finding')} left out below, so this is not the real record. ` : '';
  if (!ms.firstHigh) return `${wi}${esc(name)}'s notes replayed in date order. On these notes the tool never reached High.`;
  const m = ms.months;
  const first = esc(name.split(' ')[0]);
  const byLine = (ctx.msByLine || []).filter((x) => x.monthsVsReferral != null);
  const worst = byLine.length === (ctx.msByLine || []).length && byLine.length
    ? byLine.reduce((a, b) => (b.monthsVsReferral < a.monthsVsReferral ? b : a)) : null;
  const robust = worst && !nEx
    ? `<strong>At every referral line from ${esc(byLine[0].label)} to ${esc(byLine[byLine.length - 1].label)}, the notes alone would have asked for an EMG at least ${Math.floor(worst.monthsVsReferral)} months before ${first}'s real neurology referral (${fmtDate(worst.referral)}).</strong> `
    : '';
  const mr = ms.monthsVsReferral;
  return `${wi}${esc(name)}'s notes replayed in date order, using only what was written by each date. ${robust}`
    + `${robust ? 'At the current line' : '<strong>On the notes alone'}, the tool asks for an EMG on ${fmtDate(ms.firstHigh)}${mr > 0 ? `, about ${Math.round(mr)} months before the real referral${robust ? '' : ` (${fmtDate(ms.referral)})`}` : (m > 0 ? `, about ${Math.round(m)} months before the first neuromuscular visit` : '')}.${robust ? '' : '</strong>'}`
    + ' After a referral he still waited 16 weeks, so the gain is counted referral to referral.';
}

// ---------- 2. tier banner ----------
export function renderBanner(ctx) {
  const { ev } = ctx;
  if (!ev) return '';
  const t = ev.tier;
  const a = ACTIONS[t] || {};
  const enc = ev.encounter;
  const r = ev.range;
  let deadline = '';
  if (ev.steppedDown) {
    deadline = `<p class="deadline">Stepped down at the ${UNCLEAR_DEADLINE_WEEKS}-week review (unclear since ${fmtDate(ev.unclearSince)}). Safety-net advice applies.</p>`;
  } else if (t === 'unclear' && ev.unclearSince) {
    const left = UNCLEAR_DEADLINE_WEEKS - (ev.weeksUnclear || 0);
    const n = Math.max(0, Math.round(left));
    deadline = left > 0
      ? `<p class="deadline"><strong>${plural(n, 'week')} left</strong> of the ${UNCLEAR_DEADLINE_WEEKS}-week deadline (unclear since ${fmtDate(ev.unclearSince)}). By then: escalate on a decline beyond normal variation or a new body region; otherwise step down.</p>`
      : `<p class="deadline"><strong>The ${UNCLEAR_DEADLINE_WEEKS}-week deadline has passed</strong> (unclear since ${fmtDate(ev.unclearSince)}). Decide now: escalate or step down.</p>`;
    const declines = (ev.state && ev.state.homeDeclines) || [];
    if (declines.length) {
      deadline += `<p class="deadline">A home-test decline beyond normal variation is already counted (${declines.map((h) => `${esc(HOME_TESTS[h.test]?.label || h.test)}, ${fmtDate(h.date)}`).join('; ')})${declines.some((h) => h.simulated) ? ` ${SIM_TAG}` : ''}. The plan above escalates on a decline like this.</p>`;
    }
  }
  const sims = simCounted(ev);
  const simLine = sims.length
    ? `<p class="tb-sim">${SIM_TAG} This result counts Alex's simulated home-test decline (an assumed odds ratio). Switch home tests off above to see the notes alone.</p>`
    : '';
  const nEx = ctx.S && ctx.S.exclude ? ctx.S.exclude.size : 0;
  const whatIf = nEx ? `<p class="tb-whatif"><span class="assume-tag">WHAT-IF</span> ${plural(nEx, 'finding')} left out in the table below; this is not the real record.</p>` : '';
  const numberLine = `By the number alone: ${tierBadge(ev.byNumber)} the 95% range (${rangeText(r)}) is ${ev.byNumber === 'high' ? 'all above' : ev.byNumber === 'low' ? 'all below' : 'across'} the ${lineLabel(ev.line)} referral line.`
    + (ev.rulesFired.length && ev.byNumber !== 'high' ? ' A pattern rule overrides the number.' : '');
  const rules = ev.rulesFired.length
    ? `<h3 class="rules-h">${plural(ev.rulesFired.length, 'pattern rule')} fired</h3><ul class="rules">${ev.rulesFired.map((rule) => `
        <li><strong>${esc(rule.label)}.</strong> ${esc(rule.why)} <span class="src">Source: ${sourceLink(rule.source)}</span></li>`).join('')}</ul>`
    : '<p class="muted rules-none">No pattern rule fired on this date.</p>';
  return `<div class="banner ${t} tier-banner">
    <div class="tb-top">
      <div class="tb-tier">${tierBadge(t)}<strong class="tb-headline">${TIER_HEADLINE[t] || ''}</strong></div>
      <div class="tb-when">As of <strong>${fmtDate(ev.asOf)}</strong> · ${enc ? esc(enc.setting) : `home test${(ctx.cf.homeTests || []).some((h) => h.date === ev.asOf && h.simulated) ? ` ${SIM_TAG}` : ''}`}<br><span class="muted">A referral prompt, not a diagnosis</span></div>
    </div>
    ${whatIf}
    <p class="tb-action"><strong>Action:</strong> ${esc(a.doctor || '')}</p>
    <p class="tb-reason"><strong>Why:</strong> ${esc(ev.reason)}.</p>
    <p class="tb-number">${numberLine}</p>
    ${simLine}
    ${deadline}
    ${rules}
  </div>`;
}

// ---------- 3. range chart ----------
export function rangeSvg(ev) {
  const W = 1000; const H = 150; const x0 = 40; const x1 = 960;
  const X = (p) => xLog(p, x0, x1).toFixed(1);
  const r = ev.range;
  const ticks = [1e-4, 1e-3, 1e-2, 1e-1, 1];
  const TICK_LABELS = ['0.01%', '0.1%', '1%', '10%', '100%'];
  const minor = [];
  for (let e = -4; e < 0; e++) for (let k = 2; k <= 9; k++) minor.push(k * 10 ** e);
  const pLo = X(PRIOR.lo); const pHi = X(PRIOR.hi);
  const lx = X(ev.line);
  const barW = Math.max(3, X(r.hi) - X(r.lo));
  return `<svg class="range-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="95% range ${rangeText(r)}, median ${pct(r.median)}, referral line ${lineLabel(ev.line)}">
    <line class="rc-axis" x1="${x0}" y1="110" x2="${x1}" y2="110"/>
    ${minor.map((p) => `<line class="rc-minor" x1="${X(p)}" y1="110" x2="${X(p)}" y2="114"/>`).join('')}
    ${ticks.map((p, i) => `<line class="rc-tick" x1="${X(p)}" y1="104" x2="${X(p)}" y2="118"/><text class="rc-tlabel" x="${X(p)}" y="134" text-anchor="middle">${TICK_LABELS[i]}</text>`).join('')}
    <rect class="rc-prior" x="${pLo}" y="100" width="${Math.max(2, pHi - pLo)}" height="10"/>
    <text class="rc-prior-label" x="${(+pHi) + 6}" y="98">starting rate</text>
    <rect class="rc-bar ${ev.byNumber}" x="${X(r.lo)}" y="44" width="${barW.toFixed(1)}" height="32" rx="4"/>
    <line class="rc-median" x1="${X(r.median)}" y1="38" x2="${X(r.median)}" y2="82"/>
    <line class="rc-line" x1="${lx}" y1="14" x2="${lx}" y2="118"/>
    <text class="rc-mlabel" x="${X(r.median)}" y="33" text-anchor="${+X(r.median) > 900 ? 'end' : +X(r.median) < 100 ? 'start' : 'middle'}">median ${pct(r.median)}</text>
    <text class="rc-llabel" x="${lx}" y="11" text-anchor="${+lx > 860 ? 'end' : 'middle'}">referral line ${lineLabel(ev.line)}</text>
  </svg>`;
}

export function renderRange(ctx) {
  const { ev } = ctx;
  if (!ev) return '';
  const r = ev.range;
  const ids = r.ids;
  const chain = ids.length
    ? `${ids.map((id) => `<span title="${esc(FINDINGS[id]?.label)}">${fmtOr(FINDINGS[id]?.or)}</span>`).join(' × ')} = <strong>${fmtProduct(r.orProduct)}</strong>`
    : '<strong>1</strong> (no weighted findings yet)';
  const assumed = ids.filter((id) => FINDINGS[id]?.source === 'assumption').length;
  const lineOpt = REFERRAL_LINES.find((l) => Math.abs(l.value - ev.line) < 1e-9);
  const sims = simCounted(ev);
  return `<div class="sec-head"><h2 id="range-h">Estimated chance, on what was recorded by this date</h2>
      <p class="muted">Chance of a motor neuron disease (MND/ALS) diagnosis within ${PRIOR.horizonYears} years, given the findings below. Log scale: each step to the right is 10 times larger.</p></div>
    ${rangeSvg(ev)}
    <p class="caption">95% range: <strong>${rangeText(r)}</strong> (median ${pct(r.median)}), from ${r.nSims.toLocaleString('en-CA')} simulations.${sims.length ? ` ${SIM_TAG} Includes Alex's simulated home-test decline.` : ''}</p>
    <dl class="facts">
      <div><dt>Starting rate</dt><dd>${esc(PRIOR.label)}. <span class="muted">Sources: ${PRIOR.sources.map(sourceLink).join('; ')}</span></dd></div>
      <div><dt>Combined odds ratio</dt><dd>${chain} <span class="muted">(${plural(ids.length, 'odds ratio')} multiplied${assumed ? `, ${assumed} of them a team assumption` : ''}; each sign counted once)</span>${assumed ? ' <span class="assume-tag">ASSUMPTION</span>' : ''}</dd></div>
      <div><dt>Referral line</dt><dd>${lineLabel(ev.line)}${lineOpt ? `: ${esc(lineOpt.note)}` : ''}. <span class="muted">A values choice, not a statistic; change it above.</span></dd></div>
    </dl>`;
}

// ---------- 4. findings table ----------
export function renderFindings(ctx) {
  const { full, S, cf, asOf } = ctx;
  if (!full) return '';
  const excl = S.exclude || new Set();
  const rows = [...full.instances].sort((a, b) => a.date.localeCompare(b.date));
  const firstCounted = {};
  for (const i of rows) if (!excl.has(i.key) && !(i.id in firstCounted)) firstCounted[i.id] = i;
  const encById = Object.fromEntries((cf.encounters || []).map((e) => [e.id, e]));
  const body = rows.map((inst) => {
    const f = FINDINGS[inst.id];
    const on = !excl.has(inst.key);
    const enc = encById[inst.encounterId];
    const dup = on && firstCounted[inst.id] && firstCounted[inst.id].key !== inst.key;
    let weight;
    if (!f) weight = '<span class="muted">Not in the weight table</span>';
    else if (f.or == null) weight = `<span class="pattern">Pattern sign: triggers a rule</span><br><span class="src">${sourceLink(f.source)}</span>`;
    else weight = `<span class="aor">${weightText(f)}</span><br><span class="src">${sourceLink(f.source)}</span>`;
    if (dup) weight += `<br><span class="dup">Counted once: first noted ${fmtDate(firstCounted[inst.id].date)}</span>`;
    const tags = [
      inst.simulated ? '<span class="sim-tag">SIMULATED</span>' : '',
      f && f.source === 'assumption' && f.or != null ? '<span class="assume-tag">ASSUMPTION</span>' : '',
    ].filter(Boolean).join(' ');
    let note = '';
    if (enc && enc.note) {
      const idx = enc.note.indexOf(inst.quote);
      const marked = idx >= 0
        ? `${esc(enc.note.slice(0, idx))}<mark>${esc(inst.quote)}</mark>${esc(enc.note.slice(idx + inst.quote.length))}`
        : esc(enc.note);
      note = `<details class="note"><summary>Full note${enc.title ? `: ${esc(enc.title)}` : ''}</summary><p>${marked}</p><p class="muted">${esc(enc.clinician || '')}</p></details>`;
    }
    const recon = enc && enc.reconstructed
      ? `<p class="recon">${typeof enc.reconstructed === 'string' ? esc(enc.reconstructed) : 'Reconstructed from a later note.'}</p>` : '';
    const region = inst.region ? `<span class="muted region">Region: ${esc(inst.region)}${f?.motor ? ' (motor sign)' : ''}</span>` : '';
    return `<tr class="${on ? '' : 'excluded'}${dup ? ' dup-row' : ''}">
      <td class="nowrap">${fmtDate(inst.date)}</td>
      <td>${inst.kind === 'home' ? 'Home test' : esc(inst.setting || '')}</td>
      <td class="f-label"><strong>${esc(f ? f.label : inst.id)}</strong><br>${region}</td>
      <td class="f-quote">${inst.kind === 'home'
    ? `<p class="home-quote"><span class="muted">Computed from the home-test series, not a quote from a note:</span><br>${esc(inst.quote)}</p>`
    : `<blockquote class="quote">${esc(inst.quote)}</blockquote>`}${recon}${note}</td>
      <td class="f-weight">${weight}</td>
      <td class="f-tags">${tags}</td>
      <td class="f-whatif"><label class="whatif"><input type="checkbox" data-key="${esc(inst.key)}" ${on ? 'checked' : ''}> <span>${on ? 'Counted' : 'Left out'}</span></label></td>
    </tr>`;
  }).join('');
  const nEx = rows.filter((i) => excl.has(i.key)).length;
  const negs = [];
  const winStart = new Date(toTime(asOf) - PRIOR.horizonYears * 365.25 * DAY).toISOString().slice(0, 10);
  for (const enc of cf.encounters || []) {
    if (enc.date > asOf || enc.date < winStart) continue;
    for (const n of enc.negatives || []) negs.push({ enc, n });
  }
  return `<div class="sec-head row-between"><div><h2 id="findings-h">Findings on ${fmtDate(asOf)}</h2>
      <p class="muted">Each finding quotes the exact sentence from the note, so it can be checked. For this demo the findings were extracted by hand (AI-assisted) and a test checks every quote word for word; in use, an extractor would propose them and the doctor confirms. The number above is plain arithmetic. Untick a finding to see the result without it.</p></div>
      <div class="whatif-bar">${nEx ? `<span class="assume-tag">WHAT-IF</span> ${plural(nEx, 'finding')} left out <button type="button" data-action="reset-whatif">Count all again</button>` : `<span class="muted">${plural(rows.length, 'finding')} recorded so far</span>`}</div></div>
    <div class="table-wrap"><table class="findings-table">
      <thead><tr><th>Date</th><th>Setting</th><th>Finding</th><th>Exact quote from the note</th><th>Weight and source</th><th>Tags</th><th>What-if</th></tr></thead>
      <tbody>${body || '<tr><td colspan="7" class="muted">No findings in the notes yet.</td></tr>'}</tbody>
    </table></div>
    <h3 class="negs-h">Recorded but not weighted</h3>
    <p class="muted">What the notes say is absent or normal, kept with its quote. These do not change the number.</p>
    ${negs.length ? `<ul class="negs">${negs.map(({ enc, n }) => `<li><span class="neg-when">${fmtDate(enc.date)} · ${esc(enc.setting)}</span><strong>${esc(n.label)}</strong><blockquote class="quote">${esc(n.quote)}</blockquote></li>`).join('')}</ul>` : '<p class="muted">None recorded yet.</p>'}`;
}

// ---------- 5. replay ----------
function stripSvg(ctx) {
  const { tl, cf, ms, msHome, asOf } = ctx;
  if (!tl.length) return '';
  const W = 1000; const H = 150; const x0 = 24; const x1 = 976;
  const startD = cf.actual?.firstSymptom ? fullDate(cf.actual.firstSymptom) : tl[0].asOf;
  const endD = [cf.actual?.diagnosis, cf.actual?.firstNeuromuscular, tl[tl.length - 1].asOf].filter(Boolean).sort().pop();
  const t0 = Math.min(toTime(startD), toTime(tl[0].asOf)) - 12 * DAY;
  const t1 = toTime(endD) + 18 * DAY;
  const X = (d) => x0 + ((toTime(d) - t0) / (t1 - t0)) * (x1 - x0);
  const f = (v) => v.toFixed(1);
  const runs = [];
  tl.forEach((e, i) => {
    const end = i + 1 < tl.length ? tl[i + 1].asOf : endD;
    const last = runs[runs.length - 1];
    if (last && last.tier === e.tier) last.end = end; else runs.push({ tier: e.tier, start: e.asOf, end });
  });
  const segs = runs.map((g) => {
    const a = X(g.start); const b = X(g.end);
    return `<rect class="st-seg ${g.tier}" x="${f(a)}" y="50" width="${f(Math.max(1, b - a))}" height="22"><title>${TIER_NAME[g.tier]} from ${fmtDate(g.start)}</title></rect>`;
  }).join('');
  const preA = X(startD); const preB = X(tl[0].asOf);
  const pre = preB - preA > 4 ? `<rect class="st-pre" x="${f(preA)}" y="50" width="${f(preB - preA)}" height="22"/>${preB - preA > 90 ? `<text class="st-pre-label" x="${f((preA + preB) / 2)}" y="65" text-anchor="middle">no notes yet</text>` : ''}` : '';
  // month ticks every 3 months
  const ticks = [];
  const s = new Date(t0); let y = s.getUTCFullYear(); let m = s.getUTCMonth() + 1;
  while (m % 3 !== 1) { m++; if (m > 12) { m = 1; y++; } }
  for (;;) {
    const d = `${y}-${String(m).padStart(2, '0')}-01`;
    if (toTime(d) > t1) break;
    const x = X(d);
    ticks.push(`<line class="st-tick" x1="${f(x)}" y1="118" x2="${f(x)}" y2="124"/><text class="st-tlabel" x="${f(x)}" y="138" text-anchor="middle">${m === 1 ? `Jan ${y}` : MON[m - 1]}</text>`);
    m += 3; if (m > 12) { m -= 12; y++; }
  }
  // encounter markers (numbered like the table)
  const encs = [...(cf.encounters || [])].sort((a, b) => a.date.localeCompare(b.date));
  let lastX = -99; let lift = 0;
  const marks = encs.map((e, i) => {
    const x = X(e.date);
    lift = x - lastX < 18 ? (lift ? 0 : 1) : 0;
    lastX = x;
    const cy = lift ? 38 : 61;
    const ev = tl.find((t) => t.asOf === e.date);
    return `<g class="st-enc${e.date === asOf ? ' sel' : ''}" data-date="${e.date}" tabindex="0" role="button" aria-label="${fmtDate(e.date)}, ${esc(e.setting)}">
      <title>${fmtDate(e.date)} · ${esc(e.setting)}: ${ev ? TIER_NAME[ev.tier] : ''}</title>
      ${lift ? `<line class="st-stem" x1="${f(x)}" y1="${cy + 8}" x2="${f(x)}" y2="52"/>` : ''}
      <circle cx="${f(x)}" cy="${cy}" r="9"/><text x="${f(x)}" y="${cy + 4}" text-anchor="middle">${i + 1}</text></g>`;
  }).join('');
  const cursor = asOf ? `<line class="st-cursor" x1="${f(X(asOf))}" y1="44" x2="${f(X(asOf))}" y2="80"/>` : '';
  let flags = '';
  if (cf.actual?.firstSymptom) {
    flags += `<line class="st-flag-line" x1="${f(X(startD))}" y1="40" x2="${f(X(startD))}" y2="50"/><text class="st-small" x="${f(X(startD))}" y="36">first symptom, ${fmtDate(cf.actual.firstSymptom)}</text>`;
  }
  // Compare referral with referral: the real referral date, not the visit after the waiting list.
  const actual = ms.referral || ms.actual;
  const gap = ms.referral ? ms.monthsVsReferral : ms.months;
  if (actual) {
    const xa = X(actual);
    flags += `<line class="st-flag-line real" x1="${f(xa)}" y1="18" x2="${f(xa)}" y2="84"/><text class="st-flag real" x="${f(xa - 6)}" y="16" text-anchor="end">Reality: ${ms.referral ? 'neurology referral' : 'first neuromuscular visit'}, ${fmtDate(actual)}</text>`;
  }
  if (ms.firstHigh) {
    const xh = X(ms.firstHigh);
    flags += `<line class="st-flag-line tool" x1="${f(xh)}" y1="18" x2="${f(xh)}" y2="84"/><text class="st-flag tool" x="${f(xh + 6)}" y="16">Tool: EMG prompt, ${fmtDate(ms.firstHigh)}</text>`;
    if (actual && gap > 0) {
      const xa = X(actual);
      flags += `<path class="st-bracket" d="M${f(xh)} 88 v6 H${f(xa)} v-6"/><text class="st-gap" x="${f((xh + xa) / 2)}" y="110" text-anchor="middle">about ${Math.round(gap)} months earlier referral, on the notes alone</text>`;
    }
  }
  if (msHome && msHome.firstHigh && msHome.firstHigh !== ms.firstHigh) {
    const xh2 = X(msHome.firstHigh);
    flags += `<line class="st-flag-line home" x1="${f(xh2)}" y1="44" x2="${f(xh2)}" y2="84"/>`;
  }
  return `<svg class="strip-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Tool tier over time from first symptom to diagnosis">
    ${pre}${segs}${cursor}${flags}${marks}
    <line class="st-axis" x1="${x0}" y1="118" x2="${x1}" y2="118"/>${ticks.join('')}
  </svg>`;
}

export function renderReplay(ctx) {
  const { tl, cf, ms, msHome, asOf, S } = ctx;
  const byDate = Object.fromEntries(tl.map((e) => [e.asOf, e]));
  const encs = [...(cf.encounters || [])].sort((a, b) => a.date.localeCompare(b.date));
  const firstHighEnc = encs.find((e) => byDate[e.date]?.tier === 'high');
  const rows = encs.map((e, i) => {
    const ev = byDate[e.date];
    const first = firstHighEnc && firstHighEnc.id === e.id;
    return `<tr class="rp-row${e.date === asOf ? ' sel' : ''}${first ? ' first-high' : ''}" data-date="${e.date}" tabindex="0" title="Show this date">
      <td class="nowrap"><span class="rp-num">${i + 1}</span> ${fmtDate(e.date)}</td>
      <td><strong>${esc(e.setting)}</strong><br><span class="muted">${esc(e.clinician || '')}</span></td>
      <td>${esc(e.whatHappened || '')}</td>
      <td class="nowrap">${ev ? `${tierBadge(ev.tier)}${first ? ' <span class="first-tag">First High</span>' : ''}<br><span class="muted">${rangeText(ev.range)}</span>${simCounted(ev).length ? ` ${SIM_TAG}` : ''}${ev.rulesFired.length ? `<br><span class="muted">${plural(ev.rulesFired.length, 'rule')} fired</span>` : ''}` : '–'}</td>
    </tr>`;
  }).join('');
  const encAt = (d) => encs.find((e) => e.date === d);
  const what = (d) => (encAt(d) ? `${esc(encAt(d).setting)} visit` : 'home test');
  let summary;
  if (!ms.firstHigh) {
    summary = '<div class="summary-card"><p>On these notes the tool never reached High.</p></div>';
  } else {
    const m = ms.monthsVsReferral ?? ms.months;
    summary = `<div class="summary-card">
      <div class="sum-col"><span class="k">Tool</span><strong>EMG referral on ${fmtDate(ms.firstHigh)}</strong><span class="muted">${what(ms.firstHigh)}</span></div>
      <div class="sum-col"><span class="k">Reality</span><strong>Neurology referral ${fmtDate(ms.referral || ms.actual)}</strong><span class="muted">${ms.actual ? `seen ${fmtDate(ms.actual)} (16 weeks later)` : ''}${cf.actual?.diagnosis ? `; ALS diagnosed ${fmtDate(cf.actual.diagnosis)}` : ''}</span></div>
      <div class="sum-col big"><span class="k">Difference</span><strong>${m > 0 ? `About ${Math.round(m)} months earlier referral` : 'Not earlier'}</strong><span class="muted">${fmtVal(m)} months, referral to referral, from the notes alone (no simulated data)</span></div>
    </div>`;
    if (msHome && msHome.firstHigh && msHome.firstHigh !== ms.firstHigh) {
      summary += `<p class="sum-home"><span class="sim-tag">SIMULATED</span> With Alex's simulated home tests included: EMG referral on ${fmtDate(msHome.firstHigh)} (${what(msHome.firstHigh)}), ${fmtVal(msHome.monthsVsReferral ?? msHome.months)} months before the real referral.</p>`;
    } else if (S.includeHome) {
      summary += '<p class="sum-home muted">Including the simulated home tests does not change this date.</p>';
    }
  }
  return `<div class="sec-head"><h2 id="replay-h">Replay: what the tool would have said at each visit</h2>
      <p class="muted">Colour shows the tool's tier on each date with the settings above. Click a visit to jump to it.</p></div>
    <div class="strip-legend"><span class="lg high">High</span><span class="lg unclear">Unclear</span><span class="lg low">Low</span><span class="lg pre">No notes yet</span></div>
    ${stripSvg(ctx)}
    ${summary}
    <div class="table-wrap"><table class="replay-table">
      <thead><tr><th>Date</th><th>Who</th><th>What really happened</th><th>Tool on that date</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
}

// ---------- 6. home tests ----------
function homeSvg(points, { mode, domain, asOf, mdc, higherIsBetter, decline }) {
  const W = 460; const H = 190; const l = 44; const rgt = 12; const t = 14; const b = 30;
  if (!points.length) return '';
  const base = points.length >= 2 ? (points[0].value + points[1].value) / 2 : points[0].value;
  const vals = points.map((p) => p.value).concat([base - mdc, base + mdc]);
  let ymin = Math.min(...vals); let ymax = Math.max(...vals);
  const pad = (ymax - ymin) * 0.15 || 1; ymin -= pad; ymax += pad;
  const Y = (v) => t + ((ymax - v) / (ymax - ymin)) * (H - t - b);
  let X;
  if (mode === 'date') {
    const a = toTime(domain[0]); const z = toTime(domain[1]);
    X = (p) => l + (z > a ? (toTime(p.date) - a) / (z - a) : 0.5) * (W - l - rgt);
  } else {
    const n = points.length;
    X = (p, i) => l + (n > 1 ? i / (n - 1) : 0.5) * (W - l - rgt);
  }
  const f = (v) => v.toFixed(1);
  const pts = points.map((p, i) => ({ ...p, x: X(p, i), y: Y(p.value), future: mode === 'date' && asOf && p.date > asOf }));
  const seen = pts.filter((p) => !p.future);
  const fut = pts.filter((p) => p.future);
  const poly = (arr) => arr.map((p) => `${f(p.x)},${f(p.y)}`).join(' ');
  const bandTop = Y(base + mdc); const bandBot = Y(base - mdc);
  const dPt = decline ? pts.find((p) => p.date === decline.date) : null;
  const ax = mode === 'date' && asOf && asOf >= domain[0] && asOf <= domain[1] ? X({ date: asOf }) : null;
  const xl = mode === 'date'
    ? `<text class="hc-x" x="${l}" y="${H - 8}">${fmtDate(domain[0])}</text><text class="hc-x" x="${W - rgt}" y="${H - 8}" text-anchor="end">${fmtDate(domain[1])}</text>`
    : `<text class="hc-x" x="${l}" y="${H - 8}">result 1</text><text class="hc-x" x="${W - rgt}" y="${H - 8}" text-anchor="end">result ${points.length}</text>`;
  return `<svg class="home-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Home test results with baseline and normal variation band">
    <rect class="hc-band" x="${l}" y="${f(bandTop)}" width="${W - l - rgt}" height="${f(Math.max(1, bandBot - bandTop))}"/>
    <line class="hc-base" x1="${l}" y1="${f(Y(base))}" x2="${W - rgt}" y2="${f(Y(base))}"/>
    <text class="hc-y" x="${l - 6}" y="${f(Y(base) + 4)}" text-anchor="end">${fmtVal(base)}</text>
    <text class="hc-y" x="${l - 6}" y="${f(bandTop + 4)}" text-anchor="end">${fmtVal(base + mdc)}</text>
    <text class="hc-y" x="${l - 6}" y="${f(bandBot + 4)}" text-anchor="end">${fmtVal(base - mdc)}</text>
    <text class="hc-band-label" x="${W - rgt - 4}" y="${f(bandTop + 12)}" text-anchor="end">normal variation (±${fmtVal(mdc)})</text>
    ${ax != null ? `<line class="hc-asof" x1="${f(ax)}" y1="${t - 4}" x2="${f(ax)}" y2="${H - b}"/><text class="hc-asof-label" x="${f(ax)}" y="${t - 5}" text-anchor="${ax > W - 60 ? 'end' : 'middle'}">as of</text>` : ''}
    ${seen.length > 1 ? `<polyline class="hc-line" points="${poly(seen)}"/>` : ''}
    ${fut.length ? `<polyline class="hc-line future" points="${poly((seen.length ? [seen[seen.length - 1]] : []).concat(fut))}"/>` : ''}
    ${pts.map((p) => `<circle class="hc-dot${p.future ? ' future' : ''}" cx="${f(p.x)}" cy="${f(p.y)}" r="3.5"><title>${fmtDate(p.date)}: ${fmtVal(p.value)}</title></circle>`).join('')}
    ${dPt ? `<circle class="hc-decline" cx="${f(dPt.x)}" cy="${f(dPt.y)}" r="8"/><text class="hc-decline-label" x="${f(dPt.x)}" y="${f(Math.min(H - b - 4, dPt.y + (higherIsBetter ? 22 : -14)))}" text-anchor="middle">decline counted</text>` : ''}
    <line class="hc-axis" x1="${l}" y1="${H - b}" x2="${W - rgt}" y2="${H - b}"/>
    ${xl}
  </svg>`;
}

export function renderHome(ctx) {
  const { cf, S, asOf } = ctx;
  const mdcFor = (test) => (S.mdc && S.mdc[test] ? { v: S.mdc[test], measured: true } : { v: HOME_TESTS[test].placeholderMdc, measured: false });
  const mdcTag = (m) => (m.measured ? '<span class="real-tag">MEASURED MDC</span>' : '<span class="assume-tag">PLACEHOLDER MDC</span>');
  const alexTests = [...new Set((cf.homeTests || []).map((h) => h.test))].filter((k) => HOME_TESTS[k]);
  const allDates = (cf.homeTests || []).map((h) => h.date).sort();
  const domain = [allDates[0], allDates[allDates.length - 1]];
  const alexCards = alexTests.map((test) => {
    const meta = HOME_TESTS[test];
    const series = cf.homeTests.filter((h) => h.test === test).sort((a, b) => a.date.localeCompare(b.date));
    const m = mdcFor(test);
    const seen = series.filter((p) => p.date <= asOf);
    const d = detectDecline(seen, { mdc: m.v, higherIsBetter: meta.higherIsBetter });
    const base = series.length >= 2 ? (series[0].value + series[1].value) / 2 : null;
    const status = !seen.length
      ? `No results yet on ${fmtDate(asOf)}.`
      : d ? `<strong>Decline counted on ${fmtDate(d.date)}:</strong> two results in a row more than ${fmtVal(m.v)} ${meta.higherIsBetter ? 'below' : 'above'} baseline.`
        : `No decline beyond normal variation by ${fmtDate(asOf)} (${plural(seen.length, 'result')} so far).`;
    return `<div class="home-card">
      <h3>${esc(meta.label)} <span class="sim-tag">SIMULATED</span></h3>
      <p class="muted hc-sub">${esc(meta.unit)} · ${meta.higherIsBetter ? 'higher is better' : 'lower is better'} · weekly, same time of day</p>
      ${homeSvg(series, { mode: 'date', domain, asOf, mdc: m.v, higherIsBetter: meta.higherIsBetter, decline: d })}
      <p class="hc-status">${status}</p>
      <p class="muted hc-meta">Baseline ${fmtVal(base)} (mean of the first two). Normal variation ±${fmtVal(m.v)} ${mdcTag(m)}</p>
    </div>`;
  }).join('');
  // real results saved on this device by the home-test page (not Alex's, not part of his score)
  const groups = {};
  for (const r of S.homeResults || []) {
    const k = `${r.test}|${r.person || ''}`;
    (groups[k] = groups[k] || []).push(r);
  }
  const realCards = Object.entries(groups).map(([k, arr]) => {
    const [test, person] = k.split('|');
    const meta = HOME_TESTS[test];
    const series = [...arr].sort((a, b) => a.date.localeCompare(b.date) || (a.trial ?? 0) - (b.trial ?? 0));
    const m = mdcFor(test);
    return `<div class="home-card">
      <h3>${esc(meta.label)} <span class="real-tag">REAL</span></h3>
      <p class="muted hc-sub">${person ? `${esc(person)} · ` : ''}${plural(series.length, 'result')} saved on this device · ${esc(meta.unit)}</p>
      ${homeSvg(series, { mode: 'index', mdc: m.v, higherIsBetter: meta.higherIsBetter })}
      <p class="muted hc-meta">Not Alex's data and not part of his score. Normal variation ±${fmtVal(m.v)} ${mdcTag(m)}</p>
    </div>`;
  }).join('');
  return `<div class="sec-head"><h2 id="home-h">Home tests, alongside the referral</h2>
      <p class="muted">Each person is compared with their own baseline. A drop counts only when it is bigger than the test's normal variation (minimal detectable change) twice in a row. Home tests run alongside a referral, never instead of one.${S.includeHome ? '' : ' <strong>Home tests are switched off for the score right now.</strong>'}</p></div>
    ${alexCards ? `<p class="home-note"><span class="sim-tag">SIMULATED</span> Alex never had home tests. These values illustrate the design.</p><div class="home-grid">${alexCards}</div>` : '<p class="muted">No home-test series in the case file.</p>'}
    <h3 class="real-h">Real results on this device</h3>
    ${realCards ? `<div class="home-grid">${realCards}</div>` : '<p class="muted">No real results saved on this device yet. Run one on the <a href="hometests.html">Home tests</a> page and it appears here as a separate series, tagged REAL.</p>'}`;
}

// ---------- 7. measurements ----------
export function renderMeasures(ctx) {
  const ms = ctx.cf.measurements || [];
  if (!ms.length) return '';
  const dates = [...new Set(ms.map((m) => m.date).filter(Boolean))];
  return `<div class="sec-head"><h2 id="measures-h">Where Alex is now</h2>
      <p class="muted">Clinic measurements${dates.length === 1 ? ` from ${fmtDate(dates[0])}` : ''}, after the diagnosis. Hand, speech and walking are what his own goals depend on: staying in the classroom, being reachable at home, cooking Sunday dinner.</p></div>
    <div class="table-wrap"><table class="measures-table">
      <thead><tr><th>Measure</th><th>Alex</th><th>Typical</th>${dates.length > 1 ? '<th>Date</th>' : ''}</tr></thead>
      <tbody>${ms.map((m) => `<tr><td>${esc(m.label)}</td><td><strong>${esc(m.value)}</strong></td><td class="muted">${esc(m.typical || '–')}</td>${dates.length > 1 ? `<td class="nowrap">${fmtDate(m.date)}</td>` : ''}</tr>`).join('')}</tbody>
    </table></div>`;
}

export function renderFoot(ctx) {
  const used = ['mei2022', 'eisen2012', 'goldcoast2020', 'logroscino2010'].filter((k) => SOURCES[k]);
  const src = ctx.cf.sourceDoc ? ` Notes are word for word from ${esc(ctx.cf.sourceDoc.file)}, pages ${esc(ctx.cf.sourceDoc.pages)}.` : '';
  return `<p>The tool's output is a referral prompt (needs EMG and neuromuscular workup), never a diagnosis. Alex's home-test values are SIMULATED.${src}</p>
    <p>Sources: ${used.map((k) => `${esc(SOURCES[k].cite)}${SOURCES[k].url ? ` <a href="${esc(SOURCES[k].url)}" target="_blank" rel="noopener">link</a>` : ''}`).join(' ')}</p>`;
}

// ---------- page wiring ----------
async function boot() {
  const $ = (id) => document.getElementById(id);
  let cf;
  try {
    ({ ALEX: cf } = await import('./alex.js'));
  } catch (err) {
    $('controls').innerHTML = `<p><strong>The case file (js/alex.js) could not be loaded.</strong> <span class="muted">${esc(err && err.message)}</span></p>`;
    return;
  }
  const ls = (() => { try { return window.localStorage; } catch { return null; } })();
  const store = readStore(ls);
  const hp = new URLSearchParams(location.hash.slice(1));
  const S = { ...store, exclude: new Set(), asOf: /^\d{4}-\d{2}-\d{2}$/.test(hp.get('asof') || '') ? hp.get('asof') : DEFAULT_DATE };
  const hLine = parseFloat(hp.get('line'));
  if (Number.isFinite(hLine) && hLine > 0 && hLine < 1) S.line = hLine;
  if (hp.get('home') === '0' || hp.get('home') === '1') S.includeHome = hp.get('home') === '1';
  const save = (k, v) => { try { ls && ls.setItem(k, v); } catch { /* storage off */ } };

  // controls (built once, then kept in sync)
  const lines = [...REFERRAL_LINES];
  if (!lines.some((l) => Math.abs(l.value - S.line) < 1e-9)) lines.push({ value: S.line, label: formatPct(S.line), note: 'set on another page' });
  $('controls').innerHTML = `
    <div class="ctl-patient"><span class="ctl-k">Patient</span><strong>${esc(cf.patient?.name || '')}</strong>
      <span class="muted">${cf.patient?.ageAtFirstVisit ? `${cf.patient.ageAtFirstVisit} at first visit` : ''}${cf.patient?.sex ? `, ${esc(cf.patient.sex)}` : ''}</span></div>
    <div class="ctl-date">
      <label class="ctl-k" for="asof">As of</label>
      <div class="ctl-stepper">
        <button type="button" id="prev" aria-label="Previous date">&larr; Prev</button>
        <select id="asof"></select>
        <button type="button" id="next" aria-label="Next date">Next &rarr;</button>
        <button type="button" id="play" class="primary" aria-pressed="false">Play replay</button>
      </div>
    </div>
    <div class="ctl-line"><label class="ctl-k" for="line">Referral line</label>
      <select id="line">${lines.map((l) => `<option value="${l.value}">${esc(l.label)}: ${esc(l.note)}</option>`).join('')}</select>
      <label class="ctl-home"><input type="checkbox" id="inc"><span>Include home tests (Alex's are <span class="sim-tag">SIMULATED</span>)</span></label></div>`;
  $('line').value = String(S.line);
  $('inc').checked = S.includeHome;

  let lastOptions = '';
  let focusKey = null;
  let timer = null;

  function render() {
    const t0 = performance.now();
    const ctx = computeView(cf, S);
    S.asOf = ctx.asOf;
    const opts = dateOptions(ctx.tl);
    const sig = opts.map((o) => `${o.date}|${o.label}|${o.tier}`).join(';');
    if (sig !== lastOptions) {
      const simDates = new Set((cf.homeTests || []).filter((h) => h.simulated).map((h) => h.date));
      $('asof').innerHTML = opts.map((o) => `<option value="${o.date}">${esc(o.label)}${o.kind === 'home' && simDates.has(o.date) ? ' (simulated)' : ''} · ${TIER_NAME[o.tier]}</option>`).join('');
      lastOptions = sig;
    }
    $('asof').value = S.asOf;
    const i = ctx.dates.indexOf(S.asOf);
    $('prev').disabled = i <= 0;
    $('next').disabled = i < 0 || i >= ctx.dates.length - 1;
    $('doc-title').textContent = `Doctor dashboard: ${cf.patient?.name || ''}`;
    $('doc-lede').innerHTML = renderLede(ctx);
    $('banner').innerHTML = renderBanner(ctx);
    $('range').innerHTML = renderRange(ctx);
    $('findings').innerHTML = renderFindings(ctx);
    $('replay').innerHTML = renderReplay(ctx);
    $('home').innerHTML = renderHome(ctx);
    $('measures').innerHTML = renderMeasures(ctx);
    $('foot').innerHTML = renderFoot(ctx);
    if (focusKey) {
      const el = document.querySelector(`input[data-key="${CSS.escape(focusKey)}"]`);
      if (el) el.focus();
      focusKey = null;
    }
    try { history.replaceState(null, '', `#asof=${S.asOf}&line=${S.line}&home=${S.includeHome ? 1 : 0}`); } catch { /* file:// */ }
    document.body.dataset.renderMs = String(Math.round(performance.now() - t0));
  }

  const step = (dir) => {
    const { dates } = computeView(cf, S);
    const i = dates.indexOf(S.asOf);
    const j = Math.min(dates.length - 1, Math.max(0, i + dir));
    if (dates[j] && dates[j] !== S.asOf) { S.asOf = dates[j]; render(); }
  };
  const encDates = () => [...new Set((cf.encounters || []).map((e) => e.date))].sort();
  const stopPlay = () => {
    if (timer) clearInterval(timer);
    timer = null;
    $('play').textContent = 'Play replay';
    $('play').setAttribute('aria-pressed', 'false');
  };
  const startPlay = () => {
    const ds = encDates();
    if (!ds.length) return;
    if (!ds.some((d) => d > S.asOf)) { S.asOf = ds[0]; render(); }
    $('play').textContent = 'Pause';
    $('play').setAttribute('aria-pressed', 'true');
    timer = setInterval(() => {
      const next = encDates().find((d) => d > S.asOf);
      if (!next) { stopPlay(); return; }
      S.asOf = next; render();
    }, 1800);
  };

  $('asof').addEventListener('change', (e) => { stopPlay(); S.asOf = e.target.value; render(); });
  $('prev').addEventListener('click', () => { stopPlay(); step(-1); });
  $('next').addEventListener('click', () => { stopPlay(); step(1); });
  $('play').addEventListener('click', () => (timer ? stopPlay() : startPlay()));
  $('line').addEventListener('change', (e) => { S.line = parseFloat(e.target.value); save('rfn.referralLine', String(S.line)); render(); });
  $('inc').addEventListener('change', (e) => { S.includeHome = e.target.checked; save('rfn.includeHomeTests', String(S.includeHome)); render(); });
  $('findings').addEventListener('change', (e) => {
    const key = e.target && e.target.dataset && e.target.dataset.key;
    if (!key) return;
    if (e.target.checked) S.exclude.delete(key); else S.exclude.add(key);
    focusKey = key;
    render();
  });
  $('findings').addEventListener('click', (e) => {
    if (e.target.closest('[data-action="reset-whatif"]')) { S.exclude.clear(); render(); }
  });
  const jump = (e) => {
    const row = e.target.closest('[data-date]');
    if (!row || e.target.closest('a, input, summary')) return;
    stopPlay(); S.asOf = row.dataset.date; render();
  };
  $('replay').addEventListener('click', jump);
  $('replay').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); jump(e); } });
  document.addEventListener('keydown', (e) => {
    if (e.target.closest && e.target.closest('input, select, textarea, button, [contenteditable]')) return;
    if (e.key === 'ArrowLeft') { stopPlay(); step(-1); }
    if (e.key === 'ArrowRight') { stopPlay(); step(1); }
  });
  window.addEventListener('storage', (e) => {
    if (!e.key || !e.key.startsWith('rfn.')) return;
    const st = readStore(ls);
    Object.assign(S, { mdc: st.mdc, homeResults: st.homeResults, line: st.line, includeHome: st.includeHome });
    if (![...$('line').options].some((o) => Math.abs(parseFloat(o.value) - S.line) < 1e-9)) {
      $('line').insertAdjacentHTML('beforeend', `<option value="${S.line}">${esc(formatPct(S.line))}: set on another page</option>`);
    }
    $('line').value = String(S.line);
    $('inc').checked = S.includeHome;
    render();
  });

  render();
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') boot();
