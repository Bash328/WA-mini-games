/* ============================================================
   liars-dice/engine.js — the rules and the computer players of Liar's Dice
   (Perudo), written once.

   A plain script that sets globalThis.LiarsDice, so the page loads it with a
   <script> tag and the Worker (worker/card-protocol.mjs) and the tests import it
   for the same effect. The page plays the computer with it; the server runs
   online rooms with it and is the only place the dice live.

   THE GAME (standard Perudo)
     2 to 4 players, 5 dice each. Everyone rolls under a cup, so you see only your
     own dice. In turn, the player to move either
       bids: "at least Q dice show F" across ALL the dice on the table, or
       calls dudo ("I doubt it"): everyone shows, the dice are counted, and
         the bid was good  -> the person who called dudo loses a die
         the bid was a lie -> the bidder loses a die
     ONES ARE WILD: when counting a bid on 2s to 6s, every 1 counts too. (A bid on
     1s counts only 1s.)
     A bid must go up: more dice, or the same number of a higher face. Moving to
     1s you may halve the number (rounded up); moving from 1s to another face you
     must at least double it and add one. The opening bid cannot be on 1s.
     Whoever lost a die opens the next round (if they are out, the next player).
     At 0 dice you are out; the last player with dice wins.

   Everything is plain JSON. rng is a function returning [0, 1).
   ============================================================ */
