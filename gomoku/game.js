(function () {
  "use strict";

  const SIZE = 15, CELLS = SIZE * SIZE;
  const BLACK = 1, WHITE = 2;
  const NAMES = { [BLACK]: "Black", [WHITE]: "White" };
  const DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];
  const other = (p) => (p === BLACK ? WHITE : BLACK);
  const inB = (r, c) => r >= 0 && r < SIZE && c >= 0 && c < SIZE;

  const boardEl = document.getElementById("board");
  const statusEl = document.getElementById("status");
  const undoBtn = document.getElementById("undo-btn");
  const resetBtn = document.getElementById("reset-btn");
  const chipsEl = document.getElementById("chips");
  const modeSel = document.getElementById("mode");
  const sideSel = document.getElementById("side");
  const hintEl = document.getElementById("tap-hint");
  const store = Gamekit.storage("gomoku:");

  // On a touchscreen a 15x15 board has small targets, so the first tap only
  // previews a stone and the second tap on the same point places it.
  const coarse = !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches);
  hintEl.hidden = !coarse;

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
  let grid = new Uint8Array(CELLS);   // 0 empty, 1 Black, 2 White
  let history = [];                   // [{i, p}]
  let current = BLACK;
  let over = false, winCells = null;
  let sel = null;                     // previewed point (touchscreens)
  let humanIs = BLACK;
  let thinking = false, aiTimer = null;
  let lastIdx = null;                 // highlighted stone in link mode
  let linkCanMove = false;

  // The line of five or more that the stone at idx completes, or null.
  function lineAt(g, idx) {
    const p = g[idx];
    if (!p) return null;
    const r0 = Math.floor(idx / SIZE), c0 = idx % SIZE;
    for (const [dr, dc] of DIRS) {
      const cells = [idx];
      for (const s of [1, -1]) {
        let r = r0 + dr * s, c = c0 + dc * s;
        while (inB(r, c) && g[r * SIZE + c] === p) { cells.push(r * SIZE + c); r += dr * s; c += dc * s; }
      }
      if (cells.length >= 5) return cells;
    }
    return null;
  }
  const full = (g) => !g.includes(0);

  // ---------- drawing ----------
  const cellEls = [];
  function buildBoard() {
    boardEl.innerHTML = "";
    for (let i = 0; i < CELLS; i++) {
      const r = Math.floor(i / SIZE), c = i % SIZE;
      const b = document.createElement("button");
      b.type = "button";
      b.className = "gm-cell" + (r === 0 ? " top" : "") + (r === SIZE - 1 ? " bot" : "") + (c === 0 ? " lft" : "") + (c === SIZE - 1 ? " rgt" : "");
      if ((r === 3 || r === 7 || r === 11) && (c === 3 || c === 7 || c === 11)) b.classList.add("star");
      b.setAttribute("aria-label", "row " + (r + 1) + ", column " + (c + 1));
      b.innerHTML = '<span class="gm-stone"></span>';
      b.addEventListener("click", () => onCell(i));
      boardEl.appendChild(b);
      cellEls.push(b);
    }
  }

  function render() {
    const win = winCells ? new Set(winCells) : null;
    const lastLocal = history.length ? history[history.length - 1].i : null;
    const last = isLinked() ? lastIdx : lastLocal;
    const turnP = isLinked() ? current : current;
    boardEl.dataset.turn = turnP === BLACK ? "b" : "w";
    for (let i = 0; i < CELLS; i++) {
      const v = grid[i], el = cellEls[i];
      el.classList.toggle("b", v === BLACK);
      el.classList.toggle("w", v === WHITE);
      el.classList.toggle("win", !!win && win.has(i));
      el.classList.toggle("last", last === i && !win);
      el.classList.toggle("sel", sel === i && !v);
      el.disabled = !!v || over || thinking || (isLinked() ? !linkCanMove : current !== humanIs && mode === "ai");
    }
    undoBtn.disabled = isLinked() || history.length === 0 || thinking;
  }

  const slotOf = (p) => (p === BLACK ? 1 : 2);

  // ---------- the computer ----------
  // Every empty point near a stone is scored by what it would build for the
  // computer and what it would stop the human building. Runs of four and an
  // open three score highest; hard also looks one reply ahead.
  function pat(cnt, open) {
    if (cnt >= 5) return 1e6;
    if (open === 0) return 0;
    if (cnt === 4) return open === 2 ? 50000 : 5000;
    if (cnt === 3) return open === 2 ? 3000 : 300;
    if (cnt === 2) return open === 2 ? 100 : 10;
    return 1;
  }
  function lineScore(g, i, p) {
    const r0 = Math.floor(i / SIZE), c0 = i % SIZE;
    let total = 0;
    for (const [dr, dc] of DIRS) {
      let cnt = 1, open = 0;
      for (const s of [1, -1]) {
        let r = r0 + dr * s, c = c0 + dc * s;
        while (inB(r, c) && g[r * SIZE + c] === p) { cnt++; r += dr * s; c += dc * s; }
        if (inB(r, c) && g[r * SIZE + c] === 0) open++;
      }
      total += pat(cnt, open);
    }
    return total;
  }
  function candidates(g) {
    const near = new Set();
    for (let i = 0; i < CELLS; i++) {
      if (!g[i]) continue;
      const r0 = Math.floor(i / SIZE), c0 = i % SIZE;
      for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
        const r = r0 + dr, c = c0 + dc;
        if (inB(r, c) && !g[r * SIZE + c]) near.add(r * SIZE + c);
      }
    }
    return Array.from(near);
  }
  function aiPick(g, me, level) {
    const them = other(me);
    const cand = candidates(g);
    if (!cand.length) return Math.floor(CELLS / 2);
    const defend = level === "easy" ? 0.4 : 0.95;
    const scored = cand.map((i) => ({ i, s: lineScore(g, i, me) + defend * lineScore(g, i, them) }));
    scored.sort((a, b) => b.s - a.s);
    if (level === "easy") {
      // often just one of the better-looking points, sometimes anything nearby
      if (Math.random() < 0.25) return cand[Math.floor(Math.random() * cand.length)];
      return scored[Math.floor(Math.random() * Math.min(5, scored.length))].i;
    }
    if (level === "hard") {
      // one reply deep: prefer the point after which the human's best answer is weakest
      let best = null;
      for (const { i, s } of scored.slice(0, 8)) {
        if (s >= 1e6) return i;                         // an immediate win
        g[i] = me;
        let worst = 0;
        for (const j of candidates(g)) worst = Math.max(worst, lineScore(g, j, them) + 0.5 * lineScore(g, j, me));
        g[i] = 0;
        const v = s - 0.8 * worst;
        if (best === null || v > best.v) best = { i, v };
      }
      return best.i;
    }
    // medium: the best point, now and then the runner-up
    return Math.random() < 0.15 && scored.length > 1 ? scored[1].i : scored[0].i;
  }

  function cancelAI() { if (aiTimer !== null) { clearTimeout(aiTimer); aiTimer = null; } thinking = false; }

  // ---------- playing a stone (computer and same-device modes) ----------
  function place(i, p) {
    grid[i] = p;
    history.push({ i, p });
    const line = lineAt(grid, i);
    if (line) { winCells = line; over = true; return { status: "won", winner: p }; }
    if (full(grid)) { over = true; return { status: "draw", winner: null }; }
    current = other(p);
    return { status: "in_progress", winner: null };
  }

  function onCell(i) {
    if (grid[i] || over) return;
    if (isLinked()) {
      if (!linkCanMove) return;
      if (coarse && sel !== i) { sel = i; return render(); }
      sel = null;
      return playLink(i);
    }
    if (thinking || (mode === "ai" && current !== humanIs)) return;
    if (coarse && sel !== i) { sel = i; return render(); }
    sel = null;
    const res = place(i, current);
    afterMove(res);
  }

  function afterMove(res) {
    if (res.status !== "in_progress") return finish(res);
    if (mode === "ai" && current !== humanIs) {
      thinking = true;
      Gamekit.turn(slotOf(current), "Computer thinking…", true);
      statusEl.textContent = "Computer thinking…";
      render();
      aiTimer = setTimeout(aiMove, 350);
      return;
    }
    showTurn();
    render();
  }

  function aiMove() {
    aiTimer = null;
    thinking = false;
    if (over) return;
    const res = place(aiPick(grid, current, diff), current);
    afterMove(res);
  }

  function showTurn() {
    if (mode === "ai") {
      Gamekit.turn(slotOf(humanIs), "Your move · you're " + NAMES[humanIs]);
      statusEl.textContent = "Your move.";
    } else {
      Gamekit.turn(slotOf(current), NAMES[current] + "'s move");
      statusEl.textContent = NAMES[current] + "'s move.";
    }
  }

  function finish(res) {
    cancelAI();
    Gamekit.turn(null);
    if (res.status === "draw") statusEl.textContent = "Draw. " + Gamekit.taunt("draw");
    else if (mode === "ai") {
      statusEl.textContent = res.winner === humanIs ? "You win! 🎉 " + Gamekit.taunt("win") : "Computer wins. " + Gamekit.taunt("loss");
    } else {
      statusEl.textContent = `${NAMES[res.winner]} wins. ${NAMES[other(res.winner)]} — ${Gamekit.taunt("loss")}`;
    }
    render();
  }

  function newLocal() {
    cancelAI();
    grid = new Uint8Array(CELLS);
    history = []; over = false; winCells = null; sel = null;
    current = BLACK;
    humanIs = sideSel.value === "2" ? WHITE : BLACK;
    if (mode === "ai" && humanIs === WHITE) return afterMove({ status: "in_progress" });
    showTurn();
    render();
  }

  // Takes back moves until it is the human's turn again (against the computer
  // that is the computer's reply and then the human's own move).
  function undo() {
    if (isLinked() || !history.length) return;
    cancelAI();
    over = false; winCells = null; sel = null;
    do {
      const m = history.pop();
      grid[m.i] = 0;
      current = m.p;
    } while (history.length && mode === "ai" && current !== humanIs);
    showTurn();
    render();
  }

  // ---------- 2 players over WhatsApp, and live online ----------
  // board: 225 chars, row by row: '0' empty, '1' Black, '2' White. Black opens.
  const gridToStr = (g) => Array.from(g).join("");
  function validateGomoku(s) {
    const b = s.board;
    if (typeof b !== "string" || b.length !== CELLS || !/^[012]+$/.test(b)) return false;
    const stones = b.length - b.replace(/[12]/g, "").length;
    if (stones !== s.moveCount && !(s.resigned && stones === s.moveCount - 1)) return false;
    return Number.isInteger(s.last) && s.last >= 0 && s.last < CELLS && b[s.last] !== "0";
  }
  const shared = {
    game: "gomoku", version: 1, players: [BLACK, WHITE],
    label: (p) => NAMES[p],
    ui: document.getElementById("wa-ui"), statusEl: statusEl,
    validateBoard: validateGomoku, onState: loadLink,
  };
  const link = AsyncShare.start(Object.assign({ title: "gomoku" }, shared));
  const live = typeof LiveShare === "undefined" ? null : LiveShare.start(shared);
  const activeLink = () => (mode === "live" && live ? live : link);

  function loadLink(s, canMove) {
    cancelAI();
    grid = s ? Uint8Array.from(s.board, Number) : new Uint8Array(CELLS);
    current = s ? s.turn : BLACK;
    lastIdx = s ? s.last : null;
    history = [];
    winCells = null;
    over = false;
    if (s && s.status !== "in_progress") {
      over = true;
      if (s.status === "won" && !s.resigned) winCells = lineAt(grid, s.last);
    }
    linkCanMove = canMove;
    sel = null;
    render();
  }

  function playLink(i) {
    const p = current;
    grid[i] = p;
    const line = lineAt(grid, i);
    const status = line ? "won" : full(grid) ? "draw" : "in_progress";
    activeLink().commit({ board: gridToStr(grid), status, winner: line ? p : null, last: i });
  }

  // ---------- modes and controls ----------
  function applyMode() {
    chipsEl.hidden = mode !== "ai";
    sideSel.hidden = mode !== "ai";
    resetBtn.hidden = isLinked();
    undoBtn.hidden = isLinked();
    hintEl.hidden = !coarse;
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

  // The live option stays hidden until the server says live play is on for this game.
  const liveOpt = modeSel.querySelector('option[value="live"]');
  if (live && invited) liveOpt.hidden = false;
  else if (live) {
    LiveShare.enable(modeSel, "gomoku");
  }
  applyMode();

  // A refresh keeps a game against the computer or on one device.
  const resumer = Gamekit.resume("gomoku", () => (isLinked() || over || !history.length) ? null : {
    mode: mode, g: gridToStr(grid), h: history, cur: current, human: humanIs,
  }, (s) => {
    if (s.mode !== "ai" && s.mode !== "local") return false;
    if (typeof s.g !== "string" || s.g.length !== CELLS || !/^[012]+$/.test(s.g)) return false;
    if (!Array.isArray(s.h) || !s.h.every((m) => m && Number.isInteger(m.i) && m.i >= 0 && m.i < CELLS && (m.p === 1 || m.p === 2))) return false;
    if (s.cur !== 1 && s.cur !== 2 && s.h.length) return false;
    mode = s.mode; modeSel.value = mode;
    applyMode();
    cancelAI();
    humanIs = s.human === WHITE ? WHITE : BLACK;
    sideSel.value = humanIs === WHITE ? "2" : "1";
    grid = Uint8Array.from(s.g, Number);
    history = s.h.map((m) => ({ i: m.i, p: m.p }));
    current = s.cur;
    over = false; winCells = null; sel = null;
    if (mode === "ai" && current !== humanIs) afterMove({ status: "in_progress" }); else { showTurn(); render(); }
    return true;
  });
  if (!params.has("s") && !invited) resumer.restore();
  window.addEventListener("load", () => Manpage.autoOpen("gomoku"));

})();

if (window.Gamekit && Gamekit.popFilled) Gamekit.popFilled(document.getElementById("board"));   // new squares pop in
