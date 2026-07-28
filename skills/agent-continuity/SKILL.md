---
name: agent-continuity
description: Use Agent Continuity as persistent project state for meaningful multi-step work. Use whenever work spans more than a single exchange, continues something started earlier, or should survive the end of this conversation - to find the right project, read project and task context, claim a task, record progress, decisions and blockers, and hand over cleanly. Triggers on "continue the project", "what was I working on", "pick up where we left off", or any request to track, resume, or hand over work.
---

# Agent Continuity

The conversation is temporary. The agent is replaceable. The project state persists.

Agent Continuity stores structured project state so that another agent — or you in a
later session — can continue work without the user re-explaining anything.

Use it for meaningful multi-step work. Do not use it for one-off questions, trivial
edits, or casual conversation.

## Project discovery

Before creating a project:

1. Call `projects_list` to see what already exists.
2. Look for a project that matches the current body of work.
3. Prefer continuing an existing project when it clearly represents the same work.
4. Do not create a duplicate project simply because a new conversation has started.

If no project matches and the work is substantial, use the `project-bootstrap` skill.

## Before project work

Before meaningful work on an existing project:

1. `projects_get` — read the project objective and **project context**.
2. `tasks_list` — review current task state.
3. Identify the task the user is asking about.

When the user has not specified a task:

1. Check tasks that are already in progress (`tasks_list` with `claimed: true`).
2. Check actionable ready tasks (`tasks_list` with `actionable_only: true`).
3. Prefer high-priority actionable tasks.
4. Do not begin blocked tasks unless resolving the blocker is the work being requested.

A task is *actionable* when it is `ready`, all its dependencies are `done`, and it has
no active blockers. A ready task that is not actionable is waiting on something.

## Before task work

Call `tasks_get` and read all of it:

- Description
- Task context
- Acceptance criteria
- Dependencies
- Existing progress
- Active blockers
- Decisions
- Links

The response ends with a `Recommended state` line. Treat it as a hint, not an order.

Then prefer `start_work` before beginning meaningful work. It claims eligible work (or
resumes your existing claim) and returns the task, project context, execution state,
dependencies and blockers in one response. Use the exact provider session identity when
one was supplied. If `start_work` is unavailable, use `tasks_claim` and then
`tasks_execution_get`.

Claims are temporary leases, not permanent assignment; they expire (30 minutes by
default) and are renewed automatically whenever you record real work. **Do not claim a
task simply to inspect it.**

If `start_work` or `tasks_claim` returns `TASK_ALREADY_CLAIMED`, another agent holds a
live lease. Pick different work or ask the user, rather than forcing your way in.

## Execution continuity

Task status describes the workflow state; execution health describes whether an agent is
actually alive and making progress. Do not treat an `in_progress` task as proof that its
agent is active.

- Prefer `report` while actively working. With no progress or checkpoint it is a silent
  heartbeat; with either it atomically renews the lease and records the meaningful state.
  If `report` is unavailable, use `tasks_heartbeat`, `tasks_add_progress` and
  `tasks_checkpoint` as the corresponding atomic fallbacks.
- Record a checkpoint through `report` at meaningful phase boundaries. Include what is
  complete, what is being worked on, the next action, and genuine uncertainty.
- Use `tasks_work_plan` for an ordered implementation checklist. Mark one phase active
  and complete phases as work advances. A work plan explains *how* work proceeds;
  acceptance criteria explain *what proves it is done*.
- Use `tasks_execution_get` after taking over work, to read the latest execution,
  checkpoints, work plan, and handoff before changing anything.
- When an execution has an explicit repository/worktree binding, use
  `tasks_path_ownership_set` to declare the exact files and directory prefixes you
  expect to edit. Read `tasks_path_ownership_get` before expanding scope. Collision
  warnings are coordination advisories: contact the named execution or isolate the
  work in a separate worktree, but do not treat a warning as a failed claim.
- Attach proof to individual criteria with `tasks_add_criterion_evidence` as tests,
  files, results, or links become available. Do not wait until final completion.
- Use `attention_list` on demand when this conversation is resuming, selecting, or
  managing tracked work. Do not retrieve attention merely because a session opened;
  unrelated conversations must not inherit workspace-wide state.

## Progress

Use `report` with `progress` for meaningful milestones. If the composite is unavailable,
use `tasks_add_progress`.

Good:

- Existing implementation analysed.
- Data model implemented.
- API routes completed.
- Integration tests added.
- Primary failure scenario identified.

Bad — never record these:

- Opened file.
- Ran ls.
- Changed variable name.
- Read documentation.
- Ran one command.

Progress should help another agent understand how far the work has advanced.

## Context

Two separate stores, both persistent working memory:

- **Project context** (`projects_update_context`) — knowledge relevant across the whole
  project: constraints, scope boundaries, core assumptions, architecture, user
  preferences that affect execution.
