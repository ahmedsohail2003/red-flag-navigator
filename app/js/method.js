// Method & validation page. Every number is read from engine.js, weights.js and
// evidence.js when the page loads; nothing here is a hard-coded weight.
// Namespace imports keep the page alive if another module renames an export:
// each section renders on its own and reports its own error.
import * as E from './engine.js';
import * as W from './weights.js';
import * as EV from './evidence.js';

const { FINDINGS = {}, PRIOR, SOURCES = {}, RULES = [], ACTIONS = {}, HOME_TESTS = {} } = E;
const DEFAULT_LINE = E.DEFAULT_REFERRAL_LINE ?? W.DEFAULT_REFERRAL_LINE;
const DEADLINE = E.UNCLEAR_DEADLINE_WEEKS ?? W.UNCLEAR_DEADLINE_WEEKS;
const REFERRAL_LINES = W.REFERRAL_LINES || [];
const EVIDENCE = EV.EVIDENCE ?? null;
const pct = E.formatPct;

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const or2 = (x) => (x == null ? '–' : Number(x).toFixed(2));
const TIER_NAME = { high: 'High', unclear: 'Unclear', low: 'Low' };
const ASSUME = '<span class="assume-tag">ASSUMPTION</span>';
const tierBadge = (t) => `<span class="tier ${t}">${TIER_NAME[t] || esc(t)}</span>`;
const lower1 = (s) => String(s || '').charAt(0).toLowerCase() + String(s || '').slice(1);

// ---------- shared browser state (read only) ----------
function store(key) { try { return localStorage.getItem(key); } catch { return null; } }
function currentLine() {
  const v = parseFloat(store('rfn.referralLine'));
  return v > 0 && v < 1 ? v : DEFAULT_LINE;
}
function measuredMdc() {
  try { const o = JSON.parse(store('rfn.mdc') || '{}'); return o && typeof o === 'object' ? o : {}; } catch { return {}; }
}
const lineLabel = (v) => (REFERRAL_LINES.find((l) => Math.abs(l.value - v) < 1e-9) || {}).label || pct(v);

function src(key) {
  const s = SOURCES[key];
  if (!s) return esc(key || '');
  const tag = key === 'assumption' ? `${ASSUME} ` : '';
  const name = s.url
    ? `<a href="${esc(s.url)}" target="_blank" rel="noopener" title="${esc(s.cite)}">${esc(s.short)}</a>`
    : `<span title="${esc(s.cite)}">${esc(s.short)}</span>`;
  return tag + name;
}

// ---------- log-scale range bar: 0.001% .. 100% ----------
const AX_MIN = -5;
const AX_MAX = 0;
const pos = (p) => Math.min(100, Math.max(0, ((Math.log10(Math.max(p, 1e-9)) - AX_MIN) / (AX_MAX - AX_MIN)) * 100));
const tickLabel = (v) => `${+(v * 100).toPrecision(1)}%`;
function rangeBar(range, line, tier) {
  const t = tier || E.tierFromRange(range, line);
  const ticks = [1e-5, 1e-4, 1e-3, 1e-2, 1e-1, 1];
  const prior = PRIOR ? `<div class="band prior" style="left:${pos(PRIOR.lo)}%;width:${Math.max(0.6, pos(PRIOR.hi) - pos(PRIOR.lo))}%" title="Starting rate"></div>` : '';
  return `<div class="rangebar" role="img" aria-label="Range ${pct(range.lo)} to ${pct(range.hi)}; referral line ${lineLabel(line)}">
    <div class="track"></div>${prior}
    <div class="band ${t}" style="left:${pos(range.lo)}%;width:${Math.max(0.6, pos(range.hi) - pos(range.lo))}%"></div>
    ${range.median != null ? `<div class="mid" style="left:${pos(range.median)}%" title="Middle of the simulations"></div>` : ''}
    <div class="refline" style="left:${pos(line)}%"><span>referral line ${lineLabel(line)}</span></div>
    ${ticks.map((v) => `<div class="tick" style="left:${pos(v)}%">${tickLabel(v)}</div>`).join('')}
  </div>
  <div class="legend"><span class="key prior"></span> starting rate <span class="key ${t}"></span> range for these findings <span class="key mid"></span> middle of the simulations</div>`;
}

