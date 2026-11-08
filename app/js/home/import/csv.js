// Home device data from CSV files and typed-in readings, as shared Samples, and back out as CSV.
// Pure functions, no DOM or storage: runs in the browser and in Node. Nothing here throws:
// odd input gives empty lists and warnings in plain words.
//
//   parseCsv(text) -> { headers, rows, rowNumbers, delimiter, warnings }
//     rows hold each cell as text; rowNumbers[i] is the row a spreadsheet shows for rows[i];
//     delimiter is ',' or ';'.
//   FORMATS: [{ id, label, match(headers) -> boolean,
//     toSamples(rows, headers, { rowNumbers, delimiter }?) -> { samples, warnings, moreWarnings? } }]
//     Brand formats first, 'generic' last. A format lists at most MAX_WARNINGS (50) warnings
//     and counts the rest in moreWarnings, so a broken file of a million rows stays small.
//     Brand formats: 'withings-weight' (weight.csv: weight, and body fat from the fat mass) and
//     'withings-bp' (bp.csv or blood_pressure.csv: blood pressure, and heart rate from its pulse).
//   csvToSamples(text, { formatId?, source = 'csv', person? }) -> { samples, warnings, format }
//     warnings read "Row 12: the value is not a number (...)"; at most 50, then a count.
//   MANUAL_FIELDS: { bp, heart_rate, spo2, weight, grip, temperature, peak_cough_flow, fvc }
//     each { label, unit, inputs: [{ key, label, unit, unitText, min, max, step, optional? } or
//     { key, label, choices }] }
//   manualToSample(signal, { date, time?, values, person? }) -> { sample } or { errors }
//   samplesToCsv(samples) -> CSV text (CRLF) in the generic format; csvToSamples reads it back unchanged
// Sample: { signal, start, end?, value, value2?, unit, source, person?, simulated?, detail? }
// Every sample has a unit and ISO dates the store accepts (a year from 1000, an end not before its start).
// The work happens on the calling thread: give a file of millions of rows to a Web Worker so the
// page stays responsive.

// ---------- signals and their shared units ----------
// family is the kind of unit, so a file can say lb or km/h and still be read.
// fractionAtMostOne: a reading of 1% or less is impossible for this signal, so a value
// above 0 and up to 1 must be a fraction (some apps store 97% as 0.97). FVC is left out on
// purpose: a value under 1 is more likely litres (late ALS, or Apple Health, which keeps FVC
// in litres) than a fraction, and reading 0.8 L as 80% would hide a serious drop.
const SIGNALS = {
  // 'steps', not 'count': the same unit word applehealth.js, demo.js and catalog.js use, so
  // summary.js's mdcFor sees no unit clash and CSV steps get their MDC band too.
  steps:                  { label: 'steps', unit: 'steps', family: 'count' },
  walking_speed:          { label: 'walking speed', unit: 'm/s', family: 'speed' },
  step_length:            { label: 'step length', unit: 'm', family: 'length' },
  double_support:         { label: 'double support time', unit: '%', family: 'percent', fractionAtMostOne: true },
  walking_asymmetry:      { label: 'walking asymmetry', unit: '%', family: 'percent' },
  walking_steadiness:     { label: 'walking steadiness', unit: '%', family: 'percent' },
  six_minute_walk:        { label: 'six-minute walk distance', unit: 'm', family: 'length' },
  stair_ascent_speed:     { label: 'stair climbing speed', unit: 'm/s', family: 'speed' },
  stair_descent_speed:    { label: 'stair descending speed', unit: 'm/s', family: 'speed' },
  falls:                  { label: 'falls', unit: 'count', family: 'count' },
  weight:                 { label: 'weight', unit: 'kg', family: 'mass' },
  body_fat:               { label: 'body fat', unit: '%', family: 'percent', fractionAtMostOne: true },
  lean_mass:              { label: 'lean mass', unit: 'kg', family: 'mass' },
  heart_rate:             { label: 'heart rate', unit: 'bpm', family: 'beats' },
  resting_hr:             { label: 'resting heart rate', unit: 'bpm', family: 'beats' },
  hrv_sdnn:               { label: 'heart rate variability (SDNN)', unit: 'ms', family: 'ms' },
  hrv_rmssd:              { label: 'heart rate variability (RMSSD)', unit: 'ms', family: 'ms' },
  spo2:                   { label: 'blood oxygen', unit: '%', family: 'percent', fractionAtMostOne: true },
  respiratory_rate:       { label: 'breathing rate', unit: 'breaths/min', family: 'breaths' },
  bp:                     { label: 'blood pressure', unit: 'mmHg', family: 'mmhg' },
  sleep_minutes:          { label: 'sleep', unit: 'min', family: 'minutes' },
  // kept in whatever unit the source reports, so it has no family and no conversion
  breathing_disturbances: { label: 'breathing disturbances', unit: '', family: null },
  wrist_temp:             { label: 'wrist temperature', unit: 'degC', family: 'temp' },
  vo2max:                 { label: 'VO2 max', unit: 'mL/kg/min', family: 'vo2' },
  grip:                   { label: 'grip strength', unit: 'kg', family: 'mass' },
  fvc:                    { label: 'FVC', unit: '% predicted', family: 'predicted' },
  peak_cough_flow:        { label: 'peak cough flow', unit: 'L/min', family: 'flow' },
  temperature:            { label: 'temperature', unit: 'degC', family: 'temp' },
};

// Samples leave in the vocabulary's key order, so two equal samples also print the same JSON
// (a store that compares or de-duplicates by JSON text sees them as one).
// over replaces some fields on the way, so a large import builds each sample only once.
const SAMPLE_KEYS = ['signal', 'start', 'end', 'value', 'value2', 'unit', 'source', 'person', 'simulated', 'detail'];
function inOrder(s, over) {
  const out = {};
  for (const k of SAMPLE_KEYS) {
    const v = over && Object.hasOwn(over, k) ? over[k] : s[k];
    if (v !== undefined) out[k] = v;
  }
  for (const k of Object.keys(s)) if (!Object.hasOwn(out, k) && s[k] !== undefined) out[k] = s[k]; // anything extra a format adds
  return out;
}

// How units are shown to people: 37 °C, 97%, 85% of predicted.
const UNIT_TEXT = { degC: '°C', '% predicted': '% of predicted' };
function withUnit(n, unit) {
  const t = UNIT_TEXT[unit] ?? unit ?? '';
  if (!t) return String(n);
  return t.startsWith('%') ? `${n}${t}` : `${n} ${t}`;
}

