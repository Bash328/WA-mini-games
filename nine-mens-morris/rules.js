/* ============================================================
   nine-mens-morris/rules.js — the rules and the computer player of Nine Men's
   Morris, written once.

   A plain script that sets globalThis.NineMensMorrisRules, so the page loads it
   with a <script> tag and the Worker (worker/rules/nine-mens-morris.mjs) and the
   tests import it for the same effect. One copy means the browser and the server
   cannot disagree.

   The board has 24 points, drawn as three concentric squares joined by four
   spokes. The points are numbered 0..23 in reading order, row 0 at the top:

     0 ----- 1 ----- 2
     |       |       |
     | 3 --- 4 --- 5 |
     | |     |     | |
     | | 6 - 7 - 8 | |
     | | |       | | |
     9 10 11    12 13 14
     | | |       | | |
     | | 15- 16- 17 | |
     | |     |     | |
     | 18---19---20 |
     |       |       |
     21-----22-----23

   Red (1) and Blue (2) each have nine pieces. First all pieces are placed
   (Red first), one per turn, on an empty point. A row of three along a line is
   a mill: the player then removes one opponent piece, unless every opponent
   piece is in a mill, in which case any one may be taken. After all eighteen
   pieces are down, a turn moves one piece to an adjacent empty point. A player
   with exactly three pieces may fly: move to any empty point. A player loses
   when they have fewer than three pieces left, or when it is their turn and
   they have no legal move.

   Wire board (30 characters):
     0..23  the 24 points, '0' empty, '1' Red, '2' Blue
     24     phase: 'p' placing, 'm' moving, 'r' removing
     25     turn: '1' Red or '2' Blue
     26-27  pieces placed by Red, then Blue (0-9)
     28-29  pieces lost by Red, then Blue (0-9)
   The placed/lost counts make a link self-checking: for each side,
   pieces on the board + pieces lost === pieces placed.
   ============================================================ */
