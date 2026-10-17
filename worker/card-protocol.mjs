/* ============================================================
   card-protocol.mjs — all the rules of a Crazy 8 room, as pure functions.

   The Durable Object (card-room.mjs) is a thin shell around this file, exactly
   as live-room.mjs is around live-protocol.mjs: it loads the room, calls one
   function here, saves the result and sends what comes back. Nothing here
   touches Cloudflare, so card-protocol.test.mjs runs it under plain node with
   a fake clock.

   A room holds 2 to 4 seats. People take seats in the order they join; the
   host can add computer players to fill seats. The game itself is the shared
   engine (crazy-8/engine.js). The server is the only place the deck and the
   hands live: a player is only ever sent their own cards.

   room = {
     code, game: "crazy-8" | "liars-dice" | "dominoes", createdAt, lastActive, finishedAt,
     phase: "lobby" | "playing" | "round_over" | "game_over",
     config: { mode: "normal"|"tournament", bots: 0-3, level: "easy"|"medium"|"hard" },
     players: [ { pid, token, name, online, offlineSince, autoBot, left } ],   people, in join order
     host: pid, nextPid,
     state: the engine's state | null,
     table: [ { kind: "human", pid } | { kind: "bot", level } ]    who sits where, same order as state.seats
     tally: { pid: wins }, votes: [pid], lastEvents, turnSince, nextAt
   }
   ============================================================ */

import "../crazy-8/engine.js";
import "../liars-dice/engine.js";
import "../dominoes/engine.js";

/* One engine per game, all with the same shape (see crazy-8/engine.js):
   create, act, botAct, view, nextRound, and optionally fallback(state, seat)
   (an action that is always legal) and PAUSE (ms between rounds). */
const ENGINES = { "crazy-8": globalThis.Crazy8, "liars-dice": globalThis.LiarsDice, "dominoes": globalThis.Dominoes };
const GAME_MODES = { "crazy-8": ["normal", "tournament"] };
export const CARD_GAMES = Object.keys(ENGINES);
const engineOf = (room) => ENGINES[room.game];
const modesOf = (room) => GAME_MODES[room.game] || ["normal"];

export const MAX_MESSAGE_CHARS = 2048;
export const OFFLINE_TAKEOVER_MS = 90 * 1000;       // offline this long: a computer plays for them
export const IDLE_TURN_MS = 90 * 1000;              // online but not moving: a computer plays that turn
export const BOT_DELAY_MS = [4200, 4800];            // a computer "thinks" for a moment so people can follow
export const ROUND_PAUSE_MS = 5000;                 // between tournament rounds
export const LOBBY_IDLE_MS = 2 * 60 * 60 * 1000;    // a room nobody has started
export const IDLE_MS = 24 * 60 * 60 * 1000;         // an unfinished game
export const FINISHED_MS = 60 * 60 * 1000;          // after the game is over
export const MAX_SEATS = 4;
const LEVELS = ["easy", "medium", "hard"];

export function cleanName(raw) {
  const s = typeof raw === "string" ? raw.trim() : "";
  return /^[A-Za-z0-9_]{3,16}$/.test(s) ? s : "";
}

export function newRoom(code, now, game = "crazy-8") {
  if (!ENGINES[game]) return null;
  return {
    code, game, createdAt: now, lastActive: now, finishedAt: null,
    phase: "lobby", config: { mode: "normal", bots: 0, level: "medium" },
    players: [], host: null, nextPid: 1, state: null, table: [], tally: {}, votes: [],
    lastEvents: [], turnSince: 0, nextAt: null,
  };
}

/* ---------- small helpers ---------- */
const player = (room, pid) => room.players.find((p) => p.pid === pid) || null;
const byToken = (room, token) => (typeof token === "string" && token ? room.players.find((p) => p.token === token) || null : null);
const humans = (room) => room.players.filter((p) => !p.left);
const seatOf = (room, pid) => room.table.findIndex((s) => s.kind === "human" && s.pid === pid);
export const seatsWanted = (room) => humans(room).length + room.config.bots;
const delay = (rng) => BOT_DELAY_MS[0] + Math.floor(rng() * (BOT_DELAY_MS[1] - BOT_DELAY_MS[0]));

// Is the seat to move played by a computer right now (a real computer, or one standing in for a person)?
function botControlled(room, seat) {
  const t = room.table[seat];
  if (!t) return false;
  if (t.kind === "bot") return true;
  const p = player(room, t.pid);
  return !!p && p.autoBot;
}
const botLevel = (room, seat) => (room.table[seat].kind === "bot" ? room.table[seat].level : "medium");

