/* Run: node worker/rules/tablut.test.mjs
   Setup, rook movement and blocking, sandwich captures, the throne and corner
   rules, the king's escape and capture, the no-move loss, random legal games,
   the computer, and the server's own validation. */
import { validateTransition } from "./tablut.mjs";

const R = globalThis.TablutRules;
let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) pass++;
  else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? " — " + detail : "")); }
}
const rnd = (a) => a[Math.floor(Math.random() * a.length)];
const at = (r, c) => r * 9 + c;
const has = (moves, from, to) => moves.some((m) => m.from === from && m.to === to);

// a board from a list of [index, value], plus the side to move
const mk = (cells, t = 1) => { const b = new Array(81).fill(0); for (const [i, v] of cells) b[i] = v; return { b, t }; };

// Apply one move the way the page does and build the envelope the server sees.
function moveTo(before, mover, mv) {
  const after = R.play(before, mover, mv);
  if (!after) return { after: null, o: null, env: null };
  const o = R.outcome(after, mover);
  return { after, o, env: { board: R.str(after), status: o.status, winner: o.winner || null, last: mv.from * 9 + mv.to } };
}
const accepted = (prev, next, mover) => validateTransition(prev, next, mover).ok === true;
const KING_FAR = [at(8, 4), 3];       // a king parked out of the way, on the bottom edge

console.log("tablut:");

/* ---------- setup ---------- */
const start = R.create();
const wire = R.str(start);
check("the opening position round-trips through the wire", R.parse(wire) !== null && R.str(R.parse(wire)) === wire);
check("the wire is 81 cells and the side to move", wire.length === 82 && /^[0-3]{81}1$/.test(wire), wire);
check("initial() is the opening wire", R.initial() === wire);
check("the king starts on the throne", start.b[R.THRONE] === R.KING && R.THRONE === at(4, 4));
check("eight defenders stand around the king", [
  at(3, 3), at(3, 4), at(3, 5), at(4, 3), at(4, 5), at(5, 3), at(5, 4), at(5, 5),
].every((i) => start.b[i] === R.DEFENDER) && start.b.filter((v) => v === R.DEFENDER).length === 8);
{
  const want = [
    at(0, 3), at(0, 4), at(0, 5), at(1, 4),
    at(8, 3), at(8, 4), at(8, 5), at(7, 4),
    at(3, 0), at(4, 0), at(5, 0), at(4, 1),
    at(3, 8), at(4, 8), at(5, 8), at(4, 7),
  ].sort((a, b) => a - b);
  const got = [];
  for (let i = 0; i < 81; i++) if (start.b[i] === R.ATTACKER) got.push(i);
  check("sixteen attackers hold the middle of the four edges", got.length === 16 && got.join() === want.join());
}
check("attackers move first", start.t === 1);
check("the opening is not already won", R.winnerOf(start) === 0 && R.outcome(start, 1).status === "in_progress");
check("the opening offers room to move", R.gen(start, 1).length === 68 && R.gen(start, 2).length === 20,
  R.gen(start, 1).length + "/" + R.gen(start, 2).length);
check("a malformed wire is rejected",
  R.parse("0".repeat(82)) === null && R.parse(wire.slice(1)) === null &&
  R.parse(wire.slice(0, 81) + "3") === null && R.parse(wire.slice(0, 80) + "31") === null);
{
  const noKing = wire.slice(0, R.THRONE) + "0" + wire.slice(R.THRONE + 1);
  const twoKings = wire.slice(0, 41) + "3" + wire.slice(42);
  const soldierThrone = wire.slice(0, R.THRONE) + "1" + wire.slice(R.THRONE + 1);
  const soldierCorner = "1" + wire.slice(1);
  check("the wire needs exactly one king", R.parse(noKing) === null && R.parse(twoKings) === null);
  check("only the king may stand on the throne or a corner",
    R.parse(soldierThrone) === null && R.parse(soldierCorner) === null);
}

