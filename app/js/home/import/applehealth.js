// Apple Health export (export.zip or export.xml) -> Samples. Reads the file as a stream, so a
// multi-gigabyte export never sits in memory whole. No DOM or storage: it runs in the browser,
// in a Web Worker and in Node.
//
//   importAppleHealth(fileOrBlob, { since, signals, onProgress, abortSignal })
//     -> Promise<{ ok: true, samples, counts, skipped, exportDate, warnings } | { ok: false, reason, aborted? }>
//   parseAppleHealthChunks(asyncIterableOfStrings, { since, signals, abortSignal })
//     -> the same result, from the text of export.xml cut into pieces of any size.
//   appleDateToIso('2024-05-01 08:00:00 -0400') -> '2024-05-01T08:00:00-04:00' (null if unreadable)
//   APPLE_HEALTH_TYPES: { [HealthKit type]: { signal, unit } }, every type this import reads.
//
//   since: 'YYYY-MM-DD' (compared with each record's own calendar date; steps with the day each
//     hour of steps falls on, and sleep with the date the night ends), or a Date, a time in
//     milliseconds or an ISO time (records that start before it are skipped, so the first day of
//     steps, heart rate and falls is then a part day). signals: one signal id or a list; default all.
//   onProgress(fraction 0 to 1): by bytes read. abortSignal: stops the import.
//   counts: readings found per signal, before any grouping (blood pressure: one per pair).
//   skipped: records and elements this import does not use, by HealthKit type or element name.
//
// What the real file looks like (checked on 2026-11-08 against open-source parsers' fixtures):
// - Attribute-only records, angle brackets in attributes written as entities, optional children:
//     <Record type="HKQuantityTypeIdentifierHeartRate" sourceName="Apple Watch" sourceVersion="4.3.1"
//      device="&lt;&lt;HKDevice: 0x282a45810&gt;, name:Apple Watch, ...&gt;" unit="count/min"
//      creationDate="2018-09-10 02:47:35 -0700" startDate="2018-09-10 02:28:55 -0700"
//      endDate="2018-09-10 02:28:55 -0700" value="72">
//      <MetadataEntry key="HKMetadataKeyHeartRateMotionContext" value="0"/>
//     </Record>
//   (github.com/dogsheep/healthkit-to-sqlite, tests/export.xml). Device names use curly
//   apostrophes, as in sourceName="Simon’s iPhone".
// - The DTD inside the file says: "Any Records that appear as children of a correlation also
//   appear as top-level records in this document" (github.com/tdda/applehealthdata,
//   testdata/export6s3sample.xml). So blood pressure readings come twice.
// - Percentages are fractions with unit "%" (0.27 means 27%); a metric export writes walking speed
//   in km/hr and step length in cm (rows from an iOS 17.4 export,
//   huggingface.co/datasets/Vinayagame/apple-health-sample).
// - The file name changes with the phone's language: eksport.xml (Norwegian) and exportar.xml
//   (Spanish, next to an English export_cda.xml) (healthkit-to-sqlite issue #11). So the zip is
//   searched by content, not only for "export.xml".
// - Since iOS 16, WorkoutStatistics repeats the startDate attribute (Apple Developer Forums
//   thread 714063), and export version 12 shipped a broken DTD (healthkit-to-sqlite issue #24).
//   Strict XML parsers reject both, so this module scans tags itself and never validates.
// - Steps come from the iPhone and the Apple Watch at the same time, and simple sums count them
//   twice (R-bloggers, "Apple Health Export Part I", 2020). See addSteps.
import { listZipEntries, openZipEntry } from './zip.js';

const SOURCE = 'apple-health';
const Q = 'HKQuantityTypeIdentifier';
const SLEEP_TYPE = 'HKCategoryTypeIdentifierSleepAnalysis';
const BP_CORRELATION = 'HKCorrelationTypeIdentifierBloodPressure';
// The asleep values, old and new; in bed and awake are not sleep.
const ASLEEP = new Set([
  'HKCategoryValueSleepAnalysisAsleep', // before iOS 16
  'HKCategoryValueSleepAnalysisAsleepUnspecified',
  'HKCategoryValueSleepAnalysisAsleepCore',
  'HKCategoryValueSleepAnalysisAsleepDeep',
  'HKCategoryValueSleepAnalysisAsleepREM',
]);
// Asleep stretches less than this apart are one night (a short wake-up does not split it).
const SLEEP_GAP_MS = 3 * 3600 * 1000;
const HOUR_MS = 3600 * 1000;
const MAX_PENDING = 1 << 20; // a tag still open after 1 MB of text is broken: skip it
// An export's <HealthData> comes right after its DTD, a few kilobytes in (2.5 KB in an export
// of version 3). With none in the first 4 MB, the file is something else (another XML file,
// a photo, a PDF), and is not read on.
const HEAD_LIMIT = 4 << 20;
const YIELD_EVERY_MS = 50; // let the page repaint while a big file is read

