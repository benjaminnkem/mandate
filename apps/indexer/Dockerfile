# Build context is the repo root (this app depends on sibling workspace packages).
# Render: set "Dockerfile Path" to apps/indexer/Dockerfile and "Docker Build Context Directory" to the repo root.
#
# This is a background chain-follower, not an HTTP API, but it exposes /healthz, /readyz, /metrics on
# OPS_PORT (packages/observability/src/ops-server.ts) so it can run as a Render "Web Service" (free tier
# only supports Web Services, not Background Workers). Set the Render env vars OPS_PORT and PORT to the
# SAME value so Render's port detection lines up with what this process actually listens on.
#
# Uses a filtered `pnpm install`, not `pnpm deploy`: workspace packages ship raw .ts (no build step,
# executed via Node's native TypeScript stripping) and Node refuses to strip types for files physically
# located under node_modules. `pnpm install` keeps them as symlinks to their real location outside
# node_modules (same as local dev); `pnpm deploy` copies them into node_modules and breaks at runtime.

FROM node:24-slim AS deps
RUN corepack enable && corepack prepare pnpm@11.25.0 --activate
WORKDIR /repo
COPY . .
RUN pnpm --filter @mandate/indexer... install --frozen-lockfile --prod

FROM node:24-slim AS runner
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=deps /repo .
EXPOSE 9101
CMD ["node", "apps/indexer/src/main.ts"]
