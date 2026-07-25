import { createAgentWorkspaceClient } from "@agent-workspace/client";
import type {
  ListActivityQuery,
  ListTasksQuery,
  ProjectStatus,
} from "@agent-workspace/contracts";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";

/** Same origin: the server serves the built UI and the API from one port. */
export const client = createAgentWorkspaceClient({ baseUrl: window.location.origin });

/**
 * How often live views re-poll the REST API so agent activity shows up
 * without a manual refresh. TanStack Query only runs `refetchInterval` while
 * the document is focused/visible (see `focusManager` in @tanstack/query-core),
 * so this pauses on its own in a hidden or backgrounded tab — no extra work
 * needed here to satisfy "stop polling in the background".
 */
export const LIVE_POLL_MS = 4000;

export const keys = {
  projects: (status?: ProjectStatus[]) => ["projects", status ?? "all"] as const,
  project: (ref: string) => ["project", ref] as const,
  tasks: (ref: string, query?: ListTasksQuery) => ["tasks", ref, query ?? {}] as const,
  task: (ref: string) => ["task", ref] as const,
  decisions: (ref: string) => ["decisions", ref] as const,
  links: (ref: string) => ["links", ref] as const,
  activity: (ref: string, query?: Partial<ListActivityQuery>) =>
    ["activity", ref, query ?? {}] as const,
};

/** Any mutation can touch derived project counters, so refresh the project scope broadly. */
function invalidateProject(queryClient: QueryClient, ref: string | undefined): void {
  void queryClient.invalidateQueries({ queryKey: ["projects"] });
  void queryClient.invalidateQueries({ queryKey: ["tasks"] });
  void queryClient.invalidateQueries({ queryKey: ["task"] });
  void queryClient.invalidateQueries({ queryKey: ["activity"] });
  void queryClient.invalidateQueries({ queryKey: ["decisions"] });
  void queryClient.invalidateQueries({ queryKey: ["links"] });
  if (ref) void queryClient.invalidateQueries({ queryKey: keys.project(ref) });
  void queryClient.invalidateQueries({ queryKey: ["project"] });
}

export function useProjects(status?: ProjectStatus[]) {
  return useQuery({
    queryKey: keys.projects(status),
    queryFn: () => client.projects.list({ ...(status ? { status } : {}), limit: 200 }),
  });
}

export function useProject(ref: string | undefined) {
  return useQuery({
    queryKey: keys.project(ref ?? ""),
    queryFn: () => client.projects.get(ref as string),
    enabled: Boolean(ref),
    refetchInterval: LIVE_POLL_MS,
  });
}

export function useTasks(ref: string | undefined, query: ListTasksQuery = {}) {
  return useQuery({
    queryKey: keys.tasks(ref ?? "", query),
    queryFn: () => client.tasks.list(ref as string, query),
    enabled: Boolean(ref),
    refetchInterval: LIVE_POLL_MS,
  });
}

export function useTask(ref: string | null | undefined) {
  return useQuery({
    queryKey: keys.task(ref ?? ""),
    queryFn: () => client.tasks.get(ref as string),
    enabled: Boolean(ref),
    refetchInterval: LIVE_POLL_MS,
  });
}

export function useDecisions(ref: string | undefined, search?: string) {
  return useQuery({
    queryKey: [...keys.decisions(ref ?? ""), search ?? ""],
    queryFn: () => client.decisions.list(ref as string, search ? { search } : {}),
    enabled: Boolean(ref),
  });
}

export function useLinks(ref: string | undefined) {
  return useQuery({
    queryKey: keys.links(ref ?? ""),
    queryFn: () => client.links.list(ref as string),
    enabled: Boolean(ref),
  });
}

export function useActivity(ref: string | undefined, query: Partial<ListActivityQuery> = {}) {
  return useQuery({
    queryKey: keys.activity(ref ?? "", query),
    queryFn: () => client.activity.list(ref as string, query),
    enabled: Boolean(ref),
    refetchInterval: LIVE_POLL_MS,
  });
}

/**
 * Wraps a client call so every mutation refreshes the project scope on success.
 * Components only supply the call itself.
 */
export function useWorkspaceMutation<Input, Output>(
  projectRef: string | undefined,
  run: (input: Input) => Promise<Output>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: () => invalidateProject(queryClient, projectRef),
  });
}

export { invalidateProject };
