import type { TaskStatus, TaskSummary } from "@agent-workspace/contracts";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useState, type FormEvent } from "react";
import { BOARD_COLUMNS } from "../format.js";
import { TaskCard, TaskCardBody } from "./TaskCard.js";

const COLUMN_PREFIX = "column:";

export type BoardMove = { task: string; status: TaskStatus; sortOrder: number };

function Column({
  status,
  label,
  tasks,
  onOpen,
  onCreate,
  disabled,
}: {
  status: TaskStatus;
  label: string;
  tasks: TaskSummary[];
  onOpen: (key: string) => void;
  onCreate: (status: TaskStatus, title: string) => void;
  disabled: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `${COLUMN_PREFIX}${status}`, data: { status } });
  const [composing, setComposing] = useState(false);
  const [title, setTitle] = useState("");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    onCreate(status, title.trim());
    setTitle("");
    setComposing(false);
  };

  return (
    <div ref={setNodeRef} className={`column${isOver ? " over" : ""}`} data-status={status}>
      <header>
        <h4>
          {label} <span className="muted">{tasks.length}</span>
        </h4>
        {!disabled && (
          <button
            className="subtle"
            aria-label={`Add task to ${label}`}
            onClick={() => setComposing((value) => !value)}
          >
            +
          </button>
        )}
      </header>

      {composing && (
        <form onSubmit={submit}>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Task title"
            aria-label={`New task in ${label}`}
            autoFocus
            onBlur={() => !title && setComposing(false)}
          />
        </form>
      )}

      <SortableContext items={tasks.map((task) => task.key)} strategy={verticalListSortingStrategy}>
        {tasks.map((task) => (
          <TaskCard key={task.id} task={task} onOpen={onOpen} />
        ))}
      </SortableContext>
    </div>
  );
}

/**
 * Kanban board. Dragging between columns changes task status; dragging inside a column
 * changes sort order. Both are persisted through the API by the caller.
 */
export function Board({
  tasks,
  onOpen,
  onMove,
  onCreate,
  readOnly = false,
}: {
  tasks: TaskSummary[];
  onOpen: (key: string) => void;
  onMove: (move: BoardMove) => void;
  onCreate: (status: TaskStatus, title: string) => void;
  readOnly?: boolean;
}) {
  const [dragging, setDragging] = useState<TaskSummary | null>(null);
  const sensors = useSensors(
    // A small activation distance keeps a plain click available for opening the drawer.
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const byStatus = (status: TaskStatus) =>
    tasks
      .filter((task) => task.status === status)
      .sort((left, right) => left.sortOrder - right.sortOrder);

  const handleDragStart = (event: DragStartEvent) => {
    setDragging(tasks.find((task) => task.key === event.active.id) ?? null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setDragging(null);
    const { active, over } = event;
    if (!over) return;

    const task = tasks.find((candidate) => candidate.key === active.id);
    if (!task) return;

    const overId = String(over.id);
    const targetStatus = overId.startsWith(COLUMN_PREFIX)
      ? (overId.slice(COLUMN_PREFIX.length) as TaskStatus)
      : ((over.data.current?.status as TaskStatus | undefined) ?? task.status);

    const siblings = byStatus(targetStatus).filter((candidate) => candidate.key !== task.key);
    const overIndex = overId.startsWith(COLUMN_PREFIX)
      ? siblings.length
      : siblings.findIndex((candidate) => candidate.key === overId);

    const index = overIndex < 0 ? siblings.length : overIndex;
    const before = siblings[index - 1];
    const after = siblings[index];

    // Midpoint insertion keeps every other card's sort order untouched.
    const sortOrder = before && after
      ? (before.sortOrder + after.sortOrder) / 2
      : before
        ? before.sortOrder + 1000
        : after
          ? after.sortOrder - 1000
          : 1000;

    if (targetStatus === task.status && sortOrder === task.sortOrder) return;
    onMove({ task: task.key, status: targetStatus, sortOrder });
  };

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="board">
        {BOARD_COLUMNS.map((column) => (
          <Column
            key={column.status}
            status={column.status}
            label={column.label}
            tasks={byStatus(column.status)}
            onOpen={onOpen}
            onCreate={onCreate}
            disabled={readOnly}
          />
        ))}
      </div>
      <DragOverlay>
        {dragging && (
          <div className="task-card">
            <TaskCardBody task={dragging} />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
