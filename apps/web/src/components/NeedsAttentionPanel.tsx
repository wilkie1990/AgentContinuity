import type { NeedsAttentionItem, ProjectSummary } from "@agent-continuity/contracts";
import { Link } from "react-router-dom";
import { useAttention, useProjects } from "../api.js";
import { ErrorNote } from "./common.js";
import { ExecutionHealthBadge } from "./ExecutionStatus.js";
import { EmptyState, Skeleton } from "./StatePlaceholders.js";

const REASONS: Record<NeedsAttentionItem["reason"], string> = {
  expired_claim: "Claim expired",
  stale_execution: "Execution stale",
  interrupted_execution: "Execution interrupted",
  blocked: "Blocked",
  review: "Ready for review",
  handoff: "Handoff ready",
};

function ProjectName({ project }: { project: ProjectSummary | undefined }) {
  return project ? <span className="muted">{project.name}</span> : null;
}

export function NeedsAttentionPanel({ projectId }: { projectId?: string }) {
  const attention = useAttention();
  const projects = useProjects(["active", "paused", "completed"]);
  const projectById = new Map((projects.data?.projects ?? []).map((project) => [project.id, project]));
  const items = (attention.data ?? []).filter((item) => !projectId || item.projectId === projectId);

  if (attention.isLoading) return <Skeleton lines={4} />;

  return (
    <div className="attention-panel stack" aria-live="polite">
      <ErrorNote error={attention.error ?? projects.error} />
      {items.length === 0 ? (
        <EmptyState
          title="Nothing needs attention"
          hint="Stale or interrupted executions, expired claims, blockers, review work and handoffs will appear here."
        />
      ) : (
        <div className="attention-list">
          {items.map((item) => {
            const project = projectById.get(item.projectId);
            const taskHref = project ? `/projects/${project.key}?task=${item.taskKey}` : null;
            return (
              <article className="attention-item" key={`${item.projectId}:${item.taskId}:${item.reason}`}>
                <div className="spread">
                  <div className="row" style={{ gap: 6 }}>
                    <span className={`badge attention-reason attention-${item.reason}`}>{REASONS[item.reason]}</span>
                    {item.execution && <ExecutionHealthBadge execution={item.execution} />}
                  </div>
                  <ProjectName project={project} />
                </div>
                {taskHref ? (
                  <Link to={taskHref} className="attention-task">
                    <span className="key">{item.taskKey}</span>
                    <span>Open task</span>
                  </Link>
                ) : (
                  <span className="key">{item.taskKey}</span>
                )}
                <p className="attention-action"><strong>Required action:</strong> {item.requiredAction}</p>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
