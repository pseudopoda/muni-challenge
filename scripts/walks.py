#!/usr/bin/env python3
"""
Add street walking routes to js/plan.js (run after scripts/plan.py).

Usage:
    python scripts/walks.py

For every transfer (one line's alight stop to the next line's boarding stop) and the
final walk to the finish, it asks the public OSRM foot-routing service run by FOSSGIS
(https://routing.openstreetmap.de, OpenStreetMap data) for the walking route, and stores:
    walk_path      [[lat, lon], ...] street route from the previous stop
    walk_street_m  street distance in metres
    walk_min       walking time in minutes
It also remembers each street distance in scripts/walk_cache.json; plan.py uses those
instead of straight lines, so re-running plan.py → walks.py steers the plan away from
transfers that look short but are long on foot (freeways, hills).
Only public stop coordinates are sent. Requests are spaced out to be polite.
"""
import json
import math
import re
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PLAN_JS = ROOT / "js" / "plan.js"
DATA_JS = ROOT / "js" / "data.js"
CACHE = ROOT / "scripts" / "walk_cache.json"  # street metres between stop pairs, read by plan.py
ROUTER = "https://routing.openstreetmap.de/routed-foot/route/v1/foot/{a};{b}?overview=full&geometries=geojson"
WALK_M_PER_MIN = 75


def meters(a, b):
    lat = math.radians((a[0] + b[0]) / 2)
    return math.hypot((b[1] - a[1]) * 111320 * math.cos(lat), (b[0] - a[0]) * 110540)


def key(a, b):
    return f"{a[0]:.6f},{a[1]:.6f}|{b[0]:.6f},{b[1]:.6f}"


def route(a, b):
    """Street walking route between two [lat, lon] points, or None."""
    if meters(a, b) < 25:
        return None
    url = ROUTER.format(a=f"{a[1]},{a[0]}", b=f"{b[1]},{b[0]}")
    req = urllib.request.Request(url, headers={"User-Agent": "muni-challenge-planner"})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                j = json.load(r)
            if j.get("code") == "Ok" and j["routes"]:
                rt = j["routes"][0]
                path = [[round(lat, 5), round(lon, 5)] for lon, lat in rt["geometry"]["coordinates"]]
                return {"walk_path": path, "walk_street_m": round(rt["distance"]), "walk_min": max(1, round(rt["distance"] / WALK_M_PER_MIN))}
            return None
        except Exception as e:  # network hiccup: wait and retry
            print(f"    retry ({e})")
            time.sleep(3 * (attempt + 1))
    return None


def main():
    text = PLAN_JS.read_text(encoding="utf-8")
    head, body = text.split("window.MUNI_PLAN = ", 1)
    plan = json.loads(body.rstrip().rstrip(";"))
    cache = json.loads(CACHE.read_text(encoding="utf-8")) if CACHE.exists() else {}
    finish = json.loads(re.search(r"finish: \{[^}]*at: (\[[^\]]+\])", DATA_JS.read_text(encoding="utf-8")).group(1))

    for segment in (["owl"], [b["id"] for b in plan["blocks"] if b["id"] != "owl"]):
        # The overnight Owl block and the day are separate outings, so no walk between them.
        legs = [l for b in plan["blocks"] if b["id"] in segment for l in b["legs"]]
        for prev, leg in zip(legs, legs[1:]):
            for k in ("walk_path", "walk_street_m", "walk_min"):
                leg.pop(k, None)
            r = route(prev["alight"]["ll"], leg["board"]["ll"])
            if r:
                leg.update(r)
                cache[key(prev["alight"]["ll"], leg["board"]["ll"])] = r["walk_street_m"]
                print(f"  {leg['line']:<34} {leg['walk_m']:>4} m straight → {r['walk_street_m']:>4} m on foot")
            time.sleep(1)
        if segment != ["owl"] and legs:
            r = route(legs[-1]["alight"]["ll"], finish)
            plan["finishWalk"] = r
            if r:
                cache[key(legs[-1]["alight"]["ll"], finish)] = r["walk_street_m"]
            if r:
                print(f"  {'→ finish':<34} {r['walk_street_m']:>4} m on foot")

    CACHE.write_text(json.dumps(dict(sorted(cache.items())), indent=0), encoding="utf-8")
    PLAN_JS.write_text(head + "window.MUNI_PLAN = " + json.dumps(plan, separators=(",", ":"), ensure_ascii=False) + ";\n", encoding="utf-8", newline="\n")
    print(f"Wrote {PLAN_JS.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
