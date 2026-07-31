# V2 production audit and boundary

Date: 2026-07-28  
Scope: inspection only; this document does not author or modify a video scene.

## Guardrails

- Treat every existing video composition, source scene, capture, audio clip, render,
  still, and deliverable as **legacy reference material**.  Do not rename, delete,
  overwrite, or publish over it.
- The worktree was already dirty before this audit: `pnpm-lock.yaml` is modified.
  It is unrelated to V2 and is explicitly out of scope for all video tasks.
- `apps/video/public`, `apps/video/build`, `apps/video/out`, and most of
  `apps/video/deliverables` are ignored by Git.  A successful render is therefore
  not source provenance; V2 must retain its own reproducible manifest/QA records.
- The existing two tracked legacy deliverables are
  `deliverables/agent-continuity-how-to-1080p.mp4` and
  `deliverables/agent-continuity-how-to-poster.png`.  Preserve them unchanged.

## Current inventory and disposition

| Area / current artifact | Disposition | Rationale |
| --- | --- | --- |
| `src/Root.tsx`, composition `AgentContinuityHowTo`, and `HowToVideo.tsx` | Replace | Single legacy composition and fixed frame budget; V2 is a new audience-first story whose duration must follow final audio. |
| `src/scenes.tsx`, `src/narration.ts`, `src/assets.ts` | Replace | Legacy seven-scene walkthrough, old cue timing, and old capture map cannot define V2. |
| `src/tokens.ts`, `src/motion.ts`, `src/types.ts` | Adapt | 1920x1080/30fps constants, safe areas, type shapes, and general motion helpers are useful only after copying/revalidating under V2 ownership. |
| `src/components/VideoShell.tsx`, `TerminalFrame.tsx`, `BrowserFrame.tsx`, `Caption.tsx`, `Callout.tsx`, `FocusTarget.tsx`, `GuidedCursor.tsx`, `SceneKicker.tsx`, `SectionTransition.tsx`, `TitleCard.tsx`, `ContinuityThread.tsx` | Adapt | These are generic visual primitives, but their legacy styling and assumptions must not force the V2 scene plan. Copy selectively into a V2 component namespace; do not edit originals. |
| `src/index.ts` and Remotion dependency/configuration | Reuse | Registration pattern and Remotion 4.0.499 package foundation are valid infrastructure. Add a new V2 root/entry rather than changing the old composition. |
| `package.json` scripts: `studio`, `bundle`, `typecheck`, `render`, `render:sample` | Adapt | Studio/bundle/typecheck commands are reusable; both render scripts hard-code `AgentContinuityHowTo` and legacy output names, so V2 needs distinct commands and paths. |
| `public/captures/*` (13 1920x1080 PNGs plus terminal SVG sources) | Replace | They show the prior narrow walkthrough and do not represent the required rich shared demo project or concurrent agents. SVGs remain useful only as a capture-format precedent. |
| `build/public/captures/*` | Replace | Build copy of the same legacy capture set; not a V2 source-of-truth location. |
| `public/audio/fal/` (11 MP3s and `fal-production.json`) | Replace | Older narration content/timing. Retain as schema reference only. |
| `public/audio/lily/` (7 Lily MP3s, `fal-production.json`, one per-scene JSON) | Replace | This is the prior Lily pass, tied to a different seven-scene story. It must not be mixed into V2. |
| `public/audio/voice-production.json`, legacy WAV/text drafts, old VTT | Replace | Useful evidence of prior production metadata but no longer authoritative script/captions. |
| `build/public/audio/*` | Replace | Build copy of legacy assets; do not treat as editable source. |
| `deliverables/agent-continuity-how-to-*` | Preserve / do not reuse | Tracked legacy deliverables; protected from V2 writes. |
| ignored Lily deliverables, `deliverables/manifest.json`, and `out/*` review renders/stills | Preserve / do not reuse | Historical review/export evidence; V2 must emit different names and a new manifest. |

## Existing audio-production metadata (safe summary)

Both `public/audio/fal/fal-production.json` and
`public/audio/lily/fal-production.json` use a metadata shape with `model`,
`settings`, and `scenes`. Settings include voice and synthesis controls
(`apply_text_normalization`, `language_code`, `output_format`, `seed`,
`similarity_boost`, `speed`, `stability`, `timestamps`); each scene has an
`index`, `file`, `text`, and timestamp array. The Lily metadata covers seven clips;
the older fal directory covers eleven. `voice-production.json` is a simpler
draft manifest with voice/source/rates and per-scene text.

