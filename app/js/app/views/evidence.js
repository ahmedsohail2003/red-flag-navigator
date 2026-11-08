// Evidence and method (#evidence): how the number is made and why to trust it.
// Every number on this view is computed when it renders, from engine.js, weights.js,
// alex.js and lookalikes.js (or quoted from the case). Nothing here is a retyped weight.
import {
  esc, fmtDate, pct, pctAt, rangeAt, range as fmtRange, TIER, tierChip, simChip, assumeChip, sourceLink, ensureCss, plural, monthsBetween,
} from '../ui.js';
import {
  simulate, tierFromRange, stateAt, evaluateState, evaluateAt, timeline, monthsSaved,
  RULES, HOME_TESTS, FINDINGS, PRIOR, SOURCES, UNCLEAR_DEADLINE_WEEKS,
} from '../../engine.js';
import { REFERRAL_LINES } from '../../weights.js';
import { ALEX } from '../../alex.js';
import { LOOKALIKES } from '../../lookalikes.js';

const SECTIONS = [
  { id: 'ev-how', nav: 'How the number is made' },
  { id: 'ev-weights', nav: 'Every weight and its source' },
  { id: 'ev-rules', nav: 'Pattern rules' },
  { id: 'ev-line', nav: 'The referral line' },
  { id: 'ev-lookalikes', nav: 'Look-alike check' },
  { id: 'ev-practice', nav: 'Practice and path to use' },
  { id: 'ev-validate', nav: 'How we would validate it' },
  { id: 'ev-limits', nav: 'Honest limits' },
];

// ---------- formatting ----------
const nn = (i) => String(i + 1).padStart(2, '0');
const or2 = (x) => (x == null ? '–' : Number(x).toFixed(2));
const orShort = (x) => (x >= 100 ? Math.round(x).toLocaleString('en-CA') : x >= 10 ? x.toFixed(1) : x.toFixed(2));
const lower1 = (s) => { const t = String(s ?? ''); return t.charAt(0).toLowerCase() + t.slice(1); };
const shortLabel = (f) => String(f?.label || '').split(' (')[0];
const lineLabel = (v) => (REFERRAL_LINES.find((l) => Math.abs(l.value - v) < 1e-9) || {}).label || pct(v);
const sameLine = (a, b) => Math.abs(a - b) < 1e-9;
const emgsPerCase = (p) => Math.round((1 - p) / p);
const srcHtml = (key) => `${sourceLink(key) || esc(key)}${key === 'assumption' ? ` ${assumeChip()}` : ''}`;
const num1 = (x) => (Number.isInteger(x) ? String(x) : x.toFixed(1));

// ---------- the case, as data ----------
const ENCOUNTERS = [...(ALEX?.encounters || [])].sort((a, b) => a.date.localeCompare(b.date));
const FIRST = ENCOUNTERS[0] || null;
// Worked example: the weighted findings in Alex's first family-doctor note, with their quotes.
const EX_FINDINGS = (FIRST?.findings || []).filter((f, i, all) => FINDINGS[f.id]?.or != null && all.findIndex((g) => g.id === f.id) === i);
const EXAMPLE = EX_FINDINGS.map((f) => f.id);
// The pattern sign the hand surgeon recorded at the next visit.
const PATTERN_ID = FINDINGS.two_territory_wasting ? 'two_territory_wasting' : null;
const PATTERN_ENC = ENCOUNTERS.find((e) => (e.findings || []).some((f) => f.id === PATTERN_ID)) || null;
const PATTERN_RULE = { two_territory_wasting: 'two_territory', split_hand: 'split_hand', mimic_test_normal: 'unexplained_weakness', umn_signs: 'umn_lmn' };
const WEIGHTED = Object.entries(FINDINGS).filter(([, f]) => f.or != null);
const PATTERNS = Object.entries(FINDINGS).filter(([, f]) => f.or == null && !f.contextOnly);
const CONTEXT_FLAGS = Object.entries(FINDINGS).filter(([, f]) => f.contextOnly);
const GROUPS = [...new Set(WEIGHTED.map(([, f]) => f.group))];
const PHYSIO_SESSIONS = (() => {
  for (const e of ENCOUNTERS) { const m = /(\d+) sessions/.exec(e.note || ''); if (m) return Number(m[1]); }
  return null;
})();

let EX = null; // the example's range does not depend on the line, so it is simulated once
const exRange = () => (EX = EX || simulate(EXAMPLE));

// The same engine path the indicator runs, on a constructed one-visit file.
function evalIds(ids, line) {
  const file = { encounters: [{ id: 'example', date: '2025-01-01', setting: 'example', findings: ids.map((id) => ({ id, region: 'arm', quote: '' })) }] };
  return evaluateState(stateAt(file, '2025-01-01', { includeHomeTests: false }), { referralLine: line });
}

// ---------- range bar on a log scale (0.001% to 100%) ----------
const AX_MIN = -5;
const AX_MAX = 0;
const pos = (p) => Math.min(100, Math.max(0, ((Math.log10(Math.max(p, 1e-9)) - AX_MIN) / (AX_MAX - AX_MIN)) * 100));
const TICKS = [1e-5, 1e-4, 1e-3, 1e-2, 1e-1, 1];
const tickLabel = (v) => `${+(v * 100).toPrecision(1)}%`;
const at = (x) => `${x.toFixed(2)}%`;

