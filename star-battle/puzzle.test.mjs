/* Run: node star-battle/puzzle.test.mjs
   — the rules by hand, then the generator at every level over many seeds (valid, unique,
   bounded), the daily seed, determinism, the solver and hints, and tamper detection. */
import "./puzzle.js";
const SB = globalThis.StarBattlePuzzle;
let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) pass++;
  else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? " — " + detail : "")); }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log("star battle:");

/* ---------- the levels ---------- */
check("the three levels are 6x6, 8x8 and 10x10", SB.LEVELS.easy.n === 6 && SB.LEVELS.medium.n === 8 && SB.LEVELS.hard.n === 10);
check("the easier boards take one star and the large board two",
  SB.LEVELS.easy.k === 1 && SB.LEVELS.medium.k === 1 && SB.LEVELS.hard.k === 2);

/* ---------- the rules, by hand ---------- */
{
  // a hand-made 4x4 board with four connected regions and its only answer
  const regions = [
    0, 0, 1, 1,
    2, 0, 1, 1,
    2, 2, 2, 1,
    2, 3, 3, 3,
  ];
  const p = { game: "star-battle", level: "test", seed: 1, n: 4, k: 1, regions: regions, solution: [1, 7, 8, 14] };
  const ok = SB.checkSolution(p);
  check("a hand-made one-star board is accepted", ok.solved, JSON.stringify(ok));
  check("its row, column and region counts are all one", same(ok.rows, [1, 1, 1, 1]) && same(ok.cols, [1, 1, 1, 1]) && same(ok.regions, [1, 1, 1, 1]));
  const touching = SB.check(p, [1, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  check("two stars side by side touch and are rejected", !touching.solved && touching.touching.length === 1 && touching.bad.length === 2);
  check("an empty board is not solved", !SB.check(p, []).solved);
  check("the stored answer is the only solution", SB.countSolutions(p, 2, 20000).count === 1);
  check("solve() finds the stored answer", same(SB.solve(p, 20000), p.solution));
}

/* ---------- every level, many seeds ---------- */
const SEEDS = { easy: 40, medium: 30, hard: 18 };
for (const level of ["easy", "medium", "hard"]) {
  const lv = SB.LEVELS[level];
  const N = SEEDS[level];
  let ok = 0, none = 0, bad = 0, worst = 0, total = 0;
  for (let s = 1; s <= N; s++) {
    const seed = (s * 2654435761) >>> 0;
    const t0 = Date.now();
    const p = SB.generate(seed, level);
    const ms = Date.now() - t0;
    total += ms;
    worst = Math.max(worst, ms);
    if (!p) { none++; continue; }
    const chk = SB.checkSolution(p);
    const cells = p.solution;
    const inRange = cells.every((i) => Number.isInteger(i) && i >= 0 && i < lv.n * lv.n);
    const uniqueCells = new Set(cells).size === cells.length;
    const counts = chk.solved &&
      chk.rows.every((v) => v === lv.k) &&
      chk.cols.every((v) => v === lv.k) &&
      chk.regions.every((v) => v === lv.k) &&
      chk.touching.length === 0 &&
      chk.stars === lv.n * lv.k;
    // every region is one connected piece of at least k cells, and all n regions are used
    const sizes = new Array(lv.n).fill(0);
    for (const gid of p.regions) if (gid >= 0 && gid < lv.n) sizes[gid]++;
    const sizeOk = sizes.every((v) => v >= lv.k);
    let connected = true;
    for (let gid = 0; gid < lv.n && connected; gid++) {
      const start = p.regions.indexOf(gid);
      const seen = new Set([start]);
      const queue = [start];
      for (let q = 0; q < queue.length; q++) {
        const cell = queue[q], r = Math.floor(cell / lv.n), c = cell % lv.n;
        for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
          const nr = r + dr, nc = c + dc;
          if (nr < 0 || nr >= lv.n || nc < 0 || nc >= lv.n) continue;
          const x = nr * lv.n + nc;
          if (!seen.has(x) && p.regions[x] === gid) { seen.add(x); queue.push(x); }
        }
      }
      if (seen.size !== sizes[gid]) connected = false;
    }
    const res = SB.countSolutions(p, 2, 600000);
    const solver = SB.solve(p, 600000);
    const unique = res.count === 1 && !res.blown && same(solver, cells);
    if (p.n === lv.n && p.k === lv.k && p.game === "star-battle" && inRange && uniqueCells && counts && sizeOk && connected && unique) ok++;
    else {
      bad++;
      console.log("   bad puzzle", level, seed, "counts", counts, "sizes", sizeOk, "connected", connected, "solutions", res.count, "blown", res.blown);
    }
  }
  console.log("  (" + level + ": " + lv.n + "x" + lv.n + ", " + lv.k + " star(s), " + ok + "/" + N + " valid and unique, " + none + " none, average " + Math.round(total / N) + " ms, slowest " + worst + " ms)");
  check(level + ": every seed gives a valid board with exactly one solution", bad === 0 && ok === N, ok + " ok, " + bad + " bad, " + none + " none");
  check(level + ": a puzzle is generated in under 4 seconds", worst < 4000, worst + " ms");
}

/* ---------- determinism ---------- */
{
  const a = SB.generate(4242, "medium"), b = SB.generate(4242, "medium"), c = SB.generate(2424, "medium");
  check("the same seed gives the same puzzle", !!a && !!b && same(a, b));
  check("a different seed gives a different puzzle", !!a && !!c && (!same(a.regions, c.regions) || !same(a.solution, c.solution)));
  check("the seed is remembered on the puzzle", !!a && a.seed === 4242);
}

/* ---------- the daily puzzle ---------- */
{
  // the same FNV-1a hash Gamekit.dailySeed uses, over date|level|game
  const fnv = (s) => { let h = 2166136261 >>> 0; s = String(s); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
  const s1 = SB.dailySeed("hard", "2026-10-21"), s2 = SB.dailySeed("hard", "2026-10-21");
  check("the daily seed is deterministic", s1 === s2 && Number.isInteger(s1) && s1 >= 0);
  check("the daily seed hashes date|level|game", s1 === fnv("2026-10-21|hard|star-battle"), s1 + " vs " + fnv("2026-10-21|hard|star-battle"));
  check("the daily seed changes with the date and the level", s1 !== SB.dailySeed("hard", "2026-10-22") && s1 !== SB.dailySeed("easy", "2026-10-21"));
  const d1 = SB.generateDaily("easy", "2026-10-21"), d2 = SB.generateDaily("easy", "2026-10-21");
  check("the daily puzzle is the same on every device", d1 && d2 && same(d1.regions, d2.regions) && same(d1.solution, d2.solution));
  check("dailySeed feeds generate", same(SB.generate(SB.dailySeed("medium", "2026-10-21"), "medium"), SB.generateDaily("medium", "2026-10-21")));
}

/* ---------- solver and hints ---------- */
{
  const p = SB.generate(99173, "medium");
  const empty = SB.emptyMarks(p);
  const first = SB.hint(p, empty);
  check("the first hint is the first stored star", !!first && first.cell === p.solution[0] && first.row === Math.floor(p.solution[0] / p.n) && first.col === p.solution[0] % p.n);
  const half = SB.marksFromSolution(p);
  const skipped = p.solution[2];
  half[skipped] = 0;
  const h2 = SB.hint(p, half);
  check("a hint skips the stars already placed", !!h2 && h2.cell === skipped);
  check("there is no hint once every stored star is placed", SB.hint(p, SB.marksFromSolution(p)) === null);
  check("the solver's answer passes the checker", SB.check(p, SB.solve(p, 600000)).solved);
  check("an empty board has no solution among its stars", !SB.check(p, empty).solved);
}

/* ---------- tamper detection ---------- */
{
  const p = SB.generate(1234567, "easy");
  check("the stored answer passes the checker", SB.checkSolution(p).solved);
  const missing = SB.marksFromSolution(p);
  missing[p.solution[0]] = 0;
  const m = SB.check(p, missing);
  check("removing a star is caught", !m.solved && m.under.rows.length > 0 && m.under.cols.length > 0);
  const extra = SB.marksFromSolution(p);
  let free = 0;
  while (extra[free]) free++;
  extra[free] = 1;
  check("adding a star is caught", !SB.check(p, extra).solved);
  const touching = SB.marksFromSolution(p);
  const s0 = p.solution[0], c0 = s0 % p.n;
  const adj = c0 < p.n - 1 ? s0 + 1 : c0 > 0 ? s0 - 1 : s0 + p.n;
  touching[adj] = 1;
  const t = SB.check(p, touching);
  check("two touching stars are caught", !t.solved && t.touching.length > 0 && t.bad.length >= 2, JSON.stringify({ touching: t.touching, bad: t.bad }));
  const fake = { game: p.game, level: p.level, seed: p.seed, n: p.n, k: p.k, regions: p.regions.slice(), solution: p.solution.slice(0, -1) };
  check("a shortened stored answer is caught", !SB.checkSolution(fake).solved);
  const moved = { game: p.game, level: p.level, seed: p.seed, n: p.n, k: p.k, regions: p.regions.slice(), solution: p.solution.slice() };
  moved.solution[0] = free;
  check("a moved stored star is caught", !SB.checkSolution(moved).solved);
  const reg = { game: p.game, level: p.level, seed: p.seed, n: p.n, k: p.k, regions: p.regions.slice(), solution: p.solution.slice() };
  const gid = reg.regions[s0];
  reg.regions[s0] = (gid + 1) % p.n;
  check("a changed region is caught", !SB.checkSolution(reg).solved);
}

console.log(fail ? "\n" + pass + " passed, " + fail + " FAILED" : "\n" + pass + " passed");
process.exit(fail ? 1 : 0);
