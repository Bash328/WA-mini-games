/* Run: node worker/hearts.test.mjs   (Hearts rules, the computer, and a whole room with a fake clock) */
import * as P from "./card-protocol.mjs";
import "../hearts/engine.js";
const H = globalThis.Hearts;

let pass = 0, fail = 0;
function check(name, ok, detail) { if (ok) pass++; else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? " — " + detail : "")); } }
function mulberry(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rng = mulberry(5);
let n = 0; const mint = () => "tok" + ++n;
const T0 = 1_000_000;

console.log("hearts:");
// --- the deal
{
  const st = H.create({ names: ["A", "B", "C", "D"] }, rng);
  const all = st.seats.flatMap((s) => s.hand);
  check("52 different cards, 13 each, sorted", all.length === 52 && new Set(all).size === 52 && st.seats.every((s) => s.hand.length === 13));
  check("it starts in the passing phase, round 1 passes left", st.phase === "pass" && st.passDir === "left");
  check("the pass rotation is left, right, across, hold", ["left", "right", "across", "hold"].every((d, i) => H.passDir(i + 1) === d) && H.passDir(5) === "left");
  check("passing left goes to the next seat, across two over", H.passTarget(0, "left") === 1 && H.passTarget(3, "left") === 0 && H.passTarget(0, "across") === 2 && H.passTarget(0, "right") === 3 && H.passTarget(0, "hold") === -1);
  check("a view shows only your own hand", H.view(st, 0).seats[0].hand.length === 13 && H.view(st, 0).seats[1].hand === undefined && H.view(st, null).seats.every((s) => s.hand === undefined));
  const v0 = H.view(st, 0);
  check("in the passing phase everyone still has to pass 3", v0.options.pass === 3 && !v0.options.plays.length);
}
// --- passing
{
  const st = H.create({ names: ["A", "B", "C", "D"], bots: [null, "easy", "easy", "easy"] }, rng);
  const mine = st.seats[0].hand.slice(0, 3);
  const r = H.act(st, 0, { t: "pass", cards: mine }, rng);
  check("a pass of 3 held cards is accepted and the computers hand theirs over at once", r.ok && st.passed.every((p) => p !== null));
  check("the cards actually moved one seat left", st.seats[1].hand.filter((c) => mine.includes(c)).length === 3 && !st.seats[0].hand.some((c) => mine.includes(c)));
  check("everyone still holds 13 and the 2♣ holder leads", st.phase === "play" && st.seats.every((s) => s.hand.length === 13) && st.turn === st.seats.findIndex((s) => s.hand.includes("2C")) && !st.seats[st.turn].hand.includes("2C") === false);
  check("after passing there is nothing left to pass", H.view(st, 1).options.pass === 0);
  check("passing twice is refused", !H.act(st, 0, { t: "pass", cards: st.seats[0].hand.slice(0, 3) }, rng).ok);
  check("cards you don't hold are refused", !H.act(st, 0, { t: "pass", cards: ["AS", "AS", "AS"] }, rng).ok);
  check("the wrong number is refused", !H.act(st, 0, { t: "pass", cards: ["AS", "KS"] }, rng).ok);
}
// --- the first trick
{
  const st = H.create({ names: ["A", "B", "C", "D"] }, rng);
  st.passed = [[], [], [], []];
  // hand-set a table: seat 0 holds the 2♣
  const deal = [["2C", "3C", "4C", "5C", "6C", "2S", "3S", "4S", "5S", "6S", "7S", "8S", "9S"],
                ["7C", "8C", "2D", "3D", "4D", "5D", "6D", "7D", "8D", "9D", "10D", "JD", "QD"],
                ["9C", "10C", "JC", "QC", "KC", "AC", "QS", "4S", "5S", "6S", "7S", "8S", "10S"],
                ["2H", "3H", "4H", "5H", "6H", "7H", "8H", "9H", "10H", "JH", "QH", "KH", "AH"]];
  st.seats.forEach((s, i) => { s.hand = deal[i].slice(); });
  st.phase = "play"; st.trickNo = 1; st.plays = []; st.turn = 0; st.passed = [null, null, null, null];
  st.passDir = "hold";
  const legal = H.legalPlays(st, 0);
  check("the 2♣ holder leads the first trick, with the 2♣", legal.length === 1 && legal[0] === "2C");
  H.act(st, 0, { t: "play", card: "2C" }, rng);
  check("the others must follow clubs and may not dump points on trick 1", H.legalPlays(st, 1).length === 2 && H.legalPlays(st, 1).every((c) => H.SUIT(c) === "C"), JSON.stringify(H.legalPlays(st, 1)));
  st.turn = 2;
  check("on the first trick the Q♠ may not be shed while clubs can be followed", !H.legalPlays(st, 2).includes("QS") && H.legalPlays(st, 2).every((c) => H.SUIT(c) === "C"));
  H.act(st, 2, { t: "play", card: "9C" }, rng);
  st.turn = 3;
  const heartsOnly = H.legalPlays(st, 3);
  check("hearts are allowed on trick 1 when you hold nothing else", heartsOnly.length === 13 && heartsOnly.every((c) => H.SUIT(c) === "H"));
}
// --- following suit, hearts, the moon
{
  const st = H.create({ names: ["A", "B", "C", "D"] }, rng);
  st.passed = [[], [], [], []]; st.phase = "play"; st.trickNo = 2; st.heartsBroken = false;
  st.seats.forEach((s, i) => { s.hand = [["AC"], ["KC"], ["2H"], ["3S"]][i]; });
  st.plays = []; st.turn = 0;
  check("a heart may not be led before they are broken", !H.legalPlays(st, 2).includes("2H"));
  H.act(st, 0, { t: "play", card: "AC" }, rng);
  st.turn = 1;
  check("you must follow suit if you can", H.legalPlays(st, 1).length === 1 && H.legalPlays(st, 1)[0] === "KC");
  st.turn = 3;
  const slough = H.legalPlays(st, 3);
  check("a void hand may slough anything once past trick 1", slough.length === 1 && slough[0] === "3S", JSON.stringify(slough));
}
{
  // a rigged last trick: seat 0 wins it and reaches 26
  const st = H.create({ names: ["A", "B", "C", "D"] }, rng);
  st.passed = [[], [], [], []]; st.phase = "play"; st.trickNo = 13; st.heartsBroken = true;
  st.seats.forEach((s, i) => { s.hand = [["AD"], ["2H"], ["4D"], ["3D"]][i]; });
  st.roundPts = [25, 0, 0, 0];
  st.plays = []; st.turn = 3;
  H.act(st, 3, { t: "play", card: "3D" }, rng);
  st.turn = 0; H.act(st, 0, { t: "play", card: "AD" }, rng);
  st.turn = 1; H.act(st, 1, { t: "play", card: "2H" }, rng);
  const r = H.act(st, 2, { t: "play", card: "4D" }, rng);
  check("taking all 26 shoots the moon: the shooter gets 0, the others 26", r.ok && st.reveal && st.reveal.shot === 0 && st.reveal.gained.join() === "0,26,26,26", JSON.stringify(st.reveal));
  check("a score under 100 means another hand", st.phase === "round_over");
  H.nextRound(st, rng);
  check("the next hand deals fresh and passes right", st.phase === "pass" && st.round === 2 && st.passDir === "right" && st.seats.every((s) => s.hand.length === 13));
}
// --- whole games by computer players
function botGame(level, seed) {
  const r = mulberry(seed);
  const st = H.create({ names: ["A", "B", "C", "D"], bots: [level, level, level, level] }, r);
  let guard = 0, rounds = 0;
  while (st.phase !== "game_over" && guard++ < 30000) {
    if (st.phase === "round_over") { H.nextRound(st, r); rounds++; continue; }
    const who = st.phase === "pass" ? 0 : st.turn;      // one call lets the engine fill every pass
    const a = H.botAct(st, who, level, r);
    let res = H.act(st, who, a, r);
    if (!res.ok) res = H.act(st, who, H.fallback(st, who), r);
    if (!res.ok) throw new Error("a legal move was refused: " + JSON.stringify(res) + " action " + JSON.stringify(a));
  }
  return { st, guard, rounds };
}
for (const level of ["easy", "medium", "hard"]) {
  const { st, guard, rounds } = botGame(level, 7);
  check(`${level}: a whole game finishes in ${rounds} hands`, st.phase === "game_over" && st.winner !== null && st.seats.some((s) => s.score >= 100));
  const best = Math.min(...st.seats.map((s) => s.score));
  check(`${level}: the lowest score wins (ties to the earlier seat)`, st.seats[st.winner].score === best && st.seats.findIndex((s) => s.score === best) === st.winner);
  const total = st.seats.reduce((x, s) => x + s.score, 0);
  check(`${level}: every point dealt was scored (moons swap but never vanish)`, total % 26 === 0, total);
}
// --- through a real room: two people, the table tops up to four
{
  const room = P.newRoom("HRTS42", T0, "hearts");
  check("a hearts room exists", !!room && room.game === "hearts");
  const a = P.join(room, null, "Alice", mint, T0, rng), b = P.join(room, null, "Bob", mint, T0, rng);
  P.setConfig(room, a.pid, { bots: 0 }, T0, rng);
  check("two people can start: the table fills with two computers", P.start(room, a.pid, T0, rng).ok && room.table.length === 4 && room.table.filter((s) => s.kind === "bot").length === 2);
  let now = T0, guard = 0;
  while (room.phase !== "game_over" && guard++ < 400000) {
    if (room.phase === "playing" && room.state.phase === "pass") {
      // people hand over their 3 worst cards through the protocol
      room.table.forEach((t, seat) => {
        if (t.kind !== "human") return;
        const p = room.players.find((x) => x.pid === t.pid && !x.autoBot);
        if (!p) return;
        const v = H.view(room.state, seat);
        if (v.options.pass > 0) {
          const worst = v.seats[seat].hand.filter((c) => H.SUIT(c) === "H").slice(0, 3);
          while (worst.length < 3) worst.push(v.seats[seat].hand.find((c) => !worst.includes(c)));
          const r = P.act(room, p.pid, { t: "pass", cards: worst.slice(0, 3) }, now, rng);
          if (!r.ok) throw new Error("a pass was refused: " + JSON.stringify(r));
        }
      });
      now += 300;
      P.tick(room, now, rng);
      continue;
    }
    const seat = room.state.turn, t = room.table[seat];
    if (room.phase === "playing" && t && t.kind === "human" && !room.players.find((p) => p.pid === t.pid).autoBot) {
      const r = P.act(room, t.pid, H.botAct(room.state, seat, "medium", rng), now, rng);
      if (!r.ok) throw new Error("a legal move was refused in the room: " + JSON.stringify(r));
      now += 300;
    } else {
      now = Math.max(now + 200, Math.min(P.nextWake(room, now), now + 3000));
      P.tick(room, now, rng);
    }
  }
  check("a whole room game finishes through the protocol", room.phase === "game_over" && room.state.winner !== null, room.phase + " guard=" + guard);
}
// --- both people drop out while the cards are being passed
{
  const room = P.newRoom("HRTSP", T0, "hearts");
  const a = P.join(room, null, "Alice", mint, T0, rng), b = P.join(room, null, "Bob", mint, T0, rng);
  P.setConfig(room, a.pid, { bots: 0 }, T0, rng);
  P.start(room, a.pid, T0, rng);
  check("the pass is waiting for the people", room.state.phase === "pass" && room.state.passed.every((p) => p === null));
  P.setOnline(room, a.pid, false, T0);
  P.setOnline(room, b.pid, false, T0);
  const notices = P.tick(room, T0 + P.OFFLINE_TAKEOVER_MS + 1000, rng).notices;
  check("after the takeover a computer passes for each absent seat, and the hand starts",
    room.state.phase === "play" && room.state.passed.every((p) => p !== null), JSON.stringify(room.state.passed));
  check("the people are told a computer took over", notices.some((n) => /computer is playing/.test(n)), JSON.stringify(notices));
}
// --- somebody online but never passing is passed for after the idle limit
{
  const room = P.newRoom("HRTSQ", T0, "hearts");
  const a = P.join(room, null, "Alice", mint, T0, rng), b = P.join(room, null, "Bob", mint, T0, rng);
  P.setConfig(room, a.pid, { bots: 0 }, T0, rng);
  P.start(room, a.pid, T0, rng);
  P.tick(room, T0 + P.IDLE_TURN_MS + 1000, rng);
  check("an online person who never passes is passed for, and the hand starts",
    room.state.phase === "play" && room.state.passed.every((p) => p !== null), JSON.stringify(room.state.passed));
}
// --- an unpassed person in the pass phase gets an alarm of their own
{
  const room = P.newRoom("HRTSR", T0, "hearts");
  const a = P.join(room, null, "Alice", mint, T0, rng), b = P.join(room, null, "Bob", mint, T0, rng);
  P.setConfig(room, a.pid, { bots: 0 }, T0, rng);
  P.start(room, a.pid, T0, rng);
  room.state.passed = [["AS", "KS", "QS"], null, [], []];
  room.turnSince = T0; room.nextAt = null;
  const wake = P.nextWake(room, T0 + 1000);
  check("the idle pass gets its own alarm, not the 24h room expiry", wake <= T0 + P.IDLE_TURN_MS + 1, wake - T0);
}
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
