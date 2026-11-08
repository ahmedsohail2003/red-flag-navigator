"""Tests for motion/server.py (contract section 5 and "URLs").

Run from the project folder:
    python -m unittest discover -s motion/tests -p "test_*.py" -v

Servers start on port 0 in threads, with temporary folders laid out like the real project, so a traversal
that slipped through would find a real decoy file instead of a missing one.
"""
import datetime as dt
import glob
import http.client
import importlib.util
import ipaddress
import json
import os
import shutil
import ssl
import subprocess
import sys
import tempfile
import time
import unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
SERVER_PATH = os.path.join(os.path.dirname(HERE), "server.py")
_spec = importlib.util.spec_from_file_location("motion_server", SERVER_PATH)
server = importlib.util.module_from_spec(_spec)
sys.modules["motion_server"] = server
_spec.loader.exec_module(server)

DECOY = b"DECOY: the server source must never be served"
SECRET = b"DATA: walks must never be served as files"


def make_tree(root: str) -> dict:
    """A temporary project: app/, motion/web/, motion/data/, motion/.certs/ and a decoy motion/server.py."""
    paths = {
        "app": os.path.join(root, "app"),
        "web": os.path.join(root, "motion", "web"),
        "data": os.path.join(root, "motion", "data"),
        "certs": os.path.join(root, "motion", ".certs"),
    }
    files = {
        "app/index.html": b"<h1>app index</h1>",
        "app/hometests.html": b"<h1>home tests</h1>",
        "app/js/engine.js": b"export const RULES = {}; export function detectDecline() { return null; }",
        "motion/server.py": DECOY,
        "motion/web/walk.html": b"<p>walk page</p>",
        "motion/web/receive.html": b"<p>receive page</p>",
        "motion/web/gait.js": b"export const GAIT_VERSION = 'gait-1';",
        "motion/web/lib.mjs": b"export const x = 1;",
        "motion/web/motion.css": b"body { margin: 0; }",
        "motion/web/sub/note.json": b"{}",
        "motion/data/secret.txt": SECRET,
    }
    for rel, content in files.items():
        full = os.path.join(root, *rel.split("/"))
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, "wb") as f:
            f.write(content)
    return paths


def walk_body(walk_id: str, samples: int | None = 3, **over) -> dict:
    body = {
        "v": 1, "kind": "rfn-walk", "id": walk_id, "createdAt": "2026-11-08T12:12:03.120Z",
        "distance_m": 10, "placement": "waist", "device": {"ua": "unit test"},
        "result": {"version": "gait-1", "ok": True, "speed_mps": 1.24, "quality": "good", "steps": 14},
    }
    if samples is not None:
        body["recording"] = {
            "v": 1, "kind": "rfn-walk-recording", "id": walk_id, "distance_m": 10, "placement": "waist",
            "goT": 3012.4, "stopT": 11873.0, "stopBy": "tap",
            "samples": [{"t": 16.7 * i, "ax": 0.1, "ay": 9.6, "az": 1.1, "gx": 3.2, "gy": -1.0, "gz": 0.4,
                         "lx": None, "ly": None, "lz": None} for i in range(samples)],
        }
    body.update(over)
    return body


def read_event(res) -> tuple[str | None, str | None, list[str]]:
    """Read one Server-Sent Events block. Returns (event, data, comments); comments-only blocks return early."""
    event, data, comments = None, [], []
    while True:
        line = res.fp.readline()
        if not line:
            raise EOFError("stream closed")
        line = line.decode("utf-8").rstrip("\r\n")
        if line == "":
            if event is not None or data or comments:
                return event, ("\n".join(data) if data else None), comments
            continue
        if line.startswith(":"):
            comments.append(line[1:].strip())
        elif line.startswith("event:"):
            event = line[6:].strip()
        elif line.startswith("data:"):
            data.append(line[5:][1:] if line[5:].startswith(" ") else line[5:])


class Base(unittest.TestCase):
    https = False

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.paths = make_tree(cls.tmp.name)
        cls.srv = server.make_servers(cls.paths["app"], cls.paths["web"], cls.paths["data"], "127.0.0.1", 0,
                                      0 if cls.https else None, cls.paths["certs"], ips=["192.168.1.50"])
        cls.srv.hub.ping_interval_s = 0.2
        cls.port = cls.srv.http_port

    @classmethod
    def tearDownClass(cls):
        cls.srv.stop()
        cls.tmp.cleanup()

    def request(self, method, path, body=None, headers=None, ctype="application/json"):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        payload = json.dumps(body) if isinstance(body, (dict, list)) else body
        h = {"Content-Type": ctype} if (body is not None and ctype) else {}
        h.update(headers or {})
        conn.request(method, path, body=payload, headers=h)
        res = conn.getresponse()
        data = res.read()
        conn.close()
        return res, data

    def get_json(self, path):
        res, data = self.request("GET", path)
        return res.status, json.loads(data)

    def post(self, body, **kw):
        res, data = self.request("POST", "/api/walks", body, **kw)
        try:
            return res.status, json.loads(data)
        except ValueError:
            return res.status, data


