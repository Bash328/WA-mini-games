/* Run: node worker/farkle.test.mjs
   Farkle (10,000): the scoring table, farkles and hot dice, keeping and banking,
   the computers, a whole bot game, and a whole room through worker/card-protocol.mjs
   with a fake clock. */
import * as P from "./card-protocol.mjs";
import "../farkle/engine.js";
const F = globalThis.Farkle;

let pass = 0, fail = 0;
function check(name, ok, detail) { if (ok) pass++; else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? " — " + detail : "")); } }
function mulberry(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
// a die roll of f is rng() in [(f-1)/6, f/6): hand the engine exactly the faces we want
function seq(...faces) {
  let i = 0;
  return () => { if (i >= faces.length) throw new Error("the rng sequence ran out"); return (faces[i++] - 0.5) / 6; };
}
const room_rng = mulberry(11);
const T0 = 1_000_000;
const mk = (n = 2) => F.create({ names: Array.from({ length: n }, (_, i) => "P" + i), starter: 0 }, mulberry(3));
const vals = (arr) => arr.map((d) => d.v);

console.log("farkle:");
/* ---------- the house scoring table ---------- */
check("a single 1 is 100", F.scoreSelection([1]) === 100);
check("a single 5 is 50", F.scoreSelection([5]) === 50);
check("1 and 5 add up", F.scoreSelection([1, 5]) === 150);
check("three 1s are 1000", F.scoreSelection([1, 1, 1]) === 1000);
check("three 2s are 200", F.scoreSelection([2, 2, 2]) === 200);
check("three 3s to 6s are face x 100",
  F.scoreSelection([3, 3, 3]) === 300 && F.scoreSelection([4, 4, 4]) === 400 && F.scoreSelection([5, 5, 5]) === 500 && F.scoreSelection([6, 6, 6]) === 600);
check("four of a kind is 1000", F.scoreSelection([2, 2, 2, 2]) === 1000 && F.scoreSelection([1, 1, 1, 1]) === 1000);
check("five of a kind is 2000", F.scoreSelection([3, 3, 3, 3, 3]) === 2000);
check("six of a kind is 3000", F.scoreSelection([4, 4, 4, 4, 4, 4]) === 3000);
check("a straight 1-6 is 1500", F.scoreSelection([1, 2, 3, 4, 5, 6]) === 1500);
check("three pairs are 1500", F.scoreSelection([2, 2, 3, 3, 4, 4]) === 1500 && F.scoreSelection([1, 1, 5, 5, 6, 6]) === 1500);
check("two triples add up", F.scoreSelection([1, 1, 1, 2, 2, 2]) === 1200);
check("triples plus loose 1s and 5s add up", F.scoreSelection([1, 1, 1, 5]) === 1050 && F.scoreSelection([2, 2, 2, 5, 5]) === 300);
check("a 5 in a triple is not also a single", F.scoreSelection([5, 5, 5]) === 500);
check("a selection must score all through", F.scoreSelection([1, 2]) === 0 && F.scoreSelection([5, 3]) === 0);
check("a whole set with a loose die is not a legal keep", F.scoreSelection([2, 2, 2, 3]) === 0 && F.scoreSelection([2, 2, 2, 2, 3, 3]) === 0);
check("the raw score still knows what the triple was worth", F.scoreSet([2, 2, 2, 3]).score === 200 && F.scoreSet([2, 2, 2, 3]).used === 3);

/* ---------- farkle detection ---------- */
check("four dice with no 1 or 5 and no triple is a farkle", !F.anyScoring([2, 3, 4, 6]));
check("two pairs and two singles is still a farkle", !F.anyScoring([2, 2, 3, 3, 4, 6]));
check("three pairs score", F.anyScoring([2, 2, 3, 3, 4, 4]));
check("a triple scores without a 1 or 5", F.anyScoring([6, 6, 6, 2, 3, 4]));
check("a lone 1 scores", F.anyScoring([1, 2, 3, 4, 6, 6]));
check("an empty roll scores nothing", !F.anyScoring([]));

/* ---------- rolling, keeping, banking ---------- */
{
  const st = mk();
  check("a new game is 2 to 4 seats, first to 10000, and the starter rolls first",
    st.seats.length === 2 && st.target === 10000 && st.turn === 0 && st.phase === "play" && st.awaiting === "roll" && st.turnScore === 0);
  const r = F.act(st, 0, { t: "roll" }, seq(1, 2, 3, 4, 6, 6));
  check("a roll with a 1 puts six dice on the table", r.ok && st.awaiting === "choose" && st.dice.length === 6 && vals(st.dice).join("") === "123466");
  const v = F.view(st, 0);
  check("the player to move may keep, and nobody else may", v.options.keep && !v.options.roll && !v.options.bank && !F.view(st, 1).options.keep && !F.view(st, null).options.keep);
  check("the view shows the dice, the target and who you are", v.dice.length === 6 && v.target === 10000 && v.you === 0 && F.view(st, null).you === null);
  check("rolling again before keeping is refused", !F.act(st, 0, { t: "roll" }, seq(1)).ok);
  check("banking before keeping is refused", !F.act(st, 0, { t: "bank" }, seq(1)).ok);
  check("keeping a die that does not score is refused", !F.act(st, 0, { t: "keep", dice: [1] }, seq(1)).ok);
  check("keeping a scorer with a stray die is refused", !F.act(st, 0, { t: "keep", dice: [0, 1] }, seq(1)).ok);
  check("keeping the same die twice is refused", !F.act(st, 0, { t: "keep", dice: [0, 0] }, seq(1)).ok);
  check("keeping a die that is not there is refused", !F.act(st, 0, { t: "keep", dice: [9] }, seq(1)).ok);
  check("an unknown action is refused", !F.act(st, 0, { t: "pass" }, seq(1)).ok && !F.act(st, 0, null, seq(1)).ok);
  check("out of turn is refused", !F.act(st, 1, { t: "roll" }, seq(1)).ok);
  const k = F.act(st, 0, { t: "keep", dice: [0] }, seq(1));
  check("keeping a 1 adds 100 and leaves roll-or-bank", k.ok && st.turnScore === 100 && st.awaiting === "roll_or_bank" && st.dice[0].kept);
  check("after a keep you may roll or bank", F.view(st, 0).options.roll && F.view(st, 0).options.bank);
  const b = F.act(st, 0, { t: "bank" }, seq(1));
  check("banking adds the turn to the score and passes the dice", b.ok && st.seats[0].score === 100 && st.turn === 1 && st.awaiting === "roll" && st.turnScore === 0 && st.dice.length === 0 && st.last.t === "bank");
}
{
  const st = mk();
  const r = F.act(st, 0, { t: "roll" }, seq(2, 3, 4, 6, 6, 3));
  check("a roll with nothing scoring is a farkle and loses the turn", r.ok && st.turn === 1 && st.awaiting === "roll" && st.turnScore === 0 && st.seats[0].score === 0 && st.last.t === "farkle");
  check("the farkle is reported with what was rolled", r.events.some((e) => e.e === "farkle") && st.last.dice.length === 6);
}
{
  const st = mk();
  F.act(st, 0, { t: "roll" }, seq(1, 5, 2, 2, 3, 3));
  F.act(st, 0, { t: "keep", dice: [0, 1] }, seq(1));
  check("two scoring dice can be kept together", st.turnScore === 150 && st.setAside.length === 0 && st.dice.filter((d) => d.kept).length === 2);
  F.act(st, 0, { t: "roll" }, seq(5, 5, 5, 4));
  check("rolling again puts the kept dice aside and rolls only the rest", st.setAside.join("") === "15" && st.dice.length === 4 && st.awaiting === "choose");
  F.act(st, 0, { t: "keep", dice: [0, 1, 2] }, seq(1));
  check("a triple kept later in the turn adds its points", st.turnScore === 650 && st.awaiting === "roll_or_bank");
  F.act(st, 0, { t: "bank" }, seq(1));
  check("the whole turn banks at once", st.seats[0].score === 650 && st.turn === 1);
}
{
  const st = mk();
  F.act(st, 0, { t: "roll" }, seq(1, 5, 2, 2, 3, 3));
  F.act(st, 0, { t: "keep", dice: [0, 1] }, seq(1));
  F.act(st, 0, { t: "roll" }, seq(2, 3, 4, 6));
  check("a later farkle loses the points already kept", st.turn === 1 && st.seats[0].score === 0 && st.turnScore === 0 && st.last.t === "farkle" && st.last.lost === 150);
}
/* ---------- hot dice ---------- */
{
  const st = mk();
  F.act(st, 0, { t: "roll" }, seq(2, 2, 2, 3, 3, 3));
  const r = F.act(st, 0, { t: "keep", dice: [0, 1, 2, 3, 4, 5] }, seq(1, 2, 3, 4, 6, 6));
  check("keeping all six is hot dice: six new dice, same turn, points kept",
    r.ok && r.events.some((e) => e.e === "hot") && st.turn === 0 && st.awaiting === "choose" && st.turnScore === 500 && st.setAside.length === 0 && st.dice.length === 6 && st.last.t === "hot");
  check("the fresh hot-dice roll is the engine's, not the caller's", vals(st.dice).join("") === "123466");
  F.act(st, 0, { t: "keep", dice: [0] }, seq(1));
  F.act(st, 0, { t: "bank" }, seq(1));
  check("hot dice points can still be banked", st.seats[0].score === 600);
}
{
  const st = mk();
  F.act(st, 0, { t: "roll" }, seq(2, 2, 2, 3, 3, 3));
  F.act(st, 0, { t: "keep", dice: [0, 1, 2, 3, 4, 5] }, seq(2, 3, 4, 6, 6, 3));
  check("a hot-dice roll with nothing scoring loses the lot", st.turn === 1 && st.seats[0].score === 0 && st.last.t === "farkle" && st.last.lost === 500);
}
/* ---------- the target ---------- */
{
  const st = mk();
  st.seats[0].score = 9950;
  F.act(st, 0, { t: "roll" }, seq(1, 2, 3, 4, 6, 6));
  F.act(st, 0, { t: "keep", dice: [0] }, seq(1));
  const b = F.act(st, 0, { t: "bank" }, seq(1));
  check("banking past 10000 wins the game", b.ok && st.phase === "game_over" && st.winner === 0 && st.seats[0].score === 10050 && st.last.t === "win");
  check("a finished game takes no more actions", !F.act(st, 0, { t: "roll" }, seq(1)).ok && !F.act(st, 1, { t: "roll" }, seq(1)).ok);
  check("there are no rounds to start in a one-game match", F.nextRound(st, seq(1)) === false);
  check("a spectator sees the finished table", F.view(st, null).phase === "game_over" && F.view(st, null).winner === 0);
}
{
  // a 3-seat table passes in order
  const st = mk(3);
  F.act(st, 0, { t: "roll" }, seq(1, 2, 3, 4, 6, 6));
  F.act(st, 0, { t: "keep", dice: [0] }, seq(1));
  F.act(st, 0, { t: "bank" }, seq(1));
  check("3 seats pass the dice in order", st.turn === 1);
  F.act(st, 1, { t: "roll" }, seq(2, 3, 4, 6, 6, 3));
  check("the turn wraps around", st.turn === 2);
}

/* ---------- the computers play whole, legal games ---------- */
function botGame(level, n, seed) {
  const rng = mulberry(seed), st = F.create({ names: Array.from({ length: n }, (_, i) => "B" + i), bots: Array(n).fill(level), starter: seed % n }, rng);
  let guard = 0, refused = 0;
  while (st.phase !== "game_over" && guard++ < 100000) {
    const seat = st.turn;
    const a = F.botAct(st, seat, level, rng);
    let res = F.act(st, seat, a, rng);
    if (!res.ok) { refused++; res = F.act(st, seat, F.fallback(st, seat), rng); }
    if (!res.ok) throw new Error("the " + level + " computer proposed an illegal action " + JSON.stringify(a) + ": " + JSON.stringify(res));
  }
  return { st, guard, refused };
}
for (const level of F.LEVELS) {
  let ok = true, scoreOK = true, games = 0;
  for (let g = 0; g < 10; g++) {
    const n = 2 + (g % 3);
    const { st, guard, refused } = botGame(level, n, 400 + g * 13 + n);
    games++;
    if (st.phase !== "game_over" || st.winner === null || guard >= 100000) { ok = false; console.log("   " + level + " game " + g + " did not finish"); }
    if (st.seats[st.winner].score < F.TARGET) scoreOK = false;
    if (st.seats.some((s, i) => i !== st.winner && s.score >= F.TARGET)) scoreOK = false;
    if (refused) { ok = false; console.log("   " + level + " needed the fallback " + refused + " times"); }
  }
  check(level + " plays " + games + " whole games legally, all ending over 10000", ok && scoreOK);
}
{
  // hard should read the scoreboard better than easy
  const N = 160;
  let hardWins = 0;
  for (let g = 0; g < N; g++) {
    const rng = mulberry(9000 + g * 17), hardSeat = g % 2;
    const st = F.create({ names: ["A", "B"], bots: hardSeat === 0 ? ["hard", "easy"] : ["easy", "hard"], starter: g % 2 }, rng);
    let guard = 0;
    while (st.phase !== "game_over" && guard++ < 100000) {
      const seat = st.turn;
      F.act(st, seat, F.botAct(st, seat, st.seats[seat].bot, rng), rng);
    }
    if (st.winner === hardSeat) hardWins++;
  }
  check("hard beats easy most of the time", hardWins / N > 0.55, hardWins + "/" + N);
}

/* ---------- a whole room through the room protocol ---------- */
let n = 0; const mint = () => "tok" + ++n;
{
  check("farkle is one of the card games the worker runs", P.CARD_GAMES.includes("farkle"));
  const room = P.newRoom("FRKL01", T0, "farkle");
  check("a card room opens for the game", !!room);
  const a = P.join(room, null, "Alice", mint, T0, room_rng), b = P.join(room, null, "Bob", mint, T0, room_rng);
  check("the host can add a computer and start with 3 seats",
    P.setConfig(room, a.pid, { bots: 1, level: "medium" }, T0, room_rng).ok && P.start(room, a.pid, T0, room_rng).ok && room.phase === "playing" && room.table.length === 3);
  check("the room is running the farkle engine", room.state && room.state.game === "farkle" && room.state.target === F.TARGET);
  const seatA = room.table.findIndex((s) => s.kind === "human" && s.pid === a.pid);
  const seatB = room.table.findIndex((s) => s.kind === "human" && s.pid === b.pid);
  const view = P.viewFor(room, a.pid, T0);
  check("the room view carries the farkle board and the player's seat", view.table.game === "farkle" && view.table.you === seatA && view.table.seats.length === 3);
  // it is Alice's turn; a client only asks to roll and the room rolls
  let now = T0;
  const refused = P.act(room, b.pid, { t: "roll" }, now, room_rng);
  check("a person cannot move out of turn", !refused.ok && refused.reason === "not-your-turn");
  const before = room.state.moves;
  const rolled = P.act(room, a.pid, { t: "roll" }, now, room_rng);
  const rolledDice = room.state.dice.length ? vals(room.state.dice) : (room.state.last && room.state.last.dice) || [];
  check("the server rolls the dice inside the engine", rolled.ok && room.state.moves === before + 1 && rolledDice.length === 6 && rolledDice.every((v) => v >= 1 && v <= 6));
  // play the whole thing out: people act through the protocol, computers by the clock
  let guard = 0;
  while (room.phase !== "game_over" && guard++ < 200000) {
    const st = room.state, seat = st.turn, t = room.table[seat];
    if (room.phase === "playing" && t && t.kind === "human" && !room.players.find((p) => p.pid === t.pid).autoBot) {
      const a2 = F.botAct(st, seat, "medium", room_rng);
      const res = P.act(room, t.pid, a2, now, room_rng);
      if (!res.ok) { check("a person's legal action is accepted in a room", false, JSON.stringify(res)); break; }
      now += 300;
    } else {
      now = Math.max(now + 200, Math.min(P.nextWake(room, now), now + 5000));
      P.tick(room, now, room_rng);
    }
  }
  check("a whole room game finishes and names a winner", room.phase === "game_over" && room.state.winner !== null, room.phase + " guard=" + guard);
  check("the room winner is at or over 10000", room.state.seats[room.state.winner].score >= F.TARGET);
  const tally = Object.values(room.tally).reduce((x, y) => x + y, 0);
  check("a person's win is tallied at most once", tally <= 1, tally);
  check("both people are still seated", room.table.filter((s) => s.kind === "human").length === 2 && seatA >= 0 && seatB >= 0);
  P.vote(room, a.pid, now, room_rng); P.vote(room, b.pid, now, room_rng);
  check("everyone voting starts a rematch to a fresh 10000", room.phase === "playing" && room.state.game === "farkle" && room.state.moves === 0 && room.state.winner === null && room.state.seats.every((s) => s.score === 0));
}

console.log(fail ? `\n${pass} passed, ${fail} FAILED` : `\n${pass} passed`);
process.exit(fail ? 1 : 0);
