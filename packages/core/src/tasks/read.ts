import type {
  AcceptanceCriterion,
  TaskExecution,
  TaskPriority,
  TaskRef,
  TaskStatus,
  TaskSummary,
} from "@agent-continuity/contracts";
import {
  acceptanceCriteria,
  blockers,
  links,
  projects,
  taskDependencies,
  tasks,
  type AcceptanceCriterionRow,
  type TaskClaimRow,
  type TaskRow,
} from "@agent-continuity/database";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { toClaimDto } from "../claims/repository.js";
import type { ClaimService } from "../claims/service.js";
import type { ExecutionService } from "../executions/service.js";
import type { Runtime } from "../runtime.js";

export type CriteriaCount = { total: number; completed: number };

export type TaskAggregates = {
  criteria: Map<string, CriteriaCount>;
  dependencies: Map<string, TaskRef[]>;
  dependents: Map<string, TaskRef[]>;
  activeBlockers: Map<string, number>;
  links: Map<string, number>;
  claims: Map<string, TaskClaimRow>;
  executions: Map<string, TaskExecution>;
  projectKeys: Map<string, string>;
  taskKeys: Map<string, string>;
};

function unique(values: (string | null)[]): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

export function toTaskRef(row: Pick<TaskRow, "id" | "key" | "title" | "status">): TaskRef {
  return { id: row.id, key: row.key, title: row.title, status: row.status as TaskStatus };
}

/**
 * Batches every derived value a task list needs so rendering N tasks stays a fixed
 * number of queries rather than N per task.
 */
export function buildAggregates(
  runtime: Runtime,
  claimService: ClaimService,
  rows: TaskRow[],
  options: { includeDependents?: boolean } = {},
  executions?: ExecutionService,
): TaskAggregates {
  const ids = rows.map((row) => row.id);
  const aggregates: TaskAggregates = {
    criteria: new Map(),
    dependencies: new Map(),
    dependents: new Map(),
    activeBlockers: new Map(),
    links: new Map(),
    claims: new Map(),
    executions: new Map(),
    projectKeys: new Map(),
    taskKeys: new Map(rows.map((row) => [row.id, row.key])),
  };

  const projectIds = unique(rows.map((row) => row.projectId));
  if (projectIds.length > 0) {
    for (const project of runtime.db
      .select({ id: projects.id, key: projects.key })
      .from(projects)
      .where(inArray(projects.id, projectIds))
      .all()) {
      aggregates.projectKeys.set(project.id, project.key);
    }
  }

  if (ids.length === 0) return aggregates;

  for (const row of runtime.db
    .select({
      taskId: acceptanceCriteria.taskId,
      total: sql<number>`count(*)`,
      completed: sql<number>`sum(${acceptanceCriteria.isComplete})`,
    })
    .from(acceptanceCriteria)
    .where(inArray(acceptanceCriteria.taskId, ids))
    .groupBy(acceptanceCriteria.taskId)
    .all()) {
    aggregates.criteria.set(row.taskId, {
      total: Number(row.total ?? 0),
      completed: Number(row.completed ?? 0),
    });
  }

  const dependencyRows = runtime.db
    .select({
      taskId: taskDependencies.taskId,
      id: tasks.id,
      key: tasks.key,
      title: tasks.title,
      status: tasks.status,
    })
    .from(taskDependencies)
    .innerJoin(tasks, eq(tasks.id, taskDependencies.dependsOnTaskId))
    .where(inArray(taskDependencies.taskId, ids))
    .orderBy(asc(tasks.key))
    .all();

  for (const row of dependencyRows) {
    const list = aggregates.dependencies.get(row.taskId) ?? [];
    list.push(toTaskRef(row));
    aggregates.dependencies.set(row.taskId, list);
    aggregates.taskKeys.set(row.id, row.key);
  }

  if (options.includeDependents) {
    const dependentRows = runtime.db
      .select({
        dependsOnTaskId: taskDependencies.dependsOnTaskId,
        id: tasks.id,
        key: tasks.key,
        title: tasks.title,
        status: tasks.status,
      })
      .from(taskDependencies)
      .innerJoin(tasks, eq(tasks.id, taskDependencies.taskId))
      .where(inArray(taskDependencies.dependsOnTaskId, ids))
      .orderBy(asc(tasks.key))
      .all();

    for (const row of dependentRows) {
      const list = aggregates.dependents.get(row.dependsOnTaskId) ?? [];
      list.push(toTaskRef(row));
      aggregates.dependents.set(row.dependsOnTaskId, list);
    }
  }

  for (const row of runtime.db
    .select({ taskId: blockers.taskId, total: sql<number>`count(*)` })
    .from(blockers)
    .where(and(inArray(blockers.taskId, ids), isNull(blockers.resolvedAt)))
    .groupBy(blockers.taskId)
    .all()) {
    aggregates.activeBlockers.set(row.taskId, Number(row.total ?? 0));
  }

  for (const row of runtime.db
    .select({ taskId: links.taskId, total: sql<number>`count(*)` })
    .from(links)
    .where(inArray(links.taskId, ids))
    .groupBy(links.taskId)
    .all()) {
    if (row.taskId) aggregates.links.set(row.taskId, Number(row.total ?? 0));
  }

  const parentIds = unique(rows.map((row) => row.parentTaskId)).filter(
    (id) => !aggregates.taskKeys.has(id),
  );
  if (parentIds.length > 0) {
    for (const parent of runtime.db
      .select({ id: tasks.id, key: tasks.key })
      .from(tasks)
      .where(inArray(tasks.id, parentIds))
      .all()) {
      aggregates.taskKeys.set(parent.id, parent.key);
    }
  }

  aggregates.claims = claimService.activeForMany(ids);
  if (executions) {
    for (const id of ids) {
      const execution = executions.activeFor(id);
      if (execution) aggregates.executions.set(id, execution);
    }
  }
  return aggregates;
}