// ---------- the worked example ----------
// Alex's notes-only picture after the 9 Dec 2024 hand-surgeon visit: these three weighted
// findings (cramp is from the October note). Its range is computed below by simulate().
const EXAMPLE = ['focal_weakness', 'wasting', 'cramp'].filter((id) => FINDINGS[id] && FINDINGS[id].or != null);
// The pattern sign the hand surgeon recorded that day (two nerve territories wasted).
// Split hand (hypothenar spared) was not recorded until June 2026, so it is only a fallback.
const PATTERN = ['two_territory_wasting', 'split_hand'].find((id) => FINDINGS[id]) || null;
const exampleName = () => EXAMPLE.map((id) => lower1(FINDINGS[id].label)).join(' + ');

// Run the real engine (rules included) on a one-visit example file.
function evaluateExample(ids, line) {
  const caseFile = { encounters: [{ id: 'example', date: '2025-01-01', setting: 'example', findings: ids.map((id) => ({ id, region: 'arm', quote: '' })) }] };
  return E.evaluateState(E.stateAt(caseFile, '2025-01-01', { includeHomeTests: false }), { referralLine: line });
}

function renderSteps(r, line) {
  const t = E.tierFromRange(r, line);
  $('steps').innerHTML = `
    <li><h4>Start from the general-population rate</h4>
      <div class="big">${pct(PRIOR.lo)} to ${pct(PRIOR.hi)}</div>
      <p>${esc(PRIOR.label)}. Sources: ${(PRIOR.sources || []).map(src).join('; ')}.</p></li>
    <li><h4>Multiply by each finding's odds ratio</h4>
      <div class="big">&times; ${or2(r.orProduct)}</div>
      <p>For this example: ${EXAMPLE.map((id) => `${esc(lower1(FINDINGS[id].label))} &times; ${or2(FINDINGS[id].or)}`).join(', ')}. Weights: adjusted odds ratios from ${src('mei2022')}.</p></li>
    <li><h4>Simulate the uncertainty</h4>
      <div class="big">${r.nSims.toLocaleString('en-CA')} runs</div>
      <p>Each run draws the starting rate from across its range and each odds ratio from across its 95% confidence interval.</p></li>
    <li><h4>Report the middle 95% and compare it with the line</h4>
      <div class="big">${pct(r.lo)} to ${pct(r.hi)}</div>
      <p>Against the ${lineLabel(line)} referral line: ${tierBadge(t)}</p></li>`;
}

