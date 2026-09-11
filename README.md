# WA mini-games

Two-player mini-games you play **with a friend over WhatsApp**, one link per turn. There are no accounts and no server. Make your move, tap **Send on WhatsApp**, and your friend opens the link, moves, and sends a new link back.

**▶ Play: [wa-minigames.online](https://wa-minigames.online/)**

Forked from [wavde/games](https://github.com/wavde/games) (MIT): vanilla HTML/CSS/JS with no build step. The original nine solo games are still here, unchanged.

## WhatsApp games

| Game | Modes |
|---|---|
| [tic-tac-toe](tic-tac-toe/) | **2 players · WhatsApp** (default), vs AI |
| [connect-four](connect-four/) | **2 players · WhatsApp** (default), vs AI at 3 depths, local 2 players |
| [minesweeper](minesweeper/) | **2 players · WhatsApp** (default), solo |

Opening a shared link always switches the page to WhatsApp mode.

## How play-by-link works

1. Open a game page with no `?s=` in the URL. You get a fresh board; make the first move.
2. The page encodes the whole game into the URL and shows **Send on WhatsApp** and **Copy link**. The WhatsApp button opens `https://wa.me/?text=…` with no phone number, so you pick the contact.
3. Your friend taps the link and sees the board with your last move outlined. They move, and send a new link back.
4. When the game ends, the player who made the final move sends the result link so the other player sees how it ended.

The URL is the save file. There is no game server, lobby, or lookup.

### Link format

`?s=` holds `LZString.compressToEncodedURIComponent(JSON.stringify(state))`, with `+` swapped for `_`. That keeps links to `A–Z a–z 0–9 _ -`; a raw `+` in a query string turns into a space. lz-string is vendored in [vendor/](vendor/), so the game makes no CDN requests.

Every game shares one envelope, handled by [async-share.js](async-share.js):

```json
{ "game": "tic-tac-toe", "version": 1, "id": "k3j9x0qa", "turn": "O",
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
| `last` | Board index of the last move, used for highlighting. |

Board formats:

- **tic-tac-toe**: array of 9, row by row (`row * 3 + col`), each `"X"`, `"O"`, or `null`. Players are `"X"` (opens) and `"O"`.
- **connect-four**: flat array of 42, `row * 7 + col` with row 0 at the **top**. `0` empty, `1` Red (opens), `2` Yellow.
- **minesweeper**: `{ d, seed, first, own }`.
  - `d`: board size (`easy` 9×9 with 10 mines, `medium` 16×16 with 40, `hard` 20×20 with 80).
  - `seed`: uint32 for the mine generator.
  - `first`: index of the opening reveal; its 3×3 area is kept mine-free.
  - `own`: one character per cell, `0` hidden, `1`/`2` revealed by that player.

  Mine positions are rebuilt from `seed` + `first`, so they never appear in the link in readable form.

Typical link lengths: ~245 characters for tic-tac-toe, ~260 for Connect Four, up to ~450 for a busy hard Minesweeper board.

### Old links and refreshes

Each browser remembers (in `localStorage`) the newest move it has seen for each game `id`:

- Opening a link older than that shows **"This is an old link"**, with a button that jumps to the latest move.
- Refreshing after you've moved shows the send screen again, instead of letting you move twice.
- To play both sides on one device (or to test in a single browser), use **Opponent on this device? Play … here** on the send screen.

There is no anti-cheat: anyone can hand-edit a link. That's accepted for a casual game between friends.

## Minesweeper: two-player rules

- Players take turns revealing **one tile**. Player 1 opens, and the first reveal is always safe.
- Reveal a mine and you **lose immediately**.
- If every safe tile gets revealed, the player who opened **more tiles** wins. A flood-fill counts for whoever triggered it. Equal counts are a draw.
- There are no flags in two-player mode, since your opponent would see them.
- The board size is chosen before the first move and can't change after that.

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
├── connect-four/       ├ WhatsApp two-player + solo modes
├── minesweeper/        ┘
└── 2048/ memory/ chess/ lights-out/ mini-sudoku/ tango/ queens/ zip/ patches/   (unchanged solo games)
```

Each game folder is self-contained: `index.html` + `game.js`.

## License

[MIT](LICENSE). Original games © Tejas Wavde. lz-string © pieroxy, MIT ([vendor/lz-string.LICENSE](vendor/lz-string.LICENSE)).
