import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createTestWorkspace,
  eventTypes,
  expectErrorCode,
  seedProject,
  seedTask,
  type TestWorkspace,
} from "./helpers.js";

describe("task claims", () => {
  let workspace: TestWorkspace;
  let projectKey: string;

  beforeEach(() => {
    workspace = createTestWorkspace();
    projectKey = seedProject(workspace).key;
  });

  afterEach(() => {
    workspace.close();
  });

  it("claims an unclaimed task and moves a ready task to in_progress", () => {
    const task = seedTask(workspace, projectKey, "Design claim model", { status: "ready" });
    const { claim } = workspace.claims.claim(task.key, { actor: "codex", sessionId: "abc123" });

    expect(claim.actor).toBe("codex");
    expect(claim.expiresInMinutes).toBe(30);
    expect(workspace.tasks.getSummary(task.key).status).toBe("in_progress");
    expect(eventTypes(workspace, projectKey)).toContain("task.claimed");
  });

  it("leaves a backlog task's status alone when claimed", () => {
    const task = seedTask(workspace, projectKey);
    workspace.claims.claim(task.key, { actor: "codex" });
    expect(workspace.tasks.getSummary(task.key).status).toBe("backlog");
  });

  it("rejects a second active claim from another agent", () => {
    const task = seedTask(workspace, projectKey);
    workspace.claims.claim(task.key, { actor: "codex", sessionId: "abc" });

    const error = expectErrorCode(
      () => workspace.claims.claim(task.key, { actor: "claude-code", sessionId: "def" }),
      "TASK_ALREADY_CLAIMED",
    );
    expect(error.message).toContain("claimed by codex");
  });

  it("rejects a second claim from the same actor in a different session", () => {
    const task = seedTask(workspace, projectKey);
    workspace.claims.claim(task.key, { actor: "codex", sessionId: "abc" });
    expectErrorCode(
      () => workspace.claims.claim(task.key, { actor: "codex", sessionId: "other" }),
      "TASK_ALREADY_CLAIMED",
    );
  });

  it("renews a matching claim", () => {
    const task = seedTask(workspace, projectKey);
    workspace.claims.claim(task.key, { actor: "codex", sessionId: "abc" });
    workspace.advanceMinutes(20);

    const renewed = workspace.claims.renew(task.key, { actor: "codex", sessionId: "abc" });
    expect(renewed.expiresInMinutes).toBe(30);
    expect(eventTypes(workspace, projectKey)).toContain("task.claim_renewed");
  });

  it("rejects renewal by a different actor or session", () => {
    const task = seedTask(workspace, projectKey);
    workspace.claims.claim(task.key, { actor: "codex", sessionId: "abc" });

    expectErrorCode(
      () => workspace.claims.renew(task.key, { actor: "claude-code" }),
      "TASK_CLAIM_MISMATCH",
    );
    expectErrorCode(
      () => workspace.claims.renew(task.key, { actor: "codex", sessionId: "wrong" }),
      "TASK_CLAIM_MISMATCH",
    );
  });

  it("releases a claim and records the reason", () => {
    const task = seedTask(workspace, projectKey);
    workspace.claims.claim(task.key, { actor: "codex", sessionId: "abc" });

    const released = workspace.claims.release(task.key, {
      actor: "codex",
      sessionId: "abc",
      reason: "session ending",
    });

    expect(released.releasedAt).not.toBeNull();
    expect(workspace.tasks.getSummary(task.key).claim).toBeNull();
    expect(eventTypes(workspace, projectKey)).toContain("task.claim_released");
  });

  it("allows a forced release when no actor is supplied", () => {
    const task = seedTask(workspace, projectKey);
    workspace.claims.claim(task.key, { actor: "codex" });
    workspace.claims.release(task.key, { reason: "stale agent" });
    expect(workspace.tasks.getSummary(task.key).claim).toBeNull();
  });

  it("rejects releasing another agent's claim", () => {
    const task = seedTask(workspace, projectKey);
    workspace.claims.claim(task.key, { actor: "codex" });
    expectErrorCode(
      () => workspace.claims.release(task.key, { actor: "claude-code" }),
      "TASK_CLAIM_MISMATCH",
    );
  });

  it("treats an expired claim as inactive and records task.claim_expired once", () => {
    const task = seedTask(workspace, projectKey);
    workspace.claims.claim(task.key, { actor: "codex", ttlMinutes: 30 });

    workspace.advanceMinutes(31);
    expect(workspace.tasks.getSummary(task.key).claim).toBeNull();

    workspace.tasks.getSummary(task.key);
    workspace.tasks.list(projectKey);

    const expired = workspace.activity
      .listForProject(projectKey, { limit: 200 })
      .events.filter((event) => event.eventType === "task.claim_expired");
    expect(expired).toHaveLength(1);
  });

  it("lets another agent claim a task whose lease expired", () => {
    const task = seedTask(workspace, projectKey);
    workspace.claims.claim(task.key, { actor: "codex" });
    workspace.advanceMinutes(31);

    const { claim } = workspace.claims.claim(task.key, { actor: "claude-code" });
    expect(claim.actor).toBe("claude-code");
  });

  it("extends the lease when the owning agent re-claims", () => {
    const task = seedTask(workspace, projectKey);
    workspace.claims.claim(task.key, { actor: "codex", sessionId: "abc" });
    workspace.advanceMinutes(25);

    const { claim } = workspace.claims.claim(task.key, { actor: "codex", sessionId: "abc" });
    expect(claim.expiresInMinutes).toBe(30);
  });

  it("touches a matching claim when progress is recorded", () => {
    const task = seedTask(workspace, projectKey);
    workspace.claims.claim(task.key, { actor: "codex", sessionId: "abc" });
    workspace.advanceMinutes(25);

    workspace.tasks.addProgress(task.key, {
      content: "Core model implemented",
      actor: "codex",
      sessionId: "abc",
    });

    expect(workspace.tasks.getSummary(task.key).claim?.expiresInMinutes).toBe(30);
  });

  it("does not touch a claim owned by a different agent", () => {
    const task = seedTask(workspace, projectKey);
    workspace.claims.claim(task.key, { actor: "codex", sessionId: "abc" });
    workspace.advanceMinutes(25);

    workspace.tasks.addProgress(task.key, { content: "Observation", actor: "claude-code" });
    expect(workspace.tasks.getSummary(task.key).claim?.expiresInMinutes).toBe(5);
  });

  it("releases the active claim when the task is completed", () => {
    const task = seedTask(workspace, projectKey, "Design claim model", { status: "ready" });
    workspace.claims.claim(task.key, { actor: "codex" });
    workspace.tasks.complete(task.key, { force: false, actor: "codex" });

    const detail = workspace.tasks.get(task.key);
    expect(detail.claim).toBeNull();
    expect(detail.status).toBe("done");
  });

  it("raises TASK_NOT_CLAIMED when renewing or releasing an unclaimed task", () => {
    const task = seedTask(workspace, projectKey);
    expectErrorCode(() => workspace.claims.renew(task.key, { actor: "codex" }), "TASK_NOT_CLAIMED");
    expectErrorCode(() => workspace.claims.release(task.key, { actor: "codex" }), "TASK_NOT_CLAIMED");
  });
});
