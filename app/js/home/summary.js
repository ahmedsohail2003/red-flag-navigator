// "Your data by body region" for the Home plan view, as plain data. Pure functions, no
// DOM or storage: runs in the browser and in Node (tests/home-summary.test.mjs).
// No clinical numbers live here, except the published figures named beside two engine
// placeholders (PUBLISHED_MDC). Each kit test's and signal's MDC, direction and practice
// weeks come from the catalogue passed in (catalog.js). The older tests kept by
// hometests.js (rfn.homeResults) use the engine's HOME_TESTS: their MDC is the team's
// measured one when given, otherwise the engine's placeholder, and the row says so.
//
//   summarize({ results, legacyResults, samples, catalog, asOf, since, person, legacyPerson,
//               includeDemo, demo: { samples, results }, measuredMdc })
//     -> [{ region, rows: [row] }], regions in the order arm, leg, bulbar, breathing,
//        general, cognitive (any other region after them); a region with no data is left out.
//   row: { kind: 'test' | 'signal', id, label, unit, weekly, assessment, slope, chips, latest,
//          baseline } plus key, region, variant, decimals, higherIsBetter, feeds, mdc, mdcInfo,
//          mdcNote, practiceWeeks, practice, readings, minPerWeek, simulated, legacy, status,
//          weekly2 (blood pressure)
//     weekly: [{ week, value, n }]: series.toWeekly, the mean of the non-practice results for
//       a test (the best try for mpt and single_breath_count, whose catalogue entries keep
//       the best; the worst answer for a questionnaire, so a red flag is never averaged
//       away), the signal's own weekly.reduce for samples (bp: the top number; weekly2
//       holds the bottom number). A catalogue entry's weekly.reduce and minPerWeek win.
//       A questionnaire answer is never practice: it counts even if marked so.
//       latest: the last weekly value; baseline: series.baseline.
//     practiceWeeks: the weekly values left out before the baseline. The catalogue's
//       practice weeks are the first weeks a test was done at all, so a week of runs all
//       marked practice uses one up instead of pushing the baseline a week later.
//     assessment: series.assessDecline with the catalogue's mdc, higherIsBetter, practiceWeeks.
//     feeds: the catalogue entry's feeds ('engine-candidate', 'clinician-prompt', 'context'),
//       or null (the older tests). A 'context' row never says "decline" (statusOf).
//     mdcInfo: the catalogue's mdc ({ value, unit, population, text, source, ... }) or null.
//     mdcNote: '' (the catalogue's MDC, in the row's unit), 'relative' (a share of the
//       baseline), 'pending' (that share waits for the baseline), 'unit' (in another unit,
//       so not used), 'none', 'measured' (the team's own) or 'placeholder' (the engine's);
//       for the tapping and reading placeholders, that word and the published figure
//       ('placeholder; published: ...'), which the view prints as it is.
//     chips: ids from CHIP_WORDS. Simulated data never shares a row with the person's own.
//   statusOf(assessment, row) -> { code, word, detail, cls }  the status in words
//   checkThresholds(regions, thresholds) -> [{ threshold, met, value, values, row, reason }]
//   lastResult(results, test, { asOf, person }) and lastSample(samples, signal, { asOf, person })
//   dueState(lastDate, cadence, today) -> { due, word }
//   countAfter({ results, samples, asOf, person, includeDemo }) -> how many are after asOf
// Filters: only data on or before asOf counts (calendar dates, never shifted by time zone).
// since (YYYY-MM-DD), when given, drops the weekly values of the weeks before the one that
// holds it, so an imported history cannot set a baseline years before the visit (a test's
// practice weeks still count from its first run).
// person, when given, keeps the kit data saved for that person only; legacyPerson does the
// same for the older tests (a name typed on the Monitoring page; '' means no name).
// Demo data (simulated: true or source 'demo') counts only when includeDemo is true. So do
// the older tests' rows from a simulated walk or saved under a demo date (demoDate: true).
import { calendarDate, weekStart, toWeekly, baseline, assessDecline, slopePerMonth, percentChange } from './series.js';
import { HOME_TESTS } from '../engine.js';
import { fmtDate } from '../app/ui.js';

