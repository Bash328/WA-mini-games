/* ============================================================
   skull/engine.js — the rules and the computer players of Skull, written once.

   A plain script that sets globalThis.Skull, so the page loads it with a
   <script> tag and the Worker (worker/card-protocol.mjs) and the tests import it
   for the same effect. The page plays the computer with it; the server runs
   online rooms with it and is the only place the hidden discs live.

   THE GAME (standard Skull, 3 to 6 seats)
     Everyone starts with 4 discs: 3 roses and 1 skull. The discs are identical
     from the back. A round has three parts.

     1. PLACEMENT. In turn, starting with the first player, everyone places at
        least one disc face down. After every player has placed one, the turn
        player may either add another disc (one per turn, until their hand is
        empty) or open the bidding. A player with no discs left in hand must
        open the bidding.

     2. BIDDING. A bid is "I can turn this many discs without finding a skull".
        The first bid is 1 or more. Every raise must be higher, and no bid can
        be higher than the number of discs placed this round. A player may pass
        instead; a passed player is out of the rest of the bidding. Bidding
        ends when everyone but one has passed, or as soon as a bid reaches the
        number of discs on the table. The last player left is the challenger.

     3. THE CHALLENGE. The challenger turns discs one at a time, from the top
        of their own stack down (the most recently placed disc first). Only
        when their own face-down discs are used up do they turn other players'
        discs, in clockwise order from themselves. They stop as soon as they
        have turned their bid. A skull ends the challenge at once: the
        challenger loses one random disc from their remaining set (it is
        removed from the game, and which disc it was is secret). If no skull
        appears, the challenger wins the challenge and scores one point.
        (The bid is a target, not a score: otherwise a bid of 2 would end a
        two-point game on the spot.)

     First to 2 points wins. A player with no discs left is out; the last player
     with discs wins. The challenger starts the next round. If the challenger
     was knocked out, the owner of the skull they turned starts instead; if it
     was their own skull, the next player still in starts.

   Hidden information: view(st, seat) shows that seat's own hand and stack face
   up. Every other seat is counts and face-down discs only, except discs that
   have actually been turned over in the current challenge (those are public).

   Everything is plain JSON. rng is a function returning [0, 1).
   ============================================================ */