function renderWorked(r, line) {
  const alex = EXAMPLE.length === 3 ? ': the weighted findings in Alex\'s notes by December 2024, when the hand surgeon saw visible wasting (the cramp was noted in October)' : '';
  $('worked-intro').innerHTML = `Example: ${esc(exampleName())} in the same arm${alex}. Referral line: ${lineLabel(line)} (the line currently set on the doctor dashboard; default ${lineLabel(DEFAULT_LINE)}).`;
  const p0 = Math.sqrt(PRIOR.lo * PRIOR.hi);
  const odds0 = p0 / (1 - p0);
  const oddsPoint = odds0 * r.orProduct;
  const t = E.tierFromRange(r, line);
  const withRule = PATTERN ? evaluateExample([...EXAMPLE, PATTERN], line) : null;
  const base = evaluateExample(EXAMPLE, line);
  const ruleNames = (ev) => (ev.rulesFired.length ? ev.rulesFired.map((x) => esc(x.label)).join('; ') : '<span class="muted">none</span>');

  $('worked').innerHTML = `
    <div class="grid grid-2">
      <div class="table-wrap">
        <table class="compact">
          <thead><tr><th>Finding</th><th class="num">Adjusted odds ratio</th><th class="num">95% CI</th></tr></thead>
          <tbody>
            ${EXAMPLE.map((id) => `<tr><td>${esc(FINDINGS[id].label)}</td><td class="num">${or2(FINDINGS[id].or)}</td><td class="num">${or2(FINDINGS[id].lo)} to ${or2(FINDINGS[id].hi)}</td></tr>`).join('')}
            <tr class="total"><td>Multiplied together</td><td class="num">&times; ${or2(r.orProduct)}</td><td></td></tr>
          </tbody>
        </table>
      </div>
      <div class="calc" aria-label="The arithmetic"><span class="c">middle of the starting rate</span>  ${pct(p0)}  (odds ${odds0.toPrecision(3)})
<span class="c">times the odds ratios</span>        &times; ${or2(r.orProduct)}
<span class="c">gives odds</span>                   ${oddsPoint.toPrecision(3)}, a chance of ${pct(r.point)}
<span class="c">${r.nSims.toLocaleString('en-CA')} simulations, middle 95%</span>  <strong>${pct(r.lo)} to ${pct(r.hi)}</strong>
      </div>
    </div>
    ${rangeBar(r, line, t)}
    <p>The middle estimate (${pct(r.point)}) is never shown alone. What matters is where the whole range sits: against the ${lineLabel(line)} line it is ${tierBadge(t)}. ${t === 'unclear' ? 'The range crosses the line, so the number alone cannot decide.' : ''}</p>
    ${withRule ? `
    <h4>Now add the pattern ${PATTERN === 'two_territory_wasting' ? 'the surgeon actually saw' : 'sign'}</h4>
    <div class="table-wrap"><table class="compact">
      <thead><tr><th>Findings</th><th>Range</th><th>By the number</th><th>Pattern rules fired</th><th>Tier</th></tr></thead>
      <tbody>
        <tr><td>${esc(exampleName())}</td><td>${pct(base.range.lo)} to ${pct(base.range.hi)}</td><td>${tierBadge(base.byNumber)}</td><td>${ruleNames(base)}</td><td>${tierBadge(base.tier)}</td></tr>
        <tr><td>+ ${esc(lower1(FINDINGS[PATTERN].label))}</td><td>${pct(withRule.range.lo)} to ${pct(withRule.range.hi)} <span class="muted">${withRule.range.lo === base.range.lo && withRule.range.hi === base.range.hi ? '(unchanged)' : ''}</span></td><td>${tierBadge(withRule.byNumber)}</td><td>${ruleNames(withRule)}</td><td>${tierBadge(withRule.tier)}</td></tr>
      </tbody>
    </table></div>
    <p class="muted">The pattern sign carries no weight, so the range does not move; the rule sends the patient to an EMG referral. This is the same code the doctor dashboard runs.</p>` : ''}`;
}

function renderTry(line) {
  const weighted = Object.entries(FINDINGS).filter(([, f]) => f.or != null).sort((a, b) => b[1].or - a[1].or);
  const selected = new Set(EXAMPLE);
  const chips = $('try-chips');
  chips.innerHTML = weighted.map(([id, f]) => `<button type="button" class="chip" data-id="${esc(id)}" aria-pressed="${selected.has(id)}">${esc(f.label)} <span class="or">&times;${or2(f.or)}</span>${f.source === 'assumption' ? ` ${ASSUME}` : ''}</button>`).join('');
  const update = () => {
    const r = E.simulate([...selected]);
    const t = E.tierFromRange(r, line);
    $('try-out').innerHTML = `<p><strong>${selected.size}</strong> finding${selected.size === 1 ? '' : 's'}: range <strong>${pct(r.lo)} to ${pct(r.hi)}</strong> (middle ${pct(r.median)}), by the number ${tierBadge(t)} against the ${lineLabel(line)} line.</p>${rangeBar(r, line, t)}`;
  };
  chips.addEventListener('click', (e) => {
    const b = e.target.closest('.chip');
    if (!b) return;
    const id = b.dataset.id;
    if (selected.has(id)) selected.delete(id); else selected.add(id);
    b.setAttribute('aria-pressed', String(selected.has(id)));
    update();
  });
  update();
}

function renderTiers() {
  const def = {
    high: 'The whole range is above the referral line, or a pattern rule fired.',
    unclear: 'The range crosses the line.',
    low: 'The whole range is below the line.',
  };
  $('tiers').innerHTML = `<div class="tier-rows">${['high', 'unclear', 'low'].map((t) => `
    <div class="tier-row">${tierBadge(t)}<div><strong>${def[t]}</strong><br><span class="muted">Doctor:</span> ${esc(ACTIONS[t]?.doctor || '')}</div></div>`).join('')}</div>`;
}

function renderRules() {
  $('rules').innerHTML = RULES.map((r) => `
    <div class="rule"><h4>${esc(r.label)}</h4><p>${esc(r.why)}</p><p class="muted">Source: ${src(r.source)}</p></div>`).join('');
}

