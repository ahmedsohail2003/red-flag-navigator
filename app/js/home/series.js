// Weekly values and the decline rule for the home monitoring kit (everything outside
// the gyros). Pure functions, no DOM or storage: runs in the browser and in Node.
// No clinical numbers live here: each signal's MDC comes from the caller (catalog.js).
//
// Dates: a YYYY-MM-DD string is a calendar date, never shifted by time zone. A full
// ISO time (that date, then THH:MM[:SS[.fraction]] and an optional Z or +HH:MM)
// counts on the date written in it ("2026-11-08T23:30-05:00" is 8 November wherever
// this runs), so write times with the person's own UTC offset. Weeks start on Monday.
//
//   calendarDate(dateOrIso) -> 'YYYY-MM-DD' | null   (a Date counts in local time)
//   weekStart(dateOrIso) -> 'YYYY-MM-DD' of that week's Monday | null
//   toDaily(points, { reduce = 'median' }) -> [{ date, value, n }]
//   toWeekly(points, { reduce = 'median', minPerWeek = 1 }) -> [{ week, value, n }]
//     points: [{ date | start, value }]; reduce: median, mean, sum, min, max or last
//     (last = latest time written). Rows without a valid ISO date string or a finite
//     number are skipped; toWeekly drops weeks with fewer than minPerWeek points.
//   baseline(weekly, { practiceWeeks = 0, baselineWeeks = 2 }) -> { value, weeks } | null
//     value: mean of the first baselineWeeks weeks after practiceWeeks; weeks: their ids
//   assessDecline(weekly, { mdc, higherIsBetter = true, practiceWeeks = 0, baselineWeeks = 2, consecutive = 2 })
//     -> { status, baseline, latest, change, worse, mdc, firstDecline, current }
//   slopePerMonth(weekly) -> least-squares slope in units per 30.4375 days | null
//   percentChange(from, to) -> percent | null (from 0, not finite, or an overflowing answer)
// weekly: [{ week | date | start, value }] in any order (toWeekly's output fits).

const DAY_MS = 86400000;
const DAYS_PER_MONTH = 30.4375; // 365.25 / 12
const REDUCERS = ['median', 'mean', 'sum', 'min', 'max', 'last'];

// ---------- dates ----------
// YYYY-MM-DD, then optionally THH:MM[:SS[.fraction]] and Z or +HH:MM (ISO 8601 extended).
const ISO = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-](\d{2}):(\d{2}))?)?$/;
const pad = (n, width = 2) => String(n).padStart(width, '0');

export function calendarDate(dateOrIso) {
  if (dateOrIso instanceof Date) {
    if (Number.isNaN(dateOrIso.getTime())) return null;
    return calendarDate(`${pad(dateOrIso.getFullYear(), 4)}-${pad(dateOrIso.getMonth() + 1)}-${pad(dateOrIso.getDate())}`);
  }
  const m = typeof dateOrIso === 'string' ? ISO.exec(dateOrIso) : null;
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  // Day 0 of the next month is the last day of this one. A year below 1000 is a typo here.
  if (y < 1000 || mo < 1 || mo > 12 || d < 1 || d > new Date(Date.UTC(y, mo, 0)).getUTCDate()) return null;
  if (m[4] !== undefined && (Number(m[4]) > 23 || Number(m[5]) > 59 || Number(m[6] ?? 0) > 59)) return null;
  if (m[7] !== undefined && (Number(m[7]) > 23 || Number(m[8]) > 59)) return null;
  return dateOrIso.slice(0, 10);
}

