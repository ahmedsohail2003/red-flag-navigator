// Simulated home data for Alex Chen, for the demo only. Pure functions, no DOM or
// storage: runs in the browser and in Node (tests/home-demo.test.mjs).
//
// SIMULATED, NOT MEASURED. Alex never used the kit. These numbers are made up, shaped
// by his notes and dates in app/js/alex.js, so the Home plan view has something honest
// to show. Every sample has source 'demo' and simulated: true; every result has
// simulated: true and source 'demo' in its detail. The view saves them only when the
// person presses "Load demo data" (plans/home-monitoring-contracts.md).
//
//   demoSamples(caseId) -> device samples (Sample shape), sorted by date then signal
//   demoResults(caseId) -> kit test results (Result shape), sorted by date, test, time
//     (grip has two a session: detail.hand 'right' at 18:00 and 'left' at 18:01)
//     Both give [] for any case but 'alex', and new objects on every call.
//   DEMO_NOISE -> the noise table below, as data:
//     id -> { mdc, sd, unit, population, source, ourChoice } (bp also has mdc2 and sd2;
//     for grip, mdc and sd are in % of the value, as the catalogue's MDC is)
//
// His timeline, as used here:
//   2024-06     first symptom (right hand). Stored iPhone, watch and scale history
//               starts Mon 2024-06-03, as if imported when the kit started.
//   2024-10-14  family doctor (e1): the kit starts, every Monday at 18:00; about 1 week
//               in 25 is missed. No result is marked practice: the catalogue's
//               practiceWeeks (2 for the timed tests, 1 for grip) already leaves the
//               first weeks out of the baseline, and summary.js drops practice-marked
//               runs as well. Grip, both hands, as if he had a home dynamometer (the
//               protocol adds grip when there is one): "Grip is slightly weaker on the
//               right" (e1).
//   2024-12-09  hand surgeon (e2). Carpal tunnel release on Mon 2025-01-20: no tests
//               that day, no typing for the 2 weeks after, and no right-hand grip for
//               6 weeks (our choice; the notes give no figure). The grip notes say to
//               restart the grip baseline after hand surgery; summary.js does not, so
//               the tests check that the right hand confirms in 2025 either way.
//   2025-04-21  right foot catching on stairs (e3); he stopped running in May 2025.
//   2025-08-12  foot catches on curbs and slaps (e4): leg tests with someone present.
//   2026-02-10  two falls, ankle 3/5 (e5). A cane from Mon 2026-02-16. About 6 kg lost
//               "since the summer" (e6, 2026-02-16).
//   2026-06-11  slurring by late afternoon, coughing on water, two pillows, 78 kg (e7).
//   2026-07-14  diagnosis. The data stops on Mon 2026-08-31.
// Levels are our choice, plausible for a fit 45-year-old and bent to fit his notes.
// Where the clinic measured him (2026-09-22) the data heads there: 10-m walk 14.2 s
// with a cane (0.70 m/s), weight 77.5 kg (86 kg two years before), grip 14 kg right
// and 32 kg left.
//
// ---------- noise table ----------
// Noise SD = MDC / (1.96 x sqrt(2)): an MDC95 is 1.96 x sqrt(2) x the SD of one
// measurement, so with this noise the decline rule in series.js fires about as often
// as it would on real data (rarely while stable, reliably on a real decline). Each MDC
// is the one catalog.js uses (where the notes give a range, the catalogue's pick), so
// the noise matches the thresholds the view applies; tests/home-demo.test.mjs checks
// that they stay equal. Where nothing is published we picked a modest SD ("our
// choice"). Device samples share one offset per Monday-to-Sunday week (that SD) plus
// a daily jitter of half the SD, so their weekly value moves by about the SD.
//
// | id                  | MDC used                         | noise SD   | population (source)
// | ddk_rate            | 1.03 syllables/s                 | 0.372      | 19 with ALS, weekly home iPhone pa-ta-ka, 24 weeks (Burke 2026, WatchALS) https://doi.org/10.2196/85142
// | mpt                 | 8.55 s (top of 5.54 to 8.55)     | 3.08       | 90 healthy adults, best of 3, 15 days apart (Moreno 2021) https://doi.org/10.1590/1982-0216/20212349720
// | single_breath_count | 18.24 counts (top of 11.07 to 18.24) | 6.58   | the same 90 healthy adults (Moreno 2021) https://doi.org/10.1590/1982-0216/20212349720
// | pause_pct           | 9.39 points                      | 3.39       | 46 controls retested 3 to 6 months apart in labs and clinics (Barnett 2020) https://pmc.ncbi.nlm.nih.gov/articles/PMC7080316/
// | typing_speed        | none published                   | 9 (our choice: 5% of his 180) | no ALS MDC; MS keystroke noise only in z-score units (Lam 2021) https://pmc.ncbi.nlm.nih.gov/articles/PMC8358561/
// | grip                | 23.4% of the value (computed in the grip notes from a home SEM of 8.46%) | 8.44% of the level | 38 with CIDP or MMN, one squeeze per hand at home, weekly or monthly, about 11 months (Lemmen 2025) https://doi.org/10.1111/jns.70005
// | timed_walk_speed    | 0.284 m/s (controls; 0.179 in ALS) | 0.102    | 23 controls, weekly home 60-s walk, 24 weeks (WatchALS) https://pmc.ncbi.nlm.nih.gov/articles/PMC13423962/
// | sts30               | 4.25 stands                      | 1.53       | 150 adults with post-COVID condition, about 2 weeks apart (Braun 2026) https://doi.org/10.1371/journal.pone.0348275
// | tug_time            | 3.0 s                            | 1.08       | 30 older adults at high fall risk, 1 week apart (Intaruk 2024) https://doi.org/10.5606/tftrd.2024.12725
// | eat10               | none in ALS                      | 0.5 (our choice), rounded, kept 0 to 2 | item retest r 0.72 to 0.91 only, mixed dysphagia (Belafsky 2008) https://doi.org/10.1177/000348940811701210
// | walking_speed       | 0.22 m/s (adults; 0.20 seniors)  | 0.0794     | 20 adults, supervised 6-minute walk, 1 week apart (Sci Rep 2023) https://pmc.ncbi.nlm.nih.gov/articles/PMC10067003/
// | step_length         | 9.4 cm (adults; 6.1 seniors)     | 0.0339 m   | the same adults (Sci Rep 2023) https://pmc.ncbi.nlm.nih.gov/articles/PMC10067003/
// | double_support      | 3.4 points (top of 1.8 to 3.4)   | 1.23       | the same study (Sci Rep 2023) https://pmc.ncbi.nlm.nih.gov/articles/PMC10067003/
// | walking_asymmetry   | none published                   | 1.5 (our choice) | the same study gives no asymmetry MDC https://pmc.ncbi.nlm.nih.gov/articles/PMC10067003/
// | steps               | 1580 steps a day                 | 570        | 104 with Parkinson's, Garmin watch over 5 days (Bianchini 2025) https://doi.org/10.2196/63153
// | weight              | 2.35 kg (computed by WEARABLES.md) | 0.848    | 46 free-living adults, fasted weighings 2 weeks apart (Bhutani 2017) https://doi.org/10.14814/phy2.13336
// | resting_hr          | 8.4 bpm (computed by WEARABLES.md) | 3.03     | 92,457 Fitbit users, within-person SD 3.03 bpm (Quer 2020) https://doi.org/10.1371/journal.pone.0227709
// | bp                  | 13.5 / 9.2 mmHg (computed by the vitals notes) | 4.87 / 3.32 | 133 untreated adults, 2-day home means within 2 weeks (Stergiou 2002) https://doi.org/10.1016/s0895-7061%2801%2902324-x
// | spo2                | 2.5 points (computed by the earlier notes) | 0.902 | 100 with MND, basal SpO2 on a clinic wrist oximeter, night to night (Luu 2025) https://doi.org/10.1111/resp.70072
// | respiratory_rate    | 3.9 breaths/min (top of 2.1 to 3.9, computed by WEARABLES.md) | 1.41 | Fitbit users aged 20 to 69, 14-day CV (Natarajan 2021) https://doi.org/10.1038/s41746-021-00493-6
// Not noise: falls_week holds the two falls his notes report (e5), plus near-falls we
// added (his foot "catches"); breathing_symptoms is 1 from June 2026 (two pillows, e7).

