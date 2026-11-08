// Pure flag logic for the phone walking test (motion/CONTRACT.md sections 6 and 7).
// No imports: the engine's detectDecline is passed in, so this file runs in the
// browser and in Node and never pulls in the app. It measures walking speed, not ALS.
//
// Extra exports beyond the contract (additive, nothing in the contract changes):
//   saveBlocker(walk)  plain-words reason a walk cannot be saved, or null
//   localDate(d), localTime(d)  local "YYYY-MM-DD" and "HH:MM", as app/js/hometests.js
//
// Choices the contract leaves open (also listed in the laptop builder's report):
// - makeRow's `walk` is the server's walk record ({ id, result: WalkResult, ... }).
//   A bare WalkResult also works (walkId is then null). `walk.source === 'file'` marks
//   an imported file; anything else is saved as source "phone-motion".
// - makeRow RETURNS NULL (never throws) for a walk that cannot be saved: ok false,
//   quality "poor", or no usable speed. saveBlocker(walk) says why.
// - trial counts existing non-calibration rows with the same test, person and date,
//   exactly like makeRecord in app/js/hometests.js.
// - A simulated walk (walk.simulated, result.simulated or recording.simulated true)
//   adds `simulated: true` to the row, the engine's own homeTests flag. The laptop page
//   labels such rows (gaitSeries `sim`). The app does NOT keep the label: its weeklySeries
//   drops `simulated` and `demoDate`, and realForCase writes simulated: false (review INT-2,
//   F1, F5). It reaches the app's Monitoring view only if the merge patch adds that edit.
// - gaitFlag's `latest` is the engine's decline.latest when flagged (the week that
//   completed the two-week drop, matching the engine's own quote), else the most
//   recent weekly value.

export const GAIT_TEST_ID = 'gait_speed';
export const GAIT_TEST = { label: 'Walking speed, 10 m walk (phone motion sensors)', unit: 'm/s', region: 'leg', higherIsBetter: true, placeholderMdc: 0.28 };
export const GAIT_MDC = { prediagnosis: 0.28, diagnosed: 0.18, source: 'WatchALS (JMIR Formative Research 2026): MDC95 0.284 m/s in controls and 0.179 m/s in ALS, weekly home 60-second walk, phone on a lower-back belt; approximate (the paper\'s table heading says %MDC95, which does not match its m/s values)' };
// Same range as gait.js MIN_WALK_SPEED and MAX_WALK_SPEED (speed_out_of_range).
const MIN_SPEED = 0.15;
const MAX_SPEED = 2.5;

const MIN_WEEKS = 4; // detectDecline: 2 baseline weeks plus 2 weeks to compare
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;
const pad2 = (n) => String(n).padStart(2, '0');
const finiteOrNull = (x) => (Number.isFinite(x) ? x : null);
const round2 = (x) => Math.round(x * 100) / 100;
const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : '–');

// Local calendar date and clock (not UTC: in the evening in Hamilton, UTC is already tomorrow).
export function localDate(d = new Date()) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
export function localTime(d = new Date()) { return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; }

// Adds GAIT_TEST under gait_speed if absent. Returns true only if it added it.
// Never overwrites an existing entry (after the merge the app defines its own).
export function ensureGaitTest(homeTests) {
  if (!homeTests || typeof homeTests !== 'object') return false;
  if (Object.prototype.hasOwnProperty.call(homeTests, GAIT_TEST_ID)) return false;
  try {
    homeTests[GAIT_TEST_ID] = { ...GAIT_TEST };
  } catch {
    return false; // a frozen test list: leave it alone
  }
  return Object.prototype.hasOwnProperty.call(homeTests, GAIT_TEST_ID);
}

function resultOf(walk) {
  if (!walk || typeof walk !== 'object') return null;
  if (walk.result && typeof walk.result === 'object') return walk.result;
  return 'ok' in walk ? walk : null; // a bare WalkResult
}

function isSimulated(walk) {
  if (!walk || typeof walk !== 'object') return false;
  const res = resultOf(walk);
  return walk.simulated === true || (res && res.simulated === true) || (walk.recording && walk.recording.simulated === true);
}

