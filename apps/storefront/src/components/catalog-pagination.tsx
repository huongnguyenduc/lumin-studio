import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { formatVnNumber } from '@lumin/core';
import { cn } from '@lumin/ui';
import { buildCatalogHref, pageItems, type CatalogParams } from '@/lib/catalog-params';

const BASE = '/danh-muc';

// One ≥44px cell (conventions §A11y hit target). Numbers use the mono face (design: counts are Space
// Mono). Money/number formatting for the page labels goes through @lumin/core (formatVnNumber).
const CELL =
  'inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md border-2 px-3 ' +
  'font-mono text-sm font-bold transition-colors duration-150 ease-out motion-reduce:transition-none ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-sky focus-visible:ring-offset-2';

/**
 * URL-driven catalog pagination (/danh-muc). Renders prev/next + a windowed page list, each a `<Link>`
 * that patches only `?page=` (keeping category/q/sort), so paging persists on reload exactly like the
 * filters (plan §3 P1-g). Server-rendered links → crawlable + no-JS navigable; returns null for a
 * single page. (The hi-fi design shows a scroll list with no paginator; this on-brand control satisfies
 * the plan's explicit "paginate" done-criterion — noted in the PR.)
 */
export function CatalogPagination({ params, pages }: { params: CatalogParams; pages: number }) {
  const t = useTranslations('catalog');

  if (pages <= 1) return null;

  const current = params.page;
  const hasPrev = current > 1;
  const hasNext = current < pages;

  return (
    <nav
      aria-label={t('paginationLabel')}
      className="mt-8 flex flex-wrap items-center justify-center gap-1.5"
    >
      {hasPrev ? (
        <Link
          href={buildCatalogHref(BASE, params, { page: current - 1 })}
          rel="prev"
          aria-label={t('paginationPrev')}
          className={cn(
            CELL,
            'border-border-strong bg-surface-card text-text-strong hover:bg-surface-sunken',
          )}
        >
          <span aria-hidden="true">‹</span>
        </Link>
      ) : (
        <span
          aria-hidden="true"
          className={cn(
            CELL,
            'cursor-not-allowed border-border-subtle bg-surface-card text-text-subtle opacity-50',
          )}
        >
          ‹
        </span>
      )}

      {pageItems(current, pages).map((item, index) =>
        item === 'ellipsis' ? (
          <span
            // Positional key: ellipsis markers are non-interactive and their order is fixed for a render.
            key={`ellipsis-${index}`}
            aria-hidden="true"
            className="px-1 text-text-muted"
          >
            …
          </span>
        ) : item === current ? (
          <span
            key={item}
            aria-current="page"
            // Descriptive label mirrors the non-current links' `paginationGoTo`, so the current page
            // announces "Trang 3, trang hiện tại" rather than a bare "3".
            aria-label={t('paginationCurrent', { page: formatVnNumber(item) })}
            className={cn(CELL, 'border-transparent bg-primary text-on-primary')}
          >
            {formatVnNumber(item)}
          </span>
        ) : (
          <Link
            key={item}
            href={buildCatalogHref(BASE, params, { page: item })}
            aria-label={t('paginationGoTo', { page: formatVnNumber(item) })}
            className={cn(
              CELL,
              'border-border-strong bg-surface-card text-text-strong hover:bg-surface-sunken',
            )}
          >
            {formatVnNumber(item)}
          </Link>
        ),
      )}

      {hasNext ? (
        <Link
          href={buildCatalogHref(BASE, params, { page: current + 1 })}
          rel="next"
          aria-label={t('paginationNext')}
          className={cn(
            CELL,
            'border-border-strong bg-surface-card text-text-strong hover:bg-surface-sunken',
          )}
        >
          <span aria-hidden="true">›</span>
        </Link>
      ) : (
        <span
          aria-hidden="true"
          className={cn(
            CELL,
            'cursor-not-allowed border-border-subtle bg-surface-card text-text-subtle opacity-50',
          )}
        >
          ›
        </span>
      )}

      <span className="sr-only" aria-live="polite">
        {t('paginationStatus', { page: formatVnNumber(current), total: formatVnNumber(pages) })}
      </span>
    </nav>
  );
}
