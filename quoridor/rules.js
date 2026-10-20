/* ============================================================
   quoridor/rules.js — the rules and the computer player of Quoridor, written once.

   A plain script that sets globalThis.QuoridorRules, so the page loads it with a
   <script> tag and the Worker (worker/rules/quoridor.mjs) and the tests import it
   for the same effect.

   9x9 board, cell index = row * 9 + column, row 0 at the top. Player 1 (Red)
   starts at the bottom middle (76) and must reach row 0; Player 2 (Blue) starts at
   the top middle (4) and must reach row 8. Each has 10 walls. On your turn EITHER
     - step your pawn one square (up, down, left, right, never through a wall); if
       the opponent stands next to you, jump straight over them, or, if that is
       blocked by a wall or the edge, step diagonally past them; OR
     - place a wall: two squares long, lying in a groove between squares. Walls
       may not cross or overlap another wall, and may never shut either pawn
       completely off from its goal row.
   First pawn on its goal row wins. (If a player has no pawn move and no wall to
   place, the game is a draw.)

   A wall has an id 0..127: orientation * 64 + r * 8 + c, with r, c in 0..7 the
   crossing it sits on (the crossing between rows r, r+1 and columns c, c+1).
   Orientation 0 is horizontal (stops vertical movement), 1 is vertical.

   Wire board (a string): pawn 1 (2 digits), pawn 2 (2 digits), walls left for
   each (one hex digit each), then the placed walls, sorted, two hex digits each.
   ============================================================ */
