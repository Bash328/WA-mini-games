// Minimal chess engine + minimax AI.
// Board: 8x8 array. Pieces: {type:'p|n|b|r|q|k', color:'w|b'} or null.
// Supports: basic moves, captures, castling, en passant, pawn auto-promote to queen.

const FILES = ['a','b','c','d','e','f','g','h'];
/* Use filled glyphs for both sides — styled via CSS for a chess.com-like look */
const GLYPH = { w:{k:'♚',q:'♛',r:'♜',b:'♝',n:'♞',p:'♟'}, b:{k:'♚',q:'♛',r:'♜',b:'♝',n:'♞',p:'♟'} };
const VAL = { p:100, n:320, b:330, r:500, q:900, k:20000 };

// Piece-square tables (from white's perspective; flipped for black).
const PST = {
  p: [0,0,0,0,0,0,0,0, 50,50,50,50,50,50,50,50, 10,10,20,30,30,20,10,10,
      5,5,10,25,25,10,5,5, 0,0,0,20,20,0,0,0, 5,-5,-10,0,0,-10,-5,5,
      5,10,10,-20,-20,10,10,5, 0,0,0,0,0,0,0,0],
  n: [-50,-40,-30,-30,-30,-30,-40,-50, -40,-20,0,0,0,0,-20,-40,
      -30,0,10,15,15,10,0,-30, -30,5,15,20,20,15,5,-30,
      -30,0,15,20,20,15,0,-30, -30,5,10,15,15,10,5,-30,
      -40,-20,0,5,5,0,-20,-40, -50,-40,-30,-30,-30,-30,-40,-50],
  b: [-20,-10,-10,-10,-10,-10,-10,-20, -10,0,0,0,0,0,0,-10,
      -10,0,5,10,10,5,0,-10, -10,5,5,10,10,5,5,-10,
      -10,0,10,10,10,10,0,-10, -10,10,10,10,10,10,10,-10,
      -10,5,0,0,0,0,5,-10, -20,-10,-10,-10,-10,-10,-10,-20],
  r: [0,0,0,0,0,0,0,0, 5,10,10,10,10,10,10,5, -5,0,0,0,0,0,0,-5,
      -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5,
      -5,0,0,0,0,0,0,-5, 0,0,0,5,5,0,0,0],
  q: [-20,-10,-10,-5,-5,-10,-10,-20, -10,0,0,0,0,0,0,-10,
      -10,0,5,5,5,5,0,-10, -5,0,5,5,5,5,0,-5,
      0,0,5,5,5,5,0,-5, -10,5,5,5,5,5,0,-10,
      -10,0,5,0,0,0,0,-10, -20,-10,-10,-5,-5,-10,-10,-20],
  k: [-30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30,
      -30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30,
      -20,-30,-30,-40,-40,-30,-30,-20, -10,-20,-20,-20,-20,-20,-20,-10,
      20,20,0,0,0,0,20,20, 20,30,10,0,0,10,30,20],
};

function newBoard() {
  const b = Array.from({length:8},()=>Array(8).fill(null));
  const back = ['r','n','b','q','k','b','n','r'];
  for (let c=0;c<8;c++) {
    b[0][c] = { type: back[c], color: 'b' };
    b[1][c] = { type: 'p', color: 'b' };
    b[6][c] = { type: 'p', color: 'w' };
    b[7][c] = { type: back[c], color: 'w' };
  }
  return b;
}

function cloneState(s) {
  return {
    board: s.board.map(r => r.map(p => p ? {...p} : null)),
    turn: s.turn,
    castling: {...s.castling},
    ep: s.ep ? {...s.ep} : null,
    halfmove: s.halfmove || 0,
    positions: s.positions ? s.positions.slice() : [],
    history: s.history.slice(),
  };
}

function initialState() {
  return {
    board: newBoard(),
    turn: 'w',
    castling: { wK:true, wQ:true, bK:true, bQ:true },
    ep: null,
    halfmove: 0,       // 50-move rule (half-moves since last capture/pawn)
    positions: [],     // stack of position keys for threefold
    history: [],
  };
}

function positionKey(s) {
  let k = '';
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const p = s.board[r][c];
    k += p ? (p.color + p.type) : '.';
  }
  k += '|' + s.turn + '|' +
    (s.castling.wK?'K':'') + (s.castling.wQ?'Q':'') +
    (s.castling.bK?'k':'') + (s.castling.bQ?'q':'') + '|' +
    (s.ep ? (s.ep.r + ',' + s.ep.c) : '-');
  return k;
}

const inb = (r,c) => r>=0&&c>=0&&r<8&&c<8;
const opp = c => c === 'w' ? 'b' : 'w';

