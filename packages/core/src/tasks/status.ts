import type { TaskStatus } from "@agent-continuity/contracts";
import { tasks, type TaskRow } from "@agent-continuity/database";
import { eq } from "drizzle-orm";
import type { ActivityService } from "../activity/service.js";
import type { Runtime } from "../runtime.js";

export type StatusChangeMeta = {
  actor?: string | null | undefined;
  sessionId?: string | null | undefined;
  reason?: string | undefined;
  /** Extra fields merged into the task.status_changed payload. */
  payload?: Record<string, unknown>;
};

/**
 * Single place where a task's status column changes, so `completed_at` bookkeeping and the
 * status_changed / reopened events stay consistent no matter which service triggered it.
 */
export function writeStatus(
  runtime: Runtime,
  activity: ActivityService,
  task: TaskRow,
  next: TaskStatus,
  meta: StatusChangeMeta = {},
): TaskRow {
  if (task.status === next) return task;

  const now = runtime.now();
  const wasDone = task.status === "done";
  const completedAt = next === "done" ? now : wasDone ? null : task.completedAt;

  const updated = runtime.db
    .update(tasks)
    .set({ status: next, completedAt, updatedAt: now })
    .where(eq(tasks.id, task.id))
    .returning()
    .get();

  activity.record({
    projectId: task.projectId,
    taskId: task.id,
    eventType: "task.status_changed",
    actor: meta.actor,
    sessionId: meta.sessionId,
    payload: {
      from: task.status,
      to: next,
      ...(meta.reason ? { reason: meta.reason } : {}),
      ...meta.payload,
    },
  });

  if (wasDone && next !== "done") {
    activity.record({
      projectId: task.projectId,
      taskId: task.id,
      eventType: "task.reopened",
      actor: meta.actor,
      sessionId: meta.sessionId,
      payload: { from: task.status, to: next, ...(meta.reason ? { reason: meta.reason } : {}) },
    });
  }

  return updated;
}

export function touchTask(runtime: Runtime, taskId: string): void {
  runtime.db.update(tasks).set({ updatedAt: runtime.now() }).where(eq(tasks.id, taskId)).run();
}
