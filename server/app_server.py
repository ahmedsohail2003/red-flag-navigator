#!/usr/bin/env python3
"""One server for the whole app (server/SPEC.md). Start it with `python run.py` from the project folder.

It serves the app and every phone page from one origin (so browser storage is shared), accepts every device
protocol unchanged, and logs everything that arrives to a local SQLite database (default data/rfn.sqlite):

    laptop   http://localhost:8765/                      app/ (the red-flag app)
             http://localhost:8765/gyro/screen.html      gyro-starter/static/ (live motion screen)
             http://localhost:8765/motion/receive.html   motion/web/ (walk results)
    phones   https://<laptop-ip>:8443/gyro/phone.html    motion stream  -> POST /gyro/ingest
             https://<laptop-ip>:8443/motion/walk.html   10 m walk test -> POST /api/walks
    Sensor Logger app (AirPods, Apple Watch, phone)      -> POST http://<laptop-ip>:8765/sensorlogger

The gyro protocol is reused from gyro-starter/server.py, loaded by path (the folder name has a hyphen):
from_sensor_logger, Hub, FIELDS, ensure_cert, lan_ips, QuietServer and MIME. DbHub adds the database write
after each batch. The walk API (motion/CONTRACT.md section 5) is implemented here against the database.

Standard library only, plus the 'cryptography' package for the self-signed HTTPS certificate.
"""
from __future__ import annotations

import argparse
import importlib.util
import ipaddress
import json
import math
import os
import queue
import re
import signal
import socket
import socketserver
import sqlite3
import ssl
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, unquote

HERE = os.path.dirname(os.path.abspath(__file__))            # .../server
PROJECT_DIR = os.path.dirname(HERE)
APP_DIR = os.path.join(PROJECT_DIR, "app")
GYRO_DIR = os.path.join(PROJECT_DIR, "gyro-starter")
GYRO_STATIC_DIR = os.path.join(GYRO_DIR, "static")
MOTION_DIR = os.path.join(PROJECT_DIR, "motion")
MOTION_WEB_DIR = os.path.join(MOTION_DIR, "web")
DATA_DIR = os.path.join(PROJECT_DIR, "data")
DEFAULT_DB = os.path.join(DATA_DIR, "rfn.sqlite")
CERT_DIR = os.path.join(HERE, ".certs")

DEFAULT_HTTP_PORT = 8765
DEFAULT_HTTPS_PORT = 8443
SERVER_NAME = "rfn-one-server"
API_VERSION = 1


