# 0005 — Repository layout: shared/, assets/, docs/

Date: 2026-10-23
Status: accepted
Supersedes: none (earlier records name the old root-level paths; read them as `shared/…` and `assets/…`)

## Decision

- Code every page loads lives in `shared/` (`shared.css`, `fun.css`, `fun.js`, `gamekit.js`,
  `async-share.*`, `live-share.js`, `multiseat.*`, `account*.js`, `manpage.js`, `taunts.js`, `ga.js`).
- Static files live in `assets/`: `fonts/`, `vendor/` (lz-string), `splash/` (iOS launch images) and `ui/`
  (the button images fun.css masks, formerly `fun/`).
- Loose project docs (`TODO.md`, `CHANGELOG.md`, `BANTER.md`) live in `docs/` with `agent-memory/`.
- The site root keeps only what browsers or hosts look for there: `index.html` (the hub), `sw.js` (scope is
  the whole site), `manifest.json`, the icons, `favicon.svg`, `og-image.png`, `robots.txt`, `sitemap.xml`,
  `_headers`, `wrangler.toml`.
- Tests that belong to one piece of code stay next to it (`worker/*.test.mjs`, `hangman/banter.test.mjs`,
  `shared/taunts.test.mjs`). `tests/` holds the cross-cutting ones: the browser suite, cache stamps, link check,
  and `tests/run.mjs`, the single entry point.
- A file nothing refers to does not stay in the repo. Scratch material goes outside it.

## Why

Fifteen shared files, four asset folders and three docs sat in the root next to 58 game folders, so nothing
showed what a page depends on. `_headers` keeps working because its `/*.css` and `/*.js` rules match any path.

## Evidence

- `node tests/links.mjs` — 2128 local references in 68 files, none broken.
- Full browser suite and all unit tests pass after the move (see the event for 2026-10-23).
- Removed as unreferenced: `assets/ui/hint.png`. Moved out of the repo: `previews/` (two untracked screenshots).
