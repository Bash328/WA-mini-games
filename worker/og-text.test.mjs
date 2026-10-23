/* Run: node worker/og-text.test.mjs
   Exercises the preview text against states encoded exactly the way
   async-share.js encodes them. */

import LZString from "../assets/vendor/lz-string.min.js";
import { ogFor, ogForLive, slugFor, decodeState, SUPPORTED_GAMES } from "./og-text.mjs";

const enc = (o) =>
  LZString.compressToEncodedURIComponent(JSON.stringify(o)).replace(/\+/g, "_");

// Same wire shape async-share.js writes: g v i t b s w n l
const state = (o) => enc({
  g: o.g, v: o.v ?? 1, i: "a3f9k2", t: o.t, b: o.b ?? "....",
  s: o.s ?? "p", w: o.w ?? null, n: o.n ?? 3, l: o.l ?? 0,
});

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? "  PASS  " : "  FAIL  ") + name);
  if (!ok) { console.log("     got:  " + JSON.stringify(got));
             console.log("     want: " + JSON.stringify(want)); fail++; } else pass++;
}
function checkThat(name, cond, detail) {
  console.log((cond ? "  PASS  " : "  FAIL  ") + name + (cond ? "" : " — " + detail));
  cond ? pass++ : fail++;
}

console.log("path -> slug:");
check("trailing slash", slugFor("/tic-tac-toe/"), "tic-tac-toe");
check("explicit index", slugFor("/chess/index.html"), "chess");
check("site root", slugFor("/"), "");

console.log("\nin-progress links say whose turn it is:");
check("tic-tac-toe, O to play",
  ogFor("/tic-tac-toe/", state({ g: "tic-tac-toe", v: 2, t: "O", b: "X.O.X...O", n: 5 })),
  { title: "Your move · tic-tac-toe",
    description: "You're O, 5 moves in. Open the board to play your turn." });
check("connect-four maps 2 -> Yellow",
  ogFor("/connect-four/", state({ g: "connect-four", v: 2, t: 2, n: 1 })),
  { title: "Your move · connect-four",
    description: "You're Yellow, 1 move in. Open the board to play your turn." });
check("chess maps b -> Black",
  ogFor("/chess/", state({ g: "chess", t: "b", n: 12 })),
  { title: "Your move · chess",
    description: "You're Black, 12 moves in. Open the board to play your turn." });

check("battleship in progress",
  ogFor("/battleship/", state({ g: "battleship", t: 2, n: 4 })),
  { title: "Your move · battleship",
    description: "You're Player 2, 4 moves in. Open the board to play your turn." });
check("mastermind uses role names",
  ogFor("/mastermind/", state({ g: "mastermind", t: 2, n: 1 })),
  { title: "Your move · mastermind",
    description: "You're Codebreaker, 1 move in. Open the board to play your turn." });

console.log("\nfinished games:");
check("a win names the winner",
  ogFor("/reversi/", state({ g: "reversi", t: 1, s: "w", w: 2, n: 30 })),
  { title: "White won · reversi",
    description: "Game over after 30 moves. Open to see the final board." });
check("a draw",
  ogFor("/tic-tac-toe/", state({ g: "tic-tac-toe", v: 2, t: "X", s: "d", n: 9 })),
  { title: "Draw · tic-tac-toe",
    description: "Game over after 9 moves. Open to see the final board." });

console.log("\nlive invite links:");
check("valid tic-tac-toe invite",
  ogForLive("/tic-tac-toe/", "K7P2QX"),
  { title: "Join a live game · tic-tac-toe",
    description: "You've been invited to play tic-tac-toe in real time. Tap to join, no sign-up." });
check("every multi-seat card game gets an invite preview",
  ["/crazy-8/", "/liars-dice/", "/dominoes/", "/ludo/", "/hearts/", "/farkle/", "/lost-cities/", "/nine-mens-morris/", "/breakthrough/", "/connect6/", "/tablut/", "/fanorona/", "/cribbage/", "/skull/"].map((p) => ogForLive(p, "K7P2QX") !== null), [true, true, true, true, true, true, true, true, true, true, true, true, true, true]);
check("game without live mode is left alone", ogForLive("/chess/", "K7P2QX"), null);
check("bad code is left alone", ogForLive("/tic-tac-toe/", "k7p2qx"), null);
check("ambiguous characters are not valid", ogForLive("/tic-tac-toe/", "K7P2QO"), null);
check("missing code", ogForLive("/tic-tac-toe/", null), null);
check("the code is never echoed", JSON.stringify(ogForLive("/tic-tac-toe/", "K7P2QX")).includes("K7P2QX"), false);

console.log("\nanything suspect falls back to the page's static tags (null):");
check("no state param", ogFor("/tic-tac-toe/", null), null);
check("garbage state", ogFor("/tic-tac-toe/", "!!!not-lz-string!!!"), null);
check("empty string", ogFor("/tic-tac-toe/", ""), null);
check("state for a different game than the path",
  ogFor("/chess/", state({ g: "tic-tac-toe", v: 2, t: "X" })), null);
check("solo game with no WhatsApp mode",
  ogFor("/2048/", state({ g: "2048", t: 1 })), null);
check("unknown turn value",
  ogFor("/chess/", state({ g: "chess", t: "purple" })), null);
check("won but no winner recorded",
  ogFor("/chess/", state({ g: "chess", t: "w", s: "w", w: null })), null);
check("moveCount of 0 is not a real game",
  ogFor("/chess/", state({ g: "chess", t: "w", n: 0 })), null);
check("valid state on the site root", ogFor("/", state({ g: "chess", t: "w" })), null);

console.log("\nthe board and game id never reach the preview:");
const withBoard = ogFor("/tic-tac-toe/",
  state({ g: "tic-tac-toe", v: 2, t: "O", b: "XXOOXOXO<", n: 5 }));
checkThat("no board characters in output",
  withBoard && !JSON.stringify(withBoard).includes("<"),
  "board leaked into " + JSON.stringify(withBoard));
checkThat("no game id in output",
  withBoard && !JSON.stringify(withBoard).includes("a3f9k2"),
  "id leaked into " + JSON.stringify(withBoard));

console.log("\ndecode matches the async-share envelope:");
const d = decodeState(state({ g: "mancala", t: 2, n: 7 }));
checkThat("decodes turn + status + moveCount",
  d && d.game === "mancala" && d.turn === 2 && d.status === "in_progress" && d.moveCount === 7,
  JSON.stringify(d));

console.log("\nevery supported game resolves an in-progress preview:");
const missing = SUPPORTED_GAMES.filter((g) => {
  const turn = { "tic-tac-toe": "X", chess: "w" }[g] ?? 1;
  return ogFor("/" + g + "/", state({ g, v: g === "tic-tac-toe" || g === "connect-four" ? 2 : 1, t: turn })) === null;
});
checkThat(SUPPORTED_GAMES.length + " games covered", missing.length === 0,
  "no preview for: " + missing.join(", "));

console.log("\n" + (fail ? "RESULT: " + fail + " FAILED, " + pass + " passed"
                         : "RESULT: all " + pass + " checks passed"));
process.exit(fail ? 1 : 0);
