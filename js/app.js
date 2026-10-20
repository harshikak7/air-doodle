/* air doodle
   Hand tracking: MediaPipe Hands (self-hosted in /vendor, runs in this tab).
   Pinch thumb + index = draw. Pinch on a sticker = carry it. Nothing leaves the device. */
const $ = s => document.querySelector(s);
const cv = $('#cv'), ctx = cv.getContext('2d'), vid = $('#vid'), hint = $('#hint'), stage = $('#stage');
const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
const COLORS = ['#B79CF0', '#F5A9C4', '#8FD6C0', '#F7CE7A', '#9DB8F5'];
const BONES = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];
const PINCH_ON = 0.32, PINCH_OFF = 0.5;   // thumb-index distance / palm size (hysteresis keeps it steady)

let W = 0, H = 0, ci = 0;
const S = {
  mode: null, stream: null, hands: null, ready: false, busy: false,
  hand: null, seen: 0, pinchRaw: false, pinching: false, drawing: false,
  stroke: [], stickers: [], grab: null, drag: null, touchDraw: false, lastTap: null, flashUntil: 0
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
  if (!L) { S.hand = null; return; }
  const g = geo(), P = i => ({ x: L[i].x * g.vw, y: L[i].y * g.vh }), d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const ratio = d(P(4), P(8)) / (d(P(0), P(9)) || 1);
  S.pinchRaw = S.pinchRaw ? ratio < PINCH_OFF : ratio < PINCH_ON;
  const mid = lm2s((L[4].x + L[8].x) / 2, (L[4].y + L[8].y) / 2), prev = S.hand && S.hand.pt;
  const pt = prev ? { x: prev.x + (mid.x - prev.x) * 0.6, y: prev.y + (mid.y - prev.y) * 0.6 } : mid;
  S.hand = { pts: L.map(l => lm2s(l.x, l.y)), pt, pinch: S.pinchRaw };
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
      S.hands.setOptions({ maxNumHands: 1, modelComplexity: mobile ? 0 : 1, minDetectionConfidence: 0.6, minTrackingConfidence: 0.5, selfieMode: false });
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
  stage.classList.remove('cam'); $('#intro').hidden = false; $('#dock').hidden = true; $('#stopBtn').hidden = true; say('');
}
addEventListener('pagehide', stopCam);

function enter() {
  const cam = S.mode === 'cam';
  $('#intro').hidden = true; $('#dock').hidden = false; $('#stopBtn').hidden = false;
  stage.classList.toggle('cam', cam); $('#stopBtn').textContent = cam ? 'stop camera' : 'back';
  resize(); refreshUI();
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
  S.stickers.push({ p: p.map(v => ({ x: v.x - cx, y: v.y - cy })), w: x1 - x0, h: y1 - y0, x: cx, y: cy, s: 1, r: 0, lw: 10, col: COLORS[ci++ % COLORS.length], t0: performance.now(), ph: Math.random() * 6.28 });
  flash(S.mode === 'cam' ? 'popped! pinch it to carry it around' : 'popped! drag it around. double-tap to resize');
  refreshUI();
}
function refreshUI() { const e = !S.stickers.length; $('#undoBtn').disabled = e; $('#shareBtn').disabled = e; $('#clearBtn').disabled = e; }
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

/* ---------- mouse / touch ---------- */
const pt = e => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
cv.addEventListener('pointerdown', e => {
  if (!S.mode) return; const p = pt(e), h = hit(p); cv.setPointerCapture(e.pointerId);
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
  if (S.drawing) { S.drawing = false; pop(); }
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
    else if (S.drawing) { const l = S.stroke[S.stroke.length - 1]; if (Math.hypot(p.x - l.x, p.y - l.y) > 2.5) S.stroke.push({ x: p.x, y: p.y }); }
  } else if (S.pinching && (h || now - S.seen > 400)) endPinch();
  if (now > S.flashUntil) {
    say(S.grab ? 'carrying it! open your fingers to let go' : S.drawing ? 'drawing! open your fingers to pop it' : h ? 'pinch thumb and index to draw. pinch a sticker to move it' : 'show me your hand');
  }
}
function pump() {
  if (S.mode === 'cam' && S.ready && !S.busy && vid.readyState >= 2) {
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
  if (S.stroke.length) drawSticker(ctx, { p: S.stroke, col: COLORS[ci % COLORS.length], lw: 10 }, 0, 0, 0, 1);
  const h = S.mode === 'cam' ? S.hand : null;
  if (h) {
    ctx.lineCap = 'round'; ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,.75)';
    for (const [a, b] of BONES) { ctx.beginPath(); ctx.moveTo(h.pts[a].x, h.pts[a].y); ctx.lineTo(h.pts[b].x, h.pts[b].y); ctx.stroke(); }
    ctx.fillStyle = '#CDB9F5';
    h.pts.forEach((q, i) => { ctx.beginPath(); ctx.arc(q.x, q.y, i === 4 || i === 8 ? 5 : 3, 0, 6.283); ctx.fill(); });
    const on = h.pinch, col = COLORS[ci % COLORS.length];
    ctx.beginPath(); ctx.arc(h.pt.x, h.pt.y, on ? 12 : 18, 0, 6.283); ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.stroke();
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
$('#undoBtn').onclick = () => { S.stickers.pop(); refreshUI(); };
$('#clearBtn').onclick = () => { S.stickers = []; S.grab = null; refreshUI(); flash('fresh start', 1500); };
$('#shareBtn').onclick = openShare;
addEventListener('keydown', e => { if (e.key === 'Escape') closeShare(); });
refreshUI();
