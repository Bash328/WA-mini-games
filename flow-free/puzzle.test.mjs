/* Run: node flow-free/puzzle.test.mjs
   — the rules, the generator at every level (a stored solution is replayed and checked), the
     checker's complaints, determinism, the daily seed, and the hint/solver. */
import "./puzzle.js";
const F = globalThis.FlowPuzzle;
let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) pass++;
  else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? " — " + detail : "")); }
}

console.log("flow free:");

// ---------- the board shape and the stored answer ----------
{
  const p = F.generate(7919, "easy");
  check("a 6x6 puzzle has 5 pairs", p.n === 6 && p.flows.length === 5 && p.solution.length === 5);
  check("every pair has two distinct dots", p.flows.every((f) => Number.isInteger(f.a) && Number.isInteger(f.b) && f.a !== f.b));
  check("the dots are all different cells", new Set(p.flows.flatMap((f) => [f.a, f.b])).size === p.flows.length * 2);
  check("the endpoints map agrees with the pairs", p.endpoints.filter((v) => v >= 0).length === p.flows.length * 2 &&
    p.flows.every((f) => p.endpoints[f.a] === f.id && p.endpoints[f.b] === f.id));
  const chk = F.checkSolution(p);
  check("the checker accepts the stored solution", chk.ok, chk.errors.join("; "));
  check("the stored solution covers every cell", chk.filled === 36);
  check("every stored path starts and ends on its own dots", p.flows.every((f, i) => {
    const q = p.solution[i];
    return (q[0] === f.a && q[q.length - 1] === f.b) || (q[0] === f.b && q[q.length - 1] === f.a);
  }));
}

// ---------- every level, many seeds ----------
for (const level of ["easy", "medium", "hard"]) {
  const N = level === "hard" ? 24 : 40;
  const lv = F.LEVELS[level];
  let ok = 0, bad = 0, worst = 0, cells = 0;
  for (let s = 1; s <= N; s++) {
    const t0 = Date.now();
    const p = F.generate((s * 2654435761) >>> 0, level);
    worst = Math.max(worst, Date.now() - t0);
    if (!p) { bad++; continue; }
    const chk = F.checkSolution(p);
    const seen = new Map();
    let cross = false, joined = true, adjacent = true;
    for (let f = 0; f < p.flows.length; f++) {
      const q = p.solution[f], fl = p.flows[f];
      if (!q || q.length < 2) { joined = false; continue; }
      if (!((q[0] === fl.a && q[q.length - 1] === fl.b) || (q[0] === fl.b && q[q.length - 1] === fl.a))) joined = false;
      for (let i = 0; i < q.length; i++) {
        if (i && !F.adjacent(p.n, q[i - 1], q[i])) adjacent = false;
        if (seen.has(q[i])) cross = true;
        seen.set(q[i], f);
      }
    }
    const full = seen.size === lv.n * lv.n && chk.ok;
    if (p.n === lv.n && p.flows.length === lv.flows && joined && adjacent && !cross && full) { ok++; cells += seen.size; }
    else bad++;
  }
  console.log("  (" + level + ": " + lv.n + "x" + lv.n + ", " + lv.flows + " pairs, " + ok + "/" + N + " valid, slowest " + worst + " ms)");
  check(level + ": every seed gives a full valid board", bad === 0 && ok === N, ok + " ok, " + bad + " bad");
  check(level + ": a board takes under 1.5 seconds", worst < 1500, worst);
  if (ok) check(level + ": the paths cover the board exactly once", cells === ok * lv.n * lv.n);
}

// ---------- determinism ----------
{
  const a = F.generate(4242, "medium"), b = F.generate(4242, "medium"), c = F.generate(2424, "medium");
  check("the same seed gives the same puzzle", JSON.stringify(a) === JSON.stringify(b));
  check("a different seed gives a different puzzle", JSON.stringify(a.flows) !== JSON.stringify(c.flows));
  check("the same seed keeps the same colours too", JSON.stringify(a.flows.map((f) => f.colour)) === JSON.stringify(b.flows.map((f) => f.colour)));
}

