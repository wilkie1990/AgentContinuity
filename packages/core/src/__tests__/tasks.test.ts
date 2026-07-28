import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createTestWorkspace,
  eventTypes,
  expectErrorCode,
  seedProject,
  seedTask,
  type TestWorkspace,
} from "./helpers.js";

describe("task service", () => {
  let workspace: TestWorkspace;
  let projectKey: string;

  beforeEach(() => {
    workspace = createTestWorkspace();
    projectKey = seedProject(workspace).key;
  });

  afterEach(() => {
    workspace.close();
  });

  it("creates a task with defaults and records task.created", () => {
    const task = seedTask(workspace, projectKey);

    expect(task.key).toBe("TASK-0001");
    expect(task.status).toBe("backlog");
    expect(task.priority).toBe("normal");
    expect(task.acceptanceCriteriaProgress).toBeNull();
    expect(task.isActionable).toBe(false);
    expect(eventTypes(workspace, projectKey)).toContain("task.created");
  });

  it("creates acceptance criteria and dependencies inline", () => {
    const first = seedTask(workspace, projectKey, "Design task model");
    const second = seedTask(workspace, projectKey, "Design claim model", {
      status: "ready",
      priority: "high",
      acceptanceCriteria: ["Supports actor identification", "Defines expiry behaviour"],
      dependencies: [first.key],
    });

    expect(second.acceptanceCriteriaTotal).toBe(2);
    expect(second.dependencyCount).toBe(1);
    expect(second.dependenciesComplete).toBe(false);
    expect(second.isActionable).toBe(false);
  });

  it("marks a ready task with completed dependencies and no blockers as actionable", () => {
    const first = seedTask(workspace, projectKey, "Design task model", { status: "ready" });
    const second = seedTask(workspace, projectKey, "Design claim model", {
      status: "ready",
      dependencies: [first.key],
    });

    expect(workspace.tasks.getSummary(second.key).isActionable).toBe(false);
    workspace.tasks.complete(first.key, { force: false, actor: "codex" });
    expect(workspace.tasks.getSummary(second.key).isActionable).toBe(true);
  });

  it("rejects completion while acceptance criteria are incomplete", () => {
    const task = seedTask(workspace, projectKey, "Design claim model", {
      acceptanceCriteria: ["Defines expiry behaviour"],
    });

    const error = expectErrorCode(
      () => workspace.tasks.complete(task.key, { force: false, actor: "codex" }),
      "TASK_HAS_INCOMPLETE_ACCEPTANCE_CRITERIA",
    );
    expect(error.details.incomplete).toEqual(["Defines expiry behaviour"]);
    expect(workspace.tasks.getSummary(task.key).status).not.toBe("done");
  });

  it("completes a task once every criterion is complete", () => {
    const task = seedTask(workspace, projectKey, "Design claim model", {
      acceptanceCriteria: ["Defines expiry behaviour", "Supports safe reclaim"],
    });

    const criteria = workspace.tasks.get(task.key).acceptanceCriteria;
    for (const criterion of criteria) {
      workspace.tasks.completeAcceptanceCriterion(task.key, criterion.id, { actor: "codex" });
    }

    const completed = workspace.tasks.complete(task.key, { force: false, actor: "codex" });
    expect(completed.status).toBe("done");
    expect(completed.completedAt).not.toBeNull();
    expect(completed.acceptanceCriteriaProgress).toBe(1);
    expect(eventTypes(workspace, projectKey)).toContain("task.completed");
  });

  it("records the reason when completion is forced", () => {
    const task = seedTask(workspace, projectKey, "Design claim model", {
      acceptanceCriteria: ["Criterion that no longer applies"],
    });

    const completed = workspace.tasks.complete(task.key, {
      force: true,
      reason: "Criterion is no longer applicable",
      actor: "codex",
    });

    expect(completed.status).toBe("done");

    const event = workspace.activity
      .listForProject(projectKey, { limit: 100 })
      .events.find((candidate) => candidate.eventType === "task.completed");
    expect(event?.payload.forced).toBe(true);
    expect(event?.payload.reason).toBe("Criterion is no longer applicable");
    expect(event?.payload.skippedCriteria).toEqual(["Criterion that no longer applies"]);
  });

  it("clears completed_at and records task.reopened when a done task moves on", () => {
    const task = seedTask(workspace, projectKey);
    workspace.tasks.complete(task.key, { force: false, actor: "codex" });

    const reopened = workspace.tasks.update(task.key, { status: "in_progress", actor: "adam" });
    expect(reopened.status).toBe("in_progress");
    expect(reopened.completedAt).toBeNull();
    expect(eventTypes(workspace, projectKey)).toContain("task.reopened");
  });

  it("reopens a completed task when new acceptance criteria are added", () => {
    const task = seedTask(workspace, projectKey);
    workspace.tasks.complete(task.key, { force: false, actor: "codex" });

    workspace.tasks.addAcceptanceCriteria(task.key, ["A newly discovered outcome"], {
      actor: "adam",
    });

    const reloaded = workspace.tasks.getSummary(task.key);
    expect(reloaded.status).toBe("ready");
    expect(reloaded.completedAt).toBeNull();
  });

  it("records context updates by length only", () => {
    const task = seedTask(workspace, projectKey);
    workspace.tasks.updateContext(task.key, {
      context: "Permanent assignment was rejected.",
      expectedVersion: 0,
    });

    const event = workspace.activity
      .listForProject(projectKey, { limit: 100 })
      .events.find((candidate) => candidate.eventType === "task.context_updated");

    expect(event?.payload).toEqual({
      previousVersion: 0,
      newVersion: 1,
      previousLength: 0,
      newLength: 34,
      newBytes: 34,
    });
  });

  it("rejects a parent task from another project", () => {
    const other = seedProject(workspace, "Other project");
    const foreign = seedTask(workspace, other.key, "Foreign task");

    expectErrorCode(
      () => workspace.tasks.create(projectKey, { title: "Child", parentTask: foreign.key }),
      "VALIDATION_ERROR",
    );
  });

  it("rejects a parent cycle", () => {
    const parent = seedTask(workspace, projectKey, "Parent");
    const child = workspace.tasks.create(projectKey, { title: "Child", parentTask: parent.key });

    expectErrorCode(
      () => workspace.tasks.update(parent.key, { parentTask: child.key }),
      "VALIDATION_ERROR",
    );
  });

  it("filters tasks by status, actionability, claim and blocker state", () => {
    const ready = seedTask(workspace, projectKey, "Ready work", { status: "ready" });
    const backlog = seedTask(workspace, projectKey, "Later work");
    workspace.claims.claim(ready.key, { actor: "codex" });
    workspace.blockers.add(backlog.key, { description: "Needs clarification", actor: "codex" });

    expect(workspace.tasks.list(projectKey, { status: ["blocked"] }).map((task) => task.key)).toEqual([
      backlog.key,
    ]);
    expect(workspace.tasks.list(projectKey, { claimed: true }).map((task) => task.key)).toEqual([
      ready.key,
    ]);
    expect(workspace.tasks.list(projectKey, { blocked: true }).map((task) => task.key)).toEqual([
      backlog.key,
    ]);
    expect(workspace.tasks.list(projectKey, { actionable: true })).toHaveLength(0);
  });

  it("appends progress and returns it newest first", () => {
    const task = seedTask(workspace, projectKey);
    workspace.tasks.addProgress(task.key, { content: "Initial lease data model designed.", actor: "codex" });
    workspace.advanceMinutes(1);
    workspace.tasks.addProgress(task.key, { content: "Claim renewal rules drafted.", actor: "codex" });

    const progress = workspace.tasks.listProgress(task.key);
    expect(progress.map((entry) => entry.content)).toEqual([
      "Claim renewal rules drafted.",
      "Initial lease data model designed.",
    ]);
    expect(eventTypes(workspace, projectKey)).toContain("task.progress_added");
  });

  it("reopens and deletes acceptance criteria", () => {
    const task = seedTask(workspace, projectKey, "Design claim model", {
      acceptanceCriteria: ["Defines expiry behaviour"],
    });
    const criterion = workspace.tasks.get(task.key).acceptanceCriteria[0]!;

    workspace.tasks.completeAcceptanceCriterion(task.key, criterion.id);
    expectErrorCode(
      () => workspace.tasks.completeAcceptanceCriterion(task.key, criterion.id),
      "ACCEPTANCE_CRITERION_ALREADY_COMPLETE",
    );
    expectErrorCode(
      () => workspace.tasks.deleteAcceptanceCriterion(task.key, criterion.id),
      "ACCEPTANCE_CRITERION_ALREADY_COMPLETE",
    );

    workspace.tasks.reopenAcceptanceCriterion(task.key, criterion.id);
    expectErrorCode(
      () => workspace.tasks.reopenAcceptanceCriterion(task.key, criterion.id),
      "ACCEPTANCE_CRITERION_ALREADY_OPEN",
    );

    workspace.tasks.deleteAcceptanceCriterion(task.key, criterion.id);
    expect(workspace.tasks.get(task.key).acceptanceCriteria).toHaveLength(0);
  });

  it("creates a batch of tasks transactionally", () => {
    expectErrorCode(
      () =>
        workspace.tasks.createMany(projectKey, [
          { title: "Valid task" },
          { title: "Invalid parent", parentTask: "TASK-9999" },
        ]),
      "TASK_NOT_FOUND",
    );

    expect(workspace.tasks.list(projectKey)).toHaveLength(0);
  });
});

