import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createTestWorkspace,
  eventTypes,
  expectErrorCode,
  seedProject,
  seedTask,
  type TestWorkspace,
} from "./helpers.js";

describe("project service", () => {
  let workspace: TestWorkspace;

  beforeEach(() => {
    workspace = createTestWorkspace();
  });

  afterEach(() => {
    workspace.close();
  });

  it("creates a project with a human readable key and records project.created", () => {
    const project = seedProject(workspace);

    expect(project.key).toBe("PRJ-0001");
    expect(project.status).toBe("active");
    expect(project.progress).toBeNull();
    expect(eventTypes(workspace, project.key)).toContain("project.created");
  });

  it("allocates sequential keys", () => {
    seedProject(workspace, "First");
    const second = seedProject(workspace, "Second");
    expect(second.key).toBe("PRJ-0002");
  });

  it("resolves a project by uuid or by key in any case", () => {
    const project = seedProject(workspace);
    expect(workspace.projects.get(project.id).key).toBe(project.key);
    expect(workspace.projects.get("prj-1").key).toBe(project.key);
    expect(workspace.projects.get("PRJ-0001").key).toBe(project.key);
  });

  it("reports task counts and progress", () => {
    const project = seedProject(workspace);
    const done = seedTask(workspace, project.key, "Done work");
    seedTask(workspace, project.key, "Outstanding work");
    workspace.tasks.complete(done.key, { force: false, actor: "codex" });

    const detail = workspace.projects.get(project.key);
    expect(detail.taskCounts.done).toBe(1);
    expect(detail.taskCounts.backlog).toBe(1);
    expect(detail.progress).toBeCloseTo(0.5);
  });

  it("updates fields and records project.updated", () => {
    const project = seedProject(workspace);
    const updated = workspace.projects.update(project.key, {
      name: "Agent Workspace v0.1",
      objective: "Persistent execution for AI agents",
      actor: "adam",
    });

    expect(updated.name).toBe("Agent Workspace v0.1");
    expect(eventTypes(workspace, project.key)).toContain("project.updated");
  });

  it("stores context and records only its length in activity", () => {
    const project = seedProject(workspace);
    workspace.projects.updateContext(project.key, { context: "A".repeat(482), actor: "codex" });
    const updated = workspace.projects.updateContext(project.key, {
      context: "B".repeat(731),
      actor: "codex",
    });

    expect(updated.context).toHaveLength(731);

    const event = workspace.activity
      .listForProject(project.key, { limit: 50 })
      .events.find((candidate) => candidate.eventType === "project.context_updated");

    expect(event?.payload).toEqual({ previousLength: 482, newLength: 731 });
    expect(JSON.stringify(event?.payload)).not.toContain("BBB");
  });

  it("archives a project and rejects further mutations", () => {
    const project = seedProject(workspace);
    const archived = workspace.projects.archive(project.key, { actor: "adam" });

    expect(archived.status).toBe("archived");
    expect(archived.archivedAt).not.toBeNull();
    expect(eventTypes(workspace, project.key)).toContain("project.archived");

    expectErrorCode(
      () => workspace.tasks.create(project.key, { title: "Too late" }),
      "PROJECT_ARCHIVED",
    );
  });

  it("filters, searches and sorts the project list", () => {
    const first = seedProject(workspace, "Alpha");
    const second = seedProject(workspace, "Beta");
    workspace.projects.archive(second.key);

    const active = workspace.projects.list({
      status: ["active"],
      limit: 50,
      offset: 0,
      sort: "name_asc",
    });
    expect(active.projects.map((project) => project.key)).toEqual([first.key]);
    expect(active.total).toBe(1);

    const searched = workspace.projects.list({
      search: "Beta",
      limit: 50,
      offset: 0,
      sort: "updated_at_desc",
    });
    expect(searched.projects.map((project) => project.name)).toEqual(["Beta"]);
  });

  it("raises PROJECT_NOT_FOUND for an unknown reference", () => {
    expectErrorCode(() => workspace.projects.get("PRJ-9999"), "PROJECT_NOT_FOUND");
  });
});
