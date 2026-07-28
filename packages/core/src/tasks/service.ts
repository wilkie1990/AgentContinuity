import {
  AgentContinuityError,
  type AcceptanceCriterion,
  type AddProgressInput,
  type CompleteTaskInput,
  type CreateTaskInput,
  type DeletedTask,
  type DeleteTaskInput,
  type ListTasksQuery,
  type ProgressEntry,
  type ProjectStatus,
  type TaskDetail,
  type TaskSummary,
  type UpdateAcceptanceCriteriaInput,
  type UpdateTaskContextInput,
  type UpdateTaskInput,
} from "@agent-continuity/contracts";
import {
  acceptanceCriteria,
  activityEvents,
  blockers,
  links,
  taskDependencies,
  taskProgress,
  tasks,
  type ProjectRow,
  type TaskProgressRow,
  type TaskRow,
} from "@agent-continuity/database";
import { and, asc, desc, eq, inArray, like, or, sql, type SQL } from "drizzle-orm";
import type { AnySQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";
import type { ActivityService } from "../activity/service.js";
import { listBlockerRows, toBlockerDto } from "../blockers/repository.js";
import type { ClaimService } from "../claims/service.js";
import type { ContextService } from "../context/service.js";
import type { ExecutionService } from "../executions/service.js";
import type { EvidenceService } from "../evidence/service.js";
import { queryDecisions } from "../decisions/repository.js";
import { nextKey } from "../ids.js";
import { queryLinks } from "../links/repository.js";
import {
  assertWritable,
  findTask,
  requireCriterionById,
  requireProject,
  requireTask,
  requireWritableProject,
} from "../refs.js";
import type { Runtime } from "../runtime.js";
import type { SearchService } from "../search/service.js";
import {
  addCriteria,
  completeCriterion,
  deleteCriterion,
  reopenCriterion,
} from "./acceptance-criteria.js";
import { addDependency, removeDependency } from "./dependencies.js";
import {
  buildAggregates,
  listCriteria,
  toCriterionDto,
  toTaskSummary,
  type TaskAggregates,
} from "./read.js";
import { writeStatus } from "./status.js";

const PROGRESS_EXCERPT_LENGTH = 280;

function excerpt(content: string): string {
  return content.length <= PROGRESS_EXCERPT_LENGTH
    ? content
    : `${content.slice(0, PROGRESS_EXCERPT_LENGTH)}…`;
}

function toProgressDto(row: TaskProgressRow, taskKey: string): ProgressEntry {
  return {
    id: row.id,
    taskId: row.taskId,
    taskKey,
    content: row.content,
    actor: row.actor,
    sessionId: row.sessionId,
    createdAt: row.createdAt,
  };
}

export type TaskService = ReturnType<typeof createTaskService>;

export function createTaskService(
  runtime: Runtime,
  activity: ActivityService,
  claims: ClaimService,
  contexts: ContextService,
  executions?: ExecutionService,
  search?: SearchService,
  evidence?: EvidenceService,
) {
  function summarise(row: TaskRow): TaskSummary {
    return toTaskSummary(runtime, row, buildAggregates(runtime, claims, [row], {}, executions));
  }

  function summariseAll(rows: TaskRow[]): TaskSummary[] {
    const aggregates = buildAggregates(runtime, claims, rows, {}, executions);
    return rows.map((row) => toTaskSummary(runtime, row, aggregates));
  }

  function nextSortOrder(projectId: string): number {
    const row = runtime.db
      .select({ max: sql<number | null>`max(${tasks.sortOrder})` })
      .from(tasks)
      .where(eq(tasks.projectId, projectId))
      .get();
    return Number(row?.max ?? 0) + 1000;
  }

  /** Rejects a parent that is the task itself or one of its own descendants. */
  function assertParentAllowed(task: TaskRow | null, parent: TaskRow, project: ProjectRow): void {
    if (parent.projectId !== project.id) {
      throw new AgentContinuityError(
        "VALIDATION_ERROR",
        `Parent task ${parent.key} belongs to a different project.`,
        { parentTask: parent.key },
      );
    }
    if (!task) return;
    if (parent.id === task.id) {
      throw new AgentContinuityError(
        "VALIDATION_ERROR",
        `${task.key} cannot be its own parent.`,
        { task: task.key },
      );
    }

    let cursor: TaskRow | undefined = parent;
    const seen = new Set<string>();
    while (cursor?.parentTaskId) {
      if (seen.has(cursor.id)) break;
      seen.add(cursor.id);
      if (cursor.parentTaskId === task.id) {
        throw new AgentContinuityError(
          "VALIDATION_ERROR",
          `Setting ${parent.key} as the parent of ${task.key} would create a task hierarchy cycle.`,
          { task: task.key, parentTask: parent.key },
        );
      }
      cursor = runtime.db.select().from(tasks).where(eq(tasks.id, cursor.parentTaskId)).get();
    }
  }

  /** Shared by tasks.create, tasks.create (batch) and projects.bootstrap. */
  function insertTask(
    project: ProjectRow,
    input: CreateTaskInput,
    meta: { actor?: string | undefined; sessionId?: string | undefined },
  ): TaskRow {
    const now = runtime.now();
    let parent: TaskRow | null = null;

    if (input.parentTask) {
      parent = requireTask(runtime, input.parentTask);
      assertParentAllowed(null, parent, project);
    }

    const inserted = runtime.db
      .insert(tasks)
      .values({
        id: runtime.newId(),
        key: nextKey(runtime, "task"),
        projectId: project.id,
        parentTaskId: parent?.id ?? null,
        title: input.title,
        description: input.description ?? null,
        context: input.context ?? null,
        status: input.status ?? "backlog",
        priority: input.priority ?? "normal",
        sortOrder: input.sortOrder ?? nextSortOrder(project.id),
        createdAt: now,
        updatedAt: now,
        completedAt: input.status === "done" ? now : null,
      })
      .returning()
      .get();
    const row = contexts.initialiseTask(inserted, {
      actor: meta.actor,
      sessionId: meta.sessionId,
      reason: "Initial task context.",
    });

    activity.record({
      projectId: project.id,
      taskId: row.id,
      eventType: "task.created",
      actor: meta.actor,
      sessionId: meta.sessionId,
      payload: {
        title: row.title,
        status: row.status,
        priority: row.priority,
        ...(parent ? { parentTask: parent.key } : {}),
      },
    });

    if (input.acceptanceCriteria?.length) {
      addCriteria(runtime, activity, claims, row, input.acceptanceCriteria, meta);
    }

    if (input.dependencies?.length) {
      for (const ref of input.dependencies) {
        addDependency(runtime, activity, row, requireTask(runtime, ref), meta);
      }
    }

    return row;
  }

  function completeTask(taskRef: string, input: CompleteTaskInput): TaskSummary {
    return runtime.tx(() => {
      const task = requireTask(runtime, taskRef);
      requireWritableProject(runtime, task.projectId);
      if (input.force && !input.reason?.trim()) {
        throw new AgentContinuityError(
          "VALIDATION_ERROR",
          "A non-empty reason is required when forcing task completion.",
          { task: task.key },
        );
      }

      const criteria = listCriteria(runtime, task.id);
      const incomplete = criteria.filter((criterion) => criterion.isComplete === 0);

      if (incomplete.length > 0 && !input.force) {
        throw new AgentContinuityError(
          "TASK_HAS_INCOMPLETE_ACCEPTANCE_CRITERIA",
          `${task.key} has ${incomplete.length} incomplete acceptance ${
            incomplete.length === 1 ? "criterion" : "criteria"
          }. Complete them, or pass force with a reason.`,
          {
            task: task.key,
            incomplete: incomplete.map((criterion) => criterion.description),
          },
        );
      }

      const activeBlockers = listBlockerRows(runtime, task.id).filter(
        (blocker) => blocker.resolvedAt === null,
      );
      if (activeBlockers.length > 0 && !input.force) {
        throw new AgentContinuityError(
          "TASK_HAS_ACTIVE_BLOCKERS",
          `${task.key} has ${activeBlockers.length} active ${
            activeBlockers.length === 1 ? "blocker" : "blockers"
          }. Resolve them, or pass force with a reason.`,
          { task: task.key, blockers: activeBlockers.map((blocker) => blocker.key) },
        );
      }

      const missingEvidence = evidence?.missingForTask(task.id) ?? [];
      if (missingEvidence.length > 0 && !input.force) {
        throw new AgentContinuityError(
          "TASK_HAS_MISSING_ACCEPTANCE_EVIDENCE",
          `${task.key} has ${missingEvidence.length} acceptance ${
            missingEvidence.length === 1 ? "criterion" : "criteria"
          } without the required evidence. Add qualifying evidence, change the policy, or pass force with a reason.`,
          { task: task.key, missing: missingEvidence },
        );
      }

      const updated = writeStatus(runtime, activity, task, "done", {
        actor: input.actor,
        sessionId: input.sessionId,
        ...(input.reason ? { reason: input.reason } : {}),
      });

      claims.releaseForTask(updated, {
        reason: "task completed",
        actor: input.actor,
        sessionId: input.sessionId,
      });

      activity.record({
        projectId: task.projectId,
        taskId: task.id,
        eventType: "task.completed",
        actor: input.actor,
        sessionId: input.sessionId,
        payload: {
          forced: input.force,
          ...(input.force ? { reason: input.reason } : {}),
          acceptanceCriteriaTotal: criteria.length,
          acceptanceCriteriaIncomplete: incomplete.length,
          ...(input.force && incomplete.length > 0
            ? { skippedCriteria: incomplete.map((criterion) => criterion.description) }
            : {}),
          ...(input.force && activeBlockers.length > 0
            ? { skippedBlockers: activeBlockers.map((blocker) => blocker.key) }
            : {}),
          ...(input.force && missingEvidence.length > 0 ? { missingEvidence } : {}),
        },
      });

      return summarise(runtime.db.select().from(tasks).where(eq(tasks.id, task.id)).get() ?? updated);
    });
  }

  function detail(row: TaskRow, aggregates: TaskAggregates): TaskDetail {
    const project = requireProject(runtime, row.projectId);
    const blockerRows = listBlockerRows(runtime, row.id).map((blocker) =>
      toBlockerDto(blocker, row.key),
    );
    const progressRows = runtime.db
      .select()
      .from(taskProgress)
      .where(eq(taskProgress.taskId, row.id))
      .orderBy(desc(taskProgress.createdAt))
      .all();

    return {
      ...toTaskSummary(runtime, row, aggregates),
      project: {
        id: project.id,
        key: project.key,
        name: project.name,
        status: project.status as ProjectStatus,
        objective: project.objective,
      },
      acceptanceCriteria: listCriteria(runtime, row.id).map((criterion) => ({
        ...toCriterionDto(criterion),
        ...(evidence
          ? {
              evidence: evidence.list(row.id, criterion.id),
              evidencePolicy: evidence.getPolicy(row.id, criterion.id),
            }
          : {}),
      })),
      dependencies: aggregates.dependencies.get(row.id) ?? [],
      dependents: aggregates.dependents.get(row.id) ?? [],
      progress: progressRows.map((entry) => toProgressDto(entry, row.key)),
      activeBlockers: blockerRows.filter((blocker) => blocker.isActive),
      resolvedBlockers: blockerRows.filter((blocker) => !blocker.isActive),
      decisions: queryDecisions(runtime, { taskId: row.id }),
      links: queryLinks(runtime, { taskId: row.id }),
      recentActivity: activity.recentForTask(row.id, 20),
    };
  }

  return {
    summarise,
    summariseAll,
    insertTask,

    create(projectRef: string, input: CreateTaskInput): TaskSummary {
      return runtime.tx(() => {
        const project = requireWritableProject(runtime, projectRef);
        const row = insertTask(project, input, {
          actor: input.actor,
          sessionId: input.sessionId,
        });
        return summarise(row);
      });
    },

    /** Batch creation is transactional: one invalid task rejects the whole batch. */
    createMany(
      projectRef: string,
      inputs: Omit<CreateTaskInput, "actor" | "sessionId">[],
      meta: { actor?: string | undefined; sessionId?: string | undefined } = {},
    ): TaskSummary[] {
      return runtime.tx(() => {
        const project = requireWritableProject(runtime, projectRef);
        const rows = inputs.map((input) => insertTask(project, input, meta));
        return summariseAll(rows);
      });
    },

    list(projectRef: string, query: ListTasksQuery = {}): TaskSummary[] {
      return runtime.tx(() => {
        const project = requireProject(runtime, projectRef);
        const conditions: SQL[] = [eq(tasks.projectId, project.id)];

        if (query.status?.length) conditions.push(inArray(tasks.status, query.status));
        if (query.priority?.length) conditions.push(inArray(tasks.priority, query.priority));
        if (query.parent) conditions.push(eq(tasks.parentTaskId, requireTask(runtime, query.parent).id));
        if (query.search) {
          const pattern = `%${query.search}%`;
          const search = or(
            like(tasks.title, pattern),
            like(tasks.description, pattern),
            like(tasks.context, pattern),
            like(tasks.key, pattern),
          );
          if (search) conditions.push(search);
        }

        const rows = runtime.db
          .select()
          .from(tasks)
          .where(and(...conditions))
          .orderBy(asc(tasks.sortOrder), asc(tasks.key))
          .all();

        let summaries = summariseAll(rows);

        if (query.actionable !== undefined) {
          summaries = summaries.filter((task) => task.isActionable === query.actionable);
        }
        if (query.claimed !== undefined) {
          summaries = summaries.filter((task) => (task.claim !== null) === query.claimed);
        }
        if (query.blocked !== undefined) {
          summaries = summaries.filter((task) => (task.activeBlockerCount > 0) === query.blocked);
        }
        return summaries;
      });
    },

    get(taskRef: string): TaskDetail {
      return runtime.tx(() => {
        const row = requireTask(runtime, taskRef);
        const aggregates = buildAggregates(runtime, claims, [row], { includeDependents: true }, executions);
        return detail(row, aggregates);
      });
    },

    getSummary(taskRef: string): TaskSummary {
      return runtime.tx(() => summarise(requireTask(runtime, taskRef)));
    },

    exists(taskRef: string): boolean {
      return findTask(runtime, taskRef) !== undefined;
    },

    update(taskRef: string, input: UpdateTaskInput): TaskSummary {
      return runtime.tx(() => {
        const task = requireTask(runtime, taskRef);
        const project = requireWritableProject(runtime, task.projectId);
        const meta = { actor: input.actor, sessionId: input.sessionId };

        // Completion has its own rules, so a status change to done routes through them.
        if (input.status === "done" && task.status !== "done") {
          applyUpdates(task, project, input);
          return completeTask(task.id, { force: false, ...meta });
        }

        const updated = applyUpdates(task, project, input);

        if (input.status && input.status !== task.status) {
          if (task.status === "blocked" && input.status !== "blocked") {
            const active = listBlockerRows(runtime, task.id).filter(
              (blocker) => blocker.resolvedAt === null,
            );
            if (active.length > 0) {
              throw new AgentContinuityError(
                "TASK_HAS_ACTIVE_BLOCKERS",
                `${task.key} cannot leave the blocked status while ${active.length} active ${
                  active.length === 1 ? "blocker remains" : "blockers remain"
                }.`,
                { task: task.key, blockers: active.map((blocker) => blocker.key) },
              );
            }
          }
          writeStatus(runtime, activity, updated, input.status, meta);
        }

        return summarise(runtime.db.select().from(tasks).where(eq(tasks.id, task.id)).get() ?? updated);
      });
    },

    updateContext(taskRef: string, input: UpdateTaskContextInput): TaskSummary {
      return summarise(contexts.replaceTask(taskRef, input));
    },

    complete: completeTask,

    addProgress(taskRef: string, input: AddProgressInput): ProgressEntry {
      return runtime.tx(() => {
        const task = requireTask(runtime, taskRef);
        requireWritableProject(runtime, task.projectId);

        const row = runtime.db
          .insert(taskProgress)
          .values({
            id: runtime.newId(),
            taskId: task.id,
            content: input.content,
            actor: input.actor ?? null,
            sessionId: input.sessionId ?? null,
            createdAt: runtime.now(),
          })
          .returning()
          .get();

        activity.record({
          projectId: task.projectId,
          taskId: task.id,
          eventType: "task.progress_added",
          actor: input.actor,
          sessionId: input.sessionId,
          payload: { progressId: row.id, excerpt: excerpt(input.content) },
        });

        claims.touch(task.id, input.actor, input.sessionId);
        return toProgressDto(row, task.key);
      });
    },

    listProgress(taskRef: string): ProgressEntry[] {
      const task = requireTask(runtime, taskRef);
      return runtime.db
        .select()
        .from(taskProgress)
        .where(eq(taskProgress.taskId, task.id))
        .orderBy(desc(taskProgress.createdAt))
        .all()
        .map((row) => toProgressDto(row, task.key));
    },

    addAcceptanceCriteria(
      taskRef: string,
      criteria: string[],
      meta: { actor?: string | undefined; sessionId?: string | undefined } = {},
    ): AcceptanceCriterion[] {
      const task = requireTask(runtime, taskRef);
      requireWritableProject(runtime, task.projectId);
      return addCriteria(runtime, activity, claims, task, criteria, meta);
    },

    completeAcceptanceCriterion(
      taskRef: string,
      ref: string,
      meta: { actor?: string | undefined; sessionId?: string | undefined } = {},
    ): AcceptanceCriterion {
      const task = requireTask(runtime, taskRef);
      requireWritableProject(runtime, task.projectId);
      return completeCriterion(runtime, activity, claims, task, ref, meta);
    },

    reopenAcceptanceCriterion(
      taskRef: string,
      ref: string,
      meta: { actor?: string | undefined; sessionId?: string | undefined } = {},
    ): AcceptanceCriterion {
      const task = requireTask(runtime, taskRef);
      requireWritableProject(runtime, task.projectId);
      return reopenCriterion(runtime, activity, claims, task, ref, meta);
    },

    deleteAcceptanceCriterion(
      taskRef: string,
      ref: string,
      meta: { actor?: string | undefined; sessionId?: string | undefined } = {},
    ): void {
      const task = requireTask(runtime, taskRef);
      requireWritableProject(runtime, task.projectId);
      deleteCriterion(runtime, activity, task, ref, meta);
    },

    /** Resolves the owning task first, for routes that address a criterion by id alone. */
    taskForCriterion(criterionId: string): TaskRow {
      return requireTask(runtime, requireCriterionById(runtime, criterionId).taskId);
    },

    /**
     * Permanently removes a task and everything owned by it: acceptance criteria,
     * progress, blockers, claims, task-scoped links, dependency edges in both
     * directions, and its own activity events.
     *
     * Subtasks and decisions are not owned by the task, so they survive — subtasks are
     * promoted to top level and decisions fall back to project scope. A project-scoped
     * `task.deleted` event is written first so the deletion itself stays in the history
     * that the task's own events are about to leave.
     */
    delete(taskRef: string, input: DeleteTaskInput = { force: false }): DeletedTask {
      return runtime.tx(() => {
        const task = requireTask(runtime, taskRef);
        const project = requireWritableProject(runtime, task.projectId);

        const claim = claims.activeFor(task.id);
        if (claim && !input.force) {
          throw new AgentContinuityError(
            "TASK_ALREADY_CLAIMED",
            `${task.key} is currently claimed by ${claim.actor}. Deleting it would discard work in progress — release the claim, or pass force.`,
            { task: task.key, actor: claim.actor, expiresAt: claim.expiresAt },
          );
        }

        const count = (table: SQLiteTable, column: AnySQLiteColumn): number =>
          Number(
            runtime.db
              .select({ total: sql<number>`count(*)` })
              .from(table)
              .where(eq(column, task.id))
              .get()?.total ?? 0,
          );

        const orphanedSubtasks = runtime.db
          .select({ key: tasks.key })
          .from(tasks)
          .where(eq(tasks.parentTaskId, task.id))
          .all()
          .map((row) => row.key);

        const detachedDecisions = queryDecisions(runtime, { taskId: task.id }).map(
          (decision) => decision.key,
        );

        const summary: DeletedTask = {
          id: task.id,
          key: task.key,
          title: task.title,
          projectKey: project.key,
          removed: {
            acceptanceCriteria: count(acceptanceCriteria, acceptanceCriteria.taskId),
            progress: count(taskProgress, taskProgress.taskId),
            blockers: count(blockers, blockers.taskId),
            links: count(links, links.taskId),
            activityEvents: count(activityEvents, activityEvents.taskId),
            dependencies: count(taskDependencies, taskDependencies.taskId),
            dependents: count(taskDependencies, taskDependencies.dependsOnTaskId),
          },
          orphanedSubtasks,
          detachedDecisions,
        };

        // Recorded against the project, not the task, so it survives the cascade.
        activity.record({
          projectId: task.projectId,
          eventType: "task.deleted",
          actor: input.actor,
          sessionId: input.sessionId,
          payload: {
            taskKey: task.key,
            title: task.title,
            status: task.status,
            removed: summary.removed,
            ...(orphanedSubtasks.length > 0 ? { orphanedSubtasks } : {}),
            ...(detachedDecisions.length > 0 ? { detachedDecisions } : {}),
            ...(claim ? { forcedOverClaimBy: claim.actor } : {}),
          },
        });

        runtime.db.delete(tasks).where(eq(tasks.id, task.id)).run();
        search?.refreshScope(project.id);
        return summary;
      });
    },

    /** Bulk complete/reopen used by the MCP tool, returning the full criteria set. */
    updateAcceptanceCriteria(
      taskRef: string,
      input: UpdateAcceptanceCriteriaInput,
    ): AcceptanceCriterion[] {
      return runtime.tx(() => {
        const task = requireTask(runtime, taskRef);
        requireWritableProject(runtime, task.projectId);
        const meta = { actor: input.actor, sessionId: input.sessionId };

        for (const ref of input.complete ?? []) {
          completeCriterion(runtime, activity, claims, task, ref, meta);
        }
        for (const ref of input.reopen ?? []) {
          reopenCriterion(runtime, activity, claims, task, ref, meta);
        }
        return listCriteria(runtime, task.id).map(toCriterionDto);
      });
    },

    addDependency(
      taskRef: string,
      dependsOnRef: string,
      meta: { actor?: string | undefined; sessionId?: string | undefined } = {},
    ): TaskSummary {
      return runtime.tx(() => {
        const task = requireTask(runtime, taskRef);
        requireWritableProject(runtime, task.projectId);
        addDependency(runtime, activity, task, requireTask(runtime, dependsOnRef), meta);
        return summarise(task);
      });
    },

    removeDependency(
      taskRef: string,
      dependsOnRef: string,
      meta: { actor?: string | undefined; sessionId?: string | undefined } = {},
    ): TaskSummary {
      return runtime.tx(() => {
        const task = requireTask(runtime, taskRef);
        requireWritableProject(runtime, task.projectId);
        removeDependency(runtime, activity, task, requireTask(runtime, dependsOnRef), meta);
        return summarise(task);
      });
    },
  };

  /** Applies every editable column except `status`, which has its own transition rules. */
  function applyUpdates(task: TaskRow, project: ProjectRow, input: UpdateTaskInput): TaskRow {
    const fields = applyFieldUpdates(task, project, input);
    if (input.context === undefined) return fields;
    return contexts.replaceTaskRow(fields, {
      context: input.context,
      expectedVersion: input.expectedContextVersion!,
      reason: input.contextReason,
      actor: input.actor,
      sessionId: input.sessionId,
    });
  }

  /** Applies every editable column except `status` and versioned context. */
  function applyFieldUpdates(task: TaskRow, project: ProjectRow, input: UpdateTaskInput): TaskRow {
    assertWritable(project);

    const changes: Partial<TaskRow> = {};
    const changed: Record<string, unknown> = {};

    if (input.title !== undefined && input.title !== task.title) {
      changes.title = input.title;
      changed.title = input.title;
    }
    if (input.description !== undefined && (input.description ?? null) !== task.description) {
      changes.description = input.description ?? null;
      changed.description = true;
    }
    if (input.priority !== undefined && input.priority !== task.priority) {
      changes.priority = input.priority;
      changed.priority = input.priority;
    }
    if (input.sortOrder !== undefined && input.sortOrder !== task.sortOrder) {
      changes.sortOrder = input.sortOrder;
      changed.sortOrder = input.sortOrder;
    }
    if (input.parentTask !== undefined) {
      const parent = input.parentTask ? requireTask(runtime, input.parentTask) : null;
      if (parent) assertParentAllowed(task, parent, project);
      if ((parent?.id ?? null) !== task.parentTaskId) {
        changes.parentTaskId = parent?.id ?? null;
        changed.parentTask = parent?.key ?? null;
      }
    }

    if (Object.keys(changes).length === 0) return task;

    const updated = runtime.db
      .update(tasks)
      .set({ ...changes, updatedAt: runtime.now() })
      .where(eq(tasks.id, task.id))
      .returning()
      .get();

    if (Object.keys(changed).length > 0) {
      activity.record({
        projectId: task.projectId,
        taskId: task.id,
        eventType: "task.updated",
        actor: input.actor,
        sessionId: input.sessionId,
        payload: { changed },
      });
    }

    claims.touch(task.id, input.actor, input.sessionId);
    return updated;
  }
}
