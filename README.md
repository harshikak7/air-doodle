# air doodle

Draw in thin air by pinching your thumb and index finger at your webcam. Let go and the doodle pops into a sticker you can pick up and move. Turn on **magic shapes** and a small Python model names what you drew (circle, triangle, square, star, heart, line, squiggle) and tidies it up. Share a picture of your stickers.

## How it is organised

The frontend and backend are deployed **separately**, so a static host never has to run Python.

| Folder | What | Where it runs |
|---|---|---|
| `frontend/` | The app: hand tracking (MediaPipe Hands, in the browser), gestures, stickers, share card, on-device copy of the shape model | Vercel (static site) |
| `backend/` | Python shape API (`server.py`, standard library only) and the model | Render (or any host that runs Python or Docker) |
| `ml/` | Training data generator, training script, evaluation report | Your laptop |
| `tests/` | Unit tests (features, API, CORS, rate limit, Python-vs-JS parity) | Your laptop / GitHub Actions |

If the backend is asleep, down, or not set up, magic shapes quietly runs the same model inside the browser. The app always works.

## Privacy

- Camera access is requested only after you press "turn on camera". Saying no still lets you play with touch.
- Hand tracking happens in your browser. Video is never recorded, uploaded or stored.
- Magic shapes is **off by default**. When on, the browser sends only the outline coordinates of a finished doodle (a few dozen number pairs, relative to the doodle's own corner) to the shape API. The server does not log or store request bodies. As with any host, normal request metadata (like IP address) is visible to the host. If the API isn't reachable, the model runs on your device and nothing is sent.
- The model, wasm, scripts and fonts are all in the repo. The Content-Security-Policy in `frontend/vercel.json` only allows requests to the site itself and `*.onrender.com`.
- The share card contains only the stickers, never the camera image.

## Run locally

You need Python 3.9+ (`python3 --version`, or `py --version` on Windows). Nothing to install.

**One command** (frontend and API on the same address):

    python3 dev_server.py          # Mac / Linux
    py dev_server.py               # Windows

Open **http://localhost:8000**, press "turn on camera" and allow it. Don't open `index.html` by double-clicking; browsers block the camera and model files on `file://`.

**Two processes** (closer to production): run `python3 backend/server.py` (port 8001), serve `frontend/` with `python3 -m http.server 8000 --directory frontend`, and set `window.AIR_DOODLE_API = "http://localhost:8001"` in `frontend/config.js`.

Tests: `python3 -m unittest discover -s tests -v`

## Deploy

### 1. Frontend on Vercel (static, no Python)

1. Push this repo to GitHub:

       git add -A
       git commit -m "split frontend and backend"
       git push

2. On vercel.com: **Add New → Project → import the repo**. (If the project already exists, open **Settings → General**.)
3. Set **Root Directory** to `frontend`. Framework preset: **Other**. Leave Build Command and Output Directory empty. Deploy (for an existing project: Deployments → ⋯ → Redeploy).
4. Open your Vercel address. You should see the air doodle intro screen. Magic shapes already works (on-device).

### 2. Backend on Render (Python)

Option A, one click: Render dashboard → **New + → Blueprint** → pick this repo. It reads `render.yaml`. When asked for `ALLOWED_ORIGINS`, paste your Vercel address (e.g. `https://air-doodlee.vercel.app`, no trailing slash).

Option B, manual: **New + → Web Service** → pick the repo, then:

| Setting | Value |
|---|---|
| Root Directory | `backend` |
| Runtime | Python 3 |
| Build Command | `pip install -r requirements.txt` |
| Start Command | `python server.py` |
| Instance type | Free |
| Environment variable | `ALLOWED_ORIGINS` = your Vercel address |

When it is live, open `https://YOUR-API.onrender.com/health`. You should see `{"status": "ok"}`.

### 3. Connect them

Edit `frontend/config.js`:

    window.AIR_DOODLE_API = "https://YOUR-API.onrender.com";

Commit and push; Vercel redeploys. Open the site, turn on magic shapes, draw a heart.

### Good to know

- **Free Render services sleep** after about 15 minutes idle and take up to a minute to wake. The app sends a harmless wake-up ping when you switch magic shapes on, and uses the on-device model for any doodle that can't wait, so nothing blocks.
- **Different host?** Railway, Fly.io, Google Cloud Run or a Hugging Face Docker Space can run `backend/` with the included `Dockerfile`. If the address doesn't end in `onrender.com`, add it to `connect-src` in `frontend/vercel.json`.
- **CORS blocked?** `ALLOWED_ORIGINS` must match your Vercel address exactly (scheme included, no trailing slash). Several origins can be comma-separated.
- **Rate limit:** 60 requests per minute per IP by default (`RATE_LIMIT_PER_MIN` to change).

## The model

Strokes are resampled to 64 points and described by 87 features that do not depend on where the stroke starts, which way it goes, or how big it is: an 8x8 occupancy grid, a tangent-direction histogram, turning and corner counts, closure, aspect ratio, area and radial spread. A small MLP (64-32) classifies them. The same feature code runs in Python (`backend/ml_core.py`) and JavaScript (`frontend/js/shapes-model.js`), and a test checks they agree to 1e-9.

Latest numbers are in [`ml/report.md`](ml/report.md) and `ml/confusion_matrix.png`. Training data is **synthetic**: a generator draws each shape with hand wobble, random start point and direction, overshoot or gaps, uneven sampling, rotation and hooks at the end. A logistic-regression baseline is trained alongside for comparison.

Retrain: `pip install -r ml/requirements.txt && python ml/train.py`. This rewrites `backend/model.json` and `frontend/model/model.json`; commit both and redeploy.

### Improve it with real strokes

1. Turn magic shapes on and draw. Tap a label chip to cycle it to the right class (that marks the stroke as verified).
2. Press **export strokes** to download `strokes.json` (it stays on your device).
3. Run `python ml/train.py --extra strokes.json` to fold your verified strokes into training, then redeploy.

## Tips for the best hand tracking

- Face a light, hand 40-80 cm away, palm toward the camera, plain background.
- The ring on your fingers shrinks as you pinch. Tune `PINCH_ON` / `PINCH_OFF` / `PINCH_FIRM` in `frontend/js/app.js` if it feels too eager or too stiff.

## Credits

Hand tracking by Google MediaPipe (`@mediapipe/hands`, Apache-2.0). Fonts: Nunito and DM Sans (SIL OFL) via Fontsource.
# air-doodle-2.1
