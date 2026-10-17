/* ============================================================
   crazy-8/engine.js — the rules and the computer players of Crazy 8, written once.

   A plain script that sets globalThis.Crazy8, so the page loads it with a
   <script> tag and the Worker (worker/card-room.mjs) and the tests import it
   for the same effect. One copy means the browser (playing the computer) and
   the server (running online rooms) can never disagree about a rule.

   THE GAME (house rules)
     One deck of 54: 52 cards plus 2 jokers. Every round deals 8 cards each.
     Play a card that matches the top card by suit or rank.
       2      next player picks up 2          joker  next player picks up 5
              2s and jokers chain (any suit); whoever cannot chain or block picks
              up the WHOLE total, and their turn ends
       Ace    blocks a pending pick-up; after any Ace or joker the next player
              may play any card
       J      jump: the next player is skipped
       7      reverses direction (with two players still in, you play again; so
              does a J)
       8      goes on a card of the same suit (or on another 8) and you name any
              suit; it cannot dodge a pending pick-up
     A pending pick-up can only be answered by a 2, a joker or an Ace, or by
     picking up. On your turn you may pick up one card instead of playing, even
     holding a legal card; if the card you drew can be played you may play it,
     otherwise (or if you pass) the turn moves on. Going down to one card
     without having pressed "last card" costs 2 cards. You can win on any card.
     The flipped start card, if special, hits the first player: 2/joker = they
     face the pick-up, J = they are skipped, 7 = direction reverses and the
     player on the other side starts, Ace/8 = they play anything.

     Modes: "normal" (first to empty their hand wins the game) and "tournament"
     (a round ends when one player still holds cards: that player is out, the
     rest play a fresh round, until one is left).

   Cards are strings: rank + suit ("7H", "10S", "KD", "AC") or "X1" / "X2" for
   the jokers. Suits: S H D C. The state is plain JSON.
   ============================================================ */
