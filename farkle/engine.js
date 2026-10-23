/* ============================================================
   farkle/engine.js — the rules and the computer players of Farkle (10,000),
   written once.

   A plain script that sets globalThis.Farkle, so the page loads it with a
   <script> tag and the Worker (worker/card-protocol.mjs) and the tests import
   it for the same effect. The page plays the computer with it; the server runs
   online rooms with it and is the only place the dice are rolled.

   THE GAME (six dice, first to 10,000)
     On your turn, roll the dice still in play. After a roll you must set aside
     at least one die that scores; then you may bank the turn's points or roll
     the dice that are left. A roll with no scoring die at all is a FARKLE: the
     turn's points are lost and the dice pass to the next player. Set aside all
     six and it is HOT DICE: all six are rolled again and the turn goes on.
     Bank 10,000 or more to win.

   HOUSE SCORING
     1 = 100, 5 = 50
     three 1s = 1000; three 2s-6s = face x 100 (200-600)
     four of a kind = 1000, five = 2000, six = 3000
     a straight 1-6 = 1500
     three pairs = 1500
     A set-aside selection must be scoring all through: a stray 2 or 3 cannot
     ride along with a 1 (that would simply remove a bad die). Combinations are
     formed within one roll; singles (1s and 5s) add up across rolls.

   Everything is plain JSON. rng is a function returning [0, 1).
   ============================================================ */