class StaticFilesTest(Base):
    def test_defaults_resolve_from_the_files_own_location(self):
        motion_dir = os.path.dirname(SERVER_PATH)
        self.assertEqual(server.DEFAULT_APP_DIR, os.path.join(os.path.dirname(motion_dir), "app"))
        self.assertEqual(server.DEFAULT_WEB_DIR, os.path.join(motion_dir, "web"))
        self.assertEqual(server.DEFAULT_DATA_DIR, os.path.join(motion_dir, "data"))
        self.assertEqual(server.DEFAULT_CERT_DIR, os.path.join(motion_dir, ".certs"))

    def test_mapping_app_and_motion(self):
        cases = {
            "/": (b"<h1>app index</h1>", "text/html"),
            "/hometests.html?week=3": (b"<h1>home tests</h1>", "text/html"),
            "/js/engine.js": (b"export const RULES", "text/javascript"),
            "/motion/walk.html": (b"<p>walk page</p>", "text/html"),
            "/motion/receive.html": (b"<p>receive page</p>", "text/html"),
            "/motion/gait.js": (b"GAIT_VERSION", "text/javascript"),
            "/motion/lib.mjs": (b"export const x", "text/javascript"),
            "/motion/motion.css": (b"margin", "text/css"),
            "/motion/sub/note.json": (b"{}", "application/json"),
        }
        for path, (content, ctype) in cases.items():
            res, data = self.request("GET", path)
            self.assertEqual(res.status, 200, path)
            self.assertIn(content, data, path)
            self.assertTrue(res.getheader("Content-Type", "").startswith(ctype), (path, res.getheader("Content-Type")))
            self.assertEqual(res.getheader("Cache-Control"), "no-store", path)

    def test_js_mime_type_is_text_javascript(self):
        for path in ("/js/engine.js", "/motion/gait.js", "/motion/lib.mjs"):
            res, _ = self.request("GET", path)
            self.assertEqual(res.getheader("Content-Type"), "text/javascript; charset=utf-8", path)

    def test_head_sends_headers_only(self):
        res, data = self.request("HEAD", "/motion/walk.html")
        self.assertEqual(res.status, 200)
        self.assertEqual(res.getheader("Content-Length"), str(len(b"<p>walk page</p>")))
        self.assertEqual(data, b"")

    def test_missing_files_and_directories_give_404_without_listing(self):
        for path in ("/nope.html", "/motion/nope.js", "/motion/sub/", "/motion/sub", "/js/", "/motion"):
            res, data = self.request("GET", path)
            self.assertEqual(res.status, 404, path)
            self.assertNotIn(b"note.json", data, path)
            self.assertNotIn(b"engine.js", data, path)

    def test_traversal_is_refused_with_403(self):
        for path in ("/../server.py", "/motion/../server.py", "/motion/%2e%2e/data/walks.jsonl",
                     "/motion/%2e%2e/data/secret.txt", "/%2e%2e/motion/server.py", "/%2E%2E/%2E%2E/Windows/win.ini",
                     "/..\\server.py", "/motion/..\\server.py", "/motion/..%5cserver.py",
                     "/motion/..%5c..%5cmotion%5cserver.py", "/motion/%5c..%5cdata%5csecret.txt",
                     "/C:/Windows/win.ini", "/motion/walk.html::$DATA", "/motion/%00walk.html",
                     "/js/../../motion/server.py", "/./../motion/data/secret.txt"):
            res, data = self.request("GET", path)
            self.assertEqual(res.status, 403, path)
            self.assertNotIn(DECOY, data, path)
            self.assertNotIn(SECRET, data, path)
            self.assertEqual(res.getheader("Cache-Control"), "no-store", path)

    def test_path_is_decoded_only_once(self):
        # %252e decodes once to the literal text "%2e", a folder that does not exist: 404, never the data file.
        res, data = self.request("GET", "/motion/%252e%252e/data/secret.txt")
        self.assertEqual(res.status, 404)
        self.assertNotIn(SECRET, data)

    def test_data_certs_and_server_file_are_blocked_even_inside_a_root(self):
        with tempfile.TemporaryDirectory() as d:
            web = os.path.join(d, "web")
            os.makedirs(os.path.join(web, "data"))
            os.makedirs(os.path.join(web, ".certs"))
            for rel in ("data/walks.jsonl", ".certs/key.pem", "ok.html"):
                with open(os.path.join(web, *rel.split("/")), "wb") as f:
                    f.write(b"x")
            blocked = tuple(os.path.realpath(p) for p in (os.path.join(web, "data"), os.path.join(web, ".certs")))
            self.assertEqual(server.resolve_static("/motion/data/walks.jsonl", d, web, blocked), (403, None))
            self.assertEqual(server.resolve_static("/motion/.certs/key.pem", d, web, blocked), (403, None))
            self.assertEqual(server.resolve_static("/motion/ok.html", d, web, blocked)[0], 200)
        motion_dir = os.path.dirname(SERVER_PATH)  # app_dir pointed at the motion folder by mistake
        self.assertEqual(server.resolve_static("/server.py", motion_dir, motion_dir,
                                               (os.path.realpath(server.SERVER_FILE),)), (403, None))


