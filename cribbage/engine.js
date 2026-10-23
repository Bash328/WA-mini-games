/* ============================================================
   cribbage/engine.js — the rules and the computer players of Cribbage,
   written once.

   A plain script that sets globalThis.Cribbage, so the page loads it with a
   <script> tag and the Worker (worker/card-protocol.mjs) and the tests import
   it for the same effect. The page plays the computer with it; the server is
   the only place the deck and the hands live: a player is only ever sent
   their own cards.

   THE GAME (standard two-player, six-card cribbage)
     One 52-card deck. Each player is dealt six cards and throws two face down
     into the dealer's crib. The dealer cuts a starter card, then the two
     players peg: alternately play a card, keeping the running total at or
     below 31. A player who cannot play says "go"; the other keeps playing
     until they also cannot, then the last card scores 1 and the count starts
     again. In the pegging, 15 scores 2, 31 scores 2, a pair scores 2, three
     of a kind 6, four of a kind 12, and a run of three or more scores its
     length. A Jack cut as the starter gives the dealer 2 ("his heels").

     When the hands are empty, the non-dealer's hand scores first, then the
     dealer's hand, then the dealer's crib. Each is four cards plus the
     starter:
       15s          every combination adding to 15, 2 points each
       pairs        every pair 2 (three of a kind 6, four of a kind 12)
       runs         each card of a run, including double runs
       flush        four in hand, or five with the starter; the crib needs all five
       nobs         the Jack of the starter's suit, 1
     The scores go on; the first to 121 wins. A game is several deals. The
     dealer alternates, and the player who won the previous deal leads the
     next one (opts.starter leads the first deal when a rematch supplies it).

   Cards are strings: rank + suit ("7H", "10S", "KD", "AC").
   Suits: S H C D. Everything is plain JSON. rng is a function returning
   [0, 1).
   ============================================================ */