function pieceMoves(s, r, c, attacksOnly=false) {
  const p = s.board[r][c];
  if (!p) return [];
  const moves = [];
  const add = (r2,c2,extra={}) => moves.push({from:[r,c], to:[r2,c2], ...extra});
  const dir = p.color === 'w' ? -1 : 1;
  const startRow = p.color === 'w' ? 6 : 1;
  const promoRow = p.color === 'w' ? 0 : 7;

  if (p.type === 'p') {
    if (!attacksOnly) {
      if (inb(r+dir,c) && !s.board[r+dir][c]) {
        add(r+dir, c, { promotion: r+dir===promoRow ? 'q' : null });
        if (r === startRow && !s.board[r+2*dir][c]) add(r+2*dir, c, { double: true });
      }
    }
    for (const dc of [-1,1]) {
      const nr = r+dir, nc = c+dc;
      if (!inb(nr,nc)) continue;
      const tgt = s.board[nr][nc];
      if (tgt && tgt.color !== p.color) add(nr, nc, { promotion: nr===promoRow ? 'q' : null });
      else if (attacksOnly) add(nr, nc);
      else if (s.ep && s.ep.r === nr && s.ep.c === nc) add(nr, nc, { enpassant: true });
    }
    return moves;
  }
  const slides = {
    n: [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]],
    b: [[-1,-1],[-1,1],[1,-1],[1,1]],
    r: [[-1,0],[1,0],[0,-1],[0,1]],
    q: [[-1,-1],[-1,1],[1,-1],[1,1],[-1,0],[1,0],[0,-1],[0,1]],
    k: [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]],
  };
  const sliding = p.type === 'b' || p.type === 'r' || p.type === 'q';
  for (const [dr,dc] of slides[p.type]) {
    let nr=r+dr, nc=c+dc;
    while (inb(nr,nc)) {
      const tgt = s.board[nr][nc];
      if (!tgt) add(nr,nc);
      else {
        if (tgt.color !== p.color) add(nr,nc);
        break;
      }
      if (!sliding) break;
      nr += dr; nc += dc;
    }
  }
  // Castling
  if (p.type === 'k' && !attacksOnly) {
    const row = p.color === 'w' ? 7 : 0;
    if (r === row && c === 4 && !inCheck(s, p.color)) {
      const rights = s.castling;
      if ((p.color === 'w' ? rights.wK : rights.bK) && !s.board[row][5] && !s.board[row][6]
          && s.board[row][7] && s.board[row][7].type === 'r') {
        if (!squareAttacked(s, row, 5, opp(p.color)) && !squareAttacked(s, row, 6, opp(p.color))) {
          add(row, 6, { castle: 'K' });
        }
      }
      if ((p.color === 'w' ? rights.wQ : rights.bQ) && !s.board[row][1] && !s.board[row][2] && !s.board[row][3]
          && s.board[row][0] && s.board[row][0].type === 'r') {
        if (!squareAttacked(s, row, 3, opp(p.color)) && !squareAttacked(s, row, 2, opp(p.color))) {
          add(row, 2, { castle: 'Q' });
        }
      }
    }
  }
  return moves;
}

function squareAttacked(s, r, c, by) {
  for (let i=0;i<8;i++) for (let j=0;j<8;j++) {
    const p = s.board[i][j];
    if (!p || p.color !== by) continue;
    const ms = pieceMoves(s, i, j, true);
    for (const m of ms) if (m.to[0]===r && m.to[1]===c) return true;
  }
  return false;
}

function findKing(s, color) {
  for (let r=0;r<8;r++) for (let c=0;c<8;c++) {
    const p = s.board[r][c];
    if (p && p.type==='k' && p.color===color) return [r,c];
  }
  return null;
}

function inCheck(s, color) {
  const k = findKing(s, color); if (!k) return false;
  return squareAttacked(s, k[0], k[1], opp(color));
}

function makeMove(s, m) {
  const p = s.board[m.from[0]][m.from[1]];
  const captured = s.board[m.to[0]][m.to[1]];
  const prev = {
    from: m.from, to: m.to, piece: {...p},
    captured: captured ? {...captured} : null,
    castling: {...s.castling}, ep: s.ep ? {...s.ep} : null,
    promotion: m.promotion || null, enpassant: !!m.enpassant, castle: m.castle || null,
    epCaptured: null, rookMove: null,
    halfmove: s.halfmove,
  };
  s.board[m.to[0]][m.to[1]] = p;
  s.board[m.from[0]][m.from[1]] = null;
  if (m.enpassant) {
    const epRow = p.color === 'w' ? m.to[0]+1 : m.to[0]-1;
    prev.epCaptured = { r: epRow, c: m.to[1], piece: {...s.board[epRow][m.to[1]]} };
    s.board[epRow][m.to[1]] = null;
  }
  if (m.promotion) s.board[m.to[0]][m.to[1]] = { type: m.promotion, color: p.color };
  if (m.castle) {
    const row = m.to[0];
    if (m.castle === 'K') {
      prev.rookMove = { from:[row,7], to:[row,5] };
      s.board[row][5] = s.board[row][7]; s.board[row][7] = null;
    } else {
      prev.rookMove = { from:[row,0], to:[row,3] };
      s.board[row][3] = s.board[row][0]; s.board[row][0] = null;
    }
  }
  // Update castling rights
  if (p.type === 'k') {
    if (p.color==='w') { s.castling.wK=false; s.castling.wQ=false; }
    else { s.castling.bK=false; s.castling.bQ=false; }
  }
  if (p.type === 'r') {
    if (p.color==='w' && m.from[0]===7 && m.from[1]===0) s.castling.wQ=false;
    if (p.color==='w' && m.from[0]===7 && m.from[1]===7) s.castling.wK=false;
    if (p.color==='b' && m.from[0]===0 && m.from[1]===0) s.castling.bQ=false;
    if (p.color==='b' && m.from[0]===0 && m.from[1]===7) s.castling.bK=false;
  }
  if (captured && captured.type === 'r') {
    if (m.to[0]===7 && m.to[1]===0) s.castling.wQ=false;
    if (m.to[0]===7 && m.to[1]===7) s.castling.wK=false;
    if (m.to[0]===0 && m.to[1]===0) s.castling.bQ=false;
    if (m.to[0]===0 && m.to[1]===7) s.castling.bK=false;
  }
  // EP target
  s.ep = null;
  if (m.double) {
    s.ep = { r: (m.from[0]+m.to[0])>>1, c: m.from[1] };
  }
  if (p.type === 'p' || captured || m.enpassant) s.halfmove = 0;
  else s.halfmove++;
  s.turn = opp(s.turn);
  s.history.push(prev);
  s.positions.push(positionKey(s));
  return prev;
}

