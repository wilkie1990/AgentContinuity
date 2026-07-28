import {
  addLinksSchema,
  archiveProjectSchema,
  bootstrapProjectSchema,
  createDecisionSchema,
  createProjectSchema,
  createRepositorySchema,
  createTaskSchema,
  deleteProjectSchema,
  listActivityQuerySchema,
  listContextVersionsQuerySchema,
  listDecisionsQuerySchema,
  listLinksQuerySchema,
  listProjectsQuerySchema,
  listTasksQuerySchema,
  removeRepositorySchema,
  revertContextSchema,
  contextVersionParamSchema,
  updateProjectContextSchema,
  updateProjectSchema,
  updateRepositorySchema,
} from "@agent-continuity/contracts";
import type { Workspace } from "@agent-continuity/core";
import type { FastifyPluginCallback } from "fastify";
import { parse } from "../validation.js";

type Params = { project: string };
type RepositoryParams = Params & { repository: string };
type ContextVersionParams = Params & { version: string };

export function projectRoutes(workspace: Workspace): FastifyPluginCallback {
  return (app, _options, done) => {
    app.post("/projects", (request, reply) => {
      const input = parse(createProjectSchema, request.body);
      return reply.status(201).send({ project: workspace.projects.create(input) });
    });

    app.post("/projects/bootstrap", (request, reply) => {
      const input = parse(bootstrapProjectSchema, request.body);
      return reply.status(201).send(workspace.projects.bootstrap(input));
    });

    app.get("/projects", (request) => {
      const query = parse(listProjectsQuerySchema, request.query, "query");
      return workspace.projects.list(query);
    });

    app.get<{ Params: Params }>("/projects/:project", (request) => {
      return { project: workspace.projects.get(request.params.project) };
    });

    app.patch<{ Params: Params }>("/projects/:project", (request) => {
      const input = parse(updateProjectSchema, request.body);
      return { project: workspace.projects.update(request.params.project, input) };
    });

    app.put<{ Params: Params }>("/projects/:project/context", (request) => {
      const input = parse(updateProjectContextSchema, request.body);
      return { project: workspace.projects.updateContext(request.params.project, input) };
    });

    app.get<{ Params: Params }>("/projects/:project/context/versions", (request) => {
      const query = parse(listContextVersionsQuerySchema, request.query, "query");
      return workspace.contexts.listProject(request.params.project, query);
    });

    app.get<{ Params: ContextVersionParams }>(
      "/projects/:project/context/versions/:version",
      (request) => {
        const version = parse(contextVersionParamSchema, request.params.version, "params");
        return {
          version: workspace.contexts.getProject(request.params.project, version),
        };
      },
    );

    app.post<{ Params: Params }>("/projects/:project/context/revert", (request) => {
      const input = parse(revertContextSchema, request.body);
      const row = workspace.contexts.revertProject(request.params.project, input);
      return { project: workspace.projects.summarise(row) };
    });

    app.post<{ Params: Params }>("/projects/:project/archive", (request) => {
      const input = parse(archiveProjectSchema, request.body);
      return { project: workspace.projects.archive(request.params.project, input) };
    });

    app.delete<{ Params: Params }>("/projects/:project", (request) => {
      const input = parse(deleteProjectSchema, request.body);
      return { deleted: workspace.projects.delete(request.params.project, input) };
    });

    app.post<{ Params: Params }>("/projects/:project/tasks", (request, reply) => {
      const input = parse(createTaskSchema, request.body);
      return reply.status(201).send({ task: workspace.tasks.create(request.params.project, input) });
    });

    app.get<{ Params: Params }>("/projects/:project/tasks", (request) => {
      const query = parse(listTasksQuerySchema, request.query, "query");
      return { tasks: workspace.tasks.list(request.params.project, query) };
    });

    app.post<{ Params: Params }>("/projects/:project/repositories", (request, reply) => {
      const input = parse(createRepositorySchema, request.body);
      return reply
        .status(201)
        .send({ repository: workspace.repositories.create(request.params.project, input) });
    });

    app.get<{ Params: Params }>("/projects/:project/repositories", (request) => {
      return { repositories: workspace.repositories.list(request.params.project) };
    });

    app.get<{ Params: RepositoryParams }>(
      "/projects/:project/repositories/:repository",
      (request) => {
        return {
          repository: workspace.repositories.get(
            request.params.project,
            request.params.repository,
          ),
        };
      },
    );

    app.patch<{ Params: RepositoryParams }>(
      "/projects/:project/repositories/:repository",
      (request) => {
        const input = parse(updateRepositorySchema, request.body);
        return {
          repository: workspace.repositories.update(
            request.params.project,
            request.params.repository,
            input,
          ),
        };
      },
    );

    app.delete<{ Params: RepositoryParams }>(
      "/projects/:project/repositories/:repository",
      (request) => {
        const input = parse(removeRepositorySchema, request.body);
        return {
          removed: workspace.repositories.remove(
            request.params.project,
            request.params.repository,
            input,
          ),
        };
      },
    );

    app.post<{ Params: Params }>("/projects/:project/decisions", (request, reply) => {
      const input = parse(createDecisionSchema, request.body);
      return reply
        .status(201)
        .send({ decision: workspace.decisions.create(request.params.project, input) });
    });

    app.get<{ Params: Params }>("/projects/:project/decisions", (request) => {
      const query = parse(listDecisionsQuerySchema, request.query, "query");
      return { decisions: workspace.decisions.list(request.params.project, query) };
    });

    app.post<{ Params: Params }>("/projects/:project/links", (request, reply) => {
      const input = parse(addLinksSchema, request.body);
      return reply.status(201).send({ links: workspace.links.add(request.params.project, input) });
    });

    app.get<{ Params: Params }>("/projects/:project/links", (request) => {
      const query = parse(listLinksQuerySchema, request.query, "query");
      return { links: workspace.links.list(request.params.project, query) };
    });

    app.get<{ Params: Params }>("/projects/:project/activity", (request) => {
      const query = parse(listActivityQuerySchema, request.query, "query");
      return workspace.activity.listForProject(request.params.project, query);
    });

    done();
  };
}
