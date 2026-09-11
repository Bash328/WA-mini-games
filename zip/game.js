(function () {
  "use strict";

  const DIFFS = {
    easy:   { N: 5, K: 4, walls: 0 },
    medium: { N: 6, K: 5, walls: 3 },
    hard:   { N: 7, K: 6, walls: 5 },
  };

  const boardEl = document.getElementById("board");
  const svgEl = document.getElementById("svg");
  const statusEl = document.getElementById("status");
  const timeEl = document.getElementById("time");
  const bestEl = document.getElementById("best");
  const undoBtn = document.getElementById("undo-btn");
  const resetBtn = document.getElementById("reset-btn");
  const newBtn = document.getElementById("new-btn");
  const chipsEl = document.getElementById("chips");

  const store = Gamekit.storage("zip:");
  let diff = store.get("diff", "medium");
  if (!DIFFS[diff]) diff = "medium";

  let N, K;
  let waypoints = [];    // length K, each is cell index; waypoints[0]=start, sorted by number 1..K
  let walls = new Set(); // set of "a-b" with a<b representing blocked edge
  let solutionPath = []; // full reference Hamiltonian path, length N*N

  let path = [];         // user's current path (array of cell indices)
  let onPath = new Set();
  let won = false;
  let timerStart = 0;
  let timerInterval = null;
  let cellEls = [];
  let dragging = false;

  function idx(r, c) { return r * N + c; }
  function rcOf(i) { return [Math.floor(i / N), i % N]; }
  function neighbors(i) {
    const [r, c] = rcOf(i);
    const out = [];
    if (r > 0) out.push(idx(r - 1, c));
    if (r < N - 1) out.push(idx(r + 1, c));
    if (c > 0) out.push(idx(r, c - 1));
    if (c < N - 1) out.push(idx(r, c + 1));
    return out;
  }
  function edgeKey(a, b) { return a < b ? (a + "-" + b) : (b + "-" + a); }
  function blocked(a, b) { return walls.has(edgeKey(a, b)); }

  // Random Hamiltonian path via DFS + Warnsdorff heuristic
  function hamiltonian(rng) {
    const total = N * N;
    const visited = new Uint8Array(total);
    const path = [];
    const start = Math.floor(rng() * total);
    function step(i) {
      path.push(i);
      visited[i] = 1;
      if (path.length === total) return true;
      let nb = neighbors(i).filter(n => !visited[n]);
      nb = Gamekit.shuffle(nb, rng);
      // Warnsdorff: prefer neighbors with fewer unvisited neighbors
      nb.sort((a, b) => {
        const da = neighbors(a).filter(n => !visited[n]).length;
        const db = neighbors(b).filter(n => !visited[n]).length;
        return da - db;
      });
      for (const n of nb) {
        if (step(n)) return true;
      }
      path.pop();
      visited[i] = 0;
      return false;
    }
    if (step(start)) return path;
    return null;
  }

  // Count Hamiltonian paths from waypoints[0] visiting waypoints in order, obeying walls. Cap at `limit`.
  function countSolutions(limit) {
    const total = N * N;
    const visited = new Uint8Array(total);
    const order = new Array(K);
    for (let k = 0; k < K; k++) order[waypoints[k]] = k;
    let count = 0;
    let nextWp = 1;
    function step(cur, len) {
      if (count >= limit) return;
      if (len === total) {
        if (cur === waypoints[K - 1]) count++;
        return;
      }
      for (const n of neighbors(cur)) {
        if (visited[n]) continue;
        if (blocked(cur, n)) continue;
        const wp = order[n];
        if (wp !== undefined) {
          if (wp !== nextWp) continue;
          nextWp++;
          visited[n] = 1;
          step(n, len + 1);
          visited[n] = 0;
          nextWp--;
        } else {
          visited[n] = 1;
          step(n, len + 1);
          visited[n] = 0;
        }
        if (count >= limit) return;
      }
    }
    visited[waypoints[0]] = 1;
    nextWp = 1;
    step(waypoints[0], 1);
    return count;
  }

  function generate(seed) {
    const rng = Gamekit.mulberry32(seed);
    const { N: n, K: k, walls: wallCount } = DIFFS[diff];
    N = n; K = k;
    for (let attempt = 0; attempt < 40; attempt++) {
      const hp = hamiltonian(rng);
      if (!hp) continue;
      // Pick K waypoint positions along the path: index 0, last, plus K-2 in between sorted.
      const totalCells = N * N;
      const positions = [0, totalCells - 1];
      const interior = [];
      for (let i = 1; i < totalCells - 1; i++) interior.push(i);
      const shuffled = Gamekit.shuffle(interior, rng);
      for (let i = 0; i < K - 2; i++) positions.push(shuffled[i]);
      positions.sort((a, b) => a - b);
      const wps = positions.map(p => hp[p]);

      // Add walls: random edges NOT on the path
      const pathEdges = new Set();
      for (let i = 0; i < hp.length - 1; i++) pathEdges.add(edgeKey(hp[i], hp[i + 1]));
      const nonPath = [];
      for (let i = 0; i < totalCells; i++) {
        for (const nn of neighbors(i)) {
          if (nn > i && !pathEdges.has(edgeKey(i, nn))) nonPath.push([i, nn]);
        }
      }
      const sw = Gamekit.shuffle(nonPath, rng);
      const ws = new Set();
      for (let i = 0; i < Math.min(wallCount, sw.length); i++) ws.add(edgeKey(sw[i][0], sw[i][1]));

      waypoints = wps;
      walls = ws;
      solutionPath = hp;

      const count = countSolutions(2);
      if (count === 1) return true;
    }
    return true; // accept last attempt even if non-unique
  }

  function newPuzzle(seedOverride) {
    const seed = seedOverride !== undefined ? seedOverride : Gamekit.dailySeed("zip", diff);
    generate(seed);
    path = [];
    onPath = new Set();
    won = false;
    timerStart = Date.now();
    startTimer();
    renderShell();
    renderPath();
    updateStatus();
    statusEl.textContent = "Connect 1 → 2 → 3 → … filling every cell.";
  }

  function renderShell() {
    boardEl.style.gridTemplateColumns = "repeat(" + N + ", 1fr)";
    boardEl.style.gridTemplateRows = "repeat(" + N + ", 1fr)";
    // Remove all children except the svg
    Array.from(boardEl.children).forEach(c => { if (c !== svgEl) c.remove(); });
    Array.from(boardEl.querySelectorAll(".zp-wall-h, .zp-wall-v")).forEach(w => w.remove());
    cellEls = [];
    const total = N * N;
    const wpIdx = {};
    waypoints.forEach((w, k) => { wpIdx[w] = k + 1; });
    for (let i = 0; i < total; i++) {
      const el = document.createElement("div");
      el.className = "zp-cell fade-in";
      el.style.animationDelay = (i * 5) + "ms";
      el.dataset.i = String(i);
      if (wpIdx[i] !== undefined) {
        const k = wpIdx[i];
        if (k === 1) el.classList.add("start");
        if (k === K) el.classList.add("end");
        const wp = document.createElement("span");
        wp.className = "wp";
        wp.textContent = String(k);
        el.appendChild(wp);
      }
      boardEl.appendChild(el);
      cellEls.push(el);
    }
    // Walls
    requestAnimationFrame(renderWalls);
  }
  boardEl.addEventListener("pointerdown", onPointerDown);
  boardEl.addEventListener("pointermove", onPointerMove);
  boardEl.addEventListener("pointerup", onPointerUp);
  boardEl.addEventListener("pointercancel", onPointerUp);

  function renderWalls() {
    Array.from(boardEl.querySelectorAll(".zp-wall-h, .zp-wall-v")).forEach(w => w.remove());
    const brect = boardEl.getBoundingClientRect();
    for (const w of walls) {
      const [a, b] = w.split("-").map(Number);
      const ra = Math.floor(a / N), ca = a % N;
      const rb = Math.floor(b / N), cb = b % N;
      const ae = cellEls[a].getBoundingClientRect();
      const be = cellEls[b].getBoundingClientRect();
      const div = document.createElement("div");
      if (ra === rb) {
        div.className = "zp-wall-v";
        const x = (ra < rb || ca < cb) ? (ae.right - brect.left - 2) : (be.right - brect.left - 2);
        div.style.left = x + "px";
        div.style.top = (ae.top - brect.top) + "px";
        div.style.width = "4px";
        div.style.height = ae.height + "px";
      } else {
        div.className = "zp-wall-h";
        const y = (ra < rb) ? (ae.bottom - brect.top - 2) : (be.bottom - brect.top - 2);
        div.style.top = y + "px";
        div.style.left = (ae.left - brect.left) + "px";
        div.style.width = ae.width + "px";
        div.style.height = "4px";
      }
      boardEl.appendChild(div);
    }
  }

  function renderPath() {
    for (let i = 0; i < cellEls.length; i++) cellEls[i].classList.toggle("on", onPath.has(i));
    // Redraw SVG polyline
    const brect = boardEl.getBoundingClientRect();
    svgEl.setAttribute("viewBox", "0 0 " + brect.width + " " + brect.height);
    svgEl.innerHTML = "";
    if (path.length >= 2) {
      const ns = "http://www.w3.org/2000/svg";
      const pts = path.map(i => {
        const r = cellEls[i].getBoundingClientRect();
        return (r.left - brect.left + r.width / 2) + "," + (r.top - brect.top + r.height / 2);
      }).join(" ");
      const line = document.createElementNS(ns, "polyline");
      line.setAttribute("points", pts);
      line.setAttribute("fill", "none");
      line.setAttribute("stroke", "var(--accent)");
      line.setAttribute("stroke-width", "6");
      line.setAttribute("stroke-linecap", "round");
      line.setAttribute("stroke-linejoin", "round");
      line.setAttribute("opacity", "0.85");
      svgEl.appendChild(line);
    }
  }

  function cellFromEvent(e) {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el) return -1;
    const cell = el.closest(".zp-cell");
    if (!cell || !boardEl.contains(cell)) return -1;
    return Number(cell.dataset.i);
  }

  function flashInvalid(cellIdx) {
    const el = boardEl.children[cellIdx];
    if (!el) return;
    el.classList.remove('invalid');
    void el.offsetWidth;
    el.classList.add('invalid');
    el.addEventListener('animationend', () => el.classList.remove('invalid'), { once: true });
  }

  function tryExtend(target) {
    if (target < 0 || won) return;
    // If path empty, must start at cell 1
    if (path.length === 0) {
      if (target === waypoints[0]) { path.push(target); onPath.add(target); renderPath(); }
      else flashInvalid(target);
      return;
    }
    // If user taps current end, nothing
    const last = path[path.length - 1];
    if (target === last) return;
    // If tapping a cell already on path (not last), truncate to there
    if (onPath.has(target)) {
      const ix = path.indexOf(target);
      const removed = path.splice(ix + 1);
      removed.forEach(r => onPath.delete(r));
      renderPath();
      return;
    }
    // Must be adjacent to last
    if (!neighbors(last).includes(target)) { flashInvalid(target); return; }
    if (blocked(last, target)) { flashInvalid(target); return; }
    // Waypoint order check: may not place a non-next waypoint
    const nextExpectedWp = path.filter(p => waypoints.includes(p)).length;
    const wpIndex = waypoints.indexOf(target);
    if (wpIndex !== -1 && wpIndex !== nextExpectedWp) { flashInvalid(target); return; }
    path.push(target);
    onPath.add(target);
    renderPath();
    checkWin();
  }

  function onPointerDown(e) {
    if (won) return;
    const t = cellFromEvent(e);
    if (t < 0) return;
    dragging = true;
    boardEl.setPointerCapture(e.pointerId);
    tryExtend(t);
  }
  function onPointerMove(e) {
    if (!dragging) return;
    const t = cellFromEvent(e);
    if (t < 0) return;
    tryExtend(t);
  }
  function onPointerUp(e) {
    dragging = false;
    try { boardEl.releasePointerCapture(e.pointerId); } catch (_) {}
  }

  function checkWin() {
    if (path.length !== N * N) return;
    // Must end at last waypoint; must have visited waypoints in order (already enforced).
    if (path[path.length - 1] !== waypoints[K - 1]) return;
    won = true;
    const s = Math.floor((Date.now() - timerStart) / 1000);
    const best = store.getInt("best:" + diff, null);
    if (best === null || s < best) {
      store.set("best:" + diff, s);
      bestEl.textContent = Gamekit.fmtTime(s);
    }
    statusEl.innerHTML = '<span class="ok">Zipped in ' + Gamekit.fmtTime(s) + '.</span>';
  }

  function startTimer() {
    if (timerInterval) clearInterval(timerInterval);
    timeEl.textContent = Gamekit.fmtTime(0);
    timerInterval = setInterval(() => {
      if (won) return;
      const s = Math.floor((Date.now() - timerStart) / 1000);
      timeEl.textContent = Gamekit.fmtTime(s);
    }, 500);
  }

  function updateStatus() {
    const best = store.getInt("best:" + diff, null);
    bestEl.textContent = best === null ? "—" : Gamekit.fmtTime(best);
  }

  undoBtn.addEventListener("click", () => {
    if (path.length === 0 || won) return;
    const r = path.pop();
    onPath.delete(r);
    renderPath();
    statusEl.textContent = "Connect 1 → 2 → 3 → … filling every cell.";
  });
  resetBtn.addEventListener("click", () => {
    path = []; onPath = new Set(); won = false;
    timerStart = Date.now(); startTimer();
    statusEl.textContent = "Connect 1 → 2 → 3 → … filling every cell.";
    renderPath();
  });
  newBtn.addEventListener("click", () => newPuzzle(Gamekit.randomSeed()));

  Gamekit.wireDifficultyChips({
    el: chipsEl,
    difficulties: ["easy", "medium", "hard"],
    initial: diff,
    storage: store,
    storageKey: "diff",
    onChange: (d) => { diff = d; newPuzzle(); updateStatus(); },
  });
  diff = store.get("diff", diff);
  if (!DIFFS[diff]) diff = "medium";

  window.addEventListener("resize", () => { renderWalls(); renderPath(); });
  newPuzzle();
  updateStatus();
  window.addEventListener("load", () => Manpage.autoOpen("zip"));
})();
