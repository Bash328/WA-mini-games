(function () {
  "use strict";

  const P1 = 1, P2 = 2;
  const NAMES = { [P1]: "Player 1", [P2]: "Player 2" };
  const P1_STORE = 6, P2_STORE = 13;
  const SEEDS_PER_PIT = 4;

  const boardEl = document.getElementById("board");
  const statusEl = document.getElementById("status");
  const scoreEl = document.getElementById("score");
  const modeSel = document.getElementById("mode");
  const resetBtn = document.getElementById("reset-btn");

  const rowIndices = (p) => p === P1 ? [0,1,2,3,4,5] : [7,8,9,10,11,12];
  const storeOf = (p) => p === P1 ? P1_STORE : P2_STORE;
  const other = (p) => p === P1 ? P2 : P1;
  const oppositeIdx = (i) => 12 - i;

  function initialBoard() {
    const b = new Array(14).fill(SEEDS_PER_PIT);
    b[P1_STORE] = 0; b[P2_STORE] = 0;
    return b;
  }

  function rowEmpty(board, p) { return rowIndices(p).every(i => board[i] === 0); }

  // Sows the pit's seeds counter-clockwise, skipping the opponent's store.
  // Returns { board, extraTurn } — extraTurn is true if the last seed
  // landed in the mover's own store (go again).
  function sow(board, player, pit) {
    const b = board.slice();
    let seeds = b[pit]; b[pit] = 0;
    const skip = storeOf(other(player));
    let i = pit;
    while (seeds > 0) {
      i = (i + 1) % 14;
      if (i === skip) continue;
      b[i]++; seeds--;
    }
    const last = i;
    let extraTurn = false;
    if (last === storeOf(player)) {
      extraTurn = true;
    } else if (rowIndices(player).includes(last) && b[last] === 1) {
      const opp = oppositeIdx(last);
      if (b[opp] > 0) {
        b[storeOf(player)] += b[opp] + b[last];
        b[last] = 0; b[opp] = 0;
      }
    }
    return { board: b, extraTurn };
  }

  // If either row is empty, the game ends: the other player sweeps their
  // remaining seeds into their own store. Returns null if not over.
  function endgame(board) {
    for (const p of [P1, P2]) {
      if (!rowEmpty(board, p)) continue;
      const b = board.slice();
      const opp = other(p);
      let sum = 0;
      rowIndices(opp).forEach(i => { sum += b[i]; b[i] = 0; });
      b[storeOf(opp)] += sum;
      const s1 = b[P1_STORE], s2 = b[P2_STORE];
      return { board: b, status: s1 === s2 ? "draw" : "won", winner: s1 === s2 ? null : (s1 > s2 ? P1 : P2) };
    }
    return null;
  }

  function boardToStr(b) { return b.map(v => String(v).padStart(2, "0")).join(""); }
  function strToBoard(s) { const out = []; for (let i = 0; i < 14; i++) out.push(parseInt(s.slice(i*2, i*2+2), 10)); return out; }

  function makePit(i, count, clickable, extraClass) {
    const d = document.createElement("button");
    d.type = "button";
    const isStore = i === P1_STORE || i === P2_STORE;
    d.className = "mk-cell " + (isStore ? "mk-store" : "mk-pit") + (extraClass ? " " + extraClass : "");
    d.disabled = !clickable;
    d.textContent = String(count);
    d.setAttribute("aria-label", (i === P1_STORE ? "Player 1 store" : i === P2_STORE ? "Player 2 store" : "Pit " + i) + ": " + count + " seeds");
    return d;
  }

  function renderBoard(board, current, canClick, onClick, lastPit) {
    boardEl.innerHTML = "";
    const p2 = makePit(P2_STORE, board[P2_STORE], false, "p2");
    p2.style.gridColumn = "1"; p2.style.gridRow = "1 / span 2";
    boardEl.appendChild(p2);

    [12,11,10,9,8,7].forEach((pit, i) => {
      const clickable = canClick && current === P2 && board[pit] > 0;
      const el = makePit(pit, board[pit], clickable, (pit === lastPit ? "last" : ""));
      el.style.gridColumn = String(2 + i); el.style.gridRow = "1";
      if (clickable) el.addEventListener("click", () => onClick(pit));
      boardEl.appendChild(el);
    });
    [0,1,2,3,4,5].forEach((pit, i) => {
      const clickable = canClick && current === P1 && board[pit] > 0;
      const el = makePit(pit, board[pit], clickable, (pit === lastPit ? "last" : ""));
      el.style.gridColumn = String(2 + i); el.style.gridRow = "2";
      if (clickable) el.addEventListener("click", () => onClick(pit));
      boardEl.appendChild(el);
    });

    const p1 = makePit(P1_STORE, board[P1_STORE], false, "p1");
    p1.style.gridColumn = "8"; p1.style.gridRow = "1 / span 2";
    boardEl.appendChild(p1);

    scoreEl.textContent = `Player 1: ${board[P1_STORE]} · Player 2: ${board[P2_STORE]}`;
  }

  // ---------- 2 players over WhatsApp ----------
  // board: 28-char string, 14 pits (0-5 Player 1, 6 P1's store, 7-12
  // Player 2, 13 P2's store) each zero-padded to 2 digits (a pit can hold
  // more than 9 seeds, so one-digit-per-cell doesn't fit here).
  // Landing your last seed in your own store grants another turn
  // (async-share's nextTurn), same as Reversi's pass / Dots and Boxes'
  // extra turn. If a move empties a row entirely, the game ends right away
  // — the other player's remaining seeds sweep into their store first, so
  // the link always carries the true final score.
  const link = AsyncShare.start({
    game: "mancala",
    version: 1,
    title: "mancala",
    players: [P1, P2],
    label: (p) => NAMES[p],
    ui: document.getElementById("wa-ui"),
    statusEl: statusEl,
    validateBoard: (s) => {
      const b = s.board;
      if (typeof b !== "string" || b.length !== 28 || !/^[0-9]{28}$/.test(b)) return false;
      const arr = strToBoard(b);
      if (arr.reduce((a, x) => a + x, 0) !== SEEDS_PER_PIT * 12) return false; // seeds are conserved
      const validLast = [0,1,2,3,4,5,7,8,9,10,11,12];
      return validLast.includes(s.last);
    },
    onState: loadLink,
    detail: (s) => {
      const b = strToBoard(s.board);
      return `Final: Player 1 ${b[P1_STORE]} · Player 2 ${b[P2_STORE]}.`;
    },
  });

  let waBoard = initialBoard(), waCurrent = P1, waLast = null, waCanMove = false;

  function loadLink(s, canMove) {
    waBoard = s ? strToBoard(s.board) : initialBoard();
    waCurrent = s ? s.turn : P1;
    waLast = s ? s.last : null;
    waCanMove = canMove;
    renderBoard(waBoard, waCurrent, waCanMove, playLink, waLast);
  }

  function playLink(pit) {
    if (!waCanMove || !rowIndices(waCurrent).includes(pit) || waBoard[pit] === 0) return;
    const { board, extraTurn } = sow(waBoard, waCurrent, pit);
    const end = endgame(board);
    const finalBoard = end ? end.board : board;
    const status = end ? end.status : "in_progress";
    const winner = end ? end.winner : null;
    const nextTurn = end ? waCurrent : (extraTurn ? waCurrent : other(waCurrent));
    link.commit({ board: boardToStr(finalBoard), status, winner, last: pit, nextTurn });
  }

  // ---------- 2 players, same device ----------
  let localBoard, localCurrent, localLast, localOver;

  function resetLocal() {
    localBoard = initialBoard(); localCurrent = P1; localLast = null; localOver = false;
    renderLocal();
  }

  function renderLocal() {
    renderBoard(localBoard, localCurrent, !localOver, playLocal, localLast);
    if (localOver) {
      statusEl.textContent = localBoard[P1_STORE] === localBoard[P2_STORE] ? "Draw."
        : `${NAMES[localBoard[P1_STORE] > localBoard[P2_STORE] ? P1 : P2]} wins.`;
    } else {
      statusEl.textContent = `${NAMES[localCurrent]}'s move.`;
    }
  }

  function playLocal(pit) {
    if (localOver || !rowIndices(localCurrent).includes(pit) || localBoard[pit] === 0) return;
    const { board, extraTurn } = sow(localBoard, localCurrent, pit);
    localLast = pit;
    const end = endgame(board);
    if (end) { localBoard = end.board; localOver = true; renderLocal(); return; }
    localBoard = board;
    if (!extraTurn) localCurrent = other(localCurrent);
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
  window.addEventListener("load", () => Manpage.autoOpen("mancala"));

  window.__mancalaTest = { initialBoard, sow, endgame, rowIndices, storeOf, other, P1, P2 };
})();
