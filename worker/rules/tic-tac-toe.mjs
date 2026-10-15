/* ============================================================
   rules/tic-tac-toe.mjs — server-side rules for live Tic-Tac-Toe.

   Pure functions, no Cloudflare APIs, so they run under plain node in
   the tests. The wire board matches tic-tac-toe/game.js exactly: a
   9-char string, row by row, "." for an empty cell, X always opens.
   ============================================================ */

export const EMPTY = ".........";

const LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

export function lineWinner(b) {
  for (const [a, c, d] of LINES) {
    if (b[a] !== "." && b[a] === b[c] && b[a] === b[d]) return b[a];
  }
  return null;
}

/* prev: the room's current envelope, or null before the first move.
   next: the envelope the mover proposes. mover: "X" | "O".
   Returns { ok: true } or { ok: false, reason }. The generic envelope
   checks (id, moveCount, whose turn) live in live-protocol.mjs; this is
   only "is this a legal Tic-Tac-Toe move". */
export function validateTransition(prev, next, mover) {
  const before = prev ? prev.board : EMPTY;
  const after = next.board;
  if (typeof before !== "string" || before.length !== 9) return { ok: false, reason: "illegal" };
  if (typeof after !== "string" || !/^[.XO]{9}$/.test(after)) return { ok: false, reason: "illegal" };
  if (mover !== "X" && mover !== "O") return { ok: false, reason: "illegal" };

  let changed = -1;
  for (let i = 0; i < 9; i++) {
    if (before[i] === after[i]) continue;
    if (changed !== -1) return { ok: false, reason: "illegal" };   // more than one cell
    changed = i;
  }
  if (changed === -1) return { ok: false, reason: "illegal" };      // no move at all
  if (before[changed] !== "." || after[changed] !== mover) return { ok: false, reason: "illegal" };
  if (next.last !== changed) return { ok: false, reason: "illegal" };

  const w = lineWinner(after);
  if (w) {
    if (next.status !== "won" || next.winner !== w || w !== mover) return { ok: false, reason: "illegal" };
  } else if (!after.includes(".")) {
    if (next.status !== "draw" || next.winner !== null) return { ok: false, reason: "illegal" };
  } else if (next.status !== "in_progress" || next.winner !== null) {
    return { ok: false, reason: "illegal" };
  }
  return { ok: true };
}