function undoMove(s) {
  const h = s.history.pop(); if (!h) return;
  s.positions.pop();
  s.turn = opp(s.turn);
  s.castling = {...h.castling};
  s.ep = h.ep ? {...h.ep} : null;
  s.halfmove = h.halfmove || 0;
  s.board[h.from[0]][h.from[1]] = h.piece;
  s.board[h.to[0]][h.to[1]] = h.captured;
  if (h.enpassant && h.epCaptured) {
    s.board[h.epCaptured.r][h.epCaptured.c] = h.epCaptured.piece;
    s.board[h.to[0]][h.to[1]] = null;
  }
  if (h.castle && h.rookMove) {
    const rm = h.rookMove;
    s.board[rm.from[0]][rm.from[1]] = s.board[rm.to[0]][rm.to[1]];
    s.board[rm.to[0]][rm.to[1]] = null;
  }
}

function allLegal(s, color) {
  const out = [];
  for (let r=0;r<8;r++) for (let c=0;c<8;c++) {
    const p = s.board[r][c];
    if (!p || p.color !== color) continue;
    for (const m of pieceMoves(s, r, c)) {
      makeMove(s, m);
      if (!inCheck(s, color)) out.push(m);
      undoMove(s);
    }
  }
  return out;
}

function evaluate(s) {
  let score = 0;
  for (let r=0;r<8;r++) for (let c=0;c<8;c++) {
    const p = s.board[r][c];
    if (!p) continue;
    const sq = p.color === 'w' ? (r*8+c) : ((7-r)*8+c);
    const pst = PST[p.type][sq];
    const v = VAL[p.type] + pst;
    score += p.color === 'w' ? v : -v;
  }
  return score;
}

function orderMoves(s, moves) {
  return moves.map(m => {
    const cap = s.board[m.to[0]][m.to[1]];
    const score = (cap ? 10*VAL[cap.type] - VAL[s.board[m.from[0]][m.from[1]].type] : 0) + (m.promotion ? 800 : 0);
    return { m, score };
  }).sort((a,b) => b.score - a.score).map(x => x.m);
}

function search(s, depth, alpha, beta) {
  if (depth === 0) return evaluate(s);
  const color = s.turn;
  const moves = orderMoves(s, allLegal(s, color));
  if (moves.length === 0) {
    if (inCheck(s, color)) return color === 'w' ? -99999 + (100-depth) : 99999 - (100-depth);
    return 0;
  }
  if (color === 'w') {
    let best = -Infinity;
    for (const m of moves) {
      makeMove(s, m);
      const val = search(s, depth-1, alpha, beta);
      undoMove(s);
      if (val > best) best = val;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return best;
  } else {
    let best = Infinity;
    for (const m of moves) {
      makeMove(s, m);
      const val = search(s, depth-1, alpha, beta);
      undoMove(s);
      if (val < best) best = val;
      if (best < beta) beta = best;
      if (alpha >= beta) break;
    }
    return best;
  }
}

function bestMove(s, depth) {
  const color = s.turn;
  const moves = orderMoves(s, allLegal(s, color));
  if (moves.length === 0) return null;
  let best = null;
  let bestScore = color === 'w' ? -Infinity : Infinity;
  for (const m of moves) {
    makeMove(s, m);
    const val = search(s, depth-1, -Infinity, Infinity);
    undoMove(s);
    if (color === 'w' ? val > bestScore : val < bestScore) {
      bestScore = val; best = m;
    }
  }
  return best;
}

function insufficientMaterial(s) {
  const pieces = { w: [], b: [] };
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const p = s.board[r][c];
    if (!p) continue;
    if (p.type === 'p' || p.type === 'r' || p.type === 'q') return false;
    pieces[p.color].push({ t: p.type, sq: (r + c) % 2 });
  }
  const w = pieces.w.filter(p => p.t !== 'k');
  const b = pieces.b.filter(p => p.t !== 'k');
  // K v K
  if (w.length === 0 && b.length === 0) return true;
  // K+minor v K
  if (w.length === 1 && b.length === 0 && (w[0].t === 'n' || w[0].t === 'b')) return true;
  if (b.length === 1 && w.length === 0 && (b[0].t === 'n' || b[0].t === 'b')) return true;
  // K+B v K+B with same-color bishops
  if (w.length === 1 && b.length === 1 && w[0].t === 'b' && b[0].t === 'b' && w[0].sq === b[0].sq) return true;
  return false;
}

