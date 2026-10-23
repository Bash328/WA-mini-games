/* ============================================================
   connect6/rules.js — the rules and the computer player of Connect6, written once.

   A plain script that sets globalThis.Connect6Rules, so the page loads it with a
   <script> tag and the Worker (worker/rules/connect6.mjs) and the tests import it
   for the same effect. One copy means the browser and the server cannot disagree.

   The board is 15x15 here, not the 19x19 of the international game. On a phone
   the board is the full width of the screen (about 298px of grid at 320px), so
   19 points would leave roughly 15px between crossings and 12px stones. Since
   every turn but the opening places TWO stones, a fat finger would cost a whole
   turn. 15x15 gives about 19px between crossings and 16px stones at 320px, and
   six in a row still needs real work. The page's how-to says so too.

   Cell index = row * 15 + column, row 0 at the top. Player 1 is Black and moves
   first; player 2 is White. Black places ONE stone on the opening turn. After
   that every turn places TWO stones, on different empty points (the two may be
   anywhere). A turn may place fewer than two only when the board is nearly
   full: if one empty point is left, that turn places one; if two are left, the
   turn still places two and fills the board. Six or more stones in a row,
   across, down or diagonally, win. A full board with no line is a draw.

   Wire board (227 characters):
     0..224   the 225 points, '0' empty, '1' Black, '2' White
     225      the side to move ('1' or '2')
     226      how many stones that side has already placed this turn ('0' or '1')
   A link/live move carries the whole completed turn in one wire board. `last`
   is one integer naming the new points in the order they were played:
     one stone  -> point * 256 + 255
     two stones -> first * 256 + second
   (255 is never a point, so a single stone cannot be confused with a pair.)
   ============================================================ */