// ---------- units ----------
// Each converter returns the value in the Sample unit, null for a unit it does not know,
// or NaN for a value out of range.
const unitKey = (u) => (u == null ? '' : String(u).trim().toLowerCase());
// Lookups by text from the file use own keys only, so "constructor" or "__proto__" in a
// damaged file is an unknown name, not a built-in of every JavaScript object.
const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const byFactor = (table) => (v, unit) => {
  const key = unitKey(unit);
  return own(table, key) ? v * table[key] : null;
};
const toMetres = byFactor({ m: 1, cm: 0.01, mm: 0.001, km: 1000, in: 0.0254, ft: 0.3048, yd: 0.9144, mi: 1609.344 });
const toKg = byFactor({ kg: 1, g: 0.001, lb: 0.45359237, oz: 0.028349523125, st: 6.35029318 });
const toMetresPerSecond = byFactor({ 'm/s': 1, 'km/hr': 1000 / 3600, 'mi/hr': 1609.344 / 3600, 'ft/s': 0.3048 });
const toPerMinute = byFactor({ 'count/min': 1, 'count/s': 60, 'count/hr': 1 / 60 });
const toMs = byFactor({ ms: 1, s: 1000 });
const toMmHg = byFactor({ mmhg: 1, kpa: 1000 / 133.322387415 }); // 1 mmHg = 133.322387415 Pa
const toCount = (v, unit) => (unitKey(unit) === '' || unitKey(unit) === 'count' ? v : null);
const asReported = (v) => v;
function toCelsius(v, unit) {
  switch (unitKey(unit)) {
    case 'degc': return v;
    case 'degf': return ((v - 32) * 5) / 9;
    case 'k': return v - 273.15;
    default: return null;
  }
}
// Apple writes VO2 max as "mL/min·kg"; accept the other spellings of the same unit.
function toVo2(v, unit) {
  const u = unitKey(unit).replace(/[\s()*.\u00b7\u22c5]/g, '');
  return ['ml/minkg', 'ml/kgmin', 'ml/kg/min', 'ml/min/kg'].includes(u) ? v : null;
}
// HealthKit stores percentages as fractions (0.97 = 97%). A writer that stored 0 to 100 is
// kept as it is and counted, because no percentage here can exceed 100.
function toPercent(v, unit, st) {
  if (unitKey(unit) !== '%') return null;
  if (v >= 0 && v <= 1) return v * 100;
  if (v > 1 && v <= 100) {
    st.bad.percentAsIs++;
    return v;
  }
  return NaN;
}

// ---------- the types this import reads ----------
// kind: 'steps', 'daily-sum' and 'daily-median' become one Sample per calendar day (the high
// frequency types); 'bp' pairs two records; 'sleep' becomes minutes per night; anything else
// keeps one Sample per record, at most one per signal per hour.
const TYPES = {
  [`${Q}StepCount`]: { signal: 'steps', unit: 'steps', convert: toCount, kind: 'steps' },
  [`${Q}WalkingSpeed`]: { signal: 'walking_speed', unit: 'm/s', convert: toMetresPerSecond },
  [`${Q}WalkingStepLength`]: { signal: 'step_length', unit: 'm', convert: toMetres },
  [`${Q}WalkingDoubleSupportPercentage`]: { signal: 'double_support', unit: '%', convert: toPercent },
  [`${Q}WalkingAsymmetryPercentage`]: { signal: 'walking_asymmetry', unit: '%', convert: toPercent },
  [`${Q}AppleWalkingSteadiness`]: { signal: 'walking_steadiness', unit: '%', convert: toPercent },
  [`${Q}SixMinuteWalkTestDistance`]: { signal: 'six_minute_walk', unit: 'm', convert: toMetres },
  [`${Q}StairAscentSpeed`]: { signal: 'stair_ascent_speed', unit: 'm/s', convert: toMetresPerSecond },
  [`${Q}StairDescentSpeed`]: { signal: 'stair_descent_speed', unit: 'm/s', convert: toMetresPerSecond },
  [`${Q}NumberOfTimesFallen`]: { signal: 'falls', unit: 'count', convert: toCount, kind: 'daily-sum' },
  [`${Q}BodyMass`]: { signal: 'weight', unit: 'kg', convert: toKg },
  [`${Q}BodyFatPercentage`]: { signal: 'body_fat', unit: '%', convert: toPercent },
  [`${Q}LeanBodyMass`]: { signal: 'lean_mass', unit: 'kg', convert: toKg },
  [`${Q}HeartRate`]: { signal: 'heart_rate', unit: 'bpm', convert: toPerMinute, kind: 'daily-median' },
  [`${Q}RestingHeartRate`]: { signal: 'resting_hr', unit: 'bpm', convert: toPerMinute },
  [`${Q}HeartRateVariabilitySDNN`]: { signal: 'hrv_sdnn', unit: 'ms', convert: toMs },
  [`${Q}OxygenSaturation`]: { signal: 'spo2', unit: '%', convert: toPercent },
  [`${Q}RespiratoryRate`]: { signal: 'respiratory_rate', unit: 'breaths/min', convert: toPerMinute },
  [`${Q}BloodPressureSystolic`]: { signal: 'bp', unit: 'mmHg', convert: toMmHg, kind: 'bp', part: 'sys' },
  [`${Q}BloodPressureDiastolic`]: { signal: 'bp', unit: 'mmHg', convert: toMmHg, kind: 'bp', part: 'dia' },
  [`${Q}AppleSleepingWristTemperature`]: { signal: 'wrist_temp', unit: 'degC', convert: toCelsius },
  [`${Q}BodyTemperature`]: { signal: 'temperature', unit: 'degC', convert: toCelsius },
  [`${Q}VO2Max`]: { signal: 'vo2max', unit: 'mL/kg/min', convert: toVo2 },
  // "As the source reports it": value and unit pass through unchanged.
  [`${Q}AppleSleepingBreathingDisturbances`]: { signal: 'breathing_disturbances', unit: null, convert: asReported },
  [SLEEP_TYPE]: { signal: 'sleep_minutes', unit: 'min', kind: 'sleep' },
};

