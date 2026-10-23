/* Run: node worker/rules/connect6.test.mjs
   The opening (one stone), later turns (two stones), the nearly-full short
   turn, six in a row in every direction, draws, illegal placements and
   turns, the computer, random games through the server's check, and the real
   live-room protocol (which puts a move through validateTransition the same
   way worker/live-protocol.mjs does). */
import { validateTransition } from "./connect6.mjs";
import * as c6 from "./connect6.mjs";
import { newRoom, join, applyMove } from "../live-protocol.mjs";
import { LIVE_GAMES } from "../live-games.mjs";

const R = globalThis.Connect6Rules;
let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) pass++;
  else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? " — " + detail : "")); }
}
const N = R.N, CELLS = R.CELLS;
const at = (r, c) => r * N + c;
const rnd = (a) => a[Math.floor(Math.random() * a.length)];
const accepted = (prev, next, mover) => validateTransition(prev, next, mover).ok === true;

// a small deterministic PRNG, so a failing random game can be reproduced
let seed = 0x9e3779b9;
const rng = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
};

// board from [index, value] pairs, plus side to move and stones placed this turn
function mk(cells, t = 1, p = 0) {
  const b = new Array(CELLS).fill(0);
  for (const [i, v] of cells) b[i] = v;
  return R.parse(b.join("") + t + p);
}
const wireOf = (S) => R.str(S);

// play the points in order; stop when the turn ends. Null if a point is illegal.
function turnResult(before, mover, points) {
  let S = before;
  const applied = [];
  for (const i of points) {
    if (S.t !== mover) break;
    const T = R.play(S, mover, i);
    if (!T) return null;
    S = T;
    applied.push(i);
  }
  const o = R.outcome(S, mover);
  return {
    S: S, applied: applied,
    env: { board: R.str(S), status: o.status, winner: o.winner || null, last: R.encodeLast(applied) },
    o: o,
  };
}

// A board with no six anywhere: colour = (row + 2*column) mod 4. Rows alternate
// every point, columns and both diagonals never run past two.
function filler(leaves) {
  const b = new Array(CELLS);
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) b[r * N + c] = ((r + 2 * c) % 4) < 2 ? 1 : 2;
  }
  for (const i of leaves || []) b[i] = 0;
  return b;
}
const fillerWire = (leaves, t = 1) => filler(leaves).join("") + t + "0";

// random legal turn, choosing points near the stones half the time so games
// build shapes instead of scattering over the whole board
function nearStones(S, i) {
  const r0 = (i / N) | 0, c0 = i % N;
  for (let dr = -2; dr <= 2; dr++) {
    for (let dc = -2; dc <= 2; dc++) {
      const r = r0 + dr, c = c0 + dc;
      if (r >= 0 && r < N && c >= 0 && c < N && S.b[r * N + c]) return true;
    }
  }
  return false;
}
function randomPoints(S, mover) {
  const rem = R.remaining(S);
  const free = R.gen(S, mover);
  if (free.length < rem) return null;
  const out = [];
  for (let k = 0; k < rem; k++) {
    let pool = free;
    if (free.length > 8 && rng() < 0.55) {
      const near = free.filter((i) => nearStones(S, i));
      if (near.length) pool = near;
    }
    const pick = pool[Math.floor(rng() * pool.length)];
    out.push(pick);
    free.splice(free.indexOf(pick), 1);
  }
  return out;
}

console.log("connect6:");

