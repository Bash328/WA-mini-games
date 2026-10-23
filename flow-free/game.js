/* ============================================================
   flow-free/game.js — the Flow Free page.

   The puzzle, the checker and the hint come from FlowPuzzle (puzzle.js).
   This file draws the board, takes the drags and taps, keeps Undo, restarts,
   times the solve and puts the game back after a refresh.

   A path always starts on one of its two dots and grows from its free end.
   Dragging (pointer events, so mouse and touch alike) walks the pipe through
   neighbouring cells; tapping extends it one cell at a time. Tapping a dot or
   a pipe lifts it.
   ============================================================ */
(function () {
  "use strict";

  const F = globalThis.FlowPuzzle;
  const $ = (id) => document.getElementById(id);
  const boardEl = $("board"), innerEl = $("inner"), gridEl = $("grid"), svgEl = $("svg");
  const statusEl = $("status"), movesEl = $("moves"), timeEl = $("time"), bestEl = $("best"), noteEl = $("hint");
  const undoBtn = $("undo-btn"), hintBtn = $("hint-btn"), resetBtn = $("reset-btn"), newBtn = $("new-btn"), randomBtn = $("random-btn"), chipsEl = $("chips");
  const store = Gamekit.storage("flow-free:");
  const SVGNS = "http://www.w3.org/2000/svg";

  let diff = store.get("diff", "medium");
  if (!F.LEVELS[diff]) diff = "medium";

  let puzzle = null, paths = [], curSeed = 0;
  let moves = 0, history = [], won = false, active = -1;
  let dragging = false, down = null;
  let hintFlow = -1, hintPath = null, hintTimer = null;
  let startAt = 0, elapsedBefore = 0, timer = null;

  const fmt = (s) => Gamekit.fmtTime(s);
  const total = () => elapsedBefore + (startAt ? (Date.now() - startAt) / 1000 : 0);
  const shell = (tag, cls) => { const e = document.createElement(tag); if (cls) e.className = cls; return e; };

  /* ---------- clock ---------- */
  function startTimer() {
    if (timer || won) return;
    startAt = Date.now();
    timer = setInterval(() => { timeEl.textContent = fmt(Math.floor(total())); }, 500);
  }
  function stopTimer() {
    if (timer) clearInterval(timer);
    timer = null;
    if (startAt) { elapsedBefore = total(); startAt = 0; }
  }
  function resetClock() {
    if (timer) clearInterval(timer);
    timer = null; startAt = 0; elapsedBefore = 0;
    timeEl.textContent = fmt(0);
  }

  /* ---------- board shell ---------- */
  function build() {
    boardEl.style.setProperty("--n", String(puzzle.n));
    boardEl.classList.remove("won");
    gridEl.replaceChildren();
    const N = puzzle.n * puzzle.n;
    for (let i = 0; i < N; i++) {
      const cell = shell("div", "ff-cell");
      cell.dataset.i = String(i);
      gridEl.appendChild(cell);
    }
    gridEl.setAttribute("aria-label", puzzle.n + " by " + puzzle.n + " grid, " + puzzle.flows.length + " pairs");
  }

  function cellPoint(i) {
    const n = puzzle.n;
    const w = innerEl.clientWidth, h = innerEl.clientHeight;
    return [((i % n) + 0.5) * w / n, (Math.floor(i / n) + 0.5) * h / n];
  }

  function line(pts, colour, width, opacity, dash, cls) {
    const el = document.createElementNS(SVGNS, "polyline");
    el.setAttribute("points", pts.map((p) => p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" "));
    el.setAttribute("fill", "none");
    el.setAttribute("stroke", colour);
    el.setAttribute("stroke-width", String(width));
    el.setAttribute("stroke-linecap", "round");
    el.setAttribute("stroke-linejoin", "round");
    if (opacity !== undefined) el.setAttribute("opacity", String(opacity));
    if (dash) el.setAttribute("stroke-dasharray", dash);
    if (cls) el.setAttribute("class", cls);
    return el;
  }

  function draw() {
    if (!puzzle) return;
    const w = innerEl.clientWidth, h = innerEl.clientHeight;
    if (!w || !h) return;
    svgEl.setAttribute("viewBox", "0 0 " + w + " " + h);
    const n = puzzle.n, cw = w / n;
    const frag = document.createDocumentFragment();

    for (let f = 0; f < puzzle.flows.length; f++) {
      const p = paths[f];
      if (p && p.length >= 2) frag.appendChild(line(p.map(cellPoint), puzzle.flows[f].colour, cw * 0.34, 1, undefined, "ff-pipe"));
    }

    if (hintFlow >= 0 && hintPath && puzzle.flows[hintFlow]) {
      const pts = hintPath.map(cellPoint);
      frag.appendChild(line(pts, puzzle.flows[hintFlow].colour, cw * 0.42, 0.30, undefined, "ff-hint-route"));
      frag.appendChild(line(pts, "#ffffff", cw * 0.12, 0.92, (cw * 0.15) + " " + (cw * 0.19), "ff-hint"));
    }

    for (const fl of puzzle.flows) {
      for (const c of [fl.a, fl.b]) {
        const at = cellPoint(c);
        const dot = document.createElementNS(SVGNS, "circle");
        dot.setAttribute("class", "ff-dot");
        dot.setAttribute("cx", at[0].toFixed(1)); dot.setAttribute("cy", at[1].toFixed(1));
        dot.setAttribute("r", (cw * 0.30).toFixed(1));
        dot.setAttribute("fill", fl.colour);
        dot.setAttribute("stroke", "rgba(0,0,0,.55)");
        dot.setAttribute("stroke-width", "2");
        frag.appendChild(dot);
        const shine = document.createElementNS(SVGNS, "circle");
        shine.setAttribute("class", "ff-dot-shine");
        shine.setAttribute("cx", at[0].toFixed(1)); shine.setAttribute("cy", at[1].toFixed(1));
        shine.setAttribute("r", (cw * 0.095).toFixed(1));
        shine.setAttribute("fill", "rgba(255,255,255,.85)");
        frag.appendChild(shine);
      }
    }
    svgEl.replaceChildren(frag);
  }

  /* ---------- coordinates and paths ---------- */
  function cellAt(x, y) {
    if (!puzzle) return -1;
    const r = innerEl.getBoundingClientRect();
    if (!r.width || !r.height) return -1;
    const n = puzzle.n;
    const c = Math.floor((x - r.left) / (r.width / n));
    const row = Math.floor((y - r.top) / (r.height / n));
    if (c < 0 || c >= n || row < 0 || row >= n) return -1;
    return row * n + c;
  }
  function pathFlowAt(cell) {
    for (let f = 0; f < paths.length; f++) if (paths[f].indexOf(cell) >= 0) return f;
    return -1;
  }
  function flowDone(f) { return F.isFlowDone(puzzle, f, paths[f]); }

  // Add one neighbouring cell to the pipe of flow f. Returns false when the
  // move is not allowed (another pipe, another colour's dot, its own start).
  function tryStep(f, cell) {
    const p = paths[f];
    if (!p || !p.length) return false;
    const n = puzzle.n;
    const head = p[p.length - 1];
    if (!F.adjacent(n, head, cell)) return false;
    if (cell === p[0]) return false;
    const dot = puzzle.endpoints[cell];
    if (dot >= 0 && dot !== f) return false;
    if (dot === f) {
      if (pathFlowAt(cell) >= 0) return false;
      p.push(cell);
      active = -1;
      if (down) down.mode = "done";
      return true;
    }
    if (pathFlowAt(cell) >= 0) return false;
    p.push(cell);
    active = f;
    return true;
  }

  // The first step of a short route from `head` to `target` through cells the
  // pipe may still use. A fast drag can jump several cells between samples;
  // this lets the pipe catch up through the free ones instead of stopping.
  function nextToward(f, head, target) {
    const n = puzzle.n, N = n * n;
    if (F.adjacent(n, head, target)) return target;
    const seen = new Uint8Array(N), prev = new Int16Array(N).fill(-1);
    const q = [head];
    seen[head] = 1;
    for (let qi = 0; qi < q.length; qi++) {
      const c = q[qi];
      for (const x of F.neighbours(n, c)) {
        if (seen[x]) continue;
        if (paths[f].indexOf(x) >= 0 && x !== target) continue;
        const dot = puzzle.endpoints[x];
        if (dot >= 0 && dot !== f && x !== target) continue;
        if (dot === f && x !== target) continue;
        if (pathFlowAt(x) >= 0 && x !== target) continue;
        seen[x] = 1;
        prev[x] = c;
        if (x === target) {
          let cur = target;
          while (prev[cur] !== head && prev[cur] !== -1) cur = prev[cur];
          return prev[cur] === head ? cur : -1;
        }
        q.push(x);
      }
    }
    return -1;
  }

  function dragTo(cell) {
    const f = down.f;
    if (f < 0 || !paths[f] || !paths[f].length) return;
    if (cell === paths[f][paths[f].length - 1]) return;            // still in the same cell
    const at = paths[f].indexOf(cell);
    if (at >= 0) { paths[f].length = at + 1; draw(); return; }    // back up over the pipe
    for (let guard = 0; guard < 16; guard++) {
      const p = paths[f];
      if (!p.length) return;
      const head = p[p.length - 1];
      if (F.adjacent(puzzle.n, head, cell)) { tryStep(f, cell); draw(); return; }
      const next = nextToward(f, head, cell);
      if (next < 0 || !tryStep(f, next)) return;
      draw();
    }
  }

  function tapExtend(cell) {
    if (active >= 0) {
      const p = paths[active];
      if (p.length && F.adjacent(puzzle.n, p[p.length - 1], cell) && tryStep(active, cell)) return true;
    }
    for (let f = 0; f < paths.length; f++) {
      const p = paths[f];
      if (!p.length || !F.adjacent(puzzle.n, p[p.length - 1], cell)) continue;
      if (tryStep(f, cell)) return true;
    }
    return false;
  }

  /* ---------- hints ---------- */
  function clearHint(thenDraw) {
    if (hintTimer) { clearTimeout(hintTimer); hintTimer = null; }
    hintFlow = -1; hintPath = null;
    if (noteEl) noteEl.textContent = "";
    if (thenDraw) draw();
  }
  function showHint() {
    if (won || !puzzle) return;
    const h = F.hint(puzzle, paths);
    if (!h) { noteEl.textContent = "That is the answer already."; return; }
    hintFlow = h.flow;
    hintPath = h.path;
    noteEl.textContent = "One pair's route is shown.";
    draw();
    if (hintTimer) clearTimeout(hintTimer);
    hintTimer = setTimeout(() => { hintFlow = -1; hintPath = null; noteEl.textContent = ""; draw(); }, 5000);
  }

  /* ---------- score line ---------- */
  function updateHud() {
    movesEl.textContent = String(moves);
    timeEl.textContent = fmt(Math.floor(total()));
    undoBtn.disabled = !history.length || won;
    hintBtn.disabled = won;
    if (won || !puzzle) return;
    let done = 0;
    for (let f = 0; f < puzzle.flows.length; f++) if (flowDone(f)) done++;
    statusEl.textContent = done >= puzzle.flows.length
      ? "All pairs joined. Fill every cell."
      : done ? done + " of " + puzzle.flows.length + " pairs joined."
      : "Connect the pairs. Fill every cell.";
  }
  function bestText() {
    const b = store.getInt("best:" + diff, null);
    return b === null ? "—" : fmt(b);
  }

  /* ---------- a new board ---------- */
  function start(seed) {
    curSeed = seed >>> 0;
    let p = null;
    for (let k = 0; k < 4 && !p; k++) p = F.generate((curSeed + k) >>> 0, diff);
    if (!p) { statusEl.textContent = "Could not build a board. Tap random."; return; }
    puzzle = p;
    paths = F.emptyPaths(puzzle);
    moves = 0;
    history = [];
    won = false;
    active = -1;
    dragging = false;
    down = null;
    clearHint();
    resetClock();
    bestEl.textContent = bestText();
    statusEl.textContent = "Connect the pairs. Fill every cell.";
    build();
    updateHud();
    draw();
  }

  function savePoint(d) {
    d.snapshot = F.clonePaths(paths);
    d.snapMoves = moves;
  }
  function commit(d) {
    if (!d || !d.snapshot) return;
    if (JSON.stringify(paths) === JSON.stringify(d.snapshot)) return;
    history.push({ paths: d.snapshot, moves: d.snapMoves });
    if (history.length > 400) history.shift();
    moves++;
    movesEl.textContent = String(moves);
    startTimer();
  }

  function checkWin() {
    if (won || !puzzle) return;
    if (!F.check(puzzle, paths).ok) return;
    won = true;
    active = -1;
    dragging = false;
    down = null;
    stopTimer();
    const t = Math.floor(total());
    const key = "best:" + diff, b = store.getInt(key, null);
    if (b === null || t < b) store.set(key, t);
    bestEl.textContent = fmt(store.getInt(key, t));
    statusEl.textContent = "Solved in " + fmt(t) + "! " + Gamekit.taunt("win");
    noteEl.textContent = "";
    boardEl.classList.add("won");
    resumer.clear();
    updateHud();
    draw();
  }

  /* ---------- pointer: drag a pipe, or tap to extend / lift ---------- */
  function onDown(e) {
    if (won || !puzzle) return;
    if (e.pointerType === "mouse" && e.button > 0) return;
    if (e.isPrimary === false) return;
    const cell = cellAt(e.clientX, e.clientY);
    if (cell < 0) return;
    if (e.cancelable) e.preventDefault();
    clearHint();
    dragging = true;
    down = { cell: cell, x: e.clientX, y: e.clientY, moved: false, mode: "none", f: -1, had: false, snapshot: null, snapMoves: 0 };
    savePoint(down);
    try { boardEl.setPointerCapture(e.pointerId); } catch (err) { /* not fatal */ }

    const dot = puzzle.endpoints[cell];
    if (dot >= 0) {
      const f = dot, fl = puzzle.flows[f], p = paths[f];
      const target = p.length && p[0] === fl.b ? fl.a : fl.b;
      if (p.length && p[0] !== cell && cell === target && F.adjacent(puzzle.n, p[p.length - 1], cell)) {
        // the far dot, one step from the pipe's head: finish it
        paths[f] = p.concat([cell]);
        active = -1;
        down.mode = "done";
      } else {
        down.f = f;
        down.mode = "draw";
        down.had = p.length > 0;
        paths[f] = [cell];
        active = f;
      }
    } else {
      const f = pathFlowAt(cell);
      if (f >= 0) {
        // start a new route from this point of the pipe (its dot end is kept)
        down.f = f;
        down.mode = "truncate";
        down.had = true;
        const at = paths[f].indexOf(cell);
        paths[f] = paths[f].slice(0, at + 1);
        active = f;
      }
    }
    draw();
    updateHud();
  }

  function onMove(e) {
    if (!dragging || !down) return;
    if (!down.moved) {
      const dx = Math.abs(e.clientX - down.x), dy = Math.abs(e.clientY - down.y);
      if (dx + dy > 6) down.moved = true;
      else return;
    }
    if (down.mode !== "draw" && down.mode !== "truncate") return;
    if (e.cancelable) e.preventDefault();
    const cell = cellAt(e.clientX, e.clientY);
    if (cell >= 0) dragTo(cell);
  }

  function onUp(e) {
    if (!down) return;
    const d = down;
    down = null;
    dragging = false;
    if (!d.moved) {
      if (d.mode === "draw" && d.had) { paths[d.f] = []; active = -1; }          // lift a drawn pipe
      else if (d.mode === "truncate") { paths[d.f] = []; active = -1; }          // tap a pipe to clear it
      else if (d.mode === "none") tapExtend(d.cell);                             // tap to extend
      // a tap on an empty dot selects it (its one-cell path stays)
    } else if (d.mode === "draw" || d.mode === "truncate") {
      const p = paths[d.f];
      if (p && p.length < 2) { paths[d.f] = []; active = -1; }
    }
    commit(d);
    draw();
    updateHud();
    checkWin();
    try { if (boardEl.hasPointerCapture && boardEl.hasPointerCapture(e.pointerId)) boardEl.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  }

  boardEl.addEventListener("pointerdown", onDown, { passive: false });
  boardEl.addEventListener("pointermove", onMove, { passive: false });
  boardEl.addEventListener("pointerup", onUp);
  boardEl.addEventListener("pointercancel", onUp);
  boardEl.addEventListener("contextmenu", (e) => e.preventDefault());

  /* ---------- buttons ---------- */
  undoBtn.addEventListener("click", () => {
    if (!history.length || won) return;
    const h = history.pop();
    paths = F.clonePaths(h.paths);
    moves = h.moves;
    active = -1;
    clearHint();
    updateHud();
    draw();
  });
  hintBtn.addEventListener("click", showHint);
  resetBtn.addEventListener("click", () => { if (puzzle) start(curSeed); });
  newBtn.addEventListener("click", () => start(Gamekit.randomSeed()));
  randomBtn.addEventListener("click", () => start(Gamekit.randomSeed()));

  const chips = Gamekit.wireDifficultyChips({
    el: chipsEl, difficulties: ["easy", "medium", "hard"], initial: diff, storage: store, storageKey: "diff",
    onChange: (d) => { diff = d; start(F.dailySeed(diff)); },
  });
  diff = chips.get();

  window.addEventListener("resize", () => { draw(); });

  /* ---------- keeping the game across a refresh ---------- */
  const resumer = Gamekit.resume("flow-free", () => {
    if (won || !puzzle || !paths.some((p) => p.length)) return null;
    return { seed: curSeed, diff: diff, paths: paths.map((p) => p.slice()), moves: moves, elapsed: Math.floor(total()) };
  }, (s) => {
    if (!F.LEVELS[s.diff] || !Number.isInteger(s.seed) || !Array.isArray(s.paths)) return false;
    diff = s.diff;
    chips.show(diff);
    start(s.seed);
    if (!puzzle || !F.partialOk(puzzle, s.paths)) return false;
    paths = F.clonePaths(s.paths);
    moves = Math.max(0, Number(s.moves) || 0);
    elapsedBefore = Math.max(0, Number(s.elapsed) || 0);
    active = -1;
    if (elapsedBefore > 0 || moves > 0) startTimer();
    updateHud();
    draw();
    return true;
  });

  if (!resumer.restore()) start(F.dailySeed(diff));
  window.addEventListener("load", () => Manpage.autoOpen("flow-free"));

  // For an end-to-end check only: draw the stored answer and settle the game.
  window.__flowTest = {
    autoSolve: () => { if (!puzzle || won) return; paths = F.clonePaths(puzzle.solution); active = -1; draw(); updateHud(); checkWin(); },
    state: () => ({ seed: curSeed, diff: diff, paths: paths.map((p) => p.slice()), moves: moves, won: won }),
  };
})();
