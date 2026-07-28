import {
  AgentContinuityError,
  type GitCaptureError,
  type GitProvenanceBaseline,
  type GitProvenanceSnapshot,
  type GitProvenanceState,
  type GitTouchedPath,
  type RecordGitBaselineInput,
  type RecordGitSnapshotInput,
  recordGitBaselineSchema,
  recordGitSnapshotSchema,
} from "@agent-continuity/contracts";
import {
  executionGitBaselines,
  executionGitSnapshots,
  executionGitTouchedPaths,
  executionWorktrees,
  repositories,
  taskCheckpoints,
  taskExecutions,
  type ExecutionGitBaselineRow,
  type ExecutionGitSnapshotRow,
} from "@agent-continuity/database";
import { and, asc, desc, eq } from "drizzle-orm";
import type { ActivityService } from "../activity/service.js";
import { requireRepository, requireTask, requireWritableProject } from "../refs.js";
import type { Runtime } from "../runtime.js";

export type GitProvenanceService = ReturnType<typeof createGitProvenanceService>;

function parseCommitShas(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return [];
  }
}

function captureError(row: {
  errorCode: string | null;
  errorMessage: string | null;
}): GitCaptureError | null {
  if (!row.errorCode || !row.errorMessage) return null;
  return {
    code: row.errorCode as GitCaptureError["code"],
    message: row.errorMessage,
  };
}

