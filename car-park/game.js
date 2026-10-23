/* ============================================================
   car-park/game.js — the Car Park page.

   The board, the moves, the win test and the solver all come from
   rules.js (CarPark). This file draws the cars, takes taps, drags and
   keys, keeps Undo, shows hints, stores the best per level and puts the
   game back after a refresh.

   A car is dragged: it follows the finger along its own row or column,
   stopping where another car or the edge is in the way, and settles on the
   nearest square when you let go. (Tapping a car and then a free square in its
   row or column also slides it there.) One slide, however far, is one move.
   ============================================================ */
(function () {
  "use strict";

  const CP = globalThis.CarPark;
  if (!CP) return;
  const $ = (id) => document.getElementById(id);

  const boardEl = $("board"), innerEl = $("inner"), gridEl = $("grid"), carsEl = $("cars");
  const statusEl = $("status"), noteEl = $("note");
  const levelNumEl = $("level-num"), movesEl = $("moves"), bestEl = $("best");
  const titleEl = document.querySelector(".topbar h1");
  const levelSel = $("level-sel"), newBtn = $("new-btn");
  const undoBtn = $("undo-btn"), hintBtn = $("hint-btn"), resetBtn = $("reset-btn");
  const store = Gamekit.storage("car-park:");

  const COLORS = ["#ff3b30", "#4d8dff", "#ffc233", "#36c96a", "#a66bff", "#ff8a3d", "#2fe3d0", "#ff7ab8", "#9ad64a", "#c58bff", "#5bc0eb", "#d9e2ea"];
  const NAMES = ["red", "blue", "yellow", "green", "purple", "orange", "teal", "pink", "lime", "violet", "sky blue", "silver"];
  const LEVELS = CP.LEVELS;

  let levelIndex = Math.max(0, Math.min(LEVELS.length - 1, store.getInt("level", 0)));
  let level = LEVELS[levelIndex];
  let startCars = CP.carsOf(level);
  let cars = CP.cloneCars(startCars);
  let moves = 0;
  let history = [];
  let won = false;
  let selected = -1;
  let hintMove = null;
  let hintTimer = 0;
  let noteTimer = 0;
  let drag = null;
  let resumer = null;
  const canFocus = (el) => el && el.focus;

  /* ---------- drawing ---------- */

  function buildGrid() {
    const frag = document.createDocumentFragment();
    for (let i = 0; i < CP.SIZE * CP.SIZE; i++) {
      const cell = document.createElement("div");
      cell.className = "cp-cell";
      frag.appendChild(cell);
    }
    gridEl.replaceChildren(frag);
  }

  function buildLevelSelect() {
    const frag = document.createDocumentFragment();
    LEVELS.forEach((l, i) => {
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = "Level " + (i + 1) + " · par " + l.best;
      frag.appendChild(opt);
    });
    levelSel.replaceChildren(frag);
  }

  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  function labelFor(v) {
    const name = NAMES[v.id % NAMES.length];
    if (v.id === CP.RED) return "Red target car, row " + (v.r + 1) + ", columns " + (v.c + 1) + " to " + (v.c + v.len);
    if (v.dir === "h") return cap(name) + " car, row " + (v.r + 1) + ", columns " + (v.c + 1) + " to " + (v.c + v.len);
    return cap(name) + " car, column " + (v.c + 1) + ", rows " + (v.r + 1) + " to " + (v.r + v.len);
  }

  // Place an absolutely-positioned car (or the hint ghost) on its cells.
  function place(el, v) {
    const pct = (n) => (n / CP.SIZE) * 100;
    const w = v.dir === "h" ? v.len : 1;
    const h = v.dir === "h" ? 1 : v.len;
    el.style.left = "calc(" + pct(v.c) + "% + 3px)";
    el.style.top = "calc(" + pct(v.r) + "% + 3px)";
    el.style.width = "calc(" + pct(w) + "% - 6px)";
    el.style.height = "calc(" + pct(h) + "% - 6px)";
  }

  /* ---------- the vehicles: top-down pictures, drawn here so every level can use them ---------- */
  const INK = "#111", GLASS = "#1a1c20";
  const SEDAN = ["#f1f2f4", "#bdd9ee", "#f1f2f4", "#ecd8b2", "#bdd9ee"];
  const svg = (len, inner) => '<svg viewBox="0 0 ' + len * 100 + ' 100" aria-hidden="true" focusable="false">' + inner + '</svg>';
  function sedan(c) {
    const roof = 'color-mix(in srgb, ' + c + ' 86%, #fff)';
    return svg(2, '<rect x="6" y="12" width="188" height="76" rx="34" fill="' + c + '" stroke="' + INK + '" stroke-width="5"/>'
      + '<path d="M134 28C152 32 156 42 156 50C156 58 152 68 134 72Z" fill="' + GLASS + '"/><path d="M64 30C50 34 46 42 46 50C46 58 50 66 64 70Z" fill="' + GLASS + '"/>'
      + '<rect x="64" y="26" width="70" height="48" rx="9" fill="' + roof + '" stroke="' + INK + '" stroke-width="3"/>'
      + '<rect x="70" y="19" width="58" height="8" rx="4" fill="' + GLASS + '"/><rect x="70" y="73" width="58" height="8" rx="4" fill="' + GLASS + '"/>'
      + '<rect x="124" y="3" width="12" height="10" rx="3" fill="' + c + '" stroke="' + INK + '" stroke-width="3"/><rect x="124" y="87" width="12" height="10" rx="3" fill="' + c + '" stroke="' + INK + '" stroke-width="3"/>');
  }
  function truck() {
    return svg(3, '<rect x="6" y="10" width="206" height="80" rx="10" fill="#cdbfa0" stroke="' + INK + '" stroke-width="5"/>'
      + '<path d="M58 22V78M104 22V78M150 22V78" stroke="#a89b7c" stroke-width="5" stroke-linecap="round"/>'
      + '<rect x="212" y="20" width="82" height="60" rx="22" fill="#e4d7ba" stroke="' + INK + '" stroke-width="5"/>'
      + '<rect x="228" y="30" width="30" height="40" rx="6" fill="#d8ccae"/><path d="M262 28C278 32 284 42 284 50C284 58 278 68 262 72Z" fill="' + GLASS + '"/>'
      + '<rect x="246" y="11" width="11" height="9" rx="3" fill="#e4d7ba" stroke="' + INK + '" stroke-width="3"/><rect x="246" y="80" width="11" height="9" rx="3" fill="#e4d7ba" stroke="' + INK + '" stroke-width="3"/>');
  }
  function keyTruck() {
    return svg(2, '<rect x="6" y="10" width="124" height="80" rx="8" fill="#f2424a" stroke="' + INK + '" stroke-width="5"/>'
      + '<path d="M24 32H112M24 50H112M24 68H112" stroke="#cf3039" stroke-width="4" stroke-linecap="round"/>'
      + '<path d="M56 36L82 50L56 64" fill="none" stroke="#cf3039" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>'
      + '<rect x="130" y="20" width="64" height="60" rx="20" fill="#f2424a" stroke="' + INK + '" stroke-width="5"/>'
      + '<rect x="140" y="30" width="22" height="40" rx="6" fill="#d9333b"/><path d="M164 28C178 32 184 42 184 50C184 58 178 68 164 72Z" fill="' + GLASS + '"/>');
  }
  function sprite(v) {
    const w = document.createElement("span");
    w.className = "cp-sprite";
    w.setAttribute("aria-hidden", "true");
    // facing: the red truck always faces the exit; the others face either way, by id, so a lot looks lived in
    const flip = v.id !== CP.RED && v.id % 2 === 1;
    w.style.setProperty("--turn", (v.dir === "v" ? (flip ? -90 : 90) : (flip ? 180 : 0)) + "deg");
    w.innerHTML = v.id === CP.RED ? keyTruck() : v.len === 3 ? truck() : sedan(SEDAN[v.id % SEDAN.length]);
    return w;
  }

  function makeCar(v) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "cp-car";
    b.dataset.id = String(v.id);
    b.style.setProperty("--car", COLORS[v.id % COLORS.length]);
    if (v.id === CP.RED) b.dataset.red = "1";
    if (selected === v.id) { b.dataset.sel = "1"; b.setAttribute("aria-pressed", "true"); }
    else b.setAttribute("aria-pressed", "false");
    if (hintMove && hintMove.id === v.id) b.dataset.hint = "1";
    b.setAttribute("aria-label", labelFor(v));
    b.dataset.dir = v.dir;
    b.appendChild(sprite(v));
    place(b, v);
    return b;
  }

  function makeGhost() {
    if (!hintMove) return null;
    const next = CP.applyMove(cars, hintMove);
    if (!next || !next[hintMove.id]) return null;
    const g = document.createElement("div");
    g.className = "cp-ghost";
    g.setAttribute("aria-hidden", "true");
    place(g, next[hintMove.id]);
    return g;
  }

  function renderCars() {
    const focused = document.activeElement && document.activeElement.classList && document.activeElement.classList.contains("cp-car")
      ? document.activeElement.dataset.id : null;
    const frag = document.createDocumentFragment();
    for (const v of cars) frag.appendChild(makeCar(v));
    if (hintMove) {
      const g = makeGhost();
      if (g) frag.appendChild(g);
    }
    carsEl.replaceChildren(frag);
    if (focused !== null) {
      const el = carsEl.querySelector('.cp-car[data-id="' + focused + '"]');
      if (canFocus(el)) { try { el.focus({ preventScroll: true }); } catch (_) { /* older browsers */ } }
    }
  }

  /* ---------- status, best and level ---------- */

  function setNote(text, ms) {
    if (noteTimer) { clearTimeout(noteTimer); noteTimer = 0; }
    noteEl.textContent = text || "";
    if (text && ms) noteTimer = setTimeout(() => { noteEl.textContent = ""; noteTimer = 0; }, ms);
  }

  function setStatus() {
    if (won) return;
    const b = store.getInt("best:" + levelIndex, null);
    statusEl.textContent = moves === 0 ? "Level " + (levelIndex + 1) + " · par " + level.best + ". Get the red car out."
      : "Moves " + moves + " · par " + level.best + (b === null ? "" : " · best " + b);
  }

  function updateHud() {
    levelNumEl.textContent = (levelIndex + 1) + "/" + LEVELS.length;
    titleEl.innerHTML = "<small>par " + level.best + "</small>Level " + (levelIndex + 1);
    movesEl.textContent = String(moves);
    const b = store.getInt("best:" + levelIndex, null);
    bestEl.textContent = b === null ? "—" : String(b);
    undoBtn.disabled = won || !history.length;
    hintBtn.disabled = won;
    levelSel.value = String(levelIndex);
    setStatus();
  }

  function clearHint() {
    if (hintTimer) { clearTimeout(hintTimer); hintTimer = 0; }
    hintMove = null;
    if (noteEl.textContent.indexOf("Hint:") === 0) setNote("", 0);
  }

  function startLevel(index, opts) {
    const i = Math.max(0, Math.min(LEVELS.length - 1, Number(index) || 0));
    if (!(opts && opts.keepResume) && resumer) resumer.clear();
    levelIndex = i;
    level = LEVELS[i];
    startCars = CP.carsOf(level);
    cars = CP.cloneCars(startCars);
    moves = 0;
    history = [];
    won = false;
    selected = -1;
    hintMove = null;
    drag = null;
    if (hintTimer) { clearTimeout(hintTimer); hintTimer = 0; }
    setNote("", 0);
    store.set("level", i);
    setStatus();
    renderCars();
    updateHud();
  }

  /* ---------- moves ---------- */

  function badCar(id) {
    const el = carsEl.querySelector('.cp-car[data-id="' + id + '"]');
    if (el) {
      el.dataset.bad = "1";
      setTimeout(() => { if (el.isConnected) delete el.dataset.bad; }, 320);
    }
    setNote("That car cannot move that way.", 1600);
  }

  function slide(id, dir, steps) {
    if (won || !cars[id]) return;
    const max = CP.maxSlide(cars, id, dir);
    if (!max) { badCar(id); return; }
    steps = Math.max(1, Math.min(max, steps));
    history.push({ cars: CP.cloneCars(cars), moves: moves });
    if (history.length > 500) history.shift();
    const next = CP.applyMove(cars, { id: id, dir: dir, steps: steps });
    if (!next) return;
    cars = next;
    moves++;
    selected = selected === id ? id : -1;          // a dragged car is not left outlined
    clearHint();
    renderCars();
    updateHud();
    checkWin();
  }

  // Tap a free square in the car's row or column: slide exactly to it.
  function moveToCell(cell) {
    if (selected < 0 || !cars[selected]) return false;
    const v = cars[selected], tr = Math.floor(cell / CP.SIZE), tc = cell % CP.SIZE;
    let dir = "", steps = 0;
    if (v.dir === "h" && tr === v.r) {
      if (tc < v.c) { dir = "left"; steps = v.c - tc; }
      else if (tc >= v.c + v.len) { dir = "right"; steps = tc - (v.c + v.len - 1); }
    } else if (v.dir === "v" && tc === v.c) {
      if (tr < v.r) { dir = "up"; steps = v.r - tr; }
      else if (tr >= v.r + v.len) { dir = "down"; steps = tr - (v.r + v.len - 1); }
    }
    if (!dir || steps <= 0) return false;
    const max = CP.maxSlide(cars, selected, dir);
    if (steps > max) { badCar(selected); return true; }
    slide(selected, dir, steps);
    return true;
  }

  function checkWin() {
    if (won || !CP.isWin(cars)) return;
    won = true;
    selected = -1;
    clearHint();
    const key = "best:" + levelIndex;
    const b = store.getInt(key, null);
    if (b === null || moves < b) store.set(key, moves);
    statusEl.textContent = "Solved in " + moves + " moves.";
    renderCars();
    updateHud();
    if (resumer) resumer.clear();
  }

  function undo() {
    if (won || !history.length) return;
    const h = history.pop();
    cars = h.cars;
    moves = h.moves;
    selected = -1;
    clearHint();
    setStatus();
    renderCars();
    updateHud();
  }

  function doHint() {
    if (won) return;
    if (hintMove) { clearHint(); renderCars(); return; }
    const m = CP.hint(cars);
    if (!m) { setNote("No move from here.", 1600); return; }
    hintMove = m;
    selected = m.id;
    renderCars();
    const name = NAMES[m.id % NAMES.length];
    setNote("Hint: " + name + " car " + m.dir + " " + m.steps + ".", 6000);
    hintTimer = setTimeout(() => {
      hintMove = null;
      hintTimer = 0;
      if (noteEl.textContent.indexOf("Hint:") === 0) setNote("", 0);
      renderCars();
    }, 6000);
  }

  /* ---------- pointer: tap, drag and swipe ---------- */

  function cellFromPoint(e) {
    const r = innerEl.getBoundingClientRect();
    if (!r.width || !r.height) return -1;
    const c = Math.floor((e.clientX - r.left) / (r.width / CP.SIZE));
    const row = Math.floor((e.clientY - r.top) / (r.height / CP.SIZE));
    if (c < 0 || c >= CP.SIZE || row < 0 || row >= CP.SIZE) return -1;
    return row * CP.SIZE + c;
  }

  // Pressing a car picks it up: it can then be dragged along its own row or column, as far as the cars and walls around it allow.
  function onDown(e) {
    if (won) return;
    if (e.pointerType === "mouse" && e.button > 0) return;
    if (e.isPrimary === false) return;
    document.body.classList.add("gk-play");          // a tap on the board puts the Options menu away
    const carEl = e.target.closest(".cp-car");
    const id = carEl && carsEl.contains(carEl) ? Number(carEl.dataset.id) : -1;
    if (e.cancelable) e.preventDefault();
    const v = id >= 0 ? cars[id] : null;
    drag = {
      id: id, x: e.clientX, y: e.clientY, moved: false, wasSelected: id >= 0 && selected === id, pointerId: e.pointerId,
      el: v ? carEl : null, h: !!v && v.dir === "h", off: 0,
      back: v ? CP.maxSlide(cars, id, v.dir === "h" ? "left" : "up") : 0,      // how many squares it can go back / forward
      fwd: v ? CP.maxSlide(cars, id, v.dir === "h" ? "right" : "down") : 0,
    };
    try { boardEl.setPointerCapture(e.pointerId); } catch (_) { /* not fatal */ }
  }

  function selectCar(id) {
    if (won || !cars[id]) return;
    if (hintMove && hintMove.id !== id) clearHint();
    selected = id;
    renderCars();
  }

  function deselect() {
    if (selected < 0) return;
    if (hintMove) clearHint();
    selected = -1;
    renderCars();
  }

  const cellPx = () => innerEl.clientWidth / CP.SIZE;
  const showOffset = (d, squares) => {
    d.el.style.transform = "translate" + (d.h ? "X" : "Y") + "(" + squares * cellPx() + "px)";
  };

  function onMove(e) {
    if (!drag) return;
    if (!drag.moved) {
      const dx = Math.abs(e.clientX - drag.x), dy = Math.abs(e.clientY - drag.y);
      if (dx + dy <= 6) return;
      drag.moved = true;
      if (drag.el) { drag.el.style.transition = "none"; drag.el.style.zIndex = "6"; clearHint(); }
    }
    if (!drag.el) return;
    const delta = drag.h ? e.clientX - drag.x : e.clientY - drag.y;
    drag.off = Math.max(-drag.back, Math.min(drag.fwd, delta / cellPx()));    // the car follows the finger, but not through anything
    showOffset(drag, drag.off);
  }

  // put a car that was let go without moving a square back on its square
  function settle(d) {
    if (!d.el || !d.el.isConnected) return;
    const calm = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    d.el.style.transition = calm ? "none" : "transform .12s ease-out";
    d.el.style.transform = "";
    d.el.style.zIndex = "";
  }

  function onUp(e) {
    if (!drag) return;
    const d = drag;
    drag = null;
    try {
      if (boardEl.hasPointerCapture && boardEl.hasPointerCapture(e.pointerId)) boardEl.releasePointerCapture(e.pointerId);
    } catch (_) { /* ignore */ }
    if (d.id >= 0 && cars[d.id]) {
      if (d.moved) {
        const steps = Math.round(Math.abs(d.off));
        if (steps >= 1) slide(d.id, d.h ? (d.off > 0 ? "right" : "left") : (d.off > 0 ? "down" : "up"), steps);
        else settle(d);
        return;
      }
      if (d.wasSelected) deselect(); else selectCar(d.id);       // a tap picks the car for the keyboard or a tap on a free square
      return;
    }
    if (d.moved) return;
    const cell = cellFromPoint(e);
    if (cell >= 0 && selected >= 0) {
      if (!moveToCell(cell)) deselect();
    } else if (cell < 0 && selected >= 0) {
      deselect();
    }
  }

  function onCancel(e) {
    if (!drag) return;
    const d = drag;
    drag = null;
    settle(d);
    try {
      if (boardEl.hasPointerCapture && boardEl.hasPointerCapture(e.pointerId)) boardEl.releasePointerCapture(e.pointerId);
    } catch (_) { /* ignore */ }
  }

  /* ---------- keyboard ---------- */

  const KEY_DIR = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" };

  function focusedCar() {
    const el = document.activeElement;
    if (!el || !el.classList || !el.classList.contains("cp-car")) return -1;
    return Number(el.dataset.id);
  }

  document.addEventListener("keydown", (e) => {
    const tag = e.target && e.target.tagName;
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || (e.target && e.target.isContentEditable)) return;
    if (e.target && e.target.closest && e.target.closest(".gk-menu, .gk-ctl, .gk-opts, .gk-acts, .toolbar, .gk-optbtn, .row, .gk-sel-btn")) return;
    if ((e.ctrlKey || e.metaKey) && String(e.key).toLowerCase() === "z") { e.preventDefault(); undo(); return; }
    if (e.key === "Escape") {
      if (selected >= 0) { e.preventDefault(); deselect(); }
      return;
    }
    const dir = KEY_DIR[e.key];
    if (!dir || won) return;
    const id = selected >= 0 ? selected : focusedCar();
    if (id < 0 || !cars[id]) return;
    e.preventDefault();
    const v = cars[id];
    if ((v.dir === "h" && (dir === "up" || dir === "down")) || (v.dir === "v" && (dir === "left" || dir === "right"))) {
      setNote(v.dir === "h" ? "This car only moves left and right." : "This car only moves up and down.", 1600);
      return;
    }
    const max = CP.maxSlide(cars, id, dir);
    if (max) slide(id, dir, max);
    else badCar(id);
  });

  carsEl.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " " && e.key !== "Spacebar") return;
    const carEl = e.target.closest(".cp-car");
    if (!carEl) return;
    e.preventDefault();
    const id = Number(carEl.dataset.id);
    if (selected === id) deselect();
    else selectCar(id);
  });

  /* ---------- buttons and menus ---------- */

  undoBtn.addEventListener("click", undo);
  hintBtn.addEventListener("click", doHint);
  resetBtn.addEventListener("click", () => startLevel(levelIndex));
  newBtn.addEventListener("click", () => {
    document.body.classList.add("gk-play");
    startLevel((levelIndex + 1) % LEVELS.length);
  });
  levelSel.addEventListener("change", () => startLevel(parseInt(levelSel.value, 10) || 0));
  // gamekit labels this "New game"; here it is the next level, so say so.
  newBtn.innerHTML = '<span class="glyph">↻</span> Next level';

  boardEl.addEventListener("pointerdown", onDown, { passive: false });
  boardEl.addEventListener("pointermove", onMove);
  boardEl.addEventListener("pointerup", onUp);
  boardEl.addEventListener("pointercancel", onCancel);
  boardEl.addEventListener("contextmenu", (e) => e.preventDefault());

  /* ---------- keeping the game across a refresh ---------- */
  function snapshotPos(cars) {
    return cars.map((v) => (v.dir === "h" ? v.c : v.r));
  }

  resumer = Gamekit.resume("car-park", () => {
    if (won) return null;
    const pos = snapshotPos(cars), from = snapshotPos(startCars);
    if (!moves && pos.every((p, i) => p === from[i])) return null;
    return { level: levelIndex, pos: pos, moves: moves };
  }, (s) => {
    const lv = Number(s.level);
    if (!Number.isInteger(lv) || lv < 0 || lv >= LEVELS.length) return false;
    if (!Array.isArray(s.pos) || s.pos.length !== CP.carsOf(LEVELS[lv]).length) return false;
    const base = CP.carsOf(LEVELS[lv]);
    for (let i = 0; i < base.length; i++) {
      const p = s.pos[i];
      if (!Number.isInteger(p)) return false;
      if (base[i].dir === "h") base[i].c = p;
      else base[i].r = p;
    }
    if (!CP.valid(base)) return false;
    if (CP.isWin(base)) return false;
    levelIndex = lv;
    level = LEVELS[lv];
    startCars = CP.carsOf(level);
    cars = base;
    moves = Math.max(0, Number(s.moves) || 0);
    history = [];
    won = false;
    selected = -1;
    hintMove = null;
    setNote("", 0);
    store.set("level", lv);
    setStatus();
    renderCars();
    updateHud();
    return true;
  });

  /* ---------- start ---------- */
  buildGrid();
  buildLevelSelect();
  startLevel(levelIndex, { keepResume: true });
  resumer.restore();
  Gamekit.glidePieces(carsEl, ".cp-car");
  window.addEventListener("load", () => Manpage.autoOpen("car-park"));

  // For an end-to-end browser check only: play the stored solution and settle the game.
  window.__carParkTest = {
    autoSolve: () => {
      if (won) return;
      const res = CP.solve(cars);
      if (!res || !res.path.length) return;
      for (const m of res.path) cars = CP.applyMove(cars, m);
      moves += res.path.length;
      selected = -1;
      clearHint();
      renderCars();
      updateHud();
      checkWin();
    },
    state: () => ({ level: levelIndex, moves: moves, won: won, cars: CP.cloneCars(cars) }),
    setLevel: (i) => startLevel(i),
  };
})();
