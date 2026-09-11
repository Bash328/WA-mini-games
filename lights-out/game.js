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
  const modeSel  = document.getElementById("mode");
  const statsEl  = document.getElementById("stats");

  const DIFFS = { easy: 3, medium: 6, hard: 10 };
  const store = Gamekit.storage("lights-out:");

  let diff = "medium";
  let mode = "whatsapp";      // "whatsapp" | "solo"

  function idx(r, c) { return r * N + c; }
  function inB(r, c) { return r >= 0 && r < N && c >= 0 && c < N; }

  // Toggles (r,c) and its four orthogonal neighbors. Shared by solo puzzle
  // generation, solo play, and the WhatsApp 2-player mode below.
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

  function setChipsEnabled(on) {
    chipsEl.querySelectorAll(".chip").forEach(b => { b.disabled = !on; });
  }

  // ---------- Solo mode (unchanged from the original single-player game) ----------
  let board = new Uint8Array(N * N);
  let initial = new Uint8Array(N * N);
  let history = [];
  let moves = 0;
  let won = false;
  let cellEls = [];

  function newPuzzle(seedOverride) {
    const seed = seedOverride !== undefined ? seedOverride : Gamekit.dailySeed("lights-out", diff);
    initial = generate(seed, DIFFS[diff]);
    board = new Uint8Array(initial);
    history = [];
    moves = 0;
    won = false;
    renderSoloFresh();
    updateStatus();
  }

  function renderSoloFresh() {
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

  undoBtn.addEventListener("click", () => {
    if (mode === "whatsapp" || history.length === 0) return;
    board = history.pop();
    moves = Math.max(0, moves - 1);
    won = false;
    syncLights();
    updateStatus();
  });

  resetBtn.addEventListener("click", () => {
    if (mode === "whatsapp") return;
    board = new Uint8Array(initial);
    history = [];
    moves = 0;
    won = false;
    syncLights();
    updateStatus();
  });

  newBtn.addEventListener("click", () => {
    if (mode === "whatsapp") return;
    newPuzzle(Gamekit.randomSeed());
  });

  // ---------- 2 players over WhatsApp ----------
  // Same board, same press rule — take turns, and whoever's press turns the
  // last light off wins. There's no separate "initial scramble" carried in
  // the link once play starts: the current 5×5 light pattern packs into one
  // integer (bit i = light i, row-major) and that's the whole board.
  //
  // A press can only ever reduce the game toward all-off or shuffle it
  // sideways, never lengthen it on its own, but two players *could* in
  // principle undo each other forever — so as a backstop, the game is
  // called a draw after MOVE_CAP combined presses.
  const MOVE_CAP = 60;
  const PLAYER_NAMES = { 1: "Player 1", 2: "Player 2" };

  let waBits = new Uint8Array(N * N);
  let waLast = null;
  let waCanMove = false;
  let waCurrent = 1;
  let waMoveCount = 0;
  let waInGame = false;

  function bitsToInt(b) { let n = 0; for (let i = 0; i < N*N; i++) if (b[i]) n |= (1 << i); return n; }
  function intToBits(n) { const b = new Uint8Array(N*N); for (let i = 0; i < N*N; i++) b[i] = (n >> i) & 1; return b; }

  const link = AsyncShare.start({
    game: "lights-out",
    version: 1,
    title: "lights-out",
    players: [1, 2],
    label: (p) => PLAYER_NAMES[p],
    ui: document.getElementById("wa-ui"),
    statusEl: statusEl,
    validateBoard: (s) =>
      s.board && Number.isInteger(s.board.bits) && s.board.bits >= 0 && s.board.bits < (1 << (N*N)) &&
      Number.isInteger(s.last) && s.last >= 0 && s.last < N*N,
    onState: loadLink,
    detail: (s) => s.status === "draw" ? `Called a draw after ${MOVE_CAP} presses without clearing the board.` : "",
  });

  function loadLink(s, canMove) {
    waInGame = !!s;
    waCanMove = canMove;
    waMoveCount = s ? s.moveCount : 0;
    waCurrent = s ? s.turn : 1;
    if (s) { waBits = intToBits(s.board.bits); waLast = s.last; }
    else { waBits = generate(Gamekit.randomSeed(), DIFFS[diff]); waLast = null; }
    setChipsEnabled(!waInGame);
    renderLink();
  }

  function renderLink() {
    boardEl.innerHTML = "";
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const i = idx(r, c);
        const cell = document.createElement("button");
        cell.type = "button";
        cell.className = "lo-cell" + (waBits[i] ? " on" : "") + (waLast === i ? " last" : "");
        cell.disabled = !waCanMove;
        cell.setAttribute("aria-label", "Row " + (r + 1) + " col " + (c + 1));
        const rr = r, cc = c;
        cell.addEventListener("click", () => pressLink(rr, cc));
        boardEl.appendChild(cell);
      }
    }
  }

  function pressLink(r, c) {
    if (!waCanMove) return;
    press(waBits, r, c);
    const cleared = !waBits.some(x => x);
    const nextCount = waMoveCount + 1;
    let status = "in_progress", winner = null;
    if (cleared) { status = "won"; winner = waCurrent; }
    else if (nextCount >= MOVE_CAP) { status = "draw"; }
    link.commit({ board: { bits: bitsToInt(waBits) }, status, winner, last: idx(r, c) });
  }

  function applyMode() {
    const wa = mode === "whatsapp";
    undoBtn.hidden = wa;
    resetBtn.hidden = wa;
    newBtn.hidden = wa;
    statsEl.hidden = wa;
    if (wa) { link.show(); return; }
    link.hide();
    setChipsEnabled(true);
    newPuzzle();
  }

  // Difficulty chips — used for the pre-game puzzle preview in WhatsApp
  // mode (re-rolls it) and for solo puzzles; disabled once a WhatsApp game
  // has actually started, since the board no longer depends on difficulty.
  Gamekit.wireDifficultyChips({
    el: chipsEl,
    difficulties: ["easy", "medium", "hard"],
    initial: diff,
    storage: store,
    storageKey: "diff",
    onChange: (d) => {
      diff = d;
      if (mode === "whatsapp") { loadLink(null, true); return; }
      newPuzzle();
    },
  });
  // Pull stored diff back (gamekit already applied it visually, but our local var needs sync)
  const storedDiff = store.get("diff", "medium");
  if (DIFFS[storedDiff]) diff = storedDiff;

  modeSel.addEventListener("change", () => { mode = modeSel.value; applyMode(); });

  modeSel.value = mode;
  applyMode();
  window.addEventListener("load", () => Manpage.autoOpen("lights-out"));
})();
