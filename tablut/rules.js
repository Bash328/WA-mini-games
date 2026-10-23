/* ============================================================
   tablut/rules.js — the rules and the computer player of Tablut, written once.

   A plain script that sets globalThis.TablutRules, so the page loads it with a
   <script> tag and the Worker (worker/rules/tablut.mjs) and the tests import
   it for the same effect. One copy means the browser and the server cannot
   disagree.

   9x9 board, cell index = row * 9 + column, row 0 at the top. Player 1 (the
   attackers, dark) moves first; player 2 (the defenders, light, with the king)
   moves second. The king starts on the throne (the centre square); eight
   defenders stand around it, and sixteen attackers occupy the middle of the
   four edges:
        . . . A A A . . .
        . . . . A . . . .
        . . . . . . . . .
        A . . D D D . . A
        A A . D K D . A A
        A . . D D D . . A
        . . . . . . . . .
        . . . . A . . . .
        . . . A A A . . .
   Every piece slides like a rook: any distance along its rank or file, over
   empty squares, never through a piece. Only the king may stop on the throne
   (the centre) or on a corner. An empty throne can be slid over by anyone;
   only the king may use a corner, and a corner is the end of a line anyway.

   Captures
   ---------
   A soldier (attacker or defender, never the king) is captured when an enemy
   soldier that just moved squeezes it against another friendly soldier: two
   of your pieces with the enemy directly between them on a rank or file.
   The board edge, the empty throne and the corners do NOT squeeze soldiers.
   A soldier that moves into a gap between two enemies is not captured; only
   a move can capture, and only the pieces around the square that was moved
   to are checked, so one move can capture up to three soldiers.

   The king never captures, and it cannot be the second soldier that squeezes
   an enemy.

   The king is captured when every one of its four sides is blocked: by an
   attacker, by the edge of the board, by the empty throne, or by an empty
   corner. So four attackers are needed in the open, three with the throne or
   an edge behind the king, and two with an edge and a corner behind it. A
   defender beside the king keeps it alive. The king wins the game for the
   defenders the moment it stands on any corner, and that is checked before
   the surround, so a king that reaches a corner is safe. The surround is
   checked after every move, so it is never a move out of date; in practice
   only an attacker's move can complete it (a king cannot slide into a square
   whose four sides are already held, because the square it came through
   would be one of them).
   If the side to move has no legal move at all, that side loses.

   There is no draw rule: a game ends only with a king on a corner or a
   captured king.

   Wire board (a string of 82): 81 cells ('0' empty, '1' attacker,
   '2' defender, '3' king), then the side to move ('1' or '2').
   ============================================================ */
