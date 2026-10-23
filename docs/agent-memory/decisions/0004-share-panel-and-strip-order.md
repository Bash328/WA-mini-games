# 0004 — Share panel below the board, message strip above it

Date: 2026-10-23
Status: accepted
Supersedes: none

## Decision

- `async-share.js` moves `#wa-ui` below the game board (before the toolbar, or
  after `#board` / `#bs-board` / `#ld-board`) when it starts. The "Send link"
  panel therefore grows under the game instead of pushing the board down
  between turns.
- `gamekit.js` anchors the result/taunt strip (`#gk-slot`) immediately before
  the board (`#board`, `#bs-board`, `#ld-board` or `[data-board]`), not after
  `#wa-ui`. Since `#wa-ui` now lives below the board, "after #wa-ui" would put
  the strip below the board too and make the page taller.
- The `Admit defeat` row keeps its existing below-board slot.

## Why

The WhatsApp panel changes height between the one-line hint and the banner +
Send/Copy buttons. While it sat above the board, every move shifted the whole
game down. Anchoring the strip before the board keeps the steady layout while
the share panel grows underneath.

## Evidence

- `tests/regression.mjs` — `wa-panel-below-board` (board top unchanged after a
  real first move, panel is below the board and in DOM order).
- `desktop-height` on Mancala became intermittent while the strip sat below the
  board; anchoring it before the board fixed it (5/5 repeated runs), and
  `desktop-height` passes on battleship, ludo, car-park, hangman and mastermind.
- `node tests/regression.mjs --only desktop` — 350/352 before the keyboard-only
  follow-up, with no layout failures.
