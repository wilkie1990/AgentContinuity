import {
  addAcceptanceCriteriaSchema,
  addBlockerSchema,
  addDependencySchema,
  addProgressSchema,
  claimTaskSchema,
  completeTaskSchema,
  deleteTaskSchema,
  releaseClaimSchema,
  renewClaimSchema,
  updateTaskContextSchema,
  updateTaskSchema,
} from "@agent-workspace/contracts";
import type { Workspace } from "@agent-workspace/core";
import type { FastifyPluginCallback } from "fastify";
import { parse } from "../validation.js";

type Params = { task: string };

export function taskRoutes(workspace: Workspace): FastifyPluginCallback {
  return (app, _options, done) => {
    app.get<{ Params: Params }>("/tasks/:task", (request) => {
      return { task: workspace.tasks.get(request.params.task) };
    });

    app.patch<{ Params: Params }>("/tasks/:task", (request) => {
      const input = parse(updateTaskSchema, request.body);
      return { task: workspace.tasks.update(request.params.task, input) };
    });

    app.put<{ Params: Params }>("/tasks/:task/context", (request) => {
      const input = parse(updateTaskContextSchema, request.body);
      return { task: workspace.tasks.updateContext(request.params.task, input) };
    });

    app.delete<{ Params: Params }>("/tasks/:task", (request) => {
      const input = parse(deleteTaskSchema, request.body);
      return { deleted: workspace.tasks.delete(request.params.task, input) };
    });

    app.post<{ Params: Params }>("/tasks/:task/complete", (request) => {
      const input = parse(completeTaskSchema, request.body);
      return { task: workspace.tasks.complete(request.params.task, input) };
    });

    app.post<{ Params: Params }>("/tasks/:task/claim", (request, reply) => {
      const input = parse(claimTaskSchema, request.body);
      const { claim } = workspace.claims.claim(request.params.task, input);
      return reply
        .status(201)
        .send({ claim, task: workspace.tasks.getSummary(request.params.task) });
    });

    app.post<{ Params: Params }>("/tasks/:task/claim/renew", (request) => {
      const input = parse(renewClaimSchema, request.body);
      return { claim: workspace.claims.renew(request.params.task, input) };
    });

    app.post<{ Params: Params }>("/tasks/:task/claim/release", (request) => {
      const input = parse(releaseClaimSchema, request.body);
      const claim = workspace.claims.release(request.params.task, input);
      return { claim, task: workspace.tasks.getSummary(request.params.task) };
    });

    app.post<{ Params: Params }>("/tasks/:task/progress", (request, reply) => {
      const input = parse(addProgressSchema, request.body);
      return reply
        .status(201)
        .send({ progress: workspace.tasks.addProgress(request.params.task, input) });
    });

    app.get<{ Params: Params }>("/tasks/:task/progress", (request) => {
      return { progress: workspace.tasks.listProgress(request.params.task) };
    });

    app.post<{ Params: Params }>("/tasks/:task/blockers", (request, reply) => {
      const input = parse(addBlockerSchema, request.body);
      const blocker = workspace.blockers.add(request.params.task, input);
      return reply
        .status(201)
        .send({ blocker, task: workspace.tasks.getSummary(request.params.task) });
    });

    app.post<{ Params: Params }>("/tasks/:task/acceptance-criteria", (request, reply) => {
      const input = parse(addAcceptanceCriteriaSchema, request.body);
      const criteria = workspace.tasks.addAcceptanceCriteria(request.params.task, input.criteria, {
        actor: input.actor,
        sessionId: input.sessionId,
      });
      return reply.status(201).send({ acceptanceCriteria: criteria });
    });

    app.post<{ Params: Params }>("/tasks/:task/dependencies", (request, reply) => {
      const input = parse(addDependencySchema, request.body);
      const task = workspace.tasks.addDependency(request.params.task, input.dependsOn, {
        actor: input.actor,
        sessionId: input.sessionId,
      });
      return reply.status(201).send({ task });
    });

    app.delete<{ Params: Params & { dependency: string } }>(
      "/tasks/:task/dependencies/:dependency",
      (request) => {
        return {
          task: workspace.tasks.removeDependency(request.params.task, request.params.dependency),
        };
      },
    );

    done();
  };
}
