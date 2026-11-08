// Sourced weights for the red-flag scorer. Every number here has a source.
// Published weights: Mei et al., BMJ Open 2022;12:e058383, Figure 2 (multivariable
// conditional logistic regression, 6,437 MND cases vs 62,003 matched controls,
// signs last recorded 3 months to 5 years before diagnosis). Each adjusted OR is
// already adjusted for the other signs in the model, so multiplying them is how
// that logistic model makes a prediction.
// Copied by hand from the figure on 2026-11-07 (PMC9240876, Figure 2).

export const SOURCES = {
  mei2022: {
    short: 'Mei et al. 2022, BMJ Open',
    cite: 'Mei XW, Burchardt J, Ranger TA, et al. Identifying key signs of motor neurone disease in primary care: a nested case-control study using the QResearch database. BMJ Open 2022;12:e058383.',
    url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC9240876/',
  },
  eisen2012: {
    short: 'Eisen & Kuwabara 2012, JNNP',
    cite: 'Eisen A, Kuwabara S. The split hand syndrome in amyotrophic lateral sclerosis. J Neurol Neurosurg Psychiatry 2012;83:399-403.',
    url: 'https://jnnp.bmj.com/content/83/4/399',
  },
  goldcoast2020: {
    short: 'Gold Coast criteria (Shefner et al. 2020)',
    cite: 'Shefner JM, Al-Chalabi A, Baker MR, et al. A proposal for new diagnostic criteria for ALS. Clin Neurophysiol 2020;131:1975-1978.',
    url: 'https://doi.org/10.1016/j.clinph.2020.04.005',
  },
  logroscino2010: {
    short: 'Logroscino et al. 2010 (EURALS), via Mei 2022',
    cite: 'Logroscino G, et al. Incidence of amyotrophic lateral sclerosis in Europe. J Neurol Neurosurg Psychiatry 2010;81:385-90. Crude incidence 2.16 per 100,000 person-years (Mei 2022 quotes it as 2.7).',
    url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC9240876/',
  },
  seattle_analysis: {
    short: 'Seattle ALS cohort, our analysis',
    cite: 'Our analysis of the Seattle ALS Patient Profile Database (143 patients, 1987-89; Mendeley Data, CC BY-NC 3.0): spine or limb surgery 11.1 times as frequent at ages inside the symptom-to-diagnosis window (95% CI 5.0 to 24.2; 12 surgeries in 11 people). Association only; other surgeries were 2.1 times as frequent, so part of it is recall. See analysis/focus_seattle/SUMMARY.md.',
    url: 'https://doi.org/10.17632/stcztggnnp.2',
  },
  assumption: {
    short: 'Team assumption (to be calibrated)',
    cite: 'Not from a published primary-care study. A wide range on purpose; the validation study replaces it with a measured value.',
    url: '',
  },
};

