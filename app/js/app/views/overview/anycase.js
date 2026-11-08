// Overview section 6, "Any patient" and "Real · Simulated · Assumed": the same engine
// runs on any list of dated visits and red flags (Alex's case file, the constructed
// look-alikes, a case you build), and what every number stands on. Extracted from the
// earlier single-file overview with the same content and numbers. The look-alike tiers
// are run through the engine here (no what-if, notes only), once per referral line.
import { esc, fmtDate, tierChip, simChip, assumeChip, sourceLink, ensureCss, plural, pct } from '../../ui.js';
import { evaluateAt, FINDINGS, PRIOR, RULES } from '../../../engine.js';
import { REFERRAL_LINES } from '../../../weights.js';
import { ALEX } from '../../../alex.js';
import { BUILTIN, listCases, defaultVisit } from '../../../cases.js';
import { WEARABLES } from '../../../wearables.js';

const ALEX_ID = 'alex';
const A = ALEX.actual;
const ENCS = [...ALEX.encounters].sort((a, b) => a.date.localeCompare(b.date));
const lineLabel = (v) => REFERRAL_LINES.find((l) => l.value === v)?.label || pct(v);
const yearMonth = (d) => fmtDate(String(d).slice(0, 7));

function wearablesSummary() {
  const w = WEARABLES;
  if (!w) return null;
  const arr = Array.isArray(w) ? w : Array.isArray(w.signals) ? w.signals : Array.isArray(w.items) ? w.items : null;
  if (!arr || !arr.length) return null;
  const names = arr.map((x) => (typeof x === 'string' ? x : x?.label || x?.name || x?.signal)).filter((x) => typeof x === 'string');
  return { n: arr.length, names: names.slice(0, 3) };
}

// ---------- the look-alikes, scored per referral line ----------
const DEMO_FIRST = 'demo-cts_typical';
const DEMOS = BUILTIN.filter((c) => c.kind === 'demo');
const DEMO_TIERS = new Map();
function demoTiers(line) {
  if (!DEMO_TIERS.has(line)) {
    DEMO_TIERS.set(line, DEMOS.map((c) => {
      const asOf = defaultVisit(c.caseFile);
      const ev = asOf ? evaluateAt(c.caseFile, asOf, { referralLine: line, includeHomeTests: false }) : null;
      return { id: c.id, benign: c.expect === 'not-high', tier: ev?.tier || null };
    }));
  }
  return DEMO_TIERS.get(line);
}

function anyCard(k, { attrs, group, chip, title, desc, facts, go }) {
  const rows = facts.map(([key, v, raw]) => `<span class="kv"><span>${esc(key)}</span>${raw ? `<span class="ov-any-tcs">${v}</span>` : `<span class="v">${esc(v)}</span>`}</span>`).join('');
  return `<li><button type="button" class="ov-any-card" ${attrs} aria-labelledby="ov-any-t-${k}" aria-describedby="ov-any-d-${k} ov-any-f-${k} ov-any-g-${k}">
      <span class="ov-any-top"><span class="micro">${esc(group)}</span>${chip}</span>
      <span class="ov-any-title" id="ov-any-t-${k}">${esc(title)}</span>
      <span class="ov-any-desc" id="ov-any-d-${k}">${esc(desc)}</span>
      <span class="ov-any-facts" id="ov-any-f-${k}">${rows}</span>
      <span class="ov-any-go" id="ov-any-g-${k}">${esc(go)} <span aria-hidden="true">→</span></span>
    </button></li>`;
}

