// Standard Bluetooth health devices, read straight from the browser (Web Bluetooth):
// heart rate straps, blood pressure cuffs, scales and pulse oximeters. The parsers are
// pure functions on a DataView; nothing touches the DOM or storage at import time.
//
// Exported API:
//   parseSfloat(u16) -> number. NaN for NaN, NRes and the reserved value; +-Infinity for +-INFINITY.
//   sfloatSpecial(u16) -> 'nan' | 'nres' | '+inf' | '-inf' | 'reserved' | null
//   parseDateTime(view, offset = 0) -> { year, month, day, hours, minutes, seconds, iso }
//     iso is 'YYYY-MM-DDTHH:MM:SS' (device clock, no time zone) or null when unknown or invalid.
//   parseHeartRateMeasurement(view) -> { type, flags, heartRate, valueFormat, sensorContactSupported,
//     sensorContact (true | false | null when not reported), energyExpendedKj | null, rrIntervalsMs[] }
//   parseBloodPressureMeasurement(view) -> { type, flags, unit ('mmHg' | 'kPa'), systolic, diastolic,
//     meanArterialPressure, timestamp | null, pulseRate | null, userId | null, measurementStatus | null }
//   parseWeightMeasurement(view) -> { type, flags, unit ('kg' | 'lb'), weight | null,
//     measurementUnsuccessful, timestamp | null, userId | null, bmi | null, height | null, heightUnit }
//   parsePlxSpotCheck(view) -> { type, flags, spo2, pulseRate, timestamp | null, measurementStatus | null,
//     deviceSensorStatus | null, pulseAmplitudeIndex | null, deviceClockNotSet }
//   parsePlxContinuous(view) -> { type, flags, spo2, pulseRate, fast | null, slow | null,
//     measurementStatus | null, deviceSensorStatus | null, pulseAmplitudeIndex | null }
//   toSample(kind, reading, { person, now }) -> Sample (source 'bluetooth') or null when the reading
//     has no usable value. kind: 'heart_rate' | 'blood_pressure' | 'weight' | 'pulse_oximeter'.
//     start is the device's time stamp when it is believable, otherwise the arrival time
//     (reading.receivedAt, else now); a time stamp set aside is kept as detail.deviceTime.
//   bluetoothSupport(env = globalThis) -> { ok: true, reason: null } | { ok: false, reason }
//   connectHealthDevice(kind, { onReading(reading, sample), onDisconnect({ name, byUser, reason }),
//     onError({ reason, error }), person, env, clock, connectTimeoutMs })
//     -> Promise<{ ok: true, name, disconnect() } | { ok: false, reason }>
//   HEALTH_DEVICES, SFLOAT_SPECIAL, UNKNOWN_USER
// Parsers throw a RangeError that names the missing field when a value is too short, and a
// TypeError when the input is not bytes at all; connectHealthDevice catches both.
//
// Byte layouts come from these Bluetooth SIG documents, fetched 2026-11-08:
//   [GSS]  GATT Specification Supplement, version date 2026-09-09
//          https://btprodspecificationrefs.blob.core.windows.net/gatt-specification-supplement/GATT_Specification_Supplement.pdf
//   [HRS]  Heart Rate Service v1.0, [BLS] Blood Pressure Service v1.1.1, [WSS] Weight Scale Service v1.0.1,
//   [PLXS] Pulse Oximeter Service v1.0.1:
//          https://www.bluetooth.com/wp-content/uploads/Files/Specification/HTML/<HRS_v1.0|BLS_v1.1.1|WSS_v1.0.1|PLXS_v1.0.1>/out/en/index-en.html
//   [PHD]  Personal Health Devices Transcoding white paper v16
//          https://www.bluetooth.com/wp-content/uploads/2019/03/PHD_Transcoding_WP_v16.pdf
//   [AN]   Assigned Numbers, assigned_numbers/uuids/{service,characteristic}_uuids.yaml
//          https://bitbucket.org/bluetooth-SIG/public/src/main/assigned_numbers/uuids/
//   [WEB]  Web Bluetooth, Web Bluetooth Community Group draft of 3 June 2026,
//          https://bluetooth.spec.whatwg.org/
// Every multi-octet field is little endian: [GSS] 2.4, [HRS] 1.7, [PLXS] 1.7.

// ---------- constants ----------
// [GSS] 2.1.1 Table 2.1, [PLXS] 5.1 Table 5.1, [BLS] 4.1.
export const SFLOAT_SPECIAL = Object.freeze({
  NAN: 0x07FF, NRES: 0x0800, POSITIVE_INFINITY: 0x07FE, NEGATIVE_INFINITY: 0x0802, RESERVED: 0x0801,
});
// "Unknown user": [GSS] Table 3.54, [WSS] 3.2.1.4.
export const UNKNOWN_USER = 0xFF;

// Unit conversions, NIST SP 811 Appendix B.8: the pound is 0.453 592 37 kg exactly (note 22),
// the inch 0.0254 m exactly, the conventional mmHg 133.3224 Pa.
// https://www.nist.gov/pml/special-publication-811/nist-guide-si-appendix-b-conversion-factors/nist-guide-si-appendix-b8
const LB_TO_KG = 0.45359237;
const INCH_TO_M = 0.0254;
const PA_PER_MMHG = 133.3224;

