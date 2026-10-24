# Current state

Last updated: 2026-10-24
Last verified: 2026-10-24
Worktree: branch `polish-2026-10-24` (committed once mid-session, then more work; see `git log`). Not pushed. `main` still has the 2026-10-24 morning commit.

## What this is

A static collection of 58 phone-first browser games plus a hub, shared UI
(`shared/fun.css`, `shared/gamekit.js`, `shared/shared.css`) and a Cloudflare Worker for online rooms.
There is no build step. Pages are served directly; Playwright under
`node_modules` drives the browser checks.

## Current priority

The compact PC layer, the WhatsApp share-panel shift, the desktop back/Home
feedback, the Battleship overscroll band, Car Park and the Hangman expression
pass are done. The every-page regression has been run; its only two failures
were test-side timing flakes, now hardened and rechecked.

Recently verified:

- **2026-10-24 (later) session.** See `docs/CHANGELOG.md` ("PC side panels everywhere, Worker only for pages, offline storage, hub sprite, accessibility"). Things the next agent must know: pages go through the Worker, **static files do not** (`run_worker_first` array; caching is in `_headers`; never load a script or style without `?v=`); `sw.js` stores pages and files on phones and has a kill switch (`SW_KILL` in `wrangler.toml`, or `CACHING` in `sw.js`); the hub art is in `assets/hub-art.svg` and was only checked in Chrome; side panels are on by default (`data-no-desk` opts out); wrangler and node fetch on this PC need `NODE_OPTIONS="--dns-result-order=ipv4first --no-network-family-autoselection"`. The to-do list is empty.

- **2026-10-24 session.** Phone-video fixes (Car Park drag, Tic-Tac-Toe twitch, Ludo hops/replay/stuck roll/slate blue, Water Sort pour, Hearts trick cards and side stacks, 2048 merge), Battleship bot cannon and PC column, one shared dice roll (`Gamekit.rollDice`) in six games, Pig renamed Greed (URL unchanged), and the audit fixes (Skull rematch, poke push failure, body size, lookup rate limit, Worker de-duplication, preview-title test). Units 47/47; browser checks for every changed page passed; full suite not run. See `docs/CHANGELOG.md` (2026-10-24).
- **Flow Free's board no longer clips on Safari.** `.ff-inner` used `height: 100%`; WebKit resolved it against the board's border box, so the grid was 20px taller than the content box and the bottom row was clipped. It now uses `height: auto; aspect-ratio: 1 / 1`. `--only flow-free-board` — **1/1**; `--page flow-free` — **17/17**; `node tests/run.mjs changed` — **200/200** browser checks and **47/47** unit files. WebKit checked at 390×664, 390×844, 375×667, 320×568 and 430×932 on medium and hard boards. See `docs/CHANGELOG.md` (2026-10-23 late).
- **Game-over Home buttons are one solid orange.** The shared `.gk-over .home` and Crazy 8's `.c8-over .home` both use `#e07a5f` with a `0 5px 0 #a8543e` lip; the old shared chip was see-through and Crazy 8's was red. `node tests/regression.mjs --only home-buttons-orange` — **1/1**; `--page chess` — **35/35**; `--page crazy-8` — **16/16**; `node tests/run.mjs changed` — **200/200** browser checks and **47/47** unit files; cache stamps and links clean. See `docs/CHANGELOG.md` (2026-10-23 late).
- **One hint a puzzle, one hint look.** Tango, Letter Boxed and Word Ladder
  joined the other hint games: one hint per puzzle, reset keeps it spent, a new
  puzzle gets its own, and resume persists/clamps it. Every hint button now uses
  Flow Free's amber action style. `node tests/regression.mjs --only one-hint` —
  **4/4**; the hint pages' suites all passed; `node tests/run.mjs changed` —
  **199/199** browser checks (one flaky `zip-path-glides` passed alone). The one
  unit failure was the existing Cross Sums hard-puzzle time check (2020 ms vs
  2000 ms), which passed isolated (1018 ms). See `docs/CHANGELOG.md`
  (2026-10-23 late).
