import type { SearchResponse } from "@agent-continuity/contracts";
import { describe, expect, it } from "vitest";
import { searchOutput, searchResultLine } from "../search.js";

const result: SearchResponse["results"][number] = {
  sourceType: "decision",
  sourceId: "decision-id",
  sourceKey: "DEC-0054",
  projectId: "project-id",
  projectKey: "PRJ-0026",
  taskId: "task-id",
  taskKey: "TASK-0037",
  title: "Use normalized search documents",
  snippet: "Use an external-content FTS5 table.",
  score: 12.3456789,
  createdAt: "2026-07-27T10:00:00.000Z",
  updatedAt: "2026-07-27T10:00:00.000Z",
};

describe("search CLI output", () => {
  it("renders result identity, scope, relevance and snippet", () => {
    expect(searchResultLine(result)).toBe(
      [
        "decision  DEC-0054  PRJ-0026/TASK-0037  score=12.345679",
        "  Use normalized search documents",
        "  Use an external-content FTS5 table.",
      ].join("\n"),
    );
  });

  it("renders a clear empty result", () => {
    expect(searchOutput({ query: "missing", results: [], limit: 20 })).toBe(
      'No results for "missing".',
    );
  });
});
