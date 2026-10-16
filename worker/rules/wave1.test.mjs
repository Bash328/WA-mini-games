/* Run: node worker/rules/wave1.test.mjs
   Rules for Connect Four, Reversi, Dots and Boxes and Lights Out, exercised
   through the real room protocol: thousands of random legal games must be
   accepted move by move, and tampered moves must be refused. */

import { newRoom, join, applyMove } from "../live-protocol.mjs";
import * as c4 from "./connect-four.mjs";
import * as rv from "./reversi.mjs";
import * as db from "./dots-and-boxes.mjs";
import * as lo from "./lights-out.mjs";
import { liveGame } from "../live-games.mjs";

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) pass++; else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? " — " + detail : "")); }
}
let n = 0;
const mint = () => "t" + ++n;
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const T0 = 1;

function roomFor(game) {
  const room = newRoom(game, "ABC234", T0);
  join(room, null, mint, T0); join(room, null, mint, T0);
  return room;
}
const seatOf = (room, player) => (room.order[1] === player ? 1 : 2);
function envelope(room, m, extra = {}) {
  const G = liveGame(room.game);
  return {
    game: room.game, version: G.version, id: room.id,
    turn: m.nextTurn !== undefined ? m.nextTurn : 0,
    board: m.board, status: m.status, winner: m.winner,
    moveCount: (room.state ? room.state.moveCount : 0) + 1, last: m.last, ...extra,
  };
}
function send(room, mover, m, extra) {
  return applyMove(room, seatOf(room, mover), { t: "move", n: room.state ? room.state.moveCount : 0, s: envelope(room, m, extra) }, T0);
}

/* ---------- Connect Four ---------- */
console.log("connect four:");
{
  let games = 0, finished = 0, draws = 0, wins = 0;
  for (let g = 0; g < 300; g++) {
    const room = roomFor("connect-four");
    let board = c4.EMPTY, mover = 1, guard = 0, ok = true;
    while (guard++ < 60) {
      const cols = [...Array(7).keys()].filter((c) => c4.dropRow(board, c) >= 0);
      const m = c4.moveInColumn(board, pick(cols), mover);
      const r = send(room, mover, m);
      if (!r.ok) { ok = false; check("c4 random game move accepted", false, r.reason); break; }
      board = m.board;
      if (m.status !== "in_progress") { finished++; if (m.status === "draw") draws++; else wins++; break; }
      check("c4 turn alternates", r.state.turn === (mover === 1 ? 2 : 1));
      mover = mover === 1 ? 2 : 1;
    }
    games++;
    if (!ok) break;
  }
  check("c4: every random game reached a result", finished === games, finished + "/" + games);
  check("c4: saw wins", wins > 0);

  const room = roomFor("connect-four");
  const floating = { board: "0".repeat(21) + "1" + "0".repeat(20), last: 21, status: "in_progress", winner: null };
  check("c4: floating checker refused", send(room, 1, floating).reason === "illegal");
  const wrongColour = c4.moveInColumn(c4.EMPTY, 3, 2);
  check("c4: wrong colour refused", send(room, 1, wrongColour).reason === "illegal");
  const two = { ...c4.moveInColumn(c4.EMPTY, 3, 1) };
  two.board = two.board.slice(0, 37) + "1" + two.board.slice(38);
  check("c4: two checkers at once refused", send(room, 1, two).reason === "illegal");
  const lie = { ...c4.moveInColumn(c4.EMPTY, 3, 1), status: "won", winner: 1 };
  check("c4: claiming a win that isn't one is refused", send(room, 1, lie).reason === "illegal");
  const okMove = c4.moveInColumn(c4.EMPTY, 3, 1);
  check("c4: a normal drop is accepted", send(room, 1, okMove).ok === true);
  // a vertical four that the client forgot to call
  const r2 = roomFor("connect-four");
  let b = c4.EMPTY;
  for (const [mv, col] of [[1, 0], [2, 1], [1, 0], [2, 1], [1, 0], [2, 1]]) {
    const m = c4.moveInColumn(b, col, mv); send(r2, mv, m); b = m.board;
  }
  const winning = c4.moveInColumn(b, 0, 1);
  check("c4: a vertical four is a win", winning.status === "won");
  const hidden = { ...winning, status: "in_progress", winner: null };
  check("c4: hiding a win is refused", send(r2, 1, hidden).reason === "illegal");
  check("c4: the real win is accepted", send(r2, 1, winning).ok === true);
}

/* ---------- Reversi ---------- */
console.log("reversi:");
{
  let passes = 0, finished = 0, games = 0;
  for (let g = 0; g < 150; g++) {
    const room = roomFor("reversi");
    let board = rv.initialBoard(), mover = 1, guard = 0, ok = true;
    while (guard++ < 200) {
      const moves = rv.legalMoves(board, mover);
      if (!moves.length) { check("reversi: mover always has a move", false); ok = false; break; }
      const m = rv.resolve(board, pick(moves), mover);
      const r = send(room, mover, m);
      if (!r.ok) { check("reversi random move accepted", false, r.reason); ok = false; break; }
      check("reversi: server turn matches the rules", r.state.turn === m.nextTurn);
      if (m.nextTurn === mover && m.status === "in_progress") passes++;
      board = m.board;
      if (m.status !== "in_progress") { finished++; break; }
      mover = m.nextTurn;
    }
    games++;
    if (!ok) break;
  }
  check("reversi: every random game finished", finished === games, finished + "/" + games);
  check("reversi: passes occurred and were accepted", passes > 0, passes);

  const room = roomFor("reversi");
  const start = rv.initialBoard();
  const legal = rv.legalMoves(start, 1)[0];
  const good = rv.resolve(start, legal, 1);
  const illegalSquare = { ...good, last: 0, board: "1" + start.slice(1) };
  check("reversi: a square with no flips is refused", send(room, 1, illegalSquare).reason === "illegal");
  const noFlips = { ...good, board: start.slice(0, legal) + "1" + start.slice(legal + 1) };
  check("reversi: placing without flipping is refused", send(room, 1, noFlips).reason === "illegal");
  const extra = { ...good, board: good.board.replace(/0/, "1") };
  check("reversi: an extra disc is refused", send(room, 1, extra).reason === "illegal");
  check("reversi: the real move is accepted", send(room, 1, good).ok === true);
}

