import type { TaskStatus, TaskSummary } from "@agent-continuity/contracts";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useExecutionState } from "../api.js";
import { BOARD_COLUMNS, formatRelative } from "../format.js";
import { CheckpointSummary, ExecutionHealthBadge } from "./ExecutionStatus.js";

function ExecutionCardMeta({ task }: { task: TaskSummary }) {
  const executionState = useExecutionState(task.key);
  const execution = task.execution;
  if (!execution) return null;

  return (
    <div className="execution-card-meta small" aria-label={`Execution by ${execution.actor}`}>
      <div className="row" style={{ gap: 6 }}>
        <ExecutionHealthBadge execution={execution} />
        <span className="execution-actor">{execution.actor}</span>
        {execution.currentPhase && <span className="execution-phase">{execution.currentPhase}</span>}
        <span className="muted">updated {formatRelative(execution.lastHeartbeatAt)}</span>
      </div>
      <div className="execution-checkpoint">
        <span className="checkpoint-label">Now</span>
        <CheckpointSummary checkpoint={executionState.data?.checkpoints[0]} />
      </div>
    </div>
  );
}

export function TaskCardBody({ task }: { task: TaskSummary }) {
  // A ready task that cannot actually be started is called out, per the board rules.
  const stalled = task.status === "ready" && !task.isActionable;

  return (
    <>
      <div className="spread">
        <span className="key">{task.key}</span>
        <div className="row" style={{ gap: 4 }}>
          {task.priority !== "normal" && (
            <span className={`badge priority-${task.priority}`}>{task.priority.toUpperCase()}</span>
          )}
          {task.isActionable && <span className="badge actionable">actionable</span>}
        </div>
      </div>
      <span className="title">{task.title}</span>
      <div className="row small muted" style={{ gap: 6 }}>
        {task.acceptanceCriteriaTotal > 0 && (
          <span>
            {task.acceptanceCriteriaCompleted}/{task.acceptanceCriteriaTotal} acceptance criteria
          </span>
        )}
        {task.claim && !task.execution && <span className="badge claim">Claimed: {task.claim.actor}</span>}
        {task.activeBlockerCount > 0 && (
          <span className="badge blocker">
            {task.activeBlockerCount} blocker{task.activeBlockerCount === 1 ? "" : "s"}
          </span>
        )}
        {task.dependencyCount > 0 && (
          <span className="badge dep-count" title="Dependencies">
            ⇢ {task.dependencyCount}
          </span>
        )}
        {task.linkCount > 0 && (
          <span className="badge link-count" title="Links">
            ⧉ {task.linkCount}
          </span>
        )}
        {stalled && <span className="badge priority-high">waiting</span>}
      </div>
      {task.execution && <ExecutionCardMeta task={task} />}
    </>
  );
}

export function TaskCard({
  task,
  onOpen,
  onStatusChange,
  disabled,
}: {
  task: TaskSummary;
  onOpen: (key: string) => void;
  onStatusChange: (task: TaskSummary, status: TaskStatus) => void;
  disabled?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.key,
    data: { status: task.status, sortOrder: task.sortOrder },
  });

  const stalled = task.status === "ready" && !task.isActionable;

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`task-card${isDragging ? " dragging" : ""}${stalled ? " stalled" : ""}`}
      {...attributes}
      {...listeners}
      role="button"
      tabIndex={0}
      aria-label={`${task.key} ${task.title}`}
      onClick={() => onOpen(task.key)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen(task.key);
        }
      }}
    >
      <TaskCardBody task={task} />
      {/* Below 1024px (styles/board.css) dragging is not the only way to change
          status: this select fires the same onMove path a drop would. Stopping
          propagation keeps dnd-kit's pointer listeners and the card's own
          onClick (which opens the drawer) from intercepting the interaction. */}
      <select
        className="move-select"
        aria-label={`Move ${task.key} to a different status`}
        value={task.status}
        disabled={disabled}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
        onChange={(event) => onStatusChange(task, event.target.value as TaskStatus)}
      >
        {BOARD_COLUMNS.map((column) => (
          <option key={column.status} value={column.status}>
            {column.label}
          </option>
        ))}
      </select>
    </div>
  );
}
