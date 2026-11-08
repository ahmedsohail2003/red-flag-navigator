# One server for the whole app

`python run.py` starts one server that:

- serves the app and every phone page from one address, so browser storage is shared between them;
- accepts every device format unchanged: the phone motion page, Sensor Logger (AirPods, Apple Watch,
  phone) and the phone walk test;
- saves everything that arrives to a local SQLite database, `data/rfn.sqlite`, so you can see that the
  data is really being logged.

It uses the Python standard library, plus the `cryptography` package for the self-signed HTTPS
certificate (already installed on this laptop). The contract is [`SPEC.md`](SPEC.md).

## Run it

From the project folder:

```bash
python run.py
```

Port 8765 is also the port `serve.py` (the app preview) uses. If that is running, `run.py` stops with
"Could not start ... port 8765". Stop `serve.py` first, or pick other ports:

```bash
python run.py --port 8790 --https-port 8490
```

| Option | Default | Meaning |
|---|---|---|
| `--port` | 8765 | Plain HTTP, for the laptop and for Sensor Logger |
| `--https-port` | 8443 | HTTPS, for phone pages (phones give motion data only to secure pages) |
| `--no-https` | off | Plain HTTP only. The phone pages then get no motion data |
| `--host` | `0.0.0.0` | The network interface to listen on (all of them by default) |
| `--db` | `data/rfn.sqlite` | The database file. Its folder is created if missing |
| `--recordings-dir` | `data/recordings` | Where CSV recordings go (a `recordings` folder next to `--db`) |
| `--session-gap` | 20 | Seconds without samples that end a stream session |

On start it prints every address. Stop it with **Ctrl+C**: it closes any CSV recording, folds the
database's write-ahead log back into `rfn.sqlite`, and prints `Stopped.` While it runs, it prints each
device's rate every 5 seconds and one line for each walk it receives.

```text
One server for the whole app is running. Everything that arrives is saved to the database.
  App (laptop): http://localhost:8765/
  Motion screen (laptop): http://localhost:8765/gyro/screen.html
  Walk results (laptop): http://localhost:8765/motion/receive.html
  Phone motion stream: https://192.168.68.118:8443/gyro/phone.html  (accept the certificate warning once)
  Phone walk test: https://192.168.68.118:8443/motion/walk.html
  Sensor Logger HTTP push URL (AirPods, Watch, phone): http://192.168.68.118:8765/sensorlogger
  Database: C:\Users\sohai\Documents\Hackathons\Hamilton Datathon\data\rfn.sqlite
  Windows firewall: if a phone cannot connect, ... New-NetFirewallRule ... -LocalPort 8765,8443 -Action Allow
  Try it without hardware: python server/simulate.py --url http://localhost:8765 --walk
  Stop with Ctrl+C.
[02:54:11] airpods (simulated): 25 Hz, watch (simulated): 50 Hz, phone (simulated): 60 Hz | saved this run: 1794 samples | viewers: 0
```

## What each address is for

| Address | Open it on | What it is |
|---|---|---|
| `http://localhost:8765/` | laptop | The red-flag app (`app/`) |
| `http://localhost:8765/gyro/screen.html` | laptop | Live motion screen: the devices sending now, their rates, and CSV recording (`gyro-starter/static/`) |
| `http://localhost:8765/motion/receive.html` | laptop | Walk results as they arrive from the phone (`motion/web/`) |
| `https://<laptop-ip>:8443/gyro/phone.html` | phone | Streams the phone's gyroscope and accelerometer |
| `https://<laptop-ip>:8443/motion/walk.html` | phone | The 10 m walking test |
| `http://<laptop-ip>:8765/sensorlogger` | Sensor Logger app | Where Sensor Logger pushes AirPods, Watch and phone motion |
| `http://localhost:8765/api/db/summary` | laptop | What the database holds now: row counts, devices with live rates, the newest sessions |

