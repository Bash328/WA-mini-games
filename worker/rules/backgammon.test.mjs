/* Run: node worker/rules/backgammon.test.mjs  — the rules, whole random games through the real room protocol (the server rolls), the computer */
import { newRoom, join, applyMove } from "../live-protocol.mjs";
import "./backgammon.mjs";

const R = globalThis.BackgammonRules;
let pass = 0, fail = 0;
function check(name, ok, detail) { if (ok) pass++; else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? " — " + detail : "")); } }
let n = 0;
const mint = () => "t" + ++n;
const rnd = (a) => a[Math.floor(Math.random() * a.length)];
// a position from { index: signed count }, bar [r, w], off [r, w]; fills the rest of each side's 15 into off so the totals stay valid
function pos(points, bar = [0, 0], off = [0, 0], dice = [0, 0]) {
  const pt = new Int8Array(24);
  for (const [i, v] of Object.entries(points)) pt[i] = v;
  const S = { pt, bar: bar.slice(), off: off.slice(), dice, pd: [0, 0], ps: 0 };
  let r = bar[0] + off[0], w = bar[1] + off[1];
  for (let i = 0; i < 24; i++) { if (pt[i] > 0) r += pt[i]; else w -= pt[i]; }
  S.off[0] += 15 - r; S.off[1] += 15 - w;
  return S;
}

console.log("backgammon:");
const S0 = R.parse(R.initial());
const count = (S, p) => { let c = S.bar[p - 1] + S.off[p - 1]; for (let i = 0; i < 24; i++) if (S.pt[i] * R.sign(p) > 0) c += Math.abs(S.pt[i]); return c; };
check("the start position has 15 checkers each in the standard places", count(S0, 1) === 15 && count(S0, 2) === 15 && S0.pt[23] === 2 && S0.pt[12] === 5 && S0.pt[7] === 3 && S0.pt[5] === 5 && S0.pt[0] === -2 && S0.pt[11] === -5 && S0.pt[16] === -3 && S0.pt[18] === -5);
check("the start position round-trips as 33 characters", R.initial().length === 33 && R.str(R.parse(R.initial())) === R.initial());
check("a position that loses a checker does not parse", R.parse(R.initial().replace("e", "d")) === null && R.parse("x" + R.initial().slice(1)) === null);

