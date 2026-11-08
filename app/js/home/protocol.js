// Home plan by situation: what to test, how often, and which result triggers which action.
// Pure functions, no DOM, no storage. The shape is the contract in
// plans/home-monitoring-contracts.md. Every rule carries its source; "our rule" marks the
// app's own rules built on a guideline, never a published threshold.
// Sources: research_notes/Home monitoring beyond gyros/rules_by_situation.md and
// everyday_exercises_and_scales.md (their Verification sections), the other notes in that
// folder, and docs/WEARABLES.md (the signal rankings).
//
// situationFrom({ caseFile, asOf, evaluation, opts?, answers? }) -> situation
//   evaluation is evaluateAt(caseFile, asOf, opts) from engine.js; it is computed here
//   when missing. answers (optional) is the same object planFor takes.
// planFor(situation, { devices = [], answers = {} } = {}) -> plan
//   devices: DEVICES ids. answers (all optional): canWalkSafely (boolean),
//   fallsRecently (fell or nearly fell in the last 3 months), walkingAid ('none' | 'cane'
//   | 'walker' | 'wheelchair'), needsArmsToStand (boolean), breathlessLyingFlat (boolean),
//   breathingSymptoms (boolean: morning headaches or daytime sleepiness).
// Added beyond the contract: RULES, QUESTIONS, DEVICES[].signals, situation.signs,
// situation.steppedDown, situation.asOf, trigger.rule, trigger.sourceLabel and
// trigger.basis, passive[].contextOnly (true = never counts toward the score),
// plan.weekInWindow, plan.exercise, and plan.actNow: red flags already known before
// diagnosis, [{ text, urgency: 'today' | 'now', source, sourceLabel }], empty when none.
import { evaluateAt, FINDINGS, UNCLEAR_DEADLINE_WEEKS } from '../engine.js';
import { REGION_LABEL } from '../cases.js';

// ---------- devices ----------
// signals: what each device can bring in (contract signal ids).
export const DEVICES = [
  { id: 'iphone', label: 'iPhone', signals: ['walking_speed', 'step_length', 'double_support', 'walking_asymmetry', 'steps'] },
  { id: 'android', label: 'Android phone', signals: ['steps'] },
  { id: 'apple_watch', label: 'Apple Watch', signals: ['steps', 'six_minute_walk', 'falls', 'spo2', 'respiratory_rate', 'resting_hr'] },
  { id: 'other_watch', label: 'Other smartwatch or fitness band', signals: ['steps', 'spo2', 'respiratory_rate', 'resting_hr'] },
  { id: 'smart_scale', label: 'Bathroom or smart scale', signals: ['weight'] },
  { id: 'bp_cuff', label: 'Blood pressure cuff', signals: ['bp'] },
  { id: 'oximeter', label: 'Fingertip pulse oximeter', signals: ['spo2'] },
  { id: 'dynamometer', label: 'Hand grip dynamometer', signals: [] }, // grip is an active test
  { id: 'none', label: 'None of these', signals: [] },
];

// The questions planFor reads from answers (optional; the view may ask them).
export const QUESTIONS = [
  { id: 'canWalkSafely', text: 'Can you walk on your own without falling, with your usual aid?', options: [{ label: 'Yes', value: true }, { label: 'No', value: false }] },
  { id: 'fallsRecently', text: 'Have you fallen or nearly fallen in the last 3 months?', options: [{ label: 'Yes', value: true }, { label: 'No', value: false }] },
  { id: 'walkingAid', text: 'What do you use to get around?', options: [{ label: 'Nothing', value: 'none' }, { label: 'A cane', value: 'cane' }, { label: 'A walker', value: 'walker' }, { label: 'A wheelchair', value: 'wheelchair' }] },
  { id: 'needsArmsToStand', text: 'Do you need your arms to get up from a chair?', options: [{ label: 'Yes', value: true }, { label: 'No', value: false }] },
  // Asked on its own: breathless lying flat needs help the same day (NICE NG127 1.7.5).
  { id: 'breathlessLyingFlat', text: 'Are you breathless when lying flat?', options: [{ label: 'Yes', value: true }, { label: 'No', value: false }] },
  { id: 'breathingSymptoms', text: 'Do you wake with headaches, or feel very sleepy in the day?', options: [{ label: 'Yes', value: true }, { label: 'No', value: false }] },
];

// ---------- sources (all opened 2026-11-08 by the research notes) ----------
const S = {
  ng42: { url: 'https://www.nice.org.uk/guidance/ng42/chapter/Recommendations', label: 'NICE NG42 (motor neurone disease)' },
  ng42public: { url: 'https://www.nice.org.uk/guidance/ng42/ifp/chapter/If-your-GP-thinks-you-could-have-MND', label: 'NICE NG42, information for the public' },
  ng127: { url: 'https://www.nice.org.uk/guidance/ng127/chapter/Recommendations-for-adults', label: 'NICE NG127 (suspected neurological conditions)' },
  cg32: { url: 'https://www.nice.org.uk/guidance/cg32/chapter/Recommendations', label: 'NICE CG32 (nutrition support)' },
  redflag: { url: 'https://www.mndassociation.org/sites/default/files/public/2022-11/Red-Flag-tool-for-MND.pdf', label: 'MND Association and RCGP red-flag tool' },
  ean: { url: 'https://doi.org/10.1111/ene.16264', label: 'EAN guideline on ALS (Van Damme 2024)' },
  canada: { url: 'https://doi.org/10.1503/cmaj.191721', label: 'Canadian ALS best practice (Shoesmith, CMAJ 2020)' },
  kvam: { url: 'https://doi.org/10.1212/WNL.0000000000207166', label: 'AAN ALS quality measures 2022 (Kvam 2023)' },
  espen: { url: 'https://doi.org/10.1016/j.clnu.2017.09.003', label: 'ESPEN neurology nutrition guideline (Burgos 2018)' },
  progas: { url: 'https://doi.org/10.1016/S1474-4422(15)00104-0', label: 'ProGas gastrostomy cohort (2015)' },
  plowman: { url: 'https://doi.org/10.1111/nmo.12700', label: 'Plowman, EAT-10 in ALS (2016)' },
  judge: { url: 'https://doi.org/10.1080/21678421.2026.2627899', label: 'Judge 2026, timing of communication support' },
  strong: { url: 'https://doi.org/10.1080/21678421.2016.1267768', label: 'Strong 2017, ALS-FTSD criteria (ECAS cut-offs)' },
  goldcoast: { url: 'https://doi.org/10.1016/j.clinph.2020.04.005', label: 'Gold Coast criteria (Shefner 2020)' },
  kings: { url: 'https://doi.org/10.1093/brain/awr351', label: "King's staging (Roche 2012)" },
  ofosu: { url: 'https://doi.org/10.1136/bmjopen-2025-104139', label: 'Ofosu 2025, ALS diagnosis delays in Alberta' },
  montes: { url: 'https://doi.org/10.1080/17482960701435931', label: 'Montes 2007, timed up and go in ALS' },
  macpherson: { url: 'https://doi.org/10.1080/09593985.2026.2700400', label: 'Macpherson 2026, gait speed and walking status in ALS' },
  majmudar: { url: 'https://doi.org/10.1002/mus.24202', label: 'Majmudar 2014, rehabilitation in ALS' },
  hall: { url: 'https://doi.org/10.1159/000548820', label: 'Hall 2025, cramping pain in ALS (review)' },
  taborgray: { url: 'https://doi.org/10.1044/2022_JSLHR-22-00522', label: 'Tabor Gray 2023, maximum phonation time in ALS' },
  taborgraySupp: { url: 'https://doi.org/10.23641/asha.22186408', label: 'Tabor Gray 2023, supplement S1 (cut-off table)' },
  klein: { url: 'https://doi.org/10.3233/JND-221530', label: 'Klein 2023, single-breath count in neuromuscular disease' },
  quarracino: { url: 'https://doi.org/10.3389/fneur.2025.1512357', label: 'Quarracino 2025, orthostatic hypotension in ALS' },
  cochrane: { url: 'https://doi.org/10.1002/14651858.CD005229.pub3', label: 'Cochrane review of exercise in ALS (2013)' },
  ren: { url: 'https://doi.org/10.3389/fneur.2025.1499407', label: 'Ren 2025, exercise meta-analysis in ALS' },
  plowman2023: { url: 'https://doi.org/10.1212/WNL.0000000000206830', label: 'Plowman 2023, respiratory strength training trial' },
  lemmen: { url: 'https://doi.org/10.1111/jns.70005', label: 'Lemmen 2025, home grip in immune neuropathies' },
};

