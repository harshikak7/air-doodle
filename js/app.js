/* air doodle
   Hand tracking: MediaPipe Hands (self-hosted in /vendor, runs in this tab).
   Pinch thumb + index = draw. Pinch on a sticker = carry it. Nothing leaves the device. */
const $ = s => document.querySelector(s);
const cv = $('#cv'), ctx = cv.getContext('2d'), vid = $('#vid'), hint = $('#hint'), stage = $('#stage');
const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
const COLORS = ['#B79CF0', '#F5A9C4', '#8FD6C0', '#F7CE7A', '#9DB8F5'];
const BONES = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];
const PINCH_ON = 0.32, PINCH_OFF = 0.5, PINCH_FIRM = 0.4;  // thumb-index distance / palm size. ON/OFF = hysteresis, FIRM = stop adding points once fingers start opening

// One Euro filter: smooth when the hand is slow (kills jitter), responsive when it moves fast (no lag)
class OneEuro {
  constructor(mc = 1.2, beta = 0.012, dc = 1) { this.mc = mc; this.beta = beta; this.dc = dc; this.x = null; this.dx = 0; }
  a(c, dt) { return 1 / (1 + (1 / (2 * Math.PI * c)) / dt); }
  f(v, dt) {
    if (this.x === null) { this.x = v; return v; }
    this.dx += this.a(this.dc, dt) * ((v - this.x) / dt - this.dx);
    this.x += this.a(this.mc + this.beta * Math.abs(this.dx), dt) * (v - this.x);
    return this.x;
  }
  reset() { this.x = null; this.dx = 0; }
}
const fx = new OneEuro(), fy = new OneEuro();

let W = 0, H = 0, ci = 0;
const S = {
  mode: null, stream: null, hands: null, ready: false, busy: false,
  hand: null, seen: 0, lastInf: 0, lastT: -1, onN: 0, offN: 0, pinchRaw: false, pinching: false, drawing: false,
  stroke: [], stickers: [], grab: null, drag: null, touchDraw: false, lastTap: null, flashUntil: 0, magic: false, log: [], nid: 0, hinted: false
};

function resize() {
  const d = Math.min(devicePixelRatio || 1, 2), r = stage.getBoundingClientRect();
  W = r.width; H = r.height;
  cv.width = W * d; cv.height = H * d; cv.style.width = W + 'px'; cv.style.height = H + 'px';
  ctx.setTransform(d, 0, 0, d, 0, 0);
}
addEventListener('resize', resize); resize();
const say = t => { if (hint.textContent !== t) hint.textContent = t; hint.hidden = !t; };
const flash = (t, ms = 2600) => { say(t); S.flashUntil = performance.now() + ms; };

/* ---------- camera + MediaPipe ---------- */
function geo() {
  const vw = vid.videoWidth || 4, vh = vid.videoHeight || 3, sc = Math.max(W / vw, H / vh);
  return { vw, vh, sc, ox: (W - vw * sc) / 2, oy: (H - vh * sc) / 2 };
}
// landmark (0..1 in the camera frame) -> screen px, mirrored to match the selfie view
function lm2s(x, y) { const g = geo(); return { x: W - (g.ox + x * g.vw * g.sc), y: g.oy + y * g.vh * g.sc }; }

function onResults(res) {
  const L = res.multiHandLandmarks && res.multiHandLandmarks[0], now = performance.now();
  if (!L) { S.hand = null; S.onN = S.offN = 0; if (now - S.seen > 300) { fx.reset(); fy.reset(); } return; }
  const g = geo(), P = i => ({ x: L[i].x * g.vw, y: L[i].y * g.vh }), d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const size = (d(P(0), P(9)) + d(P(5), P(17))) / 2 || 1, ratio = d(P(4), P(8)) / size;
  // need 2 frames in a row to switch state, so one noisy frame can't start or break a stroke
  if (!S.pinchRaw) { S.onN = ratio < PINCH_ON ? S.onN + 1 : 0; if (S.onN >= 2) { S.pinchRaw = true; S.offN = 0; } }
  else { S.offN = ratio > PINCH_OFF ? S.offN + 1 : 0; if (S.offN >= 2) { S.pinchRaw = false; S.onN = 0; } }
  const dt = Math.min(0.1, Math.max(0.008, (now - (S.lastInf || now - 33)) / 1000)); S.lastInf = now;
  const mid = lm2s((L[4].x + L[8].x) / 2, (L[4].y + L[8].y) / 2);
  const pt = { x: fx.f(mid.x, dt), y: fy.f(mid.y, dt) };
  S.hand = { pts: L.map(l => lm2s(l.x, l.y)), pt, pinch: S.pinchRaw, firm: ratio < PINCH_FIRM, ratio };
  S.seen = now;
}

