import {
  AgentContinuityError,
  taskPrioritySchema,
  taskStatusSchema,
  type ProjectStatus,
} from "@agent-continuity/contracts";
import type { Workspace } from "@agent-continuity/core";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  renderActivityLine,
  renderAttention,
  renderCheckpoints,
  renderCriteria,
  renderDecisionLine,
  renderLinkLine,
  renderProjectDetail,
  renderProjectList,
  renderProjectLine,
  renderTaskDetail,
  renderTaskList,
  renderTaskLine,
  renderWorkPlan,
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

export function registerTools(server: McpServer, workspace: Workspace): void {
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
      guard(() => {
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
      inputSchema: { project: z.string(), context: z.string(), ...actorShape },
    },
    (input) =>
      guard(() => {
        const project = workspace.projects.updateContext(input.project, {
          context: input.context,
          ...meta(input),
        });
        return `Updated context for ${project.key} (${input.context.length} characters).`;
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
          `Removed ${removed.tasks} tasks, ${removed.acceptanceCriteria} acceptance criteria, ${removed.progress} progress entries, ${removed.blockers} blockers, ${removed.claims} claims, ${removed.dependencies} dependencies, ${removed.decisions} decisions, ${removed.links} links and ${removed.activityEvents} activity events.`,
        ].join("\n");
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
      inputSchema: { task: z.string(), context: z.string(), ...actorShape },
    },
    (input) =>
      guard(() => {
        const task = workspace.tasks.updateContext(input.task, {
          context: input.context,
          ...meta(input),
        });
        return `Updated context for ${task.key} (${input.context.length} characters).`;
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
        `Checkpoints:\n${renderCheckpoints(state.checkpoints).join("\n") || "none"}`,
        `Work plan:\n${renderWorkPlan(state.workPlan).join("\n") || "none"}`,
        `Handoff: ${state.handoff ? `${state.handoff.summary}${state.handoff.nextAction ? `; next: ${state.handoff.nextAction}` : ""}` : "none"}`,
      ].join("\n");
    }),
  );

  server.registerTool(
    "tasks_checkpoint",
    {
      title: "Record a meaningful checkpoint",
      description: "Record what is completed, what is being worked on, and the next action at a phase boundary or before handoff. Do not use for routine command-by-command narration.",
      inputSchema: { task: z.string(), completed: z.string().min(1), working_on: z.string().min(1), next: z.string().min(1), uncertainty: z.string().nullable().optional(), ...actorShape },
    },
    (input) => guard(() => {
      const checkpoint = workspace.executions.checkpoint(input.task, { completed: input.completed, workingOn: input.working_on, next: input.next, ...(input.uncertainty !== undefined ? { uncertainty: input.uncertainty } : {}), ...meta(input) });
      return `Checkpoint recorded for ${checkpoint.taskId}.`;
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
      description: "Attach test output, a file reference, result, or URL that proves one acceptance criterion. Add evidence as it is proven rather than only at completion.",
      inputSchema: { task: z.string(), criterion: z.string(), type: z.string().min(1), reference: z.string().nullable().optional(), content: z.string().nullable().optional(), url: z.string().url().nullable().optional(), ...actorShape },
    },
    (input) => guard(() => {
      const evidence = workspace.executions.addEvidence(input.task, input.criterion, { type: input.type, ...(input.reference !== undefined ? { reference: input.reference } : {}), ...(input.content !== undefined ? { content: input.content } : {}), ...(input.url !== undefined ? { url: input.url } : {}), ...meta(input) });
      return `Evidence ${evidence.id} attached.`;
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
      guard(() => {
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
      guard(() => {
        if (input.force && !input.reason) {
          throw new AgentContinuityError(
            "VALIDATION_ERROR",
            "A reason is required when forcing completion.",
          );
        }
        const task = workspace.tasks.complete(input.task, {
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
