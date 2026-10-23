/* ============================================================
   rules/tablut.mjs — server-side rules for live Tablut.

   The rules live in tablut/rules.js, the same file the page loads, so the
   browser and the server cannot disagree. Importing it sets
   globalThis.TablutRules. See that file for the wire format and the exact
   capture and king rules.
   ============================================================ */
import "../../tablut/rules.js";

const R = globalThis.TablutRules;

export function validateTransition(prev, next, mover) {
  return R.check(prev, next, mover);
}
