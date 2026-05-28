# ChordSheet ♪

Build and organize song charts with sections, bars, and chord assignments.

## Features

- Set song title, artist, key, BPM, and time signature
- Add sections (Intro, Verse, Chorus, Bridge, and 12 more)
- Adjust bar count per section
- Click any beat cell to assign a chord (root + quality + optional bass note)
- Duplicate sections
- Auto-saves to browser localStorage
- Print / export to PDF via the browser print dialog

## Running locally

```bash
npm install
npm run dev
```

Then open http://localhost:5173

## Deploying to Vercel

1. Push this repo to GitHub
2. Go to [vercel.com](https://vercel.com) → **Add New Project**
3. Import your GitHub repo
4. Leave all settings as default — Vercel auto-detects Vite
5. Click **Deploy**

That's it. Vercel handles the build (`npm run build`) and serves the `dist/` folder.

## Project structure

```
chordsheet/
├── index.html          # HTML entry point
├── vite.config.js      # Vite config
├── package.json
└── src/
    ├── main.jsx        # React root mount
    ├── App.jsx         # Full application
    └── index.css       # Global styles + CSS variables
```
