import {
  AgentContinuityError,
  criterionEvidenceSchema,
  searchSourceTypeSchema,
  taskPrioritySchema,
  taskStatusSchema,
  workflowCheckpointSchema,
  type ProjectStatus,
} from "@agent-continuity/contracts";
import type { Workspace } from "@agent-continuity/core";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { profileGuidance, toolIsInProfile, type McpProfile } from "./profile.js";
import {
  renderActivityLine,
  renderAttention,
  renderCheckpoints,
  renderContextHistory,
  renderContextSize,
  renderContextVersion,
  renderCriteria,
  renderDecisionLine,
  renderGitProvenance,
  renderLinkLine,
  renderPathOwnership,
  renderProjectDetail,
  renderProjectList,
  renderProjectLine,
  renderRepository,
  renderSearchResults,
  renderTaskDetail,
  renderTaskList,
  renderTaskLine,
  renderWorkPlan,
  renderWorktree,
} from "./format.js";

type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

function text(body: string): ToolResult {
  return { content: [{ type: "text", text: body }] };
}

/**
 * Domain errors are returned as tool errors with their code intact, so an agent can
 * react to TASK_ALREADY_CLAIMED differently from TASK_NOT_FOUND.
 */
function guard(handler: () => string): ToolResult {
  try {
    return text(handler());
  } catch (error) {
    if (AgentContinuityError.is(error)) {
      const details = Object.keys(error.details).length > 0 ? `\n${JSON.stringify(error.details)}` : "";
      return { content: [{ type: "text", text: `${error.code}: ${error.message}${details}` }], isError: true };
    }
    throw error;
  }
}

async function guardAsync(handler: () => string | Promise<string>): Promise<ToolResult> {
  try {
    return text(await handler());
  } catch (error) {
    if (AgentContinuityError.is(error)) {
      const details = Object.keys(error.details).length > 0 ? `\n${JSON.stringify(error.details)}` : "";
      return { content: [{ type: "text", text: `${error.code}: ${error.message}${details}` }], isError: true };
    }
    throw error;
  }
}

const actorShape = {
  actor: z.string().max(120).optional().describe("Identifier for the calling agent, e.g. claude-code"),
  session_id: z.string().max(200).optional().describe("Conversation or session identifier"),
};

type Meta = { actor?: string | undefined; sessionId?: string | undefined };

function meta(input: { actor?: string | undefined; session_id?: string | undefined }): Meta {
  return { actor: input.actor, sessionId: input.session_id };
}

