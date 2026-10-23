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
  let mode = "whatsapp";      // "whatsapp" | "live" | "ai"
  let lastMove = null;        // highlighted cell in WhatsApp / live mode
  let linkCanMove = false;    // WhatsApp / live mode: is it this viewer's move?
  // Both link modes share the same board + state envelope; only the way a
  // move travels differs (a link vs a live socket).
  const isLinked = () => mode === "whatsapp" || mode === "live";

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

  // The AI plays optimally, so a material "lead" isn't a meaningful signal
  // here the way it is in checkers/connect-four - but a genuine fork (two
  // simultaneous winning threats, unblockable in one move) is a real
  // "you're cooked" moment worth calling out.
  function countThreats(b, player) {
    let n = 0;
    for (const line of LINES) {
      const filled = line.filter(i => b[i] === player).length;
      const empty = line.filter(i => b[i] === null).length;
      if (filled === 2 && empty === 1) n++;
    }
    return n;
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

  // The winning line is drawn across the three squares (white on a black edge, matching the # grid) before the result card.
  let lineKey = "";
  function winLine(winInfo) {
    const old = boardEl.querySelector(".ttt-line");
    const key = winInfo && winInfo.line.length === 3 ? winInfo.line.join("-") + "|" + board.join("") : "";
    if (key === lineKey) return;
    lineKey = key;
    if (old) old.remove();
    if (!key) return;
    const a = cellEls[winInfo.line[0]], z = cellEls[winInfo.line[2]];
    const x1 = a.offsetLeft + a.offsetWidth / 2, y1 = a.offsetTop + a.offsetHeight / 2, x2 = z.offsetLeft + z.offsetWidth / 2, y2 = z.offsetTop + z.offsetHeight / 2;
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy), ext = a.offsetWidth * 0.3;
    const ux = dx / len, uy = dy / len, sx = x1 - ux * ext, sy = y1 - uy * ext, ex = x2 + ux * ext, ey = y2 + uy * ext, total = Math.hypot(ex - sx, ey - sy);
    const ns = "http://www.w3.org/2000/svg", svg = document.createElementNS(ns, "svg");
    svg.setAttribute("class", "ttt-line");
    svg.setAttribute("viewBox", "0 0 " + boardEl.clientWidth + " " + boardEl.clientHeight);
    svg.setAttribute("aria-hidden", "true");
    [["#000", 26], ["#fff", 14]].forEach(([colour, w]) => {
      const l = document.createElementNS(ns, "line");
      l.setAttribute("x1", sx); l.setAttribute("y1", sy); l.setAttribute("x2", ex); l.setAttribute("y2", ey);
      l.setAttribute("stroke", colour); l.setAttribute("stroke-width", w); l.setAttribute("stroke-linecap", "round");
      l.setAttribute("stroke-dasharray", total); l.setAttribute("stroke-dashoffset", 0);
      svg.appendChild(l);
      if (!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) && l.animate) l.animate([{ strokeDashoffset: total }, { strokeDashoffset: 0 }], { duration: 480, delay: 120, easing: "cubic-bezier(.5,0,.2,1)", fill: "backwards" });
    });
    boardEl.appendChild(svg);
  }

  function render(winInfo) {
    winLine(winInfo);
    for (let i = 0; i < 9; i++) {
      const v = board[i];
      const el = cellEls[i];
      el.textContent = v || "";
      el.classList.toggle("taken", !!v);
      el.classList.toggle("x", v === "X");
      el.classList.toggle("o", v === "O");
      el.classList.toggle("win", !!(winInfo && winInfo.line.includes(i)));
      el.classList.toggle("last", isLinked() && lastMove === i);
      el.disabled = !!v || !!winInfo || (isLinked() ? !linkCanMove : turn !== human);
    }
  }

  function setStatus(msg) { statusEl.textContent = msg; }
  const slotOf = (p) => p === "X" ? 1 : 2;
  function humanBadge() { Gamekit.turn(slotOf(human), "Your turn · you're " + human); }
  function aiBadge() { Gamekit.turn(slotOf(ai), "Bot thinking…", true); }

  function cancelAI() {
    if (aiTimer !== null) { clearTimeout(aiTimer); aiTimer = null; }
  }

  function play(i) {
    if (isLinked()) return playLink(i);
    if (gameOver || board[i] || turn !== human) return;
    board[i] = human;
    const w = winner(board);
    if (w) { render(w); return end(w); }
    turn = ai;
    render(null);
    setStatus("Bot thinking…");
    aiBadge();
    cancelAI();
    aiTimer = setTimeout(aiMove, 800);
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
    const forked = countThreats(board, ai) >= 2;
    setStatus("Your turn (" + human + ")." + (forked ? " " + Gamekit.taunt("lastChance") : ""));
    humanBadge();
  }

  function end(w) {
    gameOver = true;
    cancelAI();
    Gamekit.turn(null);
    if (w.player === "draw") setStatus("Draw. " + Gamekit.taunt("draw"));
    else if (w.player === human) setStatus("You win! " + Gamekit.taunt("win"));
    else setStatus("Bot wins. " + Gamekit.taunt());
  }

  // for the checks: put the board in a position with the human to move
  window.__tttTest = { set: (b) => { cancelAI(); board = b.slice(); turn = human; gameOver = false; render(null); } };

  function reset() {
    cancelAI();
    board = Array(9).fill(null);
    gameOver = false;
    turn = "X";
    if (human === "O") {
      render(null);
      setStatus("Bot thinking…");
    aiBadge();
      aiTimer = setTimeout(aiMove, 800);
    } else {
      render(null);
      setStatus("Your turn (" + human + ").");
      humanBadge();
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

  function validateTtt(s) {
    const b = s.board;
    if (typeof b !== "string" || b.length !== 9 || !/^[.XO]{9}$/.test(b)) return false;
    // a resignation adds a move to the count without adding a mark
    const filled = b.split("").filter(c => c !== ".").length;
    if (filled !== s.moveCount && !(s.resigned && filled === s.moveCount - 1)) return false;
    return Number.isInteger(s.last) && s.last >= 0 && s.last < 9 && b[s.last] !== ".";
  }

  const link = AsyncShare.start({
    game: "tic-tac-toe",
    version: 2,
    title: "tic-tac-toe",
    players: ["X", "O"],
    ui: document.getElementById("wa-ui"),
    statusEl: statusEl,
    validateBoard: validateTtt,
    onState: loadLink,
  });

  // Live online play: same board and rules, moves go over a WebSocket room
  // instead of a link. LiveShare is absent only if its script failed to load.
  const live = typeof LiveShare === "undefined" ? null : LiveShare.start({
    game: "tic-tac-toe",
    version: 2,
    players: ["X", "O"],
    ui: document.getElementById("wa-ui"),
    statusEl: statusEl,
    validateBoard: validateTtt,
    onState: loadLink,
  });
  const activeLink = () => (mode === "live" && live ? live : link);

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
    activeLink().commit({
      board: boardToStr(board),
      status: !w ? "in_progress" : w.player === "draw" ? "draw" : "won",
      winner: w && w.player !== "draw" ? w.player : null,
      last: i,
    });
  }

  function applyMode() {
    toggleBtn.hidden = mode !== "ai";
    if (mode === "whatsapp") {
      if (live) live.hide();
      link.show();
    } else if (mode === "live" && live) {
      link.hide();
      live.show();
    } else {
      link.hide();
      if (live) live.hide();
      reset();
    }
  }

  resetBtn.addEventListener("click", () => (isLinked() ? activeLink().newGame() : reset()));
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

  // The live option stays hidden until the server says live play is on. A
  // ?live=CODE invite link opens straight into live mode (the way ?s= does
  // for WhatsApp mode); LiveShare shows its own message if it's switched off.
  const liveOpt = modeSel.querySelector('option[value="live"]');
  const invited = new URLSearchParams(location.search).has("live");
  if (live && invited) {
    mode = "live";
    liveOpt.hidden = false;
  } else if (live) {
    LiveShare.enable(modeSel, "tic-tac-toe");
  }
  modeSel.value = mode;
  applyMode();

  // A refresh keeps a game against the computer: the board and which side you play.
  // (Link and online games live in the URL / the room, so they are not saved here.)
  const resumer = Gamekit.resume("tic-tac-toe", () => (mode !== "ai" || gameOver || !board || !board.some(v => v)) ? null : {
    board: board, human: human, turn: turn,
  }, (s) => {
    if (!Array.isArray(s.board) || s.board.length !== 9 || !s.board.every(v => v === null || v === "X" || v === "O")) return false;
    if ((s.human !== "X" && s.human !== "O") || (s.turn !== "X" && s.turn !== "O")) return false;
    if (winner(s.board)) return false;
    mode = "ai"; modeSel.value = "ai";
    applyMode();                         // computer mode: fresh board, side buttons
    cancelAI();
    human = s.human; ai = human === "X" ? "O" : "X"; updateToggleLabel();
    board = s.board.slice(); turn = s.turn; gameOver = false;
    render(null);
    if (turn === human) { setStatus("Your turn (" + human + ")."); humanBadge(); }
    else { setStatus("Bot thinking…"); aiBadge(); aiTimer = setTimeout(aiMove, 800); }
    return true;
  });
  if (!new URLSearchParams(location.search).has("s") && !invited) resumer.restore();
})();

if (window.Gamekit && Gamekit.popFilled) Gamekit.popFilled(document.getElementById("board"));   // new squares pop in