def _load(name: str, path: str):
    """Import a .py file by path (registered under `name`, so every importer shares one module object)."""
    module = sys.modules.get(name)
    if module is not None:
        return module
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise ImportError(f"cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    try:
        spec.loader.exec_module(module)
    except BaseException:
        sys.modules.pop(name, None)
        raise
    return module


try:
    gyro = _load("gyro_starter_server", os.path.join(GYRO_DIR, "server.py"))
    from_sensor_logger = gyro.from_sensor_logger
    Hub = gyro.Hub
    FIELDS = gyro.FIELDS
    ensure_cert = gyro.ensure_cert
    lan_ips = gyro.lan_ips
    QuietServer = gyro.QuietServer
    GYRO_MIME = gyro.MIME
    SENSOR_LOGGER_MOTION = dict(getattr(gyro, "SENSOR_LOGGER_MOTION", {}))  # Sensor Logger name -> (device, ...)
except Exception as _err:  # spec: if this import fails, stop and report; never copy the code instead
    raise ImportError(f"server/app_server.py reuses gyro-starter/server.py, and loading it failed: {_err!r}") from _err

db = _load("rfn_db", os.path.join(HERE, "db.py"))

# Every column the database keeps for a sample is a field of the gyro protocol (orientation oa/ob/og is relayed
# to the screen and the CSV recording, but not stored). Fail loudly if the two ever drift apart.
if not set(db.SAMPLE_FIELDS) <= set(FIELDS):
    raise ImportError(f"db.SAMPLE_FIELDS {db.SAMPLE_FIELDS} are not all gyro-starter FIELDS {FIELDS}")

MIME = dict(GYRO_MIME)
MIME.update({
    ".mjs": "text/javascript; charset=utf-8",
    ".webmanifest": "application/manifest+json",
    ".woff2": "font/woff2",
    ".woff": "font/woff",
    ".htm": "text/html; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
    ".csv": "text/csv; charset=utf-8",
    ".map": "application/json",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
})

GYRO_MAX_BODY = int(getattr(gyro, "MAX_BODY", 5_000_000))   # /ingest, /sensorlogger, /record (gyro's own limit)
WALK_MAX_BODY = 3 * 1024 * 1024    # "at most 3 MB", read as 3 MiB like motion/server.py
WALK_MAX_SAMPLES = 20000
HOME_MAX_BODY = 5_000_000
HOME_MAX_ROWS = 20000
DRAIN_MAX = 16 * 1024 * 1024       # an oversized body up to this size is read and dropped, so the client sees the 413
DRAIN_IDLE_S = 1.0                 # ...unless it stalls this long
PING_INTERVAL_S = 15.0             # keep-alive comment on idle event streams
POLL_S = 0.5                       # how often event streams check whether the server is stopping
WALK_ID_RE = re.compile(r"[A-Za-z0-9_-]{6,64}")      # fullmatch: "$" would also accept a trailing newline
SESSION_ID_RE = re.compile(r"[A-Za-z0-9_-]{1,128}")
WALK_KIND = "rfn-walk"

FIREWALL_HINT = ('Windows firewall: if a phone cannot connect, allow Python on Private and Public networks when '
                 'Windows asks, or in an admin PowerShell run: New-NetFirewallRule -DisplayName "RFN one server" '
                 '-Direction Inbound -Protocol TCP -LocalPort {ports} -Action Allow')


# ------------------------------------------------------------------------------------------------ helpers

def _dumps(obj) -> bytes:
    return json.dumps(obj, separators=(",", ":")).encode("utf-8")


def _reject_constant(name: str):
    raise ValueError(f"{name} is not allowed in JSON")


def _finite_float(text: str) -> float:
    value = float(text)
    if not math.isfinite(value):  # 1e999 parses to inf, which would be stored and served back as "Infinity"
        raise ValueError(f"the number {text[:24]} is too large")
    return value


def parse_strict_json(raw: bytes):
    """Parse an API body: strict JSON only (no NaN or Infinity, which a browser's JSON.parse would refuse later)."""
    try:
        return json.loads(raw.decode("utf-8"), parse_constant=_reject_constant, parse_float=_finite_float)
    except (UnicodeDecodeError, RecursionError) as err:
        raise ValueError(str(err)) from None


def valid_walk_id(value) -> bool:
    return isinstance(value, str) and WALK_ID_RE.fullmatch(value) is not None


def _is_number(value) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def validate_walk(body) -> str | None:
    """None if body is an acceptable walk (motion/CONTRACT.md section 5), else one plain-words sentence."""
    if not isinstance(body, dict):
        return "The walk must be a JSON object."
    if body.get("kind") != WALK_KIND:
        return 'This is not a walk. The kind must be "rfn-walk".'
    if not valid_walk_id(body.get("id")):
        return "The walk id is missing or wrong. Use 6 to 64 letters, digits, dashes or underscores."
    distance = body.get("distance_m")
    if not _is_number(distance) or not (1 <= distance <= 100):
        return "The walk distance must be a number from 1 to 100 metres."
    if not isinstance(body.get("result"), dict):
        return "The walk result is missing. It must be an object."
    recording = body.get("recording")
    if recording is not None:
        if not isinstance(recording, dict):
            return "The recording must be an object."
        samples = recording.get("samples")
        if samples is not None and not isinstance(samples, list):
            return "The recording samples must be a list."
        if isinstance(samples, list) and len(samples) > WALK_MAX_SAMPLES:
            return f"The recording is too long. It has over {WALK_MAX_SAMPLES} samples. Record a shorter walk."
    return None


def is_loopback(address) -> bool:
    """True only for a client on this laptop (127.x.x.x or ::1, also IPv4-mapped). Gates DELETE /api/walks."""
    if not isinstance(address, str) or not address:
        return False
    try:
        ip = ipaddress.ip_address(address.split("%", 1)[0])
    except ValueError:
        return False
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    return ip.is_loopback


_HOST_PORT = re.compile(r"(?::[0-9]{1,5})?")


def is_local_host_header(value) -> bool:
    """True only for a Host header naming this laptop: localhost, 127.0.0.1 or [::1], with or without a port.

    DELETE /api/walks needs this as well as a loopback client (motion/CONTRACT.md section 5). A tunnel
    forwards from 127.0.0.1 but carries its own host name, and a DNS-rebinding page in the laptop's browser
    connects from 127.0.0.1 but sends its attacker's host name, so the client address alone lets both through.
    """
    if not isinstance(value, str):
        return False
    v = value.strip().lower()
    for name in ("localhost", "127.0.0.1", "[::1]"):
        if v.startswith(name) and _HOST_PORT.fullmatch(v[len(name):]):
            return True
    return False


def source_name(batch: dict) -> str:
    """The device name Hub.ingest files a batch under (the same rule, so stats and database agree)."""
    return str(batch.get("source") or "unknown").strip()[:40] or "unknown"


def simulated_name(name: str) -> str:
    return name if db.is_simulated(name) else f"{name} (simulated)"


def _flag(query: str, name: str) -> bool:
    values = parse_qs(query or "", keep_blank_values=True).get(name) or [""]
    return values[0].strip().lower() in ("1", "true", "yes", "on")


def _is_json_type(value: str | None) -> bool:
    media = (value or "").split(";", 1)[0].strip().lower()
    return media == "application/json" or (media.startswith("application/") and media.endswith("+json"))


def _inside(path: str, root: str) -> bool:
    try:
        return os.path.commonpath([os.path.normcase(path), os.path.normcase(root)]) == os.path.normcase(root)
    except ValueError:  # different drives on Windows
        return False


def _url_host(ip: str) -> str:
    return f"[{ip}]" if ":" in ip else ip


# ---------------------------------------------------------------------------------------------------- hubs

class DbHub(Hub):
    """gyro-starter's Hub (stats, CSV recording, /events fan-out), plus a database write after every batch."""

    def __init__(self, database, recordings_dir: str, log=None):
        super().__init__(recordings_dir=recordings_dir)
        self.db = database
        self.db_errors = 0
        self.last_db_error: str | None = None
        self._log = log or (lambda line: print(line, file=sys.stderr, flush=True))
        self._last_logged = 0.0

    def ingest(self, batch) -> int:
        count = super().ingest(batch)  # validates the batch, so below it is a dict with list samples/events
        samples = [s for s in batch.get("samples", []) if isinstance(s, dict)]
        events = [e for e in batch.get("events", []) if isinstance(e, dict)]
        try:
            self.db.write_batch(source_name(batch), samples, events)
        except db.DatabaseClosed:
            pass  # the server is stopping
        except sqlite3.Error as err:  # keep the live stream going; report the problem
            self.db_errors += 1
            self.last_db_error = str(err)
            if time.time() - self._last_logged > 10:
                self._last_logged = time.time()
                self._log(f"Database write failed ({self.db_errors} so far): {err}")
        return count


class SensorLoggerLog:
    """What the last Sensor Logger push held, for the Devices screen (/api/db/summary) and the console.

    Every sensor name in the push is listed with its role:
    - "stored": its readings became samples of a device (airpods, watch, phone (Sensor Logger));
    - "unreadable": it should have been stored, but no reading converted. For example, AirPods readings
      without rotationRate, which Sensor Logger only added in version 1.30;
    - "helper": gravity, which gives the phone's own gyroscope samples their tilt;
    - "ignored": a sensor this server does not read (battery, accelerometer and so on).
    A missing AirPods or Watch stream then shows up on screen, instead of failing silently.
    Only sensor names and counts are kept, never Sensor Logger's device, session or user ids.
    """

    MAX_NAMES = 20
    MAX_NAME_LEN = 40

    def __init__(self, log=None):
        self._lock = threading.Lock()
        self.pushes = 0
        self.tests = 0
        self._last: dict | None = None
        self._last_signature = None
        self._log = log or (lambda line: None)

    def note(self, body, converted: dict, simulated: bool) -> dict:
        payload = body.get("payload") if isinstance(body, dict) else None
        counts: dict[str, int] = {}
        if isinstance(payload, list):
            for reading in payload:
                name = reading.get("name") if isinstance(reading, dict) else None
                if not isinstance(name, str):
                    continue
                key = name[:self.MAX_NAME_LEN]
                if key in counts or len(counts) < self.MAX_NAMES:
                    counts[key] = counts.get(key, 0) + 1
        sensors = []
        for name, n in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0])):
            spec = SENSOR_LOGGER_MOTION.get(name)
            if spec:
                device = "phone (Sensor Logger)" if spec[0] == "phone" else spec[0]
                if simulated:
                    device = simulated_name(device)
                stored = len(converted.get(device) or [])
                sensors.append({"name": name, "count": n, "role": "stored" if stored else "unreadable",
                                "device": device, "stored": stored})
            else:
                sensors.append({"name": name, "count": n, "role": "helper" if name == "gravity" else "ignored",
                                "device": None, "stored": 0})
        entry = {"at": time.time(), "test": not counts, "simulated": bool(simulated),
                 "readings": sum(counts.values()), "sensors": sensors}
        # by name, not by count: two sensors at the same rate trade places from one batch to the next. The
        # device names change when simulated data gives way to real data, so that prints a new line too.
        signature = (entry["test"], bool(simulated),
                     tuple(sorted((s["name"], s["role"], s["device"] or "") for s in sensors)))
        with self._lock:
            self.pushes += 1
            if entry["test"]:
                self.tests += 1
            self._last = entry
            changed = signature != self._last_signature
            self._last_signature = signature
        if changed or entry["test"]:
            self._log(f"[{time.strftime('%H:%M:%S')}] Sensor Logger: {self.describe(entry)}")
        return entry

    @staticmethod
    def describe(entry: dict) -> str:
        """One plain line for the console, e.g. 'headphone 25 -> airpods; battery 1 not read'."""
        if entry["test"]:
            return "connection test received (no readings). Start a recording in Sensor Logger to send data."
        parts = []
        for s in entry["sensors"]:
            # names come from the network: no control characters (a newline could fake a console line)
            name = re.sub(r"[\x00-\x1f\x7f]", "?", s["name"].encode("ascii", "replace").decode("ascii"))
            if s["role"] == "stored":
                parts.append(f"{name} {s['count']} -> {s['device']}")
            elif s["role"] == "unreadable":
                parts.append(f"{name} {s['count']} NOT stored (no rotationRate in the readings: update Sensor Logger)")
            elif s["role"] == "helper":
                parts.append(f"{name} {s['count']} (tilt for the phone)")
            else:
                parts.append(f"{name} {s['count']} not read")
        return "; ".join(parts)

    def snapshot(self) -> dict:
        with self._lock:
            return {"pushes": self.pushes, "tests": self.tests, "last": self._last}


