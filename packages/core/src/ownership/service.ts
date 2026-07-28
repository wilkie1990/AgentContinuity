import {
  AgentContinuityError,
  type ExecutionPathOwnership,
  type GitPathChangeKind,
  type PathCollisionOverlap,
  type PathCollisionSource,
  type PathCollisionWarning,
  type PathOwnershipEntry,
  type PathOwnershipKind,
  type ReplaceExecutionPathOwnershipInput,
  type ReplaceExecutionPathOwnershipResult,
  replaceExecutionPathOwnershipSchema,
} from "@agent-continuity/contracts";
import {
  executionGitSnapshots,
  executionGitTouchedPaths,
  executionPathOwnershipEntries,
  executionPathOwnershipRevisions,
  executionWorktrees,
  repositories,
  taskClaims,
  taskExecutions,
  tasks,
  type ExecutionPathOwnershipRevisionRow,
} from "@agent-continuity/database";
import { and, asc, desc, eq, gt, isNull } from "drizzle-orm";
import type { ActivityService } from "../activity/service.js";
import { requireRepository, requireTask, requireWritableProject } from "../refs.js";
import type { RepositoryPathResolver } from "../repositories/paths.js";
import type { Runtime } from "../runtime.js";

const MAX_WARNING_OVERLAPS = 100;

type Candidate = {
  path: string;
  pathKey: string;
  kind: PathOwnershipKind;
  source: PathCollisionSource;
  change: GitPathChangeKind | null;
};

type LiveExecution = {
  executionId: string;
  taskId: string;
  taskKey: string;
  actor: string;
  sessionId: string | null;
  repositoryId: string;
  repositoryKey: string;
  repositoryLabel: string;
  worktreeId: string;
  worktreePath: string;
  worktreePathKey: string;
  candidates: Candidate[];
};

export type PathOwnershipService = ReturnType<typeof createPathOwnershipService>;