function rangeBar(r, line, tier, { compact = false } = {}) {
  const width = (a, b) => Math.max(0.8, pos(b) - pos(a));
  const flip = pos(line) > 70 ? ' flip' : '';
  const label = `Middle 95% ${pctAt(r.lo, line)} to ${pctAt(r.hi, line)}, referral line ${lineLabel(line)}: ${TIER[tier]?.label || tier}`;
  return `<div class="ev-bar${compact ? ' compact' : ''}" role="img" aria-label="${esc(label)}">
    ${TICKS.map((v) => `<span class="ev-gl" style="left:${at(pos(v))}"></span>`).join('')}
    <span class="ev-axis"></span>
    ${compact ? '' : `<span class="ev-band prior" style="left:${at(pos(PRIOR.lo))};width:${at(width(PRIOR.lo, PRIOR.hi))}" title="Starting rate: ${pct(PRIOR.lo)} to ${pct(PRIOR.hi)}"></span>`}
    <span class="ev-band ${esc(tier)}" style="left:${at(pos(r.lo))};width:${at(width(r.lo, r.hi))}" title="Middle 95%: ${pctAt(r.lo, line)} to ${pctAt(r.hi, line)}"></span>
    ${r.median != null ? `<span class="ev-mid" style="left:${at(pos(r.median))}" title="Middle of the runs: ${pct(r.median)}"></span>` : ''}
    <span class="ev-ref${flip}" style="left:${at(pos(line))}" title="Referral line ${lineLabel(line)}">${compact ? '' : `<span>Referral line ${lineLabel(line)}</span>`}</span>
    ${compact ? '' : TICKS.map((v, i) => `<span class="ev-tick${i === 0 ? ' first' : i === TICKS.length - 1 ? ' last' : ''}${i % 2 ? ' minor' : ''}" style="left:${at(pos(v))}">${tickLabel(v)}</span>`).join('')}
  </div>`;
}

const legendHtml = (tier) => `<div class="ev-legend" aria-hidden="true">
  <span><i class="k prior"></i>Starting rate</span>
  <span><i class="k ${esc(tier)}"></i>Middle 95% for these findings</span>
  <span><i class="k mid"></i>Middle of the runs</span>
  <span><i class="k ref"></i>Referral line</span>
</div>`;

// Forest mark for one odds ratio: log scale 0.5 to 100, hairline at 1 (no change).
const F_MIN = Math.log10(0.5);
const F_MAX = Math.log10(100);
const fpos = (x) => Math.min(100, Math.max(0, ((Math.log10(x) - F_MIN) / (F_MAX - F_MIN)) * 100));
const forest = (f) => `<div class="ev-forest" aria-hidden="true" title="${esc(`${or2(f.or)} (95% CI ${or2(f.lo)} to ${or2(f.hi)})`)}">
  <span class="one" style="left:${at(fpos(1))}"></span>
  <span class="ci" style="left:${at(fpos(f.lo))};width:${at(Math.max(1, fpos(f.hi) - fpos(f.lo)))}"></span>
  <span class="pt" style="left:${at(fpos(f.or))}"></span>
</div>`;

const head = (i, kicker, title, soft, sub = '') => `
  <div class="ev-head">
    <div class="micro dot">${nn(i)} · ${esc(kicker)}</div>
    <h2 class="ev-h2 two-tone" id="${SECTIONS[i].id}-h" tabindex="-1">${esc(title)} <span class="soft">${esc(soft)}</span></h2>
    ${sub ? `<p class="ev-sub">${sub}</p>` : ''}
  </div>`;

// ---------- 1. how the number is made ----------
function howHtml(s, opts) {
  const r = exRange();
  const line = s.line;
  const t = tierFromRange(r, line);
  const where = r.lo > line ? 'the whole range is above it' : r.hi < line ? 'the whole range is below it' : 'the range crosses it';
  const p0 = Math.sqrt(PRIOR.lo * PRIOR.hi);
  const odds0 = p0 / (1 - p0);
  const steps = [
    ['Start from the population rate', `${+(PRIOR.lo * 1e4).toPrecision(2)} to ${+(PRIOR.hi * 1e4).toPrecision(2)}<span class="stat-unit">in 10,000</span>`,
      `${pct(PRIOR.lo)} to ${pct(PRIOR.hi)} of adults are diagnosed with MND within ${PRIOR.horizonYears} years (${(PRIOR.sources || []).map(sourceLink).join('; ')}).`, assumeChip()],
    ['Multiply by each finding', `×${orShort(r.orProduct)}`,
      `Adjusted odds ratios from ${sourceLink('mei2022')}: ${EXAMPLE.map((id) => `${esc(lower1(shortLabel(FINDINGS[id])))} ×${or2(FINDINGS[id].or)}`).join(', ')}.`, ''],
    ['Simulate the uncertainty', `${r.nSims.toLocaleString('en-CA')}<span class="stat-unit">runs</span>`,
      'Each run draws the starting rate across its range and every odds ratio across its 95% confidence interval. A fixed seed gives the same range every time.', ''],
    ['Report the middle 95%', `${pctAt(r.lo, line)} to ${pctAt(r.hi, line)}`,
      `Against the ${lineLabel(line)} referral line, ${where}. Never a lone percentage.`, tierChip(t)],
  ];
  const tierDef = {
    high: ['The whole range is above the line, or a pattern rule fired', 'Home tests keep running alongside the referral.'],
    unclear: ['The range crosses the line', `Decide by week ${UNCLEAR_DEADLINE_WEEKS}: escalate on a confirmed home-test decline or a new region, otherwise step down.`],
    low: ['The whole range is below the line', 'Safety-net advice: come back if weakness spreads or speech changes.'],
  };
  const margin = t === 'high' && !(r.lo > line * 1.5)
    ? `<p class="note ev-mt">Only just: the lower end (${pctAt(r.lo, line)}) is close to the ${lineLabel(line)} line, and it leans on reading “a little flatter” as wasting. That is why the headline rests on the pattern rules at the next visit instead.</p>` : '';
  return `
    <div class="panel grid-bg ev-inst">
      <div class="ev-inst-top">
        <span class="micro dot">Worked example · computed live</span>
        <span class="chip real" title="Each finding is quoted word for word from the note">Case notes</span>
        <span class="spacer"></span>
        <span class="micro">Alex Chen · ${fmtDate(FIRST?.date)} · ${esc(FIRST?.setting || '')}</span>
      </div>
      <ol class="ev-steps">${steps.map(([k, v, p, chip], i) => `
        <li class="panel-inset ev-step">
          <span class="micro">${nn(i)} · ${esc(k)}</span>
          <div class="stat-s">${v}</div>
          <p>${p}</p>
          ${chip ? `<div class="ev-step-chip">${chip}</div>` : ''}
        </li>`).join('')}
      </ol>
      ${rangeBar(r, line, t)}
      ${legendHtml(t)}
    </div>
    <div class="grid cols-12 ev-mt-l">
      <div class="card span-7">
        <div class="card-head"><h3>The arithmetic, line by line</h3><span class="aside micro">Odds, then back to a chance</span></div>
        <div class="card-body ev-calc">
          <div class="kv"><span>Middle of the starting rate</span><span class="v">${pct(p0)} · odds ${odds0.toPrecision(3)}</span></div>
          ${EX_FINDINGS.map((f) => `<div class="kv ev-kvq"><span><span class="ev-kvl">× ${esc(FINDINGS[f.id].label)}</span><span class="ev-q">“${esc(f.quote)}”</span></span><span class="v">×${or2(FINDINGS[f.id].or)}</span></div>`).join('')}
          <div class="kv"><span>Combined odds ratio</span><span class="v">×${or2(r.orProduct)}</span></div>
          <div class="kv"><span>Point estimate: odds ${odds0.toPrecision(3)} × ${or2(r.orProduct)} = ${(odds0 * r.orProduct).toPrecision(3)}, as a chance</span><span class="v">${pct(r.point)}</span></div>
          <div class="kv ev-kv-total"><span>${r.nSims.toLocaleString('en-CA')} runs, middle 95%</span><span class="v">${pctAt(r.lo, line)} to ${pctAt(r.hi, line)}</span></div>
          <p class="note ev-mt">The point estimate is a step in the arithmetic, not an output: the indicator reports only the range, and the tier depends on where the whole range sits against the line.</p>
          ${margin}
        </div>
      </div>
      <div class="card span-5">
        <div class="card-head"><h3>From range to tier</h3><span class="aside micro">Line ${lineLabel(line)}</span></div>
        <div class="ev-tiers">${['high', 'unclear', 'low'].map((k) => `
          <div class="ev-tier-row">${tierChip(k)}<div><div class="ev-tier-def">${esc(tierDef[k][0])}</div><div class="note">${esc(TIER[k].action)}. ${esc(tierDef[k][1])}</div></div></div>`).join('')}
        </div>
        <p class="note ev-tier-foot">The output is always “needs EMG and neuromuscular assessment”, never “has ALS”. The same workup is how the look-alikes are told apart.</p>
      </div>
    </div>
    ${alexNowHtml(s, opts)}`;
}

