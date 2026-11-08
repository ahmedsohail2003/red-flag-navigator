// Apple Health import and the zip reader, checked against values worked out by hand.
// Every fixture is built here as text, and the zip files are assembled byte by byte below,
// so the tests need no binary files.
// Run: node --test "tests/home-applehealth.test.mjs"
import test from 'node:test';
import assert from 'node:assert/strict';
import { listZipEntries, openZipEntry } from '../app/js/home/import/zip.js';
import {
  importAppleHealth, parseAppleHealthChunks, appleDateToIso, APPLE_HEALTH_TYPES,
} from '../app/js/home/import/applehealth.js';

const near = (actual, expected, tol = 1e-6) => assert.ok(Math.abs(actual - expected) <= tol, `${actual} is not ${expected}`);
const enc = new TextEncoder();

// ---------- building an export.xml like the Health app's ----------
const IPHONE = 'Ahmed’s iPhone'; // curly apostrophe, as real device names have
const WATCH = 'Ahmed’s Apple Watch';
const HK = 'HKQuantityTypeIdentifier';
// at(5, '08:30') -> '2024-05-05 08:30:00 -0400' (Apple's format: local time and its offset)
const at = (day, time) => `2024-05-${String(day).padStart(2, '0')} ${time.length === 5 ? `${time}:00` : time} -0400`;
const device = (name) => `&lt;&lt;HKDevice: 0x283e5f2a0&gt;, name:${name}, manufacturer:Apple Inc., model:iPhone, hardware:iPhone14,5, software:17.4&gt;`;

function rec(type, value, unit, start, { end = start, source = IPHONE, children = '' } = {}) {
  const t = type.startsWith('HK') ? type : `${HK}${type}`;
  const u = unit == null ? '' : ` unit="${unit}"`;
  const v = value == null ? '' : ` value="${value}"`;
  const open = ` <Record type="${t}" sourceName="${source}" sourceVersion="17.4" device="${device(source)}"${u} creationDate="${end}" startDate="${start}" endDate="${end}"${v}`;
  return children ? `${open}>\n${children}\n </Record>` : `${open}/>`;
}
const sleep = (stage, start, end, source = WATCH) => rec('HKCategoryTypeIdentifierSleepAnalysis', `HKCategoryValueSleepAnalysis${stage}`, null, start, { end, source });
const bpRecords = (sys, dia, start, source) => [
  rec('BloodPressureDiastolic', dia, 'mmHg', start, { source }),
  rec('BloodPressureSystolic', sys, 'mmHg', start, { source }),
].join('\n');
const bpCorrelation = (sys, dia, start, source) => ` <Correlation type="HKCorrelationTypeIdentifierBloodPressure" sourceName="${source}" sourceVersion="7.2" creationDate="${start}" startDate="${start}" endDate="${start}">
  <MetadataEntry key="HKWasUserEntered" value="0"/>
 ${bpRecords(sys, dia, start, source)}
 </Correlation>`;

// The DTD is shortened from a real export but keeps its traps: "<!ATTLIST Record", brackets,
// and the note that correlation children repeat top-level records.
function doc(body) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE HealthData [
<!-- HealthKit Export Version: 13 -->
<!ELEMENT HealthData (ExportDate,Me,(Record|Correlation|Workout|ActivitySummary|ClinicalRecord|Audiogram|VisionPrescription)*)>
<!ATTLIST HealthData
  locale CDATA #REQUIRED
>
<!ELEMENT ExportDate EMPTY>
<!ATTLIST ExportDate
  value CDATA #REQUIRED
>
<!ELEMENT Record ((MetadataEntry|HeartRateVariabilityMetadataList)*)>
<!ATTLIST Record
  type          CDATA #REQUIRED
  unit          CDATA #IMPLIED
  value         CDATA #IMPLIED
  sourceName    CDATA #REQUIRED
  sourceVersion CDATA #IMPLIED
  device        CDATA #IMPLIED
  creationDate  CDATA #IMPLIED
  startDate     CDATA #REQUIRED
  endDate       CDATA #REQUIRED
>
<!-- Note: Any Records that appear as children of a correlation also appear as top-level records in this document. -->
<!ELEMENT Correlation ((MetadataEntry|Record)*)>
<!ATTLIST Correlation
  type          CDATA #REQUIRED
  sourceName    CDATA #REQUIRED
  startDate     CDATA #REQUIRED
  endDate       CDATA #REQUIRED
>
]>
<HealthData locale="en_CA">
 <ExportDate value="2024-05-31 09:15:00 -0400"/>
 <Me HKCharacteristicTypeIdentifierDateOfBirth="1968-03-14" HKCharacteristicTypeIdentifierBiologicalSex="HKBiologicalSexMale" HKCharacteristicTypeIdentifierBloodType="HKBloodTypeNotSet"/>
