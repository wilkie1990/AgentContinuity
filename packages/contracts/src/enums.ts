import { z } from "zod";

export const projectStatusSchema = z.enum(["active", "paused", "completed", "archived"]);
export type ProjectStatus = z.infer<typeof projectStatusSchema>;

export const taskStatusSchema = z.enum([
  "backlog",
  "ready",
  "in_progress",
  "blocked",
  "review",
  "done",
]);
export type TaskStatus = z.infer<typeof taskStatusSchema>;

export const TASK_STATUSES: readonly TaskStatus[] = taskStatusSchema.options;

export const taskPrioritySchema = z.enum(["low", "normal", "high", "critical"]);
export type TaskPriority = z.infer<typeof taskPrioritySchema>;

export const TASK_PRIORITIES: readonly TaskPriority[] = taskPrioritySchema.options;

/**
 * Every domain mutation recorded in the activity stream.
 * The relational tables remain the source of truth for current state; this is history.
 */
export const activityEventTypeSchema = z.enum([
  "project.created",
  "project.updated",
  "project.context_updated",
  "project.archived",
  "task.created",
  "task.updated",
  "task.context_updated",
  "task.status_changed",
  "task.completed",
  "task.reopened",
  "task.deleted",
  "task.claimed",
  "task.claim_renewed",
  "task.claim_released",
  "task.claim_expired",
  "task.progress_added",
  "task.blocked",
  "task.blocker_resolved",
  "acceptance_criterion.created",
  "acceptance_criterion.completed",
  "acceptance_criterion.reopened",
  "dependency.added",
  "dependency.removed",
  "decision.recorded",
  "decision.superseded",
  "link.added",
  "link.removed",
]);
export type ActivityEventType = z.infer<typeof activityEventTypeSchema>;

export const ACTIVITY_EVENT_TYPES: readonly ActivityEventType[] = activityEventTypeSchema.options;

export const projectSortSchema = z.enum([
  "updated_at_desc",
  "updated_at_asc",
  "created_at_desc",
  "name_asc",
]);
export type ProjectSort = z.infer<typeof projectSortSchema>;
