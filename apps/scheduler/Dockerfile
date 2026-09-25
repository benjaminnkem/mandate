# Build context is the repo root (this app depends on sibling workspace packages).
# Render: set "Dockerfile Path" to apps/scheduler/Dockerfile and "Docker Build Context Directory" to the repo root.
#
# Same reasoning as apps/indexer/Dockerfile: runs as a Render "Web Service" via its OPS_PORT health server,
# since the free tier has no Background Worker option. Set OPS_PORT and PORT to the same value in Render.
#
# Uses a filtered `pnpm install`, not `pnpm deploy`: workspace packages ship raw .ts (no build step,
# executed via Node's native TypeScript stripping) and Node refuses to strip types for files physically
# located under node_modules. `pnpm install` keeps them as symlinks to their real location outside
# node_modules (same as local dev); `pnpm deploy` copies them into node_modules and breaks at runtime.

FROM node:24-slim AS deps
RUN corepack enable && corepack prepare pnpm@11.25.0 --activate
WORKDIR /repo
COPY . .
RUN pnpm --filter @mandate/scheduler... install --frozen-lockfile --prod

FROM node:24-slim AS runner
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=deps /repo .
EXPOSE 9102
CMD ["node", "apps/scheduler/src/main.ts"]
