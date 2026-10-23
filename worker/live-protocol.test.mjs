/* Run: node worker/live-protocol.test.mjs */
import {
  newRoom, join, bothSeated, applyMove, requestRematch, expiresAt, takeToken,
  IDLE_MS, FINISHED_MS, WAITING_MS, checkTaunt, HYPE_COUNT, HECKLE_COUNT,
} from "./live-protocol.mjs";

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? "  PASS  " : "  FAIL  ") + name);
  if (!ok) { console.log("     got:  " + JSON.stringify(got)); console.log("     want: " + JSON.stringify(want)); fail++; } else pass++;
}

let n = 0;
const mint = () => "tok" + ++n;
const T0 = 1_000_000;

function fresh() {
  const room = newRoom("tic-tac-toe", "ABC234", T0);
  const a = join(room, null, mint, T0), b = join(room, null, mint, T0);
  return { room, a, b };
}
// An envelope the way the client builds it
const E = (room, board, last, over = {}) => ({
  game: "tic-tac-toe", version: 2, id: room.id,
  turn: "O", board, status: "in_progress", winner: null,
  moveCount: (room.state ? room.state.moveCount : 0) + 1, last, ...over,
});
const move = (room, seat, board, last, over = {}, nOverride) =>
  applyMove(room, seat, { t: "move", n: nOverride !== undefined ? nOverride : (room.state ? room.state.moveCount : 0), s: E(room, board, last, over) }, T0 + 1);

console.log("joining:");
{
  const room = newRoom("tic-tac-toe", "ABC234", T0);
  check("unknown game gives no room", newRoom("chess", "ABC234", T0), null);
  const a = join(room, null, mint, T0);
  check("first joiner takes seat 1", [a.ok, a.seat, a.fresh], [true, 1, true]);
  check("room not ready with one seat", bothSeated(room), false);
  const b = join(room, null, mint, T0);
  check("second joiner takes seat 2", [b.ok, b.seat], [true, 2]);
  check("room ready", bothSeated(room), true);
  const c = join(room, null, mint, T0);
  check("third joiner is refused", c, { ok: false, reason: "full" });
  const back = join(room, a.token, mint, T0);
  check("a returning token gets its seat back", [back.ok, back.seat, back.fresh], [true, 1, false]);
  const wrong = join(room, "not-a-token", mint, T0);
  check("a wrong token is treated as a stranger (room full)", wrong, { ok: false, reason: "full" });
}

console.log("\nplaying a game:");
{
  const { room } = fresh();
  check("seat 1 plays X, seat 2 plays O", room.order, { 1: "X", 2: "O" });
  check("O cannot open", move(room, 2, "O........", 0).reason, "not-your-turn");
  const r1 = move(room, 1, "X........", 0);
  check("X opens", [r1.ok, r1.state.moveCount, r1.state.turn], [true, 1, "O"]);
  check("X cannot move twice", move(room, 1, "XX.......", 1).reason, "not-your-turn");
  check("stale move count is rejected", move(room, 2, "XO.......", 1, {}, 0).reason, "stale");
  check("overwriting is illegal", move(room, 2, "O........", 0).reason, "illegal");
  check("wrong game id is illegal", applyMove(room, 2, { t: "move", n: 1, s: { ...E(room, "XO.......", 1), id: "zzzzzzzz" } }, T0).reason, "illegal");
  check("wrong version is illegal", applyMove(room, 2, { t: "move", n: 1, s: { ...E(room, "XO.......", 1), version: 1 } }, T0).reason, "illegal");
  check("a skipped move count is illegal", applyMove(room, 2, { t: "move", n: 1, s: { ...E(room, "XO.......", 1), moveCount: 5 } }, T0).reason, "illegal");
  check("garbage envelope is illegal", applyMove(room, 2, { t: "move", n: 1, s: "nope" }, T0).reason, "illegal");
  check("O replies", move(room, 2, "XO.......", 1).ok, true);
  // X wins on the top row: X . . / O O . -> X X X
  move(room, 1, "XOX......", 2);
  move(room, 2, "XOXO.....", 3);
  const w = move(room, 1, "XOXOX....", 4, {});     // not yet a line
  const w2 = move(room, 2, "XOXOXO...", 5);
  const w3 = move(room, 1, "XOXOXOX..", 6, { status: "won", winner: "X" });
  check("diagonal-free sequence plays on", [w.ok, w2.ok], [true, true]);
  check("X wins with a line", [w3.ok, w3.state.status, w3.state.winner], [true, "won", "X"]);
  check("room records when it finished", room.finishedAt !== null, true);
  check("no moves after the game", move(room, 2, "XOXOXOXO.", 7).reason, "over");
}

console.log("\nserver decides the turn, not the client:");
{
  const { room } = fresh();
  const r = applyMove(room, 1, { t: "move", n: 0, s: E(room, "X........", 0, { turn: "X" }) }, T0);
  check("client-supplied turn is overridden", r.state.turn, "O");
}

console.log("\nwaiting for an opponent:");
{
  const room = newRoom("tic-tac-toe", "ABC234", T0);
  join(room, null, mint, T0);
  check("cannot move alone", move(room, 1, "X........", 0).reason, "waiting");
}