export const APPLE_HEALTH_TYPES = Object.freeze(Object.fromEntries(
  Object.entries(TYPES).map(([type, d]) => [type, Object.freeze({ signal: d.signal, unit: d.unit ?? 'as reported' })]),
));

// ---------- dates ----------
// Apple writes "2024-05-01 08:00:00 -0400": local wall-clock time plus its UTC offset.
const APPLE_DATE = /^(\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01]))[ T]((?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?)\s*(?:([+-])(\d{2}):?(\d{2})|(Z))?$/;
// Enough of a date to group by day and hour (the first 13 characters), checked fast.
const DATE_HEAD = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])[ T](?:[01]\d|2[0-3])/;

export function appleDateToIso(s) {
  if (typeof s !== 'string') return null;
  const m = APPLE_DATE.exec(s.trim());
  if (!m) return null;
  const [, date, time, sign, hh, mm, z] = m;
  const zone = z ? 'Z' : sign ? `${sign}${hh}:${mm}` : '';
  return `${date}T${time.length === 5 ? `${time}:00` : time}${zone}`;
}
// The record's own calendar day and hour, from its local wall-clock time: "2024-05-01T08".
const hourKey = (appleDate) => `${appleDate.slice(0, 10)}T${appleDate.slice(11, 13)}`;
const offsetMinutes = (iso) => {
  const m = /([+-])(\d{2}):(\d{2})$/.exec(iso);
  return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
};
// Milliseconds for an ISO time. A time without an offset (Apple always writes one) is read as
// the clock time written, as if it were UTC, so hours, days and durations never depend on the
// time zone of the device doing the import.
const instant = (iso) => (iso ? Date.parse(/(?:Z|[+-]\d{2}:\d{2})$/.test(iso) ? iso : `${iso}Z`) : NaN);

function parseSince(since) {
  if (since == null || since === '') return null;
  if (typeof since === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(since)) return { date: since };
  const ms = since instanceof Date ? since.getTime() : typeof since === 'number' ? since : Date.parse(since);
  return Number.isFinite(ms) ? { ms } : { invalid: String(since) };
}
function beforeSince(st, appleDate) {
  const f = st.since;
  if (!f || f.invalid) return false;
  if (f.date) return appleDate.slice(0, 10) < f.date;
  return instant(appleDateToIso(appleDate)) < f.ms;
}

// ---------- small helpers ----------
const round6 = (x) => Math.round(x * 1e6) / 1e6; // drop floating-point noise, keep the precision
// A piece of a long string can keep the whole string alive in V8 (a "sliced string"). Text kept
// for the whole import is copied first, so no chunk of the file stays in memory because of it.
const fresh = (s) => (s.length < 13 ? s : (` ${s}`).slice(1));
function sourceName(st, raw) {
  let name = st.names.get(raw);
  if (name === undefined) {
    name = fresh(decodeEntities(raw));
    st.names.set(fresh(raw), name);
  }
  return name;
}
const bump = (obj, key, n = 1) => { obj[key] = (own(obj, key) ? obj[key] : 0) + n; };
const sorted = (set) => [...set].sort();
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const typeLabel = (type) => type.replace(/^HK(Quantity|Category)TypeIdentifier/, '')
  .replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
