/* Run: node hashiwokakero/puzzle.test.mjs — generation (every level, many seeds): valid, unique, bounded, repeatable */
import "./puzzle.js";
const H = globalThis.HashiPuzzle;
let pass = 0, fail = 0;
function check(name, ok, detail) { if (ok) pass++; else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? " — " + detail : "")); } }
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log("hashiwokakero:");
check("the three levels are 5x5, 7x7 and 9x9", H.LEVELS.easy.n === 5 && H.LEVELS.medium.n === 7 && H.LEVELS.hard.n === 9);
check("a pair has at most two bridges and an island at most eight", H.MAX_BRIDGES === 2 && H.MAX_NUMBER === 8);

/* ---------- the rules, by hand ---------- */
{
  // three islands in a row, joined by one bridge and then two: 1 - 2 - 1
  const p = H.makeBoard(5, [[0, 0], [0, 2], [0, 4]]);
  p.islands.forEach((is, i) => { is.num = [1, 2, 1][i]; });
  p.numbers = p.islands.map((is) => is.num);
  check("three islands in a row have the two line-of-sight pairs", p.pairs.length === 2, p.pairs.length);
  check("a pair can be looked up from either end", H.pairBetween(p, 0, 1) === 0 && H.pairBetween(p, 1, 0) === 0 && H.pairBetween(p, 0, 2) === -1);
  check("1-2-1 has exactly one solution", H.countSolutions(p, 5, 10000) === 1);
  check("the solver returns the 1-2-1 bridges", same(H.solve(p), [1, 1]));
  check("check() accepts 1-2-1 and rejects a blank row", H.check(p, [1, 1]).solved && !H.check(p, [0, 0]).solved);
  check("check() calls an unfinished island short and an overfilled one over", H.check(p, [0, 0]).under.length === 3 && H.check(p, [2, 2]).over.length === 3);
}
{
  // a diamond whose two possible bridges cross in the middle: no solution is allowed
  const p = H.makeBoard(5, [[0, 2], [2, 0], [2, 4], [4, 2]]);
  p.islands.forEach((is) => { is.num = 1; });
  check("the crossing pair is noticed in both directions", p.pairs.length === 2 && p.pairs[0].cross.length === 1 && p.pairs[1].cross.length === 1);
  check("two crossing bridges are not a solution", H.countSolutions(p, 5, 10000) === 0);
  const c = H.check(p, [1, 1]);
  check("check() reports crossing bridges", c.crossed.length === 1 && !c.solved);
}
{
  // two islands, one bridge each: 1 - 1
  const p = H.makeBoard(5, [[1, 1], [3, 1]]);
  p.islands[0].num = 1; p.islands[1].num = 1;
  check("a single pair of 1s is solved by one bridge", H.check(p, [1]).solved && !H.check(p, [2]).solved);
  check("islands are called connected only when a bridge joins them", H.isConnected(p, [1]) && !H.isConnected(p, [0]));
}
{
  // a square of 3s has two ways to place the bridges: counting more than one matters
  const sq = H.makeBoard(5, [[0, 0], [0, 2], [2, 0], [2, 2]]);
  sq.islands.forEach((is) => { is.num = 3; });
  check("a square of 3s has exactly two solutions", H.countSolutions(sq, 5, 100000) === 2);
}
{
  // every number is met, but the bridges form two separate pairs: not a solution
  const p = H.makeBoard(5, [[0, 0], [0, 2], [2, 0], [2, 2]]);
  p.islands.forEach((is) => { is.num = 2; });
  const c = H.check(p, [2, 2, 0, 0]);
  check("two separate pairs that meet their numbers are not connected", c.under.length === 0 && c.over.length === 0 && !c.connected && !c.solved);
}

