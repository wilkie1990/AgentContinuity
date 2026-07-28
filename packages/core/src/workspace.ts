import { resolveConfig, type WorkspaceConfig } from "@agent-continuity/config";
import { createDatabase, type DatabaseHandle } from "@agent-continuity/database";
import { createActivityService, type ActivityService } from "./activity/service.js";
import { createBlockerService, type BlockerService } from "./blockers/service.js";
import { createClaimService, type ClaimService } from "./claims/service.js";
import { createContextService, type ContextService } from "./context/service.js";
import { createDecisionService, type DecisionService } from "./decisions/service.js";
import { createExecutionService, type ExecutionService } from "./executions/service.js";
import { createEvidenceService, type EvidenceService } from "./evidence/service.js";
import { createLinkService, type LinkService } from "./links/service.js";
import {
  createPathOwnershipService,
  type PathOwnershipService,
} from "./ownership/service.js";
import { createProjectService, type ProjectService } from "./projects/service.js";
import {
  createLocalGitCaptureService,
  type LocalGitCaptureService,
} from "./provenance/capture.js";
import { LocalGitInspector, type GitInspector } from "./provenance/git.js";
import {
  createGitProvenanceService,
  type GitProvenanceService,
} from "./provenance/service.js";
import { RepositoryPathResolver } from "./repositories/paths.js";
import {
  createRepositoryService,
  type RepositoryService,
} from "./repositories/service.js";
import { Runtime, type Clock } from "./runtime.js";
import { createSearchService, type SearchService } from "./search/service.js";
import { createTaskService, type TaskService } from "./tasks/service.js";
import { createWorkspaceTransferService, type WorkspaceTransferService } from "./transfer/service.js";
import { createWorkflowService, type WorkflowService } from "./workflows/service.js";

export type Workspace = {
  config: WorkspaceConfig;
  runtime: Runtime;
  database: DatabaseHandle;
  projects: ProjectService;
  tasks: TaskService;
  claims: ClaimService;
  contexts: ContextService;
  blockers: BlockerService;
  decisions: DecisionService;
  links: LinkService;
  activity: ActivityService;
  executions: ExecutionService;
  evidence: EvidenceService;
  repositories: RepositoryService;
  provenance: GitProvenanceService;
  ownership: PathOwnershipService;
  git: LocalGitCaptureService;
  workflows: WorkflowService;
  search: SearchService;
  transfer: WorkspaceTransferService;
  close(): void;
};

export type CreateWorkspaceOptions = {
  config?: WorkspaceConfig;
  /** Overrides the configured database path; ":memory:" is used by tests. */
  databasePath?: string;
  clock?: Clock;
  idFactory?: () => string;
  /** Override local path handling for a non-default filesystem or focused tests. */
  repositoryPaths?: RepositoryPathResolver;
  caseSensitivePaths?: boolean;
  /** Injectable read-only Git adapter for focused tests. */
  gitInspector?: GitInspector;
};

/**
 * Composition root for the domain. Every adapter (REST, MCP, CLI) builds one of these
 * and calls services on it; no adapter is allowed to hold its own business rules.
 */
export function createWorkspace(options: CreateWorkspaceOptions = {}): Workspace {
  const config = options.config ?? resolveConfig();
  const database = createDatabase({ path: options.databasePath ?? config.databasePath });

  const runtime = new Runtime(database, {
    claimTtlMinutes: config.claims.defaultTtlMinutes,
    ...(options.clock ? { clock: options.clock } : {}),
    ...(options.idFactory ? { idFactory: options.idFactory } : {}),
  });

  const search = createSearchService(runtime);
  const transfer = createWorkspaceTransferService(runtime, search);
  const activity = createActivityService(runtime, search);
  const repositoryPaths =
    options.repositoryPaths ??
    new RepositoryPathResolver({ caseSensitive: options.caseSensitivePaths });
  const repositories = createRepositoryService(runtime, activity, repositoryPaths);
  const provenance = createGitProvenanceService(runtime, activity);
  const ownership = createPathOwnershipService(runtime, activity, repositoryPaths);
  const evidence = createEvidenceService(runtime, activity);
  const executions = createExecutionService(
    runtime,
    activity,
    repositories,
    provenance,
    ownership,
    evidence,
  );
  const git = createLocalGitCaptureService(
    runtime,
    repositories,
    provenance,
    options.gitInspector ?? new LocalGitInspector(),
  );
  const claims = createClaimService(runtime, activity, executions);
  const contexts = createContextService(runtime, activity, claims);
  const tasks = createTaskService(runtime, activity, claims, contexts, executions, search, evidence);
  const blockers = createBlockerService(runtime, activity, claims);
  const decisions = createDecisionService(runtime, activity, claims);
  const links = createLinkService(runtime, activity, claims);
  const projects = createProjectService(
    runtime,
    activity,
    contexts,
    tasks,
    claims,
    decisions,
    links,
  );
  const workflows = createWorkflowService(
    runtime,
    projects,
    tasks,
    claims,
    executions,
    repositories,
    git,
    ownership,
  );

  return {
    config,
    runtime,
    database,
    projects,
    tasks,
    claims,
    contexts,
    blockers,
    decisions,
    links,
    activity,
    executions,
    evidence,
    repositories,
    provenance,
    ownership,
    git,
    workflows,
    search,
    transfer,
    close() {
      database.close();
    },
  };
}
