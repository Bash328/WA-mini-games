/* Run: node worker/ludo.test.mjs   (Ludo rules, the computer, and a whole room with a fake clock) */
import * as P from "./card-protocol.mjs";
import "../ludo/engine.js";
const L = globalThis.Ludo;

let pass = 0, fail = 0;
function check(name, ok, detail) { if (ok) pass++; else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? " — " + detail : "")); } }
function mulberry(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rng = mulberry(9);
let n = 0; const mint = () => "tok" + ++n;
const T0 = 1_000_000;

console.log("ludo:");
// --- the setup
{
  const two = L.create({ names: ["A", "B"] }, rng);
  check("two play diagonally: red (bottom-left) v blue (top-right)", two.seats[0].yard === 0 && two.seats[1].yard === 2);
  const four = L.create({ names: ["A", "B", "C", "D"] }, rng);
  check("four fill in turn order around the loop", four.seats.every((s, i) => s.yard === i));
  check("everyone starts with 4 tokens in the yard", two.seats.every((s) => s.tokens.every((r) => r === -1)));
  const v = L.view(two, 0);
  check("ludo hides nothing: every token is visible in every view", v.seats.every((s) => s.tokens.length === 4) && L.view(two, null).seats.length === 2);
  check("the starter may roll", v.options.roll === true && v.options.moves.length === 0);
  check("moving before rolling is refused", !L.act(two, 0, { t: "move", token: 0 }, rng).ok);
  check("a move is refused until a 6 brings a token out", !L.act(two, 0, { t: "move", token: 0 }, rng).ok);
}
// --- the die and the 6s
{
  const st = L.create({ names: ["A", "B"] }, rng);
  st.seats[0].tokens = [0, 10, 20, 30];                            // everything can move on any face
  const seen = new Set();
  for (let k = 0; k < 400; k++) {
    st.turn = 0; st.rolled = false; st.die = null; st.sixes = 0;
    L.act(st, 0, { t: "roll" }, rng);
    seen.add(st.die);
  }
  check("the die rolls 1..6", [...seen].sort((a, b) => a - b).join() === "1,2,3,4,5,6", [...seen].join());
  const st2 = L.create({ names: ["A", "B"] }, rng);
  st2.seats[0].tokens = [0, 10, 20, 30];
  L.act(st2, 0, { t: "roll" }, mulberry(3));
  check("a second roll in the same turn is refused", !L.act(st2, 0, { t: "roll" }, rng).ok && st2.rolled);
}
// --- hand-made positions (die forced by a stub rng)
const dieRng = (face) => () => (face - 1) / 6 + 0.01;
{
  const st = L.create({ names: ["A", "B"] }, rng);
  st.seats[0].tokens = [-1, -1, -1, -1]; st.seats[1].tokens = [0, 5, 20, 56]; st.turn = 0;
  let r = L.act(st, 0, { t: "roll" }, dieRng(3));
  check("with no 6 and an empty yard there is no move: the turn passes", r.ok && st.turn === 1 && !st.rolled && r.events.some((e) => e.e === "stuck"));
  st.turn = 0;
  r = L.act(st, 0, { t: "roll" }, dieRng(6));
  check("a 6 may come out of the yard", r.ok && L.legalMoves(st, 0).length === 4);
  r = L.act(st, 0, { t: "move", token: 2 }, rng);
  check("the token lands on the entry cell and the 6 earns another roll", r.ok && st.seats[0].tokens[2] === 0 && st.turn === 0 && !st.rolled);
}
{
  // red yard 0 (entry 39): cell = (39 + rel) % 52. blue yard 2 (entry 13).
  const st = L.create({ names: ["A", "B"] }, rng);
  st.seats[0].tokens = [20, 10, -1, 56];                           // 20 + 3 = 23 -> cell (39+23)%52 = 10
  st.seats[1].tokens = [49, -1, -1, 56];                           // cell (13+49)%52 = 10: in the firing line
  let r = L.act(st, 0, { t: "roll" }, dieRng(3));
  r = L.act(st, 0, { t: "move", token: 0 }, rng);
  check("landing on an opponent sends them home", r.ok && st.seats[1].tokens[0] === -1 && r.events.some((e) => e.e === "capture" && e.victim === 1));
  check("the turn passes after a plain roll", st.turn === 1);
  st.turn = 0; st.rolled = false; st.die = null;
  st.seats[1].tokens = [0, -1, -1, 56];                            // blue sits on its own entry (cell 13, safe)
  st.seats[0].tokens = [ (13 - 39 + 52) % 52 - 6, -1, -1, 56 ];    // red 6 short of that cell
  L.act(st, 0, { t: "roll" }, dieRng(6));
  r = L.act(st, 0, { t: "move", token: 0 }, rng);
  check("an entry cell is safe: the blue token stays", r.ok && st.seats[1].tokens[0] === 0 && !r.events.some((e) => e.e === "capture"), JSON.stringify(r.events));
}
{
  const st = L.create({ names: ["A", "B"] }, rng);
  st.seats[0].tokens = [54, 56, 56, 56]; st.turn = 0;
  L.act(st, 0, { t: "roll" }, dieRng(3));                          // overshoot: no move, turn passes
  check("overshooting home is refused", !L.act(st, 0, { t: "move", token: 0 }, rng).ok && st.seats[0].tokens[0] === 54);
  st.turn = 0; st.rolled = false; st.die = null;
  L.act(st, 0, { t: "roll" }, dieRng(2));
  const r = L.act(st, 0, { t: "move", token: 0 }, rng);
  check("the exact roll walks a token in", r.ok && st.seats[0].tokens[0] === 56 && r.events.some((e) => e.e === "home"));
  check("the last token in wins the game", st.phase === "game_over" && st.winner === 0 && r.events.some((e) => e.e === "win"));
}
{
  const st = L.create({ names: ["A", "B"] }, rng);
  st.turn = 0; st.seats[0].tokens = [-1, -1, -1, -1];
  let sixes = 0;
  const r6 = () => 0.001;                                          // always a 6
  for (let k = 0; k < 3; k++) {
    const r = L.act(st, st.turn, { t: "roll" }, r6);
    if (r.events.some((e) => e.e === "forfeit")) break;
    const mv = L.legalMoves(st, st.turn);
    if (mv.length) L.act(st, st.turn, { t: "move", token: mv[0] }, r6);
    sixes++;
  }
  check("three 6s in a row forfeit the turn", st.sixes === 0 && st.turn === 1 && st.rolled === false, "sixes=" + sixes + " turn=" + st.turn);
}
// --- the computer plays whole games
function botGame(names, level, seed) {
  const r = mulberry(seed);
  const st = L.create({ names }, r);
  let guard = 0;
  while (st.phase !== "game_over" && guard++ < 20000) {
    const seat = st.turn;
    let res = L.act(st, seat, L.botAct(st, seat, st.seats[seat].bot || level, r), r);
    if (!res.ok) res = L.act(st, seat, L.fallback(st, seat), r);
    if (!res.ok) throw new Error("a legal move was refused: " + JSON.stringify(res));
  }
  return { st, guard };
}
for (const [names, level, seed] of [
  [["A", "B"], "easy", 1], [["A", "B"], "hard", 2], [["A", "B", "C"], "medium", 3], [["A", "B", "C", "D"], "hard", 4],
]) {
  const { st, guard } = botGame(names, level, seed);
  const winner = st.seats[st.winner];
  check(`${names.length}p ${level}: a whole game finishes in ${guard} actions`, st.phase === "game_over" && !!winner && winner.tokens.every((r) => r === 56));
  check(`${names.length}p ${level}: every token stayed within the rules`, st.seats.every((s) => s.tokens.every((r) => r === -1 || (r >= 0 && r <= 56))));
}
// --- through a real room: people and computers, mixed
{
  const room = P.newRoom("LUDO42", T0, "ludo");
  check("a ludo room exists", !!room && room.game === "ludo");
  const a = P.join(room, null, "Alice", mint, T0, rng), b = P.join(room, null, "Bob", mint, T0, rng);
  P.setConfig(room, a.pid, { bots: 1 }, T0, rng);
  check("three seats wait in the lobby until the host starts", room.phase === "lobby");
  P.start(room, a.pid, T0, rng);
  check("the room starts with 2 people and a computer", room.phase === "playing" && room.table.length === 3);
  let now = T0, guard = 0;
  while (room.phase !== "game_over" && guard++ < 40000) {
    const seat = room.state.turn, t = room.table[seat];
    if (t.kind === "human" && !room.players.find((p) => p.pid === t.pid).autoBot) {
      const r = P.act(room, t.pid, L.botAct(room.state, seat, "medium", rng), now, rng);
      if (!r.ok) throw new Error("a legal move was refused in the room: " + JSON.stringify(r));
      now += 300;
    } else {
      now = Math.max(now + 200, Math.min(P.nextWake(room, now), now + 3000));
      P.tick(room, now, rng);
    }
  }
  check("a whole room game finishes through the protocol", room.phase === "game_over" && room.state.winner !== null, room.phase);
  const v = P.viewFor(room, a.pid, now);
  check("every seat is in the room view with its tokens", v.table.seats.length === 3 && v.table.seats.every((s) => s.tokens.length === 4));
  check("the loser can ask for a rematch and it waits for votes", P.vote(room, b.pid, now, rng).started === false);
  const r = P.vote(room, a.pid, now, rng);
  check("when everyone votes the next race begins, started by the winner", r.started && room.phase === "playing");
}
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