// ---------- the rules table ----------
// stages: where the rule applies. only: an extra condition planFor checks
//   'breathing' = breathing or bulbar involvement, or breathing symptoms; a DEVICES id
//   (for example 'bp_cuff') = the person has that device.
// basis: 'guideline', 'study', or 'our rule' (built on the cited sources).
const rule = (id, row, stages, domain, ifText, thenText, basis, src, more = [], only = null) => ({
  id, row, stages, domain, if: ifText, then: thenText, basis,
  source: src.url, sourceLabel: src.label, sources: [src.url, ...more.map((m) => m.url)], only,
});

export const RULES = [
  // Low suspicion: safety-net only (rules_by_situation.md Table A, A1-A5)
  rule('low-twitching-alone', 'A1', ['low'], 'referral', 'Twitching or cramps on their own, with no weakness, muscle wasting or stiffness', 'Twitching on its own does not usually need a referral (NICE: do not routinely refer). Keep the warning-signs checklist.', 'guideline', { ...S.ng127, label: 'NICE NG127, 1.14.6' }),
  rule('low-progressive-weakness', 'A2', ['low'], 'referral', 'Weakness in an arm, a leg or the neck that slowly gets worse over weeks to months, or speech that gets more slurred', 'See your doctor. They should refer you for a nerve and muscle assessment and name possible motor neurone disease (MND) in the letter.', 'guideline', { ...S.ng127, label: 'NICE NG127, 1.7.5 and 1.13.2; NG42 1.1.4' }, [S.ng42]),
  rule('low-swallowing', 'A3', ['low'], 'referral', 'Any trouble swallowing as well as that weakness or slurred speech', 'The referral should be urgent.', 'guideline', { ...S.ng127, label: 'NICE NG127, 1.7.5 and 1.13.2' }),
  rule('low-breathless', 'A4', ['low'], 'referral', 'Breathless at rest or when lying flat', 'Get help the same day: the referral should be immediate.', 'guideline', { ...S.ng127, label: 'NICE NG127, 1.7.5 and 1.13.2' }),
  rule('low-fast-both-sides', 'A5', ['low'], 'referral', 'Weakness in both arms or both legs that gets worse within 4 weeks', 'Get help the same day: immediate referral for neurological, speech and swallowing, and breathing assessment. This is not the usual ALS pattern, but it is an emergency.', 'guideline', { ...S.ng127, label: 'NICE NG127, 1.7.2' }),

  // Unclear: the 8-week window (B0-B6)
  rule('unclear-already-suspected', 'B0', ['unclear'], 'referral', 'The doctor already suspects MND: a red-flag symptom and a history of it getting worse', 'Skip the 8-week window. Refer now and name MND in the letter.', 'guideline', { ...S.ng42, label: 'NICE NG42, 1.1.4; MND Association red-flag tool' }, [S.redflag]),
  rule('unclear-decline', 'B1', ['unclear'], 'referral', "Two weekly results in a row worse than your own baseline by more than the test's normal variation (its MDC), on the region's main test (finger tapping for the hand and reading aloud for speech, both on the Monitoring page, or for the legs the walking test: the phone walking test on the Monitoring page, or the stopwatch timed walk here when the phone's sensors cannot be used)", 'Progression is documented: refer to neurology for an EMG and name possible MND. The other kit tests are context beside the main tests and do not trigger this on their own.', 'our rule', { ...S.redflag, label: 'Red-flag tool (symptom plus progression, refer); Gold Coast criterion 1; NICE NG127 1.7.5' }, [S.goldcoast, S.ng127]),
  rule('unclear-second-region', 'B2', ['unclear'], 'referral', 'A second body region declines beyond normal variation on its main test (finger tapping for the hand or reading aloud for speech, both on the Monitoring page, or for the legs the phone walking test on the Monitoring page, or the stopwatch timed walk here when the phone sensors cannot be used)', 'Refer urgently for an EMG. The other kit tests are context and do not trigger this on their own.', 'our rule', { ...S.goldcoast, label: "Gold Coast criterion 2 (two regions); King's staging" }, [S.kings]),
  rule('unclear-breathless', 'B3', ['unclear'], 'breathing', 'Breathless at rest or when lying flat (the weekly breathing check)', 'Contact your doctor today: the referral should be immediate, the same day.', 'guideline', { ...S.ng127, label: 'NICE NG127; NG42 table 1' }, [S.ng42]),
  rule('unclear-swallowing', 'B4', ['unclear'], 'swallowing', 'A swallowing score (EAT-10) of 3 or more, or new coughing or choking when drinking', 'Contact your doctor now: treat it as trouble swallowing, which makes the referral urgent. The EAT-10 cut-off comes from people already diagnosed; it is not validated before diagnosis.', 'our rule', { ...S.ng127, label: 'NICE NG127 (any swallowing impairment: urgent); EAT-10 cut-off from Plowman 2016' }, [S.plowman]),
  rule('weight-before-diagnosis', 'B5', ['unclear', 'high'], 'nutrition', 'Weight down 5% or more from your usual weight, without a reason', "Bring the doctor's review forward. The doctor records the weight loss in the notes, where it counts in the score. (NICE CG32 calls more than 10% in 3 to 6 months, or more than 5% with a BMI under 20, malnutrition; Canada's 5 to 10% action level is for diagnosed ALS.)", 'our rule', { ...S.cg32, label: 'NICE CG32 malnutrition criteria; Canadian guideline (5 to 10%, diagnosed ALS)' }, [S.canada]),
  rule('unclear-week-8', 'B6', ['unclear'], 'referral', `No decline beyond normal variation after ${UNCLEAR_DEADLINE_WEEKS} weeks`, 'Step down and keep the warning-signs checklist. No decline seen does not rule out ALS: in 8 weeks most tests catch only fast change.', 'our rule', { ...S.ng127, label: 'NICE NG127 (its referral triggers stay active); the 8-week window is this app\'s rule' }),

  // High: referred, waiting (C1-C6)
  rule('high-not-seen', 'C1', ['high'], 'referral', 'Not seen by neurology within 4 weeks of the referral', 'The doctor calls the neurologist or ALS clinic directly and checks that the letter says "possible MND/ALS".', 'our rule', { ...S.canada, label: 'Canadian guideline (ALS clinic within 4 weeks, expert consensus); NICE NG42 1.1.4; Ofosu 2025' }, [S.ng42, S.ofosu]),
  rule('high-swallowing', 'C2', ['high'], 'swallowing', 'New trouble swallowing, or coughing or choking when drinking', 'Contact your doctor now: the referral should be upgraded to urgent.', 'guideline', { ...S.ng127, label: 'NICE NG127, 1.7.5; counting choking on drinks as trouble swallowing is our mapping (red-flag tool)' }, [S.redflag]),
  rule('high-breathless', 'C3', ['high'], 'breathing', 'Breathless at rest or when lying flat', 'Contact your doctor today: you need an assessment the same day.', 'guideline', { ...S.ng127, label: 'NICE NG127, 1.7.5' }),
  rule('falls-before-diagnosis', 'C4', ['unclear', 'high'], 'mobility', 'Any fall or near-fall', 'Falls-safety advice, and a physiotherapy and occupational therapy referral. (NICE gives this after diagnosis; using it before is our mapping.)', 'our rule', { ...S.ng42, label: 'NICE NG42, 1.10.1' }),
  rule('high-worsening', 'C1b', ['high'], 'referral', 'A weekly test declines beyond normal variation, or a new body region is affected', 'Send the results to the neurologist: progression shown by repeated assessment can move the referral up.', 'our rule', { ...S.goldcoast, label: 'Gold Coast criteria (progression by history or repeated assessment)' }),
  rule('high-support', 'C6', ['high'], 'general', 'Waiting for the specialist', 'You should get information and support while the diagnosis is uncertain or delayed.', 'guideline', { ...S.ng42, label: 'NICE NG42, 1.1.5; NICE public information' }, [S.ng42public]),

  // Diagnosed: the guideline monitoring domains (D1-D10, E1-E12)
  rule('dx-change', 'D1', ['diagnosed'], 'general', 'A significant change between clinic visits, noticed by you, your family or the app', 'Ask the team to bring the next assessment forward.', 'guideline', { ...S.ng42, label: 'NICE NG42, 1.5.7' }),
  rule('dx-weight', 'D2', ['diagnosed'], 'nutrition', 'Weight down 5% or more from your usual weight', 'Dietitian review, diet changes and a talk about a feeding tube. Act before 10%: people who had lost more than 10% by the time of the tube did worse (ProGas). Canada acts at 5 to 10%; the older EFNS advice waited for 10%.', 'guideline', { ...S.canada, label: 'Canadian guideline (5 to 10%, level C); ProGas (authors suggest about 5%)' }, [S.progas]),
  rule('dx-bmi', 'D2b', ['diagnosed'], 'nutrition', 'Body mass index (BMI) down 1 point or more, or under 18.5', 'Dietitian review and a feeding-tube discussion.', 'guideline', { ...S.canada, label: 'Canadian guideline (level B)' }),
  rule('dx-breathing-symptoms', 'E3', ['diagnosed'], 'breathing', 'New breathlessness, breathless lying flat, morning headaches, unrefreshing sleep or daytime sleepiness', 'Tell the team. NICE uses these symptoms, with oxygen and lung tests, to decide on overnight oximetry or a limited sleep study and whether to offer NIV (non-invasive ventilation).', 'guideline', { ...S.ng42, label: 'NICE NG42, table 1, 1.15.12, 1.15.14 and table 2' }),
  rule('dx-spo2', 'E1', ['diagnosed'], 'breathing', 'Resting blood oxygen (SpO2) 94% or less on room air (92% or less with known lung disease)', 'The team arranges a blood gas test. Some pulse oximeters read too low or too high, especially near the borderline, and over-reading has been reported in people with dark skin, so a home reading is a prompt, not a result.', 'guideline', { ...S.ng42, label: 'NICE NG42, 1.15.11 (and the note at 1.15.8)' }, [], 'breathing'),
  rule('dx-fvc', 'E5', ['diagnosed'], 'breathing', 'Lung capacity (FVC) under 65% sitting upright without symptoms, or under 80% with symptoms such as breathlessness lying flat', 'Discuss NIV. Canada advises starting it within 4 weeks, sooner if severely symptomatic. NICE uses under 50% without symptoms; this uses the more cautious Canadian level. Confirm home readings with a clinic test.', 'guideline', { ...S.canada, label: 'Canadian guideline (levels B, C and expert consensus); NICE NG42 table 2' }, [S.ng42], 'breathing'),
  rule('dx-fvc-tube', 'E9', ['diagnosed'], 'nutrition', 'Lung capacity (FVC) approaching 50%', 'Consider a feeding tube even without swallowing trouble. If breathing is weak, start NIV first and place the tube with NIV in place.', 'guideline', { ...S.canada, label: 'Canadian guideline (level C); EAN guideline (++)' }, [S.ean], 'breathing'),
  rule('dx-cough', 'E6', ['diagnosed'], 'breathing', 'Peak cough flow under 270 L/min, or trouble clearing phlegm', 'Lung volume recruitment and manual assisted cough first; a cough-assist machine (mechanical insufflation-exsufflation) twice daily, more often during a chest infection.', 'guideline', { ...S.canada, label: 'Canadian guideline (lung volume recruitment level C; the rest expert consensus); NICE NG42 1.14.1-1.14.4' }, [S.ng42], 'breathing'),
  rule('dx-mpt-10', 'MPT', ['diagnosed'], 'breathing', 'Longest "aah" (maximum phonation time) 10 seconds or less', 'Ask the team to measure peak cough flow and review cough help. In one ALS study, 10 seconds or less found a peak cough flow of 160 L/min or less with sensitivity 0.88 and specificity 0.82. The cut-off is our pick from that table, not a guideline.', 'our rule', { ...S.taborgraySupp, label: 'Tabor Gray 2023, supplement S1' }, [S.taborgray], 'breathing'),
  rule('dx-mpt-8-sbc', 'MPT/SBC', ['diagnosed'], 'breathing', 'Longest "aah" 8 seconds or less, or a one-breath count under 39', 'Ask the team to check vital capacity (and overnight oximetry) and discuss NIV. These cut-offs come from one ALS study and one mixed neuromuscular study, not a guideline.', 'our rule', { ...S.taborgraySupp, label: 'Tabor Gray 2023 (FVC 50% or less: specificity 0.90); Klein 2023 (NIV indication: sensitivity 0.92)' }, [S.taborgray, S.klein], 'breathing'),
  rule('dx-eat10-3', 'D4', ['diagnosed'], 'swallowing', 'A swallowing score (EAT-10) of 3 or more, or new coughing or choking when eating or drinking', 'Swallow assessment by a speech-language pathologist, with a videofluoroscopy or FEES study if available. The AAN quality measures refer on the day of a positive screen.', 'guideline', { ...S.kvam, label: 'AAN quality measures 2022; ESPEN rec 8; Plowman 2016; NICE NG42 1.11.4' }, [S.espen, S.plowman, S.ng42]),
  rule('dx-eat10-8', 'E8', ['diagnosed'], 'swallowing', 'EAT-10 of 8 or more', 'High risk of food or drink going into the airway: texture changes, a swallow study and a feeding-tube discussion. In 70 people with ALS, 8 or more found aspiration with sensitivity 86% and specificity 72%.', 'study', { ...S.plowman, label: 'Plowman 2016 (70 people with ALS, against videofluoroscopy)' }),
  rule('dx-speech', 'D7', ['diagnosed'], 'speech', 'Any change in speech, or you want help with communication', 'Speech-language therapy assessment and communication aids without delay. Ask about voice or message banking early: it took 7 to 65 weeks in one study.', 'guideline', { ...S.ng42, label: 'NICE NG42, 1.12.1-1.12.2; Canadian guideline (expert consensus); Judge 2026' }, [S.canada, S.judge]),
  rule('dx-speech-decline', 'E11b', ['diagnosed'], 'speech', 'Syllable repetition or reading speed falls beyond normal variation two weeks in a row', 'Speech-language therapy review; discuss communication aids early, including message or voice banking.', 'our rule', { ...S.ean, label: 'EAN 2024 (speech therapy and communication aids without delay)' }),
  rule('dx-speaking-rate', 'E11', ['diagnosed'], 'speech', 'Reading speed under about 120 words per minute (North American speakers) as a steady trend, not one reading (one clinic used 100 words per minute or intelligibility under 90%)', 'Communication-aid (AAC) assessment; eye-gaze needs go to a specialised AAC hub.', 'study', { ...S.judge, label: 'Judge 2026 systematic review; NICE NG42 1.12.3' }, [S.ng42]),
  rule('dx-foot-drop-falls', 'D8', ['diagnosed'], 'mobility', 'Foot drop or a fall', 'Ankle-foot brace (orthosis) referral without delay, a walking aid and physiotherapy, with falls-safety advice.', 'guideline', { ...S.ng42, label: 'NICE NG42, 1.8.9 and 1.10.1-1.10.6' }),
  rule('dx-tug-14', 'D8b', ['diagnosed'], 'mobility', 'Timed up and go of 14 seconds or more', 'Mobility-aid and falls review. The 14-second mark comes from one small study (31 people, abstract only).', 'study', { ...S.montes, label: 'Montes 2007' }),
  rule('dx-gait-08', 'D8c', ['diagnosed'], 'mobility', 'Walking speed below about 0.8 m/s', 'Talk about a wheelchair and other mobility aids. Our suggestion from one chart review of 72 people: below 0.79 m/s went with losing walking within 6 months, with modest accuracy.', 'our rule', { ...S.macpherson, label: 'Macpherson 2026' }),
  rule('dx-hand', 'D10', ['diagnosed'], 'hand', 'Losing dexterity for eating, dressing, writing, or using a phone or computer', 'Occupational therapy, equipment and assistive technology without delay. No guideline gives a number for this.', 'guideline', { ...S.ng42, label: 'NICE NG42, 1.10.1-1.10.3 and 1.11.3' }),
  rule('dx-grip-drop', 'Grip', ['diagnosed'], 'hand', 'Grip (the mean of 3 squeezes) more than about 23% below your own baseline, two weeks in a row', 'Hand-function review with the occupational therapist: grip aids, splints, adapted utensils, and phone and keyboard access. The 23% is normal variation worked out from home grip in another nerve disease, not measured in ALS.', 'our rule', { ...S.lemmen, label: 'Lemmen 2025 (home grip SEM 8.46%; MDC about 23%, computed by us)' }, [], 'dynamometer'),
  rule('dx-cognition', 'D6', ['diagnosed'], 'cognition', 'You or your family notice changes in thinking or behaviour, or the clinic screen (ECAS) is at or near its published cut-off (105 of 136 overall, or 77 of 100 on the ALS-specific part; 105 to 110 and 77 to 82 are borderline)', 'Tell the team: they can arrange a formal assessment, adapt how decisions and consent are handled, and help you plan ahead.', 'guideline', { ...S.ng42, label: 'NICE NG42, 1.3.2; Canadian guideline (screen early, level B); Strong 2017 (cut-offs)' }, [S.canada, S.strong]),
  rule('dx-exercise-dose', 'D9', ['diagnosed'], 'exercise', 'Tiredness or pain after exercise that lasts more than 30 minutes, or gets in the way of daily activities', 'Lower the dose and tell your physiotherapist.', 'guideline', { ...S.canada, label: 'Canadian guideline (moderate exercise level B; the 30-minute rule); Majmudar 2014; NICE NG42 1.8.5-1.8.6' }, [S.majmudar, S.ng42]),
  rule('dx-exercise-pause', 'D9b', ['diagnosed'], 'exercise', 'New falls, new breathlessness, or breathless lying flat', 'Pause exercise and tell the clinic. (Our addition: NICE lists these as signs that need review, not as exercise advice.)', 'our rule', { ...S.ng42, label: 'NICE NG42 (signs that need review)' }),
  rule('dx-cramps', 'D9c', ['diagnosed'], 'exercise', 'Cramps that keep getting worse', 'Exercise with a physiotherapist rather than alone at home: in a review of 9 studies, supervised programmes eased cramp pain and home programmes did not. (Our addition, built on that review.)', 'our rule', { ...S.hall, label: 'Hall 2025 (systematic review)' }),
  rule('dx-orthostatic', 'BP', ['diagnosed'], 'general', 'Dizzy on standing: take a lying-then-standing reading. It counts if the top number falls more than 20 or the bottom number more than 10 mmHg within 3 minutes of standing up', 'Repeat the reading first: single readings are unreliable (only 22.5% still had the drop at a later visit). Then ask the team for a medicine and fluid review. Blood pressure never counts toward the ALS score.', 'our rule', { ...S.quarracino, label: 'Quarracino 2025 (definition and repeat rate)' }, [], 'bp_cuff'),
  rule('dx-end-of-life', 'E12', ['diagnosed'], 'general', 'A feeding tube or NIV becomes needed, or breathing changes significantly', 'The team should offer a talk about end-of-life care and advance care planning.', 'guideline', { ...S.ng42, label: 'NICE NG42, 1.7.1' }),
];