const K = 1.96 * Math.SQRT2;
const fromMdc = (mdc, unit, population, source) => Object.freeze({ mdc, sd: mdc / K, unit, population, source, ourChoice: false });
const ourChoice = (sd, unit, population, source) => Object.freeze({ mdc: null, sd, unit, population, source, ourChoice: true });
const SCI_REP_2023 = 'https://pmc.ncbi.nlm.nih.gov/articles/PMC10067003/';
const MORENO_2021 = 'https://doi.org/10.1590/1982-0216/20212349720';

export const DEMO_NOISE = Object.freeze({
  ddk_rate: fromMdc(1.03, 'syllables/s', '19 people with ALS, weekly home iPhone pa-ta-ka for 24 weeks (Burke 2026, WatchALS)', 'https://doi.org/10.2196/85142'),
  mpt: fromMdc(8.55, 's', '90 healthy adults, best of 3 trials, 15 days apart; top of the 5.54 to 8.55 s range (Moreno 2021)', MORENO_2021),
  single_breath_count: fromMdc(18.24, 'count', '90 healthy adults, best of 3 trials, 15 days apart; top of the 11.07 to 18.24 range (Moreno 2021)', MORENO_2021),
  pause_pct: fromMdc(9.39, '%', '46 controls retested 3 to 6 months apart in labs and clinics (Barnett 2020)', 'https://pmc.ncbi.nlm.nih.gov/articles/PMC7080316/'),
  typing_speed: ourChoice(9, 'characters/min', 'No ALS MDC; in MS, keystroke noise is published only in z-score units (Lam 2021). 9 is 5% of his starting 180.', 'https://pmc.ncbi.nlm.nih.gov/articles/PMC8358561/'),
  // a share of the value: the SD is 8.44% of the level, close to the published SEM
  grip: fromMdc(23.4, '% of baseline', '38 people with CIDP or MMN, one squeeze per hand at home, weekly or monthly, for about 11 months; MDC computed in the grip notes from a home SEM of 8.46% (Lemmen 2025)', 'https://doi.org/10.1111/jns.70005'),
  timed_walk_speed: fromMdc(0.284, 'm/s', '23 controls, weekly home 60-second walk for 24 weeks (WatchALS); 0.179 m/s in the 19 with ALS', 'https://pmc.ncbi.nlm.nih.gov/articles/PMC13423962/'),
  sts30: fromMdc(4.25, 'repetitions', '150 adults with post-COVID condition, about 2 weeks apart (Braun 2026)', 'https://doi.org/10.1371/journal.pone.0348275'),
  tug_time: fromMdc(3.0, 's', '30 older adults at high fall risk, 1 week apart (Intaruk 2024)', 'https://doi.org/10.5606/tftrd.2024.12725'),
  eat10: ourChoice(0.5, 'score', 'No ALS MDC; item retest r 0.72 to 0.91 in mixed dysphagia (Belafsky 2008). Rounded and kept 0 to 2.', 'https://doi.org/10.1177/000348940811701210'),
  walking_speed: fromMdc(0.22, 'm/s', '20 adults, supervised 6-minute walk, retested after 1 week; 0.20 m/s in 24 healthy seniors (Sci Rep 2023)', SCI_REP_2023),
  step_length: fromMdc(0.094, 'm', 'The same 20 adults: 9.4 cm; 6.1 cm in the seniors (Sci Rep 2023)', SCI_REP_2023),
  double_support: fromMdc(3.4, '%', 'The same study: 3.4 points, the top of the 1.8 to 3.4 range (Sci Rep 2023)', SCI_REP_2023),
  walking_asymmetry: ourChoice(1.5, '%', 'No MDC published; the same study gives none for asymmetry (Sci Rep 2023)', SCI_REP_2023),
  steps: fromMdc(1580, 'steps', "104 people with Parkinson's disease, Garmin watch over 5 days (Bianchini 2025)", 'https://doi.org/10.2196/63153'),
  weight: fromMdc(2.35, 'kg', '46 free-living adults, single fasted weighings 2 weeks apart; MDC computed in WEARABLES.md (Bhutani 2017)', 'https://doi.org/10.14814/phy2.13336'),
  resting_hr: fromMdc(8.4, 'bpm', '92,457 Fitbit users; MDC computed in WEARABLES.md from a within-person SD of 3.03 bpm (Quer 2020)', 'https://doi.org/10.1371/journal.pone.0227709'),
  bp: Object.freeze({
    ...fromMdc(13.5, 'mmHg', '133 untreated adults, 2-day home means within 2 weeks; MDC computed in the vitals notes (Stergiou 2002)', 'https://doi.org/10.1016/s0895-7061%2801%2902324-x'),
    mdc2: 9.2, sd2: 9.2 / K,
  }),
  spo2: fromMdc(2.5, '%', '100 people with MND, basal SpO2 on a clinic wrist oximeter, night to night; MDC computed in the earlier notes (Luu 2025)', 'https://doi.org/10.1111/resp.70072'),
  respiratory_rate: fromMdc(3.9, 'breaths/min', 'Fitbit users aged 20 to 69, 14-day CV; the top of the 2.1 to 3.9 range computed in WEARABLES.md (Natarajan 2021)', 'https://doi.org/10.1038/s41746-021-00493-6'),
});

