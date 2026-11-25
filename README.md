# 🚋 Muni Challenge

Ride every San Francisco Muni line in one day, ending at Bus Stop on Union Street.

A small, no-build web app (MapLibre GL is loaded from a CDN for the map) with the full itinerary and a progress tracker:

- **A real, timed plan**: every line's board and alight stop is a real SFMTA stop (with a live-arrivals link), with scheduled weekday departure times, and every walk between lines is under ~5 blocks.
- **Interactive map** (MapLibre GL + OpenFreeMap vector tiles, light and dark): every leg numbered and colored by section of the day, with the *whole* of each line drawn faintly underneath so you can see where it goes. Walking transfers are dashed, ridden lines grayed out, the next line highlighted. Tap a section in the legend to show just that part of the day, tap any line for its times, stops and a mark-ridden button, or tap 📍 on a leg to jump to it. Side-by-side on desktop, List/Map tabs on phones.
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

## How the plan is made

The itinerary is generated from SFMTA's GTFS schedule data, not written by hand.

- [`js/data.js`](js/data.js) lists **which** lines to ride, plus notes, risk flags and options.
- [`scripts/plan.py`](scripts/plan.py) reads the GTFS feed and, for every line, considers every real
  stop pair where the ride is at least ~0.25 mi (3–4 blocks). It picks stops that keep every walk between lines
  under ~5 blocks (450 m straight-line), searches for the line order that gets you to the finish
  soonest using the real weekday timetable, and writes [`js/plan.js`](js/plan.js) (order, stops,
  scheduled times and map paths).

To re-plan (e.g. after SFMTA changes service), download the feed from
https://www.sfmta.com/reports/gtfs-transit-data (requires accepting SFMTA's license) and run:

```sh
pip install numpy
python scripts/plan.py path/to/muni_gtfs-current.zip --iters 25000 --restarts 4
python scripts/build_network.py path/to/muni_gtfs-current.zip   # whole-line shapes for the map
```

It prints the full day and any walks over the limit. Progress in the app is keyed by line name, so
re-planning keeps people's check-offs. After changing files, bump `CACHE` in [`sw.js`](sw.js) so
installed copies pick up the update.

## Rules

- Ride at least 3 blocks on every line.
- No transfer walk over 5 blocks.
- Express/rapid variants count as their base line (1X, 5R, 8AX/8BX, 9R, 14R, 28R, 30X, 38R).

## Data

Stop and route data from SFMTA's GTFS feed, used under the [SFMTA Transit Data License Agreement](SFMTA_Transit_Data_License_Agreement.txt).
The SFMTA provides the Data "as is" and makes no warranties as to its accuracy; SFMTA is not liable for damages arising from use of the Data or this app.

## Caveats

This is a geography-and-frequency plan, not a live timetable, and cross-streets are approximations. Check real-time predictions on [sfmta.com](https://www.sfmta.com/routes) or 511.org on the day. Not affiliated with SFMTA.
