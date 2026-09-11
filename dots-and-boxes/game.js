(function () {
  "use strict";

  const DOTS = 5;                 // 5x5 dots -> 4x4 boxes
  const BOXES = DOTS - 1;         // 4
  const H_COUNT = DOTS * BOXES;   // 20 horizontal edges
  const V_COUNT = BOXES * DOTS;   // 20 vertical edges
  const EDGE_COUNT = H_COUNT + V_COUNT; // 40
  const BOX_COUNT = BOXES * BOXES;      // 16
  const P1 = 1, P2 = 2;
  const NAMES = { [P1]: "Player 1", [P2]: "Player 2" };

  const boardEl = document.getElementById("board");
  const statusEl = document.getElementById("status");
  const scoreEl = document.getElementById("score");
  const modeSel = document.getElementById("mode");
  const resetBtn = document.getElementById("reset-btn");

  const hIdx = (r, c) => r * BOXES + c;                 // r: 0..DOTS-1, c: 0..BOXES-1
  const vIdx = (r, c) => H_COUNT + r * DOTS + c;         // r: 0..BOXES-1, c: 0..DOTS-1
  const boxIdx = (r, c) => r * BOXES + c;                // r,c: 0..BOXES-1
  const other = (p) => p === P1 ? P2 : P1;

  function boxEdgeIdxs(r, c) { return [hIdx(r, c), hIdx(r + 1, c), vIdx(r, c), vIdx(r, c + 1)]; }
  function boxesTouchingH(r, c) { const out = []; if (r - 1 >= 0) out.push(boxIdx(r - 1, c)); if (r < BOXES) out.push(boxIdx(r, c)); return out; }
  function boxesTouchingV(r, c) { const out = []; if (c - 1 >= 0) out.push(boxIdx(r, c - 1)); if (c < BOXES) out.push(boxIdx(r, c)); return out; }
  function boxComplete(edges, r, c) { return boxEdgeIdxs(r, c).every(i => edges[i] === 1); }

  function newEdges() { return new Array(EDGE_COUNT).fill(0); }
  function newBoxes() { return new Array(BOX_COUNT).fill(0); }

  // Draws one edge; claims any box(es) it completes for `player`. Returns
  // how many boxes were just claimed (0, 1, or 2 — an edge borders at most
  // two boxes) so the caller can decide whether the same player goes again.
  function drawEdge(edges, boxes, kind, r, c, player) {
    const ei = kind === "h" ? hIdx(r, c) : vIdx(r, c);
    if (edges[ei]) return 0;
    edges[ei] = 1;
    const touching = kind === "h" ? boxesTouchingH(r, c) : boxesTouchingV(r, c);
    let claimed = 0;
    for (const bi of touching) {
      const br = Math.floor(bi / BOXES), bc = bi % BOXES;
      if (boxes[bi] === 0 && boxComplete(edges, br, bc)) { boxes[bi] = player; claimed++; }
    }
    return claimed;
  }

  function counts(boxes) {
    let p1 = 0, p2 = 0;
    boxes.forEach(v => { if (v === P1) p1++; else if (v === P2) p2++; });
    return { [P1]: p1, [P2]: p2 };
  }

  const GRID = 2 * DOTS - 1; // 9: interleaved dot/edge/box grid
  function cellType(R, C) { return (R % 2 === 0) ? (C % 2 === 0 ? "dot" : "h") : (C % 2 === 0 ? "v" : "box"); }

  function renderBoard(edges, boxes, canClick, onEdge, lastEdge) {
    boardEl.innerHTML = "";
    for (let R = 0; R < GRID; R++) for (let C = 0; C < GRID; C++) {
      const type = cellType(R, C);
      const cell = document.createElement("div");
      if (type === "dot") {
        cell.className = "db-cell db-dotcell";
        const dot = document.createElement("span"); dot.className = "db-dot"; cell.appendChild(dot);
      } else if (type === "h") {
        const r = R / 2, c = (C - 1) / 2, ei = hIdx(r, c);
        cell.className = "db-cell db-hcell";
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "db-edge db-h" + (edges[ei] ? " drawn" : "") + (ei === lastEdge ? " last" : "");
        btn.disabled = !!edges[ei] || !canClick;
        btn.setAttribute("aria-label", "Horizontal edge row " + r + " col " + c);
        btn.addEventListener("click", () => onEdge("h", r, c));
        cell.appendChild(btn);
      } else if (type === "v") {
        const r = (R - 1) / 2, c = C / 2, ei = vIdx(r, c);
        cell.className = "db-cell db-vcell";
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "db-edge db-v" + (edges[ei] ? " drawn" : "") + (ei === lastEdge ? " last" : "");
        btn.disabled = !!edges[ei] || !canClick;
        btn.setAttribute("aria-label", "Vertical edge row " + r + " col " + c);
        btn.addEventListener("click", () => onEdge("v", r, c));
        cell.appendChild(btn);
      } else {
        const r = (R - 1) / 2, c = (C - 1) / 2, bi = boxIdx(r, c);
        cell.className = "db-cell db-boxcell" + (boxes[bi] ? " owned p" + boxes[bi] : "");
      }
      boardEl.appendChild(cell);
    }
    const cnt = counts(boxes);
    scoreEl.textContent = `Player 1: ${cnt[P1]} · Player 2: ${cnt[P2]}`;
  }

  // ---------- 2 players over WhatsApp ----------
  // board: a 56-char string — 40 chars of '0'/'1' (edges, drawn or not) then
  // 16 chars of '0'/'1'/'2' (box owner). Completing a box (or two, since an
  // edge can finish two at once) grants another turn, via async-share's
  // nextTurn support — same mechanism as Reversi's pass.
  const link = AsyncShare.start({
    game: "dots-and-boxes",
    version: 1,
    title: "dots and boxes",
    players: [P1, P2],
    label: (p) => NAMES[p],
    ui: document.getElementById("wa-ui"),
    statusEl: statusEl,
    validateBoard: (s) => {
      const b = s.board;
      if (typeof b !== "string" || b.length !== EDGE_COUNT + BOX_COUNT) return false;
      if (!/^[01]+$/.test(b.slice(0, EDGE_COUNT)) || !/^[012]+$/.test(b.slice(EDGE_COUNT))) return false;
      return Number.isInteger(s.last) && s.last >= 0 && s.last < EDGE_COUNT && b[s.last] === "1";
    },
    onState: loadLink,
    detail: (s) => {
      const boxes = s.board.slice(EDGE_COUNT).split("").map(Number);
      const cnt = counts(boxes);
      return `Final boxes: Player 1 ${cnt[P1]} · Player 2 ${cnt[P2]}.`;
    },
  });

  let waEdges = newEdges(), waBoxes = newBoxes(), waCurrent = P1, waLast = null, waCanMove = false;

  function loadLink(s, canMove) {
    if (s) {
      waEdges = s.board.slice(0, EDGE_COUNT).split("").map(Number);
      waBoxes = s.board.slice(EDGE_COUNT).split("").map(Number);
      waCurrent = s.turn;
      waLast = s.last;
    } else {
      waEdges = newEdges(); waBoxes = newBoxes(); waCurrent = P1; waLast = null;
    }
    waCanMove = canMove;
    renderBoard(waEdges, waBoxes, waCanMove, playLink, waLast);
  }

  function playLink(kind, r, c) {
    if (!waCanMove) return;
    const ei = kind === "h" ? hIdx(r, c) : vIdx(r, c);
    if (waEdges[ei]) return;
    const claimed = drawEdge(waEdges, waBoxes, kind, r, c, waCurrent);
    const moveCountAfter = waEdges.reduce((a, x) => a + x, 0);
    let status = "in_progress", winner = null;
    if (moveCountAfter === EDGE_COUNT) {
      const cnt = counts(waBoxes);
      status = cnt[P1] === cnt[P2] ? "draw" : "won";
      winner = cnt[P1] === cnt[P2] ? null : (cnt[P1] > cnt[P2] ? P1 : P2);
    }
    const nextTurn = claimed > 0 ? waCurrent : other(waCurrent);
    link.commit({
      board: waEdges.join("") + waBoxes.join(""),
      status, winner, last: ei, nextTurn,
    });
  }

  // ---------- 2 players, same device ----------
  let localEdges, localBoxes, localCurrent, localLast, localOver;

  function resetLocal() {
    localEdges = newEdges(); localBoxes = newBoxes(); localCurrent = P1; localLast = null; localOver = false;
    renderLocal();
  }

  function renderLocal() {
    renderBoard(localEdges, localBoxes, !localOver, playLocal, localLast);
    if (localOver) {
      const cnt = counts(localBoxes);
      statusEl.textContent = cnt[P1] === cnt[P2] ? "Draw." : `${NAMES[cnt[P1] > cnt[P2] ? P1 : P2]} wins.`;
    } else {
      statusEl.textContent = `${NAMES[localCurrent]}'s move.`;
    }
  }

  function playLocal(kind, r, c) {
    if (localOver) return;
    const ei = kind === "h" ? hIdx(r, c) : vIdx(r, c);
    if (localEdges[ei]) return;
    const claimed = drawEdge(localEdges, localBoxes, kind, r, c, localCurrent);
    localLast = ei;
    if (localEdges.reduce((a, x) => a + x, 0) === EDGE_COUNT) { localOver = true; renderLocal(); return; }
    if (claimed === 0) localCurrent = other(localCurrent);
    renderLocal();
  }

  function applyMode() {
    const wa = modeSel.value === "whatsapp";
    resetBtn.hidden = wa;
    if (wa) { link.show(); return; }
    link.hide();
    resetLocal();
  }

  resetBtn.addEventListener("click", resetLocal);
  modeSel.addEventListener("change", applyMode);
  applyMode();
  window.addEventListener("load", () => Manpage.autoOpen("dots-and-boxes"));

  window.__dabTest = { hIdx, vIdx, boxIdx, drawEdge, newEdges, newBoxes, EDGE_COUNT, BOX_COUNT, P1, P2 };
})();
