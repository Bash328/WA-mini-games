# 0003 — Hangman: the face follows the line, and a save completes the man

Date: 2026-10-23
Status: accepted
Supersedes: none

## Decision

1. **The spoken line owns the expression.** Every line pool in
   `hangman/banter.js` maps to one of 15 faces (`FACE_BY_POOL`), and
   `faceOf(text)` resolves it. `hangman/game.js` puts that face on
   `.hm-stage[data-face]` while the bubble is showing. `data-face` overrides
   the resting `data-mood`, including its body animation, so a praise line is
   delivered with a proud face and no shiver even on the last life.
2. **A save completes the drawing.** On a win, every undrawn body part draws
   in with a short stagger, the chalk outline is hidden, the noose retracts,
   and the completed man drops to the ground with a hop, landing dust and
   sparkles. A win with zero misses therefore ends with a visible whole man
   instead of an invisible body being moved.
3. **The ending lines know how close it was.** `savedLine(history, misses)`
   uses `SAVED_INTACT` at 0 misses and `SAVED_BARELY` at 5, before the
   streak/best/returning-player pools.
4. **Reduced motion keeps the outcome, not the movement.** The complete man,
   hidden noose and final standing pose are set as static styles; no part of
   the sequence animates.

## Why

The previous face was chosen only from the miss count. That produced
contradictions the user reported: a "good work" line while the man was
shaking. The victory animation also assumed a fully drawn man, so a flawless
win moved an invisible body. Both are state-truth bugs, not decoration.

## Trade-offs

- The face data lives beside the line pools rather than in CSS selectors, so
  adding a pool requires adding its face. `hangman/banter.test.mjs` fails when
  a line has no face.
- Completing the man on a win is a small visual fiction (he was not fully
  drawn), but it reads as relief and fixes the empty-body animation. The
  alternative — moving only the drawn parts — looked like a severed head.
- The win sequence is pure CSS; the page only sets `data-mood="saved"`.

## Evidence

- `node hangman/banter.test.mjs` — 352 lines in 50 pools, every line has a
  face.
- `node tests/regression.mjs --page hangman --only hangman` — 12/12 passed,
  including `hangman-expression-match`, `hangman-win-complete`,
  `hangman-saved-pose` and `hangman-reduced-motion`.
- `docs/agent-memory/CURRENT.md` and `BANTER.md` record the new API.
