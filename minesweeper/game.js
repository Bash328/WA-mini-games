const DIFFS = { easy:[9,9,10], medium:[16,16,40], hard:[20,20,80] };
let W,H,M, cells, mines, revealed, flags, over, won, firstClick;
let timerStart = 0, timerId = null, elapsed = 0;
let mode = 'whatsapp';        // 'whatsapp' | 'solo'
let owner;                    // WhatsApp mode: 0 hidden, 1/2 revealed by that player
let current = 1, lastCell = null, linkCanMove = false, linkBoard = null;

function idx(r,c){ return r*W+c; }
function inb(r,c){ return r>=0&&c>=0&&r<H&&c<W; }
function neigh(r,c){ const a=[]; for(let dr=-1;dr<=1;dr++) for(let dc=-1;dc<=1;dc++) if((dr||dc)&&inb(r+dr,c+dc)) a.push([r+dr,c+dc]); return a; }

function stopTimer() { if (timerId) { clearInterval(timerId); timerId = null; } }
function startTimer() {
  stopTimer();
  timerStart = Date.now();
  elapsed = 0;
  document.getElementById('time').textContent = '0s';
  timerId = setInterval(() => {
    elapsed = Math.floor((Date.now() - timerStart) / 1000);
    document.getElementById('time').textContent = elapsed + 's';
  }, 500);
}

function reset() {
  const d = document.getElementById('diff').value;
  [H,W,M] = DIFFS[d];
  cells = new Int8Array(H*W);
  mines = new Uint8Array(H*W);
  revealed = new Uint8Array(H*W);
  flags = new Uint8Array(H*W);
  owner = new Uint8Array(H*W);
  over = false; won = false; firstClick = true;
  stopTimer();
  elapsed = 0;
  document.getElementById('time').textContent = '0s';
  document.getElementById('status').textContent = 'Click to reveal.';
  render();
  updateHud();
}

// rng is injectable so WhatsApp games can rebuild the same layout from a seed.
function placeMines(safeR, safeC, rng = Math.random) {
  const safe = new Set();
  safe.add(idx(safeR,safeC));
  neigh(safeR,safeC).forEach(([r,c])=>safe.add(idx(r,c)));
  let placed = 0;
  while (placed < M) {
    const i = Math.floor(rng()*H*W);
    if (mines[i] || safe.has(i)) continue;
    mines[i] = 1; placed++;
  }
  for (let r=0;r<H;r++) for (let c=0;c<W;c++) {
    if (mines[idx(r,c)]) { cells[idx(r,c)] = -1; continue; }
    let n=0; neigh(r,c).forEach(([nr,nc])=>{ if (mines[idx(nr,nc)]) n++; });
    cells[idx(r,c)] = n;
  }
}

function reveal(r,c) {
  const i = idx(r,c);
  if (revealed[i] || flags[i]) return;
  revealed[i] = 1;
  if (cells[i] === -1) { over = true; return; }
  if (cells[i] === 0) neigh(r,c).forEach(([nr,nc])=>reveal(nr,nc));
}

function checkWin() {
  let safeLeft = 0;
  for (let i=0;i<H*W;i++) if (!mines[i] && !revealed[i]) safeLeft++;
  if (safeLeft === 0) { won = true; over = true; }
}

// Safe tiles opened by each player (WhatsApp mode).
function scores() {
  let a = 0, b = 0;
  for (let i=0;i<H*W;i++) if (!mines[i]) { if (owner[i] === 1) a++; else if (owner[i] === 2) b++; }
  return [a, b];
}

function updateHud() {
  if (mode === 'whatsapp') {
    const [a, b] = scores();
    document.getElementById('mines').textContent = `${M} mines`;
    document.getElementById('score').innerHTML = `<span class="ms-key1">■</span> P1 ${a} · <span class="ms-key2">■</span> P2 ${b}`;
    return;
  }
  let flagged=0; for (let i=0;i<H*W;i++) if (flags[i]) flagged++;
  document.getElementById('mines').textContent = `${M - flagged} mines left`;
  if (over) document.getElementById('status').textContent = won ? 'You won! 🎉' : 'Boom. 💥';
}

