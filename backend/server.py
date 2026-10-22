"""Air Doodle shape API (standard library only, runs anywhere Python runs).

    python server.py                       # http://localhost:8001
    PORT=9000 ALLOWED_ORIGINS=https://my-site.vercel.app python server.py

POST /api/classify   {"points": [[x, y], ...]}  ->  {"label", "confidence", "top3"}
GET  /health         {"status": "ok"}           (used by the host and to wake the server)
GET  /api/classify   model info

Receives only outline numbers of a doodle: no video, no images, no identifiers.
Request bodies are never logged or stored.

Environment:
  PORT               port to listen on (hosts like Render set this)
  ALLOWED_ORIGINS    comma-separated site origins allowed to call this API (default "*")
  RATE_LIMIT_PER_MIN max POSTs per client IP per minute (default 60)
"""
import json
import os
import sys
import time
from collections import defaultdict, deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ml_core  # noqa: E402

MAX_BODY = 32 * 1024
ALLOWED = [o.strip().rstrip("/") for o in os.environ.get("ALLOWED_ORIGINS", "*").split(",") if o.strip()]
RATE = int(os.environ.get("RATE_LIMIT_PER_MIN", "60"))
_hits = defaultdict(deque)


def origin_allowed(origin):
    return "*" in ALLOWED or origin.rstrip("/") in ALLOWED


def rate_ok(ip, now=None):
    now = time.monotonic() if now is None else now
    q = _hits[ip]
    while q and now - q[0] > 60:
        q.popleft()
    if len(q) >= RATE:
        return False
    q.append(now)
    if len(_hits) > 5000:  # keep memory bounded
        for k in [k for k, v in _hits.items() if not v][:1000]:
            _hits.pop(k, None)
    return True


def handle_classify(raw: bytes):
    """Pure function used by the server, the local dev server and the tests."""
    if len(raw) > MAX_BODY:
        return 413, {"error": "body too large"}
    try:
        body = json.loads(raw or b"{}")
        if not isinstance(body, dict):
            raise ValueError("body must be a JSON object")
        return 200, ml_core.classify(body.get("points"))
    except (ValueError, json.JSONDecodeError) as e:
        return 400, {"error": str(e)}


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _send(self, status, payload=None):
        data = b"" if payload is None else json.dumps(payload).encode()
        self.send_response(status)
        origin = self.headers.get("Origin")
        if origin and origin_allowed(origin):
            self.send_header("Access-Control-Allow-Origin", "*" if "*" in ALLOWED else origin)
            self.send_header("Vary", "Origin")
        if payload is not None:
            self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _client_ip(self):
        fwd = self.headers.get("X-Forwarded-For")
        return fwd.split(",")[0].strip() if fwd else self.client_address[0]

    def do_OPTIONS(self):  # CORS preflight
        origin = self.headers.get("Origin")
        if origin and not origin_allowed(origin):
            return self._send(403, {"error": "origin not allowed"})
        self.send_response(204)
        if origin:
            self.send_header("Access-Control-Allow-Origin", "*" if "*" in ALLOWED else origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Max-Age", "86400")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/health":
            return self._send(200, {"status": "ok"})
        if path in ("/", "/api/classify"):
            m = ml_core.load_model()
            return self._send(200, {"status": "ok", "classes": m.classes, "meta": m.meta})
        self._send(404, {"error": "not found"})

    def do_POST(self):
        if self.path.split("?")[0] != "/api/classify":
            return self._send(404, {"error": "not found"})
        origin = self.headers.get("Origin")
        if origin and not origin_allowed(origin):
            return self._send(403, {"error": "origin not allowed"})
        if not rate_ok(self._client_ip()):
            return self._send(429, {"error": "slow down a little"})
        n = int(self.headers.get("Content-Length") or 0)
        if n > MAX_BODY:
            return self._send(413, {"error": "body too large"})
        self._send(*handle_classify(self.rfile.read(n)))

    def log_message(self, *args):  # never log request details
        pass


def main():
    port = int(os.environ.get("PORT", 8001))
    ml_core.load_model()  # fail fast if the model file is missing
    print(f"air doodle shape API on :{port} (allowed origins: {', '.join(ALLOWED)})", flush=True)
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()


if __name__ == "__main__":
    main()
