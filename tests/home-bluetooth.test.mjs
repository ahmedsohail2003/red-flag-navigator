// Bluetooth health-device parsers and connection flow, checked against byte layouts worked out
// by hand from the Bluetooth SIG documents named in app/js/home/import/bluetooth.js:
// [GSS] GATT Specification Supplement 2026-09-09, [HRS] Heart Rate Service 1.0,
// [BLS] Blood Pressure Service 1.1.1, [WSS] Weight Scale Service 1.0.1,
// [PLXS] Pulse Oximeter Service 1.0.1, [PHD] Personal Health Devices Transcoding white paper v16.
// All multi-byte fields are little endian, so 0x012C is sent as the bytes 2C 01.
// Run: node --test "tests/home-bluetooth.test.mjs"
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSfloat, sfloatSpecial, parseDateTime, parseHeartRateMeasurement, parseBloodPressureMeasurement,
  parseWeightMeasurement, parsePlxSpotCheck, parsePlxContinuous, toSample, bluetoothSupport,
  connectHealthDevice, HEALTH_DEVICES, SFLOAT_SPECIAL, UNKNOWN_USER,
} from '../app/js/home/import/bluetooth.js';

const dv = (...bytes) => new DataView(Uint8Array.from(bytes).buffer);
const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) < tol, `${a} vs ${b}`);

