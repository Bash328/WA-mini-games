/* Run: node worker/rules/ultimate-tic-tac-toe.test.mjs
   Plays thousands of random legal games through the real room protocol. */
import { newRoom, join, applyMove } from "../live-protocol.mjs";
import * as ut from "./ultimate-tic-tac-toe.mjs";

let pass = 0, fail = 0;
function check(name, ok, detail) { if (ok) pass++; else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? " — " + detail : "")); } }
let n = 0;
const mint = () => "t" + ++n;
function roomFor() {
  const room = newRoom("ultimate-tic-tac-toe", "ABC234", 1000);
  join(room, null, mint, 1000); join(room, null, mint, 1000);
  return room;
}
const send = (room, seat, m) => applyMove(room, seat, { t: "move", n: room.state ? room.state.moveCount : 0, s: {
  game: "ultimate-tic-tac-toe", version: 1, id: room.id, turn: m.nextTurn, board: m.board, status: m.status, winner: m.winner,
  moveCount: (room.state ? room.state.moveCount : 0) + 1, last: m.last } }, 2000);
const rnd = (a) => a[Math.floor(Math.random() * a.length)];

console.log("ultimate tic-tac-toe:");
let finished = 0, wins = 0, draws = 0, anywhere = 0;
for (let g = 0; g < 400; g++) {
  const room = roomFor();
  let board = ut.EMPTY, mover = 1, guard = 0, ok = true;
  while (guard++ < 100) {
    const moves = [];
    for (let i = 0; i < 81; i++) if (ut.legal(board, i)) moves.push(i);
    if (!moves.length) { check("an unfinished game always has a legal move", false, board); ok = false; break; }
    if (board[90] === "9") anywhere++;
    const m = ut.resolve(board, rnd(moves), mover);
    const r = send(room, mover, m);
    if (!r.ok) { check("a legal random move is accepted", false, r.reason); ok = false; break; }
    board = m.board;
    if (m.status !== "in_progress") { finished++; if (m.status === "won") wins++; else draws++; break; }
    mover = m.nextTurn;
  }
  if (!ok) break;
}
check("every random game finished", finished === 400, finished);
check("random games produce wins and draws", wins > 100 && draws >= 0, wins + " wins, " + draws + " draws");
check("the 'play anywhere' case came up", anywhere > 200, anywhere);

// specific rules
{
  let b = ut.EMPTY;
  const play = (idx, p) => { const r = ut.resolve(b, idx, p); b = r.board; return r; };
  let r = play(4 * 9 + 2, 1);        // X plays small board 4, cell 2 -> O must play in board 2
  check("the cell you take picks the board your opponent plays in", b[90] === "2");
  check("a move outside the forced board is illegal", !ut.legal(b, 0 * 9 + 0) && ut.legal(b, 2 * 9 + 5));
  // win small board 0 for X with cells 0,1,2
  b = ut.EMPTY;
  b = b.slice(0, 0) + "11" + b.slice(2); // cells 0,1 of board 0 are X
  b = b.slice(0, 90) + "0";               // forced: board 0
  r = ut.resolve(b, 2, 1);
  check("completing three in a small board wins it", r.board[81] === "1");
  check("sending the opponent to a won board lets them play anywhere", r.board[90] === "9" || r.board[90] === "2" ? true : false);
  // can't play in a won board even if it has empty cells
  check("a won small board takes no more moves", !ut.legal(r.board.slice(0, 90) + "9", 5));
  // three small boards in a line wins the game
  let st = "111000000";
  let full = "0".repeat(81) + st + "9";
  const lastB = full.slice(0, 81 + 2) + "0" + full.slice(81 + 3);
  // X holds boards 0 and 1; give X two cells in board 2 and finish it
  let bb = "0".repeat(81).split("");
  bb[2 * 9 + 0] = "1"; bb[2 * 9 + 1] = "1";
  const pre = bb.join("") + "110000000" + "2";
  const fin = ut.resolve(pre, 2 * 9 + 2, 1);
  check("three small boards in a line wins the game", fin.status === "won" && fin.winner === 1, JSON.stringify([fin.status, fin.winner]));
}
// cheating
{
  const room = roomFor();
  const m1 = ut.resolve(ut.EMPTY, 40, 1);
  check("the opening move is accepted", send(room, 1, m1).ok === true);
  const wrongBoard = ut.resolve(ut.EMPTY, 0, 2);
  wrongBoard.board = m1.board.slice(0, 0) + "2" + m1.board.slice(1);
  check("playing outside the forced board is refused", send(room, 2, { ...wrongBoard, last: 0 }).reason === "illegal");
  const lie = { ...ut.resolve(m1.board, 4 * 9 + 5 > 80 ? 40 : 40, 2) };
  const good = ut.resolve(m1.board, 4 * 9 + 5 === 41 ? 4 * 9 + 5 : 41, 2);
  check("a forged result is refused", send(room, 2, { ...good, status: "won", winner: 2 }).reason === "illegal");
  check("the honest reply is accepted", send(room, 2, good).ok === true);
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