(function (g) {
  "use strict";

  const SUITS = ["S", "H", "D", "C"];
  const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
  const HAND = 8, JOKER_PICK = 5, MAX_SEATS = 4;

  const isJoker = (c) => c === "X1" || c === "X2";
  const rankOf = (c) => (isJoker(c) ? "X" : c.slice(0, -1));
  const suitOf = (c) => (isJoker(c) ? null : c.slice(-1));
  const isCard = (c) => typeof c === "string" && (isJoker(c) || (SUITS.includes(c.slice(-1)) && RANKS.includes(c.slice(0, -1))));

  function makeDeck() {
    const d = [];
    for (const s of SUITS) for (const r of RANKS) d.push(r + s);
    d.push("X1", "X2");
    return d;
  }
  function shuffle(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  /* ---------- creating a game ---------- */
  // opts: { names: [...], bots: [null | "easy" | "medium" | "hard", ...], mode, starter }
  function create(opts, rng) {
    const n = opts.names.length;
    if (n < 2 || n > MAX_SEATS) throw new Error("2 to 4 players");
    const st = {
      v: 1, mode: opts.mode === "tournament" ? "tournament" : "normal", round: 0,
      seats: opts.names.map((name, i) => ({ name: name, bot: (opts.bots && opts.bots[i]) || null, hand: [], status: "in" })),
      dir: 1, turn: 0, draw: [], discard: [], cons: { any: true }, pending: 0, drawn: null,
      starter: opts.starter || 0, phase: "play", finished: [], winner: null, eliminated: null, moves: 0,
    };
    deal(st, rng);
    return st;
  }

  const activeSeats = (st) => st.seats.map((s, i) => i).filter((i) => st.seats[i].status === "in");

  // The seat `steps` places on from `from`, in the current direction, among the seats still in the round.
  function advance(st, from, steps) {
    const n = st.seats.length;
    let i = from;
    for (let k = 0; k < steps; k++) {
      let guard = 0;
      do { i = (i + st.dir + n) % n; } while (st.seats[i].status !== "in" && ++guard <= n);
    }
    return i;
  }

  // Deal a fresh round to the seats that are in. The start seat goes first (after any start-card effect).
  function deal(st, rng) {
    st.round++;
    st.draw = shuffle(makeDeck(), rng);
    st.discard = []; st.pending = 0; st.drawn = null; st.dir = 1; st.phase = "play";
    st.finished = []; st.eliminated = null; st.winner = null;
    st.seats.forEach((s) => { s.hand = []; });
    const act = activeSeats(st);
    for (let r = 0; r < HAND; r++) for (const i of act) st.seats[i].hand.push(st.draw.pop());
    const first = act.includes(st.starter) ? st.starter : act[0];
    const c = st.draw.pop();
    st.discard.push(c);
    st.turn = first;
    const r = rankOf(c), s = suitOf(c);
    if (r === "2") { st.pending = 2; st.cons = { suit: s, rank: "2" }; }
    else if (r === "X") { st.pending = JOKER_PICK; st.cons = { any: true }; }
    else if (r === "J") { st.cons = { suit: s, rank: "J" }; st.turn = advance(st, first, 1); }       // the first player is skipped
    else if (r === "7") { st.dir = -1; st.cons = { suit: s, rank: "7" }; st.turn = advance(st, first, 1); }  // the player on the other side starts
    else if (r === "A" || r === "8") st.cons = { any: true };
    else st.cons = { suit: s, rank: r };
    return st;
  }

  /* ---------- what is allowed ---------- */
  function playable(st, card) {
    if (st.pending > 0) return isJoker(card) || rankOf(card) === "2" || rankOf(card) === "A";
    if (isJoker(card)) return true;                                   // a joker goes on anything
    const c = st.cons;
    if (c.any) return true;
    const r = rankOf(card), s = suitOf(card);
    if (r === "8") return s === c.suit || c.rank === "8";             // an 8 follows the suit (or goes on another 8)
    return s === c.suit || r === c.rank;
  }
  // The cards the player to move can play right now.
  function legalPlays(st, seat) {
    if (st.phase !== "play" || seat !== st.turn) return [];
    const hand = st.drawn ? [st.drawn] : st.seats[seat].hand;
    return Array.from(new Set(hand.filter((c) => playable(st, c))));
  }
  function options(st, seat) {
    const mine = st.phase === "play" && seat === st.turn;
    return {
      plays: legalPlays(st, seat),
      draw: mine && !st.drawn,                    // pick up (the pending total, or one card)
      pass: mine && !!st.drawn,                   // keep the card you drew and end the turn
    };
  }

  /* ---------- changing the game ---------- */
  function drawCards(st, seat, n, events) {
    const hand = st.seats[seat].hand;
    let got = 0;
    for (let k = 0; k < n; k++) {
      if (!st.draw.length && st.discard.length > 1) {          // reshuffle everything but the top card
        const top = st.discard.pop();
        st.draw = shuffle(st.discard, events.rng);
        st.discard = [top];
        events.push({ e: "reshuffle" });
      }
      if (!st.draw.length) break;
      hand.push(st.draw.pop()); got++;
    }
    return got;
  }

  function endOfTurn(st, seat) { st.turn = advance(st, seat, 1); }

  /* Apply an action by `seat`. action: { t: "play", card, suit?, last? } | { t: "draw" } | { t: "pass" }.
     Returns { ok: true, events } or { ok: false, error } (the state is untouched on error). */
  function act(st, seat, action, rng) {
    if (st.phase !== "play") return { ok: false, error: "not-playing" };
    if (seat !== st.turn) return { ok: false, error: "not-your-turn" };
    if (!action || typeof action !== "object") return { ok: false, error: "bad-action" };
    const events = []; events.rng = rng;
    const me = st.seats[seat];

    if (action.t === "pass") {
      if (!st.drawn) return { ok: false, error: "illegal" };
      st.drawn = null; endOfTurn(st, seat);
      events.push({ e: "pass", seat });
      st.moves++;
      return { ok: true, events: events.slice() };
    }

    if (action.t === "draw") {
      if (st.drawn) return { ok: false, error: "illegal" };
      if (st.pending > 0) {
        const want = st.pending;
        const got = drawCards(st, seat, want, events);
        st.pending = 0;
        events.push({ e: "pickup", seat, n: got, total: want });
        endOfTurn(st, seat);
      } else {
        const got = drawCards(st, seat, 1, events);
        events.push({ e: "draw", seat, n: got });
        const c = got ? me.hand[me.hand.length - 1] : null;
        if (c && playable(st, c)) st.drawn = c;               // may be played straight away
        else endOfTurn(st, seat);
      }
      st.moves++;
      return { ok: true, events: events.slice() };
    }

    if (action.t !== "play" || !isCard(action.card)) return { ok: false, error: "bad-action" };
    const card = action.card;
    if (!me.hand.includes(card)) return { ok: false, error: "not-in-hand" };
    if (st.drawn && st.drawn !== card) return { ok: false, error: "illegal" };
    if (!playable(st, card)) return { ok: false, error: "illegal" };
    const rank = rankOf(card), suit = suitOf(card);
    if (rank === "8" && !SUITS.includes(action.suit)) return { ok: false, error: "name-a-suit" };

    me.hand.splice(me.hand.indexOf(card), 1);
    st.discard.push(card);
    st.drawn = null;
    let skip = false, reverse = false;
    events.push({ e: "play", seat, card, suit: rank === "8" ? action.suit : undefined });
    if (rank === "X") { st.pending += JOKER_PICK; st.cons = { any: true }; }
    else if (rank === "2") { st.pending += 2; st.cons = { suit, rank: "2" }; }
    else if (rank === "A") {
      if (st.pending > 0) events.push({ e: "blocked", seat, total: st.pending });
      st.pending = 0; st.cons = { any: true };
    }
    else if (rank === "J") { st.cons = { suit, rank: "J" }; skip = true; }
    else if (rank === "7") { st.cons = { suit, rank: "7" }; reverse = true; }
    else if (rank === "8") st.cons = { suit: action.suit, rank: "8" };
    else st.cons = { suit, rank };

    // down to one card without calling "last card": pick up 2
    if (me.hand.length === 1 && !action.last) {
      const got = drawCards(st, seat, 2, events);
      events.push({ e: "last-missed", seat, n: got });
    }
    st.moves++;

    if (me.hand.length === 0) {
      events.push({ e: "out-of-cards", seat });
      if (st.mode === "normal") {
        st.phase = "game_over"; st.winner = seat;
        events.push({ e: "game-over", winner: seat });
        return { ok: true, events: events.slice() };
      }
      me.status = "safe"; st.finished.push(seat);
      const left = activeSeats(st);
      if (left.length === 1) {                                  // one player still holds cards: out
        const loser = left[0];
        st.seats[loser].status = "out"; st.eliminated = loser;
        events.push({ e: "eliminated", seat: loser });
        const alive = st.seats.map((s, i) => i).filter((i) => st.seats[i].status !== "out");
        if (alive.length === 1) { st.phase = "game_over"; st.winner = alive[0]; events.push({ e: "game-over", winner: alive[0] }); }
        else st.phase = "round_over";
        return { ok: true, events: events.slice() };
      }
    }

    // who is next
    const act2 = activeSeats(st);
    if (reverse) { st.dir = -st.dir; events.push({ e: "reverse", dir: st.dir }); }
    if (act2.length === 2 && (skip || reverse) && st.seats[seat].status === "in") st.turn = seat;   // two left: you play again
    else if (skip) { st.turn = advance(st, seat, 2); events.push({ e: "skip", seat: advance(st, seat, 1) }); }
    else st.turn = advance(st, seat, 1);
    return { ok: true, events: events.slice() };
  }

  // Tournament: after a round, those who got rid of their cards are back in; deal again. The first to go out starts.
  function nextRound(st, rng) {
    if (st.phase !== "round_over") return false;
    st.seats.forEach((s) => { if (s.status === "safe") s.status = "in"; });
    st.starter = st.finished.length ? st.finished[0] : activeSeats(st)[0];
    deal(st, rng);
    return true;
  }
  // A fresh game for the same seats (rematch). `names`/`bots` may be given to change who is playing; the winner starts.
  function rematch(st, opts, rng) {
    const next = create({
      names: (opts && opts.names) || st.seats.map((s) => s.name),
      bots: (opts && opts.bots) || st.seats.map((s) => s.bot),
      mode: (opts && opts.mode) || st.mode,
      starter: opts && opts.starter !== undefined ? opts.starter : (st.winner !== null ? st.winner : 0),
    }, rng);
    return next;
  }

  /* ---------- what a player is allowed to see ---------- */
  // The table as seen from `seat` (null = a spectator): only your own hand is shown; everyone else is a card count.
  function view(st, seat) {
    return {
      v: 1, mode: st.mode, round: st.round, phase: st.phase, you: seat, dir: st.dir, turn: st.turn,
      cons: st.cons, pending: st.pending, top: st.discard[st.discard.length - 1] || null, prev: st.discard.slice(-3, -1),
      drawCount: st.draw.length, discardCount: st.discard.length,
      seats: st.seats.map((s, i) => ({ name: s.name, bot: s.bot, status: s.status, count: s.hand.length, hand: i === seat ? s.hand.slice() : undefined })),
      drawn: seat === st.turn ? st.drawn : null,
      options: seat === null || seat === undefined ? { plays: [], draw: false, pass: false } : options(st, seat),
      winner: st.winner, eliminated: st.eliminated, finished: st.finished.slice(), starter: st.starter,
    };
  }

  /* ---------- the computer players ---------- */
  const count = (hand, f) => hand.reduce((n, c) => n + (f(c) ? 1 : 0), 0);
  function bestSuit(hand) {
    const n = { S: 0, H: 0, D: 0, C: 0 };
    for (const c of hand) { const s = suitOf(c); if (s) n[s]++; }
    let best = SUITS[0];
    for (const s of SUITS) if (n[s] > n[best]) best = s;
    return best;
  }

  /* Choose an action for the seat to move. level: "easy" | "medium" | "hard".
     The computer never forgets to call "last card". */
  function botAct(st, seat, level, rng) {
    const me = st.seats[seat];
    const plays = legalPlays(st, seat);
    const nextSeat = advance(st, seat, 1);
    const nextCount = st.seats[nextSeat].hand.length;
    const mk = (card) => {
      const a = { t: "play", card, last: true };
      if (rankOf(card) === "8") a.suit = bestSuit(me.hand.filter((c) => c !== card));
      return a;
    };
    const rand = (arr) => arr[Math.floor(rng() * arr.length)];

    if (st.drawn) {                                  // I drew a playable card: use it unless that would waste a power card
      const c = st.drawn;
      if (level === "easy" || me.hand.length <= 3 || !["A", "X", "8"].includes(rankOf(c))) return mk(c);
      return { t: "pass" };
    }
    if (st.pending > 0) {                            // answer the pick-up: block, chain, or take it
      const ace = plays.find((c) => rankOf(c) === "A");
      if (ace) return mk(ace);
      const twos = plays.filter((c) => rankOf(c) === "2"), jokers = plays.filter(isJoker);
      if (level === "easy" && rng() < 0.3) return { t: "draw" };
      if (twos.length) return mk(twos[0]);
      if (jokers.length) return mk(jokers[0]);
      return { t: "draw" };
    }
    if (!plays.length) return { t: "draw" };
    if (level === "easy") return rng() < 0.12 ? { t: "draw" } : mk(rand(plays));

    // medium / hard: score each card
    const hand = me.hand;
    const suitCount = {};
    for (const c of hand) { const s = suitOf(c); if (s) suitCount[s] = (suitCount[s] || 0) + 1; }
    const danger = nextCount <= 2;                   // the next player is nearly out: hit them
    let best = null;
    for (const c of plays) {
      const r = rankOf(c), s = suitOf(c);
      let v = 0;
      if (s) v += (suitCount[s] || 0) * 0.6;         // keep long suits alive
      if (r === "A") v -= 6;                         // an Ace is a shield: save it
      if (r === "X") v -= danger ? 0 : 5;
      if (r === "8") v -= hand.length <= 3 ? 0 : 4;  // keep 8s to change suit when stuck
      if (r === "2") v += danger ? 6 : 1.5;
      if (r === "J" || r === "7") v += danger ? 5 : 1;
      if (r === "7" && st.seats.length > 2) v += 0.5;
      if (level === "hard") {
        const others = hand.filter((x) => x !== c);
        if (others.length === 1 && rankOf(others[0]) === "A") v -= 2;     // do not strand an Ace as the last card
        if (hand.length <= 2) v += ["A", "X", "8"].includes(r) ? 4 : 0;   // going out fast beats saving power cards
        v += Math.min(10, count(others, (x) => suitOf(x) === s)) * 0.2;
      }
      v += rng() * (level === "hard" ? 0.3 : 1.2);
      if (!best || v > best.v) best = { v, c };
    }
    return mk(best.c);
  }

  g.Crazy8 = {
    SUITS, RANKS, HAND, JOKER_PICK, MAX_SEATS,
    isJoker, rankOf, suitOf, isCard, makeDeck, shuffle,
    create, deal, act, nextRound, rematch, view, options, legalPlays, activeSeats, advance, botAct,
  };
})(globalThis);
