# Change log

## 2026-10-23 — review pass: fixes and a faster, stricter test run

Scope: this review session only. Nothing was committed or deployed.

- **Hearts leak fixed.** `viewFor` in `worker/card-protocol.mjs` sent every player the
  `pass` events (who passed which cards). It now sends a person only the passes they gave or got.
- **Crazy 8 online table talk fixed.** `crazy-8/game.js` still used `angel`/`devil` and `"a"`/`"d"`;
  it threw once an online game was running. It now uses `hype`/`heckle` and `"h"`/`"k"`.
- **Hearts and Ludo "How to play".** The top-bar button was hidden, so the rules could not be opened.
  The header stays as in the mockups; the button now lives in the Options popover.
- **`previews/`** added to `.assetsignore` (unused screenshots were about to be published).
- **New checks.** `online-table-talk` (all 9 multi-seat pages, faked socket serving real room views) and
  `how-to-reachable` (all 58 pages) in `tests/regression.mjs`. In `worker/card-protocol.test.mjs`: the
  Hearts pass filter, and "nobody else's hand is sent while playing" for 7 games (mutation-checked).
- **`worker/room-glue.test.mjs`** (+ `worker/cf-stub-hooks.mjs`): runs the real `CardRoom` and `LiveRoom`
  classes in plain Node with a fake Cloudflare (sockets, a store that structured-clones, a movable clock).
  52 checks: junk and oversized messages, flood limit, second-tab takeover, drops and the 90 s computer
  takeover, alarms and expiry, kill switch, table talk, resign, rematch.
- **Test runner.** `tests/regression.mjs` runs 6 checks in parallel (`--jobs N`), has `--quick`
  (2 sample pages per check), exits 1 when no check matched, and reruns a failed check once alone
  (a pass then counts as "flaky"). Full run: 1043/1043 passed, 6 flaky, 955 s.
- **Repo regrouped** (decision 0005): shared code in `shared/`, fonts/vendor/splash/ui images in `assets/`, loose docs in `docs/`. Removed the unused `assets/ui/hint.png`; moved the unreferenced `previews/` screenshots out of the repo.
- **Tests:** `tests/run.mjs` is the one entry point (units, changed, quick, full); `tests/links.mjs` checks every local link; `tools/deepseek.mjs` hands a bounded task to DeepSeek (text or diff back, nothing executed). The three viewport-matrix checks reuse one page per game (resize instead of reload: 2036 to 676 job-seconds); the test browser blocks every non-local request (it was sending Google Analytics hits for each test page).
- **Not done:** `shared/ga.js` still sends hits from localhost when a person browses locally (one-line guard, not applied).
- **Not fixed, for a decision:** Hearts and Ludo use a lone gear instead of the Options bar; Lost Cities
  hand cards show large faint colour letters; the hub card for Pig does not say Online although it is.

## 2026-10-23 — expressions, Car Park, PC fixes and full-page confidence

Scope: this session's work on top of the larger uncommitted redesign. Nothing
was committed or deployed.

### Hangman: expressions and the save

- **The face follows the line.** Every pool in `hangman/banter.js` now maps to
  one of 15 expressions (`FACE_BY_POOL`), and `faceOf(text)` resolves the spoken
  line. `hangman/game.js` puts that face on `data-face` while the bubble shows;
  it overrides the miss-count mood and its body animation. A praise line on the
  last life is delivered with a proud face and no shiver instead of "good work"
  while shaking.
- **New drawing:** raised/angry/flat brows, happy eyes, grin/smirk/flat/wail/
  small-o/wobble mouths, a blush and a tear. The idle line also makes him glance
  around, and each page-load blinks on its own rhythm.
- **Winning:** on a save he pulls the missing parts together (staggered draw),
  hides the chalk outline, retracts the noose and hops down to the ground with
  landing dust and sparkles. A flawless win now ends with a complete man instead
  of moving an invisible body. Reduced motion sets the final pose statically.
