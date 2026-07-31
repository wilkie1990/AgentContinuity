# Agent Continuity V2 — shot-by-shot storyboard

## Production rules

- Composition: `AgentContinuityProductDemoV2`, 1920×1080, 30 fps.
- Planned editorial runtime: **04:24 / 7,920 frames**. Final frames must be recalculated
  from measured Lily audio plus the protected holds in [script.md](script.md).
- “Staged terminal” means a deterministic presentation of real supported tool names,
  inputs, response semantics, and fixture state. It is not labelled or edited to resemble
  an unbroken live recording.
- “Real UI capture” means the current web application populated from the CedarPay fixture.
  Do not redraw unsupported controls or invent a separate dashboard.
- The project fixture is fictional; Agent Continuity operations and state transitions are
  real product semantics.

## Shot plan

| Shot | Time | Narration | Source and composition | Exact fixture state / visual action | Payload / readable text | Transition and protected hold |
| --- | --- | --- | --- | --- | --- | --- |
| `S01` | `00:00–00:08` | N01 | Motion graphic, CedarPay editor and agent pane | Worker file remains; session context cards dissolve. Project reference `PRJ-0142` is not yet foregrounded. | “CedarPay release · 21 August” | Hard open; no product logo. |
| `S02` | `00:08–00:16` | N01 | Slow pull-back | Empty agent pane leaves three unanswered prompts: complete / safe / next. | No product payload. | 3.5-second quiet hold before project reveal. |
| `S03` | `00:16–00:34` | N02 | Product motion graphic | Continuity line joins the old session to a durable `PRJ-0142` project node. | `P01` objective excerpt; title “Agent Continuity”. | Ease reveal; four-second hold on project node. |
| `S04` | `00:34–00:43` | N03 | Real UI capture with guided crop | Project header for CedarPay; objective and context visible. | `PRJ-0142`, `CEDAR-WEBHOOKS-42`, release `2026.08`, `webhook_replay_v2`. | Focus objective, not every context line. |
| `S05` | `00:43–00:52` | N03 | Project-context detail | Highlight no-duplicate rule and canary constraint. | `P01` selected response. | 3.5-second hold, then expand to board. |
| `S06` | `00:52–01:01` | N04 | Real UI capture, full board | Initial seed: `0419`/`0420` done; `0421`/`0422` ready; `0423` blocked; `0424` review; `0425`/`0426` waiting. | `P02`; visible criteria counts and status badges. | Slow horizontal guided move. |
| `S07` | `01:01–01:10` | N04 | Board close-up | Isolate actionable `TASK-0421` and `TASK-0422`; dependency lines remain visible. | “actionable” on both; no claims. | Four-second comparison hold. |
| `S08` | `01:10–01:19` | N05 | Staged Codex terminal | Open installed skill; highlight the four lifecycle instructions without scrolling prose at narration speed. | “Read project/task state”; “Claim before meaningful work”; “Report”; “Complete or hand off”. | Cut on visual checklist tick. |
| `S09` | `01:19–01:28` | N05 | Staged Codex terminal | `projects_get` then `tasks_get` for `TASK-0421`; task stays ready/unclaimed. | `P01`, `P03`. | Four-second hold on criteria/dependencies. |
| `S10` | `01:28–01:37` | N06 | Split staged terminals | Codex calls `start_work` for `TASK-0421`; Claude simultaneously calls it for `TASK-0422`. | `P04`, `P05`; actor/session values readable. | Calls enter within 12 frames of each other. |
| `S11` | `01:37–01:46` | N06 | Split terminal + board strip | Both responses resolve; board moves each card ready → in progress. | Claim badges `codex`, `claude-code`; no collision warning. | 3.5-second ID comparison hold. |
| `S12` | `01:46–01:56` | N07 | Split task drawers | Active execution badges, actor, session, and distinct owned paths. | `TASK-0421` worker paths; `TASK-0422` console/detail paths. | Claims settle into persistent header chips. |
| `S13` | `01:56–02:06` | N07 | Shared board | Both in-progress cards remain visible with independent claims. | Selected lines from `P04`/`P05`. | Four-second stable tableau. |
| `S14` | `02:06–02:15` | N08 | Split staged terminals | Agents submit reports with progress, phase, and complete checkpoint objects. | `P06`, `P07`. | Do not animate response before request finishes. |
| `S15` | `02:15–02:24` | N08 | Real task drawers | Checkpoint fields appear: completed / working on / next. | Exact checkpoint strings from `P06`/`P07`. | Four-second hold on both next actions. |
| `S16` | `02:24–02:34` | N09 | Split staged terminals | Attach test evidence to exact criteria; no task status movement. | `P08`, `P09`. | Evidence call completes before UI update. |
| `S17` | `02:34–02:44` | N09 | Real task drawers | Evidence rows under criterion 1 (`0421`) and criterion 2 (`0422`). | Test names and `passed`; fixture labels `EV-0421-01`, `EV-0422-01` may appear only as demo annotations. | Four-second proof hold. |
| `S18` | `02:44–02:53` | N10 | Real UI capture, blocked task | Open `TASK-0423`; show `BLK-0097` description and required action. | Signed bundle unavailable; Priya action. | Before state holds for two seconds. |
| `S19` | `02:53–03:02` | N10 | Staged terminal + board | Resolve `BLK-0097`; card moves blocked → ready, unclaimed. | `P10`. | Four-second ready-state hold; no agent avatar appears. |
| `S20` | `03:02–03:11` | N11 | Real Decisions view | Open `DEC-0142`; decision and rationale remain separately labelled. | Provider event id as idempotency key; stable across redelivery. | Guided focus from decision to rationale. |
| `S21` | `03:11–03:20` | N11 | Task decision detail | Show `DEC-0143` scoped to `TASK-0421`. | Terminal ledger rows are no-op replays; settled-invoice rationale. | Four-second hold, then return to Codex. |
| `S22` | `03:20–03:29` | N12 | Staged Codex terminal | Submit `handoff` for `TASK-0421`; Claude pane remains visibly active. | `P12`. | No fade until response confirms handoff. |
| `S23` | `03:29–03:38` | N12 | Task drawer + terminal | Codex claim disappears; handoff panel shows next action; status remains in progress. | Final checkpoint from `P12`; `TASK-0422` still claimed by Claude. | Four-second checkpoint hold; then Codex pane fades. |
| `S24` | `03:38–03:48` | N13 | Real UI board | Shared post-handoff state: `0421` unclaimed/in progress with handoff, `0422` claimed/in progress, `0423` ready, `0424` review. | Real status and execution badges. | Match task key into drawer. |
| `S25` | `03:48–03:58` | N13 | Real task drawer then Needs Attention | Show `0421` checkpoint/handoff/evidence, then Needs Attention entry and review work. | `P13`; “Handoff ready”; required action to read and reclaim. | Four-second hold on required action. |
| `S26` | `03:58–04:12` | N14 | Interface topology motion graphic | MCP, `ac`, and Web connect to one `PRJ-0142` state node; no separate databases. | “Primary agent interface”; “Terminal / JSON”; “Operational view”. | Interfaces recede; 3.5-second project-node hold. |
| `S27` | `04:12–04:21` | N15 | CedarPay outcome tableau | Freeze on project context, checkpoint, evidence, and next action. Label fixture as demo. | “Demo project”; no “release shipped” claim. | Gentle resolve into CTA. |
| `S28` | `04:21–04:24` | none | End card | Product mark and concise CTA. | “Start local · Connect an agent · Structure the handoff” / “README · Quick start”. | Three seconds silent; no cut-off. |

