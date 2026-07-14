import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import createNextIntlPlugin from 'next-intl/plugin';

// next-intl without locale routing (vi-only, ADR-019 · conventions §i18n): the request config
// supplies a fixed `vi` locale + the composed message catalog.
const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Workspace TS packages ship raw source (main → src/index.ts), so Next transpiles them.
  // @lumin/api-client (openapi-fetch client + generated types) is consumed from source too — it is
  // fetched server-side only (see lib/catalog.ts); its CORE_API_URL never reaches the client bundle.
  transpilePackages: ['@lumin/ui', '@lumin/core', '@lumin/tokens', '@lumin/api-client'],
  // Standalone server for the Docker image (o-1b): a self-contained .next/standalone/server.js.
  // outputFileTracingRoot pins the monorepo root so Next traces the transpiled @lumin/* workspace
  // deps (pnpm symlink layout) into the standalone bundle instead of leaving them out.
  output: 'standalone',
  outputFileTracingRoot: join(dirname(fileURLToPath(import.meta.url)), '../..'),
};

export default withNextIntl(nextConfig);
