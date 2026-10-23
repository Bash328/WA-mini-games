(function () {
  "use strict";

  const LEN = 4;
  const RANGE = { easy: [3, 4], medium: [5, 6], hard: [7, 10] };   // shortest ladder length per difficulty
  const KEYS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];

  const listEl = document.getElementById("ladder");
  const kbEl = document.getElementById("kb");
  const statusEl = document.getElementById("status");
  const stepsEl = document.getElementById("steps");
  const chipsEl = document.getElementById("chips");
  const newBtn = document.getElementById("new-btn");
  const undoBtn = document.getElementById("undo-btn");
  const hintBtn = document.getElementById("hint-btn"), submitBtn = document.getElementById("submit-btn");
  const resetBtn = document.getElementById("reset-btn");
  const store = Gamekit.storage("word-ladder:");

  let diff = store.get("diff", "easy");
  if (!RANGE[diff]) diff = "easy";

  // ---------- the word graph ----------
  const ALL = window.LADDER_WORDS.split(" ");
  const index = new Map(ALL.map((w, i) => [w, i]));
  const adj = ALL.map((w) => {
    const out = [];
    for (let p = 0; p < LEN; p++) for (let c = 97; c < 123; c++) {
      const x = w.slice(0, p) + String.fromCharCode(c) + w.slice(p + 1);
      if (x !== w && index.has(x)) out.push(index.get(x));
    }
    return out;
  });
  // puzzles only use the biggest connected group, so every start can reach every target
  const pool = (function () {
    const seen = new Int32Array(ALL.length).fill(-1); let best = [];
    for (let i = 0; i < ALL.length; i++) {
      if (seen[i] >= 0) continue;
      const q = [i]; seen[i] = i;
      for (let h = 0; h < q.length; h++) for (const j of adj[q[h]]) if (seen[j] < 0) { seen[j] = i; q.push(j); }
      if (q.length > best.length) best = q;
    }
    return best;
  })();

  // breadth-first from `from`: distances and the way back
  function bfs(from) {
    const dist = new Int16Array(ALL.length).fill(-1), prev = new Int32Array(ALL.length).fill(-1);
    dist[from] = 0; const q = [from];
    for (let h = 0; h < q.length; h++) for (const j of adj[q[h]]) if (dist[j] < 0) { dist[j] = dist[q[h]] + 1; prev[j] = q[h]; q.push(j); }
    return { dist, prev };
  }
  const oneApart = (a, b) => { let d = 0; for (let i = 0; i < LEN; i++) if (a[i] !== b[i]) d++; return d === 1; };

  // A start and a target `par` steps apart, chosen from the seed (bounded by attempts, never by the clock).
  function generate(seed) {
    const rng = Gamekit.mulberry32(seed);
    const [lo, hi] = RANGE[diff];
    for (let attempt = 0; attempt < 400; attempt++) {
      const s = pool[Math.floor(rng() * pool.length)];
      const { dist } = bfs(s);
      const targets = pool.filter((j) => dist[j] >= lo && dist[j] <= hi);
      if (!targets.length) continue;
      const t = targets[Math.floor(rng() * targets.length)];
      return { start: ALL[s], target: ALL[t], par: dist[t] };
    }
    return { start: "cold", target: "warm", par: 4 };            // always in the list and 4 steps apart
  }

  // ---------- state ----------
  let puzzle = null, chain = [], current = "", hints = 0, done = false, curSeed = 0;

  // ---------- drawing ----------
  function row(word, cls, prev) {
    const r = document.createElement("div");
    r.className = "wl-row " + cls;
    for (let i = 0; i < LEN; i++) {
      const t = document.createElement("div");
      t.className = "wl-tile" + (prev && word[i] && word[i] !== prev[i] ? " chg" : "");
      t.textContent = (word[i] || "").toUpperCase();
      r.appendChild(t);
    }
    return r;
  }
  function render() {
    listEl.innerHTML = "";
    listEl.appendChild(row(puzzle.start, "start"));
    for (let i = 1; i < chain.length; i++) listEl.appendChild(row(chain[i], i === chain.length - 1 && done ? "win" : "step", chain[i - 1]));
    if (!done) {
      const r = row(current.padEnd(LEN, " "), "input", chain[chain.length - 1]);
      r.id = "wl-input";
      listEl.appendChild(r);
      const gap = document.createElement("div"); gap.className = "wl-gap"; gap.textContent = "⋮"; listEl.appendChild(gap);
      listEl.appendChild(row(puzzle.target, "target"));
    }
    stepsEl.textContent = String(chain.length - 1);
    const parEl = document.getElementById("par"); if (parEl) parEl.textContent = String(puzzle.par);
    undoBtn.disabled = done || chain.length < 2;
    hintBtn.disabled = done || hints >= 1;
    submitBtn.disabled = done || current.length < LEN;
    kbEl.hidden = done;
  }
  const say = (t) => { statusEl.textContent = t; };
  function shake() { const r = document.getElementById("wl-input"); if (r) { r.classList.remove("shake"); void r.offsetWidth; r.classList.add("shake"); } }

  // ---------- playing ----------
  function press(k) {
    if (done) return;
    if (k === "back") { current = current.slice(0, -1); say(""); return render(); }
    if (k === "enter") return submit();
    if (/^[a-z]$/.test(k) && current.length < LEN) { current += k; say(""); render(); }
  }
  function submit() {
    const last = chain[chain.length - 1];
    if (current.length < LEN) { say("Four letters, please."); return shake(); }
    if (!index.has(current)) { say("Not in the word list."); return shake(); }
    if (!oneApart(last, current)) { say("Change exactly one letter."); return shake(); }
    if (chain.includes(current)) { say("You already used that word."); return shake(); }
    chain.push(current); current = "";
    if (chain[chain.length - 1] === puzzle.target) return win();
    say(""); render();
  }
  function win() {
    done = true;
    const steps = chain.length - 1;
    const extra = steps - puzzle.par;
    const key = "best:" + diff;
    const best = store.getInt(key, null);
    if (hints === 0 && (best === null || extra < best)) store.set(key, extra);
    say((extra === 0 ? "Solved. Perfect! " : "Solved. ") + steps + " steps" + (extra > 0 ? " (" + extra + " more than the shortest)" : "") + (hints ? ", " + hints + " hint" + (hints > 1 ? "s" : "") : "") + ".");
    render();
  }
  function undo() { if (done || chain.length < 2) return; chain.pop(); current = ""; say(""); render(); }
  submitBtn.addEventListener("click", () => press("enter"));
  hintBtn.addEventListener("click", () => {
    if (done || hints >= 1) return;
    // the next word on a shortest way from where you are to the target
    const from = index.get(chain[chain.length - 1]), to = index.get(puzzle.target);
    const { prev } = bfs(to);                 // walk from the target back toward `from`
    const next = prev[from];
    if (next < 0) return;
    hints = 1;
    current = ALL[next];
    say("Hint used. Press Submit to take that step.");
    render();
  });
  undoBtn.addEventListener("click", undo);
  resetBtn.addEventListener("click", () => { chain = [puzzle.start]; current = ""; done = false; say(""); render(); });     // the hint belongs to the puzzle: keep it spent

  // ---------- keyboard, puzzles ----------
  function build() {
    kbEl.innerHTML = "";
    KEYS.forEach((letters, ri) => {
      const r = document.createElement("div"); r.className = "wl-kbrow";
      const mk = (label, value, wide) => { const b = document.createElement("button"); b.type = "button"; b.className = "wl-key" + (wide ? " wide" : ""); b.textContent = label; b.dataset.k = value; b.setAttribute("aria-label", value === "back" ? "Delete" : value === "enter" ? "Enter" : label); b.addEventListener("click", () => press(value)); return b; };
      for (const ch of letters) r.appendChild(mk(ch, ch));
      if (ri === 2) r.appendChild(mk("⌫", "back", true));
      kbEl.appendChild(r);
    });
  }
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.target.closest("input, select, textarea") || document.querySelector(".man-backdrop")) return;
    if (e.key === "Enter") { if (!e.target.closest("button") || e.target.closest("#kb")) { e.preventDefault(); press("enter"); } }
    else if (e.key === "Backspace") press("back");
    else if (/^[a-zA-Z]$/.test(e.key)) press(e.key.toLowerCase());
  });

  // After tapping a button, hand the keyboard back to the game (otherwise Enter would press that button again).
  document.addEventListener("click", (e) => { const b = e.target.closest && e.target.closest("button"); if (b && !b.closest("#kb") && b.blur) b.blur(); });

  function newPuzzle(seedOverride) {
    curSeed = seedOverride !== undefined ? seedOverride : Gamekit.dailySeed("word-ladder", diff);
    puzzle = generate(curSeed);
    chain = [puzzle.start]; current = ""; hints = 0; done = false;
    say("Turn " + puzzle.start.toUpperCase() + " into " + puzzle.target.toUpperCase() + ", one letter at a time.");
    render();
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  }
  newBtn.addEventListener("click", () => newPuzzle(Gamekit.randomSeed()));
  const chips = Gamekit.wireDifficultyChips({
    el: chipsEl, difficulties: ["easy", "medium", "hard"], initial: diff, storage: store, storageKey: "diff",
    onChange: (d) => { diff = d; newPuzzle(); },
  });
  diff = chips.get();

  build();
  newPuzzle();

  // A refresh keeps the puzzle and the steps so far.
  const resumer = Gamekit.resume("word-ladder", () => (done || chain.length < 2) ? null : { diff, seed: curSeed, chain, current, hints }, (s) => {
    if (!RANGE[s.diff] || !Number.isInteger(s.seed) || !Array.isArray(s.chain) || s.chain.length < 2) return false;
    diff = s.diff; chips.show(diff);
    newPuzzle(s.seed);
    if (s.chain[0] !== puzzle.start) return false;
    for (let i = 1; i < s.chain.length; i++) if (!index.has(s.chain[i]) || !oneApart(s.chain[i - 1], s.chain[i])) return false;
    chain = s.chain.slice(); current = typeof s.current === "string" ? s.current.replace(/[^a-z]/g, "").slice(0, LEN) : ""; hints = Math.min(1, Number.isInteger(s.hints) ? s.hints : 0);
    say(""); render();
    return true;
  });
  resumer.restore();
  window.addEventListener("load", () => Manpage.autoOpen("word-ladder"));
})();