## Canonical displayed payloads

The terminal renderer may wrap or syntax-highlight these payloads, but it must not rename
tools, add fields, or alter state semantics. Long response bodies may be reduced to the
selected lines shown here.

### P01 — project inspection

```text
projects_get({ project: "PRJ-0142" })

PRJ-0142 — CedarPay Webhook Reliability Release
Objective: Ship CedarPay API 2026.08 on 21 August with webhook delivery
that is idempotent across retries, observable by support, and safe to replay
after a provider outage—without duplicating invoices or subscriptions.
```

### P02 — initial task query

```text
tasks_list({ project: "PRJ-0142" })

TASK-0419 — Done
TASK-0420 — Done
TASK-0421 — Ready (actionable)
TASK-0422 — Ready (actionable)
TASK-0423 — Blocked
TASK-0424 — Review
TASK-0425 — Ready (waiting on dependencies)
TASK-0426 — Ready (waiting on dependencies)
```

### P03 — inspect before work

```text
tasks_get({ task: "TASK-0421" })

TASK-0421 — Implement replay-safe worker writes
Status: ready
Priority: critical
Actionable: yes
Dependencies: TASK-0420 — Done
Active blockers: None
Recommended state: Claim this task before beginning meaningful work.
```

### P04 — Codex start

```text
start_work({
  task: "TASK-0421",
  actor: "codex",
  session_id: "demo-codex-01"
})

Work started.
TASK-0421 — Implement replay-safe worker writes
Status: in_progress
Active claim: codex
session: demo-codex-01
Resume state: new execution
```