class WalkFeed:
    """Open GET /api/events streams: each gets a queue of walk summaries (bytes); None ends the stream."""

    def __init__(self):
        self._lock = threading.Lock()
        self._clients: set[queue.Queue] = set()

    def subscribe(self) -> queue.Queue:
        q: queue.Queue = queue.Queue()
        with self._lock:
            self._clients.add(q)
        return q

    def unsubscribe(self, q: queue.Queue) -> None:
        with self._lock:
            self._clients.discard(q)

    def count(self) -> int:
        with self._lock:
            return len(self._clients)

    def publish(self, summary: dict) -> None:
        data = _dumps(summary)
        with self._lock:
            for q in self._clients:
                q.put_nowait(data)

    def close(self) -> None:
        with self._lock:
            for q in self._clients:
                q.put_nowait(None)


class App:
    """What both listeners (HTTP and HTTPS) share: the database, the hubs, the static roots and /api/info."""

    def __init__(self, database, hub: DbHub, *, app_dir: str, gyro_dir: str, motion_dir: str, blocked: tuple,
                 ping_interval_s: float = PING_INTERVAL_S, log=None):
        self.db = database
        self.hub = hub
        self.app_dir, self.gyro_dir, self.motion_dir = app_dir, gyro_dir, motion_dir
        self.blocked = tuple(os.path.realpath(p) for p in blocked if p)
        self.ping_interval_s = float(ping_interval_s)
        self.walk_feed = WalkFeed()
        self.stopping = threading.Event()
        self.info: dict = {}            # as at startup (the banner); GET /api/info uses current_info()
        self.https = False
        self._walk_lock = threading.Lock()
        self.log = log or (lambda line: None)
        self.sensor_logger = SensorLoggerLog(log=self.log)
        self.ips_fn = None              # set by make_servers when LAN addresses are discovered, not given
        self._info_lock = threading.Lock()
        self._info_at = -1e9
        self._fresh_info: dict | None = None

    INFO_REFRESH_S = 5.0

    def current_info(self) -> dict:
        """GET /api/info. The LAN addresses are looked up again, at most every 5 s, so after the laptop joins
        another network (a phone hotspot) the new phone addresses show on a page reload (motion/CONTRACT.md
        section 5). The certificate still names only the startup addresses until a restart."""
        if self.ips_fn is None or not self.info:
            return self.info
        now = time.monotonic()
        with self._info_lock:
            if now - self._info_at >= self.INFO_REFRESH_S:
                self._info_at = now
                try:
                    ips = list(self.ips_fn())
                except Exception:  # noqa: BLE001 - address lookup trouble must never break /api/info
                    ips = None
                if ips is not None:
                    i = self.info
                    self._fresh_info = build_info(i["httpPort"], i["httpsPort"], ips, i["db"])
            return self._fresh_info or self.info

    def add_walk(self, body: dict) -> tuple[bool, dict | None]:
        with self._walk_lock:  # store and announce in one step, so every stream sees walks in stored order
            created, summary = self.db.add_walk(body)
            if created:
                self.walk_feed.publish(summary)
        return created, summary

    def summary(self) -> dict:
        out = self.db.summary()
        snap = self.hub.snapshot()
        out["stream"] = {"viewers": snap["viewers"], "recording": snap["recording"],
                         "db_errors": self.hub.db_errors, "last_db_error": self.hub.last_db_error}
        out["sensorLogger"] = self.sensor_logger.snapshot()
        return out

    def health(self) -> dict:
        return {"ok": True, "server": SERVER_NAME, "version": API_VERSION, "db": self.db.healthy(),
                "dbErrors": self.hub.db_errors, "https": self.https, "httpsPort": self.info.get("httpsPort"),
                "httpPort": self.info.get("httpPort"), "time": db.iso_utc(time.time())}


