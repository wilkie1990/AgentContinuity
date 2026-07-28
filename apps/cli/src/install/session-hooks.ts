import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ClientInstallInput, SupportedClient } from "./types.js";

const MARKER = "--agent-continuity-session-hook";

type HookHandler = {
  type: "command";
  command: string;
  args?: string[];
  commandWindows?: string;
  timeout: number;
  statusMessage?: string;
};

type HookGroup = {
  matcher?: string;
  hooks: Array<Record<string, unknown>>;
};

type HooksFile = {
  hooks?: Record<string, HookGroup[]>;
  [key: string]: unknown;
};

function commandArg(value: string): string {
  return `'${value.replaceAll("'", `'\"'\"'`)}'`;
}

function windowsArg(value: string): string {
  return `"${value.replaceAll('"', '\\"')}"`;
}

function handler(input: ClientInstallInput, client: SupportedClient, event: "start" | "stop"): HookHandler {
  const entry = join(input.options.repositoryRoot, "apps", "cli", "dist", "session-hook.js");
  const args = [entry, MARKER, "--client", client, "--event", event];
  const display = event === "start" ? { statusMessage: "Linking Agent Continuity session" } : {};
  if (client === "claude-code") {
    return {
      type: "command",
      command: input.options.nodePath,
      args,
      timeout: 3,
      ...display,
    };
  }
  const command = [input.options.nodePath, ...args];
  return {
    type: "command",
    command: command.map(commandArg).join(" "),
    commandWindows: command.map(windowsArg).join(" "),
    timeout: 3,
    ...display,
  };
}

function isOwnedHandler(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { command?: unknown; commandWindows?: unknown; args?: unknown };
  return (
    (typeof candidate.command === "string" && candidate.command.includes(MARKER)) ||
    (typeof candidate.commandWindows === "string" && candidate.commandWindows.includes(MARKER)) ||
    (Array.isArray(candidate.args) && candidate.args.includes(MARKER))
  );
}

function removeOwnedHooks(hooks: Record<string, HookGroup[]>): Record<string, HookGroup[]> {
  const next: Record<string, HookGroup[]> = {};
  for (const [event, groups] of Object.entries(hooks)) {
    const kept = groups
      .map((group) => ({ ...group, hooks: group.hooks.filter((entry) => !isOwnedHandler(entry)) }))
      .filter((group) => group.hooks.length > 0);
    if (kept.length > 0) next[event] = kept;
  }
  return next;
}

function parseHooksFile(path: string): HooksFile {
  if (!existsSync(path)) return {};
  const text = readFileSync(path, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Refusing to edit malformed hook configuration ${path}: ${reason}`);
  }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error(`Refusing to edit ${path}: hook configuration must be a JSON object.`);
  }
  const file = parsed as HooksFile;
  if (file.hooks !== undefined && (!file.hooks || Array.isArray(file.hooks) || typeof file.hooks !== "object")) {
    throw new Error(`Refusing to edit ${path}: hooks must be a JSON object.`);
  }
  for (const [event, groups] of Object.entries(file.hooks ?? {})) {
    if (!Array.isArray(groups)) throw new Error(`Refusing to edit ${path}: hooks.${event} must be an array.`);
    for (const group of groups) {
      if (!group || typeof group !== "object" || !Array.isArray(group.hooks)) {
        throw new Error(`Refusing to edit ${path}: every hooks.${event} entry must contain a hooks array.`);
      }
    }
  }
  return file;
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function installJsonSessionHooks(
  input: ClientInstallInput,
  client: SupportedClient,
  path: string,
): void {
  const mode = input.options.sessionIntegration ?? "skip";
  if (mode === "skip") return;
  const existed = existsSync(path);
  const entry = join(input.options.repositoryRoot, "apps", "cli", "dist", "session-hook.js");
  if (mode === "enable" && !existsSync(entry)) {
    throw new Error(
      `Session hook entry point not found at ${entry}. Run pnpm build before enabling session integration.`,
    );
  }

  const existing = parseHooksFile(path);
  const withoutOwned = removeOwnedHooks(existing.hooks ?? {});
  const hooks =
    mode === "enable"
      ? {
          ...withoutOwned,
          SessionStart: [
            ...(withoutOwned.SessionStart ?? []),
            {
              matcher: "startup|resume",
              hooks: [handler(input, client, "start")],
            },
          ],
          Stop: [
            ...(withoutOwned.Stop ?? []),
            {
              hooks: [handler(input, client, "stop")],
            },
          ],
        }
      : withoutOwned;
  const next: HooksFile =
    mode === "enable" || existing.hooks !== undefined ? { ...existing, hooks } : existing;
  if (sameJson(existing, next)) {
    input.changes.push({ path, action: "unchanged" });
    return;
  }
  const contents = `${JSON.stringify(next, null, 2)}\n`;
  if (input.options.dryRun) {
    input.changes.push({ path, action: existed ? "updated" : "created" });
    return;
  }
  if (existed) {
    const backup = `${path}.agent-continuity.bak`;
    writeFileSync(backup, readFileSync(path));
    input.changes.push({ path: backup, action: "backup" });
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents, "utf8");
  input.changes.push({ path, action: existed ? "updated" : "created" });
}