(function (g) {
  "use strict";

  const SUITS = ["S", "H", "C", "D"];
  const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
  const ORDER = {}; RANKS.forEach((r, i) => { ORDER[r] = i + 1; });       // A low (1), K high (13)
  const VALUE = {}; RANKS.forEach((r) => { VALUE[r] = Math.min(10, ORDER[r]); }); VALUE.A = 1;
  const SUIT_ORDER = { S: 0, H: 1, C: 2, D: 3 };
  const HAND = 6, TABLE_SIZE = 2, CRIB_SIZE = 4, TARGET = 121, PAUSE = 6000;
  const LEVELS = ["easy", "medium", "hard"];

  const rankOf = (c) => c.slice(0, -1);
  const suitOf = (c) => c.slice(-1);
  const cardValue = (c) => VALUE[rankOf(c)];
  const cardOrder = (c) => ORDER[rankOf(c)];
  const isCard = (c) => typeof c === "string" && SUITS.includes(suitOf(c)) && RANKS.includes(rankOf(c));

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
  const sortHand = (hand) => hand.sort((a, b) =>
    SUIT_ORDER[suitOf(a)] - SUIT_ORDER[suitOf(b)] || cardOrder(a) - cardOrder(b));

  const emptyPegging = () => ({
    count: 0, line: [], log: [], go: [false, false], last: null, points: [0, 0],
  });

  /* ---------- creating and dealing ---------- */
  function newDeal(st, rng) {
    const deck = shuffle(makeDeck(), rng);
    st.seats.forEach((s, i) => {
      s.hand = sortHand(deck.slice(i * HAND, (i + 1) * HAND));
    });
    st.deck = deck.slice(TABLE_SIZE * HAND);
    st.crib = [];
    st.discarded = [false, false];
    st.starter = null;
    st.heels = false;
    st.phase = "discard";
    st.turn = 0;                                  // both players choose two cards, one after the other
    st.pegging = emptyPegging();
    st.reveal = null;
    st.winner = null;
    st.dealWinner = null;
    st.dealStart = st.seats.map((s) => s.score);
  }

  // opts: { names: [name, name], bots: [null|level, ...], dealer?, starter? }
  function create(opts, rng) {
    opts = opts || {};
    rng = rng || Math.random;
    const names = Array.isArray(opts.names) ? opts.names : ["You", "Computer"];
    if (names.length !== TABLE_SIZE) throw new Error("Cribbage needs exactly 2 seats");
    const bots = opts.bots || [];
    const dealer = opts.dealer === 1 ? 1 : 0;
    const first = opts.starter === 0 || opts.starter === 1 ? opts.starter : 1 - dealer;
    const st = {
      v: 1, game: "cribbage", phase: "discard", round: 1, moves: 0, target: TARGET,
      seats: names.map((name, i) => ({
        name, bot: bots[i] || null, hand: [], score: 0,
      })),
      dealer, leader: first, turn: 0, crib: [], starter: null, deck: [],
      discarded: [false, false], pegging: emptyPegging(),
      reveal: null, winner: null, dealWinner: null, dealStart: [0, 0],
    };
    newDeal(st, rng);
    return st;
  }

  /* ---------- what may be done ---------- */
  function legalPlays(st, seat) {
    if (!st || st.phase !== "pegging" || (seat !== 0 && seat !== 1) || seat !== st.turn) return [];
    const left = 31 - st.pegging.count;
    return st.seats[seat].hand.filter((c) => cardValue(c) <= left);
  }

  function options(st, seat) {
    const empty = { discard: [], play: [], go: false, score: false };
    if (!st || (seat !== 0 && seat !== 1)) return empty;
    if (st.phase === "discard") {
      return st.turn === seat
        ? { discard: st.seats[seat].hand.slice(), play: [], go: false, score: false }
        : empty;
    }
    if (st.phase === "pegging") {
      if (st.turn !== seat) return empty;
      const play = legalPlays(st, seat);
      return { discard: [], play, go: play.length === 0, score: false };
    }
    if (st.phase === "scoring") {
      return { discard: [], play: [], go: false, score: st.turn === seat };
    }
    return empty;
  }

  /* ---------- pegging ---------- */
  // The points the latest card in this run makes: 15, 31, pairs and runs.
  function pegScore(seq, count) {
    const line = seq || [];
    const out = { points: 0, labels: [], fifteen: 0, thirtyOne: 0, pairs: 0, runs: 0 };
    if (!line.length) return out;
    const cardOf = (p) => (typeof p === "string" ? p : p.card);
    const last = cardOf(line[line.length - 1]);
    const total = count === undefined || count === null
      ? line.reduce((n, p) => n + cardValue(cardOf(p)), 0)
      : count;

    if (total === 15) { out.points += 2; out.fifteen = 2; out.labels.push("15 for 2"); }
    if (total === 31) { out.points += 2; out.thirtyOne = 2; out.labels.push("31 for 2"); }

    let equal = 1;
    for (let i = line.length - 2; i >= 0; i--) {
      if (rankOf(cardOf(line[i])) === rankOf(last)) equal++;
      else break;
    }
    if (equal >= 2) {
      const pts = equal * (equal - 1);          // pair 2, three 6, four 12
      out.points += pts; out.pairs = pts;
      out.labels.push((equal === 2 ? "pair" : equal === 3 ? "three of a kind" : "four of a kind") + " for " + pts);
    }

    // A pegging run is the longest unbroken tail of cards that can be put in
    // order: no other card may have intervened, and a duplicate rank breaks it.
    const tail = line.map((p) => cardOrder(cardOf(p)));
    for (let len = tail.length; len >= 3; len--) {
      const part = tail.slice(-len);
      if (new Set(part).size !== len) continue;
      if (Math.max.apply(null, part) - Math.min.apply(null, part) === len - 1) {
        out.points += len; out.runs = len;
        out.labels.push("run of " + len + " for " + len);
        break;
      }
    }
    return out;
  }

  function finishGame(st, seat, events) {
    if (st.phase === "game_over") return;
    st.phase = "game_over";
    st.winner = seat;
    st.turn = seat;
    if (st.reveal) {
      st.reveal.winner = seat;
      st.reveal.finalScores = st.seats.map((s) => s.score);
    }
    if (Array.isArray(events)) events.push({ e: "win", seat });
  }

  function awardPeg(st, seat, points, events, labels) {
    if (points <= 0) return false;
    st.seats[seat].score += points;
    st.pegging.points[seat] += points;
    events.push({ e: "peg", seat, points, labels: labels || [] });
    if (st.seats[seat].score >= TARGET) {
      finishGame(st, seat, events);
      return true;
    }
    return false;
  }

  function resetPeg(st, events, preferred) {
    let start = preferred === 0 || preferred === 1 ? preferred : st.turn;
    if (!st.seats[start].hand.length && st.seats[1 - start].hand.length) start = 1 - start;
    st.pegging.count = 0;
    st.pegging.line = [];
    st.pegging.go = [false, false];
    st.pegging.last = null;
    st.turn = start;
    events.push({ e: "reset", turn: start });
  }

  function finishPegging(st, events) {
    if (st.phase === "game_over") return;
    st.reveal = computeReveal(st);
    st.phase = "scoring";
    st.turn = 0;
    const a = st.reveal.prospective;
    let winner = 0;
    for (let i = 1; i < TABLE_SIZE; i++) if (a[i] > a[winner]) winner = i;
    st.dealWinner = winner;
    events.push({ e: "scoring", starter: st.starter });
  }

  function endSequence(st, events) {
    const last = st.pegging.last;
    if (last && st.pegging.count > 0 && st.pegging.count !== 31) {
      const over = awardPeg(st, last.seat, 1, events, ["last card"]);
      if (over) return;
    }
    if (!st.seats[0].hand.length && !st.seats[1].hand.length) {
      finishPegging(st, events);
      return;
    }
    const start = last ? 1 - last.seat : st.turn;
    resetPeg(st, events, start);
  }

  function afterPlay(st, seat, events) {
    const opp = 1 - seat;
    const oppCan = st.seats[opp].hand.length > 0 && legalPlaysFor(st, opp).length > 0;
    if (oppCan && !st.pegging.go[opp]) {
      st.turn = opp;
      return;
    }
    if (st.seats[opp].hand.length && !st.pegging.go[opp]) {
      st.pegging.go[opp] = true;
      events.push({ e: "go", seat: opp });
    }
    const meCan = st.seats[seat].hand.length > 0 && legalPlaysFor(st, seat).length > 0;
    if (meCan) {
      st.turn = seat;
      return;
    }
    endSequence(st, events);
  }

  // legalPlays without requiring that it is already this seat's turn (used internally)
  function legalPlaysFor(st, seat) {
    if (!st || st.phase !== "pegging" || (seat !== 0 && seat !== 1)) return [];
    const left = 31 - st.pegging.count;
    return st.seats[seat].hand.filter((c) => cardValue(c) <= left);
  }

  /* ---------- hand and crib scoring ---------- */
  function scoreCards(cards, starter, isCrib) {
    cards = Array.isArray(cards) ? cards.slice() : [];
    const all = starter ? cards.concat([starter]) : cards.slice();
    const rankCounts = {};
    let sum = 0;
    for (const c of all) {
      const r = rankOf(c), v = cardValue(c);
      rankCounts[r] = (rankCounts[r] || 0) + 1;
      sum += v;
    }

    // 15s: every combination of the cards, two points each.
    let fifteenCount = 0;
    const n = all.length;
    for (let mask = 1; mask < (1 << n); mask++) {
      let total = 0;
      for (let i = 0; i < n; i++) if (mask & (1 << i)) total += cardValue(all[i]);
      if (total === 15) fifteenCount++;
    }
    const fifteens = fifteenCount * 2;

    // Pairs: every pair scores two. Three of a kind is three pairs, four is six.
    let pairs = 0;
    for (const r of Object.keys(rankCounts)) {
      const c = rankCounts[r];
      pairs += c * (c - 1);
    }

    // Runs: maximal consecutive rank blocks. Duplicate ranks multiply the run.
    const uniqueRanks = Array.from(new Set(all.map(cardOrder))).sort((a, b) => a - b);
    let runs = 0;
    const runParts = [];
    for (let i = 0; i < uniqueRanks.length;) {
      let j = i;
      while (j + 1 < uniqueRanks.length && uniqueRanks[j + 1] === uniqueRanks[j] + 1) j++;
      const len = j - i + 1;
      if (len >= 3) {
        let mult = 1;
        for (let k = i; k <= j; k++) {
          const found = Object.keys(rankCounts).find((r) => ORDER[r] === uniqueRanks[k]);
          mult *= rankCounts[found];
        }
        runs += len * mult;
        runParts.push({ length: len, times: mult, points: len * mult });
      }
      i = j + 1;
    }

    // Flush: four in hand, five when the starter matches. A crib needs all five.
    let flush = 0;
    if (cards.length >= 4) {
      const suit = suitOf(cards[0]);
      const allSame = cards.every((c) => suitOf(c) === suit);
      if (allSame) {
        if (starter && suitOf(starter) === suit) flush = cards.length + 1;
        else if (!isCrib) flush = cards.length;
      }
    }

    // Nobs: the Jack of the starter's suit, in the hand or crib.
    const nobs = starter && cards.some((c) => rankOf(c) === "J" && suitOf(c) === suitOf(starter)) ? 1 : 0;

    const total = fifteens + pairs + runs + flush + nobs;
    return {
      cards, starter: starter || null, fifteens, pairs, runs, flush, nobs, total,
      fifteenCount, sum,
      breakdown: [
        { k: "fifteens", n: fifteens, count: fifteenCount },
        { k: "pairs", n: pairs },
        { k: "runs", n: runs, parts: runParts },
        { k: "flush", n: flush },
        { k: "nobs", n: nobs },
      ],
    };
  }

  function computeReveal(st) {
    const hands = st.seats.map((s, i) => {
      const sc = scoreCards(s.hand, st.starter, false);
      sc.seat = i;
      return sc;
    });
    const crib = scoreCards(st.crib, st.starter, true);
    crib.owner = st.dealer;
    const handGain = [hands[0].total, hands[1].total];
    handGain[st.dealer] += crib.total;
    const scores = st.seats.map((s) => s.score);
    return {
      starter: st.starter,
      hands, crib, handGain,
      scores: scores.slice(),
      prospective: scores.map((v, i) => v + handGain[i]),
      gained: scores.map((v, i) => v + handGain[i] - st.dealStart[i]),
      applied: false, finalScores: null, winner: null,
    };
  }

  /* ---------- actions ---------- */
  function act(st, seat, action, rng) {
    if (!st || !action || typeof action !== "object") return { ok: false, error: "bad-action" };
    if (st.phase === "game_over" || st.phase === "round_over") return { ok: false, error: "not-playing" };
    if (seat !== 0 && seat !== 1) return { ok: false, error: "bad-seat" };
    rng = rng || Math.random;
    const events = [];

    if (action.t === "discard") {
      if (st.phase !== "discard") return { ok: false, error: "not-discarding" };
      if (seat !== st.turn) return { ok: false, error: "not-your-turn" };
      const cards = action.cards;
      if (!Array.isArray(cards) || cards.length !== 2 || !cards.every(isCard)) return { ok: false, error: "need-2" };
      if (new Set(cards).size !== 2) return { ok: false, error: "need-2" };
      const hand = st.seats[seat].hand;
      if (!cards.every((c) => hand.includes(c))) return { ok: false, error: "not-in-hand" };
      for (const c of cards) hand.splice(hand.indexOf(c), 1);
      st.crib.push(...cards);
      st.discarded[seat] = true;
      st.moves++;
      events.push({ e: "discarded", seat, count: 2 });     // the crib stays face down
      if (st.discarded.every(Boolean)) {
        st.starter = st.deck.pop();
        st.phase = "pegging";
        st.turn = st.leader;
        events.push({ e: "cut", card: st.starter, dealer: st.dealer });
        if (rankOf(st.starter) === "J") {
          st.heels = true;
          st.seats[st.dealer].score += 2;
          events.push({ e: "heels", seat: st.dealer, points: 2 });
          if (st.seats[st.dealer].score >= TARGET) finishGame(st, st.dealer, events);
        }
      } else {
        st.turn = 1 - seat;
      }
      return { ok: true, events };
    }

    if (action.t === "play") {
      if (st.phase !== "pegging") return { ok: false, error: "not-pegging" };
      if (seat !== st.turn) return { ok: false, error: "not-your-turn" };
      const card = action.card;
      const hand = st.seats[seat].hand;
      if (!isCard(card) || !hand.includes(card)) return { ok: false, error: "not-in-hand" };
      if (!legalPlays(st, seat).includes(card)) return { ok: false, error: "over-31" };
      hand.splice(hand.indexOf(card), 1);
      const newCount = st.pegging.count + cardValue(card);
      st.pegging.count = newCount;
      st.pegging.line.push({ seat, card });
      st.pegging.log.push({ seat, card });
      st.pegging.last = { seat, card };
      st.moves++;
      events.push({ e: "play", seat, card, count: newCount });
      const sc = pegScore(st.pegging.line, newCount);
      if (sc.points) {
        const over = awardPeg(st, seat, sc.points, events, sc.labels);
        if (over) return { ok: true, events };
      }

      if (!st.seats[0].hand.length && !st.seats[1].hand.length) {
        if (newCount !== 31) {
          const over = awardPeg(st, seat, 1, events, ["last card"]);
          if (over) return { ok: true, events };
        }
        finishPegging(st, events);
        return { ok: true, events };
      }

      if (newCount === 31) {
        resetPeg(st, events, 1 - seat);
        return { ok: true, events };
      }

      afterPlay(st, seat, events);
      return { ok: true, events };
    }

    if (action.t === "go") {
      if (st.phase !== "pegging") return { ok: false, error: "not-pegging" };
      if (seat !== st.turn) return { ok: false, error: "not-your-turn" };
      if (legalPlays(st, seat).length) return { ok: false, error: "must-play" };
      st.pegging.go[seat] = true;
      st.moves++;
      events.push({ e: "go", seat });
      const opp = 1 - seat;
      const oppCan = st.seats[opp].hand.length > 0 && legalPlaysFor(st, opp).length > 0;
      if (oppCan && !st.pegging.go[opp]) {
        st.turn = opp;
        return { ok: true, events };
      }
      if (st.seats[opp].hand.length && !st.pegging.go[opp]) {
        st.pegging.go[opp] = true;
        events.push({ e: "go", seat: opp });
      }
      endSequence(st, events);
      return { ok: true, events };
    }

    if (action.t === "score") {
      if (st.phase !== "scoring") return { ok: false, error: "not-scoring" };
      if (seat !== st.turn) return { ok: false, error: "not-your-turn" };
      const r = st.reveal;
      if (!r) return { ok: false, error: "not-scoring" };
      // The show is counted in order: non-dealer's hand, dealer's hand, crib.
      // The first player to 121 wins at that moment; later stages are not counted.
      const non = 1 - st.dealer;
      const stages = [
        { seat: non, points: r.hands[non].total },
        { seat: st.dealer, points: r.hands[st.dealer].total },
        { seat: st.dealer, points: r.crib.total },
      ];
      const applied = [0, 0];
      let win = null;
      for (const stage of stages) {
        st.seats[stage.seat].score += stage.points;
        applied[stage.seat] += stage.points;
        if (st.seats[stage.seat].score >= TARGET) { win = stage.seat; break; }
      }
      r.applied = true;
      r.appliedGain = applied;
      r.scores = st.seats.map((s) => s.score);
      r.dealGain = r.scores.map((v, i) => v - st.dealStart[i]);
      st.moves++;
      events.push({ e: "scored", scores: r.scores.slice(), gained: applied.slice() });

      if (win !== null) {
        st.dealWinner = win;
        r.finalScores = st.seats.map((s) => s.score);
        finishGame(st, win, events);
        return { ok: true, events };
      }

      let best = 0;
      for (let i = 1; i < TABLE_SIZE; i++) {
        if (r.dealGain[i] > r.dealGain[best]) best = i;
      }
      st.dealWinner = best;
      st.phase = "round_over";
      st.turn = 0;
      events.push({ e: "round", scores: r.scores.slice(), dealWinner: best });
      return { ok: true, events };
    }

    return { ok: false, error: "bad-action" };
  }

  function nextRound(st, rng) {
    if (!st || st.phase !== "round_over") return false;
    rng = rng || Math.random;
    st.round++;
    st.dealer = 1 - st.dealer;
    st.leader = st.dealWinner === 0 || st.dealWinner === 1 ? st.dealWinner : 1 - st.dealer;
    newDeal(st, rng);
    return true;
  }

  /* ---------- what a player is allowed to see ---------- */
  function view(st, seat) {
    const me = seat === 0 || seat === 1 ? seat : null;
    const showAll = st.phase === "scoring" || st.phase === "round_over" || (st.phase === "game_over" && !!st.reveal);
    const peg = st.pegging || emptyPegging();
    return {
      v: 1, game: "cribbage", phase: st.phase, round: st.round, moves: st.moves, target: st.target || TARGET,
      dealer: st.dealer, leader: st.leader, turn: st.turn, winner: st.winner, dealWinner: st.dealWinner,
      starter: st.starter, heels: !!st.heels, cribCount: st.crib.length,
      crib: showAll ? st.crib.slice() : undefined,
      scores: st.seats.map((s) => s.score),
      seats: st.seats.map((s, i) => ({
        name: s.name, bot: s.bot, score: s.score, count: s.hand.length, dealer: i === st.dealer,
        hand: showAll || i === me ? s.hand.slice() : undefined,
      })),
      pegging: {
        count: peg.count,
        line: peg.line.map((p) => ({ seat: p.seat, card: p.card })),
        log: peg.log.map((p) => ({ seat: p.seat, card: p.card })),
        go: peg.go.slice(), last: peg.last ? { seat: peg.last.seat, card: peg.last.card } : null,
        points: peg.points.slice(),
      },
      reveal: st.reveal,
      options: me === null ? { discard: [], play: [], go: false, score: false } : options(st, me),
    };
  }

  /* ---------- the computer players ---------- */
  function cribDanger(cards) {
    let d = 0;
    const ranks = {};
    for (const c of cards) {
      const r = rankOf(c), o = cardOrder(c);
      ranks[r] = (ranks[r] || 0) + 1;
      if (r === "5") d += 1.6;                         // the most useful crib card
      if (r === "J") d += 0.35;
      if (r === "A") d += 0.15;
      if (o >= 10) d += 0.2;
    }
    for (const r of Object.keys(ranks)) d += (ranks[r] - 1) * 0.9;
    const orders = cards.map(cardOrder).sort((a, b) => a - b);
    if (orders.length === 2 && orders[1] - orders[0] === 1) d += 0.45;
    return d;
  }

  function botDiscard(st, seat, level, rng) {
    const hand = st.seats[seat].hand.slice();
    if (level === "easy") {
      const pick = shuffle(hand.slice(), rng).slice(0, 2);
      return { t: "discard", cards: pick };
    }
    let best = null;
    for (let i = 0; i < hand.length; i++) {
      for (let j = i + 1; j < hand.length; j++) {
        const thrown = [hand[i], hand[j]];
        const keep = hand.filter((c) => c !== thrown[0] && c !== thrown[1]);
        let v = scoreCards(keep, null, false).total;
        if (seat !== st.dealer) v -= cribDanger(thrown);       // do not feed their crib
        else v += cribDanger(thrown) * 0.45;                   // our crib may use it
        if (level === "hard") {
          // keep a little shape: pairs and touching cards are worth more than loose high cards
          const orders = keep.map(cardOrder).sort((a, b) => a - b);
          for (let k = 1; k < orders.length; k++) if (orders[k] === orders[k - 1] + 1) v += 0.12;
          v -= keep.filter((c) => cardValue(c) === 10).length * 0.08;
          v += rng() * 0.1;
        } else {
          v += rng() * 0.7;
        }
        if (!best || v > best.v) best = { v, cards: thrown };
      }
    }
    return { t: "discard", cards: best.cards };
  }

  function botPeg(st, seat, level, rng) {
    const legal = legalPlays(st, seat);
    if (!legal.length) return { t: "go" };
    if (level === "easy") return { t: "play", card: legal[Math.floor(rng() * legal.length)] };
    let best = null;
    for (const card of legal) {
      const newCount = st.pegging.count + cardValue(card);
      const line = st.pegging.line.concat([{ seat, card }]);
      const sc = pegScore(line, newCount);
      let v = sc.points;
      const opp = 1 - seat;
      const oppLeft = 31 - newCount;
      const oppCan = newCount < 31 && st.seats[opp].hand.some((c) => cardValue(c) <= oppLeft);
      if (!oppCan) v += 0.8;                           // make them say go
      if (level === "hard") {
        if (newCount === 5 || newCount === 10 || newCount === 21) v -= 0.35;  // easy 15 for them
        const rest = st.seats[seat].hand.filter((c) => c !== card);
        v += rest.filter((c) => rankOf(c) === rankOf(card)).length * 0.12;
        v -= cardValue(card) * 0.015;
        v += rng() * 0.15;
      } else {
        v -= cardValue(card) * 0.01;
        v += rng() * 0.7;
      }
      if (!best || v > best.v) best = { v, card };
    }
    return { t: "play", card: best.card };
  }

  function botAct(st, seat, level, rng) {
    if (!st || st.phase === "game_over" || st.phase === "round_over") return null;
    if (seat !== 0 && seat !== 1) return null;
    level = LEVELS.includes(level) ? level : "medium";
    rng = rng || Math.random;
    if (st.phase === "discard") return st.turn === seat ? botDiscard(st, seat, level, rng) : null;
    if (st.phase === "pegging") return st.turn === seat ? botPeg(st, seat, level, rng) : null;
    if (st.phase === "scoring") return st.turn === seat ? { t: "score" } : null;
    return null;
  }

  // An action that is always legal, for a fallback or a room that lost its bot.
  function fallback(st, seat) {
    if (!st || (seat !== 0 && seat !== 1)) return null;
    if (st.phase === "discard") {
      const hand = st.seats[seat].hand;
      return hand.length >= 2 ? { t: "discard", cards: hand.slice(0, 2) } : null;
    }
    if (st.phase === "pegging") {
      const legal = legalPlays(st, seat);
      return legal.length ? { t: "play", card: legal[0] } : { t: "go" };
    }
    if (st.phase === "scoring") return { t: "score" };
    return null;
  }

  g.Cribbage = {
    SUITS, RANKS, ORDER, VALUE, HAND, TABLE_SIZE, CRIB_SIZE, TARGET, PAUSE, LEVELS,
    isCard, rankOf, suitOf, cardValue, cardOrder, makeDeck, shuffle, sortHand,
    create, act, nextRound, view, options, legalPlays, botAct, fallback,
    pegScore, scoreCards, computeReveal,
  };
})(globalThis);