// ---------- small helpers ----------
const pad = (n, width = 2) => String(n).padStart(width, '0');

function localDateTime(d) {
  const t = d instanceof Date && !Number.isNaN(d.getTime()) ? d : new Date();
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}T${pad(t.getHours())}:${pad(t.getMinutes())}:${pad(t.getSeconds())}`;
}

// Web Bluetooth hands over a DataView; byte arrays and buffers are accepted too, for tests and tools.
function toView(data, what) {
  if (ArrayBuffer.isView(data)) {
    return typeof data.getUint8 === 'function' ? data : new DataView(data.buffer, data.byteOffset, data.byteLength);
  }
  if (data instanceof ArrayBuffer) return new DataView(data);
  if (Array.isArray(data)) {
    // Uint8Array.from would quietly wrap 256 to 0 and -1 to 255, giving a wrong reading.
    if (!data.every((b) => Number.isInteger(b) && b >= 0 && b <= 0xFF)) {
      throw new TypeError(`${what}: a byte array must hold whole numbers from 0 to 255.`);
    }
    return new DataView(Uint8Array.from(data).buffer);
  }
  throw new TypeError(`${what}: expected the value as a DataView, an ArrayBuffer or a byte array.`);
}

// Reads fields in order and names the field that ran past the end of a short value.
function fieldReader(view, what) {
  let pos = 0;
  const need = (n, field) => {
    if (pos + n > view.byteLength) {
      throw new RangeError(`${what}: the value ends before the ${field} field (needs ${pos + n} bytes, has ${view.byteLength}).`);
    }
  };
  const u8 = (field) => { need(1, field); const v = view.getUint8(pos); pos += 1; return v; };
  const u16 = (field) => { need(2, field); const v = view.getUint16(pos, true); pos += 2; return v; };
  const u24 = (field) => { need(3, field); const v = view.getUint16(pos, true) | (view.getUint8(pos + 2) << 16); pos += 3; return v; };
  const sfloat = (field) => parseSfloat(u16(field));
  const dateTime = (field) => { need(7, field); const v = parseDateTime(view, pos); pos += 7; return v; };
  return { u8, u16, u24, sfloat, dateTime, remaining: () => view.byteLength - pos };
}

function namedBits(raw, names) {
  const out = { raw };
  for (const [bit, name] of names) out[name] = (raw & (1 << bit)) !== 0;
  return out;
}

const setNames = (status) => (status ? Object.keys(status).filter((k) => k !== 'raw' && status[k] === true) : []);

// ---------- SFLOAT (IEEE 11073-20601 16-bit float, "medfloat16") ----------
// [PHD] 2.2.2: a 4-bit exponent to base 10 (top nibble) and a 12-bit mantissa, both two's
// complement; value = mantissa x 10^exponent. Its example: 114 mmHg is 0x0072.
// The special values all have exponent 0 ([PHD] 2.2.2), so only those exact codes are special.
export function parseSfloat(u16) {
  if (!Number.isInteger(u16) || u16 < 0 || u16 > 0xFFFF) {
    throw new RangeError(`parseSfloat: expected a 16-bit unsigned integer, got ${u16}.`);
  }
  switch (u16) {
    case SFLOAT_SPECIAL.POSITIVE_INFINITY: return Infinity;
    case SFLOAT_SPECIAL.NEGATIVE_INFINITY: return -Infinity;
    case SFLOAT_SPECIAL.NAN:
    case SFLOAT_SPECIAL.NRES: // not at this resolution: no usable number
    case SFLOAT_SPECIAL.RESERVED:
      return NaN;
    default: break;
  }
  let mantissa = u16 & 0x0FFF;
  if (mantissa >= 0x0800) mantissa -= 0x1000;
  let exponent = u16 >> 12;
  if (exponent >= 0x8) exponent -= 0x10;
  // Divide for negative exponents: 901 x 10^-1 is then exactly 90.1, not 90.10000000000001.
  return exponent < 0 ? mantissa / 10 ** -exponent : mantissa * 10 ** exponent;
}

export function sfloatSpecial(u16) {
  switch (u16) {
    case SFLOAT_SPECIAL.NAN: return 'nan';
    case SFLOAT_SPECIAL.NRES: return 'nres';
    case SFLOAT_SPECIAL.POSITIVE_INFINITY: return '+inf';
    case SFLOAT_SPECIAL.NEGATIVE_INFINITY: return '-inf';
    case SFLOAT_SPECIAL.RESERVED: return 'reserved';
    default: return null;
  }
}

// ---------- Date Time (0x2A08), used as the time stamp field ----------
// [GSS] 3.80 Table 3.144: year uint16 (1582 to 9999, 0 = unknown), month (1 to 12, 0 = unknown),
// day (1 to 31, 0 = unknown), hours (0 to 23), minutes (0 to 59), seconds (0 to 59); other values
// are reserved. The device clock carries no time zone, so iso has none either.
export function parseDateTime(view, offset = 0) {
  const v = toView(view, 'Date Time');
  if (!Number.isInteger(offset) || offset < 0 || offset + 7 > v.byteLength) {
    throw new RangeError(`Date Time: needs 7 bytes starting at offset ${offset}, but the value has ${v.byteLength}.`);
  }
  const year = v.getUint16(offset, true);
  const month = v.getUint8(offset + 2);
  const day = v.getUint8(offset + 3);
  const hours = v.getUint8(offset + 4);
  const minutes = v.getUint8(offset + 5);
  const seconds = v.getUint8(offset + 6);
  let iso = null;
  const inRange = year >= 1582 && year <= 9999 && month >= 1 && month <= 12 && day >= 1 && day <= 31
    && hours <= 23 && minutes <= 59 && seconds <= 59;
  // A day that is not in that month (30 February) is treated as unknown too.
  if (inRange && new Date(Date.UTC(year, month - 1, day)).getUTCDate() === day) {
    iso = `${pad(year, 4)}-${pad(month)}-${pad(day)}T${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  }
  return { year, month, day, hours, minutes, seconds, iso };
}

