# Home monitoring kit: the contracts between modules

Written 2026-11-08 by the wearables session, for the builders of `app/js/home/*` and the Home plan view. Everything here is outside the gyros: phone and watch motion sensors belong to the gyro fork.

## Shared vocabulary

- **Sample** (passive or device data): `{ signal, start, end?, value, value2?, unit, source, person?, simulated?, detail? }`
  - Signal ids and units:
    - Walking and activity: `steps` (unit `steps`: a count per day), `walking_speed` (m/s), `step_length` (m), `double_support` (%), `walking_asymmetry` (%), `walking_steadiness` (%), `six_minute_walk` (m), `stair_ascent_speed` (m/s), `stair_descent_speed` (m/s), `falls` (count)
    - Body: `weight` (kg), `body_fat` (%), `lean_mass` (kg), `grip` (kg), `temperature` (degC), `wrist_temp` (degC)
    - Heart and blood pressure: `heart_rate` (bpm), `resting_hr` (bpm), `hrv_sdnn` (ms), `hrv_rmssd` (ms), `bp` (value = systolic mmHg, value2 = diastolic mmHg), `vo2max` (mL/kg/min)
    - Breathing and sleep: `spo2` (%), `respiratory_rate` (breaths/min), `sleep_minutes` (minutes asleep per night), `breathing_disturbances` (as the source reports it), `fvc` (% predicted), `peak_cough_flow` (L/min)
  - `start` and `end` are ISO 8601. Date-only `YYYY-MM-DD` is allowed for daily values. Percentages are 0 to 100.
  - `source`: `apple-health`, `csv`, `csv:<format>`, `manual`, `bluetooth` or `demo`.
- **Result** (an active test): `{ id, test, date, time?, value, unit, detail?, person?, simulated?, practice? }`
  - Test ids:
    - Speech and breathing: `ddk_rate` (syllables/s), `mpt` (s), `single_breath_count` (count), `pause_pct` (%)
    - Hand: `typing_speed` (characters/min), `grip` (kg)
    - Legs: `timed_walk_speed` (m/s), `sts30` (repetitions), `sts5_time` (s), `tug_time` (s)
    - Questionnaires: `eat10` (score), `breathing_symptoms` (count), `falls_week` (count)
  - The existing tests in `app/js/hometests.js` (`tap_right`, `tap_left`, `reading`, `weight`, `walk`) stay there, under the key `rfn.homeResults`. The kit only reads them.
