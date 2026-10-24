# TODO

Last audited: 2026-10-24. Only in-progress and not-yet-done work is listed here.
Completed work lives in Git, `CHANGELOG.md`, `docs/agent-memory/` and the event
log. No new games for now: polish the ones we have.

Nothing open. Everything on the list is done: Back/Home and load speed, and the PC side panels (on by default for
every fun page; a page that cannot take them sets `data-no-desk` on the body).

## Current rule

Phone layout first. Desktop and compact changes belong behind the existing
`min-width: 760px` rules; do not fix a desktop issue by changing the phone
formula. Run `node tests/cache-bust.mjs` after shared CSS/JS changes and keep
`docs/agent-memory/CURRENT.md` as the short next-agent state.
