import { createAgentContinuityClient, type AgentContinuityClient } from "@agent-continuity/client";
import { resolveConfig } from "@agent-continuity/config";
import type {
  CriterionEvidence,
  CriterionEvidenceInput,
  ProjectRepository,
  ProjectStatus,
  TaskPriority,
  TaskStatus,
} from "@agent-continuity/contracts";
import { Command, Option } from "commander";
import { closeSync, existsSync, openSync, readFileSync, readSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import {
  activityLine,
  decisionBlock,
  linkLine,
  print,
  printJson,
  progressLine,
  projectDetail,
  projectLine,
  taskDetail,
  taskLine,
} from "./output.js";
import {
  installClient,
  SUPPORTED_CLIENTS,
  type SessionIntegrationMode,
  type SupportedClient,
} from "./install/index.js";
import { provenanceLines } from "./provenance.js";
import { searchOutput } from "./search.js";
import { runLocalVerification } from "./verification.js";
import {
  contextHistoryOutput,
  contextSizeText,
  contextVersionOutput,
} from "./context.js";

export const CLI_VERSION = "0.1.0";
const MAX_WORKSPACE_IMPORT_BYTES = 64 * 1024 * 1024;

type GlobalOptions = { url?: string; actor?: string; session?: string };

export async function readBoundedWorkspaceImport(file: string): Promise<string> {
  if (file === "-") {
    if (process.stdin.isTTY) {
      throw new Error("Refusing to read an interactive terminal as an import document.");
    }
    const chunks: Buffer[] = []; let total = 0;
    for await (const chunk of process.stdin) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buffer.length;
      if (total > MAX_WORKSPACE_IMPORT_BYTES) throw new Error("Import document exceeds the 64 MiB safety limit.");
      chunks.push(buffer);
    }
    return Buffer.concat(chunks, total).toString("utf8");
  }
  if (statSync(file).size > MAX_WORKSPACE_IMPORT_BYTES) throw new Error("Import document exceeds the 64 MiB safety limit.");
  const fd = openSync(file, "r");
  try {
    const chunks: Buffer[] = []; let total = 0; const buffer = Buffer.allocUnsafe(64 * 1024);
    for (;;) {
      const bytes = readSync(fd, buffer, 0, buffer.length, null);
      if (bytes === 0) break;
      total += bytes;
      if (total > MAX_WORKSPACE_IMPORT_BYTES) throw new Error("Import document exceeds the 64 MiB safety limit.");
      chunks.push(Buffer.from(buffer.subarray(0, bytes)));
    }
    return Buffer.concat(chunks, total).toString("utf8");
  } finally { closeSync(fd); }
}

export function writeWorkspaceExportFile(file: string, content: string, force = false): void {
  if (existsSync(file) && !force) throw new Error(`Refusing to overwrite ${file}; pass --force to replace it.`);
  const temp = `${file}.tmp-${process.pid}`;
  let written = false;
  try {
    const fd = openSync(temp, "wx", 0o600);
    try { writeFileSync(fd, content, "utf8"); } finally { closeSync(fd); }
    renameSync(temp, file);
    written = true;
  } finally { if (!written && existsSync(temp)) unlinkSync(temp); }
}

function clientFor(command: Command): AgentContinuityClient {
  const globals = command.optsWithGlobals<GlobalOptions>();
  const config = resolveConfig();
  return createAgentContinuityClient({ baseUrl: globals.url ?? config.baseUrl });
}

function actorFor(command: Command): { actor?: string; sessionId?: string } {
  const globals = command.optsWithGlobals<GlobalOptions>();
  const actor = globals.actor ?? process.env.AGENT_CONTINUITY_ACTOR;
  return {
    ...(actor ? { actor } : {}),
    ...(globals.session ? { sessionId: globals.session } : {}),
  };
}

function workflowIdentityFor(command: Command): { actor: string; sessionId: string } {
  const identity = actorFor(command);
  if (!identity.actor || !identity.sessionId) {
    throw new Error(
      "Composite workflows require explicit --actor and --session values " +
        "(AGENT_CONTINUITY_ACTOR may supply the actor).",
    );
  }
  return { actor: identity.actor, sessionId: identity.sessionId };
}

function executionIdentityFor(command: Command): { actor: string; sessionId?: string } {
  const identity = actorFor(command);
  if (!identity.actor) {
    throw new Error(
      "Execution worktree changes require an explicit --actor " +
        "(AGENT_CONTINUITY_ACTOR may supply it).",
    );
  }
  return { actor: identity.actor, ...(identity.sessionId ? { sessionId: identity.sessionId } : {}) };
}