// ---------- Heart Rate Measurement (0x2A37) ----------
// [GSS] 3.126 Tables 3.215 to 3.217 and [HRS] 3.1.1. Flags: bit 0 value is uint16 (else uint8),
// bit 1 sensor contact detected, bit 2 sensor contact supported, bit 3 Energy Expended present,
// bit 4 RR-Intervals present, bits 5 to 7 reserved.
export function parseHeartRateMeasurement(view) {
  const r = fieldReader(toView(view, 'Heart Rate Measurement'), 'Heart Rate Measurement');
  const flags = r.u8('Flags');
  const wide = (flags & 0x01) !== 0;
  const heartRate = wide ? r.u16('Heart Rate Measurement Value') : r.u8('Heart Rate Measurement Value');
  // [HRS] 3.1.1.1.2: bit 1 only means something when bit 2 says the sensor reports contact.
  const sensorContactSupported = (flags & 0x04) !== 0;
  const sensorContact = sensorContactSupported ? (flags & 0x02) !== 0 : null;
  // [HRS] 3.1.1.3: kilojoules since the last reset; 0xFFFF means it reached the maximum.
  // ([GSS] Table 3.215 names the joule; the service specification and [PHD] 3.2.2.3 read it as kJ.)
  const energyExpendedKj = flags & 0x08 ? r.u16('Energy Expended') : null;
  // [GSS] 3.126.2: uint16 values in 1/1024 s, oldest first, as many as fill the value.
  // A single leftover byte cannot be an interval and is ignored.
  const rrIntervalsMs = [];
  if (flags & 0x10) {
    while (r.remaining() >= 2) rrIntervalsMs.push((r.u16('RR-Interval') * 1000) / 1024);
  }
  return {
    type: 'heart_rate_measurement', flags, heartRate, valueFormat: wide ? 'uint16' : 'uint8',
    sensorContactSupported, sensorContact, energyExpendedKj, rrIntervalsMs,
  };
}

// ---------- Blood Pressure Measurement (0x2A35) ----------
// [GSS] 3.34 Tables 3.52 and 3.53, [BLS] 3.1.1. Flags: bit 0 units (0 mmHg, 1 kPa), bit 1 time
// stamp, bit 2 pulse rate, bit 3 user ID, bit 4 measurement status, bits 5 to 7 reserved.
// Systolic, diastolic and mean arterial pressure are always present as SFLOAT; in kPa the SFLOAT
// is the number of kilopascals (base unit pascal, d = 3).
const PULSE_RATE_RANGE = ['in_range', 'above_upper_limit', 'below_lower_limit', 'reserved'];

export function parseBloodPressureMeasurement(view) {
  const r = fieldReader(toView(view, 'Blood Pressure Measurement'), 'Blood Pressure Measurement');
  const flags = r.u8('Flags');
  const unit = flags & 0x01 ? 'kPa' : 'mmHg';
  const systolic = r.sfloat('Systolic');
  const diastolic = r.sfloat('Diastolic');
  const meanArterialPressure = r.sfloat('Mean Arterial Pressure');
  const timestamp = flags & 0x02 ? r.dateTime('Time Stamp') : null;
  const pulseRate = flags & 0x04 ? r.sfloat('Pulse Rate') : null;
  const userId = flags & 0x08 ? r.u8('User ID') : null;
  let measurementStatus = null;
  if (flags & 0x10) {
    // [GSS] 3.34.3 Table 3.55: bits 3 and 4 together give the pulse rate range; 6 to 15 reserved.
    const raw = r.u16('Measurement Status');
    measurementStatus = {
      raw,
      bodyMovement: (raw & 0x0001) !== 0,
      cuffTooLoose: (raw & 0x0002) !== 0,
      irregularPulse: (raw & 0x0004) !== 0,
      pulseRateRange: PULSE_RATE_RANGE[(raw >> 3) & 0x03],
      improperPosition: (raw & 0x0020) !== 0,
    };
  }
  return {
    type: 'blood_pressure_measurement', flags, unit, systolic, diastolic, meanArterialPressure,
    timestamp, pulseRate, userId, measurementStatus,
  };
}

