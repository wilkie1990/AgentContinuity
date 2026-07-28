import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { installClient } from "../install/index.js";

const temporaryRoots: string[] = [];

function fixtureRepository(): string {
  const root = mkdtempSync(join(tmpdir(), "agent-continuity-install-test-"));
  temporaryRoots.push(root);
  mkdirSync(join(root, "apps", "mcp", "dist"), { recursive: true });
  writeFileSync(join(root, "apps", "mcp", "dist", "bin.js"), "process.stdin.resume();\n");
  mkdirSync(join(root, "apps", "cli", "dist"), { recursive: true });
  writeFileSync(join(root, "apps", "cli", "dist", "session-hook.js"), "process.stdin.resume();\n");
  for (const skill of ["agent-continuity", "project-bootstrap"]) {
    mkdirSync(join(root, "skills", skill), { recursive: true });
    writeFileSync(join(root, "skills", skill, "SKILL.md"), `# ${skill}\n`);
  }
  return root;
}

afterEach(() => {
  for (const root of temporaryRoots) rmSync(root, { recursive: true, force: true });
  temporaryRoots.length = 0;
});

describe("local client installer", () => {
  it("adds Codex config, preserves unrelated TOML, backs it up and copies both skills", () => {
    const root = fixtureRepository();
    const configRoot = join(root, "isolated-codex");
    mkdirSync(configRoot);
    const configPath = join(configRoot, "config.toml");
    const original = 'model = "gpt-5"\n\n[mcp_servers.other]\ncommand = "other"\n';
    writeFileSync(configPath, original);

    const result = installClient({
      client: "codex",
      repositoryRoot: root,
      clientRoot: configRoot,
      nodePath: "/absolute/node",
      preferCopy: true,
    });

    const config = readFileSync(configPath, "utf8");
    expect(config).toContain(original);
    expect(config).toContain('command = "/absolute/node"');
    expect(config).toContain(`args = [${JSON.stringify(join(root, "apps", "mcp", "dist", "bin.js"))}]`);
    expect(readFileSync(`${configPath}.agent-continuity.bak`, "utf8")).toBe(original);
    for (const skill of ["agent-continuity", "project-bootstrap"]) {
      const target = join(root, ".agents", "skills", skill);
      expect(lstatSync(target).isDirectory()).toBe(true);
      expect(readFileSync(join(target, "SKILL.md"), "utf8")).toContain(skill);
    }
    expect(result.changes.map((change) => change.action)).toContain("backup");
  });

  it("is idempotent and does not create another backup or duplicate config", () => {
    const root = fixtureRepository();
    const configRoot = join(root, "isolated-codex");
    const options = {
      client: "codex" as const,
      repositoryRoot: root,
      clientRoot: configRoot,
      nodePath: "/absolute/node",
    };

    installClient(options);
    const first = readFileSync(join(configRoot, "config.toml"), "utf8");
    const secondResult = installClient(options);
    const second = readFileSync(join(configRoot, "config.toml"), "utf8");

    expect(second).toBe(first);
    expect(second.match(/\[mcp_servers\.agent-continuity\]/g)).toHaveLength(1);
    expect(existsSync(join(configRoot, "config.toml.agent-continuity.bak"))).toBe(false);
    expect(secondResult.changes.every((change) => change.action === "unchanged")).toBe(true);
  });

  it("reports a dry run without touching config or skill paths", () => {
    const root = fixtureRepository();
    const configRoot = join(root, "isolated-claude");
    const result = installClient({
      client: "claude-code",
      repositoryRoot: root,
      clientRoot: configRoot,
      dryRun: true,
    });

    expect(existsSync(join(configRoot, ".mcp.json"))).toBe(false);
    expect(existsSync(join(root, ".claude", "skills"))).toBe(false);
    expect(result.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "created" }),
        expect.objectContaining({ action: "linked" }),
      ]),
    );
  });

  it("merges Claude Code JSON and requires force before replacing a stale owned entry", () => {
    const root = fixtureRepository();
    const configRoot = join(root, "isolated-claude");
    mkdirSync(configRoot);
    const configPath = join(configRoot, ".mcp.json");
    const original = {
      permissions: { allow: ["Read"] },
      mcpServers: {
        other: { command: "other" },
        "agent-continuity": { command: "node", args: ["/stale/server.js"] },
      },
    };
    writeFileSync(configPath, `${JSON.stringify(original, null, 2)}\n`);

    expect(() =>
      installClient({ client: "claude-code", repositoryRoot: root, clientRoot: configRoot }),
    ).toThrow(/rerun with --force/);

    installClient({
      client: "claude-code",
      repositoryRoot: root,
      clientRoot: configRoot,
      nodePath: "/absolute/node",
      force: true,
      preferCopy: true,
    });
    const updated = JSON.parse(readFileSync(configPath, "utf8"));
    expect(updated.permissions).toEqual(original.permissions);
    expect(updated.mcpServers.other).toEqual(original.mcpServers.other);
    expect(updated.mcpServers["agent-continuity"]).toEqual({
      command: "/absolute/node",
      args: [join(root, "apps", "mcp", "dist", "bin.js")],
    });
    expect(JSON.parse(readFileSync(`${configPath}.agent-continuity.bak`, "utf8"))).toEqual(original);
  });

  it("force-replaces only a stale Codex entry, including its owned subtables", () => {
    const root = fixtureRepository();
    const configRoot = join(root, "isolated-codex");
    mkdirSync(configRoot);
    const configPath = join(configRoot, "config.toml");
    const original =
      '[mcp_servers.agent-continuity]\ncommand = "node"\nargs = ["/stale.js"]\n' +
      '[mcp_servers.agent-continuity.env]\nSTALE = "yes"\n\n' +
      '[mcp_servers.other]\ncommand = "other"\n';
    writeFileSync(configPath, original);

    installClient({
      client: "codex",
      repositoryRoot: root,
      clientRoot: configRoot,
      nodePath: "/absolute/node",
      force: true,
    });

    const updated = readFileSync(configPath, "utf8");
    expect(updated).not.toContain("STALE");
    expect(updated).toContain('[mcp_servers.other]\ncommand = "other"');
    expect(updated).toContain('command = "/absolute/node"');
    expect(readFileSync(`${configPath}.agent-continuity.bak`, "utf8")).toBe(original);
  });

  it("refuses malformed client configuration without writing a backup", () => {
    const root = fixtureRepository();
    const claudeRoot = join(root, "isolated-claude");
    mkdirSync(claudeRoot);
    writeFileSync(join(claudeRoot, ".mcp.json"), "{ nope");
    expect(() =>
      installClient({ client: "claude-code", repositoryRoot: root, clientRoot: claudeRoot }),
    ).toThrow(/malformed Claude Code config/);
    expect(existsSync(join(claudeRoot, ".mcp.json.agent-continuity.bak"))).toBe(false);

    const codexRoot = join(root, "isolated-codex");
    mkdirSync(codexRoot);
    writeFileSync(join(codexRoot, "config.toml"), "not valid toml\n");
    expect(() =>
      installClient({ client: "codex", repositoryRoot: root, clientRoot: codexRoot }),
    ).toThrow(/cannot safely preserve/);
  });

  it("links skills to their canonical source by default", () => {
    const root = fixtureRepository();
    installClient({ client: "claude-code", repositoryRoot: root });
    const target = join(root, ".claude", "skills", "agent-continuity");
    expect(lstatSync(target).isSymbolicLink()).toBe(true);
    expect(realpathSync(target)).toBe(realpathSync(resolve(root, "skills", "agent-continuity")));
  });

  it("falls back to copying when the filesystem rejects directory links", () => {
    const root = fixtureRepository();
    const result = installClient(
      { client: "claude-code", repositoryRoot: root },
      {
        createDirectoryLink() {
          throw new Error("links unavailable");
        },
      },
    );
    const target = join(root, ".claude", "skills", "agent-continuity");
    expect(lstatSync(target).isDirectory()).toBe(true);
    expect(lstatSync(target).isSymbolicLink()).toBe(false);
    expect(result.changes.filter((change) => change.action === "copied")).toHaveLength(2);
  });

  it("reports missing build output with the command needed to fix it", () => {
    const root = fixtureRepository();
    const mcpEntry = join(root, "apps", "mcp", "dist", "bin.js");
    writeFileSync(mcpEntry, "");
    // A directory at this path cannot be started as a Node entry point.
    expect(() =>
      installClient({ client: "codex", repositoryRoot: join(root, "not-a-repository") }),
    ).toThrow(/Run pnpm build before installing/);
  });

  it("skips lifecycle integration unless it is explicitly enabled", () => {
    const root = fixtureRepository();
    const codexRoot = join(root, "isolated-codex");
    const claudeRoot = join(root, "isolated-claude");

    installClient({ client: "codex", repositoryRoot: root, clientRoot: codexRoot });
    installClient({ client: "claude-code", repositoryRoot: root, clientRoot: claudeRoot });

    expect(existsSync(join(codexRoot, "hooks.json"))).toBe(false);
    expect(existsSync(join(claudeRoot, ".claude", "settings.json"))).toBe(false);
  });

  it("enables, repeats, and removes Codex lifecycle hooks without disturbing unrelated hooks", () => {
    const root = fixtureRepository();
    const configRoot = join(root, "isolated-codex");
    const hooksPath = join(configRoot, "hooks.json");
    mkdirSync(configRoot);
    const original = {
      notice: "preserve me",
      hooks: {
        SessionStart: [{ matcher: "compact", hooks: [{ type: "command", command: "existing-start" }] }],
        Stop: [{ hooks: [{ type: "command", command: "existing-stop" }] }],
      },
    };
    writeFileSync(hooksPath, `${JSON.stringify(original, null, 2)}\n`);
    const options = {
      client: "codex" as const,
      repositoryRoot: root,
      clientRoot: configRoot,
      nodePath: "/absolute/node",
      sessionIntegration: "enable" as const,
    };

    installClient(options);
    const enabledText = readFileSync(hooksPath, "utf8");
    const enabled = JSON.parse(enabledText);
    expect(enabled.notice).toBe("preserve me");
    expect(enabled.hooks.SessionStart).toHaveLength(2);
    expect(enabled.hooks.Stop).toHaveLength(2);
    expect(enabledText.match(/--agent-continuity-session-hook/g)).toHaveLength(4);
    expect(enabledText).toContain("/absolute/node");
    expect(enabledText).toContain(join(root, "apps", "cli", "dist", "session-hook.js"));
    expect(JSON.parse(readFileSync(`${hooksPath}.agent-continuity.bak`, "utf8"))).toEqual(original);

    const repeated = installClient(options);
    expect(readFileSync(hooksPath, "utf8")).toBe(enabledText);
    expect(
      repeated.changes.filter((change) => change.path === hooksPath),
    ).toEqual([{ path: hooksPath, action: "unchanged" }]);

    installClient({ ...options, sessionIntegration: "remove" });
    const removed = JSON.parse(readFileSync(hooksPath, "utf8"));
    expect(removed.notice).toBe("preserve me");
    expect(removed.hooks).toEqual(original.hooks);
  });

  it("replaces legacy marker-owned attention hooks and preserves unrelated handlers", () => {
    const root = fixtureRepository();
    const configRoot = join(root, "isolated-codex");
    const hooksPath = join(configRoot, "hooks.json");
    mkdirSync(configRoot);
    const legacy = {
      hooks: {
        SessionStart: [
          {
            matcher: "startup|resume",
            hooks: [
              {
                type: "command",
                command:
                  "node old-session-hook.js --agent-continuity-session-hook --event start --legacy-attention",
              },
            ],
          },
          { hooks: [{ type: "command", command: "keep-start" }] },
        ],
        Stop: [
          {
            hooks: [
              {
                type: "command",
                command:
                  "node old-session-hook.js --agent-continuity-session-hook --event stop --legacy-scan",
              },
            ],
          },
          { hooks: [{ type: "command", command: "keep-stop" }] },
        ],
      },
    };
    writeFileSync(hooksPath, `${JSON.stringify(legacy, null, 2)}\n`);

    const options = {
      client: "codex" as const,
      repositoryRoot: root,
      clientRoot: configRoot,
      nodePath: "/absolute/node",
      sessionIntegration: "enable" as const,
    };
    installClient(options);

    const enabledText = readFileSync(hooksPath, "utf8");
    const enabled = JSON.parse(enabledText);
    expect(enabledText).not.toContain("--legacy-attention");
    expect(enabledText).not.toContain("--legacy-scan");
    expect(enabledText.match(/--agent-continuity-session-hook/g)).toHaveLength(4);
    expect(JSON.stringify(enabled.hooks)).toContain("keep-start");
    expect(JSON.stringify(enabled.hooks)).toContain("keep-stop");

    installClient({ ...options, sessionIntegration: "remove" });
    const removedText = readFileSync(hooksPath, "utf8");
    expect(removedText).not.toContain("--agent-continuity-session-hook");
    expect(removedText).toContain("keep-start");
    expect(removedText).toContain("keep-stop");
  });

  it("merges Claude lifecycle hooks into project settings and preserves unrelated settings", () => {
    const root = fixtureRepository();
    const clientRoot = join(root, "isolated-claude");
    const settingsPath = join(clientRoot, ".claude", "settings.json");
    mkdirSync(join(clientRoot, ".claude"), { recursive: true });
    const original = {
      permissions: { allow: ["Read"] },
      hooks: {
        PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "audit-tool" }] }],
      },
    };
    writeFileSync(settingsPath, `${JSON.stringify(original, null, 2)}\n`);

    installClient({
      client: "claude-code",
      repositoryRoot: root,
      clientRoot,
      nodePath: "/absolute/node",
      sessionIntegration: "enable",
    });

    const updated = JSON.parse(readFileSync(settingsPath, "utf8"));
    expect(updated.permissions).toEqual(original.permissions);
    expect(updated.hooks.PreToolUse).toEqual(original.hooks.PreToolUse);
    expect(updated.hooks.SessionStart[0].matcher).toBe("startup|resume");
    expect(updated.hooks.Stop).toHaveLength(1);
    expect(JSON.stringify(updated).match(/--agent-continuity-session-hook/g)).toHaveLength(2);
    expect(updated.hooks.SessionStart[0].hooks[0]).toEqual(
      expect.objectContaining({
        command: "/absolute/node",
        args: [
          join(root, "apps", "cli", "dist", "session-hook.js"),
          "--agent-continuity-session-hook",
          "--client",
          "claude-code",
          "--event",
          "start",
        ],
      }),
    );
  });

  it("reports lifecycle dry runs and refuses malformed hook configuration without mutation", () => {
    const root = fixtureRepository();
    const configRoot = join(root, "isolated-codex");
    const hooksPath = join(configRoot, "hooks.json");
    const result = installClient({
      client: "codex",
      repositoryRoot: root,
      clientRoot: configRoot,
      sessionIntegration: "enable",
      dryRun: true,
    });
    expect(existsSync(hooksPath)).toBe(false);
    expect(result.changes).toContainEqual({ path: hooksPath, action: "created" });

    mkdirSync(configRoot, { recursive: true });
    writeFileSync(hooksPath, "{ nope");
    expect(() =>
      installClient({
        client: "codex",
        repositoryRoot: root,
        clientRoot: configRoot,
        sessionIntegration: "enable",
      }),
    ).toThrow(/malformed hook configuration/);
    expect(readFileSync(hooksPath, "utf8")).toBe("{ nope");
    expect(existsSync(`${hooksPath}.agent-continuity.bak`)).toBe(false);
  });
});
