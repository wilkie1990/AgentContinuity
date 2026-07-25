import { index, integer, primaryKey, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const projects = sqliteTable(
  "projects",
  {
    id: text("id").primaryKey(),
    key: text("key").notNull().unique(),
    name: text("name").notNull(),
    objective: text("objective"),
    description: text("description"),
    context: text("context"),
    status: text("status").notNull().default("active"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    archivedAt: text("archived_at"),
  },
  (table) => [
    index("projects_status_idx").on(table.status),
    index("projects_updated_at_idx").on(table.updatedAt),
  ],
);

export const tasks = sqliteTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    key: text("key").notNull().unique(),
    projectId: text("project_id").notNull(),
    parentTaskId: text("parent_task_id"),
    title: text("title").notNull(),
    description: text("description"),
    context: text("context"),
    status: text("status").notNull().default("backlog"),
    priority: text("priority").notNull().default("normal"),
    sortOrder: real("sort_order").notNull().default(0),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    completedAt: text("completed_at"),
  },
  (table) => [
    index("tasks_project_id_idx").on(table.projectId),
    index("tasks_status_idx").on(table.status),
    index("tasks_priority_idx").on(table.priority),
    index("tasks_parent_task_id_idx").on(table.parentTaskId),
    index("tasks_updated_at_idx").on(table.updatedAt),
  ],
);

export const acceptanceCriteria = sqliteTable(
  "acceptance_criteria",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id").notNull(),
    description: text("description").notNull(),
    isComplete: integer("is_complete").notNull().default(0),
    sortOrder: real("sort_order").notNull().default(0),
    createdAt: text("created_at").notNull(),
    completedAt: text("completed_at"),
  },
  (table) => [index("acceptance_criteria_task_id_idx").on(table.taskId)],
);

export const taskDependencies = sqliteTable(
  "task_dependencies",
  {
    taskId: text("task_id").notNull(),
    dependsOnTaskId: text("depends_on_task_id").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.taskId, table.dependsOnTaskId] }),
    index("task_dependencies_depends_on_idx").on(table.dependsOnTaskId),
  ],
);

export const taskClaims = sqliteTable(
  "task_claims",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id").notNull(),
    actor: text("actor").notNull(),
    sessionId: text("session_id"),
    claimedAt: text("claimed_at").notNull(),
    lastActiveAt: text("last_active_at").notNull(),
    expiresAt: text("expires_at").notNull(),
    releasedAt: text("released_at"),
    releaseReason: text("release_reason"),
    expiryRecordedAt: text("expiry_recorded_at"),
  },
  (table) => [
    index("task_claims_task_id_idx").on(table.taskId),
    index("task_claims_expires_at_idx").on(table.expiresAt),
    index("task_claims_actor_idx").on(table.actor),
  ],
);

export const taskProgress = sqliteTable(
  "task_progress",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id").notNull(),
    content: text("content").notNull(),
    actor: text("actor"),
    sessionId: text("session_id"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("task_progress_task_id_idx").on(table.taskId),
    index("task_progress_created_at_idx").on(table.createdAt),
  ],
);

export const blockers = sqliteTable(
  "blockers",
  {
    id: text("id").primaryKey(),
    key: text("key").notNull().unique(),
    taskId: text("task_id").notNull(),
    description: text("description").notNull(),
    requiredAction: text("required_action"),
    createdBy: text("created_by"),
    createdAt: text("created_at").notNull(),
    resolvedAt: text("resolved_at"),
    resolvedBy: text("resolved_by"),
    resolution: text("resolution"),
  },
  (table) => [
    index("blockers_task_id_idx").on(table.taskId),
    index("blockers_resolved_at_idx").on(table.resolvedAt),
  ],
);

export const decisions = sqliteTable(
  "decisions",
  {
    id: text("id").primaryKey(),
    key: text("key").notNull().unique(),
    projectId: text("project_id").notNull(),
    taskId: text("task_id"),
    title: text("title").notNull(),
    decision: text("decision").notNull(),
    rationale: text("rationale"),
    createdBy: text("created_by"),
    sessionId: text("session_id"),
    createdAt: text("created_at").notNull(),
    supersededAt: text("superseded_at"),
    supersededById: text("superseded_by_id"),
  },
  (table) => [
    index("decisions_project_id_idx").on(table.projectId),
    index("decisions_task_id_idx").on(table.taskId),
    index("decisions_created_at_idx").on(table.createdAt),
  ],
);

export const links = sqliteTable(
  "links",
  {
    id: text("id").primaryKey(),
    key: text("key").notNull().unique(),
    projectId: text("project_id").notNull(),
    taskId: text("task_id"),
    type: text("type").notNull(),
    provider: text("provider"),
    reference: text("reference"),
    url: text("url"),
    metadataJson: text("metadata_json"),
    createdBy: text("created_by"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("links_project_id_idx").on(table.projectId),
    index("links_task_id_idx").on(table.taskId),
    index("links_type_idx").on(table.type),
  ],
);

export const activityEvents = sqliteTable(
  "activity_events",
  {
    /** Monotonic insertion order; the timeline and its cursors are ordered by this. */
    seq: integer("seq").primaryKey({ autoIncrement: true }),
    id: text("id").notNull().unique(),
    projectId: text("project_id").notNull(),
    taskId: text("task_id"),
    eventType: text("event_type").notNull(),
    actor: text("actor"),
    sessionId: text("session_id"),
    payloadJson: text("payload_json").notNull().default("{}"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("activity_project_id_idx").on(table.projectId, table.seq),
    index("activity_task_id_idx").on(table.taskId, table.seq),
    index("activity_event_type_idx").on(table.eventType),
    index("activity_created_at_idx").on(table.createdAt),
  ],
);

export const counters = sqliteTable("counters", {
  entityType: text("entity_type").primaryKey(),
  currentValue: integer("current_value").notNull().default(0),
});

export type ProjectRow = typeof projects.$inferSelect;
export type TaskRow = typeof tasks.$inferSelect;
export type AcceptanceCriterionRow = typeof acceptanceCriteria.$inferSelect;
export type TaskDependencyRow = typeof taskDependencies.$inferSelect;
export type TaskClaimRow = typeof taskClaims.$inferSelect;
export type TaskProgressRow = typeof taskProgress.$inferSelect;
export type BlockerRow = typeof blockers.$inferSelect;
export type DecisionRow = typeof decisions.$inferSelect;
export type LinkRow = typeof links.$inferSelect;
export type ActivityEventRow = typeof activityEvents.$inferSelect;
