// Red-flag scoring engine. Pure functions, no DOM: runs in the browser and in Node.
// The number is plain arithmetic on published odds ratios; no AI model produces it.
import {
  FINDINGS, PRIOR, SOURCES, DEFAULT_REFERRAL_LINE, UNCLEAR_DEADLINE_WEEKS,
} from './weights.js';

export { FINDINGS, PRIOR, SOURCES, DEFAULT_REFERRAL_LINE, UNCLEAR_DEADLINE_WEEKS };

// ---------- home tests ----------
// mdc: minimal detectable change (the smallest drop bigger than normal test-to-test
// variation). Placeholders until the team measures its own (10 repeats each).
export const HOME_TESTS = {
  // MDCs until the team measures its own (docs/WEARABLES.md, "placeholder MDCs"). The old 6 taps, 15 wpm and 2 kg
  // would falsely flag about 21% to 33% of stable people per hand, and about 22% for reading, within 8 weekly tests.
  // Tapping: about 18 taps per 10 s, provisional, scaled by us from WatchALS's 20-s two-finger MDC95 (PMC13423962).
  tap_right: { label: 'Finger tapping, right hand', unit: 'taps in 10 s', region: 'arm', higherIsBetter: true, placeholderMdc: 18 },
  tap_left:  { label: 'Finger tapping, left hand',  unit: 'taps in 10 s', region: 'arm', higherIsBetter: true, placeholderMdc: 18 },
  walk:      { label: 'Walking test (phone motion sensor)', unit: 'stride-time variability, %', region: 'leg', higherIsBetter: false, placeholderMdc: 1.0 },
  // Reading: WatchALS weekly home MDC95, 31.3 wpm in controls (22.1 in ALS); this tool works before diagnosis.
  reading:   { label: 'Reading rate (fixed passage, same time of day)', unit: 'words per minute', region: 'bulbar', higherIsBetter: true, placeholderMdc: 31 },
  // Weight: MDC95 about 2.35 kg for single fasted weighings two weeks apart, computed by us from Bhutani 2017.
  weight:    { label: 'Body weight', unit: 'kg', region: 'general', higherIsBetter: true, placeholderMdc: 2.4 },
  gait_speed: { label: 'Walking speed, 10 m walk (phone motion sensors)', unit: 'm/s', region: 'leg', higherIsBetter: true, placeholderMdc: 0.28 },
};

