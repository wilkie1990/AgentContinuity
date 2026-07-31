# Agent Continuity product demo video

The V2 Remotion production is a 1920×1080, 30 fps product demo driven by the measured
Lily narration and caption timing in `src/v2/production-manifest.json`. It demonstrates
Codex and Claude working concurrently against the same durable CedarPay project through
the skill, typed MCP lifecycle, CLI, and real web UI captures.

The independently verified publication package is in
[`deliverables/v2/`](deliverables/v2/):

- [`agent-continuity-product-demo-v2-1080p.mp4`](deliverables/v2/agent-continuity-product-demo-v2-1080p.mp4)
- [`agent-continuity-product-demo-v2-poster.png`](deliverables/v2/agent-continuity-product-demo-v2-poster.png)
- [`agent-continuity-product-demo-v2.en.vtt`](deliverables/v2/agent-continuity-product-demo-v2.en.vtt)
- [`agent-continuity-product-demo-v2-source-assets.tar.gz`](deliverables/v2/agent-continuity-product-demo-v2-source-assets.tar.gz)
- [`manifest.json`](deliverables/v2/manifest.json), including hashes, stream facts,
  narration provenance, reproducible commands, and the independent PASS decision

The prior delivery files under `deliverables/` remain recoverable as legacy artifacts;
the V2 package is the current verified demo.

## Reproduce and verify

Run commands from the repository root. Generated review and render outputs stay under
the ignored `apps/video/out/` workspace.

```bash
pnpm --filter @agent-continuity/video typecheck:v2
pnpm --filter @agent-continuity/video validate:v2
node apps/video/scripts/v2-capture-verify.mjs
```

Render the representative simultaneous-agent poster frame:

```bash
pnpm --filter @agent-continuity/video exec remotion still \
  src/v2/index.ts AgentContinuityProductDemoV2 \
  out/v2/review-n07.png --frame=3149
```

Render an N09 review segment and the complete release candidate:

```bash
pnpm --filter @agent-continuity/video exec remotion render \
  src/v2/index.ts AgentContinuityProductDemoV2 out/v2/review-n09.mp4 \
  --frames=4280-4490 --codec=h264 --audio-codec=aac \
  --pixel-format=yuv420p --crf=18

pnpm --filter @agent-continuity/video exec remotion render \
  src/v2/index.ts AgentContinuityProductDemoV2 \
  out/v2/agent-continuity-product-demo-v2-corrected-rc1.mp4 \
  --codec=h264 --audio-codec=aac --pixel-format=yuv420p --crf=18 \
  --concurrency=2
```

Narration is reproducible from the locked N01–N15 script using
`scripts/v2-generate-lily.mjs`. It requires a local credential file at generation time;
credentials are not stored in production metadata, archives, manifests, or deliverables.

Independent release records are
[`docs/video-v2/qa-report.md`](../../docs/video-v2/qa-report.md) and
[`docs/video-v2/qa-recheck.md`](../../docs/video-v2/qa-recheck.md). The corrected RC1
received the fresh independent **PASS**.
