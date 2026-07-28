# REST API

Base path: `/api/v1`. JSON only. Bound to `127.0.0.1` by default, with no authentication in v0.1.
Binding wider (e.g. to a Tailscale interface) is opt-in — see the README's "Reaching the UI from
another device" section and `docs/architecture.md`'s security posture.

`:project`, `:task`, `:repository`, `:decision`, `:blocker` and `:link` accept either a human readable key
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
| 400 | `VALIDATION_ERROR`, `REPOSITORY_PATH_INVALID`, `DEPENDENCY_SELF_REFERENCE`, `DEPENDENCY_CROSS_PROJECT`, `INVALID_BOOTSTRAP_REFERENCE`, `INVALID_METADATA` |
| 404 | `PROJECT_NOT_FOUND`, `TASK_NOT_FOUND`, `REPOSITORY_NOT_FOUND`, `EXECUTION_WORKTREE_NOT_BOUND`, `BLOCKER_NOT_FOUND`, `DECISION_NOT_FOUND`, `LINK_NOT_FOUND`, `DEPENDENCY_NOT_FOUND`, `ACCEPTANCE_CRITERION_NOT_FOUND` |
| 409 | `PROJECT_ARCHIVED`, `PROJECT_HAS_CLAIMED_TASKS`, `REPOSITORY_ALREADY_ASSOCIATED`, `REPOSITORY_IN_USE`, `EXECUTION_NOT_RUNNING`, `EXECUTION_OWNERSHIP_MISMATCH`, `GIT_PROVENANCE_MISMATCH`, `TASK_ALREADY_CLAIMED`, `TASK_NOT_CLAIMED`, `TASK_CLAIM_MISMATCH`, `TASK_NOT_ACTIONABLE`, `TASK_HAS_INCOMPLETE_ACCEPTANCE_CRITERIA`, `TASK_HAS_ACTIVE_BLOCKERS`, `BLOCKER_ALREADY_RESOLVED`, `ACCEPTANCE_CRITERION_ALREADY_COMPLETE`, `ACCEPTANCE_CRITERION_ALREADY_OPEN`, `INVALID_STATUS_TRANSITION`, `DEPENDENCY_CYCLE` |
| 422 | `REPOSITORY_PATH_UNAVAILABLE` |
| 500 | `INTERNAL_ERROR` |

## Health

```
GET /health            → { "status": "ok", "version": "0.1.0" }
GET /api/v1/health
```

## Unified search

```
GET /api/v1/search?q=provenance
GET /api/v1/search?q=provenance&project=PRJ-0026&task=TASK-0040&type=decision&type=progress&limit=20
```

One read searches project/task fields, separate project/task contexts, acceptance criteria,
progress, decisions, blockers, criterion evidence, links and activity. `project`, `task` and
repeatable `type` filters are optional; `limit` defaults to 20 and is bounded to 100.
Supported types are:

`project`, `project_context`, `task`, `task_context`, `acceptance_criterion`, `progress`,
`decision`, `blocker`, `criterion_evidence`, `link`, and `activity`.

```json
{
  "query": "provenance",
  "limit": 20,
  "results": [
    {
      "sourceType": "decision",
      "sourceId": "f14dcbd6-174f-4083-905a-56f4689d23c1",
      "sourceKey": "DEC-0051",
      "projectId": "0c81036a-5f9b-4b84-8d1e-0aa7bd18dbd4",
      "projectKey": "PRJ-0026",
      "taskId": "c2dfaaf0-0559-4724-b73c-81ccee25a300",
      "taskKey": "TASK-0040",
      "title": "DEC-0051 — Separate derived Git inspection from provenance state",
      "snippet": "Persist one immutable local_git baseline …",
      "score": 0.000004,
      "createdAt": "2026-07-27T17:50:49.906Z",
      "updatedAt": "2026-07-27T17:50:49.906Z"
    }
  ]
}
```

