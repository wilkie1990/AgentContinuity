import {
  addAcceptanceCriteriaSchema,
  addBlockerSchema,
  addDependencySchema,
  addProgressSchema,
  bindExecutionWorktreeSchema,
  captureGitProvenanceSchema,
  checkpointSchema,
  claimTaskSchema,
  completeTaskSchema,
  deleteTaskSchema,
  releaseClaimSchema,
  renewClaimSchema,
  heartbeatSchema,
  handoffWorkSchema,
  listContextVersionsQuerySchema,
  reportWorkSchema,
  revertContextSchema,
  replaceExecutionPathOwnershipSchema,
  startWorkSchema,
  workPlanSchema,
  updateWorkPlanItemSchema,
  criterionEvidenceSchema,
  criterionEvidencePolicySchema,
  clearCriterionEvidencePolicySchema,
  executionOriginSchema,
  updateTaskContextSchema,
  updateTaskSchema,
  unbindExecutionWorktreeSchema,
  contextVersionParamSchema,
  sessionIdSchema,
} from "@agent-continuity/contracts";
import type { Workspace } from "@agent-continuity/core";
import type { FastifyPluginCallback } from "fastify";
import { parse } from "../validation.js";

type Params = { task: string };
type ContextVersionParams = Params & { version: string };
type SessionParams = { session: string };

