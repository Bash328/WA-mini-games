/* ============================================================
   lost-cities/engine.js — the rules and the computer players of Lost Cities,
   written once.

   A plain script that sets globalThis.LostCities, so the page loads it with a
   <script> tag and the Worker (worker/card-protocol.mjs) and the tests import
   it for the same effect. The page plays the computer with it; the server runs
   online rooms with it and is the only place the deck and the hands live: a
   player is only ever sent their own cards.

   THE GAME (standard Lost Cities, exactly two seats)
     Five expeditions, one per colour: yellow, blue, white, green and red.
     Each colour has the numbers 2 to 10 and three handshakes (12 cards, 60 in
     the deck). Each player is dealt 8 cards; the other 44 wait in the deck.

     On your turn you do two things, in this order:
       1. play one card onto one of YOUR expeditions, or discard one card face
          up onto its colour's discard pile; then
       2. draw one card: the top of the deck, or the top of any discard pile.

     A number may only go on its expedition when it is higher than the top
     number there (a started expedition may not take a lower or equal card).
     A handshake may only be played before the first number of an expedition;
     several may be stacked. An empty expedition takes any number.

     The round ends as soon as the deck is empty (the player who draws its last
     card keeps it, then the scores are counted). Score each expedition:
     if it holds any cards, (sum of its numbers - 20) x (1 + its handshakes);
     an expedition with no cards is 0. Negative expeditions count negative. Sum
     the five. The higher total wins; a tie goes to the earlier seat.

     A game is one round. nextRound() is false: a rematch is a fresh game.

   Cards are strings: rank + colour ("7Y", "10B"). The three handshakes of a
   colour are "H1Y", "H2Y", "H3Y" (three identical cards, kept distinct so a
   hand can tell them apart); colours are Y B W G R. Everything is plain JSON.
   rng is a function returning [0, 1).
   ============================================================ */
