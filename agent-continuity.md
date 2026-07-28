
Agent Continuity v0.1 Build Specification

1. Purpose

Build a local-first persistent project execution service designed primarily for use by AI agents.

The application provides structured persistent state for:

* Projects
* Project context
* Tasks
* Task context
* Acceptance criteria
* Dependencies
* Temporary task claims
* Progress
* Blockers
* Decisions
* External links
* Activity

The service must allow one AI agent to begin work and another AI agent to continue that work later without requiring the user to reconstruct project state manually.

The product must remain domain agnostic.

Software development workflows, Git, GitHub, Jira, research workflows, and other specialist behaviour must be implemented through Skills or future integrations rather than being embedded into the core project model.

The core principle is:

The conversation is temporary. The agent is replaceable. The project state persists.

⸻

2. Version Scope

This specification covers v0.1.

The goal of v0.1 is to prove that Agent Continuity is materially better than using progress.md, TODO.md, or similar persistent Markdown files for multi-session AI agent work.

v0.1 must include:

* Local service
* SQLite persistence
* REST API
* MCP server
* CLI
* Local web UI
* Kanban project board
* Project and task context
* Acceptance criteria
* Task dependencies
* Task claims
* Progress tracking
* Blockers
* Decisions
* Generic links
* Activity timeline
* Project bootstrap operation
* General agent workflow Skill
* Project creation Skill

v0.1 does not require:

* Authentication
* Cloud hosting
* Multi-user support
* Real-time collaboration
* Native GitHub integration
* Native Jira integration
* Automatic Git operations
* Mobile application
* Custom workflows
* Billing
* Agent performance metrics

⸻

3. Recommended Technology Stack

Runtime

Use:

* Node.js 24 LTS
* TypeScript
* pnpm

The project should use strict TypeScript configuration.

Backend

Use:

* Fastify
* Zod
* Drizzle ORM
* SQLite

SQLite driver:

* Node's built-in synchronous `node:sqlite` module (Node.js 24+)

The backend must own all business rules.

The MCP server, CLI, and web application must not implement separate versions of domain logic.

MCP

Use the official Model Context Protocol TypeScript SDK.

The MCP server should communicate with the core application service directly when running in-process or through the local HTTP API when running independently.

The preferred initial architecture is a single package exposing domain services which both Fastify and MCP adapters consume.

Web UI

Use:

* React
* Vite
* TypeScript
* TanStack Query
* React Router
* dnd-kit

Use a lightweight component system.

The first version should prioritise clarity and functionality over visual customisation.

CLI

Use:

* Commander.js

The CLI should consume the HTTP API.

This ensures the API surface is tested through real usage.

Testing

Use:

* Vitest
* Fastify inject for API integration tests
* React Testing Library for important UI workflows
* Playwright for minimal end-to-end testing

⸻

4. Repository Structure

Use a pnpm workspace.

Recommended structure:

agent-continuity/
├── apps/
│   ├── server/
│   │   ├── src/
│   │   └── package.json
│   │
│   ├── web/
│   │   ├── src/
│   │   └── package.json
│   │
│   ├── cli/
│   │   ├── src/
│   │   └── package.json
│   │
│   └── mcp/
│       ├── src/
│       └── package.json
│
├── packages/
│   ├── core/
│   │   ├── src/
│   │   │   ├── projects/
│   │   │   ├── tasks/
│   │   │   ├── claims/
│   │   │   ├── blockers/
│   │   │   ├── decisions/
│   │   │   ├── links/
│   │   │   └── activity/
│   │   └── package.json
│   │
│   ├── database/
│   │   ├── src/
│   │   ├── migrations/
│   │   └── package.json
│   │
│   ├── contracts/
│   │   ├── src/
│   │   └── package.json
│   │
│   └── client/
│       ├── src/
│       └── package.json
│
├── skills/
│   ├── agent-continuity/
│   │   └── SKILL.md
│   │
│   └── project-bootstrap/
│       └── SKILL.md
│
├── docs/
│   ├── architecture.md
│   ├── api.md
│   ├── mcp.md
│   └── development.md
│
├── package.json
├── pnpm-workspace.yaml
└── tsconfig.base.json

⸻

5. Architecture

The application must use a layered architecture.

                 ┌────────────────┐
                 │    Web UI      │
                 └───────┬────────┘
                         │ HTTP
                 ┌───────▼────────┐
CLI ─── HTTP ───►│  Fastify API   │
                 └───────┬────────┘
                         │
MCP Adapter ──────────────┤
                         │
                 ┌───────▼────────┐
                 │  Core Services │
                 └───────┬────────┘
                         │
                 ┌───────▼────────┐
                 │  Repositories  │
                 └───────┬────────┘
                         │
                 ┌───────▼────────┐
                 │     SQLite     │
                 └────────────────┘

Core rule

All state mutation and business rules must occur in packages/core.

For example:

TaskService.claimTask()
TaskService.completeTask()
TaskService.addBlocker()
ProjectService.bootstrapProject()

The REST API must translate HTTP requests into core service calls.

The MCP server must translate MCP tool calls into core service calls.

No business rule may exist only in an API route or MCP handler.

⸻

6. Identifier Strategy

Use human-readable prefixed identifiers.

Examples:

PRJ-0001
TASK-0001
DEC-0001
BLK-0001
LNK-0001

Internally, SQLite may use UUIDs as primary keys.

Each user-facing entity should also contain a generated sequence identifier.

Recommended model:

id: UUID
key: TASK-0042

The public API should accept either UUID or human-readable key where practical.

MCP tools should primarily return and reference human-readable keys.

⸻

7. Database Schema

7.1 projects

id                  TEXT PRIMARY KEY
key                 TEXT NOT NULL UNIQUE
name                TEXT NOT NULL
objective           TEXT
description         TEXT
context             TEXT
status              TEXT NOT NULL
created_at          TEXT NOT NULL
updated_at          TEXT NOT NULL
archived_at         TEXT

Allowed status values:

active
paused
completed
archived

Default:

active

Indexes:

projects_key_idx
projects_status_idx
projects_updated_at_idx

⸻

7.2 tasks