/* ---------- the wire and the opening position ---------- */
{
  const start = R.create();
  const wire = wireOf(start);
  check("the board is 15x15 (225 points)", N === 15 && CELLS === 225);
  check("the opening wire is 225 points, the turn and a placed count", wire.length === 227 && /^[012]{225}10$/.test(wire), wire.length);
  check("the opening wire round-trips", R.parse(wire) !== null && wireOf(R.parse(wire)) === wire);
  check("the opening has no stones and Black to move", start.b.every((v) => v === 0) && start.t === 1 && start.p === 0);
  check("Black may open on any of the 225 points", R.gen(start, 1).length === 225);
  check("White has no move before Black opens", R.gen(start, 2).length === 0);
  check("the opening turn is one stone", R.need(start) === 1 && R.remaining(start) === 1);
  check("a malformed wire is refused", R.parse("0".repeat(226)) === null && R.parse(wire.slice(1)) === null &&
    R.parse(wire.slice(0, 225) + "31") === null && R.parse(wire.slice(0, 225) + "13") === null &&
    R.parse(wire.slice(0, 225) + "12") === null);
  check("a wire with a placed count but no stone of that side is refused",
    R.parse("0".repeat(225) + "11") === null);
}

/* ---------- one integer names the new points ---------- */
{
  const a = at(3, 4), b = at(9, 12);
  check("a single point survives the last-move encoding", R.decodeLast(R.encodeLast([a])).join() === String(a));
  check("two points survive the last-move encoding", R.decodeLast(R.encodeLast([a, b])).join() === [a, b].join());
  check("the last mark is always an integer", Number.isInteger(R.encodeLast([a, b])) && Number.isInteger(R.encodeLast([a])));
  check("a bad last mark is refused", R.encodeLast([]) === null && R.encodeLast([a, b, a]) === null &&
    R.decodeLast(-1) === null && R.decodeLast(1.5) === null && R.decodeLast(a * 256 + 255) !== null &&
    R.decodeLast(224 * 256 + 224) !== null);
}

/* ---------- the opening turn: one stone ---------- */
{
  const start = R.create();
  const centre = at(7, 7);
  const after = R.play(start, 1, centre);
  check("Black's opening stone is allowed", !!after && after.b[centre] === 1);
  check("the opening hands the turn to White", after && after.t === 2 && after.p === 0);
  check("White's first turn asks for two stones", R.remaining(after) === 2);
  const open = turnResult(start, 1, [centre]);
  check("the server accepts the one-stone opening", accepted(null, open.env, 1), JSON.stringify(validateTransition(null, open.env, 1)));
  check("the server hands the turn on after the opening", validateTransition(null, open.env, 1).nextTurn === 2);
  check("the opening cannot be claimed by White", !accepted(null, open.env, 2));
  // two Black stones in the opening: a legal wire cannot be reached, and a hand-made one is refused
  const two = mk([[at(7, 7), 1], [at(7, 8), 1]], 2, 0);
  const fancy = { board: wireOf(two), status: "in_progress", winner: null, last: R.encodeLast([at(7, 7), at(7, 8)]) };
  check("the opening cannot place two stones", !accepted(null, fancy, 1));
  check("the opening cannot place zero stones", !accepted(null, { board: R.initial(), status: "in_progress", winner: null, last: R.encodeLast([centre]) }, 2));
  check("a stone on an occupied point is refused", R.play(after, 2, centre) === null);
  check("a point off the board is refused", R.play(after, 2, CELLS) === null && R.play(after, 2, -1) === null && R.play(after, 2, 1.5) === null);
  check("the side that is not to move cannot place", R.play(after, 1, at(0, 0)) === null);
}

