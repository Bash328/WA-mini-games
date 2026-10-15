/* Run: node worker/rules/rock-paper-scissors.test.mjs
   Hidden-pick rules, exercised through the real room protocol. The point of
   this game's live mode is that a pick is never visible to the other side
   before both are in, so most of these tests are about what does NOT leak. */

import { newRoom, join, applyPick, applyMove, requestRematch, welcomePayload, pickedFlags } from "../live-protocol.mjs";
import { normalizeConfig, resolveRound, initialBoard, strToBoard } from "./rock-paper-scissors.mjs";

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) pass++; else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? " — " + detail : "")); }
}
let n = 0;
const mint = () => "tok" + ++n;
const T0 = 1;

function fresh(bestOf = 3) {
  const room = newRoom("rock-paper-scissors", "ABC234", T0, Math.random, normalizeConfig({ bestOf }));
  join(room, null, mint, T0); join(room, null, mint, T0);
  return room;
}
const pick = (room, seat, v, n) => applyPick(room, seat, { t: "pick", n: n !== undefined ? n : (room.state ? room.state.moveCount : 0), v }, T0);
// the player number (1/2) whose picks are "p1" in the rules: seat 1 at the start
const round = (room, a, b) => { pick(room, 1, a); return pick(room, 2, b); };

console.log("config:");
check("default best of 3", JSON.stringify(normalizeConfig({})) === '{"bestOf":3}');
check("accepts 5 and 7", normalizeConfig({ bestOf: 5 }).bestOf === 5 && normalizeConfig({ bestOf: "7" }).bestOf === 7);
check("rejects 4, 0 and junk", normalizeConfig({ bestOf: 4 }) === null && normalizeConfig({ bestOf: 0 }) === null && normalizeConfig({ bestOf: "x" }) === null);

console.log("\nrules:");
{
  const c = { bestOf: 3 };
  const r = resolveRound(null, c, 1, 3);                       // rock beats scissors
  check("rock beats scissors", r.board === "310010" || r.board.startsWith("310"), r.board);
  const t = resolveRound(initialBoard(c), c, 2, 2);
  check("a tie keeps the score and shows what was thrown", strToBoard(t.board).p1Wins === 0 && strToBoard(t.board).lastP1 === 2 && t.status === "in_progress");
  let b = initialBoard(c);
  b = resolveRound(b, c, 1, 3).board;
  const fin = resolveRound(b, c, 2, 1);                        // paper beats rock: 2-0
  check("first to 2 wins a best of 3", fin.status === "won" && fin.winner === 1);
  const c5 = { bestOf: 5 };
  let b5 = initialBoard(c5);
  for (let i = 0; i < 2; i++) b5 = resolveRound(b5, c5, 1, 3).board;
  check("best of 5 is not over at 2-0", resolveRound(b5, c5, 3, 1).status === "in_progress");
}

console.log("\nsecrecy:");
{
  const room = fresh();
  const r1 = pick(room, 1, 2);
  check("a first pick is accepted and just locks", r1.ok && r1.state === null);
  check("the flags say who has locked, not what", JSON.stringify(pickedFlags(room)) === '{"1":true,"2":false}');
  const wire = JSON.stringify(welcomePayload(room, 2, "x"));
  check("the opponent's welcome contains no pick values", !/"secret"/.test(wire) && welcomePayload(room, 2, "x").yourPick === 0, wire.slice(0, 200));
  check("the picker is told their own pick on reconnect", welcomePayload(room, 1, "x").yourPick === 2);
  check("state is still unresolved", room.state === null);
  const r2 = pick(room, 2, 1);                                 // rock vs paper: seat 1 wins
  check("the second pick resolves the round", r2.ok && r2.state && r2.state.moveCount === 1);
  const b = strToBoard(r2.state.board);
  check("scores and last picks are published", b.p1Wins === 1 && b.lastP1 === 2 && b.lastP2 === 1 && b.pending === 0, JSON.stringify(b));
  check("picks are cleared for the next round", room.secret[1] === 0 && room.secret[2] === 0);
  check("the published state never carries a pending pick", strToBoard(room.state.board).pending === 0);
}

console.log("\nmisuse:");
{
  const room = fresh();
  check("a pick must be 1-3", pick(room, 1, 7).reason === "illegal" && pick(room, 1, 0).reason === "illegal");
  check("a stale round number is refused", pick(room, 1, 1, 5).reason === "stale");
  pick(room, 1, 3);
  check("changing a locked pick is refused", pick(room, 1, 1).reason === "already-picked");
  const alone = newRoom("rock-paper-scissors", "ABC234", T0, Math.random, { bestOf: 3 });
  join(alone, null, mint, T0);
  check("cannot pick before an opponent joins", applyPick(alone, 1, { n: 0, v: 1 }, T0).reason === "waiting");
  const plain = newRoom("tic-tac-toe", "ABC234", T0);
  join(plain, null, mint, T0); join(plain, null, mint, T0);
  check("picks are refused for ordinary games", applyPick(plain, 1, { n: 0, v: 1 }, T0).reason === "illegal");
}

console.log("\nplaying a match:");
{
  const room = fresh(3);
  round(room, 1, 3);                                           // seat1 rock beats seat2 scissors: 1-0
  const tie = round(room, 2, 2);
  check("a tie is a resolved round that replays", tie.ok && tie.state.status === "in_progress" && tie.state.moveCount === 2);
  const win = round(room, 1, 3);
  check("seat 1 takes the match 2-0", win.state.status === "won" && win.state.winner === 1 && win.state.moveCount === 3);
  check("no more picks after the match", pick(room, 1, 1).reason === "over");
  check("the room records when it finished", room.finishedAt !== null);
}

console.log("\nresigning and rematch:");
{
  const room = fresh();
  check("cannot resign before the first round resolves", applyMove(room, 2, { n: 0, s: { game: room.game, version: 1, id: room.id, turn: 1, board: initialBoard(room.config), status: "won", winner: 1, moveCount: 1, last: 1, resigned: true } }, T0).ok === false);
  round(room, 1, 3);
  const prev = room.state;
  const resign = { game: room.game, version: 1, id: room.id, turn: 1, board: prev.board, status: "won", winner: 1, moveCount: 2, last: prev.last, resigned: true };
  check("seat 2 can resign out of turn order", applyMove(room, 2, { n: 1, s: resign }, T0).ok === true);
  check("a client cannot just propose a board in this game", applyMove(fresh(), 1, { n: 0, s: { game: "rock-paper-scissors", version: 1, id: "x", turn: 1, board: "300000", status: "in_progress", winner: null, moveCount: 1, last: 1 } }, T0).ok === false);

  const m = fresh();
  round(m, 1, 3); round(m, 1, 3);                              // a finished match, 2-0
  requestRematch(m, 1, T0); const r = requestRematch(m, 2, T0);
  check("rematch swaps seats and clears secrets", r.started && m.order[1] === 2 && m.state === null && !m.secret[1] && !m.secret[2]);
  check("config survives the rematch", m.config.bestOf === 3);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
