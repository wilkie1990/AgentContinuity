import { Link } from "react-router-dom";
import { client, useProjects, useWorkspaceMutation } from "../api.js";
import { ErrorNote, Loading, ProgressBar, UI_ACTOR } from "../components/common.js";
import { formatRelative } from "../format.js";

export function ProjectListPage({ onNewProject }: { onNewProject: () => void }) {
  const { data, isLoading, error } = useProjects(["active", "paused", "completed"]);
  const archive = useWorkspaceMutation(undefined, (key: string) =>
    client.projects.archive(key, UI_ACTOR),
  );

  return (
    <div className="page stack">
      <div className="spread">
        <h1>Projects</h1>
        <button className="primary" onClick={onNewProject}>
          + New project
        </button>
      </div>

      <ErrorNote error={error} />
      {isLoading && <Loading />}

      {data?.projects.length === 0 && (
        <p className="empty">
          No projects yet. Create one here, or ask an agent to bootstrap a project from your
          current work.
        </p>
      )}

      <div className="stack">
        {data?.projects.map((project) => (
          <div className="card" key={project.id}>
            <Link className="project-row" to={`/projects/${project.key}`}>
              <div className="spread">
                <div>
                  <h2>{project.name}</h2>
                  {project.objective && <p className="muted small">{project.objective}</p>}
                </div>
                <span className="key">{project.key}</span>
              </div>
              <ProgressBar value={project.progress} />
              <div className="row small muted">
                <span>{project.taskCounts.inProgress} In Progress</span>
                <span>{project.taskCounts.blocked} Blocked</span>
                <span>
                  {project.taskCounts.done}/{project.taskTotal} Done
                </span>
                <span>Last activity: {formatRelative(project.lastActivityAt)}</span>
              </div>
            </Link>
            <div className="row" style={{ justifyContent: "flex-end", marginTop: 10 }}>
              <Link to={`/projects/${project.key}`}>
                <button>Open</button>
              </Link>
              <button
                className="subtle"
                disabled={archive.isPending}
                onClick={() => {
                  if (window.confirm(`Archive ${project.name}? Archived projects become read-only.`)) {
                    archive.mutate(project.key);
                  }
                }}
              >
                Archive
              </button>
            </div>
          </div>
        ))}
      </div>
      <ErrorNote error={archive.error} />
    </div>
  );
}
