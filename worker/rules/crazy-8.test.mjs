/* Run: node worker/rules/crazy-8.test.mjs
   The Crazy 8 engine: every house rule on a constructed table, then thousands of
   random and computer-played games checking that cards are never lost or duplicated. */
import "../../crazy-8/engine.js";
const C = globalThis.Crazy8;

let pass = 0, fail = 0;
function check(name, ok, detail) { if (ok) pass++; else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? " — " + detail : "")); } }
function mulberry(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rng = mulberry(12345);

// a table with exactly the hands and top card we ask for (the rest of the deck is the draw pile)
function table(n, hands, top, over = {}) {
  const st = C.create({ names: ["A", "B", "C", "D"].slice(0, n), mode: over.mode || "normal", starter: 0 }, mulberry(1));
  const all = C.makeDeck();
  const used = new Set([top, ...hands.flat()]);
  st.seats.forEach((s, i) => { s.hand = (hands[i] || []).slice(); s.status = "in"; });
  st.discard = [top];
  st.draw = C.shuffle(all.filter((c) => !used.has(c)), mulberry(7));
  st.turn = 0; st.dir = 1; st.pending = 0; st.drawn = null; st.phase = "play"; st.finished = []; st.eliminated = null; st.winner = null;
  const r = C.rankOf(top), s = C.suitOf(top);
  st.cons = over.cons || (r === "X" ? { any: true } : { suit: s, rank: r });
  return st;
}
const play = (st, seat, card, extra = {}) => C.act(st, seat, { t: "play", card, last: true, ...extra }, rng);
const total = (st) => st.seats.reduce((n, s) => n + s.hand.length, 0) + st.draw.length + st.discard.length;

console.log("crazy 8:");
// --- the deck
{
  const d = C.makeDeck();
  check("54 cards, all different", d.length === 54 && new Set(d).size === 54);
  check("two jokers", d.filter(C.isJoker).length === 2);
  const st = C.create({ names: ["A", "B", "C"], mode: "normal" }, mulberry(3));
  check("every seat is dealt 8 cards", st.seats.every((s) => s.hand.length === 8));
  check("a start card is turned up", st.discard.length === 1 && total(st) === 54);
}

// --- matching
{
  const st = table(2, [["5H", "9S", "KD", "8S", "8H", "X1", "AC"], ["3C"]], "7H");
  const ok = C.legalPlays(st, 0);
  check("same suit or same rank", ok.includes("5H") && !ok.includes("9S") && !ok.includes("KD"));
  check("an 8 goes on its own suit", ok.includes("8H") && !ok.includes("8S"));
  check("a joker goes on anything", ok.includes("X1"));
  check("an Ace needs a match when nothing is pending", !ok.includes("AC"));
  const st2 = table(2, [["8S", "5H"], ["3C", "9D"]], "8H");
  check("an 8 can go on another 8", C.legalPlays(st2, 0).includes("8S"));
  check("playing an 8 needs a named suit", C.act(st2, 0, { t: "play", card: "8S" }, rng).error === "name-a-suit");
  const r = play(st2, 0, "8S", { suit: "D" });
  check("an 8 sets the suit the next player must follow", r.ok && st2.cons.suit === "D" && C.legalPlays(st2, 1).includes("9D") && !C.legalPlays(st2, 1).includes("3C"));
}

// --- 2s, jokers, chains, the Ace
{
  const st = table(3, [["2H", "5S"], ["2D", "X1", "4C"], ["AS", "6H", "6D"]], "7H");
  check("a 2 sets a pick-up of 2", play(st, 0, "2H").ok && st.pending === 2 && st.turn === 1);
  check("only 2s, jokers and Aces answer a pick-up", JSON.stringify(C.legalPlays(st, 1).sort()) === JSON.stringify(["2D", "X1"].sort()));
  check("a 2 chains onto a 2 (any suit): total 4", play(st, 1, "2D").ok && st.pending === 4 && st.turn === 2);
  check("only the Ace (or a pick-up) is left for player 3", JSON.stringify(C.legalPlays(st, 2)) === JSON.stringify(["AS"]));
  const hand0 = st.seats[2].hand.length;
  const r = play(st, 2, "AS");
  check("an Ace blocks the whole pile", r.ok && st.pending === 0 && st.seats[2].hand.length === hand0 - 1 && r.events.some((e) => e.e === "blocked" && e.total === 4));
  check("after an Ace the next player can play any card", st.cons.any === true && C.legalPlays(st, 0).length === st.seats[0].hand.length);
}
{
  const st = table(3, [["2H", "5S"], ["X1", "4C"], ["6H", "6D"]], "7H");
  play(st, 0, "2H"); play(st, 1, "X1");
  check("a joker adds 5 to the pile: 2 + 5 = 7", st.pending === 7);
  const n = st.seats[2].hand.length;
  const r = C.act(st, 2, { t: "draw" }, rng);
  check("whoever cannot chain picks up the whole total and their turn ends", r.ok && st.seats[2].hand.length === n + 7 && st.pending === 0 && st.turn === 0);
  check("after a joker the next player can play any card", st.cons.any === true);
}
{
  const st = table(2, [["8H", "JH", "7H", "5D", "2C"], ["3C"]], "2S");
  st.pending = 2; st.turn = 0; st.cons = { suit: "S", rank: "2" };
  check("8, J and 7 cannot dodge a pick-up", JSON.stringify(C.legalPlays(st, 0)) === JSON.stringify(["2C"]));
  check("an 8 cannot be played into a pending pick-up", C.act(st, 0, { t: "play", card: "8H", suit: "S" }, rng).error === "illegal");
}

// --- J and 7
{
  const st = table(4, [["JH", "5H"], ["3C"], ["4C"], ["5C"]], "7H");
  play(st, 0, "JH");
  check("a jack skips the next player (4 players)", st.turn === 2);
  const st2 = table(2, [["JH", "5H"], ["3C"]], "7H");
  play(st2, 0, "JH");
  check("with two players a jack means you play again", st2.turn === 0);
  const st3 = table(4, [["7D", "5H"], ["3C"], ["4C"], ["5C"]], "7H");
  play(st3, 0, "7D");
  check("a 7 reverses direction (4 players): the player behind goes next", st3.dir === -1 && st3.turn === 3);
  const st4 = table(2, [["7D", "5H"], ["3C"]], "7H");
  play(st4, 0, "7D");
  check("with two players a 7 means you play again", st4.turn === 0);
}

// --- last card
{
  const st = table(2, [["5H", "9H"], ["3C"]], "7H");
  const r = C.act(st, 0, { t: "play", card: "5H" }, rng);
  check("going down to one card without calling costs 2 cards", r.ok && st.seats[0].hand.length === 3 && r.events.some((e) => e.e === "last-missed"));
  const st2 = table(2, [["5H", "9H"], ["3C"]], "7H");
  C.act(st2, 0, { t: "play", card: "5H", last: true }, rng);
  check("calling it first costs nothing", st2.seats[0].hand.length === 1);
}

// --- winning
{
  const st = table(3, [["2H"], ["3C"], ["4C"]], "7H");
  const r = play(st, 0, "2H");
  check("you can win on a special card (normal mode ends at once)", r.ok && st.phase === "game_over" && st.winner === 0);
}

// --- picking up on purpose
{
  const st = table(2, [["5H", "9S"], ["3C"]], "7H");
  const before = st.seats[0].hand.length;
  C.act(st, 0, { t: "draw" }, rng);
  check("you may pick up one card even holding a legal card", st.seats[0].hand.length === before + 1);
  if (st.drawn) {
    check("a drawn card that fits may be played, or kept with a pass", C.legalPlays(st, 0).length === 1 && C.act(st, 0, { t: "pass" }, rng).ok && st.turn === 1);
  } else check("an unplayable drawn card ends the turn", st.turn === 1);
  const st2 = table(2, [["9S"], ["3C"]], "7H");
  st2.draw = ["4D", "6D"];
  const r = C.act(st2, 0, { t: "draw" }, rng);
  check("an unplayable card ends the turn", r.ok && st2.drawn === null && st2.turn === 1);
  const st3 = table(2, [["9S"], ["3C"]], "7H");
  st3.draw = ["4D", "5H"];                       // the top of the pile is the last element: 5H, which matches the heart
  C.act(st3, 0, { t: "draw" }, rng);
  check("a playable drawn card stays with its player", st3.drawn === "5H" && st3.turn === 0);
}

// --- running out of cards
{
  const st = table(2, [["9S"], ["3C"]], "7H");
  st.draw = []; st.discard = ["4D", "5D", "6D", "7H"];
  const before = total(st);
  const r = C.act(st, 0, { t: "draw" }, rng);
  check("an empty draw pile is made from the played cards (not the top one)", r.events.some((e) => e.e === "reshuffle") && st.discard.length === 1 && st.discard[0] === "7H" && total(st) === before);
}

// --- the flipped start card
{
  const seen = {};
  for (let seed = 1; seed < 4000; seed++) {
    const st = C.create({ names: ["A", "B", "C"], mode: "normal", starter: 0 }, mulberry(seed));
    const c = st.discard[0], r = C.rankOf(c);
    if (!["2", "X", "J", "7", "A", "8"].includes(r) || seen[r] > 3) continue;
    seen[r] = (seen[r] || 0) + 1;
    const ok = (r === "2" && st.pending === 2 && st.turn === 0) || (r === "X" && st.pending === 5 && st.turn === 0 && st.cons.any)
      || (r === "J" && st.pending === 0 && st.turn === 1) || (r === "7" && st.dir === -1 && st.turn === 2)
      || ((r === "A" || r === "8") && st.cons.any && st.turn === 0);
    check("start card " + r + " takes effect on the first player", ok, JSON.stringify({ r, pending: st.pending, turn: st.turn, dir: st.dir }));
  }
  check("every kind of special start card was exercised", ["2", "X", "J", "7", "A", "8"].every((k) => seen[k]));
}

// --- tournament
{
  const st = table(3, [["2H"], ["3C", "4C"], ["5C", "6C", "9C"]], "7H", { mode: "tournament" });
  st.finished = [];
  play(st, 0, "2H");
  check("tournament: a player who empties their hand is safe, the round goes on", st.seats[0].status === "safe" && st.phase === "play" && st.pending === 2);
  check("tournament: the pick-up still reaches the next player", st.turn === 1);
  C.act(st, 1, { t: "draw" }, rng);                         // 4C... picks up 2
  // make player B go out next
  st.seats[1].hand = ["3H"]; st.turn = 1; st.pending = 0; st.cons = { suit: "H", rank: "3" };
  play(st, 1, "3H");
  check("tournament: when one player still holds cards they are out", st.seats[2].status === "out" && st.phase === "game_over" ? false : st.seats[2].status === "out");
  check("tournament: the round is over and the others return", st.phase === "round_over" || st.phase === "game_over");
  if (st.phase === "round_over") {
    C.nextRound(st, rng);
    check("tournament: next round is dealt only to those still in", st.seats[2].hand.length === 8 ? false : st.seats[0].hand.length === 8 && st.seats[1].hand.length === 8 && st.seats[2].status === "out" && st.starter === 0);
  }
}
{
  const st = table(2, [["2H"], ["3C", "4C"]], "7H", { mode: "tournament" });
  play(st, 0, "2H");
  check("tournament: a two-player final ends the game", st.phase === "game_over" && st.winner === 0 && st.seats[1].status === "out");
}

// --- the view hides other hands
{
  const st = table(3, [["5H", "9S"], ["3C", "4C"], ["6C"]], "7H");
  const v = C.view(st, 1);
  check("a player sees only their own cards", v.seats[1].hand.length === 2 && v.seats[0].hand === undefined && v.seats[2].hand === undefined && v.seats[0].count === 2);
  check("the draw pile's order is never sent", v.draw === undefined && v.drawCount === st.draw.length);
  check("a spectator sees no hands", C.view(st, null).seats.every((s) => s.hand === undefined));
}

// --- illegal actions change nothing
{
  let bad = 0;
  for (let g = 0; g < 200; g++) {
    const r2 = mulberry(g + 99);
    const st = C.create({ names: ["A", "B", "C", "D"], mode: g % 2 ? "tournament" : "normal" }, r2);
    for (let k = 0; k < 40 && st.phase === "play"; k++) {
      const seat = st.turn;
      const snap = JSON.stringify(st);
      const junk = [{ t: "play", card: "ZZ" }, { t: "play", card: "5H" }, { t: "pass" }, { t: "play", card: "8S" }, { t: "nope" }, null, { t: "draw" }, { t: "draw" }][Math.floor(r2() * 8)];
      const other = (seat + 1) % 4;
      const before = JSON.stringify(st);
      const wrongSeat = C.act(st, other, { t: "draw" }, r2);
      if (wrongSeat.ok || JSON.stringify(st) !== before) bad++;
      const res = C.act(st, seat, junk, r2);
      if (!res.ok && JSON.stringify(st) !== snap) bad++;
      if (res.ok) continue;
      const b = C.botAct(st, seat, "medium", r2);
      C.act(st, seat, b, r2);
    }
  }
  check("rejected actions never change the table", bad === 0, bad);
}

// --- thousands of computer games: nothing lost, nothing duplicated, everything finishes
{
  let games = 0, finished = 0, worst = 0, moves = 0, wins = [0, 0, 0, 0], rounds = 0, problems = 0;
  for (const mode of ["normal", "tournament"]) for (const level of ["easy", "medium", "hard"]) for (let n = 2; n <= 4; n++) for (let g = 0; g < 40; g++) {
    const r2 = mulberry(g * 1000 + n * 17 + level.length);
    const st = C.create({ names: ["A", "B", "C", "D"].slice(0, n), bots: Array(n).fill(level), mode }, r2);
    games++;
    let guard = 0, k = 0;
    while (st.phase !== "game_over" && guard++ < 6000) {
      if (st.phase === "round_over") { C.nextRound(st, r2); rounds++; continue; }
      const seat = st.turn;
      // sometimes play from the legal list at random instead, so odd lines are exercised too
      let a = C.botAct(st, seat, level, r2);
      if (r2() < 0.15) { const lp = C.legalPlays(st, seat); a = lp.length && r2() < 0.8 ? { t: "play", card: lp[Math.floor(r2() * lp.length)], suit: "SHDC"[Math.floor(r2() * 4)], last: r2() < 0.7 } : (st.drawn ? { t: "pass" } : { t: "draw" }); }
      const res = C.act(st, seat, a, r2);
      if (!res.ok) { problems++; if (problems < 4) console.log("   bot action rejected:", JSON.stringify(a), res.error, JSON.stringify(C.view(st, seat).options)); break; }
      k++;
      const cards = st.seats.flatMap((s) => s.hand).concat(st.draw, st.discard);
      if (cards.length !== 54 || new Set(cards).size !== 54) { problems++; console.log("   cards lost or duplicated"); break; }
    }
    if (st.phase === "game_over") { finished++; wins[st.winner]++; worst = Math.max(worst, k); moves += k; }
  }
  check("a computer's action is always legal", problems === 0, problems);
  check("every computer game finished (normal and tournament, 2-4 players)", finished === games, finished + "/" + games);
  console.log("   " + games + " games, " + moves + " moves (longest " + worst + "), " + rounds + " tournament rounds; winners by seat " + wins.join("/"));
}

// --- the hard computer beats the easy one
{
  let hardWins = 0, games = 200;
  for (let g = 0; g < games; g++) {
    const r2 = mulberry(g + 5000);
    const st = C.create({ names: ["E", "H"], bots: ["easy", "hard"], mode: "normal", starter: g % 2 }, r2);
    let guard = 0;
    while (st.phase === "play" && guard++ < 3000) C.act(st, st.turn, C.botAct(st, st.turn, st.seats[st.turn].bot, r2), r2);
    if (st.winner === 1) hardWins++;
  }
  check("hard beats easy more often than not", hardWins > games * 0.5, hardWins + "/" + games);
  console.log("   hard won " + hardWins + " of " + games + " against easy");
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