(function (g) {
  "use strict";

  const N = 9, CELLS = 81;
  const EMPTY = 0, ATTACKER = 1, DEFENDER = 2, KING = 3;
  const THRONE = 40;                       // row 4, column 4
  const CORNERS = [0, 8, 72, 80];
  const other = (p) => (p === 1 ? 2 : 1);
  const sideOf = (c) => (c === ATTACKER ? 1 : c === DEFENDER || c === KING ? 2 : 0);

  function isCorner(i) {
    return i === 0 || i === 8 || i === 72 || i === 80;
  }
  // only the king may stand here
  const reserved = (i) => i === THRONE || isCorner(i);
  // the empty square i is a wall for the king's four-side capture check
  const kingWall = (b, i) => b[i] === EMPTY && (i === THRONE || isCorner(i));

  /* ---------- the position, the wire and a fresh game ---------- */
  function create() {
    const b = new Array(CELLS).fill(EMPTY);
    b[THRONE] = KING;
    // the eight defenders: four sides and four diagonals
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        b[(4 + dr) * N + (4 + dc)] = DEFENDER;
      }
    }
    // the sixteen attackers, four in the middle of each edge
    const edge = (r, c) => { b[r * N + c] = ATTACKER; };
    edge(0, 3); edge(0, 4); edge(0, 5); edge(1, 4);
    edge(8, 3); edge(8, 4); edge(8, 5); edge(7, 4);
    edge(3, 0); edge(4, 0); edge(5, 0); edge(4, 1);
    edge(3, 8); edge(4, 8); edge(5, 8); edge(4, 7);
    return { b: b, t: 1 };
  }

  const initial = () => str(create());

  function parse(str) {
    if (typeof str !== "string" || str.length !== CELLS + 1) return null;
    if (!/^[0-3]{81}[12]$/.test(str)) return null;
    const b = Array.from(str.slice(0, CELLS), Number);
    // exactly one king, and no soldier on a square only the king may use
    let kings = 0;
    for (let i = 0; i < CELLS; i++) {
      if (b[i] === KING) kings++;
      else if (b[i] !== EMPTY && reserved(i)) return null;
    }
    if (kings !== 1) return null;
    return { b: b, t: str.charCodeAt(CELLS) - 48 };
  }
  function str(S) {
    return S.b.join("") + S.t;
  }

  /* ---------- moves ---------- */
  function canLand(i, piece) {
    // the throne and the four corners belong to the king alone
    return piece === KING || !reserved(i);
  }

  // every legal move for p: { from, to }
  function gen(S, p) {
    const b = S.b, out = [];
    for (let i = 0; i < CELLS; i++) {
      const piece = b[i];
      if (piece === EMPTY || sideOf(piece) !== p) continue;
      const r = (i / N) | 0, c = i % N;
      // up
      for (let rr = r - 1; rr >= 0; rr--) {
        const j = rr * N + c;
        if (b[j] !== EMPTY) break;
        if (canLand(j, piece)) out.push({ from: i, to: j });
      }
      // down
      for (let rr = r + 1; rr < N; rr++) {
        const j = rr * N + c;
        if (b[j] !== EMPTY) break;
        if (canLand(j, piece)) out.push({ from: i, to: j });
      }
      // left
      for (let cc = c - 1; cc >= 0; cc--) {
        const j = r * N + cc;
        if (b[j] !== EMPTY) break;
        if (canLand(j, piece)) out.push({ from: i, to: j });
      }
      // right
      for (let cc = c + 1; cc < N; cc++) {
        const j = r * N + cc;
        if (b[j] !== EMPTY) break;
        if (canLand(j, piece)) out.push({ from: i, to: j });
      }
    }
    return out;
  }

  // The victim sits between the square just moved to and a friendly soldier
  // two steps away. The edge, the throne and the corners are not soldiers.
  function removeSandwiched(b, to, friendly, enemy) {
    const r = (to / N) | 0, c = to % N;
    const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    for (const [dr, dc] of dirs) {
      const er = r + dr, ec = c + dc;
      if (er < 0 || er >= N || ec < 0 || ec >= N) continue;
      const e = er * N + ec;
      if (b[e] !== enemy) continue;
      const fr = er + dr, fc = ec + dc;
      if (fr < 0 || fr >= N || fc < 0 || fc >= N) continue;
      if (b[fr * N + fc] === friendly) b[e] = EMPTY;
    }
  }

  // a new state after p plays mv (mv must be one of gen(S, p))
  function play(S, p, mv) {
    if (!mv || mv.from < 0 || mv.from >= CELLS || mv.to < 0 || mv.to >= CELLS) return null;
    const b = S.b.slice();
    const piece = b[mv.from];
    if (piece === EMPTY || sideOf(piece) !== p) return null;
    if (b[mv.to] !== EMPTY || !canLand(mv.to, piece)) return null;
    b[mv.from] = EMPTY;
    b[mv.to] = piece;
    // the king is unarmed; soldiers capture, and only the moving side's
    // soldiers count as the friendly half of the sandwich
    if (piece === ATTACKER) removeSandwiched(b, mv.to, ATTACKER, DEFENDER);
    else if (piece === DEFENDER) removeSandwiched(b, mv.to, DEFENDER, ATTACKER);
    return { b: b, t: other(p) };
  }

  /* ---------- the winner ---------- */
  function kingSquare(b) {
    for (let i = 0; i < CELLS; i++) if (b[i] === KING) return i;
    return -1;
  }

  // true when all four sides of the king are blocked (attacker, edge, empty
  // throne or empty corner)
  function kingSurrounded(b) {
    const k = kingSquare(b);
    if (k < 0) return false;
    const r = (k / N) | 0, c = k % N;
    if (r === 0 || b[k - N] === ATTACKER || kingWall(b, k - N)) { /* blocked above */ }
    else return false;
    if (r === N - 1 || b[k + N] === ATTACKER || kingWall(b, k + N)) { /* blocked below */ }
    else return false;
    if (c === 0 || b[k - 1] === ATTACKER || kingWall(b, k - 1)) { /* blocked left */ }
    else return false;
    if (c === N - 1 || b[k + 1] === ATTACKER || kingWall(b, k + 1)) { /* blocked right */ }
    else return false;
    return true;
  }

  // 1 attackers, 2 defenders, 0 still playing
  function winnerOf(S) {
    const b = S.b;
    for (const i of CORNERS) if (b[i] === KING) return 2;
    if (kingSurrounded(b)) return 1;
    return 0;
  }

  // what the game is after `mover` just moved; reason: "escape" | "king" | "stuck" | ""
  function outcome(S, mover) {
    const w = winnerOf(S);
    if (w === 2) return { status: "won", winner: 2, reason: "escape" };
    if (w === 1) return { status: "won", winner: 1, reason: "king" };
    const stuck = S.t;
    if (gen(S, stuck).length === 0) {
      return { status: "won", winner: other(stuck), reason: "stuck" };
    }
    return { status: "in_progress", winner: 0, reason: "" };
  }

  /* ---------- the server's check ---------- */
  // Is `next` what `prev` becomes when mover plays one legal move? Returns that move or null.
  function findMove(before, after, p) {
    const want = str(after);
    for (const mv of gen(before, p)) {
      const T = play(before, p, mv);
      if (T && str(T) === want) return mv;
    }
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
    // last = from * 9 + to, so a link can mark both ends of the move
    if (next.last !== mv.from * N + mv.to) return bad;
    const o = outcome(after, mover);
    if (o.status === "won") {
      // Either side can win on the move that produced this position: the
      // defenders by the king's escape, the attackers by the capture. What
      // matters is that the board and the reported result agree.
      if (next.status !== "won" || next.winner !== o.winner) return bad;
    } else if (next.status !== "in_progress" || next.winner !== null) return bad;
    return { ok: true, nextTurn: other(mover) };
  }

  /* ---------- the computer ---------- */
  const WIN = 1000000;

  function cornerDistance(r, c) {
    return Math.min(r + c, r + (N - 1 - c), (N - 1 - r) + c, (N - 1 - r) + (N - 1 - c));
  }

  // Can the king slide straight to a corner from here, with nothing in the way?
  function kingHasEscapeLine(b, kr, kc) {
    for (const i of CORNERS) {
      const cr = (i / N) | 0, cc = i % N;
      if (kr !== cr && kc !== cc) continue;
      let clear = true;
      if (kr === cr) {
        const step = cc > kc ? 1 : -1;
        for (let c = kc + step; c !== cc + step; c += step) {
          if (b[cr * N + c] !== EMPTY) { clear = false; break; }
        }
      } else {
        const step = cr > kr ? 1 : -1;
        for (let r = kr + step; r !== cr + step; r += step) {
          if (b[r * N + kc] !== EMPTY) { clear = false; break; }
        }
      }
      if (clear) return true;
    }
    return false;
  }

  // Score for p: the king's danger and the material, from p's point of view.
  function evaluate(S, p) {
    const b = S.b;
    const k = kingSquare(b);
    if (k < 0) return p === ATTACKER ? WIN : -WIN;
    const kr = (k / N) | 0, kc = k % N;
    let atk = 0, def = 0;
    for (let i = 0; i < CELLS; i++) {
      if (b[i] === ATTACKER) atk++;
      else if (b[i] === DEFENDER) def++;
    }
    let score = (atk - def) * 50;                    // attackers' point of view
    score += cornerDistance(kr, kc) * 16;            // the further from a corner, the better for them
    let blocked = 0, shield = 0;
    const sides = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    for (const [dr, dc] of sides) {
      const rr = kr + dr, cc = kc + dc;
      if (rr < 0 || rr >= N || cc < 0 || cc >= N) { blocked++; continue; }
      const j = rr * N + cc;
      if (b[j] === ATTACKER) blocked++;
      else if (b[j] === EMPTY && (j === THRONE || isCorner(j))) blocked++;
      else if (b[j] === DEFENDER) shield++;
    }
    score += blocked * 90 - shield * 35;
    if (blocked === 3) score += S.t === ATTACKER ? 900 : 300;   // one side from the kill
    // attackers close to the king
    for (let i = 0; i < CELLS; i++) {
      if (b[i] !== ATTACKER) continue;
      const r = (i / N) | 0, c = i % N;
      const d = Math.max(Math.abs(r - kr), Math.abs(c - kc));
      if (d === 1) score += 14;
      else if (d === 2) score += 8;
    }
    // a clear line from the king to a corner is an escape threat
    if (kingHasEscapeLine(b, kr, kc)) score -= S.t === 2 ? 6000 : 1500;
    return p === ATTACKER ? score : -score;
  }

  // Nearest-first, and the king's own moves first when the defenders are choosing.
  function orderMoves(S, moves, p) {
    const k = kingSquare(S.b);
    const kr = k < 0 ? 4 : (k / N) | 0, kc = k < 0 ? 4 : k % N;
    const dist = (i) => Math.abs(((i / N) | 0) - kr) + Math.abs((i % N) - kc);
    const score = (m) => {
      const piece = S.b[m.from];
      if (p === DEFENDER && piece === KING) {
        return 1000 - cornerDistance((m.to / N) | 0, m.to % N) * 10;
      }
      return -dist(m.to);
    };
    moves.sort((a, b) => score(b) - score(a));
    return moves;
  }

  // negamax with alpha-beta; nodes are counted (never the clock) so a move takes about as long every time
  function search(S, p, depth, alpha, beta, ctx) {
    ctx.nodes++;
    const w = winnerOf(S);
    if (w) return w === p ? WIN + depth * 100 : -WIN - depth * 100;
    const moves = gen(S, p);
    if (!moves.length) return -WIN - depth * 100;                     // p is stuck and loses
    if (depth <= 0 || ctx.nodes > ctx.cap) return evaluate(S, p);
    orderMoves(S, moves, p);
    let best = -Infinity;
    for (const mv of moves) {
      const T = play(S, p, mv);
      if (!T) continue;
      const v = -search(T, other(p), depth - 1, -beta, -alpha, ctx);
      if (v > best) best = v;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return best;
  }

  const LEVELS = {
    easy:   { depth: 1, cap: 700,   noise: 60, blunder: 0.3 },
    medium: { depth: 2, cap: 4000,  noise: 12, blunder: 0 },
    hard:   { depth: 3, cap: 12000, noise: 0,  blunder: 0 },
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
      if (!T) continue;
      const w = winnerOf(T);
      let v = w ? (w === p ? WIN * 2 : -WIN * 2) : -search(T, other(p), lv.depth - 1, -Infinity, Infinity, ctx);
      v += rng() * lv.noise;
      if (v > bestV) { bestV = v; best = mv; }
    }
    return best;
  }

  g.TablutRules = {
    N, CELLS, EMPTY, ATTACKER, DEFENDER, KING, THRONE, CORNERS,
    other, sideOf, isCorner, create, initial, parse, str, gen, play,
    winnerOf, kingSquare, kingSurrounded, outcome, check, bestMove, evaluate,
  };
})(globalThis);
