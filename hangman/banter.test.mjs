// Checks for hangman/banter.js. Run: node hangman/banter.test.mjs
//
// Fails on: an empty pool, a duplicate line within or across pools, an
// over-long line, an emoji, a picker that repeats itself back to back, or a
// reaction that contradicts the state (a hint that was never shown, a final
// miss that begs instead of using the last-chance line, a solved word that
// still gets a taunt).
import { readFileSync } from "node:fs";
import vm from "node:vm";

const win = {};
const math = { random: () => 0, floor: Math.floor };
vm.runInNewContext(readFileSync(new URL("./banter.js", import.meta.url), "utf8"), { window: win, Math: math });
const B = win.HangmanBanter;

const problems = [];
const MAX_LEN = 92;
const seen = new Map();
const checkPool = (name, lines) => {
  if (!Array.isArray(lines) || !lines.length) return problems.push(`${name}: empty`);
  if (new Set(lines).size !== lines.length) problems.push(`${name}: duplicate line`);
  for (const line of lines) {
    if (typeof line !== "string" || !line.trim()) { problems.push(`${name}: empty line`); continue; }
    if (line.length > MAX_LEN) problems.push(`${name}: too long (${line.length}): ${line}`);
    if (/[\u{1F300}-\u{1FAFF}]/u.test(line)) problems.push(`${name}: emoji: ${line}`);
    if (seen.has(line)) problems.push(`"${line}" is in ${seen.get(line)} and ${name}`);
    else seen.set(line, name);
  }
};

let poolCount = 0;
for (const [name, pool] of Object.entries(B.pools)) {
  if (Array.isArray(pool)) { checkPool(name, pool); poolCount++; }
  else for (const [shape, lines] of Object.entries(pool)) { checkPool(`${name}.${shape}`, lines); poolCount++; }
}

const EXPECTED = ["FIRST_MISS", "BEGS", "BEGS_LAST", "MANY_WRONG", "VOWEL_NUDGE", "VOWEL_PAYOFF",
  "VOWEL_WRONG", "NO_VOWELS", "COMEBACK", "FIRST_HIT", "DOUBLE", "STREAK", "ALL_VOWELS", "NEARLY",
  "ONE_LEFT", "LAST_LIFE_SURPRISE", "LAST_LIFE_PRAISE", "RELIEF", "DANGER", "LAST_CHANCE",
  "SHORT_LAST_CHANCE", "LONG_LAST_CHANCE", "LOSS", "SHORT_LOSS", "LONG_LOSS", "ALMOST_LOSS", "SAVED",
  "SAVED_BARELY", "SAVED_INTACT",
  "IDLE", "POKE", "POKE_SCARED", "SAVED_STREAK", "SAVED_BEST", "SAVED_RETURN", "LOSS_BACK",
  "SETTER_RETURN_SELF", "SETTER_RETURN_HANDOFF",
  "SETTER_FIRST_SELF_SHORT", "SETTER_FIRST_SELF_MID", "SETTER_FIRST_SELF_LONG",
  "SETTER_FIRST_HANDOFF_SHORT", "SETTER_FIRST_HANDOFF_MID", "SETTER_FIRST_HANDOFF_LONG",
  "SETTER_SELF", "SETTER_HANDOFF"];
for (const name of EXPECTED) if (!B.pools[name]) problems.push(`missing pool ${name}`);

// Every line carries a known expression, and the expression follows the words
// (a praise line can never be delivered by a shaking, terrified face).
for (const line of seen.keys()) {
  const face = B.faceOf(line);
  if (!B.faces.includes(face)) problems.push(`"${line}" has no known face (${face})`);
}
for (const [pool, face] of [["FIRST_MISS", "shocked"], ["BEGS", "pleading"], ["LAST_LIFE_PRAISE", "proud"],
  ["IDLE", "deadpan"], ["POKE", "annoyed"], ["POKE_SCARED", "nervous"], ["SAVED", "saved"]]) {
  const line = Array.isArray(B.pools[pool]) ? B.pools[pool][0] : B.pools[pool][Object.keys(B.pools[pool])[0]][0];
  if (B.faceOf(line) !== face) problems.push(`${pool} should use the ${face} face`);
}

