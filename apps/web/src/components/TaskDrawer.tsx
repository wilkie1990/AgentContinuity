import type { TaskPriority, TaskStatus, WorkPlanItem } from "@agent-continuity/contracts";
import { useEffect, useState, type FormEvent } from "react";
import { client, useExecutionState, useTask, useWorkspaceMutation } from "../api.js";
import { BOARD_COLUMNS, describeEvent, formatDateTime, formatTime } from "../format.js";
import { useSyncedDraft, useVersionedSyncedDraft } from "../hooks.js";
import { Empty, ErrorNote, UI_ACTOR } from "./common.js";
import { DrawerSection } from "./DrawerSection.js";
import { ExecutionHealthBadge } from "./ExecutionStatus.js";
import { MarkdownContextEditor } from "./MarkdownContextEditor.js";
import { ContextHistoryPanel, ContextSizeStatus } from "./ContextHistoryPanel.js";
import { Skeleton } from "./StatePlaceholders.js";

const PRIORITIES: TaskPriority[] = ["low", "normal", "high", "critical"];

function WorkPlan({ items }: { items: WorkPlanItem[] }) {
  if (items.length === 0) return <Empty>No work plan recorded yet.</Empty>;
  return (
    <ol className="work-plan">
      {items.map((item) => (
        <li key={item.id} className={`work-plan-item work-plan-${item.status}`}>
          <span className="work-plan-state">{item.status.replace("_", " ")}</span>
          <span>{item.title}</span>
        </li>
      ))}
    </ol>
  );
}

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
  const executionState = useExecutionState(taskKey);
  const projectKey = task?.project.key;

  // Seeded from the server but kept from being clobbered by a background
  // refetch (polling, window refocus) while the field is mid-edit — see
  // useSyncedDraft.
  const [description, setDescription] = useSyncedDraft(task?.description, task?.id);
  const [context, setContext, expectedContextVersion] = useVersionedSyncedDraft(
    task?.context,
    task?.contextVersion,
    task?.id,
  );

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
    client.tasks.updateContext(taskKey, {
      context: value,
      expectedVersion: expectedContextVersion.current,
      reason: "Updated from the web UI.",
      ...meta,
    }),
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
        // Keyed by task so every collapsible section below resets to its
        // deliberate default (see DrawerSection) instead of carrying over
        // whatever the previous task's accordion state happened to be.
        key={taskKey}
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

        {isLoading && <Skeleton lines={5} />}
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

            <DrawerSection
              title="Now"
              defaultOpen
              badge={
                task.execution ? <ExecutionHealthBadge execution={task.execution} /> : undefined
              }
            >
              {task.execution ? (
                <div className="now-execution">
                  <div>
                    <span className="small muted">Working</span>
                    <strong>{task.execution.currentPhase ?? "No phase reported"}</strong>
                  </div>
                  <div className="small">
                    <strong>{task.execution.actor}</strong>
                    {task.execution.sessionId && ` · ${task.execution.sessionId}`}
                  </div>
                </div>
              ) : (
                <p className="small muted" style={{ margin: 0 }}>
                  No live execution. A released execution leaves a handoff below so another agent can resume it.
                </p>
              )}
              {executionState.data?.checkpoints[0] ? (
                <div className="now-checkpoint">
                  <div><span>Completed</span><p>{executionState.data.checkpoints[0].completed}</p></div>
                  <div><span>Working on</span><p>{executionState.data.checkpoints[0].workingOn}</p></div>
                  <div><span>Next</span><p>{executionState.data.checkpoints[0].next}</p></div>
                  {executionState.data.checkpoints[0].uncertainty && (
                    <div className="uncertainty"><span>Uncertainty</span><p>{executionState.data.checkpoints[0].uncertainty}</p></div>
                  )}
                </div>
              ) : (
                <Empty>No structured checkpoint has been recorded.</Empty>
              )}
              <div>
                <h4>Work plan</h4>
                <WorkPlan items={executionState.data?.workPlan ?? []} />
              </div>
              <div>
                <h4>Path ownership</h4>
                {executionState.data?.ownership ? (
                  <div className="small">
                    {executionState.data.ownership.paths.length === 0 ? (
                      <p className="muted">No paths declared in the current revision.</p>
                    ) : (
                      <ul>
                        {executionState.data.ownership.paths.map((entry) => (
                          <li key={entry.id}>
                            <code>{entry.path}</code> ({entry.kind})
                          </li>
                        ))}
                      </ul>
                    )}
                    {executionState.data.collisions.length > 0 && (
                      <p className="uncertainty">
                        {executionState.data.collisions.length} live advisory collision
                        {executionState.data.collisions.length === 1 ? "" : "s"}. See Needs Attention
                        before editing overlapping paths.
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="small muted">No path ownership has been declared.</p>
                )}
              </div>
              <div className="handoff-placeholder">
                <h4>Handoff</h4>
                {executionState.data?.handoff ? (
                  <div className="handoff-content">
                    <p>{executionState.data.handoff.summary}</p>
                    {executionState.data.handoff.nextAction && <p><strong>Next action:</strong> {executionState.data.handoff.nextAction}</p>}
                    {executionState.data.handoff.unresolved.length > 0 && <p className="small muted">Unresolved: {executionState.data.handoff.unresolved.join("; ")}</p>}
                  </div>
                ) : (
                  <p className="small muted">No handoff has been recorded.</p>
                )}
              </div>
            </DrawerSection>

            <DrawerSection title="Description" defaultOpen>
              {description !== (task.description ?? "") && (
                <div className="row" style={{ justifyContent: "flex-end" }}>
                  <button className="subtle" onClick={() => update.mutate({ description })}>
                    Save
                  </button>
                </div>
              )}
              <textarea
                aria-label="Description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="What must be achieved?"
              />
            </DrawerSection>

            <DrawerSection title="Persistent task context" defaultOpen>
              <p className="small muted" style={{ margin: 0 }}>
                Information future agents need specifically to work on this task.
              </p>
              <MarkdownContextEditor
                value={context}
                savedValue={task.context ?? ""}
                textareaLabel="Task context"
                emptyMessage="No task context recorded yet. Add the durable information future agents need for this task."
                placeholder="Information future agents need specifically to work on this task: prior reasoning, rejected approaches, task-specific constraints."
                isSaving={saveContext.isPending}
                onChange={setContext}
                onSave={(next) => saveContext.mutateAsync(next)}
              />
              <ContextSizeStatus version={task.contextVersion} size={task.contextSize} />
              <ContextHistoryPanel
                ownerType="task"
                ownerRef={task.key}
                projectRef={task.project.key}
                currentVersion={task.contextVersion}
              />
            </DrawerSection>

            <DrawerSection
              title="Acceptance criteria"
              defaultOpen
              badge={
                task.acceptanceCriteria.length > 0 ? (
                  <span className="small muted">
                    {task.acceptanceCriteria.filter((criterion) => criterion.isComplete).length}/
                    {task.acceptanceCriteria.length}
                  </span>
                ) : undefined
              }
            >
              {task.acceptanceCriteria.length === 0 && <Empty>No acceptance criteria yet.</Empty>}
              {task.acceptanceCriteria.map((criterion) => (
                <div
                  key={criterion.id}
                  className="criterion-card"
                >
                  <label className={`criterion${criterion.isComplete ? " complete" : ""}`}>
                    <input
                      type="checkbox"
                      checked={criterion.isComplete}
                      onChange={(event) =>
                        toggleCriterion.mutate({ id: criterion.id, complete: event.target.checked })
                      }
                    />
                    <span>{criterion.description}</span>
                  </label>
                  {criterion.evidencePolicy && (
                    <div className="criterion-meta">
                      Requires {criterion.evidencePolicy.minimumCount}{" "}
                      {criterion.evidencePolicy.qualifyingKinds.join("/")} evidence
                      {criterion.evidencePolicy.requireSha ? " with SHA" : ""}
                      {criterion.evidencePolicy.requirePassingVerification
                        ? " from passing local verification"
                        : ""}
                    </div>
                  )}
                  {(criterion.evidence ?? []).map((evidence) => (
                    <div key={evidence.id} className="criterion-meta">
                      <strong>{evidence.kind}</strong>
                      {evidence.scope?.sha
                        ? ` · ${evidence.scope.repositoryKey}@${evidence.scope.sha.slice(0, 12)}`
                        : ""}
                      {evidence.kind === "test" && evidence.verification
                        ? ` · ${evidence.verification.outcome}${
                            evidence.verification.stdoutTruncated ||
                            evidence.verification.stderrTruncated
                              ? " · output truncated"
                              : ""
                          }`
                        : ""}
                    </div>
                  ))}
                </div>
              ))}
              <AddForm
                label="Add criterion"
                placeholder="An objectively checkable outcome"
                onSubmit={(value) => addCriteria.mutate(value)}
              />
            </DrawerSection>

            <DrawerSection
              title="Dependencies"
              badge={
                task.dependencies.length > 0 ? (
                  <span className="small muted">{task.dependencies.length}</span>
                ) : undefined
              }
            >
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
            </DrawerSection>

            <DrawerSection
              title="Claim"
              badge={task.claim ? <span className="badge claim">claimed</span> : undefined}
            >
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
            </DrawerSection>

            <DrawerSection
              title="Progress"
              defaultOpen
              badge={
                task.progress.length > 0 ? (
                  <span className="small muted">{task.progress.length}</span>
                ) : undefined
              }
            >
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
            </DrawerSection>

            <DrawerSection
              title="Blockers"
              defaultOpen
              badge={
                task.activeBlockers.length > 0 ? (
                  <span className="badge blocker">{task.activeBlockers.length} active</span>
                ) : undefined
              }
            >
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
            </DrawerSection>

            <DrawerSection
              title="Decisions"
              badge={
                task.decisions.length > 0 ? (
                  <span className="small muted">{task.decisions.length}</span>
                ) : undefined
              }
            >
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
            </DrawerSection>

            <DrawerSection
              title="Links"
              badge={
                task.links.length > 0 ? (
                  <span className="small muted">{task.links.length}</span>
                ) : undefined
              }
            >
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
            </DrawerSection>

            <DrawerSection title="Activity">
              {task.recentActivity.length === 0 && <Empty>No activity yet.</Empty>}
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
            </DrawerSection>
          </>
        )}
      </div>
    </div>
  );
}
