import {
  CONTEXT_HARD_LIMIT_BYTES,
  CONTEXT_SOFT_LIMIT_BYTES,
} from "@agent-continuity/contracts";
import { contextVersions } from "@agent-continuity/database";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createTestWorkspace,
  expectErrorCode,
  seedProject,
  seedTask,
  type TestWorkspace,
} from "./helpers.js";

describe("versioned context", () => {
  let workspace: TestWorkspace;

  beforeEach(() => {
    workspace = createTestWorkspace();
  });

  afterEach(() => workspace.close());

  it("creates initial project/task versions while preserving null and empty context", () => {
    const project = workspace.projects.create({
      name: "Versioned",
      context: "café",
      actor: "codex",
      sessionId: "session-a",
    });
    const empty = workspace.tasks.create(project.key, {
      title: "Empty is explicit",
      context: "",
      actor: "codex",
    });
    const absent = workspace.tasks.create(project.key, {
      title: "No context",
      context: null,
      actor: "codex",
    });

    expect(project.contextVersion).toBe(1);
    expect(project.contextSize).toEqual({ characters: 4, bytes: 5, overSoftLimit: false });
    expect(empty.contextVersion).toBe(1);
    expect(empty.context).toBe("");
    expect(absent.contextVersion).toBe(0);

    const projectHistory = workspace.contexts.listProject(project.key, { limit: 20 });
    expect(projectHistory.versions).toEqual([
      expect.objectContaining({
        ownerType: "project",
        version: 1,
        actor: "codex",
        sessionId: "session-a",
        reason: "Initial project context.",
        isCurrent: true,
      }),
    ]);
    expect(workspace.contexts.getProject(project.key, 1).content).toBe("café");
    expect(workspace.contexts.listTask(empty.key, { limit: 20 }).versions).toHaveLength(1);
    expect(workspace.contexts.listTask(absent.key, { limit: 20 }).versions).toEqual([]);
  });

  it("paginates metadata, targets content and reverts by appending a new version", () => {
    const project = workspace.projects.create({ name: "History", context: "version one" });
    workspace.projects.updateContext(project.key, {
      context: "version two",
      expectedVersion: 1,
      reason: "Second draft",
      actor: "codex",
    });
    workspace.projects.updateContext(project.key, {
      context: "version two",
      expectedVersion: 2,
      reason: "Recorded unchanged review",
      actor: "adam",
    });
    workspace.projects.updateContext(project.key, {
      context: null,
      expectedVersion: 3,
      reason: "Explicit clear",
    });

    const first = workspace.contexts.listProject(project.key, { limit: 2 });
    expect(first.versions.map((version) => version.version)).toEqual([4, 3]);
    expect(first.nextBeforeVersion).toBe(3);
    expect(first.versions[0]).not.toHaveProperty("content");

    const second = workspace.contexts.listProject(project.key, {
      limit: 2,
      beforeVersion: first.nextBeforeVersion!,
    });
    expect(second.versions.map((version) => version.version)).toEqual([2, 1]);
    expect(second.nextBeforeVersion).toBeNull();
    expect(workspace.contexts.getProject(project.key, 4).content).toBeNull();

    const revertedRow = workspace.contexts.revertProject(project.key, {
      targetVersion: 1,
      expectedVersion: 4,
      actor: "codex",
    });
    const reverted = workspace.projects.summarise(revertedRow);
    expect(reverted.context).toBe("version one");
    expect(reverted.contextVersion).toBe(5);
    expect(workspace.contexts.getProject(project.key, 5)).toEqual(
      expect.objectContaining({
        content: "version one",
        revertedFromVersion: 1,
        reason: "Reverted to context version 1.",
        isCurrent: true,
      }),
    );
    expect(workspace.contexts.getProject(project.key, 4).content).toBeNull();
  });

  it("rejects stale project/task writers and rolls back sibling task changes", () => {
    const project = workspace.projects.create({ name: "Concurrency", context: "base" });
    const task = workspace.tasks.create(project.key, {
      title: "Original title",
      context: "task base",
    });

    workspace.projects.updateContext(project.key, {
      context: "new project",
      expectedVersion: 1,
    });
    const projectConflict = expectErrorCode(
      () =>
        workspace.projects.updateContext(project.key, {
          context: "stale project",
          expectedVersion: 1,
        }),
      "CONTEXT_VERSION_CONFLICT",
    );
    expect(projectConflict.details).toEqual(
      expect.objectContaining({ expectedVersion: 1, currentVersion: 2 }),
    );
    expect(workspace.projects.get(project.key).context).toBe("new project");

    workspace.tasks.updateContext(task.key, {
      context: "new task",
      expectedVersion: 1,
    });
    expectErrorCode(
      () =>
        workspace.tasks.update(task.key, {
          title: "Must roll back",
          context: "stale task",
          expectedContextVersion: 1,
        }),
      "CONTEXT_VERSION_CONFLICT",
    );
    const current = workspace.tasks.getSummary(task.key);
    expect(current.title).toBe("Original title");
    expect(current.context).toBe("new task");
    expect(current.contextVersion).toBe(2);
    expect(workspace.contexts.listTask(task.key, { limit: 20 }).versions).toHaveLength(2);
  });

  it("warns above 32 KiB and rejects only beyond the 256 KiB UTF-8 ceiling", () => {
    const project = seedProject(workspace);
    const overSoft = "é".repeat(CONTEXT_SOFT_LIMIT_BYTES / 2 + 1);
    const warned = workspace.projects.updateContext(project.key, {
      context: overSoft,
      expectedVersion: 0,
    });
    expect(warned.contextSize).toEqual({
      characters: CONTEXT_SOFT_LIMIT_BYTES / 2 + 1,
      bytes: CONTEXT_SOFT_LIMIT_BYTES + 2,
      overSoftLimit: true,
    });

    const exactHard = "é".repeat(CONTEXT_HARD_LIMIT_BYTES / 2);
    const accepted = workspace.projects.updateContext(project.key, {
      context: exactHard,
      expectedVersion: 1,
    });
    expect(accepted.contextSize.bytes).toBe(CONTEXT_HARD_LIMIT_BYTES);

    const error = expectErrorCode(
      () =>
        workspace.projects.updateContext(project.key, {
          context: `${exactHard}é`,
          expectedVersion: 2,
        }),
      "CONTEXT_TOO_LARGE",
    );
    expect(error.details).toEqual(
      expect.objectContaining({
        actualBytes: CONTEXT_HARD_LIMIT_BYTES + 2,
        hardLimitBytes: CONTEXT_HARD_LIMIT_BYTES,
      }),
    );
    expect(workspace.projects.get(project.key).contextVersion).toBe(2);
  });

  it("touches a matching task claim and keeps activity free of context content", () => {
    const project = seedProject(workspace);
    const task = seedTask(workspace, project.key, "Claimed", { status: "ready" });
    const claimed = workspace.claims.claim(task.key, {
      actor: "codex",
      sessionId: "session-a",
      ttlMinutes: 10,
    }).claim;
    workspace.advanceMinutes(5);

    workspace.tasks.updateContext(task.key, {
      context: "private-context-token",
      expectedVersion: 0,
      reason: "Durable task knowledge",
      actor: "codex",
      sessionId: "session-a",
    });

    const renewed = workspace.claims.activeFor(task.id)!;
    expect(Date.parse(renewed.expiresAt)).toBeGreaterThan(Date.parse(claimed.expiresAt));
    const event = workspace.activity
      .listForProject(project.key, { limit: 50 })
      .events.find((candidate) => candidate.eventType === "task.context_updated")!;
    expect(event.payload).toEqual(
      expect.objectContaining({
        previousVersion: 0,
        newVersion: 1,
        newBytes: 21,
        reason: "Durable task knowledge",
      }),
    );
    expect(JSON.stringify(event.payload)).not.toContain("private-context-token");
  });

  it("keeps only current context searchable across replacement and revert", () => {
    const project = workspace.projects.create({
      name: "Search",
      context: "historicalcontexttoken",
    });
    workspace.projects.updateContext(project.key, {
      context: "currentcontexttoken",
      expectedVersion: 1,
    });

    expect(
      workspace.search.search({
        q: "historicalcontexttoken",
        project: project.key,
        type: ["project_context"],
        limit: 20,
      }).results,
    ).toEqual([]);
    expect(
      workspace.search.search({
        q: "currentcontexttoken",
        project: project.key,
        type: ["project_context"],
        limit: 20,
      }).results,
    ).toHaveLength(1);

    workspace.contexts.revertProject(project.key, {
      targetVersion: 1,
      expectedVersion: 2,
    });
    expect(
      workspace.search.search({
        q: "historicalcontexttoken",
        project: project.key,
        type: ["project_context"],
        limit: 20,
      }).results,
    ).toHaveLength(1);
    expect(
      workspace.search.search({
        q: "currentcontexttoken",
        project: project.key,
        type: ["project_context"],
        limit: 20,
      }).results,
    ).toEqual([]);
  });

  it("cascades task and project context history with their owners", () => {
    const project = workspace.projects.create({ name: "Cascade", context: "project history" });
    const task = workspace.tasks.create(project.key, {
      title: "Owned",
      context: "task history",
    });

    workspace.tasks.delete(task.key, { force: false });
    expect(
      workspace.runtime.db
        .select()
        .from(contextVersions)
        .where(eq(contextVersions.taskId, task.id))
        .all(),
    ).toEqual([]);

    workspace.projects.delete(project.key, { force: false });
    expect(
      workspace.runtime.db
        .select()
        .from(contextVersions)
        .where(eq(contextVersions.projectId, project.id))
        .all(),
    ).toEqual([]);
  });
});
