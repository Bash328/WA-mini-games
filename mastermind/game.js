(function () {
  "use strict";

  const P1 = 1, P2 = 2; // P1 = Codemaker (sets the code once); P2 = Codebreaker (guesses)
  const COLORS = 6, LEN = 4, MAX_GUESSES = 10;
  const NAMES = { [P1]: "Codemaker", [P2]: "Codebreaker" };

  const statusEl = document.getElementById("status");
  const modeSel = document.getElementById("mode");
  const resetBtn = document.getElementById("reset-btn");
  const entryEl = document.getElementById("entry");
  const entryLabel = document.getElementById("entry-label");
  const slotsEl = document.getElementById("slots");
  const paletteEl = document.getElementById("palette");
  const undoBtn = document.getElementById("undo-btn");
  const submitBtn = document.getElementById("submit-btn");
  const secretRow = document.getElementById("secret-row");
  const countEl = document.getElementById("count");
  const historyEl = document.getElementById("history");

  /* ---------- Rules ---------- */

  // Standard scoring: exact = right colour in the right place; color = a
  // right colour elsewhere, counted at most as often as it appears in both.
  function feedback(secret, guess) {
    let exact = 0;
    const sc = new Array(COLORS).fill(0), gc = new Array(COLORS).fill(0);
    for (let i = 0; i < LEN; i++) {
      if (secret[i] === guess[i]) exact++;
      else { sc[secret[i]]++; gc[guess[i]]++; }
    }
    let color = 0;
    for (let c = 0; c < COLORS; c++) color += Math.min(sc[c], gc[c]);
    return { exact: exact, color: color };
  }
  const isCracked = (secret, guess) => feedback(secret, guess).exact === LEN;

  // board: the secret (4 digits 0-5) then each guess (4 digits). Feedback is
  // never stored; it is derived from (secret, guess). The secret rides in
  // the link, the same tradeoff as Hangman's word — the UI never renders it
  // to the Codebreaker before the game is decided.
  const boardToStr = (secret, guesses) => secret.join("") + guesses.map(g => g.join("")).join("");
  function strToBoard(s) {
    const digits = s.split("").map(Number);
    const guesses = [];
    for (let i = LEN; i < digits.length; i += LEN) guesses.push(digits.slice(i, i + LEN));
    return { secret: digits.slice(0, LEN), guesses: guesses };
  }
  const validBoardStr = (s) => typeof s === "string" && /^[0-5]{4}(?:[0-5]{4}){0,10}$/.test(s);

  function randomCode() {
    const c = [];
    for (let i = 0; i < LEN; i++) c.push(Math.floor(Math.random() * COLORS));
    return c;
  }

  /* ---------- Rendering ---------- */

  function peg(c, extra, tag) {
    const e = document.createElement(tag || "span");
    if (tag === "button") e.type = "button";
    e.className = "mm-peg " + (c === null ? "empty" : "c" + c) + (extra ? " " + extra : "");
    e.textContent = c === null ? "" : String(c + 1);
    return e;
  }

  function renderHistory(guesses, secret) {
    historyEl.replaceChildren();
    // newest first, so the guess you just made is right under the entry row
    for (let n = guesses.length - 1; n >= 0; n--) {
      const g = guesses[n], fb = feedback(secret, g);
      const row = document.createElement("div");
      row.className = "mm-row";
      const num = document.createElement("span");
      num.className = "mm-n";
      num.textContent = String(n + 1);
      const pegs = document.createElement("span");
      pegs.className = "mm-pegs";
      g.forEach(c => pegs.appendChild(peg(c, "sm")));
      const dots = document.createElement("span");
      dots.className = "mm-fb";
      dots.setAttribute("role", "img");
      dots.setAttribute("aria-label", fb.exact + " right place, " + fb.color + " right colour");
      for (let i = 0; i < LEN; i++) {
        const d = document.createElement("i");
        if (i < fb.exact) d.className = "exact";
        else if (i < fb.exact + fb.color) d.className = "color";
        dots.appendChild(d);
      }
      row.append(num, pegs, dots);
      historyEl.appendChild(row);
    }
  }

  function renderSecret(secret, label) {
    secretRow.replaceChildren();
    if (!secret) { secretRow.hidden = true; return; }
    const p = document.createElement("p");
    p.textContent = label;
    const row = document.createElement("div");
    secret.forEach(c => row.appendChild(peg(c)));
    secretRow.append(p, row);
    secretRow.hidden = false;
  }

  // The 4-slot entry row, shared by "set the code" and "make a guess".
  // `onSubmit(code)` is bound by whichever mode currently shows it.
  let cur = [];
  let onSubmit = null;

  function renderEntry() {
    slotsEl.replaceChildren();
    for (let i = 0; i < LEN; i++) {
      if (i < cur.length) {
        const b = peg(cur[i], "", "button");
        b.setAttribute("aria-label", "Remove peg " + (i + 1));
        b.addEventListener("click", () => { cur.splice(i, 1); renderEntry(); });
        slotsEl.appendChild(b);
      } else {
        slotsEl.appendChild(peg(null));
      }
    }
    submitBtn.disabled = cur.length !== LEN;
    undoBtn.disabled = cur.length === 0;
  }

  function buildPalette() {
    for (let c = 0; c < COLORS; c++) {
      const b = peg(c, "", "button");
      b.setAttribute("aria-label", "Colour " + (c + 1));
      b.addEventListener("click", () => {
        if (cur.length < LEN) { cur.push(c); renderEntry(); }
      });
      paletteEl.appendChild(b);
    }
  }

  function showEntry(label, submitText, handler) {
    entryEl.hidden = false;
    entryLabel.textContent = label;
    submitBtn.textContent = submitText;
    onSubmit = handler;
    renderEntry();
  }
  function hideEntry() { entryEl.hidden = true; onSubmit = null; cur = []; }

  undoBtn.addEventListener("click", () => { cur.pop(); renderEntry(); });
  submitBtn.addEventListener("click", () => {
    if (cur.length !== LEN || !onSubmit) return;
    const code = cur.slice();
    cur = [];
    onSubmit(code);
  });

  /* ---------- 2 players over WhatsApp ---------- */
  // The Codemaker sets the code once. Every guess after that is the
  // Codebreaker's: nextTurn keeps the turn with them while the game is on,
  // so they play it out on their own device and send the finished game
  // back. Once it's over the default (the opponent gets the turn) applies,
  // so the Codemaker opening the final link sees the result as themselves.
  const link = AsyncShare.start({
    game: "mastermind",
    version: 1,
    title: "mastermind",
    players: [P1, P2],
    label: (p) => NAMES[p],
    ui: document.getElementById("wa-ui"),
    statusEl: statusEl,
    validateBoard: (s) => {
      if (!validBoardStr(s.board)) return false;
      const { secret, guesses } = strToBoard(s.board);
      if (s.last !== guesses.length) return false;
      const cracked = guesses.length > 0 && isCracked(secret, guesses[guesses.length - 1]);
      // a code can only be cracked by the final guess
      if (guesses.slice(0, -1).some(g => isCracked(secret, g))) return false;
      // one move to set the code, one per guess (a resignation adds one); the Codebreaker keeps the turn until the game ends
      if (s.moveCount !== guesses.length + 1 + (s.resigned ? 1 : 0)) return false;
      if (!s.resigned && s.turn !== (s.status === "in_progress" ? P2 : P1)) return false;
      if (s.status === "in_progress") return !cracked && guesses.length < MAX_GUESSES;
      if (s.resigned) return !cracked && guesses.length < MAX_GUESSES;
      if (cracked) return s.winner === P2;
      return guesses.length === MAX_GUESSES && s.winner === P1;
    },
    onState: loadLink,
    detail: (s) => {
      const n = strToBoard(s.board).guesses.length;
      return n + (n === 1 ? " guess" : " guesses") + " made.";
    },
  });

  let waSecret = null, waGuesses = [], waStatus = "in_progress", waCanMove = false, waInGame = false, waTurn = P1;

  function loadLink(s, canMove) {
    waInGame = !!s;
    waCanMove = canMove;
    waStatus = s ? s.status : "in_progress";
    waTurn = s ? s.turn : P1;
    if (s) {
      const b = strToBoard(s.board);
      waSecret = b.secret; waGuesses = b.guesses;
    } else {
      waSecret = null; waGuesses = [];
    }
    renderWA();
  }

  function renderWA() {
    hideEntry();
    const over = waInGame && waStatus !== "in_progress";
    if (!waInGame) {
      // fresh game: this player is the Codemaker
      if (waCanMove) showEntry("Codemaker: pick a secret code (4 pegs, repeats allowed).", "Set code", setCodeWA);
      renderSecret(null);
      countEl.textContent = "";
      historyEl.replaceChildren();
      return;
    }
    if (waCanMove && waTurn === P2 && !over) {
      showEntry("Guess " + (waGuesses.length + 1) + " of " + MAX_GUESSES + ": pick 4 colours.", "Guess", guessWA);
    }
    countEl.textContent = "Guesses: " + waGuesses.length + " / " + MAX_GUESSES;
    renderHistory(waGuesses, waSecret);
    if (over) renderSecret(waSecret, "The code was:");
    else if (!waCanMove && waGuesses.length === 0) renderSecret(waSecret, "You set this code. Waiting for the Codebreaker.");
    else renderSecret(null);
  }

  function setCodeWA(code) {
    link.commit({ board: boardToStr(code, []), status: "in_progress", winner: null, last: 0 });
  }

  function guessWA(code) {
    if (!waCanMove || waTurn !== P2 || waStatus !== "in_progress") return;
    const guesses = waGuesses.concat([code]);
    let status = "in_progress", winner = null;
    if (isCracked(waSecret, code)) { status = "won"; winner = P2; }
    else if (guesses.length >= MAX_GUESSES) { status = "won"; winner = P1; }
    link.commit({
      board: boardToStr(waSecret, guesses),
      status: status,
      winner: winner,
      last: guesses.length,
      nextTurn: status === "in_progress" ? P2 : undefined,
    });
  }

  /* ---------- vs computer / same device ---------- */
  let loSecret = null, loGuesses = [], loState = "setup"; // setup | play | won | lost

  function newLocal() {
    loGuesses = []; cur = [];
    if (modeSel.value === "computer") { loSecret = randomCode(); loState = "play"; }
    else { loSecret = null; loState = "setup"; }
    renderLocal();
  }

  function renderLocal() {
    hideEntry();
    const vsComputer = modeSel.value === "computer";
    countEl.textContent = loState === "setup" ? "" : "Guesses: " + loGuesses.length + " / " + MAX_GUESSES;
    if (loState === "setup") {
      showEntry("Codemaker: pick a secret code, then hand the device to the Codebreaker.", "Set code", (code) => {
        loSecret = code; loState = "play"; renderLocal();
      });
      statusEl.textContent = "Codemaker: set a secret code.";
      Gamekit.turn(P1, "Codemaker · set a secret code");
      renderSecret(null);
      historyEl.replaceChildren();
      return;
    }
    renderHistory(loGuesses, loSecret);
    if (loState === "play") {
      showEntry("Guess " + (loGuesses.length + 1) + " of " + MAX_GUESSES + ": pick 4 colours.", "Guess", guessLocal);
      statusEl.textContent = (vsComputer ? "Your guess." : "Codebreaker: your guess.");
      Gamekit.turn(P2, vsComputer ? "Your guess" : "Codebreaker · your guess");
      renderSecret(null);
    } else {
      const won = loState === "won";
      statusEl.textContent = (won ? "Cracked it! " : "Out of guesses. ") + Gamekit.taunt(won ? "win" : "loss");
      Gamekit.turn(null);
      renderSecret(loSecret, "The code was:");
    }
  }

  function guessLocal(code) {
    if (loState !== "play") return;
    loGuesses.push(code);
    if (isCracked(loSecret, code)) loState = "won";
    else if (loGuesses.length >= MAX_GUESSES) loState = "lost";
    renderLocal();
  }

  /* ---------- Mode switching ---------- */
  function applyMode() {
    const wa = modeSel.value === "whatsapp";
    resetBtn.hidden = wa;
    cur = [];
    if (wa) { link.show(); return; }
    link.hide();
    newLocal();
  }

  resetBtn.addEventListener("click", newLocal);
  modeSel.addEventListener("change", applyMode);

  // A refresh keeps a game against the computer or on one device: the code and the guesses so far.
  // (Link and online games are not saved here.)
  const resumer = Gamekit.resume("mastermind", () => (modeSel.value === "whatsapp" || loState !== "play" || !loSecret ||
      (modeSel.value === "computer" && loGuesses.length === 0)) ? null : {
    mode: modeSel.value, secret: loSecret, guesses: loGuesses,
  }, (s) => {
    const code = (a) => Array.isArray(a) && a.length === LEN && a.every(v => Number.isInteger(v) && v >= 0 && v < COLORS);
    if (!["computer", "local"].includes(s.mode) || !code(s.secret) || !Array.isArray(s.guesses)) return false;
    if (s.guesses.length >= MAX_GUESSES || !s.guesses.every(code) || s.guesses.some(g => isCracked(s.secret, g))) return false;
    modeSel.value = s.mode; applyMode();
    loSecret = s.secret.slice(); loGuesses = s.guesses.map(g => g.slice()); loState = "play";
    renderLocal();
    return true;
  });

  buildPalette();
  applyMode();
  if (!/[?&](s|live)=/.test(location.search)) resumer.restore();
  window.addEventListener("load", () => Manpage.autoOpen("mastermind"));

  window.__mastermindTest = { feedback, boardToStr, strToBoard, validBoardStr, isCracked, MAX_GUESSES };
})();
