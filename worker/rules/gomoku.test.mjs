/* Run: node worker/rules/gomoku.test.mjs
   Plays thousands of random legal games through the real room protocol. */
import { newRoom, join, applyMove } from "../live-protocol.mjs";
import * as gm from "./gomoku.mjs";

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) pass++; else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? " — " + detail : "")); }
}
let n = 0;
const mint = () => "t" + ++n;
function roomFor() {
  const room = newRoom("gomoku", "ABC234", 1000);
  join(room, null, mint, 1000); join(room, null, mint, 1000);
  return room;
}
const send = (room, seat, m) => applyMove(room, seat, { t: "move", n: room.state ? room.state.moveCount : 0, s: {
  game: "gomoku", version: 1, id: room.id, turn: m.nextTurn, board: m.board, status: m.status, winner: m.winner,
  moveCount: (room.state ? room.state.moveCount : 0) + 1, last: m.last } }, 2000);
const rnd = (a) => a[Math.floor(Math.random() * a.length)];

console.log("gomoku:");
// winning lines in every direction, at the edges and corners
for (const [name, cells] of [
  ["a row", [0, 1, 2, 3, 4]], ["a column", [0, 15, 30, 45, 60]], ["a diagonal", [0, 16, 32, 48, 64]],
  ["an anti-diagonal", [4, 18, 32, 46, 60]], ["a row at the right edge", [10, 11, 12, 13, 14]],
  ["the last row", [220, 221, 222, 223, 224]], ["six in a row (overline counts)", [30, 31, 32, 33, 34, 35]],
]) {
  let b = gm.EMPTY;
  cells.forEach((c) => { b = b.slice(0, c) + "1" + b.slice(c + 1); });
  check(name + " wins", gm.winsAt(b, cells[cells.length - 1]));
  const four = cells.slice(0, 4);
  let b4 = gm.EMPTY; four.forEach((c) => { b4 = b4.slice(0, c) + "1" + b4.slice(c + 1); });
  check(name + ": four is not enough", !gm.winsAt(b4, four[3]) || cells.length > 5 && false);
}
// a row must not wrap around the board edge
{
  let b = gm.EMPTY;
  [12, 13, 14, 15, 16].forEach((c) => { b = b.slice(0, c) + "1" + b.slice(c + 1); });
  check("a row does not wrap from one line to the next", !gm.winsAt(b, 16));
}

let finished = 0, wins = 0, draws = 0;
for (let g = 0; g < 150; g++) {
  const room = roomFor();
  let board = gm.EMPTY, mover = 1, guard = 0, ok = true;
  while (guard++ < 300) {
    const free = [];
    for (let i = 0; i < gm.CELLS; i++) if (board[i] === "0") free.push(i);
    // bias the random play toward the middle so games end in wins, not just a full board
    const idx = Math.random() < 0.6 ? rnd(free.filter((i) => Math.abs((i % 15) - 7) <= 3 && Math.abs(Math.floor(i / 15) - 7) <= 3).concat(free.slice(0, 1))) : rnd(free);
    const m = gm.resolve(board, idx, mover);
    const r = send(room, mover, m);
    if (!r.ok) { check("a legal random move is accepted", false, r.reason); ok = false; break; }
    check("the server's next turn matches the rules", r.state.turn === m.nextTurn);
    board = m.board;
    if (m.status !== "in_progress") { finished++; if (m.status === "won") wins++; else draws++; break; }
    mover = m.nextTurn;
  }
  if (!ok) break;
}
check("every random game finished", finished === 150, finished);
check("most random games end in a win", wins > 100, wins + " wins, " + draws + " draws");

// cheating attempts
{
  const room = roomFor();
  const m1 = gm.resolve(gm.EMPTY, 112, 1);
  check("opening in the middle is accepted", send(room, 1, m1).ok === true);
  const stole = gm.resolve(m1.board, 112, 2);
  check("playing on an occupied point is refused", send(room, 2, { ...stole, board: m1.board.slice(0, 112) + "2" + m1.board.slice(113) }).reason === "illegal");
  const two = { ...gm.resolve(m1.board, 5, 2), board: m1.board.slice(0, 5) + "2" + m1.board.slice(6, 7) + "2" + m1.board.slice(7) };
  check("two stones in one move is refused", send(room, 2, { ...two, board: m1.board.slice(0, 5) + "2" + m1.board.slice(6, 8) + "2" + m1.board.slice(9) }).reason === "illegal");
  const lie = { ...gm.resolve(m1.board, 5, 2), status: "won", winner: 2 };
  check("claiming a win that isn't one is refused", send(room, 2, lie).reason === "illegal");
  const wrongColour = gm.resolve(m1.board, 5, 1);
  check("placing the other colour is refused", send(room, 2, wrongColour).reason === "illegal");
  check("the honest reply is accepted", send(room, 2, gm.resolve(m1.board, 5, 2)).ok === true);
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
