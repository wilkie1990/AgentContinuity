import { describe, expect, it, vi } from "vitest";
import { createAgentContinuityClient } from "../index.js";

describe("session client", () => {
  it("encodes the exact provider session in one handoff-status request", async () => {
    const fetch = vi.fn(async (_input: string) =>
      new Response(
        JSON.stringify({
          sessionId: "provider:session",
          tasks: [],
        }),
        { status: 200 },
      ),
    );
    const client = createAgentContinuityClient({
      baseUrl: "http://127.0.0.1:8787",
      fetch,
    });

    await expect(client.sessions.handoffStatus("provider:session")).resolves.toEqual({
      sessionId: "provider:session",
      tasks: [],
    });
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0]?.[0]).toBe(
      "http://127.0.0.1:8787/api/v1/sessions/provider%3Asession/handoff-status",
    );
  });
});
