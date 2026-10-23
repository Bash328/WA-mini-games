(function () {
  "use strict";

  const SIZES = { easy: 5, medium: 8, hard: 10 };
  const DENSITY = { easy: 0.62, medium: 0.56, hard: 0.52 };

  const boardEl = document.getElementById("board");
  const statusEl = document.getElementById("status");
  const timeEl = document.getElementById("time");
  const bestEl = document.getElementById("best");
  const undoBtn = document.getElementById("undo-btn");
  const resetBtn = document.getElementById("reset-btn");
  const newBtn = document.getElementById("new-btn");
  const chipsEl = document.getElementById("chips");
  const fillBtn = document.getElementById("fill-btn");
  const markBtn = document.getElementById("mark-btn");
  const store = Gamekit.storage("nonogram:");

  let diff = store.get("diff", "medium");
  if (!SIZES[diff]) diff = "medium";

  let n = 5, sol = [], rowClues = [], colClues = [];
  let cur = [];               // 0 empty, 1 filled, 2 marked "not filled"
  let history = [];           // strokes: [[index, previous value], ...]
  let tool = "fill";
  let won = false, timerStart = 0, timerInterval = null, curSeed = 0;
  let cellEls = [], clueEls = { r: [], c: [] };

  // ---------- clues and the logic solver ----------
  function runsOf(line) {
    const out = []; let k = 0;
    for (const v of line) { if (v === 1) k++; else if (k) { out.push(k); k = 0; } }
    if (k) out.push(k);
    return out.length ? out : [0];
  }
  const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

  // All the ways to lay `clue` along a line whose cells are -1 (unknown), 0 (empty) or 1 (filled);
  // returns the line with every cell that is the same in all of them fixed, or null if there is none.
  function solveLine(clue, line) {
    const len = line.length;
    const runs = clue[0] === 0 ? [] : clue;
    const rest = new Array(runs.length + 1).fill(0);
    for (let k = runs.length - 1; k >= 0; k--) rest[k] = rest[k + 1] + runs[k] + (k < runs.length - 1 ? 1 : 0);
    const can0 = new Array(len).fill(false), can1 = new Array(len).fill(false);
    const cells = new Array(len).fill(0);
    let found = false;
    function place(k, pos) {
      if (k === runs.length) {
        for (let i = pos; i < len; i++) if (line[i] === 1) return;
        for (let i = pos; i < len; i++) cells[i] = 0;
        found = true;
        for (let i = 0; i < len; i++) (cells[i] ? can1 : can0)[i] = true;
        return;
      }
      const r = runs[k];
      for (let s = pos; s + rest[k] <= len; s++) {
        // everything before the run is empty: stop once a known filled cell would be skipped
        if (s > pos && line[s - 1] === 1) break;
        let ok = true;
        for (let i = s; i < s + r; i++) if (line[i] === 0) { ok = false; break; }
        if (!ok) continue;
        const after = s + r;
        if (after < len && line[after] === 1) continue;
        for (let i = pos; i < s; i++) cells[i] = 0;
        for (let i = s; i < after; i++) cells[i] = 1;
        if (after < len) cells[after] = 0;
        place(k + 1, Math.min(len, after + 1));
      }
    }
    place(0, 0);
    if (!found) return null;
    return line.map((v, i) => (can1[i] && !can0[i] ? 1 : can0[i] && !can1[i] ? 0 : -1));
  }

  // Can the puzzle be finished by line logic alone? Then it has exactly one solution and never needs guessing.
  function logicSolvable(rows, cols, size) {
    const g = new Array(size * size).fill(-1);
    for (let guard = 0; guard < 60; guard++) {
      let changed = false;
      for (let r = 0; r < size; r++) {
        const line = []; for (let c = 0; c < size; c++) line.push(g[r * size + c]);
        const out = solveLine(rows[r], line);
        if (!out) return false;
        for (let c = 0; c < size; c++) if (out[c] !== line[c]) { g[r * size + c] = out[c]; changed = true; }
      }
      for (let c = 0; c < size; c++) {
        const line = []; for (let r = 0; r < size; r++) line.push(g[r * size + c]);
        const out = solveLine(cols[c], line);
        if (!out) return false;
        for (let r = 0; r < size; r++) if (out[r] !== line[r]) { g[r * size + c] = out[r]; changed = true; }
      }
      if (!changed) break;
    }
    return g.every((v) => v !== -1);
  }

  // Picture from the seed, tried again with the next numbers until line logic can solve it.
  // Bounded by attempts, never by the clock, so the daily puzzle is the same on every device.
  function generate(seed) {
    const size = SIZES[diff];
    const rng = Gamekit.mulberry32(seed);
    for (let attempt = 0; attempt < 600; attempt++) {
      const g = [];
      for (let i = 0; i < size * size; i++) g.push(rng() < DENSITY[diff] ? 1 : 0);
      const rows = [], cols = [];
      for (let r = 0; r < size; r++) rows.push(runsOf(g.slice(r * size, r * size + size)));
      for (let c = 0; c < size; c++) { const col = []; for (let r = 0; r < size; r++) col.push(g[r * size + c]); cols.push(runsOf(col)); }
      if (rows.some((x) => x[0] === 0) || cols.some((x) => x[0] === 0)) continue;        // no empty lines
      if (logicSolvable(rows, cols, size)) return { size, g, rows, cols };
    }
    // vanishingly unlikely: a plain solid pattern with a diagonal gap is always line-solvable
    const g = []; for (let i = 0; i < size * size; i++) g.push((i % size) === ((i / size) | 0) ? 0 : 1);
    const rows = [], cols = [];
    for (let r = 0; r < size; r++) rows.push(runsOf(g.slice(r * size, r * size + size)));
    for (let c = 0; c < size; c++) { const col = []; for (let r = 0; r < size; r++) col.push(g[r * size + c]); cols.push(runsOf(col)); }
    return { size, g, rows, cols };
  }

  // ---------- drawing ----------
  function buildBoard() {
    boardEl.innerHTML = "";
    boardEl.style.setProperty("--n", n);
    boardEl.style.gridTemplateColumns = "auto repeat(" + n + ", minmax(0, 1fr))";
    cellEls = []; clueEls = { r: [], c: [] };
    const corner = document.createElement("div");
    corner.className = "ng-corner";
    boardEl.appendChild(corner);
    for (let c = 0; c < n; c++) {
      const el = document.createElement("div");
      el.className = "ng-clue ng-col" + ((c + 1) % 5 === 0 && c < n - 1 ? " sep" : "");
      el.innerHTML = colClues[c].map((k) => "<span>" + k + "</span>").join("");
      boardEl.appendChild(el); clueEls.c.push(el);
    }
    for (let r = 0; r < n; r++) {
      const el = document.createElement("div");
      el.className = "ng-clue ng-row" + ((r + 1) % 5 === 0 && r < n - 1 ? " sep" : "");
      el.innerHTML = rowClues[r].map((k) => "<span>" + k + "</span>").join("");
      boardEl.appendChild(el); clueEls.r.push(el);
      for (let c = 0; c < n; c++) {
        const cell = document.createElement("div");
        cell.className = "ng-cell" + ((c + 1) % 5 === 0 && c < n - 1 ? " vsep" : "") + ((r + 1) % 5 === 0 && r < n - 1 ? " hsep" : "");
        cell.dataset.i = r * n + c;
        boardEl.appendChild(cell); cellEls.push(cell);
      }
    }
  }

  function renderAll() {
    for (let i = 0; i < n * n; i++) {
      const el = cellEls[i], v = cur[i];
      el.classList.toggle("on", v === 1);
      el.classList.toggle("mk", v === 2);
    }
    for (let r = 0; r < n; r++) {
      const row = cur.slice(r * n, r * n + n).map((v) => (v === 1 ? 1 : 0));
      clueEls.r[r].classList.toggle("done", same(runsOf(row), rowClues[r]));
    }
    for (let c = 0; c < n; c++) {
      const col = []; for (let r = 0; r < n; r++) col.push(cur[r * n + c] === 1 ? 1 : 0);
      clueEls.c[c].classList.toggle("done", same(runsOf(col), colClues[c]));
    }
    undoBtn.disabled = won || history.length === 0;
    fillBtn.classList.toggle("active", tool === "fill"); fillBtn.setAttribute("aria-pressed", tool === "fill");
    markBtn.classList.toggle("active", tool === "mark"); markBtn.setAttribute("aria-pressed", tool === "mark");
  }

  function isSolved() {
    for (let r = 0; r < n; r++) if (!same(runsOf(cur.slice(r * n, r * n + n).map((v) => (v === 1 ? 1 : 0))), rowClues[r])) return false;
    for (let c = 0; c < n; c++) { const col = []; for (let r = 0; r < n; r++) col.push(cur[r * n + c] === 1 ? 1 : 0); if (!same(runsOf(col), colClues[c])) return false; }
    return true;
  }

  // ---------- playing: tap or drag to paint ----------
  let stroke = null;          // { value, changed: [[i, old]] }
  function paint(i) {
    if (!stroke || won || cur[i] === stroke.value) return;
    stroke.changed.push([i, cur[i]]);
    cur[i] = stroke.value;
    renderAll();
  }
  function cellAt(x, y) { const e = document.elementFromPoint(x, y); return e && e.classList && e.classList.contains("ng-cell") ? +e.dataset.i : -1; }
  boardEl.addEventListener("pointerdown", (e) => {
    const i = cellAt(e.clientX, e.clientY);
    if (i < 0 || won) return;
    e.preventDefault();
    const target = tool === "fill" ? 1 : 2;
    stroke = { value: cur[i] === target ? 0 : target, changed: [] };    // tapping a painted cell clears it
    paint(i);
    boardEl.setPointerCapture && boardEl.setPointerCapture(e.pointerId);
  });
  boardEl.addEventListener("pointermove", (e) => { if (stroke) { const i = cellAt(e.clientX, e.clientY); if (i >= 0) paint(i); } });
  function endStroke() {
    if (!stroke) return;
    if (stroke.changed.length) history.push(stroke.changed);
    stroke = null;
    renderAll();
    checkWin();
  }
  boardEl.addEventListener("pointerup", endStroke);
  boardEl.addEventListener("pointercancel", endStroke);

  function checkWin() {
    if (won || !isSolved()) return;
    won = true;
    const s = Math.floor((Date.now() - timerStart) / 1000);
    const best = store.getInt("best:" + diff, null);
    if (best === null || s < best) { store.set("best:" + diff, s); bestEl.textContent = Gamekit.fmtTime(s); }
    statusEl.innerHTML = '<span class="ok">Solved in ' + Gamekit.fmtTime(s) + ".</span>";
    renderAll();
  }

  function undo() {
    if (won) return;
    const s = history.pop();
    if (!s) return;
    for (let k = s.length - 1; k >= 0; k--) cur[s[k][0]] = s[k][1];
    renderAll();
  }

  function setTool(t) { tool = t; renderAll(); }
  fillBtn.addEventListener("click", () => setTool("fill"));
  markBtn.addEventListener("click", () => setTool("mark"));
  document.addEventListener("keydown", (e) => {
    if (e.target.closest("input, select, textarea") || document.querySelector(".man-backdrop")) return;
    if (e.key === "x" || e.key === "X") setTool(tool === "fill" ? "mark" : "fill");
    if ((e.ctrlKey || e.metaKey) && (e.key === "z" || e.key === "Z")) { undo(); e.preventDefault(); }
  });

  // ---------- puzzles, timer, buttons ----------
  function startTimer() {
    clearInterval(timerInterval);
    timeEl.textContent = Gamekit.fmtTime(0);
    timerInterval = setInterval(() => { if (!won) timeEl.textContent = Gamekit.fmtTime(Math.floor((Date.now() - timerStart) / 1000)); }, 500);
  }
  function showBest() { const b = store.getInt("best:" + diff, null); bestEl.textContent = b === null ? "—" : Gamekit.fmtTime(b); }

  function newPuzzle(seedOverride) {
    curSeed = seedOverride !== undefined ? seedOverride : Gamekit.dailySeed("nonogram", diff);
    const p = generate(curSeed);
    n = p.size; sol = p.g; rowClues = p.rows; colClues = p.cols;
    cur = new Array(n * n).fill(0); history = []; won = false; stroke = null;
    timerStart = Date.now(); startTimer();
    statusEl.textContent = "Fill the cells to match the numbers.";
    buildBoard(); renderAll(); showBest();
  }
  undoBtn.addEventListener("click", undo);
  resetBtn.addEventListener("click", () => {
    Gamekit.ask({ title: "Clear the grid?", text: "This cannot be undone.", ok: "Clear", cancel: "Keep", danger: true }).then((yes) => {
      if (!yes) return;
      cur = new Array(n * n).fill(0); history = []; won = false;
      timerStart = Date.now(); startTimer();
      statusEl.textContent = "Fill the cells to match the numbers.";
      renderAll();
    });
  });
  newBtn.addEventListener("click", () => newPuzzle(Gamekit.randomSeed()));

  const chips = Gamekit.wireDifficultyChips({
    el: chipsEl, difficulties: ["easy", "medium", "hard"], initial: diff, storage: store, storageKey: "diff",
    onChange: (d) => { diff = d; newPuzzle(); },
  });
  diff = store.get("diff", diff);
  if (!SIZES[diff]) diff = "medium";
  newPuzzle();

  // A refresh keeps the puzzle, your cells and the clock.
  const resumer = Gamekit.resume("nonogram", () => won ? null : {
    diff: diff, seed: curSeed, cur: cur, elapsed: Math.floor((Date.now() - timerStart) / 1000),
  }, (s) => {
    if (!SIZES[s.diff] || !Number.isInteger(s.seed)) return false;
    diff = s.diff; chips.show(diff);
    newPuzzle(s.seed);
    if (!Array.isArray(s.cur) || s.cur.length !== n * n || !s.cur.every((v) => v === 0 || v === 1 || v === 2)) return false;
    cur = s.cur.slice();
    timerStart = Date.now() - (Number.isFinite(s.elapsed) ? Math.max(0, s.elapsed) : 0) * 1000;
    renderAll(); showBest();
    return true;
  });
  resumer.restore();
  window.addEventListener("load", () => Manpage.autoOpen("nonogram"));
})();

if (window.Gamekit && Gamekit.popFilled) Gamekit.popFilled(document.getElementById("board"));   // new squares pop in