function renderDeadline() {
  $('deadline-weeks').textContent = String(DEADLINE);
  const u = ACTIONS.unclear || {};
  $('deadline-text').innerHTML = `Unclear is never left open. <strong>Doctor:</strong> ${esc(u.doctor || '')} <strong>Patient is told:</strong> ${esc(u.patient?.next || '')}`;
}

// ---------- weights table ----------
function renderWeights() {
  const weighted = Object.entries(FINDINGS).filter(([, f]) => f.or != null);
  const mei = weighted.filter(([, f]) => f.source === 'mei2022').length;
  const assumed = weighted.filter(([, f]) => f.source === 'assumption').length;
  $('weights-intro').innerHTML = `${weighted.length} weighted findings. ${mei} are adjusted odds ratios from ${src('mei2022')}: 6,437 MND cases against 62,003 matched controls in UK GP records, with signs recorded 3 months to 5 years before diagnosis. Each is already adjusted for the others in the model, so multiplying them is how that model makes a prediction. ${assumed ? `${assumed} is a team assumption ${ASSUME}, set wide on purpose until it is measured.` : ''} Signs in the "Not supporting factor" group were comparison signs in the study and are kept as published.`;
  const maxHi = Math.max(100, ...weighted.map(([, f]) => f.hi || f.or));
  const fMin = Math.log10(0.5);
  const fMax = Math.log10(maxHi);
  const fp = (x) => Math.min(100, Math.max(0, ((Math.log10(x) - fMin) / (fMax - fMin)) * 100));
  const forest = (f) => `<div class="forest" aria-hidden="true"><div class="one" style="left:${fp(1)}%"></div><div class="ci" style="left:${fp(f.lo)}%;width:${Math.max(0.8, fp(f.hi) - fp(f.lo))}%"></div><div class="pt" style="left:${fp(f.or)}%"></div></div>`;
  const groups = [...new Set(weighted.map(([, f]) => f.group))];
  $('weights-table').innerHTML = `<thead><tr><th>Finding</th><th class="num">Adjusted odds ratio</th><th class="num">95% CI</th><th>Log scale, line at 1 (no change)</th><th>Source</th></tr></thead>
    <tbody>${groups.map((g) => `<tr class="group"><th colspan="5">${esc(g)}</th></tr>${weighted.filter(([, f]) => f.group === g).map(([, f]) => `
      <tr><td>${esc(f.label)}</td><td class="num">${or2(f.or)}</td><td class="num">${or2(f.lo)} to ${or2(f.hi)}</td><td>${forest(f)}</td><td>${src(f.source)}</td></tr>`).join('')}`).join('')}</tbody>`;
  const pattern = Object.entries(FINDINGS).filter(([, f]) => f.or == null);
  $('pattern-table').innerHTML = `<thead><tr><th>Pattern sign</th><th>In plain words</th><th>Source</th></tr></thead>
    <tbody>${pattern.map(([, f]) => `<tr><td>${esc(f.label)}</td><td>${esc(f.plain)}</td><td>${src(f.source)}</td></tr>`).join('')}</tbody>`;
}

// ---------- referral line ----------
function renderLine(exampleRange) {
  const cur = currentLine();
  $('line-table').innerHTML = `<thead><tr><th>Referral line</th><th>What choosing it means</th><th>Worked example (${esc(exampleName())}) would be</th></tr></thead>
    <tbody>${REFERRAL_LINES.map((l) => `<tr class="${Math.abs(l.value - cur) < 1e-9 ? 'current' : ''}">
      <td><strong>${esc(l.label)}</strong>${Math.abs(l.value - DEFAULT_LINE) < 1e-9 ? ' <span class="pill">default</span>' : ''}${Math.abs(l.value - cur) < 1e-9 ? ' <span class="pill cur">current setting</span>' : ''}</td>
      <td>${esc(l.note)}</td>
      <td>${tierBadge(E.tierFromRange(exampleRange, l.value))}</td></tr>`).join('')}</tbody>`;
  $('line-note').textContent = 'The arithmetic: a patient right at a line of p has chance p, so for every case found there are about (1 - p) / p normal EMGs. Patients above the line need fewer. The same findings can be High at one line and Unclear at another, which is why the line must be chosen openly.';
}

