# syntax=docker/dockerfile:1
# wedding-web (Next 15, App Router) — pnpm-monorepo multi-stage → standalone runtime.
# Build context = repo ROOT (needs pnpm-workspace.yaml + the workspace manifests).
#
# Unlike storefront there is NO build-time API dependency: every page is
# force-dynamic (SSR per request), so the build never calls wedding-api.
# WEDDING_API_URL is still a build ARG because next.config.mjs bakes the
# /api/* rewrite destination at build time — pass the in-cluster Service URL.

FROM node:20-alpine AS base
RUN apk add --no-cache libc6-compat && corepack enable
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/storefront/package.json apps/storefront/
COPY apps/admin/package.json apps/admin/
COPY apps/extension/package.json apps/extension/
COPY apps/wedding-web/package.json apps/wedding-web/
COPY packages/api-client/package.json packages/api-client/
COPY packages/core/package.json packages/core/
COPY packages/tokens/package.json packages/tokens/
COPY packages/ui/package.json packages/ui/
RUN pnpm install --frozen-lockfile

FROM base AS build
ARG WEDDING_API_URL
ENV WEDDING_API_URL=$WEDDING_API_URL
COPY --from=deps /app ./
COPY . .
RUN pnpm --filter @lumin/wedding-web build

FROM base AS runtime
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000
RUN addgroup -S app && adduser -S app -G app
USER app
COPY --from=build --chown=app:app /app/apps/wedding-web/.next/standalone ./
COPY --from=build --chown=app:app /app/apps/wedding-web/.next/static ./apps/wedding-web/.next/static
COPY --from=build --chown=app:app /app/apps/wedding-web/public ./apps/wedding-web/public
EXPOSE 3000
CMD ["node", "apps/wedding-web/server.js"]
