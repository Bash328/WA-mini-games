const N = 4;
const store = Gamekit.storage('2048:');
let grid, score, over, mergedCells;
let lastSpawn = null, lastMoves = null, animToken = 0;   // what the last move did, so render() can slide the tiles

// four = chance a new tile is a 4 instead of a 2. evil = chance the new tile
// goes in the cell that does the player the most harm instead of a random one.
// "normal" is the original game.
const DIFFS = {
  normal: { four: 0.1, evil: 0 },
  hard:   { four: 0.2, evil: 0.35 },
  brutal: { four: 0.3, evil: 0.85 },
};
let diff = store.get('diff', 'hard');
if (!DIFFS[diff]) diff = 'hard';
const bestKey = () => diff === 'normal' ? 'best' : 'best:' + diff;

function empty() { return Array.from({length: N}, () => Array(N).fill(0)); }

function addTile() {
  const spots = [];
  for (let r=0;r<N;r++) for (let c=0;c<N;c++) if (!grid[r][c]) spots.push([r,c]);
  if (!spots.length) return;
  const d = DIFFS[diff];
  const v = Math.random() < d.four ? 4 : 2;
  const [r,c] = Math.random() < d.evil ? worstSpot(spots, v) : spots[Math.floor(Math.random()*spots.length)];
  grid[r][c] = v;
  lastSpawn = [r, c];
}

// The empty cell where a new tile v hurts most: wedged between very different
// neighbours (blocks merges) and never beside a matching tile (which would
// hand over a free merge). A little noise breaks ties so it isn't scripted.
function worstSpot(spots, v) {
  let best = spots[0], bestScore = -Infinity;
  for (const [r,c] of spots) {
    let score = Math.random() * 0.5;
    for (const [dr,dc] of [[0,1],[1,0],[0,-1],[-1,0]]) {
      const nr = r+dr, nc = c+dc;
      if (nr<0 || nr>=N || nc<0 || nc>=N || !grid[nr][nc]) continue;
      score += Math.abs(Math.log2(grid[nr][nc]) - Math.log2(v));
      if (grid[nr][nc] === v) score -= 10;
    }
    if (score > bestScore) { bestScore = score; best = [r,c]; }
  }
  return best;
}

function render() {
  const el = document.getElementById('board');
  el.innerHTML = '';
  for (let r=0;r<N;r++) for (let c=0;c<N;c++) {
    const v = grid[r][c];
    const d = document.createElement('div');
    d.className = 'tile' + (v ? ' t'+v : '');
    d.textContent = v || '';
    el.appendChild(d);
  }
  if (lastMoves) animateSlide(el, lastMoves, lastSpawn, mergedCells);
  lastMoves = null; lastSpawn = null;
  mergedCells = null;
  document.getElementById('score').textContent = score;
  document.getElementById('best').textContent = store.getInt(bestKey(), 0);
}

const calm = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