// region: where in the body the sign is (used for the "spread to a new region" rule)
//   arm | leg | bulbar | breathing | general | cognitive | other
// motor: true when the sign is objective or subjective motor weakness/wasting/twitching
// group: the figure's own grouping
export const FINDINGS = {
  // Bulbar
  dysarthria:          { label: 'Dysarthria (slurred or slow speech)', plain: 'changes in how clearly you speak', group: 'Bulbar', region: 'bulbar', motor: true,  or: 43.22, lo: 35.95, hi: 51.97, source: 'mei2022' },
  sialorrhoea:         { label: 'Sialorrhoea (excess saliva)', plain: 'extra saliva or drooling', group: 'Bulbar', region: 'bulbar', motor: true, or: 7.96, lo: 4.50, hi: 14.08, source: 'mei2022' },
  dysphagia:           { label: 'Dysphagia (difficulty swallowing)', plain: 'trouble swallowing', group: 'Bulbar', region: 'bulbar', motor: true, or: 4.57, lo: 4.01, hi: 5.21, source: 'mei2022' },
  tongue_fasciculations:{ label: 'Tongue fasciculations', plain: 'small twitches in the tongue', group: 'Bulbar', region: 'bulbar', motor: true, or: 1.29, lo: 0.93, hi: 1.78, source: 'mei2022' },
  // Limb
  fasciculations:      { label: 'Muscle fasciculations or twitching', plain: 'small muscle twitches', group: 'Limb', region: null, motor: true, or: 40.19, lo: 25.59, hi: 63.13, source: 'mei2022' },
  wasting:             { label: 'Muscle wasting', plain: 'a muscle getting smaller', group: 'Limb', region: null, motor: true, or: 31.02, lo: 19.46, hi: 49.44, source: 'mei2022' },
  foot_drop:           { label: 'Dropped foot', plain: 'the front of the foot catching or dropping', group: 'Limb', region: 'leg', motor: true, or: 14.78, lo: 11.33, hi: 19.28, source: 'mei2022' },
  focal_weakness:      { label: 'Focal weakness', plain: 'weakness in one part of the body', group: 'Limb', region: null, motor: true, or: 14.00, lo: 12.20, hi: 16.07, source: 'mei2022' },
  falls:               { label: 'Falls', plain: 'falls', group: 'Limb', region: 'leg', motor: false, or: 2.70, lo: 2.46, hi: 2.97, source: 'mei2022' },
  cramp:               { label: 'Cramp', plain: 'muscle cramps', group: 'Limb', region: null, motor: false, or: 1.54, lo: 1.35, hi: 1.76, source: 'mei2022' },
  stiffness:           { label: 'Muscle stiffness', plain: 'stiff muscles', group: 'Limb', region: null, motor: false, or: 1.53, lo: 1.15, hi: 2.03, source: 'mei2022' },
  // Respiratory
  tiredness:           { label: 'Tiredness', plain: 'tiredness', group: 'Respiratory', region: 'general', motor: false, or: 1.08, lo: 0.98, hi: 1.20, source: 'mei2022' },
  short_breath:        { label: 'Shortness of breath', plain: 'shortness of breath', group: 'Respiratory', region: 'breathing', motor: false, or: 1.00, lo: 0.84, hi: 1.18, source: 'mei2022' },
  dyspnoea:            { label: 'Dyspnoea', plain: 'hard to breathe', group: 'Respiratory', region: 'breathing', motor: false, or: 0.96, lo: 0.84, hi: 1.10, source: 'mei2022' },
  sleep_problems:      { label: 'Sleep problems', plain: 'sleep problems', group: 'Respiratory', region: 'general', motor: false, or: 0.92, lo: 0.83, hi: 1.02, source: 'mei2022' },
  // Cognitive
  hallucinations:      { label: 'Hallucinations', plain: 'hallucinations', group: 'Cognitive', region: 'cognitive', motor: false, or: 1.21, lo: 0.62, hi: 2.35, source: 'mei2022' },
  depression:          { label: 'Depression', plain: 'low mood', group: 'Cognitive', region: 'cognitive', motor: false, or: 1.05, lo: 0.94, hi: 1.18, source: 'mei2022' },
  confusion:           { label: 'Confusion', plain: 'confusion', group: 'Cognitive', region: 'cognitive', motor: false, or: 0.93, lo: 0.71, hi: 1.21, source: 'mei2022' },
  emotional_lability:  { label: 'Emotional lability', plain: 'emotions changing quickly', group: 'Cognitive', region: 'cognitive', motor: false, or: 0.83, lo: 0.55, hi: 1.24, source: 'mei2022' },
  // Supporting
  family_history:      { label: 'Family history of MND/ALS', plain: 'a relative with ALS', group: 'Supporting factor', region: 'other', motor: false, or: 18.04, lo: 7.64, hi: 42.60, source: 'mei2022' },
  appetite_loss:       { label: 'Appetite loss', plain: 'less appetite', group: 'Supporting factor', region: 'general', motor: false, or: 1.26, lo: 0.94, hi: 1.68, source: 'mei2022' },
  // Literature / pilot study
  weight_loss:         { label: 'Weight loss', plain: 'weight loss', group: 'Literature', region: 'general', motor: false, or: 2.20, lo: 1.92, hi: 2.52, source: 'mei2022' },
  ataxia:              { label: 'Ataxia (unsteadiness)', plain: 'unsteadiness', group: 'Pilot study', region: 'leg', motor: false, or: 4.82, lo: 3.58, hi: 6.48, source: 'mei2022' },
  hoarseness:          { label: 'Hoarseness of voice', plain: 'a hoarse voice', group: 'Pilot study', region: 'bulbar', motor: false, or: 3.26, lo: 2.82, hi: 3.77, source: 'mei2022' },
  dysphasia:           { label: 'Dysphasia (difficulty with language)', plain: 'trouble finding or forming words', group: 'Pilot study', region: 'bulbar', motor: false, or: 2.85, lo: 1.92, hi: 4.23, source: 'mei2022' },
  stairs:              { label: 'Difficulty climbing stairs', plain: 'difficulty with stairs', group: 'Pilot study', region: 'leg', motor: true, or: 1.46, lo: 0.77, hi: 2.75, source: 'mei2022' },
  wheeze:              { label: 'Wheeze', plain: 'wheezing', group: 'Pilot study', region: 'breathing', motor: false, or: 1.15, lo: 1.01, hi: 1.32, source: 'mei2022' },
  dry_mouth:           { label: 'Dry mouth', plain: 'dry mouth', group: 'Pilot study', region: 'bulbar', motor: false, or: 0.97, lo: 0.79, hi: 1.20, source: 'mei2022' },
  // Negative controls in the study (kept because they were in the published model)
  constipation:        { label: 'Constipation', plain: 'constipation', group: 'Not supporting factor', region: 'other', motor: false, or: 1.45, lo: 1.31, hi: 1.60, source: 'mei2022' },
  urinary_incontinence:{ label: 'Urinary incontinence', plain: 'bladder leaks', group: 'Not supporting factor', region: 'other', motor: false, or: 1.28, lo: 1.12, hi: 1.47, source: 'mei2022' },
  nocturia:            { label: 'Nocturia', plain: 'passing urine at night', group: 'Not supporting factor', region: 'other', motor: false, or: 1.08, lo: 0.90, hi: 1.30, source: 'mei2022' },
  urinary_retention:   { label: 'Urinary retention', plain: 'trouble passing urine', group: 'Not supporting factor', region: 'other', motor: false, or: 1.06, lo: 0.85, hi: 1.33, source: 'mei2022' },
  urinary_frequency:   { label: 'Urinary frequency increase', plain: 'passing urine more often', group: 'Not supporting factor', region: 'other', motor: false, or: 0.84, lo: 0.73, hi: 0.97, source: 'mei2022' },

  // Home-test finding: not in any published primary-care model, so it is an
  // explicit, wide assumption. Progression is what the Gold Coast criteria need
  // ("progressive motor impairment"), and no coded symptom above measures it.
  home_decline:        { label: 'Home test: decline beyond normal variation (2 weeks in a row)', plain: 'your weekly test score going down by more than normal day-to-day variation', group: 'Home monitoring', region: null, motor: true, or: 3.0, lo: 1.5, hi: 6.0, source: 'assumption' },

  // Pattern findings: no odds ratio. They never change the number; they trigger
  // a rule that sends the patient straight to an EMG referral.
  two_territory_wasting: { label: 'Wasting in two nerve territories of one hand: thumb muscles (median nerve) and first dorsal interosseous (ulnar nerve)', plain: 'muscle loss in the hand that does not fit one trapped nerve', group: 'Pattern sign', region: 'arm', motor: true, or: null, lo: null, hi: null, source: 'eisen2012' },
  split_hand:          { label: 'Split-hand pattern: wasting of the thumb muscles and first dorsal interosseous with the little-finger side (hypothenar) spared', plain: 'a pattern of muscle loss in the hand that does not fit one trapped nerve', group: 'Pattern sign', region: 'arm', motor: true, or: null, lo: null, hi: null, source: 'eisen2012' },
  mimic_test_normal:   { label: 'Test for the suspected look-alike came back normal while weakness persists', plain: 'the test for the first suspected cause came back normal', group: 'Pattern sign', region: null, motor: false, or: null, lo: null, hi: null, source: 'assumption' },
  // Context flag: shown to the doctor with its source, but it never adds weight and never
  // triggers a rule (contextOnly). The evidence is an association with possible recall bias.
  lookalike_surgery:   { label: 'Surgery for a look-alike problem did not help (spine, limb or nerve release) while weakness stayed unexplained', plain: 'an earlier operation that did not fix the weakness', group: 'Context flag', region: null, motor: false, or: null, lo: null, hi: null, source: 'seattle_analysis', contextOnly: true,
    why: 'In the Seattle ALS cohort, spine or limb surgery was 11 times as frequent in the years between first symptom and diagnosis (95% CI 5.0 to 24.2). It is an association with possible recall bias, so it is shown, not scored.' },
  umn_signs:           { label: 'Upper motor neuron signs (brisk reflexes, clonus, Hoffmann sign, upgoing plantar)', plain: 'reflexes that are livelier than expected', group: 'Pattern sign', region: null, motor: false, or: null, lo: null, hi: null, source: 'goldcoast2020' },
};