// ---------- random numbers (seeded, so the data is the same every time) ----------
// mulberry32 and randn are the ones in engine.js.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function randn(rng) {
  let u = 0;
  while (u === 0) u = rng();
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
// Each series has its own stream (FNV-1a hash of its name), so changing one series
// never changes another.
function seedOf(name) {
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
// The seed is chosen, and we say so: the first one from 20261108 up whose data passes
// tests/home-demo.test.mjs, which judges declines with the rules summary.js uses (no
// stable series raises a false decline, no series flags before its body region's first
// symptom in his notes, every real decline is caught and still shows at the end, and
// the right hand confirms before any leg measure, as it does with no noise: about May
// 2025 for the hand, from September 2025 for the legs). 57 of the 200 seeds from
// 20261108 pass. Across those 200, each stable series raised a false flag in about 3%
// to 8% of runs (bp 8%, single_breath_count 8%, mpt 5.5%, respiratory_rate 5%, resting
// heart rate 4%, spo2 3.5%), as real data with this noise would. Even with this seed,
// single noisy weeks happen: at the referral (2026-02-16) the iPhone step length is
// back within its MDC for a week after a decline confirmed in September 2025, and at
// the 2026-06-11 visit the TUG is, after one confirmed in March 2026.
const SEED = 20261114;
const streamFor = (name) => mulberry32(seedOf(`${SEED}:${name}`));

// ---------- dates ----------
// Whole days since 1970-01-01, UTC, so no time zone or daylight saving moves a day.
const DAY_MS = 86400000;
const dayNumber = (date) => Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) / DAY_MS;
const dateOf = (n) => new Date(n * DAY_MS).toISOString().slice(0, 10);

