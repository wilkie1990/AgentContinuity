import { z } from "zod";
import { actorFields, actorSchema, refSchema, sessionIdSchema } from "./common.js";

const localPathSchema = z.string().min(1).max(16_384);
const remoteUrlSchema = z.string().min(1).max(4_000);

export const createRepositorySchema = z.strictObject({
  label: z.string().min(1).max(200),
  rootPath: localPathSchema,
  remoteUrl: remoteUrlSchema.nullable().optional(),
  primary: z.boolean().optional(),
  ...actorFields,
});
export type CreateRepositoryInput = z.infer<typeof createRepositorySchema>;

export const updateRepositorySchema = z.strictObject({
  label: z.string().min(1).max(200).optional(),
  rootPath: localPathSchema.optional(),
  remoteUrl: remoteUrlSchema.nullable().optional(),
  /** Primary status is transferred, not toggled off, so a project cannot accidentally lose it. */
  primary: z.literal(true).optional(),
  ...actorFields,
});
export type UpdateRepositoryInput = z.infer<typeof updateRepositorySchema>;

export const removeRepositorySchema = z.strictObject({
  /**
   * Allows removal of bindings belonging only to ended executions. A running execution
   * always blocks removal.
   */
  force: z.boolean().default(false),
  ...actorFields,
});
export type RemoveRepositoryInput = z.infer<typeof removeRepositorySchema>;

export const bindExecutionWorktreeSchema = z.strictObject({
  repository: refSchema,
  worktreePath: localPathSchema,
  branch: z.string().min(1).max(500).nullable().optional(),
  actor: actorSchema,
  sessionId: sessionIdSchema.optional(),
});
export type BindExecutionWorktreeInput = z.infer<typeof bindExecutionWorktreeSchema>;

export const unbindExecutionWorktreeSchema = z.strictObject({
  actor: actorSchema,
  sessionId: sessionIdSchema.optional(),
});
export type UnbindExecutionWorktreeInput = z.infer<typeof unbindExecutionWorktreeSchema>;
