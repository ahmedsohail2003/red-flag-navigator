// Home data kept in this browser for the home monitoring kit: device samples and the
// results of active tests. Nothing leaves the device.
//
// Storage can be missing or refuse a write (private windows, sandboxed hosting, a
// full quota). Then that key's newest copy stays in memory for this visit, as in
// app/js/hometests.js, every later write retries it, and storageStatus() says so in
// plain words. Nothing touches storage until a function is called, so Node tests can
// import this file.
//
//   KEYS = { samples: 'rfn.home.samples', results: 'rfn.home.results' }
//   getSamples({ signal, person, source, simulated } = {}) -> samples, sorted by start
//   addSamples(samples) -> { added, skipped, duplicates, invalid }
//     skipped = duplicates + invalid. A duplicate has the same signal, start, value,
//     value2 and source as a stored sample (or one earlier in the same batch).
//   removeSamples({ source, signal, simulated, person }) -> how many were removed
//     (all criteria must match; with no criteria nothing is removed: use clearHomeData)
//   getResults({ test, person } = {}) -> results, sorted by date then time
//   addResult(result) -> the stored result with a new id, or { ok: false, reason }
//   removeResult(id) -> true if it was there
//   clearHomeData() removes both lists
//   subscribe(fn) -> unsubscribe(). fn({ key, external }) runs after every change made
//     here (external false) and on 'storage' events from other tabs (external true);
//     key is KEYS.samples, KEYS.results, or null when both changed.
//   storageStatus() -> { persistent, bytesUsed, warning? }
// Filters: undefined or null means any. A source without a colon also matches its
// formats, so { source: 'csv' } covers 'csv:withings'.
// Shapes follow the shared vocabulary (plans/home-monitoring-contracts.md). Only those
// fields are stored. A sample's value and value2 must be finite numbers (not text),
// its start and end YYYY-MM-DD or YYYY-MM-DDTHH:MM[:SS[.fraction]] with an optional Z
// or +HH:MM, and its end not before its start. A result's date is YYYY-MM-DD and its
// time HH:MM. Anything else is skipped (samples) or refused with a reason (results).
import { calendarDate } from './series.js';

export const KEYS = Object.freeze({ samples: 'rfn.home.samples', results: 'rfn.home.results' });
const PROBE = '__rfn_home_probe';
const WARNING = {
  blocked: "This browser is not letting the app save data on this device (its privacy settings can do this), so your home data lasts only until this page is closed or reloaded.",
  full: "This browser's storage for the app is full, so your newest home data is not saved and lasts only until this page is closed or reloaded. Removing an old device import may free enough space.",
  nearlyFull: "This browser's storage for the app is full, so new home data may not be saved. Removing an old device import may free enough space.",
};

// ---------- storage with a memory fallback ----------
// pending: the newest copy of each key that storage refused (null = removed). Reads
// prefer it and every write retries it, so one refused key never hides the other.
const pending = new Map();
const pendingWhy = new Map(); // key -> 'full' | 'blocked'

function storage() {
  // Even reading window.localStorage can throw (blocked cookies, sandboxed frames).
  try { return globalThis.localStorage ?? null; } catch { return null; }
}
const isQuotaError = (e) => e?.name === 'QuotaExceededError' || e?.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e?.code === 22 || e?.code === 1014;

// Keep going round while something gets saved: a smaller samples list saved now can
// make room for the results list that was refused a moment ago.
function flush() {
  const s = storage();
  let saved = true;
  while (pending.size && saved) {
    saved = false;
    for (const [k, v] of [...pending]) {
      if (!s) { pendingWhy.set(k, 'blocked'); continue; }
      try {
        if (v === null) s.removeItem(k);
        else s.setItem(k, v);
        pending.delete(k);
        pendingWhy.delete(k);
        saved = true;
      } catch (e) {
        pendingWhy.set(k, isQuotaError(e) ? 'full' : 'blocked');
      }
    }
  }
}
function lsGet(k) {
  if (pending.has(k)) return pending.get(k);
  const s = storage();
  if (!s) return null;
  try { return s.getItem(k); } catch { return null; }
}
function lsSet(k, v) {
  pending.set(k, v);
  flush();
}
function lsRemove(k) {
  if (storage()) {
    pending.set(k, null);
    flush();
  } else {
    pending.delete(k);
    pendingWhy.delete(k);
  }
}
// The last list read or written for each key, kept with the stored text it came from.
// While the text is unchanged, reads skip the JSON parse and the checks: a year of daily
// values for 30 signals is about a million characters, and a view reads it once per
// signal. A write from another tab changes the text, so it is read fresh. The cached
// list and its objects are never handed out or changed: callers get copies.
const parsed = new Map(); // key -> { raw, list }

