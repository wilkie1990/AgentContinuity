import type {
  AcceptanceCriterion,
  ActivityEvent,
  Blocker,
  ContextSize,
  ContextVersionDetail,
  ContextVersionPage,
  ContextVersionSummary,
  Decision,
  Link,
  ProgressEntry,
  ProjectDetail,
  ProjectRepository,
  ProjectSummary,
  SearchResponse,
  TaskClaim,
  TaskCheckpoint,
  TaskExecution,
  ExecutionWorktree,
  GitProvenanceState,
  ExecutionPathOwnership,
  PathCollisionWarning,
  WorkPlanItem,
  NeedsAttentionItem,
  TaskDetail,
  TaskSummary,
} from "@agent-continuity/contracts";

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

export function renderContextSize(size: ContextSize): string {
  return `${size.characters} characters, ${size.bytes} UTF-8 bytes${
    size.overSoftLimit ? " — WARNING: above the 32 KiB soft limit" : ""
  }`;
}

export function renderContextVersionLine(version: ContextVersionSummary): string {
  return [
    `v${version.version}${version.isCurrent ? " (current)" : ""} — ${version.createdAt}`,
    `  ${renderContextSize(version.size)}`,
    `  ${version.actor ?? "unknown"}${version.sessionId ? ` (session ${version.sessionId})` : ""}${
      version.reason ? ` — ${version.reason}` : ""
    }`,
    version.revertedFromVersion ? `  reverted from v${version.revertedFromVersion}` : null,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

export function renderContextHistory(page: ContextVersionPage): string {
  if (page.versions.length === 0) return "No context versions recorded.";
  return [
    page.versions.map(renderContextVersionLine).join("\n\n"),
    page.nextBeforeVersion
      ? `More versions are available before v${page.nextBeforeVersion}.`
      : null,
  ]
    .filter((line): line is string => line !== null)
    .join("\n\n");
}

export function renderContextVersion(version: ContextVersionDetail): string {
  return `${renderContextVersionLine(version)}\n\n${version.content ?? "(no context recorded)"}`;
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

export function renderExecution(execution: TaskExecution | null): string[] {
  if (!execution) return [];
  return [
    `${execution.actor}${execution.sessionId ? ` (session ${execution.sessionId})` : ""} — ${execution.health}`,
    execution.currentPhase ? `phase: ${execution.currentPhase}` : null,
    execution.worktree
      ? `worktree: ${execution.worktree.repositoryKey}${
          execution.worktree.branch ? ` (${execution.worktree.branch})` : ""
        } — ${execution.worktree.availability.status}`
      : "worktree: unbound",
    `last heartbeat: ${execution.lastHeartbeatAt}`,
    execution.terminationReason ? `ended: ${execution.terminationReason}` : null,
  ].filter((line): line is string => line !== null);
}

export function renderRepository(repository: ProjectRepository): string {
  return [
    `${repository.key} — ${repository.label}${repository.primary ? " (primary)" : ""}`,
    `Path: ${repository.rootPath}`,
    `Availability: ${repository.availability.status}${
      repository.availability.message ? ` — ${repository.availability.message}` : ""
    }`,
    repository.remoteUrl ? `Remote: ${repository.remoteUrl}` : null,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

export function renderWorktree(worktree: ExecutionWorktree): string {
  return [
    `${worktree.repositoryKey} — ${worktree.repositoryLabel}`,
    `Worktree: ${worktree.worktreePath}`,
    `Repository-relative: ${worktree.relativePath ?? "external linked worktree"}`,
    `Branch: ${worktree.branch ?? "not recorded"}`,
    `Availability: ${worktree.availability.status}${
      worktree.availability.message ? ` — ${worktree.availability.message}` : ""
    }`,
  ].join("\n");
}

export function renderGitProvenance(provenance: GitProvenanceState | null): string {
  if (!provenance) return "Git provenance: none";
  const { baseline, snapshots } = provenance;
  const latest = snapshots.at(-1);
  return [
    `Git baseline: ${baseline.status}${
      baseline.status === "ok"
        ? ` — ${baseline.branch ?? "detached"} @ ${baseline.headSha ?? "unborn"}; ${baseline.dirty ? "dirty" : "clean"}`
        : ` — ${baseline.error?.code}: ${baseline.error?.message}`
    }`,
    `Source: ${baseline.source}; repository: ${baseline.repositoryKey}`,
    `Snapshots: ${snapshots.length}`,
    latest
      ? `Latest: ${latest.trigger} — ${latest.status}${
          latest.status === "ok"
            ? `; ${latest.headSha ?? "unborn"}; ${latest.filesChanged} paths; +${latest.additions}/-${latest.deletions}`
            : `; ${latest.error?.code}: ${latest.error?.message}`
        }`
      : null,
    latest?.touchedPaths.length
      ? `Touched paths: ${latest.touchedPaths
          .slice(0, 50)
          .map((path) =>
            path.previousPath
              ? `${path.change} ${path.previousPath} -> ${path.path}`
              : `${path.change} ${path.path}`,
          )
          .join(", ")}${latest.touchedPaths.length > 50 ? `, … ${latest.touchedPaths.length - 50} more` : ""}`
      : null,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

export function renderPathOwnership(
  ownership: ExecutionPathOwnership | null,
  collisions: PathCollisionWarning[],
): string {
  const declared = ownership?.paths.map((entry) => `${entry.kind}: ${entry.path}`) ?? [];
  const warnings = collisions.map((collision) => {
    const overlap = collision.overlaps[0];
    return `${collision.strength} — ${collision.counterpart.taskKey} (${collision.worktreeRelation})${
      overlap
        ? `: ${overlap.taskPath} [${overlap.taskSource}] ↔ ${overlap.counterpartPath} [${overlap.counterpartSource}]`
        : ""
    }`;
  });
  return [
    `Path ownership revision: ${ownership ? ownership.version : "none"}`,
    section("Declared paths", declared),
    section("Live collision advisories", warnings),
  ].join("\n");
}

export function renderSearchResults(response: SearchResponse): string {
  if (response.results.length === 0) return `No results for "${response.query}".`;
  return response.results
    .map((result) => {
      const scope = result.taskKey
        ? `${result.projectKey}/${result.taskKey}`
        : result.projectKey;
      return [
        `${result.sourceType} — ${result.sourceKey} (${scope})`,
        `  ${result.title}`,
        result.snippet ? `  ${result.snippet}` : null,
        `  relevance: ${result.score.toFixed(6)}`,
      ]
        .filter((line): line is string => line !== null)
        .join("\n");
    })
    .join("\n\n");
}

export function renderCheckpoints(checkpoints: TaskCheckpoint[]): string[] {
  return checkpoints.map((checkpoint) =>
    `${checkpoint.createdAt} — completed: ${checkpoint.completed}; working on: ${checkpoint.workingOn}; next: ${checkpoint.next}${checkpoint.uncertainty ? `; uncertainty: ${checkpoint.uncertainty}` : ""}`,
  );
}

export function renderWorkPlan(items: WorkPlanItem[]): string[] {
  return items.map((item) => `[${item.status}] ${item.title}`);
}

export function renderAttention(items: NeedsAttentionItem[]): string {
  return items.length === 0
    ? "No work needs attention."
    : items.map((item) => `${item.taskKey} — ${item.reason}: ${item.requiredAction}`).join("\n");
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
    `Project context state: v${project.contextVersion}, ${renderContextSize(project.contextSize)}`,
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
    `Context state: v${task.contextVersion}, ${renderContextSize(task.contextSize)}`,
    section("Description", task.description ? [task.description] : []),
    section("Context", task.context ? [task.context] : []),
    section("Acceptance criteria", renderCriteria(task.acceptanceCriteria)),
    section("Active claim", renderClaim(task.claim)),
    section("Execution", renderExecution(task.execution)),
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
