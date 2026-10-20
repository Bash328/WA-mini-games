/* Run: node water-sort/puzzle.test.mjs  — pouring rules, and puzzles at every level: solvable (the solution is replayed), repeatable, quick */
import "./puzzle.js";
const WS = globalThis.WaterSort;
let pass = 0, fail = 0;
function check(name, ok, detail) { if (ok) pass++; else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? " — " + detail : "")); } }

console.log("water sort:");
// pouring
{
  const t = [[1, 2, 2], [3, 2], [], [1, 1, 1, 1]];
  check("a pour needs the same top colour (or an empty tube)", WS.legal(t, 0, 1) !== null && WS.legal(t, 0, 2) !== null && WS.legal(t, 1, 0) !== null && WS.legal(t, 0, 3) === null);
  check("all layers of the top colour pour, as many as fit", WS.legal(t, 0, 1).n === 2 && WS.legal([[1, 2, 2], [3, 2, 2, 2]], 0, 1) === null);
  check("only as many as there is room for", WS.legal([[1, 2, 2, 2], [3, 3, 2]], 0, 1).n === 1);
  const p = WS.pour(t, WS.legal(t, 0, 1));
  check("pouring moves the layers and leaves the rest", JSON.stringify(p) === JSON.stringify([[1], [3, 2, 2, 2], [], [1, 1, 1, 1]]));
  check("you can't pour from an empty tube or into the same tube", WS.legal(t, 2, 0) === null && WS.legal(t, 0, 0) === null);
  check("a finished tube is never offered as a source", WS.moves(t).every((m) => m.from !== 3));
  check("pouring a one-colour tube into an empty tube is not offered", !WS.moves([[1, 1], [2, 2], []]).some((m) => m.to === 2 && (m.from === 0 || m.from === 1)));
  check("solved(): every tube empty or four of one colour", WS.solved([[], [1, 1, 1, 1], [2, 2, 2, 2]]) && !WS.solved([[1, 1, 1], [1]]) && !WS.solved([[1, 1, 1, 2]]));
}
// puzzles
for (const level of ["easy", "medium", "hard"]) {
  const N = level === "hard" ? 30 : 60, lv = WS.LEVELS[level];
  let ok = 0, nulls = 0, worst = 0, bad = 0, lens = 0;
  for (let s = 1; s <= N; s++) {
    const t0 = Date.now();
    const p = WS.generate(s * 7919, level);
    worst = Math.max(worst, Date.now() - t0);
    if (!p) { nulls++; continue; }
    // the right units: lv.colors colours, four of each, lv.colors + lv.empty tubes
    const flat = p.tubes.flat(), counts = {};
    flat.forEach((c) => { counts[c] = (counts[c] || 0) + 1; });
    const shape = p.tubes.length === lv.colors + lv.empty && Object.keys(counts).length === lv.colors && Object.values(counts).every((n) => n === 4) && p.tubes.every((t) => t.length <= 4);
    // replay the stored solution
    let cur = p.tubes;
    for (const m of p.solution) { const l = WS.legal(cur, m.from, m.to); if (!l || l.n !== m.n) { cur = null; break; } cur = WS.pour(cur, l); }
    if (shape && cur && WS.solved(cur) && !WS.solved(p.tubes)) { ok++; lens += p.solution.length; } else bad++;
  }
  console.log("  (" + level + ": " + ok + "/" + N + " solvable, " + nulls + " none, slowest " + worst + " ms, a solution of about " + Math.round(lens / Math.max(1, ok)) + " pours)");
  check(level + ": every puzzle is well formed and its solution works", bad === 0 && ok >= N - 1, ok + " ok, " + bad + " bad, " + nulls + " none");
  check(level + ": a puzzle takes under 1.5 seconds", worst < 1500, worst);
}
check("the same seed gives the same puzzle", JSON.stringify(WS.generate(4242, "medium")) === JSON.stringify(WS.generate(4242, "medium")));
check("a different seed gives a different puzzle", JSON.stringify(WS.generate(4242, "medium").tubes) !== JSON.stringify(WS.generate(2424, "medium").tubes));
// the search can also help from the middle of a game
{
  const p = WS.generate(77, "medium");
  const m = p.solution[0];
  const mid = WS.pour(p.tubes, WS.legal(p.tubes, m.from, m.to));
  const sol = WS.solve(mid, 60000);
  check("solve() finds a way out from a position part-way through", !!sol && sol.length > 0);
}

console.log(fail ? `\n${pass} passed, ${fail} FAILED` : `\n${pass} passed`);
process.exit(fail ? 1 : 0);
