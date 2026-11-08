#!/usr/bin/env python3
"""Gyro starter: stream motion sensors from a phone (or any device) to a laptop.

    phone.html --POST /ingest (JSON batches)--> server.py --GET /events (Server-Sent Events)--> screen.html

Standard library only. --https adds an HTTPS listener with a self-signed certificate (made with the
'cryptography' package), because phones only give motion data to secure (HTTPS) pages.

    python server.py --https
    laptop: http://localhost:8080/screen.html
    phone:  https://<laptop-ip>:8443/phone.html   (accept the certificate warning once)

Any other device can drive the screen too: POST the same JSON to /ingest (see README.md, "Protocol").
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import ipaddress
import json
import os
import queue
import socket
import ssl
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

HERE = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(HERE, "static")
CERT_DIR = os.path.join(HERE, ".certs")
RECORDINGS_DIR = os.path.join(HERE, "recordings")

# Fields of one sample (README "Protocol"): t = device time in ms; gx, gy, gz = turning speed in deg/s
# around the device x, y, z axes; ax, ay, az = acceleration including gravity in m/s^2; lx, ly, lz =
# acceleration without gravity in m/s^2; oa, ob, og = orientation alpha, beta, gamma in degrees.
FIELDS = ["t", "gx", "gy", "gz", "ax", "ay", "az", "lx", "ly", "lz", "oa", "ob", "og"]
MAX_BODY = 5_000_000
RAD_TO_DEG = 57.29577951308232
STANDARD_GRAVITY = 9.80665

# Sensor Logger (free iOS/Android app) HTTP push readings that carry a turning speed, and the device name each
# becomes on the screen. Schema and units: github.com/tszheichoi/awesome-sensor-logger (PUSHING.md, UNITS.md).
SENSOR_LOGGER_MOTION = {
    "gyroscope": ("phone", ("x", "y", "z"), None),
    "headphone": ("airpods", ("rotationRateX", "rotationRateY", "rotationRateZ"), ("gravityX", "gravityY", "gravityZ")),
    "wrist motion": ("watch", ("rotationRateX", "rotationRateY", "rotationRateZ"), ("gravityX", "gravityY", "gravityZ")),
}


def _to_ms2(vec):
    """Gravity arrives in g or in m/s^2 depending on the device and settings; return m/s^2."""
    mag = (vec[0] ** 2 + vec[1] ** 2 + vec[2] ** 2) ** 0.5
    return [round(c * STANDARD_GRAVITY, 4) for c in vec] if 0.3 < mag < 3 else [round(c, 4) for c in vec]


def from_sensor_logger(body) -> dict[str, list[dict]]:
    """Convert one Sensor Logger HTTP push into {device name: [samples in this server's units]}.

    Phone gyroscope -> "phone (Sensor Logger)", AirPods "headphone" -> "airpods", Apple Watch "wrist motion" -> "watch".
    Turning speeds arrive in rad/s and become deg/s; times arrive in UTC epoch nanoseconds and become milliseconds.
    """
    if not isinstance(body, dict):
        raise ValueError("a Sensor Logger push is a JSON object")
    payload = body.get("payload")
    if not isinstance(payload, list):
        return {}  # e.g. a connection test without readings: accept it so the app reports success
    readings = [r for r in payload if isinstance(r, dict) and isinstance(r.get("values"), dict)]
    readings.sort(key=lambda r: r.get("time") if isinstance(r.get("time"), (int, float)) else 0)
    out: dict[str, list[dict]] = {}
    phone_gravity = None
    for r in readings:
        name, values, t_ns = r.get("name"), r["values"], r.get("time")
        if name == "gravity":
            try:
                phone_gravity = _to_ms2([float(values[k]) for k in ("x", "y", "z")])
            except (KeyError, TypeError, ValueError):
                pass
            continue
        if name not in SENSOR_LOGGER_MOTION or not isinstance(t_ns, (int, float)):
            continue
        source, rate_keys, gravity_keys = SENSOR_LOGGER_MOTION[name]
        try:
            gx, gy, gz = (float(values[k]) * RAD_TO_DEG for k in rate_keys)
        except (KeyError, TypeError, ValueError):
            continue
        sample = {"t": round(t_ns / 1e6, 3), "gx": round(gx, 3), "gy": round(gy, 3), "gz": round(gz, 3)}
        gravity = phone_gravity if gravity_keys is None else None
        if gravity_keys is not None:
            try:
                gravity = _to_ms2([float(values[k]) for k in gravity_keys])
            except (KeyError, TypeError, ValueError):
                gravity = None
        if gravity is not None:
            sample["ax"], sample["ay"], sample["az"] = gravity
        name_out = "phone (Sensor Logger)" if source == "phone" else source
        out.setdefault(name_out, []).append(sample)
    return out
MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
}


class Hub:
    """Fans incoming batches out to every open /events stream; keeps per-source counts; records CSV."""

    def __init__(self, recordings_dir: str = RECORDINGS_DIR):
        self._lock = threading.Lock()
        self._subscribers: set[queue.Queue] = set()
        self._stats: dict[str, dict] = {}
        self._recording: dict | None = None
        self.recordings_dir = recordings_dir

    def subscribe(self) -> queue.Queue:
        q: queue.Queue = queue.Queue(maxsize=2000)
        with self._lock:
            self._subscribers.add(q)
        return q

    def unsubscribe(self, q: queue.Queue) -> None:
        with self._lock:
            self._subscribers.discard(q)

    @property
    def viewer_count(self) -> int:
        with self._lock:
            return len(self._subscribers)

    def publish(self, msg: dict) -> None:
        data = json.dumps(msg, separators=(",", ":"))
        with self._lock:
            subscribers = list(self._subscribers)
        for q in subscribers:
            try:
                q.put_nowait(data)
            except queue.Full:
                pass  # a stalled viewer loses data rather than slowing the phone down

    def ingest(self, batch) -> int:
        if not isinstance(batch, dict):
            raise ValueError("body must be a JSON object")
        source = str(batch.get("source") or "unknown").strip()[:40] or "unknown"
        samples = batch.get("samples", [])
        events = batch.get("events", [])
        if not isinstance(samples, list) or not isinstance(events, list):
            raise ValueError("'samples' and 'events' must be lists")
        samples = [s for s in samples if isinstance(s, dict)]
        events = [e for e in events if isinstance(e, dict)]
        now = time.time()
        with self._lock:
            st = self._stats.setdefault(
                source, {"samples": 0, "batches": 0, "events": 0, "first_seen": now, "last_seen": now}
            )
            st["samples"] += len(samples)
            st["batches"] += 1
            st["events"] += len(events)
            st["last_seen"] = now
            rec = self._recording
            if rec is not None:
                stamp = f"{now:.3f}"
                for s in samples:
                    rec["writer"].writerow([stamp, source, "sample"] + [s.get(k, "") for k in FIELDS] + [""])
                for e in events:
                    rec["writer"].writerow(
                        [stamp, source, "event", e.get("t", "")] + [""] * (len(FIELDS) - 1) + [json.dumps(e)]
                    )
                rec["rows"] += len(samples) + len(events)
        self.publish({"type": "batch", "source": source, "rx": round(now, 3), "samples": samples, "events": events})
        return len(samples)

    def start_recording(self) -> str:
        with self._lock:
            if self._recording is not None:
                return self._recording["path"]
            os.makedirs(self.recordings_dir, exist_ok=True)
            base = time.strftime("motion-%Y%m%d-%H%M%S")
            path = os.path.join(self.recordings_dir, base + ".csv")
            n = 2
            while os.path.exists(path):
                path = os.path.join(self.recordings_dir, f"{base}-{n}.csv")
                n += 1
            f = open(path, "w", newline="", encoding="utf-8")
            writer = csv.writer(f)
            writer.writerow(["server_time", "source", "kind"] + FIELDS + ["event"])
            self._recording = {"path": path, "file": f, "writer": writer, "rows": 0, "started": time.time()}
        self.publish({"type": "record", "on": True, "path": path})
        return path

    def stop_recording(self) -> dict | None:
        with self._lock:
            rec, self._recording = self._recording, None
        if rec is None:
            return None
        rec["file"].close()
        info = {"path": rec["path"], "rows": rec["rows"], "seconds": round(time.time() - rec["started"], 1)}
        self.publish({"type": "record", "on": False, **info})
        return info

    def snapshot(self) -> dict:
        now = time.time()
        with self._lock:
            sources = {
                name: {**st, "seconds_since_last": round(now - st["last_seen"], 2)} for name, st in self._stats.items()
            }
            rec = self._recording
            return {
                "viewers": len(self._subscribers),
                "sources": sources,
                "recording": {"path": rec["path"], "rows": rec["rows"]} if rec else None,
            }


def make_handler(hub: Hub, static_dir: str = STATIC_DIR):
    static_root = os.path.realpath(static_dir)

    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"  # keep-alive, so the phone's POSTs reuse one connection
        server_version = "GyroStarter/1.0"
        timeout = 120  # idle keep-alive connections close after 2 minutes

        def log_message(self, format, *args):  # noqa: A002 - quiet console; main() prints rates instead
            pass

        def _send(self, code: int, body: bytes = b"", ctype: str = "text/plain; charset=utf-8") -> None:
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            if body and self.command != "HEAD":
                self.wfile.write(body)

        def _json(self, code: int, obj) -> None:
            self._send(code, json.dumps(obj).encode("utf-8"), "application/json")

        def do_GET(self):  # noqa: N802
            path = urlparse(self.path).path
            if path == "/events":
                return self._events()
            if path == "/stats":
                return self._json(200, hub.snapshot())
            return self._static(path)

        def do_HEAD(self):  # noqa: N802
            return self._static(urlparse(self.path).path)

        def do_POST(self):  # noqa: N802
            path = urlparse(self.path).path
            try:
                length = int(self.headers.get("Content-Length") or 0)
            except ValueError:
                self.close_connection = True
                return self._json(400, {"error": "bad Content-Length"})
            if length > MAX_BODY or length < 0:
                self.close_connection = True
                return self._json(413, {"error": "body too large"})
            raw = self.rfile.read(length) if length else b""
            try:
                body = json.loads(raw.decode("utf-8") or "{}")
            except (UnicodeDecodeError, json.JSONDecodeError):
                return self._json(400, {"error": "body must be JSON"})
            if path == "/ingest":
                try:
                    hub.ingest(body)
                except ValueError as err:
                    return self._json(400, {"error": str(err)})
                return self._send(204)
            if path in ("/sensorlogger", "/data"):  # Sensor Logger HTTP push (its docs use /data)
                try:
                    converted = from_sensor_logger(body)
                except ValueError as err:
                    return self._json(400, {"error": str(err)})
                count = sum(hub.ingest({"source": src, "samples": samples}) for src, samples in converted.items())
                return self._json(200, {"ok": True, "samples": count})
            if path == "/record":
                on = bool(body.get("on")) if isinstance(body, dict) else False
                if on:
                    return self._json(200, {"recording": True, "path": hub.start_recording()})
                return self._json(200, {"recording": False, "result": hub.stop_recording()})
            return self._json(404, {"error": "not found"})

        def _static(self, path: str) -> None:
            if path in ("", "/"):
                path = "/index.html"
            full = os.path.realpath(os.path.join(static_root, path.lstrip("/")))
            if not full.startswith(static_root + os.sep) or not os.path.isfile(full):
                return self._send(404, b"not found")
            with open(full, "rb") as f:
                body = f.read()
            return self._send(200, body, MIME.get(os.path.splitext(full)[1].lower(), "application/octet-stream"))

        def _events(self) -> None:
            q = hub.subscribe()
            self.close_connection = True  # the stream ends when the connection closes
            try:
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.send_header("Cache-Control", "no-store")
                self.send_header("Connection", "close")
                self.send_header("X-Accel-Buffering", "no")
                self.end_headers()
                self.wfile.write(b"retry: 1000\n\n")
                while True:
                    try:
                        chunks = [q.get(timeout=15)]
                    except queue.Empty:
                        self.wfile.write(b": keep-alive\n\n")
                        continue
                    while len(chunks) < 200:  # send whatever piled up in one write
                        try:
                            chunks.append(q.get_nowait())
                        except queue.Empty:
                            break
                    self.wfile.write(b"".join(b"data: " + c.encode("utf-8") + b"\n\n" for c in chunks))
            except OSError:  # includes ssl.SSLError and connection resets: the viewer went away
                pass
            finally:
                hub.unsubscribe(q)

    return Handler


class QuietServer(ThreadingHTTPServer):
    daemon_threads = True

    def handle_error(self, request, client_address):
        # Browsers abort TLS handshakes while showing the self-signed-certificate warning, and phones drop
        # connections when the screen locks. Those are expected; anything else still prints a traceback.
        if isinstance(sys.exc_info()[1], OSError):
            return
        super().handle_error(request, client_address)


def make_server(host: str, port: int, hub: Hub, ssl_context: ssl.SSLContext | None = None,
                static_dir: str = STATIC_DIR) -> QuietServer:
    server = QuietServer((host, port), make_handler(hub, static_dir))
    if ssl_context is not None:
        # Handshake lazily in the connection's own thread, so one slow client cannot block accept().
        server.socket = ssl_context.wrap_socket(server.socket, server_side=True, do_handshake_on_connect=False)
    return server


def lan_ips() -> list[str]:
    """IPv4 addresses a phone on the same network might reach this laptop on."""
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
    """Reuse or create a self-signed certificate covering every name/IP in hosts."""
    cert_path = os.path.join(cert_dir, "cert.pem")
    key_path = os.path.join(cert_dir, "key.pem")
    hosts_path = os.path.join(cert_dir, "hosts.json")
    try:
        with open(hosts_path, encoding="utf-8") as f:
            covered = set(json.load(f))
        if set(hosts) <= covered and os.path.isfile(cert_path) and os.path.isfile(key_path):
            return cert_path, key_path
    except (OSError, ValueError, TypeError):
        pass
    try:
        from cryptography import x509
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import rsa
        from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID
    except ImportError:
        sys.exit("--https needs the 'cryptography' package (pip install cryptography), "
                 "or pass --cert and --key (for example files made by mkcert).")

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "gyro-starter self-signed")])
    alt_names: list = []
    for h in hosts:
        try:
            alt_names.append(x509.IPAddress(ipaddress.ip_address(h)))
        except ValueError:
            alt_names.append(x509.DNSName(h))
    now = dt.datetime.now(dt.timezone.utc)
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


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(description="Relay phone motion sensors to a laptop screen.")
    p.add_argument("--host", default="0.0.0.0", help="interface to listen on (default: all)")
    p.add_argument("--port", type=int, default=8080, help="plain HTTP port: laptop screen page and tunnels")
    p.add_argument("--https", action="store_true", help="also serve HTTPS with a self-signed certificate")
    p.add_argument("--https-port", type=int, default=8443)
    p.add_argument("--cert", help="PEM certificate to use instead of the self-signed one (with --key)")
    p.add_argument("--key", help="PEM private key for --cert")
    args = p.parse_args(argv)

    hub = Hub()
    servers = [make_server(args.host, args.port, hub)]
    ips = lan_ips()
    https_on = args.https or bool(args.cert)
    if https_on:
        if args.cert and args.key:
            cert, key = args.cert, args.key
        else:
            cert, key = ensure_cert(CERT_DIR, ["localhost", "127.0.0.1", *ips])
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(cert, key)
        servers.append(make_server(args.host, args.https_port, hub, ctx))
    for s in servers:
        threading.Thread(target=s.serve_forever, daemon=True).start()

    print("Gyro starter is running.", flush=True)
    print(f"  Laptop screen:  http://localhost:{args.port}/screen.html", flush=True)
    if https_on:
        for ip in ips or ["<this-laptop's-ip>"]:
            print(f"  Phone page:     https://{ip}:{args.https_port}/phone.html  (accept the certificate warning)",
                  flush=True)
    else:
        print("  Phone page:     needs HTTPS. Re-run with --https, or point an HTTPS tunnel at port "
              f"{args.port} and open <tunnel-url>/phone.html (see README.md).", flush=True)
    print("  Stop with Ctrl+C.", flush=True)

    last: dict[str, int] = {}
    last_t = time.time()
    try:
        while True:
            time.sleep(5)
            snap = hub.snapshot()
            now = time.time()
            parts = []
            for name, st in snap["sources"].items():
                if st["seconds_since_last"] < 5:
                    rate = (st["samples"] - last.get(name, 0)) / (now - last_t)
                    parts.append(f"{name}: {rate:.0f} Hz")
                last[name] = st["samples"]
            last_t = now
            if parts:
                rec = " | recording" if snap["recording"] else ""
                print(f"[{time.strftime('%H:%M:%S')}] " + ", ".join(parts) + f" | viewers: {snap['viewers']}{rec}",
                      flush=True)
    except KeyboardInterrupt:
        pass
    finally:
        info = hub.stop_recording()
        if info:
            print(f"Saved {info['rows']} rows to {info['path']}", flush=True)
        for s in servers:
            s.shutdown()
            s.server_close()


if __name__ == "__main__":
    main()