/* ---------- later turns: two stones, then the turn passes ---------- */
{
  const start = R.create();
  let S = R.play(start, 1, at(7, 7));
  const first = R.play(S, 2, at(6, 6));
  check("the first of White's two stones keeps White to move", first && first.t === 2 && first.p === 1, first && wireOf(first).slice(-2));
  check("White still has one stone to place", first && R.remaining(first) === 1);
  check("the first stone alone leaves 223 empty points", first && R.gen(first, 2).length === 223);
  const second = R.play(first, 2, at(6, 8));
  check("the second stone finishes White's turn", second && second.t === 1 && second.p === 0);
  check("White's two stones are on the board", second && second.b[at(6, 6)] === 2 && second.b[at(6, 8)] === 2);
  const fullTurn = turnResult(S, 2, [at(6, 6), at(6, 8)]);
  const prev = { board: wireOf(S) };
  check("the server accepts a complete two-stone turn", accepted(prev, fullTurn.env, 2), JSON.stringify(validateTransition(prev, fullTurn.env, 2)));
  check("the two stones may be far apart", accepted(prev, turnResult(S, 2, [at(0, 0), at(14, 14)]).env, 2));
  const partial = turnResult(S, 2, [at(6, 6)]);
  check("a half-finished turn is refused", !accepted(prev, partial.env, 2), JSON.stringify(validateTransition(prev, partial.env, 2)));
  const wrongSeat = turnResult(S, 2, [at(6, 6), at(6, 8)]);
  check("a turn claimed by the side that is not to move is refused", !accepted(prev, wrongSeat.env, 1));
  check("the same point twice is refused", !accepted(prev, { board: wireOf(S), status: "in_progress", winner: null, last: R.encodeLast([at(6, 6), at(6, 6)]) }, 2));
  check("a third stone in one turn is refused", (() => {
    // board with three new White stones, last naming two of them
    const b = S.b.slice();
    b[at(6, 6)] = 2; b[at(6, 8)] = 2; b[at(5, 5)] = 2;
    return !accepted(prev, { board: b.join("") + "1" + "0", status: "in_progress", winner: null, last: R.encodeLast([at(6, 6), at(6, 8)]) }, 2);
  })());
  check("a turn that changes a stone elsewhere is refused", (() => {
    const b = fullTurn.S.b.slice();
    b[at(0, 0)] = 2;
    return !accepted(prev, { board: b.join("") + "1" + "0", status: "in_progress", winner: null, last: fullTurn.env.last }, 2);
  })());
  check("a turn that removes a stone is refused", (() => {
    const b = fullTurn.S.b.slice();
    b[at(7, 7)] = 0;
    return !accepted(prev, { board: b.join("") + "1" + "0", status: "in_progress", winner: null, last: fullTurn.env.last }, 2);
  })());
  check("a missing last mark is refused", !accepted(prev, { ...fullTurn.env, last: null }, 2) && !accepted(prev, { ...fullTurn.env, last: undefined }, 2));
  check("a status that lies about the turn is refused", !accepted(prev, { ...fullTurn.env, status: "won", winner: 2 }, 2) &&
    !accepted(prev, { ...fullTurn.env, status: "draw" }, 2));
  check("a winner on a quiet position is refused", !accepted(prev, { ...fullTurn.env, winner: 1 }, 2));
  check("a board whose turn character does not match is refused", (() => {
    const bad = fullTurn.env.board.slice(0, CELLS) + "2" + "0";
    return !accepted(prev, { ...fullTurn.env, board: bad }, 2);
  })());
  check("after a complete turn the server hands it to Black", validateTransition(prev, fullTurn.env, 2).nextTurn === 1);
}

