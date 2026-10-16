(function () {
  "use strict";

  const GOAL = 100;
  const P1 = 1, P2 = 2;
  const other = (p) => (p === P1 ? P2 : P1);

  const statusEl = document.getElementById("status");
  const scoreEl = document.getElementById("pig-score");
  const dieEl = document.getElementById("pig-die");
  const turnEl = document.getElementById("pig-turn");
  const lastEl = document.getElementById("pig-last");
  const rollBtn = document.getElementById("roll-btn");
  const holdBtn = document.getElementById("hold-btn");
  const resetBtn = document.getElementById("reset-btn");
  const chipsEl = document.getElementById("chips");
  const modeSel = document.getElementById("mode");
  const store = Gamekit.storage("pig:");

  let diff = store.get("diff", "medium");
  if (!["easy", "medium", "hard"].includes(diff)) diff = "medium";
  let mode = store.get("mode", "whatsapp");
  if (!["whatsapp", "ai", "local"].includes(mode)) mode = "whatsapp";
  if (new URLSearchParams(location.search).has("s")) mode = "whatsapp";
  modeSel.value = mode;
  const isLinked = () => mode === "whatsapp";

  // ---------- the game ----------
  let score = { [P1]: 0, [P2]: 0 };
  let current = P1;
  let turnTotal = 0, rolls = [];          // this turn so far
  let over = false, winner = null;
  let canAct = false;                     // can the person at the screen roll or hold right now?
  let busy = false;                       // a roll is animating, or the computer is playing
  let timer = null;
  let lastNote = "";                      // what the previous turn did
  let lastFace = 0;
  const humanIs = P1;                     // against the computer you are Player 1

  const reduceMotion = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const nameOf = (p) => (mode === "ai" ? (p === humanIs ? "You" : "Computer") : "Player " + p);

  // Pip positions on a 3x3 grid, per face.
  const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
  function dieSvg(n) {
    let pips = "";
    (PIPS[n] || []).forEach((k) => {
      pips += '<circle cx="' + (26 + (k % 3) * 24) + '" cy="' + (26 + Math.floor(k / 3) * 24) + '" r="7.5"' + (n === 1 ? ' class="one"' : "") + "/>";
    });
    return '<svg viewBox="0 0 100 100" role="img" aria-label="' + (n ? "Die showing " + n : "Die") + '"><rect x="4" y="4" width="92" height="92" rx="18"/>' + pips + "</svg>";
  }

  function render() {
    const cards = [P1, P2].map((p) =>
      '<div class="pig-card' + (p === current && !over ? " on" : "") + (over && p === winner ? " won" : "") + '">' +
      '<span class="pig-name">' + nameOf(p) + '</span><span class="pig-num">' + score[p] + "</span>" +
      '<span class="pig-bar"><i style="width:' + Math.min(100, score[p]) + '%"></i></span></div>').join("");
    scoreEl.innerHTML = cards;
    dieEl.innerHTML = dieSvg(lastFace);
    dieEl.classList.toggle("bust", lastFace === 1 && rolls.length > 0 && rolls[rolls.length - 1] === 1);
    turnEl.innerHTML = over ? "" :
      '<span class="pig-t">' + nameOf(current) + (mode === "ai" && current !== humanIs ? " is playing" : "") + " · this turn:</span> <b>" + turnTotal + "</b>" +
      (rolls.length ? '<span class="pig-rolls">' + rolls.map((r) => '<i class="' + (r === 1 ? "one" : "") + '">' + r + "</i>").join("") + "</span>" : "");
    lastEl.textContent = lastNote;
    const bank = score[current] + turnTotal >= GOAL ? "Hold and win!" : "Hold · bank " + turnTotal;
    holdBtn.textContent = bank;
    const act = canAct && !over && !busy;
    rollBtn.disabled = !act;
    holdBtn.disabled = !act || turnTotal === 0;
  }

  function rollDie() { return 1 + Math.floor(Math.random() * 6); }

  // Shows a few tumbling faces, then the real one.
  function tumble(final, done) {
    busy = true;
    render();
    if (reduceMotion) { lastFace = final; busy = false; return done(); }
    let n = 0;
    (function frame() {
      if (n++ < 4) { lastFace = 1 + Math.floor(Math.random() * 6); dieEl.innerHTML = dieSvg(lastFace); timer = setTimeout(frame, 70); }
      else { timer = null; lastFace = final; busy = false; done(); }
    })();
  }

  function describeTurn(p, rs, banked) {
    const list = rs.join(", ");
    if (!rs.length) return "";
    return rs[rs.length - 1] === 1 && banked === 0
      ? nameOf(p) + " rolled " + list + ": a 1, so that turn's points are lost."
      : nameOf(p) + " rolled " + list + " and held for +" + banked + ".";
  }

  // The player at the screen presses Roll.
  function doRoll() {
    if (!canAct || over || busy) return;
    const r = rollDie();
    tumble(r, () => {
      rolls.push(r);
      if (r === 1) endTurn(0);
      else { turnTotal += r; render(); afterStep(); }
    });
  }
  function doHold() {
    if (!canAct || over || busy || turnTotal === 0) return;
    endTurn(turnTotal);
  }

  // Ends the current turn with `banked` points (0 after a 1).
  function endTurn(banked) {
    const p = current, rs = rolls.slice();
    score[p] += banked;
    lastNote = describeTurn(p, rs, banked);
    const won = score[p] >= GOAL;
    if (isLinked()) return commitLink(p, rs, banked, won);
    turnTotal = 0; rolls = [];
    if (won) { over = true; winner = p; return finish(); }
    current = other(p);
    startTurn();
  }

  function startTurn() {
    turnTotal = 0; rolls = [];
    if (mode === "ai" && current !== humanIs) {
      canAct = false;
      Gamekit.turn(current, "Computer is playing…", true);
      statusEl.textContent = "Computer is playing…";
      render();
      timer = setTimeout(aiStep, 700);
      return;
    }
    canAct = true;
    showTurn();
    render();
  }
  function showTurn() {
    if (mode === "ai") { Gamekit.turn(humanIs, "Your turn"); statusEl.textContent = "Your turn."; }
    else { Gamekit.turn(current, nameOf(current) + "'s turn"); statusEl.textContent = nameOf(current) + "'s turn."; }
  }
  function afterStep() { if (mode === "ai" && current !== humanIs) timer = setTimeout(aiStep, 650); }

  // ---------- the computer ----------
  // Roll until the turn total reaches a target, then hold. Easy holds early,
  // medium at the classic 20, and hard adjusts to the scoreboard: it hangs on
  // longer when it's behind or the opponent is close to winning, and banks
  // sooner when well ahead.
  function holdAt(me, them) {
    if (diff === "easy") return 12;
    if (diff === "medium") return 20;
    let t = 25;
    if (them >= 71) t = 40;                       // they are about to win: be bold
    else if (me >= them + 25) t = 15;              // comfortably ahead: play safe
    else if (me >= 71) t = 30;
    return t;
  }
  function aiStep() {
    timer = null;
    if (over) return;
    const me = score[current], them = score[other(current)];
    if (turnTotal > 0 && (me + turnTotal >= GOAL || turnTotal >= holdAt(me, them))) return endTurn(turnTotal);
    const r = rollDie();
    tumble(r, () => {
      rolls.push(r);
      if (r === 1) return endTurn(0);
      turnTotal += r;
      render();
      timer = setTimeout(aiStep, 650);
    });
  }

  function finish() {
    clearTimeout(timer); timer = null;
    canAct = false; busy = false;
    Gamekit.turn(null);
    if (mode === "ai") statusEl.textContent = winner === humanIs ? "You win! 🎉 " + Gamekit.taunt("win") : "Computer wins. " + Gamekit.taunt("loss");
    else statusEl.textContent = `${nameOf(winner)} wins. ${nameOf(other(winner))} — ${Gamekit.taunt("loss")}`;
    render();
  }

  function newLocal() {
    clearTimeout(timer); timer = null; busy = false;
    score = { [P1]: 0, [P2]: 0 };
    current = P1; over = false; winner = null; lastNote = ""; lastFace = 0;
    startTurn();
  }

  // ---------- 2 players over WhatsApp ----------
  // board: "<player 1 score>.<player 2 score>.<this turn's rolls>", for example
  // "34.12.3561": the scores after the turn, then every die the player who
  // just moved rolled (a trailing 1 means the turn was lost). The rolls only
  // let the opponent see what happened; the scores are the game. As with
  // Minesweeper's mines, the roller's browser makes the rolls: a link can be
  // edited by someone determined, so Pig over WhatsApp runs on trust.
  const BOARD_RE = /^(\d{1,3})\.(\d{1,3})\.([1-6]{0,80})$/;
  function validatePig(s) {
    const m = BOARD_RE.exec(String(s.board));
    if (!m) return false;
    return Number.isInteger(s.last) && s.last >= 0 && s.last <= 600;
  }
  const link = AsyncShare.start({
    game: "pig", version: 1, title: "pig", players: [P1, P2],
    label: (p) => "Player " + p,
    ui: document.getElementById("wa-ui"), statusEl: statusEl,
    validateBoard: validatePig, onState: loadLink,
    detail: (s) => { const m = BOARD_RE.exec(s.board); return "Final score: Player 1 " + m[1] + " · Player 2 " + m[2] + "."; },
  });

  function loadLink(s, canMove) {
    clearTimeout(timer); timer = null; busy = false;
    if (s) {
      const m = BOARD_RE.exec(s.board);
      score = { [P1]: +m[1], [P2]: +m[2] };
      current = s.turn;
      const mover = other(s.turn);               // who just moved
      const rs = m[3].split("").map(Number);
      lastNote = s.resigned ? "" : describeTurn(mover, rs, s.last);
      rolls = []; turnTotal = 0;
      lastFace = rs.length ? rs[rs.length - 1] : 0;
      over = s.status !== "in_progress";
      winner = over && s.status === "won" ? s.winner : null;
    } else {
      score = { [P1]: 0, [P2]: 0 }; current = P1; lastNote = ""; lastFace = 0;
      rolls = []; turnTotal = 0; over = false; winner = null;
    }
    canAct = canMove && !over;
    render();
  }

  function commitLink(p, rs, banked, won) {
    canAct = false;
    link.commit({
      board: score[P1] + "." + score[P2] + "." + rs.join(""),
      status: won ? "won" : "in_progress",
      winner: won ? p : null,
      last: banked,
    });
  }

  // ---------- modes and controls ----------
  function applyMode() {
    chipsEl.hidden = mode !== "ai";
    resetBtn.hidden = isLinked();
    if (mode === "whatsapp") link.show();
    else { link.hide(); newLocal(); }
  }
  const chips = Gamekit.wireDifficultyChips({
    el: chipsEl, difficulties: ["easy", "medium", "hard"], initial: diff, storage: store, storageKey: "diff",
    onChange: (d) => { diff = d; if (mode === "ai") newLocal(); },
  });
  diff = chips.get();

  modeSel.addEventListener("change", () => { mode = modeSel.value; store.set("mode", mode); applyMode(); });
  resetBtn.addEventListener("click", () => (isLinked() ? link.newGame() : newLocal()));
  rollBtn.addEventListener("click", doRoll);
  holdBtn.addEventListener("click", doHold);
  applyMode();

  // A refresh keeps a game against the computer or on one device.
  const resumer = Gamekit.resume("pig", () => (isLinked() || over || (score[P1] + score[P2] + turnTotal) === 0) ? null : {
    mode: mode, s: score, cur: current, tt: turnTotal, rs: rolls, diff: diff,
  }, (s) => {
    if (s.mode !== "ai" && s.mode !== "local") return false;
    if (!s.s || ![P1, P2].every((p) => Number.isInteger(s.s[p]) && s.s[p] >= 0 && s.s[p] < GOAL)) return false;
    if (s.cur !== P1 && s.cur !== P2) return false;
    if (!Number.isInteger(s.tt) || s.tt < 0 || !Array.isArray(s.rs) || !s.rs.every((r) => Number.isInteger(r) && r >= 1 && r <= 6)) return false;
    mode = s.mode; modeSel.value = mode;
    if (["easy", "medium", "hard"].includes(s.diff)) { diff = s.diff; chips.show(diff); }
    applyMode();
    clearTimeout(timer); timer = null; busy = false;
    score = { [P1]: s.s[P1], [P2]: s.s[P2] };
    current = s.cur; turnTotal = s.tt; rolls = s.rs.slice(); over = false; winner = null;
    lastFace = rolls.length ? rolls[rolls.length - 1] : 0;
    if (mode === "ai" && current !== humanIs) { canAct = false; Gamekit.turn(current, "Computer is playing…", true); render(); timer = setTimeout(aiStep, 700); }
    else { canAct = true; showTurn(); render(); }
    return true;
  });
  if (!new URLSearchParams(location.search).has("s")) resumer.restore();
  window.addEventListener("load", () => Manpage.autoOpen("pig"));

  window.__pigTest = { holdAt, dieSvg };
})();
