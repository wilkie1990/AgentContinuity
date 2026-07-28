import type {
  ContextSize,
  ContextVersionDetail,
  ContextVersionPage,
  ContextVersionSummary,
} from "@agent-continuity/contracts";

export function contextSizeText(size: ContextSize): string {
  return `${size.characters} characters · ${size.bytes} UTF-8 bytes${
    size.overSoftLimit ? " · WARNING: above the 32 KiB soft limit" : ""
  }`;
}

export function contextVersionLine(version: ContextVersionSummary): string {
  const action = version.revertedFromVersion
    ? `revert of v${version.revertedFromVersion}`
    : "replacement";
  return [
    `v${version.version}${version.isCurrent ? " (current)" : ""} · ${version.createdAt}`,
    `  ${contextSizeText(version.size)} · ${action}`,
    `  ${version.actor ?? "unknown"}${version.sessionId ? ` · session ${version.sessionId}` : ""}${
      version.reason ? ` · ${version.reason}` : ""
    }`,
  ].join("\n");
}

export function contextHistoryOutput(page: ContextVersionPage): string {
  if (page.versions.length === 0) return "No context versions recorded.";
  return [
    page.versions.map(contextVersionLine).join("\n\n"),
    page.nextBeforeVersion
      ? `\nMore versions are available before v${page.nextBeforeVersion}.`
      : null,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

export function contextVersionOutput(version: ContextVersionDetail): string {
  return `${contextVersionLine(version)}\n\n${version.content ?? "(no context recorded)"}`;
}