// 2026-11-08 as a Date Time: year 2026 = 0x07EA -> EA 07, month 11 = 0x0B, day 8.
const DATE_2026_11_08 = [0xEA, 0x07, 0x0B, 0x08];
const NOW = new Date(2026, 10, 8, 9, 30, 0); // local 2026-11-08 09:30:00
const SAMPLE_KEYS = new Set(['signal', 'start', 'end', 'value', 'value2', 'unit', 'source', 'person', 'simulated', 'detail']);
const assertSampleShape = (s) => {
  for (const k of Object.keys(s)) assert.ok(SAMPLE_KEYS.has(k), `unexpected Sample key ${k}`);
  assert.equal(s.source, 'bluetooth');
  assert.match(s.start, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
};

// ---------- SFLOAT ----------
test('SFLOAT: 4-bit exponent over a 12-bit mantissa, both two\'s complement ([PHD] 2.2.2)', () => {
  assert.equal(parseSfloat(0x0072), 114); // the [PHD] example: 114 mmHg, exponent 0, mantissa 0x072
  assert.equal(parseSfloat(0x0000), 0);
  // HL7 PHD guide table: exponent -1 (0xF) mantissa 20, exponent -2 (0xE) mantissa 200, ...
  assert.equal(parseSfloat(0x0002), 2);
  assert.equal(parseSfloat(0xF014), 2);
  assert.equal(parseSfloat(0xE0C8), 2);
  assert.equal(parseSfloat(0x1002), 20);
  assert.equal(parseSfloat(0x2002), 200);
  assert.equal(parseSfloat(0x04D2), 1234);
  // mantissa 0xB2E = 2862, minus 4096 = -1234
  assert.equal(parseSfloat(0x0B2E), -1234);
  // exponent 0xF = -1, mantissa 0xFFF = -1: -0.1
  assert.equal(parseSfloat(0xFFFF), -0.1);
  // exponent 0x8 = -8 and 0x7 = +7 are the ends of the exponent range
  close(parseSfloat(0x8001), 1e-8, 1e-20);
  assert.equal(parseSfloat(0x7001), 1e7);
  // mantissa 0x16C = 364, exponent -1: 36.4
  assert.equal(parseSfloat(0xF16C), 36.4);
});

test('SFLOAT with a negative exponent is the exact decimal, without floating-point noise', () => {
  // mantissa 0x385 = 901, exponent -1: 90.1 (901 x 0.1 would be 90.10000000000001)
  assert.equal(parseSfloat(0xF385), 90.1);
});

test('SFLOAT special values ([GSS] 2.1.1 Table 2.1, [PLXS] 5.1)', () => {
  assert.ok(Number.isNaN(parseSfloat(0x07FF)), 'NaN');
  assert.ok(Number.isNaN(parseSfloat(0x0800)), 'NRes has no usable number');
  assert.ok(Number.isNaN(parseSfloat(0x0801)), 'reserved');
  assert.equal(parseSfloat(0x07FE), Infinity);
  assert.equal(parseSfloat(0x0802), -Infinity);
  assert.equal(sfloatSpecial(0x07FF), 'nan');
  assert.equal(sfloatSpecial(0x0800), 'nres');
  assert.equal(sfloatSpecial(0x07FE), '+inf');
  assert.equal(sfloatSpecial(0x0802), '-inf');
  assert.equal(sfloatSpecial(0x0801), 'reserved');
  assert.equal(sfloatSpecial(0x0072), null);
  assert.equal(SFLOAT_SPECIAL.NRES, 0x0800);
});

test('SFLOAT special codes only count with exponent 0 ([PHD] 2.2.2)', () => {
  // exponent 1, mantissa 0x7FF = 2047: an ordinary 20470
  assert.equal(parseSfloat(0x17FF), 20470);
  // exponent 0, mantissa 0xFFF = -1: an ordinary -1, not a special value
  assert.equal(parseSfloat(0x0FFF), -1);
  // exponent 0xF = -1, mantissa 0x800 = -2048: -204.8
  assert.equal(parseSfloat(0xF800), -204.8);
});

test('parseSfloat rejects anything that is not a 16-bit unsigned integer', () => {
  for (const bad of [-1, 0x10000, 1.5, NaN, '114', null, undefined]) {
    assert.throws(() => parseSfloat(bad), RangeError, String(bad));
  }
});

// ---------- Date Time ----------
test('Date Time: uint16 year then month, day, hours, minutes, seconds ([GSS] 3.80)', () => {
  // 09:30:15 -> 09 1E 0F
  const t = parseDateTime(dv(...DATE_2026_11_08, 0x09, 0x1E, 0x0F));
  assert.deepEqual(t, { year: 2026, month: 11, day: 8, hours: 9, minutes: 30, seconds: 15, iso: '2026-11-08T09:30:15' });
  // the same 7 bytes after two other bytes, read at offset 2
  assert.equal(parseDateTime(dv(0xAA, 0xBB, ...DATE_2026_11_08, 0x09, 0x1E, 0x0F), 2).iso, '2026-11-08T09:30:15');
  // 2024 = 0x07E8; 29 February exists in a leap year
  assert.equal(parseDateTime(dv(0xE8, 0x07, 0x02, 0x1D, 0x0C, 0x00, 0x00)).iso, '2024-02-29T12:00:00');
});

test('Date Time works on a DataView that starts part-way into its buffer', () => {
  const buf = Uint8Array.from([0xFF, 0xFF, 0xFF, ...DATE_2026_11_08, 0x17, 0x3B, 0x3B]).buffer;
  // 23:59:59 = 17 3B 3B
  assert.equal(parseDateTime(new DataView(buf, 3)).iso, '2026-11-08T23:59:59');
});

test('Date Time: unknown (0) or reserved values give iso null', () => {
  const iso = (...b) => parseDateTime(dv(...b)).iso;
  assert.equal(iso(0x00, 0x00, 0x0B, 0x08, 0x09, 0x1E, 0x0F), null, 'year 0 = unknown');
  assert.equal(iso(0xEA, 0x07, 0x00, 0x08, 0x09, 0x1E, 0x0F), null, 'month 0 = unknown');
  assert.equal(iso(0xEA, 0x07, 0x0B, 0x00, 0x09, 0x1E, 0x0F), null, 'day 0 = unknown');
  assert.equal(iso(0xEA, 0x07, 0x0D, 0x08, 0x09, 0x1E, 0x0F), null, 'month 13');
  assert.equal(iso(0xEA, 0x07, 0x0B, 0x08, 0x18, 0x00, 0x00), null, 'hour 24');
  assert.equal(iso(0xEA, 0x07, 0x0B, 0x08, 0x09, 0x3C, 0x00), null, 'minute 60');
  assert.equal(iso(0xEA, 0x07, 0x0B, 0x08, 0x09, 0x00, 0x3C), null, 'second 60');
  assert.equal(iso(0xEA, 0x07, 0x02, 0x1E, 0x00, 0x00, 0x00), null, '30 February');
  assert.equal(iso(0x2D, 0x06, 0x01, 0x01, 0x00, 0x00, 0x00), null, 'year 1581 is below the valid range');
  assert.equal(iso(0x2E, 0x06, 0x01, 0x01, 0x00, 0x00, 0x00), '1582-01-01T00:00:00', 'year 1582 is the first valid year');
});

test('Date Time needs 7 bytes from the offset', () => {
  assert.throws(() => parseDateTime(dv(0xEA, 0x07, 0x0B, 0x08, 0x09, 0x1E)), RangeError);
  assert.throws(() => parseDateTime(dv(0xAA, ...DATE_2026_11_08, 0x09, 0x1E, 0x0F), 2), RangeError);
  assert.throws(() => parseDateTime(dv()), RangeError);
});

// ---------- Heart Rate Measurement ----------
test('Heart rate: 8-bit value, sensor contact not reported ([GSS] 3.126)', () => {
  // flags 00, value 0x48 = 72
  const r = parseHeartRateMeasurement(dv(0x00, 0x48));
  assert.equal(r.heartRate, 72);
  assert.equal(r.valueFormat, 'uint8');
  assert.equal(r.sensorContactSupported, false);
  assert.equal(r.sensorContact, null);
  assert.equal(r.energyExpendedKj, null);
  assert.deepEqual(r.rrIntervalsMs, []);
});

test('Heart rate: flag bit 0 switches to a 16-bit little-endian value', () => {
  // flags 01, value 2C 01 = 0x012C = 300 (read big-endian it would be 11265)
  const r = parseHeartRateMeasurement(dv(0x01, 0x2C, 0x01));
  assert.equal(r.heartRate, 300);
  assert.equal(r.valueFormat, 'uint16');
});

test('Heart rate: sensor contact bits 1 and 2 ([HRS] 3.1.1.1.2)', () => {
  // 0x06 = supported (bit 2) and detected (bit 1); 0x04 = supported, no contact;
  // 0x02 = detected bit without the supported bit: contact is not reported
  assert.equal(parseHeartRateMeasurement(dv(0x06, 0x50)).sensorContact, true);
  assert.equal(parseHeartRateMeasurement(dv(0x04, 0x50)).sensorContact, false);
  assert.equal(parseHeartRateMeasurement(dv(0x02, 0x50)).sensorContact, null);
  assert.equal(parseHeartRateMeasurement(dv(0x06, 0x50)).heartRate, 80);
});

test('Heart rate: energy expended in kJ and RR-intervals in 1/1024 s converted to ms', () => {
  // flags 0x18 = energy (bit 3) + RR (bit 4); value 0x40 = 64; energy 0A 00 = 10 kJ;
  // RR 00 04 = 1024/1024 s = 1000 ms; RR 00 02 = 512/1024 s = 500 ms
  const r = parseHeartRateMeasurement(dv(0x18, 0x40, 0x0A, 0x00, 0x00, 0x04, 0x00, 0x02));
  assert.equal(r.heartRate, 64);
  assert.equal(r.energyExpendedKj, 10);
  assert.deepEqual(r.rrIntervalsMs, [1000, 500]);
  // flags 0x11 = 16-bit value + RR; 300 bpm; RR 0x0300 = 768 -> 750 ms, 0x0333 = 819 -> 819000/1024 ms
  const w = parseHeartRateMeasurement(dv(0x11, 0x2C, 0x01, 0x00, 0x03, 0x33, 0x03));
  assert.equal(w.heartRate, 300);
  assert.deepEqual(w.rrIntervalsMs, [750, 799.8046875]);
  // the energy counter at its maximum, 0xFFFF ([HRS] 3.1.1.3)
  assert.equal(parseHeartRateMeasurement(dv(0x08, 0x48, 0xFF, 0xFF)).energyExpendedKj, 65535);
});

test('Heart rate: a leftover odd byte after the RR-intervals is ignored, reserved flag bits too', () => {
  assert.deepEqual(parseHeartRateMeasurement(dv(0x10, 0x48, 0x00, 0x04, 0x07)).rrIntervalsMs, [1000]);
  // RR flag set but no intervals follow
  assert.deepEqual(parseHeartRateMeasurement(dv(0x10, 0x48)).rrIntervalsMs, []);
  // bits 5 to 7 are reserved
  const r = parseHeartRateMeasurement(dv(0xE0, 0x48));
  assert.equal(r.heartRate, 72);
  assert.equal(r.energyExpendedKj, null);
});

test('Heart rate: short values throw a RangeError that names the field', () => {
  assert.throws(() => parseHeartRateMeasurement(dv()), /Flags/);
  assert.throws(() => parseHeartRateMeasurement(dv(0x01, 0x48)), /Heart Rate Measurement Value/);
  assert.throws(() => parseHeartRateMeasurement(dv(0x08, 0x48, 0x01)), /Energy Expended/);
  assert.throws(() => parseHeartRateMeasurement(dv(0x00)), RangeError);
  assert.throws(() => parseHeartRateMeasurement(null), TypeError);
});

test('Parsers also take a Uint8Array, an ArrayBuffer or a plain byte array', () => {
  assert.equal(parseHeartRateMeasurement(Uint8Array.of(0x00, 0x48)).heartRate, 72);
  assert.equal(parseHeartRateMeasurement(Uint8Array.of(0x00, 0x48).buffer).heartRate, 72);
  assert.equal(parseHeartRateMeasurement([0x00, 0x48]).heartRate, 72);
  // a typed array that is a window into a bigger buffer
  const big = Uint8Array.of(0x99, 0x01, 0x2C, 0x01);
  assert.equal(parseHeartRateMeasurement(big.subarray(1)).heartRate, 300);
});

test('A plain array must hold bytes: 256, -1 or 1.5 is refused, not wrapped into another number', () => {
  // Uint8Array.from would quietly turn 256 into 0 and -1 into 255
  assert.throws(() => parseHeartRateMeasurement([0x00, 256]), TypeError);
  assert.throws(() => parseHeartRateMeasurement([0x00, -1]), TypeError);
  assert.throws(() => parseHeartRateMeasurement([0x00, 1.5]), TypeError);
  assert.throws(() => parseWeightMeasurement([0x00, '0xB0', 0x36]), TypeError);
});

// ---------- Blood Pressure Measurement ----------
// systolic 120 = 0x0078 -> 78 00, diastolic 80 = 0x0050 -> 50 00, mean 93 = 0x005D -> 5D 00
const BP_MMHG = [0x78, 0x00, 0x50, 0x00, 0x5D, 0x00];

test('Blood pressure in mmHg with no optional fields ([GSS] 3.34)', () => {
  const r = parseBloodPressureMeasurement(dv(0x00, ...BP_MMHG));
  assert.equal(r.unit, 'mmHg');
  assert.equal(r.systolic, 120);
  assert.equal(r.diastolic, 80);
  assert.equal(r.meanArterialPressure, 93);
  assert.equal(r.timestamp, null);
  assert.equal(r.pulseRate, null);
  assert.equal(r.userId, null);
  assert.equal(r.measurementStatus, null);
});

test('Blood pressure in kPa with every optional field', () => {
  // flags 0x1F: kPa, time stamp, pulse rate, user ID, measurement status.
  // 16.0 kPa = mantissa 160 (0x0A0), exponent -1 -> 0xF0A0 -> A0 F0
  // 10.7 kPa = 107 (0x06B) -> 0xF06B -> 6B F0;   12.5 kPa = 125 (0x07D) -> 0xF07D -> 7D F0
  // time 2026-11-08 07:45:00 -> EA 07 0B 08 07 2D 00;   pulse 72 -> 48 00;   user 1
  // status 0x002D = body movement (bit 0) + irregular pulse (bit 2) + range 0b01 in bits 3-4
  //   (above the upper limit) + improper position (bit 5)
  const r = parseBloodPressureMeasurement(dv(
    0x1F, 0xA0, 0xF0, 0x6B, 0xF0, 0x7D, 0xF0, ...DATE_2026_11_08, 0x07, 0x2D, 0x00, 0x48, 0x00, 0x01, 0x2D, 0x00,
  ));
  assert.equal(r.unit, 'kPa');
  assert.equal(r.systolic, 16);
  assert.equal(r.diastolic, 10.7);
  assert.equal(r.meanArterialPressure, 12.5);
  assert.equal(r.timestamp.iso, '2026-11-08T07:45:00');
  assert.equal(r.pulseRate, 72);
  assert.equal(r.userId, 1);
  assert.deepEqual(r.measurementStatus, {
    raw: 0x2D, bodyMovement: true, cuffTooLoose: false, irregularPulse: true,
    pulseRateRange: 'above_upper_limit', improperPosition: true,
  });
});

test('Blood pressure status: the two pulse-range bits and the cuff bit ([GSS] Table 3.55)', () => {
  const status = (raw) => parseBloodPressureMeasurement(dv(0x10, ...BP_MMHG, raw & 0xFF, raw >> 8)).measurementStatus;
  // 0x0012 = cuff too loose (bit 1) + range 0b10 (below the lower limit)
  const s = status(0x0012);
  assert.equal(s.cuffTooLoose, true);
  assert.equal(s.pulseRateRange, 'below_lower_limit');
  assert.equal(s.bodyMovement, false);
  assert.equal(s.irregularPulse, false);
  assert.equal(s.improperPosition, false);
  assert.equal(status(0x0018).pulseRateRange, 'reserved');
  assert.equal(status(0x0000).pulseRateRange, 'in_range');
});

test('Blood pressure: absent fields are skipped, so later fields are read from the right place', () => {
  // flags 0x0A = time stamp + user ID, no pulse rate: the user ID (2) comes straight after the time
  const r = parseBloodPressureMeasurement(dv(0x0A, ...BP_MMHG, ...DATE_2026_11_08, 0x07, 0x2D, 0x00, 0x02));
  assert.equal(r.pulseRate, null);
  assert.equal(r.userId, 2);
  // flags 0x0C = pulse rate + user ID: pulse 0x0048 = 72, then the "unknown user" 0xFF
  const u = parseBloodPressureMeasurement(dv(0x0C, ...BP_MMHG, 0x48, 0x00, 0xFF));
  assert.equal(u.pulseRate, 72);
  assert.equal(u.userId, UNKNOWN_USER);
});

test('Blood pressure: NaN for a missing value ([BLS] 3.1.1.2) and errors for short values', () => {
  // systolic FF 07 = 0x07FF = NaN
  assert.ok(Number.isNaN(parseBloodPressureMeasurement(dv(0x00, 0xFF, 0x07, 0x50, 0x00, 0x5D, 0x00)).systolic));
  assert.throws(() => parseBloodPressureMeasurement(dv(0x00, 0x78, 0x00, 0x50)), /Diastolic/);
  assert.throws(() => parseBloodPressureMeasurement(dv(0x00, 0x78, 0x00, 0x50, 0x00)), /Mean Arterial Pressure/);
  assert.throws(() => parseBloodPressureMeasurement(dv(0x02, ...BP_MMHG, 0xEA, 0x07, 0x0B)), /Time Stamp/);
  assert.throws(() => parseBloodPressureMeasurement(dv(0x10, ...BP_MMHG, 0x01)), /Measurement Status/);
});

// ---------- Weight Measurement ----------
test('Weight in kg: 0.005 kg per step ([GSS] 3.276)', () => {
  // 14000 = 0x36B0 -> B0 36 = 70 kg
  const r = parseWeightMeasurement(dv(0x00, 0xB0, 0x36));
  assert.equal(r.unit, 'kg');
  assert.equal(r.weight, 70);
  assert.equal(r.measurementUnsuccessful, false);
  assert.equal(r.timestamp, null);
  assert.equal(r.userId, null);
  assert.equal(r.bmi, null);
  assert.equal(r.height, null);
  // one step is 0.005 kg
  assert.equal(parseWeightMeasurement(dv(0x00, 0x01, 0x00)).weight, 0.005);
  // 13014 = 0x32D6 -> D6 32: exactly 65.07 kg
  assert.equal(parseWeightMeasurement(dv(0x00, 0xD6, 0x32)).weight, 65.07);
});

test('Weight in kg with time stamp, user, BMI and height', () => {
  // flags 0x0E = time + user + BMI and height. 14471 = 0x3887 -> 87 38 = 72.355 kg;
  // time 06:00:00; user 2; BMI 236 = 0x00EC -> 23.6 kg/m2; height 1751 = 0x06D7 -> 1.751 m
  const r = parseWeightMeasurement(dv(0x0E, 0x87, 0x38, ...DATE_2026_11_08, 0x06, 0x00, 0x00, 0x02, 0xEC, 0x00, 0xD7, 0x06));
  close(r.weight, 72.355);
  assert.equal(r.timestamp.iso, '2026-11-08T06:00:00');
  assert.equal(r.userId, 2);
  close(r.bmi, 23.6);
  close(r.height, 1.751);
  assert.equal(r.heightUnit, 'm');
});

test('Weight in pounds: 0.01 lb per step, height in 0.1 inch', () => {
  // flags 0x09 = imperial + BMI and height. 15432 = 0x3C48 -> 48 3C = 154.32 lb;
  // BMI 221 = 0x00DD -> 22.1; height 695 = 0x02B7 -> 69.5 in
  const r = parseWeightMeasurement(dv(0x09, 0x48, 0x3C, 0xDD, 0x00, 0xB7, 0x02));
  assert.equal(r.unit, 'lb');
  close(r.weight, 154.32);
  close(r.bmi, 22.1);
  close(r.height, 69.5);
  assert.equal(r.heightUnit, 'in');
  assert.equal(parseWeightMeasurement(dv(0x01, 0x01, 0x00)).weight, 0.01);
});

test('Weight 0xFFFF is "Measurement Unsuccessful" ([WSS] 3.2.1.2)', () => {
  const r = parseWeightMeasurement(dv(0x00, 0xFF, 0xFF));
  assert.equal(r.measurementUnsuccessful, true);
  assert.equal(r.weight, null);
  // the time stamp may still be sent
  const t = parseWeightMeasurement(dv(0x03, 0xFF, 0xFF, ...DATE_2026_11_08, 0x06, 0x00, 0x00));
  assert.equal(t.weight, null);
  assert.equal(t.timestamp.iso, '2026-11-08T06:00:00');
});

test('Weight: short values throw', () => {
  assert.throws(() => parseWeightMeasurement(dv(0x00, 0xB0)), /Weight/);
  assert.throws(() => parseWeightMeasurement(dv(0x08, 0xB0, 0x36, 0xEC, 0x00)), /Height/);
  assert.throws(() => parseWeightMeasurement(dv(0x04, 0xB0, 0x36)), /User ID/);
});

// ---------- PLX ----------
test('PLX spot-check with no optional fields ([PLXS] 3.1)', () => {
  // flags 00; SpO2 98 = 0x0062 -> 62 00; pulse 72 -> 48 00
  const r = parsePlxSpotCheck(dv(0x00, 0x62, 0x00, 0x48, 0x00));
  assert.equal(r.spo2, 98);
  assert.equal(r.pulseRate, 72);
  assert.equal(r.timestamp, null);
  assert.equal(r.measurementStatus, null);
  assert.equal(r.deviceSensorStatus, null);
  assert.equal(r.pulseAmplitudeIndex, null);
  assert.equal(r.deviceClockNotSet, false);
});

test('PLX spot-check with every optional field and the clock-not-set flag', () => {
  // flags 0x1F. SpO2 97 -> 61 00; pulse 64 -> 40 00; time 2026-11-08 08:00:00;
  // measurement status 0x4100 -> 00 41: fully qualified (bit 8) + questionable (bit 14);
  // device and sensor status 0x012020 -> 20 20 01: low perfusion (bit 5) + sensor displaced
  //   (bit 13) + reserved bit 16; pulse amplitude index 3.2 = 32 (0x020), exponent -1 -> 20 F0
  const r = parsePlxSpotCheck(dv(
    0x1F, 0x61, 0x00, 0x40, 0x00, ...DATE_2026_11_08, 0x08, 0x00, 0x00, 0x00, 0x41, 0x20, 0x20, 0x01, 0x20, 0xF0,
  ));
  assert.equal(r.spo2, 97);
  assert.equal(r.pulseRate, 64);
  assert.equal(r.timestamp.iso, '2026-11-08T08:00:00');
  assert.equal(r.measurementStatus.raw, 0x4100);
  assert.equal(r.measurementStatus.fullyQualifiedData, true);
  assert.equal(r.measurementStatus.questionableMeasurementDetected, true);
  assert.equal(r.measurementStatus.validatedData, false);
  assert.equal(r.measurementStatus.invalidMeasurementDetected, false);
  assert.equal(r.deviceSensorStatus.raw, 0x012020);
  assert.equal(r.deviceSensorStatus.lowPerfusionDetected, true);
  assert.equal(r.deviceSensorStatus.sensorDisplaced, true);
  assert.equal(r.deviceSensorStatus.sensorDisconnected, false);
  assert.equal(r.pulseAmplitudeIndex, 3.2);
  assert.equal(r.deviceClockNotSet, true);
});

test('PLX spot-check: flag bit 4 alone says the clock is not set; bit 3 is the pulse amplitude index', () => {
  // flags 0x08: only the pulse amplitude index (3.2 -> 20 F0) follows, and the clock is set
  const pai = parsePlxSpotCheck(dv(0x08, 0x62, 0x00, 0x48, 0x00, 0x20, 0xF0));
  assert.equal(pai.pulseAmplitudeIndex, 3.2);
  assert.equal(pai.deviceClockNotSet, false);
  // flags 0x11: a timestamp from a clock that was never set
  const unset = parsePlxSpotCheck(dv(0x11, 0x62, 0x00, 0x48, 0x00, ...DATE_2026_11_08, 0x08, 0x00, 0x00));
  assert.equal(unset.deviceClockNotSet, true);
  assert.equal(unset.timestamp.iso, '2026-11-08T08:00:00');
  assert.equal(unset.pulseAmplitudeIndex, null);
});

test('PLX spot-check: NaN and NRes values, and short values', () => {
  // SpO2 FF 07 = NaN ([PLXS] 3.1.1.2); pulse 00 08 = 0x0800 = NRes
  assert.ok(Number.isNaN(parsePlxSpotCheck(dv(0x00, 0xFF, 0x07, 0x48, 0x00)).spo2));
  assert.ok(Number.isNaN(parsePlxSpotCheck(dv(0x00, 0x62, 0x00, 0x00, 0x08)).pulseRate));
  assert.throws(() => parsePlxSpotCheck(dv(0x00, 0x62, 0x00, 0x48)), /PR/);
  // flag bit 2 promises 3 status bytes, only 2 follow
  assert.throws(() => parsePlxSpotCheck(dv(0x04, 0x62, 0x00, 0x48, 0x00, 0x20, 0x20)), /Device and Sensor Status/);
});

test('PLX continuous: normal, fast and slow pairs ([PLXS] 3.2)', () => {
  // flags 0x1F. normal 96/70 -> 60 00 46 00; fast 95/71 -> 5F 00 47 00; slow 97/69 -> 61 00 45 00;
  // measurement status 0x2000 -> 00 20 (bit 13 unavailable); device status 0x008000 -> 00 80 00
  //   (bit 15 sensor disconnected); pulse amplitude index 5.5 = 55 (0x037) exponent -1 -> 37 F0
  const r = parsePlxContinuous(dv(
    0x1F, 0x60, 0x00, 0x46, 0x00, 0x5F, 0x00, 0x47, 0x00, 0x61, 0x00, 0x45, 0x00, 0x00, 0x20, 0x00, 0x80, 0x00, 0x37, 0xF0,
  ));
  assert.equal(r.spo2, 96);
  assert.equal(r.pulseRate, 70);
  assert.deepEqual(r.fast, { spo2: 95, pulseRate: 71 });
  assert.deepEqual(r.slow, { spo2: 97, pulseRate: 69 });
  assert.equal(r.measurementStatus.measurementUnavailable, true);
  assert.equal(r.deviceSensorStatus.sensorDisconnected, true);
  assert.equal(r.pulseAmplitudeIndex, 5.5);
});

test('PLX continuous: only the slow pair present, and a decimal SpO2', () => {
  // flags 0x02: the slow pair follows the normal one directly
  const r = parsePlxContinuous(dv(0x02, 0x60, 0x00, 0x46, 0x00, 0x61, 0x00, 0x45, 0x00));
  assert.equal(r.fast, null);
  assert.deepEqual(r.slow, { spo2: 97, pulseRate: 69 });
  // 97.5 = mantissa 975 (0x3CF), exponent -1 -> 0xF3CF -> CF F3
  assert.equal(parsePlxContinuous(dv(0x00, 0xCF, 0xF3, 0x46, 0x00)).spo2, 97.5);
  const m = parsePlxContinuous(dv(0x00, 0x60, 0x00, 0x46, 0x00));
  assert.equal(m.fast, null);
  assert.equal(m.slow, null);
  assert.equal(m.measurementStatus, null);
});

test('PLX continuous: short values throw', () => {
  assert.throws(() => parsePlxContinuous(dv(0x01, 0x60, 0x00, 0x46, 0x00, 0x5F, 0x00)), /SpO2PR-Fast PR/);
  assert.throws(() => parsePlxContinuous(dv(0x00, 0x60)), RangeError);
});

// ---------- toSample ----------
test('toSample heart_rate: bpm, person, the arrival time and the RR-intervals', () => {
  const s = toSample('heart_rate', parseHeartRateMeasurement(dv(0x16, 0x50, 0x00, 0x04)), { person: 'alex', now: NOW });
  assertSampleShape(s);
  assert.deepEqual(s, {
    signal: 'heart_rate', start: '2026-11-08T09:30:00', value: 80, unit: 'bpm', source: 'bluetooth',
    person: 'alex', detail: { rrIntervalsMs: [1000], sensorContact: true },
  });
  // no person given: no person key
  assert.equal('person' in toSample('heart_rate', parseHeartRateMeasurement(dv(0x00, 0x48)), { now: NOW }), false);
});

test('toSample heart_rate: no skin contact or a zero value gives no Sample', () => {
  assert.equal(toSample('heart_rate', parseHeartRateMeasurement(dv(0x04, 0x50)), { now: NOW }), null);
  assert.equal(toSample('heart_rate', parseHeartRateMeasurement(dv(0x00, 0x00)), { now: NOW }), null);
});

test('toSample blood_pressure: mmHg values, systolic in value and diastolic in value2', () => {
  const s = toSample('blood_pressure', parseBloodPressureMeasurement(dv(0x02, ...BP_MMHG, ...DATE_2026_11_08, 0x07, 0x2D, 0x00)), { now: NOW });
  assertSampleShape(s);
  assert.equal(s.signal, 'bp');
  assert.equal(s.value, 120);
  assert.equal(s.value2, 80);
  assert.equal(s.unit, 'mmHg');
  assert.equal(s.start, '2026-11-08T07:45:00', 'the device time stamp is the time of measurement');
  assert.equal(s.detail.meanArterialPressure, 93);
});

test('toSample blood_pressure converts kPa to mmHg (1 mmHg = 133.3224 Pa)', () => {
  const r = parseBloodPressureMeasurement(dv(
    0x1F, 0xA0, 0xF0, 0x6B, 0xF0, 0x7D, 0xF0, ...DATE_2026_11_08, 0x07, 0x2D, 0x00, 0x48, 0x00, 0x01, 0x2D, 0x00,
  ));
  const s = toSample('blood_pressure', r, { now: NOW });
  close(s.value, (16 * 1000) / 133.3224);
  close(s.value2, (10.7 * 1000) / 133.3224);
  close(s.value, 120.0098, 1e-4);
  close(s.detail.meanArterialPressure, (12.5 * 1000) / 133.3224);
  assert.equal(s.unit, 'mmHg');
  assert.equal(s.detail.deviceUnit, 'kPa');
  assert.equal(s.detail.pulseRate, 72);
  assert.equal(s.detail.deviceUser, 1);
  assert.deepEqual(s.detail.warnings, ['body_movement', 'irregular_pulse', 'pulse_rate_above_device_range', 'improper_position']);
});

test('toSample blood_pressure: a NaN value gives no Sample', () => {
  assert.equal(toSample('blood_pressure', parseBloodPressureMeasurement(dv(0x00, 0xFF, 0x07, 0x50, 0x00, 0x5D, 0x00)), { now: NOW }), null);
});

test('toSample weight: kg as sent, pounds converted (1 lb = 0.45359237 kg)', () => {
  const si = toSample('weight', parseWeightMeasurement(dv(0x0E, 0x87, 0x38, ...DATE_2026_11_08, 0x06, 0x00, 0x00, 0x02, 0xEC, 0x00, 0xD7, 0x06)), { now: NOW });
  assertSampleShape(si);
  assert.equal(si.signal, 'weight');
  assert.equal(si.unit, 'kg');
  close(si.value, 72.355);
  assert.equal(si.start, '2026-11-08T06:00:00');
  close(si.detail.bmi, 23.6);
  close(si.detail.heightM, 1.751);
  assert.equal(si.detail.deviceUser, 2);
  const lb = toSample('weight', parseWeightMeasurement(dv(0x09, 0x48, 0x3C, 0xDD, 0x00, 0xB7, 0x02)), { now: NOW });
  close(lb.value, 154.32 * 0.45359237);
  close(lb.value, 69.998, 1e-3);
  close(lb.detail.heightM, 69.5 * 0.0254);
  assert.equal(lb.detail.deviceUnit, 'lb');
  assert.equal(lb.start, '2026-11-08T09:30:00', 'no time stamp: the arrival time');
});

test('toSample weight: "Measurement Unsuccessful" gives no Sample', () => {
  assert.equal(toSample('weight', parseWeightMeasurement(dv(0x00, 0xFF, 0xFF)), { now: NOW }), null);
});

test('toSample pulse_oximeter: SpO2 in %, pulse and status words in detail', () => {
  const s = toSample('pulse_oximeter', parsePlxSpotCheck(dv(0x01, 0x62, 0x00, 0x48, 0x00, ...DATE_2026_11_08, 0x08, 0x00, 0x00)), { now: NOW });
  assertSampleShape(s);
  assert.equal(s.signal, 'spo2');
  assert.equal(s.value, 98);
  assert.equal(s.unit, '%');
  assert.equal(s.start, '2026-11-08T08:00:00');
  assert.equal(s.detail.pulseRate, 72);
  assert.equal(s.detail.measurement, 'spot_check');
  // the clock-not-set flag: the device time is ignored for the arrival time
  const unset = parsePlxSpotCheck(dv(
    0x1F, 0x61, 0x00, 0x40, 0x00, ...DATE_2026_11_08, 0x08, 0x00, 0x00, 0x00, 0x41, 0x20, 0x20, 0x01, 0x20, 0xF0,
  ));
  const u = toSample('pulse_oximeter', unset, { now: NOW });
  assert.equal(u.start, '2026-11-08T09:30:00');
  assert.deepEqual(u.detail.status, ['fullyQualifiedData', 'questionableMeasurementDetected']);
  assert.deepEqual(u.detail.sensorStatus, ['lowPerfusionDetected', 'sensorDisplaced']);
  assert.equal(u.detail.pulseAmplitudeIndex, 3.2);
});

test('toSample pulse_oximeter: device says unavailable, invalid, no finger or NaN: no Sample', () => {
  const continuous = (status, device) => parsePlxContinuous(dv(0x0C, 0x60, 0x00, 0x46, 0x00, status & 0xFF, status >> 8, device & 0xFF, (device >> 8) & 0xFF, device >> 16));
  assert.equal(toSample('pulse_oximeter', continuous(0x2000, 0), { now: NOW }), null, 'measurement unavailable (bit 13)');
  assert.equal(toSample('pulse_oximeter', continuous(0x8000, 0), { now: NOW }), null, 'invalid measurement (bit 15)');
  assert.equal(toSample('pulse_oximeter', continuous(0, 0x000800), { now: NOW }), null, 'sensor unconnected to user (bit 11)');
  assert.equal(toSample('pulse_oximeter', continuous(0, 0x008000), { now: NOW }), null, 'sensor disconnected (bit 15)');
  assert.equal(toSample('pulse_oximeter', parsePlxSpotCheck(dv(0x00, 0xFF, 0x07, 0x48, 0x00)), { now: NOW }), null, 'SpO2 NaN');
  const ok = toSample('pulse_oximeter', continuous(0x0100, 0x000020), { now: NOW });
  assert.equal(ok.value, 96, 'fully qualified with low perfusion is still a reading');
  assert.equal(ok.detail.measurement, 'continuous');
});

test('toSample pulse_oximeter: SpO2 above 100 % is not a reading; exactly 100 % is', () => {
  // 101 = 0x0065 -> 65 00; 100 = 0x0064 -> 64 00; pulse 72 -> 48 00
  assert.equal(toSample('pulse_oximeter', parsePlxSpotCheck(dv(0x00, 0x65, 0x00, 0x48, 0x00)), { now: NOW }), null);
  assert.equal(toSample('pulse_oximeter', parsePlxSpotCheck(dv(0x00, 0x64, 0x00, 0x48, 0x00)), { now: NOW }).value, 100);
});

test('toSample pulse_oximeter: demonstration or test data from the device is marked simulated', () => {
  // flags 0x04, measurement status 0x0400 -> 00 04 (bit 10 data for demonstration)
  const demo = toSample('pulse_oximeter', parsePlxContinuous(dv(0x04, 0x60, 0x00, 0x46, 0x00, 0x00, 0x04)), { now: NOW });
  assert.equal(demo.simulated, true);
  // 0x0800 -> 00 08 (bit 11 data for testing)
  assert.equal(toSample('pulse_oximeter', parsePlxContinuous(dv(0x04, 0x60, 0x00, 0x46, 0x00, 0x00, 0x08)), { now: NOW }).simulated, true);
  assert.equal('simulated' in toSample('pulse_oximeter', parsePlxContinuous(dv(0x00, 0x60, 0x00, 0x46, 0x00)), { now: NOW }), false);
});

test('toSample: arrival time, unknown device time, unknown kinds and empty input', () => {
  const r = parseBloodPressureMeasurement(dv(0x00, ...BP_MMHG));
  r.receivedAt = '2026-11-07T22:15:00';
  assert.equal(toSample('blood_pressure', r, { now: NOW }).start, '2026-11-07T22:15:00');
  // year 0 in the time stamp: unknown, so the arrival time is used
  const unknown = parseBloodPressureMeasurement(dv(0x02, ...BP_MMHG, 0x00, 0x00, 0x0B, 0x08, 0x07, 0x2D, 0x00));
  assert.equal(toSample('blood_pressure', unknown, { now: NOW }).start, '2026-11-08T09:30:00');
  assert.equal(toSample('glucose', r), null);
  assert.equal(toSample('heart_rate', null), null);
  assert.equal(toSample('heart_rate', {}), null);
  assert.equal(toSample('weight', { weight: null, unit: 'lb' }), null);
});

test('toSample keeps the arrival time in detail only when the device clock gave the start', () => {
  // time stamp 2026-11-08 07:45:00, arrived 09:30:00 the same day
  const stamped = parseBloodPressureMeasurement(dv(0x02, ...BP_MMHG, ...DATE_2026_11_08, 0x07, 0x2D, 0x00));
  stamped.receivedAt = '2026-11-08T09:30:00';
  const s = toSample('blood_pressure', stamped);
  assert.equal(s.start, '2026-11-08T07:45:00');
  assert.equal(s.detail.receivedAt, '2026-11-08T09:30:00');
  // no device time: the arrival time is the start, so it is not repeated in detail
  const plain = parseBloodPressureMeasurement(dv(0x00, ...BP_MMHG));
  plain.receivedAt = '2026-11-08T09:30:00';
  const p = toSample('blood_pressure', plain);
  assert.equal(p.start, '2026-11-08T09:30:00');
  assert.equal('receivedAt' in p.detail, false);
});

test('toSample does not trust a device time that cannot be right: later than arrival, or before Bluetooth LE', () => {
  const stampedAt = (bytes, receivedAt) => {
    const r = parseBloodPressureMeasurement(dv(0x02, ...BP_MMHG, ...bytes));
    r.receivedAt = receivedAt;
    return toSample('blood_pressure', r);
  };
  // 10:00 on a clock that runs ahead, arriving at 09:30: a reading cannot come from the future
  const fast = stampedAt([...DATE_2026_11_08, 0x0A, 0x00, 0x00], '2026-11-08T09:30:00');
  assert.equal(fast.start, '2026-11-08T09:30:00');
  assert.equal(fast.detail.deviceTime, '2026-11-08T10:00:00');
  assert.equal('receivedAt' in fast.detail, false);
  // 2000-01-01 00:05 (2000 = 0x07D0 -> D0 07), a clock that was never set: Bluetooth LE came
  // with Core Specification 4.0 in June 2010, so no such device measured anything in 2000
  const reset = stampedAt([0xD0, 0x07, 0x01, 0x01, 0x00, 0x05, 0x00], '2026-11-08T09:30:00');
  assert.equal(reset.start, '2026-11-08T09:30:00');
  assert.equal(reset.detail.deviceTime, '2000-01-01T00:05:00');
  // a stored reading from two days before it arrived is kept at its own time
  const stored = stampedAt([0xEA, 0x07, 0x0B, 0x06, 0x07, 0x2D, 0x00], '2026-11-08T09:30:00');
  assert.equal(stored.start, '2026-11-06T07:45:00');
  assert.equal(stored.detail.receivedAt, '2026-11-08T09:30:00');
  assert.equal('deviceTime' in stored.detail, false);
  // the same second as arrival is not later than it: the device time is used, nothing set aside
  const same = stampedAt([...DATE_2026_11_08, 0x09, 0x1E, 0x00], '2026-11-08T09:30:00');
  assert.equal(same.start, '2026-11-08T09:30:00');
  assert.equal(same.detail === undefined || !('deviceTime' in same.detail), true);
  // with no arrival time, now is the arrival time
  const r = parseBloodPressureMeasurement(dv(0x02, ...BP_MMHG, ...DATE_2026_11_08, 0x0A, 0x00, 0x00));
  assert.equal(toSample('blood_pressure', r, { now: NOW }).start, '2026-11-08T09:30:00');
});

// ---------- bluetoothSupport ----------
const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';
const fakeBt = () => ({ requestDevice: async () => { throw new Error('not used'); } });

test('bluetoothSupport: Chrome with Web Bluetooth in a secure page is ok', () => {
  assert.deepEqual(bluetoothSupport({ navigator: { userAgent: CHROME_UA, bluetooth: fakeBt() }, isSecureContext: true, document: {} }), { ok: true, reason: null });
  // a policy API that allows it
  const allowed = { permissionsPolicy: { allowsFeature: (f) => f === 'bluetooth' } };
  assert.equal(bluetoothSupport({ navigator: { bluetooth: fakeBt() }, isSecureContext: true, document: allowed }).ok, true);
});

test('bluetoothSupport: a frame whose permissions policy blocks "bluetooth"', () => {
  const blocked = { featurePolicy: { allowsFeature: (f) => f !== 'bluetooth' } };
  const s = bluetoothSupport({ navigator: { bluetooth: fakeBt() }, isSecureContext: true, document: blocked });
  assert.equal(s.ok, false);
  assert.match(s.reason, /own browser tab/);
  // a policy API that throws tells us nothing: carry on
  const broken = { featurePolicy: { allowsFeature: () => { throw new Error('x'); } } };
  assert.equal(bluetoothSupport({ navigator: { bluetooth: fakeBt() }, isSecureContext: true, document: broken }).ok, true);
});

test('bluetoothSupport: a browser that does not know the "bluetooth" policy feature is not called blocked', () => {
  // Chromium's allowsFeature answers false for any feature name it does not recognise
  // (dom_feature_policy.cc), so that false says nothing about this page
  const unknown = { featurePolicy: { features: () => ['camera', 'microphone'], allowsFeature: (f) => f === 'camera' || f === 'microphone' } };
  assert.equal(bluetoothSupport({ navigator: { bluetooth: fakeBt() }, isSecureContext: true, document: unknown }).ok, true);
  // when it does know the feature, its "no" is believed
  const known = { featurePolicy: { features: () => ['bluetooth', 'camera'], allowsFeature: (f) => f !== 'bluetooth' } };
  const s = bluetoothSupport({ navigator: { bluetooth: fakeBt() }, isSecureContext: true, document: known });
  assert.equal(s.ok, false);
  assert.match(s.reason, /own browser tab/);
});

test('bluetoothSupport: iPhone and iPad Safari have no Web Bluetooth', () => {
  const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
  const s = bluetoothSupport({ navigator: { userAgent: iphone, maxTouchPoints: 5 }, isSecureContext: true });
  assert.equal(s.ok, false);
  assert.match(s.reason, /iPhone or iPad browser/);
  // iPadOS reports a Mac user agent; the touch screen gives it away
  const mac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
  assert.match(bluetoothSupport({ navigator: { userAgent: mac, maxTouchPoints: 5 }, isSecureContext: true }).reason, /iPhone or iPad browser/);
  // desktop Safari on a Mac: the general message
  assert.match(bluetoothSupport({ navigator: { userAgent: mac, maxTouchPoints: 0 }, isSecureContext: true }).reason, /This browser cannot/);
  // an iOS browser that does provide navigator.bluetooth is allowed to try
  assert.equal(bluetoothSupport({ navigator: { userAgent: iphone, maxTouchPoints: 5, bluetooth: fakeBt() }, isSecureContext: true }).ok, true);
});

test('bluetoothSupport: not a secure page, no API, or nothing at all', () => {
  const insecure = bluetoothSupport({ navigator: { userAgent: CHROME_UA }, isSecureContext: false });
  assert.equal(insecure.ok, false);
  assert.match(insecure.reason, /https/);
  const firefox = bluetoothSupport({ navigator: { userAgent: 'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0' }, isSecureContext: true });
  assert.equal(firefox.ok, false);
  assert.match(firefox.reason, /Chrome or Edge/);
  assert.equal(bluetoothSupport({}).ok, false);
  assert.equal(bluetoothSupport(null).ok, false);
  // Node itself has a navigator but no Bluetooth
  const node = bluetoothSupport();
  assert.equal(node.ok, false);
  assert.equal(typeof node.reason, 'string');
});

// ---------- connectHealthDevice with a fake navigator.bluetooth ----------
const domError = (name, message = '') => new DOMException(message, name);

class FakeCharacteristic extends EventTarget {
  constructor(uuid, { onStart, startError, addError } = {}) {
    super();
    this.uuid = uuid;
    this.value = null;
    this.started = 0;
    this.attached = new Set(); // the characteristicvaluechanged listeners attached right now
    this.onStart = onStart;
    this.startError = startError;
    this.addError = addError;
  }
  get listeners() { return this.attached.size; }
  addEventListener(type, fn) {
    if (type === 'characteristicvaluechanged') {
      if (this.addError) throw this.addError;
      this.attached.add(fn);
    }
    super.addEventListener(type, fn);
  }
  removeEventListener(type, fn) { if (type === 'characteristicvaluechanged') this.attached.delete(fn); super.removeEventListener(type, fn); }
  async startNotifications() {
    this.started += 1;
    if (this.startError) throw this.startError;
    if (this.onStart) this.onStart(this);
    return this;
  }
  emit(bytes) {
    this.value = new DataView(Uint8Array.from(bytes).buffer);
    this.dispatchEvent(new Event('characteristicvaluechanged'));
  }
}

class FakeDevice extends EventTarget {
  constructor(name, services, { connectError, connectHangs, onGetCharacteristic } = {}) {
    super();
    this.name = name;
    this.goneListeners = 0;
    const device = this;
    this.gatt = {
      connected: false,
      disconnects: 0,
      async connect() {
        if (connectError) throw connectError;
        if (connectHangs) return new Promise(() => {});
        this.connected = true;
        return this;
      },
      // like [WEB] 6.2: disconnect() fires gattserverdisconnected straight away
      disconnect() {
        this.disconnects += 1;
        if (!this.connected) return;
        this.connected = false;
        device.dispatchEvent(new Event('gattserverdisconnected'));
      },
      async getPrimaryService(uuid) {
        if (!services[uuid]) throw domError('NotFoundError', 'No Services matching UUID found in Device.');
        const chars = services[uuid];
        return {
          async getCharacteristic(c) {
            if (!chars[c]) throw domError('NotFoundError', 'No Characteristics matching UUID found in Service.');
            if (onGetCharacteristic) onGetCharacteristic(device, c);
            return chars[c];
          },
        };
      },
    };
  }
  addEventListener(type, fn) { if (type === 'gattserverdisconnected') this.goneListeners += 1; super.addEventListener(type, fn); }
  removeEventListener(type, fn) { if (type === 'gattserverdisconnected') this.goneListeners -= 1; super.removeEventListener(type, fn); }
  // the device walks away or switches off
  drop() {
    this.gatt.connected = false;
    this.dispatchEvent(new Event('gattserverdisconnected'));
  }
}

function fakeEnv(result) {
  const calls = [];
  const bluetooth = {
    async requestDevice(options) {
      calls.push(options);
      if (result && result.reject) throw result.reject;
      return result;
    },
  };
  return { calls, env: { navigator: { userAgent: CHROME_UA, bluetooth }, isSecureContext: true, document: {} } };
}

const clock = () => NOW;
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

test('connect heart_rate: filters on the Heart Rate service, subscribes, parses each value', async () => {
  const hr = new FakeCharacteristic(0x2A37);
  const device = new FakeDevice('Polar H10', { [0x180D]: { [0x2A37]: hr } });
  const { calls, env } = fakeEnv(device);
  const got = [];
  const res = await connectHealthDevice('heart_rate', { env, clock, person: 'alex', onReading: (reading, sample) => got.push({ reading, sample }) });
  assert.equal(res.ok, true);
  assert.equal(res.name, 'Polar H10');
  assert.equal(typeof res.disconnect, 'function');
  assert.deepEqual(calls, [{ filters: [{ services: [0x180D] }] }]);
  assert.equal(hr.started, 1);
  hr.emit([0x06, 0x50]);
  assert.equal(got.length, 1);
  assert.equal(got[0].reading.type, 'heart_rate_measurement');
  assert.equal(got[0].reading.heartRate, 80);
  assert.equal(got[0].reading.receivedAt, '2026-11-08T09:30:00');
  assert.deepEqual(got[0].sample, {
    signal: 'heart_rate', start: '2026-11-08T09:30:00', value: 80, unit: 'bpm', source: 'bluetooth', person: 'alex',
    detail: { sensorContact: true },
  });
});

test('connect blood_pressure: a reading indicated the moment the subscription starts is not lost', async () => {
  // cuffs send stored readings as soon as indications are switched on
  const bp = new FakeCharacteristic(0x2A35, { onStart: (c) => c.emit([0x00, ...BP_MMHG]) });
  const device = new FakeDevice('BP7000', { [0x1810]: { [0x2A35]: bp } });
  const { calls, env } = fakeEnv(device);
  const got = [];
  const res = await connectHealthDevice('blood_pressure', { env, clock, onReading: (r, s) => got.push(s) });
  assert.equal(res.ok, true);
  assert.deepEqual(calls[0].filters[0].services, [0x1810]);
  assert.equal(got.length, 1);
  assert.equal(got[0].signal, 'bp');
  assert.equal(got[0].value, 120);
  assert.equal(got[0].value2, 80);
});

test('connect: cancelling the chooser gives "No device was chosen."', async () => {
  const { env } = fakeEnv({ reject: domError('NotFoundError', 'User cancelled the requestDevice() chooser.') });
  assert.deepEqual(await connectHealthDevice('weight', { env }), { ok: false, reason: 'No device was chosen.' });
  const bare = fakeEnv({ reject: domError('NotFoundError') });
  assert.deepEqual(await connectHealthDevice('weight', { env: bare.env }), { ok: false, reason: 'No device was chosen.' });
});

test('connect: other chooser failures get their own plain reasons', async () => {
  const reason = async (err) => (await connectHealthDevice('heart_rate', { env: fakeEnv({ reject: err }).env })).reason;
  const noAdapter = await reason(domError('NotFoundError', 'Bluetooth adapter not available.'));
  assert.notEqual(noAdapter, 'No device was chosen.');
  assert.match(noAdapter, /Bluetooth is not available/);
  assert.match(await reason(domError('SecurityError', 'Must be handling a user gesture to show a permission request.')), /button/);
  assert.match(await reason(domError('SecurityError', 'Access to the feature "bluetooth" is disallowed by permissions policy.')), /own browser tab/);
  assert.match(await reason(domError('NotFoundError', 'User denied the browser permission to scan for Bluetooth devices.')), /allowed to look/);
  assert.match(await reason(new Error('boom')), /try again/);
});

test('connect: an unsupported browser or an unknown kind never opens the chooser', async () => {
  const iphone = { navigator: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' }, isSecureContext: true };
  const a = await connectHealthDevice('heart_rate', { env: iphone });
  assert.equal(a.ok, false);
  assert.match(a.reason, /iPhone or iPad browser/);
  const { calls, env } = fakeEnv(new FakeDevice('x', {}));
  const b = await connectHealthDevice('glucose', { env });
  assert.equal(b.ok, false);
  assert.equal(typeof b.reason, 'string');
  assert.equal((await connectHealthDevice('toString', { env })).ok, false, 'not fooled by Object.prototype names');
  assert.equal(calls.length, 0);
});

test('connect: a failed connection explains itself, tidies up and never reports a disconnect', async () => {
  const device = new FakeDevice('Scale', {}, { connectError: domError('NetworkError', 'Connection Error: Connection attempt failed.') });
  let disconnects = 0;
  const res = await connectHealthDevice('weight', { env: fakeEnv(device).env, onDisconnect: () => { disconnects += 1; } });
  assert.equal(res.ok, false);
  assert.match(res.reason, /switched on and close by/);
  assert.equal(device.goneListeners, 0, 'the disconnect listener is removed');
  await tick();
  assert.equal(disconnects, 0);
});

test('connect: a device without the standard service', async () => {
  const device = new FakeDevice('Mystery cuff', { [0x180F]: {} });
  device.gatt.connected = true;
  const res = await connectHealthDevice('blood_pressure', { env: fakeEnv(device).env });
  assert.equal(res.ok, false);
  assert.match(res.reason, /Mystery cuff does not share standard blood pressure readings/);
  assert.ok(device.gatt.disconnects >= 1, 'it disconnects again');
});

test('connect: a device that never answers times out with a plain reason', async () => {
  const device = new FakeDevice('Sleepy scale', { [0x181D]: {} }, { connectHangs: true });
  const res = await connectHealthDevice('weight', { env: fakeEnv(device).env, connectTimeoutMs: 20 });
  assert.equal(res.ok, false);
  assert.match(res.reason, /did not answer/);
  assert.ok(device.gatt.disconnects >= 1, 'disconnect() is called to stop the attempt');
});

test('connect: a device with no name gets a plain label', async () => {
  const device = new FakeDevice('', { [0x181D]: { [0x2A9D]: new FakeCharacteristic(0x2A9D) } });
  const res = await connectHealthDevice('weight', { env: fakeEnv(device).env });
  assert.equal(res.ok, true);
  assert.equal(res.name, 'Your scale');
});

test('connect pulse_oximeter: uses whichever PLX characteristic the device has', async () => {
  const continuous = new FakeCharacteristic(0x2A5F);
  const device = new FakeDevice('Oxi', { [0x1822]: { [0x2A5F]: continuous } });
  const got = [];
  const res = await connectHealthDevice('pulse_oximeter', { env: fakeEnv(device).env, clock, onReading: (r, s) => got.push({ r, s }) });
  assert.equal(res.ok, true);
  assert.equal(continuous.started, 1);
  continuous.emit([0x00, 0x60, 0x00, 0x46, 0x00]);
  assert.equal(got[0].r.type, 'plx_continuous_measurement');
  assert.equal(got[0].s.signal, 'spo2');
  assert.equal(got[0].s.value, 96);
  assert.equal(got[0].s.detail.measurement, 'continuous');

  const spot = new FakeCharacteristic(0x2A5E);
  const both = new FakeCharacteristic(0x2A5F);
  const two = new FakeDevice('Oxi 2', { [0x1822]: { [0x2A5E]: spot, [0x2A5F]: both } });
  assert.equal((await connectHealthDevice('pulse_oximeter', { env: fakeEnv(two).env })).ok, true);
  assert.equal(spot.started, 1);
  assert.equal(both.started, 1);
  spot.emit([0x00, 0x62, 0x00, 0x48, 0x00]);

  const none = new FakeDevice('Oxi 3', { [0x1822]: {} });
  const res3 = await connectHealthDevice('pulse_oximeter', { env: fakeEnv(none).env });
  assert.equal(res3.ok, false);
  assert.match(res3.reason, /standard blood oxygen readings/);
});

test('connect: one characteristic refusing notifications does not sink the other', async () => {
  const spot = new FakeCharacteristic(0x2A5E, { startError: domError('NotSupportedError', 'GATT operation not permitted.') });
  const cont = new FakeCharacteristic(0x2A5F);
  const device = new FakeDevice('Oxi', { [0x1822]: { [0x2A5E]: spot, [0x2A5F]: cont } });
  const res = await connectHealthDevice('pulse_oximeter', { env: fakeEnv(device).env });
  assert.equal(res.ok, true);
  assert.equal(spot.listeners, 0, 'the refused characteristic is not listened to');
  assert.equal(cont.listeners, 1);
  // both refuse: the reason says what to try
  const a = new FakeCharacteristic(0x2A5E, { startError: domError('NotSupportedError') });
  const b = new FakeCharacteristic(0x2A5F, { startError: domError('NotSupportedError') });
  const res2 = await connectHealthDevice('pulse_oximeter', { env: fakeEnv(new FakeDevice('Oxi', { [0x1822]: { [0x2A5E]: a, [0x2A5F]: b } })).env });
  assert.equal(res2.ok, false);
  assert.match(res2.reason, /paired/);
});

test('connect: one characteristic that cannot be listened to does not take the other\'s subscription with it', async () => {
  const spot = new FakeCharacteristic(0x2A5E);
  const cont = new FakeCharacteristic(0x2A5F, { addError: new TypeError('listener refused') });
  const device = new FakeDevice('Oxi', { [0x1822]: { [0x2A5E]: spot, [0x2A5F]: cont } });
  const got = [];
  const res = await connectHealthDevice('pulse_oximeter', { env: fakeEnv(device).env, clock, onReading: (r, s) => got.push(s) });
  assert.equal(res.ok, true);
  spot.emit([0x00, 0x62, 0x00, 0x48, 0x00]);
  assert.equal(got.length, 1);
  assert.equal(got[0].value, 98);
  res.disconnect();
  assert.equal(spot.listeners, 0, 'the working subscription is still tracked, so disconnect removes it');
});

test('connect: a missing characteristic does not hide why the other one failed', async () => {
  // only PLX Continuous, and it refuses notifications: the advice is about pairing, not "no readings"
  const cont = new FakeCharacteristic(0x2A5F, { startError: domError('NotSupportedError', 'GATT operation not permitted.') });
  const res = await connectHealthDevice('pulse_oximeter', { env: fakeEnv(new FakeDevice('Oxi', { [0x1822]: { [0x2A5F]: cont } })).env });
  assert.equal(res.ok, false);
  assert.match(res.reason, /paired/);
  assert.doesNotMatch(res.reason, /does not share/);
});

test('connect: Chromium\'s "Not paired" and authentication errors get the pairing advice', async () => {
  const reasonFor = async (err) => {
    const bp = new FakeCharacteristic(0x2A35, { startError: err });
    return (await connectHealthDevice('blood_pressure', { env: fakeEnv(new FakeDevice('Cuff', { [0x1810]: { [0x2A35]: bp } })).env })).reason;
  };
  assert.match(await reasonFor(domError('NetworkError', 'GATT Error: Not paired.')), /paired/);
  assert.match(await reasonFor(domError('NetworkError', 'Authentication failed.')), /paired/);
  // a plain lost connection still gets the "switched on and close by" advice
  assert.match(await reasonFor(domError('NetworkError', 'GATT Server is disconnected. Cannot perform GATT operations.')), /switched on and close by/);
});

test('connect: a device with no name reads naturally in the middle of a sentence', async () => {
  const device = new FakeDevice('', {}, { connectError: domError('NetworkError', 'Connection Error: Connection attempt failed.') });
  const res = await connectHealthDevice('weight', { env: fakeEnv(device).env });
  assert.equal(res.ok, false);
  assert.match(res.reason, /^Could not connect to your scale\./);
  // and at the start of one
  const strap = new FakeDevice('', { [0x180D]: { [0x2A37]: new FakeCharacteristic(0x2A37) } });
  const gone = [];
  const ok = await connectHealthDevice('heart_rate', { env: fakeEnv(strap).env, onDisconnect: (info) => gone.push(info) });
  assert.equal(ok.name, 'Your heart rate monitor');
  strap.drop();
  assert.match(gone[0].reason, /^Your heart rate monitor disconnected\./);
  const strap2 = new FakeDevice('', { [0x180D]: { [0x2A37]: new FakeCharacteristic(0x2A37) } });
  const gone2 = [];
  const ok2 = await connectHealthDevice('heart_rate', { env: fakeEnv(strap2).env, onDisconnect: (info) => gone2.push(info) });
  ok2.disconnect();
  assert.equal(gone2[0].reason, 'Disconnected from your heart rate monitor.');
});

test('connect: a clock option that is not a function falls back to the real clock', async () => {
  const hr = new FakeCharacteristic(0x2A37);
  const got = [];
  const res = await connectHealthDevice('heart_rate', { env: fakeEnv(new FakeDevice('Strap', { [0x180D]: { [0x2A37]: hr } })).env, clock: null, onReading: (r) => got.push(r) });
  assert.equal(res.ok, true);
  hr.emit([0x00, 0x48]);
  assert.equal(got.length, 1);
  assert.match(got[0].receivedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
});

test('connect: the device leaving while a characteristic is looked up leaves no listener behind', async () => {
  let device;
  const bp = new FakeCharacteristic(0x2A35);
  device = new FakeDevice('Cuff', { [0x1810]: { [0x2A35]: bp } }, { onGetCharacteristic: () => device.drop() });
  const res = await connectHealthDevice('blood_pressure', { env: fakeEnv(device).env });
  assert.equal(res.ok, false);
  assert.match(res.reason, /disconnected before it sent a reading/);
  assert.equal(bp.listeners, 0);
  assert.equal(bp.started, 0, 'no subscription is started on a device that has gone');
  assert.equal(device.goneListeners, 0);
});

test('connect: the device leaving calls onDisconnect once and stops the readings', async () => {
  const hr = new FakeCharacteristic(0x2A37);
  const device = new FakeDevice('Strap', { [0x180D]: { [0x2A37]: hr } });
  const gone = [];
  let readings = 0;
  const res = await connectHealthDevice('heart_rate', { env: fakeEnv(device).env, onReading: () => { readings += 1; }, onDisconnect: (info) => gone.push(info) });
  assert.equal(res.ok, true);
  hr.emit([0x00, 0x48]);
  device.drop();
  device.drop();
  hr.emit([0x00, 0x48]);
  assert.equal(readings, 1);
  assert.equal(gone.length, 1);
  assert.equal(gone[0].byUser, false);
  assert.equal(gone[0].name, 'Strap');
  assert.equal(typeof gone[0].reason, 'string');
  assert.equal(hr.listeners, 0);
  assert.equal(device.goneListeners, 0);
});

test('connect: disconnect() ends the connection and reports it once, as asked by the user', async () => {
  const hr = new FakeCharacteristic(0x2A37);
  const device = new FakeDevice('Strap', { [0x180D]: { [0x2A37]: hr } });
  const gone = [];
  const res = await connectHealthDevice('heart_rate', { env: fakeEnv(device).env, onDisconnect: (info) => gone.push(info) });
  res.disconnect();
  res.disconnect();
  assert.equal(device.gatt.disconnects, 1);
  assert.equal(device.gatt.connected, false);
  assert.equal(gone.length, 1);
  assert.equal(gone[0].byUser, true);
  assert.equal(hr.listeners, 0);
});

test('connect: a value that cannot be parsed goes to onError, and later values still arrive', async () => {
  const hr = new FakeCharacteristic(0x2A37);
  const device = new FakeDevice('Strap', { [0x180D]: { [0x2A37]: hr } });
  const errors = [];
  const readings = [];
  await connectHealthDevice('heart_rate', { env: fakeEnv(device).env, onReading: (r) => readings.push(r), onError: (e) => errors.push(e) });
  hr.emit([0x01, 0x48]); // 16-bit value promised, one byte sent
  assert.equal(readings.length, 0);
  assert.equal(errors.length, 1);
  assert.match(errors[0].reason, /could not read/);
  assert.ok(errors[0].error instanceof RangeError);
  hr.emit([0x00, 0x48]);
  assert.equal(readings.length, 1);
});

test('connect: readings sent during setup, then the device leaves: ok first, onDisconnect after', async () => {
  const order = [];
  let device;
  const spot = new FakeCharacteristic(0x2A5E, { onStart: (c) => { c.emit([0x00, 0x62, 0x00, 0x48, 0x00]); device.drop(); } });
  const cont = new FakeCharacteristic(0x2A5F);
  device = new FakeDevice('Oxi', { [0x1822]: { [0x2A5E]: spot, [0x2A5F]: cont } });
  const res = await connectHealthDevice('pulse_oximeter', {
    env: fakeEnv(device).env, onReading: () => order.push('reading'), onDisconnect: () => order.push('disconnect'),
  });
  order.push(`result ${res.ok}`);
  await tick();
  assert.deepEqual(order, ['reading', 'result true', 'disconnect']);
  assert.equal(cont.started, 0, 'it stops setting up once the device is gone');
});

test('connect: the device leaves during setup before sending anything', async () => {
  let device;
  const bp = new FakeCharacteristic(0x2A35, { onStart: () => device.drop() });
  device = new FakeDevice('Cuff', { [0x1810]: { [0x2A35]: bp } });
  let disconnects = 0;
  const res = await connectHealthDevice('blood_pressure', { env: fakeEnv(device).env, onDisconnect: () => { disconnects += 1; } });
  assert.equal(res.ok, false);
  assert.match(res.reason, /disconnected before it sent a reading/);
  await tick();
  assert.equal(disconnects, 0);
});

test('connect: by default it uses the real navigator.bluetooth', async () => {
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const hr = new FakeCharacteristic(0x2A37);
  const device = new FakeDevice('Strap', { [0x180D]: { [0x2A37]: hr } });
  const { env } = fakeEnv(device);
  Object.defineProperty(globalThis, 'navigator', { value: env.navigator, configurable: true, writable: true });
  try {
    assert.equal(bluetoothSupport().ok, true);
    const res = await connectHealthDevice('heart_rate');
    assert.equal(res.ok, true);
    assert.equal(hr.started, 1);
    res.disconnect();
  } finally {
    if (saved) Object.defineProperty(globalThis, 'navigator', saved);
    else delete globalThis.navigator;
  }
});

test('HEALTH_DEVICES uses the assigned service and characteristic numbers', () => {
  const uuids = (k) => HEALTH_DEVICES[k].characteristics.map((c) => c.uuid);
  assert.equal(HEALTH_DEVICES.heart_rate.service, 0x180D);
  assert.deepEqual(uuids('heart_rate'), [0x2A37]);
  assert.equal(HEALTH_DEVICES.blood_pressure.service, 0x1810);
  assert.deepEqual(uuids('blood_pressure'), [0x2A35]);
  assert.equal(HEALTH_DEVICES.weight.service, 0x181D);
  assert.deepEqual(uuids('weight'), [0x2A9D]);
  assert.equal(HEALTH_DEVICES.pulse_oximeter.service, 0x1822);
  assert.deepEqual(uuids('pulse_oximeter'), [0x2A5E, 0x2A5F]);
});
