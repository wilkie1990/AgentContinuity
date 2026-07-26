import { AgentContinuityError } from "@agent-continuity/contracts";
import type { z } from "zod";

/**
 * Parses a request payload with a contract schema, converting Zod issues into the
 * standard error envelope so every transport reports validation the same way.
 */
export function parse<Schema extends z.ZodType>(
  schema: Schema,
  payload: unknown,
  source: "body" | "query" | "params" = "body",
): z.infer<Schema> {
  const result = schema.safeParse(payload ?? {});
  if (result.success) return result.data;

  const issues = result.error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));

  const summary = issues
    .map((issue) => (issue.path ? `${issue.path}: ${issue.message}` : issue.message))
    .join("; ");

  throw new AgentContinuityError("VALIDATION_ERROR", `Invalid request ${source}. ${summary}`, {
    source,
    issues,
  });
}
