import {
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readlinkSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { claudeCodeClient } from "./clients/claude-code.js";
import { codexClient } from "./clients/codex.js";
import type {
  ClientAdapter,
  InstallChange,
  InstallOptions,
  InstallResult,
  SupportedClient,
} from "./types.js";

export type {
  InstallChange,
  InstallOptions,
  InstallResult,
  SessionIntegrationMode,
  SupportedClient,
} from "./types.js";

export const SUPPORTED_CLIENTS: SupportedClient[] = ["codex", "claude-code"];

export type InstallDependencies = {
  createDirectoryLink(source: string, target: string): void;
};

const defaultDependencies: InstallDependencies = {
  createDirectoryLink: (source, target) => symlinkSync(source, target, "dir"),
};

const clients: Record<SupportedClient, ClientAdapter> = {
  codex: codexClient,
  "claude-code": claudeCodeClient,
};

function createBackup(path: string, changes: InstallChange[]): void {
  const backup = `${path}.agent-continuity.bak`;
  copyFileSync(path, backup);
  changes.push({ path: backup, action: "backup" });
}

function assertSkillTargetSafe(source: string, target: string): void {
  if (!existsSync(target)) return;
  const stats = lstatSync(target);
  if (stats.isSymbolicLink()) {
    const linked = resolve(dirname(target), readlinkSync(target));
    if (linked !== resolve(source)) {
      throw new Error(
        `Cannot install skill at ${target}: its existing symlink points to ${linked}, not ${source}.`,
      );
    }
    return;
  }
  if (!stats.isDirectory()) {
    throw new Error(`Cannot install skill at ${target}: an existing non-directory file is in the way.`);
  }
}

function materializeSkill(
  source: string,
  target: string,
  options: InstallOptions,
  changes: InstallChange[],
  dependencies: InstallDependencies,
): void {
  if (existsSync(target)) {
    changes.push({ path: target, action: "unchanged" });
    return;
  }
  if (options.dryRun) {
    changes.push({ path: target, action: options.preferCopy ? "copied" : "linked" });
    return;
  }
  mkdirSync(dirname(target), { recursive: true });
  if (!options.preferCopy) {
    try {
      dependencies.createDirectoryLink(source, target);
      changes.push({ path: target, action: "linked" });
      return;
    } catch {
      // Copying is the fallback for filesystems and Windows policies that reject links.
    }
  }
  cpSync(source, target, { recursive: true });
  changes.push({ path: target, action: "copied" });
}

/** Install one documented local client without touching its unrelated configuration. */
export function installClient(
  options: InstallOptions,
  dependencies: InstallDependencies = defaultDependencies,
): InstallResult {
  const repositoryRoot = resolve(options.repositoryRoot ?? process.cwd());
  const nodePath = resolve(options.nodePath ?? process.execPath);
  const normalized = { ...options, repositoryRoot, nodePath };
  const client = clients[options.client];
  const mcpEntry = join(repositoryRoot, "apps", "mcp", "dist", "bin.js");
  if (!existsSync(mcpEntry)) {
    throw new Error(`MCP entry point not found at ${mcpEntry}. Run pnpm build before installing a client.`);
  }

  const configPath = client.configPath(normalized);
  const skillsPath = client.skillsPath(normalized);
  const skillPlans = ["agent-continuity", "project-bootstrap"].map((skill) => ({
    source: join(repositoryRoot, "skills", skill),
    target: join(skillsPath, skill),
  }));
  for (const { source, target } of skillPlans) {
    if (!existsSync(source)) throw new Error(`Required skill directory not found: ${source}`);
    assertSkillTargetSafe(source, target);
  }

  const changes: InstallChange[] = [];
  const writeConfig = (contents: string, action: "created" | "updated") => {
    if (options.dryRun) {
      changes.push({ path: configPath, action });
      return;
    }
    if (existsSync(configPath)) createBackup(configPath, changes);
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, contents, "utf8");
    changes.push({ path: configPath, action });
  };

  client.installConfig({ options: normalized, configPath, changes, mcpEntry, writeConfig });
  client.installSessionIntegration?.({
    options: normalized,
    configPath,
    changes,
    mcpEntry,
    writeConfig,
  });
  for (const { source, target } of skillPlans) {
    materializeSkill(source, target, options, changes, dependencies);
  }
  return { client: options.client, configPath, skillsPath, changes };
}
