/* ============================================================
   rules/fanorona.mjs — server-side rules for live Fanorona.

   The rules live in fanorona/rules.js, the same file the page loads, so the
   browser and the server cannot disagree. Importing it sets
   globalThis.FanoronaRules. See that file for the wire format: one commit is
   one chain step, so a multi-capture turn is several validated transitions.
   ============================================================ */
import "../../fanorona/rules.js";

const R = globalThis.FanoronaRules;

export function validateTransition(prev, next, mover) {
  return R.check(prev, next, mover);
}
