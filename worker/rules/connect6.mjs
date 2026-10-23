/* ============================================================
   rules/connect6.mjs — server-side rules for live Connect6.

   The rules live in connect6/rules.js, the same file the page loads, so the
   browser and the server cannot disagree. Importing it sets
   globalThis.Connect6Rules. See that file for the wire format (227
   characters: 225 points, the side to move, then how many stones that side
   has already placed this turn).
   ============================================================ */
import "../../connect6/rules.js";

const R = globalThis.Connect6Rules;

export function validateTransition(prev, next, mover) {
  return R.check(prev, next, mover);
}
