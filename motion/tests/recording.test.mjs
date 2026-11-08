// Tests for motion/web/recording.js (CONTRACT.md section 8). Run: node --test "motion/tests/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseRecording } from '../web/recording.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const fixture = (file, name = file) => ({ name, text: readFileSync(join(FIXTURES, file), 'utf8') });
const FIELDS = ['t', 'ax', 'ay', 'az', 'gx', 'gy', 'gz', 'lx', 'ly', 'lz'];
const DEG = 180 / Math.PI;

function close(actual, expected, tol, what) {
  assert.ok(typeof actual === 'number' && Math.abs(actual - expected) <= tol, `${what}: got ${actual}, expected ${expected}`);
}

// Every result must be a section 2 recording with section 1 samples and increasing t.
function checkShape(res) {
  assert.equal(res.ok, true, res.error);
  assert.equal(res.error, null);
  assert.ok(Array.isArray(res.warnings));
  const rec = res.recording;
  assert.equal(rec.v, 1);
  assert.equal(rec.kind, 'rfn-walk-recording');
  assert.match(rec.id, /^[A-Za-z0-9_-]{6,64}$/);
  for (const k of ['goT', 'stopT', 'distance_m']) assert.ok(rec[k] === null || Number.isFinite(rec[k]), k);
  assert.ok([null, 'tap', 'auto', 'timeout'].includes(rec.stopBy));
  assert.ok(rec.samples.length > 0);
  rec.samples.forEach((s, i) => {
    assert.deepEqual(Object.keys(s), FIELDS);
    for (const k of FIELDS) assert.ok(s[k] === null || Number.isFinite(s[k]), `sample ${i} ${k}`);
    if (i) assert.ok(s.t > rec.samples[i - 1].t, `t increases at sample ${i}`);
  });
  return rec;
}

// ------------------------------------------------------------------ fixtures, one per format

test('rfn-json: our own recording passes through with goT, stopT, stopBy and distance_m', () => {
  const res = parseRecording([fixture('rfn-walk.json')]);
  assert.equal(res.format, 'rfn-json');
  const rec = checkShape(res);
  const raw = JSON.parse(fixture('rfn-walk.json').text);
  assert.equal(rec.samples.length, 8);
  assert.deepEqual(rec.samples, raw.samples);
  assert.equal(rec.id, raw.id);
  assert.equal(rec.goT, 40);
  assert.equal(rec.stopT, 140);
  assert.equal(rec.stopBy, 'tap');
  assert.equal(rec.distance_m, 10);
  assert.equal(rec.placement, 'waist');
  assert.equal(rec.createdAt, raw.createdAt);
  assert.deepEqual(res.warnings, []);
});

test('rfn-json: a saved walk record is unwrapped, and simulated walks stay labelled', () => {
  const raw = JSON.parse(fixture('rfn-walk.json').text);
  raw.simulated = true;
  raw.truth = { onsetT: 50, endT: 130, steps: 2, duration_s: 0.08, speed_mps: 1.2 };
  const wrapped = { v: 1, kind: 'rfn-walk', id: raw.id, distance_m: 10, result: {}, recording: raw };
  const res = parseRecording([{ name: 'walk.json', text: JSON.stringify(wrapped) }]);
  const rec = checkShape(res);
  assert.equal(rec.simulated, true);
  assert.deepEqual(rec.truth, raw.truth);
  assert.ok(res.warnings.some((w) => /inside this walk/.test(w)));
});

test('rfn-json: bad fields are cleaned, not trusted', () => {
  const raw = JSON.parse(fixture('rfn-walk.json').text);
  Object.assign(raw, { id: 'bad id!', distance_m: 500, stopBy: 'magic', placement: 'head' });
  raw.samples.push(null, { t: 'x' });
  const res = parseRecording([{ name: 'w.json', text: JSON.stringify(raw) }]);
  const rec = checkShape(res);
  assert.match(rec.id, /^imp-js-/);
  assert.equal(rec.distance_m, null);
  assert.equal(rec.stopBy, null);
  assert.equal(rec.placement, null);
  assert.equal(rec.samples.length, 8);
});