const HISTORY_START = '2024-06-03'; // Monday, the month of his first symptom
const KIT_START = '2024-10-14'; // Monday, his first family-doctor visit (e1)
const END = '2026-08-31'; // Monday
const SURGERY = '2025-01-20'; // carpal tunnel release (e2), a Monday
const NO_TYPING_UNTIL = '2025-02-03'; // the hand heals for 2 weeks after surgery
const NO_RIGHT_GRIP_UNTIL = '2025-03-03'; // no hard right-hand squeezes for 6 weeks (our choice)
const WITH_SOMEONE_FROM = '2025-08-12'; // foot catches on curbs and slaps (e4)
const CANE_FROM = '2026-02-16'; // first session after the falls report (e5)
const FALLS = new Map([['2026-01-19', 1], ['2026-02-09', 1]]); // e5, 2026-02-10: "He reports two falls"
const MISS_RATE = 0.04; // about 1 session in 25 missed
const TIME = '18:00'; // same time each week, after work
const PERSON = 'alex';

// ---------- levels ----------
// A level moves in straight lines between dated points and stays flat outside them.
function pathOf(points) {
  const pts = points.map(([date, v]) => [dayNumber(date), v]);
  return (n) => {
    if (n <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++) {
      const [x1, y1] = pts[i];
      if (n <= x1) {
        const [x0, y0] = pts[i - 1];
        return y0 + ((y1 - y0) * (n - x0)) / (x1 - x0);
      }
    }
    return pts[pts.length - 1][1];
  };
}
const clamp = (x, lo = -Infinity, hi = Infinity) => Math.min(hi, Math.max(lo, x));
function roundTo(x, decimals) {
  const f = 10 ** decimals;
  const r = Math.round(x * f) / f;
  return r === 0 ? 0 : r; // never -0
}

