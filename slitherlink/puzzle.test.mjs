/* Run: node slitherlink/puzzle.test.mjs — generation (every level, many seeds):
   valid single loops, every clue matches, no branch/crossing, one answer,
   the solver agrees, the daily seed is deterministic, and tampering is caught. */
import "./puzzle.js";
const S = globalThis.SlitherPuzzle;
let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) pass++;
  else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? " — " + detail : "")); }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sum = (a) => a.reduce((x, y) => x + y, 0);

console.log("slitherlink:");

/* ---------- the grid itself ---------- */
check("the three levels are 5x5, 7x7 and 10x10", S.LEVELS.easy.n === 5 && S.LEVELS.medium.n === 7 && S.LEVELS.hard.n === 10);
for (const n of [5, 7, 10]) {
  const meta = S.makeMeta(n);
  let edgeCellsOk = true;
  for (let k = 0; k < meta.E; k++) {
    const count = (meta.edgeCells[k * 2] >= 0 ? 1 : 0) + (meta.edgeCells[k * 2 + 1] >= 0 ? 1 : 0);
    if (count < 1 || count > 2) edgeCellsOk = false;
  }
  check(n + "x" + n + ": every edge has two ends and one or two cells",
    meta.E === S.edgeCount(n) && meta.edgeVerts.length === meta.E * 2 &&
    meta.edgeCells.length === meta.E * 2 && edgeCellsOk &&
    Array.from(meta.edgeCells).every((ci) => ci >= -1 && ci < meta.N) &&
    Array.from(meta.edgeVerts).every((v) => v >= 0 && v < meta.V),
    "E=" + meta.E + " N=" + meta.N + " V=" + meta.V);
  check(n + "x" + n + ": every cell has its four sides and every edge is on one of them",
    meta.cellEdges.length === meta.N * 4 &&
    Array.from(meta.cellEdges).every((k) => k >= 0 && k < meta.E),
    meta.cellEdges.length);
  // the hEdge/vEdge helpers really name the same edges
  let endpointsOk = true;
  for (let k = 0; k < meta.E; k++) {
    const e = S.edgeEnds(n, k);
    const expect = k < n * (n + 1) ? S.hEdge(n, e.r1, e.c1) : S.vEdge(n, e.r1, e.c1);
    if (expect !== k) endpointsOk = false;
    if (e.r1 > e.r2 || (e.r1 === e.r2 && e.c1 > e.c2)) endpointsOk = false;
  }
  check(n + "x" + n + ": edgeEnds agrees with hEdge and vEdge", endpointsOk);
}

/* ---------- the rules, by hand ---------- */
{
  // a ring round a 2x2 block of cells: each of the four cells has 2 sides on the loop
  const n = 4, region = new Uint8Array(n * n);
  for (const i of [1 * n + 1, 1 * n + 2, 2 * n + 1, 2 * n + 2]) region[i] = 1;
  const clues = S.cluesFromRegion(n, region);
  const loop = S.loopFromRegion(n, region);
  check("a 2x2 block has a boundary of 8 edges", sum(Array.from(loop)) === 8, sum(Array.from(loop)));
  check("the four block cells have clue 2 and nothing is above 3",
    clues[1 * n + 1] === 2 && clues[1 * n + 2] === 2 && clues[2 * n + 1] === 2 && clues[2 * n + 2] === 2 &&
    Array.from(clues).every((k) => k >= 0 && k <= 3),
    Array.from(clues).join(""));
  const p = S.makePuzzle(7, "easy", n, clues, loop, 0);
  const c = S.check(p, p.solution);
  check("the 2x2 boundary is a single closed loop", c.solved && c.loops === 1 && c.paths === 0 && c.badVertices.length === 0);
  check("a blank board is not solved", !S.checkSolution(p, new Array(p.E).fill(0)));
  check("the solver finds the stored loop", same(S.solve(p, 50000), p.solution));
}
{
  // two separate 1x1 loops: both are loops, but not one loop
  const n = 4, p = S.makePuzzle(1, "easy", n, new Int8Array(n * n).fill(-1), new Uint8Array(S.edgeCount(n)), 0);
  const st = new Array(p.E).fill(0);
  for (const k of [S.hEdge(n, 0, 0), S.vEdge(n, 0, 1), S.hEdge(n, 1, 0), S.vEdge(n, 0, 0),
    S.hEdge(n, 2, 2), S.vEdge(n, 2, 3), S.hEdge(n, 3, 2), S.vEdge(n, 2, 2)]) st[k] = 1;
  const c = S.check(p, st);
  check("two separate loops are two loops, not a solution",
    c.loops === 2 && c.paths === 0 && !c.singleLoop && !c.solved,
    "loops=" + c.loops + " paths=" + c.paths);
}
{
  // a branch: three lines meeting at one dot
  const n = 4, p = S.makePuzzle(1, "easy", n, new Int8Array(n * n).fill(-1), new Uint8Array(S.edgeCount(n)), 0);
  const st = new Array(p.E).fill(0);
  st[S.hEdge(n, 1, 1)] = 1; st[S.hEdge(n, 1, 0)] = 1; st[S.vEdge(n, 0, 1)] = 1;
  const c = S.check(p, st);
  check("three lines at one dot are a branch", c.badVertices.length === 1 && !c.solved);
  st[S.vEdge(n, 1, 1)] = 1;
  const cross = S.check(p, st);
  check("four lines at one dot are a crossing", cross.badVertices.length === 1 && !cross.solved);
  // a single loose line is a path, not a loop
  const one = new Array(p.E).fill(0);
  one[S.hEdge(n, 2, 1)] = 1;
  const c2 = S.check(p, one);
  check("one loose line is a path", c2.paths === 1 && c2.ends.length === 2 && !c2.singleLoop);
}
{
  // an empty 2x2 board has more than one loop, so the solver must not call it unique
  const n = 2;
  const p = S.makePuzzle(1, "easy", n, new Int8Array(4).fill(-1), new Uint8Array(S.edgeCount(n)), 0);
  check("an unclued 2x2 board has more than one answer", S.countSolutions(p, 2, 20000) === 2);
}

