import { z } from "zod";
import { pathOwnershipEntryInputSchema } from "./ownership.js";

const workflowActorFields = {
  actor: z.string().min(1).max(120),
  sessionId: z.string().min(1).max(200),
};

export const workflowCheckpointSchema = z.strictObject({
  completed: z.string().min(1).max(20_000),
  workingOn: z.string().min(1).max(20_000),
  next: z.string().min(1).max(20_000),
  uncertainty: z.string().max(20_000).nullable().optional(),
});
export type WorkflowCheckpointInput = z.infer<typeof workflowCheckpointSchema>;

/** Claim or resume eligible work and return its complete execution context. */
export const startWorkSchema = z.strictObject({
  ...workflowActorFields,
  ttlMinutes: z.number().int().min(1).max(24 * 60).optional(),
  worktree: z
    .strictObject({
      repository: z.string().min(1).max(200),
      worktreePath: z.string().min(1).max(16_384),
      branch: z.string().min(1).max(500).nullable().optional(),
    })
    .optional(),
  ownership: z.array(pathOwnershipEntryInputSchema).max(500).optional(),
});
export type StartWorkInput = z.infer<typeof startWorkSchema>;

/**
 * Every report refreshes liveness. Phase, progress and checkpoint are optional so an
 * actor-only request is the intentionally silent heartbeat form.
 */
export const reportWorkSchema = z.strictObject({
  ...workflowActorFields,
  phase: z.string().min(1).max(500).optional(),
  progress: z.string().min(1).max(20_000).optional(),
  checkpoint: workflowCheckpointSchema.optional(),
  ownership: z.array(pathOwnershipEntryInputSchema).max(500).optional(),
});
export type ReportWorkInput = z.infer<typeof reportWorkSchema>;

/** A handoff always includes a final checkpoint so the next execution can resume. */
export const handoffWorkSchema = z.strictObject({
  ...workflowActorFields,
  reason: z.string().min(1).max(2_000).optional(),
  phase: z.string().min(1).max(500).optional(),
  checkpoint: workflowCheckpointSchema,
});
export type HandoffWorkInput = z.infer<typeof handoffWorkSchema>;
