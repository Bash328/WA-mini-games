/* ============================================================
   blokus-duo/rules.js — the rules of Blokus Duo, written once.

   A plain script that sets globalThis.BlokusRules, so the page loads it with a
   <script> tag and the Worker (worker/rules/blokus-duo.mjs) and the tests
   import it for the same effect. One copy of the rules means the browser and
   the server can never disagree about what a legal move is.

   14x14 board, two players (1 = Orange, 2 = Violet), 21 pieces each (every
   shape of one to five squares: 89 squares). Player 1's first piece must cover
   the square at row 5, column 5 (index 4,4); player 2's the one at row 10,
   column 10 (index 9,9). Every later piece must touch one of your own pieces
   at a CORNER and may never share an EDGE with one of your own. Touching the
   opponent's pieces any way you like is fine. A player who cannot move is
   skipped; when neither can, the game ends and the fewer squares left wins
   (all 21 placed: -15, and -5 more if the last one was the single square).

   Wire board (a string): 196 cells ('0' empty, '1', '2'), then 21 chars for
   player 1's pieces used ('0'/'1') and 21 for player 2's: 238 characters.
   ============================================================ */
(function (g) {
  "use strict";

  const SIZE = 14, CELLS = SIZE * SIZE, PIECES = 21;
  const START = { 1: 4 * SIZE + 4, 2: 9 * SIZE + 9 };
  const NAMES = ["I1", "I2", "I3", "V3", "I4", "L4", "T4", "O4", "Z4", "F5", "I5", "L5", "N5", "P5", "T5", "U5", "V5", "W5", "X5", "Y5", "Z5"];
  const SHAPES = [
    [[0, 0]],
    [[0, 0], [0, 1]],
    [[0, 0], [0, 1], [0, 2]],
    [[0, 0], [1, 0], [1, 1]],
    [[0, 0], [0, 1], [0, 2], [0, 3]],
    [[0, 0], [1, 0], [2, 0], [2, 1]],
    [[0, 0], [0, 1], [0, 2], [1, 1]],
    [[0, 0], [0, 1], [1, 0], [1, 1]],
    [[0, 0], [0, 1], [1, 1], [1, 2]],
    [[0, 1], [0, 2], [1, 0], [1, 1], [2, 1]],
    [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]],
    [[0, 0], [1, 0], [2, 0], [3, 0], [3, 1]],
    [[0, 1], [1, 1], [2, 1], [2, 0], [3, 0]],
    [[0, 0], [0, 1], [1, 0], [1, 1], [2, 0]],
    [[0, 0], [0, 1], [0, 2], [1, 1], [2, 1]],
    [[0, 0], [0, 2], [1, 0], [1, 1], [1, 2]],
    [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2]],
    [[0, 0], [1, 0], [1, 1], [2, 1], [2, 2]],
    [[0, 1], [1, 0], [1, 1], [1, 2], [2, 1]],
    [[0, 1], [1, 0], [1, 1], [2, 1], [3, 1]],
    [[0, 0], [0, 1], [1, 1], [2, 1], [2, 2]],
  ];

  // shift a shape so its top-left is (0,0), cells sorted
  function normalize(cells) {
    let mr = Infinity, mc = Infinity;
    for (const [r, c] of cells) { if (r < mr) mr = r; if (c < mc) mc = c; }
    return cells.map(([r, c]) => [r - mr, c - mc]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  }
  const keyOf = (cells) => cells.map((p) => p[0] + "," + p[1]).join(";");

  // every distinct rotation / reflection of every piece
  const ORIENTS = SHAPES.map((shape) => {
    const seen = new Map();
    let cur = shape;
    for (let flip = 0; flip < 2; flip++) {
      for (let rot = 0; rot < 4; rot++) {
        const n = normalize(cur);
        seen.set(keyOf(n), n);
        cur = cur.map(([r, c]) => [c, -r]);            // rotate 90 degrees
      }
      cur = cur.map(([r, c]) => [r, -c]);              // then mirror
    }
    return Array.from(seen.values());
  });
  const PIECE_OF = new Map();                          // orientation key -> piece index
  ORIENTS.forEach((list, p) => list.forEach((o) => PIECE_OF.set(keyOf(o), p)));
  const SIZES = SHAPES.map((s) => s.length);

  const EMPTY = "0".repeat(CELLS + 2 * PIECES);
  const other = (p) => (p === 1 ? 2 : 1);

  /* ---------- state ---------- */
  // A position is { grid: Uint8Array(196), used: [null, Uint8Array(21), Uint8Array(21)] }.
  function parse(board) {
    const grid = new Uint8Array(CELLS);
    for (let i = 0; i < CELLS; i++) grid[i] = board.charCodeAt(i) - 48;
    const u1 = new Uint8Array(PIECES), u2 = new Uint8Array(PIECES);
    for (let i = 0; i < PIECES; i++) { u1[i] = board.charCodeAt(CELLS + i) - 48; u2[i] = board.charCodeAt(CELLS + PIECES + i) - 48; }
    return { grid, used: [null, u1, u2] };
  }
  function stringify(pos) {
    let s = "";
    for (let i = 0; i < CELLS; i++) s += pos.grid[i];
    for (const p of [1, 2]) for (let i = 0; i < PIECES; i++) s += pos.used[p][i];
    return s;
  }
  const validBoard = (b) => typeof b === "string" && b.length === CELLS + 2 * PIECES && /^[012]{196}[01]{42}$/.test(b);

  /* ---------- placement rules ---------- */
  const ED = [[0, 1], [1, 0], [0, -1], [-1, 0]];
  const DG = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
  const inB = (r, c) => r >= 0 && r < SIZE && c >= 0 && c < SIZE;
  const isFirst = (used) => { for (let i = 0; i < PIECES; i++) if (used[i]) return false; return true; };

  // Is placing these cell indexes (all empty and on the board) legal for player p?
  function placementLegal(grid, cells, p, first) {
    if (first) return cells.indexOf(START[p]) !== -1;
    let corner = false;
    for (const i of cells) {
      const r = (i / SIZE) | 0, c = i % SIZE;
      for (const [dr, dc] of ED) { const rr = r + dr, cc = c + dc; if (inB(rr, cc) && grid[rr * SIZE + cc] === p) return false; }
      if (!corner) for (const [dr, dc] of DG) { const rr = r + dr, cc = c + dc; if (inB(rr, cc) && grid[rr * SIZE + cc] === p) { corner = true; break; } }
    }
    return corner;
  }

  // Empty cells a new piece could hook onto: diagonal to your own stone, not edge-adjacent to one.
  function attachPoints(grid, p) {
    const out = [];
    for (let i = 0; i < CELLS; i++) {
      if (grid[i]) continue;
      const r = (i / SIZE) | 0, c = i % SIZE;
      let edge = false, diag = false;
      for (const [dr, dc] of ED) { const rr = r + dr, cc = c + dc; if (inB(rr, cc) && grid[rr * SIZE + cc] === p) { edge = true; break; } }
      if (edge) continue;
      for (const [dr, dc] of DG) { const rr = r + dr, cc = c + dc; if (inB(rr, cc) && grid[rr * SIZE + cc] === p) { diag = true; break; } }
      if (diag) out.push(i);
    }
    return out;
  }

  // Every legal placement for player p as { piece, o, cells }. With `limit` it
  // stops after that many (hasMove asks for one).
  function legalMoves(grid, used, p, limit) {
    const first = isFirst(used);
    const anchors = first ? [START[p]] : attachPoints(grid, p);
    const out = [], seen = new Set();
    if (!anchors.length) return out;
    for (let piece = 0; piece < PIECES; piece++) {
      if (used[piece]) continue;
      const orients = ORIENTS[piece];
      for (let o = 0; o < orients.length; o++) {
        const shape = orients[o];
        for (const a of anchors) {
          const ar = (a / SIZE) | 0, ac = a % SIZE;
          for (const [sr, sc] of shape) {                      // which cell of the piece lands on the anchor
            const dr = ar - sr, dc = ac - sc;
            const cells = [];
            let ok = true;
            for (const [r, c] of shape) {
              const rr = r + dr, cc = c + dc;
              if (!inB(rr, cc) || grid[rr * SIZE + cc]) { ok = false; break; }
              cells.push(rr * SIZE + cc);
            }
            if (!ok) continue;
            cells.sort((x, y) => x - y);
            const key = piece + ":" + cells.join(",");
            if (seen.has(key)) continue;
            seen.add(key);
            if (placementLegal(grid, cells, p, first)) {
              out.push({ piece, o, cells });
              if (limit && out.length >= limit) return out;
            }
          }
        }
      }
    }
    return out;
  }
  const hasMove = (grid, used, p) => legalMoves(grid, used, p, 1).length > 0;

  // Which piece do these cells make (any rotation / reflection)? -1 if none (not connected, wrong shape).
  function identify(cells) {
    if (!cells.length || cells.length > 5) return -1;
    const pts = cells.map((i) => [(i / SIZE) | 0, i % SIZE]);
    const p = PIECE_OF.get(keyOf(normalize(pts)));
    return p === undefined ? -1 : p;
  }

  /* ---------- scoring and the end of the game ---------- */
  function squaresLeft(used) { let n = 0; for (let i = 0; i < PIECES; i++) if (!used[i]) n += SIZES[i]; return n; }
  // Lower is better. `lastPiece` is the piece the player placed last (for the single-square bonus).
  function penalty(used, lastPiece) {
    const left = squaresLeft(used);
    if (left > 0) return left;
    return -15 - (lastPiece === 0 ? 5 : 0);
  }

  /* After `mover` has placed a piece: who moves next, and is the game over?
     Returns { status, winner, nextTurn }. The opponent moves unless they are
     stuck, in which case the mover goes again; if both are stuck it is over. */
  function outcome(pos, mover, lastPiece) {
    const opp = other(mover);
    if (hasMove(pos.grid, pos.used[opp], opp)) return { status: "in_progress", winner: null, nextTurn: opp };
    if (hasMove(pos.grid, pos.used[mover], mover)) return { status: "in_progress", winner: null, nextTurn: mover };
    const pm = penalty(pos.used[mover], lastPiece), po = penalty(pos.used[opp], -1);
    if (pm === po) return { status: "draw", winner: null, nextTurn: opp };
    return { status: "won", winner: pm < po ? mover : opp, nextTurn: opp };
  }

  /* Apply a move to a position (mutates pos). */
  function play(pos, p, move) {
    for (const i of move.cells) pos.grid[i] = p;
    pos.used[p][move.piece] = 1;
  }

  /* ---------- checking a proposed wire transition (the server and the page both use it) ----------
     before / after: wire boards. Returns { ok, piece, cells, outcome } or { ok: false }. */
  function check(before, after, mover) {
    if (!validBoard(before) || !validBoard(after)) return { ok: false };
    const a = parse(before), b = parse(after);
    const cells = [];
    for (let i = 0; i < CELLS; i++) {
      if (a.grid[i] === b.grid[i]) continue;
      if (a.grid[i] !== 0 || b.grid[i] !== mover) return { ok: false };
      cells.push(i);
    }
    const piece = identify(cells);
    if (piece < 0) return { ok: false };
    for (const p of [1, 2]) for (let i = 0; i < PIECES; i++) {
      const was = a.used[p][i], now = b.used[p][i];
      const expect = p === mover && i === piece ? 1 : was;
      if (now !== expect || (p === mover && i === piece && was !== 0)) return { ok: false };
    }
    if (!placementLegal(a.grid, cells, mover, isFirst(a.used[mover]))) return { ok: false };
    return { ok: true, piece, cells, outcome: outcome(b, mover, piece) };
  }

  g.BlokusRules = {
    SIZE, CELLS, PIECES, START, NAMES, SHAPES, ORIENTS, SIZES, EMPTY,
    parse, stringify, validBoard, legalMoves, hasMove, attachPoints, placementLegal, identify, isFirst,
    squaresLeft, penalty, outcome, play, check, other,
  };
})(globalThis);
