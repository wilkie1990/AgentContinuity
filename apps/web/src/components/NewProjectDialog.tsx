import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { client, useWorkspaceMutation } from "../api.js";
import { ErrorNote, UI_ACTOR } from "./common.js";

/**
 * The human form deliberately stays simple. Turning a whole plan into a project is an
 * agent operation (projects.bootstrap) in v0.1.
 */
export function NewProjectDialog({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [objective, setObjective] = useState("");
  const [description, setDescription] = useState("");
  const [context, setContext] = useState("");

  const create = useWorkspaceMutation(undefined, () =>
    client.projects.create({
      name: name.trim(),
      objective: objective.trim() || null,
      description: description.trim() || null,
      context: context.trim() || null,
      actor: UI_ACTOR,
    }),
  );

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    create.mutate(undefined, {
      onSuccess: (project) => {
        onClose();
        navigate(`/projects/${project.key}`);
      },
    });
  };

  return (
    <div className="dialog-backdrop" onClick={onClose} role="presentation">
      <div
        className="dialog"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="New project"
      >
        <h2>New project</h2>
        <form onSubmit={submit} style={{ marginTop: 16 }}>
          <div className="field">
            <label htmlFor="project-name">Name</label>
            <input
              id="project-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoFocus
              required
            />
          </div>
          <div className="field">
            <label htmlFor="project-objective">Objective</label>
            <input
              id="project-objective"
              value={objective}
              onChange={(event) => setObjective(event.target.value)}
              placeholder="The intended outcome"
            />
          </div>
          <div className="field">
            <label htmlFor="project-description">Description</label>
            <textarea
              id="project-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="project-context">Project context</label>
            <textarea
              id="project-context"
              value={context}
              onChange={(event) => setContext(event.target.value)}
              placeholder="Persistent working memory relevant to agents working anywhere in this project."
            />
          </div>
          <ErrorNote error={create.error} />
          <div className="row" style={{ justifyContent: "flex-end", marginTop: 8 }}>
            <button type="button" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="primary" disabled={create.isPending || !name.trim()}>
              Create project
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