def resolve_static(raw_path: str, app: App) -> tuple[int, str | None]:
    """Map a request path (query removed) to a file: (200, path), (403, None) or (404, None).

    /gyro/<path> -> gyro-starter/static, /motion/<path> -> motion/web, anything else -> app/. The path is
    percent-decoded once. "..", backslashes (%5c), NUL, colons (drive letters, NTFS streams) and dot-names
    (.certs, .git) are refused with 403. The real path must stay inside its root and outside every blocked
    folder (the database, certificates, recordings, server/). A directory gives its index.html, never a list.
    """
    try:
        path = unquote(raw_path, errors="strict")
    except UnicodeDecodeError:
        return 404, None
    if not path.startswith("/") or "\\" in path or "\x00" in path:
        return 403, None
    parts = []
    for seg in path.split("/")[1:]:
        if seg in ("", "."):
            continue
        if seg == ".." or ":" in seg or seg.startswith("."):
            return 403, None
        parts.append(seg)
    if parts and parts[0] == "gyro":
        root, parts = app.gyro_dir, parts[1:]
    elif parts and parts[0] == "motion":
        root, parts = app.motion_dir, parts[1:]
    else:
        root = app.app_dir
    if not os.path.isdir(root):  # e.g. motion/web before the other session has made it
        return 404, None
    root = os.path.realpath(root)
    full = os.path.realpath(os.path.join(root, *parts))
    if os.path.isdir(full):
        full = os.path.realpath(os.path.join(full, "index.html"))
    if not _inside(full, root):  # also catches a link inside a root that points outside it
        return 403, None
    for b in app.blocked:
        if _inside(full, b):
            return 403, None
    if not os.path.isfile(full):
        return 404, None
    return 200, full


# ------------------------------------------------------------------------------------------------- handler

