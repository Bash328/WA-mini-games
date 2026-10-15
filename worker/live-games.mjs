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

export const LIVE_GAMES = {
  "tic-tac-toe": {
    version: 2,
    players: ["X", "O"],
    first: "X",                   // the player who opens
    initialBoard: ticTacToe.EMPTY,
    rules: ticTacToe,
  },
};

export function liveGame(slug) {
  return Object.prototype.hasOwnProperty.call(LIVE_GAMES, slug) ? LIVE_GAMES[slug] : null;
}

export const LIVE_SLUGS = Object.keys(LIVE_GAMES);
