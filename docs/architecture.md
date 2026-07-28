# Architecture

## Layers

```
                 ┌────────────────┐
                 │    Web UI      │
                 └───────┬────────┘
                         │ HTTP
                 ┌───────▼────────┐
CLI ─── HTTP ───►│  Fastify API   │
                 └───────┬────────┘
                         │
MCP Adapter ─────────────┤
                         │
                 ┌───────▼────────┐
                 │  Core Services │
                 └───────┬────────┘
                         │
                 ┌───────▼────────┐
                 │  Repositories  │
                 └───────┬────────┘
                         │
                 ┌───────▼────────┐
                 │     SQLite     │
                 └────────────────┘
```

**All state mutation and business rules live in `packages/core`.** The REST routes
translate HTTP into core service calls; the MCP tools translate tool calls into the same
service calls. No business rule exists only in a route or a tool handler. The CLI and the
web app both go through the HTTP API via `packages/client`, so the public contract is
exercised by real usage.

The MCP server talks to core in-process (it is the same package), which is why it needs no
running HTTP server.

## Packages

| Package | Contains |
| --- | --- |
| `packages/contracts` | Zod schemas, DTO types, error codes, key helpers. Consumed by every layer. |
| `packages/config` | Configuration resolution: defaults → `config.json` → environment → explicit overrides. |
| `packages/database` | Drizzle schema, SQL migrations and their runner, connection factory. |
| `packages/core` | Domain services and repositories. The only place rules live. |
| `packages/client` | Typed HTTP client used by the CLI and the web app. |
| `apps/server` | Fastify application, routes, error translation, static hosting of the UI. |
| `apps/mcp` | MCP server, tool definitions, agent-focused response rendering. |
| `apps/cli` | `ac` binary. |
| `apps/web` | React + Vite single page application. |

`packages/config` is the one addition to the layout in the specification: `database`,
`core`, `server`, `mcp` and `cli` all need the same resolution rules, and putting them in
`contracts` would have mixed request validation with process configuration.

## Synchronous state and asynchronous local inspection

Node's built-in `node:sqlite` `DatabaseSync` API is synchronous, so domain state changes
remain synchronous. This is not an accident:

- A transaction is an ordinary function call, so `projects.bootstrap()` genuinely commits
  or rolls back as one unit without any async plumbing.
- Any service can call any other service inside an enclosing transaction.

`Runtime` (`packages/core/src/runtime.ts`) holds a single mutable "current connection".
`runtime.tx(fn)` opens a transaction if none is open and otherwise joins the enclosing one,
so nested calls compose. Because SQLite work here is single-threaded, no interleaving is
possible.

`Runtime` also owns the clock and id factory, which is what makes claim expiry testable
without waiting 30 minutes.

Local Git inspection is the deliberate exception. The adapter uses asynchronous
`child_process.execFile` calls with explicit argument arrays and the stored execution
worktree as `cwd`; it never holds a SQLite transaction open while waiting on a child
process. Composite workflows commit their primary lifecycle state first, then append a
best-effort provenance result. An inspection failure therefore becomes a durable error
snapshot rather than rolling back a valid checkpoint, handoff or completion.

## Identifiers

Every user-facing row carries both a UUID primary key and a human readable key
(`PRJ-0001`, `TASK-0042`, `DEC-0007`, `BLK-0012`, `LNK-0003`). Keys come from a `counters`
table, allocated with a single atomic `UPDATE ... RETURNING` inside the caller's
transaction — so a rolled-back bootstrap does not burn a key.

References accept either form, case-insensitively and with flexible padding: `TASK-42`,
`task-0042` and the UUID all resolve to the same row.

## Domain rules worth knowing

**Actionability.** A task is actionable when it is `ready`, every dependency is `done`, and
no blocker is active. A task may be moved to `ready` with incomplete dependencies; the UI
marks those cards and the Skills tell agents to prefer actionable work.

**Claims are leases.** One active claim per task, where active means `released_at IS NULL
AND expires_at > now`. Re-claiming your own live lease extends it; claiming someone else's
is rejected with `TASK_ALREADY_CLAIMED`. Operations that represent real work
(`ClaimService.touchClaim`) silently extend the lease when actor and session match, which is
why no heartbeat process is needed.