// Accepted spellings for each kind of unit (lower case, spaces removed) and how each one
// converts to the shared unit. The factors are exact (NIST SP 811: 1 lb = 0.45359237 kg,
// 1 ft = 0.3048 m, 1 in = 0.0254 m, 1 mi = 1609.344 m, 1 mph = 0.44704 m/s).
const LB = 0.45359237;
const FT = 0.3048;
const IN = 0.0254;
const MI = 1609.344;
const KMH = 1 / 3.6;
const MPH = 0.44704;
const fromF = (f) => (f - 32) / 1.8;
const UNIT_FAMILIES = {
  count: { hint: 'a plain count', units: { count: 1, counts: 1, steps: 1, step: 1, times: 1, falls: 1, '#': 1 } },
  mass: { hint: 'kg or lb', units: { kg: 1, kgs: 1, kilogram: 1, kilograms: 1, lb: LB, lbs: LB, pound: LB, pounds: LB } },
  speed: { hint: 'm/s, km/h or mph', units: { 'm/s': 1, mps: 1, 'km/h': KMH, kph: KMH, kmh: KMH, mph: MPH, 'mi/h': MPH, 'ft/s': FT } },
  length: {
    hint: 'm, cm, km, ft or in',
    units: { m: 1, meter: 1, meters: 1, metre: 1, metres: 1, cm: 0.01, km: 1000, ft: FT, foot: FT, feet: FT, in: IN, inch: IN, inches: IN, mi: MI, mile: MI, miles: MI },
  },
  percent: { hint: '%', units: { '%': 1, percent: 1, pct: 1, fraction: 100, ratio: 100 } },
  predicted: { hint: '% of predicted', units: { '%': 1, percent: 1, '%predicted': 1, '%pred': 1, '%ofpredicted': 1, percentpredicted: 1, percentofpredicted: 1, fraction: 100 } },
  beats: { hint: 'bpm', units: { bpm: 1, 'beats/min': 1, 'beat/min': 1, 'count/min': 1, '/min': 1, '1/min': 1 } },
  breaths: { hint: 'breaths/min', units: { 'breaths/min': 1, 'breath/min': 1, brpm: 1, 'count/min': 1, '/min': 1, '1/min': 1 } },
  ms: { hint: 'ms', units: { ms: 1, msec: 1, millisecond: 1, milliseconds: 1, s: 1000, sec: 1000 } },
  mmhg: { hint: 'mmHg', units: { mmhg: 1 } },
  minutes: { hint: 'minutes or hours', units: { min: 1, mins: 1, minute: 1, minutes: 1, h: 60, hr: 60, hrs: 60, hour: 60, hours: 60 } },
  temp: { hint: '°C or °F', units: { degc: 1, '°c': 1, c: 1, celsius: 1, '℃': 1, degf: fromF, '°f': fromF, f: fromF, fahrenheit: fromF, '℉': fromF } },
  vo2: { hint: 'mL/kg/min', units: { 'ml/kg/min': 1, 'ml/(kg·min)': 1, 'ml/(kg*min)': 1, 'ml/kg·min': 1, 'ml/min·kg': 1, 'ml/min/kg': 1 } },
  flow: { hint: 'L/min', units: { 'l/min': 1, lpm: 1, 'l/s': 60 } },
};
const LITRES = new Set(['l', 'liter', 'liters', 'litre', 'litres', 'ml']);

