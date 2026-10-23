/* Run: node worker/rules/breakthrough.test.mjs
   Setup, move/capture rules, blocked moves, the back-rank win, the draw rule,
   random legal games, the computer, and the server's own validation. */
import { validateTransition } from "./breakthrough.mjs";

const R = globalThis.BreakthroughRules;
let pass = 0, fail = 0;
function check(name, ok, detail) { if (ok) pass++; else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? " — " + detail : "")); } }
const rnd = (a) => a[Math.floor(Math.random() * a.length)];
const at = (r, c) => r * 8 + c;

// a board from a list of [index, value], plus the side to move and the quiet-move counter
const mk = (cells, t = 1, c = 0) => { const b = new Array(64).fill(0); for (const [i, v] of cells) b[i] = v; return { b, t, c }; };
const has = (moves, from, to) => moves.some((m) => m.from === from && m.to === to);

// Apply one move the way the page does and build the envelope the server sees.
function moveTo(before, mover, mv) {
  const after = R.play(before, mover, mv);
  const o = R.outcome(after, mover);
  return { after, o, env: { board: R.str(after), status: o.status, winner: o.winner || null, last: mv.from * 8 + mv.to } };
}
const accepted = (prev, next, mover) => validateTransition(prev, next, mover).ok === true;

console.log("breakthrough:");

/* ---------- setup ---------- */
const start = R.create();
const wire = R.str(start);
check("the opening position round-trips through the wire", R.parse(wire) !== null && R.str(R.parse(wire)) === wire);
check("the wire is 64 cells, the turn and a two-digit counter", wire.length === 67 && /^[012]{64}1\d{2}$/.test(wire), wire);
check("Red holds the two bottom rows", Array.from({ length: 16 }, (_, k) => start.b[48 + k]).every((v) => v === 1));
check("Blue holds the two top rows", Array.from({ length: 16 }, (_, k) => start.b[k]).every((v) => v === 2));
check("the opening has sixteen pieces a side", start.b.filter((v) => v === 1).length === 16 && start.b.filter((v) => v === 2).length === 16);
check("Red opens with eight steps", R.gen(start, 1).length === 8, R.gen(start, 1).length);
check("Blue has eight steps too", R.gen(start, 2).length === 8, R.gen(start, 2).length);
check("Red moves first", start.t === 1 && start.c === 0);
check("a malformed wire is rejected", R.parse("0".repeat(67)) === null && R.parse(wire.slice(1)) === null && R.parse(wire.slice(0, 65) + "61") === null);
check("a counter of 60 is allowed, 61 is not", R.parse(wire.slice(0, 65) + "60") !== null && R.parse(wire.slice(0, 65) + "61") === null);

/* ---------- one square straight forward, one diagonally to capture ---------- */
{
  const s = mk([[at(5, 4), 1], [at(4, 3), 2], [at(4, 5), 2], [at(0, 0), 2]]);
  const moves = R.gen(s, 1);
  check("Red steps one square straight forward", has(moves, at(5, 4), at(4, 4)));
  check("Red captures one square diagonally", has(moves, at(5, 4), at(4, 3)) && has(moves, at(5, 4), at(4, 5)));
  check("Red does not move two squares", !has(moves, at(5, 4), at(3, 4)));
  check("Red does not move backward", !has(moves, at(5, 4), at(6, 4)));
  check("Red does not move sideways", !has(moves, at(5, 4), at(5, 3)) && !has(moves, at(5, 4), at(5, 5)));
  check("an empty diagonal is not a move", R.gen(mk([[at(5, 4), 1], [at(0, 0), 2]]), 1).length === 1);
  check("a piece on the back rank has no forward step", R.gen(mk([[at(0, 4), 1], [at(7, 0), 2]]), 1).length === 0);
}
{
  const s = mk([[at(2, 3), 2], [at(3, 2), 1], [at(3, 4), 1], [at(7, 7), 1]]);
  const moves = R.gen(s, 2);
  check("Blue steps one square down", has(moves, at(2, 3), at(3, 3)));
  check("Blue captures one square down-diagonally", has(moves, at(2, 3), at(3, 2)) && has(moves, at(2, 3), at(3, 4)));
  check("Blue does not move up", !has(moves, at(2, 3), at(1, 3)));
  check("Blue does not move two squares", !has(moves, at(2, 3), at(4, 3)));
}
{
  const s = mk([[at(5, 4), 1], [at(4, 4), 2], [at(0, 0), 2]]);
  const moves = R.gen(s, 1);
  check("an enemy straight ahead blocks the step", !has(moves, at(5, 4), at(4, 4)));
  check("an enemy straight ahead is not captured", moves.filter((m) => m.from === at(5, 4)).length === 0);
}
check("your own piece straight ahead blocks the step", !has(R.gen(mk([[at(5, 4), 1], [at(4, 4), 1], [at(0, 0), 2]]), 1), at(5, 4), at(4, 4)));
check("a diagonal square holding your own piece is not entered", !has(R.gen(mk([[at(5, 4), 1], [at(4, 3), 1], [at(0, 0), 2]]), 1), at(5, 4), at(4, 3)));
check("off-board diagonals are ignored at the edge", R.gen(mk([[at(6, 0), 1], [at(7, 1), 2]]), 1).length === 1);
{
  const before = mk([[at(5, 4), 1], [at(4, 3), 2], [at(0, 0), 2]]);
  const mv = { from: at(5, 4), to: at(4, 3) };
  const after = R.play(before, 1, mv);
  check("a capture removes the enemy piece", after.b[at(4, 3)] === 1 && after.b[at(5, 4)] === 0 && after.b.filter((v) => v === 2).length === 1);
  check("a capture resets the quiet-move counter", R.play(mk([[at(5, 4), 1], [at(4, 3), 2], [at(0, 0), 2]], 1, 22), 1, mv).c === 0);
}

