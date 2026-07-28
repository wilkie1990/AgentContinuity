import type { ContextVersionPage } from "@agent-continuity/contracts";
import { describe, expect, it } from "vitest";
import {
  contextHistoryOutput,
  contextSizeText,
  contextVersionOutput,
} from "../context.js";

const page: ContextVersionPage = {
  versions: [
    {
      id: "version-id",
      ownerType: "task",
      ownerId: "task-id",
      projectId: "project-id",
      taskId: "task-id",
      version: 3,
      size: { characters: 40_000, bytes: 40_000, overSoftLimit: true },
      actor: "codex",
      sessionId: "session-a",
      reason: "Manual compaction",
      revertedFromVersion: 1,
      createdAt: "2026-07-27T18:00:00.000Z",
      isCurrent: true,
    },
  ],
  nextBeforeVersion: 3,
};

describe("context CLI output", () => {
  it("renders byte-aware warnings and bounded history metadata without content", () => {
    const output = contextHistoryOutput(page);
    expect(output).toContain("v3 (current)");
    expect(output).toContain("40000 UTF-8 bytes");
    expect(output).toContain("WARNING: above the 32 KiB soft limit");
    expect(output).toContain("revert of v1");
    expect(output).toContain("More versions are available before v3");
    expect(output).not.toContain("historical content");
  });

  it("renders targeted content and ordinary size text", () => {
    expect(
      contextVersionOutput({
        ...page.versions[0]!,
        content: "historical content",
      }),
    ).toContain("historical content");
    expect(
      contextSizeText({ characters: 4, bytes: 5, overSoftLimit: false }),
    ).toBe("4 characters · 5 UTF-8 bytes");
  });
});