Input is normalized into at most 32 quoted Unicode word/number tokens. Punctuation and
strings such as `OR`, `NEAR`, parentheses or unmatched quotes are searched literally as
tokens rather than forwarded as FTS syntax; an all-punctuation query returns no results.
Tokens use prefix matching and are combined with AND. Relevance uses weighted FTS5 BM25
(stable key, title, then body), followed by deterministic type/key/id tie-breaking. Higher
response scores are more relevant.

Canonical rows remain the source of truth. Their derived search documents and FTS rows are
rebuilt inside the same SQLite transaction as the mutation. Replacing context removes the
old context document, task/project cascades remove owned documents, and task deletion
reindexes decisions that fall back to project scope. Append-only activity remains searchable
history, so a deleted canonical record's old term may still appear in the historical activity
that recorded its creation or removal; filter by canonical source type when current-state-only
retrieval is required.

The typed client exposes the same operation as `client.search(query)`. The CLI equivalent is:

```bash
ac search provenance --project PRJ-0026 --type decision --type progress --limit 20
```

## Projects

| Method | Path | Notes |
| --- | --- | --- |
| `POST` | `/projects` | `{ name, objective?, description?, context? }` → `201 { project }` |
| `POST` | `/projects/bootstrap` | Atomic plan import → `201 { project, tasks, decisions, links, refMap }` |
| `GET` | `/projects` | `?status=&search=&limit=&offset=&sort=` → `{ projects, total, limit, offset }` |
| `GET` | `/projects/:project` | → `{ project }` including context, `taskCounts`, `progress`, decisions, links, recent activity |
| `PATCH` | `/projects/:project` | `name`, `objective`, `description`, `status` |
| `PUT` | `/projects/:project/context` | `{ context, expectedVersion, reason? }` — appends a version and replaces the current projection |
| `GET` | `/projects/:project/context/versions` | Bounded metadata-only history; `?limit=20&beforeVersion=` |
| `GET` | `/projects/:project/context/versions/:version` | One historical version including nullable content |
| `POST` | `/projects/:project/context/revert` | `{ targetVersion, expectedVersion, reason? }` — copies history into a new current version |
| `POST` | `/projects/:project/archive` | Archived projects reject further mutations |
| `DELETE` | `/projects/:project` | `{ force? }` — permanent; see below |

`sort` accepts `updated_at_desc` (default), `updated_at_asc`, `created_at_desc`, `name_asc`.

Every project response includes:

```json
{
  "taskCounts": { "backlog": 4, "ready": 2, "inProgress": 1, "blocked": 1, "review": 0, "done": 7 },
  "taskTotal": 15,
  "progress": 0.4667,
  "contextVersion": 3,
  "contextSize": { "characters": 12400, "bytes": 12518, "overSoftLimit": false },
  "lastActivityAt": "2026-07-14T21:42:03.881Z"
}
```

## Versioned context

Project and task context remain free-form Markdown held in the owning row as the efficient
current projection. Every non-null initial context and every later replacement also creates
an immutable version. Empty string is an explicit version; null means no current context.

Existing context writes require `expectedVersion`. The projection is updated with an
optimistic compare-and-swap; a stale writer receives `409 CONTEXT_VERSION_CONFLICT` with
`expectedVersion` and `currentVersion` and no sibling mutation commits. Revert never moves a
pointer backwards or deletes history: it copies `targetVersion` into a new latest version.

Ordinary project/task reads include only current `context`, `contextVersion` and
`contextSize`. History lists are newest-first, metadata-only, default to 20 and cap at 100;
use the targeted version endpoint when historical content is actually needed.

Both thresholds use UTF-8 bytes while responses also report Unicode-character counts. Writes
above 32 KiB succeed with `overSoftLimit: true`; writes above 256 KiB fail with
`413 CONTEXT_TOO_LARGE`. Compaction is a caller-authored shorter replacement with a reason,
never an algorithmic rewrite. Unified search indexes only the current context projection.

