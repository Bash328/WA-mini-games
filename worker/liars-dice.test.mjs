/* Run: node worker/liars-dice.test.mjs   (Liar's Dice rules, the computer, and a whole room with a fake clock) */
import * as P from "./card-protocol.mjs";
import "../liars-dice/engine.js";
const L = globalThis.LiarsDice;

let pass = 0, fail = 0;
function check(name, ok, detail) { if (ok) pass++; else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? " — " + detail : "")); } }
function mulberry(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rng = mulberry(5);
const T0 = 1_000_000;

console.log("liar's dice:");
// --- the bidding table
const bid = (q, f) => ({ q, f });
check("the opening bid can be anything but 1s", L.legal(null, 1, 2, 10) && L.legal(null, 3, 6, 10) && !L.legal(null, 2, 1, 10));
check("more dice on the same face is a raise", L.legal(bid(3, 4), 4, 4, 10));
check("the same number of a higher face is a raise", L.legal(bid(3, 4), 3, 5, 10) && !L.legal(bid(3, 4), 3, 3, 10) && !L.legal(bid(3, 4), 3, 4, 10));
check("fewer dice is never a raise on another non-1 face", !L.legal(bid(3, 4), 2, 6, 10));
check("to 1s you may halve (rounded up)", L.legal(bid(5, 4), 3, 1, 10) && !L.legal(bid(5, 4), 2, 1, 10) && L.legal(bid(4, 4), 2, 1, 10));
check("from 1s you must double and add one", L.legal(bid(3, 1), 7, 2, 10) && !L.legal(bid(3, 1), 6, 2, 10));
check("1s to 1s must go up", L.legal(bid(3, 1), 4, 1, 10) && !L.legal(bid(3, 1), 3, 1, 10));
check("a bid above the number of dice is refused", !L.legal(null, 11, 2, 10));
// --- counting: ones are wild
const mk = (hands, bidSeat = 0) => {
  const st = L.create({ names: hands.map((_, i) => "P" + i), starter: 0 }, rng);
  hands.forEach((h, i) => { st.seats[i].hand = h; st.seats[i].dice = h.length; });
  return st;
};
{
  const st = mk([[1, 3, 3, 5, 6], [2, 3, 1, 4, 4]]);
  check("ones count for any other face", L.countFace(st, 3) === 5);          // 3,3 + 3 + three ones? (1,1 are the two ones) = 3,3,3 plus two ones
  check("a bid on 1s counts only 1s", L.countFace(st, 1) === 2);
}
{
  // Alice bids four 3s; Bob doubts. there are exactly five 3s-or-ones: the bid is good, Bob loses a die
  const st = mk([[1, 3, 3, 5, 6], [2, 3, 1, 4, 4]]);
  check("a bid is made", L.act(st, 0, { t: "bid", q: 4, f: 3 }, rng).ok && st.bid.q === 4 && st.turn === 1);
  const r = L.act(st, 1, { t: "dudo" }, rng);
  check("dudo on a true bid costs the challenger a die", r.ok && st.seats[1].dice === 4 && st.seats[0].dice === 5 && st.reveal.good === true && st.reveal.count === 5);
  check("the loser opens the next round and everyone's dice are revealed", st.phase === "round_over" && st.turn === 1 && st.reveal.hands.length === 2);
  L.nextRound(st, rng);
  check("the next round re-rolls with the loser one die short", st.phase === "play" && st.bid === null && st.seats[1].hand.length === 4 && st.seats[0].hand.length === 5 && st.round === 2);
}
{
  const st = mk([[2, 2, 5, 5, 6], [4, 4, 4, 3, 6]]);
  L.act(st, 0, { t: "bid", q: 4, f: 6 }, rng);
  L.act(st, 1, { t: "dudo" }, rng);
  check("dudo on a lie costs the bidder a die", st.seats[0].dice === 4 && st.seats[1].dice === 5 && st.reveal.good === false && st.turn === 0);
}
// --- the rules are enforced
{
  const st = mk([[2, 2, 5, 5, 6], [4, 4, 4, 3, 6]]);
  check("out of turn is refused", L.act(st, 1, { t: "bid", q: 1, f: 2 }, rng).ok === false);
  check("dudo with no bid is refused", L.act(st, 0, { t: "dudo" }, rng).ok === false);
  check("an illegal bid is refused", L.act(st, 0, { t: "bid", q: 1, f: 1 }, rng).ok === false);
  check("unknown actions are refused", L.act(st, 0, { t: "pass" }, rng).ok === false && L.act(st, 0, null, rng).ok === false);
}
// --- elimination and the end
{
  const st = mk([[3], [2, 5], [4, 4, 4]]);
  L.act(st, 0, { t: "bid", q: 3, f: 6 }, rng);                // a lie
  const r = L.act(st, 1, { t: "dudo" }, rng);
  check("a player with one die who loses it is out", st.seats[0].status === "out" && st.seats[0].dice === 0 && r.events.some((e) => e.e === "out"));
  check("after an elimination the next player in line opens", st.phase === "round_over" && st.turn === 1);
  L.nextRound(st, rng);
  check("the out player has no dice and is skipped", st.seats[0].hand.length === 0 && L.view(st, 0).seats[0].hand === null);
  check("turns skip the out player", (() => { st.turn = 2; L.act(st, 2, { t: "bid", q: 1, f: 2 }, rng); return st.turn === 1; })());
}
{
  const st = mk([[3], [2]]);
  L.act(st, 0, { t: "bid", q: 2, f: 6 }, rng);
  L.act(st, 1, { t: "dudo" }, rng);
  check("the last player standing wins", st.phase === "game_over" && st.winner === 1);
}
// --- what each person is shown
{
  const st = mk([[1, 3, 3, 5, 6], [2, 3, 1, 4, 4], [6, 6, 6, 6, 6]]);
  const v = L.view(st, 1);
  check("you see your own dice and not anyone else's", v.seats[1].hand.length === 5 && v.seats[0].hand === null && v.seats[2].hand === null);
  check("a spectator sees no dice", L.view(st, null).seats.every((s) => s.hand === null));
  check("the view never carries the secret hands", !JSON.stringify(L.view(st, 1)).includes('"hands"'));
  L.act(st, 0, { t: "bid", q: 20, f: 6 }, rng);
  check("an impossible quantity is refused", st.bid === null);
  L.act(st, 0, { t: "bid", q: 4, f: 6 }, rng); L.act(st, 1, { t: "dudo" }, rng);
  const v2 = L.view(st, 1);
  check("after dudo everyone's dice are shown", v2.seats.every((s) => Array.isArray(s.hand)) && v2.reveal.hands.length === 3);
  const mq = L.minQuantities(mk([[1, 3, 3, 5, 6], [2, 3, 1, 4, 4]]));
  check("minimum quantities on a fresh table", mq[1] === null && mq[2] === 1 && mq[6] === 1);
}

// --- the computer plays only legal actions, whole games, every level
for (const lvl of L.LEVELS) {
  let ok = true, games = 0, rounds = 0;
  for (let g = 0; g < 30 && ok; g++) {
    const n = 2 + (g % 3), r = mulberry(100 + g);
    const st = L.create({ names: Array.from({ length: n }, (_, i) => "B" + i), bots: Array(n).fill(lvl), starter: g % n }, r);
    let guard = 0;
    while (st.phase !== "game_over" && guard++ < 3000) {
      if (st.phase === "round_over") { L.nextRound(st, r); rounds++; continue; }
      const a = L.botAct(st, st.turn, lvl, r);
      const res = L.act(st, st.turn, a, r);
      if (!res.ok) { ok = false; console.log("   bot action refused", JSON.stringify(a), JSON.stringify(res), JSON.stringify(st.bid)); break; }
    }
    if (guard >= 3000) { ok = false; console.log("   game never ended"); }
    games++;
  }
  check(lvl + " plays " + games + " whole games legally (" + rounds + " rounds)", ok);
}
// hard beats easy over many 2-player games
{
  let hardWins = 0;
  const N = 200;
  for (let g = 0; g < N; g++) {
    const r = mulberry(900 + g), hardSeat = g % 2;
    const st = L.create({ names: ["a", "b"], bots: hardSeat === 0 ? ["hard", "easy"] : ["easy", "hard"], starter: 0 }, r);
    let guard = 0;
    while (st.phase !== "game_over" && guard++ < 3000) {
      if (st.phase === "round_over") { L.nextRound(st, r); continue; }
      L.act(st, st.turn, L.botAct(st, st.turn, st.seats[st.turn].bot, r), r);
    }
    if (st.winner === hardSeat) hardWins++;
  }
  check("hard beats easy most of the time", hardWins / N > 0.55, hardWins + "/" + N);
}

// --- a whole room: people and computers, through the room protocol
let n = 0; const mint = () => "tok" + ++n;
{
  const room = P.newRoom("ABC234", T0, "liars-dice");
  check("a liar's dice room", room.game === "liars-dice" && P.newRoom("X", T0, "chess") === null);
  const a = P.join(room, null, "Alice", mint, T0, rng), b = P.join(room, null, "Bob", mint, T0, rng);
  check("only a normal game type exists for dice", P.setConfig(room, a.pid, { mode: "tournament" }, T0, rng).reason === "bad-config" && P.setConfig(room, a.pid, { bots: 1, level: "hard" }, T0, rng).ok);
  check("the host starts it", P.start(room, a.pid, T0, rng).ok && room.phase === "playing" && room.table.length === 3);
  const seatA = room.table.findIndex((s) => s.kind === "human" && s.pid === a.pid);
  // nobody is ever sent anyone else's dice
  const seen = P.viewFor(room, a.pid, T0).table;
  check("a player is sent only their own dice", seen.seats[seatA].hand.length === 5 && seen.seats.filter((s, i) => i !== seatA).every((s) => s.hand === null));
  check("the room view names the game", P.viewFor(room, a.pid, T0).game === "liars-dice");
  // play it out: Alice and Bob act through the room when it is their turn, computers by the clock
  let now = T0, guard = 0;
  while (room.phase !== "game_over" && guard++ < 6000) {
    const st = room.state;
    if (room.phase === "playing" && room.table[st.turn].kind === "human") {
      const pid = room.table[st.turn].pid;
      const a2 = L.botAct(st, st.turn, "medium", rng);
      const res = P.act(room, pid, a2, now, rng);
      if (!res.ok) { check("a person's legal action is accepted", false, JSON.stringify(res)); break; }
    } else { now = Math.max(now + 1000, P.nextWake(room, now)); P.tick(room, now, rng); }
  }
  check("the room plays a whole game and names a winner", room.phase === "game_over" && room.state.winner !== null, room.phase);
  const tw = Object.values(room.tally).reduce((x, y) => x + y, 0);
  check("a person's win is tallied", tw <= 1);
  P.vote(room, a.pid, now, rng); P.vote(room, b.pid, now, rng);
  check("everyone voting starts a rematch", room.phase === "playing" && room.state.round === 1);
}
{
  // someone who sits on their turn is played for after the idle limit
  const room = P.newRoom("ABC234", T0, "liars-dice");
  const a = P.join(room, null, "Alice", mint, T0, rng);
  P.setConfig(room, a.pid, { bots: 1 }, T0, rng);
  P.start(room, a.pid, T0, rng);
  const seatA = room.table.findIndex((s) => s.kind === "human");
  let now = T0;
  if (room.state.turn !== seatA) { now = P.nextWake(room, now); P.tick(room, now, rng); }
  const moves0 = room.state.moves;
  now += P.IDLE_TURN_MS + 1;
  const t = P.tick(room, now, rng);
  check("an idle person's turn is played for them", room.state.moves > moves0 && t.notices.some((x) => /took too long/.test(x)));
}

console.log(fail ? `\n${pass} passed, ${fail} FAILED` : `\n${pass} passed`);
process.exit(fail ? 1 : 0);
