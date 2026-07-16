import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { formatVnNumber } from '@lumin/core';
import { CatalogSort, CatalogToolbar } from '@/components/catalog-toolbar';
import { CatalogSidebar } from '@/components/catalog-sidebar';
import { CatalogResults } from '@/components/catalog-results';
import { CatalogPagination } from '@/components/catalog-pagination';
import { fetchCatalog, fetchCategories } from '@/lib/catalog';
import {
  buildCatalogHref,
  parseCatalogParams,
  totalPages,
  type RawSearchParams,
} from '@/lib/catalog-params';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('catalog');
  // Canonical is the bare /danh-muc: filter/sort/page query params are crawlable variants that all
  // consolidate to the unfiltered catalog (avoids duplicate-content dilution across ?category/?q/?page).
  return { title: t('metaTitle'), alternates: { canonical: '/danh-muc' } };
}

// searchParams is async in Next 15 (awaited below). Reading it opts this route into dynamic rendering,
// but the underlying catalog data is still cached (tag `catalog` + 300s backstop, set in the fetches),
// so a filter/search/sort/page change re-renders from cached data — no origin round-trip per keystroke
// (Q1 caching decision: on-write purge + backstop; the render varies by URL, the data does not).
type PageProps = { searchParams: Promise<RawSearchParams> };

export default async function CatalogPage({ searchParams }: PageProps) {
  const params = parseCatalogParams(await searchParams);
  const t = await getTranslations('catalog');

  // Categories + the product page load in parallel from the same origin; either failing throws → the
  // route error boundary (app/error.tsx) renders retry. Loading is the segment loading.tsx skeleton.
  const [categories, catalog] = await Promise.all([fetchCategories(), fetchCatalog(params)]);

  // Out-of-range deep link (stale bookmark / crawler / hand-edited ?page=): the endpoint returns an
  // empty page with the REAL total, which would otherwise render a misleading "empty" state and — for a
  // single-page catalog — a paginator that hides itself (a dead-end). Redirect to the real last page so
  // the shopper lands on actual products. The {page} patch keeps the active filters (no reset), and
  // `total > 0` avoids a redirect loop on a genuinely empty catalog (which shows its empty state).
  const pageCount = totalPages(catalog.total);
  if (catalog.total > 0 && params.page > pageCount) {
    redirect(buildCatalogHref('/danh-muc', params, { page: pageCount }));
  }

  // When a category is active, title the page with its name (design: the browse header is the category
  // name); otherwise the generic "Danh mục". An unknown slug (no match) falls back to the generic head
  // and yields an empty page (never a 404 — matches the endpoint's unknown-category behaviour).
  const activeCategory = categories.find((category) => category.slug === params.category);
  const heading = activeCategory ? activeCategory.name : t('heading');

  return (
    <div className="mx-auto flex w-full max-w-[1200px] gap-8 px-4 py-8 md:px-6">
      {/* Hi-fi desktop category: a 262px "Bộ lọc" rail on the left; on mobile the rail collapses and
          the chip row inside CatalogToolbar takes over (same URL round-trip either way). */}
      <aside className="hidden w-[262px] shrink-0 lg:block">
        <CatalogSidebar categories={categories} params={params} />
      </aside>

      <div className="min-w-0 flex-1">
        <div className="mb-5 flex items-center justify-between gap-4">
          <h1 className="flex items-baseline gap-3 text-2xl md:text-3xl">
            {heading}
            <span className="font-mono text-sm font-normal text-text-muted">
              {/* count is pre-formatted via @lumin/core (grouped) — never a raw number baked in copy. */}
              {t('resultCount', { count: formatVnNumber(catalog.total) })}
            </span>
          </h1>
          <CatalogSort params={params} />
        </div>

        <CatalogToolbar categories={categories} params={params} />

        <div className="mt-5">
          <CatalogResults products={catalog.items} params={params} />
        </div>

        <CatalogPagination params={params} pages={pageCount} />
      </div>
    </div>
  );
}
