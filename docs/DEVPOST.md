# Red-Flag Navigator — Devpost draft

Paste into biohacksmcmaster.devpost.com before 11:30 AM Sunday. Track: Detection and Diagnostics.

**Try it link for Devpost:** https://claude.ai/artifact/S6z4BNxt3TX2bhJUyuu2z8. Before submitting, open it and use Share to make it viewable by anyone with the link; it is private until then. Then open the link in a private window to confirm judges can see it.

## Inspiration

Alex Chen's first family-doctor visit was on 14 October 2024. He was referred urgently to neurology on 16 February 2026 and first saw a neuromuscular specialist 16 weeks later, on 11 June 2026. She needed about five weeks to diagnose ALS, using tests that already exist, and wrote that "in retrospect he probably met [the criteria] a year ago." Most of the time was lost before anyone referred him. A family doctor, a hand surgeon and a physiotherapist each saw one body part. The clues were all written down, but for about 16 months no one put them together; the physiotherapist finally did in February 2026. In ALS Focus survey data (472 people with ALS), the median time from first symptom to diagnosis was 13 months (IQR 7 to 25), and 16 months for leg-onset ALS.

## What it does

- **Scores the notes across visits.** Each sign is tied to the exact sentence it came from, so a doctor can check it in one glance. Alex's findings were extracted by hand (AI-assisted). For other notes, a keyword helper proposes red flags and a clinician confirms each one; nothing is counted without that.
- **Adds the weak signs up with published weights.** It uses the 33 adjusted odds ratios from a UK primary-care study (Mei et al., BMJ Open 2022; 6,437 people later diagnosed with MND vs 62,003 controls). For example: dysarthria 43.2, fasciculations 40.2, muscle wasting 31.0, focal weakness 14.0.
- **Shows a range, never one number.** Starting from the general-population rate, it simulates the uncertainty 5,000 times and shows the middle 95% against a referral line.
- **Gives a tier and an action, not a diagnosis:**
  - High: refer for EMG now.
  - Unclear: weekly home tests and a nerve study, decided by week 8.
  - Low: safety-net advice.
- **Sends some patterns straight to High.** These are the split hand, wasting across two nerve territories in one hand, a look-alike ruled out while weakness persists, motor signs in two body regions, upper plus lower motor neuron signs together, and an Unclear case whose weekly home test shows a confirmed decline.
- **Works for any patient, not only Alex.** A case builder takes visits, red flags by body region with the words they rest on, an optional real referral date and weekly test values, and shows a live result. Seven constructed demo cases open in one click. A note helper (plain keyword rules, not AI) proposes red flags from a pasted note, quoting the sentence; a clinician accepts or dismisses each one. Cases stay in the browser and can be exported and imported as JSON.
- **Runs weekly home tests alongside the referral.**
  - Finger tapping and a reading-rate test work today, and body weight is a working entry.
  - A 10 m walking test runs on the phone: its motion sensors time the walk and count the steps.
  - A drop counts only if it beats the test's normal variation twice in a row. For walking speed that is 0.28 m/s, from the WatchALS study.
  - The walk has been checked on synthetic and replayed walks, not yet on a real phone.
  - Next to them sit 44 phone, wearable and home signals we researched, each graded and sourced.
  - A Home plan picks this week's tests from the case's situation. It puts "act on this first" alerts at the top, such as trouble swallowing: contact your doctor now. It brings in device data from Apple Health, CSV files or Bluetooth, all in the browser (checked on test files and mock devices, not yet on a real Health export or Bluetooth device).
- **Logs device data where you can see it.**
  - Phone motion, AirPods head motion and Apple Watch wrist motion (through the free Sensor Logger app), plus the walking test, are saved to a local database on the laptop.
  - The Devices and data view shows each device live and every stored session.
  - Device data never changes the red-flag number. Only weekly home tests count, each against a normal-variation figure from published data.
  - Checked end to end with the labelled simulator: simulated AirPods, Watch and phone streams, over HTTP and HTTPS, stored and read back from the database. It has not yet been tried with a real iPhone, AirPods or Watch.
