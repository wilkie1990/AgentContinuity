import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { isLoopbackHost, isUnspecifiedHost, resolveHostList } from "./network.js";

export {
  detectTailscaleAddress,
  isLoopbackHost,
  isTailscaleAddress,
  isUnspecifiedHost,
  listExternalIPv4Addresses,
  listReachableAddresses,
  listReachableAddressesFor,
  resolveHostAlias,
  resolveHostList,
  type NetworkInterfaces,
} from "./network.js";

export const DEFAULT_HOST = "127.0.0.1";
export const DEFAULT_PORT = 4732;
export const DEFAULT_CLAIM_TTL_MINUTES = 30;

export type WorkspaceConfig = {
  dataDir: string;
  databasePath: string;
  server: {
    /** The primary bound address, kept for callers that want a single value to display. */
    host: string;
    /** Every address to bind. More than one lets loopback and a tailnet peer both reach it. */
    hosts: string[];
    port: number;
  };
  claims: { defaultTtlMinutes: number };
  logLevel: string;
  /** Base URL the CLI and web client use to reach the local API. */
  baseUrl: string;
};

type ConfigFile = {
  dataDir?: string;
  databasePath?: string;
  server?: { host?: string; port?: number };
  claims?: { defaultTtlMinutes?: number };
  logLevel?: string;
};

export function defaultDataDir(): string {
  return join(homedir(), ".agent-workspace");
}

function readConfigFile(dataDir: string): ConfigFile {
  const path = join(dataDir, "config.json");
  if (!existsSync(path)) return {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as ConfigFile;
    return {};
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read Agent Workspace config at ${path}: ${reason}`);
  }
}

function intFromEnv(value: string | undefined, fallback: number, label: string): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer, received "${value}".`);
  }
  return parsed;
}

export type ConfigOverrides = Partial<Omit<WorkspaceConfig, "server" | "claims">> & {
  server?: Partial<WorkspaceConfig["server"]>;
  claims?: Partial<WorkspaceConfig["claims"]>;
};

/**
 * Resolution order, lowest precedence first: built-in defaults, ~/.agent-workspace/config.json,
 * environment variables, then explicit overrides passed by the caller.
 *
 * `server.host` additionally accepts the alias "tailscale", which is resolved here to the
 * machine's actual Tailscale interface address (detected from OS network interfaces, in the
 * 100.64.0.0/10 range) so every consumer of the resolved config — the server binding, the
 * startup banner, and this process's own API client — agrees on one concrete address.
 */
export function resolveConfig(overrides: ConfigOverrides = {}, env: NodeJS.ProcessEnv = process.env): WorkspaceConfig {
  const dataDir = resolve(
    overrides.dataDir ??
      env.AGENT_WORKSPACE_DATA_DIR ??
      readConfigFile(defaultDataDir()).dataDir ??
      defaultDataDir(),
  );

  const file = readConfigFile(dataDir);

  const rawHost = overrides.server?.host ?? env.AGENT_WORKSPACE_HOST ?? file.server?.host ?? DEFAULT_HOST;
  const hosts = resolveHostList(rawHost);
  // Prefer loopback as the "primary" address so a CLI run on this machine keeps working
  // even when the server is also listening on a tailnet address.
  const host = hosts.find(isLoopbackHost) ?? hosts[0] ?? DEFAULT_HOST;
  const port =
    overrides.server?.port ??
    intFromEnv(env.AGENT_WORKSPACE_PORT, file.server?.port ?? DEFAULT_PORT, "AGENT_WORKSPACE_PORT");

  const rawDatabasePath =
    overrides.databasePath ??
    env.AGENT_WORKSPACE_DATABASE_PATH ??
    file.databasePath ??
    join(dataDir, "workspace.db");

  const databasePath =
    rawDatabasePath === ":memory:" || isAbsolute(rawDatabasePath)
      ? rawDatabasePath
      : resolve(dataDir, rawDatabasePath);

  const defaultTtlMinutes =
    overrides.claims?.defaultTtlMinutes ??
    intFromEnv(
      env.AGENT_WORKSPACE_CLAIM_TTL_MINUTES,
      file.claims?.defaultTtlMinutes ?? DEFAULT_CLAIM_TTL_MINUTES,
      "AGENT_WORKSPACE_CLAIM_TTL_MINUTES",
    );

  return {
    dataDir,
    databasePath,
    server: { host, hosts, port },
    claims: { defaultTtlMinutes },
    logLevel: overrides.logLevel ?? env.AGENT_WORKSPACE_LOG_LEVEL ?? file.logLevel ?? "info",
    baseUrl:
      overrides.baseUrl ??
      env.AGENT_WORKSPACE_URL ??
      `http://${isUnspecifiedHost(host) ? DEFAULT_HOST : host}:${port}`,
  };
}
