#!/usr/bin/env python3
"""Simulated AirPods, Apple Watch and phone, sent through the one server's real endpoints (server/SPEC.md).

    python server/simulate.py [--url http://localhost:8765] [--seconds 20] [--devices airpods,watch,phone] [--walk]

Everything it sends is clearly SIMULATED, so it can never be mistaken for a measurement:
  - AirPods and Watch: Sensor Logger HTTP pushes to /sensorlogger?simulated=1, one push every 0.25 s with
    "headphone" readings (about 25 Hz, head turns and nods) and "wrist motion" readings (about 50 Hz, walking
    arm swing): rotationRateX/Y/Z in rad/s, gravityX/Y/Z in g, time in epoch nanoseconds, as the real app
    sends them. The server stores them as "airpods (simulated)" and "watch (simulated)".
  - Phone: /ingest batches at about 60 Hz with source "phone (simulated)" (turned like a remote while walking).
  - --walk: one synthetic 10 m walk to /api/walks (simulated: true in the result and the recording).
It prints a running count, then the database totals read back from /api/db/summary, and exits 1 if any
simulated device is missing from the database. Standard library only; the shapes are seeded (--seed).
"""
from __future__ import annotations

import argparse
import datetime as dt
import http.client
import json
import math
import random
import secrets
import ssl
import sys
import time
from urllib.parse import quote, urlsplit

G = 9.80665                 # standard gravity, m/s^2
TICK_S = 0.25               # one push per 0.25 s
DEVICES = ("airpods", "watch", "phone")
RATES = {"airpods": 25.0, "watch": 50.0, "phone": 60.0}
STORED_NAMES = {"airpods": "airpods (simulated)", "watch": "watch (simulated)", "phone": "phone (simulated)"}
TWO_PI = 2 * math.pi


class ServerError(RuntimeError):
    pass


class Client:
    """A keep-alive JSON client for the one server (HTTP, or HTTPS with its self-signed certificate)."""

    def __init__(self, url: str, timeout: float = 5.0):
        parts = urlsplit(url)
        if parts.scheme not in ("http", "https") or not parts.hostname:
            raise ValueError(f"--url must look like http://localhost:8765, not {url!r}")
        self.scheme, self.host = parts.scheme, parts.hostname
        self.port = parts.port or (443 if parts.scheme == "https" else 80)
        self.prefix = parts.path.rstrip("/")
        self.timeout = timeout
        self._conn = None

    def _connect(self):
        if self.scheme == "https":
            ctx = ssl.create_default_context()  # the server's own self-signed certificate: do not verify it
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
            return http.client.HTTPSConnection(self.host, self.port, timeout=self.timeout, context=ctx)
        return http.client.HTTPConnection(self.host, self.port, timeout=self.timeout)

    def close(self) -> None:
        if self._conn is not None:
            self._conn.close()
            self._conn = None

    def request(self, method: str, path: str, body=None) -> tuple[int, bytes]:
        data = None if body is None else json.dumps(body, separators=(",", ":")).encode("utf-8")
        headers = {"Content-Type": "application/json"} if data is not None else {}
        for attempt in (1, 2):  # a second try only if a kept-alive connection had gone stale
            if self._conn is None:
                self._conn = self._connect()
            try:
                self._conn.request(method, self.prefix + path, body=data, headers=headers)
                res = self._conn.getresponse()
                raw = res.read()
                if (res.getheader("Connection") or "").lower() == "close":
                    self.close()
                return res.status, raw
            except (http.client.RemoteDisconnected, ConnectionResetError, BrokenPipeError):
                self.close()
                if attempt == 2:
                    raise
            except (OSError, http.client.HTTPException):
                self.close()
                raise
        raise AssertionError("unreachable")

    def json(self, method: str, path: str, body=None):
        status, raw = self.request(method, path, body)
        try:
            return status, json.loads(raw.decode("utf-8")) if raw else None
        except ValueError:
            return status, None


# --------------------------------------------------------------------------------------- motion shapes

def _pulse(t: float, t0: float, dur: float, total: float) -> tuple[float, float]:
    """A smooth move of `total` over [t0, t0 + dur]: (rate now, angle so far). Rate is a raised cosine."""
    if t <= t0:
        return 0.0, 0.0
    if t >= t0 + dur:
        return 0.0, total
    u = (t - t0) / dur
    return total / dur * (1 - math.cos(TWO_PI * u)), total * (u - math.sin(TWO_PI * u) / TWO_PI)


