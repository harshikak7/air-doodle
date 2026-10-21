"""Synthetic 'drawn in the air' strokes for training.

Real strokes are wobbly, start anywhere, go either way, overshoot or leave gaps,
and are sampled unevenly. This generator bakes all of that in, so the classifier
learns shape rather than one perfect template.
"""
import numpy as np

CLASSES = ["circle", "triangle", "square", "star", "heart", "line", "squiggle"]


# ---------------------------------------------------------------- ideal outlines
def _densify(verts, per_edge=40, closed=True):
    v = np.asarray(verts, float)
    if closed:
        v = np.vstack([v, v[:1]])
    segs = [np.linspace(v[i], v[i + 1], per_edge, endpoint=False) for i in range(len(v) - 1)]
    return np.vstack(segs + [v[-1:]])


def _round_corners(path, k):
    """Periodic moving average = rounded corners (people rarely draw sharp ones in the air)."""
    if k < 2:
        return path
    n = len(path) - 1
    core = path[:-1]
    ker = np.ones(k) / k
    out = np.stack([np.convolve(np.r_[core[-k:, d], core[:, d], core[:k, d]], ker, mode="same")[k:-k] for d in range(2)], 1)
    return np.vstack([out, out[:1]]) if n else path


def ideal(label, rng):
    """Return (dense path Nx2, closed?) centred roughly in [-1, 1]."""
    if label == "circle":
        t = np.linspace(0, 2 * np.pi, 220)
        return np.c_[np.cos(t), np.sin(t)], True
    if label == "square":
        j = rng.normal(0, 0.07, (4, 2))
        p = _densify(np.array([[-1, -1], [1, -1], [1, 1], [-1, 1]]) + j)
        return _round_corners(p, int(rng.integers(0, 28))), True
    if label == "triangle":
        j = rng.normal(0, 0.10, (3, 2))
        apex = rng.uniform(-0.35, 0.35)
        p = _densify(np.array([[apex, -1], [1, 1], [-1, 1]]) + j)
        return _round_corners(p, int(rng.integers(0, 24))), True
    if label == "star":
        r = rng.uniform(0.36, 0.55)
        ang = -np.pi / 2 + np.arange(10) * np.pi / 5
        rad = np.where(np.arange(10) % 2 == 0, 1.0, r)
        v = np.c_[np.cos(ang) * rad, np.sin(ang) * rad]
        if rng.random() < 0.45:  # one-stroke pentagram
            o = [0, 2, 4, 6, 8]
            v = np.c_[np.cos(ang[o]) * 1.0, np.sin(ang[o]) * 1.0][[0, 2, 4, 1, 3]]
        p = _densify(v + rng.normal(0, 0.04, v.shape), 30)
        return _round_corners(p, int(rng.integers(0, 10))), True
    if label == "heart":
        t = np.linspace(0, 2 * np.pi, 240)
        x = 16 * np.sin(t) ** 3
        y = -(13 * np.cos(t) - 5 * np.cos(2 * t) - 2 * np.cos(3 * t) - np.cos(4 * t))
        x = x / np.abs(x).max()
        y = (y - (y.max() + y.min()) / 2) / ((y.max() - y.min()) / 2)
        return np.c_[x, y], True
    if label == "line":
        x = np.linspace(-1, 1, 120)
        bow = rng.uniform(-0.15, 0.15)
        return np.c_[x, bow * (1 - x ** 2)], False
    # squiggle = everything that is not one of the clean shapes
    kind = rng.choice(["wave", "zigzag", "scribble", "arc", "spiral"])
    if kind == "wave":
        x = np.linspace(-1, 1, 200)
        return np.c_[x, rng.uniform(0.2, 0.6) * np.sin(x * np.pi * rng.uniform(1.5, 4.5) + rng.uniform(0, 6))], False
    if kind == "zigzag":
        n = int(rng.integers(3, 8))
        v = np.c_[np.linspace(-1, 1, n + 1), (np.arange(n + 1) % 2 * 2 - 1) * rng.uniform(0.3, 0.9, n + 1)]
        return _densify(v, 25, closed=False), False
    if kind == "arc":
        t = np.linspace(0, rng.uniform(0.9, 4.4), 160)
        return np.c_[np.cos(t), np.sin(t)], False
    if kind == "spiral":
        t = np.linspace(0, rng.uniform(5, 11), 220)
        return np.c_[t * np.cos(t), t * np.sin(t)] / t.max(), False
    steps = rng.normal(0, 1, (260, 2)).cumsum(0)
    ker = np.ones(25) / 25
    return np.c_[np.convolve(steps[:, 0], ker, "same"), np.convolve(steps[:, 1], ker, "same")], False


# ---------------------------------------------------------------- turn an ideal path into a "hand-drawn" stroke
def draw(label, rng, noise=1.0):
    path, closed = ideal(label, rng)
    seg = np.r_[0, np.cumsum(np.linalg.norm(np.diff(path, axis=0), axis=1))]
    total = seg[-1]
    if closed:  # start anywhere, either direction, overshoot or leave a gap
        loop = total * rng.uniform(0.9, 1.16)
        s = (rng.uniform(0, total) + np.linspace(0, loop, 500)) % total
        if rng.random() < 0.5:
            s = s[::-1]
    else:
        s = np.linspace(0, total, 500)
        if rng.random() < 0.5:
            s = s[::-1]
    pts = np.c_[np.interp(s, seg, path[:, 0]), np.interp(s, seg, path[:, 1])]

    # uneven pen speed -> uneven point spacing
    m = int(rng.integers(25, 170))
    u = np.cumsum(rng.lognormal(0, 0.6, m))
    u = (u - u[0]) / (u[-1] - u[0])
    idx = np.interp(u, np.linspace(0, 1, len(pts)), np.arange(len(pts)))
    pts = np.c_[np.interp(idx, np.arange(len(pts)), pts[:, 0]), np.interp(idx, np.arange(len(pts)), pts[:, 1])]

    # anisotropic scale + rotation (hearts/triangles stay roughly upright; lines/squiggles can turn fully)
    pts = pts * rng.uniform(0.7, 1.4, 2)
    th = rng.uniform(-np.pi, np.pi) if label in ("line", "squiggle") else rng.normal(0, 0.22)
    c, sn = np.cos(th), np.sin(th)
    pts = pts @ np.array([[c, -sn], [sn, c]]).T

    # slow hand wobble (smooth) + a little sensor jitter
    sigma = rng.uniform(0.012, 0.05) * noise
    ker = np.hanning(max(5, m // 6))
    ker /= ker.sum()
    wob = np.stack([np.convolve(rng.normal(0, 1, m + 2 * len(ker)), ker, "same")[len(ker):-len(ker)] for _ in range(2)], 1)
    wob = wob / (wob.std() + 1e-9) * sigma
    pts = pts + wob + rng.normal(0, sigma / 3, pts.shape)

    if rng.random() < 0.25:  # little hook when the fingers open
        d = rng.normal(0, 1, 2)
        d = d / np.linalg.norm(d) * rng.uniform(0.05, 0.16)
        hook = pts[-1] + np.outer(np.linspace(0.3, 1, int(rng.integers(2, 5))), d)
        pts = np.vstack([pts, hook])

    size = rng.uniform(80, 600)
    return (pts * size + rng.uniform(100, 800, 2)).round(1).tolist()


def make_dataset(per_class, seed, noise=1.0):
    rng = np.random.default_rng(seed)
    X, y = [], []
    for ci, label in enumerate(CLASSES):
        for _ in range(per_class):
            X.append(draw(label, rng, noise))
            y.append(ci)
    return X, np.array(y)
