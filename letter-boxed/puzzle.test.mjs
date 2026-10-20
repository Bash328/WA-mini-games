/* Run: node letter-boxed/puzzle.test.mjs  — the word list, the generator (every level, many seeds) and the rules */
import fs from "node:fs";
import "./puzzle.js";
const LB = globalThis.LetterBoxed;
let pass = 0, fail = 0;
function check(name, ok, detail) { if (ok) pass++; else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? " — " + detail : "")); } }

console.log("letter boxed:");
const text = fs.readFileSync(new URL("./words.txt", import.meta.url), "utf8");
let t0 = Date.now();
const dict = LB.parseWords(text);
console.log("  (parsed " + dict.list.length + " words in " + (Date.now() - t0) + " ms; " + text.length + " bytes)");
check("the list decodes to 50,000 to 60,000 words", dict.list.length >= 50000 && dict.list.length <= 60000, dict.list.length);
check("it is sorted and has no repeats", dict.list.every((w, i) => i === 0 || w > dict.list[i - 1]));
check("every word is 3 to 12 plain letters", dict.list.every((w) => /^[a-z]{3,12}$/.test(w)));
check("common words are in, offensive words are out", ["house", "garden", "letter", "river", "queen"].every((w) => dict.tier.has(w)) && !["fuck", "nigger", "cunt"].some((w) => dict.tier.has(w)));
check("tiers are 0, 1 or 2 and the common words are tier 0", [...dict.tier.values()].every((v) => v >= 0 && v <= 2) && dict.tier.get("house") === 0);

// the rules
const sideOf = { a: 0, b: 0, c: 0, d: 1, e: 1, f: 1, g: 2, h: 2, i: 2, j: 3, k: 3, l: 3 };
check("a word that hops between sides fits", LB.fits("adg", sideOf) && LB.fits("ghdj".slice(0, 3), sideOf) === false);
check("two letters from one side in a row do not fit", !LB.fits("abd", sideOf));
check("a letter that is not on the box does not fit", !LB.fits("adz", sideOf));
const vs = new Set(["house", "elbow", "wolf"]);
check("check(): short, wrong start, repeat, unknown", LB.check({}, vs, "ho", [], null) !== "ok" && LB.check({}, vs, "wolf", [], "e") !== "ok" && LB.check({}, vs, "house", ["house"], null) !== "ok" && LB.check({}, vs, "xyzzy", [], null) !== "ok" && LB.check({}, vs, "elbow", ["house"], "e") === "ok");

// the generator: every level, many seeds, bounded time, identical twice, solvable
for (const level of ["easy", "medium", "hard"]) {
  let ok = 0, nulls = 0, inRange = 0, minV = 1e9, maxV = 0, worst = 0, sumV = 0, bad = 0;
  const N = 60;
  for (let seed = 1; seed <= N; seed++) {
    const t = Date.now();
    const p = LB.generate(dict, seed * 7919, level);
    worst = Math.max(worst, Date.now() - t);
    if (!p) { nulls++; continue; }
    const letters = p.sides.join("");
    const sideOfP = {}; p.sides.forEach((s, i) => { for (const l of s) sideOfP[l] = i; });
    const valid = new Set(p.valid);
    const [w1, w2] = p.solution;
    const solved = new Set(w1 + w2).size === 12 && letters.length === 12 && new Set(letters).size === 12 && w1[w1.length - 1] === w2[0] && valid.has(w1) && valid.has(w2) && LB.fits(w1, sideOfP) && LB.fits(w2, sideOfP);
    if (!solved || p.sides.some((s) => s.length !== 3)) bad++; else ok++;
    const lv = LB.LEVELS[level];
    if (p.valid.length >= lv.min && p.valid.length <= lv.max) inRange++;
    minV = Math.min(minV, p.valid.length); maxV = Math.max(maxV, p.valid.length); sumV += p.valid.length;
  }
  console.log("  (" + level + ": " + ok + "/" + N + " good, " + nulls + " none, " + inRange + " in range, valid words " + minV + ".." + maxV + " avg " + Math.round(sumV / (N - nulls)) + ", slowest " + worst + " ms)");
  check(level + ": every puzzle has a two-word solution that fits its box", bad === 0 && ok >= N - 2, ok + " ok, " + bad + " bad, " + nulls + " none");
  check(level + ": most puzzles land in the level's range", inRange >= N * 0.8, inRange + "/" + N);
  check(level + ": a puzzle takes under 1.5 seconds", worst < 1500, worst);
}
{
  const a = LB.generate(dict, 12345, "medium"), b = LB.generate(dict, 12345, "medium");
  check("the same seed gives the same puzzle", JSON.stringify(a) === JSON.stringify(b));
  const c = LB.generate(dict, 54321, "medium");
  check("a different seed gives a different box", JSON.stringify(a.sides) !== JSON.stringify(c.sides));
}

console.log(fail ? `\n${pass} passed, ${fail} FAILED` : `\n${pass} passed`);
process.exit(fail ? 1 : 0);
