/* ============================================================
   rules/gomoku.mjs — server-side rules for live Gomoku.

   Wire board (same as gomoku/game.js): 225 chars, row by row on a 15x15
   board, '0' empty, '1' Black's stone, '2' White's. Black (player 1) opens.
   Five or more in a row, in any direction, wins ("free-style" Gomoku: no
   overline or 3-3 restrictions). A full board is a draw. `last` is the
   index of the stone just placed. Players are the numbers 1 and 2.
   ============================================================ */

export const SIZE = 15;
export const CELLS = SIZE * SIZE;
export const EMPTY = "0".repeat(CELLS);
const DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];
const other = (p) => (p === 1 ? 2 : 1);

/* Does the stone at idx (already on the board) finish five or more? */
export function winsAt(board, idx) {
  const p = board[idx];
  if (p !== "1" && p !== "2") return false;
  const r0 = Math.floor(idx / SIZE), c0 = idx % SIZE;
  for (const [dr, dc] of DIRS) {
    let n = 1;
    for (const s of [1, -1]) {
      let r = r0 + dr * s, c = c0 + dc * s;
      while (r >= 0 && r < SIZE && c >= 0 && c < SIZE && board[r * SIZE + c] === p) { n++; r += dr * s; c += dc * s; }
    }
    if (n >= 5) return true;
  }
  return false;
}

/* The wire result of player placing a stone on idx. */
export function resolve(board, idx, player) {
  const next = board.slice(0, idx) + String(player) + board.slice(idx + 1);
  const won = winsAt(next, idx);
  const full = !next.includes("0");
  return {
    board: next, last: idx,
    status: won ? "won" : full ? "draw" : "in_progress",
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
