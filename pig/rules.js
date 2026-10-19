/* ============================================================
   pig/rules.js — the online rules of Pig, written once.

   A plain script that sets globalThis.PigRules, so the page loads it with a <script> tag
   and the Worker (worker/rules/pig.mjs) and the tests import it for the same effect.

   Online, the SERVER rolls the die: a player never sends a roll, only a REQUEST for one,
   and `stamp` (called by the room after the request is accepted) writes the server's die
   into the board. Over WhatsApp the roller's browser rolls and the game runs on trust;
   that mode does not use this file.

   Wire board: "<player 1 score>.<player 2 score>.<turn total>.<rolls this turn>.<flag>"
     flag  n  a new game, nothing has happened yet
           c  the player to move is part-way through a turn: <turn total> and <rolls> are theirs
           b  the previous mover rolled a 1 and lost their turn: <rolls> are their rolls (the last is the 1)
           h  the previous mover held: <rolls> are their rolls, the points are already in their score
           r  a REQUEST for a roll (only ever sent by a client; the server replaces it)
   Example: "34.12.9.45.c" — it is the mover's turn, they have rolled 4 then 5.
   last: 0 for a roll, the banked points for a hold.
   ============================================================ */
(function (global) {
  "use strict";

  const GOAL = 100, MAX_ROLLS = 60;
  const other = (p) => (p === 1 ? 2 : 1);
  const RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.([1-6]{0,60})\.([nbchr])$/;

  function parse(board) {
    const m = RE.exec(String(board));
    if (!m) return null;
    return { s: [+m[1], +m[2]], t: +m[3], rolls: m[4].split("").map(Number), f: m[5] };
  }
  function str(S) { return S.s[0] + "." + S.s[1] + "." + S.t + "." + S.rolls.join("") + "." + S.f; }
  function initial() { return "0.0.0..n"; }

  // what the player who is about to move has already done this turn
  function ongoing(B) { return B.f === "c" ? { t: B.t, rolls: B.rolls.slice() } : { t: 0, rolls: [] }; }

  const sameRolls = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
  const BAD = { ok: false, reason: "illegal" };

  // The board a client sends to ask for a roll, and to hold.
  function rollRequest(prevBoard) {
    const B = parse(prevBoard || initial()), o = ongoing(B);
    return str({ s: B.s, t: o.t, rolls: o.rolls, f: "r" });
  }
  function holdBoard(prevBoard, mover) {
    const B = parse(prevBoard || initial()), o = ongoing(B);
    const s = B.s.slice(); s[mover - 1] += o.t;
    return { board: str({ s: s, t: 0, rolls: o.rolls, f: "h" }), banked: o.t, won: s[mover - 1] >= GOAL };
  }

  // Is `next` a legal thing for `mover` to propose after `prev` (null at the start of a game)?
  function check(prev, next, mover) {
    if (mover !== 1 && mover !== 2) return BAD;
    if (!prev && mover !== 1) return BAD;
    const base = parse(prev ? prev.board : initial()), after = parse(next.board);
    if (!base || !after) return BAD;
    const o = ongoing(base);
    if (after.f === "r") {
      if (o.rolls.length >= MAX_ROLLS) return BAD;
      if (after.s[0] !== base.s[0] || after.s[1] !== base.s[1] || after.t !== o.t || !sameRolls(after.rolls, o.rolls)) return BAD;
      if (next.status !== "in_progress" || next.winner !== null || next.last !== 0) return BAD;
      return { ok: true, nextTurn: mover };                              // the same player rolls on; stamp may pass the turn
    }
    if (after.f === "h") {
      if (o.t <= 0) return BAD;
      const want = holdBoard(prev ? prev.board : null, mover);
      if (str(after) !== want.board || next.last !== want.banked) return BAD;
      if (want.won) { if (next.status !== "won" || next.winner !== mover) return BAD; }
      else if (next.status !== "in_progress" || next.winner !== null) return BAD;
      return { ok: true, nextTurn: other(mover) };
    }
    return BAD;                                                           // a client can never send a finished roll
  }

  // After an accepted roll request the server rolls. A 1 loses the turn and passes it on.
  function stamp(prev, next, mover, rng) {
    const B = parse(next.board);
    if (!B || B.f !== "r") return { board: next.board, turn: other(mover) };       // a hold: the turn already passes
    const r = 1 + Math.floor(rng() * 6);
    if (r === 1) return { board: str({ s: B.s, t: 0, rolls: B.rolls.concat(1), f: "b" }), turn: other(mover) };
    return { board: str({ s: B.s, t: B.t + r, rolls: B.rolls.concat(r), f: "c" }), turn: mover };
  }

  global.PigRules = { GOAL, MAX_ROLLS, parse, str, initial, ongoing, rollRequest, holdBoard, check, stamp };
})(typeof globalThis !== "undefined" ? globalThis : this);
