import { useState } from "react";
import { useParams } from "react-router-dom";
import { useDecisions, useProject } from "../api.js";
import { ProjectHeader } from "../components/ProjectHeader.js";
import { ErrorNote } from "../components/common.js";
import { EmptyState, Skeleton } from "../components/StatePlaceholders.js";
import { formatDateTime } from "../format.js";

type Scope = "all" | "project" | "task";

export function DecisionsPage() {
  const { project: ref } = useParams();
  const [search, setSearch] = useState("");
  const [scope, setScope] = useState<Scope>("all");

  const projectQuery = useProject(ref);
  const { data, isLoading, error } = useDecisions(ref, search.trim() || undefined);

  if (projectQuery.isLoading) return <Skeleton lines={4} />;
  if (!projectQuery.data) return <ErrorNote error={projectQuery.error} />;

  const decisions = (data ?? []).filter((decision) =>
    scope === "all" ? true : scope === "task" ? decision.taskKey !== null : decision.taskKey === null,
  );

  return (
    <>
      <ProjectHeader project={projectQuery.data} />
      <div className="page stack">
        <div className="spread">
          <h2>Decisions</h2>
          <div className="row">
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search decisions"
              aria-label="Search decisions"
              className="decisions-search"
            />
            <select
              value={scope}
              onChange={(event) => setScope(event.target.value as Scope)}
              aria-label="Decision scope"
              className="filter-select"
            >
              <option value="all">All</option>
              <option value="project">Project decisions</option>
              <option value="task">Task decisions</option>
            </select>
          </div>
        </div>

        <ErrorNote error={error} />
        {isLoading && <Skeleton lines={4} />}
        {!isLoading && decisions.length === 0 && (
          <EmptyState
            title="No decisions recorded"
            hint={
              search || scope !== "all"
                ? "Nothing matches the current search or scope. Try clearing them."
                : "Agents record a decision whenever a meaningful, hard-to-reverse choice is made — architecture, scope, or a behaviour deliberately preserved."
            }
          />
        )}

        {decisions.map((decision) => (
          <div className="card stack" key={decision.id} style={{ gap: 8 }}>
            <div className="spread">
              <h3>{decision.title}</h3>
              <span className="key">{decision.key}</span>
            </div>
            <div>
              <h4>Decision</h4>
              <p style={{ margin: 0 }}>{decision.decision}</p>
            </div>
            {decision.rationale && (
              <div>
                <h4>Rationale</h4>
                <p style={{ margin: 0 }}>{decision.rationale}</p>
              </div>
            )}
            <div className="row small muted">
              <span>Scope: {decision.taskKey ?? "project"}</span>
              {decision.createdBy && <span>Created by {decision.createdBy}</span>}
              <span>{formatDateTime(decision.createdAt)}</span>
              {decision.supersededByKey && (
                <span className="badge">superseded by {decision.supersededByKey}</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
