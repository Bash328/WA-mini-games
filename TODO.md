# TODO

Everything asked for so far, grouped by area. Sections 1–5, 7 and 8 are built; what is left is at the bottom.
`(?)` marks a point where the request could be read two ways; settle it before building.

## How to work through this
Every bug fixed in one game must be checked in **all** the others, so the same mistake is not repeated. For each fix, grep or test every game page for the same pattern, and add it to the list below if it keeps coming back.

**Cross-game checklist** (run it on all 23 games after any UI or logic change; last run in full on 2026-10-16: pages at 320 / 390 / 1000 px in both themes, taunts in every mode, board stability, refresh, undo):
- [x] Undo and reset leave the right player to move
- [x] No duplicate "your move / you're Player N" text (one status, one badge)
- [x] Controls (difficulty, new game, undo, timer, moves, best) are in the standard place
- [ ] Nothing above the board appears or disappears during play (no layout shift between turns). Solo, computer, same-device and live play are checked and steady; WhatsApp link play still shifts a little when the "send the link" panel replaces the "make your move" note (see section 1)
- [x] "how to ?" is top right
- [x] Game-over state is obvious
- [x] Nothing is cut off on a phone (every board size and difficulty)
- [x] Taunt wording is true for the mode it appears in (vs computer, local, link, online)
- [x] Survives an accidental refresh (`Gamekit.resume`; restore must run AFTER the game's final `applyMode()`)
- [x] Buttons used as cells/pegs beat the shared `body[class*="g-"] .panel button` rule (background, radius, 40px min-height): prefix the page's selector with an id or `body.g-<game> .panel`
- [x] Anything generated from a seed is bounded by step counts, never the clock (daily puzzles must match on every device)

---

## 1. Bugs and broken things — DONE
- [x] **Zip** loaded slowly and **Hard froze**. The uniqueness check searched an astronomically large space with no limit. Generation is now bounded by step counts (not the clock, so the daily puzzle is still identical on every device): about 10–30 ms on every difficulty, tested over 180 seeds.
- [x] **Queens, Hard:** bottom cells were clipped. The cells are buttons and the shared button `min-height` beat the page's own CSS, so rows outgrew the square grid on a phone. Fixed, and confirmed by a layout scan (clipped before, fine after).
- [x] **Undo vs the computer** left the page on "AI thinking…". Connect Four now keeps undoing until it is your turn (and the computer re-opens if you play second). Chess had the same hole when you play Black. Checked every game that has undo.
- [x] **Duplicate "your move / you're Player N":** the turn badge and the small status line said the same thing in *every* link and online game. Link and online games now leave the status empty while the badge shows; other modes hide the status automatically when it only repeats the badge (`Gamekit` does this, so no game has to remember). Status text that adds something (a taunt, "hand the device to Player 2") stays.
- [x] **Mastermind:** the pegs were plain numbered squares (the shared button style beat the colours), so "pick 4 colours" made no sense. Pegs are coloured again, numbers kept as a label.
- [x] **Accidental refresh:** every solo, vs-computer and same-device game now resumes (`Gamekit.resume`): 2048, Queens, Zip, Tango, Mini Sudoku, Patches, Lights Out (solo), Minesweeper (solo), Memory (solo), Tic-Tac-Toe, Connect Four, Chess, Checkers, Reversi, Dots and Boxes, Mancala, Pentago, Rock Paper Scissors, Hangman, Mastermind, Battleship. Saved when the page is hidden or unloaded, discarded after 12 hours and for finished games; corrupt saves are ignored. Link and online games already survive a refresh. A "Picked up where you left off." note shows on resume. Same-device Battleship returns to a cover screen so no fleet is shown.
- [x] **Online screen shifting every move:** Admit defeat moved to one fixed slot **below the board** (shared by link and online play), always reserved during a game, and the turn badge is one fixed height.
  - Still shifts a little in **link** mode: the "Move made, now send the link" panel above the board is taller than the "make your move" note. That is the share panel, not a bug, but it could be moved below the board too.

## 2. Wording and naming — DONE
- [x] **"vs AI" is now "vs computer"** in menus, status text, how-to text, taunts and hub copy.
- [x] **Computer-only taunts.** `taunts.js` has a `_computer` pool ("Boom! Computer power." ...) used instead of the generic pool when the mode menu is set to the computer. In every other mode a line that mentions "the computer" is skipped, so no line can claim something the mode makes untrue (checked by drawing thousands of lines in each mode).

## 3. Taunts — DONE (except the Hangman drawing, skipped on request)
- [x] **Visible taunts.** One strip right above the board (reserved up front, so the board never jumps) shows taunts and the result big. The small status line is hidden while the strip says the same thing.
- [x] **Admit Defeat lines.** The "not looking so good ... coward" nudge when you are behind, "We made that button small, but you found it, huh?" on the loser's screen after resigning, and the "going places" / "*cough*" lines for a loss. Very rarely, when you are really losing, the Admit defeat button winks (pulses).
- [x] **Game-over clarity.** Results ("Red wins.", "Draw.", "Boom.", "Game over." in 2048 ...) appear in the strip as a clear banner.
- [x] **Angel and devil taunts (online).** Two suggested lines, one tap sends one. The server relays only a position in a fixed list (never free text), limited to one every 3 seconds; the receiver sees it in the strip and can mute. Tested against a real room.
- [ ] **Hangman:** the stickman drawing and speech bubble. Skipped as asked; Hangman is unchanged apart from the shared strip.

## 4. Controls and layout — DONE
- [x] **One standard layout**, built by `gamekit.js` on every game page: `how to ?` and a theme button top right; a status row; **[ Mode ▾ ][ Online ][ New game ]** on one line, all one size and shape; then difficulty / size / options; then the share panel, the taunt strip and the board; undo / hint / flip / reset below the board.
- [x] **Online button** sits beside the mode menu everywhere, in a calmer outline colour. **No lightning emoji anywhere** (decided: none, not even in the games).
- [x] **Custom selectors:** every native select is now one shared, keyboard-accessible menu (arrows, Home/End, Enter, Escape).
- [x] **Room code panel:** a small code with **Copy code** right beside it.
- [x] **Clutter:** tighter controls and spacing. Deliberately NOT hiding controls once play starts: that would move the board under a finger mid-game (it would make a Memory or Minesweeper second tap land on the wrong cell).

## 5. Game-specific — DONE
- [x] **Rock Paper Scissors:** a big scoreboard, a face-off panel for the last round (both hands, who took it) and the hub's hand drawings instead of emoji.
- [x] **Dots and Boxes:** board sizes 3×3, 4×4 (default), 5×5, 6×6, chosen by whoever makes the first move and stored in the game state. Wire format version 2 (old links say "older version"); server rules and tests cover every size.
- [x] **In-game light mode:** game pages follow the system, with a theme button in the top bar that shares the hub's saved choice. Checked on all pages at 320, 390 and 1000 px in both themes.

## 6. Online play — NOT STARTED (skipped on request)
- [ ] **Bring the remaining games online** (each needs a rules module in `worker/rules/`, a registry entry in `worker/live-games.mjs`, and a `LiveShare` next to its `AsyncShare`; see the README):
  - [ ] Wave 2: Checkers, Mancala, Pentago, Memory, Minesweeper
  - [ ] Chess (extract the move generator so browser and server share it)
  - [ ] Hidden-information games: Battleship, Hangman, Mastermind. The server must hold the secrets and reveal only results, as Rock Paper Scissors does now.
  - Gomoku went online with its own rules module; Pig stays link/computer/local only (a server can't verify a dice roll).

## 7. Accounts-lite, friends and notifications — BUILT, needs your deploy step
- [x] **Usernames** in one Durable Object (unique by construction), secret token kept in the browser, no recovery, 3–16 letters/digits/`_`, blocklist, 90-day expiry, rate limits.
- [x] **Installable app:** PNG icons, fuller manifest, an install button on the home page, the iPhone Add to Home Screen hint, a service worker for push only.
- [x] **Poke a friend:** by username from a live room's waiting screen; Web Push written from scratch and checked against the RFC 8291 worked example; block, mute and abuse limits; blocked/muted pokes silent.
- [x] **Privacy page** updated (what is stored, retention, how to delete).
- [ ] **You:** deploy and switch pokes on. Names work after `npx wrangler deploy`; pokes need `node worker/vapid-keys.mjs`, the public key in `wrangler.toml`, `npx wrangler secret put VAPID_PRIVATE_KEY`, and a real `VAPID_SUBJECT` (README, "Switching pokes on"). Not verified on real phones or against Google/Apple/Mozilla's push services: only against a fake push service that decrypts exactly as a browser does.

## 8. New games — DONE
- [x] **Gomoku:** 15×15, WhatsApp / online / vs computer (3 levels) / same device.
- [x] **Pig:** WhatsApp / vs computer (3 levels) / same device.
- [x] **Ultimate Tic-Tac-Toe, Hex, Blokus Duo:** WhatsApp / online / vs computer (3 levels) / same device.
- [x] **Solo puzzles:** Sudoku 9×9, Nonogram, Word Guess, Word Ladder.
- [ ] **Crazy Eights ("7 cards")**: waiting for the house rules (which cards do what). Hidden hands mean a server-held deck for online play, and 3+ players need a multi-seat room.
- Still on the list for later: Shiritori, Boggle duel, Lost Cities, Liar's Dice.

---

## What is left
1. Deploy and switch on pokes (section 7).
2. Bring the remaining games online (section 6), and the Hangman stickman (section 3).
3. Crazy Eights, and the other new games (section 8).