// Timing from the reference (Z048Controller prefab values):
//   travel = 0.20s, scaled by Manhattan distance (1 cell = 0.8x, 2 cells = 0.9x);
//   movement uses DOTween's default OutQuad; the merged tile bulges to 1.14x
//   with InOutSine, 0.08s per half (0.16s total); a new tile grows from zero
//   with InOutSine over 0.30s. The prefab's anim speed multiplier is 1.0.
// No audio: the reference plays slide/merge clips, the web page stays silent.
const TRAVEL = 200;                 // _travelTime 0.20s
const TRAVEL_1 = 0.8;               // TravelScaleDistance1
const TRAVEL_2 = 0.9;               // TravelScaleDistance2
const BULGE = 80;                   // _bulgeOnMergeTime 0.08s per half
const MERGE_SCALE = 1.14;           // MergeBulgeScale
const SPAWN = 300;                  // _newPiecePopInTime 0.30s
const MOVE_EASE = 'cubic-bezier(0.25, 0.46, 0.45, 0.94)'; // OutQuad (DOTween default)
const POP_EASE = 'cubic-bezier(0.37, 0, 0.63, 1)';        // InOutSine
function animateSlide(el, moves, spawn, merged) {
  const cells = el.children, token = ++animToken;
  if (calm() || !el.animate || cells.length < N * N) return;
  const br = el.getBoundingClientRect();
  const moving = moves.filter(m => m.from[0] !== m.to[0] || m.from[1] !== m.to[1]);
  if (!moving.length) return;
  // Blocks closest to the movement edge move first, as in OrderBlocksForDirection.
  const dRow = moving[0].to[0] - moving[0].from[0], dCol = moving[0].to[1] - moving[0].from[1];
  if (dCol > 0) moving.sort((a, b) => b.from[1] - a.from[1] || a.from[0] - b.from[0]);
  else if (dCol < 0) moving.sort((a, b) => a.from[1] - b.from[1] || a.from[0] - b.from[0]);
  else if (dRow > 0) moving.sort((a, b) => b.from[0] - a.from[0] || a.from[1] - b.from[1]);
  else if (dRow < 0) moving.sort((a, b) => a.from[0] - b.from[0] || a.from[1] - b.from[1]);
  const dests = new Set(moving.map(m => m.to[0] * N + m.to[1]));
  dests.forEach(i => { cells[i].style.visibility = 'hidden'; });
  const anims = [];
  let maxDuration = TRAVEL;
  const ghosts = moving.map(m => {
    const a = cells[m.from[0] * N + m.from[1]].getBoundingClientRect(), b = cells[m.to[0] * N + m.to[1]].getBoundingClientRect();
    const t = document.createElement('div');
    t.className = 'tile ghost t' + m.v;
    t.textContent = m.v;
    t.style.cssText = 'position:absolute;margin:0;z-index:2;will-change:transform;left:' + (a.left - br.left - el.clientLeft) + 'px;top:' + (a.top - br.top - el.clientTop) + 'px;width:' + a.width + 'px;height:' + a.height + 'px';
    el.append(t);
    const dx = b.left - a.left, dy = b.top - a.top;
    const travel = 'translate(' + dx + 'px,' + dy + 'px)';
    const distance = Math.abs(m.from[0] - m.to[0]) + Math.abs(m.from[1] - m.to[1]);
    const duration = TRAVEL * (distance === 1 ? TRAVEL_1 : distance === 2 ? TRAVEL_2 : 1);
    maxDuration = Math.max(maxDuration, duration);
    anims.push(t.animate([{ transform: 'translate(0,0)' }, { transform: travel }], { duration, easing: MOVE_EASE, fill: 'forwards' }));
    return t;
  });
  if (spawn) cells[spawn[0] * N + spawn[1]].style.visibility = 'hidden';
  let done = false;
  const land = () => {
    if (done || token !== animToken) return;
    done = true;
    ghosts.forEach(t => t.remove());
    dests.forEach(i => {
      cells[i].style.visibility = '';
      if (merged && merged.has(i)) {
        cells[i].animate(
          [{ transform: 'scale(1)' }, { transform: 'scale(' + MERGE_SCALE + ')' }],
          { duration: BULGE, easing: POP_EASE, iterations: 2, direction: 'alternate' }
        );
      }
    });
    if (spawn) {
      const born = cells[spawn[0] * N + spawn[1]];
      born.style.visibility = '';
      born.animate(
        [{ transform: 'scale(0)' }, { transform: 'scale(1)' }],
        { duration: SPAWN, easing: POP_EASE }
      );
    }
  };
  // swap exactly when the longest slide has finished (not on a timer that a busy phone can run late); the timer is only a backstop
  Promise.all(anims.map(a => a.finished.catch(() => {}))).then(() => requestAnimationFrame(land));
  setTimeout(land, maxDuration + 80);
}

// where every tile goes in one row slid towards index 0: dest[i] is the column tile i ends up in (two merging tiles share one)
function slideRowTargets(row) {
  const xs = [];
  row.forEach((v, i) => { if (v) xs.push({ v, i }); });
  const dest = Array(N).fill(-1);
  let o = 0;
  for (let k = 0; k < xs.length; k++) {
    if (k + 1 < xs.length && xs[k].v === xs[k + 1].v) { dest[xs[k].i] = o; dest[xs[k + 1].i] = o; o++; k++; }
    else { dest[xs[k].i] = o; o++; }
  }
  return dest;
}

function slideRow(row) {
  const xs = row.filter(v => v);
  const out = [];
  const merged = [];
  let gained = 0;
  for (let i=0;i<xs.length;i++) {
    if (i+1<xs.length && xs[i]===xs[i+1]) { out.push(xs[i]*2); merged.push(out.length-1); gained += xs[i]*2; i++; }
    else out.push(xs[i]);
  }
  while (out.length < N) out.push(0);
  return { row: out, gained, merged };
}

