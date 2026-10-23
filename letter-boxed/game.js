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
  let sideOf = {}, pos = {};            // letter -> side; letter -> its dot on the box edge (0..100 drawing units)
  let chain = [];                       // accepted words
  let cur = "";                         // the word being spelled. After a word it holds that word's last letter, which the next word must start with
  let hints = 0, won = false;
  let btns = {}, dots = {};

  // ---------- the box ----------
  // a square from 22 to 78 with three dots on each side, a letter circle outside each dot; sides run clockwise from the top
  const A = [31.3, 50, 68.7], LO = 22, HI = 78, OUT = 11, FAR = 89;
  function spots(s, k) {
    if (s === 0) return { l: [A[k], OUT], d: [A[k], LO] };
    if (s === 1) return { l: [FAR, A[k]], d: [HI, A[k]] };
    if (s === 2) return { l: [A[2 - k], FAR], d: [A[2 - k], HI] };
    return { l: [OUT, A[2 - k]], d: [LO, A[2 - k]] };
  }
  const NS = "http://www.w3.org/2000/svg";
  function svgEl(tag, attrs) { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; }
  function build() {
    boxEl.innerHTML = "";
    sideOf = {}; pos = {}; btns = {}; dots = {};
    const svg = svgEl("svg", { viewBox: "0 0 100 100" });
    svg.append(svgEl("rect", { class: "lb-sq", x: LO, y: LO, width: HI - LO, height: HI - LO, rx: 1.5 }));
    const lines = svgEl("g", { id: "lines" });
    svg.append(lines);
    boxEl.append(svg);
    puzzle.sides.forEach((letters, s) => {
      letters.split("").forEach((l, k) => {
        const p = spots(s, k);
        sideOf[l] = s; pos[l] = p.d;
        const dot = svgEl("circle", { class: "lb-dot", cx: p.d[0], cy: p.d[1], r: 1.5 });
        svg.append(dot); dots[l] = dot;
        const b = document.createElement("button");
        b.type = "button"; b.className = "lb-l"; b.textContent = l; b.style.left = p.l[0] + "%"; b.style.top = p.l[1] + "%";
        b.setAttribute("aria-label", "letter " + l.toUpperCase());
        // a pointer press starts (or continues) a word; swiping carries on from letter to letter. A keyboard press is a click with no pointer.
        b.addEventListener("click", (e) => { if (e.detail === 0) tap(l); });
        boxEl.append(b); btns[l] = b;
      });
    });
    // keep the lines above the dots but under nothing: move the group last
    svg.append(lines);
  }

  const used = () => new Set(chain.join("") + cur);
  const lastLetter = () => (chain.length ? chain[chain.length - 1].slice(-1) : "");
  const lockLen = () => (chain.length ? 1 : 0);                 // the first letter of a later word is the previous word's last, already placed

  function drawLines() {
    const g = document.getElementById("lines");
    if (!g) return;
    g.innerHTML = "";
    if (cur.length > 1) g.append(svgEl("polyline", { class: "lb-now", points: cur.split("").map((l) => pos[l].join(",")).join(" ") }));
    Object.keys(dots).forEach((l) => dots[l].classList.toggle("on", used().has(l)));
  }

  function render() {
    const u = used();
    const last = cur ? sideOf[cur[cur.length - 1]] : -1;
    Object.keys(btns).forEach((l) => {
      btns[l].classList.toggle("used", u.has(l));
      btns[l].classList.toggle("cur", cur.length > 0 && cur[cur.length - 1] === l);
      btns[l].classList.toggle("start", !won && chain.length > 0 && cur.length === 1 && cur === l);
      btns[l].disabled = won || (cur.length > 0 && sideOf[l] === last && !(cur.length === lockLen() && cur === l));
    });
    drawLines();
    wordEl.innerHTML = "";
    if (cur.length <= lockLen() && !cur.slice(lockLen())) {
      if (chain.length && cur) { const s = document.createElement("span"); s.className = "lock"; s.textContent = cur; const ph = document.createElement("span"); ph.className = "ph"; ph.textContent = "  next word starts here"; wordEl.append(s, ph); }
      else { const ph = document.createElement("span"); ph.className = "ph"; ph.textContent = "Tap or swipe the letters"; wordEl.append(ph); }
    } else if (lockLen()) { const s = document.createElement("span"); s.className = "lock"; s.textContent = cur[0]; wordEl.append(s, document.createTextNode(cur.slice(1))); }
    else wordEl.textContent = cur;
    chainEl.innerHTML = "";
    chain.forEach((w) => { const s = document.createElement("span"); s.textContent = w; chainEl.append(s); });
    countEl.textContent = String(chain.length);
    delBtn.disabled = won || cur.length <= lockLen();
    enterBtn.disabled = won || cur.length < 3;
    undoBtn.disabled = won || !chain.length;
    hintBtn.disabled = won || hints >= 1;
    const left = 12 - u.size;
    if (!won) statusEl.textContent = left === 12 ? "Use all 12 letters." : left + " letter" + (left === 1 ? "" : "s") + " left.";
  }

  function say(text, bad) { msgEl.textContent = text; msgEl.classList.toggle("bad", !!bad); }

  // ---------- spelling ----------
  function tap(l) {
    if (won) return;
    if (cur.length === lockLen() && lockLen() && cur === l) return;            // that letter is already where the next word starts
    if (cur.length && sideOf[l] === sideOf[cur[cur.length - 1]]) { say("Two letters in a row can't come from the same side.", true); return; }
    cur += l; say(""); render();
  }
  function del() { if (cur.length > lockLen()) { cur = cur.slice(0, -1); say(""); render(); } }
  function enter() {
    if (cur.length < 3) return;
    const r = LB.check(puzzle, validSet, cur, chain.slice(0, chain.length), chain.length ? lastLetter() : "");
    if (r !== "ok") { say(r, true); return; }
    chain.push(cur); hintEl.textContent = "";
    cur = lastLetter();
    if (used().size === 12) return win();
    say("Good. Your next word starts with " + cur.toUpperCase() + ".");
    render();
  }
  function win() {
    won = true; cur = ""; render();
    const n = chain.length, key = "best:" + diff, b = Number(store.get(key, 0));
    if (!b || n < b) store.set(key, n);
    bestEl.textContent = store.get(key, "—");
    statusEl.textContent = (n <= 2 ? "Solved in " + n + ". That's par! " : "Solved in " + n + " words. ") + Gamekit.taunt("win");
    say("You used every letter" + (n > 2 ? ". There's a way in 2." : "!"));
    resumer.clear();
  }
  function undoWord() { if (chain.length) { chain.pop(); cur = chain.length ? lastLetter() : ""; say(""); render(); } }
  function hint() {
    if (hints >= 1) return;
    hints = 1;
    hintEl.textContent = "A way in two: " + puzzle.solution.slice(0, hints).join(" → ").toUpperCase() + (hints < 2 ? " → …" : "");
    render();
  }
  function reset() { chain = []; cur = ""; won = false; say(""); render(); }     // the hint belongs to the puzzle: keep it spent and keep its text

  // ---------- swiping ----------
  // Press a letter and slide over the others without lifting: each new letter is added (never one on the same side as the
  // last; the same letter twice in a row is ignored). A word that goes back to an earlier letter (n-i-n) just works.
  let dragging = false;
  // a letter counts only when the finger is over the middle of its circle, so sliding past the edge of one on the way to another
  // doesn't pick it up
  const letterAt = (x, y) => {
    const e = document.elementFromPoint(x, y), b = e && e.closest ? e.closest(".lb-l") : null;
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return Math.hypot(x - (r.left + r.width / 2), y - (r.top + r.height / 2)) <= r.width * 0.31 ? b.textContent.toLowerCase() : null;
  };
  boxEl.addEventListener("pointerdown", (e) => {
    const b = e.target.closest && e.target.closest(".lb-l");
    if (!b || won) return;
    e.preventDefault();
    dragging = true;
    tap(b.textContent.toLowerCase());
  });
  window.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const l = letterAt(e.clientX, e.clientY);
    if (!l || !cur || l === cur[cur.length - 1]) return;
    if (sideOf[l] === sideOf[cur[cur.length - 1]]) return;                                                      // can't follow: ignore quietly while sliding
    tap(l);
  });
  const endDrag = () => { dragging = false; };
  window.addEventListener("pointerup", endDrag);
  window.addEventListener("pointercancel", endDrag);

  // ---------- starting a puzzle ----------
  function start(seed) {
    curSeed = seed;
    puzzle = LB.generate(dict, seed, diff);
    if (!puzzle) puzzle = LB.generate(dict, seed + 1, diff);
    validSet = new Set(puzzle.valid);
    chain = []; cur = ""; hints = 0; won = false; hintEl.textContent = ""; say("");
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
  const resumer = Gamekit.resume("letter-boxed", () => (!puzzle || won || (!chain.length && cur.length <= lockLen() && !hints)) ? null : { seed: curSeed, diff, chain, cur, hints }, (s) => {
    if (!LB.LEVELS[s.diff] || !Number.isInteger(s.seed) || !Array.isArray(s.chain) || typeof s.cur !== "string") return false;
    diff = s.diff; chips.show(diff);
    start(s.seed);
    // only accept the saved words if they really belong to this box and chain together
    let prev = "";
    for (const w of s.chain) {
      if (typeof w !== "string" || !validSet.has(w) || (prev && w[0] !== prev.slice(-1)) || chain.includes(w)) break;
      chain.push(w); prev = w;
    }
    cur = chain.length ? lastLetter() : "";
    if (s.cur.length > cur.length && s.cur.length <= 30 && s.cur.split("").every((l) => sideOf[l] !== undefined) && (!cur || s.cur[0] === cur)) cur = s.cur;
    hints = Math.min(1, Number(s.hints) || 0);
    if (hints) hintEl.textContent = "A way in two: " + puzzle.solution.slice(0, hints).join(" → ").toUpperCase() + (hints < 2 ? " → …" : "");
    render();
    return true;
  });

  // ---------- load the word list, then play ----------
  fetch("words.txt").then((r) => { if (!r.ok) throw new Error(r.status); return r.text(); }).then((text) => {
    dict = LB.parseWords(text);
    if (!resumer.restore()) start(Gamekit.dailySeed("letter-boxed", diff));
  }).catch(() => { statusEl.textContent = "Couldn't load the word list. Check your connection and reload."; });
  window.addEventListener("load", () => Manpage.autoOpen("letter-boxed"));
})();
