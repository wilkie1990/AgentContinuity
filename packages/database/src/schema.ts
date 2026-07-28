import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const projects = sqliteTable(
  "projects",
  {
    id: text("id").primaryKey(),
    key: text("key").notNull().unique(),
    name: text("name").notNull(),
    objective: text("objective"),
    description: text("description"),
    context: text("context"),
    contextVersion: integer("context_version").notNull().default(0),
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
    contextVersion: integer("context_version").notNull().default(0),
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

/** A provider-neutral run of work. Claims are leases; executions are durable history. */
export const taskExecutions = sqliteTable(
  "task_executions",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id").notNull(),
    claimId: text("claim_id"),
    actor: text("actor").notNull(),
    sessionId: text("session_id"),
    status: text("status").notNull().default("running"),
    currentPhase: text("current_phase"),
    startedAt: text("started_at").notNull(),
    resumedAt: text("resumed_at"),
    lastHeartbeatAt: text("last_heartbeat_at").notNull(),
    endedAt: text("ended_at"),
    terminationReason: text("termination_reason"),
  },
  (table) => [
    index("task_executions_task_id_idx").on(table.taskId),
    index("task_executions_claim_id_idx").on(table.claimId),
    index("task_executions_status_idx").on(table.status),
  ],
);

/** A project-scoped local repository identity. Paths are explicit and never inferred from cwd. */
export const repositories = sqliteTable(
  "repositories",
  {
    id: text("id").primaryKey(),
    key: text("key").notNull().unique(),
    projectId: text("project_id").notNull(),
    label: text("label").notNull(),
    canonicalRootPath: text("canonical_root_path").notNull(),
    canonicalRootPathKey: text("canonical_root_path_key").notNull(),
    remoteUrl: text("remote_url"),
    isPrimary: integer("is_primary").notNull().default(0),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("repositories_project_id_idx").on(table.projectId),
    index("repositories_root_path_key_idx").on(table.projectId, table.canonicalRootPathKey),
  ],
);

/** The concrete worktree used by one execution; linked worktrees may live outside the main root. */
export const executionWorktrees = sqliteTable(
  "execution_worktrees",
  {
    id: text("id").primaryKey(),
    executionId: text("execution_id").notNull().unique(),
    repositoryId: text("repository_id").notNull(),
    worktreePath: text("worktree_path").notNull(),
    worktreePathKey: text("worktree_path_key").notNull(),
    branch: text("branch"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("execution_worktrees_repository_id_idx").on(table.repositoryId),
    index("execution_worktrees_path_key_idx").on(table.worktreePathKey),
  ],
);

/** Immutable start state derived from the execution's explicit worktree binding. */
export const executionGitBaselines = sqliteTable(
  "execution_git_baselines",
  {
    id: text("id").primaryKey(),
    executionId: text("execution_id").notNull().unique(),
    worktreeId: text("worktree_id").notNull(),
    repositoryId: text("repository_id").notNull(),
    worktreePathKey: text("worktree_path_key").notNull(),
    source: text("source").notNull(),
    status: text("status").notNull(),
    branch: text("branch"),
    detached: integer("detached").notNull().default(0),
    headSha: text("head_sha"),
    dirty: integer("dirty"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    capturedAt: text("captured_at").notNull(),
  },
  (table) => [
    index("execution_git_baselines_repository_id_idx").on(table.repositoryId),
  ],
);

/** Point-in-time Git state relative to the execution baseline. */
export const executionGitSnapshots = sqliteTable(
  "execution_git_snapshots",
  {
    id: text("id").primaryKey(),
    baselineId: text("baseline_id").notNull(),
    executionId: text("execution_id").notNull(),
    sequence: integer("sequence").notNull(),
    checkpointId: text("checkpoint_id"),
    trigger: text("trigger").notNull(),
    source: text("source").notNull(),
    status: text("status").notNull(),
    branch: text("branch"),
    detached: integer("detached").notNull().default(0),
    headSha: text("head_sha"),
    dirty: integer("dirty"),
    commitShasJson: text("commit_shas_json").notNull().default("[]"),
    additions: integer("additions").notNull().default(0),
    deletions: integer("deletions").notNull().default(0),
    filesChanged: integer("files_changed").notNull().default(0),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    capturedAt: text("captured_at").notNull(),
  },
  (table) => [
    index("execution_git_snapshots_execution_id_idx").on(table.executionId, table.sequence),
    index("execution_git_snapshots_checkpoint_id_idx").on(table.checkpointId),
  ],
);

/** Stable structured input for downstream collision and ownership analysis. */
export const executionGitTouchedPaths = sqliteTable(
  "execution_git_touched_paths",
  {
    id: text("id").primaryKey(),
    snapshotId: text("snapshot_id").notNull(),
    path: text("path").notNull(),
    previousPath: text("previous_path"),
    changeKind: text("change_kind").notNull(),
    additions: integer("additions"),
    deletions: integer("deletions"),
  },
  (table) => [
    index("execution_git_touched_paths_snapshot_id_idx").on(table.snapshotId),
    index("execution_git_touched_paths_path_idx").on(table.path),
  ],
);

/** Immutable revisions keep declared ownership history while one revision remains live. */
export const executionPathOwnershipRevisions = sqliteTable(
  "execution_path_ownership_revisions",
  {
    id: text("id").primaryKey(),
    executionId: text("execution_id")
      .notNull()
      .references(() => taskExecutions.id, { onDelete: "cascade" }),
    repositoryId: text("repository_id")
      .notNull()
      .references(() => repositories.id, { onDelete: "cascade" }),
    worktreeId: text("worktree_id")
      .notNull()
      .references(() => executionWorktrees.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    actor: text("actor").notNull(),
    sessionId: text("session_id"),
    createdAt: text("created_at").notNull(),
    supersededAt: text("superseded_at"),
  },
  (table) => [
    uniqueIndex("execution_path_ownership_revisions_execution_version_idx").on(
      table.executionId,
      table.version,
    ),
    index("execution_path_ownership_revisions_live_idx").on(
      table.executionId,
      table.supersededAt,
    ),
    index("execution_path_ownership_revisions_repository_idx").on(table.repositoryId),
  ],
);

export const executionPathOwnershipEntries = sqliteTable(
  "execution_path_ownership_entries",
  {
    id: text("id").primaryKey(),
    revisionId: text("revision_id")
      .notNull()
      .references(() => executionPathOwnershipRevisions.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    pathKey: text("path_key").notNull(),
    pathKind: text("path_kind").notNull(),
  },
  (table) => [
    uniqueIndex("execution_path_ownership_entries_revision_path_idx").on(
      table.revisionId,
      table.pathKey,
    ),
    index("execution_path_ownership_entries_revision_idx").on(table.revisionId),
    index("execution_path_ownership_entries_path_idx").on(table.pathKey),
  ],
);

export const executionOrigins = sqliteTable(
  "execution_origins",
  {
    id: text("id").primaryKey(),
    executionId: text("execution_id").notNull(),
    provider: text("provider").notNull(),
    reference: text("reference").notNull(),
    url: text("url"),
    metadataJson: text("metadata_json"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("execution_origins_execution_id_idx").on(table.executionId)],
);

export const taskCheckpoints = sqliteTable(
  "task_checkpoints",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id").notNull(),
    executionId: text("execution_id"),
    completed: text("completed").notNull(),
    workingOn: text("working_on").notNull(),
    next: text("next").notNull(),
    uncertainty: text("uncertainty"),
    actor: text("actor"),
    sessionId: text("session_id"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("task_checkpoints_task_id_idx").on(table.taskId),
    index("task_checkpoints_created_at_idx").on(table.createdAt),
  ],
);

export const taskWorkPlanItems = sqliteTable(
  "task_work_plan_items",
  {
    id: text("id").primaryKey(), taskId: text("task_id").notNull(), title: text("title").notNull(),
    status: text("status").notNull().default("pending"), sortOrder: real("sort_order").notNull(),
    createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull(), completedAt: text("completed_at"),
  },
  (table) => [index("task_work_plan_items_task_id_idx").on(table.taskId)],
);

export const taskHandoffs = sqliteTable(
  "task_handoffs",
  {
    id: text("id").primaryKey(), taskId: text("task_id").notNull(), executionId: text("execution_id"),
    reason: text("reason").notNull(), summary: text("summary").notNull(), nextAction: text("next_action"),
    unresolvedJson: text("unresolved_json").notNull().default("[]"), createdAt: text("created_at").notNull(),
  },
  (table) => [index("task_handoffs_task_id_idx").on(table.taskId)],
);

export const criterionEvidence = sqliteTable(
  "criterion_evidence",
  {
    id: text("id").primaryKey(), criterionId: text("criterion_id").notNull(), type: text("type").notNull(),
    reference: text("reference"), content: text("content"), url: text("url"), actor: text("actor"),
    sessionId: text("session_id"), createdAt: text("created_at").notNull(),
  },
  (table) => [index("criterion_evidence_criterion_id_idx").on(table.criterionId)],
);

export const criterionEvidenceDetails = sqliteTable(
  "criterion_evidence_details",
  {
    evidenceId: text("evidence_id").primaryKey(),
    kind: text("kind").notNull(),
    legacyType: text("legacy_type"),
    repositoryId: text("repository_id"),
    repositoryKey: text("repository_key"),
    repositoryLabel: text("repository_label"),
    worktreeId: text("worktree_id"),
    executionId: text("execution_id"),
    sha: text("sha"),
    verificationOutcome: text("verification_outcome"),
    payloadJson: text("payload_json").notNull(),
  },
  (table) => [
    index("criterion_evidence_details_kind_idx").on(table.kind),
    index("criterion_evidence_details_repository_idx").on(table.repositoryId),
    index("criterion_evidence_details_verification_outcome_idx").on(table.verificationOutcome),
  ],
);

export const criterionEvidencePolicies = sqliteTable(
  "criterion_evidence_policies",
  {
    criterionId: text("criterion_id").primaryKey(),
    minimumCount: integer("minimum_count").notNull(),
    qualifyingKindsJson: text("qualifying_kinds_json").notNull(),
    requireSha: integer("require_sha").notNull().default(0),
    requirePassingVerification: integer("require_passing_verification").notNull().default(0),
    actor: text("actor"),
    sessionId: text("session_id"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
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

/** Immutable history behind the current project/task context projections. */
export const contextVersions = sqliteTable(
  "context_versions",
  {
    id: text("id").primaryKey(),
    ownerType: text("owner_type").notNull(),
    ownerId: text("owner_id").notNull(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    taskId: text("task_id").references(() => tasks.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    content: text("content"),
    characterCount: integer("character_count").notNull(),
    byteCount: integer("byte_count").notNull(),
    actor: text("actor"),
    sessionId: text("session_id"),
    reason: text("reason"),
    revertedFromVersion: integer("reverted_from_version"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("context_versions_owner_version_idx").on(
      table.ownerType,
      table.ownerId,
      table.version,
    ),
    index("context_versions_owner_idx").on(table.ownerType, table.ownerId, table.version),
    index("context_versions_project_idx").on(table.projectId),
    index("context_versions_task_idx").on(table.taskId),
  ],
);

/**
 * Filterable metadata and canonical text backing the external-content FTS5 index.
 * The companion `search_documents_fts` virtual table is created in migration 0006
 * and deliberately omitted from Drizzle's relational schema.
 */
export const searchDocuments = sqliteTable(
  "search_documents",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sourceType: text("source_type").notNull(),
    sourceId: text("source_id").notNull(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    taskId: text("task_id").references(() => tasks.id, { onDelete: "cascade" }),
    projectKey: text("project_key").notNull(),
    taskKey: text("task_key"),
    sourceKey: text("source_key").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("search_documents_source_idx").on(table.sourceType, table.sourceId),
    index("search_documents_project_idx").on(table.projectId),
    index("search_documents_task_idx").on(table.taskId),
    index("search_documents_type_idx").on(table.sourceType),
  ],
);

/** Bounded operational replay markers; not part of a logical workspace export. */
export const workspaceTransferReceipts = sqliteTable("workspace_transfer_receipts", {
  sourceDigest: text("source_digest").primaryKey(),
  formatVersion: integer("format_version").notNull(),
  pathMode: text("path_mode").notNull(),
  resultDigest: text("result_digest").notNull(),
  transformedJson: text("transformed_json").notNull(),
  importedAt: text("imported_at").notNull(),
});

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
export type TaskExecutionRow = typeof taskExecutions.$inferSelect;
export type RepositoryRow = typeof repositories.$inferSelect;
export type ExecutionWorktreeRow = typeof executionWorktrees.$inferSelect;
export type ExecutionGitBaselineRow = typeof executionGitBaselines.$inferSelect;
export type ExecutionGitSnapshotRow = typeof executionGitSnapshots.$inferSelect;
export type ExecutionGitTouchedPathRow = typeof executionGitTouchedPaths.$inferSelect;
export type ExecutionPathOwnershipRevisionRow =
  typeof executionPathOwnershipRevisions.$inferSelect;
export type ExecutionPathOwnershipEntryRow = typeof executionPathOwnershipEntries.$inferSelect;
export type ExecutionOriginRow = typeof executionOrigins.$inferSelect;
export type TaskCheckpointRow = typeof taskCheckpoints.$inferSelect;
export type TaskWorkPlanItemRow = typeof taskWorkPlanItems.$inferSelect;
export type TaskHandoffRow = typeof taskHandoffs.$inferSelect;
export type CriterionEvidenceRow = typeof criterionEvidence.$inferSelect;
export type CriterionEvidenceDetailRow = typeof criterionEvidenceDetails.$inferSelect;
export type CriterionEvidencePolicyRow = typeof criterionEvidencePolicies.$inferSelect;
export type BlockerRow = typeof blockers.$inferSelect;
export type DecisionRow = typeof decisions.$inferSelect;
export type LinkRow = typeof links.$inferSelect;
export type ActivityEventRow = typeof activityEvents.$inferSelect;
export type ContextVersionRow = typeof contextVersions.$inferSelect;
export type SearchDocumentRow = typeof searchDocuments.$inferSelect;
export type WorkspaceTransferReceiptRow = typeof workspaceTransferReceipts.$inferSelect;
