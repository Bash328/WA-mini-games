/* ============================================================
   rules/pig.mjs — server-side rules for live Pig.

   The rules live in pig/rules.js, the same file the page loads, so the browser and
   the server cannot disagree. Importing it sets globalThis.PigRules.

   The server rolls the die: a client only asks for a roll, and `stamp` writes the
   server's die into the board (a 1 loses the turn and passes it on). So nobody can
   choose their own roll, which is why Pig can be played online although it cannot be
   trusted over a WhatsApp link.
   ============================================================ */
import "../../pig/rules.js";

const R = globalThis.PigRules;

export function validateTransition(prev, next, mover) {
  return R.check(prev, next, mover);
}
export function stamp(prev, next, mover, rand) {
  return R.stamp(prev, next, mover, rand);
}