(function (g) {
  "use strict";

  const N = 9, CELLS = 81;
  const START = { p: [76, 4], w: [10, 10], walls: [] };
  const other = (p) => (p === 1 ? 2 : 1);
  const goalRow = (p) => (p === 1 ? 0 : 8);

  function parse(str) {
    if (typeof str !== "string" || !/^[0-8]\d[0-8]\d[0-9a]{2}([0-9a-f]{2})*$/.test(str)) return null;
    const p = [Number(str.slice(0, 2)), Number(str.slice(2, 4))];
    if (p[0] > 80 || p[1] > 80 || p[0] === p[1]) return null;
    const w = [parseInt(str[4], 16), parseInt(str[5], 16)];
    if (w[0] > 10 || w[1] > 10) return null;
    const walls = [];
    for (let i = 6; i < str.length; i += 2) walls.push(parseInt(str.slice(i, i + 2), 16));
    if (walls.some((x, i) => x > 127 || (i && x <= walls[i - 1]))) return null;        // sorted, no repeats
    if (walls.length !== 20 - w[0] - w[1]) return null;
    return { p, w, walls };
  }
  const hex2 = (n) => (n < 16 ? "0" : "") + n.toString(16);
  const pad2 = (n) => (n < 10 ? "0" : "") + n;
  function str(S) {
    return pad2(S.p[0]) + pad2(S.p[1]) + S.w[0].toString(16) + S.w[1].toString(16) + S.walls.slice().sort((a, b) => a - b).map(hex2).join("");
  }
  const initial = () => str(START);

  // wall lookup tables: H[r*8+c], V[r*8+c]
  function tables(walls) {
    const H = new Uint8Array(64), V = new Uint8Array(64);
    for (const id of walls) (id < 64 ? H : V)[id & 63] = 1;
    return { H, V };
  }
  // is the step between two ADJACENT cells cut by a wall?
  function cut(T, a, b) {
    const ra = Math.floor(a / N), ca = a % N, rb = Math.floor(b / N), cb = b % N;
    if (ca === cb) {                                              // vertical step: horizontal walls
      const r = Math.min(ra, rb);
      return (ca < 8 && T.H[r * 8 + ca] === 1) || (ca > 0 && T.H[r * 8 + ca - 1] === 1);
    }
    const c = Math.min(ca, cb);                                   // horizontal step: vertical walls
    return (ra < 8 && T.V[ra * 8 + c] === 1) || (ra > 0 && T.V[(ra - 1) * 8 + c] === 1);
  }
  const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  const inB = (r, c) => r >= 0 && r < N && c >= 0 && c < N;

  // cells p's pawn may step to (jumps included)
  function pawnMoves(S, p, T) {
    T = T || tables(S.walls);
    const me = S.p[p - 1], opp = S.p[2 - p], r = Math.floor(me / N), c = me % N, out = [];
    for (const [dr, dc] of DIRS) {
      if (!inB(r + dr, c + dc)) continue;
      const n = (r + dr) * N + c + dc;
      if (cut(T, me, n)) continue;
      if (n !== opp) { out.push(n); continue; }
      const jr = r + 2 * dr, jc = c + 2 * dc;
      if (inB(jr, jc) && !cut(T, n, jr * N + jc)) { out.push(jr * N + jc); continue; }
      for (const [er, ec] of DIRS) {                              // straight jump blocked: step diagonally past
        if (er === dr && ec === dc) continue;
        if (er === -dr && ec === -dc) continue;
        const sr = r + dr + er, sc = c + dc + ec;
        if (inB(sr, sc) && !cut(T, n, sr * N + sc)) out.push(sr * N + sc);
      }
    }
    return out;
  }

  // length of the shortest walk to p's goal row (walls only, pawns ignored); -1 when shut in
  function dist(S, p, T) {
    T = T || tables(S.walls);
    const seen = new Uint8Array(CELLS), queue = [S.p[p - 1]], d = new Int8Array(CELLS);
    seen[queue[0]] = 1;
    const goal = goalRow(p);
    for (let h = 0; h < queue.length; h++) {
      const a = queue[h], r = Math.floor(a / N), c = a % N;
      if (r === goal) return d[a];
      for (const [dr, dc] of DIRS) {
        if (!inB(r + dr, c + dc)) continue;
        const b = (r + dr) * N + c + dc;
        if (seen[b] || cut(T, a, b)) continue;
        seen[b] = 1; d[b] = d[a] + 1; queue.push(b);
      }
    }
    return -1;
  }

  // may p place wall id now? (walls left, no crossing or overlap, nobody shut in)
  function wallOk(S, p, id, T) {
    if (!Number.isInteger(id) || id < 0 || id > 127 || S.w[p - 1] < 1) return false;
    const o = id >> 6, r = (id & 63) >> 3, c = id & 7;
    const walls = S.walls;
    if (walls.includes(id)) return false;
    if (walls.includes((1 - o) * 64 + r * 8 + c)) return false;                       // crossing
    if (o === 0 && ((c > 0 && walls.includes(id - 1)) || (c < 7 && walls.includes(id + 1)))) return false;       // overlapping, side by side
    if (o === 1 && ((r > 0 && walls.includes(id - 8)) || (r < 7 && walls.includes(id + 8)))) return false;
    const S2 = { p: S.p, w: S.w, walls: walls.concat([id]) };
    const T2 = tables(S2.walls);
    return dist(S2, 1, T2) >= 0 && dist(S2, 2, T2) >= 0;
  }

  // the position after an action by p: { t: "move", to } | { t: "wall", id }
  function play(S, p, a) {
    if (a.t === "move") { const pp = S.p.slice(); pp[p - 1] = a.to; return { p: pp, w: S.w, walls: S.walls }; }
    const w = S.w.slice(); w[p - 1]--;
    return { p: S.p, w, walls: S.walls.concat([a.id]).sort((x, y) => x - y) };
  }
  const winnerOf = (S) => (Math.floor(S.p[0] / N) === 0 ? 1 : Math.floor(S.p[1] / N) === 8 ? 2 : 0);

  // no pawn move and no wall to place: the player to move is stuck
  function stuck(S, p) {
    if (pawnMoves(S, p).length) return false;
    if (S.w[p - 1] < 1) return true;
    for (let id = 0; id < 128; id++) if (wallOk(S, p, id)) return false;
    return true;
  }

  /* ---------- the server's check ---------- */
  function check(prev, next, mover) {
    const bad = { ok: false, reason: "illegal" };
    if (mover !== 1 && mover !== 2) return bad;
    const before = parse(prev ? prev.board : initial()), after = parse(next.board);
    if (!before || !after) return bad;
    let a = null;
    if (after.p[mover - 1] !== before.p[mover - 1]) {                       // a pawn step
      a = { t: "move", to: after.p[mover - 1] };
      if (!pawnMoves(before, mover).includes(a.to)) return bad;
      if (next.last !== a.to) return bad;
    } else {                                                                 // a wall
      const added = after.walls.filter((x) => !before.walls.includes(x));
      if (added.length !== 1 || after.walls.length !== before.walls.length + 1) return bad;
      a = { t: "wall", id: added[0] };
      if (!wallOk(before, mover, a.id)) return bad;
      if (next.last !== 100 + a.id) return bad;
    }
    if (str(play(before, mover, a)) !== str(after)) return bad;
    const w = winnerOf(after);
    if (w) { if (w !== mover || next.status !== "won" || next.winner !== mover) return bad; return { ok: true, nextTurn: other(mover) }; }
    if (stuck(after, other(mover))) { if (next.status !== "draw" || next.winner !== null) return bad; }
    else if (next.status !== "in_progress" || next.winner !== null) return bad;
    return { ok: true, nextTurn: other(mover) };
  }

  /* ---------- the computer ---------- */
  // how much better the position is for p: a shorter walk for me, a longer one for them, more walls in hand
  function evaluate(S, p) {
    const dm = dist(S, p), dt = dist(S, other(p));
    return (dt - dm) * 10 + (S.w[p - 1] - S.w[2 - p]) * 1.5;
  }
  // every action worth considering for p: all pawn steps and the walls that really slow the opponent
  function candidates(S, p, minGain) {
    const out = [];
    for (const to of pawnMoves(S, p)) out.push({ a: { t: "move", to }, S: play(S, p, { t: "move", to }) });
    if (S.w[p - 1] > 0) {
      const dOpp = dist(S, other(p)), dMe = dist(S, p);
      for (let id = 0; id < 128; id++) {
        if (!wallOk(S, p, id)) continue;
        const S2 = play(S, p, { t: "wall", id });
        const gain = dist(S2, other(p)) - dOpp - (dist(S2, p) - dMe);
        if (gain >= minGain) out.push({ a: { t: "wall", id }, S: S2, gain });
      }
    }
    return out;
  }
  const LEVELS = { easy: { wallMin: 2, top: 4, noise: 6, randomMove: 0.25 }, medium: { wallMin: 1, top: 1, noise: 1.5, randomMove: 0 }, hard: { wallMin: 1, top: 8, noise: 0, randomMove: 0 } };

  // the computer's action for p
  function bestMove(str30, p, level, rng) {
    const S = parse(str30), lv = LEVELS[level] || LEVELS.medium;
    const cands = candidates(S, p, lv.wallMin);
    if (!cands.length) return null;
    for (const c of cands) { c.v = (winnerOf(c.S) === p ? 1e6 : evaluate(c.S, p)) + rng() * lv.noise; }
    cands.sort((x, y) => y.v - x.v);
    if (level === "easy" && rng() < lv.randomMove) {                       // easy sometimes just steps somewhere
      const steps = cands.filter((c) => c.a.t === "move");
      if (steps.length) return steps[Math.floor(rng() * steps.length)].a;
    }
    if (level === "hard") {                                               // look at the opponent's best answer to my best few
      let best = null;
      for (const c of cands.slice(0, lv.top)) {
        let v = c.v;
        if (winnerOf(c.S) !== p) {
          const replies = candidates(c.S, other(p), 1);
          let worst = -Infinity;
          for (const r of replies) worst = Math.max(worst, winnerOf(r.S) === other(p) ? 1e6 : evaluate(r.S, other(p)));
          v = replies.length ? -worst : v;
        }
        if (!best || v > best.v) best = { v, a: c.a };
      }
      return best.a;
    }
    return cands[Math.floor(rng() * Math.min(lv.top, cands.length))].a;
  }

  g.QuoridorRules = {
    N, CELLS, START, other, goalRow, parse, str, initial, tables, cut, pawnMoves, dist, wallOk, play, winnerOf, stuck, check, bestMove, candidates,
  };
})(globalThis);
