import { bootstrapProjectSchema } from "@agent-continuity/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestWorkspace, expectErrorCode, type TestWorkspace } from "./helpers.js";

const PLAN = {
  name: "Agent Continuity",
  objective: "Build a persistent execution layer for AI agents",
  context: "The conversation is temporary. The agent is replaceable. Project state persists.",
  actor: "codex",
  sessionId: "abc123",
  tasks: [
    {
      ref: "task-model",
      title: "Design task model",
      status: "ready" as const,
      priority: "high" as const,
      acceptanceCriteria: ["Supports actor identification", "Defines expiry behaviour"],
    },
    {
      ref: "claim-model",
      title: "Design task claim model",
      dependsOn: ["task-model"],
      links: [{ type: "document", url: "https://example.invalid/claims" }],
    },
  ],
  decisions: [
    {
      title: "Task claims use leases",
      decision: "Tasks use temporary expiring claims rather than permanent assignment.",
      rationale: "AI agents and sessions are transient.",
      taskRef: "claim-model",
    },
  ],
  links: [{ type: "repository", provider: "github", reference: "agent-continuity" }],
};

describe("project bootstrap", () => {
  let workspace: TestWorkspace;

  beforeEach(() => {
    workspace = createTestWorkspace();
  });

  afterEach(() => {
    workspace.close();
  });

  it("creates the whole plan and returns a ref map of generated keys", () => {
    const result = workspace.projects.bootstrap(PLAN);

    expect(result.project.key).toBe("PRJ-0001");
    expect(result.refMap).toEqual({ "task-model": "TASK-0001", "claim-model": "TASK-0002" });
    expect(result.tasks).toHaveLength(2);
    expect(result.decisions).toHaveLength(1);
    expect(result.links).toHaveLength(1);

    const claimModel = workspace.tasks.get("TASK-0002");
    expect(claimModel.dependencies.map((task) => task.key)).toEqual(["TASK-0001"]);
    expect(claimModel.links).toHaveLength(1);
    expect(claimModel.decisions).toHaveLength(1);

    const taskModel = workspace.tasks.get("TASK-0001");
    expect(taskModel.acceptanceCriteriaTotal).toBe(2);
    expect(taskModel.isActionable).toBe(true);
  });

  it("records the full activity trail for the bootstrapped project", () => {
    const result = workspace.projects.bootstrap(PLAN);
    const events = workspace.activity
      .listForProject(result.project.key, { limit: 200 })
      .events.map((event) => event.eventType);

    expect(events).toContain("project.created");
    expect(events).toContain("task.created");
    expect(events).toContain("acceptance_criterion.created");
    expect(events).toContain("dependency.added");
    expect(events).toContain("decision.recorded");
    expect(events).toContain("link.added");
  });

  it("rolls the entire operation back when a ref is unknown", () => {
    expectErrorCode(
      () =>
        workspace.projects.bootstrap({
          name: "Broken plan",
          tasks: [{ ref: "a", title: "A", dependsOn: ["does-not-exist"] }],
        }),
      "INVALID_BOOTSTRAP_REFERENCE",
    );

    const projects = workspace.projects.list({ limit: 50, offset: 0, sort: "updated_at_desc" });
    expect(projects.projects).toHaveLength(0);
    expect(projects.total).toBe(0);
  });

  it("rolls back when a decision references an unknown task ref", () => {
    expectErrorCode(
      () =>
        workspace.projects.bootstrap({
          name: "Broken plan",
          tasks: [{ ref: "a", title: "A" }],
          decisions: [{ title: "T", decision: "D", taskRef: "missing" }],
        }),
      "INVALID_BOOTSTRAP_REFERENCE",
    );

    expect(workspace.projects.list({ limit: 50, offset: 0, sort: "updated_at_desc" }).total).toBe(0);
  });

  it("rejects duplicate task refs", () => {
    expectErrorCode(
      () =>
        workspace.projects.bootstrap({
          name: "Broken plan",
          tasks: [
            { ref: "a", title: "A" },
            { ref: "a", title: "Also A" },
          ],
        }),
      "INVALID_BOOTSTRAP_REFERENCE",
    );
  });

  it("does not consume identifier sequences when the transaction rolls back", () => {
    expectErrorCode(
      () =>
        workspace.projects.bootstrap({
          name: "Broken plan",
          tasks: [{ ref: "a", title: "A", dependsOn: ["missing"] }],
        }),
      "INVALID_BOOTSTRAP_REFERENCE",
    );

    const recovered = workspace.projects.bootstrap({ name: "Working plan" });
    expect(recovered.project.key).toBe("PRJ-0001");
  });

  it("supports subtasks through parentRef", () => {
    const result = workspace.projects.bootstrap({
      name: "Hierarchy",
      tasks: [
        { ref: "parent", title: "Parent" },
        { ref: "child", title: "Child", parentRef: "parent" },
      ],
    });

    const child = workspace.tasks.get(result.refMap.child!);
    expect(child.parentTaskKey).toBe(result.refMap.parent);
  });

  it("creates an empty project when no tasks are supplied", () => {
    const result = workspace.projects.bootstrap({ name: "Just a project" });
    expect(result.tasks).toHaveLength(0);
    expect(result.project.progress).toBeNull();
  });
});

/**
 * A plan written for the snake_case MCP tool used to lose its acceptance criteria,
 * dependencies and task scopes when sent to the camelCase REST body, because unknown
 * keys were quietly stripped. Both casings must work, and genuine typos must fail loudly.
 */
describe("bootstrap request parsing", () => {
  let workspace: TestWorkspace;

  beforeEach(() => {
    workspace = createTestWorkspace();
  });

  afterEach(() => {
    workspace.close();
  });

  it("accepts a snake_case plan without losing any of it", () => {
    const parsed = bootstrapProjectSchema.parse({
      name: "Trailhead",
      session_id: "session-a",
      actor: "agent-a",
      tasks: [
        { ref: "store", title: "Storage layer", acceptance_criteria: ["Migrations are versioned"] },
        { ref: "log", title: "Log command", depends_on: ["store"], parent_ref: "store" },
      ],
      decisions: [{ title: "SQLite", decision: "Store hikes in SQLite.", task_ref: "store" }],
      links: [{ type: "repository", provider: "github", reference: "trailhead", task_ref: "store" }],
    });

    const result = workspace.projects.bootstrap(parsed);

    const store = workspace.tasks.get(result.refMap.store!);
    expect(store.acceptanceCriteriaTotal).toBe(1);
    expect(store.links).toHaveLength(1);
    expect(store.decisions).toHaveLength(1);

    const log = workspace.tasks.get(result.refMap.log!);
    expect(log.dependencies.map((task) => task.key)).toEqual([store.key]);
    expect(log.parentTaskKey).toBe(store.key);
  });

  it("lets an explicit camelCase key win over its snake_case alias", () => {
    const parsed = bootstrapProjectSchema.parse({
      name: "Trailhead",
      tasks: [
        {
          ref: "store",
          title: "Storage layer",
          acceptanceCriteria: ["canonical"],
          acceptance_criteria: ["alias"],
        },
      ],
    });

    expect(parsed.tasks?.[0]?.acceptanceCriteria).toEqual(["canonical"]);
  });

  it("rejects an unrecognised field rather than silently dropping it", () => {
    expect(() => bootstrapProjectSchema.parse({ name: "Trailhead", totallyBogus: 42 })).toThrow();
    expect(() =>
      bootstrapProjectSchema.parse({
        name: "Trailhead",
        tasks: [{ title: "A", acceptanceCriterion: ["typo, singular"] }],
      }),
    ).toThrow();
  });
});