/* ---------- six or more in a row ---------- */
{
  const five = [];
  for (let c = 4; c <= 8; c++) five.push([at(7, c), 1]);
  five.push([at(0, 0), 2], [at(14, 14), 2]);
  const before = mk(five, 1, 0);
  check("five in a row is not yet a win", R.outcome(before, 1).status === "in_progress");
  const win = turnResult(before, 1, [at(7, 9)]);
  check("a sixth stone in a row wins", win.o.status === "won" && win.o.winner === 1);
  check("the winning line has six points", R.lineAt(win.S.b, at(7, 9)).length === 6);
  check("a win with the first stone ends the turn at once", win.S.t === 2 && win.S.p === 0 && R.remaining(win.S) === 0);
  check("the server accepts a six-in-a-row win", accepted({ board: wireOf(before) }, win.env, 1));
  check("a win reported as in progress is refused", !accepted({ board: wireOf(before) }, { ...win.env, status: "in_progress", winner: null }, 1));
  check("a win for the wrong side is refused", !accepted({ board: wireOf(before) }, { ...win.env, winner: 2 }, 1));
  check("no second stone is allowed after the first wins", (() => {
    // reuse the winning turn, but claim an extra stone went down as well
    const extra = R.play(before, 1, at(7, 9));               // the winning board
    const b = extra.b.slice();
    b[at(0, 1)] = 1;
    return !accepted({ board: wireOf(before) }, {
      board: b.join("") + "2" + "0", status: "won", winner: 1,
      last: R.encodeLast([at(7, 9), at(0, 1)]),
    }, 1);
  })());
  // a turn whose SECOND stone wins is one legal whole-turn move
  {
    const four = [[at(9, 4), 1], [at(9, 5), 1], [at(9, 7), 1], [at(9, 8), 1], [at(0, 0), 2], [at(1, 1), 2]];
    const b = mk(four, 1, 0);
    const twoWin = turnResult(b, 1, [at(9, 6), at(9, 9)]);
    check("a win with the second stone is one accepted turn", twoWin && twoWin.o.winner === 1 && accepted({ board: wireOf(b) }, twoWin.env, 1));
  }

  // every direction, and a seven
  const dirs = [
    ["a row", [[7, 3], [7, 4], [7, 5], [7, 6], [7, 7]], [7, 8]],
    ["a column", [[2, 7], [3, 7], [4, 7], [5, 7], [6, 7]], [7, 7]],
    ["a diagonal", [[2, 2], [3, 3], [4, 4], [5, 5], [6, 6]], [7, 7]],
    ["an anti-diagonal", [[2, 12], [3, 11], [4, 10], [5, 9], [6, 8]], [7, 7]],
  ];
  for (const [name, cells, point] of dirs) {
    const b = mk(cells.map(([r, c]) => [at(r, c), 2]).concat([[at(14, 14), 1]]), 2, 0);
    const r = turnResult(b, 2, [at(point[0], point[1])]);
    check(name + " wins for White", r && r.o.status === "won" && r.o.winner === 2, r && JSON.stringify(r.o));
  }
  {
    // three, a gap, three: the gap makes seven in a row
    const cells = [[at(10, 2), 1], [at(10, 3), 1], [at(10, 4), 1],
      [at(10, 6), 1], [at(10, 7), 1], [at(10, 8), 1]];
    const b = mk(cells, 1, 0);
    check("the gapped six is not yet a win", R.winnerOf(b) === 0);
    const r = turnResult(b, 1, [at(10, 5)]);
    check("seven in a row still wins", r && r.o.winner === 1 && R.lineAt(r.S.b, at(10, 5)).length === 7);
  }
  {
    // an edge does not wrap onto the next row
    const b = mk([[at(7, 12), 1], [at(7, 13), 1], [at(7, 14), 1], [at(8, 0), 1], [at(8, 1), 1], [at(8, 2), 1], [at(0, 0), 2]], 1, 0);
    check("a line does not wrap around the edge", R.outcome(b, 1).status === "in_progress" && R.winnerOf(b) === 0);
  }
  {
    // a gap is not a line
    const b = mk([[at(4, 3), 1], [at(4, 4), 1], [at(4, 5), 1], [at(4, 7), 1], [at(4, 8), 1], [at(4, 9), 1]], 1, 0);
    check("a gap breaks the line", R.outcome(b, 1).status === "in_progress" && R.winnerOf(b) === 0);
  }
  {
    // the opponent already has six: the position is over, so no move from it is legal
    const b = mk([[at(3, 3), 1], [at(3, 4), 1], [at(3, 5), 1], [at(3, 6), 1], [at(3, 7), 1], [at(3, 8), 1], [at(0, 0), 2]], 2, 0);
    check("the outcome names the side with the line", R.outcome(b, 2).winner === 1);
    check("a move from a finished position is refused",
      !accepted({ board: wireOf(b) }, { board: wireOf(b), status: "won", winner: 1, last: R.encodeLast([at(12, 12)]) }, 2));
  }
}