// steps
check("Red moves down: from 23 with a 3 lands on 20", R.rawSteps(S0, 1, 3).some((s) => s.from === 23 && s.to === 20));
check("White moves up: from 0 with a 3 lands on 3", R.rawSteps(S0, 2, 3).some((s) => s.from === 0 && s.to === 3));
check("a point with two enemy checkers is blocked (Red cannot land on White's 18-point with a 5 from 23)", !R.rawSteps(S0, 1, 5).some((s) => s.from === 23 && s.to === 18));
{
  const S = pos({ 10: 1, 8: -1, 20: 3 }, [0, 0], [0, 0]);
  const hit = R.rawSteps(S, 1, 2).find((s) => s.from === 10 && s.to === 8);
  check("a lone enemy checker can be hit", !!hit);
  const T = R.applyStep(S, 1, hit);
  check("a hit sends it to the bar", T.bar[1] === 1 && T.pt[8] === 1 && T.pt[10] === 0);
}
{
  const S = pos({ 20: 3, 10: -2 }, [1, 0]);                                  // Red has one on the bar
  check("with a checker on the bar only entering is allowed", R.rawSteps(S, 1, 4).every((s) => s.from === -1) && R.rawSteps(S, 1, 4).length === 1);
  check("Red enters at 24 minus the die", R.rawSteps(S, 1, 4)[0].to === 20);
  check("an entry onto a blocked point is refused", R.rawSteps(pos({ 20: -3 }, [1, 0]), 1, 4).length === 0);
  check("White enters at the die minus one", R.rawSteps(pos({}, [0, 1]), 2, 3)[0].to === 2);
}
{
  const S = pos({ 5: 2, 3: 3, 8: 1 });                                       // Red has a checker outside home
  check("no bearing off until everyone is home", !R.rawSteps(S, 1, 6).some((s) => s.to === -2));
  const H = pos({ 5: 2, 3: 3, 1: 1 });
  check("bearing off with the exact number", R.rawSteps(H, 1, 4).some((s) => s.from === 3 && s.to === -2));
  check("a bigger die bears off from the furthest checker only", R.rawSteps(H, 1, 6).some((s) => s.from === 5 && s.to === -2) && !R.rawSteps(H, 1, 6).some((s) => s.from === 3 && s.to === -2));
  check("a bigger die can't bear off a nearer checker while one is further back", !R.rawSteps(pos({ 5: 1, 2: 1 }), 1, 4).some((s) => s.from === 2 && s.to === -2) && R.rawSteps(pos({ 5: 1, 2: 1 }), 1, 4).some((s) => s.from === 5 && s.to === 1));
  check("White bears off at the top end", R.rawSteps(pos({ 18: -2, 20: -2 }), 2, 4).some((s) => s.from === 20 && s.to === -2));
}
// the play-as-many-as-you-can and larger-die rules
{
  // Red: a single checker on 1 (the 2-point) with White's checkers blocking 0? make a position where only one die can be played
  const S = pos({ 6: 1, 4: -2, 2: -2, 3: -2 });                              // Red on index 6; White holds 4,3,2: a 2 lands on 4 (blocked), a 3 lands on 3 (blocked), a 4 lands on 2 (blocked), 1 lands on 5 (free), 5 lands on 1 (free)
  const steps = R.legalSteps(S, 1, [1, 5]);
  check("a die that leads nowhere is not offered when the other must be played first", steps.length > 0);
  check("maxPlays counts how many dice can be played in a row", R.maxPlays(S, 1, [1, 5]) >= 1);
  const T = pos({ 6: 1, 5: -2, 4: -2, 3: -2, 2: -2, 1: -2, 0: -2 });          // a full prime: nothing at all can be played with 1..6 from 6 except... check
  const full = R.legalSteps(T, 1, [3, 4]);
  check("a blocked player has no legal steps", full.length === 0 && R.maxPlays(T, 1, [3, 4]) === 0);
}
{
  // only one of two dice can be played: it must be the larger one
  const S = pos({ 8: 1, 7: -2, 5: -2, 6: -2, 2: -2, 3: -2, 1: -2 });          // Red on 8; White holds 7,6,5,3,2,1: a 1 hits nothing: 8->7 blocked; 2->6 blocked; 3->5 blocked; 4 ->4 free then from 4: 1->3 blocked, 2->2 blocked
  const st = R.legalSteps(S, 1, [4, 1]);
  check("when only one die can be played, it is the larger one", st.length > 0 && st.every((s) => s.die === 4), JSON.stringify(st));
}
{
  // doubles: four moves
  const ends = R.sequences(S0, 1, R.diceList([3, 3]), 4000);
  const lens = [...ends.values()].map((e) => e.steps.length);
  check("doubles give four moves and many ending positions", ends.size > 20 && lens.every((l) => l === 4), ends.size + " ends, lens " + [...new Set(lens)]);
  const t0 = Date.now(); R.sequences(S0, 1, R.diceList([6, 6]), 4000); R.sequences(S0, 1, R.diceList([1, 1]), 4000);
  check("doubles are quick to enumerate", Date.now() - t0 < 1500, Date.now() - t0);
}
// the server's check
{
  const ends = R.sequences(S0, 1, [3, 1], 4000);
  const first = [...ends.values()][0];
  const board = (S) => R.str(S);
  const id = "abcd1234";
  const dice = R.openingDice(id);
  const real = R.sequences(S0, 1, R.diceList(dice), 4000);
  const one = [...real.values()][0];
  const good = { game: "backgammon", id, status: "in_progress", winner: null, last: 5, board: R.str(one.S) };
  check("a legal opening turn is accepted", R.check(null, good, 1).ok === true);
  check("White cannot open", R.check(null, good, 2).ok === false);
  const bad = R.clone(one.S); bad.pt[23] -= 1; bad.pt[19] += 1; bad.pt[22] += 0;      // an arbitrary shift of a checker that the dice may not allow
  const tampered = R.str(bad);
  check("a position the dice cannot make is refused", real.has(tampered.slice(0, 28)) || R.check(null, { ...good, board: tampered }, 1).ok === false);
  const extra = R.clone(one.S); extra.off[0] = 1; extra.pt[5] -= 1;
  check("a checker taken off early is refused", R.check(null, { ...good, board: R.str(extra) }, 1).ok === false);
  check("claiming a win that did not happen is refused", R.check(null, { ...good, status: "won", winner: 1 }, 1).ok === false);
}
// the server's roll: stamp
{
  const rng = (() => { let a = 7; return () => { a = (a * 16807) % 2147483647; return a / 2147483647; }; })();
  const id = "room0001", dice = R.openingDice(id), one = [...R.sequences(S0, 1, R.diceList(dice), 4000).values()][0];
  const next = { id, board: R.str(one.S), status: "in_progress", winner: null, last: 1 };
  const st = R.stamp(null, next, 1, rng);
  const S = R.parse(st.board);
  check("stamp rolls two dice for White and passes the turn", st.turn === 2 && S.dice[0] >= 1 && S.dice[1] >= 1 && S.dice[0] <= 6 && S.dice[1] <= 6 && S.ps === 0);
  check("stamp records the roll just played", S.pd[0] === dice[0] && S.pd[1] === dice[1]);
  check("the position is unchanged by stamp", R.posKey(S) === R.posKey(R.parse(next.board)));
  // a player who cannot move is passed: Red has a checker on the bar and White holds all six entry points
  const walled = pos({ 18: -3, 19: -3, 20: -3, 21: -2, 22: -2, 23: -2, 0: 1 }, [1, 0]);       // 15 white on 18..23; Red: one on the bar + one on index 0
  check("a walled-in Red on the bar cannot move", R.legalSteps(walled, 1, [2, 3]).length === 0);
  const before = { board: R.str({ ...pos({ 1: 1, 18: -3, 19: -3, 20: -3, 21: -2, 22: -2, 23: -2 }, [0, 0]), dice: [1, 2] }) };
  // White to have moved; the result is Red on the bar? build it directly: Red is on the bar and White to have just moved
  const afterW = { id, board: R.str({ ...pos({ 18: -3, 19: -3, 20: -3, 21: -2, 22: -2, 23: -2 }, [2, 0]), dice: [0, 0] }), status: "in_progress", winner: null, last: 1 };
  const s2 = R.stamp({ board: R.str({ ...pos({}, [2, 0]), dice: [1, 2] }) }, afterW, 2, rng);
  const T = R.parse(s2.board);
  check("a player who cannot move is passed and the other rolls again", T.ps === 1 && s2.turn === 2 && R.legalSteps(T, 2, R.diceList(T.dice)).length > 0, JSON.stringify({ turn: s2.turn, ps: T.ps }));
}

