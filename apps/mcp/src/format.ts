import type {
  AcceptanceCriterion,
  ActivityEvent,
  Blocker,
  Decision,
  Link,
  ProgressEntry,
  ProjectDetail,
  ProjectSummary,
  TaskClaim,
  TaskDetail,
  TaskSummary,
} from "@agent-workspace/contracts";

const STATUS_LABELS: Record<string, string> = {
  backlog: "Backlog",
  ready: "Ready",
  in_progress: "In Progress",
  blocked: "Blocked",
  review: "Review",
  done: "Done",
};

export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

function percent(value: number | null): string {
  return value === null ? "n/a" : `${Math.round(value * 100)}%`;
}

function section(title: string, body: string | string[]): string {
  const lines = Array.isArray(body) ? body : [body];
  return `${title}:\n${lines.length > 0 ? lines.join("\n") : "None"}`;
}

function relative(expiresInMinutes: number): string {
  if (expiresInMinutes <= 0) return "expired";
  if (expiresInMinutes === 1) return "expires in: 1 minute";
  return `expires in: ${expiresInMinutes} minutes`;
}

export function renderClaim(claim: TaskClaim | null): string[] {
  if (!claim) return [];
  return [
    claim.actor,
    ...(claim.sessionId ? [`session: ${claim.sessionId}`] : []),
    relative(claim.expiresInMinutes),
  ];
}

export function renderCriteria(criteria: AcceptanceCriterion[]): string[] {
  return criteria.map(
    (criterion) => `[${criterion.isComplete ? "✓" : " "}] ${criterion.description}`,
  );
}

export function renderProjectLine(project: ProjectSummary): string {
  const counts = project.taskCounts;
  return [
    `${project.key} — ${project.name}`,
    `  Status: ${project.status}  Progress: ${percent(project.progress)} (${counts.done}/${project.taskTotal} tasks)`,
    `  Active: ${counts.inProgress} in progress, ${counts.ready} ready, ${counts.blocked} blocked`,
    project.objective ? `  Objective: ${project.objective}` : null,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

export function renderProjectList(projects: ProjectSummary[]): string {
  if (projects.length === 0) {
    return "No projects match. Use projects_bootstrap to turn the current work into a project.";
  }
  return projects.map(renderProjectLine).join("\n\n");
}

export function renderProjectDetail(project: ProjectDetail): string {
  const counts = project.taskCounts;
  return [
    `${project.key} — ${project.name}`,
    `Status: ${project.status}`,
    project.objective ? `Objective: ${project.objective}` : null,
    project.description ? `Description:\n${project.description}` : null,
    `Progress: ${percent(project.progress)} (${counts.done}/${project.taskTotal} tasks)`,
    `Task counts: backlog ${counts.backlog}, ready ${counts.ready}, in progress ${counts.inProgress}, blocked ${counts.blocked}, review ${counts.review}, done ${counts.done}`,
    section("Project context", project.context ? [project.context] : []),
    section(
      "Recent decisions",
      project.decisions.slice(0, 10).map((decision) => `${decision.key} — ${decision.title}`),
    ),
    section("Links", project.links.map(renderLinkLine)),
    section(
      "Recent activity",
      project.recentActivity.slice(0, 10).map(renderActivityLine),
    ),
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

export function renderTaskLine(task: TaskSummary): string {
  const flags = [
    task.priority !== "normal" ? task.priority.toUpperCase() : null,
    task.acceptanceCriteriaTotal > 0
      ? `${task.acceptanceCriteriaCompleted}/${task.acceptanceCriteriaTotal} criteria`
      : null,
    task.claim ? `claimed by ${task.claim.actor}` : null,
    task.activeBlockerCount > 0 ? `${task.activeBlockerCount} blocker(s)` : null,
    task.dependencyCount > 0 && !task.dependenciesComplete ? "waiting on dependencies" : null,
    task.isActionable ? "actionable" : null,
  ].filter((flag): flag is string => flag !== null);

  return `${task.key} — ${task.title} [${statusLabel(task.status)}]${
    flags.length > 0 ? ` (${flags.join(", ")})` : ""
  }`;
}

export function renderTaskList(tasks: TaskSummary[]): string {
  if (tasks.length === 0) return "No tasks match this query.";
  return tasks.map(renderTaskLine).join("\n");
}

function renderProgressLine(entry: ProgressEntry): string {
  return `- ${entry.content}${entry.actor ? ` (${entry.actor})` : ""}`;
}

function renderBlockerLine(blocker: Blocker): string {
  return [
    `${blocker.key} — ${blocker.description}`,
    blocker.requiredAction ? `  Required action: ${blocker.requiredAction}` : null,
    blocker.resolution ? `  Resolution: ${blocker.resolution}` : null,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

export function renderLinkLine(link: Link): string {
  const parts = [link.provider, link.reference, link.url].filter(Boolean);
  return `${link.key} — ${link.type}${parts.length > 0 ? `: ${parts.join(" ")}` : ""}${
    link.taskKey ? ` (${link.taskKey})` : ""
  }`;
}

export function renderDecisionLine(decision: Decision): string {
  return [
    `${decision.key} — ${decision.title}${decision.supersededAt ? " (superseded)" : ""}`,
    `  Decision: ${decision.decision}`,
    decision.rationale ? `  Rationale: ${decision.rationale}` : null,
    decision.taskKey ? `  Scope: ${decision.taskKey}` : "  Scope: project",
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

export function renderActivityLine(event: ActivityEvent): string {
  const who = event.actor ?? "system";
  const where = event.taskKey ? ` ${event.taskKey}` : "";
  return `${event.createdAt} ${who} ${event.eventType}${where}`;
}

/** Tells the agent what the structured state implies it should do next. */
export function recommendedState(task: TaskDetail): string {
  if (task.status === "done") return "Task is complete. Choose another task.";
  if (task.activeBlockers.length > 0) {
    return "Task is blocked. Resolve the blocker or work on a different task.";
  }
  if (task.claim) return "Continue current task.";
  if (task.isActionable) return "Claim this task before beginning meaningful work.";
  if (!task.dependenciesComplete) return "Dependencies are incomplete. Prefer an actionable task.";
  if (task.status === "backlog") {
    return "Task is still in the backlog. Move it to ready before starting.";
  }
  return "Claim this task before beginning meaningful work.";
}

export function renderTaskDetail(task: TaskDetail): string {
  return [
    `${task.key} — ${task.title}`,
    `Project: ${task.project.key} — ${task.project.name}`,
    `Status: ${task.status}`,
    `Priority: ${task.priority}`,
    `Actionable: ${task.isActionable ? "yes" : "no"}`,
    section("Description", task.description ? [task.description] : []),
    section("Context", task.context ? [task.context] : []),
    section("Acceptance criteria", renderCriteria(task.acceptanceCriteria)),
    section("Active claim", renderClaim(task.claim)),
    section("Progress", task.progress.map(renderProgressLine)),
    section("Active blockers", task.activeBlockers.map(renderBlockerLine)),
    section(
      "Dependencies",
      task.dependencies.map((dependency) => `${dependency.key} — ${statusLabel(dependency.status)}`),
    ),
    section(
      "Dependents",
      task.dependents.map((dependent) => `${dependent.key} — ${statusLabel(dependent.status)}`),
    ),
    section(
      "Decisions",
      task.decisions.map((decision) => `${decision.key} — ${decision.title}`),
    ),
    section("Links", task.links.map(renderLinkLine)),
    section("Recommended state", [recommendedState(task)]),
  ].join("\n");
}