/* ---------- the rook move ---------- */
{
  const s = mk([KING_FAR, [at(2, 2), 1], [at(2, 5), 2], [at(5, 2), 2]], 1);
  const moves = R.gen(s, 1);
  check("a piece slides along a rank and a file", has(moves, at(2, 2), at(2, 1)) && has(moves, at(2, 2), at(0, 2)));
  check("a piece slides as far as the board edge", has(moves, at(2, 2), at(2, 0)) && has(moves, at(2, 2), at(0, 2)));
  check("an enemy in the way stops the slide", !has(moves, at(2, 2), at(2, 6)) && !has(moves, at(2, 2), at(6, 2)));
  check("a piece cannot jump a piece", !has(moves, at(2, 2), at(2, 5)) && !has(moves, at(2, 2), at(5, 2)));
  check("a piece does not move diagonally", !has(moves, at(2, 2), at(3, 3)) && !has(moves, at(2, 2), at(1, 1)));
  check("every generated move stays on the board", moves.every((m) => m.to >= 0 && m.to < 81 && m.from !== m.to));
}
check("your own piece stops the slide",
  !has(R.gen(mk([KING_FAR, [at(2, 2), 1], [at(2, 4), 1]], 1), 1), at(2, 2), at(2, 4)));
check("a piece on the edge does not fall off",
  R.gen(mk([KING_FAR, [at(0, 4), 1]], 1), 1).every((m) => (m.to / 9 | 0) >= 0 && (m.to / 9 | 0) < 9));

/* ---------- the throne and the corners ---------- */
{
  const s = mk([KING_FAR, [at(4, 2), 1]], 1);
  const moves = R.gen(s, 1);
  check("only the king may stop on the throne", !has(moves, at(4, 2), at(4, 4)));
  check("an empty throne can be slid over", has(moves, at(4, 2), at(4, 5)) && has(moves, at(4, 2), at(4, 8)));
}
{
  const s = mk([[at(8, 7), 1], [at(4, 2), 3]], 2);
  const moves = R.gen(s, 2);
  check("the king may stop on the throne", has(moves, at(4, 2), at(4, 4)));
  check("the king may slide over the throne too", has(moves, at(4, 2), at(4, 6)));
}
check("a soldier may not stop on a corner",
  !has(R.gen(mk([KING_FAR, [at(0, 1), 1]], 1), 1), at(0, 1), at(0, 0)));
check("the king may stop on a corner",
  has(R.gen(mk([[at(8, 7), 1], [at(0, 1), 3]], 2), 2), at(0, 1), at(0, 0)));

/* ---------- sandwich captures ---------- */
{
  const before = mk([KING_FAR, [at(2, 3), 2], [at(2, 6), 2], [at(2, 5), 1]], 2);
  const mv = { from: at(2, 3), to: at(2, 4) };
  check("a defender can make the capturing move", has(R.gen(before, 2), mv.from, mv.to));
  const r = moveTo(before, 2, mv);
  check("a defender's move captures a squeezed attacker",
    r.after.b[at(2, 5)] === 0 && r.after.b[at(2, 4)] === 2 && r.after.b[at(2, 6)] === 2);
}
{
  const before = mk([KING_FAR, [at(3, 2), 1], [at(5, 2), 2], [at(6, 2), 1]], 1);
  const r = moveTo(before, 1, { from: at(3, 2), to: at(4, 2) });
  check("an attacker's move captures a squeezed defender", r.after.b[at(5, 2)] === 0 && r.after.b[at(4, 2)] === 1);
}
{
  // three squeezed defenders in one move: left, right and below the landing square
  const before = mk([
    KING_FAR,
    [at(0, 3), 1], [at(2, 1), 1], [at(2, 5), 1], [at(4, 3), 1],
    [at(2, 2), 2], [at(2, 4), 2], [at(3, 3), 2],
  ], 1);
  const mv = { from: at(0, 3), to: at(2, 3) };
  check("the three-in-one move is legal", has(R.gen(before, 1), mv.from, mv.to));
  const r = moveTo(before, 1, mv);
  check("one move can capture three soldiers",
    r.after.b[at(2, 2)] === 0 && r.after.b[at(2, 4)] === 0 && r.after.b[at(3, 3)] === 0 &&
    r.after.b[at(2, 1)] === 1 && r.after.b[at(2, 5)] === 1 && r.after.b[at(4, 3)] === 1);
}
{
  // a soldier that steps between two enemies is not captured
  const before = mk([KING_FAR, [at(0, 3), 1], [at(2, 2), 2], [at(2, 4), 2]], 1);
  const r = moveTo(before, 1, { from: at(0, 3), to: at(2, 3) });
  check("a piece moving into a gap between two enemies survives",
    r.after.b[at(2, 3)] === 1 && r.after.b[at(2, 2)] === 2 && r.after.b[at(2, 4)] === 2);
}
{
  // the empty throne is not a soldier: it does not squeeze a defender
  const before = mk([KING_FAR, [at(4, 1), 1], [at(4, 3), 2]], 1);
  const r = moveTo(before, 1, { from: at(4, 1), to: at(4, 2) });
  check("the throne does not squeeze a soldier", r.after.b[at(4, 3)] === 2);
}
{
  // the empty corner is not a soldier either
  const before = mk([KING_FAR, [at(0, 3), 1], [at(0, 1), 2]], 1);
  const r = moveTo(before, 1, { from: at(0, 3), to: at(0, 2) });
  check("a corner does not squeeze a soldier", r.after.b[at(0, 1)] === 2);
}
{
  // the king is unarmed and cannot be the second soldier of a sandwich
  const before = mk([[at(2, 2), 2], [at(2, 4), 1], [at(2, 5), 3]], 2);
  const r = moveTo(before, 2, { from: at(2, 2), to: at(2, 3) });
  check("the king does not squeeze an attacker for a defender", r.after.b[at(2, 4)] === 1);
}
{
  // the king itself never captures
  const before = mk([[at(2, 3), 3], [at(2, 5), 1], [at(2, 6), 2]], 2);
  const r = moveTo(before, 2, { from: at(2, 3), to: at(2, 4) });
  check("the king's move removes nothing", r.after.b[at(2, 5)] === 1 && r.after.b[at(2, 4)] === 3);
}

