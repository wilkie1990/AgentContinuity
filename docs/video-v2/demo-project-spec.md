# Demo project specification — CedarPay webhook reliability release

## Purpose and fixture identity

This is the single realistic workspace used in the V2 demo. It is a software delivery
project, not a project about producing the video.

| Demo name | Stable fixture key | Agent Continuity key in the captured fixture |
| --- | --- | --- |
| CedarPay Webhook Reliability Release | `CEDAR-WEBHOOKS-42` | `PRJ-0142` |
| Repository | `cedarpay-api` | repository association `REP-0042` |
| Release train | `2026.08` | link reference `release/2026.08-webhooks` |
| Codex task | `CEDAR-417` | `TASK-0421` |
| Claude task | `CEDAR-418` | `TASK-0422` |

The fixture generator must retain these keys and titles in every terminal capture, typed
tool response, CLI output, and web capture. They are fictional product data, while the
operations shown are real Agent Continuity operations.

## Project objective and durable context

**Objective:** Ship CedarPay API `2026.08` on 21 August with webhook delivery that is
idempotent across retries, observable by support, and safe to replay after a provider
outage—without duplicating invoices or subscriptions.

**Project context to seed:** CedarPay receives signed `invoice.paid` and
`subscription.updated` events from three payment providers. The release owns the
TypeScript API, PostgreSQL migration, worker, operator runbook, and release checklist.
Production writes must use a provider-event idempotency key; replay is permitted only for
events that have not reached a terminal delivery state. Keep rollout behind
`webhook_replay_v2` until SRE approves the 24-hour canary. The release manager is Mina
Shah; support lead is Owen Brooks. The 21 August ship date and no-duplicate-charge rule
are durable project context, not merely chat history.

## Task catalog and initial seed

Each item below has a complete description, task context, priority, dependencies, and
checkable acceptance criteria. “Initial” is what exists before any on-screen action;
“demo-time” is the intended state at the end of the active-work sequence.

| Agent key / product ID | Title and description | Context, priority, dependencies | Acceptance criteria | Initial → demo-time state |
| --- | --- | --- | --- | --- |
| `TASK-0419` / `CEDAR-415` | **Publish provider event contract.** Normalize Stripe, Adyen, and Braintree event identifiers into `provider_event_id`; publish the schema used by the worker. | Context: contract version `2026-08-rc1` is signed off by Payments Platform. **High.** No dependencies. | (1) schema names all three provider identifiers; (2) parser rejects missing id; (3) contract link is attached. | **Done** → done. |
| `TASK-0420` / `CEDAR-416` | **Add idempotency ledger migration.** Add the `webhook_delivery_ledger` table and unique `(provider, provider_event_id)` index. | Context: migration has run against the staging anonymized snapshot. **Critical.** Depends on `TASK-0419`. | (1) reversible migration exists; (2) uniqueness test passes; (3) staging migration evidence is recorded. | **Done** → done. |
| `TASK-0421` / `CEDAR-417` | **Implement replay-safe worker writes.** Make the webhook worker insert-or-return from the ledger before any invoice or subscription side effect. | Context: Codex owns only `apps/api/src/webhooks/ledger.ts` and `apps/api/src/workers/webhook-consumer.ts`; preserve terminal statuses. **Critical.** Depends on `TASK-0420`. | (1) duplicate event performs no second domain write; (2) terminal delivery is never replayed; (3) unit tests cover insert and conflict paths. | **Ready/actionable** → in progress, then review with report/checkpoint/evidence. |
| `TASK-0422` / `CEDAR-418` | **Add replay visibility to the operator console.** Surface replay attempt, provider id, and final disposition in the support-facing event detail endpoint. | Context: Claude owns only `apps/console/src/features/events/ReplayHistory.tsx` and `apps/api/src/routes/event-detail.ts`; no worker files. **High.** Depends on `TASK-0419`. | (1) endpoint returns redacted provider id and disposition; (2) UI distinguishes skipped terminal events from replayed events; (3) component test covers both labels. | **Ready/actionable** → in progress, then review with report/checkpoint/evidence. |
| `TASK-0423` / `CEDAR-419` | **Validate provider retry fixtures.** Confirm the shared synthetic fixtures reproduce duplicate delivery ordering and out-of-order subscription updates. | Context: Test Operations must publish the final signed fixture bundle; do not substitute production payloads. **Normal.** Depends on `TASK-0419`. | (1) fixture checksum is recorded; (2) duplicate and out-of-order cases load; (3) link points to the signed bundle. | **Blocked** (external fixture bundle unavailable) → ready after `BLK-0097` is resolved; it is not silently completed. |
| `TASK-0424` / `CEDAR-420` | **Review migration rollback plan.** Validate the rollback SQL and deployment ordering against the staging change ticket. | Context: Noor Patel has supplied rollback SQL; review is deliberately separate from implementation. **High.** Depends on `TASK-0420`. | (1) rollback leaves existing rows readable; (2) deployment ordering is documented; (3) reviewer evidence is attached. | **Review** → done after reviewer approval (a later, optional beat). |
| `TASK-0425` / `CEDAR-421` | **Run release-candidate end-to-end verification.** Exercise worker, console, and provider retry fixtures against the release candidate. | Context: QA owns `tests/e2e/webhook-replay/`; it needs the Codex and Claude changes plus the fixture bundle. **Critical.** Depends on `TASK-0421`, `TASK-0422`, `TASK-0423`. | (1) duplicate invoice remains single; (2) terminal event is skipped and visible; (3) test result evidence links to the run. | **Ready/waiting on dependencies** → ready/actionable only after all three prerequisites are done. |
| `TASK-0426` / `CEDAR-422` | **Approve canary and publish release checklist.** Record the SRE canary decision and release manager go/no-go. | Context: use the `webhook_replay_v2` flag; no broad rollout until the 24-hour canary is green. **Critical.** Depends on `TASK-0424`, `TASK-0425`. | (1) canary decision has a rationale; (2) checklist link is attached; (3) rollback owner is named. | **Ready/waiting on dependencies** → remains waiting in the core demo. |

