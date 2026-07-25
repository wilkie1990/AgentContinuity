import { AgentWorkspaceError, type Link } from "@agent-workspace/contracts";
import { links, projects, tasks, type LinkRow } from "@agent-workspace/database";
import { and, asc, desc, eq, type SQL } from "drizzle-orm";
import type { Runtime } from "../runtime.js";

export type LinkQuery = {
  projectId?: string;
  taskId?: string;
  type?: string;
  provider?: string;
};

function parseMetadata(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** metadata_json must hold a JSON object; arrays and scalars are rejected up front. */
export function serialiseMetadata(metadata: unknown): string | null {
  if (metadata === undefined || metadata === null) return null;
  if (typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new AgentWorkspaceError(
      "INVALID_METADATA",
      "Link metadata must be a JSON object.",
      { received: Array.isArray(metadata) ? "array" : typeof metadata },
    );
  }
  try {
    return JSON.stringify(metadata);
  } catch {
    throw new AgentWorkspaceError("INVALID_METADATA", "Link metadata must be JSON serialisable.");
  }
}

export function toLinkDto(row: LinkRow, projectKey: string, taskKey: string | null): Link {
  return {
    id: row.id,
    key: row.key,
    projectId: row.projectId,
    projectKey,
    taskId: row.taskId,
    taskKey,
    type: row.type,
    provider: row.provider,
    reference: row.reference,
    url: row.url,
    metadata: parseMetadata(row.metadataJson),
    createdBy: row.createdBy,
    createdAt: row.createdAt,
  };
}

export function queryLinks(runtime: Runtime, query: LinkQuery): Link[] {
  const conditions: SQL[] = [];
  if (query.projectId) conditions.push(eq(links.projectId, query.projectId));
  if (query.taskId) conditions.push(eq(links.taskId, query.taskId));
  if (query.type) conditions.push(eq(links.type, query.type));
  if (query.provider) conditions.push(eq(links.provider, query.provider));

  return runtime.db
    .select({ link: links, projectKey: projects.key, taskKey: tasks.key })
    .from(links)
    .innerJoin(projects, eq(projects.id, links.projectId))
    .leftJoin(tasks, eq(tasks.id, links.taskId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(asc(links.type), desc(links.createdAt))
    .all()
    .map((row) => toLinkDto(row.link, row.projectKey, row.taskKey));
}