// Starting point (prior): the chance that an adult is diagnosed with MND within
// 5 years, matching the study window (signs 3 months to 5 years before diagnosis).
// Annual incidence: 2.16 per 100,000 (EURALS crude rate; Mei 2022 quotes it as 2.7)
// up to 5.7 per 100,000 (6,437 cases / 112,003,453 person-years in Mei's own adult
// cohort, whose cases averaged 69.6 years). Over 5 years that is about 1 to 3 in 10,000.
// Younger patients sit at the low end; the range is sampled, not fixed.
export const PRIOR = {
  lo: 1.0e-4,
  hi: 3.0e-4,
  horizonYears: 5,
  label: '1 to 3 in 10,000 adults diagnosed with MND within 5 years',
  sources: ['logroscino2010', 'mei2022'],
};

// Referral line: a values choice, not a statistic. "If you'd accept 9 normal
// EMGs to find 1 real case, the line is 10%." Adjustable in the dashboard.
export const REFERRAL_LINES = [
  { value: 0.03, label: '3%', note: 'accept ~32 normal EMGs per case found' },
  { value: 0.05, label: '5%', note: 'accept ~19 normal EMGs per case found' },
  { value: 0.10, label: '10%', note: 'accept ~9 normal EMGs per case found' },
  { value: 0.20, label: '20%', note: 'accept ~4 normal EMGs per case found' },
];
export const DEFAULT_REFERRAL_LINE = 0.05;

// How long the "unclear" tier may last before it must escalate or step down.
export const UNCLEAR_DEADLINE_WEEKS = 8;
