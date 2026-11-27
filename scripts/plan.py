#!/usr/bin/env python3
"""
Plan the Muni Challenge day from SFMTA's GTFS feed and write js/plan.js.

Usage:
    python scripts/plan.py path/to/muni_gtfs-current.zip [--iters 20000] [--seed 1]

What it does
  * Lines come from js/data.js (`lines` section): which Muni lines to ride, in a
    starting order. Owl lines are planned as a separate overnight block.
  * For every line it considers every real stop pair on every weekday pattern
    where the ride is at least ~3 blocks, and picks the stops that minimise walking
    between consecutive lines (dynamic programming over stop choices).
  * It searches over the order of lines (local search) to minimise the time you
    arrive at the finish, using the real weekday timetable for each ride — so waits
    for infrequent lines and service hours are accounted for.
  * Every transfer leaves at least BUFFER_S (RISK_BUFFER_S for the infrequent lines)
    between reaching the stop and the bus being due, so one late bus doesn't sink the day.
  * Each leg also lists the other departures around the planned one, so the app can
    show "missed it? next one at…".
  * Walks between lines over WALK_LIMIT_M (≈5 blocks, straight line) are penalised
    heavily and reported.

Get the feed from https://www.sfmta.com/reports/gtfs-transit-data
(you must accept the SFMTA Transit Data License Agreement there).
"""
import argparse
import bisect
import csv
import io
import json
import math
import random
import re
import sys
import zipfile
from collections import Counter, defaultdict
from itertools import permutations
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
DATA_JS = ROOT / "js" / "data.js"
PLAN_JS = ROOT / "js" / "plan.js"

WEEKDAY = "M11"            # weekday service_id in the current SFMTA feed
MILE = 1609.34
MIN_RIDE_MI = 0.25         # ≈ 3–4 blocks, so every ride clearly counts
MAX_RIDE_MI = 2.5          # don't pick absurdly long rides
WALK_LIMIT_M = 450         # straight-line ≈ 5 blocks on the street
WALK_SPEED = 75 / 1.25     # m/min of straight-line distance (75 m/min with 25% street detour)
DAY_START = 6 * 3600 + 45 * 60  # be at the first stop by 6:45 (cable cars start ~7)
OWL_START = 25 * 3600      # earliest Owl start, 1:00 AM (GTFS writes after-midnight trips as 25:00)
OWL_LATEST = 30 * 3600     # latest Owl start tried, 6:00 AM
NEXT_DAY = {"714"}         # morning-only routes written as 04:05 etc.; shifted +24 h onto the Owl clock
DAY_HOURS = (6 * 3600, 22 * 3600)
BUFFER_S = 3 * 60          # be at the stop at least this long before the bus is due…
RISK_BUFFER_S = 5 * 60     # …and longer for the infrequent lines, where a miss costs the most
ALT_BEFORE_S = 60 * 60     # every departure per leg, from 1 h before the planned one…
ALT_AFTER_S = 22 * 3600    # …to the end of service, so the app can re-time and re-plan on the day
ALT_MAX = 250
FINISH = (37.79796, -122.43098)  # Bus Stop bar, 1901 Union St (Union & Laguna)

ROUTE_OF = {
    "Powell–Hyde Cable Car": "PH",
    "Powell–Mason Cable Car": "PM",
    "California Cable Car": "CA",
    "L Owl": "LOWL",
    "N Owl": "NOWL",
}
MIN_RIDE_OVERRIDE = {"PH": 0.9, "PM": 0.7}   # ride past the shared Powell St trackage
ROUND_TRIP = {"25"}                           # ride out to Treasure Island and back
FIRST_LINES = ["PH", "PM", "CA"]              # cable cars first, before the queues