/* ---------- generation across many seeds ---------- */
for (const level of ["easy", "medium", "hard"]) {
  const N = level === "hard" ? 16 : level === "medium" ? 24 : 30;
  let ok = 0, nulls = 0, slowest = 0, bad = 0;
  let hiddenBoards = 0, hiddenMismatch = 0, clueMismatch = 0, loopBad = 0, solverBad = 0, uniqueBad = 0;
  for (let s = 1; s <= N; s++) {
    const seed = s * 7919 + 17;
    const t0 = Date.now();
    const p = S.generate(seed, level);
    slowest = Math.max(slowest, Date.now() - t0);
    if (!p) { nulls++; continue; }
    ok++;
    const n = S.LEVELS[level].n, Ncells = n * n;
    let problems = [];
    if (p.n !== n) problems.push("size");
    if (p.clues.length !== Ncells) problems.push("clue count");
    if (p.solution.length !== p.E) problems.push("solution length");
    if (p.clues.some((v) => v !== null && (!Number.isInteger(v) || v < 0 || v > 3))) problems.push("clue value");
    if (p.solution.some((v) => v !== 0 && v !== 1)) problems.push("solution value");
    if (p.hidden !== p.clues.filter((v) => v === null).length) hiddenMismatch++;
    if (p.hidden > 0) hiddenBoards++;

    // every visible clue equals the number of stored loop sides, and a hidden
    // clue is only ever a 0 (the generator hides 0s only)
    for (let ci = 0; ci < Ncells; ci++) {
      const base = ci * 4;
      const actual = (p.solution[p.cellEdges[base]] === 1 ? 1 : 0) +
        (p.solution[p.cellEdges[base + 1]] === 1 ? 1 : 0) +
        (p.solution[p.cellEdges[base + 2]] === 1 ? 1 : 0) +
        (p.solution[p.cellEdges[base + 3]] === 1 ? 1 : 0);
      if (p.clues[ci] !== null && p.clues[ci] !== actual) clueMismatch++;
      if (p.clues[ci] === null && actual !== 0) hiddenMismatch++;
    }

    // a loop: every used dot has exactly two loop edges, no branches or crossings
    const c = S.check(p, p.solution);
    if (!c.solved || c.loops !== 1 || c.paths !== 0 || c.badComponents !== 0 ||
      c.badVertices.length !== 0 || c.ends.length !== 0) { loopBad++; problems.push("loop"); }
    if (c.counts.some((k, ci) => p.clues[ci] !== null && k !== p.clues[ci])) { clueMismatch++; problems.push("check clues"); }

    // the bounded solver must agree that there is exactly one answer
    const count = S.countSolutions(p, 2, 250000);
    if (count !== 1) { uniqueBad++; problems.push("solutions " + count); }
    const solved = S.solve(p, 250000);
    if (!solved || !S.checkSolution(p, solved) || !same(solved, p.solution)) { solverBad++; problems.push("solver"); }

    if (problems.length) {
      bad++;
      console.log("   bad puzzle", level, seed, problems.join(", "));
    }
  }
  console.log("  (" + level + ": " + ok + "/" + N + " built, " + nulls + " none, " + hiddenBoards + " with blanks, slowest " + slowest + " ms)");
  check(level + ": every seed builds a valid puzzle", bad === 0 && ok === N, ok + " ok, " + bad + " bad, " + nulls + " none");
  check(level + ": every puzzle is one loop with no branches or crossings", loopBad === 0, loopBad + " bad loops");
  check(level + ": every clue matches the stored loop", clueMismatch === 0, clueMismatch + " wrong clues");
  check(level + ": every puzzle has exactly one answer", uniqueBad === 0, uniqueBad + " not unique");
  check(level + ": the solver agrees with the stored answer", solverBad === 0, solverBad + " disagreements");
  check(level + ": some boards hide clues, and only 0s are hidden", hiddenBoards > 0 && hiddenMismatch === 0, hiddenBoards + " with blanks, " + hiddenMismatch + " bad hides");
  check(level + ": a puzzle takes under 2 seconds", slowest < 2000, slowest);
}

