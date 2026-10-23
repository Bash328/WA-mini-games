(function () {
  "use strict";

  const P1 = 1, P2 = 2; // P1 sets the word (once); P2 guesses (repeatedly)
  const B = window.HangmanBanter;                 // the stick man's lines and when he says them (banter.js)
  const MAX_WRONG = B.MAX_WRONG;
  const NAMES = { [P1]: "Player 1", [P2]: "Player 2" };
  const A_CODE = "A".charCodeAt(0);

  const statusEl = document.getElementById("status");
  const bubbleEl = document.getElementById("bubble");
  let spoken = "";
  const ghostEl = document.getElementById("ghost");
  const stageEl = document.querySelector(".hm-stage");
  const gallowsEl = document.getElementById("gallows");
  const shadowEl = document.getElementById("hm-shadow");
  const dustPosEl = document.getElementById("hm-dust-pos");
  const dustEl = document.getElementById("hm-dust");

  // “Splinter” remembers finished games on this device. It is only used for
  // a few callbacks (a save streak, a repeat loss, a returning setter), never
  // for odds or hints. A finished WhatsApp link keeps its lastKey so opening
  // the same result twice cannot count twice.
  const historyStore = Gamekit.storage("hangman:");
  const history = Object.assign({ games: 0, saves: 0, losses: 0, streak: 0, best: 0, last: "", lastKey: "" },
    historyStore.getJSON("history", {}));
  for (const k of ["games", "saves", "losses", "streak", "best"]) {
    if (!Number.isFinite(history[k]) || history[k] < 0) history[k] = 0;
  }
  function recordResult(won, key) {
    if (key && history.lastKey === key) return;
    history.games++;
    if (won) {
      history.saves++;
      history.streak++;
      history.best = Math.max(history.best, history.streak);
    } else {
      history.losses++;
      history.streak = 0;
    }
    history.last = won ? "saved" : "lost";
    if (key) history.lastKey = key;
    historyStore.setJSON("history", history);
  }

  // How much he talks: "lots" (a line after most guesses), "some" (the default: now and then) or "off" (only when poked).
  let talk = historyStore.get("talk", "some");
  if (talk !== "lots" && talk !== "off") talk = "some";
  let bubbleTimer = 0, flashTimer = 0;
  function speak(line) {
    if (line && talk === "off" && !line.poke) line = "";           // silent: a poke is the only thing that gets an answer
    const t = line ? line.text : "";
    const key = t + (line && line.ghost ? "|ghost" : "");
    if (key === spoken) return;                     // a re-render must not restart the bubble
    spoken = key;
    clearTimeout(bubbleTimer); clearTimeout(flashTimer);
    bubbleEl.hidden = !t;
    bubbleEl.textContent = t;
    bubbleEl.classList.toggle("beg", !!(line && line.beg));
    bubbleEl.classList.toggle("ghost", !!(line && line.ghost));
    // The face follows the words, not only the miss count: a proud line gets
    // a proud face even on the last life, so he never grins through a shiver.
    const face = t && B.faceOf ? B.faceOf(t) : "";
    if (face) stageEl.dataset.face = face; else delete stageEl.dataset.face;
    // an ordinary line fades after a few seconds, so there is not always a sentence on screen; how a game ended stays
    if (t && !line.final) bubbleTimer = setTimeout(() => { bubbleEl.hidden = true; delete stageEl.dataset.face; }, 1500 + t.length * 40);
    ghostEl.toggleAttribute("hidden", !(line && line.ghost));   // the last line, when he has run out of chances, comes from his ghost (an SVG has no .hidden property)
  }

  // A guess he has nothing to say about still shows on his face for a moment.
  function flashFace(name) {
    if (!bubbleEl.hidden) return;
    stageEl.dataset.face = name;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => { if (bubbleEl.hidden) delete stageEl.dataset.face; }, 1100);
  }

  let reactionTimer = 0;
  function reaction(kind) {
    stageEl.dataset.react = kind;
    clearTimeout(reactionTimer);
    reactionTimer = setTimeout(() => { delete stageEl.dataset.react; }, 520);
  }
  function paintMood(misses, result) {
    stageEl.dataset.mood = result || (misses >= MAX_WRONG - 1 ? "terrified"
      : misses >= MAX_WRONG - 2 ? "scared"
      : misses >= 2 ? "worried" : "calm");
    // Poke is only meaningful once the head is there and the game is live.
    gallowsEl.setAttribute("aria-disabled", result || misses < 1 ? "true" : "false");
  }

  // A little dust at the joint of the part that was just drawn.
  function puff(part) {
    if (!dustEl || !dustPosEl) return;
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // the joint the part grows from: the middle of the head, or the start of a limb (neck, shoulder, hip)
    const at = (n) => Number(part.getAttribute(n));
    const x = part.tagName === "circle" ? at("cx") : at("x1"), y = part.tagName === "circle" ? at("cy") : at("y1");
    dustPosEl.setAttribute("transform", `translate(${x} ${y})`);
    dustEl.classList.remove("on");
    void dustEl.getBoundingClientRect();
    dustEl.classList.add("on");
  }

  // the gallows draws one more part for every miss; it reads the "Misses: n / 6" line, whichever mode wrote it
  (function () {
    const missesNode = document.getElementById("misses");
    const parts = [...document.querySelectorAll("#gallows .pt")];
    if (!missesNode || !parts.length) return;
    parts.forEach((p) => p.style.setProperty("--len", String(Math.ceil(p.getTotalLength()) + 1)));   // an explicit length draws the same way in every browser
    let prev = -1;
    const draw = () => {
      const m = /Misses: (\d+)/.exec(missesNode.textContent);
      const n = m ? Number(m[1]) : 0;
      parts.forEach((p, i) => p.classList.toggle("on", i < n));
      stageEl.dataset.misses = String(n);
      stageEl.dataset.head = n > 0 ? "1" : "0";
      if (shadowEl) {
        const k = Math.min(n, MAX_WRONG) / MAX_WRONG;
        shadowEl.style.opacity = String(0.12 + k * 0.28);
        shadowEl.style.transform = `scaleX(${0.55 + k * 0.65})`;
      }
      // A restore or a re-render must not puff; only a genuinely new part.
      if (prev >= 0 && n > prev && n <= parts.length) puff(parts[n - 1]);
      prev = n;
    };
    new MutationObserver(draw).observe(missesNode, { childList: true, characterData: true, subtree: true });
    draw();
  })();
  const wordEl = document.getElementById("word");
  const missesEl = document.getElementById("misses");
  const setupEl = document.getElementById("setup");
  const setupInput = document.getElementById("setup-input");
  const setupBtn = document.getElementById("setup-btn");
  const setupError = document.getElementById("setup-error");
  const keyboardEl = document.getElementById("keyboard");
  const modeSel = document.getElementById("mode");
  const resetBtn = document.getElementById("reset-btn");

  // ---------- idle, poke, eyes ----------
  let idleTimer = 0, idleCount = 0, loIdle = "", waIdle = "";
  function clearIdle(resetCount) {
    clearTimeout(idleTimer); idleTimer = 0;
    if (resetCount) idleCount = 0;
  }
  function activeIdleTarget() {
    if (modeSel.value === "local") return !!(loWord && loStatus === "in_progress");
    return !!(waInGame && waStatus === "in_progress" && waCanMove && waCurrent === P2);
  }
  function showIdle() {
    if (document.hidden || idleCount >= 1 || talk === "off") return;
    if (modeSel.value === "local" && loWord && loStatus === "in_progress") {
      idleCount++;
      glance();
      loIdle = { text: B.idleLine() };
      renderLocal();
    } else if (waInGame && waStatus === "in_progress" && waCanMove && waCurrent === P2) {
      idleCount++;
      glance();
      waIdle = { text: B.idleLine() };
      renderWA();
    }
  }
  function scheduleIdle() {
    clearTimeout(idleTimer); idleTimer = 0;
    if (document.hidden || idleCount >= 1 || talk === "off" || !activeIdleTarget()) return;
    idleTimer = setTimeout(showIdle, 20000);
  }

  // A poke is deliberately only possible once his head is drawn; before that
  // there is nothing on the gallows to poke.
  function poke() {
    if (modeSel.value === "local" && loWord && loStatus === "in_progress") {
      const misses = wrongCount(loWord, loMask);
      if (misses < 1) return;
      clearIdle(true);
      loIdle = { text: B.pokeLine(misses), poke: true };
      renderLocal();
      reaction("poke");
    } else if (waInGame && waStatus === "in_progress") {
      const misses = wrongCount(waWord, waMask);
      if (misses < 1) return;
      clearIdle(true);
      waIdle = { text: B.pokeLine(misses), poke: true };
      renderWA();
      reaction("poke");
    } else if (modeSel.value === "live" && M && M.table && M.table.phase === "play" && M.table.misses >= 1) {
      lvIdle = { text: B.pokeLine(M.table.misses), poke: true };
      renderLive();
      reaction("poke");
    }
  }

  let lookTimer = 0, lookPinned = 0;
  function setLook(i) {
    const x = ((i % 7) - 3) * 0.55;
    const y = 1 + Math.floor(i / 7) * 0.35;
    stageEl.style.setProperty("--look-x", x.toFixed(2) + "px");
    stageEl.style.setProperty("--look-y", y.toFixed(2) + "px");
  }
  function lookAway(force) {
    // Rebuilding the keyboard after a guess fires focusout; a glance at the
    // guessed key should survive that, but leaving the keyboard or the timer
    // should still bring his eyes back.
    if (!force && Date.now() < lookPinned) return;
    lookPinned = 0;
    clearTimeout(lookTimer);
    stageEl.style.setProperty("--look-x", "0px");
    stageEl.style.setProperty("--look-y", "0px");
  }
  function lookAtGuess(i) {
    setLook(i);
    lookPinned = Date.now() + 900;
    clearTimeout(lookTimer);
    lookTimer = setTimeout(() => lookAway(true), 900);
  }
  // When he is bored he looks around the room instead of staring at the keys.
  function glance() {
    const x = (Math.floor(Math.random() * 3) - 1) * 1.1;
    stageEl.style.setProperty("--look-x", x.toFixed(2) + "px");
    stageEl.style.setProperty("--look-y", "0.7px");
    lookPinned = Date.now() + 1300;
    clearTimeout(lookTimer);
    lookTimer = setTimeout(() => lookAway(true), 1300);
  }
  // Each page-load blinks on its own rhythm; two eyes still blink together.
  (function () {
    const delay = (-Math.random() * 5).toFixed(2) + "s";
    document.querySelectorAll(".hm-eye").forEach((eye) => { eye.style.animationDelay = delay; });
  })();

  gallowsEl.addEventListener("click", poke);
  gallowsEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); poke(); }
  });
  keyboardEl.addEventListener("pointerover", (e) => {
    const key = e.target.closest(".hm-key");
    if (key) setLook([...keyboardEl.children].indexOf(key));
  });
  keyboardEl.addEventListener("pointerleave", () => lookAway(true));
  keyboardEl.addEventListener("focusin", (e) => {
    const key = e.target.closest(".hm-key");
    if (key) setLook([...keyboardEl.children].indexOf(key));
  });
  keyboardEl.addEventListener("focusout", () => lookAway(false));
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) clearIdle(false);
    else scheduleIdle();
  });

  const other = (p) => p === P1 ? P2 : P1;
  const letterIdx = (ch) => ch.charCodeAt(0) - A_CODE;
  const bit = (i) => 1 << i;

  function normalizeWord(raw) {
    return (raw || "").toUpperCase().replace(/[^A-Z]/g, "");
  }
  function validWord(w) { return w.length >= 3 && w.length <= 20; }

  function wrongCount(word, mask) {
    let wc = 0;
    for (let i = 0; i < 26; i++) {
      if ((mask & bit(i)) && !word.includes(String.fromCharCode(A_CODE + i))) wc++;
    }
    return wc;
  }
  function isSolved(word, mask) {
    return word.split("").every(ch => mask & bit(letterIdx(ch)));
  }

  // board: 2-digit word length, the word itself (A-Z), then the guessed-
  // letters bitmask in base36 (compact — a raw 26-char 0/1 string would be
  // 4-5x longer for no benefit). The word does ride along in the link, the
  // same tradeoff as Minesweeper's mine positions and Rock Paper Scissors'
  // hidden pick — the UI just never renders it to the guesser.
  function boardToStr(word, mask) { return String(word.length).padStart(2, "0") + word + mask.toString(36); }
  function strToBoard(s) {
    const len = parseInt(s.slice(0, 2), 10);
    return { word: s.slice(2, 2 + len), mask: parseInt(s.slice(2 + len) || "0", 36) };
  }

  function renderWord(word, mask, reveal) {
    wordEl.textContent = word.split("").map(ch =>
      (reveal || (mask & bit(letterIdx(ch)))) ? ch : "_"
    ).join(" ");
  }

  function renderKeyboard(mask, word, canGuess, onGuess) {
    keyboardEl.innerHTML = "";
    for (let i = 0; i < 26; i++) {
      const ch = String.fromCharCode(A_CODE + i);
      const guessed = !!(mask & bit(i));
      const b = document.createElement("button");
      b.type = "button";
      b.className = "hm-key" + (guessed ? (word.includes(ch) ? " hit" : " miss") : "");
      b.textContent = ch;
      b.disabled = guessed || !canGuess;
      b.addEventListener("click", () => onGuess(i));
      keyboardEl.appendChild(b);
    }
  }

  // ---------- 2 players over WhatsApp ----------
  // Player 1 sets the word once; every guess after that is Player 2's,
  // using async-share's nextTurn to keep giving them the next turn (unless
  // the game just ended) instead of bouncing control back to Player 1, who
  // has nothing left to do.
  const link = AsyncShare.start({
    game: "hangman",
    version: 1,
    title: "hangman",
    players: [P1, P2],
    label: (p) => NAMES[p],
    ui: document.getElementById("wa-ui"),
    statusEl: statusEl,
    validateBoard: (s) => {
      const b = s.board;
      if (typeof b !== "string" || b.length < 3) return false;
      const len = parseInt(b.slice(0, 2), 10);
      if (!Number.isInteger(len) || len < 3 || len > 20 || b.length < 2 + len) return false;
      const word = b.slice(2, 2 + len);
      if (!/^[A-Z]+$/.test(word) || word.length !== len) return false;
      const maskStr = b.slice(2 + len);
      if (maskStr && !/^[0-9a-z]+$/.test(maskStr)) return false;
      const mask = parseInt(maskStr || "0", 36);
      if (!Number.isInteger(mask) || mask < 0 || mask >= (1 << 26)) return false;
      return Number.isInteger(s.last) && s.last >= 0 && s.last <= 26;
    },
    onState: loadLink,
    detail: (s, viewer) => {
      const { word, mask } = strToBoard(s.board);
      // just the fact: the taunt comes from the stick man's speech bubble, not from here
      return `The word was ${word}.`;
    },
  });

  let waWord = "", waMask = 0, waCurrent = P1, waCanMove = false, waInGame = false, waStatus = "in_progress";
  // The guess reaction belongs to one board state: it's shown only while
  // waMask still equals waNoteMask, so a re-render keeps it and a fresh
  // link never inherits a stale one.
  let waNote = "", waNoteMask = -1, waTaunt = B.newState(), waEnd = "", waEndKey = "";
  // The setter's line is picked once per word: a re-render must not
  // re-roll it (the same reason waEnd is cached).
  let waSetKey = "", waSetLine = "";
  // One result per finished board state, even if the final link reopens.
  let waRecordedKey = "";

  function loadLink(s, canMove) {
    waInGame = !!s;
    waCanMove = canMove;
    waStatus = s ? s.status : "in_progress";
    if (s) {
      const b = strToBoard(s.board);
      waWord = b.word; waMask = b.mask; waCurrent = s.turn;
    } else {
      waWord = ""; waMask = 0; waCurrent = P1;
    }
    clearIdle(true); waIdle = "";
    if (waMask === 0) {
      waNote = ""; waNoteMask = -1; waTaunt = B.newState(); waEnd = ""; waEndKey = "";
      waSetKey = ""; waSetLine = ""; waRecordedKey = "";
    }
    renderWA();
  }

  function renderWA() {
    setupEl.hidden = waInGame || !waCanMove;
    const reveal = waStatus !== "in_progress"; // game over: show the real word
    if (waInGame) {
      renderWord(waWord, waMask, reveal);
      const misses = wrongCount(waWord, waMask);
      const solved = isSolved(waWord, waMask);
      const guesserTurn = waCanMove && waCurrent === P2 && waStatus === "in_progress";
      const note = waIdle || (guesserTurn && waNoteMask === waMask ? waNote : "");
      missesEl.textContent = `Misses: ${misses} / ${MAX_WRONG}`;
      paintMood(misses, reveal ? (solved ? "saved" : "dead") : "");
      if (reveal) {
        const k = waWord + ":" + waMask;
        // Record before choosing the line, so a save that makes three in a
        // row can say so immediately.
        if (waRecordedKey !== k) {
          waRecordedKey = k;
          recordResult(solved, k);
        }
        if (waEndKey !== k) {
          waEndKey = k;
          waEnd = solved
            ? { text: B.savedLine(history, misses), final: true }
            : { text: B.lossTaunt(waWord, waMask, history), ghost: true, final: true };
        }
        speak(waEnd);
      } else if (waInGame && !waCanMove && waStatus === "in_progress" && waMask === 0) {
        // Player 1 looking at their own just-sent link: he comments on the
        // word they chose. Picked once per word so re-renders are stable.
        if (waSetKey !== waWord) { waSetKey = waWord; waSetLine = B.setterLine(waWord, "self", history); }
        speak({ text: waSetLine });
      } else speak(note);
    } else {
      wordEl.textContent = "";
      missesEl.textContent = "";
      paintMood(0, "");
      speak("");
    }
    const guesserCanGuess = waCanMove && waInGame && waCurrent === P2 && waStatus === "in_progress";
    keyboardEl.hidden = !guesserCanGuess && !(waInGame && waStatus !== "in_progress");
    renderKeyboard(waMask, waWord, guesserCanGuess, guessWA);
    // mask === 0 with the game in progress can only mean "right after Player
    // 1 set the word" — if this viewer can't act, they must be Player 1
    // looking at their own just-sent link. Remind them what they set (their
    // own info, not a leak — Player 2 always sees canMove === true here).
    if (waInGame && !waCanMove && waStatus === "in_progress" && waMask === 0) {
      missesEl.textContent = `You set: ${waWord} — waiting for Player 2 to start guessing.`;
    }
    scheduleIdle();
  }

  function setWordWA() {
    const word = normalizeWord(setupInput.value);
    if (!validWord(word)) {
      setupError.textContent = "Enter a word from 3 to 20 letters (A-Z only).";
      return;
    }
    setupError.textContent = "";
    clearIdle(true); waIdle = "";
    link.commit({ board: boardToStr(word, 0), status: "in_progress", winner: null, last: 26 });
  }

  function guessWA(i) {
    if (!waCanMove || waCurrent !== P2 || waStatus !== "in_progress") return;
    const mask = waMask | bit(i);
    const ch = String.fromCharCode(A_CODE + i);
    const hit = waWord.includes(ch);
    let status = "in_progress", winner = null;
    if (isSolved(waWord, mask)) { status = "won"; winner = P2; }
    else if (wrongCount(waWord, mask) >= MAX_WRONG) { status = "won"; winner = P1; }
    clearIdle(true); waIdle = "";
    waNote = B.react(waTaunt, waWord, mask, ch, talk);
    waNoteMask = mask;
    lookAtGuess(i);
    if (status === "in_progress") reaction(hit ? "hit" : "miss");
    // Keep the turn with the guesser while the game is on. Once it's over
    // the default (turn goes to the opponent) must apply, otherwise Player 1
    // opening the final link is treated as Player 2 and sees the result inverted.
    link.commit({ board: boardToStr(waWord, mask), status, winner, last: i, nextTurn: status === "in_progress" ? P2 : undefined });
    if (status === "in_progress" && !waNote) flashFace(hit ? "hopeful" : "nervous");
  }

  // ---------- 2 players, same device ----------
  let loWord = "", loMask = 0, loStatus = "in_progress", loNote = "", loTaunt = B.newState(), loEnd = "", loSetLine = "";
  let loRecorded = false;

  function resetLocal() {
    loWord = ""; loMask = 0; loStatus = "in_progress"; loNote = ""; loTaunt = B.newState(); loEnd = ""; loSetLine = "";
    loRecorded = false;
    clearIdle(true); loIdle = "";
    renderLocal();
  }

  function renderLocal() {
    setupEl.hidden = !!loWord;
    if (loWord) {
      const reveal = loStatus !== "in_progress";
      renderWord(loWord, loMask, reveal);
      const misses = wrongCount(loWord, loMask);
      missesEl.textContent = `Misses: ${misses} / ${MAX_WRONG}`;
      paintMood(misses, reveal ? (loStatus === "won-p2" ? "saved" : "dead") : "");
      if (reveal && !loRecorded) {
        loRecorded = true;
        recordResult(loStatus === "won-p2", "");
      }
      if (reveal && !loEnd) {
        loEnd = loStatus === "won-p2"
          ? { text: B.savedLine(history, misses), final: true }
          : { text: B.lossTaunt(loWord, loMask, history), ghost: true, final: true };
      }
      statusEl.textContent = loStatus === "in_progress"
        ? "Player 2: guess a letter."
        : (loStatus === "won-p2" ? "Player 2 wins! " + loEnd.text : "Player 1 wins. The word wasn't guessed in time. " + loEnd.text);
      // Before the first guess he comments on the word Player 1 chose;
      // after that he reacts to guesses, and eventually gets impatient.
      const opening = loMask === 0 ? { text: loSetLine || (loSetLine = B.setterLine(loWord, "handoff", history)) } : null;
      speak(loStatus === "in_progress" ? (loIdle || opening || loNote) : loEnd);
      Gamekit.turn(loStatus === "in_progress" ? P2 : null, "Player 2 · guess a letter");
      keyboardEl.hidden = false;
      renderKeyboard(loMask, loWord, loStatus === "in_progress", guessLocal);
    } else {
      Gamekit.turn(P1, "Player 1 · set a secret word");
      wordEl.textContent = ""; missesEl.textContent = ""; paintMood(0, ""); speak("");
      statusEl.textContent = "Player 1: set a secret word, then hand the device to Player 2.";
      keyboardEl.hidden = true;
    }
    scheduleIdle();
  }

  function setWordLocal() {
    const word = normalizeWord(setupInput.value);
    if (!validWord(word)) { setupError.textContent = "Enter a word from 3 to 20 letters (A-Z only)."; return; }
    setupError.textContent = "";
    loWord = word; loMask = 0; loStatus = "in_progress"; loNote = ""; loTaunt = B.newState(); loEnd = ""; loSetLine = B.setterLine(word, "handoff", history);
    loRecorded = false;
    clearIdle(true); loIdle = "";
    renderLocal();
  }

  function guessLocal(i) {
    if (loStatus !== "in_progress") return;
    const ch = String.fromCharCode(A_CODE + i);
    const hit = loWord.includes(ch);
    loMask |= bit(i);
    if (isSolved(loWord, loMask)) loStatus = "won-p2";
    else if (wrongCount(loWord, loMask) >= MAX_WRONG) loStatus = "won-p1";
    clearIdle(true); loIdle = "";
    loNote = B.react(loTaunt, loWord, loMask, ch, talk);
    lookAtGuess(i);
    if (loStatus === "in_progress") reaction(hit ? "hit" : "miss");
    renderLocal();
    if (loStatus === "in_progress" && !loNote) flashFace(hit ? "hopeful" : "nervous");
  }

  // ---------- online room: two people, the secret word stays on the server ----------
  // M is the room model from multiseat.js; M.table is the engine's view (hangman/engine.js) for this person: the setter sees
  // the word, the guesser only its length and the letters found so far.
  const roomEl = document.getElementById("ms-room");
  const tauntsEl = document.getElementById("ms-taunts");
  const scoreEl = document.getElementById("lv-score");
  const params = new URLSearchParams(location.search);
  const invited = params.has("live");
  let M = null, lvTaunt = B.newState(), lvKey = "", lvSeen = 0, lvEnd = null, lvNote = "", lvIdle = "", lvSetLine = "", lvRecorded = "";

  const ms = MultiSeat.create({
    game: "hangman", title: "Hangman", roomEl, tauntsEl, store: historyStore,
    tableSize: 2, fixedSeats: true, fillSeats: false,
    onModel: (m) => { M = m; renderLive(); },
  });
  const bitsOf = (tried) => tried.reduce((m, c) => m | bit(letterIdx(c)), 0);

  function renderLive() {
    if (modeSel.value !== "live") return;
    const t = M && M.kind === "online" ? M.table : null;
    if (!t) {                                     // landing, lobby, waiting, a closed room: the room screens own the page
      lvKey = "";
      wordEl.textContent = ""; missesEl.textContent = ""; scoreEl.hidden = true; keyboardEl.hidden = true; setupEl.hidden = true;
      paintMood(0, ""); speak(""); Gamekit.turn(null, "");
      statusEl.textContent = M && M.closed ? M.closed : "";
      return;
    }
    const you = t.you, them = 1 - you, over = t.phase !== "play", setter = t.role === "setter";
    const word = t.word || "", seen = word || t.mask.replace(/_/g, "?");     // what this screen knows of the word
    const mask = bitsOf(t.tried), misses = t.misses;
    const key = (M.code || "") + ":" + t.round;
    if (key !== lvKey) { lvKey = key; lvTaunt = B.newState(); lvSeen = t.tried.length; lvEnd = null; lvNote = ""; lvIdle = ""; lvSetLine = ""; }

    // a new letter since the last look: his reaction (the guesser's screen reacts without knowing the word)
    let flash = "";
    if (t.stage === "guess" && t.tried.length > lvSeen) {
      if (t.tried.length === lvSeen + 1 && !over) {
        const ch = t.tried[lvSeen], hit = seen.includes(ch);
        lvNote = B.react(lvTaunt, seen, mask, ch, talk, !setter);
        lookAtGuess(letterIdx(ch));
        reaction(hit ? "hit" : "miss");
        if (!lvNote) flash = hit ? "hopeful" : "nervous";
      }
      lvSeen = t.tried.length; lvIdle = "";
    }

    // the board
    const showWord = t.stage === "guess" || over;
    wordEl.textContent = !showWord ? "" : ((over || setter) && word ? word : t.mask).split("").join(" ");
    missesEl.textContent = showWord ? `Misses: ${misses} / ${t.maxWrong}` : "Misses: 0 / " + t.maxWrong;
    keyboardEl.hidden = !showWord;
    if (showWord) renderKeyboard(mask, seen, t.options.guess.length > 0, (i) => ms.send({ t: "guess", ch: String.fromCharCode(A_CODE + i) }));
    setupEl.hidden = !t.options.set;
    if (t.options.set && !setupEl.dataset.live) { setupEl.dataset.live = "1"; setupInput.value = ""; setupError.textContent = ""; setTimeout(() => { try { setupInput.focus(); } catch (e) { /* ignore */ } }, 50); }
    if (!t.options.set) delete setupEl.dataset.live;
    scoreEl.hidden = false;
    scoreEl.textContent = `Round ${t.round} · You ${t.seats[you].score} – ${t.seats[them].score} ${t.seats[them].name} · first to ${t.target}`;

    // the words
    const nameOf = (i) => (i === you ? "You" : t.seats[i].name);
    let text, pill, result = "";
    if (over) {
      const solved = !!(t.last && t.last.solved), finished = t.phase === "game_over";
      result = solved ? "saved" : "dead";
      const w = (t.last && t.last.word) || word;
      const guesserName = nameOf(t.guesser);
      text = (solved ? `${guesserName} found ${w}.` : `${w} was not guessed.`);
      if (finished) text = t.winner === you ? `You win the match ${t.seats[you].score} – ${t.seats[them].score}!` : `${t.seats[t.winner].name} wins the match ${t.seats[t.winner].score} – ${t.seats[you].score}.`;
      pill = finished ? "Match over" : "Next word coming";
    } else if (t.stage === "set") {
      text = setter ? `Pick a secret word for ${t.seats[them].name} to guess.` : `${t.seats[t.setter].name} is picking a word…`;
      pill = setter ? "Pick a word" : `${t.seats[t.setter].name} · picking a word`;
    } else {
      text = setter ? `${t.seats[them].name} is guessing.` : "Your guess: pick a letter.";
      pill = setter ? `${t.seats[them].name} · guessing` : "Your guess";
    }
    statusEl.textContent = text;
    Gamekit.turn(t.turn === you && !over ? P2 : P1, pill, t.turn !== you || over);
    paintMood(misses, result);

    // Splinter: the end of a round stays up; before the first letter he comments on the word; later, on guesses
    if (over && !lvEnd) {
      const solved = !!(t.last && t.last.solved);
      lvEnd = solved ? { text: B.savedLine(history, misses), final: true } : { text: B.lossTaunt(t.last.word, mask, history), ghost: true, final: true };
      if (t.role === "guesser" && lvRecorded !== key) { lvRecorded = key; recordResult(solved, "live:" + key); }
    }
    if (over) speak(lvEnd);
    else if (t.stage === "guess" && t.tried.length === 0) {
      if (!lvSetLine) lvSetLine = B.setterLine(seen, setter ? "self" : "handoff", history);
      speak(lvIdle || { text: lvSetLine });
    } else if (t.stage === "guess") speak(lvIdle || lvNote);
    else speak("");
    if (flash) flashFace(flash);
  }

  function setWordLive() {
    const word = normalizeWord(setupInput.value);
    if (!validWord(word)) { setupError.textContent = "Enter a word from 3 to 20 letters (A-Z only)."; return; }
    setupError.textContent = "";
    setupInput.value = "";
    ms.send({ t: "set", word });
  }

  function leaveLive() {
    if (ms.active()) ms.stop();
    M = null; lvKey = ""; roomEl.hidden = true; tauntsEl.hidden = true; scoreEl.hidden = true;
    delete setupEl.dataset.live; spoken = null;
  }
  function enterLive() {
    M = null; lvKey = "";
    wordEl.textContent = ""; missesEl.textContent = ""; keyboardEl.hidden = true; setupEl.hidden = true;
    paintMood(0, ""); speak(""); Gamekit.turn(null, ""); statusEl.textContent = "";
    const c = (params.get("live") || "").toUpperCase();
    if (invited && /^[A-HJ-NP-Z2-9]{6}$/.test(c) && !ms.active()) ms.enter(c);
    else if (!ms.active()) ms.landing();
    else renderLive();
  }

  // Typing a letter guesses it (a computer keyboard), whichever mode is on.
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || !/^[a-zA-Z]$/.test(e.key)) return;
    if (e.target.closest && e.target.closest("input,select,textarea,[contenteditable]")) return;
    if (document.querySelector(".man-backdrop") || document.querySelector(".gk-over")) return;
    const key = [...keyboardEl.querySelectorAll(".hm-key")].find((k) => k.textContent === e.key.toUpperCase() && !k.disabled);
    if (key && !keyboardEl.hidden) { e.preventDefault(); key.click(); }
  });

  function applyMode() {
    const mode = modeSel.value, wa = mode === "whatsapp", live = mode === "live";
    resetBtn.hidden = wa || live;
    clearIdle(true); loIdle = ""; waIdle = ""; lvIdle = "";
    if (wa) { leaveLive(); link.show(); return; }
    link.hide();
    if (live) { enterLive(); return; }
    leaveLive();
    resetLocal();
  }

  // Setup form is shared between modes; route to the right handler.
  setupBtn.addEventListener("click", () => (modeSel.value === "whatsapp" ? setWordWA() : modeSel.value === "live" ? setWordLive() : setWordLocal()));

  // The top-bar restart clicks this button even when WhatsApp mode hides it.
  resetBtn.addEventListener("click", () => { if (modeSel.value === "whatsapp") link.newGame(); else if (modeSel.value === "local") resetLocal(); else { const rm = roomEl.querySelector("button.primary"); if (rm) rm.click(); } });   // online: the card's Play again votes for the rematch
  modeSel.addEventListener("change", applyMode);
  const talkSel = document.getElementById("talk");
  if (talkSel) {
    talkSel.value = talk;
    talkSel.addEventListener("change", () => {
      talk = talkSel.value; historyStore.set("talk", talk);
      spoken = null; clearIdle(true);
      if (talk === "off") { bubbleEl.hidden = true; delete stageEl.dataset.face; }
    });
  }
  if (invited) modeSel.value = "live";
  if (typeof LiveShare !== "undefined") LiveShare.enable(modeSel, "hangman", invited);
  applyMode();

  // A refresh keeps a same-device game: the secret word and the letters tried.
  // (Link games live in the URL, so they are not saved here.)
  const resumer = Gamekit.resume("hangman", () => (modeSel.value !== "local" || !loWord || loStatus !== "in_progress") ? null : {
    word: loWord, mask: loMask,
  }, (s) => {
    if (typeof s.word !== "string" || normalizeWord(s.word) !== s.word || !validWord(s.word)) return false;
    if (!Number.isInteger(s.mask) || s.mask < 0 || s.mask >= (1 << 26)) return false;
    if (wrongCount(s.word, s.mask) >= MAX_WRONG || isSolved(s.word, s.mask)) return false;
    modeSel.value = "local"; applyMode();
    loWord = s.word; loMask = s.mask; loStatus = "in_progress"; loNote = ""; loTaunt = B.newState(); loEnd = ""; loRecorded = false;
    loSetLine = s.mask === 0 ? B.setterLine(s.word, "handoff", history) : "";
    renderLocal();
    return true;
  });
  if (!/[?&](s|live)=/.test(location.search)) resumer.restore();
  window.addEventListener("load", () => Manpage.autoOpen("hangman"));

  window.__hangmanTest = {
    boardToStr, strToBoard, wrongCount, isSolved, normalizeWord, validWord, MAX_WRONG,
    banter: B, history, idle: showIdle, poke, live: () => M,
    mood: () => stageEl.dataset.mood,
    face: () => stageEl.dataset.face || "",
  };
})();
