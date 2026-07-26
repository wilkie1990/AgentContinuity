import { AgentContinuityError, isUuid, normaliseKey } from "@agent-continuity/contracts";
import {
  acceptanceCriteria,
  blockers,
  decisions,
  links,
  projects,
  tasks,
  type AcceptanceCriterionRow,
  type BlockerRow,
  type DecisionRow,
  type LinkRow,
  type ProjectRow,
  type TaskRow,
} from "@agent-continuity/database";
import { eq, or } from "drizzle-orm";
import type { Runtime } from "./runtime.js";

/**
 * Public references may be a UUID or a human readable key (`TASK-42`, `task-0042`).
 * Everything else is looked up as an id so a bad reference simply misses.
 */
function keyCandidates(ref: string): { id: string; key: string | null } {
  const trimmed = ref.trim();
  return { id: trimmed, key: isUuid(trimmed) ? null : normaliseKey(trimmed) };
}

export function findProject(runtime: Runtime, ref: string): ProjectRow | undefined {
  const { id, key } = keyCandidates(ref);
  return runtime.db
    .select()
    .from(projects)
    .where(key ? or(eq(projects.id, id), eq(projects.key, key)) : eq(projects.id, id))
    .get();
}

export function requireProject(runtime: Runtime, ref: string): ProjectRow {
  const project = findProject(runtime, ref);
  if (!project) {
    throw new AgentContinuityError("PROJECT_NOT_FOUND", `No project matches "${ref}".`, { ref });
  }
  return project;
}

/** Mutations are rejected on archived projects; reads remain available. */
export function requireWritableProject(runtime: Runtime, ref: string): ProjectRow {
  const project = requireProject(runtime, ref);
  assertWritable(project);
  return project;
}

export function assertWritable(project: ProjectRow): void {
  if (project.status === "archived") {
    throw new AgentContinuityError(
      "PROJECT_ARCHIVED",
      `${project.key} is archived and cannot be modified.`,
      { project: project.key },
    );
  }
}

export function findTask(runtime: Runtime, ref: string): TaskRow | undefined {
  const { id, key } = keyCandidates(ref);
  return runtime.db
    .select()
    .from(tasks)
    .where(key ? or(eq(tasks.id, id), eq(tasks.key, key)) : eq(tasks.id, id))
    .get();
}

export function requireTask(runtime: Runtime, ref: string): TaskRow {
  const task = findTask(runtime, ref);
  if (!task) {
    throw new AgentContinuityError("TASK_NOT_FOUND", `No task matches "${ref}".`, { ref });
  }
  return task;
}

export function requireBlocker(runtime: Runtime, ref: string): BlockerRow {
  const { id, key } = keyCandidates(ref);
  const blocker = runtime.db
    .select()
    .from(blockers)
    .where(key ? or(eq(blockers.id, id), eq(blockers.key, key)) : eq(blockers.id, id))
    .get();
  if (!blocker) {
    throw new AgentContinuityError("BLOCKER_NOT_FOUND", `No blocker matches "${ref}".`, { ref });
  }
  return blocker;
}

export function requireDecision(runtime: Runtime, ref: string): DecisionRow {
  const { id, key } = keyCandidates(ref);
  const decision = runtime.db
    .select()
    .from(decisions)
    .where(key ? or(eq(decisions.id, id), eq(decisions.key, key)) : eq(decisions.id, id))
    .get();
  if (!decision) {
    throw new AgentContinuityError("DECISION_NOT_FOUND", `No decision matches "${ref}".`, { ref });
  }
  return decision;
}

export function requireLink(runtime: Runtime, ref: string): LinkRow {
  const { id, key } = keyCandidates(ref);
  const link = runtime.db
    .select()
    .from(links)
    .where(key ? or(eq(links.id, id), eq(links.key, key)) : eq(links.id, id))
    .get();
  if (!link) {
    throw new AgentContinuityError("LINK_NOT_FOUND", `No link matches "${ref}".`, { ref });
  }
  return link;
}

/** Used by REST routes that address a criterion directly, without naming its task. */
export function requireCriterionById(runtime: Runtime, id: string): AcceptanceCriterionRow {
  const row = runtime.db
    .select()
    .from(acceptanceCriteria)
    .where(eq(acceptanceCriteria.id, id.trim()))
    .get();
  if (!row) {
    throw new AgentContinuityError(
      "ACCEPTANCE_CRITERION_NOT_FOUND",
      `No acceptance criterion matches "${id}".`,
      { ref: id },
    );
  }
  return row;
}

/** Acceptance criteria have no public key, so they are addressed by id or exact description. */
export function requireCriterion(
  runtime: Runtime,
  taskId: string,
  ref: string,
): AcceptanceCriterionRow {
  const rows = runtime.db
    .select()
    .from(acceptanceCriteria)
    .where(eq(acceptanceCriteria.taskId, taskId))
    .all();

  const trimmed = ref.trim();
  const match =
    rows.find((row) => row.id === trimmed) ??
    rows.find((row) => row.description.trim() === trimmed) ??
    rows.find((row) => row.description.trim().toLowerCase() === trimmed.toLowerCase());

  if (!match) {
    throw new AgentContinuityError(
      "ACCEPTANCE_CRITERION_NOT_FOUND",
      `No acceptance criterion matches "${ref}" on this task.`,
      { ref },
    );
  }
  return match;
}
