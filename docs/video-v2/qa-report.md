# V2 independent release QA — FAIL

**Reviewer:** `terra-high-qa` (independent of the master edit)  
**Master reviewed:** `apps/video/out/v2/agent-continuity-product-demo-v2.mp4`  
**SHA-256:** `f75fae05851aeecfa072f80d0636eb3039a0e89e29445fa9c85c67b3dc302094`  
**Decision:** **FAIL — do not publish this master.**

## Release blocker

- **BLK-0009 — 00:02:24–00:02:29 (N09, criterion evidence):** both the Codex and
  Claude terminal panels visibly render `Evidence <fixture id> (test) attached.`.
  This is an unresolved placeholder in the master, not a concrete fixture result. It
  violates the locked no-placeholder/debug/legacy-reference requirement and makes the
  evidence proof less credible. The source confirms the two strings in
  `apps/video/src/v2/scenes/concurrent-agents.tsx`. Replace them with the concrete
  evidence identifiers (`EV-0421-01` and `EV-0422-01`), re-render, and repeat
  independent QA.

No other release blocker was found in the render, source/manifest audit, or machine
checks below. This is nevertheless a release failure.

## What was reviewed

- Read the product-truth/creative brief, demo fixture specification, production audit,
  locked script, storyboard, design direction, V2 scene plan, production manifest,
  capture manifest, Lily production metadata, VTT, current README, MCP guide, and
  `agent-continuity` skill.
- Visually inspected all 15 scene-centre frames and dense boundary frames at -200 ms,
  exact boundary, and +200 ms for every N01→N02 through N14→N15 transition. Evidence:
  `apps/video/out/v2/qa/frames/` and `frame-times.tsv` (57 frames).
- Reviewed the supplied 29.909-second sample decode and the complete master by full
  audio/video decode. This environment cannot play audio to the reviewer, so this is
  a structural/timestamp/waveform-tail review, **not a claim of human listening**.
- Inspected the supplied normal and reduced-motion concurrent-start frames. They are
  visually identical at the stable state, as intended; reduced-motion uses stable/
  opacity-only presentation rather than travel/parallax.

## Time-coded editorial review

Scene boundaries are master-frame times (30 fps). “Narration end” is the final rendered
audio frame; every scene retains 20–21 frames (0.667–0.700 s) after it. The last-word
column is checked against the locked Lily text and timestamp production metadata.

| Scene | Master scene | Narration end / last word | Review |
| --- | --- | --- | --- |
| N01 | 00:00:00.000–00:00:14.133 | 00:00:13.467 / `know` | Purpose leads: interrupted release/session loss is clear before mechanics. Clean rail transition to N02. |
| N02 | 00:00:14.133–00:00:29.900 | 00:00:29.233 / `chat` | Durable project state is introduced in plain language; no product overclaim. |
| N03 | 00:00:29.900–00:00:47.267 | 00:00:46.567 / `enough` | Concrete CedarPay use case, no-duplicate rule and canary are legible. |
| N04 | 00:00:47.267–00:01:00.867 | 00:01:00.200 / `complete` | Board is genuinely populated: done, ready/actionable, blocked, review, and dependency-waiting states. |
| N05 | 00:01:00.867–00:01:19.200 | 00:01:18.500 / `agent` | Skill precedes `projects_get`/`tasks_get`; correct “guidance, not scheduler” framing. |
| N06 | 00:01:19.200–00:01:36.333 | 00:01:35.633 / `lease` | Codex and Claude are simultaneously readable; separate tasks, actors, sessions and owned paths are legible. |
| N07 | 00:01:36.333–00:01:53.633 | 00:01:52.933 / `where` | Temporary-lease and live-claim protection claims match current docs. |
| N08 | 00:01:53.633–00:02:11.067 | 00:02:10.400 / `command` | Report/checkpoint example is correct: meaningful milestone, phase, completed/working-on/next; no automatic completion implied. |
| N09 | 00:02:11.067–00:02:29.700 | 00:02:29.033 / `complete` | Evidence semantics are correct, but **fails** for the visible `<fixture id>` placeholders. |
| N10 | 00:02:29.700–00:02:46.633 | 00:02:45.967 / `completed` | Blocker’s required action and resolved-history treatment are accurate; returns to ready, unclaimed, and not auto-completed. |
| N11 | 00:02:46.633–00:03:07.100 | 00:03:06.433 / `ends` | Decisions show the idempotency-key and terminal-no-op rationale correctly. |
| N12 | 00:03:07.100–00:03:24.300 | 00:03:23.633 / `explicit` | Handoff correctly validates lease, records final checkpoint/resume information, releases claim, and leaves task in progress. |
| N13 | 00:03:24.300–00:03:44.533 | 00:03:43.867 / `find` | Web/Needs Attention beat correctly represents shared durable state; capture annotation honestly identifies the pre-handoff base. |
| N14 | 00:03:44.533–00:03:57.900 | 00:03:57.200 / `systems` | MCP, CLI, and Web are presented as complementary surfaces over one state, not separate systems. |
| N15 | 00:03:57.900–00:04:08.433 | 00:04:07.767 / `design` | Final CTA is local-first, concrete, and compatible with README quick start; quiet final hold remains. |

