#!/usr/bin/env python3
"""Phone walking test server (motion/CONTRACT.md, section 5 and "URLs").

    phone  https://<laptop LAN IP>:8453/motion/walk.html  --POST /api/walks-->  this server
    laptop http://localhost:8090/motion/receive.html       <--GET /api/events (Server-Sent Events)--

It measures walking speed, not ALS. The server only stores and relays walks; analysis runs in the pages.

    python motion/server.py [--port 8090] [--https-port 8453] [--no-https] [--host 0.0.0.0]
                            [--data-dir DIR] [--app-dir DIR]

Standard library only, plus the 'cryptography' package to make the self-signed certificate
(phones give motion data only to secure pages, and a clicked-through self-signed HTTPS page counts).

Paths: /motion/<path> serves motion/web/<path>; every other path serves app/<path> read-only, and /
gives app/index.html, so the laptop page shares an origin (and localStorage) with the app.
Walks are kept in memory (last 500) and appended to motion/data/walks.jsonl, one JSON object per line.

Several small helpers are copied from gyro-starter/server.py (same project) and credited where they appear.
"""
from __future__ import annotations

import argparse
import datetime as dt
import ipaddress
import json
import math
import os
import queue
import re
import socket
import socketserver
import ssl
import sys
import threading
import time
from collections import OrderedDict
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote

HERE = os.path.dirname(os.path.abspath(__file__))           # .../motion
PROJECT_DIR = os.path.dirname(HERE)                          # project folder
DEFAULT_APP_DIR = os.path.join(PROJECT_DIR, "app")
DEFAULT_WEB_DIR = os.path.join(HERE, "web")
DEFAULT_DATA_DIR = os.path.join(HERE, "data")
DEFAULT_CERT_DIR = os.path.join(HERE, ".certs")
SERVER_FILE = os.path.abspath(__file__)

DEFAULT_HTTP_PORT = 8090
DEFAULT_HTTPS_PORT = 8453

# "At most 3 MB" (contract section 5). Read as 3 MiB, the more lenient reading, so a phone that counts
# 3 MB as 3,000,000 bytes is never refused. 20000 samples at about 120 bytes each is about 2.4 MB.
MAX_BODY = 3 * 1024 * 1024
MAX_SAMPLES = 20000
MAX_WALKS = 500                  # walks kept in memory; the JSONL file keeps everything
PING_INTERVAL_S = 15.0           # ": ping" comment on idle event streams
JSONL_NAME = "walks.jsonl"
WALK_KIND = "rfn-walk"
ID_RE = re.compile(r"[A-Za-z0-9_-]{6,64}")   # used with fullmatch: "$" would also accept a trailing newline

MIME = {
    ".html": "text/html; charset=utf-8",
    ".htm": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".txt": "text/plain; charset=utf-8",
    ".csv": "text/csv; charset=utf-8",
    ".woff2": "font/woff2",
    ".map": "application/json",
}

FIREWALL_HINT = ('If the phone cannot connect, the Windows firewall must allow Python. In an admin PowerShell run: '
                 'New-NetFirewallRule -DisplayName "Phone walk test" -Direction Inbound -Protocol TCP '
                 '-LocalPort {ports} -Action Allow')


# ----------------------------------------------------------------------------------------------- validation

def _reject_constant(name: str):
    """json.loads hook: NaN and Infinity are not JSON, and a browser's JSON.parse would choke on them later."""
    raise ValueError(f"{name} is not allowed in JSON")


def _finite_float(text: str) -> float:
    """json.loads hook (reviewer fix): Python reads 1e400 as inf, and json.dumps would write it back as
    Infinity, which a browser's JSON.parse refuses. One such walk made every GET /api/walks unreadable."""
    value = float(text)
    if not math.isfinite(value):
        raise ValueError(f"{text} is too large for a number")
    return value