/* ---------- joining and leaving ---------- */

/* token: what the browser remembered (or null). Returns { ok, pid, token, fresh } or { ok:false, reason }.
   A returning token gets its own seat back in any phase; a new person can only join a room that has not started and has a free seat. */
export function join(room, token, name, mint, now, rng) {
  const back = byToken(room, token);
  if (back) {
    back.online = true; back.offlineSince = null; back.autoBot = false;
    if (back.left) {                                 // came back after leaving: a spectator unless the game hasn't started
      if (room.phase === "lobby" && seatsWanted(room) < MAX_SEATS) back.left = false;
    }
    if (cleanName(name)) back.name = cleanName(name);
    room.lastActive = now;
    return { ok: true, pid: back.pid, token: back.token, fresh: false };
  }
  if (room.phase !== "lobby") return { ok: false, reason: "started" };
  if (seatsWanted(room) >= MAX_SEATS) return { ok: false, reason: "full" };
  const p = { pid: room.nextPid++, token: mint(), name: cleanName(name), online: true, offlineSince: null, autoBot: false, left: false };
  room.players.push(p);
  if (room.host === null) room.host = p.pid;
  room.tally[p.pid] = 0;
  room.lastActive = now;
  // every seat taken: the game starts by itself
  if (seatsWanted(room) === MAX_SEATS) startGame(room, room.host, now, rng, true);
  return { ok: true, pid: p.pid, token: p.token, fresh: true };
}

export function setOnline(room, pid, online, now) {
  const p = player(room, pid);
  if (!p) return;
  p.online = online;
  p.offlineSince = online ? null : now;
  if (online) p.autoBot = false;
}

/* The person leaves for good. In the lobby their seat is freed (the next person becomes host if it was the host);
   in a game a computer takes their seat at once. Returns notices. */
export function leave(room, pid, now, rng) {
  const p = player(room, pid);
  if (!p || p.left) return [];
  const notices = [];
  if (room.phase === "lobby") {
    room.players = room.players.filter((x) => x.pid !== pid);
    delete room.tally[pid];
    if (room.host === pid) {
      const next = humans(room)[0];
      room.host = next ? next.pid : null;
      if (next) notices.push(displayName(room, next) + " is the host now.");
    }
    return notices;
  }
  p.left = true; p.online = false; p.autoBot = true;
  room.votes = room.votes.filter((v) => v !== pid);
  if (room.host === pid) {
    const next = humans(room).find((x) => x.online) || humans(room)[0];
    if (next) { room.host = next.pid; notices.push(displayName(room, next) + " is the host now."); }
  }
  if (room.phase === "playing") {
    notices.push(displayName(room, p) + " left; a computer is playing their seat.");
    scheduleBot(room, now, rng);
  }
  return notices;
}

function displayName(room, p) {
  if (p.name) return p.name;
  const i = humans(room).findIndex((x) => x.pid === p.pid);
  return "Player " + ((i < 0 ? room.players.indexOf(p) : i) + 1);
}

/* ---------- the host's controls ---------- */

/* cfg: { mode?, bots?, level? }. Host only, before the game or between games. */
export function setConfig(room, pid, cfg, now, rng) {
  if (pid !== room.host) return { ok: false, reason: "not-host" };
  if (room.phase !== "lobby" && room.phase !== "game_over") return { ok: false, reason: "in-game" };
  const next = { ...room.config };
  if (cfg.mode !== undefined) { if (!modesOf(room).includes(cfg.mode)) return { ok: false, reason: "bad-config" }; next.mode = cfg.mode; }
  if (cfg.level !== undefined) { if (!LEVELS.includes(cfg.level)) return { ok: false, reason: "bad-config" }; next.level = cfg.level; }
  if (cfg.bots !== undefined) {
    if (!Number.isInteger(cfg.bots) || cfg.bots < 0 || cfg.bots > MAX_SEATS - 1) return { ok: false, reason: "bad-config" };
    if (humans(room).length + cfg.bots > MAX_SEATS) return { ok: false, reason: "full" };
    next.bots = cfg.bots;
  }
  room.config = next;
  // choosing computers can fill every seat: then the game starts by itself
  if (room.phase === "lobby" && seatsWanted(room) === MAX_SEATS && now !== undefined) startGame(room, room.host, now, rng, true);
  return { ok: true };
}

