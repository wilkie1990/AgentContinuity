import { useParams } from "react-router-dom";
import { useProject } from "../api.js";
import { ErrorNote } from "../components/common.js";
import { NeedsAttentionPanel } from "../components/NeedsAttentionPanel.js";
import { ProjectHeader } from "../components/ProjectHeader.js";
import { Skeleton } from "../components/StatePlaceholders.js";

export function ProjectAttentionPage() {
  const { project: ref } = useParams();
  const project = useProject(ref);
  if (project.isLoading) return <Skeleton lines={4} />;
  if (!project.data) return <ErrorNote error={project.error} />;

  return (
    <>
      <ProjectHeader project={project.data} />
      <div className="page stack">
        <div>
          <h2>Needs Attention</h2>
          <p className="muted small">Only work requiring action for this project.</p>
        </div>
        <NeedsAttentionPanel projectId={project.data.id} />
      </div>
    </>
  );
}
