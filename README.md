# Red-Flag Navigator: earlier EMG referral for possible ALS

BioHacks 2026, Detection and Diagnostics track. Case: Alex Chen.

Alex's clues were in his notes from his first family-doctor visit. Each clinician saw one body part, and for about 16 months no one put the clues together; his physiotherapist finally did in February 2026, and he was referred urgently to neurology on 16 Feb 2026. This prototype scores the notes across visits, with each sign tied to the exact sentence it came from. It adds the signs up with published weights and recommends an EMG once the evidence crosses a referral line. Weekly home tests run alongside, never instead of the referral.

Alex's findings were extracted by hand (AI-assisted), and an automated test checks every quote word for word against its note. The app also works on any other patient: you can build a case from your own notes, and a keyword helper (plain rules, not AI) proposes red flags from a pasted note for a clinician to confirm.

## Try it online

Hosted copy: https://claude.ai/artifact/S6z4BNxt3TX2bhJUyuu2z8. It is private to its owner until shared with the Share button on that page. It holds the new single-page app (the same files as `app/`). Before sharing, open each of the nine views there and check they load; a page can stay blank for a few seconds on first load. The hosted copy has no server behind it, so it cannot log devices: its Devices view explains how to run `python run.py`. Results and cases stay in the viewer's own browser. If a download is blocked, use "Copy CSV" or "Copy JSON" instead.

## Run it locally

One command runs everything: the app, the phone pages, the device inputs and the database.

```bash
python run.py
```

Then open http://localhost:8765. It prints every address, with this laptop's IP address:

- The app, at `http://localhost:8765/`. There is no build step.
- The phone pages, over HTTPS on port 8443. Phones give motion data only to secure pages. The pages are the motion stream (`/gyro/phone.html`) and the 10 m walking test (`/motion/walk.html`).
- The address where Sensor Logger, a free iPhone app, pushes AirPods and Apple Watch motion: `http://<laptop-ip>:8765/sensorlogger`.
- A local SQLite database, `data/rfn.sqlite`. It saves every sample, session and walk that arrives. Nothing in `data/` is ever committed.

It needs Python 3.10 or later and the `cryptography` package, for the self-signed HTTPS certificate. Details: `server/README.md`.

- **See data arrive without a phone:** run `python server/simulate.py --url http://localhost:8765 --walk` and open **Devices and data** (`#devices`). Every simulated device is named "(simulated)" and labelled Simulated.
- **Try your own iPhone, AirPods and Watch:** `docs/MORNING_TEST.md`, about 5 minutes.
- **The app alone, with no devices or database:** `python serve.py`. It uses port 8765 too, so stop one before starting the other.
- **One offline file:** `node tools/build-single-html.mjs` writes `dist/Red-Flag-Navigator.html`, about 2 MB, that opens from disk with no server. The screens work offline. Device logging and the phone pages still need `python run.py`, so its Devices screen says the server is not running. Re-run the build after any change to `app/`.

The Geist fonts load from Google Fonts when online. Offline, the app falls back to system fonts and works the same.

Tests (Node 22 and Python):

```bash
npm test
python -m unittest discover -s server/tests
node --test "motion/tests/*.test.mjs"
python -m unittest discover -s motion/tests
python -m unittest discover -s gyro-starter/tests
```

## What is where

