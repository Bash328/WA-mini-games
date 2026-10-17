(function () {
  "use strict";

  const CS = globalThis.CrossSums;
  const $ = (id) => document.getElementById(id);
  const gridEl = $("grid"), statusEl = $("status"), timeEl = $("time"), bestEl = $("best"), hintEl = $("hint"), padEl = $("pad");
  const notesBtn = $("notes-btn"), eraseBtn = $("erase-btn"), checkBtn = $("check-btn"), undoBtn = $("undo-btn"), resetBtn = $("reset-btn"), newBtn = $("new-btn"), chipsEl = $("chips");
  const store = Gamekit.storage("cross-sums:");

  let diff = store.get("diff", "medium");
  if (!CS.LEVELS[diff]) diff = "medium";
  let puzzle = null, curSeed = 0, digits = {}, notes = {}, sel = null, noteMode = false, won = false, checking = false, history = [];
  let startAt = 0, elapsedBefore = 0, timer = null;
  let cells = {};

  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  const fmt = (s) => Gamekit.fmtTime(s);
  const isGiven = (i) => puzzle.givens[i] !== undefined;
  const value = (i) => (isGiven(i) ? puzzle.givens[i] : digits[i] || 0);
  const allDigits = () => { const d = Object.assign({}, digits); for (const i of Object.keys(puzzle.givens)) d[i] = puzzle.givens[i]; return d; };

  // ---------- drawing ----------
  function build() {
    const n = puzzle.n;
    gridEl.innerHTML = ""; cells = {};
    gridEl.style.setProperty("--n", n);
    // the clue shown in a black square: the run starting to its right (across) and the one starting below it (down)
    const startsAt = {};
    puzzle.runs.forEach((r) => { startsAt[(r.dir === "a" ? "a" : "d") + (r.cells[0] - (r.dir === "a" ? 1 : n))] = r; });
    for (let i = 0; i < n * n; i++) {
      if (puzzle.white[i]) {
        const b = el("button", "cs-w"); b.type = "button";
        b.setAttribute("aria-label", "row " + (Math.floor(i / n) + 1) + ", column " + (i % n + 1));
        b.addEventListener("click", () => select(i));
        gridEl.append(b); cells[i] = b;
      } else {
        const a = startsAt["a" + i], d = startsAt["d" + i];
        const b = el("div", "cs-b" + (a || d ? " clue" : ""));
        if (a) b.append(el("span", "a", String(a.sum)));
        if (d) b.append(el("span", "d", String(d.sum)));
        if (a || d) b.setAttribute("aria-label", (a ? "across " + a.sum : "") + (a && d ? ", " : "") + (d ? "down " + d.sum : ""));
        gridEl.append(b);
      }
    }
  }

  function badCells() {
    const bad = new Set();
    if (!checking) return bad;
    const all = allDigits();
    puzzle.runs.forEach((r) => { if (CS.runStatus(r, all) !== "ok") r.cells.forEach((i) => bad.add(i)); });
    return bad;
  }

  function render() {
    const peers = new Set(), bad = badCells();
    if (sel !== null) { const rs = CS.runsAt(puzzle, sel); Object.values(rs).forEach((r) => r.cells.forEach((i) => peers.add(i))); }
    for (const k of Object.keys(cells)) {
      const i = Number(k), c = cells[i];
      c.className = "cs-w" + (isGiven(i) ? " given" : digits[i] ? " mine" : "") + (peers.has(i) ? " peer" : "") + (sel === i ? " sel" : "") + (bad.has(i) ? " bad" : "");
      c.innerHTML = "";
      const v = value(i);
      if (v) c.textContent = String(v);
      else if (notes[i]) { const g = el("span", "notes"); for (let d = 1; d <= 9; d++) g.append(el("span", "", notes[i] & (1 << d) ? String(d) : "")); c.append(g); }
    }
    notesBtn.classList.toggle("on", noteMode);
    undoBtn.disabled = !history.length || won;
    eraseBtn.disabled = won || sel === null || isGiven(sel) || !(digits[sel] || notes[sel]);
    checkBtn.disabled = won;
    hintEl.textContent = hintText();
  }

  // the ways each run through the selected square can be made
  function hintText() {
    if (won) return "";
    if (sel === null) return "Tap a white square to see the ways its runs can be made.";
    const rs = CS.runsAt(puzzle, sel), all = allDigits(), out = [];
    for (const dir of ["a", "d"]) {
      const r = rs[dir]; if (!r) continue;
      const have = r.cells.map((i) => all[i]).filter(Boolean);
      const left = r.sum - have.reduce((a, b) => a + b, 0), free = r.cells.length - have.length;
      const ways = free ? CS.combos(left, free).filter((c) => c.every((d) => !have.includes(d))) : [];
      out.push((dir === "a" ? "Across " : "Down ") + r.sum + " in " + r.cells.length + (free < r.cells.length ? " (" + free + " left to make " + left + ")" : "") + ": " + (free ? (ways.length ? ways.map((c) => c.join("+")).join(", ") : "no way!") : "full"));
    }
    return out.join("  ·  ");
  }

  // ---------- playing ----------
  function select(i) { sel = i; render(); }
  function setDigit(d) {
    if (won || sel === null || isGiven(sel)) return;
    history.push({ i: sel, digit: digits[sel] || 0, notes: notes[sel] || 0 });
    if (noteMode) { if (digits[sel]) delete digits[sel]; notes[sel] = (notes[sel] || 0) ^ (1 << d); if (!notes[sel]) delete notes[sel]; }
    else { digits[sel] = d; delete notes[sel]; clearPeerNotes(sel, d); }
    checking = false;
    afterChange();
  }
  // a digit placed in a run takes that note out of the other squares of both runs
  function clearPeerNotes(i, d) {
    const rs = CS.runsAt(puzzle, i);
    Object.values(rs).forEach((r) => r.cells.forEach((j) => { if (notes[j]) { notes[j] &= ~(1 << d); if (!notes[j]) delete notes[j]; } }));
  }
  function erase() {
    if (won || sel === null || isGiven(sel) || !(digits[sel] || notes[sel])) return;
    history.push({ i: sel, digit: digits[sel] || 0, notes: notes[sel] || 0 });
    delete digits[sel]; delete notes[sel]; checking = false;
    afterChange();
  }
  function undo() {
    if (!history.length || won) return;
    const h = history.pop();
    if (h.digit) digits[h.i] = h.digit; else delete digits[h.i];
    if (h.notes) notes[h.i] = h.notes; else delete notes[h.i];
    sel = h.i; checking = false;
    render();
  }
  function afterChange() {
    render();
    if (CS.solved(puzzle, allDigits())) win();
  }
  function win() {
    won = true; stopTimer();
    const t = Math.floor(total()), key = "best:" + diff, b = Number(store.get(key, 0));
    if (!b || t < b) store.set(key, t);
    bestEl.textContent = fmt(Number(store.get(key, t)));
    statusEl.textContent = "Solved in " + fmt(t) + "! " + Gamekit.taunt("win");
    resumer.clear();
    render();
  }
  checkBtn.addEventListener("click", () => {
    checking = true; render();
    const bad = badCells();
    hintEl.textContent = bad.size ? "The shaded runs already break a rule." : "No rule is broken so far.";
  });

  // ---------- the clock ----------
  const total = () => elapsedBefore + (startAt ? (Date.now() - startAt) / 1000 : 0);
  function startTimer() { stopTimer(); startAt = Date.now(); timer = setInterval(() => { timeEl.textContent = fmt(Math.floor(total())); }, 500); }
  function stopTimer() { if (timer) clearInterval(timer); timer = null; elapsedBefore = total(); startAt = 0; }

  // ---------- starting a puzzle ----------
  function start(seed) {
    statusEl.textContent = "Building the puzzle…";
    // let the browser paint that line first: a hard puzzle takes a moment to build
    setTimeout(() => {
      curSeed = seed;
      puzzle = CS.generate(seed, diff) || CS.generate(seed + 1, diff);
      digits = {}; notes = {}; sel = null; noteMode = false; won = false; checking = false; history = [];
      elapsedBefore = 0; timeEl.textContent = "0:00";
      bestEl.textContent = store.get("best:" + diff, "") ? fmt(Number(store.get("best:" + diff, 0))) : "—";
      statusEl.textContent = "Fill every white square.";
      build(); render(); startTimer();
      if (pendingRestore) { const r = pendingRestore; pendingRestore = null; r(); }
    }, 20);
  }
  let pendingRestore = null;

  // ---------- controls ----------
  for (let d = 1; d <= 9; d++) { const b = el("button", "btn ghost", String(d)); b.type = "button"; b.addEventListener("click", () => setDigit(d)); padEl.append(b); }
  notesBtn.addEventListener("click", () => { noteMode = !noteMode; render(); });
  eraseBtn.addEventListener("click", erase);
  undoBtn.addEventListener("click", undo);
  resetBtn.addEventListener("click", () => { if (!puzzle) return; digits = {}; notes = {}; history = []; won = false; checking = false; elapsedBefore = 0; statusEl.textContent = "Fill every white square."; startTimer(); render(); });
  newBtn.addEventListener("click", () => start(Gamekit.randomSeed()));
  const chips = Gamekit.wireDifficultyChips({
    el: chipsEl, difficulties: ["easy", "medium", "hard"], initial: diff, storage: store, storageKey: "diff",
    onChange: (d) => { diff = d; start(Gamekit.dailySeed("cross-sums", diff)); },
  });
  diff = chips.get();
  document.addEventListener("keydown", (e) => {
    if (!puzzle || e.ctrlKey || e.metaKey || e.altKey || document.querySelector(".man-backdrop")) return;
    if (/^[1-9]$/.test(e.key)) setDigit(Number(e.key));
    else if (e.key === "Backspace" || e.key === "Delete" || e.key === "0") { e.preventDefault(); erase(); }
    else if (e.key.startsWith("Arrow") && sel !== null) {
      e.preventDefault();
      const n = puzzle.n, step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -n, ArrowDown: n }[e.key];
      let j = sel + step;
      while (j >= 0 && j < n * n && !puzzle.white[j]) j += step;
      if (j >= 0 && j < n * n) select(j);
    }
  });

  // ---------- keeping the game across a refresh ----------
  const resumer = Gamekit.resume("cross-sums", () => (!puzzle || won || (!Object.keys(digits).length && !Object.keys(notes).length)) ? null : { seed: curSeed, diff, digits, notes, t: Math.floor(total()) }, (s) => {
    if (!CS.LEVELS[s.diff] || !Number.isInteger(s.seed) || !s.digits || typeof s.digits !== "object" || !s.notes || typeof s.notes !== "object") return false;
    const apply = () => {
      const okIdx = (i) => puzzle.white[i] && !isGiven(i);
      for (const k of Object.keys(s.digits)) { const d = s.digits[k]; if (okIdx(Number(k)) && Number.isInteger(d) && d >= 1 && d <= 9) digits[k] = d; }
      for (const k of Object.keys(s.notes)) { const m = s.notes[k]; if (okIdx(Number(k)) && Number.isInteger(m) && m > 0 && m < 1024 && !digits[k]) notes[k] = m; }
      elapsedBefore = Math.max(0, Number(s.t) || 0); startTimer();
      render();
    };
    diff = s.diff; chips.show(diff);
    pendingRestore = apply;
    start(s.seed);
    return true;
  });

  // a saved game is rebuilt from its seed and the squares put back; otherwise today's puzzle
  if (!resumer.restore()) start(Gamekit.dailySeed("cross-sums", diff));
  window.addEventListener("load", () => Manpage.autoOpen("cross-sums"));
})();
