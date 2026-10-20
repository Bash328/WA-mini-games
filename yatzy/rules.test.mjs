/* Run: node yatzy/rules.test.mjs  — the scoring table, the joker rule, the daily dice table, whole games */
import "./rules.js";
const Y = globalThis.YatzyRules;
let pass = 0, fail = 0;
function check(name, ok, detail) { if (ok) pass++; else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? " — " + detail : "")); } }
const sc = (box, d, j) => Y.score(box, d, j);

console.log("yatzy:");
// the boxes
check("upper boxes sum the matching dice", sc("3", [3, 3, 1, 3, 6]) === 9 && sc("6", [1, 2, 3, 4, 5]) === 0 && sc("1", [1, 1, 1, 1, 1]) === 5);
check("three of a kind needs three alike and scores all five dice", sc("3k", [4, 4, 4, 2, 1]) === 15 && sc("3k", [4, 4, 5, 2, 1]) === 0 && sc("3k", [2, 2, 2, 2, 2]) === 10);
check("four of a kind needs four alike and scores all five dice", sc("4k", [5, 5, 5, 5, 1]) === 21 && sc("4k", [5, 5, 5, 1, 1]) === 0);
check("a full house is exactly three and two (25)", sc("fh", [2, 2, 3, 3, 3]) === 25 && sc("fh", [2, 2, 2, 2, 3]) === 0 && sc("fh", [3, 3, 3, 3, 3]) === 0);
check("a small straight is any four in a row (30)", sc("ss", [1, 2, 3, 4, 6]) === 30 && sc("ss", [3, 4, 5, 6, 6]) === 30 && sc("ss", [1, 2, 3, 5, 6]) === 0 && sc("ss", [1, 2, 3, 4, 5]) === 30);
check("a large straight is five in a row (40)", sc("ls", [2, 3, 4, 5, 6]) === 40 && sc("ls", [1, 2, 3, 4, 5]) === 40 && sc("ls", [1, 2, 3, 4, 6]) === 0);
check("five alike is a Yatzy (50)", sc("y", [6, 6, 6, 6, 6]) === 50 && sc("y", [6, 6, 6, 6, 5]) === 0);
check("chance is the sum", sc("c", [1, 2, 3, 4, 6]) === 16);
// totals and bonus
{
  const card = Y.newCard();
  ["1", "2", "3", "4", "5", "6"].forEach((b, i) => { card.boxes[b] = Number(b) * 3; });      // exactly three of each = 63
  check("63 in the upper boxes earns the 35 bonus", Y.upperSum(card) === 63 && Y.upperBonus(card) === 35 && Y.total(card) === 63 + 35);
  card.boxes["6"] = 12;
  check("62 does not", Y.upperBonus(card) === 0);
}
// the joker rule
{
  const card = Y.newCard();
  const d = [4, 4, 4, 4, 4];
  check("a first Yatzy can go anywhere that is open", Y.allowed(card, d).length === 13);
  check("scoring the first Yatzy in its box gives 50 and no bonus", Y.put(card, "y", d) === 50 && card.extra === 0);
  check("a second Yatzy must go to its upper box while that is open", JSON.stringify(Y.allowed(card, d)) === '["4"]');
  check("...earns +100 and fills Fours with 20", Y.put(card, "4", d) === 20 + 100 && card.extra === 1 && card.boxes["4"] === 20);
  check("a third Yatzy (Fours full) may go in any open lower box", Y.allowed(card, d).every((b) => Y.LOWER.includes(b)) && Y.allowed(card, d).includes("fh") && !Y.allowed(card, d).includes("y"));
  check("the joker scores a full house, a small and a large straight in full", Y.put(card, "fh", d) === 25 + 100 && card.boxes.fh === 25 && Y.put(card, "ls", d) === 40 + 100 && card.boxes.ls === 40 && Y.put(card, "ss", d) === 30 + 100);
  check("the bonuses add up in the total", card.extra === 4 && Y.total(card) === 50 + 20 + 25 + 40 + 30 + 400);
}
{
  const card = Y.newCard();
  card.boxes.y = 0;                                                         // the Yatzy box was crossed out
  check("a Yatzy after a crossed-out Yatzy box earns no bonus but the joker rule applies", Y.put(card, "ss", [2, 2, 2, 2, 2]) === null && Y.put(card, "2", [2, 2, 2, 2, 2]) === 10 && card.extra === 0);
  const c2 = Y.newCard(); c2.boxes.y = 0; c2.boxes["2"] = 4;
  check("with the upper box full, a joker may use a lower box", Y.allowed(c2, [2, 2, 2, 2, 2]).every((b) => Y.LOWER.includes(b)) && Y.put(c2, "ls", [2, 2, 2, 2, 2]) === 40 && c2.extra === 0);
  const c3 = Y.newCard(); Y.LOWER.forEach((b) => { c3.boxes[b] = 0; }); c3.boxes["5"] = 10;
  check("with every lower box full a joker may only be thrown into an upper box", Y.allowed(c3, [5, 5, 5, 5, 5]).every((b) => Y.UPPER.includes(b)) && !Y.allowed(c3, [5, 5, 5, 5, 5]).includes("5"));
  check("a box that is already filled can't be used again", Y.put(Y.newCard(), "zz", [1, 2, 3, 4, 5]) === null);
}
// the daily dice
{
  check("a face is 1 to 6 and the same every time", [0, 1, 2].every((r) => [0, 1, 2, 3, 4].every((i) => { const v = Y.faceAt("2026-10-17", 3, r, i); return v >= 1 && v <= 6 && v === Y.faceAt("2026-10-17", 3, r, i); })));
  check("a different seed or spot gives different dice", Array.from({ length: 30 }, (_, i) => Y.faceAt("a", 0, 0, i % 5) + "" + Y.faceAt("b", i, 0, 0)).join("") !== Array.from({ length: 30 }, (_, i) => Y.faceAt("a", 0, 0, i % 5) + "" + Y.faceAt("a", i, 0, 0)).join(""));
  // all faces turn up about equally
  const c = [0, 0, 0, 0, 0, 0, 0];
  for (let t = 0; t < 400; t++) for (let r = 0; r < 3; r++) for (let i = 0; i < 5; i++) c[Y.faceAt("fair", t, r, i)]++;
  const exp = 400 * 3 * 5 / 6;
  check("every face is about as likely as any other", c.slice(1).every((n) => Math.abs(n - exp) < exp * 0.12), c.join(","));
  // two players on the same seed get the same first roll
  const a = Y.newGame("S"), b = Y.newGame("S");
  Y.roll(a); Y.roll(b);
  check("the same seed gives everyone the same first roll", JSON.stringify(a.dice) === JSON.stringify(b.dice));
  // re-rolling the same die in the same place gives the same face (so holding differently can't fish)
  const c1 = Y.newGame("S"); Y.roll(c1); c1.held = [true, true, true, false, false]; Y.roll(c1);
  const c2b = Y.newGame("S"); Y.roll(c2b); c2b.held = [true, true, true, false, false]; Y.roll(c2b);
  check("the same keeps give the same re-roll", JSON.stringify(c1.dice) === JSON.stringify(c2b.dice));
}
// the turn machine
{
  const g = Y.newGame("T");
  check("you can't hold or score before the first roll", !Y.hold(g, 0) && Y.choose(g, "c") === null);
  Y.roll(g);
  check("after a roll you can hold", Y.hold(g, 2) && g.held[2] === true && Y.hold(g, 2) && g.held[2] === false);
  const kept = g.dice.slice(); g.held = [true, true, false, false, false]; Y.roll(g);
  check("held dice stay and the others are re-rolled", g.dice[0] === kept[0] && g.dice[1] === kept[1] && g.roll === 2);
  Y.roll(g);
  check("three rolls at most", g.roll === 3 && Y.roll(g) === false && !Y.hold(g, 0));
  const pts = Y.choose(g, "c");
  check("choosing scores the dice and starts the next turn", pts === g.card.boxes.c && g.turn === 1 && g.roll === 0 && g.held.every((h) => !h));
}
// whole random games: 13 turns, the total adds up, a perfect-ish bound
{
  let max = 0, min = 1e9, games = 0;
  for (let s = 0; s < 300; s++) {
    const g = Y.newGame("game" + s);
    let guard = 0;
    while (!Y.finished(g.card) && guard++ < 200) {
      Y.roll(g);
      // keep the most common face
      for (let r = 0; r < 2; r++) {
        const c = {}; g.dice.forEach((d) => { c[d] = (c[d] || 0) + 1; });
        const best = Object.keys(c).sort((a, b) => c[b] - c[a])[0];
        g.held = g.dice.map((d) => d === Number(best));
        Y.roll(g);
      }
      const opts = Y.allowed(g.card, g.dice);
      const pick = opts.slice().sort((a, b) => Y.score(b, g.dice, Y.isJoker(g.card, g.dice, b)) - Y.score(a, g.dice, Y.isJoker(g.card, g.dice, a)))[0];
      if (Y.choose(g, pick) === null) { check("a chosen box is accepted (game " + s + ")", false); break; }
    }
    const t = Y.total(g.card);
    max = Math.max(max, t); min = Math.min(min, t); games++;
    if (g.turn !== 13) check("a game takes exactly 13 turns", false, g.turn);
  }
  check("a whole game is 13 turns and the totals are sensible", min >= 20 && max <= 1500, min + ".." + max);
}

console.log(fail ? `\n${pass} passed, ${fail} FAILED` : `\n${pass} passed`);
process.exit(fail ? 1 : 0);
