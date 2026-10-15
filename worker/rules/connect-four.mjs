/* ============================================================
   rules/connect-four.mjs — server-side rules for live Connect Four.

   Wire board (same as connect-four/game.js): 42 chars, index = row * 7 +
   col with row 0 at the TOP, '0' empty, '1' Red (opens), '2' Yellow.
   Players are the numbers 1 and 2.
   ============================================================ */

export const ROWS = 6, COLS = 7;
export const EMPTY = "0".repeat(ROWS * COLS);

const DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];

/* Does the piece at idx complete four in a row? */
export function winsAt(board, idx) {
  const r = Math.floor(idx / COLS), c = idx % COLS, p = board[idx];
  if (p === "0") return false;
  for (const [dr, dc] of DIRS) {
    let n = 1;
    for (const s of [1, -1]) {
      for (let k = 1; k < 4; k++) {
        const rr = r + dr * k * s, cc = c + dc * k * s;
        if (rr < 0 || rr >= ROWS || cc < 0 || cc >= COLS || board[rr * COLS + cc] !== p) break;
        n++;
      }
    }
    if (n >= 4) return true;
  }
  return false;
}

/* Lowest empty row in a column, or -1 if the column is full. */
export function dropRow(board, col) {
  for (let r = ROWS - 1; r >= 0; r--) if (board[r * COLS + col] === "0") return r;
  return -1;
}

/* What a move in col by mover looks like on the wire (null if the column is full). */
export function moveInColumn(board, col, mover) {
  const r = dropRow(board, col);
  if (r < 0) return null;
  const idx = r * COLS + col;
  const next = board.slice(0, idx) + String(mover) + board.slice(idx + 1);
  const win = winsAt(next, idx);
  const full = !next.includes("0");
  return {
    board: next, last: idx,
    status: win ? "won" : full ? "draw" : "in_progress",
    winner: win ? mover : null,
  };
}

export function validateTransition(prev, next, mover) {
  const bad = { ok: false, reason: "illegal" };
  const before = prev ? prev.board : EMPTY;
  const after = next.board;
  if (mover !== 1 && mover !== 2) return bad;
  if (typeof before !== "string" || before.length !== ROWS * COLS) return bad;
  if (typeof after !== "string" || !/^[012]{42}$/.test(after)) return bad;

  let idx = -1;
  for (let i = 0; i < after.length; i++) {
    if (before[i] === after[i]) continue;
    if (idx !== -1) return bad;                 // more than one cell changed
    idx = i;
  }
  if (idx === -1) return bad;
  if (before[idx] !== "0" || after[idx] !== String(mover)) return bad;
  // gravity: the cell must rest on the floor or on another checker
  if (idx < (ROWS - 1) * COLS && before[idx + COLS] === "0") return bad;
  if (next.last !== idx) return bad;

  const win = winsAt(after, idx);
  const full = !after.includes("0");
  if (win) {
    if (next.status !== "won" || next.winner !== mover) return bad;
  } else if (full) {
    if (next.status !== "draw" || next.winner !== null) return bad;
  } else if (next.status !== "in_progress" || next.winner !== null) {
    return bad;
  }
  return { ok: true };
}
