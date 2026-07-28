import { z } from "zod";
import { arrayable, refSchema } from "./common.js";

/**
 * Canonical workspace records exposed by unified search. Context is kept separate
 * from its owning project/task so replacing it removes old terms without changing
 * the ordinary project/task result.
 */
export const searchSourceTypeSchema = z.enum([
  "project",
  "project_context",
  "task",
  "task_context",
  "acceptance_criterion",
  "progress",
  "decision",
  "blocker",
  "criterion_evidence",
  "link",
  "activity",
]);
export type SearchSourceType = z.infer<typeof searchSourceTypeSchema>;
export const SEARCH_SOURCE_TYPES: readonly SearchSourceType[] =
  searchSourceTypeSchema.options;

export const searchQuerySchema = z.object({
  q: z.string().trim().min(1).max(500),
  project: refSchema.optional(),
  task: refSchema.optional(),
  type: arrayable(searchSourceTypeSchema).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type SearchQuery = z.infer<typeof searchQuerySchema>;

export type SearchResult = {
  sourceType: SearchSourceType;
  /** Stable UUID of the canonical record (or owning record for context). */
  sourceId: string;
  /** Stable human-facing key where one exists, otherwise a deterministic scoped identifier. */
  sourceKey: string;
  projectId: string;
  projectKey: string;
  taskId: string | null;
  taskKey: string | null;
  title: string;
  snippet: string;
  /** Higher values are more relevant; deterministic source fields break equal-score ties. */
  score: number;
  createdAt: string;
  updatedAt: string;
};

export type SearchResponse = {
  query: string;
  results: SearchResult[];
  limit: number;
};
