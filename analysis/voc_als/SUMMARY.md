# VOC-ALS voice analysis

Script: `voc_als_analysis.py` (about 70 s, `python -I`). Numbers: `results.json` (group-level only; VOC-ALS may not be redistributed).

## What it is
Phone recordings from one clinic visit in Naples: 101 people with ALS and 50 age- and sex-matched controls. One voice filed as both a patient and a control (CT050 = PZ091) was dropped. Each person held 5 vowels and repeated /pa/, /ta/ and /ka/ in one breath. Labels include the ALSFRS-R speech item (52 patients still rated normal) and ready-made pitch and noise features.

## What it tells us
- Voice separates ALS from controls only moderately. The best single feature is pitch wobble during /pa-ta-ka/: AUC 0.72 (95% CI 0.64 to 0.81). A 10-feature model reaches a cross-validated AUC of 0.70 (0.62 to 0.79).
- Severity: syllables per breath (Spearman 0.61), vowel length (0.51) and syllable rate (0.46) fall as the speech score drops.
- Earlier detection: in the 52 patients whose speech is still rated normal, rate, breath and vowel length match controls (AUC 0.47 to 0.53). Only pitch wobble hints at a difference (AUC 0.67, 0.56 to 0.78), and it fails correction for testing 55 features.

## What more we can extract for the tool
- A weekly "pa-ta-ka" syllable-rate check. Same-visit repeats agree closely (ICC 0.93), giving an MDC of about 0.37 syllables/s for the mean of three trains. Group medians differ by about 0.5 syllables/s per speech-item step, so a one-step decline should beat the MDC.
- Pitch wobble works only as a supporting flag: it repeats poorly (ICC 0.52).

## Limits
- One visit each, so there is no true test-retest and these MDCs are a floor.
- Patients were already diagnosed (median 15 months from onset); 27 of the 52 with normal speech already had bulbar signs on examination.
- Controls repeated syllables slowly (2.8/s), so it is not a maximum-speed test.
- One clinic, one phone, Italian speakers, no look-alike disease controls.
