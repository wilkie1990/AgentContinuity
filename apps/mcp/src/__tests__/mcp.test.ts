import { createTestWorkspace, type TestWorkspace } from "@agent-continuity/core/testing";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { mkdtempSync, mkdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MCP_AGENT_TOOL_NAMES, MCP_FULL_TOOL_NAMES, parseMcpProfile } from "../profile.js";
import { createMcpServer } from "../server.js";

type CallResult = { text: string; isError: boolean };
const temporaryDirectories: string[] = [];

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
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("advertises the documented tool surface", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name).sort();

    expect(names).toEqual(
      [
        "activity_list",
        "attention_list",
        "decisions_create",
        "decisions_list",
        "links_add",
        "links_list",
        "links_remove",
        "profile_info",
        "handoff",
        "projects_bootstrap",
        "projects_context_history",
        "projects_context_revert",
        "projects_context_version_get",
        "projects_create",
        "projects_delete",
        "projects_get",
        "projects_list",
        "projects_update",
        "projects_update_context",
        "report",
        "repositories_add",
        "repositories_get",
        "repositories_list",
        "repositories_remove",
        "repositories_update",
        "start_work",
        "search",
        "tasks_add_acceptance_criteria",
        "tasks_add_blocker",
        "tasks_add_criterion_evidence",
        "tasks_add_dependency",
        "tasks_add_execution_origin",
        "tasks_add_progress",
        "tasks_checkpoint",
        "tasks_claim",
        "tasks_complete",
        "tasks_criterion_evidence",
        "tasks_criterion_evidence_policy",
        "tasks_context_history",
        "tasks_context_revert",
        "tasks_context_version_get",
        "tasks_create",
        "tasks_delete",
        "tasks_get",
        "tasks_execution_get",
        "tasks_git_provenance_capture",
        "tasks_git_provenance_get",
        "tasks_heartbeat",
        "tasks_list",
        "tasks_path_ownership_get",
        "tasks_path_ownership_set",
        "tasks_release_claim",
        "tasks_remove_dependency",
        "tasks_resolve_blocker",
        "tasks_update",
        "tasks_update_acceptance_criteria",
        "tasks_update_context",
        "tasks_work_plan",
        "tasks_worktree_bind",
        "tasks_worktree_get",
        "tasks_worktree_unbind",
      ].sort(),
    );
    expect(names).toEqual([...MCP_FULL_TOOL_NAMES].sort());

    for (const tool of tools) {
      expect(tool.description, `${tool.name} needs a description`).toBeTruthy();
      expect(tool.inputSchema).toBeTruthy();
    }
    expect(names.some((name) => /verify|command|execute|run/.test(name))).toBe(false);
    const evidenceTool = tools.find((tool) => tool.name === "tasks_add_criterion_evidence")!;
    expect(JSON.stringify(evidenceTool.inputSchema)).not.toMatch(/executable|cwd|timeout/);
  });

  it("supports complete non-destructive work through the agent profile", async () => {
    const agentServer = createMcpServer(workspace, { profile: parseMcpProfile("agent") });
    const [agentTransport, agentServerTransport] = InMemoryTransport.createLinkedPair();
    const agentClient = new Client({ name: "agent-profile-test", version: "0.0.0" });
    try {
      await Promise.all([agentClient.connect(agentTransport), agentServer.connect(agentServerTransport)]);
      const { tools } = await agentClient.listTools();
      const names = tools.map((tool) => tool.name).sort();
      expect(names).toEqual([...MCP_AGENT_TOOL_NAMES].sort());
      expect(names).toEqual(
        expect.arrayContaining([
          "projects_list", "projects_bootstrap", "projects_get", "projects_update_context",
          "repositories_add", "tasks_get", "tasks_update_context", "attention_list", "search",
          "start_work", "report", "handoff", "tasks_work_plan", "tasks_path_ownership_set",
          "tasks_add_blocker", "tasks_resolve_blocker", "decisions_create",
          "tasks_add_criterion_evidence", "tasks_update_acceptance_criteria", "tasks_complete",
        ]),
      );
      expect(names).not.toEqual(expect.arrayContaining([
        "projects_delete", "repositories_remove", "tasks_delete", "links_remove",
        "tasks_claim", "tasks_release_claim", "tasks_heartbeat", "tasks_checkpoint",
      ]));

      const agentCall = async (
        name: string,
        args: Record<string, unknown> = {},
      ): Promise<CallResult> => {
        const result = (await agentClient.callTool({ name, arguments: args })) as {
          content?: { type: string; text?: string }[];
          isError?: boolean;
        };
        return {
          text: (result.content ?? [])
            .filter((entry) => entry.type === "text")
            .map((entry) => entry.text ?? "")
            .join("\n"),
          isError: result.isError === true,
        };
      };

      const guidance = (await agentCall("profile_info")).text;
      expect(guidance).toContain("AGENT_CONTINUITY_MCP_PROFILE=full");
      expect(guidance).toContain("generic dispatcher");

      expect(
        (
          await agentCall("projects_bootstrap", {
            name: "Agent profile workflow",
            tasks: [
              {
                ref: "complete",
                title: "Complete profile task",
                status: "ready",
                acceptance_criteria: ["Profile work is proven"],
              },
              { ref: "handoff", title: "Handoff profile task", status: "ready" },
            ],
            actor: "profile-agent",
            session_id: "profile-session",
          })
        ).isError,
      ).toBe(false);
      expect((await agentCall("projects_list")).text).toContain("Agent profile workflow");
      expect((await agentCall("projects_get", { project: "PRJ-0001" })).text).toContain(
        "Agent profile workflow",
      );
      expect(
        (await agentCall("tasks_get", { task: "TASK-0001" })).text,
      ).toContain("Complete profile task");
      expect(
        (
          await agentCall("projects_update_context", {
            project: "PRJ-0001",
            context: "Durable profile context.",
            expected_version: 0,
            actor: "profile-agent",
            session_id: "profile-session",
          })
        ).isError,
      ).toBe(false);

      const root = mkdtempSync(join(tmpdir(), "agent-continuity-agent-profile-"));
      temporaryDirectories.push(root);
      const worktree = join(root, "worktree");
      mkdirSync(worktree);
      expect(
        (
          await agentCall("repositories_add", {
            project: "PRJ-0001",
            label: "Profile repository",
            root_path: root,
            actor: "profile-agent",
            session_id: "profile-session",
          })
        ).isError,
      ).toBe(false);
      expect(
        (
          await agentCall("start_work", {
            task: "TASK-0001",
            actor: "profile-agent",
            session_id: "profile-session",
            worktree: {
              repository: "REP-0001",
              worktree_path: worktree,
              branch: "profile-test",
            },
          })
        ).text,
      ).toContain("Work started");
      expect(
        (
          await agentCall("tasks_update_context", {
            task: "TASK-0001",
            context: "Durable task context.",
            expected_version: 0,
            actor: "profile-agent",
            session_id: "profile-session",
          })
        ).isError,
      ).toBe(false);
      expect(
        (
          await agentCall("tasks_work_plan", {
            task: "TASK-0001",
            items: ["Implement", "Verify"],
            actor: "profile-agent",
            session_id: "profile-session",
          })
        ).text,
      ).toContain("Work plan updated");
      expect(
        (
          await agentCall("tasks_path_ownership_set", {
            task: "TASK-0001",
            paths: [{ path: "apps/mcp", kind: "directory" }],
            actor: "profile-agent",
            session_id: "profile-session",
          })
        ).text,
      ).toContain("directory: apps/mcp");
      expect(
        (
          await agentCall("report", {
            task: "TASK-0001",
            actor: "profile-agent",
            session_id: "profile-session",
            progress: "Measured profile workflow.",
          })
        ).text,
      ).toContain("Measured profile workflow");
      expect(
        (
          await agentCall("decisions_create", {
            project: "PRJ-0001",
            task: "TASK-0001",
            title: "Keep typed tools",
            decision: "Use named typed operations.",
            rationale: "Preserves auditability.",
            actor: "profile-agent",
            session_id: "profile-session",
          })
        ).text,
      ).toContain("Recorded DEC-0001");
      expect(
        (
          await agentCall("tasks_add_blocker", {
            task: "TASK-0001",
            description: "Temporary profile test blocker.",
            required_action: "Resolve it in the same workflow.",
            actor: "profile-agent",
            session_id: "profile-session",
          })
        ).text,
      ).toContain("BLK-0001");
      expect(
        (
          await agentCall("tasks_resolve_blocker", {
            blocker: "BLK-0001",
            resolution: "The profile exposes blocker resolution.",
            actor: "profile-agent",
            session_id: "profile-session",
          })
        ).text,
      ).toContain("Resolved BLK-0001");
      expect(
        (
          await agentCall("search", {
            query: "Measured profile workflow",
            project: "PRJ-0001",
          })
        ).text,
      ).toContain("[Measured] [profile] [workflow]");
      expect(
        (
          await agentCall("tasks_add_criterion_evidence", {
            task: "TASK-0001",
            criterion: "Profile work is proven",
            kind: "test",
            name: "Agent profile lifecycle",
            outcome: "passed",
            reference: "apps/mcp/src/__tests__/mcp.test.ts",
            actor: "profile-agent",
            session_id: "profile-session",
          })
        ).text,
      ).toContain("(test) attached");
      expect(
        (
          await agentCall("tasks_update_acceptance_criteria", {
            task: "TASK-0001",
            complete: ["Profile work is proven"],
            actor: "profile-agent",
            session_id: "profile-session",
          })
        ).text,
      ).toContain("(1/1)");
      expect(
        (
          await agentCall("tasks_complete", {
            task: "TASK-0001",
            actor: "profile-agent",
            session_id: "profile-session",
          })
        ).text,
      ).toContain("Completed TASK-0001");
      expect((await agentCall("tasks_get", { task: "TASK-0001" })).text).toContain("Status: done");
      expect(
        (
          await agentCall("start_work", {
            task: "TASK-0002",
            actor: "profile-agent",
            session_id: "profile-session",
          })
        ).text,
      ).toContain("Work started");
      expect(
        (
          await agentCall("handoff", {
            task: "TASK-0002",
            actor: "profile-agent",
            session_id: "profile-session",
            checkpoint: {
              completed: "Measured reduced profile.",
              working_on: "Nothing.",
              next: "Review results.",
            },
          })
        ).text,
      ).toContain("Claim released safely");
    } finally {
      await agentClient.close();
      await agentServer.close();
    }
  });

  it("rejects unknown MCP profile names before server startup", () => {
    expect(() => parseMcpProfile("tiny")).toThrow('Invalid MCP profile "tiny"');
  });

  it("rejects input that does not satisfy a tool schema", async () => {
    const result = await call("projects_create", {});
    expect(result.isError).toBe(true);
  });

  it("exposes unified search through MCP", async () => {
    await call("projects_create", {
      name: "Search MCP",
      context: "projectmcpneedle",
    });
    await call("tasks_create", {
      project: "PRJ-0001",
      tasks: [
        {
          title: "Searchable MCP task",
          context: "taskmcpcontextneedle",
        },
      ],
    });

    const result = await call("search", {
      query: "taskmcpcontextneedle",
      project: "PRJ-0001",
      task: "TASK-0001",
      type: ["task_context"],
      limit: 5,
    });
    expect(result.isError).toBe(false);
    expect(result.text).toContain("task_context — TASK-0001:context");
    expect(result.text).toContain("[taskmcpcontextneedle]");

    expect(
      (
        await call("search", {
          query: "needle",
          type: ["not_a_source_type"],
        })
      ).isError,
    ).toBe(true);
  });

  it("exposes optimistic context history and append-only revert tools", async () => {
    await call("projects_create", {
      name: "Context MCP",
      context: "project version one",
      actor: "codex",
    });
    await call("tasks_create", {
      project: "PRJ-0001",
      tasks: [{ title: "Task", context: "task version one" }],
    });

    const updated = await call("projects_update_context", {
      project: "PRJ-0001",
      context: "project version two",
      expected_version: 1,
      reason: "MCP edit",
      actor: "codex",
    });
    expect(updated.isError).toBe(false);
    expect(updated.text).toContain("v2");

    const history = await call("projects_context_history", {
      project: "PRJ-0001",
      limit: 1,
    });
    expect(history.text).toContain("v2 (current)");
    expect(history.text).toContain("MCP edit");
    expect(history.text).not.toContain("project version two");

    const version = await call("projects_context_version_get", {
      project: "PRJ-0001",
      version: 1,
    });
    expect(version.text).toContain("project version one");

    const stale = await call("projects_update_context", {
      project: "PRJ-0001",
      context: "stale",
      expected_version: 1,
    });
    expect(stale.isError).toBe(true);
    expect(stale.text).toContain("CONTEXT_VERSION_CONFLICT");

    const reverted = await call("projects_context_revert", {
      project: "PRJ-0001",
      target_version: 1,
      expected_version: 2,
      actor: "codex",
    });
    expect(reverted.text).toContain("v3");

    await call("tasks_update_context", {
      task: "TASK-0001",
      context: "task version two",
      expected_version: 1,
    });
    expect(
      (await call("tasks_context_history", { task: "TASK-0001" })).text,
    ).toContain("v2 (current)");
    expect(
      (
        await call("tasks_context_version_get", {
          task: "TASK-0001",
          version: 1,
        })
      ).text,
    ).toContain("task version one");
    expect(
      (
        await call("tasks_context_revert", {
          task: "TASK-0001",
          target_version: 1,
          expected_version: 2,
        })
      ).text,
    ).toContain("v3");
  });

  it("exposes composite start, report and handoff workflows through MCP", async () => {
    await call("projects_create", {
      name: "Composite MCP",
      context: "MCP project context",
    });
    await call("tasks_create", {
      project: "PRJ-0001",
      tasks: [{ title: "Composite lifecycle", context: "MCP task context", status: "ready" }],
    });

    expect(
      (await call("start_work", { task: "TASK-0001", actor: "codex" })).isError,
    ).toBe(true);

    const started = await call("start_work", {
      task: "TASK-0001",
      actor: "codex",
      session_id: "run-1",
    });
    expect(started.isError).toBe(false);
    expect(started.text).toContain("MCP project context");
    expect(started.text).toContain("MCP task context");
    expect(started.text).toContain("Resume state: new execution");

    const reported = await call("report", {
      task: "TASK-0001",
      actor: "codex",
      session_id: "run-1",
      phase: "MCP verification",
      progress: "MCP workflow exposed.",
      checkpoint: {
        completed: "Start",
        working_on: "Report",
        next: "Handoff",
      },
    });
    expect(reported.isError).toBe(false);
    expect(reported.text).toContain("MCP verification");
    expect(reported.text).toContain("MCP workflow exposed.");

    const handedOff = await call("handoff", {
      task: "TASK-0001",
      actor: "codex",
      session_id: "run-1",
      checkpoint: {
        completed: "Composite lifecycle",
        working_on: "Nothing",
        next: "Next agent continues",
      },
    });
    expect(handedOff.isError).toBe(false);
    expect(handedOff.text).toContain("Next agent continues");
    expect(handedOff.text).toContain("Claim released safely");

    const invalid = await call("handoff", {
      task: "TASK-0001",
      actor: "codex",
      session_id: "run-1",
    });
    expect(invalid.isError).toBe(true);
  });

  it("exposes the execution continuity lifecycle through MCP", async () => {
    await call("projects_create", { name: "Continuity tools" });
    await call("tasks_create", {
      project: "PRJ-0001",
      tasks: [{ title: "Verify execution", status: "ready", acceptance_criteria: ["Proven"] }],
    });
    await call("tasks_claim", {
      task: "TASK-0001",
      actor: "codex",
      session_id: "continuity-run",
    });

    expect(
      (
        await call("tasks_heartbeat", {
          task: "TASK-0001",
          actor: "codex",
          session_id: "continuity-run",
          phase: "Verification",
        })
      ).text,
    ).toBe("Heartbeat recorded.");
    await call("tasks_checkpoint", {
      task: "TASK-0001",
      completed: "Claim",
      working_on: "Verification",
      next: "Complete",
      actor: "codex",
      session_id: "continuity-run",
    });
    await call("tasks_work_plan", {
      task: "TASK-0001",
      items: ["Implement", "Verify"],
      actor: "codex",
    });
    await call("tasks_add_criterion_evidence", {
      task: "TASK-0001",
      criterion: "Proven",
      kind: "test",
      name: "MCP suite",
      outcome: "passed",
      reference: "mcp.test.ts",
      actor: "codex",
    });
    expect(
      (
        await call("tasks_criterion_evidence_policy", {
          task: "TASK-0001",
          criterion: "Proven",
          minimum_count: 1,
          qualifying_kinds: ["test"],
          actor: "codex",
        })
      ).text,
    ).toContain('"minimumCount": 1');
    await call("tasks_add_execution_origin", {
      task: "TASK-0001",
      provider: "codex",
      reference: "continuity-thread",
    });

    const state = await call("tasks_execution_get", { task: "TASK-0001" });
    expect(state.text).toContain("codex — active");
    expect(state.text).toContain("Verification");
    expect(state.text).toContain("Implement");
    expect((await call("attention_list")).text).toContain("No work needs attention");
  });

  it("exposes explicit repository and worktree operations through MCP", async () => {
    const root = mkdtempSync(join(tmpdir(), "agent-continuity-mcp-repository-"));
    temporaryDirectories.push(root);
    const worktree = join(root, "worktree");
    mkdirSync(worktree);

    await call("projects_create", { name: "Repository tools" });
    const associated = await call("repositories_add", {
      project: "PRJ-0001",
      label: "Main",
      root_path: root,
      remote_url: "https://example.test/team/main.git/",
      actor: "codex",
    });
    expect(associated.isError).toBe(false);
    expect(associated.text).toContain("REP-0001 — Main (primary)");
    expect((await call("repositories_list", { project: "PRJ-0001" })).text).toContain(
      realpathSync.native(root),
    );

    await call("repositories_update", {
      project: "PRJ-0001",
      repository: "REP-0001",
      label: "Main repository",
      actor: "codex",
    });
    expect(
      (await call("repositories_get", { project: "PRJ-0001", repository: "REP-0001" })).text,
    ).toContain("Main repository");

    await call("tasks_create", {
      project: "PRJ-0001",
      tasks: [{ title: "Bound MCP execution", status: "ready" }],
    });
    const started = await call("start_work", {
      task: "TASK-0001",
      actor: "codex",
      session_id: "repository-mcp-run",
      worktree: {
        repository: "REP-0001",
        worktree_path: worktree,
        branch: "feature/mcp",
      },
    });
    expect(started.isError).toBe(false);
    const summary = await call("tasks_execution_get", { task: "TASK-0001" });
    expect(summary.text).toContain("Worktree: REP-0001 (feature/mcp)");
    expect(summary.text).toContain("Git baseline: error");
    expect(summary.text).not.toContain(realpathSync.native(root));
    const ownership = await call("tasks_path_ownership_set", {
      task: "TASK-0001",
      paths: [
        { path: "src/index.ts", kind: "file" },
        { path: "docs", kind: "directory" },
      ],
      actor: "codex",
      session_id: "repository-mcp-run",
    });
    expect(ownership.isError).toBe(false);
    expect(ownership.text).toContain("file: src/index.ts");
    expect(
      (await call("tasks_path_ownership_get", { task: "TASK-0001" })).text,
    ).toContain("Path ownership revision: 1");
    const provenance = await call("tasks_git_provenance_get", { task: "TASK-0001" });
    expect(provenance.text).toContain("Source: local_git; repository: REP-0001");
    const capture = await call("tasks_git_provenance_capture", { task: "TASK-0001" });
    expect(capture.isError).toBe(false);
    expect(capture.text).toContain("Latest: manual — error");

    const explicit = await call("tasks_worktree_get", { task: "TASK-0001" });
    expect(explicit.text).toContain(realpathSync.native(worktree));
    expect(
      (
        await call("repositories_remove", {
          project: "PRJ-0001",
          repository: "REP-0001",
          force: true,
        })
      ).text,
    ).toContain("REPOSITORY_IN_USE");

    const unbound = await call("tasks_worktree_unbind", {
      task: "TASK-0001",
      actor: "codex",
      session_id: "repository-mcp-run",
    });
    expect(unbound.isError).toBe(false);
    expect(
      (
        await call("repositories_remove", {
          project: "PRJ-0001",
          repository: "REP-0001",
        })
      ).isError,
    ).toBe(false);
  });

  it("preserves the domain error code", async () => {
    const missing = await call("tasks_get", { task: "TASK-9999" });
    expect(missing.isError).toBe(true);
    expect(missing.text).toContain("TASK_NOT_FOUND");

    await call("projects_create", { name: "Agent Continuity" });
    await call("tasks_create", { project: "PRJ-0001", tasks: [{ title: "A" }] });
    await call("tasks_claim", { task: "TASK-0001", actor: "codex" });

    const conflict = await call("tasks_claim", { task: "TASK-0001", actor: "claude-code" });
    expect(conflict.isError).toBe(true);
    expect(conflict.text).toContain("TASK_ALREADY_CLAIMED");
  });

  it("explains dependency cycles in the error text", async () => {
    await call("projects_create", { name: "Agent Continuity" });
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
      name: "Agent Continuity",
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
      name: "Agent Continuity",
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

    expect((await call("projects_list", {})).text).toContain("PRJ-0001 — Agent Continuity");
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
      expected_version: 0,
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
    await call("projects_create", { name: "Agent Continuity" });
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
        { type: "issue", provider: "jira", reference: "AC-42" },
        { type: "branch", provider: "git", reference: "feature/TASK-0001" },
      ],
    });
    expect(links.text).toContain("Added 2 link(s)");
    expect((await call("links_list", { project: "PRJ-0001", type: "issue" })).text).toContain("AC-42");

    await call("links_remove", { link: "LNK-0001" });
    expect((await call("links_list", { project: "PRJ-0001" })).text).not.toContain("AC-42");

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

  it("permanently deletes a project through projects_delete", async () => {
    await call("projects_create", { name: "Verify mobile" });
    await call("tasks_create", {
      project: "PRJ-0001",
      tasks: [{ title: "Scratch", acceptance_criteria: ["One"] }],
    });

    const deleted = await call("projects_delete", { project: "PRJ-0001", actor: "adam" });
    expect(deleted.text).toContain("Deleted PRJ-0001 — Verify mobile.");
    expect(deleted.text).toContain("Removed 1 tasks, 1 acceptance criteria");

    const missing = await call("projects_get", { project: "PRJ-0001" });
    expect(missing.isError).toBe(true);
    expect(missing.text).toContain("PROJECT_NOT_FOUND");
  });

  it("refuses to delete a project with a claimed task, unless forced", async () => {
    await call("projects_create", { name: "Agent Continuity" });
    await call("tasks_create", { project: "PRJ-0001", tasks: [{ title: "Claimed" }] });
    await call("tasks_claim", { task: "TASK-0001", actor: "codex" });

    const refused = await call("projects_delete", { project: "PRJ-0001", actor: "adam" });
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain("PROJECT_HAS_CLAIMED_TASKS");

    const forced = await call("projects_delete", {
      project: "PRJ-0001",
      actor: "adam",
      force: true,
    });
    expect(forced.isError).toBeFalsy();
    expect(forced.text).toContain("Deleted PRJ-0001");
  });
});