(function (g) {
  "use strict";

  const COLOURS = ["Y", "B", "W", "G", "R"];
  const COLOUR_NAMES = { Y: "yellow", B: "blue", W: "white", G: "green", R: "red" };
  const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10"];
  const HANDSHAKES = 3;
  const HAND = 8, TABLE_SIZE = 2, DECK_SIZE = 60, PAUSE = 0;
  const LEVELS = ["easy", "medium", "hard"];

  const isHandshake = (c) => typeof c === "string" && /^H[1-3]$/.test(c.slice(0, -1));
  const rankOf = (c) => c.slice(0, -1);
  const colourOf = (c) => c.slice(-1);
  const indexOf = (colour) => COLOURS.indexOf(colour);
  const VALUE = (c) => (isHandshake(c) ? 0 : Number(rankOf(c)));
  const isCard = (c) => typeof c === "string" && COLOURS.indexOf(colourOf(c)) !== -1
    && (isHandshake(c) || RANKS.indexOf(rankOf(c)) !== -1);

  function makeDeck() {
    const d = [];
    for (const colour of COLOURS) {
      for (let h = 1; h <= HANDSHAKES; h++) d.push("H" + h + colour);
      for (const rank of RANKS) d.push(rank + colour);
    }
    return d;
  }
  function shuffle(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }
  // group by colour, handshakes before numbers, numbers ascending
  const sortHand = (hand) => hand.sort((a, b) =>
    indexOf(colourOf(a)) - indexOf(colourOf(b)) || VALUE(a) - VALUE(b));

  function deal(st, rng) {
    const deck = shuffle(makeDeck(), rng);
    st.seats.forEach((s, i) => {
      s.hand = sortHand(deck.slice(i * HAND, (i + 1) * HAND));
      s.expeditions = COLOURS.map(() => []);
      s.score = 0;
    });
    st.deck = deck.slice(TABLE_SIZE * HAND);
    st.discards = COLOURS.map(() => []);
    st.turn = st.starter === 1 ? 1 : 0;
    st.stage = "action";
    st.phase = "play";
    st.winner = null;
    st.final = null;
  }

  function create(opts, rng) {
    opts = opts || {};
    const names = Array.isArray(opts.names) ? opts.names : ["You", "Computer"];
    if (names.length !== TABLE_SIZE) throw new Error("Lost Cities needs exactly 2 seats");
    const bots = opts.bots || [];
    const st = {
      v: 1, game: "lost-cities", phase: "play", round: 1, moves: 0,
      seats: names.map((name, i) => ({ name, bot: bots[i] || null, hand: [], expeditions: COLOURS.map(() => []), score: 0 })),
      deck: [], discards: COLOURS.map(() => []), turn: 0, stage: "action",
      starter: opts.starter === 1 ? 1 : 0, winner: null, final: null,
    };
    deal(st, rng);
    return st;
  }

  /* ---------- what may be played ---------- */
  function pileFor(st, seat, card) {
    return st.seats[seat].expeditions[indexOf(colourOf(card))];
  }
  // A handshake goes only before the first number; a number must beat the top number.
  function canPlayOn(pile, card) {
    if (!Array.isArray(pile) || !isCard(card)) return false;
    if (isHandshake(card)) return !pile.some((c) => !isHandshake(c));
    if (!pile.length) return true;
    const top = pile[pile.length - 1];
    if (isHandshake(top)) return true;
    return VALUE(card) > VALUE(top);
  }
  function legalPlays(st, seat) {
    if (!st || st.phase !== "play" || (seat !== 0 && seat !== 1)) return [];
    if (seat !== st.turn || st.stage !== "action") return [];
    const hand = st.seats[seat].hand;
    return hand.filter((c) => canPlayOn(pileFor(st, seat, c), c));
  }
  function drawSources(st) {
    const out = [];
    if (st.deck.length) out.push("deck");
    st.discards.forEach((p, i) => { if (p.length) out.push(COLOURS[i]); });
    return out;
  }

  /* ---------- playing, discarding, drawing ---------- */
  function act(st, seat, action, rng) {
    if (!st || !action || typeof action !== "object") return { ok: false, error: "bad-action" };
    if (st.phase !== "play") return { ok: false, error: "not-playing" };
    if (seat !== 0 && seat !== 1) return { ok: false, error: "bad-seat" };
    if (seat !== st.turn) return { ok: false, error: "not-your-turn" };
    const me = st.seats[seat];
    const events = [];

    if (st.stage === "action") {
      if (action.t === "play") {
        const card = action.card;
        if (!isCard(card) || me.hand.indexOf(card) === -1) return { ok: false, error: "not-in-hand" };
        const ci = indexOf(colourOf(card));
        if (!canPlayOn(me.expeditions[ci], card)) return { ok: false, error: "illegal" };
        me.hand.splice(me.hand.indexOf(card), 1);
        me.expeditions[ci].push(card);
        st.moves++;
        st.stage = "draw";
        events.push({ e: "play", seat, card, colour: COLOURS[ci] });
        return { ok: true, events };
      }
      if (action.t === "discard") {
        const card = action.card;
        if (!isCard(card) || me.hand.indexOf(card) === -1) return { ok: false, error: "not-in-hand" };
        const ci = indexOf(colourOf(card));
        me.hand.splice(me.hand.indexOf(card), 1);
        st.discards[ci].push(card);
        st.moves++;
        st.stage = "draw";
        events.push({ e: "discard", seat, card, colour: COLOURS[ci] });
        return { ok: true, events };
      }
      return { ok: false, error: "bad-action" };
    }

    if (action.t !== "draw") return { ok: false, error: "draw-first" };
    const from = action.from;
    let card;
    if (from === "deck") {
      if (!st.deck.length) return { ok: false, error: "deck-empty" };
      card = st.deck.pop();
      events.push({ e: "draw", seat, from: "deck" });          // never name a card taken from the deck
    } else if (COLOURS.indexOf(from) !== -1) {
      const ci = indexOf(from);
      if (!st.discards[ci].length) return { ok: false, error: "discard-empty" };
      card = st.discards[ci].pop();
      events.push({ e: "draw", seat, from, card });            // a discard top is public
    } else return { ok: false, error: "bad-source" };

    me.hand.push(card);
    sortHand(me.hand);
    st.moves++;
    st.stage = "action";
    st.turn = 1 - seat;
    if (!st.deck.length) finish(st, events);
    return { ok: true, events };
  }

  /* ---------- scoring ---------- */
  function scoreExpedition(pile) {
    if (!Array.isArray(pile) || !pile.length) return 0;
    let mult = 1, sum = 0;
    for (const c of pile) {
      if (isHandshake(c)) mult++;
      else sum += VALUE(c);
    }
    return (sum - 20) * mult;
  }
  function scoreSeat(seatState) {
    return seatState.expeditions.reduce((total, pile) => total + scoreExpedition(pile), 0);
  }

  function finish(st, events) {
    st.phase = "game_over";
    st.stage = "over";
    const scores = st.seats.map(scoreSeat);
    st.seats.forEach((s, i) => { s.score = scores[i]; });
    const draw = scores[0] === scores[1];
    st.winner = scores[0] >= scores[1] ? 0 : 1;              // a tie goes to the earlier seat
    st.final = {
      scores: scores.slice(), draw,
      expeditions: st.seats.map((s) => s.expeditions.map((p) => p.slice())),
      expScores: st.seats.map((s) => s.expeditions.map(scoreExpedition)),
      handshakes: st.seats.map((s) => s.expeditions.map((p) => p.filter(isHandshake).length)),
    };
    if (Array.isArray(events)) {
      events.push({ e: "score", scores: scores.slice(), draw });
      events.push({ e: "win", seat: st.winner, draw });
    }
    return st.final;
  }

  /* Lost Cities is one round: a rematch makes a fresh state. */
  function nextRound(st) { return false; }

  /* ---------- the view ---------- */
  function options(st, seat) {
    if (!st || st.phase !== "play" || (seat !== 0 && seat !== 1) || seat !== st.turn) {
      return { play: [], discard: [], draw: [] };
    }
    if (st.stage === "draw") return { play: [], discard: [], draw: drawSources(st) };
    return { play: legalPlays(st, seat), discard: st.seats[seat].hand.slice(), draw: [] };
  }
  function view(st, seat) {
    const me = seat === 0 || seat === 1 ? seat : null;
    const scores = st.seats.map(scoreSeat);
    return {
      v: 1, game: "lost-cities", phase: st.phase, round: st.round, moves: st.moves,
      turn: st.turn, stage: st.stage, winner: st.winner,
      draw: !!(st.final && st.final.draw), deck: st.deck.length,
      discards: st.discards.map((p) => p.slice()),
      scores: scores.slice(), final: st.final,
      seats: st.seats.map((s, i) => ({
        name: s.name, bot: s.bot, score: scores[i], count: s.hand.length,
        hand: i === me ? s.hand.slice() : undefined,
        expeditions: s.expeditions.map((p) => p.slice()),
        expScores: s.expeditions.map(scoreExpedition),
      })),
      options: me === null ? { play: [], discard: [], draw: [] } : options(st, me),
    };
  }

  /* ---------- the computer players ---------- */
  const sameColour = (hand, ci) => hand.filter((c) => indexOf(colourOf(c)) === ci);
  const numbersOf = (hand, ci) => sameColour(hand, ci).filter((c) => !isHandshake(c));

  // How good it feels to put this card on its expedition now.
  function playValue(st, seat, card) {
    const me = st.seats[seat];
    const ci = indexOf(colourOf(card));
    const pile = me.expeditions[ci];
    let v;
    if (isHandshake(card)) {
      const nums = numbersOf(me.hand, ci);
      v = 1.5 + nums.length * 1.5 + (nums.length >= 2 ? 2 : 0);
      if (!nums.length) v = -4;                            // multiplies nothing (yet)
    } else {
      const n = VALUE(card);
      if (!pile.length) v = 8.5 - n * 0.65;                // a low first card leaves room
      else v = 5.5 + (1 + pile.filter(isHandshake).length) * 1.4 + n * 0.1;
      if (!pile.length && st.deck.length < 6) v -= 2;      // late, a new expedition rarely pays
    }
    v += Math.min(pile.length, 6) * 0.25;                  // we are already invested here
    return v;
  }

  // How much it hurts to throw this card away (lower is a better discard).
  function discardPenalty(st, seat, card) {
    const me = st.seats[seat];
    const ci = indexOf(colourOf(card));
    const pile = me.expeditions[ci];
    const nums = numbersOf(me.hand, ci);
    if (isHandshake(card)) {
      let p = 1 + nums.length * 1.6;
      if (nums.length >= 2 && !pile.some((c) => !isHandshake(c))) p += 3;
      return p;
    }
    const n = VALUE(card);
    if (pile.some((c) => !isHandshake(c))) {
      const top = VALUE(pile[pile.length - 1]);
      return n > top ? 9 + (n - top) * 0.3 : 0.4;          // it still extends that expedition
    }
    if (pile.length) return 2.2 + (10 - n) * 0.2;          // numbers can start a handshaken pile
    const lower = nums.filter((c) => VALUE(c) < n).length;
    if (n <= 4) return 3.4;
    if (lower >= 2) return 2.4;
    if (n <= 7) return 2.0;
    return st.deck.length < 8 ? 1.4 : 0.5;                 // a high card with no lower ones is dead weight
  }

  function botDraw(st, seat, level, rng) {
    const sources = drawSources(st);
    if (!sources.length) return null;
    if (!st.deck.length) return { t: "draw", from: sources[0] };
    if (level === "easy") return { t: "draw", from: sources[Math.floor(rng() * sources.length)] };
    const me = st.seats[seat];
    let pick = null;
    for (const from of sources) {
      if (from === "deck") continue;
      const ci = indexOf(from);
      const top = st.discards[ci][st.discards[ci].length - 1];
      if (!canPlayOn(me.expeditions[ci], top)) continue;
      if (isHandshake(top) && !numbersOf(me.hand, ci).length) continue;   // no numbers for it to double
      let v = 2.5 + (isHandshake(top) ? 0.5 : VALUE(top) * 0.08);
      if (level === "hard" && !me.expeditions[ci].length && VALUE(top) > 7) v -= 1.2;
      if (!pick || v > pick.v) pick = { v, from };
    }
    if (pick && (level === "hard" || rng() < 0.75)) return { t: "draw", from: pick.from };
    return { t: "draw", from: "deck" };
  }

  function botAct(st, seat, level, rng) {
    if (!st || st.phase !== "play" || (seat !== 0 && seat !== 1) || seat !== st.turn) return null;
    if (LEVELS.indexOf(level) === -1) level = "medium";
    if (!rng) rng = Math.random;
    if (st.stage === "draw") return botDraw(st, seat, level, rng);

    const plays = legalPlays(st, seat);
    const hand = st.seats[seat].hand;
    if (level === "easy") {
      if (plays.length && rng() < 0.6) return { t: "play", card: plays[Math.floor(rng() * plays.length)] };
      if (!hand.length) return null;
      return { t: "discard", card: hand[Math.floor(rng() * hand.length)] };
    }

    let bestPlay = null;
    for (const card of plays) {
      const v = playValue(st, seat, card) + rng() * (level === "hard" ? 0.3 : 0.9);
      if (!bestPlay || v > bestPlay.v) bestPlay = { v, card };
    }
    const threshold = level === "hard" ? 3.2 : 2.4;
    if (bestPlay && bestPlay.v >= threshold) return { t: "play", card: bestPlay.card };
    if (!hand.length) return null;

    let worst = null;
    for (const card of hand) {
      const p = discardPenalty(st, seat, card) - rng() * 0.25;
      if (!worst || p < worst.p) worst = { p, card };
    }
    return { t: "discard", card: worst.card };
  }

  // An action that is always legal, for when a bot or a room fallback needs one.
  function fallback(st, seat) {
    if (!st) return null;
    if (st.stage === "draw") {
      const sources = drawSources(st);
      return sources.length ? { t: "draw", from: sources[0] } : null;
    }
    const legal = legalPlays(st, seat);
    if (legal.length) return { t: "play", card: legal[0] };
    const hand = st.seats[seat] ? st.seats[seat].hand : [];
    return hand.length ? { t: "discard", card: hand[0] } : null;
  }

  g.LostCities = {
    COLOURS, COLOUR_NAMES, RANKS, HANDSHAKES, HAND, TABLE_SIZE, DECK_SIZE, PAUSE, LEVELS,
    isCard, isHandshake, rankOf, colourOf, indexOf, VALUE, makeDeck, shuffle, sortHand,
    create, act, nextRound, view, options, legalPlays, canPlayOn, drawSources,
    scoreExpedition, scoreSeat, finish, botAct, botDraw, fallback,
  };
})(globalThis);
