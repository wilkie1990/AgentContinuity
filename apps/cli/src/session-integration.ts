import type { SessionHandoffStatus } from "@agent-continuity/contracts";

export type SessionClient = {
  sessions: {
    handoffStatus(sessionId: string): Promise<SessionHandoffStatus>;
  };
};

export type SessionHookClient = "codex" | "claude-code";
export type SessionHookEvent = "start" | "stop";

export type SessionHookInput = {
  session_id?: unknown;
  hook_event_name?: unknown;
  stop_hook_active?: unknown;
};

function providerSessionId(input: SessionHookInput): string | null {
  if (
    typeof input.session_id !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(input.session_id)
  ) {
    return null;
  }
  return input.session_id;
}

function sessionIdentity(input: SessionHookInput): string {
  const sessionId = providerSessionId(input);
  if (!sessionId) return "";
  return (
    `Agent Continuity session_id: ${sessionId}. ` +
    "Use this exact value only if this conversation explicitly starts or resumes tracked Agent Continuity work. " +
    "No workspace state was queried."
  );
}

async function stopPrompt(
  client: SessionClient,
  input: SessionHookInput,
): Promise<{ decision: "block"; reason: string } | ""> {
  const sessionId = providerSessionId(input);
  if (input.stop_hook_active === true || !sessionId) return "";
  const status = await client.sessions.handoffStatus(sessionId);
  const missing = status.tasks
    .filter((task) => task.checkpointState !== "current")
    .map((task) => task.taskKey);
  if (missing.length === 0) return "";
  return {
    decision: "block",
    reason:
      `Before ending this turn, create a meaningful checkpoint or hand off ${missing.join(", ")}. ` +
      "If the claim should remain active, record completed work, current work, and the next action. " +
      "Do not fabricate progress. This reminder runs at most once for this stop.",
  };
}

export async function runSessionHook(
  client: SessionClient,
  event: SessionHookEvent,
  input: SessionHookInput,
): Promise<string | { decision: "block"; reason: string }> {
  if (event === "start") return sessionIdentity(input);
  return stopPrompt(client, input);
}

/** Hook processes must always fail open: errors become silence and never block a client boundary. */
export async function executeSessionHook(
  client: SessionClient,
  event: SessionHookEvent,
  input: SessionHookInput,
): Promise<string> {
  try {
    const result = await runSessionHook(client, event, input);
    return typeof result === "string" ? result : JSON.stringify(result);
  } catch {
    return "";
  }
}
