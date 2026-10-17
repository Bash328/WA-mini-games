/* ============================================================
   rules/onitama.mjs — server-side rules for live Onitama.

   The rules live in onitama/rules.js, the same file the page loads, so the
   browser and the server cannot disagree. Importing it sets
   globalThis.OnitamaRules. See that file for the wire format.
   ============================================================ */
import "../../onitama/rules.js";

const R = globalThis.OnitamaRules;

export function validateTransition(prev, next, mover) {
  return R.check(prev, next, mover);
}