- **Ending lines:** `savedLine(history, misses)` adds `SAVED_INTACT` (0 misses,
  proud) and `SAVED_BARELY` (5 misses, saved).
- **Checks:** `hangman-expression-match` and `hangman-win-complete` added;
  `hangman-face-mood`, `hangman-saved-pose` and `hangman-reduced-motion`
  updated. `node tests/regression.mjs --page hangman --only hangman` — 12/12.
  `node hangman/banter.test.mjs` — 352 lines in 50 pools, every line has a face.

### Car Park (new game)

- New 6×6 Rush Hour puzzle at `car-park/`: 42 deterministic levels, tap/drag/
  swipe and arrow-key play, undo, reset, BFS hint, best per level, level select,
  Next level and the shared game-over card. Added to the hub and the sitemap,
  with a README section.
- `car-park/rules.js` is shared by the page and `node car-park/rules.test.mjs`;
  the test BFS-verifies every level, its exact par and the stored solution.

### Layout and interaction fixes

- **WhatsApp share panel** now sits below the board (`async-share.js`), so the
  Send/Copy panel no longer pushes the board down after the first move.
  `gamekit.js` anchors the result strip before the board (`#board`/`#bs-board`/
  `#ld-board`/`[data-board]`), because `#wa-ui` is no longer above it; this also
  removed the intermittent 6px Mancala overflow at 1280×900.
- **Back/Home** get `touch-action: manipulation`, a pressed scale and a
  `pointerdown`-driven `gk-pressed` class (Chrome can suppress `:active` once a
  link drag starts).
- **Battleship black band:** the battle page paints the html surface coral/blue
  to match the game and sets `overscroll-behavior: none`, so dragging the
  floating menu cannot reveal the shared dark canvas.
- **App icon check** now matches the shipped flat cream art and manifest
  (`#f3eee6`); the final icon choice stays a user decision.

### Coverage

- Real Mastermind set-code → guess → win → card at 1280×900 and 1920×1080; real
  Admit defeat at both sizes; desktop mouse drag/hover, menu keyboard and Tab
  order; viewports 1440×900, 1920×1080, 834×1112, 1024×768, the 760px breakpoint
  and 700×600 landscape; Car Park phone/desktop checks.
- `tests/load-timing.mjs` measures navigation-to-board-ready and script/style
  weight per page. All 58 pages are within 1200 ms / 700 KB; the slowest is
  backgammon at 443 ms / 301 KB.
- Four Commentary blocks added to `taunts.js` (Liar's Dice, Hearts, Farkle,
  Backgammon); `node taunts.test.mjs` passes.

### Checks

- `node tests/regression.mjs --only desktop` — 350/352 before the last keyboard
  fix, with no layout failures; the two failures were duplicate runs of the new
  pointer check, which passes after opening Options first. The final desktop
  result is part of the full run below.
- Targeted: hangman 12/12, battleship 8/8, mastermind 3/3, car-park 1/1,
  wa 2/2, back-home 1/1, resign-screen 1/1, app-icon 1/1, phone-landscape 10/10,
  cache-versions 58/58, hub-look 1/1.
- `node tests/cache-bust.mjs --check` is clean after restamping all 58 pages;
  `node tools/gen-sitemap.mjs --check` is up to date (59 URLs).
- Full `node tests/regression.mjs` — **971/973 passed**. The two failures were
  test-side timing flakes, not game code: `desktop-large-viewports · dominoes`
  measured 2px of scroll at 1024×768 in the loaded run and 0 on every rerun
  (the check now waits two frames and allows 2px of rounding), and
  `zip-path-glides` started sampling after the glide could finish under load
  (it now samples from before the pointer move). Each of those checks then
  passed 3/3 isolated reruns. A second full run was stopped by the user; no game
  code changed after the first full run — only those two test-hardening edits,
  the new checks (`resign-screen-desktop`, `desktop-tab-order`,
  `back-home-navigation`) and the logs.

## 2026-10-23 — short-screen compact layer

Scope: only the compact-layer work in this session. The working tree still has
the larger uncommitted redesign and game work from earlier sessions.

