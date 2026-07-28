import { z } from "zod";
import { actorFields, arrayable, booleanQuery, nullableText, refSchema } from "./common.js";
import { nullableContextContentSchema, replaceContextSchema } from "./context.js";
import { taskPrioritySchema, taskStatusSchema } from "./enums.js";
export {
  clearCriterionEvidencePolicySchema,
  criterionEvidencePolicySchema,
  criterionEvidenceSchema,
  type ClearCriterionEvidencePolicyInput,
  type CriterionEvidenceInput,
  type CriterionEvidencePolicyInput,
} from "./evidence.js";

export const createTaskSchema = z.strictObject({
  title: z.string().min(1).max(300),
  description: nullableText,
  context: nullableContextContentSchema.optional(),
  status: taskStatusSchema.optional(),
  priority: taskPrioritySchema.optional(),
  parentTask: refSchema.nullable().optional(),
  sortOrder: z.number().optional(),
  acceptanceCriteria: z.array(z.string().min(1).max(2000)).optional(),
  dependencies: z.array(refSchema).optional(),
  ...actorFields,
});
export type CreateTaskInput = z.infer<typeof createTaskSchema>;

export const createTasksSchema = z.strictObject({
  tasks: z.array(createTaskSchema.omit({ actor: true, sessionId: true })).min(1).max(200),
  ...actorFields,
});
export type CreateTasksInput = z.infer<typeof createTasksSchema>;

export const updateTaskSchema = z.strictObject({
  title: z.string().min(1).max(300).optional(),
  description: nullableText,
  context: nullableContextContentSchema.optional(),
  expectedContextVersion: z.number().int().min(0).optional(),
  contextReason: z.string().min(1).max(2000).optional(),
  status: taskStatusSchema.optional(),
  priority: taskPrioritySchema.optional(),
  parentTask: refSchema.nullable().optional(),
  sortOrder: z.number().optional(),
  ...actorFields,
}).superRefine((value, context) => {
  if (value.context !== undefined && value.expectedContextVersion === undefined) {
    context.addIssue({
      code: "custom",
      path: ["expectedContextVersion"],
      message: "expectedContextVersion is required when replacing context.",
    });
  }
  if (value.context === undefined && value.contextReason !== undefined) {
    context.addIssue({
      code: "custom",
      path: ["contextReason"],
      message: "contextReason may only be supplied when replacing context.",
    });
  }
});
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;

export const updateTaskContextSchema = replaceContextSchema;
export type UpdateTaskContextInput = z.infer<typeof updateTaskContextSchema>;

export const listTasksQuerySchema = z.object({
  status: arrayable(taskStatusSchema).optional(),
  priority: arrayable(taskPrioritySchema).optional(),
  actionable: booleanQuery.optional(),
  claimed: booleanQuery.optional(),
  blocked: booleanQuery.optional(),
  parent: refSchema.optional(),
  search: z.string().max(200).optional(),
});
export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>;

export const completeTaskSchema = z
  .strictObject({
    force: z.boolean().default(false),
    reason: z.string().min(1).max(2000).optional(),
    ...actorFields,
  })
  .refine((value) => !value.force || Boolean(value.reason), {
    message: "A reason is required when forcing completion.",
    path: ["reason"],
  });
export type CompleteTaskInput = z.infer<typeof completeTaskSchema>;

export const claimTaskSchema = z.strictObject({
  actor: z.string().min(1).max(120),
  sessionId: z.string().min(1).max(200).optional(),
  ttlMinutes: z.number().int().min(1).max(24 * 60).optional(),
});
export type ClaimTaskInput = z.infer<typeof claimTaskSchema>;

export const renewClaimSchema = z.strictObject({
  actor: z.string().min(1).max(120),
  sessionId: z.string().min(1).max(200).optional(),
  ttlMinutes: z.number().int().min(1).max(24 * 60).optional(),
});
export type RenewClaimInput = z.infer<typeof renewClaimSchema>;

export const releaseClaimSchema = z.strictObject({
  reason: z.string().max(2000).optional(),
  /** Omitting the actor performs a forced release, which the human UI allows. */
  ...actorFields,
});
export type ReleaseClaimInput = z.infer<typeof releaseClaimSchema>;

export const addProgressSchema = z.strictObject({
  content: z.string().min(1).max(20_000),
  ...actorFields,
});
export type AddProgressInput = z.infer<typeof addProgressSchema>;

export const addBlockerSchema = z.strictObject({
  description: z.string().min(1).max(5000),
  requiredAction: z.string().max(5000).nullable().optional(),
  ...actorFields,
});
export type AddBlockerInput = z.infer<typeof addBlockerSchema>;

export const resolveBlockerSchema = z.strictObject({
  resolution: z.string().min(1).max(5000),
  ...actorFields,
});
export type ResolveBlockerInput = z.infer<typeof resolveBlockerSchema>;

export const addAcceptanceCriteriaSchema = z.strictObject({
  criteria: z.array(z.string().min(1).max(2000)).min(1).max(100),
  ...actorFields,
});
export type AddAcceptanceCriteriaInput = z.infer<typeof addAcceptanceCriteriaSchema>;

export const updateAcceptanceCriteriaSchema = z.strictObject({
  complete: z.array(z.string().min(1)).optional(),
  reopen: z.array(z.string().min(1)).optional(),
  ...actorFields,
});
export type UpdateAcceptanceCriteriaInput = z.infer<typeof updateAcceptanceCriteriaSchema>;

export const deleteTaskSchema = z.strictObject({
  /** Required to delete a task another agent currently holds a claim on. */
  force: z.boolean().default(false),
  ...actorFields,
});
export type DeleteTaskInput = z.infer<typeof deleteTaskSchema>;

export const addDependencySchema = z.strictObject({
  dependsOn: refSchema,
  ...actorFields,
});
export type AddDependencyInput = z.infer<typeof addDependencySchema>;

export const heartbeatSchema = z.strictObject({ actor: z.string().min(1).max(120), sessionId: z.string().min(1).max(200).optional(), phase: z.string().min(1).max(500).optional() });
export type HeartbeatInput = z.infer<typeof heartbeatSchema>;
export const checkpointSchema = z.strictObject({ completed: z.string().min(1).max(20_000), workingOn: z.string().min(1).max(20_000), next: z.string().min(1).max(20_000), uncertainty: z.string().max(20_000).nullable().optional(), ...actorFields });
export type CheckpointInput = z.infer<typeof checkpointSchema>;
export const workPlanSchema = z.strictObject({ items: z.array(z.string().min(1).max(2_000)).min(1).max(100), ...actorFields });
export type WorkPlanInput = z.infer<typeof workPlanSchema>;
export const updateWorkPlanItemSchema = z.strictObject({ status: z.enum(["pending", "active", "completed", "skipped"]), ...actorFields });
export type UpdateWorkPlanItemInput = z.infer<typeof updateWorkPlanItemSchema>;
export const executionOriginSchema = z.strictObject({ provider: z.string().min(1).max(120), reference: z.string().min(1).max(2000), url: z.string().url().max(4000).nullable().optional(), metadata: z.record(z.string(), z.unknown()).nullable().optional() });
export type ExecutionOriginInput = z.infer<typeof executionOriginSchema>;
