import {
  AgentWorkspaceError,
  type CreateDecisionInput,
  type Decision,
  type ListDecisionsQuery,
} from "@agent-workspace/contracts";
import { decisions, type TaskRow } from "@agent-workspace/database";
import { eq } from "drizzle-orm";
import type { ActivityService } from "../activity/service.js";
import type { ClaimService } from "../claims/service.js";
import { nextKey } from "../ids.js";
import { requireDecision, requireProject, requireTask, requireWritableProject } from "../refs.js";
import type { Runtime } from "../runtime.js";
import { findDecisionById, queryDecisions } from "./repository.js";

export type DecisionService = ReturnType<typeof createDecisionService>;

export function createDecisionService(
  runtime: Runtime,
  activity: ActivityService,
  claims: ClaimService,
) {
  return {
    create(projectRef: string, input: CreateDecisionInput): Decision {
      return runtime.tx(() => {
        const project = requireWritableProject(runtime, projectRef);

        let task: TaskRow | null = null;
        if (input.task) {
          task = requireTask(runtime, input.task);
          if (task.projectId !== project.id) {
            throw new AgentWorkspaceError(
              "VALIDATION_ERROR",
              `${task.key} belongs to a different project and cannot scope a decision on ${project.key}.`,
              { task: task.key, project: project.key },
            );
          }
        }

        const superseded = input.supersedes ? requireDecision(runtime, input.supersedes) : null;
        if (superseded && superseded.projectId !== project.id) {
          throw new AgentWorkspaceError(
            "VALIDATION_ERROR",
            `${superseded.key} belongs to a different project.`,
            { decision: superseded.key },
          );
        }

        const row = runtime.db
          .insert(decisions)
          .values({
            id: runtime.newId(),
            key: nextKey(runtime, "decision"),
            projectId: project.id,
            taskId: task?.id ?? null,
            title: input.title,
            decision: input.decision,
            rationale: input.rationale ?? null,
            createdBy: input.actor ?? null,
            sessionId: input.sessionId ?? null,
            createdAt: runtime.now(),
          })
          .returning()
          .get();

        activity.record({
          projectId: project.id,
          taskId: task?.id ?? null,
          eventType: "decision.recorded",
          actor: input.actor,
          sessionId: input.sessionId,
          payload: { decisionKey: row.key, title: row.title },
        });

        if (superseded) {
          runtime.db
            .update(decisions)
            .set({ supersededAt: runtime.now(), supersededById: row.id })
            .where(eq(decisions.id, superseded.id))
            .run();

          activity.record({
            projectId: project.id,
            taskId: superseded.taskId,
            eventType: "decision.superseded",
            actor: input.actor,
            sessionId: input.sessionId,
            payload: { decisionKey: superseded.key, supersededBy: row.key },
          });
        }

        if (task) claims.touch(task.id, input.actor, input.sessionId);

        return findDecisionById(runtime, row.id) as Decision;
      });
    },

    list(projectRef: string, query: ListDecisionsQuery): Decision[] {
      const project = requireProject(runtime, projectRef);
      return queryDecisions(runtime, {
        projectId: project.id,
        ...(query.task ? { taskId: requireTask(runtime, query.task).id } : {}),
        ...(query.search ? { search: query.search } : {}),
        limit: query.limit,
      });
    },

    get(decisionRef: string): Decision {
      const row = requireDecision(runtime, decisionRef);
      return findDecisionById(runtime, row.id) as Decision;
    },
  };
}
