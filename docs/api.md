# REST API

Base path: `/api/v1`. JSON only. Bound to `127.0.0.1` by default, with no authentication in v0.1.
Binding wider (e.g. to a Tailscale interface) is opt-in — see the README's "Reaching the UI from
another device" section and `docs/architecture.md`'s security posture.

`:project`, `:task`, `:decision`, `:blocker` and `:link` accept either a human readable key
(`TASK-0042`, `task-42`) or a UUID.

Mutating requests accept optional `actor` and `sessionId` fields, which are recorded in
activity and used to match claims.

## Errors

```json
{
  "error": {
    "code": "TASK_ALREADY_CLAIMED",
    "message": "TASK-0014 is currently claimed by claude-code.",
    "details": { "task": "TASK-0014", "actor": "claude-code" }
  }
}
```

| Status | Codes |
| --- | --- |
| 400 | `VALIDATION_ERROR`, `DEPENDENCY_SELF_REFERENCE`, `DEPENDENCY_CROSS_PROJECT`, `INVALID_BOOTSTRAP_REFERENCE`, `INVALID_METADATA` |
| 404 | `PROJECT_NOT_FOUND`, `TASK_NOT_FOUND`, `BLOCKER_NOT_FOUND`, `DECISION_NOT_FOUND`, `LINK_NOT_FOUND`, `DEPENDENCY_NOT_FOUND`, `ACCEPTANCE_CRITERION_NOT_FOUND` |
| 409 | `PROJECT_ARCHIVED`, `PROJECT_HAS_CLAIMED_TASKS`, `TASK_ALREADY_CLAIMED`, `TASK_NOT_CLAIMED`, `TASK_CLAIM_MISMATCH`, `TASK_HAS_INCOMPLETE_ACCEPTANCE_CRITERIA`, `TASK_HAS_ACTIVE_BLOCKERS`, `BLOCKER_ALREADY_RESOLVED`, `ACCEPTANCE_CRITERION_ALREADY_COMPLETE`, `ACCEPTANCE_CRITERION_ALREADY_OPEN`, `INVALID_STATUS_TRANSITION`, `DEPENDENCY_CYCLE` |
| 500 | `INTERNAL_ERROR` |

## Health

```
GET /health            → { "status": "ok", "version": "0.1.0" }
GET /api/v1/health
```

## Projects

| Method | Path | Notes |
| --- | --- | --- |
| `POST` | `/projects` | `{ name, objective?, description?, context? }` → `201 { project }` |
| `POST` | `/projects/bootstrap` | Atomic plan import → `201 { project, tasks, decisions, links, refMap }` |
| `GET` | `/projects` | `?status=&search=&limit=&offset=&sort=` → `{ projects, total, limit, offset }` |
| `GET` | `/projects/:project` | → `{ project }` including context, `taskCounts`, `progress`, decisions, links, recent activity |
| `PATCH` | `/projects/:project` | `name`, `objective`, `description`, `status` |
| `PUT` | `/projects/:project/context` | `{ context }` — replaces the whole value |
| `POST` | `/projects/:project/archive` | Archived projects reject further mutations |
| `DELETE` | `/projects/:project` | `{ force? }` — permanent; see below |

`sort` accepts `updated_at_desc` (default), `updated_at_asc`, `created_at_desc`, `name_asc`.

Every project response includes:

```json
{
  "taskCounts": { "backlog": 4, "ready": 2, "inProgress": 1, "blocked": 1, "review": 0, "done": 7 },
  "taskTotal": 15,
  "progress": 0.4667,
  "lastActivityAt": "2026-07-14T21:42:03.881Z"
}
```

`progress` is `done / total`, or `null` when the project has no tasks.

## Tasks

| Method | Path | Notes |
| --- | --- | --- |
| `POST` | `/projects/:project/tasks` | `{ title, description?, context?, status?, priority?, parentTask?, acceptanceCriteria?, dependencies? }` |
| `GET` | `/projects/:project/tasks` | `?status=&priority=&actionable=&claimed=&blocked=&parent=&search=` |
| `GET` | `/tasks/:task` | Full working state |
| `PATCH` | `/tasks/:task` | `title`, `description`, `context`, `status`, `priority`, `parentTask`, `sortOrder` |
| `PUT` | `/tasks/:task/context` | `{ context }` |
| `POST` | `/tasks/:task/complete` | `{ force?, reason? }` — `reason` is required when `force` is true |
| `DELETE` | `/tasks/:task` | `{ force? }` — permanent; see below |