// Unreadable or foreign data reads as an empty list instead of breaking the page.
function loadList(k, isValid) {
  const raw = lsGet(k);
  const hit = parsed.get(k);
  if (hit && hit.raw === raw) return hit.list;
  let list;
  try { list = JSON.parse(raw); } catch { list = null; }
  list = Array.isArray(list) ? list.filter(isValid) : [];
  parsed.set(k, { raw, list });
  return list;
}
// The list just written is remembered with its text, so the next read does not parse
// it again: after a big import that parse alone took over a second and a second copy
// of every sample.
function saveList(k, list) {
  const raw = JSON.stringify(list);
  lsSet(k, raw);
  parsed.set(k, { raw, list });
}

// ---------- shapes ----------
const has = (x) => x !== undefined && x !== null;
const isText = (x) => typeof x === 'string' && x.trim() !== '';
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const isIso = (x) => typeof x === 'string' && calendarDate(x) !== null;
const isDay = (x) => isIso(x) && x.length === 10;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// A copy that survives JSON, or undefined when there is nothing to keep. Throws on
// a circular object, so callers treat that as a broken row.
function jsonCopy(x) {
  const text = JSON.stringify(x);
  return text === undefined ? undefined : JSON.parse(text);
}
function detailOk(x) {
  if (x === undefined) return true;
  try { JSON.stringify(x); return true; } catch { return false; }
}
// Callers get copies, so changing a returned object never changes the stored list.
const copyOut = (x) => (x.detail !== null && typeof x.detail === 'object' ? { ...x, detail: jsonCopy(x.detail) } : { ...x });

// An end before its start is a broken row. The answer must not depend on the device's
// time zone, so nothing is read in it: two times with an offset (or Z) are compared as
// moments, two without as the clock times written, and a date with a time by the dates
// written. A time with an offset is never compared with one without (that would need a
// guess at the person's zone). Date.parse would read a time without an offset in this
// device's zone, so such a pair is read as if both were UTC instead.
const ZONED = /(?:Z|[+-]\d{2}:\d{2})$/;
function endsBeforeStart(start, end) {
  if (start.length === 10 || end.length === 10) return end.slice(0, 10) < start.slice(0, 10);
  const zoned = ZONED.test(start);
  if (zoned !== ZONED.test(end)) return false;
  const at = (x) => Date.parse(zoned ? x : `${x}Z`);
  return at(end) < at(start);
}

function sampleOk(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return false;
  if (!isText(s.signal) || !isIso(s.start) || !isNum(s.value) || !isText(s.unit) || !isText(s.source)) return false;
  if (has(s.end) && (!isIso(s.end) || endsBeforeStart(s.start, s.end))) return false;
  if (has(s.value2) && !isNum(s.value2)) return false;
  if (has(s.person) && !isText(s.person)) return false;
  if (has(s.simulated) && typeof s.simulated !== 'boolean') return false;
  return detailOk(s.detail);
}
function cleanSample(s) {
  const out = { signal: s.signal, start: s.start };
  if (has(s.end)) out.end = s.end;
  out.value = s.value;
  if (has(s.value2)) out.value2 = s.value2;
  out.unit = s.unit;
  out.source = s.source;
  if (has(s.person)) out.person = s.person;
  if (s.simulated === true) out.simulated = true;
  const detail = jsonCopy(s.detail);
  if (detail !== undefined) out.detail = detail;
  return out;
}
// What makes two samples the same reading (so importing an export twice adds nothing).
const sampleKey = (s) => JSON.stringify([s.signal, s.start, s.value, s.value2 ?? null, s.source]);

