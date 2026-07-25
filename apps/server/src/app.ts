import { AgentWorkspaceError, type HealthResponse } from "@agent-workspace/contracts";
import type { Workspace } from "@agent-workspace/core";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { registerErrorHandling } from "./errors.js";
import { projectRoutes } from "./routes/projects.js";
import { recordRoutes } from "./routes/records.js";
import { taskRoutes } from "./routes/tasks.js";

export const API_PREFIX = "/api/v1";
export const VERSION = "0.1.0";

export type BuildServerOptions = {
  workspace: Workspace;
  logLevel?: string;
  /** Directory holding the built web UI. Defaults to apps/web/dist when present. */
  webRoot?: string | null;
};

const here = dirname(fileURLToPath(import.meta.url));

function defaultWebRoot(): string | null {
  const candidates = [
    resolve(here, "..", "..", "web", "dist"),
    resolve(here, "..", "..", "..", "web", "dist"),
  ];
  return candidates.find((candidate) => existsSync(join(candidate, "index.html"))) ?? null;
}

export function buildServer(options: BuildServerOptions): FastifyInstance {
  const { workspace } = options;
  const logLevel = options.logLevel ?? workspace.config.logLevel;

  const logging = logLevel !== "silent";

  const app = Fastify({
    logger: logging ? { level: logLevel } : false,
    // Fastify's own request/response lines are replaced by the richer onResponse hook below.
    ...(logging ? { disableRequestLogging: true } : {}),
    genReqId: () => globalThis.crypto.randomUUID(),
  });

  registerErrorHandling(app);

  app.addHook("onResponse", (request, reply, done) => {
    request.log.info(
      {
        requestId: request.id,
        operation: `${request.method} ${request.routeOptions.url ?? request.url}`,
        statusCode: reply.statusCode,
        duration: Math.round(reply.elapsedTime),
      },
      "request completed",
    );
    done();
  });

  // The web UI is served from the same origin, but CORS keeps a separately hosted
  // Vite dev server usable during development.
  void app.register(cors, { origin: true });

  app.get("/health", (): HealthResponse => ({ status: "ok", version: VERSION }));
  app.get(`${API_PREFIX}/health`, (): HealthResponse => ({ status: "ok", version: VERSION }));

  void app.register(projectRoutes(workspace), { prefix: API_PREFIX });
  void app.register(taskRoutes(workspace), { prefix: API_PREFIX });
  void app.register(recordRoutes(workspace), { prefix: API_PREFIX });

  const webRoot = options.webRoot === undefined ? defaultWebRoot() : options.webRoot;
  if (webRoot) {
    // The wildcard route resolves files from disk per request. Enumerating the
    // directory once at registration would pin the server to whichever hashed
    // bundles existed at boot, so rebuilding the UI under a running server would
    // silently stop serving it.
    void app.register(fastifyStatic, { root: webRoot });
  }

  app.setNotFoundHandler((request, reply) => {
    const [path = ""] = request.url.split("?");
    const isApi = path.startsWith("/api") || path === "/health";
    // Anything with a file extension is an asset request. Answering those with
    // index.html would hand the browser HTML where it expects JavaScript, which
    // renders as a blank page with no obvious error.
    const isAsset = (path.split("/").pop() ?? "").includes(".");

    if (!isApi && !isAsset && webRoot && request.method === "GET") {
      // Single page app: unknown non-API GETs fall through to the client router.
      return reply.sendFile("index.html");
    }
    return reply.status(404).send(
      new AgentWorkspaceError(
        "VALIDATION_ERROR",
        `No route matches ${request.method} ${request.url}.`,
      ).toBody(),
    );
  });

  return app;
}