### Compact desktop layer

- **`fun.css`** — added a compact layer for short PC screens at
  `(min-width: 760px) and (max-height: 899px) and (min-height: 480px)`. The
  480px floor keeps landscape phones (about 390–430px high) on the phone
  layout. Normal desktop above 899px keeps the existing height-aware column.
  The compact column is `clamp(360px, calc(100svh - 368px), 440px)`; at 1366×768
  the wrap is 400px for most games. Chrome drops to a 44px topbar, 8px/12px wrap
  padding, 42px/36px message zones, 36px Options/toolbar controls and 12px
  hints. The compact layer still uses the same centred one-column layout; it is
  not a new desktop design.
- **Page-specific compact budgets** — Crazy 8 takes 8px out of its column to
  keep its 136cqw table above the fold; Quoridor takes 47px so the computer/local
  undo row also fits. Ludo keeps its custom 48px score bar, which is accepted as
  the compact topbar for that page.
- **`tests/regression.mjs`** — added `desktop-compact` at 1366×768 for all 57
  games (rest state plus every non-live mode), and `desktop-phone-guard` at
  844×390 to prove the compact layer does not leak onto a landscape phone.
  `desktop-column` now runs at 1280×900 (normal desktop),
  `desktop-overlays` at 1366×768 (compact overlays), and the phone guard is
  named `desktop-phone-guard` so `--only desktop` includes it.
- **Checks** — `node tests/regression.mjs --only desktop` passed **285/285**
  (57-page column, height, modes and compact checks plus overlays and guards).
  Twelve affected page suites passed **188/188**: crazy-8, quoridor, ludo,
  hearts, battleship, cross-sums, sudoku, backgammon, cribbage, lost-cities,
  onitama and blokus-duo.
- **Visual check** — 1366×768 screenshots were captured for cross-sums, crazy-8,
  quoridor, cribbage, chess and ludo. Measured card bounds showed Cribbage's six
  hand cards and Crazy 8's eight hand cards are fully inside their panels; the
  earlier mid-card cut was a visual misread, not clipping.
- **Cache stamps** — `node tests/cache-bust.mjs` restamped all 58 pages;
  `node tests/cache-bust.mjs --check` is clean.
- **Known limits** — the compact layer is tested at rest and after mode changes,
  not through real win/loss flows. 1440×900, tablet, browser zoom and Safari/iOS
  remain in the viewport matrix. Nothing was committed or deployed.

## 2026-10-22 — working session

Scope: only changes made during this session. The working tree already had
unrelated uncommitted edits when the session started (many game pages,
`taunts.js`, `gamekit.js`, worker files and so on); those are not listed here.

### Cross-game UI fixes

- **`tic-tac-toe/index.html`** — pressing Space/Enter on a focused square no
  longer scales the cell (and with it the thick grid-line borders). Removed the
  dashed white outline around the last move in WhatsApp/live. The white board
  background / player-colour change is documented in `TODO.md` section 16 but
  left for a decision.
- **`dots-and-boxes/index.html`** — mapped the shared `--p1`/`--p2` to the
  game's `--d-p1`/`--d-p2`, so the turn-indicator dot for Player 2 is the same
  green as the board instead of the default blue.
- **`chess/index.html`, `chess/game.js`** — replaced the computer-level
  dropdown with the same Easy / Medium / Hard chips Checkers uses. Medium is
  the default, the choice is saved under `chess:diff`, and saves from the old
  depth-valued dropdown still restore.
- **`rock-paper-scissors/game.js`** and the other link games — the top-bar
  restart clicks a hidden `#reset-btn` in WhatsApp/live mode; that button reset
  the local game and left the Admit defeat screen up. Checkers, Battleship,
  Dots and Boxes, Reversi, Pentago, Mancala, Hangman and Rock Paper Scissors now
  route that click to the link controller's `newGame()`.