def parse_json(raw: bytes):
    """Parse a request body or a JSONL line. Raises ValueError for anything that is not strict JSON,
    and for numbers too large to be a finite float."""
    try:
        return json.loads(raw.decode("utf-8"), parse_constant=_reject_constant, parse_float=_finite_float)
    except (UnicodeDecodeError, RecursionError) as err:  # RecursionError: absurdly deep nesting
        raise ValueError(str(err)) from None


def valid_id(value) -> bool:
    return isinstance(value, str) and ID_RE.fullmatch(value) is not None


def _is_number(value) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def validate_walk(body) -> str | None:
    """Return None if body is an acceptable walk (contract section 5), else one plain-words error sentence.

    Contract checks: kind exact, id pattern, distance_m 1 to 100, result an object, recording at most 20000
    samples. Gap filled here: a recording that is present must be an object (null counts as no recording),
    and its samples, if present, must be a list. Other fields (v, createdAt, placement, device) pass through.
    """
    if not isinstance(body, dict):
        return "The walk must be a JSON object."
    if body.get("kind") != WALK_KIND:
        return 'This is not a walk. The kind must be "rfn-walk".'
    if not valid_id(body.get("id")):
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
        if isinstance(samples, list) and len(samples) > MAX_SAMPLES:
            return f"The recording is too long. It has over {MAX_SAMPLES} samples. Record a shorter walk."
    return None


def summarize(record: dict) -> dict:
    """A summary is the record without "recording", plus "hasRecording" (contract section 5).

    Reviewer fix (F5): if the recording says "simulated": true (synth.js), the summary says so too. Without
    it the label was lost with "recording", and a simulated walk looked real in the laptop page's list.
    """
    out = {k: v for k, v in record.items() if k != "recording"}
    recording = record.get("recording")
    out["hasRecording"] = isinstance(recording, dict)
    if out["hasRecording"] and recording.get("simulated") is True:
        out["simulated"] = True
    return out


def is_loopback(address) -> bool:
    """True only for a client on this laptop (127.x.x.x or ::1, also IPv4-mapped). Gates DELETE /api/walks."""
    if not isinstance(address, str) or not address:
        return False
    try:
        ip = ipaddress.ip_address(address.split("%", 1)[0])  # drop an IPv6 zone such as "%3"
    except ValueError:
        return False
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    return ip.is_loopback


# A Host header that names this laptop: localhost, 127.0.0.1 or [::1] with any port, or a bare ::1.
LOCAL_HOST_RE = re.compile(r"(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?|::1", re.IGNORECASE)


def is_local_host_header(value) -> bool:
    """True only when a Host header names this laptop. Gates DELETE /api/walks, with is_loopback.

    Reviewer fix (F9): a tunnel such as localhost.run, or a DNS-rebinding page, reaches the server from a
    loopback address but sends its own name in Host. Only DELETE checks this: the tunnel still serves pages.
    """
    return isinstance(value, str) and LOCAL_HOST_RE.fullmatch(value.strip()) is not None


def _utc_iso() -> str:
    """Like JavaScript's toISOString(): 2026-11-08T12:12:03.120Z."""
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _plain(value, limit: int = 40) -> str:
    """A short ASCII-only form of a client-sent value for the console line (Windows pipes are cp1252)."""
    text = str(value)[:limit]
    return text.encode("ascii", "backslashreplace").decode("ascii")


def _dumps(obj) -> bytes:
    return json.dumps(obj, separators=(",", ":")).encode("utf-8")  # ASCII only, so one walk is one line


# ------------------------------------------------------------------------------------------------------ hub