### P05 — Claude start

```text
start_work({
  task: "TASK-0422",
  actor: "claude-code",
  session_id: "demo-claude-01"
})

Work started.
TASK-0422 — Add replay visibility to the operator console
Status: in_progress
Active claim: claude-code
session: demo-claude-01
Resume state: new execution
```

### P06 — Codex report and checkpoint

```text
report({
  task: "TASK-0421",
  actor: "codex",
  session_id: "demo-codex-01",
  phase: "Worker tests",
  progress: "Conflict-path tests prove a duplicate provider event produces no second invoice write",
  checkpoint: {
    completed: "Ledger-backed worker write path",
    working_on: "Review preparation",
    next: "Attach test result and request review"
  }
})

Report recorded for TASK-0421.
Execution: active — Worker tests
Checkpoint: next: Attach test result and request review
```

### P07 — Claude report and checkpoint

```text
report({
  task: "TASK-0422",
  actor: "claude-code",
  session_id: "demo-claude-01",
  phase: "Console tests",
  progress: "Operator event detail now distinguishes replayed and skipped terminal events",
  checkpoint: {
    completed: "Replay history endpoint and UI",
    working_on: "Component-test evidence",
    next: "Request review"
  }
})

Report recorded for TASK-0422.
Execution: active — Console tests
Checkpoint: next: Request review
```

### P08 — Codex criterion evidence

```text
tasks_add_criterion_evidence({
  task: "TASK-0421",
  criterion: "duplicate event performs no second domain write",
  kind: "test",
  name: "webhook-consumer.test.ts",
  outcome: "passed",
  actor: "codex",
  session_id: "demo-codex-01"
})

Recorded test evidence · webhook-consumer.test.ts · passed · criterion 1
```

The staged response names the attached test and criterion because this fixture does not
provide a real generated evidence identifier. `EV-0421-01` is only the storyboard's
stable fixture label. The MCP call stores the record; it does not run the test.

### P09 — Claude criterion evidence

```text
tasks_add_criterion_evidence({
  task: "TASK-0422",
  criterion: "UI distinguishes skipped terminal events from replayed events",
  kind: "test",
  name: "ReplayHistory.test.tsx",
  outcome: "passed",
  actor: "claude-code",
  session_id: "demo-claude-01"
})

Recorded test evidence · ReplayHistory.test.tsx · passed · criterion 2
```

The staged response names the attached test and criterion because this fixture does not
provide a real generated evidence identifier. `EV-0422-01` is only the storyboard's
stable fixture label. MCP did not execute the component test.

### P10 — blocker resolution

```text
tasks_resolve_blocker({
  blocker: "BLK-0097",
  resolution: "Priya published bundle SHA fixture-8f2c; checksum verified against Test Operations manifest.",
  actor: "codex",
  session_id: "demo-codex-01"
})

Resolved BLK-0097. TASK-0423 is now ready.
```

### P11 — visible durable decisions

```text
DEC-0142 — Use the provider event id as the idempotency key.
Rationale: It is stable across redelivery while transport request ids are not.

DEC-0143 — Treat terminal ledger rows as no-op replays.
Rationale: Protects settled invoices and makes retry behavior predictable.
```

These are seeded product records, not Agent Continuity product-design history.

### P12 — Codex handoff