test('gyro-starter-csv: busiest source, A presses become goT and stopT, units unchanged', () => {
  const res = parseRecording([fixture('gyro-starter.csv', 'motion-20261108-121203.csv')]);
  assert.equal(res.format, 'gyro-starter-csv');
  const rec = checkShape(res);
  assert.equal(rec.samples.length, 8); // phone has 8 readings, watch has 2
  assert.ok(res.warnings.some((w) => /2 devices/.test(w) && /phone/.test(w)), res.warnings.join(' | '));
  assert.deepEqual(rec.samples[0], { t: 1000, ax: 0.12, ay: 9.6, az: 1.1, gx: 1.5, gy: -0.5, gz: 0.25, lx: 0.1, ly: -0.2, lz: 0.3 });
  assert.equal(rec.samples[3].lx, null); // empty cells are null, not 0
  assert.equal(rec.samples[7].t, 1116.9);
  assert.equal(rec.goT, 1040); // first A down
  assert.equal(rec.stopT, 1105.5); // next A down (the A up and the B press are ignored)
  assert.equal(rec.stopBy, 'tap');
  assert.equal(rec.distance_m, null);
  assert.equal(rec.createdAt, '2026-11-08T12:12:03.120Z');
  assert.equal(rec.device.importedFrom, 'gyro-starter-csv');
});

test('gyro-starter-csv: one A press gives no marks', () => {
  const text = fixture('gyro-starter.csv').text.split('\r\n').filter((l) => !l.includes('1105.5')).join('\r\n');
  const rec = checkShape(parseRecording([{ name: 'g.csv', text }]));
  assert.equal(rec.goT, null);
  assert.equal(rec.stopT, null);
  assert.equal(rec.stopBy, null);
});

test('sensor-logger-csv (Android set): TotalAcceleration, Accelerometer, Gravity, Gyroscope merged by time', () => {
  const files = ['TotalAcceleration', 'Accelerometer', 'Gravity', 'Gyroscope'].map((s) => fixture(`sensor-logger_${s}.csv`, `${s}.csv`));
  const res = parseRecording(files);
  assert.equal(res.format, 'sensor-logger-csv');
  const rec = checkShape(res);
  assert.equal(rec.samples.length, 6);
  assert.deepEqual(rec.samples.map((s) => s.t), [0, 10, 20, 30, 40, 50]); // epoch ns -> ms from the first reading
  const s1 = rec.samples[1];
  close(s1.ax, 0.11, 1e-9, 'ax from TotalAcceleration x');
  close(s1.ay, 0.18, 1e-9, 'ay');
  close(s1.az, 9.84, 1e-9, 'az');
  close(s1.lx, 0.01, 1e-9, 'lx from Accelerometer x');
  close(s1.lz, 0.05, 1e-9, 'lz');
  // Gyroscope readings are 2 ms later: at t = 10 ms, x is interpolated between 0.10 (2 ms) and 0.11 rad/s (12 ms).
  close(s1.gx, 0.108 * DEG, 1e-5, 'gx rad/s -> deg/s, interpolated');
  close(s1.gy, -0.2 * DEG, 1e-5, 'gy');
  close(s1.gz, 0.05 * DEG, 1e-5, 'gz');
  close(rec.samples[0].gx, 0.1 * DEG, 1e-5, 'gx before the first gyro reading uses the nearest within 10 ms');
  assert.equal(rec.createdAt, '2026-11-08T12:12:03.000Z');
  assert.equal(rec.goT, null);
  assert.equal(rec.stopT, null);
  assert.equal(rec.distance_m, null);
});

test('sensor-logger-csv (iPhone set): Accelerometer + Gravity gives acceleration with gravity', () => {
  const files = ['Accelerometer', 'Gravity', 'Gyroscope'].map((s) => fixture(`sensor-logger_${s}.csv`));
  const rec = checkShape(parseRecording(files));
  const total = parseRecording([fixture('sensor-logger_TotalAcceleration.csv')]).recording;
  rec.samples.forEach((s, i) => {
    close(s.ax, total.samples[i].ax, 1e-9, `ax ${i}`);
    close(s.ay, total.samples[i].ay, 1e-9, `ay ${i}`);
    close(s.az, total.samples[i].az, 1e-9, `az ${i}`);
  });
});