/* ---------- the king: four sides ---------- */
{
  const four = mk([[at(2, 2), 3], [at(1, 2), 1], [at(3, 2), 1], [at(2, 1), 1], [at(2, 3), 1]], 1);
  check("four attackers on four sides capture the king", R.winnerOf(four) === 1);
  const three = mk([[at(2, 2), 3], [at(1, 2), 1], [at(3, 2), 1], [at(2, 1), 1]], 1);
  check("three attackers in the open do not", R.winnerOf(three) === 0);
  const shielded = mk([[at(2, 2), 3], [at(1, 2), 1], [at(3, 2), 1], [at(2, 1), 1], [at(2, 3), 2]], 1);
  check("a defender beside the king keeps it alive", R.winnerOf(shielded) === 0);
  const side = mk([[at(2, 2), 3], [at(2, 1), 1], [at(2, 3), 1]], 1);
  check("two attackers on a rank do not capture the king", R.winnerOf(side) === 0);
  const byThrone = mk([[at(4, 3), 3], [at(3, 3), 1], [at(5, 3), 1], [at(4, 2), 1]], 2);
  check("three attackers plus the empty throne capture the king", R.winnerOf(byThrone) === 1);
  const edge = mk([[at(0, 4), 3], [at(0, 3), 1], [at(0, 5), 1], [at(1, 4), 1]], 1);
  check("three attackers plus the edge capture the king", R.winnerOf(edge) === 1);
  const edgeCorner = mk([[at(0, 1), 3], [at(0, 2), 1], [at(1, 1), 1]], 1);
  check("two attackers with an edge and a corner capture the king", R.winnerOf(edgeCorner) === 1);
  const safeCorner = mk([[at(0, 0), 3], [at(0, 1), 1], [at(1, 0), 1]], 1);
  check("the king on a corner has escaped, whatever surrounds it", R.winnerOf(safeCorner) === 2);
}
{
  const before = mk([[at(2, 2), 3], [at(1, 2), 1], [at(3, 2), 1], [at(2, 1), 1], [at(2, 4), 1], [at(7, 7), 2]], 1);
  const mv = { from: at(2, 4), to: at(2, 3) };
  check("the capturing move is legal", has(R.gen(before, 1), mv.from, mv.to));
  const r = moveTo(before, 1, mv);
  check("the king is captured by the move", r.o.status === "won" && r.o.winner === 1 && r.o.reason === "king", JSON.stringify(r.o));
  const prev = { board: R.str(before) };
  check("the server accepts the king's capture", accepted(prev, r.env, 1));
  check("the server refuses the capture reported as in progress",
    !accepted(prev, { ...r.env, status: "in_progress", winner: null }, 1));
  check("the server refuses the capture credited to the defenders",
    !accepted(prev, { ...r.env, winner: 2 }, 1));
}

