/* ============================================================
   rules/dots-and-boxes.mjs — server-side rules for live Dots and Boxes.

   Wire board (same as dots-and-boxes/game.js): 56 chars — 40 edge flags
   ('0' / '1': 20 horizontal then 20 vertical) then 16 box owners
   ('0' / '1' / '2'). 5x5 dots -> 4x4 boxes. Completing a box (or two)
   grants another turn. Players are the numbers 1 and 2.
   ============================================================ */

const DOTS = 5, BOXES = 4;
const H_COUNT = DOTS * BOXES, V_COUNT = BOXES * DOTS;
export const EDGE_COUNT = H_COUNT + V_COUNT;     // 40
export const BOX_COUNT = BOXES * BOXES;          // 16
export const EMPTY = "0".repeat(EDGE_COUNT + BOX_COUNT);

const hIdx = (r, c) => r * BOXES + c;
const vIdx = (r, c) => H_COUNT + r * DOTS + c;
const boxIdx = (r, c) => r * BOXES + c;
const other = (p) => (p === 1 ? 2 : 1);

function boxEdges(r, c) { return [hIdx(r, c), hIdx(r + 1, c), vIdx(r, c), vIdx(r, c + 1)]; }

/* The boxes an edge borders. */
function touching(edge) {
  const out = [];
  if (edge < H_COUNT) {
    const r = Math.floor(edge / BOXES), c = edge % BOXES;
    if (r - 1 >= 0) out.push(boxIdx(r - 1, c));
    if (r < BOXES) out.push(boxIdx(r, c));
  } else {
    const j = edge - H_COUNT, r = Math.floor(j / DOTS), c = j % DOTS;
    if (c - 1 >= 0) out.push(boxIdx(r, c - 1));
    if (c < BOXES) out.push(boxIdx(r, c));
  }
  return out;
}

/* Draw edge for player on a board string. Returns the new board and how
   many boxes it just completed. */
export function drawEdge(board, edge, player) {
  const cells = board.split("");
  cells[edge] = "1";
  let claimed = 0;
  for (const bi of touching(edge)) {
    const r = Math.floor(bi / BOXES), c = bi % BOXES;
    if (cells[EDGE_COUNT + bi] === "0" && boxEdges(r, c).every((i) => cells[i] === "1")) {
      cells[EDGE_COUNT + bi] = String(player);
      claimed++;
    }
  }
  return { board: cells.join(""), claimed };
}

export function counts(board) {
  let a = 0, b = 0;
  for (const ch of board.slice(EDGE_COUNT)) { if (ch === "1") a++; else if (ch === "2") b++; }
  return { 1: a, 2: b };
}

const edgesDone = (board) => board.slice(0, EDGE_COUNT).split("").every((ch) => ch === "1");

/* The wire result of player drawing edge. */
export function resolve(board, edge, player) {
  const { board: next, claimed } = drawEdge(board, edge, player);
  let status = "in_progress", winner = null;
  if (edgesDone(next)) {
    const c = counts(next);
    status = c[1] === c[2] ? "draw" : "won";
    winner = c[1] === c[2] ? null : (c[1] > c[2] ? 1 : 2);
  }
  return {
    board: next, last: edge, status, winner,
    // the final edge always completes a box, but the game is over: nobody "goes again"
    nextTurn: status === "in_progress" && claimed > 0 ? player : other(player),
  };
}

export function validateTransition(prev, next, mover) {
  const bad = { ok: false, reason: "illegal" };
  if (mover !== 1 && mover !== 2) return bad;
  const before = prev ? prev.board : EMPTY;
  if (typeof before !== "string" || before.length !== EDGE_COUNT + BOX_COUNT) return bad;
  const after = next.board;
  if (typeof after !== "string" || after.length !== EDGE_COUNT + BOX_COUNT) return bad;
  if (!/^[01]+$/.test(after.slice(0, EDGE_COUNT)) || !/^[012]+$/.test(after.slice(EDGE_COUNT))) return bad;
  const edge = next.last;
  if (!Number.isInteger(edge) || edge < 0 || edge >= EDGE_COUNT) return bad;
  if (before[edge] !== "0") return bad;

  const want = resolve(before, edge, mover);
  if (after !== want.board) return bad;
  if (next.status !== want.status || next.winner !== want.winner) return bad;
  return { ok: true, nextTurn: want.nextTurn };
}
