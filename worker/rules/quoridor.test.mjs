/* Run: node worker/rules/quoridor.test.mjs  — rules, random games through the real room protocol, the computer */
import { newRoom, join, applyMove } from "../live-protocol.mjs";
import "./quoridor.mjs";

const R = globalThis.QuoridorRules;
let pass = 0, fail = 0;
function check(name, ok, detail) { if (ok) pass++; else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? " — " + detail : "")); } }
let n = 0;
const mint = () => "t" + ++n;
const rnd = (a) => a[Math.floor(Math.random() * a.length)];
const mk = (p1, p2, walls = [], w = [10, 10]) => ({ p: [p1, p2], w, walls });
const hWall = (r, c) => r * 8 + c;                    // horizontal wall at the crossing (r, c)
const vWall = (r, c) => 64 + r * 8 + c;               // vertical wall at the crossing (r, c)

console.log("quoridor:");
const S0 = R.parse(R.initial());
check("the start position round-trips", R.str(S0) === R.initial() && R.initial() === "7604aa", R.initial());
check("a pawn in the middle of the board has 4 steps", R.pawnMoves(mk(40, 4), 1).length === 4);
check("a pawn in a corner has 2 steps", R.pawnMoves(mk(80, 4), 1).length === 2);
// walls: cell 40 is row 4, column 4; the wall at crossing (3,4) lies between rows 3 and 4 over columns 4 and 5
check("a horizontal wall blocks the step across it", !R.pawnMoves(mk(40, 4, [hWall(3, 4)]), 1).includes(31));
check("...and the second column of the same wall", !R.pawnMoves(mk(41, 4, [hWall(3, 4)]), 1).includes(32));
check("...but not the column beyond it", R.pawnMoves(mk(42, 4, [hWall(3, 4)]), 1).includes(33));
check("a vertical wall blocks the sideways step", !R.pawnMoves(mk(40, 4, [vWall(4, 4)]), 1).includes(41));
check("a pawn jumps straight over the opponent", R.pawnMoves(mk(40, 31), 1).includes(22));
check("a blocked straight jump goes diagonal", (() => { const m = R.pawnMoves(mk(40, 31, [hWall(2, 4)]), 1); return m.includes(30) && m.includes(32) && !m.includes(22); })());
check("at the edge the jump goes diagonal", (() => { const m = R.pawnMoves(mk(10, 1), 1); return m.includes(0) && m.includes(2); })());
// wall rules
check("a wall can be placed on a fresh board", R.wallOk(S0, 1, hWall(3, 3)));
const one = mk(76, 4, [hWall(3, 3)], [9, 10]);
check("a crossing wall is refused", !R.wallOk(one, 1, vWall(3, 3)));
check("an overlapping wall is refused", !R.wallOk(one, 1, hWall(3, 4)) && !R.wallOk(one, 1, hWall(3, 2)));
check("a wall beside it, not overlapping, is fine", R.wallOk(one, 1, hWall(3, 5)));
check("no walls left: refused", !R.wallOk(mk(76, 4, [], [0, 10]), 1, hWall(3, 3)));
// shutting a pawn in: Blue in the top-left corner, wall under cells 0-1, then a vertical wall right of cell 1... leaves cell 0/1 boxed
check("a wall that shuts a pawn in is refused", (() => {
  const S = { p: [76, 0], w: [8, 10], walls: [hWall(0, 0), vWall(1, 1)].sort((a, b) => a - b) };
  // cells 0,1 sit above the wall: the only way out is to the right of cell 1 via row 0, which this wall (vertical, rows 0-1 at col 1) closes
  return R.dist({ ...S, walls: [hWall(0, 0)] }, 2) >= 0 && !R.wallOk({ ...S, walls: [hWall(0, 0)], w: [9, 10] }, 1, vWall(0, 1));
})());
check("dist works", R.dist(S0, 1) === 8 && R.dist(S0, 2) === 8);