// ---------- helpers ----------
const MOTOR = ['arm', 'leg', 'bulbar', 'breathing'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY = 86400000;
const toTime = (d) => Date.parse(String(d).slice(0, 10) + 'T00:00:00Z');
// "2026-07-14" -> "14 Jul 2026", read as a calendar date (never shifted by time zone).
function fmtDate(d) {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(String(d || ''));
  if (!m) return String(d || '');
  return [m[3] ? String(Number(m[3])) : null, MONTHS[Number(m[2]) - 1], m[1]].filter(Boolean).join(' ');
}
const label = (r) => REGION_LABEL[r] || r;
// "The whole range..." -> "the whole range..." after a colon; acronyms such as "ALS" stay.
const lowerFirst = (s) => (/^[A-Z][a-z]/.test(String(s)) ? String(s).charAt(0).toLowerCase() + String(s).slice(1) : String(s));
const asArray = (x) => (x instanceof Set ? [...x] : Array.isArray(x) ? x : []);
const ordered = (set) => MOTOR.filter((r) => set.has(r));

// Findings on or before asOf: the engine's own list when there is one, else the case file.
function findingsOf(caseFile, asOf, ev) {
  const inst = ev?.state?.instances;
  if (Array.isArray(inst)) return inst.map((i) => ({ id: i.id, region: i.region || FINDINGS[i.id]?.region || null }));
  const out = [];
  for (const enc of caseFile?.encounters || []) {
    if (asOf && enc.date > asOf) continue;
    for (const f of enc.findings || []) out.push({ id: f.id, region: f.region || FINDINGS[f.id]?.region || null });
  }
  return out;
}

// ---------- situation ----------
export function situationFrom({ caseFile, asOf, evaluation, opts, answers } = {}) {
  answers = answers || {};
  let ev = evaluation;
  if (!ev && caseFile && asOf) ev = evaluateAt(caseFile, asOf, opts || {});
  ev = ev || {};
  const date = asOf || ev.asOf || null;
  const tier = ev.tier || 'low';
  const dx = caseFile?.actual?.diagnosis ? String(caseFile.actual.diagnosis).slice(0, 10) : null;
  const diagnosed = Boolean(dx && (date ? dx <= date : true));
  const stage = diagnosed ? 'diagnosed' : (['low', 'unclear', 'high'].includes(tier) ? tier : 'low');

  // Regions: the engine's motor regions plus the regions of motor findings.
  const findings = findingsOf(caseFile, date, ev);
  const regions = new Set(asArray(ev.state?.motorRegions).filter((r) => MOTOR.includes(r)));
  for (const f of findings) if (FINDINGS[f.id]?.motor && MOTOR.includes(f.region)) regions.add(f.region);
  const affectedRegions = ordered(regions);
  const otherRegions = MOTOR.filter((r) => !regions.has(r));

  const ids = new Set(findings.map((f) => f.id));
  const signs = {
    breathing: ids.has('short_breath') || ids.has('dyspnoea'),
    swallowing: ids.has('dysphagia'),
    speech: ids.has('dysarthria'),
    falls: ids.has('falls'),
    footDrop: ids.has('foot_drop'),
    weightLoss: ids.has('weight_loss'),
  };

  // Weeks since the case became unclear, counted to asOf (whole weeks, 0 in the first week).
  let weekInWindow = null;
  if (stage === 'unclear') {
    let weeks = Number.isFinite(ev.weeksUnclear) ? ev.weeksUnclear : null;
    if (ev.unclearSince && date && date >= ev.unclearSince) weeks = (toTime(date) - toTime(ev.unclearSince)) / (7 * DAY);
    weekInWindow = weeks == null ? null : Math.max(0, Math.floor(weeks + 1e-9));
  }

  // Walking safety: the person's answer wins; falls or foot drop without an answer means "not yet".
  let canWalkSafely = null;
  if (typeof answers.canWalkSafely === 'boolean') canWalkSafely = answers.canWalkSafely;
  else if (answers.walkingAid === 'wheelchair') canWalkSafely = false;
  else if (signs.falls || signs.footDrop || answers.fallsRecently === true) canWalkSafely = false;

  const reasons = [];
  const when = fmtDate(ev.asOf || date);
  const visits = (caseFile?.encounters || []).filter((e) => !date || e.date <= date).length;
  if (diagnosed) reasons.push(`Diagnosed on ${fmtDate(dx)}, so the plan follows the after-diagnosis guidelines.`);
  else if (!ev.tier) reasons.push('No evaluation yet (no case or no date to score), so only the warning-signs checklist applies.');
  else reasons.push(`${when ? `On ${when} the` : 'The'} score puts this case in the "${tier}" tier: ${lowerFirst(ev.reason || 'no reason given')}.`);
  if (!visits && !diagnosed) reasons.push('No visits are recorded yet, so there are no findings to score.');
  if (ev.steppedDown && !diagnosed) reasons.push('At the 8-week review the home tests showed no decline, so the case stepped down. No decline seen does not rule out ALS.');
  reasons.push(affectedRegions.length ? `Motor signs so far: ${affectedRegions.map(label).join(', ')}.` : 'No motor signs recorded yet.');
  if (stage === 'unclear') {
    if (weekInWindow == null) reasons.push('The 8-week window has started; its start date is not known.');
    else if (weekInWindow >= UNCLEAR_DEADLINE_WEEKS) reasons.push(`The ${UNCLEAR_DEADLINE_WEEKS} weeks are up (unclear since ${fmtDate(ev.unclearSince)}): time for the week-8 decision.`);
    else reasons.push(`Week ${weekInWindow + 1} of the ${UNCLEAR_DEADLINE_WEEKS}-week window${ev.unclearSince ? ` (unclear since ${fmtDate(ev.unclearSince)})` : ''}.`);
  }
  if (signs.breathing) reasons.push('Breathing symptoms are in the notes (for example breathless lying flat).');
  if (answers.canWalkSafely === false) reasons.push('You said you cannot walk safely on your own, so walking and chair tests are left out.');
  else if (canWalkSafely === false) {
    reasons.push(answers.walkingAid === 'wheelchair'
      ? 'You use a wheelchair, so walking and chair tests are left out.'
      : signs.falls || signs.footDrop
        ? 'Falls or foot drop are recorded in the notes, so walking and chair tests stay off until you say you can walk safely.'
        : 'You said you have fallen or nearly fallen in the last 3 months, so walking and chair tests stay off until you say you can walk safely.');
  }

  return {
    stage, tier, diagnosed, affectedRegions, otherRegions, weekInWindow, canWalkSafely, reasons,
    signs, steppedDown: Boolean(ev.steppedDown && !diagnosed), asOf: date,
  };
}

// ---------- plan items ----------
const WALK_SAFETY = [
  'Have someone beside you if you have fallen or nearly fallen in the last 3 months, or use a walking aid.',
  'Clear the path, and wear the same shoes, brace and aid every week.',
  'Stop if you feel dizzy, breathless, unsteady, in pain or cramping.',
];
const CHAIR_SAFETY = [
  'Use a sturdy chair with arms, against a wall.',
  'Skip it if you need your arms to get up.',
  'Stop if you feel dizzy, breathless, unsteady, in pain or cramping.',
];
const BREATH_SAFETY = ['Sit upright. Stop if you feel dizzy or breathless.'];
const WALKING_TESTS = new Set(['timed_walk_speed', 'tug_time', 'sts30', 'sts5_time']);

// Plain-words reasons, by item and use. Numbers trace to the notes named in the header.
const WHY = {
  typing_speed: {
    region: 'Copy-typing a short sentence tracks hand speed. In one study typing picked out mild hand weakness well, but its normal week-to-week variation is not known yet, so it is a trend to show the doctor.',
    screen: 'A quick typing check watches for weakness spreading to the hands.',
  },
  grip: { region: 'Grip strength with your own dynamometer: three squeezes per hand, and the app keeps the mean. Normal week-to-week variation is about 23% of your own value (worked out from a home study in another nerve disease), so only a clear drop counts.' },
  timed_walk_speed: {
    region: 'Walking speed over a measured 10 m is the top-ranked home test for the legs, with a published normal variation (about 0.28 m/s in healthy people and 0.18 m/s in people with ALS, WatchALS). The score counts the phone walking test on the Monitoring page, which times the same walk with the phone motion sensors; use this stopwatch version when the phone cannot be carried.',
    screen: 'A timed walk watches for weakness spreading to the legs.',
    dx: 'Walking speed responds to change over months and ties to walking-aid decisions; below about 0.8 m/s, talk about mobility aids (our suggestion from one study).',
  },
  sts30: { dx: 'The 30-second chair stand adds leg strength as context. It has not been studied in ALS; in other groups its normal variation is about 4 stands.' },
  tug_time: { dx: 'The timed up and go links walking to falls: 14 seconds or more is a published prompt to review walking aids (one small ALS study), and each extra second raised the odds of a fall in another ALS study. Monthly, as in that first study.' },
  // Before diagnosis it is context only: the reading test is the main speech test.
  ddk_rate: {
    region: 'Syllable repetition (pa-ta-ka) is a second speech measure beside the reading test. In WatchALS\'s 15-second iPhone version, week-to-week variation was about 1 syllable a second; this 10-second browser version is not validated. Context only: it backs up the reading test and never triggers a referral on its own.',
    screen: 'Syllable repetition looks for speech changes beside the reading test. Context only and not validated: it never triggers a referral on its own.',
    dx: 'Syllable repetition tracks speech between clinic visits; a fall beyond normal variation two weeks running prompts a speech-therapy review.',
    dxScreen: 'Syllable repetition watches for speech changes, a sign that weakness is spreading to speech and swallowing.',
  },
  pause_pct: { region: 'Pauses while reading aloud come from the same recording as the reading test. In one study the share of pauses picked up speech changes people had not yet noticed; its home variation is not known yet.' },
  eat10: {
    region: 'The swallowing questionnaire: a score of 3 or more, or new coughing when drinking, makes the referral urgent. Its cut-offs come from people already diagnosed.',
    dxBulbar: 'The swallowing questionnaire every 2 weeks while speech or swallowing is affected: 3 or more prompts a swallow assessment, and 8 or more points to a risk of food or drink going into the airway.',
    dxScreen: 'A monthly swallowing check (guidelines screen swallowing at least every 3 months): 3 or more prompts a swallow assessment.',
  },
  mpt: { dx: 'Holding "aah" as long as you can is a rough breathing check: 10 seconds or less went with a weak cough in one ALS study, so it prompts a real cough-flow test. It depends on effort, so it never replaces lung tests.' },
  single_breath_count: { dx: 'Counting aloud on one breath is a rough lung-capacity check: under 39 went with needing NIV in a neuromuscular study, so it prompts a vital-capacity test. Speech problems may lower it too.' },
  breathing_symptoms: {
    weekly: 'A short check of the breathing symptoms NICE lists: breathless lying flat, morning headaches, poor sleep, daytime sleepiness. Breathless at rest or lying flat needs same-day help.',
    dx: 'A short weekly check of the breathing symptoms NICE lists: breathless lying flat, morning headaches, poor sleep, daytime sleepiness. New or worse symptoms: tell your team straight away; they decide on oxygen and lung tests and NIV.',
    dxScreen: 'A monthly breathing-symptoms check, so new breathing trouble is not missed between clinic visits.',
  },
  falls_week: {
    pre: 'One question each week: any falls or near-falls. Falls are common in ALS (47% of people who walk fell within 3 months in one study), and any fall prompts falls advice and physiotherapy.',
    dx: 'One question each week: any falls or near-falls. Each fall prompts falls advice, a brace or walking-aid review and physiotherapy.',
  },
  weight: {
    pre: 'Weigh yourself weekly on the same scale at the same time of day. A loss of 5% or more without a reason brings the doctor\'s review forward; a change under about 2.4 kg between two weighings can be normal variation.',
    dx: 'Weight is the most useful home measure after diagnosis: a 5% loss prompts a dietitian review and a feeding-tube talk, well before 10%.',
  },
};

const ITEM_SAFETY = {
  timed_walk_speed: WALK_SAFETY,
  tug_time: ['Sit in a sturdy armchair against a wall; a helper starts and stops the timer.', ...WALK_SAFETY],
  sts30: CHAIR_SAFETY,
  sts5_time: CHAIR_SAFETY,
  mpt: BREATH_SAFETY,
  single_breath_count: BREATH_SAFETY,
};

const KIND = { weight: 'signal', eat10: 'question', breathing_symptoms: 'question', falls_week: 'question' };
const PRACTICE = new Set(['typing_speed', 'grip', 'timed_walk_speed', 'sts30', 'sts5_time', 'tug_time', 'ddk_rate', 'pause_pct', 'mpt', 'single_breath_count']);

// ---------- passive device items ----------
// Ordered by docs/WEARABLES.md rank: early referral (pre) and monitoring (dx).
// contextOnly: never counts toward the score (WEARABLES.md route 3). Only weight and a
// recorded fall are route 2: they prompt the clinician to record a note finding.
const ROUTE2 = new Set(['weight', 'falls']);
const PASSIVE = [
  { signal: 'weight', devices: ['smart_scale'], pre: 4, dx: 1, why: 'The scale fills in the weekly weight. Use the same scale at the same time of day every week.' },
  { signal: 'spo2', devices: ['apple_watch', 'other_watch'], pre: 17, dx: 3, why: 'Overnight blood oxygen from a watch. Context only: consumer readings need a clinic check, and breathing rarely comes first in ALS.', whyDx: 'Overnight oxygen dips can show weak breathing at night before daytime tests do; a low trend prompts clinic oximetry. Context only.' },
  { signal: 'spo2', devices: ['oximeter'], pre: 17.5, dx: 3.5, why: 'Fingertip oximeter spot checks: context only.', whyDx: 'Context only, never part of a score: a resting reading of 94% or less on room air (92% with known lung disease) is the NICE prompt for the team to arrange a blood gas test. Oximeters can read high or low, so a home reading is a prompt, not a result.' },
  { signal: 'steps', devices: ['iphone', 'android', 'apple_watch', 'other_watch'], pre: 10, dx: 6, why: 'Daily steps: context only. Seasons, holidays and a new cane move them more than 8 weeks of change.', whyDx: 'Daily steps: context only. An effortless trend over months, shown beside the tests.' },
  { signal: 'walking_speed', devices: ['iphone'], pre: 7, dx: 18, why: 'Your iPhone records walking speed as you go about your day, often for years. Import the history at the start so the weeks before the visit can be a baseline. Context only: untested in ALS.', whyDx: 'An effortless walking-speed trend. Context only: untested in ALS, and it stops in wheelchair mode.' },
  { signal: 'falls', devices: ['apple_watch'], pre: 8, dx: 11, why: 'Fall Detection records falls but misses many, so the weekly falls question still matters; under age 55 it is on by default only during workouts, so check that it is switched on. A recorded fall prompts the doctor to ask and write it down.' },
  { signal: 'six_minute_walk', devices: ['apple_watch'], pre: 15, dx: 19, why: 'Apple Watch estimates a six-minute walk distance each week. Context only: it blurs change over 4 weeks.' },
  { signal: 'step_length', devices: ['iphone'], pre: 16, dx: 24, why: 'iPhone step length: context only; weak evidence in ALS.' },
  { signal: 'double_support', devices: ['iphone'], pre: 16.1, dx: 24.1, why: 'iPhone double-support time: context only; noisy, with weak evidence in ALS.' },
  { signal: 'walking_asymmetry', devices: ['iphone'], pre: 16.2, dx: 24.2, why: 'iPhone walking asymmetry: context only; noisy, with weak evidence in ALS.' },
  { signal: 'respiratory_rate', devices: ['apple_watch', 'other_watch'], pre: 24, dx: 16, why: 'Breathing rate at night: context only; infections and other causes move it.' },
  { signal: 'resting_hr', devices: ['apple_watch', 'other_watch'], pre: 26, dx: 20, why: 'Resting heart rate: context only. It does not help find ALS.', whyDx: 'Resting heart rate: context only. A sustained rise can prompt a check for infection or weak breathing.' },
  { signal: 'bp', devices: ['bp_cuff'], pre: 31, dx: 31, why: 'Blood pressure: context only. It does not help find ALS and never counts toward the score. Use a validated upper-arm cuff.', whyDx: 'Blood pressure: context only, never part of the ALS score. If you feel dizzy on standing, a lying-then-standing reading can show a drop worth a medicine review.' },
];

function passiveFor(stage, devices) {
  const have = new Set(devices);
  const key = stage === 'diagnosed' ? 'dx' : 'pre';
  return PASSIVE.map((p) => ({ p, device: p.devices.find((d) => have.has(d)) }))
    .filter((x) => x.device)
    .sort((a, b) => a.p[key] - b.p[key])
    .map(({ p, device }) => ({ signal: p.signal, device, why: (stage === 'diagnosed' && p.whyDx) || p.why, contextOnly: !ROUTE2.has(p.signal) }));
}

// ---------- plan text ----------
const HEADLINE = {
  low: 'No home tests needed now: know the warning signs',
  unclear: 'Weekly checks for 8 weeks to settle an unclear case',
  high: 'Referred: keep the weekly checks going while you wait',
  diagnosed: 'Home checks between clinic visits',
};
// The first 2 lines are shared with the diagnosed plan; the rest are for before diagnosis.
const COMMON_SAFETY = [
  'Never instead of a referral: these checks never replace seeing your doctor or clinic.',
  'Stop any test if you feel dizzy, breathless, unsteady, in pain or cramping. Tell your clinic about any fall.',
  'Breathless at rest or when lying flat: get medical help the same day.',
  'New trouble swallowing, or coughing or choking when you drink: contact your doctor now. With suspected MND this makes the referral urgent.',
];
const SAFETY_NET = [
  'See your doctor if weakness in an arm, a leg or the neck gets worse over weeks, or spreads.',
  'See your doctor if a muscle visibly shrinks, or your speech becomes slurred or quieter.',
  'See your doctor soon if you have trouble swallowing or choke when drinking quickly.',
  'Breathless when lying flat or at rest: get help the same day.',
  'Tell your doctor about falls or trips.',
  'Twitching on its own, with normal strength, usually does not need a referral.',
];
// legs: the legs are affected and the timed walk is in the plan, so it is their main test.
const existingTests = (legs) => 'Keep doing the finger-tapping test (both hands) and the reading test on the Monitoring page each week: with Home data on, they are the hand and speech tests the score uses. '
  + (legs ? 'For the legs, the main test is the walking test: the phone walking test on the Monitoring page, or the timed walk in this plan when the phone sensors cannot be used (the score counts only the phone test, so one walk is never counted twice). The other kit tests add detail beside these.' : 'The kit tests here add detail beside them.');
// What the view does with an import: it keeps the readings from 12 weeks before the first visit on.
const HISTORY = 'At the start, bring in any stored history (an Apple Health export, or a CSV file from your scale\'s or watch\'s app). Imports keep only the readings from 12 weeks before the first visit onward (from 12 weeks before today when there is no visit yet), so data from years before the visit cannot set the baseline: old data from an injury or a holiday could lock in a false trend.';
const PRACTICE_NOTE = 'The first 2 sessions of each new test (1 for grip) are practice and do not count toward its baseline.';
const LEGS_UNCOVERED = 'Walking and chair tests are off for safety, so the legs have no home test: the weekly falls question and your doctor\'s examination cover them.';

// Exercise advice after diagnosis (everyday_exercises_and_scales.md sections 5 and 6).
function exerciseFor({ wheelchair, usesAid, unsteady }) {
  const advice = [
    'Ask the clinic physiotherapist for an exercise programme made for you. In early ALS, regular moderate exercise is probably helpful and not harmful (Canadian guideline, level B), though the trials are small.',
    'Moderate means you sweat a little and breathe harder but can still talk comfortably.',
    'Aerobic: a recumbent (seated) bike rather than a treadmill, because of the risk of falling. Start with 10-minute bouts 2 to 3 times a week and build up slowly.',
    'Strength: light weights only, one you could lift comfortably 20 times, done as 2 to 3 sets of 10. Do not train muscles that cannot lift against gravity, and avoid slow lowering under load.',
    'Stretch every day to keep joints moving. Balance training only with a physiotherapist.',
    'Breathing-muscle training raised breathing-out pressure in one trial but did not change lung capacity; it needs the clinic to set the load.',
  ];
  if (wheelchair) advice.push('Using a wheelchair: daily passive stretches with a carer, night splints and positioning; ask the physiotherapist about assisted standing. No exercise trial included wheelchair users.');
  else {
    if (usesAid) advice.push('Using a cane or walker: an active-assisted programme with a carer, daily range-of-motion exercise, and energy-saving advice from the occupational therapist.');
    if (unsteady) advice.push('With falls or foot drop: swap walking exercise for seated or recumbent cycling, and keep resistance light.');
  }
  return {
    advice,
    warningSigns: [
      'Tiredness or pain lasting more than 30 minutes after exercise, or getting in the way of daily life: the programme needs changing.',
      'New falls, new breathlessness, or breathless lying flat: pause and tell the clinic.',
      'Cramps that keep getting worse: exercise with a physiotherapist rather than alone.',
    ],
    sources: [S.canada.url, S.majmudar.url, S.ng42.url, S.cochrane.url, S.ren.url, S.plowman2023.url, S.hall.url],
  };
}

// ---------- act now: red flags already known before diagnosis ----------
// NICE NG127 1.7.5 and 1.13.2: with weakness or slurred speech that is getting worse, refer
// immediately for breathlessness at rest or lying flat, urgently for any trouble swallowing.
// NG42 1.1.2 lists morning headaches and daytime sleepiness as effects of weak breathing.
const NG127_RED = { url: S.ng127.url, label: 'NICE NG127, 1.7.5 and 1.13.2' };
const NG42_EARLY = { url: S.ng42.url, label: 'NICE NG42, 1.1.2' };
const NICE_BREATH = 'With weakness or slurred speech that is getting worse, NICE says breathlessness at rest or when lying flat needs an immediate referral.';
function actNowFor(sit, ans) {
  const out = [];
  const flat = ans.breathlessLyingFlat === true;
  const noted = Boolean(sit.signs?.breathing);
  const night = ans.breathingSymptoms === true;
  if (flat || noted || night) {
    const text = [
      flat && 'You said you are breathless when lying flat.',
      noted && 'Breathlessness is recorded in the notes.',
      night && 'You said you wake with headaches or feel very sleepy in the day, which can be effects of weak breathing.',
      // A note can mean breathless on effort, so it asks; the person's own answer does not.
      flat || night ? 'Contact your doctor today.' : 'If you are breathless at rest or when lying flat, contact your doctor today.',
      (flat || noted) && NICE_BREATH,
    ].filter(Boolean).join(' ');
    const src = flat || noted ? NG127_RED : NG42_EARLY;
    out.push({ text, urgency: 'today', source: src.url, sourceLabel: src.label });
  }
  if (sit.signs?.swallowing) {
    out.push({
      text: 'Trouble swallowing is recorded in the notes: contact your doctor now. With weakness or slurred speech that is getting worse, NICE says any trouble swallowing makes the referral urgent.',
      urgency: 'now', source: NG127_RED.url, sourceLabel: NG127_RED.label,
    });
  }
  return out;
}

// ---------- the plan ----------
export function planFor(situation, { devices = [], answers = {} } = {}) {
  const sit = situation || {};
  const stage = ['low', 'unclear', 'high', 'diagnosed'].includes(sit.stage) ? sit.stage : 'low';
  const ans = answers || {};
  const devs = (Array.isArray(devices) ? devices : []).filter((d) => d !== 'none');
  const affected = new Set(asArray(sit.affectedRegions).filter((r) => MOTOR.includes(r)));
  const wheelchair = ans.walkingAid === 'wheelchair';
  // The same order as situationFrom: the person's answer, a wheelchair, the situation,
  // then a recent fall with no answer yet (off until they say they can walk safely).
  const walkSafe = typeof ans.canWalkSafely === 'boolean' ? ans.canWalkSafely
    : wheelchair ? false
      : typeof sit.canWalkSafely === 'boolean' ? sit.canWalkSafely
        : ans.fallsRecently === true ? false : null;
  const walkingOff = walkSafe === false || wheelchair;
  const fell = Boolean(sit.signs?.falls || ans.fallsRecently === true);
  const footDrop = Boolean(sit.signs?.footDrop);
  const usesAid = ans.walkingAid === 'cane' || ans.walkingAid === 'walker';
  const breathingInvolved = affected.has('breathing') || affected.has('bulbar') || Boolean(sit.signs?.breathing)
    || ans.breathingSymptoms === true || ans.breathlessLyingFlat === true;
  // The timed walk is the legs' main test only while it is in the plan.
  const legsMain = affected.has('leg') && !walkingOff;

  const plan = {
    headline: HEADLINE[stage], stage,
    // Before diagnosis a red flag already known is acted on now, not left as "if this happens".
    actNow: stage === 'diagnosed' ? [] : actNowFor(sit, ans),
    weekly: [], every2weeks: [], monthly: [], passive: [], triggers: [], safety: [], notes: [],
    weekInWindow: sit.weekInWindow ?? null,
  };

  // One entry per id across the three lists; the first (most frequent) wins.
  const used = new Set();
  const add = (cadence, id, why) => {
    if (used.has(id)) return;
    if (WALKING_TESTS.has(id) && walkingOff) return;
    if ((id === 'sts30' || id === 'sts5_time') && ans.needsArmsToStand === true) return;
    let safety = [...(ITEM_SAFETY[id] || [])];
    // Never alone after falls; company too with a walking aid or foot drop (the notes' "weakening" stage).
    if (WALKING_TESTS.has(id) && (fell || usesAid || footDrop)) {
      safety = [fell ? 'You have had a fall: do this only with someone beside you, never alone.'
        : usesAid ? 'You use a walking aid: do this only with someone beside you.'
          : 'Foot drop is recorded: do this only with someone beside you.', ...safety];
    }
    used.add(id);
    plan[cadence].push({ kind: KIND[id] || 'test', id, why, cadence, practice: PRACTICE.has(id), safety });
  };

  if (stage === 'low') {
    plan.triggers = triggersFor('low', { breathingInvolved, devs });
    plan.safety = [...SAFETY_NET];
    plan.notes = ['No home tests are needed at this stage. Keep the warning-signs checklist and look at it again if anything changes; a monthly reminder is optional.'];
    if (sit.steppedDown) plan.notes.push('The 8-week review saw no decline beyond normal variation. That does not rule out ALS: the warning signs above still apply.');
    return plan;
  }

  if (stage === 'unclear' || stage === 'high') {
    // Weekly: the affected regions' tests, then weight, falls and the breathing check.
    if (affected.has('leg')) add('weekly', 'timed_walk_speed', WHY.timed_walk_speed.region);
    if (affected.has('arm')) {
      add('weekly', 'typing_speed', WHY.typing_speed.region);
      if (devs.includes('dynamometer')) add('weekly', 'grip', WHY.grip.region);
    }
    if (affected.has('bulbar')) {
      add('weekly', 'ddk_rate', WHY.ddk_rate.region);
      add('weekly', 'pause_pct', WHY.pause_pct.region);
    }
    add('weekly', 'weight', WHY.weight.pre);
    add('weekly', 'falls_week', WHY.falls_week.pre);
    add('weekly', 'breathing_symptoms', WHY.breathing_symptoms.weekly);
    // Every 2 weeks: one screening test for each other motor region, to catch spread.
    if (affected.has('bulbar')) add('every2weeks', 'eat10', WHY.eat10.region);
    if (!affected.has('leg')) add('every2weeks', 'timed_walk_speed', WHY.timed_walk_speed.screen);
    if (!affected.has('arm')) add('every2weeks', 'typing_speed', WHY.typing_speed.screen);
    if (!affected.has('bulbar')) add('every2weeks', 'ddk_rate', WHY.ddk_rate.screen);
    // (Breathing is screened by the weekly breathing check.)

    plan.notes.push(existingTests(legsMain), HISTORY, PRACTICE_NOTE);
    if (stage === 'unclear') {
      const wk = sit.weekInWindow;
      if (Number.isFinite(wk)) plan.notes.push(wk >= UNCLEAR_DEADLINE_WEEKS ? `The ${UNCLEAR_DEADLINE_WEEKS} weeks are up: time for the week-8 decision.` : `You are in week ${wk + 1} of ${UNCLEAR_DEADLINE_WEEKS}.`);
      // Only the main tests escalate (rules B1 and B2); the kit tests are context.
      plan.notes.push(`The week-8 decision: if a region's main test (finger tapping, reading or the phone walking test on the Monitoring page, or the stopwatch timed walk here) drops beyond its normal variation two weeks in a row, or a main test declines in a second body region, ask your doctor to refer you for an EMG straight away. The other kit tests are context and never trigger this on their own. If nothing changes by week ${UNCLEAR_DEADLINE_WEEKS}, the case steps down with the warning-signs checklist. No decline seen does not rule out ALS: in 8 weeks most tests catch only fast change.`);
    } else {
      plan.notes.push('Your doctor is arranging a nerve and muscle test (EMG). Keep the weekly checks: progression shown by repeated tests is what the diagnostic criteria look for, and a worsening trend can move the referral up.');
    }
  }

  if (stage === 'diagnosed') {
    // Weekly: the involved regions, plus weight and falls.
    if (affected.has('leg')) {
      add('weekly', 'timed_walk_speed', WHY.timed_walk_speed.dx);
      add('weekly', 'sts30', WHY.sts30.dx);
    }
    if (affected.has('arm')) {
      add('weekly', 'typing_speed', WHY.typing_speed.region);
      if (devs.includes('dynamometer')) add('weekly', 'grip', WHY.grip.region);
    }
    if (affected.has('bulbar')) {
      add('weekly', 'ddk_rate', WHY.ddk_rate.dx);
      add('weekly', 'pause_pct', WHY.pause_pct.region);
    }
    add('weekly', 'weight', WHY.weight.dx);
    add('weekly', 'falls_week', WHY.falls_week.dx);
    if (breathingInvolved) add('weekly', 'breathing_symptoms', WHY.breathing_symptoms.dx);
    // Every 2 weeks: swallowing and the voice breathing checks while those areas are involved.
    if (affected.has('bulbar')) add('every2weeks', 'eat10', WHY.eat10.dxBulbar);
    if (breathingInvolved) {
      add('every2weeks', 'mpt', WHY.mpt.dx);
      add('every2weeks', 'single_breath_count', WHY.single_breath_count.dx);
    }
    // Monthly: the up-and-go, and a screen for each area not yet involved.
    if (affected.has('leg')) add('monthly', 'tug_time', WHY.tug_time.dx);
    if (!affected.has('leg')) add('monthly', 'timed_walk_speed', WHY.timed_walk_speed.screen);
    if (!affected.has('arm')) add('monthly', 'typing_speed', WHY.typing_speed.screen);
    if (!affected.has('bulbar')) {
      add('monthly', 'ddk_rate', WHY.ddk_rate.dxScreen);
      add('monthly', 'eat10', WHY.eat10.dxScreen);
    }
    if (!breathingInvolved) add('monthly', 'breathing_symptoms', WHY.breathing_symptoms.dxScreen);

    const ex = exerciseFor({ wheelchair, usesAid, unsteady: walkSafe === false || fell || footDrop });
    plan.exercise = ex;
    plan.notes.push(
      'Clinic: first team follow-up within 4 weeks of diagnosis, then usually every 2 to 3 months (NICE) or 3 to 6 months (EAN). Breathing, weight and swallowing are checked about every 3 months.',
      existingTests(legsMain),
      PRACTICE_NOTE,
      ...ex.advice,
    );
    if (breathingInvolved) plan.notes.push('If the clinic gives you a home spirometer or peak flow meter, enter its readings: the lung-capacity and cough-flow triggers use them.');
  }

  if (walkingOff) plan.notes.push(LEGS_UNCOVERED);
  plan.passive = passiveFor(stage, devs);
  plan.triggers = triggersFor(stage, { breathingInvolved, devs });
  plan.safety = stage === 'diagnosed' ? [...COMMON_SAFETY.slice(0, 2), 'New breathlessness at rest or lying flat: tell your team straight away.'] : [...COMMON_SAFETY];
  const hasWalking = [...plan.weekly, ...plan.every2weeks, ...plan.monthly].some((i) => WALKING_TESTS.has(i.id));
  if (hasWalking) plan.safety.push('Do walking, up-and-go and chair tests only with someone in the room if you have fallen or nearly fallen in the last 3 months, use a walking aid, or take 14 seconds or more for the up-and-go.');
  if (walkingOff) {
    // Say why they are off: never blame falls when the person simply said no.
    plan.safety.push(wheelchair ? 'Walking and standing tests are left out while you use a wheelchair.'
      : ans.canWalkSafely === false ? 'Walking and chair tests are off because you said you cannot walk safely on your own.'
        : fell || footDrop ? 'Walking and chair tests are off because of falls or foot drop. Turn them back on only if you can walk safely, and then never alone.'
          : 'Walking and chair tests are off until you say you can walk safely on your own, and then never alone.');
  }
  if (stage === 'diagnosed') plan.safety.push(...plan.exercise.warningSigns);
  return plan;
}

// only: 'breathing' needs breathing involvement; any other value is a device the person must have.
function triggersFor(stage, { breathingInvolved, devs }) {
  return RULES.filter((r) => r.stages.includes(stage))
    .filter((r) => !r.only || (r.only === 'breathing' ? breathingInvolved : devs.includes(r.only)))
    .map((r) => ({ if: r.if, then: r.then, source: r.source, rule: r.id, sourceLabel: r.sourceLabel, basis: r.basis }));
}