/* ---------- Dots and Boxes ---------- */
console.log("dots and boxes:");
{
  let finished = 0, games = 0, extraTurns = 0;
  for (let g = 0; g < 200; g++) {
    const room = roomFor("dots-and-boxes");
    const size = db.SIZES[g % db.SIZES.length];
    let board = db.emptyBoard(size), mover = 1, guard = 0, ok = true;
    while (guard++ < 200) {
      const free = [...Array(db.geom(size).edges).keys()].filter((i) => board[1 + i] === "0");
      const m = db.resolve(board, pick(free), mover);
      const r = send(room, mover, m);
      if (!r.ok) { check("d&b random move accepted", false, r.reason); ok = false; break; }
      check("d&b: server turn matches the rules", r.state.turn === m.nextTurn);
      if (m.nextTurn === mover && m.status === "in_progress") extraTurns++;
      board = m.board;
      if (m.status !== "in_progress") { finished++; break; }
      mover = m.nextTurn;
    }
    games++;
    if (!ok) break;
  }
  check("d&b: every random game finished", finished === games, finished + "/" + games);
  check("d&b: extra turns granted", extraTurns > 0, extraTurns);

  const room = roomFor("dots-and-boxes");
  const m1 = db.resolve(db.EMPTY, 0, 1);
  check("d&b: drawing an edge", send(room, 1, m1).ok === true);
  const stolen = db.resolve(m1.board, 1, 2);
  stolen.board = stolen.board.slice(0, 1 + db.EDGE_COUNT) + "1" + stolen.board.slice(1 + db.EDGE_COUNT + 1);
  check("d&b: claiming a box that isn't complete is refused", send(room, 2, stolen).reason === "illegal");
  const redraw = db.resolve(m1.board, 0, 2);
  check("d&b: changing the size mid-game is refused", send(room, 2, { ...db.resolve(db.emptyBoard(5), 0, 2) }).reason === "illegal");
  check("d&b: a size nobody offers is refused", send(roomFor("dots-and-boxes"), 1, { ...m1, board: "9" + m1.board.slice(1) }).reason === "illegal");
  check("d&b: the first move can pick any offered size", db.SIZES.every((n) => send(roomFor("dots-and-boxes"), 1, db.resolve(db.emptyBoard(n), 0, 1)).ok === true));
  check("d&b: redrawing a drawn edge is refused", send(room, 2, { ...redraw, board: m1.board }).reason === "illegal");
}

/* ---------- Lights Out ---------- */
console.log("lights out:");
{
  let finished = 0, wins = 0, draws = 0, games = 0;
  for (let g = 0; g < 200; g++) {
    const room = roomFor("lights-out");
    // a scrambled opening, as the first mover's browser would make
    let bits = 0;
    for (let i = 0; i < 6; i++) bits = lo.press(bits, Math.floor(Math.random() * 25));
    if (bits === 0) bits = lo.press(bits, 12);
    let mover = 1, guard = 0, ok = true;
    while (guard++ < 80) {
      const idx = Math.floor(Math.random() * 25);
      const m = lo.resolve(bits, idx, mover, (room.state ? room.state.moveCount : 0) + 1);
      const r = send(room, mover, m);
      if (!r.ok) { check("lights-out random move accepted", false, r.reason); ok = false; break; }
      bits = m.board.bits;
      if (m.status !== "in_progress") { finished++; if (m.status === "won") wins++; else draws++; break; }
      mover = mover === 1 ? 2 : 1;
    }
    games++;
    if (!ok) break;
  }
  check("lights-out: every random game finished", finished === games, finished + "/" + games);
  check("lights-out: the move cap produces draws", draws > 0, wins + " wins, " + draws + " draws");
  // a scramble of one press is cleared by pressing the same cell: a win for whoever does it
  const winRoom = roomFor("lights-out");
  const oneAway = lo.press(0, 7);
  const winMove = lo.resolve(oneAway, 7, 1, 1);
  const winRes = send(winRoom, 1, winMove);
  check("lights-out: clearing the board wins", winRes.ok && winRes.state.status === "won" && winRes.state.winner === 1);

  const room = roomFor("lights-out");
  const init = lo.press(lo.press(0, 12), 6);
  const first = lo.resolve(init, 3, 1, 1);
  check("lights-out: first press accepted", send(room, 1, first).ok === true);
  const bad = lo.resolve(first.board.bits, 7, 2, 2);
  check("lights-out: tampered lights refused", send(room, 2, { ...bad, board: { bits: bad.board.bits ^ 1 } }).reason === "illegal");
  check("lights-out: a lie about winning is refused", send(room, 2, { ...bad, status: "won", winner: 2 }).reason === "illegal");
  const r0 = roomFor("lights-out");
  check("lights-out: pressing an already-dark board is refused", send(r0, 1, lo.resolve(0, 12, 1, 1)).reason === "illegal");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
