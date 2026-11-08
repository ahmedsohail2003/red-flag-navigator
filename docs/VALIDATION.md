# Validation plan: Red-Flag Navigator

The claim to test: given the findings in primary-care notes in date order, the tool recommends EMG and neuromuscular assessment months earlier than the real referral, at a cost in normal EMGs that the clinic chooses openly. It never diagnoses. On Alex's notes (home tests off) that is at least 14 months earlier referral, at any line from 3% to 20%.

## Study 1: retrospective replay

**Data.** Linked primary-care records with dated free-text notes, referrals and diagnoses: for example, Ontario primary-care EMR data linked to physician billing and hospital records, held by a custodian such as ICES. Access: research ethics approval and a PHIPA data-sharing agreement.

**Cohort.** Index date = diagnosis (or a matched date for controls).

- People later diagnosed with ALS.
- People later diagnosed with a look-alike: carpal tunnel syndrome, cervical myelopathy, radiculopathy, multifocal motor neuropathy, myasthenia gravis, inclusion body myositis.
- General controls, matched on age, sex, practice and calendar time.

**Replay.** Notes go to the tool one visit at a time, in date order, so it sees only what the doctor could have seen that day. The referral line is fixed before analysis (default 5%); every result is also reported at 3%, 10% and 20%. People judging outcomes do not see the tool's output.

**Extraction check.** The demo case was extracted by hand (AI-assisted); the app does not read notes automatically yet. Since 8 Nov a keyword note helper (`app/js/suggest.js`, plain rules, not AI) proposes quoted red flags from a pasted note for a clinician to confirm. On Alex's 7 notes it found 34 of 35 labelled flags, a best case because its rules were written from those notes. For the replay, an automatic extractor (future work) proposes findings, each with its quote, and in use the clinician confirms them. Two clinicians independently mark findings in a random sample of notes; we report the extractor's sensitivity and precision against their consensus. Every quote must match its note word for word (an automated test, already running on the demo case).

**Outcomes.**

- **Months earlier:** time from the tool's first High to the real neurology or EMG referral date (primary outcome), not the first specialist visit, because the waiting list after a referral applies either way.
- **EMG referrals per true ALS case,** and per neuromuscular diagnosis of any kind (an EMG that finds multifocal motor neuropathy is not wasted).
- **Sensitivity at 6 and 12 months before diagnosis:** the share of ALS cases already High.
- **Discrimination:** AUC (c-statistic), separately for ALS vs look-alikes and ALS vs general controls.
- **Calibration:** calibration-in-the-large, calibration slope and a calibration plot. A case-control sample over-represents ALS, so absolute calibration is checked after reweighting to population incidence (EURALS crude incidence 2.16 per 100,000 adults per year, Logroscino 2010; Mei 2022 quotes it as 2.7).
- **Clinical usefulness:** decision curves (net benefit) across referral lines.
- **Unclear tier:** how many enter, for how long, and how many step down or escalate at the 8-week review.

**Reporting.** Pre-registered analysis plan, reported to TRIPOD+AI. Sample size from published guidance for validating prediction models (for example, Riley and colleagues).

## Home tests: measuring normal variation (team MDC protocol)

Each test (finger tapping for each hand, the phone walking test (built; walking speed in m/s, checked so far on synthetic walks only), reading rate, weight) is repeated 10 times per person, at the same time of day, on the same phone, with the same reading passage. The within-person SD gives the standard error of measurement (SEM), and MDC95 = 1.96 x sqrt(2) x SEM. Weekly repeats over several weeks then measure week-to-week noise, which repeats in one sitting understate. Healthy volunteers first, then patients, to confirm the tests detect real decline.

## Study 2: silent prospective pilot

In one family health team the tool runs on new notes, but nobody sees its output. After follow-up we compare its recommendations with what happened, and measure alerts per 1,000 patients per year, extraction errors in live notes (findings the clinician rejects or adds), and clinician agreement.

## Study 3: stepped rollout

Clinics switch the tool on in random order (stepped-wedge). Outcomes: time from the first motor-symptom note to neuromuscular assessment, EMG volumes and wait times, and patient-reported experience.

## Feasibility

- **How it runs.** An EMR-side rule set that runs where the records are, so notes stay in the clinic. Home tests: a phone web app with no install or special hardware, plus a clinic version for patients without a smartphone.
- **Cost and access.** No new equipment. Costs: EMR integration, upkeep, and the extra EMGs, which the referral line controls and Study 1 measures. EMG capacity is the real constraint and the tool creates none, so rollout is paced with neuromuscular clinics.
- **Privacy.** Patients see what was flagged and why (their PHIPA right of access): the same facts in plainer words. Validation needs a privacy impact assessment and a PHIPA data agreement.
- **Regulation.** Likely regulated as software as a medical device in Canada (to be confirmed with Health Canada, with its class). It makes a referral recommendation that a clinician confirms, and shows each finding with its source sentence so every input can be checked.