class ApiTest(Base):
    def test_post_creates_then_duplicate_gets_200(self):
        status, reply = self.post(walk_body("dup-walk-001"))
        self.assertEqual((status, reply), (201, {"ok": True, "id": "dup-walk-001"}))
        status, reply = self.post(walk_body("dup-walk-001"))
        self.assertEqual((status, reply), (200, {"ok": True, "duplicate": True}))
        _, listing = self.get_json("/api/walks")
        self.assertEqual([w["id"] for w in listing["walks"]].count("dup-walk-001"), 1)
        with open(os.path.join(self.paths["data"], "walks.jsonl"), encoding="utf-8") as f:
            self.assertEqual(sum('"dup-walk-001"' in line for line in f), 1)

    def test_validation_errors_give_400_with_plain_words(self):
        bad_bodies = {
            "bad JSON": "not json",
            "NaN": '{"kind": "rfn-walk", "id": "nan-walk-01", "distance_m": NaN, "result": {}}',
            "array": [1, 2],
            "wrong kind": walk_body("kind-walk-01", kind="rfn-walk-recording"),
            "no kind": {k: v for k, v in walk_body("kind-walk-02").items() if k != "kind"},
            "short id": walk_body("abc"),
            "id with space": walk_body("bad id here"),
            "id too long": walk_body("x" * 65),
            "id with newline": walk_body("abcdef\n"),
            "numeric id": walk_body(123456),
            "distance low": walk_body("dist-walk-01", distance_m=0.5),
            "distance high": walk_body("dist-walk-02", distance_m=101),
            "distance text": walk_body("dist-walk-03", distance_m="10"),
            "distance bool": walk_body("dist-walk-04", distance_m=True),
            "distance null": walk_body("dist-walk-05", distance_m=None),
            "result text": walk_body("res-walk-01", result="fine"),
            "result null": walk_body("res-walk-02", result=None),
            "result list": walk_body("res-walk-03", result=[1]),
            "recording text": walk_body("rec-walk-01", recording="samples"),
            "samples not list": walk_body("rec-walk-02", recording={"samples": {"t": 1}}),
            "too many samples": walk_body("rec-walk-03", recording={"samples": [{"t": i} for i in range(20001)]}),
        }
        for name, body in bad_bodies.items():
            status, reply = self.post(body)
            self.assertEqual(status, 400, name)
            self.assertIs(reply["ok"], False, name)
            self.assertIsInstance(reply["error"], str, name)
            self.assertTrue(reply["error"].endswith("."), name)
        for walk_id in ("kind-walk-01", "dist-walk-01", "res-walk-01", "rec-walk-03"):
            self.assertEqual(self.get_json(f"/api/walks/{walk_id}")[0], 404, walk_id)

    def test_numbers_too_big_for_a_float_are_refused(self):
        # Reviewer fix: Python reads 1e400 as inf and json.dumps writes it back as Infinity, which is not JSON.
        # One such walk made every GET /api/walks unreadable to the laptop page's JSON.parse.
        for i, number in enumerate(("1e400", "-1e400", "1E309")):
            text = json.dumps(walk_body(f"big-walk-0{i}", samples=None)).replace('"speed_mps": 1.24',
                                                                                 f'"speed_mps": {number}')
            status, reply = self.post(text)
            self.assertEqual(status, 400, number)
            self.assertIs(reply["ok"], False, number)
            self.assertEqual(self.get_json(f"/api/walks/big-walk-0{i}")[0], 404, number)
        res, data = self.request("GET", "/api/walks")
        self.assertNotIn(b"Infinity", data)
        json.loads(data, parse_constant=lambda name: self.fail(f"{name} in GET /api/walks"))
        for raw in (b'{"a": 1e400}', b'[-1e400]', b'{"a": NaN}', b'{"a": -Infinity}'):
            with self.assertRaises(ValueError, msg=raw):
                server.parse_json(raw)
        self.assertEqual(server.parse_json(b'{"a": 1e308, "b": -2.5e-300, "c": 0.0}'),
                         {"a": 1e308, "b": -2.5e-300, "c": 0.0})
        with tempfile.TemporaryDirectory() as d:  # a hand-edited walks.jsonl line is skipped, not loaded as inf
            with open(os.path.join(d, "walks.jsonl"), "wb") as f:
                f.write(json.dumps(walk_body("file-big-01", samples=None)).replace('"speed_mps": 1.24',
                                                                                   '"speed_mps": 1e999').encode() + b"\n")
            hub = server.Hub(d)
            self.assertEqual((hub.count(), hub.skipped_lines), (0, 1))

    def test_limits_are_inclusive(self):
        self.assertEqual(self.post(walk_body("edge-walk-01", distance_m=1))[0], 201)
        self.assertEqual(self.post(walk_body("edge-walk-02", distance_m=100.0))[0], 201)
        self.assertEqual(self.post(walk_body("x" * 64))[0], 201)
        self.assertEqual(self.post(walk_body("edge-walk-03", recording={"samples": [{"t": i} for i in range(20000)]}))[0], 201)
        self.assertEqual(self.post(walk_body("edge-walk-04", recording=None))[0], 201)  # null = no recording

    def test_411_without_content_length(self):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        conn.putrequest("POST", "/api/walks")
        conn.putheader("Content-Type", "application/json")
        conn.endheaders()
        res = conn.getresponse()
        reply = json.loads(res.read())
        conn.close()
        self.assertEqual(res.status, 411)
        self.assertIs(reply["ok"], False)

    def test_400_for_a_bad_content_length(self):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        conn.putrequest("POST", "/api/walks")
        conn.putheader("Content-Type", "application/json")
        conn.putheader("Content-Length", "lots")
        conn.endheaders()
        res = conn.getresponse()
        res.read()
        conn.close()
        self.assertEqual(res.status, 400)

    def test_413_over_3_mb_before_reading_the_body(self):
        # Only the headers are sent. A reply within the timeout proves the body was never waited for.
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        conn.putrequest("POST", "/api/walks")
        conn.putheader("Content-Type", "application/json")
        conn.putheader("Content-Length", str(server.MAX_BODY + 1))
        conn.endheaders()
        res = conn.getresponse()
        reply = json.loads(res.read())
        conn.close()
        self.assertEqual(res.status, 413)
        self.assertIs(reply["ok"], False)
        self.assertEqual(server.MAX_BODY, 3 * 1024 * 1024)

    def test_415_when_not_json(self):
        body = json.dumps(walk_body("type-walk-01"))
        self.assertEqual(self.post(body, ctype="text/plain")[0], 415)
        self.assertEqual(self.post(body, ctype=None)[0], 415)
        self.assertEqual(self.post(body, ctype="application/x-www-form-urlencoded")[0], 415)
        self.assertEqual(self.get_json("/api/walks/type-walk-01")[0], 404)
        self.assertEqual(self.post(body, ctype="application/json; charset=utf-8")[0], 201)

    def test_keep_alive_connection_stays_in_step_after_an_error(self):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        statuses = []
        for body, ctype in ((json.dumps(walk_body("keep-walk-01")), "text/plain"),
                            ("not json", "application/json"),
                            (json.dumps(walk_body("keep-walk-01")), "application/json")):
            conn.request("POST", "/api/walks", body=body, headers={"Content-Type": ctype})
            res = conn.getresponse()
            res.read()
            statuses.append(res.status)
        conn.close()
        self.assertEqual(statuses, [415, 400, 201])

    def test_list_is_newest_first_with_summaries(self):
        for walk_id in ("order-walk-a", "order-walk-b", "order-walk-c"):
            self.assertEqual(self.post(walk_body(walk_id, samples=None if walk_id.endswith("b") else 3))[0], 201)
        status, listing = self.get_json("/api/walks")
        self.assertEqual(status, 200)
        ids = [w["id"] for w in listing["walks"]]
        self.assertLess(ids.index("order-walk-c"), ids.index("order-walk-b"))
        self.assertLess(ids.index("order-walk-b"), ids.index("order-walk-a"))
        self.assertEqual(ids[0], "order-walk-c")
        by_id = {w["id"]: w for w in listing["walks"]}
        for walk in listing["walks"]:
            self.assertNotIn("recording", walk)
        self.assertIs(by_id["order-walk-a"]["hasRecording"], True)
        self.assertIs(by_id["order-walk-b"]["hasRecording"], False)
        received = by_id["order-walk-c"]["receivedAt"]
        self.assertTrue(received.endswith("Z"), received)
        dt.datetime.fromisoformat(received.replace("Z", "+00:00"))
        self.assertEqual(by_id["order-walk-c"]["result"]["speed_mps"], 1.24)

    def test_a_simulated_recording_keeps_its_label_in_the_summary(self):
        # Reviewer fix (F5): a summary drops "recording", and with it synth.js's "simulated": true, so a
        # simulated walk looked real on the laptop page. The summary now carries the label.
        sim = walk_body("sim-walk-01")
        sim["recording"]["simulated"] = True
        mixed = walk_body("sim-walk-02", simulated=False)  # the recording's own label wins
        mixed["recording"]["simulated"] = True
        for body in (sim, mixed, walk_body("sim-walk-03")):
            self.assertEqual(self.post(body)[0], 201)
        _, listing = self.get_json("/api/walks")
        by_id = {w["id"]: w for w in listing["walks"]}
        self.assertIs(by_id["sim-walk-01"]["simulated"], True)
        self.assertIs(by_id["sim-walk-02"]["simulated"], True)
        self.assertNotIn("recording", by_id["sim-walk-01"])
        self.assertNotIn("simulated", by_id["sim-walk-03"])  # a real walk's summary is unchanged
        self.assertIs(self.get_json("/api/walks/sim-walk-01")[1]["recording"]["simulated"], True)
        base = {"id": "unit-walk-01", "result": {}}
        for recording in ({"simulated": "true"}, {"simulated": 1}, {"simulated": False}, {}, None):
            self.assertNotIn("simulated", server.summarize({**base, "recording": recording}), recording)
        self.assertIs(server.summarize({**base, "simulated": True})["simulated"], True)  # top level passes through

    def test_get_by_id_includes_the_recording(self):
        body = walk_body("full-walk-01", samples=5)
        self.assertEqual(self.post(body)[0], 201)
        status, rec = self.get_json("/api/walks/full-walk-01")
        self.assertEqual(status, 200)
        self.assertEqual(rec["recording"], body["recording"])
        self.assertEqual(rec["result"], body["result"])
        self.assertIn("receivedAt", rec)
        for missing in ("/api/walks/no-such-walk", "/api/walks/abc", "/api/walks/..%2fdata"):
            status, reply = self.get_json(missing)
            self.assertEqual(status, 404, missing)
            self.assertIs(reply["ok"], False)
        self.assertEqual(self.get_json("/api/nothing-here")[0], 404)

    def test_jsonl_line_is_written_and_reloaded_by_a_new_hub(self):
        self.assertEqual(self.post(walk_body("file-walk-01"))[0], 201)
        path = os.path.join(self.paths["data"], "walks.jsonl")
        with open(path, encoding="utf-8") as f:
            lines = [json.loads(line) for line in f if line.strip()]
        line = next(r for r in lines if r["id"] == "file-walk-01")
        self.assertEqual(line, self.get_json("/api/walks/file-walk-01")[1])
        self.assertIn("receivedAt", line)
        fresh = server.Hub(self.paths["data"])
        self.assertEqual(fresh.get("file-walk-01"), line)
        self.assertEqual(fresh.skipped_lines, 0)

    def test_bad_lines_are_skipped_and_a_cut_off_line_does_not_spoil_the_next(self):
        with tempfile.TemporaryDirectory() as d:
            good = json.dumps({**walk_body("load-walk-01"), "receivedAt": "2026-11-08T12:00:00.000Z"})
            with open(os.path.join(d, "walks.jsonl"), "wb") as f:
                f.write(good.encode() + b"\nnot json\n[1, 2]\n\xff\xfe\n{\"id\": \"bad id\"}\n"
                        + good.encode() + b"\n{\"kind\": \"rfn-walk\", \"id\": \"cut-off-")
            hub = server.Hub(d)
            self.assertEqual(hub.count(), 1)
            self.assertEqual(hub.skipped_lines, 6)  # 4 bad, 1 repeated id, 1 cut off
            created, _ = hub.add(walk_body("load-walk-02"))
            self.assertTrue(created)
            created, _ = hub.add(walk_body("load-walk-01"))
            self.assertFalse(created)  # an id already in the file is a duplicate
            again = server.Hub(d)
            self.assertEqual([w["id"] for w in again.summaries()], ["load-walk-02", "load-walk-01"])

    def test_memory_keeps_the_last_500(self):
        with tempfile.TemporaryDirectory() as d:
            hub = server.Hub(d, max_walks=3)
            for i in range(5):
                hub.add(walk_body(f"mem-walk-{i:02d}", samples=None))
            self.assertEqual([w["id"] for w in hub.summaries()], ["mem-walk-04", "mem-walk-03", "mem-walk-02"])
            self.assertFalse(hub.add(walk_body("mem-walk-00", samples=None))[0])  # still a duplicate
            self.assertEqual(server.MAX_WALKS, 500)

    def test_info(self):
        status, info = self.get_json("/api/info")
        self.assertEqual(status, 200)
        self.assertEqual(info, {"phoneUrls": [], "laptopUrl": f"http://localhost:{self.port}/motion/receive.html",
                                "httpPort": self.port, "httpsPort": None})

    def test_cors_on_every_get_api_reply(self):
        for path in ("/api/walks", "/api/info", "/api/walks/no-such-walk", "/api/nothing-here"):
            res, _ = self.request("GET", path)
            self.assertEqual(res.getheader("Access-Control-Allow-Origin"), "*", path)
            self.assertEqual(res.getheader("Cache-Control"), "no-store", path)

    def test_cache_control_on_every_reply(self):
        replies = [self.request("GET", "/nope.html")[0], self.request("GET", "/../server.py")[0],
                   self.request("POST", "/api/walks", "not json")[0],
                   self.request("POST", "/api/walks", walk_body("cache-walk-01"))[0],
                   self.request("PUT", "/api/walks", walk_body("cache-walk-02"))[0],
                   self.request("POST", "/api/other", {})[0]]
        self.assertEqual([r.status for r in replies], [404, 403, 400, 201, 501, 404])
        for r in replies:
            self.assertEqual(r.getheader("Cache-Control"), "no-store", r.status)


