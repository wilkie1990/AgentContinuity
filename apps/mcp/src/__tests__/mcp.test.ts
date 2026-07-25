import { createTestWorkspace, type TestWorkspace } from "@agent-workspace/core/testing";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMcpServer } from "../server.js";

type CallResult = { text: string; isError: boolean };

describe("MCP adapter", () => {
  let workspace: TestWorkspace;
  let client: Client;
  let close: () => Promise<void>;

  const call = async (name: string, args: Record<string, unknown> = {}): Promise<CallResult> => {
    const result = (await client.callTool({ name, arguments: args })) as {
      content?: { type: string; text?: string }[];
      isError?: boolean;
    };
    const text = (result.content ?? [])
      .filter((entry) => entry.type === "text")
      .map((entry) => entry.text ?? "")
      .join("\n");
    return { text, isError: result.isError === true };
  };

  beforeEach(async () => {
    workspace = createTestWorkspace();
    const server = createMcpServer(workspace);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    client = new Client({ name: "test-agent", version: "0.0.0" });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

    close = async () => {
      await client.close();
      await server.close();
    };
  });

  afterEach(async () => {
    await close();
    workspace.close();
  });

  it("advertises the documented tool surface", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name).sort();

    expect(names).toEqual(
      [
        "activity_list",
        "decisions_create",
        "decisions_list",
        "links_add",
        "links_list",
        "links_remove",
        "projects_bootstrap",
        "projects_create",
        "projects_get",
        "projects_list",
        "projects_update",
        "projects_update_context",
        "tasks_add_acceptance_criteria",
        "tasks_add_blocker",
        "tasks_add_dependency",
        "tasks_add_progress",
        "tasks_claim",
        "tasks_complete",
        "tasks_create",
        "tasks_delete",
        "tasks_get",
        "tasks_list",
        "tasks_release_claim",
        "tasks_remove_dependency",
        "tasks_resolve_blocker",
        "tasks_update",
        "tasks_update_acceptance_criteria",
        "tasks_update_context",
      ].sort(),
    );

    for (const tool of tools) {
      expect(tool.description, `${tool.name} needs a description`).toBeTruthy();
      expect(tool.inputSchema).toBeTruthy();
    }
  });

  it("rejects input that does not satisfy a tool schema", async () => {
    const result = await call("projects_create", {});
    expect(result.isError).toBe(true);
  });

  it("preserves the domain error code", async () => {
    const missing = await call("tasks_get", { task: "TASK-9999" });
    expect(missing.isError).toBe(true);
    expect(missing.text).toContain("TASK_NOT_FOUND");

    await call("projects_create", { name: "Agent Workspace" });
    await call("tasks_create", { project: "PRJ-0001", tasks: [{ title: "A" }] });
    await call("tasks_claim", { task: "TASK-0001", actor: "codex" });

    const conflict = await call("tasks_claim", { task: "TASK-0001", actor: "claude-code" });
    expect(conflict.isError).toBe(true);
    expect(conflict.text).toContain("TASK_ALREADY_CLAIMED");
  });

  it("explains dependency cycles in the error text", async () => {
    await call("projects_create", { name: "Agent Workspace" });
    await call("tasks_create", { project: "PRJ-0001", tasks: [{ title: "A" }, { title: "B" }] });
    await call("tasks_add_dependency", { task: "TASK-0001", depends_on: "TASK-0002" });

    const cycle = await call("tasks_add_dependency", { task: "TASK-0002", depends_on: "TASK-0001" });
    expect(cycle.isError).toBe(true);
    expect(cycle.text).toContain(
      "Cannot add TASK-0001 as a dependency of TASK-0002 because it would create the dependency cycle TASK-0002 → TASK-0001 → TASK-0002.",
    );
  });

  it("renders task state in an agent readable form", async () => {
    await call("projects_bootstrap", {
      name: "Agent Workspace",
      tasks: [
        {
          ref: "claim-model",
          title: "Design task claim model",
          status: "ready",
          priority: "high",
          context: "Permanent agent assignment was rejected because sessions are transient.",
          acceptance_criteria: ["Supports actor identification", "Defines expiry behaviour"],
        },
      ],
    });

    await call("tasks_claim", { task: "TASK-0001", actor: "codex", session_id: "abc123" });
    await call("tasks_update_acceptance_criteria", {
      task: "TASK-0001",
      complete: ["Supports actor identification"],
    });
    await call("tasks_add_progress", {
      task: "TASK-0001",
      content: "Initial lease data model designed.",
      actor: "codex",
      session_id: "abc123",
    });

    const detail = await call("tasks_get", { task: "TASK-0001" });
    expect(detail.text).toContain("TASK-0001 — Design task claim model");
    expect(detail.text).toContain("Status: in_progress");
    expect(detail.text).toContain("Priority: high");
    expect(detail.text).toContain("[✓] Supports actor identification");
    expect(detail.text).toContain("[ ] Defines expiry behaviour");
    expect(detail.text).toContain("session: abc123");
    expect(detail.text).toContain("expires in: 30 minutes");
    expect(detail.text).toContain("- Initial lease data model designed.");
    expect(detail.text).toContain("Recommended state:\nContinue current task.");
    expect(detail.text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/);
  });

  it("completes the full agent handover scenario", async () => {
    // Agent A converts a plan into a project.
    const bootstrap = await call("projects_bootstrap", {
      name: "Agent Workspace",
      objective: "Build a persistent execution layer for AI agents",
      context: "The conversation is temporary. The agent is replaceable. Project state persists.",
      tasks: [
        { ref: "task-model", title: "Design task model", status: "ready" },
        {
          ref: "claim-model",
          title: "Design task claim model",
          status: "ready",
          depends_on: ["task-model"],
          acceptance_criteria: ["Defines expiry behaviour"],
        },
      ],
      decisions: [
        {
          title: "Domain agnostic core",
          decision: "The core model contains no Git or Jira specific fields.",
          rationale: "Specialist concepts belong in links and Skills.",
        },
      ],
      actor: "codex",
      session_id: "session-a",
    });
    expect(bootstrap.isError).toBe(false);
    expect(bootstrap.text).toContain("task-model -> TASK-0001");

    expect((await call("projects_list", {})).text).toContain("PRJ-0001 — Agent Workspace");
    expect((await call("projects_get", { project: "PRJ-0001" })).text).toContain(
      "The conversation is temporary.",
    );

    const actionable = await call("tasks_list", { project: "PRJ-0001", actionable_only: true });
    expect(actionable.text).toContain("TASK-0001");
    expect(actionable.text).not.toContain("TASK-0002");

    await call("tasks_claim", { task: "TASK-0001", actor: "codex", session_id: "session-a" });
    await call("tasks_add_progress", {
      task: "TASK-0001",
      content: "Existing implementation analysed and the data model drafted.",
      actor: "codex",
      session_id: "session-a",
    });
    await call("decisions_create", {
      project: "PRJ-0001",
      task: "TASK-0001",
      title: "Task claims use leases",
      decision: "Tasks use temporary expiring claims rather than permanent assignment.",
      rationale: "AI agents and sessions are transient.",
      actor: "codex",
      session_id: "session-a",
    });
    await call("tasks_update_context", {
      task: "TASK-0001",
      context: "The identifier strategy is UUID internally with a human readable key.",
      actor: "codex",
      session_id: "session-a",
    });
    const released = await call("tasks_release_claim", {
      task: "TASK-0001",
      actor: "codex",
      session_id: "session-a",
      reason: "session ending",
    });
    expect(released.isError).toBe(false);

    // Agent B continues in a new session.
    const handover = await call("tasks_get", { task: "TASK-0001" });
    expect(handover.text).toContain("Existing implementation analysed");
    expect(handover.text).toContain("The identifier strategy is UUID internally");
    expect(handover.text).toContain("DEC-0002 — Task claims use leases");
    expect(handover.text).toContain("Recommended state:\nClaim this task before beginning");

    await call("tasks_claim", { task: "TASK-0001", actor: "claude-code", session_id: "session-b" });
    await call("tasks_complete", { task: "TASK-0001", actor: "claude-code" });

    const now = await call("tasks_list", { project: "PRJ-0001", actionable_only: true });
    expect(now.text).toContain("TASK-0002");

    await call("tasks_claim", { task: "TASK-0002", actor: "claude-code", session_id: "session-b" });
    const blocked = await call("tasks_complete", { task: "TASK-0002", actor: "claude-code" });
    expect(blocked.isError).toBe(true);
    expect(blocked.text).toContain("TASK_HAS_INCOMPLETE_ACCEPTANCE_CRITERIA");

    await call("tasks_update_acceptance_criteria", {
      task: "TASK-0002",
      complete: ["Defines expiry behaviour"],
      actor: "claude-code",
    });
    const completed = await call("tasks_complete", { task: "TASK-0002", actor: "claude-code" });
    expect(completed.isError).toBe(false);

    const activity = await call("activity_list", { project: "PRJ-0001", limit: 200 });
    expect(activity.text).toContain("task.claimed");
    expect(activity.text).toContain("task.progress_added");
    expect(activity.text).toContain("decision.recorded");
    expect(activity.text).toContain("task.completed");

    expect((await call("projects_get", { project: "PRJ-0001" })).text).toContain("Progress: 100%");
  });

  it("manages blockers, links and criteria through their tools", async () => {
    await call("projects_create", { name: "Agent Workspace" });
    await call("tasks_create", { project: "PRJ-0001", tasks: [{ title: "Design", status: "ready" }] });

    const blocked = await call("tasks_add_blocker", {
      task: "TASK-0001",
      description: "Expected provider behaviour is unclear.",
      required_action: "Confirm whether legacy behaviour must be preserved.",
      actor: "codex",
    });
    expect(blocked.text).toContain("blocked by BLK-0001");

    const resolved = await call("tasks_resolve_blocker", {
      blocker: "BLK-0001",
      resolution: "Confirmed that existing behaviour must be preserved.",
      actor: "adam",
    });
    expect(resolved.text).toContain("TASK-0001 is now ready");

    const links = await call("links_add", {
      project: "PRJ-0001",
      task: "TASK-0001",
      links: [
        { type: "issue", provider: "jira", reference: "AW-42" },
        { type: "branch", provider: "git", reference: "feature/TASK-0001" },
      ],
    });
    expect(links.text).toContain("Added 2 link(s)");
    expect((await call("links_list", { project: "PRJ-0001", type: "issue" })).text).toContain("AW-42");

    await call("links_remove", { link: "LNK-0001" });
    expect((await call("links_list", { project: "PRJ-0001" })).text).not.toContain("AW-42");

    await call("tasks_add_acceptance_criteria", {
      task: "TASK-0001",
      criteria: ["Outcome is objectively checkable"],
    });
    const updated = await call("tasks_update_acceptance_criteria", {
      task: "TASK-0001",
      complete: ["Outcome is objectively checkable"],
    });
    expect(updated.text).toContain("(1/1)");
    expect(updated.text).toContain("[✓] Outcome is objectively checkable");
  });
});