id                  TEXT PRIMARY KEY
key                 TEXT NOT NULL UNIQUE
project_id          TEXT NOT NULL
parent_task_id      TEXT
title               TEXT NOT NULL
description         TEXT
context             TEXT
status              TEXT NOT NULL
priority            TEXT NOT NULL
sort_order          REAL NOT NULL
created_at          TEXT NOT NULL
updated_at          TEXT NOT NULL
completed_at        TEXT

Foreign keys:

project_id -> projects.id
parent_task_id -> tasks.id

Allowed status values:

backlog
ready
in_progress
blocked
review
done

Allowed priority values:

low
normal
high
critical

Default priority:

normal

Indexes:

tasks_key_idx
tasks_project_id_idx
tasks_status_idx
tasks_priority_idx
tasks_parent_task_id_idx
tasks_updated_at_idx

⸻

7.3 acceptance_criteria

id                  TEXT PRIMARY KEY
task_id             TEXT NOT NULL
description         TEXT NOT NULL
is_complete         INTEGER NOT NULL
sort_order          REAL NOT NULL
created_at          TEXT NOT NULL
completed_at        TEXT

Foreign key:

task_id -> tasks.id

⸻

7.4 task_dependencies

task_id             TEXT NOT NULL
depends_on_task_id  TEXT NOT NULL
created_at          TEXT NOT NULL

Composite primary key:

task_id
depends_on_task_id

Rules:

* A task cannot depend on itself.
* Circular dependencies must be rejected.
* Dependencies may only exist between tasks in the same project in v0.1.

⸻

7.5 task_claims

id                  TEXT PRIMARY KEY
task_id             TEXT NOT NULL
actor               TEXT NOT NULL
session_id          TEXT
claimed_at          TEXT NOT NULL
last_active_at      TEXT NOT NULL
expires_at          TEXT NOT NULL
released_at         TEXT
release_reason      TEXT

Only one active claim may exist for a task.

An active claim is a claim where:

released_at IS NULL
AND expires_at > current_time

Indexes:

task_claims_task_id_idx
task_claims_expires_at_idx
task_claims_actor_idx

⸻

7.6 task_progress

Progress is represented as a dedicated entity and mirrored into the activity stream.

id                  TEXT PRIMARY KEY
task_id             TEXT NOT NULL
content             TEXT NOT NULL
actor               TEXT
session_id          TEXT
created_at          TEXT NOT NULL

Progress entries are append-only.

⸻

7.7 blockers

id                  TEXT PRIMARY KEY
key                 TEXT NOT NULL UNIQUE
task_id             TEXT NOT NULL
description         TEXT NOT NULL
required_action     TEXT
created_by          TEXT
created_at          TEXT NOT NULL
resolved_at         TEXT
resolved_by         TEXT
resolution          TEXT

A blocker where resolved_at is null is active.

⸻

7.8 decisions

id                  TEXT PRIMARY KEY
key                 TEXT NOT NULL UNIQUE
project_id          TEXT NOT NULL
task_id             TEXT
title               TEXT NOT NULL
decision            TEXT NOT NULL
rationale           TEXT
created_by          TEXT
session_id          TEXT
created_at          TEXT NOT NULL
superseded_at       TEXT
superseded_by_id    TEXT

task_id is optional.

Rules:

* The task must belong to the specified project.
* Decisions are append-only in normal usage.
* A decision may be superseded by a later decision.

v0.1 UI does not need decision supersession controls, but the schema should support it.

⸻

7.9 links

id                  TEXT PRIMARY KEY
key                 TEXT NOT NULL UNIQUE
project_id          TEXT NOT NULL
task_id             TEXT
type                TEXT NOT NULL
provider            TEXT
reference           TEXT
url                 TEXT
metadata_json       TEXT
created_by          TEXT
created_at          TEXT NOT NULL

Rules:

* A link always belongs to a project.
* A link may optionally belong to a task.
* The task must belong to the project.
* metadata_json must contain a JSON object if provided.

Example:

{
  "type": "issue",
  "provider": "jira",
  "reference": "FUSION-1842"
}

Example:

{
  "type": "branch",
  "provider": "git",
  "reference": "feature/TASK-0042"
}

No provider-specific validation should occur in v0.1.

⸻

7.10 activity_events

id                  TEXT PRIMARY KEY
project_id          TEXT NOT NULL
task_id             TEXT
event_type          TEXT NOT NULL
actor               TEXT
session_id          TEXT
payload_json        TEXT NOT NULL
created_at          TEXT NOT NULL

Activity events are append-only.

Indexes:

activity_project_id_idx
activity_task_id_idx
activity_event_type_idx
activity_created_at_idx

⸻

7.11 counters

Use a counters table for public identifiers.

entity_type         TEXT PRIMARY KEY
current_value       INTEGER NOT NULL

Example:

project     12
task        147
decision    38
blocker     16
link        72

Identifier generation must occur inside a database transaction.

⸻

8. Activity Event Types

v0.1 must support:

project.created
project.updated
project.context_updated
project.archived
task.created
task.updated
task.context_updated
task.status_changed
task.completed
task.reopened
task.claimed
task.claim_renewed
task.claim_released
task.claim_expired
task.progress_added
task.blocked
task.blocker_resolved
acceptance_criterion.created
acceptance_criterion.completed
acceptance_criterion.reopened
dependency.added
dependency.removed
decision.recorded
decision.superseded
link.added
link.removed

The activity service should provide:

recordEvent({
  projectId,
  taskId?,
  eventType,
  actor?,
  sessionId?,
  payload
})

Event payloads should be structured JSON.

Example:

{
  "from": "ready",
  "to": "in_progress"
}

Example:

{
  "blockerKey": "BLK-0012",
  "description": "Expected API behaviour is unclear"
}

Do not use activity events as the source of truth for v0.1 state reconstruction.

The relational tables remain the current-state source of truth.

The activity table is the historical event stream.

Full event sourcing is explicitly out of scope.

⸻

9. Project Domain Rules

Project creation

A project requires:

name

The following fields are optional:

objective
description
context

Project creation must generate:

project.created

Project context

Project context is persistent agent working memory that applies to the whole project.

Context should be plain text or Markdown.

The service should not enforce context structure.

The Skills define appropriate context usage.

Updating context must create:

project.context_updated

The activity event payload should not contain the entire context.

Store:

{
  "previousLength": 482,
  "newLength": 731
}

This prevents unnecessarily duplicating potentially large context values in activity.

⸻

10. Task Domain Rules

Creating a task

Required:

