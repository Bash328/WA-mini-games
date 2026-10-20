(function () {
  "use strict";

  const R = globalThis.BlokusRules;
  const { SIZE, CELLS, PIECES, SIZES, START } = R;
  const ONE = 1, TWO = 2;
  const NAMES = { [ONE]: "Orange", [TWO]: "Violet" };
  const other = R.other;

  const boardEl = document.getElementById("board");
  const trayEl = document.getElementById("tray");
  const statusEl = document.getElementById("status");
  const scoreEl = document.getElementById("score");
  const rotateBtn = document.getElementById("rotate-btn");
  const flipBtn = document.getElementById("flip-btn");
  const placeBtn = document.getElementById("place-btn");
  const undoBtn = document.getElementById("undo-btn");
  const resetBtn = document.getElementById("reset-btn");
  const chipsEl = document.getElementById("chips");
  const modeSel = document.getElementById("mode");
  const sideSel = document.getElementById("side");
  const store = Gamekit.storage("blokus-duo:");

  let diff = store.get("diff", "medium");
  if (!["easy", "medium", "hard"].includes(diff)) diff = "medium";
  let mode = store.get("mode", "whatsapp");
  if (!["whatsapp", "ai", "local"].includes(mode)) mode = "whatsapp";
  const params = new URLSearchParams(location.search);
  const invited = params.has("live");
  if (params.has("s")) mode = "whatsapp"; else if (invited) mode = "live";
  const isLinked = () => mode === "whatsapp" || mode === "live";
  modeSel.value = mode;
  sideSel.value = store.get("side", "1") === "2" ? "2" : "1";
  const fine = !!(window.matchMedia && window.matchMedia("(hover: hover) and (pointer: fine)").matches);

  // ---------- state ----------
  let pos = R.parse(R.EMPTY);          // { grid, used }
  let current = ONE;
  let over = false, winner = 0, lastCells = [];
  let humanIs = ONE, thinking = false, aiTimer = null;
  let linkCanMove = false;
  let snaps = [];                      // undo stack: [{ board, current, last }]
  let note = "";                       // "Violet has no move: Orange goes again."
  let piece = -1, orient = null;       // the piece in hand and its current rotation (cells [r,c])
  let cursor = -1;                     // where the piece is held on the board (cell index), or -1
  let hover = -1;

  const boardStr = () => R.stringify(pos);
  // whose pieces the tray shows: the player to move (or, after sending a link, the one who just moved)
  const trayOwner = () => (isLinked() && !linkCanMove ? other(current) : current);
  const canAct = () => !over && !thinking && (isLinked() ? linkCanMove : mode === "ai" ? current === humanIs : true);

  // ---------- shapes in hand ----------
  const key = (cells) => cells.map((p) => p[0] + "," + p[1]).join(";");
  function norm(cells) {
    let mr = Infinity, mc = Infinity;
    for (const [r, c] of cells) { if (r < mr) mr = r; if (c < mc) mc = c; }
    return cells.map(([r, c]) => [r - mr, c - mc]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  }
  const rotated = (cells) => norm(cells.map(([r, c]) => [c, -r]));
  const flipped = (cells) => norm(cells.map(([r, c]) => [r, -c]));
  // the cell nearest the middle of the piece: it sits under the finger
  function pivotOf(cells) {
    let sr = 0, sc = 0; cells.forEach(([r, c]) => { sr += r; sc += c; });
    sr /= cells.length; sc /= cells.length;
    let best = 0, bd = Infinity;
    cells.forEach(([r, c], i) => { const d = (r - sr) * (r - sr) + (c - sc) * (c - sc); if (d < bd) { bd = d; best = i; } });
    return cells[best];
  }

  function selectPiece(p) {
    piece = p;
    orient = R.ORIENTS[p][0];
    cursor = -1;
    renderTray(); renderBoard(); renderActions();
  }
  function selectBest() {
    const used = pos.used[trayOwner()];
    piece = -1;
    for (let p = PIECES - 1; p >= 0; p--) if (!used[p]) { piece = p; break; }
    orient = piece >= 0 ? R.ORIENTS[piece][0] : null;
    cursor = -1;
  }

  // The cells the held piece would cover with its pivot on `at`, kept inside the board; null if there is no piece.
  function placementAt(at) {
    if (piece < 0 || at < 0) return null;
    const [pr, pc] = pivotOf(orient);
    let dr = ((at / SIZE) | 0) - pr, dc = (at % SIZE) - pc;
    let maxR = 0, maxC = 0; orient.forEach(([r, c]) => { if (r > maxR) maxR = r; if (c > maxC) maxC = c; });
    dr = Math.max(0, Math.min(SIZE - 1 - maxR, dr)); dc = Math.max(0, Math.min(SIZE - 1 - maxC, dc));
    return orient.map(([r, c]) => (r + dr) * SIZE + c + dc).sort((a, b) => a - b);
  }
  function legalPlacement(cells) {
    if (!cells || !canAct()) return false;
    const p = trayOwner();
    for (const i of cells) if (pos.grid[i]) return false;
    return R.placementLegal(pos.grid, cells, p, R.isFirst(pos.used[p]));
  }

  // ---------- drawing ----------
  const cellEls = [];
  function buildBoard() {
    boardEl.innerHTML = "";
    for (let i = 0; i < CELLS; i++) {
      const d = document.createElement("div");
      d.className = "bk-cell";
      d.dataset.i = i;
      boardEl.appendChild(d);
      cellEls.push(d);
    }
    boardEl.addEventListener("click", (e) => { const c = e.target.closest(".bk-cell"); if (c) onCell(+c.dataset.i); });
    if (fine) boardEl.addEventListener("mouseover", (e) => { const c = e.target.closest(".bk-cell"); const i = c ? +c.dataset.i : -1; if (i !== hover) { hover = i; renderBoard(); } });
    if (fine) boardEl.addEventListener("mouseleave", () => { hover = -1; renderBoard(); });
  }

  function renderBoard() {
    const owner = trayOwner();
    const hints = new Set(canAct() && !R.isFirst(pos.used[owner]) ? R.attachPoints(pos.grid, owner) : []);
    const showStart = canAct() && R.isFirst(pos.used[owner]) ? START[owner] : -1;
    const at = cursor >= 0 ? cursor : hover;
    const pv = canAct() ? placementAt(at) : null;
    const pvOk = pv ? legalPlacement(pv) : false;
    const pvSet = pv ? new Set(pv) : null;
    const last = new Set(lastCells);
    for (let i = 0; i < CELLS; i++) {
      const v = pos.grid[i];
      let cls = "bk-cell";
      if (v) cls += " p" + v + (last.has(i) ? " last" : "");
      else {
        if (i === START[ONE]) cls += " s1"; else if (i === START[TWO]) cls += " s2";
        if (hints.has(i)) cls += " hint";
        if (i === showStart) cls += " go";
      }
      if (pvSet && pvSet.has(i)) cls += pvOk ? " pv-ok" : " pv-bad";
      cellEls[i].className = cls;
    }
  }

  function renderTray() {
    const owner = trayOwner(), used = pos.used[owner];
    trayEl.dataset.p = owner;
    trayEl.innerHTML = "";
    for (let p = 0; p < PIECES; p++) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "bk-piece" + (p === piece ? " sel" : "") + (used[p] ? " used" : "");
      b.setAttribute("aria-label", "piece " + R.NAMES[p] + (used[p] ? " (used)" : ""));
      b.disabled = !!used[p] || !canAct();
      const cells = R.ORIENTS[p][0];
      let w = 0, h = 0; cells.forEach(([r, c]) => { if (c + 1 > w) w = c + 1; if (r + 1 > h) h = r + 1; });
      const g = document.createElement("span");
      g.className = "bk-mini";
      g.style.gridTemplateColumns = "repeat(" + w + ", 7px)";
      g.style.gridTemplateRows = "repeat(" + h + ", 7px)";
      const on = new Set(cells.map(([r, c]) => r * w + c));
      for (let k = 0; k < w * h; k++) { const s = document.createElement("i"); if (on.has(k)) s.className = "on"; g.appendChild(s); }
      b.appendChild(g);
      b.addEventListener("click", () => selectPiece(p));
      trayEl.appendChild(b);
    }
  }

  function renderActions() {
    const act = canAct() && piece >= 0;
    rotateBtn.disabled = !act; flipBtn.disabled = !act;
    placeBtn.disabled = !(act && legalPlacement(placementAt(cursor)));
    undoBtn.disabled = isLinked() || snaps.length === 0 || thinking;
  }

  function renderScore() {
    const a = R.squaresLeft(pos.used[ONE]), b = R.squaresLeft(pos.used[TWO]);
    scoreEl.innerHTML = '<span class="sc p1">' + NAMES[ONE] + ": " + a + ' left</span> · <span class="sc p2">' + NAMES[TWO] + ": " + b + " left</span>";
  }
  function renderAll() { renderScore(); renderTray(); renderBoard(); renderActions(); }

  // ---------- turns ----------
  function showTurn() {
    if (over) return;
    if (mode === "ai") { Gamekit.turn(humanIs, "Your move · you're " + NAMES[humanIs]); statusEl.textContent = (note ? note + " " : "") + "Your move."; }
    else { Gamekit.turn(current, NAMES[current] + "'s move"); statusEl.textContent = (note ? note + " " : "") + NAMES[current] + "'s move."; }
  }

  // The piece is down: update the position, work out who moves next, and carry on.
  function commitMove(move, p) {
    snaps.push({ board: boardStr(), current: p, last: lastCells });
    lastPieceBy[p] = move.piece;
    R.play(pos, p, move);
    lastCells = move.cells.slice();
    const out = R.outcome(pos, p, move.piece);
    note = out.status === "in_progress" && out.nextTurn === p ? NAMES[other(p)] + " has no move, so " + NAMES[p] + " goes again." : "";
    cursor = -1; hover = -1;
    if (out.status !== "in_progress") { over = true; winner = out.winner || 0; current = out.nextTurn; return finish(); }
    current = out.nextTurn;
    next();
  }
  function next() {
    selectBest();
    if (mode === "ai" && current !== humanIs) {
      thinking = true;
      Gamekit.turn(current, "Computer thinking…", true);
      statusEl.textContent = "Computer thinking…";
      renderAll();
      aiTimer = setTimeout(() => { aiTimer = null; thinking = false; if (over) return; const m = aiChoose(diff); if (m) commitMove(m, current); }, 450);
      return;
    }
    showTurn(); renderAll();
  }
  function cancelAI() { if (aiTimer !== null) { clearTimeout(aiTimer); aiTimer = null; } thinking = false; }

  function finish() {
    cancelAI(); Gamekit.turn(null);
    const a = R.penalty(pos.used[ONE], lastPieceOf(ONE)), b = R.penalty(pos.used[TWO], lastPieceOf(TWO));
    const tally = NAMES[ONE] + " " + a + " · " + NAMES[TWO] + " " + b + " (lower wins)";
    if (!winner) statusEl.textContent = "Draw. " + tally + ". " + Gamekit.taunt("draw");
    else if (mode === "ai") statusEl.textContent = (winner === humanIs ? "You win! 🎉 " : "Computer wins. ") + tally + ". " + Gamekit.taunt(winner === humanIs ? "win" : "loss");
    else statusEl.textContent = NAMES[winner] + " wins. " + tally + ". " + Gamekit.taunt("loss");
    renderAll();
  }
  // the piece a player placed last, only needed for the single-square bonus
  let lastPieceBy = { 1: -1, 2: -1 };
  const lastPieceOf = (p) => lastPieceBy[p];

  function onCell(i) {
    if (!canAct() || piece < 0) return;
    const pvCells = placementAt(i);
    // a second tap with the same spot, on a legal placement, puts the piece down
    if (cursor >= 0 && placementAt(cursor) && sameCells(placementAt(cursor), pvCells) && legalPlacement(pvCells)) return place();
    cursor = i;
    renderBoard(); renderActions();
  }
  const sameCells = (a, b) => a.length === b.length && a.every((v, k) => v === b[k]);

  function place() {
    const cells = placementAt(cursor);
    if (!cells || !legalPlacement(cells)) return;
    const p = trayOwner();
    const move = { piece, cells };
    if (isLinked()) return playLink(move, p);
    commitMove(move, p);
  }

  rotateBtn.addEventListener("click", () => { if (piece < 0) return; orient = rotated(orient); renderBoard(); renderActions(); });
  flipBtn.addEventListener("click", () => { if (piece < 0) return; orient = flipped(orient); renderBoard(); renderActions(); });
  placeBtn.addEventListener("click", place);
  document.addEventListener("keydown", (e) => {
    if (e.target.matches && e.target.matches("input,select,textarea")) return;
    if (e.key === "r" || e.key === "R") rotateBtn.click(); else if (e.key === "f" || e.key === "F") flipBtn.click(); else if (e.key === "Enter" && !placeBtn.disabled && !(e.target.matches && e.target.matches("button"))) place();
  });

  // ---------- the computer ----------
  // Score each legal placement: bigger pieces early, more of your own hooking
  // points (and fewer of the opponent's) afterwards. Easy mostly plays big
  // pieces anywhere; hard weighs both sides' room to grow.
  function aiChoose(level) {
    const me = current, opp = other(me);
    const moves = R.legalMoves(pos.grid, pos.used[me], me);
    if (!moves.length) return null;
    if (level === "easy") {
      let total = 0; const w = moves.map((m) => { const x = SIZES[m.piece] * SIZES[m.piece]; total += x; return x; });
      let r = Math.random() * total;
      for (let i = 0; i < moves.length; i++) { r -= w[i]; if (r <= 0) return moves[i]; }
      return moves[moves.length - 1];
    }
    const pool = moves.length > 500 ? moves.slice().sort(() => Math.random() - 0.5).slice(0, 500) : moves;
    const remaining = []; for (let p = 0; p < PIECES; p++) if (!pos.used[me][p]) remaining.push(p);
    const onlyMono = remaining.length === 1 && remaining[0] === 0;
    const centre = (SIZE - 1) / 2;
    let best = null;
    for (const m of pool) {
      const g = Uint8Array.from(pos.grid);
      for (const i of m.cells) g[i] = me;
      const mine = R.attachPoints(g, me).length;
      let s = SIZES[m.piece] * (level === "hard" ? 3 : 4);
      if (m.piece === 0 && !onlyMono && remaining.length > 1) s -= 12;            // keep the single square for last
      if (level === "hard") {
        s += mine * 0.9 - R.attachPoints(g, opp).length * 0.9;
        const avg = m.cells.reduce((a, i) => a + Math.abs(((i / SIZE) | 0) - centre) + Math.abs((i % SIZE) - centre), 0) / m.cells.length;
        s -= avg * (remaining.length > 14 ? 0.5 : 0.1);                            // open by taking the centre
      } else s += mine * 1.2;
      s += Math.random() * (level === "hard" ? 0.5 : 3);
      if (!best || s > best.s) best = { s, m };
    }
    return best.m;
  }

  // ---------- computer / same device: starting, undo ----------
  function resetPosition() {
    pos = R.parse(R.EMPTY); current = ONE; over = false; winner = 0; lastCells = []; snaps = []; note = ""; cursor = -1; hover = -1;
    lastPieceBy = { 1: -1, 2: -1 };
  }
  function newLocal() {
    cancelAI(); resetPosition();
    humanIs = sideSel.value === "2" ? TWO : ONE;
    next();
  }
  function undo() {
    if (isLinked() || !snaps.length || thinking) return;
    cancelAI(); over = false; winner = 0;
    do {
      const s = snaps.pop();
      pos = R.parse(s.board); current = s.current; lastCells = s.last;
    } while (snaps.length && mode === "ai" && current !== humanIs);
    note = ""; cursor = -1;
    selectBest(); showTurn(); renderAll();
  }

  // ---------- 2 players over WhatsApp, and live online ----------
  function validateBlokus(s) {
    if (!R.validBoard(s.board)) return false;
    const stones = s.board.slice(0, CELLS).replace(/0/g, "").length;
    if (!s.resigned && stones === 0) return false;
    return Number.isInteger(s.last) && s.last >= 0 && s.last < CELLS && (s.resigned || s.board[s.last] !== "0");
  }
  const finalText = (s) => {
    const p = R.parse(s.board);
    return "Final: " + NAMES[ONE] + " " + R.squaresLeft(p.used[ONE]) + " squares left · " + NAMES[TWO] + " " + R.squaresLeft(p.used[TWO]) + ".";
  };
  const shared = {
    game: "blokus-duo", version: 1, players: [ONE, TWO], label: (p) => NAMES[p],
    ui: document.getElementById("wa-ui"), statusEl: statusEl, validateBoard: validateBlokus, onState: loadLink, detail: finalText,
  };
  const link = AsyncShare.start(Object.assign({ title: "blokus duo" }, shared));
  const live = typeof LiveShare === "undefined" ? null : LiveShare.start(shared);
  const activeLink = () => (mode === "live" && live ? live : link);

  function loadLink(s, canMove) {
    cancelAI();
    pos = R.parse(s ? s.board : R.EMPTY);
    current = s ? s.turn : ONE;
    over = !!s && s.status !== "in_progress";
    winner = s && s.status === "won" ? s.winner : 0;
    lastCells = [];
    linkCanMove = canMove; snaps = []; note = "";
    if (s && s.last >= 0) lastCells = lastPlaced(s);
    selectBest();
    renderAll();
  }
  // The squares of the last piece placed, found by flood-filling from `last` over same-colour neighbours (a piece has at most 5 squares).
  function lastPlaced(s) {
    const v = pos.grid[s.last]; if (!v) return [];
    const seen = new Set([s.last]), q = [s.last];
    for (let h = 0; h < q.length && seen.size < 5; h++) {
      const i = q[h], r = (i / SIZE) | 0, c = i % SIZE;
      for (const [dr, dc] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
        const rr = r + dr, cc = c + dc;
        if (rr < 0 || rr >= SIZE || cc < 0 || cc >= SIZE) continue;
        const j = rr * SIZE + cc;
        if (pos.grid[j] === v && !seen.has(j) && seen.size < 5) { seen.add(j); q.push(j); }
      }
    }
    return Array.from(seen);
  }

  function playLink(move, p) {
    R.play(pos, p, move);
    const out = R.outcome(pos, p, move.piece);
    cursor = -1;
    activeLink().commit({
      board: boardStr(), status: out.status, winner: out.winner, last: move.cells[0], nextTurn: out.nextTurn,
    });
  }

  // ---------- modes and controls ----------
  function applyMode() {
    chipsEl.hidden = mode !== "ai"; sideSel.hidden = mode !== "ai";
    resetBtn.hidden = isLinked(); undoBtn.hidden = isLinked();
    if (mode === "whatsapp") { if (live) live.hide(); link.show(); }
    else if (mode === "live" && live) { link.hide(); live.show(); }
    else { link.hide(); if (live) live.hide(); newLocal(); }
  }
  const chips = Gamekit.wireDifficultyChips({
    el: chipsEl, difficulties: ["easy", "medium", "hard"], initial: diff, storage: store, storageKey: "diff",
    onChange: (d) => { diff = d; if (mode === "ai") newLocal(); },
  });
  diff = chips.get();
  modeSel.addEventListener("change", () => { mode = modeSel.value; if (mode !== "live") store.set("mode", mode); applyMode(); });
  sideSel.addEventListener("change", () => { store.set("side", sideSel.value); if (mode === "ai") newLocal(); });
  resetBtn.addEventListener("click", () => (isLinked() ? activeLink().newGame() : newLocal()));
  undoBtn.addEventListener("click", undo);

  buildBoard();
  if (live) LiveShare.enable(modeSel, "blokus-duo", invited);
  applyMode();

  // A refresh keeps a game against the computer or on one device.
  const resumer = Gamekit.resume("blokus-duo", () => (isLinked() || over || !snaps.length) ? null : {
    mode: mode, board: boardStr(), cur: current, human: humanIs, last: lastCells, snaps: snaps.map((s) => [s.board, s.current, s.last]),
  }, (s) => {
    if ((s.mode !== "ai" && s.mode !== "local") || !R.validBoard(s.board) || (s.cur !== 1 && s.cur !== 2)) return false;
    mode = s.mode; modeSel.value = mode; applyMode(); cancelAI();
    humanIs = s.human === TWO ? TWO : ONE; sideSel.value = humanIs === TWO ? "2" : "1";
    pos = R.parse(s.board); current = s.cur; over = false; winner = 0; note = ""; cursor = -1;
    lastCells = Array.isArray(s.last) ? s.last.filter((i) => Number.isInteger(i) && i >= 0 && i < CELLS) : [];
    snaps = (s.snaps || []).filter((x) => Array.isArray(x) && R.validBoard(x[0])).map((x) => ({ board: x[0], current: x[1], last: x[2] || [] }));
    next();
    return true;
  });
  if (!params.has("s") && !invited) resumer.restore();
  window.addEventListener("load", () => Manpage.autoOpen("blokus-duo"));
})();

if (window.Gamekit && Gamekit.popFilled) Gamekit.popFilled(document.getElementById("board"));   // new squares pop in