function decodeEntities(v) {
  if (v.indexOf('&') < 0) return v;
  return v.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (whole, e) => {
    const k = e.toLowerCase();
    if (k[0] === '#') {
      const code = k[1] === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
      return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[k];
  });
}
function median(xs) {
  const s = Float64Array.from(xs).sort();
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// ---------- the tag scanner ----------
// Not a full XML parser on purpose (see the top of the file): it finds tags, keeps a stack of
// open elements, and reads attributes only on the tags it needs.
const NAME = /[A-Za-z_][\w.:-]*/y;
// The rest of a start tag up to its '>', stepping over quoted attribute values.
const TAG_REST = /[^"'>]*(?:(?:"[^"]*"|'[^']*')[^"'>]*)*>/y;
const ATTR = /([A-Za-z_][\w.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
const TYPE_ATTR = /\stype\s*=\s*(?:"([^"]*)"|'([^']*)')/;

function readAttrs(t) {
  const a = {};
  ATTR.lastIndex = 0;
  for (let m; (m = ATTR.exec(t));) a[m[1]] = m[2] !== undefined ? m[2] : m[3];
  return a;
}
function typeOf(t) {
  const m = TYPE_ATTR.exec(t);
  return m ? (m[1] !== undefined ? m[1] : m[2]) : '';
}

// Handles every complete construct in s; returns how much of s was used. The rest (an
// element cut in two by the chunk boundary) waits for the next chunk.
function scan(s, st, final) {
  const n = s.length;
  let i = 0;
  for (;;) {
    const lt = s.indexOf('<', i);
    if (lt < 0) return n;
    let end = -1; // index just past the construct, or -1 when it is not complete yet
    const c = s.charCodeAt(lt + 1);
    if (lt + 1 >= n) {
      end = -1;
    } else if (c === 47) { // '/': an end tag
      const gt = s.indexOf('>', lt + 2);
      if (gt >= 0) {
        endTag(st, s.slice(lt + 2, gt).trim());
        end = gt + 1;
      }
    } else if (c === 33) { // '!': a comment, CDATA or a declaration
      // Declarations, also those inside the DOCTYPE's [ ... ], are skipped one at a time, and the
      // closing "]>" is plain text. This copes with the broken DTD of export version 12, where an
      // ATTLIST lost its '>'.
      if (s.startsWith('<!--', lt)) {
        const k = s.indexOf('-->', lt + 4);
        end = k < 0 ? -1 : k + 3;
      } else if (s.startsWith('<![CDATA[', lt)) {
        const k = s.indexOf(']]>', lt + 9);
        end = k < 0 ? -1 : k + 3;
      } else if (n - lt >= 9 || final) {
        const gt = s.indexOf('>', lt);
        end = gt < 0 ? -1 : gt + 1;
      }
    } else if (c === 63) { // '?': a processing instruction such as <?xml ...?>
      const k = s.indexOf('?>', lt + 2);
      end = k < 0 ? -1 : k + 2;
    } else {
      NAME.lastIndex = lt + 1;
      const name = NAME.exec(s);
      if (!name) {
        end = lt + 1; // a stray '<' in text
      } else {
        TAG_REST.lastIndex = NAME.lastIndex;
        if (TAG_REST.exec(s)) {
          end = TAG_REST.lastIndex;
          const selfClosing = s.charCodeAt(end - 2) === 47;
          startTag(st, name[0], s.slice(NAME.lastIndex, selfClosing ? end - 2 : end - 1), selfClosing);
        }
      }
    }
    if (end >= 0) {
      i = end;
      continue;
    }
    // Not complete. Wait for more text, unless this is the end or the tag is clearly broken.
    if (final) return n; // finish() reports a file that stops before </HealthData>
    if (n - lt > MAX_PENDING) {
      st.bad.broken++;
      i = lt + 1;
      continue;
    }
    return lt;
  }
}

function startTag(st, name, t, selfClosing) {
  const parent = st.stack[st.stack.length - 1];
  if (name === 'Record') {
    if (parent === 'HealthData') onRecord(st, t, false);
    else if (parent === 'Correlation' && st.corr) onRecord(st, t, true);
    // Records anywhere else (none are known) are not read.
  } else if (parent === 'HealthData') {
    if (name === 'Correlation') {
      const type = typeOf(t);
      if (type === BP_CORRELATION) {
        if (!selfClosing) st.corr = true;
      } else {
        bump(st.skipped, type || 'Correlation');
      }
    } else if (name === 'ExportDate') {
      st.exportDate = appleDateToIso(decodeEntities(readAttrs(t).value || ''));
    } else if (name !== 'Me') {
      bump(st.skipped, name); // Workout, ActivitySummary, ClinicalRecord, Audiogram, ...
    }
  } else if (name === 'HealthData') {
    st.sawRoot = true;
  }
  if (!selfClosing) st.stack.push(name);
}

function endTag(st, name) {
  const at = st.stack.lastIndexOf(name);
  if (at < 0) return; // a stray end tag
  if (st.corr && st.stack.indexOf('Correlation') >= at) st.corr = false;
  st.stack.length = at;
}

// ---------- records ----------
function onRecord(st, t, corr) {
  const type = typeOf(t);
  const def = own(TYPES, type) ? TYPES[type] : undefined;
  if (!def) {
    if (!corr) bump(st.skipped, type || 'Record');
    return;
  }
  if (corr && def.kind !== 'bp') return; // correlation children repeat top-level records
  if (st.signals && !st.signals.has(def.signal)) return;
  const a = readAttrs(t);
  const start = a.startDate || '';
  const end = a.endDate || start;
  if (!DATE_HEAD.test(start) || !DATE_HEAD.test(end)) {
    st.bad.date++;
    return;
  }
  const source = sourceName(st, a.sourceName || 'unknown source');
  if (def.kind === 'sleep') {
    onSleep(st, a.value, start, end, source); // filtered by night, not by record
    return;
  }
  // Steps are shared out by hour first and kept by the day each hour falls on (addStepPiece),
  // so a walk that crosses midnight into the since date still counts on that date.
  const byHour = def.kind === 'steps' && st.since && st.since.date;
  if (byHour ? end.slice(0, 10) < st.since.date : beforeSince(st, start)) return;
  const text = a.value == null ? '' : a.value.trim();
  const raw = text === '' ? NaN : Number(text);
  if (!Number.isFinite(raw)) {
    st.bad.value++;
    return;
  }
  const unit = a.unit == null ? '' : decodeEntities(a.unit);
  const v = def.convert(raw, unit, st);
  if (v === null) {
    const u = st.badUnits.get(type) || { n: 0, units: new Set() };
    u.n++;
    u.units.add(fresh(unit || 'no unit')); // kept to the end: copies, see fresh
    st.badUnits.set(fresh(type), u);
    return;
  }
  if (!Number.isFinite(v)) {
    st.bad.value++;
    return;
  }
  if (def.kind === 'bp') {
    addBp(st, { part: def.part, value: v, start: fresh(start), end: fresh(end), source, fromCorrelation: corr });
    return;
  }
  bump(st.counts, def.signal);
  if (def.kind === 'steps') addSteps(st, start, end, v, source);
  else if (def.kind === 'daily-sum' || def.kind === 'daily-median') addDaily(st, def.signal, start, v, source);
  else addReading(st, def.signal, def.unit ?? (unit || 'count'), v, start, end, source);
}

// Steps: the iPhone and the watch count the same walk, and the Health app shows one total by
// merging the sources. Here each hour keeps the source with the most steps in that hour, and
// the hours are added up. A record that runs over several hours is shared out by time.
function addSteps(st, start, end, v, source) {
  if (start.slice(0, 13) === end.slice(0, 13)) {
    addStepPiece(st, hourKey(start), source, v);
    return;
  }
  const isoStart = appleDateToIso(start);
  const s = instant(isoStart);
  const e = instant(appleDateToIso(end));
  if (!(e > s) || e - s > 31 * 24 * HOUR_MS) {
    addStepPiece(st, hourKey(start), source, v); // no usable span: keep it in its first hour
    return;
  }
  const off = offsetMinutes(isoStart) * 60000; // local time = UTC + offset
  for (let t = s; t < e;) {
    const local = t + off;
    const next = Math.min(e, Math.floor(local / HOUR_MS) * HOUR_MS + HOUR_MS - off);
    addStepPiece(st, new Date(local).toISOString().slice(0, 13), source, (v * (next - t)) / (e - s));
    t = next;
  }
}
function addStepPiece(st, hour, source, v) {
  if (st.since && st.since.date && hour.slice(0, 10) < st.since.date) return;
  let bySource = st.steps.get(hour);
  if (!bySource) st.steps.set(hour, (bySource = new Map()));
  bySource.set(source, (bySource.get(source) || 0) + v);
}

function addDaily(st, signal, start, v, source) {
  const key = `${signal}|${start.slice(0, 10)}`;
  let day = st.daily.get(key);
  if (!day) st.daily.set(key, (day = { values: [], sources: new Set() }));
  day.values.push(v);
  day.sources.add(source);
}

// One Sample per record, but never more than one per signal per hour: readings in the same
// hour are averaged, which keeps storage small.
function addReading(st, signal, unit, v, start, end, source, v2) {
  const iso = appleDateToIso(start);
  const isoEnd = appleDateToIso(end) || iso;
  if (!iso) {
    st.bad.date++;
    return;
  }
  const key = `${signal}|${hourKey(start)}`;
  const r = st.readings.get(key);
  if (!r) {
    st.readings.set(key, { signal, unit, sum: v, sum2: v2 ?? 0, n: 1, start: iso, end: isoEnd, sources: new Set([source]) });
    return;
  }
  r.sum += v;
  r.sum2 += v2 ?? 0;
  r.n++;
  if (iso < r.start) r.start = iso;
  if (isoEnd > r.end) r.end = isoEnd;
  r.sources.add(source);
}

// ---------- blood pressure ----------
// The Health app writes each reading as a Correlation holding a systolic and a diastolic record,
// and writes the same two records again at the top level. Records are grouped by start time and
// source; a correlation's copy of a top-level record is dropped; the systolic and diastolic
// numbers left in each group are paired in order. (Readings with the same start time fall in the
// same hour and are averaged, so the pairing order cannot change the result.)
const bpKey = (rec) => `${rec.start}|${rec.source}`;
const sameValue = (a, b) => Math.abs(a - b) < 1e-9;
function addBp(st, rec) {
  const key = bpKey(rec);
  let g = st.bp.get(key);
  if (!g) st.bp.set(key, (g = { sys: [], dia: [] }));
  g[rec.part].push(rec);
}
// Each top-level record cancels one correlation copy with the same value.
function withoutCopies(list) {
  const top = list.filter((x) => !x.fromCorrelation);
  const unmatched = [...top];
  const kept = [...top];
  for (const x of list) {
    if (!x.fromCorrelation) continue;
    const i = unmatched.findIndex((y) => sameValue(y.value, x.value));
    if (i >= 0) unmatched.splice(i, 1);
    else kept.push(x); // only in the correlation
  }
  return kept;
}
function finishBp(st) {
  let unpaired = 0;
  for (const g of st.bp.values()) {
    const sys = withoutCopies(g.sys);
    const dia = withoutCopies(g.dia);
    const k = Math.min(sys.length, dia.length);
    for (let i = 0; i < k; i++) {
      bump(st.counts, 'bp');
      addReading(st, 'bp', 'mmHg', sys[i].value, sys[i].start, sys[i].end, sys[i].source, dia[i].value);
    }
    unpaired += sys.length + dia.length - 2 * k;
  }
  return unpaired;
}

// ---------- sleep ----------
function onSleep(st, value, start, end, source) {
  if (!ASLEEP.has(value)) return;
  const startIso = appleDateToIso(start);
  const endIso = appleDateToIso(end);
  const s = instant(startIso);
  const e = instant(endIso);
  if (!Number.isFinite(s) || !Number.isFinite(e)) {
    st.bad.date++;
    return;
  }
  if (e <= s) return; // no time asleep
  st.sleep.push({ s, e, startIso, endIso, source });
}
// Overlapping asleep records (two sources, or a source and its own stages) are merged first,
// so no minute is counted twice. Stretches less than SLEEP_GAP_MS apart form one night, and
// the night belongs to the calendar date it ends on, in the record's own time zone.
function finishSleep(st) {
  const pieces = [];
  for (const x of st.sleep.sort((p, q) => p.s - q.s || p.e - q.e)) {
    const last = pieces[pieces.length - 1];
    if (last && x.s <= last.e) {
      if (x.e > last.e) {
        last.e = x.e;
        last.endIso = x.endIso;
      }
      last.sources.add(x.source);
      last.records++;
    } else {
      pieces.push({ s: x.s, e: x.e, startIso: x.startIso, endIso: x.endIso, sources: new Set([x.source]), records: 1 });
    }
  }
  const nights = [];
  for (const p of pieces) {
    const cur = nights[nights.length - 1];
    if (cur && p.s - cur.e < SLEEP_GAP_MS) {
      cur.e = p.e;
      cur.endIso = p.endIso;
      cur.asleep += p.e - p.s;
      cur.records += p.records;
      for (const src of p.sources) cur.sources.add(src);
    } else {
      nights.push({ ...p, asleep: p.e - p.s, sources: new Set(p.sources) });
    }
  }
  const byDate = new Map();
  for (const night of nights) {
    const date = night.endIso.slice(0, 10);
    const f = st.since;
    if (f && f.date && date < f.date) continue;
    if (f && f.ms != null && night.e < f.ms) continue;
    bump(st.counts, 'sleep_minutes', night.records);
    const d = byDate.get(date);
    if (!d) {
      byDate.set(date, { ...night, count: 1 });
    } else {
      d.asleep += night.asleep;
      d.count++;
      if (night.s < d.s) [d.s, d.startIso] = [night.s, night.startIso];
      if (night.e > d.e) [d.e, d.endIso] = [night.e, night.endIso];
      for (const src of night.sources) d.sources.add(src);
    }
  }
  return [...byDate].map(([date, d]) => ({
    signal: 'sleep_minutes', start: date, value: round6(d.asleep / 60000), unit: 'min', source: SOURCE,
    detail: { from: d.startIso, to: d.endIso, sessions: d.count, sources: sorted(d.sources) },
  }));
}

// ---------- results ----------
function parseSignals(signals) {
  if (signals == null) return null;
  if (typeof signals === 'string') return new Set([signals]);
  return typeof signals[Symbol.iterator] === 'function' ? new Set(signals) : null;
}
function newState(opts) {
  const signals = parseSignals(opts.signals);
  return {
    since: parseSince(opts.since), signals, stack: [], sawRoot: false, exportDate: null, truncated: false, names: new Map(),
    counts: {}, skipped: {}, bad: { value: 0, date: 0, percentAsIs: 0, broken: 0 }, badUnits: new Map(),
    steps: new Map(), daily: new Map(), readings: new Map(), bp: new Map(), corr: false, sleep: [],
  };
}

function finish(st) {
  if (st.stack.includes('HealthData')) st.truncated = true; // never reached </HealthData>
  const unpairedBp = finishBp(st);
  const samples = [];

  const stepDays = new Map();
  for (const [hour, bySource] of st.steps) {
    const date = hour.slice(0, 10);
    let d = stepDays.get(date);
    if (!d) stepDays.set(date, (d = { total: 0, sources: new Set() }));
    let most = 0;
    for (const [src, n] of bySource) {
      if (n > most) most = n;
      d.sources.add(src);
    }
    d.total += most;
  }
  for (const [date, d] of stepDays) {
    samples.push({ signal: 'steps', start: date, value: Math.round(d.total), unit: 'steps', source: SOURCE, detail: { sources: sorted(d.sources) } });
  }

  for (const [key, day] of st.daily) {
    const [signal, date] = key.split('|');
    const sources = sorted(day.sources);
    if (signal === 'heart_rate') {
      samples.push({ signal, start: date, value: round6(median(day.values)), unit: 'bpm', source: SOURCE,
        detail: { min: round6(day.values.reduce((x, y) => (y < x ? y : x), Infinity)), n: day.values.length, sources } });
    } else {
      samples.push({ signal, start: date, value: round6(day.values.reduce((x, y) => x + y, 0)), unit: 'count', source: SOURCE,
        detail: { n: day.values.length, sources } });
    }
  }

  for (const r of st.readings.values()) {
    const sample = { signal: r.signal, start: r.start, end: r.end, value: round6(r.sum / r.n) };
    if (r.signal === 'bp') sample.value2 = round6(r.sum2 / r.n);
    Object.assign(sample, { unit: r.unit, source: SOURCE, detail: { n: r.n, sources: sorted(r.sources) } });
    samples.push(sample);
  }

  samples.push(...finishSleep(st));
  samples.sort((a, b) => (a.signal < b.signal ? -1 : a.signal > b.signal ? 1 : a.start < b.start ? -1 : a.start > b.start ? 1 : 0));

  const warnings = [];
  if (st.since && st.since.invalid) warnings.push(`The start date "${st.since.invalid}" was not understood, so everything was imported.`);
  if (st.truncated) warnings.push('The file stops before its end, so it may be cut short. If readings are missing, export the data again.');
  if (st.bad.broken) warnings.push(`${plural(st.bad.broken, 'damaged part')} of the file could not be read and ${st.bad.broken === 1 ? 'was' : 'were'} skipped.`);
  if (st.bad.date) warnings.push(`${plural(st.bad.date, 'record')} had a date this app could not read and ${st.bad.date === 1 ? 'was' : 'were'} left out.`);
  if (st.bad.value) warnings.push(`${plural(st.bad.value, 'record')} had no usable number and ${st.bad.value === 1 ? 'was' : 'were'} left out.`);
  for (const [type, u] of st.badUnits) {
    warnings.push(`${plural(u.n, `${typeLabel(type)} record`)} used a unit this app does not know (${sorted(u.units).join(', ')}) and ${u.n === 1 ? 'was' : 'were'} left out.`);
  }
  if (st.bad.percentAsIs) {
    warnings.push(`${plural(st.bad.percentAsIs, 'percentage')} came as 0 to 100 instead of Apple's 0 to 1 and ${st.bad.percentAsIs === 1 ? 'was' : 'were'} kept as ${st.bad.percentAsIs === 1 ? 'it is' : 'they are'}.`);
  }
  if (unpairedBp) warnings.push(`${plural(unpairedBp, 'blood pressure number')} had no matching top or bottom number and ${unpairedBp === 1 ? 'was' : 'were'} left out.`);
  if (!samples.length) warnings.push('No readings that this app uses were found in this export.');

  return { ok: true, samples, counts: st.counts, skipped: st.skipped, exportDate: st.exportDate, warnings };
}

const stopped = () => ({ ok: false, aborted: true, reason: 'The import was stopped.' });
const notExport = () => ({ ok: false, reason: 'This file is not an Apple Health export. In the Health app, tap your picture, then "Export All Health Data", and choose the export.zip it makes.' });
function explain(err) {
  if (err && err.name === 'ZipError') return err.message;
  if (err && err.name === 'AbortError') return 'The import was stopped.';
  const detail = err && err.message ? ` (${err.message})` : '';
  return `The file could not be read${detail}. Try exporting it again from the Health app.`;
}

// Strings, bytes (decoded as UTF-8), a ReadableStream, or any iterable of them.
async function* textPieces(input) {
  if (typeof input === 'string') {
    yield input;
    return;
  }
  let decoder = null;
  const text = (chunk) => {
    if (typeof chunk === 'string') return chunk;
    // Any kind of bytes: a Uint8Array, a Node Buffer, a DataView, an ArrayBuffer, also ones
    // made in another window or worker (where instanceof Uint8Array is false).
    if (ArrayBuffer.isView(chunk) || chunk instanceof ArrayBuffer) {
      return (decoder ||= new TextDecoder()).decode(chunk, { stream: true });
    }
    return String(chunk);
  };
  if (input && typeof input.getReader === 'function') {
    const reader = input.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        yield text(value);
      }
    } finally {
      reader.cancel().catch(() => {}); // stop reading the file when the parser leaves early
    }
  } else {
    for await (const chunk of input) yield text(chunk);
  }
  if (decoder) yield decoder.decode();
}

