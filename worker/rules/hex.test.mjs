/* Run: node worker/rules/hex.test.mjs  — random legal games through the real room protocol */
import { newRoom, join, applyMove } from "../live-protocol.mjs";
import * as hx from "./hex.mjs";

let pass = 0, fail = 0;
function check(name, ok, detail) { if (ok) pass++; else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? " — " + detail : "")); } }
let n = 0;
const mint = () => "t" + ++n;
function roomFor() { const room = newRoom("hex", "ABC234", 1000); join(room, null, mint, 1000); join(room, null, mint, 1000); return room; }
const send = (room, seat, m) => applyMove(room, seat, { t: "move", n: room.state ? room.state.moveCount : 0, s: {
  game: "hex", version: 1, id: room.id, turn: m.nextTurn, board: m.board, status: m.status, winner: m.winner,
  moveCount: (room.state ? room.state.moveCount : 0) + 1, last: m.last } }, 2000);
const rnd = (a) => a[Math.floor(Math.random() * a.length)];
const put = (b, cells, p) => { for (const c of cells) b = b.slice(0, c) + p + b.slice(c + 1); return b; };

console.log("hex:");
// chains
const S = hx.SIZE;
check("a straight column wins for Red (top to bottom)", hx.winningChain(put(hx.EMPTY, Array.from({ length: S }, (_, r) => r * S + 5), "1"), 1) !== null);
check("a straight row wins for Blue (left to right)", hx.winningChain(put(hx.EMPTY, Array.from({ length: S }, (_, c) => 5 * S + c), "2"), 2) !== null);
check("a column does not win for Blue", hx.winningChain(put(hx.EMPTY, Array.from({ length: S }, (_, r) => r * S + 5), "1"), 2) === null);
// the diagonal that uses the (r-1, c+1) neighbour: cells (10,0),(9,1),...(0,10) is a connected line, which crosses both
const anti = Array.from({ length: S }, (_, k) => (S - 1 - k) * S + k);
check("the short diagonal is connected (it uses the extra neighbour)", hx.winningChain(put(hx.EMPTY, anti, "1"), 1) !== null);
const diag = Array.from({ length: S }, (_, k) => k * S + k);
check("the long diagonal is NOT connected", hx.winningChain(put(hx.EMPTY, diag, "1"), 1) === null);
check("one stone short of a chain is not a win", hx.winningChain(put(hx.EMPTY, Array.from({ length: S - 1 }, (_, r) => r * S + 5), "1"), 1) === null);

let finished = 0, red = 0, blue = 0;
for (let g = 0; g < 300; g++) {
  const room = roomFor();
  let board = hx.EMPTY, mover = 1, guard = 0, ok = true;
  while (guard++ < 200) {
    const free = []; for (let i = 0; i < hx.CELLS; i++) if (board[i] === "0") free.push(i);
    if (!free.length) { check("Hex has no draws: a full board always has a winner", false); ok = false; break; }
    const m = hx.resolve(board, rnd(free), mover);
    const r = send(room, mover, m);
    if (!r.ok) { check("a legal random move is accepted", false, r.reason); ok = false; break; }
    board = m.board;
    if (m.status !== "in_progress") { finished++; if (m.winner === 1) red++; else blue++; break; }
    mover = m.nextTurn;
  }
  if (!ok) break;
}
check("every random game finished with a winner", finished === 300, finished);
check("both colours win some random games", red > 30 && blue > 30, red + " / " + blue);

{
  const room = roomFor();
  const m1 = hx.resolve(hx.EMPTY, 60, 1);
  check("the opening is accepted", send(room, 1, m1).ok === true);
  check("playing on a taken cell is refused", send(room, 2, { ...hx.resolve(m1.board, 61, 2), board: m1.board.slice(0, 60) + "2" + m1.board.slice(61), last: 60 }).reason === "illegal");
  check("a forged win is refused", send(room, 2, { ...hx.resolve(m1.board, 3, 2), status: "won", winner: 2 }).reason === "illegal");
  check("the honest reply is accepted", send(room, 2, hx.resolve(m1.board, 3, 2)).ok === true);
}
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
