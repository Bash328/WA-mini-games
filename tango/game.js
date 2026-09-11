(function () {
  "use strict";

  const N = 6;
  const SUN = 1, MOON = 2, EMPTY = 0;
  const SUN_CH = "●", MOON_CH = "☽";

  // Difficulty: [givens, edges] target
  const DIFFS = {
    easy:   { givens: 16, edges: 10 },
    medium: { givens: 10, edges:  8 },
    hard:   { givens:  6, edges:  7 },
  };

  const boardEl = document.getElementById("board");
  const statusEl = document.getElementById("status");
  const timeEl = document.getElementById("time");
  const bestEl = document.getElementById("best");
  const undoBtn = document.getElementById("undo-btn");
  const resetBtn = document.getElementById("reset-btn");
  const hintBtn = document.getElementById("hint-btn");
  const newBtn = document.getElementById("new-btn");
  const chipsEl = document.getElementById("chips");

  const store = Gamekit.storage("tango:");
  let diff = store.get("diff", "medium");
  if (!DIFFS[diff]) diff = "medium";

  // State
  let solution = new Uint8Array(N * N);
  let givens = new Uint8Array(N * N);
  let grid = new Uint8Array(N * N);
  // edges: array of { a: idx, b: idx, type: 'eq' | 'neq' }
  let edges = [];
  let history = [];
  let won = false;
  let elapsed = 0;
  let timerStart = 0;
  let timerInterval = null;
  let cellEls = [];
  let edgeEls = [];

  function idx(r, c) { return r * N + c; }
  function rof(i) { return Math.floor(i / N); }
  function cof(i) { return i % N; }

  // Validity of grid for Tango. Returns null if ok, or { bad: [indices] } with offending cells.
  function violations(g, edges) {
    const bad = new Set();
    // Row/col runs of 3 + counts
    for (let r = 0; r < N; r++) {
      let suns = 0, moons = 0;
      for (let c = 0; c < N; c++) {
        const v = g[idx(r, c)];
        if (v === SUN) suns++;
        else if (v === MOON) moons++;
        if (c >= 2) {
          const a = g[idx(r, c - 2)], b = g[idx(r, c - 1)], cc = v;
          if (a !== EMPTY && a === b && b === cc) {
            bad.add(idx(r, c - 2)); bad.add(idx(r, c - 1)); bad.add(idx(r, c));
          }
        }
      }
      if (suns > N / 2) for (let c = 0; c < N; c++) if (g[idx(r, c)] === SUN) bad.add(idx(r, c));
      if (moons > N / 2) for (let c = 0; c < N; c++) if (g[idx(r, c)] === MOON) bad.add(idx(r, c));
    }
    for (let c = 0; c < N; c++) {
      let suns = 0, moons = 0;
      for (let r = 0; r < N; r++) {
        const v = g[idx(r, c)];
        if (v === SUN) suns++;
        else if (v === MOON) moons++;
        if (r >= 2) {
          const a = g[idx(r - 2, c)], b = g[idx(r - 1, c)], cc = v;
          if (a !== EMPTY && a === b && b === cc) {
            bad.add(idx(r - 2, c)); bad.add(idx(r - 1, c)); bad.add(idx(r, c));
          }
        }
      }
      if (suns > N / 2)  for (let r = 0; r < N; r++) if (g[idx(r, c)] === SUN)  bad.add(idx(r, c));
      if (moons > N / 2) for (let r = 0; r < N; r++) if (g[idx(r, c)] === MOON) bad.add(idx(r, c));
    }
    for (const e of edges) {
      const a = g[e.a], b = g[e.b];
      if (a === EMPTY || b === EMPTY) continue;
      if (e.type === "eq"  && a !== b) { bad.add(e.a); bad.add(e.b); }
      if (e.type === "neq" && a === b) { bad.add(e.a); bad.add(e.b); }
    }
    return bad;
  }

  // Given a partial grid `g` and current `edges`, check if placing v at i is locally feasible.
  function isFeasible(g, i, v, edges) {
    g[i] = v;
    const r = rof(i), c = cof(i);
    // Row run of 3 including i?
    function run(getter) {
      let runLen = 1, runVal = v;
      let cnt = (v === SUN) ? 1 : (v === MOON ? 1 : 0);
      // Only need to check locally — full check in solver via violations on completion
      // We'll do a simple check: no triple anywhere in this row/col containing i
      return true;
    }
    // Simple approach: check row for any triple / count overflow
    function rowOK(rr) {
      let s = 0, m = 0;
      for (let cc = 0; cc < N; cc++) {
        const x = g[idx(rr, cc)];
        if (x === SUN) s++; else if (x === MOON) m++;
      }
      if (s > N / 2 || m > N / 2) return false;
      for (let cc = 0; cc <= N - 3; cc++) {
        const a = g[idx(rr, cc)], b = g[idx(rr, cc + 1)], d = g[idx(rr, cc + 2)];
        if (a !== EMPTY && a === b && b === d) return false;
      }
      return true;
    }
    function colOK(cc) {
      let s = 0, m = 0;
      for (let rr = 0; rr < N; rr++) {
        const x = g[idx(rr, cc)];
        if (x === SUN) s++; else if (x === MOON) m++;
      }
      if (s > N / 2 || m > N / 2) return false;
      for (let rr = 0; rr <= N - 3; rr++) {
        const a = g[idx(rr, cc)], b = g[idx(rr + 1, cc)], d = g[idx(rr + 2, cc)];
        if (a !== EMPTY && a === b && b === d) return false;
      }
      return true;
    }
    const rOK = rowOK(r), cOK = colOK(c);
    let eOK = true;
    for (const e of edges) {
      if (e.a !== i && e.b !== i) continue;
      const other = e.a === i ? e.b : e.a;
      if (g[other] === EMPTY) continue;
      if (e.type === "eq"  && g[other] !== v) { eOK = false; break; }
      if (e.type === "neq" && g[other] === v) { eOK = false; break; }
    }
    g[i] = EMPTY;
    return rOK && cOK && eOK;
  }

  // Full filler / solver. Fills `g` in-place. Returns true on success.
  function fillGrid(g, rng) {
    function step(pos) {
      if (pos >= N * N) return true;
      if (g[pos] !== EMPTY) return step(pos + 1);
      const order = rng() < 0.5 ? [SUN, MOON] : [MOON, SUN];
      for (const v of order) {
        if (isFeasible(g, pos, v, [])) {
          g[pos] = v;
          if (step(pos + 1)) return true;
          g[pos] = EMPTY;
        }
      }
      return false;
    }
    return step(0);
  }

  // Solver counts solutions up to `limit`.
  function countSolutions(gStart, edges, limit) {
    const g = new Uint8Array(gStart);
    let count = 0;
    function step(pos) {
      if (count >= limit) return;
      // Advance to next empty
      while (pos < N * N && g[pos] !== EMPTY) pos++;
      if (pos >= N * N) { count++; return; }
      for (const v of [SUN, MOON]) {
        if (isFeasible(g, pos, v, edges)) {
          g[pos] = v;
          step(pos + 1);
          g[pos] = EMPTY;
          if (count >= limit) return;
        }
      }
    }
    step(0);
    return count;
  }

  function allAdjEdges() {
    const res = [];
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        if (c + 1 < N) res.push({ a: idx(r, c), b: idx(r, c + 1), dir: "h" });
        if (r + 1 < N) res.push({ a: idx(r, c), b: idx(r + 1, c), dir: "v" });
      }
    }
    return res;
  }

  function generate(seed) {
    const rng = Gamekit.mulberry32(seed);
    const conf = DIFFS[diff];
    // Fill valid grid
    let sol = null;
    for (let tries = 0; tries < 20; tries++) {
      const g = new Uint8Array(N * N);
      if (fillGrid(g, rng)) { sol = g; break; }
    }
    if (!sol) sol = new Uint8Array(N * N); // unlikely fallback

    // Pick edge set: start empty; try adding edges that remain consistent with sol.
    const allEdges = Gamekit.shuffle(allAdjEdges(), rng);
    const chosenEdges = [];
    for (const e of allEdges) {
      if (chosenEdges.length >= conf.edges) break;
      const type = sol[e.a] === sol[e.b] ? "eq" : "neq";
      chosenEdges.push({ a: e.a, b: e.b, type: type });
    }

    // Dig: start with full given board, try to remove cells while maintaining uniqueness.
    const given = new Uint8Array(sol);
    const order = Gamekit.shuffle(Array.from({ length: N * N }, (_, i) => i), rng);
    let givenCount = N * N;
    for (const i of order) {
      if (givenCount <= conf.givens) break;
      const saved = given[i];
      given[i] = EMPTY;
      const n = countSolutions(given, chosenEdges, 2);
      if (n !== 1) given[i] = saved;
      else givenCount--;
    }

    return { solution: sol, givens: given, edges: chosenEdges };
  }

  function newPuzzle(seedOverride) {
    const seed = seedOverride !== undefined ? seedOverride : Gamekit.dailySeed("tango", diff);
    const p = generate(seed);
    solution = p.solution;
    givens = p.givens;
    edges = p.edges;
    grid = new Uint8Array(givens);
    history = [];
    won = false;
    timerStart = Date.now();
    startTimer();
    renderShell();
    renderAll();
    updateStatus();
  }

  function renderShell() {
    // Clear
    boardEl.innerHTML = "";
    cellEls = [];
    edgeEls = [];
    // Cells
    for (let i = 0; i < N * N; i++) {
      const el = document.createElement("button");
      el.type = "button";
      el.className = "tg-cell fade-in" + (givens[i] ? " given" : "");
      el.style.animationDelay = (i * 8) + "ms";
      el.dataset.i = String(i);
      el.addEventListener("click", () => onTap(i));
      boardEl.appendChild(el);
      cellEls.push(el);
    }
    // Edges overlay — positioned absolutely within board
    // Compute cell positions after layout paints; do it async with rAF.
    requestAnimationFrame(() => positionEdges());
  }

  function positionEdges() {
    // remove old edge elements
    edgeEls.forEach(e => e.remove());
    edgeEls = [];
    const boardRect = boardEl.getBoundingClientRect();
    for (const e of edges) {
      const a = cellEls[e.a].getBoundingClientRect();
      const b = cellEls[e.b].getBoundingClientRect();
      const cx = (a.left + a.right + b.left + b.right) / 4 - boardRect.left;
      const cy = (a.top + a.bottom + b.top + b.bottom) / 4 - boardRect.top;
      const badge = document.createElement("div");
      badge.className = "tg-edge " + (e.type === "eq" ? "eq" : "neq");
      badge.textContent = e.type === "eq" ? "=" : "×";
      badge.style.left = cx + "px";
      badge.style.top = cy + "px";
      badge.style.transform = "translate(-50%, -50%)";
      boardEl.appendChild(badge);
      edgeEls.push(badge);
    }
  }
  let resizeTimer = null;
  window.addEventListener("resize", () => {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { resizeTimer = null; positionEdges(); }, 100);
  });

  function renderAll() {
    for (let i = 0; i < N * N; i++) {
      const el = cellEls[i];
      el.classList.remove("sun", "moon", "error");
      const v = grid[i];
      if (v === SUN) { el.classList.add("sun"); el.textContent = SUN_CH; }
      else if (v === MOON) { el.classList.add("moon"); el.textContent = MOON_CH; }
      else el.textContent = "";
    }
    const bad = violations(grid, edges);
    bad.forEach(i => cellEls[i].classList.add("error"));
  }

  function onTap(i) {
    if (won) return;
    if (givens[i]) return;
    history.push({ i: i, v: grid[i] });
    grid[i] = (grid[i] + 1) % 3;
    renderAll();
    checkWin();
  }

  function checkWin() {
    for (let i = 0; i < N * N; i++) if (grid[i] === EMPTY) return;
    const bad = violations(grid, edges);
    if (bad.size > 0) {
      statusEl.innerHTML = '<span class="bad">Not quite — fix highlighted cells.</span>';
      return;
    }
    won = true;
    const s = Math.floor((Date.now() - timerStart) / 1000);
    const best = store.getInt("best:" + diff, null);
    if (best === null || s < best) {
      store.set("best:" + diff, s);
      bestEl.textContent = Gamekit.fmtTime(s);
    }
    statusEl.innerHTML = '<span class="ok">Solved in ' + Gamekit.fmtTime(s) + '.</span>';
  }

  function startTimer() {
    if (timerInterval) clearInterval(timerInterval);
    timeEl.textContent = Gamekit.fmtTime(0);
    timerInterval = setInterval(() => {
      if (won) return;
      const s = Math.floor((Date.now() - timerStart) / 1000);
      timeEl.textContent = Gamekit.fmtTime(s);
    }, 500);
  }

  function updateStatus() {
    const best = store.getInt("best:" + diff, null);
    bestEl.textContent = best === null ? "—" : Gamekit.fmtTime(best);
  }

  undoBtn.addEventListener("click", () => {
    if (won) return;
    const h = history.pop();
    if (!h) return;
    grid[h.i] = h.v;
    statusEl.textContent = "Fill with suns and moons.";
    renderAll();
  });
  resetBtn.addEventListener("click", () => {
    grid = new Uint8Array(givens);
    history = [];
    won = false;
    timerStart = Date.now();
    startTimer();
    statusEl.textContent = "Fill with suns and moons.";
    renderAll();
  });
  hintBtn.addEventListener("click", () => {
    if (won) return;
    // Find an empty cell and reveal the correct answer
    const empties = [];
    for (let i = 0; i < N * N; i++) if (grid[i] === EMPTY) empties.push(i);
    if (empties.length === 0) return;
    const i = empties[Math.floor(Math.random() * empties.length)];
    history.push({ i: i, v: grid[i] });
    grid[i] = solution[i];
    renderAll();
    checkWin();
  });
  newBtn.addEventListener("click", () => newPuzzle(Gamekit.randomSeed()));

  Gamekit.wireDifficultyChips({
    el: chipsEl,
    difficulties: ["easy", "medium", "hard"],
    initial: diff,
    storage: store,
    storageKey: "diff",
    onChange: (d) => { diff = d; newPuzzle(); updateStatus(); },
  });
  diff = store.get("diff", diff);
  if (!DIFFS[diff]) diff = "medium";

  newPuzzle();
  updateStatus();
  window.addEventListener("load", () => Manpage.autoOpen("tango"));
})();
