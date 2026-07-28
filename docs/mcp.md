# MCP server

The MCP server is the primary product interface. It talks to `packages/core` in-process, so
it needs no running HTTP server — only access to the SQLite database.

```bash
node apps/mcp/dist/bin.js     # or: ac mcp
```

```json
{
  "mcpServers": {
    "agent-continuity": {
      "command": "node",
      "args": ["/absolute/path/to/AgentContinuity/apps/mcp/dist/bin.js"],
      "env": { "AGENT_CONTINUITY_DATA_DIR": "~/.agent-continuity" }
    }
  }
}
```

stdout is the transport, so all diagnostics go to stderr.

## Profiles

`full` is the default compatibility and administrative profile. It exposes all **61 named,
typed tools**, including the complete atomic surface. `agent` is a measured reduced profile
with **47 named, typed tools** for complete non-destructive autonomous work: discovery,
bootstrap, durable context, planning, blockers, decisions, evidence, acceptance criteria,
collision coordination, composite start/report/handoff and task completion. It omits
destructive operations, repository maintenance and redundant low-level lifecycle controls;
no generic execute-anything dispatcher is provided.

Select a profile explicitly at server startup:

```bash
node apps/mcp/dist/bin.js --profile agent
AGENT_CONTINUITY_MCP_PROFILE=agent node apps/mcp/dist/bin.js
ac mcp --profile agent
```

Use `profile_info` in either profile to see the active selection and the exact full-profile
switch for unavailable operations. If an operation is not in the active tool list, restart with
`--profile full` or `AGENT_CONTINUITY_MCP_PROFILE=full`; the named operation remains available
there with its typed schema and audit trail.

The baseline generated from the MCP SDK's `tools/list` response is committed as
[`mcp-measurements.json`](mcp-measurements.json). It documents UTF-8 schema bytes, the
`ceil(bytes / 4)` token approximation, tool descriptions and representative workflow calls.
Regenerate it with `pnpm measure:mcp`; client hosts may lazily load tools, so these values
describe advertised-schema context rather than a universal prompt-token saving.

The measured agent profile advertises 20,262 input-schema bytes (about 5,066 tokens using
the documented approximation), compared with 25,642 bytes (about 6,411 tokens) for `full`:
a 21.0% reduction. Description bytes fall from 9,774 to 7,152. The profile is therefore a
bounded context and capability profile, not a promise that every administrative operation
is available; use `full` when an agent genuinely needs one of those operations.

## Tools

Tool names are snake case. The surface is intentionally typed and designed for
agent use rather than a mirror of every HTTP endpoint.

### Unified search

| Tool | Use |
| --- | --- |
| `profile_info` | Active profile and explicit guidance for named operations available only in `full` |
| `search` | Retrieve ranked results across projects, tasks, separate contexts, criteria, progress, decisions, blockers, criterion evidence, links and activity |

`search` requires `query` and accepts optional `project`, `task`, `type[]` and `limit`
filters. It returns source type/key, project/task scope, a highlighted snippet and relevance.
Free text is converted to quoted Unicode tokens before FTS5 MATCH, so punctuation, unmatched
quotes and words that resemble FTS operators cannot become query syntax. Activity is durable
history; use a canonical `type` filter when a removed record's historical activity should not
appear.

### Composite workflow tools

| Tool | Use |
| --- | --- |
| `start_work` | Claim eligible work or resume the caller's claim and return project context, full task state and execution resume state; optionally bind `{ repository, worktree_path, branch? }` atomically |
| `report` | Refresh liveness and optionally record phase, progress and checkpoint in one transaction |
| `handoff` | Record the required final checkpoint, create durable resume information and safely release the claim |

For a representative lifecycle with one meaningful mid-work report and one final checkpoint,
the atomic path is 9 calls (`projects_get`, `tasks_get`, `tasks_claim`,
`tasks_execution_get`, `tasks_heartbeat`, `tasks_add_progress`, `tasks_checkpoint`, a final
`tasks_checkpoint`, and `tasks_release_claim`). The composite path is 3 calls:
`start_work` → `report` → `handoff`, a 67% reduction. The named atomic tools remain available
for callers that need finer control.

`report` requires `actor` and `session_id`, and accepts optional `phase`, `progress`, and an
optional
`checkpoint` with `completed`, `working_on`, `next` and optional `uncertainty`. With no
progress or checkpoint it is a silent heartbeat and creates no activity event. `handoff`
requires that checkpoint object.

