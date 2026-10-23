/* Run: node word-search/puzzle.test.mjs
   The word list, the generator (every level, many seeds), the daily seed, and the
   guarantee that each target word sits at its stored coordinates in one place. */
import "./words.js";
import "./puzzle.js";

const W = globalThis.WordSearchWords;
const P = globalThis.WordSearchPuzzle;
let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) pass++;
  else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? " — " + detail : "")); }
}

console.log("word search:");

/* ---------- the word list ---------- */
check("words.js sets globalThis.WordSearchWords", !!W && Array.isArray(W.ALL) && !!W.THEMES && !!W.BY_LENGTH);
check("it holds 400 to 600 words", W.ALL.length >= 400 && W.ALL.length <= 600, W.ALL.length);
check("every word is 4 to 7 lowercase letters", W.ALL.every((w) => typeof w === "string" && /^[a-z]{4,7}$/.test(w)));
check("no word is repeated", new Set(W.ALL).size === W.ALL.length, W.ALL.length - new Set(W.ALL).size);
check("the list is the union of the themes", Object.keys(W.THEMES).every((theme) => W.THEMES[theme].every((w) => W.ALL.includes(w))));
check("every theme has a useful number of words", Object.keys(W.THEMES).every((theme) => W.THEMES[theme].length >= 25), Object.keys(W.THEMES).map((t) => t + ":" + W.THEMES[t].length).join(" "));
check("BY_LENGTH agrees with the list", Object.keys(W.BY_LENGTH).every((len) => W.BY_LENGTH[len].length === W.ALL.filter((w) => w.length === Number(len)).length) && Object.values(W.BY_LENGTH).reduce((a, b) => a + b.length, 0) === W.ALL.length);
check("common words are in", ["apple", "river", "monkey", "school", "garden", "window", "tiger", "cheese"].every((w) => W.ALL.includes(w)));
check("offensive words are out", ["fuck", "shit", "cunt", "nigger", "bitch", "whore", "rape", "slut"].every((w) => !W.ALL.includes(w)));
check("there are enough words for every level", W.ALL.filter((w) => w.length >= 4 && w.length <= 5).length >= 60 && W.ALL.filter((w) => w.length >= 4 && w.length <= 6).length >= 100 && W.ALL.filter((w) => w.length >= 5 && w.length <= 7).length >= 100);

/* ---------- levels ---------- */
check("easy is 8x8 with six words", P.LEVELS.easy.n === 8 && P.LEVELS.easy.words === 6);
check("medium is 10x10 with eight words", P.LEVELS.medium.n === 10 && P.LEVELS.medium.words === 8);
check("hard is 12x12 with ten words", P.LEVELS.hard.n === 12 && P.LEVELS.hard.words === 10);

/* ---------- the generator ---------- */
function inspect(p, level, seed) {
  const conf = P.LEVELS[level];
  if (!p) return ["no puzzle"];
  const bad = [];
  if (p.level !== level) bad.push("level " + p.level);
  if (p.seed !== seed) bad.push("seed " + p.seed);
  if (p.n !== conf.n) bad.push("n " + p.n);
  if (p.words.length !== conf.words) bad.push("word count " + p.words.length);
  if (!P.check(p)) bad.push("check() false");
  if (p.grid.length !== conf.n || p.grid.some((row) => row.length !== conf.n)) bad.push("grid shape");
  if (p.grid.some((row) => row.some((ch) => !/^[a-z]$/.test(ch)))) bad.push("grid letters");
  if (new Set(p.words.map((w) => w.word)).size !== p.words.length) bad.push("repeated target");

  const seen = new Set();
  for (const item of p.words) {
    const w = item.word;
    if (!new RegExp("^[a-z]{" + conf.minLen + "," + conf.maxLen + "}$").test(w)) bad.push("length " + w);
    if (w === w.split("").reverse().join("")) bad.push("palindrome " + w);
    if (!(item.dr === 0 || item.dc === 0 || Math.abs(item.dr) === Math.abs(item.dc))) bad.push("not straight " + w);
    if (item.dr === 0 && item.dc === 0) bad.push("no direction " + w);
    if (Math.abs(item.dr) > 1 || Math.abs(item.dc) > 1) bad.push("step " + w);
    const er = item.row + item.dr * (w.length - 1), ec = item.col + item.dc * (w.length - 1);
    if (er < 0 || er >= p.n || ec < 0 || ec >= p.n) bad.push("off board " + w);
    // read the stored line by hand, not through the API being tested
    let read = "";
    for (let i = 0; i < w.length; i++) read += p.grid[item.row + item.dr * i][item.col + item.dc * i];
    if (read !== w) bad.push("stored letters " + w);
    if (seen.has(w)) bad.push("dup " + w);
    seen.add(w);
  }

  // every target must appear exactly once, at the stored line
  const all = P.scan(p);
  for (const item of p.words) {
    const hits = all[item.word] || [];
    if (hits.length !== 1) bad.push(w + " appears " + hits.length + " times");
    else if (hits[0].row !== item.row || hits[0].col !== item.col || hits[0].dr !== item.dr || hits[0].dc !== item.dc) bad.push(w + " only elsewhere");
  }

  // the four kinds of line, and at least one word written backwards
  let across = false, down = false, diagonal = false, backwards = false;
  for (const item of p.words) {
    if (item.dr === 0) across = true;
    if (item.dc === 0) down = true;
    if (item.dr !== 0 && item.dc !== 0) diagonal = true;
    if (item.dr < 0 || (item.dr === 0 && item.dc < 0)) backwards = true;
  }
  if (!(across && down && diagonal && backwards)) bad.push("not varied");

  return bad;
}