class EventStreamTest(Base):
    def open_stream(self):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        conn.request("GET", "/api/events")
        res = conn.getresponse()
        return conn, res

    def wait_for_clients(self, n, seconds=5.0):
        end = time.time() + seconds
        while time.time() < end:
            if self.srv.hub.client_count() == n:
                return True
            time.sleep(0.02)
        return False

    def test_hello_then_a_walk_event_after_a_post(self):
        conn, res = self.open_stream()
        try:
            self.assertEqual(res.status, 200)
            self.assertTrue(res.getheader("Content-Type").startswith("text/event-stream"))
            self.assertEqual(res.getheader("Access-Control-Allow-Origin"), "*")
            self.assertEqual(res.getheader("Cache-Control"), "no-store")
            event, data, _ = read_event(res)
            while event is None:  # skip the retry hint and any ping
                event, data, _ = read_event(res)
            self.assertEqual(event, "hello")
            self.assertEqual(json.loads(data), {"walks": self.srv.hub.count()})
            self.assertEqual(self.post(walk_body("stream-walk-01"))[0], 201)
            while True:
                event, data, _ = read_event(res)
                if event is not None:
                    break
            self.assertEqual(event, "walk")
            summary = json.loads(data)
            self.assertEqual(summary["id"], "stream-walk-01")
            self.assertNotIn("recording", summary)
            self.assertIs(summary["hasRecording"], True)
            self.assertIn("receivedAt", summary)
        finally:
            res.close()
            conn.close()

    def test_ping_and_clean_removal_on_disconnect(self):
        self.assertTrue(self.wait_for_clients(0))
        conn, res = self.open_stream()
        self.assertTrue(self.wait_for_clients(1))
        pinged = False
        for _ in range(20):
            _, _, comments = read_event(res)
            if "ping" in comments:
                pinged = True
                break
        self.assertTrue(pinged)
        res.close()
        conn.close()
        self.assertTrue(self.wait_for_clients(0), "the closed stream was not removed")

    def test_walk_event_keeps_the_simulated_label(self):
        # Reviewer fix (F5): the live event is the path the laptop page uses, so it must carry the label too.
        conn, res = self.open_stream()
        try:
            event = None
            while event != "hello":
                event, _, _ = read_event(res)
            body = walk_body("stream-sim-01")
            body["recording"]["simulated"] = True
            self.assertEqual(self.post(body)[0], 201)
            event, data = None, None
            while event is None:
                event, data, _ = read_event(res)
            self.assertEqual(event, "walk")
            summary = json.loads(data)
            self.assertEqual(summary["id"], "stream-sim-01")
            self.assertIs(summary["simulated"], True)
            self.assertNotIn("recording", summary)
        finally:
            res.close()
            conn.close()

    def test_stop_ends_open_streams(self):
        with tempfile.TemporaryDirectory() as d:
            paths = make_tree(d)
            srv = server.make_servers(paths["app"], paths["web"], paths["data"], "127.0.0.1", 0, None, paths["certs"],
                                      ips=[])
            conn = http.client.HTTPConnection("127.0.0.1", srv.http_port, timeout=5)
            conn.request("GET", "/api/events")
            res = conn.getresponse()
            read_event(res)
            started = time.time()
            srv.stop()
            with self.assertRaises(EOFError):
                for _ in range(50):
                    read_event(res)
            self.assertLess(time.time() - started, 4)
            res.close()
            conn.close()


