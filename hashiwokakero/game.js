(function () {
  "use strict";

  const H = globalThis.HashiPuzzle;
  const $ = (id) => document.getElementById(id);
  const boardEl = $("board"), statusEl = $("status"), timeEl = $("time"), bestEl = $("best"), hintEl = $("hint");
  const undoBtn = $("undo-btn"), resetBtn = $("reset-btn"), newBtn = $("new-btn"), hintBtn = $("hint-btn"), checkBtn = $("check-btn"), solveBtn = $("solve-btn"), chipsEl = $("chips");
  const store = Gamekit.storage("hashiwokakero:");
  const TIP = "Tap an island, then a lit neighbour to build a bridge.";
  const SVG_NS = "http://www.w3.org/2000/svg";
  const BOARD_PAD = 6;                 // the sand margin inside the frame (matches --pad in index.html)

  let diff = store.get("diff", "medium");
  if (!H.LEVELS[diff]) diff = "medium";
  let puzzle = null, curSeed = 0, counts = [], sel = null, won = false, checking = false, history = [];
  let hintPair = -1, hintUsed = false;
  let startAt = 0, elapsedBefore = 0, timer = null;
  let islandEls = [], linesEl = null;
  let pendingRestore = null, buildToken = 0;

  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  const fmt = (s) => Gamekit.fmtTime(s);
  const zeros = () => (puzzle ? puzzle.pairs.map(() => 0) : []);

  /* ---------- drawing ---------- */
  function build() {
    const n = puzzle.n;
    boardEl.innerHTML = "";
    boardEl.style.setProperty("--n", String(n));
    islandEls = new Array(puzzle.islands.length);
    linesEl = document.createElementNS(SVG_NS, "svg");
    linesEl.setAttribute("class", "hk-lines");
    linesEl.setAttribute("viewBox", "0 0 " + (n * 10) + " " + (n * 10));
    linesEl.setAttribute("aria-hidden", "true");
    linesEl.setAttribute("focusable", "false");
    boardEl.append(linesEl);
    const grid = el("div", "hk-grid");
    const at = new Map();
    puzzle.islands.forEach((is, i) => at.set(is.r * n + is.c, i));
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const cell = el("div", "hk-cell");
        const i = at.get(r * n + c);
        if (i !== undefined) {
          const is = puzzle.islands[i];
          const b = el("button", "hk-isle", String(is.num));
          b.type = "button";
          b.dataset.i = String(i);
          b.setAttribute("aria-label", "island row " + (r + 1) + " column " + (c + 1) + ", " + is.num + " bridges");
          b.addEventListener("click", () => tap(i));
          cell.append(b);
          islandEls[i] = b;
        }
        grid.append(cell);
      }
    }
    boardEl.append(grid);
    measure();
  }

  // the font size and the pieces are measured from a real cell, so they stay readable at 320px
  function measure() {
    if (!puzzle) return;
    const w = boardEl.clientWidth - BOARD_PAD * 2;
    if (w) boardEl.style.setProperty("--cell", (w / puzzle.n) + "px");
  }
  if (window.ResizeObserver) new ResizeObserver(measure).observe(boardEl);
  else window.addEventListener("resize", measure);

  function addLine(pr, value, ghost) {
    const a = puzzle.islands[pr.a], b = puzzle.islands[pr.b];
    const offs = value === 2 ? [-1.9, 1.9] : [0];
    for (const off of offs) {
      const line = document.createElementNS(SVG_NS, "line");
      if (pr.dir === "h") {
        line.setAttribute("x1", String(Math.min(a.c, b.c) * 10 + 5));
        line.setAttribute("x2", String(Math.max(a.c, b.c) * 10 + 5));
        line.setAttribute("y1", String(a.r * 10 + 5 + off));
        line.setAttribute("y2", String(a.r * 10 + 5 + off));
      } else {
        line.setAttribute("y1", String(Math.min(a.r, b.r) * 10 + 5));
        line.setAttribute("y2", String(Math.max(a.r, b.r) * 10 + 5));
        line.setAttribute("x1", String(a.c * 10 + 5 + off));
        line.setAttribute("x2", String(a.c * 10 + 5 + off));
      }
      line.setAttribute("class", "hk-line" + (value === 2 ? " two" : "") + (ghost ? " ghost" : ""));
      linesEl.append(line);
    }
  }

  function drawLines() {
    if (!linesEl) return;
    while (linesEl.firstChild) linesEl.removeChild(linesEl.firstChild);
    puzzle.pairs.forEach((pr, k) => {
      if (counts[k] <= 0) return;
      // while a hint is showing a bridge that is not there yet, the dashed target replaces the solid one
      if (k === hintPair && puzzle.solution[k] > 0) return;
      addLine(pr, counts[k], false);
    });
    if (hintPair >= 0 && puzzle.solution[hintPair] > 0) addLine(puzzle.pairs[hintPair], puzzle.solution[hintPair], true);
  }

  function render() {
    if (!puzzle) return;
    const nbrs = new Set(sel === null ? [] : H.neighbours(puzzle, sel));
    const res = checking ? H.check(puzzle, counts) : null;
    const deg = H.degreeOf(puzzle, counts);
    puzzle.islands.forEach((is, i) => {
      const b = islandEls[i];
      let cls = "hk-isle";
      if (sel === i) cls += " sel";
      else if (nbrs.has(i)) cls += " nbr";
      if (hintPair >= 0 && (puzzle.pairs[hintPair].a === i || puzzle.pairs[hintPair].b === i)) cls += " hinted";
      if (res) {
        if (res.over.indexOf(i) >= 0) cls += " over";
        else if (res.under.indexOf(i) >= 0) cls += " short";
      }
      b.className = cls;
      b.setAttribute("aria-label", "island row " + (is.r + 1) + " column " + (is.c + 1) + ", needs " + is.num + " bridges, has " + deg[i]);
    });
    drawLines();
    undoBtn.disabled = !history.length || won;
    hintBtn.disabled = won || hintUsed;
    checkBtn.disabled = won;
    solveBtn.disabled = won;
  }

  /* ---------- playing ---------- */
  function tap(i) {
    if (!puzzle || won) return;
    checking = false;
    hintPair = -1;
    if (sel === null) {
      sel = i;
      hintEl.textContent = "Tap a lit island to join it to this one.";
      return render();
    }
    if (sel === i) {
      sel = null;
      hintEl.textContent = TIP;
      return render();
    }
    const k = H.pairBetween(puzzle, sel, i);
    if (k < 0) {
      sel = i;
      hintEl.textContent = "Tap a lit island to join it to this one.";
      return render();
    }
    cycle(k);
  }

  function cycle(k) {
    const next = (counts[k] + 1) % 3;
    if (next > 0) {
      const clash = puzzle.pairs[k].cross.some((q) => counts[q] > 0);
      if (clash) {
        hintEl.textContent = "Bridges cannot cross. Undo or lower one first.";
        return render();
      }
    }
    history.push({ k: k, v: counts[k] });
    counts[k] = next;
    hintEl.textContent = next === 0 ? "Bridge removed." : next === 1 ? "One bridge. Tap again for two." : "Two bridges. Tap again to remove.";
    afterChange();
  }

  function afterChange() {
    render();
    if (H.check(puzzle, counts).solved) win();
  }

  function win() {
    if (won) return;
    won = true; sel = null; hintPair = -1; stopTimer();
    const t = Math.floor(total()), key = "best:" + diff, prev = Number(store.get(key, 0));
    if (!prev || t < prev) store.set(key, t);
    bestEl.textContent = fmt(Number(store.get(key, t)));
    statusEl.textContent = "Solved in " + fmt(t) + "! " + Gamekit.taunt("win");
    hintEl.textContent = "Every island has its bridges and all of them join up.";
    resumer.clear();
    render();
  }

  function undo() {
    if (!history.length || won) return;
    const h = history.pop();
    counts[h.k] = h.v;
    sel = puzzle.pairs[h.k].a;
    checking = false; hintPair = -1;
    hintEl.textContent = "Bridge taken back.";
    render();
  }

  function restart() {
    if (!puzzle) return;
    counts = zeros(); history = []; sel = null; won = false; checking = false; hintPair = -1;
    statusEl.textContent = "Link every island.";
    hintEl.textContent = TIP;
    resetTimer();
    render();
  }

  function showHint() {
    if (!puzzle || won || hintUsed) return;
    checking = false;
    hintPair = -1;
    for (let k = 0; k < puzzle.pairs.length; k++) {
      if (counts[k] !== puzzle.solution[k]) { hintPair = k; break; }
    }
    if (hintPair < 0) { hintEl.textContent = "Nothing left to hint."; return render(); }
    hintUsed = true;
    const v = puzzle.solution[hintPair];
    hintEl.textContent = v === 0 ? "Hint: no bridge between these two islands."
      : v === 1 ? "Hint: one bridge between these two islands."
      : "Hint: two bridges between these two islands.";
    sel = null;
    render();
  }

  function checkNow() {
    if (!puzzle || won) return;
    checking = true; hintPair = -1;
    render();
    const r = H.check(puzzle, counts);
    if (r.over.length || r.under.length || r.crossed.length) {
      const bits = [];
      if (r.over.length) bits.push(r.over.length + (r.over.length === 1 ? " island has too many" : " islands have too many"));
      if (r.under.length) bits.push(r.under.length + (r.under.length === 1 ? " island needs more" : " islands need more"));
      if (r.crossed.length) bits.push("two bridges cross");
      hintEl.textContent = "Marked islands break a rule: " + bits.join(", ") + ".";
    } else {
      hintEl.textContent = r.connected ? "Every rule is met." : "Every number is met, but the islands are not all joined up yet.";
    }
  }

  function reveal() {
    if (!puzzle || won) return;
    counts = puzzle.solution.slice();
    history = []; sel = null; checking = false; hintPair = -1; won = true;
    stopTimer();
    statusEl.textContent = "Solution shown. Time not counted.";
    hintEl.textContent = "New or restart plays the puzzle from the beginning.";
    resumer.clear();
    render();
  }

  /* ---------- the clock ---------- */
  const total = () => elapsedBefore + (startAt ? (Date.now() - startAt) / 1000 : 0);
  function startTimer() { stopTimer(); startAt = Date.now(); timer = setInterval(() => { timeEl.textContent = fmt(Math.floor(total())); }, 500); }
  function stopTimer() { if (timer) clearInterval(timer); timer = null; elapsedBefore = total(); startAt = 0; timeEl.textContent = fmt(Math.floor(elapsedBefore)); }
  function resetTimer() { stopTimer(); elapsedBefore = 0; timeEl.textContent = "0:00"; startTimer(); }

  /* ---------- starting a puzzle ---------- */
  function start(seed) {
    const token = ++buildToken;
    pendingRestore = null;                 // a new game (or level) never takes the old restored bridges
    stopTimer();
    statusEl.textContent = "Building the puzzle…";
    hintEl.textContent = "";
    // let the browser paint that line first: generation is quick, but it is still work
    setTimeout(() => {
      if (token !== buildToken) return;
      let p = H.generate(seed, diff), s = seed;
      for (let k = 1; !p && k <= 4; k++) { s = (seed + k * 2654435761) >>> 0; p = H.generate(s, diff); }
      if (!p) { statusEl.textContent = "No puzzle this time. Tap new."; return; }
      curSeed = s;
      puzzle = p;
      counts = zeros();
      sel = null; won = false; checking = false; history = []; hintPair = -1; hintUsed = false;
      elapsedBefore = 0; timeEl.textContent = "0:00";
      bestEl.textContent = store.get("best:" + diff, "") ? fmt(Number(store.get("best:" + diff, 0))) : "—";
      statusEl.textContent = "Link every island.";
      hintEl.textContent = TIP;
      build();
      render();
      startTimer();
      if (pendingRestore) { const r = pendingRestore; pendingRestore = null; r(); }
    }, 20);
  }

  /* ---------- controls ---------- */
  undoBtn.addEventListener("click", undo);
  resetBtn.addEventListener("click", restart);
  newBtn.addEventListener("click", () => start(Gamekit.randomSeed()));
  hintBtn.addEventListener("click", showHint);
  checkBtn.addEventListener("click", checkNow);
  solveBtn.addEventListener("click", reveal);
  const chips = Gamekit.wireDifficultyChips({
    el: chipsEl, difficulties: ["easy", "medium", "hard"], initial: diff, storage: store, storageKey: "diff",
    onChange: (d) => { diff = d; start(H.dailySeed(d)); },
  });
  diff = chips.get();
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !puzzle || document.querySelector(".man-backdrop")) return;
    if (sel === null && hintPair < 0) return;
    sel = null; hintPair = -1; hintEl.textContent = TIP; render();
  });

  /* ---------- keeping the game across a refresh ---------- */
  const resumer = Gamekit.resume("hashiwokakero", () => (!puzzle || won || (!history.length && !hintUsed)) ? null : { seed: curSeed, diff: diff, counts: counts, t: Math.floor(total()), hintUsed: hintUsed }, (s) => {
    if (!H.LEVELS[s.diff] || !Number.isInteger(s.seed) || !Array.isArray(s.counts)) return false;
    diff = s.diff;
    chips.show(diff);
    const apply = () => {
      if (!puzzle || s.counts.length !== puzzle.pairs.length) return;
      counts = s.counts.map((v) => (v === 1 || v === 2 ? v : 0));
      hintUsed = !!s.hintUsed;
      elapsedBefore = Math.max(0, Number(s.t) || 0);
      startTimer();
      render();
    };
    start(s.seed);
    pendingRestore = apply;
    return true;
  });

  // a saved game is rebuilt from its seed and the bridges put back; otherwise today's puzzle
  if (!resumer.restore()) start(H.dailySeed(diff));
  window.addEventListener("load", () => Manpage.autoOpen("hashiwokakero"));
})();
