# Phone, earbud and smartwatch motion sensors for home motor tests (gait and hand) in ALS monitoring

Scope: notes for a BioHacks 2026 team building an ALS early-referral tool whose phone walking test is still a mockup. Compiled 2026-11-07. The date of each source is in square brackets. Journal abstracts were read through PubMed (DOI links given). Items marked "own computation" were calculated for these notes from the public PhysioNet dataset. They are not published results. Scripts: `C:/Users/sohai/AppData/Local/Temp/claude/3b192dde7d9397dd/c8a23cbf-7b81-4a28-9b32-1e32da5a8fa8/scratchpad/motor/gait_stats.py`, `gait_jitter.py`, `gait_window.py`. Each one takes the data folder as its argument.

## Which published studies use smartphone or wearable motion sensors to measure gait or motor function in ALS, and what did they find?

### Takeaway
There is a real but young evidence base in ALS. Wrist, ankle and four-limb accelerometers, and a few smartphone apps, track decline in people who already have an ALS diagnosis. A supervised phone 60-second walk gave very reliable gait speed in ALS (ICC 0.93), and a touchscreen tapping and pegboard battery helped separate ALS from controls. I found no study that validates a phone, watch or earbud test for detecting undiagnosed ALS or for referral triage. Most of the evidence on ALS gait variability comes from foot sensors or force insoles, not phones.

