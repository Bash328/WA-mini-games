/* ============================================================
   breakthrough/rules.js — the rules and the computer player of Breakthrough, written once.

   A plain script that sets globalThis.BreakthroughRules, so the page loads it
   with a <script> tag and the Worker (worker/rules/breakthrough.mjs) and the
   tests import it for the same effect. One copy means the browser and the
   server cannot disagree.

   8x8 board, cell index = row * 8 + column, row 0 at the top. Player 1 (Red)
   starts on the two bottom rows (6 and 7) and moves UP; Player 2 (Blue)
   starts on the two top rows (0 and 1) and moves DOWN. Each side has sixteen
   pieces. On your turn one piece may
     - step one square straight forward, onto an empty square; OR
     - step one square diagonally forward, onto an enemy piece, capturing it.
   There is no other move: no sideways or backward step, no capture straight
   ahead, and a diagonal square is only ever entered by a capture.
   The first player to put a piece on the opponent's back rank wins (Red on
   row 0, Blue on row 7). A player with no legal move at all loses. So that a
   link can never loop forever, sixty moves in a row without a capture (or a
   piece reaching the back rank) end the game in a draw.

   Wire board (a string of 67): 64 cells ('0' empty, '1' P1/Red, '2' P2/Blue),
   then the side to move ('1' or '2'), then the count of quiet moves as two
   decimal digits (00-60).
   ============================================================ */
