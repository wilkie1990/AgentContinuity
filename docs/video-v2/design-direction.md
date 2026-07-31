# Agent Continuity V2 — design direction

## The subject

This film is about a durable execution record surviving the disappearance of the
session that created it. The viewer is a developer or engineering lead who already
knows that code can outlive a chat, but needs to see how the *working state around
the code* can outlive it too.

The visual argument is therefore one continuous journey:

`vanished session → populated project → safe claims → useful reports → evidence and
decisions → structured handoff → resumable project record`

The film must feel like a calm systems explanation, not a launch trailer and not an
abstract “AI swarm” demo.

## Subject signature: the durable execution rail

One horizontal execution rail — also described in editorial notes as the project bus —
is the recurring visual signature. A mint state capsule labelled `PRJ-0142` enters when
the original session disappears, travels through the board and both agent terminals,
collects small proof markers at reports/evidence/decisions, and remains after Codex
hands off.

The rail has semantic meaning:

- the rail is durable project state;
- terminal and browser surfaces are temporary stations attached to it;
- cyan is Codex, violet is Claude, and mint is the shared record neither agent owns;
- a claimed task attaches to the rail with an agent-coloured branch;
- a handoff removes the agent branch while leaving the mint state capsule and its next
  action intact.

The rail is not a progress bar and must never imply automatic execution. It carries
records, not agents.

## Palette tokens

| Token | Value | Role |
| --- | --- | --- |
| Night Ledger | `#09131F` | Canvas; the stable field in every scene |
| Raised Record | `#172B42` | Durable record surfaces and focused UI framing |
| Proof Ink | `#F4F7FB` | Primary copy and key values |
| Codex Cyan | `#54D8E8` | Codex-owned execution and MCP input |
| Durable Mint | `#86E2AA` | Shared state, evidence, continuity, successful persistence |
| Claude Violet | `#B6A2FF` | Claude-owned execution and UI work |

Muted text and borders may use the existing supporting tokens (`#AABBD0`,
`#2B4763`), but they are scaffolding rather than additional accents. Red/orange appears
only inside captured blocker/status truth; it is not an editorial brand colour.

## Typography roles

- **Display / thesis:** system sans, 58–76 px, tight tracking, at most two lines. Used
  for interruption, promise, interface topology, and final call to action.
- **Scene proposition:** system sans, 38–46 px, tight tracking. One consequence-led
  sentence above a product surface.
- **Record text:** system sans, 22–30 px. Used for project context, checkpoint fields,
  evidence meaning, and decision rationale.
- **Operational metadata:** system mono, 14–19 px, uppercase only for short labels.
  Used for task IDs, lifecycle names, session identities, file paths, and rail stations.
- **Captions:** system sans, 34–38 px, semibold, maximum two lines in a protected lower
  caption band. Captions never sit directly over detailed terminal or captured UI text.

Typography establishes hierarchy; boxes do not. A large assertion and one focused
artifact should carry each frame.

## Layout grammar

Every scene is built around a 104 px horizontal safe area and a protected caption band
from approximately y=900 to y=1010.

```text
┌──────────────────────────────────────────────────────────────────┐
│ proposition / scene consequence                     scene index │
│                                                                  │
│   temporary station ─────── [ PRJ-0142 STATE ] ───── station    │
│   terminal, board, evidence, decision, or handoff focus         │
│                                                                  │
│               protected two-line caption band                   │
└──────────────────────────────────────────────────────────────────┘
```

- The rail is a stable horizon, normally around the upper-middle or lower-third of the
  artifact region.
- Product captures retain their original 16:9 geometry and are cropped only through
  the existing focus metadata. Editorial cards may explain a state change but must not
  obscure the captured evidence.
- Two-column layouts are reserved for genuine comparison: vanished/current state,
  Codex/Claude, or MCP/CLI/Web. They are not a default card grid.
- Terminal panels attach above or below the project rail; the board is the rail expanded
  into a human-readable surface.
- Each scene has one primary focus target. Supporting labels stay quiet enough that a
  1080p still reads immediately.

## Transition grammar

All transition motion lives inside the 450 ms head and 700 ms tail holds around each
full narration clip.

1. The outgoing station settles while the mint rail and state capsule remain.
2. During tail room, the station recedes or masks along the rail.
3. The next scene begins with the same rail position and capsule; its station resolves
   during head room.
4. Once narration begins, the key artifact is stable. Motion may reveal lines or focus
   detail, but never competes with speech or captions.

Hard cuts are used for factual consequence; short rail wipes are used for continuity.
No transition overlaps or trims narration. Reduced-motion mode replaces travel,
parallax, and line drawing with stable states and opacity-only cuts.

## Scene-family treatment

- **Interruption and promise:** sparse field, vanished session residue, then the mint
  record remains. The first product surface arrives only after the problem is legible.
- **Populated project:** real CedarPay capture plus a concise objective/context plate.
  Dependency state is foregrounded; aggregate dashboard decoration is not.
- **Agent lifecycle:** import the approved concurrent-terminal scenes. Preserve the
  central shared project bus while Codex and Claude branches change independently.
- **Proof and project memory:** import the approved board scenes for checkpoints,
  evidence, blocker resolution, and decisions. The rail gains small labelled proof
  markers, never celebratory particles.
- **Handoff:** the Codex branch detaches; the state capsule retains checkpoint and next
  action. “Still in progress” remains visibly true.
- **Topology and close:** MCP, CLI, and Web attach to one record. The final frame leaves
  the rail populated and points to the local README quick start; it does not resemble a
  hosted-service sign-up.

## Self-critique: avoiding generic dashboard decoration

The existing foundation’s radial glows, grid overlays, pill badges, and arbitrary panel
stacks can easily read as generic developer-marketing decoration. They are acceptable
only when they clarify ownership, structure, or persistence.

The final edit therefore removes or subordinates:

- decorative grids that imply no product structure;
- radial gradients used merely to fill empty space;
- repeated rounded cards where a typographic hierarchy is clearer;
- status pills that duplicate visible task state;
- gratuitous cursor paths, particle effects, and “data flowing” animation;
- generic performance metrics or fake activity not present in the fixture.

The dark system palette is retained because it connects terminal and application
surfaces, but the distinctive identity comes from the durable rail and its changing
attachments. If a visual element cannot answer “what state persisted, who owns this
execution, or what changed?”, it should be removed.