/* ---------- the king: the escape to a corner ---------- */
for (const [kr, kc, tr, tc] of [[1, 0, 0, 0], [1, 8, 0, 8], [7, 0, 8, 0], [7, 8, 8, 8]]) {
  const before = mk([[at(kr, kc), 3], [at(6, 6), 2], [at(8, 7), 1]], 2);
  // (6,6) may collide with a piece in the corner cases; ignore those two positions
  before.b[at(6, 6)] = 2;
  const mv = { from: at(kr, kc), to: at(tr, tc) };
  const r = moveTo(before, 2, mv);
  check("the king reaches the corner " + tr + "," + tc + " and wins",
    r.o && r.o.status === "won" && r.o.winner === 2 && r.o.reason === "escape", r.o && JSON.stringify(r.o));
  check("the server accepts the escape at " + tr + "," + tc, accepted({ board: R.str(before) }, r.env, 2));
}
{
  const before = mk([[at(1, 4), 3], [at(6, 6), 2], [at(8, 7), 1]], 2);
  const r = moveTo(before, 2, { from: at(1, 4), to: at(3, 4) });
  check("a king move that misses the corner does not win", r.o.status === "in_progress");
  const corner = mk([[at(1, 0), 3], [at(6, 6), 2], [at(8, 7), 1]], 2);
  const escape = moveTo(corner, 2, { from: at(1, 0), to: at(0, 0) });
  const env = { ...escape.env, status: "in_progress", winner: null };
  check("the server refuses an escape reported as in progress", !accepted({ board: R.str(corner) }, env, 2));
  check("the server refuses an escape credited to the attackers",
    !accepted({ board: R.str(corner) }, { ...escape.env, winner: 1 }, 2));
}

/* ---------- no legal move loses ---------- */
{
  const stuck = mk([
    [at(0, 4), 3],
    [at(0, 3), 2], [at(0, 5), 2], [at(1, 4), 2],
    [at(0, 2), 1], [at(1, 3), 1], [at(0, 6), 1], [at(1, 5), 1], [at(2, 4), 1],
  ], 2);
  check("the defenders are walled in", R.gen(stuck, 2).length === 0, R.gen(stuck, 2).length);
  check("a walled-in king is not the same as a captured one", R.winnerOf(stuck) === 0);
  const o = R.outcome(stuck, 1);
  check("a side with no legal move loses", o.status === "won" && o.winner === 1 && o.reason === "stuck", JSON.stringify(o));
}
{
  // attackers to move after the defender has just moved: the single attacker is boxed in
  const before = mk([
    [at(4, 4), 3],
    [at(0, 1), 1], [at(0, 2), 2], [at(1, 1), 2], [at(2, 1), 2],
  ], 2);
  check("the lone attacker has nowhere to go", R.gen(before, 1).length === 0);
  const mv = { from: at(2, 1), to: at(2, 2) };
  check("the defender's waiting move is legal", has(R.gen(before, 2), mv.from, mv.to));
  const r = moveTo(before, 2, mv);
  check("the no-move loss is won by the side that just moved",
    r.o.status === "won" && r.o.winner === 2 && r.o.reason === "stuck", JSON.stringify(r.o));
  const prev = { board: R.str(before) };
  check("the server accepts a no-move win", accepted(prev, r.env, 2), JSON.stringify(validateTransition(prev, r.env, 2)));
  check("the server refuses a no-move win reported as in progress",
    !accepted(prev, { ...r.env, status: "in_progress", winner: null }, 2));
  check("the server refuses a no-move win for the wrong side",
    !accepted(prev, { ...r.env, winner: 1 }, 2));
}

