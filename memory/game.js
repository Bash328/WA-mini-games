const EMOJI = ['🍎','🍌','🍇','🍓','🍒','🍑','🥝','🍍','🥥','🍉','🥭','🍋','🥑','🌽','🥕','🍆','🥦','🧄','🧅','🥔','🌶️','🫐','🍊','🍐','🍈','🍏','🫒','🥜','🌰','🍠','🥐','🥖'];
/* 32 distinct hues so every pair gets its own tinted background */
const PAIR_COLORS = [
  '#e74c3c','#e67e22','#f1c40f','#2ecc71','#1abc9c','#3498db','#9b59b6','#e84393',
  '#d35400','#27ae60','#2980b9','#8e44ad','#c0392b','#16a085','#f39c12','#6c5ce7',
  '#00b894','#fd79a8','#0984e3','#e17055','#636e72','#a29bfe','#55efc4','#fab1a0',
  '#74b9ff','#dfe6e9','#ffeaa7','#81ecec','#ff7675','#fdcb6e','#b2bec3','#6ab04c',
];
const store = Gamekit.storage('memory:');
let size, mode = 'whatsapp';

// ---------- Solo mode (unchanged from the original single-player game) ----------
let cards, flipped, matched, moves, startTime, timerId, locked;

function resetSolo() {
  size = +document.getElementById('size').value;
  const n = size*size;
  const pairs = n/2;
  const shuffled = EMOJI.map((e,i)=>({emoji:e,color:PAIR_COLORS[i]})).sort(()=>Math.random()-0.5).slice(0, pairs);
  cards = shuffled.concat(shuffled).sort(()=>Math.random()-0.5).map((e,i)=>({id:i, emoji:e.emoji, color:e.color, flipped:false, matched:false}));
  flipped = []; matched = 0; moves = 0; locked = false;
  document.getElementById('moves').textContent = 0;
  document.getElementById('time').textContent = 0;
  document.getElementById('status').textContent = 'Flip two. Match all pairs.';
  const best = store.getInt('best:' + size, null);
  document.getElementById('best').textContent = best !== null ? best + 's' : '—';
  clearInterval(timerId); timerId = null; startTime = null;
  renderSolo();
}

function startTimer() {
  startTime = Date.now();
  timerId = setInterval(() => {
    document.getElementById('time').textContent = Math.floor((Date.now()-startTime)/1000);
  }, 250);
}

function renderSolo() {
  const el = document.getElementById('board');
  el.style.gridTemplateColumns = `repeat(${size}, 1fr)`;
  el.style.gridTemplateRows = `repeat(${size}, 1fr)`;
  el.replaceChildren();
  cards.forEach(c => {
    const d = document.createElement('div');
    d.className = 'card' + (c.flipped?' flip':'') + (c.matched?' match':'');
    if (c.flipped || c.matched) d.style.background = c.color + '22';
    d.setAttribute('role', 'button');
    d.setAttribute('tabindex', '0');
    d.setAttribute('aria-label', c.matched || c.flipped ? c.emoji : 'Face-down card');
    const face = document.createElement('span');
    face.className = 'face';
    face.textContent = c.emoji;
    d.appendChild(face);
    const handler = () => flip(c);
    d.addEventListener('click', handler);
    d.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(); } });
    el.appendChild(d);
  });
}

function flip(c) {
  if (locked || c.flipped || c.matched) return;
  if (!startTime) startTimer();
  c.flipped = true;
  flipped.push(c);
  renderSolo();
  if (flipped.length === 2) {
    moves++;
    document.getElementById('moves').textContent = moves;
    const [a,b] = flipped;
    if (a.emoji === b.emoji) {
      a.matched = b.matched = true;
      matched += 2;
      flipped = [];
      renderSolo();
      if (matched === cards.length) finish();
    } else {
      locked = true;
      setTimeout(() => {
        a.flipped = b.flipped = false;
        flipped = []; locked = false;
        renderSolo();
      }, 650);
    }
  }
}

function finish() {
  clearInterval(timerId);
  timerId = null;
  const secs = Math.floor((Date.now()-startTime)/1000);
  const prev = store.getInt('best:' + size, null);
  if (prev === null || secs < prev) store.set('best:' + size, secs);
  const newBest = store.getInt('best:' + size, null);
  document.getElementById('best').textContent = newBest !== null ? newBest + 's' : '—';
  document.getElementById('status').textContent = `Done in ${moves} moves, ${secs}s 🎉`;
}

// ---------- 2 players over WhatsApp ----------
// The deck is never sent over the link — only `size` and a `seed`. Both
// players derive the identical shuffled pair layout from those (same
// mulberry32 + shuffle helpers the daily-puzzle games use), the way
// Minesweeper's mine layout is regenerated from a seed instead of listed.
//
// Turn rule: flip two cards. A match keeps your turn (flip again); a miss
// passes to your friend. Since "your turn" can cover several flips, only
// the *end* of a turn (a miss, or clearing the board) produces a link —
// matches in between just re-render locally.
//
// board: { size, seed, own }
//   own    one char per pair (not per cell): "0" unmatched, "1"/"2" the
//          player who matched it. Cell → pair mapping is derived from the
//          seed, so a cell's own symbol isn't reconstructable without it.
// last: array of pair indices matched during the turn that produced this
//       link (possibly empty, if the turn was a miss from the first flip).
const PLAYER_NAMES = { 1: 'Player 1', 2: 'Player 2' };

let waDeck = null;      // { chosen: [emojiIdx...], cellPair: [pairId per cell...], pairs }
let waOwn = [];         // length pairs, 0/1/2
let waSeed = 0;
let waCurrent = 1;
let waPending = [];     // 0-2 cell indices flipped so far this turn, not yet resolved
let waMatchedThisTurn = [];
let waLocked = false;
let waCanMove = false;

