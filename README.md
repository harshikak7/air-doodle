# air doodle

Draw in thin air by pinching your thumb and index finger at your webcam. Let go and the doodle pops into a sticker you can pick up and move. Turn on **magic shapes** and a small Python model names what you drew (circle, triangle, square, star, heart, line, squiggle) and tidies it up. Share a picture of your stickers.

## What is in here

| Part | What it does |
|---|---|
| `js/app.js` + `vendor/mediapipe/` | Real hand tracking (MediaPipe Hands, 21 landmarks) running in the browser, pinch detection with hysteresis, One Euro smoothing |
| `api/classify.py` + `api/_ml.py` | Python serverless function: stroke features and a small MLP, standard library only |
| `js/shapes-model.js` + `model/model.json` | Same model in JavaScript, used automatically when the API isn't available |
| `ml/` | Data generator, training script, evaluation report, confusion matrix |
| `tests/` | Unit tests for features, validation and the HTTP handler |
| `vercel.json` | Deploy config plus a strict Content-Security-Policy |

## Privacy

- Camera access is requested only after you press "turn on camera". Saying no still lets you play with touch.
- Hand tracking happens in your browser. Video is never recorded, uploaded or stored.
- Magic shapes is **off by default**. When on, the browser sends only the outline coordinates of a finished doodle (a few dozen number pairs, relative to the doodle's own corner) to `/api/classify` on the same site. The function does not log or store request bodies. As with any host, Vercel keeps normal request metadata. If the API isn't available, the same model runs in your browser and nothing is sent.
- No third-party requests: the model, wasm, scripts and fonts are all in the repo. `vercel.json` enforces it with `connect-src 'self'` and no external script sources.
- The share card contains only the stickers, never the camera image.

## Run locally

You need Python 3.9+ (check with `python3 --version`, or `py --version` on Windows). No pip installs needed to run the app.

1. Unzip, open a terminal **inside the `air-doodle` folder**.
2. Start the server:

       python3 dev_server.py          # Mac / Linux
       py dev_server.py               # Windows (or: python dev_server.py)

3. Open **http://localhost:8000** in Chrome, Edge or Safari. Press "turn on camera" and allow it.
4. Optional: `python3 -m unittest discover -s tests -v` runs the tests.

Do not double-click `index.html`. Browsers block the camera and the model files on `file://`, so it must be served (step 2). Use a different port with `PORT=9000 python3 dev_server.py` (Windows PowerShell: `$env:PORT=9000; py dev_server.py`).

## Deploy

**Vercel**

Vercel runs Python through serverless functions: any `api/*.py` file that defines a `handler` class becomes an endpoint, which is exactly what `api/classify.py` does. No build step, no `requirements.txt` needed.

1. Push this folder to GitHub:

       git init
       git add .
       git commit -m "air doodle"
       git branch -M main
       git remote add origin https://github.com/YOUR-USERNAME/air-doodle.git
       git push -u origin main

2. Go to vercel.com, sign in with GitHub, **Add New → Project**, pick the repo.
3. Framework preset **Other**. Leave Build Command, Output Directory and Install Command empty. Click **Deploy**.
4. When it finishes, open `https://YOUR-APP.vercel.app/api/classify`. Seeing `{"status": "ok", ...}` means the Python function is live. Then open the site, switch on magic shapes and draw a heart.

CLI instead: `npm i -g vercel`, then `vercel` in the folder (and `vercel --prod` to publish).

**If the Python function does not work on your Vercel account, the app still works.** If `/api/classify` is missing or fails, magic shapes automatically runs the same model inside the browser (`js/shapes-model.js` + `model/model.json`), so nothing breaks and nothing is sent anywhere. A test (`tests/test_parity.py`) checks that the browser and Python versions give identical results. You can then ignore the `api/` folder, or fix the function later from the Vercel logs (Project → Deployments → Functions).

Common fixes if the function errors:
- 404 on `/api/classify`: confirm the repo root contains `api/classify.py` (not inside another folder) and redeploy.
- 500 mentioning `_model.json`: confirm `api/_model.json` is committed. `vercel.json` already lists it under `includeFiles`.
- Anything else: open Project → Logs and read the Python traceback.

**Netlify / GitHub Pages / any static host:** works too. They have no Python, so magic shapes runs on-device. Drag the folder onto Netlify Drop, or on GitHub use Settings → Pages → Deploy from branch → main / root.

## The model

Strokes are resampled to 64 points and described by 87 features that do not depend on where the stroke starts, which way it goes, or how big it is: an 8x8 occupancy grid, a tangent-direction histogram, turning and corner counts, closure, aspect ratio, area and radial spread. A small MLP (64-32) classifies them.

Latest numbers are in [`ml/report.md`](ml/report.md) and `ml/confusion_matrix.png`. Training data is **synthetic**: a generator draws each shape with hand wobble, random start point and direction, overshoot or gaps, uneven sampling, rotation and hooks at the end. A logistic-regression baseline is trained alongside for comparison.

Retrain: `pip install -r ml/requirements.txt && python ml/train.py`. This rewrites `api/_model.json` and `model/model.json`; commit both and redeploy.

### Improve it with real strokes

1. Turn magic shapes on and draw. Tap a label chip to cycle it to the right class (that marks the stroke as verified).
2. Press **export strokes** to download `strokes.json` (it stays on your device).
3. Run `python ml/train.py --extra strokes.json` to fold your verified strokes into training, then redeploy.

## Tips for the best hand tracking

- Face a light, hand 40-80 cm away, palm toward the camera, plain background.
- The ring on your fingers shrinks as you pinch. Tune `PINCH_ON` / `PINCH_OFF` / `PINCH_FIRM` in `js/app.js` if it feels too eager or too stiff.

## Credits

Hand tracking by Google MediaPipe (`@mediapipe/hands`, Apache-2.0). Fonts: Nunito and DM Sans (SIL OFL) via Fontsource.