// Why a result cannot be stored, in words a patient understands, or '' if it is fine.
function resultProblem(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return 'There was no result to save.';
  if (!isText(r.test)) return 'The result does not say which test it came from, so it was not saved.';
  if (!isDay(r.date)) return 'The result does not have a valid date, so it was not saved.';
  if (has(r.time) && !(typeof r.time === 'string' && TIME.test(r.time))) return 'The result does not have a valid time of day, so it was not saved.';
  if (!isNum(r.value)) return 'The test did not produce a number, so there is nothing to save. Please try the test again.';
  if (!isText(r.unit)) return 'The result does not say what it was measured in, so it was not saved.';
  if (has(r.person) && !isText(r.person)) return 'The name on the result is not valid, so it was not saved.';
  if (has(r.simulated) && typeof r.simulated !== 'boolean') return 'The result is not clearly marked as real or simulated, so it was not saved.';
  if (has(r.practice) && typeof r.practice !== 'boolean') return 'The result is not clearly marked as practice or not, so it was not saved.';
  if (!detailOk(r.detail)) return 'The extra details of the result could not be saved.';
  return '';
}
const storedResultOk = (r) => !resultProblem(r) && isText(r.id);

function sourceMatches(have, want) {
  if (have === want) return true;
  // 'csv' also covers 'csv:withings'; 'csv:withings' matches only itself
  return typeof want === 'string' && !want.includes(':') && typeof have === 'string' && have.startsWith(`${want}:`);
}
function matches(x, f) {
  if (has(f.signal) && x.signal !== f.signal) return false;
  if (has(f.test) && x.test !== f.test) return false;
  if (has(f.person) && x.person !== f.person) return false;
  if (has(f.source) && !sourceMatches(x.source, f.source)) return false;
  if (has(f.simulated) && Boolean(x.simulated) !== Boolean(f.simulated)) return false;
  return true;
}

