# TODO

Everything asked for so far, grouped by area. Sections 1–5, 7 and 8 are built; what is left is at the bottom.
`(?)` marks a point where the request could be read two ways; settle it before building.

## How to work through this
Every bug fixed in one game must be checked in **all** the others, so the same mistake is not repeated. For each fix, grep or test every game page for the same pattern, and add it to the list below if it keeps coming back.

**Cross-game checklist** (run it on all games after any UI or logic change; last run in full on 2026-10-16: pages at 320 / 390 / 1000 px in both themes, taunts in every mode, board stability, refresh, undo):
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
- [x] **Crazy 8 ("7 cards")**: built to your house rules (online rooms of 2 to 4 with computer seats, vs computer, Normal and Tournament). Next: how it looks for the player.
- Still on the list for later: Shiritori, Boggle duel, Lost Cities.


## 9. New games, round 2 — BUILT, needs your deploy check
Eleven more games, built in the order you gave, one commit each on `claude/live-play`. Each has a hub card with inline SVG art, a how-to, README notes, taunts through `Gamekit`, a runnable check, and a layout scan at 320 / 390 / 1000 px in both themes (no sideways scroll, no JS errors; `worker/` tests all pass).
- [x] **Onitama:** WhatsApp, online, vs computer (3 levels), same device. Rules + computer are one file (`onitama/rules.js`) shared with the Worker.
- [x] **Quoridor:** WhatsApp, online, vs computer, same device. Wall placing is tap-the-crossing, tap again or Rotate to turn it, Place to confirm; the "no pawn may be shut in" rule is a BFS.
- [x] **Liar's Dice:** online rooms of 2 to 4 with computer seats, and vs computer; no link or same-device play (dice can't be hidden there). `card-protocol.mjs` now takes a game and its engine; the room screens are the shared `multiseat.js`.
- [x] **Letter Boxed:** 55,000-word list (296 KB, about 115 KB gzipped, lazy-loaded, cached for a day), daily and random, three levels, hints, best, resume.
- [x] **Backgammon:** WhatsApp (your browser rolls, runs on trust like Pig), **online with the server rolling** (a new `stamp` hook in `live-protocol.mjs`; it also passes the turn if a player can't move), vs computer, same device. Single games, no cube.
- [x] **Dominoes:** online rooms of 2 to 4 with computer seats, and vs computer; no link or same-device play (hidden hands).
- [x] **Yatzy:** Yahtzee scoring with the joker rule, a daily dice table (same dice for everyone, re-rolling the same die in the same spot always gives the same face) and random games; solo only.
- [x] **Cross Sums (Kakuro):** every puzzle has exactly one solution (givens are added until a bounded solver finds no other), three levels, daily and random, notes, check, timer.
- [x] **Sliding Puzzle**, **Water Sort** (solver-checked, with hints), and **Chess Puzzles** (200 Lichess CC0 puzzles as a mode of the Chess page, all verified against the page's own move generator; credited in the how-to).
- [x] Hub: a small **Create username** button next to the title on mobile (shows your name once you have one).
- [ ] **You:** deploy and try online rooms for real. `wrangler dev` could not run Durable Objects on this machine (even the existing games' rooms fail there on unmodified code), so the Worker side was tested through the real protocol modules behind a stand-in WebSocket server, not through Cloudflare. Worth a 5-minute check of: Liar's Dice, Dominoes, Backgammon online, Onitama and Quoridor online.
- [ ] Not tried on real phones (checked in headless Edge at phone widths only).
- [ ] The "you should know" review plugin never loaded in this session (the `/plugin` command was unavailable here), so review was my own checks plus `/code-review` at the end.
- [ ] `crazy-8/game.js` still has its own copy of the online room screens that `multiseat.js` now provides for the new games; moving Crazy 8 onto it is a clean-up, not a bug.


## 10. Chunky "fun" look and games from the design screenshots
The user's reference screenshots (flat, chunky, Lilita One, round buttons, per-game colour). Built as opt-in `fun.css` / `fun.js` (`class="fun"` on the body); hub keeps the terminal look.
- **Before the redesign:** the last version with the old look is commit `bff01d7` (git tag `pre-redesign`). Compare with `git diff pre-redesign` or open it in a separate folder with `git worktree add ../WA-mini-games-before pre-redesign`. The old build was also live on Cloudflare until the 2026-10-18 deploy.
- [x] Pilots in the new look: Word Guess, Mancala (now vertical), Dots and Boxes.
- [ ] Roll the look out to every other game, matching the screenshots where one exists: Hangman, Memory, Yatzy, Water Sort; the rest in the same style.
- [x] Dots and Boxes: lines are in the colour of the player who drew them, the latest one is ringed.
- [x] (fixed: the fold now happens on click, not pointerdown) The "fold the menus on the first tap" rule can shift the layout under a finger, so a first tap on a button below the menus can be lost. Delay the fold to the click.
- [ ] **New games, not in the repo yet** (from the screenshots):
  - [ ] **Ludo:** four-colour cross board, roll button and die, 2 to 4 players, vs bot (Easy / Medium / Hard).
  - [ ] **Word Search ("word connect"):** swipe across a ring of letters to spell words that fill a crossword, levels, shuffle button, hints.
  - [ ] **Hearts:** four players (you plus three computer seats), pass three cards each round, the card table and hand as in the screenshots.
  - [ ] **Car parking (Unblock Me / Rush Hour style):** slide cars and trucks to free the red one, levels, undo, hints.

---

## What is left
1. Deploy and switch on pokes (section 7).
2. Bring the remaining games online (section 6), and the Hangman stickman (section 3).
3. Crazy 8's look and feel, then the other new games (section 8).
