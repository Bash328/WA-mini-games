(function () {
  "use strict";

  const WP = globalThis.WordSearchPuzzle;
  const $ = (id) => document.getElementById(id);
  const boardEl = $("board"), wordsEl = $("words"), statusEl = $("status");
  const timeEl = $("time"), foundEl = $("found"), bestEl = $("best");
  const hintBtn = $("hint-btn"), resetBtn = $("reset-btn"), newBtn = $("new-btn");
  const levelChipsEl = $("chips"), modeChipsEl = $("mode-chips");
  const store = Gamekit.storage("word-search:");

  if (!WP) {
    statusEl.textContent = "Couldn't load the puzzle.";
    return;
  }

  const HINTS = 3;
  const COLORS = ["#c93f3f", "#2f8f63", "#3f63c9", "#a8660a", "#8e44ad", "#0f7f8a", "#b03a78", "#5f6e22"];
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const reverse = (w) => w.split("").reverse().join("");

  let level = store.get("diff", "medium");
  if (!WP.LEVELS[level]) level = "medium";
  let mode = store.get("mode", "daily");
  if (mode !== "daily" && mode !== "random") mode = "daily";

  let puzzle = null, curSeed = 0;
  let found = new Set();          // words already found
  let hinted = new Set();         // words whose first letter is ringed
  let hintsLeft = HINTS;
  let won = false;
  let timerStart = 0, timerId = 0;
  let cellEls = [];               // row-major
  let wordEls = new Map();        // word -> the word-list element
  let colorOf = new Map();        // word -> its colour
  let itemOf = new Map();         // word -> the target record
  let dragging = false;
  let dragFrom = null;
  let selection = [];

  /* ---------- the clock and the best time ---------- */
  const elapsedSeconds = () => Math.max(0, Math.floor((Date.now() - timerStart) / 1000));
  function startTimer() {
    clearInterval(timerId);
    timeEl.textContent = Gamekit.fmtTime(elapsedSeconds());
    timerId = setInterval(() => {
      if (!won) timeEl.textContent = Gamekit.fmtTime(elapsedSeconds());
    }, 500);
  }
  function renderBest() {
    const best = store.getInt("best:" + level, 0);
    bestEl.textContent = best ? Gamekit.fmtTime(best) : "—";
  }
  function renderCount() {
    foundEl.textContent = found.size + "/" + (puzzle ? puzzle.words.length : 0);
  }

  /* ---------- drawing ---------- */
  function buildBoard() {
    const n = puzzle.n;
    boardEl.style.setProperty("--n", String(n));
    boardEl.setAttribute("aria-label", "Word search board, " + n + " by " + n);
    boardEl.replaceChildren();
    cellEls = [];
    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n; col++) {
        const cell = document.createElement("div");
        cell.className = "ws-cell";
        cell.dataset.row = String(row);
        cell.dataset.col = String(col);
        cell.textContent = puzzle.grid[row][col];
        boardEl.append(cell);
        cellEls.push(cell);
      }
    }
    hlEl = document.createElementNS(SVGNS, "svg");
    hlEl.setAttribute("class", "ws-hl");
    hlEl.setAttribute("viewBox", "0 0 " + n + " " + n);
    hlEl.setAttribute("preserveAspectRatio", "none");
    hlEl.setAttribute("aria-hidden", "true");
    boardEl.prepend(hlEl);
    selLine = null;
  }

  function buildWords() {
    wordsEl.replaceChildren();
    wordEls = new Map();
    colorOf = new Map();
    itemOf = new Map();
    puzzle.words.forEach((item, i) => {
      itemOf.set(item.word, item);
      colorOf.set(item.word, COLORS[i % COLORS.length]);
    });
    // show the words alphabetically, so a long list is easy to scan
    puzzle.words.slice().sort((a, b) => a.word.localeCompare(b.word)).forEach((item) => {
      const el = document.createElement("span");
      el.className = "ws-word";
      el.dataset.word = item.word;
      el.style.setProperty("--wc", colorOf.get(item.word));
      el.textContent = item.word.toUpperCase();
      wordsEl.append(el);
      wordEls.set(item.word, el);
    });
  }

  const cellAt = (row, col) => cellEls[row * puzzle.n + col];

  // Found words and the word being dragged are drawn as rounded capsules laid along the letters (one SVG line with round caps
  // under the letters), not as boxes on each cell. The board is square and the SVG stretches to it, so one cell is one unit.
  const SVGNS = "http://www.w3.org/2000/svg";
  let hlEl = null, selLine = null;
  function capsule(r1, c1, r2, c2, color, cls) {
    const l = document.createElementNS(SVGNS, "line");
    l.setAttribute("x1", String(c1 + 0.5)); l.setAttribute("y1", String(r1 + 0.5));
    l.setAttribute("x2", String(c2 + 0.5 + (r1 === r2 && c1 === c2 ? 0.001 : 0))); l.setAttribute("y2", String(r2 + 0.5));
    l.setAttribute("stroke", color); l.setAttribute("class", cls);
    return l;
  }

  function paintFound(word) {
    const item = itemOf.get(word);
    if (!item) return;
    const color = colorOf.get(word);
    for (let i = 0; i < item.word.length; i++) {
      const cell = cellAt(item.row + item.dr * i, item.col + item.dc * i);
      if (cell) {
        cell.classList.add("found");
        cell.style.setProperty("--wc", color);
      }
    }
    const last = item.word.length - 1;
    if (hlEl) hlEl.insertBefore(capsule(item.row, item.col, item.row + item.dr * last, item.col + item.dc * last, color, "ws-cap"), selLine);
    const el = wordEls.get(word);
    if (el) el.classList.add("found");
  }

  function paintHint(word) {
    const item = itemOf.get(word);
    if (!item) return;
    const cell = cellAt(item.row, item.col);
    if (cell) cell.classList.add("hint");
    const el = wordEls.get(word);
    if (el) el.classList.add("hinted");
  }

  // clear the board's colours, then paint the saved state back on
  function applyState() {
    cellEls.forEach((cell) => {
      cell.classList.remove("found", "hint", "sel");
      cell.style.removeProperty("--wc");
    });
    wordEls.forEach((el) => el.classList.remove("found", "hinted"));
    if (hlEl) { hlEl.replaceChildren(); selLine = null; }
    found.forEach(paintFound);
    hinted.forEach(paintHint);
    renderCount();
    hintBtn.disabled = won || hintsLeft <= 0;
  }

  function setSelection(cells) {
    selection.forEach((pos) => {
      const cell = cellAt(pos.row, pos.col);
      if (cell) cell.classList.remove("sel");
    });
    selection = cells || [];
    selection.forEach((pos) => {
      const cell = cellAt(pos.row, pos.col);
      if (cell) cell.classList.add("sel");
    });
    if (selLine) { selLine.remove(); selLine = null; }
    if (hlEl && selection.length) {
      const a = selection[0], z = selection[selection.length - 1];
      selLine = capsule(a.row, a.col, z.row, z.col, "#243b55", "ws-sel");
      hlEl.append(selLine);
    }
  }

  const setStatus = (text) => { statusEl.textContent = text; };

  /* ---------- starting, restarting and finishing ---------- */
  function start(seed, opts) {
    opts = opts || {};
    seed = (Number(seed) >>> 0) || 0;
    const next = WP.generate(seed, level) || WP.generate((seed + 1) >>> 0, level);
    if (!next) {
      setStatus("Couldn't build a puzzle. Try new game.");
      return false;
    }
    puzzle = next;
    curSeed = puzzle.seed;
    won = false;
    dragging = false;
    dragFrom = null;
    selection = [];
    found = new Set();
    hinted = new Set();
    hintsLeft = HINTS;
    buildBoard();
    buildWords();
    // itemOf exists now, so only words that really belong to this puzzle are restored
    if (Array.isArray(opts.found)) {
      opts.found.forEach((w) => { if (itemOf.has(w)) found.add(w); });
    }
    if (Array.isArray(opts.hinted)) {
      opts.hinted.forEach((w) => { if (itemOf.has(w)) hinted.add(w); });
      hintsLeft = Math.max(0, HINTS - hinted.size);
    }
    applyState();
    const was = Number.isFinite(opts.elapsed) ? Math.max(0, opts.elapsed) : 0;
    timerStart = Date.now() - was * 1000;
    startTimer();
    renderBest();
    if (found.size === puzzle.words.length) {
      finish();
    } else {
      setStatus("Find " + puzzle.words.length + " words. Swipe across them.");
    }
    return true;
  }

  function finish() {
    won = true;
    clearInterval(timerId);
    const seconds = Math.max(1, elapsedSeconds());
    timeEl.textContent = Gamekit.fmtTime(seconds);
    const key = "best:" + level;
    const best = store.getInt(key, 0);
    const isBest = !best || seconds < best;
    if (isBest) store.set(key, seconds);
    renderBest();
    hintBtn.disabled = true;
    setStatus("Solved in " + Gamekit.fmtTime(seconds) + (isBest ? ". New best!" : "."));
    setSelection([]);
    resumer.clear();
  }

  function restart() {
    if (!puzzle) return;
    won = false;
    dragging = false;
    dragFrom = null;
    setSelection([]);
    found = new Set();
    hinted = new Set();
    hintsLeft = HINTS;
    timerStart = Date.now();
    applyState();
    startTimer();
    setStatus("Restarted. Find " + puzzle.words.length + " words.");
  }

  function intro() {
    setStatus("Find " + (puzzle ? puzzle.words.length : 0) + " words. Swipe across them.");
  }

  /* ---------- hints ---------- */
  function hint() {
    if (!puzzle || won || hintsLeft <= 0) return;
    const open = puzzle.words.filter((item) => !found.has(item.word));
    if (!open.length) return;
    let pool = open.filter((item) => !hinted.has(item.word));
    if (!pool.length) pool = open;
    const item = pool[Math.floor(Math.random() * pool.length)];
    hinted.add(item.word);
    hintsLeft = Math.max(0, HINTS - hinted.size);
    paintHint(item.word);
    hintBtn.disabled = hintsLeft <= 0;
    setStatus("Hint: " + item.word[0].toUpperCase() + " starts at the ringed letter." + (hintsLeft ? " " + hintsLeft + " left." : ""));
  }

  /* ---------- swiping ---------- */
  function boardBox() {
    const r = boardEl.getBoundingClientRect();
    return {
      left: r.left + boardEl.clientLeft,
      top: r.top + boardEl.clientTop,
      width: boardEl.clientWidth,
      height: boardEl.clientHeight,
      n: puzzle.n,
    };
  }

  function cellFromPoint(x, y, clampToBoard) {
    if (!puzzle) return null;
    const b = boardBox();
    if (!b.width || !b.height) return null;
    let px = x, py = y;
    if (clampToBoard) {
      px = clamp(px, b.left + 0.01, b.left + b.width - 0.01);
      py = clamp(py, b.top + 0.01, b.top + b.height - 0.01);
    } else if (px < b.left || py < b.top || px >= b.left + b.width || py >= b.top + b.height) {
      return null;
    }
    const col = Math.floor((px - b.left) / (b.width / b.n));
    const row = Math.floor((py - b.top) / (b.height / b.n));
    if (row < 0 || row >= b.n || col < 0 || col >= b.n) return null;
    return { row: row, col: col };
  }

  const STEPS = [[0, 1], [1, 1], [1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1]];
  function maxSteps(row, col, dr, dc, n) {
    let k = 0;
    while (row + dr * (k + 1) >= 0 && row + dr * (k + 1) < n && col + dc * (k + 1) >= 0 && col + dc * (k + 1) < n) k++;
    return k;
  }

  // The selection is always one straight line: the pointer's angle is
  // rounded to the nearest of the eight directions, and its distance gives
  // how far along that line to go. A finger that wanders still selects
  // letters in a tidy row.
  function dragTo(x, y) {
    if (!dragFrom || !puzzle) return;
    const b = boardBox();
    if (!b.width || !b.height) return;
    const px = clamp(x, b.left + 0.01, b.left + b.width - 0.01);
    const py = clamp(y, b.top + 0.01, b.top + b.height - 0.01);
    const dx = (px - b.left) / (b.width / b.n) - (dragFrom.col + 0.5);
    const dy = (py - b.top) / (b.height / b.n) - (dragFrom.row + 0.5);
    const angle = Math.atan2(dy, dx);
    const sector = ((Math.round(angle / (Math.PI / 4)) % 8) + 8) % 8;
    const [dr, dc] = STEPS[sector];
    // STEPS is (row step, column step), while dx/dy are screen distances
    // (horizontal, vertical), so the column step pairs with dx
    const length = Math.max(0, Math.round((dx * dc + dy * dr) / (dr * dr + dc * dc)));
    const count = Math.min(length, maxSteps(dragFrom.row, dragFrom.col, dr, dc, b.n));
    const cells = [];
    for (let k = 0; k <= count; k++) cells.push({ row: dragFrom.row + dr * k, col: dragFrom.col + dc * k });
    setSelection(cells);
  }

  function samePath(cells, item) {
    const n = item.word.length;
    if (cells.length !== n) return false;
    const forward = cells.every((pos, i) => pos.row === item.row + item.dr * i && pos.col === item.col + item.dc * i);
    if (forward) return true;
    return cells.every((pos, i) => pos.row === item.row + item.dr * (n - 1 - i) && pos.col === item.col + item.dc * (n - 1 - i));
  }

  function evaluateSelection() {
    if (!puzzle || won) return;
    const cells = selection.slice();
    setSelection([]);
    if (cells.length < 2) return;
    const letters = cells.map((pos) => puzzle.grid[pos.row][pos.col]).join("");
    const backward = reverse(letters);
    const item = puzzle.words.find((w) => w.word === letters || w.word === backward);
    if (!item) {
      setStatus("No word there.");
      return;
    }
    if (found.has(item.word)) {
      setStatus("Already found.");
      return;
    }
    // the generator keeps every target in one place, but never trust a swipe
    // that merely spells it somewhere else
    if (!samePath(cells, item)) {
      setStatus("No word there.");
      return;
    }
    found.add(item.word);
    paintFound(item.word);
    renderCount();
    const left = puzzle.words.length - found.size;
    if (left === 0) return finish();
    setStatus("Found " + item.word.toUpperCase() + ". " + left + " left.");
  }

  function onDown(e) {
    if (!puzzle || won || dragging || e.button > 0) return;
    const start = cellFromPoint(e.clientX, e.clientY, false);
    if (!start) return;
    e.preventDefault();
    dragging = true;
    dragFrom = start;
    setSelection([start]);
    if (boardEl.setPointerCapture) {
      try { boardEl.setPointerCapture(e.pointerId); } catch (err) { /* a browser without capture still gets moves over the board */ }
    }
  }

  function onMove(e) {
    if (!dragging) return;
    e.preventDefault();
    dragTo(e.clientX, e.clientY);
  }

  function onUp() {
    if (!dragging) return;
    dragging = false;
    dragFrom = null;
    evaluateSelection();
  }

  function onCancel() {
    if (!dragging) return;
    dragging = false;
    dragFrom = null;
    setSelection([]);
  }

  boardEl.addEventListener("pointerdown", onDown);
  boardEl.addEventListener("pointermove", onMove);
  boardEl.addEventListener("pointerup", onUp);
  boardEl.addEventListener("pointercancel", onCancel);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onCancel);

  /* ---------- controls ---------- */
  const modeChips = Gamekit.wireDifficultyChips({
    el: modeChipsEl,
    difficulties: ["daily", "random"],
    initial: mode,
    storage: store,
    storageKey: "mode",
    onChange: (m) => {
      mode = m;
      start(m === "daily" ? WP.dailySeed(level) : Gamekit.randomSeed(), {});
      intro();
    },
  });
  const levelChips = Gamekit.wireDifficultyChips({
    el: levelChipsEl,
    difficulties: ["easy", "medium", "hard"],
    initial: level,
    storage: store,
    storageKey: "diff",
    onChange: (l) => {
      level = l;
      renderBest();
      start(mode === "daily" ? WP.dailySeed(level) : Gamekit.randomSeed(), {});
      intro();
    },
  });
  mode = modeChips.get();
  level = levelChips.get();

  hintBtn.addEventListener("click", hint);
  resetBtn.addEventListener("click", restart);
  newBtn.addEventListener("click", () => {
    if (mode !== "random") {
      modeChips.set("random");         // its onChange starts a random puzzle
      intro();
    } else {
      start(Gamekit.randomSeed(), {});
      intro();
    }
  });

  /* ---------- keeping the game across a refresh ---------- */
  const resumer = Gamekit.resume("word-search", () => {
    if (!puzzle || won) return null;
    return {
      level: level,
      mode: mode,
      seed: curSeed,
      elapsed: elapsedSeconds(),
      found: [...found],
      hinted: [...hinted],
    };
  }, (s) => {
    if (!s || !WP.LEVELS[s.level] || (s.mode !== "daily" && s.mode !== "random") || !Number.isInteger(s.seed)) return false;
    if (s.mode === "daily" && s.seed !== WP.dailySeed(s.level)) return false;   // yesterday's daily
    level = s.level;
    mode = s.mode;
    levelChips.show(level);
    modeChips.show(mode);
    return start(s.seed, {
      found: Array.isArray(s.found) ? s.found.filter((w) => typeof w === "string") : [],
      hinted: Array.isArray(s.hinted) ? s.hinted.filter((w) => typeof w === "string") : [],
      elapsed: Number.isFinite(s.elapsed) ? Math.min(Math.max(0, s.elapsed), 86400) : 0,
    });
  });

  /* ---------- go ---------- */
  Gamekit.popFilled(boardEl);
  start(mode === "daily" ? WP.dailySeed(level) : Gamekit.randomSeed(), {});
  resumer.restore();
  window.addEventListener("load", () => Manpage.autoOpen("word-search"));
})();