function anyHtml(line) {
  const L = lineLabel(line);

  // 1. Alex's case file
  const clinicians = new Set(ENCS.map((e) => e.clinician)).size;
  const nQuotes = ENCS.reduce((k, e) => k + (e.findings || []).length, 0);
  const alex = anyCard('alex', {
    attrs: `data-ov-open="${ALEX_ID}"`,
    group: 'Case file',
    chip: '<span class="chip real" title="Clinic notes from the BioHacks case package">Case notes</span>',
    title: 'Open Alex\'s case file',
    desc: `The worked example on this page: notes from ${plural(clinicians, 'clinician')}, every red flag quoted word for word.`,
    facts: [
      ['Visits', `${ENCS.length} · ${yearMonth(ENCS[0].date)} to ${yearMonth(ENCS.at(-1).date)}`],
      ['Red flags quoted', String(nQuotes)],
    ],
    go: 'Red-flag indicator',
  });

  // 2. the constructed look-alikes, scored at the current line
  const first = DEMOS.find((c) => c.id === DEMO_FIRST) || DEMOS[0];
  let demo = '';
  if (first) {
    const rows = demoTiers(line);
    const benign = rows.filter((r) => r.benign);
    const lowHere = benign.filter((r) => r.tier === 'low').length;
    const lowEvery = benign.length > 0 && REFERRAL_LINES.every((l) => demoTiers(l.value).filter((r) => r.benign).every((r) => r.tier === 'low'));
    let stay = '';
    if (benign.length && lowEvery) stay = ` The ${benign.length} benign ones stay Low at every referral line.`;
    else if (benign.length && lowHere === benign.length) stay = ` The ${benign.length} benign ones stay Low at the ${L} line.`;
    else if (benign.length) stay = ` ${lowHere} of the ${benign.length} benign ones stay Low at the ${L} line.`;
    const counts = ['high', 'unclear', 'low'].map((t) => [t, rows.filter((r) => r.tier === t).length]).filter(([, n]) => n > 0)
      .map(([t, n]) => `<span class="ov-any-tc"><span class="mono">${n}</span>${tierChip(t)}</span>`).join('');
    demo = anyCard('demo', {
      attrs: `data-ov-open="${esc(first.id)}"`,
      group: `Look-alike demos · ${DEMOS.length}`,
      // dashed like Simulated: made up by the team, so never the solid border that means Real
      chip: '<span class="chip sim" title="Constructed cases: written by the team from typical presentations; not real patients">Constructed</span>',
      title: 'Try a look-alike',
      desc: `${plural(DEMOS.length, 'constructed case')}, mostly common look-alikes such as carpal tunnel and benign twitching.${stay}`,
      facts: [
        [`At the ${L} line`, counts, true],
        ['Opens with', first.name],
      ],
      go: 'Red-flag indicator',
    });
  }

  // 3. a new case, built in this browser
  const mine = listCases().filter((c) => c.kind === 'user').length;
  const published = Object.values(FINDINGS).filter((f) => f.or != null && f.source === 'mei2022').length;
  const build = anyCard('build', {
    attrs: 'data-ov-build',
    group: `My cases · ${mine}`,
    chip: '<span class="chip" title="Typed or pasted by you, and saved only in this browser">Entered by you</span>',
    title: 'Build a new case',
    desc: 'Add dated visits and red flags, or paste a clinic note: a keyword helper suggests flags and a clinician confirms every one before it counts.',
    facts: [
      ['Red flags with published odds ratios', String(published)],
      ['Pattern rules', String(RULES.length)],
    ],
    go: 'Cases',
  });

  return `<ul class="ov-any">${alex}${demo}${build}</ul>`;
}

