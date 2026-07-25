import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createTestWorkspace,
  eventTypes,
  expectErrorCode,
  seedProject,
  seedTask,
  type TestWorkspace,
} from "./helpers.js";

describe("blockers", () => {
  let workspace: TestWorkspace;
  let projectKey: string;

  beforeEach(() => {
    workspace = createTestWorkspace();
    projectKey = seedProject(workspace).key;
  });

  afterEach(() => {
    workspace.close();
  });

  it("moves the task to blocked and records task.blocked", () => {
    const task = seedTask(workspace, projectKey, "Design claim model", { status: "ready" });
    const blocker = workspace.blockers.add(task.key, {
      description: "Expected provider behaviour is unclear.",
      requiredAction: "Confirm whether legacy behaviour must be preserved.",
      actor: "codex",
    });

    expect(blocker.key).toBe("BLK-0001");
    expect(blocker.isActive).toBe(true);
    expect(workspace.tasks.getSummary(task.key).status).toBe("blocked");
    expect(eventTypes(workspace, projectKey)).toContain("task.blocked");
  });

  it("returns the task to in_progress when a claim is still active", () => {
    const task = seedTask(workspace, projectKey, "Design claim model", { status: "ready" });
    workspace.claims.claim(task.key, { actor: "codex", sessionId: "abc" });

    const blocker = workspace.blockers.add(task.key, { description: "Needs input", actor: "codex" });
    expect(workspace.tasks.getSummary(task.key).status).toBe("blocked");

    workspace.blockers.resolve(blocker.key, { resolution: "Confirmed by the user", actor: "adam" });
    expect(workspace.tasks.getSummary(task.key).status).toBe("in_progress");
    expect(eventTypes(workspace, projectKey)).toContain("task.blocker_resolved");
  });

  it("returns the task to ready when no claim is active", () => {
    const task = seedTask(workspace, projectKey, "Design claim model", { status: "ready" });
    const blocker = workspace.blockers.add(task.key, { description: "Needs input" });

    workspace.blockers.resolve(blocker.key, { resolution: "Answered" });
    expect(workspace.tasks.getSummary(task.key).status).toBe("ready");
  });

  it("keeps the task blocked while another blocker is active", () => {
    const task = seedTask(workspace, projectKey, "Design claim model", { status: "ready" });
    const first = workspace.blockers.add(task.key, { description: "First question" });
    workspace.blockers.add(task.key, { description: "Second question" });

    workspace.blockers.resolve(first.key, { resolution: "Answered" });
    expect(workspace.tasks.getSummary(task.key).status).toBe("blocked");
    expect(workspace.tasks.getSummary(task.key).activeBlockerCount).toBe(1);
  });

  it("does not move a completed task to blocked", () => {
    const task = seedTask(workspace, projectKey);
    workspace.tasks.complete(task.key, { force: false, actor: "codex" });
    workspace.blockers.add(task.key, { description: "Late discovery" });

    expect(workspace.tasks.getSummary(task.key).status).toBe("done");
  });

  it("rejects resolving the same blocker twice", () => {
    const task = seedTask(workspace, projectKey);
    const blocker = workspace.blockers.add(task.key, { description: "Needs input" });
    workspace.blockers.resolve(blocker.key, { resolution: "Answered" });

    expectErrorCode(
      () => workspace.blockers.resolve(blocker.key, { resolution: "Answered again" }),
      "BLOCKER_ALREADY_RESOLVED",
    );
  });

  it("prevents a blocked task from leaving the blocked column while blockers remain", () => {
    const task = seedTask(workspace, projectKey, "Design claim model", { status: "ready" });
    workspace.blockers.add(task.key, { description: "Needs input" });

    expectErrorCode(
      () => workspace.tasks.update(task.key, { status: "in_progress" }),
      "TASK_HAS_ACTIVE_BLOCKERS",
    );
  });

  it("rejects completing a task with active blockers unless forced", () => {
    const task = seedTask(workspace, projectKey);
    workspace.blockers.add(task.key, { description: "Needs input" });

    expectErrorCode(
      () => workspace.tasks.complete(task.key, { force: false }),
      "TASK_HAS_ACTIVE_BLOCKERS",
    );

    const completed = workspace.tasks.complete(task.key, {
      force: true,
      reason: "Blocker no longer relevant",
    });
    expect(completed.status).toBe("done");
  });

  it("separates active and resolved blockers on the task detail", () => {
    const task = seedTask(workspace, projectKey);
    const first = workspace.blockers.add(task.key, { description: "Resolved question" });
    workspace.blockers.add(task.key, { description: "Open question" });
    workspace.blockers.resolve(first.key, { resolution: "Answered" });

    const detail = workspace.tasks.get(task.key);
    expect(detail.activeBlockers.map((blocker) => blocker.description)).toEqual(["Open question"]);
    expect(detail.resolvedBlockers.map((blocker) => blocker.description)).toEqual([
      "Resolved question",
    ]);
  });

  it("raises BLOCKER_NOT_FOUND for an unknown key", () => {
    expectErrorCode(
      () => workspace.blockers.resolve("BLK-9999", { resolution: "n/a" }),
      "BLOCKER_NOT_FOUND",
    );
  });
});