- **`TODO.md`** — added section 16 for the 2026-10-22 reports (including the
  Battleship black space, Chess difficulty parity and the Admit defeat popup),
  and extended section 14 with the user-reported back-button and game-load
  timings.
- **`tests/regression.mjs`** — added checks for the tic-tac-toe last-move
  outline and press scale, the Dots and Boxes Player 2 dot colour, the Rock
  Paper Scissors retry clearing a resigned link game, and the Chess difficulty
  chips.

### PC layout pass

- **`fun.css`** — the games are phone-first, but on a PC the shared wrap grew to
  its 960 px maximum. Square boards therefore became 960 × 960, the bottom
  rows fell below the fold on a 1000 px-high window, and pieces were enormous
  (2048, chess, checkers, cross-sums, dots-and-boxes, gomoku, lights-out,
  memory, mini-sudoku, nonogram, patches, pentago, queens, quoridor, reversi,
  sliding-puzzle, sudoku, tango, tic-tac-toe, ultimate tic-tac-toe and zip).
  A desktop-only `@media (min-width: 760px)` rule now caps and centres the
  wrap. It started at a fixed 640 px and was later made height-aware (see
  below). `:where()` keeps the existing 430 px Hearts/Ludo layouts and the
  full-bleed Battleship battle view intact. Phone widths do not match the media
  query, and a before/after audit at 390 px found zero geometry changes.
- **`hangman/index.html`** — the gallows was deliberately sized at
  `min(190px, 46%)` for a phone; in the wider desktop column that looked like a
  stamp. It is 300 px from 760 px up, with the ghost layer kept the same size,
  and the speech bubble still fits beside it.
- **`tests/regression.mjs`** — added `desktop-column` (all 57 games at 1280 px:
  no sideways scroll, wrap ≤ 641 px, play area ≤ 621 px) and
  `hangman-desktop-gallows`.
- **Cache stamps** — `node tests/cache-bust.mjs` restamped `fun.css` on every
  fun page. This is why many `index.html` files show a one-line `?v=` change.
- **Audit** — all 57 games were measured at 390, 1280 and 1920 px, with
  screenshots at both desktop widths. Before: 34 boards were at least 900 px
  wide. After: the widest play area is 640 px at tall windows, and all boards
  fit the column.

### PC height, overlays and mode pass

- **`fun.css`** — the fixed 640 px cap still left chess, backgammon, cross-sums,
  sudoku, quoridor, cribbage, lost-cities and crazy-8 scrolling on a 1000 px-high
  window. The desktop wrap is now
  `clamp(440px, calc(100svh - 460px), 640px)`, with page-specific budgets for
  unusually tall layouts. At 1280×1000 and 1280×900 every game now fits at rest
  and after switching to computer/local mode.
- **`blokus-duo/index.html`, `onitama/index.html`, `quoridor/index.html`** — the
  computer/local toolbar adds a bottom row (54 px) that the initial WhatsApp
  state does not have. Each page now reserves room for it on desktop only; the
  phone formulas are unchanged.
- **`fun.css`** — Crazy 8 gets a shorter column and hides its duplicate bottom
  hint and in-page guide on a PC, where the top-bar how-to and status line
  already cover them. Phones keep both. Cribbage and Lost Cities cap at 560 px
  so their computer-mode score/hand row stays above the fold on taller windows.
- **`tests/regression.mjs`** — added `desktop-height` (1280×1000 and 1280×900 at
  rest), `desktop-modes` (every non-live mode at 1280×1000) and
  `desktop-overlays` (Options popover and synthetic game-over card at 1280 px).
  The Crazy 8 phone check now also proves the desktop-only hint/guide hiding did
  not leak to 390 px.
- **Checks** — `node tests/regression.mjs --only desktop` passed 227/227.
  Representative page suites all passed: blokus-duo 13/13, onitama 13/13,
  quoridor 15/15, crazy-8 11/11, cribbage 15/15, lost-cities 15/15, chess 21/21,
  hearts 15/15, ludo 16/16, water-sort 15/15, hangman 22/22, 2048 18/18 and
  battleship 19/19.
