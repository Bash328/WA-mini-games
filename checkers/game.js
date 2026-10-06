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

  // ---------- AI (minimax/negamax, alpha-beta) ----------
  // A search "ply" is one full turn, not one jump - a mandatory capture
  // chain is several step()s but a single decision, same as a human
  // player experiences it. allTurns() walks every forced-chain branch to
  // each chain's end (reusing step()/targetsFor(), not reimplementing the
  // rules) and returns one entry per resulting board.
  function allTurns(board, color) {
    const results = [];
    for (const from of selectableFor(board, color, null)) {
      for (const t of targetsFor(board, from, false)) extend(board, from, t, []);
    }
    function extend(b, from, move, path) {
      const { board: nb, chainContinues } = step(b, from, move);
      const newPath = path.concat([{ from, move }]);
      if (chainContinues) {
        for (const t2 of targetsFor(nb, move.to, true)) extend(nb, move.to, t2, newPath);
      } else {
        results.push({ board: nb, path: newPath });
      }
    }
    return results;
  }

  // Symmetric: evaluate(b, P1) === -evaluate(b, P2), required for negamax.
  function evaluate(board, color) {
    let score = 0;
    for (let i = 0; i < N * N; i++) {
      const v = board[i];
      if (!v) continue;
      score += (colorOf(v) === color ? 1 : -1) * (isKingV(v) ? 5 : 3);
    }
    return score;
  }

  function negamax(board, color, depth, alpha, beta) {
    const turns = allTurns(board, color);
    // No legal move on your turn loses immediately in checkers - make
    // that terminal state strongly bad, same sign convention as a win.
    if (turns.length === 0) return -100000 - depth;
    if (depth === 0) return evaluate(board, color);
    let best = -Infinity;
    for (const t of turns) {
      const val = -negamax(t.board, other(color), depth - 1, -beta, -alpha);
      if (val > best) best = val;
      if (val > alpha) alpha = val;
      if (alpha >= beta) break;
    }
    return best;
  }

  const AI_DEPTHS = { easy: 2, medium: 4, hard: 6 };

  function pickAITurn(board, color, depth) {
    const turns = allTurns(board, color);
    if (turns.length === 0) return null;
    let bestTurn = turns[0], bestVal = -Infinity, alpha = -Infinity, beta = Infinity;
    for (const t of turns) {
      const val = -negamax(t.board, other(color), depth - 1, -beta, -alpha);
      if (val > bestVal) { bestVal = val; bestTurn = t; }
      if (val > alpha) alpha = val;
    }
    return bestTurn;
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

  // ---------- 2 players same device, or 1 vs AI ----------
  // Shared state for both sub-modes; aiColor is null for local pass-and-play,
  // or the color the AI plays (always P2 - the human is always P1) when
  // modeSel is "ai".
  let localBoard, localCurrent, localSelected, localChain, localLast, localOver;
  let aiColor = null;
  let aiThinking = false;
  let aiTimer = null;
  const chipsEl = document.getElementById("chips");
  const aiStore = Gamekit.storage("checkers:");
  let aiDiff = aiStore.get("diff", "medium");
  if (!AI_DEPTHS[aiDiff]) aiDiff = "medium";

  // "You've got this in the bag" / "spoke too soon" callback: once per
  // game, whichever color first takes a clear material lead gets the
  // confidence line (never the AI - there's no point teasing it). If
  // that same color goes on to lose, the game-over line is the reversal
  // taunt instead of a generic one. confidenceNote is one-shot: set when
  // detected, shown on the next render, then cleared so it doesn't repeat
  // every turn.
  let confidenceGivenTo = null;
  let confidenceNote = "";
  const LEAD_THRESHOLD = 6; // evaluate()'s units: a man is 3, so ~2 pieces up

  function checkConfidence() {
    if (confidenceGivenTo !== null || localOver) return;
    const score = evaluate(localBoard, P1);
    if (Math.abs(score) < LEAD_THRESHOLD) return;
    const leader = score > 0 ? P1 : P2;
    if (aiColor !== null && leader === aiColor) return;
    confidenceGivenTo = leader;
    const who = aiColor !== null ? "" : NAMES[leader] + " — ";
    confidenceNote = who + Gamekit.taunt("confidence");
  }

  function cancelAI() {
    if (aiTimer !== null) { clearTimeout(aiTimer); aiTimer = null; }
    aiThinking = false;
  }

  function resetLocal() {
    cancelAI();
    localBoard = initialBoard();
    localCurrent = P1;
    localSelected = null; localChain = null; localLast = null; localOver = false;
    confidenceGivenTo = null; confidenceNote = "";
    renderLocal();
    maybeAITurn();
  }

  function renderLocal() {
    const humanTurn = !localOver && !aiThinking && !(aiColor !== null && localCurrent === aiColor);
    const selectable = humanTurn ? selectableFor(localBoard, localCurrent, localChain) : [];
    const targets = (humanTurn && localSelected !== null) ? targetsFor(localBoard, localSelected, localChain !== null) : [];
    renderBoard(localBoard, selectable, localSelected, targets, humanTurn, onClickLocal, localLast);
    if (localOver) {
      Gamekit.turn(null);
      const winnerColor = other(localCurrent);
      const loserColor = localCurrent;
      const reversed = confidenceGivenTo === loserColor;
      statusEl.textContent = aiColor === null
        ? `${NAMES[winnerColor]} wins.` + (reversed ? " " + Gamekit.taunt("reversal") : "")
        : (winnerColor === aiColor ? "AI wins. " + Gamekit.taunt(reversed ? "reversal" : "loss") : "You win! 🎉");
    } else if (aiThinking) {
      statusEl.textContent = "AI thinking…";
      Gamekit.turn(aiColor, "AI thinking…", true);
    } else {
      const note = confidenceNote; confidenceNote = "";
      const base = aiColor !== null ? (localCurrent === aiColor ? "AI thinking…" : "Your move.") : `${NAMES[localCurrent]}'s move.`;
      statusEl.textContent = base + (note ? " " + note : "");
      const aiTurn = aiColor !== null && localCurrent === aiColor;
      Gamekit.turn(localCurrent, aiTurn ? "AI thinking…" : aiColor !== null ? "Your move" : `${NAMES[localCurrent]}'s move`, aiTurn);
    }
  }

  function onClickLocal(i) {
    if (localOver || aiThinking || (aiColor !== null && localCurrent === aiColor)) return;
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
    checkConfidence();
    renderLocal();
    maybeAITurn();
  }

  // Runs the AI's full turn (which may itself be a multi-jump chain) as
  // one atomic step, same granularity a human move gets - there is no
  // intermediate "AI is mid-jump" state to render.
  function maybeAITurn() {
    if (aiColor === null || localOver || localCurrent !== aiColor) return;
    aiThinking = true;
    renderLocal();
    const gen = aiTimer = setTimeout(() => {
      if (aiTimer !== gen) return;
      aiTimer = null;
      if (localOver || localCurrent !== aiColor) { aiThinking = false; renderLocal(); return; }
      const turn = pickAITurn(localBoard, aiColor, AI_DEPTHS[aiDiff] || 4);
      aiThinking = false;
      if (!turn) { localOver = true; renderLocal(); return; } // maybeAITurn only runs when hasAnyMove was true
      localBoard = turn.board;
      localLast = turn.path[turn.path.length - 1].move.to;
      const opp = other(aiColor);
      if (!hasAnyMove(localBoard, opp)) { localOver = true; renderLocal(); return; }
      localCurrent = opp;
      checkConfidence();
      renderLocal();
    }, 300);
  }

  Gamekit.wireDifficultyChips({
    el: chipsEl,
    difficulties: Object.keys(AI_DEPTHS),
    storage: aiStore,
    storageKey: "diff",
    initial: aiDiff,
    onChange: (d) => { aiDiff = d; resetLocal(); },
  });

  function applyMode() {
    const val = modeSel.value;
    const wa = val === "whatsapp";
    resetBtn.hidden = wa;
    chipsEl.hidden = val !== "ai";
    cancelAI();
    if (wa) { link.show(); return; }
    link.hide();
    aiColor = val === "ai" ? P2 : null;
    resetLocal();
  }

  resetBtn.addEventListener("click", resetLocal);
  modeSel.addEventListener("change", applyMode);
  applyMode();
  window.addEventListener("load", () => Manpage.autoOpen("checkers"));

  window.__checkersTest = { initialBoard, captureMovesFor, simpleMovesFor, anyCapture, hasAnyMove, step, colorOf, P1, P2, allTurns, pickAITurn, AI_DEPTHS, evaluate };
})();
