import type {
  ActivityEventType,
  ProjectStatus,
  TaskPriority,
  TaskStatus,
} from "./enums.js";

export type Project = {
  id: string;
  key: string;
  name: string;
  objective: string | null;
  description: string | null;
  context: string | null;
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

export type AcceptanceCriterion = {
  id: string;
  taskId: string;
  description: string;
  isComplete: boolean;
  sortOrder: number;
  createdAt: string;
  completedAt: string | null;
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
