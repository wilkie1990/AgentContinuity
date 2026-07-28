import {
  AgentContinuityError,
  type ArchiveProjectInput,
  type BootstrapProjectRequest,
  type BootstrapResult,
  type CreateProjectInput,
  type DeletedProject,
  type DeleteProjectInput,
  type ListProjectsQuery,
  type ProjectDetail,
  type ProjectListPage,
  type ProjectSummary,
  type UpdateProjectContextInput,
  type UpdateProjectInput,
} from "@agent-continuity/contracts";
import {
  acceptanceCriteria,
  activityEvents,
  blockers,
  decisions,
  executionWorktrees,
  links,
  projects,
  repositories,
  taskClaims,
  taskDependencies,
  taskProgress,
  tasks,
  type ProjectRow,
  type TaskRow,
} from "@agent-continuity/database";
import { and, asc, desc, eq, inArray, like, or, sql, type SQL } from "drizzle-orm";
import type { AnySQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";
import type { ActivityService } from "../activity/service.js";
import type { ClaimService } from "../claims/service.js";
import type { ContextService } from "../context/service.js";
import type { DecisionService } from "../decisions/service.js";
import { nextKey } from "../ids.js";
import type { LinkService } from "../links/service.js";
import { queryLinks } from "../links/repository.js";
import { queryDecisions } from "../decisions/repository.js";
import { requireProject } from "../refs.js";
import type { Runtime } from "../runtime.js";
import { addDependency } from "../tasks/dependencies.js";
import type { TaskService } from "../tasks/service.js";
import { toProjectSummary } from "./repository.js";

export type ProjectService = ReturnType<typeof createProjectService>;

export function createProjectService(
  runtime: Runtime,
  activity: ActivityService,
  contexts: ContextService,
  taskService: TaskService,
  claims: ClaimService,
  decisionService: DecisionService,
  linkService: LinkService,
) {
  function summarise(row: ProjectRow): ProjectSummary {
    return toProjectSummary(runtime, activity, row);
  }

  function createProject(input: CreateProjectInput): ProjectSummary {
    return runtime.tx(() => {
      const now = runtime.now();
      const inserted = runtime.db
        .insert(projects)
        .values({
          id: runtime.newId(),
          key: nextKey(runtime, "project"),
          name: input.name,
          objective: input.objective ?? null,
          description: input.description ?? null,
          context: input.context ?? null,
          status: input.status ?? "active",
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .get();
      const row = contexts.initialiseProject(inserted, {
        actor: input.actor,
        sessionId: input.sessionId,
        reason: "Initial project context.",
      });

      activity.record({
        projectId: row.id,
        eventType: "project.created",
        actor: input.actor,
        sessionId: input.sessionId,
        payload: {
          name: row.name,
          ...(row.objective ? { objective: row.objective } : {}),
          ...(row.context ? { contextLength: row.context.length } : {}),
        },
      });

      return summarise(row);
    });
  }

  return {
    summarise,
    create: createProject,

    list(query: ListProjectsQuery): ProjectListPage {
      const conditions: SQL[] = [];
      if (query.status?.length) conditions.push(inArray(projects.status, query.status));
      if (query.search) {
        const pattern = `%${query.search}%`;
        const search = or(
          like(projects.name, pattern),
          like(projects.objective, pattern),
          like(projects.description, pattern),
          like(projects.key, pattern),
        );
        if (search) conditions.push(search);
      }
      const where = conditions.length ? and(...conditions) : undefined;

      const order =
        query.sort === "updated_at_asc"
          ? asc(projects.updatedAt)
          : query.sort === "created_at_desc"
            ? desc(projects.createdAt)
            : query.sort === "name_asc"
              ? asc(projects.name)
              : desc(projects.updatedAt);

      const total = Number(
        runtime.db
          .select({ total: sql<number>`count(*)` })
          .from(projects)
          .where(where)
          .get()?.total ?? 0,
      );

      const rows = runtime.db
        .select()
        .from(projects)
        .where(where)
        .orderBy(order)
        .limit(query.limit)
        .offset(query.offset)
        .all();

      return {
        projects: rows.map(summarise),
        total,
        limit: query.limit,
        offset: query.offset,
      };
    },

    get(projectRef: string): ProjectDetail {
      return runtime.tx(() => {
        const row = requireProject(runtime, projectRef);
        return {
          ...summarise(row),
          decisions: queryDecisions(runtime, { projectId: row.id, limit: 20 }),
          links: queryLinks(runtime, { projectId: row.id }),
          recentActivity: activity.recentForProject(row.id, 20),
        };
      });
    },

    update(projectRef: string, input: UpdateProjectInput): ProjectSummary {
      return runtime.tx(() => {
        const project = requireProject(runtime, projectRef);
        const changes: Partial<ProjectRow> = {};
        const changed: Record<string, unknown> = {};

        if (input.name !== undefined && input.name !== project.name) {
          changes.name = input.name;
          changed.name = input.name;
        }
        if (input.objective !== undefined && (input.objective ?? null) !== project.objective) {
          changes.objective = input.objective ?? null;
          changed.objective = input.objective ?? null;
        }
        if (input.description !== undefined && (input.description ?? null) !== project.description) {
          changes.description = input.description ?? null;
          changed.description = true;
        }
        if (input.status !== undefined && input.status !== project.status) {
          changes.status = input.status;
          changes.archivedAt = input.status === "archived" ? runtime.now() : null;
          changed.status = input.status;
        }

        if (Object.keys(changes).length === 0) return summarise(project);

        const updated = runtime.db
          .update(projects)
          .set({ ...changes, updatedAt: runtime.now() })
          .where(eq(projects.id, project.id))
          .returning()
          .get();

        activity.record({
          projectId: project.id,
          eventType: input.status === "archived" ? "project.archived" : "project.updated",
          actor: input.actor,
          sessionId: input.sessionId,
          payload: { changed },
        });

        return summarise(updated);
      });
    },

    updateContext(projectRef: string, input: UpdateProjectContextInput): ProjectSummary {
      return summarise(contexts.replaceProject(projectRef, input));
    },

    archive(projectRef: string, input: ArchiveProjectInput = {}): ProjectSummary {
      return runtime.tx(() => {
        const project = requireProject(runtime, projectRef);
        if (project.status === "archived") return summarise(project);

        const now = runtime.now();
        const updated = runtime.db
          .update(projects)
          .set({ status: "archived", archivedAt: now, updatedAt: now })
          .where(eq(projects.id, project.id))
          .returning()
          .get();

        activity.record({
          projectId: project.id,
          eventType: "project.archived",
          actor: input.actor,
          sessionId: input.sessionId,
          payload: { previousStatus: project.status },
        });

        return summarise(updated);
      });
    },

    /**
     * Permanently removes a project and everything it owns: every task and everything
     * each task owns (acceptance criteria, progress, blockers, claims, dependency
     * edges), plus the project's own decisions, links and activity history. Foreign
     * keys cascade from `projects`, so the single row delete below does the rest.
     *
     * Unlike task deletion, a project has no surviving parent scope, so nothing about
     * the deletion is recorded in the workspace's own queryable activity — there is
     * nowhere left to attach that event. See DEC-0008 for the reasoning and the
     * process-log line written just before the row goes.
     *
     * A project may be deleted regardless of status (active, paused, completed or
     * archived) — archiving first is not required, matching how task deletion imposes
     * no status precondition either. The only structural guard is claimed work: any
     * task in the project with an active claim blocks deletion unless `force` is true.
     */
    delete(projectRef: string, input: DeleteProjectInput = { force: false }): DeletedProject {
      return runtime.tx(() => {
        const project = requireProject(runtime, projectRef);

        const taskIds = runtime.db
          .select({ id: tasks.id })
          .from(tasks)
          .where(eq(tasks.projectId, project.id))
          .all()
          .map((row) => row.id);
        const repositoryIds = runtime.db
          .select({ id: repositories.id })
          .from(repositories)
          .where(eq(repositories.projectId, project.id))
          .all()
          .map((row) => row.id);

        if (taskIds.length > 0) {
          const activeClaims = claims.activeForMany(taskIds);
          if (activeClaims.size > 0 && !input.force) {
            const claimants = [...new Set([...activeClaims.values()].map((claim) => claim.actor))];
            throw new AgentContinuityError(
              "PROJECT_HAS_CLAIMED_TASKS",
              `${project.key} has ${activeClaims.size} actively claimed ${
                activeClaims.size === 1 ? "task" : "tasks"
              } (held by ${claimants.join(", ")}). Deleting it would discard work in progress — ` +
                "release the claims, or pass force.",
              { project: project.key, claimedTasks: activeClaims.size, claimants },
            );
          }
        }

        const countWhereIn = (table: SQLiteTable, column: AnySQLiteColumn, ids: string[]): number => {
          if (ids.length === 0) return 0;
          return Number(
            runtime.db
              .select({ total: sql<number>`count(*)` })
              .from(table)
              .where(inArray(column, ids))
              .get()?.total ?? 0,
          );
        };

        const countForProject = (table: SQLiteTable, column: AnySQLiteColumn): number =>
          Number(
            runtime.db
              .select({ total: sql<number>`count(*)` })
              .from(table)
              .where(eq(column, project.id))
              .get()?.total ?? 0,
          );

        const removed: DeletedProject["removed"] = {
          tasks: taskIds.length,
          acceptanceCriteria: countWhereIn(acceptanceCriteria, acceptanceCriteria.taskId, taskIds),
          progress: countWhereIn(taskProgress, taskProgress.taskId, taskIds),
          blockers: countWhereIn(blockers, blockers.taskId, taskIds),
          claims: countWhereIn(taskClaims, taskClaims.taskId, taskIds),
          dependencies: countWhereIn(taskDependencies, taskDependencies.taskId, taskIds),
          decisions: countForProject(decisions, decisions.projectId),
          links: countForProject(links, links.projectId),
          activityEvents: countForProject(activityEvents, activityEvents.projectId),
          repositories: repositoryIds.length,
          executionWorktrees: countWhereIn(
            executionWorktrees,
            executionWorktrees.repositoryId,
            repositoryIds,
          ),
        };

        const summary: DeletedProject = {
          id: project.id,
          key: project.key,
          name: project.name,
          removed,
        };

        // No project-scoped home survives for a project.deleted event, so this process
        // log line is the only trace left once the transaction below commits.
        console.error(
          `[agent-continuity] project deleted: ${project.key} "${project.name}" actor=` +
            `${input.actor ?? "unknown"}${input.sessionId ? ` session=${input.sessionId}` : ""} ` +
            `removed=${JSON.stringify(removed)}`,
        );

        runtime.db.delete(projects).where(eq(projects.id, project.id)).run();
        return summary;
      });
    },

    /**
     * Turns a plan into a complete project in a single transaction: project, tasks,
     * acceptance criteria, dependencies, decisions and links all commit together or
     * not at all. Temporary `ref` values only exist inside the request.
     */
    bootstrap(request: BootstrapProjectRequest): BootstrapResult {
      return runtime.tx(() => {
        const meta = { actor: request.actor, sessionId: request.sessionId };
        const project = createProject({
          name: request.name,
          objective: request.objective ?? null,
          description: request.description ?? null,
          context: request.context ?? null,
          ...meta,
        });

        const projectRow = requireProject(runtime, project.id);
        const refMap = new Map<string, TaskRow>();
        const created: TaskRow[] = [];

        for (const [index, task] of (request.tasks ?? []).entries()) {
          const row = taskService.insertTask(
            projectRow,
            {
              title: task.title,
              description: task.description ?? null,
              context: task.context ?? null,
              status: task.status ?? "backlog",
              priority: task.priority ?? "normal",
              sortOrder: (index + 1) * 1000,
              ...(task.acceptanceCriteria ? { acceptanceCriteria: task.acceptanceCriteria } : {}),
            },
            meta,
          );
          created.push(row);
          if (task.ref) {
            if (refMap.has(task.ref)) {
              throw new AgentContinuityError(
                "INVALID_BOOTSTRAP_REFERENCE",
                `Duplicate task ref "${task.ref}" in bootstrap request.`,
                { ref: task.ref },
              );
            }
            refMap.set(task.ref, row);
          }
        }

        const resolveRef = (ref: string, field: string): TaskRow => {
          const row = refMap.get(ref);
          if (!row) {
            throw new AgentContinuityError(
              "INVALID_BOOTSTRAP_REFERENCE",
              `${field} references unknown task ref "${ref}".`,
              { ref, field, knownRefs: [...refMap.keys()] },
            );
          }
          return row;
        };

        (request.tasks ?? []).forEach((task, index) => {
          const row = created[index];
          if (!row) return;

          if (task.parentRef) {
            const parent = resolveRef(task.parentRef, "parentRef");
            runtime.db
              .update(tasks)
              .set({ parentTaskId: parent.id })
              .where(eq(tasks.id, row.id))
              .run();
          }

          for (const dependsOnRef of task.dependsOn ?? []) {
            addDependency(runtime, activity, row, resolveRef(dependsOnRef, "dependsOn"), meta);
          }

          for (const link of task.links ?? []) {
            linkService.add(projectRow.id, {
              task: row.id,
              type: link.type,
              provider: link.provider ?? null,
              reference: link.reference ?? null,
              url: link.url ?? null,
              metadata: link.metadata ?? null,
              ...meta,
            });
          }
        });

        const decisions = (request.decisions ?? []).map((decision) =>
          decisionService.create(projectRow.id, {
            title: decision.title,
            decision: decision.decision,
            rationale: decision.rationale ?? null,
            task: decision.taskRef ? resolveRef(decision.taskRef, "taskRef").id : null,
            ...meta,
          }),
        );

        const projectLinks = (request.links ?? []).flatMap((link) =>
          linkService.add(projectRow.id, {
            task: link.taskRef ? resolveRef(link.taskRef, "taskRef").id : null,
            type: link.type,
            provider: link.provider ?? null,
            reference: link.reference ?? null,
            url: link.url ?? null,
            metadata: link.metadata ?? null,
            ...meta,
          }),
        );

        const taskRows = created.map(
          (row) => runtime.db.select().from(tasks).where(eq(tasks.id, row.id)).get() ?? row,
        );

        return {
          project: summarise(requireProject(runtime, projectRow.id)),
          tasks: taskService.summariseAll(taskRows),
          decisions,
          links: projectLinks,
          refMap: Object.fromEntries(
            [...refMap.entries()].map(([ref, row]) => [ref, row.key]),
          ),
        };
      });
    },
  };
}
