(function () {
  "use strict";

  const Y = globalThis.YatzyRules;
  const $ = (id) => document.getElementById(id);
  const statusEl = $("status"), scoreEl = $("score"), bestEl = $("best"), diceEl = $("dice"), rollBtn = $("roll-btn"), hintEl = $("hint"), cardEl = $("card");
  const dailyBtn = $("daily-btn"), newBtn = $("new-btn"), resetBtn = $("reset-btn");
  const store = Gamekit.storage("yatzy:");

  let game = null, seed = "", sel = null, saved = false;
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };

  const HOUSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2 12h3v8h5v-5h4v5h5v-8h3z"/></svg>';
  const LABELS = { "3k": "3x", "4k": "4x", fh: HOUSE, ss: "SM", ls: "LG", y: "YATZY", c: "?" };
  function icon(b) {
    if (LABELS[b] === undefined) {                                  // ones to sixes: the die face
      const d = el("div", "yz-ic"), on = new Set(PIPS[Number(b)]);
      for (let k = 0; k < 9; k++) d.append(el("i", on.has(k) ? "on" : ""));
      return d;
    }
    const d = el("div", "yz-ic txt" + (b === "y" ? " y" : ""));
    if (b === "fh") d.innerHTML = HOUSE; else d.textContent = LABELS[b];
    return d;
  }

  // a roll tumbles the dice that were thrown (the kept ones stay put)
  let rollAnimKey = "";
  const calm = () => !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);
  function tumble(thrown) {
    if (calm()) return;
    thrown.forEach((d, k) => {
      if (!d.animate) return;
      const spin = (k % 2 ? 1 : -1) * 360;
      d.animate([
        { transform: "translateY(-70px) rotate(0deg) scale(1.25)", opacity: 0.2 },
        { transform: "translateY(0) rotate(" + spin + "deg) scale(1)", opacity: 1, offset: 0.6 },
        { transform: "translateY(-10px) rotate(" + (spin + 12) + "deg)", offset: 0.76 },
        { transform: "translateY(0) rotate(" + spin + "deg)" },
      ], { duration: 620, delay: k * 60, easing: "cubic-bezier(.2,.8,.3,1)" });
    });
  }

  function render() {
    const g = game, card = g.card, over = Y.finished(card);
    // dice
    diceEl.innerHTML = "";
    g.dice.forEach((v, i) => {
      const b = el("button", "yz-die" + (v ? "" : " blank") + (g.held[i] ? " held" : ""));
      b.type = "button";
      if (v) { const on = new Set(PIPS[v]); for (let k = 0; k < 9; k++) b.append(el("i", on.has(k) ? "on" : "")); }
      if (g.held[i]) b.append(el("span", "tag", "kept"));
      b.disabled = !(g.roll > 0 && g.roll < 3 && !over);
      b.setAttribute("aria-label", v ? "die showing " + v + (g.held[i] ? ", kept" : "") : "die, not rolled yet");
      b.addEventListener("click", () => { Y.hold(g, i); sel = null; render(); });
      diceEl.append(b);
    });
    const key = g.turn + ":" + g.roll + ":" + g.dice.join("");
    if (g.roll > 0 && key !== rollAnimKey && !g.held.every(Boolean)) {
      const kids = [...diceEl.children];
      tumble(kids.filter((d, i) => !g.held[i]));
    }
    if (g.roll > 0) rollAnimKey = key;
    rollBtn.disabled = g.roll >= 3 || over;
    rollBtn.replaceChildren(el("span", "", over ? "Done" : g.roll === 0 ? "Roll" : g.roll === 3 ? "Pick a box" : "Roll"));
    if (!over && g.roll < 3) for (let k = 1; k <= 3; k++) rollBtn.append(el("i", k <= g.roll ? "used" : "", String(k)));   // the three rolls of a turn
    // the scorecard
    const allowed = g.roll > 0 && !over ? new Set(Y.allowed(card, g.dice)) : new Set();
    cardEl.innerHTML = "";
    const row = (b) => {
      const filled = card.boxes[b] !== null, can = allowed.has(b);
      const r = el("button", "yz-row" + (filled ? " done" : "") + (can ? " can" : "") + (sel === b ? " sel" : ""));
      r.type = "button";
      r.append(icon(b));
      const pot = can ? Y.score(b, g.dice, Y.isJoker(card, g.dice, b)) : null;
      r.append(el("span", "v" + (filled ? "" : " pot"), filled ? String(card.boxes[b]) : can ? String(pot) : "–"));
      r.disabled = !can;
      r.addEventListener("click", () => onBox(b));
      r.setAttribute("aria-label", Y.NAMES[b] + (filled ? ", " + card.boxes[b] + " points" : can ? ", would score " + pot : ", open"));
      return r;
    };
    const colU = el("div", "yz-col"), colL = el("div", "yz-col");
    Y.UPPER.forEach((b) => colU.append(row(b)));
    const up = Y.upperSum(card);
    const bl = el("div", "yz-bonus");
    bl.append(el("b", "", "Bonus"), el("span", "", "+" + Y.BONUS), el("i", "", up + "/" + Y.BONUS_AT));
    colU.append(bl);
    Y.LOWER.forEach((b) => colL.append(row(b)));
    cardEl.append(colU, colL);
    if (card.extra) { const xl = el("div", "yz-line"); xl.append(el("span", "", "Extra Yatzy bonus (" + card.extra + " × " + Y.EXTRA_YATZY + ")"), el("b", "", "+" + card.extra * Y.EXTRA_YATZY)); cardEl.append(xl); }
    const tot = el("div", "yz-total"); tot.append(el("span", "", "Total"), el("span", "", String(Y.total(card))));
    cardEl.append(tot);
    // text
    scoreEl.textContent = String(Y.total(card));
    bestEl.textContent = store.get("best", "—");
    if (over) {
      const t = Y.total(card);
      statusEl.textContent = "Game over. Final score: " + t + ".";
      if (!saved) { saved = true; const b = Number(store.get("best", 0)); if (!b || t > b) store.set("best", t); bestEl.textContent = store.get("best", "—"); resumer.clear(); }
      hintEl.textContent = "That's 13 turns. Start a new game whenever you like.";
    } else {
      statusEl.textContent = "Turn " + (g.turn + 1) + " of 13" + (g.roll ? " · roll " + g.roll + " of 3" : "");
      hintEl.textContent = g.roll === 0 ? "Roll to start your turn." : sel ? "Tap " + Y.NAMES[sel] + " again to score " + Y.score(sel, g.dice, Y.isJoker(card, g.dice, sel)) + "." : g.roll < 3 ? "Tap dice to keep them, roll again, or pick a box." : "Pick a box to score in.";
    }
  }

  function onBox(b) {
    if (sel === b) { Y.choose(game, b); sel = null; return render(); }
    sel = b; render();
  }
  rollBtn.addEventListener("click", () => { if (Y.roll(game)) { sel = null; render(); } });

  function start(s) { seed = String(s); game = Y.newGame(seed); sel = null; saved = false; render(); }
  const daily = () => "daily-" + Gamekit.dailySeed("yatzy", "daily");
  dailyBtn.addEventListener("click", () => start(daily()));
  newBtn.addEventListener("click", () => start("r" + Gamekit.randomSeed()));
  resetBtn.addEventListener("click", () => start(seed));

  // A refresh keeps the game, including the dice already rolled .
  const resumer = Gamekit.resume("yatzy", () => (!game || Y.finished(game.card) || (!game.turn && !game.roll)) ? null : { seed: game.seed, turn: game.turn, roll: game.roll, dice: game.dice, held: game.held, card: game.card }, (s) => {
    if (!s || typeof s.seed !== "string" || s.seed.length > 40 || !Number.isInteger(s.turn) || s.turn < 0 || s.turn > 12 || !Number.isInteger(s.roll) || s.roll < 0 || s.roll > 3) return false;
    if (!Array.isArray(s.dice) || s.dice.length !== 5 || !s.dice.every((d) => Number.isInteger(d) && d >= 0 && d <= 6) || !Array.isArray(s.held) || s.held.length !== 5) return false;
    if (!s.card || !s.card.boxes || !Number.isInteger(s.card.extra) || s.card.extra < 0 || s.card.extra > 12) return false;
    let filled = 0;
    for (const b of Y.BOXES) { const v = s.card.boxes[b]; if (v !== null) { if (!Number.isInteger(v) || v < 0 || v > 50) return false; filled++; } }
    if (filled !== s.turn) return false;
    if (s.roll === 0 ? s.dice.some((d) => d !== 0) : s.dice.some((d) => d < 1)) return false;
    game = Y.newGame(s.seed); game.turn = s.turn; game.roll = s.roll; game.dice = s.dice.slice(); game.held = s.held.map(Boolean);
    game.card = { boxes: Object.fromEntries(Y.BOXES.map((b) => [b, s.card.boxes[b] === undefined ? null : s.card.boxes[b]])), extra: s.card.extra };
    seed = s.seed; sel = null; saved = false; render();
    return true;
  });

  start(daily());
  resumer.restore();
  window.addEventListener("load", () => Manpage.autoOpen("yatzy"));
})();
