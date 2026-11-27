/*
 * On-the-fly re-planning for when the day goes off script.
 * Exposes window.MuniReplan with simulate / optimize / decode.
 *
 * It works on the lines you haven't ridden yet. Each line offers a few stop pairs
 * (js/replan-data.js: the planned pair first, then others spread along the line, each
 * with every weekday trip). For a given order it rides each line from whichever stop
 * pair gets you there soonest without stranding you, and it searches over orders.
 * Same rules as scripts/plan.py: a few minutes spare before each bus (more for the
 * infrequent lines) and at most ~5 blocks of walking between lines.
 */
(function () {
  "use strict";

  const WALK_M_PER_MIN = 75;
  const STREET_FACTOR = 1.25;   // street distance ≈ 1.25 × straight line
  const WALK_LIMIT_M = 450;     // straight line ≈ 5 blocks
  const BUFFER = 3, RISK_BUFFER = 5, FIRST_BUFFER = 1;
  const MISS_PENALTY = 20000;   // a line with no more trips today: only ever the last resort
  // Too far to walk? Hop on any Muni line to get there (not a walk, so the 5-block rule doesn't apply):
  // a rough wait + ride at ~15 km/h + walking to and from stops, plus a nudge to prefer walkable links.
  const HOP_WAIT = 8, HOP_M_PER_MIN = 250, HOP_ACCESS = 4, HOP_NUDGE = 15; // hop times are rough: only hop when it really pays
  const TEMP = 5; // search temperature (minutes): low, so a sensible order is refined rather than scrambled

  /** Minutes to get from one point to another, walking if it's within ~5 blocks, else by any Muni. */
  function travel(straight) {
    if (straight <= WALK_LIMIT_M) return { min: (straight * STREET_FACTOR) / WALK_M_PER_MIN, hop: false, cost: 0 };
    return { min: HOP_WAIT + (straight * 1.3) / HOP_M_PER_MIN + HOP_ACCESS, hop: true, cost: HOP_NUDGE };
  }

  function meters(p, q) {
    const lat = ((p[0] + q[0]) / 2) * Math.PI / 180;
    return Math.hypot((q[1] - p[1]) * 111320 * Math.cos(lat), (q[0] - p[0]) * 110540);
  }

  /** [Δdep, ride, Δdep, ride, …] → [[dep, arr], …] in minutes. */
  function decode(enc) {
    const out = [];
    let d = 0;
    for (let i = 0; i < enc.length; i += 2) {
      d += enc[i];
      out.push([d, d + enc[i + 1]]);
    }
    return out;
  }

  /** First trip in sorted [[dep, arr], …] leaving at or after t. */
  function catchAt(times, t) {
    let lo = 0, hi = times.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (times[mid][0] < t) lo = mid + 1; else hi = mid;
    }
    return times[lo] || null;
  }

  /**
   * Walk the remaining legs in `order`.
   * legs[i]: { id, risk, cands: [{ board: {ll}, alight: {ll}, times }], knownFrom, knownStreetM }
   *   cands[0] is the planned stop pair; knownFrom/knownStreetM give the measured street walk
   *   into it from the planned previous leg.
   * ctx: { startT, startLL, endLL, firstIsTransfer, prevId }
   * choice: optional stop pair per position (from dpChoose); otherwise each leg picks greedily.
   */
  function simulate(legs, order, ctx, choice) {
    let t = ctx.startT, pos = ctx.startLL, prevId = ctx.prevId || null, prevCand = 0;
    let penalty = 0;
    const steps = [], missing = [];
    const near = ctx._near || (ctx._near = new Map()); // nearest boarding stop of a leg from a point

    function nearest(legIdx, ll, key) {
      let v = near.get(key);
      if (v === undefined) {
        v = Math.min(...legs[legIdx].cands.map((c) => meters(ll, c.board.ll)));
        near.set(key, v);
      }
      return v;
    }

    order.forEach((idx, k) => {
      const leg = legs[idx];
      const transfer = k > 0 || ctx.firstIsTransfer;
      const buffer = transfer ? (leg.risk ? RISK_BUFFER : BUFFER) : FIRST_BUFFER;
      const nextIdx = order[k + 1];
      let best = null;
      const consider = (cd, c) => {
        const straight = pos ? meters(pos, cd.board.ll) : 0;
        const known = c === 0 && prevCand === 0 && prevId && prevId === leg.knownFrom && leg.knownStreetM != null;
        const go = known ? { min: leg.knownStreetM / WALK_M_PER_MIN, hop: false, cost: 0 } : travel(straight);
        const arriveStop = t + go.min;
        // Times are whole minutes (the planner works in seconds): allow for the rounding.
        const trip = catchAt(cd.times, arriveStop + buffer - 0.5);
        if (!trip) return;
        let score = trip[1] + go.cost;
        // Look ahead: don't get stranded far from the next line.
        if (nextIdx !== undefined) {
          const g = travel(nearest(nextIdx, cd.alight.ll, idx + "|" + c + "|" + nextIdx));
          score += g.min + g.cost;
        } else if (ctx.endLL) {
          const g = travel(meters(cd.alight.ll, ctx.endLL));
          score += g.min + g.cost;
        }
        const street = known ? leg.knownStreetM : straight * STREET_FACTOR;
        if (!best || score < best.score) best = { score, c, cd, trip, street, go, arriveStop };
      };
      if (choice) consider(leg.cands[choice[k]], choice[k]);
      if (!best) leg.cands.forEach(consider); // no choice given, or its stops have no more trips
      if (!best) {
        missing.push(idx);
        penalty += MISS_PENALTY;
        return; // skip it; you stay where you are
      }
      penalty += best.go.cost;
      steps.push({
        idx, cand: best.c, dep: best.trip[0], arr: best.trip[1], walkM: Math.round(best.street),
        hop: best.go.hop, hopMin: best.go.hop ? Math.round(best.go.min) : 0,
        wait: Math.max(0, Math.round(best.trip[0] - best.arriveStop)),
      });
      t = best.trip[1];
      pos = best.cd.alight.ll;
      prevId = leg.id;
      prevCand = best.c;
    });
    let finishWalkM = 0, finishHop = false;
    if (ctx.endLL && pos) {
      const straight = meters(pos, ctx.endLL);
      const g = travel(straight);
      penalty += g.cost;
      finishWalkM = straight * STREET_FACTOR;
      finishHop = g.hop;
      t += g.min;
    }
    return { end: t, cost: t + penalty, penalty, steps, missing, finishWalkM: Math.round(finishWalkM), finishHop };
  }

  const tcost = (m) => { const g = travel(m); return g.min + g.cost; };

  /** Typical ride time of a stop pair (median of its trips). */
  function rideMin(cd) {
    if (cd._ride == null) {
      const r = cd.times.map((t) => t[1] - t[0]).sort((a, b) => a - b);
      cd._ride = r.length ? r[r.length >> 1] : 999;
    }
    return cd._ride;
  }

  /** Travel cost between every alight stop of leg a and every boarding stop of leg b (cached). */
  function link(legs, ctx, a, b) {
    const cache = ctx._link || (ctx._link = new Map());
    const key = a + "|" + b;
    let m = cache.get(key);
    if (!m) {
      const A = legs[a].cands, B = legs[b].cands;
      m = new Float32Array(A.length * B.length);
      A.forEach((x, i) => B.forEach((y, j) => { m[i * B.length + j] = tcost(meters(x.alight.ll, y.board.ll)); }));
      cache.set(key, m);
    }
    return m;
  }

  /** Like the planner's stop choice: the best-connected chain of stop pairs for this order,
   *  ignoring the clock (walking/hop time + typical ride time). */
  function dpChoose(legs, order, ctx) {
    const n = order.length;
    if (!n) return [];
    let cost = legs[order[0]].cands.map((cd) => (ctx.startLL ? tcost(meters(ctx.startLL, cd.board.ll)) : 0) + rideMin(cd));
    const back = [];
    for (let k = 1; k < n; k++) {
      const A = legs[order[k - 1]].cands, B = legs[order[k]].cands, M = link(legs, ctx, order[k - 1], order[k]);
      const next = new Array(B.length), arg = new Array(B.length);
      for (let j = 0; j < B.length; j++) {
        let bi = 0, bv = Infinity;
        for (let i = 0; i < A.length; i++) {
          const v = cost[i] + M[i * B.length + j];
          if (v < bv) { bv = v; bi = i; }
        }
        next[j] = bv + rideMin(B[j]);
        arg[j] = bi;
      }
      back.push(arg);
      cost = next;
    }
    const last = legs[order[n - 1]].cands;
    let s = 0, sv = Infinity;
    last.forEach((cd, j) => {
      const v = cost[j] + (ctx.endLL ? tcost(meters(cd.alight.ll, ctx.endLL)) : 0);
      if (v < sv) { sv = v; s = j; }
    });
    const choice = new Array(n);
    choice[n - 1] = s;
    for (let k = n - 1; k > 0; k--) { s = back[k - 1][s]; choice[k - 1] = s; }
    return choice;
  }

  /** Best of the two stop strategies (whole-chain choice vs. leg-by-leg) for this order. */
  function evaluate(legs, order, ctx) {
    const greedy = simulate(legs, order, ctx);
    const chained = simulate(legs, order, ctx, dpChoose(legs, order, ctx));
    return chained.cost < greedy.cost ? chained : greedy;
  }

  /** Simulated annealing over the order (relocate / swap / reverse), from `start`. */
  function optimize(legs, start, ctx, iters) {
    iters = iters || 12000;
    const n = start.length;
    let cur = start.slice(), curRes = evaluate(legs, cur, ctx);
    let best = cur.slice(), bestRes = curRes;
    if (n < 2) return { order: best, result: bestRes };
    const rand = (k) => Math.floor(Math.random() * k);
    for (let it = 0; it < iters; it++) {
      const cand = cur.slice();
      const m = Math.random();
      if (m < 0.45) {
        const x = cand.splice(rand(n), 1)[0];
        cand.splice(rand(n), 0, x);
      } else if (m < 0.7) {
        const i = rand(n), j = rand(n);
        [cand[i], cand[j]] = [cand[j], cand[i]];
      } else {
        let i = rand(n + 1), j = rand(n + 1);
        if (i > j) [i, j] = [j, i];
        const seg = cand.slice(i, j).reverse();
        cand.splice(i, j - i, ...seg);
      }
      const res = evaluate(legs, cand, ctx);
      const temp = 20 * (1 - it / iters) + 0.5;
      if (res.cost < curRes.cost || Math.random() < Math.exp(-(res.cost - curRes.cost) / temp)) {
        cur = cand;
        curRes = res;
        if (res.cost < bestRes.cost) { best = cand.slice(); bestRes = res; }
      }
    }
    return { order: best, result: bestRes };
  }

  /**
   * Same search, but for a time budget instead of a step count, in small chunks so the page
   * stays responsive. onProgress(fraction, bestResult) is called between chunks.
   */
  async function optimizeFor(legs, start, ctx, ms, onProgress, runs) {
    runs = runs || 4;
    const n = start.length;
    let best = start.slice(), bestRes = evaluate(legs, best, ctx);
    if (n < 2) return { order: best, result: bestRes };
    const rand = (k) => Math.floor(Math.random() * k);
    // Several short searches from the current order; keep the best (results vary run to run).
    for (let run = 0; run < runs; run++) {
      let cur = start.slice(), curRes = evaluate(legs, cur, ctx);
      const t0 = performance.now(), budget = ms / runs;
      let frac = 0;
      while (frac < 1) {
        for (let i = 0; i < 400; i++) {
          const cand = cur.slice();
          const m = Math.random();
          if (m < 0.45) {
            const x = cand.splice(rand(n), 1)[0];
            cand.splice(rand(n), 0, x);
          } else if (m < 0.7) {
            const a = rand(n), b = rand(n);
            [cand[a], cand[b]] = [cand[b], cand[a]];
          } else {
            let a = rand(n + 1), b = rand(n + 1);
            if (a > b) [a, b] = [b, a];
            const seg = cand.slice(a, b).reverse();
            cand.splice(a, b - a, ...seg);
          }
          const res = evaluate(legs, cand, ctx);
          const temp = TEMP * (1 - frac) + 0.2;
          if (res.cost < curRes.cost || Math.random() < Math.exp(-(res.cost - curRes.cost) / temp)) {
            cur = cand;
            curRes = res;
            if (res.cost < bestRes.cost) { best = cand.slice(); bestRes = res; }
          }
        }
        frac = Math.min(1, (performance.now() - t0) / budget);
        if (onProgress) onProgress((run + frac) / runs, bestRes);
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    return { order: best, result: bestRes };
  }

  window.MuniReplan = { simulate, evaluate, optimize, optimizeFor, decode, meters };
})();
