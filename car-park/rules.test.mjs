/* Run: node car-park/rules.test.mjs — the moves, the exact win, and every shipped
   level solved by the BFS: solvable, minimum move count equal to its stored best,
   no overlapping cars, and a replayable legal solution. */
import "./rules.js";

const CP = globalThis.CarPark;
let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) pass++;
  else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? " - " + detail : "")); }
}

console.log("car park:");

/* ---------- the level list ---------- */
const levels = CP.LEVELS;
check("at least 40 levels are shipped", Array.isArray(levels) && levels.length >= 40, levels && levels.length);
check("every level is a valid 6x6 layout", levels.every((l) => CP.validLevel(l)));
check("every level has the red car at the left of row 2", levels.every((l) => {
  const red = CP.carsOf(l)[0];
  return red.id === CP.RED && red.dir === "h" && red.len === 2 && red.r === CP.EXIT_ROW && red.c === 0;
}));
check("difficulty never goes down", levels.every((l, i) => i === 0 || levels[i - 1].best <= l.best));
check("the ladder actually gets harder", levels.length > 1 && levels[levels.length - 1].best > levels[0].best + 8, levels[0].best + " to " + levels[levels.length - 1].best);
check("the ladder uses many different minimums", new Set(levels.map((l) => l.best)).size >= 10, new Set(levels.map((l) => l.best)).size);

/* ---------- every level, through the real solver ---------- */
let slowest = 0, total = 0, bad = 0;
for (let i = 0; i < levels.length; i++) {
  const level = levels[i];
  const cars = CP.carsOf(level);
  const t0 = Date.now();
  const res = CP.solve(cars);
  const ms = Date.now() - t0;
  slowest = Math.max(slowest, ms);
  total += ms;
  if (!res) { bad++; console.log("  FAIL  level " + (i + 1) + " has no solution"); continue; }
  if (res.moves !== level.best) { bad++; console.log("  FAIL  level " + (i + 1) + " needs " + res.moves + " moves, stored best is " + level.best); }
  if (CP.minimumMoves(cars) !== level.best) { bad++; console.log("  FAIL  level " + (i + 1) + " minimumMoves disagrees with best"); }
  if (CP.isWin(cars)) { bad++; console.log("  FAIL  level " + (i + 1) + " starts already won"); }
  if (!CP.occupancy(cars)) { bad++; console.log("  FAIL  level " + (i + 1) + " has overlapping cars"); }

  // replay the returned path through the public move API
  let cur = CP.cloneCars(cars);
  for (const move of res.path) {
    const legal = CP.legalMoves(cur).some((m) => m.id === move.id && m.dir === move.dir && m.steps === move.steps);
    if (!legal) { bad++; console.log("  FAIL  level " + (i + 1) + " solution uses an illegal move"); break; }
    cur = CP.applyMove(cur, move);
    if (!CP.valid(cur)) { bad++; console.log("  FAIL  level " + (i + 1) + " solution overlaps cars or leaves the board"); break; }
  }
  if (!CP.isWin(cur)) { bad++; console.log("  FAIL  level " + (i + 1) + " solution does not win"); }
}
check("every level is solvable with its stored best, and the solution replays", bad === 0, bad + " bad level(s)");
console.log("  (" + levels.length + " levels, best " + levels[0].best + "-" + levels[levels.length - 1].best + ", slowest " + slowest + " ms, all " + total + " ms)");

/* ---------- the exact win condition ---------- */
{
  const base = [{ id: 0, r: 2, c: 4, len: 2, dir: "h" }];
  check("red at the right end of row 2 wins", CP.isWin(base));
  check("red one cell short does not win", !CP.isWin([{ id: 0, r: 2, c: 3, len: 2, dir: "h" }]));
  check("red at the right edge of another row does not win", !CP.isWin([{ id: 0, r: 1, c: 4, len: 2, dir: "h" }]));
  check("a vertical car at the right edge does not win", !CP.isWin([{ id: 0, r: 3, c: 5, len: 2, dir: "v" }]));
  check("red past the right edge does not win", !CP.isWin([{ id: 0, r: 2, c: 5, len: 2, dir: "h" }]));
}

/* ---------- moves: direction, blocking, distance and immutability ---------- */
{
  const red = { id: 0, r: 2, c: 0, len: 2, dir: "h" };
  const open = [red];
  check("an open lane lets the red car slide four cells right", CP.maxSlide(open, 0, "right") === 4, CP.maxSlide(open, 0, "right"));
  check("a horizontal car cannot move up", CP.maxSlide(open, 0, "up") === 0);
  const blocked = [red, { id: 1, r: 2, c: 3, len: 2, dir: "v" }];
  check("another car stops the slide at the cell before it", CP.maxSlide(blocked, 0, "right") === 1, CP.maxSlide(blocked, 0, "right"));
  check("a blocked car has no move through it", !CP.legalMoves(blocked).some((m) => m.id === 0 && m.dir === "right" && m.steps > 1));

  const moved = CP.applyMove(open, { id: 0, dir: "right", steps: 3 });
  check("applyMove changes the car's column", moved[0].c === 3);
  check("applyMove does not change the original cars", open[0].c === 0);
  const back = CP.applyMove(moved, { id: 0, dir: "left", steps: 3 });
  check("moving back returns the exact board", JSON.stringify(back) === JSON.stringify(open));
}

/* ---------- hints ---------- */
{
  const level = levels[0];
  const cars = CP.carsOf(level);
  const h = CP.hint(cars);
  check("hint() returns a move from the starting position", !!h && Number.isInteger(h.id) && CP.DIRS.includes(h.dir) && h.steps > 0);
  if (h) {
    const next = CP.applyMove(cars, h);
    const after = CP.solve(next);
    check("the hinted move really is on a shortest solution", !!after && after.moves === level.best - 1, after && after.moves + " vs " + (level.best - 1));
  }
  const won = [{ id: 0, r: 2, c: 4, len: 2, dir: "h" }];
  check("hint() is empty once the level is won", CP.hint(won) === null);
}

/* ---------- an invalid board is rejected, not solved ---------- */
{
  const overlap = [{ id: 0, r: 2, c: 0, len: 2, dir: "h" }, { id: 1, r: 2, c: 1, len: 2, dir: "v" }];
  check("overlapping cars are invalid", !CP.valid(overlap));
  check("an invalid board has no solution", CP.solve(overlap) === null);
  const outside = [{ id: 0, r: 2, c: 0, len: 2, dir: "h" }, { id: 1, r: 5, c: 0, len: 3, dir: "v" }];
  check("a car hanging off the board is invalid", !CP.valid(outside));
}

console.log(fail ? `\n${pass} passed, ${fail} FAILED` : `\n${pass} passed`);
process.exit(fail ? 1 : 0);
