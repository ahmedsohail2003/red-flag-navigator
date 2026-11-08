// Overview (index.html): the page judges see first. Alex's real path, where the tool
// would have escalated, and the headline result, all computed live from engine.js,
// weights.js, alex.js and evidence.js. CASE_TEXT holds the few facts copied from the
// BioHacks case text that alex.js does not carry (surgery date, the Canadian range).
import {
  timeline, monthsSaved, simulate, formatPct,
  FINDINGS, RULES, HOME_TESTS, PRIOR, SOURCES, DEFAULT_REFERRAL_LINE, UNCLEAR_DEADLINE_WEEKS,
} from './engine.js';
import { REFERRAL_LINES } from './weights.js';

export const CASE_TEXT = {
  firstSymptom: { month: '2024-06', title: 'First symptom: handwriting fading on the whiteboard' },
  surgery: { date: '2025-01-20', who: 'Hand surgeon', title: 'Carpal tunnel release: no improvement' },
  canadaRange: '15 to 27 months',
  // Shown only if alex.js cannot be loaded (dates from the case text).
  fallback: [
    ['2024-10-14', 'Family doctor', 'Referred to hand surgery as carpal tunnel', ['arm']],
    ['2024-12-09', 'Hand surgeon', 'Normal wrist nerve studies, visible hand wasting', ['arm']],
    ['2025-01-20', 'Hand surgeon', 'Carpal tunnel release: no improvement', []],
    ['2025-04-21', 'Hand surgeon (follow-up)', 'Weaker, forearm twitching, right foot catching', ['arm', 'leg']],
    ['2025-08-15', 'Physiotherapy', 'Foot drop treated, getting worse', ['leg']],
    ['2026-02-16', 'Family doctor', 'Urgent neurology referral', []],
    ['2026-06-11', 'Neuromuscular neurologist', 'First specialist visit, 16 weeks later', []],
    ['2026-07-14', 'Neuromuscular neurologist', 'ALS diagnosed', []],
  ],
};

const DAY = 86400000;
const toT = (d) => Date.parse(`${d}T00:00:00Z`);
const iso = (t) => new Date(t).toISOString().slice(0, 10);
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const fmtDate = (d, month = 'short') => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month, year: 'numeric', timeZone: 'UTC' });
const fmtMonth = (ym) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
// Whole calendar months between two 'YYYY-MM' (or longer) dates.
export const monthsCal = (a, b) => {
  const [ya, ma] = a.split('-').map(Number);
  const [yb, mb] = b.split('-').map(Number);
  return (yb - ya) * 12 + (mb - ma);
};
const TIER_NAME = { high: 'High', unclear: 'Unclear', low: 'Low' };
const fmtLine = (v) => REFERRAL_LINES.find((l) => l.value === v)?.label || formatPct(v);
const REGION_SHORT = { arm: 'hand/arm', leg: 'leg/foot', bulbar: 'speech', breathing: 'breathing', general: 'general', cognitive: 'mood' };
const SIM = '<span class="sim-tag">SIMULATED</span>';
const ASSUME = '<span class="assume-tag">ASSUMPTION</span>';

function regionsOf(enc) {
  const set = new Set();
  for (const f of enc.findings || []) {
    const r = f.region || FINDINGS[f.id]?.region;
    if (REGION_SHORT[r]) set.add(r);
  }
  return [...set];
}

export function eventsFromCase(cf) {
  const a = cf.actual || {};
  const fs = String(a.firstSymptom || CASE_TEXT.firstSymptom.month).slice(0, 7);
  const evs = [{ date: `${fs}-15`, dateLabel: fmtMonth(fs), who: 'Alex', title: CASE_TEXT.firstSymptom.title, regions: ['arm'], kind: 'event' }];
  for (const e of cf.encounters || []) {
    evs.push({ date: e.date, dateLabel: fmtDate(e.date), who: e.setting || e.clinician || 'Visit', title: e.title || '', detail: e.whatHappened || '', regions: regionsOf(e), kind: 'visit', reconstructed: !!e.reconstructed });
  }
  const have = new Set(evs.map((e) => e.date));
  const add = (date, who, title) => {
    if (date && !have.has(date)) { evs.push({ date, dateLabel: fmtDate(date), who, title, regions: [], kind: 'event' }); have.add(date); }
  };
  add(CASE_TEXT.surgery.date, CASE_TEXT.surgery.who, CASE_TEXT.surgery.title);
  add(a.firstNeuromuscular || a.firstNeurology, 'Neuromuscular neurologist', 'First specialist visit');
  add(a.diagnosis, 'Neuromuscular neurologist', 'ALS diagnosed');
  return evs.sort((x, y) => x.date.localeCompare(y.date));
}