(function (g) {
  "use strict";

  const MIN_SEATS = 3, MAX_SEATS = 6, DISCS = 4, TARGET = 2, PAUSE = 8000;
  const LEVELS = ["easy", "medium", "hard"];
  const KINDS = ["rose", "skull"];

  /* The shared Worker (worker/card-protocol.mjs) caps rooms at 6 seats. Skull
     has no fixed table: it seats 3 to 6, so it exports MAX_SEATS and no
     TABLE_SIZE, and the host starts once at least MIN_SEATS are present. */

  const shuffle = (arr, rng) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  };
  // one player's four discs, in a random order (a stack order does not matter
  // in the hand; it becomes public only when it is placed)
  const makeDiscs = (rng) => shuffle(["rose", "rose", "rose", "skull"], rng);

  const discCount = (s) => s.hand.length + s.stack.length;
  const alive = (st) => st.seats.map((s, i) => (s.status === "in" ? i : -1)).filter((i) => i >= 0);
  const totalPlaced = (st) => st.seats.reduce((n, s) => n + (s.status === "in" ? s.stack.length : 0), 0);
  const anteDone = (st) => {
    const live = alive(st);
    return live.length > 0 && live.every((i) => st.seats[i].stack.length > 0);
  };
  function nextAlive(st, from) {
    for (let k = 1; k <= st.seats.length; k++) {
      const i = (from + k) % st.seats.length;
      if (st.seats[i].status === "in") return i;
    }
    return from;
  }
  const activeCount = (st) => alive(st).filter((i) => !st.passed[i]).length;
  function nextActive(st, from) {
    for (let k = 1; k <= st.seats.length; k++) {
      const i = (from + k) % st.seats.length;
      if (st.seats[i].status === "in" && !st.passed[i]) return i;
    }
    return from;
  }
  // how many discs from the top of this player's own stack are roses (safe to
  // turn before a skull would appear)
  function topSafe(st, seat) {
    const stack = st.seats[seat].stack;
    let n = 0;
    for (let i = stack.length - 1; i >= 0; i--) { if (stack[i].kind === "skull") break; n++; }
    return n;
  }
  const hasSkullInStack = (st, seat) => st.seats[seat].stack.some((d) => d.kind === "skull");

  function create(opts, rng) {
    const names = opts && Array.isArray(opts.names) ? opts.names.slice() : null;
    if (!names || names.length < MIN_SEATS || names.length > MAX_SEATS) throw new Error("Skull needs 3 to 6 seats");
    const bots = (opts && opts.bots) || [];
    const starter = Number.isInteger(opts && opts.starter) && opts.starter >= 0 && opts.starter < names.length ? opts.starter : 0;
    return {
      v: 1, game: "skull", mode: "normal", phase: "place", round: 1, moves: 0,
      first: starter, turn: starter,
      seats: names.map((name, i) => ({
        name: String(name), bot: bots[i] || null, hand: makeDiscs(rng), stack: [],
        score: 0, status: "in",
      })),
      bid: null, passed: names.map(() => false), reveal: null, winner: null,
    };
  }

  /* ---------- events and state helpers ---------- */
  function beginReveal(st, events) {
    st.phase = "reveal";
    st.turn = st.bid.seat;
    st.reveal = { seat: st.bid.seat, q: st.bid.q, flips: [], skull: false, success: null, loser: null, lost: false, lostKind: null, score: null, left: st.bid.q };
    events.push({ e: "challenge", seat: st.bid.seat, q: st.bid.q });
    return { ok: true, events };
  }
  function nextFirstAfterFail(st) {
    const bidder = st.reveal.seat;
    if (st.seats[bidder].status === "in") return bidder;
    const skullFlip = st.reveal.flips.slice().reverse().find((f) => f.kind === "skull");
    if (skullFlip && skullFlip.seat !== bidder && st.seats[skullFlip.seat].status === "in") return skullFlip.seat;
    return nextAlive(st, bidder);
  }
  // Remove one random disc from the challenger's remaining set. Discs that are
  // still face down are preferred, so a disc already shown is not made to
  // vanish; if every disc has been turned, one of those is removed instead.
  function loseDisc(st, seat, rng) {
    const s = st.seats[seat], pool = [];
    s.hand.forEach((kind, i) => pool.push({ where: "hand", i }));
    s.stack.forEach((d, i) => { if (!d.up) pool.push({ where: "stack", i }); });
    if (!pool.length) s.stack.forEach((d, i) => pool.push({ where: "stack", i }));
    if (!pool.length) return null;
    const p = pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))];
    const kind = p.where === "hand" ? s.hand.splice(p.i, 1)[0] : s.stack.splice(p.i, 1)[0].kind;
    if (discCount(s) === 0) s.status = "out";
    return kind;
  }
  // the next face-down disc the challenger must turn
  function nextFlipTarget(st) {
    const bidder = st.reveal.seat;
    const own = st.seats[bidder].stack;
    for (let i = own.length - 1; i >= 0; i--) if (!own[i].up) return { seat: bidder, disc: own[i] };
    for (let k = 1; k < st.seats.length; k++) {
      const i = (bidder + k) % st.seats.length;
      if (i === bidder || st.seats[i].status !== "in") continue;
      const stack = st.seats[i].stack;
      for (let j = stack.length - 1; j >= 0; j--) if (!stack[j].up) return { seat: i, disc: stack[j] };
    }
    return null;
  }

  /* ---------- the actions ---------- */
  function act(st, seat, action, rng) {
    if (!st || st.phase === "game_over") return { ok: false, error: "not-playing" };
    if (!Number.isInteger(seat) || seat < 0 || seat >= st.seats.length) return { ok: false, error: "bad-seat" };
    if (!action || typeof action !== "object") return { ok: false, error: "bad-action" };
    if (st.phase === "round_over") return { ok: false, error: "round-over" };
    if (st.seats[seat].status !== "in") return { ok: false, error: "out" };
    if (seat !== st.turn) return { ok: false, error: "not-your-turn" };
    const events = [];

    if (action.t === "place") {
      if (st.phase !== "place") return { ok: false, error: "not-placing" };
      const s = st.seats[seat];
      if (!s.hand.length) return { ok: false, error: "no-discs" };
      const i = action.i;
      if (!Number.isInteger(i) || i < 0 || i >= s.hand.length) return { ok: false, error: "bad-disc" };
      const kind = s.hand.splice(i, 1)[0];
      s.stack.push({ kind, up: false });
      st.moves++;
      events.push({ e: "place", seat, placed: s.stack.length });
      st.turn = nextAlive(st, seat);
      return { ok: true, events };
    }

    if (action.t === "bid") {
      if (st.phase !== "place" && st.phase !== "bid") return { ok: false, error: "not-bidding" };
      if (st.phase === "place" && !anteDone(st)) return { ok: false, error: "must-place" };
      const total = totalPlaced(st), q = action.q;
      if (!Number.isInteger(q) || q < 1 || q > total) return { ok: false, error: "illegal-bid" };
      if (st.phase === "bid" && (!st.bid || q <= st.bid.q)) return { ok: false, error: "illegal-bid" };
      if (st.phase === "place") {
        st.phase = "bid";
        st.bid = { seat, q };
        st.moves++;
        events.push({ e: "bid", seat, q });
        if (q === total) return beginReveal(st, events);
        st.turn = nextActive(st, seat);
        return { ok: true, events };
      }
      st.bid = { seat, q };
      st.moves++;
      events.push({ e: "bid", seat, q });
      if (q === total) return beginReveal(st, events);
      st.turn = nextActive(st, seat);
      return { ok: true, events };
    }

    if (action.t === "pass") {
      if (st.phase !== "bid" || !st.bid) return { ok: false, error: "not-bidding" };
      if (st.passed[seat]) return { ok: false, error: "already-passed" };
      st.passed[seat] = true;
      st.moves++;
      events.push({ e: "pass", seat });
      if (activeCount(st) <= 1) return beginReveal(st, events);
      st.turn = nextActive(st, seat);
      return { ok: true, events };
    }

    if (action.t === "flip") {
      if (st.phase !== "reveal" || !st.reveal) return { ok: false, error: "not-revealing" };
      if (st.reveal.seat !== seat) return { ok: false, error: "not-challenger" };
      if (st.reveal.success !== null || st.reveal.skull) return { ok: false, error: "reveal-over" };
      const target = nextFlipTarget(st);
      if (!target) return { ok: false, error: "nothing-to-flip" };
      target.disc.up = true;
      st.moves++;
      st.reveal.flips.push({ seat: target.seat, kind: target.disc.kind });
      st.reveal.left = st.reveal.q - st.reveal.flips.length;
      events.push({ e: "flip", seat: target.seat, kind: target.disc.kind, n: st.reveal.flips.length, q: st.reveal.q });

      if (target.disc.kind === "skull") {
        st.reveal.skull = true; st.reveal.success = false; st.reveal.loser = seat;
        const lost = loseDisc(st, seat, rng);
        st.reveal.lost = true; st.reveal.lostKind = lost;
        events.push({ e: "lose", seat, count: discCount(st.seats[seat]) });
        if (st.seats[seat].status === "out") events.push({ e: "out", seat });
        const left = alive(st);
        if (left.length <= 1) {
          st.phase = "game_over";
          st.winner = left.length ? left[0] : null;
          st.first = st.winner === null ? st.first : st.winner;
          st.turn = st.first;
          events.push({ e: "win", seat: st.winner, reason: "last" });
        } else {
          st.phase = "round_over";
          st.first = nextFirstAfterFail(st);
          st.turn = st.first;
        }
        return { ok: true, events };
      }

      if (st.reveal.flips.length >= st.reveal.q) {
        st.reveal.success = true;
        st.seats[seat].score++;
        st.reveal.score = st.seats[seat].score;
        events.push({ e: "challenge-won", seat, q: st.reveal.q, score: st.seats[seat].score });
        if (st.seats[seat].score >= TARGET) {
          st.phase = "game_over"; st.winner = seat; st.first = seat; st.turn = seat;
          events.push({ e: "win", seat, reason: "points" });
        } else {
          st.phase = "round_over"; st.first = seat; st.turn = seat;
        }
      }
      return { ok: true, events };
    }

    return { ok: false, error: "bad-action" };
  }

  function nextRound(st, rng) {
    if (!st || st.phase !== "round_over") return false;
    st.round++;
    st.seats.forEach((s) => {
      if (s.hand.length || s.stack.length) {
        for (const d of s.stack) s.hand.push(d.kind);
        s.stack = [];
        shuffle(s.hand, rng);
      } else s.stack = [];
    });
    st.bid = null;
    st.passed = st.seats.map(() => false);
    st.reveal = null;
    st.phase = "place";
    st.turn = st.first !== undefined && st.seats[st.first] && st.seats[st.first].status === "in" ? st.first : nextAlive(st, st.first || 0);
    return true;
  }

  /* ---------- the view ---------- */
  function publicReveal(st, seat) {
    const r = st.reveal;
    if (!r) return null;
    return {
      seat: r.seat, q: r.q, flips: r.flips.map((f) => ({ seat: f.seat, kind: f.kind })),
      skull: r.skull, success: r.success, loser: r.loser, lost: r.lost,
      left: Math.max(0, r.q - r.flips.length), score: r.score,
      // which disc the challenger lost is secret: only they are told
      lostKind: seat !== null && seat === r.loser ? r.lostKind : undefined,
    };
  }

  function view(st, seat) {
    const mine = seat !== null && seat !== undefined && seat >= 0 && seat < st.seats.length;
    const me = mine ? st.seats[seat] : null;
    const total = totalPlaced(st);
    const ante = anteDone(st);
    const myTurn = !!me && st.turn === seat && st.phase !== "round_over" && st.phase !== "game_over";
    const out = {
      v: 1, game: "skull", phase: st.phase, round: st.round, turn: st.turn,
      first: st.first, bid: st.bid, winner: st.winner,
      totalPlaced: total, anteDone: ante, minSeats: MIN_SEATS, maxSeats: MAX_SEATS,
      target: TARGET, discs: DISCS, pause: PAUSE, levels: LEVELS.slice(),
      reveal: publicReveal(st, mine ? seat : null),
      seats: st.seats.map((s, i) => ({
        name: s.name, bot: s.bot, score: s.score, status: s.status,
        count: discCount(s), placed: s.stack.length, handCount: s.hand.length,
        passed: !!st.passed[i], first: st.first === i,
        stack: s.stack.map((d) => ({ up: !!d.up, kind: i === seat || d.up ? d.kind : null })),
        hand: i === seat ? s.hand.slice() : null,
      })),
    };
    out.options = {
      place: st.phase === "place" && myTurn && !!me && me.hand.length > 0,
      bid: ((st.phase === "place" && myTurn && ante) || (st.phase === "bid" && myTurn)) && total > 0,
      minBid: st.phase === "bid" && st.bid ? st.bid.q + 1 : 1,
      maxBid: total,
      canPass: st.phase === "bid" && myTurn,
      canFlip: st.phase === "reveal" && myTurn && !!st.reveal && st.reveal.seat === seat && st.reveal.success === null && !st.reveal.skull,
      anteDone: ante,
    };
    return out;
  }

  /* ---------- the computer ---------- */
  // How high this seat can bid without turning a skull of its own: the roses on
  // top of its stack. If the stack holds no skull at all, every own disc is
  // safe (a bid above the stack would then turn other players' discs).
  const maxSafeBid = (st, seat) => (hasSkullInStack(st, seat) ? topSafe(st, seat) : st.seats[seat].stack.length);

  function chooseDisc(st, seat, level, rng) {
    const hand = st.seats[seat].hand;
    const skull = hand.indexOf("skull"), rose = hand.indexOf("rose");
    if (level === "easy") return Math.floor(rng() * hand.length);
    // A rose in the ante is the disc that can open the bidding safely: a skull
    // is only a nuisance to its owner if it is the only disc placed when the
    // bidding starts. Medium and hard put roses down first and keep the skull
    // for a bluff only when they have no rose left (and then they prefer to bid
    // instead of placing it).
    if (rose >= 0) return rose;
    return skull >= 0 ? skull : 0;
  }

  function botAct(st, seat, level, rng) {
    if (!st || st.phase === "round_over" || st.phase === "game_over") return null;
    const lv = LEVELS.includes(level) ? level : "medium";
    if (st.phase === "reveal") return { t: "flip" };
    if (seat !== st.turn) return fallback(st, seat);

    if (st.phase === "bid") {
      const total = totalPlaced(st), next = (st.bid ? st.bid.q : 0) + 1, safe = maxSafeBid(st, seat);
      if (next > total) return { t: "pass" };
      if (next <= safe) {
        if (lv === "easy" && rng() < 0.15) return { t: "pass" };
        return { t: "bid", q: next };
      }
      // hard will sometimes risk one disc from another player's stack when its
      // own stack is all roses
      if (lv === "hard" && !hasSkullInStack(st, seat) && next <= safe + 1 && rng() < 0.35) return { t: "bid", q: next };
      return { t: "pass" };
    }

    // placement, including the opening bid
    const s = st.seats[seat], ante = anteDone(st);
    if (!ante) return { t: "place", i: chooseDisc(st, seat, lv, rng) };
    const safe = topSafe(st, seat), roses = s.hand.filter((k) => k === "rose").length;
    const target = lv === "easy" ? 1 + Math.floor(rng() * 2) : lv === "medium" ? 2 : 3;
    // A skull on top is never worth bidding on while a rose can be placed over
    // it; below the target, always adding a rose is a bot's safe plan.
    const add = safe === 0 ? roses > 0 : roses > 0 && safe < target && rng() < (lv === "easy" ? 0.45 : 0.7);
    if (add) return { t: "place", i: s.hand.indexOf("rose") };
    const total = totalPlaced(st);
    let q = Math.max(1, Math.min(total, safe));
    if (lv === "easy") q = Math.max(1, Math.min(total, 1 + Math.floor(rng() * Math.max(1, safe))));
    else if (lv === "medium" && safe > 1 && rng() < 0.2) q = Math.max(1, q - 1);
    return { t: "bid", q };
  }

  // an action that is always legal for the seat to move (the page and the room
  // play it if a computer's choice is refused)
  function fallback(st, seat) {
    if (!st) return null;
    if (st.phase === "place") {
      const s = st.seats[seat];
      if (st.turn === seat && s.hand.length) return { t: "place", i: 0 };
      const total = totalPlaced(st);
      return { t: "bid", q: Math.max(1, Math.min(total, 1)) };
    }
    if (st.phase === "bid") {
      const total = totalPlaced(st), q = st.bid ? st.bid.q + 1 : 1;
      return q <= total ? { t: "bid", q } : { t: "pass" };
    }
    if (st.phase === "reveal") return { t: "flip" };
    return null;
  }

  g.Skull = {
    MIN_SEATS, MAX_SEATS, DISCS, TARGET, PAUSE, LEVELS, KINDS,
    create, act, nextRound, view, botAct, fallback,
    makeDiscs, discCount, alive, totalPlaced, anteDone, topSafe, hasSkullInStack, maxSafeBid,
  };
})(globalThis);
