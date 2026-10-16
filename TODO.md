# TODO

Everything asked for so far that is not done yet, grouped by area. Nothing here is started.
`(?)` marks a point where the request could be read two ways; settle it before building.

## How to work through this
Every bug fixed in one game must be checked in **all** the others, so the same mistake is not repeated. For each fix, grep or test every game page for the same pattern, and add it to the list below if it keeps coming back.

**Cross-game checklist** (run it on all 21 games after any UI or logic change):
- [ ] Undo and reset leave the right player to move
- [ ] No duplicate "your move / you're Player N" text (one status, one badge)
- [ ] Controls (difficulty, new game, undo, timer, moves, best) are in the standard place
- [ ] "how to ?" is top right
- [ ] Game-over state is obvious
- [ ] Nothing is cut off on a phone (every board size and difficulty)
- [ ] Taunt wording is true for the mode it appears in (vs computer, local, link, online)
- [ ] Survives an accidental refresh

---

## 1. Bugs and broken things
- [ ] **Zip:** loads slowly, and picking **Hard freezes** the page. Profile the puzzle generator; likely an unbounded search. Cap it, or generate in a worker or in steps.
- [ ] **Queens, Hard:** some bottom cells are cut off. Check the grid sizing at every difficulty, on a phone.
- [ ] **Undo vs computer** (found in Connect Four): undoing returns to the *computer's* turn, so the page sits on "AI thinking…". It must return to the player's turn. Check every game that has undo against the computer.
- [ ] **Duplicate "your move / you're Player N":** Pentago and Mancala (and check the rest) show the status in the top corner *and* the badge. Remove the small corner one.
- [ ] **Mastermind:** the prompt says "pick 4 colours" but the pegs are numbered. Fix the wording, or show real colours with the number as a small label.
- [ ] **Accidental refresh mid-game:** decide and build what survives it.
  - Link and online games already restore (state is in the URL, or the room is rejoined with the seat token).
  - Solo, vs computer and same-device games lose everything. Save the game to local storage on each move and offer "Resume your game".
  - Don't resume a finished game; don't restore a stale daily puzzle.
- [ ] **Online badges shift the screen:** the "waiting" and "your turn" badges are different sizes, so the layout jumps every time a move is made. Make them the same height and width.

## 2. Wording and naming
- [ ] Rename **"vs AI" to "vs computer"** everywhere (menus, how-to text, taunts, hub copy).
- [ ] **vs-computer taunts:** current lines assume a human opponent ("they built a 4"). Write computer-specific ones ("Boom! Computer power", ...). Keep the lines in `taunts.js` and make the right pool fire per mode.

## 3. Taunts
- [ ] **Make in-game taunts more visible**, right above the board, not in small text in a corner.
- [ ] **New lines for Admit Defeat and losing** (`(?)` my reading of the request):
  - When you are doing badly: *"It's not looking so good for you. We have an Admit Defeat button, you know... coward."*
  - When someone presses Admit Defeat: *"We made that button small, but you found it, huh?"*
  - When they have lost or given up: *"You are going places. Just not first place."* and *"*cough* *cough* ...loser... *cough*"*
  - **Very, very rarely**, when someone is really losing, **highlight the Admit Defeat button** (pulse or colour) as a joke.
- [ ] **Game-over clarity:** for games like 2048 the result is small text in the top-left. Make it a clear banner or overlay.
- [ ] **Angel and devil taunts (online):** suggest a "good" (angel) and a "bad" (devil) taunt; tapping one sends it to the opponent.
  - Server: a `taunt` message that carries only an id from a fixed list (never free text), validated, rate limited, relayed to the other seat.
  - Client: show the two suggestions, show the received taunt briefly, and a mute option.
- [ ] **Hangman:** a real hangman drawing that builds up as guesses fail, with a **speech bubble** that speaks the taunts.

## 4. Controls and layout (consistency)
- [ ] **One standard control area** in every game: difficulty or style, new game or reset, undo, timer, moves, best. Same place, same order, where the game allows.
- [ ] **Mode menu** (2 players / vs computer / online): the same size and shape as the "New game" and "Online" buttons, all on one line.
- [ ] **Online button:** in games where it lands at the bottom under "New game", move it beside the mode menu. Check each game's markup.
- [ ] **Online colour** is too bright; tone it down (hub badge too if needed).
- [ ] **Lightning emoji** back inside the games, next to "Online" `(?)` (it was removed everywhere on request; confirm it is wanted only inside the game pages).
- [ ] **Custom selectors:** replace every native `<select>` (mode, difficulty, best-of, ...) with one shared, styled, keyboard-accessible component.
- [ ] **"how to ?" top right** on every game, same position.
- [ ] **Reduce on-screen clutter once a game starts** so the board and taunts get the space.
- [ ] **Room code panel:** make the code smaller, and put **Copy code** right next to it (currently a large block with the buttons on a row below).

## 5. Game-specific
- [ ] **Rock Paper Scissors:**
  - Better presentation of the **last round** and the **current score** (clear, large, easy to read at a glance).
  - Replace the in-game emojis with proper art (reuse the hub card's hand illustrations).
- [ ] **Dots and Boxes:** a **board size choice** (for example 3×3, 4×4 (current), 5×5, 6×6 boxes). This changes the wire format and the server rules, so version it.
- [ ] **In-game light mode.** Game pages are dark-only today; the hub already has light, dark and system.

## 6. Online play
- [ ] **Bring the remaining games online** (each needs a rules module in `worker/rules/`, a registry entry in `worker/live-games.mjs`, and a `LiveShare` next to its `AsyncShare`; see the README):
  - [ ] Wave 2: Checkers, Mancala, Pentago, Memory, Minesweeper
  - [ ] Chess (extract the move generator so browser and server share it)
  - [ ] Hidden-information games: Battleship, Hangman, Mastermind. The server must hold the secrets and reveal only results, as Rock Paper Scissors does now.

## 7. Accounts-lite, friends and notifications (largest piece, wants its own plan)
- [ ] **Usernames.** The player picks one; if it is taken they pick another. All names live in a database (Durable Object registry or D1) so uniqueness is enforced on the server. No passwords or email.
  - Open: how a name stays "yours" (a secret token kept in the browser, like the room seat tokens) and what happens if it is lost.
  - Open: reserved and offensive names, length and characters, rate limits.
- [ ] **Installable web app** (add to home screen): service worker and an install prompt on the homepage; the manifest already exists.
- [ ] **Poke a friend:** a push notification that asks a friend to play a game with you, opening straight into a live room.
  - Web Push (VAPID). iOS needs the installed app (16.4+); Android and desktop work from the browser.
  - Needs a way to find a friend by username, a permission flow, a block or mute option, and an abuse limit on pokes.
  - Update the privacy page (what is stored: username, push subscription; retention; how to delete it).

## 8. New games
- [ ] **Add more games.** Candidates already discussed: Gomoku, Pig, Shiritori (word chain), Boggle duel, Blokus Duo, Lost Cities, Liar's Dice. Pick which, then build each with a WhatsApp mode first and online after.

---

## Suggested order
1. **Bugs first** (section 1): Zip, Queens, undo, duplicate status text, Mastermind wording, refresh recovery, badge sizes.
2. **Wording** (section 2), because the new taunts depend on it.
3. **Layout and controls** (section 4), because it touches the same markup as the clutter and light-mode work.
4. **Taunts** (section 3), then **game-specific** items (section 5).
5. **More games online** (section 6) and **new games** (section 8), in waves.
6. **Usernames, installable app, poke notifications** (section 7) last: they add a database and push notifications.
