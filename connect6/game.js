(function () {
  "use strict";

  const R = globalThis.Connect6Rules;
  const N = R.N, CELLS = R.CELLS;
  const BLACK = 1, WHITE = 2;
  const NAMES = { [BLACK]: "Black", [WHITE]: "White" };
  const other = R.other;

  const boardEl = document.getElementById("board");
  const statusEl = document.getElementById("status");
  const hintEl = document.getElementById("hint");
  const undoBtn = document.getElementById("undo-btn");
  const resetBtn = document.getElementById("reset-btn");
  const chipsEl = document.getElementById("chips");
  const modeSel = document.getElementById("mode");
  const sideSel = document.getElementById("side");
  const store = Gamekit.storage("connect6:");

  let diff = store.get("diff", "medium");
  if (!["easy", "medium", "hard"].includes(diff)) diff = "medium";
  let mode = store.get("mode", "whatsapp");
  if (!["whatsapp", "ai", "local"].includes(mode)) mode = "whatsapp";
  const params = new URLSearchParams(location.search);
  const invited = params.has("live");
  if (params.has("s")) mode = "whatsapp"; else if (invited) mode = "live";
  const isLinked = () => mode === "whatsapp" || mode === "live";
  modeSel.value = mode === "live" ? "live" : mode;
  sideSel.value = store.get("side", "1") === "2" ? "2" : "1";

  // ---------- the position ----------
  let S = R.create();               // { b, t, p } (see rules.js)
  let cur = BLACK;
  let over = false, winner = 0;
  let history = [];                 // [{ s: wire string, cur, last }] for undo, one turn per entry
  let humanIs = BLACK;
  let pending = [];                 // points of the turn being built, not yet played
  let lastPoints = [];              // the points of the last completed turn
  let winLine = null;               // the six (or more) to highlight
  let thinking = false, aiTimer = null;
  let linkCanMove = false;

  const el = (tag, cls) => { const e = document.createElement(tag); if (cls) e.className = cls; return e; };
  const canAct = () => !over && !thinking && (isLinked() ? linkCanMove : mode === "ai" ? cur === humanIs : true);

  // ---------- drawing ----------
  const cellEls = [];
  function buildBoard() {
    boardEl.innerHTML = "";
    for (let i = 0; i < CELLS; i++) {
      const r = (i / N) | 0, c = i % N;
      const b = el("button", "c6-cell" +
        (r === 0 ? " top" : "") + (r === N - 1 ? " bot" : "") +
        (c === 0 ? " lft" : "") + (c === N - 1 ? " rgt" : ""));
      b.type = "button";
      // the nine star points of a 15x15 board
      if ((r === 3 || r === 7 || r === 11) && (c === 3 || c === 7 || c === 11)) b.classList.add("star");
      b.innerHTML = '<span class="c6-stone"></span>';
      b.addEventListener("click", () => onCell(i));
      boardEl.append(b);
      cellEls.push(b);
    }
  }

  function winLineFrom(points) {
    for (const i of points) {
      const line = R.lineAt(S.b, i);
      if (line) return line;
    }
    return null;
  }

  function render() {
    if (!S) return;
    const act = canAct();
    const pend = new Set(pending);
    const last = new Set(lastPoints);
    const win = winLine ? new Set(winLine) : null;
    boardEl.dataset.turn = cur === BLACK ? "b" : "w";
    for (let i = 0; i < CELLS; i++) {
      const v = S.b[i], b = cellEls[i];
      b.classList.toggle("b", v === BLACK);
      b.classList.toggle("w", v === WHITE);
      b.classList.toggle("pend", pend.has(i));
      b.classList.toggle("pw", pend.has(i) && cur === WHITE);
      b.classList.toggle("last", !win && last.has(i) && !pend.has(i));
      b.classList.toggle("win", !!win && win.has(i));
      b.disabled = !act;
      const r = (i / N) | 0, c = i % N;
      b.setAttribute("aria-label", "row " + (r + 1) + ", column " + (c + 1) +
        (v === BLACK ? ", Black stone" : v === WHITE ? ", White stone" : pend.has(i) ? ", your stone" : ""));
    }
    undoBtn.disabled = isLinked() || thinking || (history.length === 0 && pending.length === 0);
    hintEl.textContent = hintText(act);
  }

  function hintText(act) {
    if (!act) return "";
    if (pending.length) return "Tap one more point, or tap that stone again to take it back.";
    const rem = R.remaining(S);
    if (rem === 1) return R.emptyCount(S.b) === CELLS
      ? "Tap a point for Black's opening stone."
      : "Tap a point for your last stone.";
    return "Tap two points to place your stones.";
  }

  // ---------- building a turn ----------
  function simulate(from, points) {
    let T = from;
    for (const i of points) {
      T = R.play(T, cur, i);
      if (!T) return null;
    }
    return T;
  }

  function onCell(i) {
    if (!S || !canAct()) return;
    const at = pending.indexOf(i);
    if (at !== -1) { pending.splice(at, 1); render(); return; }
    if (S.b[i] !== 0) return;
    pending.push(i);
    const trial = simulate(S, pending);
    if (!trial) { pending.pop(); render(); return; }
    const o = R.outcome(trial, cur);
    if (o.status !== "in_progress" || pending.length >= R.remaining(S)) {
      return commitTurn(pending.slice());
    }
    render();
  }

  // ---------- making a move ----------
  function commitTurn(points) {
    if (!points.length) return;
    if (isLinked()) return playLink(points);
    history.push({ s: R.str(S), cur: cur, last: lastPoints.slice() });
    pending = [];
    applyTurn(points);
  }

  function applyTurn(points) {
    const mover = cur;
    let T = S;
    const applied = [];
    for (const i of points) {
      if (T.t !== mover) break;
      const U = R.play(T, mover, i);
      if (!U) break;
      T = U;
      applied.push(i);
    }
    if (!applied.length) return;
    S = T;
    cur = S.t;
    lastPoints = applied;
    pending = [];
    const o = R.outcome(S, mover);
    if (o.status !== "in_progress") {
      over = true;
      winner = o.winner;
      winLine = o.status === "won" ? winLineFrom(applied) : null;
      return finish(o.status);
    }
    afterMove();
  }

  function afterMove() {
    if (mode === "ai" && cur !== humanIs) {
      thinking = true;
      Gamekit.turn(cur, "Bot thinking…", true);
      statusEl.textContent = "Bot thinking…";
      render();
      aiTimer = setTimeout(aiMove, 800 + Math.floor(Math.random() * 500));
      return;
    }
    showTurn();
    render();
  }

  function aiMove() {
    aiTimer = null;
    thinking = false;
    if (over || !S) return;
    const mover = cur;
    let pts = null;
    try { pts = R.bestMove(R.str(S), mover, diff, Math.random); } catch (e) { pts = null; }
    if (!pts || !pts.length) {
      // A safety net: the rules always offer an empty point while the game is
      // live, but never leave the board stuck if the computer returns nothing.
      const free = R.gen(S, mover);
      if (free.length) pts = [free[0]];
      else {
        over = true;
        winner = 0;
        return finish("draw");
      }
    }
    history.push({ s: R.str(S), cur: cur, last: lastPoints.slice() });
    applyTurn(pts);
  }

  function cancelAI() {
    if (aiTimer !== null) { clearTimeout(aiTimer); aiTimer = null; }
    thinking = false;
  }

  function showTurn() {
    if (mode === "ai") {
      Gamekit.turn(humanIs, "Your move · you're " + NAMES[humanIs]);
      statusEl.textContent = "Your move.";
    } else {
      Gamekit.turn(cur, NAMES[cur] + "'s move");
      statusEl.textContent = NAMES[cur] + "'s move.";
    }
  }

  function finish(status) {
    cancelAI();
    Gamekit.turn(null);
    pending = [];
    linkCanMove = false;
    if (status === "draw") {
      statusEl.textContent = "Draw. The board is full. " + Gamekit.taunt("draw");
    } else if (mode === "ai") {
      statusEl.textContent = winner === humanIs
        ? "You win! " + Gamekit.taunt("win")
        : "Bot wins. " + Gamekit.taunt("loss");
    } else {
      statusEl.textContent = NAMES[winner] + " wins. " + NAMES[other(winner)] + " — " + Gamekit.taunt("loss");
    }
    render();
  }

  function newLocal() {
    cancelAI();
    S = R.create();
    cur = BLACK;
    over = false; winner = 0;
    history = []; pending = []; lastPoints = []; winLine = null;
    humanIs = sideSel.value === "2" ? WHITE : BLACK;
    if (mode === "ai" && cur !== humanIs) return afterMove();
    showTurn();
    render();
  }

  // Takes back one pending stone, or whole turns until it is the human's move.
  function undo() {
    if (isLinked()) return;
    cancelAI();
    if (pending.length) { pending.pop(); render(); return; }
    if (!history.length) return;
    over = false; winner = 0; winLine = null; pending = [];
    let restored = false;
    while (history.length) {
      const h = history.pop();
      const st = R.parse(h.s);
      if (!st) break;
      S = st;
      cur = h.cur;
      lastPoints = Array.isArray(h.last) ? h.last.slice() : [];
      restored = true;
      if (mode !== "ai" || cur === humanIs) break;
    }
    if (!restored) return newLocal();
    // The computer can be left to open again if undo reached its first turn
    // (only when the human plays White): start that game over rather than
    // leaving a board with nobody able to act.
    if (mode === "ai" && cur !== humanIs) return newLocal();
    showTurn();
    render();
  }

  // ---------- 2 players over WhatsApp, and live online ----------
  function validateBoard(s) {
    if (!s || typeof s.board !== "string") return false;
    const st = R.parse(s.board);
    if (!st) return false;
    if (s.last !== null && s.last !== undefined) {
      const pts = R.decodeLast(s.last);
      if (!pts) return false;
      for (const i of pts) if (st.b[i] === 0) return false;
    }
    // A resignation leaves the board's turn on the resigning side; the envelope
    // names the winner instead. Every ordinary link has the two in step.
    if (!s.resigned && st.t !== s.turn) return false;
    return true;
  }
  const shared = {
    game: "connect6", version: 1, players: [BLACK, WHITE],
    label: (p) => NAMES[p],
    ui: document.getElementById("wa-ui"), statusEl: statusEl,
    validateBoard: validateBoard, onState: loadLink,
  };
  const link = AsyncShare.start(Object.assign({ title: "connect6" }, shared));
  const live = typeof LiveShare === "undefined" ? null : LiveShare.start(shared);
  const activeLink = () => (mode === "live" && live ? live : link);

  function loadLink(s, canMove, info) {
    cancelAI();
    S = (s && R.parse(s.board)) || R.create();
    cur = s ? s.turn : S.t;
    over = !!s && s.status !== "in_progress";
    winner = over ? s.winner || 0 : 0;
    pending = [];
    lastPoints = s && Number.isInteger(s.last) ? (R.decodeLast(s.last) || []) : [];
    winLine = over && winner && !s.resigned ? winLineFrom(lastPoints) : null;
    linkCanMove = canMove;
    render();
  }

  function playLink(points) {
    const T = simulate(S, points);
    if (!T) { pending = []; render(); return; }
    const o = R.outcome(T, cur);
    pending = [];
    activeLink().commit({
      board: R.str(T),
      status: o.status,
      winner: o.winner || null,
      last: R.encodeLast(points),
    });
  }

  // ---------- modes and controls ----------
  function applyMode() {
    if (mode === "live" && !live) { mode = "whatsapp"; modeSel.value = mode; }
    chipsEl.hidden = mode !== "ai";
    sideSel.hidden = mode !== "ai";
    resetBtn.hidden = isLinked();
    undoBtn.hidden = isLinked();
    if (mode === "whatsapp") { if (live) live.hide(); link.show(); }
    else if (mode === "live" && live) { link.hide(); live.show(); }
    else { link.hide(); if (live) live.hide(); newLocal(); }
  }

  const chips = Gamekit.wireDifficultyChips({
    el: chipsEl, difficulties: ["easy", "medium", "hard"], initial: diff, storage: store, storageKey: "diff",
    onChange: (d) => { diff = d; if (mode === "ai") newLocal(); },
  });
  diff = chips.get();

  modeSel.addEventListener("change", () => {
    mode = modeSel.value;
    if (mode !== "live") store.set("mode", mode);
    applyMode();
  });
  sideSel.addEventListener("change", () => { store.set("side", sideSel.value); if (mode === "ai") newLocal(); });
  resetBtn.addEventListener("click", () => (isLinked() ? activeLink().newGame() : newLocal()));
  undoBtn.addEventListener("click", undo);

  buildBoard();

  const liveOpt = modeSel.querySelector('option[value="live"]');
  if (live && invited) liveOpt.hidden = false;
  else if (live) LiveShare.enable(modeSel, "connect6");
  applyMode();

  // A refresh keeps a game against the computer or on one device.
  const resumer = Gamekit.resume("connect6", () => (isLinked() || over || !history.length) ? null : {
    mode: mode, diff: diff, s: R.str(S), cur: cur, human: humanIs,
    h: history, last: lastPoints,
  }, (s) => {
    if (s.mode !== "ai" && s.mode !== "local") return false;
    const st = R.parse(s.s);
    if (!st || st.p !== 0 || st.t !== s.cur) return false;
    if (s.cur !== BLACK && s.cur !== WHITE) return false;
    if (!Array.isArray(s.h) || !s.h.every((x) => {
      if (!x || typeof x.s !== "string") return false;
      const h = R.parse(x.s);
      return !!h && h.p === 0 && (x.cur === BLACK || x.cur === WHITE) &&
        (!x.last || (Array.isArray(x.last) && x.last.every((i) => Number.isInteger(i) && i >= 0 && i < CELLS)));
    })) return false;
    const last = Array.isArray(s.last) && s.last.every((i) => Number.isInteger(i) && i >= 0 && i < CELLS) ? s.last.slice() : [];
    mode = s.mode; modeSel.value = mode;
    diff = ["easy", "medium", "hard"].includes(s.diff) ? s.diff : "medium";
    chips.show(diff);
    humanIs = s.human === WHITE ? WHITE : BLACK;
    sideSel.value = humanIs === WHITE ? "2" : "1";
    applyMode();
    cancelAI();
    S = st; cur = s.cur;
    history = s.h.map((x) => ({ s: x.s, cur: x.cur, last: Array.isArray(x.last) ? x.last.slice() : [] }));
    over = false; winner = 0; winLine = null; pending = []; lastPoints = last;
    if (mode === "ai" && cur !== humanIs) afterMove(); else { showTurn(); render(); }
    return true;
  });
  if (!params.has("s") && !invited) resumer.restore();
  window.addEventListener("load", () => Manpage.autoOpen("connect6"));

  if (window.Gamekit && Gamekit.popFilled) Gamekit.popFilled(boardEl);   // newly filled points pop in
})();