// ---------- Weight Measurement (0x2A9D) ----------
// [GSS] 3.276 Tables 3.408 and 3.409, [WSS] 3.2.1. Flags: bit 0 units (0 SI: kg and m,
// 1 imperial: lb and in), bit 1 time stamp, bit 2 user ID, bit 3 BMI and height, 4 to 7 reserved.
// Weight uint16 in 0.005 kg or 0.01 lb; BMI uint16 in 0.1 kg/m2; height uint16 in 0.001 m or 0.1 in.
export function parseWeightMeasurement(view) {
  const r = fieldReader(toView(view, 'Weight Measurement'), 'Weight Measurement');
  const flags = r.u8('Flags');
  const imperial = (flags & 0x01) !== 0;
  const raw = r.u16('Weight');
  // [WSS] 3.2.1.2: 0xFFFF means "Measurement Unsuccessful".
  const measurementUnsuccessful = raw === 0xFFFF;
  // Divide rather than multiply: 13014 steps of 0.005 kg is then exactly 65.07, not 65.07000000000001.
  const weight = measurementUnsuccessful ? null : imperial ? raw / 100 : raw / 200;
  const timestamp = flags & 0x02 ? r.dateTime('Time Stamp') : null;
  const userId = flags & 0x04 ? r.u8('User ID') : null;
  let bmi = null;
  let height = null;
  if (flags & 0x08) {
    bmi = r.u16('BMI') / 10;
    const h = r.u16('Height');
    height = imperial ? h / 10 : h / 1000;
  }
  return {
    type: 'weight_measurement', flags, unit: imperial ? 'lb' : 'kg', weight, measurementUnsuccessful,
    timestamp, userId, bmi, height, heightUnit: imperial ? 'in' : 'm',
  };
}

// ---------- PLX Spot-check (0x2A5E) and PLX Continuous (0x2A5F) ----------
// Status bit names: [PLXS] 3.1.1.4 Table 3.4 (bits 0 to 4 reserved) and 3.1.1.5 Table 3.5
// (24 bits; 16 to 23 reserved). The continuous measurement uses the same definitions.
const PLX_MEASUREMENT_STATUS = [
  [5, 'measurementOngoing'], [6, 'earlyEstimatedData'], [7, 'validatedData'], [8, 'fullyQualifiedData'],
  [9, 'dataFromMeasurementStorage'], [10, 'dataForDemonstration'], [11, 'dataForTesting'],
  [12, 'calibrationOngoing'], [13, 'measurementUnavailable'], [14, 'questionableMeasurementDetected'],
  [15, 'invalidMeasurementDetected'],
];
const PLX_DEVICE_SENSOR_STATUS = [
  'extendedDisplayUpdateOngoing', 'equipmentMalfunctionDetected', 'signalProcessingIrregularityDetected',
  'inadequateSignalDetected', 'poorSignalDetected', 'lowPerfusionDetected', 'erraticSignalDetected',
  'nonPulsatileSignalDetected', 'questionablePulseDetected', 'signalAnalysisOngoing',
  'sensorInterferenceDetected', 'sensorUnconnectedToUser', 'unknownSensorConnected', 'sensorDisplaced',
  'sensorMalfunctioning', 'sensorDisconnected',
].map((name, bit) => [bit, name]);

// [PLXS] 3.1 Tables 3.2 and 3.3. Flags: bit 0 timestamp, bit 1 measurement status, bit 2 device
// and sensor status, bit 3 pulse amplitude index, bit 4 device clock is not set, 5 to 7 reserved.
// SpO2 (%) and pulse rate (bpm) are SFLOAT and always present; NaN when unavailable (3.1.1.2).
export function parsePlxSpotCheck(view) {
  const r = fieldReader(toView(view, 'PLX Spot-check Measurement'), 'PLX Spot-check Measurement');
  const flags = r.u8('Flags');
  const spo2 = r.sfloat('SpO2');
  const pulseRate = r.sfloat('PR');
  const timestamp = flags & 0x01 ? r.dateTime('Timestamp') : null;
  const measurementStatus = flags & 0x02 ? namedBits(r.u16('Measurement Status'), PLX_MEASUREMENT_STATUS) : null;
  const deviceSensorStatus = flags & 0x04 ? namedBits(r.u24('Device and Sensor Status'), PLX_DEVICE_SENSOR_STATUS) : null;
  const pulseAmplitudeIndex = flags & 0x08 ? r.sfloat('Pulse Amplitude Index') : null;
  return {
    type: 'plx_spot_check_measurement', flags, spo2, pulseRate, timestamp, measurementStatus,
    deviceSensorStatus, pulseAmplitudeIndex, deviceClockNotSet: (flags & 0x10) !== 0,
  };
}