class DeleteTest(Base):
    def test_delete_from_loopback_renames_the_file(self):
        for walk_id in ("del-walk-01", "del-walk-02"):
            self.assertEqual(self.post(walk_body(walk_id))[0], 201)
        jsonl = os.path.join(self.paths["data"], "walks.jsonl")
        self.assertTrue(os.path.isfile(jsonl))
        held = self.srv.hub.count()  # other tests in this class may have stored walks too
        self.assertGreaterEqual(held, 2)
        res, data = self.request("DELETE", "/api/walks")
        self.assertEqual(res.status, 200)
        self.assertEqual(json.loads(data), {"ok": True, "cleared": held})
        self.assertFalse(os.path.exists(jsonl))
        backups = glob.glob(os.path.join(self.paths["data"], "walks-*.jsonl.bak"))
        self.assertEqual(len(backups), 1)
        with open(backups[0], encoding="utf-8") as f:
            self.assertEqual([json.loads(line)["id"] for line in f][-2:], ["del-walk-01", "del-walk-02"])
        self.assertEqual(self.get_json("/api/walks"), (200, {"walks": []}))
        self.assertEqual(self.post(walk_body("del-walk-01"))[0], 201)  # a fresh file after clearing
        res, data = self.request("DELETE", "/api/walks")  # a second clear in the same second gets its own name
        self.assertEqual(json.loads(data), {"ok": True, "cleared": 1})
        self.assertEqual(len(glob.glob(os.path.join(self.paths["data"], "walks-*.jsonl.bak"))), 2)

    def test_delete_from_a_lan_address_is_refused(self):
        self.assertEqual(self.post(walk_body("lan-walk-01"))[0], 201)
        with mock.patch.object(server, "is_loopback", return_value=False):
            res, data = self.request("DELETE", "/api/walks")
        self.assertEqual(res.status, 403)
        self.assertIs(json.loads(data)["ok"], False)
        self.assertEqual(self.get_json("/api/walks/lan-walk-01")[0], 200)
        self.assertEqual(self.request("DELETE", "/api/other")[0].status, 404)

    def test_loopback_check(self):
        for addr in ("127.0.0.1", "::1", "127.0.0.2", "::ffff:127.0.0.1"):
            self.assertTrue(server.is_loopback(addr), addr)
        for addr in ("192.168.1.20", "10.0.0.5", "172.16.0.9", "::ffff:192.168.1.2", "fe80::1%3", "0.0.0.0",
                     "", None, "localhost", "not an ip"):
            self.assertFalse(server.is_loopback(addr), addr)