- **Known limit at the time** — 1366×768 short laptop screens still scrolled on
  several games (27 measured after the final caps). This was resolved by the
  compact layer in the 2026-10-23 section above.
- **Cache stamps** — `node tests/cache-bust.mjs` restamped every fun page after
  the final `fun.css` and page-style edits; `--check` is clean.

### Agent memory

- **`AGENTS.md`** — the repository rules and read order: current state, Git
  status, relevant memory search, decisions. It records the phone-first rule,
  the no-commit/no-deploy default, cache stamping, and the memory workflow.
- **`docs/agent-memory/`** — `CURRENT.md` is the short current state;
  `events.jsonl` is the append-only event history; `decisions/` holds durable
  decisions; `README.md` documents the schema and commands. The first two
  decisions cover the repository-native memory system and the desktop layout.
- **`tools/memory/`** — `append-event.mjs` validates and appends one event
  (`--check` validates the whole log); `search.mjs` searches by text, file, tag,
  type, confidence or task. Both are dependency-free Node scripts.
- **`.assetsignore`** — added `AGENTS.md`, `docs/` and `BANTER.md` so internal
  memory and notes are not published with the site.
- **`README.md`** — added a short pointer for agents to `AGENTS.md` and the
  current-state file.
- **Checks** — `node tools/memory/append-event.mjs --check` reports 4 valid
  events; `search.mjs --tag pc-layout`, `--file fun.css` and
  `--type limitation_discovered` all return the seeded records. Both scripts
  pass `node --check`.
- **Lesson recorded** — the first `search.mjs` overloaded `--file` for both the
  event-log path and the changed-file filter; passing a CSS filename made it
  parse the CSS as JSONL. It now uses `--file` only as the filter and `--log`
  for an alternate event file. The failure and fix are in the event log rather
  than only in this narrative.

### Water Sort polish

- **`water-sort/game.js`** — the pour stream is now anchored to the pouring
  glass's transformed rim instead of a point above the target. The level's hold
  position is calculated from the rotated lip, the selected tube's lift is
  accounted for, and the stream/tube timing eases in and out. The stream no
  longer looks like a line floating high above the glass.
- **`water-sort/index.html`** — hid the extra inline `.gk-undo-ico` inside the
  round Undo control. `gamekit.js` adds that icon on every page; Water Sort
  already draws its own arrow in the yellow circle, so the second, smaller
  arrow appeared below the circle — the reported "double undo". The text label
  remains, and so does the single round Undo button. Undo and Hint are the same
  height again, so their circles line up.
- **`water-sort/index.html`** — the liquid is now positioned against the tube
  itself rather than padded with percentages of the containing block. On a
  desktop-width page the grid column is wide while the tube stays 62 px, so the
  old percentage padding left the water only about 10 px wide. The layers keep
  the same 44 × 36 px size at 390, 768, 1000 and 1440 px.
- **`tests/regression.mjs`** — `water-sort-look-and-pour` now checks that the
  stream starts within 8 px of the tube's transformed lip and that exactly one
  visible Undo control/icon is present. Added
  `water-sort-water-fits-desktop`, which checks the water width, layer height
  and glass bounds at 768, 1000 and 1440 px.

### Sitemap

- **Added `sitemap.xml`** — 58 URLs: the hub plus the 57 games linked from it.
  `privacy/` is deliberately absent because that page is `noindex`.
  Absolute URLs, no `?s=` share-state links, `lastmod` taken from git. Clean
  game URLs only, so per-move links are never indexed.
- **Added `tools/gen-sitemap.mjs`** — generates the sitemap from the game cards
  on `index.html`, so it stays in sync with the hub. Reads each page's last git
  commit date for `lastmod`, skips `noindex` pages, and supports
  `--check` (exit 1 when `sitemap.xml` is stale).
- **`robots.txt`** — added `Sitemap: https://wa-minigames.online/sitemap.xml`.
- **`README.md`** — added `node tools/gen-sitemap.mjs` to the deploy snippet and
  a note that the file is generated from the hub and should be refreshed after
  adding or removing a game.

