import 'server-only';
import { createApiClient } from '@lumin/api-client';
import { coreApiBaseUrl } from './core-api';
import {
  toCategoryView,
  toProductCardView,
  toProductDetailView,
  toReviewView,
  type CategoryView,
  type ProductCardView,
  type ProductDetailView,
  type ReviewView,
} from './product-view';
import { PAGE_SIZE, type CatalogParams } from './catalog-params';

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

/** One page of the catalog-browse grid (/danh-muc): the mapped cards plus the pagination envelope the
 *  server page needs to render the page controls (plan §3 P1-g). `total` is the count across all pages
 *  for the active filter (openapi ProductList). */
export type CatalogPage = {
  items: ProductCardView[];
  total: number;
  page: number;
  pageSize: number;
};

/**
 * Fetch a page of the catalog for /danh-muc — active products filtered by category + full-text `q`
 * (ADR-016, accent-insensitive), sorted, paginated. The card projection carries no colours/options
 * (no N+1). Every filter dimension comes from the validated URL params (lib/catalog-params) so the
 * request is always within the endpoint's bounds (pageSize ≤ 48, q ≤ 100, known sort).
 *
 * Caching mirrors the home grid (fetchNewArrivals): tagged `catalog` so the POST /api/revalidate purge
 * busts every catalog read the instant a product changes, with the 300s `revalidate` as the backstop
 * ceiling. A ≤5-min-stale card price is cosmetic — checkout re-prices server-side via POST /price/quote
 * (P1-b). Throws on a non-2xx / network failure so the route error boundary (app/error.tsx) renders the
 * retry state; an empty-but-OK page (0 matches) returns items:[] so the page shows its designed empty
 * state, not an error.
 */
export async function fetchCatalog(params: CatalogParams): Promise<CatalogPage> {
  const client = createApiClient({ baseUrl: coreApiBaseUrl() });

  const { data, error, response } = await client.GET('/products', {
    params: {
      query: {
        // Omit category/q when unset so the URL the client sends matches the "all / no search" scope.
        category: params.category,
        q: params.q,
        sort: params.sort,
        page: params.page,
        pageSize: PAGE_SIZE,
      },
    },
    next: { revalidate: 300, tags: ['catalog'] },
  });

  if (error || !data) {
    throw new Error(`catalog list fetch failed (${response.status})`);
  }

  return {
    items: data.items.map(toProductCardView),
    total: data.total,
    page: data.page,
    pageSize: data.pageSize,
  };
}

/** The endpoint's max page size (openapi getProducts `pageSize` cap) — the widest window the sitemap can
 *  pull per round-trip. */
const SITEMAP_PAGE_SIZE = 48;

/** Hard ceiling on sitemap paging so a misbehaving `total` can never spin the build into an unbounded
 *  loop: 50 × 48 = 2400 products, far above any realistic made-to-order catalog. If the shop ever grows
 *  past this, the sitemap silently truncates — acceptable (and grep-loud via this constant) vs. hanging. */
const SITEMAP_MAX_PAGES = 50;

/**
 * List the slugs of every ACTIVE product, for the sitemap (P1-q). Pages through the same `GET /products`
 * the catalog uses (active-only projection), accumulating slugs until the reported `total` is covered or
 * the page ceiling is hit. Tagged `catalog` + 300s backstop like the other reads, so a product-change
 * webhook busts the sitemap too. Throws on a non-2xx / network failure; the sitemap route degrades that
 * to the static routes rather than erroring /sitemap.xml (see app/sitemap.ts).
 */
export async function fetchAllProductSlugs(): Promise<string[]> {
  const client = createApiClient({ baseUrl: coreApiBaseUrl() });
  const slugs: string[] = [];

  for (let page = 1; page <= SITEMAP_MAX_PAGES; page++) {
    const { data, error, response } = await client.GET('/products', {
      params: { query: { sort: 'newest', page, pageSize: SITEMAP_PAGE_SIZE } },
      next: { revalidate: 300, tags: ['catalog'] },
    });

    if (error || !data) {
      throw new Error(`sitemap product listing failed (${response.status})`);
    }

    for (const item of data.items) {
      slugs.push(item.slug);
    }

    // Stop when this page finished the set (covered `total`) or came back short/empty — never trust the
    // ceiling to be the terminator on a well-behaved response.
    if (data.items.length === 0 || page * SITEMAP_PAGE_SIZE >= data.total) {
      break;
    }
  }

  return slugs;
}