class DeleteHostTest(unittest.TestCase):
    """Reviewer fix (F9): DELETE also needs a Host header that names this laptop.

    A tunnel such as localhost.run opens each connection from the laptop itself, so a stranger's DELETE
    arrives from a loopback address. A DNS-rebinding page does the same through the laptop's own browser.
    Both send their own name in Host, so checking Host refuses them. Own server, so the backups are its own.
    """

    REFUSED = (403, {"ok": False, "error": "Only the laptop itself can clear the walks."})

    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.paths = make_tree(tmp.name)
        self.srv = server.make_servers(self.paths["app"], self.paths["web"], self.paths["data"], "127.0.0.1", 0,
                                       None, self.paths["certs"], ips=[])
        self.addCleanup(self.srv.stop)
        self.port = self.srv.http_port

    def send(self, method, path, host, body=None):
        """One request from 127.0.0.1 with this exact Host header (None sends no Host header at all)."""
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        try:
            conn.putrequest(method, path, skip_host=True)
            if host is not None:
                conn.putheader("Host", host)
            data = json.dumps(body).encode() if body is not None else None
            if data is not None:
                conn.putheader("Content-Type", "application/json")
                conn.putheader("Content-Length", str(len(data)))
            conn.endheaders(data)
            res = conn.getresponse()
            return res.status, json.loads(res.read())
        finally:
            conn.close()

    def test_delete_through_a_tunnel_or_another_name_is_refused(self):
        self.assertEqual(self.send("POST", "/api/walks", "localhost", walk_body("host-walk-01"))[0], 201)
        for host in ("abc123.lhr.life", f"evil.example:{self.port}", "localhost.evil.example", "x@localhost",
                     f"localhost:{self.port}@evil.example", f"192.168.68.118:{self.port}", "127.0.0.1.nip.io", None):
            self.assertEqual(self.send("DELETE", "/api/walks", host), self.REFUSED, host)
        self.assertTrue(os.path.isfile(os.path.join(self.paths["data"], "walks.jsonl")))
        self.assertEqual(glob.glob(os.path.join(self.paths["data"], "walks-*.jsonl.bak")), [])
        self.assertIsNotNone(self.srv.hub.get("host-walk-01"))

    def test_delete_with_a_local_host_name_still_works(self):
        for i, host in enumerate((f"localhost:{self.port}", f"[::1]:{self.port}", "127.0.0.1", "LOCALHOST")):
            self.assertEqual(self.send("POST", "/api/walks", "localhost", walk_body(f"host-walk-1{i}"))[0], 201)
            self.assertEqual(self.send("DELETE", "/api/walks", host), (200, {"ok": True, "cleared": 1}), host)
        self.assertEqual(len(glob.glob(os.path.join(self.paths["data"], "walks-*.jsonl.bak"))), 4)

    def test_local_host_header_check(self):
        for value in ("localhost", "localhost:8090", "LocalHost:8090", "127.0.0.1", "127.0.0.1:8453", "[::1]",
                      "[::1]:8090", "::1", " localhost:8090 "):
            self.assertTrue(server.is_local_host_header(value), value)
        for value in (None, "", "abc123.lhr.life", "evil.example:8090", "localhost.evil.example", "x@localhost",
                      "localhost:8090@evil.example", "127.0.0.2", "127.0.0.1.nip.io", "192.168.68.118:8090",
                      "[::1]x", "localhost:abc", "localhost:", "0.0.0.0:8090", "[::ffff:127.0.0.1]:8090",
                      "localhost:8090, evil.example", 8090):
            self.assertFalse(server.is_local_host_header(value), value)