project
title

Optional:

description
context
status
priority
parentTask
acceptanceCriteria
dependencies

Default status:

backlog

Default priority:

normal

Ready task rules

A task may be moved to ready even when dependencies are incomplete.

However, the service must expose:

isActionable

A task is actionable when:

status = ready
AND all dependencies are done
AND no active blockers exist

The UI should visually distinguish non-actionable ready tasks.

The general Agent Skill should instruct agents to select actionable tasks.

Completing tasks

tasks.complete must:

1. Verify the task exists.
2. Check acceptance criteria.
3. Reject completion if incomplete acceptance criteria exist unless force is true.
4. Set status to done.
5. Set completed_at.
6. Release the active claim.
7. Record task.completed.

When forced:

force: true
reason: string

A reason is required.

The event payload must record the forced completion.

Reopening tasks

Moving a done task to another status must:

* Clear completed_at
* Record task.reopened

⸻

11. Task Claim Model

Task claims are temporary leases.

Default lease duration

Use:

30 minutes

Configuration:

AGENT_CONTINUITY_CLAIM_TTL_MINUTES

Claim task

Claiming must:

1. Resolve the task.
2. Check for an active claim.
3. If another active claim exists, reject the operation.
4. Create a claim.
5. If task status is ready, move it to in_progress.
6. Record task.claimed.

Input:

{
  task: string;
  actor: string;
  sessionId?: string;
  ttlMinutes?: number;
}

Renew claim

Input:

{
  task: string;
  actor: string;
  sessionId?: string;
}

Renewal is permitted only when the active claim matches the actor.

When both existing and supplied session IDs exist, they must also match.

Renewal updates:

last_active_at
expires_at

Release claim

Input:

{
  task: string;
  actor?: string;
  sessionId?: string;
  reason?: string;
}

Agents should normally release their own claims.

The API and UI may allow forced release.

Expired claims

Expired claims remain in the database.

When a task is read or queried, an expired claim should not be returned as active.

A background process is not required.

The service may lazily record task.claim_expired the first time it detects an expired claim.

This event must only be generated once per claim.

Add:

expiry_recorded_at

to task_claims if required to guarantee this.

Claim heartbeat

No dedicated background heartbeat is required.

Operations that represent active task work may automatically renew the caller’s claim when actor and session metadata match.

These operations include:

tasks.add_progress
tasks.add_blocker
tasks.resolve_blocker
tasks.update_context
acceptance_criteria.complete
decisions.create for the claimed task
links.add for the claimed task

This behaviour should be implemented through:

ClaimService.touchClaim()

⸻

12. Blocker Rules

Adding a blocker must:

1. Create the blocker.
2. Move the task to blocked if it is not already done.
3. Record task.blocked.
4. Touch a matching active claim.

Resolving a blocker must:

1. Set resolution details.
2. Record task.blocker_resolved.
3. Check whether active blockers remain.

When no active blockers remain and task status is blocked, automatically move the task to:

in_progress

when an active claim exists.

Otherwise move it to:

ready

The status change should generate the relevant activity event.

⸻

13. Acceptance Criteria Rules

Acceptance criteria are individually completable.

Creating acceptance criteria after task completion is allowed but should reopen the task automatically.

Completing a criterion creates:

acceptance_criterion.completed

Reopening a criterion creates:

acceptance_criterion.reopened

Task responses should include:

acceptanceCriteriaCompleted
acceptanceCriteriaTotal
acceptanceCriteriaProgress

Example:

{
  "acceptanceCriteriaCompleted": 3,
  "acceptanceCriteriaTotal": 5,
  "acceptanceCriteriaProgress": 0.6
}

When no acceptance criteria exist:

acceptanceCriteriaProgress = null

⸻

14. Dependency Rules

Dependencies form a directed graph.

Before adding:

TASK-A depends on TASK-B

the service must verify that no path already exists:

TASK-B -> ... -> TASK-A

If such a path exists, adding the dependency creates a cycle and must be rejected.

The task service should expose:

dependencies
dependents
dependenciesComplete
isActionable

⸻

15. Project Bootstrap

projects.bootstrap is a core v0.1 feature.

It exists specifically to allow an AI agent to convert a conversation or planning session into a complete persistent project.

Request

type BootstrapProjectRequest = {
  name: string;
  objective?: string;
  description?: string;
  context?: string;
  tasks?: Array<{
    ref?: string;
    title: string;
    description?: string;
    context?: string;
    status?: TaskStatus;
    priority?: TaskPriority;
    acceptanceCriteria?: string[];
    dependsOn?: string[];
    links?: Array<BootstrapLink>;
  }>;
  decisions?: Array<{
    title: string;
    decision: string;
    rationale?: string;
    taskRef?: string;
  }>;
  links?: Array<BootstrapLink>;
  actor?: string;
  sessionId?: string;
};

ref is a temporary reference used only inside the bootstrap request.

Example:

{
  "name": "Agent Continuity",
  "tasks": [
    {
      "ref": "task-model",
      "title": "Design task model"
    },
    {
      "ref": "claim-model",
      "title": "Design task claim model",
      "dependsOn": ["task-model"]
    }
  ]
}

The final task IDs are generated by the service.

Atomicity

The entire bootstrap operation must run inside one database transaction.

If any task, dependency, decision, or link is invalid, nothing should be created.

Response

type BootstrapProjectResponse = {
  project: Project;
  tasks: Task[];
  decisions: Decision[];
  links: Link[];
  refMap: Record<string, string>;
};

Example:

{
  "refMap": {
    "task-model": "TASK-0001",
    "claim-model": "TASK-0002"
  }
}

⸻

16. REST API

Base path:

/api/v1

Return JSON only.

Error format:

{
  "error": {
    "code": "TASK_ALREADY_CLAIMED",
    "message": "TASK-0014 is currently claimed by claude-code.",
    "details": {}
  }
}

Health

GET /health

Response:

{
  "status": "ok",
  "version": "0.1.0"
}

⸻

17. Project API

Create project

POST /api/v1/projects

Request:

{
  "name": "Agent Continuity",
  "objective": "Build a persistent execution layer for AI agents",
  "description": "...",
  "context": "...",
  "actor": "codex",
  "sessionId": "abc123"
}

Bootstrap project

POST /api/v1/projects/bootstrap

List projects

GET /api/v1/projects