/* ---------- first to the other back rank wins ---------- */
{
  const before = mk([[at(1, 3), 1], [at(0, 0), 2]]);
  const r = moveTo(before, 1, { from: at(1, 3), to: at(0, 3) });
  check("Red on row 0 wins", r.o.status === "won" && r.o.winner === 1, JSON.stringify(r.o));
  check("Red on row 0 beats the draw counter", moveTo(mk([[at(1, 3), 1], [at(0, 0), 2]], 1, 59), 1, { from: at(1, 3), to: at(0, 3) }).o.winner === 1);
}
{
  const before = mk([[at(6, 4), 2], [at(7, 7), 1]]);
  const r = moveTo(before, 2, { from: at(6, 4), to: at(7, 4) });
  check("Blue on row 7 wins", r.o.status === "won" && r.o.winner === 2, JSON.stringify(r.o));
}
{
  const before = mk([[at(1, 3), 1], [at(0, 4), 2]]);
  const r = moveTo(before, 1, { from: at(1, 3), to: at(0, 4) });
  check("capturing onto the back rank wins", r.o.winner === 1);
}
check("a piece on its own back rank does not win", R.outcome(mk([[at(7, 0), 1], [at(0, 0), 2]]), 2).winner === 0);
{
  // the side to move is walled in: straight ahead is an enemy, the diagonals are empty
  const before = mk([[at(1, 0), 1], [at(3, 3), 1], [at(0, 0), 2]]);
  const r = moveTo(before, 1, { from: at(3, 3), to: at(2, 3) });
  check("a side with no legal move loses", r.o.status === "won" && r.o.winner === 1, JSON.stringify(r.o));
}

/* ---------- the draw rule ---------- */
{
  const before = mk([[at(6, 0), 1], [at(7, 7), 1], [at(0, 0), 2], [at(1, 7), 2]], 1, 59);
  const r = moveTo(before, 1, { from: at(6, 0), to: at(5, 0) });
  check("60 quiet moves in a row is a draw", r.o.status === "draw" && r.o.winner === 0, JSON.stringify(r.o));
  check("the counter stops at 60", r.after.c === 60 && R.parse(R.str(r.after)) !== null);
  check("the draw is written into the wire", /60$/.test(R.str(r.after)));
}
check("a capture before 60 clears the counter", (() => {
  const before = mk([[at(5, 4), 1], [at(4, 3), 2], [at(0, 0), 2]], 1, 59);
  const after = R.play(before, 1, { from: at(5, 4), to: at(4, 3) });
  return after.c === 0 && R.outcome(after, 1).status === "in_progress";
})());