// ---------- honest limits ----------
function renderLimits() {
  const hd = FINDINGS.home_decline;
  const items = [
    ['Odds ratios are not exactly likelihood ratios.', 'The study reports odds ratios from a case-control design. We use them as multipliers on the starting odds, as if they were likelihood ratios. That is close when a sign is uncommon in both groups, but not exact; the validation study checks calibration directly.'],
    ['The controls were general GP patients, not look-alike conditions.', 'The weights say how well a sign separates future MND cases from the average patient, not from someone with carpal tunnel or a pinched nerve in the neck. Among people who already have hand weakness the separation is smaller. That is why the validation cohort includes look-alike conditions, and why the output is a referral for EMG and neuromuscular assessment, which is also how the look-alikes are told apart (with imaging where needed).'],
    ['UK coded records.', 'The weights come from coded entries in UK GP records. Canadian notes are free text, signs may be recorded differently, and the extraction step adds its own errors. The validation study measures both.'],
    ['Each sign counts once.', `A sign written in five notes counts once. Worsening is picked up by the pattern rules and the home tests, not by stacking weights. Signs older than ${PRIOR?.horizonYears ?? '–'} years drop out, matching the study's window.`],
    ['The starting rate depends on age.', `${esc(PRIOR?.label || '')}. Younger patients sit toward the low end; until age-specific rates for this window are added, the whole range is sampled.`],
    ['The odds ratios are drawn independently.', 'The paper does not publish how its estimates are correlated, so each one is drawn on its own. The range may be somewhat too wide or too narrow.'],
    ['The home-test weight and the MDCs are placeholders.', hd ? `The home-test decline weight (&times; ${or2(hd.or)}, range ${or2(hd.lo)} to ${or2(hd.hi)}) ${ASSUME} is not from any published study. The MDCs below are placeholders until the team's repeat measurements replace them.` : 'The MDCs below are placeholders until the team\'s repeat measurements replace them.'],
    ['Alex\'s home-test results are made up for the demo.', 'They are labelled <span class="sim-tag">SIMULATED</span> everywhere they appear. His clinic history is from the case.'],
  ];
  $('limits-list').innerHTML = items.map(([h, t]) => `<li><strong>${h}</strong> ${t}</li>`).join('');

  const measured = measuredMdc();
  $('mdc-table').innerHTML = `<thead><tr><th>Home test</th><th>Body region</th><th>Unit</th><th>Better when</th><th class="num">MDC in use</th><th>Status</th></tr></thead>
    <tbody>${Object.entries(HOME_TESTS).map(([k, h]) => {
      const m = Number(measured[k]);
      const isMeasured = m > 0;
      return `<tr><td>${esc(h.label)}</td><td>${esc(h.region)}</td><td>${esc(h.unit)}</td><td>${h.higherIsBetter ? 'higher' : 'lower'}</td>
        <td class="num">${isMeasured ? +m.toPrecision(3) : esc(h.placeholderMdc)}</td>
        <td>${isMeasured ? 'measured by the team (repeat mode on the Home tests page)' : `${ASSUME} placeholder`}</td></tr>`;
    }).join('')}</tbody>`;
}

// ---------- evidence from real data ----------
const num = (x) => (typeof x !== 'number' || !Number.isFinite(x) ? esc(x) : Number.isInteger(x) ? String(x) : String(+x.toPrecision(3)));
const humanize = (k) => {
  const s = String(k).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ')
    .replace(/\bauc ci95\b/gi, 'AUC 95% CI').replace(/\bci95\b/gi, '95% CI').replace(/\bauc\b/gi, 'AUC')
    .replace(/\bmdc95\b/gi, 'MDC (95%)').replace(/\bmdc\b/gi, 'MDC').replace(/\bals\b/gi, 'ALS')
    .replace(/\bpct\b/gi, '%').replace(/\bsd\b/gi, 'SD').replace(/\biqr\b/gi, 'IQR').replace(/\bcv\b/gi, 'CV');
  return s.charAt(0).toUpperCase() + s.slice(1);
};
function generic(v, depth = 0) {
  if (v == null) return '<span class="muted">–</span>';
  if (Array.isArray(v)) {
    if (v.every((x) => x == null || typeof x !== 'object')) return v.length === 2 && v.every((x) => typeof x === 'number') ? `${num(v[0])} to ${num(v[1])}` : v.map(num).join(', ');
    if (v.length > 8 || depth >= 3) return `<span class="muted">${v.length} rows (not shown)</span>`;
    return `<ul class="gen">${v.map((x) => `<li>${generic(x, depth + 1)}</li>`).join('')}</ul>`;
  }
  if (typeof v === 'object') {
    if (depth >= 3) return '<span class="muted">(more detail in the analysis files)</span>';
    return `<dl class="gen">${Object.entries(v).map(([k, x]) => `<dt>${esc(humanize(k))}</dt><dd>${generic(x, depth + 1)}</dd>`).join('')}</dl>`;
  }
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  return num(v);
}
const ci = (a) => (Array.isArray(a) && a.length === 2 ? `${num(a[0])} to ${num(a[1])}` : '–');

