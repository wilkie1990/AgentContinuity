import type { WorkspaceConfig } from "@agent-continuity/config";
import { createWorkspace, type Workspace } from "./workspace.js";

export const TEST_CONFIG: WorkspaceConfig = {
  dataDir: "/tmp/agent-continuity-test",
  databasePath: ":memory:",
  server: { host: "127.0.0.1", hosts: ["127.0.0.1"], port: 4732 },
  claims: { defaultTtlMinutes: 30 },
  logLevel: "silent",
  baseUrl: "http://127.0.0.1:4732",
};

export type TestWorkspace = Workspace & {
  /** Moves the workspace clock forward so claim expiry can be tested without waiting. */
  advanceMinutes(minutes: number): void;
};

/**
 * An isolated in-memory workspace with a controllable clock, shared by the core,
 * API and MCP test suites.
 */
export function createTestWorkspace(
  overrides: Partial<WorkspaceConfig> = {},
): TestWorkspace {
  let now = new Date("2026-07-01T09:00:00.000Z");

  const workspace = createWorkspace({
    config: { ...TEST_CONFIG, ...overrides, databasePath: ":memory:" },
    clock: () => now,
  });

  return Object.assign(workspace, {
    advanceMinutes(minutes: number) {
      now = new Date(now.getTime() + minutes * 60_000);
    },
  });
}
