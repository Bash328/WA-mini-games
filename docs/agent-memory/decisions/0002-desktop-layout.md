# 0002 — Centred, height-aware desktop column

- Status: Accepted
- Date: 2026-10-22
- Supersedes: the earlier fixed 640px desktop cap

## Context

All games are designed phone-first. On a PC the shared wrap originally grew to
960px, which made square boards 960×960, pushed lower rows below the fold and
made pieces enormous. A fixed 640px cap fixed the width problem but tall games
still scrolled on a 1000px-high window. Computer/local modes also add a bottom
toolbar that was not present in the initial WhatsApp state.

The user wants the phone layout unchanged and the games to work well on a PC,
but has not asked for a separate desktop redesign.

## Decision

- Apply desktop changes only at `min-width: 760px`.
- Use a centred column with a height-aware wrap:
  `clamp(440px, calc(100svh - 460px), 640px)`.
- Keep Hearts and Ludo at their existing 430px columns and Battleship's battle
  mode full-bleed via `:where()` and page-specific rules.
- Give pages with an unusually tall layout or a mode-only toolbar their own
  desktop budget:
  - Crazy 8: shorter column, hide the duplicate bottom hint and in-page guide
    on desktop; keep both on phones.
  - Cribbage and Lost Cities: cap at 560px so the computer-mode score/hand row
    stays above the fold on taller windows.
  - Blokus Duo, Onitama and Quoridor: leave room for the computer/local toolbar.
- Prefer a page-specific height/width formula over shrinking the whole site to
  the shortest laptop.

## Consequences

- 1280×1000 and 1280×900 fit without vertical scrolling at rest and after mode
  changes.
- 1366×768 short screens still scroll on several games in the original pass.
  This was addressed by the compact layer below, not by changing the normal
  desktop column.
- A true desktop design using side panels or a wider table is still open. This
  decision deliberately chooses a consistent, phone-safe column rather than
  pretending that is a desktop redesign.

## Compact layer — 2026-10-23

The 1366×768 short-screen decision is now made: keep the phone-first one-column
layout, but add a compact desktop layer rather than shrinking the normal
desktop column or accepting scrolling.

- The compact layer applies only at
  `(min-width: 760px) and (max-height: 899px) and (min-height: 480px)`. Normal
  desktop above 899px is unchanged. The 480px floor excludes landscape phones
  (about 390–430px high).
- Compact wrap: `clamp(360px, calc(100svh - 368px), 440px)`; at 1366×768 the
  wrap is 400px for most games. The centred-column layout is unchanged.
- Compact chrome: 44px topbar, 8px top / 12px bottom wrap padding, 42px/36px
  message zones, 36px Options and toolbar controls, 12px hints, and a 34px
  result slot on full-zone pages.
- Page-specific compact budgets: Crazy 8 subtracts 8px from the column;
  Quoridor subtracts 47px so its computer/local undo row fits. Ludo's custom
  48px score bar is accepted as its compact topbar.
- The phone guard is explicit: `desktop-phone-guard` at 844×390 must keep the
  normal wrap padding and topbar, proving the compact layer did not leak onto a
  landscape phone.
- `desktop-column` now tests normal desktop at 1280×900;
  `desktop-overlays` tests compact overlays at 1366×768; `desktop-compact` tests
  all 57 games at 1366×768 at rest and after every non-live mode change.

### Evidence

- `node tests/regression.mjs --only desktop` — **285/285 passed**.
- `desktop-compact` — **57/57**; `desktop-phone-guard` — **1/1**.

> Historical counts: Car Park was added on 2026-10-23, bringing the site to 58
> game pages. The current counts and the larger viewport matrix are recorded in
> `docs/agent-memory/CURRENT.md`; the compact-layer rules above are unchanged.
- Twelve affected page suites — **188/188**.
- `node tests/cache-bust.mjs --check` clean after restamping 58 pages.
- 1366×768 screenshots and element bounds: Cribbage and Crazy 8 hand cards are
  fully inside their panels. See `fun.css`, `tests/regression.mjs` and the
  2026-10-23 event in `events.jsonl`.