function threefold(s) {
  const key = s.positions[s.positions.length - 1];
  if (!key) return false;
  let c = 0;
  for (const k of s.positions) if (k === key) c++;
  return c >= 3;
}

// Terminal outcome (checkmate / stalemate / 50-move / insufficient material) as of
// `s.turn` being the side to move. Does NOT check threefold repetition — the
// WhatsApp mode doesn't carry position history across links, so that rule is
// not enforced there (documented limitation; the solo/AI mode below still
// checks it via checkEnd(), since it keeps a continuous position stack).
function outcome(s) {
  const legal = allLegal(s, s.turn);
  if (legal.length === 0) {
    if (inCheck(s, s.turn)) return { status: 'won', winner: opp(s.turn), reason: 'Checkmate.' };
    return { status: 'draw', winner: null, reason: 'Stalemate.' };
  }
  if (s.halfmove >= 100) return { status: 'draw', winner: null, reason: 'Draw — 50-move rule. ' + Gamekit.taunt('draw') };
  if (insufficientMaterial(s)) return { status: 'draw', winner: null, reason: 'Draw — insufficient material.' };
  return { status: 'in_progress', winner: null, reason: null };
}

// ---------- Link (de)serialization ----------
// board.b: 64 chars, row-major (a8..h8, a7..h7, ... a1..h1 to match the
// internal [row][col] array where row 0 is black's back rank). '.' empty,
// else a piece letter — uppercase White, lowercase Black (p n b r q k).
// board.castle: subset of "KQkq" in that order, or "-".
// board.ep: en-passant target square as row*8+col, or null.
// board.half: half-move clock (50-move rule).
function boardToStr(b) {
  let s = '';
  for (let r=0;r<8;r++) for (let c=0;c<8;c++) {
    const p = b[r][c];
    s += !p ? '.' : (p.color === 'w' ? p.type.toUpperCase() : p.type);
  }
  return s;
}
function strToBoard(str) {
  const b = Array.from({length:8},()=>Array(8).fill(null));
  for (let i=0;i<64;i++) {
    const ch = str[i];
    if (ch === '.') continue;
    b[i>>3][i&7] = { type: ch.toLowerCase(), color: ch === ch.toUpperCase() ? 'w' : 'b' };
  }
  return b;
}
function castleToStr(c) {
  return ((c.wK?'K':'') + (c.wQ?'Q':'') + (c.bK?'k':'') + (c.bQ?'q':'')) || '-';
}
function strToCastle(s) {
  return { wK: s.includes('K'), wQ: s.includes('Q'), bK: s.includes('k'), bQ: s.includes('q') };
}
function stateFromLinkBoard(b, turn) {
  return {
    board: strToBoard(b.b),
    turn,
    castling: strToCastle(b.castle),
    ep: b.ep === null ? null : { r: b.ep >> 3, c: b.ep & 7 },
    halfmove: b.half,
    positions: [],
    history: [],
  };
}

// ---------- Puzzles ----------
// A position from a FEN string (the puzzles are stored that way).
function stateFromFEN(fen) {
  const [placement, turn, castle, ep, half] = fen.split(' ');
  const board = Array.from({length:8},()=>Array(8).fill(null));
  placement.split('/').forEach((row, r) => {
    let c = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) c += Number(ch);
      else { board[r][c++] = { type: ch.toLowerCase(), color: ch === ch.toUpperCase() ? 'w' : 'b' }; }
    }
  });
  return {
    board, turn: turn === 'b' ? 'b' : 'w',
    castling: strToCastle(castle || '-'),
    ep: ep && ep !== '-' ? { r: 8 - Number(ep[1]), c: ep.charCodeAt(0) - 97 } : null,
    halfmove: Number(half) || 0, positions: [], history: [],
  };
}
// The legal move that a UCI string ("e2e4", "e7e8q") names, or null. Promotions are always to a queen here.
function uciToMove(s, uci) {
  const f = [8 - Number(uci[1]), uci.charCodeAt(0) - 97], t = [8 - Number(uci[3]), uci.charCodeAt(2) - 97];
  return allLegal(s, s.turn).find(m => m.from[0] === f[0] && m.from[1] === f[1] && m.to[0] === t[0] && m.to[1] === t[1]) || null;
}

// ---------- UI ----------
let state = initialState();
let humanColor = 'w';
let flipped = false;
let selected = null;
let legalFromSel = [];
let lastMove = null;
let thinking = false;
let mode = 'whatsapp';      // 'whatsapp' | 'ai'
let linkCanMove = false;    // WhatsApp mode: is it this viewer's move?
let lastReason = null;      // WhatsApp mode: why a finished game ended

// "You've got this in the bag" / "spoke too soon" - see checkers for the
// same pattern. Reuses the AI's own evaluate() (centipawns, White-
// positive) as the lead signal. 250 rather than a cleaner-looking 300:
// removing a full knight (worth 320) only moves the score by 280 once
// its own positional adjustment is accounted for, measured directly -
// 300 would miss exactly the "up a minor piece" case it's meant to catch.
let confidenceGivenTo = null;
let confidenceNote = '';
let pressureGiven = false; // the AI's-lead mirror of confidence: one lastChance line per game
const CONFIDENCE_THRESHOLD = 250;
function checkConfidence() {
  if (confidenceGivenTo !== null || mode !== 'ai') return;
  const score = evaluate(state);
  if (Math.abs(score) < CONFIDENCE_THRESHOLD) return;
  const leaderColor = score > 0 ? 'w' : 'b';
  if (leaderColor !== humanColor) { // the AI is winning: warn the human, once
    if (!pressureGiven) { pressureGiven = true; confidenceNote = Gamekit.taunt('lastChance'); }
    return;
  }
  confidenceGivenTo = leaderColor;
  confidenceNote = Gamekit.taunt('confidence');
}

