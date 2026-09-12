/* ============================================================
   og-text.mjs — turn a ?s= link into WhatsApp preview text.

   A static site serves the same HTML whatever the query string, so the
   link preview can't say whose turn it is — you have to open the tab to
   find out. This module decodes the same ?s= envelope the games use and
   produces the title/description a Worker injects into the OG tags, so
   the preview itself answers "is it my turn?".

   Deliberately free of Cloudflare APIs: worker/index.mjs does the glue,
   this part is plain JS so it can be tested in node.
   ============================================================ */

import LZString from "../vendor/lz-string.min.js";

/* Mirrors each game's AsyncShare.start({ title, players, label }). Kept
   here rather than imported because game.js files are browser scripts,
   not modules — so this table has to stay in step with them by hand.
   Only games with a WhatsApp mode appear; anything else is left alone. */
const GAMES = {
  "tic-tac-toe":        { title: "tic-tac-toe",        labels: { X: "X", O: "O" } },
  "connect-four":       { title: "connect-four",       labels: { 1: "Red", 2: "Yellow" } },
  "chess":              { title: "chess",              labels: { w: "White", b: "Black" } },
  "reversi":            { title: "reversi",            labels: { 1: "Black", 2: "White" } },
  "checkers":           { title: "checkers",           labels: { 1: "Player 1", 2: "Player 2" } },
  "dots-and-boxes":     { title: "dots and boxes",     labels: { 1: "Player 1", 2: "Player 2" } },
  "mancala":            { title: "mancala",            labels: { 1: "Player 1", 2: "Player 2" } },
  "pentago":            { title: "pentago",            labels: { 1: "Player 1", 2: "Player 2" } },
  "rock-paper-scissors":{ title: "rock paper scissors",labels: { 1: "Player 1", 2: "Player 2" } },
  "hangman":            { title: "hangman",            labels: { 1: "Player 1", 2: "Player 2" } },
  "memory":             { title: "memory",             labels: { 1: "Player 1", 2: "Player 2" } },
  "minesweeper":        { title: "minesweeper",        labels: { 1: "Player 1", 2: "Player 2" } },
  "lights-out":         { title: "lights-out",         labels: { 1: "Player 1", 2: "Player 2" } },
};

const STATUS = { p: "in_progress", w: "won", d: "draw" };

/** "/tic-tac-toe/" | "/tic-tac-toe/index.html" -> "tic-tac-toe" */
export function slugFor(pathname) {
  const parts = String(pathname || "").split("/").filter(Boolean);
  if (parts.length && /\.html?$/i.test(parts[parts.length - 1])) parts.pop();
  return parts.length ? parts[parts.length - 1] : "";
}

/* Same "+" -> "_" swap async-share.js does on the way out. */
export function decodeState(raw) {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const json = LZString.decompressFromEncodedURIComponent(raw.replace(/[_ ]/g, "+"));
    if (!json) return null;
    const w = JSON.parse(json);
    if (!w || typeof w !== "object" || Array.isArray(w)) return null;
    return { game: w.g, turn: w.t, status: STATUS[w.s], winner: w.w, moveCount: w.n };
  } catch (e) {
    return null;
  }
}

/* Returns { title, description } or null when the link isn't a valid
   game state — in which case the page's own static OG tags stand.

   Note what is NOT interpolated: the board and the game id never reach
   the output. Everything below is either an integer or a string looked
   up in GAMES, so nothing attacker-controlled lands in an attribute. */
export function ogFor(pathname, stateParam) {
  const slug = slugFor(pathname);
  const meta = Object.prototype.hasOwnProperty.call(GAMES, slug) ? GAMES[slug] : null;
  if (!meta) return null;

  const s = decodeState(stateParam);
  if (!s) return null;
  // A state for one game must not be rendered on another game's page.
  if (s.game !== slug) return null;
  if (!Number.isInteger(s.moveCount) || s.moveCount < 1) return null;

  const label = (p) => {
    const k = String(p);
    return Object.prototype.hasOwnProperty.call(meta.labels, k) ? meta.labels[k] : null;
  };
  const moves = s.moveCount === 1 ? "1 move in" : s.moveCount + " moves in";

  if (s.status === "in_progress") {
    const you = label(s.turn);
    if (!you) return null;
    return {
      title: "Your move · " + meta.title,
      description: "You're " + you + ", " + moves + ". Open the board to play your turn.",
    };
  }

  if (s.status === "draw") {
    return {
      title: "Draw · " + meta.title,
      description: "Game over after " + s.moveCount + " moves. Open to see the final board.",
    };
  }

  if (s.status === "won") {
    const won = label(s.winner);
    if (!won) return null;
    return {
      title: won + " won · " + meta.title,
      description: "Game over after " + s.moveCount + " moves. Open to see the final board.",
    };
  }

  return null;
}

export const SUPPORTED_GAMES = Object.keys(GAMES);
