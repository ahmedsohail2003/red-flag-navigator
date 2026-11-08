"""Tests for the one server (server/SPEC.md, "Tests"). Standard library only. From the project folder:

    python -m unittest discover -s server/tests -v

Each test class starts the server in this process on free ports, with a temporary database, recordings
folder, certificate folder and motion/web folder. The app and gyro-starter pages are the real folders (read only).
"""
import csv
import http.client
import importlib.util
import io
import json
import os
import queue
import re
import signal
import socket
import sqlite3
import ssl
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest import mock
from urllib.parse import quote

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


app_server = _load("rfn_app_server", os.path.join(SERVER_DIR, "app_server.py"))
db = app_server.db

# Sensor Logger's documented push (gyro-starter/tests): epoch ns times, rad/s turning speeds, gravity in g.
NS = 1_700_000_000_000_000_000
SL_PUSH = {
    "messageId": 7, "sessionId": "s1", "deviceId": "d1",
    "payload": [
        {"name": "headphone", "time": NS + 30_000_000, "values": {
            "rotationRateX": 0.5, "rotationRateY": -0.25, "rotationRateZ": 2.0,
            "gravityX": 0.0, "gravityY": -1.0, "gravityZ": 0.0,
            "quaternionW": 1, "quaternionX": 0, "quaternionY": 0, "quaternionZ": 0}},
        {"name": "wrist motion", "time": NS + 40_000_000, "values": {
            "rotationRateX": -1.0, "rotationRateY": 0.0, "rotationRateZ": 0.1,
            "gravityX": 0.0, "gravityY": 0.0, "gravityZ": -1.0}},
        {"name": "battery", "time": NS + 50_000_000, "values": {"batteryLevel": 0.5}},
    ],
}


def walk_body(walk_id, samples=3, simulated=False):
    """A minimal valid walk (motion/CONTRACT.md section 5) with a small recording."""
    recording = {"v": 1, "kind": "rfn-walk-recording", "id": walk_id, "createdAt": "2026-11-08T12:12:03.120Z",
                 "device": {"ua": "test"}, "distance_m": 10, "placement": "waist", "goT": 3000.0, "stopT": 11873.0,
                 "stopBy": "tap",
                 "samples": [{"t": 1000.0 + 16.7 * i, "ax": 0.12, "ay": 9.6 + i, "az": 1.1, "gx": 3.2, "gy": -1.0,
                              "gz": 0.4, "lx": 0.1, "ly": -0.2, "lz": 0.3} for i in range(samples)]}
    result = {"version": "gait-1", "ok": True, "speed_mps": 1.24, "quality": "good", "steps": 14}
    if simulated:
        result["simulated"] = True
    return {"v": 1, "kind": "rfn-walk", "id": walk_id, "createdAt": "2026-11-08T12:12:03.120Z", "distance_m": 10,
            "placement": "waist", "device": {"ua": "test"}, "result": result, "recording": recording}


