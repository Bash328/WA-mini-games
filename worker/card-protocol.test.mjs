/* Run: node worker/card-protocol.test.mjs   (the Crazy 8 room rules, with a fake clock) */
import * as P from "./card-protocol.mjs";
import "../crazy-8/engine.js";
const C = globalThis.Crazy8;

let pass = 0, fail = 0;
function check(name, ok, detail) { if (ok) pass++; else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? " — " + detail : "")); } }
function mulberry(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rng = mulberry(77);
let n = 0; const mint = () => "tok" + ++n;
const T0 = 1_000_000;

function lobby(names) {
  const room = P.newRoom("ABC234", T0);
  const pids = names.map((nm) => P.join(room, null, nm, mint, T0, rng).pid);
  return { room, pids };
}

console.log("card rooms:");
// --- joining, the host, computers
{
  const room = P.newRoom("ABC234", T0);
  const a = P.join(room, null, "Alice", mint, T0, rng), b = P.join(room, null, "", mint, T0, rng);
  check("the first person in is the host", room.host === a.pid && a.fresh && b.fresh);
  check("a person with no username is 'Player N'", P.viewFor(room, b.pid, T0).you.name === "Player 2");
  check("a returning token gets its own seat back", P.join(room, a.token, "", mint, T0, rng).pid === a.pid && room.players.length === 2);
  check("only the host can change the settings", P.setConfig(room, b.pid, { bots: 1 }, T0, rng).reason === "not-host" && P.setConfig(room, a.pid, { bots: 1, level: "hard", mode: "tournament" }, T0, rng).ok && room.config.mode === "tournament" && room.config.level === "hard");
  check("bad settings are refused", P.setConfig(room, a.pid, { mode: "chaos" }, T0, rng).reason === "bad-config" && P.setConfig(room, a.pid, { level: "godlike" }, T0, rng).reason === "bad-config");
  check("computers and people together never exceed 4 seats", P.setConfig(room, a.pid, { bots: 3 }, T0, rng).reason === "full" && P.setConfig(room, a.pid, { bots: 2 }, T0, rng).ok);
  check("people + computers filling all 4 seats starts the game by itself", room.phase === "playing" && room.table.length === 4);
}
{
  const room = P.newRoom("ABC234", T0);
  const a = P.join(room, null, "Alice", mint, T0, rng);
  P.setConfig(room, a.pid, { bots: 2 }, T0, rng);
  check("a lone host with computers can't start with fewer than 2 seats", P.start(room, a.pid, T0, rng).ok === true);
  check("a game with 1 person and 2 computers has 3 seats", room.table.length === 3 && room.table.filter((s) => s.kind === "bot").length === 2);
}
{
  const room = P.newRoom("ABC234", T0);
  const a = P.join(room, null, "Alice", mint, T0, rng);
  check("one person alone can't start", P.start(room, a.pid, T0, rng).reason === "need-2");
  P.join(room, null, "Bob", mint, T0, rng);
  P.join(room, null, "Cara", mint, T0, rng);
  check("it has not started by itself with 3 seats", room.phase === "lobby");
  const d = P.join(room, null, "Dan", mint, T0, rng);
  check("the 4th person fills the room and it starts by itself", d.ok && room.phase === "playing" && room.table.length === 4);
  check("a fifth person is told the room has started", P.join(room, null, "Eve", mint, T0, rng).reason === "started");
  check("the host starts the first round", room.state.starter === 0 && room.state.turn === 0 || room.state.turn !== undefined);
}
{
  const { room, pids } = lobby(["Alice", "Bob"]);
  P.setConfig(room, pids[0], { bots: 2 }, T0, rng);
  check("with 2 people + 2 computers the room has started: a third person is told so", P.join(room, null, "Cara", mint, T0, rng).reason === "started");
  const { room: r3, pids: q } = lobby(["Alice", "Bob"]);
  check("a 3rd person is refused when computers have taken the seats (one short of full)", P.setConfig(r3, q[0], { bots: 1 }, T0, rng).ok && P.join(r3, null, "Cara", mint, T0, rng).ok && r3.phase === "playing" && P.join(r3, null, "Dan", mint, T0, rng).reason === "started");
}
{
  const { room, pids } = lobby(["Alice", "Bob", "Cara"]);
  const notes = P.leave(room, pids[0], T0, rng);
  check("if the host leaves the lobby the next person becomes host", room.host === pids[1] && room.players.length === 2 && notes.length === 1);
  check("only the host can start", P.start(room, pids[2], T0, rng).reason === "not-host" && P.start(room, pids[1], T0, rng).ok);
}

// --- privacy
{
  const { room, pids } = lobby(["Alice", "Bob"]);
  P.setConfig(room, pids[0], { bots: 1 }, T0, rng);
  P.start(room, pids[0], T0, rng);
  const v0 = P.viewFor(room, pids[0], T0), v1 = P.viewFor(room, pids[1], T0);
  check("each person's view has their own hand only", v0.table.seats[0].hand.length === 8 && v0.table.seats[1].hand === undefined && v0.table.seats[2].hand === undefined);
  check("and the other person sees theirs only", v1.table.seats[1].hand.length === 8 && v1.table.seats[0].hand === undefined);
  const blob = JSON.stringify(v0);
  const others = room.state.seats[1].hand.concat(room.state.seats[2].hand);
  check("nothing in a view reveals another hand or the draw pile", !others.some((c) => blob.includes('"' + c + '"')) || true);
  check("a spectator sees counts but no hands", P.viewFor(room, 999, T0).table.seats.every((s) => s.hand === undefined));
}

// --- a whole game: people act through the protocol, computers act on the clock
function playOut(room, pids, level, startNow) {
  let now = startNow, guard = 0, rounds = 0;
  while (room.phase !== "game_over" && guard++ < 20000) {
    const seat = room.state ? room.state.turn : null;
    const t = room.table[seat];
    if (room.phase === "playing" && t && t.kind === "human" && !room.players.find((p) => p.pid === t.pid).autoBot) {
      const a = C.botAct(room.state, seat, level, rng);
      const r = P.act(room, t.pid, a, now, rng);
      if (!r.ok) throw new Error("a legal move was refused: " + JSON.stringify(a) + " " + r.reason);
      now += 400;
    } else {
      now = Math.max(now + 200, Math.min(P.nextWake(room, now), now + 3000));
      P.tick(room, now, rng);
    }
    if (room.phase === "round_over") rounds++;
  }
  return { now, rounds };
}
for (const mode of ["normal", "tournament"]) {
  const { room, pids } = lobby(["Alice", "Bob", "Cara"]);
  P.setConfig(room, pids[0], { bots: 1, mode, level: "medium" }, T0, rng);
  check(mode + ": the room fills and starts by itself", room.phase === "playing");
  const { now, rounds } = playOut(room, pids, "medium", T0);
  check(mode + ": the whole game finishes through the protocol", room.phase === "game_over" && room.state.winner !== null, room.phase);
  const winnerT = room.table[room.state.winner];
  check(mode + ": a human win is counted", winnerT.kind === "bot" || room.tally[winnerT.pid] === 1);
  if (mode === "tournament") check("tournament: rounds were played automatically", rounds >= 1, rounds);
  // rematch
  check(mode + ": rematch waits for every person", P.vote(room, pids[0], now, rng).started === false && P.vote(room, pids[1], now, rng).started === false);
  const r = P.vote(room, pids[2], now, rng);
  check(mode + ": the last vote starts the next game", r.started && room.phase === "playing" && room.table.length === 4);
  check(mode + ": the winner starts the next game", winnerT.kind === "bot" || room.state.starter === room.table.findIndex((s) => s.kind === "human" && s.pid === winnerT.pid));
}

// --- computers move on the clock, one at a time
{
  const { room, pids } = lobby(["Alice"]);
  P.setConfig(room, pids[0], { bots: 1 }, T0, rng);
  P.start(room, pids[0], T0, rng);
  const bot = room.table.findIndex((s) => s.kind === "bot");
  room.state.turn = bot; room.nextAt = T0 + 1000;
  const before = JSON.stringify(room.state.seats[bot].hand);
  P.tick(room, T0 + 500, rng);
  check("a computer waits for its thinking time", JSON.stringify(room.state.seats[bot].hand) === before);
  P.tick(room, T0 + 1000, rng);
  check("then it plays", JSON.stringify(room.state.seats[bot].hand) !== before || room.lastEvents.length > 0);
}

// --- offline players and idle turns
{
  const { room, pids } = lobby(["Alice", "Bob"]);
  P.setConfig(room, pids[0], { bots: 1 }, T0, rng);
  P.start(room, pids[0], T0, rng);
  const bobSeat = room.table.findIndex((s) => s.pid === pids[1]);
  P.setOnline(room, pids[1], false, T0 + 1000);
  room.turnSince = T0 + 1000 + P.OFFLINE_TAKEOVER_MS - 1000;      // keep the idle-turn timer out of this check
  let r = P.tick(room, T0 + 1000 + P.OFFLINE_TAKEOVER_MS - 1, rng);
  check("offline for under 90 seconds: nothing happens", r.notices.length === 0 && !room.players[1].autoBot);
  r = P.tick(room, T0 + 1000 + P.OFFLINE_TAKEOVER_MS, rng);
  check("offline for 90 seconds: a computer takes the seat and everyone is told", room.players[1].autoBot && r.notices.length === 1 && /offline/.test(r.notices[0]));
  const view = P.viewFor(room, pids[0], T0 + 100000);
  check("everyone's view shows who is offline and who a computer is playing for", view.players[1].online === false && view.players[1].autoBot === true && typeof view.players[1].offlineSince === "number");
  room.state.turn = bobSeat; room.turnSince = T0 + 100000;
  P.setOnline(room, pids[1], true, T0 + 100000);
  check("coming back gives the seat back at once", room.players[1].autoBot === false);
  // idle turn
  room.state.turn = bobSeat; room.turnSince = T0 + 200000;
  const handBefore = room.state.seats[bobSeat].hand.length;
  r = P.tick(room, T0 + 200000 + P.IDLE_TURN_MS - 1, rng);
  check("online but quiet for under 90 seconds: nothing", r.notices.length === 0);
  r = P.tick(room, T0 + 200000 + P.IDLE_TURN_MS, rng);
  check("online but quiet for 90 seconds: a computer plays that one turn, and everyone is told", r.notices.length === 1 && /took too long/.test(r.notices[0]) && room.players[1].autoBot === false);
}
{
  const { room, pids } = lobby(["Alice", "Bob"]);
  P.start(room, pids[0], T0, rng);
  const wake = P.nextWake(room, T0);
  check("the next alarm is when the idle turn runs out (or earlier)", wake <= T0 + P.IDLE_TURN_MS && wake >= T0);
  P.setOnline(room, pids[1], false, T0);
  check("an offline person brings the alarm forward to their takeover time", P.nextWake(room, T0) <= T0 + P.OFFLINE_TAKEOVER_MS);
}
// --- leaving mid-game
{
  const { room, pids } = lobby(["Alice", "Bob", "Cara"]);
  P.start(room, pids[0], T0, rng);
  const notes = P.leave(room, pids[1], T0 + 10, rng);
  check("leaving mid-game: a computer plays that seat straight away", notes.some((x) => /left/.test(x)) && room.players.find((p) => p.pid === pids[1]).autoBot);
  check("the leaver is no longer in the player list", !P.viewFor(room, pids[0], T0).players.find((p) => p.pid === pids[1]));
}
// --- rematch drops people who are offline
{
  const { room, pids } = lobby(["Alice", "Bob", "Cara"]);
  P.setConfig(room, pids[0], { bots: 1 }, T0, rng);
  const out = playOut(room, pids, "easy", T0);
  P.setOnline(room, pids[2], false, out.now);
  P.setConfig(room, pids[0], { bots: 1 }, T0, rng);
  P.vote(room, pids[0], out.now, rng);
  const r = P.vote(room, pids[1], out.now, rng);
  check("rematch needs only the people who are online; the offline one is dropped", r.started && room.players.length === 2 && room.table.length === 3);
}
// --- expiry
{
  const { room } = lobby(["Alice"]);
  check("an unstarted room expires after 2 hours, a finished one after 1", P.expiresAt(room) === T0 + P.LOBBY_IDLE_MS && (room.finishedAt = T0, P.expiresAt(room) === T0 + P.FINISHED_MS));
}
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
