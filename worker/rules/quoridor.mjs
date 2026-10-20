/* ============================================================
   rules/quoridor.mjs — server-side rules for live Quoridor.

   The rules live in quoridor/rules.js, the same file the page loads, so the
   browser and the server cannot disagree. Importing it sets
   globalThis.QuoridorRules. See that file for the wire format.
   ============================================================ */
import "../../quoridor/rules.js";

export function validateTransition(prev, next, mover) {
  return globalThis.QuoridorRules.check(prev, next, mover);
}
