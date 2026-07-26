import {
  isLoopbackHost,
  listReachableAddressesFor,
  resolveConfig,
  resolveHostList,
  type WorkspaceConfig,
} from "@agent-continuity/config";
import { createWorkspace, type Workspace } from "@agent-continuity/core";
import type { FastifyInstance } from "fastify";
import { createServer, type Server } from "node:http";
import { buildServer } from "./app.js";

export type StartServerOptions = {
  config?: WorkspaceConfig;
  /** A single address or a comma-separated list; aliases "loopback" and "tailscale" are resolved. */
  host?: string;
  port?: number;
};

export type RunningServer = {
  app: FastifyInstance;
  workspace: Workspace;
  /** The primary bound address, for callers that want one value to display. */
  host: string;
  /** Every address actually bound. */
  hosts: string[];
  port: number;
  /** The first entry of `urls`, kept for callers that just want one address to display. */
  url: string;
  /** Every concrete URL a client could use to reach this server. Never contains 0.0.0.0. */
  urls: string[];
  /** True once a bound address reaches beyond this machine — v0.1 has no authentication. */
  isExposedBeyondLoopback: boolean;
  close(): Promise<void>;
};

function listen(server: Server, host: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

/**
 * Boots the HTTP API (and the web UI when it has been built) on the local machine.
 *
 * A socket binds exactly one address, so listening on both loopback and a tailnet
 * address means two listeners. They share a single Fastify instance — and therefore a
 * single workspace and one SQLite connection — via `app.routing`.
 */
export async function startServer(options: StartServerOptions = {}): Promise<RunningServer> {
  const config = options.config ?? resolveConfig();
  const workspace = createWorkspace({ config });
  const app = buildServer({ workspace });

  const hosts = options.host ? resolveHostList(options.host) : config.server.hosts;
  const requestedPort = options.port ?? config.server.port;

  await app.ready();

  const listeners: Server[] = [];
  let port = requestedPort;

  try {
    for (const host of hosts) {
      const server = createServer(app.routing);
      // Port 0 means "any free port"; every later listener must reuse whichever the
      // OS picked for the first, so all addresses answer on the same port.
      await listen(server, host, port);
      const bound = server.address();
      if (typeof bound === "object" && bound !== null) port = bound.port;
      listeners.push(server);
    }
  } catch (error) {
    await Promise.all(listeners.map(closeServer));
    await app.close();
    workspace.close();
    throw error;
  }

  const urls = listReachableAddressesFor(hosts).map(
    (address: string) => `http://${address}:${port}`,
  );
  const host = hosts.find(isLoopbackHost) ?? hosts[0] ?? "127.0.0.1";

  return {
    app,
    workspace,
    host,
    hosts,
    port,
    url: urls[0],
    urls,
    isExposedBeyondLoopback: hosts.some((candidate) => !isLoopbackHost(candidate)),
    async close() {
      await Promise.all(listeners.map(closeServer));
      await app.close();
      workspace.close();
    },
  };
}

const NO_AUTH_WARNING = [
  "WARNING: Agent Continuity has no authentication in v0.1. Anyone who can reach one of the",
  "URLs above has full read/write access to this workspace.",
];

/**
 * Renders the lines a caller should print after `startServer` resolves: every reachable URL,
 * and — only when the bind address reaches beyond loopback — the no-authentication warning.
 */
export function describeRunningServer(server: Pick<RunningServer, "urls" | "isExposedBeyondLoopback">): string[] {
  const lines = server.urls.map((url) => `Agent Continuity listening on ${url}`);
  if (server.isExposedBeyondLoopback) {
    lines.push("", ...NO_AUTH_WARNING);
  }
  return lines;
}
