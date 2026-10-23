/* ============================================================
   hearts/engine.js — the rules and the computer players of Hearts, written once.

   A plain script that sets globalThis.Hearts, so the page loads it with a
   <script> tag and the Worker (worker/card-protocol.mjs) and the tests import
   it for the same effect. The page plays the computer with it; the server
   runs online rooms with it and is the only place the deck and the hands
   live: a player is only ever sent their own cards.

   THE GAME (standard Hearts, exactly four seats)
     13 cards each. Before every hand, three cards are passed: left, right,
     across, then hold, and repeat. The holder of the 2♣ leads the first
     trick. You must follow suit if you can. You may not lead a heart until a
     heart has been played (broken), and no hearts or the queen of spades on
     the first trick unless you hold nothing else. Every heart is 1 point and
     the Q♠ is 13; taking all 26 (shooting the moon) gives everyone else 26
     and the shooter nothing. After each hand the points go on the scores;
     as soon as someone reaches 100 the game ends and the LOWEST score wins.
     Ties go to the earlier seat.

   Cards are strings: rank + suit ("7H", "10S", "KD", "AC"). Suits: S H C D.
   Everything is plain JSON. rng is a function returning [0, 1).
   ============================================================ */
(function (g) {
  "use strict";

  const SUITS = ["S", "H", "C", "D"];
  const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
  const VAL = {}; RANKS.forEach((r, i) => { VAL[r] = i + 2; }); VAL["A"] = 14;   // A high, 2 low
  const VALUE = (c) => VAL[c.slice(0, -1)];
  const SUIT = (c) => c.slice(-1);
  const isCard = (c) => typeof c === "string" && SUITS.includes(SUIT(c)) && RANKS.includes(c.slice(0, -1));
  const QS = "QS", QC = 12;

  const TABLE_SIZE = 4, HAND = 13, MOON = 26, TARGET = 100;
  const PASS_DIR = ["left", "right", "across", "hold"];
  const passDir = (round) => PASS_DIR[(round - 1) % 4];
  const passTarget = (seat, dir) => (dir === "left" ? (seat + 1) % 4 : dir === "right" ? (seat + 3) % 4 : dir === "across" ? (seat + 2) % 4 : -1);
  const LEVELS = ["easy", "medium", "hard"];

  function makeDeck() {
    const d = [];
    for (const s of SUITS) for (const r of RANKS) d.push(r + s);
    return d;
  }
  function shuffle(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }
  // clubs first, then diamonds, spades, hearts? No: spades, hearts, clubs, diamonds — display order
  const SUIT_ORDER = { S: 0, H: 1, C: 2, D: 3 };
  const sortHand = (hand) => hand.sort((a, b) => SUIT_ORDER[SUIT(a)] - SUIT_ORDER[SUIT(b)] || VALUE(b) - VALUE(a));

  function deal(st, rng) {
    const deck = shuffle(makeDeck(), rng);
    st.seats.forEach((s, i) => { s.hand = sortHand(deck.slice(i * HAND, (i + 1) * HAND)); });
    st.plays = []; st.roundPts = [0, 0, 0, 0]; st.heartsBroken = false; st.trickNo = 1;
    st.passed = [null, null, null, null]; st.phase = "pass"; st.turn = 0;
    if (st.passDir === "hold") { st.passed = st.seats.map(() => []); finishPass(st, [], rng); }
  }

  function create(opts, rng) {
    const names = opts.names;
    if (names.length !== TABLE_SIZE) throw new Error("Hearts needs exactly 4 seats");
    const st = {
      v: 1, game: "hearts", mode: "normal", round: 1, moves: 0,
      seats: names.map((name, i) => ({ name, bot: (opts.bots && opts.bots[i]) || null, hand: [], score: 0, taken: [] })),
      passDir: passDir(1), phase: "pass", turn: 0,
      plays: [], heartsBroken: false, trickNo: 1, roundPts: [0, 0, 0, 0],
      passed: [null, null, null, null], winner: null, reveal: null,
    };
    deal(st, rng);
    return st;
  }

  /* ---------- passing ---------- */
  // the three cards a computer hands over
  function botPassCards(st, seat, level, rng) {
    const hand = st.seats[seat].hand.slice();
    const rank = (c) => VALUE(c), s = (c) => SUIT(c);
    // danger: high spades without the Q are safe-ish; Q♠ is poison unless guarded
    const spades = hand.filter((c) => s(c) === "S").sort((a, b) => rank(a) - rank(b));
    const hearts = hand.filter((c) => s(c) === "H").sort((a, b) => rank(a) - rank(b));
    const others = hand.filter((c) => s(c) !== "S" && s(c) !== "H").sort((a, b) => rank(a) - rank(b));
    const pass = [];
    if (level !== "easy") {
      const q = hand.find((c) => c === QS);
      if (q && spades.filter((c) => c !== QS && rank(c) > QC).length < 3) pass.push(q);   // unguarded queen
      while (pass.length < 3 && hearts.length) pass.push(hearts.pop());                  // high hearts
    } else {
      while (pass.length < 3 && hearts.length && rng() < 0.6) pass.push(hearts.pop());
    }
    while (pass.length < 3 && others.length) pass.push(others.pop());
    while (pass.length < 3 && spades.length) { const c = spades.pop(); if (c !== QS || pass.length === 2) pass.push(c); }
    while (pass.length < 3 && hearts.length) pass.push(hearts.pop());
    const set = new Set(pass);
    for (const c of hand) { if (pass.length >= 3) break; if (!set.has(c)) { pass.push(c); set.add(c); } }
    return pass.slice(0, 3);
  }

  function finishPass(st, events, rng) {
    const dir = st.passDir, swaps = [];
    st.seats.forEach((s, i) => {
      const to = passTarget(i, dir);
      if (to >= 0) swaps.push([i, to, st.passed[i]]);
    });
    swaps.forEach(([from, to, cards]) => {
      st.seats[to].hand.push(...cards);
      cards.forEach((c) => {
        const k = st.seats[from].hand.indexOf(c);
        if (k >= 0) st.seats[from].hand.splice(k, 1);
      });
      events.push({ e: "pass", seat: from, to, cards: cards.slice(), dir });
    });
    st.seats.forEach((s) => sortHand(s.hand));
    st.phase = "play"; st.trickNo = 1; st.plays = []; st.heartsBroken = false;
    st.turn = st.seats.findIndex((s) => s.hand.includes("2C"));
    events.push({ e: "lead", seat: st.turn, card: "2C" });
  }

  /* ---------- what may be played ---------- */
  const pointCard = (c) => (SUIT(c) === "H" ? 1 : c === QS ? 13 : 0);
  const trickPoints = (plays) => plays.reduce((n, p) => n + pointCard(p.card), 0);

  function legalPlays(st, seat) {
    if (st.phase !== "play" || seat !== st.turn) return [];
    const hand = st.seats[seat].hand;
    if (!st.plays.length) {                                   // leading
      if (st.trickNo === 1) return hand.includes("2C") ? ["2C"] : [];
      const hearts = hand.filter((c) => SUIT(c) === "H");
      if (!st.heartsBroken && hearts.length < hand.length) return hand.filter((c) => SUIT(c) !== "H");
      return hand.slice();
    }
    const lead = SUIT(st.plays[0].card);
    const follow = hand.filter((c) => SUIT(c) === lead);
    const pool = follow.length ? follow : hand.slice();
    if (st.trickNo === 1) {                                   // no points on the first trick if you can avoid them
      const clean = pool.filter((c) => pointCard(c) === 0);
      return clean.length ? clean : pool.slice();
    }
    return pool;
  }

  /* ---------- playing a trick ---------- */
  function act(st, seat, action, rng) {
    if (!action || typeof action !== "object") return { ok: false, error: "bad-action" };
    const events = [];

    if (action.t === "pass") {
      if (st.phase !== "pass") return { ok: false, error: "not-passing" };
      if (seat < 0 || seat >= TABLE_SIZE || st.passed[seat]) return { ok: false, error: "illegal" };
      const cards = action.cards;
      const need = st.passDir === "hold" ? 0 : 3;
      if (st.passDir === "hold") { st.passed[seat] = []; }
      else {
        if (!Array.isArray(cards) || cards.length !== 3 || !cards.every(isCard)) return { ok: false, error: "need-3" };
        const hand = st.seats[seat].hand;
        if (!cards.every((c) => hand.includes(c)) || new Set(cards).size !== 3) return { ok: false, error: "not-in-hand" };
        st.passed[seat] = cards.slice();
      }
      events.push({ e: "passed", seat });
      // the computers hand theirs over as soon as everyone has acted
      st.seats.forEach((s, i) => {
        if (s.bot && !st.passed[i]) st.passed[i] = st.passDir === "hold" ? [] : botPassCards(st, i, s.bot, rng);
      });
      st.moves++;
      if (st.passed.every((p) => p !== null)) finishPass(st, events, rng);
      return { ok: true, events };
    }

    if (action.t !== "play") return { ok: false, error: "bad-action" };
    if (st.phase !== "play") return { ok: false, error: "not-playing" };
    if (seat !== st.turn) return { ok: false, error: "not-your-turn" };
    const card = action.card;
    const hand = st.seats[seat].hand;
    if (!isCard(card) || !hand.includes(card)) return { ok: false, error: "not-in-hand" };
    if (!legalPlays(st, seat).includes(card)) return { ok: false, error: "illegal" };

    hand.splice(hand.indexOf(card), 1);
    st.plays.push({ seat, card });
    st.moves++;
    events.push({ e: "play", seat, card });
    if (SUIT(card) === "H" && !st.heartsBroken) { st.heartsBroken = true; events.push({ e: "broken" }); }

    if (st.plays.length < TABLE_SIZE) { st.turn = (seat + 1) % TABLE_SIZE; return { ok: true, events }; }

    // the trick is complete
    const lead = SUIT(st.plays[0].card);
    let winner = st.plays[0];
    for (const p of st.plays) if (SUIT(p.card) === lead && VALUE(p.card) > VALUE(winner.card)) winner = p;
    const pts = trickPoints(st.plays);
    st.roundPts[winner.seat] += pts;
    st.seats[winner.seat].taken.push(st.plays.map((p) => p.card));
    events.push({ e: "trick", winner: winner.seat, pts, cards: st.plays.map((p) => ({ seat: p.seat, card: p.card })) });
    st.plays = [];
    const done = st.seats.every((s) => s.hand.length === 0);

    if (!done) { st.trickNo++; st.turn = winner.seat; return { ok: true, events }; }

    // the hand is over: points on the scores, the moon first
    const shot = st.roundPts.findIndex((p) => p === MOON);
    const gained = shot >= 0 ? st.roundPts.map((_, i) => (i === shot ? 0 : MOON)) : st.roundPts.slice();
    gained.forEach((p, i) => { st.seats[i].score += p; });
    st.reveal = { gained: gained.slice(), shot: shot >= 0 ? shot : null, scores: st.seats.map((s) => s.score), taken: st.seats.map((s) => s.taken.length) };
    events.push({ e: "round", gained: gained.slice(), shot: shot >= 0 ? shot : null, scores: st.seats.map((s) => s.score) });
    if (st.seats.some((s) => s.score >= TARGET)) {
      let best = 0;
      st.seats.forEach((s, i) => { if (s.score < st.seats[best].score) best = i; });
      st.phase = "game_over"; st.winner = best;
      events.push({ e: "win", seat: best });
    } else st.phase = "round_over";
    return { ok: true, events };
  }

  function nextRound(st, rng) {
    if (st.phase !== "round_over") return false;
    st.round++;
    st.passDir = passDir(st.round);
    st.seats.forEach((s) => { s.taken = []; });
    st.reveal = null;
    deal(st, rng);
    return true;
  }

  /* ---------- the view ---------- */
  function options(st, seat) {
    if (st.phase === "pass") {
      if (seat === null || seat === undefined || st.passed[seat]) return { pass: 0, plays: [] };
      return { pass: st.passDir === "hold" ? 0 : 3, plays: [] };
    }
    return { pass: 0, plays: legalPlays(st, seat) };
  }
  function view(st, seat) {
    const showAll = st.phase === "round_over" || st.phase === "game_over";
    return {
      v: 1, game: "hearts", phase: st.phase, round: st.round, passDir: st.passDir,
      turn: st.turn, winner: st.winner, heartsBroken: st.heartsBroken,
      plays: st.plays.map((p) => ({ seat: p.seat, card: p.card })),
      roundPts: st.roundPts.slice(), scores: st.seats.map((s) => s.score),
      reveal: st.reveal, trickNo: st.trickNo,
      seats: st.seats.map((s, i) => ({ name: s.name, bot: s.bot, score: s.score, count: s.hand.length, taken: s.taken.length, hand: showAll || i === seat ? s.hand.slice() : undefined })),
      options: seat === null || seat === undefined ? { pass: 0, plays: [] } : options(st, seat),
    };
  }

  /* ---------- the computer players ---------- */
  function botAct(st, seat, level, rng) {
    if (st.phase === "pass") return { t: "pass", cards: st.passDir === "hold" ? [] : botPassCards(st, seat, level, rng) };
    const legal = legalPlays(st, seat);
    if (!legal.length) return null;
    if (level === "easy") return { t: "play", card: legal[Math.floor(rng() * legal.length)] };

    const plays = st.plays, lead = plays.length ? SUIT(plays[0].card) : null;
    const winner = plays.length
      ? plays.reduce((w, p) => (SUIT(p.card) === lead && VALUE(p.card) > VALUE(w.card) ? p : w), plays[0])
      : null;
    const pts = trickPoints(plays);
    const byVal = (a, b) => VALUE(b) - VALUE(a);
    const losVal = (a, b) => VALUE(a) - VALUE(b);
    const follow = lead ? legal.filter((c) => SUIT(c) === lead) : [];
    const off = lead ? legal.filter((c) => SUIT(c) !== lead) : [];

    if (!plays.length) {                                  // leading
      const nonHearts = legal.filter((c) => SUIT(c) !== "H");
      const pool = nonHearts.length ? nonHearts : legal;
      const q = pool.find((c) => c === QS);
      if (q && (st.heartsBroken || st.trickNo > 6) && level === "hard") return { t: "play", card: q };   // dump the queen late
      const suits = {};
      pool.forEach((c) => { (suits[SUIT(c)] = suits[SUIT(c)] || []).push(c); });
      const longest = Object.keys(suits).sort((a, b) => suits[b].length - suits[a].length || suits[a].map(VALUE).reduce((x, y) => x + y) - suits[b].map(VALUE).reduce((x, y) => x + y))[0];
      const lowest = suits[longest].slice().sort(losVal)[0];
      return { t: "play", card: lowest };
    }
    if (follow.length) {                                  // must follow
      const sorted = follow.slice().sort(losVal);
      const beating = sorted.filter((c) => VALUE(c) > VALUE(winner.card));
      if (pts > 0 && beating.length) return { t: "play", card: beating[0] };            // cheapest winner takes the points away... no: escapes? Take with the lowest winner to keep the lead safe — or duck
      if (pts > 0) return { t: "play", card: sorted[0] };                               // can't beat: shed low
      // no points out: duck with the highest that doesn't win, else win cheap with the lowest
      const ducks = sorted.filter((c) => VALUE(c) < VALUE(winner.card));
      if (ducks.length) return { t: "play", card: ducks[0] };
      return { t: "play", card: sorted[0] };
    }
    // void: slough the queen, then high hearts, then the highest card
    if (off.includes(QS) && st.trickNo > 1) return { t: "play", card: QS };
    const hearts = off.filter((c) => SUIT(c) === "H").sort(byVal);
    if (hearts.length && st.trickNo > 1) return { t: "play", card: hearts[0] };
    return { t: "play", card: off.slice().sort(byVal)[0] };
  }
  const fallback = (st, seat) => {
    if (st.phase === "pass") return { t: "pass", cards: st.passDir === "hold" ? [] : st.seats[seat].hand.slice(0, 3) };
    const legal = legalPlays(st, seat);
    return { t: "play", card: legal[0] };
  };

  g.Hearts = {
    SUITS, RANKS, VAL, VALUE, SUIT, isCard, QS, TABLE_SIZE, HAND, MOON, TARGET, LEVELS, PASS_DIR, passDir, passTarget,
    makeDeck, shuffle, create, act, nextRound, view, options, legalPlays, botAct, botPassCards, fallback, pointCard, trickPoints,
  };
})(globalThis);
