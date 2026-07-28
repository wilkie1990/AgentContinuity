import { createTestWorkspace, type TestWorkspace } from "@agent-continuity/core/testing";
import type { FastifyInstance } from "fastify";
import { mkdtempSync, mkdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { API_PREFIX, buildServer } from "../app.js";

type Json = Record<string, any>;
const temporaryDirectories: string[] = [];

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
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("reports health", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ status: "ok", version: "0.1.0" });
  });

  it("exposes exact-session handoff status without returning workspace content", async () => {
    await call("POST", "/projects", { name: "Continuity" });
    await call("POST", "/projects/PRJ-0001/tasks", {
      title: "Relevant work",
      status: "ready",
    });
    await call("POST", "/projects/PRJ-0001/tasks", {
      title: "Another session",
      status: "ready",
    });
    await call("POST", "/tasks/TASK-0001/claim", {
      actor: "codex",
      sessionId: "provider-session",
    });
    await call("POST", "/tasks/TASK-0002/claim", {
      actor: "codex",
      sessionId: "other-session",
    });

    const response = await call("GET", "/sessions/provider-session/handoff-status");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      sessionId: "provider-session",
      tasks: [
        expect.objectContaining({
          taskKey: "TASK-0001",
          actor: "codex",
          checkpointState: "missing",
        }),
      ],
    });
    expect(JSON.stringify(response.body)).not.toContain("Relevant work");
    expect(JSON.stringify(response.body)).not.toContain("Another session");

  });

  it("exposes filtered unified search with safe punctuation handling", async () => {
    await call("POST", "/projects", {
      name: "Search API",
      context: "projectapineedle",
    });
    await call("POST", "/projects/PRJ-0001/tasks", {
      title: "Taskapineedle",
      context: "taskapicontextneedle",
      acceptanceCriteria: ["criterionapineedle"],
    });

    const task = await call(
      "GET",
      "/search?q=taskapineedle&project=PRJ-0001&task=TASK-0001&type=task&limit=5",
    );
    expect(task.status).toBe(200);
    expect(task.body).toMatchObject({
      query: "taskapineedle",
      limit: 5,
      results: [
        {
          sourceType: "task",
          projectKey: "PRJ-0001",
          taskKey: "TASK-0001",
          sourceKey: "TASK-0001",
        },
      ],
    });

    const punctuation = await call("GET", "/search?q=%22unterminated%20OR%20NEAR%20(%20***");
    expect(punctuation.status).toBe(200);
    expect(punctuation.body.results).toEqual([]);

    const invalidType = await call("GET", "/search?q=needle&type=unknown");
    expect(invalidType.status).toBe(400);
    expect(invalidType.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("persists execution liveness, checkpoints, plans, evidence and origins", async () => {
    await call("POST", "/projects", { name: "Continuity", actor: "codex" });
    const task = await call("POST", "/projects/PRJ-0001/tasks", { title: "Run work", status: "ready", actor: "codex" });
    const taskKey = task.body.task.key as string;
    expect((await call("POST", `/tasks/${taskKey}/claim`, { actor: "codex", sessionId: "run-1" })).status).toBe(201);
    const heartbeat = await call("POST", `/tasks/${taskKey}/heartbeat`, { actor: "codex", sessionId: "run-1", phase: "Implementing" });
    expect(heartbeat.body.execution.health).toBe("active");
    const checkpoint = await call("POST", `/tasks/${taskKey}/checkpoints`, { completed: "Schema", workingOn: "Routes", next: "Tests", actor: "codex" });
    expect(checkpoint.status).toBe(201);
    const plan = await call("PUT", `/tasks/${taskKey}/work-plan`, { items: ["Schema", "Routes"], actor: "codex" });
    expect(plan.body.workPlan).toHaveLength(2);
    const criteria = await call("POST", `/tasks/${taskKey}/acceptance-criteria`, { criteria: ["Covered"], actor: "codex" });
    const criterionId = criteria.body.acceptanceCriteria[0].id as string;
    const evidence = await call(
      "POST",
      `/tasks/${taskKey}/acceptance-criteria/${criterionId}/evidence`,
      {
        kind: "test",
        name: "REST suite",
        outcome: "passed",
        reference: "api.test.ts",
        actor: "codex",
      },
    );
    expect(evidence.status).toBe(201);
    expect(evidence.body.evidence).toMatchObject({
      kind: "test",
      name: "REST suite",
      outcome: "passed",
    });
    expect(
      (
        await call(
          "PUT",
          `/tasks/${taskKey}/acceptance-criteria/${criterionId}/evidence-policy`,
          {
            minimumCount: 1,
            qualifyingKinds: ["test"],
            requireSha: false,
            requirePassingVerification: false,
            actor: "codex",
          },
        )
      ).body.policy,
    ).toMatchObject({ minimumCount: 1, qualifyingKinds: ["test"] });
    expect(
      (
        await call(
          "GET",
          `/tasks/${taskKey}/acceptance-criteria/${criterionId}/evidence`,
        )
      ).body.evidence,
    ).toHaveLength(1);
    expect(
      (
        await call(
          "POST",
          `/tasks/${taskKey}/acceptance-criteria/${criterionId}/verify`,
          { executable: "node", args: [] },
        )
      ).status,
    ).toBe(404);
    expect((await call("POST", `/tasks/${taskKey}/execution/origins`, { provider: "codex", reference: "thread-1", url: "https://example.test/thread-1" })).status).toBe(201);
    const executionState = (await call("GET", `/tasks/${taskKey}/execution`)).body;
    expect(Object.keys(executionState).sort()).toEqual([
      "checkpoints",
      "collisions",
      "execution",
      "handoff",
      "ownership",
      "provenance",
      "workPlan",
    ]);
    expect(executionState.execution.origins[0].provider).toBe("codex");
  });

  it("manages explicit repositories and execution worktrees without leaking paths", async () => {
    const root = mkdtempSync(join(tmpdir(), "agent-continuity-api-repository-"));
    temporaryDirectories.push(root);
    const worktree = join(root, "worktree");
    mkdirSync(worktree);

    await call("POST", "/projects", { name: "Repository API", actor: "codex" });
    const associated = await call("POST", "/projects/PRJ-0001/repositories", {
      label: "Main",
      rootPath: root,
      remoteUrl: "https://example.test/team/main.git/",
      actor: "codex",
    });
    expect(associated.status).toBe(201);
    expect(associated.body.repository).toMatchObject({
      key: "REP-0001",
      label: "Main",
      primary: true,
      rootPath: realpathSync.native(root),
    });

    const updated = await call("PATCH", "/projects/PRJ-0001/repositories/REP-0001", {
      label: "Main repository",
    });
    expect(updated.body.repository.label).toBe("Main repository");
    expect((await call("GET", "/projects/PRJ-0001/repositories")).body.repositories).toHaveLength(1);

    await call("POST", "/projects/PRJ-0001/links", {
      type: "repository",
      provider: "github",
      url: "https://github.com/example/main",
    });
    await call("POST", "/projects/PRJ-0001/tasks", {
      title: "Bound execution",
      status: "ready",
    });
    const started = await call("POST", "/tasks/TASK-0001/start-work", {
      actor: "codex",
      sessionId: "repository-api-run",
      worktree: {
        repository: "REP-0001",
        worktreePath: worktree,
        branch: "feature/api",
      },
    });
    expect(started.status).toBe(200);
    expect(started.body.execution.execution.worktree).toMatchObject({
      repositoryKey: "REP-0001",
      branch: "feature/api",
    });
    expect(JSON.stringify(started.body.execution.execution.worktree)).not.toContain(
      realpathSync.native(root),
    );
    expect(started.body.execution.provenance.baseline).toMatchObject({
      source: "local_git",
      status: "error",
      error: { code: "not_git_repository" },
    });
    const ownership = await call(
      "PUT",
      "/tasks/TASK-0001/execution/path-ownership",
      {
        paths: [
          { path: "src/index.ts", kind: "file" },
          { path: "docs", kind: "directory" },
        ],
        actor: "codex",
        sessionId: "repository-api-run",
      },
    );
    expect(ownership.status).toBe(200);
    expect(ownership.body).toMatchObject({
      ownership: {
        version: 1,
        paths: [
          expect.objectContaining({ path: "docs", kind: "directory" }),
          expect.objectContaining({ path: "src/index.ts", kind: "file" }),
        ],
      },
      collisions: [],
    });
    expect(
      (await call("GET", "/tasks/TASK-0001/execution/path-ownership")).body,
    ).toMatchObject({ ownership: { version: 1 }, collisions: [] });
    const invalidOwnership = await call(
      "PUT",
      "/tasks/TASK-0001/execution/path-ownership",
      {
        paths: [{ path: "C:/outside", kind: "file" }],
        actor: "codex",
        sessionId: "repository-api-run",
      },
    );
    expect(invalidOwnership.status).toBe(400);
    expect(invalidOwnership.body.error.code).toBe("VALIDATION_ERROR");
    const provenance = await call("GET", "/tasks/TASK-0001/execution/git-provenance");
    expect(provenance.body.provenance.baseline.repositoryKey).toBe("REP-0001");
    const captured = await call(
      "POST",
      "/tasks/TASK-0001/execution/git-provenance/capture",
      {},
    );
    expect(captured.status).toBe(201);
    expect(captured.body.provenance).toMatchObject({
      trigger: "manual",
      source: "local_git",
      status: "error",
    });

    const explicit = await call("GET", "/tasks/TASK-0001/execution/worktree");
    expect(explicit.body.worktree).toMatchObject({
      worktreePath: realpathSync.native(worktree),
      relativePath: "worktree",
    });
    await call("POST", "/projects/PRJ-0001/tasks", {
      title: "Missing worktree",
      status: "ready",
    });
    const unavailable = await call("POST", "/tasks/TASK-0002/start-work", {
      actor: "codex",
      sessionId: "missing-run",
      worktree: {
        repository: "REP-0001",
        worktreePath: join(root, "missing"),
      },
    });
    expect(unavailable.status).toBe(422);
    expect(unavailable.body.error.code).toBe("REPOSITORY_PATH_UNAVAILABLE");
    expect((await call("GET", "/tasks/TASK-0002")).body.task).toMatchObject({
      status: "ready",
      claim: null,
      execution: null,
    });
    const refused = await call("DELETE", "/projects/PRJ-0001/repositories/REP-0001", {
      force: true,
    });
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe("REPOSITORY_IN_USE");

    const unbound = await call("DELETE", "/tasks/TASK-0001/execution/worktree", {
      actor: "codex",
      sessionId: "repository-api-run",
    });
    expect(unbound.status).toBe(200);
    expect(
      (await call("DELETE", "/projects/PRJ-0001/repositories/REP-0001", { force: false }))
        .status,
    ).toBe(200);
    expect((await call("GET", "/projects/PRJ-0001/links")).body.links).toHaveLength(1);
  });

  it("runs start, report and handoff composites over HTTP", async () => {
    await call("POST", "/projects", {
      name: "Composite API",
      context: "Project context returned at start.",
    });
    await call("POST", "/projects/PRJ-0001/tasks", {
      title: "Composite lifecycle",
      context: "Task context returned at start.",
      status: "ready",
    });

    const missingSession = await call("POST", "/tasks/TASK-0001/start-work", {
      actor: "codex",
    });
    expect(missingSession.status).toBe(400);
    expect(missingSession.body.error.code).toBe("VALIDATION_ERROR");

    const started = await call("POST", "/tasks/TASK-0001/start-work", {
      actor: "codex",
      sessionId: "run-1",
    });
    expect(started.status).toBe(200);
    expect(started.body.project.context).toBe("Project context returned at start.");
    expect(started.body.task.context).toBe("Task context returned at start.");
    expect(started.body.task.claim.actor).toBe("codex");
    expect(started.body.execution.execution.health).toBe("active");

    const reported = await call("POST", "/tasks/TASK-0001/report", {
      actor: "codex",
      sessionId: "run-1",
      phase: "Adapter tests",
      progress: "REST workflow exposed.",
      checkpoint: {
        completed: "Core",
        workingOn: "Adapters",
        next: "Verify handoff",
      },
    });
    expect(reported.status).toBe(200);
    expect(reported.body.execution.currentPhase).toBe("Adapter tests");
    expect(reported.body.progress.content).toBe("REST workflow exposed.");
    expect(reported.body.checkpoint.next).toBe("Verify handoff");

    const handedOff = await call("POST", "/tasks/TASK-0001/handoff", {
      actor: "codex",
      sessionId: "run-1",
      checkpoint: {
        completed: "Core and REST",
        workingOn: "Verification",
        next: "Continue test suite",
      },
    });
    expect(handedOff.status).toBe(200);
    expect(handedOff.body.task.claim).toBeNull();
    expect(handedOff.body.handoff.nextAction).toBe("Continue test suite");

    const invalid = await call("POST", "/tasks/TASK-0001/handoff", {
      actor: "codex",
      sessionId: "run-1",
    });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("creates, reads, updates and archives a project", async () => {
    const created = await call("POST", "/projects", {
      name: "Agent Continuity",
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

    const updated = await call("PATCH", "/projects/PRJ-0001", { name: "Agent Continuity v0.1" });
    expect(updated.body.project.name).toBe("Agent Continuity v0.1");

    const context = await call("PUT", "/projects/PRJ-0001/context", {
      context: "Project state persists.",
      expectedVersion: 0,
      actor: "codex",
    });
    expect(context.body.project.context).toBe("Project state persists.");

    const listed = await call("GET", "/projects?status=active&sort=name_asc");
    expect(listed.body.total).toBe(1);

    const archived = await call("POST", "/projects/PRJ-0001/archive", { actor: "adam" });
    expect(archived.body.project.status).toBe("archived");
  });

  it("exposes bounded versioned context with conflicts and append-only reverts", async () => {
    const created = await call("POST", "/projects", {
      name: "Context API",
      context: "project version one",
      actor: "codex",
    });
    expect(created.body.project).toMatchObject({
      contextVersion: 1,
      contextSize: { characters: 19, bytes: 19, overSoftLimit: false },
    });
    await call("POST", "/projects/PRJ-0001/tasks", {
      title: "Context task",
      context: "task version one",
    });

    const updated = await call("PUT", "/projects/PRJ-0001/context", {
      context: "project version two",
      expectedVersion: 1,
      reason: "API edit",
      actor: "codex",
    });
    expect(updated.body.project.contextVersion).toBe(2);

    const history = await call(
      "GET",
      "/projects/PRJ-0001/context/versions?limit=1",
    );
    expect(history.body.versions).toHaveLength(1);
    expect(history.body.versions[0]).toMatchObject({
      version: 2,
      reason: "API edit",
      isCurrent: true,
    });
    expect(history.body.versions[0]).not.toHaveProperty("content");
    expect(history.body.nextBeforeVersion).toBe(2);

    const version = await call(
      "GET",
      "/projects/PRJ-0001/context/versions/1",
    );
    expect(version.body.version.content).toBe("project version one");

    const stale = await call("PUT", "/projects/PRJ-0001/context", {
      context: "stale",
      expectedVersion: 1,
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("CONTEXT_VERSION_CONFLICT");

    const reverted = await call("POST", "/projects/PRJ-0001/context/revert", {
      targetVersion: 1,
      expectedVersion: 2,
      actor: "codex",
    });
    expect(reverted.body.project).toMatchObject({
      context: "project version one",
      contextVersion: 3,
    });

    const taskUpdated = await call("PUT", "/tasks/TASK-0001/context", {
      context: "task version two",
      expectedVersion: 1,
    });
    expect(taskUpdated.body.task.contextVersion).toBe(2);
    const taskHistory = await call("GET", "/tasks/TASK-0001/context/versions");
    expect(taskHistory.body.versions.map((entry: Json) => entry.version)).toEqual([2, 1]);
    expect(
      (await call("GET", "/tasks/TASK-0001/context/versions/1")).body.version.content,
    ).toBe("task version one");
    expect(
      (
        await call("POST", "/tasks/TASK-0001/context/revert", {
          targetVersion: 1,
          expectedVersion: 2,
        })
      ).body.task.contextVersion,
    ).toBe(3);

    const missingExpected = await call("PUT", "/tasks/TASK-0001/context", {
      context: "unsafe",
    });
    expect(missingExpected.status).toBe(400);
    expect(missingExpected.body.error.code).toBe("VALIDATION_ERROR");

    const tooLarge = await call("PUT", "/projects/PRJ-0001/context", {
      context: "x".repeat(256 * 1024 + 1),
      expectedVersion: 3,
    });
    expect(tooLarge.status).toBe(413);
    expect(tooLarge.body.error.code).toBe("CONTEXT_TOO_LARGE");
  });

  it("bootstraps a project atomically", async () => {
    const response = await call("POST", "/projects/bootstrap", {
      name: "Agent Continuity",
      objective: "Persistent project execution across agents and sessions",
      context: "The conversation is temporary.",
      tasks: [
        { ref: "task-model", title: "Design task model", status: "ready" },
        { ref: "claim-model", title: "Design task claim model", dependsOn: ["task-model"] },
      ],
      decisions: [
        { title: "Claims are leases", decision: "Tasks use temporary claims.", taskRef: "claim-model" },
      ],
      links: [{ type: "repository", provider: "github", reference: "agent-continuity" }],
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
    await call("POST", "/projects", { name: "Agent Continuity" });
    const response = await call("POST", "/projects/PRJ-0001/tasks", {
      title: "Task",
      acceptance_criteria: ["would have been silently dropped"],
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("deletes a task and reports what went with it", async () => {
    await call("POST", "/projects", { name: "Agent Continuity" });
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
    await call("POST", "/projects", { name: "Agent Continuity" });
    await call("POST", "/projects/PRJ-0001/tasks", { title: "Claimed" });
    await call("POST", "/tasks/TASK-0001/claim", { actor: "codex" });

    const refused = await call("DELETE", "/tasks/TASK-0001", { actor: "adam" });
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe("TASK_ALREADY_CLAIMED");

    const forced = await call("DELETE", "/tasks/TASK-0001", { actor: "adam", force: true });
    expect(forced.status).toBe(200);
  });

  it("deletes a project and reports everything that went with it", async () => {
    await call("POST", "/projects", { name: "Verify mobile" });
    await call("POST", "/projects/PRJ-0001/tasks", {
      title: "Scratch",
      acceptanceCriteria: ["One"],
    });
    await call("POST", "/tasks/TASK-0001/progress", { content: "Some work", actor: "adam" });

    const deleted = await call("DELETE", "/projects/PRJ-0001", { actor: "adam" });
    expect(deleted.status).toBe(200);
    expect(deleted.body.deleted.key).toBe("PRJ-0001");
    expect(deleted.body.deleted.removed.tasks).toBe(1);
    expect(deleted.body.deleted.removed.acceptanceCriteria).toBe(1);
    expect(deleted.body.deleted.removed.progress).toBe(1);

    expect((await call("GET", "/projects/PRJ-0001")).status).toBe(404);
    expect((await call("GET", "/tasks/TASK-0001")).status).toBe(404);

    // The next project still allocates the next sequential key: it is never reused.
    const next = await call("POST", "/projects", { name: "Second" });
    expect(next.body.project.key).toBe("PRJ-0002");
  });

  it("refuses to delete a project with a claimed task without force", async () => {
    await call("POST", "/projects", { name: "Agent Continuity" });
    await call("POST", "/projects/PRJ-0001/tasks", { title: "Claimed" });
    await call("POST", "/tasks/TASK-0001/claim", { actor: "codex" });

    const refused = await call("DELETE", "/projects/PRJ-0001", { actor: "adam" });
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe("PROJECT_HAS_CLAIMED_TASKS");

    const forced = await call("DELETE", "/projects/PRJ-0001", { actor: "adam", force: true });
    expect(forced.status).toBe(200);
  });

  it("runs the full task lifecycle over HTTP", async () => {
    await call("POST", "/projects", { name: "Agent Continuity" });

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
      reference: "AC-42",
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
    await call("POST", "/projects", { name: "Agent Continuity" });
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
    await call("POST", "/projects", { name: "Agent Continuity" });
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
    await call("POST", "/projects", { name: "Agent Continuity", actor: "codex" });
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
    await call("POST", "/projects", { name: "Agent Continuity" });
    await call("POST", "/projects/PRJ-0001/tasks", { title: "Claimed task" });
    await call("POST", "/tasks/TASK-0001/claim", { actor: "codex" });

    const conflict = await call("POST", "/tasks/TASK-0001/claim", { actor: "claude-code" });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe("TASK_ALREADY_CLAIMED");
    expect(conflict.body.error.details.actor).toBe("codex");
  });

  it("releases a claim and deletes acceptance criteria and links", async () => {
    await call("POST", "/projects", { name: "Agent Continuity" });
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
