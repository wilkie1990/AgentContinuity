/**
 * Creates the initial "Agent Continuity" project described in the build specification,
 * so that Agent Continuity can be used to manage its own remaining development.
 *
 *   pnpm seed
 *
 * Safe to run more than once: it does nothing if the project already exists.
 */
import { resolveConfig } from "@agent-continuity/config";
import { createWorkspace } from "@agent-continuity/core";

const PROJECT_NAME = "Agent Continuity";

const PROJECT_CONTEXT = `Agent Continuity is designed primarily for AI agents.
The conversation is temporary. The agent is replaceable. Project state persists.
The core service must remain domain agnostic.
The structured service and tools are the primary agent interface.
The Kanban board and project views are the human interface.
Project context stores persistent working knowledge that applies across the project.
Task context stores persistent working knowledge specific to a task.
Explicit choices belong in decision records.
Progress and state changes belong in activity.
Agents are transient. Tasks use temporary lease-based claims rather than permanent agent assignment.
Skills define domain-specific and workflow-specific agent behaviour.`;

const config = resolveConfig();
const workspace = createWorkspace({ config });

try {
  const existing = workspace.projects.list({
    search: PROJECT_NAME,
    limit: 50,
    offset: 0,
    sort: "updated_at_desc",
  });

  const match = existing.projects.find((project) => project.name === PROJECT_NAME);
  if (match) {
    process.stdout.write(`${match.key} already exists at ${config.databasePath}. Nothing to do.\n`);
    process.exit(0);
  }

  const result = workspace.projects.bootstrap({
    name: PROJECT_NAME,
    objective:
      "Build a local-first persistent project execution workspace that allows AI agents to reliably manage and hand over multi-session work.",
    description:
      "Local service, SQLite persistence, REST API, MCP server, CLI and local web UI providing persistent project state for AI agents.",
    context: PROJECT_CONTEXT,
    actor: "seed",
    tasks: [
      {
        ref: "skills-two-agents",
        title: "Test the Skills with two different AI coding agents",
        status: "ready",
        priority: "high",
        description:
          "Confirm that agents consistently use the structured project workflow rather than falling back to progress.md style notes.",
        context:
          "Testing must involve two different agent systems, for example Claude Code and Codex. The specific agents may be substituted.",
        acceptanceCriteria: [
          "Both agents discover an existing project before creating a new one",
          "Both agents claim a task before beginning meaningful work",
          "Both agents record milestones as progress rather than as context",
          "Both agents record explicit choices as decisions",
        ],
      },
      {
        ref: "handover",
        title: "Prove the two-agent handover scenario end to end",
        status: "ready",
        priority: "critical",
        description:
          "Agent A bootstraps a project, claims a task, records progress and a decision, then releases its claim. Agent B continues in a new conversation and completes the task without the user re-explaining anything.",
        dependsOn: ["skills-two-agents"],
        acceptanceCriteria: [
          "Agent B understands prior progress without user explanation",
          "Agent B understands the prior decision",
          "Agent B completes the acceptance criteria and the task",
          "The web UI shows both agents' progress, the decision, claim history and the activity timeline",
        ],
      },
      {
        ref: "dogfood",
        title: "Manage further Agent Continuity development inside Agent Continuity",
        status: "backlog",
        priority: "normal",
        description:
          "Import remaining development work into this project and use the tool to manage its own development from that point onward.",
        dependsOn: ["handover"],
      },
    ],
    decisions: [
      {
        title: "Domain-agnostic core",
        decision:
          "The core project and task models will not contain Git-, Jira-, or software-specific fields.",
        rationale:
          "Specialist concepts should be represented by generic links and interpreted by Skills and integrations.",
      },
      {
        title: "Task claims use leases",
        decision:
          "Tasks use temporary expiring claims rather than permanent agent assignment.",
        rationale: "AI agents and sessions are transient.",
      },
      {
        title: "Activity is append-only",
        decision:
          "Progress and state history are represented through structured append-only activity events.",
        rationale:
          "Agent handover requires reliable historical state without repeatedly overwriting generic notes.",
      },
      {
        title: "Current state is relational",
        decision:
          "v0.1 will not use full event sourcing. Relational tables are the source of current state and activity events provide history.",
        rationale:
          "Full event sourcing adds complexity that is not required to validate the product.",
      },
    ],
  });

  process.stdout.write(
    `Created ${result.project.key} — ${result.project.name} at ${config.databasePath}\n` +
      result.tasks.map((task) => `  ${task.key}  ${task.status.padEnd(8)} ${task.title}\n`).join("") +
      `  ${result.decisions.length} decisions recorded\n`,
  );
} finally {
  workspace.close();
}
