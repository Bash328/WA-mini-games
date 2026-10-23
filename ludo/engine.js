/* ============================================================
   ludo/engine.js — the rules and the computer players of Ludo, written once.

   A plain script that sets globalThis.Ludo, so the page loads it with a
   <script> tag and the Worker (worker/card-protocol.mjs) and the tests import
   it for the same effect. The page plays the computer (and same-device
   pass-and-play) with it; the server runs online rooms with it and rolls
   the die inside the engine, so online dice are as honest as the server.

   THE GAME (house rules, 2 to 4 players)
     Each player has 4 tokens in their yard. A token travels 56 steps:
     rel -1 = yard; rel 0..50 = the shared 52-cell loop (its entry cell is
     safe); rel 51..55 = its coloured home column; rel 56 = home (needs the
     EXACT roll). Roll a 6 to bring a token out (to your entry cell) — and a
     6 earns an extra roll, but three 6s in a row forfeit the turn. Land on
     an opponent on a plain cell and their token goes back to their yard;
     entry cells and the star cells (8 on from each entry) are safe. No
     blockades: any number of tokens may share a cell. First to bring all
     four tokens home wins. If you have no move the turn passes.

   Everything is plain JSON. rng is a function returning [0, 1).
   ============================================================ */
(function (g) {
  "use strict";

  const TOKENS = 4, TRACK = 52, MAX_SEATS = 4, NEED = 56;

  /* The loop, clockwise, on a 15x15 grid. A token leaves its yard on its
     entry cell and travels 51 loop cells to the cell before its home column:
     red 39, yellow 0, blue 13, green 26 (13 apart, as on a real board).
     The star cell 8 on from each entry is safe too. */
  const CELLS = [
    [6, 1], [6, 2], [6, 3], [6, 4], [6, 5],
    [5, 6], [4, 6], [3, 6], [2, 6], [1, 6], [0, 6],
    [0, 7],
    [0, 8], [1, 8], [2, 8], [3, 8], [4, 8], [5, 8],
    [6, 9], [6, 10], [6, 11], [6, 12], [6, 13], [6, 14],
    [7, 14],
    [8, 14], [8, 13], [8, 12], [8, 11], [8, 10], [8, 9],
    [9, 8], [10, 8], [11, 8], [12, 8], [13, 8], [14, 8],
    [14, 7],
    [14, 6], [13, 6], [12, 6], [11, 6], [10, 6], [9, 6],
    [8, 5], [8, 4], [8, 3], [8, 2], [8, 1], [8, 0],
    [7, 0],
    [6, 0],
  ];

  /* The four yards, clockwise from bottom-left: red, yellow (top-left),
     blue (top-right), green. `home` holds the five home-column cells
     (rel 51..55); `spots` are the four resting spots inside the yard. */
  const YARDS = [
    { key: "red",    entry: 39, arrow: "↑", home: [[13, 7], [12, 7], [11, 7], [10, 7], [9, 7]],  spots: [[10, 1], [10, 4], [13, 1], [13, 4]] },
    { key: "yellow", entry: 0,  arrow: "→", home: [[7, 1], [7, 2], [7, 3], [7, 4], [7, 5]],       spots: [[1, 1], [1, 4], [4, 1], [4, 4]] },
    { key: "blue",   entry: 13, arrow: "↓", home: [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7]],       spots: [[1, 10], [1, 13], [4, 10], [4, 13]] },
    { key: "green",  entry: 26, arrow: "←", home: [[7, 13], [7, 12], [7, 11], [7, 10], [7, 9]],   spots: [[10, 10], [10, 13], [13, 10], [13, 13]] },
  ];
  /* Who sits where by player count: two play diagonally (red v blue, as on
     the classic box art), three and four fill in turn order. */
  const LINEUP = { 2: [0, 2], 3: [0, 1, 2], 4: [0, 1, 2, 3] };

  const SAFE = new Set();
  YARDS.forEach((y) => { SAFE.add(y.entry); SAFE.add((y.entry + 8) % TRACK); });
  const safeOwner = (idx) => { for (const y of YARDS) if ((y.entry + 8) % TRACK === idx) return y.key; return null; };
  const entryOwner = (idx) => { for (const y of YARDS) if (y.entry === idx) return y.key; return null; };

  const yardOf = (st, seat) => YARDS[st.seats[seat].yard];
  const cellOf = (st, seat, rel) => (yardOf(st, seat).entry + rel) % TRACK;
  const finished = (tokens) => tokens.filter((r) => r === NEED).length;

  function create(opts, rng) {
    const names = opts.names, n = names.length;
    if (n < 2 || n > MAX_SEATS) throw new Error("2 to 4 players");
    const bots = opts.bots || [];
    const st = {
      v: 1, game: "ludo", phase: "play", round: 1, moves: 0,
      seats: names.map((name, i) => ({ name, bot: bots[i] || null, yard: LINEUP[n][i], tokens: [-1, -1, -1, -1] })),
      turn: opts.starter || 0, starter: opts.starter || 0,
      die: null, rolled: false, sixes: 0, winner: null,
    };
    return st;
  }

  /* Can `rel` move by die d? From the yard needs a 6; past 56 needs exact. */
  function canMove(rel, d) {
    if (rel === NEED) return false;
    if (rel === -1) return d === 6;
    return rel + d <= NEED;
  }
  function legalMoves(st, seat) {
    if (st.phase !== "play" || seat !== st.turn || !st.rolled) return [];
    const d = st.die, out = [];
    st.seats[seat].tokens.forEach((rel, i) => { if (canMove(rel, d)) out.push(i); });
    return out;
  }
  function options(st, seat) {
    return { roll: st.phase === "play" && seat === st.turn && !st.rolled, moves: legalMoves(st, seat) };
  }

  function passTurn(st) {
    st.turn = (st.turn + 1) % st.seats.length;
    st.rolled = false; st.die = null; st.sixes = 0;
  }

  /* Apply an action by `seat`: { t: "roll" } | { t: "move", token }.
     Returns { ok: true, events } or { ok: false, error } (state untouched on error). */
  function act(st, seat, action, rng) {
    if (st.phase !== "play") return { ok: false, error: "not-playing" };
    if (seat !== st.turn || !action || typeof action !== "object") return { ok: false, error: "not-your-turn" };
    const events = [];

    if (action.t === "roll") {
      if (st.rolled) return { ok: false, error: "already-rolled" };
      st.die = 1 + Math.floor(rng() * 6);
      st.rolled = true; st.moves++;
      events.push({ e: "roll", seat, die: st.die });
      if (st.die === 6) {
        st.sixes++;
        if (st.sixes >= 3) {                       // three 6s in a row: no move, turn over
          events.push({ e: "forfeit", seat });
          passTurn(st);
          return { ok: true, events };
        }
      } else st.sixes = 0;
      if (!legalMoves(st, seat).length) {          // nothing can move: the turn passes
        events.push({ e: "stuck", seat });
        passTurn(st);
      }
      return { ok: true, events };
    }

    if (action.t === "move") {
      if (!st.rolled) return { ok: false, error: "roll-first" };
      const i = action.token;
      const me = st.seats[seat];
      if (!Number.isInteger(i) || i < 0 || i >= TOKENS) return { ok: false, error: "bad-action" };
      const from = me.tokens[i];
      if (!canMove(from, st.die)) return { ok: false, error: "illegal" };
      const d = st.die, to = from === -1 ? 0 : from + d;
      me.tokens[i] = to;
      events.push({ e: "move", seat, token: i, from, to, die: d });
      st.moves++;

      if (to <= 50) {                              // landing on the loop: captures?
        const cell = cellOf(st, seat, to);
        if (!SAFE.has(cell)) {
          st.seats.forEach((s, j) => {
            if (j === seat) return;
            s.tokens.forEach((r, k) => {
              if (r >= 0 && r <= 50 && cellOf(st, j, r) === cell) {
                s.tokens[k] = -1;
                events.push({ e: "capture", seat, victim: j, token: k, cell });
              }
            });
          });
        }
      } else if (to === NEED) events.push({ e: "home", seat, token: i });

      if (finished(me.tokens) === TOKENS) {
        st.phase = "game_over"; st.winner = seat;
        events.push({ e: "win", seat });
        return { ok: true, events };
      }
      if (d !== 6) passTurn(st); else st.rolled = false;   // a 6 earns another roll
      return { ok: true, events };
    }

    return { ok: false, error: "bad-action" };
  }

  /* Ludo is one race, not rounds: the rematch makes a fresh state. */
  function nextRound(st) { return false; }

  /* What anyone may see: Ludo has no hidden information. */
  function view(st, seat) {
    return {
      v: 1, game: "ludo", phase: st.phase, turn: st.turn, winner: st.winner,
      die: st.die, rolled: st.rolled, moves: st.moves,
      seats: st.seats.map((s) => ({ name: s.name, bot: s.bot, yard: s.yard, tokens: s.tokens.slice(), done: finished(s.tokens) })),
      options: seat === null || seat === undefined ? { roll: false, moves: [] } : options(st, seat),
    };
  }

  /* ---------- the computer players ---------- */
  function botAct(st, seat, level, rng) {
    if (!st.rolled) return { t: "roll" };
    const moves = legalMoves(st, seat);
    if (!moves.length) return { t: "roll" };
    const me = st.seats[seat];
    if (level === "easy") return { t: "move", token: moves[Math.floor(rng() * moves.length)] };

    let best = null;
    for (const i of moves) {
      const from = me.tokens[i];
      const to = from === -1 ? 0 : from + st.die;
      let v = rng() * (level === "hard" ? 0.4 : 1.5);
      if (to === NEED) v += 12;                            // walk one in
      if (from === -1) v += 5;                             // getting out matters most
      if (to <= 50) {
        const cell = cellOf(st, seat, to);
        if (SAFE.has(cell)) v += 3;
        let victims = 0;
        st.seats.forEach((s, j) => {
          if (j === seat) return;
          s.tokens.forEach((r) => { if (r >= 0 && r <= 50 && cellOf(st, j, r) === cell) victims++; });
        });
        v += victims * 8;
        let danger = 0;                                    // tokens that could hit the landing cell next turn
        st.seats.forEach((s, j) => {
          if (j === seat) return;
          s.tokens.forEach((r) => {
            if (r >= 0 && r <= 50) {
              const gap = (cell - cellOf(st, j, r) + TRACK) % TRACK;
              if (gap >= 1 && gap <= 6) danger++;
            }
          });
        });
        v -= danger * (level === "hard" ? 2.2 : 1.1);
      }
      v += to * 0.08;                                      // steady progress
      if (level === "hard" && to >= 51) v += 2;
      if (!best || v > best.v) best = { v, i };
    }
    return { t: "move", token: best.i };
  }
  const fallback = (st) => (st.rolled && legalMoves(st, st.turn).length ? { t: "move", token: legalMoves(st, st.turn)[0] } : { t: "roll" });

  g.Ludo = {
    TOKENS, TRACK, MAX_SEATS, NEED, CELLS, YARDS, LINEUP, SAFE, safeOwner, entryOwner,
    create, act, nextRound, view, options, legalMoves, canMove, cellOf, finished, botAct, fallback,
  };
})(globalThis);
