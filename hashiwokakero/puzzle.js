/* ============================================================
   hashiwokakero/puzzle.js — the puzzles and the rules of Hashiwokakero (Bridges).

   A plain script that sets globalThis.HashiPuzzle (the page loads it with a <script>
   tag, the test imports it for the same effect).

   THE GAME: every circle is an island; the number on it says how many bridges meet
   there (1 to 8). Bridges run horizontally or vertically between two islands that are
   in the same row or column with no other island between them. A pair may be joined by
   one bridge or two, bridges never cross, and every island must end up connected.

   Everything is built from a seed and bounded step counts only (never the clock), so
   the daily puzzle is identical on every device. Generation:
     1. pick island positions on every other square of an n-by-n grid,
     2. grow a random connected, crossing-free set of bridges over those islands
        (a random spanning tree, then a few extra bridges), and read the numbers off it,
     3. ask the solver to count the solutions. Only a board with exactly one solution is
        kept; an ambiguous or unverifiable board is thrown away and another is tried.
   The solver is the same one the page uses for Check, and its step count (not a clock)
   bounds every search.
   ============================================================ */
(function (g) {
  "use strict";

  const GAME = "hashiwokakero";
  const MAX_BRIDGES = 2;          // per pair of islands
  const MAX_NUMBER = 8;           // most bridges that may meet at an island

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
  // FNV-1a, the same hash Gamekit.dailySeed uses, so the page can use either
  function hashStr(s) {
    let h = 2166136261 >>> 0;
    s = String(s);
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  // n: the square grid of cells; islands: how many; extras: how many bridges beyond a tree
  const LEVELS = {
    easy:   { n: 5, islands: 7,  extras: [2, 4], attempts: 900, cap: 60000,  budget: 2500000 },
    medium: { n: 7, islands: 11, extras: [3, 6], attempts: 900, cap: 120000, budget: 3500000 },
    hard:   { n: 9, islands: 16, extras: [5, 9], attempts: 700, cap: 200000, budget: 4500000 },
  };

  /* ---------- the board ---------- */
  // islands: [{ r, c, num }]; pairs: [{ a, b, dir: "h"|"v", cross: [pair indexes] }]
  // Only islands in the same row/column with nothing between them can be joined.
  function makeBoard(n, coords) {
    const islands = coords.map(([r, c]) => ({ r: r, c: c, num: 0 }));
    const pairs = [], rows = new Map(), cols = new Map();
    islands.forEach((is, i) => {
      if (!rows.has(is.r)) rows.set(is.r, []);
      if (!cols.has(is.c)) cols.set(is.c, []);
      rows.get(is.r).push(i);
      cols.get(is.c).push(i);
    });
    const addRun = (ids, dir) => {
      const list = ids.slice().sort((x, y) => (dir === "h" ? islands[x].c - islands[y].c : islands[x].r - islands[y].r));
      for (let k = 0; k + 1 < list.length; k++) pairs.push({ a: list[k], b: list[k + 1], dir: dir, cross: [] });
    };
    rows.forEach((ids) => addRun(ids, "h"));
    cols.forEach((ids) => addRun(ids, "v"));
    // two bridges cross when one is horizontal and the other vertical and each runs
    // through a square strictly between the other's two islands
    for (let i = 0; i < pairs.length; i++) {
      const p = pairs[i];
      for (let j = i + 1; j < pairs.length; j++) {
        const q = pairs[j];
        if (p.dir === q.dir) continue;
        const h = p.dir === "h" ? p : q, v = p.dir === "h" ? q : p;
        const hr = islands[h.a].r, hc1 = Math.min(islands[h.a].c, islands[h.b].c), hc2 = Math.max(islands[h.a].c, islands[h.b].c);
        const vc = islands[v.a].c, vr1 = Math.min(islands[v.a].r, islands[v.b].r), vr2 = Math.max(islands[v.a].r, islands[v.b].r);
        if (hr > vr1 && hr < vr2 && vc > hc1 && vc < hc2) { p.cross.push(j); q.cross.push(i); }
      }
    }
    return { n: n, islands: islands, pairs: pairs, numbers: islands.map((is) => is.num) };
  }

  // island positions: every other square of the grid, in a seeded random order
  function pickPositions(n, count, rng) {
    const spots = [];
    for (let r = 0; r < n; r += 2) for (let c = 0; c < n; c += 2) spots.push([r, c]);
    return shuffled(spots, rng).slice(0, Math.min(count, spots.length));
  }

  // grow a random connected, crossing-free solution, then read the island numbers off it
  function randomSolution(p, rng, extrasMin, extrasMax) {
    const nI = p.islands.length, nP = p.pairs.length;
    const val = new Uint8Array(nP), deg = new Uint8Array(nI), inTree = new Uint8Array(nI);
    const canAdd = (k) => {
      if (p.pairs[k].cross.some((q) => val[q] > 0)) return false;
      return true;
    };
    const start = Math.floor(rng() * nI);
    inTree[start] = 1;
    let size = 1;
    while (size < nI) {
      const cand = [];
      for (let k = 0; k < nP; k++) {
        if (val[k] !== 0) continue;
        const pr = p.pairs[k];
        if (inTree[pr.a] === inTree[pr.b]) continue;          // both inside, or both outside
        if (!canAdd(k)) continue;
        cand.push(k);
      }
      if (!cand.length) return null;                           // this layout cannot be joined
      const k = cand[Math.floor(rng() * cand.length)];
      const pr = p.pairs[k];
      val[k] = 1; deg[pr.a]++; deg[pr.b]++;
      inTree[inTree[pr.a] ? pr.b : pr.a] = 1;
      size++;
    }
    const extras = extrasMin + Math.floor(rng() * (extrasMax - extrasMin + 1));
    for (let t = 0; t < extras; t++) {
      const cand = [];
      for (let k = 0; k < nP; k++) {
        const pr = p.pairs[k];
        if (val[k] >= MAX_BRIDGES || deg[pr.a] >= MAX_NUMBER || deg[pr.b] >= MAX_NUMBER) continue;
        if (!canAdd(k)) continue;
        cand.push(k);
      }
      if (!cand.length) break;
      const k = cand[Math.floor(rng() * cand.length)];
      const pr = p.pairs[k];
      val[k]++; deg[pr.a]++; deg[pr.b]++;
    }
    for (let i = 0; i < nI; i++) {
      if (deg[i] < 1 || deg[i] > MAX_NUMBER) return null;
      p.islands[i].num = deg[i];
    }
    p.numbers = p.islands.map((is) => is.num);
    return Array.from(val);
  }

  /* ---------- the solver ---------- */
  // Counts the solutions (up to limit) of a board, respecting the numbers, "at most two
  // bridges" and "no crossing". Bounded by `cap` steps; returns
  // { found, blown, solution, steps }. `blown` means the search ran out of steps, so a
  // count of 0 says nothing.
  function solveAll(p, limit, cap) {
    limit = Math.max(1, limit || 2);
    cap = cap || 120000;
    const nI = p.islands.length, nP = p.pairs.length;
    const inc = Array.from({ length: nI }, () => []);
    for (let k = 0; k < nP; k++) { inc[p.pairs[k].a].push(k); inc[p.pairs[k].b].push(k); }
    for (const pr of p.pairs) if (!pr.cross) pr.cross = [];
    const val = new Array(nP).fill(-1), on = new Uint8Array(nI);
    let steps = 0, found = 0, blown = false, first = null;

    const empty = { found: 0, blown: false, solution: null, steps: 0 };
    if (!nI) return empty;
    for (let i = 0; i < nI; i++) {
      if (!(p.islands[i].num >= 0) || p.islands[i].num > MAX_BRIDGES * inc[i].length) return empty;
    }

    // a pair set to a positive count may not cross a pair that already has bridges
    const crossesPositive = (k) => {
      for (const q of p.pairs[k].cross) if (val[q] > 0) return true;
      return false;
    };
    // can every island that is not assigned yet still reach its number?
    const feasible = () => {
      for (let i = 0; i < nI; i++) {
        if (on[i]) continue;
        let fixed = 0, free = 0;
        for (const k of inc[i]) { if (val[k] < 0) free++; else fixed += val[k]; }
        const need = p.islands[i].num - fixed;
        if (need < 0 || need > MAX_BRIDGES * free) return false;
      }
      return true;
    };
    const connectedNow = () => {
      const parent = new Int32Array(nI);
      for (let i = 0; i < nI; i++) parent[i] = i;
      const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
      for (let k = 0; k < nP; k++) {
        if (val[k] <= 0) continue;
        const ra = find(p.pairs[k].a), rb = find(p.pairs[k].b);
        if (ra !== rb) parent[ra] = rb;
      }
      const root = find(0);
      for (let i = 1; i < nI; i++) if (find(i) !== root) return false;
      return true;
    };

    function rec() {
      if (found >= limit) return;
      if (++steps > cap) { blown = true; return; }
      // the most constrained island first: fewest pairs still open, then the biggest number
      let pick = -1, pickFree = 99, pickNum = -1;
      for (let i = 0; i < nI; i++) {
        if (on[i]) continue;
        let free = 0;
        for (const k of inc[i]) if (val[k] < 0) free++;
        if (free < pickFree || (free === pickFree && p.islands[i].num > pickNum)) { pick = i; pickFree = free; pickNum = p.islands[i].num; }
      }
      if (pick < 0) {
        if (!connectedNow()) return;
        if (!first) first = val.slice();
        found++;
        return;
      }
      let fixed = 0;
      const free = [];
      for (const k of inc[pick]) { if (val[k] < 0) free.push(k); else fixed += val[k]; }
      const need = p.islands[pick].num - fixed;
      if (need < 0) return;
      const chosen = new Array(free.length);
      function go(j, rem) {
        if (found >= limit || blown) return;
        if (j === free.length) {
          if (rem !== 0) return;
          on[pick] = 1;
          for (let t = 0; t < free.length; t++) val[free[t]] = chosen[t];
          if (feasible()) rec();
          for (let t = 0; t < free.length; t++) val[free[t]] = -1;
          on[pick] = 0;
          return;
        }
        for (let v = 0; v <= MAX_BRIDGES; v++) {
          if (v > rem) break;
          if (v > 0) {
            if (crossesPositive(free[j])) continue;
            let clash = false;
            for (let t = 0; t < j; t++) if (chosen[t] > 0 && p.pairs[free[j]].cross.indexOf(free[t]) >= 0) { clash = true; break; }
            if (clash) continue;
          }
          chosen[j] = v;
          go(j + 1, rem - v);
        }
      }
      go(0, need);
    }

    rec();
    return { found: found, blown: blown, solution: first, steps: steps };
  }

  function countSolutions(p, limit, cap) {
    const r = solveAll(p, limit || 2, cap);
    return r.blown ? -1 : r.found;
  }
  // the first solution found, or null
  function solve(p, cap) {
    const r = solveAll(p, 1, cap);
    return r.solution;
  }

  /* ---------- checking a player's board ---------- */
  function degreeOf(p, counts) {
    const deg = new Array(p.islands.length).fill(0);
    for (let k = 0; k < p.pairs.length; k++) {
      const v = counts[k] || 0;
      if (v > 0) { deg[p.pairs[k].a] += v; deg[p.pairs[k].b] += v; }
    }
    return deg;
  }
  function isConnected(p, counts) {
    const nI = p.islands.length;
    if (!nI) return false;
    const parent = new Int32Array(nI);
    for (let i = 0; i < nI; i++) parent[i] = i;
    const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
    for (let k = 0; k < p.pairs.length; k++) {
      if ((counts[k] || 0) <= 0) continue;
      const ra = find(p.pairs[k].a), rb = find(p.pairs[k].b);
      if (ra !== rb) parent[ra] = rb;
    }
    const root = find(0);
    for (let i = 1; i < nI; i++) if (find(i) !== root) return false;
    return true;
  }
  // everything wrong with a set of bridge counts: which islands have too many / too few,
  // which pairs cross, and whether all the islands are joined up.
  function check(p, counts) {
    const degree = degreeOf(p, counts);
    const over = [], under = [], done = [];
    for (let i = 0; i < p.islands.length; i++) {
      if (degree[i] > p.islands[i].num) over.push(i);
      else if (degree[i] < p.islands[i].num) under.push(i);
      else done.push(i);
    }
    const crossed = [];
    for (let k = 0; k < p.pairs.length; k++) {
      if ((counts[k] || 0) <= 0) continue;
      for (const q of p.pairs[k].cross) if (q > k && (counts[q] || 0) > 0) crossed.push([k, q]);
    }
    const connected = isConnected(p, counts);
    return {
      degree: degree,
      over: over,
      under: under,
      done: done,
      crossed: crossed,
      connected: connected,
      solved: over.length === 0 && under.length === 0 && crossed.length === 0 && connected && p.islands.length > 0,
    };
  }

  /* ---------- look-ups for the page ---------- */
  // the index of the pair joining two islands, or -1 if they are not neighbours
  function pairBetween(p, a, b) {
    for (let k = 0; k < p.pairs.length; k++) {
      const pr = p.pairs[k];
      if ((pr.a === a && pr.b === b) || (pr.a === b && pr.b === a)) return k;
    }
    return -1;
  }
  // island indexes that can be joined to this one
  function neighbours(p, i) {
    const out = [];
    for (const pr of p.pairs) {
      if (pr.a === i) out.push(pr.b);
      else if (pr.b === i) out.push(pr.a);
    }
    return out;
  }

  /* ---------- a puzzle from a seed ---------- */
  // { n, level, islands, pairs, numbers, solution: [0|1|2 per pair] }
  function generate(seed, level) {
    const lv = LEVELS[level] || LEVELS.medium;
    const rng = mulberry32(seed >>> 0);
    const extras = lv.extras;
    let spent = 0, attempts = 0;
    while (attempts < lv.attempts && spent < lv.budget) {
      attempts++;
      const p = makeBoard(lv.n, pickPositions(lv.n, lv.islands, rng));
      p.level = level;
      // a couple of different bridge sets on one layout before moving on
      for (let tries = 0; tries < 3; tries++) {
        const sol = randomSolution(p, rng, extras[0], extras[1]);
        if (!sol) break;
        const c = check(p, sol);
        if (!c.solved) continue;                               // a broken candidate is never kept
        const r = solveAll(p, 2, lv.cap);
        spent += r.steps || 0;
        if (!r.blown && r.found === 1) {
          p.solution = sol;
          p.numbers = p.islands.map((is) => is.num);
          return p;
        }
        if (spent >= lv.budget) break;
      }
    }
    return null;                                               // never guess: no unique board was found
  }

  /* ---------- the daily puzzle ---------- */
  // UTC date, like Gamekit.dailySeed, so everyone gets the same board on the same day
  const todayISO = () => new Date().toISOString().slice(0, 10);
  function dailySeed(level, isoDate) {
    return hashStr((isoDate || todayISO()) + "|" + (LEVELS[level] ? level : "medium") + "|" + GAME);
  }
  function generateDaily(level, isoDate) {
    return generate(dailySeed(level, isoDate), level);
  }

  g.HashiPuzzle = {
    GAME,
    LEVELS,
    MAX_BRIDGES,
    MAX_NUMBER,
    makeBoard,
    generate,
    generateDaily,
    dailySeed,
    solveAll,
    solve,
    countSolutions,
    check,
    degreeOf,
    isConnected,
    pairBetween,
    neighbours,
    mulberry32,
    hashStr,
  };
})(globalThis);
