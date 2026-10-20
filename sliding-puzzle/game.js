(function () {
  "use strict";

  const SP = globalThis.SlidingPuzzle;
  const $ = (id) => document.getElementById(id);
  const boardEl = $("board"), innerEl = $("inner"), statusEl = $("status"), movesEl = $("moves"), timeEl = $("time"), bestEl = $("best"), hintEl = $("hint");
  const undoBtn = $("undo-btn"), resetBtn = $("reset-btn"), newBtn = $("new-btn"), chipsEl = $("chips");
  const store = Gamekit.storage("sliding-puzzle:");

  let diff = store.get("diff", "medium");
  if (!SP.LEVELS[diff]) diff = "medium";
  let n = 4, tray = [], first = [], curSeed = 0, moves = 0, history = [], won = false;
  let startAt = 0, elapsedBefore = 0, timer = null;
  let tiles = {};                                    // tile number -> its button

  const fmt = (s) => Gamekit.fmtTime(s);
  const total = () => elapsedBefore + (startAt ? (Date.now() - startAt) / 1000 : 0);
  function startTimer() { if (timer || won) return; startAt = Date.now(); timer = setInterval(() => { timeEl.textContent = fmt(Math.floor(total())); }, 500); }
  function stopTimer() { if (timer) clearInterval(timer); timer = null; elapsedBefore = total(); startAt = 0; }

  function build() {
    boardEl.style.setProperty("--n", n);
    innerEl.innerHTML = ""; tiles = {};
    for (let v = 1; v < n * n; v++) {
      const b = document.createElement("button");
      b.type = "button"; b.className = "sp-t";
      const s = document.createElement("span"); s.textContent = String(v); b.append(s);
      b.setAttribute("aria-label", "tile " + v);
      b.addEventListener("click", () => tap(tray.indexOf(v)));
      innerEl.append(b); tiles[v] = b;
    }
  }
  function render() {
    for (let i = 0; i < tray.length; i++) {
      const v = tray[i];
      if (!v) continue;
      const b = tiles[v];
      b.style.left = (i % n) * 100 / n + "%"; b.style.top = Math.floor(i / n) * 100 / n + "%";
      b.classList.toggle("home", v === i + 1);
      b.classList.toggle("done", won);
      b.disabled = won;
    }
    movesEl.textContent = String(moves);
    timeEl.textContent = fmt(Math.floor(total()));
    undoBtn.disabled = !history.length || won;
    hintEl.textContent = won ? "" : moves === 0 ? "Tap a tile next to the gap. The clock starts with your first move." : "";
  }

  function tap(i) {
    if (won || i < 0) return;
    const r = SP.slide(tray, n, i);
    if (!r) return;
    history.push({ tray: tray.slice(), moves });
    tray = r.tray; moves += r.moved;
    startTimer();
    if (SP.isSolved(tray)) return win();
    render();
  }
  function win() {
    won = true; stopTimer();
    const t = Math.floor(total()), key = "best:" + diff, b = Number(store.get(key, 0));
    if (!b || moves < b) store.set(key, moves);
    bestEl.textContent = store.get(key, String(moves));
    statusEl.textContent = "Solved in " + moves + " moves, " + fmt(t) + "! " + Gamekit.taunt("win");
    resumer.clear();
    render();
  }
  function undo() {
    if (!history.length || won) return;
    const h = history.pop();
    tray = h.tray; moves = h.moves;
    render();
  }

  function start(seed) {
    curSeed = seed;
    const p = SP.generate(seed, diff);
    n = p.n; tray = p.tray.slice(); first = p.tray.slice();
    moves = 0; history = []; won = false; stopTimer(); elapsedBefore = 0;
    bestEl.textContent = store.get("best:" + diff, "—");
    statusEl.textContent = "Put the tiles in order.";
    build(); render();
  }

  const chips = Gamekit.wireDifficultyChips({
    el: chipsEl, difficulties: ["easy", "medium", "hard"], initial: diff, storage: store, storageKey: "diff",
    onChange: (d) => { diff = d; start(Gamekit.dailySeed("sliding-puzzle", diff)); },
  });
  diff = chips.get();
  undoBtn.addEventListener("click", undo);
  resetBtn.addEventListener("click", () => { tray = first.slice(); moves = 0; history = []; won = false; stopTimer(); elapsedBefore = 0; statusEl.textContent = "Put the tiles in order."; render(); });
  newBtn.addEventListener("click", () => start(Gamekit.randomSeed()));
  document.addEventListener("keydown", (e) => {
    if (won || e.ctrlKey || e.metaKey || e.altKey || !e.key.startsWith("Arrow") || document.querySelector(".man-backdrop")) return;
    e.preventDefault();
    const z = tray.indexOf(0), c = z % n, r = Math.floor(z / n);
    // an arrow slides a tile that way: the tile on the opposite side of the gap moves into it
    if (e.key === "ArrowLeft" && c < n - 1) tap(z + 1);
    else if (e.key === "ArrowRight" && c > 0) tap(z - 1);
    else if (e.key === "ArrowUp" && r < n - 1) tap(z + n);
    else if (e.key === "ArrowDown" && r > 0) tap(z - n);
  });

  // ---------- keeping the game across a refresh ----------
  const resumer = Gamekit.resume("sliding-puzzle", () => (won || !moves) ? null : { seed: curSeed, diff, tray, moves, t: Math.floor(total()) }, (s) => {
    if (!SP.LEVELS[s.diff] || !Number.isInteger(s.seed) || !Array.isArray(s.tray)) return false;
    const m = SP.LEVELS[s.diff].n;
    if (s.tray.length !== m * m || s.tray.slice().sort((a, b) => a - b).join() !== Array.from({ length: m * m }, (_, i) => i).join() || !SP.solvable(s.tray, m)) return false;
    diff = s.diff; chips.show(diff);
    start(s.seed);
    tray = s.tray.slice(); moves = Math.max(0, Number(s.moves) || 0); elapsedBefore = Math.max(0, Number(s.t) || 0);
    startTimer(); render();
    return true;
  });

  if (!resumer.restore()) start(Gamekit.dailySeed("sliding-puzzle", diff));
  window.addEventListener("load", () => Manpage.autoOpen("sliding-puzzle"));
})();
