// Alex Chen's file (BioHacks 2026 hacker package, pages 7-15), as the scorer sees it.
// Notes are word for word from the PDF (alex_notes.js is generated, never hand-edited).
// Findings are the extraction step: each one quotes the exact sentence it came from,
// and tests/alex.test.mjs checks every quote appears word for word in its note.
// Home-test values are SIMULATED: Alex never had home tests. They illustrate the design.
import { NOTES } from './alex_notes.js';

export const ALEX = {
  patient: {
    name: 'Alex Chen',
    ageAtFirstVisit: 45,
    sex: 'male',
    summary: 'High-school biology teacher in Hamilton, right-handed, runner. First symptom June 2024: handwriting fading on the whiteboard.',
  },
  sourceDoc: { file: 'BioHacks-2026-Hacker-Package.pdf', pages: '7-15' },
  encounters: [
    {
      id: 'e1', date: '2024-10-14', setting: 'Family doctor', clinician: 'Dr. Priya Raman, family physician',
      title: 'Referral to hand surgery: suspected carpal tunnel',
      note: NOTES.e1,
      findings: [
        { id: 'focal_weakness', region: 'arm', quote: 'Grip is slightly weaker on the right.' },
        { id: 'wasting', region: 'arm', quote: 'the right thenar eminence looks a little flatter than the left' },
        { id: 'cramp', region: 'arm', quote: 'He reports some cramping in the right forearm at night.' },
      ],
      negatives: [
        { label: 'No pain', quote: 'No pain.' },
        { label: 'No numbness or tingling', quote: 'No numbness or tingling.' },
        { label: 'Normal sensation in all fingers', quote: 'Sensation to light touch was normal in all fingers.' },
      ],
      whatHappened: 'Referred to hand surgery as a suspected carpal tunnel syndrome, with nerve studies at the wrist.',
    },
    {
      id: 'e2', date: '2024-12-09', setting: 'Hand surgeon', clinician: 'Dr. Marcus Oyelaran, plastic and hand surgery',
      title: 'Normal wrist nerve studies, wasting in two nerve territories',
      note: NOTES.e2,
      findings: [
        { id: 'focal_weakness', region: 'arm', quote: 'Six months of right hand weakness affecting fine tasks' },
        { id: 'wasting', region: 'arm', quote: 'Visible wasting of the right thenar muscles and the muscle between thumb and index finger.' },
        { id: 'two_territory_wasting', region: 'arm', quote: 'Visible wasting of the right thenar muscles and the muscle between thumb and index finger.' },
        { id: 'mimic_test_normal', region: 'arm', quote: 'median sensory and motor latencies within normal limits; no slowing across the carpal tunnel.' },
      ],
      negatives: [
        { label: 'No sensory symptoms', quote: 'no sensory symptoms' },
      ],
      whatHappened: 'Carpal tunnel release offered as a trial of treatment; surgery on 20 January 2025. No neurology referral.',
    },
    {
      id: 'e3', date: '2025-04-21', setting: 'Hand surgeon (follow-up)', clinician: 'Dr. Marcus Oyelaran, plastic and hand surgery',
      title: 'No better after surgery; twitching; right foot catching',
      note: NOTES.e3,
      findings: [
        { id: 'focal_weakness', region: 'arm', quote: 'If anything the hand is weaker' },
        { id: 'fasciculations', region: 'arm', quote: 'twitching under the skin of the forearm' },
        { id: 'foot_drop', region: 'leg', quote: 'his right foot catching on stairs' },
        { id: 'lookalike_surgery', region: 'arm', quote: 'Follow-up, three months after surgery. Wound well healed. He reports no improvement.' },
      ],
      negatives: [],
      whatHappened: 'Sent back to the family doctor; a neurology opinion suggested only "if symptoms progress".',
    },
    {
      id: 'e4', date: '2025-08-12', setting: 'Physiotherapy (first session)', clinician: 'Daniela Ferreira, physiotherapist',
      title: 'Referred for a right foot that catches and slaps',
      note: NOTES.e4,
      reconstructed: 'The August 2025 referral is described in the physiotherapist\'s February 2026 discharge summary; only those two sentences are used here.',
      findings: [
        { id: 'foot_drop', region: 'leg', quote: 'a right foot that catches on curbs and slaps on landing' },
        { id: 'focal_weakness', region: 'leg', quote: 'He had stopped running in May because the right leg' },
      ],
      negatives: [],
      whatHappened: 'Six months of physiotherapy for presumed peroneal (ankle nerve) weakness.',
    },
    {
      id: 'e5', date: '2026-02-10', setting: 'Physiotherapy (discharge)', clinician: 'Daniela Ferreira, physiotherapist',
      title: 'Worse despite treatment; brisk reflexes; urges neurology',
      note: NOTES.e5,
      findings: [
        { id: 'foot_drop', region: 'leg', quote: 'his right ankle dorsiflexion has gone from 4 out of 5 to 3 out of 5' },
        { id: 'wasting', region: 'leg', quote: 'Calf and thigh circumference on the right are each about 2 cm smaller than the left.' },
        { id: 'falls', region: 'leg', quote: 'He reports two falls' },
        { id: 'umn_signs', region: 'leg', quote: 'His reflexes are brisk, including at the right ankle' },
        { id: 'mimic_test_normal', region: 'leg', quote: 'A lumbar spine MRI in December 2025 was reported as unremarkable for his age, with no nerve root compression.' },
        { id: 'focal_weakness', region: 'arm', quote: 'his right hand has been weak for well over a year' },
      ],
      negatives: [],
      whatHappened: 'Physiotherapist strongly recommends a neurology referral and tells Alex so.',
    },
    {
      id: 'e6', date: '2026-02-16', setting: 'Family doctor', clinician: 'Dr. Priya Raman, family physician',
      title: 'Urgent referral to general neurology',
      note: NOTES.e6,
      findings: [
        { id: 'cramp', region: 'leg', quote: 'muscle cramps' },
        { id: 'fasciculations', region: 'arm', quote: 'visible twitching in both forearms and lately the right thigh' },
        { id: 'weight_loss', region: 'general', quote: 'he has lost about 6 kg without trying since the summer' },
        { id: 'wasting', region: 'arm', quote: 'he has wasting of the right hand' },
        { id: 'umn_signs', region: 'arm', quote: 'brisk reflexes in all four limbs' },
        { id: 'foot_drop', region: 'leg', quote: 'he has developed a right foot drop' },
      ],
      negatives: [
        { label: 'No pain, numbness, bladder, bowel or visual symptoms', quote: 'There is no pain, no numbness, no change in bladder or bowel function and no visual symptoms.' },
        { label: 'Possible early speech change (not weighted)', quote: 'his partner says he is quieter in the evenings' },
      ],
      whatHappened: 'Referral received 18 February 2026; first appointment 11 June 2026, 16 weeks later.',
    },
    {
      id: 'e7', date: '2026-06-11', setting: 'Neuromuscular neurologist', clinician: 'Dr. Hannah Weiss-Okafor, neuromuscular neurology',
      title: 'First specialist visit: signs in three body regions (four on EMG a week later)',
      note: NOTES.e7,
      findings: [
        { id: 'dysarthria', region: 'bulbar', quote: 'his partner and students notice slurring by late afternoon' },
        { id: 'dysphagia', region: 'bulbar', quote: 'Occasional coughing when drinking water quickly.' },
        { id: 'tongue_fasciculations', region: 'bulbar', quote: 'Tongue shows mild wasting with fasciculations at rest.' },
        { id: 'split_hand', region: 'arm', quote: 'Marked wasting of the right thenar eminence and first dorsal interosseous, with relative sparing of the hypothenar muscles.' },
        { id: 'fasciculations', region: 'arm', quote: 'Fasciculations in both forearms and the right deltoid.' },
        { id: 'umn_signs', region: 'arm', quote: 'Hoffmann sign present on the right.' },
        { id: 'cramp', region: 'leg', quote: 'Cramps in both calves and the right forearm, worse at night.' },
        { id: 'weight_loss', region: 'general', quote: 'Unintentional weight loss, 86 kg two years ago to 78 kg today.' },
        { id: 'short_breath', region: 'breathing', quote: 'He has started sleeping on two pillows because he feels' },
        { id: 'depression', region: 'cognitive', quote: 'Mood is low but he denies hopelessness.' },
        { id: 'foot_drop', region: 'leg', quote: 'Right foot drop with a high-stepping gait and a cane.' },
      ],
      negatives: [
        { label: 'No double vision, sensory or sphincter symptoms', quote: 'No diplopia, no sensory symptoms, no sphincter change.' },
        { label: 'No family history', quote: 'Family history: no neurological disease in parents, siblings or grandparents.' },
        { label: 'Normal sensation throughout', quote: 'Normal to light touch, pinprick, vibration and proprioception throughout.' },
      ],
      whatHappened: 'EMG, MRI and bloods ordered. EMG on 18 June 2026; ALS diagnosed on 14 July 2026.',
    },
  ],
  actual: {
    // The real urgent neurology referral (family doctor, encounter e6). The fair
    // comparison for "how much earlier" is referral vs referral: the 16-week wait
    // that followed would apply to the tool's referral too.
    referral: '2026-02-16',
    firstNeurology: '2026-06-11',
    firstNeuromuscular: '2026-06-11',
    emg: '2026-06-18',
    diagnosis: '2026-07-14',
    firstSymptom: '2024-06',
  },
  // Regional ALS clinic, 22 September 2026 (hacker package page 15): where Alex is now.
  measurements: [
    { label: 'Grip strength (right / left)', value: '14 / 32 kg', typical: 'about 48 kg', date: '2026-09-22' },
    { label: 'Key pinch (right / left)', value: '3 / 8 kg', typical: 'about 11 kg', date: '2026-09-22' },
    { label: 'Nine-hole peg test (right / left)', value: '44 / 23 s', typical: 'about 20 s', date: '2026-09-22' },
    { label: 'Speaking rate, same passage, 9 am / 4 pm', value: '165 / 118 words per minute', typical: '150 to 190', date: '2026-09-22' },
    { label: 'Sentence intelligibility, 9 am / 4 pm', value: '98 / 91 per cent', typical: 'above 97 per cent', date: '2026-09-22' },
    { label: 'Forced vital capacity, sitting / lying flat', value: '76 / 61 per cent of predicted', typical: 'above 80; within 10 per cent of sitting', date: '2026-09-22' },
    { label: '10-metre walk with cane', value: '14.2 s', typical: 'under 8 s', date: '2026-09-22' },
    { label: 'ALSFRS-R at 0, 6, 12, 18, 24, 27 months', value: '48, 43, 39, 36, 33, 32', typical: '48', date: '2026-09-22' },
    { label: 'Serum neurofilament light chain', value: '88 pg/mL', typical: 'below 15 pg/mL at his age', date: '2026-09-22' },
    { label: 'Weight', value: '77.5 kg (86 kg two years ago)', typical: '', date: '2026-09-22' },
  ],
  // SIMULATED weekly finger-tapping results, starting at the first family-doctor visit
  // (the tool's "unclear" tier starts weekly hand tests). Illustrative only.
  homeTests: [
    ['2024-10-14', 54, 61], ['2024-10-21', 55, 60], ['2024-10-28', 53, 61], ['2024-11-04', 52, 62],
    ['2024-11-11', 50, 60], ['2024-11-18', 49, 61], ['2024-11-25', 48, 60], ['2024-12-02', 47, 61],
    ['2024-12-09', 46, 60],
  ].flatMap(([date, right, left]) => [
    { date, test: 'tap_right', value: right, simulated: true },
    { date, test: 'tap_left', value: left, simulated: true },
  ]),
};
