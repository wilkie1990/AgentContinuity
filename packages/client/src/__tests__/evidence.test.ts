import { describe, expect, it } from "vitest";
import { createAgentContinuityClient } from "../index.js";

describe("typed evidence client", () => {
  it("persists structured evidence and manages criterion policies without runner fields", async () => {
    const calls: { method: string; path: string; body: unknown }[] = [];
    const client = createAgentContinuityClient({
      baseUrl: "http://continuity.test/",
      fetch: async (input, init) => {
        const url = new URL(input);
        const body = init?.body ? JSON.parse(String(init.body)) : undefined;
        calls.push({ method: init?.method ?? "GET", path: url.pathname, body });
        const response = url.pathname.endsWith("/evidence")
          ? init?.method === "POST"
            ? {
                evidence: {
                  id: "e1",
                  criterionId: "c1",
                  kind: "file",
                  path: "src/index.ts",
                  description: "Implementation",
                  scope: null,
                  actor: null,
                  sessionId: null,
                  createdAt: "2026-07-27T00:00:00.000Z",
                },
              }
            : { evidence: [] }
          : {
              policy:
                init?.method === "DELETE"
                  ? null
                  : {
                      criterionId: "c1",
                      minimumCount: 1,
                      qualifyingKinds: ["file"],
                      requireSha: false,
                      requirePassingVerification: false,
                    },
            };
        return new Response(JSON.stringify(response), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });

    expect(
      await client.tasks.addCriterionEvidence("TASK-0001", "c1", {
        kind: "file",
        path: "src/index.ts",
        description: "Implementation",
      }),
    ).toMatchObject({ kind: "file", path: "src/index.ts" });
    await client.tasks.criterionEvidence("TASK-0001", "c1");
    await client.tasks.setCriterionEvidencePolicy("TASK-0001", "c1", {
      minimumCount: 1,
      qualifyingKinds: ["file"],
      requireSha: false,
      requirePassingVerification: false,
    });
    await client.tasks.criterionEvidencePolicy("TASK-0001", "c1");
    await client.tasks.clearCriterionEvidencePolicy("TASK-0001", "c1");

    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "POST /api/v1/tasks/TASK-0001/acceptance-criteria/c1/evidence",
      "GET /api/v1/tasks/TASK-0001/acceptance-criteria/c1/evidence",
      "PUT /api/v1/tasks/TASK-0001/acceptance-criteria/c1/evidence-policy",
      "GET /api/v1/tasks/TASK-0001/acceptance-criteria/c1/evidence-policy",
      "DELETE /api/v1/tasks/TASK-0001/acceptance-criteria/c1/evidence-policy",
    ]);
    expect(JSON.stringify(calls)).not.toMatch(/executable|command|cwd|timeout/i);
  });
});
