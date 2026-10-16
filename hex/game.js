(function () {
  "use strict";

  const SIZE = 11, CELLS = SIZE * SIZE;
  const RED = 1, BLUE = 2;
  const NAMES = { [RED]: "Red", [BLUE]: "Blue" };
  const NEIGH = [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, 1], [1, -1]];
  const other = (p) => (p === RED ? BLUE : RED);

  const boardEl = document.getElementById("board");
  const statusEl = document.getElementById("status");
  const undoBtn = document.getElementById("undo-btn");
  const resetBtn = document.getElementById("reset-btn");
  const chipsEl = document.getElementById("chips");
  const modeSel = document.getElementById("mode");
  const sideSel = document.getElementById("side");
  const store = Gamekit.storage("hex:");

  let diff = store.get("diff", "medium");
  if (!["easy", "medium", "hard"].includes(diff)) diff = "medium";
  let mode = store.get("mode", "whatsapp");
  if (!["whatsapp", "ai", "local"].includes(mode)) mode = "whatsapp";
  const params = new URLSearchParams(location.search);
  const invited = params.has("live");
  if (params.has("s")) mode = "whatsapp"; else if (invited) mode = "live";
  const isLinked = () => mode === "whatsapp" || mode === "live";
  modeSel.value = mode;
  sideSel.value = store.get("side", "1") === "2" ? "2" : "1";

  // ---------- the position ----------
  let grid = new Uint8Array(CELLS);   // 0 empty, 1 Red, 2 Blue
  let history = [];                   // [{i, p}]
  let current = RED;
  let over = false, chain = null;     // the winning chain of cells
  let humanIs = RED, thinking = false, aiTimer = null;
  let lastIdx = null, linkCanMove = false;

  // Red connects top to bottom, Blue left to right. A chain of the player's
  // stones from one side to the other, or null.
  function winningChain(g, p) {
    const prev = new Int16Array(CELLS).fill(-2);
    const q = [];
    for (let k = 0; k < SIZE; k++) { const i = p === RED ? k : k * SIZE; if (g[i] === p) { prev[i] = -1; q.push(i); } }
    for (let h = 0; h < q.length; h++) {
      const i = q[h], r = (i / SIZE) | 0, c = i % SIZE;
      if ((p === RED && r === SIZE - 1) || (p === BLUE && c === SIZE - 1)) {
        const out = []; for (let j = i; j !== -1; j = prev[j]) out.push(j); return out;
      }
      for (const [dr, dc] of NEIGH) {
        const rr = r + dr, cc = c + dc;
        if (rr < 0 || rr >= SIZE || cc < 0 || cc >= SIZE) continue;
        const j = rr * SIZE + cc;
        if (g[j] === p && prev[j] === -2) { prev[j] = i; q.push(j); }
      }
    }
    return null;
  }

  // ---------- drawing ----------
  // A pointy-top hexagon board, drawn as one SVG that scales to the screen.
  const R = 12, W = Math.sqrt(3) * R, PAD = 6;
  const cx = (r, c) => PAD + W / 2 + W * (c + r / 2);
  const cy = (r) => PAD + R + 1.5 * R * r;
  const vert = (x, y, k) => { const a = ((60 * k - 90) * Math.PI) / 180; return [x + R * Math.cos(a), y + R * Math.sin(a)]; };
  const pts = (list) => list.map((p) => p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" ");
  const NS = "http://www.w3.org/2000/svg";
  const cellEls = [];
  function svgEl(tag, attrs) { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; }

  function buildBoard() {
    const width = W * (SIZE + (SIZE - 1) / 2) + 2 * PAD;
    const height = 1.5 * R * (SIZE - 1) + 2 * R + 2 * PAD;
    const svg = svgEl("svg", { viewBox: "0 0 " + width.toFixed(1) + " " + height.toFixed(1), role: "group", "aria-label": "Hex board" });
    // the four coloured sides: Red top and bottom, Blue left and right
    const side = (cls, list) => svg.appendChild(svgEl("polyline", { class: "hx-side " + cls, points: pts(list), fill: "none" }));
    const top = [], bot = [], left = [], right = [];
    for (let c = 0; c < SIZE; c++) { const x = cx(0, c), y = cy(0); top.push(vert(x, y, 5), vert(x, y, 0), vert(x, y, 1)); const x2 = cx(SIZE - 1, c), y2 = cy(SIZE - 1); bot.push(vert(x2, y2, 4), vert(x2, y2, 3), vert(x2, y2, 2)); }
    for (let r = 0; r < SIZE; r++) { const x = cx(r, 0), y = cy(r); left.push(vert(x, y, 5), vert(x, y, 4), vert(x, y, 3)); const x2 = cx(r, SIZE - 1), y2 = cy(r); right.push(vert(x2, y2, 0), vert(x2, y2, 1), vert(x2, y2, 2)); }
    side("red", top); side("red", bot); side("blue", left); side("blue", right);
    for (let i = 0; i < CELLS; i++) {
      const r = (i / SIZE) | 0, c = i % SIZE;
      const poly = svgEl("polygon", { class: "hx", "data-i": i, points: pts([0, 1, 2, 3, 4, 5].map((k) => vert(cx(r, c), cy(r), k))), role: "button", "aria-label": "row " + (r + 1) + ", column " + (c + 1) });
      svg.appendChild(poly);
      cellEls.push(poly);
    }
    boardEl.replaceChildren(svg);
    boardEl.addEventListener("click", (e) => { const p = e.target.closest && e.target.closest("polygon.hx"); if (p) onCell(+p.getAttribute("data-i")); });
    boardEl.addEventListener("keydown", (e) => { if ((e.key === "Enter" || e.key === " ") && e.target.matches && e.target.matches("polygon.hx")) { e.preventDefault(); onCell(+e.target.getAttribute("data-i")); } });
  }

  const canClick = () => !over && !thinking && (isLinked() ? linkCanMove : mode === "ai" ? current === humanIs : true);
  function render() {
    boardEl.dataset.turn = current === RED ? "r" : "b";
    const win = chain ? new Set(chain) : null;
    const last = isLinked() ? lastIdx : (history.length ? history[history.length - 1].i : null);
    const live = canClick();
    for (let i = 0; i < CELLS; i++) {
      const el = cellEls[i], v = grid[i];
      el.setAttribute("class", "hx" + (v === RED ? " r" : v === BLUE ? " b" : (live ? " open" : "")) + (win && win.has(i) ? " win" : "") + (last === i ? " last" : ""));
      if (!v && live) el.setAttribute("tabindex", "0"); else el.removeAttribute("tabindex");
    }
    undoBtn.disabled = isLinked() || history.length === 0 || thinking;
  }

  // ---------- the computer ----------
  // Score a position by how far each side still is from connecting: the fewest
  // empty cells it would have to fill (own stones are free, the opponent's
  // block). Bigger "their distance minus mine" is better. Easy plays loosely,
  // medium takes the best point, hard also considers the opponent's best reply.
  const INF = 1000;
  function dist(g, p) {
    const d = new Int16Array(CELLS).fill(INF);
    const dq = new Int16Array(CELLS * 4); let head = CELLS * 2, tail = CELLS * 2;
    const cost = (i) => (g[i] === p ? 0 : g[i] === 0 ? 1 : INF);
    for (let k = 0; k < SIZE; k++) { const i = p === RED ? k : k * SIZE; const w = cost(i); if (w < INF) { d[i] = w; if (w === 0) dq[--head] = i; else dq[tail++] = i; } }
    while (head < tail) {
      const i = dq[head++], r = (i / SIZE) | 0, c = i % SIZE;
      for (const [dr, dc] of NEIGH) {
        const rr = r + dr, cc = c + dc;
        if (rr < 0 || rr >= SIZE || cc < 0 || cc >= SIZE) continue;
        const j = rr * SIZE + cc, w = cost(j);
        if (w >= INF) continue;
        const nd = d[i] + w;
        if (nd < d[j]) { d[j] = nd; if (w === 0) dq[--head] = j; else dq[tail++] = j; }
      }
    }
    let best = INF;
    for (let k = 0; k < SIZE; k++) { const i = p === RED ? (SIZE - 1) * SIZE + k : k * SIZE + SIZE - 1; if (d[i] < best) best = d[i]; }
    return best;
  }
  const evalFor = (g, me) => dist(g, other(me)) - dist(g, me);
  function candidates(g) {
    const set = new Set();
    let any = false;
    for (let i = 0; i < CELLS; i++) {
      if (!g[i]) continue;
      any = true;
      const r = (i / SIZE) | 0, c = i % SIZE;
      for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
        const rr = r + dr, cc = c + dc;
        if (rr >= 0 && rr < SIZE && cc >= 0 && cc < SIZE && !g[rr * SIZE + cc]) set.add(rr * SIZE + cc);
      }
    }
    if (!any) return [Math.floor(CELLS / 2)];
    return Array.from(set);
  }
  function aiPick(level) {
    const g = Uint8Array.from(grid), me = current;
    const cand = candidates(g);
    const centre = (i) => -(Math.abs(((i / SIZE) | 0) - 5) + Math.abs((i % SIZE) - 5)) * 0.02;
    const scored = cand.map((i) => { g[i] = me; const s = evalFor(g, me) + centre(i); g[i] = 0; return { i, s }; });
    scored.sort((a, b) => b.s - a.s);
    if (level === "easy") {
      if (Math.random() < 0.3) return cand[Math.floor(Math.random() * cand.length)];
      return scored[Math.floor(Math.random() * Math.min(6, scored.length))].i;
    }
    if (level === "medium") return scored[Math.random() < 0.15 && scored.length > 1 ? 1 : 0].i;
    // hard: for the best few moves, assume the opponent answers with its best reply
    let best = null;
    for (const { i, s } of scored.slice(0, 10)) {
      g[i] = me;
      if (winningChain(g, me)) { g[i] = 0; return i; }
      let worst = Infinity;
      for (const j of candidates(g)) { g[j] = other(me); const v = evalFor(g, me); g[j] = 0; if (v < worst) worst = v; }
      g[i] = 0;
      const v = worst + s * 0.1;
      if (best === null || v > best.v) best = { i, v };
    }
    return best.i;
  }
  function cancelAI() { if (aiTimer !== null) { clearTimeout(aiTimer); aiTimer = null; } thinking = false; }

  // ---------- playing (computer and same-device modes) ----------
  function place(i, p) {
    grid[i] = p; history.push({ i, p });
    const w = winningChain(grid, p);
    if (w) { chain = w; over = true; return { status: "won", winner: p }; }
    current = other(p);
    return { status: "in_progress", winner: null };
  }
  function onCell(i) {
    if (grid[i] || over) return;
    if (isLinked()) { if (!linkCanMove) return; return playLink(i); }
    if (thinking || (mode === "ai" && current !== humanIs)) return;
    afterMove(place(i, current));
  }
  function afterMove(res) {
    if (res.status !== "in_progress") return finish(res);
    if (mode === "ai" && current !== humanIs) {
      thinking = true;
      Gamekit.turn(current, "Computer thinking…", true);
      statusEl.textContent = "Computer thinking…";
      render();
      aiTimer = setTimeout(() => { aiTimer = null; thinking = false; if (!over) afterMove(place(aiPick(diff), current)); }, 350);
      return;
    }
    showTurn(); render();
  }
  function showTurn() {
    if (mode === "ai") { Gamekit.turn(humanIs, "Your move · you're " + NAMES[humanIs]); statusEl.textContent = "Your move."; }
    else { Gamekit.turn(current, NAMES[current] + "'s move"); statusEl.textContent = NAMES[current] + "'s move."; }
  }
  function finish(res) {
    cancelAI(); Gamekit.turn(null);
    if (mode === "ai") statusEl.textContent = res.winner === humanIs ? "You win! 🎉 " + Gamekit.taunt("win") : "Computer wins. " + Gamekit.taunt("loss");
    else statusEl.textContent = `${NAMES[res.winner]} wins. ${NAMES[other(res.winner)]} — ${Gamekit.taunt("loss")}`;
    render();
  }
  function newLocal() {
    cancelAI();
    grid = new Uint8Array(CELLS); history = []; over = false; chain = null; current = RED;
    humanIs = sideSel.value === "2" ? BLUE : RED;
    if (mode === "ai" && humanIs === BLUE) return afterMove({ status: "in_progress" });
    showTurn(); render();
  }
  function undo() {
    if (isLinked() || !history.length) return;
    cancelAI(); over = false; chain = null;
    do { const m = history.pop(); grid[m.i] = 0; current = m.p; } while (history.length && mode === "ai" && current !== humanIs);
    showTurn(); render();
  }

  // ---------- 2 players over WhatsApp, and live online ----------
  const gridToStr = () => Array.from(grid).join("");
  function validateHex(s) {
    const b = s.board;
    if (typeof b !== "string" || b.length !== CELLS || !/^[012]+$/.test(b)) return false;
    const stones = b.length - b.replace(/[12]/g, "").length;
    if (stones !== s.moveCount && !(s.resigned && stones === s.moveCount - 1)) return false;
    return Number.isInteger(s.last) && s.last >= 0 && s.last < CELLS && b[s.last] !== "0";
  }
  const shared = {
    game: "hex", version: 1, players: [RED, BLUE], label: (p) => NAMES[p],
    ui: document.getElementById("wa-ui"), statusEl: statusEl, validateBoard: validateHex, onState: loadLink,
  };
  const link = AsyncShare.start(Object.assign({ title: "hex" }, shared));
  const live = typeof LiveShare === "undefined" ? null : LiveShare.start(shared);
  const activeLink = () => (mode === "live" && live ? live : link);

  function loadLink(s, canMove) {
    cancelAI();
    grid = s ? Uint8Array.from(s.board, Number) : new Uint8Array(CELLS);
    current = s ? s.turn : RED; lastIdx = s ? s.last : null; history = [];
    over = !!s && s.status !== "in_progress";
    chain = over && s.status === "won" && !s.resigned ? winningChain(grid, s.winner) : null;
    linkCanMove = canMove;
    render();
  }
  function playLink(i) {
    const p = current;
    grid[i] = p;
    const w = winningChain(grid, p);
    activeLink().commit({ board: gridToStr(), status: w ? "won" : "in_progress", winner: w ? p : null, last: i });
  }

  // ---------- modes and controls ----------
  function applyMode() {
    chipsEl.hidden = mode !== "ai"; sideSel.hidden = mode !== "ai";
    resetBtn.hidden = isLinked(); undoBtn.hidden = isLinked();
    if (mode === "whatsapp") { if (live) live.hide(); link.show(); }
    else if (mode === "live" && live) { link.hide(); live.show(); }
    else { link.hide(); if (live) live.hide(); newLocal(); }
  }
  const chips = Gamekit.wireDifficultyChips({
    el: chipsEl, difficulties: ["easy", "medium", "hard"], initial: diff, storage: store, storageKey: "diff",
    onChange: (d) => { diff = d; if (mode === "ai") newLocal(); },
  });
  diff = chips.get();
  modeSel.addEventListener("change", () => { mode = modeSel.value; if (mode !== "live") store.set("mode", mode); applyMode(); });
  sideSel.addEventListener("change", () => { store.set("side", sideSel.value); if (mode === "ai") newLocal(); });
  resetBtn.addEventListener("click", () => (isLinked() ? activeLink().newGame() : newLocal()));
  undoBtn.addEventListener("click", undo);

  buildBoard();
  if (live) LiveShare.enable(modeSel, "hex", invited);
  applyMode();

  const resumer = Gamekit.resume("hex", () => (isLinked() || over || !history.length) ? null : {
    mode: mode, h: history.map((m) => [m.i, m.p]), human: humanIs,
  }, (s) => {
    if ((s.mode !== "ai" && s.mode !== "local") || !Array.isArray(s.h)) return false;
    mode = s.mode; modeSel.value = mode; applyMode(); cancelAI();
    humanIs = s.human === BLUE ? BLUE : RED; sideSel.value = humanIs === BLUE ? "2" : "1";
    grid = new Uint8Array(CELLS); history = []; over = false; chain = null; current = RED;
    for (const [i, p] of s.h) {
      if (!Number.isInteger(i) || i < 0 || i >= CELLS || grid[i] || p !== current) { newLocal(); return false; }
      place(i, p);
      if (over) { newLocal(); return false; }
    }
    if (mode === "ai" && current !== humanIs) afterMove({ status: "in_progress" }); else { showTurn(); render(); }
    return true;
  });
  if (!params.has("s") && !invited) resumer.restore();
  window.addEventListener("load", () => Manpage.autoOpen("hex"));
})();