test('sensor-logger-csv: Accelerometer alone fills lx..lz and leaves ax..az null; extra files are skipped', () => {
  const extra = { name: 'Location.csv', text: 'time,seconds_elapsed,latitude,longitude\n1794139923000000000,0.05,43.2,-79.9\n' };
  const meta = { name: 'Metadata.csv', text: 'version,device name,platform\n1,Pixel,android\n' };
  const res = parseRecording([fixture('sensor-logger_Accelerometer.csv', 'Accelerometer.csv'), extra, meta]);
  const rec = checkShape(res);
  assert.ok(rec.samples.every((s) => s.ax === null && s.ay === null && s.az === null && s.gx === null));
  close(rec.samples[5].lz, 0.25, 1e-9, 'lz');
  assert.ok(res.warnings.some((w) => /Location\.csv/.test(w)));
  assert.ok(res.warnings.some((w) => /Metadata\.csv/.test(w)));
});

test('sensor-logger-csv: seconds_elapsed is used when the time column is missing', () => {
  const text = fixture('sensor-logger_TotalAcceleration.csv').text.split('\n').map((l) => l.split(',').slice(1).join(',')).join('\n');
  const rec = checkShape(parseRecording([{ name: 'TotalAcceleration.csv', text }]));
  rec.samples.forEach((s, i) => close(s.t, 50 + 10 * i, 1e-9, `t ${i}`)); // seconds_elapsed x 1000
  assert.equal(rec.createdAt, null);
});

test('phyphox-csv: Acceleration with g and Gyroscope exports merged, rad/s -> deg/s, s -> ms', () => {
  const res = parseRecording([fixture('phyphox-acceleration-with-g.csv', 'Raw Data.csv'), fixture('phyphox-gyroscope.csv', 'Raw Data (1).csv')]);
  assert.equal(res.format, 'phyphox-csv');
  const rec = checkShape(res);
  assert.equal(rec.samples.length, 5);
  assert.deepEqual(rec.samples.map((s) => s.t), [0, 20, 40, 60, 80]);
  close(rec.samples[2].ax, 0.12, 1e-9, 'ax');
  close(rec.samples[2].az, 9.89, 1e-9, 'az');
  close(rec.samples[2].gx, 0.12 * DEG, 1e-5, 'gx');
  close(rec.samples[2].gy, -0.2 * DEG, 1e-5, 'gy');
  assert.equal(rec.samples[2].lx, null);
  assert.equal(rec.goT, null);
  assert.equal(rec.stopT, null);
});

test('phyphox-csv: semicolon with decimal comma, and tab separated, read the same as comma', () => {
  const comma = parseRecording([fixture('phyphox-acceleration-with-g.csv')]);
  const semi = parseRecording([fixture('phyphox-acceleration-semicolon-decimal-comma.csv')]);
  const tab = parseRecording([{ name: 'Raw Data.csv', text: fixture('phyphox-acceleration-with-g.csv').text.replace(/,/g, '\t') }]);
  for (const r of [comma, semi, tab]) {
    assert.equal(r.format, 'phyphox-csv');
    checkShape(r);
  }
  assert.deepEqual(semi.recording.samples, comma.recording.samples);
  assert.deepEqual(tab.recording.samples, comma.recording.samples);
});

// ------------------------------------------------------------------ round trip from a local sine-wave walk

function sineRecording() {
  const r6 = (v) => Math.round(v * 1e6) / 1e6;
  const samples = [];
  for (let i = 0; i < 200; i++) { // 4 s at 50 Hz
    const t = i * 20;
    const w = 2 * Math.PI * 1.8 * (t / 1000);
    samples.push({
      t,
      ax: r6(0.5 * Math.sin(w)), ay: r6(9.81 + 1.2 * Math.sin(w + 0.3)), az: r6(0.8 * Math.cos(w)),
      gx: r6(20 * Math.sin(w / 2)), gy: r6(-15 * Math.cos(w)), gz: r6(5 * Math.sin(w + 1)),
      lx: r6(0.5 * Math.sin(w)), ly: r6(1.2 * Math.sin(w + 0.3)), lz: r6(0.8 * Math.cos(w)),
    });
  }
  return {
    v: 1, kind: 'rfn-walk-recording', id: 'w-roundtrip-0001', createdAt: '2026-11-08T12:00:00.000Z',
    device: { ua: 'test' }, distance_m: 10, placement: 'waist', goT: 1000, stopT: 3000, stopBy: 'tap', samples,
  };
}