`/gyro/` and `/motion/` serve their folders' pages. `/motion/` gives 404 until `motion/web/` exists.
Every other path is a file in `app/`. The server never serves `data/`, a `.certs` folder, `server/`,
`motion/data/` or anything outside those three folders. It refuses `..`, encoded traversal (`%2e%2e`,
`%5c`), drive letters and names starting with a dot, and it never lists a folder.

## See data arrive without any hardware

With the server running, in a second terminal:

```bash
python server/simulate.py --url http://localhost:8765 --seconds 10 --walk
```

It sends clearly **simulated** data through the same endpoints the real devices use:

- AirPods head turns, about 25 Hz, and Watch arm swing, about 50 Hz. These go as real-format Sensor
  Logger pushes to `/sensorlogger?simulated=1`, one push every 0.25 s, with turning speed in rad/s,
  gravity in g and times in epoch nanoseconds.
- The phone, turned like a remote while walking, about 60 Hz, as `/ingest` batches.
- With `--walk`, one synthetic 10 m walk to `/api/walks`, with its 816-sample recording.

Every name ends in `(simulated)`: `airpods (simulated)`, `watch (simulated)`, `phone (simulated)` and
`phone-walk (simulated)`. The `?simulated=1` flag is how the server knows to add that label to Sensor
Logger device names. Real data never carries the flag. At the end, the simulator reads the totals back
from `/api/db/summary`. It exits with code 1 if any simulated device is missing from the database.

```text
Database totals, read back from /api/db/summary:
  devices 4, sessions 4, samples 2166, events 0, walks 1, home_results 0
  phone (simulated): 600 samples stored (simulated, phone), rate now 63.0 Hz, last 0.0 s ago
  watch (simulated): 500 samples stored (simulated, watch), rate now 50.0 Hz, last 0.0 s ago
  airpods (simulated): 250 samples stored (simulated, airpods), rate now 25.0 Hz, last 0.0 s ago
  phone-walk (simulated): 816 samples stored (simulated, phone), rate now 0.0 Hz, last 10.0 s ago
  newest walk: w-sim-20261108T025404-acba, 1.25 m/s (simulated)
OK: rows are stored for airpods (simulated), watch (simulated), phone (simulated), walk w-sim-20261108T025404-acba.
```

Open `http://localhost:8765/gyro/screen.html` while it runs to watch the simulated devices live.
Other options: `--devices airpods,watch,phone` picks which devices to simulate, `--seed 1` picks the
random seed, and `--url https://localhost:8443` sends over HTTPS instead.

## With real hardware

1. **Phone motion stream.** On the phone, on the same Wi-Fi as the laptop, open the printed
   `https://<laptop-ip>:8443/gyro/phone.html`. Accept the certificate warning once:
   - iPhone Safari: Show Details, then "visit this website".
   - Android Chrome: Advanced, then Proceed.

   Tap **Start motion sensors**, and **Allow** on iPhone. The phone is stored as device `phone`, or as
   whatever name you type on the page.
2. **AirPods and Apple Watch, through Sensor Logger** (free iPhone app):
   1. Turn on Headphone (with AirPods connected) and/or Wrist Motion (with the Watch app open).
   2. In the settings, turn on HTTP Push and set the URL to the printed `http://<laptop-ip>:8765/sensorlogger`.
   3. Tap "Tap to Test Pushing". The server answers `{"ok": true, "samples": 0}` to a test push.
   4. Start a recording. The devices appear as `airpods`, `watch` and `phone (Sensor Logger)`.

   The free tier pushes about once a second.
3. **Walk test.** On the phone, open `https://<laptop-ip>:8443/motion/walk.html`. On the laptop, open
   `http://localhost:8765/motion/receive.html` to see each walk arrive.
4. **Check that it is logged.** Open `http://localhost:8765/api/db/summary` and reload it. The row counts
   should grow, and each device should show a rate. You can also run the queries below.