// Timed tests, weekly. Each is flat until its body region's first symptom in his notes:
// hand from late 2024, legs from late April 2025 (e3), speech from spring 2026 (after
// e6). The breath tests stay near baseline, inside their MDC.
const TIMED = [
  { test: 'typing_speed', unit: 'characters/min', decimals: 0, min: 20,
    path: [['2024-10-14', 180], ['2024-12-09', 173], ['2025-04-21', 163], ['2025-08-12', 154], ['2026-02-16', 138], ['2026-08-31', 118]] },
  { test: 'timed_walk_speed', unit: 'm/s', decimals: 2, min: 0.2, leg: true,
    path: [['2024-10-14', 1.45], ['2025-04-21', 1.45], ['2025-08-12', 1.22], ['2026-02-10', 0.95], ['2026-06-11', 0.8], ['2026-08-31', 0.73]] },
  { test: 'sts30', unit: 'repetitions', decimals: 0, min: 0, leg: true,
    path: [['2024-10-14', 19], ['2025-04-21', 19], ['2025-08-12', 15], ['2026-02-10', 10], ['2026-06-11', 8], ['2026-08-31', 7]] },
  { test: 'tug_time', unit: 's', decimals: 1, min: 4, leg: true,
    path: [['2024-10-14', 6.8], ['2025-04-21', 6.8], ['2025-08-12', 7.9], ['2026-02-10', 9.6], ['2026-06-11', 11.3], ['2026-08-31', 12.3]] },
  { test: 'ddk_rate', unit: 'syllables/s', decimals: 1, min: 1,
    path: [['2024-10-14', 5.8], ['2026-02-16', 5.8], ['2026-06-11', 4.7], ['2026-08-31', 4.2]] },
  { test: 'pause_pct', unit: '%', decimals: 1, min: 2, max: 80,
    path: [['2024-10-14', 17], ['2026-02-16', 17], ['2026-06-11', 25], ['2026-08-31', 29]] },
  { test: 'mpt', unit: 's', decimals: 1, min: 3,
    path: [['2024-10-14', 24], ['2026-03-01', 24], ['2026-08-31', 22]] },
  { test: 'single_breath_count', unit: 'count', decimals: 0, min: 5,
    path: [['2024-10-14', 60], ['2026-03-01', 60], ['2026-08-31', 55]] },
];

