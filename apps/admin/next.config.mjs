import createNextIntlPlugin from 'next-intl/plugin';

// next-intl without locale routing (vi-only, ADR-019 · conventions §i18n): the request config
// supplies a fixed `vi` locale + the composed message catalog.
const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Workspace TS packages ship raw source (main → src/index.ts), so Next transpiles them.
  transpilePackages: ['@lumin/ui', '@lumin/core', '@lumin/tokens'],
};

export default withNextIntl(nextConfig);
