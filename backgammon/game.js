(function () {
  "use strict";

  const R = globalThis.BackgammonRules;
  const RED = 1, WHITE = 2;
  const NAMES = { [RED]: "Black", [WHITE]: "White" };
  const other = R.other;

  const boardEl = document.getElementById("board");
  const statusEl = document.getElementById("status");
  const infoEl = document.getElementById("info");
  const diceEl = document.getElementById("dice");
  const diceOnEl = document.getElementById("dice-on");     // the dice themselves lie on the board
  const scoreEl = document.getElementById("score");
  const hintEl = document.getElementById("hint");
  const undoBtn = document.getElementById("undo-btn");
  const resetBtn = document.getElementById("reset-btn");
  const chipsEl = document.getElementById("chips");
  const modeSel = document.getElementById("mode");
  const sideSel = document.getElementById("side");
  const store = Gamekit.storage("backgammon:");

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

  // ---------- the position and the turn in progress ----------
  let S = R.parse(R.initial());       // the position as it is right now (steps already taken this turn included)
  let startS = R.clone(S);            // ...and as it was when the turn began
  let cur = RED;                      // the player to move
  let dice = null, left = [], taken = [];   // this turn's roll, the dice still to play, the steps taken so far
  let over = false, winner = 0;
  let humanIs = RED, viewer = RED;    // viewer: whose home board is at the bottom right
  let sel = null;                     // the point (or -1: the bar) whose destinations are showing
  let lastFrom = null, lastTo = null;
  let thinking = false, aiTimer = null;
  let linkCanMove = false, liveDice = null, turnsPlayed = 0;

  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  const acting = () => !over && !thinking && (isLinked() ? linkCanMove : mode === "ai" ? cur === humanIs : true);
  const legal = () => (dice && acting() ? R.legalSteps(S, cur, left) : []);

  // ---------- drawing ----------
  const PIPS = Gamekit.PIPS;             // the shared pip layout
  function dieEl(v, used) {
    const d = el("div", "bg-die" + (used ? " used" : ""));
    const on = new Set(PIPS[v]);
    for (let i = 0; i < 9; i++) d.append(el("i", on.has(i) ? "on" : ""));
    d.setAttribute("aria-label", "die showing " + v);
    return d;
  }
  // A roll turns each die over while its face flicks past, then it lands on the real value (the shared dice roll).
  let rollAnimKey = "";
  function tumble() {
    Gamekit.rollDice([...diceOnEl.children].map((d) => ({ el: d, v: d.querySelectorAll("i.on").length })), Gamekit.paintPips);
  }
  // the board from the viewer's side: their home board bottom right (White's view swaps the rows)
  const topIdx = (c) => (viewer === RED ? 12 + c : 11 - c);
  const botIdx = (c) => (viewer === RED ? 11 - c : 12 + c);

  function checkers(box, count, owner, extra) {
    const shown = Math.min(count, 5);
    for (let k = 0; k < shown; k++) {
      const c = el("span", "bg-ch p" + owner);
      if (k === shown - 1 && count > 5) c.textContent = String(count);
      box.append(c);
    }
  }

  function render() {
    const act = acting(), steps = legal();
    const fromOK = new Set(steps.map((s) => s.from));
    const dests = new Set(steps.filter((s) => s.from === sel).map((s) => s.to));
    boardEl.innerHTML = "";
    const point = (i, c, row) => {
      const b = el("button", "bg-pt " + row + (c % 2 ? " alt" : ""));
      b.type = "button";
      b.style.gridRow = row === "top" ? "1" : "2"; b.style.gridColumn = String(c < 6 ? c + 1 : c + 2);
      const v = S.pt[i];
      if (v) checkers(b, Math.abs(v), v > 0 ? RED : WHITE);
      if (act && fromOK.has(i)) b.classList.add("can");
      if (sel === i) b.classList.add("sel");
      if (dests.has(i)) b.classList.add("dest");
      if (lastTo === i && !dests.has(i)) b.classList.add("last");
      b.disabled = !(act && (fromOK.has(i) || dests.has(i)));
      b.setAttribute("aria-label", "point " + (i + 1) + (v ? ", " + Math.abs(v) + " " + NAMES[v > 0 ? RED : WHITE] : ", empty") + (dests.has(i) ? ", you can move here" : ""));
      b.addEventListener("click", () => onPoint(i));
      boardEl.append(b);
    };
    for (let c = 0; c < 12; c++) { point(topIdx(c), c, "top"); point(botIdx(c), c, "bot"); }
    // the bar: the viewer's checkers sit in its lower half
    const bar = el("div", "bg-bar");
    [other(viewer), viewer].forEach((p, k) => {
      const half = el("button", "half " + (k ? "bot" : "top"));
      half.type = "button";
      checkers(half, S.bar[p - 1], p);
      if (act && p === cur && fromOK.has(-1)) half.classList.add("can");
      if (sel === -1 && p === cur) half.classList.add("sel");
      half.disabled = !(act && p === cur && fromOK.has(-1));
      half.setAttribute("aria-label", NAMES[p] + " bar, " + S.bar[p - 1] + " checkers");
      half.addEventListener("click", () => onBar(p));
      bar.append(half);
    });
    boardEl.append(bar);
    [other(viewer), viewer].forEach((p, k) => {
      const t = el("button", "bg-tray " + (k ? "bot" : "top"));
      t.type = "button";
      for (let n = 0; n < S.off[p - 1]; n++) t.append(el("span", "bg-ch p" + p));      // one stripe per checker borne off
      const can = act && p === cur && dests.has(-2);
      if (can) t.classList.add("dest");
      t.disabled = !can;
      t.setAttribute("aria-label", NAMES[p] + " tray, " + S.off[p - 1] + " borne off" + (can ? ", bear off here" : ""));
      t.addEventListener("click", () => onTray(p));
      boardEl.append(t);
    });

    // dice and the buttons
    diceEl.innerHTML = ""; diceOnEl.innerHTML = "";
    const shown = dice || (!act && liveDice) || null;
    if (shown) {
      if (!dice) diceEl.append(el("span", "bg-who", NAMES[cur] + " to play:"));
      const list = R.diceList(shown), pending = left.slice();
      list.forEach((d) => {
        let isUsed = false;
        if (dice) { const i = pending.indexOf(d); if (i < 0) isUsed = true; else pending.splice(i, 1); }
        diceOnEl.append(dieEl(d, isUsed));
      });
    }
    const rollKey2 = shown ? shown.join(",") + ":" + cur + ":" + turnsPlayed : "";
    if (rollKey2 && rollKey2 !== rollAnimKey) { rollAnimKey = rollKey2; tumble(); } else if (!rollKey2) rollAnimKey = "";
    const noMoves = act && dice && steps.length === 0;
    if (act && !dice && mode !== "live") {
      const b = el("button", "btn primary", "Roll"); b.type = "button"; b.addEventListener("click", roll);
      diceEl.append(b);
    }
    if (act && dice && (left.length === 0 || noMoves)) {
      const b = el("button", "btn primary", left.length === 0 ? "Done" : noMoves && taken.length === 0 ? "No move: pass" : "Done"); b.type = "button"; b.addEventListener("click", done);
      diceEl.append(b);
    }
    // the header counts checkers borne off: you (or Black) on the left
    const me = mode === "ai" ? humanIs : RED;
    scoreEl.dataset.l = mode === "ai" ? "YOU" : "BLACK"; scoreEl.dataset.r = mode === "ai" ? "BOT" : "WHITE";
    scoreEl.textContent = "A: " + S.off[me - 1] + " B: " + S.off[other(me) - 1];
    undoBtn.disabled = !act || taken.length === 0;
    infoEl.textContent = infoText();
    hintEl.textContent = !act ? "" : !dice ? (mode === "live" ? "Waiting for your dice…" : "Roll the dice to start your turn.") :
      noMoves ? (taken.length ? "No more moves: tap Done." : "You can't move with this roll: tap pass.") :
      left.length === 0 ? "All dice played: tap Done, or undo to change a move." :
      sel === null ? "Tap a checker (or the bar) to move it." : "Tap a highlighted point" + (dests.has(-2) ? " or the tray to bear off." : ".");
  }

  function infoText() {
    const p = other(cur), pd = S.pd;
    let t = "";
    if (pd[0]) t = (p === viewer && (isLinked() || mode === "ai") ? "You" : NAMES[p]) + " rolled " + pd[0] + "-" + pd[1] + (S.ps ? " and couldn't move." : ".");
    return t;
  }

  // ---------- selecting and moving ----------
  function onPoint(i) {
    if (!acting() || !dice) return;
    const steps = R.legalSteps(S, cur, left);
    if (sel !== null) {
      const hit = steps.filter((s) => s.from === sel && s.to === i);
      if (hit.length) return doStep(hit.sort((a, b) => a.die - b.die)[0]);
    }
    sel = steps.some((s) => s.from === i) && sel !== i ? i : null;
    render();
  }
  function onBar(p) {
    if (!acting() || !dice || p !== cur) return;
    if (R.legalSteps(S, cur, left).some((s) => s.from === -1)) { sel = sel === -1 ? null : -1; render(); }
  }
  function onTray(p) {
    if (!acting() || !dice || p !== cur || sel === null) return;
    const hit = R.legalSteps(S, cur, left).filter((s) => s.from === sel && s.to === -2);
    if (hit.length) doStep(hit.sort((a, b) => a.die - b.die)[0]);
  }
  function doStep(st) {
    S = R.applyStep(S, cur, st);
    taken.push(st); left = R.withoutDie(left, st.die);
    lastFrom = st.from; lastTo = st.to >= 0 ? st.to : null; sel = null;
    if (R.winnerOf(S)) { over = true; winner = cur; if (isLinked()) return done(); return finish(); }
    render();
  }
  function undoStep() {
    if (!acting() || !taken.length) return;
    taken.pop();
    S = R.clone(startS);
    left = R.diceList(dice);
    for (const st of taken) { S = R.applyStep(S, cur, st); left = R.withoutDie(left, st.die); }
    sel = null; lastFrom = lastTo = null;
    render();
  }

  // ---------- rolling ----------
  function roll() {
    if (!acting() || dice || mode === "live") return;
    dice = R.roll(Math.random); left = R.diceList(dice);
    if (isLinked()) store.set("roll", JSON.stringify({ k: rollKey, d: dice }));
    render();
  }
  let rollKey = "new";

  // ---------- ending a turn ----------
  function done() {
    if (!dice) return;
    if (isLinked()) return playLink();
    endTurnLocal();
  }
  function endTurnLocal() {
    const passed = taken.length === 0;
    S.pd = dice.slice(); S.ps = passed && R.legalSteps(startS, cur, R.diceList(dice)).length === 0 ? 1 : 0;
    S.dice = [0, 0];
    turnsPlayed++;
    cur = other(cur);
    beginTurn();
    if (mode === "ai" && cur !== humanIs) return aiTurn();
    showTurn(); render();
  }
  function beginTurn() { startS = R.clone(S); taken = []; left = []; dice = null; sel = null; }

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

  // ---------- the computer ----------
  function aiTurn() {
    thinking = true;
    Gamekit.turn(cur, "Bot thinking…", true);
    statusEl.textContent = "Bot thinking…";
    render();
    aiTimer = setTimeout(() => {
      aiTimer = null;
      dice = R.roll(Math.random); left = R.diceList(dice); S.dice = dice.slice();
      const steps = R.bestTurn(R.str(S), cur, diff, Math.random);
      render();
      playSteps(steps, 0);
    }, 700);
  }
  function playSteps(steps, k) {
    aiTimer = setTimeout(() => {
      aiTimer = null;
      if (over) return;
      if (k < steps.length) {
        const st = steps[k];
        S = R.applyStep(S, cur, st); taken.push(st); left = R.withoutDie(left, st.die);
        lastFrom = st.from; lastTo = st.to >= 0 ? st.to : null;
        if (R.winnerOf(S)) { over = true; winner = cur; thinking = false; return finish(); }
        render();
        return playSteps(steps, k + 1);
      }
      thinking = false;
      endTurnLocal();
    }, 550);
  }
  function cancelAI() { if (aiTimer !== null) { clearTimeout(aiTimer); aiTimer = null; } thinking = false; }

  function newLocal() {
    cancelAI();
    S = R.parse(R.initial());
    over = false; winner = 0; lastFrom = lastTo = null; turnsPlayed = 0;
    cur = RED;
    humanIs = sideSel.value === "2" ? WHITE : RED;
    viewer = mode === "ai" ? humanIs : RED;
    beginTurn();
    if (mode === "ai" && humanIs === WHITE) return aiTurn();
    showTurn(); render();
  }

  // ---------- 2 players over WhatsApp, and live online ----------
  // board: the 33-character string described in rules.js. Red opens. Online the server rolls (and re-rolls for a pass).
  function validateBackgammon(s) {
    const S = R.parse(s.board);
    if (!S || !(Number.isInteger(s.last) && s.last >= 0 && s.last <= 99)) return false;
    // a hand-edited link must still be a position two players could have reached: Red opens and the turns alternate, and the
    // game is over exactly when a side has borne off all 15. (The dice are rolled on the phone, so the position after a turn
    // cannot be checked against the roll.)
    if (s.resigned) return true;
    const w = R.winnerOf(S), mover = s.moveCount % 2 ? RED : WHITE;
    return s.turn !== mover && s.status === (w ? "won" : "in_progress") && s.winner === (w || null);
  }
  const shared = {
    game: "backgammon", version: 1, players: [RED, WHITE],
    label: (p) => NAMES[p],
    ui: document.getElementById("wa-ui"), statusEl: statusEl,
    validateBoard: validateBackgammon, onState: loadLink,
  };
  const link = AsyncShare.start(Object.assign({ title: "backgammon" }, shared));
  const live = typeof LiveShare === "undefined" ? null : LiveShare.start(shared);
  const activeLink = () => (mode === "live" && live ? live : link);

  function loadLink(s, canMove, info) {
    cancelAI();
    viewer = info && info.me ? info.me : RED;
    if (s) { S = R.parse(s.board); cur = s.turn; over = s.status !== "in_progress"; winner = over ? s.winner || 0 : 0; lastTo = s.last < 24 ? s.last : null; }
    else { S = R.parse(R.initial()); cur = RED; over = false; winner = 0; lastTo = null; }
    lastFrom = null;
    linkCanMove = canMove;
    beginTurn();
    liveDice = null;
    rollKey = s ? s.id + ":" + s.moveCount : "new";
    if (mode === "live") {
      // the server's roll is in the board (or, for the opening move, comes from the room id)
      liveDice = s ? (S.dice[0] ? S.dice.slice() : null) : (info && info.gameId ? R.openingDice(info.gameId) : null);
      if (canMove && !over && liveDice) { dice = liveDice.slice(); left = R.diceList(dice); }
    } else if (canMove && !over) {
      // over WhatsApp you roll your own dice; remember the roll so a refresh can't re-roll it
      try { const r = JSON.parse(store.get("roll", "null")); if (r && r.k === rollKey && Array.isArray(r.d)) { dice = r.d; left = R.diceList(dice); } } catch (e) { /* none */ }
    }
    render();
  }
  function playLink() {
    const w = R.winnerOf(S);
    const out = R.clone(S);
    out.dice = [0, 0]; out.pd = dice.slice(); out.ps = 0;
    const last = lastTo !== null ? lastTo : lastFrom !== null && lastFrom >= 0 ? lastFrom : 0;
    activeLink().commit({ board: R.str(out), status: w ? "won" : "in_progress", winner: w || null, last });
  }

  // ---------- modes and controls ----------
  function applyMode() {
    chipsEl.hidden = mode !== "ai";
    sideSel.hidden = mode !== "ai";
    resetBtn.hidden = isLinked();
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
  undoBtn.addEventListener("click", undoStep);

  const liveOpt = modeSel.querySelector('option[value="live"]');
  if (live && invited) liveOpt.hidden = false;
  else if (live) LiveShare.enable(modeSel, "backgammon");
  applyMode();

  // A refresh keeps a game against the computer or on one device, even in the middle of a turn
  // (the roll and the moves already made are saved, so a refresh can't re-roll).
  const resumer = Gamekit.resume("backgammon", () => (isLinked() || over || (!turnsPlayed && !taken.length && !dice)) ? null : {
    mode: mode, s: R.str(startS), cur: cur, human: humanIs, dice: thinking ? null : dice, taken: thinking ? [] : taken, n: turnsPlayed,
  }, (s) => {
    if (s.mode !== "ai" && s.mode !== "local") return false;
    const P = R.parse(s.s);
    if (!P || (s.cur !== 1 && s.cur !== 2) || !Array.isArray(s.taken)) return false;
    if (s.dice !== null && !(Array.isArray(s.dice) && s.dice.length === 2 && s.dice.every((d) => Number.isInteger(d) && d >= 1 && d <= 6))) return false;
    mode = s.mode; modeSel.value = mode;
    applyMode();
    cancelAI();
    humanIs = s.human === WHITE ? WHITE : RED;
    sideSel.value = humanIs === WHITE ? "2" : "1";
    viewer = mode === "ai" ? humanIs : RED;
    S = P; cur = s.cur; over = false; winner = 0; lastFrom = lastTo = null; turnsPlayed = Number(s.n) || 0;
    beginTurn();
    if (s.dice) {
      dice = s.dice.slice(); left = R.diceList(dice);
      for (const st of s.taken) {                          // replay, refusing anything that is not a legal step
        if (!R.legalSteps(S, cur, left).some((x) => x.from === st.from && x.to === st.to && x.die === st.die)) break;
        S = R.applyStep(S, cur, st); taken.push({ from: st.from, to: st.to, die: st.die }); left = R.withoutDie(left, st.die);
      }
    }
    if (mode === "ai" && cur !== humanIs) aiTurn(); else { showTurn(); render(); }
    return true;
  });
  if (!params.has("s") && !invited) resumer.restore();
  window.addEventListener("load", () => Manpage.autoOpen("backgammon"));
})();
