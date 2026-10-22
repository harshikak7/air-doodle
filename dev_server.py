"""One-command local dev: serves frontend/ and the Python API on the same origin.

    python3 dev_server.py          # http://localhost:8000

(In production the two are deployed separately: see README. This is only for local convenience.)
"""
import json
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
FRONT = os.path.join(ROOT, "frontend")
sys.path.insert(0, os.path.join(ROOT, "backend"))
from server import MAX_BODY, handle_classify  # noqa: E402

with open(os.path.join(FRONT, "vercel.json")) as f:   # same security headers as production
    HEADERS = next(h["headers"] for h in json.load(f)["headers"] if h["source"] == "/(.*)")


class Dev(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, ".wasm": "application/wasm"}

    def __init__(self, *a, **k):
        super().__init__(*a, directory=FRONT, **k)

    def end_headers(self):
        for h in HEADERS:
            self.send_header(h["key"], h["value"])
        super().end_headers()

    def _json(self, status, payload):
        data = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        if self.path.split("?")[0] != "/api/classify":
            return self._json(404, {"error": "not found"})
        n = int(self.headers.get("Content-Length") or 0)
        self._json(*handle_classify(self.rfile.read(min(n, MAX_BODY + 1))))

    def log_message(self, fmt, *args):
        if "/api/" not in (args[0] if args else ""):
            super().log_message(fmt, *args)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    print(f"air doodle on http://localhost:{port}")
    ThreadingHTTPServer(("", port), Dev).serve_forever()
