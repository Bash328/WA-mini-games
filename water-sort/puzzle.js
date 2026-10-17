/* ============================================================
   water-sort/puzzle.js — the puzzles and the rules of Water Sort.

   A plain script that sets globalThis.WaterSort (the page loads it with a <script>
   tag, the test imports it for the same effect).

   Tubes hold up to 4 layers of coloured water, listed bottom to top. Pour from one
   tube into another: the top colour of the first must match the top colour of the
   second (or the second is empty), and there must be room. Every layer of that
   colour on top of the first tube pours at once, as many as fit. Sort the water until
   every tube is empty or holds four layers of a single colour.

   A puzzle is a seeded random deal that a bounded search has proved solvable; the
   same seed gives the same puzzle on every device. The search is bounded by node
   counts (never the clock), and the same search gives the page its hints.
   ============================================================ */
(function (g) {
  "use strict";

  const CAP = 4;

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

  // colours, and how many empty tubes come with them
  const LEVELS = { easy: { colors: 5, empty: 2 }, medium: { colors: 8, empty: 2 }, hard: { colors: 12, empty: 2 } };

  const top = (t) => (t.length ? t[t.length - 1] : -1);
  const runLen = (t) => { let k = 0; while (k < t.length && t[t.length - 1 - k] === t[t.length - 1]) k++; return k; };
  const isDone = (t) => t.length === 0 || (t.length === CAP && t.every((c) => c === t[0]));
  const solved = (tubes) => tubes.every(isDone);
  const clone = (tubes) => tubes.map((t) => t.slice());
  const key = (tubes) => tubes.map((t) => t.join(",")).sort().join("|");

  // every sensible pour: { from, to, n } (pouring a finished tube, or a one-colour tube into an empty one, only wastes moves)
  function moves(tubes) {
    const out = [];
    for (let i = 0; i < tubes.length; i++) {
      const a = tubes[i];
      if (!a.length || isDone(a)) continue;
      const run = runLen(a), uniform = run === a.length;
      for (let j = 0; j < tubes.length; j++) {
        if (i === j) continue;
        const b = tubes[j], space = CAP - b.length;
        if (space <= 0) continue;
        if (b.length === 0 ? uniform : top(b) !== top(a)) continue;
        out.push({ from: i, to: j, n: Math.min(run, space) });
      }
    }
    return out;
  }
  // can this pour be made? returns it, or null
  function legal(tubes, from, to) {
    if (from === to || !tubes[from] || !tubes[to] || !tubes[from].length) return null;
    const a = tubes[from], b = tubes[to], space = CAP - b.length;
    if (space <= 0 || (b.length && top(b) !== top(a))) return null;
    return { from, to, n: Math.min(runLen(a), space) };
  }
  function pour(tubes, m) {
    const out = clone(tubes), c = top(out[m.from]);
    for (let k = 0; k < m.n; k++) { out[m.from].pop(); out[m.to].push(c); }
    return out;
  }

  // Depth-first search for a way to sort the tubes: the list of pours, or null (none found within `cap` nodes).
  function solve(tubes, cap) {
    const seen = new Set();
    let nodes = 0;
    function dfs(state, path) {
      if (solved(state)) return path;
      if (++nodes > cap) return null;
      const k = key(state);
      if (seen.has(k)) return null;
      seen.add(k);
      // try the most useful pours first: onto the same colour, finishing a tube, using bigger pours
      const ms = moves(state).map((m) => {
        const dest = state[m.to], full = dest.length + m.n === CAP && (dest.length === 0 || dest.every((c) => c === top(state[m.from])));
        return { m, v: (dest.length ? 10 : 0) + (full ? 20 : 0) + m.n + (state[m.from].length === m.n ? 3 : 0) };
      }).sort((a, b) => b.v - a.v);
      for (const { m } of ms) {
        const r = dfs(pour(state, m), path.concat([m]));
        if (r) return r;
        if (nodes > cap) return null;
      }
      return null;
    }
    return dfs(tubes, []);
  }

  // a puzzle from a seed: { tubes, solution: [pours] }
  function generate(seed, level) {
    const lv = LEVELS[level] || LEVELS.medium, rng = mulberry32(seed);
    for (let attempt = 0; attempt < 40; attempt++) {
      const units = [];
      for (let c = 0; c < lv.colors; c++) for (let k = 0; k < CAP; k++) units.push(c);
      const deal = shuffled(units, rng), tubes = [];
      for (let t = 0; t < lv.colors; t++) tubes.push(deal.slice(t * CAP, (t + 1) * CAP));
      for (let e = 0; e < lv.empty; e++) tubes.push([]);
      if (tubes.some((t) => t.length === CAP && isDone(t))) continue;                // no tube ready-made
      const sol = solve(tubes, 60000);
      if (sol) return { tubes, solution: sol };
    }
    return null;
  }

  g.WaterSort = { CAP, LEVELS, moves, legal, pour, solved, solve, generate, clone, key, isDone, top, mulberry32 };
})(globalThis);
