#!/usr/bin/env node
import { createAgentContinuityClient } from "@agent-continuity/client";
import { resolveConfig } from "@agent-continuity/config";
import { readFileSync } from "node:fs";
import {
  executeSessionHook,
  type SessionHookClient,
  type SessionHookEvent,
  type SessionHookInput,
} from "./session-integration.js";

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function isClient(value: string | undefined): value is SessionHookClient {
  return value === "codex" || value === "claude-code";
}

function isEvent(value: string | undefined): value is SessionHookEvent {
  return value === "start" || value === "stop";
}

async function main(): Promise<void> {
  const clientName = option("--client");
  const event = option("--event");
  if (!process.argv.includes("--agent-continuity-session-hook") || !isClient(clientName) || !isEvent(event)) {
    return;
  }

  let input: SessionHookInput = {};
  try {
    const text = readFileSync(0, "utf8");
    input = text ? (JSON.parse(text) as SessionHookInput) : {};
  } catch {
    return;
  }

  const config = resolveConfig();
  const client = createAgentContinuityClient({
    baseUrl: config.baseUrl,
    fetch: (url, init) =>
      fetch(url, {
        ...init,
        signal: AbortSignal.timeout(1_500),
      }),
  });
  const output = await executeSessionHook(client, event, input);
  if (output) process.stdout.write(output);
}

await main().catch(() => {
  // Fail open. A client lifecycle boundary must never depend on the local service.
});
