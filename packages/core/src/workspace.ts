import { resolveConfig, type WorkspaceConfig } from "@agent-continuity/config";
import { createDatabase, type DatabaseHandle } from "@agent-continuity/database";
import { createActivityService, type ActivityService } from "./activity/service.js";
import { createBlockerService, type BlockerService } from "./blockers/service.js";
import { createClaimService, type ClaimService } from "./claims/service.js";
import { createDecisionService, type DecisionService } from "./decisions/service.js";
import { createExecutionService, type ExecutionService } from "./executions/service.js";
import { createLinkService, type LinkService } from "./links/service.js";
import { createProjectService, type ProjectService } from "./projects/service.js";
import { Runtime, type Clock } from "./runtime.js";
import { createTaskService, type TaskService } from "./tasks/service.js";

export type Workspace = {
  config: WorkspaceConfig;
  runtime: Runtime;
  database: DatabaseHandle;
  projects: ProjectService;
  tasks: TaskService;
  claims: ClaimService;
  blockers: BlockerService;
  decisions: DecisionService;
  links: LinkService;
  activity: ActivityService;
  executions: ExecutionService;
  close(): void;
};

export type CreateWorkspaceOptions = {
  config?: WorkspaceConfig;
  /** Overrides the configured database path; ":memory:" is used by tests. */
  databasePath?: string;
  clock?: Clock;
  idFactory?: () => string;
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

  const activity = createActivityService(runtime);
  const executions = createExecutionService(runtime, activity);
  const claims = createClaimService(runtime, activity, executions);
  const tasks = createTaskService(runtime, activity, claims, executions);
  const blockers = createBlockerService(runtime, activity, claims);
  const decisions = createDecisionService(runtime, activity, claims);
  const links = createLinkService(runtime, activity, claims);
  const projects = createProjectService(runtime, activity, tasks, claims, decisions, links);

  return {
    config,
    runtime,
    database,
    projects,
    tasks,
    claims,
    blockers,
    decisions,
    links,
    activity,
    executions,
    close() {
      database.close();
    },
  };
}