// Grip in kg, one value per hand per session. Right: slightly weaker than the left at
// e1, wasting by e2, "If anything the hand is weaker" 3 months after the surgery (e3),
// heading to the clinic's 14 kg. Left: steady until twitching shows in both forearms
// (e6), then heading to the clinic's 32 kg. The left is saved a minute after the right,
// so summary.js never takes the two hands' results for copies of one reading.
const GRIP = [
  { hand: 'right', time: TIME,
    path: [['2024-10-14', 41], ['2024-12-09', 38], ['2025-04-21', 31], ['2025-08-12', 26.5], ['2026-02-16', 21], ['2026-06-11', 17], ['2026-08-31', 15]] },
  { hand: 'left', time: '18:01',
    path: [['2024-10-14', 45], ['2026-02-16', 45], ['2026-08-31', 33]] },
];

// Device data, daily. skip: the share of days with no reading from that device.
const DEVICE_SKIP = { iphone_gait: 0.12, iphone_steps: 0, scale: 0.3, watch: 0.1, cuff: 0.1 };
const PASSIVE = [
  { signal: 'walking_speed', unit: 'm/s', decimals: 2, min: 0.2, device: 'iphone_gait', from: HISTORY_START,
    path: [['2024-06-03', 1.36], ['2025-04-21', 1.36], ['2025-08-12', 1.17], ['2026-02-10', 0.92], ['2026-06-11', 0.78], ['2026-08-31', 0.72]] },
  { signal: 'step_length', unit: 'm', decimals: 2, min: 0.2, device: 'iphone_gait', from: HISTORY_START,
    path: [['2024-06-03', 0.74], ['2025-04-21', 0.74], ['2025-08-12', 0.66], ['2026-02-10', 0.57], ['2026-06-11', 0.52], ['2026-08-31', 0.5]] },
  { signal: 'double_support', unit: '%', decimals: 1, min: 15, max: 60, device: 'iphone_gait', from: HISTORY_START,
    path: [['2024-06-03', 27], ['2025-04-21', 27], ['2025-08-12', 29.5], ['2026-02-10', 33], ['2026-06-11', 35], ['2026-08-31', 36]] },
  // rises with the right foot drop
  { signal: 'walking_asymmetry', unit: '%', decimals: 1, min: 0, max: 100, device: 'iphone_gait', from: HISTORY_START,
    path: [['2024-06-03', 2.5], ['2025-04-21', 2.5], ['2025-08-12', 9], ['2026-02-10', 18], ['2026-06-11', 22], ['2026-08-31', 24]] },
  // flat until the foot catches (e3), a step down when he stops running in May 2025,
  // then falling slowly
  { signal: 'steps', unit: 'steps', decimals: 0, min: 300, device: 'iphone_steps', from: HISTORY_START,
    path: [['2024-06-03', 10400], ['2025-04-21', 10400], ['2025-06-01', 8300], ['2026-02-10', 6200], ['2026-08-31', 4900]] },
  // e7: "86 kg two years ago to 78 kg today"; e6: "about 6 kg ... since the summer"
  { signal: 'weight', unit: 'kg', decimals: 1, min: 40, device: 'scale', from: HISTORY_START,
    path: [['2024-06-03', 86], ['2025-07-01', 86], ['2026-02-16', 80], ['2026-06-11', 78], ['2026-08-31', 77.7]] },
  // context: these stay normal and flat, because they do not track ALS
  { signal: 'resting_hr', unit: 'bpm', decimals: 0, min: 35, device: 'watch', from: HISTORY_START, path: [['2024-06-03', 54]] },
  { signal: 'bp', unit: 'mmHg', decimals: 0, min: 80, device: 'cuff', from: KIT_START, // a cuff bought when the kit started
    path: [['2024-10-14', 118]], path2: [['2024-10-14', 76]], min2: 45 },
  { signal: 'spo2', unit: '%', decimals: 0, min: 85, max: 100, device: 'watch', from: HISTORY_START, path: [['2024-06-03', 96.6]] },
  { signal: 'respiratory_rate', unit: 'breaths/min', decimals: 1, min: 8, device: 'watch', from: HISTORY_START, path: [['2024-06-03', 14.5]] },
];
const JITTER = 0.5; // daily jitter inside a week, as a share of the weekly SD

