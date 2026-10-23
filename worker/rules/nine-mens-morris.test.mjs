/* Run: node worker/rules/nine-mens-morris.test.mjs  — the board, mills, flying,
   the two ways to win, random games against the computer, and the server check.
   The room's live-game table lives in worker/live-games.mjs; the server rules
   hook is tested here through the same validateTransition() that
   live-protocol.mjs calls for every move. */
import { newRoom, join, applyMove } from "../live-protocol.mjs";
import { LIVE_GAMES } from "../live-games.mjs";
import * as nmm from "./nine-mens-morris.mjs";

const { validateTransition } = nmm;
const R = globalThis.NineMensMorrisRules;
// live-games.mjs is the room's registration table and is not this module's file.
// Register the game in memory for the protocol tests if the table has not been
// updated yet, so this test always exercises the real room path.
if (!LIVE_GAMES["nine-mens-morris"]) {
  LIVE_GAMES["nine-mens-morris"] = { version: 1, players: [1, 2], first: 1, rules: nmm };
}
let pass = 0, fail = 0;
function check(name, ok, detail) { if (ok) pass++; else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? " — " + detail : "")); } }
const rnd = (a) => a[Math.floor(Math.random() * a.length)];
let minted = 0;
const mint = () => "t" + ++minted;

console.log("nine men's morris:");

/* ---------- helpers ---------- */
const PH = { place: "p", move: "m", remove: "r" };
function make(cells, phase, turn, placed, lost) {
  const b = new Array(24).fill(0);
  for (const [i, v] of cells) b[i] = v;
  return R.parse(b.join("") + PH[phase] + turn + placed.join("") + lost.join(""));
}
function envOf(S, last, extra) {
  const w = R.winner(S);
  return Object.assign({
    game: "nine-mens-morris", version: 1, turn: S.turn, board: R.str(S),
    status: w ? "won" : "in_progress", winner: w || null, moveCount: 1, last: last,
  }, extra || {});
}
const sameAction = (a, b) => !!b && a.kind === b.kind && a.from === b.from && a.to === b.to && a.at === b.at;
function aiLegal(S, p, mv) {
  if (!mv || !R.gen(S, p).some((a) => sameAction(a, mv))) return false;
  if (mv.remove === undefined) return true;
  const T = R.play(S, p, mv);
  return !!T && T.phase === "remove" && R.gen(T, p).some((a) => a.kind === "remove" && a.at === mv.remove);
}
function randomTurn(S, p) {
  const acts = R.gen(S, p);
  if (!acts.length) return null;
  let T = R.play(S, p, rnd(acts));
  if (T && T.phase === "remove") {
    const rms = R.gen(T, p);
    if (!rms.length) return null;
    T = R.play(T, p, rnd(rms));
  }
  return T;
}
function runGame(level, aiSide, maxPly) {
  let S = R.parse(R.create());
  for (let ply = 0; ply < maxPly; ply++) {
    const w = R.winner(S);
    if (w) return { done: true, winner: w, plies: ply };
    const p = S.turn;
    let T;
    if (p === aiSide) {
      const mv = R.bestMove(R.str(S), p, level, Math.random);
      if (!aiLegal(S, p, mv)) return { bad: true, why: "illegal computer move " + JSON.stringify(mv), plies: ply };
      T = R.playTurn(S, p, mv);
    } else {
      T = randomTurn(S, p);
    }
    if (!T) return { bad: true, why: "a turn produced no next position", plies: ply };
    S = T;
  }
  return { done: false, plies: maxPly };
}

/* ---------- the opening and the wire ---------- */
const startWire = R.create();
const start = R.parse(startWire);
check("create() makes a 30-character board", typeof startWire === "string" && startWire.length === 30);
check("the opening position parses", !!start && start.phase === "place" && start.turn === 1 && start.b.length === 24);
check("the opening board is empty", start && start.b.every((x) => x === 0));
check("both sides start with nine to place", start && start.placed[0] === 0 && start.placed[1] === 0 && start.lost[0] === 0 && start.lost[1] === 0);
check("the wire round-trips", R.str(start) === startWire);
check("there are 24 points and 16 mills", R.POINTS.length === 24 && R.MILLS.length === 16);
check("adjacency is symmetric", R.ADJ.every((list, i) => list.every((j) => R.ADJ[j].includes(i))));
check("the board has 32 links", R.ADJ.reduce((n, list) => n + list.length, 0) === 64);
check("every mill is three connected points", R.MILLS.every((m) => m.every((x, i) => i === 0 || R.ADJ[m[i - 1]].includes(x))));

