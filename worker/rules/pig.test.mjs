/* Run: node worker/rules/pig.test.mjs  — the rules, whole random games through the real room protocol (the server rolls) */
import { newRoom, join, applyMove } from "../live-protocol.mjs";
import "./pig.mjs";

const R = globalThis.PigRules;
let pass = 0, fail = 0;
function check(name, ok, detail) { if (ok) pass++; else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? " — " + detail : "")); } }
let n = 0;
const mint = () => "t" + ++n;

console.log("pig:");
check("the start board parses", R.parse(R.initial()) !== null && R.parse(R.initial()).f === "n");
check("bad boards do not parse", R.parse("1.2.3") === null && R.parse("1.2.3.7.c") === null && R.parse("1.2.3..x") === null && R.parse("1000.2.3..c") === null);
check("a roll request asks for the right board", R.rollRequest(null) === "0.0.0..r" && R.rollRequest("5.7.9.45.c") === "5.7.9.45.r");
check("a request after a held turn starts a fresh turn", R.rollRequest("5.7.0.45.h") === "5.7.0..r" && R.rollRequest("5.7.0.31.b") === "5.7.0..r");
check("holding banks the turn total for the mover", R.holdBoard("5.7.9.45.c", 1).board === "14.7.0.45.h" && R.holdBoard("5.7.9.45.c", 2).board === "5.16.0.45.h");

const env = (board, over = {}) => Object.assign({ game: "pig", version: 1, id: "x", turn: 1, board, status: "in_progress", winner: null, moveCount: 1, last: 0 }, over);

// the server's roll: a 1 loses the turn, anything else adds to it
{
  const next = env("0.0.0..r");
  const six = R.stamp(null, next, 1, () => 0.99);
  check("a 6 is added and the mover goes on", six.board === "0.0.6.6.c" && six.turn === 1, JSON.stringify(six));
  const one = R.stamp(null, next, 1, () => 0);
  check("a 1 loses the turn and passes it on", one.board === "0.0.0.1.b" && one.turn === 2, JSON.stringify(one));
  const cont = R.stamp(env("0.0.6.6.c"), env("0.0.6.6.r"), 1, () => 0.4);
  check("a roll continues the turn", cont.board === "0.0.9.63.c" || cont.board === "0.0.9.63.c".replace("63", "63"), cont.board);
}

// what a client may send
{
  const ok = (prev, next, mover) => R.check(prev, next, mover).ok;
  const st = (board, over) => env(board, over);
  check("player 1 may open with a roll request", ok(null, env("0.0.0..r"), 1));
  check("player 2 may not open", !ok(null, env("0.0.0..r"), 2));
  check("a client cannot send a finished roll", !ok(null, env("0.0.6.6.c"), 1) && !ok(null, env("0.0.0.1.b"), 1));
  check("a roll request must not change the scores or the turn", !ok(st("5.7.9.45.c"), env("5.7.9.45.r".replace("5.7", "50.7")), 1) && !ok(st("5.7.9.45.c"), env("5.7.12.45.r"), 1));
  check("a roll request must carry last 0", !ok(st("5.7.9.45.c"), env("5.7.9.45.r", { last: 3 }), 1));
  check("holding with nothing in hand is refused", !ok(null, env("0.0.0..h", { last: 0 }), 1));
  check("a hold must bank exactly the turn total", ok(st("5.7.9.45.c"), env("14.7.0.45.h", { last: 9 }), 1) && !ok(st("5.7.9.45.c"), env("20.7.0.45.h", { last: 15 }), 1) && !ok(st("5.7.9.45.c"), env("14.7.0.45.h", { last: 4 }), 1));
  check("a hold cannot bank the other player's score", !ok(st("5.7.9.45.c"), env("5.16.0.45.h", { last: 9 }), 1));
  check("reaching 100 by holding must be declared won", !ok(st("95.7.9.45.c"), env("104.7.0.45.h", { last: 9 }), 1) && ok(st("95.7.9.45.c", { turn: 1 }), env("104.7.0.45.h", { last: 9, status: "won", winner: 1 }), 1));
  check("a won declaration below 100 is refused", !ok(st("5.7.9.45.c"), env("14.7.0.45.h", { last: 9, status: "won", winner: 1 }), 1));
  check("a new turn after a hold starts from nothing", ok(st("14.7.0.45.h", { turn: 2 }), env("14.7.0..r"), 2) && !ok(st("14.7.0.45.h", { turn: 2 }), env("14.7.0.45.r"), 2));
}