// ---------- random numbers (seeded, so the same input always gives the same range) ----------
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function randn(rng) {
  let u = 0;
  while (u === 0) u = rng();
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
const Z975 = 1.959963984540054;

// ---------- the number ----------
// Draw the starting rate (log-uniform over its range) and each odds ratio
// (log-normal from its 95% CI) thousands of times; report the middle 95%.
// Memo for the default prior and table, which nothing changes at run time. A result depends only on the
// ids in their given order (the order decides which random draws each finding gets, so the key is not
// sorted), nSims and seed. Every caller gets its own copy, so nothing a caller does can change the cache.
// Without it, one top-bar click re-ran the 5,000-draw simulation for every visit (about 150 ms).
const SIM_CACHE = new Map();
const SIM_CACHE_MAX = 2000;
const copyRange = (r) => ({ ...r, ids: r.ids.slice() });

export function simulate(findingIds, { nSims = 5000, seed = 20261107, prior = PRIOR, table = FINDINGS } = {}) {
  const ids = [...new Set(findingIds)].filter((id) => table[id] && table[id].or != null);
  const key = prior === PRIOR && table === FINDINGS ? JSON.stringify([nSims, seed, ids]) : null;
  if (key !== null) {
    const hit = SIM_CACHE.get(key);
    if (hit) return copyRange(hit);
  }
  const result = simulateUncached(ids, nSims, seed, prior, table);
  if (key !== null) {
    if (SIM_CACHE.size >= SIM_CACHE_MAX) SIM_CACHE.clear();
    SIM_CACHE.set(key, copyRange(result));
  }
  return result;
}

function simulateUncached(ids, nSims, seed, prior, table) {
  const params = ids.map((id) => {
    const f = table[id];
    if (!(f.hi > f.lo)) return { mu: Math.log(f.or), sd: 0 };
    return { mu: Math.log(f.or), sd: (Math.log(f.hi) - Math.log(f.lo)) / (2 * Z975) };
  });
  const rng = mulberry32(seed);
  const lpLo = Math.log(prior.lo);
  const lpHi = Math.log(prior.hi);
  const draws = new Float64Array(nSims);
  for (let s = 0; s < nSims; s++) {
    const p0 = Math.exp(lpLo + (lpHi - lpLo) * rng());
    let logOdds = Math.log(p0 / (1 - p0));
    for (const { mu, sd } of params) logOdds += mu + sd * randn(rng);
    draws[s] = 1 / (1 + Math.exp(-logOdds));
  }
  draws.sort();
  const q = (p) => draws[Math.min(nSims - 1, Math.max(0, Math.round(p * (nSims - 1))))];
  // Point estimate: middle of the prior range (geometric mean) times the published ORs.
  const p0 = Math.sqrt(prior.lo * prior.hi);
  const orProduct = ids.reduce((acc, id) => acc * table[id].or, 1);
  const pointOdds = (p0 / (1 - p0)) * orProduct;
  return {
    ids,
    lo: q(0.025),
    median: q(0.5),
    hi: q(0.975),
    point: pointOdds / (1 + pointOdds),
    orProduct,
    nSims,
  };
}

export function tierFromRange(range, line) {
  if (range.lo > line) return 'high';
  if (range.hi < line) return 'low';
  return 'unclear';
}

// ---------- pattern rules: these go straight to an EMG referral ----------
export const RULES = [
  {
    id: 'split_hand',
    label: 'Split-hand pattern',
    why: 'Wasting of the thumb muscles together with the first dorsal interosseous, with the little-finger side spared, is rarely seen in diseases other than ALS. Carpal tunnel alone cannot explain it: the first dorsal interosseous is supplied by the ulnar nerve, not the median nerve that carpal tunnel compresses.',
    source: 'eisen2012',
    test: (st) => st.ids.has('split_hand'),
  },
  {
    id: 'two_territory',
    label: 'Wasting across two nerve territories in one hand',
    why: 'Carpal tunnel compresses only the median nerve. Wasting of the first dorsal interosseous (ulnar nerve) as well as the thumb muscles (median nerve) cannot come from it alone. Wasting across nerve territories is the core of the split-hand pattern seen in ALS, so the cause needs an EMG.',
    source: 'eisen2012',
    test: (st) => st.ids.has('two_territory_wasting'),
  },
  {
    id: 'unexplained_weakness',
    label: 'Look-alike ruled out, weakness still there',
    why: 'The test for the suspected look-alike came back normal, but objective weakness or wasting is still present. Something else is causing it, and the next step for every serious cause (ALS and its mimics) is the same: an EMG.',
    source: 'assumption',
    test: (st) => st.ids.has('mimic_test_normal') && (st.ids.has('wasting') || st.ids.has('focal_weakness') || st.ids.has('home_decline')),
  },
  {
    id: 'umn_lmn',
    label: 'Upper and lower motor neuron signs together',
    why: 'Brisk reflexes in a limb that is also weak, wasted or twitching are not what a trapped or damaged peripheral nerve produces. Upper plus lower motor neuron signs in the same body region are one of the Gold Coast routes to an ALS diagnosis, so this needs an EMG.',
    source: 'goldcoast2020',
    test: (st) => st.ids.has('umn_signs') && (st.ids.has('wasting') || st.ids.has('fasciculations') || st.ids.has('split_hand') || st.ids.has('two_territory_wasting')),
  },
  {
    id: 'unclear_with_decline',
    label: 'Unclear, and home tests confirm a decline',
    why: 'The weekly tests exist to settle an unclear case. A drop bigger than the test\'s normal variation, two weeks in a row, is the progression the diagnostic criteria look for ("progressive motor impairment"), so the case escalates now instead of waiting for week 8.',
    source: 'goldcoast2020',
    test: (st, ctx) => ctx.byNumber === 'unclear' && st.homeDeclines.length > 0,
  },
  {
    id: 'multi_region',
    label: 'Motor signs in two or more body regions',
    why: 'Weakness that spreads to a new body region over months is the core of how ALS is diagnosed (Gold Coast criteria: progressive motor impairment, with lower motor neuron signs in at least two body regions). A trapped nerve in the wrist never spreads to the leg.',
    source: 'goldcoast2020',
    test: (st) => st.motorRegions.size >= 2,
  },
];

// ---------- home-test decline ----------
// Baseline = mean of the first two results. A decline counts when the two most
// recent results are each worse than baseline by more than the test's MDC.
export function detectDecline(series, { mdc, higherIsBetter = true } = {}) {
  const pts = [...series].sort((a, b) => a.date.localeCompare(b.date));
  if (pts.length < 4 || !(mdc > 0)) return null;
  const baseline = (pts[0].value + pts[1].value) / 2;
  const worse = (v) => (higherIsBetter ? baseline - v : v - baseline);
  for (let i = 3; i < pts.length; i++) {
    if (worse(pts[i - 1].value) > mdc && worse(pts[i].value) > mdc) {
      return { date: pts[i].date, baseline, latest: pts[i].value, change: -worse(pts[i].value) * (higherIsBetter ? 1 : -1), mdc };
    }
  }
  return null;
}

const DAY = 86400000;
const toTime = (d) => Date.parse(d + 'T00:00:00Z');
const weeksBetween = (a, b) => (toTime(b) - toTime(a)) / (7 * DAY);

// Collect the evidence that exists on a given date.
// caseFile.encounters[].findings[]: { id, region?, quote }
// caseFile.homeTests[]: { date, test, value, simulated? }
export function stateAt(caseFile, asOf, opts = {}) {
  const exclude = opts.exclude || new Set();
  const windowStart = new Date(toTime(asOf) - (PRIOR.horizonYears * 365.25 * DAY)).toISOString().slice(0, 10);
  const instances = [];
  for (const enc of caseFile.encounters || []) {
    if (enc.date > asOf || enc.date < windowStart) continue;
    (enc.findings || []).forEach((f, k) => {
      const key = `${enc.id}:${f.id}:${k}`;
      if (exclude.has(key) || exclude.has(f.id)) return;
      instances.push({ key, id: f.id, region: f.region || FINDINGS[f.id]?.region || null, date: enc.date, quote: f.quote, encounterId: enc.id, setting: enc.setting, kind: 'note' });
    });
  }
  const homeDeclines = [];
  if (opts.includeHomeTests !== false) {
    const byTest = {};
    for (const h of caseFile.homeTests || []) {
      if (h.date > asOf) continue;
      (byTest[h.test] = byTest[h.test] || []).push(h);
    }
    for (const [test, series] of Object.entries(byTest)) {
      const meta = HOME_TESTS[test];
      if (!meta) continue;
      const mdc = (opts.mdc && opts.mdc[test]) || meta.placeholderMdc;
      const d = detectDecline(series, { mdc, higherIsBetter: meta.higherIsBetter });
      if (d) {
        const simulated = series.some((s) => s.simulated);
        const key = `home:${test}`;
        if (exclude.has(key) || exclude.has('home_decline')) continue;
        const inst = {
          key, id: 'home_decline', region: meta.region, date: d.date, kind: 'home', simulated, test,
          quote: `${meta.label}: baseline ${round1(d.baseline)}, latest ${round1(d.latest)} ${meta.unit} (normal variation ±${round1(mdc)}${opts.mdc && opts.mdc[test] ? ', measured' : ', placeholder'})${simulated ? ' [SIMULATED DATA]' : ''}`,
        };
        instances.push(inst);
        homeDeclines.push(inst);
      }
    }
  }
  const ids = new Set(instances.map((i) => i.id));
  const motorRegions = new Set(
    instances.filter((i) => FINDINGS[i.id]?.motor && ['arm', 'leg', 'bulbar', 'breathing'].includes(i.region)).map((i) => i.region),
  );
  return { asOf, instances, ids, motorRegions, homeDeclines };
}
const round1 = (x) => (Math.abs(x) < 10 ? Math.round(x * 100) / 100 : Math.round(x * 10) / 10); // 2 decimals below 10 (walking speed in m/s), 1 above

// ---------- one evaluation ----------
export function evaluateState(st, opts = {}) {
  const line = opts.referralLine ?? DEFAULT_REFERRAL_LINE;
  const range = simulate([...st.ids], { nSims: opts.nSims, seed: opts.seed });
  const byNumber = tierFromRange(range, line);
  const rulesFired = RULES.filter((r) => r.test(st, { byNumber })).map(({ test, ...r }) => r);
  let tier = rulesFired.length ? 'high' : byNumber;
  let reason = rulesFired.length
    ? `Pattern rule: ${rulesFired.map((r) => r.label).join('; ')}`
    : byNumber === 'high' ? 'The whole likelihood range is above the referral line'
    : byNumber === 'low' ? 'The whole likelihood range is below the referral line'
    : 'The likelihood range crosses the referral line';
  return { asOf: st.asOf, line, range, byNumber, rulesFired, tier, reason, state: st };
}

export const ACTIONS = {
  high: {
    doctor: 'Refer for EMG and neuromuscular assessment now. Keep home tests running while waiting; a worsening trend moves the referral up the queue.',
    patient: {
      headline: 'Your doctor is arranging a nerve and muscle test',
      next: 'A specialist test called an EMG checks how your nerves and muscles are working. It is the standard next step for weakness that has no clear cause yet. Keep doing your weekly check-ins while you wait; they help the specialist.',
    },
  },
  unclear: {
    doctor: 'Start weekly home tests for the affected region and order a nerve conduction study. Decide by week 8: escalate on a decline beyond normal variation or a new region; otherwise step down.',
    patient: {
      headline: 'We are tracking a change for a few weeks',
      next: 'For the next 8 weeks you will do a short check-in each week on your phone. At the end, your doctor will look at the trend with you and decide whether you need further tests.',
    },
  },
  low: {
    doctor: 'No neuromuscular workup now. Safety-net advice: return if weakness spreads, speech or swallowing changes, or muscles visibly shrink or twitch.',
    patient: {
      headline: 'Nothing more is needed right now',
      next: 'If the weakness spreads to another part of your body, if your speech or swallowing changes, or if you notice a muscle shrinking or twitching, book an appointment.',
    },
  },
};

// ---------- the timeline: evaluate at every encounter and home-test date ----------
// Carries the 8-week deadline for the unclear tier.
export function timeline(caseFile, opts = {}) {
  const dates = new Set((caseFile.encounters || []).map((e) => e.date));
  if (opts.includeHomeTests !== false) for (const h of caseFile.homeTests || []) dates.add(h.date);
  const sorted = [...dates].sort();
  const out = [];
  let unclearSince = null;
  for (const d of sorted) {
    const st = stateAt(caseFile, d, opts);
    const ev = evaluateState(st, opts);
    if (ev.tier === 'unclear') {
      unclearSince = unclearSince || d;
      const weeks = weeksBetween(unclearSince, d);
      ev.unclearSince = unclearSince;
      ev.weeksUnclear = weeks;
      // Step down only when home tests are actually in use and show no decline;
      // with them switched off there is no evidence either way, so stay unclear.
      if (weeks >= UNCLEAR_DEADLINE_WEEKS && opts.includeHomeTests !== false && st.homeDeclines.length === 0 && (caseFile.homeTests || []).some((h) => h.date <= d)) {
        ev.tier = 'low';
        ev.reason = `${UNCLEAR_DEADLINE_WEEKS}-week review: home tests show no decline beyond normal variation, so step down (and safety-net)`;
        ev.steppedDown = true;
      }
    } else {
      unclearSince = null;
    }
    ev.encounter = (caseFile.encounters || []).find((e) => e.date === d) || null;
    out.push(ev);
  }
  return out;
}

// Latest evaluation on or before a date.
export function evaluateAt(caseFile, asOf, opts = {}) {
  const tl = timeline(caseFile, opts).filter((e) => e.asOf <= asOf);
  return tl.length ? tl[tl.length - 1] : evaluateState(stateAt(caseFile, asOf, opts), opts);
}

// How much earlier the tool would have escalated than what actually happened.
// months: tool referral vs the first specialist visit (includes the waiting list).
// monthsVsReferral: tool referral vs the real referral (actual.referral), the fair
// comparison, because the waiting list after a referral applies either way.
export function monthsSaved(caseFile, opts = {}) {
  const tl = timeline(caseFile, opts);
  const firstHigh = tl.find((e) => e.tier === 'high');
  const a = caseFile.actual || {};
  const actual = a.firstNeuromuscular || a.firstNeurology || null;
  const referral = a.referral || null;
  const mo = (from, to) => Math.round(((toTime(to) - toTime(from)) / (30.4375 * DAY)) * 10) / 10;
  return {
    firstHigh: firstHigh ? firstHigh.asOf : null,
    actual,
    months: firstHigh && actual ? mo(firstHigh.asOf, actual) : null,
    referral,
    monthsVsReferral: firstHigh && referral ? mo(firstHigh.asOf, referral) : null,
  };
}

export function formatPct(p) {
  if (p == null || Number.isNaN(p)) return '–';
  const v = p * 100;
  // Never print 100% (or 0%): the model was not checked for calibration at the extremes.
  if (v >= 99.5) return '>99%';
  if (v < 0.001) return '<0.001%';
  if (v >= 10) return `${Math.round(v)}%`;
  if (v >= 1) return `${v.toFixed(1)}%`;
  if (v >= 0.1) return `${v.toFixed(2)}%`;
  return `${v.toFixed(3)}%`;
}
