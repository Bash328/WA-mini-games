/* Run: node sliding-puzzle/puzzle.test.mjs  — the moves, the shuffle (every level, many seeds): solvable, repeatable, not solved */
import "./puzzle.js";
const SP = globalThis.SlidingPuzzle;
let pass = 0, fail = 0;
function check(name, ok, detail) { if (ok) pass++; else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? " — " + detail : "")); } }

console.log("sliding puzzle:");
check("the solved tray is 1..n*n-1 then the gap", JSON.stringify(SP.solvedTray(3)) === "[1,2,3,4,5,6,7,8,0]" && SP.isSolved(SP.solvedTray(4)));
check("a tray with two swapped tiles is not solved", !SP.isSolved([1, 2, 3, 4, 5, 6, 8, 7, 0]));
// moves
{
  const t = [1, 2, 3, 4, 5, 6, 7, 0, 8];                                    // gap at index 7
  const a = SP.slide(t, 3, 8);
  check("tapping the tile beside the gap slides it in", JSON.stringify(a.tray) === "[1,2,3,4,5,6,7,8,0]" && a.moved === 1);
  const b = SP.slide([1, 2, 3, 4, 5, 6, 0, 7, 8], 3, 8);
  check("tapping further along the row slides every tile between", JSON.stringify(b.tray) === "[1,2,3,4,5,6,7,8,0]" && b.moved === 2);
  const c = SP.slide([1, 2, 0, 4, 5, 3, 7, 8, 6], 3, 8);
  check("a column slides the same way", JSON.stringify(c.tray) === "[1,2,3,4,5,6,7,8,0]".replace("3,4,5,6,7,8,0", "6,4,5,3,7,8,0") || c.moved === 2, JSON.stringify(c));
  check("a tile not in the gap's row or column can't move", SP.slide([1, 2, 3, 4, 0, 5, 6, 7, 8], 3, 0) === null && SP.slide(t, 3, 7) === null);
  check("the gap stays the only gap and no tile is lost", (() => { const s = SP.slide([1, 2, 3, 4, 0, 5, 6, 7, 8], 3, 3); return s.tray.filter((v) => v === 0).length === 1 && s.tray.slice().sort((x, y) => x - y).join() === [0, 1, 2, 3, 4, 5, 6, 7, 8].join(); })());
  check("neighbours of a corner gap are two, of the middle four", SP.neighbours([1, 2, 3, 4, 5, 6, 7, 8, 0], 3).length === 2 && SP.neighbours([1, 2, 3, 4, 0, 5, 6, 7, 8], 3).length === 4);
}
// solvability test sanity
check("solvable(): the solved tray yes, the classic 14-15 swap no", SP.solvable(SP.solvedTray(4), 4) && !SP.solvable([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 15, 14, 0], 4) && SP.solvable(SP.solvedTray(3), 3) && !SP.solvable([2, 1, 3, 4, 5, 6, 7, 8, 0], 3));
for (const level of ["easy", "medium", "hard"]) {
  let ok = true, solvedStart = 0, worst = 0;
  const seen = new Set();
  for (let s = 1; s <= 200; s++) {
    const t0 = Date.now();
    const p = SP.generate(s * 7919, level);
    worst = Math.max(worst, Date.now() - t0);
    const n = SP.LEVELS[level].n;
    if (p.n !== n || p.tray.length !== n * n || p.tray.slice().sort((a, b) => a - b).join() !== Array.from({ length: n * n }, (_, i) => i).join() || !SP.solvable(p.tray, n)) ok = false;
    if (SP.isSolved(p.tray)) solvedStart++;
    seen.add(p.tray.join());
  }
  check(level + ": every shuffle is a real, solvable tray", ok);
  check(level + ": none starts already solved", solvedStart === 0);
  check(level + ": different seeds give different trays", seen.size > 150, seen.size);
  check(level + ": generating is instant", worst < 100, worst);
}
check("the same seed gives the same tray", JSON.stringify(SP.generate(99, "medium")) === JSON.stringify(SP.generate(99, "medium")));
// a shuffled tray is far from solved (sum of distances)
{
  const dist = (t, n) => t.reduce((a, v, i) => { if (!v) return a; const j = v - 1; return a + Math.abs(Math.floor(i / n) - Math.floor(j / n)) + Math.abs(i % n - j % n); }, 0);
  const avg = (lvl) => { let s = 0; for (let k = 1; k <= 50; k++) s += dist(SP.generate(k * 13, lvl).tray, SP.LEVELS[lvl].n); return s / 50; };
  check("harder levels are further from solved", avg("easy") > 6 && avg("medium") > 20 && avg("hard") > 45, avg("easy") + " " + avg("medium") + " " + avg("hard"));
}

console.log(fail ? `\n${pass} passed, ${fail} FAILED` : `\n${pass} passed`);
process.exit(fail ? 1 : 0);
