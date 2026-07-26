import { useParams } from "react-router-dom";
import { client, useProject, useWorkspaceMutation } from "../api.js";
import { MarkdownContextEditor } from "../components/MarkdownContextEditor.js";
import { ProjectHeader } from "../components/ProjectHeader.js";
import { ErrorNote, UI_ACTOR } from "../components/common.js";
import { Skeleton } from "../components/StatePlaceholders.js";
import { formatDateTime } from "../format.js";
import { useSyncedDraft } from "../hooks.js";

export function ContextPage() {
  const { project: ref } = useParams();
  const { data: project, isLoading, error } = useProject(ref);
  // Seeded from the server but kept from being clobbered by a background
  // refetch (polling, window refocus) while mid-edit — see useSyncedDraft.
  const [value, setValue] = useSyncedDraft(project?.context, project?.id);

  const save = useWorkspaceMutation(ref, (next: string) =>
    client.projects.updateContext(ref as string, { context: next, actor: UI_ACTOR }),
  );

  if (isLoading) return <Skeleton lines={6} />;
  if (error) return <ErrorNote error={error} />;
  if (!project) return null;

  const savedContext = project.context ?? "";

  return (
    <>
      <ProjectHeader project={project} />
      <div className="page stack">
        <h2>Project Context</h2>
        <p className="muted small" style={{ margin: 0 }}>
          Persistent working memory relevant to agents working anywhere in this project.
        </p>
        <ErrorNote error={save.error} />
        <MarkdownContextEditor
          value={value}
          savedValue={savedContext}
          textareaLabel="Project context"
          emptyMessage="No context recorded yet. Add persistent working memory for agents working on this project."
          placeholder="Persistent working memory relevant to agents working anywhere in this project: constraints, scope boundaries, core assumptions, architecture, user preferences that affect execution."
          size="page"
          isSaving={save.isPending}
          onChange={setValue}
          onSave={(next) => save.mutateAsync(next)}
        />
        <p className="small muted">
          {value.length === 0
            ? "No context recorded yet."
            : `${value.length} characters · Last updated ${formatDateTime(project.updatedAt)}`}
        </p>
      </div>
    </>
  );
}
