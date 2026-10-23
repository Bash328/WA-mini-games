(function () {
  "use strict";

  const R = globalThis.FanoronaRules;
  const RED = 1, BLUE = 2;
  const NAMES = { [RED]: "Red", [BLUE]: "Blue" };
  const other = R.other;
  const NS = "http://www.w3.org/2000/svg";

  const boardEl = document.getElementById("board");
  const statusEl = document.getElementById("status");
  const hintEl = document.getElementById("hint");
  const undoBtn = document.getElementById("undo-btn");
  const resetBtn = document.getElementById("reset-btn");
  const chipsEl = document.getElementById("chips");
  const modeSel = document.getElementById("mode");
  const sideSel = document.getElementById("side");
  const choiceEl = document.getElementById("choice");
  const choiceA = document.getElementById("choice-a");
  const choiceW = document.getElementById("choice-w");
  const store = Gamekit.storage("fanorona:");

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
  let S = R.create();                 // { b, t, from, c } (see rules.js)
  let cur = S.t;                      // side to move (the same side again during a chain)
  let over = false, winner = 0;
  let history = [];                   // [{ s, cur, lastFrom, lastTo }] for undo
  let humanIs = RED;
  let viewer = RED;                   // whose side the link is being looked at from
  let sel = null;                     // the selected point
  let lastFrom = null, lastTo = null;
  let choice = null;                  // { to, a, w }: two capture lines open on one step
  let thinking = false, aiTimer = null;
  let linkCanMove = false;

  const el = (tag, cls) => { const e = document.createElement(tag); if (cls) e.className = cls; return e; };
  const chainActive = () => !!S && S.from >= 0;
  const canAct = () => !over && !thinking && (isLinked() ? linkCanMove : mode === "ai" ? cur === humanIs : true);

  // ---------- the marked lines ----------
  function lineSvg() {
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("class", "fn-lines");
    svg.setAttribute("viewBox", "0 0 9 5");
    svg.setAttribute("aria-hidden", "true");
    const line = (x1, y1, x2, y2) => {
      const l = document.createElementNS(NS, "line");
      l.setAttribute("x1", String(x1)); l.setAttribute("y1", String(y1));
      l.setAttribute("x2", String(x2)); l.setAttribute("y2", String(y2));
      svg.append(l);
    };
    for (let r = 0; r < R.ROWS; r++) line(0.5, r + 0.5, R.COLS - 0.5, r + 0.5);
    for (let c = 0; c < R.COLS; c++) line(c + 0.5, 0.5, c + 0.5, R.ROWS - 0.5);
    // One segment per diagonal step. Only the strong points (c + r even) lie on
    // a diagonal, and both of their diagonal directions are marked lines.
    for (let r = 0; r < R.ROWS; r++) {
      for (let c = 0; c < R.COLS; c++) {
        if ((c + r) % 2 !== 0) continue;
        for (const [dc, dr] of [[1, 1], [1, -1]]) {
          const nc = c + dc, nr = r + dr;
          if (!R.inside(nr, nc)) continue;
          line(c + 0.5, r + 0.5, nc + 0.5, nr + 0.5);
        }
      }
    }
    return svg;
  }

  // ---------- drawing ----------
  function movesForSel() {
    if (!S || sel === null || !canAct()) return [];
    return R.gen(S, cur).filter((m) => m.from === sel);
  }
  function destMap() {
    const map = new Map();
    if (!S || sel === null) return map;
    for (const m of R.gen(S, cur)) {
      if (m.from !== sel) continue;
      if (!map.has(m.to)) map.set(m.to, []);
      map.get(m.to).push(m);
    }
    return map;
  }

  function render() {
    if (!S) return;
    const act = canAct();
    const dests = destMap();
    const chain = chainActive();
    // When a capture is compulsory, ring the pieces that can actually make one:
    // otherwise a player has to tap around twenty-two pieces to find the few
    // moves the rules allow.
    const legal = act && !chain ? R.gen(S, cur) : [];
    const mustCapture = legal.some((m) => m.cap !== 0);
    const movable = new Set(legal.map((m) => m.from));
    boardEl.innerHTML = "";
    boardEl.append(lineSvg());
    for (let i = 0; i < R.CELLS; i++) {
      const r = R.rowOf(i), c = R.colOf(i), v = S.b[i];
      const b = el("button", "fn-pt");
      b.type = "button";
      b.style.gridRow = String(r + 1);
      b.style.gridColumn = String(c + 1);
      if (v) {
        b.classList.add("p" + v);
        b.append(el("span", "fn-pc p" + v));
      }
      if (act && !chain && v === cur) {
        b.classList.add("mine");
        if (mustCapture && movable.has(i)) b.dataset.can = "1";
      }
      const opts = dests.get(i);
      if (act && opts) {
        b.classList.add("dest");
        if (opts.some((m) => m.cap !== 0)) b.classList.add("cap");
        if (opts.length > 1) b.dataset.both = "1";
      }
      if (sel === i) b.classList.add("sel");
      if (lastTo === i) b.classList.add("last");
      else if (lastFrom === i) b.classList.add("from");
      b.disabled = !act;
      const what = v ? NAMES[v] + " piece" : "empty point";
      let label = "row " + (r + 1) + ", column " + (c + 1) + ", " + what;
      if (v && i === S.from) label += ", capturing piece";
      if (act && opts) label += opts.length > 1 ? ", capture: choose a line" : (opts[0].cap ? ", capture here" : ", move here");
      b.setAttribute("aria-label", label);
      b.addEventListener("click", () => onPoint(i));
      boardEl.append(b);
    }
    undoBtn.disabled = isLinked() || history.length === 0 || thinking;
    setHint(act);
    renderChoice();
  }

  function setHint(act) {
    if (!act) { hintEl.textContent = ""; return; }
    if (choice) { hintEl.textContent = "Both lines can be taken: choose ahead or behind."; return; }
    if (S.from >= 0) {
      hintEl.textContent = destMap().size ? "Capture again with the ringed piece." : "No more captures.";
      return;
    }
    const legal = R.gen(S, cur);
    if (!legal.length) { hintEl.textContent = "No legal move."; return; }
    if (sel === null) {
      hintEl.textContent = legal.some((m) => m.cap !== 0)
        ? "Captures are compulsory: tap a ringed piece."
        : "Tap one of your pieces, then a marked point.";
      return;
    }
    if (!destMap().size) { hintEl.textContent = "That piece has no move. Tap another."; return; }
    hintEl.textContent = "Tap a marked point; a ring takes a line.";
  }

  function renderChoice() {
    if (!choice) { choiceEl.hidden = true; return; }
    choiceEl.hidden = false;
    const a = choice.a, w = choice.w;
    choiceA.textContent = "Take " + a.n + " ahead";
    choiceW.textContent = "Take " + w.n + " behind";
    choiceA.setAttribute("aria-label", "Capture " + a.n + (a.n === 1 ? " piece" : " pieces") + " in the line ahead");
    choiceW.setAttribute("aria-label", "Capture " + w.n + (w.n === 1 ? " piece" : " pieces") + " in the line behind");
  }

  // ---------- selecting and moving ----------
  function onPoint(i) {
    if (!S || !canAct()) return;
    if (choice) choice = null;                       // a tap on the board drops a pending choice
    const here = movesForSel().filter((m) => m.to === i);
    if (chainActive()) {
      if (here.length) return takeMove(here);
      return render();
    }
    if (S.b[i] === cur) {
      sel = sel === i ? null : i;
      return render();
    }
    if (sel !== null && here.length) return takeMove(here);
    if (sel !== null) { sel = null; render(); }
    else render();
  }

  function takeMove(opts) {
    if (opts.length === 1) return doMove(opts[0]);
    const a = opts.find((m) => m.cap === 1), w = opts.find((m) => m.cap === 2);
    if (!a || !w) return doMove(opts[0]);
    choice = { to: opts[0].to, a: a, w: w };
    render();
  }

  choiceA.addEventListener("click", () => { if (choice) doMove(choice.a); });
  choiceW.addEventListener("click", () => { if (choice) doMove(choice.w); });

  function snapshot() {
    return { s: R.str(S), cur: cur, lastFrom: lastFrom, lastTo: lastTo };
  }

  function doMove(mv) {
    choice = null;
    if (isLinked()) return playLink(mv);
    history.push(snapshot());
    applyStep(mv);
  }

  function applyStep(mv) {
    const mover = cur;
    const T = R.play(S, mover, mv);
    if (!T) { render(); return; }
    S = T;
    cur = S.t;
    lastFrom = mv.from;
    lastTo = mv.to;
    sel = S.from >= 0 ? S.from : null;
    const o = R.outcome(S, mover);
    if (o.status !== "in_progress") {
      over = true;
      winner = o.winner;
      return finish(o.status);
    }
    if (mode === "ai" && cur !== humanIs) return aiTurn();
    showTurn();
    render();
  }

  function aiTurn() {
    thinking = true;
    Gamekit.turn(cur, chainActive() ? "Bot · keep capturing" : "Bot thinking…", true);
    statusEl.textContent = "Bot thinking…";
    render();
    aiTimer = setTimeout(aiMove, 800 + Math.floor(Math.random() * 500));   // 0.8–1.3 s
  }

  function aiMove() {
    aiTimer = null;
    thinking = false;
    if (over || !S) return;
    const mv = R.bestMove(R.str(S), cur, diff, Math.random);
    if (!mv) {
      over = true;
      winner = R.winner(S) || other(cur);
      return finish(winner ? "won" : "draw");
    }
    history.push(snapshot());
    applyStep(mv);
  }

  function cancelAI() {
    if (aiTimer !== null) { clearTimeout(aiTimer); aiTimer = null; }
    thinking = false;
  }

  function showTurn() {
    if (!S || over) return;
    const chain = chainActive();
    if (mode === "ai") {
      if (cur !== humanIs) {
        Gamekit.turn(cur, chain ? "Bot · keep capturing" : "Bot thinking…", true);
        statusEl.textContent = "Bot thinking…";
        return;
      }
      Gamekit.turn(cur, chain ? "Keep capturing" : "Your move · you're " + NAMES[humanIs]);
      statusEl.textContent = chain ? "Keep capturing." : "Your move.";
      return;
    }
    Gamekit.turn(cur, chain ? NAMES[cur] + " · keep capturing" : NAMES[cur] + "'s move");
    statusEl.textContent = chain ? "Keep capturing." : NAMES[cur] + "'s move.";
  }

  function finish(status) {
    cancelAI();
    choice = null;
    sel = null;
    Gamekit.turn(null);
    if (status === "draw") statusEl.textContent = "Draw. 60 quiet turns. " + Gamekit.taunt("draw");
    else if (mode === "ai") statusEl.textContent = winner === humanIs ? "You win! " + Gamekit.taunt("win") : "Bot wins. " + Gamekit.taunt("loss");
    else statusEl.textContent = NAMES[winner] + " wins. " + NAMES[other(winner)] + " — " + Gamekit.taunt("loss");
    render();
  }

  function newLocal() {
    cancelAI();
    S = R.create();
    cur = S.t;
    history = [];
    over = false; winner = 0;
    lastFrom = null; lastTo = null;
    sel = null; choice = null;
    humanIs = sideSel.value === "2" ? BLUE : RED;
    viewer = mode === "ai" ? humanIs : RED;
    if (mode === "ai" && cur !== humanIs) return aiTurn();
    showTurn();
    render();
  }

  // Takes a move (and any chain after it) back until it is the human's turn
  // again, and always to the start of a turn rather than the middle of a chain.
  function undo() {
    if (isLinked() || !history.length) return;
    cancelAI();
    choice = null;
    over = false; winner = 0; sel = null;
    lastFrom = null; lastTo = null;
    do {
      const h = history.pop();
      S = R.parse(h.s);
      cur = h.cur;
      lastFrom = h.lastFrom === undefined ? null : h.lastFrom;
      lastTo = h.lastTo === undefined ? null : h.lastTo;
    } while (history.length && (!S || S.from >= 0 || (mode === "ai" && cur !== humanIs)));
    if (!S) return newLocal();
    sel = S.from >= 0 ? S.from : null;
    if (mode === "ai" && cur !== humanIs) return aiTurn();
    showTurn();
    render();
  }

  // ---------- 2 players over WhatsApp, and live online ----------
  // board: the 49-character string described in rules.js; last is from * 45 + to,
  // so both ends of the move can be marked on the board the link opens.
  function validateBoard(s) {
    if (!s || !R.parse(s.board)) return false;
    return Number.isInteger(s.last) && s.last >= 0 && s.last <= R.CELLS * R.CELLS - 1;
  }
  const shared = {
    game: "fanorona", version: 1, players: [RED, BLUE],
    label: (p) => NAMES[p],
    ui: document.getElementById("wa-ui"), statusEl: statusEl,
    validateBoard: validateBoard, onState: loadLink,
  };
  const link = AsyncShare.start(Object.assign({ title: "fanorona" }, shared));
  const live = typeof LiveShare === "undefined" ? null : LiveShare.start(shared);
  const activeLink = () => (mode === "live" && live ? live : link);

  function loadLink(s, canMove, info) {
    cancelAI();
    choice = null;
    viewer = info && info.me ? info.me : RED;
    if (s) {
      S = R.parse(s.board) || R.create();
      cur = S.t;
      over = s.status !== "in_progress";
      winner = over ? s.winner || 0 : 0;
      if (Number.isInteger(s.last)) {
        lastFrom = Math.floor(s.last / R.CELLS);
        lastTo = s.last % R.CELLS;
      } else { lastFrom = null; lastTo = null; }
    } else {
      S = R.create();
      cur = S.t;
      over = false; winner = 0;
      lastFrom = null; lastTo = null;
    }
    sel = (!over && S.from >= 0) ? S.from : null;
    linkCanMove = !!canMove;
    render();
  }

  function playLink(mv) {
    const mover = cur;
    const T = R.play(S, mover, mv);
    if (!T) return;
    const o = R.outcome(T, mover);
    activeLink().commit({
      board: R.str(T),
      status: o.status,
      winner: o.winner || null,
      last: mv.from * R.CELLS + mv.to,
      nextTurn: T.t,                 // the mover again while a chain continues
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
  else if (live) LiveShare.enable(modeSel, "fanorona");
  applyMode();

  // A refresh keeps a game against the computer or on one device.
  const resumer = Gamekit.resume("fanorona", () => (isLinked() || over || !history.length) ? null : {
    mode: mode, diff: diff, s: R.str(S), cur: cur, human: humanIs, h: history,
    last: lastFrom !== null && lastTo !== null ? [lastFrom, lastTo] : null,
  }, (s) => {
    if (s.mode !== "ai" && s.mode !== "local") return false;
    const st = R.parse(s.s);
    if (!st || (s.cur !== RED && s.cur !== BLUE) || st.t !== s.cur) return false;
    const point = (n) => Number.isInteger(n) && n >= 0 && n < R.CELLS;
    const pointOrNull = (n) => n === null || n === undefined || point(n);
    if (!Array.isArray(s.h) || !s.h.every((x) => x && R.parse(x.s) && (x.cur === RED || x.cur === BLUE) &&
      pointOrNull(x.lastFrom) && pointOrNull(x.lastTo))) return false;
    const last = Array.isArray(s.last) && s.last.length === 2 && point(s.last[0]) && point(s.last[1]) ? s.last : null;
    mode = s.mode; modeSel.value = mode;
    diff = ["easy", "medium", "hard"].includes(s.diff) ? s.diff : "medium";
    chips.show(diff);
    humanIs = s.human === BLUE ? BLUE : RED;
    sideSel.value = humanIs === BLUE ? "2" : "1";
    applyMode();
    cancelAI();
    choice = null;
    viewer = mode === "ai" ? humanIs : RED;
    S = st;
    cur = s.cur;
    history = s.h.map((x) => ({ s: x.s, cur: x.cur, lastFrom: pointOrNull(x.lastFrom) ? x.lastFrom : null, lastTo: pointOrNull(x.lastTo) ? x.lastTo : null }));
    over = false; winner = 0;
    lastFrom = last ? last[0] : null;
    lastTo = last ? last[1] : null;
    sel = S.from >= 0 ? S.from : null;
    if (mode === "ai" && cur !== humanIs) aiTurn(); else { showTurn(); render(); }
    return true;
  });
  if (!params.has("s") && !invited) resumer.restore();
  window.addEventListener("load", () => Manpage.autoOpen("fanorona"));
})();

if (window.Gamekit && Gamekit.popFilled) Gamekit.popFilled(document.getElementById("board"));          // new pieces pop in
if (window.Gamekit && Gamekit.glidePieces) Gamekit.glidePieces(document.getElementById("board"), ".fn-pc");   // moved pieces glide