/* ---------- a full board draws; the nearly-full short turn ---------- */
{
  const full = R.parse(fillerWire());
  check("the filler really has no six", full && R.winnerOf(full) === 0);
  check("a full board with no line is a draw", R.outcome(full, 1).status === "draw" && R.outcome(full, 1).winner === 0);
  check("a full board has no legal move", R.gen(full, 1).length === 0 && R.remaining(full) === 0);

  // one empty point left: the turn is one stone and fills the board
  const oneLeft = R.parse(fillerWire([at(7, 7)]));
  check("one empty point asks for one stone", R.remaining(oneLeft) === 1);
  const fill = turnResult(oneLeft, 1, [at(7, 7)]);
  check("filling the last point is a draw", fill && fill.o.status === "draw" && fill.o.winner === 0);
  check("the server accepts the one-stone last turn", fill && accepted({ board: wireOf(oneLeft) }, fill.env, 1));
  check("the server refuses a draw reported as in progress", fill && !accepted({ board: wireOf(oneLeft) }, { ...fill.env, status: "in_progress", winner: null }, 1));
  check("the server refuses a draw with a winner", fill && !accepted({ board: wireOf(oneLeft) }, { ...fill.env, winner: 1 }, 1));
  // with two empty points the turn still places both
  const twoLeft = R.parse(fillerWire([at(7, 7), at(7, 8)]));
  check("two empty points still ask for two stones", R.remaining(twoLeft) === 2);
  const half = R.play(twoLeft, 1, at(7, 7));
  check("the first of the last two stones leaves the turn open", half && half.t === 1 && half.p === 1 && R.remaining(half) === 1);
  const done = turnResult(twoLeft, 1, [at(7, 7), at(7, 8)]);
  check("both last stones fill the board for a draw", done && done.o.status === "draw");
  check("the server refuses to end the turn with one stone left when two were asked for",
    !accepted({ board: wireOf(twoLeft) }, turnResult(twoLeft, 1, [at(7, 7)]).env, 1));
  check("the server accepts both stones in the last turn", done && accepted({ board: wireOf(twoLeft) }, done.env, 1));
  // with three empty points, two stones are still required
  const threeLeft = R.parse(fillerWire([at(7, 7), at(7, 8), at(7, 9)]));
  check("three empty points ask for two stones", R.remaining(threeLeft) === 2);
  check("a one-stone turn with three points left is refused",
    !accepted({ board: wireOf(threeLeft) }, turnResult(threeLeft, 1, [at(7, 7)]).env, 1));
  check("a full board wire still parses", R.parse(fillerWire()) !== null);
}