class Hub:
    """Walks shared by the HTTP and HTTPS listeners: memory (last 500), walks.jsonl, and event-stream clients."""

    def __init__(self, data_dir: str = DEFAULT_DATA_DIR, max_walks: int = MAX_WALKS):
        self.data_dir = data_dir
        self.path = os.path.join(data_dir, JSONL_NAME)
        self.max_walks = max_walks
        self.ping_interval_s = PING_INTERVAL_S
        self.skipped_lines = 0
        self._lock = threading.Lock()
        self._walks: OrderedDict[str, dict] = OrderedDict()   # id -> record, oldest first
        self._ids: set[str] = set()      # every id in the current walks.jsonl, so duplicates stay out of the file
        self._clients: set[queue.Queue] = set()
        self._needs_newline = False      # the file ends in a cut-off line; start the next record on a new line
        os.makedirs(data_dir, exist_ok=True)
        self._load()

    # -- file
    def _load(self) -> None:
        """Read walks.jsonl (oldest first). Lines that are not a JSON object with a valid, new id are skipped."""
        last = b""
        try:
            f = open(self.path, "rb")  # binary, so one corrupt byte skips one line rather than the whole file
        except FileNotFoundError:
            return
        with f:
            for line in f:
                last = line
                if not line.strip():
                    continue
                try:
                    rec = parse_json(line)
                except ValueError:
                    self.skipped_lines += 1
                    continue
                if not isinstance(rec, dict) or not valid_id(rec.get("id")) or rec["id"] in self._ids:
                    self.skipped_lines += 1
                    continue
                self._remember(rec)
        self._needs_newline = bool(last) and not last.endswith(b"\n")  # cut off mid-line, e.g. by a crash

    def _remember(self, rec: dict) -> None:
        self._ids.add(rec["id"])
        self._walks[rec["id"]] = rec
        while len(self._walks) > self.max_walks:
            self._walks.popitem(last=False)

    # -- walks
    def add(self, body: dict) -> tuple[bool, dict]:
        """Store a validated walk. Returns (True, record) if new, (False, existing-or-None) for a duplicate id.

        Raises OSError if the line cannot be written; then nothing is kept in memory either.
        """
        record = dict(body)
        record["receivedAt"] = _utc_iso()
        line = _dumps(record) + b"\n"
        with self._lock:
            if record["id"] in self._ids:
                return False, self._walks.get(record["id"])
            with open(self.path, "ab") as f:  # opened per write: Windows cannot rename a file held open
                if self._needs_newline:
                    f.write(b"\n")
                f.write(line)
                f.flush()
                os.fsync(f.fileno())
            self._needs_newline = False
            self._remember(record)
            summary = _dumps(summarize(record))
            for q in self._clients:  # inside the lock, so every client sees walks in the stored order
                q.put_nowait(summary)
        return True, record

    def summaries(self) -> list[dict]:
        with self._lock:
            return [summarize(r) for r in reversed(self._walks.values())]  # newest first

    def get(self, walk_id: str) -> dict | None:
        with self._lock:
            return self._walks.get(walk_id)

    def count(self) -> int:
        with self._lock:
            return len(self._walks)

    def clear(self) -> tuple[int, str | None]:
        """Rename walks.jsonl to walks-<timestamp>.jsonl.bak (never delete) and empty memory."""
        with self._lock:
            cleared = len(self._walks)
            backup = None
            if os.path.exists(self.path):
                stamp = time.strftime("%Y%m%dT%H%M%S")
                backup = os.path.join(self.data_dir, f"walks-{stamp}.jsonl.bak")
                n = 2
                while os.path.exists(backup):
                    backup = os.path.join(self.data_dir, f"walks-{stamp}-{n}.jsonl.bak")
                    n += 1
                os.rename(self.path, backup)
            self._walks.clear()
            self._ids.clear()
            self._needs_newline = False
        return cleared, backup

    # -- event-stream clients (one queue each)
    def subscribe(self) -> tuple[queue.Queue, int]:
        """Register a client; returns its queue and the walk count, taken together so no walk is missed."""
        q: queue.Queue = queue.Queue()
        with self._lock:
            self._clients.add(q)
            return q, len(self._walks)

    def unsubscribe(self, q: queue.Queue) -> None:
        with self._lock:
            self._clients.discard(q)

    def client_count(self) -> int:
        with self._lock:
            return len(self._clients)

    def close(self) -> None:
        """End every open event stream (used on shutdown)."""
        with self._lock:
            for q in self._clients:
                q.put_nowait(None)


# --------------------------------------------------------------------------------------------- static files

