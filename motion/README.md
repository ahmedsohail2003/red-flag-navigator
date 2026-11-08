# Phone walking test: real motion data in, a walking-decline flag out

The phone's motion sensors (accelerometer and gyroscope) time a 10 m walk at usual pace and count the steps. The walking speed, in metres per second, is saved as a weekly home test. The red-flag tool's own rule then raises a flag when two weekly results in a row are slower than the person's baseline by more than normal variation. This test measures walking, not ALS. A flag means "a doctor should look sooner"; it is never a diagnosis.

**Status (8 Nov 2026, about 04:15): not yet run on a real phone.** Everything below was checked with simulated walks: 116 JavaScript and 46 Python tests, a browser run that fed a synthetic walk into the phone page as live motion events, and an independent review whose verified findings were fixed. After the morning check, record the phone model. For each walk, also record the step count against your own count and the time against a stopwatch.

## Is it worth it? What the motion sensors add

- **Walking speed over a measured course ranks first for earlier referral in our research** (`docs/WEARABLES.md`, rank 1; its ALS evidence is graded moderate).
  - Normal week-to-week variation (MDC95) is 0.28 m/s in people without ALS and 0.18 m/s in people with ALS, from WatchALS's weekly home 60-second walk with the phone on a lower-back belt.
  - `docs/WEARABLES.md` treats these values as approximate: a column header in the paper conflicts with them.
  - Gait speed correlated 0.83 with the ALSFRS gross-motor score.
- **The legs are where Alex's disease spread.** A walking decline in a second body region counts as "spread", and in the tool that goes straight to "refer for EMG".
- **What the sensors add over a stopwatch:**
  - **Timing.** They time the walk from the first movement to standing still at the line, so the stopwatch's reaction time is left out. This was checked on simulated walks only so far. The timed part includes slowing down at the line, so it reads a little slower than a clinic 10 m walk with a flying start. Compare a person only with themselves.
  - **Steps.** They count steps and give cadence and step length.
  - **Checks.** They check the walk itself: did the person stop early, pause, turn, or tap Stop while still walking? The gyroscope catches turns.
  - **Asymmetry.** They give an exploratory left-right step-time difference. It is unvalidated (`docs/WEARABLES.md` grades phone gait-quality measures weak, with no ALS evidence) and is never fed to the flag.
- **What they do not do:** detect or diagnose ALS. No phone or wearable signal has been validated for detecting undiagnosed ALS.

## Run it (use ONE server for the morning check and the demo)

The whole app now has one server. From the project folder:

```bash
python run.py
```

1. Laptop: open **http://localhost:8765/motion/receive.html** (the doctor's view). The app itself is at http://localhost:8765/, and both share one browser storage.
2. Phone, on the same Wi-Fi: open the **https://…:8443/motion/walk.html** address the server prints.
   - **Type it in full, starting with https://.** Phone browsers do not add it to an IP address, and without it the phone only says it could not connect.
   - The certificate is self-signed, so the browser warns once. On iPhone Safari: Show Details, then "visit this website". On Android Chrome: Advanced, then Proceed.
3. Tap **Start**. On iPhone, tap **Allow** for Motion & Orientation.

