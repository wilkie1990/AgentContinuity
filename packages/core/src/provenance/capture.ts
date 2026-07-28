import type {
  GitProvenanceBaseline,
  GitProvenanceSnapshot,
  GitSnapshotTrigger,
} from "@agent-continuity/contracts";
import { executionWorktrees, taskExecutions } from "@agent-continuity/database";
import { and, desc, eq } from "drizzle-orm";
import type { RepositoryService } from "../repositories/service.js";
import { requireTask } from "../refs.js";
import type { Runtime } from "../runtime.js";
import type { GitInspector } from "./git.js";
import type { GitProvenanceService } from "./service.js";

export type LocalGitCaptureService = ReturnType<typeof createLocalGitCaptureService>;

export function createLocalGitCaptureService(
  runtime: Runtime,
  repositories: RepositoryService,
  provenance: GitProvenanceService,
  inspector: GitInspector,
) {
  function executionFor(taskRef: string, executionId?: string) {
    const task = requireTask(runtime, taskRef);
    if (executionId) {
      const execution = runtime.db
        .select()
        .from(taskExecutions)
        .where(and(eq(taskExecutions.id, executionId), eq(taskExecutions.taskId, task.id)))
        .get();
      return execution ? { task, execution } : null;
    }
    const execution = runtime.db
      .select()
      .from(taskExecutions)
      .where(eq(taskExecutions.taskId, task.id))
      .orderBy(desc(taskExecutions.startedAt))
      .get();
    return execution ? { task, execution } : null;
  }

  async function baseline(
    taskRef: string,
    executionId?: string,
  ): Promise<GitProvenanceBaseline | null> {
    const current = executionFor(taskRef, executionId);
    if (!current) return null;
    const existing = provenance.baselineForExecution(current.execution.id);
    if (existing) return existing;
    const bindingRow = runtime.db
      .select()
      .from(executionWorktrees)
      .where(eq(executionWorktrees.executionId, current.execution.id))
      .get();
    if (!bindingRow) return null;
    const binding = repositories.worktreeForExecution(current.execution.id);
    if (!binding) return null;
    const inspection = await inspector.inspectBaseline(binding.worktreePath);
    return provenance.recordBaseline(current.task.id, {
      executionId: current.execution.id,
      worktreeId: binding.id,
      repositoryId: binding.repositoryId,
      source: "local_git",
      inspection,
    });
  }

  return {
    captureBaseline: baseline,

    async captureSnapshot(
      taskRef: string,
      input: {
        trigger: GitSnapshotTrigger;
        checkpointId?: string | null;
        executionId?: string;
      },
    ): Promise<GitProvenanceSnapshot | null> {
      const current = executionFor(taskRef, input.executionId);
      if (!current) return null;
      const capturedBaseline = await baseline(taskRef, current.execution.id);
      if (!capturedBaseline) return null;
      const binding = repositories.worktreeForExecution(current.execution.id);
      if (!binding) return null;
      const inspection = await inspector.inspectSnapshot(
        binding.worktreePath,
        capturedBaseline.headSha,
      );
      return provenance.recordSnapshot(current.task.id, {
        executionId: current.execution.id,
        worktreeId: binding.id,
        repositoryId: binding.repositoryId,
        baselineId: capturedBaseline.id,
        checkpointId: input.checkpointId ?? null,
        trigger: input.trigger,
        source: "local_git",
        inspection,
      });
    },
  };
}
