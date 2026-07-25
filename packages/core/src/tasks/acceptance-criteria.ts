import { AgentWorkspaceError, type AcceptanceCriterion } from "@agent-workspace/contracts";
import { acceptanceCriteria, type TaskRow } from "@agent-workspace/database";
import { eq } from "drizzle-orm";
import type { ActivityService } from "../activity/service.js";
import type { ClaimService } from "../claims/service.js";
import { requireCriterion } from "../refs.js";
import type { Runtime } from "../runtime.js";
import { listCriteria, toCriterionDto } from "./read.js";
import { writeStatus } from "./status.js";

type Meta = { actor?: string | undefined; sessionId?: string | undefined };

/**
 * A completed task that gains new criteria is no longer complete, so it returns to
 * in_progress when someone still holds the lease and to ready otherwise.
 */
function reopenIfDone(
  runtime: Runtime,
  activity: ActivityService,
  claims: ClaimService,
  task: TaskRow,
  meta: Meta,
): TaskRow {
  if (task.status !== "done") return task;
  const next = claims.activeFor(task.id) ? "in_progress" : "ready";
  return writeStatus(runtime, activity, task, next, {
    ...meta,
    reason: "acceptance criteria added after completion",
  });
}

export function addCriteria(
  runtime: Runtime,
  activity: ActivityService,
  claims: ClaimService,
  task: TaskRow,
  descriptions: string[],
  meta: Meta = {},
): AcceptanceCriterion[] {
  return runtime.tx(() => {
    const existing = listCriteria(runtime, task.id);
    let sortOrder = existing.reduce((max, row) => Math.max(max, row.sortOrder), 0);
    const now = runtime.now();
    const created: AcceptanceCriterion[] = [];

    for (const description of descriptions) {
      sortOrder += 1000;
      const row = runtime.db
        .insert(acceptanceCriteria)
        .values({
          id: runtime.newId(),
          taskId: task.id,
          description,
          isComplete: 0,
          sortOrder,
          createdAt: now,
        })
        .returning()
        .get();

      activity.record({
        projectId: task.projectId,
        taskId: task.id,
        eventType: "acceptance_criterion.created",
        actor: meta.actor,
        sessionId: meta.sessionId,
        payload: { criterionId: row.id, description },
      });

      created.push(toCriterionDto(row));
    }

    reopenIfDone(runtime, activity, claims, task, meta);
    claims.touch(task.id, meta.actor, meta.sessionId);
    return created;
  });
}

export function completeCriterion(
  runtime: Runtime,
  activity: ActivityService,
  claims: ClaimService,
  task: TaskRow,
  ref: string,
  meta: Meta = {},
): AcceptanceCriterion {
  return runtime.tx(() => {
    const criterion = requireCriterion(runtime, task.id, ref);
    if (criterion.isComplete === 1) {
      throw new AgentWorkspaceError(
        "ACCEPTANCE_CRITERION_ALREADY_COMPLETE",
        `The acceptance criterion "${criterion.description}" is already complete.`,
        { criterionId: criterion.id },
      );
    }

    const row = runtime.db
      .update(acceptanceCriteria)
      .set({ isComplete: 1, completedAt: runtime.now() })
      .where(eq(acceptanceCriteria.id, criterion.id))
      .returning()
      .get();

    activity.record({
      projectId: task.projectId,
      taskId: task.id,
      eventType: "acceptance_criterion.completed",
      actor: meta.actor,
      sessionId: meta.sessionId,
      payload: { criterionId: row.id, description: row.description },
    });

    claims.touch(task.id, meta.actor, meta.sessionId);
    return toCriterionDto(row);
  });
}

export function reopenCriterion(
  runtime: Runtime,
  activity: ActivityService,
  claims: ClaimService,
  task: TaskRow,
  ref: string,
  meta: Meta = {},
): AcceptanceCriterion {
  return runtime.tx(() => {
    const criterion = requireCriterion(runtime, task.id, ref);
    if (criterion.isComplete === 0) {
      throw new AgentWorkspaceError(
        "ACCEPTANCE_CRITERION_ALREADY_OPEN",
        `The acceptance criterion "${criterion.description}" is already open.`,
        { criterionId: criterion.id },
      );
    }

    const row = runtime.db
      .update(acceptanceCriteria)
      .set({ isComplete: 0, completedAt: null })
      .where(eq(acceptanceCriteria.id, criterion.id))
      .returning()
      .get();

    activity.record({
      projectId: task.projectId,
      taskId: task.id,
      eventType: "acceptance_criterion.reopened",
      actor: meta.actor,
      sessionId: meta.sessionId,
      payload: { criterionId: row.id, description: row.description },
    });

    claims.touch(task.id, meta.actor, meta.sessionId);
    return toCriterionDto(row);
  });
}

export function deleteCriterion(
  runtime: Runtime,
  task: TaskRow,
  ref: string,
): void {
  runtime.tx(() => {
    const criterion = requireCriterion(runtime, task.id, ref);
    if (criterion.isComplete === 1) {
      throw new AgentWorkspaceError(
        "ACCEPTANCE_CRITERION_ALREADY_COMPLETE",
        "Only incomplete acceptance criteria may be deleted in v0.1. Reopen it first.",
        { criterionId: criterion.id },
      );
    }
    runtime.db.delete(acceptanceCriteria).where(eq(acceptanceCriteria.id, criterion.id)).run();
  });
}
