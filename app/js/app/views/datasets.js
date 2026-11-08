// Datasets view (#datasets): the seven BioHacks datasets, what each one shows, and
// what the tool takes from it. Reads ../../datasets.js (DATASETS) when the analysts
// have filled it; until then (null) it shows the seven from the dataset README with
// an "Analysis running" state, plus the results already in ../../evidence.js.
// Every number below is computed at run time from those modules or from the case.
import { esc, fmtDate, ensureCss, assumeChip, monthsBetween } from '../ui.js';
import { EVIDENCE } from '../../evidence.js';
import { DATASETS } from '../../datasets.js';
import { ALEX } from '../../alex.js';
import { HOME_TESTS } from '../../engine.js';

// ---------- what is known before the analyses land (Datasets/README.md, team brief) ----------
const KNOWN = [
  {
    id: 'als-focus', num: '01', name: 'ALS Focus', host: 'Harvard Dataverse', match: /focus/i,
    source: 'https://doi.org/10.7910/DVN/RMBES9',
    licence: 'ALS Association data sharing terms; no redistribution',
    what: 'US online surveys of people with ALS and their caregivers: self-reported ALSFRS-R, symptom and diagnosis dates, equipment and telehealth.',
    who: '528 people with ALS and 1,017 caregivers, US',
    cite: 'Data provided by The ALS Association. ALS Focus Wave 4 (Telehealth Survey). Harvard Dataverse.',
    results: 'focus',
  },
  {
    id: 'als-progression', num: '02', name: 'ALS progression (Efron and Hastie)', host: 'DREAM challenge', match: /efron|hastie|progression|dream/i,
    source: 'https://hastie.su.domains/CASI_files/DATA/ALS.txt',
    licence: 'Public data (CASIdata, GPL-3)',
    what: 'Each trial patient’s first 3 months summed up as 369 numbers, and how fast their ALSFRS score fell afterwards.',
    who: '1,822 patients from ALS clinical trials',
    cite: 'Efron B, Hastie T. Computer Age Statistical Inference. Cambridge University Press, 2016. Data from the DREAM ALS Prediction Challenge (Kuffner et al., Nature Biotechnology, 2015).',
    checking: ['How fast scores fall after diagnosis, and what predicts it.'],
    known: ['Trial patients, already diagnosed, scored on the older 40-point ALSFRS, so it says nothing about the months before referral.'],
  },
  {
    id: 'gait', num: '03', name: 'Gait in Neurodegenerative Disease', host: 'PhysioNet', match: /gait/i,
    source: 'https://physionet.org/content/gaitndd/1.0.0/',
    licence: 'ODC Attribution 1.0',
    what: 'Force sensors in the shoes during a 5-minute walk at normal pace, giving the timing of every stride.',
    who: null, // from EVIDENCE.gait.n
    cite: 'Hausdorff JM, et al. Dynamic markers of altered gait rhythm in amyotrophic lateral sclerosis. J Appl Physiol 2000. PhysioNet, doi:10.13026/C27G6C.',
    results: 'gait',
  },
  {
    id: 'voc-als', num: '04', name: 'VOC-ALS voice recordings', host: 'Synapse', match: /voc|voice/i,
    source: 'https://doi.org/10.7303/syn53009474',
    licence: 'Non-commercial; no redistribution',
    what: 'Smartphone recordings of held vowels and fast /pa/ /ta/ /ka/ repetition, with clinical scores for each person.',
    who: '102 people with ALS and 51 healthy controls, Italy',
    cite: 'Dubbioso R, et al. Voice signals database of ALS patients with different dysarthria severity and healthy controls. Scientific Data 11, 800 (2024).',
    checking: ['Whether pitch steadiness in a held vowel separates ALS from controls in phone-quality audio, for a home voice test.'],
    known: ['One voice appears twice, labelled once as a healthy control and once as ALS (CT050 and PZ091), so it must be dropped before any control-vs-ALS comparison.'],
  },
  {
    id: 'bigp3bci', num: '05', name: 'bigP3BCI brain-computer interface', host: 'PhysioNet', match: /p3|bci/i,
    source: 'https://physionet.org/content/bigp3bci/1.0.0/',
    licence: 'CC BY 4.0',
    what: 'EEG recorded while people spelled by watching letters flash on a grid (a P300 speller).',
    who: 'About 326 participants in 20 studies, 48 with ALS',
    cite: 'Mainsah B, Fleeting C, Balmat T, Sellers E, Collins L. bigP3BCI (version 1.0.0). PhysioNet, 2025, doi:10.13026/0byy-ry86.',
    checking: ['Whether anything here applies before diagnosis.'],
    known: ['People with ALS are only in studies B, F, L and N, and most are far past the stage this tool is for.'],
  },
  {
    id: 'eeget-als', num: '06', name: 'EEGET-ALS (EEG and eye tracking)', host: 'Figshare', match: /eeget|eye/i,
    source: 'https://doi.org/10.6084/m9.figshare.24485689',
    licence: 'CC0',
    what: 'EEG and eye tracking during imagined and real movements and eye-typing; patients recorded at home, repeatedly.',
    who: '6 people with ALS and 170 healthy people, Vietnam',
    cite: 'Ngo TD, et al. An EEG and eye-tracking dataset of ALS patients and healthy people during eye-tracking-based spelling system usage. Scientific Data 11, 664 (2024).',
    checking: ['Whether a patient’s repeated home sessions show change over time.'],
    known: ['The healthy group is young and all recorded as male, so an ALS-vs-healthy model could learn age or sex instead of ALS.'],
  },
  {
    id: 'seattle', num: '07', name: 'Seattle ALS Patient Profile', host: 'Mendeley Data', match: /seattle/i,
    source: 'https://doi.org/10.17632/stcztggnnp.2',
    licence: 'CC BY-NC 3.0 (non-commercial)',
    what: 'Mood, family life, coping and physical function every 3 months, then survival follow-up to 2008.',
    who: '143 patients and 123 partners, Seattle, from 1987',
    cite: 'Segerstrom S, Kasarskis E. Seattle ALS Patient Profile Database (SALSPPD). Mendeley Data, version 2, 2024.',
    results: 'seattle',
  },
];

