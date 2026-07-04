'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Button, cn } from '@lumin/ui';
import { ChevronDownIcon, SearchIcon } from './icons';
import {
  buildCatalogHref,
  MAX_Q_LENGTH,
  SORT_OPTIONS,
  type CatalogParams,
  type SortOption,
} from '@/lib/catalog-params';
import type { CategoryView } from '@/lib/product-view';

const BASE = '/danh-muc';

/** Category filter chip — a `<Link>` (so it works before hydration + is crawlable). Active chip is the
 *  cocoa surface with light text (design). ≥44px tap target (conventions §A11y). */
function ChipLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'true' : undefined}
      className={cn(
        'inline-flex min-h-[44px] items-center rounded-pill border-2 px-4 text-sm font-semibold',
        'transition-colors duration-150 ease-out motion-reduce:transition-none',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-sky focus-visible:ring-offset-2',
        active
          ? 'border-transparent bg-surface-brand text-on-dark'
          : 'border-border-strong bg-surface-card text-text-strong hover:bg-surface-sunken',
      )}
    >
      {children}
    </Link>
  );
}

/**
 * Catalog-browse controls (/danh-muc): category chips + search box + sort. The URL is the single source
 * of truth — every control navigates through buildCatalogHref (chips + clear are `<Link>`s; search submit
 * + sort change use the router), so filter/search/sort/page all persist on reload and round-trip through
 * parseCatalogParams (plan §3 P1-g). A client component only for the search input + sort control; the
 * grid, pagination and empty states stay server-rendered.
 */
export function CatalogToolbar({
  categories,
  params,
}: {
  categories: CategoryView[];
  params: CatalogParams;
}) {
  const t = useTranslations('catalog');
  const router = useRouter();
  const [query, setQuery] = useState(params.q ?? '');

  // Re-sync the input when the URL's `q` changes by navigation the input didn't drive (back/forward, a
  // chip that clears the search, the empty-state "clear" CTA). It never clobbers typing: `params.q` only
  // changes on a committed navigation, not per keystroke.
  useEffect(() => {
    setQuery(params.q ?? '');
  }, [params.q]);

  const sortLabels: Record<SortOption, string> = {
    newest: t('sortNewest'),
    price_asc: t('sortPriceAsc'),
    price_desc: t('sortPriceDesc'),
    rating: t('sortRating'),
  };

  function onSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = query.trim();
    router.push(buildCatalogHref(BASE, params, { q: trimmed === '' ? undefined : trimmed }));
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <form role="search" onSubmit={onSearchSubmit} className="flex flex-1 items-center gap-2">
          <div className="flex h-11 flex-1 items-center gap-2 rounded-pill border-2 border-border-strong bg-surface-card px-4 focus-within:border-primary">
            <SearchIcon className="h-4 w-4 shrink-0 text-text-muted" aria-hidden="true" />
            <label htmlFor="catalog-q" className="sr-only">
              {t('searchLabel')}
            </label>
            <input
              id="catalog-q"
              name="q"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('searchPlaceholder')}
              maxLength={MAX_Q_LENGTH}
              className="h-full w-full bg-transparent font-mono text-sm text-text-body outline-none placeholder:text-text-subtle"
            />
          </div>
          <Button type="submit" variant="outline">
            {t('searchSubmit')}
          </Button>
          {params.q ? (
            <Link
              href={buildCatalogHref(BASE, params, { q: undefined })}
              className="inline-flex min-h-[44px] shrink-0 items-center px-2 text-sm font-semibold text-text-muted hover:text-text-strong"
            >
              {t('searchClear')}
            </Link>
          ) : null}
        </form>

        {/* Sort as a native <details> disclosure of <Link>s (NOT a <select> that navigates on change):
            activating a link is an explicit user action (no WCAG 3.2.2 change-on-input), it is keyboard-
            safe (no per-arrow navigation), works before hydration / with JS off, and matches the design's
            dropdown — consistent with the chip/pagination Link-first pattern. */}
        <details className="group relative shrink-0">
          <summary className="inline-flex min-h-[44px] cursor-pointer list-none items-center gap-2 rounded-pill border-2 border-border-strong bg-surface-card px-4 font-display text-sm font-semibold text-text-strong marker:content-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-sky focus-visible:ring-offset-2 [&::-webkit-details-marker]:hidden">
            <span className="text-text-muted">{t('sortLabel')}:</span>
            {sortLabels[params.sort]}
            <ChevronDownIcon className="h-4 w-4 transition-transform group-open:rotate-180" />
          </summary>
          <ul className="absolute right-0 z-20 mt-1 min-w-[200px] rounded-lg border-2 border-border-strong bg-surface-card p-1 shadow-pop">
            {SORT_OPTIONS.map((option) => {
              const active = params.sort === option;
              return (
                <li key={option}>
                  <Link
                    href={buildCatalogHref(BASE, params, { sort: option })}
                    aria-current={active ? 'true' : undefined}
                    className={cn(
                      'flex min-h-[44px] items-center rounded-md px-3 text-sm',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-sky focus-visible:ring-offset-2',
                      // Selection is conveyed by aria-current + the bold/primary treatment (no ✓ glyph).
                      active
                        ? 'font-bold text-primary'
                        : 'font-semibold text-text-strong hover:bg-surface-sunken',
                    )}
                  >
                    {sortLabels[option]}
                  </Link>
                </li>
              );
            })}
          </ul>
        </details>
      </div>

      <nav aria-label={t('categoriesLabel')}>
        <ul className="flex flex-wrap gap-2">
          <li>
            <ChipLink
              href={buildCatalogHref(BASE, params, { category: undefined })}
              active={!params.category}
            >
              {t('allCategories')}
            </ChipLink>
          </li>
          {categories.map((category) => (
            <li key={category.id}>
              <ChipLink
                href={buildCatalogHref(BASE, params, { category: category.slug })}
                active={params.category === category.slug}
              >
                {category.name}
              </ChipLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
