"""Local dev server: static files + /api/classify, with the same security headers as Vercel.

    python3 dev_server.py          # http://localhost:8000
"""
import json
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ROOT)
from api.main import MAX_BODY, handle_classify  # noqa: E402

with open(os.path.join(ROOT, "vercel.json")) as f:
    HEADERS = next(h["headers"] for h in json.load(f)["headers"] if h["source"] == "/(.*)")


class Dev(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, ".wasm": "application/wasm"}

    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)

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
        if self.path.split("?")[0] != "/api/main":
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