/* ---------- random legal games, every move through the server's check ---------- */
{
  let ok = true, finished = 0, wins = { 1: 0, 2: 0 }, draws = 0, worst = 0;
  for (let g = 0; g < 40 && ok; g++) {
    let S = R.create(), p = 1, prev = null, done = false;
    for (let ply = 1; ply <= 300; ply++) {
      const moves = R.gen(S, p);
      if (!moves.length) { ok = false; console.log("  no legal move before the game ended at ply " + ply); break; }
      const mv = rnd(moves);
      const r = moveTo(S, p, mv);
      const res = validateTransition(prev, r.env, p);
      if (!res.ok) { ok = false; check("a random legal move is accepted (game " + g + ", ply " + ply + ")", false, JSON.stringify(res)); break; }
      if (res.nextTurn !== R.other(p)) { ok = false; check("the server hands the turn on", false, res.nextTurn); break; }
      prev = r.env; S = r.after; worst = Math.max(worst, S.c);
      if (r.o.status !== "in_progress") { done = true; finished++; if (r.o.status === "draw") draws++; else wins[r.o.winner]++; break; }
      p = R.other(p);
    }
    if (!done && ok) { ok = false; check("random games finish", false, "game " + g + " ran past 300 plies"); }
  }
  check("random legal games all pass the server's check", ok);
  check("all random games finish", finished === 40, finished + " of 40");
  check("both sides win some random games", wins[1] > 2 && wins[2] > 2, wins[1] + "/" + wins[2]);
  check("the quiet-move counter never runs past 60", worst <= R.DRAW_LIMIT, worst);
  console.log("  (random games: " + wins[1] + " Red, " + wins[2] + " Blue, " + draws + " draws)");
}

/* ---------- the computer ---------- */
for (const lvl of ["easy", "medium", "hard"]) {
  let ok = true, done = 0;
  for (let g = 0; g < 4 && ok; g++) {
    let S = R.create(), p = 1, prev = null;
    const aiSide = g % 2 ? 1 : 2;
    for (let ply = 0; ply < 300; ply++) {
      const legal = R.gen(S, p);
      if (!legal.length) { ok = false; break; }
      let mv;
      if (p === aiSide) {
        mv = R.bestMove(R.str(S), p, lvl, Math.random);
        if (!mv || !legal.some((m) => m.from === mv.from && m.to === mv.to)) { ok = false; check(lvl + " picks a legal move", false, JSON.stringify(mv)); break; }
      } else mv = rnd(legal);
      const r = moveTo(S, p, mv);
      if (!accepted(prev, r.env, p)) { ok = false; check(lvl + " move passes the server", false, JSON.stringify(r.env)); break; }
      prev = r.env; S = r.after;
      if (r.o.status !== "in_progress") { done++; break; }
      p = R.other(p);
    }
  }
  check(lvl + " always plays a legal move and its games finish", ok && done === 4, done + " of 4");
}
{
  const s = mk([[at(1, 3), 1], [at(0, 0), 2]]);
  const mv = R.bestMove(R.str(s), 1, "hard", () => 0.9);
  check("hard takes an immediate win", mv && mv.from === at(1, 3) && mv.to === at(0, 3), JSON.stringify(mv));
  const s2 = mk([[at(6, 4), 2], [at(7, 0), 1]]);
  const mv2 = R.bestMove(R.str(s2), 2, "medium", () => 0.9);
  check("medium takes an immediate win", mv2 && mv2.from === at(6, 4) && mv2.to === at(7, 4), JSON.stringify(mv2));
}
function match(a, b, games) {
  let wa = 0;
  for (let g = 0; g < games; g++) {
    let S = R.create(), p = 1;
    const lv = { 1: g % 2 ? b : a, 2: g % 2 ? a : b };
    for (let ply = 0; ply < 300; ply++) {
      const mv = R.bestMove(R.str(S), p, lv[p], Math.random);
      if (!mv) break;
      const r = moveTo(S, p, mv);
      S = r.after;
      if (r.o.status !== "in_progress") { if (r.o.status === "won" && lv[r.o.winner] === a) wa++; break; }
      p = R.other(p);
    }
  }
  return wa / games;
}
const t0 = Date.now();
const hardVsEasy = match("hard", "easy", 8);
check("hard beats easy most of the time", hardVsEasy >= 0.6, hardVsEasy);
console.log("  (hard vs easy " + hardVsEasy + ", " + (Date.now() - t0) + " ms)");