class LiveInfoTest(unittest.TestCase):
    """Reviewer fix (F6, F3): GET /api/info works out the phone address again on each request.

    Joining the laptop to the phone's hotspot gives the laptop a new address. Before, /api/info kept the
    start-up address, so the laptop page showed one the phone could no longer reach until a restart.
    """

    def start(self, https_port):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        paths = make_tree(tmp.name)
        srv = server.make_servers(paths["app"], paths["web"], paths["data"], "127.0.0.1", 0, https_port,
                                  paths["certs"])  # no ips: found live, like the real server
        self.addCleanup(srv.stop)
        return srv

    def info(self, srv):
        conn = http.client.HTTPConnection("127.0.0.1", srv.http_port, timeout=5)
        try:
            conn.request("GET", "/api/info")
            res = conn.getresponse()
            self.assertEqual(res.status, 200)
            return json.loads(res.read())
        finally:
            conn.close()

    def test_phone_address_follows_a_network_change_without_a_restart(self):
        with mock.patch.object(server, "lan_ips", return_value=["192.168.68.118"]) as found:
            srv = self.start(0)

            def url(ip):
                return f"https://{ip}:{srv.https_port}/motion/walk.html"

            self.assertEqual(self.info(srv)["phoneUrls"], [url("192.168.68.118")])
            found.return_value = ["172.20.10.2"]  # the laptop joined the phone's hotspot
            info = self.info(srv)
            self.assertEqual(info, {"phoneUrls": [url("172.20.10.2")],
                                    "laptopUrl": f"http://localhost:{srv.http_port}/motion/receive.html",
                                    "httpPort": srv.http_port, "httpsPort": srv.https_port})
            found.return_value = []  # Wi-Fi dropped for a moment
            self.assertEqual(self.info(srv)["phoneUrls"], [])
            found.side_effect = RuntimeError("address lookup failed")  # never a 500: use the start-up address
            self.assertEqual(self.info(srv)["phoneUrls"], [url("192.168.68.118")])
        self.assertEqual(srv.info["phoneUrls"], [url("192.168.68.118")])  # what the start-up print shows

    def test_https_off_still_gives_no_phone_address(self):
        with mock.patch.object(server, "lan_ips", return_value=["192.168.68.118"]):
            srv = self.start(None)
            info = self.info(srv)
        self.assertEqual((info["phoneUrls"], info["httpsPort"]), ([], None))


