import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createTestWorkspace,
  eventTypes,
  expectErrorCode,
  seedProject,
  seedTask,
  type TestWorkspace,
} from "./helpers.js";

describe("task dependencies", () => {
  let workspace: TestWorkspace;
  let projectKey: string;

  beforeEach(() => {
    workspace = createTestWorkspace();
    projectKey = seedProject(workspace).key;
  });

  afterEach(() => {
    workspace.close();
  });

  it("adds and removes a dependency, recording both events", () => {
    const a = seedTask(workspace, projectKey, "A");
    const b = seedTask(workspace, projectKey, "B");

    workspace.tasks.addDependency(a.key, b.key, { actor: "codex" });
    expect(workspace.tasks.get(a.key).dependencies.map((task) => task.key)).toEqual([b.key]);
    expect(workspace.tasks.get(b.key).dependents.map((task) => task.key)).toEqual([a.key]);

    workspace.tasks.removeDependency(a.key, b.key, { actor: "codex" });
    expect(workspace.tasks.get(a.key).dependencies).toHaveLength(0);

    const events = eventTypes(workspace, projectKey);
    expect(events).toContain("dependency.added");
    expect(events).toContain("dependency.removed");
  });

  it("is idempotent when the same dependency is added twice", () => {
    const a = seedTask(workspace, projectKey, "A");
    const b = seedTask(workspace, projectKey, "B");

    workspace.tasks.addDependency(a.key, b.key);
    workspace.tasks.addDependency(a.key, b.key);
    expect(workspace.tasks.get(a.key).dependencies).toHaveLength(1);
  });

  it("rejects a self dependency", () => {
    const a = seedTask(workspace, projectKey, "A");
    expectErrorCode(() => workspace.tasks.addDependency(a.key, a.key), "DEPENDENCY_SELF_REFERENCE");
  });

  it("rejects a cross project dependency", () => {
    const a = seedTask(workspace, projectKey, "A");
    const other = seedProject(workspace, "Other");
    const foreign = seedTask(workspace, other.key, "Foreign");

    expectErrorCode(
      () => workspace.tasks.addDependency(a.key, foreign.key),
      "DEPENDENCY_CROSS_PROJECT",
    );
  });

  it("rejects a direct cycle and names the path", () => {
    const a = seedTask(workspace, projectKey, "A");
    const b = seedTask(workspace, projectKey, "B");
    workspace.tasks.addDependency(a.key, b.key);

    const error = expectErrorCode(
      () => workspace.tasks.addDependency(b.key, a.key),
      "DEPENDENCY_CYCLE",
    );
    expect(error.details.cycle).toBe(`${b.key} → ${a.key} → ${b.key}`);
    expect(error.message).toContain("would create the dependency cycle");
  });

  it("rejects a multi level cycle", () => {
    const a = seedTask(workspace, projectKey, "A");
    const b = seedTask(workspace, projectKey, "B");
    const c = seedTask(workspace, projectKey, "C");

    workspace.tasks.addDependency(a.key, b.key);
    workspace.tasks.addDependency(b.key, c.key);

    const error = expectErrorCode(
      () => workspace.tasks.addDependency(c.key, a.key),
      "DEPENDENCY_CYCLE",
    );
    expect(error.details.cycle).toBe(`${c.key} → ${a.key} → ${b.key} → ${c.key}`);
  });

  it("allows a diamond, which is not a cycle", () => {
    const a = seedTask(workspace, projectKey, "A");
    const b = seedTask(workspace, projectKey, "B");
    const c = seedTask(workspace, projectKey, "C");
    const d = seedTask(workspace, projectKey, "D");

    workspace.tasks.addDependency(a.key, b.key);
    workspace.tasks.addDependency(a.key, c.key);
    workspace.tasks.addDependency(b.key, d.key);
    workspace.tasks.addDependency(c.key, d.key);

    expect(workspace.tasks.get(d.key).dependents).toHaveLength(2);
  });

  it("raises DEPENDENCY_NOT_FOUND when removing an edge that does not exist", () => {
    const a = seedTask(workspace, projectKey, "A");
    const b = seedTask(workspace, projectKey, "B");
    expectErrorCode(() => workspace.tasks.removeDependency(a.key, b.key), "DEPENDENCY_NOT_FOUND");
  });
});
