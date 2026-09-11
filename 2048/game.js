const N = 4;
const store = Gamekit.storage('2048:');
let grid, score, over, mergedCells;

function empty() { return Array.from({length: N}, () => Array(N).fill(0)); }

function addTile() {
  const spots = [];
  for (let r=0;r<N;r++) for (let c=0;c<N;c++) if (!grid[r][c]) spots.push([r,c]);
  if (!spots.length) return;
  const [r,c] = spots[Math.floor(Math.random()*spots.length)];
  grid[r][c] = Math.random() < 0.9 ? 2 : 4;
}

function render() {
  const el = document.getElementById('board');
  el.innerHTML = '';
  for (let r=0;r<N;r++) for (let c=0;c<N;c++) {
    const v = grid[r][c];
    const d = document.createElement('div');
    d.className = 'tile' + (v ? ' t'+v : '');
    if (mergedCells && mergedCells.has(r*N+c)) d.classList.add('merged');
    d.textContent = v || '';
    el.appendChild(d);
  }
  mergedCells = null;
  document.getElementById('score').textContent = score;
  document.getElementById('best').textContent = store.getInt('best', 0);
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
  for (let r=0;r<N;r++) {
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
  for (let k=0;k<(4-rotate)%4;k++) working = rot(working);
  if (!moved) { mergedCells = null; return; }
  grid = working;
  score += gained;
  const best = store.getInt('best', 0);
  if (score > best) store.set('best', score);
  addTile();
  render();
  if (!canMove()) { over = true; document.getElementById('over-msg').textContent = '· Game over.'; }
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
  addTile(); addTile(); render();
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
reset();