`progress` is `done / total`, or `null` when the project has no tasks.

## Repositories and execution worktrees

Repository identity is explicit and project-scoped. No API derives a repository or worktree
from the server process cwd. Absolute paths are machine-local and are returned only by these
explicit repository/worktree endpoints; ordinary project and task detail responses do not
include them.

| Method | Path | Notes |
| --- | --- | --- |
| `POST` | `/projects/:project/repositories` | `{ label, rootPath, remoteUrl?, primary? }` → `201 { repository }` |
| `GET` | `/projects/:project/repositories` | Explicit list including canonical local roots and current availability |
| `GET` | `/projects/:project/repositories/:repository` | → `{ repository }` |
| `PATCH` | `/projects/:project/repositories/:repository` | Update `label`, `rootPath`, `remoteUrl`, or pass `primary: true` |
| `DELETE` | `/projects/:project/repositories/:repository` | `{ force? }` → `{ removed }` |
| `GET` | `/tasks/:task/execution/worktree` | Explicit path-bearing worktree detail |
| `PUT` | `/tasks/:task/execution/worktree` | `{ repository, worktreePath, branch?, actor, sessionId? }` |
| `DELETE` | `/tasks/:task/execution/worktree` | `{ actor, sessionId? }` detaches the running execution |

The first associated repository becomes primary automatically. Passing `primary: true`
transfers primary status atomically. Removing a primary repository promotes the oldest
remaining association.

Roots and worktrees must be existing absolute directories. The service stores their
filesystem-canonical path (including symlink resolution) plus a comparison key; Windows and
macOS default to case-insensitive comparison and Linux to case-sensitive comparison. A
non-default filesystem can override this in the core composition options. Duplicate
canonical roots within one project are rejected.

Reads report `available`, `missing`, `inaccessible` or `not_directory` without rewriting
stored identity, so a moved repository can be repaired with `PATCH`. A repository bound to a
running execution cannot be removed even with `force`. Ended execution bindings are
preserved by default and can be removed only through an explicit forced removal.
Explicitly detaching a worktree or forcibly removing its ended binding also removes the
binding's machine-local Git provenance.

An execution worktree may be the repository root, a contained directory, or an external Git
linked-worktree directory. Explicit worktree detail includes `relativePath` when containment
can be proved; otherwise it is `null`. Core repository-relative path resolution rejects both
lexical `..` traversal and symlink escape.

Generic links remain separate and supported. A GitHub repository URL, branch or pull request
can still be stored under `/projects/:project/links`; it is not treated as local filesystem
identity.

## Git execution provenance

Git inspection is read-only and uses only the execution's explicit stored worktree. The local
adapter invokes `git` with argument arrays, that worktree as an explicit `cwd`, a 10-second
timeout and a 512 KiB output limit. No endpoint accepts an arbitrary path or command.

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/tasks/:task/execution/git-provenance` | `{ provenance }` for the active or most recent execution |
| `POST` | `/tasks/:task/execution/git-provenance/capture` | `{}` → `201 { provenance }`; appends a manual snapshot using the stored binding |

A repository-aware `start-work` or explicit worktree bind records one immutable baseline:
derived branch (or detached state), HEAD object id (or `null` for an unborn branch), dirty
state, repository/worktree identity and capture time. Checkpoint reports, handoff and task
completion append snapshots automatically. Every snapshot includes a monotonic sequence,
current HEAD, commits observed since the baseline, net additions/deletions, and normalized
repository-relative touched paths with rename/copy origins.

The change footprint is the union of commit history since the baseline, the current
baseline-HEAD-to-worktree diff and current untracked paths. An unborn baseline uses Git's
empty tree as its comparison point after the first commit, so its net additions/deletions
cover the complete current tree plus working-tree edits. When work starts dirty, the
baseline records `dirty: true`; later footprints may include those pre-existing changes
because Git has no non-mutating object representing the initial working-tree contents.

Derived rows always carry `source: "local_git"`. Agent-authored checkpoints, progress,
criterion evidence and notes remain in their own records and are never presented as Git
facts. Non-Git, missing, timed-out and over-limit worktrees produce structured error
baselines/snapshots; the associated claim, checkpoint, handoff or completion remains valid.
Inspection never creates commits, branches, indexes, stashes or working-tree changes.

## Path ownership and collision advisories

Running executions with an explicit worktree may declare exact repository-relative files
and directory prefixes. Declarations are immutable revisions; replacing with an empty
`paths` array clears the live declaration while preserving history.

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/tasks/:task/execution/path-ownership` | Current/latest `{ ownership, collisions }` |
| `PUT` | `/tasks/:task/execution/path-ownership` | `{ paths: [{ path, kind }], actor, sessionId? }`; `kind` is `file` or `directory` |

