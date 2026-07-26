import type { TaskStatus } from "@agent-continuity/contracts";
import { useParams, useSearchParams } from "react-router-dom";
import { client, useProject, useTasks, useWorkspaceMutation } from "../api.js";
import { Board, type BoardMove } from "../components/Board.js";
import { ProjectHeader } from "../components/ProjectHeader.js";
import { TaskDrawer } from "../components/TaskDrawer.js";
import { ErrorNote, Loading, UI_ACTOR } from "../components/common.js";

export function BoardPage() {
  const { project: ref } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const openTask = searchParams.get("task");

  const projectQuery = useProject(ref);
  const tasksQuery = useTasks(ref);

  const move = useWorkspaceMutation(ref, (input: BoardMove) =>
    client.tasks.update(input.task, {
      status: input.status,
      sortOrder: input.sortOrder,
      actor: UI_ACTOR,
    }),
  );

  const create = useWorkspaceMutation(ref, (input: { status: TaskStatus; title: string }) =>
    client.tasks.create(ref as string, {
      title: input.title,
      status: input.status,
      actor: UI_ACTOR,
    }),
  );

  const openDrawer = (key: string) => setSearchParams({ task: key });
  const closeDrawer = () => setSearchParams({});

  if (projectQuery.isLoading) return <Loading />;
  if (projectQuery.error) return <ErrorNote error={projectQuery.error} />;
  if (!projectQuery.data) return null;

  const archived = projectQuery.data.status === "archived";

  return (
    <>
      <ProjectHeader project={projectQuery.data} />
      <div style={{ padding: "0 24px" }}>
        <ErrorNote error={move.error ?? create.error ?? tasksQuery.error} />
      </div>
      <Board
        tasks={tasksQuery.data ?? []}
        onOpen={openDrawer}
        onMove={(input) => move.mutate(input)}
        onCreate={(status, title) => create.mutate({ status, title })}
        readOnly={archived}
      />
      {openTask && <TaskDrawer taskKey={openTask} onClose={closeDrawer} />}
    </>
  );
}