### Cited Findings
- **Hausdorff et al. 2000.** People with ALS walked for 5 min at their usual pace wearing an ankle-worn stride recorder. "The gait of patients with ALS is less steady and more temporally disorganized compared with that of healthy controls" (larger stride-to-stride fluctuations). [J Appl Physiol, Jun 2000] — [PubMed / DOI 10.1152/jappl.2000.88.6.2045](https://doi.org/10.1152/jappl.2000.88.6.2045)
- **The data from that study is public.** It is the PhysioNet "Gait in Neurodegenerative Disease Database" v1.0.0 (DOI 10.13026/C27G6C). It has 13 ALS, 15 Parkinson's, 20 Huntington's and 16 control records from force-sensitive resistors under the feet. Each `.ts` file gives per-stride left and right stride, swing, stance and double-support intervals, unfiltered. For ALS, "Duration/Severity" is "the time in months since the diagnosis". The licence is Open Data Commons Attribution v1.0. [published 21 Dec 2000] — [PhysioNet gaitndd](https://physionet.org/content/gaitndd/1.0.0/)
- **Own computation on that dataset.** Method: 29 files downloaded, all SHA-256 checksums matched. I used left stride intervals, dropped the first 20 s and removed strides more than 4 robust SD from the median. Results:
  - Median stride time: ALS 1.27 s (IQR 1.20-1.54), controls 1.08 s (IQR 1.03-1.11).
  - Median stride-time CV: ALS 4.86% (IQR 2.72-6.50), controls 2.53% (IQR 2.08-3.06).
  - Median swing-time CV: ALS 6.86%, controls 3.69%.
  - 9 of 13 ALS records exceed the highest control CV (3.36%).
  - Separation, as Mann-Whitney AUC: stride-time CV 0.84; mean stride time 0.95.
  - **Caveat:** the groups are not age-matched. Control mean age is 39.3 years and ALS mean age is 55.6 years. Time since diagnosis in the ALS group ranges from 1 to 54 months.
  - Source data: [PhysioNet gaitndd files](https://physionet.org/files/gaitndd/1.0.0/)
- **Dubbioso et al. 2023.** The study used a wearable gait analysis device. Ambulatory ALS patients (18 with mild cognitive impairment, 24 without) had higher gait variability than 16 healthy subjects, especially in stance and swing time (p < 0.001). Mild cognitive impairment predicted falls over the next 3 months. [Eur J Neurol, Jun 2023] — [PubMed / DOI 10.1111/ene.15936](https://doi.org/10.1111/ene.15936)
- **Lukac et al. 2023.** 9 ALS patients and 6 controls recorded twice-weekly home walks with foot-worn IMUs, for 24 and 4 weeks respectively.
  - Home walking speed was 0.19 m/s slower than clinic speed.
  - Over 24 weeks, home speed fell significantly in 5 of 9 ALS patients (mean -0.021 m/s per month).
  - The decline was greatest in those who later needed an assistive device.
  - [Digit Biomark, May 2023] — [PubMed / DOI 10.1159/000530067](https://doi.org/10.1159/000530067)
- **Burke et al. 2026 (WatchALS, the closest model for this project).** The app runs on the BrainBaseline platform with an iPhone 8+ or 12 Pro and an Apple Watch 4 or 5. 19 ALS participants and 23 controls did weekly home tasks for 24 weeks (10,237 smartphone assessments). The combined features separated ALS from controls with AUC 0.75-0.92. Fine-motor and speech scores improved in both groups over time, except nondominant-hand pegboard, which declined in ALS. Gait and balance declined in both groups. [JMIR Form Res, Jul 2026] — [PubMed / DOI 10.2196/85142](https://doi.org/10.2196/85142)
  - **Tasks** — [PMC full text](https://pmc.ncbi.nlm.nih.gov/articles/PMC13423962/):
    - A 60-second walk back and forth at usual pace in an area at least 10 feet long. "Gait speed ... calculated as the distance covered divided by the time spent walking." The paper does not state where the phone was carried during the walk.
    - 30-second standing balance with the phone "in a belt across their lower backs".
    - 20-second alternating two-finger tapping on 2 on-screen circles, with each hand.
    - A digital pegboard, plus /pa-ta-ka/ repetition and passage reading.
    - "The sampling rate during active limb motor tasks was 100 Hz."
  - **Results** — [PMC full text](https://pmc.ncbi.nlm.nih.gov/articles/PMC13423962/):
    - Gait speed test-retest ICC was 0.93 (95% CI 0.85-0.96) in ALS and 0.68 in controls.
    - Minimal detectable change was about 0.18 m/s in ALS and 0.28 m/s in controls. The table header says "%MDC95", which conflicts with the m/s units in the text.
    - Correlation with the self-reported ALSFRS gross-motor subdomain was 0.83.
    - The ALS-control gap in gait speed "slightly narrowed" over the study.
  - **Stated limits** — [PMC full text](https://pmc.ncbi.nlm.nih.gov/articles/PMC13423962/):
    - "many participants with ALS were either unable to complete the walking task or changed the assistive devices they used"
    - "there is a clear measurement floor, since participants need to stand"
    - "Our gait analysis may oversimplify the complexity of gait changes in people with ALS"
- **Karas et al. 2024.** 63 people with ALS used the Beiwe app, which passively logged phone accelerometer and GPS data. In the analytic sample (N = 45, mean 292 days of observation), four measures changed over time and tracked the self-entry ALSFRS-R (baseline 35.8, falling 0.48 points per month): walking cadence from the top 1 minute, step count, step count from the top 1 minute, and Activity Index. [Ann Clin Transl Neurol, May 2024] — [PubMed / DOI 10.1002/acn3.52050](https://doi.org/10.1002/acn3.52050)
- **Johnson et al. 2023.** 40 ambulatory adults with ALS were followed for 6 months. They completed Beiwe surveys every 2-4 weeks and wore a wrist ActiGraph Insight Watch or an ankle Modus StepWatch. Several daily activity measures changed over time and were associated with the ALSFRS-RSE and ROADS scales. [npj Digit Med, Mar 2023] — [PubMed / DOI 10.1038/s41746-023-00778-y](https://doi.org/10.1038/s41746-023-00778-y)
- **Gupta et al. 2023.** 376 people with ALS wore sensors on all four limbs at home. A machine-learned per-limb score built from detected submovements progressed faster than ALSFRS-R (-0.86 vs -0.73 SD/year). It cut the estimated trial size from 121 to 76. [Nat Commun, Aug 2023] — [PubMed / DOI 10.1038/s41467-023-40917-3](https://doi.org/10.1038/s41467-023-40917-3)
- **van Eijk et al. 2019.** 42 ALS patients wore an ActiGraph for 7 days every 2-3 months, with 93.0% adherence.
  - Activity fell 0.64% per month.
  - Accelerometer endpoints correlated with ALSFRS-R (r 0.78).
  - They could reduce sample size by 30.3% in 12-month trials and 44.6% in 18-month trials.
  - [J Neurol, Jun 2019] — [PubMed / DOI 10.1007/s00415-019-09427-5](https://doi.org/10.1007/s00415-019-09427-5)
- **Straczkiewicz et al. 2025.** This is an ankle-worn accelerometer step counter built for ALS gait, which is "slow, variable, and asymmetric". It finds heel strikes by wavelet decomposition.
  - Walking recognition: sensitivity 0.94-0.98, specificity above 0.95.
  - Step counting: mean bias 0.44 steps, limits of agreement -5.90 to 5.40.
  - In 305 people with ALS, those who answered "walks with assist" on ALSFRS-R averaged 1283 steps/day, against 3984 for those who answered "normal".
  - [Sci Rep, Nov 2025] — [PubMed / DOI 10.1038/s41598-025-24664-7](https://doi.org/10.1038/s41598-025-24664-7)
- **Jewett et al. 2026.** A Fitbit Sense was compared with a research ActiGraph GT9X worn on the opposite wrist in 40 ALS participants (8093 smartwatch days).
  - Daily steps correlated well (r = 0.91).
  - The watch read lower: 3480 vs 4066 steps/day on average, a bias of -586 steps (about 14%).
  - Limits of agreement were wide (-4193 to 3021).
  - Both devices showed a similar decline over time.
  - [Muscle Nerve, Jun 2026] — [PubMed / DOI 10.1002/mus.70323](https://doi.org/10.1002/mus.70323)
- **Garcia-Gancedo et al. 2019.** 25 ALS patients used a 48-week platform and wore a body sensor about 3 days a month. Home activity data were thinner than expected:
  - 3 or more days were recorded at 65% of time points, and none at 24%.
  - 13 of 18 remaining patients still provided data at week 48.
  - 6 of 25 had skin irritation from the electrode patch.
  - [JMIR mHealth uHealth, Dec 2019] — [PubMed / DOI 10.2196/13433](https://doi.org/10.2196/13433)
- **Beswick et al. 2022 (systematic review).** 20 studies covering 1275 people with MND. Sensor types were accelerometers (9), activity monitors (4), smartphone apps (4), gait (3) and kinetic sensors (3). 85% of studies used ALSFRS-R to evaluate concurrent validity. Risk of bias was high, and the authors concluded "Further well-powered longitudinal validation studies are needed". [J Neurol, Aug 2022] — [PubMed / DOI 10.1007/s00415-022-11312-7](https://doi.org/10.1007/s00415-022-11312-7)
- **Hand and upper-limb studies:**
  - **Straczkiewicz et al. 2024, two studies (20 and 202 people with ALS).** Wrist-accelerometer counts and durations of flexion, extension, supination and pronation tracked ALSFRS-RSE and changed faster than survey responses. Disease-onset site affected upper-limb use. [EBioMedicine, Mar 2024; J Neuroeng Rehabil, Dec 2024] — [DOI 10.1016/j.ebiom.2024.105036](https://doi.org/10.1016/j.ebiom.2024.105036); [DOI 10.1186/s12984-024-01514-7](https://doi.org/10.1186/s12984-024-01514-7)
  - **Straczkiewicz et al. 2026 (329 people with ALS).** Short prescribed exercises, recorded with a wrist-worn sensor, gave repetition duration, intensity and similarity scores that tracked ALSFRS-R. Intensity performed as well as free-living metrics that needed about 21 h of wear (R² 0.899 vs 0.860). "As few as five exercise repetitions were sufficient." [J Neuroeng Rehabil, Jan 2026] — [PubMed / DOI 10.1186/s12984-025-01829-z](https://doi.org/10.1186/s12984-025-01829-z)
  - **Acien et al. 2024 (nQiALS).** Smartphone typing dynamics in 63 ALS patients and 30 controls. Detection AUC was 0.89; slow vs fast progression AUC was 0.65-0.8. [Sci Rep, Jul 2024] — [PubMed / DOI 10.1038/s41598-024-67940-8](https://doi.org/10.1038/s41598-024-67940-8)
  - **Agurto et al. 2019 (Answer ALS mobile app).** Speech and fine-motor features estimated the ALSFRS-R total score (R = 0.79 in males). Baseline values did not predict later decline. [IEEE EMBC, Jul 2019] — [PubMed / DOI 10.1109/EMBC.2019.8857300](https://doi.org/10.1109/EMBC.2019.8857300)
  - **Gopal et al. 2022 (review of remote hand-function tests in neurological disease).** Of 74 studies, only 1 was in ALS; 57 were in Parkinson's. Common domains were finger-tapping speed, tremor, dexterity and handwriting. Smartphone and tablet tests were "the most readily implementable". [JMIR Rehabil Assist Technol, Mar 2022] — [PubMed / DOI 10.2196/33157](https://doi.org/10.2196/33157)

### Inferences
- The strongest ALS-specific phone result is the reliability of gait speed from a short, supervised home walk (WatchALS). It is not evidence about gait variability or early detection. A referral tool can honestly describe its tasks as "modelled on research tasks used in ALS" (a timed walk plus per-hand tapping), but not as "validated for ALS screening".
- **Why generic tools and single tests fall short:**
  - ALS gait is slow, variable and asymmetric, so generic step counters undercount (a consumer watch read about 14% low).
  - ALS can start focally, in one limb or in bulbar muscles. A walk-only test will miss arm-onset and bulbar-onset cases, so pair the walk with tapping for each hand separately (speech is outside this note).
- **The PhysioNet dataset is an immediate demo asset.** A team can run its stride-variability code on real ALS and control stride series tonight. It must state that the groups are not age-matched and that the data come from foot force sensors, not phones.

### Gaps
- No published study found tests any phone, watch or earbud motor test for detecting undiagnosed ALS, or for referral triage; every cohort was already diagnosed.
- No ALS study found used AirPods or any earbud IMU.
- Hausdorff 2000's own numeric stride-variability results were not readable: the publisher page was blocked and the abstract gives no numbers. The PhysioNet computation above stands in for them.

## How accurate is stride or step timing from a phone (pocket or hand), a wrist-worn watch, and earbuds (AirPods head motion), and what sample rate is needed?

### Takeaway
- **Phone on the trunk, belt or in a trouser pocket:** good mean stride and step time. A pocketed iPhone at 100 Hz had a mean error of 16.9 ms and r = .98 against a GAITRite walkway.
- **Hand-held phone or phone in a bag:** less reliable.
- **Wrist:** step time can be accurate, but gait detection is noisier because the arm moves on its own.
- **Ear-worn sensors:** research hearing-aid IMUs reach a stride-time error of about 12 ± 32 ms. AirPods, however, stream only about 25 Hz and drop samples.

**Sample rate:** mean cadence and mean stride time survive low rates (walking detection works at 10 Hz). Stride-time variability is limited more by event-detection error and stride count than by sampling at 60 Hz.

### Cited Findings
- **Phone in pocket (Manor et al. 2018).** An iPhone app recorded accelerometer, gyroscope and magnetometer at 100 Hz with the phone in a pants pocket. 14 healthy adults aged 22-35 did three 45-s trials.
  - App stride times vs GAITRite: r = .98.
  - Error: mean 16.9 ms (SD 9.0), unaffected by walking condition or pocket tightness.
  - Test-retest ICC: .82-.94, in lab and at home.
  - Home trials averaged 21.6 strides after turns were removed.
  - Stride-time variability (CV) was not validated.
  - [JMIR mHealth uHealth, Jan 2018] — [PubMed / DOI 10.2196/mhealth.8815](https://doi.org/10.2196/mhealth.8815); [PMC full text](https://pmc.ncbi.nlm.nih.gov/articles/PMC5811655/)
- **Placement comparison (Silsupadol et al. 2017).** 34 healthy adults walked a 10-m GAITRite walkway at three speeds.
  - Reliability: excellent for body and belt placements (ICC ≥ 0.90); good to excellent for bag, hand and pocket (ICC ≥ 0.69).
  - For the body placement, correlations with GAITRite were r = 0.89 (step length), 0.98 (step time), 0.96 (velocity) and 0.87 (cadence).
  - Conclusion: phone gait measures are "most valid when placed on the body, in a bag, or on a belt".
  - [Gait Posture, Sep 2017] — [PubMed / DOI 10.1016/j.gaitpost.2017.09.030](https://doi.org/10.1016/j.gaitpost.2017.09.030)
- **Variability is the weak spot (Rashid et al. 2021).** A smartphone app was compared with 3D motion capture in 30 healthy adults. Step time, step length, speed and periodicity were moderate to excellent (0.55 ≤ r ≤ 0.98). However, "step variability and asymmetry parameters during both gait tasks generally showed poor validity and reliability". [Sensors, Dec 2021] — [PubMed / DOI 10.3390/s22010124](https://doi.org/10.3390/s22010124)
- **Apple iPhone Mobility metrics (white paper, May 2022)** — [Apple, Measuring Walking Quality Through iPhone Mobility Metrics](https://www.apple.com/healthcare/docs/site/Measuring_Walking_Quality_Through_iPhone_Mobility_Metrics.pdf):
  - **Method:** each participant carried two iPhones (hip clip, front or back pocket, or waist bag) over a ProtoKinetics Zeno pressure mat. Cohort A was older adults: design N = 359, validation N = 179, mean age 74.7.
  - **Validation results:**
    - Walking speed: error SD 0.15 m/s, ICC 0.92.
    - Step length: error SD 0.05 m, ICC 0.84.
    - Double support: error SD 2.95%, ICC 0.53.
    - Pedometer step-count correlations: above 0.96.
  - **Reference cadence in these older adults:** 101.6 ± 10.5 steps/min slow, 114.9 ± 9.7 self-selected, 123.4 ± 9.6 fast (6-minute walk).
  - **Placement:** metrics need "a tight coupling of a device to a user's center of mass". Carrying the phone "in a pocket close to the hip" gives more estimates than carrying it "in hand or in a backpack or purse".
- **Smartphone gait in patient groups:**
  - A 2021 Parkinson's review of 31 studies reported strong validity and good-to-excellent reliability, but only 22% of the studies reported reliability at all. [J Med Syst, Aug 2021] — [DOI 10.1007/s10916-021-01760-5](https://doi.org/10.1007/s10916-021-01760-5)
  - A 2024 study in 50 older, Parkinson's and stroke adults found correlations as low as r = 0.35 and ICC as low as 0.22 when assistive devices were used. [Sensors, Sep 2024] — [DOI 10.3390/s24175839](https://doi.org/10.3390/s24175839)
- **Wrist (Watch Walk, Chan et al. 2022).** An AX3 wrist accelerometer at 100 Hz, validated using 78,822 UK Biobank participants.
  - Step time vs GAITRite MAPE: 1.2% (texting) to 4.8% (free arm swing).
  - Walking speed MAPE: 3.0-4.4%.
  - Test-retest ICC: median cadence 0.85, step regularity 0.71, stride regularity 0.68.
  - [Sci Rep, Oct 2022] — [PubMed / DOI 10.1038/s41598-022-20327-z](https://doi.org/10.1038/s41598-022-20327-z); [PMC full text](https://pmc.ncbi.nlm.nih.gov/articles/PMC9551062/)
- **Wrist in daily life (Kluge et al. 2024).** 83 people (Parkinson's, MS, hip fracture, COPD, heart failure and healthy older adults) were recorded for 2.5 h.
  - Best gait-detection sensitivity was 0.55-0.81 at the wrist, against 0.71-0.91 at the lower back.
  - Performance was worse with major gait impairment and with bilateral walking aids.
  - [JMIR Form Res, May 2024] — [PubMed / DOI 10.2196/50035](https://doi.org/10.2196/50035)
- **Ear-worn research sensors:**
  - **EarGait (Seifer et al. 2023).** Hearing-aid IMU vs optical motion capture in healthy young and older adults. The improved algorithm detected 99.8% of initial contacts with a mean stride-time error of 12 ± 32 ms. A step-laterality fix gave "a 50% reduction in stride time error". The algorithm was "robust to different study populations and sampling frequencies but is sensitive to walking speed". It is released as an open-source Python toolbox. [Sensors, Jul 2023] — [PubMed / DOI 10.3390/s23146565](https://doi.org/10.3390/s23146565)
  - **Seifer et al. 2025 (end-to-end pipeline).** Gait sequences were detected 91% of the time. Stride time and step length errors were about 4%, and velocity error was 5.7%. Code: github.com/mad-lab-fau/eargait. [IEEE EMBC, Jul 2025] — [PubMed / DOI 10.1109/EMBC58623.2025.11254014](https://doi.org/10.1109/EMBC58623.2025.11254014)
  - **Decker et al. 2024 (mEar).** An ear-worn accelerometer with a neural network in 53 healthy adults. Initial and final contact F1 scores were 99% and 91%, with "good to excellent validity" for stride time and length. [Sensors, Oct 2024] — [PubMed / DOI 10.3390/s24196442](https://doi.org/10.3390/s24196442)
  - **Fawden et al. 2025.** 68 participants with a range of ages and movement-related conditions. A new ear-IMU algorithm was more robust to turning and to head turns. [Sensors, Jun 2025] — [PubMed / DOI 10.3390/s25123629](https://doi.org/10.3390/s25123629)
- **AirPods specifically:**
  - **Measured rate.** The TWSCardio authors examined the AirPods Pro IMU stream as received by an iPhone. They found it "uniformly sampled at 40 ms intervals with a 25 Hz sampling rate", with gaps "by multiples of 40 ms, indicating data loss". They attribute this to the Bluetooth packet interval. [arXiv 2501.06744, 12 Jan 2025] — [arXiv](https://arxiv.org/abs/2501.06744)
  - **Apple documentation.** Apple gives no headphone-motion rate. WWDC23 says headphone "motion data is delivered to you from one bud at a time", and a SensorLocation value with each sample "lets you identify which bud sourced the data". [WWDC23 session 10179, Jun 2023] — [Apple WWDC23, What's new in Core Motion](https://developer.apple.com/videos/play/wwdc2023/10179/)
- **Minimum rate for walking detection (Straczkiewicz et al. 2023).** The method interpolates data "to impose a uniform sampling frequency of 10 Hz". Raising the rate "to 15 Hz has marginal impact on accuracy metrics". It was validated on 20 public datasets (thigh, waist, chest, arm and wrist placements), with sensitivity 0.92-0.97 and specificity typically above 0.95. [npj Digit Med, Feb 2023] — [PubMed / DOI 10.1038/s41746-022-00745-z](https://doi.org/10.1038/s41746-022-00745-z); [PMC full text](https://pmc.ncbi.nlm.nih.gov/articles/PMC9950089/)
- **Own computation: sampling rate.** I snapped the PhysioNet heel-strike times to a sampling grid to see how the sample rate changes measured stride-time CV (ALS vs control, median CV):
  - Original force-sensor data: 4.86% vs 2.53%, AUC 0.84.
  - 60 Hz grid: 4.89% vs 2.61%, AUC 0.83.
  - 25 Hz grid (AirPods-like): 5.05% vs 2.95%, AUC 0.80.
  - Source data: [PhysioNet gaitndd](https://physionet.org/content/gaitndd/1.0.0/)
- **Own computation: detection error.** Gaussian timing error added to every heel strike affects results more than sampling does (median CV, ALS vs control):
  - 10 ms error: control CV 2.85%, AUC 0.82.
  - 17 ms error: control CV 3.40%, AUC about 0.79-0.80.
  - 25 ms error: control CV 4.16%, AUC 0.74-0.77.
  - Source data: [PhysioNet gaitndd](https://physionet.org/content/gaitndd/1.0.0/)
- **Own computation: number of strides.** Stride-time CV from N consecutive strides, compared with the full record:
  - 10 strides: biased -26%, SD 26%, AUC 0.78.
  - 20 strides: biased -18%, SD 22%, AUC 0.80.
  - 30 strides: biased -11%, SD 20%, AUC 0.81.
  - 50 strides: biased -5%, SD 11%, AUC 0.83.
  - 100 strides: biased -4%, SD 6%, AUC 0.84.
  - Source data: [PhysioNet gaitndd](https://physionet.org/content/gaitndd/1.0.0/)

### Inferences
- **Placement ranking for a home walking test**, best first. Each depends on how firmly the phone is coupled to the trunk or hip:
  1. Belt or waistband clip at the lower back or hip.
  2. A snug trouser pocket.
  3. Held flat against the sternum.
  4. Held in the hand.
  5. A bag.

  The watch is a second-best source of gait timing because of arm swing. AirPods are the weakest: about 25 Hz, data loss, and one bud at a time.
- **What a 60 Hz browser stream supports:**
  - Steps, cadence and mean stride time: fine.
  - Stride-time CV: only with a fixed trunk or hip placement, at least about 50 clean strides (roughly 60-90 s of straight walking at 1.1-1.3 s per stride, with turns removed), and a clear disclaimer.
  - Absolute CV values from a phone will read higher than force-sensor values, because detection error inflates CV in controls. Do not reuse clinical cut-offs from footswitch studies. Compare a user against their own baseline instead.
- **The 16.9 ms Manor error** is a mean stride-time error, not the SD of the error at each heel strike. The 17 ms jitter scenario above is illustrative, not a measured phone error model.

### Gaps
- No study found validates AirPods (CMHeadphoneMotionManager) stride timing against a walkway or motion capture. The ear-worn evidence comes from research hearing aids and earables with their own sampling.
- No direct comparison of phone stride timing at 60 Hz vs 100 Hz was found. The sampling effect above is simulated.
- None of the phone or watch validations above included people with ALS.

## Which simple, explainable algorithms detect steps and stride time from accelerometer or gyroscope data?

### Takeaway
Three explainable families cover a hackathon build:
1. **Peak or trough picking** on low-pass-filtered vertical or magnitude acceleration, as validated for a pocketed iPhone by Manor et al. 2018.
2. **Autocorrelation** of trunk acceleration for cadence, step and stride regularity, and symmetry (Moe-Nilssen and Helbostad 2004).
3. **Frequency-band walking detection** on the acceleration magnitude, using the 1.4-2.3 Hz step band at 10 Hz (Straczkiewicz 2023). Its open-source code is available.

### Cited Findings
- **Manor et al. 2018 pocket algorithm** — [PMC full text](https://pmc.ncbi.nlm.nih.gov/articles/PMC5811655/) [Jan 2018]:
  1. Rotate accelerometer and gyroscope data to an earth frame with the attitude quaternion, so z is roughly vertical.
  2. Butterworth-filter the z axis. The cut-off is not reported.
  3. Heel strike = the trough nadir after each relatively high peak; toe-off = the trough nadir after each relatively low peak.
  4. Stride time = the number of samples between consecutive same-foot heel strikes, divided by 100 Hz.
  5. Flag turns from the filtered z-axis gyroscope: a segment between zero crossings counts as a turn when area × duration exceeds 2.00 radian-seconds.
- **Moe-Nilssen and Helbostad 2004.** A lower-trunk triaxial accelerometer signal is transformed to a horizontal-vertical frame and "analyzed by an unbiased autocorrelation procedure to obtain cadence, step length, and measures of gait regularity and symmetry". [J Biomech, Jan 2004] — [PubMed / DOI 10.1016/s0021-9290(03)00233-1](https://doi.org/10.1016/s0021-9290(03)00233-1)
- **The same autocorrelation variability measure in use:**
  - It classified fit vs frail older adults 80% correctly (sensitivity 0.75, specificity 0.85). [Gait Posture, Feb 2005] — [PubMed / DOI 10.1016/j.gaitpost.2004.01.013](https://doi.org/10.1016/j.gaitpost.2004.01.013)
  - It detected two-year increases in variability in older adults; coefficients near 1.0 mean low variability. [Gait Posture, Jun 2019] — [PubMed / DOI 10.1016/j.gaitpost.2019.06.005](https://doi.org/10.1016/j.gaitpost.2019.06.005)
- **Straczkiewicz et al. 2023 parameters** — [PMC full text](https://pmc.ncbi.nlm.nih.gov/articles/PMC9950089/) [Feb 2023]:
  - Linear interpolation to 10 Hz, then the vector magnitude. The extracted formula ends in "−1", which suggests 1 g is subtracted.
  - 1-s non-overlapping windows must exceed a peak-to-peak amplitude of A = 0.3 g.
  - Continuous wavelet transform with a generalized Morse wavelet (γ = 3, P² = 60).
  - The dominant frequency must fall in the 1.4-2.3 Hz step band for T consecutive windows: T = 3 for smartphones and 6 for smartwatches.
  - Code: Python `forest` (github.com/onnela-lab/forest) and MATLAB `find_walking` (github.com/MStraczkiewicz/find_walking).
- **Watch Walk wrist pipeline** — [PMC full text](https://pmc.ncbi.nlm.nih.gov/articles/PMC9551062/) [Oct 2022]:
  - Euclidean norm, minus the 60-s mean amplitude.
  - Fifth-order Butterworth 20 Hz low-pass.
  - A 0.25-2.5 Hz passband for step peaks. The paper calls it a low-pass filter, which is inconsistent with having two edges.
  - Non-overlapping 4-s windows and a support vector machine activity classifier.
  - Peaks must alternate, agree with the autocorrelation step time, and pass adaptive thresholds. The last rule is from the earlier researcher's full-text read.
- **Lee et al. 2024.** Gait speed from a pocketed phone using an inverted-pendulum step-length model. A coefficient adjustment narrowed the limits of agreement from 0.50 to 0.34 m/s in 12 young and 12 older adults. [JMIR mHealth uHealth, Aug 2024] — [PubMed / DOI 10.2196/52166](https://doi.org/10.2196/52166)
- **The ALS-specific step algorithm** found in this search is wavelet-based heel-strike detection for an ankle-worn accelerometer (Straczkiewicz 2025, above). [Nov 2025] — [DOI 10.1038/s41598-025-24664-7](https://doi.org/10.1038/s41598-025-24664-7)

### Inferences
- **A pipeline buildable in a browser tonight** (JavaScript, roughly 150 lines):
  1. Store `accelerationIncludingGravity`, `rotationRate` and `event.timeStamp` for every devicemotion event.
  2. Resample to a uniform 60 Hz using the timestamps.
  3. Estimate gravity with a roughly 0.3 Hz low-pass and project acceleration onto it to get vertical acceleration. A simpler option is magnitude minus its mean.
  4. Low-pass at about 3 Hz, or band-pass 0.5-3 Hz as Watch Walk does.
  5. Pick peaks with a refractory period of about 0.3 s and an adaptive prominence threshold. Each peak is one step for trunk or hip placement; a stride is two steps.
  6. Cross-check the step period against the first autocorrelation peak, and the stride period against the second.
  7. Mark turns where yaw rate, approximated as the rotation-rate vector dotted with the unit gravity vector, stays above a threshold.
  8. Drop turn segments and the first and last 2-3 steps.
  9. Report steps, cadence, mean stride time, stride-time CV (only when there are at least 50 clean strides), and step and stride regularity.
- **Gait speed** is most robust measured the WatchALS way: distance over time on a measured course. It needs no step-length model. The sensor can then supply cadence and variability on top.
- **Quick checks tonight:**
  - Walk to a metronome at 100 and 120 steps/min, and check that the measured cadence matches.
  - Count steps on video and compare with the detected count.
  - Run the variability code on the PhysioNet ALS and control stride files.

### Gaps
- None of these simple algorithms has been validated with a phone in ALS. The only ALS-specific step algorithm found is for ankle-worn sensors.
- The Manor paper does not report its Butterworth order or cut-off, so the cut-off values suggested above are engineering choices, not values taken from the paper.

## Which OS-level gait and motor metrics exist (HealthKit mobility metrics, Walking Steadiness, six-minute walk, CMMovementDisorderManager, Health Connect), and can a third-party app read them?

### Takeaway
- **iOS** computes passive gait metrics automatically: walking speed, step length, double support, asymmetry, Walking Steadiness, and an Apple Watch six-minute-walk estimate. A native iOS app can read them with HealthKit permission. They cannot be reached from a web page. They appear only after real-world carrying (phone near the waist, flat ground, height entered). Walking Steadiness is weekly and read-only.
- **CMPedometer** gives live cadence natively.
- **Android Health Connect** has steps, cadence, speed and distance but no gait-quality types.
- **Apple's tremor and dyskinesia API** runs only on the watch, needs an entitlement from Apple, and Apple restricts it to patients clinically diagnosed with a movement disorder. It does not fit an ALS screening hackathon.

### Cited Findings
- **iPhone 8 and later on iOS 14** estimate walking speed, step length, double support time and walking asymmetry from the built-in motion sensors. "For users who have received at least one walking bout estimate, on average over 80 percent of them will receive at least five estimates of their Mobility metrics per day." The metrics are off when Wheelchair mode is on. [May 2022] — [Apple white paper](https://www.apple.com/healthcare/docs/site/Measuring_Walking_Quality_Through_iPhone_Mobility_Metrics.pdf)
- **iPhone asymmetry classification.** An iPhone asymmetry threshold "of 35 percent showed a positive predictive rate of 83.4 percent (348 true positives from 417 ...)". The same sentence gives "a false negative rate of 9.8 percent (262 false positives from 2671 ...)", which mixes "false negative" and "false positives". Cohort B was 51 younger adults wearing a locked knee brace to simulate asymmetry. [May 2022] — [Apple white paper](https://www.apple.com/healthcare/docs/site/Measuring_Walking_Quality_Through_iPhone_Mobility_Metrics.pdf)
- **`walkingAsymmetryPercentage`** (iOS 14+, watchOS 7+). It is "the percent of time that a user's steps with one foot are faster or slower than the other foot". It is recorded automatically on iPhone 8 or later when the user carries "their phone near their waist—such as in a pocket" and walks steadily on flat ground. Placement side is stored in `HKMetadataKeyDevicePlacementSide`, and there are "10 to 30 walking asymmetry samples on a typical day". [Apple docs, retrieved 2026-11-07] — [walkingAsymmetryPercentage](https://developer.apple.com/documentation/healthkit/hkquantitytypeidentifier/walkingasymmetrypercentage)
- **`walkingDoubleSupportPercentage`** (iOS 14+). It is the percentage of time both feet are on the ground, typically "between 20% and 40%". It has the same pocket and flat-ground conditions and 10 to 30 samples a day. [Apple docs, retrieved 2026-11-07] — [walkingDoubleSupportPercentage](https://developer.apple.com/documentation/healthkit/hkquantitytypeidentifier/walkingdoublesupportpercentage)
- **`appleWalkingSteadiness`** (iOS 15+). Values run from 0.0 to 1.0. iPhone 8 or later records it with the phone near the waist on flat ground and the user's height set. One sample is made every 7 days, or less often when there is too little data. "Walking Steadiness samples are read-only": apps may request read permission but cannot save samples. [Apple docs, retrieved 2026-11-07] — [appleWalkingSteadiness](https://developer.apple.com/documentation/healthkit/hkquantitytypeidentifier/applewalkingsteadiness)
- **`sixMinuteWalkTestDistance`** (iOS 14+). Apple Watch Series 3 or later records a weekly estimate from passive motion and workout data. The maximum estimated distance is 500 m. Estimates need the watch worn at least 8 h a day, 3 days a week, with the 8-hour threshold met at least 10 times in the previous 4 weeks. Apps may also save their own clinic-test results. [Apple docs] — [sixMinuteWalkTestDistance](https://developer.apple.com/documentation/healthkit/hkquantitytypeidentifier/sixminutewalktestdistance)
- **`CMPedometerData.currentCadence`** (iOS 9+, watchOS 2+) gives "The rate at which steps are taken, measured in steps per second" during live updates. It is `nil` for historical queries and on unsupported devices. [Apple docs, retrieved 2026-11-07] — [currentCadence](https://developer.apple.com/documentation/coremotion/cmpedometerdata/currentcadence)
- **`CMMovementDisorderManager`** (watchOS 5+) — [Apple docs, CMMovementDisorderManager](https://developer.apple.com/documentation/coremotion/cmmovementdisordermanager); [monitorKinesias(forDuration:)](https://developer.apple.com/documentation/coremotion/cmmovementdisordermanager/monitorkinesias(forduration:)):
  - It measures "a resting Parkinsonian tremor in the 3-7 Hz range and choreiform dyskinetic symptoms".
  - It requires an entitlement from Apple.
  - Apple's instruction: "Only collect data from patients clinically diagnosed with a movement disorder."
  - The maximum monitoring duration is 7 days, and results are stored for 7 days.
- **Raw high-rate data on Apple Watch.** CMBatchedSensorManager gives "800 Hz accelerometer and 200 Hz device motion, compared to 100 Hz with the existing CMMotionManager". It is supported on Apple Watch Series 8 and Ultra and delivers "a batch of data per second". "You need to have an active HealthKit workout session to get data." [WWDC23, Jun 2023] — [Apple WWDC23 session 10179](https://developer.apple.com/videos/play/wwdc2023/10179/)
- **Headphones.** `CMHeadphoneActivityManager` (iOS 18+) reports motion-activity changes from headphones "such as AirPods Pro 2 or AirPods 4". `CMHeadphoneMotionManager` streams attitude, user acceleration and rotation rate. [Apple docs; WWDC23] — [Apple sample, Getting motion-activity data from headphones](https://developer.apple.com/documentation/coremotion/getting-motion-activity-data-from-headphones); [WWDC23 session 10179](https://developer.apple.com/videos/play/wwdc2023/10179/)
- **Android Health Connect.** The activity types include `StepsRecord`, `StepsCadenceRecord`, `SpeedRecord`, `DistanceRecord`, `ExerciseSessionRecord`, `ActivityIntensityRecord`, `FloorsClimbedRecord`, `ElevationGainedRecord` and `WheelchairPushesRecord`. The data-type table has no gait-quality type: no asymmetry, double support, step length, steadiness or six-minute walk. Reading in the background needs `android.permission.health.READ_HEALTH_DATA_IN_BACKGROUND`, and reading data older than 30 days needs `android.permission.health.READ_HEALTH_DATA_HISTORY`. [Android Developers, retrieved 2026-11-07] — [Health Connect data types](https://developer.android.com/health-and-fitness/guides/health-connect/plan/data-types)
- **Google Fit.** Google's FAQ says "The Google Fit APIs, including the Google Fit REST API, will be deprecated in 2026" and "Developers cannot sign up to use these APIs as of May 1, 2024". It points to Health Connect, the Recording API, and the cloud Google Health API. [Google, retrieved 2026-11-07] — [Google Fit migration FAQ](https://developer.android.com/health-and-fitness/health-connect/migration/fit/faq). A third-party post (Sahha, Aug 2026) says Google had still not published an exact turn-down date — [Sahha](https://sahha.ai/blog/google-fit-api-sunset-migration/)

### Inferences
- **The realistic OS-metric path in a few hours** is a small native iOS (SwiftUI) app, or a Health app export. It would read recent `walkingSpeed`, `walkingStepLength`, `walkingAsymmetryPercentage`, `walkingDoubleSupportPercentage` and `appleWalkingSteadiness` values and show trends. It only produces data on an iPhone that has already been carried for weeks, so it suits a demo on a team member's own phone, not a brand-new user.
- **None of these OS metrics was validated in ALS.** Treat them as passive context alongside the active test, not as a referral criterion.
- **Do not use the tremor API.** ALS is not its target population, and screening undiagnosed users would breach Apple's stated use restriction.

### Gaps
- I did not fetch the individual HealthKit pages for `walkingSpeed` and `walkingStepLength`. Their behaviour is taken from the Apple white paper.
- No exact Google Fit turn-down date was found in official sources.
- No evidence was found on how often an ALS patient's own phone produces these passive metrics, for example when they use a cane or walk slowly.

## Can a mobile web page (DeviceMotionEvent) record a walking test reliably, given its rates and what happens when the screen locks or the page is in the background?

### Takeaway
Yes, for a short, supervised test with the screen on. Chrome and iOS Safari deliver devicemotion at about 60 Hz after an iOS permission tap, which is enough for steps, cadence and mean stride time. Both engines stop motion events as soon as the page is hidden, which includes screen lock, switching apps and background tabs. The page must therefore stay visible throughout, ideally holding a Screen Wake Lock. Passive background monitoring is impossible from the web, and AirPods or Apple Watch motion cannot be read from a web page.

### Cited Findings
- **W3C Device Orientation and Motion** (Candidate Recommendation Draft, 26 October 2026) — [W3C TR orientation-event](https://www.w3.org/TR/orientation-event/):
  - Implementations must "fire events only when a navigable's active document's visibility state is "visible"".
  - The event algorithm says "If document's visibility state is not "visible", return".
  - devicemotion fires "At an implementation-defined interval". A maximum sampling-frequency cap is still being decided.
  - Precision should be limited to "no more than 0.1 m/s2" for acceleration and "no more than 0.1 deg/s" for rotation rate.
  - `requestPermission()` is rejected with "NotAllowedError" when permission is still "prompt" and there is no transient activation (a user tap).
- **Chromium (Blink)** (main branch, checked 2026-11-07):
  - Device motion is pumped at `kDefaultPumpFrequencyHz = 60`, and generic sensors are capped at `kMaxAllowedFrequency = 60.0`.
  - `SendStopMessage()` "gets called both when the page visibility changes and if all device motion event listeners are unregistered". It stops the accelerometer, linear-acceleration and gyroscope sensors.
  - Sources: [device_sensor_event_pump.h](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/modules/device_orientation/device_sensor_event_pump.h); [sensor_traits.h](https://github.com/chromium/chromium/blob/main/services/device/public/cpp/generic_sensor/sensor_traits.h); [device_motion_event_pump.cc](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/modules/device_orientation/device_motion_event_pump.cc)
- **WebKit on iOS** (main branch, checked 2026-11-07):
  - `kMotionUpdateInterval = 1.0f / 60.0f` is used for Core Motion device-motion and accelerometer updates.
  - `Page::setIsVisibleInternal()` calls `suspendDeviceMotionAndOrientationUpdates()` when the page becomes not visible, and `resumeDeviceMotionAndOrientationUpdates()` when it becomes visible (iOS family only).
  - Sources: [WebCoreMotionManager.h](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/platform/ios/WebCoreMotionManager.h); [WebCoreMotionManager.mm](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/platform/ios/WebCoreMotionManager.mm); [Page.cpp](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/page/Page.cpp)
- **Screen Wake Lock API** is "Baseline 2025 / Newly available" ("Since March 2025"), HTTPS only. Locks "are automatically released when document becomes inactive", so re-acquire on `visibilitychange`. Requests can be rejected or released because of "power save mode or low battery level". [MDN, last modified Sep 11, 2026] — [MDN Screen Wake Lock API](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API)
- **Wake lock in home-screen web apps.** Secondary sources say it did not work in standalone home-screen web apps on iOS 16.4-18.4 and was fixed in iOS 18.4 (released 2025-03-31). I did not open the WebKit bug. [2025] — [Progressier PWA demo](https://progressier.com/pwa-capabilities/screen-wake-lock); [web-features explorer](https://web-platform-dx.github.io/web-features-explorer/features/screen-wake-lock)
- **How validated apps did it.** The validated pocket-phone and WatchALS studies used native apps sampling at 100 Hz, not web pages. [2018; 2026] — [Manor 2018 PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC5811655/); [WatchALS PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC13423962/)

### Inferences
- **A browser walking test buildable tonight:**
  1. Serve over HTTPS.
  2. A "Start" button calls `DeviceMotionEvent.requestPermission()` (iOS) and `navigator.wakeLock.request('screen')`, then a spoken or vibrating countdown runs.
  3. Record 60-90 s of walking: back and forth over a measured 10 m course with a timer, or straight down a hallway.
  4. Stop with an audio cue, then process on the device with the pipeline in the algorithms section.
  5. If `document.visibilityState` becomes hidden, abort the test and say so.
  6. Use the gaps in `event.timeStamp` rather than the constant `event.interval` (about 16.7 ms) to detect dropped samples.
- **Placement for a screen-on phone:** a belt or waistband clip, or the phone held flat on the sternum, is safer than a loose pocket. With the screen on in a pocket, accidental touches can end or corrupt a test, so show a full-screen touch shield.
- **A per-hand tapping test is easy in a browser.** Use two on-screen targets, alternating index and middle fingers, 20 s per hand, as in WatchALS. Log touch or pointer timestamps, count taps, and compute the inter-tap-interval CV and the hit rate.
  - Run 1-2 practice runs first: WatchALS saw practice-related improvement in fine-motor scores in both groups.
  - Compare against the user's own baseline.
- **Not doable from the web tonight:**
  - Passive all-day gait.
  - AirPods head motion: there is no web API for headphone motion. That needs a native app using `CMHeadphoneMotionManager`, and gives about 25 Hz with dropouts.
  - Apple Watch sensors.
  - HealthKit or Health Connect metrics.
- **Honest framing for judges:** the tool can show that it captures a timed walk (gait speed), cadence, stride-time variability and tapping. Similar tasks are reliable in ALS research and differ between ALS and controls in small studies. It is not a diagnostic test, and no referral threshold has been validated.

### Gaps
- No measured data was found on real-world devicemotion jitter or dropped events on current iPhones and Android phones. Teams should log `event.timeStamp` differences on their own devices.
- It was not checked whether Firefox for Android or Samsung Internet behave like Chrome on rate and visibility.
- No study found validates a browser-based gait test against a walkway.
