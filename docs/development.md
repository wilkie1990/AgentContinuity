# Development

## Prerequisites

- Node.js 22 or newer (developed on Node 25)
- pnpm 10 (`npm i -g pnpm`)
- Xcode Command Line Tools on macOS, or build-essential on Linux — `better-sqlite3` compiles
  from source when no prebuilt binary matches your Node version

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

`pnpm install` allows `better-sqlite3` and `esbuild` to run their install scripts; pnpm 10
blocks dependency lifecycle scripts unless they are listed in `onlyBuiltDependencies` in
`pnpm-workspace.yaml`.

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

To change the schema, add `0002_*.sql` and update `packages/database/src/schema.ts` to
match. The Drizzle schema is used for typed queries; it does not generate the migrations.

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