class AirPods:
    """Head turns (left or right and back) and the odd nod, as AirPods head tracking reports them."""

    def __init__(self, rng: random.Random, seconds: float):
        self.rng = rng
        self.moves = []  # (axis, t0, duration, total angle in rad)
        t = 0.8
        while t < seconds + 5:
            angle = math.radians(rng.uniform(30, 70)) * rng.choice((-1, 1))
            d = rng.uniform(0.5, 0.9)
            hold = rng.uniform(0.6, 1.5)
            self.moves += [("yaw", t, d, angle), ("yaw", t + d + hold, d, -angle)]
            if rng.random() < 0.4:
                nod = math.radians(rng.uniform(10, 20))
                n0 = t + 2 * d + hold + 0.3
                self.moves += [("pitch", n0, 0.35, nod), ("pitch", n0 + 0.45, 0.35, -nod)]
            t += 2 * d + hold + rng.uniform(1.5, 3.5)

    def reading(self, t: float) -> dict:
        rate = {"yaw": 0.0, "pitch": 0.0}
        angle = {"yaw": 0.0, "pitch": 0.0}
        for axis, t0, d, total in self.moves:
            if t0 > t:
                continue
            r, a = _pulse(t, t0, d, total)
            rate[axis] += r
            angle[axis] += a
        g = self.rng.gauss
        roll = 0.03 * math.sin(TWO_PI * 0.2 * t)
        pitch, yaw = angle["pitch"] + 0.02, angle["yaw"]
        cr, sr, cp, sp, cy, sy = (math.cos(roll / 2), math.sin(roll / 2), math.cos(pitch / 2), math.sin(pitch / 2),
                                  math.cos(yaw / 2), math.sin(yaw / 2))
        return {
            "rotationRateX": round(rate["pitch"] + g(0, 0.02), 5),
            "rotationRateY": round(TWO_PI * 0.2 * 0.03 * math.cos(TWO_PI * 0.2 * t) + g(0, 0.02), 5),
            "rotationRateZ": round(rate["yaw"] + g(0, 0.02), 5),
            "gravityX": round(math.sin(roll) * math.cos(pitch), 5),     # in g, as Core Motion reports it
            "gravityY": round(-math.sin(pitch), 5),
            "gravityZ": round(-math.cos(roll) * math.cos(pitch), 5),
            "accelerationX": round(g(0, 0.01), 5), "accelerationY": round(g(0, 0.01), 5),
            "accelerationZ": round(g(0, 0.01), 5),
            "roll": round(roll, 5), "pitch": round(pitch, 5), "yaw": round(yaw, 5),
            "quaternionW": round(cr * cp * cy + sr * sp * sy, 5), "quaternionX": round(sr * cp * cy - cr * sp * sy, 5),
            "quaternionY": round(cr * sp * cy + sr * cp * sy, 5), "quaternionZ": round(cr * cp * sy - sr * sp * cy, 5),
        }


class Watch:
    """Walking arm swing: the wrist swings like a pendulum once every two steps."""

    def __init__(self, rng: random.Random):
        self.rng = rng
        self.cadence_spm = rng.uniform(100, 115)
        self.phase = rng.uniform(0, TWO_PI)

    def reading(self, t: float) -> dict:
        f = self.cadence_spm / 120.0                       # swing cycles per second
        amp = 0.45 + 0.05 * math.sin(TWO_PI * 0.05 * t)    # swing amplitude in rad
        w = TWO_PI * f * t + self.phase
        swing, swing_rate = amp * math.sin(w), amp * TWO_PI * f * math.cos(w)
        step = 0.12 * math.sin(2 * w)                      # a small jolt at each step, in g
        g = self.rng.gauss
        return {
            "rotationRateX": round(swing_rate + g(0, 0.05), 5),
            "rotationRateY": round(0.25 * math.sin(2 * w) + g(0, 0.05), 5),
            "rotationRateZ": round(0.15 * math.cos(w) + g(0, 0.05), 5),
            "gravityX": round(0.15 * math.sin(w), 5),
            "gravityY": round(-math.cos(swing), 5),
            "gravityZ": round(-math.sin(swing), 5),
            "accelerationX": round(g(0, 0.02), 5), "accelerationY": round(step + g(0, 0.02), 5),
            "accelerationZ": round(0.5 * step + g(0, 0.02), 5),
            "quaternionW": round(math.cos(swing / 2), 5), "quaternionX": round(math.sin(swing / 2), 5),
            "quaternionY": 0.0, "quaternionZ": 0.0,
        }