### Hub copy

- **`index.html`** — changed the intro line in `.lede` from:

  > **Play a friend over WhatsApp.** One link per move. No logins, no ads.

  to:

  > **Play a friend over WhatsApp.** One link per move, or a live online room.

  An intermediate “or play online” version was replaced in the same session;
  only the final wording exists now.

### Hangman banter

- **Added `hangman/banter.js`** — the stick man's lines and the rules for when
  he says them, moved out of the page script into a DOM-free module.
  - Grew from 19 pools / 126 inline lines to **33 pools / 264 lines**, then to
    **48 pools / 336 lines** when Splinter was built (below).
  - Expanded `BEGS` 10→22, `MANY_WRONG` 9→21, `BEGS_LAST` 6→10,
    `LAST_CHANCE` 12→20, `SAVED` 3→10, `LOSS` 12→18, plus short/long/almost
    variants.
  - New triggers: `FIRST_HIT`, `DANGER`, `ALL_VOWELS`, `NEARLY`, `ONE_LEFT`,
    `DOUBLE`, `STREAK`, `NO_VOWELS`, `SETTER_SELF`, `SETTER_HANDOFF`.
  - API: `react(state, word, mask, letter)` returns `{ text, beg }` or `""`;
    `savedLine(history)`, `lossTaunt(word, mask, history)`,
    `setterLine(word, mode, history)`, `idleLine()`, `pokeLine(misses)`.
  - Fixes: final-miss last-chance line now has priority (65% / 20% / 15% split
    with `BEGS_LAST` / `BEGS`); nudge state is committed only when its line is
    shown; planned lines win over begging; picker remembers the last 18 lines
    to prevent back-to-back repeats.
- **`hangman/game.js`** — removed the inline pools and decision logic; now calls
  the module. `MAX_WRONG` comes from the module. Added setter-comment lines
  before the first guess in both WhatsApp and same-device modes, cached per word
  so re-renders are stable. Exposed `banter` on `window.__hangmanTest`.
- **`hangman/index.html`** — loads `banter.js` before `game.js`, with a `?v=`
  cache stamp generated by `tests/cache-bust.mjs`.
- **Added `hangman/banter.test.mjs`** — pool integrity (empty/duplicate/
  over-long/emoji), first miss, final-miss priority, nudge not left pending,
  first hit, all vowels, one left, no vowels, solved-word silence, setter
  shape/mode, anti-repeat, and end-of-game lines.
- **`tests/regression.mjs`** — added `hangman-no-repeat` (consecutive misses
  cannot show the same line) and `hangman-setter-line` (the stick man comments
  after Player 1 sets a word).
- **`BANTER.md`** — appended an “Implemented — hangman expansion” section
  recording the structure, new moments, fixes and tests; added the
  `hangman/banter.js` load-time note (22 KB raw / 7.4 KB gzip, hangman only).

### Hangman stick man — Splinter

- **`hangman/index.html`** — the drawing is now a character.
  - The six parts share `<g id="man">`, every part has `pathLength="100"`, and
    `.pt.on` draws it on with `stroke-dashoffset`; the rope is separate
    (`#rope`), and a small dust puff fires at each new joint.
  - Face: eyes, pupils, brows, calm/worried/gasp/dead mouths, a sweat drop and
    X eyes. Light feature colours keep them readable on the dark page. The face
    is hidden until the head is drawn.
  - Moods: `data-mood` = `calm`, `worried`, `scared`, `terrified`, `saved` or
    `dead`, with a blink, breathing sway, flinch, poke wiggle, last-life
    shiver, saved drop + rope retract, and a limp dead pose.
  - The bubble pops with a slight overshoot, shakes gently for `beg`, and its
    tail trembles when he is terrified.
  - A faint chalk outline shows before the first miss; the ground shadow grows
    as the parts do. The gallows is a labelled, keyboard-focusable poke button
    (`aria-disabled` until the head is drawn).
  - A reduced-motion block switches off every new animation while keeping the
    face and drawn parts visible. A “The stick man” how-to section names him.