const breathe = () => new Promise((resolve) => setTimeout(resolve, 0));

export async function parseAppleHealthChunks(chunks, options) {
  // Everything is inside the try, the options too: this never throws at the caller.
  try {
    const opts = options || {};
    const { abortSignal } = opts;
    if (chunks == null) return notExport();
    const st = newState(opts);
    let buf = '';
    let read = 0;
    let lastBreath = Date.now();
    for await (const piece of textPieces(chunks)) {
      if (abortSignal && abortSignal.aborted) return stopped();
      if (!piece) continue;
      buf = buf ? buf + piece : piece;
      buf = buf.slice(scan(buf, st, false));
      read += piece.length;
      if (!st.sawRoot && read > HEAD_LIMIT) return notExport(); // leaving the loop stops the reading
      if (Date.now() - lastBreath > YIELD_EVERY_MS) {
        await breathe();
        lastBreath = Date.now();
      }
    }
    if (abortSignal && abortSignal.aborted) return stopped();
    if (buf) scan(buf, st, true);
    if (!st.sawRoot) return notExport();
    return finish(st);
  } catch (err) {
    return { ok: false, reason: explain(err) };
  }
}

// ---------- files ----------
const isBlobLike = (x) => x && typeof x.slice === 'function' && typeof x.size === 'number';

