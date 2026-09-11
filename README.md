# WA mini-games

Two-player mini-games you play **with a friend over WhatsApp**, one link per turn. There are no accounts and no server. Make your move, tap **Send on WhatsApp**, and your friend opens the link, moves, and sends a new link back.

**▶ Play: [wa-minigames.online](https://wa-minigames.online/)**

Forked from [wavde/games](https://github.com/wavde/games) (MIT): vanilla HTML/CSS/JS with no build step. The remaining six solo/logic-puzzle games are unchanged.

## WhatsApp games

| Game | Modes |
|---|---|
| [tic-tac-toe](tic-tac-toe/) | **2 players · WhatsApp** (default), vs AI |
| [connect-four](connect-four/) | **2 players · WhatsApp** (default), vs AI at 3 depths, local 2 players |
| [minesweeper](minesweeper/) | **2 players · WhatsApp** (default), solo |
| [chess](chess/) | **2 players · WhatsApp** (default), vs AI at 3 depths |
| [memory](memory/) | **2 players · WhatsApp** (default), solo (race the clock) |
| [lights-out](lights-out/) | **2 players · WhatsApp** (default), solo |

Opening a shared link always switches the page to WhatsApp mode.

## How play-by-link works

1. Open a game page with no `?s=` in the URL. You get a fresh board; make the first move.
2. The page encodes the whole game into the URL and shows **Send on WhatsApp** and **Copy link**. The WhatsApp button opens `https://wa.me/?text=…` with no phone number, so you pick the contact.
3. Your friend taps the link and sees the board with your last move outlined. They move, and send a new link back.
4. When the game ends, the player who made the final move sends the result link so the other player sees how it ended.

The URL is the save file. There is no game server, lobby, or lookup.

### Link format

`?s=` holds a compressed envelope, with `+` swapped for `_`. That keeps links to `A–Z a–z 0–9 _ -`; a raw `+` in a query string turns into a space. lz-string is vendored in [vendor/](vendor/), so the game makes no CDN requests.

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
| `turn` | Who moves next. After the game ends, the player who did *not* make the last move. |
| `status` | `in_progress`, `won`, or `draw`. |
| `winner` | `null` unless `status` is `won`. |
| `moveCount` | Moves made so far. |
| `last` | Game-specific index (or indices) of the last move, used for highlighting. |

On the wire, `encode()`/`decode()` in [async-share.js](async-share.js) shrink that to single-letter keys and single-letter status codes (`g/v/i/t/b/s/w/n/l`, `status` → `p`/`w`/`d`) before `lz-string` compresses it — purely a transport detail, invisible to every game and to `AsyncShare.encode()`/`decode()` callers, which always use the full field names above.

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

Typical link lengths: ~140–150 for tic-tac-toe and Connect Four, ~150–190 for Memory and Lights Out, ~210–245 for chess, up to ~380 for a busy hard Minesweeper board.

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

## Run locally

```bash
python -m http.server 8000
# then visit http://localhost:8000
```

To try a full game on one computer, use two browser profiles (or a normal and a private window) so each player has separate storage, and paste links between them.

## Deploy to GitHub Pages

Settings → Pages → *Deploy from a branch* → `main`, folder `/ (root)`. The site is static files only, and `.nojekyll` is included.

The custom domain **wa-minigames.online** is set via the [CNAME](CNAME) file in this repo — GitHub Pages picks it up automatically once the domain's DNS points here (see below) and it's entered under Settings → Pages → Custom domain. Turn on **Enforce HTTPS** there once the certificate is issued (can take a while after DNS first resolves).

### DNS records

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
├── index.html          hub page
├── async-share.js      play-by-link: encode/decode, validation, share panel, old-link detection
├── async-share.css     share panel styles (shared tokens)
├── vendor/             lz-string 1.5.0 + its MIT license
├── shared.css          design tokens, buttons, panels, light mode
├── soft.css            warm dark theme for game pages
├── manpage.css/.js     "? man" help overlay
├── gamekit.js          shared helpers (PRNG, storage, chips, etc.)
├── manifest.json       PWA manifest
├── tic-tac-toe/        ┐
├── connect-four/       │
├── minesweeper/        ├ WhatsApp two-player + solo modes
├── chess/              │
├── memory/             │
├── lights-out/         ┘
└── 2048/ mini-sudoku/ tango/ queens/ zip/ patches/   (unchanged solo games)
```

Each game folder is self-contained: `index.html` + `game.js`.

## License

[MIT](LICENSE). Original games © Tejas Wavde. lz-string © pieroxy, MIT ([vendor/lz-string.LICENSE](vendor/lz-string.LICENSE)).
