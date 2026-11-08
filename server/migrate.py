"""Copy the server's SQLite data into PostgreSQL / TimescaleDB (Tiger Data). Optional (docs/DATABASE.md).

    python server/migrate.py [--sqlite data/rfn.sqlite] [--dry-run] [--follow] [--batch 5000]

- The target is the DATABASE_URL environment variable. It is never printed, only its host.
- --dry-run needs neither DATABASE_URL nor psycopg: it prints how many rows a first copy would send per
  table and the first statement it would run.
- Otherwise it applies server/schema_pg.sql (safe to run again), then copies every table in batches:
    devices, sessions, walks, home_results   upsert by id; a row is rewritten only when it has changed
                                             (session and device counters grow while a device streams)
    samples, events                          only rows past a watermark, the highest SQLite rowid already
                                             copied, kept in _sync_state on the Postgres side and written
                                             in the same transaction as each batch, so no row is sent twice
- --follow repeats every 5 s, copying only what is new or changed: a live mirror while the server runs.
- SQLite is opened read-only (mode=ro), with short reads, so the server's writes are never held up.

Standard library only, plus psycopg (python -m pip install "psycopg[binary]"), imported only when needed.
"""
from __future__ import annotations

import argparse
import contextlib
import hashlib
import os
import pathlib
import re
import sqlite3
import sys
import time
from urllib.parse import unquote, urlsplit

SERVER_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SERVER_DIR)
DEFAULT_SQLITE = os.path.join(PROJECT_DIR, "data", "rfn.sqlite")
SCHEMA_FILE = os.path.join(SERVER_DIR, "schema_pg.sql")
FOLLOW_EVERY_S = 5.0
PIP_HINT = 'python -m pip install "psycopg[binary]"'

# Columns in db.py's order (server/tests/test_migrate.py checks them against db.py and schema_pg.sql).
COLUMNS = {
    "devices": ("id", "kind", "first_seen", "last_seen", "samples", "simulated"),
    "sessions": ("id", "device_id", "kind", "started_at", "ended_at", "samples", "label", "meta"),
    "samples": ("session_id", "device_id", "t_ms", "received_at",
                "gx", "gy", "gz", "ax", "ay", "az", "lx", "ly", "lz"),
    "events": ("id", "device_id", "received_at", "type", "payload"),
    "walks": ("id", "created_at", "received_at", "distance_m", "placement", "speed_mps", "quality",
              "simulated", "result", "device", "has_recording", "deleted_at"),
    "home_results": ("id", "received_at", "date", "test", "value", "person", "source", "simulated", "payload"),
}
TABLES = tuple(COLUMNS)              # copy order, as db.TABLES
APPEND_ONLY = ("samples", "events")  # rows never change once written: copied past a rowid watermark
EXTRA_COLUMNS = {"samples": ("received_ms",)}
RECEIVED_AT = COLUMNS["samples"].index("received_at")

CLASSIC_HYPERTABLE = ("SELECT create_hypertable('samples', by_range('received_ms', 86400000),"
                      " if_not_exists => TRUE, migrate_data => TRUE)")
HYPERTABLE_CHECK = ("SELECT count(*) FROM timescaledb_information.hypertables"
                    " WHERE hypertable_name = 'samples'")
STATE_GET = "SELECT last_rowid FROM _sync_state WHERE source = %s AND table_name = %s"
STATE_PUT = ("INSERT INTO _sync_state (source, table_name, last_rowid, rows_copied) VALUES (%s, %s, %s, %s)"
             " ON CONFLICT (source, table_name) DO UPDATE SET last_rowid = EXCLUDED.last_rowid,"
             " rows_copied = _sync_state.rows_copied + EXCLUDED.rows_copied, updated_at = now()")


# ------------------------------------------------------------------------------------------------ helpers

