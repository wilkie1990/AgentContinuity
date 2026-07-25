import type { TaskStatus } from "@agent-workspace/contracts";

export const BOARD_COLUMNS: { status: TaskStatus; label: string }[] = [
  { status: "backlog", label: "Backlog" },
  { status: "ready", label: "Ready" },
  { status: "in_progress", label: "In Progress" },
  { status: "blocked", label: "Blocked" },
  { status: "review", label: "Review" },
  { status: "done", label: "Done" },
];

export function statusLabel(status: string): string {
  return BOARD_COLUMNS.find((column) => column.status === status)?.label ?? status;
}

export function formatPercent(value: number | null): string {
  return value === null ? "—" : `${Math.round(value * 100)}%`;
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export function formatRelative(iso: string | null): string {
  if (!iso) return "no activity yet";
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

const EVENT_SENTENCES: Record<string, string> = {
  "project.created": "created the project",
  "project.updated": "updated the project",
  "project.context_updated": "updated project context",
  "project.archived": "archived the project",
  "task.created": "created",
  "task.updated": "updated",
  "task.context_updated": "updated task context on",
  "task.status_changed": "moved",
  "task.completed": "completed",
  "task.reopened": "reopened",
  "task.claimed": "claimed",
  "task.claim_renewed": "renewed the claim on",
  "task.claim_released": "released the claim on",
  "task.claim_expired": "let the claim lapse on",
  "task.progress_added": "added progress to",
  "task.blocked": "blocked",
  "task.blocker_resolved": "resolved a blocker on",
  "acceptance_criterion.created": "added an acceptance criterion to",
  "acceptance_criterion.completed": "completed an acceptance criterion on",
  "acceptance_criterion.reopened": "reopened an acceptance criterion on",
  "dependency.added": "added a dependency to",
  "dependency.removed": "removed a dependency from",
  "decision.recorded": "recorded a decision",
  "decision.superseded": "superseded a decision",
  "link.added": "added a link",
  "link.removed": "removed a link",
};

export function describeEvent(eventType: string): string {
  return EVENT_SENTENCES[eventType] ?? eventType;
}

/** Human readable second line for an activity entry, derived from its payload. */
export function eventDetail(eventType: string, payload: Record<string, unknown>): string | null {
  const value = (key: string): string | null => {
    const entry = payload[key];
    return typeof entry === "string" ? entry : null;
  };

  switch (eventType) {
    case "task.status_changed":
      return `${statusLabel(String(payload.from))} → ${statusLabel(String(payload.to))}`;
    case "task.progress_added":
      return value("excerpt");
    case "task.blocked":
      return value("description");
    case "task.blocker_resolved":
      return value("resolution");
    case "decision.recorded":
    case "decision.superseded":
      return value("title") ?? value("decisionKey");
    case "acceptance_criterion.created":
    case "acceptance_criterion.completed":
    case "acceptance_criterion.reopened":
      return value("description");
    case "link.added":
    case "link.removed":
      return [value("type"), value("provider"), value("reference")].filter(Boolean).join(" ") || null;
    case "dependency.added":
    case "dependency.removed":
      return value("dependsOn");
    case "project.context_updated":
    case "task.context_updated":
      return `${payload.previousLength ?? 0} → ${payload.newLength ?? 0} characters`;
    case "task.completed":
      return payload.forced === true ? `forced: ${value("reason") ?? "no reason given"}` : null;
    default:
      return null;
  }
}