/* ---------- generation across many seeds ---------- */
for (const level of ["easy", "medium", "hard"]) {
  const N = level === "hard" ? 24 : 40;
  let ok = 0, nulls = 0, worst = 0, bad = 0, wrong = 0, crossings = 0, islandsSum = 0;
  for (let s = 1; s <= N; s++) {
    const seed = s * 7919;
    const t0 = Date.now();
    const p = H.generate(seed, level);
    worst = Math.max(worst, Date.now() - t0);
    if (!p) { nulls++; continue; }
    islandsSum += p.islands.length;
    const c = H.check(p, p.solution);
    // every island 1..8; counts equal the numbers; no crossings; connected; at most two per pair
    const numbersOk = p.islands.every((is) => Number.isInteger(is.num) && is.num >= 1 && is.num <= 8) && p.numbers.every((n, i) => n === p.islands[i].num);
    const countsOk = p.pairs.every((pr, k) => p.solution[k] >= 0 && p.solution[k] <= 2) && p.islands.every((is, i) => c.degree[i] === is.num);
    const noCross = p.pairs.every((pr, k) => !p.solution[k] || pr.cross.every((q) => !p.solution[q]));
    // every pair really is a line of sight: same row or column, no island between
    const lineOfSight = p.pairs.every((pr) => {
      const a = p.islands[pr.a], b = p.islands[pr.b];
      if (pr.dir === "h" ? a.r !== b.r : a.c !== b.c) return false;
      const lo = pr.dir === "h" ? Math.min(a.c, b.c) : Math.min(a.r, b.r);
      const hi = pr.dir === "h" ? Math.max(a.c, b.c) : Math.max(a.r, b.r);
      return p.islands.every((is, i) => i === pr.a || i === pr.b || (pr.dir === "h" ? is.r !== a.r || is.c <= lo || is.c >= hi : is.c !== a.c || is.r <= lo || is.r >= hi));
    });
    const unique = H.countSolutions(p, 2, 200000);
    const solverAgrees = same(H.solve(p, 200000), p.solution);
    if (numbersOk && countsOk && noCross && lineOfSight && c.connected && unique === 1 && solverAgrees) ok++;
    else {
      bad++;
      console.log("   bad puzzle", level, seed, "numbers", numbersOk, "counts", countsOk, "cross", noCross, "sight", lineOfSight, "connected", c.connected, "solutions", unique, "solver agrees", solverAgrees);
    }
    if (!noCross) crossings++;
    if (!countsOk) wrong++;
  }
  console.log("  (" + level + ": " + ok + "/" + N + " valid and unique, " + nulls + " none, slowest " + worst + " ms, " + (islandsSum / Math.max(1, N - nulls)).toFixed(1) + " islands)");
  check(level + ": every puzzle is valid and has exactly one solution", bad === 0 && ok === N, ok + " ok, " + bad + " bad, " + nulls + " none");
  check(level + ": every stored solution meets every number, with no crossing", wrong === 0 && crossings === 0, wrong + " wrong counts, " + crossings + " with crossings");
  check(level + ": a puzzle takes under 2 seconds", worst < 2000, worst);
}

/* ---------- seeds and the daily puzzle ---------- */
{
  const a = H.generate(4242, "medium"), b = H.generate(4242, "medium");
  check("the same seed gives the same puzzle", same(a, b));
  const c = H.generate(2424, "medium");
  check("a different seed gives a different puzzle", !same(a.islands, c.islands) || !same(a.pairs, c.pairs));
  check("check() accepts the stored solution and refuses a blank board", H.check(a, a.solution).solved && !H.check(a, a.pairs.map(() => 0)).solved);
}
{
  const d1 = H.dailySeed("medium", "2026-10-21");
  check("the daily seed is deterministic", d1 === H.dailySeed("medium", "2026-10-21"));
  check("the daily seed changes with the date and the level", d1 !== H.dailySeed("medium", "2026-10-22") && d1 !== H.dailySeed("hard", "2026-10-21"));
  const p1 = H.generateDaily("easy", "2026-10-21"), p2 = H.generateDaily("easy", "2026-10-21");
  check("the daily puzzle is the same on every device", p1 && p2 && same(p1.islands, p2.islands) && same(p1.pairs, p2.pairs) && same(p1.solution, p2.solution));
}

console.log(fail ? `\n${pass} passed, ${fail} FAILED` : `\n${pass} passed`);
process.exit(fail ? 1 : 0);
