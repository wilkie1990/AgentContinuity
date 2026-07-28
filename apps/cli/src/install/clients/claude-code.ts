import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { INSTALL_SERVER_NAME } from "./codex.js";
import { installJsonSessionHooks } from "../session-hooks.js";
import type { ClientAdapter } from "../types.js";

export const claudeCodeClient: ClientAdapter = {
  configPath: (options) => join(options.clientRoot ?? options.repositoryRoot, ".mcp.json"),
  skillsPath: (options) => join(options.repositoryRoot, ".claude", "skills"),
  installConfig(input) {
    const existing = existsSync(input.configPath) ? readFileSync(input.configPath, "utf8") : "";
    let parsed: Record<string, unknown>;
    try {
      parsed = existing ? (JSON.parse(existing) as Record<string, unknown>) : {};
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`Refusing to edit malformed Claude Code config ${input.configPath}: ${reason}`);
    }
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
      throw new Error(`Refusing to edit ${input.configPath}: a Claude Code config must be a JSON object.`);
    }
    const configured = parsed.mcpServers;
    if (configured !== undefined && (!configured || Array.isArray(configured) || typeof configured !== "object")) {
      throw new Error(`Refusing to edit ${input.configPath}: mcpServers must be a JSON object.`);
    }
    const servers = (configured ?? {}) as Record<string, unknown>;
    const desired = { command: input.options.nodePath, args: [input.mcpEntry] };
    const current = servers[INSTALL_SERVER_NAME];
    if (JSON.stringify(current) === JSON.stringify(desired)) {
      input.changes.push({ path: input.configPath, action: "unchanged" });
      return;
    }
    if (current !== undefined && !input.options.force) {
      throw new Error(
        `${input.configPath} already defines mcpServers.${INSTALL_SERVER_NAME} differently. ` +
          "Review it and rerun with --force to replace only this Agent Continuity entry.",
      );
    }
    input.writeConfig(
      `${JSON.stringify({ ...parsed, mcpServers: { ...servers, [INSTALL_SERVER_NAME]: desired } }, null, 2)}\n`,
      existing ? "updated" : "created",
    );
  },
  installSessionIntegration(input) {
    const root = input.options.clientRoot ?? input.options.repositoryRoot;
    installJsonSessionHooks(input, "claude-code", join(root, ".claude", "settings.json"));
  },
};