function alexNowHtml(s, opts) {
  const ev = evaluateAt(ALEX, s.asOf, opts);
  const enc = ENCOUNTERS.filter((e) => e.date <= s.asOf).pop();
  const sim = ev.state.instances.some((i) => i.simulated);
  return `
    <div class="inset ev-now">
      <div class="ev-now-who">
        <span class="micro">Alex · ${s.other ? 'pattern-rule visit' : 'selected visit'}</span>
        <div class="ev-now-date">${fmtDate(s.asOf)}${enc ? ` · ${esc(enc.setting)}` : ''}</div>
        ${s.other ? `<div class="note">${esc(s.other)} is open; this box always shows Alex.</div>` : ''}
      </div>
      <div class="ev-now-range"><span class="micro">Middle 95%</span><div class="mono">${rangeAt(ev.range, ev.line)}</div></div>
      <div class="ev-now-tier">${tierChip(ev.tier)}${sim ? ` ${simChip()}` : ''}<div class="note">${esc(ev.reason)}</div></div>
      <button type="button" class="btn sm" data-go="indicator">${s.other ? 'Open Alex\'s case' : 'Open the indicator'}</button>
    </div>`;
}

// ---------- 2. weights ----------
function weightsRows(q) {
  const needle = String(q || '').trim().toLowerCase();
  const hit = ([id, f]) => !needle || [id, f.label, f.plain, f.group, SOURCES[f.source]?.short].some((x) => String(x || '').toLowerCase().includes(needle));
  let shown = 0;
  const body = GROUPS.map((g) => {
    const rows = WEIGHTED.filter(([, f]) => f.group === g).filter(hit);
    shown += rows.length;
    if (!rows.length) return '';
    return `<tr class="ev-group"><th colspan="5" scope="colgroup">${esc(g)}<span>${rows.length}</span></th></tr>${rows.map(([, f]) => `
      <tr>
        <td><span class="ev-f">${esc(f.label)}</span></td>
        <td class="num">${or2(f.or)}</td>
        <td class="num ev-nowrap">${or2(f.lo)} to ${or2(f.hi)}</td>
        <td class="ev-forest-cell">${forest(f)}</td>
        <td class="ev-src">${srcHtml(f.source)}</td>
      </tr>`).join('')}`;
  }).join('');
  return { body: body || '<tr><td colspan="5" class="ev-empty">No finding matches that filter.</td></tr>', shown };
}

