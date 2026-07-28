import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { installJsonSessionHooks } from "../session-hooks.js";
import type { ClientAdapter } from "../types.js";

export const INSTALL_SERVER_NAME = "agent-continuity";

function assertSafeTomlForAppend(contents: string, path: string): void {
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (
      /^\[\[[^\]]+\]\]$/.test(line) ||
      /^\[[^\]]+\]$/.test(line) ||
      /^[A-Za-z0-9_.-]+\s*=/.test(line)
    ) {
      continue;
    }
    throw new Error(
      `Refusing to edit ${path}: it contains TOML syntax this installer cannot safely preserve. ` +
        "Use Codex's own configuration command or simplify the file, then run again.",
    );
  }
}

function sectionRange(contents: string, header: string): { start: number; end: number } | undefined {
  const escaped = header.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`^\\s*\\[${escaped}\\]\\s*$`, "m").exec(contents);
  if (!match || match.index === undefined) return undefined;
  const headers = /^\s*\[([^\]]+)\]\s*$/gm;
  headers.lastIndex = match.index + match[0].length;
  for (let next = headers.exec(contents); next; next = headers.exec(contents)) {
    const nextHeader = next[1]?.trim() ?? "";
    if (!nextHeader.startsWith(`${header}.`)) {
      return { start: match.index, end: next.index };
    }
  }
  return { start: match.index, end: contents.length };
}

function desiredBlock(nodePath: string, mcpEntry: string): string {
  return (
    `[mcp_servers.${INSTALL_SERVER_NAME}]\n` +
    `command = ${JSON.stringify(nodePath)}\n` +
    `args = [${JSON.stringify(mcpEntry)}]\n`
  );
}

export const codexClient: ClientAdapter = {
  configPath: (options) =>
    join(options.clientRoot ?? join(options.repositoryRoot, ".codex"), "config.toml"),
  skillsPath: (options) => join(options.repositoryRoot, ".agents", "skills"),
  installConfig(input) {
    const existing = existsSync(input.configPath) ? readFileSync(input.configPath, "utf8") : "";
    const block = desiredBlock(input.options.nodePath, input.mcpEntry);
    const range = sectionRange(existing, `mcp_servers.${INSTALL_SERVER_NAME}`);
    if (range) {
      if (existing.slice(range.start, range.end).trim() === block.trim()) {
        input.changes.push({ path: input.configPath, action: "unchanged" });
        return;
      }
      if (!input.options.force) {
        throw new Error(
          `${input.configPath} already defines [mcp_servers.${INSTALL_SERVER_NAME}] differently. ` +
            "Review it and rerun with --force to replace only this Agent Continuity entry.",
        );
      }
      input.writeConfig(
        `${existing.slice(0, range.start)}${block}${existing.slice(range.end)}`,
        "updated",
      );
      return;
    }

    // There is no comment-preserving TOML dependency in the local CLI. Append only when
    // existing input is conservative single-line TOML; otherwise refuse without mutation.
    assertSafeTomlForAppend(existing, input.configPath);
    input.writeConfig(
      `${existing}${existing && !existing.endsWith("\n") ? "\n" : ""}${existing ? "\n" : ""}${block}`,
      existing ? "updated" : "created",
    );
  },
  installSessionIntegration(input) {
    const root = input.options.clientRoot ?? join(input.options.repositoryRoot, ".codex");
    installJsonSessionHooks(input, "codex", join(root, "hooks.json"));
  },
};