for (const level of ["easy", "medium", "hard"]) {
  const N = 120;
  let good = 0, worst = 0, sum = 0;
  const allBad = [];
  for (let i = 1; i <= N; i++) {
    const seed = (i * 7919 + 104729) >>> 0;
    const t = Date.now();
    const p = P.generate(seed, level);
    const dt = Date.now() - t;
    worst = Math.max(worst, dt);
    sum += dt;
    const bad = inspect(p, level, seed);
    if (!bad.length) good++;
    else if (allBad.length < 3) allBad.push("seed " + seed + ": " + bad.join(", "));
  }
  console.log("  (" + level + ": " + good + "/" + N + " good, slowest " + worst + " ms, average " + Math.round(sum / N) + " ms)");
  check(level + ": every seed gives a sound, varied puzzle", good === N, allBad.join(" | "));
  check(level + ": a puzzle is generated in under 500 ms", worst < 500, worst);
}

/* a seed that used to make the repair loop grind for a minute */
{
  const t = Date.now();
  const p = P.generate(403869, "medium");
  const dt = Date.now() - t;
  check("a formerly slow seed now generates quickly and correctly", dt < 500 && inspect(p, "medium", 403869).length === 0, dt + " ms");
}

/* ---------- determinism ---------- */
for (const level of ["easy", "medium", "hard"]) {
  const a = P.generate(12345, level);
  const b = P.generate(12345, level);
  check(level + ": the same seed gives the same puzzle", JSON.stringify(a) === JSON.stringify(b));
}
{
  const a = P.generate(12345, "medium"), b = P.generate(54321, "medium");
  check("a different seed gives a different puzzle", JSON.stringify(a.grid) !== JSON.stringify(b.grid) || JSON.stringify(a.words) !== JSON.stringify(b.words));
}

/* ---------- daily puzzles ---------- */
for (const level of ["easy", "medium", "hard"]) {
  const day = "2026-10-21";
  const s1 = P.dailySeed(level, day), s2 = P.dailySeed(level, day);
  check(level + ": the daily seed is stable", s1 === s2 && Number.isInteger(s1) && s1 >= 0);
  const a = P.generateDaily(level, day), b = P.generateDaily(level, day);
  check(level + ": the daily puzzle is deterministic", JSON.stringify(a) === JSON.stringify(b));
  check(level + ": the daily puzzle is the puzzle for that seed", a.seed === s1);
  const other = P.generateDaily(level, "2026-10-22");
  check(level + ": a new day gives a new daily puzzle", JSON.stringify(a.grid) !== JSON.stringify(other.grid) || JSON.stringify(a.words) !== JSON.stringify(other.words));
  const today = new Date("2026-10-21T12:00:00Z");
  check(level + ": a Date and its ISO day give the same seed", P.dailySeed(level, today) === s1);
  // daily seeds themselves must pass the same checks
  check(level + ": the daily puzzle is sound", inspect(a, level, s1).length === 0, inspect(a, level, s1).join(", "));
}

/* ---------- check() notices a tampered word ---------- */
{
  const p = P.generate(999, "easy");
  const copy = JSON.parse(JSON.stringify(p));
  const item = copy.words[0];
  const r = item.row, c = item.col;
  copy.grid[r][c] = copy.grid[r][c] === "q" ? "z" : "q";
  check("check() rejects a grid where a target's first letter was changed", P.check(copy) === false);
  check("check() rejects a puzzle with the wrong grid size", P.check({ ...p, n: 9 }) === false);
}

console.log(fail ? `\n${pass} passed, ${fail} FAILED` : `\n${pass} passed`);
process.exit(fail ? 1 : 0);