describe("task deletion", () => {
  let workspace: TestWorkspace;
  let projectKey: string;

  beforeEach(() => {
    workspace = createTestWorkspace();
    projectKey = seedProject(workspace).key;
  });

  afterEach(() => {
    workspace.close();
  });

  it("removes the task and everything it owns", () => {
    const task = seedTask(workspace, projectKey, "Scratch", {
      acceptanceCriteria: ["One", "Two"],
    });
    workspace.tasks.addProgress(task.key, { content: "Some work", actor: "codex" });
    workspace.blockers.add(task.key, { description: "Something" });
    workspace.links.add(projectKey, { task: task.key, type: "document", url: "https://x" });

    const deleted = workspace.tasks.delete(task.key, { force: false, actor: "adam" });

    expect(deleted.key).toBe(task.key);
    expect(deleted.removed.acceptanceCriteria).toBe(2);
    expect(deleted.removed.progress).toBe(1);
    expect(deleted.removed.blockers).toBe(1);
    expect(deleted.removed.links).toBe(1);
    expect(deleted.removed.activityEvents).toBeGreaterThan(0);

    expectErrorCode(() => workspace.tasks.get(task.key), "TASK_NOT_FOUND");
    expect(workspace.tasks.list(projectKey)).toHaveLength(0);
    expect(workspace.links.list(projectKey, {})).toHaveLength(0);
  });

  it("records task.deleted against the project so the deletion survives the cascade", () => {
    const task = seedTask(workspace, projectKey, "Scratch");
    workspace.tasks.delete(task.key, { force: false, actor: "adam" });

    const events = workspace.activity.listForProject(projectKey, { limit: 100 }).events;
    const deletion = events.find((event) => event.eventType === "task.deleted");

    expect(deletion?.payload.taskKey).toBe(task.key);
    expect(deletion?.actor).toBe("adam");
    // The task's own events went with it; only the project-scoped record remains.
    expect(events.some((event) => event.taskKey === task.key)).toBe(false);
  });

  it("refuses to delete a task another agent is holding, unless forced", () => {
    const task = seedTask(workspace, projectKey, "Claimed");
    workspace.claims.claim(task.key, { actor: "codex", sessionId: "abc" });

    expectErrorCode(
      () => workspace.tasks.delete(task.key, { force: false, actor: "adam" }),
      "TASK_ALREADY_CLAIMED",
    );
    expect(workspace.tasks.getSummary(task.key).key).toBe(task.key);

    const deleted = workspace.tasks.delete(task.key, { force: true, actor: "adam" });
    expect(deleted.key).toBe(task.key);
  });

  it("promotes subtasks and rescopes decisions rather than destroying them", () => {
    const parent = seedTask(workspace, projectKey, "Parent");
    const child = workspace.tasks.create(projectKey, { title: "Child", parentTask: parent.key });
    const decision = workspace.decisions.create(projectKey, {
      task: parent.key,
      title: "A choice",
      decision: "Made for the parent task.",
    });

    const deleted = workspace.tasks.delete(parent.key, { force: false });

    expect(deleted.orphanedSubtasks).toEqual([child.key]);
    expect(deleted.detachedDecisions).toEqual([decision.key]);
    expect(workspace.tasks.getSummary(child.key).parentTaskKey).toBeNull();
    expect(workspace.decisions.get(decision.key).taskKey).toBeNull();
  });

  it("severs dependency edges in both directions", () => {
    const a = seedTask(workspace, projectKey, "A");
    const b = seedTask(workspace, projectKey, "B");
    const c = seedTask(workspace, projectKey, "C");
    workspace.tasks.addDependency(b.key, a.key);
    workspace.tasks.addDependency(c.key, b.key);

    const deleted = workspace.tasks.delete(b.key, { force: false });

    expect(deleted.removed.dependencies).toBe(1);
    expect(deleted.removed.dependents).toBe(1);
    expect(workspace.tasks.get(c.key).dependencies).toHaveLength(0);
    expect(workspace.tasks.get(a.key).dependents).toHaveLength(0);
  });

  it("refuses to delete from an archived project", () => {
    const task = seedTask(workspace, projectKey, "Scratch");
    workspace.projects.archive(projectKey);
    expectErrorCode(() => workspace.tasks.delete(task.key, { force: false }), "PROJECT_ARCHIVED");
  });
});
