import { useState } from "react";
import { Link, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { useProjects } from "./api.js";
import { NewProjectDialog } from "./components/NewProjectDialog.js";
import { ActivityPage } from "./routes/ActivityPage.js";
import { BoardPage } from "./routes/BoardPage.js";
import { ContextPage } from "./routes/ContextPage.js";
import { DecisionsPage } from "./routes/DecisionsPage.js";
import { LinksPage } from "./routes/LinksPage.js";
import { ProjectListPage } from "./routes/ProjectListPage.js";

function Sidebar({ onNewProject }: { onNewProject: () => void }) {
  const [search, setSearch] = useState("");
  // The sidebar sits outside the routed area, so the active project comes from the path.
  const activeKey = useLocation().pathname.split("/")[2];
  // Archived projects are hidden by default.
  const { data } = useProjects(["active", "paused", "completed"]);

  const projects = (data?.projects ?? []).filter((project) =>
    `${project.key} ${project.name} ${project.objective ?? ""}`
      .toLowerCase()
      .includes(search.trim().toLowerCase()),
  );

  return (
    <aside className="sidebar">
      <button className="primary" onClick={onNewProject}>
        + New project
      </button>
      <input
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Search projects"
        aria-label="Search projects"
      />
      <nav>
        {projects.map((project) => (
          <NavLink
            key={project.id}
            to={`/projects/${project.key}`}
            className={project.key === activeKey ? "active" : undefined}
            title={project.objective ?? project.name}
          >
            {project.name}
          </NavLink>
        ))}
        {projects.length === 0 && <p className="empty small">No projects yet.</p>}
      </nav>
    </aside>
  );
}

export function App() {
  const [creating, setCreating] = useState(false);

  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="brand">
          Agent Workspace
        </Link>
        <span className="small muted">Persistent project execution for AI agents</span>
      </header>

      <div className="shell">
        <Sidebar onNewProject={() => setCreating(true)} />

        <main className="main">
          <Routes>
            <Route path="/" element={<ProjectListPage onNewProject={() => setCreating(true)} />} />
            <Route path="/projects/:project" element={<BoardPage />} />
            <Route path="/projects/:project/context" element={<ContextPage />} />
            <Route path="/projects/:project/decisions" element={<DecisionsPage />} />
            <Route path="/projects/:project/links" element={<LinksPage />} />
            <Route path="/projects/:project/activity" element={<ActivityPage />} />
            <Route
              path="*"
              element={
                <div className="page">
                  <h1>Not found</h1>
                  <p className="muted">
                    <Link to="/">Back to projects</Link>
                  </p>
                </div>
              }
            />
          </Routes>
        </main>
      </div>

      {creating && <NewProjectDialog onClose={() => setCreating(false)} />}
    </div>
  );
}
