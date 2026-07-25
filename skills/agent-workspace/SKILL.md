---
name: agent-workspace
description: Use Agent Workspace as persistent project state for meaningful multi-step work. Use whenever work spans more than a single exchange, continues something started earlier, or should survive the end of this conversation - to find the right project, read project and task context, claim a task, record progress, decisions and blockers, and hand over cleanly. Triggers on "continue the project", "what was I working on", "pick up where we left off", or any request to track, resume, or hand over work.
---

# Agent Workspace

The conversation is temporary. The agent is replaceable. The project state persists.

Agent Workspace stores structured project state so that another agent — or you in a
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

Then `tasks_claim` before beginning meaningful work. Claims are temporary leases, not
permanent assignment; they expire (30 minutes by default) and are renewed automatically
whenever you record real work. **Do not claim a task simply to inspect it.**

If `tasks_claim` returns `TASK_ALREADY_CLAIMED`, another agent holds a live lease. Pick
different work or ask the user, rather than forcing your way in.

## Progress

Use `tasks_add_progress` for meaningful milestones.

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
- Both tools replace the stored value, so include what should be kept.

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
3. Record any final meaningful progress.
4. Call `tasks_complete`.

Completion is rejected while incomplete criteria or active blockers remain. Only pass
`force: true` when a criterion is genuinely obsolete or intentionally excluded, and
always give a clear reason. Do not force completion to make a board look tidy.

## Handover

A hand-written handover document should not be necessary — the structured task state is
the handover.

Before ending work on an incomplete claimed task:

1. Record meaningful current progress.
2. Update task context if a future agent needs new working knowledge.
3. Record significant decisions.
4. Record blockers.
5. Call `tasks_release_claim` when the session is ending and no immediate continuation
   is expected.

## Tools

| Purpose | Tool |
| --- | --- |
| Find or create projects | `projects_list`, `projects_get`, `projects_create`, `projects_bootstrap` |
| Project memory | `projects_update_context`, `projects_update` |
| Find work | `tasks_list`, `tasks_get` |
| Manage work | `tasks_create`, `tasks_update`, `tasks_update_context` |
| Leases | `tasks_claim`, `tasks_release_claim` |
| Record work | `tasks_add_progress`, `tasks_add_acceptance_criteria`, `tasks_update_acceptance_criteria`, `tasks_complete` |
| Obstacles | `tasks_add_blocker`, `tasks_resolve_blocker` |
| Ordering | `tasks_add_dependency`, `tasks_remove_dependency` |
| Knowledge | `decisions_create`, `decisions_list` |
| External resources | `links_add`, `links_list`, `links_remove` |
| History | `activity_list` |

Always pass `actor` (your agent name, e.g. `claude-code`) and `session_id` so claims,
progress and decisions are attributable and your lease renews correctly.

If the MCP tools are unavailable, the same operations exist on the `aw` CLI, and every
read command supports `--json`:

```
aw project list --json
aw task list PRJ-0001 --actionable --json
aw task show TASK-0001 --json
aw task claim TASK-0001 --actor claude-code --session abc123
aw task progress TASK-0001 "Data model implemented"
```
