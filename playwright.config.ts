import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

const PORT = 4741;
const DATA_DIR = fileURLToPath(new URL("./.playwright/data", import.meta.url));

// Each run starts from an empty workspace database.
rmSync(DATA_DIR, { recursive: true, force: true });

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? "line" : "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
  },
  webServer: {
    // Builds the UI, then serves it and the API from one local process.
    command: "pnpm --filter @agent-workspace/web build && npx tsx apps/server/src/bin.ts",
    url: `http://127.0.0.1:${PORT}/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      AGENT_WORKSPACE_DATA_DIR: DATA_DIR,
      AGENT_WORKSPACE_PORT: String(PORT),
      AGENT_WORKSPACE_LOG_LEVEL: "warn",
    },
  },
});