/* ---------- the computer ---------- */
{
  const open = R.bestMove(R.initial(), 1, "hard", () => 0.99);
  check("the computer opens with one stone", Array.isArray(open) && open.length === 1 && open[0] >= 0 && open[0] < CELLS, JSON.stringify(open));
  check("the computer will not move out of turn", R.bestMove(R.initial(), 2, "hard", () => 0.99) === null);

  const five = [];
  for (let c = 4; c <= 8; c++) five.push([at(7, c), 1]);
  five.push([at(0, 0), 2], [at(1, 1), 2], [at(2, 2), 2]);
  const winNow = mk(five, 1, 0);
  for (const lvl of ["medium", "hard"]) {
    const mv = R.bestMove(R.str(winNow), 1, lvl, () => 0.99);
    const r = mv ? turnResult(winNow, 1, mv) : null;
    check(lvl + " takes an immediate six", r && r.o.status === "won" && r.o.winner === 1, JSON.stringify(mv));
  }

  // four stones with two gaps: neither alone wins, but one turn fills both
  {
    const four = [[at(7, 4), 1], [at(7, 5), 1], [at(7, 7), 1], [at(7, 8), 1],
      [at(2, 2), 2], [at(3, 3), 2], [at(4, 4), 2]];
    const b = mk(four, 1, 0);
    const mv = R.bestMove(R.str(b), 1, "hard", () => 0.99);
    const r = mv ? turnResult(b, 1, mv) : null;
    check("hard finds the six with its second stone", r && r.o.status === "won" && r.o.winner === 1 && mv.length === 2, JSON.stringify(mv));
  }

  // White has five on row 7 with both ends open; Black must cover them
  const wfive = [];
  for (let c = 4; c <= 8; c++) wfive.push([at(7, c), 2]);
  wfive.push([at(2, 2), 1], [at(2, 3), 1], [at(3, 3), 1]);
  const block = mk(wfive, 1, 0);
  const mv = R.bestMove(R.str(block), 1, "hard", () => 0.99);
  const blocked = mv && turnResult(block, 1, mv);
  check("hard covers both ends of White's five", mv && mv.indexOf(at(7, 3)) !== -1 && mv.indexOf(at(7, 9)) !== -1, JSON.stringify(mv));
  check("after blocking, White has no immediate six", blocked && R.pointGain(blocked.S.b, at(7, 3), 2) < R.WIN && R.pointGain(blocked.S.b, at(7, 9), 2) < R.WIN);

  // one open end only
  const edgeFive = [];
  for (let c = 0; c <= 4; c++) edgeFive.push([at(7, c), 2]);
  edgeFive.push([at(2, 2), 1], [at(2, 3), 1]);
  const edgeBlock = mk(edgeFive, 1, 0);
  const emv = R.bestMove(R.str(edgeBlock), 1, "medium", () => 0.99);
  check("the computer blocks the only open end", emv && emv.indexOf(at(7, 5)) !== -1, JSON.stringify(emv));

  // one empty point: it must take it
  const lastOne = R.parse(fillerWire([at(9, 9)]));
  const lmv = R.bestMove(R.str(lastOne), 1, "easy", () => 0.99);
  check("the computer takes the last empty point", lmv && lmv.length === 1 && lmv[0] === at(9, 9), JSON.stringify(lmv));

  // every level plays legal turns in whole games against random play
  for (const lvl of ["easy", "medium", "hard"]) {
    let ok = true, games = 0, done = 0, notes = [];
    for (let g = 0; g < 2 && ok; g++) {
      const aiSide = g === 0 ? 1 : 2;
      let S = R.parse(R.initial());
      let prev = null, mover = 1;
      games++;
      for (let turn = 0; turn < 70; turn++) {
        const rem = R.remaining(S);
        if (!rem) { done++; break; }
        let points;
        if (mover === aiSide) {
          points = R.bestMove(R.str(S), mover, lvl, rng);
          if (!Array.isArray(points) || !points.length || points.length > rem) { ok = false; notes.push("bad count " + JSON.stringify(points)); break; }
          const seen = new Set();
          for (const i of points) {
            if (!Number.isInteger(i) || i < 0 || i >= CELLS || S.b[i] !== 0 || seen.has(i)) { ok = false; notes.push("bad point " + i); break; }
            seen.add(i);
          }
          if (!ok) break;
        } else {
          points = randomPoints(S, mover);
          if (!points) { ok = false; notes.push("random turn had no points"); break; }
        }
        const r = turnResult(S, mover, points);
        if (!r) { ok = false; notes.push("illegal turn"); break; }
        if (!accepted(prev, r.env, mover)) { ok = false; notes.push("server refused " + JSON.stringify(validateTransition(prev, r.env, mover))); break; }
        prev = r.env; S = r.S; mover = S.t;
      }
    }
    check(lvl + " always plays a legal turn and passes the server", ok, notes.join("; "));
    check(lvl + " games reach a finished position", done > 0, done + " of " + games);
  }
}

