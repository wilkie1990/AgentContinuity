import type {
  ActivityEventType,
  ExecutionHealth,
  ProjectStatus,
  TaskPriority,
  TaskStatus,
  WorkPlanStatus,
} from "./enums.js";
import type { GitProvenanceSnapshot, GitProvenanceState } from "./provenance.js";
import type { ExecutionPathOwnership, PathCollisionWarning } from "./ownership.js";
import type { ContextSize } from "./context.js";
import type { CriterionEvidence, CriterionEvidencePolicy } from "./evidence.js";

export type Project = {
  id: string;
  key: string;
  name: string;
  objective: string | null;
  description: string | null;
  context: string | null;
  contextVersion: number;
  contextSize: ContextSize;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type TaskCounts = {
  backlog: number;
  ready: number;
  inProgress: number;
  blocked: number;
  review: number;
  done: number;
};

export type ProjectSummary = Project & {
  taskCounts: TaskCounts;
  taskTotal: number;
  /** done tasks / total tasks, or null when the project has no tasks. */
  progress: number | null;
  lastActivityAt: string | null;
};

export type ProjectDetail = ProjectSummary & {
  decisions: Decision[];
  links: Link[];
  recentActivity: ActivityEvent[];
};

export type TaskRef = {
  id: string;
  key: string;
  title: string;
  status: TaskStatus;
};

export type Task = {
  id: string;
  key: string;
  projectId: string;
  projectKey: string;
  parentTaskId: string | null;
  parentTaskKey: string | null;
  title: string;
  description: string | null;
  context: string | null;
  contextVersion: number;
  contextSize: ContextSize;
  status: TaskStatus;
  priority: TaskPriority;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export type TaskSummary = Task & {
  acceptanceCriteriaCompleted: number;
  acceptanceCriteriaTotal: number;
  /** null when the task has no acceptance criteria. */
  acceptanceCriteriaProgress: number | null;
  dependencyCount: number;
  dependenciesComplete: boolean;
  activeBlockerCount: number;
  linkCount: number;
  isActionable: boolean;
  claim: TaskClaim | null;
  execution: TaskExecution | null;
};

export type TaskDetail = TaskSummary & {
  project: Pick<Project, "id" | "key" | "name" | "status" | "objective">;
  acceptanceCriteria: AcceptanceCriterion[];
  dependencies: TaskRef[];
  dependents: TaskRef[];
  progress: ProgressEntry[];
  activeBlockers: Blocker[];
  resolvedBlockers: Blocker[];
  decisions: Decision[];
  links: Link[];
  recentActivity: ActivityEvent[];
};

/** What a task deletion took with it, so the caller can report the blast radius. */
export type DeletedTask = {
  id: string;
  key: string;
  title: string;
  projectKey: string;
  removed: {
    acceptanceCriteria: number;
    progress: number;
    blockers: number;
    links: number;
    activityEvents: number;
    dependencies: number;
    dependents: number;
  };
  /** Subtasks that survive, promoted to top level. */
  orphanedSubtasks: string[];
  /** Decisions that survive, rescoped from the task to the project. */
  detachedDecisions: string[];
};

/**
 * What a project deletion took with it. Unlike task deletion, nothing survives at a
 * higher scope — the project itself is the top-level container — so this summary is
 * the only lasting record of what the deletion removed.
 */
export type DeletedProject = {
  id: string;
  key: string;
  name: string;
  removed: {
    tasks: number;
    acceptanceCriteria: number;
    progress: number;
    blockers: number;
    claims: number;
    dependencies: number;
    decisions: number;
    links: number;
    activityEvents: number;
    repositories: number;
    executionWorktrees: number;
  };
};

export type AcceptanceCriterion = {
  id: string;
  taskId: string;
  description: string;
  isComplete: boolean;
  sortOrder: number;
  createdAt: string;
  completedAt: string | null;
  evidence?: CriterionEvidence[];
  evidencePolicy?: CriterionEvidencePolicy | null;
};

export type TaskExecution = {
  id: string; taskId: string; actor: string; sessionId: string | null; status: "running" | "ended";
  currentPhase: string | null; startedAt: string; resumedAt: string | null; lastHeartbeatAt: string;
  endedAt: string | null; terminationReason: string | null; health: ExecutionHealth; origins: ExecutionOrigin[];
  /** Redacted binding summary; use an explicit worktree operation to read the local path. */
  worktree: ExecutionWorktreeSummary | null;
};
export type ExecutionOrigin = { id: string; provider: string; reference: string; url: string | null; metadata: Record<string, unknown> | null; createdAt: string };

export type LocalPathAvailability = {
  status: "available" | "missing" | "inaccessible" | "not_directory";
  message: string | null;
};

export type ProjectRepository = {
  id: string;
  key: string;
  projectId: string;
  projectKey: string;
  label: string;
  /** Canonical, machine-local path. Returned only by explicit repository operations. */
  rootPath: string;
  remoteUrl: string | null;
  primary: boolean;
  availability: LocalPathAvailability;
  createdAt: string;
  updatedAt: string;
};

export type ExecutionWorktreeSummary = {
  id: string;
  executionId: string;
  taskId: string;
  repositoryId: string;
  repositoryKey: string;
  repositoryLabel: string;
  branch: string | null;
  availability: LocalPathAvailability;
  createdAt: string;
  updatedAt: string;
};

export type ExecutionWorktree = ExecutionWorktreeSummary & {
  /** Canonical, machine-local path. Returned only by explicit worktree operations. */
  worktreePath: string;
  /** "." or a repository-relative path when the worktree is inside the repository root. */
  relativePath: string | null;
};

export type RemovedProjectRepository = {
  id: string;
  key: string;
  projectKey: string;
  label: string;
  removedWorktreeBindings: number;
};
export type TaskCheckpoint = { id: string; taskId: string; executionId: string | null; completed: string; workingOn: string; next: string; uncertainty: string | null; actor: string | null; sessionId: string | null; createdAt: string };
export type WorkPlanItem = { id: string; taskId: string; title: string; status: WorkPlanStatus; sortOrder: number; createdAt: string; updatedAt: string; completedAt: string | null };
export type TaskHandoff = { id: string; taskId: string; executionId: string | null; reason: string; summary: string; nextAction: string | null; unresolved: string[]; createdAt: string };
export type NeedsAttentionItem = {
  taskId: string;
  taskKey: string;
  projectId: string;
  reason:
    | "expired_claim"
    | "stale_execution"
    | "interrupted_execution"
    | "blocked"
    | "review"
    | "handoff"
    | "path_collision";
  requiredAction: string;
  execution: TaskExecution | null;
  collision?: PathCollisionWarning;
};

export type TaskExecutionState = {
  execution: TaskExecution | null;
  checkpoints: TaskCheckpoint[];
  workPlan: WorkPlanItem[];
  handoff: TaskHandoff | null;
  /** Derived local Git facts for the active, or most recent, execution. */
  provenance: GitProvenanceState | null;
  ownership: ExecutionPathOwnership | null;
  collisions: PathCollisionWarning[];
};

export type SessionHandoffTask = {
  taskKey: string;
  actor: string;
  executionId: string;
  checkpointState: "missing" | "stale" | "current";
};

/**
 * Read-only lifecycle status for live claims owned by one exact provider session.
 * It intentionally contains no project, task-context, blocker, or user-authored text.
 */
export type SessionHandoffStatus = {
  sessionId: string;
  tasks: SessionHandoffTask[];
};

export type StartWorkResult = {
  project: ProjectDetail;
  task: TaskDetail;
  execution: TaskExecutionState;
};

export type ReportWorkResult = {
  claim: TaskClaim;
  execution: TaskExecution;
  progress: ProgressEntry | null;
  checkpoint: TaskCheckpoint | null;
  provenance: GitProvenanceSnapshot | null;
  collisions: PathCollisionWarning[];
};

export type HandoffWorkResult = {
  checkpoint: TaskCheckpoint;
  releasedClaim: TaskClaim;
  handoff: TaskHandoff;
  task: TaskDetail;
  provenance: GitProvenanceSnapshot | null;
};

export type TaskClaim = {
  id: string;
  taskId: string;
  taskKey: string;
  actor: string;
  sessionId: string | null;
  claimedAt: string;
  lastActiveAt: string;
  expiresAt: string;
  releasedAt: string | null;
  releaseReason: string | null;
  /** Whole minutes until expiry; negative once the lease has lapsed. */
  expiresInMinutes: number;
};

export type ProgressEntry = {
  id: string;
  taskId: string;
  taskKey: string;
  content: string;
  actor: string | null;
  sessionId: string | null;
  createdAt: string;
};

export type Blocker = {
  id: string;
  key: string;
  taskId: string;
  taskKey: string;
  description: string;
  requiredAction: string | null;
  createdBy: string | null;
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolution: string | null;
  isActive: boolean;
};

export type Decision = {
  id: string;
  key: string;
  projectId: string;
  projectKey: string;
  taskId: string | null;
  taskKey: string | null;
  title: string;
  decision: string;
  rationale: string | null;
  createdBy: string | null;
  sessionId: string | null;
  createdAt: string;
  supersededAt: string | null;
  supersededById: string | null;
  supersededByKey: string | null;
};

export type Link = {
  id: string;
  key: string;
  projectId: string;
  projectKey: string;
  taskId: string | null;
  taskKey: string | null;
  type: string;
  provider: string | null;
  reference: string | null;
  url: string | null;
  metadata: Record<string, unknown> | null;
  createdBy: string | null;
  createdAt: string;
};

export type ActivityEvent = {
  id: string;
  projectId: string;
  projectKey: string;
  taskId: string | null;
  taskKey: string | null;
  eventType: ActivityEventType;
  actor: string | null;
  sessionId: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type ActivityPage = {
  events: ActivityEvent[];
  nextCursor: string | null;
};

export type ProjectListPage = {
  projects: ProjectSummary[];
  total: number;
  limit: number;
  offset: number;
};

export type BootstrapResult = {
  project: ProjectSummary;
  tasks: TaskSummary[];
  decisions: Decision[];
  links: Link[];
  refMap: Record<string, string>;
};

export type HealthResponse = {
  status: "ok";
  version: string;
};
