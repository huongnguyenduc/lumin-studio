import 'server-only';
import { createApiClient } from '@lumin/api-client';
import { toProductCardView, type ProductCardView } from './product-view';

// SERVER-ONLY catalog reads. This module imports the openapi-fetch client and reads CORE_API_URL, so it
// must never be pulled into the client bundle — it is imported only by the async server page.tsx. The
// client `FeaturedProducts` imports the VIEW TYPE from ./product-view (type-only, erased), never this
// file. (P1-f done-criterion: "no CORE_API_URL in client bundle" — grep-verifiable.)
//
// The `import 'server-only'` above turns that discipline into a COMPILER ERROR: any future client
// component that value-imports this module fails the build (mirrors the guard apps/admin's
// dashboard-fetch.ts gets for free via its next/headers import — this public catalog read needs no
// cookie, so it takes the guard explicitly). product-view.ts deliberately does NOT get this marker: it
// is type-only-imported by the client grid, so it must stay client-safe.

/** Base URL of core-api, injected server-side only (never a NEXT_PUBLIC_ var, so it never enters the
 *  client bundle). Thrown-not-defaulted: a silent localhost fallback in production would fail
 *  confusingly far from here (mirrors apps/admin/src/lib/dashboard-fetch.ts). */
function coreApiBaseUrl(): string {
  const url = process.env.CORE_API_URL;
  if (!url) {
    throw new Error('CORE_API_URL is not set — the storefront cannot reach core-api.');
  }
  return url;
}

/** How many "Mới về" (new arrivals) cards the home preview shows — 2 full rows of the 4-up desktop
 *  grid. The full catalog with filters/paging is the /san-pham browse surface (P1-g), not the home. */
const NEW_ARRIVALS_PAGE_SIZE = 8;

/**
 * Fetch the newest active products for the home "Mới về" grid.
 *
 * Caching (Q1 decision, user 2026-07-04 — on-write purge + backstop): the fetch is tagged `catalog`,
 * so a future core-api product-change webhook (POST /api/revalidate, see app/api/revalidate) can
 * `revalidateTag('catalog')` to bust it INSTANTLY when a price/status/stock changes. The 300s
 * `revalidate` is a BACKSTOP ceiling — webhooks get missed on restarts/network blips, and until the
 * emit-side lands with the admin product-CRUD surface the timer is the ONLY refresh, so a tag without
 * a timer would freeze the grid at its last render. A ≤5-min-stale CARD price is cosmetic, never a
 * money-integrity risk: checkout re-prices server-side via POST /price/quote (P1-b), so the card price
 * is display-only.
 *
 * Throws on a non-2xx response or a network failure (origin down) so the route error boundary
 * (app/error.tsx) renders the "thử lại" state rather than a silently-empty grid. An empty-but-OK
 * result (0 products) returns `[]` → FeaturedProducts shows its designed empty state, not an error.
 */
export async function fetchNewArrivals(): Promise<ProductCardView[]> {
  const client = createApiClient({ baseUrl: coreApiBaseUrl() });

  const { data, error, response } = await client.GET('/products', {
    params: { query: { sort: 'newest', pageSize: NEW_ARRIVALS_PAGE_SIZE } },
    next: { revalidate: 300, tags: ['catalog'] },
  });

  if (error || !data) {
    throw new Error(`catalog fetch failed (${response.status})`);
  }

  return data.items.map(toProductCardView);
}