// [PLXS] 3.2 Tables 3.6 and 3.7. Flags: bit 0 SpO2PR-Fast, bit 1 SpO2PR-Slow, bit 2 measurement
// status, bit 3 device and sensor status, bit 4 pulse amplitude index, 5 to 7 reserved. Each
// SpO2PR field is SpO2 then PR, both SFLOAT; SpO2PR-Normal is always present.
export function parsePlxContinuous(view) {
  const r = fieldReader(toView(view, 'PLX Continuous Measurement'), 'PLX Continuous Measurement');
  const flags = r.u8('Flags');
  const pair = (label) => {
    const spo2 = r.sfloat(`${label} SpO2`);
    const pulseRate = r.sfloat(`${label} PR`);
    return { spo2, pulseRate };
  };
  const normal = pair('SpO2PR-Normal');
  const fast = flags & 0x01 ? pair('SpO2PR-Fast') : null;
  const slow = flags & 0x02 ? pair('SpO2PR-Slow') : null;
  const measurementStatus = flags & 0x04 ? namedBits(r.u16('Measurement Status'), PLX_MEASUREMENT_STATUS) : null;
  const deviceSensorStatus = flags & 0x08 ? namedBits(r.u24('Device and Sensor Status'), PLX_DEVICE_SENSOR_STATUS) : null;
  const pulseAmplitudeIndex = flags & 0x10 ? r.sfloat('Pulse Amplitude Index') : null;
  return {
    type: 'plx_continuous_measurement', flags, spo2: normal.spo2, pulseRate: normal.pulseRate, fast, slow,
    measurementStatus, deviceSensorStatus, pulseAmplitudeIndex,
  };
}

// ---------- devices ----------
// Service and characteristic UUIDs from [AN]. [WEB] 7 accepts a 16-bit alias as a number.
export const HEALTH_DEVICES = Object.freeze({
  heart_rate: Object.freeze({
    label: 'heart rate monitor', readings: 'heart rate', service: 0x180D,
    characteristics: Object.freeze([{ id: 'heart_rate_measurement', uuid: 0x2A37, parse: parseHeartRateMeasurement }]),
  }),
  blood_pressure: Object.freeze({
    label: 'blood pressure monitor', readings: 'blood pressure', service: 0x1810,
    characteristics: Object.freeze([{ id: 'blood_pressure_measurement', uuid: 0x2A35, parse: parseBloodPressureMeasurement }]),
  }),
  weight: Object.freeze({
    label: 'scale', readings: 'weight', service: 0x181D,
    characteristics: Object.freeze([{ id: 'weight_measurement', uuid: 0x2A9D, parse: parseWeightMeasurement }]),
  }),
  // [PLXS] Table 3.1: a pulse oximeter has at least one of these two.
  pulse_oximeter: Object.freeze({
    label: 'pulse oximeter', readings: 'blood oxygen', service: 0x1822,
    characteristics: Object.freeze([
      { id: 'plx_spot_check_measurement', uuid: 0x2A5E, parse: parsePlxSpotCheck },
      { id: 'plx_continuous_measurement', uuid: 0x2A5F, parse: parsePlxContinuous },
    ]),
  }),
});

// ---------- readings to Samples ----------
// The time of measurement is the device's time stamp when it has a believable one, otherwise the
// time the reading arrived. Both are local clock time with no time zone, so the date never shifts.
// A device clock that was never set or runs ahead gives impossible times, which would put the
// reading in the wrong week (even the first one, the baseline). Not believable: later than the
// arrival, or earlier than Bluetooth Low Energy itself (Core Specification 4.0, adopted
// 30 June 2010). Such a time is kept as detail.deviceTime.
const FIRST_BLE_DAY = '2010-06-30';

function timesOf(reading, now) {
  const arrival = (typeof reading.receivedAt === 'string' && reading.receivedAt) || localDateTime(now);
  const t = reading.timestamp;
  const device = t && typeof t.iso === 'string' ? t.iso : null;
  if (!device) return { start: arrival, deviceTime: null };
  if (reading.deviceClockNotSet) return { start: arrival, deviceTime: device };
  // Same 'YYYY-MM-DDTHH:MM:SS' layout, so text order is time order.
  const a = arrival.slice(0, 19);
  const believable = device >= FIRST_BLE_DAY && device.slice(0, a.length) <= a;
  return believable ? { start: device, deviceTime: null } : { start: arrival, deviceTime: device };
}

function cleanDetail(detail) {
  const out = {};
  for (const [k, v] of Object.entries(detail)) {
    if (v == null || (typeof v === 'number' && !Number.isFinite(v)) || (Array.isArray(v) && v.length === 0)) continue;
    out[k] = v;
  }
  return out;
}

// No usable value: not a number, zero or less (no measurement of a living person reads 0),
// or a percentage above 100.
const usable = (v, max = Infinity) => Number.isFinite(v) && v > 0 && v <= max;

function bpWarnings(status) {
  if (!status) return [];
  const out = [];
  if (status.bodyMovement) out.push('body_movement');
  if (status.cuffTooLoose) out.push('cuff_too_loose');
  if (status.irregularPulse) out.push('irregular_pulse');
  if (status.pulseRateRange === 'above_upper_limit') out.push('pulse_rate_above_device_range');
  if (status.pulseRateRange === 'below_lower_limit') out.push('pulse_rate_below_device_range');
  if (status.improperPosition) out.push('improper_position');
  return out;
}

