(function () {
  "use strict";

  const DIFFS = { easy: 6, medium: 7, hard: 8 };
  const EMPTY = 0, MARK = 1, QUEEN = 2;

  const boardEl = document.getElementById("board");
  const statusEl = document.getElementById("status");
  const timeEl = document.getElementById("time");
  const bestEl = document.getElementById("best");
  const undoBtn = document.getElementById("undo-btn");
  const resetBtn = document.getElementById("reset-btn");
  const hintBtn = document.getElementById("hint-btn");
  const newBtn = document.getElementById("new-btn");
  const chipsEl = document.getElementById("chips");

  const store = Gamekit.storage("queens:");
  let diff = store.get("diff", "medium");
  if (!DIFFS[diff]) diff = "medium";
  let N = DIFFS[diff];

  let regions = [];      // length N*N, region id 0..N-1
  let solution = [];     // length N: col for each row (the hidden queen solution)
  let grid = [];         // length N*N, EMPTY | MARK | QUEEN
  let history = [];
  let won = false;
  let timerStart = 0;
  let timerInterval = null;
  let cellEls = [];

  function idx(r, c) { return r * N + c; }

  // Place non-attacking queens (one per row; no same column; no 8-adjacency with prev row).
  function placeQueens(rng) {
    const cols = new Array(N).fill(-1);
    function step(r) {
      if (r === N) return true;
      const order = Gamekit.shuffle(Array.from({ length: N }, (_, i) => i), rng);
      for (const c of order) {
        let bad = false;
        for (let pr = 0; pr < r; pr++) {
          if (cols[pr] === c) { bad = true; break; }
          if (pr === r - 1 && Math.abs(cols[pr] - c) <= 1) { bad = true; break; }
        }
        if (bad) continue;
        cols[r] = c;
        if (step(r + 1)) return true;
        cols[r] = -1;
      }
      return false;
    }
    return step(0) ? cols : null;
  }

  // Grow regions by BFS from each queen cell.
  function growRegions(queenCols, rng) {
    const reg = new Int8Array(N * N).fill(-1);
    // Queen cells seed regions 0..N-1
    for (let r = 0; r < N; r++) {
      reg[idx(r, queenCols[r])] = r;
    }
    // Repeatedly pick an unassigned cell adjacent to some region and assign it.
    // Use a frontier list per region.
    const frontiers = [];
    for (let i = 0; i < N; i++) frontiers.push([]);
    function addFrontiers(r, c, rid) {
      const n = [[r-1,c],[r+1,c],[r,c-1],[r,c+1]];
      for (const [nr, nc] of n) {
        if (nr < 0 || nr >= N || nc < 0 || nc >= N) continue;
        if (reg[idx(nr, nc)] === -1) frontiers[rid].push([nr, nc]);
      }
    }
    for (let r = 0; r < N; r++) addFrontiers(r, queenCols[r], r);

    let remaining = N * N - N;
    while (remaining > 0) {
      // Pick a region that still has frontier cells (prefer smaller regions to keep them growing)
      const sizes = new Array(N).fill(0);
      for (let i = 0; i < N * N; i++) if (reg[i] >= 0) sizes[reg[i]]++;
      const candidates = [];
      for (let rid = 0; rid < N; rid++) {
        if (frontiers[rid].length === 0) continue;
        // Weight = (1 / size) — smaller regions get more mass
        candidates.push({ rid, w: 1 / sizes[rid] });
      }
      if (candidates.length === 0) {
        // Dead-end: assign remaining cells to any neighbor's region
        for (let r = 0; r < N; r++) {
          for (let c = 0; c < N; c++) {
            if (reg[idx(r, c)] !== -1) continue;
            const n = [[r-1,c],[r+1,c],[r,c-1],[r,c+1]];
            for (const [nr, nc] of n) {
              if (nr < 0 || nr >= N || nc < 0 || nc >= N) continue;
              if (reg[idx(nr, nc)] !== -1) { reg[idx(r, c)] = reg[idx(nr, nc)]; remaining--; break; }
            }
          }
        }
        break;
      }
      const total = candidates.reduce((a, x) => a + x.w, 0);
      let pick = rng() * total;
      let chosen = candidates[0];
      for (const cand of candidates) {
        pick -= cand.w;
        if (pick <= 0) { chosen = cand; break; }
      }
      const rid = chosen.rid;
      // Filter frontier to still-unassigned cells
      frontiers[rid] = frontiers[rid].filter(([r, c]) => reg[idx(r, c)] === -1);
      if (frontiers[rid].length === 0) continue;
      const pos = Math.floor(rng() * frontiers[rid].length);
      const [fr, fc] = frontiers[rid][pos];
      reg[idx(fr, fc)] = rid;
      remaining--;
      addFrontiers(fr, fc, rid);
    }
    return Array.from(reg);
  }

  // Count solutions to the region puzzle. `regions` is array of length N*N.
  // Uses bitmasks for column/region usage — faster than arrays at N=7/8.
  function countSolutions(regions, limit) {
    let colMask = 0, regMask = 0;
    const chosen = new Array(N).fill(-1);
    let count = 0;
    function step(r) {
      if (count >= limit) return;
      if (r === N) { count++; return; }
      const prev = r > 0 ? chosen[r - 1] : -2;
      for (let c = 0; c < N; c++) {
        const cb = 1 << c;
        if (colMask & cb) continue;
        if (prev >= 0 && Math.abs(prev - c) <= 1) continue;
        const rg = regions[r * N + c];
        const rb = 1 << rg;
        if (regMask & rb) continue;
        colMask |= cb; regMask |= rb; chosen[r] = c;
        step(r + 1);
        colMask ^= cb; regMask ^= rb;
        if (count >= limit) return;
      }
    }
    step(0);
    return count;
  }

  function generate(seed) {
    const rng = Gamekit.mulberry32(seed);
    for (let attempt = 0; attempt < 60; attempt++) {
      const qCols = placeQueens(rng);
      if (!qCols) continue;
      const reg = growRegions(qCols, rng);
      if (!reg) continue;
      const n = countSolutions(reg, 2);
      if (n === 1) {
        return { regions: reg, solution: qCols };
      }
    }
    // Fallback: just return last attempt even if not unique.
    const qCols = placeQueens(rng) || new Array(N).fill(0).map((_, i) => i);
    const reg = growRegions(qCols, rng);
    return { regions: reg, solution: qCols };
  }

  function newPuzzle(seedOverride) {
    N = DIFFS[diff];
    const seed = seedOverride !== undefined ? seedOverride : Gamekit.dailySeed("queens", diff);
    const p = generate(seed);
    regions = p.regions;
    solution = p.solution;
    grid = new Array(N * N).fill(EMPTY);
    history = [];
    won = false;
    timerStart = Date.now();
    startTimer();
    renderShell();
    renderAll();
    updateStatus();
  }

  function renderShell() {
    boardEl.style.gridTemplateColumns = "repeat(" + N + ", 1fr)";
    boardEl.style.gridTemplateRows = "repeat(" + N + ", 1fr)";
    boardEl.innerHTML = "";
    cellEls = [];
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const i = idx(r, c);
        const el = document.createElement("button");
        el.type = "button";
        const rg = regions[i];
        el.className = "qn-cell fade-in r" + rg;
        el.style.animationDelay = (i * 6) + "ms";
        // Thick borders on region boundaries
        if (r === 0 || regions[idx(r - 1, c)] !== rg) el.classList.add("br-t");
        if (r === N - 1 || regions[idx(r + 1, c)] !== rg) el.classList.add("br-b");
        if (c === 0 || regions[idx(r, c - 1)] !== rg) el.classList.add("br-l");
        if (c === N - 1 || regions[idx(r, c + 1)] !== rg) el.classList.add("br-r");
        el.dataset.i = String(i);
        el.addEventListener("click", () => onTap(i));
        boardEl.appendChild(el);
        cellEls.push(el);
      }
    }
  }

  function renderAll() {
    for (let i = 0; i < N * N; i++) {
      const el = cellEls[i];
      el.innerHTML = "";
      el.classList.remove("err");
      if (grid[i] === MARK) {
        const m = document.createElement("span"); m.className = "mk"; m.textContent = "×"; el.appendChild(m);
      } else if (grid[i] === QUEEN) {
        const q = document.createElement("span"); q.className = "qq"; q.textContent = "♛"; el.appendChild(q);
      }
    }
    // Conflict highlights for queens
    const conflicts = findQueenConflicts();
    conflicts.forEach(i => cellEls[i].classList.add("err"));
  }

  function findQueenConflicts() {
    const bad = new Set();
    const queens = [];
    for (let i = 0; i < N * N; i++) if (grid[i] === QUEEN) queens.push(i);
    const colCount = {}, rowCount = {}, regCount = {};
    for (const i of queens) {
      const r = Math.floor(i / N), c = i % N;
      rowCount[r] = (rowCount[r] || 0) + 1;
      colCount[c] = (colCount[c] || 0) + 1;
      regCount[regions[i]] = (regCount[regions[i]] || 0) + 1;
    }
    for (const i of queens) {
      const r = Math.floor(i / N), c = i % N;
      if (rowCount[r] > 1) bad.add(i);
      if (colCount[c] > 1) bad.add(i);
      if (regCount[regions[i]] > 1) bad.add(i);
    }
    // 8-adj
    for (let a = 0; a < queens.length; a++) {
      for (let b = a + 1; b < queens.length; b++) {
        const ra = Math.floor(queens[a] / N), ca = queens[a] % N;
        const rb = Math.floor(queens[b] / N), cb = queens[b] % N;
        if (Math.abs(ra - rb) <= 1 && Math.abs(ca - cb) <= 1) { bad.add(queens[a]); bad.add(queens[b]); }
      }
    }
    return bad;
  }

  function onTap(i) {
    if (won) return;
    history.push({ i, v: grid[i] });
    grid[i] = (grid[i] + 1) % 3;
    renderAll();
    checkWin();
  }

  function checkWin() {
    let qc = 0;
    for (let i = 0; i < N * N; i++) if (grid[i] === QUEEN) qc++;
    if (qc !== N) return;
    const bad = findQueenConflicts();
    if (bad.size > 0) {
      statusEl.innerHTML = '<span class="bad">Conflicts remain — fix highlighted queens.</span>';
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
    // Golden blink on all queen cells
    for (let i = 0; i < N * N; i++) {
      if (grid[i] === QUEEN) cellEls[i].classList.add("won");
    }
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
    renderAll();
    statusEl.textContent = "One queen per row, column, and color.";
  });
  resetBtn.addEventListener("click", () => {
    grid = new Array(N * N).fill(EMPTY);
    history = [];
    won = false;
    timerStart = Date.now();
    startTimer();
    statusEl.textContent = "One queen per row, column, and color.";
    renderAll();
  });
  hintBtn.addEventListener("click", () => {
    if (won) return;
    // Find a row that doesn't yet have the correct queen placed; place it.
    for (let r = 0; r < N; r++) {
      const target = idx(r, solution[r]);
      if (grid[target] !== QUEEN) {
        history.push({ i: target, v: grid[target] });
        grid[target] = QUEEN;
        renderAll();
        checkWin();
        return;
      }
    }
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
  N = DIFFS[diff];

  newPuzzle();
  updateStatus();
  window.addEventListener("load", () => Manpage.autoOpen("queens"));
})();