(function (g) {
  "use strict";

  const DICE = 5, MAX_SEATS = 4, PAUSE = 8000;
  const LEVELS = ["easy", "medium", "hard"];

  const roll = (rng) => 1 + Math.floor(rng() * 6);
  const alive = (st) => st.seats.map((s, i) => (s.status === "in" ? i : -1)).filter((i) => i >= 0);
  const total = (st) => st.seats.reduce((n, s) => n + (s.status === "in" ? s.dice : 0), 0);
  function nextIn(st, from) {
    for (let k = 1; k <= st.seats.length; k++) { const i = (from + k) % st.seats.length; if (st.seats[i].status === "in") return i; }
    return from;
  }
  function rollAll(st, rng) {
    st.seats.forEach((s) => { s.hand = s.status === "in" ? Array.from({ length: s.dice }, () => roll(rng)) : []; });
  }

  function create(opts, rng) {
    const names = opts.names, bots = opts.bots || [];
    const st = {
      v: 1, game: "liars-dice", mode: "normal", phase: "play", round: 1, moves: 0,
      seats: names.map((name, i) => ({ name, bot: bots[i] || null, dice: DICE, hand: [], status: "in" })),
      turn: opts.starter || 0, bid: null, winner: null, reveal: null,
    };
    rollAll(st, rng);
    return st;
  }

  // is "q of f" a legal raise over `bid` with `n` dice on the table?
  function legal(bid, q, f, n) {
    if (!Number.isInteger(q) || !Number.isInteger(f) || f < 1 || f > 6 || q < 1 || q > n) return false;
    if (!bid) return f !== 1;
    if (bid.f !== 1 && f !== 1) return q > bid.q || (q === bid.q && f > bid.f);
    if (bid.f !== 1 && f === 1) return q >= Math.ceil(bid.q / 2);
    if (bid.f === 1 && f !== 1) return q >= 2 * bid.q + 1;
    return q > bid.q;
  }
  // the least number that can be bid on each face (null when the face can't be bid): for the bid buttons
  function minQuantities(st) {
    const n = total(st), out = {};
    for (let f = 1; f <= 6; f++) { out[f] = null; for (let q = 1; q <= n; q++) if (legal(st.bid, q, f, n)) { out[f] = q; break; } }
    return out;
  }
  const countFace = (st, f) => st.seats.reduce((n, s) => n + (s.status === "in" ? s.hand.filter((d) => d === f || (f !== 1 && d === 1)).length : 0), 0);

  function act(st, seat, action, rng) {
    if (st.phase !== "play") return { ok: false, error: "not-playing" };
    if (seat !== st.turn || !action) return { ok: false, error: "not-your-turn" };
    const events = [];
    if (action.t === "bid") {
      if (!legal(st.bid, action.q, action.f, total(st))) return { ok: false, error: "illegal" };
      st.bid = { q: action.q, f: action.f, seat };
      st.turn = nextIn(st, seat); st.moves++;
      events.push({ e: "bid", seat, q: action.q, f: action.f });
      return { ok: true, events };
    }
    if (action.t === "dudo") {
      if (!st.bid) return { ok: false, error: "illegal" };
      const count = countFace(st, st.bid.f), good = count >= st.bid.q;
      const loser = good ? seat : st.bid.seat;
      const hands = st.seats.map((s) => s.hand.slice());
      st.seats[loser].dice--; st.moves++;
      events.push({ e: "dudo", seat, bidder: st.bid.seat });
      events.push({ e: "count", q: st.bid.q, f: st.bid.f, count, good });
      events.push({ e: "lose", seat: loser });
      if (st.seats[loser].dice === 0) { st.seats[loser].status = "out"; events.push({ e: "out", seat: loser }); }
      st.reveal = { challenger: seat, bidder: st.bid.seat, q: st.bid.q, f: st.bid.f, count, good, loser, hands };
      const left = alive(st);
      if (left.length === 1) { st.phase = "game_over"; st.winner = left[0]; events.push({ e: "win", seat: left[0] }); }
      else { st.phase = "round_over"; st.turn = st.seats[loser].status === "in" ? loser : nextIn(st, loser); }
      return { ok: true, events };
    }
    return { ok: false, error: "illegal" };
  }

  function nextRound(st, rng) {
    if (st.phase !== "round_over") return;
    st.round++; st.bid = null; st.reveal = null; st.phase = "play";
    rollAll(st, rng);
  }

  // what the person sitting in `seat` (or a spectator: null) may see
  function view(st, seat) {
    const shown = st.phase !== "play" && st.reveal;
    const out = {
      v: 1, game: st.game, phase: st.phase, round: st.round, turn: st.turn, bid: st.bid, winner: st.winner, total: total(st),
      reveal: st.reveal, dice: DICE, pause: PAUSE,
      seats: st.seats.map((s, i) => ({
        name: s.name, bot: s.bot, count: s.dice, status: s.status,
        hand: shown ? st.reveal.hands[i] : i === seat && s.status === "in" ? s.hand.slice() : null,
      })),
    };
    out.options = { minQ: st.phase === "play" ? minQuantities(st) : null, dudo: st.phase === "play" && !!st.bid };
    return out;
  }

  /* ---------- the computer ---------- */
  // P(at least k of n dice show a face that has chance p each)
  function atLeast(n, k, p) {
    if (k <= 0) return 1;
    if (k > n) return 0;
    let c = 1, tail = 0;                         // c = C(n, i)
    const pmf = [];
    for (let i = 0; i <= n; i++) { pmf.push(c * Math.pow(p, i) * Math.pow(1 - p, n - i)); c = c * (n - i) / (i + 1); }
    for (let i = k; i <= n; i++) tail += pmf[i];
    return tail;
  }
  // how likely "q of f" is true, from where `hand` sits among `n` dice
  function chance(hand, n, q, f) {
    const mine = hand.filter((d) => d === f || (f !== 1 && d === 1)).length;
    return atLeast(n - hand.length, q - mine, f === 1 ? 1 / 6 : 2 / 6);
  }
  const FACTORS = { easy: { dudo: 0.2, raise: 0.3, noise: 0.25 }, medium: { dudo: 0.33, raise: 0.45, noise: 0.1 }, hard: { dudo: 0.4, raise: 0.5, noise: 0.04 } };

  function botAct(st, seat, level, rng) {
    const lv = FACTORS[level] || FACTORS.medium, hand = st.seats[seat].hand, n = total(st);
    if (st.bid) {
      const pt = chance(hand, n, st.bid.q, st.bid.f) + (rng() - 0.5) * lv.noise;
      if (pt < lv.dudo) return { t: "dudo" };
    }
    const options = [];
    for (let f = 1; f <= 6; f++) for (let q = 1; q <= n; q++) {
      if (!legal(st.bid, q, f, n)) continue;
      const p = chance(hand, n, q, f);
      if (p >= lv.raise) options.push({ q, f, p, own: hand.filter((d) => d === f).length });
    }
    if (!options.length) return st.bid ? { t: "dudo" } : { t: "bid", q: 1, f: 2 };
    // the smallest safe raise, most often; easy picks any safe one; hard leans on faces it holds
    options.sort((a, b) => a.q - b.q || a.f - b.f);
    let pick;
    if (level === "easy") pick = options[Math.floor(rng() * options.length)];
    else if (level === "hard") { options.sort((a, b) => (a.q - b.q) || (b.own - a.own) || (a.f - b.f)); pick = options[Math.floor(rng() * Math.min(2, options.length) * (rng() < 0.25 ? 1 : 0.5))]; }
    else pick = options[Math.floor(rng() * Math.min(2, options.length) * 0.99)];
    return { t: "bid", q: pick.q, f: pick.f };
  }
  // an action that is always legal (the room plays it if a computer's choice is refused)
  const fallback = (st) => (st.bid ? { t: "dudo" } : { t: "bid", q: 1, f: 2 });

  g.LiarsDice = { DICE, MAX_SEATS, PAUSE, LEVELS, create, act, nextRound, view, botAct, fallback, legal, minQuantities, countFace, chance };
})(globalThis);