export function toSample(kind, reading, { person, now } = {}) {
  if (!reading || typeof reading !== 'object') return null;
  const make = (signal, value, unit, detail, extra = {}) => {
    const { start, deviceTime } = timesOf(reading, now);
    const sample = { signal, start, value, unit, source: 'bluetooth', ...extra };
    if (person != null && person !== '') sample.person = person;
    // When the device clock gave the time, keep the arrival time too: a clock that is a little
    // wrong shows up as a gap between the two.
    const receivedAt = reading.receivedAt !== start ? reading.receivedAt : null;
    const d = cleanDetail({ ...detail, receivedAt, deviceTime });
    if (Object.keys(d).length) sample.detail = d;
    return sample;
  };
  switch (kind) {
    case 'heart_rate': {
      // No or poor skin contact ([HRS] 3.1.1.1.2): the number is not a reading of the person.
      if (!usable(reading.heartRate) || reading.sensorContact === false) return null;
      return make('heart_rate', reading.heartRate, 'bpm', {
        rrIntervalsMs: Array.isArray(reading.rrIntervalsMs) ? [...reading.rrIntervalsMs] : null,
        energyExpendedKj: reading.energyExpendedKj,
        sensorContact: reading.sensorContact,
      });
    }
    case 'blood_pressure': {
      const mmHg = reading.unit === 'kPa' ? (v) => (v * 1000) / PA_PER_MMHG : (v) => v;
      const systolic = mmHg(reading.systolic);
      const diastolic = mmHg(reading.diastolic);
      if (!usable(systolic) || !usable(diastolic)) return null;
      return make('bp', systolic, 'mmHg', {
        meanArterialPressure: mmHg(reading.meanArterialPressure),
        pulseRate: reading.pulseRate,
        deviceUnit: reading.unit,
        deviceUser: reading.userId,
        warnings: bpWarnings(reading.measurementStatus),
      }, { value2: diastolic });
    }
    case 'weight': {
      if (reading.measurementUnsuccessful || !usable(reading.weight)) return null;
      const kg = reading.unit === 'lb' ? reading.weight * LB_TO_KG : reading.weight;
      const heightM = reading.height == null ? null : reading.heightUnit === 'in' ? reading.height * INCH_TO_M : reading.height;
      return make('weight', kg, 'kg', {
        bmi: reading.bmi, heightM, deviceUnit: reading.unit, deviceUser: reading.userId,
      });
    }
    case 'pulse_oximeter': {
      const ms = reading.measurementStatus || {};
      const ds = reading.deviceSensorStatus || {};
      // The oximeter itself says this is not a measurement of the person ([PLXS] Tables 3.4, 3.5).
      if (ms.measurementUnavailable || ms.invalidMeasurementDetected || ds.sensorUnconnectedToUser || ds.sensorDisconnected) return null;
      if (!usable(reading.spo2, 100)) return null;
      // Demonstration or test data from the device is not the person's data.
      const extra = ms.dataForDemonstration || ms.dataForTesting ? { simulated: true } : {};
      return make('spo2', reading.spo2, '%', {
        pulseRate: reading.pulseRate,
        pulseAmplitudeIndex: reading.pulseAmplitudeIndex,
        measurement: reading.type === 'plx_continuous_measurement' ? 'continuous' : 'spot_check',
        status: setNames(reading.measurementStatus),
        sensorStatus: setNames(reading.deviceSensorStatus),
      }, extra);
    }
    default:
      return null;
  }
}

// ---------- can this browser do it? ----------
const REASON = {
  ios: 'This iPhone or iPad browser cannot connect web pages to Bluetooth devices. Use Chrome or Edge on a computer or an Android phone, or type the reading in by hand.',
  insecure: 'Bluetooth only works on a secure page. Open the app from an address that starts with https://.',
  blocked: 'Bluetooth is blocked for this page. If the app is shown inside another page, open it in its own browser tab.',
  browser: 'This browser cannot connect to Bluetooth devices. Use Chrome or Edge on a computer or an Android phone, or type the reading in by hand.',
  noDevice: 'No device was chosen.',
  noAdapter: 'Bluetooth is not available on this computer or phone. Check that Bluetooth is turned on, then try again.',
  disabled: 'Bluetooth for web pages is turned off in this browser\'s settings.',
  scanDenied: 'The browser is not allowed to look for nearby devices. Allow it in your phone\'s settings, then try again.',
  gesture: 'Bluetooth can only start from a button press. Press Connect again.',
  security: 'The browser blocked Bluetooth on this page.',
  unknownKind: 'This app cannot read that kind of device over Bluetooth.',
  start: 'Bluetooth did not start. Please try again.',
};

