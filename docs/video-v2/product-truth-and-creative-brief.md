# Agent Continuity V2 — product truth and creative brief

## Creative brief

**Audience.** Developers, engineering leads, and AI-enabled delivery teams who are
evaluating how to run substantive work across more than one agent or chat session.
They already recognize that a useful implementation thread can be lost when a chat ends,
an agent changes, or several agents need to coordinate.

**Viewer problem.** A chat transcript, a TODO file, and an agent's short-term context do
not provide a durable, shared account of what the project is trying to achieve, which task
is safe to start, what has been proved, or how to resume interrupted work.

**Core promise.** Agent Continuity is a local-first durable execution layer: it keeps
structured project state that agents and people can query, update, and hand over across
sessions. It does not replace the coding agent; it gives agents a shared, resumable record
of the work around the code.

**Tone.** Calm, concrete, and technically literate. Show a credible software-release
project and useful records rather than a feature parade or a generic "AI swarm" fantasy.
Explain the value in plain language before naming tools.

**Call to action.** Try Agent Continuity on a real multi-step project: start the local
service, connect an agent through MCP (or use `ac`), and make the next handoff a structured
one. The closing frame may point to the repository README's Quick start and agent-install
instructions; it must not claim hosted sign-up, cloud collaboration, or automatic delivery.

## Audience-first story arc

The arc is deliberately purpose and use-case first. It excludes the product's internal
design history and implementation history.

1. **The break in continuity.** A release task is underway; the agent session ends and a
   teammate needs to know what is complete, what is next, and what is blocked. Establish
   that the problem is losing execution state, not losing code.
2. **The durable project record.** Introduce one populated release project: objective and
   project context, tasks with dependencies and priorities, acceptance criteria, evidence,
   progress, decisions, blockers, links, and activity. The same record outlives any one
   conversation.
3. **How an agent joins safely.** Show an agent following the `agent-continuity` skill:
   read project/task state, then use the typed MCP `start_work` lifecycle call to claim an
   actionable task with its real provider session identity.
4. **Two agents, one shared plan.** Present Codex and Claude working on *different*
   actionable tasks at the same time. Claims are temporary leases, so the scene emphasizes
   safe task ownership and visible execution state, not magical simultaneous editing.
5. **Useful work leaves useful proof.** Each agent records a meaningful report/checkpoint;
   its task shows the current phase, completed/working-on/next fields, criteria and typed
   evidence. Show a blocker and a decision as explicit records, not prose hidden in chat.
6. **The handoff is the feature.** One agent hands off, producing a durable resume record;
   the next agent reads it and continues instead of asking for a reconstructed summary.
7. **Humans can see the same truth.** Use the web board and task drawer to show the shared
   task state, execution health, checkpoint and handoff, then Needs Attention to surface
   work needing action.
8. **Choose the interface that fits.** Briefly anchor MCP as the primary agent interface,
   `ac` as terminal/JSON access, and the web UI as an operational view over the same domain
   state. Do not imply that these are separate backends.
9. **Close on continuity.** Return to the original release task: the project carries its
   own working memory, evidence and next action even when the original session is gone.

## Product-truth matrix

Every spoken claim, caption, UI label, terminal command, and on-screen annotation in the
V2 edit must be traceable to a row below. Evidence locations are current repository sources;
the final edit should re-check them if the product changes.

