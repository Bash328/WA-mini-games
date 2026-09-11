(function () {
  "use strict";

  const ROWS = 6, COLS = 7;
  const P1 = 1, P2 = 2, EMPTY = 0;

  const boardEl  = document.getElementById("board");
  const colsEl   = document.getElementById("cols");
  const statusEl = document.getElementById("status");
  const undoBtn  = document.getElementById("undo-btn");
  const resetBtn = document.getElementById("reset-btn");
  const chipsEl  = document.getElementById("chips");
  const modeSel  = document.getElementById("mode");
  const legendEl = document.getElementById("legend");
  const LEGEND_SOLO = legendEl.innerHTML;

  const DEPTHS = { easy: 2, medium: 4, hard: 6 };
  const store = Gamekit.storage("connect-four:");

  let diff = store.get("diff", "medium");
  if (!DEPTHS[diff]) diff = "medium";
  let mode = store.get("mode", "whatsapp");
  if (!["whatsapp", "ai-first-p1", "ai-first-p2", "local"].includes(mode)) mode = "whatsapp";
  // A shared link always opens the two-player game.
  if (new URLSearchParams(location.search).has("s")) mode = "whatsapp";
  modeSel.value = mode;

  let grid = newGrid();       // 6×7, grid[r][c]
  let history = [];           // stack of {col, row, player}
  let current = P1;
  let gameOver = false;
  let winLine = null;         // [{r,c},...]
  let thinking = false;
  let humanIs = P1;           // set per mode
  let lastSlot = null;        // highlighted checker in WhatsApp mode
  let linkCanMove = false;    // WhatsApp mode: is it this viewer's move?

  function newGrid() {
    const g = [];
    for (let r = 0; r < ROWS; r++) g.push(new Uint8Array(COLS));
    return g;
  }

  function renderShell() {
    colsEl.innerHTML = "";
    for (let c = 0; c < COLS; c++) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "c4-col-btn";
      btn.textContent = "↓";
      btn.setAttribute("aria-label", "Drop in column " + (c + 1));
      btn.dataset.col = String(c);
      btn.addEventListener("click", () => onColClick(c));
      colsEl.appendChild(btn);
    }
    boardEl.innerHTML = "";
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const cell = document.createElement("div");
        cell.className = "c4-slot";
        cell.dataset.r = String(r);
        cell.dataset.c = String(c);
        boardEl.appendChild(cell);
      }
    }
  }

  function renderBoard() {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const i = r * COLS + c;
        const el = boardEl.children[i];
        el.classList.remove("p1", "p2", "win", "last");
        if (grid[r][c] === P1) el.classList.add("p1");
        else if (grid[r][c] === P2) el.classList.add("p2");
        if (mode === "whatsapp" && lastSlot === i) el.classList.add("last");
      }
    }
    if (winLine) {
      winLine.forEach(({ r, c }) => {
        boardEl.children[r * COLS + c].classList.add("win");
      });
    }
    // Disable full columns
    for (let c = 0; c < COLS; c++) {
      const btn = colsEl.children[c];
      btn.disabled = gameOver || thinking || grid[0][c] !== EMPTY || (mode === "whatsapp" && !linkCanMove);
    }
  }

  function dropRow(g, c) {
    for (let r = ROWS - 1; r >= 0; r--) if (g[r][c] === EMPTY) return r;
    return -1;
  }

  function makeMove(c, p) {
    const r = dropRow(grid, c);
    if (r < 0) return false;
    grid[r][c] = p;
    history.push({ r, c, p });
    return true;
  }

  function undoMove() {
    const m = history.pop();
    if (!m) return false;
    grid[m.r][m.c] = EMPTY;
    return true;
  }

  // Check if placing `p` at (r,c) creates a 4-in-a-row. Returns the winning line or null.
  function winAt(g, r, c, p) {
    const dirs = [[0,1],[1,0],[1,1],[1,-1]];
    for (const [dr, dc] of dirs) {
      const line = [{r, c}];
      for (let k = 1; k < 4; k++) {
        const nr = r + dr * k, nc = c + dc * k;
        if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS || g[nr][nc] !== p) break;
        line.push({r: nr, c: nc});
      }
      for (let k = 1; k < 4; k++) {
        const nr = r - dr * k, nc = c - dc * k;
        if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS || g[nr][nc] !== p) break;
        line.unshift({r: nr, c: nc});
      }
      if (line.length >= 4) return line.slice(0, 4);
    }
    return null;
  }

  function isFull(g) {
    for (let c = 0; c < COLS; c++) if (g[0][c] === EMPTY) return false;
    return true;
  }

  // Heuristic evaluation: count "threats" in every 4-window
  const COL_WEIGHT = [3, 4, 5, 7, 5, 4, 3];
  function evalWindow(w, me, them) {
    let mine = 0, yours = 0, empty = 0;
    for (const v of w) { if (v === me) mine++; else if (v === them) yours++; else empty++; }
    if (mine > 0 && yours > 0) return 0;
    if (mine === 4) return 100000;
    if (yours === 4) return -100000;
    if (mine === 3 && empty === 1) return 50;
    if (mine === 2 && empty === 2) return 5;
    if (yours === 3 && empty === 1) return -80;
    if (yours === 2 && empty === 2) return -4;
    return 0;
  }
  function evaluate(g, me) {
    const them = me === P1 ? P2 : P1;
    let score = 0;
    // Center column bias
    for (let r = 0; r < ROWS; r++) if (g[r][3] === me) score += 3;
    for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS; r++) {
      if (g[r][c] === me) score += COL_WEIGHT[c] * 0.3;
    }
    // Horizontal
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c <= COLS - 4; c++)
        score += evalWindow([g[r][c], g[r][c+1], g[r][c+2], g[r][c+3]], me, them);
    // Vertical
    for (let c = 0; c < COLS; c++)
      for (let r = 0; r <= ROWS - 4; r++)
        score += evalWindow([g[r][c], g[r+1][c], g[r+2][c], g[r+3][c]], me, them);
    // Diagonal /
    for (let r = 3; r < ROWS; r++)
      for (let c = 0; c <= COLS - 4; c++)
        score += evalWindow([g[r][c], g[r-1][c+1], g[r-2][c+2], g[r-3][c+3]], me, them);
    // Diagonal \
    for (let r = 0; r <= ROWS - 4; r++)
      for (let c = 0; c <= COLS - 4; c++)
        score += evalWindow([g[r][c], g[r+1][c+1], g[r+2][c+2], g[r+3][c+3]], me, them);
    return score;
  }

  const COL_ORDER = [3, 2, 4, 1, 5, 0, 6];

  function alphabeta(g, depth, alpha, beta, maximizing, me) {
    const them = me === P1 ? P2 : P1;

    // Check terminal: has someone won on the last move? We use a quick "is there any 4" scan.
    // Cheaper: only check last placement is passed in. For first call at depth 0 we evaluate.
    if (depth === 0) return { score: evaluate(g, me), col: -1 };

    let bestCol = -1;
    if (maximizing) {
      let best = -Infinity;
      for (const c of COL_ORDER) {
        const r = dropRow(g, c);
        if (r < 0) continue;
        g[r][c] = me;
        const win = winAt(g, r, c, me);
        let val;
        if (win) val = 100000 + depth;
        else if (isFull(g)) val = 0;
        else val = alphabeta(g, depth - 1, alpha, beta, false, me).score;
        g[r][c] = EMPTY;
        if (val > best) { best = val; bestCol = c; }
        alpha = Math.max(alpha, val);
        if (beta <= alpha) break;
      }
      return { score: best, col: bestCol };
    } else {
      let best = Infinity;
      for (const c of COL_ORDER) {
        const r = dropRow(g, c);
        if (r < 0) continue;
        g[r][c] = them;
        const win = winAt(g, r, c, them);
        let val;
        if (win) val = -100000 - depth;
        else if (isFull(g)) val = 0;
        else val = alphabeta(g, depth - 1, alpha, beta, true, me).score;
        g[r][c] = EMPTY;
        if (val < best) { best = val; bestCol = c; }
        beta = Math.min(beta, val);
        if (beta <= alpha) break;
      }
      return { score: best, col: bestCol };
    }
  }

  function pickAIMove(me) {
    const depth = DEPTHS[diff];
    const res = alphabeta(grid, depth, -Infinity, Infinity, true, me);
    let col = res.col;
    if (col < 0 || dropRow(grid, col) < 0) {
      for (const c of COL_ORDER) if (dropRow(grid, c) >= 0) { col = c; break; }
    }
    return col;
  }

  function onColClick(c) {
    if (mode === "whatsapp") return playLink(c);
    if (gameOver || thinking || mode !== "local" && current !== humanIs) return;
    if (!playMove(c)) return;
    advance();
  }

  function playMove(c) {
    if (dropRow(grid, c) < 0) return false;
    const ok = makeMove(c, current);
    if (!ok) return false;
    const last = history[history.length - 1];
    const win = winAt(grid, last.r, last.c, last.p);
    if (win) {
      winLine = win;
      gameOver = true;
      const who = (mode === "local")
        ? (last.p === P1 ? "Amber" : "Mint") + " wins."
        : (last.p === humanIs ? "You win." : "AI wins.");
      statusEl.innerHTML = '<span class="ok">' + who + '</span>';
    } else if (isFull(grid)) {
      gameOver = true;
      statusEl.textContent = "Draw.";
    } else {
      current = current === P1 ? P2 : P1;
      updateTurnStatus();
    }
    renderBoard();
    return true;
  }

  function updateTurnStatus() {
    if (gameOver) return;
    if (mode === "local") {
      statusEl.textContent = (current === P1 ? "Amber" : "Mint") + " to move.";
    } else if (current === humanIs) {
      statusEl.textContent = "Your turn · drop a checker.";
    } else {
      statusEl.textContent = "AI thinking…";
    }
  }

  let aiTimer = null;
  function cancelAI() { if (aiTimer !== null) { clearTimeout(aiTimer); aiTimer = null; } thinking = false; }

  function advance() {
    if (gameOver) return;
    if (mode === "local") return;
    if (current !== humanIs) {
      thinking = true;
      renderBoard();
      const gen = aiTimer = setTimeout(() => {
        if (aiTimer !== gen) return;
        aiTimer = null;
        if (gameOver || mode === "local" || current === humanIs) { thinking = false; renderBoard(); return; }
        const col = pickAIMove(current);
        thinking = false;
        if (col >= 0) playMove(col);
      }, 150);
    }
  }

  function applyMode() {
    const wa = mode === "whatsapp";
    chipsEl.hidden = wa;
    undoBtn.hidden = wa;
    legendEl.innerHTML = wa ? LEGEND_LINK : LEGEND_SOLO;
    if (wa) {
      cancelAI();
      link.show();
      return;
    }
    link.hide();
    if (mode === "ai-first-p1") humanIs = P1;
    else if (mode === "ai-first-p2") humanIs = P2;
    else humanIs = P1; // unused in local
    reset();
  }

  function reset() {
    cancelAI();
    grid = newGrid();
    history = [];
    current = P1;
    gameOver = false;
    winLine = null;
    renderShell();
    renderBoard();
    updateTurnStatus();
    if (mode !== "local" && current !== humanIs) advance();
  }

  // ---------- 2 players over WhatsApp ----------
  // board on the wire is a 42-char string (not a JSON array — shorter
  // before compression), index = row * 7 + col with row 0 at the TOP (the
  // same layout as grid[r][c]). '0' empty, '1' Red (opens), '2' Yellow.
  // last: index of the most recent checker.
  const COLORS = { [P1]: "Red", [P2]: "Yellow" };
  const LEGEND_LINK = 'Red <span class="c4-key p1">●</span> · Yellow <span class="c4-key p2">●</span>';

  const link = AsyncShare.start({
    game: "connect-four",
    version: 2,
    title: "connect-four",
    players: [P1, P2],
    label: (p) => COLORS[p],
    ui: document.getElementById("wa-ui"),
    statusEl: statusEl,
    validateBoard: (s) => {
      const b = s.board;
      if (typeof b !== "string" || b.length !== ROWS * COLS || !/^[012]+$/.test(b)) return false;
      if (b.split("").filter(c => c !== "0").length !== s.moveCount) return false;
      return Number.isInteger(s.last) && s.last >= 0 && s.last < ROWS * COLS && b[s.last] !== "0";
    },
    onState: loadLink,
  });

  function loadLink(state, canMove) {
    cancelAI();
    grid = newGrid();
    history = [];
    if (state) state.board.split("").forEach((v, i) => { grid[Math.floor(i / COLS)][i % COLS] = +v; });
    current = state ? state.turn : P1;
    lastSlot = state ? state.last : null;
    linkCanMove = canMove;
    winLine = null;
    if (state && state.status === "won") {
      const r = Math.floor(state.last / COLS), c = state.last % COLS;
      winLine = winAt(grid, r, c, grid[r][c]);
    }
    gameOver = !!state && state.status !== "in_progress";
    renderBoard();
  }

  function playLink(c) {
    if (!linkCanMove || dropRow(grid, c) < 0) return;
    makeMove(c, current);
    const last = history[history.length - 1];
    const win = winAt(grid, last.r, last.c, last.p);
    link.commit({
      board: grid.flatMap(row => Array.from(row)).join(""),
      status: win ? "won" : isFull(grid) ? "draw" : "in_progress",
      winner: win ? last.p : null,
      last: last.r * COLS + last.c,
    });
  }

  undoBtn.addEventListener("click", () => {
    if (thinking || mode === "whatsapp") return;
    if (history.length === 0) return;
    // Undo last move; in AI mode, undo the pair so it's the player's turn again.
    undoMove();
    if (mode !== "local" && !gameOver && history.length > 0) {
      const last = history[history.length - 1];
      if (last.p === humanIs) undoMove();
    }
    gameOver = false;
    winLine = null;
    // Recompute whose turn it is based on history
    current = history.length % 2 === 0 ? P1 : P2;
    renderBoard();
    updateTurnStatus();
  });

  resetBtn.addEventListener("click", () => (mode === "whatsapp" ? link.newGame() : reset()));

  modeSel.addEventListener("change", () => {
    mode = modeSel.value;
    store.set("mode", mode);
    applyMode();
  });

  Gamekit.wireDifficultyChips({
    el: chipsEl,
    difficulties: ["easy", "medium", "hard"],
    initial: diff,
    storage: store,
    storageKey: "diff",
    onChange: (d) => { diff = d; reset(); },
  });
  // sync local diff after wiring
  diff = store.get("diff", diff);
  if (!DEPTHS[diff]) diff = "medium";

  // Init
  renderShell();
  applyMode();
  window.addEventListener("load", () => Manpage.autoOpen("connect-four"));
})();
