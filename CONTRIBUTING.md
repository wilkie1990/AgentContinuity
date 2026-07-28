# Contributing to Agent Continuity

Thanks for contributing. Agent Continuity is a local-first TypeScript monorepo; keep
domain rules in `packages/core` and keep REST, MCP, CLI, and web changes aligned with
the shared contracts.

## Local setup

Use Node.js 24 or newer and the pnpm version pinned in `package.json`.

```bash
corepack enable
pnpm install --frozen-lockfile
```

## Validate a change

Run the checks relevant to your change before opening a pull request. For a normal
application change, run the full set:

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

`test:e2e` uses Playwright and may require browser binaries locally:

```bash
pnpm exec playwright install chromium
```

## Change expectations

- Keep changes focused and include tests for behaviour changes.
- Preserve the database migration history: add a new migration rather than editing an
  applied migration.
- Update shared contracts and every affected adapter together.
- Do not commit generated build output, local databases, credentials, or secrets.
- Describe validation performed and any intentional limitations in the pull request.

By contributing, you agree that your contribution is licensed under the
[Apache License 2.0](LICENSE).
