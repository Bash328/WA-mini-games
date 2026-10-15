/* ============================================================
   live-games.mjs — which games can be played live, and their rules.

   A game appears here only once it has a rules module: the server
   validates every move, so a game without one cannot have a live room.
   Hidden-information games (Hangman, Battleship, Mastermind, Rock Paper
   Scissors) are deliberately absent — their secrets would be visible in
   the socket traffic.

   version / players mirror each game's AsyncShare.start() options, the
   same way og-text.mjs mirrors them for link previews.
   ============================================================ */

import * as ticTacToe from "./rules/tic-tac-toe.mjs";
import * as connectFour from "./rules/connect-four.mjs";
import * as reversi from "./rules/reversi.mjs";
import * as dotsAndBoxes from "./rules/dots-and-boxes.mjs";
import * as lightsOut from "./rules/lights-out.mjs";

export const LIVE_GAMES = {
  "tic-tac-toe": {
    version: 2,
    players: ["X", "O"],
    first: "X",                   // the player who opens
    rules: ticTacToe,
  },
  "connect-four":   { version: 2, players: [1, 2], first: 1, rules: connectFour },
  "reversi":        { version: 1, players: [1, 2], first: 1, rules: reversi },
  "dots-and-boxes": { version: 1, players: [1, 2], first: 1, rules: dotsAndBoxes },
  "lights-out":     { version: 1, players: [1, 2], first: 1, rules: lightsOut },
};

export function liveGame(slug) {
  return Object.prototype.hasOwnProperty.call(LIVE_GAMES, slug) ? LIVE_GAMES[slug] : null;
}

export const LIVE_SLUGS = Object.keys(LIVE_GAMES);
