/* ============================================================
   yatzy/rules.js — the rules of Yatzy (Yahtzee scoring), written once.

   A plain script that sets globalThis.YatzyRules (the page loads it with a
   <script> tag, the test imports it for the same effect).

   13 turns. Each turn: roll five dice, then up to two more times keep any dice
   and re-roll the rest, then write the result in one of 13 boxes you haven't
   used yet (a box you can't fill is crossed out for 0).
     upper   Ones to Sixes: the sum of the dice showing that number.
             63 or more in the upper boxes earns a 35 bonus.
     lower   3 of a kind (sum of all dice), 4 of a kind (sum of all dice),
             Full house (3 + 2) 25, Small straight (four in a row) 30,
             Large straight (five in a row) 40, Yatzy (five alike) 50, Chance (sum).
   A second Yatzy, when the Yatzy box already holds 50, earns +100 and may be used as a
   JOKER: it must go in its upper box if that is open; otherwise in any open lower box
   (a full house or straight then scores in full); otherwise in any open upper box (0).

   THE DAILY GAME: the dice are not a stream but a table: die number i of roll r of
   turn t is a pure function of the seed, so everyone playing the same seed is offered
   the very same dice, and re-rolling the same die in the same spot always gives the
   same face. Nothing here reads the clock.
   ============================================================ */
(function (g) {
  "use strict";

  const BOXES = ["1", "2", "3", "4", "5", "6", "3k", "4k", "fh", "ss", "ls", "y", "c"];
  const NAMES = { 1: "Ones", 2: "Twos", 3: "Threes", 4: "Fours", 5: "Fives", 6: "Sixes", "3k": "Three of a kind", "4k": "Four of a kind", fh: "Full house", ss: "Small straight", ls: "Large straight", y: "Yatzy", c: "Chance" };
  const UPPER = ["1", "2", "3", "4", "5", "6"], LOWER = ["3k", "4k", "fh", "ss", "ls", "y", "c"];
  const BONUS_AT = 63, BONUS = 35, YATZY = 50, EXTRA_YATZY = 100;

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hashStr(s) {
    let h = 2166136261 >>> 0;
    s = String(s);
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  // die `i` (0..4) of roll `r` (0..2) of turn `t` (0..12) for this seed
  const faceAt = (seed, t, r, i) => 1 + Math.floor(mulberry32(hashStr(seed + ":" + t + ":" + r + ":" + i))() * 6);

  const sum = (d) => d.reduce((a, b) => a + b, 0);
  const counts = (d) => { const c = [0, 0, 0, 0, 0, 0, 0]; d.forEach((x) => c[x]++); return c; };
  const isYatzy = (d) => d.every((x) => x === d[0]);
  function hasRun(d, n) {
    const have = new Set(d);
    for (let s = 1; s + n - 1 <= 6; s++) { let ok = true; for (let k = 0; k < n; k++) if (!have.has(s + k)) { ok = false; break; } if (ok) return true; }
    return false;
  }
  // the plain score of the dice in a box; joker: the box scores as if the dice fitted it (a second Yatzy)
  function score(box, d, joker) {
    const c = counts(d), max = Math.max(...c.slice(1));
    switch (box) {
      case "1": case "2": case "3": case "4": case "5": case "6": return Number(box) * c[Number(box)];
      case "3k": return max >= 3 ? sum(d) : 0;
      case "4k": return max >= 4 ? sum(d) : 0;
      case "fh": return joker || (c.includes(3) && c.includes(2)) ? 25 : 0;
      case "ss": return joker || hasRun(d, 4) ? 30 : 0;
      case "ls": return joker || hasRun(d, 5) ? 40 : 0;
      case "y": return isYatzy(d) ? YATZY : 0;
      case "c": return sum(d);
      default: return 0;
    }
  }

  // a card: box -> score or null (still open); `extra`: Yatzy bonuses earned so far
  const newCard = () => ({ boxes: Object.fromEntries(BOXES.map((b) => [b, null])), extra: 0 });
  const open = (card) => BOXES.filter((b) => card.boxes[b] === null);

  // which boxes may these dice go in (the joker rule narrows it after a repeat Yatzy)
  function allowed(card, d) {
    const o = open(card);
    if (!isYatzy(d) || card.boxes.y === null) return o;                    // not a repeat Yatzy
    const upper = String(d[0]);
    if (card.boxes[upper] === null) return [upper];
    const lower = o.filter((b) => LOWER.includes(b));
    return lower.length ? lower : o;
  }
  const isJoker = (card, d, box) => isYatzy(d) && card.boxes.y !== null && LOWER.includes(box) && card.boxes[String(d[0])] !== null;

  // write the dice into a box: returns the points it earned (bonus included)
  function put(card, box, d) {
    if (!allowed(card, d).includes(box)) return null;
    const bonus = isYatzy(d) && card.boxes.y === YATZY ? EXTRA_YATZY : 0;
    const pts = score(box, d, isJoker(card, d, box));
    card.boxes[box] = pts;
    if (bonus) card.extra += 1;
    return pts + bonus;
  }
  const upperSum = (card) => UPPER.reduce((a, b) => a + (card.boxes[b] || 0), 0);
  const upperBonus = (card) => (upperSum(card) >= BONUS_AT ? BONUS : 0);
  const total = (card) => BOXES.reduce((a, b) => a + (card.boxes[b] || 0), 0) + upperBonus(card) + card.extra * EXTRA_YATZY;
  const finished = (card) => open(card).length === 0;

  // ---------- a game: the seed, the turn, the dice ----------
  // game = { seed, turn: 0..13, roll: 0..3 (rolls made this turn), dice: [5], held: [5 bool], card }
  function newGame(seed) { return { seed: String(seed), turn: 0, roll: 0, dice: [0, 0, 0, 0, 0], held: [false, false, false, false, false], card: newCard() }; }
  function roll(game) {
    if (game.roll >= 3 || finished(game.card)) return false;
    const r = game.roll;
    game.dice = game.dice.map((d, i) => (r === 0 || !game.held[i] ? faceAt(game.seed, game.turn, r, i) : d));
    game.roll++;
    return true;
  }
  function hold(game, i) { if (game.roll > 0 && game.roll < 3 && i >= 0 && i < 5) { game.held[i] = !game.held[i]; return true; } return false; }
  // score the current dice in a box and move to the next turn; returns the points or null if not allowed
  function choose(game, box) {
    if (game.roll === 0) return null;
    const pts = put(game.card, box, game.dice);
    if (pts === null) return null;
    game.turn++; game.roll = 0; game.dice = [0, 0, 0, 0, 0]; game.held = [false, false, false, false, false];
    return pts;
  }

  g.YatzyRules = {
    BOXES, NAMES, UPPER, LOWER, BONUS_AT, BONUS, YATZY, EXTRA_YATZY,
    faceAt, score, newCard, open, allowed, isJoker, put, upperSum, upperBonus, total, finished, newGame, roll, hold, choose, isYatzy, hashStr, mulberry32,
  };
})(globalThis);
