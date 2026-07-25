import { resolveBlockerSchema, updateAcceptanceCriteriaSchema } from "@agent-workspace/contracts";
import type { Workspace } from "@agent-workspace/core";
import type { FastifyPluginCallback } from "fastify";
import { parse } from "../validation.js";

/** Endpoints addressed by an entity key rather than by its parent project or task. */
export function recordRoutes(workspace: Workspace): FastifyPluginCallback {
  return (app, _options, done) => {
    app.post<{ Params: { blocker: string } }>("/blockers/:blocker/resolve", (request) => {
      const input = parse(resolveBlockerSchema, request.body);
      const blocker = workspace.blockers.resolve(request.params.blocker, input);
      return { blocker, task: workspace.tasks.getSummary(blocker.taskKey) };
    });

    app.get<{ Params: { decision: string } }>("/decisions/:decision", (request) => {
      return { decision: workspace.decisions.get(request.params.decision) };
    });

    app.post<{ Params: { criterion: string } }>(
      "/acceptance-criteria/:criterion/complete",
      (request) => {
        const input = parse(updateAcceptanceCriteriaSchema, request.body);
        const task = workspace.tasks.taskForCriterion(request.params.criterion);
        const criterion = workspace.tasks.completeAcceptanceCriterion(
          task.id,
          request.params.criterion,
          { actor: input.actor, sessionId: input.sessionId },
        );
        return { acceptanceCriterion: criterion, task: workspace.tasks.getSummary(task.id) };
      },
    );

    app.post<{ Params: { criterion: string } }>(
      "/acceptance-criteria/:criterion/reopen",
      (request) => {
        const input = parse(updateAcceptanceCriteriaSchema, request.body);
        const task = workspace.tasks.taskForCriterion(request.params.criterion);
        const criterion = workspace.tasks.reopenAcceptanceCriterion(
          task.id,
          request.params.criterion,
          { actor: input.actor, sessionId: input.sessionId },
        );
        return { acceptanceCriterion: criterion, task: workspace.tasks.getSummary(task.id) };
      },
    );

    app.delete<{ Params: { criterion: string } }>(
      "/acceptance-criteria/:criterion",
      (request, reply) => {
        const task = workspace.tasks.taskForCriterion(request.params.criterion);
        workspace.tasks.deleteAcceptanceCriterion(task.id, request.params.criterion);
        return reply.status(204).send();
      },
    );

    app.delete<{ Params: { link: string } }>("/links/:link", (request, reply) => {
      workspace.links.remove(request.params.link);
      return reply.status(204).send();
    });

    done();
  };
}