// The same unit text comes on every row of a file, so each short spelling is worked out once.
// The memo is capped (count and length), so a file of junk cannot make it grow.
const UNIT_KEYS = new Map();
function unitKey(text) {
  const raw = String(text ?? '');
  const known = UNIT_KEYS.get(raw);
  if (known !== undefined) return known;
  const key = unitKeyOf(raw);
  if (UNIT_KEYS.size < 500 && raw.length <= 40) UNIT_KEYS.set(raw, key);
  return key;
}
function unitKeyOf(raw) {
  return raw.trim().toLowerCase()
    .replace(/[º˚]/g, '°')
    .replace(/\s+per\s+/g, '/')
    .replace(/\s+/g, '')
    .replace(/\/(minutes?|mins?)$/, '/min')
    .replace(/\/(hours?|hrs?)$/, '/h')
    .replace(/\/(seconds?|secs?)$/, '/s')
    .replace(/^(meters?|metres?)\//, 'm/')
    .replace(/^(kilometers?|kilometres?)\//, 'km/')
    .replace(/^(liters?|litres?)\//, 'l/')
    .replace(/^miles?\//, 'mi/')
    .replace(/^(feet|foot)\//, 'ft/');
}

// The converter for a unit written in a file, or null for an empty unit (the shared unit),
// or undefined when the unit does not fit the signal. Own keys only, so a cell saying
// "constructor" is an unknown unit, not a built-in function.
function converterFor(meta, unitText) {
  const key = unitKey(unitText);
  if (!key) return null;
  const units = UNIT_FAMILIES[meta.family]?.units;
  return units && Object.hasOwn(units, key) ? units[key] : undefined;
}
const applyConverter = (c, x) => (typeof c === 'function' ? c(x) : x * c);

// Converting leaves float noise (0.29 * 100 = 28.999999999999996); 12 significant digits
// is far finer than any home device measures.
const tidy = (x) => Number(x.toPrecision(12));
const show = (x) => Number(x.toPrecision(4));
const upperFirst = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const lowerFirst = (s) => (s.charAt(1) === s.charAt(1).toLowerCase() ? s.charAt(0).toLowerCase() + s.slice(1) : s);
// Text from anything a caller passes in; '' for nothing, '?' for an object that cannot be text.
const textOf = (x) => {
  if (x == null) return '';
  try { return String(x); } catch { return '?'; }
};
const short = (s) => {
  const t = textOf(s);
  return t.length > 24 ? `${t.slice(0, 21)}...` : t;
};

// ---------- typed-in readings ----------
// What a person can type in by hand. min and max are physiological limits that only catch
// typos and wrong units (a systolic of 1200, a temperature typed in °F). They are not
// clinical thresholds: a value inside them can still be abnormal, and nothing here judges
// that. step is a hint for the input box, not a rule.
export const MANUAL_FIELDS = {
  bp: {
    label: 'Blood pressure', unit: 'mmHg',
    inputs: [
      { key: 'systolic', label: 'Top number (systolic)', unit: 'mmHg', unitText: 'mmHg', min: 60, max: 260, step: 1 },
      { key: 'diastolic', label: 'Bottom number (diastolic)', unit: 'mmHg', unitText: 'mmHg', min: 30, max: 160, step: 1 },
      { key: 'pulse', label: 'Pulse', unit: 'bpm', unitText: 'bpm', min: 20, max: 250, step: 1, optional: true },
    ],
  },
  heart_rate: {
    label: 'Heart rate', unit: 'bpm',
    inputs: [{ key: 'value', label: 'Heart rate', unit: 'bpm', unitText: 'bpm', min: 20, max: 250, step: 1 }],
  },
  spo2: {
    label: 'Blood oxygen (SpO2)', unit: '%',
    inputs: [{ key: 'value', label: 'Blood oxygen', unit: '%', unitText: '%', min: 50, max: 100, step: 1 }],
  },
  weight: {
    label: 'Weight', unit: 'kg',
    inputs: [{ key: 'value', label: 'Weight', unit: 'kg', unitText: 'kg', min: 20, max: 350, step: 0.1 }],
  },
  grip: {
    label: 'Grip strength', unit: 'kg',
    inputs: [
      { key: 'value', label: 'Grip strength', unit: 'kg', unitText: 'kg', min: 0, max: 100, step: 0.1 },
      { key: 'hand', label: 'Hand', choices: ['right', 'left'] },
    ],
  },
  temperature: {
    label: 'Temperature', unit: 'degC',
    inputs: [{ key: 'value', label: 'Temperature', unit: 'degC', unitText: '°C', min: 30, max: 45, step: 0.1 }],
  },
  peak_cough_flow: {
    label: 'Peak cough flow', unit: 'L/min',
    inputs: [{ key: 'value', label: 'Peak cough flow', unit: 'L/min', unitText: 'L/min', min: 20, max: 1000, step: 1 }],
  },
  fvc: {
    label: 'Breathing test (FVC)', unit: '% predicted',
    inputs: [{ key: 'value', label: 'FVC', unit: '% predicted', unitText: '% of predicted', min: 5, max: 160, step: 1 }],
  },
};

// The same typo limits, applied to files too. Resting heart rate shares heart rate's.
const LIMITS = {};
for (const [id, field] of Object.entries(MANUAL_FIELDS)) {
  for (const input of field.inputs) {
    if (!input.choices) LIMITS[id === 'bp' ? input.key : id] = { ...input, label: id === 'bp' ? lowerFirst(input.label) : SIGNALS[id].label };
  }
}
LIMITS.resting_hr = { ...LIMITS.heart_rate, label: SIGNALS.resting_hr.label };

const BP_ORDER = 'the top number (systolic) should be higher than the bottom number (diastolic).';

// A number typed into a box: "72.5", "72,5" or a number. Anything else is not a number.
function typedNumber(raw) {
  if (typeof raw === 'number') return raw;
  const t = textOf(raw).trim();
  return /^[+-]?(\d+([.,]\d*)?|[.,]\d+)$/.test(t) ? Number(t.replace(',', '.')) : NaN;
}

export function manualToSample(signal, input) {
  const { date, time, values, person } = input || {};
  const field = typeof signal === 'string' && Object.hasOwn(MANUAL_FIELDS, signal) ? MANUAL_FIELDS[signal] : null;
  if (!field) return { errors: [signal ? `"${short(signal)}" can't be typed in here.` : 'Choose what you are recording.'] };
  const errors = [];
  const dateText = textOf(date).trim();
  const day = readDay(dateText);
  if (!dateText) errors.push('Enter the date.');
  else if (!day) errors.push('The date should be a real date written like 2026-11-08.');
  const timeText = textOf(time).trim();
  const clock = timeText ? readClock(timeText) : null;
  if (timeText && !clock) errors.push('The time should be written like 07:30 (24-hour clock).');

  // a single number can be given on its own instead of { value }
  const given = values != null && typeof values === 'object' ? values : { value: values };
  const got = {};
  for (const inp of field.inputs) {
    const raw = given[inp.key];
    const empty = textOf(raw).trim() === '';
    if (inp.choices) {
      const choice = empty ? '' : textOf(raw).trim().toLowerCase();
      if (inp.choices.includes(choice)) got[inp.key] = choice;
      else errors.push(`Choose the ${lowerFirst(inp.label)}: ${inp.choices.join(' or ')}.`);
      continue;
    }
    if (empty) {
      if (!inp.optional) errors.push(`Enter the ${lowerFirst(inp.label)}.`);
      continue;
    }
    const n = typedNumber(raw);
    if (!Number.isFinite(n)) errors.push(`${inp.label} must be a number.`);
    else if (n < inp.min || n > inp.max) errors.push(`${inp.label} should be between ${inp.min} and ${withUnit(inp.max, inp.unit)}. Check for a typo.`);
    else got[inp.key] = n;
  }
  if (signal === 'bp' && got.systolic != null && got.diastolic != null && got.systolic <= got.diastolic) errors.push(upperFirst(BP_ORDER));
  if (errors.length) return { errors };

  const sample = { signal, start: clock ? `${day}T${clock}` : day, unit: field.unit, source: 'manual' };
  if (signal === 'bp') {
    sample.value = got.systolic;
    sample.value2 = got.diastolic;
    if (got.pulse != null) sample.detail = { pulse: got.pulse };
  } else {
    sample.value = got.value;
    if (got.hand) sample.detail = { hand: got.hand };
  }
  const who = typeof person === 'string' ? person.trim() : '';
  if (who) sample.person = who;
  return { sample: inOrder(sample) };
}

// ---------- dates and times ----------
// Dates stay calendar dates: nothing here reads the device's time zone, so no time-zone shift
// (Date.UTC below is plain arithmetic on the numbers written in the file).
const pad = (n) => String(n).padStart(2, '0');
const leap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const daysIn = (y, m) => [31, leap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
const DAY_RE = /^(\d{4})([-/])(\d{1,2})\2(\d{1,2})$/;
const DATETIME_RE = /^(\d{4})([-/])(\d{1,2})\2(\d{1,2})[T ]\s*(\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?)\s*(Z|[+-]\d{2}(?::?\d{2})?)?$/i;

// "2026-11-08" (also 2026/11/08 or 2026-1-5) as YYYY-MM-DD, or null if no such day.
// A year below 1000 is a typo here, as in the store, which would drop the sample without a word.
function readDay(text) {
  const m = DAY_RE.exec(String(text ?? '').trim());
  if (!m) return null;
  const y = +m[1], mo = +m[3], d = +m[4];
  if (y < 1000 || mo < 1 || mo > 12 || d < 1 || d > daysIn(y, mo)) return null;
  return `${m[1]}-${pad(mo)}-${pad(d)}`;
}

// "07:30", "7:30:15.5" or "7:05 PM" as HH:MM or HH:MM:SS(.fff), or null.
function readClock(text) {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2})(\.\d+)?)?(?:\s*([ap])\.?\s*m\.?)?$/i.exec(String(text ?? '').trim());
  if (!m) return null;
  let h = +m[1];
  const min = +m[2];
  if (m[5]) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (m[5].toLowerCase() === 'p' ? 12 : 0);
  }
  if (h > 23 || min > 59 || (m[3] != null && +m[3] > 59)) return null;
  return `${pad(h)}:${m[2]}${m[3] != null ? `:${m[3]}${m[4] || ''}` : ''}`;
}

// "2026-11-01T08:00:00Z", "2026-11-01 08:00" or "2026-11-01 08:00:00 -0500" as ISO 8601
// (T between date and time, offsets as +HH:MM), or null. Already-ISO text comes back unchanged.
function readDateTime(text) {
  const m = DATETIME_RE.exec(String(text ?? '').trim());
  if (!m) return null;
  const day = readDay(`${m[1]}-${m[3]}-${m[4]}`);
  const clock = readClock(m[5]);
  if (!day || !clock) return null;
  let zone = '';
  if (m[6]) {
    if (/^z$/i.test(m[6])) zone = 'Z';
    else {
      const z = /^([+-])(\d{2}):?(\d{2})?$/.exec(m[6]);
      if (+z[2] > 14 || +(z[3] || 0) > 59) return null;
      zone = `${z[1]}${z[2]}:${z[3] || '00'}`;
    }
  }
  return `${day}T${clock}${zone}`;
}

// The start (or end) of a reading from a date cell and an optional time cell.
function readWhen(text, timeText = '', what = 'date') {
  const t = String(text ?? '').trim();
  if (!t) return { ok: false, reason: `there is no ${what}.` };
  const day = readDay(t);
  if (day) {
    if (!timeText) return { ok: true, value: day };
    const clock = readClock(timeText);
    if (clock) return { ok: true, value: `${day}T${clock}` };
    return { ok: true, value: day, note: `the time is not one we can read ("${short(timeText)}"), so only the date was kept.` };
  }
  const dt = readDateTime(t);
  if (dt) return { ok: true, value: dt };
  if (DAY_RE.test(t)) return { ok: false, reason: `the ${what} "${short(t)}" is not a real date.` };
  if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}[T ]/i.test(t)) return { ok: false, reason: `the ${what} "${short(t)}" is not a real date and time.` };
  if (/^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$/.test(t)) return { ok: false, reason: `the ${what} "${short(t)}" could mean day/month or month/day; write it like 2026-11-08.` };
  return { ok: false, reason: `the ${what} is not one we can read ("${short(t)}"); write it like 2026-11-08.` };
}

// An end before its start is a broken row (the store drops it without a word), checked the way
// the store checks it: a date next to anything compares the calendar days as written; two times
// without a zone, or two with a zone (converted to UTC), compare the moments. A zoned time next
// to an unzoned one would need a time-zone guess, so it is let through. Values come from readWhen.
const WHEN_RE = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?(Z|([+-])(\d{2}):(\d{2}))?)?$/;
function instant(iso) {
  const m = WHEN_RE.exec(iso);
  if (!m) return null;
  if (m[4] === undefined) return { kind: 'day', t: iso };
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) + Number(m[6] || 0) * 1000;
  if (!m[7]) return { kind: 'local', t: ms };
  const offset = m[8] ? (m[8] === '-' ? -1 : 1) * (+m[9] * 60 + +m[10]) * 60000 : 0;
  return { kind: 'zoned', t: ms - offset };
}
function endsBeforeStart(start, end) {
  const a = instant(start);
  const b = instant(end);
  if (!a || !b) return false;
  if (a.kind === 'day' || b.kind === 'day') return end.slice(0, 10) < start.slice(0, 10);
  return a.kind === b.kind && b.t < a.t;
}