```text
handoff({
  task: "TASK-0421",
  actor: "codex",
  session_id: "demo-codex-01",
  phase: "Ready for review",
  reason: "handoff",
  checkpoint: {
    completed: "Ledger-backed worker path and conflict-path test evidence",
    working_on: "Review handoff",
    next: "Reviewer checks terminal-state guard and accepts or reopens the task"
  }
})

Handed off TASK-0421.
Completed: Ledger-backed worker path and conflict-path test evidence
Working on: Review handoff
Next: Reviewer checks terminal-state guard and accepts or reopens the task
Unresolved: none
Claim released safely.
```

These are the current concise MCP renderer lines, with the optional Git line cropped. The
supported outcome is a final checkpoint, durable handoff, ended execution, and released
claim; task completion is not implied.

### P13 — complementary CLI read

```text
ac task show TASK-0421 --json
ac task execution TASK-0421 --json
```

The first JSON crop may show only fields from task detail, including `key`, `status`,
`progress`, and `acceptanceCriteria`. The second is the supported execution read for
checkpoints and handoff. Do not invent a CLI `task get` command or imply that task detail
contains handoff state. Reads do not mutate the project.

## Factual cross-check

| Story element | Checked product behavior | Truth-matrix source |
| --- | --- | --- |
| Purpose before mechanics | N01–N04 establish interrupted execution and CedarPay risk before any lifecycle tool. | Creative brief “Audience-first story arc” and “Editorial guardrails”. |
| Skill behavior | Inspection precedes the claim; the skill guides agent conduct and is not presented as a dispatcher. | Product-truth matrix: Skill-guided agent behavior. |
| Typed MCP | `projects_get`, `tasks_list`, `tasks_get`, `start_work`, `report`, `tasks_add_criterion_evidence`, `tasks_resolve_blocker`, and `handoff` use current names and supported fields. | Product-truth matrix: Typed MCP lifecycle; repository `apps/mcp/src/tools.ts`. |
| Actionability | Only ready, dependency-complete, unblocked `TASK-0421` and `TASK-0422` start. | Product-truth matrix: Actionable work and dependencies. |
| Concurrent claims | Codex and Claude claim different tasks with different session IDs; no live claim is overridden. | Product-truth matrix: Concurrent claims. |
| Reports/checkpoints | `report` refreshes liveness and atomically stores one milestone and one checkpoint without completing a task. | Product-truth matrix: Checkpoints and handoff. |
| Evidence | Test evidence is stored against exact criteria and is never described as MCP command execution or automatic completion. | Product-truth matrix: Evidence and honest completion. |
| Blocker | Resolving the only blocker returns unclaimed `TASK-0423` to ready; it is neither assigned nor completed. | Product-truth matrix: Blockers and decisions; fixture blocker path. |
| Decisions | `DEC-0142`/`DEC-0143` are release choices with rationale, not internal product-design history. | Product-truth matrix: Blockers and decisions. |
| Handoff | `handoff` writes the final checkpoint, creates durable resume information, ends execution, and releases the claim. | Product-truth matrix: Checkpoints and handoff. |
| CLI and web | `ac task show TASK-0421 --json` and `ac task execution TASK-0421 --json` are supported; UI shots use board, task drawer, Decisions, and Needs Attention from the same state. | Product-truth matrix: CLI role, Web UI role, Shared state. |
| Needs Attention | Handoff and review items are shown as requiring action; the UI does not resolve them automatically. | Product-truth matrix: Needs Attention. |
| Staging limits | Fictional fixture and staged terminals are explicit; no cloud, agent dispatch, automatic coding, MCP shell execution, or automatic release is claimed. | Creative brief “Staged and simulated presentation boundaries”. |

## Editorial continuity check

- Every narration block maps to one or more shots and has its own speech budget plus
  protected tail/transition time.
- Scene-ending visuals remain on screen after narration; N06, N09, and N12 receive full
  four-second comprehension holds.
- No block begins before the prior block's protected hold ends; no speech overlaps another
  clip.
- `S28` is a three-second silent end card, preventing CTA truncation.
- TASK-0053 must replace estimates with measured Lily timestamps and fail validation if
  audio or captions exceed any resulting scene boundary.
