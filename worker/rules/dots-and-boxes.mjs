/* ============================================================
   rules/dots-and-boxes.mjs — server-side rules for live Dots and Boxes.

   Wire board (same as dots-and-boxes/game.js), version 2:
     1 char   the board size N (boxes per side, 3-6), chosen by whoever
              makes the first move and fixed for the whole game
     then     N*(N+1) horizontal edges, then N*(N+1) vertical edges
              ('0' undrawn, '1' drawn by an unknown hand, '2' Player 1's,
              '3' Player 2's)
     then     N*N box owners ('0' / '1' / '2').
   N = 4 is 5x5 dots, 4x4 boxes (the original size). Completing a box (or
   two) grants another turn. Players are the numbers 1 and 2.
   ============================================================ */

export const SIZES = [3, 4, 5, 6];
export const DEFAULT_SIZE = 4;

export function geom(n) {
  const dots = n + 1, h = dots * n, v = n * dots;
  return { n, dots, h, v, edges: h + v, boxes: n * n };
}
export const emptyBoard = (n = DEFAULT_SIZE) => String(n) + "0".repeat(geom(n).edges + geom(n).boxes);

const sizeOf = (board) => Number(String(board)[0]);
const other = (p) => (p === 1 ? 2 : 1);

/* The boxes an edge borders (indexes 0..n*n-1). */
function touching(g, edge) {
  const out = [];
  if (edge < g.h) {
    const r = Math.floor(edge / g.n), c = edge % g.n;
    if (r - 1 >= 0) out.push((r - 1) * g.n + c);
    if (r < g.n) out.push(r * g.n + c);
  } else {
    const j = edge - g.h, r = Math.floor(j / g.dots), c = j % g.dots;
    if (c - 1 >= 0) out.push(r * g.n + c - 1);
    if (c < g.n) out.push(r * g.n + c);
  }
  return out;
}
const boxEdges = (g, r, c) => [r * g.n + c, (r + 1) * g.n + c, g.h + r * g.dots + c, g.h + r * g.dots + c + 1];

/* Draw edge for player on a board string. Returns the new board and how
   many boxes it just completed. */
export function drawEdge(board, edge, player) {
  const g = geom(sizeOf(board));
  const cells = board.split("");
  cells[1 + edge] = String(player + 1);
  let claimed = 0;
  for (const bi of touching(g, edge)) {
    const r = Math.floor(bi / g.n), c = bi % g.n;
    if (cells[1 + g.edges + bi] === "0" && boxEdges(g, r, c).every((i) => cells[1 + i] !== "0")) {
      cells[1 + g.edges + bi] = String(player);
      claimed++;
    }
  }
  return { board: cells.join(""), claimed };
}

export function counts(board) {
  const g = geom(sizeOf(board));
  let a = 0, b = 0;
  for (const ch of board.slice(1 + g.edges)) { if (ch === "1") a++; else if (ch === "2") b++; }
  return { 1: a, 2: b };
}

const edgesDone = (board) => {
  const g = geom(sizeOf(board));
  return board.slice(1, 1 + g.edges).split("").every((ch) => ch !== "0");
};

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
  const after = next.board;
  if (typeof after !== "string" || !SIZES.includes(sizeOf(after))) return bad;
  const n = sizeOf(after);
  // The first move picks the size; every later move must keep it.
  const before = prev ? prev.board : emptyBoard(n);
  if (typeof before !== "string" || sizeOf(before) !== n) return bad;
  const g = geom(n);
  const len = 1 + g.edges + g.boxes;
  if (before.length !== len || after.length !== len) return bad;
  if (!/^[0-3]+$/.test(after.slice(1, 1 + g.edges)) || !/^[012]+$/.test(after.slice(1 + g.edges))) return bad;
  const edge = next.last;
  if (!Number.isInteger(edge) || edge < 0 || edge >= g.edges) return bad;
  if (before[1 + edge] !== "0") return bad;

  const want = resolve(before, edge, mover);
  if (after !== want.board) return bad;
  if (next.status !== want.status || next.winner !== want.winner) return bad;
  return { ok: true, nextTurn: want.nextTurn };
}