Paths must be normalized, repository-relative and inside the bound worktree. Absolute,
Windows drive/UNC, traversal, backslash, glob and symlink-escape paths are rejected.
Warnings compare only different live claimed executions on the exact same repository
identity. Exact file matches and slash-boundary directory prefixes overlap; observed paths
from the latest successful Git snapshot participate even when undeclared. Same-worktree
warnings are stronger than separate-worktree merge-risk warnings. Warnings appear in
execution/report/checkpoint/capture responses and Needs Attention, but never block a claim.
Released or expired executions stop producing warnings while their declaration history
remains readable.

## Tasks

| Method | Path | Notes |
| --- | --- | --- |
| `POST` | `/projects/:project/tasks` | `{ title, description?, context?, status?, priority?, parentTask?, acceptanceCriteria?, dependencies? }` |
| `GET` | `/projects/:project/tasks` | `?status=&priority=&actionable=&claimed=&blocked=&parent=&search=` |
| `GET` | `/tasks/:task` | Full working state |
| `PATCH` | `/tasks/:task` | `title`, `description`, `status`, `priority`, `parentTask`, `sortOrder`; if `context` is present, `expectedContextVersion` is required and `contextReason` is optional |
| `PUT` | `/tasks/:task/context` | `{ context, expectedVersion, reason? }` |
| `GET` | `/tasks/:task/context/versions` | Bounded metadata-only history; `?limit=20&beforeVersion=` |
| `GET` | `/tasks/:task/context/versions/:version` | One historical version including nullable content |
| `POST` | `/tasks/:task/context/revert` | `{ targetVersion, expectedVersion, reason? }` |
| `POST` | `/tasks/:task/complete` | `{ force?, reason? }` — `reason` is required when `force` is true; a bound execution gets a best-effort completion Git snapshot |
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
      "dependencies": 0, "decisions": 0, "links": 0, "activityEvents": 2,
      "repositories": 0, "executionWorktrees": 0
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

## Composite execution workflows

The atomic claim, heartbeat, progress, checkpoint, execution-read and release endpoints remain
available. These three typed composites reduce round trips for the common lifecycle while
calling the same domain services:

| Method | Path | Request and result |
| --- | --- | --- |
| `POST` | `/tasks/:task/start-work` | `{ actor, sessionId, ttlMinutes?, worktree?, ownership? }` atomically claims actionable work or resumes the caller's own live claim. Optional `worktree` is `{ repository, worktreePath, branch? }`; optional `ownership` is an array of `{ path, kind }` and requires a binding. An invalid binding/declaration rolls back the claim. Returns full `{ project, task, execution }` state, including contexts, dependencies, blockers, checkpoints, work plan, latest handoff, Git provenance and collision advisories. |
| `POST` | `/tasks/:task/report` | `{ actor, sessionId, phase?, progress?, checkpoint? }` refreshes liveness and optionally records one progress entry and checkpoint in the same transaction; a checkpoint on a bound execution gets a best-effort Git snapshot. |
| `POST` | `/tasks/:task/handoff` | `{ actor, sessionId, reason?, phase?, checkpoint }` records the required final checkpoint, writes durable handoff state and releases the matching claim atomically, then appends a best-effort Git snapshot. |