`app/index.html` is a single-page app. `app/js/app/shell.js` draws the sidebar and the top bar and routes between nine views. The top bar holds the controls every patient view shares: Case, Visit, Referral line (3%, 5%, 10% or 20%) and a Home data switch (counts the case's weekly home-test values; for Alex these are simulated).

| Route | What it shows |
|---|---|
| `#overview` | A scroll story of Alex's case. It has a live red-flag calculator on a point-cloud body, the four steps from note to referral, his 7 visits by body region, the tool's referral date against his real one, and the Ice Bucket Challenge. The scenes are canvas drawings that follow the mouse. |
| `#cases` | Case library (Alex, 7 constructed demo cases, your own cases), the case builder, import and export as JSON, and how the note helper did on Alex's notes |
| `#indicator` | Red-flag indicator, the doctor's view: the 95% range against the referral line, each red flag with its quote, the pattern rules that fired, the next step, a replay of every visit, and a what-if that leaves a finding out |
| `#patient` | Patient app in a phone frame: the same evaluation in calm words, full detail on request |
| `#monitoring` | Working finger-tapping and reading-rate tests, a body-weight entry, team calibration (minimal detectable change), coverage by body region, and 44 researched phone, wearable and home signals with sources |
| `#plan` | Home plan. Shows: this week's home tests chosen from the case's situation, with "act on this first" alerts (for example trouble swallowing: contact your doctor now); tests that run in the browser (microphone timing, typing, stopwatch, questionnaires); device data imported from Apple Health, CSV files or Bluetooth, or typed in; and what each measure can and cannot detect. Everything stays in the browser |
| `#devices` | Devices and data. Shows: devices sending to this laptop, live and measured or simulated; their rates; a live turning-speed chart; what Sensor Logger's last push held; database row counts; the newest sessions, each with a CSV download; recording; the addresses and steps to connect a phone, AirPods or Watch. It needs `python run.py`. The hosted copy explains how to start it. |
| `#evidence` | How the number is made, every weight and its source, pattern rules, the referral line, the look-alike check, current practice and the path to use, validation, honest limits |
| `#datasets` | What each of the 7 BioHacks datasets shows, with credits, terms and limits |

| Path | What it is |
|---|---|
| `app/js/app/views/` | One module per route |
| `app/css/app.css` | Design system. Warm palette: cream canvas, sand surfaces, espresso instrument panels, ALS red only for red flags, ice blue as the one interactive colour. Geist fonts. The layout language is borrowed from the reference site the team chose (zelt-nu.vercel.app). |
| `run.py`, `server/` | The one server: the app, the phone pages, every device input and the SQLite database (`server/README.md`, `server/SPEC.md`). Also the simulator (`server/simulate.py`) and the copy to Postgres or TimescaleDB (`server/migrate.py`, `docs/DATABASE.md`) |
| `motion/` | The phone walking test: the phone page, the laptop's results page, the gait analysis and its tests (`motion/README.md`, `motion/CONTRACT.md`) |
| `gyro-starter/` | The phone motion stream and the Sensor Logger converter for AirPods, Apple Watch and phone. The one server reuses its code (`gyro-starter/README.md`) |
| `app/js/home/` | The home kit behind `#plan`: weekly series, the situation plan, microphone and typing tests, and Apple Health and CSV imports |
| `docs/MORNING_TEST.md` | 5-minute check with a real iPhone, AirPods and Watch, with what success looks like at each step |
| `app/js/engine.js` | The scorer: plain arithmetic, no AI. Monte Carlo range, tiers, pattern rules, home-test decline, 8-week deadline |
| `app/js/weights.js` | All 33 adjusted odds ratios from Mei et al. 2022 (BMJ Open), the starting rate, the referral lines |
| `app/js/cases.js` | Case registry: Alex, the 7 demo cases and cases built in this browser (saved in local storage), with import and export |
| `app/js/suggest.js` | Note helper: keyword rules that propose red flags from a pasted note, each with its sentence quoted word for word. Not AI |
| `app/js/lookalikes.js` | The 7 constructed demo cases, with expectations written before scoring |
| `app/js/alex.js`, `alex_notes.js` | Alex's notes word for word from the hacker package, and the hand-extracted findings with their quotes |
| `app/js/datasets.js` | The dataset summaries shown in `#datasets` |
| `app/js/wearables.js` | Generated from `docs/wearables.json` (do not edit by hand) |
| `app/doctor.html`, `patient.html`, `hometests.html`, `method.html` | The old pages. They still open but are no longer linked |
| `analysis/` | Python checks on the BioHacks datasets: `gait_evidence.py`, `diagnostic_delay.py`, and one folder each for `voc_als`, `focus_seattle`, `progression` and `eeg_bci`, each with a `SUMMARY.md` |
| `docs/WEARABLES.md`, `docs/wearables.json`, `docs/HOME_MONITORING.md` | Research on 44 phone, wearable and home signals, graded and sourced, and the rules for which home tests to give in which situation |
| `docs/VALIDATION.md`, `docs/PITCH.md`, `docs/DEVPOST.md` | Validation plan, pitch script, Devpost draft |
| `tests/` | Node tests: engine, cases, note helper, look-alikes, doctor and patient logic, home tests, the home kit, and a check that every quoted finding appears word for word in its note. `server/tests`, `motion/tests` and `gyro-starter/tests` hold the rest |

## Analyse any patient

Three ways in, all on the `#cases` view:

1. **Open a demo.** Pick a look-alike demo in the library (or in the Case menu in the top bar), then open the Red-flag indicator. "Duplicate" makes an editable copy.
2. **Build a case by hand.** Press New case. Add each visit with its date, setting and note. Add red flags by body region, each with the words from the note it rests on. Optionally add the real referral date and weekly test values. A live result panel shows the tier at each visit while you edit; press Save case.
3. **Paste a note.** In a visit, paste the clinic note and press Suggest red flags. Each suggestion quotes its sentence; accept or dismiss each one. Only accepted red flags are counted.

If it is a real patient, use initials or a label. Cases are saved in this browser only; nothing is sent anywhere. Export gives a JSON file you can import elsewhere.

The note helper is plain keyword rules, not AI. On Alex's 7 notes it found 34 of the 35 hand-labelled red flags, and 34 of its 48 suggestions matched a hand label. The rules were written while reading those notes, so that is a best case; on new notes it will miss some red flags and propose some wrong ones.

## What the datasets show

Details in `#datasets` and `analysis/*/SUMMARY.md`. Group-level results only.

- **VOC-ALS voice** (101 with ALS, 50 controls): voice separates ALS from controls only moderately (best feature AUC 0.72), and not before speech changes (AUC 0.47 to 0.53 for rate, breath and vowel length in the 52 whose speech was still rated normal; pitch wobble reached 0.67 but did not survive correction for testing 55 features). So voice is a monitoring signal, not a detector. Same-visit repeats of the "pa-ta-ka" syllable rate agree closely (ICC 0.93; MDC about 0.37 syllables a second, a floor, because there is no week-to-week retest).
- **Seattle** (143 patients, 1987 to 1989): 45% (62 of 139) already had two or more body regions affected at diagnosis. Spine or limb surgery was 11.1 times as frequent inside the symptom-to-diagnosis window (95% CI 5.0 to 24.2); other surgeries were 2.1 times as frequent, so recall bias explains part of it.
- **DREAM / PRO-ACT** (1,822 trial patients): median decline 0.59 points a month. A real drop takes about 5 months to beat the noise for the median patient, so referral must rest on red flags, not on waiting for a measured decline.
- **ALS Focus** (survey): median 13 months from first symptom to diagnosis (n = 472); 78% (166 of 212) would keep using telehealth.
- **PhysioNet gait** (13 with ALS, 16 controls): mean stride time AUC 0.95, but the groups are small and unmatched.
- **EEGET-ALS and bigP3BCI** (EEG and brain-computer interface): all participants already diagnosed and mostly advanced, so they do not help early detection.

## Phones and wearables

`docs/WEARABLES.md` grades 44 phone, wearable and home signals: 7 strong, 20 moderate, 13 weak, 4 not studied. No phone or wearable signal has been validated for detecting undiagnosed ALS; they help track a weakness once it is suspected. The four picked for the demo are phone finger tapping, reading rate, body weight and a timed walk scored as gait speed.

- Tapping and reading work in the app. Weight is a working entry.
- The 10 m walking test works on the phone (`motion/`). The phone's motion sensors time the walk, from the first step to standing still, and count the steps. The walking speed (m/s) is a weekly home test in the legs, flagged when two weeks in a row fall more than 0.28 m/s below the person's baseline. That MDC comes from WatchALS's weekly home walk.
- The old stride-time-variability walk test is still in the engine, but nothing feeds it.
- The engine now uses the research's normal-variation figures (MDCs). Under the old figures, stable people would have been flagged falsely within 8 weekly tests: about 21% to 33% per hand at 6 taps, and about 4% to 12.5% for reading at 15 wpm (the engine's own rule, simulated in `docs/WEARABLES.md`).
  - The new figures: about 18 taps per 10 s (provisional), 31 wpm, 2.4 kg and 0.28 m/s.
  - With them, Alex's simulated tapping drop (54 to 46) is normal variation. Home data therefore no longer moves his referral; the headline never used it.
  - A team-measured MDC from Team calibration replaces the default.