function compareSamples(got, want, { tol = 1e-6, gyroTol = 1e-5, tShift = 0 } = {}) {
  assert.equal(got.length, want.length);
  got.forEach((s, i) => {
    close(s.t, want[i].t - tShift, 1e-3, `t ${i}`);
    for (const k of ['ax', 'ay', 'az', 'lx', 'ly', 'lz']) close(s[k], want[i][k], tol, `${k} ${i}`);
    for (const k of ['gx', 'gy', 'gz']) close(s[k], want[i][k], gyroTol, `${k} ${i}`);
  });
}

test('round trip: rfn-json', () => {
  const rec = sineRecording();
  const res = parseRecording([{ name: 'w.json', text: JSON.stringify(rec) }]);
  assert.deepEqual(checkShape(res), rec);
});

test('round trip: gyro-starter-csv (written the way server.py writes it)', () => {
  const rec = sineRecording();
  const order = ['t', 'gx', 'gy', 'gz', 'ax', 'ay', 'az', 'lx', 'ly', 'lz'];
  const quote = (s) => '"' + s.replace(/"/g, '""') + '"';
  const lines = ['server_time,source,kind,t,gx,gy,gz,ax,ay,az,lx,ly,lz,oa,ob,og,event'];
  const press = (t) => `1794139923.500,phone,event,${t}` + ','.repeat(13) +
    quote(JSON.stringify({ t, type: 'button', id: 'A', down: true }).replace(/,/g, ', ').replace(/:/g, ': '));
  lines.push(press(rec.goT));
  for (const s of rec.samples) lines.push(`1794139923.500,phone,sample,${order.map((k) => s[k]).join(',')},,,,`);
  lines.push(press(rec.stopT));
  const res = parseRecording([{ name: 'motion.csv', text: lines.join('\r\n') + '\r\n' }]);
  assert.equal(res.format, 'gyro-starter-csv');
  const back = checkShape(res);
  assert.deepEqual(back.samples, rec.samples); // no unit change, so the values come back exactly
  assert.equal(back.goT, rec.goT);
  assert.equal(back.stopT, rec.stopT);
  assert.equal(back.stopBy, 'tap');
});

function sensorLoggerFile(name, rec, pick, { scale = 1, times = null, valueAt = null } = {}) {
  const t0 = 1794139923000000000n;
  const rows = ['time,seconds_elapsed,z,y,x'];
  (times || rec.samples.map((s) => s.t)).forEach((t, i) => {
    const [x, y, z] = valueAt ? valueAt(t) : pick(rec.samples[i]);
    rows.push(`${t0 + BigInt(Math.round(t * 1e6))},${0.5 + t / 1000},${z * scale},${y * scale},${x * scale}`);
  });
  return { name, text: rows.join('\n') + '\n' };
}

test('round trip: sensor-logger-csv (Android set, same times)', () => {
  const rec = sineRecording();
  const files = [
    sensorLoggerFile('TotalAcceleration.csv', rec, (s) => [s.ax, s.ay, s.az]),
    sensorLoggerFile('Accelerometer.csv', rec, (s) => [s.lx, s.ly, s.lz]),
    sensorLoggerFile('Gyroscope.csv', rec, (s) => [s.gx, s.gy, s.gz], { scale: Math.PI / 180 }),
  ];
  const res = parseRecording(files);
  assert.equal(res.format, 'sensor-logger-csv');
  compareSamples(checkShape(res).samples, rec.samples);
});

test('round trip: sensor-logger-csv (iPhone set, gyroscope 3 ms off, so it is interpolated)', () => {
  const rec = sineRecording();
  const gyroAt = (t) => {
    const w = 2 * Math.PI * 1.8 * (t / 1000);
    return [20 * Math.sin(w / 2), -15 * Math.cos(w), 5 * Math.sin(w + 1)];
  };
  // Gyroscope readings at -17, 3, 23, ... ms, so every accelerometer time (0, 20, 40, ...) lies between two.
  const gyroTimes = [-17, ...rec.samples.map((s) => s.t + 3)];
  const files = [
    sensorLoggerFile('Accelerometer.csv', rec, (s) => [s.lx, s.ly, s.lz]),
    sensorLoggerFile('Gravity.csv', rec, (s) => [s.ax - s.lx, s.ay - s.ly, s.az - s.lz]),
    sensorLoggerFile('Gyroscope.csv', rec, null, { scale: Math.PI / 180, times: gyroTimes, valueAt: gyroAt }),
  ];
  const back = checkShape(parseRecording(files)).samples;
  // Interpolation error here is about 0.03 deg/s; picking the nearest reading would be off by up to 0.34 deg/s.
  compareSamples(back, rec.samples, { tol: 1e-6, gyroTol: 0.1, tShift: -17 }); // t counts from the first reading of any file
});

function phyphoxFile(name, labels, rec, pick, { sep = ',', decimalComma = false } = {}) {
  const fmt = (v) => {
    const s = v.toExponential(9).replace('e+', 'E').replace('e', 'E'); // Java DecimalFormat "0.000000000E0"
    return decimalComma ? s.replace('.', ',') : s;
  };
  const rows = [['Time (s)', ...labels].map((l) => `"${l}"`).join(sep)];
  for (const s of rec.samples) rows.push([s.t / 1000, ...pick(s)].map(fmt).join(sep));
  return { name, text: rows.join('\n') + '\n' };
}

for (const [sep, decimalComma, label] of [[',', false, 'comma'], [';', true, 'semicolon, decimal comma'], ['\t', false, 'tab']]) {
  test(`round trip: phyphox-csv (${label})`, () => {
    const rec = sineRecording();
    const opt = { sep, decimalComma };
    const files = [
      phyphoxFile('Raw Data.csv', ['Acceleration x (m/s^2)', 'Acceleration y (m/s^2)', 'Acceleration z (m/s^2)'], rec, (s) => [s.ax, s.ay, s.az], opt),
      phyphoxFile('Raw Data (1).csv', ['Linear Acceleration x (m/s^2)', 'Linear Acceleration y (m/s^2)', 'Linear Acceleration z (m/s^2)'], rec, (s) => [s.lx, s.ly, s.lz], opt),
      phyphoxFile('Raw Data (2).csv', ['Gyroscope x (rad/s)', 'Gyroscope y (rad/s)', 'Gyroscope z (rad/s)'], rec, (s) => [s.gx, s.gy, s.gz].map((g) => g * Math.PI / 180), opt),
    ];
    const res = parseRecording(files);
    assert.equal(res.format, 'phyphox-csv');
    compareSamples(checkShape(res).samples, rec.samples);
  });
}

// ------------------------------------------------------------------ bad input: ok false, never a throw

test('bad input gives ok false with a plain error and never throws', () => {
  let junk = 'PK';
  for (let i = 0; i < 3000; i++) junk += String.fromCharCode((i * 7919) % 256);
  const cases = {
    'empty array': [],
    'empty file': [{ name: 'empty.csv', text: '' }],
    'blank file': [{ name: 'blank.csv', text: '\n\n  \n' }],
    'binary junk': [{ name: 'junk.bin', text: junk }],
    'replacement characters': [{ name: 'junk2.csv', text: '��\u0001\u0002'.repeat(200) }],
    'zip file': [{ name: 'export.zip', text: 'PK\u0003\u0004\u0014\u0000\u0008' + 'x'.repeat(100) }],
    'CSV with no time column': [{ name: 'data.csv', text: 'a,b,c\n1,2,3\n4,5,6\n' }],
    'CSV in an unknown layout': [{ name: 'other.csv', text: 'timestamp,foo\n1,2\n' }],
    'JSON that is not a recording': [{ name: 'x.json', text: '{"hello": 1}' }],
    'cut-off JSON': [{ name: 'x.json', text: '{"kind": "rfn-walk-recording", "samples": [' }],
    'recording with no samples': [{ name: 'x.json', text: '{"v":1,"kind":"rfn-walk-recording","samples":[]}' }],
    'Sensor Logger without acceleration': [fixture('sensor-logger_Gyroscope.csv', 'Gyroscope.csv')],
    'Sensor Logger file with an unknown name': [fixture('sensor-logger_TotalAcceleration.csv', 'walk1.csv')],
    'gyro-starter header only': [{ name: 'm.csv', text: 'server_time,source,kind,t,gx,gy,gz,ax,ay,az,lx,ly,lz,oa,ob,og,event\r\n' }],
    'phyphox header only': [{ name: 'Raw Data.csv', text: '"Time (s)","Acceleration x (m/s^2)","Acceleration y (m/s^2)","Acceleration z (m/s^2)"\n' }],
    null: null,
    undefined: undefined,
    'a string': 'not files',
    'a number': 42,
    'array of junk': [null, 1, 'x', {}],
    'text that is not a string': [{ name: 'a.csv', text: 123 }],
  };
  for (const [what, input] of Object.entries(cases)) {
    let res;
    assert.doesNotThrow(() => { res = parseRecording(input); }, what);
    assert.equal(res.ok, false, what);
    assert.equal(res.recording, null, what);
    assert.equal(typeof res.error, 'string', what);
    assert.ok(res.error.length > 10, what);
    assert.ok(Array.isArray(res.warnings), what);
  }
  assert.match(parseRecording(cases['zip file']).error, /Unzip/);
  assert.match(parseRecording(cases['CSV with no time column']).error, /no time column/);
  assert.match(parseRecording(cases['CSV with no time column']).error, /Sensor Logger/); // names the formats it accepts
  assert.match(parseRecording(cases['Sensor Logger without acceleration']).error, /acceleration/);
  assert.match(parseRecording(cases['Sensor Logger file with an unknown name']).error, /file names/);
});

test('more than 200000 rows: reads the first 200000 and warns', () => {
  const rows = ['"Time (s)","Acceleration x (m/s^2)","Acceleration y (m/s^2)","Acceleration z (m/s^2)"'];
  for (let i = 0; i < 200005; i++) rows.push(`${(i / 100).toFixed(2)},0.1,0.2,9.8`);
  const res = parseRecording([{ name: 'Raw Data.csv', text: rows.join('\n') }]);
  assert.equal(res.ok, true, res.error);
  assert.equal(res.recording.samples.length, 200000);
  assert.ok(res.warnings.some((w) => /200000/.test(w)), res.warnings.join(' | '));
});

// Review fix: a stray " on one row used to swallow every later row into one quoted field (1 sample, ok true),
// and re-counting quotes over the growing line made it quadratic (16000 rows took over 5 s and froze the page).
test('a stray quote on one row does not swallow the rest of the file, and stays fast', () => {
  const head = '"Time (s)","Acceleration x (m/s^2)","Acceleration y (m/s^2)","Acceleration z (m/s^2)"';
  const make = (n) => {
    const rows = [head, '0.00,0.1",0.2,9.8'];
    for (let i = 1; i < n; i++) rows.push(`${(i / 100).toFixed(2)},0.1,0.2,9.8`);
    return { name: 'Raw Data.csv', text: rows.join('\n') };
  };
  const small = parseRecording([make(6000)]);
  assert.equal(small.ok, true, small.error);
  assert.equal(small.recording.samples.length, 6000);
  assert.equal(small.recording.samples[1].az, 9.8);
  const t0 = Date.now();
  const big = parseRecording([make(40000)]);
  const ms = Date.now() - t0;
  assert.equal(big.recording.samples.length, 40000);
  assert.ok(ms < 4000, `40000 rows with a stray quote took ${ms} ms`);
  // A real quoted field that holds a line break (RFC 4180) is still read as one field.
  const ok = parseRecording([{ name: 'Raw Data.csv', text: `${head},"note"\n0.00,0.1,0.2,9.8,"two\nlines"\n0.01,0.1,0.2,9.8,x\n` }]);
  assert.equal(ok.recording.samples.length, 2);
  assert.deepEqual(ok.recording.samples.map((s) => s.t), [0, 10]);
});

test('mixed formats: the walk JSON wins and the other file is named as not used', () => {
  const res = parseRecording([fixture('phyphox-gyroscope.csv'), fixture('rfn-walk.json')]);
  assert.equal(res.format, 'rfn-json');
  checkShape(res);
  assert.ok(res.warnings.some((w) => /phyphox-gyroscope\.csv/.test(w)));
});

test('the same files give the same id, so re-importing does not duplicate a walk', () => {
  const a = parseRecording([fixture('gyro-starter.csv')]).recording.id;
  const b = parseRecording([fixture('gyro-starter.csv')]).recording.id;
  assert.equal(a, b);
  assert.match(a, /^imp-gs-[0-9a-f]{8}$/);
});
