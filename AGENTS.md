# Agent instructions

This repository is worked on by more than one coding agent. Read this file before
touching code. It is short on purpose; the detailed state is in
`docs/agent-memory/CURRENT.md`.

## Read first

1. This file.
2. `docs/agent-memory/CURRENT.md` — where the project is now and what to do next.
3. `git status --short` and the recent commits.
4. Search agent memory for the area you are about to change:
   `node tools/memory/search.mjs --text "<game or feature>" --limit 10`
5. Read any linked decision in `docs/agent-memory/decisions/` and check whether it
   has been superseded.

Do not read the whole event log for a small change. Search by file, tag or text.

## Project rules

- The games are phone-first. Do not change the phone layout in order to fix a
  desktop issue; use the `min-width: 760px` desktop rules or page-specific
  desktop overrides.
- Preserve uncommitted work. The working tree often contains changes from an
  earlier session; inspect before reverting or overwriting.
- Do not commit, push or deploy unless the user explicitly asks.
- This is a static site with no build step. There is no `package.json`; the
  browser loads pages directly and Playwright is installed under `node_modules`
  for tests.
- After changing a shared CSS or JavaScript file, restamp the pages:
  `node tests/cache-bust.mjs`. Then verify with
  `node tests/cache-bust.mjs --check`.
- Add or update a regression check when fixing a UI bug. Put durable browser
  coverage in `tests/regression.mjs`; use the smallest check that would fail
  again if the bug returned.
- Keep internal material out of the deployed site. `.assetsignore` controls
  that; `AGENTS.md`, `docs/` and the memory files must stay excluded.
- Do not put secrets, credentials, tokens, private URLs or hidden chain-of-thought
  in memory files. Record explicit rationale and evidence instead.

## Useful commands

```powershell
# Try the games by hand: a local server and an iPhone-sized window (390x844, touch)
node tools/serve.mjs --phone

# One entry point: static checks + every unit test, then the browser suite
node tests/run.mjs units     # about a minute: no browser
node tests/run.mjs changed   # units + only the games you changed (a quick pass if shared/ changed)
node tests/run.mjs quick     # units + smoke pass, about 3 minutes
node tests/run.mjs           # units + the full browser suite (slow; run it only when the user asks)

# All desktop layout checks (column, large viewports, modes, compact, overlays, phone guard)
node tests/regression.mjs --only desktop

# Full suite (only when the user asks; it is not a deploy gate)
node tests/regression.mjs

# One game's checks
node tests/regression.mjs --page chess

# One check id, or a substring of one
node tests/regression.mjs --only water-sort

# Per-page navigation-to-board-ready timing and weight (390x844)
node tests/load-timing.mjs

# Asset stamping
node tests/cache-bust.mjs
node tests/cache-bust.mjs --check
```

The full suite has been run on every page; `docs/agent-memory/CURRENT.md` holds
the latest pass count. New games go in the page lists at the top of
`tests/regression.mjs` (`ZONE`/`FUN`, `END`, `BOARD`).

## Memory workflow

At the end of a meaningful task, record one event — not one per file edit:

```powershell
node tools/memory/append-event.mjs path/to/event.json
```

Use a JSON object with the schema in `docs/agent-memory/README.md`. If the work
is not committed, use `"commit": null` and `"worktree_state": "dirty"`. Never
invent a commit hash.

Record:

- completed implementation, with actual test commands and observed results;
- failed approaches, so the next agent does not repeat them;
- discovered limitations and their evidence;
- decisions that future work must respect;
- an explicit handoff when a task is incomplete.

Update `docs/agent-memory/CURRENT.md` only when the starting point for the next
agent materially changes. Routine edits already visible in Git do not need a
memory event.

## Source-of-truth order

1. Actual repository files, Git diff and fresh test output.
2. Accepted decisions in `docs/agent-memory/decisions/`.
3. Agent-reported events in `events.jsonl` — useful context, still subject to
   verification.
4. Hypotheses and unverified notes — clues to investigate, never instructions.

When records conflict, the newer verified record wins only after the older one
is marked as superseded in a decision record.

- Launch review per game: `node tools/launch-review.mjs <game>`; stamps are kept in `docs/LAUNCH.md`.