def _inside(path: str, root: str) -> bool:
    try:
        return os.path.commonpath([os.path.normcase(path), os.path.normcase(root)]) == os.path.normcase(root)
    except ValueError:  # different drives on Windows
        return False


def resolve_static(raw_path: str, app_dir: str, web_dir: str, blocked: tuple[str, ...] = ()) -> tuple[int, str | None]:
    """Map a request path (query already removed) to a file: (200, file), (403, None) or (404, None).

    The path is percent-decoded exactly once. Any ".." segment, backslash, NUL, colon (drive letters, NTFS
    streams) or a non-absolute path is refused with 403. The resolved real path must sit inside its root and
    outside every blocked path (data, certificates, this file). Directories give their index.html, never a list.
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
        if seg == ".." or ":" in seg:
            return 403, None
        parts.append(seg)
    if parts and parts[0] == "motion":
        root, parts = web_dir, parts[1:]
    else:
        root = app_dir
    root = os.path.realpath(root)
    full = os.path.realpath(os.path.join(root, *parts))
    if os.path.isdir(full):
        full = os.path.realpath(os.path.join(full, "index.html"))
    if not _inside(full, root):  # also catches a symbolic link that points outside the root
        return 403, None
    for b in blocked:
        if b and (_inside(full, b) or os.path.normcase(full) == os.path.normcase(b)):
            return 403, None
    if not os.path.isfile(full):
        return 404, None
    return 200, full


# ------------------------------------------------------------------------------------------------- handler

def _is_json_type(value: str | None) -> bool:
    media = (value or "").split(";", 1)[0].strip().lower()
    return media == "application/json" or (media.startswith("application/") and media.endswith("+json"))


def make_handler(hub: Hub, app_dir: str, web_dir: str, info, blocked: tuple[str, ...], log=None):
    """info is the GET /api/info body, or a function that returns it (make_servers works it out per request)."""
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"   # keep-alive, so the phone's POSTs reuse one TLS connection
        server_version = "PhoneWalkTest/1.0"
        timeout = 60                    # idle or stalled connections close after a minute

        def log_message(self, format, *args):  # noqa: A002 - quiet console; main() prints one line per walk
            pass

        def end_headers(self):
            # Every reply, including the stdlib's own error pages, gets no-store; every GET /api/* gets CORS.
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            if getattr(self, "command", None) == "GET" and getattr(self, "path", "").startswith("/api/"):
                self.send_header("Access-Control-Allow-Origin", "*")
            super().end_headers()

        def _send(self, code: int, body: bytes = b"", ctype: str = "text/plain; charset=utf-8",
                  close: bool = False) -> None:
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            if close:
                self.send_header("Connection", "close")  # also sets self.close_connection
            self.end_headers()
            if body and self.command != "HEAD":
                self.wfile.write(body)

        def _json(self, code: int, obj, close: bool = False) -> None:
            self._send(code, _dumps(obj), "application/json", close)

        def _error(self, code: int, message: str, close: bool = False) -> None:
            self._json(code, {"ok": False, "error": message}, close)

        def _route(self) -> str:
            path = self.path.split("?", 1)[0].split("#", 1)[0]
            if path.startswith("/api/") and len(path) > 5:
                path = path.rstrip("/") or "/"
            return path

        # -- GET / HEAD
        def do_GET(self):  # noqa: N802
            path = self._route()
            if path.startswith("/api/"):
                if path == "/api/walks":
                    return self._json(200, {"walks": hub.summaries()})
                if path.startswith("/api/walks/"):
                    walk_id = path[len("/api/walks/"):]
                    rec = hub.get(walk_id) if valid_id(walk_id) else None
                    if rec is None:
                        return self._error(404, "No walk with that id.")
                    return self._json(200, rec)
                if path == "/api/events":
                    return self._events()
                if path == "/api/info":
                    return self._json(200, info() if callable(info) else info)
                return self._error(404, "Not found.")
            return self._static(path)

        def do_HEAD(self):  # noqa: N802
            path = self._route()
            if path.startswith("/api/"):
                return self._send(405, b"Use GET.")
            return self._static(path)

        def _static(self, path: str) -> None:
            status, full = resolve_static(path, app_dir, web_dir, blocked)
            if status == 403:
                return self._send(403, b"Not allowed.")
            if status != 200:
                return self._send(404, b"Not found.")
            try:
                with open(full, "rb") as f:
                    body = f.read()
            except OSError:
                return self._send(404, b"Not found.")
            ctype = MIME.get(os.path.splitext(full)[1].lower(), "application/octet-stream")
            return self._send(200, body, ctype)

        def _events(self) -> None:
            q, count = hub.subscribe()
            try:
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream; charset=utf-8")
                self.send_header("Connection", "close")  # the stream ends when the connection closes
                self.send_header("X-Accel-Buffering", "no")
                self.end_headers()
                self.wfile.write(b"retry: 2000\n\nevent: hello\ndata: " + _dumps({"walks": count}) + b"\n\n")
                while True:
                    try:
                        item = q.get(timeout=hub.ping_interval_s)
                    except queue.Empty:
                        self.wfile.write(b": ping\n\n")  # also how a closed client is noticed
                        continue
                    if item is None:  # the server is stopping
                        break
                    self.wfile.write(b"event: walk\ndata: " + item + b"\n\n")
            except OSError:  # includes ssl.SSLError and connection resets: the viewer went away
                pass
            finally:
                hub.unsubscribe(q)

        # -- body helpers
        def _content_length(self) -> int | None:
            """The body length, or None after replying with an error (411, 400 or 413)."""
            raw = self.headers.get("Content-Length")
            if raw is None:
                self._error(411, "Send the walk with a Content-Length header.", close=True)
                return None
            try:
                length = int(raw.strip())
            except ValueError:
                length = -1
            if length < 0:
                self._error(400, "The Content-Length header is not a number.", close=True)
                return None
            if length > MAX_BODY:  # refused before reading the body
                self._error(413, "The walk is too large. The limit is 3 MB.", close=True)
                return None
            return length

        def _read_body(self, length: int) -> bytes | None:
            raw = self.rfile.read(length) if length else b""
            if len(raw) < length:
                self._error(400, "The upload was cut off. Try again.", close=True)
                return None
            return raw

        # -- POST
        def do_POST(self):  # noqa: N802
            path = self._route()
            if path != "/api/walks":
                return self._error(404, "Not found.", close=True)  # body left unread, so drop the connection
            length = self._content_length()
            if length is None:
                return
            json_type = _is_json_type(self.headers.get("Content-Type"))
            raw = self._read_body(length)  # read even when refusing, so a keep-alive connection stays in step
            if raw is None:
                return
            if not json_type:
                return self._error(415, "Send the walk as JSON (Content-Type: application/json).")
            try:
                body = parse_json(raw)
            except ValueError:
                return self._error(400, "The walk is not valid JSON.")
            problem = validate_walk(body)
            if problem:
                return self._error(400, problem)
            try:
                created, record = hub.add(body)
            except OSError:
                return self._error(500, "The laptop could not save the walk. Check its disk, then try again.")
            if not created:
                return self._json(200, {"ok": True, "duplicate": True})
            self._json(201, {"ok": True, "id": record["id"]})
            if log:  # after the reply (reviewer fix), so a console that cannot print never costs the phone its 201
                try:
                    result, rec = record["result"], record.get("recording")
                    n = len(rec["samples"]) if isinstance(rec, dict) and isinstance(rec.get("samples"), list) else 0
                    log(f"[{time.strftime('%H:%M:%S')}] walk {record['id']}: speed {_plain(result.get('speed_mps'))} "
                        f"m/s, quality {_plain(result.get('quality'))}, {n} samples")
                except Exception:  # noqa: BLE001 - e.g. UnicodeEncodeError on a piped cp1252 stdout, or a closed console
                    pass
            return None

        # -- DELETE
        def do_DELETE(self):  # noqa: N802
            path = self._route()
            if self.headers.get("Content-Length") not in (None, "0"):  # a body we will not read
                self.close_connection = True
            if path != "/api/walks":
                return self._error(404, "Not found.", close=self.close_connection)
            if not is_loopback(self.client_address[0]) or not is_local_host_header(self.headers.get("Host")):
                return self._error(403, "Only the laptop itself can clear the walks.", close=self.close_connection)
            try:
                cleared, _backup = hub.clear()
            except OSError:
                return self._error(500, "The walks file could not be renamed. Close any program using it.",
                                   close=self.close_connection)
            return self._json(200, {"ok": True, "cleared": cleared}, close=self.close_connection)

    return Handler


# -------------------------------------------------------------------------------------------------- servers

class QuietServer(ThreadingHTTPServer):
    """ThreadingHTTPServer tuned for phones on a LAN. handle_error is copied from gyro-starter/server.py."""
    daemon_threads = True
    block_on_close = False          # do not wait for open event streams when closing
    request_queue_size = 64         # listen backlog: a phone opens several connections at once (default is 5)
    allow_reuse_address = os.name != "nt"   # on Windows SO_REUSEADDR lets a second copy share the port silently

    def server_bind(self):
        if os.name == "nt" and hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        # Skip HTTPServer.server_bind's socket.getfqdn(), a reverse DNS lookup that can stall start-up.
        socketserver.TCPServer.server_bind(self)
        host, port = self.server_address[:2]
        self.server_name, self.server_port = str(host), port

    def handle_error(self, request, client_address):
        # Copied from gyro-starter/server.py: browsers abort TLS handshakes while showing the self-signed
        # certificate warning, and phones drop connections when the screen locks. Those are expected; anything
        # else still prints a traceback.
        if isinstance(sys.exc_info()[1], OSError):
            return
        super().handle_error(request, client_address)


class QuietServer6(QuietServer):
    address_family = socket.AF_INET6


def _make_server(host: str, port: int, handler, ssl_context: ssl.SSLContext | None = None) -> QuietServer:
    cls = QuietServer6 if ":" in host else QuietServer
    server = cls((host, port), handler)
    if ssl_context is not None:
        # From gyro-starter/server.py: handshake lazily in the connection's own thread, so one slow client
        # (or one that rejects the certificate) cannot block accept().
        server.socket = ssl_context.wrap_socket(server.socket, server_side=True, do_handshake_on_connect=False)
    return server


def lan_ips() -> list[str]:
    """IPv4 addresses a phone on the same network might reach this laptop on. Copied from gyro-starter/server.py."""
    ips: set[str] = set()
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("192.0.2.1", 9))  # no packet is sent; this just picks the outgoing interface
            ips.add(s.getsockname()[0])
    except OSError:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ips.add(info[4][0])
    except OSError:
        pass
    return sorted(ip for ip in ips if not ip.startswith(("127.", "169.254.", "0.")))


def ensure_cert(cert_dir: str, hosts: list[str]) -> tuple[str, str]:
    """Reuse or create a self-signed certificate naming every host/IP in hosts.

    Copied from gyro-starter/server.py with two changes: it raises RuntimeError instead of exiting when
    'cryptography' is missing, and it also remakes a certificate that expires within a day. A new LAN IP
    (not covered by hosts.json) makes a new certificate.
    """
    cert_path = os.path.join(cert_dir, "cert.pem")
    key_path = os.path.join(cert_dir, "key.pem")
    hosts_path = os.path.join(cert_dir, "hosts.json")
    try:
        from cryptography import x509
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import rsa
        from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID
    except ImportError:
        raise RuntimeError("HTTPS needs the 'cryptography' package (pip install cryptography), "
                           "or run with --no-https.") from None
    now = dt.datetime.now(dt.timezone.utc)
    try:
        with open(hosts_path, encoding="utf-8") as f:
            covered = set(json.load(f))
        if set(hosts) <= covered and os.path.isfile(key_path):
            with open(cert_path, "rb") as f:
                old = x509.load_pem_x509_certificate(f.read())
            if old.not_valid_after_utc > now + dt.timedelta(days=1):
                return cert_path, key_path
    except (OSError, ValueError, TypeError):
        pass

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "phone walk test self-signed")])
    alt_names: list = []
    for h in dict.fromkeys(hosts):
        try:
            alt_names.append(x509.IPAddress(ipaddress.ip_address(h)))
        except ValueError:
            alt_names.append(x509.DNSName(h))
    cert = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - dt.timedelta(minutes=5))
        .not_valid_after(now + dt.timedelta(days=397))  # Apple rejects TLS certificates valid for too long
        .add_extension(x509.SubjectAlternativeName(alt_names), critical=False)
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .add_extension(x509.KeyUsage(digital_signature=True, key_encipherment=True, content_commitment=False,
                                     data_encipherment=False, key_agreement=False, key_cert_sign=False,
                                     crl_sign=False, encipher_only=False, decipher_only=False), critical=True)
        .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]), critical=False)
        .add_extension(x509.SubjectKeyIdentifier.from_public_key(key.public_key()), critical=False)
        .sign(key, hashes.SHA256())
    )
    os.makedirs(cert_dir, exist_ok=True)
    with open(key_path, "wb") as f:
        f.write(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.TraditionalOpenSSL,
                                  serialization.NoEncryption()))
    with open(cert_path, "wb") as f:
        f.write(cert.public_bytes(serialization.Encoding.PEM))
    with open(hosts_path, "w", encoding="utf-8") as f:
        json.dump(sorted(set(hosts)), f)
    return cert_path, key_path


class Servers:
    """What make_servers returns: the shared hub, the listeners (already serving) and the /api/info body
    at start-up (what main prints; GET /api/info works the phone address out again on each request)."""

    def __init__(self, hub: Hub, http: QuietServer, https: QuietServer | None, info: dict, ips: list[str]):
        self.hub, self.http, self.https, self.info, self.ips = hub, http, https, info, ips

    @property
    def http_port(self) -> int:
        return self.http.server_address[1]

    @property
    def https_port(self) -> int | None:
        return self.https.server_address[1] if self.https else None

    def stop(self) -> None:
        self.hub.close()
        for s in (self.http, self.https):
            if s is not None:
                s.shutdown()
                s.server_close()


def make_servers(app_dir: str = DEFAULT_APP_DIR, web_dir: str = DEFAULT_WEB_DIR, data_dir: str = DEFAULT_DATA_DIR,
                 host: str = "0.0.0.0", port: int = DEFAULT_HTTP_PORT, https_port: int | None = DEFAULT_HTTPS_PORT,
                 cert_dir: str = DEFAULT_CERT_DIR, *, ips: list[str] | None = None, log=None) -> Servers:
    """Start the HTTP listener, and the HTTPS one unless https_port is None, sharing one Hub.

    Port 0 picks a free port (tests). ips overrides LAN IP discovery (tests), and then /api/info keeps that
    list. Raises OSError if a port is in use and RuntimeError if HTTPS is wanted but 'cryptography' is missing.
    """
    hub = Hub(data_dir)
    live = ips is None
    ips = lan_ips() if live else list(ips)
    info: dict = {"phoneUrls": [], "laptopUrl": "", "httpPort": None, "httpsPort": None}
    blocked = tuple(os.path.realpath(p) for p in (data_dir, cert_dir, SERVER_FILE))

    def current_info() -> dict:
        """The GET /api/info body. Reviewer fix (F6, F3): the phone address is worked out again on each request,
        so after the laptop joins another network (say the phone's hotspot), reloading the laptop page shows
        the new address without a restart. The certificate still names only the start-up addresses, so the
        phone shows its certificate warning again; accepting it once more is enough."""
        out = dict(info)
        if live and info["httpsPort"] is not None:
            try:
                now = lan_ips()
            except Exception:  # noqa: BLE001 - never a 500 here; the start-up address is the best guess
                now = ips
            out["phoneUrls"] = _phone_urls(now, info["httpsPort"])
        return out

    handler = make_handler(hub, app_dir, web_dir, current_info, blocked, log)

    http = _make_server(host, port, handler)
    https = None
    try:
        if https_port is not None:
            cert, key = ensure_cert(cert_dir, ["localhost", "127.0.0.1", "::1", *ips])
            ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            ctx.load_cert_chain(cert, key)
            https = _make_server(host, https_port, handler, ctx)
    except BaseException:
        http.server_close()
        raise

    # Fill /api/info with the ports actually bound (port 0 in tests). With --no-https there is no phone URL:
    # phone browsers give motion data only to secure pages, so an http:// phone link would not work.
    info["httpPort"] = http.server_address[1]
    info["laptopUrl"] = f"http://localhost:{info['httpPort']}/motion/receive.html"
    if https is not None:
        info["httpsPort"] = https.server_address[1]
        info["phoneUrls"] = _phone_urls(ips, info["httpsPort"])

    for s in (http, https):
        if s is not None:
            threading.Thread(target=s.serve_forever, daemon=True).start()
    return Servers(hub, http, https, info, ips)


def _url_host(ip: str) -> str:
    return f"[{ip}]" if ":" in ip else ip


def _phone_urls(ips: list[str], https_port: int) -> list[str]:
    return [f"https://{_url_host(ip)}:{https_port}/motion/walk.html" for ip in ips]


# ----------------------------------------------------------------------------------------------------- main

def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Phone walking test server: the phone times a 10 m walk, the laptop "
                                            "receives it. It measures walking speed, not ALS.")
    p.add_argument("--port", type=int, default=DEFAULT_HTTP_PORT, help="plain HTTP port for the laptop page")
    p.add_argument("--https-port", type=int, default=DEFAULT_HTTPS_PORT, help="HTTPS port for the phone page")
    p.add_argument("--no-https", action="store_true", help="serve plain HTTP only (the phone page will not work)")
    p.add_argument("--host", default="0.0.0.0", help="interface to listen on (default: all)")
    p.add_argument("--data-dir", default=DEFAULT_DATA_DIR, help="where walks.jsonl is kept")
    p.add_argument("--app-dir", default=DEFAULT_APP_DIR, help="the red-flag app folder served at /")
    args = p.parse_args(argv)

    try:
        servers = make_servers(app_dir=args.app_dir, web_dir=DEFAULT_WEB_DIR, data_dir=args.data_dir,
                               host=args.host, port=args.port,
                               https_port=None if args.no_https else args.https_port,
                               cert_dir=DEFAULT_CERT_DIR, log=lambda line: print(line, flush=True))
    except RuntimeError as err:
        print(err, file=sys.stderr, flush=True)
        return 1
    except OSError as err:
        print(f"Could not start: {err}. Is the server already running? Close it, or pick other ports with "
              "--port and --https-port.", file=sys.stderr, flush=True)
        return 1

    info = servers.info
    print("Phone walking test server is running. It measures walking speed, not ALS.", flush=True)
    print(f"  Laptop page:  {info['laptopUrl']}", flush=True)
    if servers.https is not None:
        for url in info["phoneUrls"]:
            print(f"  Phone page:   {url}  (accept the certificate warning once)", flush=True)
        if not info["phoneUrls"]:
            print(f"  Phone page:   no network address found. Join the phone and laptop to the same Wi-Fi, "
                  f"then open https://<laptop IP>:{info['httpsPort']}/motion/walk.html", flush=True)
        ports = f"{info['httpPort']},{info['httpsPort']}"
    else:
        print("  Phone page:   off (--no-https). Phones give motion data only to HTTPS pages.", flush=True)
        ports = f"{info['httpPort']}"
    print(f"  Walks saved:  {servers.hub.count()} loaded from {servers.hub.path}"
          + (f" ({servers.hub.skipped_lines} bad lines skipped)" if servers.hub.skipped_lines else ""), flush=True)
    print("  " + FIREWALL_HINT.format(ports=ports), flush=True)
    print("  Stop with Ctrl+C.", flush=True)
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        pass
    finally:
        servers.stop()
    return 0


if __name__ == "__main__":
    sys.exit(main())
