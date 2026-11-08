# Pitch: Red-Flag Navigator (3 minutes)

Five parts in rubric order, about 494 spoken words: just over 3 minutes at a brisk pace (about 160 words a minute). The opening part is the densest (116 words for 35 seconds), so if a rehearsal runs long, trim there first. Timings are targets.

## Script

**[0:00 to 0:35] Clinical grounding**

In June 2024, Alex Chen, a Hamilton biology teacher, noticed his handwriting fading on the whiteboard. His family doctor suspected carpal tunnel. In December a hand surgeon found normal wrist nerve studies, but visible wasting of the thumb muscles and of the first dorsal interosseous, a muscle carpal tunnel cannot touch. He had the surgery anyway. Then came twitching, a foot catching on stairs and brisk reflexes. Nobody was careless: each visit treated one piece, and for about 16 months no one put the clues together. In February 2026 his physiotherapist finally did. He was diagnosed with ALS that July. Alex wants to keep teaching, cook Sunday dinner and reach his daughter's graduation. Every month counts.

**[0:35 to 1:20] Diagnostic value**

Red-Flag Navigator detects one thing: this person needs an EMG now. It scores findings across visits, each tied to the exact sentence it came from. The number is arithmetic, not AI: a general-population starting rate times published adjusted odds ratios from 6,437 MND cases and 62,003 controls. We simulate the uncertainty and show a range, never one percentage, against a referral line the clinic chooses. Some patterns go straight to High. At the surgeon's visit in December 2024, two fire: wasting across two nerve territories, which carpal tunnel alone cannot explain, and a look-alike ruled out while weakness persists. Refer for EMG: at least 14 months before his real referral, at any line from 3 to 20%. At the 5% line it is earlier still, but only just.

**[1:20 to 2:05] Evidence and testing**

Every weight but one is published; that one is our labelled assumption. We extracted Alex's findings by hand; over 800 automated tests check the arithmetic, the rules, the device pipeline, and every quote word for word against its note. From the seven BioHacks datasets: in 1,822 trial patients, a real decline took about five months to show for the median patient, so referral must rest on red flags. Home tests compare each person with their own baseline; a drop counts only if it beats the noise twice running. On five common look-alikes we constructed, such as typical carpal tunnel, the tool stays Low. Its weak spot is early speech-onset ALS. Next: replay linked Ontario primary-care records, measuring months gained, EMGs per case, discrimination and calibration.

**[2:05 to 2:40] Feasibility**

It runs on any patient's notes: paste a note, and keyword rules, not AI, propose quoted red flags for the clinician to confirm. It would run inside the family doctor's EMR inbox, so notes stay in the clinic, plus a phone web app: no new hardware. The cost is extra EMGs, made a visible choice: a 5% line means accepting about 19 normal EMGs per case found. It is likely software as a medical device, to be confirmed with Health Canada. It recommends; a clinician confirms.

**[2:40 to 3:00] Close**

Alex speaks 165 words a minute at 9 am and 118 by 4 pm. He has no time for another wrong path. Red-Flag Navigator adds up the visits, shows its evidence, and when the pattern is there, says one thing: refer for EMG.

## Demo at the table (after the pitch)

Open http://localhost:8765 (or the hosted copy). The top bar sets Case, Visit, Referral line and Home data; leave Home data off for the headline.

1. **Overview, about 40 seconds** (details in `docs/DESIGN.md`).
   - In the hero's red-flag calculator, tick **Foot drop**. The right foot lights up, and the range moves from 5.2–20% to 43–80%. Press **Reset to Alex**.
   - Scroll through the four cards (Read, Weight, Range, Act).
   - On the pattern grid, press **One clinician at a time**, then **All visits together**.
   - The timeline puts the tool's prompt on 9 Dec 2024 against his real referral on 16 Feb 2026. That is the first visit where every referral line says refer, 14.3 months earlier. At the 3% and 5% lines it says so already in October 2024.