// whole random games through the real room protocol
function playGame(holdA, holdB) {
  const room = newRoom("pig", "ABC234", 1000);
  join(room, null, mint, 1000); join(room, null, mint, 1000);
  const rng = Math.random;
  let guard = 0, errors = 0, seenRolls = 0;
  const seatOf = (p) => (room.order[1] === p ? 1 : 2);
  while ((!room.state || room.state.status === "in_progress") && guard++ < 5000) {
    const prev = room.state, mover = prev ? prev.turn : 1;
    const B = R.parse(prev ? prev.board : R.initial()), o = R.ongoing(B);
    const target = mover === 1 ? holdA : holdB;
    let proposal;
    if (o.t > 0 && (o.t >= target || B.s[mover - 1] + o.t >= R.GOAL)) {
      const h = R.holdBoard(prev ? prev.board : null, mover);
      proposal = { board: h.board, status: h.won ? "won" : "in_progress", winner: h.won ? mover : null, last: h.banked };
    } else proposal = { board: R.rollRequest(prev ? prev.board : null), status: "in_progress", winner: null, last: 0 };
    const s = Object.assign({ game: "pig", version: 1, id: room.id, turn: mover, moveCount: (prev ? prev.moveCount : 0) + 1 }, proposal);
    const res = applyMove(room, seatOf(mover), { t: "move", n: prev ? prev.moveCount : 0, s }, 2000, rng);
    if (!res.ok) { errors++; break; }
    const A = R.parse(room.state.board);
    if (!A || A.f === "r") { errors++; break; }
    if (proposal.board.endsWith(".r")) seenRolls++;
  }
  return { room, errors, guard, seenRolls };
}
{
  let games = 0, bad = 0, wins = [0, 0, 0];
  for (let g = 0; g < 300; g++) {
    const { room, errors, guard } = playGame(10 + (g % 5) * 6, 14 + (g % 4) * 7);
    games++;
    const A = R.parse(room.state.board);
    const fin = room.state.status === "won" && A && A.s[room.state.winner - 1] >= 100 && A.f === "h";
    if (errors || guard >= 5000 || !fin) { bad++; if (bad < 4) console.log("  bad game", errors, guard, room.state && room.state.board, room.state && room.state.status); }
    else wins[room.state.winner]++;
  }
  check("300 random games all finish with a legal winner at 100 or more", bad === 0, bad + " bad");
  check("both seats win some games", wins[1] > 20 && wins[2] > 20, JSON.stringify(wins));
}

// the room refuses a client that tries to bring its own roll, through the real protocol
{
  const room = newRoom("pig", "ABC234", 1000);
  join(room, null, mint, 1000); join(room, null, mint, 1000);
  const s = env("0.0.6.6.c", { id: room.id, moveCount: 1 });
  const res = applyMove(room, 1, { t: "move", n: 0, s: s }, 2000, Math.random);
  check("the room refuses a roll the server did not give", res.ok === false && res.reason === "illegal", JSON.stringify(res));
  const ok = applyMove(room, 1, { t: "move", n: 0, s: env("0.0.0..r", { id: room.id, moveCount: 1 }) }, 2000, () => 0.7);
  check("the room accepts a request and stamps a roll", ok.ok && /^0\.0\.\d\.\d\.c$/.test(room.state.board) && room.state.turn === 1, ok.ok ? room.state.board : JSON.stringify(ok));
  const wrong = applyMove(room, 2, { t: "move", n: 1, s: env("0.0.0..r", { id: room.id, moveCount: 2 }) }, 2000, Math.random);
  check("the other player cannot roll out of turn", wrong.ok === false && wrong.reason === "not-your-turn", JSON.stringify(wrong));
  const bust = applyMove(room, 1, { t: "move", n: 1, s: env(R.rollRequest(room.state.board), { id: room.id, moveCount: 2 }) }, 3000, () => 0);
  check("a server 1 passes the turn to the other player", bust.ok && room.state.turn === 2 && room.state.board.endsWith(".b"), bust.ok ? room.state.board : JSON.stringify(bust));
}

console.log(pass + " passed" + (fail ? ", " + fail + " FAILED" : ""));
process.exit(fail ? 1 : 0);
