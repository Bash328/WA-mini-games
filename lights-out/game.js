(function () {
  "use strict";

  const N = 5;
  const boardEl  = document.getElementById("board");
  const statusEl = document.getElementById("status");
  const movesEl  = document.getElementById("moves");
  const bestEl   = document.getElementById("best");
  const undoBtn  = document.getElementById("undo-btn");
  const resetBtn = document.getElementById("reset-btn");
  const newBtn   = document.getElementById("new-btn");
  const chipsEl  = document.getElementById("chips");

  const DIFFS = { easy: 3, medium: 6, hard: 10 };
  const store = Gamekit.storage("lights-out:");

  let diff = "medium";
  let board = new Uint8Array(N * N);
  let initial = new Uint8Array(N * N);
  let history = [];
  let moves = 0;
  let won = false;
  let cellEls = [];

  function idx(r, c) { return r * N + c; }
  function inB(r, c) { return r >= 0 && r < N && c >= 0 && c < N; }

  function press(b, r, c) {
    b[idx(r, c)] ^= 1;
    if (inB(r-1, c)) b[idx(r-1, c)] ^= 1;
    if (inB(r+1, c)) b[idx(r+1, c)] ^= 1;
    if (inB(r, c-1)) b[idx(r, c-1)] ^= 1;
    if (inB(r, c+1)) b[idx(r, c+1)] ^= 1;
  }

  function generate(seed, scrambles) {
    const rng = Gamekit.mulberry32(seed);
    const b = new Uint8Array(N * N);
    const used = new Set();
    let applied = 0, safety = 0;
    while (applied < scrambles && safety < scrambles * 8) {
      safety++;
      const r = Math.floor(rng() * N);
      const c = Math.floor(rng() * N);
      const k = r * N + c;
      if (used.has(k)) continue;
      used.add(k);
      press(b, r, c);
      applied++;
    }
    if (!b.some(x => x)) press(b, 2, 2);
    return b;
  }

  function newPuzzle(seedOverride) {
    const seed = seedOverride !== undefined ? seedOverride : Gamekit.dailySeed("lights-out", diff);
    initial = generate(seed, DIFFS[diff]);
    board = new Uint8Array(initial);
    history = [];
    moves = 0;
    won = false;
    renderFresh();
    updateStatus();
  }

  function renderFresh() {
    boardEl.innerHTML = "";
    cellEls = [];
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const cell = document.createElement("button");
        cell.type = "button";
        cell.className = "lo-cell fade-in" + (board[idx(r, c)] ? " on" : "");
        cell.style.animationDelay = ((r * N + c) * 14) + "ms";
        cell.setAttribute("aria-label", "Row " + (r + 1) + " col " + (c + 1));
        const rr = r, cc = c;
        cell.addEventListener("click", () => onPress(rr, cc));
        boardEl.appendChild(cell);
        cellEls.push(cell);
      }
    }
  }

  function syncLights() {
    for (let i = 0; i < N * N; i++) {
      cellEls[i].classList.toggle("on", !!board[i]);
    }
  }

  function onPress(r, c) {
    if (won) return;
    history.push(new Uint8Array(board));
    press(board, r, c);
    moves++;
    syncLights();
    updateStatus();
  }

  function updateStatus() {
    movesEl.textContent = moves;
    const best = store.getInt("best:" + diff, null);
    bestEl.textContent = (best === null) ? "—" : best;

    const anyOn = board.some(x => x);
    if (!anyOn && !won) {
      won = true;
      statusEl.innerHTML = '<span class="ok">Solved in ' + moves + ' moves.</span>';
      if (best === null || moves < best) {
        store.set("best:" + diff, moves);
        bestEl.textContent = moves;
      }
    } else if (!won) {
      const on = board.reduce((a, x) => a + x, 0);
      statusEl.textContent = on + ' light' + (on === 1 ? '' : 's') + ' still on.';
    }
  }

  // Difficulty chips
  Gamekit.wireDifficultyChips({
    el: chipsEl,
    difficulties: ["easy", "medium", "hard"],
    initial: diff,
    storage: store,
    storageKey: "diff",
    onChange: (d) => { diff = d; newPuzzle(); },
  });
  // Pull stored diff back (gamekit already applied it visually, but our local var needs sync)
  const storedDiff = store.get("diff", "medium");
  if (DIFFS[storedDiff]) diff = storedDiff;

  undoBtn.addEventListener("click", () => {
    if (history.length === 0) return;
    board = history.pop();
    moves = Math.max(0, moves - 1);
    won = false;
    syncLights();
    updateStatus();
  });

  resetBtn.addEventListener("click", () => {
    board = new Uint8Array(initial);
    history = [];
    moves = 0;
    won = false;
    syncLights();
    updateStatus();
  });

  newBtn.addEventListener("click", () => {
    newPuzzle(Gamekit.randomSeed());
  });

  // First render + manpage auto-open
  newPuzzle();
  window.addEventListener("load", () => Manpage.autoOpen("lights-out"));
})();
