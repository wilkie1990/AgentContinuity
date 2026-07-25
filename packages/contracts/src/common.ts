import { z } from "zod";

/** Free text supplied by an agent identifying itself, e.g. "claude-code" or "codex". */
export const actorSchema = z.string().min(1).max(120);
export const sessionIdSchema = z.string().min(1).max(200);

/** A project/task/decision reference: either a UUID or a human readable key such as TASK-0042. */
export const refSchema = z.string().min(1).max(200);

export const actorFields = {
  actor: actorSchema.optional(),
  sessionId: sessionIdSchema.optional(),
};

/** Optional free text that may be explicitly cleared by passing null. */
export const nullableText = z.string().max(100_000).nullable().optional();

/** Accepts `?status=ready&status=done` as well as a single value, always yielding an array. */
export function arrayable<T extends z.ZodType>(schema: T) {
  return z.preprocess(
    (value) => (value === undefined ? undefined : Array.isArray(value) ? value : [value]),
    z.array(schema),
  );
}

/** Query strings carry booleans as text; `z.coerce.boolean()` would treat "false" as true. */
export const booleanQuery = z.union([
  z.boolean(),
  z.enum(["true", "false", "1", "0"]).transform((value) => value === "true" || value === "1"),
]);

export const metadataSchema = z.record(z.string(), z.unknown());

/**
 * Renames snake_case keys onto their camelCase contract names before validation.
 *
 * The bootstrap document is the one payload shared between the snake_case MCP tool and
 * the camelCase REST body, so a plan written for one must not silently lose fields when
 * sent to the other. An explicit camelCase key always wins over its alias.
 */
export function withSnakeCaseAliases<Schema extends z.ZodType>(
  schema: Schema,
  aliases: Record<string, string>,
): z.ZodType<z.infer<Schema>, unknown> {
  return z.preprocess((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;

    const source = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};

    for (const [key, entry] of Object.entries(source)) {
      if (!(key in aliases)) result[key] = entry;
    }
    for (const [key, entry] of Object.entries(source)) {
      const target = aliases[key];
      if (target !== undefined && !(target in result)) result[target] = entry;
    }
    return result;
  }, schema) as z.ZodType<z.infer<Schema>, unknown>;
}
