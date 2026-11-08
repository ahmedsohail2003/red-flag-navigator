# One server for the whole app: contract (v1, 8 Nov 2026, 02:40)

Goal: `python run.py` starts ONE server that serves the app and every phone page from one origin,
accepts every device protocol unchanged, and logs everything to a local SQLite database, so you can
SEE AirPods, Apple Watch and phone data arriving and being stored.

Standard library only, plus `cryptography` (installed) for the self-signed HTTPS certificate.
Python 3.13 (`python`). Windows 11. Never modify `app/`, `motion/`, `gyro-starter/`, `docs/`; this
folder (`server/`) and `run.py` at the project root are the only places to write, plus `data/` at runtime.

## Reuse, do not re-implement

Load `gyro-starter/server.py` as a module by path (`importlib.util.spec_from_file_location`, because the
folder name has a hyphen) and reuse: `from_sensor_logger`, `Hub`, `FIELDS`, `ensure_cert`, `lan_ips`,
`QuietServer`, `MIME`. Its own tests live in `gyro-starter/tests/test_server.py`; do not break them (do not
edit that folder at all). If an import fails, stop and report; do not copy the code.

Subclass `Hub` as `DbHub`: after the parent's `ingest()` (which updates stats, writes the CSV recording when
on, and publishes to `/events`), also write the batch to the database. Use the parent's return value.

## Ports and URLs

- HTTP `--port` (default 8765): the laptop. `http://localhost:8765/` is the app.
- HTTPS `--https-port` (default 8443, `--no-https` to disable): phones, with one self-signed certificate for
  localhost and every LAN IP (reuse `ensure_cert`; certificates in `server/.certs/`, never served).
- `--host` default `0.0.0.0`; `--db` default `data/rfn.sqlite` (create `data/` if missing).
- On start, print plainly:
  - App (laptop): `http://localhost:<port>/`
  - Phone motion stream: `https://<lan-ip>:<https-port>/gyro/phone.html` (one line per LAN IP)
  - Phone walk test: `https://<lan-ip>:<https-port>/motion/walk.html`
  - Sensor Logger HTTP push URL (AirPods, Watch, phone): `http://<lan-ip>:<port>/sensorlogger`
  - Database file path, and a one-line Windows firewall hint.

## Static files (same origin for everything, so browser storage is shared)

- `/` and every other path not listed below: `app/<path>` (`/` gives `app/index.html`).
- `/gyro/<path>`: `gyro-starter/static/<path>` (`/gyro/` gives its `index.html`).
- `/motion/<path>`: `motion/web/<path>`. The folder may not exist yet (another session is building it);
  return 404 until it does.
- Never serve `data/`, any `.certs/`, `server/`, `motion/data/`, or anything outside those three roots.
  Reject `..`, encoded traversal (`%2e%2e`, `%5c`) and absolute paths. No directory listings.
- MIME types: reuse `MIME`, and add `.mjs` and `.webmanifest` and `.woff2`. `Cache-Control: no-store` on
  every reply. `/favicon.ico` replies 204.

## Device protocols (unchanged from their owners' contracts)

Gyro starter (`gyro-starter/README.md`), at the root AND under `/gyro/` (its phone page uses relative URLs,
so from `/gyro/phone.html` it posts to `/gyro/ingest`):
- `POST /ingest` (and `/gyro/ingest`): `{source, samples:[{t,gx,gy,gz,ax,ay,az,lx,ly,lz,oa,ob,og}], events:[...]}` -> 204.
- `POST /sensorlogger`, `/data`, `/gyro/sensorlogger`: Sensor Logger push -> `from_sensor_logger` -> one
  ingest per device (`airpods`, `watch`, `phone (Sensor Logger)`) -> 200 `{"ok": true, "samples": n}`.
  A push with no `payload` list is a connection test: 200 with 0 samples.
- `GET /events` (and `/gyro/events`): the Hub's Server-Sent Events. `GET /stats` (and `/gyro/stats`).
- `POST /record` (and `/gyro/record`): `{on: true|false}`, as the Hub does (CSV in `data/recordings/`
  instead of the gyro folder: pass `recordings_dir`).

