import type { ProjectSummary } from "@agent-continuity/contracts";
import { formatRelative } from "../format.js";
import { ProgressBar } from "./common.js";

/**
 * "State at a glance" for one project: progress, what's blocked, what's
 * actively moving, and how recently anything happened. Shared by the
 * sidebar panel and the project list page (TASK-0005) so the two surfaces
 * agree on what a project's state looks like rather than drifting apart.
 *
 * A project with no tasks (taskTotal === 0, progress === null) reads as
 * genuinely empty rather than as 0% complete: no progress bar is shown at
 * all, just a muted "No tasks yet" line.
 */
export function ProjectStateSummary({ project, attentionCount = 0 }: { project: ProjectSummary; attentionCount?: number }) {
  const { taskCounts, taskTotal, progress, lastActivityAt } = project;
  const blocked = taskCounts.blocked;
  const inProgress = taskCounts.inProgress;
  const hasFlags = blocked > 0 || inProgress > 0 || attentionCount > 0;

  return (
    <div className="project-state">
      {taskTotal === 0 ? (
        <p className="project-state-empty small muted">No tasks yet</p>
      ) : (
        <ProgressBar value={progress} />
      )}
      {hasFlags && (
        <div className="project-state-flags">
          {blocked > 0 && (
            <span className="badge blocker">
              {blocked} blocked
            </span>
          )}
          {inProgress > 0 && (
            <span className="badge in-progress">
              {inProgress} in progress
            </span>
          )}
          {attentionCount > 0 && (
            <span className="badge blocker">
              {attentionCount} need attention
            </span>
          )}
        </div>
      )}
      <p className="project-state-activity small muted">{formatRelative(lastActivityAt)}</p>
    </div>
  );
}