Query parameters:

status
search
limit
offset
sort

Supported sort values:

updated_at_desc
updated_at_asc
created_at_desc
name_asc

Get project

GET /api/v1/projects/:project

Response should include summary metrics:

{
  "taskCounts": {
    "backlog": 4,
    "ready": 2,
    "inProgress": 1,
    "blocked": 1,
    "review": 0,
    "done": 7
  },
  "progress": 0.4667
}

Project progress:

done tasks / total tasks

Archived tasks do not exist in v0.1.

Update project

PATCH /api/v1/projects/:project

Update project context

PUT /api/v1/projects/:project/context

Request:

{
  "context": "...",
  "actor": "claude-code",
  "sessionId": "..."
}

Archive project

POST /api/v1/projects/:project/archive

⸻

18. Task API

Create task

POST /api/v1/projects/:project/tasks

List project tasks

GET /api/v1/projects/:project/tasks

Query parameters:

status
priority
actionable
claimed
blocked
parent
search

Multiple statuses may be supplied:

?status=ready&status=in_progress

Get task

GET /api/v1/tasks/:task

Response must include:

task
project summary
acceptance criteria
dependencies
dependents
active claim
progress
active blockers
resolved blockers
task decisions
task links
recent activity
isActionable

Recent activity default:

20 events

Update task

PATCH /api/v1/tasks/:task

Editable fields:

title
description
context
status
priority
parentTask
sortOrder

Update task context

PUT /api/v1/tasks/:task/context

Complete task

POST /api/v1/tasks/:task/complete

Request:

{
  "actor": "codex",
  "sessionId": "...",
  "force": false
}

Forced:

{
  "actor": "codex",
  "force": true,
  "reason": "Criterion is no longer applicable"
}

⸻

19. Claim API

Claim

POST /api/v1/tasks/:task/claim

Renew

POST /api/v1/tasks/:task/claim/renew

Release

POST /api/v1/tasks/:task/claim/release

⸻

20. Progress API

Add progress

POST /api/v1/tasks/:task/progress

Request:

{
  "content": "Initial task data model has been implemented.",
  "actor": "codex",
  "sessionId": "..."
}

List progress

GET /api/v1/tasks/:task/progress

⸻

21. Blocker API

Add blocker

POST /api/v1/tasks/:task/blockers

Request:

{
  "description": "Expected provider behaviour is unclear.",
  "requiredAction": "Confirm whether legacy behaviour must be preserved.",
  "actor": "codex",
  "sessionId": "..."
}

Resolve blocker

POST /api/v1/blockers/:blocker/resolve

Request:

{
  "resolution": "Confirmed that existing behaviour must be preserved.",
  "actor": "adam"
}

⸻

22. Acceptance Criteria API

Add criterion

POST /api/v1/tasks/:task/acceptance-criteria

Complete criterion

POST /api/v1/acceptance-criteria/:criterion/complete

Reopen criterion

POST /api/v1/acceptance-criteria/:criterion/reopen

Delete criterion

DELETE /api/v1/acceptance-criteria/:criterion

Deletion should only be allowed for incomplete criteria in v0.1.

⸻

23. Dependency API

Add dependency

POST /api/v1/tasks/:task/dependencies

Request:

{
  "dependsOn": "TASK-0004"
}

Remove dependency

DELETE /api/v1/tasks/:task/dependencies/:dependency

⸻

24. Decision API

Create decision

POST /api/v1/projects/:project/decisions

Request:

{
  "task": "TASK-0014",
  "title": "Use lease-based task claims",
  "decision": "Tasks use temporary claims rather than permanent assignment.",
  "rationale": "Agent sessions are transient.",
  "actor": "codex",
  "sessionId": "..."
}

task is optional.

List project decisions

GET /api/v1/projects/:project/decisions

Filters:

task
search

Get decision

GET /api/v1/decisions/:decision

⸻

25. Link API

Add link

POST /api/v1/projects/:project/links

Request:

{
  "task": "TASK-0014",
  "type": "issue",
  "provider": "jira",
  "reference": "AC-42",
  "url": "https://...",
  "metadata": {
    "status": "In Progress"
  },
  "actor": "codex"
}

List links

GET /api/v1/projects/:project/links

Filters:

task
type
provider

Remove link

DELETE /api/v1/links/:link

⸻

26. Activity API

Project activity

GET /api/v1/projects/:project/activity

Filters:

task
eventType
actor
after
before
limit
cursor

Activity should use cursor pagination.

Default:

50 events

Maximum:

200 events

⸻

27. MCP Server

The MCP server is a primary product interface.

Tools should be designed for clear agent use rather than mirroring every HTTP endpoint exactly.

The MCP tool surface should be intentionally compact.

MCP tool naming

Use snake case.

Example:

projects_create
tasks_claim

⸻

28. MCP Project Tools

projects_create

Description:

Create a new project. Use when a new body of work needs persistent project state but full project decomposition is not being created in the same operation.

Input:

{
  name: string;
  objective?: string;
  description?: string;
  context?: string;
  actor?: string;
  session_id?: string;
}

projects_bootstrap

Description:

Atomically create a project, its initial tasks, dependencies, decisions, and links. Use when converting a conversation, plan, specification, or body of work into a persistent project.

Input should follow the bootstrap contract.

projects_list

Description:

List projects and summary state. Use to identify an existing project before creating a new one.

Inputs:

{
  status?: ProjectStatus;
  search?: string;
}

projects_get

Description:

Get project details, context, task summary, recent decisions, links, and recent activity.

Input:

{
  project: string;
}

projects_get_context is not required as a separate MCP tool.

projects_get should include context.

projects_update

Editable:

name
objective
description
status

projects_update_context

Use a dedicated tool because context management is an important agent workflow.

⸻

29. MCP Task Tools

tasks_create

Create one or multiple tasks.

Support batch creation:

{
  project: string;
  tasks: Array<{
    title: string;
    description?: string;
    context?: string;
    status?: TaskStatus;
    priority?: TaskPriority;
    acceptance_criteria?: string[];
  }>;
  actor?: string;
  session_id?: string;
}

Batch creation must be transactional.

tasks_list

Description:

Query project tasks. Use to find active, ready, blocked, or actionable work.

Input:

