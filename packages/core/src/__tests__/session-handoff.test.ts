import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createTestWorkspace,
  seedProject,
  seedTask,
  type TestWorkspace,
} from "./helpers.js";

describe("session handoff status", () => {
  let workspace: TestWorkspace;
  let projectKey: string;

  beforeEach(() => {
    workspace = createTestWorkspace();
    projectKey = seedProject(workspace).key;
  });

  afterEach(() => {
    workspace.close();
  });

  it("returns only live claims owned by the exact session", () => {
    const current = seedTask(workspace, projectKey, "Current session", { status: "ready" });
    const other = seedTask(workspace, projectKey, "Other session", { status: "ready" });
    const released = seedTask(workspace, projectKey, "Released", { status: "ready" });

    workspace.claims.claim(current.key, { actor: "codex", sessionId: "current-session" });
    workspace.claims.claim(other.key, { actor: "codex", sessionId: "other-session" });
    workspace.claims.claim(released.key, { actor: "codex", sessionId: "current-session" });
    workspace.claims.release(released.key, {
      actor: "codex",
      sessionId: "current-session",
      reason: "done here",
    });

    expect(workspace.executions.handoffStatusForSession("current-session")).toEqual({
      sessionId: "current-session",
      tasks: [
        expect.objectContaining({
          taskKey: current.key,
          actor: "codex",
          checkpointState: "missing",
        }),
      ],
    });
  });

  it("marks meaningful work after a checkpoint stale but ignores heartbeat noise", () => {
    const task = seedTask(workspace, projectKey, "Checkpoint freshness", { status: "ready" });
    workspace.claims.claim(task.key, { actor: "codex", sessionId: "current-session" });

    workspace.executions.checkpoint(task.key, {
      completed: "Initial implementation",
      workingOn: "Verification",
      next: "Run focused tests",
      actor: "codex",
      sessionId: "current-session",
    });
    expect(
      workspace.executions.handoffStatusForSession("current-session").tasks[0]
        ?.checkpointState,
    ).toBe("current");

    workspace.claims.heartbeat(task.key, {
      actor: "codex",
      sessionId: "current-session",
      phase: "Testing",
    });
    expect(
      workspace.executions.handoffStatusForSession("current-session").tasks[0]
        ?.checkpointState,
    ).toBe("current");

    workspace.tasks.addProgress(task.key, {
      content: "Focused implementation completed",
      actor: "codex",
      sessionId: "current-session",
    });
    expect(
      workspace.executions.handoffStatusForSession("current-session").tasks[0]
        ?.checkpointState,
    ).toBe("stale");

    workspace.executions.checkpoint(task.key, {
      completed: "Implementation and focused tests",
      workingOn: "Final review",
      next: "Attach evidence",
      actor: "codex",
      sessionId: "current-session",
    });
    expect(
      workspace.executions.handoffStatusForSession("current-session").tasks[0]
        ?.checkpointState,
    ).toBe("current");
  });

  it("ignores an expired claim without reconciling or mutating it", () => {
    const task = seedTask(workspace, projectKey, "Expired work", { status: "ready" });
    workspace.claims.claim(task.key, {
      actor: "codex",
      sessionId: "current-session",
      ttlMinutes: 5,
    });
    workspace.advanceMinutes(6);

    expect(workspace.executions.handoffStatusForSession("current-session")).toEqual({
      sessionId: "current-session",
      tasks: [],
    });
  });
});
