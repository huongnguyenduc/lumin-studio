// Pure catalog-browse URL-param helpers (/danh-muc). No runtime imports → client-safe: the server page
// (page.tsx) parses `searchParams` through here and the client <CatalogToolbar> builds `<Link>` hrefs
// through the SAME helpers, so the URL is the single source of truth for filter+search+sort+page state
// (plan §3 P1-g "filters persist reload"). Everything here is a pure function → unit-tested in
// test/catalog-params.test.ts. No money/number formatting lives here (that stays @lumin/core).

/** Sort orders the catalog list endpoint accepts (openapi getProducts `sort` enum). The storefront only
 *  offers what the backend can actually order by — the hi-fi design's "Bán chạy nhất"/"Nổi bật" have no
 *  backing column in Phase 1, so they are deliberately omitted (noted in the PR). */
export const SORT_OPTIONS = ['newest', 'price_asc', 'price_desc', 'rating'] as const;
export type SortOption = (typeof SORT_OPTIONS)[number];

/** Server default (openapi `sort` default): newest first. Omitted from the URL so `/danh-muc` is clean. */
export const DEFAULT_SORT: SortOption = 'newest';

/** Cards per page. Fixed client-side (not user-tunable) and ≤ the endpoint's 48 cap (openapi pageSize). */
export const PAGE_SIZE = 12;

/** The endpoint rejects q > 100 chars with 400 (openapi `q` maxLength). We truncate here so a pasted
 *  over-long query degrades to a search instead of erroring the whole page. */
export const MAX_Q_LENGTH = 100;

/** Validated browse state parsed from the URL. `category`/`q` are absent (undefined) rather than ''
 *  when unset, so the "all / no search" case is unambiguous for the empty-state split and href builder. */
export type CatalogParams = {
  /** Category slug filter, or undefined for "Tất cả". */
  category?: string;
  /** Trimmed, non-empty search term (≤ MAX_Q_LENGTH), or undefined for "no search". */
  q?: string;
  sort: SortOption;
  /** 1-based page (≥ 1). */
  page: number;
};

/** Raw awaited Next 15 `searchParams` shape. */
export type RawSearchParams = Record<string, string | string[] | undefined>;

/** A repeated `?q=a&q=b` param arrives as an array; take the first, matching how a browser form submits
 *  a single field. A missing param is undefined. */
function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Truncate to a rune (code-point) length — matches how the server bounds `q` (RuneCountInString-style),
 *  so a truncation here never leaves a dangling half-character and never exceeds the server's limit. */
function clampRunes(text: string, max: number): string {
  const runes = Array.from(text);
  return runes.length <= max ? text : runes.slice(0, max).join('');
}

/**
 * Parse + validate the raw URL query into CatalogParams. Every field is made safe so the page can never
 * send the endpoint a value it would 400 on: unknown `sort` → default; `page` non-numeric/<1 → 1; `q`
 * trimmed, emptied → undefined, over-length → truncated; blank `category` → undefined.
 */
export function parseCatalogParams(raw: RawSearchParams): CatalogParams {
  const rawCategory = first(raw.category)?.trim();
  const category = rawCategory ? rawCategory : undefined;

  const rawQ = first(raw.q)?.trim();
  const q = rawQ ? clampRunes(rawQ, MAX_Q_LENGTH) : undefined;

  const rawSort = first(raw.sort);
  const sort = (SORT_OPTIONS as readonly string[]).includes(rawSort ?? '')
    ? (rawSort as SortOption)
    : DEFAULT_SORT;

  const parsedPage = Number.parseInt(first(raw.page) ?? '', 10);
  const page = Number.isFinite(parsedPage) && parsedPage >= 1 ? parsedPage : 1;

  return { category, q, sort, page };
}

/** A change to any filter dimension (category/q/sort) invalidates the current page number — page 3 of the
 *  old filter is meaningless under the new one — so we reset to page 1 UNLESS the caller is explicitly
 *  paging. Detected via `'key' in patch` so clearing a filter (patch `{category: undefined}`, e.g. the
 *  "Tất cả" chip) still counts as a change. */
export type CatalogPatch = Partial<CatalogParams>;

/**
 * Build a `/danh-muc` href from the current params plus a patch, omitting defaults so URLs stay clean
 * (`/danh-muc`, not `/danh-muc?sort=newest&page=1`). Used by every chip / sort option / page link and by
 * the search submit, so they all round-trip through parseCatalogParams identically.
 */
export function buildCatalogHref(
  base: string,
  current: CatalogParams,
  patch: CatalogPatch,
): string {
  const next: CatalogParams = { ...current, ...patch };

  const changedFilter = 'category' in patch || 'q' in patch || 'sort' in patch;
  if (changedFilter && !('page' in patch)) {
    next.page = 1;
  }

  const sp = new URLSearchParams();
  if (next.category) sp.set('category', next.category);
  if (next.q) sp.set('q', next.q);
  if (next.sort !== DEFAULT_SORT) sp.set('sort', next.sort);
  if (next.page > 1) sp.set('page', String(next.page));

  const qs = sp.toString();
  return qs ? `${base}?${qs}` : base;
}

/** Which empty state to show when a page has zero results — the plan requires distinguishing "a search
 *  found nothing" from "a filter found nothing" from "the catalog is bare" (each has its own copy + CTA).
 *  Search takes precedence over category because a search within a category that yields nothing reads as
 *  a search miss ("no results for X"), the more specific message. */
export type EmptyKind = 'search' | 'filter' | 'catalog';

export function emptyStateKind(params: Pick<CatalogParams, 'category' | 'q'>): EmptyKind {
  if (params.q) return 'search';
  if (params.category) return 'filter';
  return 'catalog';
}

/** Total page count for `total` items (≥ 1 so an empty result still reports a single, current page). */
export function totalPages(total: number, pageSize: number = PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

/**
 * The compact list of page markers to render: every page when there are ≤ 7, otherwise first + last +
 * a window around the current page, with 'ellipsis' markers standing in for the collapsed gaps. Pure so
 * the windowing is unit-tested independently of the JSX.
 */
export function pageItems(current: number, pages: number): Array<number | 'ellipsis'> {
  if (pages <= 7) {
    return Array.from({ length: pages }, (_, i) => i + 1);
  }

  const shown = new Set<number>([1, pages, current, current - 1, current + 1]);
  const sorted = [...shown].filter((p) => p >= 1 && p <= pages).sort((a, b) => a - b);

  const out: Array<number | 'ellipsis'> = [];
  for (let i = 0; i < sorted.length; i += 1) {
    out.push(sorted[i]);
    const nextPage = sorted[i + 1];
    if (nextPage === undefined) continue;
    const gap = nextPage - sorted[i];
    if (gap === 2) {
      // Exactly one page hidden — show the number itself, not an ellipsis (an ellipsis is the same
      // width as a page link but non-interactive, so it would needlessly bury a single reachable page).
      out.push(sorted[i] + 1);
    } else if (gap > 2) {
      out.push('ellipsis');
    }
  }
  return out;
}