- **Has two views of the same facts.** The doctor's red-flag indicator shows the range, the reasons, the sources and a replay of every visit. The patient app, shown in a phone frame, says what is being checked, why, and what happens next, in calm words, with full detail one tap away.
- **Shows its evidence.** One page holds the method, every weight and its source, the rules, the look-alike check, current practice, the path to use, the validation plan and the limits. Another shows what each of the 7 BioHacks datasets says.

**On Alex's case-file notes: at least 14 months earlier referral, at any line from 3% to 20%.** Alex is the fictional BioHacks case. We compare with his actual referral in the case file (urgent neurology, 16 Feb 2026), because the 16-week wait after a referral would apply either way. At the 10% and 20% lines it recommends an EMG at the hand-surgeon visit on 9 Dec 2024, 14.3 months earlier, counted from the day of that visit (a 10-day delay before the letter reached the record would make it 13.9). That note recorded normal median nerve studies but wasting of the thumb muscles (median nerve) and the first dorsal interosseous (ulnar nerve): two nerve territories, which carpal tunnel alone cannot explain (the core of the split-hand pattern), with a look-alike ruled out and the weakness still there. At the 3% and 5% lines it already escalates at the first family-doctor visit (14 Oct 2024, 16.1 months earlier), but only just (range 5.2% to 20% against a 5% line), so we don't lead with that. Home tests are off for these numbers.

## How we built it

- A single-page web app (HTML, CSS, JavaScript) with nine views: Overview, Cases, Red-flag indicator, Patient app, Monitoring, Home plan, Devices and data, Evidence and Datasets. A top bar sets the case, the visit, the referral line (3, 5, 10 or 20%) and whether home data count. The scoring engine is pure JavaScript and runs in the browser.
- One local server, started with `python run.py` (Python standard library plus a self-signed HTTPS certificate):
  - It serves the app and the phone pages from one address.
  - It takes motion data three ways: from the phone's browser, over HTTPS; from AirPods and Apple Watch through the free Sensor Logger app's HTTP push; and from the walking test.
  - It writes every sample, session and walk to a local SQLite database.
  - The Devices and data view shows it arriving live: rates, a chart, growing row counts, sessions with CSV export, and what each Sensor Logger push held.
  - A simulator sends labelled fake AirPods, Watch and phone streams, so the whole path can be shown without hardware.
- Over 800 automated tests (811 on 8 Nov) cover the arithmetic, the rules, the replay, the case builder (bad dates and empty cases are refused; a saved copy of Alex scores exactly like Alex), the note helper, the page logic, the home kit, the walking-speed analysis, and the device server and its database. Seven constructed demo cases check how the tool behaves on presentations that are usually not ALS. The five common look-alikes (typical carpal tunnel, twitching after stress and others) all stay Low. The tiers of the other two depend on the referral line. Severe carpal tunnel with thumb wasting is High at 3%, Unclear at 5% and 10%, and Low at 20%; an EMG is the usual step there anyway. Early speech-onset ALS is a weak spot: Unclear at 3% and 5%, and Low at 10% and 20%.
- Alex's notes are copied word for word from the case PDF. His findings were extracted by hand, AI-assisted, each with its exact quote, and a test fails if any quote is not found word for word in its note.
- The note helper is about 300 lines of readable keyword rules, with negation handling ("no wasting" is not suggested). On Alex's 7 notes it found 34 of 35 hand-labelled red flags, and 34 of its 48 suggestions matched a hand label. We wrote the rules while reading those notes, so this is a best case, not a measure of how it does on new notes.
- Real-data checks in Python on all 7 BioHacks datasets (group-level results only):
  - VOC-ALS voice (101 with ALS, 50 controls): voice separates ALS from controls only moderately (AUC 0.72), and not before speech changes. In the 52 whose speech was still rated normal, rate, breath and vowel length were at chance (AUC 0.47 to 0.53); only pitch wobble hinted at a difference (0.67), and it did not survive correction for testing 55 features. So voice belongs in monitoring. Same-visit repeats of the "pa-ta-ka" syllable rate agree closely (ICC 0.93; MDC 0.37 syllables a second, a floor, because there is no week-to-week retest).
  - Seattle (143 patients): 45% already had two or more body regions affected at diagnosis. Spine or limb surgery was 11.1 times as frequent inside the symptom-to-diagnosis window (95% CI 5.0 to 24.2); other surgeries were 2.1 times as frequent, so recall bias is part of it.
  - DREAM / PRO-ACT (1,822 trial patients): median decline 0.59 points a month, and a real drop takes about 5 months to beat the noise. Referral has to rest on red flags, not on waiting for a measured decline.
  - ALS Focus: median 13 months from first symptom to diagnosis (n = 472); 78% would keep using telehealth.
  - PhysioNet gait (13 with ALS, 16 controls): mean stride time gave AUC 0.95 (95% CI 0.84 to 1.00) and stride-time variability AUC 0.83 (0.64 to 0.96). The groups are small and unmatched, and the ALS recordings may come from a separate study, so this is a signal worth testing, not proof.
  - The EEG and brain-computer interface sets (EEGET-ALS, bigP3BCI) hold only diagnosed, mostly advanced patients, so they do not help early detection.