NEIGHBORHOODS = [
    ("Union Square", 37.7880, -122.4075), ("Fisherman's Wharf", 37.8080, -122.4177),
    ("North Beach", 37.8000, -122.4100), ("Chinatown", 37.7941, -122.4078),
    ("Nob Hill", 37.7930, -122.4161), ("Polk Gulch", 37.7890, -122.4205),
    ("Pacific Heights", 37.7925, -122.4350), ("Marina", 37.8015, -122.4370),
    ("Cow Hollow", 37.7975, -122.4330), ("Presidio Heights", 37.7880, -122.4520),
    ("Western Addition", 37.7810, -122.4320), ("Japantown", 37.7854, -122.4300),
    ("Haight", 37.7700, -122.4470), ("Inner Richmond", 37.7800, -122.4640),
    ("Outer Richmond", 37.7780, -122.4930), ("Inner Sunset", 37.7600, -122.4680),
    ("Outer Sunset", 37.7550, -122.4950), ("Parkside", 37.7400, -122.4900),
    ("Stonestown/Parkmerced", 37.7230, -122.4790), ("West Portal", 37.7400, -122.4650),
    ("Ingleside", 37.7230, -122.4520), ("Glen Park", 37.7340, -122.4340),
    ("Diamond Heights", 37.7430, -122.4410), ("Twin Peaks", 37.7520, -122.4470),
    ("Castro", 37.7610, -122.4350), ("Noe Valley", 37.7500, -122.4330),
    ("Mission", 37.7600, -122.4170), ("Bernal Heights", 37.7400, -122.4160),
    ("Excelsior", 37.7230, -122.4290), ("Outer Mission", 37.7150, -122.4450),
    ("Visitacion Valley", 37.7140, -122.4060), ("Portola", 37.7270, -122.4060),
    ("Bayview", 37.7300, -122.3900), ("Dogpatch", 37.7600, -122.3890),
    ("Potrero Hill", 37.7600, -122.4000), ("SoMa", 37.7780, -122.4050),
    ("Financial District", 37.7930, -122.3990), ("Civic Center", 37.7790, -122.4170),
    ("Treasure Island", 37.8200, -122.3700), ("Lower Haight", 37.7720, -122.4320),
]
BLOCK_COLORS = ["#7b3f00", "#2166ac", "#1a9850", "#8e44ad", "#d7301f", "#e6791a", "#d6249f", "#00838f", "#6d4c41"]
OWL_COLOR = "#5b3a8a"


# ---------------------------------------------------------------------------
# Helpers

def meters(a, b):
    lat = math.radians((a[0] + b[0]) / 2)
    return math.hypot((b[1] - a[1]) * 111320 * math.cos(lat), (b[0] - a[0]) * 110540)


# Street distances found by scripts/walks.py, as straight-line equivalents (street ≈ 1.25 × straight),
# so walks that look short but go around a freeway or hill are judged by their real length.
WALK_CACHE_FILE = ROOT / "scripts" / "walk_cache.json"
STREET_FACTOR = 1.25
_STREET = {}
if WALK_CACHE_FILE.exists():
    for k, v in json.loads(WALK_CACHE_FILE.read_text(encoding="utf-8")).items():
        a, b = k.split("|")
        _STREET[(a, b)] = v / STREET_FACTOR


def ll_key(p):
    return f"{p[0]:.6f},{p[1]:.6f}"


def walk_m(a, b):
    """Straight-line metres, or the street-equivalent when walks.py has measured this pair."""
    if a is None or b is None:
        return 0
    return max(meters(a, b), _STREET.get((ll_key(a), ll_key(b)), 0))


def secs(hms):
    h, m, s = (int(x) for x in hms.split(":"))
    return h * 3600 + m * 60 + s


