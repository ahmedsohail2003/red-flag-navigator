"""Tests for server/migrate.py (docs/DATABASE.md). Standard library only; no PostgreSQL or psycopg needed.

    python -m unittest discover -s server/tests -p "test_migrate.py" -v

A temporary SQLite file is filled through db.py's own writer (streams, events, a walk with its recording,
home-test results). The migration then runs against FakePg, a psycopg-like connection that records every
statement and its parameters, and keeps just enough state (rows by table, the _sync_state watermarks) to
check what a second run sends. Nothing here proves the SQL runs on a real Tiger Data service.
"""
import contextlib
import importlib.util
import os
import re
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
SERVER_DIR = os.path.dirname(HERE)
PROJECT_DIR = os.path.dirname(SERVER_DIR)


def _load(name, path):
    if name in sys.modules:
        return sys.modules[name]
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


db = _load("rfn_db_for_migrate", os.path.join(SERVER_DIR, "db.py"))
migrate = _load("rfn_migrate", os.path.join(SERVER_DIR, "migrate.py"))

PASSWORD = "S3cret-Pa55w0rd"
HOST = "abc123xyz.tsdb.cloud.timescale.com"
URL = f"postgres://tsdbadmin:{PASSWORD}@{HOST}:34567/tsdb?sslmode=require"
T0 = 1762585920.0  # 2025-11-08, epoch seconds
INSERT_RE = re.compile(r"^INSERT INTO (\w+) \(([^)]*)\) VALUES")


class FakePg:
    """Stands in for a psycopg connection: cursor(), commit(), rollback(), close(); %s placeholders."""

    def __init__(self, refuse=(), timescale=True):
        self.log = []          # (sql, params) for execute, (sql, [params, ...]) for executemany
        self.rows = {}         # table -> {id: row dict} (keyed tables) or [row dict, ...] (samples)
        self.state = {}        # (source, table_name) -> last_rowid
        self.commits = 0
        self.closed = False
        self.refuse = refuse   # statement substrings that fail, like an older server
        self.timescale = timescale

    def cursor(self):
        return FakeCursor(self)

    def commit(self):
        self.commits += 1

    def rollback(self):
        self.log.append(("ROLLBACK", None))

    def close(self):
        self.closed = True

    def sql(self, start):
        return [(s, p) for s, p in self.log if s.startswith(start)]


class FakeCursor:
    def __init__(self, pg):
        self.pg, self.result = pg, []

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def fetchone(self):
        return self.result[0] if self.result else None

    def execute(self, sql, params=None):
        self.pg.log.append((sql, params))
        self.result = []
        if any(bad in sql for bad in self.pg.refuse):
            raise RuntimeError("syntax error (refused by FakePg)")
        if sql.startswith("SELECT last_rowid FROM _sync_state"):
            last = self.pg.state.get(tuple(params))
            self.result = [(last,)] if last is not None else []
        elif sql.startswith("INSERT INTO _sync_state"):
            source, table, last_rowid, _n = params
            self.pg.state[(source, table)] = last_rowid
        elif "timescaledb_information.hypertables" in sql:
            if not self.pg.timescale:
                raise RuntimeError('relation "timescaledb_information.hypertables" does not exist')
            self.result = [(1,)]
        elif "create_hypertable" in sql and not self.pg.timescale:
            raise RuntimeError("function create_hypertable does not exist")

    def executemany(self, sql, seq):
        seq = [tuple(p) for p in seq]
        self.pg.log.append((sql, seq))
        table, cols = INSERT_RE.match(sql).group(1), [c.strip() for c in INSERT_RE.match(sql).group(2).split(",")]
        for params in seq:
            assert len(params) == len(cols) == sql.count("%s"), (table, params)
            row = dict(zip(cols, params))
            if "ON CONFLICT" not in sql:
                self.pg.rows.setdefault(table, []).append(row)
            else:
                store = self.pg.rows.setdefault(table, {})
                if row["id"] not in store or "DO UPDATE" in sql:
                    store[row["id"]] = row


def sample(i):
    return {"t": 1000.0 + 20 * i, "gx": 3.0 + i, "gy": -1.5, "gz": 0.25, "ax": 0.1, "ay": 9.8, "az": 0.2,
            "lx": 0.01, "ly": -0.02, "lz": 0.03}