(function (g) {
  "use strict";

  const TARGET = 10000, DICE = 6, MAX_SEATS = 4, PAUSE = 0;
  const LEVELS = ["easy", "medium", "hard"];

  const rollDie = (rng) => 1 + Math.floor(rng() * 6);
  const nextSeat = (st, i) => (i + 1) % st.seats.length;

  function counts(vals) {
    const c = [0, 0, 0, 0, 0, 0, 0];
    for (let i = 0; i < vals.length; i++) c[vals[i]]++;
    return c;
  }
  const isStraight = (c) => [1, 2, 3, 4, 5, 6].every((f) => c[f] === 1);
  const isThreePairs = (c) => c.filter((x) => x === 2).length === 3;

  /* The house scoring table for a set of dice. `used` is how many of the dice
     the score actually accounts for: a selection must use every one of them. */
  function scoreSet(vals) {
    const n = vals.length;
    if (!n) return { score: 0, used: 0 };
    const c = counts(vals);
    if (n === DICE && isStraight(c)) return { score: 1500, used: DICE };
    if (n === DICE && isThreePairs(c)) return { score: 1500, used: DICE };
    let score = 0, used = 0;
    for (let f = 1; f <= 6; f++) {
      const q = c[f];
      if (q >= 3) {
        score += q === 3 ? (f === 1 ? 1000 : f * 100) : q === 4 ? 1000 : q === 5 ? 2000 : 3000;
        used += q;
      } else if (f === 1) {
        score += 100 * q; used += q;
      } else if (f === 5) {
        score += 50 * q; used += q;
      }
    }
    return { score, used };
  }
  // the points for a chosen set, or 0 when some of the dice in it do not score
  function scoreSelection(vals) {
    const r = scoreSet(vals);
    return r.used === vals.length ? r.score : 0;
  }
  // can this roll score at all (i.e. is it not a farkle)?
  function anyScoring(vals) {
    if (vals.some((v) => v === 1 || v === 5)) return true;
    const c = counts(vals);
    if (c.some((x) => x >= 3)) return true;
    if (vals.length === DICE && isThreePairs(c)) return true;
    if (vals.length === DICE && isStraight(c)) return true;
    return false;
  }
  /* The dice to set aside, as indices into `vals`: every legal non-empty
     selection is tried (at most 63 of them). mode "best" takes the most
     points, then the most dice (keeping more dice is safer, and all six is
     hot dice); mode "min" takes the least, for the easy computer's slips. */
  function bestKeep(vals, mode) {
    let best = null;
    const n = Math.min(vals.length, DICE);
    for (let mask = 1; mask < (1 << n); mask++) {
      const idx = [], sel = [];
      for (let i = 0; i < n; i++) if (mask & (1 << i)) { idx.push(i); sel.push(vals[i]); }
      const sc = scoreSelection(sel);
      if (!sc) continue;
      const better = !best ||
        (mode === "min"
          ? sc < best.score || (sc === best.score && idx.length < best.dice.length)
          : sc > best.score || (sc === best.score && idx.length > best.dice.length));
      if (better) best = { score: sc, dice: idx };
    }
    return best ? best.dice : [];
  }

  function create(opts, rng) {
    opts = opts || {};
    const names = Array.isArray(opts.names) ? opts.names.slice(0, MAX_SEATS) : [];
    const bots = Array.isArray(opts.bots) ? opts.bots : [];
    const n = Math.max(2, Math.min(MAX_SEATS, names.length));
    const seats = [];
    for (let i = 0; i < n; i++) {
      seats.push({
        name: String(names[i] || "Player " + (i + 1)).slice(0, 24),
        bot: LEVELS.includes(bots[i]) ? bots[i] : null,
        score: 0,
      });
    }
    let starter = Number.isInteger(opts.starter) ? opts.starter : 0;
    if (starter < 0 || starter >= n) starter = 0;
    return {
      v: 1, game: "farkle", target: TARGET, phase: "play", round: 1, moves: 0,
      seats, turn: starter, awaiting: "roll",
      dice: [], setAside: [], turnScore: 0, winner: null, last: null,
    };
  }

  // put the dice of a fresh throw on the table
  function throwDice(st, rng, events) {
    const n = DICE - st.setAside.length;
    st.dice = Array.from({ length: n }, () => ({ v: rollDie(rng), kept: false }));
    const vals = st.dice.map((d) => d.v);
    events.push({ e: "roll", seat: st.turn, dice: vals });
    return vals;
  }
  function endTurn(st) {
    st.turn = nextSeat(st, st.turn);
    st.awaiting = "roll";
    st.turnScore = 0; st.setAside = []; st.dice = [];
  }
  function loseTurn(st, vals, events) {
    const seat = st.turn, lost = st.turnScore;
    st.last = { t: "farkle", seat, lost, dice: vals.slice() };
    events.push({ e: "farkle", seat, lost });
    endTurn(st);
  }

  /* action: { t: "roll" } | { t: "keep", dice: [indices] } | { t: "bank" } */
  function act(st, seat, action, rng) {
    if (!st || st.phase !== "play") return { ok: false, error: "not-playing" };
    if (!Number.isInteger(seat) || seat !== st.turn) return { ok: false, error: "not-your-turn" };
    if (!action || typeof action.t !== "string") return { ok: false, error: "illegal" };
    const events = [];

    if (action.t === "roll") {
      if (st.awaiting !== "roll" && st.awaiting !== "roll_or_bank") return { ok: false, error: "illegal" };
      if (st.awaiting === "roll_or_bank") {
        // the dice kept from the last throw leave the table and stay banked for this turn
        st.dice.forEach((d) => { if (d.kept) st.setAside.push(d.v); });
        st.last = null;
      }
      st.moves++;
      const vals = throwDice(st, rng, events);
      if (!anyScoring(vals)) {
        loseTurn(st, vals, events);
        return { ok: true, events };
      }
      st.awaiting = "choose";
      st.last = null;
      return { ok: true, events };
    }

    if (action.t === "keep") {
      if (st.awaiting !== "choose") return { ok: false, error: "illegal" };
      const idx = action.dice;
      if (!Array.isArray(idx) || !idx.length) return { ok: false, error: "illegal" };
      const seen = new Set();
      for (const i of idx) {
        if (!Number.isInteger(i) || i < 0 || i >= st.dice.length || seen.has(i) || st.dice[i].kept) return { ok: false, error: "illegal" };
        seen.add(i);
      }
      const vals = idx.map((i) => st.dice[i].v);
      const points = scoreSelection(vals);
      if (!points) return { ok: false, error: "illegal" };
      idx.forEach((i) => { st.dice[i].kept = true; });
      st.turnScore += points;
      st.moves++;
      st.last = { t: "keep", seat, points, total: st.turnScore };
      events.push({ e: "keep", seat, points, total: st.turnScore });

      const kept = st.setAside.length + st.dice.filter((d) => d.kept).length;
      if (kept >= DICE) {
        // hot dice: the six set-aside dice all scored, so all six come back
        st.setAside = []; st.dice = []; events.push({ e: "hot", seat });
        const fresh = throwDice(st, rng, events);
        if (!anyScoring(fresh)) {
          loseTurn(st, fresh, events);
          return { ok: true, events };
        }
        st.awaiting = "choose";
        st.last = { t: "hot", seat, total: st.turnScore };
        return { ok: true, events };
      }
      st.awaiting = "roll_or_bank";
      return { ok: true, events };
    }

    if (action.t === "bank") {
      if (st.awaiting !== "roll_or_bank" || st.turnScore <= 0) return { ok: false, error: "illegal" };
      const points = st.turnScore;
      st.seats[seat].score += points;
      st.moves++;
      events.push({ e: "bank", seat, points, score: st.seats[seat].score });
      if (st.seats[seat].score >= st.target) {
        st.phase = "game_over"; st.winner = seat; st.awaiting = "over";
        st.last = { t: "win", seat, points, score: st.seats[seat].score };
        events.push({ e: "win", seat });
        return { ok: true, events };
      }
      st.last = { t: "bank", seat, points, score: st.seats[seat].score };
      endTurn(st);
      return { ok: true, events };
    }

    return { ok: false, error: "illegal" };
  }

  // a match is a single game to 10,000: there are no rounds to start
  function nextRound(st, rng) { return false; }

  // what the person sitting in `seat` (or a spectator: null) may see
  function view(st, seat) {
    const you = Number.isInteger(seat) && seat >= 0 && seat < st.seats.length ? seat : null;
    const mine = you !== null && st.phase === "play" && st.turn === you;
    const kept = st.dice.filter((d) => d.kept).length;
    return {
      v: 1, game: st.game, phase: st.phase, turn: st.turn, winner: st.winner,
      target: st.target, round: st.round, moves: st.moves, awaiting: st.awaiting,
      dice: st.dice.map((d) => ({ v: d.v, kept: !!d.kept })),
      setAside: st.setAside.slice(), turnScore: st.turnScore, last: st.last,
      remaining: DICE - st.setAside.length - kept,
      seats: st.seats.map((s) => ({ name: s.name, bot: s.bot, score: s.score })),
      options: {
        roll: !!(mine && (st.awaiting === "roll" || st.awaiting === "roll_or_bank")),
        keep: !!(mine && st.awaiting === "choose"),
        bank: !!(mine && st.awaiting === "roll_or_bank" && st.turnScore > 0),
      },
      you,
    };
  }

  /* ---------- the computer ---------- */
  // how many dice would be rolled next
  function leftToRoll(st) {
    const kept = st.dice.filter((d) => d.kept).length;
    return DICE - st.setAside.length - kept;
  }
  // bank, or push on? a lone die is a two-in-three farkle, so bank early there
  function shouldBank(st, level, rng) {
    const s = st.seats[st.turn], score = s.score + st.turnScore;
    if (score >= st.target) return true;
    const k = Math.max(1, leftToRoll(st));
    if (level === "easy") return st.turnScore >= 220 + Math.floor(rng() * 160);
    if (level === "medium") return st.turnScore >= 100 + 75 * k;
    // hard: push harder with dice in hand, bank early on the last die or two,
    // and read the scoreboard when someone is about to win
    const base = [0, 80, 180, 380, 650, 950][Math.min(5, k)];
    let need = base;
    const top = Math.max.apply(null, st.seats.filter((_, i) => i !== st.turn).map((x) => x.score));
    if (top >= st.target - 1500 && s.score <= top) need = Math.round(base * 1.25);
    else if (s.score >= top + 2000) need = Math.round(base * 0.8);
    return st.turnScore >= need;
  }

  function botAct(st, seat, level, rng) {
    if (!st || st.phase !== "play" || seat !== st.turn) return fallback(st, seat);
    if (st.awaiting === "choose") {
      const vals = st.dice.map((d) => d.v);
      const mode = level === "easy" && rng() < 0.5 ? "min" : "best";
      const idx = bestKeep(vals, mode);
      if (idx.length) return { t: "keep", dice: idx };
      return { t: "roll" };                     // cannot happen on a non-farkle roll
    }
    if (st.awaiting === "roll_or_bank" && shouldBank(st, level, rng)) return { t: "bank" };
    return { t: "roll" };
  }
  // an action that is always legal for the seat to move
  function fallback(st, seat) {
    if (st && st.phase === "play" && st.awaiting === "choose") {
      const idx = bestKeep(st.dice.map((d) => d.v), "min");
      if (idx.length) return { t: "keep", dice: idx };
    }
    return { t: "roll" };
  }

  g.Farkle = {
    TARGET, DICE, MAX_SEATS, PAUSE, LEVELS,
    create, act, nextRound, view, botAct, fallback,
    scoreSet, scoreSelection, anyScoring, bestKeep, leftToRoll,
  };
})(globalThis);