// Accepts the generated shape (features: array, camelCase) and the raw results.json
// shape (features: object, snake_case); anything unknown falls back to generic().
const featureList = (g) => (Array.isArray(g.features) ? g.features
  : g.features && typeof g.features === 'object' ? Object.entries(g.features).map(([key, f]) => ({ key, ...f })) : []);
const cmp = (c) => (c && c.auc != null ? `${num(c.auc)} <span class="muted">(${ci(c.ci ?? c.auc_ci95)})</span>` : '–');

function renderGait(g) {
  let html = '<h3>Walking: stride timing in people with ALS compared with controls</h3>';
  if (g.source || g.dataset) html += `<p class="muted">Data: ${esc(g.source || g.dataset)}</p>`;
  const feats = featureList(g);
  if (!feats.length) return html + generic(g);
  const best = typeof g.bestFeature === 'string' ? g.bestFeature : g.best_feature?.feature;
  html += `<div class="table-wrap"><table class="compact"><thead><tr><th>Measure</th><th>Direction</th><th class="num">Controls, median</th><th class="num">ALS, median</th><th class="num">AUC, ALS vs controls (95% CI)</th><th class="num">vs Parkinson's</th><th class="num">vs Huntington's</th><th class="num">MDC (95%)</th></tr></thead><tbody>
    ${feats.map((f) => {
      const med = f.medians || { control: f.group_stats?.control?.median, als: f.group_stats?.als?.median };
      const unit = f.unit ? ` ${esc(f.unit)}` : '';
      return `<tr><td>${esc(f.label || f.description || humanize(f.key))}${f.key === best ? ' <span class="pill">best of three</span>' : ''}</td>
        <td>${esc(f.direction || f.auc_orientation || '')}</td>
        <td class="num">${num(med.control)}${unit}</td><td class="num">${num(med.als)}${unit}</td>
        <td class="num">${cmp(f.alsVsControl || f.als_vs_control)}</td>
        <td class="num">${cmp(f.alsVsParkinsons || f.als_vs_parkinsons)}</td>
        <td class="num">${cmp(f.alsVsHuntingtons || f.als_vs_huntingtons)}</td>
        <td class="num">${num(f.mdc95 ?? g.test_retest_controls?.features?.[f.key]?.mdc95)}${f.mdc95 != null || g.test_retest_controls ? unit : ''}</td></tr>`;
    }).join('')}
  </tbody></table></div>`;
  const n = g.n || {};
  const notes = [];
  if (n.als != null) notes.push(`People: ${num(n.als)} with ALS, ${num(n.control)} controls${n.park != null ? `, ${num(n.park)} with Parkinson's` : ''}${n.hunt != null ? `, ${num(n.hunt)} with Huntington's` : ''}. AUC 0.5 is no better than chance and 1 is perfect separation; below 0.5 the measure points the other way.`);
  if (g.bestFeatureNote || g.best_feature?.selected_by) {
    const bf = feats.find((f) => f.key === best);
    notes.push(`${bf ? `${esc(bf.label || humanize(bf.key))} (marked "best of three"): ` : ''}${esc(g.bestFeatureNote || g.best_feature.selected_by)}`);
  }
  if (g.mdcMethod || g.test_retest_controls?.method) notes.push(`MDC: ${esc(g.mdcMethod || g.test_retest_controls.method)}`);
  const cv = feats.find((f) => f.key === 'cv_pct');
  const walk = HOME_TESTS.walk;
  if (cv && cv.mdc95 != null && walk) notes.push(`Link to the home test: the ${esc(lower1(walk.label))} tracks stride-time variability. In this dataset a change smaller than ${num(cv.mdc95)} ${esc(cv.unit || '')} could be noise; until the team measures its own, the app uses a placeholder MDC of ${num(walk.placeholderMdc)}.`);
  if (notes.length) html += `<ul class="ev-notes">${notes.map((x) => `<li>${x}</li>`).join('')}</ul>`;
  return html;
}