{
  project: string;
  statuses?: TaskStatus[];
  priorities?: TaskPriority[];
  actionable_only?: boolean;
  claimed?: boolean;
  blocked?: boolean;
  search?: string;
}

tasks_get

Description:

Get the full working state for a task, including task context, acceptance criteria, dependencies, active claim, progress, blockers, decisions, links, and recent activity.

tasks_update

Update:

title
description
status
priority
parent_task

Do not use this tool for context updates.

tasks_update_context

Dedicated task context tool.

tasks_claim

Description:

Claim a task before beginning meaningful work. Claims are temporary leases and may expire.

tasks_release_claim

tasks_add_progress

Description:

Record a meaningful progress milestone. Do not use for every command, file edit, or minor implementation step.

tasks_add_blocker

tasks_resolve_blocker

tasks_complete

Description must clearly explain acceptance criterion enforcement.

⸻

30. MCP Acceptance Criterion Tools

To keep tool count under control, acceptance criteria should be managed through:

tasks_add_acceptance_criteria

Input:

{
  task: string;
  criteria: string[];
}

tasks_update_acceptance_criteria

Input:

{
  task: string;
  complete?: string[];
  reopen?: string[];
}

Criteria may be referenced by criterion ID.

The tool response should always return the current complete acceptance criteria set.

⸻

31. MCP Dependency Tools

tasks_add_dependency

tasks_remove_dependency

The service must clearly explain cycle errors.

Example MCP error:

Cannot add TASK-0012 as a dependency of TASK-0008 because it would create the dependency cycle TASK-0008 → TASK-0012 → TASK-0008.

⸻

32. MCP Decision Tools

decisions_create

Description:

Record an explicit choice that future agents may need to understand or justify. Use for meaningful architectural, product, workflow, or implementation decisions. Do not use for ordinary progress updates.

decisions_list

Filters:

project
task
search

⸻

33. MCP Link Tools

links_add

Allow multiple links in one operation.

{
  project: string;
  task?: string;
  links: Array<{
    type: string;
    provider?: string;
    reference?: string;
    url?: string;
    metadata?: Record<string, unknown>;
  }>;
}

links_list

links_remove

⸻

34. MCP Activity Tool

activity_list

Description:

Retrieve recent structured activity for a project or task. Use to understand what changed, what previous agents worked on, or what happened during a specified period.

Inputs:

{
  project: string;
  task?: string;
  event_types?: string[];
  actor?: string;
  limit?: number;
}

⸻

35. MCP Tool Response Design

MCP responses should be concise and highly structured.

Avoid returning unnecessary database fields.

Example tasks_get response:

TASK-0014 — Design task claim model
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
Decisions:
DEC-0007 — Claims are temporary leases
Links:
None
Recommended state:
Continue current task.

Structured JSON may be included as MCP content where supported, but human-readable text should also be useful to the agent.

Do not expose raw UUIDs unless requested.

⸻

36. CLI Specification

Binary:

ac

Alternative package name may be selected later.

Project commands

ac project create
ac project list
ac project show PRJ-0001
ac project context PRJ-0001
ac project archive PRJ-0001

Example:

ac project create \
  --name "Agent Continuity" \
  --objective "Build persistent project execution for AI agents"

Task commands

ac task create PRJ-0001
ac task list PRJ-0001
ac task show TASK-0001
ac task claim TASK-0001
ac task release TASK-0001
ac task progress TASK-0001 "Core model implemented"
ac task block TASK-0001 "Need API behaviour clarified"
ac task complete TASK-0001

Filters:

ac task list PRJ-0001 --status ready
ac task list PRJ-0001 --actionable
ac task list PRJ-0001 --blocked

Decisions

ac decision add PRJ-0001
ac decision list PRJ-0001

Activity

ac activity PRJ-0001
ac activity PRJ-0001 --task TASK-0001
ac activity PRJ-0001 --limit 100

JSON mode

All read commands must support:

--json

Example:

ac task show TASK-0001 --json

This gives terminal-capable agents a machine-readable fallback when MCP is unavailable.

⸻

37. Web Application

The web application is the human interface to Agent Continuity.

The UI must consume the REST API.

It must not access SQLite directly.

⸻

38. Global UI Layout

Desktop-first local application.

Layout:

┌──────────────────────────────────────────────────────────┐
│ Agent Continuity                              Settings    │
├──────────────┬───────────────────────────────────────────┤
│              │                                           │
│ Projects     │ Main Content                              │
│              │                                           │
│ + New        │                                           │
│              │                                           │
│ Project A    │                                           │
│ Project B    │                                           │
│ Project C    │                                           │
│              │                                           │
└──────────────┴───────────────────────────────────────────┘

Sidebar should show:

* Active projects
* Project search
* Create project button

Archived projects should be hidden by default.

⸻

39. Project List View

Route:

/

Display projects as cards or rows.

Each project displays:

Name
Objective
Progress
Active task count
Blocked task count
Last activity

Example:

Agent Continuity
Persistent project execution across agents and sessions
████████░░ 78%
1 In Progress    2 Blocked
Last activity: 14 minutes ago

Actions:

Open
Archive

⸻

40. Project Board

Route:

/projects/:project

Default project view.

Columns:

Backlog
Ready
In Progress
Blocked
Review
Done

Tasks are ordered using sort_order.

Drag and drop between columns should update task status.

Drag and drop within a column should update task sort order.

Task card

Display:

TASK-0014
Design task claim model
HIGH
2/4 acceptance criteria
Claimed: codex
[1 blocker]

Use icons or labels for:

* Priority
* Active claim
* Blockers
* Links
* Dependencies

Clicking a task opens the task detail drawer.

⸻

41. Project Header

Display:

Project name
Objective
Progress
Last activity

Actions:

Project Context
Decisions
Activity
Links
Project Settings

⸻

42. Task Detail Drawer

Use a large right-side drawer.

Sections:

Header

TASK-0014
Task title
Status
Priority

Description

Editable Markdown text.

Context

Dedicated section with clear label:

Persistent task context

Helper text:

Information future agents need specifically to work on this task.

Acceptance criteria

Checkbox list.

Allow:

* Add
* Complete
* Reopen

Dependencies

Display:

Depends on
Blocked by incomplete dependencies
Dependents

Claim

Display:

Claimed by codex
Session abc123
Expires in 21 minutes

Human UI actions:

Release claim
Force release

Progress

Reverse chronological progress entries.

