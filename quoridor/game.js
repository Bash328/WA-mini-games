(function () {
  "use strict";

  const R = globalThis.QuoridorRules;
  const RED = 1, BLUE = 2;
  const NAMES = { [RED]: "Red", [BLUE]: "Blue" };
  const other = R.other;

  const boardEl = document.getElementById("board");
  const statusEl = document.getElementById("status");
  const hintEl = document.getElementById("hint");
  const countsEl = document.getElementById("counts");
  const undoBtn = document.getElementById("undo-btn");
  const resetBtn = document.getElementById("reset-btn");
  const chipsEl = document.getElementById("chips");
  const modeSel = document.getElementById("mode");
  const sideSel = document.getElementById("side");
  const moveTab = document.getElementById("mode-move");
  const wallTab = document.getElementById("mode-wall");
  const rotateBtn = document.getElementById("rotate-btn");
  const placeBtn = document.getElementById("place-btn");
  const store = Gamekit.storage("quoridor:");

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
  let S = R.parse(R.initial());
  let cur = RED;
  let over = false, winner = 0;
  let history = [];                   // [{ s: wire string, cur }] for undo
  let humanIs = RED;
  let viewer = RED;                   // whose pawn starts at the bottom of the screen
  let tool = "move", wo = 0, ghost = null;     // "move" | "wall"; wall orientation (0 horizontal); the previewed crossing (0..63) or null
  let last = null;                    // { t: "move", to } | { t: "wall", id } for the highlight
  let thinking = false, aiTimer = null;
  let linkCanMove = false;

  const el = (tag, cls) => { const e = document.createElement(tag); if (cls) e.className = cls; return e; };
  // the board is drawn from the viewer's side: turned half a circle for Blue
  const dCell = (i) => (viewer === BLUE ? 80 - i : i);
  const dWall = (id) => (viewer === BLUE ? (id & 64) + 63 - (id & 63) : id);

  const canAct = () => !over && !thinking && (isLinked() ? linkCanMove : mode === "ai" ? cur === humanIs : true);
  const wallId = () => (ghost === null ? null : wo * 64 + ghost);
  const ghostOk = () => ghost !== null && R.wallOk(S, cur, wallId());

  // ---------- drawing ----------
  function render() {
    const act = canAct();
    const T = R.tables(S.walls);
    const dests = act && tool === "move" ? new Set(R.pawnMoves(S, cur, T)) : new Set();
    boardEl.innerHTML = "";
    boardEl.classList.toggle("walling", act && tool === "wall");
    for (let d = 0; d < 81; d++) {
      const i = dCell(d), r = Math.floor(d / 9), c = d % 9;
      const b = el("button", "qd-cell");
      b.type = "button";
      b.style.gridRow = String(2 * r + 1); b.style.gridColumn = String(2 * c + 1);
      if (Math.floor(i / 9) === 0) b.classList.add("goal1"); else if (Math.floor(i / 9) === 8) b.classList.add("goal2");
      if (S.p[0] === i) b.append(el("span", "qd-pawn p1")); else if (S.p[1] === i) b.append(el("span", "qd-pawn p2"));
      if (dests.has(i)) b.classList.add("dest");
      if (last && last.t === "move" && last.to === i) b.classList.add("last");
      b.disabled = !dests.has(i);
      b.setAttribute("aria-label", "row " + (Math.floor(i / 9) + 1) + ", column " + ((i % 9) + 1) + (S.p[0] === i ? ", Red pawn" : S.p[1] === i ? ", Blue pawn" : ""));
      b.addEventListener("click", () => onCell(i));
      boardEl.append(b);
    }
    const drawWall = (id, cls) => {
      const w = el("div", "qd-wall" + (cls ? " " + cls : ""));
      const dID = dWall(id), o = dID >> 6, r = (dID & 63) >> 3, c = dID & 7;
      if (o === 0) { w.style.gridRow = String(2 * r + 2); w.style.gridColumn = (2 * c + 1) + " / span 3"; }
      else { w.style.gridColumn = String(2 * c + 2); w.style.gridRow = (2 * r + 1) + " / span 3"; }
      boardEl.append(w);
    };
    S.walls.forEach((id) => drawWall(id, last && last.t === "wall" && last.id === id ? "lastw" : ""));
    if (act && tool === "wall" && ghost !== null) drawWall(wallId(), "ghost" + (ghostOk() ? "" : " bad"));
    // the 8x8 places a wall can go (only reachable while placing a wall)
    const hits = el("div", "qd-hits");
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const h = el("button", "qd-hit");
      h.type = "button";
      h.style.left = ((7 * c + 3) / 62 * 100).toFixed(3) + "%";
      h.style.top = ((7 * r + 3) / 62 * 100).toFixed(3) + "%";
      h.setAttribute("aria-label", "wall place, row " + (r + 1) + ", column " + (c + 1));
      const i = r * 8 + c;
      h.addEventListener("click", () => onHit(viewer === BLUE ? 63 - i : i));
      hits.append(h);
    }
    boardEl.append(hits);

    // wall counts, mine first
    countsEl.innerHTML = "";
    [viewer, other(viewer)].forEach((p) => {
      const s = el("span");
      const dot = el("span", "dot"); dot.style.background = p === RED ? "#d9534f" : "#3f7fd6";
      const b = el("b"); b.textContent = String(S.w[p - 1]);
      s.append(dot, document.createTextNode(NAMES[p] + ": "), b, document.createTextNode(S.w[p - 1] === 1 ? " wall" : " walls"));
      countsEl.append(s);
    });
    moveTab.classList.toggle("on", tool === "move"); wallTab.classList.toggle("on", tool === "wall");
    moveTab.disabled = !act; wallTab.disabled = !act || S.w[cur - 1] < 1;
    rotateBtn.disabled = !act || tool !== "wall"; placeBtn.disabled = !act || tool !== "wall" || !ghostOk();
    undoBtn.disabled = isLinked() || history.length === 0 || thinking;
    hintEl.textContent = !act ? "" : tool === "move" ? "Tap a dotted square to step, or choose Wall." : ghost === null ? "Tap where four squares meet to place a wall there." : ghostOk() ? "Tap Place to put the wall down, or tap the spot again to turn it." : "A wall can't go there: it crosses another or closes the way.";
  }

  // ---------- acting ----------
  function onCell(i) {
    if (!canAct() || tool !== "move" || !R.pawnMoves(S, cur).includes(i)) return;
    doAction({ t: "move", to: i });
  }
  function onHit(i) {
    if (!canAct() || tool !== "wall") return;
    if (ghost === i) wo = 1 - wo; else ghost = i;
    render();
  }
  moveTab.addEventListener("click", () => { tool = "move"; ghost = null; render(); });
  wallTab.addEventListener("click", () => { tool = "wall"; render(); });
  rotateBtn.addEventListener("click", () => { wo = 1 - wo; render(); });
  placeBtn.addEventListener("click", () => { if (ghostOk()) doAction({ t: "wall", id: wallId() }); });

  function doAction(a) {
    tool = "move"; ghost = null;
    if (isLinked()) return playLink(a);
    history.push({ s: R.str(S), cur });
    apply(a);
  }
  function apply(a) {
    S = R.play(S, cur, a);
    last = a;
    const w = R.winnerOf(S);
    if (w) { over = true; winner = w; return finish(); }
    cur = other(cur);
    if (R.stuck(S, cur)) { over = true; winner = 0; return finish(); }
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
    const a = R.bestMove(R.str(S), cur, diff, Math.random);
    if (!a) { over = true; winner = 0; return finish(); }
    apply(a);
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
    if (!winner) statusEl.textContent = "Draw. Nobody can move. " + Gamekit.taunt("draw");
    else if (mode === "ai") statusEl.textContent = winner === humanIs ? "You win! " + Gamekit.taunt("win") : "Bot wins. " + Gamekit.taunt("loss");
    else statusEl.textContent = `${NAMES[winner]} wins. ${NAMES[other(winner)]} — ${Gamekit.taunt("loss")}`;
    render();
  }

  function newLocal() {
    cancelAI();
    S = R.parse(R.initial());
    history = []; over = false; winner = 0; last = null; tool = "move"; ghost = null;
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
    over = false; winner = 0; last = null; tool = "move"; ghost = null;
    do {
      const h = history.pop();
      S = R.parse(h.s); cur = h.cur;
    } while (history.length && mode === "ai" && cur !== humanIs);
    showTurn();
    render();
  }

  // ---------- 2 players over WhatsApp, and live online ----------
  // board: the string described in rules.js. Red opens.
  function validateQuoridor(s) {
    if (!R.parse(s.board)) return false;
    return Number.isInteger(s.last) && s.last >= 0 && s.last < 228;
  }
  const shared = {
    game: "quoridor", version: 1, players: [RED, BLUE],
    label: (p) => NAMES[p],
    ui: document.getElementById("wa-ui"), statusEl: statusEl,
    validateBoard: validateQuoridor, onState: loadLink,
  };
  const link = AsyncShare.start(Object.assign({ title: "quoridor" }, shared));
  const live = typeof LiveShare === "undefined" ? null : LiveShare.start(shared);
  const activeLink = () => (mode === "live" && live ? live : link);

  function loadLink(s, canMove, info) {
    cancelAI();
    viewer = info && info.me ? info.me : RED;
    S = R.parse(s ? s.board : R.initial());
    cur = s ? s.turn : RED;
    over = !!s && s.status !== "in_progress";
    winner = over ? s.winner || 0 : 0;
    last = s && s.last !== null ? (s.last >= 100 ? { t: "wall", id: s.last - 100 } : { t: "move", to: s.last }) : null;
    linkCanMove = canMove;
    tool = "move"; ghost = null;
    render();
  }
  function playLink(a) {
    const next = R.play(S, cur, a);
    const w = R.winnerOf(next);
    const stuck = !w && R.stuck(next, other(cur));
    activeLink().commit({ board: R.str(next), status: w ? "won" : stuck ? "draw" : "in_progress", winner: w || null, last: a.t === "move" ? a.to : 100 + a.id });
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
  else if (live) LiveShare.enable(modeSel, "quoridor");
  applyMode();

  // A refresh keeps a game against the computer or on one device.
  const resumer = Gamekit.resume("quoridor", () => (isLinked() || over || !history.length) ? null : {
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
    over = false; winner = 0; last = null; tool = "move"; ghost = null;
    if (mode === "ai" && cur !== humanIs) afterMove(); else { showTurn(); render(); }
    return true;
  });
  if (!params.has("s") && !invited) resumer.restore();
  window.addEventListener("load", () => Manpage.autoOpen("quoridor"));
})();

if (window.Gamekit && Gamekit.glidePieces) Gamekit.glidePieces(document.getElementById("board"), ".qd-pawn");   // pawns glide
