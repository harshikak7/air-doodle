"""Run: python3 -m unittest discover -s tests -v   (standard library only)"""
import json
import math
import os
import sys
import threading
import unittest
import urllib.request
from http.server import HTTPServer

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "api"))
import _ml  # noqa: E402
from api.main import handler, handle_classify  # noqa: E402


def circle(n=60, r=100, cx=300, cy=300):
    return [[cx + r * math.cos(2 * math.pi * i / n), cy + r * math.sin(2 * math.pi * i / n)] for i in range(n + 1)]


def poly(v, per=15):
    out = []
    for a, b in zip(v, v[1:] + v[:1]):
        out += [[a[0] + (b[0] - a[0]) * t / per, a[1] + (b[1] - a[1]) * t / per] for t in range(per)]
    return out + [v[0]]


class Features(unittest.TestCase):
    def test_vector_length_and_finite(self):
        f = _ml.features(circle())
        self.assertEqual(len(f), _ml.N_FEATURES)
        self.assertTrue(all(math.isfinite(v) for v in f))

    def test_scale_and_translation_invariant(self):
        a, b = _ml.features(circle(r=50, cx=10, cy=10)), _ml.features(circle(r=400, cx=900, cy=-30))
        self.assertLess(max(abs(x - y) for x, y in zip(a, b)), 1e-6)

    def test_degenerate_stroke_rejected(self):
        with self.assertRaises(ValueError):
            _ml.features([(5, 5)] * 20)


class Classify(unittest.TestCase):
    def test_clean_shapes(self):
        self.assertEqual(_ml.classify(circle())["label"], "circle")
        self.assertEqual(_ml.classify(poly([[0, 0], [200, 0], [200, 200], [0, 200]]))["label"], "square")
        self.assertEqual(_ml.classify([[i * 5, i * 2] for i in range(40)])["label"], "line")

    def test_validation(self):
        for bad in (None, [], [[1, 2]] * 3, [[1, 2, 3]] * 20, [["a", "b"]] * 20, [[True, False]] * 20, [[1e9, 0]] * 20, "circle"):
            status, body = handle_classify(json.dumps({"points": bad}).encode())
            self.assertEqual(status, 400, bad)
            self.assertIn("error", body)
        self.assertEqual(handle_classify(b'{"points":[' + b"[Infinity,0]," * 19 + b"[1,1]]}")[0], 400)
        self.assertEqual(handle_classify(b"not json")[0], 400)
        self.assertEqual(handle_classify(b"[]")[0], 400)
        self.assertEqual(handle_classify(b"x" * 40000)[0], 413)


class Http(unittest.TestCase):
    def test_roundtrip(self):
        srv = HTTPServer(("127.0.0.1", 0), handler)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        url = f"http://127.0.0.1:{srv.server_port}/"
        req = urllib.request.Request(url, json.dumps({"points": circle()}).encode(), {"Content-Type": "application/json"})
        with urllib.request.urlopen(req) as r:
            body = json.load(r)
        self.assertEqual(body["label"], "circle")
        self.assertGreater(body["confidence"], 0.5)
        with urllib.request.urlopen(url) as r:
            self.assertEqual(json.load(r)["status"], "ok")
        srv.shutdown()
        srv.server_close()


if __name__ == "__main__":
    unittest.main()