function weightsHtml() {
  const mei = WEIGHTED.filter(([, f]) => f.source === 'mei2022').length;
  const hd = FINDINGS.home_decline;
  const { body, shown } = weightsRows('');
  return `
    <div class="ev-toolbar">
      <label class="ev-search-wrap"><span class="micro">Filter</span>
        <input type="search" class="ev-search" data-ev-filter placeholder="e.g. wasting, bulbar, assumption" aria-label="Filter the weights" autocomplete="off"></label>
      <span class="spacer"></span>
      <span class="note" data-ev-count aria-live="polite">${shown} of ${WEIGHTED.length} weighted findings</span>
    </div>
    <div class="table-wrap">
      <table class="tbl ev-weights">
        <thead><tr><th>Finding</th><th class="num">Adjusted OR</th><th class="num">95% CI</th><th>Log scale, line at 1</th><th>Source</th></tr></thead>
        <tbody data-ev-wbody>${body}</tbody>
      </table>
    </div>
    <p class="note ev-mt">${mei} of ${WEIGHTED.length} weights are adjusted odds ratios from ${sourceLink('mei2022')}: 6,437 MND cases against 62,003 matched controls in UK GP records, signs recorded 3 months to 5 years before diagnosis. Each is already adjusted for the others, so multiplying them is how that model predicts. ${hd ? `The home-decline weight (×${or2(hd.or)}, ${or2(hd.lo)} to ${or2(hd.hi)}) is a team assumption, set wide on purpose. ` : ''}The “Not supporting factor” signs were comparison signs in the study and are kept as published.</p>

    <div class="ev-subhead"><h3>Pattern signs</h3><span class="note">No weight: they never move the number. Each one triggers a rule that goes straight to High.</span></div>
    <div class="table-wrap">
      <table class="tbl ev-ptbl">
        <thead><tr><th>Pattern sign</th><th>In plain words</th><th>Rule it triggers</th><th>Source</th></tr></thead>
        <tbody>${PATTERNS.map(([id, f]) => {
          const rule = RULES.find((r) => r.id === PATTERN_RULE[id]);
          return `<tr><td>${esc(f.label)}</td><td class="muted">${esc(f.plain)}</td><td>${rule ? esc(rule.label) : '–'}</td><td class="ev-src">${srcHtml(f.source)}</td></tr>`;
        }).join('')}</tbody>
      </table>
    </div>
    ${CONTEXT_FLAGS.length ? `<div class="ev-subhead"><h3>Context flags</h3><span class="note">Shown to the doctor with their source. They add no weight and set off no rule, because the evidence is weaker.</span></div>
    <div class="table-wrap">
      <table class="tbl ev-ptbl">
        <thead><tr><th>Context flag</th><th>Why it is shown</th><th>Source</th></tr></thead>
        <tbody>${CONTEXT_FLAGS.map(([, f]) => `<tr><td>${esc(f.label)}</td><td class="muted">${esc(f.why || f.plain)}</td><td class="ev-src">${srcHtml(f.source)}</td></tr>`).join('')}</tbody>
      </table>
    </div>` : ''}`;
}

// ---------- 3. pattern rules ----------
function rulesHtml(s, opts) {
  const ev = evaluateAt(ALEX, s.asOf, opts);
  const fired = new Set(ev.rulesFired.map((r) => r.id));
  const simRule = (id) => id === 'unclear_with_decline' && ev.state.homeDeclines.some((d) => d.simulated);
  const line = s.line;
  let demo = '';
  if (PATTERN_ID) {
    const base = evalIds(EXAMPLE, line);
    const plus = evalIds([...EXAMPLE, PATTERN_ID], line);
    const firedTxt = (e) => (e.rulesFired.length ? e.rulesFired.map((x) => esc(x.label)).join('; ') : '<span class="faint">None</span>');
    const same = base.range.lo === plus.range.lo && base.range.hi === plus.range.hi;
    demo = `
      <div class="ev-subhead"><h3>A pattern sign never moves the number</h3><span class="note">The ${fmtDate(FIRST?.date)} findings, then the sign the hand surgeon saw on ${fmtDate(PATTERN_ENC?.date)}. Line ${lineLabel(line)}.</span></div>
      <div class="table-wrap">
        <table class="tbl ev-demo">
          <thead><tr><th>Findings</th><th>Middle 95%</th><th>By the number</th><th>Pattern rules fired</th><th>Tier</th></tr></thead>
          <tbody>
            <tr><td>${EXAMPLE.map((id) => esc(shortLabel(FINDINGS[id]))).join(' + ')}</td><td class="mono ev-nowrap">${rangeAt(base.range, base.line)}</td><td>${tierChip(base.byNumber)}</td><td>${firedTxt(base)}</td><td>${tierChip(base.tier)}</td></tr>
            <tr><td>+ ${esc(lower1(shortLabel(FINDINGS[PATTERN_ID]).split(':')[0]))}</td><td class="mono ev-nowrap">${rangeAt(plus.range, plus.line)}${same ? ' <span class="faint">unchanged</span>' : ''}</td><td>${tierChip(plus.byNumber)}</td><td>${firedTxt(plus)}</td><td>${tierChip(plus.tier)}</td></tr>
          </tbody>
        </table>
      </div>`;
  }
  return `
    <div class="grid cols-2 ev-rules">${RULES.map((r, i) => `
      <article class="card card-pad ev-rule${fired.has(r.id) ? ' is-fired' : ''}">
        <div class="ev-rule-top"><span class="micro">Rule ${i + 1}</span><span class="spacer"></span>${fired.has(r.id) ? `<span class="chip" title="Fires for Alex at ${fmtDate(s.asOf)} with the current settings">Fires at ${fmtDate(s.asOf)}</span>${simRule(r.id) ? ` ${simChip()}` : ''}` : ''}</div>
        <h3>${esc(r.label)}</h3>
        <p>${esc(r.why)}</p>
        <div class="ev-rule-src note">Source: ${srcHtml(r.source)}</div>
      </article>`).join('')}
    </div>
    <p class="note ev-mt">“Fires at” shows the rules that fire for Alex at ${s.other ? `his ${fmtDate(s.asOf)} visit (${esc(s.other)} is open in the top bar)` : 'the visit picked in the top bar'}${s.includeHome ? ', including simulated home data' : ''}.${s.includeHome ? ` ${simChip()}` : ''}</p>
    ${demo}`;
}