def clock(t):
    t = int(round(t / 60)) * 60
    h, m = divmod(t // 60, 60)
    h %= 24
    return f"{(h % 12) or 12}:{m:02d} {'AM' if h < 12 else 'PM'}"


def rows(z, name):
    with z.open(name) as f:
        yield from csv.DictReader(io.TextIOWrapper(f, "utf-8-sig"))


def read_lines():
    """[(line name, option)] in data.js order, from the `lines:` section."""
    text = DATA_JS.read_text(encoding="utf-8")
    section = text.split("lines: [", 1)[1].split("\n  ],", 1)[0]
    out = []
    for m in re.finditer(r'\{ line: "([^"]+)"([^}]*)\}', section):
        opt = re.search(r'option: "(\w+)"', m.group(2))
        out.append((m.group(1), opt.group(1) if opt else None))
    return out


def read_risky():
    """Names of lines marked `risk: true` in data.js."""
    text = DATA_JS.read_text(encoding="utf-8")
    return {m.group(1) for m in re.finditer(r'\{ line: "([^"]+)"[^}]*risk: true', text)}


def route_short(line):
    return ROUTE_OF.get(line, line.split()[0])


# ---------------------------------------------------------------------------
# GTFS model

class Feed:
    def __init__(self, path, routes_wanted):
        z = zipfile.ZipFile(path)
        self.routes = {r["route_short_name"]: r["route_id"] for r in rows(z, "routes.txt")}
        rid_wanted = {self.routes[r] for r in routes_wanted if r in self.routes}

        self.stops = {
            s["stop_id"]: {"name": s["stop_name"].strip(), "code": s["stop_code"], "ll": (float(s["stop_lat"]), float(s["stop_lon"]))}
            for s in rows(z, "stops.txt")
        }

        short_of = {v: k for k, v in self.routes.items()}
        trip_route, trip_shape = {}, {}
        for t in rows(z, "trips.txt"):
            if t["service_id"] == WEEKDAY and t["route_id"] in rid_wanted:
                trip_route[t["trip_id"]] = t["route_id"]
                trip_shape[t["trip_id"]] = t["shape_id"]

        # trip -> [(seq, stop, time, dist_mi)]
        trip_stops = defaultdict(list)
        for st in rows(z, "stop_times.txt"):
            tid = st["trip_id"]
            if tid in trip_route:
                shift = 24 * 3600 if short_of.get(trip_route[tid]) in NEXT_DAY else 0
                trip_stops[tid].append((int(st["stop_sequence"]), st["stop_id"], secs(st["departure_time"]) + shift, float(st["shape_dist_traveled"] or 0)))
        for v in trip_stops.values():
            v.sort()
        self.trip_stops = trip_stops

        # Per route: stop patterns (unique stop sequences) and per-stop departures.
        self.patterns = defaultdict(dict)      # route -> {pattern tuple: (rep trip, shape)}
        self.trip_pattern = {}
        self.departures = defaultdict(list)     # (route, stop) -> sorted [(time, trip, index)]
        pattern_count = Counter()
        self.pattern_starts = defaultdict(list)  # (route, pattern) -> first-stop departure times
        for tid, seq in trip_stops.items():
            r = trip_route[tid]
            pat = tuple(s for _, s, _, _ in seq)
            pattern_count[(r, pat)] += 1
            self.pattern_starts[(r, pat)].append(seq[0][2])
            self.patterns[r].setdefault(pat, (tid, trip_shape[tid]))
            self.trip_pattern[tid] = pat
            for i, (_, s, t, _) in enumerate(seq):
                self.departures[(r, s)].append((t, tid, i))
        for v in self.departures.values():
            v.sort()
        # Drop rare short-turn patterns (< 3 trips a day) unless that's all there is.
        for r, pats in self.patterns.items():
            keep = {p: v for p, v in pats.items() if pattern_count[(r, p)] >= 3}
            if keep:
                self.patterns[r] = keep

        self.trip_shape = trip_shape
        wanted_shapes = set(trip_shape.values())
        self.shape_pts = defaultdict(list)
        for p in rows(z, "shapes.txt"):
            if p["shape_id"] in wanted_shapes:
                self.shape_pts[p["shape_id"]].append((int(p["shape_pt_sequence"]), float(p["shape_dist_traveled"] or 0), float(p["shape_pt_lat"]), float(p["shape_pt_lon"])))
        for v in self.shape_pts.values():
            v.sort()

    def route_id(self, short):
        return self.routes.get(short)

    def next_ride(self, route, b, s, t):
        """Earliest weekday trip leaving stop b at/after t that later reaches s: (dep, arr, trip, i, j)."""
        deps = self.departures.get((route, b), [])
        k = bisect.bisect_left(deps, (t, "", 0))
        for dep, tid, i in deps[k:k + 400]:
            seq = self.trip_stops[tid]
            for j in range(i + 1, len(seq)):
                if seq[j][1] == s:
                    return dep, seq[j][2], tid, i, j
        return None

    def path(self, tid, i, j):
        """Route shape between stop index i and j of a trip, as [(lat, lon)]."""
        seq = self.trip_stops[tid]
        da, db = seq[i][3], seq[j][3]
        pts = [(lat, lon) for _, d, lat, lon in self.shape_pts[self.trip_shape[tid]] if da <= d <= db]
        return [self.stops[seq[i][1]]["ll"]] + pts + [self.stops[seq[j][1]]["ll"]]


# ---------------------------------------------------------------------------
# Per-line candidate stops and ride matrices

class Line:
    def __init__(self, feed, name, option, risky=False):
        self.name, self.option = name, option
        self.buffer = RISK_BUFFER_S if risky else BUFFER_S
        self.short = route_short(name)
        self.route = feed.route_id(self.short)
        self.round_trip = self.short in ROUND_TRIP
        if not self.route:
            return
        min_mi = MIN_RIDE_OVERRIDE.get(self.short, MIN_RIDE_MI)
        # Only use stop patterns that actually run when we'd ride them (day vs. overnight).
        lo, hi = DAY_HOURS
        def runs(pat):
            ts = feed.pattern_starts[(self.route, pat)]
            day = sum(lo <= t <= hi for t in ts)
            return (len(ts) - day >= 2) if option in ("owl", "earlybird") else day >= 3
        pats = [(p, v) for p, v in feed.patterns[self.route].items() if runs(p)] or list(feed.patterns[self.route].items())
        stop_ids = sorted({s for pat, _ in pats for s in pat})
        self.stop_ids = stop_ids
        idx = {s: k for k, s in enumerate(stop_ids)}
        n = len(stop_ids)
        R = np.full((n, n), np.inf, dtype=np.float32)
        if self.round_trip:
            # Out to the far terminal on one pattern, back on another: board b, alight s anywhere.
            outs = []
            for pat, (tid, _) in pats:
                seq = feed.trip_stops[tid]
                outs.append((pat, seq))
            for pat_a, seq_a in outs:
                for pat_b, seq_b in outs:
                    if pat_a == pat_b:
                        continue
                    far_a = feed.stops[seq_a[-1][1]]["ll"]
                    # outbound must end where inbound starts (the island)
                    if meters(far_a, feed.stops[seq_b[0][1]]["ll"]) > 400:
                        continue
                    for i, (_, b, tb, _) in enumerate(seq_a[:-1]):
                        for j, (_, s, ts, _) in enumerate(seq_b[1:], 1):
                            if meters(feed.stops[s]["ll"], far_a) < 2000:
                                continue  # must come all the way back off the island
                            ride = (seq_a[-1][2] - tb) + (ts - seq_b[0][2]) + 300
                            R[idx[b], idx[s]] = min(R[idx[b], idx[s]], ride / 60)
        else:
            for pat, (tid, _) in pats:
                seq = feed.trip_stops[tid]
                for i in range(len(seq)):
                    for j in range(i + 1, len(seq)):
                        dist = seq[j][3] - seq[i][3]
                        if dist < min_mi:
                            continue
                        if dist > MAX_RIDE_MI:
                            break
                        ride = (seq[j][2] - seq[i][2]) / 60
                        a, b = idx[seq[i][1]], idx[seq[j][1]]
                        if ride < R[a, b]:
                            R[a, b] = ride
        self.R = R
        self.ll = np.array([feed.stops[s]["ll"] for s in stop_ids])


def round_trip_ride(f, ln, bid, sid, t):
    """Out to the island from bid and back to sid, leaving at/after t: (out ride, back ride) or None."""
    out = None
    for pat, (tid, _) in f.patterns[ln.route].items():
        seq = f.trip_stops[tid]
        if bid in pat[:-1]:
            r = f.next_ride(ln.route, bid, seq[-1][1], t)
            if r and (out is None or r[1] < out[1]):
                out = r
    if not out:
        return None
    far = f.trip_stops[out[2]][-1]
    back = None
    for pat, (tid, _) in f.patterns[ln.route].items():
        seq = f.trip_stops[tid]
        if sid in pat[1:] and meters(f.stops[seq[0][1]]["ll"], f.stops[far[1]]["ll"]) < 400:
            r = f.next_ride(ln.route, seq[0][1], sid, out[1] + 120)
            if r and (back is None or r[1] < back[1]):
                back = r
    return (out, back) if back else None


def alternatives(f, ln, bid, sid, dep):
    """Other weekday departures for this leg around the planned one: [(dep, arr)] in seconds."""
    alts, t = [], dep - ALT_BEFORE_S
    while len(alts) < ALT_MAX and t <= dep + ALT_AFTER_S:
        if ln.round_trip:
            rt = round_trip_ride(f, ln, bid, sid, t)
            r = (rt[0][0], rt[1][1]) if rt else None
        else:
            r = f.next_ride(ln.route, bid, sid, t)
            r = r[:2] if r else None
        if not r or r[0] > dep + ALT_AFTER_S:
            break
        if not alts or alts[-1][0] != r[0]:
            alts.append((r[0], r[1]))
        t = r[0] + 1
    return alts


def walk_matrix(A, B):
    """Straight-line meters between every stop of line A (rows) and line B (cols)."""
    la = np.radians((A.ll[:, None, 0] + B.ll[None, :, 0]) / 2)
    dx = (B.ll[None, :, 1] - A.ll[:, None, 1]) * 111320 * np.cos(la)
    dy = (B.ll[None, :, 0] - A.ll[:, None, 0]) * 110540
    return np.hypot(dx, dy).astype(np.float32)


def walk_cost(m):
    """Minutes of walking, plus a steep penalty past the 5-block limit."""
    c = m / WALK_SPEED
    over = np.maximum(m - WALK_LIMIT_M, 0)
    return c + over * 0.5 + (over > 0) * 30


class Planner:
    def __init__(self, feed, lines, start_ll=None, end_ll=None, start_time=DAY_START):
        self.feed, self.lines = feed, lines
        self.start_ll, self.end_ll, self.start_time = start_ll, end_ll, start_time
        self._w = {}

    def W(self, a, b):
        key = (a.name, b.name)
        if key not in self._w:
            M = walk_matrix(a, b)
            if _STREET:
                ia = {ll_key(p): i for i, p in enumerate(a.ll)}
                ib = {ll_key(p): j for j, p in enumerate(b.ll)}
                for (ka, kb), m in _STREET.items():
                    i, j = ia.get(ka), ib.get(kb)
                    if i is not None and j is not None:
                        M[i, j] = max(M[i, j], m)
            self._w[key] = walk_cost(M)
        return self._w[key]

    def choose_stops(self, order):
        """DP: best board/alight stop for each line in this order (time-independent)."""
        lines = [self.lines[k] for k in order]
        first = lines[0]
        if self.start_ll is not None:
            d = np.array([meters(self.start_ll, p) for p in first.ll], dtype=np.float32)
            arrive = walk_cost(d) * 0.2  # walking to the very first stop is cheap-ish
        else:
            arrive = np.zeros(len(first.stop_ids), dtype=np.float32)
        back = []
        for k, ln in enumerate(lines):
            if k > 0:
                tot = cost[:, None] + self.W(lines[k - 1], ln)
                arg_prev = tot.argmin(axis=0)
                arrive = tot[arg_prev, np.arange(tot.shape[1])]
            else:
                arg_prev = None
            tot2 = arrive[:, None] + ln.R
            arg_board = tot2.argmin(axis=0)
            cost = tot2[arg_board, np.arange(tot2.shape[1])]
            back.append((arg_prev, arg_board))
        if self.end_ll is not None:
            d = np.array([meters(p, self.end_ll) for p in lines[-1].ll], dtype=np.float32)
            final = cost + walk_cost(d)
        else:
            final = cost
        s = int(final.argmin())
        total = float(final[s])
        choice = []
        for k in range(len(lines) - 1, -1, -1):
            arg_prev, arg_board = back[k]
            b = int(arg_board[s])
            choice.append((b, s))
            if arg_prev is not None:
                s = int(arg_prev[b])
        choice.reverse()
        return choice, total

    def simulate(self, order, choice):
        """Walk the day with the real timetable. Returns (end_time, legs, penalty)."""
        f = self.feed
        t = self.start_time
        prev_ll = self.start_ll
        legs, penalty = [], 0.0
        for k, (b, s) in zip(order, choice):
            ln = self.lines[k]
            bid, sid = ln.stop_ids[b], ln.stop_ids[s]
            bll, sll = f.stops[bid]["ll"], f.stops[sid]["ll"]
            walk = walk_m(prev_ll, bll) if prev_ll else 0
            if prev_ll and legs and walk > WALK_LIMIT_M:
                penalty += 30 * 60 + (walk - WALK_LIMIT_M) * 30
            t += walk / WALK_SPEED * 60 if legs else 0
            # Plan to be at the stop a few minutes early (not before the very first ride).
            ready = t + (ln.buffer if legs else 0)
            if ln.round_trip:
                rt = round_trip_ride(f, ln, bid, sid, ready)
                if not rt:
                    return None  # 25 runs all day; treat as a hard failure
                out, back = rt
                dep, arr = out[0], back[1]
                path = f.path(out[2], out[3], out[4]) + f.path(back[2], back[3], back[4])
                stops_n = (out[4] - out[3]) + (back[4] - back[3])
            else:
                r = f.next_ride(ln.route, bid, sid, ready)
                if not r:
                    # Not running at this hour: big penalty, but keep going so the search can recover.
                    penalty += 3 * 3600
                    dep, arr = ready + 1800, ready + 1800 + float(ln.R[b, s]) * 60
                    path, stops_n = [bll, sll], 0
                else:
                    dep, arr, tid, i, j = r
                    path = (tid, i, j)
                    stops_n = j - i
            legs.append({"k": k, "board": bid, "alight": sid, "walk": walk, "arrive_stop": t, "dep": dep, "arr": arr, "path": path, "stops": stops_n})
            t = arr
            prev_ll = sll
        end_walk = walk_m(prev_ll, self.end_ll) if self.end_ll else 0
        if end_walk > WALK_LIMIT_M:
            penalty += 30 * 60 + (end_walk - WALK_LIMIT_M) * 30
        t += end_walk / WALK_SPEED * 60
        return t, legs, penalty, end_walk

    def evaluate(self, order):
        choice, _ = self.choose_stops(order)
        sim = self.simulate(order, choice)
        if sim is None:
            return math.inf, None
        end, legs, penalty, end_walk = sim
        return end + penalty, (choice, legs, end, end_walk)


def search(planner, order, fixed_prefix, iters, rng, label, temp_min=20):
    """Local search over line order (relocate / swap / reverse), keeping the prefix group first."""
    best_cost, best_info = planner.evaluate(order)
    cur, cur_cost = order[:], best_cost
    best = order[:]
    n, p = len(order), fixed_prefix
    temp0 = temp_min * 60
    for it in range(iters):
        cand = cur[:]
        move = rng.random()
        if p and rng.random() < 0.05:
            i, j = rng.sample(range(p), 2) if p > 1 else (0, 0)
            cand[i], cand[j] = cand[j], cand[i]
        elif move < 0.45:
            i = rng.randrange(p, n)
            x = cand.pop(i)
            cand.insert(rng.randrange(p, n), x)
        elif move < 0.7:
            i, j = rng.sample(range(p, n), 2)
            cand[i], cand[j] = cand[j], cand[i]
        else:
            i, j = sorted(rng.sample(range(p, n + 1), 2))
            cand[i:j] = reversed(cand[i:j])
        c, info = planner.evaluate(cand)
        temp = temp0 * (1 - it / iters) + 1
        if c < cur_cost or rng.random() < math.exp(-(c - cur_cost) / temp):
            cur, cur_cost = cand, c
            if c < best_cost:
                best, best_cost, best_info = cand[:], c, info
        if it % 2000 == 0:
            print(f"  [{label}] iter {it:>6}  best finish {clock(best_info[2]) if best_info else '—'}  cost {best_cost / 60:.0f}", flush=True)
    return best, best_info


def plan_owl(feed, core, early, day_ll, day_dep):
    """
    Owl lines (and the 714, if listed) ridden as late as possible, finishing just before the
    day's first ride: try every start time and order, keep plans where every ride really runs,
    and prefer (1) including the 714, (2) the latest finish, (3) the least waiting.
    """
    deadline = day_dep + 24 * 3600  # Owl times are on the 24:00+ clock
    best = None
    for start in range(OWL_START, OWL_LATEST + 1, 5 * 60):
        core_p = Planner(feed, core, start_time=start)
        full_p = Planner(feed, core + early, start_time=start) if early else None
        for perm in permutations(range(len(core))):
            perm = list(perm)
            c, info = core_p.evaluate(perm)
            if not info or c - info[2] > 1:
                continue  # some ride doesn't exist at this hour
            plans = [(False, core_p, perm, info)]
            if full_p:
                fc, finfo = full_p.evaluate(perm + [len(core)])
                if finfo and fc - finfo[2] <= 1:
                    plans.append((True, full_p, perm + [len(core)], finfo))
            for has_early, pl, order, inf in plans:
                legs = inf[1]
                last_ll = feed.stops[legs[-1]["alight"]]["ll"]
                ready = inf[2] + walk_m(last_ll, day_ll) / WALK_SPEED * 60 + BUFFER_S
                if ready > deadline:
                    continue
                score = (has_early, inf[2], -(inf[2] - legs[0]["dep"]))
                if best is None or score > best[0]:
                    best = (score, pl, order, inf, has_early)
    if not best:
        print("  ! No Owl plan fits before the day starts")
        return []
    _, pl, order, inf, has_early = best
    legs = build_block(feed, pl, order, inf, "owl", OWL_COLOR)
    if has_early:
        legs[-1]["option"] = "earlybird"
    elif early:
        print("  ! 714 doesn't fit after the Owl lines")
    gap = (deadline - inf[2]) / 60
    print(f"  Owl block {legs[0]['depart']}–{legs[-1]['arrive']}, {gap:.0f} min before the first day ride")
    return legs


def neighborhoods(points):
    names = []
    for p in points:
        n = min(NEIGHBORHOODS, key=lambda h: meters(p, (h[1], h[2])))[0]
        if n not in names:
            names.append(n)
    return names


# ---------------------------------------------------------------------------
# Data for re-planning in the app (js/replan-data.js)

REPLAN_JS = ROOT / "js" / "replan-data.js"
REPLAN_K = 12          # stop pairs offered per line
REPLAN_SPREAD_M = 250  # …with boarding stops at least this far apart
REPLAN_HUB_M = 300     # a stop "connects" to another line if that line stops within this distance
REPLAN_MAX_RIDE = 20   # minutes; don't offer long rides


def hub_scores(lines):
    """For each line: per stop, how many other lines stop within REPLAN_HUB_M (transfer potential)."""
    out = {}
    for a in lines:
        score = np.zeros(len(a.stop_ids))
        for b in lines:
            if b is not a and b.route:
                score += (walk_matrix(a, b).min(axis=1) < REPLAN_HUB_M)
        out[a.name] = score
    return out


def candidate_pairs(ln, planned, hub):
    """Up to REPLAN_K board→alight pairs (planned pair first), favouring stops near other lines —
    where re-planned transfers can actually happen — and spread along the route."""
    idx = {s: i for i, s in enumerate(ln.stop_ids)}
    opts = []
    for b in range(len(ln.stop_ids)):
        row = np.where(ln.R[b] <= REPLAN_MAX_RIDE, ln.R[b], np.inf)
        if not np.isfinite(row).any():
            continue
        # Best alight from here: well connected, not too long a ride.
        value = np.where(np.isfinite(row), hub * 10 - row, -np.inf)
        s = int(np.argmax(value))
        score = hub[b] + hub[s] - row[s] / 10
        opts.append((score, ln.stop_ids[b], ln.stop_ids[s], tuple(ln.ll[b])))
    opts.sort(reverse=True)
    chosen, chosen_ll = [planned], [tuple(ln.ll[idx[planned[0]]])]
    for score, bid, sid, ll in opts:
        if len(chosen) >= REPLAN_K:
            break
        if (bid, sid) in chosen or min(meters(ll, c) for c in chosen_ll) < REPLAN_SPREAD_M:
            continue
        chosen.append((bid, sid))
        chosen_ll.append(ll)
    return chosen


def all_times(f, ln, bid, sid, t0=5 * 3600, t1=27 * 3600):
    """Every weekday trip from bid that reaches sid, leaving between t0 and t1: [(dep, arr)]."""
    out, t = [], t0
    while t <= t1 and len(out) < 300:
        r = f.next_ride(ln.route, bid, sid, t)
        if not r or r[0] > t1:
            break
        out.append(r[:2])
        t = r[0] + 1
    return out


def write_replan_data(feed, day_lines, day_info):
    """For each day line: alternative stop pairs with their full timetables, so the app can
    re-plan from wherever you are. Times are minutes, encoded [Δdep, ride, Δdep, ride, …]."""
    def stop(sid):
        s = feed.stops[sid]
        return {"name": s["name"], "code": s["code"], "ll": [round(x, 6) for x in s["ll"]]}

    data = {}
    hubs = hub_scores(day_lines)
    for leg in day_info[1]:
        ln = day_lines[leg["k"]]
        if ln.round_trip:
            continue  # the 25's out-and-back is special; the app keeps its planned stops
        pairs = []
        for bid, sid in candidate_pairs(ln, (leg["board"], leg["alight"]), hubs[ln.name]):
            enc, prev = [], 0
            for d, a in all_times(feed, ln, bid, sid):
                dm, am = round(d / 60), round(a / 60)
                enc += [dm - prev, am - dm]
                prev = dm
            if enc:
                pairs.append({"b": stop(bid), "s": stop(sid), "t": enc})
        data[ln.name] = pairs
    header = (
        "// Generated by scripts/plan.py from SFMTA GTFS — do not edit by hand.\n"
        "// Data provided by SFMTA under the SFMTA Transit Data License Agreement.\n"
        "// Alternative stops per line for re-planning on the day (first = planned).\n"
    )
    REPLAN_JS.write_text(header + "window.MUNI_REPLAN = " + json.dumps(data, separators=(",", ":"), ensure_ascii=False) + ";\n",
                         encoding="utf-8", newline="\n")
    n = sum(len(v) for v in data.values())
    print(f"Wrote {REPLAN_JS.relative_to(ROOT)} ({REPLAN_JS.stat().st_size // 1024} KB, {n} stop pairs)")


def build_block(feed, planner, order, info, bid, color, option=None, title=None, chunk=None):
    lines = planner.lines
    choice, legs, end, end_walk = info
    out = []
    for leg in legs:
        ln = lines[leg["k"]]
        path = leg["path"] if isinstance(leg["path"], list) else feed.path(*leg["path"])
        b, s = feed.stops[leg["board"]], feed.stops[leg["alight"]]
        out.append({
            "line": ln.name,
            "board": {"name": b["name"], "code": b["code"], "ll": [round(x, 6) for x in b["ll"]]},
            "alight": {"name": s["name"], "code": s["code"], "ll": [round(x, 6) for x in s["ll"]]},
            "walk_m": round(leg["walk"]),
            "depart": clock(leg["dep"]),
            "arrive": clock(leg["arr"]),
            "t_depart": leg["dep"],
            # Minutes after midnight (can pass 1440 for after-midnight Owl trips), for the live view.
            "dep_min": round(leg["dep"] / 60),
            "arr_min": round(leg["arr"] / 60),
            # Every weekday departure for this board→alight pair: [[dep, arr], ...] in minutes.
            "times": [[round(d / 60), round(a / 60)] for d, a in alternatives(feed, ln, leg["board"], leg["alight"], leg["dep"])],
            "wait_min": max(0, round((leg["dep"] - leg["arrive_stop"]) / 60)),
            "ride_min": round((leg["arr"] - leg["dep"]) / 60),
            "stops": leg["stops"],
            "path": [[round(a, 5), round(c, 5)] for a, c in path],
        })
    return out


def chunk_blocks(legs, n_blocks):
    """Split the day's legs into roughly equal time blocks."""
    if not legs:
        return []
    t0, t1 = legs[0]["t_depart"], legs[-1]["t_depart"]
    size = max(1, len(legs) // n_blocks)
    blocks, cur = [], []
    for leg in legs:
        cur.append(leg)
        if len(cur) >= size and len(blocks) < n_blocks - 1:
            blocks.append(cur)
            cur = []
    if cur:
        blocks.append(cur)
    return blocks


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("gtfs")
    ap.add_argument("--iters", type=int, default=20000)
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--restarts", type=int, default=1, help="independent searches; keep the best")
    ap.add_argument("--warm", help="start the first search from the day order in an existing plan.js")
    ap.add_argument("--temp", type=float, default=20, help="annealing start temperature in minutes (lower = polish)")
    args = ap.parse_args()
    rng = random.Random(args.seed)

    all_lines = read_lines()
    feed = Feed(args.gtfs, {route_short(n) for n, _ in all_lines})
    risky = read_risky()
    lines = [Line(feed, n, o, n in risky) for n, o in all_lines]
    missing = [ln for ln in lines if not ln.route]
    for ln in missing:
        print(f"  ! {ln.name}: not in this feed — skipped by the planner")
    lines = [ln for ln in lines if ln.route]

    owl = [ln for ln in lines if ln.option in ("owl", "earlybird")]
    day = [ln for ln in lines if ln.option not in ("owl", "earlybird")]

    # ---- Main day.
    first = [k for k, ln in enumerate(day) if ln.short in FIRST_LINES]
    rest = [k for k in range(len(day)) if k not in first]
    order = first + rest
    if args.warm:
        prev = json.loads(Path(args.warm).read_text(encoding="utf-8").split("window.MUNI_PLAN = ", 1)[1].rstrip().rstrip(";"))
        names = [l["line"] for b in prev["blocks"] if b["id"] != "owl" for l in b["legs"]]
        pos = {ln.name: k for k, ln in enumerate(day)}
        warm = [pos[n] for n in names if n in pos]
        # Keep the saved order exactly, cable cars included (they stay the first group).
        order = [k for k in warm if k in first] + [k for k in first if k not in warm] +                 [k for k in warm if k in rest] + [k for k in rest if k not in warm]
    start_ll = feed.stops[day[first[0]].stop_ids[0]]["ll"] if first else None
    planner = Planner(feed, day, start_ll=(37.78485, -122.40776), end_ll=FINISH, start_time=DAY_START)
    best_c, best_order, best_info = math.inf, None, None
    for r in range(args.restarts):
        start = first + rng.sample(rest, len(rest)) if r and not args.warm else order
        o, inf_ = search(planner, start, len(first), args.iters, random.Random(args.seed + r), f"day {r + 1}", args.temp)
        c, _ = planner.evaluate(o)
        if c < best_c:
            best_c, best_order, best_info = c, o, inf_
    order, info = best_order, best_info
    day_legs = build_block(feed, planner, order, info, "day", None)
    _, _, end, end_walk = info

    # ---- Overnight Owl block, as close to the start of the day as it fits.
    owl_legs = plan_owl(feed, [ln for ln in owl if ln.option == "owl"], [ln for ln in owl if ln.option == "earlybird"],
                        day_legs[0]["board"]["ll"], day_legs[0]["dep_min"] * 60)

    # ---- Report.
    print("\nDay plan:")
    for i, leg in enumerate(day_legs, 1):
        flag = "  ← LONG WALK" if leg["walk_m"] > WALK_LIMIT_M and i > 1 else ""
        print(f"{i:>2}. {leg['depart']:>8} {leg['line']:<34} {leg['board']['name']} → {leg['alight']['name']}  "
              f"(walk {leg['walk_m']} m, wait {leg['wait_min']}, ride {leg['ride_min']} min){flag}")
    print(f"    finish walk {end_walk:.0f} m → arrive Bus Stop ~{clock(end)}")
    long_walks = [l for l in day_legs[1:] if l["walk_m"] > WALK_LIMIT_M]
    print(f"\n{len(day_legs)} lines, {len(long_walks)} walks over {WALK_LIMIT_M} m, done by {clock(end)}")
    print("\nOwl plan:")
    for leg in owl_legs:
        print(f"    {leg['depart']:>8} {leg['line']:<26} {leg['board']['name']} → {leg['alight']['name']} (walk {leg['walk_m']} m)")

    # ---- Write js/plan.js
    blocks = []
    if owl_legs:
        blocks.append({
            "id": "owl", "option": "owl", "color": OWL_COLOR,
            "time": owl_legs[0]["depart"] + "–" + owl_legs[-1]["arrive"],
            "title": "Owl lines (overnight, while the subway is closed)",
            "legs": owl_legs,
        })
    for n, chunk in enumerate(chunk_blocks(day_legs, 7)):
        pts = [l["board"]["ll"] for l in chunk]
        blocks.append({
            "id": f"b{n + 1}",
            "color": BLOCK_COLORS[n % len(BLOCK_COLORS)],
            "time": chunk[0]["depart"] + "–" + chunk[-1]["arrive"],
            "title": " · ".join(neighborhoods(pts)[:3]),
            "legs": chunk,
        })
    for b in blocks:
        for l in b["legs"]:
            l.pop("t_depart", None)
    plan = {
        "feed": Path(args.gtfs).name,
        "walkLimitM": WALK_LIMIT_M,
        "finishWalkM": round(end_walk),
        "finishAt": clock(end),
        "missing": [ln.name for ln in missing],
        "blocks": blocks,
    }
    PLAN_JS.write_text(
        "// Generated by scripts/plan.py from SFMTA GTFS (" + plan["feed"] + ") — do not edit by hand.\n"
        "// Data provided by SFMTA under the SFMTA Transit Data License Agreement.\n"
        "window.MUNI_PLAN = " + json.dumps(plan, separators=(",", ":"), ensure_ascii=False) + ";\n",
        encoding="utf-8", newline="\n",
    )
    print(f"\nWrote {PLAN_JS.relative_to(ROOT)}")
    write_replan_data(feed, day, info)


if __name__ == "__main__":
    main()
