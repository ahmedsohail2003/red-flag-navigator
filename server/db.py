"""SQLite storage for the one server (server/SPEC.md, "Database").

Everything that arrives is written to one file (default data/rfn.sqlite):

    devices       one row per device name: kind, first and last seen, sample count, simulated or not
    sessions      a stretch of one device's data: 'stream' (ends after 20 s without samples), 'walk', 'import'
    samples       one row per motion sample: device time in ms, turning speed in deg/s, acceleration in m/s^2
    events        button presses and other events that came with /ingest batches
    walks         phone walk tests (POST /api/walks); a walk's raw recording goes into samples
    home_results  weekly home-test rows copied from the browser (POST /api/home-results)

Writes go through one connection behind a lock: one transaction per incoming batch, with executemany inserts.
The file is in WAL mode, so every read opens its own short-lived connection and never waits for (or holds up)
the phones' writes. Column types are plain TEXT, REAL and INTEGER, so the schema maps onto Postgres or
TimescaleDB later (server/README.md, "Moving to Postgres").

Standard library only.
"""
from __future__ import annotations

import contextlib
import csv
import datetime as dt
import hashlib
import io
import json
import math
import os
import re
import secrets
import sqlite3
import threading
import time
from urllib.parse import quote

SCHEMA_VERSION = 1
SESSION_GAP_S = 20.0        # a stream session ends after this many seconds without samples
LIVE_WINDOW_S = 5.0         # live rate = samples stored in the last 5 s, divided by 5
MAX_SAMPLE_ROWS = 2000      # the most rows GET /api/db/samples returns
CSV_CHUNK_ROWS = 5000       # rows per chunk when a session is exported as CSV
WALK_DEVICE = "phone-walk"  # device name of walk recordings (simulated ones get " (simulated)" added)

TABLES = ("devices", "sessions", "samples", "events", "walks", "home_results")
SAMPLE_FIELDS = ("gx", "gy", "gz", "ax", "ay", "az", "lx", "ly", "lz")  # gyro-starter protocol names
SAMPLE_COLUMNS = ("session_id", "device_id", "t_ms", "received_at") + SAMPLE_FIELDS
WALK_SAMPLE_KEYS = ("t", "ax", "ay", "az", "gx", "gy", "gz", "lx", "ly", "lz")  # motion/CONTRACT.md section 1
WALK_COLUMNS = ("id", "created_at", "received_at", "distance_m", "placement", "speed_mps", "quality",
                "simulated", "result", "device", "has_recording", "deleted_at")
SESSION_COLUMNS = ("id", "device_id", "kind", "started_at", "ended_at", "samples", "label", "meta")

SCHEMA = """
CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY, kind TEXT, first_seen REAL, last_seen REAL, samples INTEGER, simulated INTEGER);
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY, device_id TEXT, kind TEXT, started_at REAL, ended_at REAL, samples INTEGER,
    label TEXT, meta TEXT);
CREATE TABLE IF NOT EXISTS samples (
    session_id TEXT, device_id TEXT, t_ms REAL, received_at REAL,
    gx REAL, gy REAL, gz REAL, ax REAL, ay REAL, az REAL, lx REAL, ly REAL, lz REAL);
CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY, device_id TEXT, received_at REAL, type TEXT, payload TEXT);
CREATE TABLE IF NOT EXISTS walks (
    id TEXT PRIMARY KEY, created_at TEXT, received_at REAL, distance_m REAL, placement TEXT,
    speed_mps REAL, quality TEXT, simulated INTEGER, result TEXT, device TEXT, has_recording INTEGER,
    deleted_at REAL);
CREATE TABLE IF NOT EXISTS home_results (
    id TEXT PRIMARY KEY, received_at REAL, date TEXT, test TEXT, value REAL, person TEXT,
    source TEXT, simulated INTEGER, payload TEXT);
CREATE INDEX IF NOT EXISTS samples_by_device ON samples (device_id, received_at);
CREATE INDEX IF NOT EXISTS samples_by_session ON samples (session_id);
CREATE INDEX IF NOT EXISTS sessions_by_device ON sessions (device_id, ended_at);
CREATE INDEX IF NOT EXISTS sessions_by_start ON sessions (started_at);
CREATE INDEX IF NOT EXISTS events_by_device ON events (device_id, received_at);
CREATE INDEX IF NOT EXISTS walks_by_received ON walks (received_at);
"""