const modeSel = document.getElementById('mode');
const undoBtn = document.getElementById('undo');
const sideSel = document.getElementById('side');
const levelSel = document.getElementById('level');
const flipBtn = document.getElementById('flip');

function renderBoard() {
  const el = document.getElementById('board');
  el.innerHTML = '';
  const rowsOrder = flipped ? [7,6,5,4,3,2,1,0] : [0,1,2,3,4,5,6,7];
  const colsOrder = flipped ? [7,6,5,4,3,2,1,0] : [0,1,2,3,4,5,6,7];
  for (const r of rowsOrder) for (const c of colsOrder) {
    const d = document.createElement('div');
    d.className = 'sq ' + ((r+c)%2===0 ? 'light':'dark');
    const p = state.board[r][c];
    if (p) {
      d.textContent = GLYPH[p.color][p.type];
      d.classList.add(p.color);
    }
    if (selected && selected[0]===r && selected[1]===c) d.classList.add('sel');
    if (lastMove && ((lastMove.from[0]===r && lastMove.from[1]===c) || (lastMove.to[0]===r && lastMove.to[1]===c))) d.classList.add('last');
    if (legalFromSel.some(m => m.to[0]===r && m.to[1]===c)) {
      d.classList.add(state.board[r][c] ? 'cap' : 'hint');
    }
    d.addEventListener('click', () => onSquare(r,c));
    el.appendChild(d);
  }
  // the VS bar counts pieces: you (or White) on the left
  const sc = document.getElementById('score');
  if (sc) {
    const n = { w: 0, b: 0 };
    for (const row of state.board) for (const p of row) if (p) n[p.color]++;
    const me = mode === 'ai' ? humanColor : 'w', ai = mode === 'ai';
    sc.dataset.l = ai ? 'YOU' : 'WHITE'; sc.dataset.r = ai ? 'BOT' : 'BLACK';
    sc.textContent = 'A: ' + n[me] + ' B: ' + n[me === 'w' ? 'b' : 'w'];
  }
  const inChk = inCheck(state, state.turn);
  document.getElementById('info').textContent = inChk ? 'Check!' : '';
  if (mode === 'ai') {
    const note = (!thinking && state.turn === humanColor && confidenceNote) ? ' ' + confidenceNote : '';
    if (note) confidenceNote = '';
    document.getElementById('status').textContent =
      (thinking ? 'Computer thinking…' : (state.turn === humanColor ? 'Your move.' : 'Computer to move.')) + (inChk ? ' — check!' : '') + note;
    const aiToMove = thinking || state.turn !== humanColor;
    Gamekit.turn(state.turn === 'w' ? 1 : 2,
      aiToMove ? 'Computer thinking…' : "Your move · you're " + (humanColor === 'w' ? 'White' : 'Black') + (inChk ? ' — check!' : ''),
      aiToMove);
  }
}

function onSquare(r,c) {
  if (mode === 'whatsapp') return playLink(r,c);
  if (mode === 'puzzle') return puzzleSquare(r,c);
  if (thinking || state.turn !== humanColor) return;
  const p = state.board[r][c];
  if (selected) {
    const mv = legalFromSel.find(m => m.to[0]===r && m.to[1]===c);
    if (mv) {
      makeMove(state, mv);
      lastMove = mv;
      selected = null; legalFromSel = [];
      checkConfidence();
      renderBoard();
      checkEnd();
      if (!thinking) setTimeout(aiTurn, 150);
      return;
    }
    if (p && p.color === humanColor) {
      selected = [r,c];
      legalFromSel = allLegal(state, humanColor).filter(m => m.from[0]===r && m.from[1]===c);
      renderBoard();
      return;
    }
    selected = null; legalFromSel = [];
    renderBoard();
    return;
  }
  if (p && p.color === humanColor) {
    selected = [r,c];
    legalFromSel = allLegal(state, humanColor).filter(m => m.from[0]===r && m.from[1]===c);
    renderBoard();
  }
}

let aiTimer = null;
function cancelAI() { if (aiTimer !== null) { clearTimeout(aiTimer); aiTimer = null; } thinking = false; }

function aiTurn() {
  if (state.turn === humanColor) return;
  if (checkEnd()) return;
  thinking = true;
  renderBoard();
  aiTimer = setTimeout(() => {
    aiTimer = null;
    if (state.turn === humanColor) { thinking = false; renderBoard(); return; }
    const depth = +document.getElementById('level').value;
    const m = bestMove(state, depth);
    if (m) { makeMove(state, m); lastMove = m; }
    checkConfidence();
    thinking = false;
    renderBoard();
    checkEnd();
  }, 20);
}