check("a short board is refused", R.parse(startWire.slice(0, -1)) === null);
check("a board with a bad cell is refused", R.parse("3" + startWire.slice(1)) === null);
check("a board with a bad phase is refused", R.parse(startWire.slice(0, 24) + "x1" + "0000") === null);
check("a board with a bad turn is refused", R.parse(startWire.slice(0, 24) + "p3" + "0000") === null);
check("a board whose counts do not add up is refused", R.parse(startWire.slice(0, 24) + "p1" + "1000") === null);
check("moving before all nine are placed is refused", R.parse("0".repeat(24) + "m1" + "0000") === null);
const noMill = make([[0, 1]], "remove", 1, [1, 0], [0, 0]);
check("a removal phase with no mill is refused", noMill === null);
const wrongTurn = make([[0, 1], [1, 1], [2, 1], [3, 2], [4, 2], [5, 2]], "remove", 1, [3, 3], [0, 0]);
check("a placement removal with the wrong side to move is refused", wrongTurn === null);
const wrongPlace = make([[0, 1]], "place", 1, [1, 0], [0, 0]);
check("a placement with the wrong side to move is refused", wrongPlace === null);

/* ---------- placement, mills and removal ---------- */
const before = make([[0, 1], [1, 1], [3, 2], [4, 2]], "place", 1, [2, 2], [0, 0]);
check("a placement position parses", !!before);
const afterMill = before && R.play(before, 1, { kind: "place", to: 2 });
check("placing the third piece of a line starts a removal", !!afterMill && afterMill.phase === "remove" && afterMill.turn === 1);
check("the placed piece is on the board", afterMill && afterMill.b[2] === 1);
check("the mill is found", afterMill && R.millAt(afterMill.b, 2) && R.millsOf(afterMill.b, 1).length === 1);
const takes = afterMill ? R.gen(afterMill, 1) : [];
check("only the opponent's pieces can be removed", takes.length === 2 && takes.every((a) => a.kind === "remove" && (a.at === 3 || a.at === 4)));
check("the other side cannot act in the removal phase", afterMill && R.gen(afterMill, 2).length === 0);
const afterTake = afterMill && R.play(afterMill, 1, { kind: "remove", at: 3 });
check("a removal takes a piece and passes the turn", !!afterTake && afterTake.b[3] === 0 && afterTake.lost[1] === 1 && afterTake.turn === 2 && afterTake.phase === "place");
check("placement counts are unchanged by the removal", afterTake && afterTake.placed[0] === 3 && afterTake.placed[1] === 2);
check("the removal wire round-trips", afterTake && R.str(R.parse(R.str(afterTake))) === R.str(afterTake));
check("a removal cannot be played before a mill", before && R.play(before, 1, { kind: "remove", at: 3 }) === null);

// A piece outside a mill must be taken before a milled one.
const protectedBoard = [[0, 1], [1, 1], [2, 1], [3, 2], [4, 2], [5, 2], [9, 2], [12, 2], [15, 2], [18, 2], [21, 2], [23, 2]];
const protectedState = make(protectedBoard, "remove", 1, [9, 9], [6, 0]);
check("a movement-phase removal position parses", !!protectedState);
const protectedTakes = protectedState ? R.removable(protectedState) : [];
check("a piece outside a mill is the only one that can be taken", protectedTakes.length === 6 && ![3, 4, 5].some((x) => protectedTakes.includes(x)));
check("taking a protected piece while a free one exists is refused", protectedState && R.play(protectedState, 1, { kind: "remove", at: 3 }) === null);
const freeTake = protectedState && R.play(protectedState, 1, { kind: "remove", at: 9 });
check("taking a free piece is allowed", !!freeTake && freeTake.lost[1] === 1);

