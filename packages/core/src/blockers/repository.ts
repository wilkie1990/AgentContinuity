import type { Blocker } from "@agent-continuity/contracts";
import { blockers, tasks, type BlockerRow } from "@agent-continuity/database";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { Runtime } from "../runtime.js";

export function toBlockerDto(row: BlockerRow, taskKey: string): Blocker {
  return {
    id: row.id,
    key: row.key,
    taskId: row.taskId,
    taskKey,
    description: row.description,
    requiredAction: row.requiredAction,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    resolvedAt: row.resolvedAt,
    resolvedBy: row.resolvedBy,
    resolution: row.resolution,
    isActive: row.resolvedAt === null,
  };
}

export function listBlockerRows(runtime: Runtime, taskId: string): BlockerRow[] {
  return runtime.db
    .select()
    .from(blockers)
    .where(eq(blockers.taskId, taskId))
    .orderBy(asc(blockers.createdAt))
    .all();
}

export function countActiveBlockers(runtime: Runtime, taskId: string): number {
  const row = runtime.db
    .select({ total: sql<number>`count(*)` })
    .from(blockers)
    .where(and(eq(blockers.taskId, taskId), isNull(blockers.resolvedAt)))
    .get();
  return Number(row?.total ?? 0);
}

/** Active blockers across a whole project, newest first, used by project level views. */
export function listActiveProjectBlockers(runtime: Runtime, projectId: string): Blocker[] {
  return runtime.db
    .select({ blocker: blockers, taskKey: tasks.key })
    .from(blockers)
    .innerJoin(tasks, eq(tasks.id, blockers.taskId))
    .where(and(eq(tasks.projectId, projectId), isNull(blockers.resolvedAt)))
    .orderBy(asc(blockers.createdAt))
    .all()
    .map((row) => toBlockerDto(row.blocker, row.taskKey));
}
