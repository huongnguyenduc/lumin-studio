import process from 'node:process';
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
  // Browser calls hit the same origin (/api/*) and Next proxies to wedding-api —
  // no client-side API URL config, works identically in dev and k3s.
  async rewrites() {
    const api = process.env.WEDDING_API_URL ?? 'http://localhost:8081';
    return [{ source: '/api/:path*', destination: `${api}/api/:path*` }];
  },
  // Standalone server for the Docker image; tracing root pinned to the monorepo root
  // (pnpm symlink layout) — same trick as apps/storefront.
  output: 'standalone',
  outputFileTracingRoot: join(dirname(fileURLToPath(import.meta.url)), '../..'),
};

export default withNextIntl(nextConfig);