export function taskRoutes(workspace: Workspace): FastifyPluginCallback {
  return (app, _options, done) => {
    app.get<{ Params: SessionParams }>("/sessions/:session/handoff-status", (request) => {
      const sessionId = parse(sessionIdSchema, request.params.session, "params");
      return workspace.executions.handoffStatusForSession(sessionId);
    });

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

    app.get<{ Params: Params }>("/tasks/:task/context/versions", (request) => {
      const query = parse(listContextVersionsQuerySchema, request.query, "query");
      return workspace.contexts.listTask(request.params.task, query);
    });

    app.get<{ Params: ContextVersionParams }>(
      "/tasks/:task/context/versions/:version",
      (request) => {
        const version = parse(contextVersionParamSchema, request.params.version, "params");
        return { version: workspace.contexts.getTask(request.params.task, version) };
      },
    );

    app.post<{ Params: Params }>("/tasks/:task/context/revert", (request) => {
      const input = parse(revertContextSchema, request.body);
      const row = workspace.contexts.revertTask(request.params.task, input);
      return { task: workspace.tasks.getSummary(row.id) };
    });

    app.delete<{ Params: Params }>("/tasks/:task", (request) => {
      const input = parse(deleteTaskSchema, request.body);
      return { deleted: workspace.tasks.delete(request.params.task, input) };
    });

    app.post<{ Params: Params }>("/tasks/:task/complete", async (request) => {
      const input = parse(completeTaskSchema, request.body);
      return { task: await workspace.workflows.complete(request.params.task, input) };
    });

    app.post<{ Params: Params }>("/tasks/:task/claim", (request, reply) => {
      const input = parse(claimTaskSchema, request.body);
      const { claim } = workspace.claims.claim(request.params.task, input);
      return reply
        .status(201)
        .send({ claim, task: workspace.tasks.getSummary(request.params.task) });
    });

    app.post<{ Params: Params }>("/tasks/:task/start-work", (request) => {
      const input = parse(startWorkSchema, request.body);
      return workspace.workflows.startWork(request.params.task, input);
    });

    app.post<{ Params: Params }>("/tasks/:task/report", (request) => {
      const input = parse(reportWorkSchema, request.body);
      return workspace.workflows.report(request.params.task, input);
    });

    app.post<{ Params: Params }>("/tasks/:task/handoff", (request) => {
      const input = parse(handoffWorkSchema, request.body);
      return workspace.workflows.handoff(request.params.task, input);
    });

    app.post<{ Params: Params }>("/tasks/:task/claim/renew", (request) => {
      const input = parse(renewClaimSchema, request.body);
      return { claim: workspace.claims.renew(request.params.task, input) };
    });

    app.post<{ Params: Params }>("/tasks/:task/heartbeat", (request) => {
      const input = parse(heartbeatSchema, request.body);
      return { claim: workspace.claims.heartbeat(request.params.task, input), execution: workspace.executions.activeFor(workspace.tasks.getSummary(request.params.task).id) };
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

    app.get<{ Params: Params }>("/tasks/:task/execution", (request) => workspace.executions.forTask(request.params.task));
    app.get<{ Params: Params }>("/tasks/:task/execution/path-ownership", (request) => ({
      ownership: workspace.ownership.forTask(request.params.task),
      collisions: workspace.ownership.collisionsForTask(request.params.task),
    }));
    app.put<{ Params: Params }>("/tasks/:task/execution/path-ownership", (request) => {
      const input = parse(replaceExecutionPathOwnershipSchema, request.body);
      return workspace.ownership.replace(request.params.task, input);
    });
    app.get<{ Params: Params }>("/tasks/:task/execution/worktree", (request) => ({
      worktree: workspace.repositories.worktree(request.params.task),
    }));
    app.put<{ Params: Params }>("/tasks/:task/execution/worktree", async (request) => {
      const input = parse(bindExecutionWorktreeSchema, request.body);
      const worktree = workspace.repositories.bindWorktree(request.params.task, input);
      await workspace.git.captureBaseline(request.params.task, worktree.executionId);
      return { worktree, collisions: workspace.ownership.collisionsForTask(request.params.task) };
    });
    app.delete<{ Params: Params }>("/tasks/:task/execution/worktree", (request) => {
      const input = parse(unbindExecutionWorktreeSchema, request.body);
      return { worktree: workspace.repositories.unbindWorktree(request.params.task, input) };
    });
    app.post<{ Params: Params }>("/tasks/:task/checkpoints", async (request, reply) => {
      const input = parse(checkpointSchema, request.body);
      const checkpoint = workspace.executions.checkpoint(request.params.task, input);
      const provenance = checkpoint.executionId
        ? await workspace.git.captureSnapshot(request.params.task, {
            trigger: "checkpoint",
            checkpointId: checkpoint.id,
            executionId: checkpoint.executionId,
          })
        : null;
      return reply.status(201).send({
        checkpoint,
        provenance,
        collisions: workspace.ownership.collisionsForTask(request.params.task),
      });
    });
    app.get<{ Params: Params }>("/tasks/:task/checkpoints", (request) => ({ checkpoints: workspace.executions.checkpoints(request.params.task) }));
    app.put<{ Params: Params }>("/tasks/:task/work-plan", (request) => {
      const input = parse(workPlanSchema, request.body);
      return { workPlan: workspace.executions.setWorkPlan(request.params.task, input) };
    });
    app.get<{ Params: Params }>("/tasks/:task/work-plan", (request) => ({ workPlan: workspace.executions.workPlan(request.params.task) }));
    app.patch<{ Params: Params & { item: string } }>("/tasks/:task/work-plan/:item", (request) => {
      const input = parse(updateWorkPlanItemSchema, request.body);
      return { item: workspace.executions.updateWorkPlanItem(request.params.task, request.params.item, input) };
    });
    app.post<{ Params: Params & { criterion: string } }>("/tasks/:task/acceptance-criteria/:criterion/evidence", (request, reply) => {
      const input = parse(criterionEvidenceSchema, request.body);
      return reply.status(201).send({ evidence: workspace.evidence.add(request.params.task, request.params.criterion, input) });
    });
    app.get<{ Params: Params & { criterion: string } }>("/tasks/:task/acceptance-criteria/:criterion/evidence", (request) => ({ evidence: workspace.evidence.list(request.params.task, request.params.criterion) }));
    app.get<{ Params: Params & { criterion: string } }>("/tasks/:task/acceptance-criteria/:criterion/evidence-policy", (request) => ({
      policy: workspace.evidence.getPolicy(request.params.task, request.params.criterion),
    }));
    app.put<{ Params: Params & { criterion: string } }>("/tasks/:task/acceptance-criteria/:criterion/evidence-policy", (request) => {
      const input = parse(criterionEvidencePolicySchema, request.body);
      return { policy: workspace.evidence.setPolicy(request.params.task, request.params.criterion, input) };
    });
    app.delete<{ Params: Params & { criterion: string } }>("/tasks/:task/acceptance-criteria/:criterion/evidence-policy", (request) => {
      const input = parse(clearCriterionEvidencePolicySchema, request.body ?? {});
      return { policy: workspace.evidence.clearPolicy(request.params.task, request.params.criterion, input) };
    });
    app.post<{ Params: Params }>("/tasks/:task/execution/origins", (request, reply) => {
      const input = parse(executionOriginSchema, request.body);
      return reply.status(201).send({ origin: workspace.executions.addOrigin(request.params.task, input) });
    });
    app.get<{ Params: Params }>("/tasks/:task/execution/git-provenance", (request) => ({
      provenance: workspace.provenance.forTask(request.params.task),
    }));
    app.post<{ Params: Params }>(
      "/tasks/:task/execution/git-provenance/capture",
      async (request, reply) => {
        parse(captureGitProvenanceSchema, request.body ?? {});
        const provenance = await workspace.git.captureSnapshot(request.params.task, {
          trigger: "manual",
        });
        return reply.status(201).send({
          provenance,
          collisions: workspace.ownership.collisionsForTask(request.params.task),
        });
      },
    );

    app.get("/attention", () => ({ items: workspace.executions.needsAttention() }));

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