console.log("\nresigning:");
{
  const { room } = fresh();
  move(room, 1, "X........", 0);
  const resign = { t: "move", n: 1, s: { game: "tic-tac-toe", version: 2, id: room.id, turn: "X", board: "X........", status: "won", winner: "X", moveCount: 2, last: 0, resigned: true } };
  const r = applyMove(room, 2, resign, T0);
  check("O resigns, X wins", [r.ok, r.state.status, r.state.winner, r.state.resigned], [true, "won", "X", true]);
  const { room: r2 } = fresh();
  move(r2, 1, "X........", 0);
  const cheat = { ...resign, s: { ...resign.s, id: r2.id, winner: "O" } };
  check("cannot resign into a win for yourself", applyMove(r2, 2, cheat, T0).reason, "illegal");
  const tamper = { ...resign, s: { ...resign.s, id: r2.id, board: "XX......." } };
  check("cannot change the board while resigning", applyMove(r2, 2, tamper, T0).reason, "illegal");
  // resigning keeps only the envelope: extra keys the client adds are not stored or relayed
  const { room: r3 } = fresh();
  move(r3, 1, "X........", 0);
  const junk = { ...resign, s: { ...resign.s, id: r3.id, junk: "x".repeat(500), extra: { a: 1 } } };
  const rj = applyMove(r3, 2, junk, T0);
  check("a resign with extra keys is accepted but they are dropped", [rj.ok, "junk" in rj.state, "extra" in rj.state, Object.keys(rj.state).sort().join()], [true, false, false, "board,game,id,last,moveCount,resigned,status,turn,version,winner"]);
}
// a board that is an object (Lights Out) can be resigned: boards are compared by value, not by reference
{
  const room = newRoom("lights-out", "ABC234", T0);
  join(room, null, mint, T0); join(room, null, mint, T0);
  room.state = { game: "lights-out", version: 1, id: room.id, turn: 1, board: { bits: 5 }, status: "in_progress", winner: null, moveCount: 1, last: 0 };
  const resign = { t: "move", n: 1, s: { game: "lights-out", version: 1, id: room.id, turn: 1, board: { bits: 5 }, status: "won", winner: 2, moveCount: 2, last: 0, resigned: true } };
  const r = applyMove(room, 1, resign, T0);                                    // player 1 is on turn and resigns: player 2 wins
  check("resigning a game whose board is an object works", [r.ok, r.state && r.state.winner], [true, 2]);
}

console.log("\nrematch:");
{
  const { room } = fresh();
  check("not allowed mid-game", requestRematch(room, 1, T0).reason, "not-over");
  move(room, 1, "X........", 0); move(room, 2, "XO.......", 1);
  move(room, 1, "XOX......", 2); move(room, 2, "XOXO.....", 3);
  move(room, 1, "XOXOX....", 4); move(room, 2, "XOXOXO...", 5);
  move(room, 1, "XOXOXOX..", 6, { status: "won", winner: "X" });
  const oldId = room.id;
  check("first request waits", requestRematch(room, 2, T0), { ok: true, started: false });
  check("same seat asking twice still waits", requestRematch(room, 2, T0), { ok: true, started: false });
  const r = requestRematch(room, 1, T0);
  check("both asked: new game", r, { ok: true, started: true });
  check("players swap so the other side opens", room.order, { 1: "O", 2: "X" });
  check("state cleared, new id", [room.state, room.id !== oldId, room.finishedAt], [null, true, null]);
  check("seat 1 (now O) cannot open", move(room, 1, "O........", 0).reason, "not-your-turn");
  check("seat 2 (now X) opens", move(room, 2, "X........", 0).ok, true);
}

console.log("\nexpiry:");
{
  const { room } = fresh();
  check("idle room expires in 24h", expiresAt(room), T0 + IDLE_MS);
  move(room, 1, "X........", 0);
  check("activity pushes it back", expiresAt(room), T0 + 1 + IDLE_MS);
  room.finishedAt = T0 + 5;
  check("a finished room expires in 1h", expiresAt(room), T0 + 5 + FINISHED_MS);
  const lonely = newRoom("tic-tac-toe", "ABC234", T0);
  check("a room nobody joined expires in 2h", expiresAt(lonely), T0 + WAITING_MS);
  join(lonely, null, mint, T0);
  check("with only the host in it, still 2h", expiresAt(lonely), T0 + WAITING_MS);
  join(lonely, null, mint, T0);
  check("once both are in, the normal 24h applies", expiresAt(lonely), T0 + IDLE_MS);
}

console.log("\nrate limit:");
{
  let bucket = null, allowed = 0;
  for (let i = 0; i < 40; i++) { const r = takeToken(bucket, 5000); bucket = r.bucket; if (r.allowed) allowed++; }
  check("a burst of 40 lets 20 through", allowed, 20);
  const later = takeToken(bucket, 5000 + 2000);
  check("refills over time", later.allowed, true);
}

console.log("\ntaunts:");
{
  const ok = (m) => checkTaunt(m, 0, 10_000).ok;
  check("a valid hype id passes", ok({ k: "h", i: 0 }), true);
  check("last heckle id passes", ok({ k: "k", i: HECKLE_COUNT - 1 }), true);
  check("id past the end is refused", ok({ k: "h", i: HYPE_COUNT }), false);
  check("negative id is refused", ok({ k: "h", i: -1 }), false);
  check("free text is refused", ok({ k: "h", i: "hi" }), false);
  check("unknown kind is refused", ok({ k: "x", i: 0 }), false);
  check("too soon after the last is rate limited", checkTaunt({ k: "h", i: 1 }, 9_000, 10_000).reason, "rate-limit");
  check("fine once the gap has passed", checkTaunt({ k: "h", i: 1 }, 6_000, 10_000).ok, true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
