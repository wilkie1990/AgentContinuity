# V2 corrected RC1 independent re-QA

**Verdict: PASS.** This addendum re-audits the corrected rendered release candidate, not a binary diff. It closes the single release blocker in the original [V2 QA report](qa-report.md): N09 no longer displays an unresolved `Evidence <fixture id> (test) attached.` placeholder.

## Candidate and method

- Candidate: `apps/video/out/v2/agent-continuity-product-demo-v2-corrected-rc1.mp4`
- SHA-256: `e7022d0821a1dd56bc5dea4abb2c66b422ecea1d02c605099e92d71815f08332` (exact expected value; see `apps/video/out/v2/qa/recheck/candidate-sha256.txt`).
- Scope: the RC1 render, the corrected N09 source and storyboard contract, plus the timing/caption/audio artifacts that drive the render. No production or delivery artifact was changed by this review.
- Evidence artifacts: `apps/video/out/v2/qa/recheck/` contains stream facts, a strict full decode log, source-string scan, timing/capture validation, manifest/caption/audio audit, and the sampled rendered frames.

## Rendered N09 correction — PASS

I inspected the candidate at the correction itself, across the reveal and its boundaries:

| Timecode | Observed rendered result | Result |
| --- | --- | --- |
| 02:23.900 | Both agents are at the typed `tasks_add_criterion_evidence` call; no residual placeholder appears. | PASS |
| 02:24.500 | The response begins revealing in both panels; no `fixture id` text. | PASS |
| 02:26.000 | Fully readable results: `Recorded test evidence · webhook-consumer.test.ts · passed · criterion 1` and `Recorded test evidence · ReplayHistory.test.tsx · passed · criterion 2`. | PASS |
| 02:28.000 | Both results remain legible with `TASK STATUS · in_progress`; captions explicitly distinguish evidence storage/provenance from running a test or completing the task. | PASS |
| 02:29.500 / 02:29.700 / 02:29.900 | N09 exit is clean, then the intentional dark transition, then N10 begins; no stale response or legacy text leaks across the boundary. | PASS |

The final N09 copy agrees with the corrected source and storyboard: the typed call records criterion evidence, the `passed` outcome describes the attached test evidence, and task status remains `in_progress`. This accurately represents the capability: evidence attachment neither executes a test nor marks a task complete. Frames: `n09-before.jpg`, `n09-reveal.jpg`, `n09-full.jpg`, `n09-after.jpg`, `n09-end.jpg`, `n09-n10-boundary.jpg`, and `n10-after.jpg`.

## Content and representative visual audit — PASS

- Targeted visible-string scan over V2 scene/component runtime content, V2 public assets, and the storyboard found no `fixture id`, `placeholder`, `debug`, `TODO`, `FIXME`, or `legacy` narration artifact (`visible-string-scan.txt`). This deliberately treats TSX element syntax as syntax, not screen text.
- Corrected source has the exact two rendered N09 result strings at `apps/video/src/v2/scenes/concurrent-agents.tsx` lines 135 and 234; the storyboard repeats the same approved copy at lines 184 and 204.
- Representative RC1 frames were independently inspected: intro 00:07.067, populated board 00:54.000, concurrent start 01:27.000, handoff 03:15.700, and CTA 04:03.000. Each is readable, coherent with the caption treatment, and free of the reported placeholder/debug issue.
- Reduced-motion support remains wired from `ProductDemoV2` through each scene. The correction changes N09 response text only; the existing stable reduced-motion concurrent-start render was also checked (`apps/video/out/v2/qa/concurrent-start-reduced-motion.png`).

## Technical, timing, caption, and narration checks — PASS

- `ffprobe` reports H.264/AVC `yuv420p`, 1920×1080, progressive 30 fps, 7,453 video frames / 248.433333 s, with AAC 48 kHz stereo audio and 248.448 s container duration (`stream-facts.json`).
- Strict full decode of both mapped streams completed with exit 0 and an empty error log (`full-decode.log`, `full-decode-status.txt`).
- `v2-validate-timing.mjs --self-test` passed: 15 scenes / 7,453 frames, including negative narration-overflow, caption-overflow, and overlap checks. Capture verification passed: 10 PNG captures, stable eight-task mapping, and isolated-workspace proof (`timing-validation.log`, `capture-verification.log`).
- The fresh manifest/caption/audio audit confirms 15 scenes, 7,453 frames, 38 VTT cues exactly matching the manifest’s 38 cue texts, 15 present Lily clips, matching scene IDs, and post-speech safety tails of 417–441 ms (`manifest-caption-audio-audit.json`).

I verified the timing, caption text/timing contract, and audio-tail metadata. I did **not** perform human listening: this environment has no reliable audio-monitoring path. That limitation does not invalidate the decode, stream, caption, or measured-tail checks, but it means perceived voice quality and mix balance were not independently assessed here.

## Regression and blocker disposition

The original report was a release **FAIL** solely because original N09 rendered `Evidence <fixture id> (test) attached.` in both panels. RC1 removes that exact visible failure and replaces it with complete, readable, semantically accurate evidence results. No new release blocker or regression was found in the sampled render, deterministic artifact checks, or corrected source/storyboard contract. Independent re-QA is therefore **PASS**.
