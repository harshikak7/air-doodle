"""Stroke features + tiny MLP inference, pure standard library.

This one file is used by BOTH training (ml/train.py) and the serverless API
(api/classify.py), so features can never drift between training and serving.
Standard library only keeps Vercel cold starts fast (no numpy needed to serve).
"""
import json
import math
import os
from functools import lru_cache

N_RESAMPLE = 64   # points after arc-length resampling
GRID = 8          # occupancy grid is GRID x GRID
BINS = 12         # tangent-direction histogram bins (angle mod pi)
MODEL_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_model.json")


# ---------------------------------------------------------------- input checks
def validate_points(points, min_pts=8, max_pts=512):
    """Return a clean list of (x, y) floats or raise ValueError."""
    if not isinstance(points, list) or not (min_pts <= len(points) <= max_pts):
        raise ValueError(f"points must be a list of {min_pts}-{max_pts} [x, y] pairs")
    out = []
    for p in points:
        if not (isinstance(p, (list, tuple)) and len(p) == 2):
            raise ValueError("each point must be [x, y]")
        x, y = p
        if isinstance(x, bool) or isinstance(y, bool) or not all(isinstance(v, (int, float)) for v in (x, y)):
            raise ValueError("coordinates must be numbers")
        if not (math.isfinite(x) and math.isfinite(y)) or abs(x) > 1e6 or abs(y) > 1e6:
            raise ValueError("coordinates out of range")
        out.append((float(x), float(y)))
    return out


# ---------------------------------------------------------------- geometry
def resample(points, n=N_RESAMPLE):
    """n points spaced evenly along the stroke's arc length."""
    pts = [points[0]]
    for p in points[1:]:
        if abs(p[0] - pts[-1][0]) > 1e-9 or abs(p[1] - pts[-1][1]) > 1e-9:
            pts.append(p)
    if len(pts) < 2:
        return [pts[0]] * n
    cum = [0.0]
    for i in range(1, len(pts)):
        cum.append(cum[-1] + math.dist(pts[i - 1], pts[i]))
    total, out, j = cum[-1], [], 0
    for k in range(n):
        t = total * k / (n - 1)
        while j < len(cum) - 2 and cum[j + 1] < t:
            j += 1
        seg = cum[j + 1] - cum[j]
        u = 0.0 if seg == 0 else (t - cum[j]) / seg
        out.append((pts[j][0] + (pts[j + 1][0] - pts[j][0]) * u,
                    pts[j][1] + (pts[j + 1][1] - pts[j][1]) * u))
    return out


def _smooth(pts, passes=2):
    for _ in range(passes):
        pts = [pts[0]] + [((pts[i - 1][0] + 2 * pts[i][0] + pts[i + 1][0]) / 4,
                           (pts[i - 1][1] + 2 * pts[i][1] + pts[i + 1][1]) / 4)
                          for i in range(1, len(pts) - 1)] + [pts[-1]]
    return pts


def _wrap(a):
    while a > math.pi:
        a -= 2 * math.pi
    while a <= -math.pi:
        a += 2 * math.pi
    return a