def insert_sql(table: str) -> str:
    """The INSERT for one table, with %s placeholders (psycopg)."""
    cols = COLUMNS[table] + EXTRA_COLUMNS.get(table, ())
    sql = f"INSERT INTO {table} ({', '.join(cols)}) VALUES ({', '.join(['%s'] * len(cols))})"
    if table == "samples":
        return sql  # no key: the watermark sends each row once
    if table in APPEND_ONLY:
        return sql + " ON CONFLICT (id) DO NOTHING"
    rest = [c for c in cols if c != "id"]
    return (sql + " ON CONFLICT (id) DO UPDATE SET " + ", ".join(f"{c} = EXCLUDED.{c}" for c in rest)
            + f" WHERE ({', '.join(f'{table}.{c}' for c in rest)})"
            + f" IS DISTINCT FROM ({', '.join(f'EXCLUDED.{c}' for c in rest)})")


def received_ms(received_at) -> int:
    """Receive time in whole milliseconds, the hypertable's partition column. db.py always sets received_at."""
    return int(round(received_at * 1000)) if received_at is not None else 0


def schema_statements(path: str = SCHEMA_FILE) -> list[str]:
    """The statements of schema_pg.sql, comments removed, each on one line."""
    with open(path, encoding="utf-8") as f:
        text = "\n".join(line.split("--", 1)[0] for line in f.read().splitlines())
    return [" ".join(s.split()) for s in text.split(";") if s.strip()]


def without_tsdb_options(statement: str) -> str:
    """CREATE TABLE ... WITH (tsdb.hypertable, ...) -> the same CREATE TABLE without the WITH part."""
    return re.sub(r"\s*WITH\s*\(\s*tsdb\.[^)]*\)\s*$", "", statement)


def url_host(url: str) -> str:
    """The host part of a connection string (URL or key=value form), for messages."""
    url = (url or "").strip()
    host = None
    if "://" in url:
        try:
            host = urlsplit(url).hostname
        except ValueError:
            host = None
    else:
        m = re.search(r"(?:^|\s)host\s*=\s*'?([^'\s]+)", url)
        host = m.group(1) if m else None
    return host or "(no host found in DATABASE_URL)"


def redact(text, url: str) -> str:
    """Take the connection string and its password out of a message before it is printed."""
    text = str(text)
    url = (url or "").strip()
    if not url:
        return text
    hidden = {url}
    if "://" in url:
        try:
            password = urlsplit(url).password
        except ValueError:
            password = None
        if password:
            hidden |= {password, unquote(password)}
    else:
        m = re.search(r"password\s*=\s*'?([^'\s]+)", url)
        if m:
            hidden.add(m.group(1))
    for s in sorted(hidden, key=len, reverse=True):
        if s:
            text = text.replace(s, "<hidden>" if s == url else "***")
    return text


def first_line(error: BaseException) -> str:
    lines = str(error).strip().splitlines()
    return f"{type(error).__name__}: {lines[0] if lines else ''}".rstrip(": ")


@contextlib.contextmanager
def open_sqlite(path: str):
    """A read-only connection (mode=ro): it can never write, and in WAL mode it never blocks the server."""
    uri = pathlib.Path(path).resolve().as_uri() + "?mode=ro"
    conn = sqlite3.connect(uri, uri=True, timeout=10)
    try:
        conn.execute("PRAGMA query_only = ON")
        yield conn
    finally:
        conn.close()


def source_key(src: sqlite3.Connection, table: str) -> str | None:
    """Names this SQLite file for the watermark: a hash of its first row (rows of samples and events never
    change or go away). A reset file (moved aside, new one started) gets a new key and is copied from its
    start; the same file under another name keeps its key. None while the table is empty."""
    row = src.execute(f"SELECT rowid, * FROM {table} ORDER BY rowid LIMIT 1").fetchone()
    if row is None:
        return None
    return "sqlite:" + hashlib.sha256(repr(tuple(row)).encode("utf-8")).hexdigest()[:16]


# ------------------------------------------------------------------------------------------------- copying