function renderDelay(d) {
  let html = '<h3>How long diagnosis takes</h3>';
  const norm = (v) => { const o = v.overall || v; return { n: o.n, med: o.medianMonths ?? o.median_months, iqr: o.iqrMonths ?? o.iqr_months, over12: o.pctOver12 ?? o.pct_over_12_months }; };
  const sets = Object.entries(d).filter(([, v]) => v && typeof v === 'object' && !Array.isArray(v) && norm(v).med != null);
  if (sets.length) {
    html += `<div class="table-wrap"><table class="compact"><thead><tr><th>Dataset (people already diagnosed)</th><th class="num">People</th><th class="num">Median months, first symptom to diagnosis</th><th class="num">Middle half (IQR)</th><th class="num">Over 12 months</th></tr></thead><tbody>
      ${sets.map(([k, v]) => {
        const o = norm(v);
        const sub = Object.entries(v.bySite || {}).map(([site, s]) => { const so = norm(s); return `<tr class="sub"><td>${esc(humanize(site))} onset</td><td class="num">${num(so.n)}</td><td class="num">${num(so.med)}</td><td class="num">${ci(so.iqr)}</td><td class="num">${so.over12 != null ? `${num(so.over12)}%` : ''}</td></tr>`; }).join('');
        return `<tr><td><strong>${esc(humanize(k))}</strong><br><span class="muted small">${esc(v.source || '')}</span></td><td class="num">${num(o.n)}</td><td class="num">${num(o.med)}</td><td class="num">${ci(o.iqr)}</td><td class="num">${o.over12 != null ? `${num(o.over12)}%` : '–'}</td></tr>${sub}`;
      }).join('')}
    </tbody></table></div>`;
    if (d.note) html += `<p class="muted">${esc(d.note)}</p>`;
  } else {
    html += generic(d);
  }
  html += '<p class="muted">From the case, for comparison: Alex\'s first symptom was in June 2024 and his diagnosis on 14 July 2026; in Canada diagnosis typically takes 15 to 27 months.</p>';
  return html;
}

function renderEvidence() {
  const el = $('evidence-body');
  if (EVIDENCE == null) {
    el.innerHTML = '<div class="banner unclear pending"><strong>Pending.</strong> The team\'s analysis of public datasets (walking in people with ALS compared with controls, and how long diagnosis takes) has not been loaded yet. No numbers are shown until it is.</div>';
    return;
  }
  const parts = ['<p>Two questions we could check on public data during the hackathon: does a simple walking measure separate people with ALS from controls, and how long does diagnosis take? These support the design; they do not validate the scorer (section 6 does that).</p>'];
  const done = new Set();
  if (EVIDENCE.gait) { parts.push(renderGait(EVIDENCE.gait)); done.add('gait'); }
  if (EVIDENCE.delay) { parts.push(renderDelay(EVIDENCE.delay)); done.add('delay'); }
  if (Array.isArray(EVIDENCE.limits)) { parts.push(`<h3>Limits of this evidence</h3><ul class="ev-notes">${EVIDENCE.limits.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`); done.add('limits'); }
  for (const [k, v] of Object.entries(EVIDENCE)) if (!done.has(k)) parts.push(`<h3>${esc(humanize(k))}</h3>${generic(v)}`);
  el.innerHTML = parts.join('');
}


// ---------- run every section on its own ----------
function section(name, fn) {
  try { fn(); } catch (err) {
    console.error(`method.js: ${name} failed`, err);
    const host = document.querySelector('main');
    const note = document.createElement('p');
    note.className = 'banner high';
    note.textContent = `Could not build "${name}": ${err.message}`;
    host.prepend(note);
  }
}

const line = currentLine();
let example = null;
section('worked example', () => {
  example = E.simulate(EXAMPLE);
  renderSteps(example, line);
  renderWorked(example, line);
});
section('try it', () => renderTry(line));
section('tiers', renderTiers);
section('pattern rules', renderRules);
section('deadline', renderDeadline);
section('weights', renderWeights);
section('referral line', () => renderLine(example || E.simulate(EXAMPLE)));
section('limits', renderLimits);
section('evidence', renderEvidence);
document.body.dataset.methodReady = 'true';