/* Build the engine table from who is here and start. `auto` = it filled up by itself. */
function startGame(room, hostPid, now, rng, auto) {
  const people = humans(room).filter((p) => p.online || room.phase === "lobby");
  const seats = [];
  const names = [], bots = [];
  people.forEach((p, i) => { seats.push({ kind: "human", pid: p.pid }); names.push(displayName(room, p)); bots.push(null); });
  for (let b = 0; b < room.config.bots; b++) { seats.push({ kind: "bot", level: room.config.level }); names.push("Computer " + (b + 1)); bots.push(room.config.level); }
  // two players can never share a display name
  const seen = new Set();
  names.forEach((n, i) => { if (seen.has(n)) names[i] = n + " " + (i + 1); seen.add(names[i]); });
  const host = seats.findIndex((s) => s.kind === "human" && s.pid === hostPid);
  // a rematch is started by the last winner; the very first round by the host
  let starter = host < 0 ? 0 : host;
  if (room.state && room.state.winner !== null && room.table[room.state.winner]) {
    const w = room.table[room.state.winner];
    const idx = w.kind === "human" ? seats.findIndex((s) => s.kind === "human" && s.pid === w.pid) : -1;
    if (idx >= 0) starter = idx;
  }
  room.table = seats;
  room.state = engineOf(room).create({ names, bots, mode: room.config.mode, starter }, rng);
  room.phase = "playing";
  room.votes = []; room.finishedAt = null; room.lastEvents = [];
  room.players = room.players.filter((p) => !p.left);       // those who left do not come to the next game
  room.lastActive = now; room.turnSince = now;
  scheduleBot(room, now, rng);
  return true;
}

export function start(room, pid, now, rng) {
  if (pid !== room.host) return { ok: false, reason: "not-host" };
  if (room.phase !== "lobby") return { ok: false, reason: "in-game" };
  if (seatsWanted(room) < 2) return { ok: false, reason: "need-2" };
  startGame(room, pid, now, rng, false);
  return { ok: true };
}

/* After a game, everyone still here taps Rematch; when all the people who are online have, the next game starts
   (the host's settings: mode, and computers to fill seats or none). Returns { ok, started }. */
export function vote(room, pid, now, rng) {
  if (room.phase !== "game_over") return { ok: false, reason: "not-over" };
  const p = player(room, pid);
  if (!p || p.left) return { ok: false, reason: "not-here" };
  if (!room.votes.includes(pid)) room.votes.push(pid);
  room.lastActive = now;
  const online = humans(room).filter((x) => x.online);
  if (online.every((x) => room.votes.includes(x.pid))) {
    // the people who are offline are dropped; computers fill what the host chose
    room.players.forEach((x) => { if (!x.online) x.left = true; });
    room.players = room.players.filter((x) => !x.left);
    if (!room.players.find((x) => x.pid === room.host)) room.host = room.players[0] ? room.players[0].pid : null;
    if (room.players.length + room.config.bots < 2) { room.phase = "lobby"; room.state = null; room.table = []; room.votes = []; return { ok: true, started: false }; }
    startGame(room, room.host, now, rng, false);
    return { ok: true, started: true };
  }
  return { ok: true, started: false };
}

/* ---------- playing ---------- */

function afterEvents(room, events, now, rng) {
  room.lastEvents = events;
  room.lastActive = now;
  room.turnSince = now;
  const st = room.state;
  if (st.phase === "game_over") {
    room.phase = "game_over"; room.finishedAt = now; room.votes = []; room.nextAt = null;
    const t = room.table[st.winner];
    if (t && t.kind === "human") room.tally[t.pid] = (room.tally[t.pid] || 0) + 1;
  } else if (st.phase === "round_over") {
    room.phase = "round_over"; room.nextAt = now + (engineOf(room).PAUSE || ROUND_PAUSE_MS);
  } else {
    scheduleBot(room, now, rng);
  }
}
function scheduleBot(room, now, rng) {
  if (room.phase === "playing" && room.state && botControlled(room, room.state.turn)) room.nextAt = now + delay(rng);
  else if (room.phase === "playing") room.nextAt = null;
}

/* A person plays. action: { t: "play", card, suit?, last? } | { t: "draw" } | { t: "pass" } */
export function act(room, pid, action, now, rng) {
  if (room.phase !== "playing") return { ok: false, reason: "not-playing" };
  const seat = seatOf(room, pid);
  if (seat < 0) return { ok: false, reason: "not-seated" };
  const res = engineOf(room).act(room.state, seat, action, rng);
  if (!res.ok) return { ok: false, reason: res.error };
  afterEvents(room, res.events, now, rng);
  return { ok: true };
}

