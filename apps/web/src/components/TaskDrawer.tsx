import type { TaskPriority, TaskStatus } from "@agent-workspace/contracts";
import { useEffect, useState, type FormEvent } from "react";
import { client, useTask, useWorkspaceMutation } from "../api.js";
import { BOARD_COLUMNS, describeEvent, formatDateTime, formatTime } from "../format.js";
import { useSyncedDraft } from "../hooks.js";
import { Empty, ErrorNote, Loading, Section, UI_ACTOR } from "./common.js";

const PRIORITIES: TaskPriority[] = ["low", "normal", "high", "critical"];

function AddForm({
  placeholder,
  label,
  multiline,
  onSubmit,
  extra,
}: {
  placeholder: string;
  label: string;
  multiline?: boolean;
  onSubmit: (value: string, extra: string) => void;
  extra?: { placeholder: string; label: string };
}) {
  const [value, setValue] = useState("");
  const [second, setSecond] = useState("");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!value.trim()) return;
    onSubmit(value.trim(), second.trim());
    setValue("");
    setSecond("");
  };

  return (
    <form onSubmit={submit} className="stack" style={{ gap: 6 }}>
      {multiline ? (
        <textarea
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={placeholder}
          aria-label={label}
          style={{ minHeight: 56 }}
        />
      ) : (
        <input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={placeholder}
          aria-label={label}
        />
      )}
      {extra && (
        <input
          value={second}
          onChange={(event) => setSecond(event.target.value)}
          placeholder={extra.placeholder}
          aria-label={extra.label}
        />
      )}
      <div className="row" style={{ justifyContent: "flex-end" }}>
        <button type="submit" disabled={!value.trim()}>
          {label}
        </button>
      </div>
    </form>
  );
}

