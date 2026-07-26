import type { ProjectDetail } from "@agent-continuity/contracts";
import { NavLink, useLocation } from "react-router-dom";
import { useAttention, useTasks } from "../api.js";
import { ProgressBar } from "./common.js";
import { formatRelative } from "../format.js";

const TABS = [
  { to: "", label: "Board" },
  { to: "/context", label: "Project Context" },
  { to: "/decisions", label: "Decisions" },
  { to: "/links", label: "Links" },
  { to: "/activity", label: "Activity" },
  { to: "/attention", label: "Needs Attention" },
];

export function ProjectHeader({ project }: { project: ProjectDetail }) {
  const { pathname } = useLocation();
  const base = `/projects/${project.key}`;
  const tasks = useTasks(project.key);
  const attention = useAttention();
  const activeExecutions = (tasks.data ?? []).filter((task) => task.execution && task.execution.health !== "finished").length;
  const attentionCount = (attention.data ?? []).filter((item) => item.projectId === project.id).length;

  return (
    <div className="stack project-header">
      <div className="spread">
        <div>
          <div className="row">
            <h1>{project.name}</h1>
            <span className="key">{project.key}</span>
            {project.status !== "active" && <span className="badge">{project.status}</span>}
          </div>
          {project.objective && <p className="muted small">{project.objective}</p>}
        </div>
        <div style={{ minWidth: 180, maxWidth: "100%", flex: "1 1 220px" }}>
          <ProgressBar value={project.progress} />
          <p className="small muted" style={{ margin: "4px 0 0" }}>
            Last activity: {formatRelative(project.lastActivityAt)}
          </p>
          <div className="project-execution-summary" aria-label="Project live work summary">
            <span className="badge execution-active">{activeExecutions} active execution{activeExecutions === 1 ? "" : "s"}</span>
            {attentionCount > 0 && <span className="badge blocker">{attentionCount} need attention</span>}
          </div>
        </div>
      </div>

      <nav className="tabs">
        {TABS.map((tab) => {
          const to = `${base}${tab.to}`;
          const active = tab.to === "" ? pathname === base : pathname === to;
          return (
            <NavLink key={tab.label} to={to} className={active ? "active" : undefined} end>
              {tab.label}
            </NavLink>
          );
        })}
      </nav>

      {project.status === "archived" && (
        <p className="error small">
          This project is archived. Mutations are rejected until it is made active again.
        </p>
      )}
    </div>
  );
}