class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"   # keep-alive, so a phone's POSTs reuse one (TLS) connection
    server_version = "RFNOneServer/1"
    timeout = 60                    # idle or stalled connections close after a minute

    @property
    def app(self) -> App:
        return self.server.app

    def log_message(self, format, *args):  # noqa: A002 - quiet console; serve() prints rates instead
        pass

    def end_headers(self):
        # Every reply (the standard library's own error pages too) gets no-store; every GET /api/* gets CORS.
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        if getattr(self, "command", None) == "GET" and str(getattr(self, "path", "")).startswith("/api/"):
            self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()

    # -- replies
    def _send(self, code: int, body: bytes = b"", ctype: str = "text/plain; charset=utf-8", close: bool = False,
              headers: dict | None = None) -> None:
        self.send_response(code)
        if code != 204:
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        if close:
            self.send_header("Connection", "close")  # also sets self.close_connection
        self.end_headers()
        if body and code != 204 and self.command != "HEAD":
            self.wfile.write(body)

    def _json(self, code: int, obj, close: bool = False) -> None:
        self._send(code, _dumps(obj), "application/json", close)

    def _error(self, code: int, message: str, close: bool = False) -> None:
        self._json(code, {"ok": False, "error": message}, close)

    def _split(self) -> tuple[str, str]:
        target = self.path.split("#", 1)[0]
        path, _, query = target.partition("?")
        return path, query

    # -- request bodies
    def _read_body(self, limit: int, too_large: str) -> bytes | None:
        """The request body (Content-Length or chunked), or None after an error reply (400 or 413)."""
        if "chunked" in (self.headers.get("Transfer-Encoding") or "").lower():
            return self._read_chunked(limit, too_large)
        raw_length = self.headers.get("Content-Length")
        if raw_length is None:
            return b""
        try:
            length = int(raw_length.strip())
        except ValueError:
            length = -1
        if length < 0:
            self._error(400, "bad Content-Length", close=True)
            return None
        if length > limit:  # refused without keeping the body, so the connection must close
            self._drain(length)
            self._error(413, too_large, close=True)
            return None
        raw = self.rfile.read(length) if length else b""
        if len(raw) < length:
            self._error(400, "The upload was cut off. Try again.", close=True)
            return None
        return raw

    def _drain(self, length: int) -> None:
        """Read and drop an oversized body before replying 413. A browser that is still uploading when the server
        closes sees a reset connection, not the 413, and walk.js would then retry the same body instead of dropping
        the recording. Bodies over DRAIN_MAX, and clients that stall for DRAIN_IDLE_S, are not waited for."""
        if length > DRAIN_MAX:
            return
        try:
            self.connection.settimeout(DRAIN_IDLE_S)
            remaining = length
            while remaining > 0:
                chunk = self.rfile.read(min(65536, remaining))
                if not chunk:
                    break
                remaining -= len(chunk)
        except OSError:  # a timeout or a reset: reply anyway, then close
            pass

    def _read_chunked(self, limit: int, too_large: str) -> bytes | None:
        out = bytearray()
        while True:
            line = self.rfile.readline(1026)
            try:
                size = int(line.split(b";", 1)[0].strip(), 16)
            except ValueError:
                size = -1
            if size < 0:
                self._error(400, "bad chunked body", close=True)
                return None
            if size == 0:
                while self.rfile.readline(1026) not in (b"\r\n", b"\n", b""):
                    pass  # trailers
                return bytes(out)
            if len(out) + size > limit:
                self._error(413, too_large, close=True)
                return None
            chunk = self.rfile.read(size)
            self.rfile.readline(3)  # the CRLF after each chunk
            if len(chunk) < size:
                self._error(400, "The upload was cut off. Try again.", close=True)
                return None
            out += chunk

    # -- GET / HEAD
    def do_GET(self):  # noqa: N802
        path, query = self._split()
        if path.startswith("/api/"):
            return self._api_get(path.rstrip("/"), query)
        if path in ("/events", "/gyro/events"):
            return self._gyro_events()
        if path in ("/stats", "/gyro/stats"):
            return self._json(200, self.app.hub.snapshot())
        return self._static_or_redirect(path, query)

    def do_HEAD(self):  # noqa: N802
        path, query = self._split()
        if path.startswith("/api/") or path in ("/events", "/gyro/events", "/stats", "/gyro/stats"):
            return self._send(405, b"Use GET.", headers={"Allow": "GET"})
        return self._static_or_redirect(path, query)

    def _static_or_redirect(self, path: str, query: str) -> None:
        if path == "/favicon.ico":
            return self._send(204)
        if path in ("/gyro", "/motion"):  # pages there use relative URLs, so they need the trailing slash
            return self._send(302, b"", headers={"Location": path + "/" + (f"?{query}" if query else "")})
        status, full = resolve_static(path, self.app)
        if status == 403:
            return self._send(403, b"Not allowed.")
        if status != 200:
            return self._send(404, b"Not found.")
        try:
            with open(full, "rb") as f:
                body = f.read()
        except OSError:
            return self._send(404, b"Not found.")
        return self._send(200, body, MIME.get(os.path.splitext(full)[1].lower(), "application/octet-stream"))

    def _api_get(self, path: str, query: str) -> None:
        app = self.app
        try:
            if path == "/api/health":
                return self._json(200, app.health())
            if path == "/api/info":
                return self._json(200, app.current_info())
            if path == "/api/walks":
                return self._json(200, {"walks": app.db.walk_summaries()})
            if path.startswith("/api/walks/"):
                walk_id = path[len("/api/walks/"):]
                record = app.db.walk(walk_id) if valid_walk_id(walk_id) else None
                if record is None:
                    return self._error(404, "No walk with that id.")
                return self._json(200, record)
            if path == "/api/events":
                return self._walk_events()
            if path == "/api/db/summary":
                return self._json(200, app.summary())
            if path == "/api/db/samples":
                return self._db_samples(query)
            if path.startswith("/api/db/sessions/") and path.endswith(".csv"):
                return self._session_csv(path[len("/api/db/sessions/"):-len(".csv")])
            return self._error(404, "Not found.")
        except sqlite3.Error as err:
            return self._error(500, f"The database could not be read: {err}")

    def _db_samples(self, query: str) -> None:
        q = parse_qs(query or "", keep_blank_values=True)
        device = (q.get("device") or [""])[0]
        if not device:
            return self._error(400, "Name a device: /api/db/samples?device=<id>. The ids are in /api/db/summary.")
        try:
            limit = int((q.get("limit") or ["200"])[0])
            since_raw = (q.get("since") or [""])[0]
            since = float(since_raw) if since_raw else None
        except ValueError:
            return self._error(400, "limit must be a whole number and since a number (epoch seconds).")
        if since is not None and since != since:  # NaN
            return self._error(400, "since must be a number (epoch seconds).")
        rows = self.app.db.samples(device, limit=limit, since=since)
        return self._json(200, {"ok": True, "device": device, "count": len(rows), "samples": rows})

    def _session_csv(self, raw_id: str) -> None:
        session_id = unquote(raw_id)
        chunks = self.app.db.session_csv(session_id) if SESSION_ID_RE.fullmatch(session_id) else None
        if chunks is None:
            return self._error(404, "No session with that id.")
        try:
            self.send_response(200)
            self.send_header("Content-Type", "text/csv; charset=utf-8")
            self.send_header("Content-Disposition", f'attachment; filename="{session_id}.csv"')
            self.send_header("Transfer-Encoding", "chunked")
            self.end_headers()
            for chunk in chunks:
                if chunk:
                    self.wfile.write(b"%X\r\n%s\r\n" % (len(chunk), chunk))
            self.wfile.write(b"0\r\n\r\n")
        except (OSError, sqlite3.Error):
            self.close_connection = True  # the reply is cut off; never reuse this connection
        finally:
            chunks.close()

    # -- event streams
    def _stream_headers(self) -> None:
        self.close_connection = True  # a stream ends when its connection closes
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Connection", "close")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()

    def _gyro_events(self) -> None:
        """GET /events: the Hub's batches, in gyro-starter's wire format (data: <json> per batch)."""
        hub, app = self.app.hub, self.app
        q = hub.subscribe()
        try:
            self._stream_headers()
            self.wfile.write(b"retry: 1000\n\n")
            last = time.monotonic()
            while not app.stopping.is_set():
                try:
                    chunks = [q.get(timeout=POLL_S)]
                except queue.Empty:
                    if time.monotonic() - last >= app.ping_interval_s:
                        self.wfile.write(b": keep-alive\n\n")  # also how a closed viewer is noticed
                        last = time.monotonic()
                    continue
                while len(chunks) < 200:  # send whatever piled up in one write
                    try:
                        chunks.append(q.get_nowait())
                    except queue.Empty:
                        break
                self.wfile.write(b"".join(b"data: " + c.encode("utf-8") + b"\n\n" for c in chunks))
                last = time.monotonic()
        except OSError:  # includes ssl.SSLError and connection resets: the viewer went away
            pass
        finally:
            hub.unsubscribe(q)

    def _walk_events(self) -> None:
        """GET /api/events: 'hello' with the walk count, then one 'walk' event per new walk, ': ping' when idle."""
        app = self.app
        q = app.walk_feed.subscribe()  # before counting, so no walk falls between the count and the stream
        try:
            count = app.db.walk_count()
            self._stream_headers()
            self.wfile.write(b"retry: 2000\n\nevent: hello\ndata: " + _dumps({"walks": count}) + b"\n\n")
            last = time.monotonic()
            while not app.stopping.is_set():
                try:
                    item = q.get(timeout=POLL_S)
                except queue.Empty:
                    if time.monotonic() - last >= app.ping_interval_s:
                        self.wfile.write(b": ping\n\n")
                        last = time.monotonic()
                    continue
                if item is None:  # the server is stopping
                    break
                self.wfile.write(b"event: walk\ndata: " + item + b"\n\n")
                last = time.monotonic()
        except OSError:
            pass
        finally:
            app.walk_feed.unsubscribe(q)

    # -- POST
    def do_POST(self):  # noqa: N802
        path, query = self._split()
        if path in ("/ingest", "/gyro/ingest"):
            return self._gyro_post("ingest", query)
        if path in ("/sensorlogger", "/data", "/gyro/sensorlogger", "/gyro/data"):
            return self._gyro_post("sensorlogger", query)
        if path in ("/record", "/gyro/record"):
            return self._gyro_post("record", query)
        api = path.rstrip("/")
        if api == "/api/walks":
            return self._post_walk()
        if api == "/api/home-results":
            return self._post_home_results()
        return self._error(404, "Not found.", close=True)  # body left unread, so drop the connection

    def _gyro_post(self, kind: str, query: str) -> None:
        """The gyro-starter protocol, unchanged (gyro-starter/README.md, "Protocol")."""
        raw = self._read_body(GYRO_MAX_BODY, "body too large")
        if raw is None:
            return
        try:
            body = json.loads(raw.decode("utf-8") or "{}")
        except (UnicodeDecodeError, ValueError, RecursionError):
            return self._error(400, "body must be JSON")
        hub = self.app.hub
        if kind == "ingest":
            try:
                hub.ingest(body)
            except ValueError as err:
                return self._error(400, str(err))
            return self._send(204)
        if kind == "sensorlogger":
            try:
                converted = from_sensor_logger(body)  # {} for a connection test without readings
            except (ValueError, TypeError, ArithmeticError) as err:  # e.g. "time": 1e400 overflows ns -> ms
                return self._error(400, str(err) or "bad Sensor Logger push")
            simulated = _flag(query, "simulated")  # only server/simulate.py sends this flag; real data never does
            if simulated:
                converted = {simulated_name(name): samples for name, samples in converted.items()}
            self.app.sensor_logger.note(body, converted, simulated)
            count = sum(hub.ingest({"source": src, "samples": samples}) for src, samples in converted.items())
            return self._json(200, {"ok": True, "samples": count})
        on = bool(body.get("on")) if isinstance(body, dict) else False
        try:
            if on:
                return self._json(200, {"recording": True, "path": hub.start_recording()})
            return self._json(200, {"recording": False, "result": hub.stop_recording()})
        except OSError as err:
            return self._error(500, f"could not write the recording: {err}")

    def _post_walk(self) -> None:
        raw = self._read_body(WALK_MAX_BODY, "The walk is too large. The limit is 3 MB.")
        if raw is None:
            return
        if not _is_json_type(self.headers.get("Content-Type")):
            return self._error(415, "Send the walk as JSON (Content-Type: application/json).")
        try:
            body = parse_strict_json(raw)
        except ValueError:
            return self._error(400, "The walk is not valid JSON.")
        problem = validate_walk(body)
        if problem:
            return self._error(400, problem)
        try:
            created, summary = self.app.add_walk(body)
        except (sqlite3.Error, db.DatabaseClosed):
            return self._error(500, "The laptop could not save the walk. Try again.")
        if not created:
            return self._json(200, {"ok": True, "duplicate": True})
        result = body.get("result") or {}
        recording = body.get("recording") if isinstance(body.get("recording"), dict) else {}
        n = len(recording.get("samples") or []) if isinstance(recording.get("samples"), list) else 0
        self.app.log(f"[{time.strftime('%H:%M:%S')}] walk {body['id']}: speed {result.get('speed_mps')} m/s, "
                     f"quality {result.get('quality')}, {n} samples"
                     + (" (simulated)" if summary and summary.get("simulated") else ""))
        return self._json(201, {"ok": True, "id": body["id"]})

    def _post_home_results(self) -> None:
        raw = self._read_body(HOME_MAX_BODY, "Too much data. Send at most 5 MB of rows at a time.")
        if raw is None:
            return
        if not _is_json_type(self.headers.get("Content-Type")):
            return self._error(415, "Send the rows as JSON (Content-Type: application/json).")
        try:
            body = parse_strict_json(raw)
        except ValueError:
            return self._error(400, "The rows are not valid JSON.")
        rows = body.get("rows") if isinstance(body, dict) else None
        if not isinstance(rows, list):
            return self._error(400, 'Send {"rows": [...]}, the rows of rfn.homeResults.')
        if len(rows) > HOME_MAX_ROWS:
            return self._error(400, f"Too many rows. Send at most {HOME_MAX_ROWS} at a time.")
        try:
            out = self.app.db.upsert_home_results(rows)
        except (sqlite3.Error, db.DatabaseClosed):
            return self._error(500, "The laptop could not save the results. Try again.")
        return self._json(200, {"ok": True, **out})

    # -- DELETE
    def do_DELETE(self):  # noqa: N802
        path = self._split()[0].rstrip("/")
        if self.headers.get("Content-Length") not in (None, "0"):  # a body we will not read
            self.close_connection = True
        if path != "/api/walks":
            return self._error(404, "Not found.", close=self.close_connection)
        hosts = self.headers.get_all("Host") or []  # exactly one Host line (RFC 9112 section 3.2), and a local one
        if not (is_loopback(self.client_address[0]) and len(hosts) == 1 and is_local_host_header(hosts[0])):
            return self._error(403, "Only the laptop itself, at http://localhost, can clear the walks.",
                               close=self.close_connection)
        try:
            cleared = self.app.db.clear_walks()
        except (sqlite3.Error, db.DatabaseClosed):
            return self._error(500, "The walks could not be cleared. Try again.", close=self.close_connection)
        return self._json(200, {"ok": True, "cleared": cleared}, close=self.close_connection)


