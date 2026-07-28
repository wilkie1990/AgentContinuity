import type { SearchResponse, SearchResult } from "@agent-continuity/contracts";

export function searchResultLine(result: SearchResult): string {
  const scope = result.taskKey
    ? `${result.projectKey}/${result.taskKey}`
    : result.projectKey;
  return [
    `${result.sourceType}  ${result.sourceKey}  ${scope}  score=${result.score.toFixed(6)}`,
    `  ${result.title}`,
    result.snippet ? `  ${result.snippet}` : null,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

export function searchOutput(response: SearchResponse): string {
  if (response.results.length === 0) {
    return `No results for "${response.query}".`;
  }
  return [
    `${response.results.length} result${response.results.length === 1 ? "" : "s"} for "${response.query}":`,
    "",
    response.results.map(searchResultLine).join("\n\n"),
  ].join("\n");
}
