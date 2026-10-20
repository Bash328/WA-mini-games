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
  let curSeed = 0;       // the puzzle on screen can be rebuilt from this + diff

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

  /* ---------- Puzzle generation ----------
     Everything here is bounded by step counts, never by the clock, so the
     daily puzzle is identical on every device and a worst-case seed can't
     hang the page. (Counting every Hamiltonian path of a 7x7 grid to prove a
     puzzle has one answer is astronomically large; that search used to run
     unbounded and froze Hard.) */

  function makeAdjacency(n) {
    const nb = [];
    for (let i = 0; i < n * n; i++) {
      const r = Math.floor(i / n), c = i % n, a = [];
      if (r > 0) a.push(i - n);
      if (r < n - 1) a.push(i + n);
      if (c > 0) a.push(i - 1);
      if (c < n - 1) a.push(i + 1);
      nb.push(a);
    }
    return nb;
  }

  // A random Hamiltonian path: DFS with the Warnsdorff heuristic, abandoned
  // (returns null) after `cap` steps so a bad start can't backtrack forever.
  function hamiltonian(n, nb, rng, cap) {
    const total = n * n;
    const visited = new Uint8Array(total);
    const path = [];
    let steps = 0;
    const free = (i) => { let c = 0; for (const x of nb[i]) if (!visited[x]) c++; return c; };
    function step(i) {
      if (++steps > cap) return false;
      path.push(i);
      visited[i] = 1;
      if (path.length === total) return true;
      const cand = Gamekit.shuffle(nb[i].filter(x => !visited[x]), rng);
      cand.sort((a, b) => free(a) - free(b));
      for (const x of cand) {
        if (step(x)) return true;
        if (steps > cap) break;
      }
      path.pop();
      visited[i] = 0;
      return false;
    }
    return step(Math.floor(rng() * total)) ? path : null;
  }

  // The same, but a boustrophedon sweep: always a valid Hamiltonian path,
  // used only if every random attempt fails.
  function serpentine(n) {
    const out = [];
    for (let r = 0; r < n; r++) {
      for (let k = 0; k < n; k++) out.push(r * n + (r % 2 === 0 ? k : n - 1 - k));
    }
    return out;
  }

  // Counts Hamiltonian paths from wps[0] that visit the waypoints in order,
  // up to `limit`, giving up after `budget` search nodes. adj already has
  // walls removed. Returns { count, aborted }.
  function countSolutions(n, adj, wps, limit, budget) {
    const total = n * n, K = wps.length;
    const visited = new Uint8Array(total);
    const order = new Int16Array(total).fill(-1);
    wps.forEach((w, k) => { order[w] = k; });
    const end = wps[K - 1];
    let count = 0, nodes = 0, nextWp = 1, aborted = false;

    // An unvisited cell with fewer than two ways in and out can never be
    // part of the path (the final cell needs only one), so prune early.
    function deadEnd(cur) {
      for (let u = 0; u < total; u++) {
        if (visited[u]) continue;
        let ways = 0;
        const a = adj[u];
        for (let j = 0; j < a.length; j++) { const x = a[j]; if (!visited[x] || x === cur) ways++; }
        if (u === end ? ways < 1 : ways < 2) return true;
      }
      return false;
    }

    function step(cur, len) {
      if (count >= limit || aborted) return;
      if (++nodes > budget) { aborted = true; return; }
      if (len === total) { if (cur === end) count++; return; }
      if (deadEnd(cur)) return;
      for (const x of adj[cur]) {
        if (visited[x]) continue;
        const wp = order[x];
        if (wp >= 0) {
          if (wp !== nextWp) continue;
          if (wp === K - 1 && len + 1 !== total) continue;   // the end cell must come last
          nextWp++;
          visited[x] = 1;
          step(x, len + 1);
          visited[x] = 0;
          nextWp--;
        } else {
          visited[x] = 1;
          step(x, len + 1);
          visited[x] = 0;
        }
        if (count >= limit || aborted) return;
      }
    }
    visited[wps[0]] = 1;
    step(wps[0], 1);
    return { count: count, aborted: aborted };
  }

  const ATTEMPTS = 8, PATH_CAP = 20000, SOLVE_BUDGET = 30000;

  // A puzzle for (difficulty, seed). Prefers one with a single solution; if
  // none turns up within the budget it settles for the first valid layout
  // (any path that fills the grid in order is accepted when playing).
  function buildPuzzle(diffKey, seed) {
    const { N: n, K: k, walls: wallCount } = DIFFS[diffKey];
    const rng = Gamekit.mulberry32(seed);
    const nb = makeAdjacency(n);
    const total = n * n;
    let fallback = null;
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      const hp = hamiltonian(n, nb, rng, PATH_CAP);
      if (!hp) continue;
      // waypoint positions along the path: first, last, and k-2 in between
      const positions = [0, total - 1];
      const interior = [];
      for (let i = 1; i < total - 1; i++) interior.push(i);
      const shuffled = Gamekit.shuffle(interior, rng);
      for (let i = 0; i < k - 2; i++) positions.push(shuffled[i]);
      positions.sort((x, y) => x - y);
      const wps = positions.map(q => hp[q]);

      // walls: random edges that are NOT on the reference path
      const pathEdges = new Set();
      for (let i = 0; i < hp.length - 1; i++) pathEdges.add(edgeKey(hp[i], hp[i + 1]));
      const nonPath = [];
      for (let i = 0; i < total; i++) {
        for (const x of nb[i]) if (x > i && !pathEdges.has(edgeKey(i, x))) nonPath.push([i, x]);
      }
      const sw = Gamekit.shuffle(nonPath, rng);
      const ws = new Set();
      for (let i = 0; i < Math.min(wallCount, sw.length); i++) ws.add(edgeKey(sw[i][0], sw[i][1]));

      const cand = { N: n, K: k, waypoints: wps, walls: ws, solutionPath: hp };
      const adj = nb.map((a, i) => a.filter(x => !ws.has(edgeKey(i, x))));
      const res = countSolutions(n, adj, wps, 2, SOLVE_BUDGET);
      if (!res.aborted && res.count === 1) { cand.unique = true; return cand; }
      if (!fallback) fallback = cand;
    }
    if (fallback) return fallback;
    const hp = serpentine(n);
    const positions = [0, total - 1];
    for (let i = 1; i <= k - 2; i++) positions.push(Math.floor(i * (total - 1) / (k - 1)));
    positions.sort((x, y) => x - y);
    return { N: n, K: k, waypoints: positions.map(q => hp[q]), walls: new Set(), solutionPath: hp };
  }

  function generate(seed) {
    const pz = buildPuzzle(diff, seed);
    N = pz.N; K = pz.K;
    waypoints = pz.waypoints;
    walls = pz.walls;
    solutionPath = pz.solutionPath;
  }

  function newPuzzle(seedOverride) {
    const seed = seedOverride !== undefined ? seedOverride : Gamekit.dailySeed("zip", diff);
    curSeed = seed;
    generate(seed);
    path = [];
    onPath = new Set();
    won = false;
    svgEl.classList.remove("win");
    vcells = []; vpending = null; vh = 0; vtarget = 0;
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
    const bb = boardEl.getBoundingClientRect(), brect = { left: bb.left + boardEl.clientLeft, top: bb.top + boardEl.clientTop, width: boardEl.clientWidth, height: boardEl.clientHeight };   // the inside of the frame: absolute children measure from there, not from the border
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

  /* ---------- Drawing the path ----------
     The line is not redrawn in jumps: `vcells` is the path as drawn, `vh` how far along it the glowing
     head has got (a fractional index). The head glides to the end of the real path; when the path gets
     shorter the head glides back and only then drops the tail. Cells fill as the head passes them. */
  let vcells = [], vh = 0, vtarget = 0, vpending = null, raf = 0, lastT = 0;
  const still = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function insideFrame() {
    const bb = boardEl.getBoundingClientRect();
    return { left: bb.left + boardEl.clientLeft, top: bb.top + boardEl.clientTop, width: boardEl.clientWidth, height: boardEl.clientHeight };   // the inside of the frame: absolute children measure from there, not from the border
  }
  function centreOf(i, brect) {
    const r = cellEls[i].getBoundingClientRect();
    return [r.left - brect.left + r.width / 2, r.top - brect.top + r.height / 2];
  }

  function drawPath() {
    const brect = insideFrame();
    svgEl.setAttribute("viewBox", "0 0 " + brect.width + " " + brect.height);
    svgEl.replaceChildren();
    const whole = Math.min(Math.floor(vh + 1e-6), vcells.length - 1);
    for (let i = 0; i < cellEls.length; i++) cellEls[i].classList.remove("on");
    for (let k = 0; k < vcells.length; k++) if (k <= vh + 0.5) cellEls[vcells[k]].classList.add("on");
    if (whole < 0) return;
    const pts = [];
    for (let k = 0; k <= whole; k++) pts.push(centreOf(vcells[k], brect));
    const frac = vh - whole;
    if (frac > 1e-3 && whole + 1 < vcells.length) {
      const a = pts[whole], c = centreOf(vcells[whole + 1], brect);
      pts.push([a[0] + (c[0] - a[0]) * frac, a[1] + (c[1] - a[1]) * frac]);
    }
    const ns = "http://www.w3.org/2000/svg";
    if (pts.length >= 2) {
      const line = document.createElementNS(ns, "polyline");
      line.setAttribute("points", pts.map((q) => q[0] + "," + q[1]).join(" "));
      line.setAttribute("fill", "none");
      line.setAttribute("stroke", "var(--accent)");
      line.setAttribute("stroke-width", "10");
      line.setAttribute("stroke-linecap", "round");
      line.setAttribute("stroke-linejoin", "round");
      svgEl.appendChild(line);
    }
    const h = pts[pts.length - 1];
    if (dragging && !won) {                       // a soft halo under the finger, like a touch indicator
      const halo = document.createElementNS(ns, "circle");
      halo.setAttribute("cx", h[0]); halo.setAttribute("cy", h[1]); halo.setAttribute("r", String(cellEls[0].getBoundingClientRect().width * 0.62));
      halo.setAttribute("fill", "rgba(255,255,255,.32)"); halo.setAttribute("class", "zp-halo");
      svgEl.appendChild(halo);
    }
    const head = document.createElementNS(ns, "circle");
    head.setAttribute("cx", h[0]); head.setAttribute("cy", h[1]); head.setAttribute("r", "9");
    head.setAttribute("fill", "var(--accent)"); head.setAttribute("stroke", "#fff"); head.setAttribute("stroke-width", "3");
    svgEl.appendChild(head);
  }

  function tick(t) {
    raf = 0;
    const dt = Math.min(0.05, (t - lastT) / 1000 || 0.016);
    lastT = t;
    const diff = vtarget - vh;
    if (Math.abs(diff) < 0.004) {
      vh = vtarget;
      if (vpending) { vcells = vpending; vpending = null; }
      drawPath();
      return;
    }
    // ease towards the target, but never crawl: at least ~9 squares a second
    const step = Math.max(Math.abs(diff) * (1 - Math.exp(-dt * 24)), Math.min(Math.abs(diff), 9 * dt));
    vh += Math.sign(diff) * step;
    drawPath();
    raf = requestAnimationFrame(tick);
  }

  function renderPath() {
    const n = path.length, o = vcells.length;
    let common = 0;
    while (common < n && common < o && path[common] === vcells[common]) common++;
    if (n === 0) { vcells = []; vpending = null; vh = 0; vtarget = 0; }
    else if (common === o) { vcells = path.slice(); vpending = null; vtarget = n - 1; }        // grew (or unchanged)
    else if (common === n) { vpending = path.slice(); vtarget = n - 1; }                         // shrank: glide back, then drop the tail
    else { vcells = path.slice(); vpending = null; vh = Math.min(vh, common - 1); vtarget = n - 1; }   // a different track from the fork on
    if (still()) { vh = vtarget; if (vpending) { vcells = vpending; vpending = null; } }
    if (raf) return;
    if (vh === vtarget && !vpending) { drawPath(); return; }
    lastT = performance.now();
    raf = requestAnimationFrame(tick);
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
  // a fast finger can skip squares between two samples: walk through the free ones towards the target
  const dist = (a, b) => Math.abs(Math.floor(a / N) - Math.floor(b / N)) + Math.abs(a % N - b % N);
  function reach(t) {
    for (let guard = 0; guard < 4 && path.length && !won; guard++) {
      const last = path[path.length - 1];
      if (t === last || onPath.has(t) || neighbors(last).includes(t)) break;
      let best = -1, bd = dist(last, t);
      for (const x of neighbors(last)) {
        if (onPath.has(x) || blocked(last, x) || (waypoints.includes(x) && x !== t)) continue;
        if (dist(x, t) < bd) { bd = dist(x, t); best = x; }
      }
      if (best < 0) break;
      const before = path.length;
      tryExtend(best);
      if (path.length === before) break;
    }
    tryExtend(t);
  }
  function onPointerMove(e) {
    if (!dragging) return;
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
    for (const ev of evs.length ? evs : [e]) {
      const t = cellFromEvent(ev);
      if (t >= 0) reach(t);
    }
  }
  function onPointerUp(e) {
    dragging = false;
    drawPath();
    try { boardEl.releasePointerCapture(e.pointerId); } catch (_) {}
  }

  function checkWin() {
    if (path.length !== N * N) return;
    // Must end at last waypoint; must have visited waypoints in order (already enforced).
    if (path[path.length - 1] !== waypoints[K - 1]) return;
    won = true;
    svgEl.classList.add("win");
    const s = Math.floor((Date.now() - timerStart) / 1000);
    const best = store.getInt("best:" + diff, null);
    if (best === null || s < best) {
      store.set("best:" + diff, s);
      bestEl.textContent = Gamekit.fmtTime(s);
    }
    statusEl.innerHTML = '<span class="ok">Solved in ' + Gamekit.fmtTime(s) + '.</span>';
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
    svgEl.classList.remove("win");
    timerStart = Date.now(); startTimer();
    statusEl.textContent = "Connect 1 → 2 → 3 → … filling every cell.";
    renderPath();
  });
  newBtn.addEventListener("click", () => newPuzzle(Gamekit.randomSeed()));

  const chips = Gamekit.wireDifficultyChips({
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

  // A refresh keeps the puzzle, the path you drew and the clock.
  const resumer = Gamekit.resume("zip", () => won ? null : {
    diff: diff, seed: curSeed, path: path, elapsed: Math.floor((Date.now() - timerStart) / 1000),
  }, (s) => {
    if (!DIFFS[s.diff] || !Number.isInteger(s.seed) || !Array.isArray(s.path)) return false;
    diff = s.diff; chips.show(diff);
    newPuzzle(s.seed);
    const ok = s.path.length <= N * N && s.path.every(v => Number.isInteger(v) && v >= 0 && v < N * N) && new Set(s.path).size === s.path.length;
    path = ok ? s.path.slice() : [];
    onPath = new Set(path);
    timerStart = Date.now() - (Number.isFinite(s.elapsed) ? Math.max(0, s.elapsed) : 0) * 1000;
    timeEl.textContent = Gamekit.fmtTime(Math.floor((Date.now() - timerStart) / 1000));
    renderPath(); updateStatus();
    return true;
  });
  resumer.restore();
  window.addEventListener("load", () => Manpage.autoOpen("zip"));

  // Exposed only so the generator can be timed and checked in tests.
  window.__zipTest = {
    buildPuzzle, countSolutions, makeAdjacency, DIFFS,
    autoSolve: () => { path = solutionPath.slice(); onPath = new Set(path); renderPath(); checkWin(); },   // the reference answer, for the end-of-game check
  };
})();
