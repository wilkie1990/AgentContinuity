import {
  AgentContinuityError,
  type AddLinksInput,
  type Link,
  type LinkInput,
  type ListLinksQuery,
} from "@agent-continuity/contracts";
import { links, type ProjectRow, type TaskRow } from "@agent-continuity/database";
import { eq } from "drizzle-orm";
import type { ActivityService } from "../activity/service.js";
import type { ClaimService } from "../claims/service.js";
import { nextKey } from "../ids.js";
import { requireLink, requireProject, requireTask, requireWritableProject } from "../refs.js";
import type { Runtime } from "../runtime.js";
import { queryLinks, serialiseMetadata, toLinkDto } from "./repository.js";

export type LinkService = ReturnType<typeof createLinkService>;

export function createLinkService(
  runtime: Runtime,
  activity: ActivityService,
  claims: ClaimService,
) {
  function resolveTask(project: ProjectRow, ref: string | null | undefined): TaskRow | null {
    if (!ref) return null;
    const task = requireTask(runtime, ref);
    if (task.projectId !== project.id) {
      throw new AgentContinuityError(
        "VALIDATION_ERROR",
        `${task.key} belongs to a different project and cannot be linked from ${project.key}.`,
        { task: task.key, project: project.key },
      );
    }
    return task;
  }

  return {
    /** Accepts a single link or a batch; the whole batch is written in one transaction. */
    add(projectRef: string, input: AddLinksInput): Link[] {
      return runtime.tx(() => {
        const project = requireWritableProject(runtime, projectRef);

        const entries: LinkInput[] =
          input.links && input.links.length > 0
            ? input.links
            : [
                {
                  type: input.type as string,
                  provider: input.provider ?? null,
                  reference: input.reference ?? null,
                  url: input.url ?? null,
                  metadata: input.metadata ?? null,
                  task: input.task ?? null,
                },
              ];

        const created: Link[] = [];
        for (const entry of entries) {
          const task = resolveTask(project, entry.task ?? input.task);
          const row = runtime.db
            .insert(links)
            .values({
              id: runtime.newId(),
              key: nextKey(runtime, "link"),
              projectId: project.id,
              taskId: task?.id ?? null,
              type: entry.type,
              provider: entry.provider ?? null,
              reference: entry.reference ?? null,
              url: entry.url ?? null,
              metadataJson: serialiseMetadata(entry.metadata),
              createdBy: input.actor ?? null,
              createdAt: runtime.now(),
            })
            .returning()
            .get();

          activity.record({
            projectId: project.id,
            taskId: task?.id ?? null,
            eventType: "link.added",
            actor: input.actor,
            sessionId: input.sessionId,
            payload: {
              linkKey: row.key,
              type: row.type,
              ...(row.provider ? { provider: row.provider } : {}),
              ...(row.reference ? { reference: row.reference } : {}),
            },
          });

          if (task) claims.touch(task.id, input.actor, input.sessionId);
          created.push(toLinkDto(row, project.key, task?.key ?? null));
        }

        return created;
      });
    },

    list(projectRef: string, query: ListLinksQuery): Link[] {
      const project = requireProject(runtime, projectRef);
      return queryLinks(runtime, {
        projectId: project.id,
        ...(query.task ? { taskId: requireTask(runtime, query.task).id } : {}),
        ...(query.type ? { type: query.type } : {}),
        ...(query.provider ? { provider: query.provider } : {}),
      });
    },

    remove(
      linkRef: string,
      meta: { actor?: string | undefined; sessionId?: string | undefined } = {},
    ): void {
      runtime.tx(() => {
        const row = requireLink(runtime, linkRef);
        runtime.db.delete(links).where(eq(links.id, row.id)).run();

        activity.record({
          projectId: row.projectId,
          taskId: row.taskId,
          eventType: "link.removed",
          actor: meta.actor,
          sessionId: meta.sessionId,
          payload: { linkKey: row.key, type: row.type },
        });
      });
    },

    get(linkRef: string): Link {
      const row = requireLink(runtime, linkRef);
      const project = requireProject(runtime, row.projectId);
      const task = row.taskId ? requireTask(runtime, row.taskId) : null;
      return toLinkDto(row, project.key, task?.key ?? null);
    },
  };
}
