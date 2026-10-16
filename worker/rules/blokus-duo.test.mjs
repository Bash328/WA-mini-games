/* Run: node worker/rules/blokus-duo.test.mjs
   Piece set sanity, rule checks, then random legal games through the real room protocol. */
import { newRoom, join, applyMove } from "../live-protocol.mjs";
import "../../blokus-duo/rules.js";
const R = globalThis.BlokusRules;

let pass = 0, fail = 0;
function check(name, ok, detail) { if (ok) pass++; else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? " — " + detail : "")); } }
let n = 0;
const mint = () => "t" + ++n;
function roomFor() { const room = newRoom("blokus-duo", "ABC234", 1000); join(room, null, mint, 1000); join(room, null, mint, 1000); return room; }
const rnd = (a) => a[Math.floor(Math.random() * a.length)];

console.log("blokus duo:");
// the piece set: 21 pieces, 89 squares, the right number of orientations
check("21 pieces", R.SHAPES.length === 21);
check("89 squares in total", R.SIZES.reduce((a, b) => a + b, 0) === 89);
check("the free-piece orientation counts are right", JSON.stringify(R.ORIENTS.map((o) => o.length)) === JSON.stringify([1, 2, 2, 4, 2, 8, 4, 1, 4, 8, 2, 8, 8, 8, 4, 4, 4, 4, 1, 8, 4]), JSON.stringify(R.ORIENTS.map((o) => o.length)));
check("every orientation identifies back to its piece", R.ORIENTS.every((list, p) => list.every((o) => R.identify(o.map(([r, c]) => (r + 3) * 14 + c + 3)) === p)));
check("a disconnected set of cells is not a piece", R.identify([0, 2]) === -1 && R.identify([0, 1, 3]) === -1 && R.identify([0, 1, 2, 3, 4, 5]) === -1);

// opening moves
{
  const pos = R.parse(R.EMPTY);
  const first = R.legalMoves(pos.grid, pos.used[1], 1);
  check("every opening move covers player 1's start square", first.length > 0 && first.every((m) => m.cells.includes(R.START[1])));
  check("the opening can use any piece", new Set(first.map((m) => m.piece)).size === 21);
  const second = R.legalMoves(pos.grid, pos.used[2], 2);
  check("player 2's opening covers their own start square", second.every((m) => m.cells.includes(R.START[2])));
}
// corner / edge rule
{
  const pos = R.parse(R.EMPTY);
  R.play(pos, 1, { piece: 0, cells: [R.START[1]] });          // a single square on the start
  const moves = R.legalMoves(pos.grid, pos.used[1], 1);
  const s = R.START[1];
  const touchesEdge = moves.some((m) => m.cells.some((i) => [s - 1, s + 1, s - 14, s + 14].includes(i)));
  const diag = [s - 15, s - 13, s + 13, s + 15];
  check("after the first piece nobody may share an edge with it", !touchesEdge);
  check("every move hooks onto a corner of it", moves.length > 0 && moves.every((m) => m.cells.some((i) => diag.includes(i))));
  // the opponent's stones don't block touching
  const q = R.parse(R.EMPTY);
  R.play(q, 1, { piece: 0, cells: [R.START[1]] });
  R.play(q, 2, { piece: 0, cells: [R.START[1] + 15] });       // opponent sits on one of my corner points
  const m2 = R.legalMoves(q.grid, q.used[1], 1);
  check("an opponent stone on a corner point removes just that point", m2.every((m) => !m.cells.includes(R.START[1] + 15)) && m2.length > 0);
}
// scoring
{
  const none = new Uint8Array(21), all = new Uint8Array(21).fill(1);
  check("89 squares left with nothing played", R.penalty(none, -1) === 89);
  check("all pieces played: -15", R.penalty(all, 3) === -15);
  check("all pieces played ending on the single square: -20", R.penalty(all, 0) === -20);
}

// random whole games through the room protocol
let finished = 0, passes = 0, wins = [0, 0], draws = 0;
const GAMES = 40;
for (let g = 0; g < GAMES; g++) {
  const room = roomFor();
  let board = R.EMPTY, mover = 1, guard = 0, ok = true;
  while (guard++ < 120) {
    const pos = R.parse(board);
    const moves = R.legalMoves(pos.grid, pos.used[mover], mover);
    if (!moves.length) { check("the player to move always has a move", false, "game " + g + " mover " + mover); ok = false; break; }
    // bias toward big pieces so games run to a natural end
    const m = Math.random() < 0.6 ? rnd(moves.filter((x) => R.SIZES[x.piece] >= 4).concat(moves.slice(0, 1))) : rnd(moves);
    R.play(pos, mover, m);
    const out = R.outcome(pos, mover, m.piece);
    const env = { game: "blokus-duo", version: 1, id: room.id, turn: out.nextTurn, board: R.stringify(pos), status: out.status, winner: out.winner,
      moveCount: (room.state ? room.state.moveCount : 0) + 1, last: m.cells[0] };
    const r = applyMove(room, mover, { t: "move", n: room.state ? room.state.moveCount : 0, s: env }, 2000);
    if (!r.ok) { check("a legal random move is accepted", false, r.reason); ok = false; break; }
    check("the server's next turn matches the rules", r.state.turn === out.nextTurn);
    if (out.nextTurn === mover && out.status === "in_progress") passes++;
    board = env.board;
    if (out.status !== "in_progress") { finished++; if (out.winner) wins[out.winner - 1]++; else draws++; break; }
    mover = out.nextTurn;
  }
  if (!ok) break;
}
check("every random game finished", finished === GAMES, finished + "/" + GAMES);
console.log("   (" + finished + " games: " + wins[0] + " / " + wins[1] + " wins, " + draws + " draws, " + passes + " forced passes)");

// cheating
{
  const room = roomFor();
  const pos = R.parse(R.EMPTY);
  const mv = R.legalMoves(pos.grid, pos.used[1], 1)[0];
  R.play(pos, 1, mv);
  const out = R.outcome(pos, 1, mv.piece);
  const env = (board, over = {}) => ({ game: "blokus-duo", version: 1, id: room.id, turn: 2, board, status: "in_progress", winner: null, moveCount: 1, last: mv.cells[0], ...over });
  const send = (e) => applyMove(room, 1, { t: "move", n: 0, s: e }, 2000);
  check("a piece that misses the start square is refused", (() => {
    const q = R.parse(R.EMPTY); R.play(q, 1, { piece: 0, cells: [0] });
    return send(env(R.stringify(q), { last: 0 })).reason === "illegal";
  })());
  check("playing the opponent's colour is refused", (() => {
    const q = R.parse(R.EMPTY); R.play(q, 2, { piece: 0, cells: [R.START[1]] });
    return send(env(R.stringify(q), { last: R.START[1] })).reason === "illegal";
  })());
  check("two pieces in one move are refused", (() => {
    const q = R.parse(R.EMPTY); R.play(q, 1, mv); R.play(q, 1, { piece: 1, cells: [0, 1] });
    return send(env(R.stringify(q), { last: mv.cells[0] })).reason === "illegal";
  })());
  check("the honest opening is accepted", send(env(R.stringify(pos))).ok === true);
}
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
