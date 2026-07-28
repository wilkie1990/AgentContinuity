import {
  AgentContinuityError,
  searchQuerySchema,
  type SearchQuery,
  type SearchResponse,
  type SearchResult,
  type SearchSourceType,
} from "@agent-continuity/contracts";
import { searchDocuments } from "@agent-continuity/database";
import { eq, sql, type SQL } from "drizzle-orm";
import { requireProject, requireTask } from "../refs.js";
import type { Runtime } from "../runtime.js";

const MAX_MATCH_TOKENS = 32;

type SearchRow = {
  sourceType: string;
  sourceId: string;
  sourceKey: string;
  projectId: string;
  projectKey: string;
  taskId: string | null;
  taskKey: string | null;
  title: string;
  snippet: string;
  rank: number;
  createdAt: string;
  updatedAt: string;
};

export type SearchService = ReturnType<typeof createSearchService>;

/**
 * Turn free text into literal FTS terms. Punctuation and FTS operators are never
 * forwarded as syntax; every Unicode word/number token is quoted and prefix-enabled.
 */
export function literalMatchQuery(query: string): string | null {
  const tokens = query.normalize("NFKC").match(/[\p{L}\p{N}_]+/gu) ?? [];
  if (tokens.length === 0) return null;
  return tokens
    .slice(0, MAX_MATCH_TOKENS)
    .map((token) => `"${token}"*`)
    .join(" ");
}

function run(runtime: Runtime, statement: SQL): void {
  runtime.db.run(statement);
}

