import { z } from "zod";
import { actorSchema, sessionIdSchema } from "./common.js";
import type { GitPathChangeKind } from "./provenance.js";

export const pathOwnershipKindSchema = z.enum(["file", "directory"]);
export type PathOwnershipKind = z.infer<typeof pathOwnershipKindSchema>;

export const repositoryRelativeOwnershipPathSchema = z
  .string()
  .min(1)
  .max(16_384)
  .refine(
    (value) =>
      value !== "." &&
      !value.startsWith("/") &&
      !/^[A-Za-z]:/.test(value) &&
      !value.endsWith("/") &&
      !value.includes("\\") &&
      !value.includes("\0") &&
      !value.includes("*") &&
      !value.includes("?") &&
      value.split("/").every((segment) => segment !== "" && segment !== "." && segment !== ".."),
    "Expected an exact normalized repository-relative path without globs or traversal.",
  );

export const pathOwnershipEntryInputSchema = z.strictObject({
  path: repositoryRelativeOwnershipPathSchema,
  kind: pathOwnershipKindSchema,
});
export type PathOwnershipEntryInput = z.infer<typeof pathOwnershipEntryInputSchema>;

export const replaceExecutionPathOwnershipSchema = z.strictObject({
  paths: z.array(pathOwnershipEntryInputSchema).max(500),
  actor: actorSchema,
  sessionId: sessionIdSchema.optional(),
});
export type ReplaceExecutionPathOwnershipInput = z.infer<
  typeof replaceExecutionPathOwnershipSchema
>;

export type PathOwnershipEntry = PathOwnershipEntryInput & {
  id: string;
  revisionId: string;
};

export type ExecutionPathOwnership = {
  id: string;
  executionId: string;
  taskId: string;
  taskKey: string;
  repositoryId: string;
  repositoryKey: string;
  repositoryLabel: string;
  worktreeId: string;
  version: number;
  paths: PathOwnershipEntry[];
  actor: string;
  sessionId: string | null;
  createdAt: string;
  supersededAt: string | null;
};

export type PathCollisionSource = "declared" | "observed";
export type PathCollisionWorktreeRelation = "same_worktree" | "separate_worktrees";
export type PathCollisionStrength = "high" | "normal";

export type PathCollisionSide = {
  taskId: string;
  taskKey: string;
  executionId: string;
  actor: string;
  sessionId: string | null;
  worktreeId: string;
};

export type PathCollisionOverlap = {
  taskPath: string;
  taskKind: PathOwnershipKind;
  taskSource: PathCollisionSource;
  taskChange: GitPathChangeKind | null;
  counterpartPath: string;
  counterpartKind: PathOwnershipKind;
  counterpartSource: PathCollisionSource;
  counterpartChange: GitPathChangeKind | null;
};

/** Oriented to `task`; the other live execution is always `counterpart`. */
export type PathCollisionWarning = {
  id: string;
  repositoryId: string;
  repositoryKey: string;
  repositoryLabel: string;
  worktreeRelation: PathCollisionWorktreeRelation;
  strength: PathCollisionStrength;
  task: PathCollisionSide;
  counterpart: PathCollisionSide;
  overlaps: PathCollisionOverlap[];
  overlapsTruncated: boolean;
};

export type ReplaceExecutionPathOwnershipResult = {
  ownership: ExecutionPathOwnership;
  collisions: PathCollisionWarning[];
};