class Phone:
    """A phone held flat in the hand while walking, turned now and then like a remote (deg/s and m/s^2)."""

    def __init__(self, rng: random.Random):
        self.rng = rng
        self.page_t0 = rng.uniform(800, 2500)  # the phone page's clock (performance.now) in ms
        self.yaw = rng.uniform(0, 360)

    def sample(self, t: float) -> dict:
        g = self.rng.gauss
        gz = 35 * math.sin(TWO_PI * 0.23 * t) + 10 * math.sin(TWO_PI * 0.07 * t)
        gx = 12 * math.sin(TWO_PI * 0.4 * t + 1.0)
        gy = 4 * math.sin(TWO_PI * 1.8 * t)
        bounce = 1.2 * math.sin(TWO_PI * 1.8 * t)          # walking, about 108 steps a minute
        lx, ly, lz = 0.3 * math.sin(TWO_PI * 0.9 * t) + g(0, 0.05), 0.2 * math.sin(TWO_PI * 1.8 * t + 0.5) + g(0, 0.05), bounce + g(0, 0.05)
        tilt = math.radians(8 * math.sin(TWO_PI * 0.4 * t + 1.0))
        return {
            "t": round(self.page_t0 + t * 1000 + self.rng.uniform(-1.0, 1.0), 2),
            "gx": round(gx + g(0, 0.4), 3), "gy": round(gy + g(0, 0.4), 3), "gz": round(gz + g(0, 0.4), 3),
            "ax": round(lx, 3), "ay": round(G * math.sin(tilt) + ly, 3), "az": round(G * math.cos(tilt) + lz, 3),
            "lx": round(lx, 3), "ly": round(ly, 3), "lz": round(lz, 3),
            "oa": round((self.yaw + 20 * math.sin(TWO_PI * 0.23 * t)) % 360, 1),
            "ob": round(math.degrees(tilt), 1), "og": round(2 * math.sin(TWO_PI * 0.9 * t), 1),
        }


def synth_walk(rng: random.Random) -> dict:
    """One synthetic 10 m walk (motion/CONTRACT.md sections 2 and 5): 3 s still, 14 steps in 8 s, 2 s still.

    The result's numbers are the walk's own settings (1.25 m/s, 14 steps), not a measurement: it is labelled
    simulated in the result, the recording and the device.
    """
    rate, stand_before, reaction, walk_s, stand_after, tap_delay = 60.0, 3.0, 0.6, 8.0, 2.0, 0.4
    steps, distance = 14, 10
    go_t = stand_before * 1000
    onset_t = go_t + reaction * 1000
    end_t = onset_t + walk_s * 1000
    stop_t = end_t + tap_delay * 1000
    step_times = [onset_t / 1000 + (k + 0.5) * walk_s / steps for k in range(steps)]
    stride_f = steps / 2 / walk_s
    samples = []
    n = int((stand_before + reaction + walk_s + stand_after) * rate)
    for i in range(n):
        t = i / rate
        walking = onset_t / 1000 <= t <= end_t / 1000
        bump = sum(2.5 * 0.5 * (1 + math.cos(TWO_PI * (t - st) / 0.25)) for st in step_times if abs(t - st) < 0.125)
        sway = math.sin(TWO_PI * stride_f * t) if walking else 0.0
        lx, ly, lz = 0.3 * sway + rng.gauss(0, 0.12), bump + rng.gauss(0, 0.12), 0.4 * sway + rng.gauss(0, 0.12)
        samples.append({"t": round(t * 1000 + rng.uniform(-1.5, 1.5), 2),
                        "ax": round(lx, 3), "ay": round(G + ly, 3), "az": round(lz, 3),
                        "gx": round(8 * sway + rng.gauss(0, 0.5), 3), "gy": round(3 * sway + rng.gauss(0, 0.5), 3),
                        "gz": round(15 * sway + rng.gauss(0, 0.5), 3),
                        "lx": round(lx, 3), "ly": round(ly, 3), "lz": round(lz, 3)})
    now = dt.datetime.now(dt.timezone.utc)
    walk_id = f"w-sim-{now.astimezone().strftime('%Y%m%dT%H%M%S')}-{secrets.token_hex(2)}"
    created = now.isoformat(timespec="milliseconds").replace("+00:00", "Z")
    device = {"ua": "server/simulate.py (simulated)"}
    duration = walk_s
    result = {
        "version": "gait-1", "ok": True, "speed_mps": round(distance / duration, 2), "duration_s": duration,
        "timing": "motion", "motionDuration_s": duration, "manualDuration_s": round((stop_t - go_t) / 1000, 2),
        "onsetT": onset_t, "endT": end_t, "steps": steps, "cadence_spm": round(60 * steps / duration, 1),
        "stepLength_m": round(distance / steps, 2), "distance_m": distance, "sampleRate_hz": rate,
        "nSamples": len(samples), "maxGap_ms": 20, "quality": "good", "issues": [],
        "exploratory": {"stepTimeCv_pct": None, "asymmetry_pct": None, "autocorrCadence_spm": None,
                        "gyroCadence_spm": None, "headingChange_deg": None},
        "simulated": True,
        "note": "Simulated by server/simulate.py: these numbers are the synthetic walk's own settings, not a measurement.",
    }
    recording = {"v": 1, "kind": "rfn-walk-recording", "id": walk_id, "createdAt": created, "device": device,
                 "distance_m": distance, "placement": "waist", "goT": go_t, "stopT": stop_t, "stopBy": "tap",
                 "samples": samples, "simulated": True,
                 "truth": {"onsetT": onset_t, "endT": end_t, "steps": steps, "duration_s": duration,
                           "speed_mps": round(distance / duration, 2)}}
    return {"v": 1, "kind": "rfn-walk", "id": walk_id, "createdAt": created, "distance_m": distance,
            "placement": "waist", "device": device, "result": result, "recording": recording}


