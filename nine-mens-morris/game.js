(function () {
  "use strict";

  const R = globalThis.NineMensMorrisRules;
  const RED = 1, BLUE = 2;
  const NAMES = { [RED]: "Red", [BLUE]: "Blue" };
  const other = R.other;

  const boardEl = document.getElementById("board");
  const statusEl = document.getElementById("status");
  const hintEl = document.getElementById("hint");
  const undoBtn = document.getElementById("undo-btn");
  const resetBtn = document.getElementById("reset-btn");
  const chipsEl = document.getElementById("chips");
  const modeSel = document.getElementById("mode");
  const sideSel = document.getElementById("side");
  const store = Gamekit.storage("nine-mens-morris:");

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
  let S = R.parse(R.create());        // { b, phase, turn, placed, lost } (see rules.js)
  let over = false, winner = 0;
  let history = [];                   // [{ s: wire string, last, lastFrom }] for undo
  let humanIs = RED;
  let viewer = RED;                   // whose side is being looked at
  let sel = null;                     // the point whose piece is picked up
  let last = null;                    // wire-style highlight: 0..23 a point, 24+at a removal
  let lastFrom = null;
  let thinking = false, aiTimer = null;
  let linkCanMove = false;

  const el = (tag, cls) => { const e = document.createElement(tag); if (cls) e.className = cls; return e; };
  const canAct = () => !over && !thinking && (isLinked() ? linkCanMove : mode === "ai" ? S.turn === humanIs : true);
  const lastAt = () => (last === null ? null : last >= R.CELLS ? last - R.CELLS : last);

  // ---------- drawing ----------
  function lineSvg() {
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("class", "nmm-lines");
    svg.setAttribute("viewBox", "0 0 7 7");
    svg.setAttribute("aria-hidden", "true");
    const lines = [];
    for (const [a, z] of [[0.5, 6.5], [1.5, 5.5], [2.5, 4.5]]) {
      lines.push([a, a, z, a], [z, a, z, z], [a, z, z, z], [a, a, a, z]);
    }
    lines.push([3.5, 0.5, 3.5, 2.5], [6.5, 3.5, 4.5, 3.5], [3.5, 4.5, 3.5, 6.5], [0.5, 3.5, 2.5, 3.5]);
    for (const [x1, y1, x2, y2] of lines) {
      const l = document.createElementNS(NS, "line");
      l.setAttribute("x1", String(x1)); l.setAttribute("y1", String(y1));
      l.setAttribute("x2", String(x2)); l.setAttribute("y2", String(y2));
      svg.append(l);
    }
    return svg;
  }

  function destinations() {
    if (!S || sel === null || S.phase !== "move" || !canAct()) return new Set();
    const out = new Set();
    for (const m of R.gen(S, S.turn)) if (m.kind === "move" && m.from === sel) out.add(m.to);
    return out;
  }

  function render() {
    if (!S) return;
    const act = canAct();
    const dests = destinations();
    const take = act && S.phase === "remove" ? new Set(R.removable(S)) : new Set();
    const milled = new Set(R.millPoints(S.b));
    const mark = lastAt();
    boardEl.innerHTML = "";
    boardEl.append(lineSvg());
    boardEl.classList.toggle("placing", S.phase === "place");
    boardEl.classList.toggle("removing", S.phase === "remove");
    for (let i = 0; i < R.CELLS; i++) {
      const r = R.POINTS[i][0], c = R.POINTS[i][1];
      const v = S.b[i];
      const b = el("button", "nmm-pt");
      b.type = "button";
      b.style.gridRow = String(r + 1);
      b.style.gridColumn = String(c + 1);
      if (v) b.classList.add("p" + v);
      if (v && milled.has(i)) b.classList.add("mill");
      if (act && S.phase === "move" && v === S.turn) b.classList.add("mine");
      if (act && S.phase === "place" && !v) b.classList.add("place");
      if (act && dests.has(i)) b.classList.add("dest");
      if (take.has(i)) b.classList.add("take");
      if (sel === i) b.classList.add("sel");
      if (mark === i) b.classList.add("last");
      if (lastFrom === i) b.classList.add("from");
      if (v) b.append(el("span", "nmm-pc p" + v));
      b.disabled = !act;
      const what = v ? NAMES[v] + " piece" : "empty point";
      b.setAttribute("aria-label", "row " + (r + 1) + ", column " + (c + 1) + ", " + what +
        (v && milled.has(i) ? ", in a mill" : "") +
        (take.has(i) ? ", can be removed" : "") +
        (dests.has(i) ? ", move here" : ""));
      b.addEventListener("click", () => onPoint(i));
      boardEl.append(b);
    }
    undoBtn.disabled = isLinked() || history.length === 0 || thinking;
    setHint(act);
  }

  function setHint(act) {
    if (!act) { hintEl.textContent = ""; return; }
    if (S.phase === "remove") {
      hintEl.textContent = "Tap a ringed " + NAMES[other(S.turn)] + " piece to remove it.";
      return;
    }
    if (S.phase === "place") {
      hintEl.textContent = "Tap an empty point to place a piece.";
      return;
    }
    if (sel !== null && destinations().size) {
      hintEl.textContent = R.countOf(S.b, S.turn) === 3 ? "Flying: tap any empty point." : "Tap a marked point to move there.";
      return;
    }
    hintEl.textContent = "Tap one of your pieces, then a marked point.";
  }

  // ---------- acting ----------
  function onPoint(i) {
    if (!S || !canAct()) return;
    if (S.phase === "remove") {
      if (R.removable(S).indexOf(i) !== -1) return doAction({ kind: "remove", at: i });
      if (S.b[i] === other(S.turn)) hintEl.textContent = "That piece is in a mill — take one outside a mill.";
      return;
    }
    if (S.phase === "place") {
      if (S.b[i] === 0) doAction({ kind: "place", to: i });
      return;
    }
    if (S.b[i] === S.turn) {
      sel = sel === i ? null : i;
      render();
      return;
    }
    if (sel !== null && destinations().has(i)) return doAction({ kind: "move", from: sel, to: i });
    if (sel !== null) { sel = null; render(); }
  }

  function setLast(mv) {
    lastFrom = mv.kind === "move" ? mv.from : null;
    if (mv.kind === "remove") { last = R.CELLS + mv.at; lastFrom = null; }
    else if (mv.remove !== undefined) { last = R.CELLS + mv.remove; lastFrom = null; }
    else last = mv.to;
  }

  function doAction(mv) {
    sel = null;
    if (isLinked()) return playLink(mv);
    // A removal belongs to the turn that made the mill, so one undo takes both.
    if (mv.kind !== "remove") history.push({ s: R.str(S), last: last, lastFrom: lastFrom });
    const T = R.play(S, S.turn, mv);
    if (!T) { render(); return; }
    S = T;
    setLast(mv);
    const w = R.winner(S);
    if (w) { over = true; winner = w; return finish(); }
    afterAction();
  }

  function afterAction() {
    if (!S || over) { render(); return; }
    if (mode === "ai" && S.turn !== humanIs) {
      thinking = true;
      Gamekit.turn(S.turn, "Bot thinking…", true);
      statusEl.textContent = "Bot thinking…";
      render();
      aiTimer = setTimeout(aiMove, 900);
      return;
    }
    showTurn();
    render();
  }

  function aiMove() {
    aiTimer = null; thinking = false;
    if (!S || over) return;
    const p = S.turn;
    const mv = R.bestMove(R.str(S), p, diff, Math.random);
    if (!mv) {
      over = true;
      winner = R.winner(S) || other(p);
      return finish();
    }
    history.push({ s: R.str(S), last: last, lastFrom: lastFrom });
    let T = R.playTurn(S, p, mv);
    if (!T) {
      // Should not happen, but never leave the game stuck on a bad computer move.
      const list = R.gen(S, p);
      if (!list.length) { over = true; winner = R.winner(S) || other(p); return finish(); }
      const a = list[Math.floor(Math.random() * list.length)];
      T = R.play(S, p, a);
      setLast(a);
    } else setLast(mv);
    S = T;
    const w = R.winner(S);
    if (w) { over = true; winner = w; return finish(); }
    afterAction();
  }
  function cancelAI() { if (aiTimer !== null) { clearTimeout(aiTimer); aiTimer = null; } thinking = false; }

  function showTurn() {
    if (!S || over) return;
    const p = S.turn;
    if (mode === "ai" && p !== humanIs) {
      Gamekit.turn(p, "Bot thinking…", true);
      statusEl.textContent = "Bot thinking…";
      return;
    }
    const left = 9 - S.placed[p - 1];
    let pill, status;
    if (S.phase === "place") {
      if (mode === "ai") { pill = "Your move · " + left + " left"; status = "Your move."; }
      else { pill = NAMES[p] + " to place · " + left + " left"; status = NAMES[p] + " to place."; }
    } else if (S.phase === "remove") {
      if (mode === "ai") { pill = "Your move · remove a piece"; status = "Remove a piece."; }
      else { pill = NAMES[p] + " · remove a piece"; status = "Remove a piece."; }
    } else if (mode === "ai") {
      pill = "Your move · you're " + NAMES[humanIs];
      status = "Your move.";
    } else {
      pill = NAMES[p] + "'s move";
      status = NAMES[p] + "'s move.";
    }
    Gamekit.turn(p, pill);
    statusEl.textContent = status;
  }

  function finish() {
    cancelAI();
    sel = null;
    Gamekit.turn(null);
    if (!winner) statusEl.textContent = "Draw. Nobody can move. " + Gamekit.taunt("draw");
    else if (mode === "ai") statusEl.textContent = winner === humanIs ? "You win! " + Gamekit.taunt("win") : "Bot wins. " + Gamekit.taunt("loss");
    else statusEl.textContent = NAMES[winner] + " wins. " + NAMES[other(winner)] + " — " + Gamekit.taunt("loss");
    render();
  }

  function newLocal() {
    cancelAI();
    S = R.parse(R.create());
    history = []; over = false; winner = 0; last = null; lastFrom = null; sel = null;
    humanIs = sideSel.value === "2" ? BLUE : RED;
    viewer = mode === "ai" ? humanIs : RED;
    if (mode === "ai" && S.turn !== humanIs) return afterAction();
    showTurn();
    render();
  }

  // Takes back moves until it is the human's turn again.
  function undo() {
    if (isLinked() || !history.length) return;
    cancelAI();
    over = false; winner = 0; sel = null;
    do {
      const h = history.pop();
      S = R.parse(h.s);
      last = h.last === undefined ? null : h.last;
      lastFrom = h.lastFrom === undefined ? null : h.lastFrom;
    } while (history.length && mode === "ai" && S.turn !== humanIs);
    if (!S) { newLocal(); return; }
    if (mode === "ai" && S.turn !== humanIs) return afterAction();
    showTurn();
    render();
  }

  // ---------- 2 players over WhatsApp, and live online ----------
  // board: the 30-character string described in rules.js. Red opens.
  function validateNineMensMorris(s) {
    const S = R.parse(s.board);
    if (!S || !(Number.isInteger(s.last) && s.last >= 0 && s.last < R.CELLS * 2)) return false;
    // a hand-edited link must still be a position two players could have reached: the side to move is the one in the board,
    // and the game is over exactly when the rules say so
    if (s.resigned) return true;
    const w = R.winner(S);
    return s.turn === S.turn && s.status === (w ? "won" : "in_progress") && s.winner === (w || null);
  }
  const shared = {
    game: "nine-mens-morris", version: 1, players: [RED, BLUE],
    label: (p) => NAMES[p],
    ui: document.getElementById("wa-ui"), statusEl: statusEl,
    validateBoard: validateNineMensMorris, onState: loadLink,
  };
  const link = AsyncShare.start(Object.assign({ title: "nine men's morris" }, shared));
  const live = typeof LiveShare === "undefined" ? null : LiveShare.start(shared);
  const activeLink = () => (mode === "live" && live ? live : link);

  function loadLink(s, canMove, info) {
    cancelAI();
    viewer = info && info.me ? info.me : RED;
    if (s) {
      const P = R.parse(s.board);
      S = P || R.parse(R.create());
      const boardWinner = P ? R.winner(P) : 0;
      over = s.status !== "in_progress" || !!boardWinner;
      winner = over ? (s.winner || boardWinner || 0) : 0;
      last = Number.isInteger(s.last) ? s.last : null;
    } else {
      S = R.parse(R.create());
      over = false; winner = 0; last = null;
    }
    lastFrom = null;
    sel = null;
    linkCanMove = !!canMove;
    render();
  }
  function playLink(mv) {
    if (!S) return;
    const p = S.turn;
    const T = R.play(S, p, mv);
    if (!T) return;
    const w = R.winner(T);
    activeLink().commit({
      board: R.str(T),
      status: w ? "won" : "in_progress",
      winner: w || null,
      last: R.lastOf(mv),
      nextTurn: T.turn,
    });
  }

  // ---------- modes and controls ----------
  function applyMode() {
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

  const liveOpt = modeSel.querySelector('option[value="live"]');
  if (live && invited) liveOpt.hidden = false;
  else if (live) LiveShare.enable(modeSel, "nine-mens-morris");
  applyMode();

  // A refresh keeps a game against the computer or on one device.
  const resumer = Gamekit.resume("nine-mens-morris", () => (isLinked() || over || !history.length) ? null : {
    mode: mode, s: R.str(S), human: humanIs, h: history, last: last, lastFrom: lastFrom,
  }, (s) => {
    if (s.mode !== "ai" && s.mode !== "local") return false;
    const P = R.parse(s.s);
    if (!P || R.winner(P) || (s.human !== RED && s.human !== BLUE)) return false;
    const lastOk = (x) => x === null || x === undefined || (Number.isInteger(x) && x >= 0 && x < R.CELLS * 2);
    if (!Array.isArray(s.h) || !s.h.every((x) => x && R.parse(x.s) && lastOk(x.last) && lastOk(x.lastFrom))) return false;
    if (!lastOk(s.last) || !lastOk(s.lastFrom)) return false;
    mode = s.mode; modeSel.value = mode;
    humanIs = s.human === BLUE ? BLUE : RED;
    sideSel.value = humanIs === BLUE ? "2" : "1";
    applyMode();
    cancelAI();
    S = P;
    history = s.h.map((x) => ({ s: x.s, last: x.last === undefined ? null : x.last, lastFrom: x.lastFrom === undefined ? null : x.lastFrom }));
    over = false; winner = 0; sel = null;
    last = s.last === undefined ? null : s.last;
    lastFrom = s.lastFrom === undefined ? null : s.lastFrom;
    viewer = mode === "ai" ? humanIs : RED;
    if (mode === "ai" && S.turn !== humanIs) afterAction(); else { showTurn(); render(); }
    return true;
  });
  if (!params.has("s") && !invited) resumer.restore();
  window.addEventListener("load", () => Manpage.autoOpen("nine-mens-morris"));
})();

if (window.Gamekit && Gamekit.popFilled) Gamekit.popFilled(document.getElementById("board"));          // new pieces pop in
if (window.Gamekit && Gamekit.glidePieces) Gamekit.glidePieces(document.getElementById("board"), ".nmm-pc");   // moved pieces glide