| Planned claim / screen moment | Product truth and safe wording | Evidence location |
| --- | --- | --- |
| Continuity across agents and sessions | Agent Continuity stores structured project state so another agent can continue later; the conversation and agent are temporary. Say “persistent project execution,” not “persistent agent memory.” | [README — opening and model](../../README.md#the-model-in-one-minute); [agent-continuity skill](../../skills/agent-continuity/SKILL.md) |
| Structured project state | A project has objective/project context; tasks can carry context, criteria, dependencies, priorities, temporary claims, progress, blockers, decisions, links and activity. Context versions are immutable and stale writes conflict. | [README — The model in one minute](../../README.md#the-model-in-one-minute); [README — MCP Tasks](../../docs/mcp.md#tasks) |
| Skill-guided agent behavior | The shipped `agent-continuity` skill instructs an agent to read project/task state, claim before meaningful work, report/checkpoint, attach evidence, and complete or hand off honestly. It is guidance for agent behavior, not a scheduler. | [agent-continuity skill](../../skills/agent-continuity/SKILL.md) |
| Typed MCP lifecycle | The primary agent interface is the in-process MCP server. Its named typed composite lifecycle is `start_work` → `report` → `handoff`; the agent profile retains complete non-destructive workflow tools. No generic execute-anything dispatcher exists. | [MCP guide — Profiles and composite workflow](../mcp.md#profiles); [MCP guide — Composite workflow tools](../mcp.md#composite-workflow-tools) |
| CLI role | The `ac` CLI provides terminal access and every read command supports `--json`. `ac task verify` is the only command-execution surface and requires a stored execution worktree; do not present MCP as running arbitrary shell commands. | [README — Use the CLI](../../README.md#use-the-cli); [MCP guide — Tasks](../mcp.md#tasks) |
| Web UI role | The web UI exposes a Kanban board, task drawer, context, decisions, links, activity, and Needs Attention routes. It is a view and editing surface over shared contracts/domain rules, not a separate product database. | [README — What is in the box](../../README.md#what-is-in-the-box); [`apps/web/src/App.tsx`](../../apps/web/src/App.tsx); [`apps/web/src/components/TaskDrawer.tsx`](../../apps/web/src/components/TaskDrawer.tsx) |
| Concurrent claims | A claim is a temporary lease (30 minutes by default), renews when the owner records real work, and can be reclaimed after expiry. Show two agents claiming distinct actionable tasks; a task already claimed by another live owner is not available to force through. | [README — The model in one minute](../../README.md#the-model-in-one-minute); [skill — Before task work](../../skills/agent-continuity/SKILL.md#before-task-work); [`packages/core/src/claims/service.ts`](../../packages/core/src/claims/service.ts) |
| Actionable work and dependencies | A task is actionable only when it is `ready`, all dependencies are done, and it has no active blockers. Use this exact constraint when a terminal or caption says why an agent chose a task. | [README — The model in one minute](../../README.md#the-model-in-one-minute); [MCP guide — Tasks](../mcp.md#tasks) |
| Checkpoints and handoff | A checkpoint contains completed, working-on, next, and optional uncertainty. `handoff` records the final checkpoint, produces durable resume information, and releases the claim. | [MCP guide — Composite workflow tools](../mcp.md#composite-workflow-tools); [`packages/core/src/workflows/service.ts`](../../packages/core/src/workflows/service.ts); [`apps/web/src/components/TaskDrawer.tsx`](../../apps/web/src/components/TaskDrawer.tsx) |
| Evidence and honest completion | Typed criterion evidence may be file, test, commit, URL, result, or note. Completion enforces criteria and active blockers; passing verification alone does not complete a criterion. | [MCP guide — Tasks](../mcp.md#tasks); [README — Use the CLI](../../README.md#use-the-cli); [`packages/core/src/evidence/service.ts`](../../packages/core/src/evidence/service.ts) |
| Blockers and decisions | Blockers capture what stopped work and a required action; decisions record a meaningful choice and rationale. Both are explicit, durable records. | [README — The model in one minute](../../README.md#the-model-in-one-minute); [skill — Decisions and blockers](../../skills/agent-continuity/SKILL.md) |
| Needs Attention | Needs Attention surfaces stale/interrupted execution, expired claims, blockers, review work, handoffs, and path-collision advisories. It identifies work requiring action; it does not itself resolve it or inject it automatically into a session. | [MCP guide — Records](../mcp.md#records); [`apps/web/src/components/NeedsAttentionPanel.tsx`](../../apps/web/src/components/NeedsAttentionPanel.tsx); [`packages/core/src/executions/service.ts`](../../packages/core/src/executions/service.ts) |
| Shared state, not separate adapters | MCP, REST, CLI and web are thin access surfaces over shared core/domain contracts. The video may cut between them as different views of the same project state. | [README — What is in the box](../../README.md#what-is-in-the-box); [`packages/core/src/index.ts`](../../packages/core/src/index.ts) |

## Feature coverage and screen-time priorities

| Feature | What the viewer should see | Why it earns screen time |
| --- | --- | --- |
| Project/task structure | Objective, project context, task states, criteria, dependencies, priority and activity on one realistic release project | Makes the durable record tangible before tool mechanics. |
| Skill + typed MCP lifecycle | Read state, `start_work`, a meaningful `report`, then `handoff` | Shows disciplined agent behavior and resumability with supported named operations. |
| Concurrent claims | Two distinct, actionable tasks held by different agents | Demonstrates coordination without implying one task can have multiple owners. |
| Checkpoint + handoff | Completed / working on / next; then the next agent resumes from it | The clearest before/after proof of continuity. |
| Evidence, blocker, decision | One criterion's evidence, one blocker/resolution, and one decision with rationale | Shows that project truth is structured and reviewable rather than inferred from chat. |
| CLI + web UI | A compact `ac --json` read and the board/task drawer/Needs Attention view | Confirms that people and agents can inspect the same state from complementary surfaces. |
| Needs Attention | A handoff, blocked task, review or stale execution item with required action | Makes exceptions visible without promising automatic remediation. |

## Staged and simulated presentation boundaries

The project needs a polished, readable demo; the following safeguards keep that polish from
claiming unsupported automation.

- The release project, task names, task content, agent names, and on-screen timeline may be
  deterministic fixture data. Label it as a demo project where context makes that useful.
- Codex and Claude terminal panes may be staged/faux sessions and edited for pacing. Their
  displayed lifecycle commands/tool calls must use real supported names, fields, ordering,
  and outcomes; they must not be represented as an unedited live recording.
- The video may show two agents concurrently owning different actionable tasks. It must not
  show both agents successfully claiming the same live task, automatic task assignment, or
  a claim overriding another live owner.
- Agent Continuity persists state and exposes it to its interfaces; it does not autonomously
  write code, dispatch agents, resolve blockers, run MCP verification commands, or deliver a
  release. A human or agent performs those actions through its own tools.
- Use real product captures wherever the edit says “the board,” “task drawer,” or “Needs
  Attention.” If a capture is composited, populated, or time-compressed, do not use visual
  treatment or narration that suggests a live unattended system.
- The session integration is opt-in and deliberately read-only: startup supplies an opaque
  session identity, and Stop can request a continuation for a missing/stale checkpoint. It
  does not automatically query or inject Needs Attention, projects, tasks, blockers, or
  user-authored text, and it creates no progress or heartbeat records. | [Session integrations](../session-integrations.md) |
- Do not claim cloud service, public multi-user collaboration, authentication, or hosted
  sign-up. The documented v0.1 service is local-first, loopback by default, with no
  authentication, no multi-user support, and no cloud component. | [README — Configuration](../../README.md#configuration) |

## Editorial guardrails

- Prefer “durable project state” and “structured handoff” over vague claims of “memory” or
  “autonomous orchestration.”
- Keep the first third about the interrupted release workflow, not tool names or schemas.
- Pair every agent action with a visible state change or proof: claim, report/checkpoint,
  evidence, blocker/decision, or handoff.
- Do not narrate counts of MCP tools unless the final build rechecks the current documentation.
- Treat source-linked facts above as the release checklist for script, capture, captions, and
  factual QA.