(function (g) {
  "use strict";

  const N = 15, CELLS = N * N, WIN_LEN = 6;
  const DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];
  const other = (p) => (p === 1 ? 2 : 1);
  const ownerOf = (c) => c;
  const inB = (r, c) => r >= 0 && r < N && c >= 0 && c < N;
  const WIRE_RE = new RegExp("^[012]{" + CELLS + "}[12][01]$");

  function create() {
    return { b: new Array(CELLS).fill(0), t: 1, p: 0 };   // b: points, t: side to move, p: stones placed this turn
  }
  const initial = () => str(create());

  /* ---------- the wire ---------- */
  function parse(s) {
    if (typeof s !== "string" || s.length !== CELLS + 2) return null;
    if (!WIRE_RE.test(s)) return null;
    const b = new Array(CELLS);
    for (let i = 0; i < CELLS; i++) b[i] = s.charCodeAt(i) - 48;
    const t = s.charCodeAt(CELLS) - 48;
    const p = s.charCodeAt(CELLS + 1) - 48;
    // p is how many of t's stones went down this turn: there must be that many.
    if (p > 0) {
      let n = 0;
      for (let i = 0; i < CELLS; i++) if (b[i] === t) n++;
      if (n < p) return null;
    }
    return { b: b, t: t, p: p };
  }
  function str(S) {
    return S.b.join("") + S.t + S.p;
  }

  /* ---------- lines ---------- */
  // The line of six or more through the stone at i, as cell indices, or null.
  function lineAt(b, i) {
    const p = b[i];
    if (!p) return null;
    const r0 = (i / N) | 0, c0 = i % N;
    for (let d = 0; d < DIRS.length; d++) {
      const dr = DIRS[d][0], dc = DIRS[d][1];
      const cells = [i];
      for (let s = 1; s >= -1; s -= 2) {
        let r = r0 + dr * s, c = c0 + dc * s;
        while (inB(r, c) && b[r * N + c] === p) {
          cells.push(r * N + c);
          r += dr * s; c += dc * s;
        }
      }
      if (cells.length >= WIN_LEN) return cells;
    }
    return null;
  }

  function winnerOf(S) {
    const b = Array.isArray(S) ? S : S && S.b;
    if (!b) return 0;
    for (let i = 0; i < CELLS; i++) {
      if (b[i] && lineAt(b, i)) return b[i];
    }
    return 0;
  }
  const winner = winnerOf;

  const emptyCount = (b) => {
    let n = 0;
    for (let i = 0; i < CELLS; i++) if (b[i] === 0) n++;
    return n;
  };

  // How many stones the side to move must place in this turn. p stones have
  // already gone down this turn, so add them back to see how empty the turn
  // began (a nearly-full board must not suddenly ask for a shorter turn).
  function need(S) {
    if (S.p === 0 && emptyCount(S.b) === CELLS) return 1;   // the opening turn
    return Math.min(2, emptyCount(S.b) + S.p);
  }
  function remaining(S) {
    if (!S) return 0;
    if (winnerOf(S) || emptyCount(S.b) === 0) return 0;   // the game is over
    return Math.max(0, need(S) - S.p);
  }

  /* ---------- moves: one stone at a time ---------- */
  // Every empty point the side to move may put a stone on right now.
  function gen(S, p) {
    const out = [];
    if (!S || p !== S.t || remaining(S) === 0) return out;
    for (let i = 0; i < CELLS; i++) if (S.b[i] === 0) out.push(i);
    return out;
  }
  const legal = gen;

  // Place one stone. Returns the next state (which may still be the same
  // side's turn), or null when the placement is not allowed.
  function play(S, p, point) {
    if (!S || p !== S.t) return null;
    if (!Number.isInteger(point) || point < 0 || point >= CELLS) return null;
    if (remaining(S) === 0) return null;
    if (S.b[point] !== 0) return null;
    const b = S.b.slice();
    b[point] = p;
    // A line, or a board with no empty point left, ends the game at once: the
    // second stone of the turn is never played after a win.
    if (lineAt(b, point) || b.indexOf(0) === -1) {
      return { b: b, t: other(p), p: 0 };
    }
    if (S.p + 1 >= need(S)) return { b: b, t: other(p), p: 0 };   // the turn is complete
    return { b: b, t: p, p: S.p + 1 };                             // one more stone to come
  }

  // Play a whole turn's points in order. Stops when the turn or game ends, so
  // a list of two is fine when the first stone already wins; null when any
  // point cannot be played while it is still p's turn.
  function playTurn(S, p, points) {
    if (!S || S.t !== p || !Array.isArray(points) || !points.length) return null;
    let T = S;
    for (let k = 0; k < points.length; k++) {
      if (T.t !== p) break;
      T = play(T, p, points[k]);
      if (!T) return null;
    }
    return T;
  }

  // 1 / 2 when that side has six or more, else 0.
  function outcome(S, mover) {
    const w = winnerOf(S);
    if (w) return { status: "won", winner: w };
    if (S.b.indexOf(0) === -1) return { status: "draw", winner: 0 };
    return { status: "in_progress", winner: 0 };
  }

  /* ---------- the last-move mark ---------- */
  const SINGLE = 255;
  function encodeLast(points) {
    if (!Array.isArray(points) || !points.length || points.length > 2) return null;
    for (const i of points) {
      if (!Number.isInteger(i) || i < 0 || i >= CELLS) return null;
    }
    if (points.length === 1) return points[0] * 256 + SINGLE;
    return points[0] * 256 + points[1];
  }
  function decodeLast(last) {
    if (!Number.isInteger(last) || last < 0) return null;
    const a = Math.floor(last / 256), b = last % 256;
    if (a < 0 || a >= CELLS) return null;
    if (b === SINGLE) return [a];
    if (b >= CELLS) return null;
    return [a, b];
  }

  /* ---------- the server's check ---------- */
  // Is `next` what `prev` becomes when `mover` plays one whole legal turn?
  // The room state before a move is always at the start of a turn; a link that
  // ends mid-turn is refused, so the opponent can never be handed a half turn.
  function check(prev, next, mover) {
    const bad = { ok: false, reason: "illegal" };
    if (mover !== 1 && mover !== 2) return bad;
    if (!next || typeof next !== "object" || typeof next.board !== "string") return bad;
    if (!parse(next.board)) return bad;
    const before = prev ? parse(prev.board) : parse(initial());
    if (!before || before.t !== mover) return bad;

    const points = decodeLast(next.last);
    if (!points) return bad;
    // A turn can never place more than the turn asks for. It may place fewer
    // only when the first stone already won.
    if (points.length > remaining(before)) return bad;

    let S = before;
    for (let k = 0; k < points.length; k++) {
      if (S.t !== mover) return bad;
      S = play(S, mover, points[k]);
      if (!S) return bad;
    }
    if (str(S) !== next.board) return bad;

    const o = outcome(S, mover);
    if (o.status === "in_progress") {
      // The turn must be finished: it is now the other side's move, with no
      // stones of theirs already placed.
      if (S.t !== other(mover) || S.p !== 0) return bad;
      if (next.status !== "in_progress" || next.winner !== null) return bad;
    } else if (o.status === "won") {
      if (o.winner !== mover) return bad;
      if (next.status !== "won" || next.winner !== mover) return bad;
    } else {
      if (next.status !== "draw" || next.winner !== null) return bad;
    }
    return { ok: true, nextTurn: S.t };
  }

  /* ---------- the computer ---------- */
  const WIN = 1000000000;
  // What a window of six is worth once the stone has been placed: the more
  // p stones in it, the closer to a line. A window with five is one empty
  // point from six; four can be finished with both stones of the next turn.
  const WINDOW = [0, 0, 12, 120, 2400, 120000, WIN];

  const aligned = (a, b) => {
    const ar = (a / N) | 0, ac = a % N, br = (b / N) | 0, bc = b % N;
    const dr = br - ar, dc = bc - ac;
    return dr === 0 || dc === 0 || Math.abs(dr) === Math.abs(dc);
  };

  // What placing p on i would build, counting the six-long windows through i
  // that hold only p stones and empty points. This sees broken shapes (X_XXX)
  // as well as solid runs. WIN when the placement makes six.
  function pointGain(b, i, p) {
    if (b[i] !== 0) return 0;
    const r0 = (i / N) | 0, c0 = i % N;
    let total = 0;
    for (let d = 0; d < DIRS.length; d++) {
      const dr = DIRS[d][0], dc = DIRS[d][1];
      for (let start = -WIN_LEN + 1; start <= 0; start++) {
        let mine = 0, ok = true;
        for (let k = 0; k < WIN_LEN; k++) {
          const r = r0 + dr * (start + k), c = c0 + dc * (start + k);
          if (!inB(r, c)) { ok = false; break; }
          const v = b[r * N + c];
          if (v === 0) continue;
          if (v === p) mine++;
          else { ok = false; break; }
        }
        if (!ok) continue;
        const m = mine + 1;                 // the stone being placed
        if (m >= WIN_LEN) return WIN;
        total += WINDOW[m];
      }
    }
    return total;
  }

  // Empty points within two of a stone (or the centre on an empty board).
  const nearCache = new Uint8Array(CELLS);
  function nearPoints(b) {
    nearCache.fill(0);
    const out = [];
    let stones = 0;
    for (let i = 0; i < CELLS; i++) {
      if (!b[i]) continue;
      stones++;
      const r0 = (i / N) | 0, c0 = i % N;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const r = r0 + dr, c = c0 + dc;
          if (!inB(r, c)) continue;
          const j = r * N + c;
          if (b[j] || nearCache[j]) continue;
          nearCache[j] = 1;
          out.push(j);
        }
      }
    }
    if (!stones) out.push(((N / 2) | 0) * N + ((N / 2) | 0));
    return out;
  }

  // One pass over the empty points near a stone: what p gains there, and what
  // the opponent would gain there. winMe is a point where p makes six now.
  function table(b, p) {
    const opp = other(p);
    const pts = [];
    let winMe = -1;
    for (const i of nearPoints(b)) {
      const m = pointGain(b, i, p);
      const o = pointGain(b, i, opp);
      if (m >= WIN) winMe = i;
      pts.push({ i: i, m: m, o: o });
    }
    pts.sort((a, b2) => (b2.m + 0.9 * b2.o) - (a.m + 0.9 * a.o));
    return { pts: pts, winMe: winMe };
  }
  const winOpOf = (tb) => {
    for (const x of tb.pts) if (x.o >= WIN) return x.i;
    return -1;
  };

  function pairOptions(tb, width) {
    const top = tb.pts.slice(0, width);
    const pairs = [];
    for (let a = 0; a < top.length; a++) {
      for (let c = a + 1; c < top.length; c++) {
        const A = top[a], B = top[c];
        let sc = A.m + B.m + 0.9 * (A.o + B.o);
        if (aligned(A.i, B.i)) sc += 0.3 * (A.m + B.m);   // two stones on one line can become a six together
        pairs.push({ pts: [A.i, B.i], sc: sc });
      }
    }
    pairs.sort((x, y) => y.sc - x.sc);
    return pairs;
  }

  function sixAt(b, i) {
    return !!lineAt(b, i);
  }

  const LEVELS = {
    easy:   { width: 8,  pick: 4, blunder: 0.30, search: 0 },
    medium: { width: 11, pick: 2, blunder: 0.04, search: 0 },
    hard:   { width: 14, pick: 1, blunder: 0,    search: 6 },
  };

  function randomTurn(b, rem, rng) {
    const free = [];
    for (let i = 0; i < CELLS; i++) if (b[i] === 0) free.push(i);
    if (free.length < rem) return null;
    const out = [];
    for (let k = 0; k < rem; k++) {
      out.push(free.splice(Math.min(free.length - 1, Math.floor(rng() * free.length)), 1)[0]);
    }
    return out;
  }

  function planTurn(b, p, rem, lv, rng) {
    const opp = other(p);
    const tb = table(b, p);
    if (!tb.pts.length) return null;
    if (tb.winMe >= 0) return [tb.winMe];               // six now, with the first stone
    const winOp = winOpOf(tb);

    if (rem === 1) {
      // The opening (the centre) or the last empty points. Block a six first.
      if (winOp >= 0) {
        const block = tb.pts.find((x) => x.i === winOp);
        if (block) return [block.i];
      }
      return [tb.pts[0].i];
    }

    // If the opponent has winning points, a pair must cover them.
    const musts = [];
    for (const x of tb.pts) if (x.o >= WIN) musts.push(x.i);

    let pairs = pairOptions(tb, lv.width);
    if (!pairs.length) return null;

    // A pair that makes six with the second stone is a win; take it, even when
    // the opponent also has threats to cover.
    for (const pair of pairs) {
      b[pair.pts[0]] = p;
      const win1 = sixAt(b, pair.pts[0]);
      let win2 = false;
      if (!win1) {
        b[pair.pts[1]] = p;
        win2 = sixAt(b, pair.pts[1]);
        b[pair.pts[1]] = 0;
      }
      b[pair.pts[0]] = 0;
      if (win1) return [pair.pts[0]];
      if (win2) return pair.pts;
    }

    if (musts.length >= 2) {
      // Two immediate threats left and no win of our own: only covering both helps.
      return [musts[0], musts[1]];
    }

    if (lv.search) {
      const K = Math.min(lv.search, pairs.length);
      let best = null;
      for (let k = 0; k < K; k++) {
        const pts = pairs[k].pts;
        b[pts[0]] = p; b[pts[1]] = p;
        const opTb = table(b, opp);
        let v;
        if (opTb.winMe >= 0) v = -WIN;                  // they make six next turn
        else {
          const opPairs = pairOptions(opTb, 8);
          const opBest = opPairs.length ? opPairs[0].sc : 0;
          v = pairs[k].sc - 0.85 * opBest;
        }
        b[pts[0]] = 0; b[pts[1]] = 0;
        if (!best || v > best.v) best = { v: v, pts: pts };
      }
      return best ? best.pts : pairs[0].pts;
    }

    const k = Math.min(lv.pick, pairs.length);
    if (k > 1 && rng() < (lv === LEVELS.easy ? 0.8 : 0.15)) {
      return pairs[Math.min(k - 1, Math.floor(rng() * k))].pts;
    }
    return pairs[0].pts;
  }

  function evaluate(S, p) {
    if (!S) return 0;
    const w = winnerOf(S);
    if (w) return w === p ? WIN : -WIN;
    const tb = table(S.b, p);
    if (tb.winMe >= 0) return WIN;
    let m1 = 0, m2 = 0, o1 = 0, o2 = 0;
    for (const x of tb.pts) {
      if (x.m > m1) { m2 = m1; m1 = x.m; } else if (x.m > m2) m2 = x.m;
      if (x.o > o1) { o2 = o1; o1 = x.o; } else if (x.o > o2) o2 = x.o;
    }
    return (m1 + 0.7 * m2) - 1.05 * (o1 + 0.7 * o2);
  }

  // The points the computer plays this turn: [i] or [i, j]. Fewer than the turn
  // asks for only when the first stone already makes six.
  function bestMove(wire, p, level, rng) {
    const S = parse(wire);
    if (!S || S.t !== p) return null;
    const rem = remaining(S);
    if (!rem) return null;
    rng = rng || Math.random;
    const lv = LEVELS[level] || LEVELS.medium;
    if (lv.blunder && rng() < lv.blunder) {
      const r = randomTurn(S.b, rem, rng);
      if (r) return r;
    }
    let pts = null;
    try {
      pts = planTurn(S.b.slice(), p, rem, lv, rng);
    } catch (e) {
      pts = null;
    }
    if (!pts || !pts.length) return randomTurn(S.b, rem, rng);
    // A final guard: legal, distinct, empty points only.
    const out = [];
    for (const i of pts) {
      if (out.length >= rem) break;
      if (!Number.isInteger(i) || i < 0 || i >= CELLS || S.b[i] !== 0) continue;
      if (out.indexOf(i) !== -1) continue;
      out.push(i);
    }
    if (!out.length) return randomTurn(S.b, rem, rng);
    if (out.length < rem) {
      // Only a stone that ends the game may shorten a turn; otherwise play a
      // full random turn rather than hand the page a half turn it cannot send.
      let T = S;
      for (const i of out) T = play(T, p, i);
      if (!T || outcome(T, p).status === "in_progress") return randomTurn(S.b, rem, rng);
    }
    return out;
  }

  g.Connect6Rules = {
    N, CELLS, WIN_LEN, DIRS, LEVELS, WIN, SINGLE,
    other, ownerOf, create, initial, parse, str,
    lineAt, winnerOf, winner, emptyCount, need, remaining,
    full: (S) => !!S && emptyCount(Array.isArray(S) ? S : S.b) === 0,
    gen, legal, play, playTurn, outcome,
    encodeLast, decodeLast, check,
    pointGain, nearPoints, evaluate, bestMove,
  };
})(globalThis);
