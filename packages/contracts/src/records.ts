import { z } from "zod";
import { actorFields, arrayable, metadataSchema, refSchema } from "./common.js";
import { activityEventTypeSchema } from "./enums.js";

export const createDecisionSchema = z.strictObject({
  task: refSchema.nullable().optional(),
  title: z.string().min(1).max(300),
  decision: z.string().min(1).max(20_000),
  rationale: z.string().max(20_000).nullable().optional(),
  supersedes: refSchema.nullable().optional(),
  ...actorFields,
});
export type CreateDecisionInput = z.infer<typeof createDecisionSchema>;

export const listDecisionsQuerySchema = z.object({
  task: refSchema.optional(),
  search: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
export type ListDecisionsQuery = z.infer<typeof listDecisionsQuerySchema>;

export const linkInputSchema = z.strictObject({
  task: refSchema.nullable().optional(),
  type: z.string().min(1).max(80),
  provider: z.string().max(80).nullable().optional(),
  reference: z.string().max(500).nullable().optional(),
  url: z.string().max(2000).nullable().optional(),
  metadata: metadataSchema.nullable().optional(),
});
export type LinkInput = z.infer<typeof linkInputSchema>;

/** Accepts either a batch (`links: [...]`) or a single inline link, so REST and MCP share one shape. */
export const addLinksSchema = z
  .strictObject({
    /** Default task scope applied to any link that does not specify its own. */
    task: refSchema.nullable().optional(),
    links: z.array(linkInputSchema).min(1).max(100).optional(),
    type: z.string().min(1).max(80).optional(),
    provider: z.string().max(80).nullable().optional(),
    reference: z.string().max(500).nullable().optional(),
    url: z.string().max(2000).nullable().optional(),
    metadata: metadataSchema.nullable().optional(),
    ...actorFields,
  })
  .refine((value) => (value.links?.length ?? 0) > 0 || Boolean(value.type), {
    message: "Provide either a `links` array or a single link `type`.",
    path: ["links"],
  });
export type AddLinksInput = z.infer<typeof addLinksSchema>;

export const listLinksQuerySchema = z.object({
  task: refSchema.optional(),
  type: z.string().max(80).optional(),
  provider: z.string().max(80).optional(),
});
export type ListLinksQuery = z.infer<typeof listLinksQuerySchema>;

export const listActivityQuerySchema = z.object({
  task: refSchema.optional(),
  eventType: arrayable(activityEventTypeSchema).optional(),
  actor: z.string().max(120).optional(),
  after: z.string().max(40).optional(),
  before: z.string().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().max(500).optional(),
});
export type ListActivityQuery = z.infer<typeof listActivityQuerySchema>;