// Largest tile that fits the panel, after the board's own padding, border and gaps.
function cellSize(el) {
  const panel = el.parentElement;
  const ps = getComputedStyle(panel), bs = getComputedStyle(el);
  const avail = Math.min(panel.clientWidth - parseFloat(ps.paddingLeft) - parseFloat(ps.paddingRight), 600);
  const chrome = parseFloat(bs.paddingLeft) + parseFloat(bs.paddingRight) +
    parseFloat(bs.borderLeftWidth) + parseFloat(bs.borderRightWidth) + (parseFloat(bs.columnGap) || 0) * (W - 1);
  return Math.max(8, Math.min(28, Math.floor((avail - chrome) / W)));
}

function render() {
  const el = document.getElementById('board');
  const sz = cellSize(el);
  el.style.gridTemplateColumns = `repeat(${W}, ${sz}px)`;
  el.style.gridTemplateRows = `repeat(${H}, ${sz}px)`;
  el.replaceChildren();
  el.style.fontSize = sz < 16 ? '0.55rem' : sz < 22 ? '0.65rem' : sz < 26 ? '0.75rem' : '0.9rem';
  for (let r=0;r<H;r++) for (let c=0;c<W;c++) {
    const i = idx(r,c);
    const d = document.createElement('div');
    d.className = 'c';
    d.setAttribute('role', 'gridcell');
    d.setAttribute('aria-label', `row ${r+1} col ${c+1}`);
    if (flags[i]) { d.classList.add('flag'); d.textContent = '⚑'; }
    else if (revealed[i]) {
      d.classList.add('open');
      if (mode === 'whatsapp' && owner[i]) d.classList.add('by' + owner[i]);
      if (cells[i] === -1) { d.classList.add('mine'); d.textContent = '✷'; }
      else if (cells[i] > 0) { d.textContent = cells[i]; d.classList.add('n'+cells[i]); }
    } else if (over && mines[i]) { d.classList.add('mine'); d.textContent = '✷'; }
    if (mode === 'whatsapp' && lastCell === i) d.classList.add('last');
    d.dataset.r = r; d.dataset.c = c;
    el.appendChild(d);
  }
}

function click(r,c) {
  if (mode === 'whatsapp') return playLink(r, c);
  if (over) return;
  const i = idx(r,c);
  if (flags[i]) return;
  if (firstClick) { placeMines(r,c); firstClick = false; startTimer(); }
  reveal(r,c);
  checkWin();
  if (over) stopTimer();
  render(); updateHud();
}

function flag(r,c) {
  if (over || mode === 'whatsapp') return;
  const i = idx(r,c);
  if (revealed[i]) return;
  flags[i] ^= 1;
  render(); updateHud();
}

// ---------- 2 players over WhatsApp ----------
// Players alternate revealing one tile. Reveal a mine and you lose at once.
// If every safe tile gets revealed, whoever opened more of them wins (a
// flood-fill counts for the player who triggered it); equal is a draw.
// No flags in this mode.
//
// board: { d, seed, first, own }
//   d      size key in DIFFS
//   seed   uint32 for the mine RNG. Mine positions are rebuilt from seed +
//          first, so they never appear in the link in readable form.
//   first  index of the opening reveal (row * W + col); its 3×3 area is mine-free
//   own    one char per cell, row by row: "0" hidden, "1"/"2" revealed by that player
// last: index of the most recent reveal.
const PLAYER_NAMES = { 1: 'Player 1', 2: 'Player 2' };

const link = AsyncShare.start({
  game: 'minesweeper',
  version: 1,
  title: 'minesweeper',
  players: [1, 2],
  label: p => PLAYER_NAMES[p],
  ui: document.getElementById('wa-ui'),
  statusEl: document.getElementById('status'),
  validateBoard: s => {
    const b = s.board;
    if (!b || !Object.prototype.hasOwnProperty.call(DIFFS, b.d)) return false;
    const n = DIFFS[b.d][0] * DIFFS[b.d][1];
    return Number.isInteger(b.seed) && b.seed >= 0 && b.seed <= 0xFFFFFFFF &&
      Number.isInteger(b.first) && b.first >= 0 && b.first < n &&
      typeof b.own === 'string' && b.own.length === n && /^[012]+$/.test(b.own) &&
      b.own[b.first] !== '0' &&
      Number.isInteger(s.last) && s.last >= 0 && s.last < n && b.own[s.last] !== '0';
  },
  onState: loadLink,
  detail: s => {
    const [a, b] = scores();
    const boom = cells[s.last] === -1 ? `${PLAYER_NAMES[owner[s.last]]} hit a mine. ` : '';
    return `${boom}Tiles: Player 1 ${a} · Player 2 ${b}.`;
  },
});