Allow humans to add progress.

Blockers

Active blockers first.

Allow:

Add blocker
Resolve blocker

Decisions

Task-scoped decisions.

Links

Generic linked resources.

Activity

Recent task activity.

⸻

43. Project Context View

Route:

/projects/:project/context

Display context in a large Markdown editor.

Header:

Project Context

Helper text:

Persistent working memory relevant to agents working anywhere in this project.

Show:

Last updated
Character count

Do not show context version history in v0.1.

Activity records context updates.

⸻

44. Decisions View

Route:

/projects/:project/decisions

Display decisions newest first.

Each card:

DEC-0007
Use lease-based task claims
Decision
Tasks use temporary leases rather than permanent assignment.
Rationale
Agent sessions are transient.
Scope
TASK-0014
Created by
Codex
Created
14 July 2026, 21:42

Support search.

Support filter:

All
Project decisions
Task decisions

⸻

45. Links View

Route:

/projects/:project/links

Group by type.

Example:

Issues
- AC-42        Jira
Repositories
- agent-continuity     GitHub
Documents
- Product Requirements Document

Known URLs should be clickable.

Do not add native provider behaviour in v0.1.

⸻

46. Activity View

Route:

/projects/:project/activity

Reverse chronological timeline.

Example:

21:42
Codex recorded decision DEC-0007
Use lease-based task claims
21:31
Codex added progress to TASK-0014
Initial lease data model designed
21:02
Codex claimed TASK-0014
20:54
TASK-0014 moved Ready → In Progress

Filters:

Task
Event type
Actor

Provide a load-more action.

⸻

47. Project Creation UI

Simple form.

Fields:

Name
Objective
Description
Context

The human UI does not need to expose projects.bootstrap.

Bootstrap is primarily an agent operation in v0.1.

Future versions may provide a paste-and-decompose interface.

⸻

48. General Agent Continuity Skill

File:

skills/agent-continuity/SKILL.md

The Skill should contain the following behaviour.

Purpose

Use Agent Continuity as persistent project state for meaningful multi-step work.

Project discovery

Before creating a project:

1. Query existing projects.
2. Look for a project matching the current body of work.
3. Prefer continuing an existing project when it clearly represents the same work.
4. Do not create duplicate projects simply because a new conversation has started.

Before project work

Before meaningful work on an existing project:

1. Retrieve the project.
2. Read project context.
3. Review current task state.
4. Identify the task requested by the user.

When the user has not specified a task:

1. Check active tasks.
2. Check actionable ready tasks.
3. Prefer high-priority actionable tasks.
4. Do not begin blocked tasks unless resolving the blocker is the work being requested.

Before task work

Retrieve the full task state.

Review:

* Description
* Task context
* Acceptance criteria
* Dependencies
* Existing progress
* Active blockers
* Decisions
* Links

Claim the task before beginning meaningful work.

Do not claim a task simply to inspect it.

Progress

Record meaningful milestones.

Good examples:

* Existing implementation analysed.
* Data model implemented.
* API routes completed.
* Integration tests added.
* Primary failure scenario identified.

Do not record:

* Opened file.
* Ran ls.
* Changed variable name.
* Read documentation.
* Ran one command.

Progress should help another agent understand how far the work has advanced.

Context

Use project context for persistent knowledge relevant across the entire project.

Use task context for persistent knowledge specifically relevant to completing a task.

Do not use context as an activity log.

Do not copy complete conversations into context.

Update context when current working knowledge changes materially.

Decisions

Record meaningful choices separately.

Examples:

* Technology selection
* Architecture choice
* Behaviour deliberately preserved
* Product scope decision
* Rejected approach with lasting implications

A decision should contain both:

* What was decided
* Why

Do not use decisions for ordinary implementation progress.

Blockers

Create a blocker when work cannot reasonably continue without:

* User clarification
* External dependency
* Missing access
* Another incomplete task
* Unresolved behaviour

Clearly state the required action when known.

Do not continue pretending a blocked task is actively progressing.

Completion

Before completing a task:

1. Review acceptance criteria.
2. Confirm each applicable criterion is complete.
3. Record final meaningful progress where useful.
4. Complete the task.

Do not force completion unless a criterion is genuinely obsolete or intentionally excluded.

When forcing completion, record a clear reason.

Handover

A manually-written handover document should normally be unnecessary.

Before ending work on an incomplete claimed task:

1. Record meaningful current progress.
2. Update task context if future agents require new working knowledge.
3. Record significant decisions.
4. Record blockers.
5. Release the claim when the session is ending and no immediate continuation is expected.

The structured task state should provide the handover.

⸻

49. Project Bootstrap Skill

File:

skills/project-bootstrap/SKILL.md

Purpose

Convert a conversation, specification, plan, issue, or body of work into a structured Agent Continuity project.

When to bootstrap

Use project bootstrap when:

* The user explicitly asks to create a project from the current work.
* A substantial body of planned work should persist beyond the current conversation.
* The project already has enough definition to identify objective, context, and initial tasks.

Do not bootstrap:

* Simple one-off questions
* Tiny tasks
* Casual conversation
* Work unlikely to require persistent state

Before creating

Query existing projects.

Avoid duplicate projects.

If an existing project clearly matches the work, add tasks or context to the existing project instead.

Extract project objective

The objective describes the intended outcome.

Good:

Build a local-first persistent execution workspace for AI agents.

Bad:

Work on Agent Continuity.

Extract project description

Provide a concise human-readable explanation of the project.

The description should explain what is being created or achieved.

Extract project context

Persist only information future agents are likely to need across the project.

Examples:

* Product philosophy
* Important constraints
* Scope boundaries
* Core assumptions
* Existing architecture
* User preferences that affect project execution

Do not include:

* Conversational filler
* Repeated discussion
* Superseded ideas without ongoing relevance
* Detailed task-specific information

Identify decisions

Extract explicit choices already made.

Example:

Decision:
Core project model remains domain agnostic.
Rationale:
Git, Jira, and other specialist concepts should be introduced through Skills and integrations.

Do not hide explicit decisions inside project context.

Create tasks

Tasks should represent actionable units of work.

Avoid:

Build the entire application

when the work can reasonably be decomposed.

Avoid excessive fragmentation.

A task should normally represent a meaningful unit that an agent could claim and progress independently.

Task descriptions