// Everything the page shows, as plain data (testable in Node).
export function buildOverview(cf, evidence = null) {
  const live = !!(cf && Array.isArray(cf.encounters) && cf.encounters.length);
  if (!live) {
    const events = [{ date: `${CASE_TEXT.firstSymptom.month}-15`, dateLabel: fmtMonth(CASE_TEXT.firstSymptom.month), who: 'Alex', title: CASE_TEXT.firstSymptom.title, regions: ['arm'], kind: 'event' }]
      .concat(CASE_TEXT.fallback.map(([date, who, title, regions]) => ({ date, dateLabel: fmtDate(date), who, title, regions, kind: 'event' })));
    return {
      live, events, strip: [], saved: null, evidence,
      axis: { start: iso(toT(`${CASE_TEXT.firstSymptom.month}-01`) - 10 * DAY), end: iso(toT('2026-07-14') + 25 * DAY) },
      problem: { months: monthsCal(CASE_TEXT.firstSymptom.month, '2026-07'), nVisits: null, nClinicians: null },
    };
  }
  const a = cf.actual || {};
  const events = eventsFromCase(cf);
  const fs = String(a.firstSymptom || CASE_TEXT.firstSymptom.month).slice(0, 7);
  const end = a.diagnosis || events[events.length - 1].date;
  const axis = { start: iso(toT(`${fs}-01`) - 10 * DAY), end: iso(toT(end) + 25 * DAY) };

  const opts = { includeHomeTests: false };
  const tl = timeline(cf, opts);
  const tierAt = Object.fromEntries(tl.map((e) => [e.asOf, e.tier]));
  for (const e of events) if (e.kind === 'visit') e.tier = tierAt[e.date] || null;
  const strip = tl.map((e, i) => ({ from: e.asOf, to: i + 1 < tl.length ? tl[i + 1].asOf : end, tier: e.tier }));

  const ms = monthsSaved(cf, opts);
  let saved = null;
  // Gains are counted referral to referral (tool's EMG prompt vs Alex's real neurology
  // referral, 16 Feb 2026): the 16-week waiting list after a referral applies either way.
  const gainOf = (x) => (x.monthsVsReferral != null ? x.monthsVsReferral : x.months);
  if (gainOf(ms) != null) {
    const ev = tl.find((e) => e.asOf === ms.firstHigh);
    const byLine = REFERRAL_LINES.map((l) => ({ ...l, months: gainOf(monthsSaved(cf, { ...opts, referralLine: l.value })) }))
      .filter((l) => l.months != null);
    const rounded = byLine.map((l) => Math.round(l.months));
    saved = {
      ...ms, rounded: Math.round(gainOf(ms)), ev,
      setting: ev?.encounter?.setting || '',
      reason: ev?.reason || '', range: ev?.range || null, line: ev?.line ?? DEFAULT_REFERRAL_LINE,
      byLine, minMonths: Math.min(...rounded), maxMonths: Math.max(...rounded),
      // "At least" must never round up: floor the smallest gain across all lines.
      floorMin: Math.floor(Math.min(...byLine.map((l) => l.months))),
      emg: a.emg || null,
    };
  }

  const clinicians = new Set(cf.encounters.map((e) => e.clinician || e.setting));
  const homeTests = cf.homeTests || [];
  return {
    live, events, axis, strip, saved, evidence,
    problem: {
      months: monthsCal(fs, String(end).slice(0, 7)),
      nVisits: cf.encounters.length, nClinicians: clinicians.size,
      firstSymptom: fmtMonth(fs), diagnosis: a.diagnosis ? fmtDate(a.diagnosis, 'long') : null,
    },
    honest: {
      nNotes: cf.encounters.length,
      nRebuilt: cf.encounters.filter((e) => e.reconstructed).length,
      nHome: homeTests.length,
      homeSimulated: homeTests.some((h) => h.simulated),
      homeLabels: [...new Set(homeTests.map((h) => HOME_TESTS[h.test]?.label).filter(Boolean))],
      homeWeeks: new Set(homeTests.map((h) => h.date)).size,
    },
  };
}

// ---------- rendering ----------
function renderProblem(m) {
  const p = m.problem;
  document.getElementById('ov-problem').textContent = `Alex Chen waited ${p.months} months for an ALS diagnosis.`;
  const counts = p.nVisits ? `${p.nVisits} documented visits with ${p.nClinicians} clinicians, ` : '';
  document.getElementById('ov-problem-line').innerHTML = `First symptom ${esc(p.firstSymptom || 'June 2024')}${p.diagnosis ? `, diagnosis ${esc(p.diagnosis)}` : ''}: ${esc(counts)}and each referral was about one body part (the hand to a hand surgeon, the foot to physiotherapy). In Canada, diagnosis typically takes ${esc(CASE_TEXT.canadaRange)}.`;
}

