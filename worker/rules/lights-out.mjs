/* ============================================================
   rules/lights-out.mjs — server-side rules for live Lights Out.

   Wire board (same as lights-out/game.js): an object { bits } — the 5x5
   light pattern packed into one integer (bit i = light i, row-major). A
   press toggles the cell and its four neighbours; whoever's press turns
   the last light off wins; after MOVE_CAP combined presses it is a draw.
   Players are the numbers 1 and 2.

   The opening position is scrambled by the first mover's browser, so the
   server cannot recompute it. It can still check the first press is a real
   press on a position that had at least one light lit.
   ============================================================ */

const N = 5, CELLS = N * N;
export const MOVE_CAP = 60;
const MAX_BITS = 1 << CELLS;

export function press(bits, idx) {
  const r = Math.floor(idx / N), c = idx % N;
  let b = bits ^ (1 << idx);
  if (r > 0) b ^= 1 << (idx - N);
  if (r < N - 1) b ^= 1 << (idx + N);
  if (c > 0) b ^= 1 << (idx - 1);
  if (c < N - 1) b ^= 1 << (idx + 1);
  return b;
}

/* The wire result of player pressing idx on bits as move number moveCount. */
export function resolve(bits, idx, player, moveCount) {
  const next = press(bits, idx);
  let status = "in_progress", winner = null;
  if (next === 0) { status = "won"; winner = player; }
  else if (moveCount >= MOVE_CAP) status = "draw";
  return { board: { bits: next }, last: idx, status, winner };
}

export function validateTransition(prev, next, mover) {
  const bad = { ok: false, reason: "illegal" };
  if (mover !== 1 && mover !== 2) return bad;
  const b = next.board;
  if (!b || typeof b !== "object" || !Number.isInteger(b.bits) || b.bits < 0 || b.bits >= MAX_BITS) return bad;
  const idx = next.last;
  if (!Number.isInteger(idx) || idx < 0 || idx >= CELLS) return bad;

  // Before the press: the previous position, or (first move) undo the press.
  const before = prev ? prev.board.bits : press(b.bits, idx);
  if (!prev && before === 0) return bad;             // nothing was lit to begin with

  const want = resolve(before, idx, mover, next.moveCount);
  if (b.bits !== want.board.bits) return bad;
  if (next.status !== want.status || next.winner !== want.winner) return bad;
  return { ok: true };
}