- **Dates**: `YYYY-MM-DD` strings are calendar dates, never shifted by time zone. Weeks start on Monday.
- **Regions** (the engine's): `arm`, `leg`, `bulbar`, `breathing`, `general`, `cognitive`. Labels come from `REGION_LABEL` in `app/js/cases.js` (read-only import).

## Wave 1 modules (built and reviewed by the build workflow)

- `app/js/home/series.js`: `weekStart`, `toDaily`, `toWeekly`, `baseline`, `assessDecline`, `slopePerMonth`, `percentChange`
- `app/js/home/store.js`: `KEYS`, `getSamples`, `addSamples`, `removeSamples`, `getResults`, `addResult`, `removeResult`, `clearHomeData`, `subscribe`, `storageStatus`
- `app/js/home/import/zip.js`: `listZipEntries`, `openZipEntry`
- `app/js/home/import/applehealth.js`: `importAppleHealth`, `parseAppleHealthChunks`
- `app/js/home/import/csv.js`: `parseCsv`, `FORMATS`, `csvToSamples`, `MANUAL_FIELDS`, `manualToSample`, `samplesToCsv`
- `app/js/home/import/bluetooth.js`: parsers, `toSample`, `bluetoothSupport`, `connectHealthDevice`
- `app/js/home/audio.js`: `frameRms`, `toDb`, `noiseFloorDb`, `detectVoice`, `longestSegment`, `countBursts`, `burstRate`, `pauseStats`, `analyzeTask`, `micSupport`, `recordAudio`
- `app/js/home/typing.js`: `PASSAGES`, `createTypingSession`, `typingMetrics`, `editDistance`

(The exact signatures are in each file's header comment.)

## Wave 2 modules

### `app/js/home/catalog.js` (pure data, every clinical number sourced)

```js
export const TESTS = {
  // one entry per active test id above
  ddk_rate: {
    id: 'ddk_rate', label: 'Syllable repetition (pa-ta-ka)', short: 'Pa-ta-ka', region: 'bulbar',
    kind: 'mic' | 'typing' | 'stopwatch' | 'count' | 'questionnaire' | 'manual',
    unit: 'syllables/s', higherIsBetter: true, decimals: 1,
    cadence: 'weekly',              // the default; the protocol may change it
    minutes: 1,                      // rough time it takes
    instructions: ['plain-words steps'],
    safety: ['who should not do it alone, stop rules'],   // [] when none
    practiceWeeks: 2,                // sessions before the baseline counts
    mdc: { value, unit, population, text, source, computedByUs } | null,
    feeds: 'engine-candidate' | 'context' | 'clinician-prompt',
    verdict: 'detects' | 'monitors' | 'context' | 'no use',
    evidence: { grade: 'strong' | 'moderate' | 'weak' | 'not studied', text, sources: [url] },
    implementation: 'working' | 'experimental' | 'manual',   // experimental = our timing tool, not validated
    questions: [ { id, text, options: [ { label, score } ] } ],   // questionnaires only, and only when the licence allows
    licence: 'text', // questionnaires only
  },
};
export const SIGNALS = {
  // one entry per signal id above
  walking_speed: {
    id, label, region, unit, higherIsBetter, decimals,
    weekly: { reduce: 'median', minPerWeek: 3 },
    mdc: { ... } | null,
    feeds, verdict, evidence: { grade, text, sources },
    devices: ['iPhone (HealthKit walkingSpeed)', ...],
  },
};
export const THRESHOLDS = [
  // clinical action triggers after diagnosis, each sourced
  { id, domain: 'nutrition' | 'breathing' | 'swallowing' | 'speech' | 'mobility' | 'hand' | 'cognition',
    when: { kind: 'test' | 'signal', id, rule: 'pctDropFromBaseline' | 'below' | 'above' | 'atLeast', value, unit },
    action: 'plain words for the clinician', patient: 'plain words for the patient', source: url, sourceLabel },
];
export const VERDICTS = [ { item, region, verdict, grade, why, sources: [url] } ]; // "what actually detects anything"
```

### `app/js/home/protocol.js` (pure)

```js
// From the engine's evaluation of the current case to a situation.
export function situationFrom({ caseFile, asOf, evaluation /* evaluateAt(...) */ }) -> {
  stage: 'low' | 'unclear' | 'high' | 'diagnosed',
  tier, diagnosed: boolean, affectedRegions: ['arm', ...], otherRegions: [...],
  weekInWindow: number | null,     // for an unclear case: weeks since it became unclear
  canWalkSafely: boolean | null,   // from findings and user answers when known
  reasons: ['plain words'],
}
export function planFor(situation, { devices = [], answers = {} } = {}) -> {
  headline, stage,
  weekly:  [ { kind: 'test' | 'signal' | 'question', id, why, cadence, practice: boolean, safety: [] } ],
  every2weeks: [...], monthly: [...],
  passive: [ { signal, device, why } ],
  triggers: [ { if: 'plain words', then: 'plain words', source } ],
  safety: ['plain words'],
  notes: ['plain words'],
}
export const DEVICES = [ { id: 'iphone' | 'android' | 'apple_watch' | 'other_watch' | 'smart_scale' | 'bp_cuff' | 'oximeter' | 'dynamometer' | 'none', label } ];
```

### `app/js/home/demo.js`

`demoSamples(caseId)` and `demoResults(caseId)` return simulated, clearly labelled (`simulated: true`, `source: 'demo'`) data for Alex only, consistent with his notes and dates in `app/js/alex.js`. They are never written to storage unless the user presses "Load demo data". They are shown only when the top-bar "Home data" switch is on.

### `app/js/app/views/homeplan.js` and `app/css/views/homeplan.css`

- `export function mount(root, ctx)` returns `{ update(ctx), unmount() }`, as the other views do. `ctx` has `state`, `setState`, `opts` (engine options), `caseEntry`, `caseFile` and `navigate`.
- Sections:
  1. This week's plan for the case's situation.
  2. The tests, runnable inline.
  3. The person's data by region, with weekly charts, the MDC band and a status in words.
  4. Bring in device data: an Apple Health export, CSV, manual entry, Bluetooth.
  5. What actually detects anything: the verdict table.
  6. Data handling: everything stays in this browser, plus delete by source.
- Honesty labels:
  - "Simulated" on demo data;
  - "Not validated" on experimental timing tools;
  - "Context only" on signals that never count toward the score;
  - "Never instead of a referral".