**Windows firewall:** if the phone cannot connect, Python must be allowed through Windows Defender Firewall.
When Windows asks, allow it on Private and Public networks: venue Wi-Fi and phone hotspots are often
marked Public. If you dismissed that prompt, add the rule yourself in a PowerShell window opened as
administrator:

```powershell
New-NetFirewallRule -DisplayName "RFN one server" -Direction Inbound -Protocol TCP -LocalPort 8765,8443 -Action Allow
```

Venue Wi-Fi often blocks device-to-device traffic. If the phone still cannot reach the laptop, join the
laptop to the phone's hotspot (see `gyro-starter/README.md`, "If the phone cannot reach the laptop").

## Where the data is

- `data/rfn.sqlite`: the database. While the server runs you also see `rfn.sqlite-wal` and
  `rfn.sqlite-shm`. That is normal in WAL mode, and they fold back into `rfn.sqlite` on Ctrl+C.
- `data/recordings/motion-*.csv`: recordings made with **Start recording** on the motion screen
  (`POST /record`). These use the same columns as gyro-starter's recordings.
- The server writes `data/.gitignore` (containing `*`), so nothing in `data/` is ever committed.
- To start fresh, stop the server, then rename or delete `data/rfn.sqlite`.

## Look inside the database

These work while the server is running, because SQLite in WAL mode lets readers in alongside the writer.
Run them from the project folder, in PowerShell or bash:

```bash
python -c "import sqlite3; c = sqlite3.connect('data/rfn.sqlite'); print({t: c.execute('select count(*) from ' + t).fetchone()[0] for t in ('devices', 'sessions', 'samples', 'events', 'walks', 'home_results')})"
```

```bash
python -c "import sqlite3, time; c = sqlite3.connect('data/rfn.sqlite'); [print(i, k, n, 'simulated' if s else 'real', time.ctime(t)) for i, k, n, s, t in c.execute('select id, kind, samples, simulated, last_seen from devices')]"
```

```bash
python -c "import sqlite3; c = sqlite3.connect('data/rfn.sqlite'); [print(r) for r in c.execute('select device_id, t_ms, gx, gy, gz, ax, ay, az from samples order by rowid desc limit 5')]"
```

```bash
python -c "import sqlite3; c = sqlite3.connect('data/rfn.sqlite'); [print(r) for r in c.execute('select id, kind, device_id, samples, round(ended_at - started_at, 1) from sessions order by started_at desc limit 10')]"
```

```bash
python -c "import sqlite3; c = sqlite3.connect('data/rfn.sqlite'); [print(r) for r in c.execute('select id, speed_mps, quality, simulated, deleted_at from walks order by received_at desc')]"
```

To export one session as CSV, use the `csv_url` that `/api/db/summary` lists for it. For example, open
`http://localhost:8765/api/db/sessions/<session id>.csv` in the browser.

## API

### Device formats (the same as their owners' contracts)