// ---------- results ----------
// Mondays from the kit start, minus the surgery day and the missed weeks. The miss is
// drawn for every week, so the pattern never shifts; weeks with a fall are never missed.
function sessionDates() {
  const rng = streamFor('sessions');
  const out = [];
  for (let n = dayNumber(KIT_START); n <= dayNumber(END); n += 7) {
    const date = dateOf(n);
    const missed = rng() < MISS_RATE;
    if (date === SURGERY || (missed && !FALLS.has(date))) continue;
    out.push(date);
  }
  return out;
}

// key makes the id unique when a test gives two results a session (grip, one per hand).
function makeResult(test, date, value, unit, detail = {}, { key = test, time = TIME } = {}) {
  return { id: `demo-${PERSON}-${key}-${date}`, test, date, time, value, unit, detail: { source: 'demo', ...detail }, person: PERSON, simulated: true };
}

// Leg tests after the foot drop are done with someone in the room, and with the cane
// once he has one (the safety rules in the exercises notes).
function legDetail(date) {
  const d = {};
  if (date >= WITH_SOMEONE_FROM) d.withSomeone = true;
  if (date >= CANE_FROM) d.aid = 'cane';
  return d;
}

function timedResults(spec, dates) {
  const rng = streamFor(spec.test);
  const level = pathOf(spec.path);
  const sd = DEMO_NOISE[spec.test].sd;
  const typing = spec.test === 'typing_speed';
  const out = [];
  let noted = false;
  for (const date of dates) {
    const noise = randn(rng); // drawn every session, so a skipped one shifts nothing
    if (typing && date > SURGERY && date <= NO_TYPING_UNTIL) continue;
    const value = roundTo(clamp(level(dayNumber(date)) + sd * noise, spec.min, spec.max), spec.decimals);
    let detail = spec.leg ? legDetail(date) : {};
    if (typing && date > NO_TYPING_UNTIL && !noted) {
      detail = { note: 'First typing test after the carpal tunnel release on 20 Jan 2025' };
      noted = true;
    }
    out.push(makeResult(spec.test, date, value, spec.unit, detail));
  }
  return out;
}

// The noise is a share of the level, as the published SEM is a share of the reading,
// so a weak hand varies by fewer kilograms than a strong one.
function gripResults(dates) {
  const share = DEMO_NOISE.grip.sd / 100;
  return GRIP.flatMap((spec) => {
    const rng = streamFor(`grip:${spec.hand}`);
    const level = pathOf(spec.path);
    const right = spec.hand === 'right';
    const out = [];
    let noted = false;
    for (const date of dates) {
      const noise = randn(rng); // drawn every session, so a skipped one shifts nothing
      if (right && date > SURGERY && date <= NO_RIGHT_GRIP_UNTIL) continue;
      const value = roundTo(clamp(level(dayNumber(date)) * (1 + share * noise), 2), 1);
      const detail = { hand: spec.hand };
      if (right && date > SURGERY && !noted) {
        detail.note = 'First grip test after the carpal tunnel release on 20 Jan 2025';
        noted = true;
      }
      out.push(makeResult('grip', date, value, 'kg', detail, { key: `grip-${spec.hand}`, time: spec.time }));
    }
    return out;
  });
}

// The first session of each month.
function monthly(dates) {
  return dates.filter((d, i) => i === 0 || dates[i - 1].slice(0, 7) !== d.slice(0, 7));
}

// EAT-10 stays 0 to 2: mostly 0, then 1 or 2 once he coughs on water (e7, June 2026).
function eat10Results(dates) {
  const rng = streamFor('eat10');
  const level = pathOf([['2024-10-14', 0.2], ['2026-03-01', 0.2], ['2026-06-11', 1.6], ['2026-08-31', 1.8]]);
  return monthly(dates).map((date) => {
    const value = clamp(roundTo(level(dayNumber(date)) + DEMO_NOISE.eat10.sd * randn(rng), 0), 0, 2);
    return makeResult('eat10', date, value, 'score');
  });
}

