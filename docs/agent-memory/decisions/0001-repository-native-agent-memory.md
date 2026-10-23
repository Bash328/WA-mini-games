# 0001 — Repository-native agent memory

- Status: Accepted
- Date: 2026-10-22
- Supersedes: none

## Context

Agents work on this repository through a shared harness (OpenCode) with one
working tree, built-in subagents, shared tools/skills and selectable models.
Subagents get fresh context but the same files and Git history. The project also
has a large uncommitted working tree, so requiring a commit hash for every
record would block useful history.

A full memory service would add concurrency, search and operational surface
before there is evidence it is needed.

## Decision

Use a repository convention:

- `AGENTS.md` for rules and read order;
- `docs/agent-memory/CURRENT.md` for the short current state;
- `docs/agent-memory/events.jsonl` as an append-only event log;
- `docs/agent-memory/decisions/` for durable decisions;
- `tools/memory/append-event.mjs` and `search.mjs` for lightweight access.

The parent agent is the single memory writer. Subagents return handoffs; the
parent verifies and records one event. `commit` is nullable while work is
uncommitted, with `worktree_state` recording the condition.

## Consequences

- No extra service to run or secure.
- Memory is reviewable and versioned with the code.
- Append-only events keep history; `CURRENT.md` stays small enough to read every
  task.
- The team must maintain discipline: events are context, not proof. Fresh tests
  and repository state outrank them.
- If multiple top-level agents eventually write in parallel, move to per-event
  files or a lock helper. Revisit SQLite/vector search only if the log becomes
  too large to search quickly.

## Alternatives rejected

- A standalone memory service with shared search and automatic capture: too much
  operational surface for one repository and one harness.
- A vector database: unnecessary while `ripgrep`/JSONL search over a few hundred
  events is instant.
- One large narrative log: poor retrieval and it duplicates `CHANGELOG.md`.
- Making the event log authoritative over Git/tests: would let stale or guessed
  claims become instructions.