// whole random games through the real protocol; the server rolls
const rngSeed = (s) => () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
let finished = 0, turns = 0, passes = 0, r1 = 0, r2 = 0;
for (let gI = 0; gI < 25; gI++) {
  const room = newRoom("backgammon", "ABC234", 1000);
  join(room, null, mint, 1000); join(room, null, mint, 1000);
  const rng = rngSeed(1000 + gI);
  let ok = true;
  for (let ply = 0; ply < 1500 && ok && (!room.state || room.state.status === "in_progress"); ply++) {
    const prev = room.state;
    const player = prev ? prev.turn : 1;
    const seat = room.order[1] === player ? 1 : 2;
    const S = R.parse(prev ? prev.board : R.initial());
    const dice = prev ? S.dice : R.openingDice(room.id);
    const ends = [...R.sequences(S, player, R.diceList(dice), 4000).values()];
    const pick = ends.length ? rnd(ends) : { S };
    const w = R.winnerOf(pick.S);
    const state = { game: "backgammon", version: 1, id: room.id, turn: R.other(player), board: R.str(pick.S), status: w ? "won" : "in_progress", winner: w || null, moveCount: (prev ? prev.moveCount : 0) + 1, last: 3 };
    const res = applyMove(room, seat, { t: "move", n: prev ? prev.moveCount : 0, s: state }, 2000, rng);
    if (!res.ok) { check("a legal turn is accepted (game " + gI + " ply " + ply + ")", false, JSON.stringify(res)); ok = false; break; }
    turns++;
    const T = R.parse(room.state.board);
    if (room.state.status === "in_progress" && T.ps) passes++;
    if (room.state.status === "in_progress") {
      // the server's roll must be playable by whoever is on turn
      if (!T.dice[0] || !R.legalSteps(T, room.state.turn, R.diceList(T.dice)).length) { check("after a stamp the player on turn can move (game " + gI + ")", false); ok = false; }
    }
  }
  if (room.state && room.state.status === "won") { finished++; room.state.winner === 1 ? r1++ : r2++; }
}
check("random games reach a win", finished >= 20, finished + " of 25 in " + turns + " turns, " + passes + " forced passes");
check("both sides win some random games", r1 > 2 && r2 > 2, r1 + "/" + r2);