export function createGitProvenanceService(runtime: Runtime, activity: ActivityService) {
  function validated<T>(
    result:
      | ReturnType<typeof recordGitBaselineSchema.safeParse>
      | ReturnType<typeof recordGitSnapshotSchema.safeParse>,
  ): T {
    if (result.success) return result.data as T;
    throw new AgentContinuityError(
      "VALIDATION_ERROR",
      "Invalid structured Git provenance payload.",
      {
        issues: result.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
    );
  }

  function touchedPaths(snapshotId: string): GitTouchedPath[] {
    return runtime.db
      .select()
      .from(executionGitTouchedPaths)
      .where(eq(executionGitTouchedPaths.snapshotId, snapshotId))
      .orderBy(asc(executionGitTouchedPaths.path), asc(executionGitTouchedPaths.id))
      .all()
      .map((row) => ({
        id: row.id,
        snapshotId: row.snapshotId,
        path: row.path,
        previousPath: row.previousPath,
        change: row.changeKind as GitTouchedPath["change"],
        additions: row.additions,
        deletions: row.deletions,
      }));
  }

  function baselineDto(row: ExecutionGitBaselineRow): GitProvenanceBaseline {
    const repository = requireRepository(runtime, row.repositoryId);
    return {
      id: row.id,
      executionId: row.executionId,
      worktreeId: row.worktreeId,
      repositoryId: row.repositoryId,
      repositoryKey: repository.key,
      repositoryLabel: repository.label,
      source: "local_git",
      status: row.status as GitProvenanceBaseline["status"],
      branch: row.branch,
      detached: Boolean(row.detached),
      headSha: row.headSha,
      dirty: row.dirty === null ? null : Boolean(row.dirty),
      error: captureError(row),
      capturedAt: row.capturedAt,
    };
  }

  function snapshotDto(row: ExecutionGitSnapshotRow): GitProvenanceSnapshot {
    return {
      id: row.id,
      baselineId: row.baselineId,
      executionId: row.executionId,
      sequence: row.sequence,
      checkpointId: row.checkpointId,
      trigger: row.trigger as GitProvenanceSnapshot["trigger"],
      source: "local_git",
      status: row.status as GitProvenanceSnapshot["status"],
      branch: row.branch,
      detached: Boolean(row.detached),
      headSha: row.headSha,
      dirty: row.dirty === null ? null : Boolean(row.dirty),
      commitShas: parseCommitShas(row.commitShasJson),
      additions: row.additions,
      deletions: row.deletions,
      filesChanged: row.filesChanged,
      touchedPaths: touchedPaths(row.id),
      error: captureError(row),
      capturedAt: row.capturedAt,
    };
  }

  function validateBinding(
    taskRef: string,
    identity: { executionId: string; worktreeId: string; repositoryId: string },
  ) {
    const task = requireTask(runtime, taskRef);
    requireWritableProject(runtime, task.projectId);
    const execution = runtime.db
      .select()
      .from(taskExecutions)
      .where(eq(taskExecutions.id, identity.executionId))
      .get();
    const worktree = runtime.db
      .select()
      .from(executionWorktrees)
      .where(eq(executionWorktrees.id, identity.worktreeId))
      .get();
    const repository = runtime.db
      .select()
      .from(repositories)
      .where(eq(repositories.id, identity.repositoryId))
      .get();

    if (
      !execution ||
      execution.taskId !== task.id ||
      !worktree ||
      worktree.executionId !== execution.id ||
      worktree.repositoryId !== identity.repositoryId ||
      !repository ||
      repository.projectId !== task.projectId
    ) {
      throw new AgentContinuityError(
        "GIT_PROVENANCE_MISMATCH",
        "Git provenance does not match the task execution's explicit repository/worktree binding.",
        {
          task: task.key,
          executionId: identity.executionId,
          worktreeId: identity.worktreeId,
          repositoryId: identity.repositoryId,
        },
      );
    }
    return { task, execution, worktree, repository };
  }

  function baselineRow(executionId: string): ExecutionGitBaselineRow | undefined {
    return runtime.db
      .select()
      .from(executionGitBaselines)
      .where(eq(executionGitBaselines.executionId, executionId))
      .get();
  }

  function provenanceForExecution(executionId: string): GitProvenanceState | null {
    const baseline = baselineRow(executionId);
    if (!baseline) return null;
    const snapshots = runtime.db
      .select()
      .from(executionGitSnapshots)
      .where(eq(executionGitSnapshots.executionId, executionId))
      .orderBy(asc(executionGitSnapshots.sequence))
      .all()
      .map(snapshotDto);
    return { baseline: baselineDto(baseline), snapshots };
  }

  return {
    baselineForExecution(executionId: string): GitProvenanceBaseline | null {
      const row = baselineRow(executionId);
      return row ? baselineDto(row) : null;
    },

    forExecution(executionId: string): GitProvenanceState | null {
      return provenanceForExecution(executionId);
    },

    forTask(taskRef: string): GitProvenanceState | null {
      const task = requireTask(runtime, taskRef);
      const execution = runtime.db
        .select()
        .from(taskExecutions)
        .where(eq(taskExecutions.taskId, task.id))
        .orderBy(desc(taskExecutions.startedAt))
        .all()
        .find((row) => baselineRow(row.id) !== undefined);
      return execution ? provenanceForExecution(execution.id) : null;
    },

    recordBaseline(taskRef: string, input: RecordGitBaselineInput): GitProvenanceBaseline {
      return runtime.tx(() => {
        const payload = validated<RecordGitBaselineInput>(
          recordGitBaselineSchema.safeParse(input),
        );
        const { task, worktree } = validateBinding(taskRef, payload);
        const existing = baselineRow(payload.executionId);
        if (existing) {
          if (
            existing.worktreeId !== payload.worktreeId ||
            existing.repositoryId !== payload.repositoryId ||
            existing.worktreePathKey !== worktree.worktreePathKey
          ) {
            throw new AgentContinuityError(
              "GIT_PROVENANCE_MISMATCH",
              "The execution already has a baseline for a different worktree binding.",
              { task: task.key, baselineId: existing.id },
            );
          }
          return baselineDto(existing);
        }

        const inspection = payload.inspection;
        const row = runtime.db
          .insert(executionGitBaselines)
          .values({
            id: runtime.newId(),
            executionId: payload.executionId,
            worktreeId: payload.worktreeId,
            repositoryId: payload.repositoryId,
            worktreePathKey: worktree.worktreePathKey,
            source: payload.source,
            status: inspection.status,
            branch: inspection.branch,
            detached: inspection.detached ? 1 : 0,
            headSha: inspection.headSha,
            dirty: inspection.dirty === null ? null : inspection.dirty ? 1 : 0,
            errorCode: inspection.error?.code ?? null,
            errorMessage: inspection.error?.message ?? null,
            capturedAt: runtime.now(),
          })
          .returning()
          .get();
        activity.record({
          projectId: task.projectId,
          taskId: task.id,
          eventType: "execution.git_baseline_captured",
          payload: {
            executionId: payload.executionId,
            baselineId: row.id,
            repository: requireRepository(runtime, payload.repositoryId).key,
            source: payload.source,
            status: inspection.status,
          },
        });
        return baselineDto(row);
      });
    },

    recordSnapshot(taskRef: string, input: RecordGitSnapshotInput): GitProvenanceSnapshot {
      return runtime.tx(() => {
        const payload = validated<RecordGitSnapshotInput>(
          recordGitSnapshotSchema.safeParse(input),
        );
        const { task, worktree } = validateBinding(taskRef, payload);
        const baseline = runtime.db
          .select()
          .from(executionGitBaselines)
          .where(eq(executionGitBaselines.id, payload.baselineId))
          .get();
        if (
          !baseline ||
          baseline.executionId !== payload.executionId ||
          baseline.worktreeId !== payload.worktreeId ||
          baseline.repositoryId !== payload.repositoryId ||
          baseline.worktreePathKey !== worktree.worktreePathKey
        ) {
          throw new AgentContinuityError(
            "GIT_PROVENANCE_MISMATCH",
            "The Git snapshot does not match the execution baseline and worktree binding.",
            { task: task.key, baselineId: payload.baselineId },
          );
        }

        if (payload.checkpointId) {
          const checkpoint = runtime.db
            .select()
            .from(taskCheckpoints)
            .where(
              and(
                eq(taskCheckpoints.id, payload.checkpointId),
                eq(taskCheckpoints.taskId, task.id),
              ),
            )
            .get();
          if (!checkpoint || checkpoint.executionId !== payload.executionId) {
            throw new AgentContinuityError(
              "GIT_PROVENANCE_MISMATCH",
              "The Git snapshot checkpoint does not belong to this task execution.",
              { task: task.key, checkpointId: payload.checkpointId },
            );
          }
        }

        const inspection = payload.inspection;
        const sequence =
          Math.max(
            0,
            ...runtime.db
              .select({ sequence: executionGitSnapshots.sequence })
              .from(executionGitSnapshots)
              .where(eq(executionGitSnapshots.baselineId, baseline.id))
              .all()
              .map((entry) => entry.sequence),
          ) + 1;
        const row = runtime.db
          .insert(executionGitSnapshots)
          .values({
            id: runtime.newId(),
            baselineId: baseline.id,
            executionId: payload.executionId,
            sequence,
            checkpointId: payload.checkpointId ?? null,
            trigger: payload.trigger,
            source: payload.source,
            status: inspection.status,
            branch: inspection.branch,
            detached: inspection.detached ? 1 : 0,
            headSha: inspection.headSha,
            dirty: inspection.dirty === null ? null : inspection.dirty ? 1 : 0,
            commitShasJson: JSON.stringify(inspection.commitShas),
            additions: inspection.additions,
            deletions: inspection.deletions,
            filesChanged: inspection.filesChanged,
            errorCode: inspection.error?.code ?? null,
            errorMessage: inspection.error?.message ?? null,
            capturedAt: runtime.now(),
          })
          .returning()
          .get();
        for (const path of inspection.touchedPaths) {
          runtime.db
            .insert(executionGitTouchedPaths)
            .values({
              id: runtime.newId(),
              snapshotId: row.id,
              path: path.path,
              previousPath: path.previousPath ?? null,
              changeKind: path.change,
              additions: path.additions,
              deletions: path.deletions,
            })
            .run();
        }
        activity.record({
          projectId: task.projectId,
          taskId: task.id,
          eventType: "execution.git_snapshot_captured",
          payload: {
            executionId: payload.executionId,
            snapshotId: row.id,
            baselineId: baseline.id,
            source: payload.source,
            trigger: payload.trigger,
            status: inspection.status,
            filesChanged: inspection.filesChanged,
          },
        });
        return snapshotDto(row);
      });
    },
  };
}
