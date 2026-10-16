/* ============================================================
   rules/ultimate-tic-tac-toe.mjs — rules for Ultimate Tic-Tac-Toe.

   Wire board (same as ultimate-tic-tac-toe/game.js), 91 chars:
     0..80   the 81 cells, small board by small board: index = b*9 + c, where b
             is the small board (0-8, row by row) and c the cell inside it.
             '0' empty, '1' X (Player 1), '2' O (Player 2).
     81..89  each small board's result: '0' still open, '1' X won it, '2' O won
             it, '3' full with no winner.
     90      the small board the next player must play in ('0'-'8'), or '9' when
             they may play in any open one.
   Winning three small boards in a line wins the game; if every small board is
   decided and nobody has a line it is a draw. `last` is the index b*9 + c of the
   cell just played. Players are the numbers 1 and 2; X opens.
   ============================================================ */

export const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
export const EMPTY = "0".repeat(81) + "0".repeat(9) + "9";
const other = (p) => (p === 1 ? 2 : 1);

const lineWinner = (get) => {
  for (const [a, b, c] of LINES) {
    const v = get(a);
    if (v === "1" || v === "2") if (v === get(b) && v === get(c)) return v;
  }
  return null;
};

/* The wire result of player placing a mark at index idx (b*9 + c) on board. */
export function resolve(board, idx, player) {
  const b = Math.floor(idx / 9), c = idx % 9;
  const cells = board.slice(0, 81).split("");
  const st = board.slice(81, 90).split("");
  cells[idx] = String(player);
  const w = lineWinner((i) => cells[b * 9 + i]);
  if (w) st[b] = w;
  else if (cells.slice(b * 9, b * 9 + 9).every((v) => v !== "0")) st[b] = "3";
  const bigWin = lineWinner((i) => st[i]);
  const open = st.some((v) => v === "0");
  const status = bigWin ? "won" : open ? "in_progress" : "draw";
  // you send the next player to the small board matching the cell you took,
  // unless that board is already decided: then they may play anywhere open
  const forced = st[c] === "0" ? String(c) : "9";
  return {
    board: cells.join("") + st.join("") + forced,
    last: idx, status,
    winner: bigWin ? Number(bigWin) : null,
    nextTurn: other(player),
  };
}

/* Is idx a legal move for the position `board`? */
export function legal(board, idx) {
  if (!Number.isInteger(idx) || idx < 0 || idx >= 81) return false;
  const b = Math.floor(idx / 9);
  if (board[idx] !== "0") return false;
  if (board[81 + b] !== "0") return false;
  const forced = board[90];
  return forced === "9" || forced === String(b);
}

export function validateTransition(prev, next, mover) {
  const bad = { ok: false, reason: "illegal" };
  if (mover !== 1 && mover !== 2) return bad;
  const before = prev ? prev.board : EMPTY;
  const after = next.board;
  if (typeof before !== "string" || before.length !== 91) return bad;
  if (typeof after !== "string" || after.length !== 91 || !/^[012]{81}[0-3]{9}[0-9]$/.test(after)) return bad;
  if (!legal(before, next.last)) return bad;
  const want = resolve(before, next.last, mover);
  if (after !== want.board) return bad;
  if (next.status !== want.status || next.winner !== want.winner) return bad;
  return { ok: true, nextTurn: want.nextTurn };
}