// ---------- real · simulated · assumed (does not depend on the shared state) ----------
function provHtml() {
  const nQuotes = ENCS.reduce((k, e) => k + (e.findings || []).length, 0);
  const weeks = new Set((ALEX.homeTests || []).map((h) => h.date));
  const wk = [...weeks].sort();
  const hd = FINDINGS.home_decline;
  const lines = REFERRAL_LINES.map((l) => l.label);
  return `
    <ul class="ov-prov">
      <li class="ov-prov-col">
        <div class="ov-prov-top"><span class="chip">Case file</span><span class="micro">Fictional BioHacks case, quoted word for word; published papers</span></div>
        <ul>
          <li>${esc(plural(ENCS.length, 'clinic note'))} from the hacker package (pages ${esc(ALEX.sourceDoc?.pages || '')}), ${esc(plural(nQuotes, 'red-flag quote'))}, each checked word for word by a test. Alex is a fictional patient.</li>
          <li><span class="chip real">Real</span> Odds ratios from ${sourceLink('mei2022')}, a primary-care case-control study; pattern rules from ${sourceLink('goldcoast2020')} and ${sourceLink('eisen2012')}. One rule, a look-alike ruled out while weakness persists, is a team assumption and is labelled so.</li>
          <li>The case's own dates: referral ${fmtDate(A.referral)}, specialist ${fmtDate(A.firstNeurology)}, diagnosis ${fmtDate(A.diagnosis)}.</li>
        </ul>
        <p class="note">Findings were pulled from the notes by hand (AI-assisted) for this demo; automatic extraction is future work.</p>
      </li>
      <li class="ov-prov-col">
        <div class="ov-prov-top">${simChip()}<span class="micro">Made up to show the design</span></div>
        <ul>
          <li>${esc(plural(weeks.size, 'week'))} of finger-tapping results, both hands${wk.length ? `, ${fmtDate(wk[0])} to ${fmtDate(wk.at(-1))}` : ''}. Alex never had home tests.</li>
          <li>Used only when Home data (top bar) is on, and never in the headline.</li>
          <li>Phone and wearable signals: ${wearablesSummary() ? 'listed in Monitoring, none from Alex' : 'research pending'}.</li>
        </ul>
      </li>
      <li class="ov-prov-col">
        <div class="ov-prov-top">${assumeChip()}<span class="micro">Until it is measured</span></div>
        <ul>
          <li>Starting rate: ${esc(PRIOR.label)}, sampled across the range.</li>
          <li>Weight of a confirmed home-test decline: odds ratio ${esc(hd?.or)} (${esc(hd?.lo)} to ${esc(hd?.hi)}), wide on purpose.</li>
          <li>The referral line is a values choice the clinic makes: ${esc(lines.join(', '))}.</li>
        </ul>
      </li>
    </ul>`;
}

export function mount(root, ctx) {
  ensureCss('css/views/overview.css');
  let cur = ctx;
  let leaving = false;
  let leaveTimer = 0;
  root.setAttribute('aria-labelledby', 'ov-any-title');
  root.removeAttribute('aria-label');

  root.innerHTML = `
    <div class="ov-in">
      <header class="ov-sec-head">
        <div class="ov-sec-text">
          <div class="micro dot">Analyse any patient</div>
          <h2 class="ov-h2 two-tone" id="ov-any-title">Any patient. <span class="soft">The same rules.</span></h2>
          <p class="ov-sec-lede">The engine runs on any list of dated visits and red flags; Alex is the worked example.</p>
        </div>
        <div class="ov-sec-aside"><span class="note">Switch cases any time with the Case menu in the top bar.</span></div>
      </header>
      <div data-part="any">${anyHtml(ctx.state.line)}</div>
      <header class="ov-sec-head ov-sub-head">
        <div class="ov-sec-text">
          <div class="micro dot">Provenance</div>
          <h3 class="ov-h3 two-tone">Know what every number stands on. <span class="soft">Real, simulated or assumed.</span></h3>
        </div>
      </header>
      ${provHtml()}
    </div>`;

  const part = (k) => root.querySelector(`[data-part="${k}"]`);

  // Make a case the open one (no-op when it already is, so its visit and what-if stay).
  function openCase(id) {
    if ((cur.caseEntry?.id ?? ALEX_ID) === id) return;
    if (typeof cur.openCase === 'function') cur.openCase(id);
    else cur.setState({ caseId: id, exclude: [] });
  }
  function leave() {
    leaving = true;
    clearTimeout(leaveTimer);
    leaveTimer = setTimeout(() => { leaving = false; }, 1500);
  }
  function onClick(e) {
    const t = e.target.closest('[data-ov-open],[data-ov-build]');
    if (!t || !root.contains(t)) return;
    if (t.dataset.ovOpen) {
      leave();
      openCase(t.dataset.ovOpen);
      cur.navigate('indicator');
    } else if ('ovBuild' in t.dataset) cur.navigate('cases');
  }
  root.addEventListener('click', onClick);

  return {
    update(c) {
      cur = c;
      if (leaving) return;
      part('any').innerHTML = anyHtml(c.state.line);
    },
    unmount() {
      clearTimeout(leaveTimer);
      root.removeEventListener('click', onClick);
    },
  };
}
