/* ============================================================
   live-protocol.mjs — all the rules of a live room, as pure functions.

   The Durable Object (live-room.mjs) is a thin shell around this: it
   loads the room from storage, calls one function here, persists the
   result and sends whatever comes back. Keeping the logic free of
   Cloudflare APIs is what lets live-protocol.test.mjs run it under
   plain node.

   A room:
     { code, game, id, createdAt, lastActive, finishedAt,
       order:  { 1: player, 2: player },   seat -> game player (X / O ...)
       seats:  { 1: token|null, 2: token|null },
       state:  envelope | null,            the AsyncShare envelope, full keys
       rematch:{ 1: bool, 2: bool } }
   ============================================================ */

import { liveGame } from "./live-games.mjs";

export const MAX_MESSAGE_CHARS = 2048;
export const IDLE_MS = 24 * 60 * 60 * 1000;       // an unfinished room
export const FINISHED_MS = 60 * 60 * 1000;        // after the game is over
export const WAITING_MS = 2 * 60 * 60 * 1000;     // a room still waiting for its second player
const STATUSES = ["in_progress", "won", "draw"];

const ALNUM = "abcdefghijklmnopqrstuvwxyz0123456789";

function randomString(chars, n, rand) {
  let s = "";
  for (let i = 0; i < n; i++) s += chars[Math.floor(rand() * chars.length)];
  return s;
}

export function newGameId(rand = Math.random) { return randomString(ALNUM, 8, rand); }

export function newRoom(game, code, now, rand = Math.random, config = null) {
  const G = liveGame(game);
  if (!G) return null;
  return {
    config: config,                       // per-game options (RPS: { bestOf })
    secret: { 1: 0, 2: 0 },               // hidden picks, never sent to a client
    code: code,
    game: game,
    id: newGameId(rand),
    createdAt: now,
    lastActive: now,
    finishedAt: null,
    order: { 1: G.players[0], 2: G.players[1] },
    seats: { 1: null, 2: null },
    state: null,
    rematch: { 1: false, 2: false },
  };
}

const other = (seat) => (seat === 1 ? 2 : 1);
const otherPlayer = (room, player) => (room.order[1] === player ? room.order[2] : room.order[1]);

/* ---------- joining ---------- */

/* token: what the client remembered (or undefined/null for a first join).
   mint(): makes a fresh seat token. Returns { ok, seat, token, fresh } or
   { ok: false, reason: "full" }. A returning token always gets its own
   seat back; otherwise the lowest free seat is taken. */
export function join(room, token, mint, now) {
  if (typeof token === "string" && token) {
    for (const seat of [1, 2]) {
      if (room.seats[seat] === token) {
        room.lastActive = now;
        return { ok: true, seat: seat, token: token, fresh: false };
      }
    }
  }
  for (const seat of [1, 2]) {
    if (!room.seats[seat]) {
      const t = mint();
      room.seats[seat] = t;
      room.lastActive = now;
      return { ok: true, seat: seat, token: t, fresh: true };
    }
  }
  return { ok: false, reason: "full" };
}

export const bothSeated = (room) => !!(room.seats[1] && room.seats[2]);

/* ---------- moves ---------- */

function shapeOk(e) {
  if (!e || typeof e !== "object" || Array.isArray(e)) return false;
  if (typeof e.game !== "string" || typeof e.id !== "string") return false;
  if (!STATUSES.includes(e.status)) return false;
  if (!Number.isInteger(e.moveCount) || e.moveCount < 1) return false;
  if (e.last !== null && !Number.isInteger(e.last)) return false;
  return true;
}

/* msg: { t:"move", n, s }. Returns { ok: true, state } (room mutated) or
   { ok: false, reason }. Reasons: waiting, over, stale, not-your-turn,
   illegal. The server, not the client, decides turn / moveCount / id. */
export function applyMove(room, seat, msg, now) {
  const G = liveGame(room.game);
  if (!G) return { ok: false, reason: "illegal" };
  if (!bothSeated(room)) return { ok: false, reason: "waiting" };

  const prev = room.state;
  if (prev && prev.status !== "in_progress") return { ok: false, reason: "over" };

  const prevCount = prev ? prev.moveCount : 0;
  if (msg.n !== prevCount) return { ok: false, reason: "stale" };

  const mover = room.order[seat];
  // Simultaneous-pick games have no turns; everything else does.
  if (!G.hidden && mover !== (prev ? prev.turn : G.first)) return { ok: false, reason: "not-your-turn" };

  const s = msg.s;
  if (!shapeOk(s)) return { ok: false, reason: "illegal" };
  if (s.game !== room.game || s.version !== G.version || s.id !== room.id) return { ok: false, reason: "illegal" };
  if (s.moveCount !== prevCount + 1) return { ok: false, reason: "illegal" };

  // A hidden-pick game's state is only ever produced by the server resolving
  // a round; the one move a client may propose itself is resigning.
  if (G.hidden && s.resigned !== true) return { ok: false, reason: "illegal" };

  let next;
  if (s.resigned === true) {
    // Resigning changes nothing on the board: it hands the win to the other
    // side. Only meaningful once a game has started.
    if (!prev) return { ok: false, reason: "illegal" };
    if (s.status !== "won" || s.winner !== otherPlayer(room, mover)) return { ok: false, reason: "illegal" };
    if (s.board !== prev.board) return { ok: false, reason: "illegal" };
    next = { ...s, turn: otherPlayer(room, mover), last: prev.last, resigned: true };
  } else {
    const r = G.rules.validateTransition(prev, s, mover);
    if (!r.ok) return { ok: false, reason: r.reason || "illegal" };
    next = {
      game: room.game, version: G.version, id: room.id,
      turn: r.nextTurn !== undefined ? r.nextTurn : otherPlayer(room, mover),
      board: s.board, status: s.status, winner: s.status === "won" ? s.winner : null,
      moveCount: prevCount + 1, last: s.last,
    };
  }

  room.state = next;
  room.lastActive = now;
  room.rematch = { 1: false, 2: false };
  room.secret = { 1: 0, 2: 0 };
  if (next.status !== "in_progress") room.finishedAt = now;
  return { ok: true, state: next };
}