State what must be achieved.

Task context

Include task-specific prior reasoning, constraints, or rejected approaches that a future agent must know.

Acceptance criteria

Create acceptance criteria when completion should be objectively checkable.

Acceptance criteria should describe outcomes rather than implementation steps.

Good:

- Circular task dependencies are rejected
- Dependencies are limited to tasks in the same project

Bad:

- Open dependency.ts
- Add if statement

Dependencies

Create dependencies only when one task genuinely cannot proceed before another completes.

Do not turn the task list into an unnecessarily strict waterfall process.

Initial statuses

Use:

backlog

for work not yet ready.

Use:

ready

for clearly defined work that may begin immediately.

Do not create tasks directly as in_progress unless work has already genuinely started.

Bootstrap operation

Prefer projects_bootstrap over a sequence of individual create calls.

The operation should create:

* Project
* Tasks
* Acceptance criteria
* Dependencies
* Decisions
* Links

atomically.

⸻

50. Configuration

Default data directory:

Linux/macOS:

~/.agent-continuity

Database:

~/.agent-continuity/workspace.db

Configuration file:

~/.agent-continuity/config.json

Example:

{
  "server": {
    "host": "127.0.0.1",
    "port": 4732
  },
  "claims": {
    "defaultTtlMinutes": 30
  }
}

Environment variables override configuration.

Supported:

AGENT_CONTINUITY_HOST
AGENT_CONTINUITY_PORT
AGENT_CONTINUITY_DATA_DIR
AGENT_CONTINUITY_DATABASE_PATH
AGENT_CONTINUITY_CLAIM_TTL_MINUTES

The service must bind to:

127.0.0.1

by default.

It must not listen publicly by default.

⸻

51. Process Model

Command:

ac server

Starts:

HTTP API
Web UI

Default:

http://127.0.0.1:4732

The MCP server should support stdio:

ac mcp

or:

agent-continuity-mcp

The initial implementation does not require daemonisation.

Users may use:

* launchd
* systemd
* Docker
* terminal process managers

Daemon management may be added later.

⸻

52. Logging

Use structured logging.

Recommended:

pino

Default log level:

info

Development:

debug

Logs should include:

requestId
operation
projectKey
taskKey
actor
sessionId
duration

Do not log full project or task context by default.

Do not log MCP arguments containing full context fields at info level.

⸻

53. Error Codes

Define typed domain errors.

Initial codes:

PROJECT_NOT_FOUND
PROJECT_ARCHIVED
TASK_NOT_FOUND
TASK_ALREADY_CLAIMED
TASK_NOT_CLAIMED
TASK_CLAIM_MISMATCH
TASK_HAS_INCOMPLETE_ACCEPTANCE_CRITERIA
TASK_HAS_ACTIVE_BLOCKERS
BLOCKER_NOT_FOUND
BLOCKER_ALREADY_RESOLVED
DECISION_NOT_FOUND
LINK_NOT_FOUND
DEPENDENCY_NOT_FOUND
DEPENDENCY_SELF_REFERENCE
DEPENDENCY_CROSS_PROJECT
DEPENDENCY_CYCLE
ACCEPTANCE_CRITERION_NOT_FOUND
ACCEPTANCE_CRITERION_ALREADY_COMPLETE
ACCEPTANCE_CRITERION_ALREADY_OPEN
INVALID_STATUS_TRANSITION
INVALID_BOOTSTRAP_REFERENCE
INVALID_METADATA
VALIDATION_ERROR
INTERNAL_ERROR

REST errors map to suitable HTTP status codes.

MCP errors should preserve error codes where possible.

⸻

54. Validation

Use Zod schemas defined in:

packages/contracts

The same contracts should be consumed by:

* REST API
* MCP adapter
* CLI client where appropriate
* Web client

Do not manually duplicate request models.

⸻

55. API Client

Create:

packages/client

Expose a typed client:

const client = createAgentContinuityClient({
  baseUrl: "http://127.0.0.1:4732"
});

Example:

await client.tasks.get("TASK-0014");
await client.tasks.claim("TASK-0014", {
  actor: "codex",
  sessionId: "abc123"
});

The web application and CLI should use this client.

⸻

56. Testing Requirements

Core service tests

Required coverage:

Projects

* Create project
* Update project
* Archive project
* Update context
* Bootstrap transaction rollback

Tasks

* Create task
* Change status
* Complete task
* Forced completion
* Reopen task
* Parent task validation

Acceptance criteria

* Complete criterion
* Reopen criterion
* Completion rejection with incomplete criteria

Dependencies

* Add dependency
* Remove dependency
* Reject self-dependency
* Reject cross-project dependency
* Reject direct cycle
* Reject multi-level cycle

Claims

* Claim unclaimed task
* Reject duplicate active claim
* Renew matching claim
* Reject mismatched renewal
* Release claim
* Expired claim becomes inactive
* Reclaim expired task
* Progress touches matching claim

Blockers

* Add blocker
* Task moves to blocked
* Resolve only blocker with active claim
* Task returns to in_progress
* Resolve only blocker without claim
* Task returns to ready
* Resolve one of multiple blockers
* Task remains blocked

Decisions

* Project decision
* Task decision
* Reject task from another project

Links

* Project link
* Task link
* Generic metadata
* Invalid metadata

Activity

Verify events are created for every defined state mutation.

⸻

57. API Integration Tests

Use Fastify inject.

At minimum test:

POST project
POST bootstrap
GET project
POST task
POST task claim
POST progress
POST blocker
POST blocker resolve
POST decision
POST link
POST complete task
GET activity

Also verify error response structure.

⸻

58. MCP Tests

The MCP adapter must have contract tests.

For each MCP tool:

1. Validate input.
2. Call core service.
3. Return expected concise representation.
4. Preserve domain error code.

Required end-to-end MCP scenario:

1. Bootstrap project.
2. List projects.
3. Get project.
4. List actionable tasks.
5. Claim task.
6. Get task.
7. Add progress.
8. Record decision.
9. Complete acceptance criteria.
10. Complete task.
11. Query activity.

⸻

59. Web End-to-End Tests

Use Playwright.

Required scenarios:

Project workflow

1. Create project.
2. Open project.
3. Create task.
4. Drag task to Ready.
5. Open task.
6. Add context.
7. Add acceptance criterion.
8. Complete criterion.
9. Complete task.

