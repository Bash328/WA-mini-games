(function () {
  "use strict";

  const WS = globalThis.WaterSort;
  const $ = (id) => document.getElementById(id);
  const tubesEl = $("tubes"), statusEl = $("status"), movesEl = $("moves"), bestEl = $("best"), hintEl = $("hint");
  const undoBtn = $("undo-btn"), resetBtn = $("reset-btn"), newBtn = $("new-btn"), hintBtn = $("hint-btn"), symBtn = $("sym-btn"), chipsEl = $("chips");
  const store = Gamekit.storage("water-sort:");

  // twelve colours that stay apart, and a letter for each (for anyone who can't tell colours apart)
  const COLORS = ["#f0143c", "#0a84e0", "#1ab51a", "#ffd400", "#f433d8", "#ff7a00", "#12c9b4", "#ff8fb3", "#9aa5b1", "#a0602a", "#3a4bd6", "#b6e32b"];
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
  // The pour: the source tube lifts, tips over the target and a coloured stream falls into it; the new state is drawn when it ends.
  let animating = false;
  const calm = () => !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);
  function pourAnim(from, to, colour, done) {
    const a = tubesEl.children[from], b = tubesEl.children[to];
    if (!a || !b || !a.animate || calm()) return done();
    animating = true;
    const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
    const side = rb.left >= ra.left ? 1 : -1;
    // The selected tube is lifted by a CSS transform. Work from its untransformed box, and start the
    // animation from wherever it currently is so a quick tap cannot make it jump.
    const tf = getComputedStyle(a).transform;
    const m = tf && tf !== "none" ? new DOMMatrixReadOnly(tf) : null;
    const startX = m ? m.m41 : 0, startY = m ? m.m42 : 0;
    const baseLeft = ra.left - startX, baseTop = ra.top - startY;
    // When the tube tips, its rim turns about the top-centre origin. The lower corner of that rim
    // (the pouring lip) is what the stream must start from, not a point at the target's top.
    const tip = 62 * Math.PI / 180;
    const lipShiftX = side * (ra.width / 2) * Math.cos(tip);
    const lipShiftY = (ra.width / 2) * Math.sin(tip);
    const lipX = rb.left + rb.width / 2, lipY = rb.top - 8;                        // the lip hovers over the middle of the glass
    const dx = lipX - (baseLeft + ra.width / 2) - lipShiftX;
    const dy = lipY - baseTop - lipShiftY;
    const layer = rb.height * 0.185, surface = rb.bottom - rb.height * 0.015 - b.children.length * layer;   // four layers fill the glass to about 3/4 of its height
    const stream = document.createElement("div");
    stream.className = "ws-stream";
    stream.style.cssText = "left:" + (lipX - 4) + "px;top:" + lipY + "px;background:" + colour + ";height:0";
    document.body.append(stream);
    a.style.zIndex = "5"; a.style.transformOrigin = "50% 0";
    const hold = "translate(" + dx + "px," + dy + "px) rotate(" + side * 62 + "deg)";
    const run = a.animate([
      { transform: "translate(" + startX + "px," + startY + "px) rotate(0deg)", offset: 0, easing: "cubic-bezier(.35,.05,.25,1)" },
      { transform: hold, offset: 0.34, easing: "linear" },
      { transform: hold, offset: 0.78, easing: "cubic-bezier(.45,0,.3,1)" },
      { transform: "translate(0,0) rotate(0deg)", offset: 1 },
    ], { duration: 820 });
    const h = Math.max(10, surface - lipY);
    const T = lipY + "px", S = surface + "px";
    stream.animate([                                                   // a stream that grows down to the liquid, holds, then drains away
      { height: "0px", top: T, opacity: 0, offset: 0 },
      { height: "0px", top: T, opacity: 1, offset: 0.31, easing: "cubic-bezier(.2,.7,.3,1)" },
      { height: h + "px", top: T, opacity: 1, offset: 0.46 },
      { height: h + "px", top: T, opacity: 1, offset: 0.76, easing: "cubic-bezier(.4,0,.5,1)" },
      { height: "0px", top: S, opacity: 0, offset: 0.9 },
      { height: "0px", top: S, opacity: 0, offset: 1 },
    ], { duration: 820 });
    run.onfinish = run.oncancel = () => { stream.remove(); a.style.zIndex = ""; a.style.transformOrigin = ""; animating = false; done(); };
  }

  function tap(i) {
    if (won || animating) return;
    clearHint();
    if (sel === null) { if (tubes[i].length) sel = i; return render(); }
    if (sel === i) { sel = null; return render(); }
    const m = WS.legal(tubes, sel, i);
    if (!m) {
      if (tubes[i].length) { sel = i; hintEl.textContent = ""; } else sel = null;
      hintEl.textContent = "Can't pour there: the top colours differ or the tube is full.";
      return render();
    }
    const from = sel, colour = COLORS[tubes[from][tubes[from].length - 1]];
    pourAnim(from, i, colour, () => {
      plan = plan && plan.length && plan[0].from === from && plan[0].to === i ? plan.slice(1) : null;
      tubes = WS.pour(tubes, m); log.push([from, i]); lastTo = i; sel = null;
      hintEl.textContent = "";
      if (WS.solved(tubes)) return win();
      render();
    });
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
    if (!log.length || won || animating) return;
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
