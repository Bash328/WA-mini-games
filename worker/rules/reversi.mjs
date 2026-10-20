/* ============================================================
   rules/reversi.mjs — server-side rules for live Reversi.

   Wire board (same as reversi/game.js): 64 chars, row-major, '0' empty,
   '1' Black (opens), '2' White. Players are the numbers 1 and 2. A move
   that leaves the opponent with no reply passes the turn back to the
   mover; if neither side can move the game ends (more discs wins).
   ============================================================ */

const N = 8;
const DIRS = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];

export function initialBoard() {
  const b = new Array(N * N).fill(0);
  b[3 * N + 3] = 2; b[3 * N + 4] = 1;
  b[4 * N + 3] = 1; b[4 * N + 4] = 2;
  return b.join("");
}

const inB = (r, c) => r >= 0 && r < N && c >= 0 && c < N;
const other = (p) => (p === 1 ? 2 : 1);

/* Cells that would flip if color played at idx, or null if illegal. */
export function flipsFor(board, idx, color) {
  if (board[idx] !== "0") return null;
  const r = Math.floor(idx / N), c = idx % N;
  const mine = String(color), opp = String(other(color));
  let flips = [];
  for (const [dr, dc] of DIRS) {
    const line = [];
    let rr = r + dr, cc = c + dc;
    while (inB(rr, cc) && board[rr * N + cc] === opp) { line.push(rr * N + cc); rr += dr; cc += dc; }
    if (line.length && inB(rr, cc) && board[rr * N + cc] === mine) flips = flips.concat(line);
  }
  return flips.length ? flips : null;
}

export function legalMoves(board, color) {
  const out = [];
  for (let i = 0; i < N * N; i++) if (flipsFor(board, i, color)) out.push(i);
  return out;
}

export function applyMove(board, idx, color) {
  const flips = flipsFor(board, idx, color);
  const cells = board.split("");
  cells[idx] = String(color);
  flips.forEach((i) => { cells[i] = String(color); });
  return cells.join("");
}

export function counts(board) {
  let b = 0, w = 0;
  for (const ch of board) { if (ch === "1") b++; else if (ch === "2") w++; }
  return { 1: b, 2: w };
}

/* What the mover's move at idx leaves behind: new board, status, winner and
   who plays next (the opponent, or the same player after a pass). */
export function resolve(board, idx, mover) {
  const next = applyMove(board, idx, mover);
  const opp = other(mover);
  let status = "in_progress", winner = null, nextTurn = opp;
  if (legalMoves(next, opp).length === 0) {
    if (legalMoves(next, mover).length === 0) {
      const c = counts(next);
      status = c[1] === c[2] ? "draw" : "won";
      winner = c[1] === c[2] ? null : (c[1] > c[2] ? 1 : 2);
    } else {
      nextTurn = mover;
    }
  }
  return { board: next, last: idx, status, winner, nextTurn };
}

export function validateTransition(prev, next, mover) {
  const bad = { ok: false, reason: "illegal" };
  if (mover !== 1 && mover !== 2) return bad;
  const before = prev ? prev.board : initialBoard();
  if (typeof before !== "string" || before.length !== N * N) return bad;
  if (typeof next.board !== "string" || !/^[012]{64}$/.test(next.board)) return bad;
  const idx = next.last;
  if (!Number.isInteger(idx) || idx < 0 || idx >= N * N) return bad;
  if (!flipsFor(before, idx, mover)) return bad;

  const want = resolve(before, idx, mover);
  if (next.board !== want.board) return bad;                  // wrong flips
  if (next.status !== want.status || next.winner !== want.winner) return bad;
  return { ok: true, nextTurn: want.nextTurn };
}