# ----------------------------------------------------------------------------------------------- running

def _check(status: int, want: int, what: str, raw=None) -> None:
    if status != want:
        detail = f": {raw}" if raw else ""
        raise ServerError(f"{what} answered {status}, expected {want}{detail}")


def print_totals(client: Client, devices: list[str], walk_id: str | None) -> bool:
    """Print the database totals from /api/db/summary. True if every simulated device (and the walk) is stored."""
    status, s = client.json("GET", "/api/db/summary")
    _check(status, 200, "GET /api/db/summary")
    counts = s["counts"]
    print("Database totals, read back from /api/db/summary:", flush=True)
    print("  " + ", ".join(f"{t} {n}" for t, n in counts.items()), flush=True)
    by_id = {d["id"]: d for d in s["devices"]}
    for d in s["devices"]:
        label = "simulated" if d["simulated"] else "REAL"
        print(f"  {d['id']}: {d['samples']} samples stored ({label}, {d['kind']}), "
              f"rate now {d['rate_hz']} Hz, last {d['seconds_since_last']} s ago", flush=True)
    newest = s.get("newest_walk")
    if newest:
        res = newest.get("result") or {}
        print(f"  newest walk: {newest['id']}, {res.get('speed_mps')} m/s"
              + (" (simulated)" if newest.get("simulated") else ""), flush=True)
    print(f"  file: {s['db']['path']} ({(s['db']['bytes'] + s['db']['wal_bytes']) / 1024:.0f} KB)", flush=True)
    missing = [STORED_NAMES[d] for d in devices if by_id.get(STORED_NAMES[d], {}).get("samples", 0) <= 0]
    if walk_id is not None and client.request("GET", f"/api/walks/{quote(walk_id)}")[0] != 200:
        missing.append(f"walk {walk_id}")
    if missing:
        print("MISSING from the database: " + ", ".join(missing), flush=True)
        return False
    stored = [STORED_NAMES[d] for d in devices] + ([f"walk {walk_id}"] if walk_id else [])
    print("OK: rows are stored for " + ", ".join(stored) + ".", flush=True)
    return True