- **`hangman/game.js`** — state and behaviour.
  - `data-misses`/`data-head`/`data-mood` and the draw observer; dust puffs only
    for genuinely new parts, never on a restore or re-render.
  - Reactions on guesses, the saved/dead poses, eye tracking from the hovered
    or last key, and a poke handler (click, Enter, Space).
  - Idle lines after 15 s, then 25 s, at most two per board; cleared on a guess
    and paused while the tab is hidden.
  - `hangman:history` in `Gamekit.storage` records games, saves, losses,
    streak, best, last and a WhatsApp `lastKey` so a finished link cannot count
    twice. Personal-best, saved-streak, repeat-loss and returning-setter lines
    read from it.
  - `window.__hangmanTest` now exposes `history`, `idle`, `poke` and `mood` for
    the checks.
- **`hangman/banter.js`** — added `IDLE`, `POKE`, `POKE_SCARED`,
  `SAVED_STREAK`, `SAVED_BEST`, `SAVED_RETURN`, `LOSS_BACK`,
  `SETTER_RETURN_SELF`, `SETTER_RETURN_HANDOFF`, and six first-game
  `SETTER_FIRST_*` pools (short / mid / long × self / handoff). The first game
  introduces Splinter; later games occasionally callback to a previous save,
  best streak, loss or word.
- **`hangman/banter.test.mjs`** — expects the new pools and checks first-game
  setter lines, returning setter lines, personal-best/save-streak/repeat-loss
  selection, `idleLine()` and `pokeLine()`.
- **`tests/regression.mjs`** — new checks `hangman-face-mood`,
  `hangman-poke-idle`, `hangman-saved-pose` and `hangman-reduced-motion`;
  `open()` accepts Playwright page options for the reduced-motion case.
- **`TODO.md`** — section 15 lists all nine suggestions as built with their
  file placement; section 3 and “What is left” no longer call the stick man
  skipped.
- **`BANTER.md`** — appended the implementation notes for this phase.

### Repo plumbing

- **`.assetsignore`** — added `CHANGELOG.md` so this internal session log is
  not published with the site (it joins `README.md`, `TODO.md`, `tests/`,
  `tools/` and the rest of the repo plumbing).

### Cache stamps

- Ran `node tests/cache-bust.mjs`, which restamped `hangman/index.html` for
  `banter.js` and `game.js`. `node tests/cache-bust.mjs --check` is clean.
- The same run restamped `water-sort/index.html` for the changed `game.js` and
  brought its shared script/style stamps up to date.

### Checks run

- `node hangman/banter.test.mjs` — `banter.js ok (336 lines in 48 pools)`.
- `node taunts.test.mjs` — `taunts.js ok`.
- `node tests/regression.mjs --page hangman` - 19/19 passed. The four
  stick-man checks are `hangman-face-mood`, `hangman-poke-idle`,
  `hangman-saved-pose` and `hangman-reduced-motion`; the desktop gallows has
  its own check.
- `node tests/regression.mjs --page hangman --only hangman` - 9/9 passed.
- `node tests/cache-bust.mjs --check` - clean.
- `no-js-errors` passes on the hangman page; the WhatsApp setter branch still
  calls `setterLine(word, "self", history)` with a real history object.
- `node tests/regression.mjs --page water-sort` - 12/12 passed, including the
  new pour-to-lip alignment, single-Undo and desktop water-size assertions.
- `node tests/regression.mjs --only desktop-column` - 57/57 passed (all games
  at 1280 px).
- `node tests/regression.mjs --page chess` / `--page 2048` / `--page hearts` /
  `--page ludo` / `--page cribbage` - 18/18, 15/15, 12/12, 13/13 and 12/12.
- `node tests/cache-bust.mjs --check` - clean after the PC layout and Water
  Sort edits.
- `node --check water-sort/game.js` and `node --check tests/regression.mjs` —
  clean.