// ---------- the daily puzzle ----------
{
  const s1 = F.dailySeed("hard", "2026-10-21"), s2 = F.dailySeed("hard", "2026-10-21");
  check("the daily seed is the same all day", s1 === s2 && Number.isInteger(s1) && s1 >= 0);
  check("the daily seed changes with the level", F.dailySeed("easy", "2026-10-21") !== s1);
  check("the daily seed changes with the day", F.dailySeed("hard", "2026-10-22") !== s1);
  const d1 = F.daily("medium", "2026-10-21"), d2 = F.daily("medium", "2026-10-21");
  check("the daily puzzle is the same for everyone", JSON.stringify(d1) === JSON.stringify(d2));
  check("the daily puzzle has a valid stored answer", !!d1 && F.checkSolution(d1).ok);
  check("dailySeed feeds generate", JSON.stringify(F.generate(F.dailySeed("easy", "2026-10-21"), "easy")) === JSON.stringify(F.daily("easy", "2026-10-21")));
}

// ---------- the checker says no ----------
{
  const p = F.generate(1234, "easy");
  check("the checker is happy with the answer", F.checkSolution(p).ok);
  const missing = F.clonePaths(p.solution);
  missing[0] = missing[0].slice(0, -1);
  check("a path that stops short is rejected", !F.check(p, missing).ok);
  const overlap = F.clonePaths(p.solution);
  overlap[1] = overlap[1].concat([overlap[0][0]]);
  check("a path that crosses another is rejected", !F.check(p, overlap).ok);
  const teleport = F.clonePaths(p.solution);
  teleport[0] = [teleport[0][0], p.flows[0].b];
  check("a path that jumps is rejected", !F.check(p, teleport).ok);
  const swapped = F.clonePaths(p.solution);
  const q = swapped[0]; swapped[0] = swapped[1]; swapped[1] = q;
  check("joining the wrong pair is rejected", !F.check(p, swapped).ok);
  const empty = F.emptyPaths(p);
  const e = F.check(p, empty);
  check("an empty board is not solved", !e.ok && e.filled < 36);
  check("the checker wants one path per pair", !F.check(p, p.solution.slice(1)).ok);
}

// ---------- solver, hints, part-drawn boards ----------
{
  for (const level of ["easy", "medium", "hard"]) {
    const p = F.generate(99173, level);
    const sol = F.solve(p, 200000);
    check(level + ": the solver finds a full answer", !!sol && F.check(p, sol).ok);
    check(level + ": the stored answer is among the solutions", F.countSolutions(p, 2, 200000).count >= 1);
    check(level + ": the hint points at a stored route", (() => {
      const h = F.hint(p, F.emptyPaths(p));
      return !!h && h.path.join(",") === p.solution[h.flow].join(",");
    })());
    check(level + ": there is no hint once the stored answer is drawn", F.hint(p, p.solution) === null);
    const partial = F.emptyPaths(p);
    partial[0] = p.solution[0].slice(0, Math.max(2, Math.floor(p.solution[0].length / 2)));
    check(level + ": a part-drawn board is accepted", F.partialOk(p, partial));
    const broken = F.emptyPaths(p);
    broken[0] = [p.flows[0].a, p.flows[0].a];
    check(level + ": a path that repeats a cell is not restored", !F.partialOk(p, broken));
    const done0 = F.clonePaths(p.solution);
    check(level + ": isFlowDone agrees with a stored path", F.isFlowDone(p, 0, done0[0]));
    done0[0] = done0[0].slice(0, -1);
    check(level + ": isFlowDone rejects a half path", !F.isFlowDone(p, 0, done0[0]));
  }
}

// ---------- the stored answer is always usable by the checker ----------
{
  let allOk = true;
  for (const level of ["easy", "medium", "hard"]) {
    for (let s = 1; s <= 12; s++) {
      const p = F.generate((s * 97 + 13) >>> 0, level);
      if (!p || !F.check(p, p.solution).ok) allOk = false;
    }
  }
  check("every generated stored answer passes the checker", allOk);
}

console.log(fail ? `\n${pass} passed, ${fail} FAILED` : `\n${pass} passed`);
process.exit(fail ? 1 : 0);
