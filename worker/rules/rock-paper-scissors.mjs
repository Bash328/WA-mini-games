/* ============================================================
   rules/rock-paper-scissors.mjs — server-side rules for live Rock Paper
   Scissors.

   Unlike the other live games, picks are SECRET until both players have
   made one, so a move is not a board the client proposes: the client sends
   only its pick, the room keeps it private, and when both are in the
   server resolves the round and publishes the result. Nothing about the
   opponent's pick reaches a client before then.

   Wire board (same as rock-paper-scissors/game.js): 6 digits
   "n p1Wins p2Wins pending lastP1 lastP2". In live play `pending` is always
   0 (picks never ride in the state), n is the best-of (3, 5 or 7), and
   lastP1 / lastP2 are the picks from the last resolved round (0 = none yet).
   Players are the numbers 1 and 2.
   ============================================================ */

export const HIDDEN = true;                 // picks are private: see live-protocol.mjs
export const BEST_OF = [3, 5, 7];

const roundsToWin = (n) => Math.ceil(n / 2);
const beats = (a, b) => (a === 1 && b === 3) || (a === 2 && b === 1) || (a === 3 && b === 2);

/* Room options a client may set at creation: { bestOf }. Returns the clean
   config, or null if it is not acceptable. */
export function normalizeConfig(raw) {
  const n = raw && raw.bestOf !== undefined ? Number(raw.bestOf) : 3;
  return BEST_OF.includes(n) ? { bestOf: n } : null;
}

export const isPick = (v) => v === 1 || v === 2 || v === 3;

export function boardToStr(o) { return "" + o.n + o.p1Wins + o.p2Wins + o.pending + o.lastP1 + o.lastP2; }
export function strToBoard(s) { return { n: +s[0], p1Wins: +s[1], p2Wins: +s[2], pending: +s[3], lastP1: +s[4], lastP2: +s[5] }; }

export function initialBoard(config) {
  return boardToStr({ n: config.bestOf, p1Wins: 0, p2Wins: 0, pending: 0, lastP1: 0, lastP2: 0 });
}

/* Resolve one round. prevBoard: the current board string or null (first round).
   Returns the wire result: { board, status, winner, last }. A tie replays the
   round (scores unchanged, lastP1/lastP2 show what was thrown). */
export function resolveRound(prevBoard, config, p1, p2) {
  const cur = strToBoard(prevBoard || initialBoard(config));
  let { p1Wins, p2Wins } = cur;
  let status = "in_progress", winner = null;
  if (p1 !== p2) {
    if (beats(p1, p2)) p1Wins++; else p2Wins++;
    const rtw = roundsToWin(cur.n);
    if (p1Wins >= rtw) { status = "won"; winner = 1; }
    else if (p2Wins >= rtw) { status = "won"; winner = 2; }
  }
  return {
    board: boardToStr({ n: cur.n, p1Wins, p2Wins, pending: 0, lastP1: p1, lastP2: p2 }),
    status, winner, last: p2,
  };
}
