import type { Workspace } from "@agent-continuity/core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpProfile } from "./profile.js";
import { registerTools } from "./tools.js";

export const MCP_SERVER_NAME = "agent-continuity";
export const MCP_SERVER_VERSION = "0.1.0";

const INSTRUCTIONS = `Agent Continuity stores persistent project state so work survives the end of a conversation.

Before creating a project, call projects_list and prefer continuing an existing project that represents the same work.
Before meaningful work, call projects_get to read project context, then tasks_list to find actionable work and tasks_get for the full task state.
Claim a task with tasks_claim before beginning meaningful work, but not merely to inspect it.
Record milestones with tasks_add_progress, lasting choices with decisions_create, and anything that stops the work with tasks_add_blocker.
Keep durable knowledge in project and task context, not in progress entries.
Before ending a session on an incomplete task, record progress, update context, then release the claim.`;

/** Builds the MCP server around an existing workspace; tools call core services directly. */
export function createMcpServer(workspace: Workspace, options: { profile?: McpProfile } = {}): McpServer {
  const server = new McpServer(
    { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
    { instructions: INSTRUCTIONS },
  );

  registerTools(server, workspace, options.profile ?? "full");
  return server;
}
