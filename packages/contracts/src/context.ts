import { z } from "zod";
import { actorFields } from "./common.js";

export const CONTEXT_SOFT_LIMIT_BYTES = 32 * 1024;
export const CONTEXT_HARD_LIMIT_BYTES = 256 * 1024;

export const contextOwnerTypeSchema = z.enum(["project", "task"]);
export type ContextOwnerType = z.infer<typeof contextOwnerTypeSchema>;

/**
 * The hard UTF-8 limit is enforced by core so every adapter returns the same typed
 * CONTEXT_TOO_LARGE error. Fastify's own request-size ceiling remains a coarser guard.
 */
export const contextContentSchema = z.string();
export const nullableContextContentSchema = contextContentSchema.nullable();

export const replaceContextSchema = z.strictObject({
  context: nullableContextContentSchema,
  expectedVersion: z.number().int().min(0),
  reason: z.string().min(1).max(2000).optional(),
  ...actorFields,
});
export type ReplaceContextInput = z.infer<typeof replaceContextSchema>;

export const revertContextSchema = z.strictObject({
  targetVersion: z.number().int().min(1),
  expectedVersion: z.number().int().min(0),
  reason: z.string().min(1).max(2000).optional(),
  ...actorFields,
});
export type RevertContextInput = z.infer<typeof revertContextSchema>;

export const listContextVersionsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  beforeVersion: z.coerce.number().int().min(1).optional(),
});
export type ListContextVersionsQuery = z.infer<typeof listContextVersionsQuerySchema>;

export const contextVersionParamSchema = z.coerce.number().int().min(1);

export type ContextSize = {
  /** Unicode code points, not UTF-16 code units. */
  characters: number;
  /** UTF-8 encoded bytes; both warning thresholds use this value. */
  bytes: number;
  overSoftLimit: boolean;
};

export type ContextVersionSummary = {
  id: string;
  ownerType: ContextOwnerType;
  ownerId: string;
  projectId: string;
  taskId: string | null;
  version: number;
  size: ContextSize;
  actor: string | null;
  sessionId: string | null;
  reason: string | null;
  revertedFromVersion: number | null;
  createdAt: string;
  isCurrent: boolean;
};

export type ContextVersionDetail = ContextVersionSummary & {
  content: string | null;
};

export type ContextVersionPage = {
  versions: ContextVersionSummary[];
  nextBeforeVersion: number | null;
};
