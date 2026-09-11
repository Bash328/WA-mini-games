(function () {
  "use strict";

  const LINES = [
    [0,1,2],[3,4,5],[6,7,8],
    [0,3,6],[1,4,7],[2,5,8],
    [0,4,8],[2,4,6],
  ];

  let board, human, ai, turn, gameOver;
  let aiTimer = null;
  let cellEls = [];
  let mode = "whatsapp";      // "whatsapp" | "ai"
  let lastMove = null;        // highlighted cell in WhatsApp mode
  let linkCanMove = false;    // WhatsApp mode: is it this viewer's move?

  const boardEl = document.getElementById("board");
  const statusEl = document.getElementById("status");
  const resetBtn = document.getElementById("reset");
  const toggleBtn = document.getElementById("toggle");
  const modeSel = document.getElementById("mode");

  function winner(b) {
    for (const [a, c, d] of LINES) {
      if (b[a] && b[a] === b[c] && b[a] === b[d]) return { player: b[a], line: [a, c, d] };
    }
    if (b.every(x => x)) return { player: "draw", line: [] };
    return null;
  }

  function minimax(b, player) {
    const w = winner(b);
    if (w) {
      if (w.player === ai) return { score: 1 };
      if (w.player === human) return { score: -1 };
      return { score: 0 };
    }
    let best = null;
    for (let i = 0; i < 9; i++) {
      if (b[i]) continue;
      b[i] = player;
      const res = minimax(b, player === "X" ? "O" : "X");
      b[i] = null;
      const candidate = { idx: i, score: res.score };
      if (best === null) {
        best = candidate;
      } else if (player === ai ? candidate.score > best.score : candidate.score < best.score) {
        best = candidate;
      }
    }
    return best;
  }

  function buildBoard() {
    boardEl.innerHTML = "";
    cellEls = [];
    for (let i = 0; i < 9; i++) {
      const c = document.createElement("button");
      c.type = "button";
      c.className = "cell";
      c.setAttribute("role", "gridcell");
      c.setAttribute("aria-label", "cell " + (i + 1));
      c.dataset.i = String(i);
      c.addEventListener("click", () => play(i));
      boardEl.appendChild(c);
      cellEls.push(c);
    }
  }

  function render(winInfo) {
    for (let i = 0; i < 9; i++) {
      const v = board[i];
      const el = cellEls[i];
      el.textContent = v || "";
      el.classList.toggle("taken", !!v);
      el.classList.toggle("x", v === "X");
      el.classList.toggle("o", v === "O");
      el.classList.toggle("win", !!(winInfo && winInfo.line.includes(i)));
      el.classList.toggle("last", mode === "whatsapp" && lastMove === i);
      el.disabled = !!v || !!winInfo || (mode === "whatsapp" ? !linkCanMove : turn !== human);
    }
  }

  function setStatus(msg) { statusEl.textContent = msg; }

  function cancelAI() {
    if (aiTimer !== null) { clearTimeout(aiTimer); aiTimer = null; }
  }

  function play(i) {
    if (mode === "whatsapp") return playLink(i);
    if (gameOver || board[i] || turn !== human) return;
    board[i] = human;
    const w = winner(board);
    if (w) { render(w); return end(w); }
    turn = ai;
    render(null);
    setStatus("AI thinking…");
    cancelAI();
    aiTimer = setTimeout(aiMove, 200);
  }

  function aiMove() {
    aiTimer = null;
    if (gameOver) return;
    const move = minimax(board.slice(), ai);
    if (!move) return;
    board[move.idx] = ai;
    const w = winner(board);
    if (w) { render(w); return end(w); }
    turn = human;
    render(null);
    setStatus("Your turn (" + human + ").");
  }

  function end(w) {
    gameOver = true;
    cancelAI();
    if (w.player === "draw") setStatus("Draw.");
    else if (w.player === human) setStatus("You win! 🎉");
    else setStatus("AI wins.");
  }

  function reset() {
    cancelAI();
    board = Array(9).fill(null);
    gameOver = false;
    turn = "X";
    if (human === "O") {
      render(null);
      setStatus("AI thinking…");
      aiTimer = setTimeout(aiMove, 200);
    } else {
      render(null);
      setStatus("Your turn (" + human + ").");
    }
  }

  function updateToggleLabel() {
    toggleBtn.textContent = "Play as " + (human === "X" ? "O" : "X");
  }

  // ---------- 2 players over WhatsApp ----------
  // board: 9 cells, row by row (index = row * 3 + col): "X" | "O" | null.
  // X always opens. last: index of the most recent move.
  // board on the wire is a 9-char string, not a JSON array — "." for an
  // empty cell — shorter before compression, matching every other game.
  function boardToStr(b) { return b.map(v => v === null ? "." : v).join(""); }
  function strToBoard(s) { return s.split("").map(c => c === "." ? null : c); }

  const link = AsyncShare.start({
    game: "tic-tac-toe",
    version: 2,
    title: "tic-tac-toe",
    players: ["X", "O"],
    ui: document.getElementById("wa-ui"),
    statusEl: statusEl,
    validateBoard: (s) => {
      const b = s.board;
      if (typeof b !== "string" || b.length !== 9 || !/^[.XO]{9}$/.test(b)) return false;
      if (b.split("").filter(c => c !== ".").length !== s.moveCount) return false;
      return Number.isInteger(s.last) && s.last >= 0 && s.last < 9 && b[s.last] !== ".";
    },
    onState: loadLink,
  });

  function loadLink(state, canMove) {
    cancelAI();
    board = state ? strToBoard(state.board) : Array(9).fill(null);
    turn = state ? state.turn : "X";
    lastMove = state ? state.last : null;
    linkCanMove = canMove;
    const w = winner(board);
    gameOver = !!w;
    render(w);
  }

  function playLink(i) {
    if (!linkCanMove || board[i]) return;
    board[i] = turn;
    const w = winner(board);
    link.commit({
      board: boardToStr(board),
      status: !w ? "in_progress" : w.player === "draw" ? "draw" : "won",
      winner: w && w.player !== "draw" ? w.player : null,
      last: i,
    });
  }

  function applyMode() {
    toggleBtn.hidden = mode !== "ai";
    if (mode === "whatsapp") {
      link.show();
    } else {
      link.hide();
      reset();
    }
  }

  resetBtn.addEventListener("click", () => (mode === "whatsapp" ? link.newGame() : reset()));
  toggleBtn.addEventListener("click", () => {
    human = human === "X" ? "O" : "X";
    ai = human === "X" ? "O" : "X";
    updateToggleLabel();
    reset();
  });
  modeSel.addEventListener("change", () => {
    mode = modeSel.value;
    applyMode();
  });

  human = "X"; ai = "O";
  buildBoard();
  updateToggleLabel();
  modeSel.value = mode;
  applyMode();
})();
