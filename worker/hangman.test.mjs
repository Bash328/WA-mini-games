/* Run: node worker/hangman.test.mjs
   (online Hangman: the rules, what each person may see, the computer, and a whole room with a fake clock)

   Hangman is registered in worker/card-protocol.mjs with the other room games, so the room half drives the real protocol. */
import "../hangman/engine.js";
const H = globalThis.HangmanEngine;

let pass = 0, fail = 0;
function check(name, ok, detail) { if (ok) pass++; else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? " — " + detail : "")); } }
function mulberry(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rng = mulberry(5);
let n = 0; const mint = () => "tok" + ++n;
const T0 = 1_000_000;
const P = await import("./card-protocol.mjs");

console.log("hangman:");
const fresh = (starter) => H.create({ names: ["Ann", "Bob"], starter }, rng);

// --- a round: set, guess, win, lose
{
  const st = fresh(0);
  check("seat 0 sets first and it is their turn", st.setter === 0 && st.turn === 0 && st.stage === "set" && st.phase === "play");
  check("the guesser cannot set", H.act(st, 1, { t: "set", word: "cat" }, rng).error === "not-your-turn");
  check("a word that is too short is refused", H.act(st, 0, { t: "set", word: "ab" }, rng).error === "bad-word");
  check("a word that is too long is refused", H.act(st, 0, { t: "set", word: "a".repeat(21) }, rng).error === "bad-word");
  check("a word with no letters is refused", H.act(st, 0, { t: "set", word: "123 !!" }, rng).error === "bad-word");
  check("junk is refused, not a crash", ["x", 5, null, [], { t: "set" }, { t: "set", word: 5 }, { t: "guess", ch: "A" }].every((a) => !H.act(st, 0, a, rng).ok));
  const r = H.act(st, 0, { t: "set", word: " c-a t ", extra: 1 }, rng);
  check("the word is cleaned to letters and capitals", r.ok && st.word === "CAT" && st.stage === "guess" && st.turn === 1);
  check("the set event says how long, never what", JSON.stringify(r.events) === JSON.stringify([{ e: "set", seat: 0, len: 3 }]));
  check("the setter cannot guess", H.act(st, 0, { t: "guess", ch: "C" }, rng).error === "not-your-turn");
  check("a guess must be one letter", ["", "AB", "1", "é", 5, null].every((ch) => !H.act(st, 1, { t: "guess", ch }, rng).ok));
  let g = H.act(st, 1, { t: "guess", ch: "c" }, rng);
  check("a right letter is a hit", g.ok && g.events[0].hit === true && st.tried.join("") === "C");
  check("the same letter twice is refused", H.act(st, 1, { t: "guess", ch: "C" }, rng).error === "tried");
  H.act(st, 1, { t: "guess", ch: "A" }, rng);
  g = H.act(st, 1, { t: "guess", ch: "T" }, rng);
  const round = g.events.find((e) => e.e === "round");
  check("finding every letter wins the round for the guesser, and the word is shown", round && round.winner === 1 && round.solved && round.word === "CAT" && st.seats[1].score === 1 && st.phase === "round_over");
  H.nextRound(st, rng);
  check("the next round swaps the roles", st.setter === 1 && st.turn === 1 && st.stage === "set" && st.word === "" && st.tried.length === 0 && st.round === 2 && st.phase === "play");
}
{
  const st = fresh(0);
  H.act(st, 0, { t: "set", word: "dog" }, rng);
  let last;
  for (const ch of "ZXQJVK") last = H.act(st, 1, { t: "guess", ch }, rng);
  const round = last.events.find((e) => e.e === "round");
  check("six wrong letters lose the round: the setter scores", round && round.winner === 0 && !round.solved && st.seats[0].score === 1 && round.word === "DOG" && round.misses === 6);
  check("after the round nothing more can be played", H.act(st, 1, { t: "guess", ch: "D" }, rng).error === "not-playing");
}

// --- first to three wins the match
{
  const st = fresh(0);
  const roundWonByGuesser = () => { H.act(st, st.setter, { t: "set", word: "ant" }, rng); for (const ch of "ANT") H.act(st, st.turn, { t: "guess", ch }, rng); };
  roundWonByGuesser(); H.nextRound(st, rng);                  // seat 1 scores
  roundWonByGuesser(); H.nextRound(st, rng);                  // seat 0 scores
  roundWonByGuesser(); H.nextRound(st, rng);                  // seat 1 scores
  roundWonByGuesser();                                        // seat 0: 2 points
  check("2 to 2 is not over", st.phase === "round_over" && st.winner === null && st.seats[0].score === 2 && st.seats[1].score === 2, JSON.stringify(st.seats));
  H.nextRound(st, rng);
  roundWonByGuesser();
  check("the third point ends the match with a winner", st.phase === "game_over" && st.winner !== null && Math.max(...st.seats.map((s) => s.score)) === 3);
}

// --- who sees what
{
  const st = fresh(0);
  const asSetter = (s) => H.view(st, s);
  let vs = H.view(st, 0), vg = H.view(st, 1);
  check("before a word is set nobody sees one", vs.word === null && vg.word === null && vs.mask === "" && vg.options.set === false && vs.options.set === true);
  H.act(st, 0, { t: "set", word: "puzzle" }, rng);
  vs = H.view(st, 0); vg = H.view(st, 1);
  const spectator = H.view(st, null);
  check("the setter sees the word", vs.word === "PUZZLE" && vs.role === "setter");
  check("the guesser sees only blanks and the length", vg.word === null && vg.mask === "______" && vg.len === 6 && vg.role === "guesser");
  check("a spectator sees no word either", spectator.word === null && spectator.role === null);
  check("the guesser's whole view never contains the word", !JSON.stringify(vg).includes("PUZZLE") && !JSON.stringify(spectator).includes("PUZZLE"));
  const r = H.act(st, 1, { t: "guess", ch: "Z" }, rng);
  vg = H.view(st, 1);
  check("a right letter shows where it goes, the others stay hidden", vg.mask === "__ZZ__" && vg.misses === 0 && vg.tried.join("") === "Z" && !JSON.stringify(r.events).includes("PUZZLE"));
  check("only the guesser has letters to pick, and not the tried ones", vg.options.guess.length === 25 && !vg.options.guess.includes("Z") && H.view(st, 0).options.guess.length === 0);
  for (const ch of "QXJKVW") H.act(st, 1, { t: "guess", ch }, rng);
  vg = H.view(st, 1);
  check("when the round is over everybody sees the word", vg.word === "PUZZLE" && vg.phase === "round_over" && vg.last.word === "PUZZLE");
}

// --- the computer
{
  let ok = 0, games = 0, won = 0, never = true;
  for (const level of H.LEVELS) for (let i = 0; i < 40; i++) {
    const st = fresh(i % 2), r = mulberry(100 + i);
    for (let step = 0; step < 400 && st.phase !== "game_over"; step++) {
      if (st.phase === "round_over") { H.nextRound(st, r); continue; }
      const a = H.botAct(st, st.turn, level, r);
      const wordBefore = st.word;
      const res = H.act(st, st.turn, a, r);
      if (!res.ok) { never = false; break; }
      ok++;
    }
    games++; if (st.phase === "game_over") won++;
  }
  check("the computer plays whole matches with only legal moves", never && won === games, ok + " moves, " + won + "/" + games + " finished");
  // a hard bot must beat random guessing against the list: average misses on the list words
  const avg = (level) => { let m = 0, c = 0; for (const w of H.WORDS.slice(0, 120)) { const st = fresh(0), r = mulberry(7); H.act(st, 0, { t: "set", word: w }, r); while (st.phase === "play") H.act(st, 1, H.botAct(st, 1, level, r), r); m += st.last.misses; c++; } return m / c; };
  const hard = avg("hard"), easy = avg("easy");
  check("a hard computer guesses better than an easy one", hard < easy, "hard " + hard.toFixed(2) + " vs easy " + easy.toFixed(2));
  // it must not read the word: the same table with a different secret of the same shape gives the same first guess
  const a = fresh(0), b = fresh(0);
  H.act(a, 0, { t: "set", word: "tiger" }, rng); H.act(b, 0, { t: "set", word: "table" }, rng);
  check("the computer's guess depends only on what is on the table", H.botAct(a, 1, "hard", mulberry(1)).ch === H.botAct(b, 1, "hard", mulberry(1)).ch);
  const st = fresh(0);
  check("a computer setter picks a word that is allowed", H.validWord(H.botAct(st, 0, "medium", rng).word));
}

// --- a whole room with a fake clock: lobby, two people, hidden word, timeouts, rematch
{
  const room = P.newRoom("ABCDEF", T0, "hangman");
  const ann = P.join(room, null, "Ann", mint, T0, rng), bob = P.join(room, null, "Bob", mint, T0, rng);
  check("two people fill the table and it starts by itself", room.phase === "playing" && room.table.length === 2 && room.table.every((s) => s.kind === "human"));
  const seatOf = (pid) => room.table.findIndex((s) => s.pid === pid);
  const setter = room.state.setter, setterPid = room.table[setter].pid, guesserPid = room.table[1 - setter].pid;
  let t = T0 + 1000;
  const viewOf = (pid) => P.viewFor(room, pid, t);
  check("the guesser's room view has no word", viewOf(guesserPid).table.word === null && viewOf(setterPid).table.word === null && viewOf(setterPid).table.options.set === true);
  check("the guesser cannot set a word", !P.act(room, guesserPid, { t: "set", word: "cheat" }, t, rng).ok);
  check("the setter sets a word", P.act(room, setterPid, { t: "set", word: "ladder" }, t, rng).ok);
  const gv = viewOf(guesserPid);
  check("after it is set the setter sees it and the guesser does not", viewOf(setterPid).table.word === "LADDER" && gv.table.word === null && !JSON.stringify(gv).includes("LADDER") && !JSON.stringify(room.lastEvents).includes("LADDER"));
  check("a guess goes through the room", P.act(room, guesserPid, { t: "guess", ch: "L" }, t, rng).ok && viewOf(guesserPid).table.mask === "L_____");
  // the guesser walks away for 90 seconds: a computer plays that turn
  t += P.IDLE_TURN_MS + 1000;
  const notices = P.tick(room, t, rng).notices;
  check("a quiet guesser is covered by a computer for one turn", notices.some((x) => /took too long/.test(x)) && room.state.tried.length === 2, JSON.stringify(notices));
  // finish the round, then the next setter is the other person
  while (room.phase === "playing") { const turnPid = room.table[room.state.turn].pid; if (!P.act(room, turnPid, { t: "guess", ch: [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"].find((c) => !room.state.tried.includes(c)) }, t, rng).ok) break; }
  check("the round ends and the result is public", room.phase === "round_over" && viewOf(guesserPid).table.word === "LADDER");
  t += H.PAUSE + 100;
  P.tick(room, t, rng);
  check("after the pause the roles have swapped", room.phase === "playing" && room.state.setter === 1 - setter && room.state.round === 2);
  // an offline setter is replaced by a computer after 90 seconds and the game carries on
  P.setOnline(room, room.table[room.state.setter].pid, false, t);
  t += P.OFFLINE_TAKEOVER_MS + 1000;
  P.tick(room, t, rng);
  t += 9000; P.tick(room, t, rng);                              // the computer waits a few seconds before it moves
  check("a computer sets the word for someone who left", room.state.stage === "guess" && room.state.word.length >= 3, room.state.stage);
  const leaked = JSON.stringify(P.viewFor(room, room.table[room.state.setter].pid === ann.pid ? bob.pid : ann.pid, t));
  check("the word set by the computer is not in the other person's view either", !leaked.includes('"word":"' + room.state.word + '"'));
}
{
  // the room refuses a third person and listing the game
  const room = P.newRoom("ABCDEF", T0, "hangman");
  P.join(room, null, "Ann", mint, T0, rng); P.join(room, null, "Bob", mint, T0, rng);
  check("a third person cannot join a two-seat room", P.join(room, null, "Cy", mint, T0, rng).ok === false);
  check("hangman is one of the room games", P.CARD_GAMES.includes("hangman"));
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