def walk_body(walk_id):
    recording = {"v": 1, "kind": "rfn-walk-recording", "id": walk_id, "createdAt": "2026-11-08T12:12:03.120Z",
                 "device": {"ua": "test"}, "distance_m": 10, "placement": "waist", "simulated": True,
                 "samples": [dict(sample(i), t=500.0 + 16.5 * i) for i in range(3)]}
    return {"v": 1, "kind": "rfn-walk", "id": walk_id, "createdAt": "2026-11-08T12:12:03.120Z", "distance_m": 10,
            "placement": "waist", "device": {"ua": "test"},
            "result": {"ok": True, "speed_mps": 1.24, "quality": "good", "simulated": True}, "recording": recording}


class MigrateTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = os.path.join(self.tmp.name, "rfn.sqlite")
        self.db = db.Database(self.path)
        self.db.write_batch("airpods (simulated)", [sample(i) for i in range(5)], [{"type": "press"}],
                            received_at=T0 + 0.25)
        self.db.write_batch("watch (simulated)", [sample(i) for i in range(3)], [{"type": "tap"}],
                            received_at=T0 + 1.5)
        self.db.write_batch("airpods (simulated)", [sample(i) for i in range(4)], received_at=T0 + 2.1237)  # .7 ms
        self.assertTrue(self.db.add_walk(walk_body("w-1"), received_at=T0 + 3.0)[0])
        self.db.upsert_home_results([
            {"date": "2026-11-08", "time": "09:00", "test": "tug", "value": 9.5, "person": "A", "simulated": True},
            {"id": "hr-2", "date": "2026-11-08", "test": "sit-to-stand", "value": 12.0, "simulated": True},
        ], received_at=T0 + 4.0)
        self.pg = FakePg()

    def tearDown(self):
        self.db.close()
        self.tmp.cleanup()

    # -- helpers
    def run_migrate(self, *argv, pg=None, env=None, sleep=None):
        lines, used = [], []
        pg = self.pg if pg is None else pg

        def connect(url):
            used.append(url)
            return pg

        kwargs = {"sleep": sleep} if sleep else {}
        code = migrate.main(["--sqlite", self.path, *argv], environ={"DATABASE_URL": URL} if env is None else env,
                            connect=connect, out=lines.append, **kwargs)
        self.assertEqual(used, [URL] if used else [])
        return code, "\n".join(lines)

    def sqlite(self):
        return contextlib.closing(sqlite3.connect(self.path))  # closed, so Windows can delete the folder

    def sqlite_rows(self, table):
        cols = ", ".join(migrate.COLUMNS[table])
        with self.sqlite() as conn:
            return conn.execute(f"SELECT {cols} FROM {table} ORDER BY rowid").fetchall()

    def sqlite_columns(self, table):
        with self.sqlite() as conn:
            return tuple(r[1] for r in conn.execute(f"PRAGMA table_info({table})"))

    def fake_rows(self, table):
        rows = self.pg.rows.get(table, [] if table == "samples" else {})
        rows = rows if isinstance(rows, list) else list(rows.values())
        return [tuple(r[c] for c in migrate.COLUMNS[table]) for r in rows]

    # -- tests
    def test_columns_match_db_py_and_schema_pg(self):
        ddl = {m.group(1): m.group(2) for m in re.finditer(
            r"CREATE TABLE IF NOT EXISTS (\w+) \((.*?)\)(?: WITH \(.*\))?$", "\n".join(migrate.schema_statements()),
            re.M)}
        types = {"REAL": "DOUBLE PRECISION", "INTEGER": "BIGINT", "TEXT": "TEXT"}
        with self.sqlite() as conn:
            for table in db.TABLES:
                self.assertEqual(migrate.COLUMNS[table], self.sqlite_columns(table), table)
                pg_cols = [c.strip().split(" ", 1) for c in ddl[table].split(", ")]
                extra = list(migrate.EXTRA_COLUMNS.get(table, ()))
                self.assertEqual([c[0] for c in pg_cols], list(migrate.COLUMNS[table]) + extra, table)
                sqlite_types = {r[1]: r[2] for r in conn.execute(f"PRAGMA table_info({table})")}
                for name, pg_type in pg_cols:
                    if name in sqlite_types:
                        self.assertTrue(pg_type.startswith(types[sqlite_types[name]]), (table, name, pg_type))
        self.assertIn("received_ms BIGINT NOT NULL", ddl["samples"])
        self.assertEqual(set(migrate.TABLES), set(db.TABLES))
        for statement in migrate.schema_statements():
            self.assertRegex(statement, r"^CREATE (TABLE|INDEX) IF NOT EXISTS ")  # safe to run again

    def test_copies_every_table_in_order_with_received_ms(self):
        code, out = self.run_migrate("--batch", "4")
        self.assertEqual(code, 0, out)
        for table in migrate.TABLES:
            expected = self.sqlite_rows(table)
            self.assertTrue(expected, table)
            self.assertEqual(self.fake_rows(table), expected, table)
            inserts = [s for s, _ in self.pg.log if s.startswith(f"INSERT INTO {table} (")]
            cols = INSERT_RE.match(inserts[0]).group(2).split(", ")
            self.assertEqual(tuple(cols), self.sqlite_columns(table) + migrate.EXTRA_COLUMNS.get(table, ()))
        samples = self.pg.rows["samples"]
        self.assertEqual(len(samples), 5 + 3 + 4 + 3)
        for row in samples:
            self.assertEqual(row["received_ms"], round(row["received_at"] * 1000))
            self.assertIsInstance(row["received_ms"], int)
        self.assertEqual(samples[0]["received_ms"], 1762585920250)
        # batches of at most 4 samples, each committed with its watermark
        batches = [p for s, p in self.pg.log if s.startswith("INSERT INTO samples (")]
        self.assertEqual([len(b) for b in batches], [4, 4, 4, 3])
        with self.sqlite() as conn:
            max_rowid = conn.execute("SELECT MAX(rowid) FROM samples").fetchone()[0]
        self.assertIn(max_rowid, [v for (_, t), v in self.pg.state.items() if t == "samples"])
        self.assertIn("Copied in", out)
        self.assertRegex(out, r"\n  samples +15\n")

    def test_second_run_copies_nothing_new_then_only_new_rows(self):
        self.assertEqual(self.run_migrate()[0], 0)
        before = {t: self.fake_rows(t) for t in migrate.TABLES}
        logged = len(self.pg.log)
        code, out = self.run_migrate()
        self.assertEqual(code, 0, out)
        later = self.pg.log[logged:]
        self.assertFalse([s for s, _ in later if s.startswith(("INSERT INTO samples", "INSERT INTO events"))])
        self.assertEqual({t: self.fake_rows(t) for t in migrate.TABLES}, before)
        # keyed rows are sent again by a new process, but the server only rewrites rows that changed
        for s, _ in later:
            if s.startswith(("INSERT INTO devices", "INSERT INTO sessions", "INSERT INTO walks",
                             "INSERT INTO home_results")):
                self.assertIn("IS DISTINCT FROM", s)
        # the server keeps writing: the next pass copies just the new samples and the grown session
        self.db.write_batch("airpods (simulated)", [sample(i) for i in range(6)], received_at=T0 + 5.0)
        logged = len(self.pg.log)
        self.assertEqual(self.run_migrate()[0], 0)
        new_samples = [p for s, p in self.pg.log[logged:] if s.startswith("INSERT INTO samples (")]
        self.assertEqual(sum(len(p) for p in new_samples), 6)
        self.assertEqual(self.fake_rows("samples"), self.sqlite_rows("samples"))
        self.assertEqual(self.fake_rows("sessions"), self.sqlite_rows("sessions"))
        self.assertEqual(self.fake_rows("devices"), self.sqlite_rows("devices"))

    def test_follow_pass_sends_only_changes_and_stops_on_ctrl_c(self):
        mirror = migrate.Mirror(self.path, self.pg, batch=5000)
        first = mirror.copy_once()
        self.assertEqual(sum(first.values()), sum(len(self.sqlite_rows(t)) for t in migrate.TABLES))
        self.assertEqual(mirror.copy_once(), {t: 0 for t in migrate.TABLES})
        self.db.write_batch("watch (simulated)", [sample(i) for i in range(2)], received_at=T0 + 6.0)
        third = mirror.copy_once()
        self.assertEqual((third["samples"], third["devices"], third["sessions"], third["walks"]), (2, 1, 1, 0))

        sleeps = []

        def sleep(seconds):
            sleeps.append(seconds)
            if len(sleeps) == 1:
                self.db.write_batch("watch (simulated)", [sample(1)], received_at=T0 + 7.0)
                return
            raise KeyboardInterrupt

        code, out = self.run_migrate("--follow", pg=FakePg(), sleep=sleep)
        self.assertEqual(code, 0, out)
        self.assertEqual(sleeps, [5.0, 5.0])
        self.assertRegex(out, r"\d\d:\d\d:\d\d  devices \+1  sessions \+1  samples \+1")
        self.assertTrue(out.rstrip().endswith("Stopped."))

    def test_dry_run_needs_no_database_url_and_no_psycopg(self):
        lines = []
        with mock.patch.dict(sys.modules, {"psycopg": None}):
            code = migrate.main(["--sqlite", self.path, "--dry-run"], environ={}, out=lines.append)
        out = "\n".join(lines)
        self.assertEqual(code, 0, out)
        self.assertIn("DATABASE_URL is not set", out)
        for table in migrate.TABLES:
            self.assertRegex(out, rf"\n  {table} +{len(self.sqlite_rows(table))}\n")
        self.assertIn("  CREATE TABLE IF NOT EXISTS devices (", out)
        # and as a command, in a fresh Python with no DATABASE_URL at all
        env = {k: v for k, v in os.environ.items() if k != "DATABASE_URL"}
        proc = subprocess.run([sys.executable, os.path.join(SERVER_DIR, "migrate.py"), "--sqlite", self.path,
                               "--dry-run"], capture_output=True, text=True, env=env, timeout=60)
        self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
        self.assertIn("samples", proc.stdout)
        self.assertIn("First of", proc.stdout)

    def test_without_psycopg_it_says_how_to_install(self):
        lines = []
        with mock.patch.dict(sys.modules, {"psycopg": None}):
            code = migrate.main(["--sqlite", self.path], environ={"DATABASE_URL": URL}, out=lines.append)
        out = "\n".join(lines)
        self.assertEqual(code, 2)
        self.assertIn('pip install "psycopg[binary]"', out)
        self.assertNotIn(PASSWORD, out)

    def test_url_never_printed_only_host(self):
        outputs = [self.run_migrate("--dry-run")[1], self.run_migrate()[1]]

        def refuse_connect(url):
            raise ConnectionError(f"connection to {url} failed: password {PASSWORD} rejected")

        lines = []
        code = migrate.main(["--sqlite", self.path], environ={"DATABASE_URL": URL}, connect=refuse_connect,
                            out=lines.append)
        self.assertEqual(code, 1)
        outputs.append("\n".join(lines))
        env = dict(os.environ, DATABASE_URL=URL)
        proc = subprocess.run([sys.executable, os.path.join(SERVER_DIR, "migrate.py"), "--sqlite", self.path,
                               "--dry-run"], capture_output=True, text=True, env=env, timeout=60)
        outputs.append(proc.stdout + proc.stderr)
        for out in outputs:
            self.assertNotIn(URL, out)
            self.assertNotIn(PASSWORD, out)
            self.assertNotIn("tsdbadmin", out)
            self.assertIn(HOST, out)

    def test_falls_back_to_classic_hypertable_call(self):
        pg = FakePg(refuse=("tsdb.hypertable",))
        code, out = self.run_migrate(pg=pg)
        self.assertEqual(code, 0, out)
        self.assertIn("refused", out)
        plain = [s for s, _ in pg.log if s.startswith("CREATE TABLE IF NOT EXISTS samples") and "WITH" not in s]
        self.assertEqual(len(plain), 1)
        self.assertTrue(pg.sql("SELECT create_hypertable('samples', by_range('received_ms', 86400000)"))
        self.assertEqual(len(pg.rows["samples"]), 15)
        # plain PostgreSQL without TimescaleDB: still copies, and says samples is a plain table
        pg = FakePg(refuse=("tsdb.hypertable",), timescale=False)
        code, out = self.run_migrate(pg=pg)
        self.assertEqual(code, 0, out)
        self.assertIn("plain PostgreSQL table", out)
        self.assertEqual(len(pg.rows["samples"]), 15)

    def test_reset_sqlite_file_is_copied_from_its_start(self):
        self.assertEqual(self.run_migrate()[0], 0)
        self.db.close()
        os.replace(self.path, self.path + ".old")  # what docs/DATABASE.md says: move it aside
        for suffix in ("-wal", "-shm"):
            if os.path.exists(self.path + suffix):
                os.replace(self.path + suffix, self.path + ".old" + suffix)
        self.db = db.Database(self.path)
        self.db.write_batch("phone (simulated)", [sample(i) for i in range(2)], received_at=T0 + 100.0)
        self.assertEqual(self.run_migrate()[0], 0)
        self.assertEqual(len(self.pg.rows["samples"]), 15 + 2)
        self.assertEqual(len({s for s, t in self.pg.state if t == "samples"}), 2)

    def test_missing_sqlite_file(self):
        lines = []
        code = migrate.main(["--sqlite", os.path.join(self.tmp.name, "nope.sqlite"), "--dry-run"], environ={},
                            out=lines.append)
        self.assertEqual(code, 2)
        self.assertIn("No SQLite file", "\n".join(lines))
        self.assertFalse(os.path.exists(os.path.join(self.tmp.name, "nope.sqlite")))


if __name__ == "__main__":
    unittest.main()