// When every piece is in a mill, the rule lets the mill be broken.
const allMillsBoard = [[0, 1], [1, 1], [2, 1], [3, 2], [4, 2], [5, 2], [6, 2], [7, 2], [8, 2], [15, 2], [16, 2], [17, 2]];
const allMills = make(allMillsBoard, "remove", 1, [9, 9], [6, 0]);
check("all nine pieces in mills still allows a removal", !!allMills && R.removable(allMills).length === 9);
check("a milled piece may be taken when every piece is in a mill", allMills && !!R.play(allMills, 1, { kind: "remove", at: 3 }));

// Eighteen placements (with any removals they earn) move the game on.
{
  let S = R.parse(R.create()), mains = 0;
  for (let guard = 0; guard < 200 && S && S.phase !== "move"; guard++) {
    const acts = R.gen(S, S.turn);
    if (!acts.length) break;
    const a = acts.find((x) => x.kind !== "remove") || acts[0];
    S = R.play(S, S.turn, a);
    if (a.kind !== "remove") mains++;
  }
  check("eighteen placements switch the game to movement", !!S && mains === 18 && S.phase === "move" && S.placed[0] === 9 && S.placed[1] === 9, S && S.phase + " " + mains);
}

/* ---------- movement, flying and making a mill by moving ---------- */
const flyBoard = [[0, 1], [1, 1], [2, 1], [14, 2], [21, 2], [22, 2], [23, 2]];
const fly = make(flyBoard, "move", 1, [9, 9], [6, 5]);
check("a three-piece position parses", !!fly);
check("a three-piece player can fly to a far point", fly && R.gen(fly, 1).some((m) => m.kind === "move" && m.from === 0 && m.to === 12));
check("a flying move is applied", fly && !!R.play(fly, 1, { kind: "move", from: 0, to: 12 }));

const fourBoard = [[0, 1], [1, 1], [2, 1], [3, 1], [14, 2], [21, 2], [22, 2], [23, 2]];
const four = make(fourBoard, "move", 1, [9, 9], [5, 5]);
check("a four-piece player cannot fly", four && !R.gen(four, 1).some((m) => m.kind === "move" && m.from === 0 && m.to === 12));
check("a four-piece player can still step next door", four && R.gen(four, 1).some((m) => m.kind === "move" && m.from === 0 && m.to === 9));

const moveMillBoard = [[0, 1], [1, 1], [14, 1], [3, 2], [4, 2], [5, 2], [21, 2]];
const moveMill = make(moveMillBoard, "move", 1, [9, 9], [6, 5]);
const millByMove = moveMill && R.play(moveMill, 1, { kind: "move", from: 14, to: 2 });
check("moving the third piece of a line starts a removal", !!millByMove && millByMove.phase === "remove" && millByMove.turn === 1);
check("the moved mill can only take the free enemy piece", millByMove && R.gen(millByMove, 1).length === 1 && R.gen(millByMove, 1)[0].at === 21);

/* ---------- the two ways to lose ---------- */
const winMillBoard = [[0, 1], [1, 1], [14, 1], [3, 2], [4, 2], [5, 2]];
const winMill = make(winMillBoard, "move", 1, [9, 9], [6, 6]);
const winAfterMill = winMill && R.play(winMill, 1, { kind: "move", from: 14, to: 2 });
const winAfterTake = winAfterMill && R.play(winAfterMill, 1, { kind: "remove", at: 3 });
check("taking an opponent's third-to-last piece wins", !!winAfterTake && R.winner(winAfterTake) === 1 && winAfterTake.lost[1] === 7);
check("a terminal board still parses", winAfterTake && !!R.parse(R.str(winAfterTake)));
const underThree = make([[0, 1], [1, 1], [2, 1], [4, 2], [5, 2]], "move", 2, [9, 9], [6, 7]);
check("fewer than three pieces loses", !!underThree && R.winner(underThree) === 1);

const stuckBoard = [[0, 1], [1, 1], [2, 1], [3, 1], [4, 2], [5, 2], [6, 2], [7, 2], [8, 2], [9, 2], [10, 2], [11, 2], [14, 2]];
const stuck = make(stuckBoard, "move", 1, [9, 9], [5, 0]);
check("a player with no legal move loses", !!stuck && R.gen(stuck, 1).length === 0 && R.winner(stuck) === 2);
check("a player with three pieces is never stuck while a point is free", fly && R.winner(fly) === 0);
const beforeStuck = make([[0, 1], [1, 1], [2, 1], [3, 1], [4, 2], [5, 2], [6, 2], [7, 2], [8, 2], [9, 2], [10, 2], [11, 2], [13, 2]], "move", 2, [9, 9], [5, 0]);
const madeStuck = beforeStuck && R.play(beforeStuck, 2, { kind: "move", from: 13, to: 14 });
check("a move can shut the opponent in", !!madeStuck && R.str(madeStuck) === R.str(stuck));