// true or false from the entry's first 4 KB, or the zip error that kept it closed
// (a password, a kind of compression this app cannot read, damage).
async function startsLikeHealthData(blob, entry) {
  let reader;
  try {
    reader = (await openZipEntry(blob, entry)).getReader();
    const decoder = new TextDecoder();
    let head = '';
    while (head.length < 4096) {
      const { done, value } = await reader.read();
      if (done) break;
      head += decoder.decode(value, { stream: true });
    }
    return /<!DOCTYPE\s+HealthData|<HealthData[\s>]/.test(head);
  } catch (err) {
    if (err && err.code === 'NO_DEFLATE') throw err; // the browser cannot unzip anything
    return err && err.name === 'ZipError' ? err : false;
  } finally {
    if (reader) reader.cancel().catch(() => {});
  }
}

// export.xml in English; other languages rename the file (eksport.xml, exportar.xml), so then
// every .xml file is checked by its first bytes, largest first. export_cda.xml (clinical
// documents) fails that check. If none passes but one could not be opened at all, that
// reason is given: "password-protected" helps more than "no export inside".
async function findExportEntry(blob, entries) {
  const xml = entries.filter((e) => /\.xml$/i.test(e.name)).sort((a, b) => b.size - a.size);
  const named = xml.find((e) => /(^|\/)export\.xml$/i.test(e.name));
  if (named) return named;
  let unopened = null;
  for (const e of xml) {
    const looks = await startsLikeHealthData(blob, e);
    if (looks === true) return e;
    if (looks && !unopened) unopened = looks;
  }
  if (unopened) throw unopened;
  return null;
}

