"""POST /api/classify  ->  {"label", "confidence", "top3"}

Body: {"points": [[x, y], ...]}  (8-512 points, any coordinate scale).
Receives only outline numbers of a doodle: no video, no images, no identifiers.
Nothing is logged or stored. Standard library only (Vercel Python runtime).
"""
import json
import os
import sys
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _ml  # noqa: E402

MAX_BODY = 32 * 1024


def handle_classify(raw: bytes):
    """Pure function used by the Vercel handler, the dev server and the tests."""
    if len(raw) > MAX_BODY:
        return 413, {"error": "body too large"}
    try:
        body = json.loads(raw or b"{}")
        if not isinstance(body, dict):
            raise ValueError("body must be a JSON object")
        return 200, _ml.classify(body.get("points"))
    except (ValueError, json.JSONDecodeError) as e:
        return 400, {"error": str(e)}


class handler(BaseHTTPRequestHandler):
    def _send(self, status, payload):
        data = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        m = _ml.load_model()
        self._send(200, {"status": "ok", "classes": m.classes, "meta": m.meta})

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n > MAX_BODY:
            return self._send(413, {"error": "body too large"})
        self._send(*handle_classify(self.rfile.read(n)))

    def log_message(self, *args):  # never log request details
        pass
