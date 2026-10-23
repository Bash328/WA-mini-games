# TODO

Last audited: 2026-10-23. Only in-progress and not-yet-done work is listed here.
Completed work lives in Git, `CHANGELOG.md`, `docs/agent-memory/` and the event
log. Last full run: 971/973 checks; the two failures were test-harness timing
flakes, hardened and rechecked.

## P1 — Correctness and confidence

- [ ] **Broader real end-to-end game-over coverage.** Mastermind is now played
  for real at 1280×900 and 1920×1080 (set code → guess → win → card), and the
  Admit defeat screen is exercised at both sizes. Still missing: real win/loss
  flows for the other local/computer games at desktop width.
- [ ] **WhatsApp share panel on other boards and live rooms.**
  `wa-panel-below-board` covers tic-tac-toe at 390px; still wanted: one tall
  board (hangman/battleship) in WhatsApp mode, and a live-room lobby check
  (which needs a running Worker).
- [ ] **Back/Home speed.** Pressed feedback, `touch-action: manipulation`, and
  back/Home navigation timing at 320 and 390 are in. Still open: tap-to-
  `pagehide` measurement, and the prefetch (or lighter shell) decision for the
  hub.

## P2 — Viewport and interaction matrix

- [ ] **Browser zoom and real Safari/iOS.** 1440×900, 1920×1080, 834×1112,
  1024×768, 1366×768, 1280×900, the 760px breakpoint and 700×600 landscape are
  now covered by checks. Browser zoom and a real iPhone/Safari pass still need a
  device.
- [ ] **Desktop keyboard shortcuts.** Mouse drag/drop, hover, Tab order, focus
  visibility and the custom Options/mode menu (Arrow/Home/End/Escape, focus
  return) are covered. Still open: each game's own keyboard shortcuts at desktop
  width (arrow play, undo/restart keys).

## P2 — Feature/content work

- [ ] **Banter tags and safe-slot picker.** The four missing per-game Commentary
  blocks (Liar's Dice, Hearts, Farkle, Backgammon) are authored and tested.
  Still open: context tags → picker with memory/pacing, then safe `{margin}` /
  `{moves}` / `{opponent}` slots (BANTER.md plan steps 3–4).
- [ ] **Crazy 8 room screens.** It still uses its private room copy in
  `crazy-8/game.js` and `#c8-room` instead of the shared `shared/multiseat.js` screens
  used by Hearts, Ludo, Farkle, Lost Cities, Cribbage and Skull.

## Blocked or needs a user decision

- [ ] **True desktop design.** The current layout is still a centred column.
  Side panels or a wider table would be a redesign; decide whether to fund it.
- [ ] **Tic-tac-toe background.** Decide whether "current player's colour" means
  the whole board, the grid lines, or only the played/last cell.
- [ ] **Admit defeat popup design.** Copy, artwork and button labels need a
  decision before the native `confirm()` is replaced.
- [ ] **Deploy and real-device checks.** Merge/deploy `claude/live-play`, switch
  pokes on, test Pig and the newer rooms on two phones, and do a real iPhone
  Safari pass.
- [ ] **Home-screen icon choice.** The shipped art is the flat cream design and
  `app-icon-and-launch-images` now matches it (the check was stale on the old
  Sunset palette). Choosing a different icon still needs the user; update
  `tools/gen-icons.py`, the manifest, the icon files and the check together.
- [ ] **Remaining online games.** Wave 2 (Checkers, Mancala, Pentago, Memory,
  Minesweeper), Chess move-generator extraction and hidden-information rooms
  (Battleship, Hangman, Mastermind). This was skipped on request.
- [ ] **Further deferred games.** Gin Rummy, Amazons, Boggle (solo daily only)
  and Shiritori.
- [ ] **Agent-memory concurrency.** Move from one JSONL writer to one file per
  event, or add a lock, only if top-level agents start writing in parallel.

- [ ] **One gear menu on every page (idea, agreed in principle, not started).** Hearts and Ludo already
  use a small gear instead of the full-width Options bar, with How to play inside its menu. Make that the
  system: the gear replaces the "?" in the header (same width, nothing squeezed at 320px), the Options bar goes
  (about 56px back for the board), the menu opens across the page column with How to play first, then mode,
  difficulty or level, New game and any page extras; keep the current mode visible as a small tag; first-visit
  rules still open by themselves. Ludo keeps its gear on its own row (its score bar fills the header). Build it
  in shared/gamekit.js + shared/fun.css behind a body flag, switch it on for Hearts, Ludo, Car Park, Chess and
  Sudoku first, then make it the default. Cost: every layout moves up ~56px, so the Options-bar checks and the
  short-screen height budgets need re-tuning, and all 58 pages want a screenshot review.

## Current rule

Phone layout first. Desktop and compact changes belong behind the existing
`min-width: 760px` rules; do not fix a desktop issue by changing the phone
formula. Run `node tests/cache-bust.mjs` after shared CSS/JS changes and keep
`docs/agent-memory/CURRENT.md` as the short next-agent state.
