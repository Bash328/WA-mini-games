/* ============================================================
   hangman/engine.js — the rules of online Hangman, written once.

   Used by the Worker (worker/card-protocol.mjs): the server holds the secret word and sends each person only what they may see.
   The page never loads this file; it draws what view() sends.

   Two players. In every round one SETS a word and the other GUESSES it, six wrong letters lose; the setter then becomes the
   guesser. A round is a point for whoever won it, and first to TARGET points wins the match.

   Same shape as the other room engines: create, act, botAct, fallback, view, nextRound, PAUSE, TABLE_SIZE.
   ============================================================ */
(function (g) {
  "use strict";

  const MAX_WRONG = 6, TARGET = 3, MIN_LEN = 3, MAX_LEN = 20;
  const TABLE_SIZE = 2, MIN_SEATS = 2, MAX_SEATS = 2;
  const PAUSE = 6500;                                   // how long a round's result stays up before the next word
  const LEVELS = ["easy", "medium", "hard"];

  // Words a computer picks when it is the setter, shortest and easiest first. Also what a computer guesses from.
  const WORDS = Array.from(new Set(("able acid aunt baby bake ball band bark barn bath beach bean bear bell belt bike bird blue boat bone book boot " +
    "bowl bread brick bride bring brown brush cabin cable cake camel candy canoe card carpet castle cat chair chalk cheese chess " +
    "chief child chip circle city clap clay clean clever cliff clock cloud clown coach coast coin comet cook copper coral corn " +
    "cotton couch cow crab crane crown crumb dance dairy daisy deer desert desk diamond dinner dish doctor dog doll donkey door " +
    "dragon dream dress drum duck eagle earth echo egg elbow engine fabric face fairy farm feather fence field finger fire fish " +
    "flag flame flower flute fog forest fork fox frog fruit galaxy garden ghost giant gift giraffe glass globe glove goat gold " +
    "grape grass guitar hammer hand happy harbor hat hawk heart helmet hero hill honey horse hotel house igloo island jacket " +
    "jelly jewel jungle kettle key king kitchen kite kitten knight ladder lake lamp leaf lemon letter lion lizard lunch magic " +
    "mango maple market meadow melon mirror monkey moon mouse mountain muffin music needle nest night noodle ocean olive onion " +
    "orange otter paddle pancake panda paper parrot pear pencil penguin piano pickle pillow pilot pirate pizza planet pocket " +
    "puzzle queen rabbit radio rain rainbow river robot rocket roof rose sailor salad sandwich school shadow sheep shell ship " +
    "shoe silver singer sketch snail snow spider spoon squirrel stamp star storm story summer sunset swing table teacher tiger " +
    "toast tomato tower train treasure tree truck tulip turtle umbrella unicorn valley violin walrus water whale wheel window " +
    "winter wizard wolf yellow zebra zipper ancient balance blanket bridge bubble button cactus captain cherry compass crystal " +
    "diamond dolphin elephant feather fountain freckle galaxy harvest history journey kingdom lantern library lobster mammoth " +
    "mystery notebook octopus orchard painter pyramid reindeer scarecrow skeleton thunder trumpet vampire volcano whistle " +
    "wonder blizzard jukebox pajamas quartz rhythm sphinx zigzag oxygen jazz").split(" ").map((w) => w.toUpperCase())));

  const normalize = (raw) => String(raw === undefined || raw === null ? "" : raw).toUpperCase().replace(/[^A-Z]/g, "");
  const validWord = (w) => w.length >= MIN_LEN && w.length <= MAX_LEN;
  const other = (seat) => 1 - seat;
  const wrongLetters = (st) => st.tried.filter((c) => !st.word.includes(c));
  const solved = (st) => st.word.length > 0 && [...st.word].every((c) => st.tried.includes(c));

  function create(opts, rng) {
    opts = opts || {};
    const names = Array.isArray(opts.names) ? opts.names : ["You", "Bot"];
    if (names.length !== TABLE_SIZE) throw new Error("Hangman needs exactly 2 seats");
    const bots = opts.bots || [];
    const setter = opts.starter === 1 ? 1 : 0;
    return {
      v: 1, game: "hangman", phase: "play", round: 1, stage: "set", setter, turn: setter, winner: null, target: TARGET,
      word: "", tried: [], last: null,
      seats: names.map((name, i) => ({ name, bot: bots[i] || null, score: 0 })),
    };
  }

  // A round ends: a point to its winner, and the match ends at TARGET points.
  function endRound(st, winner, events) {
    st.seats[winner].score++;
    st.last = { word: st.word, solved: winner !== st.setter, winner, setter: st.setter, misses: wrongLetters(st).length, round: st.round };
    events.push({ e: "round", winner, setter: st.setter, solved: st.last.solved, word: st.word, misses: st.last.misses });
    if (st.seats[winner].score >= st.target) { st.phase = "game_over"; st.winner = winner; events.push({ e: "win", seat: winner }); }
    else st.phase = "round_over";
  }

  function act(st, seat, a, rng) {
    if (st.phase !== "play") return { ok: false, error: "not-playing" };
    if (seat !== st.turn) return { ok: false, error: "not-your-turn" };
    if (!a || typeof a !== "object") return { ok: false, error: "illegal" };
    const events = [];
    if (st.stage === "set") {
      if (a.t !== "set" || typeof a.word !== "string" || a.word.length > 200) return { ok: false, error: "illegal" };
      const w = normalize(a.word);
      if (!validWord(w)) return { ok: false, error: "bad-word" };
      st.word = w; st.tried = []; st.stage = "guess"; st.turn = other(st.setter);
      events.push({ e: "set", seat, len: w.length });                          // never the word itself
      return { ok: true, events };
    }
    if (a.t !== "guess" || typeof a.ch !== "string") return { ok: false, error: "illegal" };
    const ch = a.ch.toUpperCase();
    if (!/^[A-Z]$/.test(ch)) return { ok: false, error: "illegal" };
    if (st.tried.includes(ch)) return { ok: false, error: "tried" };
    st.tried.push(ch);
    const hit = st.word.includes(ch);
    events.push({ e: "guess", seat, ch, hit });
    if (solved(st)) endRound(st, other(st.setter), events);
    else if (wrongLetters(st).length >= MAX_WRONG) endRound(st, st.setter, events);
    return { ok: true, events };
  }

  // The next word: the roles swap.
  function nextRound(st, rng) {
    st.setter = other(st.setter); st.round++; st.stage = "set"; st.turn = st.setter;
    st.word = ""; st.tried = []; st.last = null; st.phase = "play";
  }

  // ---------- what each person sees ----------
  const pattern = (st) => (st.word ? [...st.word].map((c) => (st.tried.includes(c) ? c : "_")).join("") : "");

  function view(st, seat) {
    const you = seat === 0 || seat === 1 ? seat : null;
    const over = st.phase !== "play";
    const knowsWord = !!st.word && (over || you === st.setter);
    const myTurn = you !== null && you === st.turn && st.phase === "play";
    return {
      v: 1, game: "hangman", phase: st.phase, round: st.round, stage: st.stage, turn: st.turn, winner: st.winner, target: st.target,
      maxWrong: MAX_WRONG, minLen: MIN_LEN, maxLen: MAX_LEN, setter: st.setter, guesser: other(st.setter),
      role: you === null ? null : (you === st.setter ? "setter" : "guesser"),
      len: st.word.length, mask: pattern(st), tried: st.tried.slice(), misses: wrongLetters(st).length,
      word: knowsWord ? st.word : null,
      seats: st.seats.map((s) => ({ name: s.name, bot: s.bot, score: s.score })),
      last: st.last, levels: LEVELS.slice(),
      options: { set: myTurn && st.stage === "set", guess: myTurn && st.stage === "guess" ? "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").filter((c) => !st.tried.includes(c)) : [] },
    };
  }

  // ---------- the computer ----------
  const FREQ = "ETAOINSHRDLCUMWFGYPBVKJXQZ";
  const pick = (arr, rng) => arr[Math.floor(rng() * arr.length)];

  function pickWord(level, rng) {
    const pool = WORDS.filter((w) => level === "easy" ? w.length <= 5 : level === "hard" ? w.length >= 7 : w.length >= 4 && w.length <= 8);
    return pick(pool.length ? pool : WORDS, rng);
  }

  // A guess from what is on the table only: the pattern and the wrong letters, never the word.
  function bestGuess(st, level, rng) {
    const shown = pattern(st), wrong = new Set(wrongLetters(st));
    const fits = WORDS.filter((w) => w.length === shown.length && [...w].every((c, i) => (shown[i] === "_" ? !st.tried.includes(c) : shown[i] === c)));
    const counts = {};
    for (const w of fits) for (const c of new Set(w)) if (!st.tried.includes(c)) counts[c] = (counts[c] || 0) + 1;
    let order = Object.keys(counts).sort((a, b) => counts[b] - counts[a] || FREQ.indexOf(a) - FREQ.indexOf(b));
    if (!order.length) order = FREQ.split("").filter((c) => !st.tried.includes(c));
    if (level === "easy" && rng() < 0.45) return pick(FREQ.split("").filter((c) => !st.tried.includes(c)), rng);
    if (level === "medium" && order.length > 1 && rng() < 0.25) return order[1];
    return order[0];
  }

  function botAct(st, seat, level, rng) {
    level = LEVELS.includes(level) ? level : "medium";
    return st.stage === "set" ? { t: "set", word: pickWord(level, rng) } : { t: "guess", ch: bestGuess(st, level, rng) };
  }
  // An action that is always legal, for a person who walked away.
  function fallback(st, seat) { return botAct(st, seat, "medium", Math.random); }

  g.HangmanEngine = { MAX_WRONG, TARGET, MIN_LEN, MAX_LEN, TABLE_SIZE, MIN_SEATS, MAX_SEATS, PAUSE, LEVELS, WORDS, normalize, validWord,
    create, act, nextRound, view, botAct, fallback };
})(typeof globalThis !== "undefined" ? globalThis : this);