const bit = (ch) => 1 << (ch.charCodeAt(0) - 65);
const mask = (...letters) => letters.reduce((m, ch) => m | bit(ch), 0);
const from = (pool, line) => pool.includes(line);
const react = (st, word, guessed, ch) => B.react(st, word, mask(...guessed), ch);

math.random = () => 0;

// The first miss is always the head/rope line, and it always begs.
let st = B.newState();
let r = react(st, "CAT", ["Z"], "Z");
if (!r || !r.beg || !from(B.pools.FIRST_MISS, r.text)) problems.push("first miss is not a FIRST_MISS beg");

// A normal miss still begs with random forced low.
r = react(B.newState(), "CAT", ["Z", "X"], "X");
if (!r || !r.beg || !from(B.pools.BEGS, r.text)) problems.push("second miss is not a BEGS beg");

// A beg replacing a planned nudge must not leave the hint pending.
st = B.newState();
r = react(st, "PLANET", ["Z", "X", "Q"], "Q");
if (!r || !r.beg) problems.push("third miss should be a beg with random forced low");
if (st.nudge !== null) problems.push("a beg left a nudge pending that the player never saw");

// The final miss uses the last-chance line instead of being swallowed by a beg.
st = B.newState();
r = react(st, "CAT", ["Z", "X", "Q", "J", "V"], "V");
if (!r) problems.push("final miss said nothing");
else {
  if (r.beg) problems.push("final miss begs instead of using the last-chance line");
  if (!from([...B.pools.LAST_CHANCE, ...B.pools.SHORT_LAST_CHANCE], r.text)) problems.push("final miss is not a last-chance line");
}

// A first correct letter gets its own reaction.
r = react(B.newState(), "PLANET", ["P"], "P");
if (!r || !from(B.pools.FIRST_HIT, r.text)) problems.push("first correct letter has no FIRST_HIT line");

// All vowels revealed earns the one-time ALL_VOWELS line.
st = B.newState();
r = react(st, "AUDIOS", ["A", "U", "D", "I", "O"], "O");
if (!r || !from(B.pools.ALL_VOWELS, r.text)) problems.push("all vowels revealed has no ALL_VOWELS line");
if (!st.toldVowels) problems.push("ALL_VOWELS was shown but not marked as said");

// One blank left earns the ONE_LEFT line (vowels already dealt with).
st = B.newState(); st.toldVowels = true;
r = react(st, "PLANET", ["P", "L", "A", "E", "N"], "N");
if (!r || !from(B.pools.ONE_LEFT, r.text)) problems.push("one blank left has no ONE_LEFT line");

// A vowel guessed in a word with no vowels gets the no-vowels hint.
r = react(B.newState(), "RHYTHM", ["Z", "X", "A"], "A");
if (!r || !from(B.pools.NO_VOWELS, r.text)) problems.push("vowel guessed in a vowel-less word has no NO_VOWELS line");

// A solved word never gets a mid-game line.
if (B.react(B.newState(), "CAT", mask("C", "A", "T"), "T") !== "") problems.push("a solved word still got a mid-game line");

// Setter lines match the word's shape and the mode once the first game is over.
for (const [word, shape] of [["CAT", "short"], ["PLANET", "mid"], ["ELEPHANT", "long"]]) {
  for (const [mode, table] of [["self", B.pools.SETTER_SELF], ["handoff", B.pools.SETTER_HANDOFF]]) {
    B.resetRecent();
    math.random = () => 0.9;
    const line = B.setterLine(word, mode, { games: 1 });
    if (!from(table[shape], line)) problems.push(`setterLine(${word}, ${mode}) is not a ${shape} line`);
  }
}

