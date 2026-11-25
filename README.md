# 🚋 Muni Challenge

Ride every San Francisco Muni line in one day, ending at Bus Stop on Union Street.

A small, dependency-free web app with the full itinerary and a progress tracker:

- **Interactive map** (Leaflet + OpenStreetMap): every leg numbered and colored by time block, walking transfers dashed, ridden lines grayed out, the next line highlighted. Tap a line to mark it ridden; tap 📍 on any leg to jump to it. Side-by-side on desktop, List/Map tabs on phones.
- **Check off lines as you ride.** Progress is saved in your browser (localStorage).
- **Options** for Owl lines (overnight), the 78X (Chase Center event days only) and the 714 BART Early Bird. The line count updates to match: 50 / 51 / 55 / 56.
- **"Next" highlight** jumps to the first line you haven't ridden.
- **Works offline** once loaded (service worker), and can be installed to your home screen.
- Low-frequency lines (58, 36, 37, 67, 56) are flagged so you build slack around them.

## Run locally

No build step. Serve the folder with any static server, for example:

```sh
python -m http.server 8000
```

Then open http://localhost:8000. (Opening `index.html` directly also works, just without offline support.)

## Deploy

Pushing to `main` deploys to GitHub Pages via `.github/workflows/pages.yml`.
One-time setup: **Settings → Pages → Build and deployment → Source: GitHub Actions**.

## Editing the route

All itinerary content lives in [`js/data.js`](js/data.js): time blocks (with map colors), legs (board / alight / next transfer, plus `from`/`to` coordinates for the map), risk flags and optional legs. Progress is keyed by line name, so reordering legs keeps people's check-offs.

After changing files, bump `CACHE` in [`sw.js`](sw.js) so installed copies pick up the update.

## Rules

- Ride at least 3 blocks on every line.
- No transfer walk over 5 blocks.
- Express/rapid variants count as their base line (1X, 5R, 8AX/8BX, 9R, 14R, 28R, 30X, 38R).

## Caveats

This is a geography-and-frequency plan, not a live timetable, and cross-streets are approximations. Check real-time predictions on [sfmta.com](https://www.sfmta.com/routes) or 511.org on the day. Not affiliated with SFMTA.