## Devices and the local database

`python run.py` is one server for the phone, the AirPods and the Watch. Whatever each device sends is saved where you can see it:

- **What arrives.**
  - The phone's own motion stream, from a page served over HTTPS.
  - AirPods head motion, Apple Watch wrist motion and phone motion, pushed by the free Sensor Logger iPhone app.
  - The 10 m walking test, sent as one upload with its recording.
- **Where it goes.** Every sample, session and walk is written to `data/rfn.sqlite` on the laptop. In the stress test, three simulated writers (test threads) pushed at once for 10 s: 151,000 rows, none lost.
- **How you see it.** The **Devices and data** view (`#devices`) shows:
  - each device as Live or Idle, with its rate;
  - a live chart;
  - the database row counts as they grow;
  - the newest sessions, each with a CSV download;
  - what Sensor Logger's last push held, sensor by sensor. If AirPods data does not arrive, the screen says why.
- **What it does not do.** Device data never changes the red-flag number. Only the weekly home tests count, because each has a normal-variation figure (MDC) from published data, labelled as an assumption until the team measures its own. Every reading is labelled Measured, Simulated or Imported.
- **Checked so far.** The whole path was checked with simulated devices, over HTTP and HTTPS, by 54 server tests and in the browser. It has not yet been tried with a real iPhone, AirPods or Watch: `docs/MORNING_TEST.md` is that check.
- **A cloud database later.** The tables map onto Postgres. `server/schema_pg.sql` defines a TimescaleDB version (the MLH "Best Use of Tiger Data" prize). `server/migrate.py` copies the local database into it when `DATABASE_URL` is set. It is tested against a stand-in connection only, because no Tiger Data service exists yet: see `docs/DATABASE.md`.

