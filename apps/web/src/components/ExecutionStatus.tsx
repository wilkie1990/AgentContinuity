import type { ExecutionHealth, TaskCheckpoint, TaskExecution } from "@agent-continuity/contracts";
import { formatRelative } from "../format.js";

const HEALTH_LABELS: Record<ExecutionHealth, string> = {
  active: "Active",
  idle: "Idle",
  stale: "Stale",
  disconnected: "Disconnected",
  finished: "Finished",
};

export function executionHealthLabel(health: ExecutionHealth): string {
  return HEALTH_LABELS[health];
}

/** A compact, text-labelled state indicator. Colour is supporting information only. */
export function ExecutionHealthBadge({ execution }: { execution: TaskExecution }) {
  const label = executionHealthLabel(execution.health);
  return (
    <span
      className={`badge execution-health execution-${execution.health}`}
      title={`Execution is ${label.toLowerCase()}; updated ${formatRelative(execution.lastHeartbeatAt)}`}
    >
      <span aria-hidden="true" className="execution-dot" />
      {label}
    </span>
  );
}

export function CheckpointSummary({ checkpoint }: { checkpoint: TaskCheckpoint | undefined }) {
  if (!checkpoint) return <span className="muted">No checkpoint yet</span>;

  return (
    <span className="checkpoint-summary" title={checkpoint.workingOn}>
      {checkpoint.workingOn}
    </span>
  );
}
