# Phone walking test: shared contract (v1, 8 Nov 2026)

Every builder codes against this file. If something here is wrong or missing, say so in your report rather than inventing a different interface.

## What we are building and why

The red-flag tool (`app/`, owned by another session; never edit it) runs weekly home tests per body region. Walking is still a mockup. This folder makes it real. A phone's motion sensors (accelerometer plus gyroscope) time a 10 m walk at usual pace and count steps. The walking speed (metres per second) is saved as a home-test result. The app's existing rule raises a flag when two weekly results in a row are worse than the person's baseline by more than the minimal detectable change (MDC). It measures walking, not ALS, and never replaces a referral.

Evidence: `docs/WEARABLES.md` ranks "Timed walk gait speed" first for earlier referral.
- MDC95 0.284 m/s in controls (so 0.28 before diagnosis) and 0.179 m/s in ALS (so 0.18 after), from WatchALS, a weekly home 60-second walk.
- Stride-time variability is weak evidence, so it is exploratory here and never fed to the engine.

## Folder layout and owners

```
motion/
  CONTRACT.md            this file (lead)
  README.md, MERGE.md    lead
  server.py              builder: server
  web/gait.js            builder: gait   (pure analysis, no imports, browser + Node)
  web/synth.js           builder: gait   (deterministic synthetic walks for tests and demos)
  web/walk.html          builder: phone  (patient's phone page)
  web/walk.js            builder: phone
  web/motion.css         builder: phone
  web/receive.html       builder: laptop (doctor's laptop page)
  web/receive.js         builder: laptop
  web/receive.css        builder: laptop
  web/flag.js            builder: laptop (pure flag logic, no imports, browser + Node)
  web/recording.js       builder: files  (parse recorded files, no imports, browser + Node)
  tests/gait.test.mjs, tests/synth.test.mjs      builder: gait
  tests/walk.test.mjs                            builder: phone (walk.js in a fake browser)
  tests/app-patch.test.mjs                       lead (the app patch on a copy)
  tests/test_server.py                           builder: server
  tests/flag.test.mjs, tests/engine-flag.test.mjs  builder: laptop
  tests/recording.test.mjs, tests/fixtures/*     builder: files
  data/                  runtime only (walks.jsonl), never committed
  .certs/                runtime only (self-signed certificate), never committed
```

Run the JavaScript tests with `node --test "motion/tests/*.test.mjs"` from the project folder (Node 22). Run the Python tests with `python -m unittest discover -s motion/tests -p "test_*.py" -v`. Use no npm packages and no CDN. Python uses only the standard library, plus `cryptography` for the certificate (version 49 is installed).

## URLs (served by `motion/server.py`; the unified `python run.py` serves the same pages and API on HTTP 8765 and HTTPS 8443)

- HTTP on port 8090: the laptop, `http://localhost:8090/motion/receive.html`.
- HTTPS on port 8453: the phone, `https://<laptop LAN IP>:8453/motion/walk.html`, with a self-signed certificate.
- Phone browsers give motion data only to secure pages. A clicked-through self-signed HTTPS page counts as secure.
- `wss://` to a self-signed certificate fails on iPhone, so the phone sends plain HTTPS POSTs. Never use WebSockets.
- `/motion/<path>` serves `motion/web/<path>`. Every other path serves `app/<path>`, read-only (`/` gives `app/index.html`). This makes the laptop page share an origin with the app, so results written to localStorage appear in the app's views.
- In the browser, receive.js imports the engine as `/js/engine.js` and the local modules as `./gait.js`, `./flag.js` and `./recording.js`.

## 1. Motion sample (phone, one per `devicemotion` event)

```json
{ "t": 1234.5, "ax": 0.12, "ay": 9.6, "az": 1.1, "gx": 3.2, "gy": -1.0, "gz": 0.4, "lx": 0.1, "ly": -0.2, "lz": 0.3 }
```

| Field | Source | Unit |
|---|---|---|
| `t` | `event.timeStamp` (fall back to `performance.now()` if 0 or not increasing) | ms, page clock, increasing |
| `ax`, `ay`, `az` | `accelerationIncludingGravity.x/y/z` | m/s², with gravity. The sign can differ between iPhone and Android, so analysis must not depend on it |
| `gx`, `gy`, `gz` | `rotationRate.alpha`, `rotationRate.beta`, `rotationRate.gamma`: the rates about the device x, y and z axes, as the current W3C spec defines them and Chrome and Safari implement them. MDN's older text differs. Changed at 04:00 after the review found the axes permuted. | degrees per second; `null` when no gyroscope |
| `lx`, `ly`, `lz` | `acceleration.x/y/z` | m/s² without gravity; `null` when missing |

