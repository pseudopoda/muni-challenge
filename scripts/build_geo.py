#!/usr/bin/env python3
"""
Snap every itinerary leg in js/data.js to real Muni stops and route shapes
from SFMTA's GTFS feed, and write js/geo.js for the map.

Usage:
    python scripts/build_geo.py path/to/muni_gtfs-current.zip

Get the feed from https://www.sfmta.com/reports/gtfs-transit-data
(you must accept the SFMTA Transit Data License Agreement there).

For each leg, the approximate `from`/`to` points in data.js pick the direction
and stops: we look at every shape (variant) of the leg's route and choose the
stop pair closest to `from` and `to` with the board stop before the alight stop.
The drawn path is the route shape between those two stops.
"""
import csv
import io
import json
import math
import re
import sys
import zipfile
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_JS = ROOT / "js" / "data.js"
GEO_JS = ROOT / "js" / "geo.js"

# Lines whose route_short_name isn't simply the first word of the leg name.
SPECIAL_ROUTES = {
    "Powell–Hyde Cable Car": "PH",
    "Powell–Mason Cable Car": "PM",
    "California Cable Car": "CA",
    "L Owl": "LOWL",
    "N Owl": "NOWL",
}
WARN_METERS = 250  # report legs whose stops are far from the hand-placed points


def leg_id(line):
    return re.sub(r"[^a-z0-9]+", "-", line.lower())


def read_legs():
    """Pull line name and from/to coordinates out of data.js (one leg per line)."""
    legs = []
    pat = re.compile(
        r'line: "([^"]+)".*?from: \[([-\d.]+), ([-\d.]+)\], to: \[([-\d.]+), ([-\d.]+)\]'
    )
    for row in DATA_JS.read_text(encoding="utf-8").splitlines():
        m = pat.search(row)
        if m:
            line = m.group(1)
            legs.append({
                "line": line,
                "from": (float(m.group(2)), float(m.group(3))),
                "to": (float(m.group(4)), float(m.group(5))),
            })
    return legs


def dist(a, b):
    """Approximate meters between two (lat, lon) points."""
    lat = math.radians((a[0] + b[0]) / 2)
    dx = (b[1] - a[1]) * 111320 * math.cos(lat)
    dy = (b[0] - a[0]) * 110540
    return math.hypot(dx, dy)


def rows(z, name):
    with z.open(name) as f:
        yield from csv.DictReader(io.TextIOWrapper(f, "utf-8-sig"))


def main(gtfs_path):
    legs = read_legs()
    z = zipfile.ZipFile(gtfs_path)

    routes = {r["route_short_name"]: r["route_id"] for r in rows(z, "routes.txt")}
    route_for_leg = {}
    for leg in legs:
        short = SPECIAL_ROUTES.get(leg["line"], leg["line"].split()[0])
        if short in routes:
            route_for_leg[leg["line"]] = routes[short]
        else:
            print(f"  ! {leg['line']}: route '{short}' not in this feed — leaving approximate")
    wanted_routes = set(route_for_leg.values())

    # One representative trip per (route, shape).
    trip_for_shape = {}
    shapes_for_route = defaultdict(set)
    for t in rows(z, "trips.txt"):
        if t["route_id"] in wanted_routes:
            key = (t["route_id"], t["shape_id"])
            if key not in trip_for_shape:
                trip_for_shape[key] = t["trip_id"]
                shapes_for_route[t["route_id"]].add(t["shape_id"])
    wanted_trips = {tid: key for key, tid in trip_for_shape.items()}

    stop_seq = defaultdict(list)  # (route, shape) -> [(seq, stop_id, dist_traveled)]
    for st in rows(z, "stop_times.txt"):
        key = wanted_trips.get(st["trip_id"])
        if key:
            stop_seq[key].append((int(st["stop_sequence"]), st["stop_id"], float(st["shape_dist_traveled"] or 0)))
    for v in stop_seq.values():
        v.sort()

    stops = {
        s["stop_id"]: {
            "name": s["stop_name"],
            "code": s["stop_code"],
            "ll": (float(s["stop_lat"]), float(s["stop_lon"])),
        }
        for s in rows(z, "stops.txt")
    }

    wanted_shapes = {shape for _, shape in trip_for_shape}
    shape_pts = defaultdict(list)
    for p in rows(z, "shapes.txt"):
        if p["shape_id"] in wanted_shapes:
            shape_pts[p["shape_id"]].append((
                int(p["shape_pt_sequence"]),
                float(p["shape_dist_traveled"] or 0),
                float(p["shape_pt_lat"]),
                float(p["shape_pt_lon"]),
            ))
    for v in shape_pts.values():
        v.sort()

    geo = {}
    for leg in legs:
        route = route_for_leg.get(leg["line"])
        if not route:
            continue
        best = None
        for shape in shapes_for_route[route]:
            seq = stop_seq[(route, shape)]
            d_from = [dist(leg["from"], stops[s]["ll"]) for _, s, _ in seq]
            d_to = [dist(leg["to"], stops[s]["ll"]) for _, s, _ in seq]
            # Best i < j minimizing d_from[i] + d_to[j]: track best i seen so far.
            best_i = None
            for j in range(len(seq)):
                if best_i is not None:
                    score = d_from[best_i] + d_to[j]
                    if best is None or score < best[0]:
                        best = (score, shape, seq[best_i], seq[j], d_from[best_i], d_to[j])
                if best_i is None or d_from[j] < d_from[best_i]:
                    best_i = j
        if not best:
            print(f"  ! {leg['line']}: no stop pair found")
            continue

        _, shape, (_, s_from, dist_a), (_, s_to, dist_b), err_a, err_b = best
        path = [(lat, lon) for _, d, lat, lon in shape_pts[shape] if dist_a <= d <= dist_b]
        a, b = stops[s_from], stops[s_to]
        path = [a["ll"]] + path + [b["ll"]]

        flag = "  ← check" if max(err_a, err_b) > WARN_METERS else ""
        print(f"  {leg['line']:<34} {a['name']}  →  {b['name']}   (off by {err_a:.0f} m / {err_b:.0f} m){flag}")

        geo[leg_id(leg["line"])] = {
            "route": route,
            "board": {"name": a["name"], "code": a["code"], "ll": [round(x, 6) for x in a["ll"]]},
            "alight": {"name": b["name"], "code": b["code"], "ll": [round(x, 6) for x in b["ll"]]},
            "path": [[round(lat, 5), round(lon, 5)] for lat, lon in path],
            # How far the real stops are from the plan's hand-placed points, in meters.
            "off": [round(err_a), round(err_b)],
        }

    feed_info = "SFMTA GTFS (" + Path(gtfs_path).name + ")"
    GEO_JS.write_text(
        "// Generated by scripts/build_geo.py from " + feed_info + " — do not edit by hand.\n"
        "// Data provided by SFMTA under the SFMTA Transit Data License Agreement.\n"
        "window.MUNI_GEO = " + json.dumps(geo, separators=(",", ":"), ensure_ascii=False) + ";\n",
        encoding="utf-8",
        newline="\n",
    )
    print(f"\nWrote {GEO_JS.relative_to(ROOT)}: {len(geo)} of {len(legs)} legs snapped.")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