Expiry is lazy. Reads reconcile lapsed claims and emit `task.claim_expired` at most once per
claim, guaranteed by the `expiry_recorded_at` column. No background job exists.

**Completion.** `tasks.complete` refuses while incomplete acceptance criteria or active
blockers remain, unless `force` is passed with a reason — which is recorded in the event
payload. Completion releases the active claim. Moving a `done` task elsewhere clears
`completed_at` and records `task.reopened`. Adding criteria to a completed task reopens it
(to `in_progress` if still claimed, otherwise `ready`).

**Blockers.** Adding one moves the task to `blocked` unless it is already done. Resolving
the last active one returns the task to `in_progress` if a claim is still held, otherwise to
`ready`. A blocked task cannot leave the blocked column while blockers remain
(`TASK_HAS_ACTIVE_BLOCKERS`).

**Dependencies.** Directed, same-project only, no self-references. Before adding "A depends
on B" the service searches for an existing path B → … → A; if one exists the edge would
close a cycle and is rejected with the path spelled out:

```
Cannot add TASK-0012 as a dependency of TASK-0008 because it would create the
dependency cycle TASK-0008 → TASK-0012 → TASK-0008.
```

**Deletion.** `tasks.delete` and `projects.delete` are the destructive operations. Task
deletion removes everything the task owns and lets everything it merely references survive:
subtasks are promoted to top level and task-scoped decisions fall back to project scope. The
`task.deleted` event is recorded against the *project* rather than the task, so it is not
swept away by the same cascade that removes the task's own history. An active claim blocks
deletion unless `force` is passed, since a live lease means another agent is mid-work.

Project deletion has no such higher scope to fall back on — the project is the top of the
hierarchy, so its cascade takes every task, decision, link and activity event with it, and
there is nowhere for a `project.deleted` event to survive. Rather than inventing a
project-less event scope, deletion is not recorded in the queryable activity timeline at all;
the returned removal summary is the durable record for the caller, and the server writes one
line to its own process log as a lightweight, best-effort operational trace (see the project's
recorded decision for the reasoning). The claim guard is the same shape as task deletion,
scaled to the whole project: any task inside it holding an active claim blocks deletion unless
`force` is passed. Deletion does not require the project to be archived first — archiving and
deletion are different operations serving different needs.

**Context has immutable history and an efficient current projection.** Project and task
rows retain nullable free-form Markdown plus a monotonic `context_version`; ordinary reads
and unified search use those columns without joining history. `context_versions` appends
the exact nullable value, Unicode-character/UTF-8 byte size, attribution, reason and
optional revert source. Replacements use a required expected version and compare-and-swap
the projection, so stale writers fail with `CONTEXT_VERSION_CONFLICT`. Revert copies an old
value into a new latest version and never deletes later history. Activity carries versions
and sizes, never the text. Search indexes current context only.

The 32 KiB soft warning and 256 KiB hard ceiling are both UTF-8 byte thresholds. Historical
lists are bounded metadata; full content requires a targeted version read. No service
algorithmically compacts or summarizes context.

**Git provenance is derived and explicitly scoped.** One immutable baseline belongs to one
task execution, worktree binding and project repository. Append-only snapshots carry a
monotonic per-baseline sequence and normalized touched paths for downstream collision
analysis. The core persistence service accepts typed facts only after validating those
three identities. A separate local adapter reads the path-bearing binding and invokes
bounded, read-only Git commands; no process cwd fallback exists. Derived records are marked
`local_git`, while agent-authored checkpoints and evidence stay separate.

**Acceptance evidence is typed and append-only.** The original free-form evidence table
remains the stable search projection. A one-to-one details row supplies the structured kind,
bounded payload and historical repository/worktree/execution/SHA snapshot; migrated rows
are read-only `legacy` evidence and retain every original base value. Optional per-criterion
policies are evaluated after incomplete criteria and blockers at completion. Forced
completion requires and audits a reason.

**Verification execution is CLI-local.** The server, client library, core persistence
service and MCP expose no process-launch operation. The CLI resolves cwd only from the
task's stored execution worktree, accepts an executable plus argument vector with
`shell=false`, captures fixed-memory stdout/stderr tails, enforces a timeout, and probes Git
before and after. POSIX uses a detached process group for SIGTERM/SIGKILL tree termination;
Windows termination is best-effort for the direct child. Passing verification adds evidence
but never completes a criterion or task.

