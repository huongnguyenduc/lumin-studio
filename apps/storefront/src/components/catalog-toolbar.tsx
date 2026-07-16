import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { cn } from '@lumin/ui';
import { ChevronDownIcon } from './icons';
import {
  buildCatalogHref,
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
  children: React.ReactNode;
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
 * Sort as a native <details> disclosure of <Link>s (NOT a <select> that navigates on change):
 * activating a link is an explicit user action (no WCAG 3.2.2 change-on-input), it is keyboard-safe,
 * works before hydration / with JS off, and matches the hi-fi "Sắp xếp: X ▾" pill + menu. Server
 * component — no hooks; the URL is the single source of truth (buildCatalogHref).
 */
export function CatalogSort({ params }: { params: CatalogParams }) {
  const t = useTranslations('catalog');
  const sortLabels: Record<SortOption, string> = {
    newest: t('sortNewest'),
    price_asc: t('sortPriceAsc'),
    price_desc: t('sortPriceDesc'),
    rating: t('sortRating'),
  };

  return (
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
  );
}

/**
 * Mobile catalog controls (/danh-muc): the category chip row (the desktop rail is CatalogSidebar) and,
 * when a search is active, the "đang tìm" tag with its clear link. The dedicated in-page search form is
 * gone — the hi-fi puts search in the site header (one search surface), and the header's GET form
 * round-trips through the same URL params. Everything here is a `<Link>` → server component.
 */
export function CatalogToolbar({
  categories,
  params,
}: {
  categories: CategoryView[];
  params: CatalogParams;
}) {
  const t = useTranslations('catalog');

  return (
    <div className="flex flex-col gap-3">
      {params.q ? (
        <p className="flex items-center gap-2 text-sm text-text-muted">
          <span className="inline-flex items-center gap-1 rounded-pill border border-border-strong bg-surface-card px-3 py-1 font-mono text-xs font-bold text-text-strong">
            {t('searchActive', { query: params.q })}
          </span>
          <Link
            href={buildCatalogHref(BASE, params, { q: undefined })}
            className="inline-flex min-h-[44px] items-center px-1 text-sm font-semibold text-text-muted underline hover:text-text-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-sky focus-visible:ring-offset-2"
          >
            {t('searchClear')}
          </Link>
        </p>
      ) : null}

      <nav aria-label={t('categoriesLabel')} className="lg:hidden">
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