Motion walk test (`motion/CONTRACT.md` section 5), implemented here against the database:
- `POST /api/walks` (max 3 MB): body `{v:1, kind:"rfn-walk", id, createdAt, distance_m, placement, device,
  result: WalkResult, recording?: Recording (at most 20000 samples)}`. Validate: `id` matches
  `^[A-Za-z0-9_-]{6,64}$`, `kind` exact, `distance_m` 1 to 100, `result` an object. Store in `walks`
  (and the recording's samples into `samples` under a session of kind `walk`, device `phone-walk`).
  201 `{"ok": true, "id"}`; 200 `{"ok": true, "duplicate": true}` for a known id; 400 plain-words error;
  413 too large.
- `GET /api/walks`: `{"walks": [summary...]}` newest first (record without `recording`, plus `hasRecording`).
- `GET /api/walks/<id>`: full record or 404.
- `GET /api/events`: SSE; `event: hello` `{"walks": n}` on connect; `event: walk` with a summary per new walk;
  `: ping` every 15 s.
- `GET /api/info`: `{"phoneUrls": [...walk test URLs], "gyroPhoneUrls": [...], "sensorLoggerUrls": [...],
  "laptopUrl", "httpPort", "httpsPort" or null, "db": "<path>"}`.
- `DELETE /api/walks`: loopback only, else 403; marks walks deleted (keep rows, set `deleted_at`), replies
  `{"ok": true, "cleared": n}`.
- All `GET /api/*` replies send `Access-Control-Allow-Origin: *`.

## Database (SQLite now; schema written to map onto Postgres / TimescaleDB later)

One file `data/rfn.sqlite`, WAL mode, one writer thread or a lock; batched `executemany` inserts.

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

- Device kind from the source name: contains `airpods` -> `airpods`; `watch` -> `watch`; `phone` -> `phone`;
  else `other`. `simulated` = 1 when the source name contains `simulated`.
- A stream session per device starts at its first sample and ends after 20 s without samples (the next
  sample starts a new session). Session ids: `s-YYYYMMDD-HHMMSS-<device-slug>-<4 random>`.
- `home_results`: `POST /api/home-results` with `{rows: [...]}` from the browser's `rfn.homeResults` (and the
  home kit's results). Upsert by a stable id (`row.id` or a hash of date+time+test+value+person+trial).
  Reply `{"ok": true, "stored": n, "total": m}`.

Read API for the app's "Devices and data" screen:
- `GET /api/health`: `{"ok": true, "server": "rfn-one-server", "version": 1, "db": true, "https": bool,
  "httpsPort", "time"}`. The app uses this to know it is running against the real server.
- `GET /api/db/summary`: table row counts, database file size, devices (with live rate: samples in the last
  5 s divided by 5, and seconds since last), the 20 newest sessions, newest walk, home_results count.
- `GET /api/db/samples?device=<id>&limit=<n<=2000>&since=<received_at>`: newest samples, oldest first.
- `GET /api/db/sessions/<id>.csv`: that session's samples as CSV (header row; `Content-Disposition:
  attachment`).
- `GET /api/db/export.zip` is NOT needed; skip it.

## Simulator (`server/simulate.py`)

`python server/simulate.py [--url http://localhost:8765] [--seconds 20] [--devices airpods,watch,phone]
[--walk]` pushes realistic, clearly SIMULATED data through the real endpoints:
- AirPods and Watch as Sensor Logger pushes to `/sensorlogger` (`payload` readings named `headphone` and
  `wrist motion` with `rotationRateX/Y/Z` in rad/s, `gravityX/Y/Z` in g, `time` in epoch ns), one push per
  0.25 s, about 25 Hz (AirPods) and 50 Hz (Watch). Head turns and walking arm-swing shapes, seeded random.
- Phone as `/ingest` batches, about 60 Hz, `source: "phone (simulated)"`.
- Source names MUST end in `(simulated)` (for Sensor Logger pushes, the server derives `airpods`/`watch`; so
  the simulator sends its pushes to `/sensorlogger?simulated=1` and the server appends ` (simulated)` to the
  device names when that query flag is set). Real data never carries the flag.
- `--walk` POSTs one synthetic walk (`simulated: true` in the result) to `/api/walks`.
- Prints a running count and, at the end, the database totals read back from `/api/db/summary`.

## Tests (`server/tests/test_server.py`, unittest, stdlib only)

Start the server in a thread on free ports with a temp DB and temp recordings dir. Cover at least:
1. `/ingest` and `/gyro/ingest` store rows; the device and a session appear; counts match.
2. A Sensor Logger AirPods push (`headphone`, rad/s, gravity in g, ns times) stores deg/s and m/s² values and
   ms times under device `airpods`; a Watch push under `watch`; `?simulated=1` gives `airpods (simulated)`.
3. A Sensor Logger connection test (no payload) replies 200 with 0 samples.
4. Walk POST: 201, duplicate 200, bad id 400, too large 413; GET list and by id; DELETE from loopback.
5. `/api/home-results` upserts without duplicates on a second identical POST.
6. `/api/db/summary`, `/api/db/samples` and the session CSV return what was stored.
7. Static: `/` gives the app index, `/gyro/phone.html` and `/motion/` behave as specified, traversal
   (`/../server/SPEC.md`, `/%2e%2e/data/rfn.sqlite`, `/data/rfn.sqlite`, `/server/SPEC.md`) is refused.
8. SSE `/events` delivers a batch after an ingest.
9. A session splits after a 20 s gap (inject times or make the gap configurable for the test).
Also run `python -m unittest discover -s gyro-starter/tests -v` and confirm it still passes untouched.
