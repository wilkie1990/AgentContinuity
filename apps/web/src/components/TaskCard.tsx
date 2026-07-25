import type { TaskSummary } from "@agent-workspace/contracts";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

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
        {task.claim && <span className="badge claim">Claimed: {task.claim.actor}</span>}
        {task.activeBlockerCount > 0 && (
          <span className="badge blocker">
            {task.activeBlockerCount} blocker{task.activeBlockerCount === 1 ? "" : "s"}
          </span>
        )}
        {task.dependencyCount > 0 && (
          <span className="badge" title="Dependencies">
            ⇢ {task.dependencyCount}
          </span>
        )}
        {task.linkCount > 0 && (
          <span className="badge" title="Links">
            ⧉ {task.linkCount}
          </span>
        )}
        {stalled && <span className="badge priority-high">waiting</span>}
      </div>
    </>
  );
}

export function TaskCard({ task, onOpen }: { task: TaskSummary; onOpen: (key: string) => void }) {
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
    </div>
  );
}
