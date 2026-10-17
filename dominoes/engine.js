/* ============================================================
   dominoes/engine.js — the rules and the computer players of Dominoes
   (the draw game, double-six), written once.

   A plain script that sets globalThis.Dominoes, so the page loads it with a
   <script> tag and the Worker (worker/card-protocol.mjs) and the tests import it
   for the same effect. The page plays the computer with it; the server runs
   online rooms with it and is the only place the tiles live.

   THE GAME (standard draw dominoes)
     28 tiles (0-0 to 6-6). 2 or 3 players take 7 each, 4 players take 5; the rest
     are the boneyard. The first round starts with whoever holds the highest
     double (or, with no double, the highest tile), who must play it. Later rounds
     are started by the last round's winner, with any tile.
     Play a tile whose number matches one END of the line. If you can't, you must
     DRAW from the boneyard until you can; if the boneyard is empty you pass.
     The round ends when someone plays their last tile ("domino": they score the
     pips left in everyone else's hands) or when nobody can play (blocked: the
     player with the fewest pips left wins and scores the others' pips minus their
     own; a tie scores nothing). First to 100 points wins the game.

   Tiles are [a, b] with a <= b in hands; the line holds tiles as placed, left
   to right. Everything is plain JSON. rng is a function returning [0, 1).
   ============================================================ */
