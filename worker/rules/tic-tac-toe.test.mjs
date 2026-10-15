/* Run: node worker/rules/tic-tac-toe.test.mjs */
import { validateTransition, lineWinner, EMPTY } from "./tic-tac-toe.mjs";

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? "  PASS  " : "  FAIL  ") + name);
  if (!ok) { console.log("     got:  " + JSON.stringify(got)); console.log("     want: " + JSON.stringify(want)); fail++; } else pass++;
}
const env = (board, over = {}) => ({ board, status: "in_progress", winner: null, last: 0, ...over });
const ok = { ok: true }, bad = { ok: false, reason: "illegal" };

console.log("lineWinner:");
check("row", lineWinner("XXX......"), "X");
check("diag", lineWinner("O...O...O"), "O");
check("none", lineWinner("XO.OX...."), null);

console.log("\nlegal moves:");
check("X opens", validateTransition(null, env("X........", { last: 0 }), "X"), ok);
check("O replies", validateTransition(env("X........"), env("XO.......", { last: 1 }), "O"), ok);
check("winning move", validateTransition(env("XX.OO...."), env("XXXOO....", { status: "won", winner: "X", last: 2 }), "X"), ok);
check("drawing move", validateTransition(env("XOXXOOOX."), env("XOXXOOOXX", { status: "draw", last: 8 }), "X"), ok);

console.log("\nillegal moves:");
check("two cells at once", validateTransition(null, env("XX.......", { last: 0 }), "X"), bad);
check("no change", validateTransition(env("X........"), env("X........", { last: 0 }), "O"), bad);
check("overwrite a taken cell", validateTransition(env("X........"), env("O........", { last: 0 }), "O"), bad);
check("wrong symbol", validateTransition(null, env("O........", { last: 0 }), "X"), bad);
check("erase an old move", validateTransition(env("XO......."), env("X.O......", { last: 2 }), "X"), bad);
check("last points elsewhere", validateTransition(null, env("X........", { last: 4 }), "X"), bad);
check("garbage board", validateTransition(null, env("X..", { last: 0 }), "X"), bad);
check("lowercase / other chars", validateTransition(null, env("x........", { last: 0 }), "X"), bad);

console.log("\nstatus must match the board:");
check("claims win without a line", validateTransition(null, env("X........", { status: "won", winner: "X", last: 0 }), "X"), bad);
check("misses a win", validateTransition(env("XX.OO...."), env("XXXOO....", { last: 2 }), "X"), bad);
check("win credited to wrong player", validateTransition(env("XX.OO...."), env("XXXOO....", { status: "won", winner: "O", last: 2 }), "X"), bad);
check("misses a draw", validateTransition(env("XOXXOOOX."), env("XOXXOOOXX", { last: 8 }), "X"), bad);
check("draw with a winner", validateTransition(env("XOXXOOOX."), env("XOXXOOOXX", { status: "draw", winner: "X", last: 8 }), "X"), bad);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