2. **Red-flag indicator.** Step through Alex's visits with Prev and Next under "Replay the visits" (or the Visit menu). At 9 Dec 2024, point at the range against the line, each red flag with its quote, and the two rules that fired. Switch the line between 3, 5, 10 and 20%: the rules hold at every line. Then go back to 14 Oct 2024 for the what-if. Switch the family doctor's "a little flatter" thumb (wasting) from Counted to Left out: the range drops from 5.2% to 20% to about 0.2% to 0.7%, Low. That soft input carries the October result, which is why we don't lead with it. Then Restore all. (Leaving a sign out at 9 Dec does not move the range, because the same sign is already on file from October: each sign counts once.)
3. **Cases.** Open a look-alike demo: Typical carpal tunnel stays Low. Then open Early speech-onset ALS (constructed): only Unclear at 5%, and Low at 10% and 20%. That is our weak spot; say it out loud. Then press New case, add a visit, paste the note below into Clinic note and press Suggest red flags. Accept each suggestion (point at the quoted sentence), save, and show the live result. Say it plainly: keyword rules, not AI; the clinician confirms every flag.
4. **Patient app.** The same evaluation in a phone frame, in calm words; open the details to show the full range.
5. **Monitoring.**
   - Run the finger-tapping test live (Start, then tap).
   - Point at the walking-speed card: the 10 m walk runs on the phone, and its weekly results join this page's charts against a normal variation of 0.28 m/s.
   - Show the team calibration (how big a change is real) and the 44 phone, wearable and home signals. Click one to show its evidence and sources.
   - **Home plan** (if there is time): switch the case to Early speech-onset ALS. The plan opens with "Act on this first: trouble swallowing, contact your doctor now", then this week's tests for the case's situation.
6. **Devices and data** (needs `python run.py` on the laptop).
   - If the morning check in `docs/MORNING_TEST.md` worked: start a Sensor Logger recording with the AirPods in. The airpods card goes Live, the database counts rise, and turning your head moves its line.
   - If it did not: run `python server/simulate.py --url http://localhost:8765 --walk`. Every device is named and tagged Simulated, so say so.
   - Either way, say: this data is saved on the laptop and never changes the red-flag number.
7. **Datasets.** What each of the 7 BioHacks datasets shows, including what did not work: voice does not detect ALS before speech changes, and the EEG sets do not help early detection.

Note to paste in step 3 (constructed for the demo; not a patient):

> 52-year-old electrician with 4 months of weakness in the right hand, dropping tools at work. Twitching in the right forearm and calf at rest. On exam, wasting of the right thenar muscles and first dorsal interosseous. Reflexes are brisk in both arms. Nerve conduction study of the wrist was normal last month.

Checked with the engine: the helper proposes six red flags (weakness, twitching, wasting across two nerve territories, wasting, brisk reflexes, a normal nerve study), and once all are accepted the case is High at every line, through three rules. It is an easy note on purpose; say so if asked.

## Numbers to re-check against the app before presenting