(function (g) {
  "use strict";

  const TARGET = 100, MAX_SEATS = 4, PAUSE = 8000;
  const LEVELS = ["easy", "medium", "hard"];

  const pips = (t) => t[0] + t[1];
  const sameTile = (t, u) => t[0] === u[0] && t[1] === u[1];
  const handSize = (n) => (n === 4 ? 5 : 7);
  const nextSeat = (st, i) => (i + 1) % st.seats.length;
  function allTiles() { const out = []; for (let a = 0; a <= 6; a++) for (let b = a; b <= 6; b++) out.push([a, b]); return out; }
  function shuffled(arr, rng) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  const ends = (st) => (st.line.length ? [st.line[0][0], st.line[st.line.length - 1][1]] : null);

  // deal a round; returns who must lead and with which tile (round 1 only)
  function deal(st, rng) {
    const tiles = shuffled(allTiles(), rng), n = st.seats.length, k = handSize(n);
    st.seats.forEach((s, i) => { s.hand = tiles.slice(i * k, (i + 1) * k); });
    st.boneyard = tiles.slice(n * k);
    st.line = []; st.passes = 0; st.reveal = null; st.mustLead = null;
    if (st.round === 1) {
      // the highest double, else the highest tile, leads
      let best = null;
      st.seats.forEach((s, i) => s.hand.forEach((t) => {
        const key = (t[0] === t[1] ? 100 : 0) + pips(t) * 1 + t[1] / 10;
        if (!best || key > best.key) best = { key, seat: i, tile: t };
      }));
      st.turn = best.seat; st.mustLead = best.tile;
    } else st.turn = st.starter;
  }

  function create(opts, rng) {
    const names = opts.names, bots = opts.bots || [];
    const st = {
      v: 1, game: "dominoes", mode: "normal", phase: "play", round: 1, moves: 0, target: TARGET,
      seats: names.map((name, i) => ({ name, bot: bots[i] || null, hand: [], status: "in", score: 0 })),
      line: [], boneyard: [], turn: 0, starter: 0, passes: 0, winner: null, reveal: null, mustLead: null,
    };
    deal(st, rng);
    return st;
  }

  // which ends can this tile go on? ["L"], ["R"], both, or none
  function fits(st, t) {
    const e = ends(st);
    if (!e) return st.mustLead && !sameTile(t, st.mustLead) ? [] : ["R"];
    const out = [];
    if (t[0] === e[0] || t[1] === e[0]) out.push("L");
    if (t[0] === e[1] || t[1] === e[1]) out.push("R");
    return out;
  }
  function playable(st, seat) {
    return st.seats[seat].hand.map((t) => ({ tile: t, ends: fits(st, t) })).filter((x) => x.ends.length);
  }
  const mustDraw = (st, seat) => st.phase === "play" && !playable(st, seat).length && st.boneyard.length > 0;
  const mustPass = (st, seat) => st.phase === "play" && !playable(st, seat).length && st.boneyard.length === 0;

  function finishRound(st, winnerSeat, reason, events) {
    const hands = st.seats.map((s) => s.hand.map((t) => t.slice()));
    const total = (i) => st.seats[i].hand.reduce((n, t) => n + pips(t), 0);
    let points = 0, winner = winnerSeat;
    if (reason === "domino") points = st.seats.reduce((n, s, i) => n + (i === winner ? 0 : total(i)), 0);
    else {                                           // blocked: fewest pips wins
      const sums = st.seats.map((s, i) => total(i)), low = Math.min(...sums);
      const lows = sums.map((x, i) => (x === low ? i : -1)).filter((i) => i >= 0);
      if (lows.length > 1) winner = null;
      else { winner = lows[0]; points = sums.reduce((n, x, i) => n + (i === winner ? 0 : x), 0) - low; }
    }
    if (winner !== null) st.seats[winner].score += points;
    st.reveal = { winner, points, reason, hands };
    events.push({ e: "round", winner, points, reason });
    if (winner !== null && st.seats[winner].score >= st.target) { st.phase = "game_over"; st.winner = winner; events.push({ e: "win", seat: winner }); }
    else { st.phase = "round_over"; st.starter = winner !== null ? winner : st.starter; }
  }

  function act(st, seat, action, rng) {
    if (st.phase !== "play") return { ok: false, error: "not-playing" };
    if (seat !== st.turn || !action) return { ok: false, error: "not-your-turn" };
    const events = [], s = st.seats[seat];
    if (action.t === "play") {
      const t = Array.isArray(action.tile) ? [Math.min(action.tile[0], action.tile[1]), Math.max(action.tile[0], action.tile[1])] : null;
      const idx = t ? s.hand.findIndex((x) => sameTile(x, t)) : -1;
      if (idx < 0 || (action.end !== "L" && action.end !== "R")) return { ok: false, error: "illegal" };
      if (!fits(st, t).includes(action.end)) return { ok: false, error: "illegal" };
      s.hand.splice(idx, 1);
      const e = ends(st);
      let placed;
      if (!e) placed = [t[0], t[1]];
      else if (action.end === "L") placed = t[1] === e[0] ? [t[0], t[1]] : [t[1], t[0]];     // its matching half touches the left end
      else placed = t[0] === e[1] ? [t[0], t[1]] : [t[1], t[0]];
      if (action.end === "L" && e) st.line.unshift(placed); else st.line.push(placed);
      st.mustLead = null; st.passes = 0; st.moves++;
      events.push({ e: "play", seat, tile: t, end: e ? action.end : "R", placed });
      if (!s.hand.length) { finishRound(st, seat, "domino", events); return { ok: true, events }; }
      st.turn = nextSeat(st, seat);
      return { ok: true, events };
    }
    if (action.t === "draw") {
      if (!mustDraw(st, seat)) return { ok: false, error: "illegal" };
      s.hand.push(st.boneyard.pop()); st.moves++;
      events.push({ e: "draw", seat });
      return { ok: true, events };
    }
    if (action.t === "pass") {
      if (!mustPass(st, seat)) return { ok: false, error: "illegal" };
      st.passes++; st.moves++;
      events.push({ e: "pass", seat });
      if (st.passes >= st.seats.length) { finishRound(st, null, "block", events); return { ok: true, events }; }
      st.turn = nextSeat(st, seat);
      return { ok: true, events };
    }
    return { ok: false, error: "illegal" };
  }

  function nextRound(st, rng) {
    if (st.phase !== "round_over") return;
    st.round++; st.phase = "play";
    deal(st, rng);
  }

  // what the person sitting in `seat` (or a spectator: null) may see
  function view(st, seat) {
    const shown = st.reveal && st.phase !== "play";
    const mine = seat !== null && seat !== undefined && st.phase === "play" && st.turn === seat;
    return {
      v: 1, game: st.game, phase: st.phase, round: st.round, turn: st.turn, winner: st.winner, target: st.target, pause: PAUSE,
      line: st.line, ends: ends(st), boneyard: st.boneyard.length, reveal: st.reveal, mustLead: st.mustLead,
      seats: st.seats.map((s, i) => ({
        name: s.name, bot: s.bot, count: s.hand.length, status: s.status, score: s.score,
        hand: shown ? st.reveal.hands[i] : i === seat ? s.hand.map((t) => t.slice()) : null,
      })),
      options: { plays: mine ? playable(st, seat) : [], draw: mine && mustDraw(st, seat), pass: mine && mustPass(st, seat) },
    };
  }

  /* ---------- the computer ---------- */
  function botAct(st, seat, level, rng) {
    const opts = playable(st, seat);
    if (!opts.length) return st.boneyard.length ? { t: "draw" } : { t: "pass" };
    const hand = st.seats[seat].hand, e = ends(st);
    let best = null;
    for (const o of opts) for (const end of o.ends) {
      const t = o.tile;
      let v = rng() * (level === "easy" ? 12 : level === "medium" ? 1.5 : 0.3);
      if (level !== "easy") {
        v += pips(t) * 0.8 + (t[0] === t[1] ? 2 : 0);                             // get rid of heavy tiles and doubles early
        // the new end this leaves open, and how many of my other tiles can use it
        const open = e ? (end === "L" ? (t[1] === e[0] ? t[0] : t[1]) : (t[0] === e[1] ? t[1] : t[0])) : t[1];
        const other = e ? (end === "L" ? e[1] : e[0]) : t[0];
        const mine = (n) => hand.filter((h) => h !== t && (h[0] === n || h[1] === n)).length;
        if (level === "hard") v += mine(open) * 1.2 + mine(other) * 0.6;           // keep a way to play next turn
        if (level === "hard" && hand.length <= 3) v += pips(t) * 0.4;
      }
      if (!best || v > best.v) best = { v, a: { t: "play", tile: t.slice(), end } };
    }
    return best.a;
  }
  // an action that is always legal
  function fallback(st, seat) {
    const o = playable(st, seat);
    if (o.length) return { t: "play", tile: o[0].tile.slice(), end: o[0].ends[0] };
    return st.boneyard.length ? { t: "draw" } : { t: "pass" };
  }

  g.Dominoes = { TARGET, MAX_SEATS, PAUSE, LEVELS, create, act, nextRound, view, botAct, fallback, fits, playable, pips };
})(globalThis);