- `node tests/regression.mjs --page hangman --only hangman` — **12/12 passed**
  (old checks plus `hangman-expression-match`, `hangman-win-complete`).
- `node hangman/banter.test.mjs` — **352 lines in 50 pools**, every line has a
  known face.
- `node tests/regression.mjs --only battleship` — **8/8**, including
  `battleship-no-black-overscroll`.
- `node tests/regression.mjs --only mastermind` — **3/3**, including the real
  set-code → guess → win → card flow at 1280×900 and 1920×1080.
- `node tests/regression.mjs --only car-park` — **1/1**; `node
  car-park/rules.test.mjs` — **25 passed** over 42 BFS-verified levels.
- `node tests/regression.mjs --only wa-` — **2/2**; `--only back-home` — 2/2;
  `--only resign-screen` — 1/1; `--only desktop-tab-order` — 1/1;
  `--only app-icon` — 1/1; `--only phone-landscape` — **10/10**.
- `node tests/cache-bust.mjs --check` — clean, **58/58** pages; `hub-look` 1/1;
  `node tools/gen-sitemap.mjs --check` — up to date, 59 URLs.
- `node tests/load-timing.mjs` — **58 pages** within the 1200 ms / 700 KB
  budget at 390×844; slowest is backgammon (443 ms, 301 KB).
- Full `node tests/regression.mjs` — **971/973**. `desktop-large-viewports ·
  dominoes` saw 2px of rounding scroll at 1024×768 in the loaded run (0 on every
  rerun) and `zip-path-glides` sampled after the glide under load. Both checks
  were hardened (two-frame wait + 2px tolerance; sampling starts before the
  pointer move) and passed 3/3 isolated reruns. A second full run was stopped by
  the user; no game code changed after the first run.
- `node tests/regression.mjs --only desktop` — the last completed desktop pass
  was 350/352, with only the two duplicate pointer-keyboard runs failing; after
  opening Options first, that check passes. `desktop-large-viewports` and
  `phone-landscape-700` pass on their own.
- `node shared/taunts.test.mjs` — passes with the four new per-game blocks.

The normal desktop rule is in `shared/fun.css` under `@media (min-width: 760px)`: the
wrap is `clamp(440px, calc(100svh - 460px), 640px)`, with page-specific budgets
for Crazy 8, Cribbage, Lost Cities, Blokus Duo, Onitama and Quoridor.

The compact layer is a second block at
`(min-width: 760px) and (max-height: 899px) and (min-height: 480px)`. It uses
`clamp(360px, calc(100svh - 368px), 440px)`, trims the topbar, message zone,
Options row, toolbars and hints, and keeps the one-column layout. Crazy 8
subtracts 8px and Quoridor 47px from its compact column. The 480px height floor
keeps landscape phones on the phone layout. Phone widths do not match the
760px queries at all.

## Play-test pass (2026-10-23, evening)

Full report: `PLAYTEST.md` (summary table, per game details, files changed, ranked recommendations).

