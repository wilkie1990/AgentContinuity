import { z } from "zod";
import { actorFields, arrayable, nullableText } from "./common.js";
import { projectSortSchema, projectStatusSchema } from "./enums.js";

export const createProjectSchema = z.strictObject({
  name: z.string().min(1).max(200),
  objective: nullableText,
  description: nullableText,
  context: nullableText,
  status: projectStatusSchema.optional(),
  ...actorFields,
});
export type CreateProjectInput = z.infer<typeof createProjectSchema>;

export const updateProjectSchema = z.strictObject({
  name: z.string().min(1).max(200).optional(),
  objective: nullableText,
  description: nullableText,
  status: projectStatusSchema.optional(),
  ...actorFields,
});
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;

export const updateProjectContextSchema = z.strictObject({
  context: z.string().max(1_000_000),
  ...actorFields,
});
export type UpdateProjectContextInput = z.infer<typeof updateProjectContextSchema>;

export const archiveProjectSchema = z.strictObject({ ...actorFields });
export type ArchiveProjectInput = z.infer<typeof archiveProjectSchema>;

export const listProjectsQuerySchema = z.object({
  status: arrayable(projectStatusSchema).optional(),
  search: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  sort: projectSortSchema.default("updated_at_desc"),
});
export type ListProjectsQuery = z.infer<typeof listProjectsQuerySchema>;