| Request | Body | Reply |
|---|---|---|
| `POST /ingest` or `/gyro/ingest` | `{source, samples: [{t, gx, gy, gz, ax, ay, az, lx, ly, lz, oa, ob, og}], events: [...]}`, as in `gyro-starter/README.md` "Protocol" | 204 |
| `POST /sensorlogger`, `/data`, `/gyro/sensorlogger` | Sensor Logger's push. Add `?simulated=1` for simulated data only | 200 `{"ok": true, "samples": n}`. A push with no `payload` list is a connection test: 0 samples |
| `GET /events` or `/gyro/events` | | Server-Sent Events, one `data:` line per batch (gyro-starter's format) |
| `GET /stats` or `/gyro/stats` | | Live counts per device |
| `POST /record` or `/gyro/record` | `{"on": true}` or `{"on": false}` | Starts or stops a CSV in `data/recordings/` |

Units in the database are the gyro protocol's:

- `t_ms`: the device's own time, in ms. Sensor Logger times become epoch ms.
- `gx`, `gy`, `gz`: turning speed in deg/s.
- `ax`, `ay`, `az`: acceleration including gravity, in m/s².
- `lx`, `ly`, `lz`: acceleration without gravity, in m/s².

The server converts Sensor Logger's rad/s, g and nanoseconds. Orientation (`oa`, `ob`, `og`) still goes
to the live screen and to CSV recordings, but it is not a database column.

### Walk test (`motion/CONTRACT.md` section 5, stored in the database)

| Request | Reply |
|---|---|
| `POST /api/walks`, JSON at most 3 MB, `Content-Type: application/json` | 201 `{"ok": true, "id"}` when new. 200 `{"ok": true, "duplicate": true}` for an id already stored. 400 `{"ok": false, "error": "plain words"}` for bad input. 413 if too large. 415 if not JSON |
| `GET /api/walks` | `{"walks": [summary, ...]}`, newest first. A summary is the record without `recording`, plus `hasRecording` and `receivedAt` |
| `GET /api/walks/<id>` | The full record, with the recording rebuilt from the database, or 404 |
| `GET /api/events` | Server-Sent Events. `event: hello` with `{"walks": n}`, then `event: walk` with a summary for each new walk. `: ping` every 15 s |
| `GET /api/info` | `phoneUrls` (walk test), `gyroPhoneUrls`, `sensorLoggerUrls`, `laptopUrl`, `httpPort`, `httpsPort` (null without HTTPS), `db` |
| `DELETE /api/walks` | Only from the laptop itself, sent to `http://localhost:8765` (or `127.0.0.1`), with exactly one Host header. In PowerShell: `Invoke-RestMethod -Method Delete http://localhost:8765/api/walks`. Anything else gets 403: another device, a tunnel, or the laptop's own LAN address. Marks every walk deleted and keeps the rows: `{"ok": true, "cleared": n}` |

A walk's recording samples go into `samples`, under session `walk-<walk id>` (kind `walk`). The device is
`phone-walk`, or `phone-walk (simulated)` when the walk says `simulated: true`. A cleared walk still
counts as stored. If a phone resends it, the server answers "duplicate", so the phone stops resending.

### Home-test results

`POST /api/home-results` with `{"rows": [...]}`, the rows of the browser's `rfn.homeResults`. Send it as
`Content-Type: application/json`.

- Each row is stored once, by its own `id`. A row without an `id` gets a hash of `date`, `time`, `test`,
  `value`, `person`, `trial` and `calibration`.
- Sending the same rows again adds nothing.
- The reply is `{"ok": true, "stored": n, "new": k, "total": m, "skipped": s}`.

### Reading the database (for the app's "Devices and data" screen)

| Request | Reply |
|---|---|
| `GET /api/health` | `{"ok": true, "server": "rfn-one-server", "version": 1, "db": true, "https": bool, "httpsPort", "time"}`. The app uses it to tell the real server from the hosted copy |
| `GET /api/db/summary` | `counts` per table; `db` (`path`, `bytes`, `wal_bytes`); `devices` (`id`, `kind`, `simulated`, `samples`, `rate_hz` = samples stored in the last 5 s divided by 5, `seconds_since_last`); the 20 newest `sessions` (each with `csv_url`); `newest_walk`; `home_results`; `stream` (live viewers, CSV recording); `sensorLogger` (`pushes`, `tests` and `last`, which holds what the newest Sensor Logger push held: each sensor name with its `count` and `role`. The role is `stored` (with its `device`), `unreadable` (it should have been stored, but no reading converted, such as AirPods readings from Sensor Logger before 1.30, which have no rotationRate), `helper` (gravity) or `ignored`. No Sensor Logger device, session or user ids are kept) |
| `GET /api/db/samples?device=<id>&limit=<n>&since=<received_at>` | That device's newest samples, at most 2000, oldest first. With `since`, only the samples received after that time (epoch seconds) |
| `GET /api/db/sessions/<id>.csv` | One session's samples as CSV, with a header row, as a download |

Every `GET /api/*` reply has `Access-Control-Allow-Origin: *`. Every reply has `Cache-Control: no-store`.

## Database schema

```sql
devices(id TEXT PRIMARY KEY, kind TEXT, first_seen REAL, last_seen REAL, samples INTEGER, simulated INTEGER)
sessions(id TEXT PRIMARY KEY, device_id TEXT, kind TEXT, started_at REAL, ended_at REAL, samples INTEGER,
         label TEXT, meta TEXT)            -- kind: 'stream' | 'walk' | 'import'
samples(session_id TEXT, device_id TEXT, t_ms REAL, received_at REAL,
        gx REAL, gy REAL, gz REAL, ax REAL, ay REAL, az REAL, lx REAL, ly REAL, lz REAL)
events(id INTEGER PRIMARY KEY, device_id TEXT, received_at REAL, type TEXT, payload TEXT)
walks(id TEXT PRIMARY KEY, created_at TEXT, received_at REAL, distance_m REAL, placement TEXT,
      speed_mps REAL, quality TEXT, simulated INTEGER, result TEXT, device TEXT, has_recording INTEGER,
      deleted_at REAL)
home_results(id TEXT PRIMARY KEY, received_at REAL, date TEXT, test TEXT, value REAL, person TEXT,
             source TEXT, simulated INTEGER, payload TEXT)
```

- Times (`*_at`, `first_seen`, `last_seen`) are the laptop's clock, in epoch seconds.
- A device's `kind` comes from its name, checked in this order: a name containing `airpods` is
  `airpods`, then `watch`, then `phone`, and anything else is `other`. `simulated` is 1 when the name
  contains `simulated`.
- A stream session starts at a device's first sample. It ends after 20 s without samples, and the next
  sample starts a new one. If the server restarts within 20 s, the session carries on. Session ids look
  like `s-20261108-025404-airpods-simulated-272e`.
- `result`, `device`, `meta` and `payload` hold JSON text.
- Indexes:
  - `samples (device_id, received_at)`
  - `samples (session_id)`
  - `sessions (device_id, ended_at)`
  - `sessions (started_at)`
  - `events (device_id, received_at)`
  - `walks (received_at)`
- Writes go through one connection behind a lock: one transaction per incoming batch, with `executemany`.
  Reads open their own connection, so they never hold up a phone.
- Measured on this laptop:
  - 600,000 samples stored in 17 s;
  - `/api/db/summary` takes 70 ms at that size;
  - the file grows by about 180 bytes per sample, indexes included.

## Moving to Postgres or TimescaleDB

The server only writes SQLite. `server/migrate.py` copies `data/rfn.sqlite` into the Postgres or TimescaleDB
(Tiger Data) database named in `DATABASE_URL`, using `server/schema_pg.sql`. The steps and the rules (only
simulated data goes to the cloud) are in `docs/DATABASE.md`.

- `python server/migrate.py --dry-run` counts the rows per table and sends nothing.
- The cloud schema keeps SQLite's columns and types (flags as integers, JSON as text), plus one extra column on
  `samples`, `received_ms` (the receive time in ms). `samples` is a hypertable on it, in one-day chunks.
- It has been tested against a stand-in connection only, not a real Tiger Data service.

## Tests

```bash
python -m unittest discover -s server/tests -v
```

There are 54 tests: 44 in `test_server.py` and 10 in `test_migrate.py` (the copy to Postgres, against a stand-in
connection). The server tests start the server on free ports, with a temporary database, recordings folder,
certificate folder and `motion/web` folder:

- `/ingest` and `/gyro/ingest` store rows, the device and the session.
- Sensor Logger pushes are stored in deg/s, m/s² and ms, under `airpods` and `watch`. `?simulated=1` names
  them `... (simulated)`. A connection test gets 200 with 0 samples.
- Walks:
  - POST answers 201, then 200 for a duplicate.
  - Bad input gets 400; too large gets 413; not JSON gets 415.
  - The list is newest first, and a walk read back by id has its full recording.
  - DELETE works from the laptop at localhost, and gets 403 from anywhere else, with any other Host header, or with two Host headers.
- `/api/home-results` adds no duplicates when the same rows are sent twice.
- The summary, the samples query and the session CSV return what was stored.
- Static files:
  - `/` gives the app, and the `/gyro/` pages are served.
  - `/motion/` gives 404 until its folder exists, and never a listing.
  - Traversal and private paths are refused.
  - The MIME types are right, and `/favicon.ico` gives 204.
- `/events` delivers a batch after an ingest. `/api/events` says hello, announces each walk and pings.
- A session splits after a 20 s gap, using injected times, and carries on after a restart. The same
  split is checked over HTTP, with a short gap.
- HTTPS serves the phone pages from the same database, and survives a client that rejects the certificate.
- The start-up text lists every address.
- `run.py` prints the addresses, stores data and stops cleanly on Ctrl+Break. On Windows, the test sends
  Ctrl+Break in place of Ctrl+C.
- A port already in use is refused, not shared. Windows would otherwise let a second server bind next to
  `serve.py`.
- The simulator stores every simulated device and its walk.
- `/api/db/summary` reports each Sensor Logger push, sensor by sensor (stored, unreadable, helper, ignored).
  It keeps no ids, and it caps names from the network at 20, each at most 40 characters. The console prints a
  line when the set of sensors changes, and for every connection test.

gyro-starter's own tests must still pass. This server loads `gyro-starter/server.py` and does not change it:

```bash
python -m unittest discover -s gyro-starter/tests -v
```

## What has and has not been checked

- **Checked on this laptop, 8 Nov 2026, about 02:55:**
  - the 33 tests above, and gyro-starter's 10;
  - `python run.py --port 8790 --https-port 8490`, started with the default database:
    - the app and both phone pages answered over HTTP and HTTPS, on localhost and on the laptop's LAN
      address;
    - the 10-second simulator run stored 250 AirPods, 500 Watch and 600 phone samples, and one walk with
      816 samples;
    - `/api/db/summary` showed rates of 25, 50 and 60 Hz;
    - Ctrl+Break stopped it cleanly, with exit code 0, leaving one 608 KB `rfn.sqlite`.

  That run's simulated rows are still in `data/rfn.sqlite`, labelled simulated.
- **Checked again, about 03:45 to 04:00**, on the preview server (`python run.py`, ports 8765 and 8443):
  - 49 tests, and gyro-starter's 10.
  - The Devices view showed the simulated devices Live at 25, 60 and 50 Hz, with counts rising.
  - One session's CSV gave 1,500 rows for 25 s at 60 Hz.
  - A simulated phone stream and walk sent over HTTPS 8443 were stored.
  - The Sensor Logger line showed a test push, old-version AirPods readings and a simulated stream correctly.
  - Windows Firewall allows `C:\Python313\python.exe` in on Public networks; the current Wi-Fi is Public.
- **Not checked:** no phone, AirPods or Watch has been used yet. Still untested:
  - reaching the laptop from another device (the Windows firewall, Wi-Fi isolation);
  - accepting the certificate on an iPhone;
  - Sensor Logger's real pushes and real sensor rates.
- **Known gaps:**
  - Fixed at 03:11: `motion/web/walk.js` now reads the HTTPS port from `/api/info`, so its "Open the secure
    address" link follows this server's port 8443.
  - The Devices view has a button that saves this browser's home-test rows to `/api/home-results`. Nothing sends
    them on its own.
  - `/api/db/export.zip` is not built: the spec says to skip it.