/* ---------- hidden picks (Rock Paper Scissors) ---------- */

/* msg: { t:"pick", n, v }. n is the number of rounds already resolved, so a
   pick for a round that has moved on is "stale". Returns:
     { ok: true, state }     both are in: the round resolved, state published
     { ok: true, state: null } this pick is locked, waiting for the other
     { ok: false, reason }                                                  */
export function applyPick(room, seat, msg, now) {
  const G = liveGame(room.game);
  if (!G || !G.hidden) return { ok: false, reason: "illegal" };
  if (!bothSeated(room)) return { ok: false, reason: "waiting" };
  const prev = room.state;
  if (prev && prev.status !== "in_progress") return { ok: false, reason: "over" };
  const round = prev ? prev.moveCount : 0;
  if (msg.n !== round) return { ok: false, reason: "stale" };
  if (!G.rules.isPick(msg.v)) return { ok: false, reason: "illegal" };
  if (room.secret[seat]) return { ok: false, reason: "already-picked" };

  room.secret[seat] = msg.v;
  room.lastActive = now;
  if (!room.secret[1] || !room.secret[2]) return { ok: true, state: null };

  // Both picks are in: resolve. Player numbers (1 / 2) are the seats' roles.
  const p1 = room.secret[room.order[1] === 1 ? 1 : 2];
  const p2 = room.secret[room.order[1] === 1 ? 2 : 1];
  const r = G.rules.resolveRound(prev ? prev.board : null, room.config, p1, p2);
  room.state = {
    game: room.game, version: G.version, id: room.id,
    turn: 1,                                   // unused in a simultaneous game; any valid player
    board: r.board, status: r.status, winner: r.winner,
    moveCount: round + 1, last: r.last,
  };
  room.secret = { 1: 0, 2: 0 };
  room.rematch = { 1: false, 2: false };
  if (r.status !== "in_progress") room.finishedAt = now;
  return { ok: true, state: room.state };
}

/* Who has locked a pick this round — flags only, never the values. */
export const pickedFlags = (room) => ({ 1: !!room.secret[1], 2: !!room.secret[2] });

/* ---------- rematch ---------- */

/* One seat asks for a rematch. Only valid once the game is over. When both
   have asked the room resets: a new game id, a new empty state, and the
   seats swap players so each side takes turns opening. */
export function requestRematch(room, seat, now, rand = Math.random) {
  if (!room.state || room.state.status === "in_progress") return { ok: false, reason: "not-over" };
  room.rematch[seat] = true;
  room.lastActive = now;
  if (room.rematch[1] && room.rematch[2]) {
    room.order = { 1: room.order[2], 2: room.order[1] };
    room.state = null;
    room.secret = { 1: 0, 2: 0 };
    room.id = newGameId(rand);
    room.finishedAt = null;
    room.rematch = { 1: false, 2: false };
    return { ok: true, started: true };
  }
  return { ok: true, started: false };
}

/* ---------- expiry ---------- */

export function expiresAt(room) {
  if (room.finishedAt !== null) return room.finishedAt + FINISHED_MS;
  // A room made in advance (the lobby pre-warms one) that nobody joined
  // is tidied away sooner than a game in progress.
  const waiting = !room.state && !(room.seats[1] && room.seats[2]);
  return room.lastActive + (waiting ? WAITING_MS : IDLE_MS);
}

/* ---------- abuse limits ---------- */

/* Token bucket, kept on the socket's attachment. Returns the new bucket and
   whether this message is allowed. 20 burst, refilling 4 per second. */
export function takeToken(bucket, now) {
  const CAP = 20, PER_SEC = 4;
  const b = bucket || { tokens: CAP, ts: now };
  const refilled = Math.min(CAP, b.tokens + ((now - b.ts) / 1000) * PER_SEC);
  if (refilled < 1) return { bucket: { tokens: refilled, ts: now }, allowed: false };
  return { bucket: { tokens: refilled - 1, ts: now }, allowed: true };
}

/* What a client is told about a seat's view of the room. */
export function welcomePayload(room, seat, token) {
  return {
    t: "welcome",
    code: room.code, game: room.game, id: room.id,
    seat: seat, token: token,
    order: room.order, state: room.state,
    seated: { 1: !!room.seats[1], 2: !!room.seats[2] },
    rematch: room.rematch,
    config: room.config || null,
    // hidden-pick games: who has locked in, and (only) THIS seat's own pick
    picked: pickedFlags(room),
    yourPick: room.secret[seat] || 0,
  };
}