# -------------------------------------------------------------------------------------------------- servers

class AppServer(QuietServer):
    """gyro-starter's QuietServer (ignores the expected TLS/phone disconnect errors), tuned for one shared App."""
    daemon_threads = True
    block_on_close = False                  # never wait for open event streams when closing
    request_queue_size = 64                 # a page load opens many connections at once (default backlog is 5)
    allow_reuse_address = os.name != "nt"   # on Windows SO_REUSEADDR lets a second server share the port silently

    def __init__(self, address, app: App):
        self.app = app
        super().__init__(address, Handler)

    def server_bind(self):
        if os.name == "nt" and hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            # Without this, Windows lets this server bind 0.0.0.0:8765 while serve.py holds 127.0.0.1:8765, and
            # localhost would quietly keep reaching the other server.
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        socketserver.TCPServer.server_bind(self)  # skips HTTPServer's getfqdn(), a reverse lookup that can stall
        host, port = self.server_address[:2]
        self.server_name, self.server_port = str(host), port


class AppServer6(AppServer):
    address_family = socket.AF_INET6


def _bind(host: str, port: int, app: App, ssl_context: ssl.SSLContext | None = None) -> AppServer:
    server = (AppServer6 if ":" in host else AppServer)((host, port), app)
    if ssl_context is not None:
        # As gyro-starter does: handshake lazily in the connection's own thread, so one slow client (or one
        # that rejects the self-signed certificate) cannot block accept().
        server.socket = ssl_context.wrap_socket(server.socket, server_side=True, do_handshake_on_connect=False)
    return server