`status` and `priority` may be repeated: `?status=ready&status=in_progress`.

Every task response carries derived state:

```json
{
  "acceptanceCriteriaCompleted": 3,
  "acceptanceCriteriaTotal": 5,
  "acceptanceCriteriaProgress": 0.6,
  "dependencyCount": 2,
  "dependenciesComplete": false,
  "activeBlockerCount": 0,
  "linkCount": 1,
  "isActionable": false,
  "claim": null
}
```

`acceptanceCriteriaProgress` is `null` when the task has no criteria.

`GET /tasks/:task` additionally returns `project`, `acceptanceCriteria`, `dependencies`,
`dependents`, `progress`, `activeBlockers`, `resolvedBlockers`, `decisions`, `links` and the
20 most recent activity events.

Setting `status` to `done` through `PATCH` applies the full completion rules, so the board's
Done column cannot bypass acceptance criteria.

### Deleting a task

`DELETE /tasks/:task` is permanent and has no undo. It removes everything the task owns —
acceptance criteria, progress, blockers, claims, task-scoped links, dependency edges in both
directions, and the task's own activity events — and returns a summary of what went:

```json
{
  "deleted": {
    "key": "TASK-0003",
    "title": "Created in error",
    "removed": { "acceptanceCriteria": 2, "progress": 4, "blockers": 1, "links": 0,
                 "activityEvents": 17, "dependencies": 1, "dependents": 2 },
    "orphanedSubtasks": ["TASK-0009"],
    "detachedDecisions": ["DEC-0004"]
  }
}
```

Subtasks and decisions are not owned by the task, so they survive: subtasks are promoted to
top level, and task-scoped decisions fall back to project scope. A project-scoped
`task.deleted` event is written before the delete, so the deletion itself stays in the
timeline that the task's own events are leaving.

Deleting a task another agent holds an active claim on is rejected with
`TASK_ALREADY_CLAIMED` unless `force` is true.

### Deleting a project

`DELETE /projects/:project` is permanent and has no undo. Archiving is the reversible,
everyday action — it hides a project and makes it read-only. Deletion is for a project that
should never have existed (created by mistake, or during verification), and it removes
everything the project owns: every task and everything each task owns, plus the project's
own decisions, links and activity history. Database foreign keys cascade from `projects`, so
one row delete does the rest. It returns a summary of what went:

```json
{
  "deleted": {
    "key": "PRJ-0014",
    "name": "Verify mobile 1784994295929",
    "removed": {
      "tasks": 0, "acceptanceCriteria": 0, "progress": 0, "blockers": 0, "claims": 0,
      "dependencies": 0, "decisions": 0, "links": 0, "activityEvents": 2
    }
  }
}
```

A project may be deleted regardless of its status — archiving first is not required. The
only structural guard is claimed work: deleting a project with a task another agent holds an
active claim on is rejected with `PROJECT_HAS_CLAIMED_TASKS` unless `force` is true, the same
protection task deletion gives an individual claimed task.

Unlike task deletion, a deleted project has no surviving parent scope, so there is nowhere in
the workspace for a `project.deleted` event to live — deletion is not recorded in the
queryable activity timeline. The response above is the durable record for the caller, and the
server additionally writes one line to its own process log (not the database) naming the
project, actor and everything removed, as a lightweight operational trace. See the project's
recorded decision on this for the full reasoning.

The project key counter is never rolled back on delete, so a key is never reused.

## Claims

| Method | Path | Notes |
| --- | --- | --- |
| `POST` | `/tasks/:task/claim` | `{ actor, sessionId?, ttlMinutes? }` → `201 { claim, task }` |
| `POST` | `/tasks/:task/claim/renew` | Actor (and session, when both are present) must match |
| `POST` | `/tasks/:task/claim/release` | Omitting `actor` performs a forced release |

## Progress, blockers, criteria, dependencies

| Method | Path | Notes |
| --- | --- | --- |
| `POST` | `/tasks/:task/progress` | `{ content }` → `201 { progress }` |
| `GET` | `/tasks/:task/progress` | Newest first |
| `POST` | `/tasks/:task/blockers` | `{ description, requiredAction? }` → moves the task to `blocked` |
| `POST` | `/blockers/:blocker/resolve` | `{ resolution }` → `{ blocker, task }` |
| `POST` | `/tasks/:task/acceptance-criteria` | `{ criteria: string[] }` |
| `POST` | `/acceptance-criteria/:criterion/complete` | |
| `POST` | `/acceptance-criteria/:criterion/reopen` | |
| `DELETE` | `/acceptance-criteria/:criterion` | Only while incomplete |
| `POST` | `/tasks/:task/dependencies` | `{ dependsOn }` — cycles rejected |
| `DELETE` | `/tasks/:task/dependencies/:dependency` | |

