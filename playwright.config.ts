import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

const PORT = 4741;
const HOST = process.env.AGENT_CONTINUITY_E2E_HOST ?? "127.0.0.1";
const ORIGIN = `http://${HOST.includes(":") ? `[${HOST}]` : HOST}:${PORT}`;
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
    baseURL: ORIGIN,
    trace: "retain-on-failure",
  },
  webServer: {
    // Builds the UI, then serves it and the API from one local process.
    command: "pnpm --filter @agent-continuity/web build && npx tsx apps/server/src/bin.ts",
    url: `${ORIGIN}/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      AGENT_CONTINUITY_DATA_DIR: DATA_DIR,
      AGENT_CONTINUITY_HOST: HOST,
      AGENT_CONTINUITY_PORT: String(PORT),
      AGENT_CONTINUITY_LOG_LEVEL: "warn",
    },
  },
});
