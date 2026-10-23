/* ============================================================
   slitherlink/game.js — the solo Slitherlink page.

   The puzzle, the checker, the solver and the hint come from SlitherPuzzle
   (puzzle.js). This file draws the dots, the clues, the loop and the X marks,
   takes taps and drags, keeps Undo, restarts, times the solve and puts the
   board back after a refresh.

   An edge has three states: nothing, a line (1), or an X mark (2). The
   Line/X switch says what a tap draws; tapping an edge that already has that
   mark clears it. Dragging paints the same mark along every edge the finger
   crosses, and one drag is one Undo. A line is refused when it would make
   three lines meet at a dot (a branch or a crossing) or close a second loop.
   ============================================================ */
(function () {
  "use strict";

  const P = globalThis.SlitherPuzzle;
  const $ = (id) => document.getElementById(id);
  const boardEl = $("board"), statusEl = $("status"), timeEl = $("time"), bestEl = $("best"), hintEl = $("hint");
  const undoBtn = $("undo-btn"), resetBtn = $("reset-btn"), newBtn = $("new-btn"), randomBtn = $("random-btn");
  const hintBtn = $("hint-btn"), checkBtn = $("check-btn"), chipsEl = $("chips");
  const lineBtn = $("line-btn"), xBtn = $("x-btn");
  const store = Gamekit.storage("slitherlink:");
  const SVGNS = "http://www.w3.org/2000/svg";
  const TIP = "Tap or drag edges. Tap again to erase.";
  const TIP_X = "X mode: tap or drag edges to mark them.";

  let diff = store.get("diff", "medium");
  if (!P.LEVELS[diff]) diff = "medium";

  let puzzle = null, curSeed = 0, marks = [], won = false, checking = false, history = [];
  let hintEdge = -1, hintValue = -1;
  let mode = "line";
  let startAt = 0, elapsedBefore = 0, timer = null;
  let svgEl = null, lineG = null, xG = null, hintG = null, clueEls = [];
  let down = null, buildToken = 0, pendingRestore = null;

  const svgG = (cls) => { const e = document.createElementNS(SVGNS, "g"); if (cls) e.setAttribute("class", cls); return e; };
  const fmt = (s) => Gamekit.fmtTime(s);
  const total = () => elapsedBefore + (startAt ? (Date.now() - startAt) / 1000 : 0);
  const bestText = () => {
    const b = store.getInt("best:" + diff, null);
    return b === null ? "—" : fmt(b);
  };

  /* ---------- drawing ---------- */
  const svgLine = (x1, y1, x2, y2, cls) => {
    const line = document.createElementNS(SVGNS, "line");
    line.setAttribute("x1", String(x1));
    line.setAttribute("y1", String(y1));
    line.setAttribute("x2", String(x2));
    line.setAttribute("y2", String(y2));
    line.setAttribute("class", cls);
    return line;
  };
  const svgCircle = (x, y, r, cls) => {
    const c = document.createElementNS(SVGNS, "circle");
    c.setAttribute("cx", String(x));
    c.setAttribute("cy", String(y));
    c.setAttribute("r", String(r));
    c.setAttribute("class", cls);
    return c;
  };
  function edgeGeom(k) {
    const e = P.edgeEnds(puzzle.n, k);
    const x1 = e.c1 * 10, y1 = e.r1 * 10, x2 = e.c2 * 10, y2 = e.r2 * 10;
    return { x1, y1, x2, y2, mx: (x1 + x2) / 2, my: (y1 + y2) / 2 };
  }
  function crossAt(g, x, y, size, cls) {
    g.append(svgLine(x - size, y - size, x + size, y + size, cls));
    g.append(svgLine(x + size, y - size, x - size, y + size, cls));
  }

  function build() {
    const n = puzzle.n, E = puzzle.E;
    boardEl.replaceChildren();
    boardEl.style.setProperty("--n", String(n));
    clueEls = new Array(puzzle.N).fill(null);
    svgEl = document.createElementNS(SVGNS, "svg");
    svgEl.setAttribute("class", "sl-svg");
    svgEl.setAttribute("viewBox", "-3 -3 " + (n * 10 + 6) + " " + (n * 10 + 6));
    svgEl.setAttribute("role", "group");
    svgEl.setAttribute("aria-label", "Slitherlink board, " + n + " by " + n + " cells");

    const gridG = svgG("sl-grid");
    for (let k = 0; k < E; k++) {
      const g = edgeGeom(k);
      gridG.append(svgLine(g.x1, g.y1, g.x2, g.y2, "sl-gridline"));
    }
    lineG = svgG("sl-lines");
    xG = svgG("sl-xs");
    hintG = svgG("sl-hints");
    const dotG = svgG("sl-dots");
    for (let r = 0; r <= n; r++) {
      for (let c = 0; c <= n; c++) dotG.append(svgCircle(c * 10, r * 10, n > 7 ? 0.66 : 0.78, "sl-dot"));
    }
    const clueG = svgG("sl-clues");
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const i = r * n + c;
        const clue = puzzle.clues[i];
        if (clue === null || clue < 0) continue;
        const t = document.createElementNS(SVGNS, "text");
        t.setAttribute("x", String(c * 10 + 5));
        t.setAttribute("y", String(r * 10 + 5.15));
        t.setAttribute("class", "sl-clue");
        t.textContent = String(clue);
        clueEls[i] = t;
        clueG.append(t);
      }
    }
    svgEl.append(gridG, lineG, xG, hintG, dotG, clueG);
    boardEl.append(svgEl);
  }

  function drawMarks() {
    if (!lineG) return;
    const lines = document.createDocumentFragment();
    const xs = document.createDocumentFragment();
    for (let k = 0; k < puzzle.E; k++) {
      const v = marks[k];
      if (v !== 1 && v !== 2) continue;
      const g = edgeGeom(k);
      if (v === 1) lines.append(svgLine(g.x1, g.y1, g.x2, g.y2, "sl-loop"));
      else crossAt(xs, g.mx, g.my, 1.05, "sl-x");
    }
    lineG.replaceChildren(lines);
    xG.replaceChildren(xs);
    const hints = document.createDocumentFragment();
    if (hintEdge >= 0) {
      const g = edgeGeom(hintEdge);
      if (hintValue === 1) hints.append(svgLine(g.x1, g.y1, g.x2, g.y2, "sl-hint-line"));
      else if (hintValue === 0) crossAt(hints, g.mx, g.my, 1.35, "sl-hint-x");
    }
    hintG.replaceChildren(hints);
  }

  function render() {
    if (!puzzle) return;
    const res = checking ? P.check(puzzle, marks) : null;
    for (let i = 0; i < puzzle.N; i++) {
      const t = clueEls[i];
      if (!t) continue;
      let cls = "sl-clue";
      if (res) {
        if (res.over.indexOf(i) >= 0) cls += " over";
        else if (res.under.indexOf(i) >= 0) cls += " under";
      }
      t.setAttribute("class", cls);
    }
    drawMarks();
    undoBtn.disabled = !history.length || won;
    hintBtn.disabled = won;
    checkBtn.disabled = won;
    randomBtn.disabled = false;
  }

  /* ---------- the clock ---------- */
  function startTimer() {
    if (timer) clearInterval(timer);
    startAt = Date.now();
    timer = setInterval(() => { timeEl.textContent = fmt(Math.floor(total())); }, 500);
  }
  function stopTimer() {
    if (timer) clearInterval(timer);
    timer = null;
    elapsedBefore = total();
    startAt = 0;
    timeEl.textContent = fmt(Math.floor(elapsedBefore));
  }
  function resetTimer() {
    stopTimer();
    elapsedBefore = 0;
    timeEl.textContent = "0:00";
    startTimer();
  }

  /* ---------- changing edges ---------- */
  function remember() {
    history.push(marks.slice());
    if (history.length > 200) history.shift();
  }

  // Set one edge. A line may not branch at a dot or seal a second loop; both
  // are checked on a copy before the board changes, so nothing is ever drawn
  // in a state the rules cannot use.
  function applyEdge(k, value) {
    if (won || !puzzle || marks[k] === value) return false;
    if (value === 1) {
      const temp = marks.slice();
      temp[k] = 1;
      const info = P.check(puzzle, temp);
      if (info.badVertices.length) {
        hintEl.textContent = "A line cannot cross or branch at a dot.";
        return false;
      }
      if (info.loops > 0 && (info.loops > 1 || info.paths > 0 || info.badComponents > 0)) {
        hintEl.textContent = "That would close a second loop.";
        return false;
      }
    }
    if (down && !down.saved) { remember(); down.saved = true; }
    else if (!down) remember();
    marks[k] = value;
    if (down) down.changed = true;
    checking = false;
    hintEdge = -1;
    hintValue = -1;
    return true;
  }

  function strokeDone() {
    if (!down) return;
    const changed = down.changed;
    down = null;
    if (changed) {
      hintEl.textContent = mode === "line" ? TIP : TIP_X;
      checkWin();
    }
    render();
  }

  /* ---------- finding the edge under a finger ---------- */
  function pointUnits(clientX, clientY) {
    if (!svgEl) return null;
    const rect = svgEl.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const n = puzzle.n, span = n * 10 + 6;
    return {
      x: ((clientX - rect.left) / rect.width) * span - 3,
      y: ((clientY - rect.top) / rect.height) * span - 3,
    };
  }
  function edgeFromPoint(clientX, clientY) {
    if (!puzzle) return -1;
    const u = pointUnits(clientX, clientY);
    if (!u) return -1;
    const n = puzzle.n;
    if (u.x < -1 || u.x > n * 10 + 1 || u.y < -1 || u.y > n * 10 + 1) return -1;
    const x = u.x / 10, y = u.y / 10;
    let best = -1, bestD = Infinity;
    const hr = Math.round(y), hc = Math.floor(x);
    if (hr >= 0 && hr <= n && hc >= 0 && hc < n) {
      const d = Math.abs(y - hr);
      if (d < bestD) { bestD = d; best = P.hEdge(n, hr, hc); }
    }
    const vc = Math.round(x), vr = Math.floor(y);
    if (vc >= 0 && vc <= n && vr >= 0 && vr < n) {
      const d = Math.abs(x - vc);
      if (d < bestD) { bestD = d; best = P.vEdge(n, vr, vc); }
    }
    return bestD <= 0.38 ? best : -1;
  }

  function onPointerDown(e) {
    if (won || !puzzle) return;
    if (e.pointerType === "mouse" && e.button > 0) return;
    if (e.isPrimary === false) return;
    const k = edgeFromPoint(e.clientX, e.clientY);
    if (k < 0) return;
    if (e.cancelable) e.preventDefault();
    const want = mode === "line" ? 1 : 2;
    const action = marks[k] === want ? 0 : want;
    down = { x: e.clientX, y: e.clientY, action, saved: false, changed: false, seen: new Set([k]) };
    try { boardEl.setPointerCapture(e.pointerId); } catch (err) { /* not fatal */ }
    applyEdge(k, action);
    render();
  }

  function onPointerMove(e) {
    if (!down || won) return;
    if (e.cancelable) e.preventDefault();
    const x0 = down.x, y0 = down.y, x1 = e.clientX, y1 = e.clientY;
    const dist = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.min(32, Math.max(1, Math.ceil(dist / 7)));
    for (let s = 1; s <= steps; s++) {
      const x = x0 + (x1 - x0) * s / steps, y = y0 + (y1 - y0) * s / steps;
      const k = edgeFromPoint(x, y);
      if (k < 0 || down.seen.has(k)) continue;
      down.seen.add(k);
      applyEdge(k, down.action);
    }
    down.x = x1;
    down.y = y1;
    render();
  }

  function onPointerUp(e) {
    if (!down) return;
    try { if (boardEl.hasPointerCapture && boardEl.hasPointerCapture(e.pointerId)) boardEl.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    strokeDone();
  }

  boardEl.addEventListener("pointerdown", onPointerDown, { passive: false });
  boardEl.addEventListener("pointermove", onPointerMove, { passive: false });
  boardEl.addEventListener("pointerup", onPointerUp);
  boardEl.addEventListener("pointercancel", onPointerUp);
  boardEl.addEventListener("contextmenu", (e) => e.preventDefault());

  /* ---------- the game ---------- */
  function win() {
    if (won) return;
    won = true;
    stopTimer();
    const t = Math.floor(total());
    const key = "best:" + diff, prev = store.getInt(key, null);
    if (prev === null || t < prev) store.set(key, t);
    bestEl.textContent = fmt(store.getInt(key, t));
    statusEl.textContent = "Solved in " + fmt(t) + "! " + Gamekit.taunt("win");
    hintEl.textContent = "One closed loop, and every number is met.";
    resumer.clear();
    render();
  }
  function checkWin() {
    if (!puzzle || won) return;
    if (P.checkSolution(puzzle, marks)) win();
  }

  function undo() {
    if (!history.length || won) return;
    marks = history.pop();
    checking = false;
    hintEdge = -1;
    hintValue = -1;
    hintEl.textContent = "Line taken back.";
    render();
  }

  function restart() {
    if (!puzzle) return;
    marks = new Array(puzzle.E).fill(0);
    history = [];
    won = false;
    checking = false;
    hintEdge = -1;
    hintValue = -1;
    down = null;
    statusEl.textContent = "Draw one closed loop.";
    hintEl.textContent = mode === "line" ? TIP : TIP_X;
    resetTimer();
    render();
  }

  function showHint() {
    if (!puzzle || won) return;
    checking = false;
    const h = P.hint(puzzle, marks);
    if (!h) {
      hintEdge = -1;
      hintValue = -1;
      hintEl.textContent = "Nothing left to hint: the loop is complete.";
      return render();
    }
    hintEdge = h.edge;
    hintValue = h.value;
    hintEl.textContent = h.value === 1 ? "Hint: add the glowing edge." : "Hint: take the glowing line away.";
    render();
  }

  function checkNow() {
    if (!puzzle || won) return;
    checking = true;
    hintEdge = -1;
    hintValue = -1;
    const r = P.check(puzzle, marks);
    render();
    if (r.badVertices.length) {
      hintEl.textContent = "Lines cross or branch at a dot. Take one line back.";
    } else if (r.over.length || r.under.length) {
      const bits = [];
      if (r.over.length) bits.push(r.over.length + (r.over.length === 1 ? " number has too many sides" : " numbers have too many sides"));
      if (r.under.length) bits.push(r.under.length + (r.under.length === 1 ? " number has too few" : " numbers have too few"));
      hintEl.textContent = "Not right yet: " + bits.join(", ") + ".";
    } else if (!r.singleLoop) {
      if (!r.lineCount) hintEl.textContent = "No lines yet. Tap an edge to start.";
      else if (r.paths > 0) hintEl.textContent = "Every number is met, but the line has loose ends.";
      else if (r.loops > 1) hintEl.textContent = "Every number is met, but there is more than one loop.";
      else hintEl.textContent = "Every number is met, but it is not one closed loop.";
    } else {
      hintEl.textContent = "Every number is met and the loop is closed.";
    }
  }

  /* ---------- a new puzzle ---------- */
  function start(seed) {
    const token = ++buildToken;
    pendingRestore = null;
    down = null;
    checking = false;
    hintEdge = -1;
    hintValue = -1;
    stopTimer();
    statusEl.textContent = "Building the puzzle…";
    hintEl.textContent = "";
    setTimeout(() => {
      if (token !== buildToken) return;
      let p = P.generate(seed, diff), s = seed >>> 0;
      for (let k = 1; !p && k <= 5; k++) {
        s = (seed + k * 2654435761) >>> 0;
        p = P.generate(s, diff);
      }
      if (!p) {
        pendingRestore = null;
        statusEl.textContent = "No puzzle this time. Tap New.";
        hintEl.textContent = "";
        return;
      }
      curSeed = s;
      puzzle = p;
      marks = new Array(p.E).fill(0);
      history = [];
      won = false;
      checking = false;
      hintEdge = -1;
      hintValue = -1;
      down = null;
      elapsedBefore = 0;
      timeEl.textContent = "0:00";
      bestEl.textContent = bestText();
      statusEl.textContent = "Draw one closed loop.";
      hintEl.textContent = mode === "line" ? TIP : TIP_X;
      build();
      render();
      startTimer();
      if (pendingRestore) { const r = pendingRestore; pendingRestore = null; r(); }
    }, 20);
  }

  /* ---------- controls ---------- */
  function setMode(m) {
    if (m !== "line" && m !== "x") return;
    mode = m;
    const isLine = mode === "line";
    lineBtn.classList.toggle("on", isLine);
    xBtn.classList.toggle("on", !isLine);
    lineBtn.setAttribute("aria-pressed", isLine ? "true" : "false");
    xBtn.setAttribute("aria-pressed", isLine ? "false" : "true");
    if (!won && puzzle) hintEl.textContent = isLine ? TIP : TIP_X;
  }
  lineBtn.addEventListener("click", () => setMode("line"));
  xBtn.addEventListener("click", () => setMode("x"));
  undoBtn.addEventListener("click", undo);
  resetBtn.addEventListener("click", restart);
  hintBtn.addEventListener("click", showHint);
  checkBtn.addEventListener("click", checkNow);
  const newRandom = () => start(Gamekit.randomSeed());
  newBtn.addEventListener("click", newRandom);
  randomBtn.addEventListener("click", newRandom);

  const chips = Gamekit.wireDifficultyChips({
    el: chipsEl, difficulties: ["easy", "medium", "hard"], initial: diff, storage: store, storageKey: "diff",
    onChange: (d) => { diff = d; start(P.dailySeed(d)); },
  });
  diff = chips.get();
  bestEl.textContent = bestText();

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !puzzle || document.querySelector(".man-backdrop")) return;
    if (hintEdge < 0 && !checking) return;
    hintEdge = -1;
    hintValue = -1;
    checking = false;
    hintEl.textContent = mode === "line" ? TIP : TIP_X;
    render();
  });

  /* ---------- keeping the game across a refresh ---------- */
  const resumer = Gamekit.resume("slitherlink", () => {
    if (!puzzle || won || !marks.some((v) => v)) return null;
    return { seed: curSeed, diff: diff, marks: marks.slice(), t: Math.floor(total()) };
  }, (s) => {
    if (!P.LEVELS[s.diff] || !Number.isInteger(s.seed) || !Array.isArray(s.marks)) return false;
    diff = s.diff;
    chips.show(diff);
    const apply = () => {
      if (!puzzle || s.marks.length !== puzzle.E) return;
      marks = s.marks.map((v) => (v === 1 || v === 2 ? v : 0));
      elapsedBefore = Math.max(0, Number(s.t) || 0);
      timeEl.textContent = fmt(Math.floor(elapsedBefore));
      startTimer();
      render();
    };
    start(s.seed);
    pendingRestore = apply;
    return true;
  });

  if (!resumer.restore()) start(P.dailySeed(diff));
  window.addEventListener("load", () => Manpage.autoOpen("slitherlink"));

  // For an end-to-end check only: draw the stored answer and settle the game.
  window.__slitherTest = {
    autoSolve: () => {
      if (!puzzle || won) return;
      marks = puzzle.solution.map((v) => (v === 1 ? 1 : 0));
      history = [];
      checking = false;
      hintEdge = -1;
      hintValue = -1;
      render();
      checkWin();
    },
    state: () => ({ seed: curSeed, diff: diff, won: won, marks: marks.slice() }),
  };
})();