/* ---------- the server's validation ---------- */
{
  const S0 = R.create();
  const first = R.gen(S0, 1)[0];
  const A = moveTo(S0, 1, first).env;
  check("the server accepts the opening move", accepted(null, A, 1), JSON.stringify(validateTransition(null, A, 1)));
  check("the server refuses an opening move for Blue", !accepted(null, A, 2));
  check("the server refuses a wrong last-move index", !accepted(null, { ...A, last: A.last + 1 }, 1));
  check("the server refuses a changed enemy piece", !accepted(null, { ...A, board: A.board.slice(0, 10) + "1" + A.board.slice(11) }, 1));
  check("the server refuses a counter that did not advance", !accepted(null, { ...A, board: A.board.slice(0, 65) + "00" }, 1));
  check("the server refuses the wrong status", !accepted(null, { ...A, status: "won", winner: 1 }, 1));
  check("the server refuses a winner on a quiet position", !accepted(null, { ...A, status: "in_progress", winner: 1 }, 1));
}
{
  const before = mk([[at(4, 4), 1], [at(3, 3), 2], [at(0, 0), 2]], 1, 4);
  const prev = { board: R.str(before) };
  const cap = moveTo(before, 1, { from: at(4, 4), to: at(3, 3) });
  check("the server accepts a capture", accepted(prev, cap.env, 1), JSON.stringify(validateTransition(prev, cap.env, 1)));
  // a piece that jumps two squares is refused
  const jump = { b: before.b.slice(), t: 2, c: 0 };
  jump.b[at(2, 4)] = 1; jump.b[at(4, 4)] = 0;
  check("the server refuses a two-square jump", !accepted(prev, { board: R.str(jump), status: "in_progress", winner: null, last: at(4, 4) * 8 + at(2, 4) }, 1));
  // capturing the enemy straight ahead is refused too
  const straightBefore = mk([[at(4, 4), 1], [at(3, 4), 2], [at(0, 0), 2]]);
  const straight = { b: straightBefore.b.slice(), t: 2, c: 0 };
  straight.b[at(3, 4)] = 1; straight.b[at(4, 4)] = 0;
  check("the server refuses a straight-ahead capture", !accepted({ board: R.str(straightBefore) }, { board: R.str(straight), status: "in_progress", winner: null, last: at(4, 4) * 8 + at(3, 4) }, 1));
  // a capture is the only way to enter a diagonal square: with nobody on (3,3), stepping there is refused
  const emptyBefore = mk([[at(4, 4), 1], [at(0, 0), 2]], 1, 5);
  const diagonal = emptyBefore.b.slice();
  diagonal[at(3, 3)] = 1;
  diagonal[at(4, 4)] = 0;
  check("the server refuses a diagonal step onto an empty square", !accepted({ board: R.str(emptyBefore) }, { board: R.str({ b: diagonal, t: 2, c: 6 }), status: "in_progress", winner: null, last: at(4, 4) * 8 + at(3, 3) }, 1));
}
{
  const before = mk([[at(1, 3), 1], [at(0, 0), 2]], 1, 0);
  const prev = { board: R.str(before) };
  const win = moveTo(before, 1, { from: at(1, 3), to: at(0, 3) });
  check("the server accepts a back-rank win", accepted(prev, win.env, 1));
  check("the server refuses a win not reported as won", !accepted(prev, { ...win.env, status: "in_progress", winner: null }, 1));
  check("the server refuses a win for the wrong side", !accepted(prev, { ...win.env, winner: 2 }, 1));
}
{
  // a stale back-rank piece for the side that is NOT moving must not pass as a win for them
  const before = mk([[at(4, 4), 1], [at(7, 5), 2], [at(0, 0), 2]], 1, 0);
  const after = R.play(before, 1, { from: at(4, 4), to: at(3, 4) });
  const env = { board: R.str(after), status: "won", winner: 2, last: at(4, 4) * 8 + at(3, 4) };
  check("the server refuses a win for the side that did not move", !accepted({ board: R.str(before) }, env, 1));
}
{
  const before = mk([[at(6, 0), 1], [at(7, 7), 1], [at(0, 0), 2], [at(1, 7), 2]], 1, 59);
  const prev = { board: R.str(before) };
  const draw = moveTo(before, 1, { from: at(6, 0), to: at(5, 0) });
  check("the server accepts the draw", accepted(prev, draw.env, 1));
  check("the server refuses the draw reported as in progress", !accepted(prev, { ...draw.env, status: "in_progress", winner: null }, 1));
  check("the server refuses a draw with a winner", !accepted(prev, { ...draw.env, winner: 1 }, 1));
}
{
  const before = mk([[at(2, 2), 2], [at(1, 0), 1]], 2, 0);
  const prev = { board: R.str(before) };
  const mv = moveTo(before, 2, { from: at(2, 2), to: at(3, 2) });
  check("the server refuses a move by the side that is not to move", !accepted(prev, mv.env, 1));
  check("the server refuses a move from a position whose turn is wrong", !accepted({ board: R.str({ ...before, t: 1 }) }, mv.env, 2));
}

console.log(fail ? `\n${pass} passed, ${fail} FAILED` : `\n${pass} passed`);
process.exit(fail ? 1 : 0);