/* ---------- random games, every move through the server's check ---------- */
{
  let ok = true, finished = 0, wins = { 1: 0, 2: 0 }, draws = 0, turns = 0, why = "";
  for (let g = 0; g < 10 && ok; g++) {
    let S = R.parse(R.initial()), prev = null, mover = 1, done = false;
    for (let t = 0; t < 160; t++) {
      const points = randomPoints(S, mover);
      if (!points) { ok = false; why = "no points on a live board"; break; }
      const r = turnResult(S, mover, points);
      if (!r) { ok = false; why = "a random turn was illegal"; break; }
      const res = validateTransition(prev, r.env, mover);
      if (!res.ok) { ok = false; why = "server refused a random turn: " + JSON.stringify(res); break; }
      if (res.nextTurn !== r.S.t) { ok = false; why = "the server changed the side to move"; break; }
      if (r.applied.length !== R.remaining(S) && r.o.status === "in_progress") { ok = false; why = "a random turn stopped early"; break; }
      prev = r.env; S = r.S; mover = S.t; turns++;
      if (r.o.status !== "in_progress") {
        finished++;
        if (r.o.status === "draw") draws++; else wins[r.o.winner]++;
        done = true;
        break;
      }
    }
    if (!done && ok) { ok = false; why = "game " + g + " did not finish"; }
  }
  check("random legal games all pass the server's check", ok, why);
  check("all random games reach a result", finished === 10, finished + " of 10");
  check("the server never changed the mover", ok);
  console.log("  (random games: " + wins[1] + " Black, " + wins[2] + " White, " + draws + " draws, " + turns + " turns)");
}

/* ---------- the real live-room protocol ---------- */
{
  // live-games.mjs is the room's registration table and not this module's
  // file; register in memory if it has not been updated yet, so this always
  // exercises the path worker/live-protocol.mjs uses on every move.
  if (!LIVE_GAMES.connect6) {
    LIVE_GAMES.connect6 = { version: 1, players: [1, 2], first: 1, rules: c6 };
  }
  let minted = 0;
  const mint = () => "t" + ++minted;
  const room = newRoom("connect6", "ABC234", 1000);
  check("a Connect6 live room can be made", !!room);
  join(room, null, mint, 1000);
  join(room, null, mint, 1000);
  function send(seat, mover, points, extra) {
    const before = room.state ? R.parse(room.state.board) : R.parse(R.initial());
    const r = turnResult(before, mover, points);
    if (!r) return { ok: false, reason: "test-could-not-build" };
    const s = Object.assign({
      game: "connect6", version: 1, id: room.id, turn: r.S.t,
      board: r.env.board, status: r.env.status, winner: r.env.winner,
      moveCount: (room.state ? room.state.moveCount : 0) + 1, last: r.env.last,
    }, extra || {});
    return applyMove(room, seat, { t: "move", n: room.state ? room.state.moveCount : 0, s: s }, 2000);
  }
  const opening = send(1, 1, [at(7, 7)]);
  check("the live room accepts the one-stone opening", opening.ok === true, JSON.stringify(opening));
  check("the live room hands the turn to White", opening.ok && room.state.turn === 2);
  check("the opening player cannot move again", send(1, 2, [at(6, 6), at(6, 8)]).reason === "not-your-turn");
  check("the live room refuses a half turn", send(2, 2, [at(6, 6)]).reason === "illegal");
  const white = send(2, 2, [at(6, 6), at(6, 8)]);
  check("the live room accepts a two-stone turn", white.ok === true, JSON.stringify(white));
  check("the live room hands the turn back to Black", white.ok && room.state.turn === 1);
  const black = send(1, 1, [at(8, 8), at(8, 9)]);
  check("a second live turn is accepted", black.ok === true, JSON.stringify(black));
  check("a fake live win is refused", send(2, 2, [at(0, 0), at(0, 1)], { status: "won", winner: 2 }).reason === "illegal");
  check("a live move that changes the board elsewhere is refused", (() => {
    const before = R.parse(room.state.board);
    const r = turnResult(before, 2, [at(1, 1), at(1, 2)]);
    const b = r.S.b.slice();
    b[at(13, 13)] = 2;
    return send(2, 2, [at(1, 1), at(1, 2)], { board: b.join("") + "1" + "0" }).reason === "illegal";
  })());
  console.log("  (live room: " + room.state.moveCount + " moves, " + room.state.status + ")");
}

console.log(fail ? `\n${pass} passed, ${fail} FAILED` : `\n${pass} passed`);
process.exit(fail ? 1 : 0);