Never trust `event.interval`: iPhone reports it in seconds, Chrome in milliseconds. Rates are about 60 Hz on phones, and analysis must work from 25 to 200 Hz.

## 2. Recording (phone to analysis, to the server and to file download)

```json
{
  "v": 1, "kind": "rfn-walk-recording",
  "id": "w-20261108T071203-a1b2",
  "createdAt": "2026-11-08T12:12:03.120Z",
  "device": { "ua": "..." },
  "distance_m": 10,
  "placement": "waist",
  "goT": 3012.4,
  "stopT": 11873.0,
  "stopBy": "tap",
  "samples": [ /* motion samples; recording starts at the countdown, so there are about 3 s of standing still before goT (6 s for pocket placement, to put the phone away) */ ]
}
```

- `placement` is `"waist"` (held flat against the belly), `"pocket"` (front trouser pocket) or `"hand"`.
- `goT` is the sample-clock time of the "Go" cue. It is `null` for imported files with no cue.
- `stopT` is the sample-clock time of the Stop tap or the auto-stop; `null` if unknown.
- `stopBy` is `"tap"`, `"auto"`, `"timeout"` or `null`.
- `id` matches `^[A-Za-z0-9_-]{6,64}$`.
- Imported files get the same shape. Synthetic recordings from `synth.js` add `"truth": { "onsetT", "endT", "steps", "duration_s", "speed_mps" }` and `"simulated": true`.

## 3. `gait.js` (pure ES module, no imports)

```js
export const GAIT_VERSION = 'gait-1';
export function analyzeWalk(recording, options = {}) { /* returns WalkResult */ }
export function summarizeWalk(result) { /* one plain-words line */ }
```

WalkResult:

```json
{
  "version": "gait-1",
  "ok": true,
  "speed_mps": 1.24,
  "duration_s": 8.06,
  "timing": "motion",
  "motionDuration_s": 8.06,
  "manualDuration_s": 8.9,
  "onsetT": 3540.2, "endT": 11600.0,
  "steps": 14,
  "cadence_spm": 104.2,
  "stepLength_m": 0.71,
  "distance_m": 10,
  "sampleRate_hz": 59.9,
  "nSamples": 720,
  "maxGap_ms": 34,
  "quality": "good",
  "issues": [ { "code": "used_manual_timing", "level": "warn", "message": "plain words" } ],
  "exploratory": { "stepTimeCv_pct": 3.1, "asymmetry_pct": 2.0, "autocorrCadence_spm": 103.0, "gyroCadence_spm": 104.0, "headingChange_deg": 8 }
}
```

- `speed_mps` is rounded to 2 decimals; `duration_s`, `motionDuration_s` and `manualDuration_s` too.
- `timing` is `"motion"`, `"manual"` or `null`. `manualDuration_s` = `(stopT - goT) / 1000` when `stopBy` is `"tap"`, else `null`.
- `onsetT` and `endT` are on the sample clock.
- `quality` is `"good"`, `"fair"` or `"poor"`.
- Every exploratory value can be `null`, and none is ever fed to the engine.

Issue codes (fixed list; `level` is `"info"`, `"warn"` or `"fail"`):
- `no_samples`, `too_short`, `low_rate`, `gaps`, `no_walk_detected`, `too_few_steps`
- `cadence_out_of_range`, `step_length_out_of_range`, `manual_mismatch`, `used_manual_timing`
- `paused`, `turned`, `not_still_at_start`, `distance_invalid`, `no_gyro`, `no_gravity_signal`, `speed_out_of_range` (fail: outside 0.15 to 2.5 m/s, so an impossible tap timing cannot become a baseline), `stopped_while_walking` (fail: stopped by a tap while the motion bout was still running, under 250 ms before the last sample; added at 04:00 because such walks came out 11 to 44% too fast and rated good)

Each `message` is one plain sentence telling the person what to do differently.

