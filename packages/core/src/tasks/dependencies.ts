import { AgentWorkspaceError } from "@agent-workspace/contracts";
import { taskDependencies, tasks, type TaskRow } from "@agent-workspace/database";
import { and, eq, inArray } from "drizzle-orm";
import type { ActivityService } from "../activity/service.js";
import type { Runtime } from "../runtime.js";

type Meta = { actor?: string | null | undefined; sessionId?: string | null | undefined };

function dependenciesOf(runtime: Runtime, taskIds: string[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  if (taskIds.length === 0) return map;
  for (const row of runtime.db
    .select()
    .from(taskDependencies)
    .where(inArray(taskDependencies.taskId, taskIds))
    .all()) {
    const list = map.get(row.taskId) ?? [];
    list.push(row.dependsOnTaskId);
    map.set(row.taskId, list);
  }
  return map;
}

/**
 * Adding "task depends on dependsOn" creates a cycle when a path already leads from
 * `dependsOn` back to `task`. Returns that path (as ids) when one exists.
 */
function findPath(runtime: Runtime, fromId: string, toId: string): string[] | null {
  const parents = new Map<string, string | null>([[fromId, null]]);
  let frontier = [fromId];

  while (frontier.length > 0) {
    const edges = dependenciesOf(runtime, frontier);
    const next: string[] = [];

    for (const current of frontier) {
      for (const neighbour of edges.get(current) ?? []) {
        if (parents.has(neighbour)) continue;
        parents.set(neighbour, current);

        if (neighbour === toId) {
          const path: string[] = [];
          let cursor: string | null = neighbour;
          while (cursor) {
            path.unshift(cursor);
            cursor = parents.get(cursor) ?? null;
          }
          return path;
        }
        next.push(neighbour);
      }
    }
    frontier = next;
  }
  return null;
}

function keysFor(runtime: Runtime, ids: string[]): Map<string, string> {
  const map = new Map<string, string>();
  if (ids.length === 0) return map;
  for (const row of runtime.db
    .select({ id: tasks.id, key: tasks.key })
    .from(tasks)
    .where(inArray(tasks.id, ids))
    .all()) {
    map.set(row.id, row.key);
  }
  return map;
}

export function assertDependencyAllowed(runtime: Runtime, task: TaskRow, dependsOn: TaskRow): void {
  if (task.id === dependsOn.id) {
    throw new AgentWorkspaceError(
      "DEPENDENCY_SELF_REFERENCE",
      `${task.key} cannot depend on itself.`,
      { task: task.key },
    );
  }

  if (task.projectId !== dependsOn.projectId) {
    throw new AgentWorkspaceError(
      "DEPENDENCY_CROSS_PROJECT",
      `${task.key} and ${dependsOn.key} belong to different projects. Dependencies are limited to tasks in the same project.`,
      { task: task.key, dependsOn: dependsOn.key },
    );
  }

  const path = findPath(runtime, dependsOn.id, task.id);
  if (path) {
    const keys = keysFor(runtime, path);
    const rendered = [task.key, ...path.map((id) => keys.get(id) ?? id)].join(" → ");
    throw new AgentWorkspaceError(
      "DEPENDENCY_CYCLE",
      `Cannot add ${dependsOn.key} as a dependency of ${task.key} because it would create the dependency cycle ${rendered}.`,
      { task: task.key, dependsOn: dependsOn.key, cycle: rendered },
    );
  }
}

export function addDependency(
  runtime: Runtime,
  activity: ActivityService,
  task: TaskRow,
  dependsOn: TaskRow,
  meta: Meta = {},
): void {
  assertDependencyAllowed(runtime, task, dependsOn);

  const existing = runtime.db
    .select()
    .from(taskDependencies)
    .where(
      and(
        eq(taskDependencies.taskId, task.id),
        eq(taskDependencies.dependsOnTaskId, dependsOn.id),
      ),
    )
    .get();
  if (existing) return;

  runtime.db
    .insert(taskDependencies)
    .values({ taskId: task.id, dependsOnTaskId: dependsOn.id, createdAt: runtime.now() })
    .run();

  activity.record({
    projectId: task.projectId,
    taskId: task.id,
    eventType: "dependency.added",
    actor: meta.actor,
    sessionId: meta.sessionId,
    payload: { dependsOn: dependsOn.key },
  });
}

export function removeDependency(
  runtime: Runtime,
  activity: ActivityService,
  task: TaskRow,
  dependsOn: TaskRow,
  meta: Meta = {},
): void {
  const removed = runtime.db
    .delete(taskDependencies)
    .where(
      and(
        eq(taskDependencies.taskId, task.id),
        eq(taskDependencies.dependsOnTaskId, dependsOn.id),
      ),
    )
    .returning()
    .all();

  if (removed.length === 0) {
    throw new AgentWorkspaceError(
      "DEPENDENCY_NOT_FOUND",
      `${task.key} does not depend on ${dependsOn.key}.`,
      { task: task.key, dependsOn: dependsOn.key },
    );
  }

  activity.record({
    projectId: task.projectId,
    taskId: task.id,
    eventType: "dependency.removed",
    actor: meta.actor,
    sessionId: meta.sessionId,
    payload: { dependsOn: dependsOn.key },
  });
}