// ---------- 4. referral line ----------
function lineReadoutHtml(s) {
  const p = s.line;
  const n = emgsPerCase(p);
  return `
    <div class="ev-line-read">
      <span class="stat-l">${n}</span>
      <div class="ev-line-txt">
        <div class="ev-line-cap">normal EMGs accepted for every case found at the ${lineLabel(p)} line</div>
        <div class="panel-inset ev-formula mono">(1 − ${+p.toFixed(2)}) ÷ ${+p.toFixed(2)} = ${((1 - p) / p).toFixed(1)}</div>
      </div>
    </div>
    <p class="note">A patient right at a line of p has chance p, so about (1 − p) ÷ p normal EMGs come with each case found. Patients above the line need fewer.</p>`;
}

function lineTableHtml(s, opts) {
  const r = exRange();
  const rows = REFERRAL_LINES.map((l) => {
    const o = { ...opts, referralLine: l.value };
    const ms = monthsSaved(ALEX, o);
    const first = ms.firstHigh ? timeline(ALEX, o).find((e) => e.asOf === ms.firstHigh) : null;
    return { l, ms, first };
  });
  const gains = rows.map((x) => x.ms.monthsVsReferral);
  const allGain = gains.every((g) => g != null && g > 0);
  const minGain = allGain ? Math.min(...gains) : null;
  const why = (e, lv) => {
    if (!e) return '<span class="faint">No High</span>';
    if (e.rulesFired.length) return `Pattern rule: ${e.rulesFired.map((x) => esc(lower1(x.label))).join('; ')}`;
    return `By the number${e.range.lo < lv * 1.5 ? ', only just' : ''}: lower end ${pctAt(e.range.lo, lv)} vs ${lineLabel(lv)}`;
  };
  const simFirst = (e) => !!e?.state?.instances?.some((i) => i.simulated);
  const sim = rows.some((x) => simFirst(x.first));
  return `
    <div class="table-wrap">
      <table class="tbl ev-linetbl">
        <thead><tr><th>Line</th><th class="num">Normal EMGs per case</th><th>Worked example</th><th>Alex's first High</th><th class="num">Before real referral</th></tr></thead>
        <tbody>${rows.map(({ l, ms, first }) => `
          <tr class="${sameLine(l.value, s.line) ? 'is-current' : ''}">
            <td class="mono"><b>${esc(l.label)}</b>${sameLine(l.value, s.line) ? '<div class="note">current</div>' : ''}</td>
            <td class="num">${emgsPerCase(l.value)}</td>
            <td>${tierChip(tierFromRange(r, l.value))}</td>
            <td><div>${ms.firstHigh ? fmtDate(ms.firstHigh) : '–'}${first?.encounter ? ` · ${esc(first.encounter.setting)}` : first ? ' · home test' : ''}${simFirst(first) ? ` ${simChip()}` : ''}</div><div class="note">${why(first, l.value)}</div></td>
            <td class="num">${ms.monthsVsReferral != null ? `${num1(ms.monthsVsReferral)} mo` : '–'}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <p class="note ev-mt">${minGain != null
      ? `At every line from ${REFERRAL_LINES[0].label} to ${REFERRAL_LINES[REFERRAL_LINES.length - 1].label}, Alex's first High comes at least ${Math.floor(minGain)} months before his real referral (${fmtDate(ALEX.actual?.referral)}), counted referral to referral because the waiting list after a referral applies either way. The headline uses the smallest gain, never the borderline first visit.`
      : 'With the current settings, the tool does not reach High before the real referral at every line.'}${sim ? ` Includes simulated home data. ${simChip()}` : ''}${s.exclude?.length ? ` ${plural(s.exclude.length, 'finding')} unticked on the indicator.` : ''}</p>`;
}

function lineHtml(s, opts) {
  return `
    <div class="panel grid-bg ev-linepanel">
      <div class="ev-line-l">
        <span class="micro dot" id="ev-line-lbl">Choose the line</span>
        <div class="seg" role="group" aria-labelledby="ev-line-lbl">${REFERRAL_LINES.map((l) => `<button type="button" class="mono" data-ev-line="${l.value}" aria-pressed="${sameLine(l.value, s.line)}" title="${esc(l.note)}">${esc(l.label)}</button>`).join('')}</div>
        <span class="note">Same control as the top bar; every view follows it.</span>
      </div>
      <div class="ev-line-r" data-slot="line-readout">${lineReadoutHtml(s)}</div>
    </div>
    <div class="ev-mt-l" data-slot="line-table">${lineTableHtml(s, opts)}</div>`;
}

// ---------- 5. look-alikes ----------
function lookalikesHtml(s) {
  const line = s.line;
  const rows = LOOKALIKES.map((v) => {
    const enc = v.caseFile.encounters[0];
    const ev = evaluateAt(v.caseFile, enc.date, { referralLine: line });
    const signs = [...new Set(enc.findings.map((f) => shortLabel(FINDINGS[f.id])))];
    const benign = v.expect === 'not-high';
    return { v, ev, signs, benign, ok: benign ? ev.tier !== 'high' : null };
  });
  const benign = rows.filter((x) => x.benign);
  const passed = benign.filter((x) => x.ok).length;
  const speech = rows.find((x) => x.v.id === 'bulbar_early');
  return `
    <div class="ev-la-top">
      <div class="ev-la-stat"><span class="stat">${passed}<span class="stat-unit">of ${benign.length}</span></span></div>
      <div class="ev-la-cap"><b>common benign look-alikes stay below High at the ${lineLabel(line)} line.</b>
        <div class="note">The expectation (“should not trigger an EMG on its own”) was written down before the scorer ran, and an automated test keeps it that way. Two hard cases are shown for honesty.</div></div>
      <span class="chip" title="Written by the team from typical presentations; not real patients">Constructed cases</span>
    </div>
    <div class="table-wrap">
      <table class="tbl ev-la">
        <thead><tr><th>Case</th><th>Signs the scorer counts</th><th>Middle 95% vs the line</th><th>Tier</th><th>Expected before running</th></tr></thead>
        <tbody>${rows.map(({ v, ev, signs, benign: b, ok }) => `
          <tr>
            <td><div class="ev-f">${esc(v.title)}</div><div class="note">${esc(v.story)}</div></td>
            <td class="ev-signs">${signs.map(esc).join(', ')}</td>
            <td class="ev-la-range"><div class="mono ev-nowrap">${rangeAt(ev.range, ev.line)}</div>${rangeBar(ev.range, line, ev.tier, { compact: true })}</td>
            <td>${tierChip(ev.tier)}</td>
            <td>${b
              ? `<div>No EMG on its own</div><div class="note">${ok ? 'As expected' : '<b class="ev-bad">Escalated: needs review</b>'}</div>`
              : `<div>No expectation set</div><div class="note">${esc(v.note || '')}</div>`}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <p class="note ev-mt">Numbness, tingling and neck pain carry no weight because the published model found sensory symptoms were not associated with MND.${speech ? ` <b>Weak spot:</b> a case that starts with speech alone (${rangeAt(speech.ev.range, speech.ev.line)}) is ${TIER[speech.ev.tier]?.label || speech.ev.tier} at the ${lineLabel(line)} line, ${speech.ev.tier === 'low'
    ? 'so it gets no weekly test at this line, only safety-net advice: the tool would miss it until another red flag is written down.'
    : 'so it rests on the weekly reading-rate test showing the change, which is slow to come in speech.'}` : ''} Validation on real records would measure this properly.</p>`;
}

// ---------- 6. practice and path ----------
function practiceHtml(s) {
  const gap = FIRST && ALEX.actual?.referral ? Math.floor(monthsBetween(FIRST.date, ALEX.actual.referral)) : null;
  const rows = [
    [`Someone has to suspect MND first and open a checklist. Alex's clinicians wrote down signs in more than one body region, but no one acted on them together${gap ? ` for ${gap} months after his first visit` : ''}.`,
      'Built to read every note and letter that reaches the family doctor, so clues add up across clinicians. In this demo the findings were extracted by hand.'],
    ['The UK Red Flag tool was built from specialist opinion and had not been checked against clinical data (Mei et al. 2022).',
      'Every red flag is quoted word for word, with its date, and carries a published weight.'],
    ['Whether to refer is left to clinician judgement.',
      'An explicit referral line the clinic chooses, with its cost in normal EMGs shown.'],
    ['Change waits for the next visit. Alex\'s surgeon suggested neurology only “if symptoms progress”.',
      'Weekly home tests by body region for unclear cases, alongside the referral and never instead of it.'],
  ];
  const n = emgsPerCase(s.line);
  const path = [
    ['Where it runs', 'Inside the family doctor\'s EMR inbox, so notes stay with the clinic. A phone web app for the home tests.'],
    ['Who acts', 'The family doctor confirms the referral. The tool recommends; it never refers on its own.'],
    ['Cost', `Extra EMGs: about ${n} normal EMGs per case found at the ${lineLabel(s.line)} line, set by the line you choose. Weigh that against ${gap ? `${gap} months of visits` : 'months of visits'}, an operation that did not help${PHYSIO_SESSIONS ? ` and ${PHYSIO_SESSIONS} physiotherapy sessions` : ''}.`],
    ['Access', 'Any phone or browser, and a clinic kiosk for people without a phone. No new hardware.'],
    ['Regulation', 'Likely software as a medical device in Canada; the class is to be confirmed with Health Canada. Validation needs a privacy impact assessment and a PHIPA data agreement.'],
  ];
  return `
    <div class="grid cols-12">
      <div class="span-7">
        <div class="table-wrap">
          <table class="tbl ev-practice">
            <thead><tr><th>Current practice</th><th>What this adds</th></tr></thead>
            <tbody>${rows.map(([a, b]) => `<tr><td class="muted">${esc(a)}</td><td>${esc(b)}</td></tr>`).join('')}</tbody>
          </table>
        </div>
        <p class="note ev-mt">Today: clinician judgement plus paper checklists, such as ALS Canada's ReferALS early-referral tool and the UK MND Association / RCGP Red Flag tool (2014).</p>
      </div>
      <div class="card span-5">
        <div class="card-head"><h3>Path to use</h3><span class="aside micro">Line ${lineLabel(s.line)}</span></div>
        <div class="card-body ev-path">${path.map(([k, v]) => `<div class="ev-path-row"><span class="micro">${esc(k)}</span><p>${esc(v)}</p></div>`).join('')}</div>
      </div>
    </div>`;
}

// ---------- 7. validation ----------
function validateHtml() {
  const lines = REFERRAL_LINES.map((l) => l.label);
  const steps = [
    ['Replay past records', 'Linked primary-care records with dated notes, referrals and diagnoses (for example Ontario EMR data held by ICES). People later diagnosed with ALS, people with a look-alike (carpal tunnel, cervical myelopathy, radiculopathy, multifocal motor neuropathy, myasthenia gravis, inclusion body myositis) and matched controls. Notes go in one visit at a time, in date order.'],
    ['Months gained', `Primary outcome: the tool's first High against the real referral date, not the first specialist visit. The line is fixed before analysis and every result is reported at ${lines.join(', ')}.`],
    ['EMGs per true case', 'EMG referrals per true ALS case, and per neuromuscular diagnosis of any kind (an EMG that finds multifocal motor neuropathy is not wasted). Sensitivity at 6 and 12 months before diagnosis.'],
    ['Discrimination and calibration', 'AUC for ALS against look-alikes and against general controls; calibration slope and plot after reweighting to population incidence; decision curves across lines. Pre-registered and reported to TRIPOD+AI, with extraction checked against two clinicians.'],
    ['Silent pilot, then rollout', 'In one family health team the tool runs on new notes but nobody sees its output; afterwards we compare its advice with what happened, alerts per 1,000 patients a year and extraction errors. Then a stepped rollout across clinics.'],
  ];
  return `<ol class="card ev-plan">${steps.map(([h, p], i) => `
    <li class="ev-plan-step"><span class="ev-plan-n mono">${nn(i)}</span><div class="ev-plan-body"><h3>${esc(h)}</h3><p>${esc(p)}</p></div></li>`).join('')}
  </ol>
  <p class="note ev-mt">The full plan is in docs/VALIDATION.md, including the home-test protocol for measuring normal variation (10 repeats per person, same time of day, same phone).</p>`;
}

// ---------- 8. limits ----------
function limitsHtml() {
  const hd = FINDINGS.home_decline;
  // Noise floors: published estimates until the team measures its own (tapping's is provisional, both hands).
  // The walking test's old score (walk, stride-time variability) has none, so it is named apart.
  const mdcs = Object.entries(HOME_TESTS).filter(([k]) => k !== 'walk' && k !== 'tap_left')
    .map(([k, h]) => `${lower1(h.label.split(/,| \(/)[0])} ±${h.placeholderMdc} ${h.unit}${k === 'tap_right' ? ' per hand (provisional)' : ''}`).join(', ');
  const walk = HOME_TESTS.walk;
  const age = ALEX?.patient?.ageAtFirstVisit;
  const items = [
    ['Odds ratios are used as likelihood ratios.', 'The study reports odds ratios from a case-control design. As multipliers on the starting odds they are close when a sign is uncommon in both groups, but not exact; validation checks calibration directly.', ''],
    ['The controls were general GP patients, not look-alikes.', 'Among people who already have hand weakness the separation is smaller. That is why validation includes look-alike conditions, and why the output is an EMG referral, which is also how look-alikes are told apart.', ''],
    ['UK coded records, Canadian free text.', 'The weights come from coded UK GP entries; free-text notes may record signs differently.', ''],
    ['Extraction was done by hand for this demo.', 'Alex\'s findings were extracted by hand (AI-assisted) and a test checks every quote word for word against its note. Automatic extraction is future work.', ''],
    ['The starting rate is not age-specific.', `${PRIOR.label}. ${age ? `Alex, at ${age}, is` : 'Younger patients are'} likely at or below the low end; the whole range is sampled.`, assumeChip()],
    ['Each sign counts once; odds ratios are drawn independently.', `A sign in five notes counts once, and signs older than ${PRIOR.horizonYears} years drop out. The paper does not publish how its estimates are correlated, so the range may be somewhat too wide or too narrow.`, ''],
    ['The home-decline weight is a placeholder.', `${hd ? `Weight ×${or2(hd.or)} (${or2(hd.lo)} to ${or2(hd.hi)}). ` : ''}The noise floors (the smallest drop that counts) are published estimates until the team measures its own: ${mdcs}.${walk ? ` Stride-time variability, the walking test's old score, has no published floor; its ±${plural(walk.placeholderMdc, 'percentage point')} is a placeholder.` : ''}`, assumeChip()],
    ['Alex\'s home and wearable data are simulated.', 'He never had home tests; the values show the design and are labelled wherever they appear.', simChip()],
    ['The look-alikes are constructed, not real patients.', 'They test behaviour, not accuracy. Accuracy needs the replay in section 07.', ''],
  ];
  return `<ul class="list ev-limits">${items.map(([h, p, chip]) => `
    <li><div class="ev-limit-h"><b>${esc(h)}</b>${chip ? ` ${chip}` : ''}</div><p>${esc(p)}</p></li>`).join('')}
  </ul>`;
}

// ---------- mount ----------
function guard(fn, name) {
  try { return fn(); } catch (e) {
    console.error(`evidence: ${name} failed`, e);
    return `<div class="error-card"><b>This part did not render.</b> ${esc(e.message || e)}</div>`;
  }
}

export function mount(root, ctx) {
  ensureCss('css/views/evidence.css');
  let cur = ctx;
  const nSims = guard(() => exRange().nSims.toLocaleString('en-CA'), 'range');

  root.innerHTML = `
    <div class="ev">
      <header class="view-head reveal">
        <div class="micro dot">Method · Evidence</div>
        <h1 class="display two-tone">Arithmetic you can check. <span class="soft">Every weight, rule and limit, with its source.</span></h1>
        <p class="lede">No AI produces the number. It is a general-population starting rate times published adjusted odds ratios, simulated ${esc(nSims)} times and shown as the middle 95%. Everything here is computed in your browser by the same engine the indicator runs.</p>
      </header>
      <div class="ev-layout">
        <nav class="ev-nav reveal d1" aria-label="On this page">
          <div class="micro">On this page</div>
          ${SECTIONS.map((x, i) => `<button type="button" data-target="${x.id}"${i === 0 ? ' aria-current="true"' : ''}><span class="n">${nn(i)}</span><span>${esc(x.nav)}</span></button>`).join('')}
        </nav>
        <div class="ev-main">
          <section class="ev-sec reveal d1" id="ev-how" aria-labelledby="ev-how-h">
            ${head(0, 'Method', 'How the number is made.', 'Four steps, no AI.', `Worked example: the three weighted findings in Alex's first family-doctor note (${fmtDate(FIRST?.date)}), each quoted word for word.`)}
            <div data-slot="how"></div>
          </section>
          <section class="ev-sec" id="ev-weights" aria-labelledby="ev-weights-h">
            ${head(1, 'Weights', 'Every weight and its source.', `${WEIGHTED.filter(([, f]) => f.source === 'mei2022').length} from one published model.`)}
            <div data-slot="weights">${guard(weightsHtml, 'weights')}</div>
          </section>
          <section class="ev-sec" id="ev-rules" aria-labelledby="ev-rules-h">
            ${head(2, 'Rules', 'Pattern rules.', 'Some patterns go straight to High.', 'When one of these is present the tier is High whatever the number says, because no single weight can express it.')}
            <div data-slot="rules"></div>
          </section>
          <section class="ev-sec" id="ev-line" aria-labelledby="ev-line-h">
            ${head(3, 'Referral line', 'The referral line is a values choice.', 'Not a statistic.', 'It says how many normal EMGs a clinic will accept to find one person who needs neuromuscular care. That trade belongs to the clinic and the patient, so it is chosen openly and every result is shown at each line.')}
            <div data-slot="line"></div>
          </section>
          <section class="ev-sec" id="ev-lookalikes" aria-labelledby="ev-lookalikes-h">
            ${head(4, 'Look-alikes', 'Does it flag everyone with a weak hand?', 'A look-alike check.', 'Seven constructed presentations scored by the same engine at the current referral line.')}
            <div data-slot="lookalikes"></div>
          </section>
          <section class="ev-sec" id="ev-practice" aria-labelledby="ev-practice-h">
            ${head(5, 'Context', 'Compared with current practice,', 'and the path to use.')}
            <div data-slot="practice"></div>
          </section>
          <section class="ev-sec" id="ev-validate" aria-labelledby="ev-validate-h">
            ${head(6, 'Validation', 'How we would validate it.', 'Five steps, before anyone relies on it.')}
            <div data-slot="validate">${guard(validateHtml, 'validation')}</div>
          </section>
          <section class="ev-sec" id="ev-limits" aria-labelledby="ev-limits-h">
            ${head(7, 'Limits', 'Honest limits.', 'What this cannot do yet.')}
            <div data-slot="limits">${guard(limitsHtml, 'limits')}</div>
          </section>
          <p class="note ev-foot">Computed from engine.js, weights.js, alex.js and lookalikes.js when this view rendered. Values marked Simulated are made up for the demo; values marked Assumption are the team's choices until they are measured.</p>
        </div>
      </div>
    </div>`;

  const slot = (name) => root.querySelector(`[data-slot="${name}"]`);

  function render(c) {
    // The visit and what-if in the shared state belong to the open case. When that is not
    // Alex, the Alex parts show his 9 Dec 2024 visit with nothing left out, and say so.
    const own = (c.caseEntry?.id ?? 'alex') === 'alex';
    const s = own ? c.state : { ...c.state, asOf: PATTERN_ENC?.date || '2024-12-09', exclude: [], other: c.caseEntry?.name || 'Another case' };
    const opts = own ? c.opts : { ...c.opts, exclude: new Set() };
    slot('how').innerHTML = guard(() => howHtml(s, opts), 'worked example');
    slot('rules').innerHTML = guard(() => rulesHtml(s, opts), 'rules');
    const lineSlot = slot('line');
    if (!lineSlot.firstElementChild) lineSlot.innerHTML = guard(() => lineHtml(s, opts), 'referral line');
    else {
      root.querySelectorAll('[data-ev-line]').forEach((b) => b.setAttribute('aria-pressed', String(sameLine(Number(b.dataset.evLine), s.line))));
      const ro = slot('line-readout');
      const tb = slot('line-table');
      if (ro) ro.innerHTML = guard(() => lineReadoutHtml(s), 'line readout');
      if (tb) tb.innerHTML = guard(() => lineTableHtml(s, opts), 'line table');
    }
    slot('lookalikes').innerHTML = guard(() => lookalikesHtml(s), 'look-alikes');
    slot('practice').innerHTML = guard(() => practiceHtml(s), 'practice');
  }
  render(ctx);

  // events (delegated; the shell owns [data-line], so this view uses data-ev-line)
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const onClick = (e) => {
    const nav = e.target.closest('[data-target]');
    if (nav && root.contains(nav)) {
      const sec = root.querySelector(`#${nav.dataset.target}`);
      if (sec) {
        sec.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
        const h = sec.querySelector('h2');
        if (h) h.focus({ preventScroll: true });
        setActive(nav.dataset.target);
      }
      return;
    }
    const lb = e.target.closest('[data-ev-line]');
    if (lb) { cur.setState({ line: Number(lb.dataset.evLine) }); return; }
    const go = e.target.closest('[data-go]');
    if (go) {
      // the box shows Alex, so its button opens Alex when another case is open
      if ((cur.caseEntry?.id ?? 'alex') !== 'alex') cur.openCase('alex');
      cur.navigate(go.dataset.go);
    }
  };
  const onInput = (e) => {
    if (!e.target.matches('[data-ev-filter]')) return;
    const { body, shown } = weightsRows(e.target.value);
    const tb = root.querySelector('[data-ev-wbody]');
    if (tb) tb.innerHTML = body;
    const cnt = root.querySelector('[data-ev-count]');
    if (cnt) cnt.textContent = `${shown} of ${WEIGHTED.length} weighted findings`;
  };
  root.addEventListener('click', onClick);
  root.addEventListener('input', onInput);

  // in-page nav follows the scroll
  const navBtns = [...root.querySelectorAll('.ev-nav [data-target]')];
  function setActive(id) { navBtns.forEach((b) => b.setAttribute('aria-current', String(b.dataset.target === id))); }
  let io = null;
  if (typeof IntersectionObserver === 'function') {
    const seen = new Set();
    io = new IntersectionObserver((entries) => {
      entries.forEach((x) => (x.isIntersecting ? seen.add(x.target) : seen.delete(x.target)));
      const top = [...seen].sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0];
      if (top) setActive(top.id);
    }, { rootMargin: '-90px 0px -55% 0px', threshold: 0 });
    root.querySelectorAll('.ev-sec').forEach((x) => io.observe(x));
  }

  return {
    update(c) { cur = c; render(c); },
    unmount() {
      root.removeEventListener('click', onClick);
      root.removeEventListener('input', onInput);
      if (io) io.disconnect();
    },
  };
}
