-- PostgreSQL / TimescaleDB (Tiger Data) copy of the server's SQLite schema (server/db.py, SCHEMA).
-- server/migrate.py applies this file, then copies the rows. Every statement is safe to run again.
--
-- Same tables and columns as db.py, in the same order. Types:
--   REAL (epoch seconds, sensor values)  -> DOUBLE PRECISION
--   INTEGER (counts, 0/1 flags, ids)     -> BIGINT
--   TEXT (names, JSON text)              -> TEXT   (JSON stays text; cast with ::jsonb in queries)
-- samples gets one extra column, received_ms = received_at * 1000 (rounded), filled in by migrate.py.
-- It is the hypertable's partition column: the laptop's receive clock, the one clock every device shares
-- (t_ms is device time: page time on the phone page, epoch time from Sensor Logger).
--
-- migrate.py splits this file on ';' after removing '--' comments, so keep ';' and '--' out of the
-- statements themselves.

CREATE TABLE IF NOT EXISTS devices (
    id          TEXT PRIMARY KEY,
    kind        TEXT,
    first_seen  DOUBLE PRECISION,
    last_seen   DOUBLE PRECISION,
    samples     BIGINT,
    simulated   BIGINT
);

CREATE TABLE IF NOT EXISTS sessions (
    id          TEXT PRIMARY KEY,
    device_id   TEXT,
    kind        TEXT,
    started_at  DOUBLE PRECISION,
    ended_at    DOUBLE PRECISION,
    samples     BIGINT,
    label       TEXT,
    meta        TEXT
);

-- Modern syntax (TimescaleDB 2.20 and later): the table is created as a hypertable in one statement,
-- in chunks of one day (86,400,000 ms).
CREATE TABLE IF NOT EXISTS samples (
    session_id  TEXT,
    device_id   TEXT,
    t_ms        DOUBLE PRECISION,
    received_at DOUBLE PRECISION,
    gx          DOUBLE PRECISION,
    gy          DOUBLE PRECISION,
    gz          DOUBLE PRECISION,
    ax          DOUBLE PRECISION,
    ay          DOUBLE PRECISION,
    az          DOUBLE PRECISION,
    lx          DOUBLE PRECISION,
    ly          DOUBLE PRECISION,
    lz          DOUBLE PRECISION,
    received_ms BIGINT NOT NULL
) WITH (tsdb.hypertable, tsdb.partition_column = 'received_ms', tsdb.chunk_interval = 86400000);

-- Classic syntax (TimescaleDB before 2.20): create the table above without its WITH (...) part, then
--   SELECT create_hypertable('samples', by_range('received_ms', 86400000), if_not_exists => TRUE);
-- migrate.py does both by itself: if the WITH (...) form fails it makes the plain table, and after this
-- file it always runs the classic call with if_not_exists => TRUE (a no-op on a hypertable).

CREATE TABLE IF NOT EXISTS events (
    id          BIGINT PRIMARY KEY,
    device_id   TEXT,
    received_at DOUBLE PRECISION,
    type        TEXT,
    payload     TEXT
);

CREATE TABLE IF NOT EXISTS walks (
    id            TEXT PRIMARY KEY,
    created_at    TEXT,
    received_at   DOUBLE PRECISION,
    distance_m    DOUBLE PRECISION,
    placement     TEXT,
    speed_mps     DOUBLE PRECISION,
    quality       TEXT,
    simulated     BIGINT,
    result        TEXT,
    device        TEXT,
    has_recording BIGINT,
    deleted_at    DOUBLE PRECISION
);

CREATE TABLE IF NOT EXISTS home_results (
    id          TEXT PRIMARY KEY,
    received_at DOUBLE PRECISION,
    date        TEXT,
    test        TEXT,
    value       DOUBLE PRECISION,
    person      TEXT,
    source      TEXT,
    simulated   BIGINT,
    payload     TEXT
);

-- Copy bookkeeping: samples and events are copied past a watermark, the highest SQLite rowid already
-- copied. source names the SQLite file (a hash of its first row), so a reset file starts from 0.
CREATE TABLE IF NOT EXISTS _sync_state (
    source      TEXT NOT NULL,
    table_name  TEXT NOT NULL,
    last_rowid  BIGINT NOT NULL,
    rows_copied BIGINT NOT NULL DEFAULT 0,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (source, table_name)
);

-- The same indexes as db.py. On samples, received_ms stands in for received_at (same instant, and the
-- column the hypertable's chunks are cut on). TimescaleDB adds its own index on received_ms.
CREATE INDEX IF NOT EXISTS samples_by_device ON samples (device_id, received_ms DESC);
CREATE INDEX IF NOT EXISTS samples_by_session ON samples (session_id);
CREATE INDEX IF NOT EXISTS sessions_by_device ON sessions (device_id, ended_at);
CREATE INDEX IF NOT EXISTS sessions_by_start ON sessions (started_at);
CREATE INDEX IF NOT EXISTS events_by_device ON events (device_id, received_at);
CREATE INDEX IF NOT EXISTS walks_by_received ON walks (received_at);

-- ------------------------------------------------------------------------------------------------
-- Example queries (not run by migrate.py). Paste into the Tiger Console's SQL editor.
--
-- Samples per device per second, last 10 minutes (a live device shows 25 to 60 a second):
--   SELECT to_timestamp(time_bucket(1000, received_ms) / 1000.0) AS second,
--          device_id, count(*) AS samples
--   FROM samples
--   WHERE received_ms > (extract(epoch FROM now()) * 1000)::BIGINT - 600000
--   GROUP BY second, device_id
--   ORDER BY second DESC, device_id;
--
-- Mean turning speed per minute (deg/s, size of the gyroscope vector gx, gy, gz):
--   SELECT to_timestamp(time_bucket(60000, received_ms) / 1000.0) AS minute,
--          device_id, round(avg(sqrt(gx * gx + gy * gy + gz * gz))::NUMERIC, 1) AS mean_turning_dps,
--          count(*) AS samples
--   FROM samples
--   GROUP BY minute, device_id
--   ORDER BY minute DESC, device_id;
--
-- The same per minute as a continuous aggregate (TimescaleDB keeps it up to date). A hypertable on an
-- integer column needs a "now" function in the same unit (ms) first:
--   CREATE OR REPLACE FUNCTION unix_now_ms() RETURNS BIGINT LANGUAGE SQL STABLE
--     AS $$ SELECT (extract(epoch FROM now()) * 1000)::BIGINT $$;
--   SELECT set_integer_now_func('samples', 'unix_now_ms', replace_if_exists => TRUE);
--   CREATE MATERIALIZED VIEW turning_per_minute WITH (timescaledb.continuous) AS
--     SELECT time_bucket(60000, received_ms) AS minute_ms, device_id,
--            avg(sqrt(gx * gx + gy * gy + gz * gz)) AS mean_turning_dps, count(*) AS samples
--     FROM samples
--     GROUP BY minute_ms, device_id
--   WITH NO DATA;
--   CALL refresh_continuous_aggregate('turning_per_minute', NULL, NULL);
--   SELECT to_timestamp(minute_ms / 1000.0) AS minute, device_id, mean_turning_dps, samples
--   FROM turning_per_minute ORDER BY minute_ms DESC LIMIT 20;