Blocker workflow

1. Open task.
2. Add blocker.
3. Verify task appears in Blocked.
4. Resolve blocker.
5. Verify task leaves Blocked.

Activity workflow

1. Perform project mutations.
2. Open activity view.
3. Verify events appear in correct chronological order.

⸻

60. Development Phases

Phase 1 — Foundation

Build:

* Monorepo
* TypeScript configuration
* SQLite connection
* Drizzle
* Migrations
* Contracts
* ID generation
* Error model
* Basic core package

Deliverable:

The repository builds and migrations initialise a local database.

⸻

Phase 2 — Projects and Tasks

Build:

* Project repository
* Project service
* Task repository
* Task service
* Acceptance criteria
* Dependencies
* Core tests

Deliverable:

Projects and task graphs can be managed through core services.

⸻

Phase 3 — Activity

Build:

* Activity repository
* Activity service
* Event type definitions
* Integrate activity recording into project and task mutations

Deliverable:

All meaningful domain mutations generate activity events.

⸻

Phase 4 — Claims, Progress, and Blockers

Build:

* Claims
* Lease expiry
* Claim renewal
* Progress
* Automatic claim touch
* Blockers
* Status transitions

Deliverable:

An agent can claim, progress, block, resume, and hand over task work.

⸻

Phase 5 — Decisions and Links

Build:

* Decisions
* Generic links
* Metadata validation

Deliverable:

Persistent choices and external resources can be attached to project state.

⸻

Phase 6 — Project Bootstrap

Build:

* Bootstrap contracts
* Temporary refs
* Dependency resolution
* Task decision resolution
* Transactional creation
* Rollback tests

Deliverable:

An agent can create an entire project plan atomically.

⸻

Phase 7 — REST API

Build:

* Fastify application
* Routes
* Validation
* Typed errors
* Client package
* API integration tests

Deliverable:

All v0.1 domain operations are accessible over local HTTP.

⸻

Phase 8 — MCP

Build:

* MCP server
* MCP tools
* Agent-focused response formatting
* MCP contract tests

Deliverable:

Codex, Claude Code, and compatible agents can interact with Agent Continuity through structured tools.

⸻

Phase 9 — CLI

Build:

* Project commands
* Task commands
* Decision commands
* Activity commands
* JSON output mode

Deliverable:

Humans and terminal-capable agents can use Agent Continuity without MCP.

⸻

Phase 10 — Web UI

Build:

* Project sidebar
* Project list
* Project board
* Task drawer
* Context editor
* Decisions view
* Links view
* Activity timeline
* Drag and drop

Deliverable:

The user can visually manage and inspect project execution.

⸻

Phase 11 — Skills

Build:

agent-continuity
project-bootstrap

Test manually with at least two different AI coding agents.

Deliverable:

Agents consistently use the structured project workflow.

⸻

Phase 12 — Dogfooding

Create an Agent Continuity project representing Agent Continuity itself.

Import the remaining development work into the tool.

From that point onward, use Agent Continuity to manage its own development.

Test handover workflows using at least:

* Codex
* Claude Code

The specific agents may be substituted, but testing must involve two different agent systems.

⸻

61. Initial Seed Project

As soon as projects.bootstrap is available, create:

Project:
Agent Continuity

Objective:

Build a local-first persistent project execution workspace that allows AI agents to reliably manage and hand over multi-session work.

Project context:

Agent Continuity is designed primarily for AI agents.
The conversation is temporary. The agent is replaceable. Project state persists.
The core service must remain domain agnostic.
The structured service and tools are the primary agent interface.
The Kanban board and project views are the human interface.
Project context stores persistent working knowledge that applies across the project.
Task context stores persistent working knowledge specific to a task.
Explicit choices belong in decision records.
Progress and state changes belong in activity.
Agents are transient. Tasks use temporary lease-based claims rather than permanent agent assignment.
Skills define domain-specific and workflow-specific agent behaviour.

Initial decisions:

Domain-agnostic core

Decision:

The core project and task models will not contain Git-, Jira-, or software-specific fields.

Rationale:

Specialist concepts should be represented by generic links and interpreted by Skills and integrations.

Task claims use leases

Decision:

Tasks use temporary expiring claims rather than permanent agent assignment.

Rationale:

AI agents and sessions are transient.

Activity is append-only

Decision:

Progress and state history are represented through structured append-only activity events.

Rationale:

Agent handover requires reliable historical state without repeatedly overwriting generic notes.

Current state is relational

Decision:

v0.1 will not use full event sourcing. Relational tables are the source of current state and activity events provide history.

Rationale:

Full event sourcing adds complexity that is not required to validate the product.

⸻

62. Definition of Done for v0.1

Agent Continuity v0.1 is complete when the following scenario works without editing a progress.md file.

Scenario

A user discusses a new product idea with Agent A.

The user says:

Create a project from this conversation.

Agent A:

1. Finds no matching project.
2. Calls projects_bootstrap.
3. Creates the project.
4. Creates project context.
5. Creates tasks.
6. Creates acceptance criteria.
7. Creates dependencies.
8. Records existing decisions.

Agent A then:

1. Lists actionable tasks.
2. Claims a task.
3. Reads full task context.
4. Begins work.
5. Records meaningful progress.
6. Records a design decision.
7. Leaves the task incomplete.
8. Releases its claim.

Later, Agent B is started in a new conversation.

The user says:

Continue the project.

Agent B:

1. Finds the project.
2. Reads project context.
3. Inspects active and actionable work.
4. Reads the incomplete task.
5. Understands previous progress.
6. Understands the prior decision.
7. Claims the task.
8. Continues work without the user re-explaining the task.
9. Completes the acceptance criteria.
10. Completes the task.

The user opens the web UI and can see:

* The project
* Overall progress
* Task statuses
* Task context
* Both agents’ progress
* The recorded decision
* Task claim history
* The activity timeline

If this scenario works reliably across two different agent tools, v0.1 has achieved its primary goal.

⸻

63. Core Product Statement

Agent Continuity is not a Trello replacement.

It is not a Jira replacement.

It is not an AI memory database.

It is a persistent execution workspace for work performed through AI agents.

The board visualises work for humans.

The API and MCP tools expose work to agents.

Skills teach agents how to behave.

The project state survives them all.

Persistent project execution across agents and sessions.
