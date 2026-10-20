# ✌️ Air Doodle

A zero-dependency, privacy-first web app to draw mid-air using webcam fingertip tracking.

Pinch thumb and index finger to draw. Release to convert your doodle into a moveable sticker. Pinch any sticker again to move it around.

## ✨ Highlights

* **21-Landmark Hand Tracking:** Powered by a self-hosted MediaPipe Hands model.
* **100% Offline / Self-Contained:** All ML models, scripts, and fonts (`Nunito` & `DM Sans`) are bundled locally—no external network calls or CDNs.
* **Privacy First:** Frames process locally on your device. Shared cards render stickers only, never your camera feed.
* **Fallbacks:** Full mouse and touch support if camera access is declined.

## 🚀 Quick Start

Serve over HTTP (required for webcam permissions):

### VS Code Live Server
1. Open project folder in VS Code.
2. Install the **Live Server** extension.
3. Right-click `index.html` → **Open with Live Server**.

### Python Server
Run in the root directory:
```bash
python3 -m http.server 8000
```
Open `http://localhost:8000`.

## 🌐 Deploy to GitHub Pages

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/air-doodle.git
git push -u origin main
```
Go to **Settings → Pages** → Choose **Deploy from a branch** → Branch: `main`, Folder: `/ (root)` → **Save**.

## ⚙️ Calibration

Adjust pinch sensitivity in `js/app.js`:
```javascript
const PINCH_ON = 0.04;  // Distance threshold to start pinch
const PINCH_OFF = 0.07; // Distance threshold to release pinch
```