// Why a walk cannot be saved, in plain words, or null when it can.
export function saveBlocker(walk) {
  const res = resultOf(walk);
  if (!res) return 'There is no result to save.';
  if (res.ok !== true) return 'This walk gave no speed, so it cannot be saved. Read the notes and walk again.';
  if (res.quality === 'poor') return 'The recording was too poor to trust, so it cannot be saved. Read the notes and walk again.';
  if (!(Number.isFinite(res.speed_mps) && res.speed_mps > 0)) return 'This walk gave no speed, so it cannot be saved. Walk again.';
  // A walk from gait.js is already inside this range; this catches one sent by hand.
  if (res.speed_mps < MIN_SPEED || res.speed_mps > MAX_SPEED) return 'That speed is outside normal walking (0.15 to 2.5 m/s), so it cannot be saved. Walk again.';
  return null;
}

// One home-test row (contract section 6), or null when the walk cannot be saved.
export function makeRow(walk, { date, time, person = '', results = [], today } = {}) {
  if (saveBlocker(walk)) return null;
  const res = resultOf(walk);
  const now = new Date();
  const todayStr = typeof today === 'string' && DATE_RE.test(today) ? today : localDate(now);
  const day = typeof date === 'string' && DATE_RE.test(date) ? date : todayStr;
  const who = String(person ?? '').trim();
  const earlier = (Array.isArray(results) ? results : []).filter(
    (r) => r && !r.calibration && r.test === GAIT_TEST_ID && (r.person || '') === who && r.date === day,
  ).length;
  const row = {
    date: day,
    time: typeof time === 'string' && TIME_RE.test(time) ? time : localTime(now),
    test: GAIT_TEST_ID,
    value: round2(res.speed_mps),
    trial: earlier + 1,
    person: who,
    calibration: false,
    source: walk.source === 'file' ? 'file' : 'phone-motion',
    walkId: typeof walk.id === 'string' && walk.id ? walk.id : null,
    timing: res.timing ?? null,
    steps: finiteOrNull(res.steps),
    cadence: finiteOrNull(res.cadence_spm),
    distance_m: finiteOrNull(Number.isFinite(res.distance_m) ? res.distance_m : walk.distance_m),
    quality: res.quality ?? null,
  };
  if (isSimulated(walk)) row.simulated = true;
  if (day !== todayStr) row.demoDate = true;
  return row;
}

// Weekly means for one person: same-day rows are averaged (as weeklySeries in the app),
// calibration rows and other tests are left out. demo: any row that day has a demo date.
// sim: any row that day came from a simulated walk.
export function gaitSeries(results, person = '') {
  const who = String(person ?? '').trim();
  const byDate = new Map();
  for (const r of Array.isArray(results) ? results : []) {
    if (!r || r.calibration || r.test !== GAIT_TEST_ID || (r.person || '') !== who) continue;
    if (typeof r.date !== 'string' || !Number.isFinite(r.value)) continue;
    if (!byDate.has(r.date)) byDate.set(r.date, []);
    byDate.get(r.date).push(r);
  }
  return [...byDate]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, rows]) => ({
      date,
      value: rows.reduce((s, r) => s + r.value, 0) / rows.length,
      n: rows.length,
      demo: rows.some((r) => r.demoDate === true),
      sim: rows.some((r) => r.simulated === true),
    }));
}

// The engine's own decline rule applied to the walking series.
export function gaitFlag(series, { mdc = GAIT_MDC.prediagnosis, detectDecline } = {}) {
  if (typeof detectDecline !== 'function') throw new TypeError('gaitFlag needs the engine\'s detectDecline function.');
  const pts = (Array.isArray(series) ? series : [])
    .filter((p) => p && typeof p.date === 'string' && Number.isFinite(p.value))
    .sort((a, b) => a.date.localeCompare(b.date));
  const n = pts.length;
  const decline = detectDecline(pts, { mdc, higherIsBetter: GAIT_TEST.higherIsBetter }) || null;
  return {
    flagged: !!decline,
    decline,
    baseline: n >= 2 ? (pts[0].value + pts[1].value) / 2 : null,
    latest: decline ? decline.latest : n ? pts[n - 1].value : null,
    mdc,
    pointsNeeded: Math.max(0, MIN_WEEKS - n),
  };
}

// Plain words for the laptop page.
export function flagText(flag) {
  if (!flag) return 'No walking results yet.';
  if (flag.pointsNeeded > 0) return `Not enough weeks yet (need ${flag.pointsNeeded} more)`;
  if (flag.flagged) {
    return `FLAG: walking speed fell more than normal variation two weeks in a row (baseline ${f2(flag.baseline)} m/s, latest ${f2(flag.latest)} m/s, normal variation ±${f2(flag.mdc)} m/s)`;
  }
  return 'No drop beyond normal variation';
}
