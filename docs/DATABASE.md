# Database

## What is stored, and where

Everything the server receives goes into one SQLite file, `data/rfn.sqlite` (plus `-wal` and `-shm` files while it runs). `data/` is never committed. Tables (`server/db.py`):

- `devices`: kind, first and last seen, sample count, simulated or not.
- `sessions`: one device's stretch of data (`stream`, `walk` or `import`).
- `samples`: one row per motion sample (AirPods, Apple Watch, phone; 25 to 60 a second).
- `events`: button presses.
- `walks`: phone walk tests. A walk's recording goes into `samples`.
- `home_results`: weekly home-test results from the browser.

## Look inside

Row counts (read-only, safe while the server runs), from the project folder:

```powershell
python -c "import sqlite3; c = sqlite3.connect('file:data/rfn.sqlite?mode=ro', uri=True); print({t: c.execute(f'SELECT COUNT(*) FROM {t}').fetchone()[0] for t in ('devices', 'sessions', 'samples', 'events', 'walks', 'home_results')})"
```

Or open the app's **Devices and data** screen, http://localhost:8765/#devices.

## Reset

Never delete the file without asking. Stop the server (Ctrl+C), then move all three files aside together:

```powershell
$old = "data\old-$(Get-Date -Format yyyyMMdd-HHmm)"; New-Item -ItemType Directory $old | Out-Null; Move-Item data\rfn.sqlite* $old
```

The server then starts a new, empty file.

## Optional: Tiger Data (cloud PostgreSQL + TimescaleDB), a 45-minute morning switch

The app never needs this; the server keeps writing to SQLite either way. `server/migrate.py` copies the file into the cloud. In `server/schema_pg.sql`, `samples` is a hypertable on `received_ms` (receive time in ms), in one-day chunks.

Rules:

- Only synthetic or simulated data goes to the cloud, never real patient data. `migrate.py` copies the whole file, so check it with `--dry-run` first. Simulated devices have "(simulated)" in their names. If unsure, reset and fill it with `python server/simulate.py --walk`.
- Credentials are never committed. Keep the config outside the project folder. `migrate.py` prints only the host.
- If it doesn't work by 10:30, keep SQLite.

Steps (a person does 1 to 4):

1. Sign up through https://www.mlh.com/partners/tigerdata for the free credits.
2. In the Tiger Console, create a service.
3. Click **Download the config** and save it in Downloads. It holds the password.
4. In PowerShell, in the project folder: `$env:DATABASE_URL = '<postgres://... from the config>'`. The single quotes keep a `$` in the password as it is.
5. `python -m pip install "psycopg[binary]"`
6. `python server/migrate.py --dry-run` shows the host, rows per table and the first statement, and sends nothing.
7. `python server/migrate.py` creates the tables and hypertable, copies everything, and prints rows sent and time taken.
8. While the demo runs, in a second window, repeat step 4, then run `python server/migrate.py --follow`: it copies new rows every 5 s until Ctrl+C.
9. In the Console's SQL editor, run the `time_bucket` queries at the end of `server/schema_pg.sql`: samples per device per second, and mean turning speed per minute. Write down the row count and the query times.

## Devpost: "[MLH] Best Use of Tiger Data"

Only if steps 1 to 9 above worked: tick that prize and add Tiger Data under Built With, and say the mirrored samples are simulated (devices named "(simulated)"). Describe the hypertable, the `time_bucket` query, row counts and query times, for example:

> Motion samples (AirPods, Apple Watch, phone, 25 to 60 Hz) are mirrored live into a Tiger Data hypertable partitioned on receive time. A `time_bucket` query gives samples per device per second and mean turning speed per minute: N rows in X ms.

N and X come from step 9.

## Honest status

The cloud path is untested: nobody has created a Tiger service yet. The tests run `migrate.py` against a fake connection that records the SQL, so none of it has run on a real server. If the modern hypertable statement is refused, `migrate.py` falls back to the classic `create_hypertable`.
