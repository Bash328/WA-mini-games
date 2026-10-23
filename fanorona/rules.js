/* ============================================================
   fanorona/rules.js — the rules and the computer player of Fanorona, written once.

   A plain script that sets globalThis.FanoronaRules, so the page loads it with
   a <script> tag and the Worker (worker/rules/fanorona.mjs) and the tests
   import it for the same effect. One copy means the browser and the server
   cannot disagree.

   The board is the Fanoron-Sivy board: 9 columns by 5 rows of POINTS, cell
   index = row * 9 + column, row 0 at the top. Pieces sit on points and move
   one step along a marked line to an empty neighbour.

   The marked lines are:
     - every row and every column (all points);
     - the diagonals, which only pass through alternate points: point (c,r)
       lies on a diagonal line when c + r is even. Those are the "strong"
       points; a point with c + r odd has horizontal and vertical moves only.
   This is the traditional board: the diagonals run in long 45-degree lines
   across the board (for example (0,4)-(1,3)-(2,2)-(3,1)-(4,0)), so every
   diagonal step is a step between neighbouring points on one of those lines.

   Setup: all 44 pieces are placed except the centre point (column 4, row 2).
   Red (player 1) holds the two bottom rows and the four middle-row points
   1, 3, 6, 8 (columns counted from 0); Blue (player 2) holds the two top rows
   and middle points 0, 2, 5, 7. Each side has 22 pieces; Red moves first.

   CAPTURES (the part that makes Fanorona Fanorona):
     - Capturing is compulsory: if any capturing move exists, only capturing
       moves are legal.
     - A capture removes every enemy piece in an unbroken line that starts at
       the point next to the moving piece:
         approach  — the line beyond the point the piece moves TO, in the
                     direction of movement;
         withdrawal — the line beyond the point the piece moves FROM, in the
                     opposite direction (the piece moves away from it).
     - Both lines are offered as separate moves when both exist; the player
       chooses one (the page asks with two buttons). One step never captures
       both lines.
     - After a capture, if the same piece can capture again, it MUST do so and
       the turn continues with that piece (a chain). The turn ends only when
       the piece has no capture left. (This is the strict variant of the rule;
       some rule sets let the player stop earlier. See the page's How to play.)
   Winning: the side to move with no pieces, or with no legal move, loses.
   So that a link can never loop forever, 60 turns in a row without a capture
   end the game in a draw. Capture turns reset that counter.

   Wire board (49 characters):
     45 cells ('0' empty, '1' Red/P1, '2' Blue/P2),
     then the side to move ('1' or '2'),
     then the chain point as one base-46 character (0-9 A-Z a-j; 'j' means no
       chain, i.e. the side to move has not yet captured this turn),
     then the quiet-turn counter as two decimal digits (00-60).
   A chain point is the point the capturing piece stands on while it must keep
   capturing; it belongs to the side to move.
   ============================================================ */
