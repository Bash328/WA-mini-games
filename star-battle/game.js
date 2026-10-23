(function () {
  "use strict";

  const SB = globalThis.StarBattlePuzzle;
  const $ = (id) => document.getElementById(id);
  const boardEl = $("board"), statusEl = $("status"), timeEl = $("time"), bestEl = $("best"), hintEl = $("hint");
  const undoBtn = $("undo-btn"), resetBtn = $("reset-btn"), newBtn = $("new-btn"), hintBtn = $("hint-btn"), checkBtn = $("check-btn"), chipsEl = $("chips");
  const store = Gamekit.storage("star-battle:");
  const TIP = "Tap a square to put a star there; tap it again to take it away.";

  let diff = store.get("diff", "medium");
  if (!SB.LEVELS[diff]) diff = "medium";
  let puzzle = null, curSeed = 0, stars = [], history = [], won = false;
  let hintCell = -1, hintUsed = false;
  let startAt = 0, elapsedBefore = 0, timer = null;
  let cellEls = [];
  let pendingRestore = null, buildToken = 0;

  const fmt = (s) => Gamekit.fmtTime(s);
  const levelLine = () => (puzzle && puzzle.k === 2
    ? "Two stars in every row, column and region."
    : "One star in every row, column and region.");

  /* ---------- drawing ---------- */
  function build() {
    const n = puzzle.n, reg = puzzle.regions;
    boardEl.innerHTML = "";
    boardEl.style.setProperty("--n", String(n));
    boardEl.classList.remove("won");
    boardEl.setAttribute("aria-label", "Star Battle board, " + n + " by " + n + ", " +
      (puzzle.k === 2 ? "two stars" : "one star") + " in every row, column and region");
    cellEls = new Array(n * n);
    const frag = document.createDocumentFragment();
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const i = r * n + c;
        const b = document.createElement("button");
        b.type = "button";
        b.className = "sb-cell c" + (reg[i] % 10);
        // a thick line only where the region changes; the thin grid lines go right and down
        if (c < n - 1) b.classList.add(reg[i] !== reg[i + 1] ? "b-r" : "g-r");
        if (r < n - 1) b.classList.add(reg[i] !== reg[i + n] ? "b-b" : "g-b");
        b.dataset.i = String(i);
        b.setAttribute("aria-pressed", "false");
        const star = document.createElement("span");
        star.className = "sb-star";
        star.setAttribute("aria-hidden", "true");
        b.append(star);
        b.addEventListener("click", () => tap(i));
        cellEls[i] = b;
        frag.append(b);
      }
    }
    boardEl.append(frag);
  }

  function render() {
    if (!puzzle) return null;
    const n = puzzle.n;
    const chk = SB.check(puzzle, stars);
    const bad = new Set(chk.bad);
    for (let i = 0; i < cellEls.length; i++) {
      const b = cellEls[i];
      const on = !!stars[i];
      b.classList.toggle("on", on);
      b.classList.toggle("bad", bad.has(i));
      b.classList.toggle("hint", i === hintCell);
      b.setAttribute("aria-pressed", on ? "true" : "false");
      const r = (i / n) | 0, c = i % n;
      b.setAttribute("aria-label", "row " + (r + 1) + ", column " + (c + 1) +
        ", region " + (puzzle.regions[i] + 1) + (on ? ", star" : ", empty"));
    }
    boardEl.classList.toggle("won", won);
    undoBtn.disabled = !history.length || won;
    hintBtn.disabled = won || hintUsed;
    checkBtn.disabled = won;
    return chk;
  }

  /* ---------- playing ---------- */
  function tap(i) {
    if (!puzzle || won) return;
    const was = stars[i] ? 1 : 0;
    history.push({ i: i, v: was });
    stars[i] = was ? 0 : 1;
    hintCell = -1;
    const chk = render();
    if (chk.solved) return win();
    if (was) {
      hintEl.textContent = "Star taken away.";
    } else if (chk.touching.length) {
      hintEl.textContent = "That star touches another one. Move it.";
    } else if (chk.over.rows.length || chk.over.cols.length || chk.over.regions.length) {
      hintEl.textContent = "Too many stars in that row, column or region.";
    } else {
      hintEl.textContent = "Star placed. Tap it again to take it away.";
    }
  }

  function win() {
    if (won) return;
    won = true;
    hintCell = -1;
    stopTimer();
    const t = Math.floor(total());
    const key = "best:" + diff;
    const prev = store.getInt(key, -1);
    if (prev < 0 || t < prev) store.set(key, t);
    bestEl.textContent = fmt(store.getInt(key, t));
    const taunt = Gamekit.taunt("win");
    statusEl.textContent = "Solved in " + fmt(t) + "!" + (taunt ? " " + taunt : "");
    hintEl.textContent = puzzle.k === 2
      ? "Every row, column and region has two stars, and none of them touch."
      : "Every row, column and region has one star, and none of them touch.";
    resumer.clear();
    render();
  }

  function undo() {
    if (!puzzle || won || !history.length) return;
    const h = history.pop();
    stars[h.i] = h.v;
    hintCell = -1;
    hintEl.textContent = "Star taken back.";
    render();
  }

  function restart() {
    if (!puzzle) return;
    stars = new Array(puzzle.n * puzzle.n).fill(0);
    history = [];
    won = false;
    hintCell = -1;
    statusEl.textContent = levelLine();
    hintEl.textContent = TIP;
    resetTimer();
    render();
  }

  function showHint() {
    if (!puzzle || won || hintUsed) return;
    const h = SB.hint(puzzle, stars);
    if (!h) {
      hintCell = -1;
      hintEl.textContent = "Every star from the answer is already on the board.";
      return render();
    }
    hintUsed = true;
    hintCell = h.cell;
    hintEl.textContent = "Hint: row " + (h.row + 1) + ", column " + (h.col + 1) + ".";
    render();
  }

  function checkNow() {
    if (!puzzle || won) return;
    hintCell = -1;
    const chk = SB.check(puzzle, stars);
    render();
    if (chk.solved) return win();
    const wrong = [];
    if (chk.touching.length) wrong.push("two stars are touching");
    if (chk.over.rows.length || chk.over.cols.length || chk.over.regions.length) wrong.push("a row, column or region has too many stars");
    if (chk.under.rows.length || chk.under.cols.length || chk.under.regions.length) wrong.push("a row, column or region still needs a star");
    hintEl.textContent = wrong.length
      ? "Check: " + wrong.join("; ") + "."
      : "Every row, column and region is right.";
  }

  /* ---------- the clock ---------- */
  const total = () => elapsedBefore + (startAt ? (Date.now() - startAt) / 1000 : 0);
  function startTimer() {
    stopTimer();
    startAt = Date.now();
    timer = setInterval(() => { timeEl.textContent = fmt(Math.floor(total())); }, 500);
  }
  function stopTimer() {
    if (timer) clearInterval(timer);
    timer = null;
    elapsedBefore = total();
    startAt = 0;
    timeEl.textContent = fmt(Math.floor(elapsedBefore));
  }
  function resetTimer() {
    stopTimer();
    elapsedBefore = 0;
    timeEl.textContent = "0:00";
    startTimer();
  }

  /* ---------- starting a puzzle ---------- */
  function start(seed) {
    const token = ++buildToken;
    pendingRestore = null;                  // a new game (or level) never takes the old stars
    stopTimer();
    statusEl.textContent = "Building the puzzle…";
    hintEl.textContent = "";
    // let the browser paint that line first: generation is quick, but it is still work
    setTimeout(() => {
      if (token !== buildToken) return;
      let p = SB.generate(seed, diff), s = seed;
      for (let k = 1; !p && k <= 4; k++) { s = (seed + k * 2654435761) >>> 0; p = SB.generate(s, diff); }
      if (!p) { statusEl.textContent = "No puzzle this time. Tap new."; return; }
      curSeed = s;
      puzzle = p;
      stars = new Array(p.n * p.n).fill(0);
      history = [];
      won = false;
      hintCell = -1;
      hintUsed = false;
      elapsedBefore = 0;
      timeEl.textContent = "0:00";
      const best = store.getInt("best:" + diff, -1);
      bestEl.textContent = best >= 0 ? fmt(best) : "—";
      statusEl.textContent = levelLine();
      hintEl.textContent = TIP;
      build();
      render();
      startTimer();
      if (pendingRestore) { const r = pendingRestore; pendingRestore = null; r(); }
    }, 20);
  }

  /* ---------- controls ---------- */
  undoBtn.addEventListener("click", undo);
  resetBtn.addEventListener("click", restart);
  newBtn.addEventListener("click", () => start(Gamekit.randomSeed()));
  hintBtn.addEventListener("click", showHint);
  checkBtn.addEventListener("click", checkNow);
  const chips = Gamekit.wireDifficultyChips({
    el: chipsEl, difficulties: ["easy", "medium", "hard"], initial: diff, storage: store, storageKey: "diff",
    onChange: (d) => { diff = d; start(SB.dailySeed(d)); },
  });
  diff = chips.get();
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !puzzle || document.querySelector(".man-backdrop")) return;
    if (hintCell < 0) return;
    hintCell = -1;
    hintEl.textContent = TIP;
    render();
  });

  /* ---------- keeping the game across a refresh ---------- */
  const resumer = Gamekit.resume("star-battle", () => (!puzzle || won || (!stars.some((v) => v) && !hintUsed)) ? null : {
    seed: curSeed, diff: diff, stars: stars.slice(), t: Math.floor(total()), hintUsed: hintUsed,
  }, (s) => {
    if (!SB.LEVELS[s.diff] || !Number.isInteger(s.seed) || !Array.isArray(s.stars)) return false;
    diff = s.diff;
    chips.show(diff);
    const apply = () => {
      if (!puzzle || s.stars.length !== puzzle.n * puzzle.n) return;
      stars = s.stars.map((v) => (v ? 1 : 0));
      history = [];
      hintUsed = !!s.hintUsed;
      elapsedBefore = Math.max(0, Number(s.t) || 0);
      startTimer();
      render();
    };
    start(s.seed);
    pendingRestore = apply;
    return true;
  });

  // a saved game is rebuilt from its seed and the stars put back; otherwise today's puzzle
  if (!resumer.restore()) start(SB.dailySeed(diff));
  window.addEventListener("load", () => Manpage.autoOpen("star-battle"));

  // a newly placed star pops in (the one-line call every fun page makes)
  if (window.Gamekit && Gamekit.popFilled) Gamekit.popFilled(boardEl, { inner: ".sb-star" });

  window.__starTest = {
    solve: () => {
      if (!puzzle || won) return;
      stars = puzzle.solution.slice();
      history = [];
      hintCell = -1;
      render();
      if (SB.check(puzzle, stars).solved) win();
    },
    state: () => ({ seed: curSeed, diff: diff, won: won, stars: stars.slice() }),
  };
})();
