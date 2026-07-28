import { z } from "zod";
import { actorFields, metadataSchema, nullableText, withSnakeCaseAliases } from "./common.js";
import { nullableContextContentSchema } from "./context.js";
import { taskPrioritySchema, taskStatusSchema } from "./enums.js";

/** A temporary reference used only inside a bootstrap request, e.g. "task-model". */
const bootstrapRefSchema = z.string().min(1).max(120);

/**
 * Every object below is strict. Bootstrap promises to create a whole plan or nothing, so
 * an unrecognised field must fail loudly rather than be dropped — silently discarding a
 * task's acceptance criteria or dependencies is the worst outcome this operation has.
 */
export const bootstrapLinkSchema = z.strictObject({
  taskRef: bootstrapRefSchema.optional(),
  type: z.string().min(1).max(80),
  provider: z.string().max(80).nullable().optional(),
  reference: z.string().max(500).nullable().optional(),
  url: z.string().max(2000).nullable().optional(),
  metadata: metadataSchema.nullable().optional(),
});
export type BootstrapLink = z.infer<typeof bootstrapLinkSchema>;

const linkInput = withSnakeCaseAliases(bootstrapLinkSchema, { task_ref: "taskRef" });
const taskLinkInput = withSnakeCaseAliases(bootstrapLinkSchema.omit({ taskRef: true }), {});

export const bootstrapTaskSchema = z.strictObject({
  ref: bootstrapRefSchema.optional().describe("Temporary reference used by dependsOn"),
  title: z.string().min(1).max(300),
  description: nullableText,
  context: nullableContextContentSchema.optional(),
  status: taskStatusSchema.optional(),
  priority: taskPrioritySchema.optional(),
  acceptanceCriteria: z.array(z.string().min(1).max(2000)).optional(),
  dependsOn: z.array(bootstrapRefSchema).optional(),
  /** Extension beyond the minimum contract: lets a plan describe subtasks. */
  parentRef: bootstrapRefSchema.optional(),
  links: z.array(taskLinkInput).optional(),
});
export type BootstrapTask = z.infer<typeof bootstrapTaskSchema>;

const taskInput = withSnakeCaseAliases(bootstrapTaskSchema, {
  acceptance_criteria: "acceptanceCriteria",
  depends_on: "dependsOn",
  parent_ref: "parentRef",
});

export const bootstrapDecisionSchema = z.strictObject({
  title: z.string().min(1).max(300),
  decision: z.string().min(1).max(20_000),
  rationale: z.string().max(20_000).nullable().optional(),
  taskRef: bootstrapRefSchema.optional(),
});
export type BootstrapDecision = z.infer<typeof bootstrapDecisionSchema>;

const decisionInput = withSnakeCaseAliases(bootstrapDecisionSchema, { task_ref: "taskRef" });

const bootstrapProjectObject = z.strictObject({
  name: z.string().min(1).max(200),
  objective: nullableText,
  description: nullableText,
  context: nullableContextContentSchema.optional(),
  tasks: z.array(taskInput).max(500).optional(),
  decisions: z.array(decisionInput).max(200).optional(),
  links: z.array(linkInput).max(200).optional(),
  ...actorFields,
});

export const bootstrapProjectSchema = withSnakeCaseAliases(bootstrapProjectObject, {
  session_id: "sessionId",
});
export type BootstrapProjectRequest = z.infer<typeof bootstrapProjectObject>;