This dependency graph makes `TASK-0421` and `TASK-0422` independently actionable at the
same time and gives them disjoint file ownership. It also leaves a genuine downstream
shared-state consequence: their completion unlocks QA only together with the resolved
fixture task.

## Seeded durable detail

### Progress and checkpoints

Seed the following meaningful history; do not manufacture routine command-by-command
activity.

| Task | Progress and checkpoint present before the demo |
| --- | --- |
| `TASK-0419` | Progress: “Provider event contract `2026-08-rc1` approved for all three adapters.” Checkpoint: completed “Canonical event-id schema and parser validation”; working on “None”; next “Ledger migration can consume the contract.” |
| `TASK-0420` | Progress: “Staging migration completed with unique-index verification.” Checkpoint: completed “Ledger table and rollback migration”; working on “Release review”; next “Parallel worker and console changes may begin.” |
| `TASK-0424` | Progress: “Rollback SQL compared with staging deployment order.” Checkpoint: completed “Initial rollback review”; working on “Reviewer approval”; next “Noor records final sign-off.” |

At demo time, Codex reports `TASK-0421` with progress “Conflict-path tests prove a
duplicate provider event produces no second invoice write” and checkpoint completed
“Ledger-backed worker write path”; working on “Review preparation”; next “Attach test
result and request review.” Claude reports `TASK-0422` with progress “Operator event detail
now distinguishes replayed and skipped terminal events” and checkpoint completed “Replay
history endpoint and UI”; working on “Component-test evidence”; next “Request review.”

### Evidence, links, and decisions

Attach evidence to individual criteria—not generic task prose. Seed these items:

| Record | Fixture data |
| --- | --- |
| `EV-0419-01` | `TASK-0419` criterion 1, **file**, `packages/contracts/src/webhooks/provider-event.ts`, passed: canonical id fields for three providers. |
| `EV-0420-01` | `TASK-0420` criterion 2, **test**, `webhook-ledger-migration.test.ts`, passed: unique index rejects duplicate provider event. |
| `EV-0420-02` | `TASK-0420` criterion 3, **result**, reference `staging-run-2026-08-14`, passed: migration and rollback smoke test. |
| `EV-0421-01` | Added on screen after Codex’s report: criterion 1, **test**, `webhook-consumer.test.ts`, passed. |
| `EV-0422-01` | Added on screen after Claude’s report: criterion 2, **test**, `ReplayHistory.test.tsx`, passed. |
| `LNK-0142` | Project link, `repository`, provider `local-git`, reference `cedarpay-api`. |
| `LNK-0420` | Task link, `change-ticket`, provider `linear`, reference `CEDAR-416`. |
| `LNK-0423` | Task link, `fixture-bundle`, provider `artifact-registry`, reference `webhooks-2026.08-signed`. |
| `LNK-0426` | Task link, `release-checklist`, provider `notion`, reference `cedarpay-2026.08`. |
| `DEC-0142` | Project decision: “Use the provider event id as the idempotency key.” Rationale: it is stable across redelivery while transport request ids are not. |
| `DEC-0143` | `TASK-0421` decision: “Treat terminal ledger rows as no-op replays.” Rationale: protects settled invoices and makes retry behavior predictable. |
| `DEC-0144` | `TASK-0426` decision: “Gate rollout behind a 24-hour canary.” Rationale: preserves rollback capacity during the highest-risk release window. |

### Blocker and resolution path

Seed `BLK-0097` on `TASK-0423`: “The Test Operations signed provider-retry fixture
bundle has not been published to the artifact registry.” Required action: “Priya Nair
publishes checksum-verified `webhooks-2026.08-signed` and attaches its registry link.”
The web board initially shows the task as blocked and displays the required action. The
demo can show a typed `tasks_resolve_blocker` response with the resolution “Priya published
bundle SHA `fixture-8f2c`; checksum verified against Test Operations manifest.” The supported
result is the blocker marked resolved and the task returned to **ready** (unclaimed), not
an invented automatic completion or agent reassignment.

