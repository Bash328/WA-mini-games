/* Run: node worker/rules/onitama.test.mjs  — random legal games through the real room protocol, and the computer */
import { newRoom, join, applyMove } from "../live-protocol.mjs";
import "./onitama.mjs";

const R = globalThis.OnitamaRules;
let pass = 0, fail = 0;
function check(name, ok, detail) { if (ok) pass++; else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? " — " + detail : "")); } }
let n = 0;
const mint = () => "t" + ++n;
const rnd = (a) => a[Math.floor(Math.random() * a.length)];

console.log("onitama:");
// the deal is five different cards and a legal opening
const d = R.deal(Math.random);
check("a deal parses", R.parse(d) !== null);
const S0 = R.parse(d);
check("a deal has five different cards", new Set([...S0.h[0], ...S0.h[1], S0.s]).size === 5);
check("each side opens with at least one move", R.gen(S0, 1).length > 0 && R.gen(S0, 2).length > 0);

// a master on the other temple wins, a captured master wins
const put = (cells) => { const b = new Array(25).fill(0); for (const [i, c] of cells) b[i] = c; return b; };
const T = (b) => ({ b, h: [[1, 5], [2, 3]], s: 0 });          // Dragon/Elephant vs Frog/Rabbit, Tiger beside
check("P1 master on the top middle wins", R.winnerOf(T(put([[2, 2], [22, 4]])), 1) === 1);
check("P1 master on its own temple does not win", R.winnerOf(T(put([[22, 2], [2, 4]])), 1) === 0);
check("P2 master on the bottom middle wins", R.winnerOf(T(put([[22, 4], [2, 2]])), 2) === 2);
check("no P2 master: P1 wins", R.winnerOf(T(put([[12, 2], [0, 1]])), 1) === 1);
// a pawn can't land on its own pawn; a card is seen from your own side
const S1 = R.parse(R.str({ b: put([[22, 2], [17, 1], [2, 4]]), h: [[0, 13], [2, 3]], s: 1 }));   // Tiger, Boar
check("Tiger moves two forward for P1", R.gen(S1, 1).some((m) => m.from === 22 && m.card === 0 && m.to === 12));
check("a move onto your own pawn is not generated", !R.gen(S1, 1).some((m) => m.from === 22 && m.to === 17));
const S2 = { b: put([[2, 4], [22, 2]]), h: [[0, 13], [0 + 5, 6]], s: 1 };
check("Tiger moves two DOWN for P2", R.gen({ ...S2, h: [[13, 14], [0, 6]] }, 2).some((m) => m.from === 2 && m.card === 0 && m.to === 12));

// the cards turn over: used card goes beside the board, side card comes in
const S3 = R.parse(d), mv = R.gen(S3, 1)[0], A = R.play(S3, 1, mv);
check("the used card becomes the side card", A.s === mv.card);
check("the old side card joins the hand", A.h[0].includes(S3.s) && !A.h[0].includes(mv.card));

// random games through the real protocol
let finished = 0, p1 = 0, p2 = 0, passesSeen = 0;
for (let gI = 0; gI < 200; gI++) {
  const room = newRoom("onitama", "ABC234", 1000);
  join(room, null, mint, 1000); join(room, null, mint, 1000);
  let cur = R.parse(R.deal(Math.random)), player = 1, count = 0, done = false;
  for (let ply = 0; ply < 300 && !done; ply++) {
    let moves = R.gen(cur, player);
    if (!moves.length) { moves = R.passes(cur, player); passesSeen++; }
    const m = rnd(moves);
    const next = R.play(cur, player, m);
    const w = R.winnerOf(next, player);
    const state = {
      game: "onitama", version: 1, id: room.id, turn: w ? player : R.other(player), board: R.str(next),
      status: w ? "won" : "in_progress", winner: w || null, moveCount: ++count, last: m.from >= 0 ? m.to : 25,
    };
    const res = applyMove(room, player, { t: "move", n: room.state ? room.state.moveCount : 0, s: state }, 2000);
    // an illegal-looking opening only if the very first deal is not accepted
    if (res && res.ok === false) { check("a legal move is accepted (game " + gI + " ply " + ply + ")", false, JSON.stringify(res)); break; }
    cur = next; player = R.other(player);
    if (w) { done = true; finished++; if (w === 1) p1++; else p2++; }
  }
}
check("most random games finish", finished > 100, finished + " of 200");
check("both sides win some random games", p1 > 3 && p2 > 3, p1 + "/" + p2);

// the server refuses a cheat: a move with the wrong card
{
  const room = newRoom("onitama", "ABC234", 1000);
  join(room, null, mint, 1000); join(room, null, mint, 1000);
  const S = R.parse(R.deal(Math.random)), m = R.gen(S, 1)[0], A = R.play(S, 1, m);
  const bad = { ...A, s: (A.s + 1) % 16 };
  const res = applyMove(room, 1, { t: "move", n: 0, s: { game: "onitama", version: 1, id: room.id, turn: 2, board: R.str(bad), status: "in_progress", winner: null, moveCount: 1, last: m.to } }, 2000);
  check("a tampered card order is refused", res && res.ok === false, JSON.stringify(res));
}

// the computer: always a legal move, hard beats easy
for (const lvl of ["easy", "medium", "hard"]) {
  let ok = true;
  for (let g = 0; g < 8 && ok; g++) {
    let cur = R.parse(R.deal(Math.random)), p = 1;
    for (let ply = 0; ply < 60; ply++) {
      const s = R.str(cur), mv = R.bestMove(s, p, lvl, Math.random);
      const legal = R.gen(cur, p);
      const isPass = mv.from < 0;
      if (isPass ? legal.length > 0 : !legal.some((x) => x.from === mv.from && x.to === mv.to && x.card === mv.card)) { ok = false; break; }
      cur = R.play(cur, p, mv);
      if (R.winnerOf(cur, p)) break;
      p = R.other(p);
    }
  }
  check(lvl + " always plays a legal move", ok);
}
function match(a, b, games) {
  let wa = 0;
  for (let g = 0; g < games; g++) {
    let cur = R.parse(R.deal(Math.random));
    const lv = { 1: g % 2 ? b : a, 2: g % 2 ? a : b };
    let p = 1, winner = 0;
    for (let ply = 0; ply < 120 && !winner; ply++) {
      const mv = R.bestMove(R.str(cur), p, lv[p], Math.random);
      cur = R.play(cur, p, mv);
      winner = R.winnerOf(cur, p);
      p = R.other(p);
    }
    if (winner && lv[winner] === a) wa++;
  }
  return wa / games;
}
const t0 = Date.now();
const hardVsEasy = match("hard", "easy", 10);
check("hard beats easy most of the time", hardVsEasy >= 0.7, hardVsEasy);
console.log("  (hard vs easy " + hardVsEasy + ", " + (Date.now() - t0) + " ms)");

console.log(fail ? `\n${pass} passed, ${fail} FAILED` : `\n${pass} passed`);
process.exit(fail ? 1 : 0);