(function (g) {
  "use strict";

  const N = 8, CELLS = 64, DRAW_LIMIT = 60;
  const other = (p) => (p === 1 ? 2 : 1);
  const ownerOf = (c) => (c === 0 ? 0 : c);
  const goalRow = (p) => (p === 1 ? 0 : 7);

  /* ---------- the position, the wire and a fresh game ---------- */
  function create() {
    const b = new Array(CELLS).fill(0);
    for (let r = 0; r < 2; r++) for (let c = 0; c < N; c++) b[r * N + c] = 2;
    for (let r = 6; r < 8; r++) for (let c = 0; c < N; c++) b[r * N + c] = 1;
    return { b: b, t: 1, c: 0 };                 // b: cells, t: side to move, c: quiet-move counter
  }
  const pad2 = (n) => (n < 10 ? "0" : "") + n;
  const initial = () => str(create());

  function parse(str) {
    if (typeof str !== "string" || str.length !== CELLS + 3) return null;
    if (!/^[012]{64}[12]\d{2}$/.test(str)) return null;
    const c = Number(str.slice(CELLS + 1));
    if (c > DRAW_LIMIT) return null;
    return { b: Array.from(str.slice(0, CELLS), Number), t: str.charCodeAt(CELLS) - 48, c: c };
  }
  function str(S) {
    return S.b.join("") + S.t + pad2(S.c);
  }

  /* ---------- moves ---------- */
  // every legal move for p: { from, to }
  function gen(S, p) {
    const out = [];
    const dir = p === 1 ? -1 : 1;
    for (let i = 0; i < CELLS; i++) {
      if (S.b[i] !== p) continue;
      const r = (i / N) | 0, c = i % N;
      const nr = r + dir;
      if (nr < 0 || nr >= N) continue;
      if (S.b[nr * N + c] === 0) out.push({ from: i, to: nr * N + c });          // straight forward
      if (c > 0 && S.b[nr * N + c - 1] === other(p)) out.push({ from: i, to: nr * N + c - 1 });
      if (c < N - 1 && S.b[nr * N + c + 1] === other(p)) out.push({ from: i, to: nr * N + c + 1 });
    }
    return out;
  }

  // a new state after p plays mv (mv must be one of gen(S, p))
  function play(S, p, mv) {
    const b = S.b.slice();
    const capture = b[mv.to] !== 0;
    b[mv.to] = p;
    b[mv.from] = 0;
    const onGoal = ((mv.to / N) | 0) === goalRow(p);
    return { b: b, t: other(p), c: capture || onGoal ? 0 : Math.min(S.c + 1, DRAW_LIMIT) };
  }

  // 1 / 2 when that side has a piece on the other's back rank, else 0
  function winnerOf(S) {
    for (let c = 0; c < N; c++) {
      if (S.b[c] === 1) return 1;                 // Red on row 0
      if (S.b[7 * N + c] === 2) return 2;         // Blue on row 7
    }
    return 0;
  }

  // what the game is after `mover` just moved
  function outcome(S, mover) {
    const w = winnerOf(S);
    if (w) return { status: "won", winner: w };
    if (S.c >= DRAW_LIMIT) return { status: "draw", winner: 0 };
    if (gen(S, S.t).length === 0) return { status: "won", winner: mover };       // the side to move is stuck
    return { status: "in_progress", winner: 0 };
  }

  /* ---------- the server's check ---------- */
  // Is `next` what `prev` becomes when mover plays one legal move? Returns that move or null.
  function findMove(before, after, p) {
    const want = str(after);
    for (const mv of gen(before, p)) if (str(play(before, p, mv)) === want) return mv;
    return null;
  }
  function check(prev, next, mover) {
    const bad = { ok: false, reason: "illegal" };
    if (mover !== 1 && mover !== 2) return bad;
    if (!next || typeof next !== "object") return bad;
    const after = parse(next.board);
    if (!after) return bad;
    // A live room's first move arrives with no previous state: it starts from the opening position.
    const before = prev ? parse(prev.board) : parse(initial());
    if (!before) return bad;
    if (before.t !== mover) return bad;
    if (after.t !== other(mover)) return bad;
    const mv = findMove(before, after, mover);
    if (!mv) return bad;
    // last = from * 64 + to, so a link can mark both ends of the move
    if (next.last !== mv.from * N + mv.to) return bad;
    const o = outcome(after, mover);
    if (o.status === "won") {
      // only the side that just moved can have won: the other side's piece on
      // this back rank would have ended the game before this move
      if (o.winner !== mover || next.status !== "won" || next.winner !== mover) return bad;
    } else if (o.status === "draw") {
      if (next.status !== "draw" || next.winner !== null) return bad;
    } else if (next.status !== "in_progress" || next.winner !== null) return bad;
    return { ok: true, nextTurn: other(mover) };
  }

  /* ---------- the computer ---------- */
  // Score for p: material, how close each piece is to the other back rank, space.
  const WIN = 1000000;
  function evaluate(S, p) {
    let v = 0, myMin = 9, oppMin = 9;
    for (let i = 0; i < CELLS; i++) {
      const c = S.b[i];
      if (!c) continue;
      const r = (i / N) | 0, col = i % N;
      const dist = c === 1 ? r : 7 - r;                 // moves still needed to reach its back rank
      const mine = c === p;
      let val = 100 + (7 - dist) * 6 + (3 - Math.abs(col - 3.5)) * 4;   // centre files are worth a little more
      if (dist === 1) val += 40;                        // one step from winning
      if (dist === 0) val += 1000;
      v += (mine ? 1 : -1) * val;
      if (mine) { if (dist < myMin) myMin = dist; } else if (dist < oppMin) oppMin = dist;
    }
    if (myMin < 9 && oppMin < 9) v += (oppMin - myMin) * 12;   // whoever is nearer to the goal is ahead
    v += (gen(S, p).length - gen(S, other(p)).length) * 2;      // and more room to move is better
    return v;
  }

  function orderMoves(S, moves, p) {
    const adv = (to) => (p === 1 ? 7 - ((to / N) | 0) : (to / N) | 0);   // bigger = nearer the goal
    moves.sort((a, b) => {
      const ca = S.b[a.to] ? 1 : 0, cb = S.b[b.to] ? 1 : 0;
      if (ca !== cb) return cb - ca;                                     // captures first
      return adv(b.to) - adv(a.to);
    });
    return moves;
  }

  // negamax with alpha-beta; nodes are counted (never the clock) so a move takes about as long every time
  function search(S, p, depth, alpha, beta, ctx) {
    ctx.nodes++;
    const w = winnerOf(S);
    if (w) return w === p ? WIN + depth * 100 : -WIN - depth * 100;
    if (S.c >= DRAW_LIMIT) return 0;
    const moves = gen(S, p);
    if (!moves.length) return -WIN - depth * 100;                        // p is stuck and loses
    if (depth <= 0 || ctx.nodes > ctx.cap) return evaluate(S, p);
    orderMoves(S, moves, p);
    let best = -Infinity;
    for (const mv of moves) {
      const T = play(S, p, mv);
      const v = -search(T, other(p), depth - 1, -beta, -alpha, ctx);
      if (v > best) best = v;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return best;
  }

  const LEVELS = {
    easy:   { depth: 1, cap: 500,   noise: 40, blunder: 0.25 },
    medium: { depth: 2, cap: 6000,  noise: 6,  blunder: 0 },
    hard:   { depth: 4, cap: 30000, noise: 0,  blunder: 0 },
  };

  // the computer's move for p as { from, to }, or null when p has none
  function bestMove(wire, p, level, rng) {
    const S = parse(wire);
    if (!S) return null;
    const moves = gen(S, p);
    if (!moves.length) return null;
    rng = rng || Math.random;
    const lv = LEVELS[level] || LEVELS.medium;
    if (rng() < lv.blunder) return moves[Math.floor(rng() * moves.length)];
    orderMoves(S, moves, p);
    const ctx = { nodes: 0, cap: lv.cap };
    let best = null, bestV = -Infinity;
    for (const mv of moves) {
      const T = play(S, p, mv);
      const w = winnerOf(T);
      let v = w ? (w === p ? WIN * 2 : -WIN * 2) : -search(T, other(p), lv.depth - 1, -Infinity, Infinity, ctx);
      v += rng() * lv.noise;
      if (v > bestV) { bestV = v; best = mv; }
    }
    return best;
  }

  g.BreakthroughRules = {
    N, CELLS, DRAW_LIMIT, other, ownerOf, goalRow,
    create, initial, parse, str, gen, play, winnerOf, outcome, check, bestMove, evaluate,
  };
})(globalThis);