function checkEnd() {
  const moves = allLegal(state, state.turn);
  if (moves.length === 0) {
    const humanLost = mode === 'ai' && state.turn === humanColor;
    const reversed = confidenceGivenTo === state.turn;
    const msg = inCheck(state, state.turn)
      ? `Checkmate — ${state.turn === 'w' ? 'Black' : 'White'} wins.` + (mode === 'ai' ? ' ' + Gamekit.taunt(humanLost ? (reversed ? 'reversal' : 'loss') : 'win') : '')
      : 'Stalemate — draw. ' + Gamekit.taunt('draw');
    document.getElementById('status').textContent = msg;
    Gamekit.turn(null); thinking = true; // freeze interaction
    return true;
  }
  if (state.halfmove >= 100) {
    document.getElementById('status').textContent = 'Draw — 50-move rule. ' + Gamekit.taunt('draw');
    Gamekit.turn(null); thinking = true; return true;
  }
  if (threefold(state)) {
    document.getElementById('status').textContent = 'Draw — threefold repetition. ' + Gamekit.taunt('draw');
    Gamekit.turn(null); thinking = true; return true;
  }
  if (insufficientMaterial(state)) {
    document.getElementById('status').textContent = 'Draw — insufficient material.';
    Gamekit.turn(null); thinking = true; return true;
  }
  return false;
}

function resetSolo() {
  cancelAI();
  state = initialState();
  selected = null; legalFromSel = []; lastMove = null;
  confidenceGivenTo = null; confidenceNote = ''; pressureGiven = false;
  humanColor = sideSel.value;
  flipped = humanColor === 'b';
  renderBoard();
  document.getElementById('status').textContent = humanColor === 'b' ? 'Computer is thinking…' : 'Your move.';
  if (humanColor === 'b') aiTimer = setTimeout(() => { aiTimer = null; aiTurn(); }, 200);
}

// ---------- 2 players over WhatsApp ----------
// Whoever opens the game (no link yet) plays White and moves first. Castling,
// en passant, and auto-queen promotion all work as in solo mode. There's no
// threefold-repetition draw in this mode (no position history travels in the
// link) and no undo — matches this project's play-by-mail model.
const link = AsyncShare.start({
  game: 'chess',
  version: 1,
  title: 'chess',
  players: ['w', 'b'],
  label: (p) => p === 'w' ? 'White' : 'Black',
  ui: document.getElementById('wa-ui'),
  statusEl: document.getElementById('status'),
  validateBoard: (s) => {
    const b = s.board;
    if (!b || typeof b.b !== 'string' || b.b.length !== 64 || !/^[.pnbrqkPNBRQK]{64}$/.test(b.b)) return false;
    if ((b.b.match(/K/g) || []).length !== 1 || (b.b.match(/k/g) || []).length !== 1) return false;
    if (typeof b.castle !== 'string' || !/^(-|[KQkq]{1,4})$/.test(b.castle)) return false;
    if (!(b.ep === null || (Number.isInteger(b.ep) && b.ep >= 0 && b.ep < 64))) return false;
    if (!Number.isInteger(b.half) || b.half < 0 || b.half > 150) return false;
    return Array.isArray(s.last) && s.last.length === 2 &&
      s.last.every(i => Number.isInteger(i) && i >= 0 && i < 64);
  },
  onState: loadLink,
  detail: () => lastReason || '',
});

function loadLink(s, canMove) {
  cancelAI();
  thinking = false;
  if (s) {
    state = stateFromLinkBoard(s.board, s.turn);
    lastMove = { from: [s.last[0] >> 3, s.last[0] & 7], to: [s.last[1] >> 3, s.last[1] & 7] };
    lastReason = s.status !== 'in_progress' ? outcome(state).reason : null;
  } else {
    state = initialState();
    lastMove = null;
    lastReason = null;
  }
  selected = null; legalFromSel = [];
  linkCanMove = canMove;
  renderBoard();
}

function playLink(r, c) {
  if (!linkCanMove) return;
  const p = state.board[r][c];
  if (selected) {
    const mv = legalFromSel.find(m => m.to[0]===r && m.to[1]===c);
    if (mv) {
      makeMove(state, mv);
      lastMove = mv;
      selected = null; legalFromSel = [];
      const o = outcome(state);
      link.commit({
        board: { b: boardToStr(state.board), castle: castleToStr(state.castling), ep: state.ep ? state.ep.r*8+state.ep.c : null, half: state.halfmove },
        status: o.status, winner: o.winner,
        last: [mv.from[0]*8+mv.from[1], mv.to[0]*8+mv.to[1]],
      });
      return;
    }
    if (p && p.color === state.turn) {
      selected = [r,c];
      legalFromSel = allLegal(state, state.turn).filter(m => m.from[0]===r && m.from[1]===c);
      renderBoard();
      return;
    }
    selected = null; legalFromSel = [];
    renderBoard();
    return;
  }
  if (p && p.color === state.turn) {
    selected = [r,c];
    legalFromSel = allLegal(state, state.turn).filter(m => m.from[0]===r && m.from[1]===c);
    renderBoard();
  }
}


