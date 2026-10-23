# Launch ledger

Every game gets a final review before launch, one game at a time. A game is stamped only when every line
below is ticked. Nothing here is deployed by itself.

## The review (per game)

1. `node tools/launch-review.mjs <game>`: load speed at 4x slower CPU, back-button speed, no sideways scroll at
   320/390/430/1280 px, no console errors, 80 random taps, in every mode the page offers.
2. `node tests/regression.mjs --page <game>`: all checks for the page.
3. Play every mode by hand on the phone-size server (`node tools/serve.mjs --phone`).
4. Online games: a real two-page room test in `tests/regression.mjs` (like `hangman-online-two-players`).
5. Words and faces agree (games with a talking character).

## Ledger

| Game | Stamp | Date | Notes |
|---|---|---|---|
| Hangman | READY (pending the owner's hand test) | 2026-10-23 | WhatsApp, local and online modes; load 685 ms at 4x CPU, back 682 ms; 352 Splinter lines checked against faces (6 per-line face fixes, 2 lines reworded) |
