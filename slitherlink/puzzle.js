/* ============================================================
   slitherlink/puzzle.js — the puzzles and the rules of Slitherlink.

   A plain script that sets globalThis.SlitherPuzzle (the page loads it with a
   <script> tag, the test imports it for the same effect).

   THE GAME: a square grid of dots. Numbered cells say how many of their four
   sides are part of one closed loop drawn along the grid edges (0 to 3; a
   blank cell says nothing). The loop never branches (exactly two edges meet
   at every dot it uses), never crosses itself, and is a single loop.

   Everything is built from a seed and bounded step counts only (never the
   clock), so the daily puzzle is identical on every device. Generation:
     1. grow a random, hole-free blob of cells from the seed (a blob with no
        hole has exactly one boundary loop),
     2. read each cell's clue off that boundary,
     3. hide some of the 0 clues (and put one back if the board stops having
        one answer), then ask the bounded solver to count solutions. Only a
        board with exactly one solution is kept; an ambiguous or unverifiable
        board is thrown away and another blob is tried.
   The solver is the same one the page uses for Check, and its step count
   (not a clock) bounds every search.
   ============================================================ */
(function (g) {
  "use strict";

  const GAME = "slitherlink";
  const MAX_CLUE = 3;

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

  /* ---------- the grid: dots, edges, cells ----------
     Vertices (dots) are numbered row by row: v = r * (n + 1) + c.
     Edges are horizontal first, then vertical:
       hEdge(r, c) = r * n + c                     r = 0..n,   c = 0..n-1
       vEdge(r, c) = n * (n + 1) + r * (n + 1) + c r = 0..n-1, c = 0..n
     A cell is bordered by [top, right, bottom, left]. */
  const hEdge = (n, r, c) => r * n + c;
  const vEdge = (n, r, c) => n * (n + 1) + r * (n + 1) + c;
  const edgeCount = (n) => 2 * n * (n + 1);
  const vertexCount = (n) => (n + 1) * (n + 1);

  // Everything the solver and the page need to know about one board size.
  function makeMeta(n) {
    const N = n * n, V = vertexCount(n), E = edgeCount(n);
    const cellEdges = new Int32Array(N * 4);
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const i = r * n + c;
        cellEdges[i * 4] = hEdge(n, r, c);          // top
        cellEdges[i * 4 + 1] = vEdge(n, r, c + 1);  // right
        cellEdges[i * 4 + 2] = hEdge(n, r + 1, c);  // bottom
        cellEdges[i * 4 + 3] = vEdge(n, r, c);      // left
      }
    }
    const edgeCells = new Int32Array(E * 2).fill(-1);
    const edgeVerts = new Int32Array(E * 2);
    for (let r = 0; r <= n; r++) {
      for (let c = 0; c < n; c++) {
        const k = hEdge(n, r, c);
        const a = r * (n + 1) + c;
        edgeVerts[k * 2] = a;
        edgeVerts[k * 2 + 1] = a + 1;
        if (r > 0) edgeCells[k * 2] = (r - 1) * n + c;
        if (r < n) edgeCells[k * 2 + 1] = r * n + c;
      }
    }
    for (let r = 0; r < n; r++) {
      for (let c = 0; c <= n; c++) {
        const k = vEdge(n, r, c);
        const a = r * (n + 1) + c;
        edgeVerts[k * 2] = a;
        edgeVerts[k * 2 + 1] = a + (n + 1);
        if (c > 0) edgeCells[k * 2] = r * n + c - 1;
        if (c < n) edgeCells[k * 2 + 1] = r * n + c;
      }
    }
    const vertEdges = Array.from({ length: V }, () => []);
    for (let k = 0; k < E; k++) {
      vertEdges[edgeVerts[k * 2]].push(k);
      vertEdges[edgeVerts[k * 2 + 1]].push(k);
    }
    return { n, N, V, E, cellEdges, edgeCells, edgeVerts, vertEdges };
  }

  // The two dots at the ends of an edge, in grid coordinates, for drawing.
  function edgeEnds(n, k) {
    const H = (n + 1) * n;
    if (k < H) {
      const r = Math.floor(k / n), c = k % n;
      return { r1: r, c1: c, r2: r, c2: c + 1 };
    }
    const j = k - H, r = Math.floor(j / (n + 1)), c = j % (n + 1);
    return { r1: r, c1: c, r2: r + 1, c2: c };
  }

  function cellEdgesOf(p, r, c) {
    const i = r * p.n + c;
    return [p.cellEdges[i * 4], p.cellEdges[i * 4 + 1], p.cellEdges[i * 4 + 2], p.cellEdges[i * 4 + 3]];
  }

  // n: the square grid of cells; attempt/cap/budget bound generation, never the clock
  const LEVELS = {
    easy:   { n: 5,  area: [0.34, 0.62], hide: 0.55, attempts: 500, cap: 60000,  budget: 2200000 },
    medium: { n: 7,  area: [0.33, 0.60], hide: 0.55, attempts: 450, cap: 120000, budget: 4500000 },
    hard:   { n: 10, area: [0.30, 0.58], hide: 0.55, attempts: 400, cap: 200000, budget: 8000000 },
  };

  /* ---------- a random blob, its boundary and its clues ---------- */
  // Grow a connected set of cells with bounded steps. A blob with no hole has
  // one boundary loop; the caller checks that and throws the blob away if not.
  function growRegion(n, rng, minArea, maxArea) {
    const N = n * n;
    const target = minArea + Math.floor(rng() * (maxArea - minArea + 1));
    const region = new Uint8Array(N);
    const front = [], inFront = new Uint8Array(N);
    const start = Math.floor(rng() * N);
    region[start] = 1;
    let size = 1;
    const push = (i) => {
      if (!region[i] && !inFront[i]) { inFront[i] = 1; front.push(i); }
    };
    const addNeighbours = (i) => {
      const r = Math.floor(i / n), c = i % n;
      if (r > 0) push(i - n);
      if (r < n - 1) push(i + n);
      if (c > 0) push(i - 1);
      if (c < n - 1) push(i + 1);
    };
    const neighboursIn = (i) => {
      const r = Math.floor(i / n), c = i % n;
      let k = 0;
      if (r > 0 && region[i - n]) k++;
      if (r < n - 1 && region[i + n]) k++;
      if (c > 0 && region[i - 1]) k++;
      if (c < n - 1 && region[i + 1]) k++;
      return k;
    };
    addNeighbours(start);
    while (size < target && front.length) {
      let at = Math.floor(rng() * front.length);
      if (rng() < 0.45) {
        // Prefer a cell touching the blob once: that grows fingers instead of
        // filling a box, which gives more 1s and 3s and far fewer holes.
        let best = 9;
        const samples = Math.min(10, front.length);
        for (let t = 0; t < samples; t++) {
          const j = Math.floor(rng() * front.length);
          const inCount = neighboursIn(front[j]);
          const score = inCount === 1 ? 0 : inCount;
          if (score < best || (score === best && rng() < 0.5)) { best = score; at = j; }
        }
      }
      const cell = front[at];
      const last = front.pop();
      if (at < front.length) front[at] = last;
      inFront[cell] = 0;
      if (region[cell]) continue;
      region[cell] = 1;
      size++;
      addNeighbours(cell);
    }
    if (size < minArea) return null;
    return { region, size, target };
  }

  // Is every empty cell joined to the border? If not, the blob has a hole and
  // its boundary is more than one loop.
  function outsideConnected(n, region) {
    const N = n * n;
    const seen = new Uint8Array(N), q = [];
    const add = (i) => { if (!region[i] && !seen[i]) { seen[i] = 1; q.push(i); } };
    for (let c = 0; c < n; c++) { add(c); add((n - 1) * n + c); }
    for (let r = 0; r < n; r++) { add(r * n); add(r * n + n - 1); }
    for (let qi = 0; qi < q.length; qi++) {
      const i = q[qi], r = Math.floor(i / n), c = i % n;
      if (r > 0) add(i - n);
      if (r < n - 1) add(i + n);
      if (c > 0) add(i - 1);
      if (c < n - 1) add(i + 1);
    }
    for (let i = 0; i < N; i++) if (!region[i] && !seen[i]) return false;
    return true;
  }

  // Clue of every cell: how many of its sides are on the blob's boundary.
  function cluesFromRegion(n, region) {
    const N = n * n, clues = new Int8Array(N);
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const i = r * n + c;
        const self = region[i] === 1;
        let k = 0;
        // a side is a loop edge when exactly one of the two cells is inside the blob
        if ((r > 0 && region[i - n] === 1) !== self) k++;
        if ((r < n - 1 && region[i + n] === 1) !== self) k++;
        if ((c > 0 && region[i - 1] === 1) !== self) k++;
        if ((c < n - 1 && region[i + 1] === 1) !== self) k++;
        clues[i] = k;
      }
    }
    return clues;
  }

  // The single loop around the blob, as a 0/1 value per edge.
  function loopFromRegion(n, region) {
    const E = edgeCount(n), line = new Uint8Array(E);
    for (let r = 0; r <= n; r++) {
      for (let c = 0; c < n; c++) {
        const above = r > 0 && region[(r - 1) * n + c] === 1;
        const below = r < n && region[r * n + c] === 1;
        if (above !== below) line[hEdge(n, r, c)] = 1;
      }
    }
    for (let r = 0; r < n; r++) {
      for (let c = 0; c <= n; c++) {
        const left = c > 0 && region[r * n + c - 1] === 1;
        const right = c < n && region[r * n + c] === 1;
        if (left !== right) line[vEdge(n, r, c)] = 1;
      }
    }
    return line;
  }

  function makePuzzle(seed, level, n, clues, solution, hidden) {
    const meta = makeMeta(n);
    // The public clues are 0..3 or null for a blank; the solver keeps the same
    // values in a typed array (with -1 for blank) so its hot loop stays quick.
    const clueValues = new Int8Array(meta.N);
    const publicClues = new Array(meta.N);
    for (let i = 0; i < meta.N; i++) {
      const v = clues[i];
      const k = v === null || v === undefined || v < 0 ? -1 : (v | 0);
      clueValues[i] = k;
      publicClues[i] = k < 0 ? null : k;
    }
    return {
      seed: seed >>> 0,
      level,
      n,
      N: meta.N,
      V: meta.V,
      E: meta.E,
      cellEdges: meta.cellEdges,
      edgeCells: meta.edgeCells,
      edgeVerts: meta.edgeVerts,
      vertEdges: meta.vertEdges,
      clues: publicClues,
      clueValues,
      solution: Array.from(solution),
      hidden: hidden || 0,
      unique: true,
    };
  }

  /* ---------- the solver ----------
     Values per edge: -1 unknown, 0 off, 1 on. It propagates the two rules
     (a clue's count, and a dot having 0 or 2 loop edges) and then branches on
     one edge at a time. When a closed loop appears, every other edge must be
     off, so that is forced immediately. The step count, not a clock, bounds
     the search; a blown search proves nothing and is thrown away. */
  function solveAll(p, limit, cap) {
    limit = Math.max(1, limit || 2);
    cap = cap || 150000;
    const N = p.N, V = p.V, E = p.E;
    const cellEdges = p.cellEdges, edgeCells = p.edgeCells, edgeVerts = p.edgeVerts, vertEdges = p.vertEdges, clues = p.clueValues;
    const state = new Int8Array(E).fill(-1);
    const trail = [];
    const cellQ = [], vertQ = [];
    const inCell = new Uint8Array(N), inVert = new Uint8Array(V);
    let work = 0, found = 0, blown = false, first = null;

    const empty = { found: 0, blown: false, solution: null, steps: 0 };
    if (!p || !N || !E) return empty;

    function markCell(ci) { if (!inCell[ci]) { inCell[ci] = 1; cellQ.push(ci); } }
    function markVert(vi) { if (!inVert[vi]) { inVert[vi] = 1; vertQ.push(vi); } }
    function assign(e, v) {
      if (state[e] !== -1) return state[e] === v;
      state[e] = v;
      trail.push(e);
      work++;
      const c1 = edgeCells[e * 2], c2 = edgeCells[e * 2 + 1];
      if (c1 >= 0) markCell(c1);
      if (c2 >= 0) markCell(c2);
      markVert(edgeVerts[e * 2]);
      markVert(edgeVerts[e * 2 + 1]);
      return true;
    }
    function clearQueues() {
      while (cellQ.length) inCell[cellQ.pop()] = 0;
      while (vertQ.length) inVert[vertQ.pop()] = 0;
    }
    function undo(mark) {
      while (trail.length > mark) { const e = trail.pop(); state[e] = -1; }
    }

    function propagate() {
      while (cellQ.length || vertQ.length) {
        if (++work > cap) { blown = true; return false; }
        if (cellQ.length) {
          const ci = cellQ.pop();
          inCell[ci] = 0;
          const k = clues[ci];
          if (k < 0) continue;
          let on = 0, unknown = 0;
          const base = ci * 4;
          for (let j = 0; j < 4; j++) {
            const e = cellEdges[base + j], v = state[e];
            if (v === 1) on++;
            else if (v < 0) unknown++;
          }
          if (on > k || on + unknown < k) return false;
          if (!unknown) continue;
          if (on + unknown === k) {
            for (let j = 0; j < 4; j++) {
              const e = cellEdges[base + j];
              if (state[e] < 0 && !assign(e, 1)) return false;
            }
          } else if (on === k) {
            for (let j = 0; j < 4; j++) {
              const e = cellEdges[base + j];
              if (state[e] < 0 && !assign(e, 0)) return false;
            }
          }
        } else {
          const vi = vertQ.pop();
          inVert[vi] = 0;
          const list = vertEdges[vi];
          let deg = 0, unknown = 0, last = -1;
          for (let j = 0; j < list.length; j++) {
            const e = list[j], v = state[e];
            if (v === 1) deg++;
            else if (v < 0) { unknown++; last = e; }
          }
          if (deg > 2) return false;
          if (deg === 2) {
            for (let j = 0; j < list.length; j++) {
              const e = list[j];
              if (state[e] < 0 && !assign(e, 0)) return false;
            }
          } else if (deg === 1) {
            if (!unknown) return false;
            if (unknown === 1 && !assign(last, 1)) return false;
          } else if (deg === 0 && unknown === 1) {
            if (!assign(last, 0)) return false;
          }
        }
      }
      return true;
    }

    // What the loop edges look like now: every component is a path or a cycle.
    function analyze() {
      const deg = new Int16Array(V);
      let lineCount = 0;
      for (let e = 0; e < E; e++) {
        if (state[e] !== 1) continue;
        lineCount++;
        deg[edgeVerts[e * 2]]++;
        deg[edgeVerts[e * 2 + 1]]++;
      }
      const parent = new Int32Array(V).fill(-1);
      const touched = [];
      for (let v = 0; v < V; v++) if (deg[v] > 0) { parent[v] = v; touched.push(v); }
      const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
      for (let e = 0; e < E; e++) {
        if (state[e] !== 1) continue;
        const a = find(edgeVerts[e * 2]), b = find(edgeVerts[e * 2 + 1]);
        if (a !== b) parent[a] = b;
      }
      const comps = new Map();
      for (const v of touched) {
        const root = find(v);
        let rec = comps.get(root);
        if (!rec) { rec = { verts: 0, ends: 0, bad: false }; comps.set(root, rec); }
        rec.verts++;
        if (deg[v] === 1) rec.ends++;
        else if (deg[v] !== 2) rec.bad = true;
      }
      let loops = 0, paths = 0, badComponents = 0;
      for (const rec of comps.values()) {
        if (rec.bad) badComponents++;
        else if (rec.ends === 0) loops++;
        else if (rec.ends === 2) paths++;
        else badComponents++;
      }
      return { deg, lineCount, loops, paths, badComponents, components: comps.size };
    }

    // A closed loop can never grow: if one exists, everything else is off.
    function closeCyclePrune() {
      const info = analyze();
      if (!info.loops) return true;
      if (info.loops > 1 || info.paths > 0 || info.badComponents > 0) return false;
      let assigned = false;
      for (let e = 0; e < E; e++) {
        if (state[e] < 0) { if (!assign(e, 0)) return false; assigned = true; }
      }
      if (!assigned) return true;
      if (!propagate()) return false;
      const after = analyze();
      return after.loops === 1 && after.paths === 0 && after.badComponents === 0;
    }

    function allCluesMet() {
      for (let ci = 0; ci < N; ci++) {
        const k = clues[ci];
        if (k < 0) continue;
        const base = ci * 4;
        let on = 0;
        if (state[cellEdges[base]] === 1) on++;
        if (state[cellEdges[base + 1]] === 1) on++;
        if (state[cellEdges[base + 2]] === 1) on++;
        if (state[cellEdges[base + 3]] === 1) on++;
        if (on !== k) return false;
      }
      return true;
    }

    // Branch on the most constrained open edge: a dot that already has one
    // loop edge (it needs one more) first, then the tightest numbered cell.
    function chooseEdge() {
      for (let vi = 0; vi < V; vi++) {
        const list = vertEdges[vi];
        let deg = 0, unknown = 0, last = -1;
        for (let j = 0; j < list.length; j++) {
          const e = list[j], v = state[e];
          if (v === 1) deg++;
          else if (v < 0) { unknown++; last = e; }
        }
        if (deg === 1 && unknown >= 2) return last;
      }
      let best = -1, bestScore = Infinity;
      for (let ci = 0; ci < N; ci++) {
        const k = clues[ci];
        if (k < 0) continue;
        const base = ci * 4;
        let on = 0, unknown = 0, last = -1;
        for (let j = 0; j < 4; j++) {
          const e = cellEdges[base + j], v = state[e];
          if (v === 1) on++;
          else if (v < 0) { unknown++; last = e; }
        }
        if (!unknown) continue;
        const need = k - on;
        const score = unknown * 100 + Math.abs(need - unknown / 2) * 10;
        if (score < bestScore) { bestScore = score; best = last; }
      }
      if (best >= 0) return best;
      for (let e = 0; e < E; e++) if (state[e] < 0) return e;
      return -1;
    }

    function search() {
      if (found >= limit || blown) return;
      if (++work > cap) { blown = true; return; }
      if (!propagate()) { clearQueues(); return; }
      if (!closeCyclePrune()) { clearQueues(); return; }
      const e = chooseEdge();
      if (e < 0) {
        if (allCluesMet() && state.every((v) => v >= 0)) {
          const info = analyze();
          if (info.loops === 1 && info.paths === 0 && info.badComponents === 0 && info.lineCount >= 4) {
            if (!first) first = Array.from(state);
            found++;
          }
        }
        return;
      }
      const mark = trail.length;
      for (let t = 0; t < 2; t++) {
        if (found >= limit || blown) break;
        if (!assign(e, t)) continue;
        search();
        clearQueues();
        undo(mark);
      }
    }

    // Every clue cell and every dot is checked from the start.
    for (let ci = 0; ci < N; ci++) if (clues[ci] >= 0) markCell(ci);
    for (let vi = 0; vi < V; vi++) markVert(vi);
    search();
    clearQueues();
    return { found, blown, solution: first, steps: work };
  }

  function countSolutions(p, limit, cap) {
    const r = solveAll(p, limit || 2, cap);
    return r.blown ? -1 : r.found;
  }
  // The first answer the solver finds, or null. Because generate only keeps
  // one-answer boards, this is the same loop the clues were read from.
  function solve(p, cap) {
    const r = solveAll(p, 1, cap);
    return r.solution;
  }

  /* ---------- checking the player's line ---------- */
  // `state` may hold 0 (nothing), 1 (a line) or 2 (an X mark); only 1 counts.
  function check(p, state) {
    const n = p.n, N = p.N, V = p.V, E = p.E;
    const marks = state || [];
    const degree = new Int16Array(V);
    const counts = new Int16Array(N);
    const over = [], under = [], badVertices = [], ends = [];
    let lineCount = 0;
    for (let e = 0; e < E; e++) {
      if (marks[e] !== 1) continue;
      lineCount++;
      degree[p.edgeVerts[e * 2]]++;
      degree[p.edgeVerts[e * 2 + 1]]++;
    }
    for (let v = 0; v < V; v++) {
      if (degree[v] > 2) badVertices.push(v);
      else if (degree[v] === 1) ends.push(v);
    }
    for (let ci = 0; ci < N; ci++) {
      const base = ci * 4;
      let k = 0;
      if (marks[p.cellEdges[base]] === 1) k++;
      if (marks[p.cellEdges[base + 1]] === 1) k++;
      if (marks[p.cellEdges[base + 2]] === 1) k++;
      if (marks[p.cellEdges[base + 3]] === 1) k++;
      counts[ci] = k;
      const clue = p.clues[ci];
      if (clue !== null && clue !== undefined && clue >= 0) {
        if (k > clue) over.push(ci);
        else if (k < clue) under.push(ci);
      }
    }
    // Components of the drawn line: a loop has no ends, a path has two.
    const parent = new Int32Array(V).fill(-1);
    const touched = [];
    for (let v = 0; v < V; v++) if (degree[v] > 0) { parent[v] = v; touched.push(v); }
    const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
    for (let e = 0; e < E; e++) {
      if (marks[e] !== 1) continue;
      const a = find(p.edgeVerts[e * 2]), b = find(p.edgeVerts[e * 2 + 1]);
      if (a !== b) parent[a] = b;
    }
    const comps = new Map();
    for (const v of touched) {
      const root = find(v);
      let rec = comps.get(root);
      if (!rec) { rec = { ends: 0, bad: false }; comps.set(root, rec); }
      if (degree[v] === 1) rec.ends++;
      else if (degree[v] !== 2) rec.bad = true;
    }
    let loops = 0, paths = 0, badComponents = 0;
    for (const rec of comps.values()) {
      if (rec.bad) badComponents++;
      else if (rec.ends === 0) loops++;
      else if (rec.ends === 2) paths++;
      else badComponents++;
    }
    const singleLoop = loops === 1 && paths === 0 && badComponents === 0 && badVertices.length === 0 && lineCount >= 4;
    const badClues = over.concat(under).sort((a, b) => a - b);
    return {
      degree, counts, over, under, badClues,
      badVertices, ends, lineCount,
      loops, paths, badComponents,
      singleLoop,
      solved: singleLoop && badClues.length === 0,
    };
  }
  function checkSolution(p, state) { return check(p, state).solved; }

  /* ---------- a hint: one edge of the stored answer ---------- */
  // Prefers a missing line; if every line is drawn it points at an extra one.
  // Returns { edge, value, have } or null when the loop is complete.
  function hint(p, state) {
    if (!p || !p.solution) return null;
    for (let e = 0; e < p.E; e++) {
      if (p.solution[e] === 1 && state[e] !== 1) return { edge: e, value: 1, have: state[e] || 0 };
    }
    for (let e = 0; e < p.E; e++) {
      if (p.solution[e] === 0 && state[e] === 1) return { edge: e, value: 0, have: 1 };
    }
    return null;
  }

  /* ---------- hiding a few clues ---------- */
  // Zero clues are the roomy ones: hiding some makes the board look like a
  // Slitherlink puzzle instead of a coloured-in map. Never hides a 1, 2 or 3,
  // and the caller puts everything back if the answer stops being unique.
  function hideZeroClues(p, rng) {
    const zeros = [];
    for (let i = 0; i < p.N; i++) if (p.clueValues[i] === 0) zeros.push(i);
    if (!zeros.length) return null;
    const order = shuffled(zeros, rng);
    const lv = LEVELS[p.level] || LEVELS.medium;
    const count = Math.max(1, Math.floor(order.length * lv.hide));
    const clues = Int8Array.from(p.clueValues);
    for (let t = 0; t < count; t++) clues[order[t]] = -1;
    return { clues, hidden: count };
  }

  /* ---------- a puzzle from a seed ---------- */
  function generate(seed, level) {
    const lv = LEVELS[level] || LEVELS.medium;
    const n = lv.n, N = n * n;
    const minArea = Math.max(6, Math.round(N * lv.area[0]));
    const maxArea = Math.max(minArea + 2, Math.round(N * lv.area[1]));
    const rng = mulberry32(seed >>> 0);
    let spent = 0, attempts = 0;
    while (attempts < lv.attempts && spent < lv.budget) {
      attempts++;
      const grown = growRegion(n, rng, minArea, maxArea);
      if (!grown) continue;
      // a full board has no outside, and a hole would mean two loops
      if (grown.size >= N || !outsideConnected(n, grown.region)) continue;
      const clues = cluesFromRegion(n, grown.region);
      let ok = true;
      for (let i = 0; i < N; i++) if (clues[i] > MAX_CLUE) { ok = false; break; }
      if (!ok) continue;
      const loop = loopFromRegion(n, grown.region);
      const full = makePuzzle(seed, level, n, clues, loop, 0);
      if (!check(full, full.solution).solved) continue;
      const r = solveAll(full, 2, lv.cap);
      spent += r.steps || 0;
      if (r.blown || r.found !== 1) continue;
      // Hide a few 0s, but only if that still leaves exactly one answer.
      if (spent < lv.budget) {
        const hide = hideZeroClues(full, rng);
        if (hide) {
          const part = makePuzzle(seed, level, n, hide.clues, loop, hide.hidden);
          const cap = Math.min(lv.cap, Math.max(20000, lv.budget - spent));
          const r2 = solveAll(part, 2, cap);
          spent += r2.steps || 0;
          if (!r2.blown && r2.found === 1) return part;
        }
      }
      return full;
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

  g.SlitherPuzzle = {
    GAME,
    LEVELS,
    MAX_CLUE,
    hEdge,
    vEdge,
    edgeCount,
    vertexCount,
    edgeEnds,
    cellEdgesOf,
    makeMeta,
    makePuzzle,
    growRegion,
    outsideConnected,
    cluesFromRegion,
    loopFromRegion,
    generate,
    generateDaily,
    dailySeed,
    solveAll,
    solve,
    countSolutions,
    check,
    checkSolution,
    hint,
    mulberry32,
    hashStr,
  };
})(globalThis);
