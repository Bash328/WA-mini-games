/* ============================================================
   banter.js — the stick man's lines and the rules for when he says
   them. Data plus pure decisions: no DOM, no page state.

   Loaded before game.js; game.js calls window.HangmanBanter.react()
   after a guess and savedLine() / lossTaunt() when the game ends.

   WRITING RULE: a line must be true when it fires. The same lines are
   used in a WhatsApp game and in pass-and-play, so they never claim
   who is playing, and they never name a letter that is still hidden.
   Keep them short (the speech bubble is narrow) and no emoji.
   ============================================================ */
(function (root) {
  "use strict";

  const MAX_WRONG = 6;
  const A_CODE = "A".charCodeAt(0);
  const VOWELS = "AEIOU";
  const SHORT_WORD_MAX = 4;
  const LONG_WORD_MIN = 8;
  const MANY_WRONG_THRESHOLD = 3;
  const ALMOST_MAX_MISSING = 1;

  const letterIdx = (ch) => ch.charCodeAt(0) - A_CODE;
  const bit = (i) => 1 << i;

  const P = {
    FIRST_MISS: [
      "Hey! Where did my head come from?",
      "Oh no. Is that a rope?",
      "Well, that's a head. I didn't ask for one.",
      "Uh oh. I can see the noose.",
      "Hello? Something just appeared above my neck.",
      "There's a head on my shoulders now. I hate it.",
      "Who authorised this neck?",
      "One miss and I get a head. Great system.",
    ],
    BEGS: [
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
      "Have mercy. I'm mostly splinters.",
      "I'll haunt you politely.",
      "Think of the sticks!",
      "I promise not to creak at night.",
      "You wouldn't hang a friend, would you?",
      "My stick parents are watching.",
      "I'm accumulating parts!",
      "There's still time to choose a vowel.",
      "I can offer you a very small splinter.",
      "Let's not make this a whole thing.",
      "Sparing me would look great on you.",
      "I'm not even the right word for this rope.",
    ],
    BEGS_LAST: [
      "ONE LEFT! Please, please, please!",
      "I can't look. I have no eyes. I can't look!",
      "I'll be good! I'll be so good!",
      "Don't do this to me!",
      "Tell them I was a good stick man.",
      "My whole life is flashing before me. It's two lines!",
      "This is it. The final letter. Be cool.",
      "One guess between me and the afterlife.",
      "Please be a vowel. Please be a vowel.",
      "I'll owe you forever. Literally forever.",
    ],
    MANY_WRONG: [
      "That's a lot of wrong letters for one word.",
      "The alphabet is not your friend tonight.",
      "At this rate you're guessing backwards.",
      "Statistically, you should've hit one by now.",
      "The gallows crew is placing bets.",
      "Quite a collection of misses you're building there.",
      "This is turning into a greatest-misses album.",
      "Half your guesses gone and the word's barely dented.",
      "The keyboard is starting to feel personally attacked.",
      "You're collecting wrong letters like trading cards.",
      "That's another letter the word didn't want.",
      "Somewhere, a dictionary just sighed.",
      "The alphabet called. It wants a break.",
      "Your hit rate is a rounding error.",
      "Wrong again. Bold of you to keep going.",
      "This is a spelling bee, not a séance.",
      "Every miss is a little gift. To me. Not you.",
      "You've eliminated some lovely letters.",
      "The word is winning by a landslide.",
      "At this point the keyboard is doing cardio.",
      "You're one letter closer to the gallows. Wrong kind of closer.",
    ],
    VOWEL_NUDGE: [
      "Maybe try... a vowel? Any vowel?",
      "Have you considered a vowel?",
      "Vowels exist. Just saying.",
      "A, E, I, O, U — pick one. Any one.",
      "Pro tip: most words have vowels.",
    ],
    VOWEL_PAYOFF: [
      "Seeeeee? Was that so hard?",
      "Seeeee — all it took was a vowel.",
      "See?? Vowels. They work.",
      "Seeeeeee! I'm basically a genius.",
      "And THAT is why we try vowels.",
    ],
    VOWEL_WRONG: [
      "Technically a vowel. Technically wrong.",
      "Right idea, wrong vowel.",
      "You listened! ...and still missed.",
      "A vowel, yes. The vowel, no.",
    ],
    NO_VOWELS: [
      "Bad news: this word has no vowels at all.",
      "Not a single A, E, I, O or U in there. Stop trying.",
      "You're hunting vowels in a word with none. Bold.",
      "Zero vowels. The word is all consonants and attitude.",
    ],
    COMEBACK: [
      "Now we're talking.",
      "There it is. Now we're talking.",
      "Oh, so you CAN do this.",
      "Finally. Now we're getting somewhere.",
      "Look at that — a correct letter. Now we're talking.",
      "Okay okay, now we're cooking.",
    ],
    FIRST_HIT: [
      "Finally! A letter the word actually wanted.",
      "See? The alphabet works. Keep going.",
      "A hit! I was starting to worry about you.",
      "One down. The word is officially worried.",
      "A correct letter. Don't let it go to your head. I have one of those now.",
      "Progress! Actual progress!",
      "You found one. The rest are hiding in the same word.",
      "Good letter. Very letter-like.",
      "There it is. A real, live letter.",
      "The word just flinched. Keep going.",
    ],
    DOUBLE: [
      "More than one! The word is showing off.",
      "A repeat. Someone's feeling generous.",
      "Several at once. That's a bulk discount.",
      "Look at that, a matching pair.",
      "Matching letters! The word is practically giving them away.",
      "Same letter again. Efficient guessing.",
    ],
    STREAK: [
      "Three in a row. Are you actually good at this?",
      "A streak! I'm almost impressed.",
      "You're on fire. The rope is not.",
      "Keep going. You're making the word nervous.",
      "Look at you, spelling like you mean it.",
      "That's a run. Don't stop now.",
    ],
    ALL_VOWELS: [
      "Every vowel is out. Consonants from here.",
      "The word has shown all its vowels. No more hiding.",
      "Vowel department: fully staffed.",
      "No more vowels hiding in there.",
      "Vowels done. Time for the sturdy letters.",
      "You've squeezed out every vowel. Respect.",
    ],
    NEARLY: [
      "Two letters left. Now the real spelling starts.",
      "Almost there. This is where words get stubborn.",
      "Two blanks left. Be a hero.",
      "Nearly done. Don't rush the last letters.",
      "The word is running out of hiding places.",
      "Two letters to go. Make them count.",
    ],
    ONE_LEFT: [
      "One letter left. Don't think about it too hard.",
      "A single letter stands between us and freedom.",
      "One blank. One guess at a time. One chance.",
      "The word is one letter from finished. Finish it.",
      "So close. Please don't pick something silly.",
      "One letter to go. This is the whole game.",
    ],
    LAST_LIFE_SURPRISE: [
      "Wait — that was right? On your last life?",
      "Okay, didn't see that coming.",
      "Whoa. Still alive. For now.",
      "Plot twist: you might survive this.",
      "Look who's still breathing.",
      "Hold on. Is this a comeback?",
    ],
    LAST_LIFE_PRAISE: [
      "Okay, this is getting impressive.",
      "Cheating death, one letter at a time.",
      "Ice. In. Your. Veins.",
      "The noose is sweating. You're not.",
      "Alright, I'm genuinely impressed.",
      "Hanging by a thread and still delivering.",
      "That's called clutch.",
    ],
    RELIEF: [
      "Yes! Keep going, you beauty!",
      "I can breathe again. Slightly.",
      "That's the one, that's the one!",
      "My toes are touching the floor again!",
    ],
    DANGER: [
      "Two misses left. No pressure. Okay, some pressure.",
      "The rope is starting to look interested.",
      "One more and I start writing my will.",
      "This is the part where you get serious.",
      "You've got two lives and a lot of alphabet left.",
      "The next wrong letter is going to sting.",
      "I'd like to keep my legs, please.",
      "Careful now. I'm invested in this outcome.",
    ],
    LAST_CHANCE: [
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
      "Everything comes down to this letter.",
      "No pressure, but my entire existence is on the line.",
      "This is the guess they'll talk about.",
      "One guess from the end. Make it a good one.",
      "The word is holding its breath.",
      "This is your hero moment. Or my last moment.",
      "Pick a letter. Any letter. Not a wrong one.",
      "Make this one count. Or don't. I'll be dead either way.",
    ],
    SHORT_LAST_CHANCE: [
      "Come on, this is an easy one.",
      "It's barely a word. How is this close?",
      "This one should've been free.",
      "A toddler could spell this one.",
      "This word has training wheels and you're still wobbling.",
      "Four letters or fewer. Come on.",
      "Four letters or less. You've got this.",
      "It's shorter than the rope.",
      "You could guess this word by accident.",
    ],
    LONG_LAST_CHANCE: [
      "Stay sharp — that's a long one to blow now.",
      "This word's been testing everyone. Don't let it win.",
      "One letter from cracking a genuinely hard word.",
      "That's a lot of letters to lose on now.",
      "This one's earned its difficulty badge. Don't waste it.",
      "So close to cracking a real beast of a word.",
      "All those letters and only this guess left.",
      "A word this long deserves a better finish.",
      "One letter between you and a very long word.",
    ],
    LOSS: [
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
      "The word goes free. I don't.",
      "You spelled defeat perfectly, at least.",
      "The gallows send their regards.",
      "Another word survives the alphabet.",
      "That's a hanging offence. Literally.",
      "The word is fine. I am not.",
    ],
    SHORT_LOSS: [
      "That word had training wheels and you still fell off.",
      "Four letters or less. And you still lost.",
      "A word that short deserved a better guesser.",
      "Short word. Shorter memory, apparently.",
      "That's the hangman equivalent of missing an open goal.",
      "Autocorrect would've gotten that one.",
      "A few letters and a dream, and you missed both.",
      "You lost to a word that fits in a text message.",
      "That word was shorter than your guess list.",
    ],
    LONG_LOSS: [
      "I don't blame you, that's a big one.",
      "Honestly, that word was unreasonable.",
      "Nobody was spelling that one cold.",
      "That word was basically a boss fight.",
      "Respect for even attempting that monster.",
      "Long words like that have humbled better guessers.",
      "That word had more letters than sense.",
      "You lost to a word with its own postcode.",
      "A long word, a long game, a short goodbye.",
    ],
    ALMOST_LOSS: [
      "You had my hopes up for nothing.",
      "So close. So, so close.",
      "One letter. ONE letter away.",
      "The word was right there and you still missed it.",
      "That's the cruelest kind of loss — the almost kind.",
      "You could taste the win. Then you couldn't.",
      "One more correct guess and this ends differently.",
      "You really couldn't tell, huh?",
      "One letter from glory. One letter from this.",
      "You could see the finish line. Then you blinked.",
      "The word was practically spelling itself.",
      "One more good guess. You had one job.",
    ],
    SAVED: [
      "Phew! You saved me. I owe you my life.",
      "I'm free! Drinks are on me. I have no pockets.",
      "Never doubted you. Okay, I doubted you a little.",
      "You did it! I'm not a ghost after all.",
      "I'm alive! Mostly. Sticks are complicated.",
      "That was close. I saw the light. It was a lamp.",
      "You absolute legend. I take back everything.",
      "Free at last! And still made of wood.",
      "I'll never forget you. I'll try, but I won't.",
      "My stick family will hear of this.",
    ],
    SAVED_BARELY: [
      "One more miss and I'd be a ghost. Literally.",
      "I saw the whole afterlife. It was beige.",
      "You cut it that fine on purpose, didn't you?",
      "My life flashed before my eyes. It was mostly rope.",
      "That was one wrong letter from a very quiet me.",
      "I need a minute. Maybe a new pair of legs.",
      "Five misses. You really made me work for that.",
      "I was already practising my haunting voice.",
    ],
    SAVED_INTACT: [
      "Not a scratch. You didn't even need the rope.",
      "You solved it clean. Show-off. Thank you.",
      "I didn't even get a head. Best game ever.",
      "Flawless. I was almost disappointed not to hang.",
      "All letters, no mistakes. My hero.",
      "You saved me without breaking a sweat. I can't sweat.",
      "Not one miss. I'm almost suspicious of you.",
      "Clean sheet. The rope never even warmed up.",
    ],
    IDLE: [
      "Still there? The rope is getting cold.",
      "Take your time. I'll just hang here.",
      "Any letter. Preferably a correct one.",
      "Hello? Did you fall asleep?",
      "I can do this all day. I have nowhere else to be.",
      "The word isn't going to guess itself.",
      "Thinking? Good. I'll think about my life choices.",
      "I'd tap a letter, but my hands are tied. Literally.",
      "No rush. It's only my neck.",
      "This is the quiet part. I don't like the quiet part.",
      "Are you still there? Blink once for yes.",
    ],
    POKE: [
      "Hey! Careful. I'm mostly hypothetical.",
      "Poking the condemned. Classy.",
      "I'm tied up right now.",
      "Do that again and I'll haunt your keyboard.",
      "That's not a letter. That's me.",
      "Personal space. I have very little.",
      "Careful. I'm fragile and fictional.",
      "You poked me. I have no skin. Rude.",
      "I'm a stick man, not a pincushion.",
      "One more poke and I'm telling the rope.",
    ],
    POKE_SCARED: [
      "Not now! I'm busy panicking.",
      "Poke me later. Preferably after I survive.",
      "Do not startle the condemned!",
      "I'm trying to keep my head. Don't distract me.",
      "Poke me again and I'll scream. I have no lungs, but I'll try.",
      "This is not the time for friendship.",
    ],
    SAVED_STREAK: [
      "Another save in a row. I'm starting to think you like me.",
      "That's a streak. My stick wife won't believe it.",
      "Another save. At this point, I'm your lucky charm.",
      "You keep saving me and I keep needing it. Perfect system.",
      "The streak continues. The rope is filing a complaint.",
      "A saving streak. Somebody frame this.",
    ],
    SAVED_BEST: [
      "A personal best. Don't let it go to your head.",
      "You're at your best right now. I can tell.",
      "Your best run. I'm honoured. And tied up.",
      "A record run. The rope is taking notes.",
      "This is your best streak. Try to enjoy it.",
    ],
    SAVED_RETURN: [
      "Back again, and still saving me. Consistent.",
      "You've done this before. It shows.",
      "Another game, another escape. Hello again.",
      "I remember you. You're the one with the good letters.",
      "We keep meeting like this. I'm not complaining.",
      "Still alive, still grateful, still made of wood.",
    ],
    LOSS_BACK: [
      "Back again, and back to this. Great.",
      "You've lost before. This is becoming a habit.",
      "The rope remembers you.",
      "Another game, another loss. Hello again.",
      "I'd say better luck next time, but we both know.",
      "Same story, again.",
    ],
    SETTER_RETURN_SELF: [
      "You're back. The rope missed you.",
      "Another word, another hostage situation.",
      "You've been here before. I remember. Vaguely.",
      "Back to choose my fate again? Lovely.",
      "I remember last time. I have nightmares.",
    ],
    SETTER_RETURN_HANDOFF: [
      "There's been a game here before. So have I.",
      "Another word. Another bad day for me.",
      "This device has done this before. It shows.",
      "Another game. The rope is thrilled.",
      "Same game. I'm not optimistic.",
    ],
    SETTER_FIRST_SELF_SHORT: [
      "I'm Splinter. A short word. Bold opening.",
      "First time? I'm Splinter. That's a small word for a big mistake.",
    ],
    SETTER_FIRST_SELF_MID: [
      "I'm Splinter. A normal word. We'll see how normal.",
      "First game? I'm Splinter. That word looks reasonable. Suspicious.",
    ],
    SETTER_FIRST_SELF_LONG: [
      "I'm Splinter. A long word. You've met me at a bad time.",
      "First time? I'm Splinter. You picked a monster.",
    ],
    SETTER_FIRST_HANDOFF_SHORT: [
      "I'm Splinter. Player 1 picked a short one. Make it count.",
      "First game? I'm Splinter. A short word. Surely.",
    ],
    SETTER_FIRST_HANDOFF_MID: [
      "I'm Splinter. Player 1 picked a normal word. Show them normal.",
      "First game? I'm Splinter. That word looks fair. It isn't always.",
    ],
    SETTER_FIRST_HANDOFF_LONG: [
      "I'm Splinter. Player 1 picked a monster. Good luck.",
      "First game? I'm Splinter. You've been handed a long one.",
    ],
    SETTER_SELF: {
      short: [
        "A short word. Cruel, but efficient.",
        "Few letters, plenty of trouble.",
        "Short and nasty. Player 2 will love it.",
      ],
      mid: [
        "A fair-looking word. Suspiciously fair.",
        "Nothing too cruel. Nothing too kind.",
        "A normal word. How disappointing.",
      ],
      long: [
        "A long one. Player 2 is going to feel that.",
        "Lots of letters. Lots of ways to suffer.",
        "You chose a monster. I respect it.",
      ],
    },
    SETTER_HANDOFF: {
      short: [
        "Player 1 picked a short one. Surely you can spell it.",
        "Four letters or fewer. This is a gift.",
        "A short word. Player 1 is feeling generous.",
      ],
      mid: [
        "Player 1 picked a normal word. Show them normal is enough.",
        "A fair word from Player 1. No excuses now.",
        "Nothing fancy. Just spell it.",
      ],
      long: [
        "Player 1 picked a monster. Good luck.",
        "Eight letters or more. Player 1 chose violence.",
        "A long word. Player 1 wants to watch the world burn.",
      ],
    },
  };

  // Every pool has one expression, because in a pool the tone is the same.
  // The man's face must agree with his words: praise gets a proud face even
  // when the rope is one miss away, so he never smiles through a shiver.
  const FACES = ["calm", "worried", "scared", "terrified", "pleading", "smug",
    "annoyed", "deadpan", "shocked", "proud", "relieved", "hopeful", "nervous",
    "saved", "dead"];
  const FACE_BY_POOL = {
    FIRST_MISS: "shocked",
    BEGS: "pleading",
    BEGS_LAST: "pleading",
    MANY_WRONG: "smug",
    VOWEL_NUDGE: "smug",
    VOWEL_PAYOFF: "smug",
    VOWEL_WRONG: "deadpan",
    NO_VOWELS: "deadpan",
    COMEBACK: "proud",
    FIRST_HIT: "hopeful",
    DOUBLE: "proud",
    STREAK: "proud",
    ALL_VOWELS: "proud",
    NEARLY: "hopeful",
    ONE_LEFT: "nervous",
    LAST_LIFE_SURPRISE: "shocked",
    LAST_LIFE_PRAISE: "proud",
    RELIEF: "relieved",
    DANGER: "nervous",
    LAST_CHANCE: "nervous",
    SHORT_LAST_CHANCE: "smug",
    LONG_LAST_CHANCE: "nervous",
    LOSS: "dead",
    SHORT_LOSS: "dead",
    LONG_LOSS: "dead",
    ALMOST_LOSS: "dead",
    SAVED: "saved",
    SAVED_BARELY: "saved",
    SAVED_INTACT: "proud",
    SAVED_STREAK: "saved",
    SAVED_BEST: "saved",
    SAVED_RETURN: "saved",
    LOSS_BACK: "dead",
    IDLE: "deadpan",
    POKE: "annoyed",
    POKE_SCARED: "nervous",
    SETTER_RETURN_SELF: "smug",
    SETTER_RETURN_HANDOFF: "smug",
    SETTER_FIRST_SELF_SHORT: "smug",
    SETTER_FIRST_SELF_MID: "smug",
    SETTER_FIRST_SELF_LONG: "smug",
    SETTER_FIRST_HANDOFF_SHORT: "smug",
    SETTER_FIRST_HANDOFF_MID: "smug",
    SETTER_FIRST_HANDOFF_LONG: "smug",
    SETTER_SELF: "smug",
    SETTER_HANDOFF: "smug",
  };
  const FACE_OF = Object.create(null);
  function tagPool(name, pool) {
    const face = FACE_BY_POOL[name] || "deadpan";
    if (Array.isArray(pool)) for (const line of pool) FACE_OF[line] = face;
    else for (const lines of Object.values(pool)) for (const line of lines) FACE_OF[line] = face;
  }
  for (const [name, pool] of Object.entries(P)) tagPool(name, pool);

  // The expression for a spoken line. Text is unique across the pools (the
  // test enforces it), so this is exact even though the game only stores text.
  function faceOf(text) { return FACE_OF[text] || "deadpan"; }

  // Lines already said, so the man does not repeat himself back to
  // back. A pool with every line recently used falls back to the full
  // pool rather than going silent.
  const recent = [];
  const RECENT_MAX = 18;

  function pick(pool) {
    const fresh = pool.filter((line) => !recent.includes(line));
    const from = fresh.length ? fresh : pool;
    const line = from[Math.floor(Math.random() * from.length)];
    recent.push(line);
    if (recent.length > RECENT_MAX) recent.shift();
    return line;
  }
  function resetRecent() { recent.length = 0; }

  function wrongCount(word, mask) {
    let wc = 0;
    for (let i = 0; i < 26; i++) {
      if ((mask & bit(i)) && !word.includes(String.fromCharCode(A_CODE + i))) wc++;
    }
    return wc;
  }
  function isSolved(word, mask) {
    return word.split("").every((ch) => mask & bit(letterIdx(ch)));
  }
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
  function hasAnyVowel(word) {
    return word.split("").some((ch) => VOWELS.includes(ch));
  }
  function hasUnguessedVowel(word, mask) {
    for (const ch of word) {
      if (VOWELS.includes(ch) && !(mask & bit(letterIdx(ch)))) return true;
    }
    return false;
  }
  // True when the word already has a revealed letter other than `except`.
  // Used to tell a first correct guess from a later one.
  function revealedOther(word, mask, except) {
    const seen = new Set([except]);
    for (const ch of word) {
      if (seen.has(ch)) continue;
      seen.add(ch);
      if (mask & bit(letterIdx(ch))) return true;
    }
    return false;
  }
  function isDoubleHit(word, ch) {
    return word.split("").filter((c) => c === ch).length >= 2;
  }

  function newState() {
    return {
      nudge: null,          // what the last line hinted at, for the next guess to answer
      lastLifeHits: 0,      // right letters in a row while on the last life
      hitStreak: 0,         // right letters in a row at any point
      toldVowels: false,    // the "all vowels are out" line is said once
      toldNearly: false,    // the "two letters left" line is said once
      toldOne: false,       // the "one letter left" line is said once
    };
  }

  function shapeOf(word) {
    if (word.length <= SHORT_WORD_MAX) return "short";
    if (word.length >= LONG_WORD_MIN) return "long";
    return "mid";
  }

  function lastChanceTaunt(word) {
    if (word.length <= SHORT_WORD_MAX) return pick(P.LAST_CHANCE.concat(P.SHORT_LAST_CHANCE));
    if (word.length >= LONG_WORD_MIN) return pick(P.LAST_CHANCE.concat(P.LONG_LAST_CHANCE));
    return pick(P.LAST_CHANCE);
  }

  function savedLine(history, misses) {
    const h = history || {};
    if (misses === 0) return pick(P.SAVED_INTACT);
    if (misses === MAX_WRONG - 1) return pick(P.SAVED_BARELY);
    if ((h.streak || 0) >= 3 && (h.streak || 0) === (h.best || 0)) return pick(P.SAVED_BEST);
    if ((h.streak || 0) >= 3) return pick(P.SAVED_STREAK);
    if ((h.games || 0) > 1 && Math.random() < 0.35) return pick(P.SAVED_RETURN);
    return pick(P.SAVED);
  }

  function lossTaunt(word, mask, history) {
    const h = history || {};
    let pool = P.LOSS;
    if (word.length <= SHORT_WORD_MAX) pool = pool.concat(P.SHORT_LOSS);
    else if (word.length >= LONG_WORD_MIN) pool = pool.concat(P.LONG_LOSS);
    if (typeof mask === "number" && missingUniqueCount(word, mask) <= ALMOST_MAX_MISSING) {
      pool = pool.concat(P.ALMOST_LOSS);
    }
    if ((h.losses || 0) >= 2 && Math.random() < 0.35) return pick(P.LOSS_BACK);
    return pick(pool);
  }

  function setterLine(word, mode, history) {
    const h = history || {};
    const shape = shapeOf(word).toUpperCase();
    if (!(h.games > 0)) {
      return pick(P[`SETTER_FIRST_${mode === "self" ? "SELF" : "HANDOFF"}_${shape}`]);
    }
    if ((h.games || 0) > 0 && Math.random() < 0.25) {
      return pick(mode === "self" ? P.SETTER_RETURN_SELF : P.SETTER_RETURN_HANDOFF);
    }
    const table = mode === "self" ? P.SETTER_SELF : P.SETTER_HANDOFF;
    return pick(table[shapeOf(word)]);
  }

  function idleLine() { return pick(P.IDLE); }

  function pokeLine(misses) {
    return pick((misses || 0) >= MAX_WRONG - 2 ? P.POKE_SCARED : P.POKE);
  }

  // The line (as { text, beg } or "") to show after a guess. `mask` already
  // includes `ch`. State changes (the nudge, streaks, one-time lines) are
  // committed only for a line that is actually shown, so a later callback
  // can never answer a hint the player did not see.
  function react(st, word, mask, ch) {
    const misses = wrongCount(word, mask);
    if (isSolved(word, mask) || misses >= MAX_WRONG) { st.nudge = null; return ""; }

    const hit = word.includes(ch);
    const isVowel = VOWELS.includes(ch);
    const prevNudge = st.nudge;
    st.nudge = null;

    if (!hit) {
      st.hitStreak = 0;
      st.lastLifeHits = 0;

      // The first miss draws his head: that is when he starts talking.
      if (misses === 1) return { text: pick(P.FIRST_MISS), beg: true };

      // A word with no vowels is worth saying once: it stops the guesser
      // wasting the rest of the game on A, E, I, O and U.
      if (isVowel && !hasAnyVowel(word) && Math.random() < 0.8) {
        return { text: pick(P.NO_VOWELS) };
      }

      // The final life: the dramatic line gets first claim now, with a
      // beg as the fallback rather than the other way round.
      if (misses === MAX_WRONG - 1) {
        const r = Math.random();
        if (r < 0.65) return { text: lastChanceTaunt(word) };
        if (r < 0.85) return { text: pick(P.BEGS_LAST), beg: true };
        return { text: pick(P.BEGS), beg: true };
      }

      // Two lives left: the gap the old bank had no line for.
      if (misses === MAX_WRONG - 2) {
        const r = Math.random();
        if (r < 0.45) return { text: pick(P.DANGER) };
        if (r < 0.75) return { text: pick(P.BEGS), beg: true };
      }

      if (misses >= 2 && Math.random() < 0.45) {
        return { text: pick(P.BEGS), beg: true };
      }

      if (misses >= MANY_WRONG_THRESHOLD) {
        if (hasUnguessedVowel(word, mask) && Math.random() < 0.35) {
          st.nudge = "vowel";
          return { text: pick(P.VOWEL_NUDGE) };
        }
        st.nudge = "other";
        return { text: pick(P.MANY_WRONG) };
      }
      return "";
    }

    st.hitStreak++;

    // On the last life every right letter earns a line (surprise first,
    // then genuine praise), which outranks the ordinary callbacks.
    if (misses === MAX_WRONG - 1) {
      st.lastLifeHits++;
      if (st.lastLifeHits === 1) {
        return Math.random() < 0.7 ? { text: pick(P.LAST_LIFE_SURPRISE) } : "";
      }
      return { text: pick(P.LAST_LIFE_PRAISE) };
    }

    // Answer the line the player just saw. These always fire, because the
    // player is owed the follow-up.
    if (prevNudge === "vowel" && isVowel) return { text: pick(P.VOWEL_PAYOFF) };
    if (prevNudge) return { text: pick(P.COMEBACK) };

    // Word-shape reactions, strongest first.
    if (!st.toldVowels && hasAnyVowel(word) && !hasUnguessedVowel(word, mask)) {
      if (Math.random() < 0.8) { st.toldVowels = true; return { text: pick(P.ALL_VOWELS) }; }
    }

    const missing = missingUniqueCount(word, mask);
    if (missing === ALMOST_MAX_MISSING && !st.toldOne && Math.random() < 0.75) {
      st.toldOne = true;
      return { text: pick(P.ONE_LEFT) };
    }
    if (missing === 2 && !st.toldNearly && Math.random() < 0.5) {
      st.toldNearly = true;
      return { text: pick(P.NEARLY) };
    }

    if (!revealedOther(word, mask, ch) && Math.random() < 0.8) {
      return { text: pick(P.FIRST_HIT) };
    }
    if (isDoubleHit(word, ch) && Math.random() < 0.4) {
      return { text: pick(P.DOUBLE) };
    }
    if (st.hitStreak >= 3 && Math.random() < 0.45) {
      return { text: pick(P.STREAK) };
    }
    if (misses >= MANY_WRONG_THRESHOLD && Math.random() < 0.35) {
      return { text: pick(P.RELIEF) };
    }
    return "";
  }

  root.HangmanBanter = {
    MAX_WRONG,
    newState,
    react,
    savedLine,
    lossTaunt,
    setterLine,
    idleLine,
    pokeLine,
    faceOf,
    faces: FACES,
    // exposed for hangman/banter.test.mjs
    pools: P,
    pick,
    resetRecent,
    wrongCount,
    missingUniqueCount,
  };
})(typeof window !== "undefined" ? window : globalThis);
