import 'server-only';
import { createApiClient } from '@lumin/api-client';
import { coreApiBaseUrl } from './core-api';
import {
  toProductCardView,
  toProductDetailView,
  type ProductCardView,
  type ProductDetailView,
} from './product-view';

// SERVER-ONLY catalog reads. This module imports the openapi-fetch client and reads CORE_API_URL (via
// core-api.ts), so it must never be pulled into the client bundle — it is imported only by the async
// server page.tsx. The client `FeaturedProducts` imports the VIEW TYPE from ./product-view (type-only,
// erased), never this file. (P1-f done-criterion: "no CORE_API_URL in client bundle" — grep-verifiable.)
//
// The `import 'server-only'` above turns that discipline into a COMPILER ERROR: any future client
// component that value-imports this module fails the build (mirrors the guard apps/admin's
// dashboard-fetch.ts gets for free via its next/headers import — this public catalog read needs no
// cookie, so it takes the guard explicitly). product-view.ts deliberately does NOT get this marker: it
// is type-only-imported by the client grid, so it must stay client-safe.

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

/**
 * Fetch one active product for the detail page (/san-pham/{slug}).
 *
 * Returns `null` when core-api answers 404 — the backend returns an IDENTICAL 404 for an unknown slug
 * and for a draft/archived product (no catalog-existence leak, P1-a), so the caller maps null →
 * `notFound()` without probing why. Any OTHER failure (5xx, or a network error that rejects the fetch)
 * propagates so the route error boundary (app/error.tsx) renders "thử lại" rather than a silent 404.
 *
 * Caching mirrors the grid (fetchNewArrivals): tagged `catalog` so the existing POST /api/revalidate
 * purge busts every catalog read — detail pages included — the instant a product changes, with the
 * 300s `revalidate` as the backstop ceiling. A ≤5-min-stale card/detail price is cosmetic: checkout
 * re-prices server-side via POST /price/quote (P1-b). (A finer per-product tag is a future refinement
 * once the emit-side product-change webhook lands with admin product-CRUD.)
 */
export async function fetchProductBySlug(slug: string): Promise<ProductDetailView | null> {
  const client = createApiClient({ baseUrl: coreApiBaseUrl() });

  const { data, error, response } = await client.GET('/products/{slug}', {
    params: { path: { slug } },
    next: { revalidate: 300, tags: ['catalog'] },
  });

  if (response.status === 404) {
    return null;
  }
  if (error || !data) {
    throw new Error(`product fetch failed (${response.status})`);
  }

  return toProductDetailView(data);
}
