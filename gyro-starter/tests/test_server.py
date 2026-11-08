"""Tests for the gyro starter relay. Run from the gyro-starter folder:  python -m unittest discover -s tests -v"""
import csv
import http.client
import json
import os
import re
import socket
import ssl
import sys
import tempfile
import threading
import time
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import server  # noqa: E402


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class RelayTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.hub = server.Hub(recordings_dir=os.path.join(cls.tmp.name, "recordings"))
        cls.port = free_port()
        cls.srv = server.make_server("127.0.0.1", cls.port, cls.hub)
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()
        cls.srv.server_close()
        cls.tmp.cleanup()

    def request(self, method, path, body=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        payload = json.dumps(body) if isinstance(body, (dict, list)) else body
        conn.request(method, path, body=payload, headers={"Content-Type": "application/json"} if body is not None else {})
        res = conn.getresponse()
        data = res.read()
        conn.close()
        return res.status, res.getheader("Content-Type") or "", data

    def test_pages_are_served(self):
        for page in ("/", "/phone.html", "/screen.html", "/phone.js", "/screen.js", "/style.css"):
            status, _, data = self.request("GET", page)
            self.assertEqual(status, 200, page)
            self.assertTrue(data, page)
        self.assertIn("text/html", self.request("GET", "/phone.html")[1])
        self.assertIn("javascript", self.request("GET", "/phone.js")[1])

    def test_files_outside_static_are_not_served(self):
        for path in ("/../server.py", "/..%2fserver.py", "/static/../server.py", "/..\\server.py",
                     "/C:/Windows/win.ini", "/nope.html"):
            self.assertEqual(self.request("GET", path)[0], 404, path)

    def test_ingest_rejects_bad_bodies(self):
        self.assertEqual(self.request("POST", "/ingest", "not json")[0], 400)
        self.assertEqual(self.request("POST", "/ingest", [1, 2])[0], 400)
        self.assertEqual(self.request("POST", "/ingest", {"samples": "x"})[0], 400)
        self.assertEqual(self.request("POST", "/ingest", {"source": "empty", "samples": []})[0], 204)
        self.assertEqual(self.request("POST", "/nowhere", {})[0], 404)

    def test_keep_alive_connection_carries_many_posts(self):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        for i in range(20):
            conn.request("POST", "/ingest", body=json.dumps({"source": "keepalive", "samples": [{"t": i, "gx": i}]}),
                         headers={"Content-Type": "application/json"})
            res = conn.getresponse()
            res.read()
            self.assertEqual(res.status, 204)
        conn.close()
        stats = json.loads(self.request("GET", "/stats")[2])
        self.assertEqual(stats["sources"]["keepalive"]["samples"], 20)

    def test_viewer_receives_samples_and_buttons(self):
        received = []
        ready = threading.Event()

        def viewer():
            conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
            conn.request("GET", "/events")
            res = conn.getresponse()
            self.assertIn("text/event-stream", res.getheader("Content-Type"))
            ready.set()
            while not received:
                line = res.fp.readline()
                if not line:
                    break
                if line.startswith(b"data: "):
                    msg = json.loads(line[6:])
                    if msg.get("type") == "batch" and msg.get("source") == "viewer-test":
                        received.append(msg)
            conn.close()

        t = threading.Thread(target=viewer, daemon=True)
        t.start()
        self.assertTrue(ready.wait(5))
        for _ in range(100):  # wait until the hub has registered the stream
            if self.hub.viewer_count:
                break
            time.sleep(0.02)
        sample = {"t": 12.5, "gx": 1.5, "gy": -2.0, "gz": 30.0, "ax": 0.1, "ay": 0.2, "az": 9.81}
        status = self.request("POST", "/ingest", {
            "source": "viewer-test", "samples": [sample], "events": [{"type": "button", "id": "A", "down": True}],
        })[0]
        self.assertEqual(status, 204)
        t.join(5)
        self.assertEqual(len(received), 1)
        self.assertEqual(received[0]["samples"][0], sample)
        self.assertEqual(received[0]["events"][0]["id"], "A")

    def test_recording_writes_csv(self):
        status, _, data = self.request("POST", "/record", {"on": True})
        self.assertEqual(status, 200)
        path = json.loads(data)["path"]
        self.request("POST", "/ingest", {
            "source": "rec-test",
            "samples": [{"t": 1.0, "gx": 1, "az": 9.8}, {"t": 2.0, "gx": 2, "az": 9.8}],
            "events": [{"t": 1.5, "type": "button", "id": "A", "down": True}],
        })
        status, _, data = self.request("POST", "/record", {"on": False})
        result = json.loads(data)["result"]
        self.assertEqual(result["rows"], 3)
        with open(path, newline="", encoding="utf-8") as f:
            rows = list(csv.reader(f))
        header = rows[0]
        self.assertEqual(header[:3], ["server_time", "source", "kind"])
        self.assertEqual(header[3:-1], server.FIELDS)
        self.assertTrue(all(len(r) == len(header) for r in rows))
        kinds = [r[2] for r in rows[1:]]
        self.assertEqual(kinds, ["sample", "sample", "event"])
        self.assertEqual(rows[1][header.index("gx")], "1")
        self.assertEqual(json.loads(rows[3][-1])["id"], "A")


class SensorLoggerTest(unittest.TestCase):
    """Sensor Logger's documented push: times in UTC epoch ns, turning speeds in rad/s, watch gravity in g."""

    PUSH = {
        "messageId": 7, "sessionId": "s1", "deviceId": "d1",
        "payload": [
            {"name": "gyroscope", "time": 1_700_000_000_020_000_000, "values": {"x": 0.0, "y": 0.0, "z": 1.0}},
            {"name": "gravity", "time": 1_700_000_000_010_000_000, "values": {"x": 0.0, "y": 0.0, "z": -9.81}},
            {"name": "headphone", "time": 1_700_000_000_030_000_000, "values": {
                "devicelocation": "left", "roll": 0.1, "yaw": 0.2, "pitch": 0.3,
                "rotationRateX": 0.5, "rotationRateY": -0.25, "rotationRateZ": 2.0,
                "quaternionW": 1, "quaternionX": 0, "quaternionY": 0, "quaternionZ": 0,
                "gravityX": 0.0, "gravityY": -9.80665, "gravityZ": 0.0,
                "accelerationX": 0.0, "accelerationY": 0.0, "accelerationZ": 0.0}},
            {"name": "wrist motion", "time": 1_700_000_000_040_000_000, "values": {
                "rotationRateX": -1.0, "rotationRateY": 0.0, "rotationRateZ": 0.0,
                "gravityX": 0.0, "gravityY": 0.0, "gravityZ": -1.0,
                "accelerationX": 0.0, "accelerationY": 0.0, "accelerationZ": 0.0,
                "quaternionW": 1, "quaternionX": 0, "quaternionY": 0, "quaternionZ": 0}},
            {"name": "battery", "time": 1_700_000_000_050_000_000, "values": {"batteryLevel": 0.5}},
        ],
    }

    def test_conversion(self):
        out = server.from_sensor_logger(self.PUSH)
        self.assertEqual(set(out), {"phone (Sensor Logger)", "airpods", "watch"})
        phone = out["phone (Sensor Logger)"][0]
        self.assertAlmostEqual(phone["gz"], 57.296, places=3)            # 1 rad/s -> deg/s
        self.assertEqual(phone["t"], 1_700_000_000_020.0)                 # ns -> ms
        self.assertEqual((phone["ax"], phone["ay"], phone["az"]), (0.0, 0.0, -9.81))  # latest phone gravity attached
        pods = out["airpods"][0]
        self.assertAlmostEqual(pods["gx"], 28.648, places=3)
        self.assertAlmostEqual(pods["gy"], -14.324, places=3)
        self.assertAlmostEqual(pods["gz"], 114.592, places=3)
        self.assertAlmostEqual(pods["ay"], -9.80665, places=4)            # already m/s^2: unchanged
        watch = out["watch"][0]
        self.assertAlmostEqual(watch["gx"], -57.296, places=3)
        self.assertAlmostEqual(watch["az"], -9.80665, places=4)           # g -> m/s^2

    def test_bad_and_empty_pushes(self):
        with self.assertRaises(ValueError):
            server.from_sensor_logger([1, 2])
        self.assertEqual(server.from_sensor_logger({"messageId": 1}), {})   # a test push without readings
        self.assertEqual(server.from_sensor_logger({"payload": [{"name": "gyroscope", "time": 1, "values": {}}]}), {})

    def test_endpoint_relays_to_viewers(self):
        hub = server.Hub(recordings_dir=tempfile.gettempdir())
        port = free_port()
        srv = server.make_server("127.0.0.1", port, hub)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        q = hub.subscribe()
        try:
            for path in ("/sensorlogger", "/data"):
                conn = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
                conn.request("POST", path, body=json.dumps(self.PUSH), headers={"Content-Type": "application/json"})
                res = conn.getresponse()
                reply = json.loads(res.read())
                conn.close()
                self.assertEqual(res.status, 200)
                self.assertEqual(reply, {"ok": True, "samples": 3})
            sources = set()
            while not q.empty():
                sources.add(json.loads(q.get_nowait())["source"])
            self.assertEqual(sources, {"phone (Sensor Logger)", "airpods", "watch"})
        finally:
            hub.unsubscribe(q)
            srv.shutdown()
            srv.server_close()


class HttpsTest(unittest.TestCase):
    def test_self_signed_https_and_rejected_handshakes(self):
        try:
            import cryptography  # noqa: F401
        except ImportError:
            self.skipTest("cryptography is not installed")
        with tempfile.TemporaryDirectory() as d:
            cert, key = server.ensure_cert(os.path.join(d, "certs"), ["localhost", "127.0.0.1"])
            again = server.ensure_cert(os.path.join(d, "certs"), ["localhost"])  # covered: reused, not remade
            self.assertEqual(again, (cert, key))
            ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            ctx.load_cert_chain(cert, key)
            port = free_port()
            srv = server.make_server("127.0.0.1", port, server.Hub(recordings_dir=d), ctx)
            threading.Thread(target=srv.serve_forever, daemon=True).start()
            try:
                # 1) a client that does not trust the certificate (like a browser before you click through)
                untrusting = http.client.HTTPSConnection("127.0.0.1", port, timeout=5,
                                                         context=ssl.create_default_context())
                with self.assertRaises(ssl.SSLError):
                    untrusting.request("GET", "/")
                untrusting.close()
                # 2) a client that trusts it: also proves the IP is in the certificate's names
                trusting = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
                trusting.load_verify_locations(cert)
                conn = http.client.HTTPSConnection("127.0.0.1", port, timeout=5, context=trusting)
                conn.request("GET", "/phone.html")
                res = conn.getresponse()
                body = res.read()
                conn.close()
                self.assertEqual(res.status, 200)
                self.assertIn(b"Start motion sensors", body)
            finally:
                srv.shutdown()
                srv.server_close()


class PhonePageTest(unittest.TestCase):
    def test_gyro_axes_are_rotation_rate_alpha_beta_gamma(self):
        # W3C Device Orientation and Motion 6.3.2 (and Chrome, Safari, Firefox): rotationRate alpha, beta and
        # gamma are the rates about the device x, y and z axes, so gx, gy, gz must take them in that order.
        with open(os.path.join(os.path.dirname(HERE), "static", "phone.js"), encoding="utf-8") as f:
            found = dict(re.findall(r"\b(g[xyz]): num\(r\.(\w+)", f.read()))
        self.assertEqual(found, {"gx": "alpha", "gy": "beta", "gz": "gamma"})


if __name__ == "__main__":
    unittest.main()
