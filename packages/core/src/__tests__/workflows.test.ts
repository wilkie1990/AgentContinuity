import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createTestWorkspace,
  eventTypes,
  expectErrorCodeAsync,
  seedProject,
  seedTask,
  type TestWorkspace,
} from "./helpers.js";

describe("composite execution workflows", () => {
  let workspace: TestWorkspace;
  let projectKey: string;

  beforeEach(() => {
    workspace = createTestWorkspace();
    projectKey = seedProject(workspace).key;
    workspace.projects.updateContext(projectKey, {
      context: "Preserve atomic operations and explicit actor identity.",
      expectedVersion: 0,
      actor: "owner",
    });
  });

  afterEach(() => workspace.close());

  it("starts actionable work atomically and returns complete context", async () => {
    const dependency = seedTask(workspace, projectKey, "Dependency", { status: "done" });
    const task = seedTask(workspace, projectKey, "Composite work", {
      status: "ready",
      context: "Task-specific implementation constraints.",
      dependencies: [dependency.key],
    });

    const result = await workspace.workflows.startWork(task.key, {
      actor: "codex",
      sessionId: "run-1",
    });

    expect(result.project.context).toContain("explicit actor identity");
    expect(result.task).toEqual(
      expect.objectContaining({
        key: task.key,
        context: "Task-specific implementation constraints.",
        status: "in_progress",
      }),
    );
    expect(result.task.dependencies.map((item) => item.key)).toEqual([dependency.key]);
    expect(result.task.activeBlockers).toEqual([]);
    expect(result.task.claim).toEqual(
      expect.objectContaining({ actor: "codex", sessionId: "run-1" }),
    );
    expect(result.execution.execution).toEqual(
      expect.objectContaining({ actor: "codex", health: "active" }),
    );
    expect(result.execution.checkpoints).toEqual([]);
    expect(result.execution.handoff).toBeNull();
  });

  it("resumes the same owner's live execution and rejects a conflicting owner", async () => {
    const task = seedTask(workspace, projectKey, "Resume", { status: "ready" });
    await workspace.workflows.startWork(task.key, { actor: "codex", sessionId: "run-1" });
    workspace.advanceMinutes(20);

    const resumed = await workspace.workflows.startWork(task.key, {
      actor: "codex",
      sessionId: "run-1",
    });
    expect(resumed.task.claim?.expiresInMinutes).toBe(30);
    expect(resumed.execution.execution?.resumedAt).not.toBeNull();

    await expectErrorCodeAsync(
      async () =>
        workspace.workflows.startWork(task.key, {
          actor: "claude-code",
          sessionId: "run-2",
        }),
      "TASK_ALREADY_CLAIMED",
    );
  });

  it("rejects backlog, blocked and dependency-waiting work without leaving a claim", async () => {
    const backlog = seedTask(workspace, projectKey, "Backlog");
    await expectErrorCodeAsync(
      async () => workspace.workflows.startWork(backlog.key, { actor: "codex", sessionId: "run-1" }),
      "TASK_NOT_ACTIONABLE",
    );
    expect(workspace.tasks.get(backlog.key).claim).toBeNull();

    const blocked = seedTask(workspace, projectKey, "Blocked", { status: "ready" });
    workspace.blockers.add(blocked.key, { description: "Waiting for a decision" });
    await expectErrorCodeAsync(
      async () => workspace.workflows.startWork(blocked.key, { actor: "codex", sessionId: "run-1" }),
      "TASK_NOT_ACTIONABLE",
    );

    const dependency = seedTask(workspace, projectKey, "Incomplete dependency");
    const waiting = seedTask(workspace, projectKey, "Waiting", {
      status: "ready",
      dependencies: [dependency.key],
    });
    await expectErrorCodeAsync(
      async () => workspace.workflows.startWork(waiting.key, { actor: "codex", sessionId: "run-1" }),
      "TASK_NOT_ACTIONABLE",
    );
  });

  it("reports phase, progress and checkpoint in one request", async () => {
    const task = seedTask(workspace, projectKey, "Report", { status: "ready" });
    await workspace.workflows.startWork(task.key, { actor: "codex", sessionId: "run-1" });

    const result = await workspace.workflows.report(task.key, {
      actor: "codex",
      sessionId: "run-1",
      phase: "Verification",
      progress: "Core workflow implemented.",
      checkpoint: {
        completed: "Contracts and service",
        workingOn: "Adapter verification",
        next: "Run all tests",
        uncertainty: null,
      },
    });

    expect(result.execution.currentPhase).toBe("Verification");
    expect(result.progress?.content).toBe("Core workflow implemented.");
    expect(result.checkpoint?.next).toBe("Run all tests");
    expect(result.claim.expiresInMinutes).toBe(30);
    const events = eventTypes(workspace, projectKey);
    expect(events.filter((event) => event === "task.progress_added")).toHaveLength(1);
    expect(events.filter((event) => event === "task.checkpointed")).toHaveLength(1);
  });

  it("keeps heartbeat-only reports silent in activity", async () => {
    const task = seedTask(workspace, projectKey, "Heartbeat report", { status: "ready" });
    await workspace.workflows.startWork(task.key, { actor: "codex", sessionId: "run-1" });
    const before = eventTypes(workspace, projectKey);
    workspace.advanceMinutes(10);

    const result = await workspace.workflows.report(task.key, {
      actor: "codex",
      sessionId: "run-1",
      phase: "Still working",
    });

    expect(result.progress).toBeNull();
    expect(result.checkpoint).toBeNull();
    expect(eventTypes(workspace, projectKey)).toEqual(before);
  });

  it("rolls back an earlier heartbeat when a later report write fails", async () => {
    const task = seedTask(workspace, projectKey, "Atomic report", { status: "ready" });
    await workspace.workflows.startWork(task.key, { actor: "codex", sessionId: "run-1" });
    const claimBefore = workspace.tasks.getSummary(task.key).claim;
    const executionBefore = workspace.executions.activeFor(task.id);
    workspace.projects.archive(projectKey, { actor: "owner" });
    workspace.advanceMinutes(10);

    await expectErrorCodeAsync(
      async () =>
        workspace.workflows.report(task.key, {
          actor: "codex",
          sessionId: "run-1",
          phase: "Should roll back",
          progress: "Must not persist",
        }),
      "PROJECT_ARCHIVED",
    );

    expect(workspace.tasks.getSummary(task.key).claim?.lastActiveAt).toBe(claimBefore?.lastActiveAt);
    expect(workspace.executions.activeFor(task.id)?.lastHeartbeatAt).toBe(
      executionBefore?.lastHeartbeatAt,
    );
    expect(workspace.tasks.listProgress(task.key)).toEqual([]);
  });

  it("writes a durable final checkpoint and releases safely on handoff", async () => {
    const task = seedTask(workspace, projectKey, "Handoff", { status: "ready" });
    await workspace.workflows.startWork(task.key, { actor: "codex", sessionId: "run-1" });

    const result = await workspace.workflows.handoff(task.key, {
      actor: "codex",
      sessionId: "run-1",
      reason: "session ending",
      checkpoint: {
        completed: "Schema",
        workingOn: "Routes",
        next: "Complete adapter tests",
        uncertainty: "Check CLI output",
      },
    });

    expect(result.releasedClaim.releasedAt).not.toBeNull();
    expect(result.task.claim).toBeNull();
    expect(result.checkpoint.next).toBe("Complete adapter tests");
    expect(result.handoff).toEqual(
      expect.objectContaining({
        reason: "session ending",
        nextAction: "Complete adapter tests",
        unresolved: ["Check CLI output"],
      }),
    );
    expect(workspace.executions.forTask(task.key).execution).toBeNull();
  });

  it("does not write a handoff checkpoint or release on owner validation failure", async () => {
    const task = seedTask(workspace, projectKey, "Protected handoff", { status: "ready" });
    await workspace.workflows.startWork(task.key, { actor: "codex", sessionId: "run-1" });

    await expectErrorCodeAsync(
      async () =>
        workspace.workflows.handoff(task.key, {
          actor: "claude-code",
          sessionId: "run-2",
          checkpoint: {
            completed: "Must not persist",
            workingOn: "Nothing",
            next: "Nothing",
          },
        }),
      "TASK_CLAIM_MISMATCH",
    );

    expect(workspace.executions.checkpoints(task.key)).toEqual([]);
    expect(workspace.tasks.getSummary(task.key).claim?.actor).toBe("codex");
    expect(workspace.executions.forTask(task.key).handoff).toBeNull();
  });

  it("recovers interrupted work after lease expiry with resume state intact", async () => {
    const task = seedTask(workspace, projectKey, "Interrupted", { status: "ready" });
    await workspace.workflows.startWork(task.key, { actor: "codex", sessionId: "run-1" });
    await workspace.workflows.report(task.key, {
      actor: "codex",
      sessionId: "run-1",
      checkpoint: {
        completed: "Inspection",
        workingOn: "Implementation",
        next: "Run verification",
      },
    });
    workspace.advanceMinutes(31);

    const recovered = await workspace.workflows.startWork(task.key, {
      actor: "claude-code",
      sessionId: "run-2",
    });

    expect(recovered.task.claim?.actor).toBe("claude-code");
    expect(recovered.execution.handoff).toEqual(
      expect.objectContaining({ reason: "claim expired", nextAction: "Run verification" }),
    );
    expect(recovered.execution.checkpoints[0]?.completed).toBe("Inspection");
  });
});