(function (g) {
  "use strict";

  const COLS = 9, ROWS = 5, CELLS = 45, DRAW_LIMIT = 60;
  const other = (p) => (p === 1 ? 2 : 1);
  const rowOf = (i) => (i / COLS) | 0;
  const colOf = (i) => i % COLS;
  const at = (r, c) => r * COLS + c;
  const inside = (r, c) => r >= 0 && r < ROWS && c >= 0 && c < COLS;
  const strong = (i) => ((rowOf(i) + colOf(i)) & 1) === 0;   // lies on the diagonals
  // The eight lines leaving a point. Diagonal directions only exist at a strong point.
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  const CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij";   // 46 symbols
  const NO_CHAIN = 45;

  /* ---------- the position, the wire and a fresh game ---------- */
  function create() {
    const b = new Array(CELLS).fill(0);
    for (let c = 0; c < COLS; c++) {
      b[at(0, c)] = 2;                                  // Blue: top two rows
      b[at(1, c)] = 2;
      b[at(3, c)] = 1;                                  // Red: bottom two rows
      b[at(4, c)] = 1;
    }
    // the middle row, alternately, with the centre point empty
    const mid = [2, 1, 2, 1, 0, 2, 1, 2, 1];
    for (let c = 0; c < COLS; c++) b[at(2, c)] = mid[c];
    return { b: b, t: 1, from: -1, c: 0 };              // t: side to move, from: chain point, c: quiet turns
  }
  const pad2 = (n) => (n < 10 ? "0" : "") + n;
  const initial = () => str(create());

  function parse(wire) {
    if (typeof wire !== "string" || wire.length !== CELLS + 4) return null;
    if (!/^[012]{45}[12][0-9A-Za-j]\d{2}$/.test(wire)) return null;
    const b = Array.from(wire.slice(0, CELLS), Number);
    const t = wire.charCodeAt(CELLS) - 48;
    const from = CHARS.indexOf(wire.charAt(CELLS + 1));
    if (from < 0 || from > NO_CHAIN) return null;
    const c = Number(wire.slice(CELLS + 2));
    if (c > DRAW_LIMIT) return null;
    if (from !== NO_CHAIN) {
      // A chain point must hold the side to move's piece, must still have a
      // capture, and (a chain only starts with a capture) has a quiet count of 0.
      if (b[from] !== t || c !== 0) return null;
      const probe = [];
      captureMovesAt(b, t, from, probe);
      if (!probe.length) return null;
    }
    return { b: b, t: t, from: from === NO_CHAIN ? -1 : from, c: c };
  }
  function str(S) {
    return S.b.join("") + S.t + CHARS.charAt(S.from < 0 ? NO_CHAIN : S.from) + pad2(S.c);
  }

  /* ---------- movement and captures ---------- */
  const enemy = (p) => other(p);

  // Every enemy piece in an unbroken line that starts one step from `start`
  // and continues in (dc, dr). Stops at an empty point, an own piece or the edge.
  function lineEnemies(b, p, start, dc, dr) {
    const out = [];
    let r = rowOf(start) + dr, c = colOf(start) + dc;
    while (inside(r, c)) {
      const i = at(r, c);
      if (b[i] !== enemy(p)) break;
      out.push(i);
      r += dr;
      c += dc;
    }
    return out;
  }

  // Put every capturing move from `from` into out. A move can capture the line
  // ahead (approach) or the line behind (withdrawal); both are separate moves.
  function captureMovesAt(b, p, from, out) {
    const r = rowOf(from), c = colOf(from);
    const diagOk = ((r + c) & 1) === 0;                 // weak points have no diagonals
    for (let k = 0; k < 8; k++) {
      const dc = DIRS[k][0], dr = DIRS[k][1];
      if (dc !== 0 && dr !== 0 && !diagOk) continue;
      const nr = r + dr, nc = c + dc;
      if (!inside(nr, nc)) continue;
      const to = at(nr, nc);
      if (b[to] !== 0) continue;                        // a step only lands on an empty point
      const ahead = lineEnemies(b, p, to, dc, dr);
      const behind = lineEnemies(b, p, from, -dc, -dr);
      if (ahead.length) out.push({ from: from, to: to, cap: 1, n: ahead.length });
      if (behind.length) out.push({ from: from, to: to, cap: 2, n: behind.length });
    }
  }
  function quietMovesAt(b, p, from, out) {
    const r = rowOf(from), c = colOf(from);
    const diagOk = ((r + c) & 1) === 0;
    for (let k = 0; k < 8; k++) {
      const dc = DIRS[k][0], dr = DIRS[k][1];
      if (dc !== 0 && dr !== 0 && !diagOk) continue;
      const nr = r + dr, nc = c + dc;
      if (!inside(nr, nc)) continue;
      const to = at(nr, nc);
      if (b[to] === 0) out.push({ from: from, to: to, cap: 0, n: 0 });
    }
  }

  // Every legal move for p: { from, to, cap, n }.
  // While a chain is running only that piece may move, and only by capturing.
  function gen(S, p) {
    const b = S.b;
    if (p !== 1 && p !== 2) return [];
    if (S.from >= 0) {
      if (S.t !== p || b[S.from] !== p) return [];
      const chain = [];
      captureMovesAt(b, p, S.from, chain);
      return chain;
    }
    const pieces = [];
    for (let i = 0; i < CELLS; i++) if (b[i] === p) pieces.push(i);
    const caps = [];
    for (const from of pieces) captureMovesAt(b, p, from, caps);
    if (caps.length) return caps;                       // capturing is compulsory
    const quiet = [];
    for (const from of pieces) quietMovesAt(b, p, from, quiet);
    return quiet;
  }

  // A new state after p plays mv (mv must come from gen(S, p)).
  function play(S, p, mv) {
    if (!mv || typeof mv !== "object") return null;
    const from = mv.from, to = mv.to;
    if (!Number.isInteger(from) || !Number.isInteger(to)) return null;
    if (!inside(rowOf(from), colOf(from)) || !inside(rowOf(to), colOf(to))) return null;
    const dc = colOf(to) - colOf(from), dr = rowOf(to) - rowOf(from);
    if (dc === 0 && dr === 0) return null;
    if (Math.abs(dc) > 1 || Math.abs(dr) > 1) return null;
    if ((dc !== 0 && dr !== 0) && !strong(from)) return null;
    if (S.b[from] !== p || S.b[to] !== 0) return null;
    let taken;
    if (mv.cap === 1) taken = lineEnemies(S.b, p, to, dc, dr);        // approach
    else if (mv.cap === 2) taken = lineEnemies(S.b, p, from, -dc, -dr); // withdrawal
    else if (mv.cap === 0) taken = [];
    else return null;

    const b = S.b.slice();
    b[to] = p;
    b[from] = 0;
    for (const i of taken) b[i] = 0;

    if (mv.cap !== 0) {
      const more = [];
      captureMovesAt(b, p, to, more);
      if (more.length) return { b: b, t: p, from: to, c: 0 };        // the same piece must capture again
      return { b: b, t: other(p), from: -1, c: 0 };
    }
    return { b: b, t: other(p), from: -1, c: Math.min(S.c + 1, DRAW_LIMIT) };
  }

  // Apply a whole turn (or a prefix of a chain) given as an array of moves.
  // Returns null if any step is not among that position's legal moves.
  function playTurn(S, p, moves) {
    const list = Array.isArray(moves) ? moves : [moves];
    let T = S;
    for (const mv of list) {
      const legal = gen(T, p);
      if (!legal.some((m) => m.from === mv.from && m.to === mv.to && m.cap === mv.cap)) return null;
      T = play(T, p, mv);
      if (!T) return null;
    }
    return T;
  }

  /* ---------- result ---------- */
  function countPieces(b, p) {
    let n = 0;
    for (let i = 0; i < CELLS; i++) if (b[i] === p) n++;
    return n;
  }

  // 1 or 2 once the position is decided, else 0. A chain in progress is not decided.
  function winner(S) {
    if (S.from >= 0) return 0;
    if (countPieces(S.b, 1) === 0) return 2;
    if (countPieces(S.b, 2) === 0) return 1;
    if (gen(S, S.t).length === 0) return other(S.t);     // the side to move is stuck and loses
    return 0;
  }

  // What the game is after `mover` just moved.
  function outcome(S, mover) {
    const w = winner(S);
    if (w) return { status: "won", winner: w };
    if (S.c >= DRAW_LIMIT) return { status: "draw", winner: 0 };
    return { status: "in_progress", winner: 0, chain: S.from >= 0 };
  }

  /* ---------- the server's check ---------- */
  function findMove(before, after, p) {
    const want = str(after);
    for (const mv of gen(before, p)) {
      const T = play(before, p, mv);
      if (T && str(T) === want) return mv;
    }
    return null;
  }
  // Is `next` what `prev` becomes when mover plays one legal move (one chain
  // step)? Returns the move's next turn (the mover again while the chain
  // continues) or an { ok: false } reason.
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
    const mv = findMove(before, after, mover);
    if (!mv) return bad;
    // last = from * 45 + to, so a link can mark both ends of the move
    if (next.last !== mv.from * CELLS + mv.to) return bad;
    const o = outcome(after, mover);
    if (o.status === "won") {
      // only the side that just moved can have won
      if (o.winner !== mover || next.status !== "won" || next.winner !== mover) return bad;
    } else if (o.status === "draw") {
      if (next.status !== "draw" || next.winner !== null) return bad;
    } else if (next.status !== "in_progress" || next.winner !== null) return bad;
    return { ok: true, nextTurn: after.t };
  }

  /* ---------- the computer ---------- */
  const WIN = 1000000;

  // Material, plus a little for pieces on the points with diagonal lines and
  // for the middle of the board, plus how much room each side has to step.
  function evaluate(S, p) {
    let v = 0;
    const room = [0, 0];
    for (let i = 0; i < CELLS; i++) {
      const c = S.b[i];
      if (!c) continue;
      const r = rowOf(i), col = colOf(i);
      const diag = ((r + col) & 1) === 0;
      let val = 100 + (diag ? 6 : 0) + (4 - (Math.abs(col - 4) + Math.abs(r - 2))) * 2;
      v += (c === p ? 1 : -1) * val;
      // empty neighbouring points, a cheap stand-in for mobility
      for (let k = 0; k < 8; k++) {
        const dc = DIRS[k][0], dr = DIRS[k][1];
        if (dc !== 0 && dr !== 0 && !diag) continue;
        const nr = r + dr, nc = col + dc;
        if (inside(nr, nc) && S.b[at(nr, nc)] === 0) room[c === p ? 0 : 1]++;
      }
    }
    v += (room[0] - room[1]) * 3;
    return v;
  }

  function orderMoves(S, moves, p) {
    moves.sort((a, b) => {
      if (b.n !== a.n) return b.n - a.n;                          // most pieces taken first
      if (b.cap !== a.cap) return b.cap - a.cap;                  // then captures before quiet moves
      const sa = strong(a.to) ? 1 : 0, sb = strong(b.to) ? 1 : 0;
      return sb - sa;
    });
    return moves;
  }

  // Negamax with alpha-beta over chain steps. A chain keeps the same side to
  // move, so its steps are searched without costing a ply (a capture sequence
  // is one turn). Nodes are counted (never the clock), so a move takes about
  // as long every time.
  function search(S, p, depth, alpha, beta, ctx) {
    ctx.nodes++;
    const moves = gen(S, p);
    if (!moves.length) return -WIN - depth * 100;                 // p stuck and loses
    if (S.c >= DRAW_LIMIT) return 0;
    if (ctx.nodes > ctx.cap) return evaluate(S, p);                // bounded, so a long chain cannot run away
    if (depth <= 0 && S.from < 0) return evaluate(S, p);
    orderMoves(S, moves, p);
    let best = -Infinity;
    for (const mv of moves) {
      const T = play(S, p, mv);
      if (!T) continue;
      const v = T.t === p
        ? search(T, p, depth, alpha, beta, ctx)                   // chain continues with the same piece
        : -search(T, other(p), depth - 1, -beta, -alpha, ctx);
      if (v > best) best = v;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return best;
  }

  const LEVELS = {
    easy:   { depth: 1, cap: 500,   noise: 55, blunder: 0.25 },
    medium: { depth: 2, cap: 4000,  noise: 8,  blunder: 0 },
    hard:   { depth: 3, cap: 14000, noise: 0,  blunder: 0 },
  };

  // The computer's move for p as { from, to, cap, n }, or null when p has none.
  function bestMove(wire, p, level, rng) {
    const S = parse(wire);
    if (!S || S.t !== p) return null;
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
      if (!T) continue;
      let v = T.t === p
        ? search(T, p, lv.depth, -Infinity, Infinity, ctx)
        : -search(T, other(p), lv.depth - 1, -Infinity, Infinity, ctx);
      v += rng() * lv.noise;
      if (v > bestV) { bestV = v; best = mv; }
    }
    return best;
  }

  g.FanoronaRules = {
    COLS, ROWS, CELLS, DRAW_LIMIT, other,
    at, rowOf, colOf, inside, strong, countPieces,
    create, initial, parse, str, gen, play, playTurn,
    winner, outcome, check, bestMove, evaluate,
  };
})(globalThis);
