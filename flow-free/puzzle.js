/* ============================================================
   flow-free/puzzle.js — the puzzles, the checker and the hints of Flow Free.

   A plain script that sets globalThis.FlowPuzzle (the page loads it with a
   <script> tag, the test imports it for the same effect).

   A puzzle is a square grid with coloured pairs of endpoints. The answer is
   one path per pair, joining the two ends, and together the paths fill every
   cell exactly once, so no path crosses another. Puzzles are built from a
   seed: the generator grows a random partition of the whole grid into
   disjoint paths, keeps only the two ends of each path, and then asks the
   solver whether the stored answer is the only one (when a bounded search can
   prove it). Every step is bounded by a count, never by the clock, so the
   same seed gives the same puzzle on every device and a bad seed can never
   hang the page. The same solver gives the page its hints.
   ============================================================ */
(function (g) {
  "use strict";

  // The three sizes. Every cell is used, so a board has n × n cells and a
  // handful of pairs.
  const LEVELS = {
    easy:   { n: 6, flows: 5, label: "Easy · 6×6" },
    medium: { n: 7, flows: 6, label: "Med · 7×7" },
    hard:   { n: 8, flows: 8, label: "Hard · 8×8" },
  };

  // Bright, well separated colours for the pipes (the page draws them; the
  // puzzle only names the flow, not the colour, so the game can pick).
  const COLOURS = ["#ff4d6d", "#2ec4ff", "#ffd23f", "#45e06f", "#b06bff", "#ff8a3d", "#ff5fd2", "#6f7bff"];

  /* ---------- deterministic randomness ---------- */
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
  function hashStr(s) {
    let h = 2166136261 >>> 0;
    s = String(s);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
  function shuffled(arr, rng) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }

  /* ---------- grid helpers ---------- */
  function neighbours(n, i) {
    const r = Math.floor(i / n), c = i % n, out = [];
    if (r > 0) out.push(i - n);
    if (r < n - 1) out.push(i + n);
    if (c > 0) out.push(i - 1);
    if (c < n - 1) out.push(i + 1);
    return out;
  }
  function adjacent(n, a, b) {
    if (a < 0 || b < 0) return false;
    const ar = Math.floor(a / n), ac = a % n, br = Math.floor(b / n), bc = b % n;
    return Math.abs(ar - br) + Math.abs(ac - bc) === 1;
  }
  function freeDegree(owner, n, cell) {
    let d = 0;
    for (const x of neighbours(n, cell)) if (owner[x] < 0) d++;
    return d;
  }

  /* ---------- drawing a full-grid partition ----------
     Grow one path at a time, like a pencil that never lifts until it is
     stuck. A path may not run alongside itself (a new cell may touch at most
     one cell of its own path), which keeps the pipes thin and makes "swap the
     two tails" answers less common. A move that would trap an empty cell with
     no empty neighbour at all is refused. The walk is bounded by its length
     cap, so a bad draw is abandoned rather than running forever. */
  function sequentialPartition(n, minK, maxK, rng) {
    const N = n * n;
    const owner = new Int8Array(N).fill(-1);
    const paths = [];
    let free = N;
    const cap = Math.max(5, Math.ceil(N / minK) * 2);

    function isolatedFree() {
      for (let i = 0; i < N; i++) {
        if (owner[i] !== -1) continue;
        let d = 0;
        for (const x of neighbours(n, i)) if (owner[x] === -1) d++;
        if (d === 0) return true;
      }
      return false;
    }

    while (free > 0) {
      if (paths.length >= maxK) return null;
      const id = paths.length;
      // Start where the fewest free neighbours are, so lonely cells are used first.
      let start = -1, best = 99, ties = 0;
      for (let i = 0; i < N; i++) {
        if (owner[i] !== -1) continue;
        const d = freeDegree(owner, n, i);
        if (d < best) { best = d; start = i; ties = 1; }
        else if (d === best && rng() * ++ties < 1) start = i;
      }
      if (start < 0) return null;
      const path = [start];
      owner[start] = id;
      free--;

      while (path.length < cap) {
        const tail = path[path.length - 1];
        let cand = [];
        for (const x of neighbours(n, tail)) {
          if (owner[x] !== -1) continue;
          let same = 0;
          for (const y of neighbours(n, x)) if (owner[y] === id) same++;
          if (same <= 1) cand.push(x);
        }
        if (!cand.length) break;
        let taken = false;
        while (cand.length) {
          const at = Math.floor(rng() * cand.length);
          const x = cand.splice(at, 1)[0];
          owner[x] = id; path.push(x); free--;
          if (!isolatedFree()) { taken = true; break; }
          owner[x] = -1; path.pop(); free++;
        }
        if (!taken) break;
      }
      if (path.length < 2) return null;
      paths.push(path);
    }
    if (paths.length < minK) return null;
    return paths;
  }

  // Join paths whose ends touch until only `target` paths are left. A join
  // keeps the whole grid covered by the same cells, but gives one longer pipe:
  // it is how a partition with many short paths becomes a board with a
  // readable number of pairs. The other two ends become the new pair.
  function mergeTo(parts, target, n, rng) {
    const paths = parts.map((p) => p.slice());
    let guard = 0;
    while (paths.length > target) {
      if (++guard > 400) return null;
      const pairs = [];
      for (let i = 0; i < paths.length; i++) {
        for (let j = i + 1; j < paths.length; j++) {
          const a = paths[i], b = paths[j];
          if (adjacent(n, a[a.length - 1], b[0])) pairs.push({ i: i, j: j, ra: false, rb: false, w: a.length + b.length });
          if (adjacent(n, a[a.length - 1], b[b.length - 1])) pairs.push({ i: i, j: j, ra: false, rb: true, w: a.length + b.length });
          if (adjacent(n, a[0], b[0])) pairs.push({ i: i, j: j, ra: true, rb: false, w: a.length + b.length });
          if (adjacent(n, a[0], b[b.length - 1])) pairs.push({ i: i, j: j, ra: true, rb: true, w: a.length + b.length });
        }
      }
      if (!pairs.length) return null;
      // Shortest two first: it keeps the pipes balanced instead of growing one blob.
      let best = Infinity;
      for (const p of pairs) if (p.w < best) best = p.w;
      const pickFrom = pairs.filter((p) => p.w <= best + 2);
      const pick = pickFrom[Math.floor(rng() * pickFrom.length)];
      const a = pick.ra ? paths[pick.i].slice().reverse() : paths[pick.i];
      const b = pick.rb ? paths[pick.j].slice().reverse() : paths[pick.j];
      paths[pick.i] = a.concat(b);
      paths.splice(pick.j, 1);
    }
    return paths;
  }

  // The last resort: a boustrophedon path cut into k arcs. Always a valid
  // full-grid partition, used only if every random attempt failed.
  function serpentinePartition(n, k) {
    const path = [];
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) path.push(r * n + (r % 2 === 0 ? c : n - 1 - c));
    }
    const cuts = [0];
    for (let i = 1; i < k; i++) cuts.push(Math.round(i * path.length / k));
    cuts.push(path.length);
    const out = [];
    for (let i = 0; i < k; i++) {
      const part = path.slice(cuts[i], cuts[i + 1]);
      if (part.length < 2) return null;
      out.push(part);
    }
    return out;
  }

  /* ---------- a puzzle from a partition ---------- */
  function makePuzzle(seed, levelKey, lv, parts, rng) {
    const n = lv.n, N = n * n;
    const palette = shuffled(COLOURS, rng);
    const flows = parts.map((path, id) => ({
      id: id,
      a: path[0],
      b: path[path.length - 1],
      colour: palette[id % palette.length],
    }));
    const puzzle = {
      game: "flow-free",
      level: levelKey,
      seed: seed >>> 0,
      n: n,
      flows: flows,
      endpoints: new Array(N).fill(-1),
      solution: parts.map((p) => p.slice()),
    };
    for (const f of flows) { puzzle.endpoints[f.a] = f.id; puzzle.endpoints[f.b] = f.id; }
    return puzzle;
  }

  /* ---------- checker ----------
     Every path must join its own pair, step between adjacent cells, and no
     cell may be used twice; every cell of the grid must be used. */
  function check(puzzle, paths) {
    const n = puzzle.n, N = n * n, K = puzzle.flows.length;
    const used = new Uint8Array(N), errors = [];
    if (!Array.isArray(paths) || paths.length !== K) {
      return { ok: false, filled: 0, total: N, errors: ["wrong number of paths"] };
    }
    for (let f = 0; f < K; f++) {
      const fl = puzzle.flows[f], p = paths[f];
      if (!Array.isArray(p) || p.length < 2) { errors.push("pair " + (f + 1) + " is not joined"); continue; }
      const startsAtA = p[0] === fl.a && p[p.length - 1] === fl.b;
      const startsAtB = p[0] === fl.b && p[p.length - 1] === fl.a;
      if (!startsAtA && !startsAtB) { errors.push("pair " + (f + 1) + " does not join its own dots"); continue; }
      let bad = false;
      for (let i = 0; i < p.length; i++) {
        const c = p[i];
        if (!Number.isInteger(c) || c < 0 || c >= N) { errors.push("pair " + (f + 1) + " leaves the board"); bad = true; break; }
        if (i > 0 && !adjacent(n, p[i - 1], c)) { errors.push("pair " + (f + 1) + " jumps a cell"); bad = true; break; }
        if (puzzle.endpoints[c] >= 0 && puzzle.endpoints[c] !== f) { errors.push("pair " + (f + 1) + " crosses a dot"); bad = true; break; }
        if (used[c]) { errors.push("two paths meet at one cell"); bad = true; break; }
        used[c] = 1;
      }
      if (bad) continue;
    }
    let filled = 0;
    for (let i = 0; i < N; i++) if (used[i]) filled++;
    if (filled !== N) errors.push((N - filled) + " cells are empty");
    return { ok: errors.length === 0 && filled === N, filled: filled, total: N, errors: errors };
  }
  function checkSolution(puzzle) { return check(puzzle, puzzle.solution); }

  function isFlowDone(puzzle, f, path) {
    if (!Array.isArray(path) || path.length < 2) return false;
    const fl = puzzle.flows[f];
    if (!((path[0] === fl.a && path[path.length - 1] === fl.b) || (path[0] === fl.b && path[path.length - 1] === fl.a))) return false;
    const seen = new Set();
    for (let i = 0; i < path.length; i++) {
      const c = path[i];
      if (!Number.isInteger(c) || c < 0 || c >= puzzle.n * puzzle.n) return false;
      if (seen.has(c)) return false;
      seen.add(c);
      if (i > 0 && !adjacent(puzzle.n, path[i - 1], c)) return false;
      if (puzzle.endpoints[c] >= 0 && puzzle.endpoints[c] !== f) return false;
    }
    return true;
  }
  function emptyPaths(puzzle) { return puzzle.flows.map(() => []); }
  function clonePaths(paths) { return paths.map((p) => (Array.isArray(p) ? p.slice() : [])); }

  // Is a part-drawn board plausible? Used when a game is restored after a refresh.
  function partialOk(puzzle, paths) {
    const n = puzzle.n, N = n * n, K = puzzle.flows.length;
    if (!Array.isArray(paths) || paths.length !== K) return false;
    const used = new Uint8Array(N);
    for (let f = 0; f < K; f++) {
      const p = paths[f];
      if (!Array.isArray(p)) return false;
      if (!p.length) continue;
      const fl = puzzle.flows[f];
      if (p.length && p[0] !== fl.a && p[0] !== fl.b) return false;   // a path must start at one of its dots
      for (let i = 0; i < p.length; i++) {
        const c = p[i];
        if (!Number.isInteger(c) || c < 0 || c >= N) return false;
        if (i > 0 && !adjacent(n, p[i - 1], c)) return false;
        if (puzzle.endpoints[c] >= 0 && puzzle.endpoints[c] !== f) return false;
        if (used[c]) return false;
        used[c] = 1;
      }
    }
    return true;
  }

  /* ---------- solver ----------
     Fill the pairs one at a time. A path starts on one dot and grows through
     free cells towards its mate. Pruning, all of it safe:
       - a free cell with fewer than two places a pipe could enter it can
         never be part of a path, because every free cell is a middle cell;
       - a free region with no dot (or drawing head) at its edge can never be
         filled, because a path needs two ends;
       - the head and its mate must still be connected through free cells, and
         so must every pair not yet drawn (free cells that cannot reach the
         other dot can never join it).
     The search is bounded by node count; it never looks at the clock. */
  function search(puzzle, limit, budget) {
    const n = puzzle.n, N = n * n, flows = puzzle.flows, K = flows.length;
    const nb = [];
    for (let i = 0; i < N; i++) nb.push(neighbours(n, i));
    const ep = new Int8Array(N).fill(-1);
    const owner = new Int8Array(N).fill(-1);
    for (let f = 0; f < K; f++) {
      const fl = flows[f];
      ep[fl.a] = f; ep[fl.b] = f;
      owner[fl.a] = f; owner[fl.b] = f;
    }
    const comp = new Int8Array(N);
    const hasTerm = new Uint8Array(N + 2);
    const q = [];
    const done = new Array(K);
    let nodes = 0, count = 0, aborted = false, stop = false, first = null;

    function filled() {
      for (let i = 0; i < N; i++) if (owner[i] < 0) return false;
      return true;
    }

    function compMask(cell) {
      let mask = 0;
      for (const x of nb[cell]) {
        if (owner[x] === -1) { const c = comp[x]; if (c > 0) { hasTerm[c] = 1; mask |= 1 << (c - 1); } }
      }
      return mask;
    }

    function feasible(f, head) {
      const b = flows[f].b;
      comp.fill(0);
      hasTerm.fill(0);
      let comps = 0;
      for (let i = 0; i < N; i++) {
        if (owner[i] !== -1 || comp[i] !== 0) continue;
        comps++;
        comp[i] = comps;
        q.length = 0;
        q.push(i);
        for (let qi = 0; qi < q.length; qi++) {
          const c = q[qi];
          let avail = 0;
          for (const x of nb[c]) {
            if (owner[x] === -1) {
              avail++;
              if (comp[x] === 0) { comp[x] = comps; q.push(x); }
            } else if (x === head || x === b) avail++;
            else if (ep[x] === owner[x] && owner[x] > f) avail++;      // a dot of a pair not started yet
          }
          if (avail < 2) return false;
        }
      }
      const headMask = compMask(head), endMask = compMask(b);
      if (!adjacent(n, head, b) && !(headMask & endMask)) return false;
      for (let g = f + 1; g < K; g++) {
        const ma = compMask(flows[g].a), mb = compMask(flows[g].b);
        if (!adjacent(n, flows[g].a, flows[g].b) && !(ma & mb)) return false;
      }
      for (let c = 1; c <= comps; c++) if (!hasTerm[c]) return false;  // a region no pipe can reach
      return true;
    }

    function finish(f, path) {
      done[f] = path;
      if (f + 1 === K) {
        if (!filled()) return;
        count++;
        if (!first) first = done.map((p) => p.slice());
        if (count >= limit) stop = true;
        return;
      }
      const next = flows[f + 1];
      extend(f + 1, next.a, [next.a]);
    }

    function extend(f, head, path) {
      if (stop) return;
      if (++nodes > budget) { aborted = true; stop = true; return; }
      if (!feasible(f, head)) return;
      const b = flows[f].b;
      for (const x of nb[head]) {
        if (stop) return;
        if (x === b) {
          finish(f, path.concat([b]));
        } else if (owner[x] === -1) {
          owner[x] = f;
          path.push(x);
          extend(f, x, path);
          path.pop();
          owner[x] = -1;
        }
      }
    }

    if (K > 0 && !stop) extend(0, flows[0].a, [flows[0].a]);
    return { count: count, aborted: aborted, nodes: nodes, solution: first };
  }

  function countSolutions(puzzle, limit, budget) {
    const r = search(puzzle, limit || 2, budget || 60000);
    return { count: r.count, aborted: r.aborted, nodes: r.nodes };
  }
  function solve(puzzle, budget) {
    const r = search(puzzle, 1, budget || 60000);
    return r.solution || null;
  }

  /* ---------- hints ----------
     Show the stored route for a pair that is not joined yet. If every pair is
     joined but cells are still empty (a complete path that wandered), show the
     stored route of the first pair that differs. */
  function hint(puzzle, paths) {
    const K = puzzle.flows.length;
    const stored = puzzle.solution;
    if (!Array.isArray(paths)) return { flow: 0, path: stored[0].slice() };
    const same = (a, b) => Array.isArray(a) && a.length === b.length && a.every((v, i) => v === b[i]);
    for (let f = 0; f < K; f++) {
      const p = paths[f];
      if (!isFlowDone(puzzle, f, p)) return { flow: f, path: stored[f].slice() };
    }
    for (let f = 0; f < K; f++) {
      if (!same(paths[f], stored[f]) && !same(paths[f], stored[f].slice().reverse())) return { flow: f, path: stored[f].slice() };
    }
    return null;
  }

  /* ---------- generation ----------
     Try random partitions until one has a good shape and, when the bounded
     search can settle it, exactly one answer. "Unproven" (the search ran out
     of its node budget) is preferred to a board the search proved ambiguous;
     the deterministic serpentine cut is the final, always-valid fallback. */
  const ATTEMPTS = { easy: 120, medium: 120, hard: 120 };
  const BUDGET = { easy: 6000, medium: 10000, hard: 16000 };

  function tooTrivial(puzzle) {
    const lens = puzzle.solution.map((p) => p.length);
    const tiny = lens.filter((l) => l <= 2).length;
    if (tiny === lens.length) return true;                 // every pair side by side
    if (lens.length >= 4 && tiny > lens.length - 2) return true;
    const longest = Math.max.apply(null, lens);
    if (longest > puzzle.n * puzzle.n * 0.55) return true;  // one pipe swallows the board
    return false;
  }

  function generate(seed, levelKey) {
    seed = seed >>> 0;
    const key = LEVELS[levelKey] ? levelKey : "medium";
    const lv = LEVELS[key];
    const rng = mulberry32(seed);
    let unproven = null, ambiguous = null;
    for (let attempt = 0; attempt < ATTEMPTS[key]; attempt++) {
      const many = sequentialPartition(lv.n, lv.flows + 1, 14, rng);
      if (!many) continue;
      const parts = mergeTo(many, lv.flows, lv.n, rng);
      if (!parts) continue;
      const puzzle = makePuzzle(seed, key, lv, parts, rng);
      if (!checkSolution(puzzle).ok) continue;
      if (tooTrivial(puzzle)) continue;
      const res = search(puzzle, 2, BUDGET[key]);
      if (res.aborted) { if (!unproven) unproven = puzzle; }
      else if (res.count === 1) return puzzle;
      else if (res.count >= 2) { if (!ambiguous) ambiguous = puzzle; }
    }
    if (unproven) return unproven;
    if (ambiguous) return ambiguous;
    const parts = serpentinePartition(lv.n, lv.flows) || serpentinePartition(lv.n, lv.flows - 1);
    if (parts) {
      const puzzle = makePuzzle(seed, key, lv, parts, rng);
      if (checkSolution(puzzle).ok) return puzzle;
    }
    return null;
  }

  // The puzzle everyone gets on a given day, at each level. The date is UTC so
  // the whole world changes puzzles at the same moment (same as Gamekit.dailySeed).
  function todayISO() { return new Date().toISOString().slice(0, 10); }
  function dailySeed(levelKey, date) {
    return hashStr("flow-free|" + (LEVELS[levelKey] ? levelKey : "medium") + "|" + (date || todayISO()));
  }
  function daily(levelKey, date) { return generate(dailySeed(levelKey, date), levelKey); }

  g.FlowPuzzle = {
    LEVELS: LEVELS,
    COLOURS: COLOURS,
    generate: generate,
    daily: daily,
    dailySeed: dailySeed,
    check: check,
    checkSolution: checkSolution,
    partialOk: partialOk,
    isFlowDone: isFlowDone,
    emptyPaths: emptyPaths,
    clonePaths: clonePaths,
    hint: hint,
    solve: solve,
    countSolutions: countSolutions,
    adjacent: adjacent,
    neighbours: neighbours,
    mulberry32: mulberry32,
    hashStr: hashStr,
  };
})(globalThis);
