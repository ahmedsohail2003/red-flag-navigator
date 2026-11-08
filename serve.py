"""Serve app/ locally with caching turned off, so a reload always shows the latest files.
Usage: python serve.py [port]   (default 8765), then open http://localhost:8765"""
import functools
import http.server
import pathlib
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        if self.path == "/favicon.ico":  # no icon; answer quietly instead of a 404 in the console
            self.send_response(204)
            self.end_headers()
            return
        super().do_GET()


port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
app_dir = pathlib.Path(__file__).resolve().parent / "app"
handler = functools.partial(NoCacheHandler, directory=str(app_dir))
# The default listen backlog (5) once refused a module request when a page loaded many at once.
http.server.ThreadingHTTPServer.request_queue_size = 64
print(f"Serving {app_dir} at http://localhost:{port}", flush=True)
http.server.ThreadingHTTPServer(("127.0.0.1", port), handler).serve_forever()
