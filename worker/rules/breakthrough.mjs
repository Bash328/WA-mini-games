/* ============================================================
   rules/breakthrough.mjs — server-side rules for live Breakthrough.

   The rules live in breakthrough/rules.js, the same file the page loads, so
   the browser and the server cannot disagree. Importing it sets
   globalThis.BreakthroughRules. See that file for the wire format.
   ============================================================ */
import "../../breakthrough/rules.js";

const R = globalThis.BreakthroughRules;

export function validateTransition(prev, next, mover) {
  return R.check(prev, next, mover);
}
