import {
  AgentContinuityError,
  type BindExecutionWorktreeInput,
  type CreateRepositoryInput,
  type ExecutionWorktree,
  type ExecutionWorktreeSummary,
  type ProjectRepository,
  type RemovedProjectRepository,
  type RemoveRepositoryInput,
  type UnbindExecutionWorktreeInput,
  type UpdateRepositoryInput,
} from "@agent-continuity/contracts";
import {
  executionWorktrees,
  executionGitBaselines,
  projects,
  repositories,
  taskExecutions,
  type ExecutionWorktreeRow,
  type RepositoryRow,
} from "@agent-continuity/database";
import { and, asc, desc, eq, ne } from "drizzle-orm";
import type { ActivityService } from "../activity/service.js";
import { nextKey } from "../ids.js";
import {
  requireProject,
  requireRepository,
  requireTask,
  requireWritableProject,
} from "../refs.js";
import type { Runtime } from "../runtime.js";
import { RepositoryPathResolver } from "./paths.js";

export type RepositoryService = ReturnType<typeof createRepositoryService>;

function normalizeRemoteUrl(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

export function createRepositoryService(
  runtime: Runtime,
  activity: ActivityService,
  paths: RepositoryPathResolver,
) {
  function repositoryDto(row: RepositoryRow, projectKey?: string): ProjectRepository {
    const owningProject = projectKey ?? requireProject(runtime, row.projectId).key;
    return {
      id: row.id,
      key: row.key,
      projectId: row.projectId,
      projectKey: owningProject,
      label: row.label,
      rootPath: row.canonicalRootPath,
      remoteUrl: row.remoteUrl,
      primary: Boolean(row.isPrimary),
      availability: paths.availability(row.canonicalRootPath),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  function scopedRepository(projectRef: string, repositoryRef: string): {
    project: ReturnType<typeof requireProject>;
    repository: RepositoryRow;
  } {
    const project = requireProject(runtime, projectRef);
    const repository = requireRepository(runtime, repositoryRef);
    if (repository.projectId !== project.id) {
      throw new AgentContinuityError(
        "REPOSITORY_NOT_FOUND",
        `${repositoryRef} is not associated with ${project.key}.`,
        { project: project.key, repository: repositoryRef },
      );
    }
    return { project, repository };
  }

  function duplicateFor(projectId: string, comparisonKey: string, exceptId?: string) {
    return runtime.db
      .select()
      .from(repositories)
      .where(
        and(
          eq(repositories.projectId, projectId),
          eq(repositories.canonicalRootPathKey, comparisonKey),
          ...(exceptId ? [ne(repositories.id, exceptId)] : []),
        ),
      )
      .get();
  }

  function assertExecutionOwner(
    execution: typeof taskExecutions.$inferSelect,
    input: { actor: string; sessionId?: string },
  ): void {
    const sessionMismatch =
      execution.sessionId !== null && execution.sessionId !== (input.sessionId ?? null);
    if (execution.actor !== input.actor || sessionMismatch) {
      throw new AgentContinuityError(
        "EXECUTION_OWNERSHIP_MISMATCH",
        "The running execution belongs to another actor or session.",
        {
          actor: execution.actor,
          sessionId: execution.sessionId,
        },
      );
    }
  }

  function worktreeRow(executionId: string): ExecutionWorktreeRow | undefined {
    return runtime.db
      .select()
      .from(executionWorktrees)
      .where(eq(executionWorktrees.executionId, executionId))
      .get();
  }

  function worktreeSummaryFromRow(
    row: ExecutionWorktreeRow,
    taskId: string,
  ): ExecutionWorktreeSummary {
    const repository = requireRepository(runtime, row.repositoryId);
    return {
      id: row.id,
      executionId: row.executionId,
      taskId,
      repositoryId: repository.id,
      repositoryKey: repository.key,
      repositoryLabel: repository.label,
      branch: row.branch,
      availability: paths.availability(row.worktreePath),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  function worktreeDetailFromRow(row: ExecutionWorktreeRow, taskId: string): ExecutionWorktree {
    const summary = worktreeSummaryFromRow(row, taskId);
    const repository = requireRepository(runtime, row.repositoryId);
    return {
      ...summary,
      worktreePath: row.worktreePath,
      relativePath: paths.relativePath(repository.canonicalRootPath, row.worktreePath),
    };
  }

  return {
    create(projectRef: string, input: CreateRepositoryInput): ProjectRepository {
      const canonical = paths.canonicalDirectory(input.rootPath, "repository root");
      return runtime.tx(() => {
        const project = requireWritableProject(runtime, projectRef);
        const duplicate = duplicateFor(project.id, canonical.comparisonKey);
        if (duplicate) {
          throw new AgentContinuityError(
            "REPOSITORY_ALREADY_ASSOCIATED",
            `${project.key} is already associated with this canonical repository root as ${duplicate.key}.`,
            { project: project.key, repository: duplicate.key },
          );
        }

        const existing = runtime.db
          .select({ id: repositories.id })
          .from(repositories)
          .where(eq(repositories.projectId, project.id))
          .all();
        const primary = existing.length === 0 || input.primary === true;
        if (primary && existing.length > 0) {
          runtime.db
            .update(repositories)
            .set({ isPrimary: 0, updatedAt: runtime.now() })
            .where(eq(repositories.projectId, project.id))
            .run();
        }

        const now = runtime.now();
        const row = runtime.db
          .insert(repositories)
          .values({
            id: runtime.newId(),
            key: nextKey(runtime, "repository"),
            projectId: project.id,
            label: input.label,
            canonicalRootPath: canonical.path,
            canonicalRootPathKey: canonical.comparisonKey,
            remoteUrl: normalizeRemoteUrl(input.remoteUrl),
            isPrimary: primary ? 1 : 0,
            createdAt: now,
            updatedAt: now,
          })
          .returning()
          .get();

        runtime.db.update(projects).set({ updatedAt: now }).where(eq(projects.id, project.id)).run();
        activity.record({
          projectId: project.id,
          eventType: "repository.associated",
          actor: input.actor,
          sessionId: input.sessionId,
          payload: { repository: row.key, label: row.label, primary },
        });
        return repositoryDto(row, project.key);
      });
    },

    list(projectRef: string): ProjectRepository[] {
      const project = requireProject(runtime, projectRef);
      return runtime.db
        .select()
        .from(repositories)
        .where(eq(repositories.projectId, project.id))
        .orderBy(asc(repositories.createdAt))
        .all()
        .map((row) => repositoryDto(row, project.key));
    },

    get(projectRef: string, repositoryRef: string): ProjectRepository {
      const { project, repository } = scopedRepository(projectRef, repositoryRef);
      return repositoryDto(repository, project.key);
    },

    update(
      projectRef: string,
      repositoryRef: string,
      input: UpdateRepositoryInput,
    ): ProjectRepository {
      const canonical = input.rootPath
        ? paths.canonicalDirectory(input.rootPath, "repository root")
        : null;
      return runtime.tx(() => {
        const project = requireWritableProject(runtime, projectRef);
        const scoped = scopedRepository(project.id, repositoryRef).repository;
        if (canonical) {
          const duplicate = duplicateFor(project.id, canonical.comparisonKey, scoped.id);
          if (duplicate) {
            throw new AgentContinuityError(
              "REPOSITORY_ALREADY_ASSOCIATED",
              `${project.key} is already associated with this canonical repository root as ${duplicate.key}.`,
              { project: project.key, repository: duplicate.key },
            );
          }
        }

        if (input.primary) {
          runtime.db
            .update(repositories)
            .set({ isPrimary: 0, updatedAt: runtime.now() })
            .where(and(eq(repositories.projectId, project.id), ne(repositories.id, scoped.id)))
            .run();
        }

        const changed =
          input.label !== undefined ||
          input.remoteUrl !== undefined ||
          canonical !== null ||
          input.primary === true;
        if (!changed) return repositoryDto(scoped, project.key);

        const now = runtime.now();
        const updated = runtime.db
          .update(repositories)
          .set({
            ...(input.label !== undefined ? { label: input.label } : {}),
            ...(input.remoteUrl !== undefined
              ? { remoteUrl: normalizeRemoteUrl(input.remoteUrl) }
              : {}),
            ...(canonical
              ? {
                  canonicalRootPath: canonical.path,
                  canonicalRootPathKey: canonical.comparisonKey,
                }
              : {}),
            ...(input.primary ? { isPrimary: 1 } : {}),
            updatedAt: now,
          })
          .where(eq(repositories.id, scoped.id))
          .returning()
          .get();

        runtime.db.update(projects).set({ updatedAt: now }).where(eq(projects.id, project.id)).run();
        activity.record({
          projectId: project.id,
          eventType: "repository.updated",
          actor: input.actor,
          sessionId: input.sessionId,
          payload: {
            repository: updated.key,
            changed: {
              ...(input.label !== undefined ? { label: true } : {}),
              ...(input.remoteUrl !== undefined ? { remoteUrl: true } : {}),
              ...(canonical ? { rootPath: true } : {}),
              ...(input.primary ? { primary: true } : {}),
            },
          },
        });
        return repositoryDto(updated, project.key);
      });
    },

    remove(
      projectRef: string,
      repositoryRef: string,
      input: RemoveRepositoryInput,
    ): RemovedProjectRepository {
      return runtime.tx(() => {
        const project = requireWritableProject(runtime, projectRef);
        const repository = scopedRepository(project.id, repositoryRef).repository;
        const bindings = runtime.db
          .select({
            id: executionWorktrees.id,
            status: taskExecutions.status,
          })
          .from(executionWorktrees)
          .innerJoin(taskExecutions, eq(taskExecutions.id, executionWorktrees.executionId))
          .where(eq(executionWorktrees.repositoryId, repository.id))
          .all();
        const running = bindings.filter((binding) => binding.status === "running");

        if (running.length > 0) {
          throw new AgentContinuityError(
            "REPOSITORY_IN_USE",
            `${repository.key} is bound to ${running.length} running execution${
              running.length === 1 ? "" : "s"
            } and cannot be removed.`,
            { repository: repository.key, runningExecutions: running.length },
          );
        }
        if (bindings.length > 0 && !input.force) {
          throw new AgentContinuityError(
            "REPOSITORY_IN_USE",
            `${repository.key} is preserved by ${bindings.length} ended execution${
              bindings.length === 1 ? "" : "s"
            }. Pass force to explicitly remove those historical bindings.`,
            { repository: repository.key, endedExecutions: bindings.length },
          );
        }

        if (bindings.length > 0) {
          runtime.db
            .delete(executionWorktrees)
            .where(eq(executionWorktrees.repositoryId, repository.id))
            .run();
        }
        runtime.db.delete(repositories).where(eq(repositories.id, repository.id)).run();

        if (repository.isPrimary) {
          const replacement = runtime.db
            .select()
            .from(repositories)
            .where(eq(repositories.projectId, project.id))
            .orderBy(asc(repositories.createdAt))
            .get();
          if (replacement) {
            runtime.db
              .update(repositories)
              .set({ isPrimary: 1, updatedAt: runtime.now() })
              .where(eq(repositories.id, replacement.id))
              .run();
          }
        }

        runtime.db
          .update(projects)
          .set({ updatedAt: runtime.now() })
          .where(eq(projects.id, project.id))
          .run();
        activity.record({
          projectId: project.id,
          eventType: "repository.removed",
          actor: input.actor,
          sessionId: input.sessionId,
          payload: { repository: repository.key, removedWorktreeBindings: bindings.length },
        });
        return {
          id: repository.id,
          key: repository.key,
          projectKey: project.key,
          label: repository.label,
          removedWorktreeBindings: bindings.length,
        };
      });
    },

    worktreeSummary(executionId: string, taskId: string): ExecutionWorktreeSummary | null {
      const row = worktreeRow(executionId);
      return row ? worktreeSummaryFromRow(row, taskId) : null;
    },

    /**
     * Trusted local execution adapters use this explicit binding to select a cwd.
     * It never falls back to process cwd and is not exposed by ordinary task reads.
     */
    worktreeForExecution(executionId: string): ExecutionWorktree | null {
      const execution = runtime.db
        .select()
        .from(taskExecutions)
        .where(eq(taskExecutions.id, executionId))
        .get();
      if (!execution) return null;
      const row = worktreeRow(execution.id);
      return row ? worktreeDetailFromRow(row, execution.taskId) : null;
    },

    worktree(taskRef: string): ExecutionWorktree {
      const task = requireTask(runtime, taskRef);
      const execution = runtime.db
        .select()
        .from(taskExecutions)
        .where(and(eq(taskExecutions.taskId, task.id), eq(taskExecutions.status, "running")))
        .orderBy(desc(taskExecutions.startedAt))
        .get();
      if (!execution) {
        throw new AgentContinuityError(
          "EXECUTION_NOT_RUNNING",
          `${task.key} has no running execution to inspect.`,
          { task: task.key },
        );
      }
      const row = worktreeRow(execution.id);
      if (!row) {
        throw new AgentContinuityError(
          "EXECUTION_WORKTREE_NOT_BOUND",
          `${task.key}'s running execution has no worktree association.`,
          { task: task.key, executionId: execution.id },
        );
      }
      return worktreeDetailFromRow(row, task.id);
    },

    bindWorktree(taskRef: string, input: BindExecutionWorktreeInput): ExecutionWorktree {
      const canonical = paths.canonicalDirectory(input.worktreePath, "execution worktree");
      return runtime.tx(() => {
        const task = requireTask(runtime, taskRef);
        requireWritableProject(runtime, task.projectId);
        const execution = runtime.db
          .select()
          .from(taskExecutions)
          .where(and(eq(taskExecutions.taskId, task.id), eq(taskExecutions.status, "running")))
          .get();
        if (!execution) {
          throw new AgentContinuityError(
            "EXECUTION_NOT_RUNNING",
            `${task.key} must be claimed before a worktree can be bound.`,
            { task: task.key },
          );
        }
        assertExecutionOwner(execution, input);

        const repository = requireRepository(runtime, input.repository);
        if (repository.projectId !== task.projectId) {
          const project = requireProject(runtime, task.projectId);
          throw new AgentContinuityError(
            "REPOSITORY_NOT_FOUND",
            `${input.repository} is not associated with ${project.key}.`,
            { repository: input.repository, project: project.key },
          );
        }

        const now = runtime.now();
        const existing = worktreeRow(execution.id);
        const baseline = existing
          ? runtime.db
              .select()
              .from(executionGitBaselines)
              .where(eq(executionGitBaselines.worktreeId, existing.id))
              .get()
          : null;
        if (
          baseline &&
          (existing!.repositoryId !== repository.id ||
            existing!.worktreePathKey !== canonical.comparisonKey)
        ) {
          throw new AgentContinuityError(
            "GIT_PROVENANCE_MISMATCH",
            "An execution with a captured Git baseline cannot be rebound to a different repository or worktree path.",
            { task: task.key, executionId: execution.id, baselineId: baseline.id },
          );
        }
        const row = existing
          ? runtime.db
              .update(executionWorktrees)
              .set({
                repositoryId: repository.id,
                worktreePath: canonical.path,
                worktreePathKey: canonical.comparisonKey,
                branch: input.branch?.trim() || null,
                updatedAt: now,
              })
              .where(eq(executionWorktrees.id, existing.id))
              .returning()
              .get()
          : runtime.db
              .insert(executionWorktrees)
              .values({
                id: runtime.newId(),
                executionId: execution.id,
                repositoryId: repository.id,
                worktreePath: canonical.path,
                worktreePathKey: canonical.comparisonKey,
                branch: input.branch?.trim() || null,
                createdAt: now,
                updatedAt: now,
              })
              .returning()
              .get();

        activity.record({
          projectId: task.projectId,
          taskId: task.id,
          eventType: "execution.worktree_bound",
          actor: input.actor,
          sessionId: input.sessionId,
          payload: {
            executionId: execution.id,
            repository: repository.key,
            ...(row.branch ? { branch: row.branch } : {}),
          },
        });
        return worktreeDetailFromRow(row, task.id);
      });
    },

    unbindWorktree(
      taskRef: string,
      input: UnbindExecutionWorktreeInput,
    ): ExecutionWorktree {
      return runtime.tx(() => {
        const task = requireTask(runtime, taskRef);
        requireWritableProject(runtime, task.projectId);
        const execution = runtime.db
          .select()
          .from(taskExecutions)
          .where(and(eq(taskExecutions.taskId, task.id), eq(taskExecutions.status, "running")))
          .get();
        if (!execution) {
          throw new AgentContinuityError(
            "EXECUTION_NOT_RUNNING",
            `${task.key} has no running execution to detach.`,
            { task: task.key },
          );
        }
        assertExecutionOwner(execution, input);
        const row = worktreeRow(execution.id);
        if (!row) {
          throw new AgentContinuityError(
            "EXECUTION_WORKTREE_NOT_BOUND",
            `${task.key}'s running execution has no worktree association.`,
            { task: task.key, executionId: execution.id },
          );
        }
        const detail = worktreeDetailFromRow(row, task.id);
        runtime.db.delete(executionWorktrees).where(eq(executionWorktrees.id, row.id)).run();
        activity.record({
          projectId: task.projectId,
          taskId: task.id,
          eventType: "execution.worktree_unbound",
          actor: input.actor,
          sessionId: input.sessionId,
          payload: { executionId: execution.id, repository: detail.repositoryKey },
        });
        return detail;
      });
    },
  };
}
