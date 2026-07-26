import type { TaskClaim } from "@agent-continuity/contracts";
import { taskClaims, tasks, type TaskClaimRow } from "@agent-continuity/database";
import { and, desc, eq, gt, inArray, isNull, lte } from "drizzle-orm";
import { minutesBetween, type Runtime } from "../runtime.js";

/** A claim is active while it has not been released and its lease has not lapsed. */
export function findActiveClaim(runtime: Runtime, taskId: string): TaskClaimRow | undefined {
  const now = runtime.now();
  return runtime.db
    .select()
    .from(taskClaims)
    .where(
      and(eq(taskClaims.taskId, taskId), isNull(taskClaims.releasedAt), gt(taskClaims.expiresAt, now)),
    )
    .orderBy(desc(taskClaims.claimedAt))
    .get();
}

export function findActiveClaims(runtime: Runtime, taskIds: string[]): Map<string, TaskClaimRow> {
  const result = new Map<string, TaskClaimRow>();
  if (taskIds.length === 0) return result;
  const now = runtime.now();

  const rows = runtime.db
    .select()
    .from(taskClaims)
    .where(
      and(
        inArray(taskClaims.taskId, taskIds),
        isNull(taskClaims.releasedAt),
        gt(taskClaims.expiresAt, now),
      ),
    )
    .orderBy(desc(taskClaims.claimedAt))
    .all();

  for (const row of rows) {
    if (!result.has(row.taskId)) result.set(row.taskId, row);
  }
  return result;
}

export type LapsedClaim = { claim: TaskClaimRow; projectId: string };

/** Claims whose lease has lapsed and for which task.claim_expired has not yet been emitted. */
export function findUnrecordedExpiredClaims(
  runtime: Runtime,
  taskIds?: string[],
): LapsedClaim[] {
  const now = runtime.now();
  const conditions = [
    isNull(taskClaims.releasedAt),
    lte(taskClaims.expiresAt, now),
    isNull(taskClaims.expiryRecordedAt),
  ];
  if (taskIds) {
    if (taskIds.length === 0) return [];
    conditions.push(inArray(taskClaims.taskId, taskIds));
  }

  return runtime.db
    .select({ claim: taskClaims, projectId: tasks.projectId })
    .from(taskClaims)
    .innerJoin(tasks, eq(tasks.id, taskClaims.taskId))
    .where(and(...conditions))
    .all();
}

export function toClaimDto(runtime: Runtime, row: TaskClaimRow, taskKey: string): TaskClaim {
  return {
    id: row.id,
    taskId: row.taskId,
    taskKey,
    actor: row.actor,
    sessionId: row.sessionId,
    claimedAt: row.claimedAt,
    lastActiveAt: row.lastActiveAt,
    expiresAt: row.expiresAt,
    releasedAt: row.releasedAt,
    releaseReason: row.releaseReason,
    expiresInMinutes: minutesBetween(runtime.now(), row.expiresAt),
  };
}