export function createPathOwnershipService(
  runtime: Runtime,
  activity: ActivityService,
  pathResolver: RepositoryPathResolver,
) {
  function entries(revisionId: string): PathOwnershipEntry[] {
    return runtime.db
      .select()
      .from(executionPathOwnershipEntries)
      .where(eq(executionPathOwnershipEntries.revisionId, revisionId))
      .orderBy(asc(executionPathOwnershipEntries.pathKey))
      .all()
      .map((row) => ({
        id: row.id,
        revisionId: row.revisionId,
        path: row.path,
        kind: row.pathKind as PathOwnershipKind,
      }));
  }

  function dto(row: ExecutionPathOwnershipRevisionRow): ExecutionPathOwnership {
    const execution = runtime.db
      .select()
      .from(taskExecutions)
      .where(eq(taskExecutions.id, row.executionId))
      .get();
    if (!execution) {
      throw new AgentContinuityError("INTERNAL_ERROR", "Ownership execution no longer exists.");
    }
    const task = requireTask(runtime, execution.taskId);
    const repository = requireRepository(runtime, row.repositoryId);
    return {
      id: row.id,
      executionId: row.executionId,
      taskId: task.id,
      taskKey: task.key,
      repositoryId: repository.id,
      repositoryKey: repository.key,
      repositoryLabel: repository.label,
      worktreeId: row.worktreeId,
      version: row.version,
      paths: entries(row.id),
      actor: row.actor,
      sessionId: row.sessionId,
      createdAt: row.createdAt,
      supersededAt: row.supersededAt,
    };
  }

  function currentRevision(executionId: string): ExecutionPathOwnershipRevisionRow | undefined {
    return runtime.db
      .select()
      .from(executionPathOwnershipRevisions)
      .where(
        and(
          eq(executionPathOwnershipRevisions.executionId, executionId),
          isNull(executionPathOwnershipRevisions.supersededAt),
        ),
      )
      .orderBy(desc(executionPathOwnershipRevisions.version))
      .get();
  }

  function latestRevisionForTask(taskId: string): ExecutionPathOwnershipRevisionRow | undefined {
    const executionIds = runtime.db
      .select({ id: taskExecutions.id })
      .from(taskExecutions)
      .where(eq(taskExecutions.taskId, taskId))
      .orderBy(desc(taskExecutions.startedAt))
      .all();
    for (const execution of executionIds) {
      const row = runtime.db
        .select()
        .from(executionPathOwnershipRevisions)
        .where(eq(executionPathOwnershipRevisions.executionId, execution.id))
        .orderBy(desc(executionPathOwnershipRevisions.version))
        .get();
      if (row) return row;
    }
    return undefined;
  }

  function assertOwner(
    execution: typeof taskExecutions.$inferSelect,
    input: ReplaceExecutionPathOwnershipInput,
  ): void {
    const sessionMismatch =
      execution.sessionId !== null && execution.sessionId !== (input.sessionId ?? null);
    if (execution.actor !== input.actor || sessionMismatch) {
      throw new AgentContinuityError(
        "EXECUTION_OWNERSHIP_MISMATCH",
        "The running execution belongs to another actor or session.",
        { actor: execution.actor, sessionId: execution.sessionId },
      );
    }
  }

  function normalizedPaths(
    worktreePath: string,
    input: ReplaceExecutionPathOwnershipInput,
  ): Array<{ path: string; pathKey: string; kind: PathOwnershipKind }> {
    const parsed = replaceExecutionPathOwnershipSchema.safeParse(input);
    if (!parsed.success) {
      throw new AgentContinuityError("VALIDATION_ERROR", "Invalid path ownership declaration.", {
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
    }
    const byKey = new Map<string, { path: string; pathKey: string; kind: PathOwnershipKind }>();
    for (const entry of parsed.data.paths) {
      pathResolver.validatePlannedWithin(worktreePath, entry.path);
      const pathKey = pathResolver.relativeComparisonKey(entry.path);
      const existing = byKey.get(pathKey);
      if (existing) {
        throw new AgentContinuityError(
          "VALIDATION_ERROR",
          `Ownership path ${entry.path} duplicates ${existing.path} under this filesystem's comparison rules.`,
          { path: entry.path, existingPath: existing.path },
        );
      }
      byKey.set(pathKey, { path: entry.path, pathKey, kind: entry.kind });
    }
    return [...byKey.values()].sort(
      (left, right) =>
        left.pathKey.localeCompare(right.pathKey) || left.kind.localeCompare(right.kind),
    );
  }

  function samePaths(
    current: ExecutionPathOwnershipRevisionRow | undefined,
    desired: Array<{ path: string; pathKey: string; kind: PathOwnershipKind }>,
  ): boolean {
    if (!current) return false;
    const stored = runtime.db
      .select()
      .from(executionPathOwnershipEntries)
      .where(eq(executionPathOwnershipEntries.revisionId, current.id))
      .orderBy(asc(executionPathOwnershipEntries.pathKey))
      .all();
    return (
      stored.length === desired.length &&
      stored.every(
        (entry, index) =>
          entry.path === desired[index]?.path &&
          entry.pathKey === desired[index]?.pathKey &&
          entry.pathKind === desired[index]?.kind,
      )
    );
  }

  function declaredCandidates(executionId: string): Candidate[] {
    const revision = currentRevision(executionId);
    if (!revision) return [];
    return runtime.db
      .select()
      .from(executionPathOwnershipEntries)
      .where(eq(executionPathOwnershipEntries.revisionId, revision.id))
      .orderBy(asc(executionPathOwnershipEntries.pathKey))
      .all()
      .map((row) => ({
        path: row.path,
        pathKey: row.pathKey,
        kind: row.pathKind as PathOwnershipKind,
        source: "declared",
        change: null,
      }));
  }

  function observedCandidates(executionId: string): Candidate[] {
    const snapshot = runtime.db
      .select()
      .from(executionGitSnapshots)
      .where(
        and(
          eq(executionGitSnapshots.executionId, executionId),
          eq(executionGitSnapshots.status, "ok"),
        ),
      )
      .orderBy(desc(executionGitSnapshots.sequence))
      .get();
    if (!snapshot) return [];
    const candidates: Candidate[] = [];
    for (const row of runtime.db
      .select()
      .from(executionGitTouchedPaths)
      .where(eq(executionGitTouchedPaths.snapshotId, snapshot.id))
      .orderBy(asc(executionGitTouchedPaths.path))
      .all()) {
      candidates.push({
        path: row.path,
        pathKey: pathResolver.relativeComparisonKey(row.path),
        kind: "file",
        source: "observed",
        change: row.changeKind as GitPathChangeKind,
      });
      if (row.previousPath) {
        candidates.push({
          path: row.previousPath,
          pathKey: pathResolver.relativeComparisonKey(row.previousPath),
          kind: "file",
          source: "observed",
          change: row.changeKind as GitPathChangeKind,
        });
      }
    }
    return candidates;
  }

  function liveExecutions(): LiveExecution[] {
    return runtime.db
      .select({
        executionId: taskExecutions.id,
        taskId: tasks.id,
        taskKey: tasks.key,
        actor: taskExecutions.actor,
        sessionId: taskExecutions.sessionId,
        repositoryId: repositories.id,
        repositoryKey: repositories.key,
        repositoryLabel: repositories.label,
        worktreeId: executionWorktrees.id,
        worktreePath: executionWorktrees.worktreePath,
        worktreePathKey: executionWorktrees.worktreePathKey,
      })
      .from(taskExecutions)
      .innerJoin(tasks, eq(tasks.id, taskExecutions.taskId))
      .innerJoin(taskClaims, eq(taskClaims.id, taskExecutions.claimId))
      .innerJoin(executionWorktrees, eq(executionWorktrees.executionId, taskExecutions.id))
      .innerJoin(repositories, eq(repositories.id, executionWorktrees.repositoryId))
      .where(
        and(
          eq(taskExecutions.status, "running"),
          isNull(taskClaims.releasedAt),
          gt(taskClaims.expiresAt, runtime.now()),
        ),
      )
      .all()
      .map((row) => ({
        ...row,
        candidates: [
          ...declaredCandidates(row.executionId),
          ...observedCandidates(row.executionId),
        ].sort(
          (left, right) =>
            left.pathKey.localeCompare(right.pathKey) ||
            left.source.localeCompare(right.source) ||
            left.kind.localeCompare(right.kind),
        ),
      }))
      .sort(
        (left, right) =>
          left.repositoryKey.localeCompare(right.repositoryKey) ||
          left.taskKey.localeCompare(right.taskKey) ||
          left.executionId.localeCompare(right.executionId),
      );
  }

  function overlapRows(
    left: LiveExecution,
    right: LiveExecution,
  ): { overlaps: PathCollisionOverlap[]; truncated: boolean } {
    const rows: PathCollisionOverlap[] = [];
    const seen = new Set<string>();
    let truncated = false;
    const exact = new Map<string, Candidate[]>();
    const directories = new Map<string, Candidate[]>();
    for (const candidate of right.candidates) {
      const exactRows = exact.get(candidate.pathKey) ?? [];
      exactRows.push(candidate);
      exact.set(candidate.pathKey, exactRows);
      if (candidate.kind === "directory") {
        const directoryRows = directories.get(candidate.pathKey) ?? [];
        directoryRows.push(candidate);
        directories.set(candidate.pathKey, directoryRows);
      }
    }
    const rightByPath = [...right.candidates].sort((a, b) =>
      a.pathKey.localeCompare(b.pathKey),
    );

    function add(leftPath: Candidate, rightPath: Candidate): boolean {
      const key = [
        leftPath.pathKey,
        leftPath.kind,
        leftPath.source,
        leftPath.change,
        rightPath.pathKey,
        rightPath.kind,
        rightPath.source,
        rightPath.change,
      ].join("\0");
      if (seen.has(key)) return true;
      seen.add(key);
      if (rows.length === MAX_WARNING_OVERLAPS) {
        truncated = true;
        return false;
      }
      rows.push({
        taskPath: leftPath.path,
        taskKind: leftPath.kind,
        taskSource: leftPath.source,
        taskChange: leftPath.change,
        counterpartPath: rightPath.path,
        counterpartKind: rightPath.kind,
        counterpartSource: rightPath.source,
        counterpartChange: rightPath.change,
      });
      return true;
    }

    function lowerBound(prefix: string): number {
      let low = 0;
      let high = rightByPath.length;
      while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (rightByPath[middle]!.pathKey.localeCompare(prefix) < 0) low = middle + 1;
        else high = middle;
      }
      return low;
    }

    outer: for (const leftPath of left.candidates) {
      for (const rightPath of exact.get(leftPath.pathKey) ?? []) {
        if (!add(leftPath, rightPath)) break outer;
      }

      // A directory declaration owns all descendants. The sorted index avoids
      // scanning an unrelated 5,000-path provenance snapshot for each candidate.
      if (leftPath.kind === "directory") {
        const prefix = `${leftPath.pathKey}/`;
        for (let index = lowerBound(prefix); index < rightByPath.length; index += 1) {
          const rightPath = rightByPath[index]!;
          if (!rightPath.pathKey.startsWith(prefix)) break;
          if (!add(leftPath, rightPath)) break outer;
        }
      }

      // Only directory ancestors on the other side can prefix a non-equal path.
      let slash = leftPath.pathKey.indexOf("/");
      while (slash >= 0) {
        const ancestor = leftPath.pathKey.slice(0, slash);
        for (const rightPath of directories.get(ancestor) ?? []) {
          if (!add(leftPath, rightPath)) break outer;
        }
        slash = leftPath.pathKey.indexOf("/", slash + 1);
      }
    }
    return { overlaps: rows, truncated };
  }

  function warning(
    task: LiveExecution,
    counterpart: LiveExecution,
    overlapsForTask: PathCollisionOverlap[],
    truncated: boolean,
  ): PathCollisionWarning {
    const worktreeRelation =
      task.worktreePathKey === counterpart.worktreePathKey
        ? "same_worktree"
        : "separate_worktrees";
    return {
      id: `${task.repositoryId}:${[task.executionId, counterpart.executionId].sort().join(":")}`,
      repositoryId: task.repositoryId,
      repositoryKey: task.repositoryKey,
      repositoryLabel: task.repositoryLabel,
      worktreeRelation,
      strength: worktreeRelation === "same_worktree" ? "high" : "normal",
      task: {
        taskId: task.taskId,
        taskKey: task.taskKey,
        executionId: task.executionId,
        actor: task.actor,
        sessionId: task.sessionId,
        worktreeId: task.worktreeId,
      },
      counterpart: {
        taskId: counterpart.taskId,
        taskKey: counterpart.taskKey,
        executionId: counterpart.executionId,
        actor: counterpart.actor,
        sessionId: counterpart.sessionId,
        worktreeId: counterpart.worktreeId,
      },
      overlaps: overlapsForTask,
      overlapsTruncated: truncated,
    };
  }

  function allWarnings(): PathCollisionWarning[] {
    const live = liveExecutions();
    const warnings: PathCollisionWarning[] = [];
    for (let leftIndex = 0; leftIndex < live.length; leftIndex += 1) {
      const left = live[leftIndex]!;
      for (let rightIndex = leftIndex + 1; rightIndex < live.length; rightIndex += 1) {
        const right = live[rightIndex]!;
        if (
          left.executionId === right.executionId ||
          left.taskId === right.taskId ||
          left.repositoryId !== right.repositoryId
        ) {
          continue;
        }
        const result = overlapRows(left, right);
        if (result.overlaps.length === 0) continue;
        warnings.push(warning(left, right, result.overlaps, result.truncated));
        warnings.push(
          warning(
            right,
            left,
            result.overlaps.map((overlap) => ({
              taskPath: overlap.counterpartPath,
              taskKind: overlap.counterpartKind,
              taskSource: overlap.counterpartSource,
              taskChange: overlap.counterpartChange,
              counterpartPath: overlap.taskPath,
              counterpartKind: overlap.taskKind,
              counterpartSource: overlap.taskSource,
              counterpartChange: overlap.taskChange,
            })),
            result.truncated,
          ),
        );
      }
    }
    return warnings.sort(
      (left, right) =>
        left.task.taskKey.localeCompare(right.task.taskKey) ||
        left.counterpart.taskKey.localeCompare(right.counterpart.taskKey) ||
        left.id.localeCompare(right.id),
    );
  }

  function collisionsForTask(taskRef: string): PathCollisionWarning[] {
    const task = requireTask(runtime, taskRef);
    return allWarnings().filter((item) => item.task.taskId === task.id);
  }

  return {
    forTask(taskRef: string): ExecutionPathOwnership | null {
      const task = requireTask(runtime, taskRef);
      const execution = runtime.db
        .select()
        .from(taskExecutions)
        .where(and(eq(taskExecutions.taskId, task.id), eq(taskExecutions.status, "running")))
        .orderBy(desc(taskExecutions.startedAt))
        .get();
      const row = execution ? currentRevision(execution.id) : latestRevisionForTask(task.id);
      return row ? dto(row) : null;
    },

    collisionsForTask,

    allWarnings,

    replace(
      taskRef: string,
      input: ReplaceExecutionPathOwnershipInput,
    ): ReplaceExecutionPathOwnershipResult {
      const ownership = runtime.tx(() => {
        const task = requireTask(runtime, taskRef);
        requireWritableProject(runtime, task.projectId);
        const execution = runtime.db
          .select()
          .from(taskExecutions)
          .where(and(eq(taskExecutions.taskId, task.id), eq(taskExecutions.status, "running")))
          .orderBy(desc(taskExecutions.startedAt))
          .get();
        if (!execution) {
          throw new AgentContinuityError(
            "EXECUTION_NOT_RUNNING",
            `${task.key} must have a running execution before declaring path ownership.`,
            { task: task.key },
          );
        }
        assertOwner(execution, input);
        const worktree = runtime.db
          .select()
          .from(executionWorktrees)
          .where(eq(executionWorktrees.executionId, execution.id))
          .get();
        if (!worktree) {
          throw new AgentContinuityError(
            "EXECUTION_WORKTREE_NOT_BOUND",
            `${task.key}'s running execution has no worktree association.`,
            { task: task.key, executionId: execution.id },
          );
        }
        const desired = normalizedPaths(worktree.worktreePath, input);
        const current = currentRevision(execution.id);
        if (samePaths(current, desired)) return dto(current!);

        const now = runtime.now();
        if (current) {
          runtime.db
            .update(executionPathOwnershipRevisions)
            .set({ supersededAt: now })
            .where(eq(executionPathOwnershipRevisions.id, current.id))
            .run();
        }
        const version =
          Math.max(
            0,
            ...runtime.db
              .select({ version: executionPathOwnershipRevisions.version })
              .from(executionPathOwnershipRevisions)
              .where(eq(executionPathOwnershipRevisions.executionId, execution.id))
              .all()
              .map((entry) => entry.version),
          ) + 1;
        const revision = runtime.db
          .insert(executionPathOwnershipRevisions)
          .values({
            id: runtime.newId(),
            executionId: execution.id,
            repositoryId: worktree.repositoryId,
            worktreeId: worktree.id,
            version,
            actor: input.actor,
            sessionId: input.sessionId ?? null,
            createdAt: now,
            supersededAt: null,
          })
          .returning()
          .get();
        for (const path of desired) {
          runtime.db
            .insert(executionPathOwnershipEntries)
            .values({
              id: runtime.newId(),
              revisionId: revision.id,
              path: path.path,
              pathKey: path.pathKey,
              pathKind: path.kind,
            })
            .run();
        }
        activity.record({
          projectId: task.projectId,
          taskId: task.id,
          eventType: "execution.path_ownership_updated",
          actor: input.actor,
          sessionId: input.sessionId,
          payload: {
            executionId: execution.id,
            repository: requireRepository(runtime, worktree.repositoryId).key,
            version,
            pathCount: desired.length,
          },
        });
        return dto(revision);
      });
      return { ownership, collisions: collisionsForTask(taskRef) };
    },
  };
}