function move(dir) {
  if (over) return;
  let moved = false, gained = 0;
  const g = grid.map(r => r.slice());
  const rotate = {left:0, up:1, right:2, down:3}[dir];
  let working = g;
  for (let k=0;k<rotate;k++) working = rot(working);
  const mc = new Set();
  const moves = [];                    // in the rotated frame first; turned back below
  for (let r=0;r<N;r++) {
    const dest = slideRowTargets(working[r]);
    for (let i=0;i<N;i++) if (working[r][i]) moves.push({ from: [r, i], to: [r, dest[i]], v: working[r][i] });
    const { row, gained: gg, merged: mr } = slideRow(working[r]);
    if (row.some((v,i) => v !== working[r][i])) moved = true;
    working[r] = row;
    gained += gg;
    mr.forEach(c => mc.add(r*N+c));
  }
  // Reverse-rotate merged positions
  mergedCells = new Set();
  mc.forEach(idx => {
    let r = Math.floor(idx/N), c = idx%N;
    for (let k=0;k<(4-rotate)%4;k++) { const nr = N-1-c, nc = r; r = nr; c = nc; }
    mergedCells.add(r*N+c);
  });
  const back = (p) => { let r = p[0], c = p[1]; for (let k=0;k<(4-rotate)%4;k++) { const nr = N-1-c, nc = r; r = nr; c = nc; } return [r, c]; };
  for (let k=0;k<(4-rotate)%4;k++) working = rot(working);
  if (!moved) { mergedCells = null; return; }
  lastMoves = moves.map(m => ({ from: back(m.from), to: back(m.to), v: m.v }));
  grid = working;
  score += gained;
  const best = store.getInt(bestKey(), 0);
  if (score > best) store.set(bestKey(), score);
  addTile();
  render();
  if (!canMove()) { over = true; document.getElementById('over-msg').textContent = '· Game over. ' + Gamekit.taunt('over-' + diff); }
}

function rot(m) {
  // rotate counter-clockwise
  const r = empty();
  for (let i=0;i<N;i++) for (let j=0;j<N;j++) r[N-1-j][i] = m[i][j];
  return r;
}

function canMove() {
  for (let r=0;r<N;r++) for (let c=0;c<N;c++) {
    if (!grid[r][c]) return true;
    if (c+1<N && grid[r][c]===grid[r][c+1]) return true;
    if (r+1<N && grid[r][c]===grid[r+1][c]) return true;
  }
  return false;
}

function reset() {
  grid = empty(); score = 0; over = false;
  const om = document.getElementById('over-msg'); if (om) om.textContent = '';
  addTile(); addTile(); lastSpawn = null; render();
}

window.addEventListener('keydown', e => {
  const map = {ArrowLeft:'left',ArrowRight:'right',ArrowUp:'up',ArrowDown:'down',a:'left',d:'right',w:'up',s:'down'};
  if (map[e.key]) { move(map[e.key]); e.preventDefault(); }
});

let tStart=null;
document.getElementById('board').addEventListener('touchstart', e=>{tStart=e.touches[0];},{passive:true});
document.getElementById('board').addEventListener('touchend', e=>{
  if(!tStart)return;
  const t=e.changedTouches[0], dx=t.clientX-tStart.clientX, dy=t.clientY-tStart.clientY;
  if (Math.max(Math.abs(dx),Math.abs(dy)) < 35) return;
  if (Math.abs(dx)>Math.abs(dy)) move(dx>0?'right':'left'); else move(dy>0?'down':'up');
  tStart=null;
});

document.getElementById('reset').addEventListener('click', reset);
const chips = Gamekit.wireDifficultyChips({
  el: document.getElementById('chips'),
  difficulties: Object.keys(DIFFS),
  initial: diff,
  storage: store,
  storageKey: 'diff',
  onChange: (d) => { diff = d; reset(); },
});
reset();

// A refresh keeps the game: the board, score and difficulty.
const resumer = Gamekit.resume('2048', () => over ? null : { diff, grid, score }, (s) => {
  const ok = DIFFS[s.diff] && Array.isArray(s.grid) && s.grid.length === N &&
    s.grid.every(r => Array.isArray(r) && r.length === N && r.every(v => Number.isInteger(v) && v >= 0)) &&
    Number.isInteger(s.score) && s.score >= 0;
  if (!ok) return false;
  diff = s.diff; chips.show(diff);
  grid = s.grid.map(r => r.slice()); score = s.score; over = false;
  render();
  return true;
});
resumer.restore();