| Number | Where it comes from |
|---|---|
| At least 14 months earlier referral, the headline (9 Dec 2024 to the real referral, 16 Feb 2026) | `monthsSaved().monthsVsReferral` with home tests off: 14.3 at the 10% and 20% lines, through the "wasting across two nerve territories" and "look-alike ruled out" rules. Re-checked 19:41, 7 Nov. Counted from the visit day. If the consult letter reached the record 10 days later, it is 13.9 months. |
| 16.1 months, not the headline (14 Oct 2024) | `monthsVsReferral` at the 3% and 5% lines, by the number alone. Narrow: the range starts at 5.2% against a 5% line. |
| 18 months before his first specialist visit (11 Jun 2026), but that includes the waiting list: never the gain | `monthsSaved().months`. Includes the 16-week waiting list, which applies either way. |
| With SIMULATED home tests on: no change (still 14.3 and 16.1) | Alex's simulated tapping drop (54 to 46) is inside the ±18-tap normal variation, so Home data does not move his referral (8 Nov, after the engine took the research's MDCs). The home test runs alongside the referral; it does not drive it. |
| 16 Feb 2026 referral, 11 Jun 2026 first specialist visit | alex.js `actual`; case text |
| 6,437 cases, 62,003 controls | Mei et al. 2022 (weights.js) |
| 5,000 simulations | engine.js default |
| AUC 0.95 (95% CI 0.84 to 1.00) mean stride time; AUC 0.83 (0.64 to 0.96) stride-time variability; 13 ALS vs 16 controls | evidence.js (not in the spoken script now; Q&A only) |
| about 19 normal EMGs per case at 5% | weights.js `REFERRAL_LINES` |
| Over 800 automated tests (811: app 584, motion 116 JS and 46 Python, server 54, gyro starter 11) | The five commands under "Run it locally" in the README. All passed at 05:19, 8 Nov 2026. Re-run them before presenting and use the new total |
| 0.28 m/s normal variation for walking speed | WatchALS, 23 controls walking weekly at home (MDC95 0.284 m/s; 0.179 m/s in ALS), via `docs/WEARABLES.md` |
| 151,000 rows, none lost | The server's stress test: three devices pushing at once for 10 s, 8 Nov 2026 |
| 1,822 trial patients; a real decline takes about 5 months to show for the median patient | `analysis/progression/SUMMARY.md` (40-point ALSFRS, MDC95 about 3 points) |
| 34 of 35 hand-labelled red flags found on Alex's 7 notes; 34 of 48 suggestions matched | The `suggest.test.mjs` log line. Best case: the rules were written while reading those notes |
| 7 demo cases: 5 look-alikes Low, severe carpal tunnel and early speech-onset ALS Unclear, at 5% | `lookalikes.js`, `cases.test.mjs` |
| Voice AUC 0.72 (101 vs 50); in the 52 with normal speech, rate, breath and vowel length at chance (0.47 to 0.53), pitch wobble 0.67 but not significant after correction; syllable rate ICC 0.93, MDC 0.37/s (same-visit repeats, a floor) | `analysis/voc_als/SUMMARY.md` |
| 44 phone, wearable and home signals: 7 strong, 20 moderate, 13 weak, 4 not studied | `docs/wearables.json` via `analysis/make_wearables_js.py`, 8 Nov |
| Normal variation (MDC) in use: about 18 taps per 10 s (provisional), 31 wpm, 2.4 kg, 0.28 m/s | `HOME_TESTS` in `app/js/engine.js`; sources in `docs/WEARABLES.md` |
| 165 and 118 words per minute | Case text |
| 1 to 3 in 10,000 within 5 years | weights.js `PRIOR` |

## Likely judge questions

**Where do the weights come from?** Mei et al. 2022, BMJ Open: UK GP records, 6,437 MND cases against 62,003 matched controls, signs recorded 3 months to 5 years before diagnosis. We copied the adjusted odds ratios and their 95% CIs from Figure 2; each one links to its source on the Evidence view. One weight, a home-test decline, is our own assumption, set wide and labelled.

**Isn't 5% arbitrary?** Yes, on purpose. It is a values choice, not a statistic: 5% means accepting about 19 normal EMGs per case found. The clinic can choose 3, 5, 10 or 20%, and validation reports decision curves across all of them. The pattern rules do not depend on the line.

**What about false positives and EMG capacity?** It is the real constraint. An EMG that finds a look-alike, such as multifocal motor neuropathy or myasthenia, is still useful, so we count EMGs per neuromuscular diagnosis, not only per ALS case. The line controls volume, Unclear gets 8 weeks of home tests rather than an instant referral, and rollout is paced with EMG clinics. We do not create capacity; we get the right people into the queue sooner.

**How would you get the notes?** In use, it would run inside the clinic's EMR, so notes never leave the custodian. For validation: linked Ontario primary-care records under research ethics approval and a PHIPA data-sharing agreement.

**How are findings extracted?** For Alex, by hand: we read his notes with AI assistance and recorded each finding with its exact quote. An automated test checks every quote word for word against its note, and the doctor sees every quote and can leave any finding out; the range is recomputed. For other notes, a keyword helper (plain rules, not AI) proposes red flags, each quoting its sentence, and the clinician accepts or dismisses each one. Only accepted flags count. Validation measures its accuracy against two clinicians on notes it was not written from.