### Projects

| Tool | Use |
| --- | --- |
| `projects_list` | Identify an existing project before creating a new one |
| `projects_get` | Project details, **project context**, task summary, recent decisions, links, activity |
| `projects_create` | A new body of work without full decomposition |
| `projects_bootstrap` | Convert a conversation, plan or specification into a whole project atomically |
| `projects_update` | Name, objective, description, status |
| `projects_update_context` | Replace persistent project memory using required `expected_version`; optional `reason` records intent |
| `projects_context_history` | List bounded context-version metadata without historical content |
| `projects_context_version_get` | Fetch one historical project-context value |
| `projects_context_revert` | Copy a historical value into a new latest version |
| `projects_delete` | Permanently removes a project created in error; prefer archiving over deleting |

`projects_get` includes current context, version and character/UTF-8 byte size. History is
separate and bounded so ordinary reads never inject every old value.

### Repositories

| Tool | Use |
| --- | --- |
| `repositories_add` | Associate a project with an explicit absolute local repository root |
| `repositories_list` | List associations and live availability |
| `repositories_get` | Read one association |
| `repositories_update` | Update label/root/remote metadata or transfer primary selection |
| `repositories_remove` | Remove an unused association; `force` only cleans up ended-execution bindings |

These tools are the explicit, path-bearing surface. They canonicalize local paths and never
infer identity from MCP/server cwd. Because absolute paths are machine-specific and
sensitive, `projects_get`, `tasks_get` and ordinary execution summaries expose only a
repository key/label, optional branch and availability. Use repository/worktree tools only
when the local path is actually needed.

Generic `links_*` tools remain the right place for external repository, branch and pull
request URLs. A link is not a local repository identity.

### Tasks

| Tool | Use |
| --- | --- |
| `tasks_create` | One or several tasks, transactionally |
| `tasks_list` | Find active, ready, blocked or actionable work |
| `tasks_get` | Full working state for a task |
| `tasks_update` | Title, description, status, priority, parent |
| `tasks_update_context` | Replace persistent task memory using required `expected_version`; optional `reason` records intent |
| `tasks_context_history` | List bounded context-version metadata without historical content |
| `tasks_context_version_get` | Fetch one historical task-context value |
| `tasks_context_revert` | Copy a historical value into a new latest version |
| `tasks_claim` / `tasks_release_claim` | Temporary leases |
| `tasks_heartbeat` | Silently refresh the claim and execution; optionally set the current phase |
| `tasks_execution_get` | Execution health, checkpoints, work plan and latest handoff |
| `tasks_git_provenance_get` | Read the derived baseline, snapshot summary and touched paths for the active or most recent execution |
| `tasks_git_provenance_capture` | Append a manual read-only snapshot using only the stored worktree binding; accepts no path or cwd |
| `tasks_worktree_get` | Explicitly read the running execution's path-bearing worktree detail |
| `tasks_worktree_bind` / `tasks_worktree_unbind` | Attach/detach an explicit repository, absolute worktree and optional branch |
| `tasks_path_ownership_get` | Read the current/latest versioned path declaration and live collision advisories |
| `tasks_path_ownership_set` | Replace exact repository-relative file/directory declarations; an empty array clears the live declaration |
| `tasks_checkpoint` | Durable completed / working-on / next state at a meaningful boundary |
| `tasks_work_plan` | Set phases, inspect them, or move a phase through its status |
| `tasks_add_execution_origin` | Link the run to its provider-neutral source thread or session |
| `tasks_add_criterion_evidence` | Persist typed commit, test, file, URL, result or note evidence |
| `tasks_criterion_evidence` | Read typed and migrated legacy evidence |
| `tasks_criterion_evidence_policy` | Read, set or clear an optional completion requirement |
| `tasks_add_progress` | Meaningful milestones only |
| `tasks_add_blocker` / `tasks_resolve_blocker` | Record and clear what stops the work |
| `tasks_complete` | Enforces acceptance criteria and blockers unless forced with a reason |
| `tasks_delete` | Permanently removes a task created in error; prefer completing over deleting |
| `tasks_add_acceptance_criteria` / `tasks_update_acceptance_criteria` | Criteria are addressed by exact description or by id |
| `tasks_add_dependency` / `tasks_remove_dependency` | Cycles are rejected with the path named |