`checkpoint` is `{ completed, workingOn, next, uncertainty? }`. A report containing only
actor/session and an optional phase is a silent heartbeat: it updates claim/execution
liveness without writing activity. Multi-write failures roll back the whole composite.
Unlike the older general mutations where attribution is optional, every composite request
requires explicit `actor` and `sessionId` identity.

`start-work` rejects backlog, blocked, review, completed and dependency-waiting tasks with
`TASK_NOT_ACTIONABLE`. An unclaimed `in_progress` task with a durable handoff may be recovered;
a live claim owned by another actor/session returns `TASK_ALREADY_CLAIMED`.

The typed client exposes the same operations as `tasks.startWork`, `tasks.report` and
`tasks.handoff`. The CLI equivalents are:

```bash
ac --actor codex --session run-1 task start TASK-0042
ac --actor codex --session run-1 task start TASK-0042 \
  --repository REP-0001 --worktree /absolute/path/to/worktree --branch feature/TASK-0042
ac --actor codex --session run-1 task report TASK-0042 \
  --phase "Testing" --progress "Core workflow implemented" \
  --completed "Core" --working-on "Adapters" --next "Run verification"
ac --actor codex --session run-1 task handoff TASK-0042 \
  --completed "Core and adapters" --working-on "Verification" --next "Continue tests"
ac task provenance TASK-0042
ac task provenance TASK-0042 --capture
```

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
| `GET` | `/sessions/:session/handoff-status` | Return path-free checkpoint freshness for live claims owned by one exact provider session |
| `GET` / `PUT` / `DELETE` | `/tasks/:task/execution/worktree` | Explicit path-bearing read, bind or unbind |
| `GET` / `POST` | `/tasks/:task/checkpoints` | List or record a structured checkpoint |
| `GET` / `PUT` | `/tasks/:task/work-plan` | Read or replace the ordered work plan |
| `PATCH` | `/tasks/:task/work-plan/:item` | Change one phase status |
| `POST` | `/tasks/:task/execution/origins` | Attach a provider-neutral execution origin |
| `GET` / `POST` | `/tasks/:task/acceptance-criteria/:criterion/evidence` | List or persist typed proof |
| `GET` / `PUT` / `DELETE` | `/tasks/:task/acceptance-criteria/:criterion/evidence-policy` | Read, set or clear an optional completion requirement |
| `GET` | `/attention` | List work requiring a human or agent action |

A heartbeat never creates an activity event. Checkpoints are meaningful resume state, not
command logs. Releasing, completing or expiring a claim ends its execution and captures a
handoff from the latest checkpoint. A later claim can reclaim the task without discarding
that durable history.

Evidence writes are a discriminated union with writable kinds `commit`, `test`, `file`,
`url`, `result` and `note`. Reads may additionally return `legacy` for rows created before
typed evidence. Legacy rows preserve their original `type`, `reference`, `content` and
`url`; `legacy` is never accepted for a new write. Repository scope is a path-free snapshot
of repository key/label/id, optional execution/worktree ids and a normalized SHA.

An absent evidence policy preserves the compatible default: evidence does not block
completion. A policy selects qualifying kinds and a minimum count and may require a SHA
or stable passing local-verification record. `TASK_HAS_MISSING_ACCEPTANCE_EVIDENCE`
reports every failing criterion and its actual qualifying count. `force: true` bypasses
incomplete criteria, blockers and evidence policy only when a non-empty reason is supplied;
the skipped requirements and reason are recorded in `task.completed`.

There is deliberately no REST verification, command, executable, argument or cwd endpoint.
The API only persists already-structured evidence data. URLs are stored as data and are
never fetched.
