import type { TaskStatus, TaskSummary } from "@agent-continuity/contracts";
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
import { useEffect, useState, type FormEvent } from "react";
import { BOARD_COLUMNS } from "../format.js";
import { TaskCard, TaskCardBody } from "./TaskCard.js";

const COLUMN_PREFIX = "column:";

// Mirrors the desktop breakpoint documented in styles/base.css (1024px) and
// the same matchMedia pattern Sidebar.tsx uses (DEC-0006), so the board's
// idea of "desktop" tracks the CSS without a reload when the window resizes.
const DESKTOP_QUERY = "(min-width: 1024px)";

function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== "undefined" && window.matchMedia(DESKTOP_QUERY).matches,
  );

  useEffect(() => {
    const mql = window.matchMedia(DESKTOP_QUERY);
    const onChange = () => setIsDesktop(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return isDesktop;
}

export type BoardMove = { task: string; status: TaskStatus; sortOrder: number };

function Column({
  status,
  label,
  tasks,
  onOpen,
  onCreate,
  onStatusChange,
  disabled,
}: {
  status: TaskStatus;
  label: string;
  tasks: TaskSummary[];
  onOpen: (key: string) => void;
  onCreate: (status: TaskStatus, title: string) => void;
  onStatusChange: (task: TaskSummary, status: TaskStatus) => void;
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
          <TaskCard
            key={task.id}
            task={task}
            onOpen={onOpen}
            onStatusChange={onStatusChange}
            disabled={disabled}
          />
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
  // Below 1024px only one status is shown at a time (DEC-0009); this tracks which.
  const [activeStatus, setActiveStatus] = useState<TaskStatus>(BOARD_COLUMNS[0].status);
  const isDesktop = useIsDesktop();
  const sensors = useSensors(
    // A small activation distance keeps a plain click available for opening the drawer.
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const byStatus = (status: TaskStatus) =>
    tasks
      .filter((task) => task.status === status)
      .sort((left, right) => left.sortOrder - right.sortOrder);

  const visibleColumns = isDesktop
    ? BOARD_COLUMNS
    : BOARD_COLUMNS.filter((column) => column.status === activeStatus);

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

  // Used by the per-card "move to" select (DEC-0009), the non-drag path for
  // touch. Appends to the end of the target column, matching what dropping a
  // card directly on a column (rather than on a specific card) already does.
  const handleStatusChange = (task: TaskSummary, status: TaskStatus) => {
    if (status === task.status) return;
    const siblings = byStatus(status);
    const last = siblings[siblings.length - 1];
    const sortOrder = last ? last.sortOrder + 1000 : 1000;
    onMove({ task: task.key, status, sortOrder });
  };

  return (
    <div className="board-wrap">
      <nav className="board-tabs" aria-label="Board status">
        {BOARD_COLUMNS.map((column) => (
          <button
            key={column.status}
            type="button"
            className={`board-tab${column.status === activeStatus ? " active" : ""}`}
            aria-current={column.status === activeStatus ? "true" : undefined}
            onClick={() => setActiveStatus(column.status)}
          >
            {column.label} <span className="muted">{byStatus(column.status).length}</span>
          </button>
        ))}
      </nav>
      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="board">
          {visibleColumns.map((column) => (
            <Column
              key={column.status}
              status={column.status}
              label={column.label}
              tasks={byStatus(column.status)}
              onOpen={onOpen}
              onCreate={onCreate}
              onStatusChange={handleStatusChange}
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
    </div>
  );
}
