import { useParams } from "react-router-dom";
import { client, useProject, useWorkspaceMutation } from "../api.js";
import { ProjectHeader } from "../components/ProjectHeader.js";
import { ErrorNote, Loading, UI_ACTOR } from "../components/common.js";
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

  if (isLoading) return <Loading />;
  if (error) return <ErrorNote error={error} />;
  if (!project) return null;

  const dirty = value !== (project.context ?? "");

  return (
    <>
      <ProjectHeader project={project} />
      <div className="page stack">
        <div className="spread">
          <h2>Project Context</h2>
          <button className="primary" disabled={!dirty || save.isPending} onClick={() => save.mutate(value)}>
            Save context
          </button>
        </div>
        <p className="muted small" style={{ margin: 0 }}>
          Persistent working memory relevant to agents working anywhere in this project.
        </p>
        <ErrorNote error={save.error} />
        <textarea
          aria-label="Project context"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          style={{ minHeight: "50vh", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
        />
        <p className="small muted">
          {value.length} characters · Last updated {formatDateTime(project.updatedAt)}
        </p>
      </div>
    </>
  );
}