// iPadOS 13 and later can report a Mac user agent; a Mac with a touch screen is an iPad.
function isAppleMobile(nav) {
  const ua = String((nav && nav.userAgent) || '');
  if (/\b(iPhone|iPad|iPod)\b/.test(ua)) return true;
  return /\bMacintosh\b/.test(ua) && Number(nav && nav.maxTouchPoints) > 1;
}

// [WEB] 11.1: the "bluetooth" permissions-policy feature (default allowlist "self") decides
// whether a frame may use it. Unknown when the browser has no policy API: requestDevice will tell.
// Chromium's allowsFeature answers false for a feature name it does not know
// (third_party/blink/renderer/core/permissions_policy/dom_feature_policy.cc), so a browser from
// before the "bluetooth" feature would look blocked: believe a "no" only for a listed feature.
function policyAllows(env) {
  const doc = env && env.document;
  const policy = doc && (doc.permissionsPolicy || doc.featurePolicy);
  if (!policy || typeof policy.allowsFeature !== 'function') return true;
  try {
    if (typeof policy.features === 'function') {
      const known = policy.features();
      if (known && typeof known.includes === 'function' && !known.includes('bluetooth')) return true;
    }
    return policy.allowsFeature('bluetooth') !== false;
  } catch { return true; }
}

export function bluetoothSupport(env = globalThis) {
  const nav = env && env.navigator;
  const bluetooth = nav && nav.bluetooth;
  if (bluetooth && typeof bluetooth.requestDevice === 'function') {
    if (env.isSecureContext === false) return { ok: false, reason: REASON.insecure };
    if (!policyAllows(env)) return { ok: false, reason: REASON.blocked };
    return { ok: true, reason: null };
  }
  // MDN browser-compat-data lists no Web Bluetooth in Safari, desktop or iOS. An iPhone browser
  // that does provide navigator.bluetooth took the branch above.
  if (isAppleMobile(nav)) return { ok: false, reason: REASON.ios };
  // [WEB] 10: navigator.bluetooth exists only in secure contexts.
  if (env && env.isSecureContext === false) return { ok: false, reason: REASON.insecure };
  return { ok: false, reason: REASON.browser };
}

// [WEB] 4: a cancelled chooser rejects with NotFoundError. Chromium also uses NotFoundError for
// a missing adapter or a disabled API, and says which in the message
// (third_party/blink/renderer/modules/bluetooth/bluetooth_error.cc).
function chooserReason(err) {
  const name = err && err.name;
  const message = String((err && err.message) || '');
  if (name === 'NotFoundError') {
    if (/adapter not available|low energy not available/i.test(message)) return REASON.noAdapter;
    if (/not supported on this platform/i.test(message)) return REASON.browser;
    if (/globally disabled|disabled web bluetooth/i.test(message)) return REASON.disabled;
    if (/permission to scan/i.test(message)) return REASON.scanDenied;
    return REASON.noDevice;
  }
  if (name === 'SecurityError') {
    if (/permissions policy/i.test(message)) return REASON.blocked;
    if (/gesture|activation/i.test(message)) return REASON.gesture;
    return REASON.security;
  }
  return REASON.start;
}

// who.name starts a sentence ("Your scale ..."), who.mid sits inside one ("... to your scale").
function connectReason(err, who, profile) {
  const pairing = `${who.name} did not let this page read its measurements. Some devices must first be paired in the computer's or phone's Bluetooth settings.`;
  switch (err && err.name) {
    case 'TimeoutError':
      return `${who.name} did not answer. Make sure it is switched on and close by, then try again.`;
    case 'NetworkError':
      // Chromium reports a device that needs pairing as a NetworkError too: "GATT Error: Not
      // paired." and "Authentication failed." (bluetooth_error.cc).
      if (/not paired|authenticat/i.test(String(err.message || ''))) return pairing;
      return `Could not connect to ${who.mid}. Make sure it is switched on and close by, then try again.`;
    case 'AbortError':
      return `Could not connect to ${who.mid}. Make sure it is switched on and close by, then try again.`;
    case 'NotFoundError':
      return `${who.name} does not share standard ${profile.readings} readings, so this app cannot read it. You can type the reading in by hand.`;
    case 'SecurityError':
    case 'NotSupportedError':
    case 'NotAllowedError':
      return pairing;
    default:
      return `Something went wrong while connecting to ${who.mid}. Please try again.`;
  }
}

function timeoutError() {
  const err = new Error('The device did not answer in time.');
  err.name = 'TimeoutError';
  return err;
}

