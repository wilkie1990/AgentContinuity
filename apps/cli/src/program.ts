import { createAgentWorkspaceClient, type AgentWorkspaceClient } from "@agent-workspace/client";
import { resolveConfig } from "@agent-workspace/config";
import type { ProjectStatus, TaskPriority, TaskStatus } from "@agent-workspace/contracts";
import { Command, Option } from "commander";
import { readFileSync } from "node:fs";
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

export const CLI_VERSION = "0.1.0";

type GlobalOptions = { url?: string; actor?: string; session?: string };

function clientFor(command: Command): AgentWorkspaceClient {
  const globals = command.optsWithGlobals<GlobalOptions>();
  const config = resolveConfig();
  return createAgentWorkspaceClient({ baseUrl: globals.url ?? config.baseUrl });
}

function actorFor(command: Command): { actor?: string; sessionId?: string } {
  const globals = command.optsWithGlobals<GlobalOptions>();
  const actor = globals.actor ?? process.env.AGENT_WORKSPACE_ACTOR;
  return {
    ...(actor ? { actor } : {}),
    ...(globals.session ? { sessionId: globals.session } : {}),
  };
}

function readText(value: string | undefined, file: string | undefined): string | undefined {
  if (file) return readFileSync(file === "-" ? 0 : file, "utf8");
  return value;
}

export function buildProgram(): Command {
  const program = new Command();

  program
    .name("aw")
    .description("Agent Workspace — persistent project execution for AI agents")
    .version(CLI_VERSION)
    .option("--url <url>", "Base URL of the local Agent Workspace server")
    .option("--actor <actor>", "Identifier recorded against mutations")
    .option("--session <id>", "Session identifier recorded against mutations");

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

      const { startServer, describeRunningServer } = await import("@agent-workspace/server");
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
    .action(async () => {
      const [{ createMcpServer }, { StdioServerTransport }, { createWorkspace }] = await Promise.all([
        import("@agent-workspace/mcp"),
        import("@modelcontextprotocol/sdk/server/stdio.js"),
        import("@agent-workspace/core"),
      ]);
      const workspace = createWorkspace({ config: resolveConfig() });
      await createMcpServer(workspace).connect(new StdioServerTransport());
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
    .description("Show or replace the persistent project context")
    .option("--set <text>", "Replace the context with this text")
    .option("--file <path>", "Replace the context with the contents of a file, or - for stdin")
    .option("--json", "Output JSON")
    .action(async function (
      this: Command,
      ref: string,
      options: { set?: string; file?: string; json?: boolean },
    ) {
      const client = clientFor(this);
      const next = readText(options.set, options.file);

      if (next !== undefined) {
        const updated = await client.projects.updateContext(ref, { context: next, ...actorFor(this) });
        return options.json
          ? printJson({ context: updated.context })
          : print(`Updated context for ${updated.key} (${next.length} characters).`);
      }

      const detail = await client.projects.get(ref);
      if (options.json) return printJson({ context: detail.context });
      print(detail.context ?? "(no project context recorded)");
    });

  project
    .command("archive <project>")
    .description("Archive a project")
    .action(async function (this: Command, ref: string) {
      const archived = await clientFor(this).projects.archive(ref, actorFor(this).actor);
      print(`Archived ${archived.key}.`);
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
    .description("Show or replace the persistent task context")
    .option("--set <text>")
    .option("--file <path>")
    .option("--json", "Output JSON")
    .action(async function (
      this: Command,
      ref: string,
      options: { set?: string; file?: string; json?: boolean },
    ) {
      const client = clientFor(this);
      const next = readText(options.set, options.file);
      if (next !== undefined) {
        const updated = await client.tasks.updateContext(ref, { context: next, ...actorFor(this) });
        return print(`Updated context for ${updated.key} (${next.length} characters).`);
      }
      const detail = await client.tasks.get(ref);
      return options.json
        ? printJson({ context: detail.context })
        : print(detail.context ?? "(no task context recorded)");
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
  client: AgentWorkspaceClient,
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
