# Session integrations

Agent Continuity can install optional, project-scoped lifecycle reminders for Codex and
Claude Code. The integration is deliberately read-only. Startup does not query workspace
state, and Stop reads only claims and checkpoint freshness for the exact provider
session. Neither hook creates heartbeat, progress, checkpoint, or activity records.

## Install or remove

Build the repository first, then enable the integration for one client:

```bash
pnpm build
node apps/cli/dist/bin.js install --client codex --session-integration enable
node apps/cli/dist/bin.js install --client claude-code --session-integration enable
```

Lifecycle integration defaults to `skip`, including on ordinary installer reruns. To
remove it explicitly:

```bash
node apps/cli/dist/bin.js install --client codex --session-integration remove
node apps/cli/dist/bin.js install --client claude-code --session-integration remove
```

Enable, repeat, and remove operations preserve unrelated provider settings and handlers.
Before changing an existing hook file, the installer writes the adjacent deterministic
backup `<file>.agent-continuity.bak`. `--dry-run` reports the planned hook change without
writing it.

## What the hooks do

`SessionStart` supplies only the provider's validated, opaque `session_id` and a fixed
instruction to use it when this conversation explicitly starts or resumes tracked work.
It makes no service request and never injects Needs Attention, project or task details,
blockers, or user-authored text. The Agent Continuity skill requests `attention_list` on
demand only after the conversation is actually managing tracked work.

`Stop` performs one bounded request for live claims whose `sessionId` exactly matches the
provider's current `session_id`. It is silent when there is no matching claim or every
matching execution has a current checkpoint. A checkpoint becomes stale when meaningful
task activity is recorded after it; heartbeat, claim-renewal, execution-start/resume and
checkpoint events are treated as lifecycle noise. A missing or stale checkpoint asks the
client for one continuation so the agent can record an honest checkpoint or hand off.
The provider's `stop_hook_active` flag suppresses a second continuation.

The command hook has a three-second provider timeout and the Stop API request has a
1.5-second timeout. Malformed input, connection failures, timeouts, and unexpected API
responses all fail open with no output, so a missing local service cannot prevent a
session boundary.

For Stop association to work, claim the task with the exact provider session id supplied
at SessionStart. A claim made with a different or absent session id cannot be safely
attributed to the current session and will not produce a reminder.

## Codex

Codex installs the project hook at `.codex/hooks.json`. The provider officially supports
project `hooks.json`, `SessionStart` developer context, `Stop` continuation prompts, and
the `session_id` and `stop_hook_active` input fields. The startup developer context is
therefore deliberately limited to opaque identity metadata. Project hooks load only for
trusted projects. New or changed non-managed hooks are skipped until you inspect and
trust their exact definition with `/hooks`.

The integration follows the current official [Codex Hooks documentation](https://learn.chatgpt.com/docs/hooks).
It uses `Stop`, not `SessionEnd`, because `SessionEnd` is advisory and cannot steer Codex
or keep a thread open.

## Claude Code

Claude Code installs the project hook at `.claude/settings.json`. It uses the documented
`SessionStart` additional context only for the opaque identity bridge and uses the
documented `Stop` continuation behavior. As with Codex, the integration checks
`stop_hook_active` to avoid an infinite continuation loop.

The integration follows the current official [Claude Code Hooks reference](https://code.claude.com/docs/en/hooks).