- **Task context** (`tasks_update_context`) — knowledge specifically needed to complete
  one task: prior reasoning, rejected approaches, task-specific constraints.

Rules:

- Do not use context as an activity log. That is what progress and activity are for.
- Do not copy whole conversations into context.
- Update context when your current working knowledge changes materially.
- Both tools replace the current value and require the current context version as
  `expected_version`, so include everything that should be kept. Read the owner first,
  and if `CONTEXT_VERSION_CONFLICT` occurs, re-read and reconcile instead of retrying.
- Every replacement is immutable history. Use `projects_context_history` /
  `tasks_context_history` for bounded metadata and the targeted version-get tool only
  when old content is needed. Revert appends a new version; it never deletes history.
- Above 32 KiB UTF-8, context carries a soft bloat warning. Compact only by writing a
  shorter agent/user-authored replacement with an explicit reason. Never algorithmically
  summarize or destructively rewrite context.

## Decisions

Use `decisions_create` for meaningful choices a future agent may need to understand or
justify:

- Technology selection
- Architecture choice
- Behaviour deliberately preserved
- Product scope decision
- Rejected approach with lasting implications

A decision must record **what was decided** and **why**. Do not use decisions for
ordinary implementation progress, and do not hide explicit decisions inside context.

## Blockers

Use `tasks_add_blocker` when work cannot reasonably continue without:

- User clarification
- An external dependency
- Missing access
- Another incomplete task
- Unresolved behaviour

State the required action when you know it. The task moves to `blocked`.

Do not continue pretending a blocked task is actively progressing. When the blocker is
answered, `tasks_resolve_blocker` records the resolution and returns the task to
`in_progress` (if still claimed) or `ready`.

## Completion

Before completing a task:

1. Review the acceptance criteria.
2. Confirm each applicable criterion is genuinely complete, using
   `tasks_update_acceptance_criteria`.
3. Attach or review evidence for each criterion where evidence is available.
4. Record any final meaningful progress and checkpoint.
5. Call `tasks_complete`.

Completion is rejected while incomplete criteria or active blockers remain. Only pass
`force: true` when a criterion is genuinely obsolete or intentionally excluded, and
always give a clear reason. Do not force completion to make a board look tidy.

## Handover

A hand-written handover document should not be necessary — the structured task state is
the handover.

Before ending work on an incomplete claimed task:

1. Update task context if a future agent needs new working knowledge.
2. Record significant decisions.
3. Record blockers.
4. Prefer `handoff`, which records the final checkpoint and safely releases the claim in
   one operation.
5. If `handoff` is unavailable, use `tasks_checkpoint` followed by
   `tasks_release_claim`.

## Tools

| Purpose | Tool |
| --- | --- |
| Find or create projects | `projects_list`, `projects_get`, `projects_create`, `projects_bootstrap` |
| Project memory | `projects_update_context`, `projects_context_history`, `projects_context_version_get`, `projects_context_revert` |
| Find work | `tasks_list`, `tasks_get` |
| Manage work | `tasks_create`, `tasks_update`, `tasks_update_context`, `tasks_context_history`, `tasks_context_version_get`, `tasks_context_revert` |
| Preferred lifecycle | `start_work`, `report`, `handoff` |
| Atomic lifecycle fallbacks (full profile) | `tasks_claim`, `tasks_release_claim`, `tasks_heartbeat`, `tasks_checkpoint`, `tasks_add_progress` |
| Execution continuity | `tasks_execution_get`, `tasks_work_plan`, `tasks_path_ownership_get`, `tasks_path_ownership_set` |
| Record work | `report`, `tasks_add_acceptance_criteria`, `tasks_update_acceptance_criteria`, `tasks_complete` |
| Proof | `tasks_add_criterion_evidence` |
| Obstacles | `tasks_add_blocker`, `tasks_resolve_blocker` |
| Ordering | `tasks_add_dependency`, `tasks_remove_dependency` |
| Knowledge | `decisions_create`, `decisions_list` |
| External resources | `links_add`, `links_list`, `links_remove` |
| History | `activity_list` |
| Attention | `attention_list` |

Always pass `actor` (your agent name, e.g. `claude-code`) and `session_id` so claims,
progress and decisions are attributable and your lease renews correctly. When a
lifecycle integration supplies the provider's Agent Continuity session identity, use
that exact value rather than inventing a descriptive session id.

The optional MCP `agent` profile supports the complete non-destructive workflow above.
Use the default `full` profile for destructive administration, repository maintenance, or
the redundant atomic lifecycle controls.

If the MCP tools are unavailable, the same operations exist on the `ac` CLI, and every
read command supports `--json`:

```
ac project list --json
ac task list PRJ-0001 --actionable --json
ac task show TASK-0001 --json
ac task claim TASK-0001 --actor claude-code --session abc123
ac task progress TASK-0001 "Data model implemented"
```