function renderResult(m) {
  const el = document.getElementById('ov-result');
  const s = m.saved;
  if (!s) {
    el.innerHTML = `<div class="ov-result-k">Result on Alex's real notes</div><div class="ov-result-big">Pending</div><p>${m.live ? 'The tool did not reach High before the first specialist visit with these settings.' : 'Alex\'s case file has not loaded yet.'}</p>`;
    return;
  }
  const lines = s.byLine.length > 1 && s.minMonths !== s.maxMonths
    ? `<p class="ov-result-lines">At every referral line from ${esc(s.byLine[0].label)} to ${esc(s.byLine[s.byLine.length - 1].label)}: ${s.minMonths} to ${s.maxMonths} months earlier.</p>`
    : '';
  el.innerHTML = `<div class="ov-result-k">Result on Alex's real notes</div>
    <div class="ov-result-big" id="ov-months">${s.byLine.length > 1 ? `At least ${s.floorMin} months earlier referral` : `About ${s.rounded} months earlier referral`}</div>
    <p>At the default referral line (${esc(fmtLine(s.line))}) the tool says <b>refer for EMG</b> after the ${esc(s.setting.toLowerCase())} visit on ${fmtDate(s.firstHigh)}, about ${s.rounded} months before Alex's real neurology referral${s.referral ? ` (${fmtDate(s.referral)})` : ''}. After that referral he waited 16 weeks to see a neuromuscular specialist (${fmtDate(s.actual)})${s.emg ? ` and had his EMG on ${fmtDate(s.emg)}` : ''}; that wait is not counted as a gain.</p>
    ${s.range ? `<p class="ov-result-why">Why then: ${esc(s.reason.charAt(0).toLowerCase() + s.reason.slice(1))} (range ${esc(formatPct(s.range.lo))} to ${esc(formatPct(s.range.hi))}, line ${esc(fmtLine(s.line))}).${s.ev && !(s.ev.rulesFired || []).length && s.range.lo - s.line < 0.01 ? ' That range is only just above the line, so the headline uses the gain that holds at every line.' : ''}</p>` : ''}
    ${lines}
    <p class="ov-result-foot">Notes only: the simulated home tests are not used for this number.</p>`;
}