## Real, simulated, assumed

| Real | Simulated (labelled on screen) | Assumed (labelled on screen) |
|---|---|---|
| Alex's notes and dates, word for word from the BioHacks case file | Alex's weekly home-test results (he never had any) | The starting rate: 1 to 3 in 10,000 adults diagnosed within 5 years |
| Odds ratios and 95% CIs from Mei et al. 2022, Figure 2 | The walks in the database from last night's tests (named "(simulated)") | The home-test decline weight: 3 (1.5 to 6) |
| The tapping and reading tests, and the phone walking test (they really work; the walk has been checked on synthetic and replayed walks only, not yet on a real phone) | The 7 demo cases: constructed presentations, not patients | MDCs from published test-retest data until the team measures its own: tapping about 18 per 10 s (provisional, scaled from WatchALS), reading 31 wpm (WatchALS), weight 2.4 kg (from Bhutani 2017), walking 0.28 m/s (WatchALS's 60-second walk) |
| Group-level results from the BioHacks datasets | | |

Cases you build stay in your own browser. They are whatever you type in; the app does not check them against any record.

## Result on Alex's file

Computed by the engine; nothing tuned to fit. We compare the tool's EMG referral date with Alex's real referral (urgent neurology referral, 16 Feb 2026), not his first specialist visit, because the 16-week wait after a referral would apply either way. Notes only, home tests off.

**At least 14 months earlier referral, at any line from 3% to 20%.** At the 10% and 20% lines, the tool refers at the hand-surgeon visit on 9 Dec 2024, 14.3 months before his real referral. That note shows wasting of the thumb (thenar, median nerve) muscles and of the first dorsal interosseous (ulnar nerve), with normal median nerve studies. This counts from the day of that visit: if his consult letter reached the record 10 days later, it would be 13.9 months. Two pattern rules fire: wasting across two nerve territories, which carpal tunnel alone cannot explain (the core of the split-hand pattern), and look-alike ruled out, weakness still there. The full split-hand sign also needs the little-finger side spared, which is first recorded on 11 Jun 2026. Neither the referral line nor the starting rate affects these rules. (That is 18 months before his first specialist visit, but that includes the waiting list.)

**Possibly 16.1 months, but borderline.** At the 3% and 5% lines, the first family-doctor visit (14 Oct 2024) clears the line by a hair: range 5.2% to 20% against a 5% line. That result rests on two soft inputs:
- It counts the family doctor's "a little flatter" thumb muscle as wasting. Without it, Oct 2024 is "low".
- The starting rate is not age-specific. Alex, at 45, is likely at or below its low end, which would make Oct 2024 Unclear at the 5% line (it stays High at 3%).

The headline excludes the simulated home tests.

On the 7 demo cases at the default 5% line, the five common look-alikes (typical carpal tunnel, benign twitching after stress, peroneal nerve palsy, a pinched nerve in the neck, an older adult with non-specific symptoms) all stay Low. Severe carpal tunnel with thumb wasting is Unclear; an EMG is the usual step before surgery there anyway. Early speech-onset ALS is also only Unclear: that is the tool's weak spot. These two depend on the line. Severe carpal tunnel is High at 3% and Low at 20%. Speech-onset ALS falls to Low at 10% and 20%.

Data licences: keep `Datasets/` out of any public repository (ALS Focus and VOC-ALS forbid redistribution; the Seattle data are non-commercial).