- A separate research pass graded 44 phone, wearable and home signals with sources (7 strong, 20 moderate, 13 weak, 4 not studied). None has been validated for finding undiagnosed ALS. For the demo it picked phone finger tapping, reading rate, body weight and a timed walk scored as gait speed.
  - It found our first normal-variation figures too small: they would have falsely flagged about a fifth to a third of stable people within 8 weeks.
  - The engine now uses its sourced figures instead: about 18 taps per 10 s (provisional), 31 words a minute, 2.4 kg and 0.28 m/s.
- The interface is warm and calm: cream and sand surfaces, espresso-brown panels, the ALS Association's red for red flags, and ice blue as the only interactive colour (a nod to the Ice Bucket Challenge and to Lou Gehrig's blue and white). The overview scrolls like a product page:
  - a 3D point-cloud body whose hand, leg, voice or chest lights up as you tick red flags in a live calculator that runs the real engine and weights;
  - four "how it works" cards with objects drawn in scanlines;
  - Alex's 7 visits by 5 body regions;
  - an Ice Bucket Challenge section where the mouse ripples the water.

  Everything is drawn with plain Canvas 2D and no libraries, so it works offline. Animations pause off screen, become still frames for people who prefer reduced motion, and step down automatically on slow laptops.
- Built with AI assistance (Claude). The AI wrote code, drafted text, helped with the dataset analysis and the wearables research, and helped extract Alex's findings by hand; the scoring and the note helper use no AI.

## Challenges

- Making a likelihood honest. A narrow range needs outcome data that do not exist yet, so we show the full width and let the tier depend only on which side of the line the range falls.
- Choosing the referral line. It is a values choice ("how many normal EMGs would you accept per case found?"), so the doctor can change it, and we report results at several lines.

## Accomplishments

- The tool would have flagged Alex from notes his clinicians already wrote.
- That holds across referral lines, and it does not depend on simulated data.
- Every weight has a source, and every finding has a quote.
- It is not a one-case demo: anyone can build or paste in a patient and get a result from the same rules.
- Tiers never rely on colour alone (each has its word: High, Unclear, Low), every label and chip has at least 4.5:1 contrast, and every screen was checked at phone, tablet and six laptop sizes.
- We checked every BioHacks dataset and wrote down what each one can and cannot support, including the negative results (voice does not detect ALS before speech changes; the EEG sets do not help).

## What we learned

The delay is mostly a routing problem, not a test problem: the red flags were already written down. Pattern rules applied to each note would have prompted an EMG at the hand-surgeon visit, and reading the later notes together adds the second-region rule.

## What's next

Test the note helper on notes it was not written from, against two clinicians, and improve it; the clinician keeps confirming every finding. Then validate the tool as a retrospective replay on linked primary-care records of people later diagnosed with ALS and people with look-alike conditions. Measure:
- months gained against the real referral date
- EMG referrals per true case
- discrimination
- calibration (reported to TRIPOD+AI)

Then run it silently in one family health team before any real use. See `docs/VALIDATION.md`.

## Built with

JavaScript, HTML, CSS, Canvas 2D, Python (standard-library HTTP server, SQLite, `cryptography`; pandas, SciPy, scikit-learn and Matplotlib for the dataset checks), the browser DeviceMotion API, Sensor Logger (iPhone app) for AirPods and Apple Watch motion, Node.js test runner, Python unittest.
