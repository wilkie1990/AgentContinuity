#!/usr/bin/env node
import { resolveConfig } from "@agent-continuity/config";
import { createWorkspace } from "@agent-continuity/core";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./server.js";

// stdout is the MCP transport, so diagnostics must go to stderr.
const config = resolveConfig();
const workspace = createWorkspace({ config });
const server = createMcpServer(workspace);

process.stderr.write(`agent-continuity MCP server using ${config.databasePath}\n`);

await server.connect(new StdioServerTransport());

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void server.close().then(() => {
      workspace.close();
      process.exit(0);
    });
  });
}
