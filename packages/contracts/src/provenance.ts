import { z } from "zod";

export const gitCaptureStatusSchema = z.enum(["ok", "error"]);
export type GitCaptureStatus = z.infer<typeof gitCaptureStatusSchema>;

export const gitSnapshotTriggerSchema = z.enum([
  "checkpoint",
  "handoff",
  "completion",
  "manual",
]);
export type GitSnapshotTrigger = z.infer<typeof gitSnapshotTriggerSchema>;

export const gitPathChangeKindSchema = z.enum([
  "added",
  "modified",
  "deleted",
  "renamed",
  "copied",
  "untracked",
  "unknown",
]);
export type GitPathChangeKind = z.infer<typeof gitPathChangeKindSchema>;

export const gitCaptureErrorCodeSchema = z.enum([
  "not_git_repository",
  "worktree_unavailable",
  "git_failed",
  "timed_out",
  "output_limit",
  "invalid_output",
]);
export type GitCaptureErrorCode = z.infer<typeof gitCaptureErrorCodeSchema>;

const shaSchema = z
  .string()
  .regex(/^[0-9a-f]{40,64}$/i)
  .transform((value) => value.toLowerCase());
const repositoryRelativePathSchema = z
  .string()
  .min(1)
  .max(16_384)
  .refine(
    (value) =>
      !value.startsWith("/") &&
      !value.includes("\\") &&
      !value.includes("\0") &&
      value.split("/").every((segment) => segment !== "" && segment !== "." && segment !== ".."),
    "Expected a normalized repository-relative path without traversal.",
  );

export const gitCaptureErrorSchema = z.strictObject({
  code: gitCaptureErrorCodeSchema,
  message: z.string().min(1).max(2_000),
});
export type GitCaptureError = z.infer<typeof gitCaptureErrorSchema>;

const successfulGitStateSchema = z.strictObject({
  status: z.literal("ok"),
  branch: z.string().min(1).max(500).nullable(),
  detached: z.boolean(),
  headSha: shaSchema.nullable(),
  dirty: z.boolean(),
  error: z.null(),
});

const failedGitStateSchema = z.strictObject({
  status: z.literal("error"),
  branch: z.null(),
  detached: z.literal(false),
  headSha: z.null(),
  dirty: z.null(),
  error: gitCaptureErrorSchema,
});

export const gitBaselineInspectionSchema = z.discriminatedUnion("status", [
  successfulGitStateSchema,
  failedGitStateSchema,
]);
export type GitBaselineInspection = z.infer<typeof gitBaselineInspectionSchema>;

export const gitTouchedPathInputSchema = z.strictObject({
  path: repositoryRelativePathSchema,
  previousPath: repositoryRelativePathSchema.nullable().optional(),
  change: gitPathChangeKindSchema,
  additions: z.number().int().nonnegative().nullable(),
  deletions: z.number().int().nonnegative().nullable(),
});
export type GitTouchedPathInput = z.infer<typeof gitTouchedPathInputSchema>;

const successfulGitSnapshotSchema = successfulGitStateSchema.extend({
  commitShas: z.array(shaSchema).max(100),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  filesChanged: z.number().int().nonnegative(),
  touchedPaths: z.array(gitTouchedPathInputSchema).max(5_000),
});

const failedGitSnapshotSchema = failedGitStateSchema.extend({
  commitShas: z.tuple([]),
  additions: z.literal(0),
  deletions: z.literal(0),
  filesChanged: z.literal(0),
  touchedPaths: z.tuple([]),
});

export const gitSnapshotInspectionSchema = z.discriminatedUnion("status", [
  successfulGitSnapshotSchema,
  failedGitSnapshotSchema,
]);
export type GitSnapshotInspection = z.infer<typeof gitSnapshotInspectionSchema>;

const explicitBindingIdentitySchema = {
  executionId: z.string().uuid(),
  worktreeId: z.string().uuid(),
  repositoryId: z.string().uuid(),
};

/**
 * Trusted local adapters inspect an explicit stored worktree and pass the derived
 * facts into core. Core validates all three identities before persisting anything.
 */
export const recordGitBaselineSchema = z.strictObject({
  ...explicitBindingIdentitySchema,
  source: z.literal("local_git"),
  inspection: gitBaselineInspectionSchema,
});
export type RecordGitBaselineInput = z.infer<typeof recordGitBaselineSchema>;

export const recordGitSnapshotSchema = z.strictObject({
  ...explicitBindingIdentitySchema,
  baselineId: z.string().uuid(),
  checkpointId: z.string().uuid().nullable().optional(),
  trigger: gitSnapshotTriggerSchema,
  source: z.literal("local_git"),
  inspection: gitSnapshotInspectionSchema,
});
export type RecordGitSnapshotInput = z.infer<typeof recordGitSnapshotSchema>;

/** Capture requests never accept a path or cwd; the server uses the stored binding. */
export const captureGitProvenanceSchema = z.strictObject({});
export type CaptureGitProvenanceInput = z.infer<typeof captureGitProvenanceSchema>;

export type GitTouchedPath = GitTouchedPathInput & {
  id: string;
  snapshotId: string;
};

export type GitProvenanceBaseline = {
  id: string;
  executionId: string;
  worktreeId: string;
  repositoryId: string;
  repositoryKey: string;
  repositoryLabel: string;
  source: "local_git";
  status: GitCaptureStatus;
  branch: string | null;
  detached: boolean;
  headSha: string | null;
  dirty: boolean | null;
  error: GitCaptureError | null;
  capturedAt: string;
};

export type GitProvenanceSnapshot = {
  id: string;
  baselineId: string;
  executionId: string;
  /** Monotonic within one execution baseline, even when timestamps are identical. */
  sequence: number;
  checkpointId: string | null;
  trigger: GitSnapshotTrigger;
  source: "local_git";
  status: GitCaptureStatus;
  branch: string | null;
  detached: boolean;
  headSha: string | null;
  dirty: boolean | null;
  commitShas: string[];
  additions: number;
  deletions: number;
  filesChanged: number;
  touchedPaths: GitTouchedPath[];
  error: GitCaptureError | null;
  capturedAt: string;
};

export type GitProvenanceState = {
  baseline: GitProvenanceBaseline;
  snapshots: GitProvenanceSnapshot[];
};
