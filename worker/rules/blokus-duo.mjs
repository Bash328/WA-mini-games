/* ============================================================
   rules/blokus-duo.mjs — server-side rules for live Blokus Duo.

   The rules themselves live in blokus-duo/rules.js, the same file the page
   loads, so the browser and the server cannot disagree. Importing it sets
   globalThis.BlokusRules. See that file for the wire format.
   ============================================================ */
import "../../blokus-duo/rules.js";

const R = globalThis.BlokusRules;
export const EMPTY = R.EMPTY;

export function validateTransition(prev, next, mover) {
  const bad = { ok: false, reason: "illegal" };
  if (mover !== 1 && mover !== 2) return bad;
  const before = prev ? prev.board : EMPTY;
  const res = R.check(before, next.board, mover);
  if (!res.ok) return bad;
  if (!Number.isInteger(next.last) || res.cells.indexOf(next.last) === -1) return bad;
  const o = res.outcome;
  if (next.status !== o.status || next.winner !== o.winner) return bad;
  return { ok: true, nextTurn: o.nextTurn };
}
