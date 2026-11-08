# ALS Focus + Seattle: extra evidence for the tool

Script: `focus_seattle.py` (`python -I`). Numbers: `results.json` (group-level only; ALS Focus may not be redistributed).

## What it is
- **ALS Focus Wave 4:** a US opt-in online survey, 2020-21. 440 people with ALS recalled their latest clinic ALSFRS-R and vital capacity, and answered health-status and telehealth surveys.
- **Seattle:** 143 patients, 1987-89. Clinicians rated the ALS Severity Scale (speech, swallowing, arms, legs; 1 to 10) about every 3 months. It records symptom dates per body region and medical history.

## What it tells us
- **Score awareness:** only 39% (170/440) ever knew their ALSFRS-R score.
- **Recall is noisy:** 35% (12/34) of re-reports of the same test gave a different score. The scatter around each person's trend gives an MDC95 of about 6 points (24 people).
- **Baseline decline:** median 0.35 points/month (n = 158); bulbar onset 0.44 vs limb 0.30 (p = 0.02).
- **Telehealth:** 78% (166/212) would keep using it, even after losing speech (77 to 80%). 80 of 167 telehealth users had already done the ALSFRS-R remotely.
- **Seattle severity scale:** 95% of 3-month changes stay within 2 points per domain (MDC95 1.4 to 1.6).
- **Spread before diagnosis:** at diagnosis 45% (62/139) already had 2 or more body regions affected, 24% for 6 months or more. The median gap from the first to the second region was 12 months (IQR 4 to 30.5, n = 131).
- **Who diagnosed:** neurologists or ALS specialists made 92% (131 of 142) of first diagnoses. The file has no referral dates, so it cannot place the delay before or after referral.
- **Surgery in the symptom window:** spine or limb surgeries were 11 times as frequent at ages inside the symptom-to-diagnosis window as in earlier adult life. The rate ratio is 11.1 (95% CI 5.0 to 24.2): 12 surgeries in 11 people, 7 of them neck or spine. Other surgeries, a check on recall bias, were 2.1 times as frequent (1.3 to 3.5).

## What more we can extract for the tool
- Red flags: neck, spine or limb surgery during unexplained weakness, and a second body region becoming affected.
- Show patients their own score.
- Noise floor: about 2 points per region on the 1-10 scale.

## Limits
- Self-selected, slowly progressing, long-duration cohorts (ALS Focus median -0.18 points/month, n = 49).
- ALS Focus scores are recalled clinic scores, with no item scores and no survey dates.
- Seattle ages are whole years, so a surgery up to about a year after diagnosis can fall in the window. Its data are recall-biased and reflect 1980s care.
- Associations only.
- Seattle does not record the number of doctors seen or misdiagnoses.
