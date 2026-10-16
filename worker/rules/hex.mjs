/* ============================================================
   rules/hex.mjs — server-side rules for live Hex.

   Wire board (same as hex/game.js): 121 chars, row by row on an 11x11
   rhombus board, '0' empty, '1' Red's stone, '2' Blue's. Red (player 1)
   opens and connects the TOP edge to the BOTTOM edge; Blue connects LEFT to
   RIGHT. A cell (r, c) touches (r, c-1), (r, c+1), (r-1, c), (r+1, c),
   (r-1, c+1) and (r+1, c-1). One of the two always wins: there are no draws.
   `last` is the index of the stone just placed. Players are the numbers 1, 2.
   ============================================================ */

export const SIZE = 11;
export const CELLS = SIZE * SIZE;
export const EMPTY = "0".repeat(CELLS);
const NEIGH = [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, 1], [1, -1]];
const other = (p) => (p === 1 ? 2 : 1);

/* Does `player` (1: top-bottom, 2: left-right) have a chain across the board?
   Returns the winning chain's cell indexes, or null. */
export function winningChain(board, player) {
  const ch = String(player);
  const prev = new Int16Array(CELLS).fill(-2);   // -2 unseen, -1 start
  const queue = [];
  for (let k = 0; k < SIZE; k++) {
    const i = player === 1 ? k : k * SIZE;       // top row, or left column
    if (board[i] === ch) { prev[i] = -1; queue.push(i); }
  }
  while (queue.length) {
    const i = queue.shift();
    const r = Math.floor(i / SIZE), c = i % SIZE;
    if ((player === 1 && r === SIZE - 1) || (player === 2 && c === SIZE - 1)) {
      const chain = [];
      for (let j = i; j !== -1; j = prev[j]) chain.push(j);
      return chain;
    }
    for (const [dr, dc] of NEIGH) {
      const rr = r + dr, cc = c + dc;
      if (rr < 0 || rr >= SIZE || cc < 0 || cc >= SIZE) continue;
      const j = rr * SIZE + cc;
      if (board[j] === ch && prev[j] === -2) { prev[j] = i; queue.push(j); }
    }
  }
  return null;
}

/* The wire result of player placing a stone on idx. */
export function resolve(board, idx, player) {
  const next = board.slice(0, idx) + String(player) + board.slice(idx + 1);
  const won = winningChain(next, player) !== null;
  return {
    board: next, last: idx,
    status: won ? "won" : "in_progress",
    winner: won ? player : null,
    nextTurn: other(player),
  };
}

export function validateTransition(prev, next, mover) {
  const bad = { ok: false, reason: "illegal" };
  if (mover !== 1 && mover !== 2) return bad;
  const before = prev ? prev.board : EMPTY;
  const after = next.board;
  if (typeof before !== "string" || before.length !== CELLS) return bad;
  if (typeof after !== "string" || after.length !== CELLS || !/^[012]+$/.test(after)) return bad;
  const idx = next.last;
  if (!Number.isInteger(idx) || idx < 0 || idx >= CELLS || before[idx] !== "0") return bad;
  const want = resolve(before, idx, mover);
  if (after !== want.board) return bad;
  if (next.status !== want.status || next.winner !== want.winner) return bad;
  return { ok: true, nextTurn: want.nextTurn };
}
