import type { ProjectStatus, ProjectSummary, TaskCounts } from "@agent-continuity/contracts";
import { tasks, type ProjectRow } from "@agent-continuity/database";
import { eq, sql } from "drizzle-orm";
import type { ActivityService } from "../activity/service.js";
import type { Runtime } from "../runtime.js";

const EMPTY_COUNTS: TaskCounts = {
  backlog: 0,
  ready: 0,
  inProgress: 0,
  blocked: 0,
  review: 0,
  done: 0,
};

const COUNT_KEYS: Record<string, keyof TaskCounts> = {
  backlog: "backlog",
  ready: "ready",
  in_progress: "inProgress",
  blocked: "blocked",
  review: "review",
  done: "done",
};

export function taskCountsFor(runtime: Runtime, projectId: string): TaskCounts {
  const counts: TaskCounts = { ...EMPTY_COUNTS };
  for (const row of runtime.db
    .select({ status: tasks.status, total: sql<number>`count(*)` })
    .from(tasks)
    .where(eq(tasks.projectId, projectId))
    .groupBy(tasks.status)
    .all()) {
    const key = COUNT_KEYS[row.status];
    if (key) counts[key] = Number(row.total ?? 0);
  }
  return counts;
}

export function toProjectSummary(
  runtime: Runtime,
  activity: ActivityService,
  row: ProjectRow,
): ProjectSummary {
  const taskCounts = taskCountsFor(runtime, row.id);
  const taskTotal = Object.values(taskCounts).reduce((sum, value) => sum + value, 0);

  return {
    id: row.id,
    key: row.key,
    name: row.name,
    objective: row.objective,
    description: row.description,
    context: row.context,
    status: row.status as ProjectStatus,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    archivedAt: row.archivedAt,
    taskCounts,
    taskTotal,
    // Project progress is simply done tasks / total tasks.
    progress: taskTotal === 0 ? null : taskCounts.done / taskTotal,
    lastActivityAt: activity.lastActivityAt(row.id),
  };
}
