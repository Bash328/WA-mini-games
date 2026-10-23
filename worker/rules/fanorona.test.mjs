/* Run: node worker/rules/fanorona.test.mjs
   Setup, one-step movement, approach and withdrawal captures (and the choice
   when both are open), compulsory capture, chain captures, the two ways to
   win, the quiet-turn draw, random legal games checked by the server, the
   computer's legal play, and direct accept/reject cases for the server. */
import { validateTransition } from "./fanorona.mjs";

const R = globalThis.FanoronaRules;
let pass = 0, fail = 0;
function check(name, ok, detail) { if (ok) pass++; else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? " — " + detail : "")); } }
const rnd = (a) => a[Math.floor(Math.random() * a.length)];
// The random-game section uses a fixed seed, so a failing run can be repeated.
function seeded(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const at = (r, c) => r * R.COLS + c;

// a board from a list of [index, value], plus the side to move, chain point and quiet counter
const mk = (cells, t = 1, from = -1, c = 0) => {
  const b = new Array(R.CELLS).fill(0);
  for (const [i, v] of cells) b[i] = v;
  return { b: b, t: t, from: from, c: c };
};
const has = (moves, from, to, cap) => moves.some((m) => m.from === from && m.to === to && (cap === undefined || m.cap === cap));
const captureMove = (moves, from, to, cap) => moves.find((m) => m.from === from && m.to === to && m.cap === cap);

// Play one move and build the envelope the server sees.
function moveTo(before, mover, mv) {
  const after = R.play(before, mover, mv);
  const o = R.outcome(after, mover);
  return {
    after, o,
    env: { board: R.str(after), status: o.status, winner: o.winner || null, last: mv.from * R.CELLS + mv.to, turn: after.t },
  };
}
const accepted = (prev, next, mover) => validateTransition(prev, next, mover).ok === true;

console.log("fanorona:");

/* ---------- setup ---------- */
const start = R.create();
const wire = R.str(start);
check("the opening position round-trips through the wire", R.parse(wire) !== null && R.str(R.parse(wire)) === wire);
check("the wire is 45 cells, the turn, a chain character and a two-digit counter", wire.length === 49 && /^[012]{45}1j00$/.test(wire), wire);
check("the opening has 22 Red and 22 Blue pieces", start.b.filter((v) => v === 1).length === 22 && start.b.filter((v) => v === 2).length === 22);
check("the centre point is the only empty point", start.b.filter((v) => v === 0).length === 1 && start.b[at(2, 4)] === 0);
check("Red holds the two bottom rows", [0, 1, 2, 3, 4, 5, 6, 7, 8].every((c) => start.b[at(3, c)] === 1 && start.b[at(4, c)] === 1));
check("Blue holds the two top rows", [0, 1, 2, 3, 4, 5, 6, 7, 8].every((c) => start.b[at(0, c)] === 2 && start.b[at(1, c)] === 2));
check("the middle row alternates around the empty centre",
  JSON.stringify([0, 1, 2, 3, 4, 5, 6, 7, 8].map((c) => start.b[at(2, c)])) === JSON.stringify([2, 1, 2, 1, 0, 2, 1, 2, 1]));
check("Red moves first", start.t === 1 && start.from === -1 && start.c === 0);
check("every opening move goes to the centre and captures", (() => {
  const moves = R.gen(start, 1);
  return moves.length > 0 && moves.every((m) => m.to === at(2, 4) && m.cap !== 0);
})(), JSON.stringify(R.gen(start, 1)));
check("a malformed wire is rejected",
  R.parse("0".repeat(49)) === null && R.parse(wire.slice(1)) === null && R.parse(wire.slice(0, 47) + "0x") === null);
check("a chain character on an empty or enemy point is rejected",
  R.parse(wire.slice(0, 45) + "1M00") === null &&                    // centre 'M' is empty
  R.parse(wire.slice(0, 45) + "1000") === null);                     // point 0 is Blue
check("a quiet counter of 60 is allowed, 61 is not",
  R.parse(wire.slice(0, 47) + "60") !== null && R.parse(wire.slice(0, 47) + "61") === null);

/* ---------- moving one point along a line ---------- */
{
  const s = mk([[at(2, 4), 1], [at(4, 8), 2]]);
  const moves = R.gen(s, 1);
  check("at a strong point there are eight one-step moves", moves.length === 8, moves.length);
  check("a piece steps sideways", has(moves, at(2, 4), at(2, 5)));
  check("a piece steps up and down", has(moves, at(2, 4), at(1, 4)) && has(moves, at(2, 4), at(3, 4)));
  check("a piece steps diagonally on a marked diagonal", has(moves, at(2, 4), at(1, 3)) && has(moves, at(2, 4), at(3, 5)));
  check("a diagonal step is not two points", !has(moves, at(2, 4), at(0, 2)));
  check("a piece cannot stay on its own point", !has(moves, at(2, 4), at(2, 4)));
}
{
  // (1,0) is a weak point: horizontal and vertical only, no diagonals
  const s = mk([[at(1, 0), 1], [at(4, 8), 2]]);
  const moves = R.gen(s, 1);
  check("a weak point has only horizontal and vertical moves", moves.length === 3, moves.length);
  check("a weak point cannot step diagonally", !has(moves, at(1, 0), at(0, 1)) && !has(moves, at(1, 0), at(2, 1)));
  check("a weak point can still step sideways and along the column",
    has(moves, at(1, 0), at(0, 0)) && has(moves, at(1, 0), at(2, 0)) && has(moves, at(1, 0), at(1, 1)));
}
{
  const s = mk([[at(0, 0), 1], [at(4, 8), 2]]);
  const moves = R.gen(s, 1);
  check("a corner has the three moves its lines allow", moves.length === 3 && has(moves, at(0, 0), at(1, 1)), moves.length);
}
check("your own piece blocks the point", !has(R.gen(mk([[at(2, 4), 1], [at(2, 5), 1], [at(4, 8), 2]]), 1), at(2, 4), at(2, 5)));

/* ---------- approach and withdrawal captures ---------- */
{
  // Red at (2,2) steps to (2,3); the enemy line continues east at (2,4),(2,5)
  const before = mk([[at(2, 2), 1], [at(2, 4), 2], [at(2, 5), 2], [at(2, 7), 2], [at(4, 8), 2]]);
  const moves = R.gen(before, 1);
  const mv = captureMove(moves, at(2, 2), at(2, 3), 1);
  check("an approach capture takes the unbroken line ahead", !!mv && mv.n === 2, JSON.stringify(moves));
  check("an approach capture stops at an empty point (no piece beyond it)", moves.filter((m) => m.from === at(2, 2)).length === 1, JSON.stringify(moves));
  const r = moveTo(before, 1, mv);
  check("the captured approach pieces leave the board",
    r.after.b[at(2, 4)] === 0 && r.after.b[at(2, 5)] === 0 && r.after.b[at(2, 7)] === 2);
  check("the capturing piece lands on the point it stepped to", r.after.b[at(2, 3)] === 1 && r.after.b[at(2, 2)] === 0);
  check("the turn passes when no capture remains", r.after.t === 2 && r.after.from === -1, R.str(r.after));
  check("the server accepts an approach capture", accepted({ board: R.str(before) }, r.env, 1), JSON.stringify(validateTransition({ board: R.str(before) }, r.env, 1)));
}
{
  // Red at (2,4) steps east to (2,5), away from enemies behind at (2,3),(2,2)
  const before = mk([[at(2, 4), 1], [at(2, 3), 2], [at(2, 2), 2], [at(2, 0), 2], [at(0, 8), 2]]);
  const moves = R.gen(before, 1);
  const mv = captureMove(moves, at(2, 4), at(2, 5), 2);
  check("a withdrawal capture takes the unbroken line behind", !!mv && mv.n === 2, JSON.stringify(moves));
  check("a withdrawal capture is not also an approach capture", !has(moves, at(2, 4), at(2, 5), 1));
  const r = moveTo(before, 1, mv);
  check("the withdrawal pieces behind the start leave the board",
    r.after.b[at(2, 3)] === 0 && r.after.b[at(2, 2)] === 0 && r.after.b[at(2, 0)] === 2);
  check("the withdrawal piece lands away from the taken line", r.after.b[at(2, 5)] === 1);
  check("the server accepts a withdrawal capture", accepted({ board: R.str(before) }, r.env, 1), JSON.stringify(validateTransition({ board: R.str(before) }, r.env, 1)));
}
{
  // Both directions are open on the same step: two moves, one line each.
  const before = mk([[at(2, 4), 1], [at(2, 6), 2], [at(2, 3), 2], [at(0, 0), 2]]);
  const moves = R.gen(before, 1);
  const a = captureMove(moves, at(2, 4), at(2, 5), 1);
  const w = captureMove(moves, at(2, 4), at(2, 5), 2);
  check("when both lines are open there is a choice of two moves", !!a && !!w, JSON.stringify(moves));
  const ra = moveTo(before, 1, a), rw = moveTo(before, 1, w);
  check("the approach choice takes only the line ahead",
    ra.after.b[at(2, 6)] === 0 && ra.after.b[at(2, 3)] === 2);
  check("the withdrawal choice takes only the line behind",
    rw.after.b[at(2, 3)] === 0 && rw.after.b[at(2, 6)] === 2);
  check("one step never captures both lines", ra.after.b[at(2, 3)] === 2 && rw.after.b[at(2, 6)] === 2);
}

/* ---------- capturing is compulsory ---------- */
{
  const before = mk([[at(2, 2), 1], [at(2, 4), 2], [at(2, 5), 2], [at(4, 0), 1], [at(0, 8), 2]]);
  const moves = R.gen(before, 1);
  check("with a capture on the board only capturing moves are legal",
    moves.length > 0 && moves.every((m) => m.cap !== 0), JSON.stringify(moves));
  check("a quiet move elsewhere is not offered while a capture exists", !moves.some((m) => m.from === at(4, 0)));
  const quiet = { board: R.str(mk([[at(2, 2), 1], [at(2, 4), 2], [at(2, 5), 2], [at(4, 1), 1], [at(0, 8), 2]], 2)),
    status: "in_progress", winner: null, last: at(4, 0) * R.CELLS + at(4, 1) };
  check("the server refuses a quiet move while a capture was available",
    !accepted({ board: R.str(before) }, quiet, 1));
}

/* ---------- chain captures ---------- */
{
  // Red (2,2) takes (2,4) by approach, landing on (2,3); then the same piece
  // can take (0,3) by stepping to (1,3). Another Red piece must not move.
  const before = mk([[at(2, 2), 1], [at(2, 4), 2], [at(0, 3), 2], [at(4, 8), 1], [at(0, 8), 2]]);
  const first = captureMove(R.gen(before, 1), at(2, 2), at(2, 3), 1);
  const r1 = moveTo(before, 1, first);
  check("a capture that can continue leaves the same side to move", r1.after.t === 1 && r1.after.from === at(2, 3), R.str(r1.after));
  check("the wire records the chain point", R.parse(R.str(r1.after)).from === at(2, 3));
  check("a chain in progress is not a finished game", r1.o.status === "in_progress" && r1.o.chain === true && R.winner(r1.after) === 0);
  check("during a chain only the same piece may move", R.gen(r1.after, 1).every((m) => m.from === at(2, 3) && m.cap !== 0));
  check("the chain offers the next capture", has(R.gen(r1.after, 1), at(2, 3), at(1, 3), 1));
  const second = captureMove(R.gen(r1.after, 1), at(2, 3), at(1, 3), 1);
  const r2 = moveTo(r1.after, 1, second);
  check("the chain takes its second line", r2.after.b[at(0, 3)] === 0 && r2.after.b[at(1, 3)] === 1);
  check("the turn ends when the chain has no capture left", r2.after.t === 2 && r2.after.from === -1 && r2.o.status === "in_progress");
  check("both chain steps pass the server",
    accepted({ board: R.str(before) }, r1.env, 1) && accepted(r1.env, r2.env, 1),
    JSON.stringify(validateTransition({ board: R.str(before) }, r1.env, 1)) + " " + JSON.stringify(validateTransition(r1.env, r2.env, 1)));
  check("playTurn can play the whole chain in one call",
    R.str(R.playTurn(before, 1, [first, second])) === R.str(r2.after));
  check("playTurn refuses an illegal step", R.playTurn(before, 1, [{ from: at(2, 2), to: at(2, 3), cap: 0 }]) === null &&
    R.playTurn(before, 1, [first, { from: at(2, 3), to: at(2, 4), cap: 0 }]) === null);
  check("the server hands the turn back after the last chain step",
    validateTransition(r1.env, r2.env, 1).nextTurn === 2, JSON.stringify(validateTransition(r1.env, r2.env, 1)));
  // trying to move the other Red piece mid-chain
  const other = { board: R.str(mk([[at(2, 2), 1], [at(2, 4), 2], [at(0, 3), 2], [at(4, 7), 1], [at(0, 8), 2]], 1, at(2, 3))),
    status: "in_progress", winner: null, last: at(4, 8) * R.CELLS + at(4, 7) };
  check("the server refuses a different piece in the middle of a chain", !accepted(r1.env, other, 1));
  // trying to pass the turn on without completing the chain
  const passed = { board: R.str(mk([[at(2, 2), 1], [at(2, 4), 2], [at(0, 3), 2], [at(4, 8), 1], [at(0, 8), 2]], 2)),
    status: "in_progress", winner: null, last: r1.env.last };
  check("the server refuses to end a chain while a capture is available", !accepted(r1.env, passed, 1));
  // a wire that drops the chain mark is refused too
  const noChain = r1.env.board.slice(0, 46) + "j" + r1.env.board.slice(47);
  check("the server refuses a chain step with the chain mark removed",
    !accepted({ board: R.str(before) }, { ...r1.env, board: noChain }, 1));
}

/* ---------- winning: no pieces, or no legal move ---------- */
{
  const before = mk([[at(2, 2), 1], [at(2, 4), 2]]);
  const r = moveTo(before, 1, captureMove(R.gen(before, 1), at(2, 2), at(2, 3), 1));
  check("taking the last enemy piece wins", r.o.status === "won" && r.o.winner === 1, JSON.stringify(r.o));
  check("the winning capture is recorded in the wire",
    R.parse(r.env.board) !== null && r.after.b.filter((v) => v === 2).length === 0 && r.env.status === "won" && r.env.winner === 1);
}
{
  // Blue at the corner is walled in by Red: Red wins even though Blue is not captured.
  const s = mk([[at(0, 0), 2], [at(0, 1), 1], [at(1, 0), 1], [at(1, 1), 1]], 2);
  check("a side with no legal move loses", R.gen(s, 2).length === 0 && R.outcome(s, 1).status === "won" && R.outcome(s, 1).winner === 1);
  check("a side with no pieces loses", R.outcome(mk([[at(2, 2), 1]], 2), 1).winner === 1);
  check("a finished position is not a draw", R.outcome(s, 1).status === "won");
}

/* ---------- the quiet-turn draw ---------- */
{
  const before = mk([[at(4, 0), 1], [at(4, 8), 1], [at(0, 0), 2], [at(0, 8), 2]], 1, -1, 59);
  check("with no capture possible the quiet counter advances", R.gen(before, 1).every((m) => m.cap === 0));
  const r = moveTo(before, 1, { from: at(4, 0), to: at(4, 1), cap: 0 });
  check("60 quiet turns in a row is a draw", r.o.status === "draw" && r.o.winner === 0, JSON.stringify(r.o));
  check("the counter stops at 60 and the wire keeps it", r.after.c === 60 && /60$/.test(R.str(r.after)));
  check("the server accepts the draw", accepted({ board: R.str(before) }, r.env, 1));
  check("the server refuses a draw reported as in progress", !accepted({ board: R.str(before) }, { ...r.env, status: "in_progress", winner: null }, 1));
  check("the server refuses a draw with a winner", !accepted({ board: R.str(before) }, { ...r.env, winner: 1 }, 1));
  const capBefore = mk([[at(2, 2), 1], [at(2, 4), 2], [at(0, 8), 2]], 1, -1, 59);
  const capAfter = R.play(capBefore, 1, { from: at(2, 2), to: at(2, 3), cap: 1 });
  check("a capture resets the quiet counter", capAfter.c === 0);
}

/* ---------- random legal games, every move through the server's check ---------- */
{
  let ok = true, finished = 0, wins = { 1: 0, 2: 0 }, draws = 0, longest = 0, chains = 0;
  const gameRng = seeded(20261021);
  for (let g = 0; g < 20 && ok; g++) {
    let S = R.create(), p = 1, prev = null, done = false;
    for (let ply = 1; ply <= 1500; ply++) {
      const moves = R.gen(S, p);
      if (!moves.length) { ok = false; check("random games never hand a stuck player the move", false, "game " + g + ", ply " + ply); break; }
      const mv = moves[Math.floor(gameRng() * moves.length)];
      const r = moveTo(S, p, mv);
      const res = validateTransition(prev, r.env, p);
      if (!res.ok) { ok = false; check("a random legal move is accepted (game " + g + ", ply " + ply + ")", false, JSON.stringify(res)); break; }
      if (res.nextTurn !== r.after.t) { ok = false; check("the server hands on the right turn", false, res.nextTurn + " vs " + r.after.t); break; }
      if (r.after.from >= 0) chains++;
      prev = r.env; S = r.after; longest = Math.max(longest, ply);
      if (r.o.status !== "in_progress") {
        done = true; finished++;
        if (r.o.status === "draw") draws++; else wins[r.o.winner]++;
        break;
      }
      p = S.t;
    }
    if (!done && ok) { ok = false; check("random games finish", false, "game " + g + " ran past 1500 plies"); }
  }
  check("random legal games all pass the server's check", ok);
  check("all random games finish", finished === 20, finished + " of 20");
  check("both sides win some random games", wins[1] > 0 && wins[2] > 0, wins[1] + "/" + wins[2]);
  check("random play produces chain captures", chains > 0, chains);
  console.log("  (random games: " + wins[1] + " Red, " + wins[2] + " Blue, " + draws + " draws, " + chains + " chain steps, longest " + longest + " plies)");
}

/* ---------- the computer ---------- */
for (const lvl of ["easy", "medium", "hard"]) {
  let ok = true, done = 0;
  for (let g = 0; g < 2 && ok; g++) {
    let S = R.create(), p = 1, prev = null;
    const aiSide = g % 2 ? 1 : 2;
    for (let ply = 0; ply < 800; ply++) {
      const legal = R.gen(S, p);
      if (!legal.length) { ok = false; break; }
      let mv;
      if (p === aiSide) {
        mv = R.bestMove(R.str(S), p, lvl, Math.random);
        if (!mv || !legal.some((m) => m.from === mv.from && m.to === mv.to && m.cap === mv.cap)) {
          ok = false; check(lvl + " picks a legal move", false, JSON.stringify(mv)); break;
        }
      } else mv = rnd(legal);
      const r = moveTo(S, p, mv);
      if (!accepted(prev, r.env, p)) { ok = false; check(lvl + " move passes the server", false, JSON.stringify(r.env)); break; }
      prev = r.env; S = r.after;
      if (r.o.status !== "in_progress") { done++; break; }
      p = S.t;
    }
  }
  check(lvl + " always plays a legal move and its games finish", ok && done === 2, done + " of 2");
}
{
  const s = mk([[at(2, 2), 1], [at(2, 4), 2]]);
  const mv = R.bestMove(R.str(s), 1, "hard", () => 0.9);
  check("hard takes the capture that wins on the spot", mv && mv.from === at(2, 2) && mv.to === at(2, 3) && mv.cap === 1, JSON.stringify(mv));
  const before = mk([[at(2, 2), 1], [at(2, 4), 2], [at(2, 5), 2], [at(4, 0), 1], [at(0, 8), 2]]);
  const legal = R.gen(before, 1);
  for (const lvl of ["easy", "medium", "hard"]) {
    const pick = R.bestMove(R.str(before), 1, lvl, () => 0.9);
    check(lvl + " never ignores a compulsory capture", pick && legal.some((m) => m.from === pick.from && m.to === pick.to && m.cap === pick.cap));
  }
}

/* ---------- the server's validation, case by case ---------- */
{
  const S0 = R.create();
  const first = R.gen(S0, 1)[0];
  const A = moveTo(S0, 1, first).env;
  check("the server accepts the opening move", accepted(null, A, 1), JSON.stringify(validateTransition(null, A, 1)));
  check("the server refuses an opening move for Blue", !accepted(null, A, 2));
  check("the server refuses a wrong last-move index", !accepted(null, { ...A, last: A.last + 1 }, 1));
  check("the server refuses a changed cell",
    A.board.charAt(0) === "2" && !accepted(null, { ...A, board: "1" + A.board.slice(1) }, 1));
  check("the server refuses the wrong status", !accepted(null, { ...A, status: "won", winner: 1 }, 1));
  check("the server refuses a winner on a running position", !accepted(null, { ...A, status: "in_progress", winner: 1 }, 1));
}
{
  const before = mk([[at(2, 2), 1], [at(2, 4), 2], [at(2, 5), 2], [at(0, 8), 2]]);
  const mv = captureMove(R.gen(before, 1), at(2, 2), at(2, 3), 1);
  const prev = { board: R.str(before) };
  const cap = moveTo(before, 1, mv);
  check("the server accepts an approach capture", accepted(prev, cap.env, 1), JSON.stringify(validateTransition(prev, cap.env, 1)));
  check("the server refuses a capture that leaves an enemy on the line",
    !accepted(prev, { ...cap.env, board: cap.env.board.slice(0, at(2, 4)) + "2" + cap.env.board.slice(at(2, 4) + 1) }, 1));
  check("the server refuses a move that removes an extra piece",
    !accepted(prev, { ...cap.env, board: cap.env.board.slice(0, at(0, 8)) + "0" + cap.env.board.slice(at(0, 8) + 1) }, 1));
  const jump = mk([[at(2, 2), 1], [at(2, 4), 2], [at(2, 5), 2], [at(0, 8), 2]]);
  jump.b[at(2, 4)] = 1; jump.b[at(2, 2)] = 0; jump.t = 2;
  check("the server refuses a two-point jump", !accepted(prev, { board: R.str(jump), status: "in_progress", winner: null, last: at(2, 2) * R.CELLS + at(2, 4) }, 1));
  const wrong = mk([[at(2, 2), 1], [at(2, 4), 2], [at(2, 5), 2], [at(0, 8), 2]]);
  wrong.b[at(2, 3)] = 1; wrong.b[at(2, 2)] = 0; wrong.b[at(2, 4)] = 0; wrong.t = 2;
  check("the server refuses a capture that takes the wrong line",
    !accepted(prev, { board: R.str(wrong), status: "in_progress", winner: null, last: at(2, 2) * R.CELLS + at(2, 3) }, 1));
}
{
  // a quiet step in a position where no capture exists is accepted
  const before = mk([[at(4, 0), 1], [at(4, 8), 1], [at(0, 0), 2], [at(0, 8), 2]], 1, -1, 10);
  const mv = { from: at(4, 0), to: at(4, 1), cap: 0 };
  const r = moveTo(before, 1, mv);
  check("the server accepts a quiet step", accepted({ board: R.str(before) }, r.env, 1), JSON.stringify(validateTransition({ board: R.str(before) }, r.env, 1)));
  check("the server refuses a move that the previous position's turn does not own",
    !accepted({ board: R.str({ ...before, t: 2 }) }, r.env, 2));
  check("the server refuses a move by the side not to move", !accepted({ board: R.str(before) }, r.env, 2));
}
{
  const before = mk([[at(2, 2), 1], [at(2, 4), 2]]);
  const cap = moveTo(before, 1, captureMove(R.gen(before, 1), at(2, 2), at(2, 3), 1));
  check("the winning move is reported as won", cap.env.status === "won" && cap.env.winner === 1, JSON.stringify(cap.env));
  check("the server accepts the winning move", accepted({ board: R.str(before) }, cap.env, 1));
  check("the server refuses a win reported as still running", !accepted({ board: R.str(before) }, { ...cap.env, status: "in_progress", winner: null }, 1));
  check("the server refuses a win for the wrong side", !accepted({ board: R.str(before) }, { ...cap.env, winner: 2 }, 1));
}

console.log(fail ? `\n${pass} passed, ${fail} FAILED` : `\n${pass} passed`);
process.exit(fail ? 1 : 0);
