import type { SessionHandoffStatus } from "@agent-continuity/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  executeSessionHook,
  runSessionHook,
  type SessionClient,
} from "../session-integration.js";

function status(
  sessionId: string,
  states: Array<"missing" | "stale" | "current"> = [],
): SessionHandoffStatus {
  return {
    sessionId,
    tasks: states.map((checkpointState, index) => ({
      taskKey: `TASK-${String(index + 1).padStart(4, "0")}`,
      actor: "test-agent",
      executionId: `execution-${index + 1}`,
      checkpointState,
    })),
  };
}

function client(result: SessionHandoffStatus = status("current-session")): {
  value: SessionClient;
  handoffStatus: ReturnType<typeof vi.fn>;
} {
  const handoffStatus = vi.fn(async () => result);
  return {
    value: { sessions: { handoffStatus } },
    handoffStatus,
  };
}

describe("session lifecycle probe", () => {
  it("supplies only a validated provider identity at startup without reading workspace state", async () => {
    const mock = client();
    const output = await runSessionHook(mock.value, "start", {
      session_id: "provider-session_123",
    });

    expect(output).toContain("session_id: provider-session_123");
    expect(output).toContain("only if this conversation explicitly starts or resumes");
    expect(output).toContain("No workspace state was queried");
    expect(output).not.toContain("Needs Attention");
    expect(mock.handoffStatus).not.toHaveBeenCalled();
  });

  it("is silent at startup when the provider identity is missing or unsafe", async () => {
    const mock = client();
    await expect(runSessionHook(mock.value, "start", {})).resolves.toBe("");
    await expect(
      runSessionHook(mock.value, "start", { session_id: "unsafe\ninstructions" }),
    ).resolves.toBe("");
    expect(mock.handoffStatus).not.toHaveBeenCalled();
  });

  it("uses one exact-session read and stays silent when every checkpoint is current", async () => {
    const mock = client(status("current-session", ["current", "current"]));
    await expect(
      runSessionHook(mock.value, "stop", { session_id: "current-session" }),
    ).resolves.toBe("");
    expect(mock.handoffStatus).toHaveBeenCalledOnce();
    expect(mock.handoffStatus).toHaveBeenCalledWith("current-session");
  });

  it("requests one continuation for missing and stale checkpoints only", async () => {
    const mock = client(status("current-session", ["missing", "current", "stale"]));
    const output = await runSessionHook(mock.value, "stop", {
      session_id: "current-session",
      stop_hook_active: false,
    });

    expect(output).toEqual({
      decision: "block",
      reason: expect.stringContaining(
        "create a meaningful checkpoint or hand off TASK-0001, TASK-0003",
      ),
    });
    expect(JSON.stringify(output)).toContain("Do not fabricate progress");
    expect(mock.handoffStatus).toHaveBeenCalledOnce();
  });

  it("does not loop a Stop continuation or read state on the second stop", async () => {
    const mock = client();
    await expect(
      runSessionHook(mock.value, "stop", {
        session_id: "current-session",
        stop_hook_active: true,
      }),
    ).resolves.toBe("");
    expect(mock.handoffStatus).not.toHaveBeenCalled();
  });

  it("does not read state for a missing or unsafe Stop identity", async () => {
    const mock = client();
    await expect(runSessionHook(mock.value, "stop", {})).resolves.toBe("");
    await expect(
      runSessionHook(mock.value, "stop", { session_id: "bad/id" }),
    ).resolves.toBe("");
    expect(mock.handoffStatus).not.toHaveBeenCalled();
  });

  it("fails open without output when the local service is unavailable", async () => {
    const mock = client();
    mock.handoffStatus.mockRejectedValueOnce(new Error("timed out"));
    await expect(
      executeSessionHook(mock.value, "stop", { session_id: "current-session" }),
    ).resolves.toBe("");
  });
});
