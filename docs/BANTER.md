# Banter — the personality and table-talk systems

This note captures the naming, scope and plan for the two quip systems so the
decision is recorded once and the code follows it.

## Naming

**Banter** is the umbrella name for everything below. There are two different
systems under it, and they are not the same thing:

- **Commentary** — automatic lines on your own screen, fired by game outcomes
  (win, loss, draw, near-miss, streaks). Internally this is still
  `shared/taunts.js` + `Gamekit.taunt()`. It works in solo, vs-computer, pass-and-play
  and link play.
- **Table Talk** — player-sent lines in a live or card room, with two tones:
  - **Hype** — supportive, complimentary, good sportsmanship.
  - **Heckle** — playful provocation, pressure, trash talk.

The old "angel / devil" feature is renamed to **Table Talk · Hype / Heckle**.
The wire keeps sending a position in a vetted list (`k: "h" | "k"`, `i`), never
free text, and the server still validates the position and rate-limits it.

## Shelved — Table Talk (2026-10-23)

Table Talk (Hype / Heckle) is switched off for now: `window.TABLE_TALK = false`
in [shared/taunts.js](../shared/taunts.js). Nothing was deleted. The line lists,
the room buttons, the delivery code and the Worker protocol are all still in
place; `shared/live-share.js`, `shared/multiseat.js` and `crazy-8/game.js` return
early on the flag, so setting it to `true` is the only change needed to bring
the feature back. Commentary and Hangman's own banter are unaffected.

## Which games get what

Commentary is only added where there is a persona or a dramatic arc worth
hearing. Table Talk is only added where there is a real-time room *and* social
tension (bluffing, a victim, a shared risk). A game that is meditative,
single-player, or deep-and-quiet keeps at most a single result line.

**Both systems (best fit):** Liar's Dice, Crazy 8, Hearts, Farkle,
Rock Paper Scissors, Backgammon — plus Hangman as the flagship.

**Commentary only (no Table Talk):** Battleship, Pig, Chess (Chess banter only
as an opt-in, dry not nasty), Breakthrough, Nine Men's Morris.

**Neither system:** all solo puzzles (Sudoku, Mini Sudoku, Nonogram, Cross
Sums, Sliding Puzzle, Water Sort, Car Park, Minesweeper, Lights Out, Memory,
2048, Queens, Tango, Zip, Patches, Hashiwokakero, Flow Free, Slitherlink, Star
Battle), all word games
(Word Ladder, Word Guess, Letter Boxed, Word Search), Yatzy, Mastermind,
Mancala, and the heavy abstracts (Onitama, Quoridor, Hex, Gomoku, Pentago,
Ultimate Tic-Tac-Toe, Blokus Duo).

## Load-time budget

- Current `shared/taunts.js`: 64 KB raw, 20.5 KB gzip, 17.8 KB Brotli, loaded with
  `defer` on every game page, so it never blocks rendering.
- The rename itself costs nothing at runtime — one cache refresh of ~18 KB
  compressed, then cached again.
- An expanded template bank should stay under ~180 KB raw / ~50 KB Brotli
  (~2–6 ms to parse on a mid phone). If it grows past that, split into
  `banter-core.js` + per-game files, but that is not needed now.
- Online messages stay the same size: a tone and an index, no text payload.
- Hangman's own bank (`hangman/banter.js`) is 22 KB raw / 7.4 KB gzip and is
  loaded only by the hangman page, not by the other games.

## Safety and delivery rules

- Server sees only `{ k, i }`; the text is reconstructed from the same vetted
  list on both ends.
- A Heckle should default to a "playful" tone; a rougher "competitive" tone is
  opt-in.
- Keep the rate limit; consider raising Heckle to ~6 s and capping it per
  minute.
- A line must be true whenever its category fires (existing rule, unchanged).

## Plan

1. Rename the online feature to Table Talk · Hype / Heckle (done).
2. Remove the system from the games in the "neither" list (done).
3. Add context tags and a picker with memory and pacing for the "best fit"
   games (the per-game content for Liar's Dice, Hearts, Farkle and Backgammon
   landed on 2026-10-23; the tag/context picker is still open).
4. Add safe template slots (`{margin}`, `{moves}`, `{opponent}`) only after the
   tags version is proven.
5. Online context groups and like-for-like reply suggestions.

No live LLM is planned for either system: latency, cost, moderation and offline
behaviour all argue against it.

## Implemented — hangman expansion (2026-10-22)

Hangman keeps its commentary in its own file, [hangman/banter.js](hangman/banter.js),
loaded only on the hangman page: the stick man's persona and speech bubble are
specific to that game, so this is not a `shared/taunts.js` block. `hangman/game.js` is
now page plumbing only.

### What changed

- **Moved** all of hangman's pools and decision logic out of `hangman/game.js`
  into `hangman/banter.js` (pure data and pure functions: no DOM, no page state).
  `react(state, word, mask, letter)` returns `{ text, beg }` or `""`;
  `savedLine()`, `lossTaunt(word, mask)` and `setterLine(word, mode)` handle the
  end of a game and the word-setter's view.
