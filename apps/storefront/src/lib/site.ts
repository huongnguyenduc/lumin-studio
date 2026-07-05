import 'server-only';

// The ONE reader of the storefront's own public origin, used server-side to emit ABSOLUTE URLs into the
// HTML head + SEO route files: canonical links, the sitemap, robots.txt, and Open Graph image tags
// (P1-q). Mirrors lib/core-api.ts: a single place that fails loudly when the var is missing, and the
// `server-only` marker keeps it out of the client bundle.

/** Public origin of the storefront — scheme + host, no trailing slash (e.g. `https://luminstudio.vn`).
 *  Thrown-not-defaulted, exactly like coreApiBaseUrl(): a silent localhost fallback would ship broken
 *  canonical / OG / sitemap URLs to search + social crawlers, failing confusingly far from here (a wrong
 *  base is worse than a loud one — it de-indexes the site or points every share card at localhost). Set
 *  SITE_URL in the deploy env (and apps/storefront/.env.example) alongside CORE_API_URL. */
export function siteBaseUrl(): string {
  const url = process.env.SITE_URL;
  if (!url) {
    throw new Error('SITE_URL is not set — the storefront cannot emit canonical/OG/sitemap URLs.');
  }
  // Normalise away any trailing slash so `${base}${path}` (path starts with `/`) never doubles it.
  return url.replace(/\/+$/, '');
}