Repository-aware `start_work` and worktree binding capture the immutable Git baseline.
Checkpoint-bearing `report`, `tasks_checkpoint`, `handoff` and `tasks_complete` append
best-effort snapshots. Facts are labelled `local_git`; agent-authored progress, checkpoints
and evidence remain separate. A Git failure is returned in provenance as a structured error
and does not undo otherwise valid lifecycle state.

The Git capture tool never accepts a path or command. It uses the execution's explicit
worktree binding and runs only bounded, read-only Git inspection. Use
`tasks_git_provenance_get` after capture for the latest summary.

MCP never launches verification commands. Its evidence tools accept structured proof data
only and advertise no executable, argument-vector, timeout or cwd fields. Local command
execution is confined to the CLI described in the README.

Path ownership is advisory coordination over the exact project repository identity.
Declared exact files/directory prefixes and the latest successful observed Git paths are
compared only across live claimed executions. Same-worktree collisions are high-strength;
separate worktrees reduce immediate overwrite risk but still warn about merge risk.
Warnings never reject or revoke claims. Absolute, drive/UNC, traversal, glob and symlink
escape paths are rejected.

### Records

| Tool | Use |
| --- | --- |
| `decisions_create` / `decisions_list` | Explicit choices and their reasoning |
| `links_add` / `links_list` / `links_remove` | Generic external resources |
| `activity_list` | What changed, and what previous agents did |
| `attention_list` | Stale/interrupted runs, path collisions, expired claims, blockers, review and handoffs |

## Response design

Responses are concise, structured text rather than raw database rows. UUIDs are not
exposed. `tasks_get` renders the complete working state and ends with a recommendation:

```
TASK-0014 — Design task claim model
Project: PRJ-0001 — Agent Continuity
Status: in_progress
Priority: high
Actionable: yes
Description:
Design the temporary task claim model.
Context:
Permanent agent assignment was rejected because agents and sessions are transient.
Acceptance criteria:
[✓] Supports actor identification
[✓] Supports session identification
[ ] Defines expiry behaviour
[ ] Supports safe task reclaim
Active claim:
codex
session: abc123
expires in: 21 minutes
Progress:
- Initial lease data model designed.
- Claim renewal rules drafted.
Active blockers:
None
Dependencies:
TASK-0003 — Done
Dependents:
None
Decisions:
DEC-0007 — Claims are temporary leases
Links:
None
Recommended state:
Continue current task.
```

`Recommended state` is derived from the structured state — blocked, claimed by someone
else, actionable and unclaimed, waiting on dependencies, still in the backlog, or complete.

## Errors

Domain errors come back as `isError: true` with the code preserved as the first token, so
agents can branch on it:

```
TASK_ALREADY_CLAIMED: TASK-0014 is currently claimed by codex.
{"task":"TASK-0014","actor":"codex","expiresAt":"2026-07-14T22:03:00.000Z"}
```

Cycle errors name the path:

```
DEPENDENCY_CYCLE: Cannot add TASK-0012 as a dependency of TASK-0008 because it would
create the dependency cycle TASK-0008 → TASK-0012 → TASK-0008.
```

## Conventions

- Always pass `actor` (your agent name) and `session_id`. They attribute progress and
  decisions, and they are how a claim recognises its owner and renews itself.
- Claim before meaningful work, not to inspect.
- Heartbeat silently while working; it is liveness, not a milestone.
- Keep the work plan current and checkpoint at phase boundaries or before handoff.
- Before completion, attach available proof to each criterion and mark only proven criteria.
- On takeover, read `tasks_execution_get`; use `attention_list` to find work needing action.
- Prefer `start_work`, `report` and `handoff` for the standard lifecycle; use the atomic
  task tools when an individual operation is specifically required.
- Milestones go in progress; durable knowledge goes in context; choices go in decisions.
- Read the current context version before editing and pass it as `expected_version`. On
  `CONTEXT_VERSION_CONFLICT`, re-read and reconcile; never retry blindly. Context over
  32 KiB UTF-8 carries a soft warning, and new values over 256 KiB are rejected. Compact
  only by supplying a shorter replacement and an explicit reason.

The `agent-continuity` and `project-bootstrap` Skills encode this behaviour in full.