// ---------- numbers and names in cells ----------
// "72.5", "72.5 kg", "97%", "12,345" (thousands, comma files) or "72,5" (a decimal comma, in
// semicolon files only, where the comma cannot be the cell separator). Anything else is not
// a number, so "72,5" in a comma file is refused rather than read as 725.
function readNumber(text, delimiter) {
  const t = String(text ?? '').trim();
  if (!t) return { empty: true };
  const m = /^([+-]?(?:\d[\d,]*(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)\s*(.*)$/i.exec(t);
  if (!m) return { bad: true };
  let digits = m[1];
  if (digits.includes(',')) {
    if (delimiter === ';' && /^[+-]?\d+,\d+$/.test(digits)) digits = digits.replace(',', '.');
    else if (delimiter !== ';' && /^[+-]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(digits)) digits = digits.replace(/,/g, '');
    else return { bad: true };
  }
  const value = Number(digits);
  return Number.isFinite(value) ? { value, unit: m[2] } : { bad: true };
}

// Names are compared lower case, with _ - . : , turned into spaces ("Heart_Rate" = "heart rate").
// camelCase is tried as a second reading ("heartRate" = "heart rate").
function words(s) {
  return String(s).toLowerCase().replace(/₂/g, '2').replace(/[_\-–—.,:;]+/g, ' ').replace(/\s+/g, ' ').trim();
}
function nameKeys(s) {
  const plain = words(s);
  const camel = words(String(s).replace(/([a-z0-9])([A-Z])/g, '$1 $2'));
  return camel === plain ? [plain] : [plain, camel];
}
// "Weight (kg)" -> { base: 'Weight', paren: 'kg' }; "Body fat %" -> { base: 'Body fat', paren: '%' }
function splitParen(raw) {
  const name = String(raw ?? '').trim();
  const m = /^(.*\S)\s*[([]([^()[\]]*)[)\]]$/.exec(name);
  if (m) return { base: m[1], paren: m[2].trim() };
  if (/\S\s*%$/.test(name)) return { base: name.replace(/\s*%$/, ''), paren: '%' };
  return { base: name, paren: '' };
}

// Other names people and apps use for each signal; each id also matches as written. Names
// that sound alike but measure something else are left out on purpose: "peak flow" is
// breathing out, not coughing; a "stride" is two steps; "fat mass" is kg, not %.
const SYNONYMS = {
  steps: ['step count', 'daily steps'],
  walking_speed: ['gait speed', 'walk speed'],
  step_length: ['walking step length'],
  double_support: ['double support time', 'double support percentage', 'walking double support', 'walking double support percentage'],
  walking_asymmetry: ['walking asymmetry percentage', 'gait asymmetry'],
  walking_steadiness: ['steadiness'],
  six_minute_walk: ['six minute walk test', 'six minute walk distance', 'six minute walk test distance', '6 minute walk', '6 minute walk test', '6 minute walk distance', '6mwt', '6mwd'],
  stair_ascent_speed: ['stair climbing speed', 'stair speed up'],
  stair_descent_speed: ['stair descending speed', 'stair speed down'],
  falls: ['fall count', 'number of falls', 'number of times fallen'],
  weight: ['body weight', 'body mass'],
  body_fat: ['body fat percentage', 'body fat percent', 'fat percentage'],
  lean_mass: ['lean body mass'],
  heart_rate: ['hr', 'pulse', 'pulse rate'],
  resting_hr: ['resting heart rate', 'resting pulse', 'rhr'],
  hrv_sdnn: ['sdnn', 'heart rate variability sdnn'],
  hrv_rmssd: ['rmssd', 'heart rate variability rmssd'],
  spo2: ['sp o2', 'blood oxygen', 'blood oxygen saturation', 'oxygen saturation', 'o2 saturation', 'o2 sat'],
  respiratory_rate: ['breathing rate', 'respiration rate', 'resp rate'],
  bp: ['blood pressure'],
  sleep_minutes: ['sleep', 'sleep duration', 'sleep time', 'time asleep', 'minutes asleep', 'asleep', 'total sleep', 'total sleep time'],
  breathing_disturbances: ['sleep breathing disturbances'],
  wrist_temp: ['wrist temperature', 'sleeping wrist temperature'],
  vo2max: ['vo2 max', 'cardio fitness'],
  grip: ['grip strength', 'hand grip', 'handgrip', 'hand grip strength', 'handgrip strength'],
  fvc: ['forced vital capacity', 'fvc predicted', 'fvc percent predicted', 'fvc % predicted', 'fvc % of predicted'],
  peak_cough_flow: ['cough peak flow', 'pcf'],
  temperature: ['body temperature', 'temp', 'body temp'],
};
// The two halves of a blood pressure, when a file gives them on separate rows or in their own columns.
const BP_PARTS = {
  systolic: ['systolic', 'sys', 'systolic bp', 'systolic pressure', 'systolic blood pressure', 'blood pressure systolic'],
  diastolic: ['diastolic', 'dia', 'diastolic bp', 'diastolic pressure', 'diastolic blood pressure', 'blood pressure diastolic'],
};
// One name for two different measures: refused rather than guessed.
const HRV_WHY = { why: 'could be SDNN or RMSSD, which are different measures', fix: 'Name it hrv_sdnn or hrv_rmssd.' };
const AMBIGUOUS = new Map([['hrv', HRV_WHY], ['heart rate variability', HRV_WHY]]);

const NAME_TO_SIGNAL = new Map();
for (const id of Object.keys(SIGNALS)) NAME_TO_SIGNAL.set(words(id), id);
for (const [id, names] of Object.entries(SYNONYMS)) for (const n of names) NAME_TO_SIGNAL.set(words(n), id);
const NAME_TO_PART = new Map();
for (const [part, names] of Object.entries(BP_PARTS)) for (const n of names) NAME_TO_PART.set(words(n), part);

function lookupName(text) {
  for (const key of nameKeys(text)) {
    if (NAME_TO_SIGNAL.has(key)) return { signal: NAME_TO_SIGNAL.get(key) };
    if (NAME_TO_PART.has(key)) return { signal: 'bp', part: NAME_TO_PART.get(key) };
    if (AMBIGUOUS.has(key)) return { ambiguous: AMBIGUOUS.get(key) };
  }
  return null;
}

// A signal cell -> { signal, part?, hand?, hint? } or { ambiguous } or { unknown: true }.
// hint is a unit written in the name ("Weight (lb)"); grip names can carry the hand.
function findSignal(raw) {
  const { base, paren: p } = splitParen(raw);
  let paren = p;
  let hand;
  if (/^(right|left)$/i.test(paren)) { hand = paren.toLowerCase(); paren = ''; }
  let found = paren ? lookupName(`${base} ${paren}`) : null; // "HRV (SDNN)" is a name, not a unit
  let hint = '';
  if (!found) { found = lookupName(base); hint = paren; }
  if (!found) {
    // "Grip right", "left grip strength"
    const h = /\b(right|left)\b/i.exec(base);
    const g = h && lookupName(base.replace(h[0], ' '));
    if (g?.signal === 'grip') { found = g; hand = h[1].toLowerCase(); hint = paren; }
  }
  if (!found) return { unknown: true };
  if (found.ambiguous) return found;
  return { ...found, hint, ...(found.signal === 'grip' && hand ? { hand } : {}) };
}

// The same signal name comes on every row of a long file, so each one is looked up once.
// Frozen, because one answer is shared by every row with that name. Capped like unitKey.
const SIGNAL_NAMES = new Map();
function signalOf(name) {
  const known = SIGNAL_NAMES.get(name);
  if (known) return known;
  const found = Object.freeze(findSignal(name));
  if (SIGNAL_NAMES.size < 1000 && name.length <= 80) SIGNAL_NAMES.set(name, found);
  return found;
}

// Column names for each role. For the time of a reading the first name in the list wins,
// so "start" beats "datetime" beats "date" when a file has several of them. "Start time" comes
// last: it holds the start only in a file with no date column (many sleep exports); next to a
// date column it is the time of day, because the start role is filled before the time role.
const COLUMNS = {
  start: ['start', 'start date', 'start datetime', 'start date time', 'datetime', 'date time', 'timestamp', 'time stamp', 'date', 'start time'],
  time: ['time', 'start time', 'time of day'],
  end: ['end', 'end date', 'end datetime', 'end date time', 'end time'],
  signal: ['signal', 'metric', 'type', 'measurement', 'measure'],
  value: ['value', 'value1', 'value 1', 'reading'],
  value2: ['value2', 'value 2'],
  unit: ['unit', 'units'],
  systolic: BP_PARTS.systolic,
  diastolic: BP_PARTS.diastolic,
  pulse: ['pulse', 'pulse rate', 'pul', 'heart rate', 'hr'],
  person: ['person', 'patient'],
  source: ['source'],
  simulated: ['simulated'],
  detail: ['detail', 'details'],
};
const COLUMN_KEYS = Object.fromEntries(Object.entries(COLUMNS).map(([role, names]) => [role, names.map(words)]));

// Which header is which role: { start: 0, signal: 1, ..., hints: { value: 'kg' } }.
function findColumns(headers) {
  const list = (Array.isArray(headers) ? headers : []).map((h) => {
    const { base, paren } = splitParen(h);
    return { keys: nameKeys(base), paren };
  });
  const cols = { hints: {} };
  const taken = new Set();
  for (const [role, names] of Object.entries(COLUMN_KEYS)) {
    let best = null;
    list.forEach(({ keys, paren }, i) => {
      if (taken.has(i)) return;
      for (const key of keys) {
        const rank = names.indexOf(key);
        if (rank >= 0 && (!best || rank < best.rank)) best = { i, rank, paren };
      }
    });
    if (best) {
      cols[role] = best.i;
      taken.add(best.i);
      if (best.paren) cols.hints[role] = best.paren;
    }
  }
  return cols;
}
const hasNeededColumns = (c) => c.start != null && ((c.signal != null && c.value != null) || (c.systolic != null && c.diastolic != null));
const NEEDED = "We couldn't find the columns we need. A file needs a date column (date, datetime or start), "
  + 'a signal column (signal, metric or type) and a value column, or a date column with systolic and diastolic columns for blood pressure.';

// Text a spreadsheet could run as a formula starts with one of these (OWASP, CSV injection:
// = + - @, tab, carriage return, line feed, and the full-width = + - @). samplesToCsv puts an
// apostrophe before such text; take it off again when reading.
const FORMULA_START = /^'*[=+\-@\t\r\n＝＋－＠]/;
const unguard = (s) => (/^'+[=+\-@\t\r\n＝＋－＠]/.test(s) ? s.slice(1) : s);
const SOURCE_RE = /^(apple-health|csv|manual|bluetooth|demo|csv:[a-z0-9._-]+)$/;
const isPlainObject = (x) => x != null && typeof x === 'object' && !Array.isArray(x);

function readDetail(text) {
  if (!text) return undefined;
  if (/^[[{]/.test(text)) {
    try {
      const parsed = JSON.parse(text);
      if (parsed != null && typeof parsed === 'object') return parsed;
    } catch { /* not JSON: keep the text */ }
  }
  return text;
}

// ---------- reading CSV text ----------
// Memory on large files. A string built a character at a time is held by the engine as a
// chain of pieces: in V8 a 19-character date and time takes about 260 bytes that way and 50
// once flat. Running a regex over a string makes the engine flatten it in place; the text does
// not change. Rows are also kept as exact-size copies: an array grown by push() reserves room
// for 16 cells. Together a parsed row of four cells drops from about 540 bytes to 220.
const FLATTEN = /^/;
const flat = (str) => { if (str.length > 12) FLATTEN.test(str); return str; };

// RFC 4180, read leniently: CRLF, LF or CR line ends; a UTF-8 byte order mark is dropped; a
// quoted cell may hold commas, line breaks and "" for a quote. Two kindnesses beyond the RFC:
// spaces before an opening quote are ignored, and a stray quote inside a plain cell is kept as
// text. Semicolon files (Excel in many European languages) are detected from the header line.
// Blank lines are skipped, but rowNumbers keeps each row's number as a spreadsheet shows it
// (the header is row 1), so warnings point at the right row.
export function parseCsv(text) {
  let s = typeof text === 'string' ? text : '';
  if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);
  const delimiter = detectDelimiter(s);
  const records = [];
  const row = []; // the row being read; each finished row is kept as an exact-size copy
  let cell = '';
  let inQuotes = false;
  let wasQuoted = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c !== '"') cell += c;
      else if (s[i + 1] === '"') { cell += '"'; i++; }
      else inQuotes = false;
    } else if (c === '"' && !wasQuoted && cell.trim() === '') {
      inQuotes = true;
      wasQuoted = true;
      cell = '';
    } else if (c === delimiter) {
      row.push(flat(cell));
      cell = '';
      wasQuoted = false;
    } else if (c === '\n' || c === '\r') {
      row.push(flat(cell));
      records.push(row.slice());
      row.length = 0;
      cell = '';
      wasQuoted = false;
      if (c === '\r' && s[i + 1] === '\n') i++;
    } else cell += c;
  }
  if (cell !== '' || wasQuoted || row.length) { row.push(flat(cell)); records.push(row.slice()); }
  const warnings = inQuotes ? ['The file ends inside a quoted cell (a " was never closed), so the last row may be cut short.'] : [];

  let headers = null;
  const rows = [];
  const rowNumbers = [];
  records.forEach((r, i) => {
    if (r.every((c) => c.trim() === '')) return;
    if (headers === null) headers = r;
    else { rows.push(r); rowNumbers.push(i + 1); }
  });
  return { headers: headers || [], rows, rowNumbers, delimiter, warnings };
}

// Semicolons win only if the first line with content has more of them than commas, outside quotes.
function detectDelimiter(s) {
  let commas = 0;
  let semicolons = 0;
  let inQuotes = false;
  let seen = false; // this line has something on it (blank lines before the header are skipped)
  for (const c of s) {
    if (c === '"') inQuotes = !inQuotes;
    else if (inQuotes) continue;
    else if (c === ',') commas++;
    else if (c === ';') semicolons++;
    else if (c === '\n' || c === '\r') {
      if (seen) break;
      continue;
    }
    if (c.trim()) seen = true;
  }
  return semicolons > commas ? ';' : ',';
}

// ---------- the generic format ----------
// Columns in any order and any case: date (or datetime or start), signal (or metric or type),
// value, and optional unit, value2, time, end, person, source, simulated and detail. Blood
// pressure can be value and value2, "120/80" in value, systolic and diastolic columns (with an
// optional pulse column), or systolic and diastolic rows at the same date and time.
// The caller's rows are never changed.
function genericToSamples(rows, headers, context) {
  return readGeneric(rows, headers, context, false);
}
// release: csvToSamples hands over rows it parsed itself, so each row is let go once read and
// a large file never holds all its rows and all its samples at the same time.
function readGeneric(rows, headers, context, release) {
  const { rowNumbers, delimiter = ',' } = context || {};
  const numbers = Array.isArray(rowNumbers) ? rowNumbers : [];
  const cols = findColumns(headers);
  const notes = problemList(MAX_WARNINGS);
  const done = (samples) => {
    const result = { samples, warnings: notes.lines() };
    if (notes.more) result.moreWarnings = notes.more;
    return result;
  };
  if (!hasNeededColumns(cols)) { notes.add(0, NEEDED); return done([]); }
  const width = Array.isArray(headers) ? headers.length : 0;
  // Samples in row order. A systolic half waiting for its diastolic partner holds its place
  // with null, so the pair lands where the systolic row was without sorting the whole list.
  const out = [];
  let waiting = 0;
  const pending = []; // halves of a blood pressure waiting for their partner
  const skippedNames = new Map(); // name as written -> { count, why (only for ambiguous names) }
  const fractions = new Set();

  (Array.isArray(rows) ? rows : []).forEach((cells, i) => {
    if (release) rows[i] = null;
    const rowNo = Number.isFinite(numbers[i]) ? numbers[i] : i + 2;
    const warn = (text) => notes.add(rowNo, text);
    if (!Array.isArray(cells)) return;
    if (hasExtraCells(cells, width)) {
      warn(EXTRA_CELLS);
      return;
    }
    const cell = (role) => (cols[role] == null ? '' : String(cells[cols[role]] ?? '').trim());

    // which signal
    let found;
    const name = cell('signal');
    if (name) {
      found = signalOf(name);
      if (found.unknown || found.ambiguous) {
        const entry = skippedNames.get(name) || { count: 0, why: found.ambiguous };
        entry.count++;
        skippedNames.set(name, entry);
        return;
      }
    } else if (cols.systolic != null && cols.diastolic != null) found = BP_FROM_COLUMNS;
    else { warn('there is no signal name, so it was skipped.'); return; }

    // when
    const when = readWhen(cell('start'), cell('time'));
    if (!when.ok) { warn(when.reason); return; }
    if (when.note) warn(when.note);
    const base = { start: flat(when.value) }; // kept by the sample, so flattened (see flat)
    const endText = cell('end');
    if (endText) {
      const end = readWhen(endText);
      if (!end.ok) warn(`the end date is not one we can read ("${short(endText)}"), so it was left out.`);
      else if (endsBeforeStart(base.start, end.value)) { warn('the end is before the start, so it was skipped.'); return; }
      else base.end = flat(end.value);
    }
    const person = unguard(cell('person'));
    if (person) base.person = person;
    const source = unguard(cell('source')).toLowerCase();
    if (SOURCE_RE.test(source)) base.source = source;
    const simulated = cell('simulated').toLowerCase();
    if (['true', 'yes', '1'].includes(simulated)) base.simulated = true;
    else if (['false', 'no', '0'].includes(simulated)) base.simulated = false;
    const extra = {};
    if (found.hand) extra.hand = found.hand;

    const unitCell = unguard(cell('unit'));
    const meta = SIGNALS[found.signal];
    // A unit next to the number wins, then the unit column, then one in the signal name or header.
    const unitOf = (num, ...more) => num.unit || unitCell || found.hint || more.find(Boolean) || '';
    const badUnit = (unit, label, family) => `"${short(unit)}" is not a unit we can use for ${label} (use ${UNIT_FAMILIES[family].hint}).`;
    const detailOf = () => {
      const detail = readDetail(unguard(cell('detail')));
      if (!Object.keys(extra).length) return detail;
      return detail === undefined ? { ...extra } : isPlainObject(detail) ? { ...detail, ...extra } : { note: detail, ...extra };
    };
    const finish = (sample) => {
      const detail = detailOf();
      if (detail !== undefined) sample.detail = detail;
      out.push(sample);
    };

    if (found.signal === 'bp' && !found.part) {
      let sysText = cell('value');
      let diaText = cell('value2');
      const pair = /^([^/]+)\/([^/]+)$/.exec(sysText);
      if (pair) { sysText = pair[1].trim(); diaText = pair[2].trim(); }
      if (!sysText) sysText = cell('systolic');
      if (!diaText) diaText = cell('diastolic');
      const sys = readNumber(sysText, delimiter);
      const dia = readNumber(diaText, delimiter);
      if (sys.empty || dia.empty) { warn('blood pressure needs both numbers, like 120/80.'); return; }
      const junk = (n) => n.bad || (n.unit && converterFor(meta, n.unit) === undefined);
      if (junk(sys) || junk(dia)) { warn(`blood pressure should be two numbers, like 120/80 (this row has "${short(sysText)}" and "${short(diaText)}").`); return; }
      const unit = unitOf(sys, dia.unit, cols.hints.value, cols.hints.systolic);
      if (unit && converterFor(meta, unit) === undefined) { warn(badUnit(unit, meta.label, meta.family)); return; }
      const problem = outsideLimits('systolic', sys.value) || outsideLimits('diastolic', dia.value);
      if (problem) { warn(problem); return; }
      if (sys.value <= dia.value) { warn(BP_ORDER); return; }
      const pulseText = cell('pulse');
      const pulse = readNumber(pulseText, delimiter);
      // "70x" is a typo, not 70 in a unit called x; "66 bpm" is fine
      if (pulse.bad || (pulse.unit && converterFor(SIGNALS.heart_rate, pulse.unit) === undefined)) {
        warn(`the pulse is not a number ("${short(pulseText)}"), so it was left out.`);
      } else if (!pulse.empty) {
        const pulseProblem = outsideLimits('pulse', pulse.value);
        if (pulseProblem) warn(`${pulseProblem.replace(/\.$/, '')}, so the pulse was left out.`);
        else extra.pulse = pulse.value;
      }
      finish({ signal: 'bp', ...base, value: sys.value, value2: dia.value, unit: 'mmHg' });
      return;
    }

    const num = readNumber(cell('value'), delimiter);
    if (num.empty) { warn('the value is missing.'); return; }
    if (num.bad) { warn(`the value is not a number ("${short(cell('value'))}").`); return; }
    const unit = unitOf(num, cols.hints.value);

    if (found.part) {
      const label = lowerFirst(MANUAL_FIELDS.bp.inputs.find((x) => x.key === found.part).label);
      if (unit && converterFor(meta, unit) === undefined) {
        if (num.unit) warn(`the value is not a number ("${short(cell('value'))}").`);
        else warn(badUnit(unit, label, 'mmhg'));
        return;
      }
      const problem = outsideLimits(found.part, num.value);
      if (problem) { warn(problem); return; }
      const key = `${base.start}|${base.person || ''}`;
      if (found.part === 'diastolic') pending.push({ part: 'diastolic', rowNo, value: num.value, key });
      else {
        pending.push({ part: 'systolic', rowNo, value: num.value, key, base, detail: detailOf(), slot: out.length });
        out.push(null);
        waiting++;
      }
      return;
    }

    let value = num.value;
    let sampleUnit = meta.unit;
    if (meta.family) {
      if (found.signal === 'fvc' && LITRES.has(unitKey(unit))) {
        warn("FVC in litres can't be turned into percent of predicted here; use the percent predicted from your test report.");
        return;
      }
      const conv = converterFor(meta, unit);
      if (conv === undefined) {
        if (num.unit) warn(`the value is not a number ("${short(cell('value'))}").`);
        else warn(badUnit(unit, meta.label, meta.family));
        return;
      }
      let converted = conv != null && conv !== 1;
      if (converted) value = applyConverter(conv, value);
      if (meta.fractionAtMostOne && !converted && value > 0 && value <= 1) {
        value *= 100;
        converted = true;
        fractions.add(found.signal);
      }
      if (converted) value = tidy(value);
    } else {
      // kept in the unit the source reports, so the file has to say which (every sample has a unit)
      sampleUnit = unit.trim();
      if (!sampleUnit) { warn(`there is no unit for ${meta.label} (they are kept in the unit your device uses, for example per hour), so it was skipped.`); return; }
    }
    const problem = checkValue(found.signal, value);
    if (problem) {
      // an FVC far below any percent of predicted (but not below zero) is most likely litres
      const litres = found.signal === 'fvc' && value >= 0 && value < LIMITS.fvc.min;
      warn(litres ? `${problem} If it is in litres, use the percent predicted from your test report instead.` : problem);
      return;
    }
    finish({ signal: found.signal, ...base, value, unit: sampleUnit });
  });

  // Pair blood pressure halves written on separate rows: same date, time and person, in file order.
  const diastolics = new Map(); // key -> diastolic halves not yet paired
  for (const d of pending) {
    if (d.part !== 'diastolic') continue;
    if (!diastolics.has(d.key)) diastolics.set(d.key, []);
    diastolics.get(d.key).push(d);
  }
  for (const s of pending) {
    if (s.part !== 'systolic') continue;
    const d = diastolics.get(s.key)?.shift();
    if (!d) { notes.add(s.rowNo, 'this systolic reading has no diastolic reading with the same date and time, so it was skipped.'); continue; }
    if (s.value <= d.value) { notes.add(s.rowNo, BP_ORDER); continue; }
    const sample = { signal: 'bp', ...s.base, value: s.value, value2: d.value, unit: 'mmHg' };
    if (s.detail !== undefined) sample.detail = s.detail;
    out[s.slot] = sample;
    waiting--;
  }
  for (const left of diastolics.values()) {
    for (const d of left) notes.add(d.rowNo, 'this diastolic reading has no systolic reading with the same date and time, so it was skipped.');
  }

  for (const [name, { count, why }] of skippedNames) {
    notes.add(Infinity, () => {
      const rowsSkipped = `so ${count} ${count === 1 ? 'row was' : 'rows were'} skipped`;
      return why ? `"${short(name)}" ${why.why}, ${rowsSkipped}. ${why.fix}` : `"${short(name)}" is not something this app tracks, ${rowsSkipped}.`;
    });
  }
  for (const id of fractions) notes.add(Infinity, `${upperFirst(SIGNALS[id].label)} values between 0 and 1 were read as fractions (0.97 means 97%).`);
  return done(waiting ? out.filter((s) => s !== null) : out);
}

// A blood pressure file with systolic and diastolic columns needs no signal column.
const BP_FROM_COLUMNS = Object.freeze({ signal: 'bp', hint: '' });

// Cells past the last column name that hold something (empty ones are common and harmless).
const EXTRA_CELLS = 'this row has more cells than there are column names (a comma inside a number, like 72,5, splits it), so it was skipped.';
function hasExtraCells(cells, width) {
  for (let k = width; k < cells.length; k++) if (String(cells[k] ?? '').trim() !== '') return true;
  return false;
}

// Problems found while reading, in row order (row 0 is about the whole file, Infinity is a
// summary that goes last). Only the first `limit` in that order are kept as text; the rest are
// counted, so a file with a problem on each of a million rows cannot fill the memory. A
// message can be a function, so text that will not be kept is never built.
function problemList(limit) {
  const kept = []; // [row, text], by row, and in the order added within a row
  let more = 0;
  return {
    add(row, text) {
      if (kept.length >= limit) {
        if (!kept.length || row >= kept[kept.length - 1][0]) { more++; return; }
        kept.pop();
        more++;
      }
      let k = kept.length;
      while (k > 0 && kept[k - 1][0] > row) k--;
      kept.splice(k, 0, [row, typeof text === 'function' ? text() : text]);
    },
    get more() { return more; },
    lines: () => kept.map(([row, text]) => (row > 0 && row < Infinity ? `Row ${row}: ${text}` : text)),
  };
}

// A plain-words problem with a value in the shared unit, or '' if it is fine.
function checkValue(signal, value) {
  const meta = SIGNALS[signal];
  if (value < 0) return `${meta.label} can't be below zero.`;
  if (meta.family === 'percent' && value > 100) return `${meta.label} can't be more than 100%.`;
  return outsideLimits(signal, value);
}
function outsideLimits(key, value) {
  const lim = LIMITS[key];
  if (!lim || (value >= lim.min && value <= lim.max)) return '';
  return `the ${lim.label} reading of ${withUnit(show(value), lim.unit)} is outside the range we accept (${lim.min} to ${withUnit(lim.max, lim.unit)}); check for a typo.`;
}

// ---------- Withings ----------
// Withings exports all of an account's data as CSV files, with weight in the unit chosen in the
// account (Withings Help, "Privacy - How can I export my data?", updated 2026-10-30). Withings
// publishes no column list. These names come from two independent parsers, read 2026-11-08
// (bighydro/logbook withings_export.py and mikepsinn/optimitron withings.ts):
//   weight.csv          Date, Weight (kg), Fat mass (kg), Bone mass (kg), Muscle mass (kg),
//                       Hydration (kg), Comments; "(lb)" for an account in pounds; French
//                       exports say "Poids (kg)" and "Masse grasse (kg)"
//   bp.csv              Date, Heart Rate, Systolic, Diastolic, Comments
//   blood_pressure.csv  Date, Systolic (mmHg), Diastolic (mmHg), Heart rate (bpm), Comments
// Names are compared in any case and with any spacing, with the unit in brackets apart. Dates
// are the account's local time with no offset ("2026-06-08 07:12:33") and stay that way
// (2026-06-08T07:12:33), never shifted. Bone mass, muscle mass, hydration and comments are not
// read. A file whose names do not fit is left to the generic format: no column is guessed.

// Each header as { name, unit }: " Fat  Mass (KG)" -> { name: 'fat mass', unit: 'KG' }.
function headerParts(headers) {
  return (Array.isArray(headers) ? headers : []).map((h) => {
    const { base, paren } = splitParen(h);
    return { name: words(base), unit: paren };
  });
}
// A column with this name and no unit, or one of these units: "Systolic" or "Systolic (mmHg)".
const hasColumn = (parts, name, units = []) => parts.some((p) => p.name === name && (!p.unit || units.includes(unitKey(p.unit))));

// The first column with one of these names and kg or lb in brackets, with its converter to kg.
// The unit has to be written: an account can be in either, so a bare "Weight" is not read, and
// "Fat mass (%)" is never taken for a mass.
function massColumn(parts, names) {
  const index = parts.findIndex((p) => names.includes(p.name) && ['kg', 'lb'].includes(unitKey(p.unit)));
  return index < 0 ? null : { index, convert: converterFor(SIGNALS.weight, parts[index].unit) };
}
function withingsWeightColumns(headers) {
  const parts = headerParts(headers);
  const date = parts.findIndex((p) => p.name === 'date' && !p.unit);
  const weight = massColumn(parts, ['weight', 'poids']);
  if (date < 0 || !weight) return null;
  return { date, weight, fat: massColumn(parts, ['fat mass', 'masse grasse']) };
}
const WITHINGS_WEIGHT_NEEDED = "We couldn't find the columns of a Withings weight file: a Date column and a Weight (kg) or Weight (lb) column.";

// A weight sample per row, in kg. A fat mass on the row also gives body fat in %, worked out as
// fat mass / weight x 100 (both in kg first).
function withingsWeightToSamples(rows, headers, context) {
  const { rowNumbers, delimiter = ',' } = context || {};
  const numbers = Array.isArray(rowNumbers) ? rowNumbers : [];
  const cols = withingsWeightColumns(headers);
  const notes = problemList(MAX_WARNINGS);
  const out = [];
  const done = () => {
    const result = { samples: out, warnings: notes.lines() };
    if (notes.more) result.moreWarnings = notes.more;
    return result;
  };
  if (!cols) { notes.add(0, WITHINGS_WEIGHT_NEEDED); return done(); }
  const width = headers.length;
  // A mass cell in kg: { kg }, { empty } or { bad }. As in the generic format, a unit written
  // next to the number wins over the one in the header, and "7O" is a typo, not a unit.
  const kgOf = (text, column) => {
    const num = readNumber(text, delimiter);
    if (num.empty || num.bad) return num;
    const conv = num.unit ? converterFor(SIGNALS.weight, num.unit) : column.convert;
    if (typeof conv !== 'number') return { bad: true };
    return { kg: conv === 1 ? num.value : tidy(applyConverter(conv, num.value)) };
  };

  (Array.isArray(rows) ? rows : []).forEach((cells, i) => {
    const rowNo = Number.isFinite(numbers[i]) ? numbers[i] : i + 2;
    const warn = (text) => notes.add(rowNo, text);
    if (!Array.isArray(cells)) return;
    if (hasExtraCells(cells, width)) { warn(EXTRA_CELLS); return; }
    const cell = (k) => String(cells[k] ?? '').trim();
    const when = readWhen(cell(cols.date));
    if (!when.ok) { warn(when.reason); return; }

    const weightText = cell(cols.weight.index);
    const weight = kgOf(weightText, cols.weight);
    if (weight.empty) { warn('there is no weight, so it was skipped.'); return; }
    if (weight.bad) { warn(`the weight is not a number ("${short(weightText)}"), so it was skipped.`); return; }
    const problem = checkValue('weight', weight.kg);
    if (problem) { warn(problem); return; }
    const start = flat(when.value);
    out.push({ signal: 'weight', start, value: weight.kg, unit: 'kg' });

    if (!cols.fat) return;
    const fatText = cell(cols.fat.index);
    const fat = kgOf(fatText, cols.fat);
    if (fat.empty) return;
    if (fat.bad) { warn(`the fat mass is not a number ("${short(fatText)}"), so only the weight was kept.`); return; }
    const percent = tidy((fat.kg / weight.kg) * 100);
    const fatProblem = checkValue('body_fat', percent);
    if (fatProblem) { warn(`${fatProblem.replace(/\.$/, '')}, so only the weight was kept.`); return; }
    out.push({ signal: 'body_fat', start, value: percent, unit: '%', detail: { computedFrom: 'fat mass and weight' } });
  });
  return done();
}

// bp.csv or blood_pressure.csv: a Date column with Systolic, Diastolic and Heart rate columns.
function isWithingsBp(headers) {
  const parts = headerParts(headers);
  return hasColumn(parts, 'date') && hasColumn(parts, 'systolic', ['mmhg']) && hasColumn(parts, 'diastolic', ['mmhg'])
    && hasColumn(parts, 'heart rate', ['bpm']);
}

// The generic reader reads the file (Heart rate is its pulse column), so a Withings file gives
// the same blood pressure samples and warnings as it did through the generic format. Each pulse
// it kept also becomes a heart rate sample of its own, right after its blood pressure.
function withingsBpToSamples(rows, headers, context) {
  const read = readGeneric(rows, headers, context, false);
  const samples = [];
  for (const s of read.samples) {
    samples.push(s);
    const pulse = s.signal === 'bp' && isPlainObject(s.detail) ? s.detail.pulse : undefined;
    if (!Number.isFinite(pulse) || checkValue('heart_rate', pulse)) continue;
    const { value2, detail, ...same } = s;
    samples.push({ ...same, signal: 'heart_rate', value: pulse, unit: 'bpm', detail: { from: 'blood pressure cuff' } });
  }
  return { ...read, samples };
}

// ---------- file formats ----------
const GENERIC = {
  id: 'generic',
  label: 'Generic CSV (date, signal, value)',
  match: (headers) => hasNeededColumns(findColumns(headers)),
  toSamples: genericToSamples,
};

const WITHINGS_WEIGHT = {
  id: 'withings-weight',
  label: 'Withings weight (weight.csv)',
  match: (headers) => withingsWeightColumns(headers) !== null,
  toSamples: withingsWeightToSamples,
};
const WITHINGS_BP = {
  id: 'withings-bp',
  label: 'Withings blood pressure (bp.csv)',
  match: isWithingsBp,
  toSamples: withingsBpToSamples,
};

// Brand exports go here, above the generic format, so they are tried first. Withings is in
// (its column names come from two independent parsers; Withings publishes none). Still to
// come: Fitbit (Google), Garmin, Samsung.
// Add each one only once its exact column names are confirmed from a real export or the
// brand's own documentation: a guessed column name would import wrong numbers without any
// warning. Each entry is { id, label, match(headers), toSamples(rows, headers, { rowNumbers,
// delimiter }) } returning { samples, warnings, moreWarnings? }, with values in the shared units
// and every sample carrying a unit. Keep warnings short (problemList does that) and count the
// rest in moreWarnings. csvToSamples sets source to "csv:<id>" and fills in the person.
const BRAND_FORMATS = [WITHINGS_WEIGHT, WITHINGS_BP];

export const FORMATS = [...BRAND_FORMATS, GENERIC];

// So a badly broken file still gives a list a person can read.
const MAX_WARNINGS = 50;
const moreText = (n) => (n === 1 ? '...and 1 more problem that is not shown.' : `...and ${n} more problems that are not shown.`);

export function csvToSamples(text, options) {
  const { formatId, source: wanted, person } = options || {};
  // One of the vocabulary's sources; anything else (null, a number, a typo) means "csv".
  const source = typeof wanted === 'string' && SOURCE_RE.test(wanted) ? wanted : 'csv';
  const parsed = parseCsv(text);
  // Pushed one by one and counted past the limit: spreading a list of a few hundred thousand
  // warnings into push() overflows the call stack.
  const warnings = [];
  let more = 0;
  const warn = (w) => { if (warnings.length < MAX_WARNINGS) warnings.push(w); else more++; };
  parsed.warnings.forEach(warn);
  const done = (samples, format) => ({ samples, warnings: more ? [...warnings, moreText(more)] : warnings, format });
  if (!parsed.headers.length) { warn('The file is empty.'); return done([], null); }

  let format = null;
  if (formatId) {
    format = FORMATS.find((f) => f?.id === formatId) || null;
    if (!format) { warn(`We don't know the file type "${short(formatId)}".`); return done([], null); }
  } else {
    format = FORMATS.find((f) => { try { return f.match(parsed.headers); } catch { return false; } }) || null;
    if (!format) { warn(NEEDED); return done([], null); }
  }
  if (!parsed.rows.length) { warn('The file has column names but no rows of data.'); return done([], format.id); }

  try {
    // The built-in reader gets rows only this call has, and returns a list only it made, so both
    // can be emptied as they are read: a large file then holds one copy of its data, not three.
    const own = format.toSamples === genericToSamples;
    const context = { rowNumbers: parsed.rowNumbers, delimiter: parsed.delimiter };
    const result = own ? readGeneric(parsed.rows, parsed.headers, context, true) : format.toSamples(parsed.rows, parsed.headers, context);
    // A format added later may return something odd; keep only real samples and messages.
    if (Array.isArray(result?.warnings)) for (const w of result.warnings) if (typeof w === 'string') warn(w);
    if (Number.isInteger(result?.moreWarnings) && result.moreWarnings > 0) more += result.moreWarnings;
    // A brand file read with the default source is labelled with its format.
    const src = source === 'csv' && format.id !== 'generic' ? `csv:${format.id}` : source;
    const who = typeof person === 'string' ? person.trim() : '';
    const list = Array.isArray(result?.samples) ? result.samples : [];
    const samples = own ? list : [];
    let kept = 0;
    for (let k = 0; k < list.length; k++) {
      const s = list[k];
      if (!s || typeof s !== 'object') continue;
      const sample = inOrder(s, { source: s.source || src, person: who && !s.person ? who : s.person });
      if (own) list[kept++] = sample; // replaces the draft, which can then be let go
      else samples.push(sample);
    }
    if (own) list.length = kept;
    return done(samples, format.id);
  } catch {
    warn('Something went wrong while reading this file, so nothing was imported.');
    return done([], format.id);
  }
}

// ---------- writing CSV ----------
// The generic format with every Sample field, so csvToSamples reads it back unchanged.
const EXPORT_COLUMNS = ['start', 'end', 'signal', 'value', 'value2', 'unit', 'person', 'source', 'simulated', 'detail'];

function csvCell(v) {
  if (v == null || (typeof v === 'number' && !Number.isFinite(v))) return '';
  let s;
  try { s = String(v); } catch { return ''; } // an object that cannot be turned into text
  if (typeof v === 'string' && FORMULA_START.test(s)) s = `'${s}`; // keep spreadsheets from running it as a formula
  return /[",;\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function detailText(detail) {
  if (detail == null || typeof detail !== 'object') return detail;
  try { return JSON.stringify(detail); } catch { return ''; } // a detail that loops back on itself
}

export function samplesToCsv(samples) {
  const lines = [EXPORT_COLUMNS.join(',')];
  const num = (v) => (Number.isFinite(v) ? v : '');
  for (const s of Array.isArray(samples) ? samples : []) {
    if (!s || typeof s !== 'object') continue;
    const simulated = typeof s.simulated === 'boolean' ? String(s.simulated) : '';
    lines.push([s.start, s.end, s.signal, num(s.value), num(s.value2), s.unit, s.person, s.source, simulated, detailText(s.detail)]
      .map(csvCell).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}
