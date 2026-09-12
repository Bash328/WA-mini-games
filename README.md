# WA mini-games

Two-player mini-games you play **with a friend over WhatsApp**, one link per turn. There are no accounts and no server. Make your move, tap **Send on WhatsApp**, and your friend opens the link, moves, and sends a new link back.

**▶ Play: [wa-minigames.online](https://wa-minigames.online/)**

Forked from [wavde/games](https://github.com/wavde/games) (MIT): vanilla HTML/CSS/JS with no build step. The six original solo/logic-puzzle games are unchanged.

## WhatsApp games

| Game | Modes |
|---|---|
| [tic-tac-toe](tic-tac-toe/) | **2 players · WhatsApp** (default), vs AI |
| [connect-four](connect-four/) | **2 players · WhatsApp** (default), vs AI at 3 depths, local 2 players |
| [minesweeper](minesweeper/) | **2 players · WhatsApp** (default), solo |
| [chess](chess/) | **2 players · WhatsApp** (default), vs AI at 3 depths |
| [memory](memory/) | **2 players · WhatsApp** (default), solo (race the clock) |
| [lights-out](lights-out/) | **2 players · WhatsApp** (default), solo |
| [reversi](reversi/) | **2 players · WhatsApp** (default), local 2 players |
| [checkers](checkers/) | **2 players · WhatsApp** (default), local 2 players |
| [dots-and-boxes](dots-and-boxes/) | **2 players · WhatsApp** (default), local 2 players |
| [mancala](mancala/) | **2 players · WhatsApp** (default), local 2 players |
| [pentago](pentago/) | **2 players · WhatsApp** (default), local 2 players |
| [rock-paper-scissors](rock-paper-scissors/) | **2 players · WhatsApp** (default), local 2 players |
| [hangman](hangman/) | **2 players · WhatsApp** (default), local 2 players |

Opening a shared link always switches the page to WhatsApp mode. The last seven games above are built from scratch for this project (not adapted from wavde/games) and skip an AI mode — a same-device "local" pass-and-play mode stands in for it instead, since building a bespoke engine for each wasn't proportionate to the ask.

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
| `turn` | Who moves next. After the game ends, the player who did *not* make the last move. Normally the opponent, but `commit()` accepts an optional `nextTurn` to override that when a rule grants the same player another turn — Reversi's pass, an extra turn in Dots and Boxes/Mancala, or Hangman's guesser always going again. |
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
- **reversi**: 64 characters, `0` empty, `1` Black (opens), `2` White. `last` is the placed disc's index. A move that leaves the opponent with no legal move passes back to the same player (`nextTurn`); no legal move for either side ends the game.
- **checkers**: 64 characters, `0` empty, `1`/`2` a man, `3`/`4` a king. A full mandatory jump chain resolves locally before any link is produced — one commit per turn, however many jumps it took (same pattern as Memory's multi-flip turn). No legal move on your turn loses immediately.
- **dots-and-boxes**: 56 characters — 40 for edge state (`0`/`1`, drawn or not) then 16 for box ownership (`0` unclaimed, `1`/`2`). Ownership can't be derived from the final edge state alone (it depends on who drew the completing line), so it rides along explicitly. Completing a box (or two at once) grants another turn (`nextTurn`).
- **mancala**: 28 characters, 14 pits (0–5 Player 1, 6 Player 1's store, 7–12 Player 2, 13 Player 2's store) each zero-padded to 2 digits — a pit can hold more than 9 seeds, unlike every other game's board here. Landing your last seed in your own store grants another turn (`nextTurn`); an empty row ends the game after the other player sweeps their remaining seeds into their store.
- **pentago**: 36 characters, one char per cell (`0`/`1`/`2`). A turn is place-then-rotate-a-quadrant, resolved locally before one commit — nothing is sent until the rotation is chosen. 5 in a row after the rotation wins; both players getting 5 at once is a draw.
- **rock-paper-scissors**: a 6-digit string (best-of, both scores, Player 1's pending hidden pick, and the last completed round's two picks). Player 1's pick genuinely rides along in the link — same tradeoff as Minesweeper's mines — the UI just never renders it until Player 2 has also picked. A tie replays the round.
- **hangman**: word length + the word + the guessed-letters bitmask in base36. The wrong-guess count isn't stored — it's derived from (word, mask). Player 1 sets the word once; every guess after that is Player 2's (`nextTurn` keeps giving it back to them).

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

## Seven new games (built from scratch)

These play by the same standard rules as the real games — no reinterpretation needed, since they're already turn-based two-player games. Notes on anything specific to the WhatsApp version:

**Reversi (Othello)**
- Standard flip-capture rules on an 8×8 board, Black opens.
- If a move leaves the opponent with no legal move, their turn is skipped automatically — you just keep playing instead of sending them an unplayable link. If neither side can move, the game ends and most discs wins.

**Checkers**
- Standard American rules: mandatory captures, forced multi-jump chains, king promotion (which always ends the chain, even mid-jump).
- A full jump chain resolves before anything is sent, so one link can represent several jumps.
- No legal move on your turn loses immediately.

**Dots and Boxes**
- 5×5 dot grid (16 boxes). Draw one line per turn; completing a box (or two at once) claims it and grants another turn.
- Most boxes when every line is drawn wins.

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

## Run locally

```bash
python -m http.server 8000
# then visit http://localhost:8000
```

To try a full game on one computer, use two browser profiles (or a normal and a private window) so each player has separate storage, and paste links between them.

## Deploy to Cloudflare Workers

The site is served by [Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/): Cloudflare serves the files straight from the repo, and [worker/index.mjs](worker/index.mjs) runs first so it can rewrite each page's Open Graph tags from the `?s=` state. That is what makes a WhatsApp preview say *"Your move · tic-tac-toe"* instead of the same generic line on every link.

```bash
npx wrangler dev --persist-to ../.wrangler-state   # http://localhost:8787
node worker/og-text.test.mjs                       # preview-text tests, no network
npx wrangler deploy
```

`--persist-to` is not optional for `dev`. The assets directory is the repo root, so wrangler watches the repo root — including the `.wrangler/` folder it writes its own state into. That state is SQLite with WAL files rewritten continuously, so the watcher reloads forever and the server accepts connections without ever answering one (measured: 978 reload cycles). `.assetsignore` does not help — it controls uploads, not watching. Persisting state outside the repo fixes it (measured: 1 reload). `wrangler deploy` watches nothing and needs no flag.

First-time setup, in order:

1. Add `wa-minigames.online` to Cloudflare (**Add a site**); it gives you two nameservers.
2. At the registrar, replace the existing nameservers with those two. This is the only irreversible-feeling step — the A records below stop being used, so keep them written down.
3. Wait for the zone to go **Active**.
4. `npx wrangler deploy`.
5. Worker → **Settings → Domains & Routes → Add custom domain** → `wa-minigames.online`. Cloudflare creates the DNS record and the certificate itself; no A records and no `CNAME` file involved.
6. In the repo's GitHub **Settings → Pages**, clear the custom domain so the two don't both claim it.

To go back to GitHub Pages: point the nameservers (or the A records) at GitHub again, per the section below. [CNAME](CNAME) and `.nojekyll` are deliberately still in the repo so that revert needs no code change.

Caching is in [_headers](_headers) — fonts and `vendor/` are immutable for a year; the site's own CSS and JS stay on ETag revalidation, because their filenames carry no content hash and a long `max-age` would strand players on a stale `game.js`. GitHub Pages allowed none of this: it serves a fixed `max-age=600`.

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
├── index.html          hub page
├── async-share.js      play-by-link: encode/decode, validation, share panel, old-link detection
├── async-share.css     share panel styles (shared tokens)
├── vendor/             lz-string 1.5.0 + its MIT license
├── fonts/              self-hosted Fira Mono (woff2) + its OFL license
├── shared.css          design tokens, @font-face, buttons, panels, light mode
├── soft.css            warm dark theme for game pages
├── manpage.css/.js     "? man" help overlay
├── gamekit.js          shared helpers (PRNG, storage, chips, etc.)
├── manifest.json       PWA manifest
├── worker/             Cloudflare Worker: per-state link previews, + its node test
├── wrangler.toml       Workers config (the assets directory is the repo root)
├── _headers            Cache-Control for static assets
├── .assetsignore       repo files that are not part of the published site
├── tic-tac-toe/        ┐
├── connect-four/       │
├── minesweeper/        ├ WhatsApp two-player + solo/AI modes (adapted from wavde/games)
├── chess/              │
├── memory/             │
├── lights-out/         ┘
├── reversi/            ┐
├── checkers/           │
├── dots-and-boxes/     ├ WhatsApp two-player + local modes (built from scratch)
├── mancala/            │
├── pentago/            │
├── rock-paper-scissors/│
├── hangman/            ┘
└── 2048/ mini-sudoku/ tango/ queens/ zip/ patches/   (unchanged solo games)
```

Each game folder is self-contained: `index.html` + `game.js`.

## License

[MIT](LICENSE). Original games © Tejas Wavde. lz-string © pieroxy, MIT ([vendor/lz-string.LICENSE](vendor/lz-string.LICENSE)). Fira Mono © The Mozilla Corporation and Telefonica S.A., SIL Open Font License 1.1 ([fonts/fira-mono.LICENSE](fonts/fira-mono.LICENSE)).
