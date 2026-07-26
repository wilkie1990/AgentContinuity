---
name: project-bootstrap
description: Convert a conversation, specification, plan, issue, or body of work into a structured Agent Continuity project in one atomic operation - project, context, tasks, acceptance criteria, dependencies, decisions and links. Use when the user says "create a project from this", "turn this into tasks", "let's plan this properly", or when substantial planned work should persist beyond the current conversation.
---

# Project bootstrap

Turns a plan into persistent project state with a single `projects_bootstrap` call.
Everything is created in one transaction: if any part is invalid, nothing is created.

## When to bootstrap

Bootstrap when:

- The user explicitly asks to create a project from the current work.
- A substantial body of planned work should persist beyond this conversation.
- The work already has enough definition to identify an objective, context, and initial
  tasks.

Do **not** bootstrap:

- Simple one-off questions
- Tiny tasks
- Casual conversation
- Work unlikely to need persistent state

## Before creating

Call `projects_list` first. Avoid duplicate projects. If an existing project clearly
matches this work, add tasks and context to that project instead (`tasks_create`,
`projects_update_context`).

## What to extract

### Objective

The intended outcome, in one sentence.

Good: `Build a local-first persistent execution workspace for AI agents.`

Bad: `Work on Agent Continuity.`

### Description

A concise human-readable explanation of what is being created or achieved.

### Project context

Persist only what future agents are likely to need across the whole project:

- Product philosophy
- Important constraints
- Scope boundaries
- Core assumptions
- Existing architecture
- User preferences that affect execution

Do not include conversational filler, repeated discussion, superseded ideas with no
ongoing relevance, or detailed task-specific information (that belongs in task context).

### Decisions

Extract explicit choices that have already been made, with their reasoning. Each needs
both what was decided and why.

```
Decision:  Core project model remains domain agnostic.
Rationale: Git, Jira and other specialist concepts should be introduced through Skills
           and integrations rather than core fields.
```

Do not hide explicit decisions inside project context — record them as decisions so they
are searchable and can later be superseded.

### Tasks

Tasks should be actionable units of work that an agent could claim and progress
independently.

Avoid a single `Build the entire application` task when the work can reasonably be
decomposed. Equally, avoid excessive fragmentation — a task is not a checklist item.

- **Description**: state what must be achieved.
- **Context**: task-specific prior reasoning, constraints, or rejected approaches a
  future agent must know.

### Acceptance criteria

Add criteria when completion should be objectively checkable. Describe outcomes, not
implementation steps.

Good:

- Circular task dependencies are rejected
- Dependencies are limited to tasks in the same project

Bad:

- Open dependency.ts
- Add if statement

### Dependencies

Use `depends_on` only when one task genuinely cannot proceed before another completes.
Do not turn the task list into an unnecessarily strict waterfall. Cycles are rejected.

### Initial statuses

- `backlog` — work that is not ready to start.
- `ready` — clearly defined work that may begin immediately.

Do not create tasks directly as `in_progress` unless work has genuinely already started.

## The call

Prefer one `projects_bootstrap` over a sequence of individual create calls. `ref` values
are temporary labels used only inside the request; the service returns the real keys in
`refMap`.

```json
{
  "name": "Agent Continuity",
  "objective": "Build a local-first persistent execution workspace for AI agents",
  "context": "The conversation is temporary. The agent is replaceable. Project state persists.\nThe core service must remain domain agnostic.",
  "tasks": [
    {
      "ref": "task-model",
      "title": "Design the task model",
      "status": "ready",
      "priority": "high",
      "acceptance_criteria": [
        "Tasks carry status, priority and persistent context",
        "Task keys are human readable"
      ]
    },
    {
      "ref": "claim-model",
      "title": "Design the task claim model",
      "context": "Permanent agent assignment was rejected because agents and sessions are transient.",
      "depends_on": ["task-model"],
      "acceptance_criteria": ["Claims expire", "An expired claim can be reclaimed safely"]
    }
  ],
  "decisions": [
    {
      "title": "Task claims use leases",
      "decision": "Tasks use temporary expiring claims rather than permanent assignment.",
      "rationale": "AI agents and sessions are transient.",
      "task_ref": "claim-model"
    }
  ],
  "links": [
    { "type": "repository", "provider": "github", "reference": "agent-continuity" }
  ],
  "actor": "claude-code",
  "session_id": "<this session>"
}
```

## After bootstrapping

Report the created project key and the task keys to the user, then switch to the
`agent-continuity` skill for the actual work: pick an actionable task, claim it, and
record progress as you go.