function renderTimeline(m, laneH = 112) {
  const el = document.getElementById('ov-timeline');
  const W = Math.max(940, el.parentElement?.clientWidth || 0);
  const t0 = toT(m.axis.start);
  const t1 = toT(m.axis.end);
  const X = (d) => ((toT(d) - t0) / (t1 - t0)) * W;
  const LABEL_W = 150; const GAP = 8; const LANE_H = laneH; const STRIP_Y = 62; const STRIP_H = 14; const TOP = 96;
  const laneEnds = [];
  const placed = m.events.map((e) => {
    const x = X(e.date);
    const left = Math.min(Math.max(0, x - 12), W - LABEL_W);
    let lane = laneEnds.findIndex((endPx) => left >= endPx + GAP);
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(0); }
    laneEnds[lane] = left + LABEL_W;
    return { ...e, x, left, lane };
  });
  const H = TOP + laneEnds.length * LANE_H;
  const parts = [];
  for (let y = new Date(t0).getUTCFullYear() + 1; toT(`${y}-01-01`) < t1; y++) {
    parts.push(`<div class="tl-year" style="left:${X(`${y}-01-01`).toFixed(1)}px;height:${H}px"><span>${y}</span></div>`);
  }
  const segs = [];
  if (m.strip.length) {
    segs.push(`<div class="seg none" style="left:0;width:${X(m.strip[0].from).toFixed(1)}px" title="No notes yet"></div>`);
    for (const s of m.strip) segs.push(`<div class="seg ${s.tier}" style="left:${X(s.from).toFixed(1)}px;width:${Math.max(2, X(s.to) - X(s.from)).toFixed(1)}px" title="${TIER_NAME[s.tier]} from ${fmtDate(s.from)}"></div>`);
  } else {
    segs.push('<div class="seg none" style="left:0;width:100%"></div>');
  }
  parts.push(`<div class="tl-strip" style="top:${STRIP_Y}px;height:${STRIP_H}px">${segs.join('')}</div>`);
  if (m.saved) {
    const a = X(m.saved.firstHigh);
    const b = X(m.saved.referral || m.saved.actual);
    parts.push(`<div class="tl-bracket" style="left:${a.toFixed(1)}px;width:${(b - a).toFixed(1)}px;top:30px;height:${STRIP_Y - 30}px"><span>Tool says “refer for EMG” here: about ${m.saved.rounded} months before the real referral${m.saved.ev && !(m.saved.ev.rulesFired || []).length ? ' (only just, at the default line)' : ''}</span></div>`);
  }
  for (const p of placed) {
    const top = TOP + p.lane * LANE_H;
    const shown = p.regions.slice(0, 3);
    const chips = shown.map((r) => `<span class="chip r-${r}">${REGION_SHORT[r]}</span>`).join('')
      + (p.regions.length > shown.length ? `<span class="chip">+${p.regions.length - shown.length} more</span>` : '');
    const tool = p.tier ? `<span class="chip tool ${p.tier}">Tool: ${p.tier === 'high' ? 'refer for EMG' : TIER_NAME[p.tier]}</span>` : '';
    parts.push(`<div class="tl-stem" style="left:${p.x.toFixed(1)}px;top:${STRIP_Y + STRIP_H}px;height:${top - STRIP_Y - STRIP_H}px"></div>`);
    parts.push(`<div class="tl-dot ${p.kind}" style="left:${p.x.toFixed(1)}px;top:${STRIP_Y + STRIP_H / 2}px"></div>`);
    parts.push(`<div class="tl-label ${p.kind}" style="left:${p.left.toFixed(1)}px;top:${top}px;width:${LABEL_W}px" title="${esc(p.detail || p.title)}">
      <div class="tl-date">${esc(p.dateLabel)}</div>
      <div class="tl-who" title="${esc(p.who)}">${esc(p.who)}</div>
      <div class="tl-what">${esc(p.title)}</div>
      <div class="tl-chips">${chips}${tool}</div>
    </div>`);
  }
  el.style.height = `${H}px`;
  el.innerHTML = parts.join('');
  // Second pass: make every lane as tall as the tallest label, so labels never overlap.
  const tallest = Math.max(0, ...[...el.querySelectorAll('.tl-label')].map((n) => n.offsetHeight));
  if (tallest + 10 > LANE_H) renderTimeline(m, tallest + 10);
}

function renderLegend(m) {
  document.getElementById('tl-legend').innerHTML = ['high', 'unclear', 'low'].map((t) => `<span class="lg"><i class="sw ${t}"></i>${TIER_NAME[t]}</span>`).join('')
    + '<span class="lg"><i class="sw none"></i>No notes yet</span>';
  document.getElementById('tl-note').innerHTML = m.live
    ? `Coloured bar: what the tool would have said after each visit, using only the notes written by then (referral line ${esc(fmtLine(DEFAULT_REFERRAL_LINE))}, home tests not used). Chips: the body parts each note documented. Filled dots are visits with a note; hollow dots are other events.`
    : 'Alex\'s case file has not loaded, so the tool overlay is pending. Dates are from the case text.';
}

function renderFlow(m) {
  const nSims = simulate([]).nSims.toLocaleString('en-CA');
  const ruleLabels = RULES.map((r) => r.label.toLowerCase()).join('; ');
  const steps = [
    ['Notes from every visit', 'Family doctor, surgeon and physiotherapy notes are read together, in date order, instead of one visit at a time.'],
    ['Findings, each with its quote', `Each finding is pulled out with the exact sentence quoted, so a doctor can check it. AI may do this step; it never produces the number.${m.live ? ' For Alex, a test checks that every quote appears word for word in its note.' : ''}`],
    ['A sourced range, not a guess', `Start from ${PRIOR.label}. Multiply by each finding's published adjusted odds ratio (${SOURCES.mei2022.short}: 6,437 cases, 62,003 controls). Simulate ${nSims} times and keep the middle 95%. Pattern rules go straight to High: ${ruleLabels}.`],
    ['Tier and action', `High (whole range above the referral line, default ${fmtLine(DEFAULT_REFERRAL_LINE)}): refer for EMG now. Unclear (range crosses it): weekly home tests, decide by week ${UNCLEAR_DEADLINE_WEEKS}. Low: safety-net advice. The output is “needs an EMG and neuromuscular workup”, never “has ALS”.`],
  ];
  document.getElementById('ov-flow').innerHTML = steps.map(([t, b], i) => `<li class="flow-step"><div class="flow-n">${i + 1}</div><h3>${esc(t)}</h3><p>${esc(b)}</p></li>`).join('');
  const tests = Object.values(HOME_TESTS).map((h) => h.label.replace(/\s*\(.*\)$/, '').toLowerCase());
  document.getElementById('ov-home').innerHTML = `<b>Alongside, never instead:</b> weekly home tests by body region (${esc(tests.join('; '))}). Each person is compared with their own baseline, at a fixed time of day. A drop counts only if it is bigger than the test's minimal detectable change, two weeks in a row.`;
}

