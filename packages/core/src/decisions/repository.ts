import type { Decision } from "@agent-workspace/contracts";
import { decisions, projects, tasks, type DecisionRow } from "@agent-workspace/database";
import { and, desc, eq, like, or, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import type { Runtime } from "../runtime.js";

const supersededBy = alias(decisions, "superseded_by");

export type DecisionQuery = {
  id?: string;
  projectId?: string;
  taskId?: string;
  search?: string;
  limit?: number;
};

type Joined = {
  decision: DecisionRow;
  projectKey: string;
  taskKey: string | null;
  supersededByKey: string | null;
};

function toDto(row: Joined): Decision {
  const { decision } = row;
  return {
    id: decision.id,
    key: decision.key,
    projectId: decision.projectId,
    projectKey: row.projectKey,
    taskId: decision.taskId,
    taskKey: row.taskKey,
    title: decision.title,
    decision: decision.decision,
    rationale: decision.rationale,
    createdBy: decision.createdBy,
    sessionId: decision.sessionId,
    createdAt: decision.createdAt,
    supersededAt: decision.supersededAt,
    supersededById: decision.supersededById,
    supersededByKey: row.supersededByKey,
  };
}

export function queryDecisions(runtime: Runtime, query: DecisionQuery): Decision[] {
  const conditions: SQL[] = [];
  if (query.id) conditions.push(eq(decisions.id, query.id));
  if (query.projectId) conditions.push(eq(decisions.projectId, query.projectId));
  if (query.taskId) conditions.push(eq(decisions.taskId, query.taskId));
  if (query.search) {
    const pattern = `%${query.search}%`;
    const search = or(
      like(decisions.title, pattern),
      like(decisions.decision, pattern),
      like(decisions.rationale, pattern),
    );
    if (search) conditions.push(search);
  }

  const rows = runtime.db
    .select({
      decision: decisions,
      projectKey: projects.key,
      taskKey: tasks.key,
      supersededByKey: supersededBy.key,
    })
    .from(decisions)
    .innerJoin(projects, eq(projects.id, decisions.projectId))
    .leftJoin(tasks, eq(tasks.id, decisions.taskId))
    .leftJoin(supersededBy, eq(supersededBy.id, decisions.supersededById))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(decisions.createdAt), desc(decisions.key))
    .limit(query.limit ?? 200)
    .all();

  return rows.map(toDto);
}

export function findDecisionById(runtime: Runtime, id: string): Decision | null {
  return queryDecisions(runtime, { id, limit: 1 })[0] ?? null;
}