**Path collision warnings are derived, bounded and advisory.** Versioned ownership
revisions retain what each execution declared, while warnings are recomputed from the
latest live declaration and latest successful cumulative Git snapshot. Comparisons require
the same repository identity and an unreleased, unexpired claim; same-worktree and
separate-worktree risks remain distinct. Exact-key, sorted prefix and directory-ancestor
indexes avoid an execution-pair Cartesian scan for large diffs. Warnings feed execution
state and Needs Attention but never participate in claim eligibility.

**Unified search is a transactional derived index.** Canonical workspace tables remain the
source of truth. `search_documents` stores constrained source/scope metadata and normalized
text; an external-content FTS5 table supplies Unicode tokenization, BM25 ranking and
snippets. Database triggers keep those two derived tables synchronized, while the core
search service rebuilds the affected project/task scope inside the same `Runtime`
transaction as the canonical mutation. Project/task foreign keys clean up cascades, and
task deletion explicitly reindexes decisions that fall back to project scope. Search never
uses embeddings or an external service, and callers cannot supply raw MATCH syntax.

## Activity

`activity_events` is append-only history. The relational tables remain the source of truth
for current state; there is no event sourcing.

The table carries a monotonic `seq INTEGER PRIMARY KEY AUTOINCREMENT` alongside its `id`.
This is a deliberate deviation from the specification's column list: a bootstrap writes
dozens of events inside the same millisecond, so ordering by `created_at` alone is
ambiguous. `seq` makes the timeline deterministic and makes cursor pagination exact — a
cursor is simply an encoded sequence number.

## Errors

`AgentContinuityError` carries a typed `code`, a human readable message and structured
`details`. Each transport translates it once:

- REST maps the code to a status (`apps/server/src/errors.ts`) and returns
  `{ error: { code, message, details } }`.
- MCP returns `isError: true` with the code as the first token of the text, so an agent can
  distinguish `TASK_ALREADY_CLAIMED` from `TASK_NOT_FOUND`.
- The CLI prints `CODE: message` to stderr and exits non-zero.
- `packages/client` reconstructs the original `AgentContinuityError` from the envelope.

## Listening on more than one address

A socket binds exactly one address, so reaching the workspace from both this machine and a
tailnet peer needs two listeners. `startServer` builds a single Fastify instance, calls
`app.ready()`, then creates one `node:http` server per address using `app.routing` as the
handler. All of them share one workspace and one SQLite connection; closing the server closes
every listener. Port `0` is resolved from the first listener and reused for the rest, so every
address answers on the same port.

`server.host` accepts a comma-separated list and resolves the aliases `loopback` and
`tailscale`. `0.0.0.0` collapses the list to itself, since it already covers every interface.

## Security posture

v0.1 has no authentication and binds to `127.0.0.1` by default. It is a single-user local tool.
CORS is enabled to let a separately hosted Vite dev server reach the API during development; the
built UI is served from the same origin.

Widening the listening address is opt-in and never inferred (`DEC-0001`). `packages/config`
resolves `server.host` — from `--host`, `AGENT_CONTINUITY_HOST`, or `config.json` — and accepts
one alias: `"tailscale"`, resolved in `packages/config/src/network.ts` to the machine's actual
Tailscale interface address (an IPv4 address in `100.64.0.0/10`, detected from OS network
interfaces via `node:os`, not by shelling out to the `tailscale` binary). Binding that single
address is materially safer than `0.0.0.0`: only tailnet peers can reach the service, not every
device on the LAN. `apps/cli`'s `server` command exposes this as `--tailscale` (shorthand for
`--host tailscale`).

Whatever address is chosen, `apps/server/src/start.ts` never reports it as a bare bind address —
`listReachableAddresses` expands `0.0.0.0` into loopback plus every external IPv4 address so the
startup banner always prints URLs a client could actually open, never `http://0.0.0.0:PORT`.
`isLoopbackHost` also drives `isExposedBeyondLoopback`, which makes both `apps/server/src/bin.ts`
and the CLI's `server` command print a no-authentication warning whenever the resolved host
reaches beyond this machine. Do not expose the port to a network without understanding that
trade-off.