export function createSearchService(runtime: Runtime) {
  function insertProjectDocuments(projectId: string): void {
    run(
      runtime,
      sql`
        INSERT INTO search_documents (
          source_type, source_id, project_id, task_id, project_key, task_key,
          source_key, title, body, created_at, updated_at
        )
        SELECT
          'project', p.id, p.id, NULL, p.key, NULL,
          p.key, p.key || ' — ' || p.name,
          trim(
            coalesce(p.name, '') || char(10) ||
            coalesce(p.objective, '') || char(10) ||
            coalesce(p.description, '') || char(10) ||
            coalesce(p.status, '')
          ),
          p.created_at, p.updated_at
        FROM projects p
        WHERE p.id = ${projectId}
      `,
    );
    run(
      runtime,
      sql`
        INSERT INTO search_documents (
          source_type, source_id, project_id, task_id, project_key, task_key,
          source_key, title, body, created_at, updated_at
        )
        SELECT
          'project_context', p.id, p.id, NULL, p.key, NULL,
          p.key || ':context', p.key || ' project context', p.context,
          p.created_at, p.updated_at
        FROM projects p
        WHERE p.id = ${projectId}
          AND p.context IS NOT NULL
          AND trim(p.context) <> ''
      `,
    );
  }

  function insertTaskDocuments(projectId: string, taskId?: string): void {
    const taskFilter = taskId
      ? sql`t.project_id = ${projectId} AND t.id = ${taskId}`
      : sql`t.project_id = ${projectId}`;

    run(
      runtime,
      sql`
        INSERT INTO search_documents (
          source_type, source_id, project_id, task_id, project_key, task_key,
          source_key, title, body, created_at, updated_at
        )
        SELECT
          'task', t.id, t.project_id, t.id, p.key, t.key,
          t.key, t.key || ' — ' || t.title,
          trim(
            coalesce(t.title, '') || char(10) ||
            coalesce(t.description, '') || char(10) ||
            coalesce(t.status, '') || char(10) ||
            coalesce(t.priority, '')
          ),
          t.created_at, t.updated_at
        FROM tasks t
        JOIN projects p ON p.id = t.project_id
        WHERE ${taskFilter}
        ORDER BY p.key, t.key, t.id
      `,
    );
    run(
      runtime,
      sql`
        INSERT INTO search_documents (
          source_type, source_id, project_id, task_id, project_key, task_key,
          source_key, title, body, created_at, updated_at
        )
        SELECT
          'task_context', t.id, t.project_id, t.id, p.key, t.key,
          t.key || ':context', t.key || ' task context', t.context,
          t.created_at, t.updated_at
        FROM tasks t
        JOIN projects p ON p.id = t.project_id
        WHERE ${taskFilter}
          AND t.context IS NOT NULL
          AND trim(t.context) <> ''
        ORDER BY p.key, t.key, t.id
      `,
    );
    run(
      runtime,
      sql`
        INSERT INTO search_documents (
          source_type, source_id, project_id, task_id, project_key, task_key,
          source_key, title, body, created_at, updated_at
        )
        SELECT
          'acceptance_criterion', c.id, t.project_id, t.id, p.key, t.key,
          t.key || ':criterion:' || substr(c.id, 1, 8),
          t.key || ' acceptance criterion',
          trim(c.description || char(10) || CASE WHEN c.is_complete = 1 THEN 'complete' ELSE 'open' END),
          c.created_at, coalesce(c.completed_at, c.created_at)
        FROM acceptance_criteria c
        JOIN tasks t ON t.id = c.task_id
        JOIN projects p ON p.id = t.project_id
        WHERE ${taskFilter}
        ORDER BY p.key, t.key, c.sort_order, c.id
      `,
    );
    run(
      runtime,
      sql`
        INSERT INTO search_documents (
          source_type, source_id, project_id, task_id, project_key, task_key,
          source_key, title, body, created_at, updated_at
        )
        SELECT
          'progress', g.id, t.project_id, t.id, p.key, t.key,
          t.key || ':progress:' || substr(g.id, 1, 8),
          t.key || ' progress',
          trim(g.content || char(10) || coalesce(g.actor, '')),
          g.created_at, g.created_at
        FROM task_progress g
        JOIN tasks t ON t.id = g.task_id
        JOIN projects p ON p.id = t.project_id
        WHERE ${taskFilter}
        ORDER BY p.key, t.key, g.created_at, g.id
      `,
    );
    run(
      runtime,
      sql`
        INSERT INTO search_documents (
          source_type, source_id, project_id, task_id, project_key, task_key,
          source_key, title, body, created_at, updated_at
        )
        SELECT
          'blocker', b.id, t.project_id, t.id, p.key, t.key,
          b.key, b.key || ' on ' || t.key,
          trim(
            b.description || char(10) ||
            coalesce(b.required_action, '') || char(10) ||
            coalesce(b.resolution, '') || char(10) ||
            CASE WHEN b.resolved_at IS NULL THEN 'active' ELSE 'resolved' END
          ),
          b.created_at, coalesce(b.resolved_at, b.created_at)
        FROM blockers b
        JOIN tasks t ON t.id = b.task_id
        JOIN projects p ON p.id = t.project_id
        WHERE ${taskFilter}
        ORDER BY p.key, t.key, b.created_at, b.key
      `,
    );
    run(
      runtime,
      sql`
        INSERT INTO search_documents (
          source_type, source_id, project_id, task_id, project_key, task_key,
          source_key, title, body, created_at, updated_at
        )
        SELECT
          'criterion_evidence', e.id, t.project_id, t.id, p.key, t.key,
          t.key || ':evidence:' || substr(e.id, 1, 8),
          t.key || ' criterion evidence',
          trim(
            c.description || char(10) ||
            e.type || char(10) ||
            coalesce(e.reference, '') || char(10) ||
            coalesce(e.content, '') || char(10) ||
            coalesce(e.url, '')
          ),
          e.created_at, e.created_at
        FROM criterion_evidence e
        JOIN acceptance_criteria c ON c.id = e.criterion_id
        JOIN tasks t ON t.id = c.task_id
        JOIN projects p ON p.id = t.project_id
        WHERE ${taskFilter}
        ORDER BY p.key, t.key, e.created_at, e.id
      `,
    );
  }

  function insertDecisionDocuments(projectId: string, taskId?: string): void {
    const decisionFilter = taskId
      ? sql`d.project_id = ${projectId} AND d.task_id = ${taskId}`
      : sql`d.project_id = ${projectId}`;
    run(
      runtime,
      sql`
        INSERT INTO search_documents (
          source_type, source_id, project_id, task_id, project_key, task_key,
          source_key, title, body, created_at, updated_at
        )
        SELECT
          'decision', d.id, d.project_id, d.task_id, p.key, t.key,
          d.key, d.key || ' — ' || d.title,
          trim(
            d.decision || char(10) ||
            coalesce(d.rationale, '') || char(10) ||
            CASE WHEN d.superseded_at IS NULL THEN 'current' ELSE 'superseded' END
          ),
          d.created_at, coalesce(d.superseded_at, d.created_at)
        FROM decisions d
        JOIN projects p ON p.id = d.project_id
        LEFT JOIN tasks t ON t.id = d.task_id
        WHERE ${decisionFilter}
        ORDER BY p.key, d.created_at, d.key
      `,
    );
  }

  function insertLinkDocuments(projectId: string, taskId?: string): void {
    const linkFilter = taskId
      ? sql`l.project_id = ${projectId} AND l.task_id = ${taskId}`
      : sql`l.project_id = ${projectId}`;
    run(
      runtime,
      sql`
        INSERT INTO search_documents (
          source_type, source_id, project_id, task_id, project_key, task_key,
          source_key, title, body, created_at, updated_at
        )
        SELECT
          'link', l.id, l.project_id, l.task_id, p.key, t.key,
          l.key, l.key || ' — ' || l.type,
          trim(
            l.type || char(10) ||
            coalesce(l.provider, '') || char(10) ||
            coalesce(l.reference, '') || char(10) ||
            coalesce(l.url, '') || char(10) ||
            coalesce(l.metadata_json, '')
          ),
          l.created_at, l.created_at
        FROM links l
        JOIN projects p ON p.id = l.project_id
        LEFT JOIN tasks t ON t.id = l.task_id
        WHERE ${linkFilter}
        ORDER BY p.key, l.created_at, l.key
      `,
    );
  }

  function insertActivityDocuments(projectId: string, taskId?: string): void {
    const activityFilter = taskId
      ? sql`a.project_id = ${projectId} AND a.task_id = ${taskId}`
      : sql`a.project_id = ${projectId}`;
    run(
      runtime,
      sql`
        INSERT INTO search_documents (
          source_type, source_id, project_id, task_id, project_key, task_key,
          source_key, title, body, created_at, updated_at
        )
        SELECT
          'activity', a.id, a.project_id, a.task_id, p.key, t.key,
          'activity:' || printf('%010d', a.seq),
          a.event_type || ' on ' || coalesce(t.key, p.key),
          trim(
            a.event_type || char(10) ||
            coalesce(a.actor, '') || char(10) ||
            coalesce(a.session_id, '') || char(10) ||
            coalesce(a.payload_json, '')
          ),
          a.created_at, a.created_at
        FROM activity_events a
        JOIN projects p ON p.id = a.project_id
        LEFT JOIN tasks t ON t.id = a.task_id
        WHERE ${activityFilter}
        ORDER BY p.key, a.seq, a.id
      `,
    );
  }

  function refreshScope(projectId: string, taskId?: string | null): void {
    runtime.tx(() => {
      if (taskId) {
        runtime.db.delete(searchDocuments).where(eq(searchDocuments.taskId, taskId)).run();
      } else {
        runtime.db
          .delete(searchDocuments)
          .where(eq(searchDocuments.projectId, projectId))
          .run();
        insertProjectDocuments(projectId);
      }
      insertTaskDocuments(projectId, taskId ?? undefined);
      insertDecisionDocuments(projectId, taskId ?? undefined);
      insertLinkDocuments(projectId, taskId ?? undefined);
      insertActivityDocuments(projectId, taskId ?? undefined);
    });
  }

  return {
    refreshScope,

    search(input: SearchQuery): SearchResponse {
      const parsed = searchQuerySchema.safeParse(input);
      if (!parsed.success) {
        throw new AgentContinuityError("VALIDATION_ERROR", "Invalid unified search query.", {
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        });
      }
      const query = parsed.data;
      const match = literalMatchQuery(query.q);
      if (!match) return { query: query.q, results: [], limit: query.limit };

      let projectId: string | null = null;
      let taskId: string | null = null;
      if (query.project) projectId = requireProject(runtime, query.project).id;
      if (query.task) {
        const task = requireTask(runtime, query.task);
        if (projectId && task.projectId !== projectId) {
          throw new AgentContinuityError(
            "VALIDATION_ERROR",
            `${task.key} does not belong to the requested project.`,
            { task: task.key, project: query.project },
          );
        }
        taskId = task.id;
        projectId ??= task.projectId;
      }

      const conditions: SQL[] = [sql`search_documents_fts MATCH ${match}`];
      if (projectId) conditions.push(sql`d.project_id = ${projectId}`);
      if (taskId) conditions.push(sql`d.task_id = ${taskId}`);
      if (query.type?.length) {
        conditions.push(
          sql`d.source_type IN (${sql.join(
            query.type.map((sourceType) => sql`${sourceType}`),
            sql`, `,
          )})`,
        );
      }

      const rows = runtime.db.all<SearchRow>(sql`
        SELECT
          d.source_type AS sourceType,
          d.source_id AS sourceId,
          d.source_key AS sourceKey,
          d.project_id AS projectId,
          d.project_key AS projectKey,
          d.task_id AS taskId,
          d.task_key AS taskKey,
          d.title AS title,
          snippet(search_documents_fts, -1, '[', ']', ' … ', 24) AS snippet,
          bm25(search_documents_fts, 5.0, 3.0, 1.0) AS rank,
          d.created_at AS createdAt,
          d.updated_at AS updatedAt
        FROM search_documents_fts
        JOIN search_documents d ON d.id = search_documents_fts.rowid
        WHERE ${sql.join(conditions, sql` AND `)}
        ORDER BY rank ASC, d.source_type ASC, d.source_key ASC, d.source_id ASC
        LIMIT ${query.limit}
      `);

      const results: SearchResult[] = rows.map((row) => ({
        sourceType: row.sourceType as SearchSourceType,
        sourceId: row.sourceId,
        sourceKey: row.sourceKey,
        projectId: row.projectId,
        projectKey: row.projectKey,
        taskId: row.taskId,
        taskKey: row.taskKey,
        title: row.title,
        snippet: row.snippet,
        score: Math.max(0, -Number(row.rank)),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      }));
      return { query: query.q, results, limit: query.limit };
    },
  };
}
