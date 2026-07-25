import {
  AgentWorkspaceError,
  type AcceptanceCriterion,
  type ActivityPage,
  type AddBlockerInput,
  type AddLinksInput,
  type AddProgressInput,
  type Blocker,
  type BootstrapProjectRequest,
  type BootstrapResult,
  type ClaimTaskInput,
  type CompleteTaskInput,
  type CreateDecisionInput,
  type CreateProjectInput,
  type CreateTaskInput,
  type Decision,
  type DeletedTask,
  type ErrorBody,
  type HealthResponse,
  type Link,
  type ListActivityQuery,
  type ListDecisionsQuery,
  type ListLinksQuery,
  type ListProjectsQuery,
  type ListTasksQuery,
  type ProgressEntry,
  type ProjectDetail,
  type ProjectListPage,
  type ProjectSummary,
  type ReleaseClaimInput,
  type RenewClaimInput,
  type TaskClaim,
  type TaskDetail,
  type TaskSummary,
  type UpdateProjectContextInput,
  type UpdateProjectInput,
  type UpdateTaskContextInput,
  type UpdateTaskInput,
} from "@agent-workspace/contracts";

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

export type AgentWorkspaceClient = ReturnType<typeof createAgentWorkspaceClient>;

/**
 * Typed HTTP client shared by the CLI and the web application, so both exercise the
 * same public API surface the agents use.
 */
export function createAgentWorkspaceClient(options: ClientOptions) {
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
      throw new AgentWorkspaceError(
        "INTERNAL_ERROR",
        `Could not reach Agent Workspace at ${baseUrl}. Is the server running? (aw server)`,
        { cause: error instanceof Error ? error.message : String(error) },
      );
    }

    if (response.status === 204) return undefined as T;

    const text = await response.text();
    const payload: unknown = text ? JSON.parse(text) : {};

    if (!response.ok) {
      if (isErrorBody(payload)) {
        throw new AgentWorkspaceError(payload.error.code, payload.error.message, payload.error.details);
      }
      throw new AgentWorkspaceError(
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
      async archive(project: string, actor?: string): Promise<ProjectSummary> {
        return (
          await request<{ project: ProjectSummary }>("POST", api(`/projects/${project}/archive`), {
            actor,
          })
        ).project;
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
  };
}

export { AgentWorkspaceError };
