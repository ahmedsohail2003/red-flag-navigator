# ALS progression data (DREAM / PRO-ACT, CASI chapter 17)

Script: `progression_analysis.py` (about 2 min, `python -I`). Numbers: `results.json`. Figure: `fig_onset_vs_dfrs.png`.

## What it is
1,822 people from ALS drug trials (1,197 train, 625 test). The predictors summarise the first 3 months in the trial:
- ALSFRS total and 9 items
- FVC, SVC, weight, height, blood pressure, breathing rate
- onset site and symptoms, demographics, family history
- Onset.Delta: days from first symptom to trial entry

There are no lab columns. The target, dFRS, is the later rate of change: median -0.59 points/month (IQR -1.03 to -0.25). The bulbar-onset median is -0.80 (n = 383); limb onset is -0.55 (n = 1,429).

## What it tells us
- **Models:** random forest test MSE is 0.259 against 0.320 for always guessing the mean (r = 0.44). Boosting gets 0.262 and lasso 0.278, matching the book's range of 0.25 to 0.30.
- **Onset.Delta dominates** (importance 0.15; the next predictor is 0.03). A longer time from onset to entry goes with slower decline: median -0.91 points/month under 12 months (n = 434), -0.28 at 36 months or more (n = 280). That is +0.25 per doubling of the time, adjusted for site, age and score.
- **Noise:** scores vary by about 1.1 points between visits, so a real drop must reach about 3 points (MDC95). That takes about 5 months for the median patient, 3 for fast progressors and 12 for slow ones. In the first ~80 days only 17% dropped that much.

## What more we can extract for the tool
- A pre-referral rate, (40 - score) / months since onset, predicts later speed (Spearman -0.35).
- Long-delay patients progress slowly, and their decline takes about a year to beat the noise. So referral must rest on red flags, not on waiting for a measured drop.
- Weight noise is about 0.6 kg (MDC 1.7 kg) and FVC noise 0.16 L (MDC 0.43 L). On average, weight did not fall early on.

## Limits
- Selected trial patients only.
- Onset-to-entry is not diagnostic delay, and left truncation (late enrollees must still qualify) inflates its link. It is an association, not a cause.
- The noise estimate includes real short-term change.
- The scale is the 40-point ALSFRS, not ALSFRS-R.
- Missing values were imputed, and sex is unknown for 47%.
