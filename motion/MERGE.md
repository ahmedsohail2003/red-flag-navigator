# Folding the phone walking test into the app

For the main session (which owns `app/`) or Ahmed. The server side is already merged: `python run.py` serves `motion/web/` at `/motion/` and implements the walk API in `motion/CONTRACT.md` section 5. What is left is a patch to the app's own views, so that the walking results and the flag show inside the app, not only on the laptop page.

## 1. Apply the patch (15 small edits)

From the project folder:

```bash
node motion/merge/apply-app-patch.mjs app --dry-run
```

```bash
node motion/merge/apply-app-patch.mjs app
```

```bash
npm test
```

```bash
node --test "motion/tests/*.test.mjs"
```

- **Anchored.** Every edit is tied to text in today's code. If an anchor has moved, the script writes nothing and names the edit, so you can make it by hand from the table below.
- **Safe to repeat.** Running it twice changes nothing.
- **Checked at 03:54 on 8 Nov 2026** against a fresh copy of `app/` and `tests/`:
  - all 15 edits applied;
  - a second run reported all 15 as "already done";
  - `npm test` passed 441 of 441.

| File | Edit |
|---|---|
| `js/engine.js` | `HOME_TESTS.gait_speed = { label: 'Walking speed, 10 m walk (phone motion sensors)', unit: 'm/s', region: 'leg', higherIsBetter: true, placeholderMdc: 0.28 }` |
| `js/engine.js` | The decline quote keeps 2 decimals below 10, so it reads "baseline 1.34 … ±0.28", not "1.3 … ±0.3". This changes every home test's quote for values below 10 (for example `walk`, in percentage points). |
| `js/hometests.js` | `SHORT.gait_speed = 'Walking speed'`, `UNIT.gait_speed = 'm/s'`; the Legs row on the old home-tests page uses `gait_speed`, status working |
| `js/app/views/monitoring.js` | The coverage table's walking test changes from mockup to working |
| `js/app/views/monitoring.js` | Results that join a case keep 2 decimals for m/s. They stay marked simulated when any row that day is a demo date or simulated. |
| `js/app/views/monitoring.js` | A case value counts as already added only when its simulated mark matches too |
| `js/app/views/monitoring.js` | The weekly result card says "Demo dates", not "Real", when any of its rows is a demo date or simulated |
| `js/app/views/monitoring.js` | The section head drops its "Real" chip when any saved row is a demo date or simulated |
| `js/app/views/monitoring.js` | `round1` and `num()` keep 2 decimals below 10, so the verdict cannot read "1.0 … more than 0.3 below 1.3" (it now reads "0.96 … more than 0.28 below 1.34") |
| `js/app/views/patient.js` | The walking check-in uses `gait_speed` ("Walking speed over 10 m, timed by the phone"; drop = "Walking slower than your start"), plus its unit and column name |

Why a new test id instead of reusing `walk`: `walk` means stride-time variability, where lower is better, in percentage points. Reusing it would silently flip the direction of any saved `walk` rows. `walk` stays as it is, and nothing feeds it any more.

## 2. What then works without any more code

- **Monitoring view:** it loops over every `HOME_TESTS` entry, so it draws the `gait_speed` chart and its verdict from `detectDecline` with MDC 0.28 m/s. The verdicts are "Within normal variation", "Beyond normal variation once" and "Decline confirmed".
  - Checked at 03:00 on a patched copy: "Decline confirmed on 8 Nov 2026. Two results in a row (0.96 on 1 Nov 2026, then 0.92) were more than 0.28 m/s below the baseline of 1.34."
- **Engine:** it treats a confirmed walking decline like any home-test decline:
  - a `home_decline` finding in the legs;
  - `multi_region` ("refer for EMG") when another region already has motor findings;
  - `unclear_with_decline` in an unclear case.
  - `motion/tests/engine-flag.test.mjs` checks all three against the real engine.
- **Storage:** results arrive in localStorage `rfn.homeResults` from `/motion/receive.html`. Under `run.py` the app and that page share one address (http://localhost:8765), so they share the storage.

## 3. Choices and follow-ups for you

- **MDC:** 0.28 m/s before diagnosis is the default (WatchALS controls). Use 0.18 m/s for diagnosed patients (WatchALS ALS group).
  - Both are approximate (`docs/WEARABLES.md`) and come from a 60-second walk with the phone on a lower-back belt.
  - Check them against the team's own repeat walks.
- **Alex's simulated walking line** (optional, labelled simulated).
  - His real clinic point is a 10 m walk in 14.2 s with a cane on 22 Sep 2026, which is 0.70 m/s (computed by us).
  - That is a clinic stopwatch walk, while the phone times a standing start and stop. So show it as a separate clinic marker, not as the last point of the phone series.
  - Add a "new walking aid: start a new baseline" marker at the cane (10 Feb 2026).
- **Keep only one walking test fed to the engine.** The home-plan catalogue has `timed_walk_speed`, the stopwatch version of the same walk. Keep it context-only, and never feed both to the engine.
- **Old text that still says "mockup":** after a real-phone walk works, update `docs/DEVPOST.md` (line 22) and `README.md` (line 89), which still call the walking test a mockup.
- **Display:** `patient.js` still shows 1 decimal in places (the MDC reads ±0.3 m/s there). That is fine to read.
- **Chart labels:** in the Monitoring chart, the "Decline confirmed" and "MDC" labels can overlap when the points sit close together. That is cosmetic, in the app's chart code.

## 4. Serving the app another way

Under `run.py` everything shares one address, so nothing more is needed.

If the app is served elsewhere (for example `serve.py` on its own), the walk API still sends `Access-Control-Allow-Origin: *` on `GET /api/walks` and `/api/events`. The app could then read walks across origins and save them itself, using `makeRow` and `saveBlocker` from `motion/web/flag.js`.