/* ---------- the computer ---------- */
for (const level of ["easy", "medium", "hard"]) {
  let bad = 0, finished = 0;
  const t0 = Date.now();
  for (let g = 0; g < 4; g++) {
    const r = runGame(level, g % 2 ? 2 : 1, 150);
    if (r.bad) { bad++; console.log("    " + level + " game " + g + ": " + r.why + " (ply " + r.plies + ")"); }
    if (r.done) finished++;
  }
  check(level + " always plays a legal full turn", bad === 0, bad + " bad game(s)");
  check(level + " games make progress and reach a result", finished > 0, finished + " of 4 finished");
  console.log("  (" + level + ": " + finished + "/4 finished in " + (Date.now() - t0) + " ms)");
}

/* ---------- random legal games through the real room protocol ---------- */
{
  let accepted = 0, finished = 0, p1 = 0, p2 = 0, bad = null;
  for (let g = 0; g < 24 && !bad; g++) {
    const room = newRoom("nine-mens-morris", "ABC234", 1000);
    if (!room) { bad = "the live game table does not list nine-mens-morris"; break; }
    join(room, null, mint, 1000);
    join(room, null, mint, 1000);
    let S = R.parse(R.create());
    for (let ply = 0; ply < 260; ply++) {
      const w = R.winner(S);
      if (w) { finished++; if (w === 1) p1++; else p2++; break; }
      const p = S.turn;
      const acts = R.gen(S, p);
      if (!acts.length) { bad = "a position with no legal move was not reported as won"; break; }
      const a = rnd(acts);
      const T = R.play(S, p, a);
      if (!T) { bad = "a random legal action produced no state"; break; }
      const nw = R.winner(T);
      const state = {
        game: "nine-mens-morris", version: 1, id: room.id, turn: T.turn,
        board: R.str(T), status: nw ? "won" : "in_progress", winner: nw || null,
        moveCount: (room.state ? room.state.moveCount : 0) + 1,
        last: R.lastOf(a),
      };
      const res = applyMove(room, p, { t: "move", n: room.state ? room.state.moveCount : 0, s: state }, 2000);
      if (!res || res.ok === false) { bad = JSON.stringify(res); break; }
      accepted++;
      S = T;
    }
  }
  check("the live room accepts every legal action in random games", !bad, bad);
  check("random games finish through the live room", finished > 6, finished + " of 24");
  check("both sides win some games through the live room", p1 > 0 && p2 > 0, p1 + "/" + p2);
  console.log("  (live room: " + accepted + " actions, " + finished + "/24 games finished)");
}

/* ---------- the server's check ---------- */
const firstMove = R.play(start, 1, { kind: "place", to: 0 });
const openOk = validateTransition(null, envOf(firstMove, 0), 1);
check("the server accepts the opening placement", openOk.ok === true && openOk.nextTurn === 2, JSON.stringify(openOk));
check("the server rejects an opening move by Blue", validateTransition(null, envOf(firstMove, 0), 2).ok === false);
check("the server rejects the wrong last point", validateTransition({ board: R.str(before) }, envOf(afterMill, 3), 1).ok === false);
check("the server rejects a move by the side not to move", validateTransition({ board: R.str(before) }, envOf(afterMill, 2), 2).ok === false);
check("the server rejects an early win claim", validateTransition({ board: R.str(before) }, envOf(afterMill, 2, { status: "won", winner: 1 }), 1).ok === false);

const millOk = validateTransition({ board: R.str(before) }, envOf(afterMill, 2), 1);
check("the server accepts a placement that makes a mill", millOk.ok === true && millOk.nextTurn === 1, JSON.stringify(millOk));
const takeOk = validateTransition({ board: R.str(afterMill) }, envOf(afterTake, 24 + 3), 1);
check("the server accepts the removal after that mill", takeOk.ok === true && takeOk.nextTurn === 2, JSON.stringify(takeOk));

