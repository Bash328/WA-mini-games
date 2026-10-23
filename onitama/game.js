(function () {
  "use strict";

  const R = globalThis.OnitamaRules;
  const RED = 1, BLUE = 2;
  const NAMES = { [RED]: "Red", [BLUE]: "Blue" };
  const other = R.other;
  const COLOR = { [RED]: "#ff6b6b", [BLUE]: "#5c9cff" };

  const boardEl = document.getElementById("board");
  const statusEl = document.getElementById("status");
  const hintEl = document.getElementById("hint");
  const topEl = document.getElementById("hand-top");
  const botEl = document.getElementById("hand-bot");
  const undoBtn = document.getElementById("undo-btn");
  const resetBtn = document.getElementById("reset-btn");
  const chipsEl = document.getElementById("chips");
  const modeSel = document.getElementById("mode");
  const sideSel = document.getElementById("side");
  const store = Gamekit.storage("onitama:");

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
  let S = null;                       // { b, h, s } (see rules.js)
  let cur = RED;
  let over = false, winner = 0;
  let history = [];                   // [{ s: wire string, cur }] for undo
  let humanIs = RED;
  let viewer = RED;                   // whose side is at the bottom of the screen
  let sel = { card: null, from: null, to: null };
  let lastTo = null, lastFrom = null;
  let thinking = false, aiTimer = null;
  let linkCanMove = false, dealt = null;

  const el = (tag, cls) => { const e = document.createElement(tag); if (cls) e.className = cls; return e; };
  const vIdx = (d) => (viewer === BLUE ? 24 - d : d);          // screen square <-> board square

  // may the person looking act right now?
  const canAct = () => !over && !thinking && (isLinked() ? linkCanMove : mode === "ai" ? cur === humanIs : true);
  const hasNoMoves = () => !!S && R.gen(S, cur).length === 0;
  const CROWN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 19h18l1-12-5 4-5-7-5 7-5-4z"/></svg>';

  // ---------- drawing ----------
  function cardEl(id, p) {
    const dir = p === viewer ? 1 : -1;                          // 1: forward is up the screen
    const b = el("button", "on-card");
    b.type = "button";
    b.style.setProperty("--pc", COLOR[p]);
    const nm = el("span", "nm"); nm.textContent = R.CARDS[id].name;
    const grid = el("div", "on-mini");
    const marks = new Set(R.CARDS[id].m.map(([dx, dy]) => (2 - dy * dir) * 5 + 2 + dx * dir));
    for (let k = 0; k < 25; k++) { const i = el("i"); if (k === 12) i.className = "c"; else if (marks.has(k)) i.className = "m"; grid.append(i); }
    b.append(nm, grid);
    b.setAttribute("aria-label", R.CARDS[id].name + " card");
    return b;
  }

  function destinations() {
    if (!S || sel.from === null) return new Set();
    const cards = sel.card !== null ? [sel.card] : S.h[cur - 1];
    const out = new Set();
    for (const c of cards) for (const t of R.reach(sel.from, c, cur)) if (R.ownerOf(S.b[t]) !== cur) out.add(t);
    return out;
  }
  const candidateCards = () => (sel.from === null || sel.to === null ? [] : S.h[cur - 1].filter((c) => R.reach(sel.from, c, cur).includes(sel.to)));

  function render() {
    if (!S) return;
    const act = canAct();
    const dests = destinations();
    const cands = sel.to !== null ? candidateCards() : [];
    boardEl.innerHTML = "";
    for (let d = 0; d < 25; d++) {
      const i = vIdx(d), c = S.b[i], owner = R.ownerOf(c);
      const b = el("button", "on-cell");
      b.type = "button";
      if (i === 22) b.classList.add("temple1"); else if (i === 2) b.classList.add("temple2");
      if (owner) { const pc = el("span", "on-pc p" + owner + (c === 2 || c === 4 ? " master" : "")); if (c === 2 || c === 4) pc.innerHTML = CROWN; b.append(pc); }
      if (act && owner === cur) b.classList.add("mine");
      if (act && dests.has(i)) { b.classList.add("dest"); if (owner) b.classList.add("cap"); }
      if (sel.from === i) b.classList.add("sel");
      if (lastTo === i) b.classList.add("last");
      if (lastFrom === i) b.classList.add("from");
      b.disabled = !act;
      b.setAttribute("aria-label", "row " + (Math.floor(i / 5) + 1) + ", column " + ((i % 5) + 1) + (owner ? ", " + NAMES[owner] + (c === 2 || c === 4 ? " master" : " pawn") : ""));
      b.addEventListener("click", () => onCell(i));
      boardEl.append(b);
    }
    // hands: the viewer's at the bottom, the other side's on top (the side card sits beside the top hand)
    const mk = (box, p, withSide) => {
      box.innerHTML = "";
      S.h[p - 1].forEach((id) => {
        const b = cardEl(id, p);
        const mine = act && p === cur;
        if (mine) b.classList.add("mine");
        if (sel.card === id) b.classList.add("sel");
        if (cands.includes(id) && cands.length > 1 && sel.card === null) b.classList.add("cand");
        b.disabled = !mine;
        b.addEventListener("click", () => onCard(id));
        box.append(b);
      });
      if (withSide) {
        const side = el("div", "on-sidebox");
        side.append(document.createTextNode("next"));
        const sc = cardEl(S.s, cur);
        sc.classList.add("side"); sc.disabled = true;
        side.append(sc);
        box.append(side);
      }
    };
    mk(topEl, other(viewer), true);
    mk(botEl, viewer, false);
    undoBtn.disabled = isLinked() || history.length === 0 || thinking;
    hintEl.textContent = !act ? "" : hasNoMoves() ? "No legal move: tap a card to pass it." : sel.to !== null && cands.length > 1 ? "Which card? Tap the one to spend." : sel.from === null ? "Tap a piece to move it." : "Tap a marked square.";
  }

  // ---------- selecting ----------
  function onCell(i) {
    if (!S || !canAct()) return;
    const c = S.b[i];
    if (R.ownerOf(c) === cur) { sel = { card: sel.card, from: sel.from === i ? null : i, to: null }; return render(); }
    if (sel.from !== null && destinations().has(i)) return choose(i);
    sel = { card: sel.card, from: null, to: null };
    render();
  }
  function choose(to) {
    sel.to = to;
    const cands = candidateCards();
    const pick = sel.card !== null && cands.includes(sel.card) ? sel.card : cands.length === 1 ? cands[0] : null;
    if (pick === null) return render();                          // two cards reach it: ask
    doMove({ from: sel.from, to, card: pick });
  }
  function onCard(id) {
    if (!S || !canAct() || !S.h[cur - 1].includes(id)) return;
    if (hasNoMoves()) return doMove({ from: -1, to: -1, card: id });
    if (sel.to !== null && candidateCards().includes(id)) return doMove({ from: sel.from, to: sel.to, card: id });
    sel = { card: sel.card === id ? null : id, from: sel.from, to: null };
    render();
  }

  // ---------- making a move ----------
  function doMove(mv) {
    sel = { card: null, from: null, to: null };
    if (isLinked()) return playLink(mv);
    history.push({ s: R.str(S), cur });
    apply(mv);
  }
  function apply(mv) {
    S = R.play(S, cur, mv);
    lastFrom = mv.from >= 0 ? mv.from : null; lastTo = mv.from >= 0 ? mv.to : null;
    const w = R.winnerOf(S, cur);
    if (w) { over = true; winner = w; return finish(); }
    cur = other(cur);
    afterMove();
  }
  function afterMove() {
    if (mode === "ai" && cur !== humanIs) {
      thinking = true;
      Gamekit.turn(cur, "Bot thinking…", true);
      statusEl.textContent = "Bot thinking…";
      render();
      aiTimer = setTimeout(aiMove, 450);
      return;
    }
    showTurn();
    render();
  }
  function aiMove() {
    aiTimer = null; thinking = false;
    if (over) return;
    apply(R.bestMove(R.str(S), cur, diff, Math.random));
  }
  function cancelAI() { if (aiTimer !== null) { clearTimeout(aiTimer); aiTimer = null; } thinking = false; }

  function showTurn() {
    if (mode === "ai") {
      Gamekit.turn(humanIs, "Your move · you're " + NAMES[humanIs]);
      statusEl.textContent = "Your move.";
    } else {
      Gamekit.turn(cur, NAMES[cur] + "'s move");
      statusEl.textContent = NAMES[cur] + "'s move.";
    }
  }
  function finish() {
    cancelAI();
    Gamekit.turn(null);
    if (mode === "ai") statusEl.textContent = winner === humanIs ? "You win! " + Gamekit.taunt("win") : "Bot wins. " + Gamekit.taunt("loss");
    else statusEl.textContent = `${NAMES[winner]} wins. ${NAMES[other(winner)]} — ${Gamekit.taunt("loss")}`;
    render();
  }

  function newLocal() {
    cancelAI();
    S = R.parse(R.deal(Math.random));
    history = []; over = false; winner = 0; lastTo = lastFrom = null;
    sel = { card: null, from: null, to: null };
    cur = RED;
    humanIs = sideSel.value === "2" ? BLUE : RED;
    viewer = mode === "ai" ? humanIs : RED;
    if (mode === "ai" && humanIs === BLUE) return afterMove();
    showTurn();
    render();
  }

  // Takes back moves until it is the human's turn again.
  function undo() {
    if (isLinked() || !history.length) return;
    cancelAI();
    over = false; winner = 0; lastTo = lastFrom = null;
    sel = { card: null, from: null, to: null };
    do {
      const h = history.pop();
      S = R.parse(h.s); cur = h.cur;
    } while (history.length && mode === "ai" && cur !== humanIs);
    showTurn();
    render();
  }

  // ---------- 2 players over WhatsApp, and live online ----------
  // board: the 30-character string described in rules.js. Red opens and deals.
  function validateOnitama(s) {
    if (!R.parse(s.board)) return false;
    return Number.isInteger(s.last) && s.last >= 0 && s.last <= 25;
  }
  const shared = {
    game: "onitama", version: 1, players: [RED, BLUE],
    label: (p) => NAMES[p],
    ui: document.getElementById("wa-ui"), statusEl: statusEl,
    validateBoard: validateOnitama, onState: loadLink,
  };
  const link = AsyncShare.start(Object.assign({ title: "onitama" }, shared));
  const live = typeof LiveShare === "undefined" ? null : LiveShare.start(shared);
  const activeLink = () => (mode === "live" && live ? live : link);

  function loadLink(s, canMove, info) {
    cancelAI();
    viewer = info && info.me ? info.me : RED;
    if (s) { S = R.parse(s.board); cur = s.turn; }
    else { if (!dealt) dealt = R.parse(R.deal(Math.random)); S = dealt; cur = RED; }
    over = !!s && s.status !== "in_progress";
    winner = over ? s.winner : 0;
    lastTo = s && s.last < 25 ? s.last : null; lastFrom = null;
    linkCanMove = canMove;
    sel = { card: null, from: null, to: null };
    render();
  }
  function playLink(mv) {
    const next = R.play(S, cur, mv);
    const w = R.winnerOf(next, cur);
    dealt = null;
    activeLink().commit({ board: R.str(next), status: w ? "won" : "in_progress", winner: w || null, last: mv.from >= 0 ? mv.to : 25 });
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
  else if (live) LiveShare.enable(modeSel, "onitama");
  applyMode();

  // A refresh keeps a game against the computer or on one device.
  const resumer = Gamekit.resume("onitama", () => (isLinked() || over || !history.length) ? null : {
    mode: mode, s: R.str(S), cur: cur, human: humanIs, h: history,
  }, (s) => {
    if (s.mode !== "ai" && s.mode !== "local") return false;
    if (!R.parse(s.s) || (s.cur !== 1 && s.cur !== 2)) return false;
    if (!Array.isArray(s.h) || !s.h.every((x) => x && R.parse(x.s) && (x.cur === 1 || x.cur === 2))) return false;
    mode = s.mode; modeSel.value = mode;
    applyMode();
    cancelAI();
    humanIs = s.human === BLUE ? BLUE : RED;
    sideSel.value = humanIs === BLUE ? "2" : "1";
    viewer = mode === "ai" ? humanIs : RED;
    S = R.parse(s.s); cur = s.cur; history = s.h.map((x) => ({ s: x.s, cur: x.cur }));
    over = false; winner = 0; lastTo = lastFrom = null;
    sel = { card: null, from: null, to: null };
    if (mode === "ai" && cur !== humanIs) afterMove(); else { showTurn(); render(); }
    return true;
  });
  if (!params.has("s") && !invited) resumer.restore();
  window.addEventListener("load", () => Manpage.autoOpen("onitama"));
})();

if (window.Gamekit && Gamekit.popFilled) Gamekit.popFilled(document.getElementById("board"));   // new squares pop in

if (window.Gamekit && Gamekit.glidePieces) Gamekit.glidePieces(document.getElementById("board"), ".on-pc");   // pieces glide