class Base(unittest.TestCase):
    https = False
    session_gap_s = 20.0

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        root = cls.tmp.name
        cls.paths = {"db": os.path.join(root, "db", "rfn.sqlite"), "rec": os.path.join(root, "recordings"),
                     "motion": os.path.join(root, "motion-web"), "certs": os.path.join(root, "certs")}
        cls.srv = app_server.make_servers(
            cls.paths["db"], host="127.0.0.1", port=0, https_port=0 if cls.https else None,
            recordings_dir=cls.paths["rec"], motion_dir=cls.paths["motion"], cert_dir=cls.paths["certs"],
            session_gap_s=cls.session_gap_s, ping_interval_s=0.3, ips=["192.0.2.10"])
        cls.port = cls.srv.http_port

    @classmethod
    def tearDownClass(cls):
        cls.srv.stop()
        cls.tmp.cleanup()

    # -- HTTP helpers
    def request(self, method, path, body=None, headers=None, raw=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        try:
            data = raw if raw is not None else (json.dumps(body).encode("utf-8") if body is not None else None)
            h = {"Content-Type": "application/json"} if data is not None else {}
            h.update(headers or {})
            conn.request(method, path, body=data, headers=h)
            res = conn.getresponse()
            return res, res.read()
        finally:
            conn.close()

    def get_json(self, path):
        res, data = self.request("GET", path)
        return res.status, json.loads(data)

    def post_json(self, path, body):
        res, data = self.request("POST", path, body)
        return res.status, (json.loads(data) if data else None)

    def query(self, sql, args=()):
        """Read the database file directly, as a person inspecting it would."""
        conn = sqlite3.connect(self.paths["db"])
        try:
            return conn.execute(sql, args).fetchall()
        finally:
            conn.close()


# ------------------------------------------------------------------------------------------------ 1. /ingest

class IngestTest(Base):
    def test_ingest_and_gyro_ingest_store_rows_device_and_session(self):
        samples = [{"t": 10.0 + i, "gx": 1.5 * i, "gy": -2.0, "gz": 30.0, "ax": 0.1, "ay": 0.2, "az": 9.81,
                    "lx": 0.01, "ly": 0.02, "lz": 0.03, "oa": 1, "ob": 2, "og": 3} for i in range(3)]
        res, _ = self.request("POST", "/ingest", {"source": "test-phone-1", "samples": samples,
                                                  "events": [{"t": 11.0, "type": "button", "id": "A", "down": True}]})
        self.assertEqual(res.status, 204)
        res, _ = self.request("POST", "/gyro/ingest", {"source": "test-phone-1", "samples": samples[:2]})
        self.assertEqual(res.status, 204)

        self.assertEqual(self.query("SELECT kind, samples, simulated FROM devices WHERE id = 'test-phone-1'"),
                         [("phone", 5, 0)])
        sessions = self.query("SELECT id, kind, samples FROM sessions WHERE device_id = 'test-phone-1'")
        self.assertEqual(len(sessions), 1)
        self.assertEqual(sessions[0][1:], ("stream", 5))
        self.assertRegex(sessions[0][0], r"^s-\d{8}-\d{6}-test-phone-1-[0-9a-f]{4}$")
        rows = self.query("SELECT session_id, t_ms, gx, gy, gz, ax, ay, az, lx, ly, lz FROM samples"
                          " WHERE device_id = 'test-phone-1' ORDER BY rowid")
        self.assertEqual(len(rows), 5)
        self.assertEqual(rows[2], (sessions[0][0], 12.0, 3.0, -2.0, 30.0, 0.1, 0.2, 9.81, 0.01, 0.02, 0.03))
        self.assertEqual(self.query("SELECT type, payload FROM events WHERE device_id = 'test-phone-1'"),
                         [("button", '{"t":11.0,"type":"button","id":"A","down":true}')])
        # The Hub's own counts (the screen's /stats) agree with the database.
        status, stats = self.get_json("/stats")
        self.assertEqual(stats["sources"]["test-phone-1"]["samples"], 5)
        self.assertEqual(self.get_json("/gyro/stats")[1]["sources"]["test-phone-1"]["samples"], 5)

    def test_bad_bodies_are_rejected_and_nothing_is_stored(self):
        self.assertEqual(self.request("POST", "/ingest", raw=b"not json")[0].status, 400)
        self.assertEqual(self.request("POST", "/ingest", [1, 2])[0].status, 400)
        self.assertEqual(self.request("POST", "/ingest", {"source": "bad-1", "samples": "x"})[0].status, 400)
        self.assertEqual(self.request("POST", "/nowhere", {})[0].status, 404)
        self.assertEqual(self.query("SELECT COUNT(*) FROM devices WHERE id = 'bad-1'"), [(0,)])
        # Values that are not finite numbers are stored as NULL, never as text or NaN.
        res, _ = self.request("POST", "/ingest", {"source": "odd-values", "samples": [
            {"t": "soon", "gx": True, "gy": None, "gz": "1.5", "ax": 1e999}]})
        self.assertEqual(res.status, 204)
        self.assertEqual(self.query("SELECT t_ms, gx, gy, gz, ax FROM samples WHERE device_id = 'odd-values'"),
                         [(None, None, None, None, None)])

    def test_device_kind_and_simulated_flag_come_from_the_name(self):
        for name, kind in (("My AirPods Pro", "airpods"), ("watch (simulated)", "watch"),
                           ("phone (Sensor Logger)", "phone"), ("thing", "other")):
            self.assertEqual(db.device_kind(name), kind, name)
        self.assertTrue(db.is_simulated("phone (simulated)"))
        self.assertFalse(db.is_simulated("phone"))
        self.request("POST", "/ingest", {"source": "Apple Watch (simulated)", "samples": [{"t": 1, "gx": 1}]})
        self.assertEqual(self.query("SELECT kind, simulated FROM devices WHERE id = 'Apple Watch (simulated)'"),
                         [("watch", 1)])

    def test_record_writes_csv_into_the_recordings_folder(self):
        status, reply = self.post_json("/record", {"on": True})
        self.assertEqual(status, 200)
        path = reply["path"]
        self.assertTrue(os.path.normcase(path).startswith(os.path.normcase(self.paths["rec"])), path)
        self.request("POST", "/ingest", {"source": "rec-test", "samples": [{"t": 1.0, "gx": 1}, {"t": 2.0, "gx": 2}]})
        status, reply = self.post_json("/gyro/record", {"on": False})
        self.assertEqual(reply["result"]["rows"], 2)
        with open(path, newline="", encoding="utf-8") as f:
            rows = list(csv.reader(f))
        self.assertEqual(rows[0][:3], ["server_time", "source", "kind"])
        self.assertEqual([r[1] for r in rows[1:]], ["rec-test", "rec-test"])


# ------------------------------------------------------------------------------------------ 2-3. Sensor Logger

class SensorLoggerTest(Base):
    def test_airpods_and_watch_pushes_are_stored_in_server_units(self):
        status, reply = self.post_json("/sensorlogger", SL_PUSH)
        self.assertEqual((status, reply), (200, {"ok": True, "samples": 2}))
        pods = self.query("SELECT t_ms, gx, gy, gz, ax, ay, az FROM samples WHERE device_id = 'airpods'")
        self.assertEqual(len(pods), 1)
        t, gx, gy, gz, ax, ay, az = pods[0]
        self.assertEqual(t, 1_700_000_000_030.0)          # epoch ns -> ms
        self.assertAlmostEqual(gx, 28.648, places=3)       # 0.5 rad/s -> deg/s
        self.assertAlmostEqual(gy, -14.324, places=3)
        self.assertAlmostEqual(gz, 114.592, places=3)
        self.assertAlmostEqual(ay, -9.80665, places=3)     # -1 g -> m/s^2
        self.assertEqual((ax, az), (0.0, 0.0))
        watch = self.query("SELECT t_ms, gx, az FROM samples WHERE device_id = 'watch'")
        self.assertEqual(len(watch), 1)
        self.assertEqual(watch[0][0], 1_700_000_000_040.0)
        self.assertAlmostEqual(watch[0][1], -57.296, places=3)
        self.assertAlmostEqual(watch[0][2], -9.80665, places=3)
        self.assertEqual(self.query("SELECT id, kind, simulated FROM devices WHERE id IN ('airpods', 'watch')"
                                    " ORDER BY id"), [("airpods", "airpods", 0), ("watch", "watch", 0)])

    def test_simulated_flag_names_the_devices_simulated(self):
        status, reply = self.post_json("/sensorlogger?simulated=1", SL_PUSH)
        self.assertEqual((status, reply), (200, {"ok": True, "samples": 2}))
        self.assertEqual(self.query("SELECT id, kind, simulated, samples FROM devices WHERE id LIKE '%(simulated)'"
                                    " AND id IN ('airpods (simulated)', 'watch (simulated)') ORDER BY id"),
                         [("airpods (simulated)", "airpods", 1, 1), ("watch (simulated)", "watch", 1, 1)])
        # The other Sensor Logger addresses take the same push.
        for path in ("/data?simulated=1", "/gyro/sensorlogger?simulated=1"):
            self.assertEqual(self.post_json(path, SL_PUSH), (200, {"ok": True, "samples": 2}), path)
        self.assertEqual(self.query("SELECT samples FROM devices WHERE id = 'airpods (simulated)'"), [(3,)])

    def test_connection_test_without_payload_gets_200_with_0_samples(self):
        before = self.query("SELECT COUNT(*) FROM samples")
        for body in ({"messageId": 0, "sessionId": "x", "deviceId": "y"}, {"payload": []}):
            self.assertEqual(self.post_json("/sensorlogger", body), (200, {"ok": True, "samples": 0}), body)
        res, data = self.request("POST", "/sensorlogger", raw=b"")  # an empty body is a test push too
        self.assertEqual((res.status, json.loads(data)), (200, {"ok": True, "samples": 0}))
        self.assertEqual(self.query("SELECT COUNT(*) FROM samples"), before)
        self.assertEqual(self.request("POST", "/sensorlogger", [1, 2])[0].status, 400)


class SensorLoggerDiagnosticTest(Base):
    """/api/db/summary says what the last Sensor Logger push held, so a missing AirPods stream is visible."""

    def test_summary_shows_what_each_push_held_without_any_ids(self):
        self.assertEqual(self.get_json("/api/db/summary")[1]["sensorLogger"], {"pushes": 0, "tests": 0, "last": None})

        # "Tap to Test Pushing": no readings
        self.assertEqual(self.post_json("/sensorlogger", {"messageId": 0, "sessionId": "x", "deviceId": "y"}),
                         (200, {"ok": True, "samples": 0}))
        sl = self.get_json("/api/db/summary")[1]["sensorLogger"]
        self.assertEqual((sl["pushes"], sl["tests"], sl["last"]["test"], sl["last"]["sensors"]), (1, 1, True, []))

        # A recording: AirPods and Watch stored, gravity helps the phone, battery is not read. No ids kept.
        push = json.loads(json.dumps(SL_PUSH))
        push.update(deviceId="secret-device-123", sessionId="secret-session-456", userId="secret-user-789")
        push["payload"].append({"name": "gravity", "time": NS + 60_000_000, "values": {"x": 0.0, "y": -1.0, "z": 0.0}})
        self.assertEqual(self.post_json("/sensorlogger", push)[0], 200)
        res, data = self.request("GET", "/api/db/summary")
        for secret in (b"secret-device-123", b"secret-session-456", b"secret-user-789"):
            self.assertNotIn(secret, data)
        last = json.loads(data)["sensorLogger"]["last"]
        self.assertEqual({s["name"]: (s["role"], s["device"], s["count"], s["stored"]) for s in last["sensors"]},
                         {"headphone": ("stored", "airpods", 1, 1), "wrist motion": ("stored", "watch", 1, 1),
                          "battery": ("ignored", None, 1, 0), "gravity": ("helper", None, 1, 0)})
        self.assertEqual((last["test"], last["simulated"], last["readings"]), (False, False, 4))

        # AirPods readings from Sensor Logger before version 1.30 have no rotationRate: listed as unreadable
        old = {"payload": [{"name": "headphone", "time": NS + 80_000_000,
                            "values": {"roll": 0.1, "pitch": 0.0, "yaw": 0.2, "gravityX": 0, "gravityY": -9.8}}]}
        self.assertEqual(self.post_json("/sensorlogger", old), (200, {"ok": True, "samples": 0}))
        last = self.get_json("/api/db/summary")[1]["sensorLogger"]["last"]
        self.assertEqual([(s["name"], s["role"], s["stored"]) for s in last["sensors"]], [("headphone", "unreadable", 0)])

        # Simulated pushes name the simulated devices
        self.assertEqual(self.post_json("/sensorlogger?simulated=1", SL_PUSH)[0], 200)
        last = self.get_json("/api/db/summary")[1]["sensorLogger"]["last"]
        self.assertTrue(last["simulated"])
        self.assertIn(("headphone", "airpods (simulated)"), [(s["name"], s["device"]) for s in last["sensors"]])

        # Names come from the network: at most 20 are kept, each at most 40 characters
        many = {"payload": [{"name": f"sensor-{i:02d}-" + "x" * 60, "time": NS, "values": {}} for i in range(30)]}
        self.assertEqual(self.post_json("/sensorlogger", many)[0], 200)
        sl = self.get_json("/api/db/summary")[1]["sensorLogger"]
        self.assertEqual(len(sl["last"]["sensors"]), 20)
        self.assertTrue(all(len(s["name"]) <= 40 for s in sl["last"]["sensors"]))
        self.assertEqual((sl["pushes"], sl["tests"]), (5, 1))


class SensorLoggerConsoleTest(unittest.TestCase):
    def test_console_line_names_each_sensor_and_prints_only_on_change_or_test(self):
        lines = []
        log = app_server.SensorLoggerLog(log=lines.append)
        stored = {"airpods": [{}], "watch": [{}]}
        entry = log.note(SL_PUSH, stored, False)
        self.assertIn("headphone 1 -> airpods", lines[0])
        self.assertIn("wrist motion 1 -> watch", lines[0])
        self.assertIn("battery 1 not read", lines[0])
        log.note(SL_PUSH, stored, False)        # the same sensors again: no new line
        log.note({}, {}, False)                 # a connection test always prints
        log.note({}, {}, False)
        self.assertEqual(len(lines), 3)
        self.assertIn("connection test", lines[-1])
        unreadable = log.note({"payload": [{"name": "headphone", "time": NS, "values": {"roll": 0}}]}, {}, False)
        self.assertIn("NOT stored", log.describe(unreadable))
        self.assertEqual(entry["readings"], 3)
        # a name from the network cannot start a fake console line
        forged = log.note({"payload": [{"name": "x\n[04:00:00] airpods: 25 Hz\r", "time": NS, "values": {}}]}, {}, False)
        line = log.describe(forged)
        self.assertNotIn("\n", line)
        self.assertNotIn("\r", line)

    def test_console_ignores_count_swaps_but_reports_simulated_to_real(self):
        lines = []
        log = app_server.SensorLoggerLog(log=lines.append)
        def push(n_pods, n_watch):
            reading = lambda name: {"name": name, "time": NS, "values": {"rotationRateX": 0.1, "rotationRateY": 0,  # noqa: E731
                                                                          "rotationRateZ": 0, "gravityX": 0,
                                                                          "gravityY": -1, "gravityZ": 0}}
            return {"payload": [reading("headphone")] * n_pods + [reading("wrist motion")] * n_watch}
        for counts in ((25, 24), (24, 25), (25, 25), (26, 25)):  # the order by count flips; the sensors do not
            log.note(push(*counts), {"airpods (simulated)": [{}], "watch (simulated)": [{}]}, True)
        self.assertEqual(len(lines), 1)
        log.note(push(25, 25), {"airpods": [{}], "watch": [{}]}, False)  # real devices take over
        self.assertEqual(len(lines), 2)
        self.assertIn("-> airpods;", lines[-1] + ";")


# -------------------------------------------------------------------------------------------------- 4. walks

class WalkTest(Base):
    def test_post_duplicate_bad_id_and_too_large(self):
        status, reply = self.post_json("/api/walks", walk_body("walk-post-01"))
        self.assertEqual((status, reply), (201, {"ok": True, "id": "walk-post-01"}))
        self.assertEqual(self.post_json("/api/walks", walk_body("walk-post-01")), (200, {"ok": True, "duplicate": True}))
        for bad_id in ("short", "has space-123", "a" * 65, "semi;colon1", "trailing-newline\n"):
            status, reply = self.post_json("/api/walks", walk_body(bad_id))
            self.assertEqual(status, 400, bad_id)
            self.assertIs(reply["ok"], False)
            self.assertIn("id", reply["error"])
        # Too large: refused from the Content-Length header, before the body is read.
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        try:
            conn.putrequest("POST", "/api/walks")
            conn.putheader("Content-Type", "application/json")
            conn.putheader("Content-Length", str(app_server.WALK_MAX_BODY + 1))
            conn.endheaders()
            res = conn.getresponse()
            self.assertEqual(res.status, 413)
            self.assertIs(json.loads(res.read())["ok"], False)
        finally:
            conn.close()

    def test_other_validation_errors_give_400_in_plain_words(self):
        cases = [({"kind": "other"}, "kind"), ({"distance_m": 0}, "distance"), ({"distance_m": 101}, "distance"),
                 ({"distance_m": True}, "distance"), ({"result": None}, "result"), ({"recording": [1]}, "recording")]
        for change, word in cases:
            body = walk_body("walk-valid-01")
            body.update(change)
            status, reply = self.post_json("/api/walks", body)
            self.assertEqual(status, 400, change)
            self.assertIn(word, reply["error"].lower(), change)
        body = walk_body("walk-long-01", samples=0)
        body["recording"]["samples"] = [{"t": i} for i in range(app_server.WALK_MAX_SAMPLES + 1)]
        self.assertEqual(self.post_json("/api/walks", body)[0], 400)
        res, _ = self.request("POST", "/api/walks", raw=json.dumps(walk_body("walk-text-01")).encode(),
                              headers={"Content-Type": "text/plain"})
        self.assertEqual(res.status, 415)
        self.assertEqual(self.request("POST", "/api/walks", raw=b'{"kind": NaN}')[0].status, 400)
        self.assertEqual(self.get_json("/api/walks/walk-valid-01")[0], 404)

    def test_list_is_newest_first_and_get_by_id_rebuilds_the_recording(self):
        self.assertEqual(self.post_json("/api/walks", walk_body("walk-list-01", samples=4))[0], 201)
        time.sleep(0.01)
        no_rec = walk_body("walk-list-02")
        del no_rec["recording"]
        self.assertEqual(self.post_json("/api/walks", no_rec)[0], 201)
        status, listing = self.get_json("/api/walks")
        self.assertEqual(status, 200)
        ids = [w["id"] for w in listing["walks"]]
        self.assertLess(ids.index("walk-list-02"), ids.index("walk-list-01"))
        summary = {w["id"]: w for w in listing["walks"]}
        self.assertNotIn("recording", summary["walk-list-01"])
        self.assertIs(summary["walk-list-01"]["hasRecording"], True)
        self.assertIs(summary["walk-list-02"]["hasRecording"], False)
        self.assertRegex(summary["walk-list-01"]["receivedAt"], r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$")

        status, full = self.get_json("/api/walks/walk-list-01")
        self.assertEqual(status, 200)
        sent = walk_body("walk-list-01", samples=4)
        self.assertEqual(full["result"], sent["result"])
        self.assertEqual(full["recording"]["samples"], sent["recording"]["samples"])
        self.assertEqual({k: v for k, v in full["recording"].items() if k != "samples"},
                         {k: v for k, v in sent["recording"].items() if k != "samples"})
        self.assertEqual(self.get_json("/api/walks/walk-list-02")[1].get("recording"), None)
        self.assertEqual(self.get_json("/api/walks/not-a-walk-id")[0], 404)

    def test_recording_samples_are_stored_under_a_walk_session(self):
        self.assertEqual(self.post_json("/api/walks", walk_body("walk-sess-01", samples=5))[0], 201)
        self.assertEqual(self.query("SELECT device_id, kind, samples, label FROM sessions WHERE id = 'walk-walk-sess-01'"),
                         [("phone-walk", "walk", 5, "walk walk-sess-01")])
        self.assertEqual(self.query("SELECT COUNT(*) FROM samples WHERE session_id = 'walk-walk-sess-01'"), [(5,)])
        self.assertEqual(self.query("SELECT distance_m, placement, speed_mps, quality, simulated, has_recording"
                                    " FROM walks WHERE id = 'walk-sess-01'"),
                         [(10.0, "waist", 1.24, "good", 0, 1)])
        # A simulated walk is filed under a simulated device, so it is never shown as a real phone.
        self.assertEqual(self.post_json("/api/walks", walk_body("walk-sim-001", simulated=True))[0], 201)
        self.assertEqual(self.query("SELECT device_id FROM sessions WHERE id = 'walk-walk-sim-001'"),
                         [("phone-walk (simulated)",)])
        self.assertIs(self.get_json("/api/walks/walk-sim-001")[1]["simulated"], True)

    def test_summary_is_simulated_when_only_the_recording_says_so(self):
        # motion/CONTRACT.md section 5: "simulated": true when the stored recording says it is simulated
        body = walk_body("rec-sim-001")
        body["recording"]["simulated"] = True
        self.assertEqual(self.post_json("/api/walks", body)[0], 201)
        summaries = {w["id"]: w for w in self.get_json("/api/walks")[1]["walks"]}
        self.assertIs(summaries["rec-sim-001"].get("simulated"), True)
        self.assertEqual(self.query("SELECT simulated FROM walks WHERE id = 'rec-sim-001'"), [(1,)])
        self.assertEqual(self.query("SELECT simulated FROM devices WHERE id = 'phone-walk (simulated)'"), [(1,)])
        plain = walk_body("rec-real-001")
        self.assertEqual(self.post_json("/api/walks", plain)[0], 201)
        self.assertNotIn("simulated", {w["id"]: w for w in self.get_json("/api/walks")[1]["walks"]}["rec-real-001"])

    def test_info_lists_the_urls_and_the_database(self):
        status, info = self.get_json("/api/info")
        self.assertEqual(status, 200)
        self.assertEqual(info["httpPort"], self.port)
        self.assertIsNone(info["httpsPort"])
        self.assertEqual(info["phoneUrls"], [])           # no HTTPS, so no phone page would get motion data
        self.assertEqual(info["gyroPhoneUrls"], [])
        self.assertEqual(info["sensorLoggerUrls"], [f"http://192.0.2.10:{self.port}/sensorlogger"])
        self.assertEqual(info["laptopUrl"], f"http://localhost:{self.port}/")
        self.assertEqual(os.path.normcase(info["db"]), os.path.normcase(os.path.abspath(self.paths["db"])))


class WalkDeleteTest(Base):
    def test_delete_from_loopback_marks_walks_deleted_and_keeps_rows(self):
        for walk_id in ("del-walk-01", "del-walk-02"):
            self.assertEqual(self.post_json("/api/walks", walk_body(walk_id))[0], 201)
        with mock.patch.object(app_server, "is_loopback", return_value=False):
            res, data = self.request("DELETE", "/api/walks")
        self.assertEqual(res.status, 403)
        self.assertEqual(self.get_json("/api/walks/del-walk-01")[0], 200)

        res, data = self.request("DELETE", "/api/walks")
        self.assertEqual((res.status, json.loads(data)), (200, {"ok": True, "cleared": 2}))
        self.assertEqual(self.get_json("/api/walks"), (200, {"walks": []}))
        self.assertEqual(self.get_json("/api/walks/del-walk-01")[0], 404)
        rows = self.query("SELECT id, deleted_at IS NOT NULL FROM walks ORDER BY id")
        self.assertEqual(rows, [("del-walk-01", 1), ("del-walk-02", 1)])  # kept, marked deleted
        # A phone resending a cleared walk is told it is a duplicate, so it stops resending.
        self.assertEqual(self.post_json("/api/walks", walk_body("del-walk-01")), (200, {"ok": True, "duplicate": True}))
        self.assertEqual(self.post_json("/api/walks", walk_body("del-walk-03"))[0], 201)
        self.assertEqual(json.loads(self.request("DELETE", "/api/walks")[1]), {"ok": True, "cleared": 1})
        self.assertEqual(self.request("DELETE", "/api/other")[0].status, 404)

    def test_loopback_check(self):
        for addr in ("127.0.0.1", "::1", "127.0.0.2", "::ffff:127.0.0.1"):
            self.assertTrue(app_server.is_loopback(addr), addr)
        for addr in ("192.168.1.20", "10.0.0.5", "::ffff:192.168.1.2", "fe80::1%3", "0.0.0.0", "", None, "localhost"):
            self.assertFalse(app_server.is_loopback(addr), addr)


class WalkDeleteHostTest(Base):
    """Its own server, so the walks it stores do not change WalkDeleteTest's row list."""

    def test_delete_also_needs_a_localhost_host_header(self):
        # A tunnel forwards from 127.0.0.1, and a DNS-rebinding page in the laptop's browser connects from
        # 127.0.0.1, but both send their own host name. motion/CONTRACT.md section 5.
        self.assertEqual(self.post_json("/api/walks", walk_body("host-walk-01"))[0], 201)
        for host in ("evil.example", f"evil.example:{self.port}", "localhost.evil.example", f"192.168.1.20:{self.port}",
                     "127.0.0.1.nip.io", "", "localhost:80:80", "tunnel.localhost.run"):
            res, _ = self.request("DELETE", "/api/walks", headers={"Host": host})
            self.assertEqual(res.status, 403, host)
        self.assertEqual(self.get_json("/api/walks/host-walk-01")[0], 200)  # nothing was cleared
        # Two Host lines, the local one first: refused (RFC 9112 section 3.2), whatever the order
        for pair in (("localhost", "evil.example"), ("evil.example", "localhost")):
            raw = (f"DELETE /api/walks HTTP/1.1\r\nHost: {pair[0]}\r\nHost: {pair[1]}\r\n"
                   "Connection: close\r\n\r\n").encode("ascii")
            with socket.create_connection(("127.0.0.1", self.port), timeout=10) as sock:
                sock.sendall(raw)
                reply = b""
                while chunk := sock.recv(4096):
                    reply += chunk
            self.assertTrue(reply.startswith(b"HTTP/1.1 403") or reply.startswith(b"HTTP/1.0 403"), (pair, reply[:40]))
        self.assertEqual(self.get_json("/api/walks/host-walk-01")[0], 200)
        res, data = self.request("DELETE", "/api/walks", headers={"Host": f"localhost:{self.port}"})
        self.assertEqual((res.status, json.loads(data)["ok"]), (200, True))
        self.assertEqual(self.get_json("/api/walks/host-walk-01")[0], 404)

    def test_local_host_header_check(self):
        for value in ("localhost", "LOCALHOST:8765", "127.0.0.1", "127.0.0.1:8765", "[::1]", "[::1]:8443", " localhost "):
            self.assertTrue(app_server.is_local_host_header(value), value)
        for value in ("localhost.evil.example", "evil.example", "127.0.0.2", "::1", "[::1]x", "localhost:",
                      "localhost:abc", "", None, "127.0.0.1:8765:1", "xlocalhost"):
            self.assertFalse(app_server.is_local_host_header(value), value)


class InfoRefreshTest(Base):
    def test_info_looks_up_the_lan_addresses_again(self):
        app = self.srv.app
        url = lambda ip: [f"http://{ip}:{self.port}/sensorlogger"]  # noqa: E731
        self.assertEqual(self.get_json("/api/info")[1]["sensorLoggerUrls"], url("192.0.2.10"))  # fixed in tests
        addresses = iter([["198.51.100.7"], ["203.0.113.9"]])
        with mock.patch.object(app, "ips_fn", lambda: next(addresses)), \
                mock.patch.object(app_server.App, "INFO_REFRESH_S", 0.0):
            self.assertEqual(self.get_json("/api/info")[1]["sensorLoggerUrls"], url("198.51.100.7"))
            self.assertEqual(self.get_json("/api/info")[1]["sensorLoggerUrls"], url("203.0.113.9"))

            def no_network():
                raise OSError("no network")
            with mock.patch.object(app, "ips_fn", no_network):  # a failed lookup keeps the last answer
                status, info = self.get_json("/api/info")
            self.assertEqual((status, info["sensorLoggerUrls"]), (200, url("203.0.113.9")))
        self.assertEqual(self.srv.info["sensorLoggerUrls"], url("192.0.2.10"))  # the startup banner is unchanged


# ------------------------------------------------------------------------------------------- 5. home results

class HomeResultsTest(Base):
    ROWS = [
        {"id": "row-1", "date": "2026-11-08", "time": "07:12", "test": "gait_speed", "value": 1.24, "trial": 1,
         "person": "", "source": "phone-motion"},
        {"date": "2026-11-08", "time": "07:15", "test": "tap_right", "value": 52, "trial": 1, "person": "Ahmed"},
        {"date": "2026-11-08", "time": "07:15", "test": "tap_right", "value": 52, "trial": 1, "person": "Ahmed",
         "calibration": True},
    ]

    def test_upserts_without_duplicates(self):
        status, reply = self.post_json("/api/home-results", {"rows": self.ROWS})
        self.assertEqual(status, 200)
        self.assertEqual(reply, {"ok": True, "stored": 3, "new": 3, "total": 3, "skipped": 0})
        status, reply = self.post_json("/api/home-results", {"rows": self.ROWS})  # the same rows again
        self.assertEqual(reply, {"ok": True, "stored": 3, "new": 0, "total": 3, "skipped": 0})
        changed = dict(self.ROWS[0], value=1.31)
        status, reply = self.post_json("/api/home-results", {"rows": [changed, "not a row"]})
        self.assertEqual(reply, {"ok": True, "stored": 1, "new": 0, "total": 3, "skipped": 1})
        self.assertEqual(self.query("SELECT value, test, source FROM home_results WHERE id = 'row-1'"),
                         [(1.31, "gait_speed", "phone-motion")])
        self.assertEqual(json.loads(self.query("SELECT payload FROM home_results WHERE id = 'row-1'")[0][0]), changed)
        self.assertEqual(self.get_json("/api/db/summary")[1]["home_results"], 3)

    def test_bad_bodies(self):
        self.assertEqual(self.post_json("/api/home-results", {"rows": "x"})[0], 400)
        self.assertEqual(self.post_json("/api/home-results", [1])[0], 400)
        res, _ = self.request("POST", "/api/home-results", raw=b'{"rows": []}', headers={"Content-Type": "text/plain"})
        self.assertEqual(res.status, 415)


# ---------------------------------------------------------------------------------------------- 6. read API

class ReadApiTest(Base):
    def test_summary_samples_and_session_csv_return_what_was_stored(self):
        first = [{"t": 1.0, "gx": 1.0, "ax": 0.5}, {"t": 2.0, "gx": 2.0, "ax": 0.5}, {"t": 3.0, "gx": 3.0, "ax": 0.5}]
        later = [{"t": 4.0, "gx": 4.0, "ax": -0.5}, {"t": 5.0, "gx": 5.0, "ax": -0.5}]
        self.request("POST", "/ingest", {"source": "reader-phone", "samples": first})
        time.sleep(0.02)
        self.request("POST", "/ingest", {"source": "reader-phone", "samples": later})

        status, s = self.get_json("/api/db/summary")
        self.assertEqual(status, 200)
        self.assertEqual(set(s["counts"]), {"devices", "sessions", "samples", "events", "walks", "home_results"})
        self.assertEqual(s["counts"]["samples"], self.query("SELECT COUNT(*) FROM samples")[0][0])
        self.assertGreater(s["db"]["bytes"], 0)
        dev = {d["id"]: d for d in s["devices"]}["reader-phone"]
        self.assertEqual((dev["kind"], dev["samples"], dev["simulated"]), ("phone", 5, False))
        self.assertEqual(dev["rate_hz"], 1.0)             # 5 samples in the last 5 s
        self.assertLess(dev["seconds_since_last"], 5)
        session = [x for x in s["sessions"] if x["device_id"] == "reader-phone"][0]
        self.assertEqual((session["kind"], session["samples"]), ("stream", 5))
        self.assertIn("newest_walk", s)

        status, got = self.get_json("/api/db/samples?device=reader-phone&limit=3")
        self.assertEqual([r["t_ms"] for r in got["samples"]], [3.0, 4.0, 5.0])  # newest 3, oldest first
        self.assertEqual(got["samples"][-1]["gx"], 5.0)
        since = got["samples"][0]["received_at"]           # when the first batch arrived
        status, got = self.get_json(f"/api/db/samples?device=reader-phone&since={since!r}")
        self.assertEqual([r["t_ms"] for r in got["samples"]], [4.0, 5.0])

        res, data = self.request("GET", session["csv_url"])
        self.assertEqual(res.status, 200)
        self.assertIn("text/csv", res.getheader("Content-Type"))
        self.assertIn("attachment", res.getheader("Content-Disposition"))
        rows = list(csv.reader(io.StringIO(data.decode("utf-8"))))
        self.assertEqual(rows[0], list(db.SAMPLE_COLUMNS))
        self.assertEqual([float(r[2]) for r in rows[1:]], [1.0, 2.0, 3.0, 4.0, 5.0])
        self.assertEqual([r[rows[0].index("ax")] for r in rows[1:]], ["0.5", "0.5", "0.5", "-0.5", "-0.5"])
        self.assertEqual(rows[1][rows[0].index("gy")], "")  # missing values are empty cells

    def test_samples_and_csv_errors(self):
        self.assertEqual(self.get_json("/api/db/samples")[0], 400)
        self.assertEqual(self.get_json("/api/db/samples?device=x&limit=lots")[0], 400)
        self.assertEqual(self.get_json("/api/db/samples?device=nobody")[1]["samples"], [])
        self.assertEqual(self.request("GET", "/api/db/sessions/s-nope.csv")[0].status, 404)
        self.assertEqual(self.request("GET", "/api/db/sessions/..%2f..%2fx.csv")[0].status, 404)
        self.assertEqual(self.get_json("/api/nothing-here")[0], 404)

    def test_health_cors_and_no_store(self):
        res, data = self.request("GET", "/api/health")
        health = json.loads(data)
        self.assertEqual({k: health[k] for k in ("ok", "server", "version", "db", "https", "httpsPort")},
                         {"ok": True, "server": "rfn-one-server", "version": 1, "db": True, "https": False,
                          "httpsPort": None})
        self.assertIn("time", health)
        for path in ("/api/health", "/api/info", "/api/walks", "/api/db/summary", "/api/nothing-here"):
            res, _ = self.request("GET", path)
            self.assertEqual(res.getheader("Access-Control-Allow-Origin"), "*", path)
        for method, path, body in (("GET", "/", None), ("GET", "/nope.html", None), ("GET", "/favicon.ico", None),
                                   ("GET", "/stats", None), ("POST", "/ingest", {"source": "h", "samples": []}),
                                   ("POST", "/api/walks", {"kind": "x"}), ("GET", "/api/info", None)):
            res, _ = self.request(method, path, body)
            self.assertEqual(res.getheader("Cache-Control"), "no-store", f"{method} {path}")


# ------------------------------------------------------------------------------------------ 7. static files

class StaticTest(Base):
    def read(self, *parts):
        with open(os.path.join(*parts), "rb") as f:
            return f.read()

    def test_root_gives_the_app_index(self):
        res, data = self.request("GET", "/")
        self.assertEqual(res.status, 200)
        self.assertIn("text/html", res.getheader("Content-Type"))
        self.assertEqual(data, self.read(app_server.APP_DIR, "index.html"))
        self.assertEqual(self.request("GET", "/index.html")[1], data)

    def test_gyro_pages(self):
        res, data = self.request("GET", "/gyro/phone.html")
        self.assertEqual(res.status, 200)
        self.assertIn(b"Start motion sensors", data)
        self.assertEqual(data, self.read(app_server.GYRO_STATIC_DIR, "phone.html"))
        self.assertEqual(self.request("GET", "/gyro/")[1], self.read(app_server.GYRO_STATIC_DIR, "index.html"))
        self.assertIn("javascript", self.request("GET", "/gyro/phone.js")[0].getheader("Content-Type"))
        res, _ = self.request("GET", "/gyro?gap=200")  # relative URLs on its pages need the trailing slash
        self.assertEqual((res.status, res.getheader("Location")), (302, "/gyro/?gap=200"))

    def test_motion_folder_gives_404_until_it_exists_and_never_lists(self):
        motion = self.paths["motion"]
        self.assertFalse(os.path.exists(motion))
        self.assertEqual(self.request("GET", "/motion/walk.html")[0].status, 404)
        self.assertEqual(self.request("GET", "/motion/")[0].status, 404)
        os.makedirs(motion)
        with open(os.path.join(motion, "walk.html"), "wb") as f:
            f.write(b"<p>walk page</p>")
        res, data = self.request("GET", "/motion/walk.html")
        self.assertEqual((res.status, data), (200, b"<p>walk page</p>"))
        self.assertEqual(self.request("GET", "/motion/")[0].status, 404)  # no index.html: 404, not a listing
        with open(os.path.join(motion, "index.html"), "wb") as f:
            f.write(b"<p>motion index</p>")
        self.assertEqual(self.request("GET", "/motion/")[1], b"<p>motion index</p>")
        for name, ctype in (("a.mjs", "text/javascript"), ("m.webmanifest", "application/manifest+json"),
                            ("f.woff2", "font/woff2"), ("b.js", "text/javascript")):
            with open(os.path.join(motion, name), "wb") as f:
                f.write(b"x")
            self.assertIn(ctype, self.request("GET", f"/motion/{name}")[0].getheader("Content-Type"), name)

    def test_traversal_and_private_files_are_refused(self):
        spec = self.read(SERVER_DIR, "SPEC.md")
        for path in ("/../server/SPEC.md", "/%2e%2e/data/rfn.sqlite", "/data/rfn.sqlite", "/server/SPEC.md",
                     "/gyro/../server/SPEC.md", "/gyro/%2e%2e/server.py", "/motion/..%2f..%2fserver%2fSPEC.md",
                     "/%5c..%5cserver%5cSPEC.md", "/..\\server\\SPEC.md", "/C:/Windows/win.ini",
                     "/gyro/../.certs/key.pem", "/.certs/key.pem", "/%2e%2e%2f%2e%2e%2frun.py", "/%252e%252e/run.py",
                     "/nope.html"):
            res, data = self.request("GET", path)
            self.assertIn(res.status, (403, 404), path)
            self.assertNotEqual(data, spec, path)
        self.assertEqual(self.request("GET", "/../server/SPEC.md")[0].status, 403)
        self.assertEqual(self.request("GET", "/%2e%2e/data/rfn.sqlite")[0].status, 403)
        self.assertEqual(self.request("GET", "/js/")[0].status, 404)  # an app folder without index.html: no listing

    def test_favicon_and_head(self):
        self.assertEqual(self.request("GET", "/favicon.ico")[0].status, 204)
        res, data = self.request("HEAD", "/gyro/phone.html")
        self.assertEqual((res.status, data), (200, b""))
        self.assertEqual(res.getheader("Content-Length"), str(len(self.read(app_server.GYRO_STATIC_DIR, "phone.html"))))


# ---------------------------------------------------------------------------------------- 8. event streams

def read_until(res, predicate, limit=200):
    """Read SSE lines until predicate(line) is true; returns the lines read."""
    lines = []
    for _ in range(limit):
        line = res.fp.readline()
        if not line:
            break
        lines.append(line.decode("utf-8").rstrip("\n"))
        if predicate(lines[-1]):
            return lines
    raise AssertionError(f"stream ended or never matched; got {lines}")


class EventStreamTest(Base):
    def test_events_deliver_a_batch_after_an_ingest(self):
        for path, source in (("/events", "sse-test-root"), ("/gyro/events", "sse-test-gyro")):
            conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
            try:
                conn.request("GET", path)
                res = conn.getresponse()
                self.assertIn("text/event-stream", res.getheader("Content-Type"))
                self.assertEqual(res.getheader("Cache-Control"), "no-store")
                read_until(res, lambda line: line.startswith("retry:"))  # subscribed from here on
                sample = {"t": 12.5, "gx": 1.5, "gy": -2.0, "gz": 30.0}
                self.assertEqual(self.request("POST", "/ingest", {"source": source, "samples": [sample]})[0].status, 204)
                lines = read_until(res, lambda line: line.startswith("data: ") and f'"source":"{source}"' in line)
                msg = json.loads(lines[-1][6:])
                self.assertEqual((msg["type"], msg["samples"]), ("batch", [sample]))
                read_until(res, lambda line: line == ": keep-alive")  # ping interval is 0.3 s in these tests
            finally:
                conn.close()
        self.assertEqual(self.query("SELECT COUNT(*) FROM samples WHERE device_id LIKE 'sse-test-%'"), [(2,)])

    def test_api_events_say_hello_then_announce_each_new_walk(self):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        try:
            conn.request("GET", "/api/events")
            res = conn.getresponse()
            self.assertEqual(res.getheader("Access-Control-Allow-Origin"), "*")
            lines = read_until(res, lambda line: line.startswith("data: "))
            self.assertIn("event: hello", lines)
            self.assertEqual(json.loads(lines[-1][6:]), {"walks": self.srv.app.db.walk_count()})
            self.assertEqual(self.post_json("/api/walks", walk_body("sse-walk-01"))[0], 201)
            lines = read_until(res, lambda line: line.startswith("data: ") and "sse-walk-01" in line)
            self.assertEqual(lines[-2], "event: walk")
            summary = json.loads(lines[-1][6:])
            self.assertEqual((summary["id"], summary["hasRecording"]), ("sse-walk-01", True))
            self.assertNotIn("recording", summary)
            read_until(res, lambda line: line == ": ping")
        finally:
            conn.close()


# --------------------------------------------------------------------------------------------- 9. sessions

class SessionGapTest(unittest.TestCase):
    def test_a_session_splits_after_a_20_s_gap_and_carries_on_after_a_restart(self):
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as d:
            path = os.path.join(d, "gap.sqlite")
            first = db.Database(path, session_gap_s=20)
            s1 = first.write_batch("gap-dev", [{"t": 1}], received_at=1000.0)
            s2 = first.write_batch("gap-dev", [{"t": 2}, {"t": 3}], received_at=1010.0)   # 10 s later: same
            s3 = first.write_batch("gap-dev", [{"t": 4}], received_at=1031.0)             # 21 s gap: new
            s4 = first.write_batch("gap-dev", [{"t": 5}], received_at=1051.0)             # exactly 20 s: same
            self.assertIsNone(first.write_batch("gap-dev", [], [{"type": "button"}], received_at=1052.0))
            self.assertEqual(s1, s2)
            self.assertNotEqual(s2, s3)
            self.assertEqual(s3, s4)
            self.assertRegex(s1, r"^s-\d{8}-\d{6}-gap-dev-[0-9a-f]{4}$")
            first.close()
            second = db.Database(path, session_gap_s=20)                                 # the server restarted
            self.assertEqual(second.write_batch("gap-dev", [{"t": 6}], received_at=1060.0), s3)
            self.assertNotEqual(second.write_batch("gap-dev", [{"t": 7}], received_at=1200.0), s3)
            second.close()
            conn = sqlite3.connect(path)
            try:
                rows = conn.execute("SELECT id, started_at, ended_at, samples FROM sessions ORDER BY started_at").fetchall()
                self.assertEqual([r[1:] for r in rows], [(1000.0, 1010.0, 3), (1031.0, 1060.0, 3), (1200.0, 1200.0, 1)])
                self.assertEqual(conn.execute("SELECT samples, first_seen, last_seen FROM devices").fetchall(),
                                 [(7, 1000.0, 1200.0)])
                self.assertEqual(conn.execute("SELECT COUNT(*) FROM events").fetchone(), (1,))
            finally:
                conn.close()


class SessionGapOverHttpTest(Base):
    session_gap_s = 0.3  # configurable, so the test does not wait 20 s

    def test_the_next_sample_after_the_gap_starts_a_new_session(self):
        for _ in range(2):
            self.request("POST", "/ingest", {"source": "gap-phone", "samples": [{"t": 1, "gx": 1}]})
        time.sleep(0.6)
        self.request("POST", "/ingest", {"source": "gap-phone", "samples": [{"t": 2, "gx": 1}]})
        rows = self.query("SELECT samples FROM sessions WHERE device_id = 'gap-phone' ORDER BY started_at")
        self.assertEqual(rows, [(2,), (1,)])


# ---------------------------------------------------------------------------------------------------- HTTPS

class HttpsTest(Base):
    https = True

    def test_https_serves_phone_pages_and_shares_one_database(self):
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        ctx.load_verify_locations(os.path.join(self.paths["certs"], "cert.pem"))  # also proves 127.0.0.1 is named
        untrusting = http.client.HTTPSConnection("127.0.0.1", self.srv.https_port, timeout=10,
                                                 context=ssl.create_default_context())
        with self.assertRaises(ssl.SSLError):  # like a phone before you click through the warning
            untrusting.request("GET", "/")
        untrusting.close()
        conn = http.client.HTTPSConnection("127.0.0.1", self.srv.https_port, timeout=10, context=ctx)
        try:
            conn.request("GET", "/gyro/phone.html")
            res = conn.getresponse()
            self.assertEqual(res.status, 200)
            self.assertIn(b"Start motion sensors", res.read())
            conn.request("POST", "/gyro/ingest", body=json.dumps({"source": "https-phone", "samples": [{"t": 1, "gx": 2}]}),
                         headers={"Content-Type": "application/json"})
            res = conn.getresponse()
            res.read()
            self.assertEqual(res.status, 204)
        finally:
            conn.close()
        self.assertEqual(self.query("SELECT samples FROM devices WHERE id = 'https-phone'"), [(1,)])
        status, info = self.get_json("/api/info")  # over plain HTTP: the same app behind both listeners
        port = self.srv.https_port
        self.assertEqual(info["phoneUrls"], [f"https://192.0.2.10:{port}/motion/walk.html"])
        self.assertEqual(info["gyroPhoneUrls"], [f"https://192.0.2.10:{port}/gyro/phone.html"])
        self.assertEqual(info["httpsPort"], port)
        self.assertIs(self.get_json("/api/health")[1]["https"], True)

    def test_banner_prints_every_url_the_spec_asks_for(self):
        text = "\n".join(app_server.banner_lines(self.srv))
        port, https_port = self.port, self.srv.https_port
        for want in (f"App (laptop): http://localhost:{port}/",
                     f"Phone motion stream: https://192.0.2.10:{https_port}/gyro/phone.html",
                     f"Phone walk test: https://192.0.2.10:{https_port}/motion/walk.html",
                     f"Sensor Logger HTTP push URL (AirPods, Watch, phone): http://192.0.2.10:{port}/sensorlogger",
                     f"Database: {self.srv.app.db.path}", "New-NetFirewallRule", f"-LocalPort {port},{https_port}"):
            self.assertIn(want, text)


# ------------------------------------------------------------------------------------- command line and ports

class CommandLineTest(unittest.TestCase):
    def test_run_py_prints_the_urls_and_stops_cleanly(self):
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as d:
            db_path = os.path.join(d, "cli.sqlite")
            cmd = [sys.executable, os.path.join(PROJECT_DIR, "run.py"), "--port", "0", "--no-https",
                   "--host", "127.0.0.1", "--db", db_path]
            flags = subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0
            proc = subprocess.Popen(cmd, cwd=PROJECT_DIR, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                    text=True, creationflags=flags)
            lines: queue.Queue = queue.Queue()
            reader = threading.Thread(target=lambda: [lines.put(x) for x in proc.stdout], daemon=True)
            reader.start()
            out, port = [], None
            try:
                deadline = time.time() + 30
                while time.time() < deadline:
                    try:
                        line = lines.get(timeout=1)
                    except queue.Empty:
                        continue
                    out.append(line)
                    m = re.search(r"App \(laptop\): http://localhost:(\d+)/", line)
                    port = int(m.group(1)) if m else port
                    if "Stop with Ctrl+C" in line:
                        break
                self.assertIsNotNone(port, "".join(out))
                conn = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
                conn.request("POST", "/ingest", body=json.dumps({"source": "cli-phone", "samples": [{"t": 1, "gx": 1}]}),
                             headers={"Content-Type": "application/json"})
                self.assertEqual(conn.getresponse().status, 204)
                conn.close()
                try:  # Ctrl+C. On Windows a new process group only gets Ctrl+Break; the server treats both alike.
                    proc.send_signal(signal.CTRL_BREAK_EVENT if os.name == "nt" else signal.SIGINT)
                except OSError as err:
                    self.skipTest(f"cannot send Ctrl+Break from here: {err}")
                proc.wait(timeout=20)
            finally:
                if proc.poll() is None:
                    proc.kill()
                    proc.wait()
            reader.join(10)  # the rest of the output, up to the end of the stream
            proc.stdout.close()
            while not lines.empty():
                out.append(lines.get())
            text = "".join(out)
            self.assertEqual(proc.returncode, 0, text)
            self.assertIn("Stopping...", text)
            self.assertIn("Stopped.", text)
            conn = sqlite3.connect(db_path)
            try:
                self.assertEqual(conn.execute("SELECT samples FROM devices WHERE id = 'cli-phone'").fetchall(), [(1,)])
            finally:
                conn.close()
            self.assertFalse(os.path.exists(db_path + "-wal") and os.path.getsize(db_path + "-wal") > 0)

    def test_a_port_already_in_use_is_refused_not_shared(self):
        # Windows would otherwise let 0.0.0.0:<port> bind next to another server's 127.0.0.1:<port>.
        holder = socket.socket()
        holder.bind(("127.0.0.1", 0))
        holder.listen(1)
        port = holder.getsockname()[1]
        try:
            with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as d:
                with self.assertRaises(OSError):
                    srv = app_server.make_servers(os.path.join(d, "x.sqlite"), host="0.0.0.0", port=port,
                                                  https_port=None, ips=[])
                    srv.stop()  # only reached if the bind wrongly succeeded
        finally:
            holder.close()


# --------------------------------------------------------------------------------------------- simulator

class SimulatorTest(Base):
    def test_simulator_stores_every_simulated_device_and_a_walk(self):
        proc = subprocess.run([sys.executable, os.path.join(SERVER_DIR, "simulate.py"), "--url",
                               f"http://127.0.0.1:{self.port}", "--seconds", "1", "--walk"],
                              capture_output=True, text=True, timeout=60)
        self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
        self.assertIn("OK: rows are stored", proc.stdout)
        rows = dict(self.query("SELECT id, samples FROM devices WHERE simulated = 1"))
        self.assertEqual(rows["airpods (simulated)"], 25)   # 1 s at about 25 Hz
        self.assertEqual(rows["watch (simulated)"], 50)     # about 50 Hz
        self.assertEqual(rows["phone (simulated)"], 60)     # about 60 Hz
        self.assertGreater(rows["phone-walk (simulated)"], 0)
        self.assertEqual(self.query("SELECT COUNT(*) FROM devices WHERE simulated = 0"), [(0,)])
        walks = self.query("SELECT simulated, has_recording, json_extract(result, '$.simulated') FROM walks")
        self.assertEqual(walks, [(1, 1, 1)])
        pods = self.query("SELECT MAX(ABS(gz)) FROM samples WHERE device_id = 'airpods (simulated)'")[0][0]
        self.assertGreater(pods, 1.0)  # head turns show up as turning speed (deg/s)


# ------------------------------------------------------------------------------------- adversarial review

def _strict_loads(data: bytes):
    """Parse as a browser's JSON.parse would: NaN and Infinity are errors."""
    def refuse(name):
        raise ValueError(f"{name} is not JSON")
    return json.loads(data, parse_constant=refuse)


class HostileInputTest(Base):
    def test_overflowing_numbers_are_refused_so_every_reply_stays_strict_json(self):
        body = walk_body("overflow-01")
        body["result"]["speed_mps"] = 1.0
        raw = json.dumps(body).replace('"speed_mps": 1.0', '"speed_mps": 1e999').encode("utf-8")
        res, data = self.request("POST", "/api/walks", raw=raw)
        self.assertEqual(res.status, 400, data)
        res, data = self.request("POST", "/api/home-results", raw=b'{"rows": [{"test": "tap", "value": -1e999}]}')
        self.assertEqual(res.status, 400, data)
        res, data = self.request("GET", "/api/walks")
        self.assertEqual(res.status, 200)
        _strict_loads(data)  # raises if any stored walk came back as Infinity
        self.assertEqual(self.query("SELECT COUNT(*) FROM walks WHERE id = 'overflow-01'"), [(0,)])

    def test_sensor_logger_time_too_large_gives_400_not_a_dropped_connection(self):
        push = {"payload": [{"name": "headphone", "time": 10 ** 400,
                             "values": {"rotationRateX": 1, "rotationRateY": 1, "rotationRateZ": 1}}]}
        res, data = self.request("POST", "/sensorlogger", raw=json.dumps(push).encode("utf-8"))
        self.assertEqual(res.status, 400, data)

    def test_an_oversized_body_sent_in_full_still_reads_413(self):
        # A browser uploads the whole body before it reads the reply; it must get the 413 (walk.js then drops
        # the recording and resends), not a reset connection.
        raw = b'{"pad": "' + b"x" * (app_server.WALK_MAX_BODY + 10) + b'"}'
        res, data = self.request("POST", "/api/walks", raw=raw)
        self.assertEqual(res.status, 413)
        self.assertIs(json.loads(data)["ok"], False)


class ConsoleEncodingTest(unittest.TestCase):
    def test_unicode_device_names_and_walk_results_do_not_stop_run_py(self):
        # Output to a pipe on Windows is cp1252. A phone named with an emoji used to raise UnicodeEncodeError in
        # the console rate line (5 s later) and stop the whole server.
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as d:
            cmd = [sys.executable, os.path.join(PROJECT_DIR, "run.py"), "--port", "0", "--no-https",
                   "--host", "127.0.0.1", "--db", os.path.join(d, "enc.sqlite")]
            env = dict(os.environ, PYTHONIOENCODING="cp1252", PYTHONUTF8="0")
            flags = subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0
            proc = subprocess.Popen(cmd, cwd=PROJECT_DIR, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                    env=env, creationflags=flags)
            lines: queue.Queue = queue.Queue()
            reader = threading.Thread(target=lambda: [lines.put(x) for x in proc.stdout], daemon=True)
            reader.start()
            out, port = [], None
            try:
                deadline = time.time() + 30
                while time.time() < deadline and port is None:
                    try:
                        line = lines.get(timeout=1).decode("cp1252", "replace")
                    except queue.Empty:
                        continue
                    out.append(line)
                    m = re.search(r"App \(laptop\): http://localhost:(\d+)/", line)
                    port = int(m.group(1)) if m else None
                self.assertIsNotNone(port, "".join(out))

                def post(path, obj):
                    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
                    try:
                        conn.request("POST", path, body=json.dumps(obj), headers={"Content-Type": "application/json"})
                        res = conn.getresponse()
                        res.read()
                        return res.status
                    finally:
                        conn.close()

                self.assertEqual(post("/ingest", {"source": "Ahmed’s \U0001F4F1", "samples": [{"t": 1, "gx": 1}]}), 204)
                body = walk_body("unicode-walk-1")
                body["result"]["quality"] = "хорошо \U0001F6B6"
                self.assertEqual(post("/api/walks", body), 201)
                end = time.time() + 6.5  # past the first 5 s console rate line, with the emoji device still live
                while time.time() < end:
                    post("/ingest", {"source": "Ahmed’s \U0001F4F1", "samples": [{"t": 2, "gx": 1}]})
                    time.sleep(0.5)
                self.assertIsNone(proc.poll(), "the server stopped")
                conn = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
                conn.request("GET", "/api/health")
                self.assertEqual(conn.getresponse().status, 200)
                conn.close()
                try:
                    proc.send_signal(signal.CTRL_BREAK_EVENT if os.name == "nt" else signal.SIGINT)
                except OSError as err:
                    self.skipTest(f"cannot send Ctrl+Break from here: {err}")
                proc.wait(timeout=20)
            finally:
                if proc.poll() is None:
                    proc.kill()
                    proc.wait()
            reader.join(10)
            proc.stdout.close()
            while not lines.empty():
                out.append(lines.get().decode("cp1252", "replace"))
            text = "".join(out)
            self.assertEqual(proc.returncode, 0, text)
            self.assertIn("\\U0001f4f1", text)  # the emoji, escaped, in the rate line
            self.assertNotIn("Traceback", text)


if __name__ == "__main__":
    unittest.main()