function renderHonest(m) {
  const h = m.honest;
  const ev = m.evidence;
  const nOR = Object.values(FINDINGS).filter((f) => f.or != null && f.source === 'mei2022').length;
  const ruleSources = [...new Set(RULES.filter((r) => r.source !== 'assumption').map((r) => SOURCES[r.source]?.short).filter(Boolean))];
  const real = [];
  if (h) real.push(`Alex's ${h.nNotes} visit notes, word for word from the case package${h.nRebuilt ? ` (${h.nRebuilt} rebuilt from a later summary, marked in the replay)` : ''}.`);
  real.push(`${nOR} adjusted odds ratios copied from ${SOURCES.mei2022.short}, Figure 2.`);
  if (ruleSources.length) real.push(`Pattern rules from ${ruleSources.join(' and ')}.`);
  if (ev?.delay?.alsFocus) {
    const d = ev.delay.alsFocus;
    real.push(`Diagnostic delay in ${d.n} people with ALS (ALS Focus survey): median ${d.medianMonths} months, middle half ${d.iqrMonths[0]} to ${d.iqrMonths[1]}.`);
  }
  if (ev?.gait?.features) {
    const f = ev.gait.features.find((x) => x.key === ev.gait.bestFeature) || ev.gait.features[0];
    if (f?.alsVsControl) real.push(`Walking: ${f.label.toLowerCase()} separated ${f.alsVsControl.nAls} people with ALS from ${f.alsVsControl.nOther} controls in a public gait dataset (AUC ${f.alsVsControl.auc}, 95% CI ${f.alsVsControl.ci[0]} to ${f.alsVsControl.ci[1]}). ${ev.gait.bestFeatureNote || ''}`);
  }
  if (!ev) real.push('Checks against real datasets: pending.');
  const sim = h && h.nHome
    ? [`Alex's weekly home-test results: ${h.nHome} results over ${h.homeWeeks} weeks (${h.homeLabels.join('; ').toLowerCase()}). Alex never had home tests; they show how monitoring would work.`]
    : ['No simulated data in use.'];
  const hd = FINDINGS.home_decline;
  const defLine = REFERRAL_LINES.find((l) => l.value === DEFAULT_REFERRAL_LINE);
  const assumed = [
    `Starting rate: ${PRIOR.label}, from incidence studies, sampled as a range.`,
    hd ? `Weight of a home-test decline: odds ratio ${hd.or} (${hd.lo} to ${hd.hi}); no published value exists.` : null,
    ...RULES.filter((r) => r.source === 'assumption').map((r) => `Rule “${r.label}”: clinical reasoning, not a published study.`),
    'Normal variation for each home test: placeholders until the team measures its own repeats.',
    `Referral line ${fmtLine(DEFAULT_REFERRAL_LINE)}: a values choice${defLine ? ` (${defLine.note})` : ''}, adjustable.`,
    'Odds ratios from a primary-care study are used as likelihood ratios; its controls were general patients, not look-alikes.',
  ].filter(Boolean);
  const list = (items) => `<ul>${items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
  document.getElementById('ov-honest').innerHTML = `<h2 id="honest-h">What is real, simulated and assumed</h2>
    <div class="grid grid-3">
      <div class="hb real"><h3>Real</h3>${list(real)}</div>
      <div class="hb sim"><h3>Simulated ${SIM}</h3>${list(sim)}</div>
      <div class="hb assume"><h3>Assumed ${ASSUME}</h3>${list(assumed)}</div>
    </div>`;
}

async function main() {
  let ALEX = null;
  let EVIDENCE = null;
  try { ({ ALEX } = await import('./alex.js')); } catch (err) { console.error('alex.js not available yet', err); }
  try { ({ EVIDENCE } = await import('./evidence.js')); } catch (err) { console.error('evidence.js not available', err); }
  const m = buildOverview(ALEX, EVIDENCE);
  renderProblem(m);
  renderResult(m);
  renderLegend(m);
  renderTimeline(m);
  renderFlow(m);
  renderHonest(m);
  let timer = null;
  window.addEventListener('resize', () => { clearTimeout(timer); timer = setTimeout(() => renderTimeline(m), 150); });
}

if (typeof document !== 'undefined' && document.getElementById('ov-root')) main();
