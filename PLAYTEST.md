# Play-test report

Started 2026-10-23 on branch `claude/live-play`. Hangman is excluded (the quality bar). Work order: Play a friend (hub order),
then Classics, then Logic Puzzles, at most 5 games per batch. This file is updated after every game so progress survives a restart.

**Status: every game on the site except Hangman has been through the checks below (about 60 pages), plus three changes you asked
for along the way (launch image, Word Search capsules, Car Park dragging). Verdicts are in the table; nothing is committed or deployed.**
How each group was tested:
- **Link games (Tic-Tac-Toe to Fanorona):** the rules were played over links between two phones against an independent engine where I wrote
  one (Tic-Tac-Toe, Chess, Connect Four, Checkers, Minesweeper, Reversi, Dots and Boxes, Memory, Rock-Paper-Scissors, Pig, Mastermind, Pentago,
  Gomoku, Mancala, Ultimate Tic-Tac-Toe, Hex, Lights Out, Battleship); for the games that already ship a rules file (Blokus Duo, Onitama, Quoridor,
  Breakthrough, Tablut, Fanorona, Nine Men's Morris, Connect 6, Backgammon) I generated hundreds of genuine positions from random full games with
  that file, loaded each as a link and checked none was refused (the shared rules are covered by the existing unit tests, so these are not
  independent). The first move of every link game was also made through the real screen.
- **Computer-only games** (Crazy 8, Liar's Dice, Dominoes, Ludo, Hearts, Farkle, Lost Cities, Cribbage, Skull): a random-click player against the
  computer for 70 to 80 seconds each (Crazy 8 and Skull to the end of games), watching for crashes, stuck screens and end cards. Rules are covered
  by the existing unit tests in `worker/`. The online rooms were not testable here.
- **Puzzles:** where the page lets me read the puzzle, I solved it with my own solver and typed the answer in through the screen (Sudoku, Mini
  Sudoku, Queens, Nonogram, Patches, Word Guess, Word Ladder, 2048, Yatzy); for the rest (Zip, Flow Free, Slitherlink, Star Battle, Car Park) I
  used the page's own solver hook to confirm that finishing is detected, six puzzles each. Puzzle uniqueness for those is covered by the repo's
  own generator tests (`*/puzzle.test.mjs`), which pass.
The Playwright MCP and Chrome DevTools MCP were installed mid-way and worked (a DevTools trace of Battleship on Slow 4G with 4x CPU gave LCP 3.6 s,
CLS 0.07, load delay 0.7 s), but most checks were driven by `tools/playtest.mjs` and per-game scripts for speed.

**Batch 2 follow-ups, done on your answers:** Dots and Boxes now has an invisible larger tap area (12 px each side of every line,
about 37 px in all; the lines look the same; regression check `dots-and-boxes-edge-hit-area`). The how-to of Rock-Paper-Scissors, Memory
and Minesweeper now says a determined friend could read the secret from the link (Battleship already said so). Battleship art was NOT
recompressed: lossless recompression of the ship PNGs saves 0.4 % (106 KB total, already packed), so there is nothing to gain; the
remaining page weight is code and the 46 KB cannon image, and shrinking that one is a lossy change you did not approve.

**Method.** `tools/playtest.mjs <game>` runs the mechanical sweep for a page: cold load on Slow 4G (1.6 Mbps, 150 ms RTT,
4x slower CPU, Chrome), console errors / warnings / 404s, three profiles (desktop Chrome 1366x768, iPhone 15 on WebKit,
Android 360 px Chrome), overflow, tap targets under 44 px, dark / light, landscape, reduced motion, OG tags, and link abuse
(truncated, garbage, tampered fields, replayed, same link in two tabs, spam taps). Rules and end states are played by hand-written
Playwright scripts per game (kept outside the repo in the scratchpad; the durable parts became regression checks).
Not testable here: the live online rooms (they need the Cloudflare Worker; `wrangler dev` cannot run Durable Objects on this
machine), so online modes are covered only by the existing `worker/room-glue.test.mjs` suite. The WebKit run covers layout and load
only; the scripted games ran in Chrome with a touch/mobile profile. Throttling and traces
came from Playwright's own Chrome DevTools Protocol session. The local server does not gzip, so sizes
are shown raw / gzip (Cloudflare serves gzip). Load times are noisy (+/- 40 %) when two browsers run at once.

## Summary

| Game | Verdict | Load (Slow 4G, 4x CPU) | Issues found | Fixed |
|---|---|---|---|---|
| Tic-Tac-Toe | APPROVED WITH NOTES | 2.8 s, FCP 1.3 s; 306 KB raw / 99 KB gz; 18 files | 2 | 2 |
| Chess | APPROVED WITH NOTES | 2.4 s, FCP 2.0 s; 317 KB / 104 KB gz; 16 files | 1 | 1 |
| Connect Four | APPROVED WITH NOTES | 2.4 s, FCP 1.3 s; 318 KB / 103 KB gz; 18 files | 3 | 3 |
| Checkers | APPROVED WITH NOTES | 2.2 s, FCP 1.8 s (3.3 s in a loaded run); 280 KB / 90 KB gz; 15 files | 1 | 1 |
| Minesweeper | APPROVED WITH NOTES | 2.2 s, FCP 1.9 s; 272 KB / 88 KB gz; 15 files | 2 | 2 |
| Battleship | APPROVED WITH NOTES | 2.8 s, FCP 1.9 s; 404 KB / 190 KB gz; 21 files (heaviest) | 1 | 1 |
| Rock-Paper-Scissors | APPROVED WITH NOTES | 3.5 s, FCP 2.4 s (loaded run); 313 KB / 101 KB gz; 18 files | 2 | 2 |
| Reversi | APPROVED WITH NOTES | 2.9 s, FCP 2.4 s (loaded run); 307 KB / 100 KB gz; 18 files | 1 | 1 |
| Memory | APPROVED WITH NOTES | 3.1 s, FCP 2.6 s (loaded run); 264 KB / 86 KB gz; 15 files | 1 | 1 |
| Dots and Boxes | APPROVED WITH NOTES | 2.9 s, FCP 2.4 s (loaded run); 310 KB / 100 KB gz; 17 files | 1 | 1 |
| Pentago | APPROVED WITH NOTES | 2.1 s, FCP 1.8 s; 263 KB / 86 KB gz; 15 files | 1 | 1 |
| Gomoku | APPROVED WITH NOTES | 2.6 s, FCP 1.4 s; 311 KB / 100 KB gz; 18 files | 1 | 1 |
| Lights Out | APPROVED WITH NOTES | 2.5 s, FCP 1.5 s; 307 KB / 100 KB gz; 18 files | 1 | 1 (design finding open) |
| Mancala | APPROVED WITH NOTES | 2.5 s, FCP 2.0 s; 265 KB / 87 KB gz; 15 files | 1 | 1 |
| Mastermind | APPROVED WITH NOTES | 2.7 s, FCP 2.2 s; 268 KB / 86 KB gz; 15 files | 1 | 1 |
| Pig | APPROVED WITH NOTES | 2.3 s, FCP 1.2 s; 318 KB / 103 KB gz; 19 files | 1 | 1 |
| Ultimate Tic-Tac-Toe | APPROVED WITH NOTES | 2.3 s, FCP 1.2 s; 312 KB / 101 KB gz; 18 files | 1 | 1 |
| Hex | APPROVED WITH NOTES | 2.4 s, FCP 1.2 s; 309 KB / 100 KB gz; 18 files | 1 | 1 |
| Blokus Duo | APPROVED WITH NOTES | 2.5 s, FCP 1.3 s; 329 KB / 106 KB gz; 19 files | 1 | 1 |
| Crazy 8 | APPROVED WITH NOTES | 2.6 s, FCP 1.6 s; 362 KB / 117 KB gz; 21 files | 0 | n/a |
| Quoridor | APPROVED WITH NOTES | 2.4 s, FCP 1.2 s; 322 KB / 104 KB gz; 19 files | 1 | 1 |
| Backgammon | APPROVED WITH NOTES | 2.5 s, FCP 1.6 s; 335 KB / 108 KB gz; 19 files | 1 | 1 |
| Nine Men's Morris | APPROVED WITH NOTES | 2.4 s, FCP 1.5 s; 328 KB / 106 KB gz; 19 files | 1 | 1 |
| Breakthrough | APPROVED WITH NOTES | 2.5 s, FCP 1.4 s; 317 KB / 103 KB gz; 19 files | 1 | 1 |
| Connect 6 | APPROVED WITH NOTES | 2.5 s, FCP 1.3 s; 329 KB / 107 KB gz; 19 files | 1 | 1 |
| Tablut | APPROVED WITH NOTES | 2.5 s, FCP 1.4 s; 325 KB / 105 KB gz; 19 files | 1 | 1 |
| Fanorona | APPROVED WITH NOTES | 2.4 s, FCP 1.4 s; 333 KB / 108 KB gz; 18 files | 1 | 1 |
| Onitama | APPROVED WITH NOTES | 2.4 s, FCP 1.1 s; 323 KB / 105 KB gz; 19 files | 1 | 1 |
| Liar's Dice | APPROVED WITH NOTES | 2.4 s, FCP 1.3 s; 316 KB / 101 KB gz; 18 files | 0 | n/a |
| Dominoes | APPROVED WITH NOTES | 2.4 s, FCP 1.4 s; 319 KB / 102 KB gz; 18 files | 0 | n/a |
| Ludo | APPROVED WITH NOTES | 2.5 s, FCP 1.2 s; 329 KB / 105 KB gz; 18 files | 0 | n/a |
| Hearts | APPROVED WITH NOTES | 2.5 s, FCP 1.5 s; 335 KB / 106 KB gz; 18 files | 0 | n/a |
| Farkle | APPROVED WITH NOTES | 2.5 s, FCP 1.5 s; 317 KB / 101 KB gz; 18 files | 0 | n/a |
| Lost Cities | APPROVED WITH NOTES | 2.5 s, FCP 1.3 s; 330 KB / 104 KB gz; 18 files | 0 | n/a |
| Cribbage | APPROVED WITH NOTES | 2.4 s, FCP 1.3 s; 344 KB / 108 KB gz; 18 files | 0 | n/a |
| Skull | APPROVED WITH NOTES | 2.4 s, FCP 1.4 s; 330 KB / 105 KB gz; 18 files | 0 | n/a |
| Hashiwokakero | APPROVED WITH NOTES | 2.1 s, FCP 1.3 s; 252 KB / 81 KB gz; 13 files | 0 | n/a |
| Flow Free | APPROVED WITH NOTES | 2.5 s, FCP 1.4 s; 259 KB / 83 KB gz; 13 files | 0 | n/a |
| Word Search | APPROVED WITH NOTES | 2.3 s, FCP 1.4 s; 258 KB / 83 KB gz; 14 files | 0 (style change done) | n/a |
| Slitherlink | APPROVED WITH NOTES | 2.1 s, FCP 1.4 s; 267 KB / 85 KB gz; 13 files | 0 | n/a |
| Star Battle | APPROVED WITH NOTES | 2.2 s, FCP 1.3 s; 261 KB / 84 KB gz; 13 files | 0 | n/a |
| 2048 | APPROVED WITH NOTES | 2.0 s, FCP 1.3 s; 234 KB / 76 KB gz; 12 files | 0 | n/a |
| Yatzy | APPROVED WITH NOTES | 2.0 s, FCP 1.3 s; 242 KB / 78 KB gz; 13 files | 0 | n/a |
| Mini Sudoku | APPROVED WITH NOTES | 2.1 s, FCP 1.9 s; 239 KB / 76 KB gz; 12 files | 1 | 1 |
| Queens | APPROVED WITH NOTES | 2.0 s (was 5.1 s), FCP 1.3 s; 238 KB / 76 KB gz; 12 files | 2 | 2 |
| Tango | APPROVED WITH NOTES | 2.1 s, FCP 1.6 s; 238 KB / 76 KB gz; 12 files | 1 | 1 |
| Zip | APPROVED WITH NOTES | 2.0 s, FCP 1.4 s; 244 KB / 79 KB gz; 12 files | 0 | n/a |
| Patches | APPROVED WITH NOTES | 1.9 s, FCP 1.3 s; 236 KB / 75 KB gz; 12 files | 0 | n/a |
| Sudoku | APPROVED WITH NOTES | 2.0 s, FCP 1.4 s; 240 KB / 77 KB gz; 12 files | 1 | 1 |
| Nonogram | APPROVED WITH NOTES | 2.0 s, FCP 1.4 s; 235 KB / 76 KB gz; 12 files | 0 | n/a |
| Word Guess | APPROVED WITH NOTES | 2.2 s, FCP 1.3 s; 326 KB / 115 KB gz; 12 files | 1 | 1 |
| Word Ladder | APPROVED WITH NOTES | 2.2 s, FCP 1.3 s; 238 KB / 78 KB gz; 13 files | 0 | n/a |
| Letter Boxed | APPROVED WITH NOTES | 2.0 s, FCP 1.3 s; 243 KB / 79 KB gz; 13 files | 0 | n/a |
| Cross Sums | APPROVED WITH NOTES | 3.0 s, FCP 1.4 s; 248 KB / 80 KB gz; 13 files | 0 | n/a |
| Sliding Puzzle | APPROVED WITH NOTES | 2.0 s, FCP 1.4 s; 230 KB / 75 KB gz; 13 files | 0 | n/a |
| Water Sort | APPROVED WITH NOTES | 2.0 s, FCP 1.4 s; 266 KB / 98 KB gz; 14 files | 0 | n/a |
| Car Park | APPROVED WITH NOTES | 2.1 s, FCP 1.3 s; 268 KB / 84 KB gz; 13 files | 0 (drag change done) | n/a |

No game got a plain APPROVED: each has at least one note I could not close inside the rules for this pass (rule, design or difficulty
changes go to Recommendations), or a part I could not test here (online rooms, a mode I did not play). **No game is NOT APPROVED:** every
blocking bug I found was fixed and re-checked. Load times are one run each with two browsers sharing the machine, so treat differences under
about half a second as noise.

## Cross-cutting findings (apply to every link game)

0. **Friendly games, not fair-play games.** Battleship (both fleets), Rock-Paper-Scissors (Player 1's hidden pick), Memory
   (the shuffle seed) and Minesweeper (the mine seed) carry their secret inside the link. The screen never shows it, but decoding the link
   (a few steps in developer tools) reveals it. A fix needs a server that holds the secret, or a commit-and-reveal scheme (send a
   fingerprint of the pick first, reveal it on the next move). Not done in a test pass. **Your decision: accept these four as friendly games
   before promoting them, or schedule the fix.** Memory also lets you peek: flip one card, refresh, repeat; nothing is committed
   until the turn ends.

1. **Links were only format-checked.** A link carries the whole game; only a per-game `validateBoard` looked at it. Fairness (whose turn,
   piece counts, a result that matches the board) was mostly unchecked, so a hand-edited link could give a double move, extra pieces or a
   made-up win. Decision for this pass (taken after the side note): block the cheap obvious cheats in every link game as it is
   reached, accept that a determined cheater cannot be stopped without a server. Done for: tic-tac-toe, chess, connect-four,
   checkers, minesweeper. **Still open for every other link game** (about 30), each a 20 to 40 minute change.
2. **Same link in two tabs of one browser** let both tabs move (shared `commit()`). Fixed once in `shared/async-share.js`, covers all
   link games. Opening an old link on either phone already showed "old link, open latest move" correctly.
3. The game and version fields, ids, statuses, winners, truncation, garbage, 5000-char and binary params, HTML in fields, and 10 000-cell
   boards were all rejected or ignored in every game tried (no crash, no script ran, 23 of 27 tampered variants rejected; the rest
   decode to a genuine position or are ignored extra keys).
4. `moveCount` has no upper bound (1e9 is accepted). Harmless (it only prints), listed for completeness.
5. The local server answers `api/live/status` with 404 (no Worker); not a real issue on the site.
6. A 0.35 s background colour fade still runs under `prefers-reduced-motion` on every fun page (colour only, no movement).
7. Every page loads 15 to 18 files (about 90 to 104 KB gzip). Slow 4G cold load is 2.2 to 2.8 s with 4x CPU; the 15 to 18 requests
   (many small scripts) cost more than the bytes. Hangman is the same size class. Bundling would help; see Recommendations.

## Games

### Tic-Tac-Toe: APPROVED WITH NOTES
- **Play.** Two phones relayed by link: X wins, O wins, draw all end correctly (sender and receiver messages right, result link ~104 chars).
  Computer mode: 8 games, 0 human wins (unbeatable by design), draws and losses end with the game-over card; tapping three cells per
  turn never placed extra marks; the computer replies in 0.83 to 0.93 s. Admit defeat works; "Opponent on this device" lets one device
  play both sides.
- **Abuse.** **Found:** a shape-valid link with the wrong side to move, three X and no O, more O than X, or a result the board does not
  show was accepted and played. **Fixed** in `validateTtt` (marks alternate, right side to move, result matches the board).
  **Found:** same link open in two tabs let both tabs move. **Fixed** (shared `commit()`). Truncated, garbage, huge and tampered links
  all rejected. Refresh after a move stays locked ("send it").
- **Appearance.** No overflow at any size, dark / light fine, landscape fine, no tap target under 44 px on the phones.
- **Notes.** Reduced-motion colour fade (finding 6). Desktop "Options" button is 36 px tall (mouse only). The link preview image is the
  same static one as the hub; the Worker rewrites title / description per link (`worker/og-text.test.mjs`, 37 games, passes; not
  testable end to end here).
- **Regression checks:** `forged-links-rejected`, `same-link-in-two-tabs`.

### Chess: APPROVED WITH NOTES
- **Play.** Over links between two phones: fool's mate (Black wins), scholar's mate (White wins), the 10-move stalemate (draw), and a
  game with en passant, white and black castling and a promotion (the new queen was on the board). Illegal moves (pawn three squares,
  knight and rook off-pattern, king into check, wrong side) are refused. Rules engine checked directly: castling blocked by an attacked
  f1 / d1, out of check, after the rook moved, through pieces; en passant legal and illegal when the capture would expose the king; 50-move
  rule; K v K and K+B v K insufficient material; checkmate. Computer mode: a random player was mated in 25 plies, every computer move legal,
  it replied in 1.7 to 1.9 s at 4x CPU, longest main-thread block 117 ms.
- **Abuse.** **Found:** the validator only checked "one king each" and the formats, so any board was playable: nine pawns, a pawn on the
  back rank, castling rights with no rook, an impossible en passant square, the side that just moved in check, a made-up checkmate, a double
  move. **Fixed** (`reachable()` in `chess/game.js`). The four genuine games above all pass the stricter check. Old links, own links and
  playing a piece of the wrong colour behaved correctly. Link length 195 to 198 chars (the board is sent whole, not the move list, so it
  stays that size however long the game).
- **Appearance.** Clean at 360 and iPhone 15, dark and light; landscape at 760x360 makes the 440 px board taller than the window (scrolls
  vertically, same as the other games).
- **Notes.** (a) Promotion is always a queen (documented in the page; underpromotion is a rule change, so a Recommendation).
  (b) No threefold repetition in link mode (documented; nothing travels in the link). (c) A forged but reachable-looking position
  (a missing queen, for example) cannot be told apart from a real one; that needs a server.
- **Regression check:** `forged-links-rejected` (chess table: six forgeries).

### Connect Four: APPROVED WITH NOTES
- **Play.** Over links: Red wins (7 moves), Yellow wins (12 moves), full-board draw (42 moves) all end correctly with the right
  messages on both phones. Computer mode: 4 games lost to the bot, no extra discs from spam taps, reply 1.1 s median, no long task over 51 ms.
  Admit defeat and local two-player mode not separately exercised.
- **Found (usability):** tapping a disc or column on the board did nothing; only the small down arrows above the board reacted
  (and they were 40 px tall). **Fixed:** the board's own cells now drop a checker in their column and the arrows are 44 px tall.
- **Abuse.** **Found:** floating discs, Yellow ahead, double move, four in a row on a game still "in progress" and a false win were
  accepted. **Fixed** (`validateC4`: gravity, colour counts, last disc is the newest in its column and the mover's colour, result matches
  the board). Link 115 to 126 chars.
- **Notes.** The drop animation lasts 420 to 770 ms (longer for the bottom row); it does not block input. Reduced-motion finding 6.
- **Regression checks:** `forged-links-rejected`, `connect-four-tap-board`.

### Checkers: APPROVED WITH NOTES
- **Play.** Six random games over links (457 plies), each position checked against an independent rules engine written for this test
  (forced captures, multi-jump chains, crowning ends the turn, men move forward only): every resulting board was one of the legal
  results, no stuck position, all six games ended in a win / loss with the right messages on both phones. Computer mode was not played out.
- **Abuse.** **Found:** the validator checked only that the board is 64 digits; pieces on light squares, 13+ pieces, men sitting on the
  crowning row, a double move, a win claimed while the opponent still had moves were accepted. **Fixed.** Same tamper variants as the other
  games: all rejected. Link 127 chars.
- **Notes.** (a) There is no draw rule: two kings can chase each other forever and the game never ends (rule change, so a
  Recommendation). (b) The first-move tap-through of the sweep needed two taps; replay logic is shared and was verified on the other games.
  (c) Load in the sweep was 3.3 s because two browsers ran at once; 2.2 s alone.
- **Regression check:** `forged-links-rejected` (checkers table).

### Minesweeper: APPROVED WITH NOTES
- **Play (two players over links).** Five games on easy, medium and hard: both players clearing safe tiles until the board is done
  (winner by tile count, 22 to 72 moves), and a player stepping on a mine (the other wins; first tile always safe). Messages right on both
  phones. A drawn tile count was **not** reached (it needs equal counts on an even number of safe tiles; the code path is read, not
  played). Solo: first tap safe even in a corner, flag by right-click and by a 400 ms long-press, a flagged tile cannot be opened,
  win and loss end cards, refresh restores a game in progress.
- **Found:** the two-player score pill read "P1 0 · ..." at 360 px: the second player's score was cut off. **Fixed** (numbers coloured
  by player instead of "P1 / P2" labels, so "130 118" fits at 320 px).
- **Abuse.** **Found:** a mine shown open, a hole in an opened area, tiles owned by the wrong player, a double move, a win with tiles
  still hidden and an inflated move count were accepted. **Fixed** (`consistent()`: mines are rebuilt from the seed, then every claim is
  checked). Genuine links from 5 full games (up to 264 chars) were never refused.
- **Notes.** (a) **The mine seed is in the link**, so anyone who reads the page source can compute every mine and always win; a real fix
  needs a server (Recommendation). (b) On the hard board (20x20) the tiles are about 14 px on a 360 px phone, far under the 44 px target;
  medium (16x16) is about 19 px. (c) One tap is a reveal in link mode with no confirm; a mis-tap on a mine ends the game.
- **Regression checks:** `forged-minesweeper`, `minesweeper-score-pill-fits`, `rps-best-of-in-whatsapp`, `dots-and-boxes-edge-hit-area`, `next-level-clears-solved`, `queens-one-answer`, `word-guess-loss-card`, `word-search-capsules`, `car-park-drag`. The `FORGED` table now also covers reversi, dots-and-boxes, memory, rock-paper-scissors and battleship.

### Battleship: APPROVED WITH NOTES
- **Play.** Both phones placed fleets (Random, Lock in), then 33 and 34 shots over links to a win for Player 1 and for Player 2, checked
  against an independent ship-cell model; sender and receiver messages right (links 213 to 218 chars). Computer and same-device modes were
  not played (not reachable by link).
- **Abuse.** The validator was already strong (fleet shape, unique shots, turn parity, last shot, sunk state). **Found:** the move count was
  not tied to the fleets and shots in the link. **Fixed** (one line). 24 of 27 tampered variants rejected, the rest harmless; replay and
  old-link handling correct; no crash.
- **Notes.** Secret fleets are in the link (finding 0). Heaviest page: 21 files, 404 KB raw / 190 KB gzip (ship art). On a 360 px phone
  the 10x10 grid cells are 21 px and the ship tray buttons 37 px high (aim, then press Fire, softens the cell size). The ball animation
  takes 560 ms before the shot is committed (it blocks a second shot by design). Slow 4G LCP 3.6 s with a 0.7 s load delay.
- **Regression check:** `forged-links-rejected` (battleship table).

### Rock-Paper-Scissors: APPROVED WITH NOTES
- **Play.** Best of 3, 5 and 7 over links with ties and wins for each player, every board string checked against my own scorekeeping.
- **Found:** in WhatsApp mode the Best-of choice was ignored (always best of 3, and the header lagged one change behind). **Fixed**
  (`link.newGame()` on change).
- **Abuse.** **Found:** a double pick, a match "won" with a pick waiting, a win with too few round wins, and a move count that does not fit an
  open round were accepted. **Fixed** (turn, parity, wins and status checks). 23 of 27 variants rejected.
- **Notes.** Player 1's hidden pick is in the link (finding 0).
- **Regression checks:** `rps-best-of-in-whatsapp`, `forged-links-rejected` (rock-paper-scissors table).

### Reversi: APPROVED WITH NOTES
- **Play.** Four full 60-move games over links against an independent Othello engine (board compared after every move): White win,
  Black win, a 32-32 draw, and games with a forced pass (control returns to the same player). All matched, messages right.
- **Abuse.** **Found:** the validator only checked the format. **Fixed:** centre squares occupied, one disc per move, turn and pass and
  game-over follow from who can move, result matches the count. Genuine games of every kind pass it.
- **Notes.** Same-device mode only, no computer opponent (as designed). Link 111 to 125 chars.
- **Regression check:** `forged-links-rejected` (reversi table).

### Memory: APPROVED WITH NOTES
- **Play.** Over links: 4x4 draw 4-4, 4x4 wins for each player, a 6x6 and an 8x8 match; a match keeps the turn, a miss passes it, the last
  match ends the game. Solo mode was not played this batch.
- **Abuse.** **Found:** a pair owned by the wrong player, Player 2 owning a pair before moving, and a finished board still "in progress"
  were accepted. **Fixed** (the validator ties last pairs, turn, status and ownership together).
- **Notes.** The shuffle seed is in the link and a flip is not committed until the turn ends (finding 0).
- **Regression check:** `forged-links-rejected` (memory table).

### Dots and Boxes: APPROVED WITH NOTES
- **Play.** Eight full games on 3x3 to 6x6 (24 to 84 edges) over links against an independent engine: wins for both players, draws on 4x4
  and 6x6, and box chains (a completed box grants another turn). Every board string matched.
- **Abuse.** **Found:** an edge count that did not match the move count, boxes owned without four edges, a wrong next player, and a false
  result were accepted. **Fixed.** Genuine games of every size pass.
- **Notes.** **The lines are about 13 px thick** (68 to 78 x 13 px on a phone), far under the 44 px target; edges are hard to hit on 5x5 and
  6x6. A larger invisible hit area (CSS only) would fix it; left alone because it changes how the board feels. Same-device mode not played.
- **Regression check:** `forged-links-rejected` (dots-and-boxes table).

## Design finding for you (Lights Out, not changed)

In two-player Lights Out the winner is decided by the scramble, not by play. Every way of clearing the board uses the same number of
presses (the two hidden "do nothing" patterns have even weight), so the player who presses last is fixed by the difficulty: Easy (3
scramble presses, odd) is always won by Player 1, Medium (6) and Hard (10) by Player 2, unless the players stall to the 60-press draw.
A fair fix is to scramble with a random odd or even number of presses (a rule change, so your call).

### Pentago: APPROVED WITH NOTES
- **Play.** Player 1 win (21 moves), Player 2 win (27) and a draw (31) over links against an independent engine (marble plus quadrant turn); every board matched.
- **Found (real bug):** about one move in four produced a link the opponent saw as "Invalid link": when the quadrant turn moved the placed marble away, the square it was placed on could be empty, and the validator demanded it be filled. **Fixed**, plus marble count, turn and result checks. The regression check includes the genuine-link-refused case and fails on the old code.
- **Abuse / layout.** 23 of 27 variants rejected; no overflow; no tap target under 44 px; link 103 chars.
- **Notes.** Same-device mode not played.

### Gomoku: APPROVED WITH NOTES
- **Play.** White win (20 moves) and Black win (67) over links against an independent engine. On touch screens the first tap aims and the second places (double-tap protection).
- **Abuse.** Validator now checks alternating colours, the last stone, no five-in-a-row hiding in an "in progress" game, and the result. 23 of 27 variants rejected.
- **Notes.** The 15x15 board has 22 to 24 px cells on a phone (the two-tap placement softens that). A full-board draw and the computer mode were not played.

### Lights Out: APPROVED WITH NOTES
- **Play.** Player 2 win and a 60-press draw over links; my own solver confirmed every scramble is solvable and every press matched my model. Player 1 win not played (it needs Easy, a menu setting).
- **Abuse.** Validator now needs a clearable pattern, the right mover and turn, a lit board before the first press, and the true result. 23 of 27 variants rejected.
- **Design finding:** see "Design finding for you" above.

### Mancala: APPROVED WITH NOTES
- **Play.** Player 1 win (46 moves), Player 2 win (51) and a 24-24 draw (36) over links against an independent engine (sowing, captures, extra turns, end sweep); every board matched. Finished positions (win, draw, loss) are accepted.
- **Abuse.** Validator now ties "game over" to the rows being empty and the result to the stores. 22 of 27 variants rejected.
- **Notes.** iPhone pit buttons are 71x43 px (one pixel under 44).

### Mastermind: APPROVED WITH NOTES
- **Play.** A crack on guess 3 (the code has a repeated colour) and ten misses (the codemaker wins) over links; the feedback pegs on the page matched my own scoring on every guess.
- **Abuse.** Validator now ties move count and turn to the guesses made. 23 of 27 variants rejected.
- **Notes.** The secret code is in the link, the same accepted tradeoff as Hangman's word.

### Pig: APPROVED WITH NOTES
- **Play.** Two full games to 100 over links (21 and 19 turns); every score, bank and roll list was checked against my own bookkeeping. Player 2 win not reached in these two games.
- **Abuse.** **Found:** a roll after a 1, banked points that the rolls do not add up to, a win below 100, points for Player 2 on move one were accepted. **Fixed.** 23 of 27 variants rejected.
- **Notes.** In link mode the dice are rolled on the phone, so a made-up roll list cannot be told from a lucky one; only the online mode rolls on the server.

### Ultimate Tic-Tac-Toe: APPROVED WITH NOTES
- **Play.** X win (55 moves), O win (54) and a draw (67) over links against an independent engine (including the forced-board rule); every board matched.
- **Abuse.** Validator now checks alternating marks, each small board's result, the last mark's owner, the forced next board and the overall result. 23 of 27 variants rejected.
- **Notes.** Cells are 28 to 33 px on a phone (nine boards of nine). Same-device and computer modes not played.

### Hex: APPROVED WITH NOTES
- **Play.** Red win (117 moves) and Blue win (96) over links, boards matched an independent chain finder every move.
- **Abuse.** Validator now checks alternating colours, the mover, and that only the mover can hold a winning chain. 23 of 27 variants rejected.
- **Notes.** Hexagons are 20 to 24 px wide on a phone. Computer and same-device modes not played.

### Blokus Duo: APPROVED WITH NOTES
- **Play.** One real move through the tray, the board and "Place piece" produced a link the sweep could replay; 42 genuine positions from four full games generated by the shared rules (including finished games) were all accepted. A full game was not clicked through the UI.
- **Abuse.** **Found:** the validator checked only the format. **Fixed:** squares match pieces used, start squares covered, one piece per move, the last piece is a used piece of the mover, and next player and result follow the shared rules. 23 of 27 variants rejected.

### Crazy 8: APPROVED WITH NOTES
- **Play.** vs computer, one full game to the end (17 plays, 6 draws, the computer won); no errors. The online room needs the Worker and was not tested here. There are no link moves in this game.
- **Notes.** The Draw button is 41 px high on a 360 px phone. Only a loss was reached.

### Onitama: APPROVED WITH NOTES
- 100 genuine positions from 6 random full games (wins by capture and by temple for both sides) all accepted; the first move through the real screen works; the sweep is clean (2.4 s, 19 files, 105 KB gzip, no overflow, no small targets). Forged-link regression entry added.
- **Notes.** Passes (a player with no legal move gives up a card) did not occur in the generated games, so that path was not exercised.

### Quoridor: APPROVED WITH NOTES
- **Play.** 62 genuine positions from 5 random full games (pawn steps and walls, one Red win, four Blue wins) accepted. First move through the screen works.
- **Abuse.** **Found:** only the format and the wall count were checked, so crossing walls, a pawn shut in, a wrong turn or a false win were accepted. **Fixed** (every wall is re-checked with the game's own wall rule, the mover, the last action and the result). 23 of 27 variants rejected.
- **Notes.** Cells are 32 to 35 px on a phone. Same-device and computer modes not played.

### Backgammon: APPROVED WITH NOTES
- **Play.** 70 genuine positions from 3 full games (generated with the shared rules, every legal way to play each roll) accepted; the first turn through the screen works (roll, two moves, Done). Refreshing after a roll keeps the same dice (the page does not allow a re-roll).
- **Abuse.** **Found:** turn and result were not checked. **Fixed.** 23 of 27 variants rejected.
- **Notes.** The dice are rolled on the phone and the link carries only the resulting position, so a position reached with moves the dice would not allow cannot be told from a real one without the previous position (only the online mode, where the server rolls, is exact). Listed as a limit, not fixable without a server.

### Nine Men's Morris: APPROVED WITH NOTES
- **Play.** 253 genuine positions from 5 random full games (placing, moving, flying, mills and removals, wins and unfinished) accepted. First move through the screen works.
- **Abuse.** **Found:** turn and result were not checked. **Fixed** (the side to move must be the one in the board; the winner must be the one the rules give). 22 of 27 variants rejected.

### Breakthrough: APPROVED WITH NOTES
- **Play.** 131 genuine positions from 5 random full games (all ended in wins) accepted. First move through the screen works.
- **Abuse.** **Found:** the side to move in the board could disagree with the envelope, extra pieces and false wins were accepted. **Fixed.** 22 of 27 variants rejected.

### Connect 6: APPROVED WITH NOTES
- **Play.** 64 genuine positions (one stone then two per turn, one finished game) accepted. **Found while testing my own check:** a game that ends after the first stone of a turn leaves the board mid-turn; my first version refused that genuine final link, fixed before it shipped.
- **Abuse.** **Found:** stone counts, the side to move and a false win were not checked. **Fixed.** 23 of 27 variants rejected.
- **Notes.** Points are 22 to 27 px on a phone (15x15 board); a fat finger costs a whole turn of two stones, which the page's how-to already admits.

### Tablut: APPROVED WITH NOTES
- **Play.** 212 genuine positions from 5 random games (king escapes, captures, stuck sides) accepted. First move through the screen works.
- **Abuse.** **Found:** turn, piece counts and result were not checked. **Fixed.** 22 of 27 variants rejected.
- **Notes.** Cells are 39 to 42 px on a 360 px phone (just under 44).

### Fanorona: APPROVED WITH NOTES
- **Play.** 71 genuine positions (including captures that continue as a chain) accepted. First move through the screen works (piece, destination, ahead-or-behind choice).
- **Abuse.** **Found:** the side to move and piece counts were not checked. **Fixed.** 22 of 27 variants rejected; `moveCount` 1e9 is accepted (harmless).
- **Notes.** Points are 38 to 42 px on a phone.

## Computer-only games and puzzles (what was checked and found)

### Computer-only games
Crazy 8, Liar's Dice, Dominoes, Ludo, Hearts, Farkle, Lost Cities, Cribbage, Skull: no console errors, no 404s, no sideways scroll at 320 to 1366 px,
dark and light fine, no stuck screen in 70 to 80 seconds of random play. Crazy 8 and Skull reached the end of games with the right end card
(Crazy 8 lost once, Skull won three times: a random clicker beating the computer three times in a minute suggests it is easy, a difficulty note not a bug).
The other six games are long, so they were not played to the end (Hearts, Cribbage, Ludo, Farkle, Dominoes, Lost Cities); their rules are covered by the unit tests in `worker/`.
Tap targets under 44 px: Dominoes tiles (76x39), Ludo points (20 to 22 px), Lost Cities cards (39 to 43 wide).

### Puzzles and Classics
- **Sudoku, Mini Sudoku:** 6 puzzles each solved with my own solver: every one has exactly one solution; a wrong last digit gives "Not quite", the right one "Solved". **Found:** after "Next level" the old "Solved in ..." text stayed and the card came straight back (same bug in Queens, Tango, and the stale text in Lights Out). **Fixed**; one check over all 18 puzzle pages (`next-level-clears-solved`). Sudoku cells are 40x52 px (narrow).
- **Queens:** **Found (puzzle quality):** the generator almost never made a puzzle with one solution (0 of 60 seeds on 7x7 and 8x8, 2 of 60 on 6x6); a 7x7 board usually had 22 to 172 valid answers, so it could not be reasoned out and the hint could contradict a correct board. It also spent about 3 s of a slow phone's load time on 60 failed attempts (cold load 5.1 s). **Fixed** (a repair step moves single cells between regions until one answer is left): 25 of 25 new 7x7 puzzles have exactly one answer, 40 of 40 on 6x6 and 7x7 and 37 of 40 on 8x8 in a test copy, cold load 2.0 s. Wins are detected for any valid placement. The daily puzzle for a given date is now a different puzzle than before. Regression check `queens-one-answer`.
- **Tango, Zip, Patches, Nonogram:** Nonogram 4 of 4 puzzles unique and solved on entry; Patches 25 of 25 unique; Tango is unique by construction (cells are only removed while one answer remains); Zip's generator accepts any valid path in order and never produced a unique puzzle (0 of 75), which the code comments admit (a note, not a bug: win detection works).
- **Word Guess:** word lists clean (848 answers, 14 855 guesses, no duplicates, all five letters, every answer a valid guess); "Not in the word list" and "Not enough letters" work; my solver won 5 of 5. **Found:** running out of guesses showed only a status line, no game-over card and no taunt. **Fixed** (wording now matches the card; check `word-guess-loss-card`). The reveal blocks typing for 450 ms after each guess.
- **Word Ladder:** 6 of 6 puzzles reachable, par equals my own shortest path, one-letter changes only, non-words refused, solved card shown. 875 words, no duplicates.
- **2048:** 258 moves in 3 games matched a slide-and-merge model exactly (one new 2 or 4 per effective move, nothing happens on a no-op move, scores right), game over detected with the card. The page's default difficulty is "hard", which places new tiles to hurt you 35% of the time; there is no message for reaching the 2048 tile.
- **Yatzy:** 273 offered scores over 3 full games matched my own scoring and the totals (with the 35 bonus) matched; the card shows at the end.
- **Zip, Flow Free, Slitherlink, Star Battle, Car Park:** finishing is detected with the right card for 6 of 6 puzzles each through the page's solver hook (this proves detection on the reference answer, not that no wrong state wins).
- **Hashiwokakero, Letter Boxed, Cross Sums, Sliding Puzzle, Water Sort, Word Search:** sweeps clean; generator tests pass; completion not driven by me. Tap targets: Hashiwokakero islands 42 px, Star Battle cells 41 px, Cross Sums cells 39 to 40 px wide, Word Ladder / Word Guess keys 29 to 34 px wide.

### Changes you asked for
- **Launch image:** your `launch-image.png` (from `origin/claude/live-play`) is now `assets/launch-image.png`, and all 19 launch images in `assets/splash/` are cut from it (scaled to the short side, centred where yours sits, on the exact site cream). The 1170x2532 file matches yours to within 7 colour levels. `tools/gen-icons.py` now builds the launch images from that file (it was still pointing at the pre-move `splash/` folder, so it silently did nothing). Icons, banner and favicon regenerate unchanged.
- **Word Search:** found words and the word being dragged are now rounded capsules laid along the letters (a soft version of the word's colour, letters stay dark; the dragged word is a dark capsule), like your picture, instead of a coloured box on every cell. Check `word-search-capsules`.
- **Car Park:** a car is now dragged itself: it follows the finger along its row or column, stops at other cars and the edge, and settles on the nearest square when let go; one slide is one move. The tap-a-car-then-arrows buttons are gone (tapping a car and then a free square in its row or column still slides it there, and the keyboard still works). Check `car-park-drag`.

## Files changed

- `tools/playtest.mjs` (new): the sweep.
- `shared/async-share.js`: second-tab move guard in `commit()`.
- `tic-tac-toe/game.js`, `chess/game.js`, `connect-four/game.js`, `checkers/game.js`, `minesweeper/game.js`, `battleship/game.js`, `rock-paper-scissors/game.js`, `reversi/game.js`, `memory/game.js`, `dots-and-boxes/game.js`: fairness validators.
- `rock-paper-scissors/game.js`: a Best-of change now applies in WhatsApp mode.
- `pentago/game.js`, `gomoku/game.js`, `mancala/game.js`, `lights-out/game.js`, `mastermind/game.js`, `pig/game.js`, `ultimate-tic-tac-toe/game.js`, `hex/game.js`, `blokus-duo/game.js`, `onitama/game.js`, `quoridor/game.js`, `backgammon/game.js`, `nine-mens-morris/game.js`, `breakthrough/game.js`, `connect6/game.js`, `tablut/game.js`, `fanorona/game.js`: link validators (Pentago also fixes genuine links being refused).
- `tools/playtest.mjs`: `js:` steps for first moves, progress lines.
- `sudoku/game.js`, `mini-sudoku/game.js`, `queens/game.js`, `tango/game.js`, `lights-out/game.js`: status reset on a new puzzle; `queens/game.js` also the one-answer repair; `lights-out/game.js` also the Next-level button in two-player mode.
- `word-guess/game.js`: loss wording.
- `word-search/game.js`, `word-search/index.html`: capsule highlights.
- `car-park/game.js`, `car-park/index.html`: dragging cars, arrows removed, how-to text.
- `assets/launch-image.png` (new), `assets/splash/*.png` (19), `tools/gen-icons.py`: launch images.
- `dots-and-boxes/index.html`: invisible larger tap area on the lines.
- `rock-paper-scissors/index.html`, `memory/index.html`, `minesweeper/index.html`: how-to note that the secret is readable from the link.
- `connect-four/game.js`, `connect-four/index.html`: tap the board, 44 px arrows.
- `minesweeper/game.js`, `minesweeper/index.html`: score pill text and size.
- `tests/regression.mjs`: `FORGED` table + `forged-links-rejected` (tic-tac-toe, chess, connect-four, checkers), `forged-minesweeper`,
  `same-link-in-two-tabs`, `connect-four-tap-board`, `minesweeper-score-pill-fits`.
- `*/index.html`: cache-bust stamps (`node tests/cache-bust.mjs`).

## Recommendations (ranked)

000. **Merge before committing.** Your branch and `origin/claude/live-play` have diverged (3 local commits, 2 on the remote: the 2048 timing change and the launch image). I did not merge, rebase or commit anything. The launch image was copied straight out of the remote commit.

00. **Lights Out two-player fairness** (see Batch 3): choose a random odd or even scramble so either player can win on any difficulty. 15 min plus your decision.
0a. **Zip puzzles are never unique** (0 of 75). Win detection accepts any valid path, so it plays fine; making them unique (more attempts or a repair step like Queens') would make Zip a logic puzzle. 2 h.
0b. **Small tap targets** on Dominoes, Ludo, Lost Cities, Hashiwokakero, Star Battle, Cross Sums, Sudoku, Word Guess / Word Ladder keys and the big boards (Gomoku, Connect 6, Hex, Ultimate Tic-Tac-Toe, Minesweeper hard). Mostly inherent to the board size; a zoom or a wider key row would help. 1 to 2 days across the lot.
0c. **Skull may be too easy** (a random clicker won 3 games in 60 seconds). Difficulty is your call.
0. **Decide on the four secret-in-the-link games** (answered: accept as friendly; how-to notes added) (finding 0): accept them as friendly, or add commit-and-reveal or a server (1 to 2 days each).
   Also: Dots and Boxes edge hit area (30 min), Battleship page weight (190 KB gzip, about 1 h to compress the ship art).

1. **Finish the fairness validators for the remaining ~30 link games** before deploy, using the same pattern and the `FORGED` table
   (20 to 40 min each, about 12 h in all). Some (dice and card games) cannot be fully checked because the dice or deal is chosen by the client.
2. **Minesweeper: stop shipping the seed.** Either hash the mine layout with a secret kept by the first player's device (not possible
   without a server) or accept it. Server-held layout: 1 to 2 days.
3. **Bundle the shared scripts** (gamekit, async-share, fun, manpage, taunts, account, live-share, lz-string) into one file per page: 15 to
   18 requests become about 4, which is the biggest Slow 4G win. 0.5 day; needs a build step the repo does not have.
4. Minesweeper on hard at 360 px: add pinch-zoom or a zoom-on-tap board (tiles are about 14 px). 0.5 day.
5. Checkers: add a draw rule (for example 40 moves with no capture or crowning) so a game can end. Rule change, needs your decision. 1 h.
6. Chess: allow underpromotion (rule / UI change). 2 h.
7. Reduced motion: also drop the 0.35 s colour fade in `shared/fun.css`. 15 min.
8. Optional integrity: a short checksum in the link rejects casual edits (still defeatable by reading the JS). 2 h in shared code.
9. Raise or remove the missing upper bound on `moveCount` in shared validation. 10 min.
