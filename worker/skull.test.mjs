/* Run: node worker/skull.test.mjs
   Skull's rules and computer, then a whole room through worker/card-protocol.mjs
   with a fake clock. If the protocol does not know Skull yet, it is imported
   with the registration injected in memory (the repo file is not edited). */
import * as P0 from "./card-protocol.mjs";
import "../skull/engine.js";

const S = globalThis.Skull;

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) pass++;
  else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? " — " + detail : "")); }
}
function mulberry(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rng = mulberry(5);
const T0 = 1_000_000;
const seatNames = (n) => Array.from({ length: n }, (_, i) => "P" + i);

console.log("skull:");

/* ---------- the table and what each person is shown ---------- */
{
  let threw2 = false, threw7 = false;
  try { S.create({ names: seatNames(2) }, rng); } catch (e) { threw2 = true; }
  try { S.create({ names: seatNames(7) }, rng); } catch (e) { threw7 = true; }
  check("3 to 6 seats: two and seven are refused", threw2 && threw7);

  for (let n = 3; n <= 6; n++) {
    const st = S.create({ names: seatNames(n), starter: n - 1 }, rng);
    check(n + " seats: every player gets 3 roses and 1 skull",
      st.seats.length === n && st.seats.every((s) => s.hand.filter((k) => k === "rose").length === 3 && s.hand.filter((k) => k === "skull").length === 1));
    check(n + " seats: every disc starts in the hand, face down",
      st.seats.every((s) => s.hand.length === 4 && s.stack.length === 0 && s.score === 0 && s.status === "in"));
    check(n + " seats: the chosen player opens", st.turn === n - 1 && st.first === n - 1 && st.phase === "place");
  }
}
{
  const st = S.create({ names: seatNames(3) }, rng);
  S.act(st, 0, { t: "place", i: 0 }, rng);
  S.act(st, 1, { t: "place", i: 0 }, rng);
  S.act(st, 2, { t: "place", i: 0 }, rng);
  const v1 = S.view(st, 1), vNull = S.view(st, null);
  check("your own discs are face up in your view",
    v1.seats[1].stack.length === 1 && v1.seats[1].stack[0].kind === st.seats[1].stack[0].kind && v1.seats[1].hand.length === 3);
  check("everyone else's discs are counts and backs",
    v1.seats[0].stack.length === 1 && v1.seats[0].stack[0].kind === null && v1.seats[0].hand === null && v1.seats[0].count === 4);
  check("another player's hand is never in your view", v1.seats.every((s, i) => i === 1 || s.hand === null));
  check("a spectator sees no disc faces", vNull.seats.every((s) => s.hand === null && s.stack.every((d) => d.up === false && d.kind === null)));
}

/* ---------- placement ---------- */
{
  const st = S.create({ names: seatNames(3) }, rng);
  check("a bid before everyone has placed one is refused", S.act(st, 0, { t: "bid", q: 1 }, rng).ok === false);
  check("out of turn is refused", S.act(st, 1, { t: "place", i: 0 }, rng).ok === false);
  check("a disc that is not in the hand is refused", S.act(st, 0, { t: "place", i: 9 }, rng).ok === false);
  const res = S.act(st, 0, { t: "place", i: 0 }, rng);
  check("a placed disc moves from the hand to a face-down stack",
    res.ok && st.seats[0].hand.length === 3 && st.seats[0].stack.length === 1 && st.seats[0].stack[0].up === false);
  check("the place event does not name the disc",
    !JSON.stringify(res.events).includes("rose") && !JSON.stringify(res.events).includes("skull"));
  check("placing passes the turn", st.turn === 1 && st.moves === 1);
  S.act(st, 1, { t: "place", i: 0 }, rng);
  S.act(st, 2, { t: "place", i: 0 }, rng);
  check("everyone has placed one, so bidding may open", S.anteDone(st) && S.view(st, 0).options.bid === true);
  check("a player may add another disc instead of bidding", (() => {
    const r = S.act(st, 0, { t: "place", i: 0 }, rng);
    return r.ok && st.phase === "place" && st.seats[0].stack.length === 2;
  })());
}
{
  const st = S.create({ names: seatNames(3) }, rng);
  for (let k = 0; k < 4; k++) for (let i = 0; i < 3; i++) S.act(st, st.turn, { t: "place", i: 0 }, rng);
  check("a player may place all four discs",
    st.seats.every((s) => s.stack.length === 4 && s.hand.length === 0) && st.phase === "place");
  check("with an empty hand the only move is a bid",
    S.view(st, 0).options.place === false && S.view(st, 0).options.bid === true && S.act(st, 0, { t: "place", i: 0 }, rng).ok === false);
  check("a bid may not exceed the discs on the table", S.act(st, 0, { t: "bid", q: 13 }, rng).ok === false);
}

/* ---------- bidding ---------- */
{
  const st = S.create({ names: seatNames(3) }, rng);
  S.act(st, 0, { t: "place", i: 0 }, rng); S.act(st, 1, { t: "place", i: 0 }, rng); S.act(st, 2, { t: "place", i: 0 }, rng);
  const b = S.act(st, 0, { t: "bid", q: 2 }, rng);
  check("the opening bid starts the auction and passes the turn",
    b.ok && st.phase === "bid" && st.bid.seat === 0 && st.bid.q === 2 && st.turn === 1);
  check("a raise must be higher", S.act(st, 1, { t: "bid", q: 2 }, rng).ok === false);
  const r = S.act(st, 1, { t: "bid", q: 3 }, rng);
  check("a bid at the number of discs ends the bidding at once",
    r.ok && st.phase === "reveal" && st.bid.seat === 1 && st.reveal.q === 3 && st.turn === 1);
  check("people cannot place discs once the bidding has started", S.act(st, 0, { t: "place", i: 0 }, rng).ok === false);
}
{
  const st = S.create({ names: seatNames(3) }, rng);
  S.act(st, 0, { t: "place", i: 0 }, rng); S.act(st, 1, { t: "place", i: 0 }, rng); S.act(st, 2, { t: "place", i: 0 }, rng);
  S.act(st, 0, { t: "bid", q: 1 }, rng);
  const p1 = S.act(st, 1, { t: "pass" }, rng);
  check("passing passes the turn and is recorded", p1.ok && st.passed[1] === true && st.turn === 2 && st.phase === "bid");
  const p2 = S.act(st, 2, { t: "pass" }, rng);
  check("when all but one has passed the highest bidder must turn",
    p2.ok && st.phase === "reveal" && st.reveal.seat === 0 && st.turn === 0);
  check("a passed player cannot act again", S.act(st, 1, { t: "pass" }, rng).ok === false);
}

/* ---------- turning discs ---------- */
function mkState(stacks, extra) {
  const e = extra || {};
  const st = S.create({ names: seatNames(stacks.length), bots: e.bots, starter: e.starter || 0 }, e.rng || rng);
  st.seats.forEach((s, i) => {
    s.hand = e.hands && e.hands[i] ? e.hands[i].slice() : [];
    s.stack = (stacks[i] || []).map((kind) => ({ kind, up: false }));
    s.score = (e.scores && e.scores[i]) || 0;
    s.status = (e.status && e.status[i]) || "in";
    if (s.status === "out") { s.hand = []; s.stack = []; }
  });
  st.phase = "place";
  st.first = st.turn = e.turn !== undefined ? e.turn : (e.starter || 0);
  st.bid = null; st.passed = st.seats.map(() => false); st.reveal = null; st.winner = null;
  return st;
}
{
  // three roses on top of the first player's own stack: the bid is safe
  const st = mkState([["rose", "rose", "rose"], ["skull"], ["rose"]]);
  S.act(st, 0, { t: "bid", q: 3 }, rng);
  S.act(st, 1, { t: "pass" }, rng);
  S.act(st, 2, { t: "pass" }, rng);
  check("the challenger is the highest bidder", st.phase === "reveal" && st.turn === 0 && st.reveal.seat === 0);
  const f1 = S.act(st, 0, { t: "flip" }, rng);
  const f2 = S.act(st, 0, { t: "flip" }, rng);
  const f3 = S.act(st, 0, { t: "flip" }, rng);
  check("only the challenger may turn, and their own stack goes first",
    f1.ok && f2.ok && f3.ok && st.reveal.flips.every((f) => f.seat === 0));
  check("turning the bid without a skull wins the challenge",
    st.phase === "round_over" && st.reveal.success === true && st.reveal.skull === false);
  check("a won challenge scores one point (not the bid)", st.seats[0].score === 1 && st.seats[1].score === 0);
  check("the turned discs are public to everyone", S.view(st, 1).reveal.flips.length === 3 && S.view(st, 1).seats[0].stack.every((d) => d.up && d.kind === "rose"));
  check("the challenger starts the next round and the stacks go back to the hands", (() => {
    const counts = st.seats.map((s) => S.discCount(s));
    const ok = S.nextRound(st, rng);
    return ok && st.phase === "place" && st.round === 2 && st.turn === 0 && st.seats.every((s, i) => s.stack.length === 0 && S.discCount(s) === counts[i]);
  })());
}
{
  // the challenger's own top disc is a skull
  const st = mkState([["rose", "skull"], ["rose"], ["rose"]]);
  S.act(st, 0, { t: "bid", q: 1 }, rng);
  S.act(st, 1, { t: "pass" }, rng);
  S.act(st, 2, { t: "pass" }, rng);
  const res = S.act(st, 0, { t: "flip" }, rng);
  check("a skull ends the challenge at once",
    res.ok && st.phase === "round_over" && st.reveal.skull === true && st.reveal.success === false && st.reveal.loser === 0);
  check("the challenger loses one disc", S.discCount(st.seats[0]) === 1 && st.seats[0].score === 0);
  check("the lost disc is secret from the others, but known to its owner",
    S.view(st, 1).reveal.lostKind === undefined && S.view(st, null).reveal.lostKind === undefined && typeof S.view(st, 0).reveal.lostKind === "string");
  check("the round result stops further turns", S.act(st, 0, { t: "flip" }, rng).ok === false);
}
{
  // the bid is bigger than the challenger's own stack: an opponent's skull decides it
  const st = mkState([["rose", "rose"], ["skull"], ["rose"]]);
  S.act(st, 0, { t: "bid", q: 3 }, rng);
  S.act(st, 1, { t: "pass" }, rng);
  S.act(st, 2, { t: "pass" }, rng);
  S.act(st, 0, { t: "flip" }, rng);
  S.act(st, 0, { t: "flip" }, rng);
  const res = S.act(st, 0, { t: "flip" }, rng);
  check("after a player's own discs, other players' discs are turned in turn order",
    res.ok && st.reveal.flips.length === 3 && st.reveal.flips[2].seat === 1 && st.reveal.flips[2].kind === "skull");
  check("a skull in another player's stack still costs the challenger a disc",
    S.discCount(st.seats[0]) === 1 && S.discCount(st.seats[1]) === 1 && st.phase === "round_over");
}
{
  // the challenger is knocked out by someone else's skull: that owner starts
  const st = mkState([["rose"], ["skull"], ["rose", "rose"]]);
  S.act(st, 0, { t: "bid", q: 2 }, rng);
  S.act(st, 1, { t: "pass" }, rng);
  S.act(st, 2, { t: "pass" }, rng);
  S.act(st, 0, { t: "flip" }, rng);
  const res = S.act(st, 0, { t: "flip" }, rng);
  check("the owner of a skull starts when the challenger is knocked out",
    res.ok && st.phase === "round_over" && st.seats[0].status === "out" && st.first === 1 && st.turn === 1);
}

/* ---------- points, elimination and the end ---------- */
{
  const st = mkState([["rose"], ["rose"], ["rose"]], { scores: [1, 0, 0] });
  S.act(st, 0, { t: "bid", q: 1 }, rng);
  S.act(st, 1, { t: "pass" }, rng);
  S.act(st, 2, { t: "pass" }, rng);
  const res = S.act(st, 0, { t: "flip" }, rng);
  check("a second challenge wins the game at 2 points",
    st.phase === "game_over" && st.winner === 0 && st.seats[0].score === 2 && res.events.some((e) => e.e === "win" && e.reason === "points"));
  check("a finished game takes no more rounds", S.nextRound(st, rng) === false);
}
{
  // the challenger is knocked out, leaving two players
  const st = mkState([["rose", "rose"], ["rose", "rose"], ["skull"]], { starter: 2 });
  S.act(st, 2, { t: "bid", q: 1 }, rng);
  S.act(st, 0, { t: "pass" }, rng);
  S.act(st, 1, { t: "pass" }, rng);
  const res = S.act(st, 2, { t: "flip" }, rng);
  check("losing the last disc puts a player out",
    st.seats[2].status === "out" && S.discCount(st.seats[2]) === 0 && res.events.some((e) => e.e === "out" && e.seat === 2));
  check("the round ends and the next first player is alive",
    st.phase === "round_over" && st.first === 0 && st.turn === 0);
  S.nextRound(st, rng);
  check("an out player is skipped, and has no discs to place",
    S.view(st, 0).seats[2].status === "out" && S.discCount(st.seats[2]) === 0 && st.turn === 0 && S.act(st, 2, { t: "place", i: 0 }, rng).ok === false);
}
{
  // two players left, one turns their own skull on a one-disc bid: the other wins
  const st = mkState([["skull"], ["rose"], []], { status: ["in", "in", "out"] });
  S.act(st, 0, { t: "bid", q: 1 }, rng);
  S.act(st, 1, { t: "pass" }, rng);
  const res = S.act(st, 0, { t: "flip" }, rng);
  check("the last player with discs wins when another is eliminated",
    st.phase === "game_over" && st.winner === 1 && res.events.some((e) => e.e === "win" && e.seat === 1 && e.reason === "last"));
}

/* ---------- the computer ---------- */
{
  const st = mkState([["rose"], ["rose"], ["rose"]]);
  check("a fallback action is legal", S.act(st, 0, S.fallback(st, 0), rng).ok === true);
}
for (const lvl of S.LEVELS) {
  let ok = true, games = 0, rounds = 0;
  for (let g = 0; g < 24 && ok; g++) {
    const n = 3 + (g % 4), r = mulberry(400 + g);
    const st = S.create({ names: seatNames(n), bots: Array(n).fill(lvl), starter: g % n }, r);
    let guard = 0;
    while (st.phase !== "game_over" && guard++ < 6000) {
      if (st.phase === "round_over") { S.nextRound(st, r); rounds++; continue; }
      const a = S.botAct(st, st.turn, lvl, r);
      const res = S.act(st, st.turn, a, r);
      if (!res.ok) { ok = false; console.log("   " + lvl + " action refused", JSON.stringify(a), JSON.stringify(res)); break; }
    }
    if (st.phase !== "game_over") { ok = false; console.log("   " + lvl + " game never ended"); }
    games++;
  }
  check(lvl + " plays " + games + " whole games legally (" + rounds + " rounds)", ok);
}
{
  let hardWins = 0;
  const N = 200;
  for (let g = 0; g < N; g++) {
    const r = mulberry(900 + g), hardSeat = g % 3;
    const bots = ["easy", "easy", "easy"]; bots[hardSeat] = "hard";
    const st = S.create({ names: ["a", "b", "c"], bots, starter: 0 }, r);
    let guard = 0;
    while (st.phase !== "game_over" && guard++ < 5000) {
      if (st.phase === "round_over") { S.nextRound(st, r); continue; }
      S.act(st, st.turn, S.botAct(st, st.turn, st.seats[st.turn].bot, r), r);
    }
    if (st.winner === hardSeat) hardWins++;
  }
  check("hard wins most games against easy", hardWins / N > 0.55, hardWins + "/" + N);
}

/* ---------- a whole room, through the shared protocol ---------- */
async function protocolWithSkull() {
  if (P0.CARD_GAMES && P0.CARD_GAMES.includes("skull") && P0.newRoom("ZZZ999", T0, "skull")) return P0;
  const { readFileSync } = await import("node:fs");
  const root = new URL("../", import.meta.url).href;
  let src = readFileSync(new URL("./card-protocol.mjs", import.meta.url), "utf8");
  src = src.replace(/"\.\.\//g, '"' + root);
  if (!/"skull"\s*:/.test(src)) src = src.replace("const ENGINES = {", 'const ENGINES = { "skull": globalThis.Skull,');
  return import("data:text/javascript;base64," + Buffer.from(src).toString("base64"));
}
const P = await protocolWithSkull();
{
  check("Skull is registered with the room protocol", P.CARD_GAMES.includes("skull"));
  const room = P.newRoom("ABC234", T0, "skull");
  check("a skull room exists", !!room && room.game === "skull" && room.phase === "lobby");
  check("an unknown game is still refused", P.newRoom("ABC234", T0, "not-a-game") === null);
  let n = 0; const mint = () => "tok" + (++n);
  const a = P.join(room, null, "Alice", mint, T0, rng);
  const b = P.join(room, null, "Bob", mint, T0, rng);
  check("people take seats in the lobby", a.ok && b.ok && room.players.length === 2);
  check("only the normal game type exists for skull", P.setConfig(room, a.pid, { mode: "tournament" }, T0, rng).reason === "bad-config");
  check("the host adds a computer and a level", P.setConfig(room, a.pid, { bots: 1, level: "hard" }, T0, rng).ok);
  check("the host starts it", P.start(room, a.pid, T0, rng).ok && room.phase === "playing");
  check("the room has a legal Skull table", room.state && room.state.seats.length >= S.MIN_SEATS && room.state.seats.length <= S.MAX_SEATS, room.state && room.state.seats.length);

  const seatA = room.table.findIndex((s) => s.kind === "human" && s.pid === a.pid);
  const seen = P.viewFor(room, a.pid, T0).table;
  check("the room sends a player only their own discs",
    seen.seats[seatA].hand.length === 4 && seen.seats.every((s, i) => i === seatA || s.hand === null));
  check("the room view names the game", P.viewFor(room, a.pid, T0).game === "skull");

  // Play the room out on a fake clock: the people act for themselves, the
  // computers by the clock, the rounds advance by the clock.
  let now = T0, guard = 0, refused = null, deep = false;
  while (room.phase !== "game_over" && guard++ < 15000) {
    const st = room.state;
    if (room.phase === "playing" && room.table[st.turn] && room.table[st.turn].kind === "human") {
      const pid = room.table[st.turn].pid;
      const act = S.botAct(st, st.turn, "medium", rng);
      const res = P.act(room, pid, act, now, rng);
      if (!res.ok) { refused = { act, res }; break; }
    } else {
      now = Math.max(now + 1000, P.nextWake(room, now));
      P.tick(room, now, rng);
    }
    if (!deep && room.phase === "playing" && room.state.moves >= 4) {
      deep = true;
      const sA = room.table.findIndex((s) => s.kind === "human" && s.pid === a.pid);
      const av = P.viewFor(room, a.pid, now).table;
      if (sA >= 0 && av.seats[sA].status === "in") {
        check("the server keeps other players' face-down discs secret",
          av.seats.every((s, i) => i === sA || s.stack.every((d) => d.up || d.kind === null)));
        check("the server sends only your own hand",
          av.seats[sA].hand !== null && av.seats.every((s, i) => i === sA || s.hand === null));
      }
    }
  }
  check("the room accepts people's actions", refused === null, refused && JSON.stringify(refused));
  check("the room plays a whole game and names a winner",
    room.phase === "game_over" && room.state.winner !== null, room.phase + " guard " + guard);
  const humanWins = Object.values(room.tally).reduce((x, y) => x + y, 0);
  check("a person's win is tallied at most once", humanWins <= 1, humanWins);
  P.vote(room, a.pid, now, rng);
  P.vote(room, b.pid, now, rng);
  check("everyone voting starts a rematch", room.phase === "playing" && room.state.round === 1, room.phase);
}
{
  // three people, no computers: one drops out after the game, the other two vote. Skull needs three, so the room
  // must go back to the lobby. (It used to try to start with two, the engine threw, and the room stuck on "Waiting".)
  const room = P.newRoom("ABC235", T0, "skull");
  let n = 0; const mint = () => "t" + (++n);
  const [a, b, c] = ["Ann", "Ben", "Cat"].map((nm) => P.join(room, null, nm, mint, T0, rng));
  P.start(room, a.pid, T0, rng);
  room.phase = "game_over"; room.state.winner = 0;
  P.setOnline(room, c.pid, false, T0);
  let threw = null, r = null;
  try { P.vote(room, a.pid, T0, rng); r = P.vote(room, b.pid, T0, rng); } catch (e) { threw = e.message; }
  check("a rematch with too few people for Skull goes back to the lobby", !threw && r && r.ok && room.phase === "lobby", threw || room.phase);
}

console.log(fail ? `\n${pass} passed, ${fail} FAILED` : `\n${pass} passed`);
process.exit(fail ? 1 : 0);
