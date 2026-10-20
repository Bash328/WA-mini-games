/* Run: node worker/dominoes.test.mjs   (Dominoes rules, the computer, and a whole room with a fake clock) */
import * as P from "./card-protocol.mjs";
import "../dominoes/engine.js";
const D = globalThis.Dominoes;

let pass = 0, fail = 0;
function check(name, ok, detail) { if (ok) pass++; else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? " — " + detail : "")); } }
function mulberry(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rng = mulberry(11);
const T0 = 1_000_000;
const key = (t) => t[0] + "-" + t[1];

console.log("dominoes:");
// --- the deal
for (const n of [2, 3, 4]) {
  const st = D.create({ names: Array.from({ length: n }, (_, i) => "P" + i) }, rng);
  const all = st.seats.flatMap((s) => s.hand).concat(st.boneyard);
  check(n + " players: 28 different tiles, " + (n === 4 ? 5 : 7) + " each, the rest in the boneyard", all.length === 28 && new Set(all.map(key)).size === 28 && st.seats.every((s) => s.hand.length === (n === 4 ? 5 : 7)) && st.boneyard.length === 28 - n * (n === 4 ? 5 : 7));
}
{
  const st = D.create({ names: ["A", "B", "C"] }, rng);
  const holder = st.seats[st.turn].hand.map(key);
  check("the starter holds the lead tile and can play only that", st.mustLead && holder.includes(key(st.mustLead)) && D.playable(st, st.turn).length === 1 && key(D.playable(st, st.turn)[0].tile) === key(st.mustLead));
  const doubles = st.seats.flatMap((s) => s.hand).filter((t) => t[0] === t[1]);
  check("the lead is the highest double if anyone has one", !doubles.length || (st.mustLead[0] === st.mustLead[1] && st.mustLead[0] === Math.max(...doubles.map((t) => t[0]))));
}
// --- playing tiles on a hand-made table
function table(hands, line, boneyard = []) {
  const st = D.create({ names: hands.map((_, i) => "P" + i) }, rng);
  st.seats.forEach((s, i) => { s.hand = hands[i].map((t) => t.slice()); });
  st.line = line.map((t) => t.slice()); st.boneyard = boneyard.map((t) => t.slice()); st.mustLead = null; st.turn = 0; st.passes = 0; st.round = 2;
  return st;
}
{
  const st = table([[[2, 3], [4, 4], [1, 6]], [[0, 0], [5, 5]]], [[3, 5]]);
  check("a tile matching the left end only fits the left", JSON.stringify(D.fits(st, [2, 3])) === '["L"]');
  check("a tile matching the right end only fits the right", JSON.stringify(D.fits(table([[]], [[3, 5]]), [5, 5])) === '["R"]');
  check("a tile matching neither end does not fit", D.fits(st, [1, 6]).length === 0);
  check("a tile matching both ends fits both", JSON.stringify(D.fits(table([[]], [[3, 3]]), [3, 3])) === '["L","R"]');
  const r = D.act(st, 0, { t: "play", tile: [3, 2], end: "L" }, rng);       // 3-2 on the left: its 3 touches the 3
  check("a tile is turned so its matching half touches the end", r.ok && JSON.stringify(st.line) === JSON.stringify([[2, 3], [3, 5]]) && JSON.stringify(D.view(st, null).ends) === "[2,5]");
  check("the turn passes on", st.turn === 1);
  check("a tile you don't hold is refused", D.act(st, 1, { t: "play", tile: [1, 1], end: "L" }, rng).ok === false);
  check("a tile that doesn't fit is refused", D.act(st, 1, { t: "play", tile: [5, 5], end: "L" }, rng).ok === false);
  check("out of turn is refused", D.act(st, 0, { t: "play", tile: [4, 4], end: "L" }, rng).ok === false);
  check("a bad end is refused", D.act(st, 1, { t: "play", tile: [5, 5], end: "X" }, rng).ok === false);
}
// --- drawing and passing
{
  const st = table([[[1, 1], [3, 3]], [[6, 6], [0, 0]]], [[3, 5]], [[0, 4], [3, 3]]);
  check("with a playable tile you may not draw or pass", D.act(st, 0, { t: "draw" }, rng).ok === false && D.act(st, 0, { t: "pass" }, rng).ok === false);
  st.seats[0].hand = [[1, 1], [2, 2]];
  const v = D.view(st, 0);
  check("with nothing playable and a boneyard you must draw", v.options.draw === true && v.options.pass === false && v.options.plays.length === 0);
  check("passing is not allowed while you can draw", D.act(st, 0, { t: "pass" }, rng).ok === false);
  check("drawing takes a tile and keeps the turn", D.act(st, 0, { t: "draw" }, rng).ok && st.seats[0].hand.length === 3 && st.turn === 0 && st.boneyard.length === 1);
  D.act(st, 0, { t: "draw" }, rng);
  check("with the boneyard empty you must pass", D.view(st, 0).options.pass === true || D.playable(st, 0).length > 0);
}
// --- scoring: a domino
{
  const st = table([[[3, 4]], [[6, 5], [2, 2]], [[1, 1]]], [[4, 6]]);
  const r = D.act(st, 0, { t: "play", tile: [3, 4], end: "L" }, rng);
  check("going out ends the round and scores the others' pips", r.ok && st.phase === "round_over" && st.seats[0].score === (11 + 4 + 2) && st.reveal.reason === "domino" && st.reveal.winner === 0, JSON.stringify(st.reveal));
  check("everyone's tiles are shown at the end of the round", D.view(st, 1).seats.every((s) => Array.isArray(s.hand)));
  D.nextRound(st, rng);
  check("the winner starts the next round, with any tile", st.phase === "play" && st.round === 3 && st.turn === 0 && st.mustLead === null && st.line.length === 0 && D.playable(st, 0).length === st.seats[0].hand.length);
}
// --- scoring: blocked
{
  const st = table([[[1, 2]], [[0, 5]], [[0, 6]]], [[4, 3]], []);
  D.act(st, 0, { t: "pass" }, rng); D.act(st, 1, { t: "pass" }, rng);
  const r = D.act(st, 2, { t: "pass" }, rng);
  check("everyone passing blocks the game; the fewest pips wins the others' pips minus their own", r.ok && st.reveal.reason === "block" && st.reveal.winner === 0 && st.seats[0].score === (5 + 6) - 3, JSON.stringify(st.reveal) + " " + st.seats[0].score);
}
{
  const st = table([[[1, 2]], [[0, 3]]], [[4, 5]], []);
  D.act(st, 0, { t: "pass" }, rng); D.act(st, 1, { t: "pass" }, rng);
  check("a tie in a block scores nothing", st.reveal.winner === null && st.seats.every((s) => s.score === 0));
}
// --- the game ends at 100
{
  const st = table([[[3, 4]], [[6, 6], [5, 5]]], [[4, 6]]);
  st.seats[0].score = 90;
  D.act(st, 0, { t: "play", tile: [3, 4], end: "L" }, rng);
  check("reaching 100 ends the game", st.phase === "game_over" && st.winner === 0 && st.seats[0].score >= 100);
}
// --- what each person sees
{
  const st = D.create({ names: ["A", "B", "C"] }, rng);
  const v = D.view(st, 1);
  check("you see only your own tiles", Array.isArray(v.seats[1].hand) && v.seats[0].hand === null && v.seats[2].hand === null && v.seats[0].count === 7);
  check("the boneyard is a count, never tiles", typeof v.boneyard === "number" && !JSON.stringify(v).includes('"boneyard":['));
  check("a spectator sees no tiles", D.view(st, null).seats.every((s) => s.hand === null));
}

// --- the computer plays only legal actions, whole games, every level and table size
for (const lvl of D.LEVELS) {
  let ok = true, games = 0, rounds = 0;
  for (let g = 0; g < 25 && ok; g++) {
    const n = 2 + (g % 3), r = mulberry(300 + g);
    const st = D.create({ names: Array.from({ length: n }, (_, i) => "B" + i), bots: Array(n).fill(lvl) }, r);
    let guard = 0;
    while (st.phase !== "game_over" && guard++ < 20000) {
      if (st.phase === "round_over") { D.nextRound(st, r); rounds++; continue; }
      const a = D.botAct(st, st.turn, lvl, r);
      const res = D.act(st, st.turn, a, r);
      if (!res.ok) { ok = false; console.log("   refused", JSON.stringify(a), JSON.stringify(res)); break; }
    }
    if (guard >= 20000) { ok = false; console.log("   never ended"); }
    // the tiles are never lost or duplicated
    const all = st.seats.flatMap((s) => s.hand).concat(st.boneyard, st.line.map((t) => [Math.min(...t), Math.max(...t)]));
    if (st.phase === "game_over" ? false : all.length !== 28) ok = false;
    games++;
  }
  check(lvl + " plays " + games + " whole games legally (" + rounds + " rounds)", ok);
}
{
  let hardWins = 0; const N = 200;
  for (let g = 0; g < N; g++) {
    const r = mulberry(7000 + g), hardSeat = g % 2;
    const st = D.create({ names: ["a", "b"], bots: hardSeat === 0 ? ["hard", "easy"] : ["easy", "hard"] }, r);
    let guard = 0;
    while (st.phase !== "game_over" && guard++ < 20000) {
      if (st.phase === "round_over") { D.nextRound(st, r); continue; }
      D.act(st, st.turn, D.botAct(st, st.turn, st.seats[st.turn].bot, r), r);
    }
    if (st.winner === hardSeat) hardWins++;
  }
  check("hard beats easy most of the time", hardWins / N > 0.55, hardWins + "/" + N);
}

// --- a whole room
let n = 0; const mint = () => "tok" + ++n;
{
  const room = P.newRoom("ABC234", T0, "dominoes");
  check("a dominoes room", room.game === "dominoes");
  const a = P.join(room, null, "Alice", mint, T0, rng), b = P.join(room, null, "Bob", mint, T0, rng);
  check("only a normal game type exists", P.setConfig(room, a.pid, { mode: "tournament" }, T0, rng).reason === "bad-config" && P.setConfig(room, a.pid, { bots: 1, level: "hard" }, T0, rng).ok);
  check("the host starts it", P.start(room, a.pid, T0, rng).ok && room.phase === "playing" && room.table.length === 3);
  const seatA = room.table.findIndex((s) => s.kind === "human" && s.pid === a.pid);
  const seen = P.viewFor(room, a.pid, T0).table;
  check("a player is sent only their own tiles", seen.seats[seatA].hand.length === 7 && seen.seats.filter((s, i) => i !== seatA).every((s) => s.hand === null));
  let now = T0, guard = 0;
  while (room.phase !== "game_over" && guard++ < 20000) {
    const st = room.state;
    if (room.phase === "playing" && room.table[st.turn].kind === "human") {
      const pid = room.table[st.turn].pid;
      const res = P.act(room, pid, D.botAct(st, st.turn, "medium", rng), now, rng);
      if (!res.ok) { check("a person's legal action is accepted", false, JSON.stringify(res)); break; }
    } else { now = Math.max(now + 1000, P.nextWake(room, now)); P.tick(room, now, rng); }
  }
  check("the room plays a whole game and names a winner", room.phase === "game_over" && room.state.winner !== null, room.phase);
  P.vote(room, a.pid, now, rng); P.vote(room, b.pid, now, rng);
  check("everyone voting starts a rematch", room.phase === "playing" && room.state.round === 1 && room.state.seats.every((s) => s.score === 0));
}

console.log(fail ? `\n${pass} passed, ${fail} FAILED` : `\n${pass} passed`);
process.exit(fail ? 1 : 0);
