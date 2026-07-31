# Agent Continuity V2 — timed narration script

## Timing contract

Target runtime is **4:24 (264 seconds)** at 30 fps. The narration is written for Lily at
an estimated 138–145 words per minute, with short sentences and no code syntax intended
to be spoken literally. Each block includes protected head/tail or transition time.
These timings are editorial estimates only: TASK-0053 must measure the generated Lily
clips, preserve the stated holds, and derive final scene lengths from the audio.

Payload IDs (`P01`–`P13`) refer to the fact-checked display payloads in
[storyboard.md](storyboard.md#canonical-displayed-payloads).

## Locked narration

### N01 — The interrupted release

- **Time / budget:** `00:00–00:16` — about 12.5 seconds speech, 3.5 seconds protected hold.
- **Visual intent:** Make the viewer feel the continuity problem before showing a product
  surface. A CedarPay worker diff remains on screen while an agent session fades away.
- **Fixture state / IDs:** CedarPay project `PRJ-0142`; work concerns `CEDAR-417` /
  `TASK-0421`, but no claim or state change occurs.
- **Displayed payload:** None. Small label only: “CedarPay release · 21 August”.
- **Transition:** Let the empty session pane breathe, then pull back to reveal the project
  record.

> The code is still here. But the session that understood the release is gone. What was
> finished? What is safe to start? And what does the next agent need to know?

### N02 — The promise

- **Time / budget:** `00:16–00:34` — about 14 seconds speech, 4 seconds hold.
- **Visual intent:** Introduce Agent Continuity as the durable layer around agent work,
  not as the coding agent itself.
- **Fixture state / IDs:** `PRJ-0142` title and objective enter; no feature enumeration yet.
- **Displayed payload:** Product title plus the short objective from `P01`.
- **Transition:** A continuity line connects the vanished session to the project card.

> Agent Continuity keeps the project’s working state outside any one conversation. Agents
> and people can inspect it, update it, and hand work over without rebuilding the story
> from chat.

### N03 — A credible use case

- **Time / budget:** `00:34–00:52` — about 14.5 seconds speech, 3.5 seconds hold.
- **Visual intent:** Establish the release objective and risk in human terms.
- **Fixture state / IDs:** `PRJ-0142`, fixture `CEDAR-WEBHOOKS-42`, release `2026.08`;
  project context names the `webhook_replay_v2` canary and no-duplicate rule.
- **Displayed payload:** `P01`, with the objective highlighted rather than read aloud.
- **Transition:** Objective card expands into the populated board.

> Here, CedarPay is preparing a webhook reliability release. Retries must never duplicate
> an invoice, support needs replay visibility, and the rollout stays behind a canary until
> the evidence is strong enough.

### N04 — The populated shared plan

- **Time / budget:** `00:52–01:10` — about 14 seconds speech, 4 seconds hold.
- **Visual intent:** Show that the project already contains useful, differentiated work.
- **Fixture state / IDs:** `TASK-0419` and `TASK-0420` done; `TASK-0421` and `TASK-0422`
  ready/actionable; `TASK-0423` blocked by `BLK-0097`; `TASK-0424` review;
  `TASK-0425` and `TASK-0426` ready but waiting on dependencies.
- **Displayed payload:** `P02` plus a real fixture-backed web board capture.
- **Transition:** Hold on the two actionable cards, then focus the Codex pane.

> The board is not a flat to-do list. It already knows what is done, what is blocked,
> what is under review, and which two tasks can begin now because their dependencies are
> complete.

### N05 — The skill guides inspection

- **Time / budget:** `01:10–01:28` — about 14 seconds speech, 4 seconds hold.
- **Visual intent:** Show the `agent-continuity` skill shaping agent behavior before any
  claim is made.
- **Fixture state / IDs:** Codex session `demo-codex-01`; task remains `TASK-0421` ready
  and unclaimed.
- **Displayed payload:** Skill excerpt card: “Read project and task state”; “Claim before
  meaningful work”; “Report checkpoints and evidence”; then `P01` and `P03`.
- **Transition:** The inspection checklist ticks once, then the screen splits.

> Codex follows the installed skill first. It reads the project context, checks the task’s
> criteria and dependencies, and only then claims work. The skill guides the behavior; it
> does not schedule or dispatch the agent.

### N06 — Two independent starts

- **Time / budget:** `01:28–01:46` — about 14.5 seconds speech, 3.5 seconds hold.
- **Visual intent:** Make simultaneous work legible with balanced Codex and Claude panes.
- **Fixture state / IDs:** Codex claims `TASK-0421` as actor `codex`, session
  `demo-codex-01`; Claude claims `TASK-0422` as actor `claude-code`, session
  `demo-claude-01`. Both tasks move ready → in progress.
- **Displayed payload:** `P04` and `P05`.
- **Transition:** A synchronized claim pulse lands on both task cards; keep four seconds
  for viewers to compare the IDs.

> At the same moment, Claude takes the operator-console task. The two agents claim
> different actionable tasks, with separate sessions and non-overlapping files. They
> share the project, not the same lease.

### N07 — What a claim means

- **Time / budget:** `01:46–02:06` — about 16 seconds speech, 4 seconds hold.
- **Visual intent:** Explain safe ownership without turning the scene into schema narration.
- **Fixture state / IDs:** `TASK-0421` claim `codex`; `TASK-0422` claim `claude-code`;
  both executions active. Ownership paths remain disjoint as specified in the fixture.
- **Displayed payload:** Selected response lines from `P04`/`P05`; board badges show the
  two actors and in-progress state.
- **Transition:** Claims settle into small persistent badges while work continues.

> A claim is a temporary lease, not a permanent assignment. Meaningful reports renew it,
> and another agent cannot simply force through a live claim. The shared board now shows
> exactly who is working, and where.

### N08 — Reports become resumable state

- **Time / budget:** `02:06–02:24` — about 14 seconds speech, 4 seconds hold.
- **Visual intent:** Show both agents producing concise milestones and structured
  checkpoints.
- **Fixture state / IDs:** `TASK-0421` phase “Worker tests”; `TASK-0422` phase
  “Console tests”; both remain in progress and claimed.
- **Displayed payload:** `P06` and `P07`.
- **Transition:** Progress text collapses into completed / working on / next checkpoint
  rows; hold on both “next” fields.

> Each agent records one useful milestone and one checkpoint: what is complete, what is
> happening now, and what comes next. This is durable resume state, not a transcript of
> every command.

### N09 — Evidence attaches to the claim

- **Time / budget:** `02:24–02:44` — about 16 seconds speech, 4 seconds hold.
- **Visual intent:** Connect implementation claims to exact acceptance criteria.
- **Fixture state / IDs:** Add fixture evidence `EV-0421-01` to `TASK-0421` criterion 1
  and `EV-0422-01` to `TASK-0422` criterion 2. Task status does not change automatically.
- **Displayed payload:** `P08` and `P09`; real task-drawer evidence rows show test name
  and passed outcome.
- **Transition:** Evidence chips lock beneath their criteria, followed by a quiet hold.

> Test evidence is attached to the criterion it supports. Agent Continuity stores the
> result and its provenance; it does not pretend the MCP call ran the test, and evidence
> alone does not mark the task complete.

### N10 — A blocker stays honest

- **Time / budget:** `02:44–03:02` — about 14 seconds speech, 4 seconds hold.
- **Visual intent:** Resolve the external fixture blocker without implying automatic work.
- **Fixture state / IDs:** Resolve `BLK-0097`; `TASK-0423` moves blocked → ready,
  remains unclaimed, and retains the resolution.
- **Displayed payload:** `P10`; web board before/after for `TASK-0423`.
- **Transition:** Blocked banner recedes; a neutral ready badge replaces it after the
  response finishes.

> The signed retry bundle arrives from Test Operations, so its blocker is resolved with
> the checksum recorded. The task returns to ready. Nothing is auto-assigned, auto-run, or
> silently completed.

### N11 — Decisions remain discoverable

- **Time / budget:** `03:02–03:20` — about 14 seconds speech, 4 seconds hold.
- **Visual intent:** Show why a durable decision is more useful than a buried chat remark.
- **Fixture state / IDs:** Project decision `DEC-0142`; task decision `DEC-0143`; no task
  status change.
- **Displayed payload:** `P11` in the real Decisions view; rationale fields visible.
- **Transition:** Decision card docks beside the relevant task context, then the camera
  returns to Codex.

> The release also keeps its consequential choices with their reasoning. Using the
> provider event id protects redeliveries; treating terminal rows as no-op replays protects
> settled invoices. The rationale remains discoverable after the conversation ends.

### N12 — The structured handoff

- **Time / budget:** `03:20–03:38` — about 14 seconds speech, 4 seconds hold.
- **Visual intent:** Deliver the central payoff: Codex can leave without discarding the
  execution story.
- **Fixture state / IDs:** Codex hands off `TASK-0421`; final phase “Ready for review”;
  claim is released, execution ends, task remains in progress, durable handoff appears.
  Claude remains active on `TASK-0422`.
- **Displayed payload:** `P12`.
- **Transition:** Codex pane fades only after the handoff response and four-second
  checkpoint hold.

> Now Codex can stop cleanly. The handoff validates its lease, writes a final checkpoint,
> creates the resume record, and releases the claim. The task is not declared done; its
> next action is explicit.

### N13 — The same truth in the web UI

- **Time / budget:** `03:38–03:58` — about 16 seconds speech, 4 seconds hold.
- **Visual intent:** Prove that the terminal activity and web board reflect one persisted
  project state.
- **Fixture state / IDs:** `TASK-0421` unclaimed with handoff; `TASK-0422` in progress
  claimed by Claude; `TASK-0423` ready; `TASK-0424` review. Needs Attention includes the
  `TASK-0421` handoff and review work as supported fixture state.
- **Displayed payload:** Real UI capture plus CLI read `P13`.
- **Transition:** Match-cut the `TASK-0421` key from terminal JSON into its task drawer.

> Open the web UI and the same state is already there: Claude’s live execution, Codex’s
> checkpoint and handoff, the resolved blocker, decisions, and criterion evidence. Needs
> Attention makes the work requiring action easy to find.

### N14 — One durable layer, several views

- **Time / budget:** `03:58–04:12` — about 10.5 seconds speech, 3.5 seconds hold.
- **Visual intent:** Orient MCP, CLI, and web without another feature list.
- **Fixture state / IDs:** `PRJ-0142` remains the single data source; no new mutations.
- **Displayed payload:** MCP, `ac`, and Web labels connected to one `PRJ-0142` node.
- **Transition:** Interfaces recede while the project node remains.

> MCP is the primary agent interface. The CLI and web UI are complementary views over the
> same project state, not separate systems.

### N15 — Close and call to action

- **Time / budget:** `04:12–04:24` — about 9 seconds speech, 3 seconds logo/CTA hold.
- **Visual intent:** Return to the release outcome and invite a concrete first use.
- **Fixture state / IDs:** CedarPay fixture freezes as “Demo project”; no completion or
  release success is implied.
- **Displayed payload:** “Start local · Connect an agent · Make the next handoff
  structured” and “See README · Quick start”.
- **Transition:** Three-second silent end card; music resolves before final frame.

> Start Agent Continuity locally, connect an agent, and make your next multi-session
> project resumable by design.

## Lily pronunciation and delivery note

- **Agent Continuity:** “AY-jent con-tin-YOO-ih-tee”.
- **CedarPay:** “SEE-der Pay”.
- **Codex:** “CODE-ex”.
- **Claude:** “Clawd”.
- **MCP:** speak the letters, “M C P”.
- **CLI:** speak the letters, “C L I” if used in pickup narration.
- **Idempotency:** “eye-dem-POH-ten-see”.
- **Webhook:** “web-hook”.
- Read task IDs only if a pickup explicitly requires them; prefer “task forty-two
  twenty-one” rather than spelling punctuation.
- Delivery should be assured and conversational, with a slight lift on the three opening
  questions. Do not rush tool names. Respect the protected silence after N06, N09, N12,
  and the final CTA.

## Duration rationale

The opening purpose/use-case section occupies the first 70 seconds before lifecycle
mechanics begin. The concurrent-agent proof receives 94 seconds; blocker, decision,
handoff, and shared-UI payoff receive 74 seconds; orientation and CTA use the final
26 seconds. Total planned runtime is 264 seconds, inside the required 3.5–4.5 minute
window. No narration block shares time with another, and every boundary reserves
3.5–4 seconds except the final three-second end hold.
