(function () {
  "use strict";

  // The board size: N boxes a side (3-6), chosen by whoever makes the first
  // move and kept in the game state (the first character of the wire board).
  // setSize() changes every count below at once.
  const SIZES = [3, 4, 5, 6];
  let BOXES, DOTS, H_COUNT, V_COUNT, EDGE_COUNT, BOX_COUNT, GRID;
  function setSize(n) {
    BOXES = n; DOTS = n + 1;
    H_COUNT = DOTS * BOXES;       // horizontal edges
    V_COUNT = BOXES * DOTS;       // vertical edges
    EDGE_COUNT = H_COUNT + V_COUNT;
    BOX_COUNT = BOXES * BOXES;
    GRID = 2 * DOTS - 1;          // interleaved dot/edge/box grid
  }
  const edgeCountOf = (n) => 2 * n * (n + 1);
  setSize(4);
  const P1 = 1, P2 = 2;
  const NAMES = { [P1]: "Player 1", [P2]: "Player 2" };

  const boardEl = document.getElementById("board");
  const statusEl = document.getElementById("status");
  const scoreEl = document.getElementById("score");
  const modeSel = document.getElementById("mode");
  const resetBtn = document.getElementById("reset-btn");
  const sizeSel = document.getElementById("size");
  const store = Gamekit.storage("dots-and-boxes:");

  const hIdx = (r, c) => r * BOXES + c;                 // r: 0..DOTS-1, c: 0..BOXES-1
  const vIdx = (r, c) => H_COUNT + r * DOTS + c;         // r: 0..BOXES-1, c: 0..DOTS-1
  const boxIdx = (r, c) => r * BOXES + c;                // r,c: 0..BOXES-1
  const other = (p) => p === P1 ? P2 : P1;

  function boxEdgeIdxs(r, c) { return [hIdx(r, c), hIdx(r + 1, c), vIdx(r, c), vIdx(r, c + 1)]; }
  function boxesTouchingH(r, c) { const out = []; if (r - 1 >= 0) out.push(boxIdx(r - 1, c)); if (r < BOXES) out.push(boxIdx(r, c)); return out; }
  function boxesTouchingV(r, c) { const out = []; if (c - 1 >= 0) out.push(boxIdx(r, c - 1)); if (c < BOXES) out.push(boxIdx(r, c)); return out; }
  function boxComplete(edges, r, c) { return boxEdgeIdxs(r, c).every(i => edges[i] !== 0); }

  function newEdges() { return new Array(EDGE_COUNT).fill(0); }
  function newBoxes() { return new Array(BOX_COUNT).fill(0); }

  // Draws one edge; claims any box(es) it completes for `player`. Returns
  // how many boxes were just claimed (0, 1, or 2 — an edge borders at most
  // two boxes) so the caller can decide whether the same player goes again.
  function drawEdge(edges, boxes, kind, r, c, player) {
    const ei = kind === "h" ? hIdx(r, c) : vIdx(r, c);
    if (edges[ei]) return 0;
    // 2 = Player 1's line, 3 = Player 2's (1 is a line from a link made before
    // lines had owners: drawn, owner unknown)
    edges[ei] = player + 1;
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

  const edgeClass = (v) => v ? " drawn" + (v > 1 ? " p" + (v - 1) : "") : "";
  const edgesDrawn = (edges) => edges.filter(Boolean).length;
  function cellType(R, C) { return (R % 2 === 0) ? (C % 2 === 0 ? "dot" : "h") : (C % 2 === 0 ? "v" : "box"); }

  function renderBoard(edges, boxes, canClick, onEdge, lastEdge) {
    boardEl.innerHTML = "";
    boardEl.style.gridTemplateColumns = "10px repeat(" + BOXES + ", 1fr 10px)";
    boardEl.style.gridTemplateRows = "10px repeat(" + BOXES + ", 1fr 10px)";
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
        btn.className = "db-edge db-h" + edgeClass(edges[ei]) + (ei === lastEdge ? " last" : "");
        btn.disabled = !!edges[ei] || !canClick;
        btn.setAttribute("aria-label", "Horizontal edge row " + r + " col " + c);
        btn.addEventListener("click", () => onEdge("h", r, c));
        cell.appendChild(btn);
      } else if (type === "v") {
        const r = (R - 1) / 2, c = C / 2, ei = vIdx(r, c);
        cell.className = "db-cell db-vcell";
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "db-edge db-v" + edgeClass(edges[ei]) + (ei === lastEdge ? " last" : "");
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
    scoreEl.innerHTML = `<span class="sc p1">Player 1: ${cnt[P1]}</span> · <span class="sc p2">Player 2: ${cnt[P2]}</span>`;
  }

  // ---------- 2 players over WhatsApp ----------
  // board (version 2): the size N as one digit (3-6), then 2N(N+1) edge chars
  // ('0' undrawn, '1' drawn by an unknown hand, '2' / '3' Player 1's / 2's), then
  // N*N box owners ('0' / '1' / '2'). Completing a box (or two, since an
  // edge can finish two at once) grants another turn, via async-share's
  // nextTurn support — same mechanism as Reversi's pass.
  function validateDab(s) {
    const b = s.board;
    if (typeof b !== "string") return false;
    const n = Number(b[0]);
    if (!SIZES.includes(n)) return false;
    const edges = edgeCountOf(n);
    if (b.length !== 1 + edges + n * n) return false;
    if (!/^[0-3]+$/.test(b.slice(1, 1 + edges)) || !/^[012]+$/.test(b.slice(1 + edges))) return false;
    return Number.isInteger(s.last) && s.last >= 0 && s.last < edges && b[1 + s.last] !== "0";
  }
  function finalBoxes(s) {
    const n = Number(s.board[0]);
    const cnt = counts(s.board.slice(1 + edgeCountOf(n)).split("").map(Number));
    return `Final boxes: Player 1 ${cnt[P1]} · Player 2 ${cnt[P2]}.`;
  }

  const link = AsyncShare.start({
    game: "dots-and-boxes",
    version: 2,
    title: "dots and boxes",
    players: [P1, P2],
    label: (p) => NAMES[p],
    ui: document.getElementById("wa-ui"),
    statusEl: statusEl,
    validateBoard: validateDab,
    onState: loadLink,
    detail: finalBoxes,
  });

  // Live online play: same board and rules, moves go over a WebSocket room.
  const live = typeof LiveShare === "undefined" ? null : LiveShare.start({
    game: "dots-and-boxes",
    version: 2,
    players: [P1, P2],
    label: (p) => NAMES[p],
    ui: document.getElementById("wa-ui"),
    statusEl: statusEl,
    validateBoard: validateDab,
    onState: loadLink,
    detail: finalBoxes,
  });
  const activeLink = () => (modeSel.value === "live" && live ? live : link);

  let waEdges = newEdges(), waBoxes = newBoxes(), waCurrent = P1, waLast = null, waCanMove = false;

  let waStarted = false;
  function loadLink(s, canMove) {
    waStarted = !!s;
    if (s) {
      setSize(Number(s.board[0]));
      waEdges = s.board.slice(1, 1 + EDGE_COUNT).split("").map(Number);
      waBoxes = s.board.slice(1 + EDGE_COUNT).split("").map(Number);
      waCurrent = s.turn;
      waLast = s.last;
      sizeSel.value = String(BOXES);               // a joiner sees the starter's choice
    } else {
      setSize(Number(sizeSel.value));
      waEdges = newEdges(); waBoxes = newBoxes(); waCurrent = P1; waLast = null;
    }
    waCanMove = canMove;
    sizeSel.disabled = waStarted;
    renderBoard(waEdges, waBoxes, waCanMove, playLink, waLast);
  }

  function playLink(kind, r, c) {
    if (!waCanMove) return;
    const ei = kind === "h" ? hIdx(r, c) : vIdx(r, c);
    if (waEdges[ei]) return;
    const claimed = drawEdge(waEdges, waBoxes, kind, r, c, waCurrent);
    const moveCountAfter = edgesDrawn(waEdges);
    let status = "in_progress", winner = null;
    if (moveCountAfter === EDGE_COUNT) {
      const cnt = counts(waBoxes);
      status = cnt[P1] === cnt[P2] ? "draw" : "won";
      winner = cnt[P1] === cnt[P2] ? null : (cnt[P1] > cnt[P2] ? P1 : P2);
    }
    // Completing a box earns another turn, except on the last edge: the game
    // is over, and the turn must pass so the opponent sees the right result.
    const nextTurn = status === "in_progress" && claimed > 0 ? waCurrent : other(waCurrent);
    activeLink().commit({
      board: BOXES + waEdges.join("") + waBoxes.join(""),
      status, winner, last: ei, nextTurn,
    });
  }

  // ---------- 2 players, same device ----------
  let localEdges, localBoxes, localCurrent, localLast, localOver;

  // "You've got this in the bag" / "spoke too soon" - see checkers for the
  // same pattern. Box-count difference (16 boxes total) is this game's
  // own natural lead signal.
  let confidenceGivenTo = null;
  let confidenceNote = "";
  const LEAD_THRESHOLD = 4;

  function checkConfidence() {
    if (confidenceGivenTo !== null || localOver) return;
    const cnt = counts(localBoxes);
    const diff = cnt[P1] - cnt[P2];
    if (Math.abs(diff) < LEAD_THRESHOLD) return;
    confidenceGivenTo = diff > 0 ? P1 : P2;
    confidenceNote = `${NAMES[confidenceGivenTo]} — ${Gamekit.taunt("confidence")} ${NAMES[confidenceGivenTo === P1 ? P2 : P1]} — ${Gamekit.taunt("lastChance")}`;
  }

  function resetLocal() {
    setSize(Number(sizeSel.value));
    sizeSel.disabled = false;
    localEdges = newEdges(); localBoxes = newBoxes(); localCurrent = P1; localLast = null; localOver = false;
    confidenceGivenTo = null; confidenceNote = "";
    renderLocal();
  }

  function renderLocal() {
    renderBoard(localEdges, localBoxes, !localOver, playLocal, localLast);
    Gamekit.turn(localOver ? null : localCurrent, `${NAMES[localCurrent]}'s move`);
    if (localOver) {
      const cnt = counts(localBoxes);
      if (cnt[P1] === cnt[P2]) {
        statusEl.textContent = "Draw. " + Gamekit.taunt("draw");
      } else {
        const winnerColor = cnt[P1] > cnt[P2] ? P1 : P2;
        const loserColor = other(winnerColor);
        const reversed = confidenceGivenTo === loserColor;
        statusEl.textContent = `${NAMES[winnerColor]} wins. ${NAMES[loserColor]} — ${Gamekit.taunt(reversed ? "reversal" : "loss")}`;
      }
    } else {
      const note = confidenceNote; confidenceNote = "";
      statusEl.textContent = `${NAMES[localCurrent]}'s move.` + (note ? " " + note : "");
    }
  }

  function playLocal(kind, r, c) {
    if (localOver) return;
    sizeSel.disabled = true;                       // the size is fixed once play starts
    const ei = kind === "h" ? hIdx(r, c) : vIdx(r, c);
    if (localEdges[ei]) return;
    const claimed = drawEdge(localEdges, localBoxes, kind, r, c, localCurrent);
    localLast = ei;
    if (edgesDrawn(localEdges) === EDGE_COUNT) { localOver = true; renderLocal(); return; }
    if (claimed === 0) localCurrent = other(localCurrent);
    checkConfidence();
    renderLocal();
  }

  function applyMode() {
    const m = modeSel.value;
    resetBtn.hidden = m === "whatsapp" || m === "live";
    if (m === "live" && live) { link.hide(); live.show(); return; }
    if (m === "whatsapp") { if (live) live.hide(); link.show(); return; }
    link.hide();
    if (live) live.hide();
    resetLocal();
  }

  resetBtn.addEventListener("click", resetLocal);
  modeSel.addEventListener("change", applyMode);
  // Choosing a size before the first move: redraw an empty board of that size.
  sizeSel.addEventListener("change", () => {
    store.set("size", sizeSel.value);
    if (modeSel.value === "local") resetLocal();
    else if (!waStarted) loadLink(null, waCanMove);
  });
  // A refresh keeps a same-device game: rebuilt from a saved snapshot.
  // (Link games live in the URL, so they are not saved here.)
  const resumer = Gamekit.resume("dots-and-boxes", () => (modeSel.value !== "local" || localOver || localLast === null) ? null : {
    n: BOXES, edges: localEdges, boxes: localBoxes, current: localCurrent, last: localLast,
  }, (s) => {
    if (!SIZES.includes(s.n)) return false;
    setSize(s.n);
    if (!Array.isArray(s.edges) || s.edges.length !== EDGE_COUNT || !s.edges.every(v => Number.isInteger(v) && v >= 0 && v <= 3)) return false;
    if (!Array.isArray(s.boxes) || s.boxes.length !== BOX_COUNT || !s.boxes.every(v => v === 0 || v === 1 || v === 2)) return false;
    if (s.current !== P1 && s.current !== P2) return false;
    sizeSel.value = String(s.n);
    modeSel.value = "local"; applyMode();
    setSize(s.n); sizeSel.disabled = true;
    localEdges = s.edges.slice(); localBoxes = s.boxes.slice(); localCurrent = s.current;
    localLast = Number.isInteger(s.last) ? s.last : null; localOver = false;
    renderLocal();
    return true;
  });

  // The live option stays hidden until the server says live play is on for
  // this game. A ?live=CODE invite link opens straight into live mode (the
  // way ?s= does for WhatsApp mode); LiveShare explains if it's switched off.
  const liveOpt = modeSel.querySelector('option[value="live"]');
  const invited = new URLSearchParams(location.search).has("live");
  if (live && invited) {
    liveOpt.hidden = false;
    modeSel.value = "live";
  } else if (live) {
    fetch("/api/live/status").then((r) => r.json()).then((st) => {
      if (st.enabled && st.games.indexOf("dots-and-boxes") !== -1) { liveOpt.hidden = false; LiveShare.cta(modeSel); }
    }).catch(() => { /* live play stays hidden */ });
  }
  const savedSize = store.get("size", "4");
  if (SIZES.includes(Number(savedSize))) sizeSel.value = savedSize;
  applyMode();
  if (!/[?&](s|live)=/.test(location.search)) resumer.restore();
  window.addEventListener("load", () => Manpage.autoOpen("dots-and-boxes"));

  window.__dabTest = { hIdx, vIdx, boxIdx, drawEdge, newEdges, newBoxes, setSize, P1, P2 };
})();