/* Things that happen by themselves as time passes. Returns { notices } (messages for everyone). Safe to call any time. */
export function tick(room, now, rng) {
  const notices = [];
  // a person offline long enough is replaced by a computer
  if (room.phase === "playing" || room.phase === "round_over") {
    for (const p of humans(room)) {
      if (!p.online && p.offlineSince !== null && !p.autoBot && now - p.offlineSince >= OFFLINE_TAKEOVER_MS) {
        p.autoBot = true;
        notices.push(displayName(room, p) + " has been offline for " + Math.round(OFFLINE_TAKEOVER_MS / 1000) + " seconds. A computer is playing for them; they can take their seat back when they return.");
      }
    }
  }
  for (let guard = 0; guard < 12; guard++) {
    if (room.phase === "round_over" && room.nextAt !== null && now >= room.nextAt) {
      engineOf(room).nextRound(room.state, rng);
      room.phase = "playing"; room.turnSince = now; room.lastEvents = [{ e: "new-round", round: room.state.round }];
      scheduleBot(room, now, rng);
      continue;
    }
    if (room.phase !== "playing") break;
    const seat = room.state.turn;
    if (botControlled(room, seat)) {
      if (room.nextAt === null) room.nextAt = now + delay(rng);
      if (now < room.nextAt) break;
      const p = room.table[seat].kind === "human" ? player(room, room.table[seat].pid) : null;
      const E = engineOf(room);
      const a = E.botAct(room.state, seat, botLevel(room, seat), rng);
      const res = E.act(room.state, seat, a, rng);
      if (!res.ok) { const d = E.act(room.state, seat, E.fallback ? E.fallback(room.state, seat) : { t: "draw" }, rng); if (!d.ok) break; afterEvents(room, d.events, now, rng); continue; }
      afterEvents(room, res.events, now, rng);
      continue;
    }
    // a person's turn: if they sit on it too long, a computer plays this one turn
    if (now - room.turnSince >= IDLE_TURN_MS) {
      const p = player(room, room.table[seat].pid);
      const a = engineOf(room).botAct(room.state, seat, "medium", rng);
      const res = engineOf(room).act(room.state, seat, a, rng);
      if (!res.ok) break;
      notices.push(displayName(room, p) + " took too long, so a computer played their turn.");
      afterEvents(room, res.events, now, rng);
      continue;
    }
    break;
  }
  return { notices };
}

/* When should tick() next run? (the Durable Object sets its alarm to this) */
export function nextWake(room, now) {
  let t = expiresAt(room);
  if ((room.phase === "round_over" || room.phase === "playing") && room.nextAt !== null) t = Math.min(t, room.nextAt);
  if (room.phase === "playing" && room.state && !botControlled(room, room.state.turn)) t = Math.min(t, room.turnSince + IDLE_TURN_MS);
  if (room.phase === "playing" || room.phase === "round_over") {
    for (const p of humans(room)) if (!p.online && p.offlineSince !== null && !p.autoBot) t = Math.min(t, p.offlineSince + OFFLINE_TAKEOVER_MS);
  }
  return Math.max(t, now);
}

export function expiresAt(room) {
  if (room.finishedAt !== null) return room.finishedAt + FINISHED_MS;
  return room.lastActive + (room.phase === "lobby" ? LOBBY_IDLE_MS : IDLE_MS);
}

/* ---------- what each person is sent ---------- */

/* The room as person `pid` sees it. Hands: only their own. */
export function viewFor(room, pid, now) {
  const me = player(room, pid);
  const seat = me ? seatOf(room, pid) : -1;
  let tableView = null;
  if (room.state) {
    const out = seat >= 0 && room.state.seats[seat].status === "out";
    tableView = engineOf(room).view(room.state, seat >= 0 && !out ? seat : null);
    tableView.you = seat >= 0 ? seat : null;
  }
  return {
    code: room.code, game: room.game, phase: room.phase, config: room.config, host: room.host, now: now,
    you: { pid, seat: seat >= 0 ? seat : null, host: pid === room.host, name: me ? displayName(room, me) : "" },
    players: humans(room).map((p) => ({
      pid: p.pid, name: displayName(room, p), host: p.pid === room.host, online: p.online, offlineSince: p.offlineSince,
      autoBot: p.autoBot, wins: room.tally[p.pid] || 0, seat: seatOf(room, p.pid), voted: room.votes.includes(p.pid),
    })),
    seatsWanted: seatsWanted(room), maxSeats: MAX_SEATS,
    table: tableView, lastEvents: room.lastEvents,
    turnSince: room.turnSince, idleMs: IDLE_TURN_MS, takeoverMs: OFFLINE_TAKEOVER_MS,
    votes: room.votes.slice(),
  };
}