// Counts bytes on their way to the parser and reports the fraction read, at most every 0.1%
// so a page stays fast. A broken progress callback must not stop the import.
function progressReporter(total, onProgress) {
  let told = -1;
  const tell = (fraction) => {
    if (fraction < 1 && fraction - told < 0.001) return;
    if (fraction <= told) return;
    told = fraction;
    try { onProgress(fraction); } catch { /* ignore */ }
  };
  return {
    wrap(stream) {
      let read = 0;
      return stream.pipeThrough(new TransformStream({
        transform(chunk, controller) {
          read += chunk.byteLength;
          tell(Math.min(1, read / total));
          controller.enqueue(chunk);
        },
      }));
    },
    done: () => tell(1),
  };
}

function decodeUtf8(stream) {
  if (typeof TextDecoderStream === 'function') return stream.pipeThrough(new TextDecoderStream());
  return stream; // textPieces decodes Uint8Array chunks itself
}

export async function importAppleHealth(fileOrBlob, options) {
  try {
    const opts = options || {};
    const { onProgress, abortSignal } = opts;
    if (!isBlobLike(fileOrBlob)) return { ok: false, reason: 'No file was chosen.' };
    if (fileOrBlob.size === 0) return { ok: false, reason: 'This file is empty.' };
    if (abortSignal && abortSignal.aborted) return stopped();
    const magic = new Uint8Array(await fileOrBlob.slice(0, 2).arrayBuffer());
    let bytes;
    let total;
    if (magic[0] === 0x50 && magic[1] === 0x4b) { // "PK": a zip archive
      const entries = await listZipEntries(fileOrBlob);
      // A failed export can leave a zip with nothing in it, 22 bytes (a 2.67 GB Health store in
      // talk.macpowerusers.com, "Exporting HealthKit data ... 22 bytes zip file", 2018).
      if (!entries.length) {
        return { ok: false, reason: 'This zip file is empty, so the Health app did not finish the export. Export the data again from the Health app.' };
      }
      const entry = await findExportEntry(fileOrBlob, entries);
      if (!entry) {
        return { ok: false, reason: 'This zip has no Apple Health export inside. In the Health app, tap your picture, then "Export All Health Data", and choose the export.zip it makes.' };
      }
      bytes = await openZipEntry(fileOrBlob, entry);
      total = entry.size;
    } else if (typeof fileOrBlob.stream === 'function') {
      bytes = fileOrBlob.stream();
      total = fileOrBlob.size;
    } else {
      return { ok: false, reason: 'This browser cannot read files this way. Try a current version of Chrome, Edge, Firefox or Safari.' };
    }
    // Progress needs TransformStream (Safari 14.1 and later); without it the import still runs.
    const canTell = typeof onProgress === 'function' && total > 0 && typeof TransformStream === 'function';
    const progress = canTell ? progressReporter(total, onProgress) : null;
    const result = await parseAppleHealthChunks(decodeUtf8(progress ? progress.wrap(bytes) : bytes), opts);
    if (result.ok && progress) progress.done();
    return result;
  } catch (err) {
    return { ok: false, reason: explain(err) };
  }
}