const STATUS = {
  used: { label: 'Used', cls: 'real', title: 'Summary numbers are shown here or shaped a home test; none feeds the score' },
  context: { label: 'Context', cls: 'ds-ctx', title: 'Background evidence; not used in the score' },
  'not-useful': { label: 'Not useful', cls: 'ds-nu', title: 'Checked: nothing here the tool can use' },
  pending: { label: 'Analysis running', cls: 'ds-run', title: 'The team is analysing this dataset now' },
};

// The home test each dataset informs: [HOME_TESTS key, unit, decimals]. In live mode the value
// the app runs on today (a placeholder) sits next to the measured one, with an ASSUMPTION chip.
// gait informs the walking test, which scores walking speed (gait_speed) since 8 Nov, not stride variability.
const INFORMS = { gait: [['gait_speed', 'm/s', 2]], 'voc-als': [['reading', 'words/min', 0]], 'als-progression': [['weight', 'kg', 1]] };
function appNow(id) {
  return (INFORMS[id] || []).map(([k, unit, dp]) => [HOME_TESTS && HOME_TESTS[k], unit, dp])
    .filter(([t]) => t && typeof t.placeholderMdc === 'number' && Number.isFinite(t.placeholderMdc))
    .map(([t, unit, dp]) => ({
      label: `In the app now: ${String(t.label).replace(/\s*\(.*\)\s*$/, '')}`,
      value: `${t.placeholderMdc.toFixed(dp)} ${unit}`, n: null,
      note: 'Smallest drop it counts: a published estimate until the team measures its own', assume: true,
    }));
}
const WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
const countWord = (n) => WORDS[n] || String(n);

const GROUPS = [['control', 'Healthy'], ['als', 'ALS'], ['park', 'Parkinson’s'], ['hunt', 'Huntington’s']];
const SITE = { bulbar: 'Speech or swallowing', upper_limb: 'Arm', lower_limb: 'Leg', limb: 'Arm or leg' };

// ---------- small number helpers ----------
const fin = (x) => typeof x === 'number' && Number.isFinite(x);
const f2 = (x) => (fin(x) ? x.toFixed(2) : '–');
const num1 = (x) => (fin(x) ? String(Math.round(x * 10) / 10) : '–');
const ci = (c) => (Array.isArray(c) && c.length === 2 ? `${f2(c[0])} to ${f2(c[1])}` : '');
const arr = (a) => (Array.isArray(a) ? a.filter((x) => x != null && String(x).trim() !== '') : []);

function evGait() {
  const g = EVIDENCE && EVIDENCE.gait;
  if (!g || !Array.isArray(g.features)) return null;
  const feat = (k) => g.features.find((f) => f.key === k && f.medians && f.alsVsControl) || null;
  const stride = feat('mean_stride_s');
  const cv = feat('cv_pct');
  return stride || cv ? { g, stride, cv, swing: feat('swing_pct') } : null;
}
function evDelay(which) {
  const d = EVIDENCE && EVIDENCE.delay && EVIDENCE.delay[which === 'focus' ? 'alsFocus' : 'seattle'];
  return d && fin(d.medianMonths) ? d : null;
}
// Alex: first symptom to diagnosis, from the case file (month-level, like the surveys).
function alexDelay() {
  const a = ALEX && ALEX.actual;
  if (!a || !a.firstSymptom || !a.diagnosis) return null;
  return { months: Math.round(monthsBetween(a.firstSymptom, a.diagnosis)), from: a.firstSymptom, to: a.diagnosis };
}

function whoGait() {
  const n = EVIDENCE?.gait?.n;
  if (!n) return '13 ALS, 15 Parkinson’s, 20 Huntington’s, 16 healthy';
  return `${n.als} ALS, ${n.park} Parkinson’s, ${n.hunt} Huntington’s, ${n.control} healthy`;
}
const limitsMatching = (re) => arr(EVIDENCE && EVIDENCE.limits).filter((x) => re.test(x));