function buildDeck(sz, seed) {
  const pairs = (sz * sz) / 2;
  const rng = Gamekit.mulberry32(seed);
  const chosen = Gamekit.shuffle(Array.from({ length: EMOJI.length }, (_, i) => i), rng).slice(0, pairs);
  const cellPair = [];
  for (let pid = 0; pid < pairs; pid++) { cellPair.push(pid); cellPair.push(pid); }
  Gamekit.shuffle(cellPair, rng);
  return { chosen, cellPair, pairs };
}

function renderLink() {
  const el = document.getElementById('board');
  el.style.gridTemplateColumns = `repeat(${size}, 1fr)`;
  el.style.gridTemplateRows = `repeat(${size}, 1fr)`;
  el.replaceChildren();
  const n = size * size;
  const clickable = waCanMove && !waLocked;
  for (let i = 0; i < n; i++) {
    const pid = waDeck.cellPair[i];
    const isMatched = waOwn[pid] !== 0;
    const isPending = waPending.includes(i);
    const faceUp = isMatched || isPending;
    const d = document.createElement('div');
    d.className = 'card' + (isPending && !isMatched ? ' flip' : '') + (isMatched ? ' match' : '');
    if (faceUp) d.style.background = PAIR_COLORS[waDeck.chosen[pid]] + '22';
    d.setAttribute('role', 'button');
    d.setAttribute('tabindex', '0');
    d.setAttribute('aria-label', faceUp ? EMOJI[waDeck.chosen[pid]] : 'Face-down card');
    const face = document.createElement('span');
    face.className = 'face';
    face.textContent = faceUp ? EMOJI[waDeck.chosen[pid]] : '';
    d.appendChild(face);
    if (clickable && !isMatched) {
      const handler = () => flipLink(i);
      d.addEventListener('click', handler);
      d.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(); } });
    }
    el.appendChild(d);
  }
}

function flipLink(i) {
  if (waLocked || !waCanMove) return;
  const pid = waDeck.cellPair[i];
  if (waOwn[pid] !== 0 || waPending.includes(i)) return;
  waPending.push(i);
  renderLink();
  if (waPending.length < 2) return;
  const [a, b] = waPending;
  if (waDeck.cellPair[a] === waDeck.cellPair[b]) {
    waOwn[pid] = waCurrent;
    waMatchedThisTurn.push(pid);
    waPending = [];
    renderLink();
    if (!waOwn.includes(0)) finishTurn();
  } else {
    waLocked = true;
    renderLink();
    setTimeout(() => {
      waPending = [];
      waLocked = false;
      finishTurn();
    }, 650);
  }
}

function finishTurn() {
  let status = 'in_progress', winner = null;
  if (!waOwn.includes(0)) {
    const c1 = waOwn.filter(x => x === 1).length;
    const c2 = waOwn.filter(x => x === 2).length;
    status = c1 === c2 ? 'draw' : 'won';
    winner = c1 === c2 ? null : (c1 > c2 ? 1 : 2);
  }
  link.commit({
    board: { size, seed: waSeed, own: waOwn.join('') },
    status, winner,
    last: waMatchedThisTurn.slice(),
  });
}

const link = AsyncShare.start({
  game: 'memory',
  version: 1,
  title: 'memory',
  players: [1, 2],
  label: (p) => PLAYER_NAMES[p],
  ui: document.getElementById('wa-ui'),
  statusEl: document.getElementById('status'),
  validateBoard: (s) => {
    const b = s.board;
    if (!b || ![4, 6, 8].includes(b.size)) return false;
    const pairs = (b.size * b.size) / 2;
    if (!Number.isInteger(b.seed) || b.seed < 0 || b.seed > 0xFFFFFFFF) return false;
    if (typeof b.own !== 'string' || b.own.length !== pairs || !/^[012]+$/.test(b.own)) return false;
    return Array.isArray(s.last) && s.last.every(x => Number.isInteger(x) && x >= 0 && x < pairs);
  },
  onState: loadLink,
  detail: (s) => {
    const own = s.board.own.split('').map(Number);
    const c1 = own.filter(x => x === 1).length, c2 = own.filter(x => x === 2).length;
    return `Pairs: Player 1 ${c1} · Player 2 ${c2}.`;
  },
});

function loadLink(s, canMove) {
  if (s) {
    size = s.board.size;
    waSeed = s.board.seed;
    waCurrent = s.turn;
    waOwn = s.board.own.split('').map(Number);
  } else {
    size = +document.getElementById('size').value;
    waSeed = Gamekit.randomSeed();
    waCurrent = 1;
    waOwn = new Array((size * size) / 2).fill(0);
  }
  document.getElementById('size').value = String(size);
  document.getElementById('size').disabled = !!s;
  waDeck = buildDeck(size, waSeed);
  waPending = []; waLocked = false; waMatchedThisTurn = [];
  waCanMove = canMove;
  renderLink();
}

function applyMode() {
  const wa = mode === 'whatsapp';
  document.getElementById('stats').hidden = wa;
  document.getElementById('score').hidden = !wa;
  if (wa) { link.show(); return; }
  link.hide();
  resetSolo();
}

document.getElementById('reset').addEventListener('click', () => (mode === 'whatsapp' ? link.newGame() : resetSolo()));
document.getElementById('size').addEventListener('change', () => (mode === 'whatsapp' ? link.newGame() : resetSolo()));
document.getElementById('mode').addEventListener('change', (e) => { mode = e.target.value; applyMode(); });

document.getElementById('mode').value = mode;
applyMode();
