(function () {
  "use strict";

  const WS = globalThis.WaterSort;
  const $ = (id) => document.getElementById(id);
  const tubesEl = $("tubes"), statusEl = $("status"), movesEl = $("moves"), bestEl = $("best"), hintEl = $("hint");
  const undoBtn = $("undo-btn"), resetBtn = $("reset-btn"), newBtn = $("new-btn"), hintBtn = $("hint-btn"), symBtn = $("sym-btn"), chipsEl = $("chips");
  const store = Gamekit.storage("water-sort:");

  // twelve colours that stay apart, and a letter for each (for anyone who can't tell colours apart)
  const COLORS = ["#e74c3c", "#3498db", "#2ecc71", "#f1c40f", "#9b59b6", "#e67e22", "#1abc9c", "#fd79a8", "#95a5a6", "#8d5524", "#1e3a8a", "#a3d95b"];
  const LETTERS = "ABCDEFGHIJKL";

  let diff = store.get("diff", "medium");
  if (!WS.LEVELS[diff]) diff = "medium";
  let showLetters = store.get("letters", "0") === "1";
  let curSeed = 0, first = [], tubes = [], log = [], won = false, sel = null, hintMove = null, hintTimer = null, lastTo = null;
  let plan = null;                      // the rest of a solution the hint button found; followed while the player follows it, so hints never go in circles

  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };

  function render() {
    const n = tubes.length, per = n <= 7 ? n : Math.ceil(n / 2);
    tubesEl.style.setProperty("--per", per);
    tubesEl.innerHTML = "";
    tubes.forEach((t, i) => {
      const b = el("button", "ws-tube" + (sel === i ? " sel" : "") + (WS.isDone(t) && t.length ? " done" : "") + (hintMove && hintMove.from === i ? " hint" : "") + (hintMove && hintMove.to === i ? " hint to" : "") + (lastTo === i ? " poured" : ""));
      b.type = "button";
      t.forEach((c) => { const l = el("div", "ws-l", showLetters ? LETTERS[c] : ""); l.style.background = COLORS[c]; b.append(l); });
      b.disabled = won;
      b.setAttribute("aria-label", "tube " + (i + 1) + ", " + (t.length ? t.map((c) => LETTERS[c]).join(" ") + " from the bottom" : "empty"));
      b.addEventListener("click", () => tap(i));
      tubesEl.append(b);
    });
    movesEl.textContent = String(log.length);
    undoBtn.disabled = !log.length || won;
    hintBtn.disabled = won;
    symBtn.classList.toggle("on", showLetters);
    symBtn.textContent = showLetters ? "Hide letters" : "Show letters";
  }

  function clearHint() { hintMove = null; clearTimeout(hintTimer); hintEl.textContent = ""; }
  function tap(i) {
    if (won) return;
    clearHint();
    if (sel === null) { if (tubes[i].length) sel = i; return render(); }
    if (sel === i) { sel = null; return render(); }
    const m = WS.legal(tubes, sel, i);
    if (!m) {
      if (tubes[i].length) { sel = i; hintEl.textContent = ""; } else sel = null;
      hintEl.textContent = "Can't pour there: the top colours differ or the tube is full.";
      return render();
    }
    plan = plan && plan.length && plan[0].from === sel && plan[0].to === i ? plan.slice(1) : null;
    tubes = WS.pour(tubes, m); log.push([sel, i]); lastTo = i; sel = null;
    hintEl.textContent = "";
    if (WS.solved(tubes)) return win();
    render();
  }
  function win() {
    won = true; sel = null;
    const key = "best:" + diff, b = Number(store.get(key, 0)), n = log.length;
    if (!b || n < b) store.set(key, n);
    bestEl.textContent = store.get(key, String(n));
    statusEl.textContent = "You won! Sorted in " + n + " moves. " + Gamekit.taunt("win");
    resumer.clear();
    render();
  }
  function undo() {
    if (!log.length || won) return;
    clearHint(); sel = null; lastTo = null;
    log.pop(); plan = null;
    replay();
    render();
  }
  // rebuild the tubes from the start by replaying the log
  function replay() { tubes = WS.clone(first); for (const [a, b] of log) { const m = WS.legal(tubes, a, b); if (!m) break; tubes = WS.pour(tubes, m); } }

  hintBtn.addEventListener("click", () => {
    if (won) return;
    sel = null; clearHint();
    if (!plan || !plan.length) plan = WS.solve(tubes, 60000);
    if (!plan || !plan.length) { plan = null; hintEl.textContent = "I can't find a way out from here. Try undo."; return render(); }
    hintMove = plan[0];
    hintEl.textContent = "Pour the green tube into the yellow one.";
    hintTimer = setTimeout(clearHint, 4000);
    render();
  });
  symBtn.addEventListener("click", () => { showLetters = !showLetters; store.set("letters", showLetters ? "1" : "0"); render(); });

  function start(seed) {
    curSeed = seed;
    const p = WS.generate(seed, diff) || WS.generate(seed + 1, diff);
    first = p.tubes.map((t) => t.slice()); tubes = WS.clone(first);
    log = []; won = false; sel = null; lastTo = null; plan = null; clearHint();
    bestEl.textContent = store.get("best:" + diff, "—");
    statusEl.textContent = "Sort the colours.";
    render();
  }
  const chips = Gamekit.wireDifficultyChips({
    el: chipsEl, difficulties: ["easy", "medium", "hard"], initial: diff, storage: store, storageKey: "diff",
    onChange: (d) => { diff = d; start(Gamekit.dailySeed("water-sort", diff)); },
  });
  diff = chips.get();
  undoBtn.addEventListener("click", undo);
  resetBtn.addEventListener("click", () => { log = []; tubes = WS.clone(first); won = false; sel = null; lastTo = null; plan = null; clearHint(); statusEl.textContent = "Sort the colours."; render(); });
  newBtn.addEventListener("click", () => start(Gamekit.randomSeed()));

  // ---------- keeping the game across a refresh: the puzzle is rebuilt from its seed and the pours replayed ----------
  const resumer = Gamekit.resume("water-sort", () => (won || !log.length) ? null : { seed: curSeed, diff, log }, (s) => {
    if (!WS.LEVELS[s.diff] || !Number.isInteger(s.seed) || !Array.isArray(s.log) || s.log.length > 2000) return false;
    diff = s.diff; chips.show(diff);
    start(s.seed);
    for (const m of s.log) {
      if (!Array.isArray(m) || m.length !== 2) break;
      const mv = WS.legal(tubes, m[0], m[1]);
      if (!mv) break;
      tubes = WS.pour(tubes, mv); log.push([m[0], m[1]]);
    }
    render();
    return true;
  });

  if (!resumer.restore()) start(Gamekit.dailySeed("water-sort", diff));
  window.addEventListener("load", () => Manpage.autoOpen("water-sort"));
})();
