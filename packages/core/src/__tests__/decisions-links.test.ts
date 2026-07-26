import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createTestWorkspace,
  eventTypes,
  expectErrorCode,
  seedProject,
  seedTask,
  type TestWorkspace,
} from "./helpers.js";

describe("decisions", () => {
  let workspace: TestWorkspace;
  let projectKey: string;

  beforeEach(() => {
    workspace = createTestWorkspace();
    projectKey = seedProject(workspace).key;
  });

  afterEach(() => {
    workspace.close();
  });

  it("records a project scoped decision", () => {
    const decision = workspace.decisions.create(projectKey, {
      title: "Use lease-based task claims",
      decision: "Tasks use temporary claims rather than permanent assignment.",
      rationale: "Agent sessions are transient.",
      actor: "codex",
    });

    expect(decision.key).toBe("DEC-0001");
    expect(decision.taskKey).toBeNull();
    expect(eventTypes(workspace, projectKey)).toContain("decision.recorded");
  });

  it("records a task scoped decision", () => {
    const task = seedTask(workspace, projectKey);
    const decision = workspace.decisions.create(projectKey, {
      task: task.key,
      title: "Claims expire",
      decision: "Claims are leases with a default 30 minute expiry.",
      actor: "codex",
    });

    expect(decision.taskKey).toBe(task.key);
    expect(workspace.tasks.get(task.key).decisions).toHaveLength(1);
  });

  it("rejects a task from another project", () => {
    const other = seedProject(workspace, "Other");
    const foreign = seedTask(workspace, other.key, "Foreign");

    expectErrorCode(
      () =>
        workspace.decisions.create(projectKey, {
          task: foreign.key,
          title: "Wrong scope",
          decision: "Should not be allowed.",
        }),
      "VALIDATION_ERROR",
    );
  });

  it("supersedes an earlier decision", () => {
    const first = workspace.decisions.create(projectKey, {
      title: "Permanent assignment",
      decision: "Tasks are permanently assigned to an agent.",
    });
    const second = workspace.decisions.create(projectKey, {
      title: "Use lease-based task claims",
      decision: "Tasks use temporary claims.",
      supersedes: first.key,
    });

    const reloaded = workspace.decisions.get(first.key);
    expect(reloaded.supersededByKey).toBe(second.key);
    expect(reloaded.supersededAt).not.toBeNull();
    expect(eventTypes(workspace, projectKey)).toContain("decision.superseded");
  });

  it("filters decisions by task and free text", () => {
    const task = seedTask(workspace, projectKey);
    workspace.decisions.create(projectKey, {
      title: "Domain agnostic core",
      decision: "No Git or Jira fields in the core model.",
    });
    workspace.decisions.create(projectKey, {
      task: task.key,
      title: "Lease duration",
      decision: "Thirty minutes by default.",
    });

    expect(workspace.decisions.list(projectKey, { task: task.key, limit: 100 })).toHaveLength(1);
    expect(workspace.decisions.list(projectKey, { search: "Jira", limit: 100 })).toHaveLength(1);
    expect(workspace.decisions.list(projectKey, { limit: 100 })).toHaveLength(2);
  });
});

describe("links", () => {
  let workspace: TestWorkspace;
  let projectKey: string;

  beforeEach(() => {
    workspace = createTestWorkspace();
    projectKey = seedProject(workspace).key;
  });

  afterEach(() => {
    workspace.close();
  });

  it("adds a project link with generic metadata", () => {
    const [link] = workspace.links.add(projectKey, {
      type: "issue",
      provider: "jira",
      reference: "AC-42",
      url: "https://example.invalid/browse/AC-42",
      metadata: { status: "In Progress" },
      actor: "codex",
    });

    expect(link!.key).toBe("LNK-0001");
    expect(link!.metadata).toEqual({ status: "In Progress" });
    expect(eventTypes(workspace, projectKey)).toContain("link.added");
  });

  it("adds several links in one operation", () => {
    const task = seedTask(workspace, projectKey);
    const created = workspace.links.add(projectKey, {
      task: task.key,
      links: [
        { type: "branch", provider: "git", reference: "feature/TASK-0001" },
        { type: "document", url: "https://example.invalid/prd" },
      ],
    });

    expect(created).toHaveLength(2);
    expect(workspace.tasks.get(task.key).links).toHaveLength(2);
  });

  it("rejects metadata that is not a JSON object", () => {
    expectErrorCode(
      () =>
        workspace.links.add(projectKey, {
          type: "issue",
          metadata: ["not", "an", "object"] as unknown as Record<string, unknown>,
        }),
      "INVALID_METADATA",
    );
  });

  it("filters links and removes them", () => {
    workspace.links.add(projectKey, { type: "issue", provider: "jira", reference: "AC-42" });
    const [repository] = workspace.links.add(projectKey, {
      type: "repository",
      provider: "github",
      reference: "agent-continuity",
    });

    expect(workspace.links.list(projectKey, { type: "issue" })).toHaveLength(1);
    expect(workspace.links.list(projectKey, { provider: "github" })).toHaveLength(1);

    workspace.links.remove(repository!.key, { actor: "adam" });
    expect(workspace.links.list(projectKey, {})).toHaveLength(1);
    expect(eventTypes(workspace, projectKey)).toContain("link.removed");
  });

  it("rejects a task link from another project", () => {
    const other = seedProject(workspace, "Other");
    const foreign = seedTask(workspace, other.key, "Foreign");

    expectErrorCode(
      () => workspace.links.add(projectKey, { task: foreign.key, type: "issue" }),
      "VALIDATION_ERROR",
    );
  });
});
