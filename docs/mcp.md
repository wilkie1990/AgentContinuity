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

## Tools

Tool names are snake case. The surface is intentionally compact — 35 tools designed for
agent use rather than a mirror of every HTTP endpoint.

### Projects

| Tool | Use |
| --- | --- |
| `projects_list` | Identify an existing project before creating a new one |
| `projects_get` | Project details, **project context**, task summary, recent decisions, links, activity |
| `projects_create` | A new body of work without full decomposition |
| `projects_bootstrap` | Convert a conversation, plan or specification into a whole project atomically |
| `projects_update` | Name, objective, description, status |
| `projects_update_context` | Replace persistent project memory |
| `projects_delete` | Permanently removes a project created in error; prefer archiving over deleting |

`projects_get` includes context, so there is no separate `projects_get_context`.

### Tasks

| Tool | Use |
| --- | --- |
| `tasks_create` | One or several tasks, transactionally |
| `tasks_list` | Find active, ready, blocked or actionable work |
| `tasks_get` | Full working state for a task |
| `tasks_update` | Title, description, status, priority, parent |
| `tasks_update_context` | Replace persistent task memory |
| `tasks_claim` / `tasks_release_claim` | Temporary leases |
| `tasks_heartbeat` | Silently refresh the claim and execution; optionally set the current phase |
| `tasks_execution_get` | Execution health, checkpoints, work plan and latest handoff |
| `tasks_checkpoint` | Durable completed / working-on / next state at a meaningful boundary |
| `tasks_work_plan` | Set phases, inspect them, or move a phase through its status |
| `tasks_add_execution_origin` | Link the run to its provider-neutral source thread or session |
| `tasks_add_criterion_evidence` | Attach a test, file, result or URL to one criterion |
| `tasks_add_progress` | Meaningful milestones only |
| `tasks_add_blocker` / `tasks_resolve_blocker` | Record and clear what stops the work |
| `tasks_complete` | Enforces acceptance criteria and blockers unless forced with a reason |
| `tasks_delete` | Permanently removes a task created in error; prefer completing over deleting |
| `tasks_add_acceptance_criteria` / `tasks_update_acceptance_criteria` | Criteria are addressed by exact description or by id |
| `tasks_add_dependency` / `tasks_remove_dependency` | Cycles are rejected with the path named |

### Records

| Tool | Use |
| --- | --- |
| `decisions_create` / `decisions_list` | Explicit choices and their reasoning |
| `links_add` / `links_list` / `links_remove` | Generic external resources |
| `activity_list` | What changed, and what previous agents did |
| `attention_list` | Stale/interrupted runs, expired claims, blockers, review and handoffs |

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
- Milestones go in progress; durable knowledge goes in context; choices go in decisions.

The `agent-continuity` and `project-bootstrap` Skills encode this behaviour in full.