def _lan_ips_for(host: str) -> list[str]:
    if host in ("", "0.0.0.0", "::"):
        return lan_ips()
    try:
        if ipaddress.ip_address(host).is_loopback:
            return []
    except ValueError:
        return [] if host == "localhost" else [host]
    return [host]


def build_info(http_port: int, https_port: int | None, ips: list[str], db_path: str) -> dict:
    """GET /api/info. Phone pages need HTTPS (phones give motion data only to secure pages), so with HTTPS off
    there are no phone URLs. Sensor Logger is an app, not a browser, so its plain-HTTP URL always works."""
    hosts = [_url_host(ip) for ip in ips]
    https_on = https_port is not None
    return {
        "phoneUrls": [f"https://{h}:{https_port}/motion/walk.html" for h in hosts] if https_on else [],
        "gyroPhoneUrls": [f"https://{h}:{https_port}/gyro/phone.html" for h in hosts] if https_on else [],
        "sensorLoggerUrls": [f"http://{h}:{http_port}/sensorlogger" for h in hosts],
        "laptopUrl": f"http://localhost:{http_port}/",
        "gyroScreenUrl": f"http://localhost:{http_port}/gyro/screen.html",
        "walkReceiveUrl": f"http://localhost:{http_port}/motion/receive.html",
        "httpPort": http_port,
        "httpsPort": https_port,
        "db": db_path,
    }


class Servers:
    """What make_servers returns: the shared App and the listeners (already serving)."""

    def __init__(self, app: App, http: AppServer, https: AppServer | None, ips: list[str]):
        self.app, self.http, self.https, self.ips = app, http, https, ips
        self._stopped = False

    @property
    def http_port(self) -> int:
        return self.http.server_address[1]

    @property
    def https_port(self) -> int | None:
        return self.https.server_address[1] if self.https else None

    @property
    def info(self) -> dict:
        return self.app.info

    def stop(self) -> dict | None:
        """End event streams, stop listening, close any CSV recording and the database. Returns the recording info."""
        if self._stopped:
            return None
        self._stopped = True
        self.app.stopping.set()
        self.app.walk_feed.close()
        listeners = [s for s in (self.http, self.https) if s is not None]
        for s in listeners:
            s.shutdown()
        for s in listeners:
            s.server_close()
        recording = self.app.hub.stop_recording()
        self.app.db.close()
        return recording


def make_servers(db_path: str = DEFAULT_DB, *, host: str = "0.0.0.0", port: int = DEFAULT_HTTP_PORT,
                 https_port: int | None = DEFAULT_HTTPS_PORT, recordings_dir: str | None = None,
                 app_dir: str = APP_DIR, gyro_dir: str = GYRO_STATIC_DIR, motion_dir: str = MOTION_WEB_DIR,
                 cert_dir: str = CERT_DIR, session_gap_s: float = db.SESSION_GAP_S,
                 ping_interval_s: float = PING_INTERVAL_S, ips: list[str] | None = None, log=None) -> Servers:
    """Open the database, bind HTTP (and HTTPS unless https_port is None), and start serving.

    Port 0 picks a free port (tests). ips overrides LAN address discovery (tests). recordings_dir defaults to
    recordings/ next to the database (data/recordings). Raises OSError if a port is in use.
    """
    database = db.Database(db_path, session_gap_s=session_gap_s)
    try:
        recordings_dir = recordings_dir or os.path.join(os.path.dirname(database.path), "recordings")
        hub = DbHub(database, recordings_dir, log=log)
        discover = ips is None  # tests pass fixed addresses; real runs look them up again for /api/info
        ips = _lan_ips_for(host) if discover else list(ips)
        blocked = (os.path.dirname(database.path), recordings_dir, cert_dir, HERE, DATA_DIR,
                   os.path.join(MOTION_DIR, "data"), os.path.join(MOTION_DIR, ".certs"),
                   os.path.join(GYRO_DIR, ".certs"), os.path.join(GYRO_DIR, "recordings"))
        app = App(database, hub, app_dir=app_dir, gyro_dir=gyro_dir, motion_dir=motion_dir, blocked=blocked,
                  ping_interval_s=ping_interval_s, log=log)
        http = _bind(host, port, app)
        https = None
        try:
            if https_port is not None:
                cert, key = ensure_cert(cert_dir, ["localhost", "127.0.0.1", "::1", *ips])
                ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
                ctx.load_cert_chain(cert, key)
                https = _bind(host, https_port, app, ctx)
        except BaseException:
            http.server_close()
            raise
    except BaseException:
        database.close()
        raise
    app.https = https is not None
    app.info = build_info(http.server_address[1], https.server_address[1] if https else None, ips, database.path)
    if discover:
        app.ips_fn = lambda: _lan_ips_for(host)
    for s in (http, https):
        if s is not None:
            threading.Thread(target=s.serve_forever, kwargs={"poll_interval": 0.25}, daemon=True).start()
    return Servers(app, http, https, ips)


# ---------------------------------------------------------------------------------------------- command line

