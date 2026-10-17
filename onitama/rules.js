/* ============================================================
   onitama/rules.js — the rules and the computer player of Onitama, written once.

   A plain script that sets globalThis.OnitamaRules, so the page loads it with a
   <script> tag and the Worker (worker/rules/onitama.mjs) and the tests import it
   for the same effect. One copy means the browser and the server cannot disagree.

   5x5 board, row 0 at the top. Player 1 (Red) starts on the bottom row and moves
   up; Player 2 (Blue) starts on the top row and moves down. Each side has four
   pawns and one master (the middle piece). 16 move cards exist; 5 are in play:
   two in each hand and one beside the board. To move, play one of your cards: the
   piece moves by one of the card's steps (as seen from your own side), never onto
   your own piece. The card you used goes beside the board and you take the card
   that was there. First to capture the other master, or to put their own master
   on the other player's temple (the middle square of the far row), wins.
   With no legal move at all you must still give up one card (a pass).

   Wire board (a string of 30): 25 cells ('0' empty, '1' P1 pawn, '2' P1 master,
   '3' P2 pawn, '4' P2 master), then P1's two cards, P2's two cards (each pair in
   ascending order) and the side card, each one hex digit 0-f.
   ============================================================ */
(function (g) {
  "use strict";

  const N = 5, CELLS = 25;
  // steps are [right, forward] as seen by the player who holds the card
  const CARDS = [
    { name: "Tiger",    m: [[0, 2], [0, -1]] },
    { name: "Dragon",   m: [[-2, 1], [2, 1], [-1, -1], [1, -1]] },
    { name: "Frog",     m: [[-2, 0], [-1, 1], [1, -1]] },
    { name: "Rabbit",   m: [[2, 0], [1, 1], [-1, -1]] },
    { name: "Crab",     m: [[0, 1], [-2, 0], [2, 0]] },
    { name: "Elephant", m: [[-1, 0], [1, 0], [-1, 1], [1, 1]] },
    { name: "Goose",    m: [[-1, 0], [-1, 1], [1, 0], [1, -1]] },
    { name: "Rooster",  m: [[1, 0], [1, 1], [-1, 0], [-1, -1]] },
    { name: "Monkey",   m: [[-1, 1], [1, 1], [-1, -1], [1, -1]] },
    { name: "Mantis",   m: [[-1, 1], [1, 1], [0, -1]] },
    { name: "Horse",    m: [[0, 1], [0, -1], [-1, 0]] },
    { name: "Ox",       m: [[0, 1], [0, -1], [1, 0]] },
    { name: "Crane",    m: [[0, 1], [-1, -1], [1, -1]] },
    { name: "Boar",     m: [[0, 1], [-1, 0], [1, 0]] },
    { name: "Eel",      m: [[-1, 1], [-1, -1], [1, 0]] },
    { name: "Cobra",    m: [[-1, 0], [1, 1], [1, -1]] },
  ];
  const TEMPLE = { 1: 2, 2: 22 };                 // the square a player's master must reach is the OTHER one: P1 wins on 2, P2 on 22
  const other = (p) => (p === 1 ? 2 : 1);
  const ownerOf = (c) => (c === 0 ? 0 : c <= 2 ? 1 : 2);
  const START = "3" + "3" + "4" + "3" + "3" + "0".repeat(15) + "1" + "1" + "2" + "1" + "1";

  /* ---------- the state: { b: [25 ints], h: [[a,b],[a,b]] (index 0 = P1), s: side } ---------- */
  function parse(str) {
    if (typeof str !== "string" || str.length !== 30 || !/^[0-4]{25}[0-9a-f]{5}$/.test(str)) return null;
    const b = Array.from(str.slice(0, 25), Number);
    const c = Array.from(str.slice(25), (x) => parseInt(x, 16));
    if (new Set(c).size !== 5) return null;
    if (c[0] > c[1] || c[2] > c[3]) return null;
    return { b, h: [[c[0], c[1]], [c[2], c[3]]], s: c[4] };
  }
  const hex = (n) => n.toString(16);
  function str(S) {
    const h1 = S.h[0].slice().sort((a, b) => a - b), h2 = S.h[1].slice().sort((a, b) => a - b);
    return S.b.join("") + hex(h1[0]) + hex(h1[1]) + hex(h2[0]) + hex(h2[1]) + hex(S.s);
  }

  // the board squares a card lets a piece on `from` reach (ignores what is there)
  function reach(from, card, p) {
    const r = Math.floor(from / N), c = from % N, out = [];
    for (const [dx, dy] of CARDS[card].m) {
      const nr = p === 1 ? r - dy : r + dy, nc = p === 1 ? c + dx : c - dx;
      if (nr >= 0 && nr < N && nc >= 0 && nc < N) out.push(nr * N + nc);
    }
    return out;
  }

  // every legal move for p: { from, to, card }
  function gen(S, p) {
    const out = [];
    for (let i = 0; i < CELLS; i++) {
      if (ownerOf(S.b[i]) !== p) continue;
      for (const card of S.h[p - 1]) for (const to of reach(i, card, p)) if (ownerOf(S.b[to]) !== p) out.push({ from: i, to, card });
    }
    return out;
  }

  // a new state after p plays mv (mv.from === -1: a pass, only the cards turn over)
  function play(S, p, mv) {
    const b = S.b.slice();
    if (mv.from >= 0) { b[mv.to] = b[mv.from]; b[mv.from] = 0; }
    const hand = S.h[p - 1].map((x) => (x === mv.card ? S.s : x));
    return { b, h: p === 1 ? [hand, S.h[1]] : [S.h[0], hand], s: mv.card };
  }

  // who has won after `mover` just moved: 0 nobody yet
  function winnerOf(S, mover) {
    const m1 = S.b.indexOf(2), m2 = S.b.indexOf(4);
    if (m1 < 0) return 2;
    if (m2 < 0) return 1;
    if (mover === 1 && m1 === TEMPLE[1]) return 1;
    if (mover === 2 && m2 === TEMPLE[2]) return 2;
    return 0;
  }
  const passes = (S, p) => S.h[p - 1].map((card) => ({ from: -1, to: -1, card }));

  /* ---------- the server's check ---------- */
  // Is `after` what `before` becomes when p plays one legal move (or a forced pass)? Returns that move or null.
  function findMove(before, after, p) {
    const moves = gen(before, p);
    const list = moves.length ? moves : passes(before, p);
    const want = str(after);
    for (const mv of list) if (str(play(before, p, mv)) === want) return mv;
    return null;
  }
  function check(prev, next, mover) {
    const bad = { ok: false, reason: "illegal" };
    if (mover !== 1 && mover !== 2) return bad;
    const after = parse(next.board);
    if (!after) return bad;
    let mv = null;
    if (prev) {
      const before = parse(prev.board);
      if (!before) return bad;
      mv = findMove(before, after, mover);
    } else {
      // The very first move: the opening deal is the opener's (nothing hidden, so it is only a choice of cards).
      // Work back to the position before the move: the card used is now the side card, and the card that was
      // beside the board is one of the opener's two cards now.
      if (mover !== 1) return bad;
      for (const x of after.h[0]) {
        const before = { b: START.slice(0, 25).split("").map(Number), h: [after.h[0].map((c) => (c === x ? after.s : c)), after.h[1]], s: x };
        mv = findMove(before, after, 1);
        if (mv) break;
      }
    }
    if (!mv) return bad;
    const expect = mv.from >= 0 ? mv.to : 25;
    if (next.last !== expect) return bad;
    const w = winnerOf(after, mover);
    if (w) { if (next.status !== "won" || next.winner !== w) return bad; }
    else if (next.status !== "in_progress" || next.winner !== null) return bad;
    return { ok: true, nextTurn: other(mover) };
  }

  /* ---------- a fresh deal ---------- */
  function deal(rng) {
    const ids = Array.from({ length: 16 }, (_, i) => i);
    for (let i = 15; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const t = ids[i]; ids[i] = ids[j]; ids[j] = t; }
    return str({ b: START.slice(0, 25).split("").map(Number), h: [ids.slice(0, 2), ids.slice(2, 4)], s: ids[4] });
  }

  /* ---------- the computer ---------- */
  // Score for the player to move: material, how far the pawns have come, how central the master is.
  function evaluate(S, p) {
    let v = 0;
    for (let i = 0; i < CELLS; i++) {
      const c = S.b[i];
      if (!c) continue;
      const o = ownerOf(c), sign = o === p ? 1 : -1;
      const r = Math.floor(i / N), col = i % N;
      const adv = o === 1 ? N - 1 - r : r;
      v += sign * (c === 2 || c === 4 ? 40 + 2 * (2 - Math.abs(col - 2)) + 4 * adv : 100 + 3 * adv + (2 - Math.abs(col - 2)));
    }
    v += (S.h[p - 1].reduce((a, c) => a + CARDS[c].m.length, 0) - S.h[2 - p].reduce((a, c) => a + CARDS[c].m.length, 0));
    return v;
  }
  const WIN = 100000;
  // negamax with alpha-beta; nodes are counted (never the clock) so a move always takes about as long
  function search(S, p, depth, alpha, beta, ctx) {
    ctx.nodes++;
    if (depth === 0 || ctx.nodes > ctx.cap) return evaluate(S, p);
    let moves = gen(S, p);
    if (!moves.length) moves = passes(S, p);
    // look at captures first: cuts the tree a lot
    moves.sort((a, b) => (ownerOf(S.b[b.to]) ? 1 : 0) - (ownerOf(S.b[a.to]) ? 1 : 0));
    let best = -Infinity;
    for (const mv of moves) {
      const T = play(S, p, mv);
      const w = winnerOf(T, p);
      const v = w ? WIN + depth : -search(T, other(p), depth - 1, -beta, -alpha, ctx);
      if (v > best) best = v;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return best;
  }
  const LEVELS = { easy: { depth: 1, cap: 2000, noise: 60, blunder: 0.2 }, medium: { depth: 3, cap: 20000, noise: 8, blunder: 0 }, hard: { depth: 5, cap: 60000, noise: 0, blunder: 0 } };
  // the computer's move for p as { from, to, card } (from -1: a pass)
  function bestMove(str30, p, level, rng) {
    const S = parse(str30);
    const lv = LEVELS[level] || LEVELS.medium;
    let moves = gen(S, p);
    if (!moves.length) moves = passes(S, p);
    if (rng() < lv.blunder) return moves[Math.floor(rng() * moves.length)];
    const ctx = { nodes: 0, cap: lv.cap };
    let best = null;
    for (const mv of moves) {
      const T = play(S, p, mv);
      const v = winnerOf(T, p) ? WIN * 2 : -search(T, other(p), lv.depth - 1, -Infinity, Infinity, ctx) + rng() * lv.noise;
      if (!best || v > best.v) best = { v, mv };
    }
    return best.mv;
  }

  g.OnitamaRules = {
    N, CELLS, CARDS, START: START, other, ownerOf, parse, str, reach, gen, play, passes, winnerOf, check, deal, bestMove,
    TEMPLE, EMPTY: null,
  };
})(globalThis);