export const REGION_ORDER = ['arm', 'leg', 'bulbar', 'breathing', 'general', 'cognitive'];
export const CHIP_WORDS = Object.freeze({
  simulated: 'Simulated', // demo data
  imported: 'Imported', // from a device or a file
  entered: 'Entered', // a device reading typed in by hand
  real: 'Real', // a test done here
  context: 'Context only', // feeds is 'context': never counts toward the score
  experimental: 'Not validated', // our own timing tool
  assumption: 'Assumption', // a placeholder MDC, not yet measured
});
const BASELINE_WEEKS = 2;
// Tests whose catalogue instructions say "the app keeps the longest" (mpt) or "the highest"
// (single_breath_count): their MDCs come from the best of several tries, so a week's value
// is its best try, not the mean. A catalogue entry's own weekly.reduce wins over both.
const KEEP_BEST = { mpt: 'max', single_breath_count: 'max' };
const CONSECUTIVE = 2;
// Spellings that make an MDC a share of the baseline rather than a size in the measure's unit.
const RELATIVE = new Set(['%', 'percent', '% of baseline', 'percent of baseline', '% change']);
// Since 8 Nov the engine's default MDCs are the research figures (docs/WEARABLES.md), not the
// old 6 taps, 15 wpm and 2 kg. A row that uses a default names its source, so it is read as a
// sourced estimate that the team's own calibration replaces, not as measured noise.
const PUBLISHED_MDC = new Map([
  ['tap_right', 'default; provisional: about 18 taps per 10 s, scaled by us from WatchALS'],
  ['tap_left', 'default; provisional: about 18 taps per 10 s, scaled by us from WatchALS'],
  ['reading', 'default; WatchALS: 31 wpm in controls (22 in ALS)'],
  ['weight', 'default; about 2.4 kg, computed by us from Bhutani 2017'],
]);

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const isText = (x) => typeof x === 'string' && x.trim() !== '';
const list = (x) => (Array.isArray(x) ? x : []);
const norm = (u) => String(u ?? '').trim().toLowerCase();
// One spelling per unit, so a rule in "words a minute" matches data in "words per minute"
// (the catalogue and the engine spell the reading rate differently).
const unitKey = (u) => norm(u)
  .replace(/\s+(per|a|an)\s+/g, '/')
  .replace(/\s*\/\s*/g, '/')
  .replace(/\/(minutes?|mins?)$/, '/min')
  .replace(/\/(seconds?|secs?)$/, '/s')
  .replace(/\s+/g, ' ');
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const DAY_MS = 86400000;
const dayNumber = (d) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10))) / DAY_MS;

// ---------- which data counts ----------
const isSimulated = (x) => x.simulated === true || x.source === 'demo';
// The older tests: the gyro fork marks a simulated walk simulated: true, and a result saved
// under a date that was not that day demoDate: true. Neither is a real weekly history.
const isSimulatedLegacy = (r) => isSimulated(r) || r.demoDate === true;
const personOk = (x, person) => !isText(person) || x.person === person;
const legacyPersonOk = (r, who) => typeof who !== 'string' || (r.person || '') === who;
const cutOk = (date, asOf) => Boolean(date) && (!asOf || date <= asOf);
// from: the Monday of the since date's week, or null for no start.
const sinceOk = (date, from) => !from || (Boolean(date) && date >= from);
// A grip value (or any value) taken with one hand is kept apart from the other hand's.
const variantOf = (x) => (x.detail && (x.detail.hand === 'right' || x.detail.hand === 'left') ? x.detail.hand : null);

