# EEG and BCI datasets: quick characterisation

Script: `characterise_eeg_bci.py` (about 15 s, `python -I`). Numbers: `results.json`. Only EDF headers were read, in memory; nothing was extracted.

## What it is
- **EEGET-ALS** (CC0): EEG plus eye tracking during imagined and real movements and eye-typing. 6 people with ALS, all locked-in (paper: ALSFRS-R 0 or 1), recorded at home; 5 of them were recorded 10 times over a median of 16 weeks. 170 controls were recorded once in a lab.
- **bigP3BCI** (CC BY 4.0): EEG from 20 brain-speller studies, 327 people. The 48 with ALS are in Studies B, F, L and N.

## What it tells us
- **ALSFRS-R in bigP3BCI:** known for 29 of the 48 people with ALS: median 20 (IQR 3 to 33, range 0 to 46); 12 score below 12. It never changes across repeat sessions (18 people), so it is a one-off value.
- **EEGET-ALS:** the paper reports no ALS-versus-control EEG or eye-tracking difference. Movement decoders trained on controls do worse on ALS: 3-class balanced accuracy 0.59 versus 0.69 to 0.71 (chance 0.33).
- **Verdict:** neither dataset helps early detection or our weekly tests. All ALS participants are diagnosed and mostly advanced, and there is no repeated functional score to calibrate an MDC.

## What more we can extract for the tool
- Late stage only: eyes and EEG still work at ALSFRS-R 0. So when speech and hand scores fall, the tool should prompt an AAC (eye-gaze) referral, and the app should accept eye-gaze or switch input.

## Limits
- Tiny, advanced ALS samples (6 and 48), recorded at home versus in the lab.
- Unmatched controls: bigP3BCI median age 23. In EEGET-ALS, 111 of 170 controls are aged 25 or under.