## Decisions and links

| Method | Path | Notes |
| --- | --- | --- |
| `POST` | `/projects/:project/decisions` | `{ title, decision, rationale?, task?, supersedes? }` |
| `GET` | `/projects/:project/decisions` | `?task=&search=&limit=` |
| `GET` | `/decisions/:decision` | |
| `POST` | `/projects/:project/links` | A single link, or `{ links: [...] }` for a batch |
| `GET` | `/projects/:project/links` | `?task=&type=&provider=` |
| `DELETE` | `/links/:link` | |

Links are deliberately generic — `type` and `provider` are free text and no provider
behaviour is implied:

```json
{ "type": "issue", "provider": "jira", "reference": "AC-42", "metadata": { "status": "In Progress" } }
{ "type": "branch", "provider": "git", "reference": "feature/TASK-0042" }
```

`metadata` must be a JSON object; anything else is rejected with `INVALID_METADATA`.

## Activity

```
GET /projects/:project/activity?task=&eventType=&actor=&after=&before=&limit=&cursor=
```

Returns `{ events, nextCursor }`, newest first, with cursor pagination (default 50,
maximum 200). Pass the previous `nextCursor` to continue; `null` means the end.

Event payloads are structured JSON, for example `{ "from": "ready", "to": "in_progress" }`.
Context updates record only lengths, never the text.

## Bootstrap

`POST /projects/bootstrap` creates a project, its tasks, acceptance criteria, dependencies,
decisions and links in **one transaction**. If any part is invalid nothing is created, and
no identifier sequences are consumed.

```json
{
  "name": "Agent Continuity",
  "objective": "Build a persistent execution layer for AI agents",
  "context": "...",
  "tasks": [
    { "ref": "task-model", "title": "Design task model", "status": "ready" },
    { "ref": "claim-model", "title": "Design task claim model", "dependsOn": ["task-model"] }
  ],
  "decisions": [{ "title": "...", "decision": "...", "taskRef": "claim-model" }],
  "links": [{ "type": "repository", "provider": "github", "reference": "agent-continuity" }]
}
```

`ref` values exist only inside the request. The response maps them to the generated keys:

```json
{ "refMap": { "task-model": "TASK-0001", "claim-model": "TASK-0002" } }
```

Beyond the specified contract, a task may also carry `parentRef` so a plan can describe
subtasks; the tasks table has always supported hierarchy and bootstrap had no other way to
express it.

### Casing and unknown fields

The bootstrap document is the one payload shared between the snake_case MCP tool and this
camelCase REST body, so both casings are accepted: `acceptance_criteria`, `depends_on`,
`parent_ref`, `task_ref` and `session_id` are aliases for their camelCase names. An explicit
camelCase key always wins over its alias.

Every request **body** rejects unrecognised fields with `VALIDATION_ERROR`. This matters
most for bootstrap: quietly dropping a misspelled `acceptance_criteria` would leave an agent
believing it had created a task decomposition it had not. Query strings remain permissive,
since URLs legitimately carry unrelated parameters.

## Execution continuity

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/tasks/:task/heartbeat` | Silently renew the matching claim and execution liveness |
| `GET` | `/tasks/:task/execution` | Return exactly `{ execution, checkpoints, workPlan, handoff }` |
| `GET` / `POST` | `/tasks/:task/checkpoints` | List or record a structured checkpoint |
| `GET` / `PUT` | `/tasks/:task/work-plan` | Read or replace the ordered work plan |
| `PATCH` | `/tasks/:task/work-plan/:item` | Change one phase status |
| `POST` | `/tasks/:task/execution/origins` | Attach a provider-neutral execution origin |
| `GET` / `POST` | `/tasks/:task/acceptance-criteria/:criterion/evidence` | List or attach proof |
| `GET` | `/attention` | List work requiring a human or agent action |

A heartbeat never creates an activity event. Checkpoints are meaningful resume state, not
command logs. Releasing, completing or expiring a claim ends its execution and captures a
handoff from the latest checkpoint. A later claim can reclaim the task without discarding
that durable history.
