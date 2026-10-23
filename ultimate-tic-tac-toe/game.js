(function () {
  "use strict";

  const X = 1, O = 2;
  const NAMES = { [X]: "X", [O]: "O" };
  const MARK = { 1: "X", 2: "O", 3: "" };
  const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
  const other = (p) => (p === X ? O : X);

  const boardEl = document.getElementById("board");
  const statusEl = document.getElementById("status");
  const chipsEl = document.getElementById("chips");
  const modeSel = document.getElementById("mode");
  const sideSel = document.getElementById("side");
  const resetBtn = document.getElementById("reset-btn");
  const store = Gamekit.storage("ultimate-tic-tac-toe:");

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

  // ---------- the position ----------
  // cells[b*9 + c]: 0 empty / 1 X / 2 O. st[b]: 0 open, 1 X won, 2 O won, 3 full.
  // forced: the small board the next player must play in, or 9 for any open one.
  let cells = new Uint8Array(81), st = new Uint8Array(9), forced = 9;
  let current = X, over = false, winner = 0, last = null;
  let humanIs = X, thinking = false, aiTimer = null;
  let linkCanMove = false;
  let history = [];            // [{i, p}] for undo (computer / same device)

  function lineWin(get) {
    for (const [a, b, c] of LINES) { const v = get(a); if ((v === 1 || v === 2) && v === get(b) && v === get(c)) return v; }
    return 0;
  }
  // Plays idx for p on the given arrays; returns what it changed so a search can take it back.
  function apply(cs, ss, idx, p) {
    const b = (idx / 9) | 0, c = idx % 9;
    const old = ss[b];
    cs[idx] = p;
    const w = lineWin((i) => cs[b * 9 + i]);
    if (w) ss[b] = w;
    else { let full = true; for (let i = 0; i < 9; i++) if (!cs[b * 9 + i]) { full = false; break; } if (full) ss[b] = 3; }
    return { idx, b, old, nextForced: ss[c] === 0 ? c : 9 };
  }
  function undoApply(cs, ss, u) { cs[u.idx] = 0; ss[u.b] = u.old; }
  const bigWinner = (ss) => lineWin((i) => ss[i]);
  const anyOpen = (ss) => { for (let i = 0; i < 9; i++) if (ss[i] === 0) return true; return false; };

  function legalMoves(cs, ss, f) {
    const out = [];
    const boards = f < 9 ? [f] : [0, 1, 2, 3, 4, 5, 6, 7, 8];
    for (const b of boards) { if (ss[b] !== 0) continue; for (let c = 0; c < 9; c++) if (!cs[b * 9 + c]) out.push(b * 9 + c); }
    return out;
  }
  const isLegal = (idx) => !over && idx >= 0 && idx < 81 && !cells[idx] && st[(idx / 9) | 0] === 0 && (forced === 9 || forced === ((idx / 9) | 0));

  // ---------- drawing ----------
  const smallEls = [], cellEls = [];
  function buildBoard() {
    boardEl.innerHTML = "";
    for (let b = 0; b < 9; b++) {
      const s = document.createElement("div");
      s.className = "ut-small";
      for (let c = 0; c < 9; c++) {
        const i = b * 9 + c;
        const el = document.createElement("button");
        el.type = "button";
        el.className = "ut-cell";
        el.setAttribute("aria-label", "board " + (b + 1) + ", cell " + (c + 1));
        el.addEventListener("click", () => onCell(i));
        s.appendChild(el);
        cellEls.push(el);
      }
      const mark = document.createElement("span");
      mark.className = "ut-mark";
      s.appendChild(mark);
      boardEl.appendChild(s);
      smallEls.push(s);
    }
  }

  function render() {
    const canClick = !over && !thinking && (isLinked() ? linkCanMove : mode === "ai" ? current === humanIs : true);
    for (let b = 0; b < 9; b++) {
      const s = smallEls[b];
      const play = canClick && st[b] === 0 && (forced === 9 || forced === b);
      s.classList.toggle("playable", play);
      s.classList.toggle("target", !over && st[b] === 0 && (forced === 9 || forced === b));
      s.classList.toggle("x", st[b] === 1);
      s.classList.toggle("o", st[b] === 2);
      s.classList.toggle("tie", st[b] === 3);
      s.lastChild.textContent = MARK[st[b]] || "";
    }
    for (let i = 0; i < 81; i++) {
      const el = cellEls[i], v = cells[i];
      el.textContent = v ? NAMES[v] : "";
      el.classList.toggle("x", v === 1);
      el.classList.toggle("o", v === 2);
      el.classList.toggle("last", last === i);
      el.disabled = !canClick || !isLegal(i);
    }
    boardEl.classList.toggle("over", over);
  }

  // ---------- the computer ----------
  // Iterative deepening alpha-beta with a node budget, so a hard move still
  // answers quickly. The evaluation scores small boards won, the big-board
  // lines they make, and a little for the lines inside open small boards.
  function evaluate(cs, ss, me) {
    const you = other(me);
    let s = 0;
    for (let b = 0; b < 9; b++) {
      const w = b === 4 ? 1.4 : (b % 2 === 0 ? 1.15 : 1);
      if (ss[b] === me) s += 30 * w; else if (ss[b] === you) s -= 30 * w;
      else if (ss[b] === 0) {
        for (const [a, c, d] of LINES) {
          let m = 0, o = 0;
          for (const k of [a, c, d]) { const v = cs[b * 9 + k]; if (v === me) m++; else if (v === you) o++; }
          if (o === 0 && m) s += m === 2 ? 3 : 1;
          if (m === 0 && o) s -= o === 2 ? 3 : 1;
        }
        if (cs[b * 9 + 4] === me) s += 1; else if (cs[b * 9 + 4] === you) s -= 1;
      }
    }
    for (const [a, c, d] of LINES) {
      let m = 0, o = 0;
      for (const k of [a, c, d]) { if (ss[k] === me) m++; else if (ss[k] === you) o++; }
      if (o === 0) s += [0, 8, 40, 0][m]; if (m === 0) s -= [0, 8, 40, 0][o];
    }
    return s;
  }

  function aiPick(level) {
    const cs = Uint8Array.from(cells), ss = Uint8Array.from(st);
    const me = current;
    const root = legalMoves(cs, ss, forced);
    if (!root.length) return -1;
    if (level === "easy") {
      // grab a board win if there is one, otherwise play a loosely sensible random move
      const wins = root.filter((i) => { const u = apply(cs, ss, i, me); const won = ss[u.b] === me; undoApply(cs, ss, u); return won; });
      if (wins.length && Math.random() < 0.8) return wins[Math.floor(Math.random() * wins.length)];
      return root[Math.floor(Math.random() * root.length)];
    }
    const budget = level === "hard" ? 60000 : 6000;
    const maxDepth = level === "hard" ? 7 : 4;
    let nodes = 0, aborted = false;
    function search(f, p, depth, alpha, beta) {
      nodes++;
      const bw = bigWinner(ss);
      if (bw) return bw === me ? 100000 + depth : -100000 - depth;
      if (!anyOpen(ss)) return 0;
      if (depth === 0) return evaluate(cs, ss, me);
      if (nodes > budget) { aborted = true; return evaluate(cs, ss, me); }
      const mv = legalMoves(cs, ss, f);
      if (!mv.length) return 0;
      // centre cells first: cheap move ordering
      mv.sort((a, b) => Math.abs((a % 9) - 4) - Math.abs((b % 9) - 4));
      let best = p === me ? -Infinity : Infinity;
      for (const i of mv) {
        const u = apply(cs, ss, i, p);
        const v = search(u.nextForced, other(p), depth - 1, alpha, beta);
        undoApply(cs, ss, u);
        if (p === me) { if (v > best) best = v; if (best > alpha) alpha = best; }
        else { if (v < best) best = v; if (best < beta) beta = best; }
        if (alpha >= beta || aborted) break;
      }
      return best;
    }
    let bestMove = root[Math.floor(Math.random() * root.length)];
    for (let d = 1; d <= maxDepth; d++) {
      aborted = false; nodes = 0;
      let bestV = -Infinity, pick = null;
      const ordered = root.slice().sort((a, b) => Math.abs((a % 9) - 4) - Math.abs((b % 9) - 4));
      for (const i of ordered) {
        const u = apply(cs, ss, i, me);
        const v = search(u.nextForced, other(me), d - 1, -Infinity, Infinity) + (level === "medium" ? Math.random() * 2 : Math.random() * 0.3);
        undoApply(cs, ss, u);
        if (aborted) break;
        if (v > bestV) { bestV = v; pick = i; }
      }
      if (aborted || pick === null) break;
      bestMove = pick;
      if (bestV > 90000) break;               // a forced win: stop looking
    }
    return bestMove;
  }

  function cancelAI() { if (aiTimer !== null) { clearTimeout(aiTimer); aiTimer = null; } thinking = false; }

  // ---------- playing (computer and same-device modes) ----------
  function place(i, p) {
    const u = apply(cells, st, i, p);
    history.push({ i, p, forced });
    last = i;
    forced = u.nextForced;
    const bw = bigWinner(st);
    if (bw) { over = true; winner = bw; return; }
    if (!anyOpen(st)) { over = true; winner = 0; return; }
    current = other(p);
  }

  function onCell(i) {
    if (isLinked()) return linkCanMove && isLegal(i) ? playLink(i) : undefined;
    if (!isLegal(i) || thinking || (mode === "ai" && current !== humanIs)) return;
    place(i, current);
    afterMove();
  }

  function afterMove() {
    if (over) return finish();
    if (mode === "ai" && current !== humanIs) {
      thinking = true;
      Gamekit.turn(current, "Bot thinking…", true);
      statusEl.textContent = "Bot thinking…";
      render();
      aiTimer = setTimeout(() => { aiTimer = null; thinking = false; if (over) return; place(aiPick(diff), current); afterMove(); }, 350);
      return;
    }
    showTurn(); render();
  }

  function where() {
    if (over) return "";
    return forced === 9 ? " Play in any open board." : " Play in board " + (forced + 1) + " (highlighted).";
  }
  function showTurn() {
    if (mode === "ai") { Gamekit.turn(humanIs, "Your move · you're " + NAMES[humanIs]); statusEl.textContent = "Your move." + where(); }
    else { Gamekit.turn(current, NAMES[current] + "'s move"); statusEl.textContent = NAMES[current] + "'s move." + where(); }
  }

  function finish() {
    cancelAI();
    Gamekit.turn(null);
    if (!winner) statusEl.textContent = "Draw. " + Gamekit.taunt("draw");
    else if (mode === "ai") statusEl.textContent = winner === humanIs ? "You win! " + Gamekit.taunt("win") : "Bot wins. " + Gamekit.taunt("loss");
    else statusEl.textContent = `${NAMES[winner]} wins. ${NAMES[other(winner)]} — ${Gamekit.taunt("loss")}`;
    render();
  }

  function newLocal() {
    cancelAI();
    cells = new Uint8Array(81); st = new Uint8Array(9); forced = 9;
    current = X; over = false; winner = 0; last = null; history = [];
    humanIs = sideSel.value === "2" ? O : X;
    if (mode === "ai" && humanIs === O) return afterMove();
    showTurn(); render();
  }

  // Takes moves back until it is the human's turn again.
  function undo() {
    if (isLinked() || !history.length || thinking) return;
    cancelAI();
    over = false; winner = 0;
    do {
      const m = history.pop();
      cells[m.i] = 0;
      current = m.p; forced = m.forced;
    } while (history.length && mode === "ai" && current !== humanIs);
    // recompute the small-board results from the cells
    for (let b = 0; b < 9; b++) {
      const w = lineWin((k) => cells[b * 9 + k]);
      let full = true; for (let k = 0; k < 9; k++) if (!cells[b * 9 + k]) full = false;
      st[b] = w || (full ? 3 : 0);
    }
    last = history.length ? history[history.length - 1].i : null;
    showTurn(); render();
  }

  // ---------- 2 players over WhatsApp, and live online ----------
  // board: 91 chars: 81 cells, 9 small-board results, then the forced board (9 = any).
  const gridToStr = () => Array.from(cells).join("") + Array.from(st).join("") + forced;
  function validateUt(s) {
    const b = s.board;
    if (typeof b !== "string" || !/^[012]{81}[0-3]{9}[0-9]$/.test(b)) return false;
    const stones = b.slice(0, 81).replace(/0/g, "").length;
    if (stones !== s.moveCount && !(s.resigned && stones === s.moveCount - 1)) return false;
    if (!(Number.isInteger(s.last) && s.last >= 0 && s.last < 81 && b[s.last] !== "0")) return false;
    // a hand-edited link must still be a position two players could have reached: X opens and the marks alternate, each small
    // board's result is the one its nine cells show, the last mark belongs to the side that just moved, the next forced board
    // follows from where it went, and the game result is the one the small boards show
    const g = Uint8Array.from(b.slice(0, 81), Number), x = g.filter(v => v === X).length, o = stones - x;
    if (x !== o && x !== o + 1) return false;
    const res = Array.from({ length: 9 }, (_, k) => {
      const w = lineWin(i => g[k * 9 + i]);
      return w || (g.slice(k * 9, k * 9 + 9).every(v => v) ? 3 : 0);
    });
    if (res.join("") !== b.slice(81, 90)) return false;
    if (s.resigned) return true;
    const mover = g[s.last];
    if (mover !== (x > o ? X : O) || s.turn === mover) return false;
    if (Number(b[90]) !== (res[s.last % 9] === 0 ? s.last % 9 : 9)) return false;
    const bw = bigWinner(res);
    return s.status === (bw ? "won" : anyOpen(res) ? "in_progress" : "draw") && s.winner === (bw || null);
  }
  const shared = {
    game: "ultimate-tic-tac-toe", version: 1, players: [X, O],
    label: (p) => NAMES[p],
    ui: document.getElementById("wa-ui"), statusEl: statusEl,
    validateBoard: validateUt, onState: loadLink,
  };
  const link = AsyncShare.start(Object.assign({ title: "ultimate tic-tac-toe" }, shared));
  const live = typeof LiveShare === "undefined" ? null : LiveShare.start(shared);
  const activeLink = () => (mode === "live" && live ? live : link);

  function loadLink(s, canMove) {
    cancelAI();
    if (s) {
      const b = s.board;
      cells = Uint8Array.from(b.slice(0, 81), Number);
      st = Uint8Array.from(b.slice(81, 90), Number);
      forced = Number(b[90]);
      current = s.turn; last = s.last;
      over = s.status !== "in_progress";
      winner = s.status === "won" ? s.winner : 0;
    } else {
      cells = new Uint8Array(81); st = new Uint8Array(9); forced = 9; current = X; last = null; over = false; winner = 0;
    }
    history = [];
    linkCanMove = canMove;
    render();
  }

  function playLink(i) {
    const p = current;
    const u = apply(cells, st, i, p);
    const bw = bigWinner(st);
    const status = bw ? "won" : anyOpen(st) ? "in_progress" : "draw";
    forced = u.nextForced;
    activeLink().commit({ board: gridToStr(), status, winner: bw || null, last: i });
  }

  // ---------- modes and controls ----------
  function applyMode() {
    chipsEl.hidden = mode !== "ai";
    sideSel.hidden = mode !== "ai";
    resetBtn.hidden = isLinked();
    document.getElementById("undo-btn").hidden = isLinked();
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
  document.getElementById("undo-btn").addEventListener("click", undo);

  buildBoard();
  const liveOpt = modeSel.querySelector('option[value="live"]');
  if (live) LiveShare.enable(modeSel, "ultimate-tic-tac-toe", invited);
  applyMode();

  // A refresh keeps a game against the computer or on one device.
  const resumer = Gamekit.resume("ultimate-tic-tac-toe", () => (isLinked() || over || !history.length) ? null : {
    mode: mode, h: history.map((m) => [m.i, m.p]), human: humanIs,
  }, (s) => {
    if (s.mode !== "ai" && s.mode !== "local") return false;
    if (!Array.isArray(s.h)) return false;
    mode = s.mode; modeSel.value = mode; applyMode(); cancelAI();
    humanIs = s.human === O ? O : X; sideSel.value = humanIs === O ? "2" : "1";
    cells = new Uint8Array(81); st = new Uint8Array(9); forced = 9; current = X; over = false; winner = 0; last = null; history = [];
    for (const [i, p] of s.h) {
      if (!Number.isInteger(i) || (p !== 1 && p !== 2) || p !== current || !isLegal(i)) { newLocal(); return false; }
      place(i, p);
      if (over) { newLocal(); return false; }
    }
    if (mode === "ai" && current !== humanIs) afterMove(); else { showTurn(); render(); }
    return true;
  });
  if (!params.has("s") && !invited) resumer.restore();
  window.addEventListener("load", () => Manpage.autoOpen("ultimate-tic-tac-toe"));
})();

if (window.Gamekit && Gamekit.popFilled) Gamekit.popFilled(document.getElementById("board"));   // new squares pop in