function repositoryLine(repository: ProjectRepository): string {
  return [
    `${repository.key} — ${repository.label}${repository.primary ? " (primary)" : ""}`,
    `  ${repository.availability.status}: ${repository.rootPath}`,
    repository.remoteUrl ? `  remote: ${repository.remoteUrl}` : null,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

function readText(value: string | undefined, file: string | undefined): string | undefined {
  if (file) return readFileSync(file === "-" ? 0 : file, "utf8");
  return value;
}

function checkpointFor(options: {
  completed?: string;
  workingOn?: string;
  next?: string;
  uncertainty?: string;
}) {
  const supplied = [options.completed, options.workingOn, options.next].filter(
    (value) => value !== undefined,
  ).length;
  if (supplied === 0) return undefined;
  if (supplied !== 3) {
    throw new Error("--completed, --working-on and --next must be supplied together.");
  }
  return {
    completed: options.completed as string,
    workingOn: options.workingOn as string,
    next: options.next as string,
    ...(options.uncertainty ? { uncertainty: options.uncertainty } : {}),
  };
}

function collectOption(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function evidenceLine(item: CriterionEvidence): string {
  const scoped = item.scope?.sha ? ` @ ${item.scope.repositoryKey}:${item.scope.sha.slice(0, 12)}` : "";
  if (item.kind === "legacy") {
    return `legacy(${item.legacyType}): ${item.reference ?? item.url ?? item.content ?? ""}`;
  }
  if (item.kind === "commit") return `commit${scoped}: ${item.summary ?? ""}`;
  if (item.kind === "test") {
    const verification = item.verification
      ? ` (${item.verification.outcome}, ${item.verification.durationMs}ms${
          item.verification.stdoutTruncated || item.verification.stderrTruncated ? ", truncated" : ""
        })`
      : "";
    return `test${scoped}: ${item.name} — ${item.outcome}${verification}`;
  }
  if (item.kind === "file") return `file${scoped}: ${item.path}`;
  if (item.kind === "url") return `url: ${item.url}`;
  if (item.kind === "result") return `result: ${item.outcome} — ${item.summary}`;
  return `note: ${item.content}`;
}

export function buildProgram(): Command {
  const program = new Command();

  program
    .name("ac")
    .description("Agent Continuity — Persistent project execution across agents and sessions.")
    .version(CLI_VERSION)
    .option("--url <url>", "Base URL of the local Agent Continuity server")
    .option("--actor <actor>", "Identifier recorded against mutations")
    .option("--session <id>", "Session identifier recorded against mutations");

  program
    .command("install")
    .description("Configure a documented local agent client and install the project skills")
    .requiredOption("--client <client>", `Client to configure (${SUPPORTED_CLIENTS.join(", ")})`)
    .option("--root <path>", "Agent Continuity repository root (defaults to the current directory)")
    .option("--client-root <path>", "Override the client configuration root; primarily useful for isolated setups")
    .option("--dry-run", "Report changes without writing configuration or skills")
    .option("--force", "Replace only an existing Agent Continuity MCP entry that differs")
    .option("--copy", "Copy skills instead of trying a directory symlink first")
    .addOption(
      new Option(
        "--session-integration <mode>",
        "Lifecycle reminders: enable, skip, or remove (default: skip)",
      )
        .choices(["enable", "skip", "remove"])
        .default("skip"),
    )
    .action((options: {
      client: string;
      root?: string;
      clientRoot?: string;
      dryRun?: boolean;
      force?: boolean;
      copy?: boolean;
      sessionIntegration: SessionIntegrationMode;
    }) => {
      if (!SUPPORTED_CLIENTS.includes(options.client as SupportedClient)) {
        throw new Error(`Unsupported client \"${options.client}\". Supported clients: ${SUPPORTED_CLIENTS.join(", ")}.`);
      }
      const result = installClient({
        client: options.client as SupportedClient,
        repositoryRoot: options.root,
        clientRoot: options.clientRoot,
        dryRun: options.dryRun,
        force: options.force,
        preferCopy: options.copy,
        sessionIntegration: options.sessionIntegration,
      });
      for (const change of result.changes) print(`${change.action}: ${change.path}`);
      if (result.changes.length === 0) print("No changes required.");
      if (options.dryRun) print("Dry run only; no files were changed.");
    });

  // ------------------------------------------------------------ process commands

  program
    .command("server")
    .description("Start the local HTTP API and web UI")
    .option(
      "--host <host>",
      'Address(es) to bind, comma separated. Defaults to 127.0.0.1 (loopback only). Accepts the ' +
        'aliases "loopback" and "tailscale", e.g. "loopback,tailscale", or 0.0.0.0 to bind every ' +
        "interface (LAN-wide, use with care)",
    )
    .option(
      "--tailscale",
      "Shorthand for --host loopback,tailscale: reachable from this machine and from tailnet " +
        "peers, but not from the wider LAN",
    )
    .option("--port <port>", "Port to bind", (value) => Number.parseInt(value, 10))
    .action(async (options: { host?: string; tailscale?: boolean; port?: number }) => {
      if (options.host && options.tailscale) {
        throw new Error("Use either --host or --tailscale, not both.");
      }
      const host = options.tailscale ? "loopback,tailscale" : options.host;

      const { startServer, describeRunningServer } = await import("@agent-continuity/server");
      const config = resolveConfig({
        server: {
          ...(host ? { host } : {}),
          ...(options.port ? { port: options.port } : {}),
        },
      });
      const server = await startServer({ config });
      for (const line of describeRunningServer(server)) print(line);
      print(`  database: ${config.databasePath}`);
      for (const signal of ["SIGINT", "SIGTERM"] as const) {
        process.on(signal, () => void server.close().then(() => process.exit(0)));
      }
    });

  program
    .command("mcp")
    .description("Start the MCP server on stdio")
    .option("--profile <profile>", "MCP tool profile: full (default) or agent")
    .action(async (options: { profile?: string }) => {
      const [{ createMcpServer, parseMcpProfile }, { StdioServerTransport }, { createWorkspace }] = await Promise.all([
        import("@agent-continuity/mcp"),
        import("@modelcontextprotocol/sdk/server/stdio.js"),
        import("@agent-continuity/core"),
      ]);
      const workspace = createWorkspace({ config: resolveConfig() });
      await createMcpServer(workspace, { profile: parseMcpProfile(options.profile ?? process.env.AGENT_CONTINUITY_MCP_PROFILE) })
        .connect(new StdioServerTransport());
    });

  // -------------------------------------------------------------- workspace transfer

  const workspace = program.command("workspace").description("Export or restore a local workspace snapshot");

  workspace
    .command("export")
    .description("Write a deterministic logical workspace JSON snapshot")
    .option("--file <path>", "Write to a new file instead of stdout")
    .option("--force", "Allow replacing an existing output file")
    .option("--include-local-paths", "Include machine-local repository and worktree paths")
    .action(async function (this: Command, options: { file?: string; force?: boolean; includeLocalPaths?: boolean }) {
      const { createWorkspace } = await import("@agent-continuity/core");
      const local = createWorkspace({ config: resolveConfig() });
      try {
        const document = local.transfer.exportWorkspace(options.includeLocalPaths ? "included" : "redacted");
        const content = `${JSON.stringify(document, null, 2)}\n`;
        if (!options.file || options.file === "-") { process.stdout.write(content); return; }
        writeWorkspaceExportFile(options.file, content, options.force);
      } finally { local.close(); }
    });

  workspace
    .command("import")
    .description("Restore a deterministic logical workspace JSON snapshot into an empty local workspace")
    .requiredOption("--file <path>", "Snapshot file, or - for stdin")
    .requiredOption("--confirm", "Required acknowledgement that import may create workspace records")
    .option("--accept-local-paths", "Required when the snapshot contains local paths")
    .action(async function (this: Command, options: { file: string; confirm?: boolean; acceptLocalPaths?: boolean }) {
      const raw = await readBoundedWorkspaceImport(options.file);
      let document: unknown;
      try { document = JSON.parse(raw); } catch { throw new Error("Import file is not valid JSON."); }
      const { createWorkspace } = await import("@agent-continuity/core");
      const local = createWorkspace({ config: resolveConfig() });
      try {
        const result = local.transfer.importWorkspace(document, { acceptLocalPaths: options.acceptLocalPaths });
        printJson(result);
      } finally { local.close(); }
    });

  program
    .command("search <query>")
    .description("Search projects, tasks, contexts and durable workspace records")
    .option("--project <project>", "Restrict results to one project")
    .option("--task <task>", "Restrict results to one task")
    .option("--type <type>", "Restrict by source type (repeatable)", collect, [])
    .option("--limit <count>", "Maximum results", (value) => Number.parseInt(value, 10), 20)
    .option("--json", "Output JSON")
    .action(async function (
      this: Command,
      query: string,
      options: {
        project?: string;
        task?: string;
        type: string[];
        limit: number;
        json?: boolean;
      },
    ) {
      const response = await clientFor(this).search({
        q: query,
        ...(options.project ? { project: options.project } : {}),
        ...(options.task ? { task: options.task } : {}),
        ...(options.type.length > 0
          ? {
              type: options.type as import("@agent-continuity/contracts").SearchSourceType[],
            }
          : {}),
        limit: options.limit,
      });
      if (options.json) return printJson(response);
      print(searchOutput(response));
    });

  // ------------------------------------------------------------------- projects

  const project = program.command("project").description("Manage projects");

  project
    .command("create")
    .description("Create a project")
    .requiredOption("--name <name>", "Project name")
    .option("--objective <objective>", "Intended outcome")
    .option("--description <description>", "Human readable description")
    .option("--context <context>", "Persistent project context")
    .option("--context-file <path>", "Read project context from a file")
    .action(async function (this: Command, options: Record<string, string | undefined>) {
      const created = await clientFor(this).projects.create({
        name: options.name as string,
        objective: options.objective ?? null,
        description: options.description ?? null,
        context: readText(options.context, options.contextFile) ?? null,
        ...actorFor(this),
      });
      print(projectDetail(created));
    });

  project
    .command("bootstrap")
    .description("Create a project, tasks, dependencies, decisions and links from a JSON plan")
    .requiredOption("--file <path>", "Path to a bootstrap request JSON file, or - for stdin")
    .option("--json", "Print the raw response")
    .action(async function (this: Command, options: { file: string; json?: boolean }) {
      const plan = JSON.parse(readFileSync(options.file === "-" ? 0 : options.file, "utf8"));
      const result = await clientFor(this).projects.bootstrap({ ...plan, ...actorFor(this) });
      if (options.json) return printJson(result);
      print(projectDetail(result.project));
      print("");
      for (const task of result.tasks) print(taskLine(task));
      print("");
      for (const [ref, key] of Object.entries(result.refMap)) print(`${ref} -> ${key}`);
    });

  project
    .command("list")
    .description("List projects")
    .addOption(
      new Option("--status <status>", "Filter by status").choices([
        "active",
        "paused",
        "completed",
        "archived",
      ]),
    )
    .option("--search <text>", "Free text search")
    .option("--all", "Include archived projects")
    .option("--json", "Output JSON")
    .action(async function (
      this: Command,
      options: { status?: string; search?: string; all?: boolean; json?: boolean },
    ) {
      const page = await clientFor(this).projects.list({
        ...(options.status
          ? { status: [options.status as ProjectStatus] }
          : options.all
            ? {}
            : { status: ["active", "paused", "completed"] as ProjectStatus[] }),
        ...(options.search ? { search: options.search } : {}),
      });
      if (options.json) return printJson(page);
      if (page.projects.length === 0) return print("No projects.");
      print(page.projects.map(projectLine).join("\n\n"));
    });

  project
    .command("show <project>")
    .description("Show a project")
    .option("--json", "Output JSON")
    .action(async function (this: Command, ref: string, options: { json?: boolean }) {
      const detail = await clientFor(this).projects.get(ref);
      if (options.json) return printJson(detail);
      print(projectDetail(detail));
      if (detail.decisions.length > 0) {
        print(`\nRecent decisions\n${detail.decisions.map((d) => `  ${d.key}  ${d.title}`).join("\n")}`);
      }
      if (detail.links.length > 0) {
        print(`\nLinks\n${detail.links.map((link) => `  ${linkLine(link)}`).join("\n")}`);
      }
    });

  project
    .command("context <project>")
    .description("Show, replace, inspect or revert versioned project context")
    .option("--set <text>", "Replace the context with this text")
    .option("--file <path>", "Replace the context with the contents of a file, or - for stdin")
    .option("--expected-version <version>", "Required current version for replace/revert", Number)
    .option("--reason <reason>", "Why this replacement or revert is being made")
    .option("--history", "List bounded context-version metadata")
    .option("--version <version>", "Get one historical context version", Number)
    .option("--revert <version>", "Revert by appending the selected version", Number)
    .option("--limit <count>", "History page size", Number, 20)
    .option("--before-version <version>", "List versions older than this version", Number)
    .option("--json", "Output JSON")
    .action(async function (
      this: Command,
      ref: string,
      options: {
        set?: string;
        file?: string;
        expectedVersion?: number;
        reason?: string;
        history?: boolean;
        version?: number;
        revert?: number;
        limit: number;
        beforeVersion?: number;
        json?: boolean;
      },
    ) {
      const client = clientFor(this);
      const next = readText(options.set, options.file);

      if (next !== undefined) {
        if (options.expectedVersion === undefined) {
          throw new Error("--expected-version is required when replacing context.");
        }
        const updated = await client.projects.updateContext(ref, {
          context: next,
          expectedVersion: options.expectedVersion,
          ...(options.reason ? { reason: options.reason } : {}),
          ...actorFor(this),
        });
        return options.json
          ? printJson({
              context: updated.context,
              contextVersion: updated.contextVersion,
              contextSize: updated.contextSize,
            })
          : print(
              `Updated context for ${updated.key} to v${updated.contextVersion} (${contextSizeText(
                updated.contextSize,
              )}).`,
            );
      }
      if (options.revert !== undefined) {
        if (options.expectedVersion === undefined) {
          throw new Error("--expected-version is required when reverting context.");
        }
        const updated = await client.projects.revertContext(ref, {
          targetVersion: options.revert,
          expectedVersion: options.expectedVersion,
          ...(options.reason ? { reason: options.reason } : {}),
          ...actorFor(this),
        });
        return options.json
          ? printJson(updated)
          : print(`Reverted ${updated.key} context as new version v${updated.contextVersion}.`);
      }
      if (options.history) {
        const page = await client.projects.listContextVersions(ref, {
          limit: options.limit,
          ...(options.beforeVersion ? { beforeVersion: options.beforeVersion } : {}),
        });
        return options.json ? printJson(page) : print(contextHistoryOutput(page));
      }
      if (options.version !== undefined) {
        const version = await client.projects.getContextVersion(ref, options.version);
        return options.json ? printJson(version) : print(contextVersionOutput(version));
      }

      const detail = await client.projects.get(ref);
      if (options.json) {
        return printJson({
          context: detail.context,
          contextVersion: detail.contextVersion,
          contextSize: detail.contextSize,
        });
      }
      print(
        `Current context v${detail.contextVersion} · ${contextSizeText(detail.contextSize)}\n\n${
          detail.context ?? "(no project context recorded)"
        }`,
      );
    });

  project
    .command("archive <project>")
    .description("Archive a project")
    .action(async function (this: Command, ref: string) {
      const archived = await clientFor(this).projects.archive(ref, actorFor(this).actor);
      print(`Archived ${archived.key}.`);
    });

  project
    .command("delete <project>")
    .description("Permanently delete a project and everything it owns")
    .option("--force", "Delete even when one of its tasks is actively claimed")
    .option("--yes", "Skip the confirmation summary")
    .action(async function (this: Command, ref: string, options: { force?: boolean; yes?: boolean }) {
      const client = clientFor(this);

      if (!options.yes) {
        // Show what will go before it goes, since there is no undo.
        const detail = await client.projects.get(ref);
        print(`${detail.key} — ${detail.name} (${detail.status})`);
        print(
          `  ${detail.taskTotal} tasks · ${detail.decisions.length} decisions · ${detail.links.length} links`,
        );
        print("  This cannot be undone. Re-run with --yes to confirm.");
        return;
      }

      const deleted = await client.projects.remove(ref, {
        force: options.force ?? false,
        ...actorFor(this),
      });
      print(`Deleted ${deleted.key} — ${deleted.name}.`);
      const { removed } = deleted;
      print(
        `  removed ${removed.tasks} tasks, ${removed.acceptanceCriteria} criteria, ` +
          `${removed.progress} progress entries, ${removed.blockers} blockers, ${removed.claims} claims, ` +
          `${removed.dependencies} dependencies, ${removed.decisions} decisions, ${removed.links} links, ` +
          `${removed.repositories} repositories, ${removed.executionWorktrees} execution worktrees, ` +
          `${removed.activityEvents} activity events`,
      );
    });

  // --------------------------------------------------------------- repositories

  const repository = program.command("repository").description("Manage explicit local repositories");

  repository
    .command("add <project>")
    .description("Associate a project with a canonical local repository root")
    .requiredOption("--label <label>", "Human-readable repository label")
    .requiredOption("--path <path>", "Absolute local repository root")
    .option("--remote <url>", "Optional remote URL metadata")
    .option("--primary", "Make this the project's primary repository")
    .option("--json", "Output JSON")
    .action(async function (
      this: Command,
      projectRef: string,
      options: { label: string; path: string; remote?: string; primary?: boolean; json?: boolean },
    ) {
      const result = await clientFor(this).repositories.create(projectRef, {
        label: options.label,
        rootPath: options.path,
        ...(options.remote ? { remoteUrl: options.remote } : {}),
        ...(options.primary ? { primary: true } : {}),
        ...actorFor(this),
      });
      return options.json ? printJson(result) : print(repositoryLine(result));
    });

  repository
    .command("list <project>")
    .description("List a project's explicit repository associations")
    .option("--json", "Output JSON")
    .action(async function (this: Command, projectRef: string, options: { json?: boolean }) {
      const repositories = await clientFor(this).repositories.list(projectRef);
      if (options.json) return printJson(repositories);
      print(
        repositories.length === 0
          ? "No repositories associated."
          : repositories.map(repositoryLine).join("\n\n"),
      );
    });

  repository
    .command("show <project> <repository>")
    .description("Show one explicit repository association")
    .option("--json", "Output JSON")
    .action(async function (
      this: Command,
      projectRef: string,
      repositoryRef: string,
      options: { json?: boolean },
    ) {
      const result = await clientFor(this).repositories.get(projectRef, repositoryRef);
      return options.json ? printJson(result) : print(repositoryLine(result));
    });

  repository
    .command("update <project> <repository>")
    .description("Update label, root, remote metadata or primary selection")
    .option("--label <label>")
    .option("--path <path>", "New absolute local repository root")
    .option("--remote <url>", "New remote URL metadata")
    .option("--clear-remote", "Remove remote URL metadata")
    .option("--primary", "Transfer primary selection to this repository")
    .option("--json", "Output JSON")
    .action(async function (
      this: Command,
      projectRef: string,
      repositoryRef: string,
      options: {
        label?: string;
        path?: string;
        remote?: string;
        clearRemote?: boolean;
        primary?: boolean;
        json?: boolean;
      },
    ) {
      if (options.remote && options.clearRemote) {
        throw new Error("--remote and --clear-remote cannot be used together.");
      }
      const result = await clientFor(this).repositories.update(projectRef, repositoryRef, {
        ...(options.label ? { label: options.label } : {}),
        ...(options.path ? { rootPath: options.path } : {}),
        ...(options.remote ? { remoteUrl: options.remote } : {}),
        ...(options.clearRemote ? { remoteUrl: null } : {}),
        ...(options.primary ? { primary: true } : {}),
        ...actorFor(this),
      });
      return options.json ? printJson(result) : print(repositoryLine(result));
    });

  repository
    .command("remove <project> <repository>")
    .description("Remove an association; running execution bindings always prevent removal")
    .option("--force", "Explicitly remove bindings belonging to ended executions")
    .action(async function (
      this: Command,
      projectRef: string,
      repositoryRef: string,
      options: { force?: boolean },
    ) {
      const removed = await clientFor(this).repositories.remove(projectRef, repositoryRef, {
        force: options.force ?? false,
        ...actorFor(this),
      });
      print(
        `Removed ${removed.key} — ${removed.label}` +
          (removed.removedWorktreeBindings
            ? ` and ${removed.removedWorktreeBindings} ended execution binding(s).`
            : "."),
      );
    });

  // ---------------------------------------------------------------------- tasks

  const task = program.command("task").description("Manage tasks");

  task
    .command("create <project>")
    .description("Create a task")
    .requiredOption("--title <title>", "Task title")
    .option("--description <description>")
    .option("--context <context>")
    .addOption(
      new Option("--status <status>").choices([
        "backlog",
        "ready",
        "in_progress",
        "blocked",
        "review",
        "done",
      ]),
    )
    .addOption(new Option("--priority <priority>").choices(["low", "normal", "high", "critical"]))
    .option("--parent <task>", "Parent task key")
    .option("--criterion <text>", "Acceptance criterion (repeatable)", collect, [])
    .option("--depends-on <task>", "Dependency task key (repeatable)", collect, [])
    .action(async function (this: Command, ref: string, options: Record<string, any>) {
      const created = await clientFor(this).tasks.create(ref, {
        title: options.title,
        description: options.description ?? null,
        context: options.context ?? null,
        ...(options.status ? { status: options.status as TaskStatus } : {}),
        ...(options.priority ? { priority: options.priority as TaskPriority } : {}),
        ...(options.parent ? { parentTask: options.parent } : {}),
        ...(options.criterion.length > 0 ? { acceptanceCriteria: options.criterion } : {}),
        ...(options.dependsOn.length > 0 ? { dependencies: options.dependsOn } : {}),
        ...actorFor(this),
      });
      print(taskLine(created));
    });

  task
    .command("list <project>")
    .description("List project tasks")
    .option("--status <status>", "Filter by status (repeatable)", collect, [])
    .option("--priority <priority>", "Filter by priority (repeatable)", collect, [])
    .option("--actionable", "Only tasks that are ready, unblocked and dependency-free")
    .option("--claimed", "Only tasks with an active claim")
    .option("--blocked", "Only tasks with active blockers")
    .option("--search <text>")
    .option("--json", "Output JSON")
    .action(async function (this: Command, ref: string, options: Record<string, any>) {
      const tasks = await clientFor(this).tasks.list(ref, {
        ...(options.status.length > 0 ? { status: options.status as TaskStatus[] } : {}),
        ...(options.priority.length > 0 ? { priority: options.priority as TaskPriority[] } : {}),
        ...(options.actionable ? { actionable: true } : {}),
        ...(options.claimed ? { claimed: true } : {}),
        ...(options.blocked ? { blocked: true } : {}),
        ...(options.search ? { search: options.search } : {}),
      });
      if (options.json) return printJson(tasks);
      if (tasks.length === 0) return print("No tasks match.");
      print(tasks.map(taskLine).join("\n"));
    });

  task
    .command("show <task>")
    .description("Show the full working state of a task")
    .option("--json", "Output JSON")
    .action(async function (this: Command, ref: string, options: { json?: boolean }) {
      const detail = await clientFor(this).tasks.get(ref);
      return options.json ? printJson(detail) : print(taskDetail(detail));
    });

  task
    .command("context <task>")
    .description("Show, replace, inspect or revert versioned task context")
    .option("--set <text>")
    .option("--file <path>")
    .option("--expected-version <version>", "Required current version for replace/revert", Number)
    .option("--reason <reason>")
    .option("--history")
    .option("--version <version>", "Get one historical context version", Number)
    .option("--revert <version>", "Revert by appending the selected version", Number)
    .option("--limit <count>", "History page size", Number, 20)
    .option("--before-version <version>", "List versions older than this version", Number)
    .option("--json", "Output JSON")
    .action(async function (
      this: Command,
      ref: string,
      options: {
        set?: string;
        file?: string;
        expectedVersion?: number;
        reason?: string;
        history?: boolean;
        version?: number;
        revert?: number;
        limit: number;
        beforeVersion?: number;
        json?: boolean;
      },
    ) {
      const client = clientFor(this);
      const next = readText(options.set, options.file);
      if (next !== undefined) {
        if (options.expectedVersion === undefined) {
          throw new Error("--expected-version is required when replacing context.");
        }
        const updated = await client.tasks.updateContext(ref, {
          context: next,
          expectedVersion: options.expectedVersion,
          ...(options.reason ? { reason: options.reason } : {}),
          ...actorFor(this),
        });
        return options.json
          ? printJson(updated)
          : print(
              `Updated context for ${updated.key} to v${updated.contextVersion} (${contextSizeText(
                updated.contextSize,
              )}).`,
            );
      }
      if (options.revert !== undefined) {
        if (options.expectedVersion === undefined) {
          throw new Error("--expected-version is required when reverting context.");
        }
        const updated = await client.tasks.revertContext(ref, {
          targetVersion: options.revert,
          expectedVersion: options.expectedVersion,
          ...(options.reason ? { reason: options.reason } : {}),
          ...actorFor(this),
        });
        return options.json
          ? printJson(updated)
          : print(`Reverted ${updated.key} context as new version v${updated.contextVersion}.`);
      }
      if (options.history) {
        const page = await client.tasks.listContextVersions(ref, {
          limit: options.limit,
          ...(options.beforeVersion ? { beforeVersion: options.beforeVersion } : {}),
        });
        return options.json ? printJson(page) : print(contextHistoryOutput(page));
      }
      if (options.version !== undefined) {
        const version = await client.tasks.getContextVersion(ref, options.version);
        return options.json ? printJson(version) : print(contextVersionOutput(version));
      }
      const detail = await client.tasks.get(ref);
      return options.json
        ? printJson({
            context: detail.context,
            contextVersion: detail.contextVersion,
            contextSize: detail.contextSize,
          })
        : print(
            `Current context v${detail.contextVersion} · ${contextSizeText(
              detail.contextSize,
            )}\n\n${detail.context ?? "(no task context recorded)"}`,
          );
    });

  task
    .command("claim <task>")
    .description("Claim a task before beginning work")
    .option("--ttl <minutes>", "Lease duration", (value) => Number.parseInt(value, 10))
    .action(async function (this: Command, ref: string, options: { ttl?: number }) {
      const meta = actorFor(this);
      const actor = meta.actor ?? "cli";
      const result = await clientFor(this).tasks.claim(ref, {
        actor,
        ...(meta.sessionId ? { sessionId: meta.sessionId } : {}),
        ...(options.ttl ? { ttlMinutes: options.ttl } : {}),
      });
      print(
        `Claimed ${result.task.key} for ${actor}. Lease expires in ${result.claim.expiresInMinutes} minutes.`,
      );
    });

  task
    .command("start <task>")
    .description("Claim or resume eligible work and return its complete execution context")
    .option("--ttl <minutes>", "Lease duration", (value) => Number.parseInt(value, 10))
    .option("--repository <repository>", "Repository key to bind atomically at start")
    .option("--worktree <path>", "Absolute worktree path to bind atomically at start")
    .option("--branch <branch>", "Branch label recorded with the worktree")
    .option("--json", "Output JSON")
    .action(async function (
      this: Command,
      ref: string,
      options: {
        ttl?: number;
        repository?: string;
        worktree?: string;
        branch?: string;
        json?: boolean;
      },
    ) {
      if (Boolean(options.repository) !== Boolean(options.worktree)) {
        throw new Error("--repository and --worktree must be supplied together.");
      }
      const meta = workflowIdentityFor(this);
      const result = await clientFor(this).tasks.startWork(ref, {
        ...meta,
        ...(options.ttl ? { ttlMinutes: options.ttl } : {}),
        ...(options.repository && options.worktree
          ? {
              worktree: {
                repository: options.repository,
                worktreePath: options.worktree,
                ...(options.branch ? { branch: options.branch } : {}),
              },
            }
          : {}),
      });
      if (options.json) return printJson(result);
      print(
        [
          `Started ${result.task.key} for ${result.task.claim?.actor ?? meta.actor}.`,
          `Project context: ${result.project.context ?? "none"}`,
          `Task context: ${result.task.context ?? "none"}`,
          `Dependencies: ${result.task.dependencies.map((item) => item.key).join(", ") || "none"}`,
          `Blockers: ${result.task.activeBlockers.map((item) => item.key).join(", ") || "none"}`,
          `Resume: ${result.execution.handoff?.nextAction ?? "new execution"}`,
        ].join("\n"),
      );
    });

  task
    .command("release <task>")
    .description("Release your claim on a task")
    .option("--reason <reason>")
    .option("--force", "Release a claim held by another agent")
    .action(async function (this: Command, ref: string, options: { reason?: string; force?: boolean }) {
      const meta = actorFor(this);
      const result = await clientFor(this).tasks.releaseClaim(ref, {
        ...(options.reason ? { reason: options.reason } : {}),
        ...(options.force ? {} : meta),
      });
      print(`Released the claim on ${result.task.key}.`);
    });

  task
    .command("progress <task> [content]")
    .description("Record a meaningful progress milestone, or list existing progress")
    .option("--json", "Output JSON")
    .action(async function (
      this: Command,
      ref: string,
      content: string | undefined,
      options: { json?: boolean },
    ) {
      const client = clientFor(this);
      if (content) {
        const entry = await client.tasks.addProgress(ref, { content, ...actorFor(this) });
        return print(`Recorded progress on ${entry.taskKey}.`);
      }
      const entries = await client.tasks.listProgress(ref);
      if (options.json) return printJson(entries);
      print(entries.length === 0 ? "No progress recorded." : entries.map(progressLine).join("\n"));
    });

  task
    .command("report <task>")
    .description("Refresh liveness and optionally record phase, progress and a checkpoint atomically")
    .option("--phase <phase>")
    .option("--progress <text>")
    .option("--completed <text>")
    .option("--working-on <text>")
    .option("--next <text>")
    .option("--uncertainty <text>")
    .option("--json", "Output JSON")
    .action(async function (
      this: Command,
      ref: string,
      options: {
        phase?: string;
        progress?: string;
        completed?: string;
        workingOn?: string;
        next?: string;
        uncertainty?: string;
        json?: boolean;
      },
    ) {
      const checkpoint = checkpointFor(options);
      const meta = workflowIdentityFor(this);
      const result = await clientFor(this).tasks.report(ref, {
        ...meta,
        ...(options.phase ? { phase: options.phase } : {}),
        ...(options.progress ? { progress: options.progress } : {}),
        ...(checkpoint ? { checkpoint } : {}),
      });
      if (options.json) return printJson(result);
      print(
        `Report recorded for ${result.claim.taskKey}` +
          `${result.progress ? " with progress" : ""}` +
          `${result.checkpoint ? " and checkpoint" : ""}.`,
      );
    });

  task
    .command("handoff <task>")
    .description("Record a final checkpoint and safely release the current claim")
    .requiredOption("--completed <text>")
    .requiredOption("--working-on <text>")
    .requiredOption("--next <text>")
    .option("--uncertainty <text>")
    .option("--reason <reason>", "Why this execution is ending", "handoff")
    .option("--phase <phase>", "Final execution phase")
    .option("--json", "Output JSON")
    .action(async function (
      this: Command,
      ref: string,
      options: {
        completed: string;
        workingOn: string;
        next: string;
        uncertainty?: string;
        reason: string;
        phase?: string;
        json?: boolean;
      },
    ) {
      const meta = workflowIdentityFor(this);
      const result = await clientFor(this).tasks.handoff(ref, {
        ...meta,
        reason: options.reason,
        ...(options.phase ? { phase: options.phase } : {}),
        checkpoint: {
          completed: options.completed,
          workingOn: options.workingOn,
          next: options.next,
          ...(options.uncertainty ? { uncertainty: options.uncertainty } : {}),
        },
      });
      if (options.json) return printJson(result);
      print(`Handed off ${result.releasedClaim.taskKey}. Next: ${result.handoff.nextAction ?? "none"}.`);
    });

  task
    .command("heartbeat <task>")
    .description("Silently refresh execution liveness; this does not add a progress entry")
    .option("--phase <phase>", "Current implementation phase")
    .action(async function (this: Command, ref: string, options: { phase?: string }) {
      const meta = actorFor(this);
      const result = await clientFor(this).tasks.heartbeat(ref, {
        actor: meta.actor ?? "cli",
        ...(meta.sessionId ? { sessionId: meta.sessionId } : {}),
        ...(options.phase ? { phase: options.phase } : {}),
      });
      print(`Heartbeat recorded${result.execution?.health ? ` (${result.execution.health})` : ""}.`);
    });

  task
    .command("execution <task>")
    .description("Show execution health, checkpoints, work plan and handoff")
    .option("--json", "Output JSON")
    .action(async function (this: Command, ref: string, options: { json?: boolean }) {
      const state = await clientFor(this).tasks.execution(ref);
      if (options.json) return printJson(state);
      print([
        `Execution: ${state.execution ? `${state.execution.actor} — ${state.execution.health}` : "none"}`,
        `Checkpoints: ${state.checkpoints.length}`,
        `Work plan: ${state.workPlan.map((item) => `[${item.status}] ${item.title}`).join(" · ") || "none"}`,
        `Handoff: ${state.handoff?.summary ?? "none"}`,
        `Path ownership: ${state.ownership ? `${state.ownership.paths.length} paths (revision ${state.ownership.version})` : "none"}`,
        `Path collisions: ${state.collisions.length}`,
        ...provenanceLines(state.provenance),
      ].join("\n"));
    });

  task
    .command("ownership <task>")
    .description("Show or replace repository-relative file/directory ownership declarations")
    .option("--file <path>", "Declare an exact file path (repeatable)", collectOption, [])
    .option("--directory <path>", "Declare a directory prefix (repeatable)", collectOption, [])
    .option("--clear", "Replace the current declaration with an empty revision")
    .option("--json", "Output JSON")
    .action(async function (
      this: Command,
      ref: string,
      options: { file: string[]; directory: string[]; clear?: boolean; json?: boolean },
    ) {
      if (options.clear && (options.file.length > 0 || options.directory.length > 0)) {
        throw new Error("--clear cannot be combined with --file or --directory.");
      }
      const client = clientFor(this);
      const mutating =
        options.clear || options.file.length > 0 || options.directory.length > 0;
      const result = mutating
        ? await client.tasks.replacePathOwnership(ref, {
            paths: [
              ...options.file.map((path) => ({ path, kind: "file" as const })),
              ...options.directory.map((path) => ({ path, kind: "directory" as const })),
            ],
            ...executionIdentityFor(this),
          })
        : await client.tasks.pathOwnership(ref);
      if (options.json) return printJson(result);
      print(
        [
          `Revision: ${result.ownership?.version ?? "none"}`,
          `Paths:\n${
            result.ownership?.paths.length
              ? result.ownership.paths
                  .map((entry) => `  ${entry.kind}: ${entry.path}`)
                  .join("\n")
              : "  none"
          }`,
          `Live collision advisories: ${result.collisions.length}`,
          ...result.collisions.map((collision) => {
            const overlap = collision.overlaps[0];
            return `  ${collision.strength} — ${collision.counterpart.taskKey} (${collision.worktreeRelation})${
              overlap
                ? `: ${overlap.taskPath} [${overlap.taskSource}] ↔ ${overlap.counterpartPath} [${overlap.counterpartSource}]`
                : ""
            }`;
          }),
        ].join("\n"),
      );
    });

  task
    .command("provenance <task>")
    .description("Show or manually capture derived Git provenance for the execution worktree")
    .option("--capture", "Capture a read-only snapshot from the stored worktree binding")
    .option("--json", "Output JSON")
    .action(async function (
      this: Command,
      ref: string,
      options: { capture?: boolean; json?: boolean },
    ) {
      const client = clientFor(this);
      if (options.capture) {
        await client.tasks.captureGitProvenance(ref);
      }
      const provenance = await client.tasks.gitProvenance(ref);
      if (options.json) return printJson(provenance);
      print(provenanceLines(provenance).join("\n"));
    });

  task
    .command("worktree <task>")
    .description("Show, bind or unbind the running execution's explicit worktree")
    .option("--repository <repository>", "Repository key to bind")
    .option("--path <path>", "Absolute worktree path to bind")
    .option("--branch <branch>", "Branch label to record")
    .option("--clear", "Remove the running execution's worktree binding")
    .option("--json", "Output JSON")
    .action(async function (
      this: Command,
      ref: string,
      options: {
        repository?: string;
        path?: string;
        branch?: string;
        clear?: boolean;
        json?: boolean;
      },
    ) {
      if (options.clear && (options.repository || options.path || options.branch)) {
        throw new Error("--clear cannot be combined with binding options.");
      }
      if (Boolean(options.repository) !== Boolean(options.path)) {
        throw new Error("--repository and --path must be supplied together.");
      }
      const client = clientFor(this);
      const result = options.clear
        ? await client.tasks.unbindWorktree(ref, executionIdentityFor(this))
        : options.repository && options.path
          ? await client.tasks.bindWorktree(ref, {
              repository: options.repository,
              worktreePath: options.path,
              ...(options.branch ? { branch: options.branch } : {}),
              ...executionIdentityFor(this),
            })
          : await client.tasks.executionWorktree(ref);
      if (options.json) return printJson(result);
      print(
        [
          `${result.repositoryKey} — ${result.repositoryLabel}`,
          `Worktree: ${result.worktreePath}`,
          `Repository-relative: ${result.relativePath ?? "external linked worktree"}`,
          `Branch: ${result.branch ?? "not recorded"}`,
          `Availability: ${result.availability.status}`,
        ].join("\n"),
      );
    });

  task
    .command("checkpoint <task>")
    .description("Record a meaningful completed / working-on / next checkpoint")
    .requiredOption("--completed <text>")
    .requiredOption("--working-on <text>")
    .requiredOption("--next <text>")
    .option("--uncertainty <text>")
    .action(async function (this: Command, ref: string, options: { completed: string; workingOn: string; next: string; uncertainty?: string }) {
      await clientFor(this).tasks.checkpoint(ref, { completed: options.completed, workingOn: options.workingOn, next: options.next, ...(options.uncertainty ? { uncertainty: options.uncertainty } : {}), ...actorFor(this) });
      print(`Checkpoint recorded for ${ref}.`);
    });

  task
    .command("plan <task> [items...]")
    .description("Show/set a lightweight work plan, or update an item status")
    .option("--item <item>", "Work-plan item key")
    .option("--status <status>", "pending, active, completed, or skipped")
    .option("--json", "Output JSON")
    .action(async function (this: Command, ref: string, items: string[], options: { item?: string; status?: "pending" | "active" | "completed" | "skipped"; json?: boolean }) {
      const client = clientFor(this);
      const result = items.length > 0
        ? await client.tasks.setWorkPlan(ref, { items, ...actorFor(this) })
        : options.item && options.status
          ? [await client.tasks.updateWorkPlanItem(ref, options.item, { status: options.status, ...actorFor(this) })]
          : await client.tasks.workPlan(ref);
      if (options.json) return printJson(result);
      print(result.length === 0 ? "No work plan." : result.map((item) => `[${item.status}] ${item.title}`).join("\n"));
    });

  task
    .command("evidence <task> <criterion>")
    .description("List or attach proof for an acceptance criterion")
    .option("--kind <kind>", "commit, test, file, url, result, or note")
    .option("--reference <reference>")
    .option("--content <content>")
    .option("--url <url>")
    .option("--summary <summary>")
    .option("--name <name>")
    .option("--outcome <outcome>", "passed, failed, or informational")
    .option("--path <path>")
    .option("--repository <repository>")
    .option("--sha <sha>")
    .option("--execution-id <id>")
    .option("--worktree-id <id>")
    .option("--json", "Output JSON")
    .action(async function (this: Command, ref: string, criterion: string, options: {
      kind?: "commit" | "test" | "file" | "url" | "result" | "note";
      reference?: string; content?: string; url?: string; summary?: string; name?: string;
      outcome?: "passed" | "failed" | "informational"; path?: string; repository?: string;
      sha?: string; executionId?: string; worktreeId?: string; json?: boolean;
    }) {
      const client = clientFor(this);
      const id = await criterionId(client, ref, criterion);
      if (options.kind) {
        const scope = options.repository
          ? {
              repository: options.repository,
              ...(options.sha ? { sha: options.sha } : {}),
              ...(options.executionId ? { executionId: options.executionId } : {}),
              ...(options.worktreeId ? { worktreeId: options.worktreeId } : {}),
            }
          : undefined;
        let input: CriterionEvidenceInput;
        if (options.kind === "commit") {
          if (!scope?.sha) throw new Error("Commit evidence requires --repository and --sha.");
          input = { kind: "commit", scope: { ...scope, sha: scope.sha }, ...(options.summary ? { summary: options.summary } : {}), ...actorFor(this) };
        } else if (options.kind === "test") {
          if (!options.name || !options.outcome) throw new Error("Test evidence requires --name and --outcome.");
          input = { kind: "test", name: options.name, outcome: options.outcome, ...(options.reference ? { reference: options.reference } : {}), ...(options.summary ? { summary: options.summary } : {}), ...(scope ? { scope } : {}), ...actorFor(this) };
        } else if (options.kind === "file") {
          if (!options.path) throw new Error("File evidence requires --path.");
          input = { kind: "file", path: options.path, ...(options.summary ? { description: options.summary } : {}), ...(scope ? { scope } : {}), ...actorFor(this) };
        } else if (options.kind === "url") {
          if (!options.url) throw new Error("URL evidence requires --url.");
          input = { kind: "url", url: options.url, ...(options.name ? { title: options.name } : {}), ...(options.summary ? { summary: options.summary } : {}), ...actorFor(this) };
        } else if (options.kind === "result") {
          if (!options.summary || !options.outcome) throw new Error("Result evidence requires --summary and --outcome.");
          input = { kind: "result", summary: options.summary, outcome: options.outcome, ...actorFor(this) };
        } else {
          if (!options.content) throw new Error("Note evidence requires --content.");
          input = { kind: "note", content: options.content, ...actorFor(this) };
        }
        await client.tasks.addCriterionEvidence(ref, id, input);
      }
      const evidence = await client.tasks.criterionEvidence(ref, id);
      if (options.json) return printJson(evidence);
      print(evidence.length === 0 ? "No evidence." : evidence.map(evidenceLine).join("\n"));
    });

  task
    .command("evidence-policy <task> <criterion>")
    .description("Read, set, or clear the optional completion evidence requirement")
    .option("--minimum-count <count>", "Required qualifying record count", Number)
    .option("--kind <kind>", "Qualifying kind; repeatable", collectOption, [])
    .option("--require-sha")
    .option("--require-passing-verification")
    .option("--clear")
    .option("--json", "Output JSON")
    .action(async function (this: Command, ref: string, criterion: string, options: {
      minimumCount?: number; kind: Array<"commit" | "test" | "file" | "url" | "result" | "note">;
      requireSha?: boolean; requirePassingVerification?: boolean; clear?: boolean; json?: boolean;
    }) {
      const client = clientFor(this);
      const id = await criterionId(client, ref, criterion);
      const policy = options.clear
        ? await client.tasks.clearCriterionEvidencePolicy(ref, id, actorFor(this))
        : options.minimumCount !== undefined || options.kind.length > 0
          ? await client.tasks.setCriterionEvidencePolicy(ref, id, {
              minimumCount: options.minimumCount ?? 1,
              qualifyingKinds: options.kind,
              requireSha: options.requireSha ?? false,
              requirePassingVerification: options.requirePassingVerification ?? false,
              ...actorFor(this),
            })
          : await client.tasks.criterionEvidencePolicy(ref, id);
      if (options.json) return printJson(policy);
      print(policy ? JSON.stringify(policy, null, 2) : "No evidence policy.");
    });

  task
    .command("verify <task> <criterion> <executable>")
    .description("Run a bounded local verification in the task's stored execution worktree and persist test evidence")
    .option("--arg <value>", "Executable argument; repeatable", collectOption, [])
    .option("--cwd <path>", "Repository-relative directory inside the stored worktree")
    .option("--timeout-ms <milliseconds>", "Timeout from 1000 to 900000", Number)
    .option("--output-limit-bytes <bytes>", "Retained stdout/stderr tail per stream, up to 1048576", Number)
    .option("--name <name>", "Evidence test name")
    .option("--json", "Output JSON")
    .action(async function (this: Command, ref: string, criterion: string, executable: string, options: {
      arg: string[]; cwd?: string; timeoutMs?: number; outputLimitBytes?: number; name?: string; json?: boolean;
    }) {
      const client = clientFor(this);
      const id = await criterionId(client, ref, criterion);
      const worktree = await client.tasks.executionWorktree(ref);
      const result = await runLocalVerification({
        worktreePath: worktree.worktreePath,
        executable,
        args: options.arg,
        name: options.name ?? [executable, ...options.arg].join(" "),
        ...(options.cwd ? { cwd: options.cwd } : {}),
        ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
        ...(options.outputLimitBytes !== undefined ? { outputLimitBytes: options.outputLimitBytes } : {}),
      });
      const sha = result.revisionStable ? result.startSha : null;
      const evidence = await client.tasks.addCriterionEvidence(ref, id, {
        kind: "test",
        name: result.name,
        outcome: result.outcome === "passed" ? "passed" : "failed",
        summary: `Local verification ${result.outcome}; exit=${result.exitCode ?? "none"}; stdout=${result.stdoutBytes}B; stderr=${result.stderrBytes}B.`,
        verification: result,
        scope: {
          repository: worktree.repositoryKey,
          executionId: worktree.executionId,
          worktreeId: worktree.id,
          ...(sha ? { sha } : {}),
        },
        ...actorFor(this),
      });
      if (options.json) printJson({ evidence, verification: result });
      else {
        print([
          `${result.outcome}: ${result.name}`,
          `exit=${result.exitCode ?? "none"} signal=${result.signal ?? "none"} duration=${result.durationMs}ms`,
          `stdout=${result.stdoutBytes}B${result.stdoutTruncated ? " (tail truncated)" : ""}`,
          `stderr=${result.stderrBytes}B${result.stderrTruncated ? " (tail truncated)" : ""}`,
          `revision=${result.revisionStable ? result.startSha : `${result.startSha ?? "unknown"} -> ${result.endSha ?? "unknown"} (changed)`}`,
          `dirty=${String(result.startDirty)} -> ${String(result.endDirty)}`,
          result.stdoutTail ? `stdout tail:\n${result.stdoutTail}` : "",
          result.stderrTail ? `stderr tail:\n${result.stderrTail}` : "",
        ].filter(Boolean).join("\n"));
      }
      if (result.outcome !== "passed") {
        process.exitCode = result.outcome === "timed_out" ? 124 : result.outcome === "spawn_error" ? 127 : 1;
      }
    });

  program
    .command("attention")
    .description("List stale, blocked, review, or handed-off work needing attention")
    .option("--json", "Output JSON")
    .action(async function (this: Command, options: { json?: boolean }) {
      const items = await clientFor(this).attention.list();
      if (options.json) return printJson(items);
      print(items.length === 0 ? "No work needs attention." : items.map((item) => `${item.taskKey} — ${item.reason}: ${item.requiredAction}`).join("\n"));
    });

  task
    .command("block <task> <description>")
    .description("Record a blocker and move the task to blocked")
    .option("--required-action <action>", "What must happen to unblock the work")
    .action(async function (
      this: Command,
      ref: string,
      description: string,
      options: { requiredAction?: string },
    ) {
      const result = await clientFor(this).tasks.addBlocker(ref, {
        description,
        ...(options.requiredAction ? { requiredAction: options.requiredAction } : {}),
        ...actorFor(this),
      });
      print(`${result.task.key} is blocked by ${result.blocker.key}.`);
    });

  task
    .command("unblock <blocker> <resolution>")
    .description("Resolve a blocker by key")
    .action(async function (this: Command, blocker: string, resolution: string) {
      const result = await clientFor(this).blockers.resolve(blocker, {
        resolution,
        ...actorFor(this),
      });
      print(`Resolved ${result.blocker.key}. ${result.task.key} is now ${result.task.status}.`);
    });

  task
    .command("criteria <task> [criteria...]")
    .description("List acceptance criteria, or add new ones")
    .option("--complete <criterion>", "Mark a criterion complete (repeatable)", collect, [])
    .option("--reopen <criterion>", "Reopen a criterion (repeatable)", collect, [])
    .option("--json", "Output JSON")
    .action(async function (this: Command, ref: string, criteria: string[], options: Record<string, any>) {
      const client = clientFor(this);
      const meta = actorFor(this);

      if (criteria.length > 0) await client.tasks.addAcceptanceCriteria(ref, criteria, meta);
      for (const criterion of options.complete) {
        await client.acceptanceCriteria.complete(await criterionId(client, ref, criterion), meta);
      }
      for (const criterion of options.reopen) {
        await client.acceptanceCriteria.reopen(await criterionId(client, ref, criterion), meta);
      }

      const detail = await client.tasks.get(ref);
      if (options.json) return printJson(detail.acceptanceCriteria);
      print(
        detail.acceptanceCriteria.length === 0
          ? "No acceptance criteria."
          : detail.acceptanceCriteria
              .map((criterion) => `[${criterion.isComplete ? "x" : " "}] ${criterion.description}`)
              .join("\n"),
      );
    });

  task
    .command("depends <task> <dependsOn>")
    .description("Record that a task depends on another task")
    .option("--remove", "Remove the dependency instead")
    .action(async function (
      this: Command,
      ref: string,
      dependsOn: string,
      options: { remove?: boolean },
    ) {
      const client = clientFor(this);
      const updated = options.remove
        ? await client.tasks.removeDependency(ref, dependsOn)
        : await client.tasks.addDependency(ref, dependsOn);
      print(
        `${updated.key} ${options.remove ? "no longer depends on" : "now depends on"} ${dependsOn}.`,
      );
    });

  task
    .command("delete <task>")
    .description("Permanently delete a task and everything it owns")
    .option("--force", "Delete even when another agent holds an active claim")
    .option("--yes", "Skip the confirmation summary")
    .action(async function (this: Command, ref: string, options: { force?: boolean; yes?: boolean }) {
      const client = clientFor(this);

      if (!options.yes) {
        // Show what will go before it goes, since there is no undo.
        const detail = await client.tasks.get(ref);
        print(`${detail.key} — ${detail.title} (${detail.status})`);
        print(
          `  ${detail.acceptanceCriteria.length} acceptance criteria · ${detail.progress.length} progress entries · ` +
            `${detail.activeBlockers.length + detail.resolvedBlockers.length} blockers · ${detail.links.length} links`,
        );
        if (detail.dependents.length > 0) {
          print(`  depended on by ${detail.dependents.map((t) => t.key).join(", ")}`);
        }
        print("  This cannot be undone. Re-run with --yes to confirm.");
        return;
      }

      const deleted = await client.tasks.remove(ref, {
        force: options.force ?? false,
        ...actorFor(this),
      });
      print(`Deleted ${deleted.key} — ${deleted.title}.`);
      const { removed } = deleted;
      print(
        `  removed ${removed.acceptanceCriteria} criteria, ${removed.progress} progress entries, ` +
          `${removed.blockers} blockers, ${removed.links} links, ${removed.activityEvents} activity events`,
      );
      if (deleted.orphanedSubtasks.length > 0) {
        print(`  promoted to top level: ${deleted.orphanedSubtasks.join(", ")}`);
      }
      if (deleted.detachedDecisions.length > 0) {
        print(`  rescoped to the project: ${deleted.detachedDecisions.join(", ")}`);
      }
    });

  task
    .command("complete <task>")
    .description("Complete a task")
    .option("--force", "Complete despite incomplete acceptance criteria or active blockers")
    .option("--reason <reason>", "Required when forcing")
    .action(async function (this: Command, ref: string, options: { force?: boolean; reason?: string }) {
      const completed = await clientFor(this).tasks.complete(ref, {
        force: options.force ?? false,
        ...(options.reason ? { reason: options.reason } : {}),
        ...actorFor(this),
      });
      print(`Completed ${completed.key} — ${completed.title}.`);
    });

  // ------------------------------------------------------------------ decisions

  const decision = program.command("decision").description("Manage decision records");

  decision
    .command("add <project>")
    .description("Record a decision")
    .requiredOption("--title <title>")
    .requiredOption("--decision <decision>", "What was decided")
    .option("--rationale <rationale>", "Why it was decided")
    .option("--task <task>", "Scope the decision to a task")
    .action(async function (this: Command, ref: string, options: Record<string, string | undefined>) {
      const created = await clientFor(this).decisions.create(ref, {
        title: options.title as string,
        decision: options.decision as string,
        rationale: options.rationale ?? null,
        ...(options.task ? { task: options.task } : {}),
        ...actorFor(this),
      });
      print(decisionBlock(created));
    });

  decision
    .command("list <project>")
    .description("List decisions")
    .option("--task <task>")
    .option("--search <text>")
    .option("--json", "Output JSON")
    .action(async function (
      this: Command,
      ref: string,
      options: { task?: string; search?: string; json?: boolean },
    ) {
      const decisions = await clientFor(this).decisions.list(ref, {
        ...(options.task ? { task: options.task } : {}),
        ...(options.search ? { search: options.search } : {}),
      });
      if (options.json) return printJson(decisions);
      print(decisions.length === 0 ? "No decisions recorded." : decisions.map(decisionBlock).join("\n\n"));
    });

  // ---------------------------------------------------------------------- links

  const link = program.command("link").description("Manage external links");

  link
    .command("add <project>")
    .description("Attach an external resource")
    .requiredOption("--type <type>", "Free text type, e.g. issue, branch, document")
    .option("--provider <provider>", "Free text provider, e.g. jira, git, github")
    .option("--reference <reference>")
    .option("--url <url>")
    .option("--task <task>")
    .action(async function (this: Command, ref: string, options: Record<string, string | undefined>) {
      const links = await clientFor(this).links.add(ref, {
        type: options.type as string,
        provider: options.provider ?? null,
        reference: options.reference ?? null,
        url: options.url ?? null,
        ...(options.task ? { task: options.task } : {}),
        ...actorFor(this),
      });
      for (const created of links) print(linkLine(created));
    });

  link
    .command("list <project>")
    .description("List links")
    .option("--task <task>")
    .option("--type <type>")
    .option("--provider <provider>")
    .option("--json", "Output JSON")
    .action(async function (this: Command, ref: string, options: Record<string, any>) {
      const links = await clientFor(this).links.list(ref, {
        ...(options.task ? { task: options.task } : {}),
        ...(options.type ? { type: options.type } : {}),
        ...(options.provider ? { provider: options.provider } : {}),
      });
      if (options.json) return printJson(links);
      print(links.length === 0 ? "No links." : links.map(linkLine).join("\n"));
    });

  link
    .command("remove <link>")
    .description("Remove a link")
    .action(async function (this: Command, ref: string) {
      await clientFor(this).links.remove(ref);
      print(`Removed ${ref}.`);
    });

  // ------------------------------------------------------------------- activity

  program
    .command("activity <project>")
    .description("Show the project activity timeline")
    .option("--task <task>")
    .option("--event-type <type>", "Filter by event type (repeatable)", collect, [])
    .option("--actor <actor>", "Filter by actor")
    .option("--limit <count>", "Maximum events", (value) => Number.parseInt(value, 10))
    .option("--json", "Output JSON")
    .action(async function (this: Command, ref: string, options: Record<string, any>) {
      const page = await clientFor(this).activity.list(ref, {
        ...(options.task ? { task: options.task } : {}),
        ...(options.eventType.length > 0 ? { eventType: options.eventType } : {}),
        ...(options.actor ? { actor: options.actor } : {}),
        ...(options.limit ? { limit: options.limit } : {}),
      });
      if (options.json) return printJson(page);
      print(page.events.length === 0 ? "No activity." : page.events.map(activityLine).join("\n"));
    });

  return program;
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

/** Acceptance criteria are addressed by id over HTTP, so resolve a description first. */
async function criterionId(
  client: AgentContinuityClient,
  taskRef: string,
  reference: string,
): Promise<string> {
  const detail = await client.tasks.get(taskRef);
  const match =
    detail.acceptanceCriteria.find((criterion) => criterion.id === reference) ??
    detail.acceptanceCriteria.find(
      (criterion) => criterion.description.trim().toLowerCase() === reference.trim().toLowerCase(),
    );
  if (!match) {
    throw new Error(`No acceptance criterion on ${detail.key} matches "${reference}".`);
  }
  return match.id;
}
