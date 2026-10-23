/* ============================================================
   rules/nine-mens-morris.mjs — server-side rules for live Nine Men's Morris.

   The rules live in nine-mens-morris/rules.js, the same file the page loads, so
   the browser and the server cannot disagree. Importing it sets
   globalThis.NineMensMorrisRules. See that file for the wire format.
   ============================================================ */
import "../../nine-mens-morris/rules.js";

const R = globalThis.NineMensMorrisRules;

export function validateTransition(prev, next, mover) {
  return R.check(prev, next, mover);
}
