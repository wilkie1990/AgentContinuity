# Agent Workspace

**Persistent project execution for AI agents.**

The conversation is temporary. The agent is replaceable. The project state persists.

Agent Workspace is a local-first service that stores structured project state — projects,
context, tasks, acceptance criteria, dependencies, temporary claims, progress, blockers,
decisions, links and activity — so one AI agent can begin work and another can continue it
later without the user reconstructing anything by hand.

It replaces the `progress.md` / `TODO.md` pattern with something an agent can query,
mutate and hand over reliably.

## What is in the box

| Surface | Purpose |
| --- | --- |
| **MCP server** | The primary agent interface: 27 tools over stdio |
| **REST API** | `http://127.0.0.1:4732/api/v1`, the single public contract |
| **CLI** (`aw`) | Terminal access for humans and for agents without MCP (`--json`) |
| **Web UI** | Kanban board, task drawer, context editor, decisions, links, activity |
| **Skills** | `agent-workspace` and `project-bootstrap` teach agents how to behave |

Everything shares one domain layer (`packages/core`); no adapter holds its own business
rules.

## Quick start

```bash
pnpm install
pnpm build

# Start the API and web UI on http://127.0.0.1:4732
node apps/cli/dist/bin.js server

# Optional: create the Agent Workspace project described in the specification
pnpm seed
```

Open <http://127.0.0.1:4732> for the board.

### Connect an agent over MCP

```json
{
  "mcpServers": {
    "agent-workspace": {
      "command": "node",
      "args": ["/absolute/path/to/AgentWorkspace/apps/mcp/dist/bin.js"]
    }
  }
}
```

Then copy `skills/agent-workspace` and `skills/project-bootstrap` into your agent's skills
directory (for Claude Code, `~/.claude/skills/`).

### Use the CLI

```bash
alias aw="node /absolute/path/to/AgentWorkspace/apps/cli/dist/bin.js"

aw project create --name "Agent Workspace" --objective "Persistent execution for AI agents"
aw task create PRJ-0001 --title "Design task claim model" --status ready --priority high \
  --criterion "Defines expiry behaviour"
aw task list PRJ-0001 --actionable
aw task claim TASK-0001 --actor codex --session abc123
aw task progress TASK-0001 "Initial lease data model designed."
aw task complete TASK-0001
aw activity PRJ-0001
```

Every read command supports `--json`.

## The model in one minute

- A **project** holds an objective and **project context**: persistent working memory that
  applies anywhere in the project.
- A **task** holds **task context**: what a future agent needs specifically to finish it.
- A task is **actionable** when it is `ready`, all dependencies are `done`, and it has no
  active blockers.
- A **claim** is a temporary lease (30 minutes by default), not an assignment. It expires,
  it renews itself whenever the owner records real work, and anyone can reclaim a lapsed
  one.
- **Progress** records milestones, **decisions** record choices and their reasoning,
  **blockers** record what stopped the work, and **activity** is the append-only history of
  everything.

Identifiers are human readable — `PRJ-0001`, `TASK-0042`, `DEC-0007`, `BLK-0012`,
`LNK-0003` — and the API accepts either a key or a UUID.

## Configuration

Defaults live in `~/.agent-workspace/`:

```
~/.agent-workspace/workspace.db      SQLite database
~/.agent-workspace/config.json       optional configuration
```

```json
{
  "server": { "host": "127.0.0.1", "port": 4732 },
  "claims": { "defaultTtlMinutes": 30 }
}
```

Environment variables override the file: `AGENT_WORKSPACE_HOST`, `AGENT_WORKSPACE_PORT`,
`AGENT_WORKSPACE_DATA_DIR`, `AGENT_WORKSPACE_DATABASE_PATH`,
`AGENT_WORKSPACE_CLAIM_TTL_MINUTES`, `AGENT_WORKSPACE_LOG_LEVEL`.

The server binds to `127.0.0.1` and never listens publicly by default. v0.1 has no
authentication, no multi-user support and no cloud component.

## Reaching the UI from another device

By default the server only answers on `127.0.0.1`, so only this machine can reach it. That is
deliberate: v0.1 has no authentication, so anything the port is bound to has full read/write
access to the workspace.

If this machine runs [Tailscale](https://tailscale.com), the safest way to reach the board from
your phone, laptop, or another box on your tailnet is to bind loopback and the Tailscale
interface — never the whole LAN:

```bash
node apps/cli/dist/bin.js server --tailscale
# equivalent: node apps/cli/dist/bin.js server --host loopback,tailscale
```

A socket binds exactly one address, so this opens one listener per address, both backed by a
single workspace. `http://127.0.0.1:4732` keeps working on this machine while tailnet peers
reach `http://100.x.y.z:4732`. The Tailscale address is detected from OS network interfaces (an
IPv4 address in `100.64.0.0/10`) — no `tailscale` CLI required.

The startup banner prints every real URL, plus a warning that the service still has no
authentication: anyone on your tailnet who can reach it has full access.

To bind every interface on the local network instead (broader exposure, generally not
recommended), pass an explicit host:

```bash
node apps/cli/dist/bin.js server --host 0.0.0.0
```

The banner always lists concrete URLs — it never prints `http://0.0.0.0:PORT`, which is not a
URL anyone can open.

`AGENT_WORKSPACE_HOST` and `config.json`'s `server.host` accept the same values, including a
comma-separated list, if you'd rather configure this once instead of passing a flag every time:

```json
{ "server": { "host": "loopback,tailscale", "port": 4732 } }
```

Setting it in `config.json` also keeps the `aw` CLI pointed at the right address, which a
command-line flag alone cannot do.

## Documentation

- [`docs/architecture.md`](docs/architecture.md) — layers, domain rules, why they are where they are
- [`docs/api.md`](docs/api.md) — the REST surface and error model
- [`docs/mcp.md`](docs/mcp.md) — the MCP tool surface
- [`docs/development.md`](docs/development.md) — repository layout, testing, conventions

## Scope of v0.1

Included: local service, SQLite persistence, REST API, MCP server, CLI, web UI, Kanban
board, project and task context, acceptance criteria, dependencies, claims, progress,
blockers, decisions, generic links, activity timeline, project bootstrap, and the two
Skills.

Deliberately excluded: authentication, cloud hosting, multi-user, real-time collaboration,
native GitHub/Jira integrations, automatic Git operations, mobile, custom workflows,
billing, agent performance metrics.

Agent Workspace is not a Trello replacement, not a Jira replacement and not an AI memory
database. It is a persistent execution workspace for work performed through AI agents. The
board visualises work for humans; the API and MCP tools expose work to agents; Skills teach
agents how to behave. The project state survives them all.
