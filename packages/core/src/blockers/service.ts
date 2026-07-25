import {
  AgentWorkspaceError,
  type AddBlockerInput,
  type Blocker,
  type ResolveBlockerInput,
} from "@agent-workspace/contracts";
import { blockers, tasks } from "@agent-workspace/database";
import { eq } from "drizzle-orm";
import type { ActivityService } from "../activity/service.js";
import type { ClaimService } from "../claims/service.js";
import { nextKey } from "../ids.js";
import { requireBlocker, requireTask, requireWritableProject } from "../refs.js";
import type { Runtime } from "../runtime.js";
import { writeStatus } from "../tasks/status.js";
import { countActiveBlockers, listBlockerRows, toBlockerDto } from "./repository.js";

export type BlockerService = ReturnType<typeof createBlockerService>;

export function createBlockerService(
  runtime: Runtime,
  activity: ActivityService,
  claims: ClaimService,
) {
  return {
    add(taskRef: string, input: AddBlockerInput): Blocker {
      return runtime.tx(() => {
        const task = requireTask(runtime, taskRef);
        requireWritableProject(runtime, task.projectId);

        const row = runtime.db
          .insert(blockers)
          .values({
            id: runtime.newId(),
            key: nextKey(runtime, "blocker"),
            taskId: task.id,
            description: input.description,
            requiredAction: input.requiredAction ?? null,
            createdBy: input.actor ?? null,
            createdAt: runtime.now(),
          })
          .returning()
          .get();

        activity.record({
          projectId: task.projectId,
          taskId: task.id,
          eventType: "task.blocked",
          actor: input.actor,
          sessionId: input.sessionId,
          payload: {
            blockerKey: row.key,
            description: row.description,
            ...(row.requiredAction ? { requiredAction: row.requiredAction } : {}),
          },
        });

        // A completed task is left alone; anything else moves to blocked.
        if (task.status !== "done") {
          writeStatus(runtime, activity, task, "blocked", {
            actor: input.actor,
            sessionId: input.sessionId,
            reason: `blocker ${row.key}`,
          });
        }

        claims.touch(task.id, input.actor, input.sessionId);
        return toBlockerDto(row, task.key);
      });
    },

    resolve(blockerRef: string, input: ResolveBlockerInput): Blocker {
      return runtime.tx(() => {
        const existing = requireBlocker(runtime, blockerRef);
        if (existing.resolvedAt !== null) {
          throw new AgentWorkspaceError(
            "BLOCKER_ALREADY_RESOLVED",
            `${existing.key} was already resolved.`,
            { blocker: existing.key, resolvedAt: existing.resolvedAt },
          );
        }

        const task = requireTask(runtime, existing.taskId);
        requireWritableProject(runtime, task.projectId);

        const row = runtime.db
          .update(blockers)
          .set({
            resolvedAt: runtime.now(),
            resolvedBy: input.actor ?? null,
            resolution: input.resolution,
          })
          .where(eq(blockers.id, existing.id))
          .returning()
          .get();

        activity.record({
          projectId: task.projectId,
          taskId: task.id,
          eventType: "task.blocker_resolved",
          actor: input.actor,
          sessionId: input.sessionId,
          payload: { blockerKey: row.key, resolution: row.resolution },
        });

        // Once nothing blocks the task it resumes: in_progress if an agent still holds
        // the lease, otherwise ready for whoever picks it up next.
        if (countActiveBlockers(runtime, task.id) === 0) {
          const current = runtime.db.select().from(tasks).where(eq(tasks.id, task.id)).get() ?? task;
          if (current.status === "blocked") {
            const next = claims.activeFor(task.id) ? "in_progress" : "ready";
            writeStatus(runtime, activity, current, next, {
              actor: input.actor,
              sessionId: input.sessionId,
              reason: `blocker ${row.key} resolved`,
            });
          }
        }

        claims.touch(task.id, input.actor, input.sessionId);
        return toBlockerDto(row, task.key);
      });
    },

    listForTask(taskRef: string): Blocker[] {
      const task = requireTask(runtime, taskRef);
      return listBlockerRows(runtime, task.id).map((row) => toBlockerDto(row, task.key));
    },

    get(blockerRef: string): Blocker {
      const row = requireBlocker(runtime, blockerRef);
      const task = requireTask(runtime, row.taskId);
      return toBlockerDto(row, task.key);
    },
  };
}
