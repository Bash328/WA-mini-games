/* ============================================================
   cross-sums/puzzle.js — the puzzles and the rules of Cross Sums (Kakuro).

   A plain script that sets globalThis.CrossSums (the page loads it with a <script>
   tag, the test imports it for the same effect).

   THE GAME: fill the white squares with the digits 1 to 9. Every unbroken run of
   white squares has a clue: its digits must add up to that number and may not repeat.
   Clues sit in the black squares: the top number is for the run going across to the
   right, the bottom number for the run going down.

   Everything is built from a seed and step counts only (never the clock), so the
   daily puzzle is identical on every device. Generation:
     1. lay out a pattern of black and white squares (no white run of 1, none over 9),
     2. fill it with a random valid solution and read the clues off it,
     3. count solutions with a bounded solver; if the clues leave more than one (or the
        solver gives up), reveal squares of the solution as GIVENS until it is unique.
   So every puzzle has exactly one solution, with as few givens as that needs.
   ============================================================ */
(function (g) {
  "use strict";

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shuffled(arr, rng) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  const popcount = (m) => { let n = 0; while (m) { m &= m - 1; n++; } return n; };

  // size of the board (clue row and column included), how dense the black squares are, and how many extra givens to show
  const LEVELS = {
    easy:   { n: 6,  black: 0.20, extra: 0.22, tries: 6, budget: 60000 },
    medium: { n: 8,  black: 0.24, extra: 0.08, tries: 5, budget: 80000 },
    hard:   { n: 10, black: 0.27, extra: 0,    tries: 3, budget: 80000 },
  };

  /* ---------- the pattern ---------- */
  // white[i] for i = r * n + c; row 0 and column 0 are clue squares
  function pattern(n, density, rng) {
    const white = new Uint8Array(n * n);
    for (let r = 1; r < n; r++) for (let c = 1; c < n; c++) white[r * n + c] = rng() < density ? 0 : 1;
    // repair: no white run shorter than 2 or longer than 9, in either direction
    for (let pass = 0; pass < 40; pass++) {
      let changed = false;
      for (let r = 1; r < n; r++) for (let c = 1; c < n; c++) {
        if (!white[r * n + c]) continue;
        const h = (c > 0 && white[r * n + c - 1] ? 1 : 0) + (c + 1 < n && white[r * n + c + 1] ? 1 : 0);
        const v = (r > 0 && white[(r - 1) * n + c] ? 1 : 0) + (r + 1 < n && white[(r + 1) * n + c] ? 1 : 0);
        if (h === 0 || v === 0) { white[r * n + c] = 0; changed = true; }
      }
      // break a run of 10 or more in the middle
      for (let r = 1; r < n; r++) { let len = 0; for (let c = 1; c <= n; c++) { if (c < n && white[r * n + c]) len++; else { if (len > 9) { white[r * n + c - 1 - 5] = 0; changed = true; } len = 0; } } }
      for (let c = 1; c < n; c++) { let len = 0; for (let r = 1; r <= n; r++) { if (r < n && white[r * n + c]) len++; else { if (len > 9) { white[(r - 1 - 5) * n + c] = 0; changed = true; } len = 0; } } }
      if (!changed) break;
    }
    return white;
  }
  // the runs of the pattern: [{ cells: [index...], dir: "a"|"d" }]
  function runsOf(white, n) {
    const runs = [];
    for (let r = 1; r < n; r++) { let cur = []; for (let c = 1; c <= n; c++) { if (c < n && white[r * n + c]) cur.push(r * n + c); else { if (cur.length) runs.push({ cells: cur, dir: "a" }); cur = []; } } }
    for (let c = 1; c < n; c++) { let cur = []; for (let r = 1; r <= n; r++) { if (r < n && white[r * n + c]) cur.push(r * n + c); else { if (cur.length) runs.push({ cells: cur, dir: "d" }); cur = []; } } }
    return runs;
  }
  const valid = (runs) => runs.every((r) => r.cells.length >= 2 && r.cells.length <= 9);

  // a random solution: digits 1-9, none repeated in any run (bounded backtracking)
  function fill(white, n, runs, rng, cap) {
    const cells = [];
    for (let i = 0; i < n * n; i++) if (white[i]) cells.push(i);
    const hRun = {}, vRun = {};
    runs.forEach((r, k) => r.cells.forEach((i) => { (r.dir === "a" ? hRun : vRun)[i] = k; }));
    const sol = {}, used = runs.map(() => 0);
    let steps = 0;
    function put(k) {
      if (k === cells.length) return true;
      if (++steps > cap) return false;
      const i = cells[k], blockedMask = used[hRun[i]] | used[vRun[i]];
      // extreme digits (1, 2, 8, 9) first, most of the time: their sums have few ways to be made, which makes puzzles solvable with fewer givens
      for (const d of [1, 2, 3, 4, 5, 6, 7, 8, 9].map((x) => [Math.abs(x - 5) / 4 * 0.9 + rng() * 0.7, x]).sort((a, b) => b[0] - a[0]).map((x) => x[1])) {
        const b = 1 << d;
        if (blockedMask & b) continue;
        sol[i] = d; used[hRun[i]] |= b; used[vRun[i]] |= b;
        if (put(k + 1)) return true;
        used[hRun[i]] &= ~b; used[vRun[i]] &= ~b; delete sol[i];
      }
      return false;
    }
    return put(0) ? sol : null;
  }

  /* ---------- the solver (counts solutions, bounded) ---------- */
  // puzzle: { n, white, runs: [{cells, dir, sum}] }, givens: { index: digit }. Counts solutions (up to `limit`), not counting `avoid`
  // (a known solution) if given. Returns { found, blown, other } where blown means it ran out of steps and `other` is the first
  // solution found.
  function solve(p, givens, limit, cap, avoid) {
    const cells = [];
    for (let i = 0; i < p.n * p.n; i++) if (p.white[i]) cells.push(i);
    const runOf = {};                                   // cell -> [run index, run index]
    p.runs.forEach((r, k) => r.cells.forEach((i) => { (runOf[i] = runOf[i] || []).push(k); }));
    const val = {}, used = p.runs.map(() => 0), left = p.runs.map((r) => r.cells.length), rest = p.runs.map((r) => r.sum);
    let steps = 0, found = 0, blown = false, other = null;
    function assign(i, d) { val[i] = d; for (const k of runOf[i]) { used[k] |= 1 << d; left[k]--; rest[k] -= d; } }
    function unassign(i, d) { delete val[i]; for (const k of runOf[i]) { used[k] &= ~(1 << d); left[k]++; rest[k] += d; } }
    // can the digits still free in this run make the sum that is left?
    function feasible(k) {
      const need = left[k], s = rest[k];
      if (need === 0) return s === 0;
      const free = []; for (let d = 1; d <= 9; d++) if (!(used[k] & (1 << d))) free.push(d);
      if (free.length < need) return false;
      let lo = 0, hi = 0;
      for (let t = 0; t < need; t++) { lo += free[t]; hi += free[free.length - 1 - t]; }
      return s >= lo && s <= hi;
    }
    function candidates(i) {
      const [a, b] = runOf[i];
      let m = 0;
      for (let d = 1; d <= 9; d++) {
        if ((used[a] | used[b]) & (1 << d)) continue;
        if (d > rest[a] || d > rest[b]) continue;
        if (left[a] === 1 && d !== rest[a]) continue;
        if (left[b] === 1 && d !== rest[b]) continue;
        m |= 1 << d;
      }
      return m;
    }
    function search() {
      if (blown || found >= limit) return;
      if (++steps > cap) { blown = true; return; }
      let best = -1, bestMask = 0, bestN = 10;
      for (const i of cells) {
        if (val[i] !== undefined) continue;
        const m = candidates(i), n = popcount(m);
        if (n === 0) return;
        if (n < bestN) { best = i; bestMask = m; bestN = n; if (n === 1) break; }
      }
      if (best < 0) {
        if (avoid && cells.every((i) => val[i] === avoid[i])) return;           // that is the solution we already know
        found++; if (!other) other = Object.assign({}, val);
        return;
      }
      for (let d = 1; d <= 9; d++) {
        if (!(bestMask & (1 << d))) continue;
        assign(best, d);
        if (feasible(runOf[best][0]) && feasible(runOf[best][1])) search();
        unassign(best, d);
        if (blown || found >= limit) return;
      }
    }
    for (const i of Object.keys(givens)) { const d = givens[i]; if (val[i] !== undefined || (used[runOf[i][0]] | used[runOf[i][1]]) & (1 << d)) return { found: 0, blown: false, other: null, steps: 0 }; assign(Number(i), d); }
    for (let k = 0; k < p.runs.length; k++) if (!feasible(k)) return { found: 0, blown: false, other: null, steps: 0 };
    search();
    return { found, blown, other, steps };
  }
  // the number of solutions found (up to `limit`), or -1 if the solver ran out of steps
  function countSolutions(p, givens, limit, cap) { const r = solve(p, givens, limit, cap, null); return r.blown ? -1 : r.found; }

  /* ---------- a puzzle from a seed ---------- */
  // { n, white, runs: [{cells, dir, sum}], solution: { index: digit }, givens: { index: digit }, level }
  function generate(seed, level) {
    const lv = LEVELS[level] || LEVELS.medium, rng = mulberry32(seed), n = lv.n;
    let best = null, got = 0, spent = 0;
    // build a few candidates and keep the one that needs the fewest givens to be unique (bounded by step counts)
    for (let attempt = 0; attempt < 60 && got < lv.tries && !(best && spent > lv.budget); attempt++) {
      const white = pattern(n, lv.black, rng);
      const runs = runsOf(white, n);
      const whiteCount = white.reduce((a, b) => a + b, 0);
      if (!runs.length || !valid(runs) || whiteCount < (n - 1) * (n - 1) * 0.55) continue;
      const sol = fill(white, n, runs, rng, 6000);
      if (!sol) continue;
      runs.forEach((r) => { r.sum = r.cells.reduce((a, i) => a + sol[i], 0); });
      const p = { n, white, runs, solution: sol, givens: {}, level };
      // Find a different solution, and show a square where it disagrees with ours; repeat until there is no other.
      const order = shuffled(Object.keys(sol).map(Number), rng);
      let unique = false, count = 0;
      for (let guard = 0; guard < order.length; guard++) {
        const r = solve(p, p.givens, 1, 40000, sol);
        spent += r.steps;
        if (!r.blown && r.found === 0) { unique = true; break; }
        const diff = r.other ? order.filter((i) => p.givens[i] === undefined && r.other[i] !== sol[i]) : [];
        const pick = diff.length ? diff[0] : order.find((i) => p.givens[i] === undefined);
        if (pick === undefined) break;
        p.givens[pick] = sol[pick]; count++;
        if (best && count >= best.count) break;                       // already worse than the best so far
      }
      if (!unique) continue;
      got++;
      if (!best || count < best.count) best = { p, count, order, whiteCount };
    }
    if (!best) return null;
    // easier levels show a few more squares
    const extra = Math.round(best.whiteCount * lv.extra);
    for (let e = 0, k = 0; e < extra && k < best.order.length; k++) { if (best.p.givens[best.order[k]] === undefined) { best.p.givens[best.order[k]] = best.p.solution[best.order[k]]; e++; } }
    return best.p;
  }

  // ---------- helpers for the page ----------
  // which runs contain this cell: { a: run, d: run }
  function runsAt(p, i) { const out = {}; for (const r of p.runs) if (r.cells.includes(i)) out[r.dir] = r; return out; }
  // all sets of `len` different digits that add up to `sum`
  function combos(sum, len) {
    const out = [];
    (function go(start, left, s, cur) {
      if (left === 0) { if (s === 0) out.push(cur.slice()); return; }
      for (let d = start; d <= 9; d++) { if (d > s) break; cur.push(d); go(d + 1, left - 1, s - d, cur); cur.pop(); }
    })(1, len, sum, []);
    return out;
  }
  // do the digits in a run, as far as filled, break the rules? digits: { index: digit }; returns "ok" | "dup" | "sum"
  function runStatus(run, digits) {
    const seen = new Set(); let total = 0, filled = 0;
    for (const i of run.cells) { const d = digits[i]; if (!d) continue; if (seen.has(d)) return "dup"; seen.add(d); total += d; filled++; }
    if (filled === run.cells.length) return total === run.sum ? "ok" : "sum";
    return total >= run.sum ? "sum" : "ok";
  }
  const solved = (p, digits) => Object.keys(p.solution).every((i) => digits[i] === p.solution[i]) || p.runs.every((r) => r.cells.every((i) => digits[i]) && runStatus(r, digits) === "ok");

  g.CrossSums = { LEVELS, generate, countSolutions, runsAt, combos, runStatus, solved, mulberry32 };
})(globalThis);