${body}
</HealthData>
`;
}

// ---------- the fixtures ----------
// Every converted type, in metric and US units. Each record sits in its own hour, so the
// one-per-hour rule does not merge any of them.
const UNITS_BODY = [
  rec('WalkingSpeed', '3.168', 'km/hr', at(1, '08:00'), { end: at(1, '08:00:18') }),
  rec('WalkingSpeed', '2.5', 'mi/hr', at(1, '09:00'), { end: at(1, '09:00:20') }),
  rec('WalkingSpeed', '1.25', 'm/s', at(1, '10:00')),
  rec('WalkingStepLength', '60', 'cm', at(1, '08:00')),
  rec('WalkingStepLength', '25', 'in', at(1, '09:00')),
  rec('WalkingDoubleSupportPercentage', '0.27', '%', at(1, '08:00')),
  rec('WalkingAsymmetryPercentage', '0.08', '%', at(1, '08:00')),
  rec('AppleWalkingSteadiness', '0.95', '%', at(1, '08:00')),
  rec('SixMinuteWalkTestDistance', '450', 'm', at(1, '08:00'), { source: WATCH }),
  rec('SixMinuteWalkTestDistance', '1476', 'ft', at(8, '08:00'), { source: WATCH }),
  rec('StairAscentSpeed', '0.5', 'm/s', at(1, '08:00'), { source: WATCH }),
  rec('StairAscentSpeed', '1.5', 'ft/s', at(1, '09:00'), { source: WATCH }),
  rec('StairDescentSpeed', '0.6', 'm/s', at(1, '08:00'), { source: WATCH }),
  rec('StairDescentSpeed', '2', 'ft/s', at(1, '09:00'), { source: WATCH }),
  rec('BodyMass', '80', 'kg', at(1, '07:00'), { source: 'Withings' }),
  rec('BodyMass', '165', 'lb', at(2, '07:00'), { source: 'Withings' }),
  rec('BodyFatPercentage', '0.215', '%', at(1, '07:00'), { source: 'Withings' }),
  rec('LeanBodyMass', '60', 'kg', at(1, '07:00'), { source: 'Withings' }),
  rec('LeanBodyMass', '132', 'lb', at(2, '07:00'), { source: 'Withings' }),
  rec('RestingHeartRate', '58', 'count/min', at(1, '00:02:13'), { end: at(1, '23:57:41'), source: WATCH }),
  rec('HeartRateVariabilitySDNN', '45.5', 'ms', at(1, '23:10'), {
    end: at(1, '23:11'),
    source: WATCH,
    children: `  <HeartRateVariabilityMetadataList>
   <InstantaneousBeatsPerMinute bpm="62" time="11:10:01.23 PM"/>
   <InstantaneousBeatsPerMinute bpm="64" time="11:10:02.19 PM"/>
  </HeartRateVariabilityMetadataList>`,
  }),
  rec('OxygenSaturation', '0.97', '%', at(1, '03:00'), { source: WATCH }),
  rec('RespiratoryRate', '15.5', 'count/min', at(1, '03:00'), { source: WATCH }),
  rec('AppleSleepingWristTemperature', '35.2', 'degC', at(1, '01:00'), { end: at(1, '06:00'), source: WATCH }),
  rec('AppleSleepingWristTemperature', '95.9', 'degF', at(2, '01:00'), { end: at(2, '06:00'), source: WATCH }),
  rec('BodyTemperature', '36.8', 'degC', at(1, '12:00'), { source: 'Kinsa' }),
  rec('BodyTemperature', '98.6', 'degF', at(2, '12:00'), { source: 'Kinsa' }),
  rec('VO2Max', '38.5', 'mL/min·kg', at(1, '18:00'), { source: WATCH }),
  rec('AppleSleepingBreathingDisturbances', '3', 'count', at(1, '01:00'), { end: at(1, '06:00'), source: WATCH }),
  // heart rate: the median per day, with the day's minimum
  ...[['08:00', 60], ['09:00', 72], ['10:00', 80], ['11:00', 64]].map(([time, bpm]) => rec('HeartRate', bpm, 'count/min', at(1, time), {
    source: WATCH, children: '  <MetadataEntry key="HKMetadataKeyHeartRateMotionContext" value="0"/>',
  })),
  rec('HeartRate', '1.2', 'count/s', at(2, '08:00'), { source: WATCH }),
  rec('HeartRate', '66', 'count/min', at(2, '09:00'), { source: WATCH }),
  // falls: a sum per day
  rec('NumberOfTimesFallen', '1', 'count', at(1, '10:00'), { source: WATCH }),
  rec('NumberOfTimesFallen', '1', 'count', at(1, '15:00'), { source: WATCH }),
  rec('NumberOfTimesFallen', '1', 'count', at(3, '10:00'), { source: WATCH }),
].join('\n');

// What the import must leave out: unknown types, and workouts, activity rings and clinical
// records. The workout's statistics mention steps, with startDate written twice as iOS 16 does.
const SKIPPED_BODY = [
  rec('ActiveEnergyBurned', '12.5', 'Cal', at(1, '08:00'), { source: WATCH }),
  rec('ActiveEnergyBurned', '9.1', 'Cal', at(1, '09:00'), { source: WATCH }),
  rec('HKCategoryTypeIdentifierMindfulSession', 'HKCategoryValueNotApplicable', null, at(1, '20:00'), { source: WATCH }),
  ` <Workout workoutActivityType="HKWorkoutActivityTypeWalking" duration="30" durationUnit="min" sourceName="${WATCH}" sourceVersion="10.4" creationDate="${at(4, '09:00')}" startDate="${at(4, '08:30')}" endDate="${at(4, '09:00')}">
  <MetadataEntry key="HKIndoorWorkout" value="0"/>
  <WorkoutStatistics type="${HK}StepCount" startDate="${at(4, '08:30')}" startDate="${at(4, '09:00')}" sum="5000" unit="count"/>
  <WorkoutRoute sourceName="${IPHONE}" sourceVersion="17.4" creationDate="${at(4, '09:00')}" startDate="${at(4, '08:30')}" endDate="${at(4, '09:00')}">
   <FileReference path="/workout-routes/route_2024-05-04_9.00am.gpx"/>
  </WorkoutRoute>
 </Workout>`,
  ' <ActivitySummary dateComponents="2024-05-01" activeEnergyBurned="410.5" activeEnergyBurnedGoal="500" activeEnergyBurnedUnit="Cal" appleMoveTime="0" appleMoveTimeGoal="0" appleExerciseTime="31" appleExerciseTimeGoal="30" appleStandHours="11" appleStandHoursGoal="12"/>',
  ' <ActivitySummary dateComponents="2024-05-02" activeEnergyBurned="380" activeEnergyBurnedGoal="500" activeEnergyBurnedUnit="Cal" appleMoveTime="0" appleMoveTimeGoal="0" appleExerciseTime="20" appleExerciseTimeGoal="30" appleStandHours="9" appleStandHoursGoal="12"/>',
  ' <ClinicalRecord type="HKClinicalTypeIdentifierLabResultRecord" identifier="abc123" sourceName="Hospital" sourceURL="https://example.org/fhir/Observation/1" fhirVersion="4.0.1" receivedDate="2024-05-01 12:00:00 -0400" resourceFilePath="/clinical-records/abc123.json"/>',
].join('\n');

// Steps from the iPhone and the watch overlap, as in real exports.
const STEPS_BODY = [
  rec('StepCount', '1000', 'count', at(5, '08:00'), { end: at(5, '08:30'), source: IPHONE }),
  rec('StepCount', '1200', 'count', at(5, '08:05'), { end: at(5, '08:35'), source: WATCH }),
  rec('StepCount', '300', 'count', at(5, '12:00'), { end: at(5, '12:10'), source: IPHONE }),
  rec('StepCount', '600', 'count', at(5, '13:30'), { end: at(5, '14:30'), source: WATCH }),
  rec('StepCount', '500', 'count', at(5, '14:00'), { end: at(5, '14:20'), source: IPHONE }),
  rec('StepCount', '200', 'count', at(5, '23:50'), { end: at(6, '00:10'), source: WATCH }),
].join('\n');

// Two nights with overlapping sources, a short wake-up, a stretch before midnight and a nap.
const SLEEP_BODY = [
  sleep('InBed', at(10, '22:15'), at(11, '06:45'), IPHONE),
  sleep('AsleepCore', at(10, '22:30'), at(10, '23:40')),
  sleep('Awake', at(10, '23:40'), at(11, '00:20')),
  sleep('AsleepCore', at(11, '00:20'), at(11, '02:00')),
  sleep('AsleepDeep', at(11, '02:00'), at(11, '03:00')),
  sleep('AsleepREM', at(11, '03:00'), at(11, '04:00')),
  sleep('AsleepCore', at(11, '04:00'), at(11, '06:00')),
  sleep('Asleep', at(11, '00:30'), at(11, '06:30'), 'AutoSleep'), // the pre-iOS 16 value
  sleep('AsleepUnspecified', at(11, '23:00'), at(12, '07:00')),
  sleep('Asleep', at(12, '14:00'), at(12, '14:45'), 'AutoSleep'), // an afternoon nap
].join('\n');

// Blood pressure the way the Health app writes it: top-level records first, then correlations
// holding the same records again. One reading exists only at the top level, one only in a
// correlation, two fall in the same hour, and one systolic number has no partner.
const BP_TOP = [
  bpRecords(128, 82, at(6, '07:30'), 'Omron Connect'),
  bpRecords(135, 88, at(6, '19:00'), 'Health'),
  bpRecords(130, 85, at(8, '07:30'), 'Omron Connect'),
  bpRecords(126, 81, at(8, '07:35'), 'Omron Connect'),
  rec('BloodPressureSystolic', 140, 'mmHg', at(9, '08:00'), { source: 'Health' }),
].join('\n');
const BP_CORRELATIONS = [
  bpCorrelation(128, 82, at(6, '07:30'), 'Omron Connect'),
  bpCorrelation(122, 78, at(7, '07:30'), 'Omron Connect'),
  bpCorrelation(130, 85, at(8, '07:30'), 'Omron Connect'),
  bpCorrelation(126, 81, at(8, '07:35'), 'Omron Connect'),
].join('\n');

const FULL = doc([UNITS_BODY, SKIPPED_BODY, STEPS_BODY, SLEEP_BODY, BP_TOP, BP_CORRELATIONS].join('\n'));

const parse = (text, opts) => parseAppleHealthChunks([text], opts);
const ofSignal = (r, signal) => r.samples.filter((s) => s.signal === signal);
function pick(r, signal, startPrefix) {
  const found = r.samples.filter((s) => s.signal === signal && s.start.startsWith(startPrefix));
  assert.equal(found.length, 1, `expected one ${signal} sample starting ${startPrefix}, found ${found.length}`);
  return found[0];
}
const chunk = (text, size) => {
  const out = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
};

// ---------- dates ----------
test('Apple dates become ISO 8601 with their own offset', () => {
  assert.equal(appleDateToIso('2024-05-01 08:00:00 -0400'), '2024-05-01T08:00:00-04:00');
  assert.equal(appleDateToIso('2016-04-15 07:27:26 +0100'), '2016-04-15T07:27:26+01:00');
  assert.equal(appleDateToIso('2024-05-01 23:59:59 +0530'), '2024-05-01T23:59:59+05:30');
  assert.equal(appleDateToIso('2024-05-01 08:00:00 +0000'), '2024-05-01T08:00:00+00:00');
  for (const bad of ['', 'yesterday', '2024-13-01 08:00:00 -0400', '2024-05-01', '2024-05-01 25:00:00 -0400', null, 42]) {
    assert.equal(appleDateToIso(bad), null, String(bad));
  }
});

// ---------- every type and unit ----------
test('each HealthKit type from the task maps to its signal', () => {
  const want = {
    StepCount: 'steps', WalkingSpeed: 'walking_speed', WalkingStepLength: 'step_length',
    WalkingDoubleSupportPercentage: 'double_support', WalkingAsymmetryPercentage: 'walking_asymmetry',
    AppleWalkingSteadiness: 'walking_steadiness', SixMinuteWalkTestDistance: 'six_minute_walk',
    StairAscentSpeed: 'stair_ascent_speed', StairDescentSpeed: 'stair_descent_speed', NumberOfTimesFallen: 'falls',
    BodyMass: 'weight', BodyFatPercentage: 'body_fat', LeanBodyMass: 'lean_mass', HeartRate: 'heart_rate',
    RestingHeartRate: 'resting_hr', HeartRateVariabilitySDNN: 'hrv_sdnn', OxygenSaturation: 'spo2',
    RespiratoryRate: 'respiratory_rate', BloodPressureSystolic: 'bp', BloodPressureDiastolic: 'bp',
    AppleSleepingWristTemperature: 'wrist_temp', VO2Max: 'vo2max', AppleSleepingBreathingDisturbances: 'breathing_disturbances',
  };
  for (const [type, signal] of Object.entries(want)) assert.equal(APPLE_HEALTH_TYPES[`${HK}${type}`]?.signal, signal, type);
  assert.equal(APPLE_HEALTH_TYPES.HKCategoryTypeIdentifierSleepAnalysis.signal, 'sleep_minutes');
});

test('metric and US units convert to the shared units', async () => {
  const r = await parse(doc(UNITS_BODY));
  assert.equal(r.ok, true);
  const v = (signal, start) => pick(r, signal, start).value;
  near(v('walking_speed', '2024-05-01T08'), 0.88); // 3.168 km/hr x 1000 m / 3600 s = 0.88 m/s
  near(v('walking_speed', '2024-05-01T09'), 1.1176); // 2.5 mi/hr x 1609.344 m / 3600 s = 1.1176 m/s
  near(v('walking_speed', '2024-05-01T10'), 1.25); // already m/s
  near(v('step_length', '2024-05-01T08'), 0.6); // 60 cm / 100
  near(v('step_length', '2024-05-01T09'), 0.635); // 25 in x 0.0254 m
  near(v('double_support', '2024-05-01T08'), 27); // Apple's fraction 0.27 x 100
  near(v('walking_asymmetry', '2024-05-01T08'), 8); // 0.08 x 100
  near(v('walking_steadiness', '2024-05-01T08'), 95); // 0.95 x 100
  near(v('six_minute_walk', '2024-05-01T08'), 450);
  near(v('six_minute_walk', '2024-05-08T08'), 449.8848); // 1476 ft x 0.3048 m
  near(v('stair_ascent_speed', '2024-05-01T08'), 0.5);
  near(v('stair_ascent_speed', '2024-05-01T09'), 0.4572); // 1.5 ft/s x 0.3048
  near(v('stair_descent_speed', '2024-05-01T08'), 0.6);
  near(v('stair_descent_speed', '2024-05-01T09'), 0.6096); // 2 ft/s x 0.3048
  near(v('weight', '2024-05-01T07'), 80);
  near(v('weight', '2024-05-02T07'), 74.84274105); // 165 lb x 0.45359237 kg
  near(v('body_fat', '2024-05-01T07'), 21.5); // 0.215 x 100
  near(v('lean_mass', '2024-05-01T07'), 60);
  near(v('lean_mass', '2024-05-02T07'), 59.87419284); // 132 lb x 0.45359237 kg
  near(v('resting_hr', '2024-05-01T00'), 58);
  near(v('hrv_sdnn', '2024-05-01T23'), 45.5); // its beat-by-beat children are ignored
  near(v('spo2', '2024-05-01T03'), 97); // 0.97 x 100
  near(v('respiratory_rate', '2024-05-01T03'), 15.5);
  near(v('wrist_temp', '2024-05-01T01'), 35.2);
  near(v('wrist_temp', '2024-05-02T01'), 35.5); // (95.9 - 32) x 5/9 = 63.9 x 5/9 = 35.5
  near(v('temperature', '2024-05-01T12'), 36.8);
  near(v('temperature', '2024-05-02T12'), 37); // (98.6 - 32) x 5/9 = 66.6 x 5/9 = 37
  near(v('vo2max', '2024-05-01T18'), 38.5); // Apple's "mL/min·kg" is mL/kg/min
  const bd = pick(r, 'breathing_disturbances', '2024-05-01T01');
  assert.equal(bd.value, 3); // as the source reports it
  assert.equal(bd.unit, 'count');

  const units = {
    walking_speed: 'm/s', step_length: 'm', double_support: '%', walking_asymmetry: '%', walking_steadiness: '%',
    six_minute_walk: 'm', stair_ascent_speed: 'm/s', stair_descent_speed: 'm/s', weight: 'kg', body_fat: '%',
    lean_mass: 'kg', resting_hr: 'bpm', hrv_sdnn: 'ms', spo2: '%', respiratory_rate: 'breaths/min', wrist_temp: 'degC',
    temperature: 'degC', vo2max: 'mL/kg/min', heart_rate: 'bpm', falls: 'count', breathing_disturbances: 'count',
  };
  for (const s of r.samples) {
    assert.equal(s.unit, units[s.signal], `${s.signal} unit`);
    assert.equal(s.source, 'apple-health');
  }
  // One sample per record here: no two records of a signal share an hour.
  assert.deepEqual(r.counts, {
    walking_speed: 3, step_length: 2, double_support: 1, walking_asymmetry: 1, walking_steadiness: 1,
    six_minute_walk: 2, stair_ascent_speed: 2, stair_descent_speed: 2, weight: 2, body_fat: 1, lean_mass: 2,
    resting_hr: 1, hrv_sdnn: 1, spo2: 1, respiratory_rate: 1, wrist_temp: 2, temperature: 2, vo2max: 1,
    breathing_disturbances: 1, heart_rate: 6, falls: 3,
  });
  assert.equal(r.samples.length, 38 - 6 - 3 + 2 + 2); // 38 records; heart rate and falls become 2 days each
  assert.deepEqual(r.warnings, []);
});

test('each record keeps its own start, end and source', async () => {
  const r = await parse(doc(UNITS_BODY));
  const s = pick(r, 'walking_speed', '2024-05-01T08');
  assert.equal(s.start, '2024-05-01T08:00:00-04:00');
  assert.equal(s.end, '2024-05-01T08:00:18-04:00');
  assert.deepEqual(s.detail.sources, [IPHONE]); // the entity-free curly apostrophe survives
  assert.equal(s.detail.n, 1);
  assert.equal(r.exportDate, '2024-05-31T09:15:00-04:00');
});

test('source names: entities decoded, quotes and > inside values handled', async () => {
  const r = await parse(doc([
    rec('BodyMass', '80', 'kg', at(1, '07:00'), { source: 'Withings &amp; Co' }),
    rec('BodyMass', '81', 'kg', at(2, '07:00'), { source: 'Ahmed&#8217;s scale &#x2014; hall' }),
    // Legal XML that Apple does not write: a raw '>' inside a value, and single quotes.
    ' <Record type="HKQuantityTypeIdentifierBodyMass" sourceName="Scale > 2" unit="kg" startDate="2024-05-03 07:00:00 -0400" endDate="2024-05-03 07:00:00 -0400" value="82"/>',
    " <Record type='HKQuantityTypeIdentifierBodyMass' sourceName='Bob \"the\" scale' unit='kg' startDate='2024-05-04 07:00:00 -0400' endDate='2024-05-04 07:00:00 -0400' value='83'/>",
  ].join('\n')));
  assert.deepEqual(r.samples.map((x) => [x.value, x.detail.sources[0]]), [
    [80, 'Withings & Co'], [81, 'Ahmed’s scale — hall'], [82, 'Scale > 2'], [83, 'Bob "the" scale'],
  ]);
});

test('every supported unit spelling, worked out by hand', async () => {
  const cases = [
    // [type, value, unit, expected]
    ['SixMinuteWalkTestDistance', '45000', 'cm', 450],
    ['SixMinuteWalkTestDistance', '450000', 'mm', 450],
    ['SixMinuteWalkTestDistance', '0.45', 'km', 450],
    ['SixMinuteWalkTestDistance', '1000', 'in', 25.4], // 1000 x 0.0254
    ['SixMinuteWalkTestDistance', '500', 'yd', 457.2], // 500 x 0.9144
    ['SixMinuteWalkTestDistance', '0.3', 'mi', 482.8032], // 0.3 x 1609.344
    ['BodyMass', '80000', 'g', 80],
    ['BodyMass', '176', 'lb', 79.83225712], // 176 x 0.45359237
    ['BodyMass', '32', 'oz', 0.90718474], // 32 x 0.028349523125
    ['BodyMass', '12', 'st', 76.20351816], // 12 x 6.35029318
    ['RestingHeartRate', '1', 'count/s', 60],
    ['RestingHeartRate', '3600', 'count/hr', 60],
    ['HeartRateVariabilitySDNN', '0.045', 's', 45],
    ['BodyTemperature', '308.65', 'K', 35.5], // 308.65 - 273.15
    ['VO2Max', '40', 'ml/(kg*min)', 40],
    ['VO2Max', '40', 'mL/kg/min', 40],
    ['VO2Max', '40', 'ml/kg·min', 40],
    ['OxygenSaturation', '1', '%', 100], // a fraction of 1 is 100%
    ['WalkingAsymmetryPercentage', '0', '%', 0],
  ];
  for (const [type, value, unit, expected] of cases) {
    const r = await parse(doc(rec(type, value, unit, at(1, '08:00'))));
    assert.equal(r.samples.length, 1, `${type} ${unit}`);
    near(r.samples[0].value, expected);
  }
  // Blood pressure in kPa: 1 mmHg = 133.322387415 Pa, so 16 kPa = 16000 / 133.322387415 = 120.009852 mmHg
  // and 10.5 kPa = 10500 / 133.322387415 = 78.756465 mmHg.
  const r = await parse(doc(bpRecords('16', '10.5', at(1, '08:00'), 'Cuff').replaceAll('mmHg', 'kPa')));
  near(r.samples[0].value, 120.009852);
  near(r.samples[0].value2, 78.756465);
});

test('percentages already written as 0 to 100 are kept, impossible ones are dropped', async () => {
  const r = await parse(doc([
    rec('OxygenSaturation', '97', '%', at(1, '01:00'), { source: 'Some oximeter app' }),
    rec('OxygenSaturation', '150', '%', at(1, '02:00')),
    rec('OxygenSaturation', '-0.1', '%', at(1, '03:00')),
  ].join('\n')));
  assert.equal(r.samples.length, 1);
  near(r.samples[0].value, 97);
  assert.ok(r.warnings.some((w) => /0 to 100/.test(w)), r.warnings.join(' | '));
  assert.ok(r.warnings.some((w) => /2 records had no usable number/.test(w)), r.warnings.join(' | '));
});

// ---------- daily values ----------
test('heart rate is one value per day: the median, with the minimum in detail', async () => {
  const r = await parse(doc(UNITS_BODY));
  const d1 = pick(r, 'heart_rate', '2024-05-01');
  assert.equal(d1.start, '2024-05-01');
  near(d1.value, 68); // 60, 64, 72, 80: median (64 + 72) / 2 = 68
  assert.equal(d1.detail.min, 60);
  assert.equal(d1.detail.n, 4);
  const d2 = pick(r, 'heart_rate', '2024-05-02');
  near(d2.value, 69); // 1.2 per second = 72 bpm, and 66: median 69
  assert.equal(d2.detail.min, 66);
});

test('a day is the calendar day of the record, not shifted by time zone', async () => {
  // 23:30 at -0400 is 03:30 the next day in UTC; it still belongs to 1 May.
  const r = await parse(doc([
    rec('HeartRate', '70', 'count/min', at(1, '23:30')),
    rec('HeartRate', '90', 'count/min', '2024-05-02 00:30:00 +0900'),
  ].join('\n')));
  assert.deepEqual(ofSignal(r, 'heart_rate').map((s) => [s.start, s.value]), [['2024-05-01', 70], ['2024-05-02', 90]]);
});

test('falls add up per day', async () => {
  const r = await parse(doc(UNITS_BODY));
  assert.deepEqual(ofSignal(r, 'falls').map((s) => [s.start, s.value]), [['2024-05-01', 2], ['2024-05-03', 1]]);
});

test('steps add up per day without counting the iPhone and the watch twice', async () => {
  const r = await parse(doc(STEPS_BODY));
  // Each hour keeps the source with more steps; a record over several hours is shared by time.
  //  8:00-9:00   iPhone 1000, watch 1200 (the same walk)          -> 1200
  // 12:00-13:00  iPhone 300                                       -> 300
  // 13:00-14:00  watch 600 over 13:30-14:30, half in this hour     -> 300
  // 14:00-15:00  watch's other half 300, iPhone 500                -> 500
  // 23:00-24:00  watch 200 over 23:50-00:10, half before midnight  -> 100
  // 5 May: 1200 + 300 + 300 + 500 + 100 = 2400. 6 May: the other 100.
  // (Adding every record would give 3800 for 5 May.)
  assert.deepEqual(ofSignal(r, 'steps').map((s) => [s.start, s.value, s.unit]), [['2024-05-05', 2400, 'steps'], ['2024-05-06', 100, 'steps']]);
  assert.deepEqual(pick(r, 'steps', '2024-05-05').detail.sources, [WATCH, IPHONE].sort());
  assert.equal(r.counts.steps, 6);
});

test('since by date keeps the part of a walk that crosses midnight into that date', async () => {
  // The watch's 200 steps over 23:50-00:10 are shared 100 before and 100 after midnight (see
  // above). Since 6 May: 6 May keeps its 100, and nothing from 5 May comes in.
  const r = await parse(doc(STEPS_BODY), { since: '2024-05-06' });
  assert.deepEqual(ofSignal(r, 'steps').map((s) => [s.start, s.value]), [['2024-05-06', 100]]);
  // Since 5 May changes nothing: 2400 and 100, as without since.
  const all = await parse(doc(STEPS_BODY), { since: '2024-05-05' });
  assert.deepEqual(ofSignal(all, 'steps').map((s) => [s.start, s.value]), [['2024-05-05', 2400], ['2024-05-06', 100]]);
});

test('times written without an offset give the same days on any device', async () => {
  // Apple always writes an offset; a time without one is read as the clock time written.
  // 120 steps over 23:30-00:30 are 60 before midnight and 60 after; asleep 23:00-07:00 is
  // 480 minutes, also on a device whose clock changes that night (10 March 2024 in New York).
  const body = [
    rec('StepCount', '120', 'count', '2024-05-05 23:30:00', { end: '2024-05-06 00:30:00' }),
    sleep('Asleep', '2024-03-09 23:00:00', '2024-03-10 07:00:00'),
  ].join('\n');
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const had = 'TZ' in process.env;
  const saved = process.env.TZ;
  try {
    for (const tz of ['UTC', 'Asia/Tokyo', 'America/New_York']) {
      process.env.TZ = tz; // Node applies a new TZ at once
      const r = await parse(doc(body));
      assert.deepEqual(r.samples.map((s) => [s.signal, s.start, s.value]), [
        ['sleep_minutes', '2024-03-10', 480], ['steps', '2024-05-05', 60], ['steps', '2024-05-06', 60],
      ], tz);
    }
  } finally {
    process.env.TZ = had ? saved : zone;
    if (!had) delete process.env.TZ;
  }
});

test('readings in the same hour become one sample, the mean', async () => {
  const r = await parse(doc([
    rec('WalkingSpeed', '1.0', 'm/s', at(4, '08:05'), { end: at(4, '08:05:20') }),
    rec('WalkingSpeed', '1.2', 'm/s', at(4, '08:40'), { end: at(4, '08:40:20'), source: WATCH }),
    rec('WalkingSpeed', '1.4', 'm/s', at(4, '09:10')),
  ].join('\n')));
  const [first, second] = ofSignal(r, 'walking_speed');
  near(first.value, 1.1); // (1.0 + 1.2) / 2
  assert.equal(first.start, '2024-05-04T08:05:00-04:00');
  assert.equal(first.end, '2024-05-04T08:40:20-04:00');
  assert.equal(first.detail.n, 2);
  assert.deepEqual(first.detail.sources, [WATCH, IPHONE].sort());
  near(second.value, 1.4);
  assert.equal(ofSignal(r, 'walking_speed').length, 2);
  assert.equal(r.counts.walking_speed, 3);
});

// ---------- blood pressure ----------
test('blood pressure: one sample per reading, never counted twice', async () => {
  const r = await parse(doc(`${BP_TOP}\n${BP_CORRELATIONS}`));
  const bp = ofSignal(r, 'bp');
  assert.deepEqual(bp.map((s) => [s.start, s.value, s.value2, s.detail.n]), [
    ['2024-05-06T07:30:00-04:00', 128, 82, 1], // in a correlation and again at the top level
    ['2024-05-06T19:00:00-04:00', 135, 88, 1], // top level only, paired by time and source
    ['2024-05-07T07:30:00-04:00', 122, 78, 1], // correlation only
    ['2024-05-08T07:30:00-04:00', 128, 83, 2], // 7:30 and 7:35 in one hour: (130+126)/2, (85+81)/2
  ]);
  assert.ok(bp.every((s) => s.unit === 'mmHg'));
  assert.equal(pick(r, 'bp', '2024-05-08').end, '2024-05-08T07:35:00-04:00');
  assert.equal(r.counts.bp, 5); // five readings, not nine records
  assert.ok(r.warnings.some((w) => /1 blood pressure number had no matching/.test(w)), r.warnings.join(' | '));
});

test('blood pressure pairing does not depend on the order of the file', async () => {
  const a = await parse(doc(`${BP_TOP}\n${BP_CORRELATIONS}`));
  const b = await parse(doc(`${BP_CORRELATIONS}\n${BP_TOP}`));
  assert.deepEqual(ofSignal(b, 'bp'), ofSignal(a, 'bp'));
});

test('other correlations are skipped once, not once per copy', async () => {
  const food = ` <Correlation type="HKCorrelationTypeIdentifierFood" sourceName="MyFitnessPal" startDate="${at(1, '12:00')}" endDate="${at(1, '12:00')}">
  ${rec('DietaryEnergyConsumed', '640', 'Cal', at(1, '12:00'), { source: 'MyFitnessPal' })}
 </Correlation>`;
  const r = await parse(doc(`${rec('DietaryEnergyConsumed', '640', 'Cal', at(1, '12:00'), { source: 'MyFitnessPal' })}\n${food}`));
  assert.deepEqual(r.skipped, { [`${HK}DietaryEnergyConsumed`]: 1, HKCorrelationTypeIdentifierFood: 1 });
  assert.equal(r.samples.length, 0);
});

// ---------- sleep ----------
test('sleep: minutes asleep per night, overlapping sources counted once', async () => {
  const r = await parse(doc(SLEEP_BODY));
  // Night 1. Watch asleep 22:30-23:40 (70 min), awake, then 00:20-06:00 in stages (340 min).
  // AutoSleep says asleep 00:30-06:30. Together: 22:30-23:40 and 00:20-06:30 = 70 + 370 = 440 min.
  // The 40-minute wake-up does not split the night, so it all belongs to 11 May, the day it ends.
  // In bed and awake are not sleep. (Adding every asleep record would give 410 + 360 = 770.)
  // Night 2. 23:00-07:00 = 480 min, and a 45-minute nap the same afternoon: 525 min on 12 May.
  const nights = ofSignal(r, 'sleep_minutes');
  assert.deepEqual(nights.map((s) => [s.start, s.value, s.unit]), [['2024-05-11', 440, 'min'], ['2024-05-12', 525, 'min']]);
  assert.equal(nights[0].detail.from, '2024-05-10T22:30:00-04:00');
  assert.equal(nights[0].detail.to, '2024-05-11T06:30:00-04:00');
  assert.deepEqual(nights[0].detail.sources, ['AutoSleep', WATCH].sort());
  assert.equal(nights[1].detail.sessions, 2);
  assert.equal(r.counts.sleep_minutes, 8); // asleep records used: 6 the first night, 2 the second
});

test('since keeps whole nights that end on or after it', async () => {
  const r = await parse(doc(SLEEP_BODY), { since: '2024-05-12' });
  assert.deepEqual(ofSignal(r, 'sleep_minutes').map((s) => [s.start, s.value]), [['2024-05-12', 525]]);
});

// ---------- filters ----------
test('since skips earlier records, by calendar date or by exact time', async () => {
  const byDate = await parse(doc(UNITS_BODY), { since: '2024-05-02' });
  assert.ok(byDate.samples.length > 0);
  assert.ok(byDate.samples.every((s) => s.start.slice(0, 10) >= '2024-05-02'), 'nothing from 1 May');
  assert.deepEqual(ofSignal(byDate, 'falls').map((s) => s.start), ['2024-05-03']);

  const byTime = await parse(doc(UNITS_BODY), { since: '2024-05-01T10:30:00-04:00' });
  const hr = pick(byTime, 'heart_rate', '2024-05-01');
  assert.equal(hr.detail.n, 1); // only the 11:00 reading (64) is after 10:30
  assert.equal(hr.value, 64);

  // The same moment as a Date and as milliseconds.
  for (const since of [new Date('2024-05-01T10:30:00-04:00'), Date.parse('2024-05-01T10:30:00-04:00')]) {
    assert.equal(pick(await parse(doc(UNITS_BODY), { since }), 'heart_rate', '2024-05-01').detail.n, 1);
  }

  const bad = await parse(doc(UNITS_BODY), { since: 'last spring' });
  assert.ok(bad.warnings.some((w) => /was not understood/.test(w)));
  assert.equal(bad.samples.length, (await parse(doc(UNITS_BODY))).samples.length);
});

test('signals keeps only the signals asked for', async () => {
  const r = await parse(FULL, { signals: ['weight', 'bp'] });
  assert.deepEqual([...new Set(r.samples.map((s) => s.signal))].sort(), ['bp', 'weight']);
  assert.equal(r.skipped.Workout, 1); // unknown things are still reported
  const one = await parse(FULL, { signals: 'weight' }); // a single id works too
  assert.deepEqual([...new Set(one.samples.map((s) => s.signal))], ['weight']);
  const all = await parse(FULL, null); // no options at all
  assert.equal(all.samples.length, (await parse(FULL)).samples.length);
});

test('unknown types, workouts, activity rings and clinical records are counted in skipped', async () => {
  const r = await parse(doc(`${SKIPPED_BODY}\n${STEPS_BODY}`));
  assert.deepEqual(r.skipped, {
    [`${HK}ActiveEnergyBurned`]: 2, HKCategoryTypeIdentifierMindfulSession: 1, Workout: 1, ActivitySummary: 2, ClinicalRecord: 1,
  });
  // The workout's step statistics (5000) are not steps: 4 May has no step sample.
  assert.deepEqual(ofSignal(r, 'steps').map((s) => s.start), ['2024-05-05', '2024-05-06']);
});

test('records nested in skipped elements or in correlations are never read twice', async () => {
  const hr = (value) => rec('HeartRate', value, 'count/min', at(1, '08:00'), { source: WATCH });
  const weight = rec('BodyMass', '80', 'kg', at(1, '07:00'), { source: 'Withings' });
  const r = await parse(doc([
    hr(70),
    weight,
    ` <Workout workoutActivityType="HKWorkoutActivityTypeWalking" sourceName="${WATCH}" startDate="${at(1, '09:00')}" endDate="${at(1, '09:30')}">\n ${hr(150)}\n </Workout>`,
    ` <Correlation type="HKCorrelationTypeIdentifierBloodPressure" sourceName="${WATCH}" startDate="${at(1, '08:00')}" endDate="${at(1, '08:00')}">\n ${hr(70)}\n </Correlation>`,
    ` <Correlation type="HKCorrelationTypeIdentifierFood" sourceName="Withings" startDate="${at(1, '07:00')}" endDate="${at(1, '07:00')}">\n ${weight}\n </Correlation>`,
  ].join('\n')));
  const day = pick(r, 'heart_rate', '2024-05-01');
  assert.deepEqual([day.value, day.detail.n], [70, 1]);
  assert.equal(pick(r, 'weight', '2024-05-01').detail.n, 1);
  assert.deepEqual(r.counts, { heart_rate: 1, weight: 1 });
});

test('comments and CDATA are skipped even when they hold record-like text', async () => {
  const hidden = rec('HeartRate', '200', 'count/min', at(1, '09:00'));
  const r = await parse(doc([
    rec('HeartRate', '70', 'count/min', at(1, '08:00')),
    ` <!-- an old reading, value > 0: ${hidden} -->`,
    ` <![CDATA[ if x > 0 then ${hidden} ]]>`,
  ].join('\n')));
  assert.deepEqual(ofSignal(r, 'heart_rate').map((x) => [x.value, x.detail.n]), [[70, 1]]);
});

test('a broken DTD like export version 12 (an ATTLIST without its >) still imports', async () => {
  const good = doc(UNITS_BODY);
  const broken = good.replace('<!ATTLIST ExportDate\n  value CDATA #REQUIRED\n>', '<!ATTLIST ExportDate\n  value CDATA #REQUIRED\n');
  assert.notEqual(broken, good);
  assert.deepEqual(await parse(broken), await parse(good));
});

test('a file cut off between two records still warns', async () => {
  const text = doc(UNITS_BODY);
  const r = await parse(text.slice(0, text.lastIndexOf('</HealthData>')));
  assert.ok(r.warnings.some((w) => /cut short/.test(w)), r.warnings.join(' | '));
  assert.deepEqual(r.samples, (await parse(text)).samples);
});

// ---------- the parser itself ----------
test('7-character pieces give exactly the same result as the whole text', async () => {
  const whole = await parse(FULL);
  const pieces = await parseAppleHealthChunks(chunk(FULL, 7));
  assert.deepEqual(pieces, whole);
  const ones = await parseAppleHealthChunks(chunk(FULL, 1));
  assert.deepEqual(ones, whole);
  assert.ok(whole.samples.length > 40);
});

test('an async iterable and Uint8Array pieces work too', async () => {
  const whole = await parse(FULL);
  async function* slowly() {
    for (const piece of chunk(FULL, 4096)) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      yield piece;
    }
  }
  assert.deepEqual(await parseAppleHealthChunks(slowly()), whole);
  const bytes = enc.encode(FULL);
  const byteChunks = [];
  for (let i = 0; i < bytes.length; i += 7) byteChunks.push(bytes.subarray(i, i + 7));
  assert.deepEqual(await parseAppleHealthChunks(byteChunks), whole);
  // Other kinds of bytes: each piece as its own ArrayBuffer, and as a DataView.
  assert.deepEqual(await parseAppleHealthChunks(byteChunks.map((b) => b.slice().buffer)), whole);
  assert.deepEqual(await parseAppleHealthChunks(byteChunks.map((b) => new DataView(b.buffer, b.byteOffset, b.byteLength))), whole);
});

test('a big file that is not an export is refused after its first few megabytes', async () => {
  // 16 MB of another XML file in 64 KB pieces. An export's <HealthData> comes within its first
  // few kilobytes, so the import stops reading after about 4 MB instead of reading it all.
  const piece = '<trkpt lat="45.4215" lon="-75.6972"><ele>70</ele></trkpt>'.repeat(1150); // 65,550 characters
  let given = 0;
  async function* gpx() {
    yield '<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1"><trk><trkseg>';
    for (let i = 0; i < 256; i++) {
      given++;
      yield piece;
    }
    yield '</trkseg></trk></gpx>';
  }
  const r = await parseAppleHealthChunks(gpx());
  assert.equal(r.ok, false);
  assert.match(r.reason, /not an Apple Health export/);
  assert.ok(given <= 66, `read ${given} of 256 pieces`); // 4 MB / 65,550 = 63.99, so piece 64 passes it
});

test('odd options give a reason, never an error', async () => {
  const odd = [
    { since: Symbol('not a date') },
    { get signals() { throw new Error('a broken option'); } },
    { signals: { [Symbol.iterator]() { throw new Error('a broken list'); } } },
    { get abortSignal() { throw new Error('a broken signal'); } },
  ];
  for (const opts of odd) {
    for (const run of [() => parseAppleHealthChunks([FULL], opts), () => importAppleHealth(new Blob([FULL]), opts)]) {
      const r = await run(); // a throw here fails the test
      assert.equal(r.ok, false);
      assert.ok(typeof r.reason === 'string' && r.reason.length > 10, r.reason);
    }
  }
});

test('names that are also built-in JavaScript names are only unknown names', async () => {
  // A damaged file could say anything. "constructor" and "toString" are properties of every
  // JavaScript object; they must not be taken for a type this import knows, or for a unit.
  const odd = (type) => ` <Record type="${type}" sourceName="x" unit="kg" startDate="${at(1, '07:00')}" endDate="${at(1, '07:00')}" value="80"/>`;
  const r = await parse(doc([
    odd('constructor'), odd('toString'), odd('__proto__'),
    rec('BodyMass', '80', 'constructor', at(1, '07:00')),
    rec('BodyMass', '81', 'kg', at(2, '07:00')),
  ].join('\n')));
  assert.equal(r.ok, true);
  assert.deepEqual(r.samples.map((s) => [s.signal, s.value]), [['weight', 81]]);
  assert.equal(r.skipped.constructor, 1);
  assert.equal(r.skipped.toString, 1);
  assert.match(r.warnings.join(' | '), /1 body mass record used a unit this app does not know \(constructor\)/);
});

test('malformed rows are left out with a reason, the rest still imports', async () => {
  const r = await parse(doc([
    rec('BodyMass', '', 'kg', at(1, '07:00')),
    rec('BodyMass', 'heavy', 'kg', at(1, '08:00')),
    rec('BodyMass', 'NaN', 'kg', at(1, '09:00')),
    rec('BodyMass', null, 'kg', at(1, '10:00')),
    rec('BodyMass', '81', 'kg', 'yesterday morning'),
    rec('WalkingSpeed', '80', 'ft/min', at(1, '11:00')),
    rec('BodyMass', '82', 'kg', at(1, '12:00')), // the one good row
    ' <Record type="HKQuantityTypeIdentifierBodyMass" unit="kg" value="83"/>', // no dates at all
    ' <Record sourceName="x" value="1"/>', // no type
  ].join('\n')));
  assert.equal(r.ok, true);
  assert.deepEqual(r.samples.map((s) => [s.signal, s.value]), [['weight', 82]]);
  const all = r.warnings.join(' | ');
  assert.match(all, /4 records had no usable number/); // empty, words, NaN, missing
  assert.match(all, /2 records had a date this app could not read/);
  assert.match(all, /1 walking speed record used a unit this app does not know \(ft\/min\)/);
  assert.equal(r.skipped.Record, 1);
});

test('something left open for over a megabyte is skipped with a warning, and reading goes on', async () => {
  const filler = `${'x'.repeat(1023)}\n`.repeat(1100); // 1.1 MB of text and no closing "-->"
  const text = doc([
    rec('BodyMass', '80', 'kg', at(1, '07:00')),
    ` <!-- never closed ${filler}`,
    rec('BodyMass', '81', 'kg', at(2, '07:00')),
  ].join('\n'));
  for (const r of [await parse(text), await parseAppleHealthChunks(chunk(text, 65536))]) {
    assert.deepEqual(ofSignal(r, 'weight').map((s) => s.value), [80, 81]);
    assert.ok(r.warnings.some((w) => /1 damaged part of the file could not be read/.test(w)), r.warnings.join(' | '));
  }
});

test('one record is enough', async () => {
  const r = await parse(doc(rec('HeartRate', '61', 'count/min', at(3, '06:00'))));
  assert.deepEqual(r.samples.map((s) => [s.signal, s.start, s.value, s.detail.min, s.detail.n]), [['heart_rate', '2024-05-03', 61, 61, 1]]);
});

test('an export with no usable records says so', async () => {
  const r = await parse(doc(SKIPPED_BODY));
  assert.equal(r.ok, true);
  assert.deepEqual(r.samples, []);
  assert.ok(r.warnings.some((w) => /No readings/.test(w)));
});

test('a file cut off in the middle keeps what came before and warns', async () => {
  const text = doc(UNITS_BODY);
  const cut = text.slice(0, text.indexOf('NumberOfTimesFallen') + 10);
  const r = await parse(cut);
  assert.equal(r.ok, true);
  assert.ok(r.warnings.some((w) => /cut short/.test(w)), r.warnings.join(' | '));
  near(pick(r, 'weight', '2024-05-02T07').value, 74.84274105);
  assert.equal(ofSignal(r, 'falls').length, 0);
});

test('anything that is not an Apple Health export is refused in plain words', async () => {
  for (const input of [[], [''], ['<?xml version="1.0"?><ClinicalDocument xmlns="urn:hl7-org:v3"></ClinicalDocument>'], ['just some text'], null]) {
    const r = await parseAppleHealthChunks(input);
    assert.equal(r.ok, false);
    assert.match(r.reason, /not an Apple Health export/);
  }
  assert.deepEqual(await importAppleHealth(new Blob([])), { ok: false, reason: 'This file is empty.' });
  assert.equal((await importAppleHealth(null)).ok, false);
  const notZip = await importAppleHealth(new Blob(['%PDF-1.7 not a health export']));
  assert.equal(notZip.ok, false);
});

// ---------- files ----------
// A Blob look-alike that hands out the bytes 7 at a time, so characters such as the
// curly apostrophe (3 bytes in UTF-8) are split between chunks.
function sevenByteFile(text) {
  const bytes = enc.encode(text);
  const file = {
    size: bytes.length,
    slice: (a = 0, b = bytes.length) => new Blob([bytes.subarray(a, b)]),
    stream: () => {
      let i = 0;
      return new ReadableStream({
        pull(c) {
          if (i >= bytes.length) c.close();
          else c.enqueue(bytes.slice(i, (i += 7)));
        },
      });
    },
  };
  return { file, bytes };
}

test('an export.xml file read 7 bytes at a time, split inside multi-byte characters', async () => {
  const { file, bytes } = sevenByteFile(FULL);
  // Make sure at least one curly apostrophe really straddles a chunk boundary.
  const apos = enc.encode('’');
  let straddles = 0;
  for (let i = 0; i + 2 < bytes.length; i++) {
    if (bytes[i] === apos[0] && bytes[i + 1] === apos[1] && bytes[i + 2] === apos[2] && i % 7 >= 5) straddles++;
  }
  assert.ok(straddles > 0, 'the fixture must split a multi-byte character');
  const fractions = [];
  const r = await importAppleHealth(file, { onProgress: (f) => fractions.push(f) });
  assert.deepEqual(r, await parse(FULL));
  assert.ok(fractions.length > 10);
  assert.ok(fractions.every((f, i) => f > 0 && f <= 1 && (i === 0 || f > fractions[i - 1])), 'progress only goes up');
  assert.equal(fractions.at(-1), 1);
  assert.ok(fractions.length <= 1001, 'progress is not reported for every chunk');
});

test('a plain Blob of export.xml imports, also without TextDecoderStream', async () => {
  const blob = new Blob([FULL], { type: 'text/xml' });
  const expected = await parse(FULL);
  assert.deepEqual(await importAppleHealth(blob), expected);
  const saved = globalThis.TextDecoderStream;
  try {
    delete globalThis.TextDecoderStream; // as in Firefox before version 105
    assert.equal(typeof TextDecoderStream, 'undefined');
    assert.deepEqual(await importAppleHealth(blob), expected);
  } finally {
    globalThis.TextDecoderStream = saved;
  }
});

test('without TransformStream the import still runs, only without progress', async () => {
  const saved = globalThis.TransformStream;
  const expected = await parse(FULL);
  try {
    delete globalThis.TransformStream; // as in Safari before 14.1 and Firefox before 102
    assert.equal(typeof TransformStream, 'undefined');
    const told = [];
    assert.deepEqual(await importAppleHealth(new Blob([FULL]), { onProgress: (f) => told.push(f) }), expected);
    assert.deepEqual(told, []);
  } finally {
    globalThis.TransformStream = saved;
  }
});

test('the import can be stopped', async () => {
  const before = new AbortController();
  before.abort();
  assert.deepEqual(await importAppleHealth(new Blob([FULL]), { abortSignal: before.signal }), { ok: false, aborted: true, reason: 'The import was stopped.' });

  const during = new AbortController();
  const { file } = sevenByteFile(FULL);
  let furthest = 0;
  const r = await importAppleHealth(file, {
    abortSignal: during.signal,
    onProgress: (f) => {
      furthest = Math.max(furthest, f);
      if (f > 0.3) during.abort();
    },
  });
  assert.equal(r.ok, false);
  assert.equal(r.aborted, true);
  assert.ok(furthest < 0.5, `kept reading to ${furthest} after the stop`);
});

// ---------- zip files, built by hand ----------
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
const deflateRaw = async (bytes) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
const le = (n, size) => Array.from({ length: size }, (_, i) => Number((BigInt(n) >> BigInt(8 * i)) & 0xffn));
const bytesOf = async (stream) => new Uint8Array(await new Response(stream).arrayBuffer());
// An "extended timestamp" (0x5455) plus a Unix uid/gid field (0x7875), as Info-ZIP writes in local
// headers, while its central directory copy holds only a short timestamp.
const LOCAL_EXTRA = Uint8Array.from([...le(0x5455, 2), ...le(5, 2), 1, ...le(1714560000, 4), ...le(0x7875, 2), ...le(11, 2), 1, 4, ...le(501, 4), 4, ...le(20, 4)]);
const CENTRAL_EXTRA = Uint8Array.from([...le(0x5455, 2), ...le(5, 2), 1, ...le(1714560000, 4)]);

// files: [{ name, data, method = 8, flags = 0, localExtra, centralExtra }]
async function makeZip(files, { comment = '', zip64 = false, disk = 0 } = {}) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const name = typeof f.name === 'string' ? enc.encode(f.name) : f.name; // or raw bytes
    const data = typeof f.data === 'string' ? enc.encode(f.data) : (f.data ?? new Uint8Array());
    const method = f.method ?? 8;
    const body = method === 8 ? await deflateRaw(data) : data;
    const flags = (f.flags ?? 0) | (f.utf8 === false ? 0 : 0x800); // the "names are UTF-8" flag
    const crc = crc32(data);
    let localExtra = f.localExtra ?? new Uint8Array();
    if (zip64) localExtra = Uint8Array.from([...le(1, 2), ...le(16, 2), ...le(data.length, 8), ...le(body.length, 8), ...localExtra]);
    const local = Uint8Array.from([
      ...le(0x04034b50, 4), ...le(zip64 ? 45 : 20, 2), ...le(flags, 2), ...le(method, 2), ...le(0x6000, 2), ...le(0x58a1, 2),
      ...le(crc, 4), ...le(zip64 ? 0xffffffff : body.length, 4), ...le(zip64 ? 0xffffffff : data.length, 4),
      ...le(name.length, 2), ...le(localExtra.length, 2),
    ]);
    parts.push(local, name, localExtra, body);
    central.push({ name, crc, method, flags, csize: body.length, size: data.length, offset, extra: f.centralExtra ?? new Uint8Array() });
    offset += local.length + name.length + localExtra.length + body.length;
  }
  const cdStart = offset;
  for (const c of central) {
    const extra = zip64 ? Uint8Array.from([...le(1, 2), ...le(24, 2), ...le(c.size, 8), ...le(c.csize, 8), ...le(c.offset, 8), ...c.extra]) : c.extra;
    const big = (n) => le(zip64 ? 0xffffffff : n, 4);
    const header = Uint8Array.from([
      ...le(0x02014b50, 4), ...le(0x031e, 2), ...le(zip64 ? 45 : 20, 2), ...le(c.flags, 2), ...le(c.method, 2), ...le(0x6000, 2), ...le(0x58a1, 2),
      ...le(c.crc, 4), ...big(c.csize), ...big(c.size), ...le(c.name.length, 2), ...le(extra.length, 2), ...le(0, 2),
      ...le(0, 2), ...le(0, 2), ...le(0, 4), ...big(c.offset),
    ]);
    parts.push(header, c.name, extra);
    offset += header.length + c.name.length + extra.length;
  }
  const cdSize = offset - cdStart;
  if (zip64) {
    const end64 = Uint8Array.from([
      ...le(0x06064b50, 4), ...le(44, 8), ...le(45, 2), ...le(45, 2), ...le(0, 4), ...le(0, 4),
      ...le(central.length, 8), ...le(central.length, 8), ...le(cdSize, 8), ...le(cdStart, 8),
    ]);
    const locator = Uint8Array.from([...le(0x07064b50, 4), ...le(0, 4), ...le(offset, 8), ...le(1, 4)]);
    parts.push(end64, locator);
  }
  const note = enc.encode(comment);
  parts.push(Uint8Array.from([
    ...le(0x06054b50, 4), ...le(disk, 2), ...le(disk, 2), ...le(zip64 ? 0xffff : central.length, 2), ...le(zip64 ? 0xffff : central.length, 2),
    ...le(zip64 ? 0xffffffff : cdSize, 4), ...le(zip64 ? 0xffffffff : cdStart, 4), ...le(note.length, 2),
  ]), note);
  return new Blob(parts);
}

const CDA = '<?xml version="1.0" encoding="UTF-8"?>\n<ClinicalDocument xmlns="urn:hl7-org:v3">'
  + `${'<entry><observation classCode="OBS"/></entry>'.repeat(4000)}</ClinicalDocument>`; // bigger than export.xml
const GPX = '<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="Apple Health Export"><trk><trkseg/></trk></gpx>';
const exportZip = (xmlName) => makeZip([
  { name: 'apple_health_export/', data: '', method: 0 },
  { name: 'apple_health_export/export_cda.xml', data: CDA },
  { name: xmlName, data: FULL, localExtra: LOCAL_EXTRA, centralExtra: CENTRAL_EXTRA },
  { name: 'apple_health_export/workout-routes/route_2024-05-04_9.00am.gpx', data: GPX, method: 0 },
]);

test('listZipEntries reads the central directory', async () => {
  const zip = await exportZip('apple_health_export/export.xml');
  const entries = await listZipEntries(zip);
  assert.deepEqual(entries.map((e) => [e.name, e.method]), [
    ['apple_health_export/', 0],
    ['apple_health_export/export_cda.xml', 8],
    ['apple_health_export/export.xml', 8],
    ['apple_health_export/workout-routes/route_2024-05-04_9.00am.gpx', 0],
  ]);
  const xml = entries[2];
  assert.equal(xml.size, enc.encode(FULL).length);
  assert.ok(xml.compressedSize > 0 && xml.compressedSize < xml.size);
  // The first entry starts the file; each later one starts where the previous ended.
  assert.equal(entries[0].offset, 0);
  assert.equal(entries[1].offset, 30 + 'apple_health_export/'.length);
  assert.equal(entries[3].size, GPX.length);
});

test('openZipEntry inflates deflate entries and passes stored ones through', async () => {
  const zip = await exportZip('apple_health_export/export.xml');
  const entries = await listZipEntries(zip);
  // export.xml's local header has a 24-byte extra field; the directory copy has 9 bytes.
  const xml = new TextDecoder().decode(await bytesOf(await openZipEntry(zip, entries[2])));
  assert.equal(xml, FULL);
  const gpx = new TextDecoder().decode(await bytesOf(await openZipEntry(zip, 'apple_health_export/workout-routes/route_2024-05-04_9.00am.gpx')));
  assert.equal(gpx, GPX);
  assert.equal((await bytesOf(await openZipEntry(zip, 'apple_health_export/'))).length, 0);
});

test('importAppleHealth reads export.zip and gives the same result as the XML', async () => {
  const zip = await exportZip('apple_health_export/export.xml');
  const fractions = [];
  const r = await importAppleHealth(zip, { onProgress: (f) => fractions.push(f) });
  assert.deepEqual(r, await parse(FULL));
  assert.equal(fractions.at(-1), 1);
});

test('the export is found when the phone language renames it', async () => {
  // Spanish phones write exportar.xml and Norwegian ones eksport.xml.
  const expected = await parse(FULL);
  for (const name of ['apple_health_export/exportar.xml', 'apple_health_export/eksport.xml', 'Export.XML']) {
    assert.deepEqual(await importAppleHealth(await exportZip(name)), expected, name);
  }
  const none = await importAppleHealth(await makeZip([{ name: 'apple_health_export/export_cda.xml', data: CDA }, { name: 'notes.xml', data: '<notes/>' }]));
  assert.equal(none.ok, false);
  assert.match(none.reason, /no Apple Health export inside/);
});

test('a renamed export that cannot be opened says why, not "no export inside"', async () => {
  const locked = await importAppleHealth(await makeZip([{ name: 'apple_health_export/eksport.xml', data: FULL, method: 0, flags: 1 }]));
  assert.equal(locked.ok, false);
  assert.match(locked.reason, /password-protected/);
  const bzip = await importAppleHealth(await makeZip([{ name: 'apple_health_export/exportar.xml', data: FULL, method: 12 }]));
  assert.equal(bzip.ok, false);
  assert.match(bzip.reason, /kind of compression \(method 12\)/);
});

test('an empty zip, as a failed export leaves, says the export did not finish', async () => {
  const empty = await makeZip([]);
  assert.equal(empty.size, 22); // only the end record
  const r = await importAppleHealth(empty);
  assert.equal(r.ok, false);
  assert.match(r.reason, /zip file is empty/);
});

test('ZIP64 archives: sizes and offsets from the ZIP64 records', async () => {
  const zip = await makeZip([
    { name: 'a.txt', data: 'first file', method: 0 },
    { name: 'apple_health_export/export.xml', data: FULL },
  ], { zip64: true });
  const entries = await listZipEntries(zip);
  assert.equal(entries[1].name, 'apple_health_export/export.xml');
  assert.equal(entries[1].size, enc.encode(FULL).length);
  // a.txt: 30-byte header + 5-byte name + 20-byte ZIP64 extra + 10 bytes of data = 65
  assert.equal(entries[1].offset, 65);
  assert.equal(new TextDecoder().decode(await bytesOf(await openZipEntry(zip, 'a.txt'))), 'first file');
  assert.deepEqual(await importAppleHealth(zip), await parse(FULL));
});

test('a zip comment, even one holding the end-record signature, is skipped', async () => {
  const zip = await makeZip([{ name: 'x.txt', data: 'hello', method: 0 }], { comment: 'PK\u0005\u0006 is the end-record signature, here inside a comment long enough to be searched' });
  const entries = await listZipEntries(zip);
  assert.deepEqual(entries.map((e) => e.name), ['x.txt']);
  assert.equal(new TextDecoder().decode(await bytesOf(await openZipEntry(zip, entries[0]))), 'hello');
  assert.deepEqual(await listZipEntries(await makeZip([])), []);
  // A writer that stores 65,535 in the entry counts without ZIP64 records: still read.
  const maxed = new Uint8Array(await (await makeZip([{ name: 'x.txt', data: 'hello', method: 0 }])).arrayBuffer());
  const e = maxed.length - 22; // no comment, so the end record is the last 22 bytes
  maxed.fill(0xff, e + 8, e + 12);
  assert.deepEqual((await listZipEntries(new Blob([maxed]))).map((x) => x.name), ['x.txt']);
});

test('names without the UTF-8 flag: read as UTF-8 when valid, else one character per byte', async () => {
  // Old macOS zips wrote UTF-8 without the flag; DOS tools wrote code page 437, where 0x82 is é.
  const dos = Uint8Array.from([0x52, 0x82, 0x73, 0x75, 0x6d, 0x82, 0x2e, 0x74, 0x78, 0x74]);
  const zip = await makeZip([
    { name: 'santé/export.xml', data: 'a', method: 0, utf8: false },
    { name: dos, data: 'b', method: 0, utf8: false },
  ]);
  const names = (await listZipEntries(zip)).map((e) => e.name);
  assert.deepEqual(names, ['santé/export.xml', String.fromCharCode(...dos)]); // ASCII parts stay exact
});

test('an entry whose data runs past the end of the file is reported as incomplete', async () => {
  const bytes = new Uint8Array(await (await makeZip([{ name: 'a.txt', data: 'hello', method: 0 }])).arrayBuffer());
  const e = bytes.length - 22; // no comment, so the end record is the last 22 bytes
  const cd = bytes[e + 16] | (bytes[e + 17] << 8) | (bytes[e + 18] << 16) | (bytes[e + 19] << 24);
  bytes.set(le(1000000, 4), cd + 20); // the directory now claims 1,000,000 compressed bytes
  const blob = new Blob([bytes]);
  const [entry] = await listZipEntries(blob);
  assert.equal(entry.compressedSize, 1000000);
  const err = await openZipEntry(blob, entry).then(() => null, (x) => x);
  assert.equal(err?.code, 'TRUNCATED');
});

test('only small parts of the archive are read whole; the file itself is streamed', async () => {
  const big = new Uint8Array(4 * 1024 * 1024).map((_, i) => (i * 31) % 251);
  const zip = await makeZip([{ name: 'big.bin', data: big, method: 0 }, { name: 'small.txt', data: 'hi', method: 0 }]);
  let readWhole = 0;
  const watch = (b) => ({
    size: b.size,
    slice: (s, e) => watch(b.slice(s, e)),
    arrayBuffer: async () => { readWhole += b.size; return b.arrayBuffer(); },
    stream: () => b.stream(),
  });
  const entries = await listZipEntries(watch(zip));
  assert.ok(readWhole < 70 * 1024, `read ${readWhole} bytes to list a 4 MB archive`);
  const before = readWhole;
  const out = await bytesOf(await openZipEntry(watch(zip), entries[0]));
  assert.equal(readWhole - before, 30); // just the local header
  assert.equal(out.length, big.length);
  assert.equal(crc32(out), crc32(big));
});

test('a damaged end record does not make the reader load the whole archive', async () => {
  const big = new Uint8Array(4 * 1024 * 1024).map((_, i) => (i * 31) % 251);
  const bytes = new Uint8Array(await (await makeZip([{ name: 'big.bin', data: big, method: 0 }])).arrayBuffer());
  const e = bytes.length - 22; // no comment, so the end record is the last 22 bytes
  // The end record now says the directory starts at byte 0 (a local file header) and fills
  // everything up to the end record: about 4 MB, which is never read.
  bytes.set(le(e, 4), e + 12);
  bytes.set(le(0, 4), e + 16);
  let readWhole = 0;
  const watch = (b) => ({
    size: b.size,
    slice: (s, t) => watch(b.slice(s, t)),
    arrayBuffer: async () => { readWhole += b.size; return b.arrayBuffer(); },
    stream: () => b.stream(),
  });
  const err = await listZipEntries(watch(new Blob([bytes]))).then(() => null, (x) => x);
  assert.equal(err?.code, 'CORRUPT');
  assert.ok(readWhole < 70 * 1024, `read ${readWhole} bytes of a damaged 4 MB archive`);
  // A directory that would run 10 bytes into the end record is damaged too.
  const good = new Uint8Array(await (await makeZip([{ name: 'a.txt', data: 'hello', method: 0 }])).arrayBuffer());
  const g = good.length - 22;
  const cdAt = good[g + 16] | (good[g + 17] << 8) | (good[g + 18] << 16) | (good[g + 19] << 24);
  good.set(le(g - cdAt + 10, 4), g + 12);
  assert.equal((await listZipEntries(new Blob([good])).then(() => null, (x) => x))?.code, 'CORRUPT');
});

test('broken or unsupported zips fail with a code and a plain reason', async () => {
  const codeOf = async (promise) => {
    try {
      await promise;
      return 'no error';
    } catch (err) {
      assert.ok(err.message.length > 10 && !/undefined/.test(err.message), err.message);
      return err.code;
    }
  };
  assert.equal(await codeOf(listZipEntries(null)), 'NO_FILE');
  assert.equal(await codeOf(listZipEntries(new Blob(['PK']))), 'NOT_ZIP');
  assert.equal(await codeOf(listZipEntries(new Blob(['This is a plain text file, not a zip archive at all.']))), 'NOT_ZIP');

  const good = new Uint8Array(await (await exportZip('apple_health_export/export.xml')).arrayBuffer());
  // Cut short, as a download that did not finish: the end record is gone.
  assert.equal(await codeOf(listZipEntries(new Blob([good.subarray(0, good.length - 300)]))), 'TRUNCATED');
  // A damaged directory: break the signature where the end record says the directory starts
  // (offset field at byte 16 of the 22-byte end record, which is last because there is no comment).
  const e = good.length - 22;
  const cdStart = good[e + 16] | (good[e + 17] << 8) | (good[e + 18] << 16) | (good[e + 19] << 24);
  assert.deepEqual([...good.subarray(cdStart, cdStart + 4)], [0x50, 0x4b, 1, 2]);
  const damaged = good.slice();
  damaged[cdStart] = 0;
  assert.equal(await codeOf(listZipEntries(new Blob([damaged]))), 'CORRUPT');

  assert.equal(await codeOf(listZipEntries(await makeZip([{ name: 'a', data: 'a', method: 0 }], { disk: 1 }))), 'MULTI_DISK');
  const locked = await makeZip([{ name: 'secret.xml', data: 'x', method: 0, flags: 1 }]);
  assert.equal(await codeOf(openZipEntry(locked, 'secret.xml')), 'ENCRYPTED');
  const bzip = await makeZip([{ name: 'b.xml', data: 'x', method: 12 }]);
  assert.equal((await listZipEntries(bzip))[0].method, 12);
  assert.equal(await codeOf(openZipEntry(bzip, 'b.xml')), 'UNSUPPORTED_METHOD');
  assert.equal(await codeOf(openZipEntry(bzip, 'missing.xml')), 'NOT_FOUND');
  const r = await importAppleHealth(bzip);
  assert.equal(r.ok, false);
});

test('without DecompressionStream, stored entries still open and the reason says what to do', async () => {
  const zip = await exportZip('apple_health_export/export.xml');
  const saved = globalThis.DecompressionStream;
  try {
    delete globalThis.DecompressionStream;
    assert.equal(typeof DecompressionStream, 'undefined');
    const err = await openZipEntry(zip, 'apple_health_export/export.xml').then(() => null, (e) => e);
    assert.equal(err?.code, 'NO_DEFLATE');
    const gpx = await bytesOf(await openZipEntry(zip, 'apple_health_export/workout-routes/route_2024-05-04_9.00am.gpx'));
    assert.equal(gpx.length, GPX.length);
    const r = await importAppleHealth(zip);
    assert.equal(r.ok, false);
    assert.match(r.reason, /cannot unzip/);
  } finally {
    globalThis.DecompressionStream = saved;
  }
});
