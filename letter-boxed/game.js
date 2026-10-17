(function () {
  "use strict";

  const LB = globalThis.LetterBoxed;
  const $ = (id) => document.getElementById(id);
  const boxEl = $("box"), wordEl = $("word"), msgEl = $("msg"), chainEl = $("chain"), statusEl = $("status"), countEl = $("count"), bestEl = $("best");
  const hintEl = $("hint"), delBtn = $("del-btn"), enterBtn = $("enter-btn"), undoBtn = $("undo-btn"), hintBtn = $("hint-btn"), resetBtn = $("reset-btn"), newBtn = $("new-btn"), chipsEl = $("chips");
  const store = Gamekit.storage("letter-boxed:");

  let diff = store.get("diff", "medium");
  if (!LB.LEVELS[diff]) diff = "medium";
  let dict = null, puzzle = null, validSet = null, curSeed = 0;
  let sideOf = {}, pos = {};            // letter -> side; letter -> [x, y] on the 100x100 drawing
  let chain = [];                       // accepted words
  let cur = "";                         // the word being spelled (starts with the last letter of the chain)
  let hints = 0, won = false, gaveUp = false;
  let btns = {};

  // ---------- the box ----------
  // letter circles sit just outside the square, three along each side
  const SPOTS = [[35, 10], [50, 10], [65, 10], [90, 35], [90, 50], [90, 65], [65, 90], [50, 90], [35, 90], [10, 65], [10, 50], [10, 35]];
  function build() {
    boxEl.innerHTML = "";
    sideOf = {}; pos = {}; btns = {};
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 100 100");
    svg.innerHTML = '<rect class="lb-sq" x="20" y="20" width="60" height="60"/>';
    const dots = [[35, 20], [50, 20], [65, 20], [80, 35], [80, 50], [80, 65], [65, 80], [50, 80], [35, 80], [20, 65], [20, 50], [20, 35]];
    dots.forEach(([x, y]) => { const c = document.createElementNS("http://www.w3.org/2000/svg", "circle"); c.setAttribute("class", "lb-dot"); c.setAttribute("cx", x); c.setAttribute("cy", y); c.setAttribute("r", 1.3); svg.append(c); });
    const lines = document.createElementNS("http://www.w3.org/2000/svg", "g"); lines.id = "lines"; svg.append(lines);
    boxEl.append(svg);
    // the sides go clockwise from the top: top, right, bottom, left
    puzzle.sides.forEach((letters, s) => {
      letters.split("").forEach((l, k) => {
        const [x, y] = SPOTS[s * 3 + k];
        sideOf[l] = s; pos[l] = [x, y];
        const b = document.createElement("button");
        b.type = "button"; b.className = "lb-l"; b.textContent = l; b.style.left = x + "%"; b.style.top = y + "%";
        b.setAttribute("aria-label", "letter " + l.toUpperCase());
        b.addEventListener("click", () => tap(l));
        boxEl.append(b); btns[l] = b;
      });
    });
  }

  const used = () => new Set(chain.join("") + cur);
  const lastLetter = () => (chain.length ? chain[chain.length - 1].slice(-1) : "");
  const startLock = () => (chain.length ? 1 : 0);                // the first letter of a later word is the previous word's last

  function drawLines() {
    const g = document.getElementById("lines");
    if (!g) return;
    g.innerHTML = "";
    const path = (word, cls) => {
      const p = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
      p.setAttribute("class", cls);
      p.setAttribute("points", word.split("").map((l) => pos[l].join(",")).join(" "));
      g.append(p);
    };
    chain.forEach((w) => path(w, "lb-old"));
    if (cur.length > 1) path(cur, "lb-now");
  }

  function render() {
    const u = used();
    const last = cur ? sideOf[cur[cur.length - 1]] : -1;
    Object.keys(btns).forEach((l) => {
      btns[l].classList.toggle("used", u.has(l));
      btns[l].classList.toggle("cur", cur.length > 0 && cur[cur.length - 1] === l);
      btns[l].disabled = won || gaveUp || (cur.length > 0 && sideOf[l] === last);
    });
    drawLines();
    const locked = startLock() ? cur.slice(0, 1) : "";
    wordEl.innerHTML = "";
    if (locked) { const s = document.createElement("span"); s.className = "lock"; s.textContent = locked; wordEl.append(s, document.createTextNode(cur.slice(1))); }
    else wordEl.textContent = cur;
    chainEl.innerHTML = "";
    chain.forEach((w) => { const s = document.createElement("span"); s.textContent = w; chainEl.append(s); });
    countEl.textContent = String(chain.length);
    delBtn.disabled = won || gaveUp || cur.length <= startLock();
    enterBtn.disabled = won || gaveUp || cur.length < 3;
    undoBtn.disabled = won || gaveUp || !chain.length;
    hintBtn.disabled = won || gaveUp || hints >= 2;
    const left = 12 - u.size;
    if (!won && !gaveUp) statusEl.textContent = left === 12 ? "Use all 12 letters." : left + " letter" + (left === 1 ? "" : "s") + " left.";
  }

  function say(text, bad) { msgEl.textContent = text; msgEl.classList.toggle("bad", !!bad); }

  // ---------- spelling ----------
  function tap(l) {
    if (won || gaveUp) return;
    if (cur.length && sideOf[l] === sideOf[cur[cur.length - 1]]) { say("Two letters in a row can't come from the same side.", true); return; }
    if (!cur.length && chain.length) cur = lastLetter();
    cur += l; say(""); render();
  }
  function del() { if (cur.length > startLock()) { cur = cur.slice(0, -1); if (cur.length === 1 && chain.length) cur = ""; say(""); render(); } }
  function enter() {
    if (cur.length < 3) return;
    const r = LB.check(puzzle, validSet, cur, chain, lastLetter());
    if (r !== "ok") { say(r, true); return; }
    chain.push(cur); cur = ""; say(""); hintEl.textContent = "";
    if (used().size === 12) return win();
    render();
  }
  function win() {
    won = true; render();
    const n = chain.length, key = "best:" + diff, b = Number(store.get(key, 0));
    if (!b || n < b) store.set(key, n);
    bestEl.textContent = store.get(key, "—");
    statusEl.textContent = (n <= 2 ? "Solved in " + n + ". That's par! " : "Solved in " + n + " words. ") + Gamekit.taunt("win");
    say("You used every letter" + (n > 2 ? ". There's a way in 2." : "!"));
    resumer.clear();
  }
  function undoWord() { if (chain.length) { chain.pop(); cur = ""; say(""); render(); } }
  function hint() {
    if (hints >= 2) return;
    hints++;
    hintEl.textContent = "A way in two: " + puzzle.solution.slice(0, hints).join(" → ").toUpperCase() + (hints < 2 ? " → …" : "");
    render();
  }
  function reset() { chain = []; cur = ""; hints = 0; won = false; gaveUp = false; hintEl.textContent = ""; say(""); render(); }

  // ---------- starting a puzzle ----------
  function start(seed) {
    curSeed = seed;
    puzzle = LB.generate(dict, seed, diff);
    if (!puzzle) puzzle = LB.generate(dict, seed + 1, diff);
    validSet = new Set(puzzle.valid);
    chain = []; cur = ""; hints = 0; won = false; gaveUp = false; hintEl.textContent = ""; say("");
    bestEl.textContent = store.get("best:" + diff, "—");
    build(); render();
  }

  // ---------- controls ----------
  const chips = Gamekit.wireDifficultyChips({
    el: chipsEl, difficulties: ["easy", "medium", "hard"], initial: diff, storage: store, storageKey: "diff",
    onChange: (d) => { diff = d; if (dict) start(Gamekit.dailySeed("letter-boxed", diff)); },
  });
  diff = chips.get();
  delBtn.addEventListener("click", del);
  enterBtn.addEventListener("click", enter);
  undoBtn.addEventListener("click", undoWord);
  hintBtn.addEventListener("click", hint);
  resetBtn.addEventListener("click", reset);
  newBtn.addEventListener("click", () => { if (dict) start(Gamekit.randomSeed()); });
  document.addEventListener("keydown", (e) => {
    if (!puzzle || e.ctrlKey || e.metaKey || e.altKey || document.querySelector(".man-backdrop")) return;
    if (e.key === "Enter") { e.preventDefault(); enter(); }
    else if (e.key === "Backspace") { e.preventDefault(); del(); }
    else if (/^[a-zA-Z]$/.test(e.key) && btns[e.key.toLowerCase()] && !btns[e.key.toLowerCase()].disabled) tap(e.key.toLowerCase());
  });

  // ---------- keeping the game across a refresh ----------
  const resumer = Gamekit.resume("letter-boxed", () => (!puzzle || won || (!chain.length && !cur && !hints)) ? null : { seed: curSeed, diff, chain, cur, hints }, (s) => {
    if (!LB.LEVELS[s.diff] || !Number.isInteger(s.seed) || !Array.isArray(s.chain) || typeof s.cur !== "string") return false;
    diff = s.diff; chips.show(diff);
    start(s.seed);
    // only accept the saved words if they really belong to this box and chain together
    let prev = "";
    for (const w of s.chain) {
      if (typeof w !== "string" || !validSet.has(w) || (prev && w[0] !== prev.slice(-1)) || chain.includes(w)) break;
      chain.push(w); prev = w;
    }
    cur = typeof s.cur === "string" && s.cur.split("").every((l) => sideOf[l] !== undefined) && s.cur.length <= 30 ? s.cur : "";
    if (cur && chain.length && cur[0] !== chain[chain.length - 1].slice(-1)) cur = "";
    hints = Math.min(2, Number(s.hints) || 0);
    if (hints) hintEl.textContent = "A way in two: " + puzzle.solution.slice(0, hints).join(" → ").toUpperCase() + (hints < 2 ? " → …" : "");
    render();
    return true;
  });

  // ---------- load the word list, then play ----------
  fetch("words.txt").then((r) => { if (!r.ok) throw new Error(r.status); return r.text(); }).then((text) => {
    dict = LB.parseWords(text);
    start(Gamekit.dailySeed("letter-boxed", diff));
    resumer.restore();
  }).catch(() => { statusEl.textContent = "Couldn't load the word list. Check your connection and reload."; });
  window.addEventListener("load", () => Manpage.autoOpen("letter-boxed"));
})();