def apply_schema(pg, say) -> bool:
    """Run schema_pg.sql one statement at a time, then make samples a hypertable if it is not one yet.
    Returns True when samples is a hypertable."""
    def run(statement):
        with pg.cursor() as cur:
            cur.execute(statement)
        pg.commit()

    for statement in schema_statements():
        try:
            run(statement)
        except Exception as e:
            pg.rollback()
            plain = without_tsdb_options(statement)
            if plain == statement:
                raise
            say(f"  The WITH (tsdb.hypertable ...) form was refused ({first_line(e)}); using the classic call.")
            run(plain)
    problem = None
    try:
        run(CLASSIC_HYPERTABLE)  # makes samples a hypertable if it is not one yet; a no-op if it is
    except Exception as e:
        pg.rollback()
        problem = first_line(e)
    try:
        with pg.cursor() as cur:
            cur.execute(HYPERTABLE_CHECK)
            row = cur.fetchone()
        pg.commit()
        hyper = bool(row and row[0])
    except Exception as e:
        pg.rollback()
        hyper, problem = False, problem or first_line(e)
    if not hyper:
        say(f"  samples stays a plain PostgreSQL table, not a hypertable ({problem or 'TimescaleDB not found'}).")
    return hyper


class Mirror:
    """Copies one SQLite file into one Postgres connection, pass after pass (--follow)."""

    def __init__(self, sqlite_path: str, pg, batch: int = 5000):
        self.sqlite_path = sqlite_path
        self.pg = pg
        self.batch = max(1, int(batch))
        self.sent: dict[str, dict] = {t: {} for t in TABLES if t not in APPEND_ONLY}  # id -> row last sent
        self.marks: dict[tuple, int] = {}  # (source, table) -> last rowid copied, as committed in _sync_state

    def forget(self) -> None:
        """After a lost connection: re-read the watermarks from _sync_state (the committed truth)."""
        self.marks.clear()

    def copy_once(self) -> dict[str, int]:
        """One pass over every table. Returns rows sent per table."""
        counts = {}
        with open_sqlite(self.sqlite_path) as src:
            for table in TABLES:
                if table in APPEND_ONLY:
                    counts[table] = self._copy_appended(src, table)
                else:
                    counts[table] = self._copy_keyed(src, table)
        return counts

    def _copy_keyed(self, src, table: str) -> int:
        rows = src.execute(f"SELECT {', '.join(COLUMNS[table])} FROM {table} ORDER BY rowid").fetchall()
        sent = self.sent[table]
        changed = [r for r in rows if sent.get(r[0]) != r]
        sql = insert_sql(table)
        for i in range(0, len(changed), self.batch):
            chunk = changed[i:i + self.batch]
            with self.pg.cursor() as cur:
                cur.executemany(sql, chunk)
            self.pg.commit()
            sent.update((r[0], r) for r in chunk)
        return len(changed)

    def _watermark(self, source: str, table: str) -> int:
        if (source, table) not in self.marks:
            with self.pg.cursor() as cur:
                cur.execute(STATE_GET, (source, table))
                row = cur.fetchone()
            self.pg.commit()
            self.marks[(source, table)] = int(row[0]) if row else 0
        return self.marks[(source, table)]

    def _copy_appended(self, src, table: str) -> int:
        source = source_key(src, table)
        if source is None:
            return 0
        last = self._watermark(source, table)
        sql = insert_sql(table)
        select = (f"SELECT rowid, {', '.join(COLUMNS[table])} FROM {table}"
                  " WHERE rowid > ? ORDER BY rowid LIMIT ?")
        copied = 0
        while True:
            rows = src.execute(select, (last, self.batch)).fetchall()  # one short read per batch
            if not rows:
                break
            if table == "samples":
                values = [r[1:] + (received_ms(r[1 + RECEIVED_AT]),) for r in rows]
            else:
                values = [r[1:] for r in rows]
            with self.pg.cursor() as cur:  # the rows and the new watermark commit together
                cur.executemany(sql, values)
                cur.execute(STATE_PUT, (source, table, rows[-1][0], len(rows)))
            self.pg.commit()
            last = self.marks[(source, table)] = rows[-1][0]
            copied += len(rows)
            if len(rows) < self.batch:
                break
        return copied


# -------------------------------------------------------------------------------------------------- command

def parse_args(argv):
    p = argparse.ArgumentParser(description="Copy data/rfn.sqlite into PostgreSQL / TimescaleDB (DATABASE_URL).")
    p.add_argument("--sqlite", default=DEFAULT_SQLITE, help="SQLite file to read (default data/rfn.sqlite)")
    p.add_argument("--dry-run", action="store_true", help="count rows and show the first statement; send nothing")
    p.add_argument("--follow", action="store_true", help="keep copying new rows every 5 s (Ctrl+C to stop)")
    p.add_argument("--batch", type=int, default=5000, help="rows per insert batch (default 5000)")
    args = p.parse_args(argv)
    if args.batch < 1:
        p.error("--batch must be at least 1")
    return args


