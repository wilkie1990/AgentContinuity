import {
  AgentContinuityError,
  type CompleteTaskInput,
  type HandoffWorkInput,
  type HandoffWorkResult,
  type ReportWorkInput,
  type ReportWorkResult,
  type StartWorkInput,
  type StartWorkResult,
} from "@agent-continuity/contracts";
import type { ClaimService } from "../claims/service.js";
import type { ExecutionService } from "../executions/service.js";
import type { PathOwnershipService } from "../ownership/service.js";
import type { ProjectService } from "../projects/service.js";
import type { LocalGitCaptureService } from "../provenance/capture.js";
import type { RepositoryService } from "../repositories/service.js";
import type { Runtime } from "../runtime.js";
import type { TaskService } from "../tasks/service.js";

export type WorkflowService = ReturnType<typeof createWorkflowService>;

/**
 * High-value execution lifecycle composites.
 *
 * This service owns orchestration only. Claim ownership, lease expiry, activity,
 * checkpoints, handoffs and task reads remain implemented by their existing domain
 * services. Runtime.tx makes their nested transactions join this outer unit of work.
 */
export function createWorkflowService(
  runtime: Runtime,
  projects: ProjectService,
  tasks: TaskService,
  claims: ClaimService,
  executions: ExecutionService,
  repositories: RepositoryService,
  git: LocalGitCaptureService,
  ownership: PathOwnershipService,
) {
  return {
    async startWork(taskRef: string, input: StartWorkInput): Promise<StartWorkResult> {
      const started = runtime.tx(() => {
        const before = tasks.getSummary(taskRef);
        const beforeExecution = executions.forTask(before.id);

        // Let the claim service decide same-owner resume versus a real conflict.
        // Any later eligibility failure rolls this renewal back with the outer tx.
        if (before.claim) {
          claims.claim(taskRef, input);
          assertContinuable(before);
        } else {
          const recoverable =
            before.status === "in_progress" &&
            before.dependenciesComplete &&
            before.activeBlockerCount === 0 &&
            beforeExecution.execution === null &&
            beforeExecution.handoff !== null;

          if (!before.isActionable && !recoverable) {
            throw notActionable(before);
          }
          claims.claim(taskRef, input);
        }

        if (input.worktree) {
          repositories.bindWorktree(taskRef, {
            ...input.worktree,
            actor: input.actor,
            sessionId: input.sessionId,
          });
        }
        if (input.ownership) {
          ownership.replace(taskRef, {
            paths: input.ownership,
            actor: input.actor,
            sessionId: input.sessionId,
          });
        }

        const task = tasks.get(taskRef);
        return {
          project: projects.get(task.projectKey),
          task,
          execution: executions.forTask(task.id),
        };
      });
      if (input.worktree) {
        await git.captureBaseline(started.task.id, started.execution.execution?.id);
      }
      const task = tasks.get(started.task.id);
      return {
        project: projects.get(task.projectKey),
        task,
        execution: executions.forTask(task.id),
      };
    },

    async report(taskRef: string, input: ReportWorkInput): Promise<ReportWorkResult> {
      const reported = runtime.tx(() => {
        const claim = claims.heartbeat(taskRef, {
          actor: input.actor,
          ...(input.sessionId ? { sessionId: input.sessionId } : {}),
          ...(input.phase ? { phase: input.phase } : {}),
        });

        const progress = input.progress
          ? tasks.addProgress(taskRef, {
              content: input.progress,
              actor: input.actor,
              ...(input.sessionId ? { sessionId: input.sessionId } : {}),
            })
          : null;
        if (input.ownership) {
          ownership.replace(taskRef, {
            paths: input.ownership,
            actor: input.actor,
            sessionId: input.sessionId,
          });
        }
        const checkpoint = input.checkpoint
          ? executions.checkpoint(taskRef, {
              ...input.checkpoint,
              actor: input.actor,
              ...(input.sessionId ? { sessionId: input.sessionId } : {}),
            })
          : null;
        const execution = executions.activeFor(claim.taskId);
        if (!execution) {
          throw new AgentContinuityError(
            "INTERNAL_ERROR",
            `No running execution exists for ${claim.taskKey} after its heartbeat.`,
            { task: claim.taskKey },
          );
        }
        return { claim, execution, progress, checkpoint };
      });
      const provenance = reported.checkpoint
        ? await git.captureSnapshot(taskRef, {
            trigger: "checkpoint",
            checkpointId: reported.checkpoint.id,
            executionId: reported.execution.id,
          })
        : null;
      return { ...reported, provenance, collisions: ownership.collisionsForTask(taskRef) };
    },

    async handoff(taskRef: string, input: HandoffWorkInput): Promise<HandoffWorkResult> {
      const handedOff = runtime.tx(() => {
        // Validate ownership before writing the final checkpoint. It is also the
        // handoff's final liveness update and optional phase marker.
        claims.heartbeat(taskRef, {
          actor: input.actor,
          ...(input.sessionId ? { sessionId: input.sessionId } : {}),
          ...(input.phase ? { phase: input.phase } : {}),
        });
        const checkpoint = executions.checkpoint(taskRef, {
          ...input.checkpoint,
          actor: input.actor,
          ...(input.sessionId ? { sessionId: input.sessionId } : {}),
        });
        const releasedClaim = claims.releaseAfterCheckpoint(
          taskRef,
          {
            actor: input.actor,
            ...(input.sessionId ? { sessionId: input.sessionId } : {}),
            reason: input.reason ?? "handoff",
          },
          checkpoint,
        );
        const state = executions.forTask(taskRef);
        if (!state.handoff) {
          throw new AgentContinuityError(
            "INTERNAL_ERROR",
            `No durable handoff was produced for ${releasedClaim.taskKey}.`,
            { task: releasedClaim.taskKey },
          );
        }
        return {
          checkpoint,
          releasedClaim,
          handoff: state.handoff,
          task: tasks.get(taskRef),
        };
      });
      const provenance = handedOff.checkpoint.executionId
        ? await git.captureSnapshot(taskRef, {
            trigger: "handoff",
            checkpointId: handedOff.checkpoint.id,
            executionId: handedOff.checkpoint.executionId,
          })
        : null;
      return { ...handedOff, provenance };
    },

    /**
     * Complete durable task state first, then append best-effort derived Git facts.
     * Inspection failure is represented by an error snapshot and never rolls completion back.
     */
    async complete(taskRef: string, input: CompleteTaskInput) {
      const taskBefore = tasks.getSummary(taskRef);
      const execution = executions.activeFor(taskBefore.id);
      const completed = tasks.complete(taskRef, input);
      if (execution?.worktree) {
        await git.captureSnapshot(taskRef, {
          trigger: "completion",
          executionId: execution.id,
        });
      }
      return completed;
    },
  };
}

function assertContinuable(task: ReturnType<TaskService["getSummary"]>): void {
  if (
    task.status !== "in_progress" ||
    !task.dependenciesComplete ||
    task.activeBlockerCount > 0
  ) {
    throw notActionable(task);
  }
}

function notActionable(task: ReturnType<TaskService["getSummary"]>): AgentContinuityError {
  return new AgentContinuityError(
    "TASK_NOT_ACTIONABLE",
    `${task.key} cannot be started because it is not eligible for work.`,
    {
      task: task.key,
      status: task.status,
      dependenciesComplete: task.dependenciesComplete,
      activeBlockerCount: task.activeBlockerCount,
    },
  );
}
