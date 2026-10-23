# Agent memory

This folder is the shared memory for coding agents working on this repository.
It is deliberately repository-native: no server, database or vector index.

## Files

| File | Purpose |
|---|---|
| `CURRENT.md` | Concise current state and next starting point |
| `events.jsonl` | Append-only history of verified work, failures and handoffs |
| `decisions/` | Durable decisions and their trade-offs |
| `../../AGENTS.md` | Rules every agent follows |

Git remains the authoritative record of code. Memory records why the code
changed, what was observed, and what the next agent must not repeat.

## Event schema

Every line in `events.jsonl` is one JSON object.

```json
{
  "schema_version": 1,
  "event_id": "evt_20261022_example_01",
  "timestamp": "2026-10-22T21:43:37.000Z",
  "task_id": "TASK-PC-001",
  "agent": { "role": "implementer", "session_id": "session-abc" },
  "type": "implementation_completed",
  "summary": "Short, factual statement of what happened",
  "reason": "Why it was needed",
  "files_changed": ["fun.css", "tests/regression.mjs"],
  "decisions": ["Reuse the existing desktop breakpoint"],
  "tests": [
    { "command": "node tests/regression.mjs --only desktop", "result": "passed", "details": "227/227" }
  ],
  "known_issues": ["Short screens still scroll"],
  "commit": null,
  "worktree_state": "dirty",
  "confidence": "verified",
  "tags": ["pc-layout", "desktop"],
  "evidence": ["fun.css", "tests/regression.mjs"],
  "supersedes": []
}
```

Required fields: `schema_version`, `event_id`, `timestamp`, `task_id`, `type`,
`summary`, `reason`, `confidence`.

Allowed `type` values:

- `implementation_completed`
- `bug_discovered`
- `bug_fixed`
- `approach_rejected`
- `decision_made`
- `test_failed`
- `handoff_created`
- `limitation_discovered`
- `commit_recorded`

Allowed `confidence` values:

- `verified` — repository state or tests were actually inspected/run
- `reported` — another agent or person reported it; not independently checked
- `hypothesis` — a clue, not a fact

`commit` may be `null` while work is uncommitted. Never invent a hash. Use
`worktree_state` (`clean`, `dirty` or `unknown`) alongside it.

## Adding an event

```powershell
node tools/memory/append-event.mjs path/to/event.json
```

The script fills in `event_id` and `timestamp` when omitted, rejects invalid
types/confidence, and refuses duplicate ids. It appends one line.

Do not append routine file edits. Record decisions, verified fixes, failed
approaches, limitations and handoffs.

## Searching

```powershell
node tools/memory/search.mjs --text "water sort"
node tools/memory/search.mjs --file fun.css --limit 10
node tools/memory/search.mjs --tag pc-layout
node tools/memory/search.mjs --type limitation_discovered
node tools/memory/search.mjs --text "desktop" --json
```

Results are newest first. `--file` filters records by changed/evidence path;
use `--log <path>` to search a different event file. Search reads the whole
JSONL file, which is fine at this repository's size.

## Decisions

A durable decision gets a numbered Markdown file in `decisions/` and is linked
from events. Mark a decision `superseded` in its header when it is replaced;
do not silently rewrite history.

## Single writer

The parent agent is the memory writer. Subagents return a concise handoff and
the parent records one event after verifying the result. This avoids concurrent
appends. If several top-level agents later run in parallel, switch to one file
per event or add a lock helper.