function withTimeout(promise, ms) {
  if (!Number.isFinite(ms) || ms <= 0) return Promise.resolve(promise);
  let timer;
  const timeout = new Promise((resolve, reject) => { timer = setTimeout(() => reject(timeoutError()), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// ---------- connect ----------
// requestDevice must run straight from a button press ([WEB] 4 needs transient activation), so
// nothing is awaited before it. onDisconnect is called once, and only after a result with ok: true.
export async function connectHealthDevice(kind, options = {}) {
  const {
    onReading, onDisconnect, onError, person, env = globalThis, clock = () => new Date(), connectTimeoutMs = 30000,
  } = options || {};
  const profile = Object.prototype.hasOwnProperty.call(HEALTH_DEVICES, kind) ? HEALTH_DEVICES[kind] : null;
  if (!profile) return { ok: false, reason: REASON.unknownKind };
  const support = bluetoothSupport(env);
  if (!support.ok) return { ok: false, reason: support.reason };

  let device;
  try {
    device = await env.navigator.bluetooth.requestDevice({ filters: [{ services: [profile.service] }] });
  } catch (err) {
    return { ok: false, reason: chooserReason(err) };
  }
  if (!device || !device.gatt || typeof device.gatt.connect !== 'function') {
    return { ok: false, reason: REASON.start };
  }
  const own = typeof device.name === 'string' ? device.name.trim() : '';
  const name = own || `Your ${profile.label}`;
  const who = { name, mid: own || `your ${profile.label}` };

  const subscriptions = [];
  let setupDone = false;
  let closed = false;
  let byUser = false;
  let goneDuringSetup = false;
  let received = 0;

  const tellGone = () => {
    if (typeof onDisconnect !== 'function') return;
    const reason = byUser
      ? `Disconnected from ${who.mid}.`
      : kind === 'heart_rate'
        ? `${name} disconnected. It may be out of range or its battery may be low.`
        : `${name} disconnected. Many devices do this after they send a reading.`;
    onDisconnect({ name, byUser, reason });
  };
  const cleanup = () => {
    for (const { characteristic, listener } of subscriptions.splice(0)) {
      try { characteristic.removeEventListener('characteristicvaluechanged', listener); } catch { /* already gone */ }
    }
    try { device.removeEventListener('gattserverdisconnected', onGone); } catch { /* already gone */ }
  };
  function onGone() {
    if (closed) return;
    closed = true;
    cleanup();
    if (setupDone) tellGone(); else goneDuringSetup = true;
  }
  const disconnect = () => {
    if (closed) return;
    byUser = true;
    // [WEB] 6.2 and 6.6.3: disconnect() fires gattserverdisconnected, which calls onGone;
    // the direct call covers a browser that does not.
    try { device.gatt.disconnect(); } catch { /* already gone */ }
    onGone();
  };
  // Give up quietly: the caller gets ok: false, so it hears nothing from onDisconnect.
  const fail = (err) => {
    closed = true;
    cleanup();
    try { device.gatt.disconnect(); } catch { /* already gone */ }
    return { ok: false, reason: connectReason(err, who, profile) };
  };

  const handleValue = (event, characteristic, ch) => {
    if (closed) return;
    const view = (event && event.target && event.target.value) || characteristic.value;
    let reading;
    try {
      reading = ch.parse(view);
    } catch (error) {
      if (typeof onError === 'function') onError({ reason: `${name} sent a reading this app could not read, so it was skipped.`, error });
      return;
    }
    reading.receivedAt = localDateTime(typeof clock === 'function' ? clock() : new Date());
    received += 1;
    const sample = toSample(kind, reading, { person });
    if (typeof onReading === 'function') onReading(reading, sample);
  };

  if (typeof device.addEventListener === 'function') device.addEventListener('gattserverdisconnected', onGone);
  try {
    const server = await withTimeout(device.gatt.connect(), connectTimeoutMs);
    const service = await server.getPrimaryService(profile.service);
    let firstError = null;
    for (const ch of profile.characteristics) {
      if (closed) break;
      let entry = null;
      try {
        const characteristic = await service.getCharacteristic(ch.uuid);
        // It left while we waited: the clean-up has run, so add no listener it would miss.
        if (closed) break;
        const listener = (event) => handleValue(event, characteristic, ch);
        // Listen before subscribing: cuffs and scales often send stored readings at once.
        characteristic.addEventListener('characteristicvaluechanged', listener);
        entry = { characteristic, listener };
        subscriptions.push(entry);
        // [WEB] 6.4: works for both notify (heart rate, continuous) and indicate (the others).
        await characteristic.startNotifications();
      } catch (err) {
        const i = entry ? subscriptions.indexOf(entry) : -1;
        if (i >= 0) subscriptions.splice(i, 1);
        if (entry) {
          try { entry.characteristic.removeEventListener('characteristicvaluechanged', entry.listener); } catch { /* gone */ }
        }
        // A pulse oximeter may have only one of its two characteristics, so a missing one
        // (NotFoundError) is expected: any other failure says more about what went wrong.
        if (!firstError || (firstError.name === 'NotFoundError' && err && err.name !== 'NotFoundError')) firstError = err;
      }
    }
    if (!closed && subscriptions.length === 0) throw firstError || Object.assign(new Error('No measurement characteristic.'), { name: 'NotFoundError' });
  } catch (err) {
    if (received === 0) return fail(err);
  }
  setupDone = true;
  if (closed && received === 0) {
    return { ok: false, reason: `${name} disconnected before it sent a reading. Wake it up and try again.` };
  }
  // It sent readings and then left during setup: report it gone after the caller has the result
  // (a timer, because a microtask would run before the caller's await resumes).
  if (goneDuringSetup) setTimeout(tellGone, 0);
  return { ok: true, name, disconnect };
}
