import type { ActivityEvent, ActivityEventType } from "@agent-continuity/contracts";
import { activityEvents, projects, tasks } from "@agent-continuity/database";
import { and, desc, eq, gt, inArray, lt, type SQL } from "drizzle-orm";
import type { Runtime } from "../runtime.js";

export type ActivityFilter = {
  projectId?: string;
  taskId?: string;
  eventTypes?: ActivityEventType[];
  actor?: string;
  after?: string;
  before?: string;
  limit: number;
  cursor?: string | undefined;
};

function parsePayload(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** Cursors are opaque to callers but are simply the sequence number of the last event. */
export function encodeCursor(seq: number): string {
  return Buffer.from(`seq:${seq}`, "utf8").toString("base64url");
}

export function decodeCursor(cursor: string): number | null {
  try {
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    if (!decoded.startsWith("seq:")) return null;
    const seq = Number.parseInt(decoded.slice(4), 10);
    return Number.isFinite(seq) ? seq : null;
  } catch {
    return null;
  }
}

const selection = {
  seq: activityEvents.seq,
  id: activityEvents.id,
  projectId: activityEvents.projectId,
  projectKey: projects.key,
  taskId: activityEvents.taskId,
  taskKey: tasks.key,
  eventType: activityEvents.eventType,
  actor: activityEvents.actor,
  sessionId: activityEvents.sessionId,
  payloadJson: activityEvents.payloadJson,
  createdAt: activityEvents.createdAt,
};

export type ActivityRecord = ActivityEvent & { seq: number };

export function queryActivity(runtime: Runtime, filter: ActivityFilter): ActivityRecord[] {
  const conditions: SQL[] = [];

  if (filter.projectId) conditions.push(eq(activityEvents.projectId, filter.projectId));
  if (filter.taskId) conditions.push(eq(activityEvents.taskId, filter.taskId));
  if (filter.eventTypes?.length) {
    conditions.push(inArray(activityEvents.eventType, filter.eventTypes));
  }
  if (filter.actor) conditions.push(eq(activityEvents.actor, filter.actor));
  if (filter.after) conditions.push(gt(activityEvents.createdAt, filter.after));
  if (filter.before) conditions.push(lt(activityEvents.createdAt, filter.before));

  if (filter.cursor) {
    const seq = decodeCursor(filter.cursor);
    if (seq !== null) conditions.push(lt(activityEvents.seq, seq));
  }

  return runtime.db
    .select(selection)
    .from(activityEvents)
    .innerJoin(projects, eq(projects.id, activityEvents.projectId))
    .leftJoin(tasks, eq(tasks.id, activityEvents.taskId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(activityEvents.seq))
    .limit(filter.limit)
    .all()
    .map((row) => ({
      seq: row.seq,
      id: row.id,
      projectId: row.projectId,
      projectKey: row.projectKey,
      taskId: row.taskId,
      taskKey: row.taskKey,
      eventType: row.eventType as ActivityEventType,
      actor: row.actor,
      sessionId: row.sessionId,
      payload: parsePayload(row.payloadJson),
      createdAt: row.createdAt,
    }));
}
