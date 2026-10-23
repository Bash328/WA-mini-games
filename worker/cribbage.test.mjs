/* Run: node worker/cribbage.test.mjs
   (Cribbage rules, scoring, the computer, and a whole room with a fake clock) */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import "../cribbage/engine.js";

const C = globalThis.Cribbage;

let pass = 0, fail = 0;
function check(name, ok, detail) { if (ok) pass++; else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? " — " + detail : "")); } }
function mulberry(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rng = mulberry(31);
let n = 0; const mint = () => "tok" + ++n;
const T0 = 1_000_000;

/* The shared protocol may not know Cribbage yet. Load a copy of its source
   in memory with the engine registration added; if the protocol already
   knows the game, the source is untouched. Relative imports are made
   absolute so the copy can live in a data: URL. */
async function loadProtocol() {
  const file = fileURLToPath(new URL("./card-protocol.mjs", import.meta.url));
  let src = fs.readFileSync(file, "utf8");
  if (!/"cribbage"\s*:/.test(src)) {
    src = src.replace(/(import\s+["']\.\.\/lost-cities\/engine\.js["'];?)/, '$1\nimport "../cribbage/engine.js";');
    src = src.replace(/("lost-cities"\s*:\s*globalThis\.LostCities)/, '$1, "cribbage": globalThis.Cribbage');
  }
  const dir = path.dirname(file);
  src = src.replace(/(from\s+|import\s+)(["'])(\.\.?\/[^"']+)\2/g, (m, pre, quote, spec) => pre + quote + pathToFileURL(path.resolve(dir, spec)).href + quote);
  return import("data:text/javascript;base64," + Buffer.from(src).toString("base64"));
}
const P = await loadProtocol();

/* ---------- helpers ---------- */
function game(seed) { return C.create({ names: ["A", "B"] }, mulberry(seed || 7)); }
function cardsOf(st) {
  return st.seats.flatMap((s) => s.hand).concat(st.crib, st.deck, st.starter ? [st.starter] : [],
    (st.pegging && st.pegging.log ? st.pegging.log.map((p) => p.card) : []));
}
function intact(st) {
  const cards = cardsOf(st);
  return cards.length === 52 && new Set(cards).size === 52 && cards.every(C.isCard);
}
function rig(seed) {
  const st = game(seed);
  st.phase = "pegging";
  st.starter = "2C";
  st.deck = st.deck.filter((c) => c !== "2C");
  st.crib = ["2D", "2H", "3D", "3H"];
  st.seats[0].hand = [];
  st.seats[1].hand = [];
  st.pegging = { count: 0, line: [], log: [], go: [false, false], last: null, points: [0, 0] };
  st.turn = 0;
  return st;
}

console.log("cribbage:");
// --- the shared engine shape
check("the engine has the shared shape and exactly two seats",
  ["create", "act", "botAct", "view", "nextRound", "fallback"].every((k) => typeof C[k] === "function") && C.TABLE_SIZE === 2);
// --- the deal and hidden hands
{
  const st = game(5);
  check("two seats, six cards each, and a 40-card stock", C.TABLE_SIZE === 2 && st.seats.length === 2
    && st.seats.every((s) => s.hand.length === 6) && st.deck.length === 40 && st.crib.length === 0);
  check("the deal starts in the discard phase with the dealer and the non-dealer leading",
    st.phase === "discard" && st.dealer === 0 && st.leader === 1 && st.turn === 0 && st.starter === null);
  check("every card in the deal is real and distinct", intact(st));
  const v0 = C.view(st, 0), v1 = C.view(st, 1);
  check("you see only your own hand and the crib face down",
    v0.seats[0].hand.length === 6 && v0.seats[1].hand === undefined && v0.crib === undefined && v0.cribCount === 0);
  check("the other seat sees its own hand only", v1.seats[1].hand.length === 6 && v1.seats[0].hand === undefined);
  check("a spectator sees no hands at all", C.view(st, null).seats.every((s) => s.hand === undefined));
  check("there are six cards to choose two from", C.view(st, 0).options.discard.length === 6 && !C.view(st, 1).options.discard.length);
  let threw = 0;
  try { C.create({ names: ["only me"] }, mulberry(1)); } catch (e) { threw++; }
  try { C.create({ names: ["a", "b", "c"] }, mulberry(1)); } catch (e) { threw++; }
  check("the table is exactly two seats", threw === 2);
}
// --- discarding to the dealer's crib, then cutting the starter
{
  const st = game(8);
  const a = st.seats[0].hand.slice(0, 2);
  const before = JSON.stringify(st.seats[0].hand);
  check("the wrong number of cards is refused", !C.act(st, 0, { t: "discard", cards: [a[0]] }, rng).ok
    && !C.act(st, 0, { t: "discard", cards: [a[0], a[0]] }, rng).ok && JSON.stringify(st.seats[0].hand) === before);
  const r = C.act(st, 0, { t: "discard", cards: a }, rng);
  check("two cards leave the hand and go face down into the crib", r.ok && st.seats[0].hand.length === 4
    && st.crib.length === 2 && st.phase === "discard" && st.turn === 1);
  check("the public event does not name the discarded cards", !JSON.stringify(r.events).includes('"' + a[0] + '"')
    && r.events[0].e === "discarded" && r.events[0].count === 2);
  check("the pass is refused by the wrong seat", !C.act(st, 0, { t: "discard", cards: st.seats[0].hand.slice(0, 2) }, rng).ok);
  const b = st.seats[1].hand.slice(0, 2);
  const r2 = C.act(st, 1, { t: "discard", cards: b }, rng);
  check("after both discards the starter is cut and pegging begins", r2.ok && st.crib.length === 4
    && C.isCard(st.starter) && st.deck.length === 39 && st.phase === "pegging" && st.turn === st.leader);
  check("the cut is public and the table is intact", r2.events.some((e) => e.e === "cut" && e.card === st.starter) && intact(st));
  const v = C.view(st, 1);
  check("the starter and the pegging line are public; both hands stay hidden",
    v.starter === st.starter && v.pegging.line.length === 0 && v.seats[1].hand.length === 4 && v.seats[0].hand === undefined);
}
{
  // A Jack cut gives the dealer two for his heels.
  const st = game(81);
  const jack = ["JS", "JH", "JC", "JD"].find((j) => !st.seats.some((s) => s.hand.includes(j)));
  st.deck[st.deck.length - 1] = jack;
  const before = st.seats[st.dealer].score;
  C.act(st, 0, { t: "discard", cards: st.seats[0].hand.slice(0, 2) }, rng);
  const r = C.act(st, 1, { t: "discard", cards: st.seats[1].hand.slice(0, 2) }, rng);
  check("a Jack cut scores the dealer 2 for his heels", st.starter === jack && st.heels === true
    && st.seats[st.dealer].score === before + 2 && r.events.some((e) => e.e === "heels" && e.seat === st.dealer));
}
// --- pegging points
{
  check("15 scores 2, a pair 2, three of a kind 6", C.pegScore([{ card: "5H" }, { card: "10S" }], 15).points === 2
    && C.pegScore([{ card: "4H" }, { card: "4S" }], 8).pairs === 2
    && C.pegScore([{ card: "4H" }, { card: "4S" }, { card: "4D" }], 12).pairs === 6);
  check("runs need three and can be played out of order", C.pegScore([{ card: "3H" }, { card: "5S" }, { card: "4D" }], 12).runs === 3
    && C.pegScore([{ card: "3H" }, { card: "4S" }, { card: "5D" }, { card: "6C" }], 18).runs === 4
    && !C.pegScore([{ card: "3H" }, { card: "4S" }], 7).runs);
  check("a duplicate rank breaks a pegging run, and a five-card run scores 5",
    C.pegScore([{ card: "3H" }, { card: "4S" }, { card: "4D" }, { card: "5C" }], 16).runs === 0
    && C.pegScore([{ card: "4H" }, { card: "2S" }, { card: "6D" }, { card: "5C" }, { card: "3H" }], 20).runs === 5
    && C.pegScore([{ card: "4H" }, { card: "2S" }, { card: "3D" }, { card: "4C" }, { card: "3H" }], 16).runs === 0);
}
{
  const st = rig(9);
  st.seats[0].hand = ["5H", "4S", "KD"];
  st.seats[1].hand = ["10H", "2D", "3C"];
  st.pegging.count = 10;
  st.pegging.line = [{ seat: 1, card: "5S" }];
  st.pegging.last = { seat: 1, card: "5S" };
  const r = C.act(st, 0, { t: "play", card: "5H" }, rng);
  check("a played card scores 15 and a pair immediately", r.ok && st.seats[0].score === 4
    && r.events.some((e) => e.e === "peg" && e.points === 4) && st.pegging.count === 15 && st.turn === 1);
}
{
  const st = rig(10);
  st.seats[0].hand = ["AH"];
  st.seats[1].hand = ["2D", "3C"];
  st.pegging.count = 30;
  st.pegging.line = [{ seat: 1, card: "5S" }];
  st.pegging.last = { seat: 1, card: "5S" };
  const r = C.act(st, 0, { t: "play", card: "AH" }, rng);
  check("31 scores 2 and resets the count, with the other player leading", r.ok && st.seats[0].score === 2
    && st.pegging.count === 0 && st.pegging.line.length === 0 && st.turn === 1);
}
{
  const st = rig(11);
  st.seats[0].hand = ["10H"];
  st.seats[1].hand = ["10D"];
  st.pegging.count = 25;
  st.pegging.line = [{ seat: 1, card: "5S" }];
  st.pegging.last = { seat: 1, card: "5S" };
  const r = C.act(st, 0, { t: "go" }, rng);
  check("go scores the last card 1 when neither player can continue", r.ok && st.seats[1].score === 1
    && st.pegging.count === 0 && st.turn === 0 && st.pegging.go.join() === "false,false");
  const bad = rig(12);
  bad.seats[0].hand = ["10H"];
  bad.seats[1].hand = ["10D"];
  bad.pegging.count = 25;
  check("a card that would pass 31 is not in the legal plays", C.legalPlays(bad, 0).length === 0);
}
// --- hand and crib scoring
{
  const a = C.scoreCards(["5H", "5C", "5D", "JD"], "5S", false);
  check("four fives and a Jack score 28 before nobs", a.fifteens === 16 && a.pairs === 12 && a.total === 28);
  const b = C.scoreCards(["5H", "5C", "5D", "JS"], "5S", false);
  check("the right Jack gives the 29 hand", b.nobs === 1 && b.total === 29);
  const c = C.scoreCards(["3H", "4C", "4D", "5S"], "6H", false);
  check("runs count with a pair: a double run of four is 8 plus the pair and two fifteens", c.fifteens === 4
    && c.pairs === 2 && c.runs === 8 && c.total === 14);
  const d = C.scoreCards(["2H", "4H", "6H", "8H"], "10H", false);
  check("four in hand and the starter make a five-card flush", d.flush === 5 && d.total === 5);
  const e = C.scoreCards(["2H", "4H", "6H", "8H"], "10S", false);
  check("four in hand without the starter scores a four-card flush", e.flush === 4);
  const f = C.scoreCards(["2H", "4H", "6H", "8H"], "10S", true);
  const g = C.scoreCards(["2H", "4H", "6H", "8H"], "10H", true);
  check("the crib only flushes with all five cards", f.flush === 0 && g.flush === 5);
  const h = C.scoreCards(["JS", "2H", "9C", "KD"], "8S", false);
  check("nobs is the Jack of the starter's suit only", h.nobs === 1 && h.total === 1
    && C.scoreCards(["JD", "2H", "9C", "KS"], "8S", false).nobs === 0);
}
{
  const st = game(14);
  st.phase = "scoring";
  st.starter = "5S";
  st.crib = ["5H", "5C", "5D", "JS"];
  st.seats[0].hand = ["2H", "4C", "6D", "8S"];
  st.seats[1].hand = ["3H", "3C", "7D", "9S"];
  st.dealer = 1;
  st.reveal = C.computeReveal(st);
  check("the hands and the crib are counted with the starter, and the crib belongs to the dealer",
    st.reveal.hands.length === 2 && st.reveal.crib.owner === 1 && st.reveal.crib.total === 29
    && st.reveal.handGain[1] >= st.reveal.crib.total);
  const v = C.view(st, 0);
  check("at the count both hands and the crib are revealed", v.seats[0].hand.length === 4
    && v.seats[1].hand.length === 4 && Array.isArray(v.crib) && v.crib.length === 4);
  check("only the scoring seat can add the count", !C.act(st, 1, { t: "score" }, rng).ok);
  const r = C.act(st, 0, { t: "score" }, rng);
  check("the hand points are added once and the next deal is ready", r.ok && st.reveal.applied
    && st.phase === "round_over" && st.seats[0].score === st.reveal.hands[0].total
    && !C.act(st, 0, { t: "score" }, rng).ok);
}
// --- 121 wins
{
  const st = rig(15);
  st.seats[0].score = 119;
  st.seats[0].hand = ["5H"];
  st.seats[1].hand = ["2D"];
  st.pegging.count = 10;
  st.pegging.line = [{ seat: 1, card: "6S" }];
  st.pegging.last = { seat: 1, card: "6S" };
  const r = C.act(st, 0, { t: "play", card: "5H" }, rng);
  check("the first player to 121 wins at once", r.ok && st.phase === "game_over" && st.winner === 0
    && st.seats[0].score === 121 && r.events.some((e) => e.e === "win" && e.seat === 0));
  check("the winning view names the winner and no next deal is offered", C.view(st, 0).winner === 0 && C.nextRound(st, rng) === false);
}
{
  // The show is counted non-dealer hand, dealer hand, crib. The first to 121
  // wins there, so the dealer's later points are not counted.
  const st = game(16);
  st.phase = "scoring"; st.turn = 0; st.dealer = 1;
  st.seats[0].score = 110; st.seats[1].score = 100;
  st.seats[0].hand = ["2H", "3C", "4D", "5S"];
  st.seats[1].hand = ["6H", "7C", "8D", "9S"];
  st.crib = ["10H", "10C", "10D", "10S"];
  st.starter = "JC";
  st.reveal = C.computeReveal(st);
  st.reveal.hands[0].total = 11;
  st.reveal.hands[1].total = 30;
  st.reveal.crib.total = 30;
  const r = C.act(st, 0, { t: "score" }, rng);
  check("the first player to 121 in the show wins at that stage", r.ok && st.phase === "game_over"
    && st.winner === 0 && st.seats[0].score === 121 && st.seats[1].score === 100);
}
// --- a whole game by computer players, every level
function botGame(level, seed) {
  const r = mulberry(seed);
  const st = C.create({ names: ["A", "B"], bots: [level, level] }, r);
  let guard = 0, rounds = 0;
  while (st.phase !== "game_over" && guard++ < 20000) {
    if (st.phase === "round_over") {
      const winner = st.dealWinner;
      const dealer = st.dealer;
      if (!C.nextRound(st, r)) throw new Error("nextRound refused");
      rounds++;
      if (st.leader !== winner) throw new Error("the deal winner did not lead");
      if (st.dealer !== 1 - dealer) throw new Error("the dealer did not alternate");
      continue;
    }
    const seat = st.turn;
    const a = C.botAct(st, seat, level, r);
    if (!a) throw new Error("the computer offered no action in " + st.phase);
    let res = C.act(st, seat, a, r);
    if (!res.ok) res = C.act(st, seat, C.fallback(st, seat), r);
    if (!res.ok) throw new Error("a legal move was refused: " + JSON.stringify(res) + " action " + JSON.stringify(a));
    if (!intact(st)) throw new Error("a card went missing after " + JSON.stringify(a));
    if (st.phase !== "game_over" && st.phase !== "round_over" && (st.turn !== 0 && st.turn !== 1)) throw new Error("bad turn");
  }
  return { st, guard, rounds };
}
for (const level of ["easy", "medium", "hard"]) {
  const { st, guard, rounds } = botGame(level, 7);
  check(`${level}: a whole game finishes in ${rounds} deals (${guard} loops)`, st.phase === "game_over" && st.winner !== null);
  check(`${level}: the winner is first to 121 (ties to the earlier seat)`, st.seats[st.winner].score >= C.TARGET
    && st.seats.every((s, i) => i === st.winner || s.score <= st.seats[st.winner].score));
  check(`${level}: the table still holds 52 different cards`, intact(st));
}
// --- through a real room: two people, a fake clock, and a rematch
{
  check("the protocol registers cribbage (the test injects it when needed)", P.CARD_GAMES.includes("cribbage"));
  const room = P.newRoom("CRB234", T0, "cribbage");
  check("a cribbage room exists", !!room && room.game === "cribbage");
  const a = P.join(room, null, "Alice", mint, T0, rng), b = P.join(room, null, "Bob", mint, T0, rng);
  check("two people fill both seats and start by themselves", room.phase === "playing"
    && room.table.length === 2 && room.table.every((s) => s.kind === "human") && room.state.seats.length === 2);
  const va = P.viewFor(room, a.pid, T0).table, vb = P.viewFor(room, b.pid, T0).table;
  check("each person is sent only their own six cards", va.seats[0].hand.length === 6 && va.seats[1].hand === undefined
    && vb.seats[1].hand.length === 6 && vb.seats[0].hand === undefined);
  check("the crib is face down and the starter is not cut yet", va.crib === undefined && va.starter === null && va.cribCount === 0);
  check("the host cannot change the settings once the table has started", P.setConfig(room, a.pid, { bots: 0 }, T0, rng).ok === false);

  let now = T0, guard = 0;
  while (room.phase !== "game_over" && guard++ < 100000) {
    if (room.phase === "playing" && room.state) {
      const st = room.state;
      const seat = st.turn;
      const t = room.table[seat];
      const person = t && t.kind === "human" ? room.players.find((x) => x.pid === t.pid) : null;
      if (person && !person.autoBot) {
        const action = C.botAct(st, seat, "hard", rng);
        const res = P.act(room, person.pid, action, now, rng);
        if (!res.ok) throw new Error("a legal move was refused in the room: " + JSON.stringify(res) + " " + JSON.stringify(action) + " phase " + st.phase);
        now += 300;
        continue;
      }
    }
    now = Math.max(now + 200, Math.min(P.nextWake(room, now), now + 4000));
    P.tick(room, now, rng);
  }
  check("a whole room game finishes through the protocol", room.phase === "game_over"
    && room.state.phase === "game_over" && room.state.winner !== null, room.phase + " guard=" + guard);
  check("the room announces the result", room.lastEvents.some((e) => e.e === "win")
    && room.state.seats[room.state.winner].score >= C.TARGET);
  const winner = room.state.winner;
  const endA = P.viewFor(room, a.pid, now), endB = P.viewFor(room, b.pid, now);
  check("the room view shows each person the same final scores and winner", endA.table.scores.join() === endB.table.scores.join()
    && endA.table.winner === endB.table.winner && endA.table.scores[winner] >= C.TARGET);
  check("a rematch waits for both votes", P.vote(room, a.pid, now, rng).started === false);
  const re = P.vote(room, b.pid, now, rng);
  check("when both vote a fresh game starts, the winner leading", re.started && room.phase === "playing"
    && room.state.leader === winner && room.state.dealer === 0 && room.state.moves === 0
    && room.state.seats.every((s) => s.score === 0));
}
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
