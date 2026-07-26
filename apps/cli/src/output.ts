import type {
  ActivityEvent,
  Decision,
  Link,
  ProgressEntry,
  ProjectSummary,
  TaskDetail,
  TaskSummary,
} from "@agent-continuity/contracts";

export function print(value: string): void {
  process.stdout.write(`${value}\n`);
}

/** `--json` on every read command gives terminal-capable agents a machine-readable fallback. */
export function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function percent(value: number | null): string {
  return value === null ? "  n/a" : `${String(Math.round(value * 100)).padStart(3, " ")}%`;
}

export function projectLine(project: ProjectSummary): string {
  return [
    `${project.key}  ${percent(project.progress)}  ${project.name}`,
    project.objective ? `        ${project.objective}` : null,
    `        ${project.taskCounts.inProgress} in progress · ${project.taskCounts.ready} ready · ${project.taskCounts.blocked} blocked · ${project.taskCounts.done}/${project.taskTotal} done`,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

export function projectDetail(project: ProjectSummary): string {
  return [
    `${project.key}  ${project.name}`,
    project.objective ? `Objective:   ${project.objective}` : null,
    `Status:      ${project.status}`,
    `Progress:    ${percent(project.progress).trim()} (${project.taskCounts.done}/${project.taskTotal} tasks)`,
    `Tasks:       backlog ${project.taskCounts.backlog} · ready ${project.taskCounts.ready} · in progress ${project.taskCounts.inProgress} · blocked ${project.taskCounts.blocked} · review ${project.taskCounts.review} · done ${project.taskCounts.done}`,
    project.lastActivityAt ? `Last active: ${project.lastActivityAt}` : null,
    project.description ? `\n${project.description}` : null,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

export function taskLine(task: TaskSummary): string {
  const flags = [
    task.priority !== "normal" ? task.priority : null,
    task.acceptanceCriteriaTotal > 0
      ? `${task.acceptanceCriteriaCompleted}/${task.acceptanceCriteriaTotal} criteria`
      : null,
    task.claim ? `claimed by ${task.claim.actor}` : null,
    task.activeBlockerCount > 0 ? `${task.activeBlockerCount} blocker(s)` : null,
    task.isActionable ? "actionable" : null,
  ].filter((flag): flag is string => flag !== null);

  return `${task.key.padEnd(10)} ${task.status.padEnd(12)} ${task.title}${
    flags.length > 0 ? `  (${flags.join(", ")})` : ""
  }`;
}

function block(title: string, lines: string[]): string {
  return `\n${title}\n${lines.length > 0 ? lines.map((line) => `  ${line}`).join("\n") : "  none"}`;
}

export function taskDetail(task: TaskDetail): string {
  return [
    `${task.key}  ${task.title}`,
    `Project:     ${task.project.key} — ${task.project.name}`,
    `Status:      ${task.status}`,
    `Priority:    ${task.priority}`,
    `Actionable:  ${task.isActionable ? "yes" : "no"}`,
    task.description ? `\nDescription\n  ${task.description}` : null,
    task.context ? `\nContext\n  ${task.context}` : null,
    block(
      "Acceptance criteria",
      task.acceptanceCriteria.map(
        (criterion) => `[${criterion.isComplete ? "x" : " "}] ${criterion.description}`,
      ),
    ),
    block(
      "Claim",
      task.claim
        ? [
            `${task.claim.actor}${task.claim.sessionId ? ` (session ${task.claim.sessionId})` : ""} — expires in ${task.claim.expiresInMinutes} minutes`,
          ]
        : [],
    ),
    block(
      "Dependencies",
      task.dependencies.map((dependency) => `${dependency.key} — ${dependency.status}`),
    ),
    block("Progress", task.progress.map(progressLine)),
    block(
      "Active blockers",
      task.activeBlockers.map(
        (blocker) =>
          `${blocker.key} — ${blocker.description}${blocker.requiredAction ? ` (required: ${blocker.requiredAction})` : ""}`,
      ),
    ),
    block("Decisions", task.decisions.map((decision) => `${decision.key} — ${decision.title}`)),
    block("Links", task.links.map(linkLine)),
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

export function progressLine(entry: ProgressEntry): string {
  return `${entry.createdAt}  ${entry.actor ?? "unknown"}: ${entry.content}`;
}

export function decisionBlock(decision: Decision): string {
  return [
    `${decision.key}  ${decision.title}${decision.supersededAt ? "  (superseded)" : ""}`,
    `  Decision:  ${decision.decision}`,
    decision.rationale ? `  Rationale: ${decision.rationale}` : null,
    `  Scope:     ${decision.taskKey ?? "project"}`,
    `  Recorded:  ${decision.createdAt}${decision.createdBy ? ` by ${decision.createdBy}` : ""}`,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

export function linkLine(link: Link): string {
  const parts = [link.provider, link.reference, link.url].filter(Boolean);
  return `${link.key}  ${link.type}${parts.length > 0 ? `  ${parts.join("  ")}` : ""}${
    link.taskKey ? `  (${link.taskKey})` : ""
  }`;
}

export function activityLine(event: ActivityEvent): string {
  const who = event.actor ?? "system";
  const detail = Object.keys(event.payload).length > 0 ? `  ${JSON.stringify(event.payload)}` : "";
  return `${event.createdAt}  ${who.padEnd(14)} ${event.eventType.padEnd(30)} ${
    event.taskKey ?? ""
  }${detail}`;
}
