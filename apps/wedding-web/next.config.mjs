import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import createNextIntlPlugin from 'next-intl/plugin';

// next-intl without locale routing (vi-only, same setup as storefront): the request
// config supplies a fixed `vi` locale + message catalog. The wedding site has its own
// design system (HANDOFF §7) — it deliberately does NOT pull @lumin/ui or @lumin/tokens.
const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Standalone server for the Docker image; tracing root pinned to the monorepo root
  // (pnpm symlink layout) — same trick as apps/storefront.
  output: 'standalone',
  outputFileTracingRoot: join(dirname(fileURLToPath(import.meta.url)), '../..'),
};

export default withNextIntl(nextConfig);
