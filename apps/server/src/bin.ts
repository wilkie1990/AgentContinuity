#!/usr/bin/env node
import { resolveConfig } from "@agent-workspace/config";
import { describeRunningServer, startServer } from "./start.js";

const config = resolveConfig();

const server = await startServer({ config });

process.stdout.write(
  `${describeRunningServer(server).join("\n")}\n` +
    `  database: ${config.databasePath}\n` +
    `  claim lease: ${config.claims.defaultTtlMinutes} minutes\n`,
);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void server.close().then(() => process.exit(0));
  });
}