function newId() {
  // randomUUID exists only on secure pages (https or localhost); fall back elsewhere.
  try {
    if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  } catch { /* fall through */ }
  return `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// ---------- samples ----------
export function getSamples(filter = {}) {
  const { signal, person, source, simulated } = filter ?? {};
  const f = { signal, person, source, simulated };
  return loadList(KEYS.samples, sampleOk)
    .filter((s) => matches(s, f))
    .map(copyOut)
    .sort((a, b) => byText(a.start, b.start));
}

export function addSamples(samples) {
  const incoming = Array.isArray(samples) ? samples : has(samples) ? [samples] : [];
  const list = [...loadList(KEYS.samples, sampleOk)];
  const seen = new Set(list.map(sampleKey));
  let added = 0;
  let duplicates = 0;
  let invalid = 0;
  for (const raw of incoming) {
    if (!sampleOk(raw)) { invalid += 1; continue; }
    const s = cleanSample(raw);
    const k = sampleKey(s);
    if (seen.has(k)) { duplicates += 1; continue; }
    seen.add(k);
    list.push(s);
    added += 1;
  }
  if (added) {
    saveList(KEYS.samples, list);
    notify(KEYS.samples);
  }
  return { added, skipped: duplicates + invalid, duplicates, invalid };
}

export function removeSamples(criteria = {}) {
  const { source, signal, simulated, person } = criteria ?? {};
  const f = { source, signal, simulated, person };
  // No criteria would mean "everything": that is clearHomeData's job, asked for by name.
  if (!Object.values(f).some(has)) return 0;
  const list = loadList(KEYS.samples, sampleOk);
  const keep = list.filter((s) => !matches(s, f));
  if (keep.length === list.length) return 0;
  saveList(KEYS.samples, keep);
  notify(KEYS.samples);
  return list.length - keep.length;
}

// ---------- results ----------
export function getResults(filter = {}) {
  const { test, person } = filter ?? {};
  const f = { test, person };
  return loadList(KEYS.results, storedResultOk)
    .filter((r) => matches(r, f))
    .map(copyOut)
    .sort((a, b) => byText(a.date, b.date) || byText(a.time ?? '', b.time ?? ''));
}

export function addResult(result) {
  const reason = resultProblem(result);
  if (reason) return { ok: false, reason };
  const list = [...loadList(KEYS.results, storedResultOk)];
  const ids = new Set(list.map((r) => r.id));
  let id = newId();
  while (ids.has(id)) id = newId();
  const r = { id, test: result.test, date: result.date };
  if (has(result.time)) r.time = result.time;
  r.value = result.value;
  r.unit = result.unit;
  const detail = jsonCopy(result.detail);
  if (detail !== undefined) r.detail = detail;
  if (has(result.person)) r.person = result.person;
  if (result.simulated === true) r.simulated = true;
  if (result.practice === true) r.practice = true;
  list.push(r);
  saveList(KEYS.results, list);
  notify(KEYS.results);
  return copyOut(r); // r stays in the remembered list, so the caller gets a copy to change
}

export function removeResult(id) {
  const list = loadList(KEYS.results, storedResultOk);
  const keep = list.filter((r) => r.id !== id);
  if (keep.length === list.length) return false;
  saveList(KEYS.results, keep);
  notify(KEYS.results);
  return true;
}

export function clearHomeData() {
  // A change is something a reader would see: two empty lists stay empty.
  const had = loadList(KEYS.samples, sampleOk).length > 0 || loadList(KEYS.results, storedResultOk).length > 0;
  lsRemove(KEYS.samples);
  lsRemove(KEYS.results);
  if (had) notify(null);
}

// ---------- change notifications ----------
const listeners = new Set();
let detachStorage = null;

function notify(key, external = false) {
  for (const entry of [...listeners]) {
    // One broken listener must not stop the others, or the change that was saved.
    try { entry.fn({ key, external }); } catch (e) { console.error('A home data listener failed:', e); }
  }
}
function onStorage(e) {
  const key = e?.key;
  if (key !== null && key !== KEYS.samples && key !== KEYS.results) return; // null: storage was cleared
  const s = storage();
  if (e.storageArea && s && e.storageArea !== s) return; // a sessionStorage change
  notify(key, true);
}

export function subscribe(fn) {
  if (typeof fn !== 'function') return () => {};
  const entry = { fn };
  listeners.add(entry);
  // Listen for other tabs only while someone is subscribed (and only where there is a window).
  const g = globalThis;
  if (!detachStorage && typeof g.addEventListener === 'function' && typeof g.removeEventListener === 'function') {
    const remove = g.removeEventListener;
    g.addEventListener('storage', onStorage);
    detachStorage = () => remove.call(g, 'storage', onStorage);
  }
  return () => {
    listeners.delete(entry);
    if (!listeners.size && detachStorage) {
      detachStorage();
      detachStorage = null;
    }
  };
}

// ---------- status ----------
// persistent: everything is saved on this device and storage accepts writes.
// bytesUsed: about 2 bytes per character of the two lists and their keys (browsers
// keep strings as UTF-16), counting whatever is held in memory too.
export function storageStatus() {
  flush(); // space may have been freed since storage last refused a write
  let bytesUsed = 0;
  for (const k of Object.values(KEYS)) {
    const v = lsGet(k);
    if (v !== null && v !== undefined) bytesUsed += 2 * (k.length + String(v).length);
  }
  const s = storage();
  let state = s ? 'ok' : 'blocked';
  if (s) {
    try {
      s.setItem(PROBE, '1');
      s.removeItem(PROBE);
    } catch (e) {
      state = isQuotaError(e) ? 'full' : 'blocked';
    }
  }
  if (state === 'blocked') return { persistent: false, bytesUsed, warning: WARNING.blocked };
  if (pending.size) {
    const full = [...pendingWhy.values()].includes('full');
    return { persistent: false, bytesUsed, warning: full ? WARNING.full : WARNING.blocked };
  }
  if (state === 'full') return { persistent: true, bytesUsed, warning: WARNING.nearlyFull };
  return { persistent: true, bytesUsed };
}