function sourceChip(source) {
  if (source === 'demo') return 'simulated';
  if (source === 'manual') return 'entered';
  return 'imported'; // apple-health, csv, csv:<format>, bluetooth
}

// Two copies of the same reading (demo data loaded into storage and shown from demo.js
// at once) count once. Samples: the same fields the store uses to spot a duplicate.
// Results: only simulated ones are matched; two real runs with the same value both count.
const sampleKey = (s) => JSON.stringify([s.signal, s.start, s.value, s.value2 ?? null, s.source]);
const resultKey = (r, i) => (isSimulated(r) ? JSON.stringify([r.test, r.date, r.time ?? null, r.value]) : `own:${i}`);
function unique(items, keyOf) {
  const seen = new Set();
  return items.filter((x, i) => {
    const k = keyOf(x, i);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function cleanResults(results, { asOf, person, includeDemo }) {
  return list(results).filter((r) => r && typeof r === 'object' && isText(r.test) && isNum(r.value)
    && cutOk(calendarDate(r.date), asOf) && personOk(r, person) && (includeDemo || !isSimulated(r)));
}
function cleanSamples(samples, { asOf, since, person, includeDemo }) {
  return list(samples).filter((s) => s && typeof s === 'object' && isText(s.signal) && isNum(s.value)
    && cutOk(calendarDate(s.start), asOf) && sinceOk(calendarDate(s.start), since) && personOk(s, person) && (includeDemo || !isSimulated(s)));
}

// ---------- the MDC in the measure's own unit ----------
// { value, note, chip? }: value is a number above 0, or null when nothing can be judged.
function mdcFor(entry, unit, base) {
  const m = entry && entry.mdc;
  if (!m || typeof m !== 'object' || !isNum(m.value) || !(m.value > 0)) return { value: null, note: 'none' };
  const mu = norm(m.unit);
  if (!mu || unitKey(mu) === unitKey(unit)) return { value: m.value, note: '' };
  if (RELATIVE.has(mu)) {
    // a share of the person's own baseline, so it exists once the baseline does
    return base && base.value !== 0 ? { value: (Math.abs(base.value) * m.value) / 100, note: 'relative' } : { value: null, note: 'pending' };
  }
  return { value: null, note: 'unit' };
}

const wholeOr = (v, d) => (Number.isInteger(v) && v >= 0 ? v : d);
function weeklyOf(points, reduce, minPerWeek) {
  try {
    return toWeekly(points, { reduce, minPerWeek });
  } catch {
    return toWeekly(points, { reduce: 'median', minPerWeek: 1 }); // an unknown reducer in the catalogue
  }
}

// The catalogue's practice weeks are the first weeks a test was done at all, practice runs
// included. A week of runs all marked practice uses one up: the person has already done
// the practice the catalogue asks for, so it is never counted twice.
function learningWeeks(items, practiceWeeks) {
  const n = wholeOr(practiceWeeks, 0);
  return new Set([...new Set(items.map((r) => weekStart(r.date)))].sort(byText).slice(0, n));
}

const higherIsBetterOf = (entry) => (typeof entry?.higherIsBetter === 'boolean' ? entry.higherIsBetter : true);

// A questionnaire's week is its worst answer (a fall, a breathing symptom), never a mean.
function reduceFor(id, entry) {
  if (entry?.weekly?.reduce) return entry.weekly.reduce;
  if (KEEP_BEST[id]) return KEEP_BEST[id];
  if (entry?.kind === 'questionnaire') return higherIsBetterOf(entry) ? 'min' : 'max';
  return 'mean';
}

// One row from a group of points that belong together. learning: a kit test's practice
// weeks (learningWeeks); without it, the catalogue's number of practice weeks.
function buildRow({ kind, id, variant, entry, unit, label, region, points, points2, reduce, minPerWeek, chips, simulated, legacy, mdcOverride, practice, learning }) {
  const higherIsBetter = higherIsBetterOf(entry);
  const weekly = weeklyOf(points, reduce, minPerWeek);
  // The learning weeks come first, so the weekly values inside them are the first ones.
  const practiceWeeks = legacy ? 0 : learning ? weekly.filter((w) => learning.has(w.week)).length : wholeOr(entry?.practiceWeeks, 0);
  const base = baseline(weekly, { practiceWeeks, baselineWeeks: BASELINE_WEEKS });
  const m = mdcOverride || mdcFor(entry, unit, base);
  const assessment = assessDecline(weekly, { mdc: m.value, higherIsBetter, practiceWeeks, baselineWeeks: BASELINE_WEEKS, consecutive: CONSECUTIVE });
  // A relative MDC waits for the baseline; until then the series is still building it.
  if (m.note === 'pending' && weekly.length) assessment.status = 'baseline';
  const row = {
    kind, id, label, unit,
    weekly,
    assessment,
    slope: slopePerMonth(weekly),
    chips: [...new Set(chips)],
    latest: weekly.length ? weekly[weekly.length - 1] : null,
    baseline: base,
    key: `${kind}:${id}${variant ? `:${variant}` : ''}${simulated ? ':sim' : ''}`,
    region, variant: variant || null,
    decimals: wholeOr(entry?.decimals, 1),
    higherIsBetter,
    feeds: isText(entry?.feeds) ? entry.feeds : null,
    mdc: m.value,
    mdcInfo: entry?.mdc && typeof entry.mdc === 'object' ? entry.mdc : null,
    mdcNote: m.note,
    practiceWeeks,
    practice,
    readings: points.length,
    minPerWeek: isNum(minPerWeek) ? minPerWeek : 1,
    simulated,
    legacy: Boolean(legacy),
  };
  if (points2 && points2.length) row.weekly2 = weeklyOf(points2, reduce, minPerWeek);
  row.status = statusOf(assessment, row);
  return row;
}

// ---------- the summary ----------
export function summarize(input = {}) {
  const {
    results, legacyResults, samples, catalog, asOf, since, person, legacyPerson, includeDemo = false, demo, measuredMdc,
  } = input || {};
  const TESTS = (catalog && catalog.TESTS) || {};
  const SIGNALS = (catalog && catalog.SIGNALS) || {};
  const cut = calendarDate(asOf) || null;
  // Whole weeks: the week that holds since stays whole. A since that is not a date is ignored.
  const from = weekStart(since);
  const keep = { asOf: cut, since: from, person, includeDemo: includeDemo === true };
  const withDemo = keep.includeDemo && demo && typeof demo === 'object';
  // Demo data from demo.js is for the case it was made for, so the person filter does not apply.
  const demoKeep = { ...keep, person: null };
  // Results are cut at since only after their practice weeks are found (below).
  const allResults = unique([
    ...cleanResults(results, keep),
    ...(withDemo ? cleanResults(demo.results, demoKeep).map((r) => ({ ...r, simulated: true })) : []),
  ], resultKey);
  const allSamples = unique([
    ...cleanSamples(samples, keep),
    ...(withDemo ? cleanSamples(demo.samples, demoKeep).map((s) => ({ ...s, simulated: true })) : []),
  ], sampleKey);
  const rows = [];

  // Kit tests: practice runs are counted but never part of a weekly value.
  const groups = new Map();
  for (const r of allResults) {
    const sim = isSimulated(r);
    const variant = variantOf(r);
    const k = `${r.test}|${variant || ''}|${sim}`;
    if (!groups.has(k)) groups.set(k, { id: r.test, variant, sim, items: [] });
    groups.get(k).items.push(r);
  }
  for (const g of groups.values()) {
    const entry = TESTS[g.id] || null;
    const learning = learningWeeks(g.items, entry?.practiceWeeks);
    const items = g.items.filter((r) => sinceOk(calendarDate(r.date), from));
    if (!items.length) continue;
    // A symptom answer is never practice, so a questionnaire marked practice still counts.
    const counted = entry?.kind === 'questionnaire' ? items : items.filter((r) => r.practice !== true);
    const chips = [g.sim ? 'simulated' : 'real'];
    if (entry?.feeds === 'context') chips.push('context');
    if (entry?.implementation === 'experimental') chips.push('experimental');
    rows.push(buildRow({
      kind: 'test', id: g.id, variant: g.variant, entry,
      unit: entry?.unit || items[0].unit || '',
      label: `${entry?.label || g.id}${g.variant ? `, ${g.variant} hand` : ''}`,
      region: entry?.region || 'general',
      points: counted.map((r) => ({ date: r.date, value: r.value })),
      reduce: reduceFor(g.id, entry),
      minPerWeek: isNum(entry?.weekly?.minPerWeek) ? entry.weekly.minPerWeek : 1,
      chips, simulated: g.sim, practice: items.length - counted.length, learning,
    }));
  }

  // The older tests (tapping, reading, weight, walking): calibration trials are repeats for
  // the team's noise measurement, not weekly results, so they are left out like practice.
  // Simulated walks and demo-dated results get their own row, shown only with demo data on.
  const legacy = new Map();
  for (const r of list(legacyResults)) {
    if (!r || typeof r !== 'object' || !isText(r.test) || !isNum(r.value) || r.calibration) continue;
    if (!HOME_TESTS[r.test] && !TESTS[r.test]) continue;
    const date = calendarDate(r.date);
    if (!cutOk(date, cut) || !sinceOk(date, from) || !legacyPersonOk(r, legacyPerson)) continue;
    const sim = isSimulatedLegacy(r);
    if (sim && !keep.includeDemo) continue;
    const k = `${r.test}|${sim}`;
    if (!legacy.has(k)) legacy.set(k, { id: r.test, sim, items: [] });
    legacy.get(k).items.push(r);
  }
  for (const { id, sim, items } of legacy.values()) {
    const meta = TESTS[id] || HOME_TESTS[id];
    const measured = measuredMdc && isNum(Number(measuredMdc[id])) && Number(measuredMdc[id]) > 0 ? Number(measuredMdc[id]) : null;
    const placeholder = isNum(meta.placeholderMdc) && meta.placeholderMdc > 0 ? meta.placeholderMdc : null;
    const fromCatalog = TESTS[id] ? mdcFor(TESTS[id], meta.unit, null) : null;
    const m = measured ? { value: measured, note: 'measured' } : fromCatalog && fromCatalog.value ? fromCatalog : { value: placeholder, note: placeholder ? 'placeholder' : 'none' };
    const chips = [sim ? 'simulated' : 'real'];
    if (m.note === 'placeholder') chips.push('assumption');
    // A default MDC names its source.
    const note = m.note === 'placeholder' && PUBLISHED_MDC.has(id) ? PUBLISHED_MDC.get(id) : m.note;
    rows.push(buildRow({
      kind: 'test', id, entry: meta, unit: meta.unit, label: meta.label, region: meta.region || 'general',
      points: items.map((r) => ({ date: r.date, value: r.value })),
      reduce: 'mean', minPerWeek: 1, chips, simulated: sim, legacy: true, mdcOverride: { value: m.value, note }, practice: 0,
    }));
  }

  // Signals: each catalogue signal's own weekly rule (median steps, summed falls, ...).
  const sgroups = new Map();
  for (const s of allSamples) {
    const sim = isSimulated(s);
    const variant = variantOf(s);
    const k = `${s.signal}|${variant || ''}|${sim}`;
    if (!sgroups.has(k)) sgroups.set(k, { id: s.signal, variant, sim, items: [] });
    sgroups.get(k).items.push(s);
  }
  for (const g of sgroups.values()) {
    const entry = SIGNALS[g.id] || null;
    const chips = g.sim ? ['simulated'] : g.items.map((s) => sourceChip(s.source));
    if (entry?.feeds === 'context') chips.push('context');
    if (entry?.implementation === 'experimental') chips.push('experimental');
    rows.push(buildRow({
      kind: 'signal', id: g.id, variant: g.variant, entry,
      unit: entry?.unit || g.items[0].unit || '',
      label: `${entry?.label || g.id}${g.variant ? `, ${g.variant} hand` : ''}`,
      region: entry?.region || 'general',
      points: g.items.map((s) => ({ start: s.start, value: s.value })),
      points2: g.items.filter((s) => isNum(s.value2)).map((s) => ({ start: s.start, value: s.value2 })),
      reduce: entry?.weekly?.reduce || 'median',
      minPerWeek: isNum(entry?.weekly?.minPerWeek) ? entry.weekly.minPerWeek : 1,
      chips, simulated: g.sim, practice: 0,
    }));
  }

  // Order: tests in catalogue order, then the older tests, then signals; own data first.
  const testOrder = [...Object.keys(TESTS), ...Object.keys(HOME_TESTS)];
  const signalOrder = Object.keys(SIGNALS);
  const rank = (r) => {
    const order = r.kind === 'test' ? testOrder : signalOrder;
    const i = order.indexOf(r.id);
    return [r.kind === 'test' ? 0 : 1, r.legacy ? 1 : 0, i < 0 ? order.length : i, r.id, r.variant || '', r.simulated ? 1 : 0];
  };
  const cmp = (a, b) => {
    const x = rank(a);
    const y = rank(b);
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
    return 0;
  };
  const regions = [...new Set(rows.map((r) => r.region))].sort((a, b) => {
    const i = REGION_ORDER.indexOf(a);
    const j = REGION_ORDER.indexOf(b);
    return (i < 0 ? REGION_ORDER.length : i) - (j < 0 ? REGION_ORDER.length : j) || byText(a, b);
  });
  return regions.map((region) => ({ region, rows: rows.filter((r) => r.region === region).sort(cmp) }));
}

// ---------- the status in words ----------
// Never colour alone: cls only picks the rail beside the words.
// A context-only measure (feeds 'context': blood pressure, heart rate, steps, ...) is never
// said to "decline": for some of them worse is a rise, and none is a sign of ALS on its own.
export function statusOf(a, row = {}) {
  const weeks = list(a && a.weekly ? a.weekly : row.weekly).length;
  const practiceWeeks = row.practiceWeeks || 0;
  const needBase = practiceWeeks + BASELINE_WEEKS;
  const needJudge = needBase + CONSECUTIVE;
  const status = a ? a.status : 'no-data';
  const decline = a && a.firstDecline ? fmtDate(a.firstDecline.week) : '';
  const context = row.feeds === 'context';
  switch (status) {
    case 'no-data':
      if (row.readings > 0 && row.minPerWeek > 1) {
        return {
          code: status, word: 'Too few readings per week yet',
          detail: `A week counts once it has ${row.minPerWeek} readings; ${row.readings} ${row.readings === 1 ? 'reading' : 'readings'} so far.`, cls: '',
        };
      }
      return row.practice > 0
        ? { code: status, word: 'Practice only so far', detail: `${row.practice} practice ${row.practice === 1 ? 'run' : 'runs'}, not counted in the baseline.`, cls: '' }
        : { code: status, word: 'No data yet', detail: '', cls: '' };
    case 'baseline':
      if (!a.baseline && a.baseline !== 0) {
        return {
          code: status, word: 'Baseline not set yet',
          detail: `${weeks} of ${needBase} weeks so far${practiceWeeks ? ` (${practiceWeeks === 1 ? 'the first is' : `the first ${practiceWeeks} are`} practice)` : ''}.`, cls: '',
        };
      }
      return { code: status, word: 'Baseline set, too early to judge', detail: `A change can count from week ${needJudge}; ${weeks} so far.`, cls: '' };
    case 'no-mdc': {
      const why = row.mdcNote === 'unit'
        ? 'The noise figure in the catalogue is in another unit, so no change is judged.'
        : 'No published noise figure yet, so no change is judged.';
      if (!a.baseline && a.baseline !== 0) {
        return { code: status, word: 'Baseline not set yet', detail: `${weeks} of ${needBase} weeks so far. ${why}`, cls: '' };
      }
      return { code: status, word: 'Not judged', detail: `${why} The baseline and trend are shown.`, cls: '' };
    }
    case 'decline':
      return context
        ? { code: status, word: 'Changed beyond normal variation two weeks running', detail: 'Context only: not a sign of ALS on its own; mention it to your doctor.', cls: 'once' }
        : { code: status, word: `Decline confirmed in the week of ${decline}`, detail: 'Two weeks in a row beyond normal variation. A reason to look sooner, not a diagnosis.', cls: 'decline' };
    case 'once':
      return {
        code: status, word: 'Beyond normal variation once',
        detail: context ? 'One more week like it would count as a change. Context only: not a sign of ALS on its own.' : 'One more week like it would confirm a decline.',
        cls: 'once',
      };
    case 'stable':
      if (!decline) return { code: status, word: 'Within normal variation', detail: '', cls: 'ok' };
      return {
        code: status, word: 'Within normal variation now',
        detail: context ? `It changed beyond normal variation in the week of ${decline}.` : `A decline was confirmed in the week of ${decline}.`,
        cls: 'ok',
      };
    default:
      return { code: String(status), word: 'Not judged', detail: '', cls: '' };
  }
}

// ---------- action thresholds after diagnosis ----------
// Each threshold is checked against every row of its test or signal (a simulated row too:
// the row says so). A rule with no when.kind checks tests and signals alike: weight saved
// on the Monitoring page is a test row, weight from a scale a signal row.
// when.consecutive (default 1): the last that many weekly values must all meet the rule, so
// a rule that says "has stayed" or "two weeks in a row" never fires on one week. A drop
// from baseline is judged only on the weeks after the baseline weeks.
// met: true, false, or null when it cannot be checked yet, with the reason. value: the
// latest week's figure (a drop: the percent below baseline); values: each figure checked.
export function checkThresholds(regions, thresholds) {
  const rows = list(regions).flatMap((g) => list(g && g.rows));
  const out = [];
  for (const t of list(thresholds)) {
    const w = t && t.when;
    if (!w || !isText(w.id)) { out.push({ threshold: t, met: null, value: null, values: [], row: null, reason: 'The rule is incomplete.' }); continue; }
    const mine = rows.filter((r) => r.id === w.id && (!w.kind || r.kind === w.kind));
    if (!mine.length) { out.push({ threshold: t, met: null, value: null, values: [], row: null, reason: 'No data for this yet.' }); continue; }
    for (const row of mine) out.push(checkRow(t, row));
  }
  return out;
}

const lastWeeks = (n) => (n === 1 ? 'the latest week' : `the last ${n} weeks`);

// One threshold against one row.
function checkRow(t, row) {
  const w = t.when;
  const need = Math.max(1, wholeOr(w.consecutive, 1));
  const weekly = list(row.weekly).length ? list(row.weekly) : row.latest ? [row.latest] : [];
  const latest = weekly.length ? weekly[weekly.length - 1].value : null;
  const one = { threshold: t, met: null, value: latest, values: [], row, reason: '' };
  if (!isNum(latest)) { one.reason = 'No weekly value yet.'; return one; }
  if (!isNum(w.value)) { one.reason = 'The rule has no number.'; return one; }
  let pool = weekly;
  let figure = (v) => v;
  let meets;
  if (w.rule === 'pctDropFromBaseline') {
    const base = row.baseline;
    if (!base || percentChange(base.value, latest) === null) { one.reason = 'Baseline not set yet.'; return one; }
    const end = list(base.weeks).slice(-1)[0];
    if (end) pool = weekly.filter((x) => x.week > end);
    if (!pool.length) { one.reason = 'No week after the baseline yet.'; return one; }
    figure = (v) => {
      const pct = percentChange(base.value, v);
      return pct === null ? null : -pct;
    };
    meets = (f) => f !== null && f >= w.value;
  } else if (['below', 'above', 'atLeast'].includes(w.rule)) {
    if (isText(w.unit) && unitKey(w.unit) !== unitKey(row.unit)) { one.reason = `The rule is in ${w.unit}, the data in ${row.unit}.`; return one; }
    meets = (f) => (w.rule === 'below' ? f < w.value : w.rule === 'above' ? f > w.value : f >= w.value);
  } else {
    one.reason = `Unknown rule "${String(w.rule)}".`;
    return one;
  }
  const values = pool.slice(-need).map((x) => figure(x.value));
  one.values = values;
  one.value = values[values.length - 1];
  let run = 0; // weeks in a row, back from the latest, that meet the rule
  for (let i = values.length - 1; i >= 0 && meets(values[i]); i--) run++;
  if (run >= need) one.met = true;
  else if (run < values.length) one.met = false; // a week inside the window misses the rule
  // else every week so far meets it, but there are fewer weeks than the rule needs: null
  if (run > 0 && run < need) one.reason = `Met in ${lastWeeks(run)}; the rule needs ${need} weeks in a row.`;
  return one;
}

// ---------- last done, and due or done ----------
function latestBy(items, timeOf) {
  let best = null;
  let bestT = '';
  for (const x of items) {
    const t = timeOf(x);
    if (t >= bestT) { best = x; bestT = t; }
  }
  return best;
}
// The latest result of a test, practice runs included (a practice run is still a run).
export function lastResult(results, test, { asOf, person, includeDemo = true } = {}) {
  const cut = calendarDate(asOf) || null;
  const mine = cleanResults(results, { asOf: cut, person, includeDemo }).filter((r) => r.test === test);
  return latestBy(mine, (r) => `${r.date}T${r.time || ''}`);
}
export function lastSample(samples, signal, { asOf, person, includeDemo = true } = {}) {
  const cut = calendarDate(asOf) || null;
  const mine = cleanSamples(samples, { asOf: cut, person, includeDemo }).filter((s) => s.signal === signal);
  return latestBy(mine, (s) => s.start);
}

// cadence: 'weekly' (this Monday to Sunday), 'every2weeks' (the last 14 days) or
// 'monthly' (this calendar month). today: YYYY-MM-DD.
export function dueState(lastDate, cadence, today) {
  const last = calendarDate(lastDate);
  const now = calendarDate(today);
  if (!last || !now) return { due: true, word: 'Due' };
  if (last > now) return { due: false, word: 'Done' };
  if (cadence === 'every2weeks') {
    return dayNumber(now) - dayNumber(last) < 14 ? { due: false, word: 'Done in the last 2 weeks' } : { due: true, word: 'Due' };
  }
  if (cadence === 'monthly') {
    return last.slice(0, 7) === now.slice(0, 7) ? { due: false, word: 'Done this month' } : { due: true, word: 'Due' };
  }
  return weekStart(last) === weekStart(now) ? { due: false, word: 'Done this week' } : { due: true, word: 'Due' };
}

// How much of the person's own data is dated after asOf (so the view can say it is hidden).
export function countAfter({ results, samples, asOf, person, includeDemo = false } = {}) {
  const cut = calendarDate(asOf);
  if (!cut) return 0;
  const later = (d) => Boolean(d) && d > cut;
  const r = list(results).filter((x) => x && personOk(x, person) && (includeDemo || !isSimulated(x)) && later(calendarDate(x.date))).length;
  const s = list(samples).filter((x) => x && personOk(x, person) && (includeDemo || !isSimulated(x)) && later(calendarDate(x.start))).length;
  return r + s;
}
