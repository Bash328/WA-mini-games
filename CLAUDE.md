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
node tests/run.mjs changed      # while working: unit tests + the games you changed
node tests/run.mjs              # before a deploy: unit tests + every browser check
node tests/regression.mjs       # the browser checks alone
node tests/regression.mjs --page chess --only steady
```

It serves the repo itself and drives Chrome at phone widths (320 to 430px). If a check fails because the
code moved, update the check; do not delete it. Say in your reply which new check covers the fix.

## Things that have bitten before

- Every script and stylesheet a fun page loads (its own `game.js` too, not only the shared files) carries
  `?v=<hash of the file>`. After changing ANY of them run `node tests/cache-bust.mjs` before testing/deploying
  (the `cache-versions` check fails when a stamp is stale). The host caches scripts and styles for 10 minutes and
  lets phones show the old copy once, so without the stamp a deployed change can silently not appear.
- Fun pages use the steady layout (`data-fun-zone` on `<body>`): header, one fixed message zone, the Options
  bar, then the board. The board must not move when Options opens, a status changes or a mode changes.
  `data-fun-zone="slim"` / `"mini"` shrink the zone for pages with nothing to say above the board.
- No emoji in game UI. Text symbols need U+FE0E after them or iPhones draw them as emoji (the chess pawn).
- Computer opponents wait about 0.8 to 1.3 s before moving so the page colour change can be seen.
- Wording of a status line must stay inside the turn pill's words, or the line appears and vanishes and
  the board bounces (`status-matches-pill`).
- On Windows the Bash tool chokes on long heredocs with apostrophes: write scripts with the Write tool.
- Deploy with `npx wrangler deploy`; it fails now and then on a network blip, so retry once.
- Motion lives in `shared/gamekit.js`: `Gamekit.popFilled(boardEl)` (a newly filled square pops) and `Gamekit.glidePieces(boardEl, sel)` (a moved piece glides). Add the one-line call to a new game; do not hand-roll a pop. All motion must skip under `prefers-reduced-motion`.
- A page that animates its win first sets `data-over-delay="ms"` on the body (the game over card waits); the card test waits for it. Puzzle pages set `data-next="Next level"` so the card offers the next puzzle.
- Opening Options must not move the board or add scrolling (`options-opens-without-moving` checks every page). Anything inside the popover is absolutely positioned.
- A board measured from absolute children (walls, paths, overlays) must subtract the frame: use `clientLeft/clientTop` (zip, tango, patches had this bug).
- Online games share one rules file between the page and the Worker (`<game>/rules.js` + `worker/rules/<game>.mjs`); a game where dice are rolled needs the `stamp` hook so the server rolls.
- Visible cells that are buttons need their page selector to beat shared/fun.css (an id prefix or `html body.fun.g-<game>`): shared/fun.css gives every button a fill, padding and a chunky bottom shadow.