# ---------------------------------------------------------------- features
def features(points):
    """Start-point and direction invariant description of a stroke (87 numbers)."""
    pts = resample(points)
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    w, h = max(xs) - min(xs), max(ys) - min(ys)
    m = max(w, h)
    if m < 1e-6:
        raise ValueError("degenerate stroke")
    cx, cy = (max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2
    P = [((x - cx) / (m / 2), (y - cy) / (m / 2)) for x, y in pts]  # fits [-1, 1]
    S = _smooth(P)
    n = len(P)

    # 1) where the ink is: 8x8 occupancy grid with bilinear splatting
    grid = [0.0] * (GRID * GRID)
    for x, y in P:
        gx, gy = (x + 1) / 2 * (GRID - 1), (y + 1) / 2 * (GRID - 1)
        x0, y0 = int(math.floor(gx)), int(math.floor(gy))
        fx, fy = gx - x0, gy - y0
        for dx, dy, wt in ((0, 0, (1 - fx) * (1 - fy)), (1, 0, fx * (1 - fy)),
                           (0, 1, (1 - fx) * fy), (1, 1, fx * fy)):
            grid[min(y0 + dy, GRID - 1) * GRID + min(x0 + dx, GRID - 1)] += wt
    grid = [g / n for g in grid]

    # 2) which way the pen travels: length-weighted tangent histogram (mod pi)
    hist, plen = [0.0] * BINS, 0.0
    for i in range(n - 1):
        dx, dy = S[i + 1][0] - S[i][0], S[i + 1][1] - S[i][1]
        seg = math.hypot(dx, dy)
        plen += seg
        pos = (math.atan2(dy, dx) % math.pi) / math.pi * BINS - 0.5
        b0 = math.floor(pos)
        f = pos - b0
        hist[b0 % BINS] += seg * (1 - f)
        hist[(b0 + 1) % BINS] += seg * f
    tot = sum(hist) or 1.0
    hist = [v / tot for v in hist]

    # 3) turning and corners
    turns = []
    for i in range(1, n - 1):
        a1 = math.atan2(S[i][1] - S[i - 1][1], S[i][0] - S[i - 1][0])
        a2 = math.atan2(S[i + 1][1] - S[i][1], S[i + 1][0] - S[i][0])
        turns.append(_wrap(a2 - a1))
    total_turn = sum(abs(t) for t in turns) / (2 * math.pi)
    net_turn = abs(sum(turns)) / (2 * math.pi)
    k, corner_ang = 3, []
    for i in range(k, n - k):
        v1 = (S[i][0] - S[i - k][0], S[i][1] - S[i - k][1])
        v2 = (S[i + k][0] - S[i][0], S[i + k][1] - S[i][1])
        corner_ang.append(abs(_wrap(math.atan2(v2[1], v2[0]) - math.atan2(v1[1], v1[0]))))
    corners, last = 0, -10
    for i, a in enumerate(corner_ang):
        if a > 0.9 and a >= max(corner_ang[max(0, i - k):i + k + 1]) and i - last >= k:
            corners += 1
            last = i

    # 4) size / shape scalars
    mx, my = sum(p[0] for p in P) / n, sum(p[1] for p in P) / n
    radii = [math.hypot(p[0] - mx, p[1] - my) for p in P]
    mean_r = sum(radii) / n or 1.0
    r_std = math.sqrt(sum((r - mean_r) ** 2 for r in radii) / n) / mean_r
    r_minmax = min(radii) / (max(radii) or 1.0)
    area = abs(sum(P[i][0] * P[(i + 1) % n][1] - P[(i + 1) % n][0] * P[i][1] for i in range(n))) / 2 / 4
    closure = math.dist(P[0], P[-1]) / (2 * math.sqrt(2))
    scalars = [closure, plen / 8, min(w, h) / m, total_turn, net_turn, corners / 10,
               r_std, r_minmax, area, mx, my]
    return grid + hist + scalars


N_FEATURES = GRID * GRID + BINS + 11


# ---------------------------------------------------------------- inference
class Model:
    def __init__(self, d):
        self.classes = d["classes"]
        self.mean, self.std = d["mean"], d["std"]
        self.layers = [([list(col) for col in zip(*L["W"])], L["b"]) for L in d["layers"]]  # (out, in)
        self.meta = d.get("meta", {})

    def predict_proba(self, x):
        x = [(v - m) / (s or 1.0) for v, m, s in zip(x, self.mean, self.std)]
        for i, (Wt, b) in enumerate(self.layers):
            x = [bj + sum(wi * xi for wi, xi in zip(row, x)) for row, bj in zip(Wt, b)]
            if i < len(self.layers) - 1:
                x = [v if v > 0 else 0.0 for v in x]
        mx = max(x)
        e = [math.exp(v - mx) for v in x]
        z = sum(e)
        return [v / z for v in e]


@lru_cache(maxsize=1)
def load_model(path=MODEL_PATH):
    with open(path) as f:
        return Model(json.load(f))


def classify(points):
    model = load_model()
    probs = model.predict_proba(features(validate_points(points)))
    ranked = sorted(zip(model.classes, probs), key=lambda t: -t[1])
    return {
        "label": ranked[0][0],
        "confidence": round(ranked[0][1], 4),
        "top3": [{"label": l, "p": round(p, 4)} for l, p in ranked[:3]],
    }