async function startCam() {
  $('#err').hidden = true;
  try {
    S.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
    vid.srcObject = S.stream; await vid.play();
  } catch (e) {
    const el = $('#err'); el.hidden = false;
    el.textContent = (e && e.name === 'NotAllowedError') ? 'No camera access, that’s okay! Touch mode works too.' : 'I can’t reach a camera here. Touch mode works too.';
    return;
  }
  S.mode = 'cam'; S.ready = false; enter(); say('waking up the hand-spotter…');
  try {
    if (!S.hands) {
      const mobile = matchMedia('(pointer:coarse)').matches;
      S.hands = new Hands({ locateFile: f => 'vendor/mediapipe/hands/' + f });
      S.hands.setOptions({ maxNumHands: 1, modelComplexity: mobile ? 0 : 1, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5, selfieMode: false });
      S.hands.onResults(onResults);
      await S.hands.initialize();
    }
    S.ready = true;
  } catch (e) {
    console.error(e); stopCam(); S.mode = 'touch'; enter(); flash('hand tracking didn’t load here, so here’s touch mode', 4000);
  }
}
function stopCam() { if (S.stream) { S.stream.getTracks().forEach(t => t.stop()); S.stream = null; } vid.srcObject = null; }
function leave() {
  stopCam(); S.mode = null; S.hand = null; S.pinching = S.drawing = false; S.grab = null; S.stroke = [];
  stage.classList.remove('cam'); $('#intro').hidden = false; $('#dock').hidden = true; $('#stopBtn').hidden = true; $('#magicBtn').hidden = true; say('');
}
addEventListener('pagehide', stopCam);

function enter() {
  const cam = S.mode === 'cam';
  $('#intro').hidden = true; $('#dock').hidden = false; $('#stopBtn').hidden = false;
  stage.classList.toggle('cam', cam); $('#stopBtn').textContent = cam ? 'stop camera' : 'back';
  resize(); refreshUI(); $('#magicBtn').hidden = false; syncMagic();
  if (!cam) say('drag anywhere to draw. let go and it pops into a sticker');
}

/* ---------- stickers ---------- */
function smooth(a) {
  let p = a;
  for (let k = 0; k < 2; k++) { const q = p; p = q.map((v, i) => i === 0 || i === q.length - 1 ? v : { x: (q[i-1].x + v.x + q[i+1].x) / 3, y: (q[i-1].y + v.y + q[i+1].y) / 3 }); }
  const o = [p[0]]; for (const v of p) { const l = o[o.length - 1]; if (Math.hypot(v.x - l.x, v.y - l.y) > 5) o.push(v); }
  return o;
}
function pop() {
  const raw = S.stroke; S.stroke = []; S.touchDraw = false;
  if (raw.length < 8) { flash('a little bigger, please! keep pinching while you move'); return; }
  const p = smooth(raw); let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const v of p) { x0 = Math.min(x0, v.x); y0 = Math.min(y0, v.y); x1 = Math.max(x1, v.x); y1 = Math.max(y1, v.y); }
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const rel = raw.map(v => [Math.round(v.x - x0), Math.round(v.y - y0)]), step = Math.ceil(rel.length / 160);
  const st = { id: S.nid++, p: p.map(v => ({ x: v.x - cx, y: v.y - cy })), w: x1 - x0, h: y1 - y0, x: cx, y: cy, s: 1, r: 0, lw: 10, col: COLORS[ci++ % COLORS.length], t0: performance.now(), ph: Math.random() * 6.28,
    raw: rel.filter((_, i) => i % step === 0 || i === rel.length - 1), label: null };
  st.p0 = st.p; st.w0 = st.w; st.h0 = st.h; S.stickers.push(st);
  flash(S.mode === 'cam' ? 'popped! pinch it to carry it around' : 'popped! drag it around. double-tap to resize');
  if (S.magic) classifyStroke(st);
  refreshUI();
}
function refreshUI() { const e = !S.stickers.length; $('#undoBtn').disabled = e; $('#shareBtn').disabled = e; $('#clearBtn').disabled = e; $('#exportBtn').hidden = !S.log.length; }
function path(g, p) {
  g.beginPath(); g.moveTo(p[0].x, p[0].y);
  for (let i = 1; i < p.length - 1; i++) g.quadraticCurveTo(p[i].x, p[i].y, (p[i].x + p[i+1].x) / 2, (p[i].y + p[i+1].y) / 2);
  const l = p[p.length - 1]; g.lineTo(l.x, l.y);
}
function drawSticker(g, st, x, y, rot, sc) {
  g.save(); g.translate(x, y); g.rotate(rot); g.scale(sc, sc); g.lineCap = 'round'; g.lineJoin = 'round';
  path(g, st.p);
  g.strokeStyle = '#FBF8F3'; g.lineWidth = st.lw + 14; g.shadowColor = 'rgba(70,45,130,.3)'; g.shadowBlur = 16; g.shadowOffsetY = 7; g.stroke();
  g.shadowColor = 'transparent'; g.strokeStyle = st.col; g.lineWidth = st.lw; g.stroke();
  g.strokeStyle = 'rgba(255,255,255,.42)'; g.lineWidth = st.lw * .3; g.stroke();
  g.restore();
}
function hit(p) {
  for (let i = S.stickers.length - 1; i >= 0; i--) {
    const s = S.stickers[i], c = Math.cos(-s.r), n = Math.sin(-s.r), dx = p.x - s.x, dy = p.y - s.y;
    const lx = (dx * c - dy * n) / s.s, ly = (dx * n + dy * c) / s.s;
    if (Math.abs(lx) < s.w / 2 + 28 && Math.abs(ly) < s.h / 2 + 28) return s;
  }
  return null;
}
const front = s => { const i = S.stickers.indexOf(s); if (i >= 0) { S.stickers.splice(i, 1); S.stickers.push(s); } };