// The first game introduces Splinter and still respects the word's shape.
for (const [word, shape] of [["CAT", "SHORT"], ["PLANET", "MID"], ["ELEPHANT", "LONG"]]) {
  for (const [mode, side] of [["self", "SELF"], ["handoff", "HANDOFF"]]) {
    B.resetRecent();
    math.random = () => 0;
    const line = B.setterLine(word, mode, { games: 0 });
    if (!from(B.pools[`SETTER_FIRST_${side}_${shape}`], line)) {
      problems.push(`first-game setterLine(${word}, ${mode}) is not a ${shape} line`);
    }
  }
}

// Returning players get a returning line, not the shape line.
for (const [mode, pool] of [["self", B.pools.SETTER_RETURN_SELF], ["handoff", B.pools.SETTER_RETURN_HANDOFF]]) {
  B.resetRecent();
  math.random = () => 0;
  if (!from(pool, B.setterLine("CAT", mode, { games: 2 }))) {
    problems.push(`setterLine(${mode}) did not use the returning-player pool`);
  }
}

// A save at either extreme gets its own kind of line.
math.random = () => 0;
if (!from(B.pools.SAVED_INTACT, B.savedLine({ games: 3, streak: 2 }, 0))) {
  problems.push("a flawless save did not use SAVED_INTACT");
}
if (!from(B.pools.SAVED_BARELY, B.savedLine({ games: 3, streak: 2 }, 5))) {
  problems.push("a last-life save did not use SAVED_BARELY");
}
// Memory-aware endings: a save streak and a repeat loss.
math.random = () => 0;
if (!from(B.pools.SAVED_STREAK, B.savedLine({ games: 4, streak: 3, best: 5 }))) {
  problems.push("savedLine did not use SAVED_STREAK at three in a row");
}
if (!from(B.pools.SAVED_BEST, B.savedLine({ games: 4, streak: 3, best: 3 }))) {
  problems.push("savedLine did not use SAVED_BEST at a personal best");
}
if (!from(B.pools.SAVED_RETURN, B.savedLine({ games: 4, streak: 2 }))) {
  problems.push("savedLine did not use SAVED_RETURN for a returning player");
}
if (!from(B.pools.LOSS_BACK, B.lossTaunt("CAT", 0, { games: 4, losses: 3 }))) {
  problems.push("lossTaunt did not use LOSS_BACK for a repeat loser");
}
if (!from(B.pools.IDLE, B.idleLine())) problems.push("idleLine is not an IDLE line");
if (!from(B.pools.POKE, B.pokeLine(1))) problems.push("pokeLine(1) is not a POKE line");
if (!from(B.pools.POKE_SCARED, B.pokeLine(5))) problems.push("pokeLine(5) is not a POKE_SCARED line");

// The picker does not repeat back to back while it has unused lines.
math.random = () => 0;
B.resetRecent();
let prev = null;
for (let i = 0; i < 6; i++) {
  const line = B.pick(B.pools.SAVED);
  if (line === prev) problems.push("pick repeated the same line back to back");
  prev = line;
}

// End-of-game lines are always real strings.
for (const [word, guessed] of [["CAT", []], ["ELEPHANT", []], ["CAT", ["C", "A"]]]) {
  const line = B.lossTaunt(word, mask(...guessed));
  if (typeof line !== "string" || !line) problems.push(`lossTaunt(${word}) returned nothing`);
}
if (typeof B.savedLine() !== "string" || !B.savedLine()) problems.push("savedLine returned nothing");
if (B.MAX_WRONG !== 6) problems.push("MAX_WRONG should stay 6");

if (problems.length) { console.error(problems.join("\n")); process.exit(1); }
const total = [...seen.keys()].length;
console.log(`banter.js ok (${total} lines in ${poolCount} pools)`);