_INSERT_SAMPLE = ("INSERT INTO samples (session_id, device_id, t_ms, received_at, gx, gy, gz, ax, ay, az, lx, ly, lz)"
                  " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
_INSERT_EVENT = "INSERT INTO events (device_id, received_at, type, payload) VALUES (?, ?, ?, ?)"
_INSERT_SESSION = ("INSERT INTO sessions (id, device_id, kind, started_at, ended_at, samples, label, meta)"
                   " VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
_INSERT_WALK = f"INSERT INTO walks ({', '.join(WALK_COLUMNS)}) VALUES ({', '.join('?' * len(WALK_COLUMNS))})"
_UPSERT_DEVICE = """
INSERT INTO devices (id, kind, first_seen, last_seen, samples, simulated) VALUES (?, ?, ?, ?, ?, ?)
ON CONFLICT (id) DO UPDATE SET first_seen = MIN(first_seen, excluded.first_seen),
                               last_seen = MAX(last_seen, excluded.last_seen),
                               samples = samples + excluded.samples
"""
_UPSERT_HOME = """
INSERT INTO home_results (id, received_at, date, test, value, person, source, simulated, payload)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (id) DO UPDATE SET date = excluded.date, test = excluded.test, value = excluded.value,
                               person = excluded.person, source = excluded.source,
                               simulated = excluded.simulated, payload = excluded.payload
"""


class DatabaseClosed(RuntimeError):
    """A write arrived after close(): the server is stopping."""


# ------------------------------------------------------------------------------------------------ helpers

def device_kind(name: str) -> str:
    """'airpods', 'watch', 'phone' or 'other', from the device (source) name."""
    n = (name or "").lower()
    if "airpods" in n:
        return "airpods"
    if "watch" in n:
        return "watch"
    if "phone" in n:
        return "phone"
    return "other"


def is_simulated(name: str) -> bool:
    return "simulated" in (name or "").lower()


def device_slug(name: str) -> str:
    """'airpods (simulated)' -> 'airpods-simulated', for session ids."""
    slug = re.sub(r"[^a-z0-9]+", "-", (name or "").lower()).strip("-")
    return slug[:32].strip("-") or "device"


def iso_utc(ts: float | None) -> str | None:
    """Epoch seconds -> '2026-11-08T07:12:03.120Z', like JavaScript's toISOString()."""
    if ts is None:
        return None
    return dt.datetime.fromtimestamp(ts, dt.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _num(value) -> float | None:
    """A finite number, or None (NULL). Booleans, strings, NaN and infinities are not numbers here."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    try:
        f = float(value)
    except OverflowError:
        return None
    return f if math.isfinite(f) else None


def _text(value, limit: int = 200) -> str | None:
    return value[:limit] if isinstance(value, str) else None


def _dumps(obj) -> str:
    return json.dumps(obj, separators=(",", ":"))


def _loads(text):
    if text is None:
        return None
    try:
        return json.loads(text)
    except ValueError:
        return None


def home_result_id(row: dict) -> str:
    """The row's own id, or a stable hash of what makes a home-test result unique.

    The hash covers date, time, test, value, person and trial (server/SPEC.md), plus the calibration flag,
    because a calibration trial and a weekly result can share the other five fields.
    """
    rid = row.get("id")
    if isinstance(rid, str) and rid.strip():
        return rid.strip()[:128]
    key = [row.get("date"), row.get("time"), row.get("test"), row.get("value"), row.get("person") or "",
           row.get("trial"), bool(row.get("calibration"))]
    digest = hashlib.sha256(json.dumps(key, separators=(",", ":"), default=str).encode("utf-8")).hexdigest()
    return "h-" + digest[:24]


def _sample_values(sample: dict) -> tuple:
    """(t_ms, gx, gy, gz, ax, ay, az, lx, ly, lz) from one protocol sample; anything missing becomes NULL."""
    return (_num(sample.get("t")),) + tuple(_num(sample.get(k)) for k in SAMPLE_FIELDS)


def _csv_cell(value):
    """Numbers as they are; text cells that a spreadsheet would run as a formula get a leading quote."""
    if value is None:
        return ""
    if isinstance(value, str) and value[:1] in ("=", "+", "-", "@"):
        return "'" + value
    return value


def _session_dict(row) -> dict:
    out = dict(zip(SESSION_COLUMNS, row))
    out["meta"] = _loads(out["meta"])
    start, end = out["started_at"], out["ended_at"]
    out["seconds"] = round(end - start, 1) if start is not None and end is not None else None
    out["csv_url"] = f"/api/db/sessions/{quote(out['id'], safe='')}.csv"
    return out


def _walk_from_row(row) -> dict:
    """A walk summary (motion/CONTRACT.md section 5): the record without its recording, plus hasRecording."""
    w = dict(zip(WALK_COLUMNS, row))
    out = {"v": 1, "kind": "rfn-walk", "id": w["id"], "createdAt": w["created_at"], "distance_m": w["distance_m"],
           "placement": w["placement"], "device": _loads(w["device"]), "result": _loads(w["result"]),
           "receivedAt": iso_utc(w["received_at"])}
    if w["simulated"]:
        out["simulated"] = True
    out["hasRecording"] = bool(w["has_recording"])
    return out


def walk_session_id(walk_id: str) -> str:
    return "walk-" + walk_id


# ----------------------------------------------------------------------------------------------- database

class Database:
    """The SQLite file. Thread-safe: writes are serialised by a lock, reads use their own connections."""

    def __init__(self, path: str, session_gap_s: float = SESSION_GAP_S):
        self.path = os.path.abspath(path)
        self.session_gap_s = float(session_gap_s)
        self.samples_written = 0          # samples stored since this object was made (for the console)
        self._lock = threading.Lock()
        self._open: dict[str, tuple[str, float]] = {}  # device id -> (stream session id, last received_at)
        folder = os.path.dirname(self.path)
        if folder:
            os.makedirs(folder, exist_ok=True)
        conn = sqlite3.connect(self.path, timeout=10, isolation_level=None, check_same_thread=False)
        try:
            self.journal_mode = conn.execute("PRAGMA journal_mode = WAL").fetchone()[0]
            conn.execute("PRAGMA synchronous = NORMAL")
            conn.executescript(SCHEMA)
            if conn.execute("PRAGMA user_version").fetchone()[0] == 0:
                conn.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")
        except BaseException:
            conn.close()
            raise
        self._conn: sqlite3.Connection | None = conn

    # -- plumbing
    @contextlib.contextmanager
    def _write(self):
        """One write transaction on the shared connection, under the lock."""
        with self._lock:
            conn = self._conn
            if conn is None:
                raise DatabaseClosed("the database is closed")
            conn.execute("BEGIN IMMEDIATE")
            try:
                yield conn
                conn.execute("COMMIT")
            except BaseException:
                if conn.in_transaction:
                    try:
                        conn.execute("ROLLBACK")
                    except sqlite3.Error:
                        pass
                raise

    @contextlib.contextmanager
    def _reader(self):
        """A short-lived read-only connection: in WAL mode it reads alongside the writer without blocking it."""
        conn = sqlite3.connect(self.path, timeout=10, check_same_thread=False)
        try:
            conn.execute("PRAGMA query_only = ON")
            yield conn
        finally:
            conn.close()

    @property
    def closed(self) -> bool:
        return self._conn is None

    def close(self) -> None:
        """Commit nothing new; fold the WAL back into the main file and close (the file is then self-contained)."""
        with self._lock:
            conn, self._conn = self._conn, None
        if conn is not None:
            try:
                conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
            except sqlite3.Error:
                pass
            conn.close()

    def healthy(self) -> bool:
        if self._conn is None:
            return False
        try:
            with self._reader() as conn:
                conn.execute("SELECT COUNT(*) FROM devices").fetchone()
            return True
        except sqlite3.Error:
            return False

    def file_bytes(self) -> tuple[int, int]:
        """(main file size, write-ahead log size) in bytes."""
        def size(p):
            try:
                return os.path.getsize(p)
            except OSError:
                return 0
        return size(self.path), size(self.path + "-wal")

    # -- streams (gyro protocol batches)
    def write_batch(self, device_id: str, samples: list, events: list = (), received_at: float | None = None) -> str | None:
        """Store one batch from one device: device row, stream session, samples and events, in one transaction.

        Returns the stream session id, or None when the batch had no samples. received_at (epoch seconds)
        defaults to now; tests pass their own times to check the 20 s session gap.
        """
        now = time.time() if received_at is None else float(received_at)
        values = [_sample_values(s) for s in samples if isinstance(s, dict)]
        event_rows = [(device_id, now, _text(e.get("type"), 40), _dumps(e)) for e in events if isinstance(e, dict)]
        session_id = None
        with self._write() as conn:
            conn.execute(_UPSERT_DEVICE, (device_id, device_kind(device_id), now, now, len(values),
                                          int(is_simulated(device_id))))
            if values:
                session_id = self._stream_session(conn, device_id, now, len(values))
                conn.executemany(_INSERT_SAMPLE, [(session_id, device_id, v[0], now) + v[1:] for v in values])
            if event_rows:
                conn.executemany(_INSERT_EVENT, event_rows)
            self.samples_written += len(values)  # under the lock, so concurrent batches all count
        return session_id

    def _stream_session(self, conn, device_id: str, now: float, n: int) -> str:
        """The device's current stream session, extended by n samples, or a new one after a gap. Under the lock."""
        current = self._open.get(device_id)
        if current is None:  # first batch since start-up: a session that ended moments ago carries on
            row = conn.execute("SELECT id, ended_at FROM sessions WHERE device_id = ? AND kind = 'stream'"
                               " ORDER BY ended_at DESC LIMIT 1", (device_id,)).fetchone()
            if row is not None and row[1] is not None:
                current = (row[0], float(row[1]))
        if current is not None and now - current[1] <= self.session_gap_s:
            updated = conn.execute("UPDATE sessions SET ended_at = MAX(ended_at, ?), samples = samples + ?"
                                   " WHERE id = ?", (now, n, current[0])).rowcount
            if updated == 1:  # 0 if that session's transaction was rolled back: start a new one instead
                self._open[device_id] = (current[0], max(current[1], now))
                return current[0]
        session_id = self._new_session_id(conn, device_id, now)
        conn.execute(_INSERT_SESSION, (session_id, device_id, "stream", now, now, n, None, None))
        self._open[device_id] = (session_id, now)
        return session_id

    @staticmethod
    def _new_session_id(conn, device_id: str, at: float) -> str:
        """s-YYYYMMDD-HHMMSS-<device-slug>-<4 random hex>, local time of the first sample."""
        stamp = time.strftime("%Y%m%d-%H%M%S", time.localtime(at))
        slug = device_slug(device_id)
        for _ in range(50):
            session_id = f"s-{stamp}-{slug}-{secrets.token_hex(2)}"
            if conn.execute("SELECT 1 FROM sessions WHERE id = ?", (session_id,)).fetchone() is None:
                return session_id
        raise sqlite3.IntegrityError("could not make a unique session id")

    # -- walks (motion/CONTRACT.md section 5)
    def add_walk(self, body: dict, received_at: float | None = None) -> tuple[bool, dict | None]:
        """Store a validated walk. Returns (True, summary) when new, (False, None) for an id already stored.

        A cleared (soft-deleted) walk still counts as stored, so a phone resending it gets "duplicate" and
        stops resending. The recording's samples go into samples under session 'walk-<id>' (kind 'walk').
        """
        now = time.time() if received_at is None else float(received_at)
        walk_id = body["id"]
        result = body.get("result") if isinstance(body.get("result"), dict) else {}
        recording = body.get("recording") if isinstance(body.get("recording"), dict) else None
        simulated = any(isinstance(x, dict) and x.get("simulated") is True for x in (body, result, recording))
        device_name = WALK_DEVICE + (" (simulated)" if simulated else "")
        row = (walk_id, _text(body.get("createdAt"), 64), now, _num(body.get("distance_m")),
               _text(body.get("placement"), 40), _num(result.get("speed_mps")), _text(result.get("quality"), 20),
               int(simulated), _dumps(result), _dumps(body["device"]) if body.get("device") is not None else None,
               int(recording is not None), None)
        values = []
        if recording is not None and isinstance(recording.get("samples"), list):
            values = [_sample_values(s) for s in recording["samples"] if isinstance(s, dict)]
        try:
            with self._write() as conn:
                if conn.execute("SELECT 1 FROM walks WHERE id = ?", (walk_id,)).fetchone() is not None:
                    return False, None
                conn.execute(_INSERT_WALK, row)
                if recording is not None:
                    session_id = walk_session_id(walk_id)
                    times = [v[0] for v in values if v[0] is not None]
                    span_s = (max(times) - min(times)) / 1000 if len(times) >= 2 else 0.0
                    meta = {"walkId": walk_id, "recording": {k: v for k, v in recording.items() if k != "samples"}}
                    conn.execute(_INSERT_SESSION, (session_id, device_name, "walk", now - span_s, now, len(values),
                                                   f"walk {walk_id}", _dumps(meta)))
                    conn.execute(_UPSERT_DEVICE, (device_name, device_kind(device_name), now, now, len(values),
                                                  int(is_simulated(device_name))))
                    if values:
                        conn.executemany(_INSERT_SAMPLE, [(session_id, device_name, v[0], now) + v[1:] for v in values])
                    self.samples_written += len(values)
        except sqlite3.IntegrityError:  # stored meanwhile by another connection to the same file
            return False, None
        return True, _walk_from_row(row)

    def walk_summaries(self, limit: int = 500) -> list[dict]:
        """Walks not cleared, newest first."""
        with self._reader() as conn:
            rows = conn.execute(f"SELECT {', '.join(WALK_COLUMNS)} FROM walks WHERE deleted_at IS NULL"
                                " ORDER BY received_at DESC, rowid DESC LIMIT ?", (int(limit),)).fetchall()
        return [_walk_from_row(r) for r in rows]

    def walk(self, walk_id: str) -> dict | None:
        """The full walk record, with its recording rebuilt from sessions.meta and samples, or None."""
        with self._reader() as conn:
            row = conn.execute(f"SELECT {', '.join(WALK_COLUMNS)} FROM walks WHERE id = ? AND deleted_at IS NULL",
                               (walk_id,)).fetchone()
            if row is None:
                return None
            record = _walk_from_row(row)
            has_recording = record.pop("hasRecording")
            if has_recording:
                session_id = walk_session_id(walk_id)
                meta_row = conn.execute("SELECT meta FROM sessions WHERE id = ?", (session_id,)).fetchone()
                meta = (_loads(meta_row[0]) if meta_row else None) or {}
                recording = dict(meta.get("recording") or {})
                cols = ", ".join("t_ms" if k == "t" else k for k in WALK_SAMPLE_KEYS)
                recording["samples"] = [
                    dict(zip(WALK_SAMPLE_KEYS, r)) for r in
                    conn.execute(f"SELECT {cols} FROM samples WHERE session_id = ? ORDER BY rowid", (session_id,))]
                record["recording"] = recording
        return record

    def walk_count(self) -> int:
        with self._reader() as conn:
            return conn.execute("SELECT COUNT(*) FROM walks WHERE deleted_at IS NULL").fetchone()[0]

    def clear_walks(self, now: float | None = None) -> int:
        """Mark every walk deleted (the rows stay, with deleted_at set). Returns how many were cleared."""
        now = time.time() if now is None else float(now)
        with self._write() as conn:
            return conn.execute("UPDATE walks SET deleted_at = ? WHERE deleted_at IS NULL", (now,)).rowcount

    # -- home-test results (browser rfn.homeResults)
    def upsert_home_results(self, rows: list, received_at: float | None = None) -> dict:
        """Insert or update rows by their stable id. Returns {stored, new, total, skipped}."""
        now = time.time() if received_at is None else float(received_at)
        prepared, skipped = [], 0
        for r in rows:
            if not isinstance(r, dict):
                skipped += 1
                continue
            source = _text(r.get("source"), 40)
            simulated = r.get("simulated") is True or (source is not None and is_simulated(source))
            prepared.append((home_result_id(r), now, _text(r.get("date"), 32), _text(r.get("test"), 64),
                             _num(r.get("value")), _text(r.get("person"), 120) or "", source, int(simulated),
                             _dumps(r)))
        with self._write() as conn:
            before = conn.execute("SELECT COUNT(*) FROM home_results").fetchone()[0]
            if prepared:
                conn.executemany(_UPSERT_HOME, prepared)
            total = conn.execute("SELECT COUNT(*) FROM home_results").fetchone()[0]
        return {"stored": len(prepared), "new": total - before, "total": total, "skipped": skipped}

    # -- reads for the "Devices and data" screen
    def counts(self) -> dict[str, int]:
        with self._reader() as conn:
            return {t: conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in TABLES}

    def summary(self, now: float | None = None, newest_sessions: int = 20) -> dict:
        """Row counts, file size, devices with live rates, the newest sessions and walk (GET /api/db/summary)."""
        now = time.time() if now is None else float(now)
        with self._reader() as conn:
            counts = {t: conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in TABLES}
            devices = []
            for did, kind, first, last, n, sim in conn.execute(
                    "SELECT id, kind, first_seen, last_seen, samples, simulated FROM devices"
                    " ORDER BY last_seen DESC").fetchall():
                recent = conn.execute("SELECT COUNT(*) FROM samples WHERE device_id = ? AND received_at > ?",
                                      (did, now - LIVE_WINDOW_S)).fetchone()[0]
                devices.append({"id": did, "kind": kind, "simulated": bool(sim), "first_seen": first,
                                "last_seen": last, "samples": n, "rate_hz": round(recent / LIVE_WINDOW_S, 1),
                                "seconds_since_last": round(max(0.0, now - last), 1) if last is not None else None})
            sessions = [_session_dict(r) for r in conn.execute(
                f"SELECT {', '.join(SESSION_COLUMNS)} FROM sessions ORDER BY started_at DESC, rowid DESC LIMIT ?",
                (int(newest_sessions),)).fetchall()]
            newest = conn.execute(f"SELECT {', '.join(WALK_COLUMNS)} FROM walks WHERE deleted_at IS NULL"
                                  " ORDER BY received_at DESC, rowid DESC LIMIT 1").fetchone()
            walks_shown = conn.execute("SELECT COUNT(*) FROM walks WHERE deleted_at IS NULL").fetchone()[0]
        main_bytes, wal_bytes = self.file_bytes()
        return {
            "ok": True,
            "time": now,
            "db": {"path": self.path, "bytes": main_bytes, "wal_bytes": wal_bytes, "journal_mode": self.journal_mode},
            "counts": counts,
            "devices": devices,
            "sessions": sessions,
            "newest_walk": _walk_from_row(newest) if newest else None,
            "walks_not_cleared": walks_shown,
            "home_results": counts["home_results"],
        }

    def samples(self, device: str, limit: int = 200, since: float | None = None) -> list[dict]:
        """A device's newest samples (at most 2000), oldest first; only those received after `since` if given."""
        limit = max(1, min(int(limit), MAX_SAMPLE_ROWS))
        sql = f"SELECT {', '.join(SAMPLE_COLUMNS)} FROM samples WHERE device_id = ?"
        args: list = [device]
        if since is not None:
            sql += " AND received_at > ?"
            args.append(float(since))
        sql += " ORDER BY received_at DESC, rowid DESC LIMIT ?"
        args.append(limit)
        with self._reader() as conn:
            rows = conn.execute(sql, args).fetchall()
        rows.reverse()
        return [dict(zip(SAMPLE_COLUMNS, r)) for r in rows]

    def session(self, session_id: str) -> dict | None:
        with self._reader() as conn:
            row = conn.execute(f"SELECT {', '.join(SESSION_COLUMNS)} FROM sessions WHERE id = ?",
                               (session_id,)).fetchone()
        return _session_dict(row) if row else None

    def session_csv(self, session_id: str):
        """A generator of CSV chunks (bytes, header first) for one session's samples, or None if unknown."""
        if self.session(session_id) is None:
            return None

        def chunks():
            with self._reader() as conn:
                yield (",".join(SAMPLE_COLUMNS) + "\n").encode("utf-8")
                cur = conn.execute(f"SELECT {', '.join(SAMPLE_COLUMNS)} FROM samples WHERE session_id = ?"
                                   " ORDER BY rowid", (session_id,))
                while True:
                    rows = cur.fetchmany(CSV_CHUNK_ROWS)
                    if not rows:
                        break
                    buf = io.StringIO()
                    csv.writer(buf, lineterminator="\n").writerows([_csv_cell(v) for v in r] for r in rows)
                    yield buf.getvalue().encode("utf-8")

        return chunks()