Rules:
- `ok` is true only when a duration and a valid `distance_m` (1 to 100 m) give a speed. It never throws on bad input; it returns `ok: false` with issues.
- **Prefer motion timing:** the walking bout runs from the first sustained movement after `goT` (or after the opening stillness when `goT` is null) to the start of the final stillness. Fall back to manual timing when no bout or fewer than 4 steps are found. Then add `used_manual_timing`, and say that it includes reaction time.
- `manual_mismatch` (warn) applies when both timings exist and differ by more than max(3 s, 20%). It was 1.5 s until 04:00; the Go-to-tap time includes reaction time and the wait at the line, which made 1.5 s raise false alarms.
- `turned`: a heading change of 45 to 120 degrees is warn. Over 120 degrees (turning back before the phone stopped) it is fail.
- Steps are peaks in the low-passed acceleration magnitude minus its baseline. Gravity-included magnitude is preferred; if it is missing, use the magnitude of `lx/ly/lz` (then `no_gravity_signal`, info). Peaks must be at least 0.3 s apart, with an adaptive height.
- `cadence_spm` = 60 / the median of half-strides ((peaks[i] - peaks[i-2]) / 2), so an asymmetric foot-drop gait reads correctly; it falls back to the step interval with fewer than 3 strides. `stepLength_m` = distance / steps.
- Step rhythm continuing after the bout end (3 or more step-like gaps), or found before the bout start (2 or more), gives `paused` at fail level: the timed part missed steps.
- `headingChange_deg` integrates the rotation rate projected on the gravity direction over the bout. More than 45 degrees gives `turned` (warn). Without a gyroscope it is `no_gyro` (info) and the value is null.
- `gyroCadence_spm` comes from the autocorrelation of the gyroscope magnitude. It is a cross-check only.
- **Quality:**
  - `good` needs a sample rate of at least 40 Hz, at least 8 steps, no gap over 250 ms, cadence 50 to 150, step length 0.3 to 1.1 m, motion timing, and no warn issues.
  - `poor` is anything with a `fail` issue.
  - `fair` is everything else.

## 4. `synth.js` (deterministic synthetic walks)

```js
export function synthWalk(opts = {}) { /* returns a recording with truth and simulated: true */ }
```

Options and defaults:
- `rateHz` 60, `jitterMs` 2
- `distance_m` 10, `steps` 14, `cadence_spm` 110
- `standBefore_s` 3 (the countdown, before goT), `reaction_s` 0.6 (goT to the first movement), `standAfter_s` 2
- `orientation` `"random"` (or `"upright"`, `"flat"`, or a 3x3 rotation matrix)
- `noise` 0.15 (m/s² SD), `amplitude` 2.5
- `gapAt_s` null (a dropout of `gap_ms` 400)
- `withGyro` true, `turn_deg` 0
- `stopBy` `"tap"`, `tapDelay_s` 0.4
- `seed` 1, `gravitySign` 1 (or -1 for iPhone-style), `stepAsym` 0 (up to 0.5, alternating long and short steps)

It uses a seeded PRNG, so the same options always give the same samples.

## 5. Server API (`motion/server.py`)

`python motion/server.py [--port 8090] [--https-port 8453] [--no-https] [--host 0.0.0.0]` prints the laptop URL and one phone URL per LAN address. The certificate is generated into `motion/.certs/`, with names for localhost and every LAN IP, and is regenerated when the IPs change.

- `POST /api/walks`: JSON body of at most 3 MB.
  - Body: `{ "v": 1, "kind": "rfn-walk", "id", "createdAt", "distance_m", "placement", "device", "result": WalkResult, "recording": Recording (optional, at most 20000 samples) }`.
  - Validation: `id` as above, `kind` exact, `distance_m` 1 to 100, `result` an object.
  - The server adds `receivedAt` (ISO), appends one line to `motion/data/walks.jsonl` and keeps the last 500 in memory.
  - Replies: `201 {"ok": true, "id"}`, or `200 {"ok": true, "duplicate": true}` for an id it already has. Bad input gets 400 with `{"ok": false, "error": "plain words"}`; too large gets 413.
- `GET /api/walks`: `{"walks": [summary...]}`, newest first. A summary is the record without `recording`, plus `"hasRecording": true|false`, plus `"simulated": true` when the stored recording says it is simulated.
- `GET /api/walks/<id>`: the full record, or 404.
- `GET /api/events`: Server-Sent Events.
  - `event: hello` with `{"walks": n}` on connect.
  - `event: walk` with a summary for each new walk.
  - `: ping` every 15 s.