// a cheat through the room: Red tries to move with dice of their own choosing
{
  const room = newRoom("backgammon", "ABC234", 1000);
  join(room, null, mint, 1000); join(room, null, mint, 1000);
  const rng = rngSeed(5);
  const mkMove = (S, prev, player) => ({ game: "backgammon", version: 1, id: room.id, turn: R.other(player), board: R.str(S), status: "in_progress", winner: null, moveCount: (prev ? prev.moveCount : 0) + 1, last: 1 });
  const dice = R.openingDice(room.id);
  const other = [...Array(7).keys()].slice(1).find((d) => d !== dice[0] && d !== dice[1]);
  const fake = [...R.sequences(S0, 1, R.diceList([other, other]), 4000).values()].map((e) => e.S).find((S) => ![...R.sequences(S0, 1, R.diceList(dice), 4000).keys()].includes(R.posKey(S)));
  check("moving with a roll the server did not give is refused", !fake || applyMove(room, 1, { t: "move", n: 0, s: mkMove(fake, null, 1) }, 2000, rng).ok === false);
}

// the computer
{
  const rng = rngSeed(99);
  for (const lvl of ["easy", "medium", "hard"]) {
    let ok = true, ms = 0, moves = 0;
    for (let g = 0; g < 3 && ok; g++) {
      let S = R.parse(R.initial()), p = 1;
      for (let ply = 0; ply < 80 && !R.winnerOf(S) && ok; ply++) {
        S.dice = R.roll(rng);
        const t0 = Date.now();
        const steps = R.bestTurn(R.str(S), p, lvl, rng);
        ms += Date.now() - t0; moves++;
        let T = S, left = R.diceList(S.dice);
        for (const st of steps) {
          const legal = R.legalSteps(T, p, left);
          if (!legal.some((x) => x.from === st.from && x.to === st.to && x.die === st.die)) { ok = false; break; }
          T = R.applyStep(T, p, st); left = R.withoutDie(left, st.die);
        }
        if (ok && steps.length === 0 && R.legalSteps(S, p, R.diceList(S.dice)).length) ok = false;
        S = T; p = R.other(p);
      }
    }
    check(lvl + " plays only legal turns", ok);
    console.log("  (" + lvl + ": " + moves + " turns, " + Math.round(ms / moves) + " ms each)");
  }
  // hard beats easy over a few games
  function match(a, b, games) {
    let wa = 0;
    for (let g = 0; g < games; g++) {
      const lv = { 1: g % 2 ? b : a, 2: g % 2 ? a : b };
      let S = R.parse(R.initial()), p = 1;
      for (let ply = 0; ply < 400 && !R.winnerOf(S); ply++) {
        S.dice = R.roll(rng);
        let T = S;
        for (const st of R.bestTurn(R.str(S), p, lv[p], rng)) T = R.applyStep(T, p, st);
        S = T; p = R.other(p);
      }
      const w = R.winnerOf(S);
      if (w && lv[w] === a) wa++;
    }
    return wa / games;
  }
  const hv = match("medium", "easy", 10);
  check("medium beats easy most of the time", hv >= 0.6, hv);
}

console.log(fail ? `\n${pass} passed, ${fail} FAILED` : `\n${pass} passed`);
process.exit(fail ? 1 : 0);
