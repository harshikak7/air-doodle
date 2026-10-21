"""The on-device JS model must match the Python API exactly. Skipped if Node isn't installed."""
import json, math, os, random, shutil, subprocess, sys, tempfile, unittest

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path.insert(0, os.path.join(ROOT, "api"))
import _ml  # noqa: E402


def strokes(seed=1, count=30):
    rnd, out = random.Random(seed), []
    for i in range(count):
        n, r, kind = rnd.randint(20, 120), rnd.uniform(40, 300), i % 4
        pts = []
        for k in range(n):
            t = 2 * math.pi * k / n * rnd.uniform(0.9, 1.15)
            if kind == 0: x, y = r * math.cos(t), r * math.sin(t)
            elif kind == 1: x, y = r * (1 if math.cos(t) > 0 else -1) * min(1, abs(math.cos(t)) * 2), r * (1 if math.sin(t) > 0 else -1) * min(1, abs(math.sin(t)) * 2)
            elif kind == 2: x, y = k * r / n * 3, r * 0.3 * math.sin(k / 3)
            else: x, y = r * 16 * math.sin(t) ** 3 / 16, -r * (13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t)) / 16
            pts.append([round(x + rnd.gauss(0, 2) + 400, 1), round(y + rnd.gauss(0, 2) + 300, 1)])
        out.append(pts)
    return out


@unittest.skipUnless(shutil.which("node"), "node not installed")
class Parity(unittest.TestCase):
    def test_python_and_js_agree(self):
        data = strokes()
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
            json.dump(data, f)
        try:
            res = json.loads(subprocess.check_output(["node", os.path.join(ROOT, "tests", "parity.js"), f.name]))
        finally:
            os.unlink(f.name)
        model = _ml.load_model()
        worst_f = worst_p = 0.0
        for s, r in zip(data, res):
            py_f = _ml.features([tuple(p) for p in s])
            worst_f = max(worst_f, max(abs(a - b) for a, b in zip(py_f, r["features"])))
            worst_p = max(worst_p, max(abs(a - b) for a, b in zip(model.predict_proba(py_f), r["probs"])))
        self.assertLess(worst_f, 1e-9)
        self.assertLess(worst_p, 1e-9)


if __name__ == "__main__":
    unittest.main()