(function (g) {
  "use strict";

  const CELLS = 24;

  // [row, column] on the 7x7 grid the board is drawn on; reading order.
  const POINTS = [
    [0, 0], [0, 3], [0, 6],
    [1, 1], [1, 3], [1, 5],
    [2, 2], [2, 3], [2, 4],
    [3, 0], [3, 1], [3, 2], [3, 4], [3, 5], [3, 6],
    [4, 2], [4, 3], [4, 4],
    [5, 1], [5, 3], [5, 5],
    [6, 0], [6, 3], [6, 6],
  ];

  // the 16 lines of three: the three rings (four sides each) and four spokes
  const MILLS = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [9, 10, 11], [12, 13, 14], [15, 16, 17],
    [18, 19, 20], [21, 22, 23],
    [0, 9, 21], [3, 10, 18], [6, 11, 15],
    [1, 4, 7], [2, 14, 23], [5, 13, 20],
    [8, 12, 17], [16, 19, 22],
  ];

  // the 32 links along those lines
  const ADJ = [
    [1, 9], [0, 2, 4], [1, 14],
    [4, 10], [1, 3, 5, 7], [4, 13],
    [7, 11], [6, 8, 4], [7, 12],
    [0, 10, 21], [3, 9, 11, 18], [6, 10, 15],
    [8, 13, 17], [5, 12, 14, 20], [2, 13, 23],
    [11, 16], [15, 17, 19], [12, 16],
    [10, 19], [18, 20, 16, 22], [13, 19],
    [9, 22], [21, 23, 19], [14, 22],
  ];

  const PHASE_CH = { place: "p", move: "m", remove: "r" };
  const CH_PHASE = { p: "place", m: "move", r: "remove" };
  const START = "0".repeat(CELLS) + "p1" + "0000";

  const other = (p) => (p === 1 ? 2 : 1);
  const ownerOf = (cell) => cell;
  const lastOf = (mv) => (mv.kind === "remove" ? CELLS + mv.at : mv.remove !== undefined ? CELLS + mv.remove : mv.to);

  function countOf(b, p) {
    let n = 0;
    for (let i = 0; i < CELLS; i++) if (b[i] === p) n++;
    return n;
  }
  function emptyCount(b) {
    let n = 0;
    for (let i = 0; i < CELLS; i++) if (b[i] === 0) n++;
    return n;
  }

  function millAt(b, i) {
    for (const m of MILLS) {
      if (m[0] !== i && m[1] !== i && m[2] !== i) continue;
      const v = b[m[0]];
      if (v && v === b[m[1]] && v === b[m[2]]) return true;
    }
    return false;
  }
  function millsOf(b, p) {
    return MILLS.filter((m) => b[m[0]] === p && b[m[1]] === p && b[m[2]] === p);
  }
  // every point that is part of a mill (either colour), for the page's highlight
  function millPoints(b) {
    const out = [];
    for (const m of MILLS) {
      const v = b[m[0]];
      if (v && v === b[m[1]] && v === b[m[2]]) out.push(m[0], m[1], m[2]);
    }
    return out;
  }
  // Pieces p may take: all opponent pieces outside a mill; if every one is in a
  // mill, the rule allows any of them.
  function removableFrom(b, p) {
    const o = other(p), all = [], free = [];
    for (let i = 0; i < CELLS; i++) {
      if (b[i] !== o) continue;
      all.push(i);
      if (!millAt(b, i)) free.push(i);
    }
    return free.length ? free : all;
  }
  const removable = (S) => (S && S.phase === "remove" ? removableFrom(S.b, S.turn) : []);

  /* ---------- the wire ---------- */
  function parse(str) {
    if (typeof str !== "string" || str.length !== 30 || !/^[012]{24}[pmr][12][0-9]{4}$/.test(str)) return null;
    const b = Array.from(str.slice(0, 24), Number);
    const phase = CH_PHASE[str[24]];
    const turn = Number(str[25]);
    const placed = [Number(str[26]), Number(str[27])];
    const lost = [Number(str[28]), Number(str[29])];
    const onBoard = [countOf(b, 1), countOf(b, 2)];
    for (const p of [1, 2]) {
      if (placed[p - 1] > 9 || lost[p - 1] > 9) return null;
      if (onBoard[p - 1] + lost[p - 1] !== placed[p - 1]) return null;
    }
    if (phase === "move") {
      if (placed[0] !== 9 || placed[1] !== 9) return null;
    } else if (phase === "place") {
      if (placed[0] === 9 && placed[1] === 9) return null;
      const diff = placed[0] - placed[1];
      if (diff !== 0 && diff !== 1) return null;
      if (turn !== (diff === 0 ? 1 : 2)) return null;
    } else {
      // a removal can only follow a mill, and there must be something to take
      if (!millsOf(b, turn).length) return null;
      if (!removableFrom(b, turn).length) return null;
      // During placement it is the turn of whoever placed last; once both have
      // all nine down, either side may have formed a mill by moving.
      if (!(placed[0] === 9 && placed[1] === 9)) {
        const diff = placed[0] - placed[1];
        if (diff !== (turn === 1 ? 1 : 0)) return null;
      }
    }
    return { b, phase, turn, placed, lost };
  }
  function str(S) {
    return S.b.join("") + PHASE_CH[S.phase] + S.turn +
      String(S.placed[0]) + String(S.placed[1]) + String(S.lost[0]) + String(S.lost[1]);
  }
  const clone = (S) => ({
    b: S.b.slice(), phase: S.phase, turn: S.turn,
    placed: S.placed.slice(), lost: S.lost.slice(),
  });
  const create = () => START;
  const initial = create;

  /* ---------- moving ---------- */
  function movableFrom(S, p, from, to) {
    if (S.b[from] !== p || S.b[to] !== 0) return false;
    // flying: exactly three pieces left (all are on the board in the move phase)
    if (countOf(S.b, p) === 3) return true;
    return ADJ[from].indexOf(to) !== -1;
  }

  function gen(S, p) {
    const out = [];
    if (!S || p !== S.turn) return out;
    if (S.lost[0] > 6 || S.lost[1] > 6) return out;
    if (S.phase === "remove") {
      for (const at of removableFrom(S.b, p)) out.push({ kind: "remove", at: at });
      return out;
    }
    if (S.phase === "place") {
      if (S.placed[p - 1] >= 9) return out;
      for (let i = 0; i < CELLS; i++) if (S.b[i] === 0) out.push({ kind: "place", to: i });
      return out;
    }
    const fly = countOf(S.b, p) === 3;
    for (let from = 0; from < CELLS; from++) {
      if (S.b[from] !== p) continue;
      if (fly) {
        for (let to = 0; to < CELLS; to++) if (S.b[to] === 0) out.push({ kind: "move", from: from, to: to });
      } else {
        for (const to of ADJ[from]) if (S.b[to] === 0) out.push({ kind: "move", from: from, to: to });
      }
    }
    return out;
  }
  const legal = gen;

  function advance(T, p) {
    T.turn = other(p);
    if (T.phase === "place" && T.placed[0] === 9 && T.placed[1] === 9) T.phase = "move";
    return T;
  }

  // one action by p: { kind: "place", to } | { kind: "move", from, to } |
  // { kind: "remove", at }. Returns the next state or null when it is illegal.
  function play(S, p, mv) {
    if (!S || p !== S.turn || !mv) return null;
    const T = clone(S);
    if (mv.kind === "place") {
      if (S.phase !== "place" || T.placed[p - 1] >= 9) return null;
      if (!Number.isInteger(mv.to) || mv.to < 0 || mv.to >= CELLS || T.b[mv.to] !== 0) return null;
      T.b[mv.to] = p;
      T.placed[p - 1]++;
      if (millAt(T.b, mv.to) && removableFrom(T.b, p).length) { T.phase = "remove"; T.turn = p; return T; }
      return advance(T, p);
    }
    if (mv.kind === "move") {
      if (S.phase !== "move" || !Number.isInteger(mv.from) || !Number.isInteger(mv.to)) return null;
      if (mv.from < 0 || mv.from >= CELLS || mv.to < 0 || mv.to >= CELLS) return null;
      if (!movableFrom(S, p, mv.from, mv.to)) return null;
      T.b[mv.from] = 0;
      T.b[mv.to] = p;
      if (millAt(T.b, mv.to) && removableFrom(T.b, p).length) { T.phase = "remove"; T.turn = p; return T; }
      return advance(T, p);
    }
    if (mv.kind === "remove") {
      if (S.phase !== "remove" || !Number.isInteger(mv.at)) return null;
      if (removableFrom(S.b, p).indexOf(mv.at) === -1) return null;
      T.b[mv.at] = 0;
      T.lost[other(p) - 1]++;
      T.phase = (T.placed[0] < 9 || T.placed[1] < 9) ? "place" : "move";
      T.turn = other(p);
      return T;
    }
    return null;
  }

  // A whole turn for the computer: the main action and, when it made a mill,
  // the removal too. `mv.remove` names the point it takes.
  function playTurn(S, p, mv) {
    if (!mv) return null;
    let T = play(S, p, mv);
    if (!T) return null;
    if (mv.remove !== undefined) {
      if (T.phase !== "remove") return null;
      T = play(T, p, { kind: "remove", at: mv.remove });
    }
    return T;
  }

  function hasMove(S, p) {
    if (S.phase !== "move") return true;
    const fly = countOf(S.b, p) === 3;
    if (fly) return emptyCount(S.b) > 0;
    for (let i = 0; i < CELLS; i++) {
      if (S.b[i] !== p) continue;
      for (const j of ADJ[i]) if (S.b[j] === 0) return true;
    }
    return false;
  }

  // who has won in this position: 0 nobody yet
  function winner(S) {
    if (!S) return 0;
    if (S.lost[0] > 6) return 2;                       // Red has fewer than three left
    if (S.lost[1] > 6) return 1;                       // Blue has fewer than three left
    if (S.phase === "move" && !hasMove(S, S.turn)) return other(S.turn);
    return 0;
  }
  const winnerOf = winner;

  /* ---------- the server's check ---------- */
  // Is `after` what `before` becomes when p plays one legal action? Returns that
  // action's next turn, or null.
  function findAction(before, after, p) {
    const want = str(after);
    for (const a of gen(before, p)) {
      const T = play(before, p, a);
      if (T && str(T) === want) return a;
    }
    return null;
  }
  function check(prev, next, mover) {
    const bad = { ok: false, reason: "illegal" };
    if (mover !== 1 && mover !== 2) return bad;
    if (!next || typeof next.board !== "string") return bad;
    const before = prev ? parse(prev.board) : parse(START);
    const after = parse(next.board);
    if (!before || !after || before.turn !== mover) return bad;
    const a = findAction(before, after, mover);
    if (!a) return bad;
    if (!Number.isInteger(next.last) || next.last !== lastOf(a)) return bad;
    const w = winner(after);
    if (w) {
      if (next.status !== "won" || next.winner !== w) return bad;
    } else if (next.status !== "in_progress" || next.winner !== null) {
      return bad;
    }
    return { ok: true, nextTurn: after.turn };
  }

  /* ---------- the computer ---------- */
  const WIN = 100000;
  // Points that sit on more lines are worth a little more, especially the four
  // middle-ring crossings.
  const POS = POINTS.map((_, i) => (ADJ[i].length >= 4 ? 6 : ADJ[i].length === 3 ? 3 : 1));

  function moveCount(b, p) {
    const fly = countOf(b, p) === 3;
    let n = 0;
    for (let i = 0; i < CELLS; i++) {
      if (b[i] !== p) continue;
      if (fly) n += emptyCount(b);
      else for (const j of ADJ[i]) if (b[j] === 0) n++;
    }
    return n;
  }

  // from Red's point of view; evaluate() flips the sign for Blue.
  function evalRed(S) {
    let v = 0;
    for (const p of [1, 2]) {
      const sign = p === 1 ? 1 : -1;
      v += sign * 120 * (9 - S.lost[p - 1]);
      for (let i = 0; i < CELLS; i++) if (S.b[i] === p) v += sign * POS[i];
      for (const m of MILLS) {
        const a = S.b[m[0]], b = S.b[m[1]], c = S.b[m[2]];
        if (a === p && b === p && c === p) { v += sign * 42; continue; }
        let mine = 0, empty = 0;
        for (const x of m) { if (S.b[x] === p) mine++; else if (S.b[x] === 0) empty++; }
        if (mine === 2 && empty === 1) v += sign * 13;      // one move from a mill
      }
      if (S.phase === "move") v += sign * 3 * moveCount(S.b, p);
    }
    return v;
  }
  const evaluate = (S, p) => (p === 1 ? evalRed(S) : -evalRed(S));

  // Every whole turn available to p, with the state it leads to.
  function turnOutcomes(S, p) {
    const out = [];
    if (!S || S.turn !== p) return out;
    for (const mv of gen(S, p)) {
      const T = play(S, p, mv);
      if (!T) continue;
      if (T.phase === "remove") {
        for (const rm of gen(T, p)) {
          const U = play(T, p, rm);
          if (U) out.push({ mv: { kind: mv.kind, from: mv.from, to: mv.to, at: mv.at, remove: rm.at }, next: U });
        }
      } else out.push({ mv: mv, next: T });
    }
    return out;
  }

  function orderOutcomes(S, p, list) {
    for (const o of list) {
      const w = winner(o.next);
      o.v = w ? (w === p ? WIN * 2 : -WIN * 2) : evaluate(o.next, p) + (o.mv.remove !== undefined ? 24 : 0);
    }
    list.sort((a, b) => b.v - a.v);
    return list;
  }

  function search(S, p, depth, alpha, beta, ctx) {
    ctx.nodes++;
    const w = winner(S);
    if (w) return w === p ? WIN + depth : -WIN - depth;
    if (depth <= 0 || ctx.nodes > ctx.cap) return evaluate(S, p);
    const list = turnOutcomes(S, p);
    if (!list.length) return -WIN - depth;
    orderOutcomes(S, p, list);
    let best = -Infinity;
    for (const o of list) {
      const w2 = winner(o.next);
      const v = w2 ? (w2 === p ? WIN + depth : -WIN - depth) : -search(o.next, other(p), depth - 1, -beta, -alpha, ctx);
      if (v > best) best = v;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return best;
  }

  const LEVELS = {
    easy: { depth: 1, cap: 4000, noise: 90, blunder: 0.3 },
    medium: { depth: 2, cap: 16000, noise: 18, blunder: 0.04 },
    hard: { depth: 3, cap: 60000, noise: 0, blunder: 0 },
  };

  // The computer's whole turn for p: { kind, ... } and `remove` after a mill.
  function bestMove(str30, p, level, rng) {
    rng = rng || Math.random;
    const S = parse(str30);
    if (!S || S.turn !== p) return null;
    const lv = LEVELS[level] || LEVELS.medium;
    const list = turnOutcomes(S, p);
    if (!list.length) return null;
    if (rng() < (lv.blunder || 0)) return list[Math.floor(rng() * list.length)].mv;
    orderOutcomes(S, p, list);
    const ctx = { nodes: 0, cap: lv.cap };
    let best = null, alpha = -Infinity;
    for (const o of list) {
      const w = winner(o.next);
      let v = w ? (w === p ? WIN * 2 : -WIN * 2)
        : -search(o.next, other(p), lv.depth - 1, -Infinity, -alpha, ctx);
      if (lv.noise) v += (rng() * 2 - 1) * lv.noise;
      if (!best || v > best.v) best = { v: v, mv: o.mv };
      if (v > alpha) alpha = v;
    }
    return best ? best.mv : list[0].mv;
  }

  g.NineMensMorrisRules = {
    CELLS, POINTS, MILLS, ADJ, START, LEVELS,
    other, ownerOf, lastOf, countOf, emptyCount, millAt, millsOf, millPoints, removable, removableFrom,
    parse, str, create, initial, gen, legal, play, playTurn, winner, winnerOf, check,
    turnOutcomes, bestMove, evaluate,
  };
})(globalThis);