/**
 * Fetch the browsable category taxonomy for the /danh-muc filter chips. Returns `[]` (never throws) when
 * core-api answers with an empty list — an empty taxonomy is a valid "all only" state, not an error.
 * Caching matches the catalog reads (tag `catalog` + 300s backstop). A non-2xx / network failure throws
 * so the route error boundary renders the retry state (the chips and grid load from the same origin).
 */
export async function fetchCategories(): Promise<CategoryView[]> {
  const client = createApiClient({ baseUrl: coreApiBaseUrl() });

  const { data, error, response } = await client.GET('/categories', {
    // getCategories takes no required params (only an optional If-None-Match header); the empty `params`
    // keeps openapi-fetch's typed overload resolving (an omitted `params` collapses the result type).
    params: {},
    next: { revalidate: 300, tags: ['catalog'] },
  });

  // Read the status up front, NOT inside the guard below: the /categories contract declares no error
  // response (only 200/304), so openapi-fetch's `error` member is `never` and TS proves the
  // `error || !data` branch unreachable — narrowing `response` to `never` there. Capturing status here
  // (where `response` is still `Response`) keeps the runtime guard (a real 5xx/network failure DOES set
  // error / drops data) without the dead-branch narrowing. Contrast fetchCatalog, whose /products 400
  // keeps its guard live. (openapi-fetch v0.13.)
  const status = response.status;

  if (error || !data) {
    throw new Error(`categories fetch failed (${status})`);
  }

  return data.map(toCategoryView);
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

/** One page of published reviews for a product (P1-m): the mapped review views plus the pagination
 *  envelope echoed by the endpoint (`page`/`pageSize`/`total`), so the section can render the pager and
 *  the page can redirect an out-of-range `?reviewsPage=`. `total` is the count of PUBLISHED reviews
 *  across all pages (openapi ReviewList). */
export type ReviewsPage = {
  items: ReviewView[];
  total: number;
  page: number;
  pageSize: number;
};

/** Server default page size for reviews (openapi getProductReviews `pageSize` default = 12, ≤ 48 cap).
 *  Passed explicitly so the page-count math uses the SAME value the wire does (the response echoes it). */
export const REVIEWS_PAGE_SIZE = 12;

/**
 * Fetch one page of published reviews for a product's detail section (/san-pham/{slug}, P1-m). Newest
 * first (the endpoint's only order in Phase 1); ONLY published reviews cross the wire — the hidden/
 * moderated-away filter lives at the SQL source (P1-l), so a suppressed review can never leak here.
 *
 * A 404 (unknown slug OR draft/archived product — the endpoint returns the same uniform 404 as the
 * detail read) returns an EMPTY page rather than throwing: the caller reaches this only AFTER
 * fetchProductBySlug returned a product (a 404 there already routes to notFound()), so a 404 on the
 * reviews read is a rare product-archived-between-the-two-reads race — degrading the secondary reviews
 * section to its empty state is friendlier than erroring a product page that otherwise rendered fine.
 * Any OTHER failure (5xx / network) propagates so the route error boundary (app/error.tsx) renders the
 * retry state, consistent with the other catalog reads.
 *
 * Caching mirrors the detail read: tagged `catalog` (busted by POST /api/revalidate the instant a
 * product changes) with the 300s `revalidate` backstop. Reviews are append-only public content, so a
 * ≤5-min-stale page is harmless.
 */
export async function fetchProductReviews(slug: string, page: number): Promise<ReviewsPage> {
  const client = createApiClient({ baseUrl: coreApiBaseUrl() });

  const { data, error, response } = await client.GET('/products/{slug}/reviews', {
    params: { path: { slug }, query: { page, pageSize: REVIEWS_PAGE_SIZE } },
    next: { revalidate: 300, tags: ['catalog'] },
  });

  if (response.status === 404) {
    return { items: [], total: 0, page, pageSize: REVIEWS_PAGE_SIZE };
  }
  if (error || !data) {
    throw new Error(`reviews fetch failed (${response.status})`);
  }

  return {
    items: data.items.map(toReviewView),
    total: data.total,
    page: data.page,
    pageSize: data.pageSize,
  };
}
