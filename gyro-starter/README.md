# Gyro starter: your phone (or AirPods, or Apple Watch) as a Wii-style remote

> **Using the whole app?** Start everything with `python run.py` in the project folder instead of this server. The addresses are then:
> - phone page: `https://<laptop-ip>:8443/gyro/phone.html`
> - Sensor Logger push: `http://<laptop-ip>:8765/sensorlogger`
> - this screen: `http://localhost:8765/gyro/screen.html`
>
> Everything is also saved to the database. See `docs/MORNING_TEST.md`. The ports below (8080 and 8443) are for running this folder on its own.

A page on your phone reads its gyroscope through the browser and streams it to the laptop. The laptop
shows a pointer you aim by turning the phone, plus swings and buttons. This is the Wii-remote idea, and
it's how the AirPods projects at Hack the North 2026 worked too: turning speed becomes a pointer, and a
fast turn becomes a swing.

There are two ways in:

- **Phone, nothing to install:** open a web page on the phone. See [Run it](#run-it).
- **AirPods, Apple Watch or phone through Sensor Logger:** a free iPhone/Android app that pushes the
  sensors over HTTP. No code, no certificates. See [AirPods and Apple Watch](#airpods-and-apple-watch-through-sensor-logger).

The laptop side is Python 3.10+ standard library only. `--https` also uses the `cryptography` package to
make a certificate (it is already installed on this laptop). Anything else that can make an HTTP request can
drive the same screen; see [Protocol](#protocol).

## Run it

From the project folder:

```bash
python gyro-starter/server.py --https
```

1. On the laptop, open **http://localhost:8080/screen.html**.
2. On the phone (same Wi-Fi), open the **https://…:8443/phone.html** address the server prints. The
   certificate is self-signed, so the browser warns once. On iPhone Safari: Show Details, then
   "visit this website". On Android Chrome: Advanced, then Proceed.
3. Tap **Start motion sensors**. On iPhone, tap **Allow** when asked for Motion & Orientation access.
   If you tap Don't Allow, Safari remembers it until it restarts. Swipe Safari away in the app switcher,
   then reopen the page.
4. Hold the phone flat with the top pointing at the laptop. Turn it to move the pointer, press **A** on a
   target, hold **B** to freeze the pointer while you re-aim, and flick hard for a swing. **Recenter** (or
   the R key) puts the pointer back in the middle, because a gyro-only pointer drifts slowly.

**Windows firewall:** the first run shows a Windows Defender Firewall prompt for Python. Allow it,
including Public networks: venue Wi-Fi and phone hotspots are often marked Public. Otherwise the phone
cannot connect. If you dismissed the prompt, Windows does not ask again. Add the rule yourself in a
PowerShell window opened as administrator:

```powershell
New-NetFirewallRule -DisplayName "Gyro starter" -Direction Inbound -Protocol TCP -LocalPort 8080,8443 -Action Allow
```

### Why HTTPS, and why POST instead of a WebSocket

Browsers only give motion data to secure pages: `https://` addresses, or `localhost` on the same device.
A phone that opens `http://192.168.x.x` gets no motion events, so the phone page needs HTTPS. Whether a
page counts as secure depends on the `https` scheme, not on the certificate being trusted, so a
self-signed page you clicked through still qualifies. On iPhone, a `wss://` WebSocket to a self-signed
certificate is reported to fail even after you accept the warning. So the phone sends samples as
ordinary HTTPS POSTs to the same address, which do work once the page has loaded.

### If the phone cannot reach the laptop

Venue and campus Wi-Fi often block device-to-device traffic (client isolation). There are two ways around it:

- **Phone hotspot.** Join the laptop to your phone's hotspot, run with `--https`, and open the printed
  address on the phone. An iPhone hotspot only turns on with cellular data.
- **HTTPS tunnel.** This also removes the certificate warning. Run `python gyro-starter/server.py` (no
  `--https` needed), then in a second terminal start one of the commands below. Open
  `<the https URL it prints>/phone.html` on the phone:
  - `ssh -R 80:localhost:8080 localhost.run` (nothing to install: Windows ships ssh; no account needed)
  - `cloudflared tunnel --url http://localhost:8080` (needs cloudflared; no account needed)

  Keep the screen page on **http://localhost:8080/screen.html**, not the tunnel address: Cloudflare quick
  tunnels do not carry Server-Sent Events, which is how the screen receives data. The phone only POSTs,
  and POSTs go through tunnels fine. A tunnel routes the motion data through a third-party server, so use it
  for demos, not patient data.

  Avoid ngrok's free plan here. It allows 20,000 HTTP requests a month, and the phone page POSTs up to
  about 60 times a second. If you must use a metered tunnel, open `phone.html?gap=200`, which sends at most
  5 requests a second in bigger batches.

## AirPods and Apple Watch through Sensor Logger

[Sensor Logger](https://www.tszheichoi.com/sensorlogger) is free (iOS 16.4+, Android; paid tiers are
optional). It can stream **Headphone Motion** (AirPods with head tracking: AirPods 3 and later, any AirPods
Pro, AirPods Max) and Apple Watch **Wrist Motion** (in Phone & Watch mode), plus the phone's own gyroscope.
It pushes these as JSON to any URL. The server accepts that format at `/sensorlogger` (or `/data`):

1. Run `python gyro-starter/server.py` and open http://localhost:8080/screen.html on the laptop.
2. In Sensor Logger on the phone, turn on the sensors you want: Headphone (AirPods connected), Wrist
   Motion (watch app open), or Gyroscope and Gravity.
3. Open the settings (gear icon on the Logger page) and turn on HTTP Push. Set the URL to
   `http://<laptop-ip>:8080/sensorlogger` and tap **Tap to Test Pushing**. On venue Wi-Fi with client
   isolation, use a tunnel URL instead (`https://<tunnel>/sensorlogger`). If iOS asks for Local Network
   access, allow it.
4. Start a recording. The screen lists the device as **airpods**, **watch** or **phone (Sensor Logger)**.
   Pick it under "Drives the pointer". For AirPods, turning your head moves the pointer and a quick head
   turn is a swing. Use Invert X/Y if a direction is backwards.

The server converts the units: rad/s to °/s, epoch nanoseconds to milliseconds, and g to m/s².

**What to expect:** AirPods motion arrives at about 25 Hz on an iPhone. Researchers measured this; Apple
does not document a rate. The free tier of Sensor Logger sends one batch per second, and a shorter batch
period is a paid setting. The pointer catches up once a second, so it moves in steps. That is fine for
trying it out and for recording, but not for playing a game. For a smooth AirPods
remote, an iPhone app using Apple's `CMHeadphoneMotionManager` should POST to `/ingest` itself, which
needs Xcode on a Mac. The research report covers the options.

## How it works

```text
phone.html  --POST /ingest (JSON batches)-->  server.py  --GET /events (Server-Sent Events)-->  screen.html
Sensor Logger --POST /sensorlogger-------->      |
                                                  `--> recordings/*.csv (when recording)
```

- **phone.js** listens to `devicemotion` (rotationRate in °/s, accelerations in m/s²) and
  `deviceorientation`. It POSTs batches with one request in flight at a time, at most about 60 a second;
  samples that arrive meanwhile ride in the next batch. If the laptop is unreachable, it drops old samples
  so the stream stays live, but keeps button presses.
- **server.py** relays every batch to every open screen, keeps per-device counts (`/stats`), converts
  Sensor Logger pushes, and records to CSV on request.
- **screen.js** turns turning speed into a pointer: the move is turning speed (°/s) × time (s) × the speed
  setting (px per degree). It uses the device's own timestamps, so network bunching does not change the speed.
  - Grip is detected from gravity. Flat (screen up, top toward the screen, Wii style) uses turning around
    the device's z axis for left and right. Upright (camera toward the screen) uses the y axis. Up and down
    is the x axis in both. AirPods and watches use the same rule, based on the gravity they report; their
    axes have not been checked on real hardware. Invert X/Y fixes a device that reports the opposite sign.
  - A swing is the total turning speed passing a threshold (default 300 °/s), at most one per 350 ms. A
    swing does not move the pointer.

## Protocol

Anything that can make an HTTP request can be a remote. POST JSON to `/ingest`:

```json
{
  "source": "my-device",
  "samples": [
    {"t": 1234.5, "gx": 1.2, "gy": -0.4, "gz": 35.0, "ax": 0.1, "ay": 0.2, "az": 9.81}
  ],
  "events": [
    {"type": "button", "id": "A", "down": true},
    {"type": "recenter"}
  ]
}
```

| Field | Meaning | Unit |
|---|---|---|
| `t` | sample time on the sending device; must increase | milliseconds |
| `gx`, `gy`, `gz` | turning speed around the device's x (right edge), y (top edge) and z (out of the screen) axes | degrees per second |
| `ax`, `ay`, `az` | acceleration including gravity (only used to detect the grip, so the sign does not matter) | m/s² |
| `lx`, `ly`, `lz` | acceleration without gravity (optional) | m/s² |
| `oa`, `ob`, `og` | orientation alpha, beta, gamma (optional) | degrees |

Apple's Core Motion (iPhone, Apple Watch, AirPods) reports `rotationRate` in radians per second and
gravity in g: multiply by 57.2958 and by 9.81 before sending.

Other endpoints: `GET /events` (the stream), `GET /stats` (counts per device), `POST /record` with
`{"on": true}` or `{"on": false}`, and `POST /sensorlogger` (Sensor Logger's own format).

## Recording data

On the screen page, **Start recording** writes every sample and button press to
`gyro-starter/recordings/motion-YYYYMMDD-HHMMSS.csv`, with the columns
`server_time, source, kind, t, gx, gy, gz, ax, ay, az, lx, ly, lz, oa, ob, og, event`.
Press A on the phone to mark the start and end of a trial; those presses are rows with `kind = event`.

## Tests

```bash
python -m unittest discover -s gyro-starter/tests -v
```

Eleven tests:

- pages are served, and files outside `static/` are not
- bad bodies are rejected
- one keep-alive connection carries many posts
- a viewer receives samples and buttons
- recording writes a well-formed CSV
- Sensor Logger pushes are converted correctly: units, times, and which device each reading belongs to
- the Sensor Logger endpoint relays to viewers and accepts a test push with no readings
- the self-signed HTTPS listener serves pages and survives a client that rejects its certificate
- phone.js sends `rotationRate.alpha`, `beta` and `gamma` as `gx`, `gy` and `gz` (checked in its source text)

## What has and has not been checked

- Checked on this laptop, 7 Nov 2026: the ten tests pass. In Claude's browser pane, with simulated
  motion events:
  - Turning at 10 °/s for 1.33 s at 20 px/° moved the pointer exactly 266 px left. Tilting at 10 °/s for
    0.65 s moved it exactly 130 px up.
  - The upright grip moved it the right way (132 px).
  - A flick counted as one swing without moving the pointer.
  - A reached the screen, and holding B froze the pointer.
  - A simulated Sensor Logger AirPods push (1 s of turning at 0.2 rad/s) moved it exactly 229 px.
- Corrected 8 Nov 2026: phone.js sent `rotationRate.beta`, `gamma`, `alpha` as `gx`, `gy`, `gz`, the
  order MDN's DeviceMotionEventRotationRate pages give. The W3C spec (section 6.3.2) and Chrome, Safari
  and Firefox make `alpha`, `beta`, `gamma` the rates about the device's x, y, z axes, so a real phone held
  flat would not have moved the pointer when turned, and tilting would have moved it sideways. It now
  sends `alpha`, `beta`, `gamma` as `gx`, `gy`, `gz`. The 7 Nov simulated events used the old order
  (turning was `alpha` flat and `gamma` upright, tilting `beta`), so the turning, tilting and upright
  checks above need repeating, with turning as `gamma` (flat) or `beta` (upright) and tilting as `alpha`.
- Not checked on real hardware: no phone, AirPods or watch was available. That leaves untested the
  iPhone permission prompt, accepting the self-signed certificate, Sensor Logger's real pushes, real
  sensor rates, and the axis signs on each device. If the pointer moves the wrong way, tick Invert X or
  Invert Y on the screen page.
