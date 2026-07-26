import { useState } from "react";
import { Link, Route, Routes } from "react-router-dom";
import { NewProjectDialog } from "./components/NewProjectDialog.js";
import { Sidebar } from "./components/Sidebar.js";
import { ActivityPage } from "./routes/ActivityPage.js";
import { AttentionPage } from "./routes/AttentionPage.js";
import { BoardPage } from "./routes/BoardPage.js";
import { ContextPage } from "./routes/ContextPage.js";
import { DecisionsPage } from "./routes/DecisionsPage.js";
import { LinksPage } from "./routes/LinksPage.js";
import { ProjectListPage } from "./routes/ProjectListPage.js";
import { ProjectAttentionPage } from "./routes/ProjectAttentionPage.js";

export function App() {
  const [creating, setCreating] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="app">
      <header className="topbar">
        <div className="row" style={{ gap: 8, flexWrap: "nowrap" }}>
          <button
            type="button"
            className="sidebar-toggle subtle"
            onClick={() => setSidebarOpen((value) => !value)}
            aria-expanded={sidebarOpen}
            aria-controls="app-sidebar"
            aria-label={sidebarOpen ? "Close sidebar" : "Open sidebar"}
          >
            ☰
          </button>
          <Link to="/" className="brand">
            Agent Continuity
          </Link>
        </div>
        <span className="small muted tagline">Persistent project execution across agents and sessions.</span>
      </header>

      <div className="shell">
        <Sidebar
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          onNewProject={() => setCreating(true)}
        />

        <main className="main">
          <Routes>
            <Route path="/" element={<ProjectListPage onNewProject={() => setCreating(true)} />} />
            <Route path="/projects/:project" element={<BoardPage />} />
            <Route path="/projects/:project/context" element={<ContextPage />} />
            <Route path="/projects/:project/decisions" element={<DecisionsPage />} />
            <Route path="/projects/:project/links" element={<LinksPage />} />
            <Route path="/projects/:project/activity" element={<ActivityPage />} />
            <Route path="/projects/:project/attention" element={<ProjectAttentionPage />} />
            <Route path="/attention" element={<AttentionPage />} />
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