// ---------- Puzzles ----------
// Lichess puzzles (chess/puzzles.js): you are shown the position, the opponent's last move is played, and you find the
// solution move by move. Mate puzzles accept ANY move that checkmates, the others only the stored move.
const THEME_NAMES = { mateIn1: 'Mate in 1', mateIn2: 'Mate in 2', mateIn3: 'Mate in 3', fork: 'Fork', pin: 'Pin', skewer: 'Skewer', hangingPiece: 'Hanging piece', discoveredAttack: 'Discovered attack', trappedPiece: 'Trapped piece', deflection: 'Deflection', attraction: 'Attraction' };
const puzStore = Gamekit.storage('chess:');
const puzBtns = ['puz-daily', 'puz-next', 'puz-hint', 'puz-solve'].map((id) => document.getElementById(id));   // the layout moves these into the options row
const puzInfo = document.getElementById('puz-info');
let puz = null;
const uciOf = (m) => String.fromCharCode(97 + m.from[1]) + (8 - m.from[0]) + String.fromCharCode(97 + m.to[1]) + (8 - m.to[0]);
const puzList = () => globalThis.CHESS_PUZZLES || [];
const dailyIndex = () => Gamekit.dailySeed('chess-puzzle', 'daily') % puzList().length;
const solvedIds = () => { try { return JSON.parse(puzStore.get('puz-solved', '[]')); } catch (e) { return []; } };
function puzSay(text) { document.getElementById('status').textContent = text; }
function puzDetail() {
  if (!puz) return;
  const side = humanColor === 'w' ? 'White' : 'Black';
  puzInfo.hidden = false;
  puzInfo.textContent = (puz.daily ? "Today's puzzle · " : '') + THEME_NAMES[puz.theme] + ' · rating ' + puz.rating + ' · ' + side + ' to play · solved ' + solvedIds().length + ' of ' + puzList().length;
}
function startPuzzle(i, daily) {
  cancelAI();
  const list = puzList();
  if (!list.length) { puzSay("The puzzles didn't load. Reload the page."); return; }
  const [id, fen, moves, rating, theme] = list[i];
  state = stateFromFEN(fen);
  puz = { i, id, rating, theme, moves: moves.split(' '), idx: 0, mistakes: 0, hint: 0, over: false, daily: !!daily };
  humanColor = state.turn === 'w' ? 'b' : 'w';            // the opponent moves first; the person solving plays the other side
  flipped = humanColor === 'b';
  selected = null; legalFromSel = []; lastMove = null; thinking = true;
  renderBoard(); puzDetail(); puzSay('Watch the opponent’s move…');
  aiTimer = setTimeout(() => {
    aiTimer = null;
    puzPlayStored();
    thinking = false;
    renderBoard();
    puzSay((puz.theme === 'mateIn1' ? 'Find the checkmate.' : /^mateIn/.test(puz.theme) ? 'Find the forced mate.' : 'Find the best move.') + ' ' + (humanColor === 'w' ? 'White' : 'Black') + ' to play.');
  }, 700);
}
function puzPlayStored() {
  const m = uciToMove(state, puz.moves[puz.idx]);
  if (!m) return false;
  makeMove(state, m); lastMove = m; puz.idx++;
  return true;
}
function puzzleSquare(r, c) {
  if (!puz || puz.over || thinking || state.turn !== humanColor) return;
  const p = state.board[r][c];
  if (selected) {
    const mv = legalFromSel.find(m => m.to[0] === r && m.to[1] === c);
    if (mv) return puzzleMove(mv);
    if (p && p.color === humanColor) { selected = [r, c]; legalFromSel = allLegal(state, humanColor).filter(m => m.from[0] === r && m.from[1] === c); renderBoard(); return; }
    selected = null; legalFromSel = []; renderBoard(); return;
  }
  if (p && p.color === humanColor) { selected = [r, c]; legalFromSel = allLegal(state, humanColor).filter(m => m.from[0] === r && m.from[1] === c); renderBoard(); }
}
function puzzleMove(mv) {
  const expected = puz.moves[puz.idx];
  let ok = uciOf(mv) === expected.slice(0, 4);
  if (!ok && /^mateIn/.test(puz.theme)) {                    // a different checkmate is just as good
    makeMove(state, mv); ok = outcome(state).status === 'won'; undoMove(state);
  }
  selected = null; legalFromSel = [];
  if (!ok) {
    puz.mistakes++;
    puzSay("That's not it. Try again" + (puz.mistakes >= 2 ? ' (the Hint button can help)' : '') + '.');
    renderBoard();
    return;
  }
  makeMove(state, mv); lastMove = mv; puz.idx++; puz.hint = 0;
  if (puz.idx >= puz.moves.length || outcome(state).status === 'won') return puzzleSolved();
  thinking = true; renderBoard(); puzSay('Good. Keep going…');
  aiTimer = setTimeout(() => {
    aiTimer = null;
    puzPlayStored(); thinking = false; renderBoard();
    puzSay('Your move again.');
    if (puz.idx >= puz.moves.length) puzzleSolved();
  }, 550);
}
function puzzleSolved() {
  puz.over = true; thinking = false;
  const ids = solvedIds();
  if (!ids.includes(puz.id)) { ids.push(puz.id); puzStore.set('puz-solved', JSON.stringify(ids)); }
  renderBoard(); puzDetail();
  puzSay('Solved' + (puz.mistakes ? ' (after ' + puz.mistakes + ' wrong ' + (puz.mistakes === 1 ? 'try' : 'tries') + ')' : ' first time') + '! ' + Gamekit.taunt('win'));
}
function puzzleHint() {
  if (!puz || puz.over || thinking || state.turn !== humanColor) return;
  const m = uciToMove(state, puz.moves[puz.idx]);
  if (!m) return;
  puz.hint++;
  selected = m.from; legalFromSel = puz.hint >= 2 ? [m] : [];
  renderBoard();
  puzSay(puz.hint >= 2 ? 'Move that piece here.' : 'Look at the highlighted piece.');
}
function puzzleSolution() {
  if (!puz || puz.over) return;
  puz.over = true; thinking = true; selected = null; legalFromSel = [];
  puzSay('Here is the solution…');
  const step = () => {
    if (puz.idx >= puz.moves.length || !puzPlayStored()) { aiTimer = null; thinking = false; renderBoard(); puzSay('That was the solution. Try another puzzle.'); return; }
    renderBoard();
    aiTimer = setTimeout(step, 900);
  };
  aiTimer = setTimeout(step, 500);
}
document.getElementById('puz-daily').addEventListener('click', () => startPuzzle(dailyIndex(), true));
document.getElementById('puz-next').addEventListener('click', () => {
  const n = puzList().length; let i;
  do { i = Math.floor(Math.random() * n); } while (n > 1 && puz && i === puz.i);
  startPuzzle(i, false);
});
document.getElementById('puz-hint').addEventListener('click', puzzleHint);
document.getElementById('puz-solve').addEventListener('click', puzzleSolution);

