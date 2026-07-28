import {
  AgentContinuityError,
  type AcceptanceCriterion,
  type ActivityPage,
  type AddBlockerInput,
  type AddLinksInput,
  type AddProgressInput,
  type BindExecutionWorktreeInput,
  type Blocker,
  type BootstrapProjectRequest,
  type BootstrapResult,
  type ClaimTaskInput,
  type CompleteTaskInput,
  type ContextVersionDetail,
  type ContextVersionPage,
  type CreateDecisionInput,
  type CreateProjectInput,
  type CreateRepositoryInput,
  type CreateTaskInput,
  type Decision,
  type DeletedProject,
  type DeletedTask,
  type ErrorBody,
  type HealthResponse,
  type Link,
  type ListActivityQuery,
  type ListContextVersionsQuery,
  type ListDecisionsQuery,
  type ListLinksQuery,
  type ListProjectsQuery,
  type ListTasksQuery,
  type ProgressEntry,
  type ProjectDetail,
  type ProjectListPage,
  type ProjectRepository,
  type ProjectSummary,
  type SearchQuery,
  type SearchResponse,
  type SessionHandoffStatus,
  type ReleaseClaimInput,
  type RemovedProjectRepository,
  type RevertContextInput,
  type RemoveRepositoryInput,
  type RenewClaimInput,
  type TaskClaim,
  type TaskCheckpoint,
  type TaskExecution,
  type TaskExecutionState,
  type WorkPlanItem,
  type CriterionEvidence,
  type ExecutionOrigin,
  type ExecutionWorktree,
  type GitProvenanceSnapshot,
  type GitProvenanceState,
  type NeedsAttentionItem,
  type ExecutionPathOwnership,
  type PathCollisionWarning,
  type ReplaceExecutionPathOwnershipInput,
  type ReplaceExecutionPathOwnershipResult,
  type HeartbeatInput,
  type HandoffWorkInput,
  type HandoffWorkResult,
  type ReportWorkInput,
  type ReportWorkResult,
  type StartWorkInput,
  type StartWorkResult,
  type CheckpointInput,
  type WorkPlanInput,
  type UpdateWorkPlanItemInput,
  type CriterionEvidenceInput,
  type CriterionEvidencePolicy,
  type CriterionEvidencePolicyInput,
  type ClearCriterionEvidencePolicyInput,
  type ExecutionOriginInput,
  type TaskDetail,
  type TaskSummary,
  type UpdateProjectContextInput,
  type UpdateProjectInput,
  type UpdateRepositoryInput,
  type UpdateTaskContextInput,
  type UpdateTaskInput,
  type UnbindExecutionWorktreeInput,
} from "@agent-continuity/contracts";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type ClientOptions = {
  baseUrl: string;
  fetch?: FetchLike;
  headers?: Record<string, string>;
};

type QueryValue = string | number | boolean | string[] | undefined | null;

function toSearch(query: Record<string, QueryValue> | undefined): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const entry of value) params.append(key, entry);
    } else {
      params.append(key, String(value));
    }
  }
  const search = params.toString();
  return search ? `?${search}` : "";
}

function isErrorBody(value: unknown): value is ErrorBody {
  return (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof (value as ErrorBody).error?.code === "string"
  );
}

export type AgentContinuityClient = ReturnType<typeof createAgentContinuityClient>;

/** Continuity state returned alongside the active (or most recent) execution. */
export type { TaskExecutionState } from "@agent-continuity/contracts";

/**
 * Typed HTTP client shared by the CLI and the web application, so both exercise the
 * same public API surface the agents use.
 */
