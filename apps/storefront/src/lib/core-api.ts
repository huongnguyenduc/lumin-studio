import 'server-only';

// The ONE reader of core-api's base URL, shared by the server-only catalog reads (lib/catalog.ts) and
// the client-invoked price-quote Server Action (lib/quote.ts). Extracted here so both paths reach the
// backend through a single place that fails loudly when the var is missing — and so the `server-only`
// marker guarantees neither this reader nor CORE_API_URL is ever pulled into the client bundle (P1-f
// done-criterion: "no CORE_API_URL in client bundle", grep-verifiable).

/** Base URL of core-api, injected server-side only (never a NEXT_PUBLIC_ var → never in the client
 *  bundle). Thrown-not-defaulted: a silent localhost fallback in production would fail confusingly far
 *  from here (mirrors apps/admin/src/lib/dashboard-fetch.ts). */
export function coreApiBaseUrl(): string {
  const url = process.env.CORE_API_URL;
  if (!url) {
    throw new Error('CORE_API_URL is not set — the storefront cannot reach core-api.');
  }
  return url;
}