The 14 transition triplets show deliberate fade/rail continuity rather than cuts that
truncate narration. Exact-boundary frames are intentionally near-blank transition
frames; the preceding/following frames preserve the durable rail and do not flash a
legacy asset. Motion is restrained and captions remain protected during transitions.

## Caption, audio, and accessibility audit

- **Captions:** 38 WebVTT cues equal the 38 manifest cues exactly, in order; all 15
  locked narration blocks are represented. VTT starts at 00:00:00.450 and ends at
  00:04:07.105, within the master. Source layout uses 36 px semibold type, 1.24 leading,
  a two-line-safe 1360 px maximum, a 142 px lower protected band, 260 px side padding,
  and a 96% dark lower gradient. Visual inspection found no overflow or collision with
  terminal/UI text; white-on-dark captions have strong contrast.
- **Narration safety:** production metadata verifies all 15 clip hashes and locked
  timestamps. Each raw clip has 417–441 ms post-speech safety, 380–560 ms measured
  trailing quiet audio, and no clip ends inside its scene; manifest validation also
  rejects artificial audio/caption overflow and illegal overlap.
- **Audio limitation:** full stream decode and metadata are valid, but this QA runtime
  has no audio playback output. Consequently no subjective “human listened to every
  syllable” assertion is made. The locked character timestamps, final-word audit,
  encoded-tail measurements, 0.667–0.700 s scene tail holds, and complete decode provide
  structural evidence against clipped endings.
- **Motion / reduced motion:** stable scene frames are calm and readable; movement is
  confined to the explicit head/tail transition windows. The reduced-motion concurrent
  start still is stable and equivalent to normal at rest. No strobing, flashing, or
  rapid cursor choreography was observed.

## Factual product-semantics audit

The displayed named calls and statements match current README, `docs/mcp.md`, and the
shipped skill/core contracts:

- `projects_get`/`tasks_get` before claim; `start_work` with task, actor and session;
  `report` with phase/progress/checkpoint; and `handoff` with a final checkpoint are
  supported named lifecycle operations.
- Actionability is ready + all dependencies done + no active blocker. Two agents claim
  distinct actionable tasks; live claims are temporary leases, not permanent assignment.
- Typed criterion evidence stores provenance and does not run tests or complete tasks.
- Resolving `BLK-0097` returns the unclaimed task to ready; it does not auto-assign,
  execute, or complete the work.
- Decisions retain choice plus rationale; the handoff releases Codex while keeping
  `TASK-0421` in progress; Needs Attention identifies work requiring action.
- MCP is primary for agents and CLI/Web are views over the same domain state. No generic
  MCP command-execution, cloud/hosted, automatic-dispatch, or automatic-review claim was
  found.

## Technical evidence

| Check | Result |
| --- | --- |
| Master stream | 1920×1080, progressive H.264/avc1 High profile, `yuv420p`, 30/1 fps, 7,453 video frames |
| Master duration | video 248.433 s; audio/container 248.448 s (15 ms AAC/container delta) |
| Master audio | AAC, 48 kHz, stereo, 317 kb/s; valid full decode |
| Master size / rate | 28,445,230 bytes; container ~916 kb/s |
| 30 s sample | 1920×1080 H.264/yuv420p, 30/1 fps, 897 frames / 29.900 s video; AAC 48 kHz stereo / 29.909 s audio |
| Full decode | Remotion-bundled ffmpeg decoded video and audio to null successfully (exit 0) |
| Timeline | 15 measured scenes; `v2-validate-timing.mjs --self-test` passed and rejects negative overflow/overlap fixtures |
| Capture fixture | `v2-capture-verify.mjs` passed: 10 PNG captures, stable 8-task mapping, isolated workspace proof |
| Asset reference scan | No placeholder/debug/legacy reference except the two N09 `<fixture id>` strings cited in BLK-0009 |

## Required correction and re-QA scope

1. Replace the two N09 visible placeholder response strings with concrete proof labels,
   preferably `EV-0421-01` and `EV-0422-01` consistent with the fixture specification.
2. Render a new master and re-run full stream/decode, all-cue timing, all-scene and
   boundary-frame review, and a fresh independent release decision. Do not carry this
   FAIL forward merely because the source is corrected.