// Whole days since 1970-01-01 for a valid YYYY-MM-DD, and back. UTC arithmetic, so
// daylight-saving changes never add or lose a day.
const dayNumber = (date) => Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) / DAY_MS;
function fromDayNumber(n) {
  const d = new Date(n * DAY_MS);
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
// 1970-01-01 was a Thursday, so (day + 3) mod 7 is the number of days since Monday.
function mondayOf(date) {
  const n = dayNumber(date);
  return fromDayNumber(n - ((((n + 3) % 7) + 7) % 7));
}

export function weekStart(dateOrIso) {
  const date = calendarDate(dateOrIso);
  return date ? mondayOf(date) : null;
}

// ---------- points ----------
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const dateOf = (p) => p.date ?? p.start;
const weekOf = (p) => p.week ?? p.date ?? p.start;

// Usable points in time order: an ISO date string and a finite number. NaN, numbers
// written as text, bad dates and empty rows are skipped. The sort is stable, so
// points with the same time keep the order they were given in.
function usable(points, timeOf) {
  const rows = [];
  for (const p of Array.isArray(points) ? points : []) {
    const t = p && typeof p === 'object' ? timeOf(p) : undefined;
    const date = typeof t === 'string' ? calendarDate(t) : null;
    if (date && isNum(p.value)) rows.push({ t, date, value: p.value });
  }
  return rows.sort((a, b) => byText(a.t, b.t));
}

// Left to right, then divided by the caller: the same arithmetic as detectDecline in
// engine.js, so a value sitting exactly on baseline - MDC is judged the same way.
function sumOf(vs) {
  let s = vs[0];
  for (let i = 1; i < vs.length; i++) s += vs[i];
  return s;
}

function reduceValues(vs, how) {
  if (how === 'median') {
    const s = [...vs].sort((a, b) => a - b);
    const h = s.length >> 1;
    return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
  }
  if (how === 'mean') return sumOf(vs) / vs.length;
  if (how === 'sum') return sumOf(vs);
  // A loop, not Math.min(...vs): a week of heart-rate samples can be too many arguments.
  if (how === 'min') return vs.reduce((a, b) => (b < a ? b : a));
  if (how === 'max') return vs.reduce((a, b) => (b > a ? b : a));
  return vs[vs.length - 1]; // 'last': the values arrive in time order
}

// An unknown name is a mistake in the caller, so say so instead of guessing.
function reducerFrom(opts) {
  const how = opts?.reduce ?? 'median';
  if (!REDUCERS.includes(how)) throw new RangeError(`reduce must be one of ${REDUCERS.join(', ')}, not "${String(how)}"`);
  return how;
}

// rows are in time order and a day or week key never goes backwards in time, so the
// groups come out sorted. A day's rows sit together, so its key is worked out once:
// a year of heart-rate samples is over a million rows but only 365 days.
function grouped(rows, keyOf, how) {
  const groups = new Map();
  let day = null;
  let k = null;
  for (const r of rows) {
    if (r.date !== day) { day = r.date; k = keyOf(day); }
    const g = groups.get(k);
    if (g) g.push(r.value);
    else groups.set(k, [r.value]);
  }
  return [...groups].map(([key, vs]) => ({ key, value: reduceValues(vs, how), n: vs.length }));
}

export function toDaily(points, opts = {}) {
  const how = reducerFrom(opts);
  return grouped(usable(points, dateOf), (date) => date, how).map(({ key, value, n }) => ({ date: key, value, n }));
}

export function toWeekly(points, opts = {}) {
  const how = reducerFrom(opts);
  const minPerWeek = opts?.minPerWeek ?? 1;
  if (!isNum(minPerWeek)) throw new RangeError(`minPerWeek must be a number, not "${String(minPerWeek)}"`);
  return grouped(usable(points, dateOf), mondayOf, how)
    .filter((g) => g.n >= minPerWeek)
    .map(({ key, value, n }) => ({ week: key, value, n }));
}

// ---------- baseline and decline ----------
function wholeNumber(name, v, min) {
  if (!Number.isInteger(v) || v < min) throw new RangeError(`${name} must be a whole number of at least ${min}, not "${String(v)}"`);
  return v;
}

function baselineOf(rows, practiceWeeks, baselineWeeks) {
  if (rows.length < practiceWeeks + baselineWeeks) return null;
  const used = rows.slice(practiceWeeks, practiceWeeks + baselineWeeks);
  return { value: sumOf(used.map((r) => r.value)) / used.length, weeks: used.map((r) => r.t) };
}

// Practice weeks come first and are left out: people get better at a test while they
// learn it, so their first weeks understate their usual level.
export function baseline(weekly, opts = {}) {
  const practiceWeeks = wholeNumber('practiceWeeks', opts?.practiceWeeks ?? 0, 0);
  const baselineWeeks = wholeNumber('baselineWeeks', opts?.baselineWeeks ?? 2, 1);
  return baselineOf(usable(weekly, weekOf), practiceWeeks, baselineWeeks);
}

// The decline rule: after the practice and baseline weeks, `consecutive` weeks in a
// row, each worse than the baseline by more than the MDC (exactly the MDC is not
// enough). "In a row" means back-to-back weeks with data; weeks with no data are
// skipped, as in detectDecline (app/js/engine.js), which this matches for the
// default options.
//   status: 'no-data'  no usable weeks
//           'no-mdc'   mdc is null or undefined (the catalogue has none for this
//                      measure): baseline and change are reported, nothing is judged
//           'baseline' fewer than practiceWeeks + baselineWeeks + consecutive weeks
//           'decline'  the latest `consecutive` weeks are all beyond the MDC
//           'once'     the latest week is beyond the MDC, but the run is shorter than
//                      `consecutive` (with the default 2: only the latest week)
//           'stable'   otherwise
//   baseline: number | null; latest: the latest week's value; change = latest - baseline
//   worse: how much worse than baseline the latest week is (positive = worse), in units
//   change and worse stay null until a week after the baseline exists
//   firstDecline: { week, value } of the first week that completed a run, kept even
//   if the person later recovered; current: whether the latest weeks complete a run.
// mdc must be a number above 0 in the signal's own units, so a catalogue entry's
// mdc.value (after any conversion from a percentage) and not the entry itself.
export function assessDecline(weekly, opts = {}) {
  const o = opts ?? {};
  const mdc = o.mdc ?? null;
  if (mdc !== null && !(isNum(mdc) && mdc > 0)) {
    throw new RangeError(`mdc must be a number above 0 in the signal's own units, or null when none is known, not "${typeof mdc === 'object' ? 'an object' : String(mdc)}"`);
  }
  const higherIsBetter = o.higherIsBetter ?? true;
  if (typeof higherIsBetter !== 'boolean') throw new TypeError(`higherIsBetter must be true or false, not "${String(higherIsBetter)}"`);
  const practiceWeeks = wholeNumber('practiceWeeks', o.practiceWeeks ?? 0, 0);
  const baselineWeeks = wholeNumber('baselineWeeks', o.baselineWeeks ?? 2, 1);
  const consecutive = wholeNumber('consecutive', o.consecutive ?? 2, 1);

  const out = { status: 'no-data', baseline: null, latest: null, change: null, worse: null, mdc, firstDecline: null, current: false };
  const rows = usable(weekly, weekOf);
  if (!rows.length) return out;
  const first = practiceWeeks + baselineWeeks; // index of the first week compared with the baseline
  const base = baselineOf(rows, practiceWeeks, baselineWeeks);
  const latest = rows[rows.length - 1].value;
  out.latest = latest;
  // Positive = worse than baseline, written exactly as in detectDecline.
  const worse = (v) => (higherIsBetter ? base.value - v : v - base.value);
  if (base) {
    out.baseline = base.value;
    if (rows.length > first) {
      out.change = latest - base.value;
      out.worse = worse(latest);
    }
  }
  if (mdc === null) { out.status = 'no-mdc'; return out; }
  if (rows.length < first + consecutive) { out.status = 'baseline'; return out; }

  let run = 0; // weeks in a row, ending at week i, each beyond the MDC
  for (let i = first; i < rows.length; i++) {
    run = worse(rows[i].value) > mdc ? run + 1 : 0;
    if (run >= consecutive && !out.firstDecline) out.firstDecline = { week: rows[i].t, value: rows[i].value };
  }
  out.current = run >= consecutive;
  out.status = out.current ? 'decline' : run > 0 ? 'once' : 'stable';
  return out;
}

// ---------- trend ----------
// Days come from the dates themselves, so a missed week stretches the x axis
// instead of being squeezed out.
export function slopePerMonth(weekly) {
  const rows = usable(weekly, weekOf);
  if (rows.length < 3) return null;
  const xs = rows.map((r) => dayNumber(r.date));
  const mx = sumOf(xs) / xs.length;
  const my = sumOf(rows.map((r) => r.value)) / rows.length;
  let sxx = 0;
  let sxy = 0;
  rows.forEach((r, i) => {
    const dx = xs[i] - mx;
    sxx += dx * dx;
    sxy += dx * (r.value - my);
  });
  return sxx > 0 ? (sxy / sxx) * DAYS_PER_MONTH : null; // all on one date: no slope
}

// Relative to the size of `from`, so a rise is positive even from a negative start.
// A start so close to 0 that the answer overflows has no percent either.
export function percentChange(from, to) {
  if (!isNum(from) || !isNum(to) || from === 0) return null;
  const pct = ((to - from) / Math.abs(from)) * 100;
  return Number.isFinite(pct) ? pct : null;
}
