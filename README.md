# WA mini-games

Two-player mini-games you play **with a friend over WhatsApp**, one link per turn. There are no accounts and no server. Make your move, tap **Send on WhatsApp**, and your friend opens the link, moves, and sends a new link back.

**▶ Play: [wa-minigames.online](https://wa-minigames.online/)**

Forked from [wavde/games](https://github.com/wavde/games) (MIT): vanilla HTML/CSS/JS with no build step. The six original solo/logic-puzzle games are unchanged.

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
| [pig](pig/) | **2 players · WhatsApp** (default), vs computer at 3 levels, same device |

Opening a shared link always switches the page to WhatsApp mode. The last seven games above are built from scratch for this project (not adapted from wavde/games) and skip a computer mode — a same-device "local" pass-and-play mode stands in for it instead, since building a bespoke engine for each wasn't proportionate to the ask.

## Live online play (Tic-Tac-Toe, Connect Four, Reversi, Dots and Boxes, Lights Out, Rock Paper Scissors, Gomoku)

An optional mode next to WhatsApp: one player creates a room, the other opens the invite link, and moves appear instantly. Link-passing is unchanged and stays the default.

- **Server:** one Durable Object per room (`worker/live-room.mjs`) holds the authoritative state and relays moves over a hibernating WebSocket. All room logic is pure and unit-tested in `worker/live-protocol.mjs`; each game's server-side move rules live in `worker/rules/<game>.mjs` and are registered in `worker/live-games.mjs`. A game without a rules module can't be played live.
- **Client:** `live-share.js` mirrors `AsyncShare`'s controller (`show / hide / commit / newGame / canMove`), so a game adds live mode by pointing its existing link code at it. It waits for the server's echo instead of applying moves optimistically, and on every reconnect the server replays the whole state.
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
| `resigned` | `true` when `status: "won"` was reached by the loser hitting "Admit defeat (coward)" instead of playing it out. Absent (not `false`) on every ordinary move, so it costs nothing in the link until it's actually used. |

On the wire, `encode()`/`decode()` in [async-share.js](async-share.js) shrink that to single-letter keys and single-letter status codes (`g/v/i/t/b/s/w/n/l/r`, `status` → `p`/`w`/`d`) before `lz-string` compresses it — purely a transport detail, invisible to every game and to `AsyncShare.encode()`/`decode()` callers, which always use the full field names above.

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
- A grid from 3×3 up to 6×6 boxes (4×4 by default, chosen by whoever makes the first move). Draw one line per turn; completing a box (or two at once) claims it and grants another turn.
- Most boxes when every line is drawn wins.

**Gomoku**
- 15×15 board, Black opens, five or more in a row (any direction) wins; a full board is a draw. On a touchscreen the first tap previews a stone and the second tap places it. Computer: a pattern-scoring heuristic (hard also looks one reply ahead). Link, live and same-device play.

**Pig**
- Roll as often as you like adding to a turn total; a 1 loses the turn, "hold" banks it. First to 100. A whole turn is one link. The roller's browser makes the dice, so over WhatsApp it runs on trust (like Minesweeper's mines); for the same reason Pig has no live mode.

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
| `node taunts.test.mjs` | taunt pools (length, duplicates, the server's taunt count matches the lists) |
| `node worker/live-protocol.test.mjs` | the live-room rules, including taunt validation |
| `node worker/rules/wave1.test.mjs` | thousands of random games per live game, Dots and Boxes at every size |
| `node worker/rules/gomoku.test.mjs` | Gomoku rules through the real room protocol |
| `node worker/webpush.test.mjs` | push encryption against the RFC 8291 worked example, VAPID signature, allowed endpoints |
| `node worker/users.test.mjs` | username and poke rules |
| `node worker/live.integration.mjs`, `node worker/users.integration.mjs` | against a running `wrangler dev` (the second uses a fake push service and decrypts what it receives) |

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

To go back to GitHub Pages: point the nameservers (or the A records) at GitHub again, per the section below, and restore the `CNAME` file — it was deleted once Cloudflare took over the domain, so recover it with `git checkout 837ee16 -- CNAME` (it contained one line: the bare domain). `.nojekyll` is still in the repo and still needed for that path.

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
├── shared.css          design tokens, @font-face, buttons, panels, light mode, game-page theme, help overlay
├── manpage.js          "? man" help overlay
├── gamekit.js          shared helpers (PRNG, storage, chips) AND the standard page layout, taunt strip, custom select, theme toggle
├── manifest.json       PWA manifest (+ icon-*.png, apple-touch-icon.png)
├── live-share.js       live online play client (WebSocket rooms, online taunts, poke a friend)
├── account.js, account-ui.js, sw.js   username, notifications, install (see above)
├── taunts.js           every taunt line, including the computer-only pool and the online angel/devil lines
├── worker/             Cloudflare Worker: link previews, live rooms (Durable Object), + node tests
├── wrangler.toml       Workers config (the assets directory is the repo root)
├── _headers            Cache-Control for static assets
├── .assetsignore       repo files that are not part of the published site
├── tic-tac-toe/        ┐
├── connect-four/       │
├── minesweeper/        ├ WhatsApp two-player + solo/computer modes (adapted from wavde/games)
├── chess/              │
├── memory/             │
├── lights-out/         ┘
├── reversi/            ┐
├── checkers/           │
├── dots-and-boxes/     ├ WhatsApp two-player + local modes (built from scratch)
├── mancala/            │
├── pentago/            │
├── rock-paper-scissors/│
├── hangman/            │
├── battleship/         │
├── mastermind/         ┘
├── gomoku/ pig/        ← WhatsApp + computer + local (Gomoku also live)
└── 2048/ mini-sudoku/ tango/ queens/ zip/ patches/   (unchanged solo games)
```

Each game folder is self-contained: `index.html` + `game.js`.

## License

[MIT](LICENSE). Original games © Tejas Wavde. lz-string © pieroxy, MIT ([vendor/lz-string.LICENSE](vendor/lz-string.LICENSE)). Fira Mono © The Mozilla Corporation and Telefonica S.A., SIL Open Font License 1.1 ([fonts/fira-mono.LICENSE](fonts/fira-mono.LICENSE)).
