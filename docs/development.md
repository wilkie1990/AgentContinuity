# Development

## Prerequisites

- Node.js 24 or newer
- pnpm 10 (`npm i -g pnpm`)

The database uses Node's built-in synchronous `node:sqlite` module, so dependency
installation does not compile or download a separate SQLite native addon. Node 24.15 and
newer reports `node:sqlite` as stability 1.2 (release candidate); earlier Node 24 releases
support the APIs used here but may print an experimental-feature warning.

## Commands

```bash
pnpm install          # install and link the workspace
pnpm build            # tsc project references, then the Vite build
pnpm typecheck        # same, without emitting the web bundle
pnpm test             # Vitest: core, API and MCP suites
pnpm test:watch
pnpm test:e2e         # Playwright, builds the UI and boots a throwaway server
pnpm seed             # create the Agent Continuity project in the local database

pnpm dev              # tsx watch on the API (serves apps/web/dist when built)
pnpm dev:web          # Vite dev server on :4733, proxying /api to :4732
```

`pnpm install` allows `esbuild` to run its install script; pnpm 10 blocks dependency
lifecycle scripts unless they are listed in `onlyBuiltDependencies` in
`pnpm-workspace.yaml`.

## Docker (local only)

The repository includes a multi-stage `Dockerfile` for a reproducible local Node 24 build.
The final image contains the production deployment of the server and its workspace
dependencies, plus the built web assets; it runs as the unprivileged `agentcontinuity`
user. No image registry workflow is provided or intended.

```bash
docker compose up --build -d
docker compose ps                         # wait for "healthy"
curl --fail http://127.0.0.1:4732/health
docker compose logs agent-continuity
```

Compose stores state in its `agent-continuity-data` named volume at `/data` and configures
`AGENT_CONTINUITY_DATA_DIR=/data` and
`AGENT_CONTINUITY_DATABASE_PATH=/data/workspace.db`. To prove persistence, create state,
run `docker compose up -d --force-recreate`, then verify the state remains. Use
`docker compose down -v` only to deliberately remove that database.

The container binds `0.0.0.0` internally so Docker can reach it, while Compose publishes
the selected port as `127.0.0.1:${AGENT_CONTINUITY_PORT:-4732}`. This loopback restriction
is security-critical: Agent Continuity has no authentication. Do not make it LAN- or
internet-reachable without an explicit, reviewed access boundary.

Override the local port (both the container setting and loopback mapping) with:

```bash
AGENT_CONTINUITY_PORT=4740 docker compose up --build -d
```

The normal base image is Docker Hub's official `node:24-bookworm-slim`. If Docker Hub is
temporarily unreachable but an approved official Node mirror is available in your local
environment, its image reference can be supplied only for that local build with
`AGENT_CONTINUITY_NODE_IMAGE=... docker compose build`; it does not change the default or
add a registry publication path.

## Repository layout

```
apps/
  server/   Fastify API, also serves the built web UI
  web/      React + Vite single page application
  cli/      the `ac` binary
  mcp/      MCP server over stdio
packages/
  core/       domain services — the only place business rules live
  database/   Drizzle schema, SQL migrations, connection factory
  contracts/  Zod schemas, DTOs, error codes
  client/     typed HTTP client
  config/     configuration resolution
skills/       agent-continuity, project-bootstrap
docs/
e2e/          Playwright specs
scripts/      seed.ts
```

## TypeScript setup

Two root configs, deliberately:

- `tsconfig.build.json` — the solution config with project references, used by `tsc -b`.
- `tsconfig.json` — a normal config covering all sources, used by editors and by Vite's
  transform pipeline. Vite 8's oxc transformer cannot load a solution-style config
  (`files: []` plus `references`), which is why the build graph lives in a separate file.

Packages are ESM with `NodeNext` resolution, so relative imports carry `.js` extensions even
in `.ts` sources.

## Migrations

Migrations are plain SQL files in `packages/database/migrations`, applied in filename order
by `runMigrations`, each inside its own transaction, tracked in a `_migrations` table with a
checksum. Editing an already-applied migration is detected and refused.

To change the schema, add the next numbered `.sql` file and update
`packages/database/src/schema.ts` to
match. The Drizzle schema is used for typed queries; it does not generate the migrations.

## Workspace export and import

`ac workspace export` writes a deterministic, versioned logical JSON snapshot. It does not
copy the SQLite file, migrations, receipts, search index, or FTS index. By default it emits a
portable redacted snapshot: machine-local repository/worktree paths and their path-bound Git
and ownership history are omitted and listed in a redaction manifest. Use
`--include-local-paths` only for a full-fidelity local backup; importing that file requires
`--accept-local-paths` as an explicit acknowledgement.

`ac workspace import --file backup.json --confirm` validates the complete document before
writing. Version 1 restores only an empty workspace, or returns `already_imported` when the
same digest has a recorded receipt. It never merges, replaces, remaps keys, or overwrites
live state. Claims and running executions in a source file are retained as history but safely
interrupted during the first import; a bounded receipt makes replay of that exact source
idempotent. File output is written through a private temporary file and atomic rename; stdout
contains only the JSON document.

## Database runtime

`createDatabase()` uses `node:sqlite`'s synchronous `DatabaseSync` through Drizzle's
official `node-sqlite` adapter. File-backed workspaces use WAL mode; all workspaces enable
foreign-key enforcement and wait up to five seconds for a busy database before failing.
In-memory workspaces use SQLite's `memory` journal mode because WAL is not available for
`:memory:` databases.

Drizzle's official adapter is currently available only on its release-candidate line, so
both `packages/database` and `packages/core` pin the same exact version. Upgrade them
together when the adapter reaches a verified stable Drizzle release.

## Testing

| Suite | Location | Notes |
| --- | --- | --- |
| Core domain | `packages/core/src/__tests__` | In-memory SQLite, controllable clock |
| REST API | `apps/server/src/__tests__` | `fastify.inject`, no sockets |
| MCP contract | `apps/mcp/src/__tests__` | Real `Client` over `InMemoryTransport` |
| Web workflows | `e2e/` | Playwright against a real server and a real database |

`createTestWorkspace()` from `@agent-continuity/core/testing` gives an isolated in-memory
workspace whose clock you can advance:

```ts
const workspace = createTestWorkspace();
workspace.claims.claim("TASK-0001", { actor: "codex" });
workspace.advanceMinutes(31);
expect(workspace.tasks.getSummary("TASK-0001").claim).toBeNull();
```

Vitest resolves `@agent-continuity/*` straight to source through aliases in
`vitest.config.ts`, so no build step is needed before running tests.

`packages/core/src/__tests__/activity.test.ts` asserts that every event type declared in
`ACTIVITY_EVENT_TYPES` is actually produced by the domain. Adding an event type without
emitting it fails the suite.

## Conventions

- New rules go in `packages/core`. If you find yourself writing a condition in a route or a
  tool handler, it belongs in a service.
- New request shapes go in `packages/contracts` and are consumed by every layer. Do not
  duplicate request models.
- Every state mutation records an activity event.
- Activity payloads never contain full context values — record lengths instead.
- Errors are `AgentContinuityError` with a code from `ERROR_CODES`; transports translate,
  they do not invent.

## Ports

| Port | What |
| --- | --- |
| 4732 | API and web UI |
| 4733 | Vite dev server |
| 4741 | Playwright's throwaway server |
