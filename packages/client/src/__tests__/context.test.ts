import { describe, expect, it } from "vitest";
import { createAgentContinuityClient } from "../index.js";

describe("context client", () => {
  it("serializes project/task version operations and optimistic write bodies", async () => {
    const calls: { url: URL; init: RequestInit | undefined }[] = [];
    const client = createAgentContinuityClient({
      baseUrl: "http://continuity.test/",
      fetch: async (input, init) => {
        const url = new URL(input);
        calls.push({ url, init });
        const body = url.pathname.endsWith("/versions")
          ? { versions: [], nextBeforeVersion: null }
          : url.pathname.includes("/versions/")
            ? {
                version: {
                  version: 1,
                  content: "historical",
                },
              }
            : url.pathname.startsWith("/api/v1/tasks/")
              ? { task: { key: "TASK-0001", contextVersion: 3 } }
              : { project: { key: "PRJ-0001", contextVersion: 2 } };
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });

    expect(
      (
        await client.projects.updateContext("PRJ-0001", {
          context: "replacement",
          expectedVersion: 1,
          reason: "Compacted manually",
          actor: "codex",
        })
      ).contextVersion,
    ).toBe(2);
    await client.projects.listContextVersions("PRJ-0001", {
      limit: 7,
      beforeVersion: 4,
    });
    expect((await client.projects.getContextVersion("PRJ-0001", 1)).content).toBe(
      "historical",
    );
    expect(
      (
        await client.tasks.revertContext("TASK-0001", {
          targetVersion: 1,
          expectedVersion: 2,
        })
      ).contextVersion,
    ).toBe(3);

    expect(calls.map((call) => call.url.pathname)).toEqual([
      "/api/v1/projects/PRJ-0001/context",
      "/api/v1/projects/PRJ-0001/context/versions",
      "/api/v1/projects/PRJ-0001/context/versions/1",
      "/api/v1/tasks/TASK-0001/context/revert",
    ]);
    expect(calls[1]!.url.searchParams.get("limit")).toBe("7");
    expect(calls[1]!.url.searchParams.get("beforeVersion")).toBe("4");
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({
      context: "replacement",
      expectedVersion: 1,
      reason: "Compacted manually",
      actor: "codex",
    });
    expect(JSON.parse(String(calls[3]!.init?.body))).toEqual({
      targetVersion: 1,
      expectedVersion: 2,
    });
  });
});
