# air doodle

Pinch your thumb and index finger at your webcam to draw in thin air. Let go and the drawing pops into a sticker. Pinch a sticker to carry it around, then share a picture of your doodles.

- **Real hand tracking:** MediaPipe Hands finds 21 landmarks on your hand every frame. Drawing starts when your thumb tip and index tip pinch together.
- **Private:** everything runs in the browser tab. No server, no uploads, no analytics. The model, fonts and scripts are all in this repo, so the page makes zero third-party requests.
- **Permission first:** the camera is only requested after you press "turn on camera". Say no and touch mode still works.
- **Share card:** contains only the stickers on a pastel card, never the camera image.

## Run it locally

Any static server works (the camera needs `localhost` or HTTPS):

    cd air-doodle
    python3 -m http.server 8000
    # open http://localhost:8000

## Put it on GitHub and make it live (GitHub Pages)

1. Create an empty repo on github.com (for example `air-doodle`), with no README.
2. In this folder run:

       git init
       git add .
       git commit -m "air doodle"
       git branch -M main
       git remote add origin https://github.com/YOUR-USERNAME/air-doodle.git
       git push -u origin main

3. On GitHub go to **Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: main, folder / (root) → Save.**
4. After about a minute your site is live at `https://YOUR-USERNAME.github.io/air-doodle/`. HTTPS is automatic, which the camera requires.

Prefer Netlify or Vercel? Import the repo (or drag the folder onto Netlify Drop). No build command; the publish directory is the repo root.

## Files

    index.html            page
    css/style.css         look (offwhite + lavender, Nunito + DM Sans)
    js/app.js             hand tracking, gestures, stickers, share card
    fonts/                self-hosted fonts
    vendor/mediapipe/     MediaPipe Hands (Apache-2.0): model + wasm, self-hosted

## Tweaks

- Pinch sensitivity: `PINCH_ON` / `PINCH_OFF` at the top of `js/app.js`.
- Colors: `COLORS` in `js/app.js` and the variables at the top of `css/style.css`.

## Credits

Hand tracking by Google MediaPipe (`@mediapipe/hands`, Apache-2.0). Fonts: Nunito and DM Sans (SIL OFL) via Fontsource.
