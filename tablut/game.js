(function () {
  "use strict";

  const R = globalThis.TablutRules;
  const ATK = R.ATTACKER, DEF = R.DEFENDER;
  const NAMES = { [ATK]: "Attackers", [DEF]: "Defenders" };
  const other = R.other;

  const boardEl = document.getElementById("board");
  const statusEl = document.getElementById("status");
  const hintEl = document.getElementById("hint");
  const undoBtn = document.getElementById("undo-btn");
  const resetBtn = document.getElementById("reset-btn");
  const chipsEl = document.getElementById("chips");
  const modeSel = document.getElementById("mode");
  const sideSel = document.getElementById("side");
  const store = Gamekit.storage("tablut:");

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
  let S = R.create();                 // { b, t } (see rules.js)
  let cur = ATK;
  let over = false, winner = 0, endReason = "";
  let history = [];                   // [{ s: wire string, cur }] for undo
  let humanIs = ATK;
  let viewer = ATK;                   // whose pieces are at the bottom of the screen
  let sel = null;                     // the selected square
  let lastFrom = null, lastTo = null;
  let thinking = false, aiTimer = null;
  let linkCanMove = false;

  const el = (tag, cls) => { const e = document.createElement(tag); if (cls) e.className = cls; return e; };
  const vIdx = (d) => (viewer === DEF ? 80 - d : d);        // screen square -> board square
  const canAct = () => !over && !thinking && (isLinked() ? linkCanMove : mode === "ai" ? cur === humanIs : true);
  const pieceName = (v) => (v === R.KING ? "King" : v === ATK ? "Attacker" : v === DEF ? "Defender" : "");

  // ---------- drawing ----------
  function destinations() {
    if (!S || sel === null) return new Set();
    const out = new Set();
    for (const mv of R.gen(S, cur)) if (mv.from === sel) out.add(mv.to);
    return out;
  }

  function render() {
    if (!S) return;
    const act = canAct();
    const dests = destinations();
    boardEl.innerHTML = "";
    for (let d = 0; d < 81; d++) {
      const i = vIdx(d), r = (i / 9) | 0, c = i % 9, v = S.b[i];
      const b = el("button", "tb-cell " + ((r + c) % 2 ? "dark" : "light"));
      b.type = "button";
      if (i === R.THRONE) b.classList.add("throne");
      if (R.isCorner(i)) b.classList.add("corner");
      if (v) {
        b.classList.add("occ");
        const kind = v === R.KING ? "king" : v === ATK ? "p1" : "p2";
        b.append(el("span", "tb-pc " + kind));
      }
      if (act && v !== 0 && R.sideOf(v) === cur) b.classList.add("mine");
      if (act && dests.has(i)) b.classList.add("dest");
      if (sel === i) b.classList.add("sel");
      if (lastTo === i) b.classList.add("last");
      else if (lastFrom === i) b.classList.add("from");
      b.disabled = !act;
      b.setAttribute("aria-label", "row " + (r + 1) + ", column " + (c + 1) +
        (v ? ", " + pieceName(v) : "") +
        (i === R.THRONE ? ", throne" : "") + (R.isCorner(i) ? ", corner" : "") +
        (act && dests.has(i) ? ", move here" : ""));
      b.addEventListener("click", () => onCell(i));
      boardEl.append(b);
    }
    undoBtn.disabled = isLinked() || history.length === 0 || thinking;
    if (!act) hintEl.textContent = "";
    else if (!R.gen(S, cur).length) hintEl.textContent = "No piece can move.";
    else if (sel === null) hintEl.textContent = "Tap one of your pieces, then a marked square.";
    else if (!dests.size) hintEl.textContent = "That piece has no move. Tap another.";
    else hintEl.textContent = "Tap a marked square to move.";
  }

  // ---------- selecting ----------
  function onCell(i) {
    if (!S || !canAct()) return;
    if (S.b[i] !== 0 && R.sideOf(S.b[i]) === cur) {
      sel = sel === i ? null : i;
      return render();
    }
    if (sel !== null && destinations().has(i)) return doMove({ from: sel, to: i });
    sel = null;
    render();
  }

  // ---------- making a move ----------
  function doMove(mv) {
    sel = null;
    if (isLinked()) return playLink(mv);
    history.push({ s: R.str(S), cur: cur });
    apply(mv);
  }
  function apply(mv) {
    const mover = cur;
    const next = R.play(S, mover, mv);
    if (!next) return;                 // a stale tap: the board has moved on
    S = next;
    lastFrom = mv.from;
    lastTo = mv.to;
    const o = R.outcome(S, mover);
    endReason = o.reason;
    if (o.status !== "in_progress") {
      over = true;
      winner = o.winner;
      return finish();
    }
    cur = other(cur);
    afterMove();
  }
  function afterMove() {
    if (mode === "ai" && cur !== humanIs) {
      thinking = true;
      Gamekit.turn(cur, "Computer thinking…", true);
      statusEl.textContent = "Computer thinking…";
      render();
      aiTimer = setTimeout(aiMove, 800 + Math.random() * 500);
      return;
    }
    showTurn();
    render();
  }
  function aiMove() {
    aiTimer = null; thinking = false;
    if (over) return;
    const mv = R.bestMove(R.str(S), cur, diff, Math.random);
    if (!mv) { over = true; winner = other(cur); endReason = "stuck"; return finish(); }
    apply(mv);
  }
  function cancelAI() {
    if (aiTimer !== null) { clearTimeout(aiTimer); aiTimer = null; }
    thinking = false;
  }

  function showTurn() {
    if (mode === "ai") {
      Gamekit.turn(humanIs, "Your move · " + NAMES[humanIs]);
      statusEl.textContent = "Your move.";
    } else {
      Gamekit.turn(cur, NAMES[cur] + "' move");
      statusEl.textContent = NAMES[cur] + "' move.";
    }
  }
  function finish() {
    cancelAI();
    Gamekit.turn(null);
    const reason = endReason === "escape" ? "The king reached a corner."
      : endReason === "king" ? "The king is surrounded."
      : NAMES[other(winner)] + " had no move.";
    if (mode === "ai") {
      const humanWon = winner === humanIs;
      statusEl.textContent = (humanWon ? "You win! " : "Computer wins. ") + reason + " " +
        Gamekit.taunt(humanWon ? "win" : "loss");
    } else {
      statusEl.textContent = NAMES[winner] + " win. " + reason + " " +
        NAMES[other(winner)] + " — " + Gamekit.taunt("loss");
    }
    render();
  }

  function newLocal() {
    cancelAI();
    S = R.create();
    history = []; over = false; winner = 0; endReason = ""; lastFrom = null; lastTo = null; sel = null;
    cur = ATK;
    humanIs = sideSel.value === "2" ? DEF : ATK;
    viewer = mode === "ai" ? humanIs : ATK;
    if (mode === "ai" && humanIs === DEF) return afterMove();
    showTurn();
    render();
  }

  // Takes back moves until it is the human's turn again.
  function undo() {
    if (isLinked() || !history.length) return;
    cancelAI();
    over = false; winner = 0; endReason = ""; lastFrom = null; lastTo = null; sel = null;
    do {
      const h = history.pop();
      S = R.parse(h.s);
      cur = h.cur;
    } while (history.length && mode === "ai" && cur !== humanIs);
    showTurn();
    render();
  }

  // ---------- 2 players over WhatsApp, and live online ----------
  // board: the string described in rules.js; last is from * 9 + to, so both
  // ends of the move can be marked on the board the link opens.
  function validateBoard(s) {
    // The board's own turn can differ from the envelope after a resignation
    // (the board is unchanged, the envelope names the winner next), so only
    // the position and the move mark are checked here.
    if (!R.parse(s.board)) return false;
    return Number.isInteger(s.last) && s.last >= 0 && s.last <= 80 * 9 + 80;
  }
  const shared = {
    game: "tablut", version: 1, players: [ATK, DEF],
    label: (p) => NAMES[p],
    ui: document.getElementById("wa-ui"), statusEl: statusEl,
    validateBoard: validateBoard, onState: loadLink,
  };
  const link = AsyncShare.start(Object.assign({ title: "tablut" }, shared));
  const live = typeof LiveShare === "undefined" ? null : LiveShare.start(shared);
  const activeLink = () => (mode === "live" && live ? live : link);

  function loadLink(s, canMove, info) {
    cancelAI();
    viewer = info && info.me ? info.me : ATK;
    S = (s && R.parse(s.board)) || R.create();
    cur = s ? s.turn : S.t;
    over = !!s && s.status !== "in_progress";
    winner = over ? s.winner || 0 : 0;
    endReason = "";
    if (s && Number.isInteger(s.last)) {
      lastFrom = Math.floor(s.last / 9);
      lastTo = s.last % 9;
    } else { lastFrom = null; lastTo = null; }
    linkCanMove = canMove;
    sel = null;
    render();
  }
  function playLink(mv) {
    const next = R.play(S, cur, mv);
    if (!next) return;
    const o = R.outcome(next, cur);
    activeLink().commit({
      board: R.str(next),
      status: o.status,
      winner: o.winner || null,
      last: mv.from * 9 + mv.to,
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
  else if (live) LiveShare.enable(modeSel, "tablut");
  applyMode();

  // A refresh keeps a game against the computer or on one device.
  const resumer = Gamekit.resume("tablut", () => (isLinked() || over || !history.length) ? null : {
    mode: mode, diff: diff, s: R.str(S), cur: cur, human: humanIs, h: history,
    last: lastFrom !== null ? [lastFrom, lastTo] : null,
  }, (s) => {
    if (s.mode !== "ai" && s.mode !== "local") return false;
    const st = R.parse(s.s);
    if (!st || (s.cur !== ATK && s.cur !== DEF) || st.t !== s.cur) return false;
    if (!Array.isArray(s.h) || !s.h.every((x) => x && R.parse(x.s) && (x.cur === ATK || x.cur === DEF))) return false;
    const last = Array.isArray(s.last) && s.last.length === 2 && s.last.every((n) => Number.isInteger(n) && n >= 0 && n < 81) ? s.last : null;
    mode = s.mode; modeSel.value = mode;
    diff = ["easy", "medium", "hard"].includes(s.diff) ? s.diff : "medium";
    chips.show(diff);
    humanIs = s.human === DEF ? DEF : ATK;
    sideSel.value = humanIs === DEF ? "2" : "1";
    applyMode();
    cancelAI();
    viewer = mode === "ai" ? humanIs : ATK;
    S = st; cur = s.cur; history = s.h.map((x) => ({ s: x.s, cur: x.cur }));
    over = false; winner = 0; endReason = ""; sel = null;
    lastFrom = last ? last[0] : null;
    lastTo = last ? last[1] : null;
    if (mode === "ai" && cur !== humanIs) afterMove(); else { showTurn(); render(); }
    return true;
  });
  if (!params.has("s") && !invited) resumer.restore();
  window.addEventListener("load", () => Manpage.autoOpen("tablut"));
})();

if (window.Gamekit && Gamekit.popFilled) Gamekit.popFilled(document.getElementById("board"));      // new pieces pop in

if (window.Gamekit && Gamekit.glidePieces) Gamekit.glidePieces(document.getElementById("board"), ".tb-pc");   // pieces glide
