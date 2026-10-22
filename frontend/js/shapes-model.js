/* On-device twin of api/_ml.py (same features, same MLP). Used when /api/classify isn't available,
   so magic shapes works on any static host and no data leaves the browser. Parity is tested in tests/. */
(function (root) {
  const N = 64, GRID = 8, BINS = 12;
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const mod = (a, m) => ((a % m) + m) % m;

  function resample(points, n = N) {
    const pts = [points[0]];
    for (const p of points.slice(1)) { const l = pts[pts.length - 1]; if (Math.abs(p[0] - l[0]) > 1e-9 || Math.abs(p[1] - l[1]) > 1e-9) pts.push(p); }
    if (pts.length < 2) return Array.from({ length: n }, () => pts[0]);
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i]));
    const total = cum[cum.length - 1], out = []; let j = 0;
    for (let k = 0; k < n; k++) {
      const t = total * k / (n - 1);
      while (j < cum.length - 2 && cum[j + 1] < t) j++;
      const seg = cum[j + 1] - cum[j], u = seg === 0 ? 0 : (t - cum[j]) / seg;
      out.push([pts[j][0] + (pts[j + 1][0] - pts[j][0]) * u, pts[j][1] + (pts[j + 1][1] - pts[j][1]) * u]);
    }
    return out;
  }
  function smooth(pts, passes = 2) {
    for (let k = 0; k < passes; k++) {
      const q = pts;
      pts = [q[0]];
      for (let i = 1; i < q.length - 1; i++) pts.push([(q[i - 1][0] + 2 * q[i][0] + q[i + 1][0]) / 4, (q[i - 1][1] + 2 * q[i][1] + q[i + 1][1]) / 4]);
      pts.push(q[q.length - 1]);
    }
    return pts;
  }
  function wrap(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a <= -Math.PI) a += 2 * Math.PI; return a; }

  function features(points) {
    const pts = resample(points), xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys), m = Math.max(w, h);
    if (m < 1e-6) throw new Error('degenerate stroke');
    const cx = (Math.max(...xs) + Math.min(...xs)) / 2, cy = (Math.max(...ys) + Math.min(...ys)) / 2;
    const P = pts.map(([x, y]) => [(x - cx) / (m / 2), (y - cy) / (m / 2)]), S = smooth(P), n = P.length;

    const grid = new Array(GRID * GRID).fill(0);
    for (const [x, y] of P) {
      const gx = (x + 1) / 2 * (GRID - 1), gy = (y + 1) / 2 * (GRID - 1), x0 = Math.floor(gx), y0 = Math.floor(gy), fx = gx - x0, fy = gy - y0;
      for (const [dx, dy, wt] of [[0, 0, (1 - fx) * (1 - fy)], [1, 0, fx * (1 - fy)], [0, 1, (1 - fx) * fy], [1, 1, fx * fy]])
        grid[Math.min(y0 + dy, GRID - 1) * GRID + Math.min(x0 + dx, GRID - 1)] += wt;
    }
    for (let i = 0; i < grid.length; i++) grid[i] /= n;

    const hist = new Array(BINS).fill(0); let plen = 0;
    for (let i = 0; i < n - 1; i++) {
      const dx = S[i + 1][0] - S[i][0], dy = S[i + 1][1] - S[i][1], seg = Math.hypot(dx, dy);
      plen += seg;
      const pos = mod(Math.atan2(dy, dx), Math.PI) / Math.PI * BINS - 0.5, b0 = Math.floor(pos), f = pos - b0;
      hist[mod(b0, BINS)] += seg * (1 - f); hist[mod(b0 + 1, BINS)] += seg * f;
    }
    const tot = hist.reduce((a, b) => a + b, 0) || 1;
    for (let i = 0; i < BINS; i++) hist[i] /= tot;

    const turns = [];
    for (let i = 1; i < n - 1; i++) {
      const a1 = Math.atan2(S[i][1] - S[i - 1][1], S[i][0] - S[i - 1][0]), a2 = Math.atan2(S[i + 1][1] - S[i][1], S[i + 1][0] - S[i][0]);
      turns.push(wrap(a2 - a1));
    }
    const totalTurn = turns.reduce((a, t) => a + Math.abs(t), 0) / (2 * Math.PI), netTurn = Math.abs(turns.reduce((a, t) => a + t, 0)) / (2 * Math.PI);
    const k = 3, ca = [];
    for (let i = k; i < n - k; i++) {
      const v1 = [S[i][0] - S[i - k][0], S[i][1] - S[i - k][1]], v2 = [S[i + k][0] - S[i][0], S[i + k][1] - S[i][1]];
      ca.push(Math.abs(wrap(Math.atan2(v2[1], v2[0]) - Math.atan2(v1[1], v1[0]))));
    }
    let corners = 0, last = -10;
    ca.forEach((a, i) => { if (a > 0.9 && a >= Math.max(...ca.slice(Math.max(0, i - k), i + k + 1)) && i - last >= k) { corners++; last = i; } });

    const mx = P.reduce((a, p) => a + p[0], 0) / n, my = P.reduce((a, p) => a + p[1], 0) / n;
    const radii = P.map(p => Math.hypot(p[0] - mx, p[1] - my)), meanR = radii.reduce((a, b) => a + b, 0) / n || 1;
    const rStd = Math.sqrt(radii.reduce((a, r) => a + (r - meanR) ** 2, 0) / n) / meanR, rMinMax = Math.min(...radii) / (Math.max(...radii) || 1);
    let ar = 0; for (let i = 0; i < n; i++) { const a = P[i], b = P[(i + 1) % n]; ar += a[0] * b[1] - b[0] * a[1]; }
    const area = Math.abs(ar) / 2 / 4, closure = dist(P[0], P[n - 1]) / (2 * Math.SQRT2);
    return [...grid, ...hist, closure, plen / 8, Math.min(w, h) / m, totalTurn, netTurn, corners / 10, rStd, rMinMax, area, mx, my];
  }

  function predict(model, x) {
    x = x.map((v, i) => (v - model.mean[i]) / (model.std[i] || 1));
    model.layers.forEach((L, li) => {
      const out = L.b.map((bj, j) => { let s = bj; for (let i = 0; i < x.length; i++) s += x[i] * L.W[i][j]; return s; });
      x = li < model.layers.length - 1 ? out.map(v => v > 0 ? v : 0) : out;
    });
    const mx = Math.max(...x), e = x.map(v => Math.exp(v - mx)), z = e.reduce((a, b) => a + b, 0);
    return e.map(v => v / z);
  }
  function classify(model, points) {
    const probs = predict(model, features(points)), r = model.classes.map((l, i) => ({ label: l, p: probs[i] })).sort((a, b) => b.p - a.p);
    return { label: r[0].label, confidence: r[0].p, top3: r.slice(0, 3) };
  }
  const api = { features, predict, classify };
  root.ShapeModel = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