## Precise on-screen state-transition flow

The first column distinguishes immutable initial seed from actions performed during the
presentation. Tool text is representative of the real typed response fields, not a claim
that MCP runs shell commands or creates screenshots.

| Beat | State change | Codex session | Claude session | Typed MCP response shown | CLI view | Web UI view |
| --- | --- | --- | --- | --- | --- | --- |
| 0 — seeded board | **Initial only.** 2 done, `0421`/`0422` actionable ready, `0423` blocked, `0424` review, `0425`/`0426` waiting. Decision, links, evidence, and `BLK-0097` already exist. | Reads the skill; no claim yet. | Reads the task list; no claim yet. | `projects_get(PRJ-0142)` shows objective/context, counts, decisions and links; `tasks_list` shows statuses/actionability. | `ac project show PRJ-0142`; `ac task list PRJ-0142`. | Project overview shows objective, progress, dependency-aware task columns, decision and link summary. |
| 1 — concurrent start | **On screen.** Codex claims `0421`; Claude claims `0422`. Both move ready → in progress. | `start_work` for `TASK-0421`, actor `codex`, session `demo-codex-01`; declares worker-only paths after binding in the fixture. | `start_work` for `TASK-0422`, actor `claude-code`, session `demo-claude-01`; declares console/detail paths. | Each `start_work` returns the full task/project context, active claim, execution resume state, dependencies and blockers. No task can be claimed if it were blocked/review/dependency-waiting. | `ac --actor codex --session demo-codex-01 task start TASK-0421`; concurrent equivalent for Claude. | Two task drawers show distinct active claims, phases initially absent, and non-overlapping ownership; board moves both cards to In progress. |
| 2 — live reports | **On screen.** Each agent records one meaningful `report`; no task completion yet. | Reports conflict-path test milestone and checkpoint. | Reports replay-visibility milestone and checkpoint. | `report` returns claim/execution plus one progress entry and one checkpoint for each task; it refreshes liveness atomically. | `ac ... task report TASK-0421 --phase "Worker tests" --progress ... --completed ... --working-on ... --next ...`; analogous Claude command. | Task drawers show current phase, progress timeline, checkpoint fields, and last-heartbeat time. The board remains shared and both cards stay in progress. |
| 3 — proof and shared read | **On screen.** Attach `EV-0421-01` and `EV-0422-01`; task status remains in progress/review as staged. | Adds Codex’s typed test evidence, then reads task list. | Adds Claude’s typed test evidence, then reads `TASK-0421` to see Codex’s checkpoint. | `tasks_add_criterion_evidence` persists a typed test record only; `tasks_get` exposes the other task’s progress/checkpoint. It does not execute tests. | `ac task get TASK-0421 --json` makes the shared checkpoint legible. | Evidence chips appear under their exact criteria; Claude’s drawer can show Codex’s reported progress without any chat relay. |
| 4 — blocker resolution | **On screen, optional short beat.** `BLK-0097` resolves; `0423` blocked → ready. | Reads the updated actionable list. | May remain working; no forced claim. | `tasks_resolve_blocker` returns resolution, resolved blocker, and ready task. | `ac task show TASK-0423` before/after; `ac task unblock BLK-0097 "Fixture bundle published and checksum verified"`; then `ac task list PRJ-0142`. | The blocked banner disappears, resolution is retained in history, and `0423` becomes available. |
| 5 — downstream implication | **On screen.** After both implementation tasks are actually completed in a later capture, `0425` is still waiting until `0423` is done; after all three, it becomes actionable. | Completes only after its criteria are marked complete; `tasks_complete` releases its claim. | Same independent lifecycle for `0422`. | `tasks_complete` rejects incomplete criteria or active blockers and otherwise returns done/released claim. `tasks_list` changes `0425` to actionable only when every dependency is done. | `ac task get TASK-0425` shows dependencies rather than a misleading automatic execution. | Dependency graph shows the three completed prerequisite arrows feeding the newly actionable QA task; `0426` remains waiting. |

Do not show unsupported behavior: no generic “execute command” MCP tool, automatic task
assignment, automatic review approval, automatic evidence verification, automatic status
changes from a report, or dependency completion triggered merely by a claim. The CLI and
web UI are separate views of the same persisted project state; they are not alternate
systems.

## Fixture acceptance review

- Concrete release objective and durable operating context: specified above.
- Eight believable, fully described tasks with context, priorities, dependencies, and
  criteria: specified in the catalog.
- Done, actionable-ready, concurrent in-progress, blocked, review, and dependency-waiting
  states: explicitly seeded or reached in the flow.
- Progress, checkpoints, criterion evidence, decisions, links, and blocker/resolution:
  specified with stable IDs.
- Exact product-show flow across both agents, MCP, CLI, and web: specified in the table.
- Capability fidelity: constrained to documented typed Agent Continuity lifecycle
  operations and their real state semantics.
