import { Link } from "react-router-dom";
import { client, useAttention, useProjects, useWorkspaceMutation } from "../api.js";
import { ErrorNote, Loading, UI_ACTOR } from "../components/common.js";
import { ProjectStateSummary } from "../components/ProjectStateSummary.js";

export function ProjectListPage({ onNewProject }: { onNewProject: () => void }) {
  const { data, isLoading, error } = useProjects(["active", "paused", "completed"]);
  const attention = useAttention();
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
              <ProjectStateSummary
                project={project}
                attentionCount={(attention.data ?? []).filter((item) => item.projectId === project.id).length}
              />
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
