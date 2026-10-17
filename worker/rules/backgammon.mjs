/* ============================================================
   rules/backgammon.mjs — server-side rules for live Backgammon.

   The rules live in backgammon/rules.js, the same file the page loads, so the
   browser and the server cannot disagree. Importing it sets
   globalThis.BackgammonRules. See that file for the wire format.

   The server rolls the dice: after every accepted turn `stamp` writes the next
   player's roll into the board (and passes the turn on if that player has no legal
   move), so nobody can choose their own dice. The very first roll comes from the
   room id (openingDice), which the page can compute too.
   ============================================================ */
import "../../backgammon/rules.js";

const R = globalThis.BackgammonRules;

export function validateTransition(prev, next, mover) {
  return R.check(prev, next, mover);
}
export function stamp(prev, next, mover, rand) {
  return R.stamp(prev, next, mover, rand);
}