// Our plain breathing checklist, weekly: 0, then 1 (breathless lying flat) from June
// 2026, when his note says he has started sleeping on two pillows (e7).
function breathingResults(dates) {
  return dates.map((date) => (date >= '2026-06-01'
    ? makeResult('breathing_symptoms', date, 1, 'count', { note: 'Breathless lying flat: he has started sleeping on two pillows (June 2026 note)' })
    : makeResult('breathing_symptoms', date, 0, 'count')));
}

// Falls in the 7 days before each session: the two his notes report, nothing else.
// Near-falls are our addition: his right foot "catches" from April 2025, most often
// before the cane.
function fallsResults(dates) {
  const rng = streamFor('near_falls');
  return dates.map((date) => {
    const chance = date < '2025-04-21' ? 0 : date < WITH_SOMEONE_FROM ? 0.15 : date < CANE_FROM ? 0.35 : 0.15;
    const u = rng();
    const nearFalls = u < chance * 0.2 ? 2 : u < chance ? 1 : 0;
    return makeResult('falls_week', date, FALLS.get(date) ?? 0, 'count', { nearFalls });
  });
}

export function demoResults(caseId) {
  if (caseId !== PERSON) return [];
  const dates = sessionDates();
  const out = [
    ...TIMED.flatMap((spec) => timedResults(spec, dates)),
    ...gripResults(dates),
    ...eat10Results(dates),
    ...breathingResults(dates),
    ...fallsResults(dates),
  ];
  const key = (r) => `${r.date} ${r.test} ${r.time}`; // one result per test and time
  return out.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
}

// ---------- samples ----------
// Which days each device gave nothing (phone left at home, watch off at night). One
// stream per device, so the four iPhone walking metrics go missing on the same days.
function missingDays(device) {
  const rng = streamFor(`skip:${device}`);
  const days = new Set();
  for (let n = dayNumber(HISTORY_START); n <= dayNumber(END); n++) if (rng() < DEVICE_SKIP[device]) days.add(n);
  return days;
}

function passiveSamples(spec, missing) {
  const rng = streamFor(spec.signal);
  const level = pathOf(spec.path);
  const level2 = spec.path2 ? pathOf(spec.path2) : null;
  const { sd, sd2 } = DEMO_NOISE[spec.signal];
  const start = dayNumber(spec.from);
  const out = [];
  let week = 0;
  let week2 = 0;
  for (let n = start; n <= dayNumber(END); n++) {
    // spec.from is a Monday, so this draws one offset per Monday-to-Sunday week
    if ((n - start) % 7 === 0) {
      week = sd * randn(rng);
      if (level2) week2 = sd2 * randn(rng);
    }
    const jitter = randn(rng);
    const jitter2 = level2 ? randn(rng) : 0;
    if (missing.has(n)) continue;
    const s = {
      signal: spec.signal, start: dateOf(n),
      value: roundTo(clamp(level(n) + week + JITTER * sd * jitter, spec.min, spec.max), spec.decimals),
    };
    if (level2) s.value2 = roundTo(clamp(level2(n) + week2 + JITTER * sd2 * jitter2, spec.min2), spec.decimals);
    Object.assign(s, { unit: spec.unit, source: 'demo', person: PERSON, simulated: true });
    out.push(s);
  }
  return out;
}

export function demoSamples(caseId) {
  if (caseId !== PERSON) return [];
  const missing = Object.fromEntries(Object.keys(DEVICE_SKIP).map((d) => [d, missingDays(d)]));
  const out = PASSIVE.flatMap((spec) => passiveSamples(spec, missing[spec.device]));
  return out.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : a.signal < b.signal ? -1 : a.signal > b.signal ? 1 : 0));
}
