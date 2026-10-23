(function () {
  "use strict";

  const ROWS = 6, COLS = 5;
  const ANSWERS = window.WORD_ANSWERS.split(" ");
  const VALID = new Set(window.WORD_GUESSES.split(" "));
  const KEYS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];

  const gridEl = document.getElementById("grid");
  const kbEl = document.getElementById("kb");
  const statusEl = document.getElementById("status");
  const statsEl = document.getElementById("stats");
  const chipsEl = document.getElementById("chips");
  const newBtn = document.getElementById("new-btn");
  const shareBtn = document.getElementById("share-btn");
  const store = Gamekit.storage("word-guess:");

  const today = () => new Date().toISOString().slice(0, 10);
  let mode = store.get("mode", "daily");            // "daily" | "random"
  if (mode !== "daily" && mode !== "random") mode = "daily";

  let answer = "", guesses = [], current = "", over = false, won = false;
  let busy = false;                                 // a row is flipping over
  let randomIdx = 0;
  let tiles = [], keyEls = {};

  // ---------- scoring a guess ----------
  // 'c' right letter, right place; 'p' in the word elsewhere; 'a' not in it. A repeated letter is only
  // marked as often as it appears in the answer.
  function score(guess, ans) {
    const out = new Array(COLS).fill("a"), left = {};
    for (let i = 0; i < COLS; i++) { if (guess[i] === ans[i]) out[i] = "c"; else left[ans[i]] = (left[ans[i]] || 0) + 1; }
    for (let i = 0; i < COLS; i++) if (out[i] !== "c" && left[guess[i]] > 0) { out[i] = "p"; left[guess[i]]--; }
    return out;
  }
  const EMOJI = { c: "🟩", p: "🟨", a: "⬛" };

  // ---------- drawing ----------
  function build() {
    gridEl.innerHTML = ""; tiles = [];
    for (let r = 0; r < ROWS; r++) {
      const row = document.createElement("div"); row.className = "wg-row";
      for (let c = 0; c < COLS; c++) { const t = document.createElement("div"); t.className = "wg-tile"; row.appendChild(t); tiles.push(t); }
      gridEl.appendChild(row);
    }
    kbEl.innerHTML = ""; keyEls = {};
    KEYS.forEach((letters, ri) => {
      const row = document.createElement("div"); row.className = "wg-kbrow";
      for (const ch of letters) row.appendChild(key(ch, ch));
      if (ri === 2) row.appendChild(key("⌫", "back", true));
      kbEl.appendChild(row);
    });
  }
  function key(label, value, wide) {
    const b = document.createElement("button");
    b.type = "button"; b.className = "wg-key" + (wide ? " wide" : ""); b.textContent = label; b.dataset.k = value;
    if (!wide) keyEls[value] = b;
    b.setAttribute("aria-label", value === "back" ? "Delete" : value === "enter" ? "Enter" : label);
    b.addEventListener("click", () => press(value));
    return b;
  }

  function render() {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const t = tiles[r * COLS + c];
        let letter = "", state = "";
        if (r < guesses.length) { letter = guesses[r][c]; state = score(guesses[r], answer)[c]; }
        else if (r === guesses.length) letter = current[c] || "";
        t.textContent = letter.toUpperCase();
        t.className = "wg-tile" + (state ? " " + state : "") + (letter && !state ? " filled" : "");
        t.setAttribute("aria-label", letter ? letter.toUpperCase() + (state === "c" ? ", correct" : state === "p" ? ", in the word, wrong place" : state === "a" ? ", not in the word" : "") : "empty");
      }
    }
    // keyboard colours: the best result seen for each letter (green beats yellow beats grey)
    const RANK = { a: 1, p: 2, c: 3 }, best = {};
    guesses.forEach((g) => score(g, answer).forEach((st, i) => { if (!best[g[i]] || RANK[st] > RANK[best[g[i]]]) best[g[i]] = st; }));
    for (const l in keyEls) keyEls[l].className = "wg-key" + (best[l] ? " " + best[l] : "");
    shareBtn.hidden = !over; renderHint();
    renderStats();
  }

  function stats() { return store.getJSON("stats", { played: 0, won: 0, streak: 0, max: 0, dist: [0, 0, 0, 0, 0, 0] }); }
  function renderStats() {
    const s = stats();
    document.getElementById("st-cur").textContent = s.streak; document.getElementById("st-best").textContent = s.max;
    statsEl.textContent = "Played " + s.played + " · Won " + s.won + " · Streak " + s.streak + " (best " + s.max + ")";
  }
  // one hint a game: names one letter of the word that is not yet green
  let hints = 1;
  const hintBtn = document.getElementById("hint-btn");
  function showHint() {
    if (over || hints < 1) return;
    const last = guesses[guesses.length - 1], open = [];
    for (let i = 0; i < COLS; i++) if (!last || last[i] !== answer[i]) open.push(i);
    const i = open[Math.floor(Math.random() * open.length)];
    hints--; say("Hint: letter " + (i + 1) + " is " + answer[i].toUpperCase() + "."); renderHint();
  }
  function renderHint() { document.getElementById("hint-n").textContent = hints; hintBtn.disabled = hints < 1 || over; }
  hintBtn.addEventListener("click", showHint);
  document.getElementById("submit-btn").addEventListener("click", () => press("enter"));
  const say = (t) => { statusEl.textContent = t; };
  function shake() {
    const row = gridEl.children[guesses.length];
    if (!row) return;
    row.classList.remove("shake"); void row.offsetWidth; row.classList.add("shake");
  }

  // ---------- playing ----------
  function press(k) {
    if (over || busy) return;
    if (k === "back") { current = current.slice(0, -1); say(""); return render(); }
    if (k === "enter") return submit();
    if (/^[a-z]$/.test(k) && current.length < COLS) { current += k; say(""); render(); }
  }
  function submit() {
    if (current.length < COLS) { say("Not enough letters."); return shake(); }
    if (!VALID.has(current)) { say("Not in the word list."); return shake(); }
    guesses.push(current); current = "";
    over = guesses[guesses.length - 1] === answer || guesses.length === ROWS;
    won = guesses[guesses.length - 1] === answer;
    busy = true; render();
    // a short reveal on the row just played
    const row = gridEl.children[guesses.length - 1];
    if (row) row.classList.add("reveal");
    setTimeout(() => { busy = false; if (row) row.classList.remove("reveal"); finishIfOver(); }, 450);
  }
  function finishIfOver() {
    if (!over) { say(""); return; }
    recordResult();
    say(won ? ["Genius!", "Magnificent!", "Impressive!", "Splendid!", "Great!", "Phew!"][guesses.length - 1] + " Solved in " + guesses.length + "/" + ROWS + "."
      : "Out of guesses. The word was " + answer.toUpperCase() + ". " + Gamekit.taunt("loss"));
    render();
  }
  function recordResult() {
    const key = mode === "daily" ? "done:" + today() : null;
    if (key) { if (store.get(key, null)) return; store.setJSON(key, { guesses: guesses }); }
    const s = stats();
    s.played++;
    if (won) { s.won++; s.streak++; s.dist[guesses.length - 1]++; if (s.streak > s.max) s.max = s.streak; } else s.streak = 0;
    store.setJSON("stats", s);
  }

  function dailyAnswer() { return ANSWERS[Gamekit.dailySeed("word-guess", "daily") % ANSWERS.length]; }

  function newGame(randomWord) {
    guesses = []; current = ""; over = false; won = false; busy = false; hints = 1;
    if (mode === "daily" && !randomWord) answer = dailyAnswer();
    else { randomIdx = Math.floor(Math.random() * ANSWERS.length); answer = ANSWERS[randomIdx]; }
    say(mode === "daily" ? "Today's word. Six guesses." : "A random word. Six guesses.");
    if (mode === "daily") {
      const done = store.getJSON("done:" + today(), null);
      if (done && Array.isArray(done.guesses)) {       // already played today: show how it went
        guesses = done.guesses.slice(); over = true; won = guesses[guesses.length - 1] === answer;
        say((won ? "You solved today's word in " + guesses.length + "/" + ROWS : "Today's word was " + answer.toUpperCase()) + ". New one tomorrow, or play a random word.");
      }
    }
    render();
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();   // so typing and Enter go to the game
  }

  // ---------- sharing ----------
  shareBtn.addEventListener("click", async () => {
    const lines = guesses.map((g) => score(g, answer).map((s) => EMOJI[s]).join("")).join("\n");
    const text = "Word Guess " + (mode === "daily" ? today() : "random") + " " + (won ? guesses.length : "X") + "/" + ROWS + "\n" + lines + "\n" + location.origin + "/word-guess/";
    try {
      if (navigator.share) await navigator.share({ text });
      else { await navigator.clipboard.writeText(text); shareBtn.textContent = "Copied!"; setTimeout(() => { shareBtn.textContent = "Share result"; }, 1500); }
    } catch (e) { /* closed the share sheet */ }
  });

  // ---------- keyboard, buttons ----------
  // After tapping a button, hand the keyboard back to the game (otherwise Enter would press that button again).
  document.addEventListener("click", (e) => { const b = e.target.closest && e.target.closest("button"); if (b && !b.closest("#kb") && b.blur) b.blur(); });
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.target.closest("input, select, textarea") || document.querySelector(".man-backdrop")) return;
    // Enter always submits, even right after tapping an on-screen key (which would otherwise press it again)
    if (e.key === "Enter") { if (!e.target.closest("button") || e.target.closest("#kb")) { e.preventDefault(); press("enter"); } }
    else if (e.key === "Backspace") press("back");
    else if (/^[a-zA-Z]$/.test(e.key)) press(e.key.toLowerCase());
  });
  const chips = Gamekit.wireDifficultyChips({
    el: chipsEl, difficulties: ["daily", "random"], initial: mode, storage: store, storageKey: "mode",
    onChange: (m) => { mode = m; newGame(); },
  });
  mode = chips.get();
  // "new word": a fresh random word (switching to Random if you were on Daily)
  newBtn.addEventListener("click", () => { if (mode === "random") newGame(); else chips.set("random"); });

  // A refresh keeps a game in progress.
  const resumer = Gamekit.resume("word-guess", () => (over || (!guesses.length && !current)) ? null : { mode, answer, guesses, current }, (s) => {
    if (!ANSWERS.includes(s.answer) || !Array.isArray(s.guesses) || s.guesses.length >= ROWS) return false;
    if (!s.guesses.every((g) => typeof g === "string" && VALID.has(g))) return false;
    if (s.mode === "daily" && s.answer !== dailyAnswer()) return false;       // yesterday's unfinished daily
    mode = s.mode === "random" ? "random" : "daily";
    answer = s.answer; guesses = s.guesses.slice(); current = typeof s.current === "string" ? s.current.replace(/[^a-z]/g, "").slice(0, COLS) : "";
    over = false; won = false; say("");
    render();
    return true;
  });

  build();
  newGame();
  resumer.restore();
  window.addEventListener("load", () => Manpage.autoOpen("word-guess"));
})();
