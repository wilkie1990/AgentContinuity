import { z } from "zod";
import { actorFields, refSchema } from "./common.js";

export const writableEvidenceKindSchema = z.enum([
  "commit",
  "test",
  "file",
  "url",
  "result",
  "note",
]);
export const evidenceKindSchema = z.enum([...writableEvidenceKindSchema.options, "legacy"]);
export type WritableEvidenceKind = z.infer<typeof writableEvidenceKindSchema>;
export type EvidenceKind = z.infer<typeof evidenceKindSchema>;

export const verificationOutcomeSchema = z.enum([
  "passed",
  "failed",
  "timed_out",
  "signaled",
  "spawn_error",
]);
export type VerificationOutcome = z.infer<typeof verificationOutcomeSchema>;

export const evidenceOutcomeSchema = z.enum(["passed", "failed", "informational"]);
export type EvidenceOutcome = z.infer<typeof evidenceOutcomeSchema>;

const shaSchema = z.string().regex(/^[0-9a-fA-F]{40,64}$/).transform((value) => value.toLowerCase());
const relativePathSchema = z
  .string()
  .min(1)
  .max(2000)
  .refine(
    (value) =>
      !value.startsWith("/") &&
      !value.includes("\\") &&
      !/^[A-Za-z]:/.test(value) &&
      value.split("/").every((segment) => segment !== "" && segment !== "." && segment !== ".."),
    "Expected a normalized repository-relative path.",
  );

export const evidenceScopeInputSchema = z.strictObject({
  repository: refSchema,
  executionId: z.string().min(1).max(200).optional(),
  worktreeId: z.string().min(1).max(200).optional(),
  sha: shaSchema.optional(),
});
export type EvidenceScopeInput = z.infer<typeof evidenceScopeInputSchema>;

export type EvidenceRepositoryScope = {
  repositoryId: string;
  repositoryKey: string;
  repositoryLabel: string;
  executionId: string | null;
  worktreeId: string | null;
  sha: string | null;
};

export const verificationCommandSchema = z.strictObject({
  executable: z.string().min(1).max(1000),
  args: z.array(z.string().max(16_000)).max(256),
  cwd: relativePathSchema.nullable(),
});

export const localVerificationPayloadSchema = z.strictObject({
  source: z.literal("local_cli"),
  name: z.string().min(1).max(2000),
  command: verificationCommandSchema,
  timeoutMs: z.number().int().min(1000).max(15 * 60_000),
  outputLimitBytes: z.number().int().min(1).max(1024 * 1024),
  outcome: verificationOutcomeSchema,
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime(),
  durationMs: z.number().int().min(0).max(24 * 60 * 60_000),
  exitCode: z.number().int().nullable(),
  signal: z.string().max(120).nullable(),
  error: z.string().max(4000).nullable(),
  stdoutTail: z.string().max(1024 * 1024),
  stderrTail: z.string().max(1024 * 1024),
  stdoutBytes: z.number().int().min(0),
  stderrBytes: z.number().int().min(0),
  stdoutTruncated: z.boolean(),
  stderrTruncated: z.boolean(),
  startSha: shaSchema.nullable(),
  endSha: shaSchema.nullable(),
  startDirty: z.boolean().nullable(),
  endDirty: z.boolean().nullable(),
  revisionStable: z.boolean(),
});
export type LocalVerificationPayload = z.infer<typeof localVerificationPayloadSchema>;

const common = {
  scope: evidenceScopeInputSchema.optional(),
  ...actorFields,
};

export const criterionEvidenceSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("commit"),
    scope: evidenceScopeInputSchema.extend({ sha: shaSchema }),
    summary: z.string().min(1).max(20_000).optional(),
    ...actorFields,
  }),
  z.strictObject({
    kind: z.literal("test"),
    name: z.string().min(1).max(2000),
    outcome: evidenceOutcomeSchema,
    reference: z.string().min(1).max(4000).optional(),
    summary: z.string().min(1).max(20_000).optional(),
    verification: localVerificationPayloadSchema.optional(),
    ...common,
  }),
  z.strictObject({
    kind: z.literal("file"),
    path: relativePathSchema,
    description: z.string().min(1).max(20_000).optional(),
    ...common,
  }),
  z.strictObject({
    kind: z.literal("url"),
    url: z.string().url().max(4000),
    title: z.string().min(1).max(2000).optional(),
    summary: z.string().min(1).max(20_000).optional(),
    ...actorFields,
  }),
  z.strictObject({
    kind: z.literal("result"),
    summary: z.string().min(1).max(20_000),
    outcome: evidenceOutcomeSchema,
    ...actorFields,
  }),
  z.strictObject({
    kind: z.literal("note"),
    content: z.string().min(1).max(20_000),
    ...actorFields,
  }),
]);
export type CriterionEvidenceInput = z.infer<typeof criterionEvidenceSchema>;

export type CriterionEvidenceBase = {
  id: string;
  criterionId: string;
  kind: EvidenceKind;
  scope: EvidenceRepositoryScope | null;
  actor: string | null;
  sessionId: string | null;
  createdAt: string;
};

export type CriterionEvidence =
  | (CriterionEvidenceBase & { kind: "commit"; summary: string | null })
  | (CriterionEvidenceBase & {
      kind: "test";
      name: string;
      outcome: EvidenceOutcome;
      reference: string | null;
      summary: string | null;
      verification: LocalVerificationPayload | null;
    })
  | (CriterionEvidenceBase & { kind: "file"; path: string; description: string | null })
  | (CriterionEvidenceBase & {
      kind: "url";
      url: string;
      title: string | null;
      summary: string | null;
    })
  | (CriterionEvidenceBase & { kind: "result"; summary: string; outcome: EvidenceOutcome })
  | (CriterionEvidenceBase & { kind: "note"; content: string })
  | (CriterionEvidenceBase & {
      kind: "legacy";
      legacyType: string;
      reference: string | null;
      content: string | null;
      url: string | null;
    });

export const criterionEvidencePolicySchema = z.strictObject({
  minimumCount: z.number().int().min(1).max(100),
  qualifyingKinds: z.array(writableEvidenceKindSchema).min(1).max(6),
  requireSha: z.boolean().default(false),
  requirePassingVerification: z.boolean().default(false),
  ...actorFields,
});
export type CriterionEvidencePolicyInput = z.infer<typeof criterionEvidencePolicySchema>;

export const clearCriterionEvidencePolicySchema = z.strictObject(actorFields);
export type ClearCriterionEvidencePolicyInput = z.infer<
  typeof clearCriterionEvidencePolicySchema
>;

export type CriterionEvidencePolicy = {
  criterionId: string;
  minimumCount: number;
  qualifyingKinds: WritableEvidenceKind[];
  requireSha: boolean;
  requirePassingVerification: boolean;
  actor: string | null;
  sessionId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MissingAcceptanceEvidence = {
  criterionId: string;
  description: string;
  requiredKinds: WritableEvidenceKind[];
  requiredCount: number;
  actualQualifyingCount: number;
  failedRequirements: string[];
};
