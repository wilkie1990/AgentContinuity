import { searchQuerySchema } from "@agent-continuity/contracts";
import type { Workspace } from "@agent-continuity/core";
import type { FastifyPluginCallback } from "fastify";
import { parse } from "../validation.js";

export function searchRoutes(workspace: Workspace): FastifyPluginCallback {
  return (app, _options, done) => {
    app.get("/search", (request) => {
      const query = parse(searchQuerySchema, request.query, "query");
      return workspace.search.search(query);
    });
    done();
  };
}