If `run.py` says port 8765 is in use, close the `serve.py` window first. Use `python motion/server.py` (laptop http://localhost:8090, phone port 8453) only if `run.py` will not start, and then run the demo from http://localhost:8090 as well.

**Why one server.** Saved walking results stay in the laptop browser under the address they were saved from. http://localhost:8765 and http://localhost:8090 do not see each other's results, and `run.py` does not read `motion/data/walks.jsonl`. So do the morning walks and the 11:30 demo on the same server, in the same browser, at the same address.

**Windows firewall:** allow Python when Windows asks, including Public networks. If you missed the prompt, run this in an administrator PowerShell:

```powershell
New-NetFirewallRule -DisplayName "RFN one server" -Direction Inbound -Protocol TCP -LocalPort 8765,8443 -Action Allow
```

**If the phone cannot reach the laptop:**
- **Hotspot.** Venue Wi-Fi often blocks phone-to-laptop traffic. Turn on the phone's hotspot and join the LAPTOP to it.
  - Then stop the server (Ctrl+C) and start it again. It prints the new phone address; the old one no longer works.
  - The phone shows the certificate warning once more.
- **Tunnel.** Run `ssh -R 80:localhost:8765 localhost.run` and open `<the https address it prints>/motion/walk.html` on the phone. Keep the laptop on http://localhost:8765.
- **No network at all.** On the phone, tap **Download recording**, send the file to the laptop, and use **Import a recording** on the laptop page. The distance saved in the file is used.

## The walk

1. Mark a straight 10 m path with a tape measure. Use your usual walking aid or brace. If you might fall, have someone walk beside you.
2. Stand at the start line. Hold the phone flat against your belly, or put it in a front trouser pocket (pocket gives a longer countdown to put it away).
3. On iPhone, turn Silent mode off and the volume up: the phone beeps at GO and again when it stops timing. Tap Start and stand still for the countdown.
4. At **GO**, walk at your usual pace to the line. **Stand still at the line until the phone beeps** (about 2 seconds). Tap Stop only if it does not beep.
   - Tapping Stop while still walking makes the walk unusable on purpose: a cut-short time would look like a faster walker.
5. Do 2 or 3 walks per session. The app averages same-day walks into one weekly value.

## Morning checklist (about 5 minutes)

- [ ] The server you will demo with (`python run.py`) starts, and the laptop page shows the phone address.
- [ ] The phone opens the https:// page, accepts the certificate, and asks for (iPhone) or gets (Android) motion access. You hear the beep at GO and at the stop (iPhone: Silent mode off).
- [ ] Three normal walks: steps counted within about 1 of your own count, the time close to a stopwatch, and quality "good". Write down the phone model and these numbers.
- [ ] Each walk appears on the laptop. Save them under your own name.
- [ ] Demo flag, in the same browser at the same address you will demo from:
  - In Save settings, type the name **Demo (dates moved)**.
  - Save two normal walks under demo dates 4 and 3 weeks ago, then two deliberately slow walks under 2 weeks and 1 week ago.
  - The flag should appear.
  - The laptop page labels demo dates, and so does the app's Monitoring view (a "Demo dates" chip; the merge patch was applied on 8 Nov).
  - On stage, say the dates were moved for the demo.

## Where the data goes

- **The walk file.** Each walk (its time, the phone's browser name, the motion readings and the result; no name) is stored on this laptop and kept until you delete it: in `data/rfn.sqlite` under `run.py`, or in `motion/data/walks.jsonl` under `motion/server.py`.
- **The walk list is open.** While the server runs, anyone on the same Wi-Fi can read the walk list and send walks, because there is no login. Only save walks you saw happen.
- **Saved results.** Weekly results, with the name you type, stay in this laptop browser. Remove them with **Remove walking results saved from this page**.
- **Before the demo, empty the received-walks list.** Under `motion/server.py`, run this in PowerShell on the laptop, then reload the page:

  ```powershell
  Invoke-RestMethod -Method Delete http://localhost:8090/api/walks
  ```

  The file becomes `walks-<time>.jsonl.bak`. Under `run.py`, see `server/README.md`.
- **After the hackathon,** remove the firewall rule:

  ```powershell
  Remove-NetFirewallRule -DisplayName "RFN one server"
  ```

## What is real, simulated or assumed

| Real | Checked only with simulated walks so far | Assumed |
|---|---|---|
| The analysis code and the flag rule (the app's own `detectDecline` and rules). The phone's own readings, once the morning check passes. | Step detection and timing on real walking: synthetic walks at 30 to 100 Hz in any phone orientation, slow and asymmetric gaits, and taps cut mid-walk | The MDC, borrowed from WatchALS's 60-second belt-worn walk; check it against the team's own repeat walks |
| | The iPhone permission prompt, the certificate, the Wi-Fi path, the beep on a silent iPhone | That a 10 m standing-start walk is as repeatable week to week as WatchALS's walk |

## Files

| File | What it is |
|---|---|
| `server.py` | Stand-alone server (8090/8453) for tests. The demo uses `run.py`. |
| `web/walk.html` | The phone page |
| `web/receive.html` | The laptop page |
| `web/gait.js` | The analysis (pure, tested) |
| `web/flag.js` | The flag logic and the home-test row |
| `web/recording.js` | Reads recordings from the phone page, gyro-starter, Sensor Logger and phyphox |
| `web/synth.js` | Synthetic walks for tests |
| `CONTRACT.md` | Every interface |
| `MERGE.md` | How to fold this into the app's views |

Tests, from the project folder:

```bash
node --test "motion/tests/*.test.mjs"
```

```bash
python -m unittest discover -s motion/tests -p "test_*.py" -v
```
