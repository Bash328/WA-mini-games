(function () {
  "use strict";

  const DIFFS = { easy: 5, medium: 6, hard: 7 };

  const boardEl = document.getElementById("board");
  const statusEl = document.getElementById("status");
  const timeEl = document.getElementById("time");
  const bestEl = document.getElementById("best");
  const undoBtn = document.getElementById("undo-btn");
  const resetBtn = document.getElementById("reset-btn");
  const newBtn = document.getElementById("new-btn");
  const chipsEl = document.getElementById("chips");

  const store = Gamekit.storage("patches:");
  let diff = store.get("diff", "medium");
  if (!DIFFS[diff]) diff = "medium";

  let N;
  let clues = []; // {r, c, v} — clue position + area value
  let userRects = []; // {r0, c0, r1, c1}
  let won = false;
  let timerStart = 0;
  let timerInterval = null;
  let cellEls = [];

  // Drag state
  let dragStart = null; // [r,c]
  let dragEnd = null;

  function idx(r, c) { return r * N + c; }

  // Generate a random rectangle partition via scan-based fill
  function partition(rng) {
    const board = new Int32Array(N * N).fill(-1);
    const rects = [];
    let id = 0;
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        if (board[idx(r, c)] !== -1) continue;
        // Max width: consecutive empty cells to the right in this row
        let maxW = 0;
        while (c + maxW < N && board[idx(r, c + maxW)] === -1) maxW++;
        // Pick random width (bias toward moderate sizes)
        const w = 1 + Math.floor(rng() * maxW);
        // Max height: scan downward, every row must have cols c..c+w-1 empty
        let maxH = 0;
        outer: for (let h = 0; r + h < N; h++) {
          for (let cc = c; cc < c + w; cc++) {
            if (board[idx(r + h, cc)] !== -1) break outer;
          }
          maxH = h + 1;
        }
        const h = 1 + Math.floor(rng() * maxH);
        // Fill
        for (let rr = r; rr < r + h; rr++) {
          for (let cc = c; cc < c + w; cc++) {
            board[idx(rr, cc)] = id;
          }
        }
        rects.push({ r0: r, c0: c, r1: r + h - 1, c1: c + w - 1 });
        id++;
      }
    }
    return rects;
  }

  function clueFor(rect, rng) {
    const area = (rect.r1 - rect.r0 + 1) * (rect.c1 - rect.c0 + 1);
    // Pick a random cell in the rectangle
    const cellCount = area;
    const pick = Math.floor(rng() * cellCount);
    const rowsInRect = rect.r1 - rect.r0 + 1;
    const colsInRect = rect.c1 - rect.c0 + 1;
    const dr = Math.floor(pick / colsInRect);
    const dc = pick % colsInRect;
    return { r: rect.r0 + dr, c: rect.c0 + dc, v: area };
  }

  // Solver: count solutions. Returns 0, 1, or 2 (capped).
  function countSolutions(clues, N, limit) {
    const owner = new Int32Array(N * N).fill(-1);
    // Mark clue cells as pre-assigned? No — owner tracks which clue owns each cell.
    function valid(rect, clueIdx) {
      const { r0, c0, r1, c1 } = rect;
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          if (owner[idx(r, c)] !== -1) return false;
          // Can't contain another clue
          for (let k = 0; k < clues.length; k++) {
            if (k === clueIdx) continue;
            if (clues[k].r === r && clues[k].c === c) return false;
          }
        }
      }
      return true;
    }
    function placementsFor(ci) {
      const { r, c, v } = clues[ci];
      const out = [];
      // All (w, h) factor pairs where w*h = v
      for (let w = 1; w <= v; w++) {
        if (v % w !== 0) continue;
        const h = v / w;
        // Rectangle of width w, height h, containing (r,c)
        for (let r0 = Math.max(0, r - h + 1); r0 <= r && r0 + h - 1 < N; r0++) {
          for (let c0 = Math.max(0, c - w + 1); c0 <= c && c0 + w - 1 < N; c0++) {
            const rect = { r0, c0, r1: r0 + h - 1, c1: c0 + w - 1 };
            if (valid(rect, ci)) out.push(rect);
          }
        }
      }
      return out;
    }
    let count = 0;
    function step() {
      if (count >= limit) return;
      // Find unfilled clue with MRV
      let bestCi = -1, bestPlacements = null;
      for (let ci = 0; ci < clues.length; ci++) {
        // Is this clue already placed? Check if clue cell has owner = ci
        if (owner[idx(clues[ci].r, clues[ci].c)] === ci) continue;
        const ps = placementsFor(ci);
        if (ps.length === 0) return;
        if (bestPlacements === null || ps.length < bestPlacements.length) {
          bestCi = ci; bestPlacements = ps;
          if (ps.length === 1) break;
        }
      }
      if (bestCi === -1) {
        // All clues placed. Check all cells covered.
        for (let i = 0; i < N * N; i++) if (owner[i] === -1) return;
        count++;
        return;
      }
      for (const rect of bestPlacements) {
        // Place
        for (let r = rect.r0; r <= rect.r1; r++) {
          for (let c = rect.c0; c <= rect.c1; c++) owner[idx(r, c)] = bestCi;
        }
        step();
        // Unplace
        for (let r = rect.r0; r <= rect.r1; r++) {
          for (let c = rect.c0; c <= rect.c1; c++) owner[idx(r, c)] = -1;
        }
        if (count >= limit) return;
      }
    }
    step();
    return count;
  }

  function generate(seed) {
    const rng = Gamekit.mulberry32(seed);
    N = DIFFS[diff];
    for (let attempt = 0; attempt < 80; attempt++) {
      const rects = partition(rng);
      if (rects.length < 3) continue;
      const cs = rects.map(r => clueFor(r, rng));
      // Skip degenerate: too few clues or all 1×1
      if (cs.every(c => c.v === 1)) continue;
      const count = countSolutions(cs, N, 2);
      if (count === 1) {
        clues = cs;
        return;
      }
    }
    // Fallback: just use last attempt
    const rects = partition(rng);
    clues = rects.map(r => clueFor(r, rng));
  }

  function newPuzzle(seedOverride) {
    const seed = seedOverride !== undefined ? seedOverride : Gamekit.dailySeed("patches", diff);
    generate(seed);
    userRects = [];
    won = false;
    timerStart = Date.now();
    startTimer();
    renderShell();
    renderRects();
    statusEl.textContent = "Draw rectangles — each clue's number = its rectangle's area.";
    updateStatus();
  }

  function renderShell() {
    boardEl.style.gridTemplateColumns = "repeat(" + N + ", 1fr)";
    boardEl.style.gridTemplateRows = "repeat(" + N + ", 1fr)";
    // Remove cells + overlays
    boardEl.innerHTML = "";
    cellEls = [];
    const cluemap = {};
    clues.forEach(c => { cluemap[c.r * N + c.c] = c.v; });
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const el = document.createElement("div");
        el.className = "pt-cell fade-in";
        el.dataset.r = String(r); el.dataset.c = String(c);
        el.style.animationDelay = ((r * N + c) * 6) + "ms";
        const key = r * N + c;
        if (cluemap[key] !== undefined) {
          el.classList.add("clue");
          el.textContent = String(cluemap[key]);
        }
        boardEl.appendChild(el);
        cellEls.push(el);
      }
    }
  }
  boardEl.addEventListener("pointerdown", onPointerDown);
  boardEl.addEventListener("pointermove", onPointerMove);
  boardEl.addEventListener("pointerup", onPointerUp);
  boardEl.addEventListener("pointercancel", onPointerUp);

  function cellFromEvent(e) {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el) return null;
    const cell = el.closest(".pt-cell");
    if (!cell || !boardEl.contains(cell)) return null;
    return [Number(cell.dataset.r), Number(cell.dataset.c)];
  }

  function onPointerDown(e) {
    if (won) return;
    // If the target is an overlay, clicking removes that rectangle — handled there.
    if (e.target.classList.contains("pt-rect-overlay")) return;
    const pos = cellFromEvent(e);
    if (!pos) return;
    dragStart = pos;
    dragEnd = pos;
    try { boardEl.setPointerCapture(e.pointerId); } catch (_) {}
    updateDragHighlight();
  }
  function onPointerMove(e) {
    if (!dragStart) return;
    const pos = cellFromEvent(e);
    if (!pos) return;
    dragEnd = pos;
    updateDragHighlight();
  }
  function onPointerUp(e) {
    if (!dragStart) return;
    const r0 = Math.min(dragStart[0], dragEnd[0]);
    const r1 = Math.max(dragStart[0], dragEnd[0]);
    const c0 = Math.min(dragStart[1], dragEnd[1]);
    const c1 = Math.max(dragStart[1], dragEnd[1]);
    dragStart = null; dragEnd = null;
    try { boardEl.releasePointerCapture(e.pointerId); } catch (_) {}
    clearDragHighlight();
    userRects.push({ r0, c0, r1, c1 });
    renderRects();
    checkWin();
  }

  function updateDragHighlight() {
    clearDragHighlight();
    if (!dragStart || !dragEnd) return;
    const r0 = Math.min(dragStart[0], dragEnd[0]);
    const r1 = Math.max(dragStart[0], dragEnd[0]);
    const c0 = Math.min(dragStart[1], dragEnd[1]);
    const c1 = Math.max(dragStart[1], dragEnd[1]);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        cellEls[r * N + c].classList.add("drag");
      }
    }
  }
  function clearDragHighlight() {
    cellEls.forEach(el => el.classList.remove("drag"));
  }

  function renderRects() {
    Array.from(boardEl.querySelectorAll(".pt-rect-overlay")).forEach(o => o.remove());
    const brect = boardEl.getBoundingClientRect();
    for (let i = 0; i < userRects.length; i++) {
      const { r0, c0, r1, c1 } = userRects[i];
      const a = cellEls[r0 * N + c0].getBoundingClientRect();
      const b = cellEls[r1 * N + c1].getBoundingClientRect();
      const div = document.createElement("div");
      div.className = "pt-rect-overlay pc" + (i % 12);
      // Validate: exactly one clue inside, area match
      const cluesInside = clues.filter(cl => cl.r >= r0 && cl.r <= r1 && cl.c >= c0 && cl.c <= c1);
      const area = (r1 - r0 + 1) * (c1 - c0 + 1);
      const ok = cluesInside.length === 1 && cluesInside[0].v === area;
      if (!ok) div.classList.add("bad");
      div.style.left = (a.left - brect.left) + "px";
      div.style.top = (a.top - brect.top) + "px";
      div.style.width = (b.right - a.left) + "px";
      div.style.height = (b.bottom - a.top) + "px";
      div.dataset.i = String(i);
      div.addEventListener("pointerdown", (ev) => { ev.stopPropagation(); });
      div.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const ix = Number(div.dataset.i);
        userRects.splice(ix, 1);
        renderRects();
        checkWin();
      });
      boardEl.appendChild(div);
    }
  }

  function checkWin() {
    // All cells covered exactly once, each rect has exactly one clue with area matching
    const cover = new Int32Array(N * N).fill(0);
    for (const rect of userRects) {
      const { r0, c0, r1, c1 } = rect;
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) cover[idx(r, c)]++;
      }
    }
    for (let i = 0; i < N * N; i++) if (cover[i] !== 1) return;
    for (const rect of userRects) {
      const cluesInside = clues.filter(cl => cl.r >= rect.r0 && cl.r <= rect.r1 && cl.c >= rect.c0 && cl.c <= rect.c1);
      const area = (rect.r1 - rect.r0 + 1) * (rect.c1 - rect.c0 + 1);
      if (cluesInside.length !== 1 || cluesInside[0].v !== area) return;
    }
    won = true;
    const s = Math.floor((Date.now() - timerStart) / 1000);
    const best = store.getInt("best:" + diff, null);
    if (best === null || s < best) {
      store.set("best:" + diff, s);
      bestEl.textContent = Gamekit.fmtTime(s);
    }
    statusEl.innerHTML = '<span class="ok">Sewn up in ' + Gamekit.fmtTime(s) + '.</span>';
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
    if (userRects.length === 0 || won) return;
    userRects.pop();
    renderRects();
    statusEl.textContent = "Draw rectangles — each clue's number = its rectangle's area.";
  });
  resetBtn.addEventListener("click", () => {
    userRects = []; won = false;
    timerStart = Date.now(); startTimer();
    renderRects();
    statusEl.textContent = "Draw rectangles — each clue's number = its rectangle's area.";
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

  window.addEventListener("resize", () => renderRects());
  newPuzzle();
  updateStatus();
  window.addEventListener("load", () => Manpage.autoOpen("patches"));
})();
