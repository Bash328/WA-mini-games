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
  let mode = "whatsapp";      // "whatsapp" | "live" | "solo"
  const isLinked = () => mode === "whatsapp" || mode === "live";

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
  let curSeed = 0;       // the solo puzzle on screen can be rebuilt from this + diff

  function newPuzzle(seedOverride) {
    const seed = seedOverride !== undefined ? seedOverride : Gamekit.dailySeed("lights-out", diff);
    curSeed = seed;
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
    if (isLinked() || history.length === 0) return;
    board = history.pop();
    moves = Math.max(0, moves - 1);
    won = false;
    syncLights();
    updateStatus();
  });

  resetBtn.addEventListener("click", () => {
    if (isLinked()) return;
    board = new Uint8Array(initial);
    history = [];
    moves = 0;
    won = false;
    syncLights();
    updateStatus();
  });

  newBtn.addEventListener("click", () => {
    if (isLinked()) return;
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

  function validateLo(s) {
    return !!s.board && Number.isInteger(s.board.bits) && s.board.bits >= 0 && s.board.bits < (1 << (N*N)) &&
      Number.isInteger(s.last) && s.last >= 0 && s.last < N*N;
  }
  const drawDetail = (s) => s.status === "draw" ? `Called a draw after ${MOVE_CAP} presses without clearing the board.` : "";

  const link = AsyncShare.start({
    game: "lights-out",
    version: 1,
    title: "lights-out",
    players: [1, 2],
    label: (p) => PLAYER_NAMES[p],
    ui: document.getElementById("wa-ui"),
    statusEl: statusEl,
    validateBoard: validateLo,
    onState: loadLink,
    detail: drawDetail,
  });

  // Live online play: same board and rules, moves go over a WebSocket room.
  const live = typeof LiveShare === "undefined" ? null : LiveShare.start({
    game: "lights-out",
    version: 1,
    players: [1, 2],
    label: (p) => PLAYER_NAMES[p],
    ui: document.getElementById("wa-ui"),
    statusEl: statusEl,
    validateBoard: validateLo,
    onState: loadLink,
    detail: drawDetail,
  });
  const activeLink = () => (mode === "live" && live ? live : link);

  // The opening scramble. Kept stable while a game hasn't started, so a
  // repaint (a live room refreshing presence, say) can't reshuffle it under
  // the player. A new one is dealt only when a difficulty chip is tapped or
  // after a game has been played.
  let preview = null;

  function loadLink(s, canMove) {
    waInGame = !!s;
    waCanMove = canMove;
    waMoveCount = s ? s.moveCount : 0;
    waCurrent = s ? s.turn : 1;
    if (s) { waBits = intToBits(s.board.bits); waLast = s.last; preview = null; }
    else {
      if (!preview) preview = generate(Gamekit.randomSeed(), DIFFS[diff]);
      waBits = new Uint8Array(preview);
      waLast = null;
    }
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
    activeLink().commit({ board: { bits: bitsToInt(waBits) }, status, winner, last: idx(r, c) });
  }

  function applyMode() {
    const wa = isLinked();
    undoBtn.hidden = wa;
    resetBtn.hidden = wa;
    newBtn.hidden = wa;
    statsEl.hidden = wa;
    if (mode === "live" && live) { link.hide(); live.show(); return; }
    if (wa) { if (live) live.hide(); link.show(); return; }
    link.hide();
    if (live) live.hide();
    setChipsEnabled(true);
    newPuzzle();
  }

  // Difficulty chips — used for the pre-game puzzle preview in WhatsApp
  // mode (re-rolls it) and for solo puzzles; disabled once a WhatsApp game
  // has actually started, since the board no longer depends on difficulty.
  const chips = Gamekit.wireDifficultyChips({
    el: chipsEl,
    difficulties: ["easy", "medium", "hard"],
    initial: diff,
    storage: store,
    storageKey: "diff",
    onChange: (d) => {
      diff = d;
      preview = null;                          // a new difficulty deals a new scramble
      if (mode === "whatsapp") { loadLink(null, true); return; }
      if (mode === "live") return;             // the chips are off once a room is open anyway
      newPuzzle();
    },
  });
  // Pull stored diff back (gamekit already applied it visually, but our local var needs sync)
  const storedDiff = store.get("diff", "medium");
  if (DIFFS[storedDiff]) diff = storedDiff;

  modeSel.addEventListener("change", () => { mode = modeSel.value; applyMode(); });

  // The live option stays hidden until the server says live play is on for
  // this game. A ?live=CODE invite link opens straight into live mode (the
  // way ?s= does for WhatsApp mode); LiveShare explains if it's switched off.
  const liveOpt = modeSel.querySelector('option[value="live"]');
  const invited = new URLSearchParams(location.search).has("live");
  if (live && invited) {
    liveOpt.hidden = false;
    modeSel.value = "live";
    mode = "live";
  } else if (live) {
    LiveShare.enable(modeSel, "lights-out");
  }

  modeSel.value = mode;
  applyMode();

  // A refresh keeps a solo puzzle in progress: the lights, undo history and move count.
  // (Link and online games are not saved here: they live in the URL / the room.)
  const resumer = Gamekit.resume("lights-out", () => (mode !== "solo" || won || moves === 0) ? null : {
    diff: diff, seed: curSeed, board: Array.from(board), history: history.map(h => Array.from(h)), moves: moves,
  }, (s) => {
    if (!DIFFS[s.diff] || !Number.isInteger(s.seed) || !Array.isArray(s.board) || s.board.length !== N * N) return false;
    if (!s.board.every(v => v === 0 || v === 1)) return false;
    mode = "solo"; modeSel.value = "solo";
    diff = s.diff; chips.show(diff);
    applyMode();                      // shows the solo controls, deals a puzzle
    newPuzzle(s.seed);
    board = new Uint8Array(s.board);
    history = (Array.isArray(s.history) ? s.history : []).filter(h => Array.isArray(h) && h.length === N * N).map(h => new Uint8Array(h));
    moves = Number.isInteger(s.moves) && s.moves >= 0 ? s.moves : history.length;
    syncLights(); updateStatus();
    return true;
  });
  // Only offer to resume when the player is not arriving from a shared / invite link.
  if (!new URLSearchParams(location.search).has("s") && !invited) resumer.restore();
  window.addEventListener("load", () => Manpage.autoOpen("lights-out"));
})();
