# air doodle

Draw in thin air by pinching your thumb and index finger at your webcam. Let go and the doodle pops into a sticker you can pick up and move. Turn on **magic shapes** and a small Python model names what you drew (circle, triangle, square, star, heart, line, squiggle) and tidies it up. Share a picture of your stickers.

## What is in here

| Part | What it does |
|---|---|
| `js/app.js` + `vendor/mediapipe/` | Real hand tracking (MediaPipe Hands, 21 landmarks) running in the browser, pinch detection with hysteresis, One Euro smoothing |
| `api/classify.py` + `api/_ml.py` | Python serverless function: stroke features and a small MLP, standard library only |
| `ml/` | Data generator, training script, evaluation report, confusion matrix |
| `tests/` | Unit tests for features, validation and the HTTP handler |
| `vercel.json` | Deploy config plus a strict Content-Security-Policy |

## Privacy

- Camera access is requested only after you press "turn on camera". Saying no still lets you play with touch.
- Hand tracking happens in your browser. Video is never recorded, uploaded or stored.
- Magic shapes is **off by default**. When on, the browser sends only the outline coordinates of a finished doodle (a few dozen number pairs, relative to the doodle's own corner) to `/api/classify` on the same site. The function does not log or store request bodies. As with any host, Vercel keeps normal request metadata.
- No third-party requests: the model, wasm, scripts and fonts are all in the repo. `vercel.json` enforces it with `connect-src 'self'` and no external script sources.
- The share card contains only the stickers, never the camera image.

## Run locally

    python3 dev_server.py        # http://localhost:8000 (static files + /api/classify, same security headers as Vercel)
    python3 -m unittest discover -s tests -v

Needs only Python 3.9+. The camera works on `localhost` and on HTTPS.

## Deploy

**Vercel (recommended, runs the Python API):**
1. Push this folder to a GitHub repo:

       git init
       git add .
       git commit -m "air doodle"
       git branch -M main
       git remote add origin https://github.com/YOUR-USERNAME/air-doodle.git
       git push -u origin main

2. On vercel.com: **Add New → Project → import the repo**. Framework preset **Other**, leave build command and output directory empty, then **Deploy**. Vercel picks up `api/classify.py` as a Python function automatically.
3. Check it: open `https://YOUR-APP.vercel.app/api/classify`. You should see `{"status": "ok", ...}`. Then open the site, switch on magic shapes and draw a heart.

Or from the terminal: `npm i -g vercel && vercel --prod`.

**GitHub Pages** also works for the camera and drawing, but it only hosts static files, so magic shapes cannot run there (the app notices and switches it off).

## The model

Strokes are resampled to 64 points and described by 87 features that do not depend on where the stroke starts, which way it goes, or how big it is: an 8x8 occupancy grid, a tangent-direction histogram, turning and corner counts, closure, aspect ratio, area and radial spread. A small MLP (64-32) classifies them.

Latest numbers are in [`ml/report.md`](ml/report.md) and `ml/confusion_matrix.png`. Training data is **synthetic**: a generator draws each shape with hand wobble, random start point and direction, overshoot or gaps, uneven sampling, rotation and hooks at the end. A logistic-regression baseline is trained alongside for comparison.

Retrain: `pip install -r ml/requirements.txt && python ml/train.py`. This rewrites `api/_model.json`; commit it and redeploy.

### Improve it with real strokes

1. Turn magic shapes on and draw. Tap a label chip to cycle it to the right class (that marks the stroke as verified).
2. Press **export strokes** to download `strokes.json` (it stays on your device).
3. Run `python ml/train.py --extra strokes.json` to fold your verified strokes into training, then redeploy.

## Tips for the best hand tracking

- Face a light, hand 40-80 cm away, palm toward the camera, plain background.
- The ring on your fingers shrinks as you pinch. Tune `PINCH_ON` / `PINCH_OFF` / `PINCH_FIRM` in `js/app.js` if it feels too eager or too stiff.

## Credits

Hand tracking by Google MediaPipe (`@mediapipe/hands`, Apache-2.0). Fonts: Nunito and DM Sans (SIL OFL) via Fontsource.