class HttpsTest(Base):
    https = True

    def https_get(self, path, verify):
        if verify:
            ctx = ssl.create_default_context()  # trusts only real CAs, like a phone before you click through
        else:
            ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
        conn = http.client.HTTPSConnection("127.0.0.1", self.srv.https_port, timeout=5, context=ctx)
        try:
            conn.request("GET", path)
            res = conn.getresponse()
            return res.status, res.read()
        finally:
            conn.close()

    def test_https_serves_pages_and_survives_a_client_that_rejects_the_certificate(self):
        self.assertEqual(self.https_get("/motion/walk.html", verify=False), (200, b"<p>walk page</p>"))
        for _ in range(3):
            with self.assertRaises(ssl.SSLError):
                self.https_get("/motion/walk.html", verify=True)
        self.assertEqual(self.https_get("/motion/walk.html", verify=False), (200, b"<p>walk page</p>"))
        self.assertEqual(self.request("GET", "/motion/walk.html")[0].status, 200)  # plain HTTP still up

    def test_one_hub_for_both_listeners(self):
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        conn = http.client.HTTPSConnection("127.0.0.1", self.srv.https_port, timeout=5, context=ctx)
        conn.request("POST", "/api/walks", body=json.dumps(walk_body("phone-walk-01")),
                     headers={"Content-Type": "application/json"})
        res = conn.getresponse()
        self.assertEqual((res.status, json.loads(res.read())), (201, {"ok": True, "id": "phone-walk-01"}))
        conn.close()
        status, rec = self.get_json("/api/walks/phone-walk-01")  # read back over plain HTTP
        self.assertEqual(status, 200)
        self.assertEqual(rec["placement"], "waist")

    def test_info_lists_one_phone_url_per_lan_ip(self):
        status, info = self.get_json("/api/info")
        self.assertEqual(status, 200)
        https_port = self.srv.https_port
        self.assertEqual(info["phoneUrls"], [f"https://192.168.1.50:{https_port}/motion/walk.html"])
        self.assertEqual(info["httpsPort"], https_port)
        self.assertEqual(info["httpPort"], self.port)

    def test_certificate_names_and_reuse(self):
        from cryptography import x509
        cert_path = os.path.join(self.paths["certs"], "cert.pem")
        with open(cert_path, "rb") as f:
            first = f.read()
        names = x509.load_pem_x509_certificate(first).extensions.get_extension_for_class(x509.SubjectAlternativeName).value
        self.assertIn("localhost", names.get_values_for_type(x509.DNSName))
        ips = names.get_values_for_type(x509.IPAddress)
        self.assertIn(ipaddress.ip_address("192.168.1.50"), ips)
        self.assertIn(ipaddress.ip_address("127.0.0.1"), ips)
        # Covered names: the same certificate is reused.
        self.assertEqual(server.ensure_cert(self.paths["certs"], ["localhost", "192.168.1.50"]),
                         (cert_path, os.path.join(self.paths["certs"], "key.pem")))
        with open(cert_path, "rb") as f:
            self.assertEqual(f.read(), first)
        # A new LAN IP: a new certificate that names it.
        server.ensure_cert(self.paths["certs"], ["localhost", "10.9.8.7"])
        with open(cert_path, "rb") as f:
            second = f.read()
        self.assertNotEqual(second, first)
        names = x509.load_pem_x509_certificate(second).extensions.get_extension_for_class(x509.SubjectAlternativeName).value
        self.assertIn(ipaddress.ip_address("10.9.8.7"), names.get_values_for_type(x509.IPAddress))


class WalkLogTest(unittest.TestCase):
    """Reviewer fix: the per-walk console line must never cost the phone its reply.

    On Windows a piped stdout is cp1252, so printing text such as a snowman raised UnicodeEncodeError after the
    walk was stored; the phone got no reply and showed "Could not reach the laptop".
    """

    def run_server(self, log):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        paths = make_tree(tmp.name)
        srv = server.make_servers(paths["app"], paths["web"], paths["data"], "127.0.0.1", 0, None, paths["certs"],
                                  ips=[], log=log)
        self.addCleanup(srv.stop)
        return srv

    def post(self, srv, body):
        conn = http.client.HTTPConnection("127.0.0.1", srv.http_port, timeout=5)
        try:
            conn.request("POST", "/api/walks", body=json.dumps(body), headers={"Content-Type": "application/json"})
            res = conn.getresponse()
            return res.status, json.loads(res.read())
        finally:
            conn.close()

    def test_the_log_line_is_plain_ascii(self):
        lines = []
        srv = self.run_server(lambda line: (lines.append(line), line.encode("cp1252")))  # a piped Windows console
        for i, quality in enumerate(("☃ snow", "\ud800", "x" * 5000)):
            body = walk_body(f"log-walk-0{i}")
            body["result"]["quality"] = quality
            self.assertEqual(self.post(srv, body), (201, {"ok": True, "id": f"log-walk-0{i}"}), quality[:10])
        self.assertEqual(len(lines), 3)
        for line in lines:
            self.assertTrue(line.isascii(), line)
            self.assertLess(len(line), 200, line)
        self.assertIn("log-walk-00", lines[0])
        self.assertIn("speed 1.24 m/s, quality ", lines[0])
        self.assertIn("3 samples", lines[0])

    def test_a_console_that_cannot_print_does_not_block_the_reply(self):
        def broken(line):
            raise OSError("the console window was closed")
        srv = self.run_server(broken)
        self.assertEqual(self.post(srv, walk_body("log-walk-10")), (201, {"ok": True, "id": "log-walk-10"}))
        self.assertIsNotNone(srv.hub.get("log-walk-10"))


class CommandLineTest(unittest.TestCase):
    def test_firewall_hint_has_the_powershell_rule(self):
        self.assertIn('New-NetFirewallRule -DisplayName "Phone walk test" -Direction Inbound -Protocol TCP '
                      '-LocalPort 8090,8453 -Action Allow', server.FIREWALL_HINT.format(ports="8090,8453"))

    def test_cli_starts_and_prints_the_laptop_url(self):
        with tempfile.TemporaryDirectory() as d:
            proc = subprocess.Popen([sys.executable, SERVER_PATH, "--port", "0", "--no-https", "--host", "127.0.0.1",
                                     "--data-dir", os.path.join(d, "data")],
                                    stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            try:
                lines = [proc.stdout.readline() for _ in range(3)]
                laptop = next(line for line in lines if "Laptop page:" in line).split("Laptop page:")[1].strip()
                self.assertRegex(laptop, r"^http://localhost:\d+/motion/receive\.html$")
                port = int(laptop.split(":")[2].split("/")[0])
                conn = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
                conn.request("GET", "/api/info")
                info = json.loads(conn.getresponse().read())
                conn.close()
                self.assertEqual(info["laptopUrl"], laptop)
                self.assertEqual(info["phoneUrls"], [])
                self.assertTrue(os.path.isdir(os.path.join(d, "data")))
            finally:
                proc.terminate()
                proc.wait(5)
                proc.stdout.close()
                proc.stderr.close()


if __name__ == "__main__":
    unittest.main()
