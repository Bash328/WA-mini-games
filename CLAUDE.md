# Working in this repo

## Rule: every fixed issue gets a regression check

`tests/regression.mjs` is the list of problems that have already been found and fixed on the redesigned
("fun") game pages. **Whenever you fix an issue the user reported, add a check to that file in the same
change**, so it can never quietly come back. A check should fail on the old behaviour and pass on the fix,
and carry the issue in plain words. New fun pages go into the page lists at the top of the file (and
`END` / `BOARD` / `SOLO` if the page needs them).

Run it before telling the user something is fixed, and again before every deploy:

```
npm i --no-save playwright      # once; node_modules is git-ignored
node tests/regression.mjs       # all checks
node tests/regression.mjs --page chess --only steady
```

It serves the repo itself and drives Chrome at phone widths (320 to 430px). If a check fails because the
code moved, update the check; do not delete it. Say in your reply which new check covers the fix.

## Things that have bitten before

- Shared files (`fun.css`, `fun.js`, `gamekit.js`, `shared.css`) are linked from the fun pages with `?v=N`.
  When you change one of them, bump N on every fun page (the `cache-versions` check fails on mixed numbers).
  The host caches scripts and styles for 10 minutes and lets phones show the old copy once.
- Fun pages use the steady layout (`data-fun-zone` on `<body>`): header, one fixed message zone, the Options
  bar, then the board. The board must not move when Options opens, a status changes or a mode changes.
  `data-fun-zone="slim"` / `"mini"` shrink the zone for pages with nothing to say above the board.
- No emoji in game UI. Text symbols need U+FE0E after them or iPhones draw them as emoji (the chess pawn).
- Computer opponents wait about 0.8 to 1.3 s before moving so the page colour change can be seen.
- Wording of a status line must stay inside the turn pill's words, or the line appears and vanishes and
  the board bounces (`status-matches-pill`).
- On Windows the Bash tool chokes on long heredocs with apostrophes: write scripts with the Write tool.
- Deploy with `npx wrangler deploy`; it fails now and then on a network blip, so retry once.