**Does it only work for Alex?** No. The same rules run on any case. In Cases you can open seven constructed demo cases, build a case by hand (visits, red flags by body region with their quotes, an optional real referral date and weekly test values), or paste a note and use Suggest red flags. A test checks that a saved copy of Alex scores exactly like Alex. But be honest about what is shown: Alex is the only full case file, and the seven demos are constructed, not patients. The note helper found 34 of 35 hand-labelled red flags on Alex's notes, but we wrote its rules while reading those notes, so that is a best case; on new notes it will miss some flags and propose wrong ones, which is why a clinician confirms each one. Whether it works on real patients is what the validation plan tests.

**What can a phone or watch add?** Tracking, not detection. We researched 44 phone, wearable and home signals; none has been validated for finding undiagnosed ALS, because every device study we found enrolled people already diagnosed. What a phone adds is a weekly check, one body region at a time, of whether a weakness is getting worse: finger tapping for the hand, reading aloud for speech, a timed walk for the legs, plus body weight. Tapping and reading work in the app today, weight is a working entry, and the 10 m walk is timed by the phone's own motion sensors. The walk has been checked on synthetic and replayed walks, but not yet on a real phone. The laptop also logs phone, AirPods and Apple Watch motion into a local database, so you can watch it arrive. Watches add context such as steps, heart rate and sleep, but those are not specific to ALS. The datasets agree: voice separated ALS from controls only moderately (AUC 0.72) and not before speech changed, and in trial data a real decline takes about 5 months to show. So within the 8-week window, no drop is not reassurance, and the referral rests on the red flags in the notes.

**Where does the device data go? Do you use a database?** Into a SQLite database on the laptop. The one server saves every sample, session and walk, and the Devices and data screen shows the rows arriving. The tables map onto Postgres, and `server/migrate.py` copies them into TimescaleDB (Tiger Data). We have not connected a Tiger Data service yet, so we do not claim it. Patient data would stay on the clinic's side; only simulated data is ever meant for the cloud.

**Why not machine learning?** ALS is rare: about 1 to 3 in 10,000 adults are diagnosed with motor neuron disease within 5 years, so labelled cases are scarce and a black box would be hard to check. Published odds ratios from thousands of cases are the strongest evidence available, and the arithmetic can be audited line by line. A learned model could come later, compared against this baseline.

**What did you actually test?**
- Over 800 automated tests in five suites. They cover:
  - exact arithmetic, the range reproducing the published confidence interval, tiers, rules, home-test decline and the 8-week deadline;
  - the case builder and the note helper;
  - the home kit and the walking-speed analysis;
  - the device server and its database.
- The whole device path with simulated AirPods, Watch and phone streams, over HTTP and HTTPS. Every row was read back from the database.
- A word-for-word quote check on Alex's hand-extracted findings, and a replay of his case timeline.
- Seven constructed demo cases. The five common look-alikes must not trigger an EMG on their own, and all stay Low. Severe carpal tunnel with thumb wasting is High at 3%, Unclear at 5% and 10%, and Low at 20%. Early speech-onset ALS is a weak spot: Unclear at 3% and 5%, and Low at 10% and 20%.
- All seven BioHacks datasets: the gait data with bootstrap confidence intervals and a noise floor, voice, the Seattle and ALS Focus cohorts, the DREAM trial data and the two EEG sets.
- The ALS Focus survey: median 13 months from first symptom to diagnosis, 472 people.

Not yet tested: real patients, Canadian notes, look-alike cohorts, the note helper on notes it was not written from. That is the validation plan.

**What would you need to deploy it?** Automatic extraction with clinician confirmation, retrospective validation on linked Ontario records, a silent pilot in one family health team, EMR integration, a Health Canada device classification, a privacy impact assessment, and agreement with neuromuscular clinics on capacity.
