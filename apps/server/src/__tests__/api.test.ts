import { createTestWorkspace, type TestWorkspace } from "@agent-workspace/core/testing";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { API_PREFIX, buildServer } from "../app.js";

type Json = Record<string, any>;

describe("REST API", () => {
  let workspace: TestWorkspace;
  let app: FastifyInstance;

  const call = async (
    method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
    url: string,
    payload?: unknown,
  ) => {
    const response = await app.inject({
      method,
      url: url.startsWith("/health") ? url : `${API_PREFIX}${url}`,
      ...(payload === undefined ? {} : { payload }),
    });
    return {
      status: response.statusCode,
      body: (response.body ? JSON.parse(response.body) : {}) as Json,
    };
  };

  beforeEach(() => {
    workspace = createTestWorkspace();
    app = buildServer({ workspace, logLevel: "silent", webRoot: null });
  });

  afterEach(async () => {
    await app.close();
    workspace.close();
  });

  it("reports health", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ status: "ok", version: "0.1.0" });
  });

  it("creates, reads, updates and archives a project", async () => {
    const created = await call("POST", "/projects", {
      name: "Agent Workspace",
      objective: "Build a persistent execution layer for AI agents",
      actor: "codex",
    });
    expect(created.status).toBe(201);
    expect(created.body.project.key).toBe("PRJ-0001");

    const fetched = await call("GET", "/projects/PRJ-0001");
    expect(fetched.status).toBe(200);
    expect(fetched.body.project.taskCounts).toEqual({
      backlog: 0,
      ready: 0,
      inProgress: 0,
      blocked: 0,
      review: 0,
      done: 0,
    });
    expect(fetched.body.project.progress).toBeNull();

    const updated = await call("PATCH", "/projects/PRJ-0001", { name: "Agent Workspace v0.1" });
    expect(updated.body.project.name).toBe("Agent Workspace v0.1");

    const context = await call("PUT", "/projects/PRJ-0001/context", {
      context: "Project state persists.",
      actor: "codex",
    });
    expect(context.body.project.context).toBe("Project state persists.");

    const listed = await call("GET", "/projects?status=active&sort=name_asc");
    expect(listed.body.total).toBe(1);

    const archived = await call("POST", "/projects/PRJ-0001/archive", { actor: "adam" });
    expect(archived.body.project.status).toBe("archived");
  });

  it("bootstraps a project atomically", async () => {
    const response = await call("POST", "/projects/bootstrap", {
      name: "Agent Workspace",
      objective: "Persistent project execution for AI agents",
      context: "The conversation is temporary.",
      tasks: [
        { ref: "task-model", title: "Design task model", status: "ready" },
        { ref: "claim-model", title: "Design task claim model", dependsOn: ["task-model"] },
      ],
      decisions: [
        { title: "Claims are leases", decision: "Tasks use temporary claims.", taskRef: "claim-model" },
      ],
      links: [{ type: "repository", provider: "github", reference: "agent-workspace" }],
      actor: "codex",
    });

    expect(response.status).toBe(201);
    expect(response.body.refMap).toEqual({
      "task-model": "TASK-0001",
      "claim-model": "TASK-0002",
    });
    expect(response.body.tasks).toHaveLength(2);
    expect(response.body.decisions).toHaveLength(1);
    expect(response.body.links).toHaveLength(1);
  });

  it("accepts a snake_case bootstrap plan and rejects unknown fields", async () => {
    const snake = await call("POST", "/projects/bootstrap", {
      name: "Trailhead",
      tasks: [
        { ref: "store", title: "Storage layer", acceptance_criteria: ["Migrations are versioned"] },
        { ref: "log", title: "Log command", depends_on: ["store"] },
      ],
      decisions: [{ title: "SQLite", decision: "Store hikes in SQLite.", task_ref: "store" }],
    });

    expect(snake.status).toBe(201);
    expect(snake.body.tasks[0].acceptanceCriteriaTotal).toBe(1);
    expect(snake.body.tasks[1].dependencyCount).toBe(1);
    expect(snake.body.decisions[0].taskKey).toBe(snake.body.refMap.store);

    const bogus = await call("POST", "/projects/bootstrap", {
      name: "Trailhead",
      totallyBogusField: 42,
    });
    expect(bogus.status).toBe(400);
    expect(bogus.body.error.code).toBe("VALIDATION_ERROR");
    expect(bogus.body.error.message).toContain("totallyBogusField");
  });

  it("rejects a misspelled field on task creation instead of ignoring it", async () => {
    await call("POST", "/projects", { name: "Agent Workspace" });
    const response = await call("POST", "/projects/PRJ-0001/tasks", {
      title: "Task",
      acceptance_criteria: ["would have been silently dropped"],
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("deletes a task and reports what went with it", async () => {
    await call("POST", "/projects", { name: "Agent Workspace" });
    await call("POST", "/projects/PRJ-0001/tasks", {
      title: "Created in error",
      acceptanceCriteria: ["One"],
    });
    await call("POST", "/tasks/TASK-0001/progress", { content: "Some work", actor: "adam" });

    const deleted = await call("DELETE", "/tasks/TASK-0001", { actor: "adam" });
    expect(deleted.status).toBe(200);
    expect(deleted.body.deleted.key).toBe("TASK-0001");
    expect(deleted.body.deleted.removed.acceptanceCriteria).toBe(1);
    expect(deleted.body.deleted.removed.progress).toBe(1);

    expect((await call("GET", "/tasks/TASK-0001")).status).toBe(404);
    expect((await call("GET", "/projects/PRJ-0001/tasks")).body.tasks).toHaveLength(0);

    const activity = await call("GET", "/projects/PRJ-0001/activity");
    expect(activity.body.events[0].eventType).toBe("task.deleted");
    expect(activity.body.events[0].payload.taskKey).toBe("TASK-0001");
  });

  it("refuses to delete a claimed task without force", async () => {
    await call("POST", "/projects", { name: "Agent Workspace" });
    await call("POST", "/projects/PRJ-0001/tasks", { title: "Claimed" });
    await call("POST", "/tasks/TASK-0001/claim", { actor: "codex" });

    const refused = await call("DELETE", "/tasks/TASK-0001", { actor: "adam" });
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe("TASK_ALREADY_CLAIMED");

    const forced = await call("DELETE", "/tasks/TASK-0001", { actor: "adam", force: true });
    expect(forced.status).toBe(200);
  });

  it("runs the full task lifecycle over HTTP", async () => {
    await call("POST", "/projects", { name: "Agent Workspace" });

    const created = await call("POST", "/projects/PRJ-0001/tasks", {
      title: "Design task claim model",
      status: "ready",
      priority: "high",
      acceptanceCriteria: ["Defines expiry behaviour"],
      actor: "codex",
    });
    expect(created.status).toBe(201);
    const taskKey = created.body.task.key as string;

    const claimed = await call("POST", `/tasks/${taskKey}/claim`, {
      actor: "codex",
      sessionId: "abc123",
    });
    expect(claimed.status).toBe(201);
    expect(claimed.body.claim.actor).toBe("codex");
    expect(claimed.body.task.status).toBe("in_progress");

    const renewed = await call("POST", `/tasks/${taskKey}/claim/renew`, {
      actor: "codex",
      sessionId: "abc123",
    });
    expect(renewed.body.claim.expiresInMinutes).toBe(30);

    const progress = await call("POST", `/tasks/${taskKey}/progress`, {
      content: "Initial lease data model designed.",
      actor: "codex",
      sessionId: "abc123",
    });
    expect(progress.status).toBe(201);

    const blocked = await call("POST", `/tasks/${taskKey}/blockers`, {
      description: "Expected provider behaviour is unclear.",
      requiredAction: "Confirm whether legacy behaviour must be preserved.",
      actor: "codex",
    });
    expect(blocked.status).toBe(201);
    expect(blocked.body.task.status).toBe("blocked");

    const resolved = await call("POST", `/blockers/${blocked.body.blocker.key}/resolve`, {
      resolution: "Confirmed that existing behaviour must be preserved.",
      actor: "adam",
    });
    expect(resolved.body.task.status).toBe("in_progress");

    const decision = await call("POST", "/projects/PRJ-0001/decisions", {
      task: taskKey,
      title: "Use lease-based task claims",
      decision: "Tasks use temporary claims rather than permanent assignment.",
      rationale: "Agent sessions are transient.",
      actor: "codex",
    });
    expect(decision.status).toBe(201);
    expect(decision.body.decision.key).toBe("DEC-0001");

    const link = await call("POST", "/projects/PRJ-0001/links", {
      task: taskKey,
      type: "issue",
      provider: "jira",
      reference: "AW-42",
      metadata: { status: "In Progress" },
      actor: "codex",
    });
    expect(link.status).toBe(201);
    expect(link.body.links[0].metadata).toEqual({ status: "In Progress" });

    const detail = await call("GET", `/tasks/${taskKey}`);
    expect(detail.body.task.acceptanceCriteria).toHaveLength(1);
    expect(detail.body.task.decisions).toHaveLength(1);
    expect(detail.body.task.links).toHaveLength(1);
    expect(detail.body.task.progress).toHaveLength(1);
    expect(detail.body.task.resolvedBlockers).toHaveLength(1);
    expect(detail.body.task.recentActivity.length).toBeGreaterThan(0);

    const criterionId = detail.body.task.acceptanceCriteria[0].id as string;
    const rejected = await call("POST", `/tasks/${taskKey}/complete`, { actor: "codex" });
    expect(rejected.status).toBe(409);
    expect(rejected.body.error.code).toBe("TASK_HAS_INCOMPLETE_ACCEPTANCE_CRITERIA");

    const completedCriterion = await call(
      "POST",
      `/acceptance-criteria/${criterionId}/complete`,
      { actor: "codex" },
    );
    expect(completedCriterion.body.acceptanceCriterion.isComplete).toBe(true);

    const completed = await call("POST", `/tasks/${taskKey}/complete`, { actor: "codex" });
    expect(completed.status).toBe(200);
    expect(completed.body.task.status).toBe("done");
    expect(completed.body.task.claim).toBeNull();
  });

  it("manages dependencies over HTTP", async () => {
    await call("POST", "/projects", { name: "Agent Workspace" });
    await call("POST", "/projects/PRJ-0001/tasks", { title: "A" });
    await call("POST", "/projects/PRJ-0001/tasks", { title: "B" });

    const added = await call("POST", "/tasks/TASK-0001/dependencies", { dependsOn: "TASK-0002" });
    expect(added.status).toBe(201);
    expect(added.body.task.dependencyCount).toBe(1);

    const cycle = await call("POST", "/tasks/TASK-0002/dependencies", { dependsOn: "TASK-0001" });
    expect(cycle.status).toBe(409);
    expect(cycle.body.error.code).toBe("DEPENDENCY_CYCLE");
    expect(cycle.body.error.details.cycle).toBe("TASK-0002 → TASK-0001 → TASK-0002");

    const removed = await call("DELETE", "/tasks/TASK-0001/dependencies/TASK-0002");
    expect(removed.body.task.dependencyCount).toBe(0);
  });

  it("filters project tasks by repeated status parameters", async () => {
    await call("POST", "/projects", { name: "Agent Workspace" });
    await call("POST", "/projects/PRJ-0001/tasks", { title: "Ready", status: "ready" });
    await call("POST", "/projects/PRJ-0001/tasks", { title: "Backlog" });
    await call("POST", "/projects/PRJ-0001/tasks", { title: "Review", status: "review" });

    const filtered = await call("GET", "/projects/PRJ-0001/tasks?status=ready&status=review");
    expect(filtered.body.tasks.map((task: Json) => task.title).sort()).toEqual(["Ready", "Review"]);

    const actionable = await call("GET", "/projects/PRJ-0001/tasks?actionable=true");
    expect(actionable.body.tasks.map((task: Json) => task.title)).toEqual(["Ready"]);

    const notActionable = await call("GET", "/projects/PRJ-0001/tasks?actionable=false");
    expect(notActionable.body.tasks).toHaveLength(2);
  });

  it("returns paginated activity in reverse chronological order", async () => {
    await call("POST", "/projects", { name: "Agent Workspace", actor: "codex" });
    await call("POST", "/projects/PRJ-0001/tasks", { title: "A", actor: "codex" });
    await call("POST", "/tasks/TASK-0001/progress", { content: "Step one", actor: "codex" });
    await call("POST", "/tasks/TASK-0001/progress", { content: "Step two", actor: "codex" });

    const page = await call("GET", "/projects/PRJ-0001/activity?limit=2");
    expect(page.body.events).toHaveLength(2);
    expect(page.body.events[0].eventType).toBe("task.progress_added");
    expect(page.body.nextCursor).toBeTruthy();

    const next = await call(
      "GET",
      `/projects/PRJ-0001/activity?limit=10&cursor=${encodeURIComponent(page.body.nextCursor)}`,
    );
    expect(next.body.events.at(-1).eventType).toBe("project.created");
    expect(next.body.nextCursor).toBeNull();

    const filtered = await call(
      "GET",
      "/projects/PRJ-0001/activity?eventType=task.progress_added&actor=codex",
    );
    expect(filtered.body.events).toHaveLength(2);
  });

  it("returns the documented error envelope", async () => {
    const missing = await call("GET", "/projects/PRJ-9999");
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({
      error: {
        code: "PROJECT_NOT_FOUND",
        message: 'No project matches "PRJ-9999".',
        details: { ref: "PRJ-9999" },
      },
    });

    const invalid = await call("POST", "/projects", { objective: "Missing name" });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe("VALIDATION_ERROR");
    expect(invalid.body.error.details.issues[0].path).toBe("name");

    const forcedWithoutReason = await call("POST", "/projects", { name: "P" }).then(() =>
      call("POST", "/projects/PRJ-0001/tasks", { title: "T" }),
    );
    expect(forcedWithoutReason.status).toBe(201);

    const badForce = await call("POST", "/tasks/TASK-0001/complete", { force: true });
    expect(badForce.status).toBe(400);
    expect(badForce.body.error.code).toBe("VALIDATION_ERROR");

    const unknownRoute = await app.inject({ method: "GET", url: "/api/v1/nope" });
    expect(unknownRoute.statusCode).toBe(404);
    expect(JSON.parse(unknownRoute.body).error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects a duplicate claim with a conflict", async () => {
    await call("POST", "/projects", { name: "Agent Workspace" });
    await call("POST", "/projects/PRJ-0001/tasks", { title: "Claimed task" });
    await call("POST", "/tasks/TASK-0001/claim", { actor: "codex" });

    const conflict = await call("POST", "/tasks/TASK-0001/claim", { actor: "claude-code" });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe("TASK_ALREADY_CLAIMED");
    expect(conflict.body.error.details.actor).toBe("codex");
  });

  it("releases a claim and deletes acceptance criteria and links", async () => {
    await call("POST", "/projects", { name: "Agent Workspace" });
    await call("POST", "/projects/PRJ-0001/tasks", { title: "Task" });
    await call("POST", "/tasks/TASK-0001/claim", { actor: "codex" });

    const released = await call("POST", "/tasks/TASK-0001/claim/release", {
      actor: "codex",
      reason: "session ending",
    });
    expect(released.body.task.claim).toBeNull();

    const criteria = await call("POST", "/tasks/TASK-0001/acceptance-criteria", {
      criteria: ["Outcome is checkable"],
    });
    const criterionId = criteria.body.acceptanceCriteria[0].id as string;
    const deleted = await call("DELETE", `/acceptance-criteria/${criterionId}`);
    expect(deleted.status).toBe(204);

    const link = await call("POST", "/projects/PRJ-0001/links", { type: "document", url: "https://x" });
    const removed = await call("DELETE", `/links/${link.body.links[0].key}`);
    expect(removed.status).toBe(204);
    expect((await call("GET", "/projects/PRJ-0001/links")).body.links).toHaveLength(0);
  });
});