- Every game except Hangman was played and swept; all are APPROVED WITH NOTES, none NOT APPROVED. Link games reject unreachable positions (table `FORGED` in `tests/regression.mjs`).
- **Test rule:** the full suite is run only when the user asks. Before saying something is fixed run `node tests/run.mjs changed`; a deploy does not wait for the full suite.
- **Line endings:** `.gitattributes` forces LF. If `node tests/cache-bust.mjs --check` ever reports every page stale after a pull or merge, the checkout turned files into CRLF; convert them back to LF and run `node tests/cache-bust.mjs`.
- **New shared pieces:** `Gamekit.ask()` (the site's own question card, `.gk-ask`), `tools/playtest.mjs`, `assets/launch-image.png` as the single source of the 19 launch images.
- **Open decisions:** Lights Out two-player fairness (the scramble decides the winner); secrets readable in Battleship / Rock-Paper-Scissors / Memory / Minesweeper links; Zip puzzles never unique; small tap targets on big boards.
- Last full run: 1110/1110 browser checks, 47/47 unit files (one flaky Dominoes check passed on rerun).

## What was added this session

1. **Hangman faces and the save sequence.** `hangman/banter.js` maps every line
   pool to one of 15 expressions; `hangman/game.js` sets `data-face` from the
   spoken line; CSS gives each face its mouth/brows/eyes and body language. A
   praise line no longer arrives while he is shaking. On a save he pulls the
   missing parts together, the noose retracts, and he drops to the ground with
   a hop. `savedLine(history, misses)` adds `SAVED_INTACT` and `SAVED_BARELY`.
   See `docs/agent-memory/decisions/0003-hangman-expressions.md`.
2. **Car Park.** A 6×6 Rush Hour puzzle with 42 BFS-verified levels,
   `car-park/rules.js`, drag/tap/keyboard play, undo, hint, best per level and a
   hub card. `node car-park/rules.test.mjs` checks every level and its exact
   par. README and sitemap updated.
3. **Share panel and strip order.** `shared/async-share.js` parks `#wa-ui` below the
   board; `shared/gamekit.js` anchors `#gk-slot` before the board so the strip does not
   add page height. See decision 0004.
4. **Interaction polish.** `.topbar .back` and `.gk-over .home` get
   `touch-action: manipulation` and a pressed class from `pointerdown` because
   Chrome can suppress `:active` once a link drag starts. Battleship paints the
   html surface coral/blue in battle mode and disables overscroll bounce.
5. **Coverage.** Real Mastermind and resign flows at 1280/1920; viewports
   1440×900, 1920×1080, 834×1112, 1024×768, the 760px breakpoint and 700×600
   landscape; desktop mouse drag/hover and menu keyboard; per-page load timing;
   Car Park; icon/manifest check aligned with the shipped cream art.
6. **Banter content.** Liar's Dice, Hearts, Farkle and Backgammon now have
   Commentary blocks; the tag/picker work remains in TODO.

## What is left

`docs/TODO.md` is the source of truth. In short: cover real game-over flows for more
games, check the share panel in the remaining modes and live rooms, decide on
hub prefetch, test browser zoom/real Safari, finish the desktop keyboard
shortcuts, build the Banter tag/picker, and port Crazy 8 to the shared multiseat
screens. Design decisions and external-device work are separated as blocked.

## Do not break

- The phone layout. Desktop fixes belong behind `min-width: 760px` or in a
  page-specific desktop override. The compact layer also requires
  `min-height: 480px` so a landscape phone is excluded.
- Hearts and Ludo's existing 430px columns, Battleship's full-bleed battle view,
  and Ludo's custom 48px compact score bar. `:where()` and page rules keep these
  exceptions.
- The compact column budgets: Crazy 8 is 8px narrower, Quoridor 47px narrower.
  Changing one without re-running `desktop-compact` will bring back the 8px/21px
  mode overflow.
- The share panel belongs below the board and `#gk-slot` belongs above it
  (decision 0004). Moving either back makes the board jump or the page taller.
- Hangman's `data-face` must stay line-driven, not miss-count-driven; the
  last-life praise check depends on it.
- Hints are one per puzzle: a reset must not re-arm one, and a new puzzle must.
  `#hint-btn` (and chess's `#puz-hint`) use the shared amber style in
  `shared/fun.css`; Car Park and Water Sort override it with their round
  reference buttons, so do not flatten those.
- The asset stamps. Run `node tests/cache-bust.mjs` after shared CSS/JS changes.
- Table Talk is shelved: `window.TABLE_TALK = false` in `shared/taunts.js`. The
  live-room UI (`shared/live-share.js`, `shared/multiseat.js`, `crazy-8/game.js`)
  returns early and ignores incoming taunts. The lines, UI and Worker protocol
  are retained; flip the flag to `true` to re-enable the feature.
- Car Park's `rules.js` is shared by the page and its node test. New levels must
  be BFS-verified and their `best` must be the exact minimum.
- Uncommitted work from earlier sessions. Inspect `git status` before editing.

## Start here

```powershell
git status --short
node tests/regression.mjs
node tests/cache-bust.mjs --check
node tests/load-timing.mjs
```

Then read the relevant decision in `docs/agent-memory/decisions/` and the
specific backlog item in `docs/TODO.md`. Do not commit or deploy unless the user asks.