def run(url: str, seconds: float, devices: list[str], walk: bool, seed: int) -> int:
    client = Client(url)
    try:
        status, health = client.json("GET", "/api/health")
    except (OSError, http.client.HTTPException) as err:
        print(f"Cannot reach the server at {url} ({err}). Start it first with: python run.py", flush=True)
        return 1
    if status != 200 or not isinstance(health, dict) or health.get("server") != "rfn-one-server":
        print(f"{url} is not the one server (GET /api/health answered {status}). Start it with: python run.py",
              flush=True)
        return 1

    # One generator per device (string seeds are hashed deterministically), so each shape is the same on every
    # run however the samples fall into pushes.
    pods = AirPods(random.Random(f"{seed}-airpods"), seconds)
    watch, phone = Watch(random.Random(f"{seed}-watch")), Phone(random.Random(f"{seed}-phone"))
    ids = random.Random(f"{seed}-ids")
    session_id, device_id = f"{ids.getrandbits(64):016x}", f"{ids.getrandbits(64):016x}"
    print(f"Sending SIMULATED data to {url} for {seconds:g} s: {', '.join(STORED_NAMES[d] for d in devices)}"
          + (" and one walk" if walk else ""), flush=True)

    walk_id = None
    try:
        if walk:
            body = synth_walk(random.Random(f"{seed}-walk"))
            status, reply = client.json("POST", "/api/walks", body)
            if status not in (200, 201):
                raise ServerError(f"POST /api/walks answered {status}: {reply}")
            walk_id = body["id"]
            print(f"  walk {walk_id}: {'stored' if status == 201 else 'already stored'} "
                  f"({len(body['recording']['samples'])} samples, {body['result']['speed_mps']} m/s, simulated)",
                  flush=True)

        totals = {d: int(seconds * RATES[d]) for d in devices}
        sent = {d: 0 for d in devices}
        start = time.monotonic()
        epoch0 = time.time()
        message_id = 0
        next_tick = start
        next_print = start + 1.0
        done = False
        while not done:
            elapsed = time.monotonic() - start
            done = elapsed >= seconds
            due = {d: totals[d] if done else min(totals[d], int(elapsed * RATES[d])) for d in devices}
            payload = []
            for d, sim in (("airpods", pods), ("watch", watch)):
                if d in devices:
                    name = "headphone" if d == "airpods" else "wrist motion"
                    for i in range(sent[d], due[d]):
                        t = i / RATES[d]
                        payload.append({"name": name, "time": int((epoch0 + t) * 1e9), "values": sim.reading(t)})
            if payload:
                payload.sort(key=lambda r: r["time"])
                status, reply = client.json("POST", "/sensorlogger?simulated=1", {
                    "messageId": message_id, "sessionId": session_id, "deviceId": device_id, "payload": payload})
                _check(status, 200, "POST /sensorlogger", reply)
                if not isinstance(reply, dict) or reply.get("samples") != len(payload):
                    raise ServerError(f"POST /sensorlogger stored {reply}, expected {len(payload)} samples")
                message_id += 1
                for d in ("airpods", "watch"):
                    if d in devices:
                        sent[d] = due[d]
            if "phone" in devices and due["phone"] > sent["phone"]:
                samples = [phone.sample(i / RATES["phone"]) for i in range(sent["phone"], due["phone"])]
                status, raw = client.request("POST", "/ingest", {"source": STORED_NAMES["phone"], "samples": samples,
                                                                 "events": []})
                _check(status, 204, "POST /ingest", raw)
                sent["phone"] = due["phone"]
            now = time.monotonic()
            if now >= next_print or done:
                print(f"  [{min(now - start, seconds):5.1f} s] sent: "
                      + ", ".join(f"{STORED_NAMES[d]} {sent[d]}" for d in devices), flush=True)
                next_print += 1.0
            if not done:
                next_tick += TICK_S
                time.sleep(max(0.0, min(next_tick, start + seconds) - time.monotonic()))
    except KeyboardInterrupt:
        print("Stopped early (Ctrl+C).", flush=True)
    except (OSError, http.client.HTTPException, ServerError) as err:
        print(f"The server stopped accepting data: {err}", flush=True)
        return 1

    try:
        ok = print_totals(client, devices, walk_id)
    except (OSError, http.client.HTTPException, ServerError, KeyError, TypeError) as err:
        print(f"Could not read the totals back: {err}", flush=True)
        return 1
    finally:
        client.close()
    return 0 if ok else 1


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Send simulated AirPods, Apple Watch and phone motion (and a walk) "
                                            "through the one server's real endpoints.")
    p.add_argument("--url", default="http://localhost:8765", help="the one server (default http://localhost:8765)")
    p.add_argument("--seconds", type=float, default=20.0, help="how long to stream (default 20)")
    p.add_argument("--devices", default="airpods,watch,phone", help="comma-separated: airpods, watch, phone")
    p.add_argument("--walk", action="store_true", help="also send one synthetic 10 m walk to /api/walks")
    p.add_argument("--seed", type=int, default=1, help="random seed for the motion shapes (default 1)")
    args = p.parse_args(argv)
    devices = [d.strip().lower() for d in args.devices.split(",") if d.strip()]
    unknown = [d for d in devices if d not in DEVICES]
    if unknown:
        p.error(f"unknown device(s) {', '.join(unknown)}; choose from {', '.join(DEVICES)}")
    if args.seconds <= 0:
        p.error("--seconds must be more than 0")
    return run(args.url, args.seconds, list(dict.fromkeys(devices)), args.walk, args.seed)


if __name__ == "__main__":
    sys.exit(main())
