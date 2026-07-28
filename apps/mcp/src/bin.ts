#!/usr/bin/env node
import { resolveConfig } from "@agent-continuity/config";
import { createWorkspace } from "@agent-continuity/core";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { parseMcpProfile } from "./profile.js";
import { createMcpServer } from "./server.js";

function profileFromCommandLine(args: string[], env: NodeJS.ProcessEnv): ReturnType<typeof parseMcpProfile> {
  const profileFlag = args.indexOf("--profile");
  if (profileFlag === -1) return parseMcpProfile(env.AGENT_CONTINUITY_MCP_PROFILE);
  if (args.length !== 2 || profileFlag !== 0 || !args[1]) {
    throw new Error("Usage: agent-continuity-mcp [--profile full|agent]");
  }
  return parseMcpProfile(args[1]);
}

// stdout is the MCP transport, so diagnostics must go to stderr.
const config = resolveConfig();
const workspace = createWorkspace({ config });
const profile = profileFromCommandLine(process.argv.slice(2), process.env);
const server = createMcpServer(workspace, { profile });

process.stderr.write(`agent-continuity MCP server using ${config.databasePath} (${profile} profile)\n`);

await server.connect(new StdioServerTransport());

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void server.close().then(() => {
      workspace.close();
      process.exit(0);
    });
  });
}
