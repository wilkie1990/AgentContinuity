import {
  AgentContinuityError,
  type ClaimTaskInput,
  type ReleaseClaimInput,
  type RenewClaimInput,
  type TaskClaim,
} from "@agent-continuity/contracts";
import { projects, taskClaims, type TaskClaimRow, type TaskRow } from "@agent-continuity/database";
import { eq } from "drizzle-orm";
import type { ActivityService } from "../activity/service.js";
import { assertWritable, requireTask } from "../refs.js";
import type { Runtime } from "../runtime.js";
import type { ExecutionService } from "../executions/service.js";
import { writeStatus } from "../tasks/status.js";
import {
  findActiveClaim,
  findActiveClaims,
  findUnrecordedExpiredClaims,
  toClaimDto,
} from "./repository.js";

/**
 * Two claims belong to the same agent when the actor matches and, where both sides
 * supply one, the session matches too.
 */
function sameOwner(
  claim: TaskClaimRow,
  actor: string | null | undefined,
  sessionId: string | null | undefined,
): boolean {
  if (!actor || claim.actor !== actor) return false;
  if (claim.sessionId && sessionId && claim.sessionId !== sessionId) return false;
  return true;
}

export type ClaimService = ReturnType<typeof createClaimService>;

export function createClaimService(runtime: Runtime, activity: ActivityService, executions?: ExecutionService) {
  /**
   * Lazily emits task.claim_expired for leases that lapsed since the last read.
   * `expiry_recorded_at` guarantees the event fires at most once per claim, which is why
   * no background process is required.
   */
  function reconcile(taskIds?: string[]): void {
    const lapsed = findUnrecordedExpiredClaims(runtime, taskIds);
    if (lapsed.length === 0) return;

    runtime.tx(() => {
      const now = runtime.now();
      for (const { claim, projectId } of lapsed) {
        runtime.db
          .update(taskClaims)
          .set({ expiryRecordedAt: now })
          .where(eq(taskClaims.id, claim.id))
          .run();

        activity.record({
          projectId,
          taskId: claim.taskId,
          eventType: "task.claim_expired",
          actor: claim.actor,
          sessionId: claim.sessionId,
          payload: { claimedAt: claim.claimedAt, expiresAt: claim.expiresAt },
        });
        executions?.endForClaim(claim.taskId, claim.id, "claim expired");
      }
    });
  }

  function activeFor(taskId: string): TaskClaimRow | null {
    reconcile([taskId]);
    return findActiveClaim(runtime, taskId) ?? null;
  }

  function activeForMany(taskIds: string[]): Map<string, TaskClaimRow> {
    reconcile(taskIds);
    return findActiveClaims(runtime, taskIds);
  }

  /**
   * Silent lease extension performed by operations that represent real task work
   * (progress, blockers, context updates, decisions, links). Never throws: a caller
   * without a matching claim simply does not renew anything.
   */
  function touch(
    taskId: string,
    actor: string | null | undefined,
    sessionId: string | null | undefined,
    ttlMinutes?: number,
  ): void {
    if (!actor) return;
    const claim = findActiveClaim(runtime, taskId);
    if (!claim || !sameOwner(claim, actor, sessionId)) return;

    runtime.db
      .update(taskClaims)
      .set({
        lastActiveAt: runtime.now(),
        expiresAt: runtime.future(ttlMinutes ?? runtime.claimTtlMinutes),
      })
      .where(eq(taskClaims.id, claim.id))
      .run();
  }

  return {
    reconcile,
    activeFor,
    activeForMany,
    touch,

    /** A silent liveness update: lease and execution timestamps change, activity does not. */
    heartbeat(taskRef: string, input: { actor: string; sessionId?: string; phase?: string }): TaskClaim {
      return runtime.tx(() => {
        const task = requireTask(runtime, taskRef);
        const claim = findActiveClaim(runtime, task.id);
        if (!claim || !sameOwner(claim, input.actor, input.sessionId)) {
          throw new AgentContinuityError("TASK_CLAIM_MISMATCH", `No matching active claim exists on ${task.key}.`, { task: task.key });
        }
        const now = runtime.now();
        const updated = runtime.db.update(taskClaims).set({ lastActiveAt: now, expiresAt: runtime.future(runtime.claimTtlMinutes) }).where(eq(taskClaims.id, claim.id)).returning().get();
        executions?.heartbeat(task.id, input);
        return toClaimDto(runtime, updated, task.key);
      });
    },

    claim(taskRef: string, input: ClaimTaskInput): { claim: TaskClaim; task: TaskRow } {
      return runtime.tx(() => {
        const task = requireTask(runtime, taskRef);
        const project = runtime.db.select().from(projects).where(eq(projects.id, task.projectId)).get();
        if (project) assertWritable(project);

        reconcile([task.id]);
        const existing = findActiveClaim(runtime, task.id);

        if (existing && !sameOwner(existing, input.actor, input.sessionId)) {
          throw new AgentContinuityError(
            "TASK_ALREADY_CLAIMED",
            `${task.key} is currently claimed by ${existing.actor}.`,
            {
              task: task.key,
              actor: existing.actor,
              sessionId: existing.sessionId,
              expiresAt: existing.expiresAt,
            },
          );
        }

        const now = runtime.now();
        const expiresAt = runtime.future(input.ttlMinutes ?? runtime.claimTtlMinutes);

        // Re-claiming your own live lease extends it rather than stacking a second claim.
        const row = existing
          ? runtime.db
              .update(taskClaims)
              .set({ lastActiveAt: now, expiresAt, sessionId: input.sessionId ?? existing.sessionId })
              .where(eq(taskClaims.id, existing.id))
              .returning()
              .get()
          : runtime.db
              .insert(taskClaims)
              .values({
                id: runtime.newId(),
                taskId: task.id,
                actor: input.actor,
                sessionId: input.sessionId ?? null,
                claimedAt: now,
                lastActiveAt: now,
                expiresAt,
              })
              .returning()
              .get();

        const nextTask =
          task.status === "ready"
            ? writeStatus(runtime, activity, task, "in_progress", {
                actor: input.actor,
                sessionId: input.sessionId,
                reason: "claimed",
              })
            : task;

        activity.record({
          projectId: task.projectId,
          taskId: task.id,
          eventType: existing ? "task.claim_renewed" : "task.claimed",
          actor: input.actor,
          sessionId: input.sessionId,
          payload: { expiresAt },
        });

        executions?.onClaim(task.id, row, Boolean(existing));
        return { claim: toClaimDto(runtime, row, task.key), task: nextTask };
      });
    },

    renew(taskRef: string, input: RenewClaimInput): TaskClaim {
      return runtime.tx(() => {
        const task = requireTask(runtime, taskRef);
        reconcile([task.id]);

        const existing = findActiveClaim(runtime, task.id);
        if (!existing) {
          throw new AgentContinuityError(
            "TASK_NOT_CLAIMED",
            `${task.key} has no active claim to renew.`,
            { task: task.key },
          );
        }

        if (!sameOwner(existing, input.actor, input.sessionId)) {
          throw new AgentContinuityError(
            "TASK_CLAIM_MISMATCH",
            `The active claim on ${task.key} belongs to ${existing.actor}${
              existing.sessionId ? ` (session ${existing.sessionId})` : ""
            }.`,
            { task: task.key, actor: existing.actor, sessionId: existing.sessionId },
          );
        }

        const expiresAt = runtime.future(input.ttlMinutes ?? runtime.claimTtlMinutes);
        const row = runtime.db
          .update(taskClaims)
          .set({ lastActiveAt: runtime.now(), expiresAt })
          .where(eq(taskClaims.id, existing.id))
          .returning()
          .get();

        activity.record({
          projectId: task.projectId,
          taskId: task.id,
          eventType: "task.claim_renewed",
          actor: input.actor,
          sessionId: input.sessionId,
          payload: { expiresAt },
        });

        return toClaimDto(runtime, row, task.key);
      });
    },

    release(taskRef: string, input: ReleaseClaimInput = {}): TaskClaim {
      return runtime.tx(() => {
        const task = requireTask(runtime, taskRef);
        reconcile([task.id]);

        const existing = findActiveClaim(runtime, task.id);
        if (!existing) {
          throw new AgentContinuityError(
            "TASK_NOT_CLAIMED",
            `${task.key} has no active claim to release.`,
            { task: task.key },
          );
        }

        // Omitting the actor is a deliberate forced release, which the human UI offers.
        const forced = !input.actor;
        if (!forced && !sameOwner(existing, input.actor, input.sessionId)) {
          throw new AgentContinuityError(
            "TASK_CLAIM_MISMATCH",
            `The active claim on ${task.key} belongs to ${existing.actor} and cannot be released by ${input.actor}.`,
            { task: task.key, actor: existing.actor },
          );
        }

        return releaseClaimRow(existing, task, {
          reason: input.reason,
          actor: input.actor,
          sessionId: input.sessionId,
          forced,
        });
      });
    },

    /** Used by task completion, which always ends the active lease. */
    releaseForTask(
      task: TaskRow,
      options: { reason: string; actor?: string | undefined; sessionId?: string | undefined },
    ): TaskClaim | null {
      const existing = findActiveClaim(runtime, task.id);
      if (!existing) return null;
      return releaseClaimRow(existing, task, { ...options, forced: false });
    },
  };

  function releaseClaimRow(
    existing: TaskClaimRow,
    task: TaskRow,
    options: {
      reason?: string | undefined;
      actor?: string | undefined;
      sessionId?: string | undefined;
      forced: boolean;
    },
  ): TaskClaim {
    const now = runtime.now();
    const row = runtime.db
      .update(taskClaims)
      .set({ releasedAt: now, releaseReason: options.reason ?? null, lastActiveAt: now })
      .where(eq(taskClaims.id, existing.id))
      .returning()
      .get();

    activity.record({
      projectId: task.projectId,
      taskId: task.id,
      eventType: "task.claim_released",
      actor: options.actor ?? existing.actor,
      sessionId: options.sessionId ?? existing.sessionId,
      payload: {
        releasedBy: options.actor ?? existing.actor,
        forced: options.forced,
        ...(options.reason ? { reason: options.reason } : {}),
      },
    });

    executions?.endForClaim(task.id, existing.id, options.reason ?? (options.forced ? "claim forcibly released" : "claim released"));
    return toClaimDto(runtime, row, task.key);
  }
}
