/* ============================================================
   star-battle/puzzle.js — the puzzles, the rules, the solver and the hints of Star Battle.

   A plain script that sets globalThis.StarBattlePuzzle (the page loads it with a <script>
   tag, the test imports it for the same effect).

   THE GAME: a square grid is divided into N connected regions. Put stars on the grid so
   that every row, every column and every region holds exactly `k` stars (1 on the easier
   boards, 2 on the large one), and no two stars touch — not even at a corner.

   Everything is built from a seed and bounded step counts only (never the clock), so the
   daily puzzle is the same on every device. Generation:
     1. place a random legal set of stars (k per row and column, none touching),
     2. grow N connected regions around those stars, with every star locked to one region
        so that each region ends up with exactly k stars,
     3. nudge region borders until the bounded solver can find only one answer: a cell that
        is a star in a second answer but not in ours is moved to a neighbouring region,
        which kills that answer without touching ours,
     4. only a board the solver proves to have exactly one solution is kept; one that runs
        out of steps is thrown away and another is tried.
   The same solver powers solve(), and the stored answer powers hint().
   ============================================================ */
(function (g) {
  "use strict";

  const GAME = "star-battle";

  // n: the grid is n by n; k: stars in every row, column and region.
  const LEVELS = {
    easy:   { n: 6,  k: 1, label: "Easy · 6×6" },
    medium: { n: 8,  k: 1, label: "Med · 8×8" },
    hard:   { n: 10, k: 2, label: "Hard · 10×10" },
  };

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
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function shuffled(arr, rng) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }

  /* ---------- small helpers ---------- */
  // the four edge-neighbours: regions grow and join edge to edge, never only by a corner
  function neighbours(n, cell) {
    const r = (cell / n) | 0, c = cell % n, out = [];
    if (r > 0) out.push(cell - n);
    if (r < n - 1) out.push(cell + n);
    if (c > 0) out.push(cell - 1);
    if (c < n - 1) out.push(cell + 1);
    return out;
  }
  function manhattan(n, a, b) {
    return Math.abs(((a / n) | 0) - ((b / n) | 0)) + Math.abs((a % n) - (b % n));
  }

  /* ---------- 1. a random legal set of stars ----------
     Rows are filled top to bottom. A row picks k columns that are still under their quota
     and are not next to a star of the row above. A column needs `need` more stars, and
     they must sit in non-adjacent rows, so need can never exceed ceil(remaining / 2):
     that check alone makes the random search quick and keeps it from wandering.
     Bounded by a node count; returns the star cells (sorted) or null. */
  function randomSolution(n, k, rng, budget) {
    const full = (1 << n) - 1;
    const colCnt = new Int8Array(n);
    const picks = new Int32Array(n);
    let nodes = 0;
    const cap = budget || 20000;

    function options(forbidden) {
      const out = [];
      if (k === 1) {
        for (let c = 0; c < n; c++) if (!(forbidden & (1 << c)) && colCnt[c] < 1) out.push([c]);
      } else {
        for (let a = 0; a < n; a++) {
          if (forbidden & (1 << a)) continue;
          if (colCnt[a] + 1 > k) continue;
          for (let b = a + 2; b < n; b++) {
            if (forbidden & (1 << b)) continue;
            if (colCnt[b] + 1 > k) continue;
            out.push([a, b]);
          }
        }
      }
      return out;
    }

    function rec(r, prevMask) {
      if (++nodes > cap) return false;
      if (r === n) return true;
      const rem = n - 1 - r;
      const half = (rem + 1) >> 1;
      const forbidden = (prevMask | (prevMask << 1) | (prevMask >>> 1)) & full;
      const list = shuffled(options(forbidden), rng);
      for (let t = 0; t < list.length; t++) {
        const combo = list[t];
        let ok = true;
        for (let i = 0; i < combo.length; i++) {
          if (++colCnt[combo[i]] > k) ok = false;
        }
        if (ok) {
          for (let c = 0; c < n; c++) if (k - colCnt[c] > half) { ok = false; break; }
        }
        if (ok) {
          let mask = 0;
          for (let i = 0; i < combo.length; i++) mask |= 1 << combo[i];
          picks[r] = mask;
          if (rec(r + 1, mask)) return true;
        }
        for (let i = 0; i < combo.length; i++) colCnt[combo[i]]--;
      }
      return false;
    }

    if (!rec(0, 0)) return null;
    const cells = [];
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) if (picks[r] & (1 << c)) cells.push(r * n + c);
    }
    return cells;
  }

  /* ---------- 2. regions ----------
     Pair the stars (one group per region) and lock those cells to their region. A region
     with two stars has the two seeds joined first, so it cannot end up as two separate
     pieces. Then the regions grow one cell at a time: the next cell is always taken next
     to a cell of the region that claims it, so a region can never split, and a small
     region is preferred (weight 1 / size²), so the pieces end up roughly the same size
     instead of one region swallowing the board. Every region starts with exactly its k
     stars, so a finished board gives every region exactly k stars. Returns the n*n region
     ids, or null when the growth dead-ended. */
  function starGroups(n, k, stars, rng) {
    if (k === 1) return stars.map((c) => [c]);
    const left = stars.slice();
    const groups = [];
    while (left.length) {
      let bi = 0, bj = 1, best = Infinity;
      for (let i = 0; i < left.length; i++) {
        for (let j = i + 1; j < left.length; j++) {
          const d = manhattan(n, left[i], left[j]);
          if (d < best || (d === best && rng() < 0.5)) { best = d; bi = i; bj = j; }
        }
      }
      const a = left[bi], b = left[bj];
      groups.push([a, b]);
      left.splice(Math.max(bi, bj), 1);
      left.splice(Math.min(bi, bj), 1);
    }
    return groups;
  }

  // The shortest path from a to b through free cells, or null when other regions block it.
  function freePath(n, reg, a, b) {
    const N = n * n;
    const from = new Int32Array(N).fill(-2);
    from[a] = -1;
    const queue = [a];
    for (let q = 0; q < queue.length; q++) {
      const cell = queue[q];
      const nb = neighbours(n, cell);
      for (let t = 0; t < nb.length; t++) {
        const x = nb[t];
        if (x === b) {
          from[b] = cell;
          const path = [];
          for (let at = b; at !== -1; at = from[at]) path.push(at);
          path.reverse();
          return path;
        }
        if (reg[x] !== -1 || from[x] !== -2) continue;
        from[x] = cell;
        queue.push(x);
      }
    }
    return null;
  }

  function growRegions(n, k, stars, rng, weightPow) {
    const N = n * n;
    const reg = new Int8Array(N).fill(-1);
    const groups = starGroups(n, k, stars, rng);
    const size = new Int16Array(n);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < groups[i].length; j++) { reg[groups[i][j]] = i; size[i]++; }
    }
    const nb = new Array(N);
    for (let i = 0; i < N; i++) nb[i] = neighbours(n, i);
    // a region with two stars must join them, or it could end up as two separate pieces
    if (k > 1) {
      const order = shuffled(groups.map((_, i) => i), rng);
      for (const gid of order) {
        const path = freePath(n, reg, groups[gid][0], groups[gid][1]);
        if (!path) return null;
        for (let t = 1; t + 1 < path.length; t++) {
          if (reg[path[t]] !== -1) return null;
          reg[path[t]] = gid;
          size[gid]++;
        }
      }
    }
    let left = 0;
    for (let i = 0; i < N; i++) if (reg[i] === -1) left++;
    const pw = weightPow === undefined ? 2 : weightPow;
    let guard = 0;
    while (left > 0) {
      if (++guard > N * 8) return null;
      // collect the cells each region could claim next
      const frontier = new Array(n);
      for (let i = 0; i < n; i++) frontier[i] = [];
      for (let cell = 0; cell < N; cell++) {
        if (reg[cell] !== -1) continue;
        const list = nb[cell];
        for (let t = 0; t < list.length; t++) {
          const rid = reg[list[t]];
          if (rid >= 0) frontier[rid].push(cell);
        }
      }
      let total = 0;
      const cand = [];
      for (let i = 0; i < n; i++) {
        if (!frontier[i].length) continue;
        const w = 1 / Math.pow(size[i], pw);
        cand.push({ rid: i, w: w });
        total += w;
      }
      if (!cand.length) return null;
      let pick = rng() * total, chosen = cand[cand.length - 1].rid;
      for (let i = 0; i < cand.length; i++) { pick -= cand[i].w; if (pick < 0) { chosen = cand[i].rid; break; } }
      const list = frontier[chosen];
      const cell = list[Math.floor(rng() * list.length)];
      reg[cell] = chosen;
      size[chosen]++;
      left--;
    }
    // every region must be one connected piece (the growth guarantees it, this is a guard)
    const seen = new Uint8Array(N);
    for (let i = 0; i < n; i++) {
      let start = -1;
      for (let cell = 0; cell < N; cell++) if (reg[cell] === i) { start = cell; break; }
      if (start < 0) return null;
      const queue = [start];
      seen[start] = 1;
      let count = 0;
      for (let q = 0; q < queue.length; q++) {
        const cell = queue[q];
        count++;
        const list = nb[cell];
        for (let t = 0; t < list.length; t++) {
          const x = list[t];
          if (!seen[x] && reg[x] === i) { seen[x] = 1; queue.push(x); }
        }
      }
      if (count !== size[i]) return null;
    }
    return Array.from(reg);
  }

  /* ---------- the solver ----------
     Rows are filled top to bottom with every legal pair (or single) of columns. Three
     necessary checks prune the search; none of them can throw away a real solution:
       - a column still needing `d` stars has only `rem` rows left, and stars in one column
         may not sit in adjacent rows, so d <= ceil(rem / 2);
       - a region still needing `d` stars needs at least d of its cells left below this row;
       - a region can gain at most k stars from any one row, so d <= k * rows left that
         contain one of its cells.
     `blown` means the node budget ran out, so the count is not a proof either way. */
  function prepare(p) {
    const n = p.n, k = p.k, N = n * n, reg = p.regions;
    const rows = [];
    for (let r = 0; r < n; r++) {
      const list = [];
      if (k === 1) {
        for (let c = 0; c < n; c++) {
          const gid = reg[r * n + c];
          list.push({ mask: 1 << c, cols: [c], adds: [[gid, 1]] });
        }
      } else {
        for (let a = 0; a < n; a++) {
          for (let b = a + 2; b < n; b++) {
            const ga = reg[r * n + a], gb = reg[r * n + b];
            const adds = ga === gb ? [[ga, 2]] : [[ga, 1], [gb, 1]];
            list.push({ mask: (1 << a) | (1 << b), cols: [a, b], adds: adds });
          }
        }
      }
      rows.push(list);
    }
    // cellSuffix[r][g]: cells of region g in rows r..n-1
    // rowSuffix[r][g]: rows r..n-1 that hold at least one cell of region g
    const cellSuffix = [], rowSuffix = [];
    for (let r = 0; r <= n; r++) { cellSuffix.push(new Int16Array(n)); rowSuffix.push(new Int16Array(n)); }
    for (let gid = 0; gid < n; gid++) {
      const perRow = new Int16Array(n);
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (reg[r * n + c] === gid) perRow[r]++;
      for (let r = n - 1; r >= 0; r--) {
        cellSuffix[r][gid] = cellSuffix[r + 1][gid] + perRow[r];
        rowSuffix[r][gid] = rowSuffix[r + 1][gid] + (perRow[r] > 0 ? 1 : 0);
      }
    }
    return { n: n, k: k, rows: rows, cellSuffix: cellSuffix, rowSuffix: rowSuffix };
  }

  function search(p, limit, budget) {
    const lv = prepare(p);
    const n = lv.n, k = lv.k;
    const cands = lv.rows, cellSuffix = lv.cellSuffix, rowSuffix = lv.rowSuffix;
    const colCnt = new Int8Array(n), regCnt = new Int8Array(n);
    const pick = new Int32Array(n);
    let nodes = 0, count = 0, blown = false, first = null;
    const all = [];

    function rec(r, prevMask) {
      if (count >= limit) return;
      if (++nodes > (budget || 200000)) { blown = true; return; }
      if (r === n) {
        count++;
        all.push(Array.from(pick));
        if (!first) first = Array.from(pick);
        return;
      }
      const rem = n - 1 - r;
      const half = (rem + 1) >> 1;
      const full = (1 << n) - 1;
      const forbidden = (prevMask | (prevMask << 1) | (prevMask >>> 1)) & full;
      const list = cands[r];
      for (let t = 0; t < list.length; t++) {
        const cand = list[t];
        if (cand.mask & forbidden) continue;
        let ok = true;
        for (let i = 0; i < cand.cols.length; i++) if (colCnt[cand.cols[i]] + 1 > k) { ok = false; break; }
        if (ok) {
          for (let i = 0; i < cand.adds.length; i++) {
            const gid = cand.adds[i][0], add = cand.adds[i][1];
            if (regCnt[gid] + add > k) { ok = false; break; }
          }
        }
        if (!ok) continue;
        for (let i = 0; i < cand.cols.length; i++) colCnt[cand.cols[i]]++;
        for (let i = 0; i < cand.adds.length; i++) regCnt[cand.adds[i][0]] += cand.adds[i][1];
        for (let c = 0; c < n; c++) if (k - colCnt[c] > half) { ok = false; break; }
        if (ok) {
          for (let gid = 0; gid < n; gid++) {
            const need = k - regCnt[gid];
            if (need > cellSuffix[r + 1][gid] || need > rowSuffix[r + 1][gid] * k) { ok = false; break; }
          }
        }
        if (ok) {
          pick[r] = cand.mask;
          rec(r + 1, cand.mask);
        }
        for (let i = 0; i < cand.cols.length; i++) colCnt[cand.cols[i]]--;
        for (let i = 0; i < cand.adds.length; i++) regCnt[cand.adds[i][0]] -= cand.adds[i][1];
        if (count >= limit || blown) return;
      }
    }

    rec(0, 0);
    let solution = null;
    if (first) {
      solution = [];
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (first[r] & (1 << c)) solution.push(r * n + c);
    }
    return { count: count, blown: blown, nodes: nodes, solution: solution, all: all };
  }

  function countSolutions(p, limit, budget) {
    const r = search(p, Math.max(1, limit || 2), budget || 200000);
    return { count: r.blown ? -1 : r.count, blown: r.blown, nodes: r.nodes };
  }
  // the first solution found, as cell indexes, or null
  function solve(p, budget) {
    return search(p, 1, budget || 200000).solution;
  }

  /* ---------- 3. making the answer unique ----------
     A random partition nearly always leaves a second answer, so the regions are nudged
     until the solver can only find one. The nudge is safe by construction: take a region
     A and a cell c that is a star in some other solution but not in ours, and give c (and
     any piece of A that would otherwise be cut off with it) to a neighbouring region B.
     Our own stars never move, so our answer is still a solution; the other answer now has
     too few stars in A or too many in B, so it is gone. Regions stay edge-connected, and
     a region can never shrink below the k stars it must hold.
     Bounded by a step count; returns true only when the solver proves exactly one answer. */
  function otherSolutions(p, limit, budget) {
    const res = search(p, limit, budget);
    if (res.blown) return null;
    const stored = new Uint8Array(p.n * p.n);
    for (const cell of p.solution) stored[cell] = 1;
    const out = [];
    for (const masks of res.all) {
      let same = true, cells = [];
      for (let r = 0; r < p.n; r++) {
        for (let c = 0; c < p.n; c++) {
          const on = !!(masks[r] & (1 << c));
          if (on !== !!stored[r * p.n + c]) same = false;
          if (on) cells.push(r * p.n + c);
        }
      }
      if (!same) out.push(cells);
    }
    return { count: res.count, others: out, unique: res.count === 1, nodes: res.nodes };
  }

  // What has to move with `cut` so that region A stays one piece and keeps every one of
  // its own stars: the cut cell plus every piece of A not holding a star of A. (All of
  // A's stars are in one piece or this returns null.)
  function limbToMove(n, regions, gid, cut, starCells) {
    const cells = [];
    for (let i = 0; i < n * n; i++) if (i !== cut && regions[i] === gid) cells.push(i);
    const seen = new Set();
    const comps = [];
    for (const start of cells) {
      if (seen.has(start)) continue;
      const queue = [start];
      seen.add(start);
      const comp = [];
      for (let q = 0; q < queue.length; q++) {
        const x = queue[q];
        comp.push(x);
        const nb = neighbours(n, x);
        for (let t = 0; t < nb.length; t++) {
          const y = nb[t];
          if (y !== cut && regions[y] === gid && !seen.has(y)) { seen.add(y); queue.push(y); }
        }
      }
      comps.push(comp);
    }
    const starComps = comps.filter((comp) => comp.some((x) => starCells[x]));
    if (starComps.length > 1) return null;
    const move = [cut];
    for (const comp of comps) if (comp !== starComps[0]) for (const x of comp) move.push(x);
    return move;
  }

  function repair(p, rng, budget, steps, work) {
    const n = p.n;
    const inSolution = new Uint8Array(n * n);
    for (const cell of p.solution) inSolution[cell] = 1;
    for (let step = 0; step < steps; step++) {
      if (work.left <= 0) return false;
      const res = otherSolutions(p, 6, Math.min(budget, work.left));
      if (!res) { work.left = 0; return false; }   // search ran out of steps: no proof, try another board
      work.left -= res.nodes;
      if (res.unique) return true;
      if (!res.others.length) return false;
      const size = new Array(n).fill(0);
      for (const gid of p.regions) size[gid]++;
      const starCells = new Array(n).fill(0).map(() => new Uint8Array(n * n));
      for (const cell of p.solution) starCells[p.regions[cell]][cell] = 1;
      const minSize = Math.max(p.k + 1, 2), maxSize = n * 2;
      // keep every piece readable: a region is never left with only its forced stars, and
      // no region grows to twice the fair share. If no such nudge exists, try another board.
      let moved = false;
      for (const alt of res.others) {
        const extra = alt.filter((cell) => !inSolution[cell]);
        for (let i = extra.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const t = extra[i]; extra[i] = extra[j]; extra[j] = t; }
        for (const cell of extra) {
          const a = p.regions[cell];
          const opts = [];
          const nb = neighbours(n, cell);
          for (let t = 0; t < nb.length; t++) {
            const b = p.regions[nb[t]];
            if (b !== a && opts.indexOf(b) === -1) opts.push(b);
          }
          if (!opts.length) continue;
          // give the cell to the smallest neighbouring region: it keeps the pieces balanced
          opts.sort((x, y) => size[x] - size[y]);
          for (const b of opts) {
            const move = limbToMove(n, p.regions, a, cell, starCells[a]);
            if (!move) continue;
            if (size[a] - move.length < minSize || size[b] + move.length > maxSize || move.length > n) continue;
            for (const x of move) { p.regions[x] = b; size[a]--; size[b]++; }
            moved = true;
            break;
          }
          if (moved) break;
        }
        if (moved) break;
      }
      if (!moved) return false;
    }
    return false;
  }

  /* ---------- 4. a puzzle from a seed ---------- */
  const ATTEMPTS = { easy: 10, medium: 12, hard: 16 };
  const BUDGET = { easy: 100000, medium: 200000, hard: 500000 };
  const REPAIR_STEPS = { easy: 50, medium: 70, hard: 90 };
  // total solver steps for one generate() call, over every attempt and repair: a hard cap
  // on the work a single seed (or a bad day) can ask for, independent of the clock
  const WORK = { easy: 600000, medium: 1500000, hard: 5000000 };
  const PLACE_BUDGET = 30000;

  function generate(seed, level) {
    const key = LEVELS[level] ? level : "medium";
    const lv = LEVELS[key];
    const rng = mulberry32(seed >>> 0);
    const work = { left: WORK[key] };
    for (let attempt = 0; attempt < ATTEMPTS[key]; attempt++) {
      if (work.left <= 0) break;
      const stars = randomSolution(lv.n, lv.k, rng, PLACE_BUDGET);
      if (!stars) continue;
      const regions = growRegions(lv.n, lv.k, stars, rng, 2);
      if (!regions) continue;
      const p = {
        game: GAME,
        level: key,
        seed: seed >>> 0,
        n: lv.n,
        k: lv.k,
        regions: regions,
        solution: stars.slice().sort((a, b) => a - b),
      };
      if (!checkSolution(p).solved) continue;
      if (!repair(p, rng, BUDGET[key], REPAIR_STEPS[key], work)) continue;
      // a readable piece is bigger than just its forced stars, and never more than twice
      // the fair share of the board
      const sizes = new Array(lv.n).fill(0);
      for (const gid of p.regions) sizes[gid]++;
      if (sizes.some((v) => v < lv.k + 1 || v > lv.n * 2)) continue;
      return p;
    }
    return null;
  }

  /* ---------- the daily puzzle ---------- */
  // UTC date, exactly the string Gamekit.dailySeed builds: date|level|game
  const todayISO = () => new Date().toISOString().slice(0, 10);
  function dailySeed(level, isoDate) {
    return hashStr((isoDate || todayISO()) + "|" + (LEVELS[level] ? level : "medium") + "|" + GAME);
  }
  function generateDaily(level, isoDate) {
    return generate(dailySeed(level, isoDate), level);
  }

  /* ---------- checking a player's board ---------- */
  // A board may be given as a marks array (one 0/1 entry per cell, the page's form) or as
  // a list of star cells (the form solve() and hint() use).
  function normalMarks(p, marks) {
    const N = p.n * p.n;
    const out = new Uint8Array(N);
    if (!marks) return out;
    const seq = Array.isArray(marks) || ArrayBuffer.isView(marks);
    if (seq && marks.length === N) {
      for (let i = 0; i < N; i++) if (marks[i]) out[i] = 1;
      return out;
    }
    if (seq) {
      for (let i = 0; i < marks.length; i++) {
        const cell = marks[i];
        if (Number.isInteger(cell) && cell >= 0 && cell < N) out[cell] = 1;
      }
      return out;
    }
    if (typeof marks.forEach === "function") {
      marks.forEach((v) => { if (Number.isInteger(v) && v >= 0 && v < N) out[v] = 1; });
    }
    return out;
  }
  function marksFromSolution(p) {
    const out = new Uint8Array(p.n * p.n);
    for (let i = 0; i < p.solution.length; i++) out[p.solution[i]] = 1;
    return out;
  }
  function emptyMarks(p) { return new Uint8Array(p.n * p.n); }

  // Everything wrong with a set of stars: overfull rows, columns and regions, and stars
  // that touch. `bad` lists the stars to mark red; `solved` is true only when every row,
  // column and region has exactly k stars and none of them touch.
  function check(p, marks) {
    const n = p.n, k = p.k, N = n * n;
    const star = normalMarks(p, marks);
    const rows = new Array(n).fill(0), cols = new Array(n).fill(0), regions = new Array(n).fill(0);
    const cells = [];
    for (let i = 0; i < N; i++) {
      if (!star[i]) continue;
      const r = (i / n) | 0, c = i % n;
      cells.push(i);
      rows[r]++; cols[c]++; regions[p.regions[i]]++;
    }
    const over = { rows: [], cols: [], regions: [] }, under = { rows: [], cols: [], regions: [] };
    for (let i = 0; i < n; i++) {
      if (rows[i] > k) over.rows.push(i); else if (rows[i] < k) under.rows.push(i);
      if (cols[i] > k) over.cols.push(i); else if (cols[i] < k) under.cols.push(i);
      if (regions[i] > k) over.regions.push(i); else if (regions[i] < k) under.regions.push(i);
    }
    const touching = [];
    for (let a = 0; a < cells.length; a++) {
      const ra = (cells[a] / n) | 0, ca = cells[a] % n;
      for (let b = a + 1; b < cells.length; b++) {
        const rb = (cells[b] / n) | 0, cb = cells[b] % n;
        if (Math.abs(ra - rb) <= 1 && Math.abs(ca - cb) <= 1) touching.push([cells[a], cells[b]]);
      }
    }
    const badSet = new Set();
    const addRowStars = (r) => { for (const cell of cells) if (((cell / n) | 0) === r) badSet.add(cell); };
    const addColStars = (c) => { for (const cell of cells) if (cell % n === c) badSet.add(cell); };
    const addRegionStars = (gid) => { for (const cell of cells) if (p.regions[cell] === gid) badSet.add(cell); };
    over.rows.forEach(addRowStars);
    over.cols.forEach(addColStars);
    over.regions.forEach(addRegionStars);
    for (const pair of touching) { badSet.add(pair[0]); badSet.add(pair[1]); }
    const solved = cells.length === n * k &&
      over.rows.length === 0 && over.cols.length === 0 && over.regions.length === 0 &&
      under.rows.length === 0 && under.cols.length === 0 && under.regions.length === 0 &&
      touching.length === 0;
    return {
      solved: solved,
      stars: cells.length,
      rows: rows, cols: cols, regions: regions,
      over: over,
      under: under,
      touching: touching,
      bad: Array.from(badSet).sort((a, b) => a - b),
    };
  }
  function checkSolution(p) {
    return check(p, marksFromSolution(p));
  }

  /* ---------- hints ----------
     One star of the stored answer that the player has not placed yet, or null when every
     stored star is already on the board. */
  function hint(p, marks) {
    const star = normalMarks(p, marks);
    for (const cell of p.solution) {
      if (!star[cell]) return { cell: cell, row: (cell / p.n) | 0, col: cell % p.n };
    }
    return null;
  }

  g.StarBattlePuzzle = {
    GAME,
    LEVELS,
    generate,
    generateDaily,
    dailySeed,
    solve,
    countSolutions,
    check,
    checkSolution,
    hint,
    marksFromSolution,
    emptyMarks,
    mulberry32,
    hashStr,
  };
})(globalThis);
