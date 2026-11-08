# Evidence from real data

Code: `gait_evidence.py`, `diagnostic_delay.py`; numbers: `results.json`.

## A. Walking test (PhysioNet gait database)

16 controls, 13 ALS, 15 Parkinson's (PD), 20 Huntington's (HD); one 5-minute hallway walk each, left foot. Strides beyond median ± 3 scaled MAD removed (3-4.5% per group). The 20-s start trim removed nothing (files already start after 20 s).

| ALS vs control | Control median | ALS median | AUC (95% CI) | p |
|---|---|---|---|---|
| Mean stride time (s) | 1.08 | 1.27 | 0.95 (0.84-1.00) | 0.000006 |
| Stride-time CV (%) | 2.3 | 4.6 | 0.83 (0.64-0.96) | 0.002 |
| Swing % (lower in ALS) | 36.8 | 33.5 | 0.89 (0.76-0.99) | 0.0001 |

- **Other diseases.** Slow strides also set ALS apart from PD (AUC 0.87, 0.72-0.98) and HD (0.85, 0.70-0.97). Variability did not: CV AUC 0.53 vs PD, 0.32 vs HD (HD were more irregular). A high CV means "something neurological", not "ALS".
- **Test-retest noise** (controls, two 2.3-minute halves of one walk): CV within-person SD 0.29 points, MDC95 0.80 points (ALS-control gap: 2.3). Mean stride: SD 0.010 s, MDC95 0.028 s.

Figure: `fig_gait_cv.png`.

## B. Time from first symptom to diagnosis

- **ALS Focus** (US online survey 2020-21, 472 people): median 13 months (IQR 7-25). Bulbar onset 11 (6-17.5; 88 people), arm 11 (7-22.5; 167), leg 16 (9-30; 176).
- **Seattle cohort** (enrolled 1987-88, 142 patients): median 11 months (6-24); bulbar 13.5 (22 people), limb 10.5 (98).
- Variables: `p4_onset_date`, `p5_diag_date`, `p3_onset_location`; `DHXsx1D`, `DHXdx1D`, `DHXsx1`.

## Limits

- Small groups; best feature picked after looking; p-values not corrected.
- Not matched: ALS median age 62 vs 35, mostly men vs mostly women; with only controls aged 36+ (8), AUCs held (0.99 stride time, 0.83 CV).
- Patients were already diagnosed (median 13 months), not pre-diagnosis.
- Lab force sensors, not a phone; halves of one walk understate week-to-week noise.
- PD and HD are not typical ALS look-alikes; neuropathy, myelopathy and myopathy were not tested.
- Delays are recalled by diagnosed patients; Seattle is an old cohort of existing patients.
