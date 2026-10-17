/* Run: node cross-sums/puzzle.test.mjs  — generation (every level, many seeds): valid, unique, bounded, repeatable */
import "./puzzle.js";
const CS = globalThis.CrossSums;
let pass = 0, fail = 0;
function check(name, ok, detail) { if (ok) pass++; else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? " — " + detail : "")); } }

console.log("cross sums:");
check("combos: 2 digits adding to 3 is 1+2 only; 3 digits to 6 is 1+2+3 only", JSON.stringify(CS.combos(3, 2)) === "[[1,2]]" && JSON.stringify(CS.combos(6, 3)) === "[[1,2,3]]");
check("combos: 17 in 2 is 8+9; 45 in 9 is every digit", JSON.stringify(CS.combos(17, 2)) === "[[8,9]]" && CS.combos(45, 9).length === 1);
check("combos: 10 in 2 has four ways", CS.combos(10, 2).length === 4);
{
  const run = { cells: [1, 2, 3], sum: 6, dir: "a" };
  check("runStatus: right sum is ok, a repeat is dup, wrong full sum is sum", CS.runStatus(run, { 1: 1, 2: 2, 3: 3 }) === "ok" && CS.runStatus(run, { 1: 2, 2: 2 }) === "dup" && CS.runStatus(run, { 1: 1, 2: 2, 3: 4 }) === "sum");
  check("runStatus: an unfinished run is ok until it overshoots", CS.runStatus(run, { 1: 1 }) === "ok" && CS.runStatus(run, { 1: 5, 2: 3 }) === "sum");
}
// a tiny puzzle by hand: one 2x2 white block with clues from a solution 1 2 / 2 1... is not unique; the solver must say so
{
  const n = 3, white = new Uint8Array(9); [4, 5, 7, 8].forEach((i) => { white[i] = 1; });
  const runs = [{ cells: [4, 5], dir: "a", sum: 3 }, { cells: [7, 8], dir: "a", sum: 3 }, { cells: [4, 7], dir: "d", sum: 3 }, { cells: [5, 8], dir: "d", sum: 3 }];
  const p = { n, white, runs, solution: { 4: 1, 5: 2, 7: 2, 8: 1 }, givens: {} };
  check("the solver finds two solutions of the 1/2 square", CS.countSolutions(p, {}, 5, 10000) === 2);
  check("one given makes it unique", CS.countSolutions(p, { 4: 1 }, 5, 10000) === 1);
  check("a wrong given makes it impossible", CS.countSolutions(p, { 4: 1, 5: 1 }, 5, 10000) === 0);
}

for (const level of ["easy", "medium", "hard"]) {
  const N = level === "hard" ? 24 : 40;
  let ok = 0, nulls = 0, worst = 0, givensSum = 0, whiteSum = 0, bad = 0;
  for (let s = 1; s <= N; s++) {
    const t0 = Date.now();
    const p = CS.generate(s * 7919, level);
    worst = Math.max(worst, Date.now() - t0);
    if (!p) { nulls++; continue; }
    // the stored solution satisfies every clue and every run is 2..9 long with distinct digits
    const good = p.runs.every((r) => r.cells.length >= 2 && r.cells.length <= 9 && new Set(r.cells.map((i) => p.solution[i])).size === r.cells.length && r.cells.reduce((a, i) => a + p.solution[i], 0) === r.sum);
    // exactly one solution given the givens
    const c = CS.countSolutions(p, p.givens, 2, 200000);
    // every white cell is in two runs
    const covered = Array.from(p.white).every((w, i) => !w || CS.runsAt(p, i).a && CS.runsAt(p, i).d);
    if (good && c === 1 && covered && Object.keys(p.givens).every((i) => p.givens[i] === p.solution[i])) ok++; else { bad++; console.log("   bad puzzle", level, s * 7919, good, c, covered); }
    givensSum += Object.keys(p.givens).length; whiteSum += Object.keys(p.solution).length;
  }
  console.log("  (" + level + ": " + ok + "/" + N + " unique, " + nulls + " none, slowest " + worst + " ms, givens " + (givensSum / Math.max(1, N - nulls)).toFixed(1) + " of " + (whiteSum / Math.max(1, N - nulls)).toFixed(1) + " white squares)");
  check(level + ": every puzzle is valid and has exactly one solution", bad === 0 && ok >= N - 2, ok + " ok, " + bad + " bad, " + nulls + " none");
  check(level + ": a puzzle takes under 2 seconds", worst < 2000, worst);
}
{
  const a = CS.generate(4242, "medium"), b = CS.generate(4242, "medium");
  check("the same seed gives the same puzzle", JSON.stringify(a) === JSON.stringify(b));
  const c = CS.generate(2424, "medium");
  check("a different seed gives a different puzzle", JSON.stringify(a.runs) !== JSON.stringify(c.runs));
  check("solved() accepts the solution and refuses a blank grid", CS.solved(a, a.solution) && !CS.solved(a, {}));
}

console.log(fail ? `\n${pass} passed, ${fail} FAILED` : `\n${pass} passed`);
process.exit(fail ? 1 : 0);
