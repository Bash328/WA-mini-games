/* Run: node worker/lost-cities.test.mjs
   (Lost Cities rules, scoring, the computer, and a whole room with a fake clock)

   Lost Cities is registered in worker/card-protocol.mjs alongside the other
   card games, so the room half of this test drives the real protocol directly. */
import "../lost-cities/engine.js";
const LC = globalThis.LostCities;

let pass = 0, fail = 0;
function check(name, ok, detail) { if (ok) pass++; else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? " — " + detail : "")); } }
function mulberry(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rng = mulberry(11);
let n = 0; const mint = () => "tok" + ++n;
const T0 = 1_000_000;

const P = await import("./card-protocol.mjs");

/* ---------- helpers ---------- */
function game(seed) { return LC.create({ names: ["A", "B"] }, mulberry(seed || 7)); }
function cardsOf(st) {
  return st.seats.flatMap((s) => s.hand.concat(s.expeditions.flat())).concat(st.deck, st.discards.flat());
}
function validPile(pile) {
  let number = false, last = 0;
  for (const c of pile) {
    if (!LC.isCard(c)) return false;
    if (LC.isHandshake(c)) { if (number) return false; }
    else {
      const v = LC.VALUE(c);
      if (number && v <= last) return false;
      number = true; last = v;
    }
  }
  return true;
}
function seal(st) { return st.phase === "play" && cardsOf(st).length === 60 && new Set(cardsOf(st)).size === 60; }

console.log("lost-cities:");
// --- the deal
{
  const st = game(5);
  const all = cardsOf(st);
  check("60 different cards, 8 each, 44 left in the deck", all.length === 60 && new Set(all).size === 60 && st.seats.every((s) => s.hand.length === 8) && st.deck.length === 44);
  check("every card is a real card", all.every(LC.isCard));
  const byColour = LC.COLOURS.map((c) => all.filter((x) => LC.colourOf(x) === c));
  check("five colours with 12 cards each: numbers 2-10 and three handshakes",
    byColour.every((p) => p.length === 12 && p.filter(LC.isHandshake).length === 3 && p.filter((c) => !LC.isHandshake(c)).length === 9));
  check("the game starts on seat 0, playing, with a card to play or discard",
    st.phase === "play" && st.turn === 0 && st.stage === "action" && st.winner === null);
  check("a view shows only your own hand", LC.view(st, 0).seats[0].hand.length === 8 && LC.view(st, 0).seats[1].hand === undefined
    && LC.view(st, null).seats.every((s) => s.hand === undefined));
  check("at the start every card in hand can start its expedition, and nothing is a draw yet",
    LC.view(st, 0).options.play.length === 8 && !LC.view(st, 0).options.draw.length);
  check("drawing before playing or discarding is refused", !LC.act(st, 0, { t: "draw", from: "deck" }, rng).ok && st.deck.length === 44);
  let threw = 0;
  try { LC.create({ names: ["only me"] }, mulberry(1)); } catch (e) { threw++; }
  try { LC.create({ names: ["a", "b", "c"] }, mulberry(1)); } catch (e) { threw++; }
  check("the table is exactly two seats", threw === 2);
}
// --- playing: ascending numbers, handshakes only first
{
  check("numbers must go up, an empty pile takes anything, handshakes come before numbers",
    LC.canPlayOn([], "2Y") && LC.canPlayOn(["4Y"], "5Y") && !LC.canPlayOn(["4Y"], "4Y") && !LC.canPlayOn(["4Y"], "3Y")
    && LC.canPlayOn([], "H1Y") && LC.canPlayOn(["H1Y"], "H2Y") && LC.canPlayOn(["H1Y"], "2Y") && !LC.canPlayOn(["2Y"], "H1Y") && !LC.canPlayOn(["H1Y", "4Y"], "H2Y"));
}
{
  const st = game(8);
  st.seats[0].expeditions[0] = ["H1Y", "4Y"];
  st.seats[0].hand = ["2Y", "5Y", "H2Y", "7B", "3B", "H1W", "2G", "10R"];
  st.turn = 0; st.stage = "action"; st.phase = "play";
  const legal = LC.legalPlays(st, 0);
  check("only cards that fit are legal", legal.includes("5Y") && !legal.includes("2Y") && !legal.includes("H2Y") && legal.includes("7B"), JSON.stringify(legal));
  const before = st.seats[0].hand.slice();
  check("a low card is refused and nothing changes", !LC.act(st, 0, { t: "play", card: "2Y" }, rng).ok && st.seats[0].hand.join() === before.join());
  check("a handshake after a number is refused", !LC.act(st, 0, { t: "play", card: "H2Y" }, rng).ok && st.stage === "action");
  check("a card you do not hold is refused", !LC.act(st, 0, { t: "play", card: "9R" }, rng).ok);
  const r = LC.act(st, 0, { t: "play", card: "5Y" }, rng);
  check("a fitting card goes on the expedition and leaves the hand", r.ok && st.seats[0].expeditions[0].join() === "H1Y,4Y,5Y" && st.seats[0].hand.length === 7);
  check("then it is time to draw, not to play again", st.stage === "draw" && r.events.some((e) => e.e === "play"));
  check("the draw is the only option now", LC.view(st, 0).options.draw.join() === "deck" && !LC.view(st, 0).options.play.length);
  check("playing before drawing is refused", !LC.act(st, 0, { t: "play", card: "7B" }, rng).ok);
  check("discarding before drawing is refused", !LC.act(st, 0, { t: "discard", card: "7B" }, rng).ok);
  check("an empty discard pile cannot be drawn from", LC.act(st, 0, { t: "draw", from: "Y" }, rng).error === "discard-empty");
  const d = LC.act(st, 0, { t: "draw", from: "deck" }, rng);
  const drawEvent = d.events.find((e) => e.e === "draw");
  check("drawing a card from the deck keeps it secret in the events", d.ok && drawEvent && drawEvent.from === "deck" && !("card" in drawEvent));
  check("the hand is whole again and the turn has passed", st.seats[0].hand.length === 8 && st.deck.length === 43 && st.turn === 1 && st.stage === "action");
  check("the other seat may not act out of turn", LC.act(st, 0, { t: "discard", card: st.seats[0].hand[0] }, rng).error === "not-your-turn");
}
// --- discarding, taking the discard, and the swap of who moves
{
  const st = game(9);
  st.seats[0].hand = ["2Y", "3B", "4W", "5G", "6R", "7Y", "8B", "9W"];
  st.turn = 0; st.stage = "action";
  const r = LC.act(st, 0, { t: "discard", card: "2Y" }, rng);
  check("a discarded card lies face up on its colour pile", r.ok && st.discards[0].join() === "2Y" && st.seats[0].hand.length === 7 && st.stage === "draw");
  const d = LC.act(st, 0, { t: "draw", from: "Y" }, rng);
  check("you may take the card you just discarded (or any discard top)", d.ok && st.seats[0].hand.includes("2Y") && st.discards[0].length === 0 && st.turn === 1);
  check("the drawn discard is named in the public event", d.events.some((e) => e.e === "draw" && e.from === "Y" && e.card === "2Y"));
  check("only the top card of a discard pile is available", st.discards[0].length === 0 && LC.act(st, 1, { t: "play", card: "2Y" }, rng).error === "not-in-hand");
}
// --- scoring: handshakes, negatives, sums
{
  check("an expedition with no cards scores nothing", LC.scoreExpedition([]) === 0);
  check("a lone 2 is a negative expedition", LC.scoreExpedition(["2Y"]) === -18);
  check("a handshake multiplies the loss", LC.scoreExpedition(["H1Y", "3Y", "5Y"]) === -24);
  check("three handshakes multiply the loss four times", LC.scoreExpedition(["H1Y", "H2Y", "H3Y", "10Y"]) === -40);
  check("a full 2 to 10 expedition is 34", LC.scoreExpedition(["2Y", "3Y", "4Y", "5Y", "6Y", "7Y", "8Y", "9Y", "10Y"]) === 34);
  check("the five expeditions are summed, negatives and all", LC.scoreSeat({ expeditions: [["2Y"], ["3B"], [], [], []] }) === -35);
}
{
  const st = game(10);
  st.seats[0].expeditions = [["H1Y", "3Y", "5Y"], ["2B", "3B", "4B", "5B", "6B", "7B", "8B", "9B", "10B"], [], [], []];
  st.seats[1].expeditions = [["2R"], [], [], [], []];
  st.seats[0].hand = ["2G"]; st.seats[1].hand = ["3G"];
  st.deck = ["10W"]; st.turn = 0; st.stage = "draw"; st.phase = "play";
  const v0 = LC.view(st, 0);
  check("the score is exposed in the view while the round runs", v0.scores[0] === 10 && v0.scores[1] === -18 && v0.seats[0].expScores[0] === -24);
  const r = LC.act(st, 0, { t: "draw", from: "deck" }, rng);
  check("drawing the last card ends the game", r.ok && st.deck.length === 0 && st.phase === "game_over" && st.stage === "over");
  check("the final scores are counted and the higher one wins", st.seats[0].score === 10 && st.seats[1].score === -18 && st.winner === 0 && st.final.scores.join() === "10,-18" && !st.final.draw);
  check("the scoring and the win are announced", r.events.some((e) => e.e === "score") && r.events.some((e) => e.e === "win" && e.seat === 0));
  const v = LC.view(st, 0);
  check("the final breakdown is in the view", v.final.expScores[0].join() === "-24,34,0,0,0" && v.seats[0].score === 10);
  check("hands stay hidden after the game", v.seats[0].hand.length === 2 && v.seats[1].hand === undefined);
  check("one round is the whole game", LC.nextRound(st) === false);
}
{
  const st = game(12);
  st.seats[0].expeditions = [["2Y"], [], [], [], []];
  st.seats[1].expeditions = [["2B"], [], [], [], []];
  st.seats[0].hand = ["3G"]; st.seats[1].hand = ["4G"];
  st.deck = ["9R"]; st.turn = 0; st.stage = "draw"; st.phase = "play";
  LC.act(st, 0, { t: "draw", from: "deck" }, rng);
  check("a tie is a draw (and an earlier-seat winner for the room screens)", st.final.draw === true && st.winner === 0 && st.seats[0].score === st.seats[1].score);
}
// --- the deck ending, and not ending too early
{
  const st = game(13);
  st.deck = ["7W"];
  st.discards[0] = ["2Y"];
  st.seats[0].hand = ["3Y", "4B", "5B", "6B", "7B", "8B", "9B", "10B"];
  st.turn = 0; st.stage = "draw"; st.phase = "play";
  const r = LC.act(st, 0, { t: "draw", from: "Y" }, rng);
  check("drawing from a discard pile does not end the round while the deck has cards", r.ok && st.phase === "play" && st.deck.length === 1 && st.turn === 1 && st.seats[0].hand.includes("2Y"));
  st.turn = 1; st.stage = "draw";
  const d = LC.act(st, 1, { t: "draw", from: "deck" }, rng);
  check("the last deck card is drawn and the game ends", d.ok && st.phase === "game_over" && st.deck.length === 0);
}
// --- a whole game by computer players, every level
function botGame(level, seed) {
  const r = mulberry(seed);
  const st = LC.create({ names: ["A", "B"], bots: [level, level] }, r);
  let guard = 0, moves = 0;
  while (st.phase === "play" && guard++ < 20000) {
    const seat = st.turn;
    const a = LC.botAct(st, seat, level, r);
    if (!a) throw new Error("the computer offered no action at " + st.stage);
    let res = LC.act(st, seat, a, r);
    if (!res.ok) res = LC.act(st, seat, LC.fallback(st, seat), r);
    if (!res.ok) throw new Error("a legal move was refused: " + JSON.stringify(res) + " action " + JSON.stringify(a));
    moves++;
    if (st.phase === "play" && !seal(st)) throw new Error("a card went missing after " + JSON.stringify(a));
    if (!st.seats.every((s) => s.expeditions.every(validPile))) throw new Error("an expedition broke the order after " + JSON.stringify(a));
    if (st.stage === "action" && st.phase === "play" && st.seats[st.turn].hand.length !== 8) throw new Error("a turn did not finish with 8 cards");
  }
  return { st, guard, moves };
}
for (const level of ["easy", "medium", "hard"]) {
  const { st, guard, moves } = botGame(level, 7);
  check(`${level}: a whole game finishes in ${moves} actions (${guard} loops)`, st.phase === "game_over" && st.winner !== null);
  check(`${level}: the deck is empty and every score is its expeditions`, st.deck.length === 0
    && st.seats.every((s) => s.score === LC.scoreSeat(s))
    && st.final.scores[0] === LC.scoreSeat(st.seats[0]) && st.final.scores[1] === LC.scoreSeat(st.seats[1]));
  check(`${level}: the winner has the higher score (a tie goes to seat 0)`, st.final.draw || st.seats[st.winner].score > st.seats[1 - st.winner].score);
}
// --- through a real room: two people, then a room with a computer filling the second seat
function drive(room, r) {
  let now = T0, guard = 0;
  while (room.phase !== "game_over" && guard++ < 4000) {
    if (room.phase === "playing" && room.state && room.state.phase === "play") {
      const seat = room.state.turn, t = room.table[seat];
      const p = t.kind === "human" ? room.players.find((x) => x.pid === t.pid) : null;
      if (p && !p.autoBot) {
        const a = LC.botAct(room.state, seat, "hard", r);
        const res = P.act(room, p.pid, a, now, r);
        if (!res.ok) throw new Error("a legal move was refused in the room: " + JSON.stringify(res) + " " + JSON.stringify(a));
        now += 300;
        continue;
      }
    }
    now = Math.max(now + 200, Math.min(P.nextWake(room, now), now + 3000));
    P.tick(room, now, r);
  }
  return { now, guard };
}
{
  check("the protocol registers the game", P.CARD_GAMES.includes("lost-cities"));
  const room = P.newRoom("LCARDS", T0, "lost-cities");
  check("a lost-cities room exists", !!room && room.game === "lost-cities");
  const a = P.join(room, null, "Alice", mint, T0, rng), b = P.join(room, null, "Bob", mint, T0, rng);
  check("two people fill both seats and start by themselves", room.phase === "playing" && room.table.length === 2 && room.table.every((s) => s.kind === "human") && room.state.seats.length === 2);
  check("the host cannot change the settings once the full table has started", P.setConfig(room, a.pid, { bots: 0 }, T0, rng).ok === false);
  const va = P.viewFor(room, a.pid, T0).table, vb = P.viewFor(room, b.pid, T0).table;
  check("each person is sent only their own eight cards", va.seats[0].hand.length === 8 && va.seats[1].hand === undefined && vb.seats[1].hand.length === 8 && vb.seats[0].hand === undefined);
  check("both expeditions, the discards and the deck are public", va.seats[0].expeditions.length === 5 && va.discards.length === 5 && va.deck === 44 && va.seats[1].expeditions.length === 5);
  const { now, guard } = drive(room, rng);
  check("a whole room game finishes through the protocol", room.phase === "game_over" && room.state.phase === "game_over" && room.state.winner !== null, room.phase + " guard=" + guard);
  check("the room announces the result", room.lastEvents.some((e) => e.e === "win") && room.lastEvents.some((e) => e.e === "score"));
  const endA = P.viewFor(room, a.pid, now), endB = P.viewFor(room, b.pid, now);
  check("the room view shows the final scores and still hides the other hand", endA.table.final && endB.table.final.scores.join() === endA.table.final.scores.join() && endB.table.seats[0].hand === undefined);
  const winner = room.state.winner;
  check("a rematch waits for both votes", P.vote(room, a.pid, now, rng).started === false);
  const re = P.vote(room, b.pid, now, rng);
  check("when both vote a fresh game starts, the winner leading", re.started && room.phase === "playing" && room.state.turn === winner && room.state.moves === 0);
}
{
  const room = P.newRoom("LCBOTS", T0, "lost-cities");
  const a = P.join(room, null, "Alice", mint, T0, rng);
  P.setConfig(room, a.pid, { bots: 1 }, T0, rng);
  const r = room.phase === "playing" ? { ok: true } : P.start(room, a.pid, T0, rng);
  check("one person plus a computer fills the second seat", r.ok && room.phase === "playing" && room.table.length === 2 && room.table[1].kind === "bot");
  const { guard } = drive(room, rng);
  check("the person-versus-computer room also finishes", room.phase === "game_over" && room.state.winner !== null, "guard=" + guard);
}
{
  const room = P.newRoom("LC3RD", T0, "lost-cities");
  const a = P.join(room, null, "Alice", mint, T0, rng), b = P.join(room, null, "Bob", mint, T0, rng);
  const c = P.join(room, null, "Carol", mint, T0, rng);
  check("a third person cannot make a three-seat Lost Cities room", !c.ok && room.table.length === 2 && room.players.length === 2);
}
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
