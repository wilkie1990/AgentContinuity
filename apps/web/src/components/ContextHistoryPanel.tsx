import type { ContextOwnerType, ContextSize } from "@agent-continuity/contracts";
import { useState } from "react";
import {
  client,
  useContextHistory,
  useContextVersion,
  useWorkspaceMutation,
} from "../api.js";
import { formatDateTime } from "../format.js";
import { ErrorNote, UI_ACTOR } from "./common.js";

export function ContextSizeStatus({
  version,
  size,
}: {
  version: number;
  size: ContextSize;
}) {
  return (
    <p
      className={`small context-size${size.overSoftLimit ? " context-size--warning" : " muted"}`}
      aria-live="polite"
    >
      Version {version} · {size.characters} characters · {size.bytes} UTF-8 bytes
      {size.overSoftLimit ? " · Above the 32 KiB soft limit; consider manual compaction." : ""}
    </p>
  );
}

export function ContextHistoryPanel({
  ownerType,
  ownerRef,
  projectRef,
  currentVersion,
}: {
  ownerType: ContextOwnerType;
  ownerRef: string;
  projectRef: string;
  currentVersion: number;
}) {
  const history = useContextHistory(ownerType, ownerRef);
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const selected = useContextVersion(ownerType, ownerRef, selectedVersion);
  const revert = useWorkspaceMutation<number, unknown>(projectRef, (targetVersion) =>
    ownerType === "project"
      ? client.projects.revertContext(ownerRef, {
          targetVersion,
          expectedVersion: currentVersion,
          actor: UI_ACTOR,
          reason: `Reverted from the web UI to version ${targetVersion}.`,
        })
      : client.tasks.revertContext(ownerRef, {
          targetVersion,
          expectedVersion: currentVersion,
          actor: UI_ACTOR,
          reason: `Reverted from the web UI to version ${targetVersion}.`,
        }),
  );

  return (
    <div className="context-history stack">
      <div className="spread">
        <div>
          <h3>Version history</h3>
          <p className="small muted">
            History is immutable. Revert creates a new current version.
          </p>
        </div>
        <button
          type="button"
          className="subtle"
          onClick={() => void history.refetch()}
          disabled={history.isFetching}
        >
          {history.isFetching ? "Refreshing…" : "Refresh"}
        </button>
      </div>
      <ErrorNote error={history.error ?? selected.error ?? revert.error} />
      {history.data?.versions.length === 0 && (
        <p className="small muted">No context versions recorded.</p>
      )}
      {history.data?.versions.map((version) => (
        <div className="context-history-row" key={version.id}>
          <div className="spread">
            <strong>
              Version {version.version}
              {version.isCurrent ? " · current" : ""}
            </strong>
            <span className="small muted">{formatDateTime(version.createdAt)}</span>
          </div>
          <p className="small muted">
            {version.size.characters} characters · {version.size.bytes} UTF-8 bytes ·{" "}
            {version.actor ?? "unknown"}
            {version.revertedFromVersion ? ` · reverted from v${version.revertedFromVersion}` : ""}
          </p>
          {version.reason && <p className="small">{version.reason}</p>}
          <div className="row">
            <button
              type="button"
              className="subtle"
              onClick={() =>
                setSelectedVersion((current) =>
                  current === version.version ? null : version.version,
                )
              }
            >
              {selectedVersion === version.version ? "Hide content" : "View content"}
            </button>
            {!version.isCurrent && (
              <button
                type="button"
                disabled={revert.isPending}
                onClick={() => {
                  if (
                    window.confirm(
                      `Revert to version ${version.version}?\n\nThis appends a new version; no history is deleted.`,
                    )
                  ) {
                    revert.mutate(version.version, {
                      onSuccess: () => setSelectedVersion(null),
                    });
                  }
                }}
              >
                Revert to this version
              </button>
            )}
          </div>
          {selectedVersion === version.version && (
            <pre className="context-history-content">
              {selected.isLoading
                ? "Loading…"
                : (selected.data?.content ?? "(no context recorded)")}
            </pre>
          )}
        </div>
      ))}
      {history.data?.nextBeforeVersion && (
        <p className="small muted">
          Showing the newest 20 versions. Older versions remain available through the API and CLI.
        </p>
      )}
    </div>
  );
}