/* ---------- random legal games, every move through the server's check ---------- */
{
  let ok = true, finished = 0, wins = { 1: 0, 2: 0 }, plies = 0;
  for (let g = 0; g < 12 && ok; g++) {
    let S = R.create(), p = 1, prev = null, done = false;
    for (let ply = 1; ply <= 140; ply++) {
      const moves = R.gen(S, p);
      if (!moves.length) { ok = false; check("a random game always has a move until it ends", false, "game " + g + ", ply " + ply); break; }
      const mv = rnd(moves);
      const r = moveTo(S, p, mv);
      const res = validateTransition(prev, r.env, p);
      if (!res.ok) { ok = false; check("a random legal move is accepted (game " + g + ", ply " + ply + ")", false, JSON.stringify(res)); break; }
      if (res.nextTurn !== R.other(p)) { ok = false; check("the server hands the turn on", false, res.nextTurn); break; }
      prev = r.env; S = r.after; plies++;
      if (r.o.status !== "in_progress") { done = true; finished++; wins[r.o.winner]++; break; }
      p = R.other(p);
    }
    if (!done && ok) { /* hit the ply cap: fine, just make sure it was all accepted */ }
  }
  check("random legal games all pass the server's check", ok);
  console.log("  (random games: " + plies + " plies checked, " + finished + " finished, " +
    wins[1] + " attackers / " + wins[2] + " defenders)");
}

/* ---------- the computer ---------- */
for (const lvl of ["easy", "medium", "hard"]) {
  let ok = true, moves = 0;
  for (let g = 0; g < 2 && ok; g++) {
    let S = R.create(), p = 1;
    const aiSide = (g + (lvl === "hard" ? 1 : 0)) % 2 ? 1 : 2;    // try both sides
    for (let ply = 0; ply < 18; ply++) {
      const legal = R.gen(S, p);
      if (!legal.length) break;
      let mv;
      if (p === aiSide) {
        mv = R.bestMove(R.str(S), p, lvl, Math.random);
        moves++;
        if (!mv || !has(legal, mv.from, mv.to)) {
          ok = false;
          check(lvl + " picks a legal move", false, JSON.stringify(mv));
          break;
        }
      } else mv = rnd(legal);
      const r = moveTo(S, p, mv);
      if (!r.after) { ok = false; check(lvl + " produces a playable board", false, JSON.stringify(mv)); break; }
      if (!accepted({ board: R.str(S) }, r.env, p)) {
        ok = false;
        check(lvl + " move passes the server", false, JSON.stringify(r.env));
        break;
      }
      S = r.after;
      if (r.o.status !== "in_progress") break;
      p = R.other(p);
    }
  }
  check(lvl + " always plays a legal move and its moves pass the server", ok && moves > 0);
}
{
  const s = mk([[at(1, 0), 3], [at(5, 5), 2], [at(8, 7), 1]], 2);
  for (const lvl of ["easy", "medium", "hard"]) {
    const mv = R.bestMove(R.str(s), 2, lvl, () => 0.9);
    check(lvl + " takes the king to the corner", mv && mv.from === at(1, 0) && mv.to === at(0, 0), JSON.stringify(mv));
  }
}
{
  const s = mk([[at(2, 2), 3], [at(1, 2), 1], [at(3, 2), 1], [at(2, 1), 1], [at(2, 4), 1], [at(7, 7), 2]], 1);
  for (const lvl of ["easy", "medium", "hard"]) {
    const mv = R.bestMove(R.str(s), 1, lvl, () => 0.9);
    check(lvl + " captures the king when it can", mv && mv.from === at(2, 4) && mv.to === at(2, 3), JSON.stringify(mv));
  }
}
check("the computer has nothing to play with no pieces",
  R.bestMove(R.str(mk([[at(8, 4), 3]], 1)), 1, "hard") === null);
check("the computer refuses a malformed wire", R.bestMove("nonsense", 1, "hard") === null);