function applyMode() {
  const wa = mode === 'whatsapp', pz = mode === 'puzzle';
  levelSel.hidden = wa || pz;
  sideSel.hidden = wa || pz;
  undoBtn.hidden = wa || pz;
  puzBtns.forEach((b) => { b.hidden = !pz; });
  puzInfo.hidden = !pz || !puz;
  document.getElementById('reset').innerHTML = '<span class="glyph">↻</span> ' + (pz ? 'Restart' : 'New game');
  if (wa) {
    cancelAI();
    link.show();
    return;
  }
  link.hide();
  if (pz) { startPuzzle(dailyIndex(), true); return; }
  resetSolo();
}

document.getElementById('reset').addEventListener('click', () => {
  if (mode === 'whatsapp') link.newGame();
  else if (mode === 'puzzle') { if (puz) startPuzzle(puz.i, puz.daily); }
  else resetSolo();
});

undoBtn.addEventListener('click', () => {
  if (mode === 'whatsapp' || state.history.length === 0) return;
  cancelAI();
  undoMove(state);
  if (state.turn !== humanColor && state.history.length > 0) undoMove(state);
  lastMove = null; selected = null; legalFromSel = [];
  renderBoard();
  if (state.turn !== humanColor) {
    // everything was undone and the computer plays first: let it open again
    // instead of leaving the board waiting for a move that never comes
    document.getElementById('status').textContent = 'Computer is thinking…';
    aiTimer = setTimeout(() => { aiTimer = null; aiTurn(); }, 200);
  } else {
    document.getElementById('status').textContent = 'Your move.';
  }
});

flipBtn.addEventListener('click', () => { flipped = !flipped; renderBoard(); });
sideSel.addEventListener('change', () => resetSolo());
modeSel.addEventListener('change', () => { mode = modeSel.value; applyMode(); });

modeSel.value = mode;
applyMode();

// A refresh keeps a game against the computer: the position, your side and the level.
// (Undo history and repetition tracking start fresh. Link games live in the URL.)
const resumer = Gamekit.resume('chess', () => (mode !== 'ai' || state.history.length === 0 || outcome(state).status !== 'in_progress') ? null : {
  b: boardToStr(state.board), castle: castleToStr(state.castling),
  ep: state.ep ? state.ep.r * 8 + state.ep.c : null, half: state.halfmove, turn: state.turn,
  human: humanColor, level: levelSel.value,
}, (s) => {
  if (typeof s.b !== 'string' || !/^[.pnbrqkPNBRQK]{64}$/.test(s.b)) return false;
  if ((s.b.match(/K/g) || []).length !== 1 || (s.b.match(/k/g) || []).length !== 1) return false;
  if (typeof s.castle !== 'string' || !/^(-|[KQkq]{1,4})$/.test(s.castle)) return false;
  if (!(s.ep === null || (Number.isInteger(s.ep) && s.ep >= 0 && s.ep < 64))) return false;
  if (!Number.isInteger(s.half) || s.half < 0 || s.half > 150) return false;
  if ((s.turn !== 'w' && s.turn !== 'b') || (s.human !== 'w' && s.human !== 'b')) return false;
  if (![...levelSel.options].some(o => o.value === s.level)) return false;
  mode = 'ai'; modeSel.value = 'ai';
  sideSel.value = s.human; levelSel.value = s.level;
  applyMode();                                   // computer game, fresh board for that side
  cancelAI();
  state = stateFromLinkBoard({ b: s.b, castle: s.castle, ep: s.ep, half: s.half }, s.turn);
  humanColor = s.human; flipped = humanColor === 'b';
  lastMove = null; selected = null; legalFromSel = [];
  renderBoard();
  if (state.turn !== humanColor) {
    document.getElementById('status').textContent = 'Computer is thinking…';
    aiTimer = setTimeout(() => { aiTimer = null; aiTurn(); }, 200);
  } else {
    document.getElementById('status').textContent = 'Your move.';
  }
  return true;
});
if (!/[?&](s|live)=/.test(location.search)) resumer.restore();
