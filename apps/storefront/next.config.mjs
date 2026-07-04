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
};

export default withNextIntl(nextConfig);