const moveMillOk = validateTransition({ board: R.str(moveMill) }, envOf(millByMove, 2), 1);
check("the server accepts a move that makes a mill", moveMillOk.ok === true && moveMillOk.nextTurn === 1, JSON.stringify(moveMillOk));
const moveTake = millByMove && R.play(millByMove, 1, { kind: "remove", at: 21 });
const moveTakeOk = validateTransition({ board: R.str(millByMove) }, envOf(moveTake, 24 + 21), 1);
check("the server accepts the removal after a move mill", moveTakeOk.ok === true && moveTakeOk.nextTurn === 2, JSON.stringify(moveTakeOk));

const tampered = R.parse(R.str(afterMill));
tampered.b[3] = 0;
tampered.b[5] = 2;
check("the server rejects a board changed in two places", validateTransition({ board: R.str(before) }, envOf(tampered, 2), 1).ok === false);

const winOk = validateTransition({ board: R.str(winAfterMill) }, envOf(winAfterTake, 24 + 3), 1);
check("the server accepts a removal that wins", winOk.ok === true && winOk.nextTurn === 2, JSON.stringify(winOk));
check("the server rejects the wrong winner", validateTransition({ board: R.str(winAfterMill) }, envOf(winAfterTake, 24 + 3, { status: "won", winner: 2 }), 1).ok === false);
check("the server rejects a win reported as still in progress", validateTransition({ board: R.str(winAfterMill) }, envOf(winAfterTake, 24 + 3, { status: "in_progress", winner: null }), 1).ok === false);

const stuckOk = validateTransition({ board: R.str(beforeStuck) }, envOf(stuck, 14), 2);
check("the server accepts a move that shuts the opponent in", stuckOk.ok === true && stuckOk.nextTurn === 1, JSON.stringify(stuckOk));
check("the server rejects a shut-in win reported as still in progress",
  validateTransition({ board: R.str(beforeStuck) }, envOf(stuck, 14, { status: "in_progress", winner: null }), 2).ok === false);

const freeOk = validateTransition({ board: R.str(protectedState) }, envOf(freeTake, 24 + 9), 1);
check("the server accepts a removal outside a mill", freeOk.ok === true, JSON.stringify(freeOk));
const badRemove = R.parse(R.str(protectedState));
badRemove.b[3] = 0;
badRemove.lost[1]++;
badRemove.phase = "move";
badRemove.turn = 2;
check("the server rejects taking a protected piece while a free one exists",
  validateTransition({ board: R.str(protectedState) }, envOf(badRemove, 24 + 3), 1).ok === false);
const allMillsTake = allMills && R.play(allMills, 1, { kind: "remove", at: 3 });
check("the server accepts breaking a mill when every piece is in one",
  !!allMillsTake && validateTransition({ board: R.str(allMills) }, envOf(allMillsTake, 24 + 3), 1).ok === true);

const flyStep = fly && R.play(fly, 1, { kind: "move", from: 0, to: 12 });
const flyOk = validateTransition({ board: R.str(fly) }, envOf(flyStep, 12), 1);
check("the server accepts a flying move", flyOk.ok === true, JSON.stringify(flyOk));
const farCheat = R.parse(R.str(four));
farCheat.b[0] = 0;
farCheat.b[12] = 1;
farCheat.turn = 2;
check("the server rejects a far move with four pieces",
  validateTransition({ board: R.str(four) }, envOf(farCheat, 12), 1).ok === false);

check("the server rejects a removal offered by the wrong side",
  validateTransition({ board: R.str(afterMill) }, envOf(afterTake, 24 + 3), 2).ok === false);

/* ---------- the computer against a random player, both seats ---------- */
{
  let aiWins = 0, randomWins = 0;
  for (let g = 0; g < 6; g++) {
    const aiSide = g % 2 ? 2 : 1;
    const r = runGame("hard", aiSide, 150);
    if (r.done && r.winner === aiSide) aiWins++;
    else if (r.done) randomWins++;
  }
  check("the computer wins some games against a random player", aiWins > 0, aiWins + " wins, " + randomWins + " losses");
}

console.log(fail ? `\n${pass} passed, ${fail} FAILED` : `\n${pass} passed`);
process.exit(fail ? 1 : 0);
