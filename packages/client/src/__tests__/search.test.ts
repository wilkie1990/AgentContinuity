import { describe, expect, it } from "vitest";
import { createAgentContinuityClient } from "../index.js";

describe("search client", () => {
  it("serializes every search filter, including repeated source types", async () => {
    let requestedUrl = "";
    let requestedInit: RequestInit | undefined;
    const client = createAgentContinuityClient({
      baseUrl: "http://continuity.test/",
      fetch: async (input, init) => {
        requestedUrl = input;
        requestedInit = init;
        return new Response(
          JSON.stringify({
            query: "café & syntax",
            results: [],
            limit: 7,
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      },
    });

    const response = await client.search({
      q: "café & syntax",
      project: "PRJ-0026",
      task: "TASK-0037",
      type: ["task", "decision"],
      limit: 7,
    });

    const url = new URL(requestedUrl);
    expect(url.origin).toBe("http://continuity.test");
    expect(url.pathname).toBe("/api/v1/search");
    expect(url.searchParams.get("q")).toBe("café & syntax");
    expect(url.searchParams.get("project")).toBe("PRJ-0026");
    expect(url.searchParams.get("task")).toBe("TASK-0037");
    expect(url.searchParams.getAll("type")).toEqual(["task", "decision"]);
    expect(url.searchParams.get("limit")).toBe("7");
    expect(requestedInit).toMatchObject({ method: "GET" });
    expect(requestedInit?.body).toBeUndefined();
    expect(response).toEqual({
      query: "café & syntax",
      results: [],
      limit: 7,
    });
  });
});
