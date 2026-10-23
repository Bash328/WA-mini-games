(function () {
  "use strict";

  const P1 = 1, P2 = 2;
  const N = 10, CELLS = N * N;
  const SHIPS = [
    { name: "Carrier", len: 5 },
    { name: "Battleship", len: 4 },
    { name: "Cruiser", len: 3 },
    { name: "Submarine", len: 3 },
    { name: "Destroyer", len: 2 },
  ];
  const NAMES = { [P1]: "Player 1", [P2]: "Player 2" };
  const other = (p) => p === P1 ? P2 : P1;
  const cellName = (i) => String.fromCharCode(65 + (i % N)) + (Math.floor(i / N) + 1);

  const $ = (id) => document.getElementById(id);
  const statusEl = $("status"), modeSel = $("mode"), resetBtn = $("reset-btn");
  const coverEl = $("bs-cover"), coverText = $("bs-cover-text"), coverBtn = $("bs-cover-btn");
  const boardEl = $("bs-board"), trayEl = $("bs-tray");
  const mainEl = $("bs-main"), subEl = $("bs-sub"), subWrap = $("bs-sub-wrap");
  const mainTitle = $("bs-main-title"), subTitle = $("bs-sub-title");
  const noteEl = $("bs-note"), hintEl = $("bs-hint");
  const placeActions = $("bs-place-actions"), fireActions = $("bs-fire-actions");
  const rotateBtn = $("bs-rotate"), randomBtn = $("bs-random"), clearBtn = $("bs-clear"), readyBtn = $("bs-ready");
  const fireBtn = $("bs-fire"), endBtn = $("bs-end"), capEl = $("bs-cap");

  /* ---------- Rules ---------- */
  // A placement is { r, c, o } (top-left cell + "h" across / "v" down).
  // A fleet is one placement per entry of SHIPS, in the same order.

  function shipCells(len, p) {
    const out = [];
    for (let k = 0; k < len; k++) out.push((p.r + (p.o === "v" ? k : 0)) * N + p.c + (p.o === "h" ? k : 0));
    return out;
  }
  function fits(len, p) {
    if (!p || p.r < 0 || p.c < 0 || p.r >= N || p.c >= N || (p.o !== "h" && p.o !== "v")) return false;
    return p.o === "h" ? p.c + len <= N : p.r + len <= N;
  }
  function validFleet(f) {
    if (!Array.isArray(f) || f.length !== SHIPS.length) return false;
    const used = new Set();
    for (let k = 0; k < SHIPS.length; k++) {
      if (!fits(SHIPS[k].len, f[k])) return false;
      for (const c of shipCells(SHIPS[k].len, f[k])) {
        if (used.has(c)) return false;
        used.add(c);
      }
    }
    return true;
  }
  // wire form: 5 ships x (2-digit start cell + h|v) = 15 chars
  const fleetToStr = (f) => f.map(p => String(p.r * N + p.c).padStart(2, "0") + p.o).join("");
  function strToFleet(s) {
    if (typeof s !== "string" || !/^(?:\d\dh|\d\dv){5}$/.test(s)) return null;
    const f = [];
    for (let k = 0; k < SHIPS.length; k++) {
      const idx = parseInt(s.slice(k * 3, k * 3 + 2), 10);
      f.push({ r: Math.floor(idx / N), c: idx % N, o: s[k * 3 + 2] });
    }
    return validFleet(f) ? f : null;
  }
  // shots: each cell as 2 digits, in firing order, no repeats
  const shotsToStr = (a) => a.map(c => String(c).padStart(2, "0")).join("");
  function strToShots(s) {
    if (typeof s !== "string" || !/^(?:\d\d)*$/.test(s)) return null;
    const out = [];
    for (let i = 0; i < s.length; i += 2) out.push(parseInt(s.slice(i, i + 2), 10));
    return new Set(out).size === out.length ? out : null;
  }

  function ownerMap(fleet) {
    const m = new Array(CELLS).fill(-1);
    fleet.forEach((p, k) => shipCells(SHIPS[k].len, p).forEach(c => { m[c] = k; }));
    return m;
  }
  const shipSunk = (fleet, k, shotSet) => shipCells(SHIPS[k].len, fleet[k]).every(c => shotSet.has(c));
  function allSunk(fleet, shots) {
    if (!fleet) return false;
    const set = new Set(shots);
    return fleet.every((_, k) => shipSunk(fleet, k, set));
  }
  // What shooting `cell` did, given the shots already fired before it.
  function shotResult(fleet, before, cell) {
    const k = ownerMap(fleet)[cell];
    if (k < 0) return { hit: false };
    const set = new Set(before);
    set.add(cell);
    return { hit: true, ship: SHIPS[k].name, sunk: shipSunk(fleet, k, set) };
  }
  function resText(res, mine) {
    if (!res.hit) return "miss";
    if (!res.sunk) return "hit!";
    return mine ? "hit! You sank their " + res.ship + "." : "hit! Your " + res.ship + " is sunk.";
  }

  function randomFleet() {
    for (;;) {
      const f = [], used = new Set();
      let ok = true;
      for (let k = 0; k < SHIPS.length && ok; k++) {
        const len = SHIPS[k].len;
        let placed = false;
        for (let t = 0; t < 100 && !placed; t++) {
          const o = Math.random() < 0.5 ? "h" : "v";
          const r = Math.floor(Math.random() * (o === "v" ? N - len + 1 : N));
          const c = Math.floor(Math.random() * (o === "h" ? N - len + 1 : N));
          const p = { r: r, c: c, o: o };
          const cs = shipCells(len, p);
          if (cs.some(x => used.has(x))) continue;
          cs.forEach(x => used.add(x));
          f.push(p);
          placed = true;
        }
        if (!placed) ok = false;
      }
      if (ok) return f;
    }
  }

  // The bot's shot: finish off ships it has already hit (staying in
  // line once it has two hits), otherwise sweep a checkerboard, since the
  // smallest ship is two cells long.
  function aiPick(humanFleet, shots) {
    const set = new Set(shots);
    const own = ownerMap(humanFleet);
    const open = shots.filter(c => own[c] >= 0 && !shipSunk(humanFleet, own[c], set));
    const free = (r, c) => r >= 0 && r < N && c >= 0 && c < N && !set.has(r * N + c);
    let cand = [];
    if (open.length) {
      const sameRow = open.length > 1 && open.every(c => Math.floor(c / N) === Math.floor(open[0] / N));
      const sameCol = open.length > 1 && open.every(c => c % N === open[0] % N);
      const dirs = sameRow ? [[0, 1], [0, -1]] : sameCol ? [[1, 0], [-1, 0]] : [[0, 1], [0, -1], [1, 0], [-1, 0]];
      const around = (ds) => {
        const out = new Set();
        open.forEach(c => ds.forEach(d => {
          const r = Math.floor(c / N) + d[0], cc = c % N + d[1];
          if (free(r, cc)) out.add(r * N + cc);
        }));
        return Array.from(out);
      };
      cand = around(dirs);
      if (!cand.length) cand = around([[0, 1], [0, -1], [1, 0], [-1, 0]]);
    }
    if (!cand.length) {
      const all = [];
      for (let i = 0; i < CELLS; i++) if (!set.has(i)) all.push(i);
      const parity = all.filter(i => (Math.floor(i / N) + i % N) % 2 === 0);
      cand = parity.length ? parity : all;
    }
    return cand[Math.floor(Math.random() * cand.length)];
  }

  /* ---------- Grids ---------- */

  // the big grid is the enemy's waters (blue) or your own fleet (orange): the title says which
  (function () {
    const t = document.getElementById("bs-main-title"), m = document.getElementById("bs-main");
    if (!t || !m || typeof MutationObserver === "undefined") return;
    const sync = () => { m.dataset.who = /enemy/i.test(t.textContent) ? "enemy" : "mine"; };
    new MutationObserver(sync).observe(t, { childList: true, characterData: true, subtree: true });
    sync();
    const sub = document.getElementById("bs-sub"); if (sub) sub.dataset.who = "mine";
  })();

  /* ---------- Ship pictures ---------- */
  // A flat grey hull with portholes, one per ship; stretched to the ship's cells (or a small row icon).
  const SLUG = ["carrier", "battleship", "cruiser", "submarine", "destroyer"];     // the order of SHIPS
  // the picture of ship k, cut out of the reference screenshots (red for yours, blue for the enemy's strip)
  const shipArt = (k, blue) => '<img class="bs-svg" src="ships/' + SLUG[k] + (blue ? "-blue" : "") + '.png" alt="" draggable="false">';
  const STRIP_ORDER = [0, 1, 3, 2, 4];       // carrier, battleship, submarine, cruiser, destroyer: the reference's order
  const STRIP_W = [82, 66, 50, 49, 30];      // css px, from the reference
  // Lay a fleet (array of placements, nulls skipped) over a grid as pictures. `live`: they can be dragged (placement).
  function drawHulls(el, fleet, live, extra) {
    el.querySelectorAll(".bs-hull").forEach((h) => h.remove());
    if (!fleet) return;
    fleet.forEach((p, k) => {
      if (!p) return;
      const cs = shipCells(SHIPS[k].len, p), a = el.children[cs[0]], z = el.children[cs[cs.length - 1]];
      const x = a.offsetLeft, y = a.offsetTop, w = z.offsetLeft + z.offsetWidth - x, h = z.offsetTop + z.offsetHeight - y;
      const d = document.createElement("div");
      d.className = "bs-hull" + (live ? " live" : "") + (extra ? " " + extra : "");
      d.dataset.k = String(k);
      d.innerHTML = shipArt(k);
      d.style.cssText = p.o === "h"
        ? "left:" + x + "px;top:" + y + "px;width:" + w + "px;height:" + h + "px"
        : "left:" + (x + w) + "px;top:" + y + "px;width:" + h + "px;height:" + w + "px;transform:rotate(90deg);transform-origin:0 0";
      el.appendChild(d);
    });
  }
  // The two fleet rows between the grids: a small picture per ship, crossed out once sunk.
  const fleetsEl = $("bs-fleets"), midEl = $("bs-mid"), scoreEl = $("bs-score");
  function drawFleetRows(v) {
    const row = (cls, fleet, shots) => {
      const set = new Set(shots), blue = cls === "foe";
      return '<div class="row ' + cls + '">' + STRIP_ORDER.map((k) =>
        '<span class="bs-mini' + (fleet && shipSunk(fleet, k, set) ? " sunk" : "") + '" style="width:' + STRIP_W[STRIP_ORDER.indexOf(k)] + 'px" title="' + SHIPS[k].name + '">' + shipArt(k, blue) + "</span>").join("") + "</div>";
    };
    fleetsEl.innerHTML = row("foe", v.enemyFleet, v.myShots) + row("me", v.myFleet, v.theirShots);
    // the tab on the left: how many of their ships you have sunk (blue) and of yours they have (red)
    const sunk = (fleet, shots) => { const set = new Set(shots); return fleet ? fleet.filter((_, k) => shipSunk(fleet, k, set)).length : 0; };
    scoreEl.innerHTML = '<b class="foe">' + sunk(v.enemyFleet, v.myShots) + '</b><i></i><b class="me">' + sunk(v.myFleet, v.theirShots) + "</b>";
  }

  function buildGrid(el) {
    el.replaceChildren();
    for (let i = 0; i < CELLS; i++) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "bs-cell";
      b.dataset.i = String(i);
      b.setAttribute("aria-label", cellName(i));
      el.appendChild(b);
    }
  }
  function paintGrid(el, fn) {
    for (let i = 0; i < CELLS; i++) {
      const r = fn(i);
      const b = el.children[i];
      b.className = "bs-cell" + (r.cls ? " " + r.cls : "");
      b.textContent = r.text || "";
    }
  }
  // A fleet with the shots fired at it. Ships are shown: only ever called
  // for your own water, or for both fleets once the game is over.
  function paintFleet(el, fleet, shots, last) {
    const own = fleet ? ownerMap(fleet) : null;
    const set = new Set(shots);
    paintGrid(el, (i) => {
      const k = own ? own[i] : -1;
      const cls = [];
      let text = "";
      if (k >= 0) cls.push("ship");
      if (set.has(i)) {
        if (k >= 0) { cls.push(shipSunk(fleet, k, set) ? "sunk" : "hit"); }
        else { cls.push("miss"); text = "✕"; }
      }
      if (i === last) cls.push("last");
      return { cls: cls.join(" "), text: text };
    });
    drawHulls(el, fleet, false);
  }
  // The enemy's water: only the results of your own shots are visible.
  function paintWaters(el, fleet, shots, sel, last) {
    const own = fleet ? ownerMap(fleet) : null;
    const set = new Set(shots);
    paintGrid(el, (i) => {
      const cls = [];
      let text = "";
      if (set.has(i)) {
        const k = own ? own[i] : -1;
        if (k >= 0) { cls.push(shipSunk(fleet, k, set) ? "sunk" : "hit"); }
        else { cls.push("miss"); text = "✕"; }
      }
      if (i === sel) cls.push("sel");
      if (i === last) cls.push("last");
      return { cls: cls.join(" "), text: text };
    });
    drawHulls(el, fleet ? fleet.map((p, k) => (p && shipSunk(fleet, k, set)) ? p : null) : null, false, "sunk");
  }

  buildGrid(mainEl);
  buildGrid(subEl);

  /* ---------- View ---------- */
  // Every mode (WhatsApp / computer / same device) reduces to one of these
  // view-models and one set of handlers; draw() knows nothing about modes.
  //   { kind: "none" }
  //   { kind: "cover", text, button }
  //   { kind: "place", note }
  //   { kind: "battle", myFleet, enemyFleet|null, myShots, theirShots,
  //     canFire, handoff, lastMine, lastTheirs, note }
  //   { kind: "over", F:{1,2}, S:{1,2}, note }
  let vm = { kind: "none" };
  let handlers = {};           // { place(fleet), fire(cell), end(), cover() }
  let sel = -1;                // aimed cell on the enemy grid
  let plc = null;              // placement draft { p: [placement|null x5], sel, o }
  let plcNote = "";            // transient placement message ("can't overlap")
  const freshPlc = () => ({ p: SHIPS.map(() => null), sel: 0, o: "h" });

  function placedCells(exceptK) {
    const m = new Map();
    plc.p.forEach((p, k) => {
      if (p && k !== exceptK) shipCells(SHIPS[k].len, p).forEach(c => m.set(c, k));
    });
    return m;
  }

  function drawTray() {
    trayEl.replaceChildren();
    SHIPS.forEach((s, k) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "bs-ship" + (plc.sel === k ? " sel" : "") + (plc.p[k] ? " placed" : "");
      b.innerHTML = '<span class="bs-pic" style="width:' + s.len * 22 + 'px">' + shipArt(k) + "</span>" + s.name;
      b.addEventListener("click", () => {
        if (plc.p[k]) { plc.o = plc.p[k].o; plc.p[k] = null; }
        plc.sel = k;
        plcNote = "";
        draw(vm);
      });
      b.addEventListener("pointerdown", (e) => startDrag(e, k, null));
      trayEl.appendChild(b);
    });
  }

  function drawPlace() {
    const own = placedCells(-1);
    paintGrid(mainEl, (i) => own.has(i) ? { cls: "ship" } : { cls: "" });
    drawHulls(mainEl, plc.p, true);
    drawTray();
    const done = plc.p.every(Boolean);
    readyBtn.disabled = !done;
    rotateBtn.textContent = "Rotate: " + (plc.o === "h" ? "across" : "down");
    noteEl.textContent = plcNote || vm.note || (done
      ? "All ships placed. Lock in your fleet, or drag a ship to move it, tap it to turn it."
      : "Drag a ship onto the grid, or pick one and tap a square. Tap a placed ship to turn it.");
  }

  function draw(v) {
    vm = v;
    boardEl.dataset.phase = v.kind === "place" ? "place" : v.kind === "battle" ? "battle" : "over";
    coverEl.hidden = v.kind !== "cover";
    boardEl.hidden = v.kind === "cover" || v.kind === "none";
    placeActions.hidden = true;
    fireActions.hidden = true;
    trayEl.hidden = true;
    midEl.hidden = true;
    fireBtn.hidden = true;
    if (v.kind !== "battle") fireBtn.classList.remove("away", "settled");
    document.body.classList.toggle("bs-battle", v.kind === "battle");
    subWrap.hidden = true;
    mainEl.classList.remove("clickable");
    if (v.kind === "cover") {
      coverText.textContent = v.text;
      coverBtn.textContent = v.button;
      return;
    }
    if (v.kind === "none") return;

    if (v.kind === "place") {
      if (!plc) plc = freshPlc();
      mainTitle.textContent = "Your fleet";
      trayEl.hidden = false;
      placeActions.hidden = false;
      mainEl.classList.add("clickable");
      hintEl.textContent = "";
      drawPlace();
      return;
    }
    plc = null;
    plcNote = "";

    if (v.kind === "battle") {
      mainTitle.textContent = "Enemy waters";
      subTitle.textContent = "Your fleet";
      subWrap.hidden = false;
      subWrap.classList.add("small");
      paintWaters(mainEl, v.enemyFleet, v.myShots, v.canFire ? sel : -1, v.lastMine);
      paintFleet(subEl, v.myFleet, v.theirShots, v.lastTheirs);
      mainEl.classList.toggle("clickable", v.canFire);
      midEl.hidden = false;
      drawFleetRows(v);
      noteEl.textContent = v.note || "";
      fireBtn.hidden = !!v.handoff;                      // on a shared device the End turn button replaces it
      setCannon(v.canFire);
      fireBtn.disabled = !v.canFire || sel < 0 || firing;
      capEl.textContent = "FIRE";
      fireBtn.classList.toggle("armed", v.canFire && sel >= 0);
      fireActions.hidden = !v.handoff;
      endBtn.hidden = !v.handoff;
      hintEl.textContent = "";
      return;
    }

    // game over: both fleets revealed
    mainTitle.textContent = NAMES[P1] + "'s fleet";
    subTitle.textContent = NAMES[P2] + "'s fleet";
    subWrap.hidden = false;
    subWrap.classList.remove("small");
    paintFleet(mainEl, v.F[P1], v.S[P2], -1);
    paintFleet(subEl, v.F[P2], v.S[P1], -1);
    noteEl.textContent = v.note || "";
    hintEl.textContent = "";
  }

  /* ---------- Interaction ---------- */

  mainEl.addEventListener("click", (e) => {
    const b = e.target.closest(".bs-cell");
    if (!b || !mainEl.contains(b)) return;
    const i = parseInt(b.dataset.i, 10);
    if (vm.kind === "place") placeClick(i);
    else if (vm.kind === "battle" && vm.canFire && !vm.handoff && !vm.myShots.includes(i)) {
      sel = i;
      draw(vm);
    }
  });


  /* ---------- Dragging ships (placement) ---------- */
  // Drag a ship from the tray (or a placed one) onto the grid; tap a placed ship to turn it.
  let drag = null;
  function dragTarget(e) {                       // the ship's top-left cell under the pointer, clamped, and whether it is free
    const c = document.elementFromPoint(e.clientX, e.clientY), cell = c && c.closest && c.closest(".bs-cell");
    if (!cell || !mainEl.contains(cell)) return null;
    const i = parseInt(cell.dataset.i, 10), len = SHIPS[drag.k].len;
    let r = Math.floor(i / N) - (drag.o === "v" ? drag.grab : 0), cc = i % N - (drag.o === "h" ? drag.grab : 0);
    r = Math.max(0, Math.min(r, drag.o === "v" ? N - len : N - 1));
    cc = Math.max(0, Math.min(cc, drag.o === "h" ? N - len : N - 1));
    const cand = { r: r, c: cc, o: drag.o }, taken = placedCells(drag.k);
    return { cand: cand, ok: !shipCells(len, cand).some((x) => taken.has(x)) };
  }
  function startDrag(e, k, hull) {
    if (vm.kind !== "place" || !plc || (e.button !== undefined && e.button > 0)) return;
    const p0 = plc.p[k], len = SHIPS[k].len, o = p0 ? p0.o : plc.o;
    let grab = 0;
    if (hull) {
      const r = hull.getBoundingClientRect();
      grab = Math.max(0, Math.min(len - 1, Math.floor((o === "h" ? e.clientX - r.left : e.clientY - r.top) / ((o === "h" ? r.width : r.height) / len))));
    }
    drag = { k: k, o: o, grab: grab, sx: e.clientX, sy: e.clientY, moved: false, hull: hull, ghost: null, tgt: null };
    window.addEventListener("pointermove", onDragMove);
    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", endDrag);
  }
  function onDragMove(e) {
    if (!drag) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 6) return;
    if (!drag.moved) {
      drag.moved = true;
      const cell = mainEl.children[0].getBoundingClientRect(), len = SHIPS[drag.k].len;
      const g = document.createElement("div");
      g.className = "bs-ghost";
      g.innerHTML = shipArt(drag.k);
      drag.cw = cell.width; drag.ch = cell.height;
      if (drag.o === "h") g.style.cssText = "width:" + len * cell.width + "px;height:" + cell.height + "px";
      else g.style.cssText = "width:" + len * cell.height + "px;height:" + cell.width + "px;transform:rotate(90deg);transform-origin:0 0";
      document.body.appendChild(g);
      drag.ghost = g;
      if (drag.hull) drag.hull.classList.add("lift");
    }
    const g = drag.ghost;
    if (drag.o === "h") { g.style.left = e.clientX - (drag.grab + 0.5) * drag.cw + "px"; g.style.top = e.clientY - 0.5 * drag.ch + "px"; }
    else { g.style.left = e.clientX + 0.5 * drag.cw + "px"; g.style.top = e.clientY - (drag.grab + 0.5) * drag.ch + "px"; }
    mainEl.querySelectorAll(".pv-ok, .pv-bad").forEach((c) => c.classList.remove("pv-ok", "pv-bad"));
    drag.tgt = dragTarget(e);
    if (drag.tgt) shipCells(SHIPS[drag.k].len, drag.tgt.cand).forEach((c) => mainEl.children[c].classList.add(drag.tgt.ok ? "pv-ok" : "pv-bad"));
  }
  function endDrag() {
    window.removeEventListener("pointermove", onDragMove);
    window.removeEventListener("pointerup", endDrag);
    window.removeEventListener("pointercancel", endDrag);
    const d = drag;
    drag = null;
    if (!d || !plc) return;
    if (d.ghost) d.ghost.remove();
    mainEl.querySelectorAll(".pv-ok, .pv-bad").forEach((c) => c.classList.remove("pv-ok", "pv-bad"));
    const k = d.k, len = SHIPS[k].len;
    if (!d.moved) {
      if (d.hull) {                              // a tap on a placed ship turns it where it lies
        const p = plc.p[k], o = p.o === "h" ? "v" : "h";
        const cand = { r: Math.min(p.r, o === "v" ? N - len : N - 1), c: Math.min(p.c, o === "h" ? N - len : N - 1), o: o }, taken = placedCells(k);
        if (shipCells(len, cand).some((x) => taken.has(x))) plcNote = "No room to turn it there.";
        else { plc.p[k] = cand; plcNote = ""; }
        draw(vm);
      }
      return;
    }
    if (d.tgt && d.tgt.ok) { plc.p[k] = d.tgt.cand; plcNote = ""; plc.sel = plc.p.findIndex((p) => !p); }
    else if (d.tgt) plcNote = "Ships can't overlap. Try another spot.";
    else if (d.hull) { plc.p[k] = null; plc.sel = k; plcNote = ""; }   // dragged off the grid: back to the tray
    draw(vm);
  }
  mainEl.addEventListener("pointerdown", (e) => { const h = e.target.closest && e.target.closest(".bs-hull.live"); if (h) startDrag(e, parseInt(h.dataset.k, 10), h); });
  window.addEventListener("resize", () => { if (vm.kind !== "none" && vm.kind !== "cover") draw(vm); });

  function placeClick(i) {
    const at = placedCells(-1);
    if (at.has(i)) {                       // pick a placed ship back up
      const k = at.get(i);
      plc.o = plc.p[k].o;
      plc.p[k] = null;
      plc.sel = k;
      plcNote = "";
    } else if (plc.sel >= 0) {
      const k = plc.sel, len = SHIPS[k].len;
      let r = Math.floor(i / N), c = i % N;
      if (plc.o === "h") c = Math.min(c, N - len); else r = Math.min(r, N - len);
      const cand = { r: r, c: c, o: plc.o };
      const taken = placedCells(k);
      if (shipCells(len, cand).some(x => taken.has(x))) {
        plcNote = "Ships can't overlap. Try another spot.";
      } else {
        plc.p[k] = cand;
        plcNote = "";
        const next = plc.p.findIndex(p => !p);
        plc.sel = next;                    // -1 once everything is down
      }
    }
    draw(vm);
  }

  rotateBtn.addEventListener("click", () => {
    if (!plc) return;
    plc.o = plc.o === "h" ? "v" : "h";
    draw(vm);
  });
  randomBtn.addEventListener("click", () => {
    if (!plc) return;
    plc.p = randomFleet();
    plc.sel = -1;
    plcNote = "";
    draw(vm);
  });
  clearBtn.addEventListener("click", () => {
    if (!plc) return;
    plc = freshPlc();
    plcNote = "";
    draw(vm);
  });
  readyBtn.addEventListener("click", () => {
    if (!plc || !plc.p.every(Boolean)) return;
    const fleet = plc.p.map(p => ({ r: p.r, c: p.c, o: p.o }));
    plc = null;
    sel = -1;
    handlers.place(fleet);
  });
  // Fire: the cannon kicks back and a ball flies to the aimed square, then the shot is taken.
  let firing = false;
  // Not your turn: the cannon slides away off the top of the screen (towards the side that is playing) and is out of sight;
  // on your turn it slides back down onto your waters. The first drawing of a battle puts it where it belongs with no slide.
  function setCannon(mine) {
    const away = !mine;
    if (!fireBtn.classList.contains("settled")) {
      fireBtn.classList.add("nomove");
      fireBtn.classList.toggle("away", away);
      void fireBtn.offsetWidth;
      fireBtn.classList.remove("nomove");
      fireBtn.classList.add("settled");
    } else fireBtn.classList.toggle("away", away);
  }
  function shootAnim(cell, hit) {
    const still = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const target = mainEl.children[cell];
    if (still || !target || !target.animate) return Promise.resolve();
    fireBtn.classList.remove("recoil"); void fireBtn.offsetWidth; fireBtn.classList.add("recoil");
    const img = fireBtn.querySelector("img").getBoundingClientRect(), t = target.getBoundingClientRect();
    const ball = document.createElement("div");
    ball.className = "bs-ball";
    document.body.appendChild(ball);
    const x0 = img.left + img.width * 0.52, y0 = img.top + img.height * 0.17, x1 = t.left + t.width / 2, y1 = t.top + t.height / 2;
    const fly = ball.animate([
      { left: x0 + "px", top: y0 + "px", transform: "scale(.8)" },
      { left: (x0 + x1) / 2 + "px", top: (y0 + y1) / 2 - 30 + "px", transform: "scale(1.7)", offset: 0.55 },
      { left: x1 + "px", top: y1 + "px", transform: "scale(.9)" },
    ], { duration: 560, easing: "ease-in" });
    return fly.finished.catch(() => {}).then(() => { ball.remove(); burst(x1, y1, hit); });
  }
  // sparkles and smoke where the ball lands (a splash of smaller white puffs on a miss)
  function burst(x, y, hit) {
    const fx = document.createElement("div");
    fx.className = "bs-fx";
    fx.style.left = x + "px"; fx.style.top = y + "px";
    document.body.appendChild(fx);
    const parts = [];
    for (let i = 0; i < (hit ? 5 : 3); i++) {
      const a = (i / (hit ? 5 : 3)) * Math.PI * 2 + 0.4, d = hit ? 24 : 14, s = document.createElement("span");
      s.className = hit ? "bs-spark" : "bs-puff";
      fx.appendChild(s);
      parts.push(s.animate([{ transform: "translate(0,0) scale(.4)", opacity: 1 }, { transform: "translate(" + Math.cos(a) * d + "px," + Math.sin(a) * d + "px) scale(" + (hit ? 1.3 : 1) + ")", opacity: 0 }], { duration: 520, easing: "ease-out", fill: "forwards" }));
    }
    if (hit) for (let i = 0; i < 3; i++) {
      const p = document.createElement("span");
      p.className = "bs-puff";
      p.style.left = (i - 1) * 12 + "px"; p.style.top = -6 - i * 4 + "px";
      fx.appendChild(p);
      parts.push(p.animate([{ transform: "scale(.5)", opacity: .7 }, { transform: "scale(2) translateY(-14px)", opacity: 0 }], { duration: 700, delay: i * 70, easing: "ease-out", fill: "forwards" }));
    }
    setTimeout(() => fx.remove(), 900);
  }
  const optTab = $("bs-opt-tab");
  if (optTab) optTab.addEventListener("click", (e) => { e.stopPropagation(); document.body.classList.toggle("gk-play"); });
  (function () {
    const menu = document.querySelector(".gk-menu");
    if (!menu || menu.querySelector(".bs-home")) return;
    const home = document.createElement("a");
    home.className = "btn ghost bs-home";
    home.href = "../";
    home.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" width="20" height="20"><path d="M12 3 2 12h3v8h5v-5h4v5h5v-8h3z"/></svg> Home';
    menu.appendChild(home);
  })();
  fireBtn.addEventListener("click", () => {
    if (firing || sel < 0 || vm.kind !== "battle" || !vm.canFire) return;
    const cell = sel;
    firing = true;
    fireBtn.disabled = true;
    const hitNow = !!(vm.enemyFleet && ownerMap(vm.enemyFleet)[cell] >= 0);
    shootAnim(cell, hitNow).then(() => {
      firing = false;
      sel = -1;
      handlers.fire(cell);
    });
  });
  endBtn.addEventListener("click", () => handlers.end());
  coverBtn.addEventListener("click", () => handlers.cover());

  /* ---------- 2 players over WhatsApp ---------- */
  // board = [fleet1, fleet2, shots1, shots2]. Player 1 places (move 1),
  // Player 2 places (move 2), then Player 1 fires first and the turns
  // alternate. Both fleets ride along in the link — the same honor-system
  // tradeoff as Hangman's word — but the page only ever draws the viewer's
  // own fleet, and the opponent's only once the game is over.
  const link = AsyncShare.start({
    game: "battleship",
    version: 1,
    title: "battleship",
    players: [P1, P2],
    label: (p) => NAMES[p],
    ui: $("wa-ui"),
    statusEl: statusEl,
    validateBoard: validateBoard,
    onState: loadLink,
    detail: (s) => {
      const b = s.board;
      return NAMES[P1] + " fired " + b[2].length / 2 + " · " + NAMES[P2] + " fired " + b[3].length / 2 + ".";
    },
  });

  function validateBoard(s) {
    const b = s.board;
    if (!Array.isArray(b) || b.length !== 4 || b.some(x => typeof x !== "string")) return false;
    const f1 = strToFleet(b[0]);
    if (!f1) return false;
    let f2 = null;
    if (b[1] !== "") { f2 = strToFleet(b[1]); if (!f2) return false; }
    const s1 = strToShots(b[2]), s2 = strToShots(b[3]);
    if (!s1 || !s2) return false;
    if (!f2 && (s1.length || s2.length)) return false;
    if (s1.length !== s2.length && s1.length !== s2.length + 1) return false;
    if (!Number.isInteger(s.last) || s.last < -1 || s.last >= CELLS) return false;
    const sunk1 = allSunk(f2, s1), sunk2 = allSunk(f1, s2);   // sunk1: Player 1 has won
    if (sunk1 && sunk2) return false;
    // every move is a fleet placed or a shot fired, so the move count must add up (a resignation adds one)
    if (s.moveCount !== (f2 ? 2 : 1) + s1.length + s2.length + (s.resigned ? 1 : 0)) return false;
    if (s.status === "in_progress") {
      if (sunk1 || sunk2) return false;
      if (!f2) return s.turn === P2 && s.last === -1;
      if (s.turn !== (s1.length === s2.length ? P1 : P2)) return false;
      if (s1.length + s2.length === 0) return s.last === -1;
      const arr = other(s.turn) === P1 ? s1 : s2;
      return arr[arr.length - 1] === s.last;
    }
    if (s.resigned) return !sunk1 && !sunk2;
    return s.winner === P1 ? sunk1 : sunk2;
  }

  let waState = null, waCan = false;

  function loadLink(s, canMove) {
    waState = s;
    waCan = canMove;
    sel = -1;
    handlers = { place: waPlace, fire: waFire };
    draw(waVM());
  }

  function waVM() {
    const s = waState;
    if (!s) return waCan ? { kind: "place", note: "Place your fleet, then send the link to your opponent." } : { kind: "none" };
    const b = s.board;
    const F = { [P1]: strToFleet(b[0]), [P2]: b[1] ? strToFleet(b[1]) : null };
    const S = { [P1]: strToShots(b[2]) || [], [P2]: strToShots(b[3]) || [] };
    if (s.status !== "in_progress") {
      const note = s.resigned
        ? NAMES[other(s.winner)] + " resigned."
        : NAMES[s.winner] + " sank the whole fleet.";
      return { kind: "over", F: F, S: S, note: note };
    }
    const me = waCan ? s.turn : other(s.turn);
    if (!F[me]) return waCan ? { kind: "place", note: "Place your fleet, then send the link back." } : { kind: "none" };
    const foe = other(me);
    const v = {
      kind: "battle", me: me, myFleet: F[me], enemyFleet: F[foe],
      myShots: S[me], theirShots: S[foe],
      canFire: waCan && !!F[P1] && !!F[P2], handoff: false,
      lastMine: -1, lastTheirs: -1, note: "",
    };
    if (!F[foe]) {
      v.note = "Fleet deployed. Waiting for " + NAMES[foe] + " to place theirs.";
    } else if (s.last >= 0) {
      // the previous shot was fired by whoever does NOT have the turn now
      const shooter = other(s.turn);
      const shots = S[shooter];
      const res = shotResult(F[s.turn], shots.slice(0, -1), s.last);
      if (shooter === me) {
        v.lastMine = s.last;
        v.note = "You fired at " + cellName(s.last) + ": " + resText(res, true);
      } else {
        v.lastTheirs = s.last;
        v.note = "Your opponent fired at " + cellName(s.last) + ": " + resText(res, false);
      }
    } else if (v.canFire) {
      v.note = "Both fleets are out. You fire first.";
    } else {
      v.note = "Fleet deployed. " + NAMES[s.turn] + " fires first.";
    }
    return v;
  }

  function waPlace(fleet) {
    const b = waState ? waState.board.slice() : ["", "", "", ""];
    if (!waState) b[0] = fleetToStr(fleet); else b[1] = fleetToStr(fleet);
    link.commit({ board: b, status: "in_progress", winner: null, last: -1 });
  }

  function waFire(cell) {
    if (!waCan || !waState || waState.status !== "in_progress") return;
    const me = waState.turn;
    const b = waState.board.slice();
    const idx = me === P1 ? 2 : 3;
    const shots = strToShots(b[idx]);
    if (!shots || shots.includes(cell) || cell < 0 || cell >= CELLS) return;
    shots.push(cell);
    b[idx] = shotsToStr(shots);
    const won = allSunk(strToFleet(b[me === P1 ? 1 : 0]), shots);
    link.commit({ board: b, status: won ? "won" : "in_progress", winner: won ? me : null, last: cell });
  }

  /* ---------- vs computer / same device ---------- */
  let lo = null;

  function newLocal() {
    sel = -1;
    plc = null;
    lo = {
      vsComputer: modeSel.value === "computer",
      F: { [P1]: null, [P2]: null },
      S: { [P1]: [], [P2]: [] },
      phase: "place", placer: P1, turn: P1,
      cover: null, handoff: false, winner: null,
      report: "", hl: { mine: -1, theirs: -1 }, pending: null,
    };
    handlers = { place: loPlace, fire: loFire, end: loEnd, cover: loCover };
    renderLocal();
  }

  function renderLocal() {
    const L = lo;
    const vsc = L.vsComputer;
    const who = (p) => vsc ? "You" : NAMES[p];
    if (L.phase === "over") {
      const w = L.winner;
      statusEl.textContent = (vsc ? (w === P1 ? "You win! " : "The bot wins. ") : NAMES[w] + " wins! ") +
        Gamekit.taunt(vsc ? (w === P1 ? "win" : "loss") : "win");
      Gamekit.turn(null);
      draw({ kind: "over", F: L.F, S: L.S, note: L.report });
      return;
    }
    if (L.cover) {
      Gamekit.turn(L.cover, "Pass the device to " + NAMES[L.cover], true);
      statusEl.textContent = "Pass the device to " + NAMES[L.cover] + ".";
      draw({
        kind: "cover",
        text: "Pass the device to " + NAMES[L.cover] + ". No peeking at the last screen!",
        button: "I'm " + NAMES[L.cover],
      });
      return;
    }
    if (L.phase === "place") {
      const p = L.placer;
      statusEl.textContent = (vsc ? "Place your fleet." : NAMES[p] + ": place your fleet.");
      Gamekit.turn(p, (vsc ? "You" : NAMES[p]) + " · place your fleet");
      draw({ kind: "place", note: vsc ? "Place your fleet. The bot hides its own." : "" });
      return;
    }
    const me = L.turn, foe = other(me);
    statusEl.textContent = L.thinking ? "Bot thinking…" : L.handoff ? "Shot fired — end your turn." : (vsc ? "Your shot." : NAMES[me] + ": take your shot.");
    if (L.thinking) Gamekit.turn(P2, "Bot thinking…", true);
    else Gamekit.turn(me, who(me) + (L.handoff ? " · end turn" : " · fire"), L.handoff);
    draw({
      kind: "battle", me: me, myFleet: L.F[me], enemyFleet: L.F[foe],
      myShots: L.S[me], theirShots: L.S[foe],
      canFire: !L.handoff && !L.thinking, handoff: L.handoff,
      lastMine: L.hl.mine, lastTheirs: L.hl.theirs, note: L.report,
    });
  }

  function loPlace(fleet) {
    const L = lo;
    L.F[L.placer] = fleet;
    if (L.vsComputer) {
      L.F[P2] = randomFleet();
      L.phase = "battle"; L.turn = P1;
      L.report = "Battle! Pick a square and fire.";
    } else if (L.placer === P1) {
      L.placer = P2;
      L.cover = P2;
    } else {
      L.phase = "battle"; L.turn = P1;
      L.cover = P1;
      L.report = "Both fleets are out. " + NAMES[P1] + " fires first.";
    }
    renderLocal();
  }

  function loFire(cell) {
    const L = lo;
    if (L.phase !== "battle" || L.S[L.turn].includes(cell)) return;
    const me = L.turn, foe = other(me);
    const res = shotResult(L.F[foe], L.S[me], cell);
    L.S[me].push(cell);
    L.hl = { mine: cell, theirs: -1 };
    L.report = "You fired at " + cellName(cell) + ": " + resText(res, true);
    if (allSunk(L.F[foe], L.S[me])) {
      L.phase = "over"; L.winner = me;
      L.report = (L.vsComputer ? (me === P1 ? "You" : "The bot") : NAMES[me]) + " sank the whole fleet.";
    } else if (L.vsComputer) {
      L.thinking = true;                         // your shot is shown, the cannon slides away, and the computer takes a moment
      clearTimeout(L.aiTimer);
      L.aiTimer = setTimeout(() => computerShot(L), 1000 + Math.random() * 400);
    } else {
      L.handoff = true;
      L.pending = { by: me, cell: cell, res: res };
    }
    renderLocal();
  }

  // the computer fires back (called after its pause, or at once when a refresh finds it still owed a shot)
  function computerShot(L) {
    if (lo !== L || !L.thinking || L.phase !== "battle") return;
    L.thinking = false;
    const c = aiPick(L.F[P1], L.S[P2]);
    const r2 = shotResult(L.F[P1], L.S[P2], c);
    L.S[P2].push(c);
    L.hl.theirs = c;
    L.report += " The bot fired at " + cellName(c) + ": " + resText(r2, false);
    if (allSunk(L.F[P1], L.S[P2])) {
      L.phase = "over"; L.winner = P2;
      L.report = "The bot sank your whole fleet.";
    }
    renderLocal();
  }

  // same device: the shooter has seen the result, now hide it before passing on
  function loEnd() {
    const L = lo;
    const p = L.pending;
    L.handoff = false;
    L.turn = other(L.turn);
    L.cover = L.turn;
    L.hl = { mine: -1, theirs: p.cell };
    L.report = NAMES[p.by] + " fired at " + cellName(p.cell) + ": " + resText(p.res, false);
    L.pending = null;
    renderLocal();
  }

  function loCover() {
    lo.cover = null;
    renderLocal();
  }

  /* ---------- Mode switching ---------- */
  function applyMode() {
    const wa = modeSel.value === "whatsapp";
    resetBtn.hidden = wa;
    sel = -1;
    plc = null;
    if (wa) { link.show(); return; }
    link.hide();
    newLocal();
  }

  // The top-bar restart clicks this button even when WhatsApp mode hides it.
  resetBtn.addEventListener("click", () => (modeSel.value === "whatsapp" ? link.newGame() : newLocal()));
  modeSel.addEventListener("change", applyMode);
  applyMode();

  // A refresh keeps a game against the computer or on one device once the battle has started:
  // both fleets and every shot. (A half-finished fleet placement is not kept. Link and online
  // games are not saved here.) On one device the cover screen comes back first, so a refresh
  // never shows one player the other's fleet.
  const resumer = Gamekit.resume("battleship", () => (modeSel.value === "whatsapp" || !lo || lo.phase !== "battle") ? null : {
    vsComputer: lo.vsComputer, F: lo.F, S: lo.S, turn: lo.turn, handoff: lo.handoff, pending: lo.pending, thinking: !!lo.thinking,
  }, (s) => {
    const shotsOk = (a) => Array.isArray(a) && a.length <= CELLS && a.every(v => Number.isInteger(v) && v >= 0 && v < CELLS) && new Set(a).size === a.length;
    if (!s.F || !validFleet(s.F[P1]) || !validFleet(s.F[P2]) || !s.S || !shotsOk(s.S[P1]) || !shotsOk(s.S[P2])) return false;
    if (s.turn !== P1 && s.turn !== P2) return false;
    if (allSunk(s.F[P2], s.S[P1]) || allSunk(s.F[P1], s.S[P2])) return false;
    modeSel.value = s.vsComputer ? "computer" : "local";
    applyMode();                                   // fresh game for that mode (sets the handlers)
    lo.F = { [P1]: s.F[P1], [P2]: s.F[P2] };
    lo.S = { [P1]: s.S[P1].slice(), [P2]: s.S[P2].slice() };
    lo.phase = "battle"; lo.placer = P1; lo.turn = s.turn;
    lo.handoff = !!s.handoff && !s.vsComputer && !!s.pending && Number.isInteger(s.pending.cell);
    lo.pending = lo.handoff ? { by: s.pending.by, cell: s.pending.cell, res: s.pending.res } : null;
    lo.cover = s.vsComputer ? null : lo.turn;      // hide the fleets until the right player takes over
    lo.report = "Welcome back. Pick up where you left off.";
    lo.hl = { mine: -1, theirs: -1 };
    lo.thinking = !!s.thinking && !!s.vsComputer;   // a refresh in the computer's pause: it still owes its shot
    renderLocal();
    if (lo.thinking) computerShot(lo);
    return true;
  });
  if (!/[?&](s|live)=/.test(location.search)) resumer.restore();
  window.addEventListener("load", () => Manpage.autoOpen("battleship"));

  window.__battleshipTest = {
    fleetToStr, strToFleet, shotsToStr, strToShots, validFleet, shipCells,
    randomFleet, aiPick, allSunk, shotResult, ownerMap, SHIPS, draw,
  };
})();
