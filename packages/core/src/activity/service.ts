import type {
  ActivityEvent,
  ActivityEventType,
  ActivityPage,
  ListActivityQuery,
} from "@agent-workspace/contracts";
import { activityEvents } from "@agent-workspace/database";
import { requireProject, requireTask } from "../refs.js";
import type { Runtime } from "../runtime.js";
import { encodeCursor, queryActivity, type ActivityFilter } from "./repository.js";

export type RecordEventInput = {
  projectId: string;
  taskId?: string | null;
  eventType: ActivityEventType;
  actor?: string | null | undefined;
  sessionId?: string | null | undefined;
  payload?: Record<string, unknown>;
};

export type ActivityService = ReturnType<typeof createActivityService>;

export function createActivityService(runtime: Runtime) {
  return {
    /**
     * Appends a structured event. Activity is history only: the relational tables
     * remain the source of truth for current state.
     */
    record(input: RecordEventInput): void {
      runtime.db
        .insert(activityEvents)
        .values({
          id: runtime.newId(),
          projectId: input.projectId,
          taskId: input.taskId ?? null,
          eventType: input.eventType,
          actor: input.actor ?? null,
          sessionId: input.sessionId ?? null,
          payloadJson: JSON.stringify(input.payload ?? {}),
          createdAt: runtime.now(),
        })
        .run();
    },

    listForProject(projectRef: string, query: ListActivityQuery): ActivityPage {
      const project = requireProject(runtime, projectRef);
      const filter: ActivityFilter = {
        projectId: project.id,
        limit: query.limit + 1,
        cursor: query.cursor,
      };

      if (query.task) filter.taskId = requireTask(runtime, query.task).id;
      if (query.eventType?.length) filter.eventTypes = query.eventType;
      if (query.actor) filter.actor = query.actor;
      if (query.after) filter.after = query.after;
      if (query.before) filter.before = query.before;

      const rows = queryActivity(runtime, filter);
      const hasMore = rows.length > query.limit;
      const page = hasMore ? rows.slice(0, query.limit) : rows;
      const last = page.at(-1);

      return {
        events: page.map(({ seq: _seq, ...event }) => event),
        nextCursor: hasMore && last ? encodeCursor(last.seq) : null,
      };
    },

    /** Recent events for one task, used by task detail responses. */
    recentForTask(taskId: string, limit = 20): ActivityEvent[] {
      return queryActivity(runtime, { taskId, limit }).map(({ seq: _seq, ...event }) => event);
    },

    recentForProject(projectId: string, limit = 20): ActivityEvent[] {
      return queryActivity(runtime, { projectId, limit }).map(({ seq: _seq, ...event }) => event);
    },

    lastActivityAt(projectId: string): string | null {
      return queryActivity(runtime, { projectId, limit: 1 })[0]?.createdAt ?? null;
    },
  };
}