/* ---------- magic shapes: a Python model (api/classify.py) names the doodle, then it is tidied up ---------- */
const LABELS = ['circle', 'triangle', 'square', 'star', 'heart', 'line', 'squiggle'];
let T = {};
function readTheme() { const c = getComputedStyle(document.documentElement); T = { surface: c.getPropertyValue('--surface').trim() || '#fff', ink: c.getPropertyValue('--ink').trim() || '#3A3052' }; }
readTheme(); matchMedia('(prefers-color-scheme: dark)').addEventListener('change', readTheme);

function closedPoly(v) {  // each edge gets a few points and every corner is doubled, so corners stay crisp but softly rounded
  const n = v.length, o = [];
  for (let i = 0; i < n; i++) {
    const a = v[i], b = v[(i + 1) % n];
    for (let k = 1; k <= 6; k++) { const t = k / 6, q = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }; o.push(q); if (k === 6) o.push(q); }
  }
    return [...o.slice(2), ...o.slice(0, 3)];
}
function tpl(label, st) {
  let tw = Math.max(st.w0, 24), th = Math.max(st.h0, 24);
  if (label !== 'line') { const a = tw / th; if (a > 1.33) tw = th * 1.33; else if (a < 0.75) th = tw / 0.75; }
  const P = (x, y) => ({ x: x * tw, y: y * th });
  if (label === 'circle') { const o = []; for (let i = 0; i <= 48; i++) { const t = i / 48 * Math.PI * 2; o.push(P(Math.cos(t) / 2, Math.sin(t) / 2)); } return o; }
  if (label === 'square') return closedPoly([P(-.5, -.5), P(.5, -.5), P(.5, .5), P(-.5, .5)]);
  if (label === 'triangle') return closedPoly([P(0, -.5), P(.5, .5), P(-.5, .5)]);
  if (label === 'star') { const v = []; for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? .2 : .5; v.push(P(Math.cos(a) * r, Math.sin(a) * r + .047)); } return closedPoly(v); }
  if (label === 'heart') {
    const o = []; let y0 = 1e9, y1 = -1e9;
    for (let i = 0; i <= 60; i++) { const t = i / 60 * Math.PI * 2, y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)); o.push({ x: 16 * Math.pow(Math.sin(t), 3), y }); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    return o.map(q => P(q.x / 32, (q.y - (y0 + y1) / 2) / (y1 - y0)));
  }
  if (label === 'line') return [st.p0[0], st.p0[st.p0.length - 1]];
  return st.p0;
}
function applyLabel(st, label, conf, verified) {
  st.label = label; st.conf = conf; st.verified = !!verified; st.labelT = performance.now();
  st.snapped = LABELS.includes(label) && label !== 'squiggle' && (verified || conf >= 0.55);
  const p = st.snapped ? tpl(label, st) : st.p0;
  if (p !== st.p) {
    st.p = p; st.t0 = performance.now();
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const q of p) { x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y); }
    st.w = Math.max(x1 - x0, 8); st.h = Math.max(y1 - y0, 8);
  }
  const rec = { id: st.id, label, points: st.raw, verified: !!verified }, i = S.log.findIndex(r => r.id === st.id);
  if (i >= 0) S.log[i] = rec; else S.log.push(rec);
  refreshUI();
}
async function classifyStroke(st) {
  try {
    const r = await fetch('api/classify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ points: st.raw }) });
    if (!r.ok) throw new Error(r.status);
    const j = await r.json();
    if (!S.magic || !S.stickers.includes(st)) return;
    applyLabel(st, j.label, j.confidence, false);
    flash(S.hinted ? (j.label === 'squiggle' ? 'a nice squiggle!' : 'that’s a ' + j.label + '!') : 'tap the label if i got it wrong', 3200); S.hinted = true;
  } catch (e) { S.magic = false; syncMagic(); flash('the shape model isn’t reachable here, so magic is off', 3800); }
}
function cycleLabel(st) { applyLabel(st, LABELS[(LABELS.indexOf(st.label) + 1) % LABELS.length], 1, true); }
function chipAt(p) { for (let i = S.stickers.length - 1; i >= 0; i--) { const c = S.stickers[i].chip; if (c && Math.abs(p.x - c.x) < c.w / 2 && Math.abs(p.y - c.y) < c.h / 2 + 4) return S.stickers[i]; } return null; }
function drawChips(now) {
  ctx.font = '700 14px Nunito, "Trebuchet MS", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const s of S.stickers) {
    s.chip = null; if (!s.label) continue;
    const age = now - s.labelT; if (age > 4500) continue;
    const a = Math.min(1, (4500 - age) / 700), txt = s.verified || s.conf >= .9 ? s.label : s.snapped ? s.label + ' ' + Math.round(s.conf * 100) + '%' : 'maybe ' + s.label;
    const w = ctx.measureText(txt).width + 26, h = 30;
    const x = Math.min(W - w / 2 - 8, Math.max(w / 2 + 8, s.x)), y = Math.max(110, s.y - s.h / 2 * s.s - 38);
    s.chip = a > 0.3 ? { x, y, w, h } : null;
    ctx.save(); ctx.globalAlpha = a; ctx.shadowColor = 'rgba(70,45,130,.25)'; ctx.shadowBlur = 12; ctx.shadowOffsetY = 4;
    ctx.fillStyle = T.surface; ctx.beginPath(); ctx.roundRect(x - w / 2, y - h / 2, w, h, 15); ctx.fill();
    ctx.shadowColor = 'transparent'; ctx.fillStyle = T.ink; ctx.fillText(txt, x, y + 1); ctx.restore();
  }
}
function syncMagic() {
  const b = $('#magicBtn'); b.textContent = 'magic shapes: ' + (S.magic ? 'on' : 'off'); b.setAttribute('aria-pressed', S.magic); $('#magicOpt').checked = S.magic;
}
function exportStrokes() {
  const blob = new Blob([JSON.stringify({ version: 1, classes: LABELS, samples: S.log.map(({ label, points, verified }) => ({ label, points, verified })) })], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'strokes.json';
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* ---------- mouse / touch ---------- */
const pt = e => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
cv.addEventListener('pointerdown', e => {
  if (!S.mode) return; const p = pt(e), cs = chipAt(p), h = cs ? null : hit(p); cv.setPointerCapture(e.pointerId);
  if (cs) { cycleLabel(cs); return; }
  if (h) {
    const now = performance.now();
    if (S.lastTap && S.lastTap.s === h && now - S.lastTap.t < 320) h.s = h.s < .85 ? 1 : h.s < 1.2 ? 1.5 : .7;
    S.lastTap = { s: h, t: now }; S.drag = { st: h, ox: h.x - p.x, oy: h.y - p.y }; front(h); cv.style.cursor = 'grabbing';
  } else if (S.mode === 'touch') { S.touchDraw = true; S.stroke = [p]; }
});
cv.addEventListener('pointermove', e => {
  const p = pt(e);
  if (S.drag) { S.drag.st.x = p.x + S.drag.ox; S.drag.st.y = p.y + S.drag.oy; }
  else if (S.touchDraw) { const l = S.stroke[S.stroke.length - 1]; if (Math.hypot(p.x - l.x, p.y - l.y) > 2.5) S.stroke.push(p); }
});
const up = () => { if (S.drag) { S.drag = null; cv.style.cursor = 'crosshair'; } if (S.touchDraw) pop(); };
cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
cv.addEventListener('wheel', e => { const h = hit(pt(e)); if (h) { e.preventDefault(); h.s = Math.min(3, Math.max(.4, h.s * Math.exp(-e.deltaY * .0015))); } }, { passive: false });

/* ---------- gesture logic ---------- */
function endPinch() {
  S.pinching = false;
  if (S.grab) { S.grab = null; flash('placed!', 1200); }
  if (S.drawing) { S.drawing = false; if (S.stroke.length > 12) S.stroke.splice(-3); pop(); }
}
function logic(now) {
  if (S.mode !== 'cam' || !S.ready) return;
  const h = S.hand;
  if (h && h.pinch) {
    const p = h.pt;
    if (!S.pinching) {
      S.pinching = true; const st = hit(p);
      if (st) { S.grab = { st, dx: st.x - p.x, dy: st.y - p.y }; front(st); }
      else { S.drawing = true; S.stroke = [{ x: p.x, y: p.y }]; }
    } else if (S.grab) { S.grab.st.x = p.x + S.grab.dx; S.grab.st.y = p.y + S.grab.dy; }
    else if (S.drawing && h.firm) { const l = S.stroke[S.stroke.length - 1]; if (Math.hypot(p.x - l.x, p.y - l.y) > 2.5) S.stroke.push({ x: p.x, y: p.y }); }
  } else if (S.pinching && (h || now - S.seen > 400)) endPinch();
  if (now > S.flashUntil) {
    say(S.grab ? 'carrying it! open your fingers to let go' : S.drawing ? 'drawing! open your fingers to pop it' : h ? 'pinch thumb and index to draw. pinch a sticker to move it' : 'show me your hand, palm to the camera');
  }
}
function pump() {
  if (S.mode === 'cam' && S.ready && !S.busy && vid.readyState >= 2) {
    if (vid.currentTime === S.lastT) return; S.lastT = vid.currentTime;
    S.busy = true; S.hands.send({ image: vid }).catch(() => {}).finally(() => { S.busy = false; });
  }
}

/* ---------- render ---------- */
function render(now) {
  ctx.clearRect(0, 0, W, H);
  for (const s of S.stickers) {
    const age = (now - s.t0) / 1000, held = (S.drag && S.drag.st === s) || (S.grab && S.grab.st === s);
    const k = RM ? 1 : 1 + .25 * Math.exp(-age * 7) * Math.cos(age * 18);
    const bob = (RM || held) ? 0 : Math.sin(now / 650 + s.ph) * 3, wob = (RM || held) ? 0 : Math.sin(now / 1000 + s.ph) * .035;
    drawSticker(ctx, s, s.x, s.y + bob, s.r + wob, s.s * k * (held ? 1.06 : 1));
  }
  drawChips(now);
  if (S.stroke.length) drawSticker(ctx, { p: S.stroke, col: COLORS[ci % COLORS.length], lw: 10 }, 0, 0, 0, 1);
  const h = S.mode === 'cam' ? S.hand : null;
  if (h) {
    ctx.lineCap = 'round'; ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,.75)';
    for (const [a, b] of BONES) { ctx.beginPath(); ctx.moveTo(h.pts[a].x, h.pts[a].y); ctx.lineTo(h.pts[b].x, h.pts[b].y); ctx.stroke(); }
    ctx.fillStyle = '#CDB9F5';
    h.pts.forEach((q, i) => { ctx.beginPath(); ctx.arc(q.x, q.y, i === 4 || i === 8 ? 5 : 3, 0, 6.283); ctx.fill(); });
    const on = h.pinch, col = COLORS[ci % COLORS.length];
    ctx.beginPath(); ctx.arc(h.pt.x, h.pt.y, 9 + Math.max(0, Math.min(1, (h.ratio - 0.2) / 0.5)) * 14, 0, 6.283); ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.stroke();
    ctx.lineWidth = 3; ctx.strokeStyle = '#8467D4'; ctx.stroke();
    if (on) { ctx.beginPath(); ctx.arc(h.pt.x, h.pt.y, 6, 0, 6.283); ctx.fillStyle = S.grab ? '#8467D4' : col; ctx.fill(); }
  }
}
function frame(now) {
  pump(); logic(now); render(now); requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

/* ---------- share card (doodles only, never the camera) ---------- */
async function makeCard() {
  try { await document.fonts.load('800 46px Nunito'); await document.fonts.load('400 28px "DM Sans"'); } catch (e) {}
  const cw = 1080, ch = 1350, c = document.createElement('canvas'); c.width = cw; c.height = ch; const g = c.getContext('2d');
  g.fillStyle = '#FBF8F3'; g.fillRect(0, 0, cw, ch);
  g.fillStyle = '#EAE2FB'; [[120, 160, 260], [980, 1180, 320], [1040, 120, 150]].forEach(([x, y, r]) => { g.beginPath(); g.arc(x, y, r, 0, 6.283); g.fill(); });
  g.fillStyle = 'rgba(132,103,212,.22)'; for (let x = 40; x < cw; x += 44) for (let y = 40; y < ch; y += 44) { g.beginPath(); g.arc(x, y, 2.2, 0, 6.283); g.fill(); }
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const s of S.stickers) { const hw = s.w / 2 * s.s, hh = s.h / 2 * s.s; x0 = Math.min(x0, s.x - hw); x1 = Math.max(x1, s.x + hw); y0 = Math.min(y0, s.y - hh); y1 = Math.max(y1, s.y + hh); }
  const bw = Math.max(x1 - x0, 60), bh = Math.max(y1 - y0, 60), k = Math.min((cw - 260) / bw, (ch - 480) / bh, 2.4), mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
  for (const s of S.stickers) drawSticker(g, s, cw / 2 + (s.x - mx) * k, (ch - 170) / 2 + (s.y - my) * k, s.r, s.s * k);
  g.textAlign = 'center'; g.fillStyle = '#3A3052'; g.font = '800 50px Nunito, sans-serif'; g.fillText('air doodle', cw / 2, ch - 110);
  g.fillStyle = '#7C7394'; g.font = '400 28px "DM Sans", sans-serif'; g.fillText('drawn in thin air', cw / 2, ch - 64);
  return new Promise(r => c.toBlob(r, 'image/png'));
}
let cardBlob = null, cardUrl = null;
async function openShare() {
  if (!S.stickers.length) return;
  cardBlob = await makeCard(); if (!cardBlob) return;
  cardUrl = URL.createObjectURL(cardBlob); $('#prev').src = cardUrl;
  $('#mShare').hidden = !navigator.share; $('#modal').hidden = false;
}
function closeShare() { $('#modal').hidden = true; if (cardUrl) { URL.revokeObjectURL(cardUrl); cardUrl = null; } }
$('#mClose').onclick = closeShare;
$('#modal').addEventListener('pointerdown', e => { if (e.target.id === 'modal') closeShare(); });
$('#mShare').onclick = async () => {
  try {
    const f = new File([cardBlob], 'air-doodle.png', { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [f] })) await navigator.share({ files: [f], title: 'my air doodle' });
    else await navigator.share({ title: 'my air doodle', text: 'i drew this in thin air', url: location.href });
  } catch (e) {}
};
$('#mSave').onclick = () => {
  const a = document.createElement('a'); a.href = cardUrl; a.download = 'air-doodle.png';
  document.body.appendChild(a); a.click(); a.remove();
};

/* ---------- wiring ---------- */
$('#camBtn').onclick = startCam;
$('#touchBtn').onclick = () => { S.mode = 'touch'; enter(); };
$('#stopBtn').onclick = leave;
$('#undoBtn').onclick = () => { const u = S.stickers.pop(); if (u) S.log = S.log.filter(r => r.id !== u.id); refreshUI(); };
$('#clearBtn').onclick = () => { S.stickers = []; S.grab = null; refreshUI(); flash('fresh start', 1500); };
$('#shareBtn').onclick = openShare;
$('#exportBtn').onclick = exportStrokes;
$('#magicOpt').onchange = e => { S.magic = e.target.checked; };
$('#magicBtn').onclick = () => { S.magic = !S.magic; syncMagic(); if (S.magic) flash('magic on. only a doodle’s outline numbers are sent, never video', 4500); };
addEventListener('keydown', e => { if (e.key === 'Escape') closeShare(); });
refreshUI();