/* ---------- the server's validation ---------- */
{
  const S0 = R.create();
  const first = R.gen(S0, 1)[0];
  const A = moveTo(S0, 1, first).env;
  check("the server accepts the opening move", accepted(null, A, 1), JSON.stringify(validateTransition(null, A, 1)));
  check("the server hands the turn to the defenders", validateTransition(null, A, 1).nextTurn === 2);
  check("the server refuses an opening move for the defenders", !accepted(null, A, 2));
  check("the server refuses a wrong last-move index", !accepted(null, { ...A, last: A.last + 1 }, 1));
  check("the server refuses an altered board",
    !accepted(null, { ...A, board: A.board.slice(0, 30) + (A.board[30] === "1" ? "0" : "1") + A.board.slice(31) }, 1));
  check("the server refuses the wrong status", !accepted(null, { ...A, status: "won", winner: 1 }, 1));
  check("the server refuses a winner on a quiet position", !accepted(null, { ...A, status: "in_progress", winner: 1 }, 1));
  check("the server refuses a null next state", !accepted(null, null, 1));
  check("the server refuses an unknown mover", !accepted(null, A, 3));
}
{
  const before = mk([KING_FAR, [at(2, 1), 1], [at(2, 3), 2], [at(2, 4), 1]], 1);
  const prev = { board: R.str(before) };
  const cap = moveTo(before, 1, { from: at(2, 1), to: at(2, 2) });
  check("the server accepts a capture", accepted(prev, cap.env, 1), JSON.stringify(validateTransition(prev, cap.env, 1)));
  check("a soldier capture leaves the game running", cap.env.status === "in_progress" && cap.env.winner === null);
  // a piece that jumps two squares, over an occupied one, is refused
  const jumpBefore = mk([KING_FAR, [at(4, 1), 1], [at(4, 2), 2]], 1);
  const jumpAfter = { b: jumpBefore.b.slice(), t: 2 };
  jumpAfter.b[at(4, 3)] = 1; jumpAfter.b[at(4, 1)] = 0;
  check("the server refuses a two-square jump",
    !accepted({ board: R.str(jumpBefore) }, { board: R.str(jumpAfter), status: "in_progress", winner: null, last: at(4, 1) * 9 + at(4, 3) }, 1));
  // a diagonal move is refused
  const diagBefore = mk([KING_FAR, [at(2, 2), 1]], 1);
  const diagAfter = { b: diagBefore.b.slice(), t: 2 };
  diagAfter.b[at(3, 3)] = 1; diagAfter.b[at(2, 2)] = 0;
  check("the server refuses a diagonal move",
    !accepted({ board: R.str(diagBefore) }, { board: R.str(diagAfter), status: "in_progress", winner: null, last: at(2, 2) * 9 + at(3, 3) }, 1));
  // a soldier cannot land on the throne
  const throneBefore = mk([KING_FAR, [at(4, 2), 1]], 1);
  const throneAfter = { b: throneBefore.b.slice(), t: 2 };
  throneAfter.b[R.THRONE] = 1; throneAfter.b[at(4, 2)] = 0;
  check("the server refuses a soldier on the throne",
    !accepted({ board: R.str(throneBefore) }, { board: R.str(throneAfter), status: "in_progress", winner: null, last: at(4, 2) * 9 + R.THRONE }, 1));
  // a faked capture (a defender vanishes although the move does not squeeze it)
  const fakeBefore = mk([KING_FAR, [at(2, 2), 1], [at(5, 5), 2]], 1);
  const fakeAfter = { b: fakeBefore.b.slice(), t: 2 };
  fakeAfter.b[at(2, 1)] = 1; fakeAfter.b[at(2, 2)] = 0; fakeAfter.b[at(5, 5)] = 0;
  check("the server refuses a faked capture",
    !accepted({ board: R.str(fakeBefore) }, { board: R.str(fakeAfter), status: "in_progress", winner: null, last: at(2, 2) * 9 + at(2, 1) }, 1));
  // a move by the side that is not to move
  check("the server refuses a move by the side that is not to move",
    !accepted(prev, cap.env, 2));
  check("the server refuses a move from a position whose turn is wrong",
    !accepted({ board: R.str({ ...before, t: 2 }) }, cap.env, 1));
  check("the server refuses a stale previous position",
    !accepted({ board: R.str(start) }, cap.env, 1));
}

console.log(fail ? `\n${pass} passed, ${fail} FAILED` : `\n${pass} passed`);
process.exit(fail ? 1 : 0);