- `GET /api/info`: `{"phoneUrls": [...], "laptopUrl": "...", "httpPort": 8090, "httpsPort": 8453 or null}`. The LAN addresses are recomputed on each request, so a network change shows after a page reload; the certificate still names only the startup addresses until a restart.
- `DELETE /api/walks`: only from a loopback client address with a Host header of localhost, 127.0.0.1 or ::1, else 403. The Host check blocks tunnels and DNS rebinding. It renames `walks.jsonl` to a timestamped `.bak` (never deletes) and empties memory: `{"ok": true, "cleared": n}`.
- All GET `/api/*` replies send `Access-Control-Allow-Origin: *`, so the app served elsewhere can read them. Every reply sends `Cache-Control: no-store`.
- Static files: no directory listing. Reject `..`, encoded traversal and absolute paths. Never serve `motion/data`, `motion/.certs` or anything outside `app/` and `motion/web/`. Correct MIME types, `.js` and `.mjs` as `text/javascript`.

## 6. Home-test row (laptop page to the app, localStorage `rfn.homeResults`, append-only JSON array)

```json
{ "date": "2026-11-08", "time": "07:12", "test": "gait_speed", "value": 1.24, "trial": 1, "person": "",
  "calibration": false, "source": "phone-motion", "walkId": "w-...", "timing": "motion",
  "steps": 14, "cadence": 104.2, "distance_m": 10, "quality": "good", "demoDate": true }
```

- `date` is local `YYYY-MM-DD`. `person` is the value of localStorage `rfn.hometests.person` (often `""`). `trial` = existing rows with the same test, person and date, plus 1.
- `source` is `"phone-motion"` or `"file"`. `demoDate` is present and true only when the date is not today, and the page labels such rows "demo date".
- Walks with `ok: false` or `quality: "poor"` cannot be saved. Nor can a speed outside 0.15 to 2.5 m/s: the laptop checks this again, because any device on the Wi-Fi can post a walk.
- The app averages same-day rows (`weeklySeries`), so 2 or 3 walks in one session become one weekly value.

## 7. `flag.js` (pure ES module, no imports; engine functions are passed in)

```js
export const GAIT_TEST_ID = 'gait_speed';
export const GAIT_TEST = { label: 'Walking speed, 10 m walk (phone motion sensors)', unit: 'm/s', region: 'leg', higherIsBetter: true, placeholderMdc: 0.28 };
export const GAIT_MDC = { prediagnosis: 0.28, diagnosed: 0.18, source: 'WatchALS (JMIR Formative Research 2026): MDC95 0.284 m/s in controls and 0.179 m/s in ALS, weekly home 60-second walk' };
export function ensureGaitTest(homeTests) {}                     // adds GAIT_TEST under gait_speed if absent; returns true if it added it
export function makeRow(walk, { date, time, person, results, today }) {}  // home-test row of section 6
export function gaitSeries(results, person) {}                   // [{ date, value, n, demo, sim }] weekly means, calibration rows excluded
export function gaitFlag(series, { mdc, detectDecline }) {}      // { flagged, decline, baseline, latest, mdc, pointsNeeded }
export function flagText(flag) {}                                // plain words for the laptop page
```

`detectDecline` is the engine's own function (`app/js/engine.js`): at least 4 points; baseline = mean of the first two; flag on two consecutive later points each worse than the baseline by more than the MDC.

## 8. `recording.js` (pure ES module, no imports)

```js
export function parseRecording(files) {}  // files: [{ name, text }]; returns { ok, recording, format, warnings: [], error }
```

Formats (detected from content, not only the file name):
- `rfn-json`: our recording JSON.
- `gyro-starter-csv`: `gyro-starter/recordings/*.csv`.
- `sensor-logger-csv`: Sensor Logger exports; one or more of its per-sensor CSVs, merged by time.
- `phyphox-csv`: phyphox exports, comma, semicolon or tab separated.

Units are converted to section 1 (rad/s to deg/s, g to m/s², ns or s to ms). The recording gets `distance_m: null` (the laptop page asks for it), except `rfn-json`, which keeps the phone's distance; the laptop page then fills its distance box from the file and `goT`/`stopT` from trial markers when the format has them, else `null`.

## Honesty rules for every screen

- Say it measures walking speed, not ALS, and that a decline leads to a doctor's review, not a diagnosis.
- Label demo dates and simulated walks wherever they appear.
- No made-up numbers. MDCs come from `GAIT_MDC` with its source.
