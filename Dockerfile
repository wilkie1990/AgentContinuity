# Build all TypeScript packages and the web UI from the lockfile-pinned source.
# Keep the Docker Hub official image as the normal default. The argument also lets
# constrained local environments use an official Node mirror for verification.
ARG NODE_IMAGE=node:24-bookworm-slim
FROM ${NODE_IMAGE} AS build

WORKDIR /workspace
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json tsconfig.build.json tsconfig.json vitest.config.ts ./
COPY apps ./apps
COPY packages ./packages

RUN pnpm install --frozen-lockfile
RUN pnpm build \
  && pnpm --filter @agent-continuity/server --prod deploy --legacy /runtime

# The service has no authentication, so Compose deliberately publishes this only to
# loopback. This image itself listens on all container interfaces so Docker can route
# the published loopback port and run its health check.
FROM ${NODE_IMAGE} AS runtime

ENV NODE_ENV=production \
    AGENT_CONTINUITY_HOST=0.0.0.0 \
    AGENT_CONTINUITY_PORT=4732 \
    AGENT_CONTINUITY_DATA_DIR=/data \
    AGENT_CONTINUITY_DATABASE_PATH=/data/workspace.db

RUN groupadd --gid 10001 agentcontinuity \
  && useradd --uid 10001 --gid agentcontinuity --create-home --home-dir /app --shell /usr/sbin/nologin agentcontinuity \
  && mkdir /data \
  && chown agentcontinuity:agentcontinuity /data

WORKDIR /app
COPY --from=build --chown=agentcontinuity:agentcontinuity /runtime/ ./
# defaultWebRoot resolves this path from the deployed server's /app/dist directory.
COPY --from=build --chown=agentcontinuity:agentcontinuity /workspace/apps/web/dist /web/dist

USER agentcontinuity

EXPOSE 4732

HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=6 \
  CMD node -e "fetch('http://127.0.0.1:' + process.env.AGENT_CONTINUITY_PORT + '/health').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "dist/bin.js"]
