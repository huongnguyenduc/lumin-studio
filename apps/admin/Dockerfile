# syntax=docker/dockerfile:1
# admin (Next 15, App Router) — pnpm-monorepo multi-stage → standalone runtime.
# Build context = repo ROOT (needs pnpm-workspace.yaml + packages/*). See infra/docker-compose.yml.
#
# Unlike storefront the admin build is HERMETIC: every admin route is auth-gated (dynamic, reads the
# session cookie) so nothing ISR-prerenders → `next build` needs no live core-api and no SITE_URL.
# CORE_API_URL is request-time only (Server Actions / route handlers), injected at runtime by compose.

FROM node:20-alpine AS base
# libc6-compat: musl shim so Next's SWC binary loads on alpine. corepack: pins pnpm@ from package.json.
RUN apk add --no-cache libc6-compat && corepack enable
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
WORKDIR /app

# --- deps: install the whole workspace from manifests only (install layer caches until a manifest
# or the lockfile changes). Every workspace member's package.json must be present or --frozen-lockfile
# fails; add new members here. ---
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/storefront/package.json apps/storefront/
COPY apps/admin/package.json apps/admin/
COPY apps/extension/package.json apps/extension/
COPY packages/api-client/package.json packages/api-client/
COPY packages/core/package.json packages/core/
COPY packages/tokens/package.json packages/tokens/
COPY packages/ui/package.json packages/ui/
RUN pnpm install --frozen-lockfile

# --- build: overlay source onto the installed workspace, then `next build`. The @lumin/* deps are
# transpiled from source (transpilePackages), so no per-package prebuild is needed. ---
FROM base AS build
COPY --from=deps /app ./
COPY . .
RUN pnpm --filter @lumin/admin build

# --- runtime: the standalone server only, non-root. The monorepo standalone mirrors the tracing root
# (repo root), so server.js sits at apps/admin/server.js and .next/static is copied in beside it. ---
FROM base AS runtime
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000
RUN addgroup -S app && adduser -S app -G app
USER app
COPY --from=build --chown=app:app /app/apps/admin/.next/standalone ./
COPY --from=build --chown=app:app /app/apps/admin/.next/static ./apps/admin/.next/static
EXPOSE 3000
CMD ["node", "apps/admin/server.js"]