export function createAgentContinuityClient(options: ClientOptions) {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const doFetch: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));

  async function request<T>(
    method: string,
    path: string,
    body?: unknown,
    query?: Record<string, QueryValue>,
  ): Promise<T> {
    const url = `${baseUrl}${path}${toSearch(query)}`;

    let response: Response;
    try {
      response = await doFetch(url, {
        method,
        headers: {
          accept: "application/json",
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          ...options.headers,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (error) {
      throw new AgentContinuityError(
        "INTERNAL_ERROR",
        `Could not reach Agent Continuity at ${baseUrl}. Is the server running? (ac server)`,
        { cause: error instanceof Error ? error.message : String(error) },
      );
    }

    if (response.status === 204) return undefined as T;

    const text = await response.text();
    const payload: unknown = text ? JSON.parse(text) : {};

    if (!response.ok) {
      if (isErrorBody(payload)) {
        throw new AgentContinuityError(payload.error.code, payload.error.message, payload.error.details);
      }
      throw new AgentContinuityError(
        "INTERNAL_ERROR",
        `Request failed with status ${response.status}.`,
        { status: response.status },
      );
    }

    return payload as T;
  }

  const api = (path: string) => `/api/v1${path}`;

  return {
    baseUrl,

    health(): Promise<HealthResponse> {
      return request<HealthResponse>("GET", "/health");
    },

    search(query: SearchQuery): Promise<SearchResponse> {
      return request<SearchResponse>("GET", api("/search"), undefined, {
        q: query.q,
        project: query.project,
        task: query.task,
        type: query.type,
        limit: query.limit,
      });
    },

    projects: {
      async create(input: CreateProjectInput): Promise<ProjectSummary> {
        return (await request<{ project: ProjectSummary }>("POST", api("/projects"), input)).project;
      },
      bootstrap(input: BootstrapProjectRequest): Promise<BootstrapResult> {
        return request<BootstrapResult>("POST", api("/projects/bootstrap"), input);
      },
      list(query: Partial<ListProjectsQuery> = {}): Promise<ProjectListPage> {
        return request<ProjectListPage>("GET", api("/projects"), undefined, {
          status: query.status,
          search: query.search,
          limit: query.limit,
          offset: query.offset,
          sort: query.sort,
        });
      },
      async get(project: string): Promise<ProjectDetail> {
        return (await request<{ project: ProjectDetail }>("GET", api(`/projects/${project}`)))
          .project;
      },
      async update(project: string, input: UpdateProjectInput): Promise<ProjectSummary> {
        return (
          await request<{ project: ProjectSummary }>("PATCH", api(`/projects/${project}`), input)
        ).project;
      },
      async updateContext(
        project: string,
        input: UpdateProjectContextInput,
      ): Promise<ProjectSummary> {
        return (
          await request<{ project: ProjectSummary }>(
            "PUT",
            api(`/projects/${project}/context`),
            input,
          )
        ).project;
      },
      listContextVersions(
        project: string,
        query: Partial<ListContextVersionsQuery> = {},
      ): Promise<ContextVersionPage> {
        return request<ContextVersionPage>(
          "GET",
          api(`/projects/${project}/context/versions`),
          undefined,
          {
            limit: query.limit,
            beforeVersion: query.beforeVersion,
          },
        );
      },
      async getContextVersion(
        project: string,
        version: number,
      ): Promise<ContextVersionDetail> {
        return (
          await request<{ version: ContextVersionDetail }>(
            "GET",
            api(`/projects/${project}/context/versions/${version}`),
          )
        ).version;
      },
      async revertContext(
        project: string,
        input: RevertContextInput,
      ): Promise<ProjectSummary> {
        return (
          await request<{ project: ProjectSummary }>(
            "POST",
            api(`/projects/${project}/context/revert`),
            input,
          )
        ).project;
      },
      async archive(project: string, actor?: string): Promise<ProjectSummary> {
        return (
          await request<{ project: ProjectSummary }>("POST", api(`/projects/${project}/archive`), {
            actor,
          })
        ).project;
      },
      async remove(
        project: string,
        input: { force?: boolean; actor?: string } = {},
      ): Promise<DeletedProject> {
        return (
          await request<{ deleted: DeletedProject }>("DELETE", api(`/projects/${project}`), input)
        ).deleted;
      },
    },

    repositories: {
      async create(
        project: string,
        input: CreateRepositoryInput,
      ): Promise<ProjectRepository> {
        return (
          await request<{ repository: ProjectRepository }>(
            "POST",
            api(`/projects/${project}/repositories`),
            input,
          )
        ).repository;
      },
      async list(project: string): Promise<ProjectRepository[]> {
        return (
          await request<{ repositories: ProjectRepository[] }>(
            "GET",
            api(`/projects/${project}/repositories`),
          )
        ).repositories;
      },
      async get(project: string, repository: string): Promise<ProjectRepository> {
        return (
          await request<{ repository: ProjectRepository }>(
            "GET",
            api(`/projects/${project}/repositories/${repository}`),
          )
        ).repository;
      },
      async update(
        project: string,
        repository: string,
        input: UpdateRepositoryInput,
      ): Promise<ProjectRepository> {
        return (
          await request<{ repository: ProjectRepository }>(
            "PATCH",
            api(`/projects/${project}/repositories/${repository}`),
            input,
          )
        ).repository;
      },
      async remove(
        project: string,
        repository: string,
        input: RemoveRepositoryInput = { force: false },
      ): Promise<RemovedProjectRepository> {
        return (
          await request<{ removed: RemovedProjectRepository }>(
            "DELETE",
            api(`/projects/${project}/repositories/${repository}`),
            input,
          )
        ).removed;
      },
    },

    tasks: {
      async create(project: string, input: CreateTaskInput): Promise<TaskSummary> {
        return (
          await request<{ task: TaskSummary }>("POST", api(`/projects/${project}/tasks`), input)
        ).task;
      },
      async list(project: string, query: ListTasksQuery = {}): Promise<TaskSummary[]> {
        return (
          await request<{ tasks: TaskSummary[] }>(
            "GET",
            api(`/projects/${project}/tasks`),
            undefined,
            {
              status: query.status,
              priority: query.priority,
              actionable: query.actionable,
              claimed: query.claimed,
              blocked: query.blocked,
              parent: query.parent,
              search: query.search,
            },
          )
        ).tasks;
      },
      async get(task: string): Promise<TaskDetail> {
        return (await request<{ task: TaskDetail }>("GET", api(`/tasks/${task}`))).task;
      },
      async update(task: string, input: UpdateTaskInput): Promise<TaskSummary> {
        return (await request<{ task: TaskSummary }>("PATCH", api(`/tasks/${task}`), input)).task;
      },
      async updateContext(task: string, input: UpdateTaskContextInput): Promise<TaskSummary> {
        return (
          await request<{ task: TaskSummary }>("PUT", api(`/tasks/${task}/context`), input)
        ).task;
      },
      listContextVersions(
        task: string,
        query: Partial<ListContextVersionsQuery> = {},
      ): Promise<ContextVersionPage> {
        return request<ContextVersionPage>(
          "GET",
          api(`/tasks/${task}/context/versions`),
          undefined,
          {
            limit: query.limit,
            beforeVersion: query.beforeVersion,
          },
        );
      },
      async getContextVersion(task: string, version: number): Promise<ContextVersionDetail> {
        return (
          await request<{ version: ContextVersionDetail }>(
            "GET",
            api(`/tasks/${task}/context/versions/${version}`),
          )
        ).version;
      },
      async revertContext(task: string, input: RevertContextInput): Promise<TaskSummary> {
        return (
          await request<{ task: TaskSummary }>(
            "POST",
            api(`/tasks/${task}/context/revert`),
            input,
          )
        ).task;
      },
      async complete(task: string, input: Partial<CompleteTaskInput> = {}): Promise<TaskSummary> {
        return (
          await request<{ task: TaskSummary }>("POST", api(`/tasks/${task}/complete`), input)
        ).task;
      },
      async remove(task: string, input: { force?: boolean; actor?: string } = {}): Promise<DeletedTask> {
        return (await request<{ deleted: DeletedTask }>("DELETE", api(`/tasks/${task}`), input))
          .deleted;
      },
      claim(task: string, input: ClaimTaskInput): Promise<{ claim: TaskClaim; task: TaskSummary }> {
        return request("POST", api(`/tasks/${task}/claim`), input);
      },
      startWork(task: string, input: StartWorkInput): Promise<StartWorkResult> {
        return request("POST", api(`/tasks/${task}/start-work`), input);
      },
      report(task: string, input: ReportWorkInput): Promise<ReportWorkResult> {
        return request("POST", api(`/tasks/${task}/report`), input);
      },
      handoff(task: string, input: HandoffWorkInput): Promise<HandoffWorkResult> {
        return request("POST", api(`/tasks/${task}/handoff`), input);
      },
      async renewClaim(task: string, input: RenewClaimInput): Promise<TaskClaim> {
        return (
          await request<{ claim: TaskClaim }>("POST", api(`/tasks/${task}/claim/renew`), input)
        ).claim;
      },
      releaseClaim(
        task: string,
        input: ReleaseClaimInput = {},
      ): Promise<{ claim: TaskClaim; task: TaskSummary }> {
        return request("POST", api(`/tasks/${task}/claim/release`), input);
      },
      /** Refresh execution liveness without creating a progress-feed entry. */
      heartbeat(task: string, input: HeartbeatInput): Promise<{ claim: TaskClaim; execution: TaskExecution | null }> {
        return request("POST", api(`/tasks/${task}/heartbeat`), input);
      },
      execution(task: string): Promise<TaskExecutionState> {
        return request<TaskExecutionState>("GET", api(`/tasks/${task}/execution`));
      },
      pathOwnership(
        task: string,
      ): Promise<{
        ownership: ExecutionPathOwnership | null;
        collisions: PathCollisionWarning[];
      }> {
        return request("GET", api(`/tasks/${task}/execution/path-ownership`));
      },
      replacePathOwnership(
        task: string,
        input: ReplaceExecutionPathOwnershipInput,
      ): Promise<ReplaceExecutionPathOwnershipResult> {
        return request("PUT", api(`/tasks/${task}/execution/path-ownership`), input);
      },
      async executionWorktree(task: string): Promise<ExecutionWorktree> {
        return (
          await request<{ worktree: ExecutionWorktree }>(
            "GET",
            api(`/tasks/${task}/execution/worktree`),
          )
        ).worktree;
      },
      async bindWorktree(
        task: string,
        input: BindExecutionWorktreeInput,
      ): Promise<ExecutionWorktree> {
        return (
          await request<{ worktree: ExecutionWorktree }>(
            "PUT",
            api(`/tasks/${task}/execution/worktree`),
            input,
          )
        ).worktree;
      },
      async unbindWorktree(
        task: string,
        input: UnbindExecutionWorktreeInput,
      ): Promise<ExecutionWorktree> {
        return (
          await request<{ worktree: ExecutionWorktree }>(
            "DELETE",
            api(`/tasks/${task}/execution/worktree`),
            input,
          )
        ).worktree;
      },
      async gitProvenance(task: string): Promise<GitProvenanceState | null> {
        return (
          await request<{ provenance: GitProvenanceState | null }>(
            "GET",
            api(`/tasks/${task}/execution/git-provenance`),
          )
        ).provenance;
      },
      async captureGitProvenance(
        task: string,
      ): Promise<GitProvenanceSnapshot | null> {
        return (
          await request<{ provenance: GitProvenanceSnapshot | null }>(
            "POST",
            api(`/tasks/${task}/execution/git-provenance/capture`),
            {},
          )
        ).provenance;
      },
      async checkpoint(task: string, input: CheckpointInput): Promise<TaskCheckpoint> {
        return (await request<{ checkpoint: TaskCheckpoint }>("POST", api(`/tasks/${task}/checkpoints`), input)).checkpoint;
      },
      async checkpoints(task: string): Promise<TaskCheckpoint[]> {
        return (await request<{ checkpoints: TaskCheckpoint[] }>("GET", api(`/tasks/${task}/checkpoints`))).checkpoints;
      },
      async setWorkPlan(task: string, input: WorkPlanInput): Promise<WorkPlanItem[]> {
        return (await request<{ workPlan: WorkPlanItem[] }>("PUT", api(`/tasks/${task}/work-plan`), input)).workPlan;
      },
      async workPlan(task: string): Promise<WorkPlanItem[]> {
        return (await request<{ workPlan: WorkPlanItem[] }>("GET", api(`/tasks/${task}/work-plan`))).workPlan;
      },
      async updateWorkPlanItem(task: string, item: string, input: UpdateWorkPlanItemInput): Promise<WorkPlanItem> {
        return (await request<{ item: WorkPlanItem }>("PATCH", api(`/tasks/${task}/work-plan/${item}`), input)).item;
      },
      async addCriterionEvidence(task: string, criterion: string, input: CriterionEvidenceInput): Promise<CriterionEvidence> {
        return (await request<{ evidence: CriterionEvidence }>("POST", api(`/tasks/${task}/acceptance-criteria/${criterion}/evidence`), input)).evidence;
      },
      async criterionEvidence(task: string, criterion: string): Promise<CriterionEvidence[]> {
        return (await request<{ evidence: CriterionEvidence[] }>("GET", api(`/tasks/${task}/acceptance-criteria/${criterion}/evidence`))).evidence;
      },
      async criterionEvidencePolicy(
        task: string,
        criterion: string,
      ): Promise<CriterionEvidencePolicy | null> {
        return (
          await request<{ policy: CriterionEvidencePolicy | null }>(
            "GET",
            api(`/tasks/${task}/acceptance-criteria/${criterion}/evidence-policy`),
          )
        ).policy;
      },
      async setCriterionEvidencePolicy(
        task: string,
        criterion: string,
        input: CriterionEvidencePolicyInput,
      ): Promise<CriterionEvidencePolicy> {
        return (
          await request<{ policy: CriterionEvidencePolicy }>(
            "PUT",
            api(`/tasks/${task}/acceptance-criteria/${criterion}/evidence-policy`),
            input,
          )
        ).policy;
      },
      async clearCriterionEvidencePolicy(
        task: string,
        criterion: string,
        input: ClearCriterionEvidencePolicyInput = {},
      ): Promise<null> {
        return (
          await request<{ policy: null }>(
            "DELETE",
            api(`/tasks/${task}/acceptance-criteria/${criterion}/evidence-policy`),
            input,
          )
        ).policy;
      },
      async addExecutionOrigin(task: string, input: ExecutionOriginInput): Promise<ExecutionOrigin> {
        return (await request<{ origin: ExecutionOrigin }>("POST", api(`/tasks/${task}/execution/origins`), input)).origin;
      },
      async addProgress(task: string, input: AddProgressInput): Promise<ProgressEntry> {
        return (
          await request<{ progress: ProgressEntry }>("POST", api(`/tasks/${task}/progress`), input)
        ).progress;
      },
      async listProgress(task: string): Promise<ProgressEntry[]> {
        return (await request<{ progress: ProgressEntry[] }>("GET", api(`/tasks/${task}/progress`)))
          .progress;
      },
      addBlocker(
        task: string,
        input: AddBlockerInput,
      ): Promise<{ blocker: Blocker; task: TaskSummary }> {
        return request("POST", api(`/tasks/${task}/blockers`), input);
      },
      async addAcceptanceCriteria(
        task: string,
        criteria: string[],
        meta: { actor?: string; sessionId?: string } = {},
      ): Promise<AcceptanceCriterion[]> {
        return (
          await request<{ acceptanceCriteria: AcceptanceCriterion[] }>(
            "POST",
            api(`/tasks/${task}/acceptance-criteria`),
            { criteria, ...meta },
          )
        ).acceptanceCriteria;
      },
      async addDependency(task: string, dependsOn: string): Promise<TaskSummary> {
        return (
          await request<{ task: TaskSummary }>("POST", api(`/tasks/${task}/dependencies`), {
            dependsOn,
          })
        ).task;
      },
      async removeDependency(task: string, dependsOn: string): Promise<TaskSummary> {
        return (
          await request<{ task: TaskSummary }>(
            "DELETE",
            api(`/tasks/${task}/dependencies/${dependsOn}`),
          )
        ).task;
      },
    },

    acceptanceCriteria: {
      complete(criterion: string, meta: { actor?: string; sessionId?: string } = {}) {
        return request<{ acceptanceCriterion: AcceptanceCriterion; task: TaskSummary }>(
          "POST",
          api(`/acceptance-criteria/${criterion}/complete`),
          meta,
        );
      },
      reopen(criterion: string, meta: { actor?: string; sessionId?: string } = {}) {
        return request<{ acceptanceCriterion: AcceptanceCriterion; task: TaskSummary }>(
          "POST",
          api(`/acceptance-criteria/${criterion}/reopen`),
          meta,
        );
      },
      remove(criterion: string): Promise<void> {
        return request<void>("DELETE", api(`/acceptance-criteria/${criterion}`));
      },
    },

    blockers: {
      resolve(
        blocker: string,
        input: { resolution: string; actor?: string; sessionId?: string },
      ): Promise<{ blocker: Blocker; task: TaskSummary }> {
        return request("POST", api(`/blockers/${blocker}/resolve`), input);
      },
    },

    decisions: {
      async create(project: string, input: CreateDecisionInput): Promise<Decision> {
        return (
          await request<{ decision: Decision }>(
            "POST",
            api(`/projects/${project}/decisions`),
            input,
          )
        ).decision;
      },
      async list(project: string, query: Partial<ListDecisionsQuery> = {}): Promise<Decision[]> {
        return (
          await request<{ decisions: Decision[] }>(
            "GET",
            api(`/projects/${project}/decisions`),
            undefined,
            { task: query.task, search: query.search, limit: query.limit },
          )
        ).decisions;
      },
      async get(decision: string): Promise<Decision> {
        return (await request<{ decision: Decision }>("GET", api(`/decisions/${decision}`)))
          .decision;
      },
    },

    links: {
      async add(project: string, input: AddLinksInput): Promise<Link[]> {
        return (await request<{ links: Link[] }>("POST", api(`/projects/${project}/links`), input))
          .links;
      },
      async list(project: string, query: ListLinksQuery = {}): Promise<Link[]> {
        return (
          await request<{ links: Link[] }>("GET", api(`/projects/${project}/links`), undefined, {
            task: query.task,
            type: query.type,
            provider: query.provider,
          })
        ).links;
      },
      remove(link: string): Promise<void> {
        return request<void>("DELETE", api(`/links/${link}`));
      },
    },

    activity: {
      list(project: string, query: Partial<ListActivityQuery> = {}): Promise<ActivityPage> {
        return request<ActivityPage>("GET", api(`/projects/${project}/activity`), undefined, {
          task: query.task,
          eventType: query.eventType,
          actor: query.actor,
          after: query.after,
          before: query.before,
          limit: query.limit,
          cursor: query.cursor,
        });
      },
    },

    attention: {
      async list(): Promise<NeedsAttentionItem[]> {
        return (await request<{ items: NeedsAttentionItem[] }>("GET", api("/attention"))).items;
      },
    },

    sessions: {
      handoffStatus(sessionId: string): Promise<SessionHandoffStatus> {
        return request(
          "GET",
          api(`/sessions/${encodeURIComponent(sessionId)}/handoff-status`),
        );
      },
    },
  };
}

export { AgentContinuityError };
