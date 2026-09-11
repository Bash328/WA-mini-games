(function () {
  "use strict";

  const N = 6, WIN_LEN = 5;
  const P1 = 1, P2 = 2;
  const NAMES = { [P1]: "Player 1", [P2]: "Player 2" };
  const QUADS = { tl: [0, 0], tr: [0, 3], bl: [3, 0], br: [3, 3] };
  const QUAD_LABEL = { tl: "Top-left", tr: "Top-right", bl: "Bottom-left", br: "Bottom-right" };

  const boardEl = document.getElementById("board");
  const rotateEl = document.getElementById("rotate");
  const statusEl = document.getElementById("status");
  const modeSel = document.getElementById("mode");
  const resetBtn = document.getElementById("reset-btn");

  const idx = (r, c) => r * N + c;
  const other = (p) => p === P1 ? P2 : P1;

  function newBoard() { return new Array(N * N).fill(0); }

  function rotateQuadrant(board, quad, dir) {
    const [orow, ocol] = QUADS[quad];
    const get = (r, c) => board[idx(orow + r, ocol + c)];
    const sub = [];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) sub.push(get(r, c));
    const out = board.slice();
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
      const oldR = dir === "cw" ? 2 - c : c;
      const oldC = dir === "cw" ? r : 2 - r;
      out[idx(orow + r, ocol + c)] = sub[oldR * 3 + oldC];
    }
    return out;
  }

  // Returns the set of players (0, 1, or 2 of them) with a line of
  // WIN_LEN — both can happen at once from a single rotation, and that's a
  // draw by the standard rules.
  function winners(board) {
    const at = (r, c) => board[idx(r, c)];
    const dirs = [[0,1],[1,0],[1,1],[1,-1]];
    const won = new Set();
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      const v = at(r, c); if (!v) continue;
      for (const [dr, dc] of dirs) {
        let ok = true;
        for (let k = 1; k < WIN_LEN; k++) {
          const nr = r + dr*k, nc = c + dc*k;
          if (nr < 0 || nr >= N || nc < 0 || nc >= N || at(nr, nc) !== v) { ok = false; break; }
        }
        if (ok) won.add(v);
      }
    }
    return won;
  }

  function outcomeFor(board) {
    const won = winners(board);
    if (won.size === 2) return { status: "draw", winner: null };
    if (won.size === 1) return { status: "won", winner: [...won][0] };
    if (board.every(v => v !== 0)) return { status: "draw", winner: null };
    return { status: "in_progress", winner: null };
  }

  function renderBoard(board, canClick, pendingIdx, onCellClick, lastIdx) {
    boardEl.innerHTML = "";
    for (let i = 0; i < N * N; i++) {
      const r = Math.floor(i / N), c = i % N;
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "pg-cell";
      if (c === 3) cell.classList.add("qsep-l");
      if (r === 3) cell.classList.add("qsep-t");
      const v = board[i];
      if (v || i === pendingIdx) {
        const m = document.createElement("span");
        m.className = "pg-marble " + (i === pendingIdx ? "pending p" + (v || boardEl.dataset.pendingPlayer) : "p" + v);
        cell.appendChild(m);
      }
      if (i === lastIdx) cell.classList.add("last");
      cell.disabled = !canClick || v !== 0 || pendingIdx !== null;
      cell.setAttribute("aria-label", "Row " + (r + 1) + " col " + (c + 1));
      cell.addEventListener("click", () => onCellClick(i));
      boardEl.appendChild(cell);
    }
  }

  function renderRotateControls(show, onRotate) {
    rotateEl.innerHTML = "";
    rotateEl.hidden = !show;
    if (!show) return;
    Object.keys(QUADS).forEach(q => {
      const row = document.createElement("div");
      row.className = "pg-rotate-row";
      const label = document.createElement("span");
      label.className = "pg-rotate-label";
      label.textContent = QUAD_LABEL[q];
      row.appendChild(label);
      ["cw", "ccw"].forEach(dir => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "btn ghost tool-btn";
        b.textContent = dir === "cw" ? "↻" : "↺";
        b.setAttribute("aria-label", QUAD_LABEL[q] + (dir === "cw" ? " clockwise" : " counter-clockwise"));
        b.addEventListener("click", () => onRotate(q, dir));
        row.appendChild(b);
      });
      rotateEl.appendChild(row);
    });
  }

  // ---------- 2 players over WhatsApp ----------
  // board: 36-char digit string, one char per cell. A turn is place-then-
  // rotate-one-quadrant — both parts happen locally before a single commit,
  // the same way a Checkers jump chain resolves before sending a link.
  const link = AsyncShare.start({
    game: "pentago",
    version: 1,
    title: "pentago",
    players: [P1, P2],
    label: (p) => NAMES[p],
    ui: document.getElementById("wa-ui"),
    statusEl: statusEl,
    validateBoard: (s) => {
      const b = s.board;
      if (typeof b !== "string" || b.length !== N * N || !/^[012]+$/.test(b)) return false;
      return Number.isInteger(s.last) && s.last >= 0 && s.last < N * N && b[s.last] !== "0";
    },
    onState: loadLink,
  });

  let waBoard = newBoard(), waCurrent = P1, waLast = null, waCanMove = false, waPending = null;

  function loadLink(s, canMove) {
    waBoard = s ? s.board.split("").map(Number) : newBoard();
    waCurrent = s ? s.turn : P1;
    waLast = s ? s.last : null;
    waCanMove = canMove;
    waPending = null;
    renderWA();
  }

  function renderWA() {
    boardEl.dataset.pendingPlayer = waCurrent;
    renderBoard(waBoard, waCanMove, waPending, onCellWA, waLast);
    renderRotateControls(waPending !== null, onRotateWA);
  }

  function onCellWA(i) {
    if (!waCanMove || waBoard[i] !== 0) return;
    waPending = waPending === i ? null : i; // tap again to undo
    renderWA();
  }

  function onRotateWA(quad, dir) {
    if (waPending === null) return;
    let board = waBoard.slice();
    board[waPending] = waCurrent;
    board = rotateQuadrant(board, quad, dir);
    const { status, winner } = outcomeFor(board);
    link.commit({ board: board.join(""), status, winner, last: waPending });
  }

  // ---------- 2 players, same device ----------
  let localBoard, localCurrent, localLast, localPending, localOver;

  function resetLocal() {
    localBoard = newBoard(); localCurrent = P1; localLast = null; localPending = null; localOver = false;
    renderLocal();
  }

  function renderLocal() {
    boardEl.dataset.pendingPlayer = localCurrent;
    renderBoard(localBoard, !localOver, localPending, onCellLocal, localLast);
    renderRotateControls(!localOver && localPending !== null, onRotateLocal);
    if (localOver) {
      // status text already set by the move that ended the game
    } else {
      statusEl.textContent = localPending === null
        ? `${NAMES[localCurrent]}'s move — place a marble.`
        : `${NAMES[localCurrent]}: now rotate a quadrant.`;
    }
  }

  function onCellLocal(i) {
    if (localOver || localBoard[i] !== 0) return;
    localPending = localPending === i ? null : i;
    renderLocal();
  }

  function onRotateLocal(quad, dir) {
    if (localPending === null) return;
    localBoard[localPending] = localCurrent;
    localBoard = rotateQuadrant(localBoard, quad, dir);
    localLast = localPending;
    localPending = null;
    const { status, winner } = outcomeFor(localBoard);
    if (status !== "in_progress") {
      localOver = true;
      statusEl.textContent = status === "draw" ? "Draw." : `${NAMES[winner]} wins.`;
      renderLocal();
      return;
    }
    localCurrent = other(localCurrent);
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
  window.addEventListener("load", () => Manpage.autoOpen("pentago"));

  window.__pentagoTest = { newBoard, rotateQuadrant, winners, outcomeFor, QUADS };
})();