export function toTaskSummary(
  runtime: Runtime,
  row: TaskRow,
  aggregates: TaskAggregates,
): TaskSummary {
  const criteria = aggregates.criteria.get(row.id) ?? { total: 0, completed: 0 };
  const dependencies = aggregates.dependencies.get(row.id) ?? [];
  const activeBlockerCount = aggregates.activeBlockers.get(row.id) ?? 0;
  const dependenciesComplete = dependencies.every((dependency) => dependency.status === "done");
  const claim = aggregates.claims.get(row.id);

  return {
    id: row.id,
    key: row.key,
    projectId: row.projectId,
    projectKey: aggregates.projectKeys.get(row.projectId) ?? "",
    parentTaskId: row.parentTaskId,
    parentTaskKey: row.parentTaskId ? (aggregates.taskKeys.get(row.parentTaskId) ?? null) : null,
    title: row.title,
    description: row.description,
    context: row.context,
    status: row.status as TaskStatus,
    priority: row.priority as TaskPriority,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    completedAt: row.completedAt,
    acceptanceCriteriaCompleted: criteria.completed,
    acceptanceCriteriaTotal: criteria.total,
    acceptanceCriteriaProgress:
      criteria.total === 0 ? null : criteria.completed / criteria.total,
    dependencyCount: dependencies.length,
    dependenciesComplete,
    activeBlockerCount,
    linkCount: aggregates.links.get(row.id) ?? 0,
    // A task is actionable only when it is ready, unblocked and free of incomplete dependencies.
    isActionable: row.status === "ready" && dependenciesComplete && activeBlockerCount === 0,
    claim: claim ? toClaimDto(runtime, claim, row.key) : null,
    execution: aggregates.executions.get(row.id) ?? null,
  };
}

export function toCriterionDto(row: AcceptanceCriterionRow): AcceptanceCriterion {
  return {
    id: row.id,
    taskId: row.taskId,
    description: row.description,
    isComplete: row.isComplete === 1,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
  };
}

export function listCriteria(runtime: Runtime, taskId: string): AcceptanceCriterionRow[] {
  return runtime.db
    .select()
    .from(acceptanceCriteria)
    .where(eq(acceptanceCriteria.taskId, taskId))
    .orderBy(asc(acceptanceCriteria.sortOrder), asc(acceptanceCriteria.createdAt))
    .all();
}
