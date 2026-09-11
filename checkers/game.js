(function () {
  "use strict";

  const N = 8;
  const P1 = 1, P2 = 2;                 // colors
  const MAN = { [P1]: 1, [P2]: 2 };     // piece values
  const KING = { [P1]: 3, [P2]: 4 };
  const NAMES = { [P1]: "Player 1", [P2]: "Player 2" };
  const ALL4 = [[-1,-1],[-1,1],[1,-1],[1,1]];
  const FORWARD = { [P1]: [[1,-1],[1,1]], [P2]: [[-1,-1],[-1,1]] };

  const boardEl = document.getElementById("board");
  const statusEl = document.getElementById("status");
  const modeSel = document.getElementById("mode");
  const resetBtn = document.getElementById("reset-btn");

  const idx = (r, c) => r * N + c;
  const inB = (r, c) => r >= 0 && r < N && c >= 0 && c < N;
  const colorOf = (v) => v === 0 ? 0 : (v === MAN[P1] || v === KING[P1]) ? P1 : P2;
  const isKingV = (v) => v === KING[P1] || v === KING[P2];
  const other = (p) => p === P1 ? P2 : P1;

  function initialBoard() {
    const b = new Array(N * N).fill(0);
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      if ((r + c) % 2 !== 1) continue; // only dark squares are used
      if (r < 3) b[idx(r, c)] = MAN[P1];
      else if (r > 4) b[idx(r, c)] = MAN[P2];
    }
    return b;
  }

  function dirsFor(v) { return isKingV(v) ? ALL4 : FORWARD[colorOf(v)]; }

  function captureMovesFor(board, i) {
    const v = board[i]; if (!v) return [];
    const r = Math.floor(i / N), c = i % N;
    const out = [];
    for (const [dr, dc] of dirsFor(v)) {
      const mr = r + dr, mc = c + dc, jr = r + 2*dr, jc = c + 2*dc;
      if (!inB(jr, jc)) continue;
      const mid = board[idx(mr, mc)];
      if (mid && colorOf(mid) !== colorOf(v) && board[idx(jr, jc)] === 0) {
        out.push({ to: idx(jr, jc), captured: idx(mr, mc) });
      }
    }
    return out;
  }

  function simpleMovesFor(board, i) {
    const v = board[i]; if (!v) return [];
    const r = Math.floor(i / N), c = i % N;
    const out = [];
    for (const [dr, dc] of dirsFor(v)) {
      const nr = r + dr, nc = c + dc;
      if (inB(nr, nc) && board[idx(nr, nc)] === 0) out.push({ to: idx(nr, nc) });
    }
    return out;
  }

  function anyCapture(board, color) {
    for (let i = 0; i < N * N; i++) if (colorOf(board[i]) === color && captureMovesFor(board, i).length) return true;
    return false;
  }

  // Does `color` have any legal move at all (captures take priority)? Used
  // to detect a loss — in checkers, no legal move on your turn means you lose.
  function hasAnyMove(board, color) {
    const mustCapture = anyCapture(board, color);
    for (let i = 0; i < N * N; i++) {
      if (colorOf(board[i]) !== color) continue;
      const moves = mustCapture ? captureMovesFor(board, i) : simpleMovesFor(board, i);
      if (moves.length) return true;
    }
    return false;
  }

  function targetsFor(board, i, chainActive) {
    const v = board[i]; if (!v) return [];
    const mustCapture = chainActive || anyCapture(board, colorOf(v));
    return mustCapture ? captureMovesFor(board, i) : simpleMovesFor(board, i);
  }

  function selectableFor(board, color, chainIdx) {
    if (chainIdx !== null) return [chainIdx];
    const mustCapture = anyCapture(board, color);
    const out = [];
    for (let i = 0; i < N * N; i++) {
      if (colorOf(board[i]) !== color) continue;
      const moves = mustCapture ? captureMovesFor(board, i) : simpleMovesFor(board, i);
      if (moves.length) out.push(i);
    }
    return out;
  }

  // Applies one step (a simple move, or a single jump of a possibly-longer
  // chain) and returns { board, chainContinues, promoted }. The caller
  // decides whether to keep going (chainContinues) or end the turn.
  function step(board, from, move) {
    const next = board.slice();
    const piece = next[from];
    next[from] = 0;
    const toRow = Math.floor(move.to / N);
    let landed = piece, promoted = false;
    if (!isKingV(piece)) {
      if ((colorOf(piece) === P1 && toRow === N - 1) || (colorOf(piece) === P2 && toRow === 0)) {
        landed = KING[colorOf(piece)];
        promoted = true;
      }
    }
    next[move.to] = landed;
    let chainContinues = false;
    if (move.captured !== undefined) {
      next[move.captured] = 0;
      // A promotion always ends the turn, even if further jumps exist.
      chainContinues = !promoted && captureMovesFor(next, move.to).length > 0;
    }
    return { board: next, chainContinues, promoted };
  }

  function renderBoard(board, selectable, selected, targets, canClick, onClick, lastIdx) {
    boardEl.innerHTML = "";
    const targetSet = new Map(targets.map(m => [m.to, m]));
    for (let i = 0; i < N * N; i++) {
      const r = Math.floor(i / N), c = i % N;
      const dark = (r + c) % 2 === 1;
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "ck-cell " + (dark ? "dark" : "light");
      const v = board[i];
      if (v) {
        const p = document.createElement("span");
        p.className = "ck-piece " + (colorOf(v) === P1 ? "p1" : "p2") + (isKingV(v) ? " king" : "");
        cell.appendChild(p);
      }
      if (canClick && selectable.includes(i)) cell.classList.add("selectable");
      if (selected === i) cell.classList.add("sel");
      if (targetSet.has(i)) cell.classList.add(targetSet.get(i).captured !== undefined ? "cap" : "hint");
      if (i === lastIdx) cell.classList.add("last");
      cell.disabled = !dark || !canClick;
      cell.setAttribute("aria-label", "Row " + (r + 1) + " col " + (c + 1));
      cell.addEventListener("click", () => onClick(i));
      boardEl.appendChild(cell);
    }
  }

  // ---------- 2 players over WhatsApp ----------
  // board: 64-char digit string, one char per square (only dark squares are
  // ever non-zero): 0 empty, 1/2 a Player 1/2 man, 3/4 a Player 1/2 king.
  // A full jump chain (mandatory multi-capture) is resolved locally, the
  // same way Memory Match resolves a multi-flip turn — only the *end* of
  // the chain (or a single non-capturing move) produces a link. If a move
  // leaves the opponent with no legal move at all, checkers rules say they
  // lose immediately, so the game ends right there instead of sending an
  // unplayable link.
  const link = AsyncShare.start({
    game: "checkers",
    version: 1,
    title: "checkers",
    players: [P1, P2],
    label: (p) => NAMES[p],
    ui: document.getElementById("wa-ui"),
    statusEl: statusEl,
    validateBoard: (s) => {
      const b = s.board;
      if (typeof b !== "string" || b.length !== N * N || !/^[0-4]+$/.test(b)) return false;
      return Number.isInteger(s.last) && s.last >= 0 && s.last < N * N;
    },
    onState: loadLink,
  });

  let waBoard = initialBoard();
  let waCurrent = P1;
  let waSelected = null;
  let waChain = null;
  let waLast = null;
  let waCanMove = false;

  function loadLink(s, canMove) {
    waBoard = s ? s.board.split("").map(Number) : initialBoard();
    waCurrent = s ? s.turn : P1;
    waLast = s ? s.last : null;
    waCanMove = canMove;
    waSelected = null; waChain = null;
    renderWA();
  }

  function renderWA() {
    const selectable = waCanMove ? selectableFor(waBoard, waCurrent, waChain) : [];
    const targets = (waCanMove && waSelected !== null) ? targetsFor(waBoard, waSelected, waChain !== null) : [];
    renderBoard(waBoard, selectable, waSelected, targets, waCanMove, onClickWA, waLast);
  }

  function onClickWA(i) {
    if (!waCanMove) return;
    if (waSelected !== null) {
      const t = targetsFor(waBoard, waSelected, waChain !== null).find(m => m.to === i);
      if (t) { applyStepWA(waSelected, t); return; }
      if (waChain === null && selectableFor(waBoard, waCurrent, null).includes(i)) { waSelected = i; renderWA(); return; }
      waSelected = null; renderWA(); return;
    }
    if (selectableFor(waBoard, waCurrent, waChain).includes(i)) { waSelected = i; renderWA(); }
  }

  function applyStepWA(from, move) {
    const { board, chainContinues } = step(waBoard, from, move);
    waBoard = board;
    waLast = move.to;
    waSelected = null;
    if (chainContinues) { waChain = move.to; waSelected = move.to; renderWA(); return; }
    waChain = null;
    const opp = other(waCurrent);
    const status = hasAnyMove(waBoard, opp) ? "in_progress" : "won";
    const winner = status === "won" ? waCurrent : null;
    link.commit({ board: waBoard.join(""), status, winner, last: waLast });
  }

  // ---------- 2 players, same device ----------
  let localBoard, localCurrent, localSelected, localChain, localLast, localOver;

  function resetLocal() {
    localBoard = initialBoard();
    localCurrent = P1;
    localSelected = null; localChain = null; localLast = null; localOver = false;
    renderLocal();
  }

  function renderLocal() {
    const selectable = localOver ? [] : selectableFor(localBoard, localCurrent, localChain);
    const targets = (!localOver && localSelected !== null) ? targetsFor(localBoard, localSelected, localChain !== null) : [];
    renderBoard(localBoard, selectable, localSelected, targets, !localOver, onClickLocal, localLast);
    statusEl.textContent = localOver ? `${NAMES[other(localCurrent)]} wins.` : `${NAMES[localCurrent]}'s move.`;
  }

  function onClickLocal(i) {
    if (localOver) return;
    if (localSelected !== null) {
      const t = targetsFor(localBoard, localSelected, localChain !== null).find(m => m.to === i);
      if (t) { applyStepLocal(localSelected, t); return; }
      if (localChain === null && selectableFor(localBoard, localCurrent, null).includes(i)) { localSelected = i; renderLocal(); return; }
      localSelected = null; renderLocal(); return;
    }
    if (selectableFor(localBoard, localCurrent, localChain).includes(i)) { localSelected = i; renderLocal(); }
  }

  function applyStepLocal(from, move) {
    const { board, chainContinues } = step(localBoard, from, move);
    localBoard = board;
    localLast = move.to;
    localSelected = null;
    if (chainContinues) { localChain = move.to; localSelected = move.to; renderLocal(); return; }
    localChain = null;
    const opp = other(localCurrent);
    if (!hasAnyMove(localBoard, opp)) { localOver = true; renderLocal(); return; }
    localCurrent = opp;
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
  window.addEventListener("load", () => Manpage.autoOpen("checkers"));

  window.__checkersTest = { initialBoard, captureMovesFor, simpleMovesFor, anyCapture, hasAnyMove, step, colorOf, P1, P2 };
})();
