# WA mini-games

Two-player mini-games you play **with a friend over WhatsApp**, one link per turn. There are no accounts and no server. Make your move, tap **Send on WhatsApp**, and your friend opens the link, moves, and sends a new link back.

**▶ Play: [wa-minigames.online](https://wa-minigames.online/)**

Forked from [wavde/games](https://github.com/wavde/games) (MIT): vanilla HTML/CSS/JS with no build step. The six original solo/logic-puzzle games are unchanged.

> Working on this repo with an AI agent? Read [`AGENTS.md`](AGENTS.md) and
> [`docs/agent-memory/CURRENT.md`](docs/agent-memory/CURRENT.md) first.

## WhatsApp games

| Game | Modes |
|---|---|
| [tic-tac-toe](tic-tac-toe/) | **2 players · WhatsApp** (default), vs computer |
| [connect-four](connect-four/) | **2 players · WhatsApp** (default), vs computer at 3 depths, local 2 players |
| [minesweeper](minesweeper/) | **2 players · WhatsApp** (default), solo |
| [chess](chess/) | **2 players · WhatsApp** (default), vs computer at 3 depths |
| [memory](memory/) | **2 players · WhatsApp** (default), solo (race the clock) |
| [lights-out](lights-out/) | **2 players · WhatsApp** (default), solo |
| [reversi](reversi/) | **2 players · WhatsApp** (default), local 2 players |
| [checkers](checkers/) | **2 players · WhatsApp** (default), local 2 players |
| [dots-and-boxes](dots-and-boxes/) | **2 players · WhatsApp** (default), local 2 players |
| [mancala](mancala/) | **2 players · WhatsApp** (default), local 2 players |
| [pentago](pentago/) | **2 players · WhatsApp** (default), local 2 players |
| [rock-paper-scissors](rock-paper-scissors/) | **2 players · WhatsApp** (default), local 2 players |
| [hangman](hangman/) | **2 players · WhatsApp** (default), local 2 players |
| [battleship](battleship/) | **2 players · WhatsApp** (default), vs computer, local 2 players |
| [mastermind](mastermind/) | **2 players · WhatsApp** (default), vs computer, local 2 players |
| [gomoku](gomoku/) | **2 players · WhatsApp** (default), **online**, vs computer at 3 levels, same device |
| [pig](pig/) | **2 players · WhatsApp** (default), **online** (the server rolls), vs computer at 3 levels, same device |
| [ultimate-tic-tac-toe](ultimate-tic-tac-toe/) | **2 players · WhatsApp** (default), **online**, vs computer at 3 levels, same device |
| [hex](hex/) | **2 players · WhatsApp** (default), **online**, vs computer at 3 levels, same device |
| [blokus-duo](blokus-duo/) | **2 players · WhatsApp** (default), **online**, vs computer at 3 levels, same device |

**[crazy-8](crazy-8/)**: cards for 1 to 4 (online rooms with a server-held deck, or against 1 to 3 computers); see below.

**Solo puzzles added:** [sudoku](sudoku/) (9×9), [nonogram](nonogram/) (5×5, 8×8, 10×10, every puzzle solvable by line logic), [word-guess](word-guess/) (five-letter words, daily or random, shareable result) and [word-ladder](word-ladder/) (change one letter at a time).

Opening a shared link always switches the page to WhatsApp mode. The newer games built from scratch for this project (not adapted from wavde/games) are listed below with their own notes; some skip a computer mode — a same-device "local" pass-and-play mode stands in for it instead, since building a bespoke engine for each wasn't proportionate to the ask.

## Live online play (Tic-Tac-Toe, Connect Four, Reversi, Dots and Boxes, Lights Out, Rock Paper Scissors, Gomoku, Ultimate Tic-Tac-Toe, Hex, Blokus Duo, Onitama, Quoridor, Backgammon, Pig, Nine Men's Morris, Breakthrough)

An optional mode next to WhatsApp: one player creates a room, the other opens the invite link, and moves appear instantly. Link-passing is unchanged and stays the default.

- **Server:** one Durable Object per room (`worker/live-room.mjs`) holds the authoritative state and relays moves over a hibernating WebSocket. All room logic is pure and unit-tested in `worker/live-protocol.mjs`; each game's server-side move rules live in `worker/rules/<game>.mjs` and are registered in `worker/live-games.mjs`. A game without a rules module can't be played live.
- **Client:** `shared/live-share.js` mirrors `AsyncShare`'s controller (`show / hide / commit / newGame / canMove`), so a game adds live mode by pointing its existing link code at it. It waits for the server's echo instead of applying moves optimistically, and on every reconnect the server replays the whole state.
- **API** (same origin only): `GET /api/live/status`, `GET /api/live/exists?room=`, `POST /api/live/create {game}`, `GET /api/live/ws?room=` (WebSocket).
- **Limits:** 2 seats, 2 KB messages, a per-socket rate limit, 20 new rooms per minute per IP, rooms deleted after 24 h idle / 1 h after finishing.
- **Kill switch:** set `LIVE_ENABLED = "0"` in `wrangler.toml` and deploy: the API answers 503, open rooms close, and games hide the option.
- **Hidden-information games** (Hangman, Battleship, Mastermind, Rock Paper Scissors) are intentionally not live-enabled: their secrets would be visible in the socket traffic.

Tests: `node worker/rules/tic-tac-toe.test.mjs`, `node worker/rules/wave1.test.mjs` (thousands of random legal games for the other four, pushed through the real room protocol), `node worker/live-protocol.test.mjs`, and, against a running `wrangler dev`, `node worker/live.integration.mjs`.

To add a game: write `worker/rules/<game>.mjs` exporting `validateTransition(prev, next, mover)` (return `{ ok, nextTurn? }`), register it in `worker/live-games.mjs`, then in the game's `game.js` create a `LiveShare` next to its `AsyncShare` with the same `validateBoard`/`onState` and route `commit` through whichever is active (see `reversi/game.js`).

## How play-by-link works

1. Open a game page with no `?s=` in the URL. You get a fresh board; make the first move.
2. The page encodes the whole game into the URL and shows **Send on WhatsApp** and **Copy link**. On touch devices the button hands the link to the phone's native share sheet (same as sharing a Spotify link) instead of opening WhatsApp directly, so you pick the contact there; elsewhere (desktop) it falls back to `https://wa.me/?text=…` with no phone number, which shows the raw link a second time below the preview card — a quirk of that single-text-field approach.
3. Your friend taps the link and sees the board with your last move outlined. They move, and send a new link back.
4. When the game ends, the player who made the final move sends the result link so the other player sees how it ended.
5. On your turn, **Admit defeat (coward)** forfeits on the spot — board unchanged, opponent wins immediately — and swaps the result screen to **Share your shame**, a differently-worded send button for broadcasting the loss.

The URL is the save file. There is no game server, lobby, or lookup.

### Link format

`?s=` holds a compressed envelope, with `+` swapped for `_`. That keeps links to `A–Z a–z 0–9 _ -`; a raw `+` in a query string turns into a space. lz-string is vendored in [assets/vendor/](assets/vendor/), so the game makes no CDN requests.

Every game works with the same **logical** envelope — this is the shape `AsyncShare.encode()` takes and `AsyncShare.decode()` returns, and what every game's `board`/`validateBoard`/`commit()` code sees:

```json
{ "game": "tic-tac-toe", "version": 1, "id": "k3j9x0", "turn": "O",
  "board": ["X", null, null, null, null, null, null, null, null],
  "status": "in_progress", "winner": null, "moveCount": 1, "last": 0 }
```

| Field | Meaning |
|---|---|
| `game` | Must match the page, or the link is rejected. |
| `version` | Schema version. Bump it when a board format changes; older links then show "invalid or from an older version". |
| `id` | Random per game. Only used on each device to recognise old links (see below). |
| `turn` | Who moves next. After the game ends, the player who did *not* make the last move. Normally the opponent, but `commit()` accepts an optional `nextTurn` to override that when a rule grants the same player another turn — Reversi's pass, an extra turn in Dots and Boxes/Mancala, or Hangman's guesser always going again. |
| `status` | `in_progress`, `won`, or `draw`. |
| `winner` | `null` unless `status` is `won`. |
| `moveCount` | Moves made so far. |
| `last` | Game-specific index (or indices) of the last move, used for highlighting. |
| `resigned` | `true` when `status: "won"` was reached by the loser hitting "Admit defeat (coward)" instead of playing it out. Absent (not `false`) on every ordinary move, so it costs nothing in the link until it's actually used. |

On the wire, `encode()`/`decode()` in [shared/async-share.js](shared/async-share.js) shrink that to single-letter keys and single-letter status codes (`g/v/i/t/b/s/w/n/l/r`, `status` → `p`/`w`/`d`) before `lz-string` compresses it — purely a transport detail, invisible to every game and to `AsyncShare.encode()`/`decode()` callers, which always use the full field names above.

Every game's `board` is also a compact string rather than a JSON array/object with punctuation — one character per cell (or per pair, for Memory) instead of `["X",null,...]`-style array syntax. That plus the key/status shrinking above keeps a tic-tac-toe link to around 140 characters and Connect Four to around 150 — well under half the size of the original array-of-cells, full-field-name encoding this project shipped with initially. Further shrinking is possible (e.g. dropping envelope fields the board itself already implies, like `moveCount`), but only helps the simplest games and would mean each game's link no longer follows one shared, easy-to-extend format — not worth it while links are already this far under any real WhatsApp limit.

Board formats:

- **tic-tac-toe**: 9 characters, row by row (`row * 3 + col`); `.` empty, else `X` or `O`. Players are `"X"` (opens) and `"O"`.
- **connect-four**: 42 characters, `row * 7 + col` with row 0 at the **top**. `0` empty, `1` Red (opens), `2` Yellow.
- **minesweeper**: `{ d, seed, first, own }`.
  - `d`: board size (`easy` 9×9 with 10 mines, `medium` 16×16 with 40, `hard` 20×20 with 80).
  - `seed`: uint32 for the mine generator.
  - `first`: index of the opening reveal; its 3×3 area is kept mine-free.
  - `own`: one character per cell, `0` hidden, `1`/`2` revealed by that player.

  Mine positions are rebuilt from `seed` + `first`, so they never appear in the link in readable form.
- **chess**: `{ b, castle, ep, half }`.
  - `b`: 64 characters, row-major from White's back rank down. `.` empty, else a piece letter (`p n b r q k`) — uppercase White, lowercase Black.
  - `castle`: subset of `"KQkq"`, or `"-"`.
  - `ep`: en-passant target square (0–63), or `null`.
  - `half`: half-move clock, for the 50-move rule.

  `last` is `[fromSquare, toSquare]`. There's no undo and no threefold-repetition draw in this mode, since no move history travels in the link — everything else (castling, en passant, auto-queen promotion, checkmate/stalemate/insufficient-material/50-move draws) works as in solo mode.
- **memory**: `{ size, seed, own }`. The shuffled card layout is never sent — only `size` and a `seed`, from which both players derive the identical deck (the same way the daily logic puzzles regenerate from a seed). `own` is one character per **pair**, not per cell: `0` unmatched, `1`/`2` the player who matched it. `last` is the list of pair indices matched during the turn that produced the link (a match keeps your turn, so a "turn" can cover more than one pair).
- **lights-out**: `{ bits }` — the current 5×5 light pattern packed into one integer (bit *i* = light *i*, row-major). `last` is the index of the cell pressed. Whoever's press turns the last light off wins; if neither player manages it within 60 combined presses, it's called a draw.
- **reversi**: 64 characters, `0` empty, `1` Black (opens), `2` White. `last` is the placed disc's index. A move that leaves the opponent with no legal move passes back to the same player (`nextTurn`); no legal move for either side ends the game.
- **checkers**: 64 characters, `0` empty, `1`/`2` a man, `3`/`4` a king. A full mandatory jump chain resolves locally before any link is produced — one commit per turn, however many jumps it took (same pattern as Memory's multi-flip turn). No legal move on your turn loses immediately.
- **dots-and-boxes**: 56 characters — 40 for edge state (`0`/`1`, drawn or not) then 16 for box ownership (`0` unclaimed, `1`/`2`). Ownership can't be derived from the final edge state alone (it depends on who drew the completing line), so it rides along explicitly. Completing a box (or two at once) grants another turn (`nextTurn`).
- **mancala**: 28 characters, 14 pits (0–5 Player 1, 6 Player 1's store, 7–12 Player 2, 13 Player 2's store) each zero-padded to 2 digits — a pit can hold more than 9 seeds, unlike every other game's board here. Landing your last seed in your own store grants another turn (`nextTurn`); an empty row ends the game after the other player sweeps their remaining seeds into their store.
- **pentago**: 36 characters, one char per cell (`0`/`1`/`2`). A turn is place-then-rotate-a-quadrant, resolved locally before one commit — nothing is sent until the rotation is chosen. 5 in a row after the rotation wins; both players getting 5 at once is a draw.
- **rock-paper-scissors**: a 6-digit string (best-of, both scores, Player 1's pending hidden pick, and the last completed round's two picks). Player 1's pick genuinely rides along in the link — same tradeoff as Minesweeper's mines — the UI just never renders it until Player 2 has also picked. A tie replays the round.
- **hangman**: word length + the word + the guessed-letters bitmask in base36. The wrong-guess count isn't stored — it's derived from (word, mask). Player 1 sets the word once; every guess after that is Player 2's (`nextTurn` keeps giving it back to them).
- **battleship**: a JSON array of four strings `[fleet1, fleet2, shots1, shots2]`. A fleet is 5 ships × (2-digit start cell + `h`/`v`); shots are 2-digit cells in firing order. Player 1 places (move 1), Player 2 places (move 2), then Player 1 fires first and turns alternate (no extra turn on a hit). Hit/miss/sunk are derived from (fleet, shots), never stored. Both fleets ride along in the link, the same tradeoff as Hangman's word.
- **mastermind**: the secret (4 digits `0`–`5`) followed by each guess (4 digits). Feedback is derived from (secret, guess). Like Hangman, the Codemaker sets the code once and every guess is the Codebreaker's (`nextTurn` keeps it with them until the game ends).

Typical link lengths: ~140–150 for tic-tac-toe and Connect Four, ~150–190 for Memory and Lights Out, ~210–245 for chess, up to ~380 for a busy hard Minesweeper board, and ~110–130 for each of the seven newer games above — they use the same compact-string-board approach from the start, so there was nothing left to shrink.

### Old links and refreshes

Each browser remembers (in `localStorage`) the newest move it has seen for each game `id`:

- Opening a link older than that shows **"This is an old link"**, with a button that jumps to the latest move.
- Refreshing after you've moved shows the send screen again, instead of letting you move twice.
- To play both sides on one device (or to test in a single browser), use **Opponent on this device? Play … here** on the send screen.

There is no anti-cheat: anyone can hand-edit a link. That's accepted for a casual game between friends.

## Two-player rules for the reinterpreted games

Tic-tac-toe, Connect Four, and chess are played over WhatsApp exactly as they are normally. Minesweeper, Memory, and Lights Out needed new turn-based rules to become fair two-player games:

**Minesweeper**
- Players take turns revealing **one tile**. Player 1 opens, and the first reveal is always safe.
- Reveal a mine and you **lose immediately**.
- If every safe tile gets revealed, the player who opened **more tiles** wins. A flood-fill counts for whoever triggered it. Equal counts are a draw.
- There are no flags in two-player mode, since your opponent would see them.
- The board size is chosen before the first move and can't change after that.

**Memory Match**
- Flip two cards on your turn. A **match keeps your turn** — keep flipping until you miss or clear the board. A miss passes the turn.
- When every pair is matched, whoever matched **more pairs** wins. Equal counts are a draw.
- The board size is chosen before the first flip and can't change after that.

**Lights Out**
- Same press rule as solo Lights Out (toggle a cell and its four neighbors), but players alternate.
- **Whoever's press turns the last light off wins.**
- Since two players could in principle keep undoing each other, the game is called a **draw after 60 combined presses** if neither has cleared the board by then.

## More games (built from scratch)

These play by the same standard rules as the real games — no reinterpretation needed, since they're already turn-based two-player games. Notes on anything specific to the WhatsApp version:

**Reversi (Othello)**
- Standard flip-capture rules on an 8×8 board, Black opens.
- If a move leaves the opponent with no legal move, their turn is skipped automatically — you just keep playing instead of sending them an unplayable link. If neither side can move, the game ends and most discs wins.

**Checkers**
- Standard American rules: mandatory captures, forced multi-jump chains, king promotion (which always ends the chain, even mid-jump).
- A full jump chain resolves before anything is sent, so one link can represent several jumps.
- No legal move on your turn loses immediately.

**Dots and Boxes**
- A grid from 3×3 up to 6×6 boxes (4×4 by default, chosen by whoever makes the first move). Draw one line per turn; completing a box (or two at once) claims it and grants another turn.
- Most boxes when every line is drawn wins.

**Gomoku**
- 15×15 board, Black opens, five or more in a row (any direction) wins; a full board is a draw. On a touchscreen the first tap previews a stone and the second tap places it. Computer: a pattern-scoring heuristic (hard also looks one reply ahead). Link, live and same-device play.

**Pig**
- Roll as often as you like adding to a turn total; a 1 loses the turn, "hold" banks it. First to 100. A whole turn is one link. The roller's browser makes the dice, so over WhatsApp it runs on trust (like Minesweeper's mines); for the same reason Pig has no live mode.

**Ultimate Tic-Tac-Toe**
- Nine small boards in a 3×3. The cell you take picks the small board your opponent must play in (anywhere open if that board is already decided). Win three small boards in a line to win. Wire board is 91 characters: 81 cells, 9 board results, the forced board.

**Hex**
- 11×11 hexagons. Red connects top to bottom, Blue left to right; there are no draws. The computer scores positions by each side's shortest-path distance (a 0-1 breadth-first search), and hard also weighs the opponent's best reply.

**Blokus Duo**
- 14×14, 21 pieces each, start on the ringed squares, later pieces touch your own only at corners. A player with no move is skipped (the link says so); fewest squares left wins (−15 for placing all, −20 if the last was the single square). **The rules are one file, `blokus-duo/rules.js`**, loaded by the page and imported by the Worker, so the browser and server cannot disagree. Wire board is 238 characters: 196 cells and two 21-bit used-piece masks.

**Onitama**
- 5×5, four pawns and a master each, five of the 16 move cards in play (two per hand, one beside the board). Play a card, move a piece by one of its steps, then swap that card with the side card. Capture the enemy master or walk yours onto their temple to win. A player with no legal move must pass one card.
- Red deals and opens; over WhatsApp the opener's deal is just a choice of cards (nothing is hidden). **The rules and the computer are one file, `onitama/rules.js`**, loaded by the page and imported by the Worker. Wire board is 30 characters: 25 cells, then the two hands and the side card as hex digits. The computer is a depth-limited negamax (1, 3 or 5 plies) with a node cap, so a move takes about the same time on any phone.

**Quoridor**
- 9×9, one pawn each, 10 walls each. A turn is one pawn step (jumping a pawn that is next to you, or stepping diagonally past it when a wall or the edge is behind it) or one two-square wall. Walls may not cross or overlap, and a wall that would shut either pawn off from its goal row is refused (checked with a breadth-first search). First to the far row wins; a player with no pawn move and no wall to place makes it a draw.
- On a phone you tap **Wall**, then the spot where four squares meet; tapping it again (or **Rotate**) turns the ghost wall, and **Place** puts it down. Blue sees the board turned half a circle so their pawn starts at the bottom. **Rules and computer are one file, `quoridor/rules.js`**, shared with the Worker. Wire board: both pawns (2 digits each), walls left (hex), then the placed walls as sorted two-digit hex ids. The computer ranks every pawn step and every wall that slows the opponent by the change in shortest-path lengths (hard also weighs the reply).

**Liar's Dice (Perudo)**
- 2 to 4 players, 5 dice each, ones wild. A bid is "at least Q dice show F" over everyone's dice and must go up (more dice, or the same number of a higher face; to 1s you may halve the number, from 1s you must double and add one; no opening on 1s). **Dudo** reveals everything: a true bid costs the caller a die, a lie costs the bidder one. The loser opens the next round; no dice means out; the last player with dice wins.
- **Online rooms and vs computer only.** Same room server as Crazy 8 (`worker/card-protocol.mjs` now takes a game and its engine): the dice are rolled and kept in the Durable Object, each person is sent only their own, and everyone's dice are revealed only after a dudo. Rooms of 2 to 4 seats with 0 to 3 computer players, a computer fills in for someone offline 90 seconds, an idle turn is played for you. The rules and the computers are one file, `liars-dice/engine.js` (the computers count the odds with a binomial tail from their own dice). The room screens (landing, lobby, rematch, taunts, reconnect) are the shared `shared/multiseat.js`.
- There is no link or same-device mode: a link or one shared screen cannot keep the dice secret.

**Letter Boxed**
- Twelve letters on the four sides of a box, three a side. Spell words by moving between letters (never two in a row from the same side); each word starts with the last letter of the one before; 3+ letters, no repeats; use all twelve to win, in as few words as you can (there is always a way in two). Solo only, with a daily puzzle per level, ↻ new for a random one, a hint (one word of a solution at a time), a best (fewest words) per level, and refresh resume.
- **Word list:** `letter-boxed/words.txt` is about 55,000 words: the public-domain ENABLE list, kept to words 3 to 12 letters long that appear among the most common words of Peter Norvig's web word counts (MIT), minus a short list of slurs and vulgar words. Each line is `<tier><shared-prefix-length><rest>` (tier 0 common to 2 rare), so it is 296 KB and about 115 KB gzipped, and it is fetched only on this page and cached by the browser. Rebuilding it is a two-minute script (intersect, rank, sort, prefix-compress).
- Puzzles are built from a seed and step counts only (never the clock), so the daily box is the same on every device: pick two words that chain and together use twelve different letters, place the letters on the sides by a bounded backtracking search so both words obey the side rule, then list every word the box accepts. Easy boxes accept 500+ words and use common solution words; medium 250 to 500; hard needs at least one rare word. `letter-boxed/puzzle.js` has the rules and the generator and is tested in node (`node letter-boxed/puzzle.test.mjs`).

**Backgammon**
- Standard single games, no doubling cube, no gammons: 15 checkers each, two dice (doubles play four), hit a lone enemy checker, enter from the bar first, blocked points, play as many dice as you can (the larger one if only one can be played), bear off only with everyone home, exact die or the furthest-back point for a bigger one. Red goes first. You tap a checker (or the bar), then a highlighted point or the tray; **undo move** works within a turn; a whole turn is one link.
- **Over WhatsApp the roller's browser makes the dice** (so it runs on trust, like Pig; the roll is remembered so a refresh can't re-roll it). **Online the server rolls**: after every accepted turn `stamp` in `backgammon/rules.js` writes the next player's roll into the board (and passes the turn on, showing the roll, if that player has no legal move), and `check` accepts only a board some full legal turn with those dice can reach. The very first roll is derived from the room id (the page and the server both compute it). To support this `live-protocol.mjs` got one hook: a rules module may export `stamp(prev, next, mover, rand)`.
- Wire board (33 characters): 24 points (`a..o` Red, `A..O` White), bar and borne-off counts, the dice to play, the roll before it, and a forced-pass flag. Rules and the computer are one file, `backgammon/rules.js`. The computer lists every position a full turn can reach and scores them (pip count, borne off, blots, made points and primes, the bar); hard also averages the opponent's best reply over all 21 rolls. A refresh keeps a game against the computer or on one device even in the middle of a turn.

**Dominoes**
- The classic draw game, double-six (28 tiles): 7 each for 2 or 3 players, 5 each for 4; the highest double (else the highest tile) leads the first round and the winner leads after that. Play a tile that matches an end of the line; if you can't, draw until you can; with the boneyard empty, pass. Going out scores the pips left in everyone else's hands; a block (everyone passes) goes to the fewest pips, scoring the others' pips minus their own, and a tie scores nothing. First to 100 wins.
- **Online rooms and vs computer only** (hidden hands can't live in a link or on one shared screen). Same room server and shared room screens as Liar's Dice: the server shuffles, deals and holds every hand and is sent to each person only as their own tiles and a boneyard count; everyone's tiles are revealed at the end of a round. Rooms of 2 to 4 seats with 0 to 3 computer players; offline 90 seconds means a computer plays; an idle turn is played for you. Rules and computers are one file, `dominoes/engine.js` (easy plays any legal tile; medium dumps heavy tiles and doubles; hard also keeps the ends it can follow up on).

**Ludo**
- The cross-board race: four tokens each, a 6 brings one out of the yard, a 6 earns another roll (three 6s in a row forfeit the turn), and a token needs the exact roll to finish. Landing on an opponent on an ordinary square sends them back to the yard; entry squares and the star squares are safe, and there are no blockades. Two play red against blue diagonally; three and four fill in turn order. 2 to 4 players, against Easy / Medium / Hard computers, or an online room.
- Rules and computers are one file, `ludo/engine.js`, loaded by the page and imported by the Worker. **Online the server rolls the die** inside the engine, so nobody can choose a face; rooms of 2 to 4 seats with 0 to 3 computers use the shared `shared/multiseat.js` screens. The board is drawn from the engine's 15×15 cell map (`CELLS`, `YARDS`), so a token's drawn square and its rule square cannot disagree. The token buttons keep their elements between renders, so a move glides instead of jumping; skipped under `prefers-reduced-motion`.

**Hearts**
- Standard four-player Hearts: 13 cards each, pass three left / right / across / nobody, the two of clubs leads, follow suit, every heart is 1 point and the queen of spades 13. Shooting the moon gives everyone else 26. The first player to 100 ends the game and the **lowest** score wins.
- **Online rooms and vs computer only** (hidden hands). The table is always four seats: friends take them, and computers fill any empty seats when the host starts. The server deals and holds every hand and sends each person only their own cards. When the pass is running, a computer seat (or a person who has gone offline or sat idle) hands its three cards over by itself, so one missing player cannot stall the table. Rules and computers are one file, `hearts/engine.js` (easy plays any legal card; medium follows cheaply; hard also guards and dumps the queen).

**Nine Men's Morris**
- The old three-in-a-row hunting game: nine pieces each, place them on the 24 points, then move along the lines. A mill takes an opponent's piece; a player down to three pieces may fly to any empty point. Win by reducing the opponent below three pieces or leaving them with no legal move.
- WhatsApp, online, vs computer (three levels) and same device. Rules and the computer are one file, `nine-mens-morris/rules.js`, loaded by the page and imported by the Worker; the wire board is a short string, so a link is tiny.

**Breakthrough**
- 8×8, two rows of pieces each. A piece steps one square straight forward into an empty square, or one square diagonally forward to capture. First to reach the far back rank wins. Very simple rules, surprisingly sharp tactics.
- WhatsApp, online, vs computer (three levels) and same device. Rules and the computer are one file, `breakthrough/rules.js`, shared with the Worker; a no-capture/no-promotion counter turns an endless link game into a draw instead of an infinite loop.

**Farkle (10,000)**
- Six dice and a decision every roll: keep at least one scoring die, then bank the turn total or roll the rest. A roll with no scoring die loses the turn; all six scoring is hot dice and rolls all six again. Ones are 100, fives 50, three of a kind 1000 (three 1s) or face×100, four/five/six of a kind 1000/2000/3000, a 1-6 straight 1500 and three pairs 1500. First to 10,000 wins.
- **Online rooms and vs computer.** The dice are rolled inside `farkle/engine.js` on the server, so a room cannot choose a face; rooms of 2 to 4 seats with computers use the shared `shared/multiseat.js` screens.

**Hashiwokakero (Bridges)**
- Join the numbered islands with horizontal or vertical bridges: an island's number is its bridge count, a pair may have one or two bridges, bridges cannot cross, and every island must end connected. Solo only, with a daily puzzle per level, random puzzles, three sizes, undo, check, hints, timer and refresh resume.
- `hashiwokakero/puzzle.js` generates from a seed with bounded step counts and keeps only boards with exactly one solution, so the daily board is identical on every device.

**Flow Free**
- Join every coloured pair with a path; paths may not cross and every cell must be filled. Drag from an endpoint through neighbouring cells, lift a path to redraw it, undo, restart, hint, timer and refresh resume. Solo only, daily per level and random puzzles.
- `flow-free/puzzle.js` draws a full-grid path partition from a seed, keeps the endpoints and verifies the stored solution, so every daily board is solvable and identical on every device.

**Word Search**
- Swipe across a straight line of letters to find the hidden words. Horizontal, vertical and diagonal, forwards and backwards; three grid sizes, daily and random puzzles, found-word list, hint, timer, best and refresh resume. Solo only.
- `word-search/puzzle.js` places the target words from a seed and fills the rest of the grid; `word-search/words.js` is a self-contained common-word list, so the page needs no dictionary download.

**Lost Cities**
- Two players, five expeditions and 60 cards: play a card onto one of your expeditions (numbers must rise; handshakes only before a number), discard onto its colour pile, then draw from the deck or a discard pile. An expedition scores its numbers minus 20, doubled once per handshake, and a negative expedition counts negative. The deck running out ends the round; the higher total wins.
- **Online rooms and vs computer only** (hidden hands). The server deals and holds both hands and sends each person only their own. Rules and computers are one file, `lost-cities/engine.js`; the room uses the shared `shared/multiseat.js` screens.

**Slitherlink**
- Draw one closed loop along the grid lines. A number says how many of its four sides the loop uses; the loop cannot cross or branch, and every line must be part of the same loop. Three sizes (5×5, 7×7, 10×10), daily per level, random puzzles, undo, X marks, hints, check, timer and refresh resume. Solo only.
- `slitherlink/puzzle.js` builds a single loop from a seed, reads the clues off it and uses a bounded solver to keep only boards with exactly one solution, so the daily board is identical everywhere.

**Star Battle**
- Put stars on the grid so each row, each column and each coloured region has exactly the required number, and no two stars touch, even diagonally. 6×6 and 8×8 with one star, 10×10 with two; daily per level, random puzzles, conflict shading, undo, hints, check, timer and refresh resume. Solo only.
- `star-battle/puzzle.js` grows regions around a seeded solution and rejects any board with a second solution, so every daily puzzle is valid and unique.

**Connect6**
- The board is 15×15 rather than the international 19×19: at 320px a 19×19 grid leaves stones too small to place two per turn accurately. Black opens with one stone; every later turn places two, and six or more in a row horizontally, vertically or diagonally wins. A full board is a draw.
- WhatsApp, online, vs computer (three levels) and same device. Rules and the computer are one file, `connect6/rules.js`, shared with the Worker; the wire board is a short string.

**Tablut (Hnefatafl)**
- 9×9, attackers against the king's defenders. All pieces move like rooks; a piece is captured by sandwiching it between two enemies (the king is harder), and the attackers win by taking the king while the defenders win by getting him to any corner. Attackers move first.
- WhatsApp, online, vs computer (three levels) and same device. Rules and the computer are one file, `tablut/rules.js`, shared with the Worker.

**Fanorona**
- The Fanoron-Sivy board: 9 columns by 5 rows of points, with horizontal, vertical and alternate-point diagonal lines. Pieces step one point. A capture removes every enemy piece along the line you approach or withdraw along, and if a capture is available you must take it; a piece can chain captures. Win by leaving the opponent with no pieces or no legal move.
- WhatsApp, online, vs computer (three levels) and same device. Rules and the computer are one file, `fanorona/rules.js`, shared with the Worker.

**Cribbage**
- Two players, six cards each: discard two to the dealer's crib, cut a starter, then peg to 31 (fifteens, pairs, runs, go) and count hands and crib (fifteens, pairs, runs, flush, nobs). First to 121 wins; the deal repeats until someone gets there.
- **Online rooms and vs computer only** (hidden hands). The server deals and holds both hands and the crib, and each person sees only their own cards. Rules and computers are one file, `cribbage/engine.js`; the room uses the shared `shared/multiseat.js` screens.

**Skull**
- Three to six players, four discs each (three roses, one skull). Place discs face down, bid how many you can flip without finding a skull, and the highest bidder turns their own stack first, then other players' discs. A skull costs a disc; a clean bid scores a point. First to two points wins, and a player who loses all four discs is out.
- **Online rooms and vs computer.** The server holds every face-down stack and sends each person only their own discs. Rules and computers are one file, `skull/engine.js`; the room uses the shared `shared/multiseat.js` screens.

**Yatzy (Yahtzee scoring)**
- 13 turns: roll five dice, re-roll up to twice keeping any you like, then fill one of 13 boxes (Ones to Sixes with a 35 bonus at 63; three and four of a kind and chance score all five dice; full house 25, small straight 30, large straight 40, Yatzy 50; a crossed-out box scores 0). A second Yatzy over a 50 earns +100 and plays as a joker (its own upper box if open, else any open lower box scoring in full, else any upper box). Solo only: two-tap scoring (pick a box, tap again), a best score, and refresh resume.
- **The daily game is a dice table, not a stream**: the face of die *i* on roll *r* of turn *t* is a pure function of the seed, so everyone on the day's seed is dealt the same dice and re-rolling the same die in the same spot always shows the same number (holding differently can't fish for a better one). `today's game` uses the day's seed, `new random game` a random one, `replay this game` the same seed again. `yatzy/rules.js` has the rules and is tested in node (`node yatzy/rules.test.mjs`).

**Cross Sums (Kakuro)**
- Fill the white squares with 1 to 9 so each unbroken run adds up to its clue (top right of the black square: across; bottom left: down) with no digit repeated in a run. Three levels (5×5, 7×7, 9×9 of playable squares), a daily puzzle per level, `↻ new` for a random one, a timer and a best time per level, pencil **Notes**, **Check** (shades runs that already break a rule), undo, keyboard entry, and refresh resume. Tapping a square lists the ways each of its runs can still be made.
- **Every puzzle has exactly one solution.** `cross-sums/puzzle.js` lays out a pattern (no run of 1, none over 9), fills it with a random valid solution and reads the clues off, then asks a bounded solver for a *different* solution; where it finds one, a square where the two disagree is shown as a given, repeated until no other exists. A few candidates are built (within a fixed solver-step budget, never the clock) and the one needing the fewest givens is kept, so the daily puzzle is the same on every device. Typical givens: about 30% of the white squares (more on easy, which also shows a few extra). The page shows "Building the puzzle…" first: hard takes about a third of a second on a laptop and rarely over a second. Tested in node (`node cross-sums/puzzle.test.mjs`): every puzzle valid and unique across levels and many seeds.

**Sliding Puzzle**
- The 15-puzzle in three sizes (3×3, 4×4, 5×5): slide a tile next to the gap into it, or tap further along the row or column to slide the whole line (each tile moved counts as a move), until the numbers read in order with the gap last. Daily puzzle per size, `↻ new` for a random one, moves, time (it starts at your first move) and a best (fewest moves) per size, undo, restart, arrow keys, and refresh resume; tiles in the right place tint green and slide with a short animation.
- A puzzle is the solved tray shuffled by a seeded random walk of legal moves that never just undoes the last one (90, 240 or 520 steps), so it is always solvable and identical on every device. `sliding-puzzle/puzzle.js` has the moves and the generator and is tested in node (`node sliding-puzzle/puzzle.test.mjs`); a saved game is checked with the inversion-parity test before it is accepted.

**Water Sort**
- Tubes hold up to four layers of coloured water; pour one into another when its top colour matches the other's top (or the other is empty) and there is room, and every layer of that colour on top pours at once as far as it fits. Sort until each tube is empty or four of one colour. Three levels (5, 8 or 12 colours, always two empty tubes), a daily puzzle per level, `↻ new` for a random one, a move count and best per level, undo, restart, a **hint** (green: pour from, yellow: into; it follows one stored solution as long as you do, so hints never go in circles) and **Show letters** for anyone who can't tell the colours apart. Refresh resume replays the pours from the puzzle's seed.
- A puzzle is a seeded random deal that a bounded depth-first search (node-capped, ordered to prefer pours onto the same colour and finishing tubes) has proved solvable, so every puzzle can be solved and it is identical on every device; the same search gives the hints. `water-sort/puzzle.js` is tested in node (`node water-sort/puzzle.test.mjs`): each stored solution is replayed to a sorted board.

**Car Park (Rush Hour)**
- A 6×6 car park: the red car is blocked in, and every other car or truck slides only along its own row or column. One slide counts as one move. Get the red car out through the yellow gate on the right. 42 levels of rising difficulty, a move count, a best per level, undo, reset, a **hint** that gives the exact next slide from a BFS solver, tap/drag/swipe and arrow-key play, level select and Next level.
- `car-park/rules.js` holds the levels, the legal moves and the breadth-first solver, shared by the page and the node test. Every shipped level is BFS-solved: `node car-park/rules.test.mjs` checks it is solvable, that its stored par is the exact minimum, and that the stored solution replays through the public move API to a win.

**Chess puzzles (a mode of the Chess page)**
- Pick `chess puzzles` in Chess's mode menu. The computer plays the opponent's last move, you find the continuation. 200 bundled puzzles from the **Lichess puzzle database (CC0)**, credited in the page's how-to: 28 mates in 1, 70 in 2, 14 in 3 and about 90 short tactics (forks, pins, skewers, hanging pieces, discovered attacks, trapped pieces, deflection, attraction), rated about 500 to 1500, popular, with a solution of at most four of your moves. A wrong move is refused (try again); a right one is answered; in a mating puzzle **any** move that checkmates counts. `Today's puzzle` is the same for everyone each day (picked by date), `Another puzzle` a different one, `Hint` highlights the piece and then the square, `Show solution` plays it out, and the page counts how many of the 200 you have solved.
- `chess/puzzles.js` holds the data (`[id, FEN, moves, rating, theme]`). **`chess/puzzles.test.mjs` plays every one against the Chess page's own move generator** (the engine half of `chess/game.js`, which gained `stateFromFEN` and `uciToMove`): every move legal, every mate puzzle the right length and ending in checkmate, no under-promotions (the page only promotes to a queen). Rebuilding the set: take the first slice of `lichess_db_puzzle.csv.zst`, filter by theme, rating, popularity and length, and run the same verification before keeping each puzzle.

**Crazy 8**
- One deck of 54 (two jokers), 8 cards each every round. 2 = pick up 2, joker = pick up 5, both chain; an Ace blocks a pick-up and frees the next player to play any card; J skips; 7 reverses (with two players left, J and 7 mean you play again); an 8 goes on its own suit or another 8 and names the suit, but can't dodge a pick-up. A "Last card!" button must be pressed before you play your second-to-last card (miss it: pick up 2). You may pick up one card on purpose. Normal mode (first out wins, Rematch and a win tally) or Tournament (the last player holding cards is out each round, down to one).
- **Online rooms hold 2 to 4 seats.** The host sets the mode and 0 to 3 computer players (one difficulty); the game starts when the host taps Start, or by itself when all 4 seats fill; nobody can join after that. The deck and hands live only in the Durable Object (`worker/card-room.mjs`); each person is sent their own hand and everyone else's card count. A person offline for 90 seconds is replaced by a computer (everyone is told), and an online person who doesn't move for 90 seconds has one turn played for them.
- The rules and the computer players are one file, `crazy-8/engine.js`, loaded by the page and imported by the Worker (like Blokus Duo), so the browser and the server cannot disagree. Tapping a card shows what it does and why it can or can't be played.

**Mancala (Kalah)**
- Standard Kalah: sow counter-clockwise skipping the opponent's store, land in your own store for another turn, capture an opposite pit by landing your last seed in your own empty one.
- An empty row ends the game — the other player sweeps their remaining seeds into their store first.

**Pentago**
- Place a marble, then rotate one of the four 3×3 quadrants 90° — both parts happen before anything sends. 5 in a row after the rotation wins; both players getting 5 at once (from the same rotation) is a draw.

**Rock Paper Scissors**
- Best of 3, 5, or 7. Since a link can't deliver a truly simultaneous choice, Player 1's pick opens each round hidden and Player 2's pick resolves it — the UI never shows Player 1's pick to Player 2 beforehand. A tie replays the round.

**Hangman**
- Player 1 sets a secret word (3–20 letters) once. Every guess after that belongs to Player 2, who keeps guessing link after link — 6 wrong guesses and Player 1 wins, complete the word first and Player 2 does.
- The word isn't shown to Player 2 before the game ends, the same tradeoff as Rock Paper Scissors' hidden pick.

**Battleship**
- Both players secretly place 5 ships (5, 4, 3, 3, 2) on a 10×10 grid, then take turns firing. First to sink the whole enemy fleet wins. Also vs a computer (hunt/target AI) and on one device with a cover screen between turns.

**Mastermind**
- The Codemaker picks a 4-peg code from 6 colours; the Codebreaker has 10 guesses, with exact/colour-only feedback after each. Also vs a computer-chosen code and on one device.

## Usernames, notifications and the installable app

Optional and separate from the games: none of it is needed to play.

- **Username.** The home page's "Your name" panel lets a player pick a name (3 to 16 letters, digits and `_`, case-insensitive, a blocklist for offensive and reserved names). One Durable Object, `UserRegistry` (`worker/user-registry.mjs`), holds every name, so it is unique by construction. The server mints a secret token, keeps only its hash, and the browser keeps the token: whoever holds it owns the name. There is no recovery; lose the token and the name is gone. Unused for 90 days a name is freed. Rules and limits are pure functions in `worker/users.mjs`.
- **Poke a friend.** In a live room's waiting screen a signed-in player can type a friend's username and "Poke". The server checks the room is real and open, then sends a Web Push (RFC 8291 encryption, RFC 8292 VAPID, written with WebCrypto in `worker/webpush.mjs`, no library) that opens the room when tapped. Limits: 10 pokes an hour per sender, 20 an hour per receiver, one per two minutes per pair. A muted person or someone who blocked the sender is never reached, and the sender is not told.
- **Install.** `manifest.json` plus PNG icons make the site installable; the home page offers "Install the app" where the browser allows it and explains Add to Home Screen on iPhone (where notifications work from the installed app). The service worker (`sw.js`) does only push and notification clicks; it caches nothing.
- **API** (same origin only): `GET /api/user/status`; `POST /api/user/{check,claim,ping,push,settings,release,poke}`.

### Switching pokes on

Usernames work as soon as the Worker is deployed (the `UserRegistry` migration is in `wrangler.toml`). Pokes need a push key pair:

```
node worker/vapid-keys.mjs                    # prints a public and a private key
# put the public key in wrangler.toml:  VAPID_PUBLIC_KEY = "..."   (and set VAPID_SUBJECT to your mailto:)
npx wrangler secret put VAPID_PRIVATE_KEY     # paste the private key
npx wrangler deploy
```

With `VAPID_PUBLIC_KEY` empty the site simply hides every notification control. Keep the private key: replacing it makes saved subscriptions stop working until people turn notifications on again.

## Tests

| Command | Covers |
|---|---|
| `node shared/taunts.test.mjs` | taunt pools (length, duplicates, the server's taunt count matches the lists) |
| `node worker/live-protocol.test.mjs` | the live-room rules, including taunt validation |
| `node worker/rules/wave1.test.mjs` | thousands of random games per live game, Dots and Boxes at every size |
| `node worker/rules/crazy-8.test.mjs`, `node worker/card-protocol.test.mjs` | the Crazy 8 engine (every rule, 720 computer games, cards never lost or duplicated) and the room rules with a fake clock |
| `node worker/rules/gomoku.test.mjs`, `ultimate-tic-tac-toe.test.mjs`, `hex.test.mjs`, `blokus-duo.test.mjs` | each game's rules through the real room protocol (thousands of random games) |
| `node worker/webpush.test.mjs` | push encryption against the RFC 8291 worked example, VAPID signature, allowed endpoints |
| `node worker/users.test.mjs` | username and poke rules |
| `node worker/live.integration.mjs`, `node worker/users.integration.mjs`, `node worker/card.integration.mjs` | against a running `wrangler dev` (the second uses a fake push service and decrypts what it receives) |

For the integration tests start `npx wrangler dev --persist-to ../.wrangler-state --port 8788 --var VAPID_PUBLIC_KEY:<pub> --var VAPID_PRIVATE_KEY:<priv> --var PUSH_ALLOW_LOCAL:1 --var LIVE_ALLOW_NO_ORIGIN:1` and run them with `BASE=http://localhost:8788`.

## Run locally

```bash
python -m http.server 8000
# then visit http://localhost:8000
```

To try a full game on one computer, use two browser profiles (or a normal and a private window) so each player has separate storage, and paste links between them.

## Deploy to Cloudflare Workers

The site is served by [Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/): Cloudflare serves the files straight from the repo, and [worker/index.mjs](worker/index.mjs) runs first so it can rewrite each page's Open Graph tags from the `?s=` state. That is what makes a WhatsApp preview say *"Your move · tic-tac-toe"* instead of the same generic line on every link. `og:image` is static (`og-image.png`, the same picture on every game and every move) — the worker only rewrites title/description, not the image, so there's no per-move artwork.

```bash
npx wrangler dev --persist-to ../.wrangler-state   # http://localhost:8787
node worker/og-text.test.mjs                       # preview-text tests, no network
node tools/gen-sitemap.mjs                         # refresh sitemap.xml before deploying
npx wrangler deploy
```

`sitemap.xml` is generated from the game cards on the hub (`index.html`), so it lists every published game and nothing else; `robots.txt` points search engines at it. Re-run the generator after adding or removing a game — `node tools/gen-sitemap.mjs --check` fails when it is stale.

`--persist-to` is not optional for `dev`. The assets directory is the repo root, so wrangler watches the repo root — including the `.wrangler/` folder it writes its own state into. That state is SQLite with WAL files rewritten continuously, so the watcher reloads forever and the server accepts connections without ever answering one (measured: 978 reload cycles). `.assetsignore` does not help — it controls uploads, not watching. Persisting state outside the repo fixes it (measured: 1 reload). `wrangler deploy` watches nothing and needs no flag.

First-time setup, in order:

1. Add `wa-minigames.online` to Cloudflare (**Add a site**); it gives you two nameservers.
2. At the registrar, replace the existing nameservers with those two. This is the only irreversible-feeling step — the A records below stop being used, so keep them written down.
3. Wait for the zone to go **Active**.
4. `npx wrangler deploy`.
5. Worker → **Settings → Domains & Routes → Add custom domain** → `wa-minigames.online`. Cloudflare creates the DNS record and the certificate itself; no A records and no `CNAME` file involved.
6. In the repo's GitHub **Settings → Pages**, clear the custom domain so the two don't both claim it.

To go back to GitHub Pages: point the nameservers (or the A records) at GitHub again, per the section below, and restore the `CNAME` file — it was deleted once Cloudflare took over the domain, so recover it with `git checkout 837ee16 -- CNAME` (it contained one line: the bare domain). `.nojekyll` is still in the repo and still needed for that path.

Caching is in [_headers](_headers) — fonts and `assets/vendor/` are immutable for a year; the site's own CSS and JS stay on ETag revalidation, because their filenames carry no content hash and a long `max-age` would strand players on a stale `game.js`. GitHub Pages allowed none of this: it serves a fixed `max-age=600`.

## Deploy to GitHub Pages (fallback)

Settings → Pages → *Deploy from a branch* → `main`, folder `/ (root)`. The site is static files only, and `.nojekyll` is included.

The custom domain **wa-minigames.online** is set via the [CNAME](CNAME) file in this repo — GitHub Pages picks it up automatically once the domain's DNS points here (see below) and it's entered under Settings → Pages → Custom domain. Turn on **Enforce HTTPS** there once the certificate is issued (can take a while after DNS first resolves).

### DNS records

These apply to the GitHub Pages setup. On Cloudflare you do not add them at all — the Worker's custom domain creates its own record.

At your domain registrar, for the apex domain `wa-minigames.online`, add four **A** records (all with the same host: `@`, or blank, depending on the registrar):

```
185.199.108.153
185.199.109.153
185.199.110.153
185.199.111.153
```

Optional, for IPv6 (**AAAA**, same host):

```
2606:50c0:8000::153
2606:50c0:8001::153
2606:50c0:8002::153
2606:50c0:8003::153
```

If `www.wa-minigames.online` should also work, add one more record:

```
CNAME   www   bash328.github.io
```

Don't mix an A record and a CNAME on the same host (`@`) — the apex takes A/AAAA records only.

## Project structure

```
index.html, sw.js, manifest.json, icon-*.png, apple-touch-icon.png, favicon.svg, og-image.png,
robots.txt, sitemap.xml          the hub page and the files browsers expect at the site root
_headers, wrangler.toml, .assetsignore    hosting: cache rules, Worker config, repo files kept out of the site
<game>/                          one folder per game (58): index.html + game.js, and where they exist
                                 engine.js / rules.js (rules shared with the Worker), puzzle.js, words.js, banter.js
shared/                          code every page loads
    shared.css, fun.css, fun.js      design tokens, the chunky look and its behaviour
    gamekit.js                       helpers, standard page layout, taunts, end-of-game card, motion
    async-share.js/.css              play-by-link: encode/decode, validation, share panel
    live-share.js                    live online play client (rooms, table talk, poke a friend)
    multiseat.js/.css                online-room screens for the multi-seat card and dice games
    account.js, account-ui.js        username, notifications, install
    manpage.js, taunts.js, ga.js     help overlay, every commentary line, analytics
    taunts.test.mjs                  checks the commentary lists
assets/                          static files
    fonts/, vendor/, splash/, ui/    Fira Mono and Lilita One, lz-string, iOS splash screens, button images
worker/                          Cloudflare Worker: link previews, live and card rooms (Durable Objects), user registry
    rules/                           per-game rules the server checks live moves against
    *.test.mjs                       unit tests, run under plain Node (room-glue.test.mjs runs the real rooms)
tests/                           regression.mjs (browser checks), cache-bust.mjs (?v= stamps), load-timing.mjs
tools/                           serve.mjs (local server, --phone for an iPhone-sized window), gen-sitemap.mjs, gen-icons.py, deepseek.mjs, memory/ (agent memory scripts)
docs/                            TODO.md, CHANGELOG.md, BANTER.md, agent-memory/ (state, decisions, event log)
README.md, AGENTS.md, CLAUDE.md, LICENSE
```

Each game folder is self-contained apart from `shared/` and `assets/`. Tests that belong to one game
(`car-park/rules.test.mjs`, `hangman/banter.test.mjs`) live next to the code they test.

## License

[MIT](LICENSE). Original games © Tejas Wavde. lz-string © pieroxy, MIT ([assets/vendor/lz-string.LICENSE](assets/vendor/lz-string.LICENSE)). Fira Mono © The Mozilla Corporation and Telefonica S.A., SIL Open Font License 1.1 ([assets/fonts/fira-mono.LICENSE](assets/fonts/fira-mono.LICENSE)).

## The look, the motion and the tests

Every game page uses the chunky look (`shared/fun.css` + `shared/fun.js`, `class="fun"` on the body); the hub has its own dark page and the privacy page uses the same chunky look (violet page, round back button, one rounded card). `art-*.html` are unlinked previews of the hub tile art, not part of the site.

- **Steady layout:** pages with `data-fun-zone` have a header, one fixed message zone, an Options bar and then the board. Options opens as a popover over the board, so nothing moves when it opens, a status changes or a mode changes (`data-fun-zone="slim"` / `"mini"` shrink the zone). Choosing from a dropdown inside Options folds it away again.
- **Motion** is in `shared/gamekit.js`, so a page opts in with one line: `Gamekit.popFilled(boardEl)` pops any square that newly fills (stones, marks, numbers); `Gamekit.glidePieces(boardEl, selector)` glides a piece that has moved. Games with their own motion: Connect Four drops, Reversi flips, Chess/Checkers slides (multi-jumps follow their path), Mancala sows seed by seed, Minesweeper ripples and explodes, Battleship has a cannon, Zip glides a head with a halo, tic-tac-toe draws its win line, 2048 blends merges, Ludo tokens glide from square to square. Everything is skipped under `prefers-reduced-motion`.
- **End of game card:** `shared/gamekit.js` builds it when the status line says someone won. `data-next="Next level"` on the body makes puzzle pages offer the next puzzle; `data-over-delay="ms"` holds the card back while a win animation plays.
- **Shared rules:** a game that is played online keeps its rules in one file the page and the Worker both load (`backgammon/rules.js`, `onitama/rules.js`, `pig/rules.js`, `nine-mens-morris/rules.js`, `breakthrough/rules.js`, `connect6/rules.js`, `tablut/rules.js`, `fanorona/rules.js`, and the card engines `crazy-8/engine.js`, `liars-dice/engine.js`, `dominoes/engine.js`, `ludo/engine.js`, `hearts/engine.js`, `farkle/engine.js`, `lost-cities/engine.js`, `cribbage/engine.js`, `skull/engine.js`), so they cannot disagree. Pig and Backgammon are online with the server rolling (`stamp` hook); Ludo's and Farkle's dice are rolled inside their engines, so the online room never trusts a browser with them.
- **Tests:** `node tests/regression.mjs` drives Chrome at phone widths over every fixed issue and every redesigned page (`--page chess --only steady` narrows it). The best-value batch checks are `nine-mens-morris-places`, `breakthrough-moves`, `farkle-rolls`, `hashiwokakero-board`, `flow-free-board`, `word-search-grid` and `lost-cities-deal`; the next batch adds `slitherlink-loop`, `star-battle-stars`, `connect6-two-stones`, `tablut-move`, `fanorona-move`, `cribbage-discard`, `skull-place` and `skull-six-seats`, plus the earlier `hearts-pass-and-play`, `ludo-board-and-roll`, `new-card-games-online-landing` and `online-to-computer-clears-room`. After changing any script or stylesheet a game loads, run `node tests/cache-bust.mjs` to re-stamp the `?v=` hashes. The Worker has its own tests: `node worker/rules/pig.test.mjs`, `node worker/live-protocol.test.mjs`, `node worker/rules/nine-mens-morris.test.mjs`, `node worker/rules/breakthrough.test.mjs`, `node worker/rules/connect6.test.mjs`, `node worker/rules/tablut.test.mjs`, `node worker/rules/fanorona.test.mjs`, `node worker/farkle.test.mjs`, `node worker/lost-cities.test.mjs`, `node worker/cribbage.test.mjs`, `node worker/skull.test.mjs`, `node worker/hearts.test.mjs`, `node worker/ludo.test.mjs`, and the other `worker/**/*.test.mjs`.