// random games through the real protocol
let finished = 0, draws = 0, walls = 0;
for (let gI = 0; gI < 120; gI++) {
  const room = newRoom("quoridor", "ABC234", 1000);
  join(room, null, mint, 1000); join(room, null, mint, 1000);
  let S = R.parse(R.initial()), p = 1, count = 0, done = false;
  for (let ply = 0; ply < 400 && !done; ply++) {
    const c = R.candidates(S, p, -99);
    const wallsOnly = c.filter((x) => x.a.t === "wall"), steps = c.filter((x) => x.a.t === "move");
    const pick = (wallsOnly.length && Math.random() < 0.3) || !steps.length ? rnd(wallsOnly) : rnd(steps);
    const next = pick.S, w = R.winnerOf(next);
    const stuckNext = !w && R.stuck(next, R.other(p));
    const state = { game: "quoridor", version: 1, id: room.id, turn: R.other(p), board: R.str(next), status: w ? "won" : stuckNext ? "draw" : "in_progress", winner: w || null, moveCount: ++count, last: pick.a.t === "move" ? pick.a.to : 100 + pick.a.id };
    const res = applyMove(room, p, { t: "move", n: room.state ? room.state.moveCount : 0, s: state }, 2000);
    if (res && res.ok === false) { check("a legal action is accepted (game " + gI + " ply " + ply + ")", false, JSON.stringify(res) + " " + R.str(S) + " -> " + R.str(next)); break; }
    if (pick.a.t === "wall") walls++;
    S = next; p = R.other(p);
    if (w) { done = true; finished++; } else if (stuckNext) { done = true; draws++; }
  }
}
check("most random games end", finished + draws > 80, finished + " won, " + draws + " drawn of 120");
check("walls were used", walls > 100, walls);

// cheats
{
  const room = newRoom("quoridor", "ABC234", 1000);
  join(room, null, mint, 1000); join(room, null, mint, 1000);
  const mkState = (S, last, turn = 2, moveCount = 1) => ({ game: "quoridor", version: 1, id: room.id, turn, board: R.str(S), status: "in_progress", winner: null, moveCount, last });
  check("a two-square step is refused", applyMove(room, 1, { t: "move", n: 0, s: mkState(R.play(S0, 1, { t: "move", to: 58 }), 58) }, 2000).ok === false);
  const ok = R.play(S0, 1, { t: "move", to: 67 });
  check("a one-square step is accepted", applyMove(room, 1, { t: "move", n: 0, s: mkState(ok, 67) }, 2000).ok === true);
  const both = { ...R.play(ok, 2, { t: "wall", id: 5 }), p: [67, 13] };
  check("moving and placing in one turn is refused", applyMove(room, 2, { t: "move", n: 1, s: mkState(both, 105, 1, 2) }, 2000).ok === false);
}

// the computer
for (const lvl of ["easy", "medium", "hard"]) {
  let ok = true;
  const t0 = Date.now();
  for (let g = 0; g < 4 && ok; g++) {
    let S = R.parse(R.initial()), p = 1;
    for (let ply = 0; ply < 120; ply++) {
      const a = R.bestMove(R.str(S), p, lvl, Math.random);
      if (!a) break;
      const legal = a.t === "move" ? R.pawnMoves(S, p).includes(a.to) : R.wallOk(S, p, a.id);
      if (!legal) { ok = false; break; }
      S = R.play(S, p, a);
      if (R.winnerOf(S)) break;
      p = R.other(p);
    }
  }
  check(lvl + " always plays a legal action", ok);
  console.log("  (" + lvl + ": 4 games in " + (Date.now() - t0) + " ms)");
}
function match(a, b, games) {
  let wa = 0;
  for (let g = 0; g < games; g++) {
    let S = R.parse(R.initial());
    const lv = { 1: g % 2 ? b : a, 2: g % 2 ? a : b };
    let p = 1, winner = 0;
    for (let ply = 0; ply < 160 && !winner; ply++) {
      const act = R.bestMove(R.str(S), p, lv[p], Math.random);
      if (!act) break;
      S = R.play(S, p, act); winner = R.winnerOf(S); p = R.other(p);
    }
    if (winner && lv[winner] === a) wa++;
  }
  return wa / games;
}
const hv = match("hard", "easy", 8);
check("hard beats easy most of the time", hv >= 0.6, hv);
const mv = match("medium", "easy", 8);
check("medium beats easy most of the time", mv >= 0.6, mv);

console.log(fail ? `\n${pass} passed, ${fail} FAILED` : `\n${pass} passed`);
process.exit(fail ? 1 : 0);