- **Grew the bank** from 19 pools / 126 lines to 33 pools / 264 lines. The
  mid-game pools that carry most of a game were expanded most: `BEGS` 10 → 22,
  `MANY_WRONG` 9 → 21, `BEGS_LAST` 6 → 10, `LAST_CHANCE` 12 → 20.
- **New moments:**
  - `FIRST_HIT` — the first correct letter now gets a reaction (it used to be
    silent until three misses).
  - `DANGER` — a line for the miss that leaves two lives, between the
    many-wrong chatter and the final-guess drama.
  - `ALL_VOWELS` — once per game, when the word has no vowels left hidden.
  - `NEARLY` / `ONE_LEFT` — once each, as the word runs out of blanks.
  - `DOUBLE` — when the guessed letter appears more than once.
  - `STREAK` — three or more correct letters in a row.
  - `NO_VOWELS` — if a vowel is guessed in a word that has none, he says so
    instead of letting the guesser waste turns on A, E, I, O and U.
  - `SETTER_SELF` / `SETTER_HANDOFF` — Player 1's word gets a comment before
    the first guess: on the setter's own WhatsApp screen, and for Player 2 in
    pass-and-play. Picked once per word so a re-render is stable.
- **Expanded the endings:** `SAVED` 3 → 10, `LOSS` 12 → 18, with matching
  short-word, long-word and almost-lost additions.

### Fixed while in there

- **The last-chance line was mostly swallowed.** Begging was checked first, so
  the dramatic line appeared in roughly one final miss in ten. A final miss now
  uses the last-chance line 65% of the time, `BEGS_LAST` 20%, and `BEGS` 15%.
- **A hint could be lost but still counted.** `guessNote` recorded the vowel
  nudge before the begging layer could replace the line, so a later "See?? Vowels"
  could answer a hint the player never saw. Nudge state is now committed only
  when its line is actually shown.
- **Begging could override callbacks.** Planned lines (vowel payoff, comeback,
  word-shape reactions) now win; begging and relief only fill a silence.
- **No anti-repeat.** `pick()` remembers the last 18 lines and avoids every one
  of them while its pool has an unused line, so two consecutive misses can no
  longer show the same text (which also looked like the man said nothing,
  because `speak()` skips identical text).

### Tests

- `node hangman/banter.test.mjs` — pool shape (empty/duplicate/over-long/emoji),
  first miss, final-miss priority, nudge not left pending, first hit, all
  vowels, one left, no vowels, solved-word silence, setter shape/mode,
  anti-repeat, and end-of-game lines.
- New regression checks in `tests/regression.mjs`: `hangman-no-repeat` and
  `hangman-setter-line`. Existing `hangman-man-speaks`,
  `hangman-ghost-clear-of-man` and `hangman-one-taunt` still pass.
- `hangman/index.html` loads `banter.js` with a `?v=` stamp; `node
  tests/cache-bust.mjs` has been run.

## Implemented — Splinter, the living stick man (2026-10-22)

The drawing is no longer a progress indicator. It is one grouped SVG character
(`<g id="man">`) called Splinter, with a face, a memory and opinions.

### Pools and selectors

- **New pools:** `IDLE` (11), `POKE` (10), `POKE_SCARED` (6),
  `SAVED_STREAK` (6), `SAVED_BEST` (5), `SAVED_RETURN` (6), `LOSS_BACK` (6),
  `SETTER_RETURN_SELF` (5), `SETTER_RETURN_HANDOFF` (5), and six first-game
  `SETTER_FIRST_*` pools (short / mid / long × self / handoff, 2 lines each).
- **Total:** 48 pools / 336 lines.
- **New API:** `idleLine()`, `pokeLine(misses)`,
  `savedLine(history)`, `lossTaunt(word, mask, history)` and
  `setterLine(word, mode, history)`.
- **Memory selection:** `savedLine` uses `SAVED_BEST` when the current streak
  is also the best, `SAVED_STREAK` at three or more, or a 35% `SAVED_RETURN`
  for a returning player. `lossTaunt` gives a repeat loser a 35% chance of
  `LOSS_BACK`. `setterLine` introduces Splinter on the first game
  (`games === 0`) and gives a returning setter a 25% chance of a
  `SETTER_RETURN` line.

### Drawing and behaviour

- The six parts draw on with `stroke-dashoffset`; the rope is separate and
  retracts on a save. A dust puff fires at the joint of each genuinely new part.
- Face: eyes, pupils, brows, four mouths, sweat and X eyes. Light feature
  colours read on the dark page. `data-mood` is `calm`, `worried`, `scared`,
  `terrified`, `saved` or `dead`.
- Reactions: breathing sway, hit relax, miss flinch, poke wiggle, last-life
  shiver, saved drop, dead limp. All are CSS and all are switched off under
  `prefers-reduced-motion`.