export function TaskDrawer({ taskKey, onClose }: { taskKey: string; onClose: () => void }) {
  const { data: task, isLoading, error } = useTask(taskKey);
  const projectKey = task?.project.key;

  // Seeded from the server but kept from being clobbered by a background
  // refetch (polling, window refocus) while the field is mid-edit — see
  // useSyncedDraft.
  const [description, setDescription] = useSyncedDraft(task?.description, task?.id);
  const [context, setContext] = useSyncedDraft(task?.context, task?.id);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const meta = { actor: UI_ACTOR };
  const update = useWorkspaceMutation(projectKey, (input: Parameters<typeof client.tasks.update>[1]) =>
    client.tasks.update(taskKey, { ...input, ...meta }),
  );
  const saveContext = useWorkspaceMutation(projectKey, (value: string) =>
    client.tasks.updateContext(taskKey, { context: value, ...meta }),
  );
  const addCriteria = useWorkspaceMutation(projectKey, (value: string) =>
    client.tasks.addAcceptanceCriteria(taskKey, [value], meta),
  );
  const toggleCriterion = useWorkspaceMutation(
    projectKey,
    ({ id, complete }: { id: string; complete: boolean }) =>
      complete
        ? client.acceptanceCriteria.complete(id, meta)
        : client.acceptanceCriteria.reopen(id, meta),
  );
  const addProgress = useWorkspaceMutation(projectKey, (content: string) =>
    client.tasks.addProgress(taskKey, { content, ...meta }),
  );
  const addBlocker = useWorkspaceMutation(
    projectKey,
    ({ description: text, requiredAction }: { description: string; requiredAction: string }) =>
      client.tasks.addBlocker(taskKey, {
        description: text,
        ...(requiredAction ? { requiredAction } : {}),
        ...meta,
      }),
  );
  const resolveBlocker = useWorkspaceMutation(
    projectKey,
    ({ key, resolution }: { key: string; resolution: string }) =>
      client.blockers.resolve(key, { resolution, ...meta }),
  );
  const releaseClaim = useWorkspaceMutation(projectKey, (force: boolean) =>
    client.tasks.releaseClaim(taskKey, {
      reason: force ? "released from the web UI" : "released by the owner",
      ...(force ? {} : meta),
    }),
  );
  const remove = useWorkspaceMutation(projectKey, () =>
    client.tasks.remove(taskKey, { ...meta }),
  );
  const complete = useWorkspaceMutation(projectKey, (force: boolean) =>
    client.tasks.complete(taskKey, {
      force,
      ...(force ? { reason: "Completed from the web UI" } : {}),
      ...meta,
    }),
  );

  const busyError =
    update.error ??
    saveContext.error ??
    addCriteria.error ??
    toggleCriterion.error ??
    addProgress.error ??
    addBlocker.error ??
    resolveBlocker.error ??
    releaseClaim.error ??
    complete.error ??
    remove.error;

  return (
    <div className="drawer-backdrop" onClick={onClose} role="presentation">
      <div
        className="drawer"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Task ${taskKey}`}
      >
        <div className="spread">
          <span className="key">{taskKey}</span>
          <button className="subtle" onClick={onClose} aria-label="Close task">
            ✕
          </button>
        </div>

        {isLoading && <Loading />}
        <ErrorNote error={error} />

        {task && (
          <>
            <div className="stack" style={{ gap: 8 }}>
              <h2>{task.title}</h2>
              <div className="row">
                <select
                  aria-label="Status"
                  value={task.status}
                  onChange={(event) => update.mutate({ status: event.target.value as TaskStatus })}
                  style={{ width: "auto" }}
                >
                  {BOARD_COLUMNS.map((column) => (
                    <option key={column.status} value={column.status}>
                      {column.label}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Priority"
                  value={task.priority}
                  onChange={(event) =>
                    update.mutate({ priority: event.target.value as TaskPriority })
                  }
                  style={{ width: "auto" }}
                >
                  {PRIORITIES.map((priority) => (
                    <option key={priority} value={priority}>
                      {priority}
                    </option>
                  ))}
                </select>
                {task.isActionable && <span className="badge actionable">actionable</span>}
                {task.status !== "done" && (
                  <button onClick={() => complete.mutate(false)} disabled={complete.isPending}>
                    Complete task
                  </button>
                )}
                <button
                  className="subtle danger"
                  disabled={remove.isPending}
                  onClick={() => {
                    const owned = [
                      `${task.acceptanceCriteria.length} acceptance criteria`,
                      `${task.progress.length} progress entries`,
                      `${task.activeBlockers.length + task.resolvedBlockers.length} blockers`,
                      `${task.links.length} links`,
                    ].join(", ");
                    if (
                      window.confirm(
                        `Delete ${task.key} — ${task.title}?\n\nThis also removes ${owned}, and the task's activity history. It cannot be undone.`,
                      )
                    ) {
                      remove.mutate(undefined, { onSuccess: onClose });
                    }
                  }}
                >
                  Delete task
                </button>
              </div>
            </div>

            <ErrorNote error={busyError} />

            <Section
              title="Description"
              action={
                description !== (task.description ?? "") ? (
                  <button className="subtle" onClick={() => update.mutate({ description })}>
                    Save
                  </button>
                ) : undefined
              }
            >
              <textarea
                aria-label="Description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="What must be achieved?"
              />
            </Section>

            <Section
              title="Persistent task context"
              action={
                context !== (task.context ?? "") ? (
                  <button className="subtle" onClick={() => saveContext.mutate(context)}>
                    Save
                  </button>
                ) : undefined
              }
            >
              <p className="small muted" style={{ margin: 0 }}>
                Information future agents need specifically to work on this task.
              </p>
              <textarea
                aria-label="Task context"
                value={context}
                onChange={(event) => setContext(event.target.value)}
              />
            </Section>

            <Section title="Acceptance criteria">
              {task.acceptanceCriteria.length === 0 && <Empty>No acceptance criteria yet.</Empty>}
              {task.acceptanceCriteria.map((criterion) => (
                <label
                  key={criterion.id}
                  className={`criterion${criterion.isComplete ? " complete" : ""}`}
                >
                  <input
                    type="checkbox"
                    checked={criterion.isComplete}
                    onChange={(event) =>
                      toggleCriterion.mutate({ id: criterion.id, complete: event.target.checked })
                    }
                  />
                  <span>{criterion.description}</span>
                </label>
              ))}
              <AddForm
                label="Add criterion"
                placeholder="An objectively checkable outcome"
                onSubmit={(value) => addCriteria.mutate(value)}
              />
            </Section>

            <Section title="Dependencies">
              {task.dependencies.length === 0 && <Empty>No dependencies.</Empty>}
              {task.dependencies.map((dependency) => (
                <div key={dependency.id} className="list-item small">
                  Depends on <span className="key">{dependency.key}</span> — {dependency.title} (
                  {dependency.status})
                </div>
              ))}
              {task.dependencies.length > 0 && !task.dependenciesComplete && (
                <p className="small" style={{ color: "var(--warning)" }}>
                  Blocked by incomplete dependencies.
                </p>
              )}
              {task.dependents.length > 0 && (
                <p className="small muted">
                  Dependents: {task.dependents.map((dependent) => dependent.key).join(", ")}
                </p>
              )}
            </Section>

            <Section title="Claim">
              {task.claim ? (
                <div className="stack" style={{ gap: 6 }}>
                  <div className="small">
                    Claimed by <strong>{task.claim.actor}</strong>
                    {task.claim.sessionId && ` · session ${task.claim.sessionId}`}
                    {` · expires in ${task.claim.expiresInMinutes} minutes`}
                  </div>
                  <div className="row">
                    <button onClick={() => releaseClaim.mutate(false)}>Release claim</button>
                    <button className="danger" onClick={() => releaseClaim.mutate(true)}>
                      Force release
                    </button>
                  </div>
                </div>
              ) : (
                <Empty>No active claim. An agent will claim this task before working on it.</Empty>
              )}
            </Section>

            <Section title="Progress">
              <AddForm
                label="Add progress"
                placeholder="A meaningful milestone"
                multiline
                onSubmit={(value) => addProgress.mutate(value)}
              />
              {task.progress.length === 0 && <Empty>No progress recorded.</Empty>}
              {task.progress.map((entry) => (
                <div key={entry.id} className="list-item">
                  <div className="small muted">
                    {formatDateTime(entry.createdAt)} · {entry.actor ?? "unknown"}
                  </div>
                  <div>{entry.content}</div>
                </div>
              ))}
            </Section>

            <Section title="Blockers">
              {task.activeBlockers.map((blocker) => (
                <div key={blocker.id} className="list-item active">
                  <div className="spread">
                    <strong>{blocker.description}</strong>
                    <span className="key">{blocker.key}</span>
                  </div>
                  {blocker.requiredAction && (
                    <p className="small muted" style={{ margin: "4px 0" }}>
                      Required action: {blocker.requiredAction}
                    </p>
                  )}
                  <AddForm
                    label="Resolve"
                    placeholder="How was it resolved?"
                    onSubmit={(value) => resolveBlocker.mutate({ key: blocker.key, resolution: value })}
                  />
                </div>
              ))}
              {task.activeBlockers.length === 0 && <Empty>No active blockers.</Empty>}
              <AddForm
                label="Add blocker"
                placeholder="What is preventing progress?"
                extra={{ placeholder: "Required action (optional)", label: "Required action" }}
                onSubmit={(value, requiredAction) =>
                  addBlocker.mutate({ description: value, requiredAction })
                }
              />
              {task.resolvedBlockers.map((blocker) => (
                <div key={blocker.id} className="list-item small muted">
                  <span className="key">{blocker.key}</span> {blocker.description} — resolved:{" "}
                  {blocker.resolution}
                </div>
              ))}
            </Section>

            <Section title="Decisions">
              {task.decisions.length === 0 && <Empty>No decisions recorded for this task.</Empty>}
              {task.decisions.map((decision) => (
                <div key={decision.id} className="list-item">
                  <div className="spread">
                    <strong>{decision.title}</strong>
                    <span className="key">{decision.key}</span>
                  </div>
                  <p className="small" style={{ margin: "4px 0 0" }}>
                    {decision.decision}
                  </p>
                  {decision.rationale && (
                    <p className="small muted" style={{ margin: "4px 0 0" }}>
                      {decision.rationale}
                    </p>
                  )}
                </div>
              ))}
            </Section>

            <Section title="Links">
              {task.links.length === 0 && <Empty>No links.</Empty>}
              {task.links.map((link) => (
                <div key={link.id} className="list-item small">
                  <span className="badge">{link.type}</span>{" "}
                  {link.url ? (
                    <a href={link.url} target="_blank" rel="noreferrer">
                      {link.reference ?? link.url}
                    </a>
                  ) : (
                    (link.reference ?? "—")
                  )}
                  {link.provider && <span className="muted"> · {link.provider}</span>}
                </div>
              ))}
            </Section>

            <Section title="Activity">
              <div className="timeline">
                {task.recentActivity.map((event) => (
                  <div className="entry" key={event.id}>
                    <time>{formatTime(event.createdAt)}</time>
                    <div className="small">
                      <strong>{event.actor ?? "system"}</strong> {describeEvent(event.eventType)}
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          </>
        )}
      </div>
    </div>
  );
}
