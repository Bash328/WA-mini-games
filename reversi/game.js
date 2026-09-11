(function () {
  "use strict";

  const N = 8;
  const EMPTY = 0, BLACK = 1, WHITE = 2;
  const DIRS = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
  const NAMES = { [BLACK]: "Black", [WHITE]: "White" };

  const boardEl = document.getElementById("board");
  const statusEl = document.getElementById("status");
  const scoreEl = document.getElementById("score");
  const modeSel = document.getElementById("mode");
  const resetBtn = document.getElementById("reset-btn");

  const idx = (r, c) => r * N + c;
  const inB = (r, c) => r >= 0 && r < N && c >= 0 && c < N;
  const other = (p) => p === BLACK ? WHITE : BLACK;

  function initialBoard() {
    const b = new Array(N * N).fill(EMPTY);
    b[idx(3,3)] = WHITE; b[idx(3,4)] = BLACK;
    b[idx(4,3)] = BLACK; b[idx(4,4)] = WHITE;
    return b;
  }

  // Cells that would flip if `color` played at (r,c) in direction (dr,dc).
  function flanksInDir(board, r, c, color, dr, dc) {
    const opp = other(color);
    const line = [];
    let rr = r + dr, cc = c + dc;
    while (inB(rr, cc) && board[idx(rr, cc)] === opp) { line.push(idx(rr, cc)); rr += dr; cc += dc; }
    return (line.length && inB(rr, cc) && board[idx(rr, cc)] === color) ? line : [];
  }

  // All cells that would flip if `color` played at (r,c), or null if illegal.
  function flipsFor(board, r, c, color) {
    if (board[idx(r, c)] !== EMPTY) return null;
    let flips = [];
    for (const [dr, dc] of DIRS) flips = flips.concat(flanksInDir(board, r, c, color, dr, dc));
    return flips.length ? flips : null;
  }

  function legalMoves(board, color) {
    const moves = [];
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      if (flipsFor(board, r, c, color)) moves.push(idx(r, c));
    }
    return moves;
  }

  function applyMove(board, r, c, color) {
    const flips = flipsFor(board, r, c, color);
    const next = board.slice();
    next[idx(r, c)] = color;
    flips.forEach(i => { next[i] = color; });
    return next;
  }

  function counts(board) {
    let b = 0, w = 0;
    board.forEach(v => { if (v === BLACK) b++; else if (v === WHITE) w++; });
    return { [BLACK]: b, [WHITE]: w };
  }

  function renderBoard(board, legal, canClick, onClick, lastIdx) {
    boardEl.innerHTML = "";
    const legalSet = new Set(legal);
    for (let i = 0; i < N * N; i++) {
      const v = board[i];
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "rv-cell";
      if (v) {
        const disc = document.createElement("span");
        disc.className = "rv-disc " + (v === BLACK ? "black" : "white");
        cell.appendChild(disc);
      } else if (canClick && legalSet.has(i)) {
        cell.classList.add("hint");
      }
      if (i === lastIdx) cell.classList.add("last");
      cell.disabled = !(canClick && legalSet.has(i));
      cell.setAttribute("aria-label", "Row " + (Math.floor(i / N) + 1) + " col " + (i % N + 1));
      cell.addEventListener("click", () => onClick(i));
      boardEl.appendChild(cell);
    }
    const cnt = counts(board);
    scoreEl.textContent = `Black ${cnt[BLACK]} · White ${cnt[WHITE]}`;
  }

  // ---------- 2 players over WhatsApp ----------
  // board: 64-char string, '0' empty, '1' Black (opens), '2' White.
  // If, after a move, the opponent has no legal move at all, this game
  // resolves the pass itself rather than sending them an unplayable link:
  // control returns to the same player (nextTurn), or — if neither side can
  // move — the game ends right here, using async-share's nextTurn/"another
  // turn" support (see async-share.js).
  const link = AsyncShare.start({
    game: "reversi",
    version: 1,
    title: "reversi",
    players: [BLACK, WHITE],
    label: (p) => NAMES[p],
    ui: document.getElementById("wa-ui"),
    statusEl: statusEl,
    validateBoard: (s) => {
      const b = s.board;
      if (typeof b !== "string" || b.length !== N * N || !/^[012]+$/.test(b)) return false;
      return Number.isInteger(s.last) && s.last >= 0 && s.last < N * N && b[s.last] !== "0";
    },
    onState: loadLink,
    detail: (s) => {
      const cnt = counts(s.board.split("").map(Number));
      return `Final: Black ${cnt[BLACK]} · White ${cnt[WHITE]}.`;
    },
  });

  let waBoard = initialBoard();
  let waCurrent = BLACK;
  let waLast = null;
  let waCanMove = false;

  function loadLink(s, canMove) {
    waBoard = s ? s.board.split("").map(Number) : initialBoard();
    waCurrent = s ? s.turn : BLACK;
    waLast = s ? s.last : null;
    waCanMove = canMove;
    renderWA();
  }

  function renderWA() {
    const legal = waCanMove ? legalMoves(waBoard, waCurrent) : [];
    renderBoard(waBoard, legal, waCanMove, playLink, waLast);
  }

  function playLink(i) {
    if (!waCanMove) return;
    const r = Math.floor(i / N), c = i % N;
    if (!flipsFor(waBoard, r, c, waCurrent)) return;
    const board = applyMove(waBoard, r, c, waCurrent);
    const opp = other(waCurrent);
    let status = "in_progress", winner = null, nextTurn = opp;
    if (legalMoves(board, opp).length === 0) {
      if (legalMoves(board, waCurrent).length === 0) {
        const cnt = counts(board);
        status = cnt[BLACK] === cnt[WHITE] ? "draw" : "won";
        winner = cnt[BLACK] === cnt[WHITE] ? null : (cnt[BLACK] > cnt[WHITE] ? BLACK : WHITE);
      } else {
        nextTurn = waCurrent; // opponent has no legal move — pass back
      }
    }
    link.commit({ board: board.join(""), status, winner, last: i, nextTurn });
  }

  // ---------- 2 players, same device ----------
  let localBoard = initialBoard();
  let localCurrent = BLACK;
  let localLast = null;
  let localOver = false;

  function resetLocal() {
    localBoard = initialBoard();
    localCurrent = BLACK;
    localLast = null;
    localOver = false;
    renderLocal();
  }

  function renderLocal() {
    const legal = localOver ? [] : legalMoves(localBoard, localCurrent);
    renderBoard(localBoard, legal, !localOver, playLocal, localLast);
    if (localOver) {
      const cnt = counts(localBoard);
      statusEl.textContent = cnt[BLACK] === cnt[WHITE] ? "Draw." : `${NAMES[cnt[BLACK] > cnt[WHITE] ? BLACK : WHITE]} wins.`;
    } else {
      statusEl.textContent = `${NAMES[localCurrent]}'s move.`;
    }
  }

  function playLocal(i) {
    if (localOver) return;
    const r = Math.floor(i / N), c = i % N;
    if (!flipsFor(localBoard, r, c, localCurrent)) return;
    localBoard = applyMove(localBoard, r, c, localCurrent);
    localLast = i;
    const opp = other(localCurrent);
    if (legalMoves(localBoard, opp).length > 0) localCurrent = opp;
    else if (legalMoves(localBoard, localCurrent).length === 0) localOver = true;
    // else: opponent has no move, same player goes again (localCurrent unchanged)
    renderLocal();
  }

  function applyMode() {
    const wa = modeSel.value === "whatsapp";
    resetBtn.hidden = wa;
    if (wa) { link.show(); return; }
    link.hide();
    resetLocal();
  }

  resetBtn.addEventListener("click", resetLocal);
  modeSel.addEventListener("change", applyMode);
  applyMode();
  window.addEventListener("load", () => Manpage.autoOpen("reversi"));

  // Exposed only so the e2e suite can drive edge cases (a pass, a double
  // pass ending the game) without hand-clicking dozens of real moves.
  window.__reversiTest = { initialBoard, flipsFor, legalMoves, applyMove, counts, BLACK, WHITE };
})();