- Poke: the gallows is a labelled button; click, Enter or Space gets a `POKE`
  line (or `POKE_SCARED` from four misses), but only once the head is drawn.
- Idle: 15 s, then 25 s, at most two per board, cleared by any guess and paused
  while the tab is hidden.
- Eyes follow the hovered or last-guessed key; a faint chalk outline shows the
  empty man before the first miss; the ground shadow grows with the drawing.
- Bubble: overshoot on entry, a gentle `beg` shake, a trembling tail when
  terrified.

### Memory

`Gamekit.storage("hangman:")` keeps `history` with `games`, `saves`, `losses`,
`streak`, `best`, `last` and `lastKey`. A finished WhatsApp link records once
per `word:mask`; local games record once per board. The record is read only for
flavour lines, never for hints or odds.

### Tests

- `node hangman/banter.test.mjs` — `banter.js ok (336 lines in 48 pools)`,
  including first-game/returning setter, save-streak, personal-best,
  repeat-loss, idle and poke.
- New regressions: `hangman-face-mood`, `hangman-poke-idle`,
  `hangman-saved-pose`, `hangman-reduced-motion`.
- `node tests/regression.mjs --page hangman` — 17/17 passed.

## Implemented — expression range and the victory sequence (2026-10-23)

The face used to be driven only by the miss count, so a praise line could be
delivered while he was still shaking. The line now carries the expression.

### Faces

- **15 expressions:** `calm`, `worried`, `scared`, `terrified`, `pleading`,
  `smug`, `annoyed`, `deadpan`, `shocked`, `proud`, `relieved`, `hopeful`,
  `nervous`, `saved`, `dead`.
- **Every pool has a face.** `FACE_BY_POOL` in `hangman/banter.js` maps each
  pool to its expression (e.g. `BEGS → pleading`, `MANY_WRONG → smug`,
  `FIRST_MISS → shocked`, `LAST_LIFE_PRAISE → proud`), and `faceOf(text)`
  resolves the spoken line. Text is unique across pools, so the exact line
  always gets its exact face.
- **New SVG parts:** raised / angry / flat brow sets, happy closed eyes, grin,
  smirk, flat, wail, small-o and wobble mouths, a blush and a tear.
- **`data-face` on the stage** overrides the resting `data-mood` expression.
  The face also controls body language: proud/smug/hopeful talk with a small
  sway, pleading/nervous fidget, and the last-life shiver is suppressed while
  a positive line is being delivered. A praise line therefore never shakes.
- **Small life details:** each page-load blinks on its own rhythm, he glances
  around the room when the idle line fires, and the sweat/blink speed change
  with the mood.

### Winning

- A save now **pulls the missing parts together** (staggered `hm-draw`), hides
  the chalk outline, retracts the noose entirely, and drops the completed man
  to the ground with a small hop, a landing dust puff and three sparkles. This
  works even for a flawless win where no part had been drawn yet.
- `savedLine(history, misses)` adds two state-aware pools: `SAVED_INTACT`
  (`misses === 0`, proud face) and `SAVED_BARELY` (`misses === 5`, saved face).
  Normal, streak, best and returning-player pools are unchanged.
- Under `prefers-reduced-motion` the completed man, hidden noose and final
  standing pose are set statically; nothing animates. The how-to explains the
  victory sequence.

### Tests

- `node hangman/banter.test.mjs` — `banter.js ok (352 lines in 50 pools)`,
  plus a check that every line has a known face and that the face pools agree.
- New regressions: `hangman-expression-match` (last-life surprise/praise face
  and no shiver), `hangman-win-complete` (flawless win: 6/6 parts, proud face,
  no noose, drop), updated `hangman-face-mood`, `hangman-saved-pose` and
  `hangman-reduced-motion`.
- `node tests/regression.mjs --page hangman --only hangman` — **12/12 passed**.

## Implemented — four missing Commentary blocks (2026-10-23)

`shared/taunts.js` gained dedicated blocks for the last four "best fit" games that had
none: **Liar's Dice** (loss 10, win 10), **Hearts** (loss 10, win 10),
**Farkle** (loss 10, win 10) and **Backgammon** (loss 10, win 10, forfeit 8,
resigned 8). Only categories the games actually call were added, so no line can
fire in a situation the game does not report. `node shared/taunts.test.mjs` passes.
Context tags, the safe-slot picker and template slots are still open (plan
steps 3-4).

## Hangman pacing (2026-10-23)

Pacing (2026-10-23): `react(st, word, mask, ch, level)` wraps the old picker. A line is owed at the first miss, the last life (and its first two right letters) and as the answer to his own hint; otherwise he stays quiet for `QUIET_GUESSES[level]` guesses after speaking (some 5, lots 1, off never). The page fades ordinary bubbles after about 1.5s + 40ms a character, shows a short face (`flashFace`) for a quiet guess, and keeps end-of-game lines up. Measured on 800 simulated games per setting: about 5.4 lines a game before, 2.4 on some, 4.2 on lots, 0 on off (`node hangman/banter.test.mjs`).