function loadLink(state, canMove) {
  const diffSel = document.getElementById('diff');
  if (state) diffSel.value = state.board.d;
  reset();                          // sizes the board from the dropdown
  diffSel.disabled = !!state;       // size is fixed once the game has started
  current = state ? state.turn : 1;
  lastCell = state ? state.last : null;
  linkCanMove = canMove;
  linkBoard = state ? state.board : null;
  if (state) {
    const b = state.board;
    placeMines(Math.floor(b.first / W), b.first % W, Gamekit.mulberry32(b.seed));
    firstClick = false;
    for (let i=0;i<H*W;i++) { owner[i] = +b.own[i]; revealed[i] = owner[i] ? 1 : 0; }
    over = state.status !== 'in_progress';
  }
  render(); updateHud();
}

function playLink(r, c) {
  const i = idx(r,c);
  if (!linkCanMove || revealed[i]) return;
  let seed, first;
  if (firstClick) {
    seed = Gamekit.randomSeed();
    first = i;
    placeMines(r, c, Gamekit.mulberry32(seed));
    firstClick = false;
  } else {
    seed = linkBoard.seed;
    first = linkBoard.first;
  }
  const before = revealed.slice();
  reveal(r, c);
  for (let k=0;k<H*W;k++) if (revealed[k] && !before[k]) owner[k] = current;
  checkWin();
  let status = 'in_progress', winner = null;
  if (cells[i] === -1) {
    status = 'won';
    winner = current === 1 ? 2 : 1;
  } else if (won) {
    const [a, b] = scores();
    status = a === b ? 'draw' : 'won';
    winner = a === b ? null : (a > b ? 1 : 2);
  }
  link.commit({
    board: { d: document.getElementById('diff').value, seed, first, own: Array.from(owner).join('') },
    status, winner, last: i,
  });
}

const modeSel = document.getElementById('mode');

function applyMode() {
  const wa = mode === 'whatsapp';
  document.getElementById('time').hidden = wa;
  document.getElementById('score').hidden = !wa;
  if (wa) { link.show(); return; }
  link.hide();
  document.getElementById('diff').disabled = false;
  reset();
}

// Delegated events on the board — single set of listeners, no leaks.
const boardEl = document.getElementById('board');
let pressTimer = null, longPressed = false;
function cellAt(target) {
  const d = target.closest('.c');
  if (!d || !d.dataset) return null;
  return { r: +d.dataset.r, c: +d.dataset.c };
}
boardEl.addEventListener('click', e => {
  if (longPressed) { longPressed = false; return; }
  const p = cellAt(e.target); if (p) click(p.r, p.c);
});
boardEl.addEventListener('contextmenu', e => {
  e.preventDefault();
  const p = cellAt(e.target); if (p) flag(p.r, p.c);
});
boardEl.addEventListener('touchstart', e => {
  const p = cellAt(e.target); if (!p) return;
  longPressed = false;
  clearTimeout(pressTimer);
  pressTimer = setTimeout(() => { longPressed = true; flag(p.r, p.c); pressTimer = null; }, 400);
}, { passive: true });
const cancelPress = () => { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } };
boardEl.addEventListener('touchend', cancelPress);
boardEl.addEventListener('touchcancel', cancelPress);
boardEl.addEventListener('touchmove', cancelPress, { passive: true });

document.getElementById('reset').addEventListener('click', () => (mode === 'whatsapp' ? link.newGame() : reset()));
document.getElementById('diff').addEventListener('change', () => (mode === 'whatsapp' ? link.newGame() : reset()));
window.addEventListener('resize', () => { if (!over) render(); });
modeSel.addEventListener('change', () => { mode = modeSel.value; applyMode(); });
modeSel.value = mode;
applyMode();