def banner_lines(servers: Servers) -> list[str]:
    info, port = servers.info, servers.http_port
    lines = ["One server for the whole app is running. Everything that arrives is saved to the database.",
             f"  App (laptop): http://localhost:{port}/",
             f"  Motion screen (laptop): {info['gyroScreenUrl']}",
             f"  Walk results (laptop): {info['walkReceiveUrl']}"]
    if servers.https is not None:
        if info["gyroPhoneUrls"]:
            lines += [f"  Phone motion stream: {u}  (accept the certificate warning once)" for u in info["gyroPhoneUrls"]]
            lines += [f"  Phone walk test: {u}" for u in info["phoneUrls"]]
        else:
            lines += [f"  Phone motion stream: no network address found. Join the phone and laptop to the same "
                      f"Wi-Fi, then open https://<laptop-ip>:{servers.https_port}/gyro/phone.html",
                      f"  Phone walk test: https://<laptop-ip>:{servers.https_port}/motion/walk.html"]
    else:
        lines.append("  Phone pages: off (--no-https). Phones give motion data only to HTTPS pages.")
    for u in info["sensorLoggerUrls"] or [f"http://<laptop-ip>:{port}/sensorlogger"]:
        lines.append(f"  Sensor Logger HTTP push URL (AirPods, Watch, phone): {u}")
    ports = f"{port},{servers.https_port}" if servers.https is not None else f"{port}"
    lines += [f"  Database: {servers.app.db.path}",
              "  " + FIREWALL_HINT.format(ports=ports),
              f"  Try it without hardware: python server/simulate.py --url http://localhost:{port} --walk",
              "  Stop with Ctrl+C."]
    return lines


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(prog="run.py", description="One server for the whole app: the app, the phone "
                                "pages, AirPods/Watch/phone motion and walk tests, all logged to a local database.")
    p.add_argument("--port", type=int, default=DEFAULT_HTTP_PORT, help="plain HTTP port: the laptop (default 8765)")
    p.add_argument("--https-port", type=int, default=DEFAULT_HTTPS_PORT, help="HTTPS port: phones (default 8443)")
    p.add_argument("--no-https", action="store_true", help="serve plain HTTP only (phone pages will not get motion)")
    p.add_argument("--host", default="0.0.0.0", help="interface to listen on (default: all)")
    p.add_argument("--db", default=DEFAULT_DB, help="SQLite database file (default data/rfn.sqlite)")
    p.add_argument("--recordings-dir", default=None, help="CSV recordings folder (default: recordings/ next to --db)")
    p.add_argument("--session-gap", type=float, default=db.SESSION_GAP_S,
                   help="seconds without samples that end a stream session (default 20)")
    return p.parse_args(argv)


def _raise_interrupt(signum, frame):
    raise KeyboardInterrupt


def safe_console() -> None:
    """Device names and walk results come from phones and can hold any character (an emoji, Cyrillic). When the
    output goes to a file or pipe, Windows uses cp1252 and print() would raise UnicodeEncodeError, which stopped the
    whole server. Write such characters as \\u escapes instead."""
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(errors="backslashreplace")
        except (AttributeError, ValueError, OSError):
            pass


def console_log(line: str) -> None:
    """Print one console line; a console that is closed or cannot show a character never stops the server."""
    try:
        print(line, flush=True)
    except (OSError, ValueError, UnicodeError):
        pass


def _ensure_data_gitignore(db_path: str) -> None:
    """Keep the project's data/ folder (database, recordings) out of git: data/.gitignore with '*'."""
    folder = os.path.dirname(os.path.abspath(db_path))
    if os.path.normcase(folder) != os.path.normcase(DATA_DIR):
        return
    path = os.path.join(folder, ".gitignore")
    if not os.path.exists(path):
        try:
            os.makedirs(folder, exist_ok=True)
            with open(path, "w", encoding="utf-8") as f:
                f.write("# Local database and sensor recordings: never committed.\n*\n")
        except OSError:
            pass


def serve(args: argparse.Namespace) -> int:
    """Run until Ctrl+C (or Ctrl+Break / SIGTERM), then shut down cleanly. Returns the exit code."""
    safe_console()
    for name in ("SIGTERM", "SIGBREAK"):  # Ctrl+C is SIGINT, which Python already turns into KeyboardInterrupt
        sig = getattr(signal, name, None)
        if sig is not None:
            try:
                signal.signal(sig, _raise_interrupt)
            except (ValueError, OSError):
                pass
    log = console_log
    servers = None
    try:
        try:
            _ensure_data_gitignore(args.db)
            servers = make_servers(args.db, host=args.host, port=args.port,
                                   https_port=None if args.no_https else args.https_port,
                                   recordings_dir=args.recordings_dir, session_gap_s=args.session_gap, log=log)
        except OSError as err:
            print(f"Could not start: {err}. Another server may be using port {args.port} or {args.https_port} "
                  "(for example serve.py, gyro-starter or motion/server.py). Stop it, or pick other ports with "
                  "--port and --https-port.", file=sys.stderr, flush=True)
            return 1
        except sqlite3.Error as err:
            print(f"Could not open the database {args.db}: {err}", file=sys.stderr, flush=True)
            return 1
        for line in banner_lines(servers):
            log(line)
        last: dict[str, int] = {}
        last_t = time.time()
        while True:
            for _ in range(5):  # one-second sleeps, so Ctrl+Break and SIGTERM are handled promptly too
                time.sleep(1)
            snap = servers.app.hub.snapshot()
            now = time.time()
            parts = []
            for name, st in snap["sources"].items():
                if st["seconds_since_last"] < 5:
                    parts.append(f"{name}: {(st['samples'] - last.get(name, 0)) / (now - last_t):.0f} Hz")
                last[name] = st["samples"]
            last_t = now
            if parts:
                rec = " | recording CSV" if snap["recording"] else ""
                log(f"[{time.strftime('%H:%M:%S')}] " + ", ".join(parts)
                    + f" | saved this run: {servers.app.db.samples_written} samples | viewers: {snap['viewers']}{rec}")
    except KeyboardInterrupt:
        pass
    finally:
        if servers is not None:
            log("Stopping...")
            recording = servers.stop()
            if recording:
                log(f"Saved {recording['rows']} rows to {recording['path']}")
            log(f"Stopped. The data is in {servers.app.db.path}")
    return 0


def main(argv: list[str] | None = None) -> int:
    return serve(parse_args(argv))


if __name__ == "__main__":
    sys.exit(main())