// ---------- detail built from evidence.js (until DATASETS lands) ----------
function gaitDetail() {
  const e = evGait();
  if (!e) return null;
  const { g, stride, cv, swing } = e;
  const tells = [];
  const forTool = [];
  const numbers = [];
  if (stride) {
    const a = stride.alsVsControl;
    tells.push(`People with ALS walked with a slower rhythm: median stride time ${f2(stride.medians.als)} s against ${f2(stride.medians.control)} s in healthy walkers (AUC ${f2(a.auc)}, 95% CI ${ci(a.ci)}; ${a.nAls} vs ${a.nOther} people).`);
    numbers.push({ label: 'Mean stride time, ALS vs healthy', value: `AUC ${f2(a.auc)}`, n: `${a.nAls} vs ${a.nOther}`, note: `95% CI ${ci(a.ci)}` });
    if (stride.alsVsParkinsons) numbers.push({ label: 'Mean stride time, ALS vs Parkinson’s', value: `AUC ${f2(stride.alsVsParkinsons.auc)}`, n: `${stride.alsVsParkinsons.nAls} vs ${stride.alsVsParkinsons.nOther}`, note: `95% CI ${ci(stride.alsVsParkinsons.ci)}` });
  }
  if (cv) {
    const a = cv.alsVsControl;
    const pk = cv.alsVsParkinsons;
    tells.push(`Stride-to-stride variability was higher too: ${num1(cv.medians.als)}% against ${num1(cv.medians.control)}% (AUC ${f2(a.auc)}).`);
    if (pk) tells.push(`Against Parkinson’s, variability did not separate the groups (AUC ${f2(pk.auc)}, close to a coin toss)${stride && stride.alsVsParkinsons ? `; mean stride time still did (AUC ${f2(stride.alsVsParkinsons.auc)})` : ''}.`);
    numbers.push({ label: 'Stride-time variability, ALS vs healthy', value: `AUC ${f2(a.auc)}`, n: `${a.nAls} vs ${a.nOther}`, note: `95% CI ${ci(a.ci)}` });
    if (pk) numbers.push({ label: 'Stride-time variability, ALS vs Parkinson’s', value: `AUC ${f2(pk.auc)}`, n: `${pk.nAls} vs ${pk.nOther}`, note: `95% CI ${ci(pk.ci)}` });
    const gait = HOME_TESTS && HOME_TESTS.gait_speed;
    if (fin(cv.mdc95)) {
      // Since 8 Nov the app's walking test scores walking speed (gait_speed, from motion/), not stride-time
      // variability; this dataset's variability result stays here as what the data shows.
      forTool.push(`In this data the smallest real change in stride-time variability (MDC95) is ${f2(cv.mdc95)} points. The app's walking test now scores walking speed instead${gait && fin(gait.placeholderMdc) ? `, with a normal variation of ${gait.placeholderMdc} m/s from WatchALS's weekly home walk` : ''}.`);
      numbers.push({ label: 'Smallest real change, variability (MDC95)', value: `${f2(cv.mdc95)} pts`, n: g.n ? String(g.n.control) : null, note: 'Two halves of one walk, healthy walkers' });
      if (gait && fin(gait.placeholderMdc)) numbers.push({ label: 'Normal variation the app uses for walking speed', value: `${gait.placeholderMdc} m/s`, n: null, note: 'WatchALS, weekly home walk', assume: true });
    }
  }
  if (swing) numbers.push({ label: 'Swing phase, ALS vs healthy', value: `AUC ${f2(swing.alsVsControl.auc)}`, n: `${swing.alsVsControl.nAls} vs ${swing.alsVsControl.nOther}`, note: `95% CI ${ci(swing.alsVsControl.ci)}` });
  if (stride && fin(stride.mdc95)) numbers.push({ label: 'Smallest real change, stride time (MDC95)', value: `${stride.mdc95} s`, n: g.n ? String(g.n.control) : null, note: null });
  forTool.push('Because variability does not tell ALS from Parkinson’s, the walking test only watches for change in one person, alongside the referral. It never diagnoses.');
  const limits = [...limitsMatching(/group|matched|diagnosed|subject file|sensor|Parkinson/i), g.bestFeatureNote, g.mdcMethod].filter(Boolean);
  return { status: 'used', tellsUs: tells, forTool, limits, numbers, chart: 'gait', more: true };
}

function delayDetail(which) {
  const d = evDelay(which);
  if (!d) return null;
  const alex = alexDelay();
  const sites = Object.entries(d.bySite || {}).filter(([, s]) => s && fin(s.medianMonths));
  const tells = [`Median ${num1(d.medianMonths)} months from first symptom to diagnosis (middle half ${num1(d.iqrMonths?.[0])} to ${num1(d.iqrMonths?.[1])}), in ${d.n} people.`];
  if (fin(d.pctOver12)) tells.push(`${num1(d.pctOver12)}% waited more than 12 months.`);
  if (sites.length) tells.push(`By where it started: ${sites.map(([k, s]) => `${(SITE[k] || k).toLowerCase()} ${num1(s.medianMonths)} months (${s.n} people)`).join(', ')}.`);
  const forTool = [];
  if (which === 'focus') {
    forTool.push('Sets the size of the problem: this is the wait the earlier-referral rules try to cut.');
    const arm = d.bySite?.upper_limb;
    if (alex && arm && Array.isArray(arm.iqrMonths) && alex.months > arm.iqrMonths[1]) {
      forTool.push(`Alex’s ${alex.months} months (arm onset) is past the upper quartile for arm onset here (${num1(arm.iqrMonths[1])} months): longer than about 3 in 4 people.`);
    }
  } else {
    forTool.push('A second, older cohort that shows the same order of wait, decades earlier.');
  }
  forTool.push('Context only: the score’s weights come from Mei et al. 2022 (primary-care records), not from this data.');
  const limits = which === 'focus'
    ? ['Opt-in online survey: people well enough to answer, and dates recalled to the month.', 'The files may not be shared; each teammate downloads their own copy.', ...limitsMatching(/recalled/i)]
    : ['Prevalent cases from 3 ALS clinics and support groups, enrolled in 1987-88: care and waits were different then.', ...limitsMatching(/recalled/i)];
  const numbers = [{ label: 'Median, first symptom to diagnosis', value: `${num1(d.medianMonths)} mo`, n: String(d.n), note: Array.isArray(d.iqrMonths) ? `Middle half ${num1(d.iqrMonths[0])} to ${num1(d.iqrMonths[1])} months` : null }];
  if (fin(d.pctOver12)) numbers.push({ label: 'Waited more than 12 months', value: `${num1(d.pctOver12)}%`, n: String(d.n), note: null });
  for (const [k, s] of sites) numbers.push({ label: `${SITE[k] || k} onset`, value: `${num1(s.medianMonths)} mo`, n: String(s.n), note: Array.isArray(s.iqrMonths) ? `Middle half ${num1(s.iqrMonths[0])} to ${num1(s.iqrMonths[1])}` : null });
  return { status: 'context', tellsUs: tells, forTool, limits, numbers, chart: 'delay', more: true };
}

// One list of seven, whatever the source. DATASETS (when filled) wins, field by field.
function metaFor(d, i) {
  return KNOWN.find((k) => k.id === d.id) || KNOWN.find((k) => d.source && k.source === d.source)
    || KNOWN.find((k) => k.match.test(`${d.name || ''} ${d.short || ''}`)) || KNOWN[i] || {};
}
const RANK = { used: 0, context: 1, 'not-useful': 2, pending: 3 };
const byStatus = (a, b) => (RANK[a.status] - RANK[b.status]) || String(a.num).localeCompare(String(b.num));
function buildList() {
  return buildRaw().sort(byStatus);
}
function buildRaw() {
  if (Array.isArray(DATASETS) && DATASETS.length) {
    return DATASETS.map((d, i) => {
      const m = metaFor(d, i);
      return {
        key: String(d.id || m.id || `ds-${i}`), num: m.num || String(i + 1).padStart(2, '0'), host: m.host || d.short || '',
        name: d.name || m.name || 'Dataset', source: d.source || m.source || '', licence: d.licence || m.licence || '', what: d.what || m.what || '',
        who: d.who || m.who || (m.id === 'gait' ? whoGait() : ''), cite: m.cite || '', status: STATUS[d.status] ? d.status : 'pending',
        tellsUs: arr(d.tellsUs), forTool: arr(d.forTool), limits: arr(d.limits),
        numbers: [...(Array.isArray(d.numbers) ? d.numbers : []).filter((x) => x && x.label && x.value != null), ...appNow(m.id)],
        chart: m.results === 'gait' ? 'gait' : m.results ? 'delay' : null, live: true,
      };
    });
  }
  return KNOWN.map((m) => {
    const det = m.results === 'gait' ? gaitDetail() : m.results ? delayDetail(m.results) : null;
    return {
      key: m.id, num: m.num, host: m.host, name: m.name, source: m.source, licence: m.licence, what: m.what,
      who: m.who || whoGait(), cite: m.cite, status: det ? det.status : 'pending',
      tellsUs: det ? det.tellsUs : [], forTool: det ? det.forTool : [], limits: det ? det.limits : arr(m.known),
      numbers: det ? det.numbers : [], chart: det ? det.chart : null, checking: arr(m.checking), more: !!det, live: false,
    };
  });
}

// ---------- charts (SVG, drawn at the real container width so text never scales) ----------
function niceStep(span, count) {
  const raw = span / Math.max(1, count);
  const p = 10 ** Math.floor(Math.log10(raw));
  const m = raw / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
}
function niceDomain(lo, hi, count = 4) {
  const pad = (hi - lo) * 0.15 || Math.abs(hi) * 0.1 || 1;
  const step = niceStep(hi - lo + 2 * pad, count);
  const d0 = Math.floor((lo - pad) / step) * step;
  const d1 = Math.ceil((hi + pad) / step) * step;
  const ticks = [];
  for (let t = d0; t <= d1 + step / 1e6; t += step) ticks.push(Math.round(t * 1e6) / 1e6);
  return { d0, d1, ticks };
}
const tickLabel = (t) => (Number.isInteger(t) ? String(t) : String(Math.round(t * 100) / 100));

function gaitFeatureSvg(W, f) {
  const rows = GROUPS.filter(([k]) => fin(f.medians[k]));
  if (!rows.length) return '';
  const n = EVIDENCE?.gait?.n || {};
  const labelW = 122;
  const valW = 46;
  const rowH = 28;
  const top = 4;
  const x0 = labelW + 6;
  const x1 = Math.max(x0 + 60, W - valW - 8);
  const { d0, d1, ticks } = niceDomain(Math.min(...rows.map(([k]) => f.medians[k])), Math.max(...rows.map(([k]) => f.medians[k])));
  const x = (v) => x0 + ((v - d0) / (d1 - d0)) * (x1 - x0);
  const plotH = rows.length * rowH;
  const H = top + plotH + 26;
  let s = '';
  for (const t of ticks) s += `<line class="ds-grid" x1="${x(t).toFixed(1)}" x2="${x(t).toFixed(1)}" y1="${top}" y2="${top + plotH}"/><text class="ds-tick" x="${x(t).toFixed(1)}" y="${top + plotH + 17}" text-anchor="middle">${tickLabel(t)}</text>`;
  s += `<line class="ds-axis" x1="${x0}" x2="${x1}" y1="${top + plotH + 0.5}" y2="${top + plotH + 0.5}"/>`;
  rows.forEach(([k, label], i) => {
    const cy = top + i * rowH + rowH / 2;
    const hi = k === 'als';
    const v = f.medians[k];
    const unit = f.unit === '%' ? '%' : ` ${f.unit}`;
    const shown = f.unit === '%' ? v.toFixed(1) : v.toFixed(2);
    s += `<g class="ds-row${hi ? ' hi' : ''}"><title>${esc(label)} (${n[k] ?? '?'} people): median ${esc(shown)}${esc(unit)}</title>`
      + `<rect class="ds-hit" x="0" y="${cy - rowH / 2}" width="${W}" height="${rowH}"/>`
      + `<text class="ds-lab" x="0" y="${cy + 4}">${esc(label)}<tspan class="ds-n" dx="6">${n[k] ?? ''}</tspan></text>`
      + `<line class="ds-track" x1="${x0}" x2="${x1}" y1="${cy}" y2="${cy}"/>`
      + `<circle class="ds-dot" cx="${x(v).toFixed(1)}" cy="${cy}" r="${hi ? 5.5 : 4.5}"/>`
      + `<text class="ds-val" x="${W}" y="${cy + 4}" text-anchor="end">${esc(shown)}${f.unit === '%' ? '%' : ''}</text></g>`;
  });
  return `<svg class="ds-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(`${f.label}, group medians: ${rows.map(([k, l]) => `${l} ${f.medians[k]}`).join(', ')}`)}">${s}</svg>`;
}

function delayRows() {
  const out = [];
  const focus = evDelay('focus');
  const seattle = evDelay('seattle');
  if (focus) out.push({ group: `ALS Focus · survey 2020-21 · n ${focus.n}`, rows: ['bulbar', 'upper_limb', 'lower_limb'].filter((k) => focus.bySite?.[k]).map((k) => ({ k, ...focus.bySite[k] })) });
  if (seattle) out.push({ group: `Seattle · clinics 1987-88 · n ${seattle.n}`, rows: ['bulbar', 'limb'].filter((k) => seattle.bySite?.[k]).map((k) => ({ k, ...seattle.bySite[k] })) });
  return out.filter((g) => g.rows.length);
}

function delaySvg(W) {
  const groups = delayRows();
  if (!groups.length) return '';
  const alex = alexDelay();
  const labelW = Math.min(170, Math.max(132, W * 0.3));
  const valW = 50;
  const rowH = 36;
  const headH = 26;
  const top = alex ? 22 : 4;
  const x0 = labelW + 6;
  const x1 = Math.max(x0 + 60, W - valW - 8);
  const maxV = Math.max(...groups.flatMap((g) => g.rows.map((r) => (Array.isArray(r.iqrMonths) ? r.iqrMonths[1] : r.medianMonths))), alex ? alex.months : 0);
  const d1 = Math.ceil((maxV + 1) / 6) * 6;
  const x = (v) => x0 + (v / d1) * (x1 - x0);
  // Thin the month ticks when the plot is narrow (phone, inside the panel) so labels never collide.
  let step = 6;
  while (step < d1 && ((x1 - x0) * step) / d1 < 22) step *= 2;
  let y = top;
  let body = '';
  let grid = '';
  const gridLines = (y0, y1) => { let s = ''; for (let t = 0; t <= d1; t += step) s += `<line class="ds-grid" x1="${x(t).toFixed(1)}" x2="${x(t).toFixed(1)}" y1="${y0}" y2="${y1}"/>`; return s; };
  for (const g of groups) {
    body += `<text class="ds-group" x="0" y="${y + 16}">${esc(g.group.toUpperCase())}</text>`;
    y += headH;
    grid += gridLines(y, y + g.rows.length * rowH);
    for (const r of g.rows) {
      const cy = y + rowH / 2;
      const q = Array.isArray(r.iqrMonths) ? r.iqrMonths : null;
      body += `<g class="ds-row"><title>${esc(SITE[r.k] || r.k)} onset (${r.n} people): median ${num1(r.medianMonths)} months${q ? `, middle half ${num1(q[0])} to ${num1(q[1])}` : ''}</title>`
        + `<rect class="ds-hit" x="0" y="${y}" width="${W}" height="${rowH}"/>`
        + `<text class="ds-lab" x="0" y="${cy}">${esc(SITE[r.k] || r.k)}</text>`
        + `<text class="ds-n" x="0" y="${cy + 14}">${r.n} people</text>`
        + (q ? `<rect class="ds-iqr" x="${x(q[0]).toFixed(1)}" y="${cy - 6}" width="${Math.max(2, x(q[1]) - x(q[0])).toFixed(1)}" height="12" rx="4"/>` : '')
        + `<rect class="ds-med" x="${(x(r.medianMonths) - 1.5).toFixed(1)}" y="${cy - 10}" width="3" height="20" rx="1.5"/>`
        + `<text class="ds-val" x="${W}" y="${cy + 4}" text-anchor="end">${num1(r.medianMonths)} mo</text></g>`;
      y += rowH;
    }
  }
  const plotBottom = y;
  for (let t = 0; t <= d1; t += step) grid += `<text class="ds-tick" x="${x(t).toFixed(1)}" y="${plotBottom + 17}" text-anchor="middle">${t}</text>`;
  grid += `<line class="ds-axis" x1="${x0}" x2="${x1}" y1="${plotBottom + 0.5}" y2="${plotBottom + 0.5}"/>`;
  let ref = '';
  if (alex) {
    const ax = x(alex.months).toFixed(1);
    ref = `<g class="ds-ref"><title>Alex: first symptom ${esc(fmtDate(alex.from))} to diagnosis ${esc(fmtDate(alex.to))}, ${alex.months} months</title><line x1="${ax}" x2="${ax}" y1="14" y2="${plotBottom}"/><text x="${ax}" y="10" text-anchor="middle">Alex ${alex.months} mo</text></g>`;
  }
  const H = plotBottom + 26;
  const label = groups.map((g) => `${g.group}: ${g.rows.map((r) => `${SITE[r.k] || r.k} median ${num1(r.medianMonths)} months`).join(', ')}`).join('. ');
  return `<svg class="ds-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(`Months from first symptom to diagnosis by where ALS started. ${label}.${alex ? ` Alex: ${alex.months} months.` : ''}`)}">${grid}${ref}${body}</svg>`;
}

function drawChart(host) {
  const W = Math.floor(host.clientWidth);
  if (!W || W === Number(host.dataset.w)) return;
  host.dataset.w = String(W);
  if (host.dataset.chart === 'delay') host.innerHTML = delaySvg(W);
  else {
    const f = evGait()?.[host.dataset.feature === 'cv_pct' ? 'cv' : 'stride'];
    host.innerHTML = f ? gaitFeatureSvg(W, f) : '';
  }
}

// ---------- markup ----------
const statusChip = (s) => { const st = STATUS[s] || STATUS.pending; return `<span class="chip ${st.cls}" title="${esc(st.title)}">${esc(st.label)}</span>`; };
const extLink = (url, text) => (url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(text)}</a>` : esc(text));
const hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } };

function gaitFeatureBlock(f, label) {
  const a = f.alsVsControl;
  const others = [['alsVsParkinsons', 'Parkinson’s'], ['alsVsHuntingtons', 'Huntington’s']].filter(([k]) => f[k] && fin(f[k].auc));
  return `<div class="ds-feat">
    <div class="ds-feat-head"><span class="ds-feat-name">${esc(label)}</span><span class="faint">${esc(f.unit === 's' ? 'seconds' : 'per cent')}, group median</span></div>
    <div class="ds-feat-auc"><span class="mono ds-auc">AUC ${f2(a.auc)}</span> ALS vs healthy <span class="faint">95% CI ${ci(a.ci)}</span>${others.length ? `<span class="ds-auc-others">${others.map(([k, l]) => `vs ${l} <span class="mono">${f2(f[k].auc)}</span>`).join(' · ')}</span>` : ''}</div>
    <div class="ds-chart" data-chart="gait" data-feature="${esc(f.key)}"></div>
  </div>`;
}

function overYearHtml() {
  const rows = [['ALS Focus', evDelay('focus')], ['Seattle', evDelay('seattle')]].filter(([, d]) => d && fin(d.pctOver12));
  if (!rows.length) return '';
  return `<div class="inset ds-overyear"><div class="micro">Waited more than a year</div>${rows.map(([l, d]) => `<div class="kv"><span>${esc(l)} <span class="faint">n ${esc(d.n)}</span></span><span class="v">${num1(d.pctOver12)}%</span></div>`).join('')}</div>`;
}

function chartsSection() {
  const e = evGait();
  const delay = delayRows();
  const alex = alexDelay();
  const cards = [];
  if (e) {
    cards.push(`<article class="card ds-chart-card reveal d1">
      <div class="card-head"><h3>Walking rhythm in 5-minute walks</h3><span class="aside chip real" title="Computed from the real PhysioNet recordings">Real data</span></div>
      <div class="card-body stack">
        ${e.stride ? gaitFeatureBlock(e.stride, 'Mean stride time') : ''}
        ${e.cv ? gaitFeatureBlock(e.cv, 'Stride-time variability') : ''}
        <p class="note">${esc(e.g.source)}. ${esc(e.g.bestFeatureNote || '')} AUC: the chance that a random person with ALS has the higher value than a random person from the other group (0.5 = coin toss).</p>
      </div></article>`);
  }
  if (delay.length) {
    const focus = evDelay('focus');
    const arm = focus?.bySite?.upper_limb;
    cards.push(`<article class="card ds-chart-card reveal d2">
      <div class="card-head"><h3>Months from first symptom to diagnosis</h3><span class="aside chip real" title="Computed from the real survey records">Real data</span></div>
      <div class="card-body stack">
        <div class="ds-legend" aria-hidden="true"><span><i class="ds-key-iqr"></i>Middle half of people</span><span><i class="ds-key-med"></i>Median</span>${alex ? '<span><i class="ds-key-ref"></i>Alex</span>' : ''}</div>
        <div class="ds-chart" data-chart="delay"></div>
        ${overYearHtml()}
        <p class="note">By where the first symptom was. ${alex ? `Alex: ${esc(fmtDate(alex.from))} to ${esc(fmtDate(alex.to))}, ${alex.months} months${arm && Array.isArray(arm.iqrMonths) && alex.months > arm.iqrMonths[1] ? `, past the upper quartile for arm onset in ALS Focus (${num1(arm.iqrMonths[1])} months)` : ''}. ` : ''}Delays are recalled by people already diagnosed.</p>
      </div></article>`);
  }
  if (!cards.length) return '';
  return `<section class="section">
    <div class="section-head"><h2>What the data already shows</h2><span class="aside">Computed by the team from the raw files</span></div>
    <div class="grid cols-2 ds-charts">${cards.join('')}</div>
  </section>`;
}

function cardHtml(d) {
  return `<article class="ds-card${d.status === 'pending' ? ' is-pending' : ''}" data-key="${esc(d.key)}">
    <div class="ds-card-top"><span class="ds-num">${esc(d.num)}</span><span class="micro">${esc(d.host)}</span><span class="spacer"></span>${statusChip(d.status)}</div>
    <h3 class="ds-name">${esc(d.name)}</h3>
    <p class="ds-what">${esc(d.what)}</p>
    <div class="ds-who"><span class="micro">Who</span><span>${esc(d.who)}</span></div>
    <div class="ds-card-foot"><span class="ds-lic" title="Licence">${esc(d.licence)}</span><button type="button" class="ds-toggle" aria-expanded="false" aria-controls="ds-detail" aria-label="${esc(`Details: ${d.name}`)}">Details<span class="ds-chev" aria-hidden="true"></span></button></div>
  </article>`;
}

// Datasets checked and set aside share one tile, so the grid stays even (5 + 1 = 6 cells).
function gridCells(list) {
  const aside = list.filter((d) => d.status === 'not-useful');
  const main = list.filter((d) => d.status !== 'not-useful');
  if (!aside.length || aside.length > 3 || main.length < 3) return list.map((d) => `<div class="ds-cell">${cardHtml(d)}</div>`).join('');
  return main.map((d) => `<div class="ds-cell">${cardHtml(d)}</div>`).join('') + `<div class="ds-cell">
    <section class="ds-aside-tile" aria-label="Datasets checked and set aside">
      <div class="ds-card-top"><span class="micro">Checked and set aside</span><span class="spacer"></span>${statusChip('not-useful')}</div>
      <h3 class="ds-name">Not for an earlier referral</h3>
      <p class="ds-what">The team analysed ${aside.length === 1 ? 'this one' : `these ${aside.length}`}; nothing in ${aside.length === 1 ? 'it' : 'them'} helps flag ALS before diagnosis.</p>
      <div class="ds-mini-list">${aside.map((d) => `<article class="ds-card ds-mini" data-key="${esc(d.key)}">
        <div class="ds-mini-main"><span class="ds-mini-name"><span class="ds-num">${esc(d.num)}</span>${esc(d.name)}</span><span class="ds-lic">${esc(d.who)}${d.licence ? ` · ${esc(d.licence)}` : ''}</span></div>
        <button type="button" class="ds-toggle" aria-expanded="false" aria-controls="ds-detail" aria-label="${esc(`Details: ${d.name}`)}">Details<span class="ds-chev" aria-hidden="true"></span></button>
      </article>`).join('')}</div>
    </section></div>`;
}

function listBlock(title, items, emptyText) {
  return `<div class="ds-block"><div class="micro dot">${esc(title)}</div>${items.length
    ? `<ul class="ds-ul">${items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`
    : `<p class="ds-empty">${esc(emptyText)}</p>`}</div>`;
}

function numbersBlock(d) {
  if (!d.numbers.length) {
    return `<div class="panel-inset ds-numbers"><div class="micro dot">Key numbers</div><p class="ds-empty">${d.status === 'pending' ? 'Analysis running. Numbers appear here when the team’s analysis lands.' : 'No headline numbers for this dataset.'}</p></div>`;
  }
  return `<div class="panel-inset ds-numbers"><div class="micro dot">Key numbers</div>${d.numbers.map((x) => `
    <div class="kv"><span class="ds-kv-l">${esc(x.label)}${x.note || x.n ? `<span class="ds-kv-note">${[x.note, x.n ? `n ${x.n}` : ''].filter(Boolean).map(esc).join(' · ')}</span>` : ''}</span><span class="ds-kv-r">${x.assume ? assumeChip() : ''}<span class="v">${esc(x.value)}</span></span></div>`).join('')}</div>`;
}

function detailHtml(d) {
  const pending = d.status === 'pending';
  const tellsEmpty = pending ? `Analysis running.${d.checking?.length ? ` Checking: ${d.checking.join(' ')}` : ''}` : 'Nothing recorded yet.';
  const chart = !d.chart ? '' : d.chart === 'gait'
    ? (() => { const e = evGait(); return e && e.stride ? `<div class="panel-inset ds-panel-chart">${gaitFeatureBlock(e.stride, 'Mean stride time')}</div>` : ''; })()
    : `<div class="panel-inset ds-panel-chart"><div class="ds-feat-head"><span class="ds-feat-name">Months from first symptom to diagnosis</span><span class="faint">median and middle half</span></div><div class="ds-chart" data-chart="delay"></div></div>`;
  return `<section class="panel grid-bg ds-detail" id="ds-detail" aria-label="${esc(`Details: ${d.name}`)}" tabindex="-1">
    <div class="ds-detail-head">
      <div class="row"><span class="micro dot">Dataset ${esc(d.num)} · ${esc(d.host)}</span><span class="spacer"></span><button type="button" class="btn sm ds-close">Close</button></div>
      <div class="row ds-detail-title-row"><h3 class="ds-detail-title">${esc(d.name)}</h3>${statusChip(d.status)}${!d.live && d.more ? '<span class="chip ds-run" title="More analysis is running">More analysis running</span>' : ''}</div>
      <p class="muted ds-detail-what">${esc(d.what)}</p>
      <div class="ds-meta">
        <div><span class="micro">Who</span><span>${esc(d.who)}</span></div>
        <div><span class="micro">Licence</span><span>${esc(d.licence)}</span></div>
        <div><span class="micro">Source</span><span>${extLink(d.source, hostOf(d.source))}</span></div>
      </div>
    </div>
    <div class="ds-detail-body">
      <div class="ds-detail-lists">
        ${listBlock('What it tells us', d.tellsUs, tellsEmpty)}
        ${listBlock('What the tool takes from it', d.forTool, pending ? 'Decided when the analysis lands.' : 'Nothing: context only.')}
        ${listBlock(pending && !d.live ? 'Known limits so far' : 'Limits', d.limits, 'None recorded yet.')}
      </div>
      <div class="ds-detail-side">${numbersBlock(d)}${chart}</div>
    </div>
  </section>`;
}

function stripHtml(list) {
  const focus = evDelay('focus');
  const e = evGait();
  const alex = alexDelay();
  const count = (st) => list.filter((d) => d.status === st).length;
  // "5 inform the app · 2 set aside": none of them feeds the score (its weights are Mei et al. 2022)
  // (no-break spaces keep each count with its words on a narrow phone)
  const MIX = { used: (n) => (n === 1 ? 'informs the app' : 'inform the app'), 'not-useful': () => 'set aside' };
  const mix = Object.keys(STATUS).filter((st) => count(st)).map((st) => `${count(st)} ${MIX[st] ? MIX[st](count(st)) : STATUS[st].label.toLowerCase()}`).join(' · ');
  const stats = [
    { v: String(list.length), unit: '', l: 'Datasets reviewed', s: mix },
    focus && { v: num1(focus.medianMonths), unit: 'mo', l: 'Median wait to diagnosis', s: `From first symptom. ALS Focus, ${focus.n} people; middle half ${num1(focus.iqrMonths?.[0])} to ${num1(focus.iqrMonths?.[1])} months` },
    e && e.stride && { v: f2(e.stride.alsVsControl.auc), unit: 'AUC', l: 'Stride time, ALS vs healthy', s: `${e.stride.alsVsControl.nAls} vs ${e.stride.alsVsControl.nOther} walkers. Best of ${e.g.features.length} features, so optimistic` },
    alex && { v: String(alex.months), unit: 'mo', l: 'Alex’s wait to diagnosis', s: `${fmtDate(alex.from)} to ${fmtDate(alex.to)}, from the case` },
  ].filter(Boolean);
  return `<section class="panel grid-bg ds-strip reveal" aria-label="Headline numbers">
    ${stats.map((x) => `<div class="ds-stat"><div class="micro">${esc(x.l)}</div><div class="stat">${esc(x.v)}${x.unit ? `<span class="stat-unit">${esc(x.unit)}</span>` : ''}</div><div class="ds-stat-s">${esc(x.s)}</div></div>`).join('')}
  </section>`;
}

function creditsHtml(list) {
  const physionet = list.some((d) => /physionet/i.test(d.source));
  const byNum = [...list].sort((a, b) => String(a.num).localeCompare(String(b.num)));
  return `<section class="section">
    <div class="section-head"><h2>Credits and terms</h2><span class="aside">Only summary figures appear in this app</span></div>
    <div class="list ds-credits">
      ${byNum.map((d) => `<div class="ds-credit"><span class="ds-num">${esc(d.num)}</span><div class="ds-credit-main"><div class="ds-credit-name">${esc(d.name)}</div>${d.cite ? `<div class="note">${esc(d.cite)}</div>` : ''}</div><div class="ds-credit-side"><span class="ds-lic">${esc(d.licence)}</span>${d.source ? extLink(d.source, hostOf(d.source)) : ''}</div></div>`).join('')}
      ${physionet ? `<div class="ds-credit"><span class="ds-num">+</span><div class="ds-credit-main"><div class="ds-credit-name">PhysioNet</div><div class="note">Pollard T, Moody BE, Lehman L, et al. PhysioNet as a global platform for biomedical research. Nature Health, 2026.</div></div><div class="ds-credit-side">${extLink('https://doi.org/10.1038/s44360-026-00096-z', 'doi.org')}</div></div>` : ''}
    </div>
    <p class="note ds-terms">ALS Focus and VOC-ALS files may not be passed on: each teammate downloads their own copy. Seattle is for non-commercial use only. None of the ${countWord(list.length).toLowerCase()} holds primary-care notes, so none can test the referral score itself; its weights come from Mei et al. 2022.</p>
  </section>`;
}

// Datasets whose terms forbid passing the files on (ALS Focus, VOC-ALS): only summaries appear here.
const NO_REDIST = /\bno (?:sharing|redistribution)\b/i;

function pageHtml(list) {
  const limits = arr(EVIDENCE && EVIDENCE.limits);
  const closed = list.filter((d) => NO_REDIST.test(d.licence)).length;
  const terms = closed ? `, ${countWord(closed).toLowerCase()} of them under no-redistribution terms (only summaries appear here)` : '';
  return `
    <header class="view-head reveal">
      <div class="micro dot">Method · ${list.length} datasets</div>
      <h1 class="title two-tone">${countWord(list.length)} ALS datasets shared for BioHacks. <span class="soft">What each one shows, and what the tool takes from it.</span></h1>
      <p class="lede">BioHacks shared ${countWord(list.length).toLowerCase()} research datasets${terms}. None holds primary-care notes, so none can test the referral score itself. Together they show how long people wait for a diagnosis, what is already visible during that wait, and which home checks are steady enough to track change.</p>
    </header>
    ${stripHtml(list)}
    <section class="section">
      <div class="section-head"><h2>The datasets</h2><span class="aside">${list.some((d) => d.live) ? 'From the team’s analysis' : 'Analysis running: early results shown where they exist'}</span></div>
      <div class="ds-grid">${gridCells(list)}</div>
    </section>
    ${chartsSection()}
    ${limits.length ? `<section class="section"><div class="section-head"><h2>Limits of the walking and delay results</h2><span class="aside">They apply to the two charts above</span></div><div class="list ds-limits">${limits.map((x) => `<div>${esc(x)}</div>`).join('')}</div></section>` : ''}
    ${creditsHtml(list)}`;
}

// ---------- mount ----------
export function mount(root) {
  ensureCss('css/views/datasets.css');
  const list = buildList();
  let open = null;
  root.innerHTML = pageHtml(list);
  const grid = root.querySelector('.ds-grid');
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver((entries) => { for (const e of entries) drawChart(e.target); }) : null;
  const drawAll = (scope) => scope.querySelectorAll('.ds-chart').forEach((h) => { drawChart(h); ro?.observe(h); });

  const cols = () => {
    const t = getComputedStyle(grid).gridTemplateColumns;
    return t && t !== 'none' ? t.split(' ').filter(Boolean).length : 1;
  };
  // Put the detail panel straight after the row that holds the open card.
  function place() {
    const panel = grid.querySelector('.ds-detail');
    if (!panel || !open) return;
    const cells = [...grid.querySelectorAll('.ds-cell')];
    const i = cells.findIndex((c) => c.querySelector(`[data-key="${CSS.escape(open)}"]`));
    if (i < 0) return;
    const c = cols();
    const end = Math.min(cells.length - 1, Math.floor(i / c) * c + c - 1);
    if (cells[end].nextElementSibling !== panel) cells[end].after(panel);
  }
  function setOpen(key, { focusPanel = false } = {}) {
    grid.querySelector('.ds-detail')?.remove();
    open = open === key ? null : key;
    grid.querySelectorAll('.ds-card').forEach((c) => {
      const on = c.dataset.key === open;
      c.classList.toggle('open', on);
      c.querySelector('.ds-toggle').setAttribute('aria-expanded', String(on));
    });
    if (!open) return;
    const d = list.find((x) => x.key === open);
    const panel = document.createElement('div');
    panel.innerHTML = detailHtml(d);
    const el = panel.firstElementChild;
    grid.appendChild(el);
    place();
    drawAll(el);
    el.querySelector('.ds-close').addEventListener('click', () => {
      const k = open;
      setOpen(k);
      grid.querySelector(`[data-key="${CSS.escape(k)}"] .ds-toggle`)?.focus();
    });
    const r = el.getBoundingClientRect();
    if (r.top < 0 || r.top > window.innerHeight - 120) el.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
    if (focusPanel) el.focus({ preventScroll: true });
  }

  grid.addEventListener('click', (e) => {
    const card = e.target.closest('.ds-card');
    if (!card || e.target.closest('a')) return;
    setOpen(card.dataset.key);
  });
  const onKey = (e) => {
    if (e.key === 'Escape' && open) {
      const k = open;
      setOpen(k);
      grid.querySelector(`[data-key="${CSS.escape(k)}"] .ds-toggle`)?.focus();
    }
  };
  let raf = 0;
  const onResize = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(place); };
  document.addEventListener('keydown', onKey);
  window.addEventListener('resize', onResize);
  drawAll(root);

  return {
    update() { /* nothing here depends on the visit, line or simulated switch */ },
    unmount() {
      ro?.disconnect();
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
      cancelAnimationFrame(raf);
    },
  };
}