def _table_lines(counts: dict) -> list[str]:
    lines = [f"  {t:<14}{counts[t]:>12,}" for t in TABLES]
    return lines + [f"  {'total':<14}{sum(counts.values()):>12,}"]


def dry_run(path: str, url: str, say) -> int:
    with open_sqlite(path) as src:
        counts = {t: src.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in TABLES}
    statements = schema_statements()
    say(f"Target: {('host ' + url_host(url)) if url else 'DATABASE_URL is not set'} (dry run: nothing is sent)")
    say("Rows a first copy would send:")
    for line in _table_lines(counts):
        say(line)
    say(f"First of {len(statements)} statements in server/schema_pg.sql:")
    say("  " + statements[0])
    return 0


def main(argv=None, environ=None, connect=None, out=None, sleep=time.sleep) -> int:
    """connect(url) -> a psycopg-like connection; tests pass a fake one. out(line) prints a line."""
    args = parse_args(argv)
    env = os.environ if environ is None else environ
    url = (env.get("DATABASE_URL") or "").strip()
    write = out or (lambda line: print(line, flush=True))

    def say(line):
        write(redact(line, url))

    path = os.path.abspath(args.sqlite)
    if not os.path.isfile(path):
        say(f"No SQLite file at {path}. Start the server once (it makes the file), or pass --sqlite.")
        return 2
    say(f"SQLite: {path} (read-only)")
    try:
        if args.dry_run:
            return dry_run(path, url, say)
    except sqlite3.Error as e:
        say(f"Could not read {path}: {first_line(e)}")
        return 2

    if connect is None:
        try:
            import psycopg  # lazily: --dry-run and the server itself never need it
        except ImportError:
            say(f"psycopg is not installed. Run:  {PIP_HINT}")
            say("(--dry-run works without it.)")
            return 2

        def connect(u):
            return psycopg.connect(u, connect_timeout=15, application_name="rfn-migrate")
    if not url:
        say("DATABASE_URL is not set. In PowerShell:  $env:DATABASE_URL = '<postgres://... from the Tiger config>'")
        return 2

    host = url_host(url)
    say(f"Connecting to {host} ...")
    try:
        pg = connect(url)
    except Exception as e:
        say(f"Could not connect to {host}: {first_line(e)}")
        return 1
    mirror = Mirror(path, pg, args.batch)
    try:
        t0 = time.monotonic()
        hyper = apply_schema(pg, say)
        say(f"Schema applied ({'samples is a hypertable on received_ms' if hyper else 'no hypertable'}).")
        counts = mirror.copy_once()
        say(f"Copied in {time.monotonic() - t0:.1f} s (rows sent):")
        for line in _table_lines(counts):
            say(line)
        if not args.follow:
            return 0
        say(f"Following {path} every {FOLLOW_EVERY_S:g} s. Ctrl+C to stop.")
        while True:
            sleep(FOLLOW_EVERY_S)
            stamp = time.strftime("%H:%M:%S")
            try:
                if mirror.pg is None:
                    mirror.pg = pg = connect(url)
                    mirror.forget()
                    say(f"{stamp}  reconnected to {host}")
                counts = mirror.copy_once()
            except sqlite3.Error as e:
                say(f"{stamp}  could not read SQLite ({first_line(e)}); trying again")
                continue
            except Exception as e:  # network or server trouble: drop the connection, reconnect next pass
                say(f"{stamp}  Postgres error ({first_line(e)}); reconnecting")
                with contextlib.suppress(Exception):
                    pg.close()
                mirror.pg = None
                continue
            if any(counts.values()):
                say(f"{stamp}  " + "  ".join(f"{t} +{n:,}" for t, n in counts.items() if n))
    except KeyboardInterrupt:
        say("Stopped.")
        return 0
    except Exception as e:
        say(f"Failed: {first_line(e)}")
        return 1
    finally:
        if mirror.pg is not None:
            with contextlib.suppress(Exception):
                mirror.pg.close()


if __name__ == "__main__":
    sys.exit(main())