const bootstrapLinkShape = z.object({
  task_ref: z.string().optional(),
  type: z.string(),
  provider: z.string().optional(),
  reference: z.string().optional(),
  url: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

function serverForProfile(server: McpServer, profile: McpProfile): McpServer {
  return new Proxy(server, {
    get(target, property, receiver) {
      if (property !== "registerTool") return Reflect.get(target, property, receiver);
      return (name: string, ...args: unknown[]) => {
        // Full is intentionally unfiltered so a newly registered typed tool cannot
        // disappear merely because the declarative catalog was not updated. The
        // full-surface parity test will then fail and force the catalog/docs to follow.
        if (profile !== "full" && !toolIsInProfile(profile, name)) return undefined;
        return (target.registerTool as (...values: unknown[]) => unknown)(name, ...args);
      };
    },
  });
}

export function registerTools(mcpServer: McpServer, workspace: Workspace, profile: McpProfile = "full"): void {
  const server = serverForProfile(mcpServer, profile);

  server.registerTool(
    "profile_info",
    {
      title: "Inspect MCP profile",
      description:
        "Show the active MCP profile and how to reach named operations that are unavailable in a reduced profile.",
      inputSchema: {},
    },
    () => text(profileGuidance(profile)),
  );

  server.registerTool(
    "search",
    {
      title: "Search workspace",
      description:
        "Search projects, tasks, separate contexts, acceptance criteria, progress, decisions, blockers, criterion evidence, links and activity with optional project/task/type filters.",
      inputSchema: {
        query: z.string().min(1).max(500),
        project: z.string().optional(),
        task: z.string().optional(),
        type: z.array(searchSourceTypeSchema).max(11).optional(),
        limit: z.number().int().min(1).max(100).default(20),
      },
    },
    (input) =>
      guard(() =>
        renderSearchResults(
          workspace.search.search({
            q: input.query,
            ...(input.project ? { project: input.project } : {}),
            ...(input.task ? { task: input.task } : {}),
            ...(input.type ? { type: input.type } : {}),
            limit: input.limit,
          }),
        ),
      ),
  );

  // ---------------------------------------------------------------- projects

  server.registerTool(
    "projects_create",
    {
      title: "Create project",
      description:
        "Create a new project. Use when a new body of work needs persistent project state but full project decomposition is not being created in the same operation. Prefer projects_bootstrap when tasks are already known.",
      inputSchema: {
        name: z.string().min(1).max(200),
        objective: z.string().optional().describe("The intended outcome of the project"),
        description: z.string().optional(),
        context: z.string().optional().describe("Persistent working knowledge for the whole project"),
        ...actorShape,
      },
    },
    (input) =>
      guardAsync(async () => {
        const project = workspace.projects.create({
          name: input.name,
          objective: input.objective ?? null,
          description: input.description ?? null,
          context: input.context ?? null,
          ...meta(input),
        });
        return `Created project.\n${renderProjectLine(project)}`;
      }),
  );

  server.registerTool(
    "projects_bootstrap",
    {
      title: "Bootstrap project",
      description:
        "Atomically create a project, its initial tasks, acceptance criteria, dependencies, decisions and links. Use when converting a conversation, plan, specification or body of work into a persistent project. Task refs are temporary labels used only inside this request; the service returns the generated task keys.",
      inputSchema: {
        name: z.string().min(1).max(200),
        objective: z.string().optional(),
        description: z.string().optional(),
        context: z.string().optional(),
        tasks: z
          .array(
            z.object({
              ref: z.string().optional().describe("Temporary reference used by depends_on"),
              title: z.string(),
              description: z.string().optional(),
              context: z.string().optional(),
              status: taskStatusSchema.optional(),
              priority: taskPrioritySchema.optional(),
              acceptance_criteria: z.array(z.string()).optional(),
              depends_on: z.array(z.string()).optional().describe("Refs of tasks that must finish first"),
              parent_ref: z.string().optional(),
              links: z.array(bootstrapLinkShape.omit({ task_ref: true })).optional(),
            }),
          )
          .optional(),
        decisions: z
          .array(
            z.object({
              title: z.string(),
              decision: z.string(),
              rationale: z.string().optional(),
              task_ref: z.string().optional(),
            }),
          )
          .optional(),
        links: z.array(bootstrapLinkShape).optional(),
        ...actorShape,
      },
    },
    (input) =>
      guard(() => {
        const result = workspace.projects.bootstrap({
          name: input.name,
          objective: input.objective ?? null,
          description: input.description ?? null,
          context: input.context ?? null,
          tasks: (input.tasks ?? []).map((task) => ({
            ...(task.ref ? { ref: task.ref } : {}),
            title: task.title,
            description: task.description ?? null,
            context: task.context ?? null,
            ...(task.status ? { status: task.status } : {}),
            ...(task.priority ? { priority: task.priority } : {}),
            ...(task.acceptance_criteria ? { acceptanceCriteria: task.acceptance_criteria } : {}),
            ...(task.depends_on ? { dependsOn: task.depends_on } : {}),
            ...(task.parent_ref ? { parentRef: task.parent_ref } : {}),
            ...(task.links ? { links: task.links } : {}),
          })),
          decisions: (input.decisions ?? []).map((decision) => ({
            title: decision.title,
            decision: decision.decision,
            rationale: decision.rationale ?? null,
            ...(decision.task_ref ? { taskRef: decision.task_ref } : {}),
          })),
          links: (input.links ?? []).map((link) => ({
            ...(link.task_ref ? { taskRef: link.task_ref } : {}),
            type: link.type,
            provider: link.provider ?? null,
            reference: link.reference ?? null,
            url: link.url ?? null,
            metadata: link.metadata ?? null,
          })),
          ...meta(input),
        });

        return [
          `Bootstrapped ${result.project.key} — ${result.project.name}`,
          "",
          renderTaskList(result.tasks),
          "",
          `Decisions: ${result.decisions.map((decision) => decision.key).join(", ") || "none"}`,
          `Links: ${result.links.map((link) => link.key).join(", ") || "none"}`,
          "",
          "Ref map:",
          ...Object.entries(result.refMap).map(([ref, key]) => `  ${ref} -> ${key}`),
        ].join("\n");
      }),
  );

  server.registerTool(
    "projects_list",
    {
      title: "List projects",
      description:
        "List projects and their summary state. Use to identify an existing project before creating a new one, and to avoid creating duplicates when a new conversation starts.",
      inputSchema: {
        status: z.enum(["active", "paused", "completed", "archived"]).optional(),
        search: z.string().optional(),
      },
    },
    (input) =>
      guard(() => {
        const page = workspace.projects.list({
          ...(input.status ? { status: [input.status as ProjectStatus] } : {}),
          ...(input.search ? { search: input.search } : {}),
          limit: 50,
          offset: 0,
          sort: "updated_at_desc",
        });
        return renderProjectList(page.projects);
      }),
  );

  server.registerTool(
    "projects_get",
    {
      title: "Get project",
      description:
        "Get project details, persistent project context, task summary, recent decisions, links and recent activity. Read this before doing meaningful work on an existing project.",
      inputSchema: { project: z.string().describe("Project key such as PRJ-0001") },
    },
    (input) => guard(() => renderProjectDetail(workspace.projects.get(input.project))),
  );

  server.registerTool(
    "projects_update",
    {
      title: "Update project",
      description:
        "Update project name, objective, description or status. Do not use this tool for context updates; use projects_update_context.",
      inputSchema: {
        project: z.string(),
        name: z.string().optional(),
        objective: z.string().optional(),
        description: z.string().optional(),
        status: z.enum(["active", "paused", "completed", "archived"]).optional(),
        ...actorShape,
      },
    },
    (input) =>
      guard(() => {
        const project = workspace.projects.update(input.project, {
          ...(input.name ? { name: input.name } : {}),
          ...(input.objective !== undefined ? { objective: input.objective } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.status ? { status: input.status as ProjectStatus } : {}),
          ...meta(input),
        });
        return `Updated project.\n${renderProjectLine(project)}`;
      }),
  );

  server.registerTool(
    "projects_update_context",
    {
      title: "Update project context",
      description:
        "Replace the persistent project context: knowledge future agents need anywhere in this project, such as constraints, scope boundaries, architecture and user preferences. Do not use it as an activity log and do not paste conversations into it.",
      inputSchema: {
        project: z.string(),
        context: z.string().nullable(),
        expected_version: z.number().int().min(0),
        reason: z.string().min(1).max(2000).optional(),
        ...actorShape,
      },
    },
    (input) =>
      guard(() => {
        const project = workspace.projects.updateContext(input.project, {
          context: input.context,
          expectedVersion: input.expected_version,
          ...(input.reason ? { reason: input.reason } : {}),
          ...meta(input),
        });
        return `Updated context for ${project.key} to v${project.contextVersion} (${renderContextSize(
          project.contextSize,
        )}).`;
      }),
  );

  server.registerTool(
    "projects_context_history",
    {
      title: "List project context history",
      description:
        "List bounded immutable project-context version metadata without returning historical content.",
      inputSchema: {
        project: z.string(),
        limit: z.number().int().min(1).max(100).default(20),
        before_version: z.number().int().min(1).optional(),
      },
    },
    (input) =>
      guard(() =>
        renderContextHistory(
          workspace.contexts.listProject(input.project, {
            limit: input.limit,
            ...(input.before_version ? { beforeVersion: input.before_version } : {}),
          }),
        ),
      ),
  );

  server.registerTool(
    "projects_context_version_get",
    {
      title: "Get project context version",
      description: "Get the full content and metadata of one project-context version.",
      inputSchema: { project: z.string(), version: z.number().int().min(1) },
    },
    (input) =>
      guard(() =>
        renderContextVersion(workspace.contexts.getProject(input.project, input.version)),
      ),
  );

  server.registerTool(
    "projects_context_revert",
    {
      title: "Revert project context",
      description:
        "Append a new current project-context version by copying a historical version. Later history is preserved.",
      inputSchema: {
        project: z.string(),
        target_version: z.number().int().min(1),
        expected_version: z.number().int().min(0),
        reason: z.string().min(1).max(2000).optional(),
        ...actorShape,
      },
    },
    (input) =>
      guard(() => {
        const row = workspace.contexts.revertProject(input.project, {
          targetVersion: input.target_version,
          expectedVersion: input.expected_version,
          ...(input.reason ? { reason: input.reason } : {}),
          ...meta(input),
        });
        const project = workspace.projects.summarise(row);
        return `Reverted ${project.key} context as v${project.contextVersion} (${renderContextSize(
          project.contextSize,
        )}).`;
      }),
  );

  server.registerTool(
    "projects_delete",
    {
      title: "Delete project",
      description:
        "Permanently delete a project and everything it owns: every task and everything each task owns, plus the project's own decisions, links and activity history. This cannot be undone and there is nowhere for the deletion itself to be recorded once it happens. Archiving is almost always the right choice — it hides a finished project reversibly. Only use this for a project that should never have existed, such as one created by mistake or during verification.",
      inputSchema: {
        project: z.string(),
        force: z
          .boolean()
          .optional()
          .describe("Required to delete a project that has a task another agent currently holds a claim on"),
        ...actorShape,
      },
    },
    (input) =>
      guard(() => {
        const deleted = workspace.projects.delete(input.project, {
          force: input.force ?? false,
          ...meta(input),
        });
        const { removed } = deleted;
        return [
          `Deleted ${deleted.key} — ${deleted.name}.`,
          `Removed ${removed.tasks} tasks, ${removed.acceptanceCriteria} acceptance criteria, ${removed.progress} progress entries, ${removed.blockers} blockers, ${removed.claims} claims, ${removed.dependencies} dependencies, ${removed.decisions} decisions, ${removed.links} links, ${removed.repositories} repositories, ${removed.executionWorktrees} execution worktrees and ${removed.activityEvents} activity events.`,
        ].join("\n");
      }),
  );

  server.registerTool(
    "repositories_add",
    {
      title: "Associate project repository",
      description:
        "Associate a project with an explicit absolute local repository root. The path is canonicalized and never inferred from process cwd.",
      inputSchema: {
        project: z.string(),
        label: z.string().min(1).max(200),
        root_path: z.string().min(1),
        remote_url: z.string().nullable().optional(),
        primary: z.boolean().optional(),
        ...actorShape,
      },
    },
    (input) =>
      guard(() =>
        renderRepository(
          workspace.repositories.create(input.project, {
            label: input.label,
            rootPath: input.root_path,
            ...(input.remote_url !== undefined ? { remoteUrl: input.remote_url } : {}),
            ...(input.primary !== undefined ? { primary: input.primary } : {}),
            ...meta(input),
          }),
        ),
      ),
  );

  server.registerTool(
    "repositories_list",
    {
      title: "List project repositories",
      description:
        "List explicit local repository associations and their current availability. This explicit operation returns machine-local paths.",
      inputSchema: { project: z.string() },
    },
    (input) =>
      guard(() => {
        const repositories = workspace.repositories.list(input.project);
        return repositories.length
          ? repositories.map(renderRepository).join("\n\n")
          : "No repositories associated.";
      }),
  );

  server.registerTool(
    "repositories_get",
    {
      title: "Get project repository",
      description:
        "Get one explicit local repository association, including its machine-local canonical path and availability.",
      inputSchema: { project: z.string(), repository: z.string() },
    },
    (input) =>
      guard(() =>
        renderRepository(workspace.repositories.get(input.project, input.repository)),
      ),
  );

  server.registerTool(
    "repositories_update",
    {
      title: "Update project repository",
      description:
        "Update repository label, canonical root, remote metadata or transfer primary selection.",
      inputSchema: {
        project: z.string(),
        repository: z.string(),
        label: z.string().min(1).max(200).optional(),
        root_path: z.string().min(1).optional(),
        remote_url: z.string().nullable().optional(),
        primary: z.literal(true).optional(),
        ...actorShape,
      },
    },
    (input) =>
      guard(() =>
        renderRepository(
          workspace.repositories.update(input.project, input.repository, {
            ...(input.label !== undefined ? { label: input.label } : {}),
            ...(input.root_path !== undefined ? { rootPath: input.root_path } : {}),
            ...(input.remote_url !== undefined ? { remoteUrl: input.remote_url } : {}),
            ...(input.primary ? { primary: true } : {}),
            ...meta(input),
          }),
        ),
      ),
  );

  server.registerTool(
    "repositories_remove",
    {
      title: "Remove project repository",
      description:
        "Remove an explicit repository association. Running execution bindings always block removal; force only permits explicit cleanup of ended-execution bindings.",
      inputSchema: {
        project: z.string(),
        repository: z.string(),
        force: z.boolean().optional(),
        ...actorShape,
      },
    },
    (input) =>
      guard(() => {
        const removed = workspace.repositories.remove(input.project, input.repository, {
          force: input.force ?? false,
          ...meta(input),
        });
        return `Removed ${removed.key} — ${removed.label}; removed ${removed.removedWorktreeBindings} ended worktree binding(s).`;
      }),
  );

  // ------------------------------------------------------------------- tasks

  server.registerTool(
    "tasks_create",
    {
      title: "Create tasks",
      description:
        "Create one or several tasks in a project. Creation is transactional: if one task is invalid, none are created.",
      inputSchema: {
        project: z.string(),
        tasks: z
          .array(
            z.object({
              title: z.string(),
              description: z.string().optional(),
              context: z.string().optional(),
              status: taskStatusSchema.optional(),
              priority: taskPrioritySchema.optional(),
              acceptance_criteria: z.array(z.string()).optional(),
              depends_on: z.array(z.string()).optional().describe("Existing task keys"),
            }),
          )
          .min(1),
        ...actorShape,
      },
    },
    (input) =>
      guard(() => {
        const created = workspace.tasks.createMany(
          input.project,
          input.tasks.map((task) => ({
            title: task.title,
            description: task.description ?? null,
            context: task.context ?? null,
            ...(task.status ? { status: task.status } : {}),
            ...(task.priority ? { priority: task.priority } : {}),
            ...(task.acceptance_criteria ? { acceptanceCriteria: task.acceptance_criteria } : {}),
            ...(task.depends_on ? { dependencies: task.depends_on } : {}),
          })),
          meta(input),
        );
        return `Created ${created.length} task(s).\n${renderTaskList(created)}`;
      }),
  );

  server.registerTool(
    "tasks_list",
    {
      title: "List tasks",
      description:
        "Query project tasks. Use to find active, ready, blocked or actionable work. An actionable task is ready, has no active blockers and has all dependencies done.",
      inputSchema: {
        project: z.string(),
        statuses: z.array(taskStatusSchema).optional(),
        priorities: z.array(taskPrioritySchema).optional(),
        actionable_only: z.boolean().optional(),
        claimed: z.boolean().optional(),
        blocked: z.boolean().optional(),
        search: z.string().optional(),
      },
    },
    (input) =>
      guard(() =>
        renderTaskList(
          workspace.tasks.list(input.project, {
            ...(input.statuses ? { status: input.statuses } : {}),
            ...(input.priorities ? { priority: input.priorities } : {}),
            ...(input.actionable_only ? { actionable: true } : {}),
            ...(input.claimed !== undefined ? { claimed: input.claimed } : {}),
            ...(input.blocked !== undefined ? { blocked: input.blocked } : {}),
            ...(input.search ? { search: input.search } : {}),
          }),
        ),
      ),
  );

  server.registerTool(
    "tasks_get",
    {
      title: "Get task",
      description:
        "Get the full working state for a task: description, persistent task context, acceptance criteria, dependencies, active claim, progress, blockers, decisions, links and recent activity. Read this before beginning or continuing work.",
      inputSchema: { task: z.string().describe("Task key such as TASK-0042") },
    },
    (input) => guard(() => renderTaskDetail(workspace.tasks.get(input.task))),
  );

  server.registerTool(
    "tasks_update",
    {
      title: "Update task",
      description:
        "Update task title, description, status, priority or parent. Do not use this tool for context updates; use tasks_update_context. Do not use it to complete a task; use tasks_complete.",
      inputSchema: {
        task: z.string(),
        title: z.string().optional(),
        description: z.string().optional(),
        status: taskStatusSchema.optional(),
        priority: taskPrioritySchema.optional(),
        parent_task: z.string().nullable().optional(),
        ...actorShape,
      },
    },
    (input) =>
      guard(() => {
        const task = workspace.tasks.update(input.task, {
          ...(input.title ? { title: input.title } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.status ? { status: input.status } : {}),
          ...(input.priority ? { priority: input.priority } : {}),
          ...(input.parent_task !== undefined ? { parentTask: input.parent_task } : {}),
          ...meta(input),
        });
        return `Updated task.\n${renderTaskLine(task)}`;
      }),
  );

  server.registerTool(
    "tasks_update_context",
    {
      title: "Update task context",
      description:
        "Replace the persistent task context: knowledge a future agent needs specifically to complete this task, such as prior reasoning, constraints and rejected approaches. Do not use it as a progress log.",
      inputSchema: {
        task: z.string(),
        context: z.string().nullable(),
        expected_version: z.number().int().min(0),
        reason: z.string().min(1).max(2000).optional(),
        ...actorShape,
      },
    },
    (input) =>
      guard(() => {
        const task = workspace.tasks.updateContext(input.task, {
          context: input.context,
          expectedVersion: input.expected_version,
          ...(input.reason ? { reason: input.reason } : {}),
          ...meta(input),
        });
        return `Updated context for ${task.key} to v${task.contextVersion} (${renderContextSize(
          task.contextSize,
        )}).`;
      }),
  );

  server.registerTool(
    "tasks_context_history",
    {
      title: "List task context history",
      description:
        "List bounded immutable task-context version metadata without returning historical content.",
      inputSchema: {
        task: z.string(),
        limit: z.number().int().min(1).max(100).default(20),
        before_version: z.number().int().min(1).optional(),
      },
    },
    (input) =>
      guard(() =>
        renderContextHistory(
          workspace.contexts.listTask(input.task, {
            limit: input.limit,
            ...(input.before_version ? { beforeVersion: input.before_version } : {}),
          }),
        ),
      ),
  );

  server.registerTool(
    "tasks_context_version_get",
    {
      title: "Get task context version",
      description: "Get the full content and metadata of one task-context version.",
      inputSchema: { task: z.string(), version: z.number().int().min(1) },
    },
    (input) =>
      guard(() => renderContextVersion(workspace.contexts.getTask(input.task, input.version))),
  );

  server.registerTool(
    "tasks_context_revert",
    {
      title: "Revert task context",
      description:
        "Append a new current task-context version by copying a historical version. Later history is preserved.",
      inputSchema: {
        task: z.string(),
        target_version: z.number().int().min(1),
        expected_version: z.number().int().min(0),
        reason: z.string().min(1).max(2000).optional(),
        ...actorShape,
      },
    },
    (input) =>
      guard(() => {
        const row = workspace.contexts.revertTask(input.task, {
          targetVersion: input.target_version,
          expectedVersion: input.expected_version,
          ...(input.reason ? { reason: input.reason } : {}),
          ...meta(input),
        });
        const task = workspace.tasks.getSummary(row.id);
        return `Reverted ${task.key} context as v${task.contextVersion} (${renderContextSize(
          task.contextSize,
        )}).`;
      }),
  );

  server.registerTool(
    "start_work",
    {
      title: "Start or resume task work",
      description:
        "Atomically claim eligible work (or resume your own live claim) and return project context, full task state, dependencies, blockers and execution resume state in one response.",
      inputSchema: {
        task: z.string(),
        actor: z.string().min(1).max(120),
        session_id: z.string().min(1).max(200),
        ttl_minutes: z.number().int().min(1).max(1440).optional(),
        worktree: z
          .object({
            repository: z.string().min(1),
            worktree_path: z.string().min(1),
            branch: z.string().nullable().optional(),
          })
          .strict()
          .optional(),
      },
    },
    (input) =>
      guardAsync(async () => {
        const result = await workspace.workflows.startWork(input.task, {
          actor: input.actor,
          sessionId: input.session_id,
          ...(input.ttl_minutes ? { ttlMinutes: input.ttl_minutes } : {}),
          ...(input.worktree
            ? {
                worktree: {
                  repository: input.worktree.repository,
                  worktreePath: input.worktree.worktree_path,
                  ...(input.worktree.branch !== undefined
                    ? { branch: input.worktree.branch }
                    : {}),
                },
              }
            : {}),
        });
        return [
          "Work started.",
          "",
          renderProjectDetail(result.project),
          "",
          renderTaskDetail(result.task),
          "",
          `Resume state: ${result.execution.handoff ? `${result.execution.handoff.summary}${result.execution.handoff.nextAction ? `; next: ${result.execution.handoff.nextAction}` : ""}` : "new execution"}`,
          `Checkpoints:\n${renderCheckpoints(result.execution.checkpoints).join("\n") || "none"}`,
          `Work plan:\n${renderWorkPlan(result.execution.workPlan).join("\n") || "none"}`,
        ].join("\n");
      }),
  );

  server.registerTool(
    "report",
    {
      title: "Report task execution state",
      description:
        "Refresh liveness and optionally record the current phase, one meaningful progress milestone and one checkpoint in a single transaction. Passing only actor/session/phase is a silent heartbeat.",
      inputSchema: {
        task: z.string(),
        actor: z.string().min(1).max(120),
        session_id: z.string().min(1).max(200),
        phase: z.string().min(1).max(500).optional(),
        progress: z.string().min(1).max(20_000).optional(),
        checkpoint: z
          .object({
            completed: workflowCheckpointSchema.shape.completed,
            working_on: workflowCheckpointSchema.shape.workingOn,
            next: workflowCheckpointSchema.shape.next,
            uncertainty: workflowCheckpointSchema.shape.uncertainty,
          })
          .strict()
          .optional(),
      },
    },
    (input) =>
      guardAsync(async () => {
        const result = await workspace.workflows.report(input.task, {
          actor: input.actor,
          sessionId: input.session_id,
          ...(input.phase ? { phase: input.phase } : {}),
          ...(input.progress ? { progress: input.progress } : {}),
          ...(input.checkpoint
            ? {
                checkpoint: {
                  completed: input.checkpoint.completed,
                  workingOn: input.checkpoint.working_on,
                  next: input.checkpoint.next,
                  ...(input.checkpoint.uncertainty !== undefined
                    ? { uncertainty: input.checkpoint.uncertainty }
                    : {}),
                },
              }
            : {}),
        });
        return [
          `Report recorded for ${result.claim.taskKey}.`,
          `Execution: ${result.execution.health}${result.execution.currentPhase ? ` — ${result.execution.currentPhase}` : ""}`,
          `Progress: ${result.progress?.content ?? "none (liveness only)"}`,
          `Checkpoint: ${result.checkpoint ? `next: ${result.checkpoint.next}` : "none"}`,
          result.provenance
            ? `Git: ${result.provenance.status} — ${result.provenance.filesChanged} touched paths`
            : "Git: not captured",
        ].join("\n");
      }),
  );

  server.registerTool(
    "handoff",
    {
      title: "Hand off task execution",
      description:
        "Atomically validate claim ownership, record a final checkpoint, produce durable resume information and release the claim.",
      inputSchema: {
        task: z.string(),
        actor: z.string().min(1).max(120),
        session_id: z.string().min(1).max(200),
        reason: z.string().min(1).max(2_000).optional(),
        phase: z.string().min(1).max(500).optional(),
        checkpoint: z
          .object({
            completed: workflowCheckpointSchema.shape.completed,
            working_on: workflowCheckpointSchema.shape.workingOn,
            next: workflowCheckpointSchema.shape.next,
            uncertainty: workflowCheckpointSchema.shape.uncertainty,
          })
          .strict(),
      },
    },
    (input) =>
      guardAsync(async () => {
        const result = await workspace.workflows.handoff(input.task, {
          actor: input.actor,
          sessionId: input.session_id,
          reason: input.reason ?? "handoff",
          ...(input.phase ? { phase: input.phase } : {}),
          checkpoint: {
            completed: input.checkpoint.completed,
            workingOn: input.checkpoint.working_on,
            next: input.checkpoint.next,
            ...(input.checkpoint.uncertainty !== undefined
              ? { uncertainty: input.checkpoint.uncertainty }
              : {}),
          },
        });
        return [
          `Handed off ${result.releasedClaim.taskKey}.`,
          result.handoff.summary,
          `Next: ${result.handoff.nextAction ?? "none"}`,
          `Unresolved: ${result.handoff.unresolved.join("; ") || "none"}`,
          result.provenance
            ? `Git: ${result.provenance.status} — ${result.provenance.filesChanged} touched paths`
            : "Git: not captured",
          "Claim released safely.",
        ].join("\n");
      }),
  );

  server.registerTool(
    "tasks_claim",
    {
      title: "Claim task",
      description:
        "Claim a task before beginning meaningful work. Claims are temporary leases that expire, not permanent assignment. Do not claim a task simply to inspect it. A ready task moves to in_progress when claimed.",
      inputSchema: {
        task: z.string(),
        actor: z.string().describe("Identifier for the calling agent"),
        session_id: z.string().optional(),
        ttl_minutes: z.number().int().min(1).max(1440).optional(),
      },
    },
    (input) =>
      guard(() => {
        const { claim, task } = workspace.claims.claim(input.task, {
          actor: input.actor,
          ...(input.session_id ? { sessionId: input.session_id } : {}),
          ...(input.ttl_minutes ? { ttlMinutes: input.ttl_minutes } : {}),
        });
        return `Claimed ${task.key} for ${claim.actor}. Lease expires in ${claim.expiresInMinutes} minutes.\n\n${renderTaskDetail(
          workspace.tasks.get(task.id),
        )}`;
      }),
  );

  server.registerTool(
    "tasks_release_claim",
    {
      title: "Release task claim",
      description:
        "Release your claim on a task. Do this when a session ends and no immediate continuation is expected. Record progress, context and blockers first so the next agent can continue.",
      inputSchema: { task: z.string(), reason: z.string().optional(), ...actorShape },
    },
    (input) =>
      guard(() => {
        const claim = workspace.claims.release(input.task, {
          ...(input.reason ? { reason: input.reason } : {}),
          ...meta(input),
        });
        return `Released the claim on ${claim.taskKey}.`;
      }),
  );

  server.registerTool(
    "tasks_heartbeat",
    {
      title: "Heartbeat task execution",
      description: "Silently refresh a claimed task's execution liveness. Use while actively working, but do not use this as progress reporting or narrate ordinary commands.",
      inputSchema: { task: z.string(), actor: z.string().min(1), session_id: z.string().optional(), phase: z.string().optional() },
    },
    (input) => guard(() => {
      workspace.claims.heartbeat(input.task, { actor: input.actor, ...(input.session_id ? { sessionId: input.session_id } : {}), ...(input.phase ? { phase: input.phase } : {}) });
      return "Heartbeat recorded.";
    }),
  );

  server.registerTool(
    "tasks_execution_get",
    {
      title: "Get execution continuity state",
      description: "Read execution health, meaningful checkpoints, work plan, and the latest handoff. Task status and execution health are distinct.",
      inputSchema: { task: z.string() },
    },
    (input) => guard(() => {
      const state = workspace.executions.forTask(input.task);
      return [
        `Execution: ${state.execution ? `${state.execution.actor} — ${state.execution.health}` : "none"}`,
        `Worktree: ${
          state.execution?.worktree
            ? `${state.execution.worktree.repositoryKey}${
                state.execution.worktree.branch
                  ? ` (${state.execution.worktree.branch})`
                  : ""
              } — ${state.execution.worktree.availability.status}`
            : "unbound"
        }`,
        `Checkpoints:\n${renderCheckpoints(state.checkpoints).join("\n") || "none"}`,
        `Work plan:\n${renderWorkPlan(state.workPlan).join("\n") || "none"}`,
        `Handoff: ${state.handoff ? `${state.handoff.summary}${state.handoff.nextAction ? `; next: ${state.handoff.nextAction}` : ""}` : "none"}`,
        renderGitProvenance(state.provenance),
        renderPathOwnership(state.ownership, state.collisions),
      ].join("\n");
    }),
  );

  server.registerTool(
    "tasks_worktree_get",
    {
      title: "Get execution worktree",
      description:
        "Read the running execution's explicit repository/worktree binding, including its machine-local path.",
      inputSchema: { task: z.string() },
    },
    (input) => guard(() => renderWorktree(workspace.repositories.worktree(input.task))),
  );

  server.registerTool(
    "tasks_path_ownership_get",
    {
      title: "Get execution path ownership",
      description:
        "Read the current execution's repository-relative path declarations and derived live collision advisories. Advisories coordinate agents but never block claims.",
      inputSchema: { task: z.string() },
    },
    (input) =>
      guard(() =>
        renderPathOwnership(
          workspace.ownership.forTask(input.task),
          workspace.ownership.collisionsForTask(input.task),
        ),
      ),
  );

  server.registerTool(
    "tasks_path_ownership_set",
    {
      title: "Replace execution path ownership",
      description:
        "Replace the running execution's exact repository-relative file and directory declarations. Paths are versioned and scoped to the explicitly bound repository/worktree; globs, absolute paths and traversal are rejected.",
      inputSchema: {
        task: z.string(),
        paths: z
          .array(
            z.object({
              path: z.string().min(1),
              kind: z.enum(["file", "directory"]),
            }),
          )
          .max(500),
        actor: z.string().min(1),
        session_id: z.string().optional(),
      },
    },
    (input) =>
      guard(() => {
        const result = workspace.ownership.replace(input.task, {
          paths: input.paths,
          actor: input.actor,
          ...(input.session_id ? { sessionId: input.session_id } : {}),
        });
        return renderPathOwnership(result.ownership, result.collisions);
      }),
  );

  server.registerTool(
    "tasks_worktree_bind",
    {
      title: "Bind execution worktree",
      description:
        "Bind a claimed task's running execution to an explicit project repository, absolute worktree path and optional branch. No value is inferred from cwd.",
      inputSchema: {
        task: z.string(),
        repository: z.string(),
        worktree_path: z.string().min(1),
        branch: z.string().nullable().optional(),
        actor: z.string().min(1),
        session_id: z.string().optional(),
      },
    },
    (input) =>
      guardAsync(async () => {
        const worktree = workspace.repositories.bindWorktree(input.task, {
            repository: input.repository,
            worktreePath: input.worktree_path,
            ...(input.branch !== undefined ? { branch: input.branch } : {}),
            actor: input.actor,
            ...(input.session_id ? { sessionId: input.session_id } : {}),
          });
        await workspace.git.captureBaseline(input.task, worktree.executionId);
        return renderWorktree(worktree);
      }),
  );

  server.registerTool(
    "tasks_worktree_unbind",
    {
      title: "Unbind execution worktree",
      description: "Detach the explicit worktree from the running execution.",
      inputSchema: {
        task: z.string(),
        actor: z.string().min(1),
        session_id: z.string().optional(),
      },
    },
    (input) =>
      guard(() =>
        renderWorktree(
          workspace.repositories.unbindWorktree(input.task, {
            actor: input.actor,
            ...(input.session_id ? { sessionId: input.session_id } : {}),
          }),
        ),
      ),
  );

  server.registerTool(
    "tasks_checkpoint",
    {
      title: "Record a meaningful checkpoint",
      description: "Record what is completed, what is being worked on, and the next action at a phase boundary or before handoff. Do not use for routine command-by-command narration.",
      inputSchema: { task: z.string(), completed: z.string().min(1), working_on: z.string().min(1), next: z.string().min(1), uncertainty: z.string().nullable().optional(), ...actorShape },
    },
    (input) => guardAsync(async () => {
      const checkpoint = workspace.executions.checkpoint(input.task, { completed: input.completed, workingOn: input.working_on, next: input.next, ...(input.uncertainty !== undefined ? { uncertainty: input.uncertainty } : {}), ...meta(input) });
      const provenance = checkpoint.executionId
        ? await workspace.git.captureSnapshot(input.task, {
            trigger: "checkpoint",
            checkpointId: checkpoint.id,
            executionId: checkpoint.executionId,
          })
        : null;
      const collisions = workspace.ownership.collisionsForTask(input.task);
      return `Checkpoint recorded for ${checkpoint.taskId}.${provenance ? ` Git snapshot: ${provenance.status}.` : ""}${collisions.length ? ` ${collisions.length} path collision advisory warning${collisions.length === 1 ? "" : "s"}.` : ""}`;
    }),
  );

  server.registerTool(
    "tasks_git_provenance_get",
    {
      title: "Get execution Git provenance",
      description:
        "Read derived Git baseline, snapshots and structured touched-path facts for the active or most recent execution. These facts come only from the local Git adapter; agent-authored notes remain checkpoints and evidence.",
      inputSchema: { task: z.string() },
    },
    (input) => guard(() => renderGitProvenance(workspace.provenance.forTask(input.task))),
  );

  server.registerTool(
    "tasks_git_provenance_capture",
    {
      title: "Capture execution Git provenance",
      description:
        "Capture a manual read-only Git snapshot from the task execution's stored worktree binding. No path or cwd can be supplied.",
      inputSchema: { task: z.string() },
    },
    (input) =>
      guardAsync(async () => {
        const snapshot = await workspace.git.captureSnapshot(input.task, { trigger: "manual" });
        if (!snapshot) return "No explicit execution worktree is available; nothing was captured.";
        return [
          renderGitProvenance(workspace.provenance.forTask(input.task)),
          renderPathOwnership(
            workspace.ownership.forTask(input.task),
            workspace.ownership.collisionsForTask(input.task),
          ),
        ].join("\n");
      }),
  );

  server.registerTool(
    "tasks_work_plan",
    {
      title: "Set or update a task work plan",
      description: "Set a lightweight ordered implementation plan, or update one item's execution status. Plans describe work phases, not acceptance criteria.",
      inputSchema: { task: z.string(), items: z.array(z.string().min(1)).min(1).optional(), item: z.string().optional(), status: z.enum(["pending", "active", "completed", "skipped"]).optional(), ...actorShape },
    },
    (input) => guard(() => {
      if (input.items) return `Work plan updated.\n${renderWorkPlan(workspace.executions.setWorkPlan(input.task, { items: input.items, ...meta(input) }))}`;
      if (input.item && input.status) return `Work-plan item updated: ${workspace.executions.updateWorkPlanItem(input.task, input.item, { status: input.status, ...meta(input) }).title}`;
      return `Work plan:\n${renderWorkPlan(workspace.executions.workPlan(input.task)).join("\n") || "none"}`;
    }),
  );

  server.registerTool(
    "tasks_add_criterion_evidence",
    {
      title: "Attach acceptance-criterion evidence",
      description: "Persist typed commit, test, file, URL, result, or note evidence. This tool stores data only and never runs commands or fetches URLs.",
      inputSchema: {
        task: z.string(),
        criterion: z.string(),
        kind: z.enum(["commit", "test", "file", "url", "result", "note"]),
        repository: z.string().optional(),
        sha: z.string().optional(),
        execution_id: z.string().optional(),
        worktree_id: z.string().optional(),
        name: z.string().optional(),
        outcome: z.enum(["passed", "failed", "informational"]).optional(),
        reference: z.string().optional(),
        path: z.string().optional(),
        title: z.string().optional(),
        summary: z.string().optional(),
        content: z.string().optional(),
        url: z.string().url().optional(),
        ...actorShape,
      },
    },
    (input) => guard(() => {
      const scope = input.repository
        ? {
            repository: input.repository,
            ...(input.sha ? { sha: input.sha } : {}),
            ...(input.execution_id ? { executionId: input.execution_id } : {}),
            ...(input.worktree_id ? { worktreeId: input.worktree_id } : {}),
          }
        : undefined;
      const candidate: unknown =
        input.kind === "commit"
          ? { kind: "commit", scope, ...(input.summary ? { summary: input.summary } : {}), ...meta(input) }
          : input.kind === "test"
            ? {
                kind: "test",
                name: input.name,
                outcome: input.outcome,
                ...(input.reference ? { reference: input.reference } : {}),
                ...(input.summary ? { summary: input.summary } : {}),
                ...(scope ? { scope } : {}),
                ...meta(input),
              }
            : input.kind === "file"
              ? {
                  kind: "file",
                  path: input.path,
                  ...(input.summary ? { description: input.summary } : {}),
                  ...(scope ? { scope } : {}),
                  ...meta(input),
                }
              : input.kind === "url"
                ? {
                    kind: "url",
                    url: input.url,
                    ...(input.title ? { title: input.title } : {}),
                    ...(input.summary ? { summary: input.summary } : {}),
                    ...meta(input),
                  }
                : input.kind === "result"
                  ? { kind: "result", summary: input.summary, outcome: input.outcome, ...meta(input) }
                  : { kind: "note", content: input.content, ...meta(input) };
      const parsed = criterionEvidenceSchema.safeParse(candidate);
      if (!parsed.success) {
        throw new AgentContinuityError("VALIDATION_ERROR", "Invalid structured evidence.", {
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        });
      }
      const evidence = workspace.evidence.add(input.task, input.criterion, parsed.data);
      return `Evidence ${evidence.id} (${evidence.kind}) attached.`;
    }),
  );

  server.registerTool(
    "tasks_criterion_evidence",
    {
      title: "List acceptance-criterion evidence",
      description: "Read typed and migrated legacy evidence for one criterion.",
      inputSchema: { task: z.string(), criterion: z.string() },
    },
    (input) =>
      guard(() => {
        const rows = workspace.evidence.list(input.task, input.criterion);
        return rows.length === 0 ? "No evidence." : JSON.stringify(rows, null, 2);
      }),
  );

  server.registerTool(
    "tasks_criterion_evidence_policy",
    {
      title: "Get or set criterion evidence policy",
      description: "Read, set or clear an optional evidence requirement used at task completion.",
      inputSchema: {
        task: z.string(),
        criterion: z.string(),
        clear: z.boolean().optional(),
        minimum_count: z.number().int().min(1).max(100).optional(),
        qualifying_kinds: z
          .array(z.enum(["commit", "test", "file", "url", "result", "note"]))
          .optional(),
        require_sha: z.boolean().optional(),
        require_passing_verification: z.boolean().optional(),
        ...actorShape,
      },
    },
    (input) =>
      guard(() => {
        if (input.clear) {
          workspace.evidence.clearPolicy(input.task, input.criterion, meta(input));
          return "Evidence policy cleared.";
        }
        if (input.minimum_count !== undefined || input.qualifying_kinds !== undefined) {
          if (input.minimum_count === undefined || !input.qualifying_kinds) {
            throw new AgentContinuityError(
              "VALIDATION_ERROR",
              "minimum_count and qualifying_kinds are required together.",
            );
          }
          return JSON.stringify(
            workspace.evidence.setPolicy(input.task, input.criterion, {
              minimumCount: input.minimum_count,
              qualifyingKinds: input.qualifying_kinds,
              requireSha: input.require_sha ?? false,
              requirePassingVerification: input.require_passing_verification ?? false,
              ...meta(input),
            }),
            null,
            2,
          );
        }
        return JSON.stringify(
          workspace.evidence.getPolicy(input.task, input.criterion),
          null,
          2,
        );
      }),
  );

  server.registerTool(
    "tasks_add_execution_origin",
    {
      title: "Link an execution to its origin",
      description: "Record the Codex thread or external agent session that originated this execution, so a later agent can find the source conversation without coupling task state to one provider.",
      inputSchema: { task: z.string(), provider: z.string().min(1), reference: z.string().min(1), url: z.string().url().nullable().optional(), metadata: z.record(z.string(), z.unknown()).nullable().optional() },
    },
    (input) => guard(() => {
      const origin = workspace.executions.addOrigin(input.task, { provider: input.provider, reference: input.reference, ...(input.url !== undefined ? { url: input.url } : {}), ...(input.metadata !== undefined ? { metadata: input.metadata } : {}) });
      return `Execution origin recorded: ${origin.provider} ${origin.reference}.`;
    }),
  );

  server.registerTool(
    "attention_list",
    { title: "List work needing attention", description: "List stale or interrupted execution, expired claims, blockers, review work, and handoffs that require action.", inputSchema: {} },
    () => guard(() => renderAttention(workspace.executions.needsAttention())),
  );

  server.registerTool(
    "tasks_add_progress",
    {
      title: "Add task progress",
      description:
        "Record a meaningful progress milestone, such as 'data model implemented' or 'primary failure scenario identified'. Do not use for every command, file edit or minor implementation step. Progress should help another agent understand how far the work has advanced. Recording progress also renews your claim.",
      inputSchema: { task: z.string(), content: z.string().min(1), ...actorShape },
    },
    (input) =>
      guardAsync(async () => {
        const entry = workspace.tasks.addProgress(input.task, {
          content: input.content,
          ...meta(input),
        });
        return `Recorded progress on ${entry.taskKey}.`;
      }),
  );

  server.registerTool(
    "tasks_add_blocker",
    {
      title: "Add blocker",
      description:
        "Record that work cannot reasonably continue without user clarification, an external dependency, missing access or an unresolved behaviour. State the required action when it is known. The task moves to blocked. Do not pretend a blocked task is still progressing.",
      inputSchema: {
        task: z.string(),
        description: z.string().min(1),
        required_action: z.string().optional(),
        ...actorShape,
      },
    },
    (input) =>
      guard(() => {
        const blocker = workspace.blockers.add(input.task, {
          description: input.description,
          ...(input.required_action ? { requiredAction: input.required_action } : {}),
          ...meta(input),
        });
        return `${blocker.taskKey} is now blocked by ${blocker.key}: ${blocker.description}`;
      }),
  );

  server.registerTool(
    "tasks_resolve_blocker",
    {
      title: "Resolve blocker",
      description:
        "Resolve a blocker with the answer or outcome that unblocked it. When no active blockers remain the task returns to in_progress if it is still claimed, otherwise to ready.",
      inputSchema: {
        blocker: z.string().describe("Blocker key such as BLK-0012"),
        resolution: z.string().min(1),
        ...actorShape,
      },
    },
    (input) =>
      guard(() => {
        const blocker = workspace.blockers.resolve(input.blocker, {
          resolution: input.resolution,
          ...meta(input),
        });
        const task = workspace.tasks.getSummary(blocker.taskKey);
        return `Resolved ${blocker.key}. ${task.key} is now ${task.status}.`;
      }),
  );

  server.registerTool(
    "tasks_complete",
    {
      title: "Complete task",
      description:
        "Complete a task. Completion is rejected while incomplete acceptance criteria or active blockers remain, unless force is true and a reason is given. Only force when a criterion is genuinely obsolete or intentionally excluded. Completing a task releases its claim.",
      inputSchema: {
        task: z.string(),
        force: z.boolean().optional(),
        reason: z.string().optional().describe("Required when force is true"),
        ...actorShape,
      },
    },
    (input) =>
      guardAsync(async () => {
        if (input.force && !input.reason) {
          throw new AgentContinuityError(
            "VALIDATION_ERROR",
            "A reason is required when forcing completion.",
          );
        }
        const task = await workspace.workflows.complete(input.task, {
          force: input.force ?? false,
          ...(input.reason ? { reason: input.reason } : {}),
          ...meta(input),
        });
        return `Completed ${task.key} — ${task.title}.`;
      }),
  );

  server.registerTool(
    "tasks_delete",
    {
      title: "Delete task",
      description:
        "Permanently delete a task and everything it owns: acceptance criteria, progress, blockers, claims, task links, dependency edges and its own activity history. This cannot be undone. Prefer completing or reopening a task over deleting it; delete is for tasks created in error. Subtasks survive as top level tasks and task-scoped decisions fall back to project scope.",
      inputSchema: {
        task: z.string(),
        force: z
          .boolean()
          .optional()
          .describe("Required to delete a task another agent currently holds a claim on"),
        ...actorShape,
      },
    },
    (input) =>
      guard(() => {
        const deleted = workspace.tasks.delete(input.task, {
          force: input.force ?? false,
          ...meta(input),
        });
        const { removed } = deleted;
        return [
          `Deleted ${deleted.key} — ${deleted.title} from ${deleted.projectKey}.`,
          `Removed ${removed.acceptanceCriteria} acceptance criteria, ${removed.progress} progress entries, ${removed.blockers} blockers, ${removed.links} links, ${removed.dependencies} dependencies, ${removed.dependents} dependents and ${removed.activityEvents} activity events.`,
          ...(deleted.orphanedSubtasks.length > 0
            ? [`Subtasks promoted to top level: ${deleted.orphanedSubtasks.join(", ")}`]
            : []),
          ...(deleted.detachedDecisions.length > 0
            ? [`Decisions rescoped to the project: ${deleted.detachedDecisions.join(", ")}`]
            : []),
        ].join("\n");
      }),
  );

  // ----------------------------------------------------- acceptance criteria

  server.registerTool(
    "tasks_add_acceptance_criteria",
    {
      title: "Add acceptance criteria",
      description:
        "Add acceptance criteria to a task. Criteria should describe checkable outcomes rather than implementation steps. Adding criteria to a completed task reopens it.",
      inputSchema: { task: z.string(), criteria: z.array(z.string().min(1)).min(1), ...actorShape },
    },
    (input) =>
      guard(() => {
        workspace.tasks.addAcceptanceCriteria(input.task, input.criteria, meta(input));
        const task = workspace.tasks.get(input.task);
        return `Acceptance criteria for ${task.key}:\n${renderCriteria(task.acceptanceCriteria).join("\n")}`;
      }),
  );

  server.registerTool(
    "tasks_update_acceptance_criteria",
    {
      title: "Update acceptance criteria",
      description:
        "Mark acceptance criteria complete or reopen them. Criteria may be referenced by their exact description or by criterion id. Returns the complete criteria set for the task.",
      inputSchema: {
        task: z.string(),
        complete: z.array(z.string()).optional(),
        reopen: z.array(z.string()).optional(),
        ...actorShape,
      },
    },
    (input) =>
      guard(() => {
        const criteria = workspace.tasks.updateAcceptanceCriteria(input.task, {
          ...(input.complete ? { complete: input.complete } : {}),
          ...(input.reopen ? { reopen: input.reopen } : {}),
          ...meta(input),
        });
        const task = workspace.tasks.getSummary(input.task);
        return `Acceptance criteria for ${task.key} (${task.acceptanceCriteriaCompleted}/${task.acceptanceCriteriaTotal}):\n${renderCriteria(
          criteria,
        ).join("\n")}`;
      }),
  );

  // ------------------------------------------------------------ dependencies

  server.registerTool(
    "tasks_add_dependency",
    {
      title: "Add task dependency",
      description:
        "Record that a task cannot proceed until another task in the same project is done. Cycles are rejected. Create dependencies only when the ordering is genuinely required.",
      inputSchema: { task: z.string(), depends_on: z.string(), ...actorShape },
    },
    (input) =>
      guard(() => {
        const task = workspace.tasks.addDependency(input.task, input.depends_on, meta(input));
        return `${task.key} now depends on ${input.depends_on}.`;
      }),
  );

  server.registerTool(
    "tasks_remove_dependency",
    {
      title: "Remove task dependency",
      description: "Remove a dependency between two tasks.",
      inputSchema: { task: z.string(), depends_on: z.string(), ...actorShape },
    },
    (input) =>
      guard(() => {
        const task = workspace.tasks.removeDependency(input.task, input.depends_on, meta(input));
        return `${task.key} no longer depends on ${input.depends_on}.`;
      }),
  );

  // --------------------------------------------------------------- decisions

  server.registerTool(
    "decisions_create",
    {
      title: "Record decision",
      description:
        "Record an explicit choice that future agents may need to understand or justify. Use for meaningful architectural, product, workflow or implementation decisions, including deliberately rejected approaches. A decision must say both what was decided and why. Do not use it for ordinary progress updates.",
      inputSchema: {
        project: z.string(),
        task: z.string().optional().describe("Optional task scope"),
        title: z.string(),
        decision: z.string(),
        rationale: z.string().optional(),
        supersedes: z.string().optional().describe("Key of a decision this one replaces"),
        ...actorShape,
      },
    },
    (input) =>
      guard(() => {
        const decision = workspace.decisions.create(input.project, {
          ...(input.task ? { task: input.task } : {}),
          title: input.title,
          decision: input.decision,
          rationale: input.rationale ?? null,
          ...(input.supersedes ? { supersedes: input.supersedes } : {}),
          ...meta(input),
        });
        return `Recorded ${decision.key}.\n${renderDecisionLine(decision)}`;
      }),
  );

  server.registerTool(
    "decisions_list",
    {
      title: "List decisions",
      description:
        "List recorded decisions for a project, optionally scoped to a task or filtered by free text. Read these before revisiting a choice someone already made.",
      inputSchema: { project: z.string(), task: z.string().optional(), search: z.string().optional() },
    },
    (input) =>
      guard(() => {
        const decisions = workspace.decisions.list(input.project, {
          ...(input.task ? { task: input.task } : {}),
          ...(input.search ? { search: input.search } : {}),
          limit: 100,
        });
        return decisions.length === 0
          ? "No decisions recorded."
          : decisions.map(renderDecisionLine).join("\n\n");
      }),
  );

  // ------------------------------------------------------------------- links

  server.registerTool(
    "links_add",
    {
      title: "Add links",
      description:
        "Attach one or more external resources to a project or task. Links are generic: type and provider are free text, for example issue/jira, branch/git or document. No provider behaviour is implied.",
      inputSchema: {
        project: z.string(),
        task: z.string().optional(),
        links: z
          .array(
            z.object({
              type: z.string(),
              provider: z.string().optional(),
              reference: z.string().optional(),
              url: z.string().optional(),
              metadata: z.record(z.string(), z.unknown()).optional(),
            }),
          )
          .min(1),
        ...actorShape,
      },
    },
    (input) =>
      guard(() => {
        const links = workspace.links.add(input.project, {
          ...(input.task ? { task: input.task } : {}),
          links: input.links.map((link) => ({
            type: link.type,
            provider: link.provider ?? null,
            reference: link.reference ?? null,
            url: link.url ?? null,
            metadata: link.metadata ?? null,
          })),
          ...meta(input),
        });
        return `Added ${links.length} link(s).\n${links.map(renderLinkLine).join("\n")}`;
      }),
  );

  server.registerTool(
    "links_list",
    {
      title: "List links",
      description: "List the external resources attached to a project or one of its tasks.",
      inputSchema: {
        project: z.string(),
        task: z.string().optional(),
        type: z.string().optional(),
        provider: z.string().optional(),
      },
    },
    (input) =>
      guard(() => {
        const links = workspace.links.list(input.project, {
          ...(input.task ? { task: input.task } : {}),
          ...(input.type ? { type: input.type } : {}),
          ...(input.provider ? { provider: input.provider } : {}),
        });
        return links.length === 0 ? "No links." : links.map(renderLinkLine).join("\n");
      }),
  );

  server.registerTool(
    "links_remove",
    {
      title: "Remove link",
      description: "Remove a link by key.",
      inputSchema: { link: z.string(), ...actorShape },
    },
    (input) =>
      guard(() => {
        workspace.links.remove(input.link, meta(input));
        return `Removed ${input.link}.`;
      }),
  );

  // ---------------------------------------------------------------- activity

  server.registerTool(
    "activity_list",
    {
      title: "List activity",
      description:
        "Retrieve recent structured activity for a project or task. Use to understand what changed, what previous agents worked on, or what happened during a specified period.",
      inputSchema: {
        project: z.string(),
        task: z.string().optional(),
        event_types: z.array(z.string()).optional(),
        actor: z.string().optional(),
        limit: z.number().int().min(1).max(200).optional(),
      },
    },
    (input) =>
      guard(() => {
        const page = workspace.activity.listForProject(input.project, {
          ...(input.task ? { task: input.task } : {}),
          ...(input.event_types
            ? { eventType: input.event_types as Parameters<typeof workspace.activity.listForProject>[1]["eventType"] }
            : {}),
          ...(input.actor ? { actor: input.actor } : {}),
          limit: input.limit ?? 50,
        });
        return page.events.length === 0
          ? "No activity recorded."
          : page.events.map(renderActivityLine).join("\n");
      }),
  );
}