No environment-variable identifiers are referenced by the existing `apps/video`
source or package scripts. For the required fal-hosted ElevenLabs generation, the
production runner must require and document `FAL_KEY` (name only; never log, embed,
or commit its value). The voice must be Lily, while exact model/settings remain in a
redacted V2 metadata manifest and generated timing data.

## Clean V2 namespace and ownership map

All new production source lives under `apps/video/src/v2/`; legacy `src/*.ts(x)`
remains read-only. All V2 generated material has a `v2-` prefix and its own
directory to prevent output collisions.

| Owner task | Exclusive V2 paths | Responsibility / handoff boundary |
| --- | --- | --- |
| TASK-0050 storyboard | `docs/video-v2/script.md`, `docs/video-v2/storyboard.md` | Locks narration text and shot IDs; does not touch Remotion or media assets. |
| TASK-0051 foundation | `apps/video/src/v2/{index.ts,Root.tsx,ProductDemoV2.tsx,tokens.ts,motion.ts,types.ts,timing.ts,components/}`, `apps/video/scripts/v2-validate-timing.mjs` | Defines composition ID `AgentContinuityProductDemoV2`, audio-safe sequencing, shared primitives, and validation contract. |
| TASK-0052 captures | `apps/video/public/v2/captures/`, `apps/video/src/v2/captures.ts`, `apps/video/scripts/v2-capture-*` | Produces fresh fixture-backed captures and their dimensions/focus metadata only. |
| TASK-0053 voice/captions | `apps/video/public/v2/audio/lily/`, `apps/video/public/v2/captions/agent-continuity-product-demo-v2.en.vtt`, `apps/video/public/v2/audio/lily/production.json`, `apps/video/scripts/v2-generate-lily.mjs` | Owns generated Lily clips, timestamp-derived cue data, captions, and safe/redacted provenance. |
| TASK-0054 concurrent demo | `apps/video/src/v2/scenes/concurrent-agents.tsx`, `apps/video/src/v2/components/ConcurrentTerminal.tsx` | Implements the Codex/Claude sequence against capture/fixture contracts. |
| TASK-0055 UI walkthrough | `apps/video/src/v2/scenes/shared-state.tsx`, `apps/video/src/v2/components/ProjectBoard.tsx` | Implements the rich project/web state sequence against capture contracts. |
| TASK-0056 assembly | `apps/video/src/v2/scenes/`, `apps/video/src/v2/scene-plan.ts`, `apps/video/src/v2/audio-mix.ts` | Integrates approved scenes only after contracts are available; resolves sequence timing from TASK-0053 assets. |
| TASK-0057 QA | `apps/video/out/v2/qa/`, `docs/video-v2/qa-report.md` | Writes review evidence only; no source scene edits. |
| TASK-0058 delivery | `apps/video/out/v2/`, `apps/video/deliverables/v2/` | Produces `agent-continuity-product-demo-v2-1080p.mp4`, poster, VTT, and `manifest.json`; never writes legacy `deliverables/*` names. |

The package owner should add distinct scripts such as `render:v2`,
`render:v2:sample`, and `validate:v2` that use `AgentContinuityProductDemoV2` and
`out/v2/`. Any `package.json` edit is a coordination point and must be made once,
preferably by TASK-0051; other agents invoke those scripts rather than changing them.

## Required V2 output contract

- Composition: `AgentContinuityProductDemoV2`, 1920x1080 at 30 fps, duration derived
  from final Lily clip durations plus explicit head/tail room.
- Source: V2 root, scene plan, capture map, and audio timing/validation files stay in
  the exclusive namespaces above; no patching legacy `HowToVideo` or `scenes.tsx`.
- Inputs: `public/v2/captures/`, `public/v2/audio/lily/`, and `public/v2/captions/`.
- Temporary/review render: `out/v2/` (including samples, stills, and QA frames).
- Publication: `deliverables/v2/agent-continuity-product-demo-v2-1080p.mp4`,
  `...-poster.png`, `...en.vtt`, and `manifest.json`; render H.264/YUV420p.
- Validation: reject audio whose duration exceeds its scene, caption cues outside
  available audio/scene time, and output paths outside the V2 namespace.

## Inspection evidence

Observed package: `@agent-continuity/video`, Remotion 4.0.499; the existing render
script emits H.264/YUV420p (`--codec=h264 --pixel-format=yuv420p --crf=18`) but
targets the legacy composition/output. Current source has one root composition and
roughly 740 source lines, including ten generic components. Captures are all 1920x1080.
The legacy source README describes a prior 6,300-frame walkthrough, while the checked
`tokens.ts` composition currently uses 3,510 frames: further reason not to inherit its
timing as V2 truth.
