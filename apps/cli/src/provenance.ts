import type { GitProvenanceState } from "@agent-continuity/contracts";

export function provenanceLines(provenance: GitProvenanceState | null): string[] {
  if (!provenance) return ["Git provenance: none"];
  const { baseline, snapshots } = provenance;
  const latest = snapshots.at(-1);
  return [
    `Baseline: ${baseline.status}${
      baseline.status === "ok"
        ? ` · ${baseline.branch ?? "detached"} @ ${baseline.headSha ?? "unborn"} · ${baseline.dirty ? "dirty" : "clean"}`
        : ` · ${baseline.error?.code}: ${baseline.error?.message}`
    }`,
    `Source: ${baseline.source} · repository: ${baseline.repositoryKey}`,
    `Snapshots: ${snapshots.length}`,
    latest
      ? `Latest #${latest.sequence}: ${latest.trigger} · ${latest.status}${
          latest.status === "ok"
            ? ` · ${latest.headSha ?? "unborn"} · ${latest.filesChanged} paths · +${latest.additions}/-${latest.deletions}`
            : ` · ${latest.error?.code}: ${latest.error?.message}`
        }`
      : null,
    latest?.touchedPaths.length
      ? latest.touchedPaths
          .map((path) =>
            path.previousPath
              ? `  ${path.change}: ${path.previousPath} -> ${path.path}`
              : `  ${path.change}: ${path.path}`,
          )
          .join("\n")
      : null,
  ].filter((line): line is string => line !== null);
}
