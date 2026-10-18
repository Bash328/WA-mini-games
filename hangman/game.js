(function () {
  "use strict";

  const P1 = 1, P2 = 2; // P1 sets the word (once); P2 guesses (repeatedly)
  const MAX_WRONG = 6;
  const NAMES = { [P1]: "Player 1", [P2]: "Player 2" };
  const A_CODE = "A".charCodeAt(0);

  const statusEl = document.getElementById("status");
  const bubbleEl = document.getElementById("bubble");
  let spoken = "";
  const ghostEl = document.getElementById("ghost");
  function speak(line) {
    const t = line ? line.text : "";
    const key = t + (line && line.ghost ? "|ghost" : "");
    if (key === spoken) return;                     // a re-render must not restart the bubble
    spoken = key;
    bubbleEl.hidden = !t;
    bubbleEl.textContent = t;
    bubbleEl.classList.toggle("beg", !!(line && line.beg));
    bubbleEl.classList.toggle("ghost", !!(line && line.ghost));
    ghostEl.toggleAttribute("hidden", !(line && line.ghost));   // the last line, when he has run out of chances, comes from his ghost (an SVG has no .hidden property)
  }
  // the gallows draws one more part for every miss; it reads the "Misses: n / 6" line, whichever mode wrote it
  (function () {
    const missesNode = document.getElementById("misses"), parts = document.querySelectorAll("#gallows .pt");
    if (!missesNode || !parts.length) return;
    const draw = () => { const m = /Misses: (\d+)/.exec(missesNode.textContent); const n = m ? Number(m[1]) : 0; parts.forEach((p, i) => p.classList.toggle("on", i < n)); };
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
  let waNote = "", waNoteMask = -1, waTaunt = newTauntState(), waEnd = "", waEndKey = "";

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
    if (waMask === 0) { waNote = ""; waNoteMask = -1; waTaunt = newTauntState(); waEnd = ""; waEndKey = ""; }
    renderWA();
  }

  function renderWA() {
    setupEl.hidden = waInGame || !waCanMove;
    const reveal = waStatus !== "in_progress"; // game over: show the real word
    if (waInGame) {
      renderWord(waWord, waMask, reveal);
      const misses = wrongCount(waWord, waMask);
      const guesserTurn = waCanMove && waCurrent === P2 && waStatus === "in_progress";
      const note = guesserTurn && waNoteMask === waMask ? waNote : "";
      missesEl.textContent = `Misses: ${misses} / ${MAX_WRONG}`;
      if (reveal) {
        const k = waWord + ":" + waMask;
        if (waEndKey !== k) { waEndKey = k; waEnd = isSolved(waWord, waMask) ? { text: pick(HANGMAN_SAVED) } : { text: lossTaunt(waWord, waMask), ghost: true }; }
        speak(waEnd);
      } else speak(note);
    } else {
      wordEl.textContent = "";
      missesEl.textContent = "";
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
  }

  function setWordWA() {
    const word = normalizeWord(setupInput.value);
    if (!validWord(word)) {
      setupError.textContent = "Enter a word from 3 to 20 letters (A-Z only).";
      return;
    }
    setupError.textContent = "";
    link.commit({ board: boardToStr(word, 0), status: "in_progress", winner: null, last: 26 });
  }

  function guessWA(i) {
    if (!waCanMove || waCurrent !== P2 || waStatus !== "in_progress") return;
    const mask = waMask | bit(i);
    let status = "in_progress", winner = null;
    if (isSolved(waWord, mask)) { status = "won"; winner = P2; }
    else if (wrongCount(waWord, mask) >= MAX_WRONG) { status = "won"; winner = P1; }
    waNote = voice(guessNote(waTaunt, waWord, mask, String.fromCharCode(A_CODE + i)), waWord, mask, String.fromCharCode(A_CODE + i));
    waNoteMask = mask;
    // Keep the turn with the guesser while the game is on. Once it's over
    // the default (turn goes to the opponent) must apply, otherwise Player 1
    // opening the final link is treated as Player 2 and sees the result inverted.
    link.commit({ board: boardToStr(waWord, mask), status, winner, last: i, nextTurn: status === "in_progress" ? P2 : undefined });
  }

  // ---------- 2 players, same device ----------
  // Hangman's own gallows-humor taunts, rather than Gamekit's generic
  // pool — "the one hanging" joke doesn't land in checkers.
  const HANGMAN_LAST_CHANCE = [
    "Try harder. I'm the one hanging here!",
    "One more miss and that's curtains.",
    "The rope's getting tighter. Figuratively. Mostly.",
    "Last letter standing between you and the noose.",
    "The gallows are warming up.",
    "One guess left. Make it count. You won't.",
    "This is the letter that decides everything.",
    "Dramatic pause intensifies.",
    "This is the nail-biter moment.",
    "One wrong move from game over.",
    "The executioner is checking their watch.",
    "Pick wisely. Or don't — it's funnier that way.",
  ];
  const HANGMAN_LOSS = [
    "Hanged by your own indecision.",
    "The word remains undefeated.",
    "Better luck spelling next time.",
    "That word really had your number.",
    "The dictionary wins again.",
    "A moment of silence for your guesses.",
    "Spelling was never your strong suit, huh.",
    "The noose has spoken.",
    "Game over. The word lives to see another day.",
    "Well, the letters tried to warn you.",
    "That's going in the hangman hall of shame.",
    "The rope wins this round.",
  ];
  // Mid-game mockery for a pile of misses that hasn't reached the gallows
  // yet — distinct from the last-chance line, which is reserved for the
  // final guess. Needs no word-length awareness: the joke here is just
  // "you've already whiffed a lot," not about the word itself.
  const MANY_WRONG_THRESHOLD = 3;
  const HANGMAN_MANY_WRONG = [
    "That's a lot of wrong letters for one word.",
    "The alphabet is not your friend tonight.",
    "At this rate you're guessing backwards.",
    "Statistically, you should've hit one by now.",
    "The gallows crew is placing bets.",
    "Quite a collection of misses you're building there.",
    "This is turning into a greatest-misses album.",
    "Half your guesses gone and the word's barely dented.",
    "The keyboard is starting to feel personally attacked.",
  ];
  // A hint dressed up as a jab. Only offered while the word still has an
  // unguessed vowel (see guessNote), so it never points at a letter that
  // can't help — and it sets up the VOWEL_PAYOFF / VOWEL_WRONG callbacks.
  const HANGMAN_VOWEL_NUDGE = [
    "Maybe try... a vowel? Any vowel?",
    "Have you considered a vowel?",
    "Vowels exist. Just saying.",
    "A, E, I, O, U — pick one. Any one.",
    "Pro tip: most words have vowels.",
  ];
  // Callbacks to the lines above, shown on the very next guess.
  const HANGMAN_VOWEL_PAYOFF = [
    "Seeeeee? Was that so hard?",
    "Seeeee — all it took was a vowel.",
    "See?? Vowels. They work.",
    "Seeeeeee! I'm basically a genius.",
    "And THAT is why we try vowels.",
  ];
  const HANGMAN_VOWEL_WRONG = [
    "Technically a vowel. Technically wrong.",
    "Right idea, wrong vowel.",
    "You listened! ...and still missed.",
    "A vowel, yes. The vowel, no.",
  ];
  const HANGMAN_COMEBACK = [
    "Now we're talking.",
    "There it is. Now we're talking.",
    "Oh, so you CAN do this.",
    "Finally. Now we're getting somewhere.",
    "Look at that — a correct letter. Now we're talking.",
    "Okay okay, now we're cooking.",
  ];
  // Right letters while down to the last life: surprise on the first one,
  // genuine praise once it becomes a streak.
  const HANGMAN_LAST_LIFE_SURPRISE = [
    "Wait — that was right? On your last life?",
    "Okay, didn't see that coming.",
    "Whoa. Still alive. For now.",
    "Plot twist: you might survive this.",
    "Look who's still breathing.",
    "Hold on. Is this a comeback?",
  ];
  const HANGMAN_LAST_LIFE_PRAISE = [
    "Okay, this is getting impressive.",
    "Cheating death, one letter at a time.",
    "Ice. In. Your. Veins.",
    "The noose is sweating. You're not.",
    "Alright, I'm genuinely impressed.",
    "Hanging by a thread and still delivering.",
    "That's called clutch.",
  ];
  // Taunts are seasoning, not a laugh track: most guesses get no line at
  // all. Callbacks (payoffs) always fire, since they answer a line the
  // player already saw.
  const CHANCE_LAST_CHANCE = 0.6;
  const CHANCE_MANY_WRONG = 0.5;
  const CHANCE_VOWEL_NUDGE = 0.35; // share of many-wrong lines that are the vowel hint
  const CHANCE_FIRST_SURPRISE = 0.7;
  // Word-length-aware extras, blended into the pool above rather than
  // replacing it: a short word losing to the guesser is extra embarrassing
  // (it was right there), a long one earns a little sympathy instead.
  const SHORT_WORD_MAX = 4;
  const LONG_WORD_MIN = 8;
  const HANGMAN_SHORT_LAST_CHANCE = [
    "Come on, this is an easy one.",
    "It's barely a word. How is this close?",
    "This one should've been free.",
    "A toddler could spell this one.",
    "This word has training wheels and you're still wobbling.",
    "Four letters. FOUR.",
  ];
  const HANGMAN_SHORT_LOSS = [
    "That word had training wheels and you still fell off.",
    "Four letters or less. And you still lost.",
    "A word that short deserved a better guesser.",
    "Short word. Shorter memory, apparently.",
    "That's the hangman equivalent of missing an open goal.",
    "Autocorrect would've gotten that one.",
  ];
  const HANGMAN_LONG_LAST_CHANCE = [
    "Stay sharp — that's a long one to blow now.",
    "This word's been testing everyone. Don't let it win.",
    "One letter from cracking a genuinely hard word.",
    "That's a lot of letters to lose on now.",
    "This one's earned its difficulty badge. Don't waste it.",
    "So close to cracking a real beast of a word.",
  ];
  const HANGMAN_LONG_LOSS = [
    "I don't blame you, that's a big one.",
    "Honestly, that word was unreasonable.",
    "Nobody was spelling that one cold.",
    "That word was basically a boss fight.",
    "Respect for even attempting that monster.",
    "Long words like that have humbled better guessers.",
  ];
  // The cruelest loss: only one unguessed letter stood between the guesser
  // and the win. Checked independently of word length — a short word lost
  // by one letter stings just as much as a long one.
  const ALMOST_MAX_MISSING = 1;
  const HANGMAN_ALMOST_LOSS = [
    "You had my hopes up for nothing.",
    "So close. So, so close.",
    "One letter. ONE letter away.",
    "The word was right there and you still missed it.",
    "That's the cruelest kind of loss — the almost kind.",
    "You could taste the win. Then you couldn't.",
    "One more correct guess and this ends differently.",
    "You really couldn't tell, huh?",
  ];
  // The hanged man does the talking: taunts, and now and then begging for his life.
  const HANGMAN_BEGS = [
    "Wait, wait, wait! I have a family!",
    "Please! I'm only made of sticks!",
    "Tell my stick wife I love her.",
    "I'm too young to hang!",
    "Not that letter again, please!",
    "I can see the rope from here!",
    "Can we talk about this?",
    "I'll give you my last twig.",
    "Is there a vowel you haven't tried?",
    "My knees are shaking. I have no knees!",
  ];
  const HANGMAN_BEGS_LAST = [
    "ONE LEFT! Please, please, please!",
    "I can't look. I have no eyes. I can't look!",
    "I'll be good! I'll be so good!",
    "Don't do this to me!",
    "Tell them I was a good stick man.",
    "My whole life is flashing before me. It's two lines!",
  ];
  // the first miss draws his head: that is when he starts talking
  const HANGMAN_FIRST_MISS = [
    "Hey! Where did my head come from?",
    "Oh no. Is that a rope?",
    "Well, that's a head. I didn't ask for one.",
    "Uh oh. I can see the noose.",
    "Hello? Something just appeared above my neck.",
  ];
  const HANGMAN_RELIEF = [
    "Yes! Keep going, you beauty!",
    "I can breathe again. Slightly.",
    "That's the one, that's the one!",
    "My toes are touching the floor again!",
  ];
  const HANGMAN_SAVED = [
    "Phew! You saved me. I owe you my life.",
    "I'm free! Drinks are on me. I have no pockets.",
    "Never doubted you. Okay, I doubted you a little.",
  ];
  function pick(pool) { return pool[Math.floor(Math.random() * pool.length)]; }
  function missingUniqueCount(word, mask) {
    const seen = new Set();
    let missing = 0;
    for (const ch of word) {
      if (seen.has(ch)) continue;
      seen.add(ch);
      if (!(mask & bit(letterIdx(ch)))) missing++;
    }
    return missing;
  }
  function lastChanceTaunt(word) {
    if (word.length <= SHORT_WORD_MAX) return pick(HANGMAN_LAST_CHANCE.concat(HANGMAN_SHORT_LAST_CHANCE));
    if (word.length >= LONG_WORD_MIN) return pick(HANGMAN_LAST_CHANCE.concat(HANGMAN_LONG_LAST_CHANCE));
    return pick(HANGMAN_LAST_CHANCE);
  }
  function lossTaunt(word, mask) {
    let pool = HANGMAN_LOSS;
    if (word.length <= SHORT_WORD_MAX) pool = pool.concat(HANGMAN_SHORT_LOSS);
    else if (word.length >= LONG_WORD_MIN) pool = pool.concat(HANGMAN_LONG_LOSS);
    if (typeof mask === "number" && missingUniqueCount(word, mask) <= ALMOST_MAX_MISSING) {
      pool = pool.concat(HANGMAN_ALMOST_LOSS);
    }
    return pick(pool);
  }
  function hasUnguessedVowel(word, mask) {
    for (const ch of word) {
      if ("AEIOU".includes(ch) && !(mask & bit(letterIdx(ch)))) return true;
    }
    return false;
  }

  // Per-game memory the guess reactions need: what the last line nudged
  // (so the next guess can call back to it) and how many right letters in
  // a row have landed while on the last life.
  function newTauntState() { return { nudge: null, lastLifeHits: 0 }; }
  function voice(note, word, mask, ch) {
    const misses = wrongCount(word, mask), hit = word.includes(ch);
    if (isSolved(word, mask) || misses >= MAX_WRONG) return "";
    if (!hit && misses === 1) return { text: pick(HANGMAN_FIRST_MISS), beg: true };
    if (!hit && misses === MAX_WRONG - 1 && Math.random() < 0.7) return { text: pick(HANGMAN_BEGS_LAST), beg: true };
    if (!hit && misses >= 2 && Math.random() < 0.45) return { text: pick(HANGMAN_BEGS), beg: true };
    if (hit && misses >= 3 && !note && Math.random() < 0.35) return { text: pick(HANGMAN_RELIEF) };
    return note ? { text: note } : "";
  }


  // The line (or "") to show after the guesser picks `ch`; `mask` already
  // includes it. Decided once per guess and stored by the caller, so a
  // re-render never re-rolls it. Game-over lines are handled elsewhere.
  function guessNote(st, word, mask, ch) {
    const prevNudge = st.nudge;
    st.nudge = null;
    const misses = wrongCount(word, mask);
    if (isSolved(word, mask) || misses >= MAX_WRONG) return "";
    const hit = word.includes(ch);
    const isVowel = "AEIOU".includes(ch);

    if (misses === MAX_WRONG - 1) {
      if (!hit) {
        st.lastLifeHits = 0;
        return Math.random() < CHANCE_LAST_CHANCE ? lastChanceTaunt(word) : "";
      }
      st.lastLifeHits++;
      if (st.lastLifeHits === 1) {
        return Math.random() < CHANCE_FIRST_SURPRISE ? pick(HANGMAN_LAST_LIFE_SURPRISE) : "";
      }
      return pick(HANGMAN_LAST_LIFE_PRAISE);
    }

    if (misses < MANY_WRONG_THRESHOLD) return "";
    if (hit) {
      if (prevNudge === "vowel" && isVowel) return pick(HANGMAN_VOWEL_PAYOFF);
      return prevNudge ? pick(HANGMAN_COMEBACK) : "";
    }
    if (prevNudge === "vowel" && isVowel) return pick(HANGMAN_VOWEL_WRONG);
    if (Math.random() >= CHANCE_MANY_WRONG) return "";
    if (hasUnguessedVowel(word, mask) && Math.random() < CHANCE_VOWEL_NUDGE) {
      st.nudge = "vowel";
      return pick(HANGMAN_VOWEL_NUDGE);
    }
    st.nudge = "other";
    return pick(HANGMAN_MANY_WRONG);
  }

  let loWord = "", loMask = 0, loStatus = "in_progress", loNote = "", loTaunt = newTauntState(), loEnd = "";

  function resetLocal() {
    loWord = ""; loMask = 0; loStatus = "in_progress"; loNote = ""; loTaunt = newTauntState(); loEnd = "";
    renderLocal();
  }

  function renderLocal() {
    setupEl.hidden = !!loWord;
    if (loWord) {
      const reveal = loStatus !== "in_progress";
      renderWord(loWord, loMask, reveal);
      const misses = wrongCount(loWord, loMask);
      missesEl.textContent = `Misses: ${misses} / ${MAX_WRONG}`;
      if (loStatus !== "in_progress" && !loEnd) loEnd = loStatus === "won-p2" ? { text: pick(HANGMAN_SAVED) } : { text: lossTaunt(loWord, loMask), ghost: true };
      statusEl.textContent = loStatus === "in_progress"
        ? "Player 2: guess a letter."
        : (loStatus === "won-p2" ? "Player 2 wins! " + loEnd.text : "Player 1 wins. The word wasn't guessed in time. " + loEnd.text);
      speak(loStatus === "in_progress" ? loNote : loEnd);
      Gamekit.turn(loStatus === "in_progress" ? P2 : null, "Player 2 · guess a letter");
      keyboardEl.hidden = false;
      renderKeyboard(loMask, loWord, loStatus === "in_progress", guessLocal);
    } else {
      Gamekit.turn(P1, "Player 1 · set a secret word");
      wordEl.textContent = ""; missesEl.textContent = ""; speak("");
      statusEl.textContent = "Player 1: set a secret word, then hand the device to Player 2.";
      keyboardEl.hidden = true;
    }
  }

  function setWordLocal() {
    const word = normalizeWord(setupInput.value);
    if (!validWord(word)) { setupError.textContent = "Enter a word from 3 to 20 letters (A-Z only)."; return; }
    setupError.textContent = "";
    loWord = word; loMask = 0; loStatus = "in_progress"; loNote = ""; loTaunt = newTauntState(); loEnd = "";
    renderLocal();
  }

  function guessLocal(i) {
    if (loStatus !== "in_progress") return;
    loMask |= bit(i);
    if (isSolved(loWord, loMask)) loStatus = "won-p2";
    else if (wrongCount(loWord, loMask) >= MAX_WRONG) loStatus = "won-p1";
    loNote = voice(guessNote(loTaunt, loWord, loMask, String.fromCharCode(A_CODE + i)), loWord, loMask, String.fromCharCode(A_CODE + i));
    renderLocal();
  }

  function applyMode() {
    const wa = modeSel.value === "whatsapp";
    resetBtn.hidden = wa;
    if (wa) { link.show(); return; }
    link.hide();
    resetLocal();
  }

  // Setup form is shared between modes; route to the right handler.
  setupBtn.addEventListener("click", () => (modeSel.value === "whatsapp" ? setWordWA() : setWordLocal()));

  resetBtn.addEventListener("click", resetLocal);
  modeSel.addEventListener("change", applyMode);
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
    loWord = s.word; loMask = s.mask; loStatus = "in_progress"; loNote = ""; loTaunt = newTauntState(); loEnd = "";
    renderLocal();
    return true;
  });
  if (!/[?&](s|live)=/.test(location.search)) resumer.restore();
  window.addEventListener("load", () => Manpage.autoOpen("hangman"));

  window.__hangmanTest = { boardToStr, strToBoard, wrongCount, isSolved, normalizeWord, validWord, MAX_WRONG };
})();
