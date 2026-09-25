# Build context is the repo root (this app depends on sibling workspace packages).
# Render: set "Dockerfile Path" to apps/api/Dockerfile and "Docker Build Context Directory" to the repo root.
#
# Uses a filtered `pnpm install`, not `pnpm deploy`: workspace packages ship raw .ts (no build step,
# executed via Node's native TypeScript stripping) and Node refuses to strip types for files physically
# located under node_modules. `pnpm install` keeps them as symlinks to their real location outside
# node_modules (same as local dev); `pnpm deploy` copies them into node_modules and breaks at runtime.

FROM node:24-slim AS deps
RUN corepack enable && corepack prepare pnpm@11.25.0 --activate
WORKDIR /repo
COPY . .
RUN pnpm --filter @mandate/api... install --frozen-lockfile --prod

FROM node:24-slim AS runner
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=deps /repo .
# Render injects PORT; apps/api already reads it via env.PORT and binds 0.0.0.0.
EXPOSE 3001
CMD ["node", "apps/api/src/main.ts"]
