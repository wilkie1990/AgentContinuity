# Agent Continuity repository guidance

Agent Continuity is a local-first TypeScript monorepo. Keep domain rules in
`packages/core`; REST, MCP, CLI and web code are thin adapters over shared contracts and
services. The supported runtime is Node.js 24+ with the pnpm version pinned in
`package.json`.

## Persistent project work

Use the `agent-continuity` skill for meaningful tracked work that spans multiple steps or
sessions. Do not invoke it for one-off questions, trivial edits or unrelated work merely
because this repository contains Agent Continuity.

- Never query or inject workspace-wide Needs Attention at session start. Use
  `attention_list` only when the conversation is explicitly resuming, selecting or
  managing tracked work.
- When a lifecycle hook supplies a provider session identity, pass that exact value to
  Agent Continuity. Do not invent a descriptive replacement.
- Read the project and full task state before meaningful work, then prefer
  `start_work`, `report` and `handoff`. The atomic lifecycle tools are fallbacks.
- Keep durable knowledge in project/task context, choices in decisions, impediments in
  blockers and checkable proof in acceptance-criterion evidence.
- Complete criteria honestly before `tasks_complete`. On incomplete work, leave a useful
  checkpoint, update durable context, and release the claim through `handoff`.
- The optional MCP `agent` profile supports complete non-destructive agent work. Use
  `full` for destructive administration, repository maintenance and redundant low-level
  lifecycle controls.

## Repository conventions

- Search with `rg`/`rg --files` and edit files with patches.
- Preserve unrelated work in a dirty tree.
- Keep database migrations immutable. Existing migrations are `0001`–`0010`; add a new
  numbered migration for future schema changes.
- Do not infer repository identity from a process working directory. Use explicit
  project repository and execution worktree associations.
- Keep MCP operations named and typed; do not introduce a generic execute-anything
  dispatcher merely to reduce schema exposure.
- MCP must not execute arbitrary verification commands. Command execution remains a
  bounded, explicit CLI operation tied to a stored worktree.

## Verification

Run focused tests while iterating. Before handing off substantial changes, run:

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

If MCP tools or documentation changed, also run `pnpm measure:mcp` and keep
`docs/mcp-measurements.json`, README counts and MCP profile tests in sync.