/* ---------- a seed repeats, another seed differs ---------- */
{
  const a = S.generate(4242, "medium"), b = S.generate(4242, "medium");
  check("the same seed gives the same puzzle", a && b && same(a.clues, b.clues) && same(a.solution, b.solution));
  const c = S.generate(2424, "medium");
  check("a different seed gives a different puzzle", c && !(same(a.clues, c.clues) && same(a.solution, c.solution)));
  check("check() accepts the stored answer and refuses a blank board",
    a && S.check(a, a.solution).solved && !S.check(a, new Array(a.E).fill(0)).solved);
}

/* ---------- tampering ---------- */
{
  const p = S.generate(9001, "medium");
  check("a generated board ready to tamper with", !!p);
  if (p) {
    let line = -1, off = -1;
    for (let k = 0; k < p.E; k++) {
      if (p.solution[k] === 1 && line < 0) line = k;
      if (p.solution[k] === 0 && off < 0) off = k;
    }
    const removed = p.solution.slice(); removed[line] = 0;
    const extra = p.solution.slice(); extra[off] = 1;
    const swapped = p.solution.slice(); swapped[line] = 0; swapped[off] = 1;
    check("removing a loop edge is caught", !S.checkSolution(p, removed));
    check("adding an extra edge is caught", !S.checkSolution(p, extra));
    check("moving an edge somewhere else is caught", !S.checkSolution(p, swapped));
    const clueAt = p.clues.findIndex((v) => v !== null);
    const changed = p.clues.slice();
    changed[clueAt] = (changed[clueAt] + 1) % 4;
    const q = Object.assign({}, p, { clues: changed });
    check("a changed clue no longer matches the answer", !S.checkSolution(q, p.solution));
    check("check() points at the changed clue", S.check(q, p.solution).badClues.indexOf(clueAt) >= 0);
  }
}
{
  const p = S.generate(9101, "easy");
  if (p) {
    const blank = new Array(p.E).fill(0);
    const h = S.hint(p, blank);
    check("the hint offers a missing line from the answer", !!h && h.value === 1 && p.solution[h.edge] === 1, h && h.value);
    const next = blank.slice(); next[h.edge] = 1;
    const h2 = S.hint(p, next);
    check("after taking the hint the next one is a different edge", !h2 || h2.edge !== h.edge);
    const full = p.solution.slice();
    for (let k = 0; k < p.E; k++) if (p.solution[k] === 0) { full[k] = 1; break; }
    const h3 = S.hint(p, full);
    check("a stray line is hinted for removal", !!h3 && h3.value === 0 && p.solution[h3.edge] === 0, h3 && h3.value);
    check("nothing is left to hint on the stored answer", S.hint(p, p.solution) === null);
  }
}

/* ---------- the daily puzzle ---------- */
{
  const d1 = S.dailySeed("medium", "2026-10-21");
  check("the daily seed is deterministic", d1 === S.dailySeed("medium", "2026-10-21"));
  check("the daily seed uses Gamekit's UTC date|level|game convention",
    d1 === S.hashStr("2026-10-21|medium|slitherlink"));
  check("the daily seed changes with the date and the level",
    d1 !== S.dailySeed("medium", "2026-10-22") && d1 !== S.dailySeed("hard", "2026-10-21"));
  const p1 = S.generateDaily("easy", "2026-10-21"), p2 = S.generateDaily("easy", "2026-10-21");
  check("the daily puzzle is the same on every device",
    p1 && p2 && same(p1.clues, p2.clues) && same(p1.solution, p2.solution));
  const q = S.generateDaily("hard", "2026-10-21");
  check("the hard daily puzzle is valid too", !!q && S.checkSolution(q, q.solution) && S.countSolutions(q, 2, 250000) === 1);
}

console.log(fail ? `\n${pass} passed, ${fail} FAILED` : `\n${pass} passed`);
process.exit(fail ? 1 : 0);
