// CSV import, typed-in readings and CSV export for home device data.
// Expected values are worked out from the requirements by hand, not copied from the code's output.
// Unit factors are the exact ones in NIST SP 811 (1 lb = 0.45359237 kg, 1 mph = 0.44704 m/s).
// Run: node --test "tests/home-csv.test.mjs"
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCsv, FORMATS, csvToSamples, MANUAL_FIELDS, manualToSample, samplesToCsv,
} from '../app/js/home/import/csv.js';

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) < tol, `${a} vs ${b}`);
const rowsOf = (warnings) => warnings.map((w) => w.split(':')[0]);
// Messages are for patients: no programmer words. Quoted cell text is allowed to say anything.
function assertPlain(messages) {
  for (const m of messages) {
    assert.equal(typeof m, 'string');
    assert.doesNotMatch(m.replace(/"[^"]*"/g, '""'), /NaN|undefined|null|\[object|Error|Infinity/, m);
  }
}

// The shared units, copied from the vocabulary.
const UNITS = {
  steps: 'steps', walking_speed: 'm/s', step_length: 'm', double_support: '%', walking_asymmetry: '%',
  walking_steadiness: '%', six_minute_walk: 'm', stair_ascent_speed: 'm/s', stair_descent_speed: 'm/s',
  falls: 'count', weight: 'kg', body_fat: '%', lean_mass: 'kg', heart_rate: 'bpm', resting_hr: 'bpm',
  hrv_sdnn: 'ms', hrv_rmssd: 'ms', spo2: '%', respiratory_rate: 'breaths/min', sleep_minutes: 'min',
  breathing_disturbances: null, // kept in the unit the source reports, so a file must give one
  wrist_temp: 'degC', vo2max: 'mL/kg/min', grip: 'kg', fvc: '% predicted',
  peak_cough_flow: 'L/min', temperature: 'degC',
};

// ---------- parseCsv ----------

test('parseCsv splits a simple file into headers and rows of cells', () => {
  const { headers, rows } = parseCsv('date,signal,value\n2026-11-01,weight,72.5\n2026-11-02,weight,72.1\n');
  assert.deepEqual(headers, ['date', 'signal', 'value']);
  assert.deepEqual(rows, [['2026-11-01', 'weight', '72.5'], ['2026-11-02', 'weight', '72.1']]);
});

test('quoted cells keep commas, doubled quotes and line breaks', () => {
  const text = 'a,b,c\r\n"x, y","say ""hi""","line1\r\nline2"\r\n"","plain","x\ny"\r\n';
  const { headers, rows } = parseCsv(text);
  assert.deepEqual(headers, ['a', 'b', 'c']);
  assert.deepEqual(rows, [['x, y', 'say "hi"', 'line1\r\nline2'], ['', 'plain', 'x\ny']]);
});

test('CRLF, LF and lone CR line endings give the same rows', () => {
  const lf = 'a,b\n1,2\n3,4\n';
  assert.deepEqual(parseCsv(lf).rows, [['1', '2'], ['3', '4']]);
  assert.deepEqual(parseCsv(lf.replace(/\n/g, '\r\n')).rows, parseCsv(lf).rows);
  assert.deepEqual(parseCsv(lf.replace(/\n/g, '\r')).rows, parseCsv(lf).rows);
});

test('a UTF-8 byte order mark is removed, so the first column is still found', () => {
  assert.deepEqual(parseCsv('﻿date,value\n2026-11-01,1\n').headers, ['date', 'value']);
  const r = csvToSamples('﻿date,signal,value\n2026-11-01,weight,70\n');
  assert.equal(r.samples.length, 1);
  assert.deepEqual(r.warnings, []);
});

test('a trailing newline (or several) adds no empty row, and a missing one loses nothing', () => {
  assert.equal(parseCsv('a,b\n1,2\n').rows.length, 1);
  assert.equal(parseCsv('a,b\n1,2\n\n\n').rows.length, 1);
  assert.deepEqual(parseCsv('a,b\n1,2').rows, [['1', '2']]);
  assert.deepEqual(parseCsv('a,b\n1,""').rows, [['1', '']]);
});

test('semicolon files are detected from the header line', () => {
  const { headers, rows } = parseCsv('date;signal;value\n2026-11-01;weight;"72,5"\n2026-11-02;note;a,b\n');
  assert.deepEqual(headers, ['date', 'signal', 'value']);
  assert.deepEqual(rows, [['2026-11-01', 'weight', '72,5'], ['2026-11-02', 'note', 'a,b']]);
  // a quoted comma in the header does not fool the detector
  assert.deepEqual(parseCsv('"Weight, kg";Date\n70;2026-11-01\n').headers, ['Weight, kg', 'Date']);
  // and a quoted semicolon in a comma file stays inside its cell
  assert.deepEqual(parseCsv('a,b\n"x;y",2\n').rows, [['x;y', '2']]);
  // blank lines before the header do not hide the semicolons
  assert.deepEqual(parseCsv('\n\na;b\n1;2\n').rows, [['1', '2']]);
});

test('empty or missing text gives an empty table instead of an error', () => {
  for (const t of ['', '\n\n', '   ', null, undefined, 42, {}]) {
    const r = parseCsv(t);
    assert.deepEqual(r.headers, [], String(t));
    assert.deepEqual(r.rows, [], String(t));
  }
});

test('a quote that is never closed is reported in plain words, not thrown', () => {
  const r = parseCsv('a,b\n"open,2\n3,4\n');
  assert.ok(r.warnings.some((w) => /quote|"/.test(w)), r.warnings.join(' | '));
  assertPlain(r.warnings);
  const s = csvToSamples('date,signal,value\n2026-11-01,weight,"70\n');
  assert.ok(s.warnings.length >= 1);
  assertPlain(s.warnings);
});

test('row numbers in warnings match the rows a spreadsheet shows', () => {
  // header is row 1; a blank line still takes up a row; a cell with a line break stays one row
  const r = parseCsv('a,b\n1,2\n\n3,4\n"x\ny",5\n6,7\n');
  assert.deepEqual(r.rows, [['1', '2'], ['3', '4'], ['x\ny', '5'], ['6', '7']]);
  assert.deepEqual(r.rowNumbers, [2, 4, 5, 6]);
  const out = csvToSamples('date,signal,value\n2026-11-01,weight,70\n\n2026-11-02,weight,abc\n');
  assert.deepEqual(rowsOf(out.warnings), ['Row 4']);
  // CRLF is one line break, not two
  const crlf = csvToSamples('date,signal,value\r\n2026-11-01,weight,70\r\n2026-11-02,weight,abc\r\n');
  assert.deepEqual(rowsOf(crlf.warnings), ['Row 3']);
});

test('lenient reading: spaces before an opening quote, and a stray quote inside a plain cell', () => {
  assert.deepEqual(parseCsv('a,b\n1, "x,y"\n').rows, [['1', 'x,y']]);
  assert.deepEqual(parseCsv('a,b\n5" tall,2\n').rows, [['5" tall', '2']]);
});

// ---------- the format registry ----------

test('FORMATS: each entry has an id, a label, match and toSamples; the generic format is tried last', () => {
  assert.ok(Array.isArray(FORMATS) && FORMATS.length >= 1);
  for (const f of FORMATS) {
    assert.equal(typeof f.id, 'string');
    assert.equal(typeof f.label, 'string');
    assert.equal(typeof f.match, 'function');
    assert.equal(typeof f.toSamples, 'function');
  }
  assert.equal(FORMATS.at(-1).id, 'generic');
  const g = FORMATS.at(-1);
  assert.equal(g.match(['Date', 'Signal', 'Value']), true);
  assert.equal(g.match(['Date', 'Systolic', 'Diastolic']), true);
  assert.equal(g.match(['when', 'what', 'how much']), false);
  assert.equal(g.match([]), false);
  const out = g.toSamples([['2026-11-01', 'weight', '70']], ['date', 'signal', 'value']);
  assert.deepEqual(out.samples, [{ signal: 'weight', start: '2026-11-01', value: 70, unit: 'kg' }]);
  assert.deepEqual(out.warnings, []);
});

// ---------- the generic format ----------

test('columns are matched in any order and any case; metric or type can name the signal', () => {
  const a = csvToSamples('VALUE,Metric,DATE,Unit\n70,weight,2026-11-01,kg\n');
  assert.deepEqual(a.samples, [{ signal: 'weight', start: '2026-11-01', value: 70, unit: 'kg', source: 'csv' }]);
  assert.equal(a.format, 'generic');
  const b = csvToSamples('type,datetime,value\nheart_rate,2026-11-01T08:30:00,64\n');
  assert.deepEqual(b.samples, [{ signal: 'heart_rate', start: '2026-11-01T08:30:00', value: 64, unit: 'bpm', source: 'csv' }]);
  const c = csvToSamples('Start,Signal,Value\n2026-11-01,steps,8000\n');
  assert.deepEqual(c.samples, [{ signal: 'steps', start: '2026-11-01', value: 8000, unit: 'steps', source: 'csv' }]);
});

test('every shared signal id is accepted as written, with its shared unit', () => {
  const VALID = {
    steps: 8000, walking_speed: 1.2, step_length: 0.7, double_support: 28, walking_asymmetry: 2,
    walking_steadiness: 85, six_minute_walk: 450, stair_ascent_speed: 0.5, stair_descent_speed: 0.6,
    falls: 0, weight: 70, body_fat: 22, lean_mass: 52, heart_rate: 64, resting_hr: 58, hrv_sdnn: 45,
    hrv_rmssd: 38, spo2: 97, respiratory_rate: 15, sleep_minutes: 420, breathing_disturbances: 3,
    wrist_temp: 35.1, vo2max: 32, grip: 30, fvc: 85, peak_cough_flow: 300, temperature: 36.8,
  };
  // only breathing disturbances need their unit written: every other signal has a shared unit
  const unitFor = (id) => (UNITS[id] === null ? 'per hour' : '');
  const text = ['date,signal,value,unit', ...Object.entries(VALID).map(([id, v]) => `2026-11-01,${id},${v},${unitFor(id)}`)].join('\n');
  const { samples, warnings } = csvToSamples(text);
  assert.deepEqual(warnings, []);
  assert.deepEqual(samples.map((s) => [s.signal, s.value, s.unit]), Object.entries(VALID).map(([id, v]) => [id, v, UNITS[id] ?? 'per hour']));
});

test('obvious synonyms map to the shared ids', () => {
  const text = [
    'date,signal,value',
    '2026-11-01,Weight (kg),70',
    '2026-11-01,Heart rate,64',
    '2026-11-01,SpO2,97',
    '2026-11-01,Blood oxygen,96',
    '2026-11-01,Resting heart rate,58',
    '2026-11-01,Grip strength,30',
    '2026-11-01,Walking speed,1.2',
    '2026-11-01,Body temperature,36.9',
    '2026-11-01,HRV (SDNN),41',
    '2026-11-01,Peak cough flow,310',
    '2026-11-01,heartRate,66',
    '2026-11-01,Body fat %,22',
  ].join('\n');
  const { samples, warnings } = csvToSamples(text);
  assert.deepEqual(warnings, []);
  assert.deepEqual(samples.map((s) => s.signal),
    ['weight', 'heart_rate', 'spo2', 'spo2', 'resting_hr', 'grip', 'walking_speed', 'temperature', 'hrv_sdnn', 'peak_cough_flow', 'heart_rate', 'body_fat']);
});

test('grip names can say which hand', () => {
  const { samples, warnings } = csvToSamples('date,signal,value\n2026-11-01,Grip right,31\n2026-11-01,Grip (left),27\n2026-11-01,left grip strength,26\n2026-11-01,grip,30\n');
  assert.deepEqual(warnings, []);
  assert.deepEqual(samples.map((s) => [s.signal, s.detail?.hand]), [['grip', 'right'], ['grip', 'left'], ['grip', 'left'], ['grip', undefined]]);
  assert.equal('detail' in samples[3], false);
});

test('when a file has several date columns, start beats datetime beats date', () => {
  assert.equal(csvToSamples('date,start,signal,value\n2026-11-01,2026-11-02T08:00,weight,70\n').samples[0].start, '2026-11-02T08:00');
  assert.equal(csvToSamples('Date,DateTime,signal,value\n2026-11-01,2026-11-03T09:00,weight,70\n').samples[0].start, '2026-11-03T09:00');
  assert.equal(csvToSamples('startDate,type,value\n2026-11-04,weight,70\n').samples[0].start, '2026-11-04');
});

test('look-alike names that measure something else are not matched', () => {
  // peak flow is breathing out hard, not coughing; a stride is two steps; fat mass is kg, not %
  const { samples, warnings } = csvToSamples('date,signal,value\n2026-11-01,peak flow,400\n2026-11-01,stride length,1.4\n2026-11-01,fat mass,18\n');
  assert.deepEqual(samples, []);
  assert.equal(warnings.length, 3);
  assertPlain(warnings);
});

test('unknown names are explained once per name; an ambiguous HRV is not guessed', () => {
  const text = 'date,signal,value\n2026-11-01,flights climbed,3\n2026-11-02,flights climbed,4\n2026-11-01,HRV,45\n2026-11-01,weight,70\n';
  const { samples, warnings } = csvToSamples(text);
  assert.deepEqual(samples.map((s) => s.signal), ['weight']);
  assert.equal(warnings.filter((w) => /flights climbed/.test(w)).length, 1);
  assert.match(warnings.find((w) => /flights climbed/.test(w)), /2 rows/);
  assert.ok(warnings.some((w) => /HRV/.test(w) && /SDNN/.test(w) && /RMSSD/.test(w)), warnings.join(' | '));
  assertPlain(warnings);
});

test('blood pressure: two values, "120/80", systolic and diastolic columns, or paired rows', () => {
  const bp = (start, sys, dia, extra = {}) => ({ signal: 'bp', start, value: sys, value2: dia, unit: 'mmHg', source: 'csv', ...extra });
  assert.deepEqual(csvToSamples('date,signal,value,value2\n2026-11-01,bp,120,80\n').samples, [bp('2026-11-01', 120, 80)]);
  assert.deepEqual(csvToSamples('date,signal,value\n2026-11-01,blood pressure,121/79\n').samples, [bp('2026-11-01', 121, 79)]);
  const cols = csvToSamples('Date,Time,Systolic,Diastolic,Pulse\n2026-11-01,08:15,118,76,66\n');
  assert.deepEqual(cols.samples, [bp('2026-11-01T08:15', 118, 76, { detail: { pulse: 66 } })]);
  assert.equal(cols.format, 'generic');
  const rows = csvToSamples('datetime,signal,value\n2026-11-01T08:00,systolic,130\n2026-11-01T08:00,diastolic,85\n2026-11-02T08:00,systolic,128\n');
  assert.deepEqual(rows.samples, [bp('2026-11-01T08:00', 130, 85)]);
  assert.deepEqual(rowsOf(rows.warnings), ['Row 4']);
  assert.match(rows.warnings[0], /diastolic/);
  // halves from two different people are never joined
  const people = csvToSamples('datetime,signal,value,person\n2026-11-01T08:00,systolic,130,sam\n2026-11-01T08:00,diastolic,85,alex\n');
  assert.deepEqual(people.samples, []);
  assert.deepEqual(rowsOf(people.warnings), ['Row 2', 'Row 3']);
});

test('blood pressure columns with units in the header, and a bad pulse left out', () => {
  const r = csvToSamples('Date,Systolic (mmHg),Diastolic (mmHg),Pulse\n2026-11-01,120,80,abc\n2026-11-02,121,81,400\n2026-11-03,122,82,\n');
  assert.deepEqual(r.samples.map((s) => [s.value, s.value2, s.detail]), [[120, 80, undefined], [121, 81, undefined], [122, 82, undefined]]);
  assert.deepEqual(rowsOf(r.warnings), ['Row 2', 'Row 3']);
  assert.ok(r.warnings.every((w) => /pulse/.test(w)), r.warnings.join(' | '));
  assertPlain(r.warnings);
  const kpa = csvToSamples('Date,Systolic (kPa),Diastolic (kPa)\n2026-11-01,16,10.7\n');
  assert.deepEqual(kpa.samples, []);
  assert.match(kpa.warnings[0], /^Row 2:.*kPa/);
});

test('blood pressure needs both numbers, with the top number higher', () => {
  const one = csvToSamples('date,signal,value\n2026-11-01,bp,120\n');
  assert.deepEqual(one.samples, []);
  assert.deepEqual(rowsOf(one.warnings), ['Row 2']);
  const swapped = csvToSamples('date,signal,value,value2\n2026-11-01,bp,80,120\n');
  assert.deepEqual(swapped.samples, []);
  assert.match(swapped.warnings[0], /^Row 2:.*higher/);
  const typo = csvToSamples('date,signal,value,value2\n2026-11-01,bp,1200,80\n');
  assert.deepEqual(typo.samples, []);
  assert.match(typo.warnings[0], /^Row 2:/);
  assertPlain([...one.warnings, ...swapped.warnings, ...typo.warnings]);
});

test('missing columns: nothing is imported and the warning says what is needed', () => {
  const a = csvToSamples('when,what\n2026-11-01,70\n');
  assert.deepEqual(a.samples, []);
  assert.equal(a.format, null);
  assert.match(a.warnings.join(' '), /date/);
  assert.match(a.warnings.join(' '), /value/);
  const noDate = csvToSamples('signal,value\nweight,70\n');
  assert.deepEqual(noDate.samples, []);
  assert.match(noDate.warnings.join(' '), /date/);
  const headerOnly = csvToSamples('date,signal,value\n');
  assert.deepEqual(headerOnly.samples, []);
  assert.equal(headerOnly.warnings.length, 1);
  const empty = csvToSamples('');
  assert.deepEqual(empty.samples, []);
  assert.equal(empty.warnings.length, 1);
  assertPlain([...a.warnings, ...noDate.warnings, ...headerOnly.warnings, ...empty.warnings]);
});

test('bad numbers are skipped with a row-level warning in plain words', () => {
  const text = 'date,signal,value\n2026-11-01,weight,70\n2026-11-02,weight,abc\n2026-11-03,weight,\n'
    + '2026-11-04,weight,NaN\n2026-11-05,weight,Infinity\n2026-11-06,weight,7O\n';
  const { samples, warnings } = csvToSamples(text);
  assert.deepEqual(samples.map((s) => s.value), [70]);
  assert.deepEqual(rowsOf(warnings), ['Row 3', 'Row 4', 'Row 5', 'Row 6', 'Row 7']);
  assert.match(warnings[0], /^Row 3: the value is not a number/);
  assert.match(warnings[4], /^Row 7: the value is not a number/); // "7O" is a typo, not 7 in a unit called O
  assertPlain(warnings);
});

test('malformed rows: extra filled cells are refused, short rows are read with blanks', () => {
  const text = 'date,signal,value,unit\n2026-11-01,weight,72,5,kg\n2026-11-02,weight,71\n2026-11-03,weight,70,kg,,\n';
  const { samples, warnings } = csvToSamples(text);
  assert.deepEqual(samples.map((s) => [s.start, s.value, s.unit]), [['2026-11-02', 71, 'kg'], ['2026-11-03', 70, 'kg']]);
  assert.deepEqual(rowsOf(warnings), ['Row 2']);
  assert.match(warnings[0], /more cells/);
  // with no unit column, an unquoted 72,5 must not quietly become 72
  const noUnit = csvToSamples('date,signal,value\n2026-11-01,weight,72,5\n');
  assert.deepEqual(noUnit.samples, []);
  assert.match(noUnit.warnings[0], /^Row 2: this row has more cells/);
  assertPlain([...warnings, ...noUnit.warnings]);
});

test('units are converted to the shared units', () => {
  const text = [
    'date,signal,value,unit',
    '2026-11-01,weight,150,lb',
    '2026-11-01,temperature,98.6,°F',
    '2026-11-01,walking_speed,3.6,km/h',
    '2026-11-01,walking_speed,2,mph',
    '2026-11-01,step_length,70,cm',
    '2026-11-01,sleep_minutes,7.5,h',
    '2026-11-01,walking_steadiness,0.85,fraction',
    '2026-11-01,heart_rate,64,beats/min',
    '2026-11-01,grip,66,lbs',
    '2026-11-01,six_minute_walk,1500,ft',
    '2026-11-01,step_length,28,in',
    '2026-11-01,six_minute_walk,0.25,mi',
    '2026-11-01,heart_rate,65,beats per minute',
  ].join('\n');
  const { samples, warnings } = csvToSamples(text);
  assert.deepEqual(warnings, []);
  close(samples[0].value, 150 * 0.45359237); assert.equal(samples[0].unit, 'kg');
  // (98.6 - 32) / 1.8 is 36.99999999999999 in floating point; the stored value is tidied to 37
  assert.equal(samples[1].value, 37); assert.equal(samples[1].unit, 'degC');
  close(samples[2].value, 1); assert.equal(samples[2].unit, 'm/s');
  close(samples[3].value, 0.89408);
  close(samples[4].value, 0.7); assert.equal(samples[4].unit, 'm');
  close(samples[5].value, 450); assert.equal(samples[5].unit, 'min');
  close(samples[6].value, 85); assert.equal(samples[6].unit, '%');
  assert.equal(samples[7].value, 64); assert.equal(samples[7].unit, 'bpm');
  close(samples[8].value, 66 * 0.45359237); assert.equal(samples[8].unit, 'kg');
  close(samples[9].value, 457.2); assert.equal(samples[9].unit, 'm');
  close(samples[10].value, 0.7112);
  close(samples[11].value, 402.336);
  assert.equal(samples[12].value, 65);
});

test('a unit can come from the signal name, the value column header, or sit next to the number', () => {
  close(csvToSamples('date,signal,value\n2026-11-01,Weight (lb),200\n').samples[0].value, 200 * 0.45359237);
  close(csvToSamples('date,signal,Value (lb)\n2026-11-01,weight,150\n').samples[0].value, 150 * 0.45359237);
  assert.equal(csvToSamples('date,signal,value\n2026-11-01,weight,72.5 kg\n').samples[0].value, 72.5);
  assert.equal(csvToSamples('date,signal,value\n2026-11-01,SpO2,97%\n').samples[0].value, 97);
  // the unit written next to the number wins over the unit column, which wins over the name
  close(csvToSamples('date,signal,value,unit\n2026-11-01,weight,150 lb,kg\n').samples[0].value, 150 * 0.45359237);
  assert.equal(csvToSamples('date,signal,value,unit\n2026-11-01,Weight (lb),70,kg\n').samples[0].value, 70);
});

test('a unit that does not fit the signal is refused, and FVC in litres is explained', () => {
  const a = csvToSamples('date,signal,value,unit\n2026-11-01,weight,70,gallons\n');
  assert.deepEqual(a.samples, []);
  assert.match(a.warnings[0], /^Row 2:.*gallons/);
  const b = csvToSamples('date,signal,value,unit\n2026-11-01,heart_rate,64,kg\n');
  assert.deepEqual(b.samples, []);
  // words that happen to be built-in names are just unknown units
  const odd = csvToSamples('date,signal,value,unit\n2026-11-01,weight,70,constructor\n2026-11-01,weight,70,toString\n2026-11-01,weight,70,__proto__\n');
  assert.deepEqual(odd.samples, []);
  assert.deepEqual(rowsOf(odd.warnings), ['Row 2', 'Row 3', 'Row 4']);
  const c = csvToSamples('date,signal,value,unit\n2026-11-01,fvc,3.2,L\n');
  assert.deepEqual(c.samples, []);
  assert.match(c.warnings[0], /litres.*percent predicted/);
  assertPlain([...a.warnings, ...b.warnings, ...c.warnings]);
});

test('percentages are 0 to 100: impossible fractions are read as fractions, real small values are kept', () => {
  const a = csvToSamples('date,signal,value,unit\n2026-11-01,spo2,0.97,%\n2026-11-02,spo2,1,\n2026-11-03,spo2,98,%\n2026-11-04,body_fat,0.25,\n2026-11-05,body_fat,0.29,\n');
  // 0.29 * 100 is 28.999999999999996 in floating point; the stored value is 29
  assert.deepEqual(a.samples.map((s) => s.value), [97, 100, 98, 25, 29]);
  assert.ok(a.warnings.length >= 1 && a.warnings.every((w) => /fraction/.test(w)), a.warnings.join(' | '));
  // under 1% walking asymmetry is a real reading and is left alone
  assert.equal(csvToSamples('date,signal,value,unit\n2026-11-01,walking_asymmetry,0.5,%\n').samples[0].value, 0.5);
  // over 100% is refused
  const over = csvToSamples('date,signal,value\n2026-11-01,double_support,120\n2026-11-01,spo2,101\n');
  assert.deepEqual(over.samples, []);
  assert.deepEqual(rowsOf(over.warnings), ['Row 2', 'Row 3']);
});

test('decimal commas in semicolon files, thousands separators in comma files', () => {
  const a = csvToSamples('date;signal;value;unit\n2026-11-01;weight;72,5;kg\n2026-11-02;temperature;36,6;°C\n');
  assert.deepEqual(a.samples.map((s) => s.value), [72.5, 36.6]);
  assert.deepEqual(a.warnings, []);
  const b = csvToSamples('date,signal,value\n2026-11-01,steps,"12,345"\n2026-11-02,weight,"72,5"\n');
  assert.deepEqual(b.samples.map((s) => s.value), [12345]);
  assert.deepEqual(rowsOf(b.warnings), ['Row 3']);
});

test('dates: ISO dates and times are kept as written; anything else is refused with a reason', () => {
  const text = [
    'date,signal,value',
    '2026-11-01,weight,70',
    '2026-11-01T23:30:00Z,weight,70',
    '2026-11-01T23:30:00.250+05:30,weight,70',
    '2026-11-01 07:45,weight,70',
    '2028-02-29,weight,70',
    '2026-02-29,weight,70',
    '11/01/2026,weight,70',
    '2026-11-01T25:00,weight,70',
    'yesterday,weight,70',
    '2026/11/05,weight,70',
    '2026-1-5,weight,70',
    '2026-11-01 08:00:00 -0500,weight,70',
  ].join('\n');
  const { samples, warnings } = csvToSamples(text);
  assert.deepEqual(samples.map((s) => s.start), [
    '2026-11-01', '2026-11-01T23:30:00Z', '2026-11-01T23:30:00.250+05:30', '2026-11-01T07:45', '2028-02-29',
    '2026-11-05', '2026-01-05', '2026-11-01T08:00:00-05:00',
  ]);
  assert.deepEqual(rowsOf(warnings), ['Row 7', 'Row 8', 'Row 9', 'Row 10']);
  assertPlain(warnings);
});

test('optional end, time and detail columns', () => {
  const s = csvToSamples('start,end,signal,value\n2026-11-01T23:10,2026-11-02T06:40,sleep_minutes,420\n2026-11-02T23:00,later,sleep_minutes,400\n');
  assert.deepEqual(s.samples, [
    { signal: 'sleep_minutes', start: '2026-11-01T23:10', end: '2026-11-02T06:40', value: 420, unit: 'min', source: 'csv' },
    { signal: 'sleep_minutes', start: '2026-11-02T23:00', value: 400, unit: 'min', source: 'csv' },
  ]);
  assert.deepEqual(rowsOf(s.warnings), ['Row 3']);
  const t = csvToSamples('date,time,signal,value,detail\n2026-11-01,7:05 PM,heart_rate,70,\n2026-11-02,,heart_rate,71,after coffee\n'
    + '2026-11-03,7:30:15.5,heart_rate,72,\n2026-11-04,25:61,heart_rate,73,\n');
  assert.deepEqual(t.samples.map((x) => x.start), ['2026-11-01T19:05', '2026-11-02', '2026-11-03T07:30:15.5', '2026-11-04']);
  assert.equal(t.samples[1].detail, 'after coffee');
  assert.deepEqual(rowsOf(t.warnings), ['Row 5']);
  assert.match(t.warnings[0], /only the date/);
  assertPlain([...s.warnings, ...t.warnings]);
});

test('typos outside physiological limits are caught in files too', () => {
  const { samples, warnings } = csvToSamples('date,signal,value\n2026-11-01,weight,720\n2026-11-01,heart_rate,640\n2026-11-01,weight,72\n'
    + '2026-11-01,steps,-50\n2026-11-01,resting_hr,640\n');
  assert.deepEqual(samples.map((s) => s.value), [72]);
  assert.deepEqual(rowsOf(warnings), ['Row 2', 'Row 3', 'Row 5', 'Row 6']);
  assertPlain(warnings);
});

test('a brand format added to FORMATS is tried first, labels its source, and its failures are explained', () => {
  const fake = {
    id: 'fakebrand', label: 'Fake brand',
    match: (h) => h.includes('fake'),
    toSamples: (rows) => ({ samples: rows.map((r) => ({ signal: 'weight', start: r[1], value: Number(r[2]), unit: 'kg' })), warnings: [] }),
  };
  const broken = { id: 'broken', label: 'Broken', match: () => { throw new Error('boom'); }, toSamples: () => { throw new Error('boom'); } };
  const sloppy = { id: 'sloppy', label: 'Sloppy', match: () => false, toSamples: () => ({ samples: 'oops', warnings: 'not a list' }) };
  FORMATS.unshift(fake, broken, sloppy);
  try {
    const r = csvToSamples('fake,date,value\nx,2026-11-01,70\n', { person: 'alex' });
    assert.equal(r.format, 'fakebrand');
    assert.deepEqual(r.samples, [{ signal: 'weight', start: '2026-11-01', value: 70, unit: 'kg', source: 'csv:fakebrand', person: 'alex' }]);
    // a format whose match() throws is passed over, and the generic format still reads the file
    assert.equal(csvToSamples('date,signal,value\n2026-11-01,weight,70\n').format, 'generic');
    // a format that throws while reading gives a plain warning instead of an error
    const b = csvToSamples('date,signal,value\n2026-11-01,weight,70\n', { formatId: 'broken' });
    assert.deepEqual(b.samples, []);
    assert.equal(b.warnings.length, 1);
    assertPlain(b.warnings);
    // a format that returns the wrong shapes gives nothing rather than letters or an error
    assert.deepEqual(csvToSamples('date,signal,value\n2026-11-01,weight,70\n', { formatId: 'sloppy' }), { samples: [], warnings: [], format: 'sloppy' });
  } finally {
    FORMATS.splice(0, 3);
  }
  assert.equal(FORMATS.at(-1).id, 'generic');
  // the generic reader itself copes without the optional third argument, or with null
  assert.equal(FORMATS.at(-1).toSamples([['2026-11-01', 'weight', '70']], ['date', 'signal', 'value'], null).samples.length, 1);
});

test('source and person: defaults, options and per-row values', () => {
  const one = 'date,signal,value\n2026-11-01,weight,70\n';
  assert.equal(csvToSamples(one).samples[0].source, 'csv');
  assert.equal('person' in csvToSamples(one).samples[0], false);
  assert.equal(csvToSamples(one, { source: 'csv:test' }).samples[0].source, 'csv:test');
  assert.equal(csvToSamples(one, { person: 'alex' }).samples[0].person, 'alex');
  const c = csvToSamples('date,signal,value,person\n2026-11-01,weight,70,sam\n2026-11-01,weight,71,\n', { person: 'alex' });
  assert.deepEqual(c.samples.map((s) => s.person), ['sam', 'alex']);
});

test('formatId picks the format; an unknown one is explained', () => {
  const one = 'date,signal,value\n2026-11-01,weight,70\n';
  const a = csvToSamples(one, { formatId: 'generic' });
  assert.equal(a.format, 'generic');
  assert.equal(a.samples.length, 1);
  const b = csvToSamples(one, { formatId: 'nope' });
  assert.equal(b.format, null);
  assert.deepEqual(b.samples, []);
  assert.equal(b.warnings.length, 1);
  assertPlain(b.warnings);
});

test('a file full of problems gives a readable number of warnings', () => {
  const rows = Array.from({ length: 200 }, (_, i) => `2026-11-01,weight,bad${i}`);
  const r = csvToSamples(['date,signal,value', ...rows].join('\n'));
  assert.ok(r.warnings.length <= 51, String(r.warnings.length));
  assert.match(r.warnings.at(-1), /150 more/);
});

test('nothing throws on odd input', () => {
  for (const t of [null, undefined, 7, '"', ',,,', '﻿', 'date\n\n', 'a;b\n;;;\n']) {
    const r = csvToSamples(t);
    assert.ok(Array.isArray(r.samples) && Array.isArray(r.warnings), String(t));
    assertPlain(r.warnings);
  }
  assert.ok(Array.isArray(csvToSamples('date,signal,value\n2026-11-01,weight,70\n', null).samples));
  assert.equal(typeof samplesToCsv([null, 5, 'x', {}, { signal: 'weight', value: NaN }]), 'string');
  const loop = { signal: 'weight', start: '2026-11-01', value: 70, unit: 'kg', source: 'manual' };
  loop.detail = { self: loop };
  assert.equal(typeof samplesToCsv([loop]), 'string');
  assert.ok(manualToSample().errors.length >= 1);
  assert.ok(manualToSample('bp', null).errors.length >= 1);
});

// ---------- typed-in readings ----------

test('MANUAL_FIELDS lists what a person can type in, each with a label, unit and range', () => {
  const ids = ['bp', 'heart_rate', 'spo2', 'weight', 'grip', 'temperature', 'peak_cough_flow', 'fvc'];
  assert.deepEqual(Object.keys(MANUAL_FIELDS).sort(), [...ids].sort());
  for (const id of ids) {
    const f = MANUAL_FIELDS[id];
    assert.equal(typeof f.label, 'string', id);
    assert.equal(f.unit, id === 'bp' ? 'mmHg' : UNITS[id], id);
    const numbers = f.inputs.filter((i) => !i.choices);
    assert.ok(numbers.length >= 1, id);
    for (const i of numbers) {
      assert.equal(typeof i.label, 'string');
      assert.ok(Number.isFinite(i.min) && Number.isFinite(i.max) && i.min < i.max, `${id}.${i.key}`);
    }
  }
  assert.deepEqual(MANUAL_FIELDS.bp.inputs.map((i) => i.key), ['systolic', 'diastolic', 'pulse']);
  assert.equal(MANUAL_FIELDS.bp.inputs[2].optional, true);
  assert.equal(MANUAL_FIELDS.bp.inputs[0].min, 60);
  assert.equal(MANUAL_FIELDS.bp.inputs[0].max, 260);
  assert.deepEqual(MANUAL_FIELDS.grip.inputs.find((i) => i.key === 'hand').choices, ['right', 'left']);
});

test('manualToSample: blood pressure with and without a pulse', () => {
  const r = manualToSample('bp', { date: '2026-11-08', time: '07:30', values: { systolic: '124', diastolic: 82, pulse: '70' }, person: 'alex' });
  assert.deepEqual(r, { sample: { signal: 'bp', start: '2026-11-08T07:30', value: 124, value2: 82, unit: 'mmHg', source: 'manual', person: 'alex', detail: { pulse: 70 } } });
  assert.deepEqual(Object.keys(r.sample), ['signal', 'start', 'value', 'value2', 'unit', 'source', 'person', 'detail']);
  const s = manualToSample('bp', { date: '2026-11-08', values: { systolic: 124, diastolic: 82 } });
  assert.deepEqual(s, { sample: { signal: 'bp', start: '2026-11-08', value: 124, value2: 82, unit: 'mmHg', source: 'manual' } });
});

test('manualToSample: single values, grip with a hand, a decimal comma', () => {
  assert.equal(manualToSample('weight', { date: '2026-11-08', values: { value: '72,5' } }).sample.value, 72.5);
  assert.equal(manualToSample('weight', { date: '2026-11-08', values: 71 }).sample.value, 71);
  const g = manualToSample('grip', { date: '2026-11-08', values: { value: 28.5, hand: 'Left' } });
  assert.deepEqual(g, { sample: { signal: 'grip', start: '2026-11-08', value: 28.5, unit: 'kg', source: 'manual', detail: { hand: 'left' } } });
  const t = manualToSample('temperature', { date: '2026-11-08', time: '21:05', values: { value: '37.2' } });
  assert.deepEqual(t.sample, { signal: 'temperature', start: '2026-11-08T21:05', value: 37.2, unit: 'degC', source: 'manual' });
  // step only guides the input box; it is not a rule
  assert.equal(manualToSample('weight', { date: '2026-11-08', values: 72.55 }).sample.value, 72.55);
});

test('manualToSample errors are in plain words', () => {
  const cases = [
    ['bp', { date: '2026-11-08', values: { systolic: 300, diastolic: 80 } }, /60 and 260/],
    ['bp', { date: '2026-11-08', values: { systolic: 80, diastolic: 120 } }, /higher/],
    ['bp', { date: '2026-11-08', values: { systolic: 120 } }, /diastolic/],
    ['bp', { date: '2026-11-08', values: { systolic: 'abc', diastolic: 80 } }, /number/],
    ['bp', { date: '2026-11-08', values: { systolic: 120, diastolic: 80, pulse: 400 } }, /pulse/i],
    ['heart_rate', { values: { value: 60 } }, /date/],
    ['heart_rate', { date: '08/11/2026', values: { value: 60 } }, /date/],
    ['heart_rate', { date: '2026-02-30', values: { value: 60 } }, /date/],
    ['heart_rate', { date: '2026-11-08', time: '25:00', values: { value: 60 } }, /time/],
    ['grip', { date: '2026-11-08', values: { value: 30 } }, /hand/],
    ['grip', { date: '2026-11-08', values: { value: 30, hand: 'both' } }, /hand/],
    ['spo2', { date: '2026-11-08', values: { value: 0.97 } }, /50 and 100/],
    ['temperature', { date: '2026-11-08', values: { value: 98.6 } }, /30 and 45 °C/],
    ['fvc', { date: '2026-11-08', values: { value: 300 } }, /5 and 160% of predicted/],
    ['weight', { date: '2026-11-08', values: { value: '' } }, /weight/i],
    ['steps', { date: '2026-11-08', values: { value: 5000 } }, /typed in/],
  ];
  for (const [signal, input, re] of cases) {
    const r = manualToSample(signal, input);
    assert.equal(r.sample, undefined, `${signal} ${JSON.stringify(input)}`);
    assert.ok(Array.isArray(r.errors) && r.errors.length >= 1);
    assert.match(r.errors.join(' '), re, `${signal} ${JSON.stringify(input)}: ${r.errors.join(' | ')}`);
    assertPlain(r.errors);
  }
  // every problem is reported at once, so the person can fix them together
  assert.ok(manualToSample('bp', { values: { systolic: 'x' } }).errors.length >= 3);
});

// ---------- export and round trip ----------

test('samplesToCsv writes CRLF text in the generic format', () => {
  const csv = samplesToCsv([{ signal: 'weight', start: '2026-11-01', value: 70, unit: 'kg', source: 'manual' }]);
  assert.ok(csv.endsWith('\r\n'));
  const { headers, rows } = parseCsv(csv);
  assert.equal(FORMATS.find((f) => f.id === 'generic').match(headers), true);
  assert.equal(rows.length, 1);
  assert.equal(parseCsv(samplesToCsv([])).rows.length, 0);
  assert.deepEqual(parseCsv(samplesToCsv(null)).headers, headers);
});

test('samples round-trip through samplesToCsv and csvToSamples unchanged', () => {
  const samples = [
    { signal: 'weight', start: '2026-11-01', value: 72.5, unit: 'kg', source: 'manual', person: 'Alex, "Al" Smith' },
    { signal: 'bp', start: '2026-11-01T07:30', value: 124, value2: 82, unit: 'mmHg', source: 'manual', detail: { pulse: 70 } },
    { signal: 'grip', start: '2026-11-02', value: 28.5, unit: 'kg', source: 'manual', detail: { hand: 'left' } },
    { signal: 'sleep_minutes', start: '2026-11-01T23:10:00Z', end: '2026-11-02T06:40:00Z', value: 430, unit: 'min', source: 'apple-health' },
    { signal: 'spo2', start: '2026-11-03T09:00:00.000+01:00', value: 96, unit: '%', source: 'bluetooth', simulated: true },
    { signal: 'steps', start: '2026-11-03', value: 8123, unit: 'steps', source: 'demo', person: '=HYPERLINK("x")', simulated: false },
    { signal: 'walking_asymmetry', start: '2026-11-03', value: 0.5, unit: '%', source: 'apple-health' },
    { signal: 'hrv_sdnn', start: '2026-11-03', value: 0.1 + 0.2, unit: 'ms', source: 'csv' },
    { signal: 'breathing_disturbances', start: '2026-11-03', value: 3, unit: 'events/h', source: 'apple-health' },
    { signal: 'heart_rate', start: '2026-11-03', value: 61, unit: 'bpm', source: 'csv:withings', detail: { note: 'line1\nline2; with, commas' } },
    { signal: 'fvc', start: '2026-11-04', value: 82, unit: '% predicted', source: 'manual', person: "'-x" },
  ];
  const csv = samplesToCsv(samples);
  const back = csvToSamples(csv);
  assert.deepEqual(back.warnings, []);
  assert.deepEqual(back.samples, samples);
  // keys come back in the vocabulary's order, so the JSON text is identical too
  assert.equal(JSON.stringify(back.samples), JSON.stringify(samples));
  // a name that a spreadsheet would run as a formula is defused in the file, yet comes back unchanged
  assert.ok(csv.includes("'=HYPERLINK"));
  assert.doesNotMatch(csv, /(^|,)=HYPERLINK/m);
});

// ---------- hardening (review): large files, what the store accepts, risky cells ----------

test('a large file with a problem on every row does not throw, and keeps a short list with an exact count', () => {
  // US-style dates are refused on every row. 150,000 problems once overflowed the call stack.
  const lines = ['date,signal,value'];
  for (let i = 0; i < 150000; i++) lines.push(`11/0${1 + (i % 9)}/2026,heart_rate,${60 + (i % 30)}`);
  const r = csvToSamples(lines.join('\n'));
  assert.deepEqual(r.samples, []);
  assert.equal(r.warnings.length, 51);
  assert.match(r.warnings[0], /^Row 2: .*day\/month or month\/day/);
  assert.match(r.warnings[49], /^Row 51: /);
  assert.equal(r.warnings[50], '...and 149950 more problems that are not shown.');
});

test('the generic format lists at most 50 problems, in row order, and counts the rest', () => {
  const rows = Array.from({ length: 120 }, (_, i) => ['2026-11-01', 'weight', `bad${i}`]);
  const g = FORMATS.at(-1).toSamples(rows, ['date', 'signal', 'value']);
  assert.equal(g.warnings.length, 50);
  assert.equal(g.moreWarnings, 70);
  assert.deepEqual(rowsOf(g.warnings).slice(0, 3), ['Row 2', 'Row 3', 'Row 4']);
  // a short list has no count at all
  assert.equal('moreWarnings' in FORMATS.at(-1).toSamples(rows.slice(0, 3), ['date', 'signal', 'value']), false);
  // a blood pressure half paired after the main pass still lands in row order among the kept problems
  const bp = [['2026-11-01T08:00', 'systolic', '130'], ...rows.slice(0, 60)];
  const b = FORMATS.at(-1).toSamples(bp, ['date', 'signal', 'value']);
  assert.match(b.warnings[0], /^Row 2: this systolic reading/);
  assert.equal(b.warnings.length, 50);
  assert.equal(b.moreWarnings, 11);
});

test('thousands of unknown names give a short list, and one extra problem reads in the singular', () => {
  const names = Array.from({ length: 3000 }, (_, i) => `2026-11-01,thing ${i},5`);
  const r = csvToSamples(['date,signal,value', ...names].join('\n'));
  assert.equal(r.warnings.length, 51);
  assert.equal(r.warnings[50], '...and 2950 more problems that are not shown.');
  const one = Array.from({ length: 51 }, (_, i) => `2026-11-01,weight,bad${i}`);
  assert.equal(csvToSamples(['date,signal,value', ...one].join('\n')).warnings.at(-1), '...and 1 more problem that is not shown.');
});

test('every sample has a unit: breathing disturbances without one are skipped with a reason', () => {
  const r = csvToSamples('date,signal,value,unit\n2026-11-01,breathing_disturbances,3,per hour\n'
    + '2026-11-02,breathing_disturbances,4,\n2026-11-03,Breathing disturbances (events/h),5,\n');
  assert.deepEqual(r.samples.map((s) => [s.value, s.unit]), [[3, 'per hour'], [5, 'events/h']]);
  assert.deepEqual(rowsOf(r.warnings), ['Row 3']);
  assert.match(r.warnings[0], /unit/);
  assertPlain(r.warnings);
});

test('dates the store would drop are refused here with a reason: a year before 1000, an end before its start', () => {
  const text = [
    'start,end,signal,value',
    '0999-11-01,,weight,70', // a typo for the year
    '2026-11-02T06:40,2026-11-01T23:10,sleep_minutes,420', // two local times, end first
    '2026-11-02,2026-11-01,steps,5000', // two dates, end first
    '2026-11-01T23:10:00Z,2026-11-02T06:40:00+01:00,sleep_minutes,400', // 23:10 UTC to 05:40 UTC: fine
    '2026-11-01T23:10:00+01:00,2026-11-01T22:30:00Z,sleep_minutes,380', // 22:10 UTC to 22:30 UTC: fine
    '2026-11-01T23:10:00Z,2026-11-01T23:30:00+01:00,sleep_minutes,10', // 23:10 UTC to 22:30 UTC: end first
    '2026-11-01T08:00:00,2026-11-01T08:00,heart_rate,60', // the same time written two ways
    '2026-11-02,2026-11-01T23:00,steps,4000', // a date, then a time on the day before: end first
    '2026-11-02,2026-11-02T06:00,steps,4100', // a date, then a time on the same day: fine
    '2026-11-02,2026-11-01T23:00:00-12:00,steps,4200', // a date next to a zoned time: calendar days as written
    '2026-11-02T08:00:00Z,2026-11-01T23:00,steps,4300', // a zoned and an unzoned time: not compared (no zone guess)
  ].join('\n');
  const { samples, warnings } = csvToSamples(text);
  assert.deepEqual(samples.map((s) => s.value), [400, 380, 60, 4100, 4300]);
  assert.deepEqual(rowsOf(warnings), ['Row 2', 'Row 3', 'Row 4', 'Row 7', 'Row 9', 'Row 11']);
  assert.match(warnings[1], /end.*before.*start/);
  assertPlain(warnings);
  assert.match(manualToSample('weight', { date: '0999-11-08', values: 70 }).errors.join(' '), /date/);
});

test('FVC under 1 is not read as a fraction: it could be litres', () => {
  const r = csvToSamples('date,signal,value,unit\n2026-11-01,fvc,0.8,\n2026-11-02,fvc,0.8,fraction\n2026-11-03,fvc,82,%\n2026-11-04,fvc,-5,\n');
  assert.deepEqual(r.samples.map((s) => s.value), [80, 82]);
  assert.deepEqual(rowsOf(r.warnings), ['Row 2', 'Row 5']);
  assert.match(r.warnings[0], /litres/);
  assert.doesNotMatch(r.warnings[1], /litres/); // a value below zero is a typo, not litres
  assertPlain(r.warnings);
});

test('"Start Time" and "End Time" columns are the start and end when there is no date column', () => {
  const a = csvToSamples('Start Time,End Time,Type,Value\n2026-11-01 23:10,2026-11-02 06:40,sleep_minutes,420\n');
  assert.deepEqual(a.samples, [{ signal: 'sleep_minutes', start: '2026-11-01T23:10', end: '2026-11-02T06:40', value: 420, unit: 'min', source: 'csv' }]);
  assert.deepEqual(a.warnings, []);
  // next to a date column, Start Time is still the time of day
  assert.equal(csvToSamples('Date,Start Time,Type,Value\n2026-11-01,07:30,heart_rate,64\n').samples[0].start, '2026-11-01T07:30');
});

test('a pulse with letters after the number is left out, not read as the number', () => {
  const r = csvToSamples('Date,Systolic,Diastolic,Pulse\n2026-11-01,120,80,70x\n2026-11-02,121,81,66 bpm\n');
  assert.deepEqual(r.samples.map((s) => s.detail), [undefined, { pulse: 66 }]);
  assert.deepEqual(rowsOf(r.warnings), ['Row 2']);
  assert.match(r.warnings[0], /pulse/);
});

test('a source option outside the vocabulary falls back to csv', () => {
  const one = 'date,signal,value\n2026-11-01,weight,70\n';
  for (const source of [null, 5, '', 'somewhere']) assert.equal(csvToSamples(one, { source }).samples[0].source, 'csv', String(source));
  assert.equal(csvToSamples(one, { source: 'apple-health' }).samples[0].source, 'apple-health');
});

test('export defuses every cell a spreadsheet could run as a formula (OWASP list), and import restores it', () => {
  // OWASP CSV injection: = + - @, tab, carriage return, line feed, and their full-width forms
  const risky = ['=1+2', '+1', '-1', '@SUM(1)', '\t=1', '\r=1', '\n=1', '＝1', '＋1', '－1', '＠1', "'=1"];
  const samples = risky.map((p, k) => ({
    signal: 'weight', start: `2026-11-${String(k + 1).padStart(2, '0')}`, value: 70, unit: 'kg', source: 'manual', person: p, detail: p,
  }));
  const csv = samplesToCsv(samples);
  const { headers, rows } = parseCsv(csv);
  for (const name of ['person', 'detail']) {
    const k = headers.indexOf(name);
    for (const row of rows) assert.doesNotMatch(row[k], /^[=+\-@\t\r\n＝＋－＠]/, JSON.stringify(row[k]));
  }
  const back = csvToSamples(csv);
  assert.deepEqual(back.warnings, []);
  assert.deepEqual(back.samples, samples);
});

test("the generic format never changes the caller's rows (only csvToSamples lets its own rows go)", () => {
  // a paired blood pressure sits where its systolic row was, before the weight read between the halves
  const rows = [['2026-11-01T08:00', 'systolic', '130'], ['2026-11-01', 'weight', '70'], ['2026-11-01T08:00', 'diastolic', '85']];
  const copy = JSON.parse(JSON.stringify(rows));
  const out = FORMATS.at(-1).toSamples(rows, ['date', 'signal', 'value']);
  assert.deepEqual(rows, copy);
  assert.deepEqual(out.samples.map((s) => s.signal), ['bp', 'weight']);
  // and csvToSamples gives the same samples from the same text
  const r = csvToSamples('date,signal,value\n2026-11-01T08:00,systolic,130\n2026-11-01,weight,70\n2026-11-01T08:00,diastolic,85\n');
  assert.deepEqual(r.samples.map(({ source, ...rest }) => rest), out.samples);
});

test('a brand format that lists many problems or odd entries still gives a readable result', () => {
  const chatty = {
    id: 'chatty', label: 'Chatty', match: () => false,
    toSamples: () => ({
      samples: [null, 5, 'x', { signal: 'weight', start: '2026-11-01', value: 70, unit: 'kg' }],
      warnings: Array.from({ length: 120 }, (_, i) => `Row ${i + 2}: odd.`),
    }),
  };
  FORMATS.unshift(chatty);
  try {
    const r = csvToSamples('date,signal,value\n2026-11-01,weight,70\n', { formatId: 'chatty' });
    assert.deepEqual(r.samples, [{ signal: 'weight', start: '2026-11-01', value: 70, unit: 'kg', source: 'csv:chatty' }]);
    assert.equal(r.warnings.length, 51);
    assert.equal(r.warnings[50], '...and 70 more problems that are not shown.');
  } finally {
    FORMATS.shift();
  }
  assert.equal(FORMATS.at(-1).id, 'generic');
});

test('nothing throws on objects that cannot be turned into text', () => {
  const odd = Object.create(null); // String(odd) throws a TypeError
  assert.equal(typeof samplesToCsv([{ signal: 'weight', start: odd, value: 70, unit: 'kg', source: 'manual', person: odd }]), 'string');
  assert.ok(manualToSample(odd).errors.length >= 1);
  const typed = manualToSample('grip', { date: odd, time: odd, values: { value: odd, hand: odd } });
  assert.ok(typed.errors.length >= 3, typed.errors.join(' | '));
  assertPlain(typed.errors);
  const r = csvToSamples('date,signal,value\n2026-11-01,weight,70\n', { formatId: odd, person: odd, source: odd });
  assert.deepEqual(r.samples, []);
  assert.equal(r.warnings.length, 1);
  assertPlain(r.warnings);
});

// ---------- brand formats: Withings ----------
// Column names from the fact-checked research notes (data_formats_and_browser_limits.md, section 4)
// and their sources: Withings Help on the export, and the logbook and optimitron parsers.
// weight.csv: Date, Weight (kg), Fat mass (kg), Bone mass (kg), Muscle mass (kg), Hydration (kg), Comments
// ("(lb)" for pounds; French "Poids (kg)", "Masse grasse (kg)"). bp.csv: Date, Heart Rate, Systolic,
// Diastolic, Comments. blood_pressure.csv: Date, Systolic (mmHg), Diastolic (mmHg), Heart rate (bpm), Comments.
// Dates are naive local times such as 2026-06-08 07:12:33.

const formatById = (id) => FORMATS.find((f) => f.id === id);

test('Withings: both formats are tried before the generic format, which stays last', () => {
  const ids = FORMATS.map((f) => f.id);
  assert.ok(ids.includes('withings-weight') && ids.includes('withings-bp'), ids.join(', '));
  assert.ok(ids.indexOf('withings-weight') < ids.indexOf('generic'));
  assert.ok(ids.indexOf('withings-bp') < ids.indexOf('generic'));
  assert.equal(ids.at(-1), 'generic');
});

test('Withings weight matches a Date column with Weight or Poids in kg or lb, in any case and spacing', () => {
  const weight = formatById('withings-weight');
  for (const h of [
    ['Date', 'Weight (kg)', 'Fat mass (kg)', 'Bone mass (kg)', 'Muscle mass (kg)', 'Hydration (kg)', 'Comments'],
    ['Date', 'Weight (lb)', 'Fat mass (lb)', 'Bone mass (lb)', 'Muscle mass (lb)', 'Hydration (lb)', 'Comments'],
    ['Date', 'Poids (kg)', 'Masse grasse (kg)'],
    ['date', 'POIDS (lb)'],
    ['  DATE ', ' weight  ( LB ) '],
  ]) assert.equal(weight.match(h), true, h.join('|'));
  for (const h of [
    ['Date', 'Weight'], // no unit: kg or lb would be a guess
    ['Weight (kg)', 'Fat mass (kg)'], // no date
    ['Date', 'Weight (st)'], // stones: not in the sources
    ['Date', 'Body weight (kg)'],
    ['date', 'signal', 'value'],
    [],
  ]) assert.equal(weight.match(h), false, h.join('|'));
  // loose headers are read, not only matched: 81 lb x 0.45359237 = 36.74098197 kg
  const r = csvToSamples('  DATE , weight  ( LB ) \n2026-06-08 07:12:33,81\n');
  assert.equal(r.format, 'withings-weight');
  close(r.samples[0].value, 36.74098197);
});

test('Withings blood pressure matches Date, Systolic, Diastolic and Heart rate columns, with or without their units', () => {
  const bp = formatById('withings-bp');
  for (const h of [
    ['Date', 'Heart Rate', 'Systolic', 'Diastolic', 'Comments'], // bp.csv
    ['Date', 'Systolic (mmHg)', 'Diastolic (mmHg)', 'Heart rate (bpm)', 'Comments'], // blood_pressure.csv
    [' date', 'HEART  RATE ', 'systolic ( MMHG )', ' Diastolic'],
  ]) assert.equal(bp.match(h), true, h.join('|'));
  for (const h of [
    ['Date', 'Systolic', 'Diastolic', 'Pulse'], // a blood pressure file from elsewhere
    ['Date', 'Systolic', 'Diastolic'],
    ['Date', 'Heart Rate'],
    ['Date', 'Systolic (kPa)', 'Diastolic (kPa)', 'Heart Rate'],
    ['Systolic', 'Diastolic', 'Heart Rate'], // no date
  ]) assert.equal(bp.match(h), false, h.join('|'));
  const r = csvToSamples(' date ,HEART  RATE, systolic ( mmHg ) , DIASTOLIC \n2026-06-08 07:12:33,66,121,79\n');
  assert.equal(r.format, 'withings-bp');
  assert.deepEqual(r.samples.map((s) => [s.signal, s.value, s.value2]), [['bp', 121, 79], ['heart_rate', 66, undefined]]);
});

test('Withings weight.csv in kg: a weight per row, and body fat worked out from the fat mass', () => {
  const text = [
    'Date,Weight (kg),Fat mass (kg),Bone mass (kg),Muscle mass (kg),Hydration (kg),Comments',
    '2026-06-08 07:12:33,80,20,3.1,56.9,41.2,',
    '2026-06-09 07:05:10,72.5,18.2,2.9,51.4,39.1,after a run',
    '2026-06-10 07:01:00,71.9,,,,,no body composition',
  ].join('\n');
  const r = csvToSamples(text);
  assert.equal(r.format, 'withings-weight');
  assert.deepEqual(r.warnings, []);
  const kg = (start, value) => ({ signal: 'weight', start, value, unit: 'kg', source: 'csv:withings-weight' });
  const fat = (start, value) => ({ signal: 'body_fat', start, value, unit: '%', source: 'csv:withings-weight', detail: { computedFrom: 'fat mass and weight' } });
  assert.equal(r.samples.length, 5);
  // 20 kg / 80 kg x 100 = 25%
  assert.deepEqual(r.samples.slice(0, 2), [kg('2026-06-08T07:12:33', 80), fat('2026-06-08T07:12:33', 25)]);
  // 18.2 / 72.5 = 182 / 725 = 0.251034482758620689..., so 25.1034482758620689...%
  // (stored to 12 significant digits, as every computed value is)
  assert.deepEqual(r.samples[2], kg('2026-06-09T07:05:10', 72.5));
  assert.deepEqual({ ...r.samples[3], value: 'checked below' }, fat('2026-06-09T07:05:10', 'checked below'));
  close(r.samples[3].value, 25.1034482758620689);
  // no fat mass on the row: the weight alone, without a warning
  assert.deepEqual(r.samples[4], kg('2026-06-10T07:01:00', 71.9));
});

test('Withings weight.csv in lb: the weight and the fat mass are turned into kg', () => {
  const text = 'Date,Weight (lb),Fat mass (lb),Bone mass (lb),Muscle mass (lb),Hydration (lb),Comments\n'
    + '2026-06-08 07:12:33,160,40,6.8,125.4,90.8,\n'
    + '2026-06-09 07:00:00,150,33,,,,\n';
  const r = csvToSamples(text);
  assert.equal(r.format, 'withings-weight');
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(r.samples.map((s) => [s.signal, s.unit]), [['weight', 'kg'], ['body_fat', '%'], ['weight', 'kg'], ['body_fat', '%']]);
  // 160 lb x 0.45359237 = 45.359237 + 27.2155422 = 72.5747792 kg
  close(r.samples[0].value, 72.5747792);
  // 40 lb = 18.1436948 kg, and 18.1436948 / 72.5747792 = 40 / 160 = 0.25 (the factor cancels): 25%
  close(r.samples[1].value, 25);
  // 150 lb x 0.45359237 = 45.359237 + 22.6796185 = 68.0388555 kg; 33 / 150 = 0.22: 22%
  close(r.samples[2].value, 68.0388555);
  close(r.samples[3].value, 22);
});

test('Withings weight.csv with French headers (Poids, Masse grasse)', () => {
  const r = csvToSamples('Date,Poids (kg),Masse grasse (kg),Masse osseuse (kg),Masse musculaire (kg)\n2026-06-08 07:12:33,64,12.8,2.6,48.1\n');
  assert.equal(r.format, 'withings-weight');
  assert.deepEqual(r.warnings, []);
  // 12.8 / 64 = 0.2: 20%
  assert.deepEqual(r.samples.map((s) => [s.signal, s.start, s.value, s.unit, s.source]), [
    ['weight', '2026-06-08T07:12:33', 64, 'kg', 'csv:withings-weight'],
    ['body_fat', '2026-06-08T07:12:33', 20, '%', 'csv:withings-weight'],
  ]);
  // in pounds: 141.1 lb x 0.45359237 = 63.95652417 + 0.045359237 = 64.001883407 kg; 28.22 / 141.1 = 0.2: 20%
  const lb = csvToSamples('Date,Poids (lb),Masse grasse (lb)\n2026-06-08 07:12:33,141.1,28.22\n');
  close(lb.samples[0].value, 64.001883407);
  close(lb.samples[1].value, 20);
  // if a French file comes with semicolons and decimal commas (the sources do not say), it reads the same
  const semi = csvToSamples('Date;Poids (kg);Masse grasse (kg)\n2026-06-08 07:12:33;72,5;14,5\n');
  assert.equal(semi.format, 'withings-weight');
  // 14.5 / 72.5 = 0.2: 20%
  assert.deepEqual(semi.samples.map((s) => s.signal), ['weight', 'body_fat']);
  assert.equal(semi.samples[0].value, 72.5);
  close(semi.samples[1].value, 20);
});

test('Withings weight: "Fat free mass" and "Fat mass (%)" are never taken for the fat mass', () => {
  // optimitron lists Fat free mass (kg) as well; logbook also knows a Fat mass (%) column
  const a = csvToSamples('Date,Weight (kg),Fat free mass (kg),Fat mass (kg)\n2026-06-08 07:12:33,80,60,20\n');
  // the fat mass is 20 kg, not the 60 kg of fat-free mass: 20 / 80 = 25%
  assert.deepEqual(a.samples.map((s) => s.signal), ['weight', 'body_fat']);
  close(a.samples[1].value, 25);
  const b = csvToSamples('Date,Weight (kg),Fat mass (%)\n2026-06-08 07:12:33,80,25\n');
  assert.deepEqual(b.samples.map((s) => [s.signal, s.value]), [['weight', 80]]);
  assert.deepEqual(b.warnings, []);
});

test('Withings dates are naive local times, kept as YYYY-MM-DDTHH:MM:SS with no offset', () => {
  const w = csvToSamples('Date,Weight (kg)\n2026-06-08 07:12:33,72.5\n2026-06-08 23:59:59,72.1\n');
  assert.deepEqual(w.samples.map((s) => s.start), ['2026-06-08T07:12:33', '2026-06-08T23:59:59']);
  const b = csvToSamples('Date,Heart Rate,Systolic,Diastolic\n2026-06-08 00:00:01,66,121,79\n');
  assert.deepEqual(b.samples.map((s) => s.start), ['2026-06-08T00:00:01', '2026-06-08T00:00:01']);
  // no Z and no offset is added, and nothing reads this computer's time zone, so no reading moves to another day
  for (const s of [...w.samples, ...b.samples]) assert.match(s.start, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
  // dates that are not real ones are refused with a reason
  const bad = csvToSamples('Date,Weight (kg)\n08/06/2026,72.5\n2026-06-31 07:00:00,72.5\n');
  assert.deepEqual(bad.samples, []);
  assert.deepEqual(rowsOf(bad.warnings), ['Row 2', 'Row 3']);
  assert.match(bad.warnings[0], /day\/month or month\/day/);
  assertPlain(bad.warnings);
});

test('Withings weight: a row with an empty weight is skipped with a plain warning, and so are other bad rows', () => {
  const text = [
    'Date,Weight (kg),Fat mass (kg)',
    '2026-06-08 07:12:33,,18.2', // row 2: no weight, so no body fat either
    '2026-06-09 07:00:00,72.5,', // row 3: no fat mass: the weight alone
    '2026-06-10 07:00:00,abc,18', // row 4: not a number
    '2026-06-11 07:00:00,720,18', // row 5: outside 20 to 350 kg, a typo
    '2026-06-12 07:00:00,72,9O', // row 6: the fat mass is a typo: the weight is kept
    '2026-06-13 07:00:00,72,90', // row 7: 90 / 72 is over 100%: the weight is kept
    '2026-06-14 07:00:00,72,5,18', // row 8: 72,5 split into two cells
  ].join('\n');
  const r = csvToSamples(text);
  assert.deepEqual(r.samples.map((s) => [s.start, s.signal, s.value]), [
    ['2026-06-09T07:00:00', 'weight', 72.5], ['2026-06-12T07:00:00', 'weight', 72], ['2026-06-13T07:00:00', 'weight', 72],
  ]);
  assert.deepEqual(rowsOf(r.warnings), ['Row 2', 'Row 4', 'Row 5', 'Row 6', 'Row 7', 'Row 8']);
  assert.equal(r.warnings[0], 'Row 2: there is no weight, so it was skipped.');
  assert.match(r.warnings[1], /weight is not a number/);
  assert.match(r.warnings[2], /20 to 350 kg/);
  assert.match(r.warnings[3], /fat mass is not a number.*only the weight was kept/);
  assert.match(r.warnings[4], /100%.*only the weight was kept/);
  assert.match(r.warnings[5], /more cells/);
  assertPlain(r.warnings);
});

test('Withings bp.csv: a blood pressure per row and, when the row has one, a heart rate from the cuff', () => {
  const text = [
    'Date,Heart Rate,Systolic,Diastolic,Comments',
    '2026-06-08 07:12:33,66,121,79,',
    '2026-06-09 07:10:02,,118,77,after coffee', // row 3: no heart rate: the blood pressure alone
    '2026-06-10 07:00:00,abc,119,78,', // row 4: a bad heart rate is left out
    '2026-06-11 07:00:00,70,80,120,', // row 5: the numbers are swapped: the row is skipped
    '2026-06-12 07:00:00,71,,78,', // row 6: no systolic: the row is skipped
  ].join('\n');
  const r = csvToSamples(text, { person: 'alex' });
  assert.equal(r.format, 'withings-bp');
  const from = { source: 'csv:withings-bp', person: 'alex' };
  assert.deepEqual(r.samples, [
    { signal: 'bp', start: '2026-06-08T07:12:33', value: 121, value2: 79, unit: 'mmHg', ...from, detail: { pulse: 66 } },
    { signal: 'heart_rate', start: '2026-06-08T07:12:33', value: 66, unit: 'bpm', ...from, detail: { from: 'blood pressure cuff' } },
    { signal: 'bp', start: '2026-06-09T07:10:02', value: 118, value2: 77, unit: 'mmHg', ...from },
    { signal: 'bp', start: '2026-06-10T07:00:00', value: 119, value2: 78, unit: 'mmHg', ...from },
  ]);
  assert.deepEqual(rowsOf(r.warnings), ['Row 4', 'Row 5', 'Row 6']);
  assert.match(r.warnings[0], /pulse is not a number/);
  assert.match(r.warnings[1], /higher/);
  assert.match(r.warnings[2], /both numbers/);
  assertPlain(r.warnings);
});

test('Withings blood_pressure.csv headers with units read the same way', () => {
  const r = csvToSamples('Date,Systolic (mmHg),Diastolic (mmHg),Heart rate (bpm),Comments\n2026-06-08 07:12:33,121,79,66,\n2026-06-09 07:00:00,300,79,66,\n');
  assert.equal(r.format, 'withings-bp');
  assert.deepEqual(r.samples, [
    { signal: 'bp', start: '2026-06-08T07:12:33', value: 121, value2: 79, unit: 'mmHg', source: 'csv:withings-bp', detail: { pulse: 66 } },
    { signal: 'heart_rate', start: '2026-06-08T07:12:33', value: 66, unit: 'bpm', source: 'csv:withings-bp', detail: { from: 'blood pressure cuff' } },
  ]);
  // a systolic of 300 is outside 60 to 260 mmHg: that row is skipped, its heart rate too
  assert.deepEqual(rowsOf(r.warnings), ['Row 3']);
  assertPlain(r.warnings);
});

test('a Withings blood pressure file gives the blood pressure samples the generic format gave, plus the heart rate', () => {
  for (const text of [
    'Date,Heart Rate,Systolic,Diastolic,Comments\n2026-06-08 07:12:33,66,121,79,\n2026-06-09 07:10:02,,118,77,x\n'
      + '2026-06-10 07:00:00,400,119,78,\n2026-06-11 07:00:00,70,80,120,\n2026-06-12 07:00:00,64,124,82,\n',
    'Date,Systolic (mmHg),Diastolic (mmHg),Heart rate (bpm),Comments\n2026-06-08 07:12:33,121,79,66,\n2026-06-09 07:00:00,122,80,,\n',
  ]) {
    const withings = csvToSamples(text);
    const generic = csvToSamples(text, { formatId: 'generic' });
    const noSource = ({ source, ...rest }) => rest;
    assert.equal(withings.format, 'withings-bp');
    assert.deepEqual(withings.samples.filter((s) => s.signal === 'bp').map(noSource), generic.samples.map(noSource));
    assert.deepEqual(withings.warnings, generic.warnings);
    // one heart rate for each blood pressure that kept its pulse: same time, same number
    const pulses = generic.samples.filter((s) => s.detail?.pulse !== undefined).map((s) => [s.start, s.detail.pulse]);
    assert.ok(pulses.length >= 1);
    assert.deepEqual(withings.samples.filter((s) => s.signal === 'heart_rate').map((s) => [s.start, s.value]), pulses);
    assert.equal(withings.samples.length, generic.samples.length + pulses.length);
  }
});

test('files that are not Withings exports still go to the generic format', () => {
  const long = csvToSamples('date,signal,value\n2026-11-01,weight,70\n2026-11-01,heart_rate,64\n');
  assert.equal(long.format, 'generic');
  assert.deepEqual(long.samples.map((s) => s.source), ['csv', 'csv']);
  // a blood pressure file whose pulse column is called Pulse: read as before, no heart rate samples added
  const cuff = csvToSamples('Date,Time,Systolic,Diastolic,Pulse\n2026-11-01,08:15,118,76,66\n');
  assert.equal(cuff.format, 'generic');
  assert.deepEqual(cuff.samples, [{ signal: 'bp', start: '2026-11-01T08:15', value: 118, value2: 76, unit: 'mmHg', source: 'csv', detail: { pulse: 66 } }]);
  // a weight column without its unit is not taken for Withings, and the generic format cannot read it either
  const bare = csvToSamples('Date,Weight\n2026-11-01,70\n');
  assert.equal(bare.format, null);
  assert.deepEqual(bare.samples, []);
  assertPlain(bare.warnings);
});

test('Withings samples are labelled csv:withings-weight or csv:withings-bp, and round-trip through the generic CSV', () => {
  const w = csvToSamples('Date,Weight (kg),Fat mass (kg)\n2026-06-08 07:12:33,80,20\n', { person: 'alex' });
  assert.deepEqual(w.samples.map((s) => [s.signal, s.source, s.person]), [
    ['weight', 'csv:withings-weight', 'alex'], ['body_fat', 'csv:withings-weight', 'alex'],
  ]);
  const b = csvToSamples('Date,Heart Rate,Systolic,Diastolic\n2026-06-08 07:12:33,66,121,79\n');
  assert.deepEqual(b.samples.map((s) => [s.signal, s.source]), [['bp', 'csv:withings-bp'], ['heart_rate', 'csv:withings-bp']]);
  assert.equal('person' in b.samples[1], false);
  // a source the caller asks for is kept
  assert.equal(csvToSamples('Date,Weight (kg)\n2026-06-08 07:12:33,80\n', { source: 'csv:test' }).samples[0].source, 'csv:test');
  // written out and read back in the generic format, they come back unchanged, source and all
  const all = [...w.samples, ...b.samples];
  const back = csvToSamples(samplesToCsv(all));
  assert.equal(back.format, 'generic');
  assert.deepEqual(back.warnings, []);
  assert.deepEqual(back.samples, all);
});

test('the Withings readers keep the brand-format contract: no context needed, at most 50 warnings, rows left alone', () => {
  const weight = formatById('withings-weight');
  const bp = formatById('withings-bp');
  assert.deepEqual(weight.toSamples([['2026-06-08 07:12:33', '72.5']], ['Date', 'Weight (kg)']),
    { samples: [{ signal: 'weight', start: '2026-06-08T07:12:33', value: 72.5, unit: 'kg' }], warnings: [] });
  assert.equal(weight.toSamples([['2026-06-08 07:12:33', '72.5']], ['Date', 'Weight (kg)'], null).samples.length, 1);
  const empty = weight.toSamples(Array.from({ length: 120 }, () => ['2026-06-08 07:12:33', '']), ['Date', 'Weight (kg)']);
  assert.equal(empty.warnings.length, 50);
  assert.equal(empty.moreWarnings, 70);
  assert.deepEqual(rowsOf(empty.warnings).slice(0, 2), ['Row 2', 'Row 3']);
  const rows = [['2026-06-08 07:12:33', '66', '121', '79']];
  const copy = JSON.parse(JSON.stringify(rows));
  assert.deepEqual(bp.toSamples(rows, ['Date', 'Heart Rate', 'Systolic', 'Diastolic']).samples.map((s) => s.signal), ['bp', 'heart_rate']);
  assert.deepEqual(rows, copy);
  // asked for by name on a file without its columns, the weight reader says what it needs
  const wrong = csvToSamples('date,signal,value\n2026-11-01,weight,70\n', { formatId: 'withings-weight' });
  assert.deepEqual(wrong.samples, []);
  assert.match(wrong.warnings[0], /Weight \(kg\)/);
  assertPlain(wrong.warnings);
});
